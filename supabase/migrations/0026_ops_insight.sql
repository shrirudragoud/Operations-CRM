-- 0026: operations insight (D60). The numbers behind the Cockpit's Operations view and the lead's team view.
--
--   1. working_days(from, to)  Monday to Friday days in a range. Saturday and Sunday are off.
--   2. task_bucket(...)        early / on_time / late for a finished task against a deadline, in Indian time.
--   3. v_task_timeliness       one row per task: who, when it was finished, how that compares with the ORIGINAL
--                              deadline (and the current one), how often the deadline was pushed back, time blocked,
--                              time logged. Reads through RLS, so a lead only sees what a lead may see.
--   4. backlog_snapshot        what was open, overdue and blocked at the start of each day, per department and person.
--                              These cannot be rebuilt later, so the nightly job keeps them from now on.

-- ---------------------------------------------------------------- 1. working days
create or replace function ops.working_days(p_from date, p_to date) returns integer
language sql immutable set search_path = '' as $$
  select count(*)::integer
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
   where extract(isodow from g) < 6
$$;

-- ---------------------------------------------------------------- 2. early, on time, late
-- Early: finished on an earlier day than the deadline. On time: by the deadline (end of day when there is no time).
-- Late: after it. No deadline, or not finished: null.
create or replace function ops.task_bucket(p_finished timestamptz, p_due date, p_due_time time) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_finished is null or p_due is null then null
    when (p_finished at time zone 'Asia/Kolkata')::date < p_due then 'early'
    when (p_finished at time zone 'Asia/Kolkata') <= (p_due + coalesce(p_due_time, time '23:59:59.999')) then 'on_time'
    else 'late'
  end
$$;

-- ---------------------------------------------------------------- 3. one row per task
-- The original deadline is the first one ever set (the 'due' history row's "from", or its "to" when the deadline was
-- added later). Moving a deadline back would otherwise turn late work into on-time work.
create view ops.v_task_timeliness with (security_invoker = true) as
select
  t.id                                    as task_id,
  t.title,
  t.department,
  t.priority,
  t.status,
  t.assignee_id,
  t.created_by,
  t.assigned_by,
  t.parent_task_id is not null            as is_subtask,
  t.created_at,
  (t.created_at at time zone 'Asia/Kolkata')::date as created_day,
  t.assigned_at,
  t.accepted_at,
  h.started_at,
  case when t.status = 'done' then t.completed_at end as done_at,
  case when t.status = 'done' then (t.completed_at at time zone 'Asia/Kolkata')::date end as done_day,
  t.due_date,
  t.due_time,
  coalesce(fd.d, t.due_date)              as original_due_date,
  case when fd.s is not null then fd.tm else t.due_time end as original_due_time,
  case when t.status = 'done' then ops.task_bucket(t.completed_at, coalesce(fd.d, t.due_date), case when fd.s is not null then fd.tm else t.due_time end) end as bucket,
  case when t.status = 'done' then ops.task_bucket(t.completed_at, t.due_date, t.due_time) end as bucket_now,
  case when t.status = 'done'
        and ops.task_bucket(t.completed_at, coalesce(fd.d, t.due_date), case when fd.s is not null then fd.tm else t.due_time end) = 'late'
       then ops.working_days(coalesce(fd.d, t.due_date) + 1, (t.completed_at at time zone 'Asia/Kolkata')::date)
  end                                     as days_late,
  t.estimate_minutes,
  coalesce(tm.minutes, 0)::integer        as logged_minutes,
  coalesce(bl.minutes, 0)::integer        as blocked_minutes,
  coalesce(h.reschedules, 0)::integer     as reschedules,
  coalesce(h.reopens, 0)::integer         as reopens,
  coalesce(h.reassigns, 0)::integer       as reassigns
from ops.task t
left join lateral (
  select count(*) filter (where kind = 'due' and from_value is not null and to_value > from_value) as reschedules,
         count(*) filter (where kind = 'status' and from_value = 'done')                           as reopens,
         count(*) filter (where kind = 'assigned' and from_value is not null)                      as reassigns,
         min(at)  filter (where kind = 'status' and to_value = 'doing')                            as started_at
    from ops.task_history x where x.task_id = t.id
) h on true
left join lateral (
  select s, left(s, 10)::date as d, nullif(substr(s, 12, 5), '')::time as tm
    from (select coalesce(x.from_value, x.to_value) as s
            from ops.task_history x where x.task_id = t.id and x.kind = 'due'
           order by x.at, x.id limit 1) f
) fd on true
left join lateral (
  select sum(e.minutes) as minutes from ops.time_entry e where e.task_id = t.id
) tm on true
left join lateral (
  select sum(extract(epoch from (coalesce(z.nxt, now()) - z.at)) / 60)::integer as minutes
    from (select s.to_value, s.at, lead(s.at) over (order by s.at, s.id) as nxt
            from ops.task_history s where s.task_id = t.id and s.kind = 'status') z
   where z.to_value = 'blocked'
) bl on true;

