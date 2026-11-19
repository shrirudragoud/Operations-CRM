-- Attendance for everyone and the month view (docs/PLAN_EMPLOYEE_PORTAL.md, P1, D63).
-- 1. staff.attendance_mode: 'office' (checks in from an office network, as before) or 'remote' (checks in from anywhere,
--    same hours, same late / early / absent flags). The tag staff.works_from_office still means "attendance is tracked
--    for this person"; the mode says how they check in.
-- 2. Sessions record where the check-in came from: 'remote' joins the existing sources.
-- 3. ops.sees_attendance(): the person, their lead, the founder, and HR. Used by the attendance tables and the month.
-- 4. ops.attendance_grid() is the one place that builds a person's days (whole range, future days too, with `tracked`);
--    ops.attendance_days() (the week grids) and ops.attendance_month() both read it.

alter table ops.staff add column attendance_mode text not null default 'office'
  check (attendance_mode in ('office', 'remote'));

alter table ops.attendance_session drop constraint attendance_session_in_source_check;
alter table ops.attendance_session add constraint attendance_session_in_source_check
  check (in_source in ('network', 'manual', 'remote'));
alter table ops.attendance_session drop constraint attendance_session_out_source_check;
alter table ops.attendance_session add constraint attendance_session_out_source_check
  check (out_source in ('network', 'off_network', 'manual', 'correction', 'remote'));

