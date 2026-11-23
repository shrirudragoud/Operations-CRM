-- Browser notifications (Web Push) and the shared notification plumbing.
-- A person turns notifications on per device (the browser hands us a subscription). The database decides who gets a push
-- (a trigger on ops.notification fills ops.push_outbox, one row per device, honouring the person's topic choices); a small
-- script outside the app (scripts/send-push.mjs, service role) claims the queue and talks to the browsers' push services.
-- Nothing here sends anything itself. Also: one rule for where a notification leads (used by email and push), a retention
-- job for the queues, and realtime for the in-app bell.

-- ---------------------------------------------------------------- where a notification leads
-- The email trigger used to send a person's reply to HR ('request_person_reply') to /me/requests; HR must land on /hr/requests.
create or replace function ops.notification_link(n ops.notification) returns text
language sql stable set search_path = '' as $$
  select case
    when n.task_id is not null then '/tasks/' || n.task_id
    when n.meeting_id is not null then '/calendar/' || n.meeting_id
    when n.kind = 'request_hr_reply' then '/me/requests'
    when n.kind like 'request\_%' or n.request_id is not null then '/hr/requests'
    when n.kind = 'hr_file' then '/me/documents'
    else null
  end
$$;

create or replace function ops.queue_notification_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  g text := ops.email_group(new.kind);
begin
  if g is null then return new; end if;
  select st.email, st.is_active, coalesce(p.enabled, true) as enabled,
         coalesce(p.groups, '{assigned,mentions,due,meetings,hr}'::text[]) as groups
    into s
    from ops.staff st left join ops.email_pref p on p.staff_id = st.id
   where st.id = new.recipient_id;
  if not found or not s.is_active or not s.enabled or not (g = any (s.groups)) then return new; end if;

  insert into ops.email_outbox (notification_id, recipient_id, to_email, kind, subject, body, link)
  values (new.id, new.recipient_id, s.email, new.kind, left(new.message, 200), left(new.message, 4000), ops.notification_link(new))
  on conflict (notification_id) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------- devices
create table ops.push_subscription (
  id          bigint generated always as identity primary key,
  staff_id    uuid not null references ops.staff (id) on delete cascade,
  endpoint    text not null unique check (endpoint like 'https://%' and length(endpoint) <= 2000),
  p256dh_key  text not null check (length(p256dh_key) between 1 and 200),
  auth_key    text not null check (length(auth_key) between 1 and 100),
  user_agent  text check (length(user_agent) <= 300),
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index push_subscription_staff_idx on ops.push_subscription (staff_id);
alter table ops.push_subscription enable row level security;
create policy push_subscription_sel on ops.push_subscription for select to authenticated
  using (staff_id = (select auth.uid()));

-- Which topics reach the browser. No row means the same defaults as email. Having a device is the master switch.
create table ops.push_pref (
  staff_id   uuid primary key references ops.staff (id) on delete cascade,
  groups     text[] not null default '{assigned,mentions,due,meetings,hr}'
             check (groups <@ array['assigned', 'mentions', 'due', 'activity', 'meetings', 'hr']),
  updated_at timestamptz not null default now()
);
alter table ops.push_pref enable row level security;
create policy push_pref_sel on ops.push_pref for select to authenticated
  using (staff_id = (select auth.uid()));

-- Registers this browser for the signed-in person. The same browser signing in as someone else moves to them.
create or replace function ops.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from ops.staff where id = auth.uid() and is_active) then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint not like 'https://%' or length(p_endpoint) > 2000 then
    raise exception 'This browser sent an invalid address for notifications';
  end if;
  insert into ops.push_subscription (staff_id, endpoint, p256dh_key, auth_key, user_agent, last_ok_at)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300), now())
  on conflict (endpoint) do update
    set staff_id = excluded.staff_id, p256dh_key = excluded.p256dh_key, auth_key = excluded.auth_key,
        user_agent = excluded.user_agent, last_ok_at = now();
  -- keep the ten most recent devices per person
  delete from ops.push_subscription
   where staff_id = auth.uid()
     and id not in (select s.id from ops.push_subscription s where s.staff_id = auth.uid()
                     order by coalesce(s.last_ok_at, s.created_at) desc, s.id desc limit 10);
end $$;

create or replace function ops.remove_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  delete from ops.push_subscription where endpoint = p_endpoint and staff_id = auth.uid();
end $$;

