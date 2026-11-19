-- Employee portal foundations (docs/PLAN_EMPLOYEE_PORTAL.md, P0).
-- 1. staff.is_hr: a flag on a person. Only the founder sets it; viewers and partners can never be HR.
-- 2. ops.can_hr(): the founder or an active HR person. Everything HR-only in later migrations asks this one question.
-- 3. ops.hr_access_log: who looked at which person's private records. HR and the person themself can read it.
-- 4. ops.me() also reports is_hr.

alter table ops.staff add column is_hr boolean not null default false;

create or replace function ops.staff_hr_flag() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role in ('viewer', 'partner') then
    new.is_hr := false;
  elsif tg_op = 'UPDATE' and new.is_hr is distinct from old.is_hr
        and auth.uid() is not null and not ops.is_founder() then
    raise exception 'Only the founder can make someone HR' using errcode = '42501';
  elsif tg_op = 'INSERT' and new.is_hr and auth.uid() is not null and not ops.is_founder() then
    raise exception 'Only the founder can make someone HR' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger t_staff_hr_flag before insert or update of is_hr, role on ops.staff
  for each row execute function ops.staff_hr_flag();

create or replace function ops.can_hr() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (is_hr or role = 'founder') and role not in ('viewer', 'partner')
                     from ops.staff where id = auth.uid() and is_active), false)
$$;

-- ---------------------------------------------------------------- access log
create table ops.hr_access_log (
  id        bigint generated always as identity primary key,
  actor_id  uuid not null references ops.staff(id),
  target_id uuid not null references ops.staff(id),
  what      text not null check (char_length(btrim(what)) between 1 and 200),
  at        timestamptz not null default now()
);
create index hr_access_log_actor_idx on ops.hr_access_log (actor_id);
create index hr_access_log_target_idx on ops.hr_access_log (target_id, at desc);

alter table ops.hr_access_log enable row level security;
create policy hr_access_log_sel on ops.hr_access_log for select to authenticated
  using ((select ops.can_hr()) or target_id = (select auth.uid()));

create or replace function ops.log_hr_access(p_target uuid, p_what text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not ops.can_hr() then
    raise exception 'Only HR can open private records' using errcode = '42501';
  end if;
  if p_target = auth.uid() then return; end if;
  insert into ops.hr_access_log (actor_id, target_id, what) values (auth.uid(), p_target, p_what);
end $$;

-- ---------------------------------------------------------------- me()
create or replace function ops.me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('id', id, 'full_name', full_name, 'email', email,
                               'role', role, 'departments', departments,
                               'works_from_office', works_from_office and role <> 'partner',
                               'is_hr', is_hr and role not in ('viewer', 'partner'))
       from ops.staff where id = auth.uid() and is_active),
    'null'::jsonb)
$$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.can_hr(), ops.log_hr_access(uuid, text) to authenticated, service_role;
