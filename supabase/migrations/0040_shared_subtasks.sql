-- 0040: a subtask can be shared by several people.
-- ops.create_shared_task gains an optional parent_task. The subtask rules (open parent, no nesting) are enforced by the
-- task guard as for any subtask; this adds who may attach one: someone who can read the parent in full, or who already
-- holds a subtask of it. The old signature is dropped so a call with named arguments never matches two functions.

drop function ops.create_shared_task(text, uuid[], text, integer, date, time, date, integer, ops.department, text);

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
  category text default null,
  parent_task uuid default null)
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

  if parent_task is not null
     and not (ops.sees_task_fully(parent_task) or ops.holds_subtask_of(parent_task)) then
    raise exception 'The parent task was not found';
  end if;

  perform set_config('ops.task_rpc', '1', true);
  insert into ops.task (title, description, priority, due_date, due_time, start_date, estimate_minutes,
                        department, category, assignee_id, shared, parent_task_id)
  values (title, description, priority, due_date, due_time, start_date, estimate_minutes,
          department, category, ppl[1], true, parent_task)
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

revoke execute on all functions in schema ops from public;
grant execute on function ops.create_shared_task(text, uuid[], text, integer, date, time, date, integer, ops.department, text, uuid)
  to authenticated, service_role;