create or replace function ops.sees_attendance(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select ops.leads_staff(p_staff) or ops.can_hr()
$$;

drop policy attendance_session_sel on ops.attendance_session;
create policy attendance_session_sel on ops.attendance_session for select to authenticated
  using ((select ops.sees_attendance(staff_id)));
drop policy attendance_request_sel on ops.attendance_request;
create policy attendance_request_sel on ops.attendance_request for select to authenticated
  using ((select ops.sees_attendance(staff_id)));
drop policy attendance_day_mark_sel on ops.attendance_day_mark;
create policy attendance_day_mark_sel on ops.attendance_day_mark for select to authenticated
  using ((select ops.sees_attendance(staff_id)));

-- ---------------------------------------------------------------- check in and out
create or replace function ops.check_in() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid    uuid := auth.uid();
  today  date := ops.today_ist();
  net    uuid;
  sid    uuid;
  remote boolean;
begin
  if not ops.can_attend() then raise exception 'Attendance is not switched on for you'; end if;
  perform ops.flag_missing_checkouts(uid);
  if exists (select 1 from ops.attendance_session where staff_id = uid and check_out_at is null and not missing_checkout) then
    raise exception 'You''re already checked in';
  end if;
  select attendance_mode = 'remote' into remote from ops.staff where id = uid;
  if not remote then
    net := ops.network_for_ip(ops.client_ip());
    if net is null then
      insert into ops.attendance_failure (staff_id) values (uid);
      return jsonb_build_object('ok', false, 'reason', 'not_on_network');
    end if;
    update ops.office_network set last_seen_at = now() where id = net;
  end if;
  insert into ops.attendance_session (staff_id, work_date, check_in_at, in_network_id, in_source)
  values (uid, today, now(), net, case when remote then 'remote' else 'network' end) returning id into sid;
  perform ops.recompute_day_flags(uid, today);
  return jsonb_build_object('ok', true, 'session_id', sid);
end $$;

create or replace function ops.check_out() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid    uuid := auth.uid();
  s      ops.attendance_session;
  net    uuid;
  remote boolean;
begin
  if not ops.can_attend() then raise exception 'Attendance is not switched on for you'; end if;
  select * into s from ops.attendance_session
   where staff_id = uid and check_out_at is null and not missing_checkout;
  if not found then raise exception 'You''re not checked in'; end if;
  select attendance_mode = 'remote' into remote from ops.staff where id = uid;
  if not remote then
    net := ops.network_for_ip(ops.client_ip());
    if net is not null then update ops.office_network set last_seen_at = now() where id = net; end if;
  end if;
  update ops.attendance_session
     set check_out_at = greatest(now(), check_in_at), out_network_id = net,
         out_source = case when remote then 'remote' when net is null then 'off_network' else 'network' end
   where id = s.id;
  perform ops.recompute_day_flags(uid, s.work_date);
  return jsonb_build_object('ok', true, 'off_network', not remote and net is null);
end $$;

-- ---------------------------------------------------------------- the grid
drop function ops.attendance_days(date, date, uuid);

create or replace function ops.attendance_grid(p_from date, p_to date, p_staff uuid)
returns table (
  staff_id uuid, work_date date, expected boolean, holiday text,
  first_in timestamptz, last_out timestamptz, minutes integer,
  is_late boolean, late_minutes integer, left_early boolean, early_minutes integer,
  is_open boolean, missing_checkout boolean, off_network_out boolean, manual boolean,
  mark text, mark_reason text, remote boolean, tracked boolean)
language sql stable set search_path = '' as $$
  select st.id, d.dt, (extract(isodow from d.dt)::int = any (cfg.work_days) and h.id is null), h.name,
         a.first_in, a.last_out, coalesce(a.minutes, 0),
         coalesce(a.is_late, false), coalesce(a.late_minutes, 0), coalesce(a.left_early, false), coalesce(a.early_minutes, 0),
         coalesce(a.is_open, false), coalesce(a.missing, false), coalesce(a.off_out, false), coalesce(a.manual, false),
         m.kind, m.reason, coalesce(a.remote, st.attendance_mode = 'remote'), d.dt >= st.office_since
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
   where st.works_from_office and st.is_active
     and ops.sees_attendance(st.id)
     and (p_staff is null or st.id = p_staff)
   order by st.full_name, d.dt
$$;

create or replace function ops.attendance_days(p_from date, p_to date, p_staff uuid default null)
returns table (
  staff_id uuid, work_date date, expected boolean, holiday text,
  first_in timestamptz, last_out timestamptz, minutes integer,
  is_late boolean, late_minutes integer, left_early boolean, early_minutes integer,
  is_open boolean, missing_checkout boolean, off_network_out boolean, manual boolean,
  mark text, mark_reason text, remote boolean)
language plpgsql stable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Pick a range of at most 62 days';
  end if;
  return query
  select g.staff_id, g.work_date, g.expected, g.holiday, g.first_in, g.last_out, g.minutes, g.is_late, g.late_minutes,
         g.left_early, g.early_minutes, g.is_open, g.missing_checkout, g.off_network_out, g.manual, g.mark, g.mark_reason, g.remote
    from ops.attendance_grid(p_from, least(p_to, ops.today_ist()), p_staff) g
   where g.tracked;
end $$;

-- One person's calendar month, future days included (holidays and days off show ahead of time).
create or replace function ops.attendance_month(p_staff uuid, p_month date)
returns table (
  staff_id uuid, work_date date, expected boolean, holiday text,
  first_in timestamptz, last_out timestamptz, minutes integer,
  is_late boolean, late_minutes integer, left_early boolean, early_minutes integer,
  is_open boolean, missing_checkout boolean, off_network_out boolean, manual boolean,
  mark text, mark_reason text, remote boolean, tracked boolean)
language plpgsql stable set search_path = '' as $$
declare first_day date := date_trunc('month', p_month)::date;
begin
  if p_staff is null or p_month is null then raise exception 'Choose a person and a month'; end if;
  return query
  select * from ops.attendance_grid(first_day, (first_day + interval '1 month - 1 day')::date, p_staff);
end $$;

-- ---------------------------------------------------------------- me()
create or replace function ops.me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('id', id, 'full_name', full_name, 'email', email,
                               'role', role, 'departments', departments,
                               'works_from_office', works_from_office and role <> 'partner',
                               'is_hr', is_hr and role not in ('viewer', 'partner'),
                               'attendance_mode', attendance_mode)
       from ops.staff where id = auth.uid() and is_active),
    'null'::jsonb)
$$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.sees_attendance(uuid), ops.attendance_grid(date, date, uuid), ops.attendance_days(date, date, uuid),
                          ops.attendance_month(uuid, date) to authenticated, service_role;