create or replace function ops.set_push_groups(p_groups text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_groups text[];
begin
  if auth.uid() is null or not exists (select 1 from ops.staff where id = auth.uid() and is_active) then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct g order by g), '{}') into v_groups from unnest(coalesce(p_groups, '{}')) g;
  if not (v_groups <@ array['assigned', 'mentions', 'due', 'activity', 'meetings', 'hr']) then
    raise exception 'Unknown notification choice';
  end if;
  insert into ops.push_pref (staff_id, groups) values (auth.uid(), v_groups)
  on conflict (staff_id) do update set groups = excluded.groups, updated_at = now();
end $$;

-- ---------------------------------------------------------------- the queue (one row per notification per device)
create table ops.push_outbox (
  id              bigint generated always as identity primary key,
  notification_id bigint references ops.notification (id) on delete set null,
  subscription_id bigint not null references ops.push_subscription (id) on delete cascade,
  recipient_id    uuid not null references ops.staff (id) on delete cascade,
  kind            text not null,
  title           text not null check (length(title) between 1 and 100),
  body            text not null check (length(body) <= 300),
  link            text check (link is null or link like '/%'),
  status          text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts        smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  unique (notification_id, subscription_id)
);
create index push_outbox_due_idx on ops.push_outbox (status, next_attempt_at) where status in ('queued', 'sending');
create index push_outbox_subscription_idx on ops.push_outbox (subscription_id);
create index push_outbox_recipient_idx on ops.push_outbox (recipient_id, created_at desc);
create index push_outbox_sent_idx on ops.push_outbox (sent_at) where status = 'sent';

alter table ops.push_outbox enable row level security;
create policy push_outbox_sel on ops.push_outbox for select to authenticated
  using (recipient_id = (select auth.uid()));

create or replace function ops.push_title(p_group text) returns text
language sql immutable set search_path = '' as $$
  select case p_group
    when 'assigned' then 'Assigned to you'
    when 'mentions' then 'You were mentioned'
    when 'due' then 'Task due'
    when 'activity' then 'Task update'
    when 'meetings' then 'Meeting'
    when 'hr' then 'HR'
    else 'Hard-Code Ops'
  end
$$;

create or replace function ops.queue_notification_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  g text := ops.email_group(new.kind);
  v_groups text[];
begin
  if g is null then return new; end if;
  select coalesce(p.groups, '{assigned,mentions,due,meetings,hr}'::text[]) into v_groups
    from ops.staff st left join ops.push_pref p on p.staff_id = st.id
   where st.id = new.recipient_id and st.is_active;
  if not found or not (g = any (v_groups)) then return new; end if;

  insert into ops.push_outbox (notification_id, subscription_id, recipient_id, kind, title, body, link)
  select new.id, s.id, new.recipient_id, new.kind, ops.push_title(g), left(new.message, 300), ops.notification_link(new)
    from ops.push_subscription s where s.staff_id = new.recipient_id
  on conflict (notification_id, subscription_id) do nothing;
  return new;
end $$;
create trigger t_notification_push after insert on ops.notification
  for each row execute function ops.queue_notification_push();

-- A person can send a test notification to their own devices, at most one every 20 seconds.
create or replace function ops.queue_test_push() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if auth.uid() is null or not exists (select 1 from ops.staff where id = auth.uid() and is_active) then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if not exists (select 1 from ops.push_subscription where staff_id = auth.uid()) then
    raise exception 'Turn notifications on for this device first.';
  end if;
  if exists (select 1 from ops.push_outbox where recipient_id = auth.uid() and kind = 'test' and created_at > now() - interval '20 seconds') then
    raise exception 'A test notification was just sent. Wait a moment and try again.';
  end if;
  insert into ops.push_outbox (subscription_id, recipient_id, kind, title, body, link)
  select s.id, s.staff_id, 'test', 'Hard-Code Ops', 'If you can read this, notifications reach this device.', '/account'
    from ops.push_subscription s where s.staff_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- what the sender script uses (service role only)
-- Hands out due rows. Rows older than an hour are dropped (a push that late is noise; email is the fallback), and rows
-- stuck "sending" for two minutes (the script died) go back in line.
create or replace function ops.claim_pushes(p_limit integer default 100)
returns table (id bigint, subscription_id bigint, endpoint text, p256dh_key text, auth_key text, notification_id bigint, kind text, title text, body text, link text, attempts smallint)
language plpgsql security definer set search_path = '' as $$
begin
  update ops.push_outbox o set status = 'skipped', last_error = 'Too old to send'
   where o.status = 'queued' and o.created_at < now() - interval '1 hour';
  update ops.push_outbox o set status = 'queued', last_error = 'Sender stopped before finishing'
   where o.status = 'sending' and o.next_attempt_at < now() - interval '2 minutes';

  return query
  with picked as (
    select q.id from ops.push_outbox q
     where q.status = 'queued' and q.next_attempt_at <= now()
     order by q.id limit least(coalesce(p_limit, 100), 500) for update skip locked
  ), claimed as (
    update ops.push_outbox o set status = 'sending', attempts = o.attempts + 1, next_attempt_at = now()
     where o.id in (select pk.id from picked pk)
    returning o.id, o.subscription_id, o.notification_id, o.kind, o.title, o.body, o.link, o.attempts
  )
  select c.id, c.subscription_id, s.endpoint, s.p256dh_key, s.auth_key, c.notification_id, c.kind, c.title, c.body, c.link, c.attempts
    from claimed c join ops.push_subscription s on s.id = c.subscription_id
   order by c.id;
