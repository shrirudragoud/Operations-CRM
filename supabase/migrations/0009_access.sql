-- 0009 access: invite-only team onboarding.
-- Flow: founder invites an email with a role + departments -> person signs in with Google/magic
-- link -> app calls ops.claim_access() -> a staff row is created from the invite.
-- No invite = no staff row = RLS shows nothing.

create table ops.invite (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email = lower(btrim(email)) and email like '%_@_%.__%'),
  full_name   text,
  role        ops.app_role not null default 'member',
  departments ops.department[] not null default '{}',
  invited_by  uuid references ops.staff(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  accepted_at timestamptz,
  accepted_by uuid references ops.staff(id)
);
-- one open invite per email
create unique index invite_open_email on ops.invite (email) where accepted_at is null;
create trigger t_invite_audit after insert or update or delete on ops.invite
  for each row execute function ops.audit();
create trigger t_staff_audit after insert or update or delete on ops.staff
  for each row execute function ops.audit();

alter table ops.invite enable row level security;
create policy invite_founder on ops.invite for all to authenticated
  using (ops.is_founder()) with check (ops.is_founder());

-- never lock the company out: the last active founder cannot be demoted, disabled or deleted
create or replace function ops.guard_last_founder() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'founder' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'founder' or not new.is_active) then
    if not exists (select 1 from ops.staff
                   where role = 'founder' and is_active and id <> old.id) then
      raise exception 'There must be at least one active founder';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger t_staff_last_founder before update or delete on ops.staff
  for each row execute function ops.guard_last_founder();

-- Called by the app right after every sign-in. Returns the caller's access state.
--   active | disabled | claimed (just created from an invite) | no_invite
create or replace function ops.claim_access() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid   uuid := auth.uid();
  mail  text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  nm    text := nullif(btrim(coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', '')), '');
  s     ops.staff%rowtype;
  inv   ops.invite%rowtype;
begin
  if uid is null then raise exception 'Not signed in'; end if;

  select * into s from ops.staff where id = uid;
  if found then
    return jsonb_build_object('status', case when s.is_active then 'active' else 'disabled' end,
                              'role', s.role, 'departments', s.departments);
  end if;

  select * into inv from ops.invite
   where email = mail and accepted_at is null and expires_at > now()
   for update;
  if not found then
    return jsonb_build_object('status', 'no_invite');
  end if;

  insert into ops.staff (id, full_name, email, role, departments)
  values (uid, coalesce(inv.full_name, nm, split_part(mail, '@', 1)), mail, inv.role, inv.departments);
  update ops.invite set accepted_at = now(), accepted_by = uid where id = inv.id;

  return jsonb_build_object('status', 'claimed', 'role', inv.role, 'departments', inv.departments);
end $$;
revoke execute on function ops.claim_access() from public, anon;
grant execute on function ops.claim_access() to authenticated;

-- what the app needs to render the shell: who am I and what may I open
create or replace function ops.me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('id', id, 'full_name', full_name, 'email', email,
                               'role', role, 'departments', departments)
       from ops.staff where id = auth.uid() and is_active),
    'null'::jsonb)
$$;
grant execute on function ops.me() to authenticated;
