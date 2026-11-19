-- Employee portal P2: the staff profile (docs/PLAN_EMPLOYEE_PORTAL.md, section 6).
-- One private row per person. Two kinds of field:
--   * personal, the person edits them: legal name, birth date, personal email and phone, address, emergency contact,
--     blood group, photo, and whether colleagues may see their birthday (birthday_visible);
--   * HR-owned, the person only reads them: employee code, designation, joined on, employment type, probation end, manager.
-- RLS: the person reads and edits their own row; HR (ops.can_hr()) reads and edits every row; nobody else reads any of it.
-- Viewers and partners have no profile access at all. The directory (0035) shows work-contact fields only.
-- HR opens a full record through ops.hr_profile(), which writes a row to ops.hr_access_log.

create table ops.staff_profile (
  staff_id           uuid primary key references ops.staff(id) on delete cascade,
  -- personal (the person edits)
  legal_name         text check (legal_name is null or char_length(btrim(legal_name)) between 1 and 120),
  birth_date         date check (birth_date is null or (birth_date >= date '1900-01-01' and birth_date <= current_date - 14 * 365)),
  personal_email     text check (personal_email is null or (char_length(personal_email) <= 200 and personal_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  personal_phone     text check (personal_phone is null or personal_phone ~ '^[0-9+() -]{7,20}$'),
  address            text check (address is null or char_length(btrim(address)) between 1 and 500),
  emergency_name     text check (emergency_name is null or char_length(btrim(emergency_name)) between 1 and 120),
  emergency_phone    text check (emergency_phone is null or emergency_phone ~ '^[0-9+() -]{7,20}$'),
  emergency_relation text check (emergency_relation is null or char_length(btrim(emergency_relation)) between 1 and 60),
  blood_group        text check (blood_group is null or blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  photo_path         text check (photo_path is null or char_length(photo_path) <= 300),
  birthday_visible   boolean not null default false,
  -- HR-owned (only HR changes them)
  employee_code      text unique check (employee_code is null or employee_code ~ '^[A-Za-z0-9-]{1,20}$'),
  designation        text check (designation is null or char_length(btrim(designation)) between 1 and 120),
  joined_on          date check (joined_on is null or joined_on >= date '2000-01-01'),
  employment_type    text check (employment_type is null or employment_type in ('full_time','part_time','intern','contract','consultant')),
  probation_end      date,
  manager_id         uuid references ops.staff(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references ops.staff(id) on delete set null,
  constraint staff_profile_emergency_pair check ((emergency_name is null) = (emergency_phone is null)),
  constraint staff_profile_probation_after_join check (probation_end is null or joined_on is null or probation_end >= joined_on),
  constraint staff_profile_not_own_manager check (manager_id is null or manager_id <> staff_id)
);
create index staff_profile_manager_idx on ops.staff_profile (manager_id);
create index staff_profile_updated_by_idx on ops.staff_profile (updated_by);

-- ---------------------------------------------------------------- who may have a profile of their own
create or replace function ops.is_employee() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role not in ('viewer', 'partner') from ops.staff where id = auth.uid() and is_active), false)
$$;

-- ---------------------------------------------------------------- guard: the person cannot touch HR-owned fields
create or replace function ops.staff_profile_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.staff_id <> old.staff_id then
      raise exception 'A profile cannot be moved to another person' using errcode = '42501';
    end if;
    if auth.uid() is not null and not ops.can_hr()
       and (new.employee_code, new.designation, new.joined_on, new.employment_type, new.probation_end, new.manager_id)
           is distinct from
           (old.employee_code, old.designation, old.joined_on, old.employment_type, old.probation_end, old.manager_id) then
      raise exception 'Only HR can change the employee code, designation, joined date, employment type, probation end or manager'
        using errcode = '42501';
    end if;
  end if;
  if new.manager_id is not null
     and not exists (select 1 from ops.staff where id = new.manager_id and is_active and role not in ('viewer', 'partner')) then
    raise exception 'A manager must be an active member of the team' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger t_staff_profile_guard before insert or update on ops.staff_profile
  for each row execute function ops.staff_profile_guard();

-- ---------------------------------------------------------------- every person gets an (empty) row
create or replace function ops.staff_profile_seed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into ops.staff_profile (staff_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger t_staff_profile_seed after insert on ops.staff
  for each row execute function ops.staff_profile_seed();
insert into ops.staff_profile (staff_id) select id from ops.staff on conflict do nothing;

-- ---------------------------------------------------------------- RLS
alter table ops.staff_profile enable row level security;
create policy staff_profile_sel on ops.staff_profile for select to authenticated
  using ((select ops.can_hr()) or (staff_id = (select auth.uid()) and (select ops.is_employee())));
create policy staff_profile_ins on ops.staff_profile for insert to authenticated
  with check ((select ops.can_hr()));
create policy staff_profile_upd on ops.staff_profile for update to authenticated
  using ((select ops.can_hr()) or (staff_id = (select auth.uid()) and (select ops.is_employee())))
  with check ((select ops.can_hr()) or (staff_id = (select auth.uid()) and (select ops.is_employee())));

-- ---------------------------------------------------------------- HR opens a full record (logged)
create or replace function ops.hr_profile(p_staff uuid) returns setof ops.staff_profile
language plpgsql security definer set search_path = '' as $$
begin
  if not ops.can_hr() then
    raise exception 'Only HR can open private records' using errcode = '42501';
  end if;
  perform ops.log_hr_access(p_staff, 'opened profile');
  return query select * from ops.staff_profile where staff_id = p_staff;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.is_employee(), ops.hr_profile(uuid) to authenticated, service_role;
