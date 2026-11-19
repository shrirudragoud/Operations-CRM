-- 0019 task collaboration (slice B plus fixed tasks and saved views)
-- 1. Start date on tasks (start to deadline), set by the people doing the work or a manager.
-- 2. Watchers: creator and assignee watch automatically; anyone can watch; a manager can add colleagues; a
--    comment author and a mentioned colleague become watchers. Watching a task lets you see it.
-- 3. Notifications: written by the database when a task is assigned, changes status or dates, gets a comment or
--    a mention, is due today or is overdue. Each person reads and clears only their own.
-- 4. Fixed (recurring) tasks: a founder or the department lead defines a template (daily, weekdays, weekly,
--    monthly) for the whole department or picked people; ops.run_task_automation() creates the tasks.
--    It is idempotent, so it can be called from the app, from pg_cron or from an Edge Function.
-- 5. Saved task views (a name plus the filters of the list/board/calendar/timeline), private or shared.
-- 6. The guard and the history writer learn about system jobs: a job runs with ops.system_job set, so the
--    person whose page load triggered it is never recorded as the creator.

-- ---------------------------------------------------------------- helpers
create or replace function ops.is_system() returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is null or coalesce(current_setting('ops.system_job', true), '') = '1'
$$;

create or replace function ops.task_manager(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.task t
                 where t.id = p_task
                   and (ops.is_founder()
                        or t.created_by = auth.uid()
                        or (ops.my_role() = 'dept_lead' and ops.in_dept(t.department))))
$$;

-- ---------------------------------------------------------------- task columns
alter table ops.task
  add column start_date    date,
  add column recurrence_id uuid,
  add column period_start  date,
  add constraint task_start_before_due check (start_date is null or due_date is null or start_date <= due_date);

alter table ops.task_history drop constraint task_history_kind_check;
alter table ops.task_history add constraint task_history_kind_check
  check (kind in ('created', 'assigned', 'status', 'due', 'start', 'priority', 'department', 'edited'));

-- ---------------------------------------------------------------- watchers
create table ops.task_watcher (
  task_id    uuid not null references ops.task (id) on delete cascade,
  staff_id   uuid not null references ops.staff (id) on delete cascade,
  added_by   uuid references ops.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, staff_id)
);
create index task_watcher_staff_idx on ops.task_watcher (staff_id);
create index task_watcher_added_by_idx on ops.task_watcher (added_by);

insert into ops.task_watcher (task_id, staff_id)
select t.id, t.created_by from ops.task t join ops.staff s on s.id = t.created_by
where s.role <> 'partner'
on conflict do nothing;
insert into ops.task_watcher (task_id, staff_id)
select t.id, t.assignee_id from ops.task t join ops.staff s on s.id = t.assignee_id
where s.role <> 'partner'
on conflict do nothing;

create or replace function ops.is_watching(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.task_watcher w where w.task_id = p_task and w.staff_id = auth.uid())
$$;

-- Automatic watching (creator, assignee, commenter) skips partners: they see their own tasks anyway.
create or replace function ops.auto_watch(p_task uuid, p_staff uuid, p_by uuid) returns void
language sql security definer set search_path = '' as $$
  insert into ops.task_watcher (task_id, staff_id, added_by)
  select p_task, s.id, p_by from ops.staff s where s.id = p_staff and s.is_active and s.role <> 'partner'
  on conflict do nothing
$$;

create or replace function ops.task_watcher_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  select role, is_active into s from ops.staff where id = new.staff_id;
  if not found or not s.is_active then raise exception 'Choose an active team member to add as a watcher'; end if;
  if s.role = 'partner' then raise exception 'Partners cannot be added as watchers'; end if;
  if auth.uid() is not null then new.added_by := auth.uid(); end if;
  return new;
end $$;
create trigger t_task_watcher_guard before insert on ops.task_watcher
  for each row execute function ops.task_watcher_guard();

alter table ops.task_watcher enable row level security;
create policy task_watcher_sel on ops.task_watcher for select to authenticated
  using (exists (select 1 from ops.task t where t.id = task_id));
create policy task_watcher_ins on ops.task_watcher for insert to authenticated
  with check ((select ops.can_write())
              and exists (select 1 from ops.task t where t.id = task_id)
              and (staff_id = (select auth.uid()) or (select ops.task_manager(task_id))));
