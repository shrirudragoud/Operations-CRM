-- Employee portal P5: the staff directory (docs/PLAN_EMPLOYEE_PORTAL.md, section 6, row 0035).
-- Work-contact fields only: name, work email, work phone, role, departments, designation, manager.
-- The plan asked for a security_invoker view, but a view cannot read ops.staff_profile for the caller (its RLS lets a
-- person see only their own row). A security definer function returns exactly the work columns instead, and only to
-- active team members (not viewers or partners). Personal fields never leave ops.staff_profile except through RLS.
-- Birthdays are shown only for people who ticked birthday_visible; the year of birth is never returned.

create or replace function ops.directory() returns table (
  staff_id     uuid,
  full_name    text,
  email        text,
  phone        text,
  role         ops.app_role,
  departments  ops.department[],
  designation  text,
  manager_id   uuid,
  manager_name text
)
language sql stable security definer set search_path = '' as $$
  select s.id, s.full_name, s.email, s.phone, s.role, s.departments, p.designation, p.manager_id, m.full_name
    from ops.staff s
    left join ops.staff_profile p on p.staff_id = s.id
    left join ops.staff m on m.id = p.manager_id
   where ops.is_employee() and s.is_active and s.role <> 'partner'
   order by s.full_name
$$;

-- Birthdays (only when the person agreed) and work anniversaries (from the joined date) in one month.
create or replace function ops.directory_events(p_month int) returns table (
  staff_id  uuid,
  full_name text,
  kind      text,
  day       int,
  years     int
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_month is null or p_month not between 1 and 12 then
    raise exception 'The month must be between 1 and 12' using errcode = 'P0001';
  end if;
  if not ops.is_employee() then return; end if;
  return query
    select s.id, s.full_name, 'birthday'::text, extract(day from p.birth_date)::int, null::int
      from ops.staff s join ops.staff_profile p on p.staff_id = s.id
     where s.is_active and s.role <> 'partner' and p.birthday_visible and p.birth_date is not null
       and extract(month from p.birth_date) = p_month
    union all
    select s.id, s.full_name, 'anniversary'::text, extract(day from p.joined_on)::int,
           extract(year from current_date)::int - extract(year from p.joined_on)::int
      from ops.staff s join ops.staff_profile p on p.staff_id = s.id
     where s.is_active and s.role <> 'partner' and p.joined_on is not null
       and extract(month from p.joined_on) = p_month
       and extract(year from current_date)::int - extract(year from p.joined_on)::int >= 1
    order by 4, 2;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.directory(), ops.directory_events(int) to authenticated, service_role;
