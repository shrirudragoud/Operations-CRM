-- 0012: stop signed-in users calling ops.trainer_conflict() directly over the API.
-- With `ops` exposed in the Data API, any authenticated user (incl. partners) could probe whether a
-- named trainer is booked in a time window. Only triggers need it, so make the trigger that calls it
-- SECURITY DEFINER (event_guard already is) and revoke the direct grant.
create or replace function ops.event_staff_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e ops.event%rowtype;
begin
  select * into e from ops.event where id = new.event_id;
  if e.starts_at is not null and e.ends_at is not null
     and ops.trainer_conflict(new.staff_id, e.starts_at, e.ends_at, e.id) then
    raise exception 'Trainer is already booked during this event';
  end if;
  return new;
end $$;

revoke execute on function ops.trainer_conflict(uuid, timestamptz, timestamptz, uuid) from authenticated;
revoke execute on all functions in schema ops from public;