end $$;

-- Closes rows the script was working on. Success marks them sent. p_gone (the browser says this device no longer exists)
-- removes the device. p_release is a problem on our side (a wrong key): the try is not counted. Otherwise it retries after
-- 10, 40 and 90 seconds and gives up after four tries.
create or replace function ops.finish_pushes(p_ids bigint[], p_ok boolean, p_error text default null, p_gone boolean default false, p_release boolean default false)
returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_ok then
    update ops.push_outbox set status = 'sent', sent_at = now(), last_error = null
     where id = any (p_ids) and status = 'sending';
    get diagnostics n = row_count;
    update ops.push_subscription set last_ok_at = now()
     where id in (select subscription_id from ops.push_outbox where id = any (p_ids));
  elsif p_gone then
    select count(*) into n from ops.push_outbox where id = any (p_ids) and status = 'sending';
    delete from ops.push_subscription
     where id in (select subscription_id from ops.push_outbox where id = any (p_ids) and status = 'sending');
  elsif p_release then
    update ops.push_outbox
       set status = 'queued', attempts = greatest(attempts - 1, 0), next_attempt_at = now() + interval '30 seconds',
           last_error = left(coalesce(p_error, 'Unknown error'), 500)
     where id = any (p_ids) and status = 'sending';
    get diagnostics n = row_count;
  else
    update ops.push_outbox
       set status = case when attempts >= 4 then 'failed' else 'queued' end,
           next_attempt_at = now() + (attempts * attempts) * interval '10 seconds',
           last_error = left(coalesce(p_error, 'Unknown error'), 500)
     where id = any (p_ids) and status = 'sending';
    get diagnostics n = row_count;
  end if;
  return n;
end $$;

-- Housekeeping, run by the mail sender once an hour: finished queue rows after 30 days, devices not seen for 120 days.
create or replace function ops.prune_outboxes() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e integer; p integer; d integer;
begin
  delete from ops.email_outbox where status in ('sent', 'failed', 'skipped') and created_at < now() - interval '30 days';
  get diagnostics e = row_count;
  delete from ops.push_outbox where status in ('sent', 'failed', 'skipped') and created_at < now() - interval '30 days';
  get diagnostics p = row_count;
  delete from ops.push_subscription where coalesce(last_ok_at, created_at) < now() - interval '120 days';
  get diagnostics d = row_count;
  return jsonb_build_object('email_rows', e, 'push_rows', p, 'devices', d);
end $$;

-- The founder's view of browser push: counts only.
create or replace function ops.push_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ops.is_founder() then raise exception 'Only the founder can see this' using errcode = '42501'; end if;
  return jsonb_build_object(
    'devices', (select count(*) from ops.push_subscription),
    'people', (select count(distinct staff_id) from ops.push_subscription),
    'queued', (select count(*) from ops.push_outbox where status in ('queued', 'sending')),
    'failed', (select count(*) from ops.push_outbox where status = 'failed' and created_at > now() - interval '7 days'),
    'sent_24h', (select count(*) from ops.push_outbox where status = 'sent' and sent_at > now() - interval '24 hours'),
    'oldest_queued_seconds', (select (extract(epoch from now() - min(created_at)))::int from ops.push_outbox where status = 'queued'),
    'last_error', (select last_error from ops.push_outbox where last_error is not null order by id desc limit 1)
  );
end $$;

-- ---------------------------------------------------------------- realtime for the bell
-- Each person's browser listens for new rows in ops.notification; RLS lets it see only its own.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'ops' and tablename = 'notification') then
    alter publication supabase_realtime add table ops.notification;
  end if;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.save_push_subscription(text, text, text, text), ops.remove_push_subscription(text), ops.set_push_groups(text[]),
  ops.queue_test_push(), ops.push_health() to authenticated, service_role;
grant execute on function ops.claim_pushes(integer), ops.finish_pushes(bigint[], boolean, text, boolean, boolean), ops.prune_outboxes() to service_role;
