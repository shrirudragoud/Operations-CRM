-- Leave (docs/PLAN_EMPLOYEE_PORTAL.md, P3).
-- 1. leave_type: the policy HR sets in the app. Which types exist, days a year, carry forward (and a cap), and whether
--    weekends and holidays inside a leave count as leave days. Nothing about a type is hard-coded; the rows below are
--    only starting values that HR edits.
-- 2. leave_ledger: every change to a balance is a row (credit, carry, debit, reversal, adjustment). Rows are never
--    edited or deleted; a balance is the sum of its rows.
-- 3. leave_request: one application, with the days worked out by the database from the type's rules.
-- 4. RPCs: apply_leave, decide_leave, cancel_leave, hr_adjust_balance, credit_annual_quota, leave_balances, team_away.
-- 5. HR (ops.can_hr()) manages holidays, not only the founder.
-- 6. Approved leave shows in the month view and is not counted as absent (attendance_grid gains leave_name, leave_half).
--
-- Leave year = calendar year. A request may not span two years. Balances are enforced for types that "keep a balance";
-- the pending requests of a person count against what is available. Days on a request are fixed when it is made.

-- ---------------------------------------------------------------- who can take leave
create or replace function ops.can_take_leave() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role not in ('viewer', 'partner') from ops.staff where id = auth.uid() and is_active), false)
$$;

create or replace function ops.leave_eligible(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role not in ('viewer', 'partner') and is_active from ops.staff where id = p_staff), false)
$$;