create policy task_watcher_del on ops.task_watcher for delete to authenticated
  using (staff_id = (select auth.uid()) or (select ops.task_manager(task_id)));

-- A watcher can see the task they follow, in any department.
drop policy task_sel on ops.task;
create policy task_sel on ops.task for select to authenticated
  using (department = any ((select ops.my_departments())::ops.department[])
         or assignee_id = (select auth.uid())
         or created_by = (select auth.uid())
         or (select ops.is_watching(id)));

-- ---------------------------------------------------------------- notifications
create table ops.notification (
  id           bigint generated always as identity primary key,
  recipient_id uuid not null references ops.staff (id) on delete cascade,
  kind         text not null check (kind in ('assigned', 'mentioned', 'status', 'dates', 'comment', 'due_today', 'overdue', 'recurring')),
  task_id      uuid references ops.task (id) on delete cascade,
  actor_id     uuid references ops.staff (id) on delete set null,
  message      text not null,
  dedupe_key   text,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);
create index notification_recipient_idx on ops.notification (recipient_id, created_at desc);
create index notification_task_idx on ops.notification (task_id);
create index notification_actor_idx on ops.notification (actor_id);
create unique index notification_dedupe_idx on ops.notification (recipient_id, dedupe_key) where dedupe_key is not null;

alter table ops.notification enable row level security;
create policy notification_sel on ops.notification for select to authenticated
  using (recipient_id = (select auth.uid()));
create policy notification_upd on ops.notification for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));
create policy notification_del on ops.notification for delete to authenticated
  using (recipient_id = (select auth.uid()));

create or replace function ops.notification_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.recipient_id := old.recipient_id;
    new.kind := old.kind;
    new.task_id := old.task_id;
    new.actor_id := old.actor_id;
    new.message := old.message;
    new.dedupe_key := old.dedupe_key;
    new.created_at := old.created_at;
    new.read_at := coalesce(old.read_at, new.read_at);
  end if;
  return new;
end $$;
create trigger t_notification_guard before update on ops.notification
  for each row execute function ops.notification_guard();

