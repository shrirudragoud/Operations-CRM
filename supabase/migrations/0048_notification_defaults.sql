-- Notification defaults, in one place each. A person who never saved a choice gets these.
-- Browser: every topic. Email: every topic except "due" (due today / overdue), because the Ops dashboard already shows those
-- and the reminder repeats every day, which would mean an email a day. Anyone can still tick it on at Account.
-- People who already saved choices keep them.
create or replace function ops.default_email_groups() returns text[]
language sql immutable set search_path = '' as $$ select '{assigned,mentions,meetings,hr,activity}'::text[] $$;

create or replace function ops.default_push_groups() returns text[]
language sql immutable set search_path = '' as $$ select '{assigned,mentions,due,meetings,hr,activity}'::text[] $$;

alter table ops.email_pref alter column groups set default ops.default_email_groups();
alter table ops.push_pref alter column groups set default ops.default_push_groups();

create or replace function ops.queue_notification_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  g text := ops.email_group(new.kind);
begin
  if g is null then return new; end if;
  select st.email, st.is_active, coalesce(p.enabled, true) as enabled,
         coalesce(p.groups, ops.default_email_groups()) as groups
    into s
    from ops.staff st left join ops.email_pref p on p.staff_id = st.id
   where st.id = new.recipient_id;
  if not found or not s.is_active or not s.enabled or not (g = any (s.groups)) then return new; end if;

  insert into ops.email_outbox (notification_id, recipient_id, to_email, kind, subject, body, link)
  values (new.id, new.recipient_id, s.email, new.kind, left(new.message, 200), left(new.message, 4000), ops.notification_link(new))
  on conflict (notification_id) do nothing;
  return new;
end $$;

create or replace function ops.queue_notification_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g text := ops.email_group(new.kind);
  v_groups text[];
begin
  if g is null then return new; end if;
  select coalesce(p.groups, ops.default_push_groups()) into v_groups
    from ops.staff st left join ops.push_pref p on p.staff_id = st.id
   where st.id = new.recipient_id and st.is_active;
  if not found or not (g = any (v_groups)) then return new; end if;

  insert into ops.push_outbox (notification_id, subscription_id, recipient_id, kind, title, body, link)
  select new.id, s.id, new.recipient_id, new.kind, ops.push_title(g), left(new.message, 300), ops.notification_link(new)
    from ops.push_subscription s where s.staff_id = new.recipient_id
  on conflict (notification_id, subscription_id) do nothing;
  return new;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.default_email_groups(), ops.default_push_groups() to authenticated, service_role;
