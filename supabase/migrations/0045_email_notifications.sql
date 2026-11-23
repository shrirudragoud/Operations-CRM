-- Email for notifications (phase 1). Every in-app notification can also be mailed to the person.
-- The database decides who gets what (a trigger on ops.notification fills ops.email_outbox, honouring each person's
-- choices); a small script outside the app (scripts/send-emails.mjs, service role) claims the queue and talks to the mail
-- provider. Nothing here sends mail itself.

-- ---------------------------------------------------------------- which notification kinds belong to which switch
create or replace function ops.email_group(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_kind in ('assigned', 'recurring') then 'assigned'
    when p_kind = 'mentioned' then 'mentions'
    when p_kind in ('due_today', 'overdue') then 'due'
    when p_kind in ('status', 'dates', 'comment') then 'activity'
    when p_kind like 'meeting\_%' then 'meetings'
    when p_kind like 'request\_%' or p_kind = 'hr_file' then 'hr'
    else null
  end
$$;

-- ---------------------------------------------------------------- each person's choices
-- No row means the defaults: on, for everything except the chatty task activity.
create table ops.email_pref (
  staff_id   uuid primary key references ops.staff (id) on delete cascade,
  enabled    boolean not null default true,
  groups     text[] not null default '{assigned,mentions,due,meetings,hr}'
             check (groups <@ array['assigned', 'mentions', 'due', 'activity', 'meetings', 'hr']),
  updated_at timestamptz not null default now()
);
alter table ops.email_pref enable row level security;
create policy email_pref_sel on ops.email_pref for select to authenticated
  using (staff_id = (select auth.uid()));

create or replace function ops.set_email_pref(p_enabled boolean, p_groups text[])
returns void
language plpgsql security definer set search_path = '' as $$
declare v_groups text[];
begin
  if auth.uid() is null or not exists (select 1 from ops.staff where id = auth.uid() and is_active) then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct g order by g), '{}') into v_groups from unnest(coalesce(p_groups, '{}')) g;
  if not (v_groups <@ array['assigned', 'mentions', 'due', 'activity', 'meetings', 'hr']) then
    raise exception 'Unknown email choice';
  end if;
  insert into ops.email_pref (staff_id, enabled, groups) values (auth.uid(), coalesce(p_enabled, true), v_groups)
  on conflict (staff_id) do update set enabled = excluded.enabled, groups = excluded.groups, updated_at = now();
end $$;