create or replace function ops.notify(p_recipient uuid, p_kind text, p_task uuid, p_actor uuid, p_message text, p_key text default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_recipient is null or p_recipient is not distinct from p_actor then return false; end if;
  if not exists (select 1 from ops.staff where id = p_recipient and is_active) then return false; end if;
  insert into ops.notification (recipient_id, kind, task_id, actor_id, message, dedupe_key)
  values (p_recipient, p_kind, p_task, p_actor, p_message, p_key)
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ---------------------------------------------------------------- fixed (recurring) tasks
create table ops.task_recurrence (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (length(btrim(title)) between 1 and 200),
  description      text check (description is null or length(description) <= 4000),
  department       ops.department not null,
  priority         smallint not null default 3 check (priority between 1 and 4),
  estimate_minutes integer check (estimate_minutes is null or estimate_minutes between 1 and 6000),
  frequency        text not null check (frequency in ('daily', 'weekdays', 'weekly', 'monthly')),
  weekday          smallint check (weekday between 1 and 7),
  month_day        smallint check (month_day between 1 and 28),
  due_after_days   smallint not null default 0 check (due_after_days between 0 and 60),
  due_time         time,
  starts_on        date not null default current_date,
  ends_on          date,
  all_department   boolean not null default false,
  staff_ids        uuid[] not null default '{}' check (cardinality(staff_ids) <= 100),
  active           boolean not null default true,
  created_by       uuid references ops.staff (id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint task_recurrence_weekly_day check (frequency <> 'weekly' or weekday is not null),
  constraint task_recurrence_monthly_day check (frequency <> 'monthly' or month_day is not null),
  constraint task_recurrence_dates check (ends_on is null or ends_on >= starts_on)
);
create index task_recurrence_department_idx on ops.task_recurrence (department, active);
create index task_recurrence_created_by_idx on ops.task_recurrence (created_by);
create trigger t_task_recurrence_upd before update on ops.task_recurrence
  for each row execute function ops.touch_updated_at();

alter table ops.task
  add constraint task_recurrence_fk foreign key (recurrence_id) references ops.task_recurrence (id) on delete set null;
create unique index task_recurrence_period_idx on ops.task (recurrence_id, assignee_id, period_start);

create or replace function ops.task_recurrence_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.title := btrim(new.title);
  if new.frequency <> 'weekly' then new.weekday := null; end if;
  if new.frequency <> 'monthly' then new.month_day := null; end if;
  if not new.all_department and cardinality(new.staff_ids) = 0 then
    raise exception 'Choose the whole department or at least one person';
  end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
create trigger t_task_recurrence_guard before insert or update on ops.task_recurrence
  for each row execute function ops.task_recurrence_guard();

alter table ops.task_recurrence enable row level security;
create policy task_recurrence_sel on ops.task_recurrence for select to authenticated
  using (department = any ((select ops.my_departments())::ops.department[]));
create policy task_recurrence_ins on ops.task_recurrence for insert to authenticated
  with check ((select ops.my_role()) in ('founder', 'dept_lead')
              and department = any ((select ops.my_departments())::ops.department[]));
create policy task_recurrence_upd on ops.task_recurrence for update to authenticated
  using ((select ops.my_role()) in ('founder', 'dept_lead')
         and department = any ((select ops.my_departments())::ops.department[]))
  with check ((select ops.my_role()) in ('founder', 'dept_lead')
              and department = any ((select ops.my_departments())::ops.department[]));
create policy task_recurrence_del on ops.task_recurrence for delete to authenticated
  using ((select ops.my_role()) in ('founder', 'dept_lead')
         and department = any ((select ops.my_departments())::ops.department[]));

-- ---------------------------------------------------------------- saved views
create table ops.task_view (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references ops.staff (id) on delete cascade default auth.uid(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  query      text not null default '' check (length(query) <= 500),
  shared     boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

create or replace function ops.task_view_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.owner_id := auth.uid(); end if;
  else
    new.owner_id := old.owner_id;
  end if;
  return new;
end $$;
create trigger t_task_view_guard before insert or update on ops.task_view
  for each row execute function ops.task_view_guard();

alter table ops.task_view enable row level security;
create policy task_view_sel on ops.task_view for select to authenticated
  using (owner_id = (select auth.uid()) or (shared and (select ops.is_internal())));
create policy task_view_ins on ops.task_view for insert to authenticated
  with check ((select ops.is_internal()) and owner_id = (select auth.uid()));
create policy task_view_upd on ops.task_view for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy task_view_del on ops.task_view for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------- comments: mentions
alter table ops.task_comment
  add column mentions uuid[] not null default '{}' check (cardinality(mentions) <= 10);

create or replace function ops.task_comment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.body := btrim(new.body);
  if auth.uid() is not null then new.author_id := auth.uid(); end if;
  new.mentions := coalesce((
    select (array_agg(s.id order by s.id))[1:10] from ops.staff s
    where s.id = any (new.mentions) and s.is_active and s.role <> 'partner' and s.id <> new.author_id), '{}');
  return new;
end $$;

-- ---------------------------------------------------------------- guard (0018 plus start date, stamps, system jobs)
create or replace function ops.task_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid     uuid := case when ops.is_system() then null else auth.uid() end;
  mgr     boolean;
  a       record;
  p       record;
begin
  new.title := btrim(new.title);
  if new.title = '' then raise exception 'A task needs a title'; end if;
  if new.due_date is null then new.due_time := null; end if;
  if new.start_date is not null and new.due_date is not null and new.start_date > new.due_date then
    raise exception 'The start date cannot be after the deadline';
  end if;

  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    select s.role, s.is_active into a from ops.staff s where s.id = new.assignee_id;
    if not found or not a.is_active then raise exception 'Choose an active team member to assign this task to'; end if;
    if a.role = 'viewer' then raise exception 'A viewer cannot be given tasks'; end if;
    if a.role = 'partner' and coalesce(new.template, '') <> 'follow_up' then
      raise exception 'Partners can only be given follow-up tasks';
    end if;
  end if;

  if new.parent_task_id is not null and (tg_op = 'INSERT' or new.parent_task_id is distinct from old.parent_task_id) then
    if new.parent_task_id = new.id then raise exception 'A task cannot be its own subtask'; end if;
    select t.parent_task_id, t.status into p from ops.task t where t.id = new.parent_task_id;
    if not found then raise exception 'The parent task was not found'; end if;
    if p.parent_task_id is not null then raise exception 'A subtask cannot have subtasks'; end if;
    if p.status in ('done', 'cancelled') then raise exception 'Add subtasks to an open task'; end if;
    if tg_op = 'UPDATE' and exists (select 1 from ops.task c where c.parent_task_id = new.id) then
      raise exception 'A task with subtasks cannot become a subtask';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'todo' then raise exception 'A new task starts as To do'; end if;
    if uid is not null then new.created_by := uid; end if;
    new.completed_at := null;
    new.completed_by := null;
    new.blocked_reason := null;
    new.cancel_reason := null;
    if uid is not null then
      new.recurrence_id := null;
      new.period_start := null;
    end if;
    if uid is not null or new.assignee_id is null then new.accepted_at := null; end if;
    if new.assignee_id is not null then
      new.assigned_by := coalesce(uid, new.created_by);
      new.assigned_at := now();
      if new.assignee_id = uid then new.accepted_at := now(); end if;
    else
      new.assigned_by := null;
      new.assigned_at := null;
    end if;
    return new;
  end if;

  -- stamps are never taken from the caller
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.assigned_by := old.assigned_by;
  new.assigned_at := old.assigned_at;
  new.completed_at := old.completed_at;
  new.completed_by := old.completed_by;
  new.recurrence_id := old.recurrence_id;
  new.period_start := old.period_start;

  mgr := uid is null
         or ops.is_founder()
         or old.created_by = uid
         or (ops.my_role() = 'dept_lead' and ops.in_dept(old.department));

  if not mgr and (new.title is distinct from old.title
                  or new.description is distinct from old.description
                  or new.department is distinct from old.department
                  or new.entity_type is distinct from old.entity_type
                  or new.entity_id is distinct from old.entity_id
                  or new.parent_task_id is distinct from old.parent_task_id) then
    raise exception 'Only the person who created this task, a department lead or a founder can edit its details';
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    if not mgr
       and not (new.assignee_id is null and old.assignee_id = uid)
       and not (old.assignee_id is null and new.assignee_id = uid) then
      raise exception 'Only the person who assigned this task, a department lead or a founder can reassign it';
    end if;
    new.assigned_by := uid;
    new.assigned_at := case when new.assignee_id is null then null else now() end;
    new.accepted_at := case when new.assignee_id is not null and new.assignee_id = uid then now() else null end;
  elsif new.accepted_at is distinct from old.accepted_at then
    if new.accepted_at is null then
      new.accepted_at := old.accepted_at;
    elsif uid is not null and uid is distinct from new.assignee_id then
      raise exception 'Only the assignee can accept a task';
    else
      new.accepted_at := coalesce(old.accepted_at, now());
    end if;
  end if;

  if new.status is distinct from old.status then
    if old.status in ('done', 'cancelled') and not (mgr or old.completed_by = uid) then
      raise exception 'Only a lead, a founder, or the person who created or finished this task can reopen it';
    end if;
    if old.status = 'done' and new.status not in ('todo', 'doing') then
      raise exception 'A finished task can only be reopened';
    end if;
    if old.status = 'cancelled' and new.status <> 'todo' then
      raise exception 'A cancelled task can only be reopened';
    end if;
    if new.status = 'blocked' and coalesce(btrim(new.blocked_reason), '') = '' then
      raise exception 'Say what is blocking this task';
    end if;
    if new.status = 'cancelled' and coalesce(btrim(new.cancel_reason), '') = '' then
      raise exception 'Say why the task is cancelled';
    end if;
    if new.status in ('done', 'cancelled')
       and exists (select 1 from ops.task c where c.parent_task_id = new.id and c.status in ('todo', 'doing', 'blocked')) then
      raise exception 'Finish or cancel the subtasks first';
    end if;
    if new.status = 'done' then
      new.completed_at := now();
      new.completed_by := uid;
    elsif old.status = 'done' then
      new.completed_at := null;
      new.completed_by := null;
    end if;
    if new.status in ('doing', 'done') and new.accepted_at is null and new.assignee_id is not null and new.assignee_id = uid then
      new.accepted_at := now();
    end if;
  end if;

  if new.status <> 'blocked' then new.blocked_reason := null; end if;
  if new.status <> 'cancelled' then new.cancel_reason := null; end if;
  return new;
end $$;

-- ---------------------------------------------------------------- history (0018 plus start date, system actor)
create or replace function ops.task_history_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := case when ops.is_system() then null else auth.uid() end;
  who text;
  was text;
begin
  if tg_op = 'INSERT' then
    insert into ops.task_history (task_id, actor_id, kind) values (new.id, coalesce(uid, new.created_by), 'created');
    if new.assignee_id is not null then
      select full_name into who from ops.staff where id = new.assignee_id;
      insert into ops.task_history (task_id, actor_id, kind, to_value) values (new.id, coalesce(uid, new.created_by), 'assigned', who);
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value, note)
    values (new.id, uid, 'status', old.status, new.status, coalesce(new.blocked_reason, new.cancel_reason));
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    select full_name into was from ops.staff where id = old.assignee_id;
    select full_name into who from ops.staff where id = new.assignee_id;
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value) values (new.id, uid, 'assigned', was, who);
  end if;
  if new.start_date is distinct from old.start_date then
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value)
    values (new.id, uid, 'start', old.start_date::text, new.start_date::text);
  end if;
  if new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time then
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value)
    values (new.id, uid,
            'due',
            nullif(concat_ws(' ', old.due_date::text, to_char(old.due_time, 'HH24:MI')), ''),
            nullif(concat_ws(' ', new.due_date::text, to_char(new.due_time, 'HH24:MI')), ''));
  end if;
  if new.priority is distinct from old.priority then
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value)
    values (new.id, uid, 'priority', old.priority::text, new.priority::text);
  end if;
  if new.department is distinct from old.department then
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value)
    values (new.id, uid, 'department', old.department::text, new.department::text);
  end if;
  if new.title is distinct from old.title or new.description is distinct from old.description
     or new.estimate_minutes is distinct from old.estimate_minutes then
    insert into ops.task_history (task_id, actor_id, kind) values (new.id, uid, 'edited');
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- watchers and notifications on task changes
create or replace function ops.task_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid   uuid := case when ops.is_system() then null else auth.uid() end;
  who   text := coalesce((select full_name from ops.staff where id = uid), 'Someone');
  t     text := left(new.title, 80);
  what  text;
  r     uuid;
