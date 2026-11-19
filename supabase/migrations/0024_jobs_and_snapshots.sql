-- 0024: scheduled jobs that leave a trail, and the nightly KPI snapshot.
--
--   1. run_job(name)         the one entry point a scheduler calls. Takes a lock so two runs never overlap, writes a
--                            job_run row, records the error if the job fails, and closes runs that died half way.
--   2. write_kpi_snapshot()  one row per metric per day in kpi_snapshot. Safe to run again the same day (it overwrites).
--   2b. purge_attendance()   removes attendance older than two years (and its audit copies)
--   3. job_health()          founder only: the last run of each job and whether it is overdue.
--
-- The schedule itself (pg_cron) is in supabase/schedules.sql, not here: it needs an extension the test database
-- does not have, and it is applied to hosted on purpose, not by every migration run.

-- ---------------------------------------------------------------- 1. KPI snapshot
create or replace function ops.write_kpi_snapshot(p_date date default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare d date := coalesce(p_date, ops.today_ist()); n integer;
begin
  delete from ops.kpi_snapshot where snapshot_date = d;

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
  -- Funnel steps (view from 0025, read when the job runs): institutions that reached each step, all segments together.
  select d, 'funnel_reached', step, sum(institutions) from ops.v_funnel_steps group by step;

  -- Student steps only once the IDE sync has sent someone: no row is better than a made-up zero.
  if exists (select 1 from ops.ide_user_snapshot) then
    insert into ops.kpi_snapshot (snapshot_date, metric, dimension, value)
    select d, 'ide_students', 'signed_up', count(*) from ops.ide_user_snapshot
    union all select d, 'ide_students', 'compiled', count(first_compile_at) from ops.ide_user_snapshot
    union all select d, 'ide_students', 'flashed', count(first_flash_at) from ops.ide_user_snapshot
    union all select d, 'ide_students', 'published', count(first_publish_at) from ops.ide_user_snapshot;
  end if;

  select count(*) into n from ops.kpi_snapshot where snapshot_date = d;
  return n;
end $$;

-- ---------------------------------------------------------------- 1b. attendance retention (D57: two years)
-- Days older than two years go, and so do their copies in the audit log. Failed check-in attempts (a diagnostic
-- for "the office IP changed") are kept 90 days. Returns how many rows were removed.
create or replace function ops.purge_attendance(p_years integer default 2) returns integer
language plpgsql security definer set search_path = '' as $$
declare cutoff date := ops.today_ist() - (p_years * 365); n integer := 0; k integer;
begin
  delete from ops.attendance_session where work_date < cutoff;
  get diagnostics k = row_count; n := n + k;
  delete from ops.attendance_request where work_date < cutoff;
  get diagnostics k = row_count; n := n + k;
  delete from ops.attendance_day_mark where mark_date < cutoff;
  get diagnostics k = row_count; n := n + k;
  delete from ops.attendance_failure where attempted_at < now() - interval '90 days';
  get diagnostics k = row_count; n := n + k;
  delete from ops.audit_log
   where (table_name in ('attendance_session', 'attendance_request')
          and coalesce(before ->> 'work_date', after ->> 'work_date')::date < cutoff)
      or (table_name = 'attendance_day_mark' and coalesce(before ->> 'mark_date', after ->> 'mark_date')::date < cutoff);
  return n;
end $$;

-- ---------------------------------------------------------------- 2. job runner
-- Only these names can be run. The name is matched, never executed as text.
create or replace function ops.run_job(p_job text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  run_id uuid;
  result jsonb;
  affected integer;
begin
  if p_job not in ('task_automation', 'kpi_snapshot', 'low_stock', 'attendance_retention') then
    raise exception 'Unknown job: %', p_job;
  end if;

  -- A second run of the same job while one is going is skipped, not queued.
  if not pg_try_advisory_xact_lock(hashtext('ops.run_job.' || p_job)) then
    return jsonb_build_object('job', p_job, 'status', 'skipped');
  end if;

  -- A run that never finished (the server died) is closed so the history is honest.
  update ops.job_run set status = 'failed', finished_at = now(), error = 'Did not finish'
   where job = p_job and status = 'running' and started_at < now() - interval '1 hour';

  insert into ops.job_run (job) values (p_job) returning id into run_id;

  begin
    if p_job = 'task_automation' then
      result := ops.run_task_automation();
    elsif p_job = 'kpi_snapshot' then
      affected := ops.write_kpi_snapshot();
      result := jsonb_build_object('metrics', affected);
    elsif p_job = 'low_stock' then
      affected := ops.raise_low_stock_tasks();
      result := jsonb_build_object('tasks_raised', affected);
    else
      affected := ops.purge_attendance();
      result := jsonb_build_object('rows_removed', affected);
    end if;
  exception when others then
    update ops.job_run set status = 'failed', finished_at = now(), error = left(sqlerrm, 500) where id = run_id;
    return jsonb_build_object('job', p_job, 'status', 'failed', 'error', left(sqlerrm, 500));
  end;

  update ops.job_run set status = 'ok', finished_at = now(), details = coalesce(result, '{}'::jsonb) where id = run_id;
  return jsonb_build_object('job', p_job, 'status', 'ok', 'details', coalesce(result, '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------- 3. job health (founder)
create or replace function ops.job_health() returns table (
  job text, every_minutes integer, last_status text, last_started timestamptz, last_ok timestamptz, last_error text, overdue boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ops.is_founder() then raise exception 'Only the founder can see this' using errcode = '42501'; end if;
  return query
  select j.job, j.every_minutes,
         l.status, l.started_at, o.started_at, l.error,
         coalesce(o.started_at, '-infinity'::timestamptz) < now() - make_interval(mins => j.every_minutes * 3)
  from (values ('task_automation', 15), ('kpi_snapshot', 1440), ('low_stock', 1440), ('attendance_retention', 1440)) as j (job, every_minutes)
  left join lateral (select r.status, r.started_at, r.error from ops.job_run r where r.job = j.job
                      order by r.started_at desc limit 1) l on true
  left join lateral (select r.started_at from ops.job_run r where r.job = j.job and r.status = 'ok'
                      order by r.started_at desc limit 1) o on true
  order by j.job;
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on all functions in schema ops from public;
grant execute on function ops.run_job(text), ops.write_kpi_snapshot(date), ops.purge_attendance(integer) to service_role;
grant execute on function ops.job_health() to authenticated, service_role;