-- ---------------------------------------------------------------- 4. backlog snapshot
create table ops.backlog_snapshot (
  snapshot_date     date    not null,
  department        ops.department not null,
  assignee_id       uuid    references ops.staff (id) on delete cascade,
  open_count        integer not null,
  overdue_count     integer not null,
  blocked_count     integer not null,
  no_deadline_count integer not null
);
create unique index backlog_snapshot_key
  on ops.backlog_snapshot (snapshot_date, department, coalesce(assignee_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index backlog_snapshot_assignee_idx on ops.backlog_snapshot (assignee_id);

alter table ops.backlog_snapshot enable row level security;
create policy backlog_snapshot_sel on ops.backlog_snapshot for select to authenticated
  using ((select ops.is_founder())
         or ((select ops.my_role()) = 'dept_lead'
             and (department = any ((select ops.my_departments())::ops.department[]) or (select ops.leads_staff(assignee_id)))));

-- The nightly snapshot (from 0024) now also writes the backlog. Same body, one block added.
create or replace function ops.write_kpi_snapshot(p_date date default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare d date := coalesce(p_date, ops.today_ist()); n integer;
begin
  delete from ops.kpi_snapshot where snapshot_date = d;
  delete from ops.backlog_snapshot where snapshot_date = d;

  insert into ops.kpi_snapshot (snapshot_date, metric, dimension, value)
  select d, 'institutions', stage::text, count(*)
    from ops.institution where archived_at is null group by stage
  union all
  select d, 'institutions', 'all', count(*) from ops.institution where archived_at is null
  union all
  select d, 'deals_open', 'all', count(*) from ops.deal where stage in ('meeting', 'proposal', 'negotiation') and archived_at is null
  union all
  select d, 'pipeline_value_inr', 'all', coalesce(sum(value_inr), 0)
    from ops.deal where stage in ('meeting', 'proposal', 'negotiation') and archived_at is null
  union all
  select d, 'pipeline_weighted_inr', 'all', coalesce(sum(value_inr * coalesce(probability, 0) / 100.0), 0)
    from ops.deal where stage in ('meeting', 'proposal', 'negotiation') and archived_at is null
  union all
  select d, 'deals_won', 'all', count(*) from ops.deal where stage = 'won' and archived_at is null
  union all
  select d, 'won_value_inr', 'all', coalesce(sum(value_inr), 0) from ops.deal where stage = 'won' and archived_at is null
  union all
  select d, 'events_completed', 'all', count(*) from ops.event where status = 'completed' and archived_at is null
  union all
  select d, 'people_trained', 'all', coalesce(sum(actual_headcount), 0)
    from ops.event where status = 'completed' and archived_at is null
  union all
  select d, 'tasks_open', 'all', count(*) from ops.task where status in ('todo', 'doing', 'blocked')
  union all
  select d, 'tasks_overdue', 'all', count(*) from ops.task where status in ('todo', 'doing', 'blocked') and due_date < d
  union all
  select d, 'kit_loss_inr', 'all', coalesce(sum(-sm.qty * coalesce(i.unit_cost_inr, 0)), 0)
    from ops.stock_movement sm join ops.item i on i.id = sm.item_id where sm.kind in ('damaged', 'lost')
  union all
  select d, 'low_stock_items', 'all', count(*) from ops.v_low_stock
  union all
  select d, 'funnel_reached', step, sum(institutions) from ops.v_funnel_steps group by step;

  if exists (select 1 from ops.ide_user_snapshot) then
    insert into ops.kpi_snapshot (snapshot_date, metric, dimension, value)
    select d, 'ide_students', 'signed_up', count(*) from ops.ide_user_snapshot
    union all select d, 'ide_students', 'compiled', count(first_compile_at) from ops.ide_user_snapshot
    union all select d, 'ide_students', 'flashed', count(first_flash_at) from ops.ide_user_snapshot
    union all select d, 'ide_students', 'published', count(first_publish_at) from ops.ide_user_snapshot;
  end if;

  insert into ops.backlog_snapshot (snapshot_date, department, assignee_id, open_count, overdue_count, blocked_count, no_deadline_count)
  select d, department, assignee_id,
         count(*),
         count(*) filter (where due_date < d),
         count(*) filter (where status = 'blocked'),
         count(*) filter (where due_date is null)
    from ops.task
   where status in ('todo', 'doing', 'blocked')
   group by department, assignee_id;

  select count(*) into n from ops.kpi_snapshot where snapshot_date = d;
  return n;
end $$;

-- Functions: same grant rules as everywhere (nothing for public).
revoke execute on all functions in schema ops from public;
grant execute on function ops.working_days(date, date), ops.task_bucket(timestamptz, date, time) to authenticated, service_role;
