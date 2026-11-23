-- Email lanes. The free mail plan allows 100 mails a day for everything, so the sender needs a rule for who goes first.
--   'notice' = automatic notification mail (the default; folded into one digest per person).
--   'direct' = mail a person asked for or wrote on purpose (a test mail now; customer replies later). Never merged into a
--              digest, served before any notice, and always able to use the room reserved for it.
-- Of the daily cap, p_reserve mails are kept for the direct lane: notices stop that many short of the cap, direct mail can
-- use all of it. Direct mail also waits longer before it is judged stale (3 days against 1).

alter table ops.email_outbox
  add column lane text not null default 'notice' check (lane in ('notice', 'direct'));
update ops.email_outbox set lane = 'direct' where kind = 'test';

create or replace function ops.queue_test_email() returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  select email into v_email from ops.staff where id = auth.uid() and is_active;
  if v_email is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if exists (select 1 from ops.email_outbox where recipient_id = auth.uid() and kind = 'test' and created_at > now() - interval '1 minute') then
    raise exception 'A test email was just sent. Wait a minute and try again.';
  end if;
  insert into ops.email_outbox (recipient_id, to_email, kind, lane, subject, body, link)
  values (auth.uid(), v_email, 'test', 'direct', 'Test email from Hard-Code Ops', 'If you can read this, email notifications reach you.', '/account');
end $$;

-- The return shape changes (lane is added), so the old function goes first.
drop function ops.claim_emails(integer, integer);
create function ops.claim_emails(p_limit integer default 50, p_daily_cap integer default 90, p_reserve integer default 30)
returns table (id bigint, recipient_id uuid, to_email text, full_name text, kind text, subject text, body text, link text, attempts smallint, lane text)
language plpgsql security definer set search_path = '' as $$
declare
  v_sent_all integer;
  v_sent_notice integer;
  v_room integer;
  v_room_notice integer;
begin
  update ops.email_outbox o set status = 'skipped', last_error = 'Too old to send'
   where o.status = 'queued'
     and ((o.lane = 'notice' and o.created_at < now() - interval '1 day')
       or (o.lane = 'direct' and o.created_at < now() - interval '3 days'));
  update ops.email_outbox o set status = 'queued', last_error = 'Sender stopped before finishing'
   where o.status = 'sending' and o.next_attempt_at < now() - interval '10 minutes';

  select count(distinct o.provider_id), count(distinct o.provider_id) filter (where o.lane = 'notice')
    into v_sent_all, v_sent_notice
    from ops.email_outbox o where o.status = 'sent' and o.sent_at > now() - interval '24 hours';
  v_room := least(coalesce(p_limit, 50), greatest(coalesce(p_daily_cap, 90) - v_sent_all, 0));
  v_room_notice := least(v_room, greatest(coalesce(p_daily_cap, 90) - coalesce(p_reserve, 30) - v_sent_notice, 0));
  if v_room <= 0 then return; end if;

  return query
  with ppl as (
    select q.recipient_id as rid, q.lane as ln, min(q.id) as first_id
      from ops.email_outbox q
     where q.status = 'queued' and q.next_attempt_at <= now()
     group by q.recipient_id, q.lane
  ), ranked as (
    select p.rid, p.ln,
           row_number() over (partition by p.ln order by p.first_id) as rn_lane,
           row_number() over (order by (p.ln = 'direct') desc, p.first_id) as rn_all
      from ppl p
  ), who as (
    select r.rid, r.ln from ranked r
     where r.rn_all <= v_room and (r.ln = 'direct' or r.rn_lane <= v_room_notice)
  ), picked as (
    select q.id from ops.email_outbox q
     where q.status = 'queued' and q.next_attempt_at <= now()
       and (q.recipient_id, q.lane) in (select w.rid, w.ln from who w)
     order by q.id for update skip locked
  ), claimed as (
    update ops.email_outbox o set status = 'sending', attempts = o.attempts + 1, next_attempt_at = now()
     where o.id in (select pk.id from picked pk)
    returning o.id, o.recipient_id, o.to_email, o.kind, o.subject, o.body, o.link, o.attempts, o.lane
  )
  select c.id, c.recipient_id, c.to_email, st.full_name, c.kind, c.subject, c.body, c.link, c.attempts, c.lane
    from claimed c join ops.staff st on st.id = c.recipient_id
   order by (c.lane = 'direct') desc, c.id;
end $$;

-- Health now also says how much of the day's mail was direct.
create or replace function ops.email_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ops.is_founder() then raise exception 'Only the founder can see this' using errcode = '42501'; end if;
  return jsonb_build_object(
    'queued', (select count(*) from ops.email_outbox where status in ('queued', 'sending')),
    'failed', (select count(*) from ops.email_outbox where status = 'failed' and created_at > now() - interval '7 days'),
    'sent_24h', (select count(distinct provider_id) from ops.email_outbox where status = 'sent' and sent_at > now() - interval '24 hours'),
    'sent_direct_24h', (select count(distinct provider_id) from ops.email_outbox where status = 'sent' and lane = 'direct' and sent_at > now() - interval '24 hours'),
    'oldest_queued_minutes', (select (extract(epoch from now() - min(created_at)) / 60)::int from ops.email_outbox where status = 'queued'),
    'last_error', (select last_error from ops.email_outbox where last_error is not null order by id desc limit 1)
  );
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.set_email_pref(boolean, text[]), ops.queue_test_email(), ops.email_health() to authenticated, service_role;
grant execute on function ops.claim_emails(integer, integer, integer), ops.finish_emails(bigint[], boolean, text, text, boolean, boolean) to service_role;
