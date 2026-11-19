-- 0027: One answer for a whole fixed meeting.
--
-- Problem: every occurrence of a fixed meeting is its own meeting with its own "invited" answer, so a person had
-- to answer each week, and changing the series time (which regenerates the future occurrences) asked them again.
--
-- 1. ops.meeting_series_response: one row per person per series. Written only by the triggers and the RPC below.
-- 2. Accepting any upcoming occurrence accepts every upcoming occurrence still "invited" (a person's own decline or
--    "maybe" stays, a moved or edited (customised) occurrence stays). Declining or "maybe" on one occurrence
--    changes only that one.
-- 3. ops.answer_meeting_series(series, rsvp): "all upcoming" in one call, overriding earlier per-occurrence answers.
-- 4. New occurrences (the nightly job, or a regenerated series) arrive with the person's series answer.
-- 5. One invitation per person per series (also for people added later); the organizer gets one answer
--    notification per action, not one per occurrence.
-- 6. Backfill: where someone already accepted an upcoming occurrence, that becomes their series answer.

create table ops.meeting_series_response (
  series_id    uuid not null references ops.meeting_series (id) on delete cascade,
  staff_id     uuid not null references ops.staff (id) on delete cascade,
  rsvp         text not null check (rsvp in ('accepted', 'tentative', 'declined')),
  responded_at timestamptz not null default now(),
  primary key (series_id, staff_id)
);
create index meeting_series_response_staff_idx on ops.meeting_series_response (staff_id);
alter table ops.meeting_series_response enable row level security;
create policy meeting_series_response_sel on ops.meeting_series_response for select to authenticated
  using (staff_id = (select auth.uid())
         or (select ops.is_founder())
         or exists (select 1 from ops.meeting_series s where s.id = series_id and s.organizer_id = (select auth.uid())));

-- ---------------------------------------------------------------- accept one = accept the upcoming ones
create or replace function ops.meeting_attendee_series_accept() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m   record;
  was text := coalesce(current_setting('ops.meeting_rpc', true), '');
begin
  if ops.is_system() or was = '1' then return null; end if;
  select series_id, organizer_id into m from ops.meeting where id = new.meeting_id;
  if m.series_id is null or new.staff_id = m.organizer_id then return null; end if;

  insert into ops.meeting_series_response (series_id, staff_id, rsvp, responded_at)
  values (m.series_id, new.staff_id, 'accepted', now())
  on conflict (series_id, staff_id) do update set rsvp = 'accepted', responded_at = now();

  perform set_config('ops.meeting_rpc', '1', true);
  update ops.meeting_attendee a set rsvp = 'accepted', responded_at = now()
    from ops.meeting x
   where a.meeting_id = x.id and x.series_id = m.series_id and a.staff_id = new.staff_id
     and a.rsvp = 'invited' and x.status = 'scheduled' and not x.customised and x.starts_at > now();
  perform set_config('ops.meeting_rpc', was, true);
  return null;
end $$;
create trigger t_meeting_attendee_series_accept after update of rsvp on ops.meeting_attendee
  for each row when (new.rsvp = 'accepted' and old.rsvp is distinct from new.rsvp)
  execute function ops.meeting_attendee_series_accept();

