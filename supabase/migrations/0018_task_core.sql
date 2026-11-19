-- 0018 task core (team collaboration, slice A)
-- 1. ops.task grows from a flat to-do into a real work item: description, due time, estimate, one level of
--    subtasks, who assigned it and when, accepted, blocked and cancel reasons, who finished it and when.
-- 2. Anyone internal can create a task and assign it to any active colleague, in any department (the department is
--    the queue that owns it). RLS lets the creator see and update what they created.
-- 3. ops.task_guard enforces the rules: one owner, a legal status path, reasons for blocked and cancelled, subtasks
--    finished first, stamps (created_by, assigned_by, completed_by) set by the database and never by the client,
--    and who may edit details, reassign or reopen.
-- 4. ops.task_history is a readable timeline written by trigger (audit_log is founder-only).
-- 5. ops.task_comment: discussion on a task, visible to whoever can see the task.

alter table ops.task
  add column description      text check (description is null or length(description) <= 4000),
  add column due_time         time,
  add column estimate_minutes integer check (estimate_minutes is null or estimate_minutes between 1 and 6000),
  add column parent_task_id   uuid references ops.task (id) on delete cascade,
  add column assigned_by      uuid references ops.staff (id),
  add column assigned_at      timestamptz,
  add column accepted_at      timestamptz,
  add column blocked_reason   text check (blocked_reason is null or length(blocked_reason) <= 500),
  add column cancel_reason    text check (cancel_reason is null or length(cancel_reason) <= 500),
  add column completed_at     timestamptz,
  add column completed_by     uuid references ops.staff (id),
  add constraint task_due_time_needs_date check (due_time is null or due_date is not null),
  add constraint task_title_not_blank check (length(btrim(title)) > 0) not valid;

update ops.task set completed_at = updated_at where status = 'done';
update ops.task set assigned_by = created_by, assigned_at = created_at where assignee_id is not null;

create index task_department_status_due_idx on ops.task (department, status, due_date);
create index task_parent_idx on ops.task (parent_task_id) where parent_task_id is not null;
create index task_created_by_idx on ops.task (created_by);
create index task_assigned_by_idx on ops.task (assigned_by);
create index task_completed_by_idx on ops.task (completed_by);

-- ---------------------------------------------------------------- history and comments
create table ops.task_history (
  id         bigint generated always as identity primary key,
  task_id    uuid not null references ops.task (id) on delete cascade,
  actor_id   uuid references ops.staff (id),
  kind       text not null check (kind in ('created', 'assigned', 'status', 'due', 'priority', 'department', 'edited')),
  from_value text,
  to_value   text,
  note       text,
  at         timestamptz not null default now()
);
create index task_history_task_idx on ops.task_history (task_id, at);
create index task_history_actor_idx on ops.task_history (actor_id);

create table ops.task_comment (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references ops.task (id) on delete cascade,
  author_id  uuid not null references ops.staff (id) default auth.uid(),
  body       text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index task_comment_task_idx on ops.task_comment (task_id, created_at);
create index task_comment_author_idx on ops.task_comment (author_id);

-- ---------------------------------------------------------------- guard
create or replace function ops.task_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid     uuid := auth.uid();
  mgr     boolean;
  a       record;
  p       record;
begin
  new.title := btrim(new.title);
  if new.title = '' then raise exception 'A task needs a title'; end if;
  if new.due_date is null then new.due_time := null; end if;

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
    new.accepted_at := null;
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

create trigger t_task_guard before insert or update on ops.task
  for each row execute function ops.task_guard();

-- ---------------------------------------------------------------- history
create or replace function ops.task_history_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  who text;
  was text;
begin
  if tg_op = 'INSERT' then
    insert into ops.task_history (task_id, actor_id, kind) values (new.id, uid, 'created');
    if new.assignee_id is not null then
      select full_name into who from ops.staff where id = new.assignee_id;
      insert into ops.task_history (task_id, actor_id, kind, to_value) values (new.id, uid, 'assigned', who);
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

create trigger t_task_history after insert or update on ops.task
  for each row execute function ops.task_history_write();

create or replace function ops.task_comment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.body := btrim(new.body);
  if auth.uid() is not null then new.author_id := auth.uid(); end if;
  return new;
end $$;

create trigger t_task_comment_guard before insert on ops.task_comment
  for each row execute function ops.task_comment_guard();

-- ---------------------------------------------------------------- RLS
drop policy task_ins on ops.task;
drop policy task_upd on ops.task;
create policy task_ins on ops.task for insert to authenticated
  with check ((select ops.can_write())
              and ((select ops.is_internal()) or assignee_id = (select auth.uid())));
create policy task_upd on ops.task for update to authenticated
  using ((select ops.can_write())
         and (department = any ((select ops.my_departments())::ops.department[])
              or assignee_id = (select auth.uid()) or created_by = (select auth.uid())))
  with check ((select ops.can_write())
              and (department = any ((select ops.my_departments())::ops.department[])
                   or assignee_id = (select auth.uid()) or created_by = (select auth.uid())));

alter table ops.task_history enable row level security;
create policy task_history_sel on ops.task_history for select to authenticated
  using (exists (select 1 from ops.task t where t.id = task_id));

alter table ops.task_comment enable row level security;
create policy task_comment_sel on ops.task_comment for select to authenticated
  using (exists (select 1 from ops.task t where t.id = task_id));
create policy task_comment_ins on ops.task_comment for insert to authenticated
  with check ((select ops.can_write())
              and author_id = (select auth.uid())
              and exists (select 1 from ops.task t where t.id = task_id));
create policy task_comment_del on ops.task_comment for delete to authenticated
  using (author_id = (select auth.uid()) or (select ops.is_founder()));

revoke execute on all functions in schema ops from public;
