-- 0038: shared tasks (one task, several owners), read-only access to a parent task for the people holding its
-- subtasks, and a counts-only progress summary for a group of per-person copies.
--
-- 1. ops.task.shared + ops.task_owner: ONE task row with several owners, finished when ANY owner finishes it.
--    The "each does their own" model (a copy per person linked by group_id, 0028) is unchanged. For a shared task
--    assignee_id is the primary (first) owner, and every owner including the primary has a task_owner row.
--    Owners are written only by ops.create_shared_task / add_task_owner / remove_task_owner (no DML policy).
-- 2. A co-owner counts as an assignee: sees the task, may update its status, accept it, comment, track time, is
--    watching it, is notified of changes and gets due and overdue reminders. A department lead who leads a
--    co-owner manages a department-less shared task, just as for a primary assignee.
-- 3. The assignee or a co-owner of a SUBTASK can read the parent and the sibling subtasks (task rows only).
--    Comments, history, watchers and time on those tasks stay hidden: those tables now ask ops.sees_task_fully(),
--    which is the task read rule WITHOUT the subtask-holder path. Nothing about UPDATE or DELETE widens.
-- 4. ops.task_group_progress(group): counts only, for anyone who can see at least one copy of the group.

-- ---------------------------------------------------------------- columns and table
alter table ops.task add column shared boolean not null default false;
alter table ops.task add constraint task_shared_no_group check (not shared or group_id is null);