-- ---------------------------------------------------------------- the policy
create table ops.leave_type (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[a-z][a-z0-9_]{1,23}$'),
  name             text not null check (char_length(btrim(name)) between 1 and 60),
  paid             boolean not null default true,
  has_balance      boolean not null default true,
  annual_quota     numeric(5,1) not null default 0 check (annual_quota >= 0 and annual_quota <= 366),
  carry_forward    boolean not null default false,
  carry_cap        numeric(5,1) check (carry_cap is null or (carry_cap >= 0 and carry_cap <= 366)),
  count_weekends   boolean not null default false,
  count_holidays   boolean not null default false,
  half_day_allowed boolean not null default true,
  needs_document   boolean not null default false,
  is_active        boolean not null default true,
  sort_order       smallint not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index leave_type_name_uniq on ops.leave_type (lower(btrim(name)));

create or replace function ops.leave_type_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception 'The code of a leave type cannot change; add a new type instead';
  end if;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end $$;
create trigger t_leave_type_guard before insert or update on ops.leave_type
  for each row execute function ops.leave_type_guard();
create trigger t_leave_type_audit after insert or update or delete on ops.leave_type
  for each row execute function ops.audit();

insert into ops.leave_type (code, name, paid, has_balance, annual_quota, carry_forward, carry_cap, half_day_allowed, sort_order) values
  ('casual',   'Casual leave',   true,  true,  12, false, null, true, 1),
  ('sick',     'Sick leave',     true,  true,  12, false, null, true, 2),
  ('earned',   'Earned leave',   true,  true,  15, true,  30,   true, 3),
  ('comp_off', 'Comp-off',       true,  true,   0, false, null, true, 4),
  ('unpaid',   'Unpaid leave',   false, false,  0, false, null, true, 5);

-- ---------------------------------------------------------------- applications
create table ops.leave_request (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references ops.staff (id) on delete cascade,
  leave_type_id uuid not null references ops.leave_type (id),
  from_date     date not null,
  to_date       date not null,
  day_part      text not null default 'full' check (day_part in ('full', 'first_half', 'second_half')),
  days          numeric(5,1) not null check (days > 0),
  reason        text not null check (char_length(btrim(reason)) between 3 and 500),
  state         text not null default 'pending' check (state in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by    uuid references ops.staff (id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(btrim(decision_note)) between 1 and 500),
  cancelled_by  uuid references ops.staff (id) on delete set null,
  cancelled_at  timestamptz,
  created_by    uuid references ops.staff (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (to_date >= from_date),
  check (extract(year from from_date) = extract(year from to_date)),
  check (day_part = 'full' or from_date = to_date)
);
create index leave_request_staff_idx on ops.leave_request (staff_id, from_date desc);
create index leave_request_type_idx on ops.leave_request (leave_type_id);
create index leave_request_decided_by_idx on ops.leave_request (decided_by);
create index leave_request_cancelled_by_idx on ops.leave_request (cancelled_by);
create index leave_request_created_by_idx on ops.leave_request (created_by);
create index leave_request_pending_idx on ops.leave_request (created_at) where state = 'pending';
create index leave_request_approved_idx on ops.leave_request (from_date, to_date) where state = 'approved';
create trigger t_leave_request_audit after insert or update or delete on ops.leave_request
  for each row execute function ops.audit();

-- ---------------------------------------------------------------- the ledger
create table ops.leave_ledger (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references ops.staff (id) on delete cascade,
  leave_type_id uuid not null references ops.leave_type (id),
  year          smallint not null check (year between 2000 and 2200),
  entry_date    date not null default current_date,
  kind          text not null check (kind in ('credit', 'carry', 'debit', 'reversal', 'adjustment')),
  days          numeric(5,1) not null check (days <> 0),
  request_id    uuid references ops.leave_request (id),
  note          text check (note is null or char_length(note) <= 500),
  created_by    uuid references ops.staff (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (kind in ('credit', 'carry', 'reversal') and days > 0 or kind = 'debit' and days < 0 or kind = 'adjustment')
);
create index leave_ledger_balance_idx on ops.leave_ledger (staff_id, leave_type_id, year);
create index leave_ledger_type_idx on ops.leave_ledger (leave_type_id);
create index leave_ledger_request_idx on ops.leave_ledger (request_id);
create index leave_ledger_created_by_idx on ops.leave_ledger (created_by);
-- The yearly quota and the carry-over are written at most once per person, type and year.
create unique index leave_ledger_credit_once on ops.leave_ledger (staff_id, leave_type_id, year) where kind = 'credit';
create unique index leave_ledger_carry_once on ops.leave_ledger (staff_id, leave_type_id, year) where kind = 'carry';

-- ---------------------------------------------------------------- days, credits
create or replace function ops.leave_days(p_type uuid, p_from date, p_to date, p_part text default 'full') returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  t  ops.leave_type;
  wd smallint[];
  n  numeric;
begin
  select * into t from ops.leave_type where id = p_type;
  if not found then raise exception 'Unknown leave type'; end if;
  if p_from is null or p_to is null then raise exception 'Pick the dates'; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;
  select work_days into wd from ops.office_settings;
  select count(*) into n
    from generate_series(0, p_to - p_from) i
   where (t.count_weekends or extract(isodow from (p_from + i))::int = any (wd))
     and (t.count_holidays or not exists (select 1 from ops.office_holiday h where h.holiday_date = p_from + i));
  if p_part <> 'full' then n := n * 0.5; end if;
  return n;
end $$;

-- The yearly quota (and carry-over) for one person. Safe to call again: each is written once.
create or replace function ops.leave_ensure_credit(p_staff uuid, p_year int) returns void
language plpgsql security definer set search_path = '' as $$
declare cur int := extract(year from ops.today_ist())::int;
begin
  if not ops.leave_eligible(p_staff) or p_year not between cur - 1 and cur + 1 then return; end if;
  -- Carry-over only from a year the system already ran for this person (never invents a past year).
  insert into ops.leave_ledger (staff_id, leave_type_id, year, entry_date, kind, days, note)
  select p_staff, t.id, p_year, make_date(p_year, 1, 1), 'carry',
         least(b.bal, coalesce(t.carry_cap, b.bal)), 'Carried forward from ' || (p_year - 1)
    from ops.leave_type t
    cross join lateral (select coalesce(sum(l.days), 0) as bal from ops.leave_ledger l
                         where l.staff_id = p_staff and l.leave_type_id = t.id and l.year = p_year - 1) b
   where t.is_active and t.has_balance and t.carry_forward and b.bal > 0 and least(b.bal, coalesce(t.carry_cap, b.bal)) > 0
     and exists (select 1 from ops.leave_ledger c where c.staff_id = p_staff and c.leave_type_id = t.id and c.year = p_year - 1 and c.kind = 'credit')
  on conflict do nothing;
  insert into ops.leave_ledger (staff_id, leave_type_id, year, entry_date, kind, days, note)
  select p_staff, t.id, p_year, make_date(p_year, 1, 1), 'credit', t.annual_quota, 'Yearly quota'
    from ops.leave_type t
   where t.is_active and t.has_balance and t.annual_quota > 0
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------- apply
create or replace function ops.apply_leave(p_type uuid, p_from date, p_to date, p_part text, p_reason text, p_staff uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid    uuid := auth.uid();
  who    uuid := coalesce(p_staff, auth.uid());
  behalf boolean := coalesce(p_staff, auth.uid()) <> auth.uid();
  today  date := ops.today_ist();
  t      ops.leave_type;
  d      numeric;
  yr     int;
  bal    numeric;
  pend   numeric;
  rid    uuid;
begin
  if not ops.can_take_leave() then raise exception 'Leave is not available to your account'; end if;
  if behalf and not ops.can_hr() then raise exception 'Only HR can record leave for someone else' using errcode = '42501'; end if;
  if not ops.leave_eligible(who) then raise exception 'That person cannot take leave'; end if;
  if p_from is null or p_to is null then raise exception 'Pick the dates'; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;
  select * into t from ops.leave_type where id = p_type and is_active;
  if not found then raise exception 'Choose a leave type that is switched on'; end if;
  if p_part is null or p_part not in ('full', 'first_half', 'second_half') then raise exception 'Choose a whole day or a half day'; end if;
  if p_part <> 'full' and p_from <> p_to then raise exception 'A half day is for a single day'; end if;
  if p_part <> 'full' and not t.half_day_allowed then raise exception '% cannot be taken as half days', t.name; end if;
  if extract(year from p_from) <> extract(year from p_to) then
    raise exception 'Apply for one calendar year at a time: split this leave at the new year';
  end if;
  if p_to - p_from >= 90 then raise exception 'Leave can be at most 90 days in one request'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why, in a few words'; end if;
  yr := extract(year from p_from)::int;
  if yr > extract(year from today)::int + 1 then raise exception 'Leave can be booked up to the end of next year'; end if;
  if not behalf and p_from < greatest(today - 14, make_date(extract(year from today)::int, 1, 1)) then
    raise exception 'Leave can start at most 14 days back, and not in an earlier year. Ask HR to record it';
  end if;

  perform pg_advisory_xact_lock(hashtext('leave:' || who::text));
  if exists (select 1 from ops.leave_request r
              where r.staff_id = who and r.state in ('pending', 'approved')
                and r.from_date <= p_to and r.to_date >= p_from
                and not (p_part <> 'full' and r.day_part <> 'full' and r.from_date = p_from and r.day_part <> p_part)) then
    raise exception 'You already have leave on some of those dates';
  end if;

  d := ops.leave_days(p_type, p_from, p_to, p_part);
  if d <= 0 then
    raise exception 'Those dates have no days to take leave on (weekends and holidays are not counted for %)', t.name;
  end if;

  perform ops.leave_ensure_credit(who, yr);
  if t.has_balance then
    select coalesce(sum(days), 0) into bal from ops.leave_ledger where staff_id = who and leave_type_id = p_type and year = yr;
    select coalesce(sum(days), 0) into pend from ops.leave_request
     where staff_id = who and leave_type_id = p_type and state = 'pending' and extract(year from from_date) = yr;
    if d > bal - pend then
      raise exception 'Not enough % left: % day(s) available, % asked', t.name, bal - pend, d;
    end if;
  end if;

  insert into ops.leave_request (staff_id, leave_type_id, from_date, to_date, day_part, days, reason, state, decided_by, decided_at, created_by)
  values (who, p_type, p_from, p_to, p_part, d, btrim(p_reason),
          case when behalf then 'approved' else 'pending' end,
          case when behalf then uid end, case when behalf then now() end, uid)
  returning id into rid;
  if behalf and t.has_balance then
    insert into ops.leave_ledger (staff_id, leave_type_id, year, entry_date, kind, days, request_id, note, created_by)
    values (who, p_type, yr, p_from, 'debit', -d, rid, 'Recorded by HR', uid);
  end if;
  return rid;
end $$;

-- ---------------------------------------------------------------- decide, cancel
create or replace function ops.decide_leave(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r   ops.leave_request;
  t   ops.leave_type;
  yr  int;
  bal numeric;
begin
  select * into r from ops.leave_request where id = p_id for update;
  if not found then raise exception 'That leave request was not found'; end if;
  if r.staff_id = uid then raise exception 'You cannot decide your own leave' using errcode = '42501'; end if;
  if not (ops.can_hr() or ops.leads_staff(r.staff_id)) then
    raise exception 'You cannot decide this request' using errcode = '42501';
  end if;
  if r.state <> 'pending' then raise exception 'That request is already %', r.state; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say why you are turning it down'; end if;

  if p_approve then
    select * into t from ops.leave_type where id = r.leave_type_id;
    yr := extract(year from r.from_date)::int;
    perform pg_advisory_xact_lock(hashtext('leave:' || r.staff_id::text));
    if t.has_balance then
      select coalesce(sum(days), 0) into bal from ops.leave_ledger
       where staff_id = r.staff_id and leave_type_id = r.leave_type_id and year = yr;
      if bal < r.days then raise exception 'Not enough % left (% day(s)) to approve this', t.name, bal; end if;
      insert into ops.leave_ledger (staff_id, leave_type_id, year, entry_date, kind, days, request_id, note, created_by)
      values (r.staff_id, r.leave_type_id, yr, r.from_date, 'debit', -r.days, r.id, null, uid);
    end if;
  end if;
  update ops.leave_request
     set state = case when p_approve then 'approved' else 'rejected' end,
         decided_by = uid, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = r.id;
end $$;

create or replace function ops.cancel_leave(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid   uuid := auth.uid();
  r     ops.leave_request;
  spent numeric;
begin
  select * into r from ops.leave_request where id = p_id for update;
  if not found then raise exception 'That leave request was not found'; end if;
  if r.staff_id <> uid and not ops.can_hr() then raise exception 'You cannot cancel this request' using errcode = '42501'; end if;
  if r.state not in ('pending', 'approved') then raise exception 'That request is already %', r.state; end if;
  if r.state = 'approved' and r.staff_id = uid and not ops.can_hr() and r.from_date <= ops.today_ist() then
    raise exception 'Leave that has started can only be cancelled by HR';
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || r.staff_id::text));
  select coalesce(sum(days), 0) into spent from ops.leave_ledger where request_id = r.id;
  if spent < 0 then
    insert into ops.leave_ledger (staff_id, leave_type_id, year, entry_date, kind, days, request_id, note, created_by)
    values (r.staff_id, r.leave_type_id, extract(year from r.from_date)::int, ops.today_ist(), 'reversal', -spent, r.id, 'Leave cancelled', uid);
  end if;
  update ops.leave_request set state = 'cancelled', cancelled_by = uid, cancelled_at = now() where id = r.id;
end $$;

-- ---------------------------------------------------------------- HR: adjust, start the year
create or replace function ops.hr_adjust_balance(p_staff uuid, p_type uuid, p_year int, p_days numeric, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t   ops.leave_type;
  bal numeric;
begin
  if not ops.can_hr() then raise exception 'Only HR can adjust a leave balance' using errcode = '42501'; end if;
  if not ops.leave_eligible(p_staff) then raise exception 'That person cannot take leave'; end if;
  select * into t from ops.leave_type where id = p_type;
  if not found then raise exception 'Unknown leave type'; end if;
  if not t.has_balance then raise exception '% does not keep a balance', t.name; end if;
  if p_days is null or p_days = 0 or abs(p_days) > 366 then raise exception 'Enter a number of days other than zero'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say why, so the record is clear later'; end if;
  if p_year not between extract(year from ops.today_ist())::int - 1 and extract(year from ops.today_ist())::int + 1 then
    raise exception 'Adjust this year, last year or next year';
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || p_staff::text));
  perform ops.leave_ensure_credit(p_staff, p_year);
  select coalesce(sum(days), 0) into bal from ops.leave_ledger where staff_id = p_staff and leave_type_id = p_type and year = p_year;
  if bal + p_days < 0 then raise exception 'That would take the balance below zero (it is % now)', bal; end if;
  insert into ops.leave_ledger (staff_id, leave_type_id, year, entry_date, kind, days, note, created_by)
  values (p_staff, p_type, p_year, ops.today_ist(), 'adjustment', p_days, btrim(p_note), auth.uid());
  if p_staff <> auth.uid() then perform ops.log_hr_access(p_staff, 'adjusted leave balance'); end if;
end $$;

-- Credit everyone for a year in one go (HR's "Start the year" button). Returns how many people were looked at.
create or replace function ops.credit_annual_quota(p_year int default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  yr int := coalesce(p_year, extract(year from ops.today_ist())::int);
  n  int := 0;
  s  uuid;
begin
  if not ops.can_hr() then raise exception 'Only HR can start the leave year' using errcode = '42501'; end if;
  for s in select id from ops.staff where is_active and role not in ('viewer', 'partner') loop
    perform ops.leave_ensure_credit(s, yr);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- reads
-- One person's balances for a year. Also makes sure the yearly quota has been credited (written once).
create or replace function ops.leave_balances(p_staff uuid, p_year int default null)
returns table (leave_type_id uuid, code text, name text, paid boolean, has_balance boolean, annual_quota numeric,
               balance numeric, pending numeric, used numeric, available numeric)
language plpgsql security definer set search_path = '' as $$
declare yr int := coalesce(p_year, extract(year from ops.today_ist())::int);
begin
  if p_staff is null then raise exception 'Choose a person'; end if;
  if p_staff <> auth.uid() and not (ops.can_hr() or ops.leads_staff(p_staff)) then
    raise exception 'You cannot see that person''s leave' using errcode = '42501';
  end if;
  if not ops.leave_eligible(p_staff) then return; end if;
  perform ops.leave_ensure_credit(p_staff, yr);
  return query
  select t.id, t.code, t.name, t.paid, t.has_balance, t.annual_quota,
         coalesce((select sum(l.days) from ops.leave_ledger l where l.staff_id = p_staff and l.leave_type_id = t.id and l.year = yr), 0),
         coalesce((select sum(r.days) from ops.leave_request r where r.staff_id = p_staff and r.leave_type_id = t.id and r.state = 'pending'
                    and extract(year from r.from_date) = yr), 0),
         coalesce((select sum(r.days) from ops.leave_request r where r.staff_id = p_staff and r.leave_type_id = t.id and r.state = 'approved'
                    and extract(year from r.from_date) = yr), 0),
         case when t.has_balance then
           coalesce((select sum(l.days) from ops.leave_ledger l where l.staff_id = p_staff and l.leave_type_id = t.id and l.year = yr), 0)
           - coalesce((select sum(r.days) from ops.leave_request r where r.staff_id = p_staff and r.leave_type_id = t.id and r.state = 'pending'
                        and extract(year from r.from_date) = yr), 0)
         end
    from ops.leave_type t
   where t.is_active or exists (select 1 from ops.leave_ledger l where l.staff_id = p_staff and l.leave_type_id = t.id and l.year = yr)
   order by t.sort_order, t.name;
end $$;

-- Who is away between two dates. Everyone sees names of people in their own departments; the leave type is shown only to
-- the person's lead, HR and the founder. HR and the founder see everyone.
create or replace function ops.team_away(p_from date, p_to date)
returns table (request_id uuid, staff_id uuid, full_name text, leave_type text, from_date date, to_date date, day_part text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ops.is_internal() then raise exception 'Not available to your account' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 93 then
    raise exception 'Pick a range of at most 93 days';
  end if;
  return query
  select r.id, s.id, s.full_name,
         case when ops.can_hr() or ops.leads_staff(s.id) then t.name end,
         r.from_date, r.to_date, r.day_part
    from ops.leave_request r
    join ops.staff s on s.id = r.staff_id
    join ops.leave_type t on t.id = r.leave_type_id
   where r.state = 'approved' and r.from_date <= p_to and r.to_date >= p_from and s.is_active
     and (ops.can_hr() or s.id = auth.uid() or ops.leads_staff(s.id) or s.departments && ops.my_departments())
   order by r.from_date, s.full_name;
end $$;

-- ---------------------------------------------------------------- the month view knows about leave
drop function ops.attendance_month(uuid, date);
drop function ops.attendance_grid(date, date, uuid);

create or replace function ops.attendance_grid(p_from date, p_to date, p_staff uuid)
returns table (
  staff_id uuid, work_date date, expected boolean, holiday text,
  first_in timestamptz, last_out timestamptz, minutes integer,
  is_late boolean, late_minutes integer, left_early boolean, early_minutes integer,
  is_open boolean, missing_checkout boolean, off_network_out boolean, manual boolean,
  mark text, mark_reason text, remote boolean, tracked boolean, leave_name text, leave_half boolean)
language sql stable set search_path = '' as $$
  select st.id, d.dt,
         (extract(isodow from d.dt)::int = any (cfg.work_days) and h.id is null and (lv.name is null or lv.half)),
         h.name,
         a.first_in, a.last_out, coalesce(a.minutes, 0),
         coalesce(a.is_late, false), coalesce(a.late_minutes, 0), coalesce(a.left_early, false), coalesce(a.early_minutes, 0),
         coalesce(a.is_open, false), coalesce(a.missing, false), coalesce(a.off_out, false), coalesce(a.manual, false),
         m.kind, m.reason, coalesce(a.remote, st.attendance_mode = 'remote'), d.dt >= st.office_since,
         case when extract(isodow from d.dt)::int = any (cfg.work_days) and h.id is null then lv.name end,
         coalesce(lv.half, false)
    from ops.staff st
    cross join ops.office_settings cfg
    cross join lateral (select g::date as dt from generate_series(p_from, p_to, interval '1 day') g) d
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
             bool_or(x.in_source = 'manual') as manual,
             bool_or(x.in_source = 'remote') as remote
        from ops.attendance_session x
       where x.staff_id = st.id and x.work_date = d.dt) a on true
    left join ops.attendance_day_mark m on m.staff_id = st.id and m.mark_date = d.dt
    left join lateral (
      select t.name, (q.day_part <> 'full') as half
        from ops.leave_request q join ops.leave_type t on t.id = q.leave_type_id
       where q.staff_id = st.id and q.state = 'approved' and d.dt between q.from_date and q.to_date
       order by (q.day_part = 'full') desc limit 1) lv on true
   where st.works_from_office and st.is_active
     and ops.sees_attendance(st.id)
     and (p_staff is null or st.id = p_staff)
   order by st.full_name, d.dt
$$;

create or replace function ops.attendance_month(p_staff uuid, p_month date)
returns table (
  staff_id uuid, work_date date, expected boolean, holiday text,
  first_in timestamptz, last_out timestamptz, minutes integer,
  is_late boolean, late_minutes integer, left_early boolean, early_minutes integer,
  is_open boolean, missing_checkout boolean, off_network_out boolean, manual boolean,
  mark text, mark_reason text, remote boolean, tracked boolean, leave_name text, leave_half boolean)
language plpgsql stable set search_path = '' as $$
declare first_day date := date_trunc('month', p_month)::date;
begin
  if p_staff is null or p_month is null then raise exception 'Choose a person and a month'; end if;
  return query
  select * from ops.attendance_grid(first_day, (first_day + interval '1 month - 1 day')::date, p_staff);
end $$;

-- ---------------------------------------------------------------- holidays are HR's too
drop policy office_holiday_ins on ops.office_holiday;
create policy office_holiday_ins on ops.office_holiday for insert to authenticated
  with check ((select ops.can_hr()));
drop policy office_holiday_upd on ops.office_holiday;
create policy office_holiday_upd on ops.office_holiday for update to authenticated
  using ((select ops.can_hr())) with check ((select ops.can_hr()));
drop policy office_holiday_del on ops.office_holiday;
create policy office_holiday_del on ops.office_holiday for delete to authenticated
  using ((select ops.can_hr()));

-- ---------------------------------------------------------------- access
alter table ops.leave_type enable row level security;
create policy leave_type_sel on ops.leave_type for select to authenticated
  using ((select ops.is_internal()));
create policy leave_type_ins on ops.leave_type for insert to authenticated
  with check ((select ops.can_hr()));
create policy leave_type_upd on ops.leave_type for update to authenticated
  using ((select ops.can_hr())) with check ((select ops.can_hr()));

alter table ops.leave_request enable row level security;
create policy leave_request_sel on ops.leave_request for select to authenticated
  using ((select ops.leads_staff(staff_id)) or (select ops.can_hr()));

alter table ops.leave_ledger enable row level security;
create policy leave_ledger_sel on ops.leave_ledger for select to authenticated
  using ((select ops.leads_staff(staff_id)) or (select ops.can_hr()));

-- Requests and the ledger change only through the functions above; types are never deleted (switch them off).
revoke insert, update, delete on ops.leave_request, ops.leave_ledger from authenticated;
revoke delete on ops.leave_type from authenticated;

revoke execute on all functions in schema ops from public;
grant execute on function ops.can_take_leave(), ops.leave_days(uuid, date, date, text),
  ops.apply_leave(uuid, date, date, text, text, uuid), ops.decide_leave(uuid, boolean, text), ops.cancel_leave(uuid),
  ops.hr_adjust_balance(uuid, uuid, int, numeric, text), ops.credit_annual_quota(int), ops.leave_balances(uuid, int),
  ops.team_away(date, date), ops.attendance_grid(date, date, uuid), ops.attendance_month(uuid, date)
  to authenticated, service_role;
