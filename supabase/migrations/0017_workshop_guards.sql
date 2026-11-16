-- 0017 workshop guards (Workshop workspace)
-- 1. A cancelled event needs a reason (event.cancel_reason).
-- 2. An event has at most 2 assistants (D18); an assistant must be active internal staff and cannot be the lead.
-- 3. Scheduling and re-scheduling re-check every assistant for double-booking, not just the lead
--    (before, moving the dates of a scheduled event could silently double-book an assistant).
-- 4. Run-sheet ticks are stamped by the database: done_by is always the caller and done_at is now().
-- 5. ops.set_event_team(): lead + assistants are saved as one atomic set. Security definer because removing
--    an assistant is a lead-only RLS action while fixing a team is everyday work for Workshop.

alter table ops.event add column cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500);

-- ---------------------------------------------------------------- assistants
create or replace function ops.event_staff_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e ops.event%rowtype; s ops.staff%rowtype;
begin
  select * into e from ops.event where id = new.event_id;
  select * into s from ops.staff where id = new.staff_id;
  if not found or not s.is_active or s.role = 'partner' then
    raise exception 'An assistant must be an active member of the team';
  end if;
  if e.lead_trainer_id = new.staff_id then
    raise exception 'The lead trainer cannot also be an assistant';
  end if;
  if (select count(*) from ops.event_staff x where x.event_id = new.event_id and x.staff_id <> new.staff_id) >= 2 then
    raise exception 'An event can have at most 2 assistants';
  end if;
  if e.starts_at is not null and e.ends_at is not null
     and ops.trainer_conflict(new.staff_id, e.starts_at, e.ends_at, e.id) then
    raise exception 'Trainer is already booked during this event';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- event state machine
create or replace function ops.event_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare busy text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'New events must start as draft'; end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'draft'       and new.status in ('scheduled','cancelled'))
         or (old.status = 'scheduled'   and new.status in ('draft','in_progress','completed','cancelled'))
         or (old.status = 'in_progress' and new.status in ('completed','cancelled'))) then
      raise exception 'Event cannot move from % to %', old.status, new.status;
    end if;
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and coalesce(btrim(new.cancel_reason), '') = '' then
    raise exception 'A cancellation reason is required';
  end if;

  if new.lead_trainer_id is not null and new.lead_trainer_id is distinct from old.lead_trainer_id
     and exists (select 1 from ops.event_staff s where s.event_id = new.id and s.staff_id = new.lead_trainer_id) then
    raise exception 'The lead trainer cannot also be an assistant';
  end if;

  if new.status = 'scheduled' then
    if new.lead_trainer_id is null or new.starts_at is null or new.ends_at is null
       or coalesce(btrim(new.venue), '') = '' or new.expected_headcount is null then
      raise exception 'To schedule an event set: lead trainer, start, end, venue and expected headcount';
    end if;
    if not (exists (select 1 from ops.staff s
                    where s.id = new.lead_trainer_id and s.role = 'founder')
            or exists (select 1 from ops.v_certified_trainer c
                       where c.staff_id = new.lead_trainer_id)) then
      raise exception 'Lead trainer is not certified';
    end if;
    if ops.trainer_conflict(new.lead_trainer_id, new.starts_at, new.ends_at, new.id) then
      raise exception 'Lead trainer is already booked during this time';
    end if;
    select st.full_name into busy
      from ops.event_staff es join ops.staff st on st.id = es.staff_id
     where es.event_id = new.id
       and ops.trainer_conflict(es.staff_id, new.starts_at, new.ends_at, new.id)
     limit 1;
    if busy is not null then
      raise exception 'Assistant % is already booked during this time', busy;
    end if;
  elsif new.status = 'in_progress'
        and (old.status is distinct from 'in_progress' or new.starts_at is distinct from old.starts_at
             or new.ends_at is distinct from old.ends_at or new.lead_trainer_id is distinct from old.lead_trainer_id) then
    if new.lead_trainer_id is null or new.starts_at is null or new.ends_at is null then
      raise exception 'An event in progress needs a lead trainer, start and end';
    end if;
    if ops.trainer_conflict(new.lead_trainer_id, new.starts_at, new.ends_at, new.id) then
      raise exception 'Lead trainer is already booked during this time';
    end if;
    select st.full_name into busy
      from ops.event_staff es join ops.staff st on st.id = es.staff_id
     where es.event_id = new.id
       and ops.trainer_conflict(es.staff_id, new.starts_at, new.ends_at, new.id)
     limit 1;
    if busy is not null then
      raise exception 'Assistant % is already booked during this time', busy;
    end if;
  end if;

  if new.status = 'completed' and old.status is distinct from 'completed' then
    if new.actual_headcount is null then
      raise exception 'Enter actual headcount before completing the event';
    end if;
    if exists (select 1 from ops.run_sheet_item
               where event_id = new.id and phase in ('pre','day') and done_at is null) then
      raise exception 'Finish all pre-event and event-day run sheet items first';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- run sheet stamps
create or replace function ops.run_sheet_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.done_at is not null then new.done_at := now(); new.done_by := auth.uid();
    else new.done_by := null; end if;
    return new;
  end if;
  if new.event_id is distinct from old.event_id then
    raise exception 'A run sheet item cannot move to another event';
  end if;
  if new.done_at is distinct from old.done_at or new.done_by is distinct from old.done_by then
    select status into v_status from ops.event where id = new.event_id;
    if v_status = 'cancelled' then raise exception 'A cancelled event cannot be changed'; end if;
    if new.done_at is null then
      new.done_by := null;
    elsif old.done_at is null then
      new.done_at := now(); new.done_by := auth.uid();
    else
      new.done_at := old.done_at; new.done_by := old.done_by;
    end if;
  end if;
  return new;
end $$;
create trigger t_run_sheet_stamp before insert or update on ops.run_sheet_item
  for each row execute function ops.run_sheet_stamp();

-- ---------------------------------------------------------------- team
create or replace function ops.set_event_team(p_event uuid, p_lead uuid, p_assistants uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare e ops.event%rowtype; a uuid; team uuid[];
begin
  select * into e from ops.event where id = p_event;
  if not found then raise exception 'Event not found'; end if;
  if auth.uid() is not null and not (ops.can_write() and ops.in_dept('workshop')) then
    raise exception 'You do not have permission to change this event' using errcode = '42501';
  end if;
  if e.status in ('completed', 'cancelled') then
    raise exception 'The team of a % event cannot be changed', e.status;
  end if;
  team := coalesce((select array_agg(distinct x) from unnest(coalesce(p_assistants, '{}')) as x where x is not null), '{}');
  if cardinality(team) > 2 then raise exception 'An event can have at most 2 assistants'; end if;
  if p_lead is not null then
    if p_lead = any (team) then raise exception 'The lead trainer cannot also be an assistant'; end if;
    if not (exists (select 1 from ops.staff s where s.id = p_lead and s.role = 'founder' and s.is_active)
            or exists (select 1 from ops.v_certified_trainer c
                       join ops.staff s on s.id = c.staff_id
                      where c.staff_id = p_lead and s.is_active)) then
      raise exception 'Lead trainer is not certified';
    end if;
  end if;

  delete from ops.event_staff where event_id = p_event;
  update ops.event set lead_trainer_id = p_lead where id = p_event;
  foreach a in array team loop
    insert into ops.event_staff (event_id, staff_id, role) values (p_event, a, 'assistant');
  end loop;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.set_event_team(uuid, uuid, uuid[]) to authenticated, service_role;
