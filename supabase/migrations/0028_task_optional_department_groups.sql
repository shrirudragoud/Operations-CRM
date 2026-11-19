-- 0028: Tasks without a department, a category, and one task per person for several assignees.
--
-- 1. ops.task.department becomes optional. A task with no department is seen by its assignee, its creator, its
--    watchers, the founder and a department lead who leads the assignee. That lead can also edit and delete it.
-- 2. ops.task.category ('internal' | 'other'): a separate label, not a new department.
-- 3. ops.task.group_id: tasks given to several people at once are one task per person (own status, deadline,
--    time and timeliness), linked by a group id. Only ops.create_task_group() can set it.
-- 4. ops.create_task_group / update_task_group / cancel_task_group: all-or-nothing group actions.
-- 5. ops.backlog_snapshot.department becomes optional too, so the nightly snapshot keeps counting that work.

-- ---------------------------------------------------------------- columns
alter table ops.task alter column department drop not null;
alter table ops.task add column category text check (category in ('internal', 'other'));
alter table ops.task add column group_id uuid;
create index task_group_idx on ops.task (group_id) where group_id is not null;

alter table ops.backlog_snapshot alter column department drop not null;
drop index ops.backlog_snapshot_key;
create unique index backlog_snapshot_key on ops.backlog_snapshot
  (snapshot_date, department, coalesce(assignee_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where department is not null;
create unique index backlog_snapshot_key_nodept on ops.backlog_snapshot
  (snapshot_date, coalesce(assignee_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where department is null;

-- ---------------------------------------------------------------- who can manage a task
-- A department lead manages a task with no department when they lead its assignee (never their own task).
create or replace function ops.leads_task_assignee(p_assignee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_assignee is not null
     and p_assignee is distinct from auth.uid()
     and ops.my_role() = 'dept_lead'
     and exists (select 1 from ops.staff s
                 where s.id = p_assignee and s.departments && ops.my_departments())
$$;

create or replace function ops.task_manager(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.task t
                 where t.id = p_task
                   and (ops.is_founder()
                        or t.created_by = auth.uid()
                        or (ops.my_role() = 'dept_lead'
                            and (ops.in_dept(t.department)
                                 or (t.department is null and ops.leads_task_assignee(t.assignee_id))))))
$$;

drop policy task_sel on ops.task;
create policy task_sel on ops.task for select to authenticated
  using (department = any ((select ops.my_departments())::ops.department[])
         or assignee_id = (select auth.uid())
         or created_by = (select auth.uid())
         or (select ops.is_watching(id))
         or (department is null and ((select ops.is_founder()) or (select ops.leads_task_assignee(assignee_id)))));

drop policy task_upd on ops.task;
create policy task_upd on ops.task for update to authenticated
  using ((select ops.can_write())
         and (department = any ((select ops.my_departments())::ops.department[])
              or assignee_id = (select auth.uid())
              or created_by = (select auth.uid())
              or (department is null and ((select ops.is_founder()) or (select ops.leads_task_assignee(assignee_id))))))
  with check ((select ops.can_write())
         and (department = any ((select ops.my_departments())::ops.department[])
              or assignee_id = (select auth.uid())
              or created_by = (select auth.uid())
              or (department is null and ((select ops.is_founder()) or (select ops.leads_task_assignee(assignee_id))))));

drop policy task_del on ops.task;
create policy task_del on ops.task for delete to authenticated
  using (((department = any ((select ops.my_departments())::ops.department[]))
          and (select ops.my_role()) in ('founder', 'dept_lead'))
         or (department is null and (select ops.is_founder()))
         or (department is null and (select ops.leads_task_assignee(assignee_id))));

-- ---------------------------------------------------------------- guard: category, group link, null department
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
    if coalesce(current_setting('ops.task_rpc', true), '') <> '1' then new.group_id := null; end if;
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
  new.group_id := old.group_id;

  mgr := uid is null
         or ops.is_founder()
         or old.created_by = uid
         or (ops.my_role() = 'dept_lead'
             and (ops.in_dept(old.department)
                  or (old.department is null and ops.leads_task_assignee(old.assignee_id))));

  if not mgr and (new.title is distinct from old.title
                  or new.description is distinct from old.description
                  or new.department is distinct from old.department
                  or new.category is distinct from old.category
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

-- ---------------------------------------------------------------- group actions
-- One task per person, all or nothing. One person is an ordinary task with no group.
create or replace function ops.create_task_group(
  title text,
  assignees uuid[],
  description text default null,
  priority integer default 3,
  due_date date default null,
  due_time time default null,
  start_date date default null,
  estimate_minutes integer default null,
  department ops.department default null,
  category text default null)
returns uuid[]
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare
  uid   uuid := auth.uid();
  ppl   uuid[];
  gid   uuid;
  who   uuid;
  new_id uuid;
  ids   uuid[] := '{}';
  was   text := coalesce(current_setting('ops.task_rpc', true), '');
begin
  if uid is null or not ops.can_write() or not ops.is_internal() then
    raise exception 'Your role cannot create tasks for the team';
  end if;
  if coalesce(btrim(title), '') = '' then raise exception 'A task needs a title'; end if;

  select array_agg(x.a order by x.first_at) into ppl
    from (select a, min(o) as first_at from unnest(assignees) with ordinality u(a, o) where a is not null group by a) x;
  if ppl is null or cardinality(ppl) = 0 then raise exception 'Choose at least one person'; end if;
  if cardinality(ppl) > 20 then raise exception 'A task can be given to at most 20 people at once'; end if;

  if cardinality(ppl) > 1 then gid := gen_random_uuid(); end if;
  perform set_config('ops.task_rpc', '1', true);
  foreach who in array ppl loop
    insert into ops.task (title, description, priority, due_date, due_time, start_date, estimate_minutes,
                          department, category, assignee_id, group_id)
    values (title, description, priority, due_date, due_time, start_date, estimate_minutes,
            department, category, who, gid)
    returning id into new_id;
    ids := ids || new_id;
  end loop;
  perform set_config('ops.task_rpc', was, true);
  return ids;
end $$;

-- Is the caller the creator of this task's group (or a founder)? Raises if the task is not in a group.
create or replace function ops.group_owner_check(p_task uuid, p_what text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare g uuid; c uuid;
begin
  select t.group_id, t.created_by into g, c from ops.task t where t.id = p_task;
  if not found then raise exception 'The task was not found'; end if;
  if g is null then raise exception 'This task was not given to several people'; end if;
  if not (ops.is_founder() or (c is not null and c = auth.uid())) then
    raise exception 'Only the person who created this group of tasks, or a founder, can % for everyone', p_what;
  end if;
  return g;
end $$;

-- Shared details only. Finished and cancelled tasks keep their record; status, deadline and estimate stay per person.
create or replace function ops.update_task_group(
  p_task uuid,
  title text default null,
  description text default null,
  priority integer default null,
  department ops.department default null,
  category text default null)
returns integer
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare g uuid; n integer;
begin
  g := ops.group_owner_check(p_task, 'change it');
  if title is not null and btrim(title) = '' then raise exception 'A task needs a title'; end if;
  update ops.task t set
         title       = coalesce(btrim(title), t.title),
         description = coalesce(description, t.description),
         priority    = coalesce(priority, t.priority),
         department  = coalesce(department, t.department),
         category    = coalesce(category, t.category)
   where t.group_id = g and t.status in ('todo', 'doing', 'blocked');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function ops.cancel_task_group(p_task uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare g uuid; n integer;
begin
  g := ops.group_owner_check(p_task, 'cancel it');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the tasks are cancelled'; end if;
  update ops.task c set status = 'cancelled', cancel_reason = btrim(p_reason)
   where c.parent_task_id in (select id from ops.task where group_id = g)
     and c.status in ('todo', 'doing', 'blocked');
  update ops.task t set status = 'cancelled', cancel_reason = btrim(p_reason)
   where t.group_id = g and t.status in ('todo', 'doing', 'blocked');
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.leads_task_assignee(uuid),
                          ops.create_task_group(text, uuid[], text, integer, date, time, date, integer, ops.department, text),
                          ops.update_task_group(uuid, text, text, integer, ops.department, text),
                          ops.cancel_task_group(uuid, text) to authenticated, service_role;
