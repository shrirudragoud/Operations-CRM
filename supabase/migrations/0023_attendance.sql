-- 0023 attendance: check in and out for people who work from the office (slice E, D51 to D55)
-- 1. staff.works_from_office: the tag. Only the founder changes it (staff update is founder-only). Untagged people
--    are never late or absent and see nothing. Partners cannot be tagged.
-- 2. office_settings: one row the founder edits (hours 11:00 to 17:00, 15 minutes' leeway, Mon to Sat, which request
--    header carries the caller's real address). flags_on = false is "shadow mode": record and show, no late/early flags.
-- 3. office_holiday, office_network (the office's public addresses; the raw address of a person is never stored).
-- 4. attendance_session: one stretch of presence. Written only by the RPCs below, so the database decides the time and
--    checks the network. Several stretches a day, one open at a time. A stretch left open past its day is flagged
--    "missing check-out" and a lead fixes it: hours are never invented.
-- 5. attendance_request: "add my time" with a reason (mobile data, VPN, forgot), approved by a lead or the founder.
-- 6. attendance_day_mark: "working remotely" (own, with a reason) or "excused" (by a lead, with a reason).
-- 7. attendance_failure: a check-in that was refused for not being on the office network (so the founder sees when the
--    office address has probably changed).
-- 8. ops.attendance_days(): one row per tagged person per day for the week grid.

-- ---------------------------------------------------------------- the tag
alter table ops.staff add column works_from_office boolean not null default false;
alter table ops.staff add column office_since date;

create or replace function ops.staff_office_tag() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.works_from_office then
    if new.role = 'partner' then raise exception 'Partners can''t be tagged as working from the office'; end if;
    if tg_op = 'INSERT' or not old.works_from_office or new.office_since is null then
      new.office_since := ops.today_ist();
    elsif new.office_since is distinct from old.office_since then
      new.office_since := old.office_since;
    end if;
  else
    new.office_since := null;
  end if;
  return new;
end $$;
create trigger t_staff_office_tag before insert or update of works_from_office, role, office_since on ops.staff
  for each row execute function ops.staff_office_tag();

create or replace function ops.can_attend() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select works_from_office and role <> 'partner' from ops.staff
                   where id = auth.uid() and is_active), false)
$$;

-- ---------------------------------------------------------------- settings, holidays, networks
create table ops.office_settings (
  id            boolean primary key default true check (id),
  start_time    time not null default '11:00',
  end_time      time not null default '17:00',
  grace_minutes smallint not null default 15 check (grace_minutes between 0 and 120),
  work_days     smallint[] not null default '{1,2,3,4,5,6}',
  ip_header     text not null default 'cf-connecting-ip' check (ip_header in ('cf-connecting-ip', 'x-real-ip', 'x-forwarded-for')),
  ip_hops       smallint not null default 1 check (ip_hops between 1 and 5),
  flags_on      boolean not null default false,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references ops.staff (id) on delete set null
);
create index office_settings_updated_by_idx on ops.office_settings (updated_by);
insert into ops.office_settings default values;

create or replace function ops.office_settings_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.end_time <= new.start_time then raise exception 'Office hours must end after they start'; end if;
  if coalesce(array_length(new.work_days, 1), 0) = 0 or exists (select 1 from unnest(new.work_days) d where d not between 1 and 7) then
    raise exception 'Pick at least one working day (1 = Monday to 7 = Sunday)';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger t_office_settings_guard before insert or update on ops.office_settings
  for each row execute function ops.office_settings_guard();

create table ops.office_holiday (
  id           uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name         text not null check (char_length(btrim(name)) between 1 and 100),
  created_at   timestamptz not null default now()
);
create trigger t_office_holiday_audit after insert or update or delete on ops.office_holiday
  for each row execute function ops.audit();