begin
  if tg_op = 'INSERT' then
    perform ops.auto_watch(new.id, new.created_by, null);
    if new.assignee_id is not null then
      perform ops.auto_watch(new.id, new.assignee_id, uid);
      if uid is null then
        perform ops.notify(new.assignee_id, 'recurring', new.id, null, 'Your fixed task is ready: ' || t);
      else
        perform ops.notify(new.assignee_id, 'assigned', new.id, uid, who || ' gave you a task: ' || t);
      end if;
    end if;
    return new;
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    if new.assignee_id is not null then
      perform ops.auto_watch(new.id, new.assignee_id, uid);
      perform ops.notify(new.assignee_id, 'assigned', new.id, uid, who || ' gave you a task: ' || t);
    end if;
    perform ops.notify(old.assignee_id, 'assigned', new.id, uid, who || ' took you off: ' || t);
  end if;

  if new.status is distinct from old.status then
    what := case new.status
      when 'done' then 'marked it done'
      when 'doing' then case when old.status in ('done', 'cancelled') then 'reopened it' else 'started it' end
      when 'blocked' then 'marked it blocked: ' || coalesce(new.blocked_reason, '')
      when 'cancelled' then 'cancelled it: ' || coalesce(new.cancel_reason, '')
      else case when old.status in ('done', 'cancelled') then 'reopened it' else 'moved it back to to do' end
    end;
    for r in select staff_id from ops.task_watcher where task_id = new.id loop
      perform ops.notify(r, 'status', new.id, uid, who || ' ' || what || ' (' || t || ')');
    end loop;
  end if;

  if new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time
     or new.start_date is distinct from old.start_date then
    for r in select staff_id from ops.task_watcher where task_id = new.id loop
      perform ops.notify(r, 'dates', new.id, uid,
        who || ' changed the dates of ' || t || ': ' ||
        coalesce(to_char(new.start_date, 'DD Mon'), 'no start') || ' to ' || coalesce(to_char(new.due_date, 'DD Mon'), 'no deadline'));
    end loop;
  end if;
  return new;