-- ---------------------------------------------------------------- the queue
create table ops.email_outbox (
  id              bigint generated always as identity primary key,
  notification_id bigint unique references ops.notification (id) on delete set null,
  recipient_id    uuid not null references ops.staff (id) on delete cascade,
  to_email        text not null,
  kind            text not null,
  subject         text not null check (length(subject) between 1 and 300),
  body            text not null check (length(body) <= 4000),
  link            text check (link is null or link like '/%'),
  status          text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts        smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  provider_id     text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index email_outbox_due_idx on ops.email_outbox (status, next_attempt_at) where status in ('queued', 'sending');
create index email_outbox_recipient_idx on ops.email_outbox (recipient_id, created_at desc);
create index email_outbox_sent_idx on ops.email_outbox (sent_at) where status = 'sent';

-- A person sees their own mail rows (nobody else's; the founder gets counts only, from ops.email_health()).
-- Writes are not allowed to anyone signed in: the trigger and the service functions below do them.
alter table ops.email_outbox enable row level security;
create policy email_outbox_sel on ops.email_outbox for select to authenticated
  using (recipient_id = (select auth.uid()));

-- ---------------------------------------------------------------- queue one row per notification
create or replace function ops.queue_notification_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  g text := ops.email_group(new.kind);
  v_link text;
begin
  if g is null then return new; end if;
  select st.email, st.is_active, coalesce(p.enabled, true) as enabled,
         coalesce(p.groups, '{assigned,mentions,due,meetings,hr}'::text[]) as groups
    into s
    from ops.staff st left join ops.email_pref p on p.staff_id = st.id
   where st.id = new.recipient_id;
  if not found or not s.is_active or not s.enabled or not (g = any (s.groups)) then return new; end if;

  v_link := case
    when new.task_id is not null then '/tasks/' || new.task_id
    when new.meeting_id is not null then '/calendar/' || new.meeting_id
    when new.kind = 'request_new' then '/hr/requests'
    when new.request_id is not null then '/me/requests'
    when new.kind = 'hr_file' then '/me/documents'
    else null
  end;
  insert into ops.email_outbox (notification_id, recipient_id, to_email, kind, subject, body, link)
  values (new.id, new.recipient_id, s.email, new.kind, left(new.message, 200), left(new.message, 4000), v_link)
  on conflict (notification_id) do nothing;
  return new;
end $$;
create trigger t_notification_email after insert on ops.notification
  for each row execute function ops.queue_notification_email();

-- A person can ask for one test mail to themselves, at most one a minute.
create or replace function ops.queue_test_email() returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  select email into v_email from ops.staff where id = auth.uid() and is_active;
  if v_email is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if exists (select 1 from ops.email_outbox where recipient_id = auth.uid() and kind = 'test' and created_at > now() - interval '1 minute') then
    raise exception 'A test email was just sent. Wait a minute and try again.';
  end if;
  insert into ops.email_outbox (recipient_id, to_email, kind, subject, body, link)
  values (auth.uid(), v_email, 'test', 'Test email from Hard-Code Ops', 'If you can read this, email notifications reach you.', '/account');
end $$;

-- ---------------------------------------------------------------- what the sender script uses (service role only)
-- Hands out due rows, grouped by person (the script sends one mail per person), never more people than the daily cap allows.
-- Rows older than a day are dropped as stale, and rows stuck "sending" for ten minutes (the script died) go back in line.
create or replace function ops.claim_emails(p_limit integer default 50, p_daily_cap integer default 90)
returns table (id bigint, recipient_id uuid, to_email text, full_name text, kind text, subject text, body text, link text, attempts smallint)
language plpgsql security definer set search_path = '' as $$
declare v_room integer;
begin
  update ops.email_outbox o set status = 'skipped', last_error = 'Too old to send'
   where o.status = 'queued' and o.created_at < now() - interval '1 day';
  update ops.email_outbox o set status = 'queued', last_error = 'Sender stopped before finishing'
   where o.status = 'sending' and o.next_attempt_at < now() - interval '10 minutes';

  select p_daily_cap - count(distinct o.provider_id) into v_room
    from ops.email_outbox o where o.status = 'sent' and o.sent_at > now() - interval '24 hours';
  v_room := least(coalesce(p_limit, 50), coalesce(v_room, p_daily_cap));
  if v_room <= 0 then return; end if;

  return query
  with who as (
    select q.recipient_id from ops.email_outbox q
     where q.status = 'queued' and q.next_attempt_at <= now()
     group by q.recipient_id order by min(q.id) limit v_room
  ), picked as (
    select q.id from ops.email_outbox q
     where q.status = 'queued' and q.next_attempt_at <= now() and q.recipient_id in (select w.recipient_id from who w)
     order by q.id for update skip locked
  ), claimed as (
    update ops.email_outbox o set status = 'sending', attempts = o.attempts + 1, next_attempt_at = now()
     where o.id in (select pk.id from picked pk)
    returning o.id, o.recipient_id, o.to_email, o.kind, o.subject, o.body, o.link, o.attempts
  )
  select c.id, c.recipient_id, c.to_email, st.full_name, c.kind, c.subject, c.body, c.link, c.attempts
    from claimed c join ops.staff st on st.id = c.recipient_id
   order by c.id;
end $$;

-- Closes rows the script was working on. Success marks them sent. Failure retries after 1, 4, 9, 16 minutes and gives up
-- after five tries, or at once when the provider says the address can never work (p_permanent). p_release is for a problem
-- on our side (a wrong key, an unverified domain): the try is not counted and the row waits five minutes.
create or replace function ops.finish_emails(p_ids bigint[], p_ok boolean, p_error text default null, p_provider_id text default null, p_permanent boolean default false, p_release boolean default false)
returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_ok then
    update ops.email_outbox set status = 'sent', sent_at = now(), provider_id = p_provider_id, last_error = null
     where id = any (p_ids) and status = 'sending';
  elsif p_release then
    update ops.email_outbox
       set status = 'queued', attempts = greatest(attempts - 1, 0), next_attempt_at = now() + interval '5 minutes',
           last_error = left(coalesce(p_error, 'Unknown error'), 500)
     where id = any (p_ids) and status = 'sending';
  else
    update ops.email_outbox
       set status = case when p_permanent or attempts >= 5 then 'failed' else 'queued' end,
           next_attempt_at = now() + (attempts * attempts) * interval '1 minute',
           last_error = left(coalesce(p_error, 'Unknown error'), 500)
     where id = any (p_ids) and status = 'sending';
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- The founder's view of the queue: counts only, never anyone's mail.
create or replace function ops.email_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ops.is_founder() then raise exception 'Only the founder can see this' using errcode = '42501'; end if;
  return jsonb_build_object(
    'queued', (select count(*) from ops.email_outbox where status in ('queued', 'sending')),
    'failed', (select count(*) from ops.email_outbox where status = 'failed' and created_at > now() - interval '7 days'),
    'sent_24h', (select count(distinct provider_id) from ops.email_outbox where status = 'sent' and sent_at > now() - interval '24 hours'),
    'oldest_queued_minutes', (select (extract(epoch from now() - min(created_at)) / 60)::int from ops.email_outbox where status = 'queued'),
    'last_error', (select last_error from ops.email_outbox where last_error is not null order by id desc limit 1)
  );
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.set_email_pref(boolean, text[]), ops.queue_test_email(), ops.email_health() to authenticated, service_role;
grant execute on function ops.claim_emails(integer, integer), ops.finish_emails(bigint[], boolean, text, text, boolean, boolean) to service_role;