create table ops.office_network (
  id           uuid primary key default gen_random_uuid(),
  label        text not null check (char_length(btrim(label)) between 1 and 80),
  cidr         cidr not null,
  is_active    boolean not null default true,
  last_seen_at timestamptz,
  created_by   uuid references ops.staff (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index office_network_created_by_idx on ops.office_network (created_by);
create trigger t_office_network_audit after insert or update or delete on ops.office_network
  for each row execute function ops.audit();

-- ---------------------------------------------------------------- sessions, requests, marks, failures
create table ops.attendance_session (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid not null references ops.staff (id) on delete cascade,
  work_date       date not null,
  check_in_at     timestamptz not null default now(),
  check_out_at    timestamptz,
  in_network_id   uuid references ops.office_network (id) on delete set null,
  out_network_id  uuid references ops.office_network (id) on delete set null,
  in_source       text not null check (in_source in ('network', 'manual')),
  out_source      text check (out_source in ('network', 'off_network', 'manual', 'correction')),
  late_minutes    integer not null default 0,
  is_late         boolean not null default false,
  early_minutes   integer not null default 0,
  left_early      boolean not null default false,
  missing_checkout boolean not null default false,
  note            text check (note is null or char_length(note) <= 500),
  corrected_by    uuid references ops.staff (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint attendance_session_order check (check_out_at is null or check_out_at >= check_in_at),
  constraint attendance_session_missing check (not missing_checkout or check_out_at is null),
  constraint attendance_session_out_source check ((check_out_at is null) = (out_source is null))
);
create index attendance_session_staff_date_idx on ops.attendance_session (staff_id, work_date);
create index attendance_session_date_idx on ops.attendance_session (work_date);
create index attendance_session_in_net_idx on ops.attendance_session (in_network_id);
create index attendance_session_out_net_idx on ops.attendance_session (out_network_id);
create index attendance_session_corrected_by_idx on ops.attendance_session (corrected_by);
create unique index attendance_one_open_idx on ops.attendance_session (staff_id)
  where check_out_at is null and not missing_checkout;
create trigger t_attendance_session_audit after insert or update or delete on ops.attendance_session
  for each row execute function ops.audit();

create table ops.attendance_request (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references ops.staff (id) on delete cascade,
  work_date     date not null,
  in_time       time not null,
  out_time      time not null,
  reason        text not null check (char_length(btrim(reason)) between 3 and 500),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by    uuid references ops.staff (id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_at    timestamptz not null default now(),
  constraint attendance_request_order check (out_time > in_time)
);
create index attendance_request_staff_idx on ops.attendance_request (staff_id, work_date);
create index attendance_request_decided_by_idx on ops.attendance_request (decided_by);
create index attendance_request_pending_idx on ops.attendance_request (status) where status = 'pending';
create trigger t_attendance_request_audit after insert or update or delete on ops.attendance_request
  for each row execute function ops.audit();

create table ops.attendance_day_mark (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references ops.staff (id) on delete cascade,
  mark_date  date not null,
  kind       text not null check (kind in ('remote', 'excused')),
  reason     text not null check (char_length(btrim(reason)) between 3 and 500),
  marked_by  uuid references ops.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (staff_id, mark_date)
);
create index attendance_day_mark_date_idx on ops.attendance_day_mark (mark_date);
create index attendance_day_mark_marked_by_idx on ops.attendance_day_mark (marked_by);
create trigger t_attendance_day_mark_audit after insert or update or delete on ops.attendance_day_mark
  for each row execute function ops.audit();

create table ops.attendance_failure (
  id           bigint generated always as identity primary key,
  staff_id     uuid not null references ops.staff (id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index attendance_failure_staff_idx on ops.attendance_failure (staff_id);
create index attendance_failure_at_idx on ops.attendance_failure (attempted_at);

-- ---------------------------------------------------------------- helpers
create or replace function ops.is_office_day(p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select extract(isodow from p_date)::int = any (s.work_days)
         and not exists (select 1 from ops.office_holiday h where h.holiday_date = p_date)
    from ops.office_settings s
$$;

-- The caller's public address as the database sees it, from the header the founder chose.
-- cf-connecting-ip is set by Cloudflare and cannot be forged by the browser; for x-forwarded-for the hop counted
-- from the right is used, because anything a client sends is added before the real address.
create or replace function ops.client_ip() returns inet
language plpgsql stable security definer set search_path = '' as $$
declare
  hdrs   json;
  s      ops.office_settings;
  raw    text;
  parts  text[];
begin
  begin
    hdrs := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return null;
  end;
  if hdrs is null then return null; end if;
  select * into s from ops.office_settings;
  raw := hdrs ->> s.ip_header;
  if raw is null then return null; end if;
  parts := string_to_array(raw, ',');
  if s.ip_header = 'x-forwarded-for' then
    raw := parts[array_length(parts, 1) - s.ip_hops + 1];
  else
    raw := parts[1];
  end if;
  raw := btrim(coalesce(raw, ''));
  if raw = '' then return null; end if;
  begin
    return raw::inet;
  exception when others then
    return null;
  end;
end $$;

create or replace function ops.network_for_ip(p_ip inet) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from ops.office_network
   where is_active and p_ip is not null and p_ip <<= cidr
   order by masklen(cidr) desc limit 1
$$;

-- Only the name of the matched network, or null. The address itself never reaches the browser.
create or replace function ops.my_network() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare n uuid; lbl text; ip inet;
begin
  if not (ops.can_attend() or ops.is_founder()) then return null; end if;
  ip := ops.client_ip();
  n := ops.network_for_ip(ip);
  select label into lbl from ops.office_network where id = n;
  return jsonb_build_object('on_network', n is not null, 'label', lbl, 'readable', ip is not null);
end $$;

-- Lateness is counted from the start time and flagged only after the leeway; "left early" the same way before the end.
-- Computed again for the whole day whenever a stretch changes: only the first stretch of a day can be late.
create or replace function ops.recompute_day_flags(p_staff uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s        ops.office_settings;
  r        record;
  first_id uuid;
  office   boolean := ops.is_office_day(p_date);
  late     integer;
  early    integer;
begin
  select * into s from ops.office_settings;
  select id into first_id from ops.attendance_session
   where staff_id = p_staff and work_date = p_date order by check_in_at limit 1;
  for r in select id, check_in_at, check_out_at from ops.attendance_session
            where staff_id = p_staff and work_date = p_date loop
    late := case when office and r.id = first_id
                 then greatest(0, ceil(extract(epoch from ((r.check_in_at at time zone 'Asia/Kolkata')::time - s.start_time)) / 60)::integer)
                 else 0 end;
    early := case when not office or r.check_out_at is null then 0
                  when (r.check_out_at at time zone 'Asia/Kolkata')::date > p_date then 0
                  else greatest(0, ceil(extract(epoch from (s.end_time - (r.check_out_at at time zone 'Asia/Kolkata')::time)) / 60)::integer)
             end;
    update ops.attendance_session
       set late_minutes = late, is_late = late > s.grace_minutes,
           early_minutes = early, left_early = early > s.grace_minutes
     where id = r.id;
  end loop;
end $$;

-- A stretch still open after its day ended: flag it, do not guess an end.
create or replace function ops.flag_missing_checkouts(p_staff uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update ops.attendance_session set missing_checkout = true
   where check_out_at is null and not missing_checkout
     and work_date < ops.today_ist()
     and (p_staff is null or staff_id = p_staff);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- check in and out
create or replace function ops.check_in() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid   uuid := auth.uid();
  today date := ops.today_ist();
  net   uuid;
  sid   uuid;
begin
  if not ops.can_attend() then raise exception 'Check-in is only for people tagged as working from the office'; end if;
  perform ops.flag_missing_checkouts(uid);
  if exists (select 1 from ops.attendance_session where staff_id = uid and check_out_at is null and not missing_checkout) then
    raise exception 'You''re already checked in';
  end if;
  net := ops.network_for_ip(ops.client_ip());
  if net is null then
    insert into ops.attendance_failure (staff_id) values (uid);
    return jsonb_build_object('ok', false, 'reason', 'not_on_network');
  end if;
  update ops.office_network set last_seen_at = now() where id = net;
  insert into ops.attendance_session (staff_id, work_date, check_in_at, in_network_id, in_source)
  values (uid, today, now(), net, 'network') returning id into sid;
  perform ops.recompute_day_flags(uid, today);
  return jsonb_build_object('ok', true, 'session_id', sid);
end $$;

-- Checking out from elsewhere is allowed (people leave the building and close the laptop on the way) and recorded as such.
create or replace function ops.check_out() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s   ops.attendance_session;
  net uuid;
begin
  if not ops.can_attend() then raise exception 'Check-out is only for people tagged as working from the office'; end if;
  select * into s from ops.attendance_session
   where staff_id = uid and check_out_at is null and not missing_checkout;
  if not found then raise exception 'You''re not checked in'; end if;
  net := ops.network_for_ip(ops.client_ip());
  if net is not null then update ops.office_network set last_seen_at = now() where id = net; end if;
  update ops.attendance_session
     set check_out_at = greatest(now(), check_in_at), out_network_id = net,
         out_source = case when net is null then 'off_network' else 'network' end
   where id = s.id;
  perform ops.recompute_day_flags(uid, s.work_date);
  return jsonb_build_object('ok', true, 'off_network', net is null);
end $$;

-- ---------------------------------------------------------------- requests and corrections
create or replace function ops.request_attendance(p_date date, p_in time, p_out time, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  today date := ops.today_ist();
  rid   uuid;
begin
  if not ops.can_attend() then raise exception 'Only people tagged as working from the office can ask for this'; end if;
  if p_date is null or p_date > today or p_date < today - 7 then
    raise exception 'You can ask for today or any of the last 7 days';
  end if;
  if p_in is null or p_out is null or p_out <= p_in then raise exception 'The leaving time must be after the arrival time'; end if;
  if p_date = today and p_out > (now() at time zone 'Asia/Kolkata')::time then
    raise exception 'You can''t ask for a time that hasn''t happened yet';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why, in a few words'; end if;
  if exists (select 1 from ops.attendance_request
              where staff_id = auth.uid() and work_date = p_date and status = 'pending'
                and in_time = p_in and out_time = p_out) then
    raise exception 'You''ve already asked for that';
  end if;
  insert into ops.attendance_request (staff_id, work_date, in_time, out_time, reason)
  values (auth.uid(), p_date, p_in, p_out, btrim(p_reason)) returning id into rid;
  return rid;
end $$;

-- A lead or the founder; nobody but the founder decides their own.
create or replace function ops.can_decide_attendance(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select ops.is_founder() or (p_staff <> auth.uid() and ops.leads_staff(p_staff))
$$;

create or replace function ops.decide_attendance_request(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r      ops.attendance_request;
  t_in   timestamptz;
  t_out  timestamptz;
begin
  select * into r from ops.attendance_request where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not ops.can_decide_attendance(r.staff_id) then
    raise exception 'Only a lead or the founder can decide this' using errcode = '42501';
  end if;
  if r.status <> 'pending' then raise exception 'This request has already been decided'; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say why it was turned down';
  end if;
  if p_approve then
    t_in := (r.work_date + r.in_time) at time zone 'Asia/Kolkata';
    t_out := (r.work_date + r.out_time) at time zone 'Asia/Kolkata';
    if exists (select 1 from ops.attendance_session a
                where a.staff_id = r.staff_id
                  and tstzrange(a.check_in_at, coalesce(a.check_out_at, 'infinity'), '[)') && tstzrange(t_in, t_out, '[)')) then
      raise exception 'That overlaps time already recorded for this person';
    end if;
    insert into ops.attendance_session (staff_id, work_date, check_in_at, check_out_at, in_source, out_source, note, corrected_by)
    values (r.staff_id, r.work_date, t_in, t_out, 'manual', 'manual', left('Added on request: ' || r.reason, 500), auth.uid());
    perform ops.recompute_day_flags(r.staff_id, r.work_date);
  end if;
  update ops.attendance_request
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;
end $$;

-- Fix a stretch that was never closed: the lead says when the person actually left, and why that is believed.
create or replace function ops.correct_checkout(p_session uuid, p_out timestamptz, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare s ops.attendance_session;
begin
  select * into s from ops.attendance_session where id = p_session for update;
  if not found then raise exception 'Record not found'; end if;
  if not ops.can_decide_attendance(s.staff_id) then
    raise exception 'Only a lead or the founder can fix this' using errcode = '42501';
  end if;
  if s.check_out_at is not null then raise exception 'This one already has a check-out'; end if;
  if p_out is null or p_out < s.check_in_at or p_out > now() or p_out > s.check_in_at + interval '16 hours' then
    raise exception 'Pick a leaving time after arrival, not in the future and within 16 hours of arriving';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say how you know when they left'; end if;
  update ops.attendance_session
     set check_out_at = p_out, out_source = 'correction', missing_checkout = false,
         corrected_by = auth.uid(), note = left(btrim(p_note), 500)
   where id = p_session;
  perform ops.recompute_day_flags(s.staff_id, s.work_date);
end $$;

-- ---------------------------------------------------------------- day marks
create or replace function ops.declare_remote(p_date date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare today date := ops.today_ist(); existing ops.attendance_day_mark;
begin
  if not ops.can_attend() then raise exception 'Only people tagged as working from the office need this'; end if;
  if p_date is null or p_date < today or p_date > today + 30 then
    raise exception 'Pick today or a day in the next 30 days';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why, in a few words'; end if;
  select * into existing from ops.attendance_day_mark where staff_id = auth.uid() and mark_date = p_date;
  if found and existing.kind = 'excused' then raise exception 'Your lead has already excused this day'; end if;
  insert into ops.attendance_day_mark (staff_id, mark_date, kind, reason, marked_by)
  values (auth.uid(), p_date, 'remote', btrim(p_reason), auth.uid())
  on conflict (staff_id, mark_date) do update set reason = excluded.reason, created_at = now();
end $$;

create or replace function ops.excuse_day(p_staff uuid, p_date date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare today date := ops.today_ist();
begin
  if not ops.can_decide_attendance(p_staff) then
    raise exception 'Only a lead or the founder can excuse a day' using errcode = '42501';
  end if;
  if not exists (select 1 from ops.staff where id = p_staff and works_from_office) then
    raise exception 'That person isn''t tagged as working from the office';
  end if;
  if p_date is null or p_date > today + 30 or p_date < today - 60 then
    raise exception 'Pick a day in the last 60 days or the next 30';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why, in a few words'; end if;
  insert into ops.attendance_day_mark (staff_id, mark_date, kind, reason, marked_by)
  values (p_staff, p_date, 'excused', btrim(p_reason), auth.uid())
  on conflict (staff_id, mark_date) do update
    set kind = 'excused', reason = excluded.reason, marked_by = excluded.marked_by, created_at = now();
end $$;

create or replace function ops.clear_day_mark(p_staff uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare m ops.attendance_day_mark;
begin
  select * into m from ops.attendance_day_mark where staff_id = p_staff and mark_date = p_date;
  if not found then return; end if;
  if not (ops.can_decide_attendance(p_staff)
          or (p_staff = auth.uid() and m.kind = 'remote' and p_date >= ops.today_ist())) then
    raise exception 'You can''t remove that' using errcode = '42501';
  end if;
  delete from ops.attendance_day_mark where id = m.id;
end $$;

-- ---------------------------------------------------------------- founder: trust the network I am on
create or replace function ops.trust_this_network(p_label text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ip   inet := ops.client_ip();
  net  uuid;
  made uuid;
begin
  if not ops.is_founder() then raise exception 'Only the founder can do this' using errcode = '42501'; end if;
  if ip is null then raise exception 'Can''t read this connection''s address; check the header setting'; end if;
  if char_length(btrim(coalesce(p_label, ''))) < 1 then raise exception 'Give the network a name'; end if;
  net := ops.network_for_ip(ip);
  if net is not null then
    update ops.office_network set last_seen_at = now() where id = net;
    return jsonb_build_object('id', net, 'created', false);
  end if;
  insert into ops.office_network (label, cidr, last_seen_at)
  values (btrim(p_label), case when family(ip) = 4 then set_masklen(ip, 32)::cidr else set_masklen(ip, 64)::cidr end, now())
  returning id into made;
  return jsonb_build_object('id', made, 'created', true);
end $$;

-- ---------------------------------------------------------------- the week grid
create or replace function ops.attendance_days(p_from date, p_to date, p_staff uuid default null)
returns table (
  staff_id uuid, work_date date, expected boolean, holiday text,
  first_in timestamptz, last_out timestamptz, minutes integer,
  is_late boolean, late_minutes integer, left_early boolean, early_minutes integer,
  is_open boolean, missing_checkout boolean, off_network_out boolean, manual boolean,
  mark text, mark_reason text)
language plpgsql stable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Pick a range of at most 62 days';
  end if;
  return query
  select st.id, d.dt, (extract(isodow from d.dt)::int = any (cfg.work_days) and h.id is null), h.name,
         a.first_in, a.last_out, a.minutes,
         coalesce(a.is_late, false), coalesce(a.late_minutes, 0), coalesce(a.left_early, false), coalesce(a.early_minutes, 0),
         coalesce(a.is_open, false), coalesce(a.missing, false), coalesce(a.off_out, false), coalesce(a.manual, false),
         m.kind, m.reason
    from ops.staff st
    cross join ops.office_settings cfg
    cross join lateral (select g::date as dt from generate_series(p_from, least(p_to, ops.today_ist()), interval '1 day') g) d
    left join ops.office_holiday h on h.holiday_date = d.dt
    left join lateral (
      select min(x.check_in_at) as first_in,
             max(x.check_out_at) as last_out,
             coalesce(sum(extract(epoch from (x.check_out_at - x.check_in_at)) / 60) filter (where x.check_out_at is not null), 0)::integer as minutes,
             bool_or(x.is_late) as is_late,
             max(x.late_minutes) as late_minutes,
             (array_agg(x.left_early order by x.check_in_at desc))[1] as left_early,
             (array_agg(x.early_minutes order by x.check_in_at desc))[1] as early_minutes,
             bool_or(x.check_out_at is null and not x.missing_checkout) as is_open,
             bool_or(x.missing_checkout) as missing,
             bool_or(x.out_source = 'off_network') as off_out,
             bool_or(x.in_source = 'manual') as manual
        from ops.attendance_session x
       where x.staff_id = st.id and x.work_date = d.dt) a on true
    left join ops.attendance_day_mark m on m.staff_id = st.id and m.mark_date = d.dt
   where st.works_from_office and st.is_active and d.dt >= st.office_since
     and ops.leads_staff(st.id)
     and (p_staff is null or st.id = p_staff)
   order by st.full_name, d.dt;
end $$;

-- ---------------------------------------------------------------- automation, me()
create or replace function ops.run_task_automation() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare made integer; sent integer; stopped integer; meetings integer; reminded integer; flagged integer;
begin
  made := ops.run_task_recurrences();
  sent := ops.run_task_reminders();
  stopped := ops.close_stale_timers();
  meetings := ops.generate_series_meetings();
  reminded := ops.run_meeting_reminders();
  flagged := ops.flag_missing_checkouts();
  return jsonb_build_object('created', made, 'reminders', sent, 'timers_stopped', stopped,
                            'meetings', meetings, 'meeting_reminders', reminded, 'missing_checkouts', flagged);
end $$;

create or replace function ops.me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('id', id, 'full_name', full_name, 'email', email,
                               'role', role, 'departments', departments,
                               'works_from_office', works_from_office and role <> 'partner')
       from ops.staff where id = auth.uid() and is_active),
    'null'::jsonb)
$$;

-- ---------------------------------------------------------------- RLS
alter table ops.office_settings enable row level security;
create policy office_settings_sel on ops.office_settings for select to authenticated
  using ((select ops.is_internal()));
create policy office_settings_upd on ops.office_settings for update to authenticated
  using ((select ops.is_founder())) with check ((select ops.is_founder()));

alter table ops.office_holiday enable row level security;
create policy office_holiday_sel on ops.office_holiday for select to authenticated
  using ((select ops.is_internal()));
create policy office_holiday_ins on ops.office_holiday for insert to authenticated
  with check ((select ops.is_founder()));
create policy office_holiday_upd on ops.office_holiday for update to authenticated
  using ((select ops.is_founder())) with check ((select ops.is_founder()));
create policy office_holiday_del on ops.office_holiday for delete to authenticated
  using ((select ops.is_founder()));

alter table ops.office_network enable row level security;
create policy office_network_sel on ops.office_network for select to authenticated
  using ((select ops.is_founder()));
create policy office_network_ins on ops.office_network for insert to authenticated
  with check ((select ops.is_founder()));
create policy office_network_upd on ops.office_network for update to authenticated
  using ((select ops.is_founder())) with check ((select ops.is_founder()));
create policy office_network_del on ops.office_network for delete to authenticated
  using ((select ops.is_founder()));

alter table ops.attendance_session enable row level security;
create policy attendance_session_sel on ops.attendance_session for select to authenticated
  using ((select ops.leads_staff(staff_id)));

alter table ops.attendance_request enable row level security;
create policy attendance_request_sel on ops.attendance_request for select to authenticated
  using ((select ops.leads_staff(staff_id)));

alter table ops.attendance_day_mark enable row level security;
create policy attendance_day_mark_sel on ops.attendance_day_mark for select to authenticated
  using ((select ops.leads_staff(staff_id)));

alter table ops.attendance_failure enable row level security;
create policy attendance_failure_sel on ops.attendance_failure for select to authenticated
  using ((select ops.is_founder()));

-- These tables change only through the functions above.
revoke insert, update, delete on ops.attendance_session, ops.attendance_request, ops.attendance_day_mark,
  ops.attendance_failure from authenticated;
revoke insert, delete on ops.office_settings from authenticated;

-- ---------------------------------------------------------------- grants
revoke execute on all functions in schema ops from public;
grant execute on function ops.can_attend(), ops.my_network(), ops.check_in(), ops.check_out(),
  ops.request_attendance(date, time, time, text), ops.decide_attendance_request(uuid, boolean, text),
  ops.correct_checkout(uuid, timestamptz, text), ops.declare_remote(date, text), ops.excuse_day(uuid, date, text),
  ops.clear_day_mark(uuid, date), ops.trust_this_network(text), ops.attendance_days(date, date, uuid),
  ops.can_decide_attendance(uuid), ops.is_office_day(date) to authenticated, service_role;
grant execute on function ops.flag_missing_checkouts(uuid) to service_role;
grant execute on function ops.run_task_automation(), ops.me() to authenticated, service_role;