end $$;

create or replace function ops.task_comment_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text := coalesce((select full_name from ops.staff where id = new.author_id), 'Someone');
  t   text := (select left(title, 80) from ops.task where id = new.task_id);
  r   uuid;
begin
  perform ops.auto_watch(new.task_id, new.author_id, new.author_id);
  foreach r in array new.mentions loop
    perform ops.auto_watch(new.task_id, r, new.author_id);
    perform ops.notify(r, 'mentioned', new.task_id, new.author_id, who || ' mentioned you on ' || t);
  end loop;
  for r in select staff_id from ops.task_watcher
           where task_id = new.task_id and staff_id <> new.author_id and not (staff_id = any (new.mentions)) loop
    perform ops.notify(r, 'comment', new.task_id, new.author_id, who || ' commented on ' || t);
  end loop;
  return new;
end $$;

create trigger t_task_notify after insert or update on ops.task
  for each row execute function ops.task_notify();
create trigger t_task_comment_notify after insert on ops.task_comment
  for each row execute function ops.task_comment_notify();

-- ---------------------------------------------------------------- automation (fixed tasks + reminders)
-- Safe to call any number of times. The app calls it (at most every few minutes per person); pg_cron or an
-- Edge Function can call it too. Each fixed task is created once per person and period.
create or replace function ops.run_task_recurrences() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  today  date := (now() at time zone 'Asia/Kolkata')::date;
  r      record;
  s      record;
  period date;
  made   integer := 0;
  n      integer;