-- ---------------------------------------------------------------- answer the whole series
create or replace function ops.answer_meeting_series(p_series uuid, p_rsvp text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me     uuid := auth.uid();
  s      ops.meeting_series;
  who    text;
  next_m uuid;
  was    text := coalesce(current_setting('ops.meeting_rpc', true), '');
begin
  if p_rsvp not in ('accepted', 'tentative', 'declined') then raise exception 'Choose accepted, maybe or declined'; end if;
  select * into s from ops.meeting_series where id = p_series;
  if not found then raise exception 'That fixed meeting does not exist'; end if;
  if s.organizer_id = me then
    if p_rsvp = 'declined' then raise exception 'The organizer can not decline their own series; pause or delete it instead'; end if;
    return;
  end if;
  if not exists (select 1 from ops.meeting_attendee a join ops.meeting m on m.id = a.meeting_id
                  where m.series_id = p_series and a.staff_id = me) then
    raise exception 'You are not invited to that fixed meeting';
  end if;

  insert into ops.meeting_series_response (series_id, staff_id, rsvp, responded_at)
  values (p_series, me, p_rsvp, now())
  on conflict (series_id, staff_id) do update set rsvp = excluded.rsvp, responded_at = now();

  perform set_config('ops.meeting_rpc', '1', true);
  update ops.meeting_attendee a set rsvp = p_rsvp, responded_at = now()
    from ops.meeting m
   where a.meeting_id = m.id and m.series_id = p_series and a.staff_id = me
     and m.status = 'scheduled' and m.starts_at > now();
  perform set_config('ops.meeting_rpc', was, true);

  select id into next_m from ops.meeting
   where series_id = p_series and status = 'scheduled' and starts_at > now() order by starts_at limit 1;
  if next_m is not null then
    select full_name into who from ops.staff where id = me;
    perform ops.notify_meeting(s.organizer_id, 'meeting_response', next_m, me,
      who || case p_rsvp when 'accepted' then ' is coming to every one of: ' when 'declined' then ' can not come to any of: '
                         else ' might come to: ' end || left(s.title, 80));
  end if;
end $$;

-- ---------------------------------------------------------------- new occurrences inherit the answer
create or replace function ops.generate_series_meetings(p_series uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s         record;
  today     date := (now() at time zone 'Asia/Kolkata')::date;
  d         date;
  last_day  date;
  first_occ date;
  made      integer := 0;
  n         integer;
  was       text := coalesce(current_setting('ops.system_job', true), '');
  rpc_was   text := coalesce(current_setting('ops.meeting_rpc', true), '');
begin
  perform set_config('ops.system_job', '1', true);
  for s in select * from ops.meeting_series
           where active and (p_series is null or id = p_series)
             and starts_on <= today + 35 and (ends_on is null or ends_on >= today) loop
    last_day := least(coalesce(s.ends_on, today + 35), today + 35);
    d := greatest(s.starts_on, today);
    first_occ := case when s.weekday is null then null
                      else s.starts_on + ((s.weekday - extract(isodow from s.starts_on)::int + 7) % 7) end;
    while d <= last_day loop
      if (s.frequency = 'weekly' and extract(isodow from d)::int = s.weekday)
         or (s.frequency = 'biweekly' and extract(isodow from d)::int = s.weekday and ((d - first_occ) / 7) % 2 = 0)
         or (s.frequency = 'monthly' and extract(day from d)::int = s.month_day) then
        insert into ops.meeting (title, description, kind, department, visibility, organizer_id, starts_at, ends_at, location,
                                 status, series_id, occurrence_date)
        values (s.title, s.description, s.kind, s.department, s.visibility, s.organizer_id,
                (d + s.start_time) at time zone 'Asia/Kolkata',
                (d + s.start_time) at time zone 'Asia/Kolkata' + make_interval(mins => s.duration_minutes),
                s.location, 'scheduled', s.id, d)
        on conflict (series_id, occurrence_date) where series_id is not null do nothing;
        get diagnostics n = row_count;
        made := made + n;
      end if;
      d := d + 1;
    end loop;

    insert into ops.meeting_attendee (meeting_id, staff_id)
    select m.id, st.id
      from ops.meeting m
      join ops.staff st on st.is_active and st.role <> 'partner'
                       and (st.id = s.organizer_id or st.id = any (s.staff_ids)
                            or (s.all_department and s.department = any (st.departments)))
     where m.series_id = s.id and m.status = 'scheduled' and m.starts_at > now()
    on conflict do nothing;

    perform set_config('ops.meeting_rpc', '1', true);
    update ops.meeting_attendee a set rsvp = r.rsvp, responded_at = r.responded_at
      from ops.meeting_series_response r, ops.meeting m
     where r.series_id = s.id and m.series_id = s.id and a.meeting_id = m.id and a.staff_id = r.staff_id
       and a.rsvp = 'invited' and m.status = 'scheduled' and not m.customised and m.starts_at > now();
    perform set_config('ops.meeting_rpc', rpc_was, true);
  end loop;
  perform set_config('ops.system_job', was, true);
  return made;
end $$;

-- ---------------------------------------------------------------- invitations and removals
create or replace function ops.meeting_series_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  first_id uuid;
  first_at timestamptz;
  who      text;
  r        record;
  was      text := coalesce(current_setting('ops.system_job', true), '');
begin
  if tg_op = 'UPDATE' then
    perform set_config('ops.system_job', '1', true);
    if new.frequency is distinct from old.frequency or new.weekday is distinct from old.weekday
       or new.month_day is distinct from old.month_day or new.start_time is distinct from old.start_time
       or new.duration_minutes is distinct from old.duration_minutes or new.starts_on is distinct from old.starts_on
       or new.ends_on is distinct from old.ends_on or new.active is distinct from old.active then
      delete from ops.meeting where series_id = new.id and starts_at > now() and not customised and status = 'scheduled';
    else
      update ops.meeting set title = new.title, description = new.description, kind = new.kind, department = new.department,
                             visibility = new.visibility, location = new.location
       where series_id = new.id and starts_at > now() and not customised and status = 'scheduled';
    end if;
    delete from ops.meeting_attendee a using ops.meeting m
     where a.meeting_id = m.id and m.series_id = new.id and m.starts_at > now() and m.status = 'scheduled'
       and a.staff_id <> new.organizer_id
       and not (a.staff_id = any (new.staff_ids)
                or (new.all_department and exists (select 1 from ops.staff st where st.id = a.staff_id and new.department = any (st.departments))));
    delete from ops.meeting_series_response x
     where x.series_id = new.id
       and not (x.staff_id = any (new.staff_ids)
                or (new.all_department and exists (select 1 from ops.staff st where st.id = x.staff_id and new.department = any (st.departments))));
    perform set_config('ops.system_job', was, true);
  end if;

  perform ops.generate_series_meetings(new.id);

  if new.active then
    select id, starts_at into first_id, first_at from ops.meeting
     where series_id = new.id and status = 'scheduled' and starts_at > now() order by starts_at limit 1;
    select full_name into who from ops.staff where id = new.organizer_id;
    if first_id is not null then
      for r in select staff_id from ops.meeting_attendee where meeting_id = first_id loop
        perform ops.notify_meeting(r.staff_id, 'meeting_invite', first_id, new.organizer_id,
          who || ' set up a fixed meeting: ' || left(new.title, 80) || ' · ' || ops.meeting_when(first_at),
          'series:' || new.id || ':' || r.staff_id);
      end loop;
    end if;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------- backfill
insert into ops.meeting_series_response (series_id, staff_id, rsvp, responded_at)
select distinct on (m.series_id, a.staff_id) m.series_id, a.staff_id, 'accepted', coalesce(a.responded_at, now())
  from ops.meeting_attendee a
  join ops.meeting m on m.id = a.meeting_id
  join ops.meeting_series s on s.id = m.series_id
 where a.rsvp = 'accepted' and m.status = 'scheduled' and m.starts_at > now() and a.staff_id <> s.organizer_id
 order by m.series_id, a.staff_id, a.responded_at desc nulls last
on conflict do nothing;

update ops.meeting_attendee a set rsvp = 'accepted', responded_at = now()
  from ops.meeting m, ops.meeting_series_response r
 where a.meeting_id = m.id and r.series_id = m.series_id and r.staff_id = a.staff_id and r.rsvp = 'accepted'
   and a.rsvp = 'invited' and m.status = 'scheduled' and not m.customised and m.starts_at > now();

revoke execute on all functions in schema ops from public;
grant execute on function ops.answer_meeting_series(uuid, text) to authenticated, service_role;
