-- 0022: Calendar and meetings.
--
-- 1. ops.meeting: one meeting (internal team, one to one, review, or an institution call). Either scheduled
--    straight away (people then accept or decline) or REQUESTED from one person, who accepts, declines or
--    suggests another time. Cancelled and declined meetings are frozen and keep their reason.
-- 2. ops.meeting_attendee: who is invited and what they answered (invited, accepted, tentative, declined).
-- 3. ops.meeting_series: a fixed meeting (weekly, every two weeks, monthly) for a whole department or chosen
--    people. ops.generate_series_meetings() keeps the next five weeks of dated meetings in place, so one
--    occurrence can be moved or cancelled without touching the rest.
-- 4. Visibility: invitees only (default), the department, or everyone. Only the founder opens a meeting to
--    everyone; only the founder or a lead of that department opens one to a whole team.
-- 5. ops.calendar_busy() tells the app who is already booked (meetings and Workshop events). Double booking
--    is a warning in the UI, not a database refusal (trainer double booking on events stays a hard rule).
-- 6. Notifications learn meeting kinds and a meeting_id link; reminders go out on the morning of a meeting.

-- ---------------------------------------------------------------- helpers
create or replace function ops.leads_department(p_dept ops.department) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_dept is not null
         and coalesce(ops.my_role() in ('founder', 'dept_lead'), false)
         and p_dept = any (ops.my_departments())
$$;