begin
  perform set_config('ops.system_job', '1', true);
  for r in select * from ops.task_recurrence
           where active and starts_on <= today and (ends_on is null or ends_on >= today) loop
    period := case r.frequency
      when 'daily' then today
      when 'weekdays' then today - greatest(extract(isodow from today)::int - 5, 0)
      when 'weekly' then today - ((extract(isodow from today)::int - r.weekday + 7) % 7)
      else case when extract(day from today)::int >= r.month_day
                then date_trunc('month', today::timestamp)::date + (r.month_day - 1)
                else (date_trunc('month', today::timestamp) - interval '1 month')::date + (r.month_day - 1) end
    end;
    continue when period < r.starts_on;
    for s in select st.id from ops.staff st
             where st.is_active and st.role not in ('partner', 'viewer')
               and ((r.all_department and r.department = any (st.departments)) or st.id = any (r.staff_ids)) loop
      insert into ops.task (department, template, title, description, priority, estimate_minutes, assignee_id,
                            start_date, due_date, due_time, created_by, accepted_at, recurrence_id, period_start)
      values (r.department, 'fixed', r.title, r.description, r.priority, r.estimate_minutes, s.id,
              period, period + r.due_after_days, r.due_time, r.created_by, now(), r.id, period)
      on conflict (recurrence_id, assignee_id, period_start) do nothing;
      get diagnostics n = row_count;
      made := made + n;
    end loop;
  end loop;
  perform set_config('ops.system_job', '', true);
  return made;
end $$;

create or replace function ops.run_task_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  r     record;
  w     uuid;
  sent  integer := 0;
begin
  for r in select id, left(title, 80) as t, assignee_id, due_date from ops.task
           where status in ('todo', 'doing', 'blocked') and assignee_id is not null
             and due_date <= today and due_date >= today - 60 loop
    if r.due_date = today then
      if ops.notify(r.assignee_id, 'due_today', r.id, null, 'Due today: ' || r.t, 'due:' || r.id || ':' || r.due_date) then
        sent := sent + 1;
      end if;
    else
      if ops.notify(r.assignee_id, 'overdue', r.id, null,
                    'Overdue since ' || to_char(r.due_date, 'DD Mon') || ': ' || r.t, 'overdue:' || r.id || ':' || r.due_date) then
        sent := sent + 1;
      end if;
      for w in select staff_id from ops.task_watcher where task_id = r.id and staff_id <> r.assignee_id loop
        if ops.notify(w, 'overdue', r.id, null,
                      'Overdue since ' || to_char(r.due_date, 'DD Mon') || ': ' || r.t, 'overdue:' || r.id || ':' || r.due_date) then
          sent := sent + 1;
        end if;
      end loop;
    end if;
  end loop;
  return sent;
end $$;

create or replace function ops.run_task_automation() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare made integer; sent integer;
begin
  made := ops.run_task_recurrences();
  sent := ops.run_task_reminders();
  return jsonb_build_object('created', made, 'reminders', sent);
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.task_manager(uuid), ops.is_watching(uuid) to authenticated, service_role;
grant execute on function ops.run_task_automation() to authenticated, service_role;