create table ops.task_owner (
  task_id  uuid not null references ops.task (id) on delete cascade,
  staff_id uuid not null references ops.staff (id) on delete cascade,
  added_by uuid references ops.staff (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (task_id, staff_id)
);
create index task_owner_staff_idx on ops.task_owner (staff_id);
create index task_owner_added_by_idx on ops.task_owner (added_by);

-- ---------------------------------------------------------------- helpers
create or replace function ops.is_task_owner(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.task_owner o where o.task_id = p_task and o.staff_id = auth.uid())
$$;

-- A department lead who leads at least one owner (never counting themselves) of a shared task.
create or replace function ops.leads_task_owners(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select ops.my_role() = 'dept_lead'
     and exists (select 1 from ops.task_owner o join ops.staff s on s.id = o.staff_id
                 where o.task_id = p_task and o.staff_id <> auth.uid()
                   and s.departments && ops.my_departments())
$$;

-- Does the caller hold (as assignee or co-owner) a subtask of this parent?
create or replace function ops.holds_subtask_of(p_parent uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.task c
                 where c.parent_task_id = p_parent
                   and (c.assignee_id = auth.uid()
                        or exists (select 1 from ops.task_owner o where o.task_id = c.id and o.staff_id = auth.uid())))
$$;

-- The full task read rule: everything task_sel allows except the subtask-holder paths. Comments, history,
-- watchers, owners and time hang off this, so reading a parent through a subtask never opens them.
create or replace function ops.sees_task_fully(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.task t
                 where t.id = p_task
                   and (t.department = any (ops.my_departments())
                        or t.assignee_id = auth.uid()
                        or t.created_by = auth.uid()
                        or ops.is_watching(t.id)
                        or ops.is_task_owner(t.id)
                        or (t.department is null
                            and (ops.is_founder() or ops.leads_task_assignee(t.assignee_id) or ops.leads_task_owners(t.id)))))
$$;

-- Who may be given a task (same rules the guard applies to the primary assignee).
create or replace function ops.check_task_person(p_staff uuid, p_template text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare a record;
begin
  select s.role, s.is_active into a from ops.staff s where s.id = p_staff;
  if not found or not a.is_active then raise exception 'Choose an active team member to assign this task to'; end if;
  if a.role = 'viewer' then raise exception 'A viewer cannot be given tasks'; end if;
  if a.role = 'partner' and coalesce(p_template, '') <> 'follow_up' then
    raise exception 'Partners can only be given follow-up tasks';
  end if;
end $$;

create or replace function ops.task_manager(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.task t
                 where t.id = p_task
                   and (ops.is_founder()
                        or t.created_by = auth.uid()
                        or (ops.my_role() = 'dept_lead'
                            and (ops.in_dept(t.department)
                                 or (t.department is null
                                     and (ops.leads_task_assignee(t.assignee_id) or ops.leads_task_owners(t.id)))))))
$$;

-- ---------------------------------------------------------------- policies on ops.task
drop policy task_sel on ops.task;
create policy task_sel on ops.task for select to authenticated
  using (department = any ((select ops.my_departments())::ops.department[])
         or assignee_id = (select auth.uid())
         or created_by = (select auth.uid())
         or (select ops.is_watching(id))
         or (select ops.is_task_owner(id))
         or (department is null and ((select ops.is_founder()) or (select ops.leads_task_assignee(assignee_id))
                                     or (select ops.leads_task_owners(id))))
         or (select ops.holds_subtask_of(id))
         or (parent_task_id is not null and (select ops.holds_subtask_of(parent_task_id))));

drop policy task_upd on ops.task;
create policy task_upd on ops.task for update to authenticated
  using ((select ops.can_write())
         and (department = any ((select ops.my_departments())::ops.department[])
              or assignee_id = (select auth.uid())
              or created_by = (select auth.uid())
              or (select ops.is_task_owner(id))
              or (department is null and ((select ops.is_founder()) or (select ops.leads_task_assignee(assignee_id))
                                          or (select ops.leads_task_owners(id))))))
  with check ((select ops.can_write())
         and (department = any ((select ops.my_departments())::ops.department[])
              or assignee_id = (select auth.uid())
              or created_by = (select auth.uid())
              or (select ops.is_task_owner(id))
              or (department is null and ((select ops.is_founder()) or (select ops.leads_task_assignee(assignee_id))
                                          or (select ops.leads_task_owners(id))))));

drop policy task_del on ops.task;
create policy task_del on ops.task for delete to authenticated
  using (((department = any ((select ops.my_departments())::ops.department[]))
          and (select ops.my_role()) in ('founder', 'dept_lead'))
         or (department is null and (select ops.is_founder()))
         or (department is null and (select ops.leads_task_assignee(assignee_id)))
         or (department is null and (select ops.leads_task_owners(id))));

-- ---------------------------------------------------------------- policies on tables that hang off a task
alter table ops.task_owner enable row level security;
create policy task_owner_sel on ops.task_owner for select to authenticated
  using ((select ops.sees_task_fully(task_id)));

drop policy task_history_sel on ops.task_history;
create policy task_history_sel on ops.task_history for select to authenticated
  using ((select ops.sees_task_fully(task_id)));

drop policy task_comment_sel on ops.task_comment;
create policy task_comment_sel on ops.task_comment for select to authenticated
  using ((select ops.sees_task_fully(task_id)));
drop policy task_comment_ins on ops.task_comment;
create policy task_comment_ins on ops.task_comment for insert to authenticated
  with check ((select ops.can_write())
              and author_id = (select auth.uid())
              and (select ops.sees_task_fully(task_id)));

drop policy task_watcher_sel on ops.task_watcher;
create policy task_watcher_sel on ops.task_watcher for select to authenticated
  using ((select ops.sees_task_fully(task_id)));
drop policy task_watcher_ins on ops.task_watcher;
create policy task_watcher_ins on ops.task_watcher for insert to authenticated
  with check ((select ops.can_write())
              and (select ops.sees_task_fully(task_id))
              and (staff_id = (select auth.uid()) or (select ops.task_manager(task_id))));

drop policy time_entry_ins on ops.time_entry;
create policy time_entry_ins on ops.time_entry for insert to authenticated
  with check ((select ops.can_track_time())
              and staff_id = (select auth.uid())
              and (select ops.sees_task_fully(task_id)));

-- ---------------------------------------------------------------- guard (0028 plus shared tasks)
create or replace function ops.task_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid     uuid := case when ops.is_system() then null else auth.uid() end;
  mgr     boolean;
  a       record;
  p       record;
  rpc     boolean := coalesce(current_setting('ops.task_rpc', true), '') = '1';
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
    if not rpc then
      new.group_id := null;
      new.shared := false;
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
  new.group_id := old.group_id;
  new.shared := old.shared;

  mgr := uid is null
         or ops.is_founder()
         or old.created_by = uid
         or (ops.my_role() = 'dept_lead'
             and (ops.in_dept(old.department)
                  or (old.department is null
                      and (ops.leads_task_assignee(old.assignee_id) or ops.leads_task_owners(old.id)))));

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
    if old.shared then
      -- owners of a shared task change only through its owner list, which keeps the stamps
      if not rpc then raise exception 'Change who owns a shared task from its list of owners'; end if;
      new.assigned_by := old.assigned_by;
      new.assigned_at := old.assigned_at;
      new.accepted_at := old.accepted_at;
    else
      if not mgr
         and not (new.assignee_id is null and old.assignee_id = uid)
         and not (old.assignee_id is null and new.assignee_id = uid) then
        raise exception 'Only the person who assigned this task, a department lead or a founder can reassign it';
      end if;
      new.assigned_by := uid;
      new.assigned_at := case when new.assignee_id is null then null else now() end;
      new.accepted_at := case when new.assignee_id is not null and new.assignee_id = uid then now() else null end;
    end if;
  elsif new.accepted_at is distinct from old.accepted_at then
    if new.accepted_at is null then
      new.accepted_at := old.accepted_at;
    elsif uid is not null and uid is distinct from new.assignee_id and not (new.shared and ops.is_task_owner(new.id)) then
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
    if new.status in ('doing', 'done') and new.accepted_at is null and uid is not null
       and ((new.assignee_id is not null and new.assignee_id = uid) or (new.shared and ops.is_task_owner(new.id))) then
      new.accepted_at := now();
    end if;
  end if;

  if new.status <> 'blocked' then new.blocked_reason := null; end if;
  if new.status <> 'cancelled' then new.cancel_reason := null; end if;
  return new;
end $$;

-- ---------------------------------------------------------------- notifications (0019 plus co-owners)
-- A shared task's assignee change (the primary moving to another owner) is announced by the owner RPCs instead.
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

  if new.assignee_id is distinct from old.assignee_id and not new.shared then
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
    for r in select w.staff_id from ops.task_watcher w where w.task_id = new.id
             union select o.staff_id from ops.task_owner o where o.task_id = new.id loop
      perform ops.notify(r, 'status', new.id, uid, who || ' ' || what || ' (' || t || ')');
    end loop;
  end if;

  if new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time
     or new.start_date is distinct from old.start_date then
    for r in select w.staff_id from ops.task_watcher w where w.task_id = new.id
             union select o.staff_id from ops.task_owner o where o.task_id = new.id loop
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
  for r in select x.staff_id
             from (select w.staff_id from ops.task_watcher w where w.task_id = new.task_id
                   union select o.staff_id from ops.task_owner o where o.task_id = new.task_id) x
            where x.staff_id <> new.author_id and not (x.staff_id = any (new.mentions)) loop
    perform ops.notify(r, 'comment', new.task_id, new.author_id, who || ' commented on ' || t);
  end loop;
  return new;
end $$;

-- Due today and overdue reminders reach every owner of a shared task, not only the primary.
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
      for w in select r.assignee_id union select o.staff_id from ops.task_owner o where o.task_id = r.id loop
        if ops.notify(w, 'due_today', r.id, null, 'Due today: ' || r.t, 'due:' || r.id || ':' || r.due_date) then
          sent := sent + 1;
        end if;
      end loop;
    else
      for w in select r.assignee_id
               union select o.staff_id from ops.task_owner o where o.task_id = r.id
               union select k.staff_id from ops.task_watcher k where k.task_id = r.id loop
        if ops.notify(w, 'overdue', r.id, null,
                      'Overdue since ' || to_char(r.due_date, 'DD Mon') || ': ' || r.t, 'overdue:' || r.id || ':' || r.due_date) then
          sent := sent + 1;
        end if;
      end loop;
    end if;
  end loop;
  return sent;
end $$;

-- ---------------------------------------------------------------- shared task RPCs
-- Same parameters as create_task_group. One task, 2 to 20 people, the first is the primary owner.
create or replace function ops.create_shared_task(
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
returns uuid
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare
  uid    uuid := auth.uid();
  ppl    uuid[];
  who    uuid;
  tid    uuid;
  nm     text;
  was    text := coalesce(current_setting('ops.task_rpc', true), '');
begin
  if uid is null or not ops.can_write() or not ops.is_internal() then
    raise exception 'Your role cannot create tasks for the team';
  end if;
  if coalesce(btrim(title), '') = '' then raise exception 'A task needs a title'; end if;

  select array_agg(x.a order by x.first_at) into ppl
    from (select a, min(o) as first_at from unnest(assignees) with ordinality u(a, o) where a is not null group by a) x;
  if ppl is null or cardinality(ppl) < 2 then raise exception 'A shared task needs at least two people'; end if;
  if cardinality(ppl) > 20 then raise exception 'A task can be shared by at most 20 people'; end if;
  foreach who in array ppl loop
    perform ops.check_task_person(who, null);
  end loop;

  perform set_config('ops.task_rpc', '1', true);
  insert into ops.task (title, description, priority, due_date, due_time, start_date, estimate_minutes,
                        department, category, assignee_id, shared)
  values (title, description, priority, due_date, due_time, start_date, estimate_minutes,
          department, category, ppl[1], true)
  returning id into tid;

  insert into ops.task_owner (task_id, staff_id, added_by) select tid, x, uid from unnest(ppl) x;

  nm := coalesce((select s.full_name from ops.staff s where s.id = uid), 'Someone');
  foreach who in array ppl[2:cardinality(ppl)] loop
    perform ops.auto_watch(tid, who, uid);
    perform ops.notify(who, 'assigned', tid, uid, nm || ' gave you a shared task: ' || left(title, 80));
    insert into ops.task_history (task_id, actor_id, kind, to_value)
    select tid, uid, 'assigned', s.full_name from ops.staff s where s.id = who;
  end loop;

  if uid = any (ppl) then
    update ops.task t set accepted_at = now() where t.id = tid and t.accepted_at is null;
  end if;
  perform set_config('ops.task_rpc', was, true);
  return tid;
end $$;

create or replace function ops.add_task_owner(p_task uuid, p_staff uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t   record;
  n   integer;
  nm  text;
begin
  select x.title, x.shared, x.status, x.template into t from ops.task x where x.id = p_task;
  if not found then raise exception 'The task was not found'; end if;
  if uid is null or not ops.can_write() or not ops.task_manager(p_task) then
    raise exception 'Only the person who created this task, a department lead or a founder can change its owners';
  end if;
  if not t.shared then raise exception 'This task is not shared'; end if;
  if t.status in ('done', 'cancelled') then raise exception 'Reopen the task before changing its owners'; end if;
  if exists (select 1 from ops.task_owner o where o.task_id = p_task and o.staff_id = p_staff) then
    raise exception 'That person already owns this task';
  end if;
  select count(*) into n from ops.task_owner o where o.task_id = p_task;
  if n >= 20 then raise exception 'A task can be shared by at most 20 people'; end if;
  perform ops.check_task_person(p_staff, t.template);

  insert into ops.task_owner (task_id, staff_id, added_by) values (p_task, p_staff, uid);
  nm := coalesce((select s.full_name from ops.staff s where s.id = uid), 'Someone');
  perform ops.auto_watch(p_task, p_staff, uid);
  perform ops.notify(p_staff, 'assigned', p_task, uid, nm || ' gave you a shared task: ' || left(t.title, 80));
  insert into ops.task_history (task_id, actor_id, kind, to_value)
  select p_task, uid, 'assigned', s.full_name from ops.staff s where s.id = p_staff;
end $$;

create or replace function ops.remove_task_owner(p_task uuid, p_staff uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t   record;
  n   integer;
  nxt uuid;
  nm  text;
  was text := coalesce(current_setting('ops.task_rpc', true), '');
begin
  select x.title, x.shared, x.status, x.assignee_id, x.created_by into t from ops.task x where x.id = p_task;
  if not found then raise exception 'The task was not found'; end if;
  if uid is null or not ops.can_write() or not ops.task_manager(p_task) then
    raise exception 'Only the person who created this task, a department lead or a founder can change its owners';
  end if;
  if not t.shared then raise exception 'This task is not shared'; end if;
  if t.status in ('done', 'cancelled') then raise exception 'Reopen the task before changing its owners'; end if;
  if not exists (select 1 from ops.task_owner o where o.task_id = p_task and o.staff_id = p_staff) then
    raise exception 'That person does not own this task';
  end if;
  select count(*) into n from ops.task_owner o where o.task_id = p_task;
  if n <= 2 then raise exception 'A shared task needs at least two owners'; end if;

  delete from ops.task_owner o where o.task_id = p_task and o.staff_id = p_staff;
  if p_staff is distinct from t.created_by then
    delete from ops.task_watcher w where w.task_id = p_task and w.staff_id = p_staff;
  end if;

  if t.assignee_id = p_staff then
    select o.staff_id into nxt from ops.task_owner o where o.task_id = p_task order by o.added_at, o.staff_id limit 1;
    perform set_config('ops.task_rpc', '1', true);
    update ops.task x set assignee_id = nxt where x.id = p_task;
    perform set_config('ops.task_rpc', was, true);
  else
    insert into ops.task_history (task_id, actor_id, kind, from_value)
    select p_task, uid, 'assigned', s.full_name from ops.staff s where s.id = p_staff;
  end if;

  nm := coalesce((select s.full_name from ops.staff s where s.id = uid), 'Someone');
  perform ops.notify(p_staff, 'assigned', p_task, uid, nm || ' took you off: ' || left(t.title, 80));
end $$;

-- ---------------------------------------------------------------- group progress (counts only)
-- total = done + open (cancelled copies are left out). Overdue means open with a deadline before today (India).
create or replace function ops.task_group_progress(p_group uuid)
returns table (total integer, done integer, open integer, overdue integer, people integer)
language sql stable security definer set search_path = '' as $$
  select (count(*) filter (where t.status <> 'cancelled'))::integer,
         (count(*) filter (where t.status = 'done'))::integer,
         (count(*) filter (where t.status in ('todo', 'doing', 'blocked')))::integer,
         (count(*) filter (where t.status in ('todo', 'doing', 'blocked') and t.due_date < ops.today_ist()))::integer,
         (count(distinct t.assignee_id) filter (where t.status <> 'cancelled'))::integer
    from ops.task t
   where t.group_id = p_group
  having coalesce(bool_or(ops.sees_task_fully(t.id)), false)
$$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.is_task_owner(uuid), ops.leads_task_owners(uuid), ops.holds_subtask_of(uuid),
                          ops.sees_task_fully(uuid), ops.task_manager(uuid),
                          ops.create_shared_task(text, uuid[], text, integer, date, time, date, integer, ops.department, text),
                          ops.add_task_owner(uuid, uuid), ops.remove_task_owner(uuid, uuid),
                          ops.task_group_progress(uuid) to authenticated, service_role;