-- ---------------------------------------------------------------- series
create table ops.meeting_series (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (length(btrim(title)) between 1 and 200),
  description      text check (description is null or length(description) <= 4000),
  kind             text not null default 'team' check (kind in ('team', 'one_to_one', 'review', 'institution', 'other')),
  department       ops.department,
  visibility       text not null default 'invitees' check (visibility in ('invitees', 'department', 'company')),
  frequency        text not null check (frequency in ('weekly', 'biweekly', 'monthly')),
  weekday          smallint check (weekday between 1 and 7),
  month_day        smallint check (month_day between 1 and 28),
  start_time       time not null,
  duration_minutes integer not null default 30 check (duration_minutes between 5 and 480),
  location         text check (location is null or length(location) <= 300),
  starts_on        date not null default (now() at time zone 'Asia/Kolkata')::date,
  ends_on          date,
  all_department   boolean not null default false,
  staff_ids        uuid[] not null default '{}' check (cardinality(staff_ids) <= 100),
  active           boolean not null default true,
  organizer_id     uuid not null references ops.staff (id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint meeting_series_weekly_day check (frequency = 'monthly' or weekday is not null),
  constraint meeting_series_monthly_day check (frequency <> 'monthly' or month_day is not null),
  constraint meeting_series_dates check (ends_on is null or ends_on >= starts_on),
  constraint meeting_series_whole_dept check (not all_department or department is not null)
);
create index meeting_series_organizer_idx on ops.meeting_series (organizer_id);
create index meeting_series_department_idx on ops.meeting_series (department, active);
create trigger t_meeting_series_upd before update on ops.meeting_series
  for each row execute function ops.touch_updated_at();

-- ---------------------------------------------------------------- meetings
create table ops.meeting (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (length(btrim(title)) between 1 and 200),
  description     text check (description is null or length(description) <= 4000),
  kind            text not null default 'team' check (kind in ('team', 'one_to_one', 'review', 'institution', 'other')),
  department      ops.department,
  visibility      text not null default 'invitees' check (visibility in ('invitees', 'department', 'company')),
  organizer_id    uuid not null references ops.staff (id) default auth.uid(),
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  location        text check (location is null or length(location) <= 300),
  status          text not null default 'scheduled' check (status in ('requested', 'scheduled', 'cancelled', 'declined')),
  host_id         uuid references ops.staff (id),
  awaiting_id     uuid references ops.staff (id),
  cancel_reason   text check (cancel_reason is null or length(cancel_reason) <= 500),
  institution_id  uuid references ops.institution (id) on delete set null,
  deal_id         uuid references ops.deal (id) on delete set null,
  event_id        uuid references ops.event (id) on delete set null,
  series_id       uuid references ops.meeting_series (id) on delete set null,
  occurrence_date date,
  customised      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint meeting_times check (ends_at > starts_at and ends_at <= starts_at + interval '24 hours'),
  constraint meeting_request_shape check ((status = 'requested') = (awaiting_id is not null))
);
create index meeting_starts_idx on ops.meeting (starts_at);
create index meeting_organizer_idx on ops.meeting (organizer_id);
create index meeting_host_idx on ops.meeting (host_id);
create index meeting_awaiting_idx on ops.meeting (awaiting_id);
create index meeting_department_idx on ops.meeting (department, starts_at);
create index meeting_institution_idx on ops.meeting (institution_id);
create index meeting_deal_idx on ops.meeting (deal_id);
create index meeting_event_idx on ops.meeting (event_id);
create unique index meeting_series_occurrence_idx on ops.meeting (series_id, occurrence_date) where series_id is not null;
create trigger t_meeting_upd before update on ops.meeting
  for each row execute function ops.touch_updated_at();

create table ops.meeting_attendee (
  meeting_id   uuid not null references ops.meeting (id) on delete cascade,
  staff_id     uuid not null references ops.staff (id) on delete cascade,
  rsvp         text not null default 'invited' check (rsvp in ('invited', 'accepted', 'tentative', 'declined')),
  note         text check (note is null or length(note) <= 300),
  responded_at timestamptz,
  primary key (meeting_id, staff_id)
);
create index meeting_attendee_staff_idx on ops.meeting_attendee (staff_id, meeting_id);

-- ---------------------------------------------------------------- visibility helpers
create or replace function ops.is_meeting_attendee(p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.meeting_attendee where meeting_id = p_meeting and staff_id = auth.uid())
$$;

create or replace function ops.can_see_meeting(p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from ops.meeting m
    where m.id = p_meeting
      and (ops.is_founder()
           or m.organizer_id = auth.uid()
           or m.host_id = auth.uid()
           or m.awaiting_id = auth.uid()
           or ops.is_meeting_attendee(m.id)
           or (ops.is_internal()
               and (m.visibility = 'company'
                    or (m.visibility = 'department' and m.department = any (ops.my_departments()))))))
$$;

create or replace function ops.meeting_manager(p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.meeting m
                 where m.id = p_meeting
                   and (m.organizer_id = auth.uid() or ops.is_founder() or ops.leads_department(m.department)))
$$;

-- ---------------------------------------------------------------- notifications
alter table ops.notification add column meeting_id uuid references ops.meeting (id) on delete cascade;
create index notification_meeting_idx on ops.notification (meeting_id);
alter table ops.notification drop constraint notification_kind_check;
alter table ops.notification add constraint notification_kind_check check (kind in (
  'assigned', 'mentioned', 'status', 'dates', 'comment', 'due_today', 'overdue', 'recurring',
  'meeting_invite', 'meeting_request', 'meeting_response', 'meeting_update', 'meeting_cancel', 'meeting_reminder'));

create or replace function ops.notification_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.recipient_id := old.recipient_id;
    new.kind := old.kind;
    new.task_id := old.task_id;
    new.meeting_id := old.meeting_id;
    new.actor_id := old.actor_id;
    new.message := old.message;
    new.dedupe_key := old.dedupe_key;
    new.created_at := old.created_at;
    new.read_at := coalesce(old.read_at, new.read_at);
  end if;
  return new;
end $$;

create or replace function ops.notify_meeting(p_recipient uuid, p_kind text, p_meeting uuid, p_actor uuid, p_message text, p_key text default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_recipient is null or p_recipient is not distinct from p_actor then return false; end if;
  if not exists (select 1 from ops.staff where id = p_recipient and is_active) then return false; end if;
  insert into ops.notification (recipient_id, kind, meeting_id, actor_id, message, dedupe_key)
  values (p_recipient, p_kind, p_meeting, p_actor, p_message, p_key)
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function ops.meeting_when(p_at timestamptz) returns text
language sql stable set search_path = '' as $$
  select to_char(p_at at time zone 'Asia/Kolkata', 'DD Mon, FMHH12:MI am')
$$;

-- ---------------------------------------------------------------- meeting guard
create or replace function ops.meeting_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  sys boolean := ops.is_system();
  rpc boolean := coalesce(current_setting('ops.meeting_rpc', true), '') = '1';
  uid uuid := auth.uid();
  times_changed boolean;
begin
  new.title := btrim(new.title);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.location := nullif(btrim(coalesce(new.location, '')), '');
  new.cancel_reason := nullif(btrim(coalesce(new.cancel_reason, '')), '');

  if tg_op = 'INSERT' then
    if not sys then
      new.organizer_id := uid;
      new.series_id := null;
      new.occurrence_date := null;
      new.customised := false;
    end if;
    if new.status not in ('scheduled', 'requested') then
      raise exception 'A new meeting is either scheduled or requested';
    end if;
    if new.status = 'requested' then
      if new.host_id is null or new.host_id = new.organizer_id then
        raise exception 'Choose who you are asking for the meeting';
      end if;
      if not exists (select 1 from ops.staff where id = new.host_id and is_active and role <> 'partner') then
        raise exception 'The person you are asking must be an active team member';
      end if;
      new.awaiting_id := new.host_id;
    else
      new.awaiting_id := null;
      new.host_id := null;
    end if;
    if not sys and new.starts_at < now() - interval '5 minutes' then
      raise exception 'Pick a start time in the future';
    end if;
  else
    if old.status in ('cancelled', 'declined') then
      -- only the links to institution, deal, event and series may change (they are nulled when the row they point to goes)
      if (new.title, new.description, new.kind, new.department, new.visibility, new.organizer_id, new.starts_at, new.ends_at,
          new.location, new.status, new.cancel_reason, new.host_id, new.awaiting_id)
         is distinct from
         (old.title, old.description, old.kind, old.department, old.visibility, old.organizer_id, old.starts_at, old.ends_at,
          old.location, old.status, old.cancel_reason, old.host_id, old.awaiting_id) then
        raise exception 'A % meeting can not be changed', old.status;
      end if;
      return new;
    end if;
    if new.organizer_id is distinct from old.organizer_id then raise exception 'The organizer of a meeting can not change'; end if;
    if not rpc and not sys then
      new.host_id := old.host_id;
      new.awaiting_id := old.awaiting_id;
      if not (new.series_id is null and old.series_id is not null
              and not exists (select 1 from ops.meeting_series where id = old.series_id)) then
        new.series_id := old.series_id;
      end if;
      new.occurrence_date := old.occurrence_date;
      new.customised := old.customised;
    end if;
    if new.status is distinct from old.status then
      if old.status = 'requested' and new.status in ('scheduled', 'declined') then
        if not rpc and not sys then raise exception 'Only the person asked can accept or decline a request'; end if;
      elsif new.status = 'cancelled' then
        if new.cancel_reason is null then raise exception 'Say why the meeting is cancelled'; end if;
        new.awaiting_id := null;
      else
        raise exception 'A % meeting can not become %', old.status, new.status;
      end if;
    end if;
  end if;

  if new.visibility = 'department' and new.department is null then
    raise exception 'Choose the department this meeting is for';
  end if;
  if not sys and (tg_op = 'INSERT' or new.visibility is distinct from old.visibility or new.department is distinct from old.department) then
    if new.visibility = 'department' and not ops.leads_department(new.department) then
      raise exception 'Only the founder or a lead of that department can open a meeting to the whole team';
    elsif new.visibility = 'company' and not ops.is_founder() then
      raise exception 'Only the founder can make a meeting visible to everyone';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    times_changed := new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at;
    if times_changed and not sys and not rpc then
      if new.starts_at < now() - interval '5 minutes' then raise exception 'Pick a start time in the future'; end if;
      if new.series_id is not null then new.customised := true; end if;
      if new.status = 'requested' then
        new.awaiting_id := case when uid = new.host_id then new.organizer_id else new.host_id end;
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger t_meeting_guard before insert or update on ops.meeting
  for each row execute function ops.meeting_guard();

create or replace function ops.meeting_after_ins() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  insert into ops.meeting_attendee (meeting_id, staff_id, rsvp, responded_at)
  values (new.id, new.organizer_id, 'accepted', now())
  on conflict do nothing;
  if new.host_id is not null then
    insert into ops.meeting_attendee (meeting_id, staff_id) values (new.id, new.host_id) on conflict do nothing;
  end if;
  if new.status = 'requested' and not ops.is_system() then
    select full_name into who from ops.staff where id = new.organizer_id;
    perform ops.notify_meeting(new.awaiting_id, 'meeting_request', new.id, new.organizer_id,
      who || ' would like to meet: ' || left(new.title, 80) || ' · ' || ops.meeting_when(new.starts_at), 'request:' || new.id);
  end if;
  return null;
end $$;
create trigger t_meeting_after_ins after insert on ops.meeting
  for each row execute function ops.meeting_after_ins();

create or replace function ops.meeting_after_upd() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rpc boolean := coalesce(current_setting('ops.meeting_rpc', true), '') = '1';
  sys boolean := coalesce(current_setting('ops.system_job', true), '') = '1';
  uid uuid := auth.uid();
  who text;
  a record;
begin
  if sys then return null; end if;
  select full_name into who from ops.staff where id = coalesce(uid, new.organizer_id);

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    for a in select staff_id from ops.meeting_attendee
             where meeting_id = new.id and rsvp <> 'declined'
               and (old.status = 'scheduled' or staff_id = old.awaiting_id) loop
      perform ops.notify_meeting(a.staff_id, 'meeting_cancel', new.id, uid,
        who || ' cancelled: ' || left(new.title, 80) || ' (' || new.cancel_reason || ')');
    end loop;
  elsif new.status = 'scheduled' and old.status = 'scheduled'
        and (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at) then
    update ops.meeting_attendee set rsvp = 'invited', responded_at = null
     where meeting_id = new.id and staff_id <> new.organizer_id and rsvp <> 'invited';
    for a in select staff_id from ops.meeting_attendee where meeting_id = new.id loop
      perform ops.notify_meeting(a.staff_id, 'meeting_update', new.id, uid,
        who || ' moved: ' || left(new.title, 80) || ' to ' || ops.meeting_when(new.starts_at) || '. Please answer again.');
    end loop;
  elsif new.status = 'requested' and old.status = 'requested' and not rpc
        and (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at) then
    perform ops.notify_meeting(new.awaiting_id, 'meeting_request', new.id, uid,
      who || ' changed the time: ' || left(new.title, 80) || ' · ' || ops.meeting_when(new.starts_at));
  end if;
  return null;
end $$;
create trigger t_meeting_after_upd after update on ops.meeting
  for each row execute function ops.meeting_after_upd();

-- ---------------------------------------------------------------- attendee guard
create or replace function ops.meeting_attendee_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  sys boolean := ops.is_system();
  rpc boolean := coalesce(current_setting('ops.meeting_rpc', true), '') = '1';
  m record;
begin
  select status, organizer_id, ends_at into m from ops.meeting where id = new.meeting_id;
  if tg_op = 'INSERT' then
    if not exists (select 1 from ops.staff where id = new.staff_id and is_active and role <> 'partner') then
      raise exception 'Only active team members can be invited';
    end if;
    if not sys and m.status in ('cancelled', 'declined') then
      raise exception 'Nobody can be invited to a % meeting', m.status;
    end if;
    if new.staff_id <> m.organizer_id then
      new.rsvp := 'invited';
      new.responded_at := null;
    end if;
    return new;
  end if;

  new.meeting_id := old.meeting_id;
  new.staff_id := old.staff_id;
  if new.rsvp is distinct from old.rsvp and not sys and not rpc then
    if m.status = 'requested' then raise exception 'Wait until the request is accepted before answering'; end if;
    if m.status <> 'scheduled' then raise exception 'That meeting was %', m.status; end if;
    if m.ends_at < now() then raise exception 'That meeting is over'; end if;
    if new.rsvp = 'declined' and new.staff_id = m.organizer_id then
      raise exception 'The organizer can not decline; cancel the meeting instead';
    end if;
    new.responded_at := case when new.rsvp = 'invited' then null else now() end;
  end if;
  return new;
end $$;
create trigger t_meeting_attendee_guard before insert or update on ops.meeting_attendee
  for each row execute function ops.meeting_attendee_guard();

create or replace function ops.meeting_attendee_no_organizer_removal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not ops.is_system() and exists (select 1 from ops.meeting where id = old.meeting_id and organizer_id = old.staff_id) then
    raise exception 'The organizer can not be removed from their own meeting';
  end if;
  return old;
end $$;
create trigger t_meeting_attendee_no_organizer_removal before delete on ops.meeting_attendee
  for each row execute function ops.meeting_attendee_no_organizer_removal();

create or replace function ops.meeting_attendee_after_ins() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m record; who text;
begin
  if ops.is_system() or coalesce(current_setting('ops.meeting_rpc', true), '') = '1' then return null; end if;
  select title, status, organizer_id, starts_at into m from ops.meeting where id = new.meeting_id;
  if m.status = 'scheduled' and new.staff_id <> m.organizer_id then
    select full_name into who from ops.staff where id = m.organizer_id;
    perform ops.notify_meeting(new.staff_id, 'meeting_invite', new.meeting_id, m.organizer_id,
      who || ' invited you: ' || left(m.title, 80) || ' · ' || ops.meeting_when(m.starts_at), 'invite:' || new.meeting_id || ':' || new.staff_id);
  end if;
  return null;
end $$;
create trigger t_meeting_attendee_after_ins after insert on ops.meeting_attendee
  for each row execute function ops.meeting_attendee_after_ins();

create or replace function ops.meeting_attendee_after_upd() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m record; who text;
begin
  if ops.is_system() or coalesce(current_setting('ops.meeting_rpc', true), '') = '1' then return null; end if;
  if new.rsvp is not distinct from old.rsvp or new.rsvp = 'invited' then return null; end if;
  select title, organizer_id into m from ops.meeting where id = new.meeting_id;
  select full_name into who from ops.staff where id = new.staff_id;
  perform ops.notify_meeting(m.organizer_id, 'meeting_response', new.meeting_id, new.staff_id,
    who || case new.rsvp when 'accepted' then ' accepted: ' when 'declined' then ' declined: ' else ' might attend: ' end || left(m.title, 80));
  return null;
end $$;
create trigger t_meeting_attendee_after_upd after update on ops.meeting_attendee
  for each row execute function ops.meeting_attendee_after_upd();

-- ---------------------------------------------------------------- request answers
create or replace function ops.answer_meeting_request(
  p_meeting uuid, p_action text, p_start timestamptz default null, p_end timestamptz default null, p_note text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m     ops.meeting;
  me    uuid := auth.uid();
  who   text;
  other uuid;
  a     record;
begin
  select * into m from ops.meeting where id = p_meeting for update;
  if not found or m.status <> 'requested' then raise exception 'That request is no longer open'; end if;
  if m.awaiting_id is distinct from me then raise exception 'Only the person asked to respond can answer this request'; end if;
  if p_action not in ('accept', 'decline', 'propose') then raise exception 'Choose accept, decline or propose'; end if;
  select full_name into who from ops.staff where id = me;
  other := case when me = m.organizer_id then m.host_id else m.organizer_id end;

  perform set_config('ops.meeting_rpc', '1', true);
  if p_action = 'accept' then
    update ops.meeting set status = 'scheduled', awaiting_id = null where id = p_meeting;
    update ops.meeting_attendee set rsvp = 'accepted', responded_at = now()
     where meeting_id = p_meeting and staff_id in (m.organizer_id, m.host_id);
    perform ops.notify_meeting(other, 'meeting_response', p_meeting, me, who || ' accepted: ' || left(m.title, 80) || ' · ' || ops.meeting_when(m.starts_at));
    for a in select staff_id from ops.meeting_attendee
             where meeting_id = p_meeting and staff_id not in (m.organizer_id, m.host_id) loop
      perform ops.notify_meeting(a.staff_id, 'meeting_invite', p_meeting, m.organizer_id,
        (select full_name from ops.staff where id = m.organizer_id) || ' invited you: ' || left(m.title, 80) || ' · ' || ops.meeting_when(m.starts_at),
        'invite:' || p_meeting || ':' || a.staff_id);
    end loop;
  elsif p_action = 'decline' then
    if p_note is null or btrim(p_note) = '' then raise exception 'Say why you are declining'; end if;
    update ops.meeting set status = 'declined', awaiting_id = null, cancel_reason = btrim(p_note) where id = p_meeting;
    perform ops.notify_meeting(other, 'meeting_response', p_meeting, me, who || ' declined: ' || left(m.title, 80) || ' (' || btrim(p_note) || ')');
  else
    if p_start is null or p_end is null or p_end <= p_start then raise exception 'Pick a start and an end for the new time'; end if;
    if p_start < now() - interval '5 minutes' then raise exception 'Pick a start time in the future'; end if;
    update ops.meeting set starts_at = p_start, ends_at = p_end, awaiting_id = other where id = p_meeting;
    perform ops.notify_meeting(other, 'meeting_request', p_meeting, me, who || ' suggested another time: ' || left(m.title, 80) || ' · ' || ops.meeting_when(p_start));
  end if;
  perform set_config('ops.meeting_rpc', '', true);
end $$;

-- ---------------------------------------------------------------- who is busy
create or replace function ops.calendar_busy(p_staff uuid[], p_from timestamptz, p_to timestamptz, p_exclude uuid default null)
returns table (staff_id uuid, kind text, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.staff_id, 'meeting'::text, m.starts_at, m.ends_at
    from ops.meeting_attendee a join ops.meeting m on m.id = a.meeting_id
   where ops.is_internal() and a.staff_id = any (p_staff) and a.rsvp <> 'declined'
     and m.status = 'scheduled' and m.starts_at < p_to and m.ends_at > p_from and m.id is distinct from p_exclude
  union all
  select e.lead_trainer_id, 'workshop'::text, e.starts_at, e.ends_at
    from ops.event e
   where ops.is_internal() and e.lead_trainer_id = any (p_staff) and e.status in ('scheduled', 'in_progress')
     and e.archived_at is null and e.starts_at < p_to and e.ends_at > p_from
  union all
  select es.staff_id, 'workshop'::text, e.starts_at, e.ends_at
    from ops.event_staff es join ops.event e on e.id = es.event_id
   where ops.is_internal() and es.staff_id = any (p_staff) and e.status in ('scheduled', 'in_progress')
     and e.archived_at is null and e.starts_at < p_to and e.ends_at > p_from
$$;

-- ---------------------------------------------------------------- series guard and generation
create or replace function ops.meeting_series_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sys boolean := ops.is_system();
begin
  new.title := btrim(new.title);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.location := nullif(btrim(coalesce(new.location, '')), '');
  if new.frequency = 'monthly' then new.weekday := null; else new.month_day := null; end if;
  if tg_op = 'INSERT' then
    if not sys then new.organizer_id := auth.uid(); end if;
  elsif new.organizer_id is distinct from old.organizer_id then
    raise exception 'The organizer of a fixed meeting can not change';
  end if;
  if not new.all_department and cardinality(new.staff_ids) = 0 then
    raise exception 'Choose the whole department or at least one person';
  end if;
  if new.visibility = 'department' and new.department is null then
    raise exception 'Choose the department this meeting is for';
  end if;
  if not sys then
    if (new.all_department or new.visibility = 'department')
       and (tg_op = 'INSERT' or new.all_department is distinct from old.all_department
            or new.visibility is distinct from old.visibility or new.department is distinct from old.department)
       and not ops.leads_department(new.department) then
      raise exception 'Only the founder or a lead of that department can set up a meeting for a whole team';
    elsif new.visibility = 'company' and not ops.is_founder() then
      raise exception 'Only the founder can make a meeting visible to everyone';
    end if;
  end if;
  return new;
end $$;
create trigger t_meeting_series_guard before insert or update on ops.meeting_series
  for each row execute function ops.meeting_series_guard();

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
  end loop;
  perform set_config('ops.system_job', was, true);
  return made;
end $$;

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
    perform set_config('ops.system_job', was, true);
  end if;

  perform ops.generate_series_meetings(new.id);

  if tg_op = 'INSERT' and new.active then
    select id, starts_at into first_id, first_at from ops.meeting where series_id = new.id order by starts_at limit 1;
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
create trigger t_meeting_series_after after insert or update on ops.meeting_series
  for each row execute function ops.meeting_series_after();

create or replace function ops.meeting_series_before_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare was text := coalesce(current_setting('ops.system_job', true), '');
begin
  perform set_config('ops.system_job', '1', true);
  delete from ops.meeting where series_id = old.id and starts_at > now() and not customised and status = 'scheduled';
  perform set_config('ops.system_job', was, true);
  return old;
end $$;
create trigger t_meeting_series_before_delete before delete on ops.meeting_series
  for each row execute function ops.meeting_series_before_delete();

-- ---------------------------------------------------------------- reminders and automation
create or replace function ops.run_meeting_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  r     record;
  sent  integer := 0;
begin
  for r in select m.id, left(m.title, 80) as t, m.starts_at, a.staff_id
             from ops.meeting m join ops.meeting_attendee a on a.meeting_id = m.id
            where m.status = 'scheduled' and a.rsvp <> 'declined' and m.starts_at > now()
              and (m.starts_at at time zone 'Asia/Kolkata')::date = today loop
    if ops.notify_meeting(r.staff_id, 'meeting_reminder', r.id, null,
                          'Today ' || to_char(r.starts_at at time zone 'Asia/Kolkata', 'FMHH12:MI am') || ': ' || r.t,
                          'remind:' || r.id || ':' || r.staff_id) then
      sent := sent + 1;
    end if;
  end loop;
  return sent;
end $$;

create or replace function ops.run_task_automation() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare made integer; sent integer; stopped integer; meetings integer; reminded integer;
begin
  made := ops.run_task_recurrences();
  sent := ops.run_task_reminders();
  stopped := ops.close_stale_timers();
  meetings := ops.generate_series_meetings();
  reminded := ops.run_meeting_reminders();
  return jsonb_build_object('created', made, 'reminders', sent, 'timers_stopped', stopped,
                            'meetings', meetings, 'meeting_reminders', reminded);
end $$;

-- ---------------------------------------------------------------- RLS
alter table ops.meeting enable row level security;
alter table ops.meeting_attendee enable row level security;
alter table ops.meeting_series enable row level security;

create policy meeting_sel on ops.meeting for select to authenticated
  using ((select ops.is_founder())
         or organizer_id = (select auth.uid())
         or host_id = (select auth.uid())
         or awaiting_id = (select auth.uid())
         or (select ops.is_meeting_attendee(id))
         or ((select ops.is_internal())
             and (visibility = 'company'
                  or (visibility = 'department' and department = any ((select ops.my_departments())::ops.department[])))));
create policy meeting_ins on ops.meeting for insert to authenticated
  with check ((select ops.is_internal()) and organizer_id = (select auth.uid()));
create policy meeting_upd on ops.meeting for update to authenticated
  using (organizer_id = (select auth.uid()) or (select ops.is_founder())
         or ((select ops.my_role()) = 'dept_lead' and department = any ((select ops.my_departments())::ops.department[])))
  with check (organizer_id is not null);
create policy meeting_del on ops.meeting for delete to authenticated
  using (organizer_id = (select auth.uid()) or (select ops.is_founder()));

create policy meeting_attendee_sel on ops.meeting_attendee for select to authenticated
  using (staff_id = (select auth.uid()) or (select ops.can_see_meeting(meeting_id)));
create policy meeting_attendee_ins on ops.meeting_attendee for insert to authenticated
  with check ((select ops.meeting_manager(meeting_id)));
create policy meeting_attendee_upd on ops.meeting_attendee for update to authenticated
  using (staff_id = (select auth.uid()))
  with check (staff_id = (select auth.uid()));
create policy meeting_attendee_del on ops.meeting_attendee for delete to authenticated
  using ((select ops.meeting_manager(meeting_id)));

create policy meeting_series_sel on ops.meeting_series for select to authenticated
  using ((select ops.is_founder())
         or organizer_id = (select auth.uid())
         or (select auth.uid()) = any (staff_ids)
         or (department is not null and department = any ((select ops.my_departments())::ops.department[])
             and (select ops.is_internal())));
create policy meeting_series_ins on ops.meeting_series for insert to authenticated
  with check ((select ops.is_internal()) and organizer_id = (select auth.uid()));
create policy meeting_series_upd on ops.meeting_series for update to authenticated
  using (organizer_id = (select auth.uid()) or (select ops.is_founder()))
  with check (organizer_id is not null);
create policy meeting_series_del on ops.meeting_series for delete to authenticated
  using (organizer_id = (select auth.uid()) or (select ops.is_founder()));

revoke execute on all functions in schema ops from public;
grant execute on function ops.leads_department(ops.department), ops.is_meeting_attendee(uuid), ops.can_see_meeting(uuid),
  ops.meeting_manager(uuid) to authenticated, service_role;
grant execute on function ops.answer_meeting_request(uuid, text, timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function ops.calendar_busy(uuid[], timestamptz, timestamptz, uuid) to authenticated, service_role;
grant execute on function ops.run_task_automation() to authenticated, service_role;
