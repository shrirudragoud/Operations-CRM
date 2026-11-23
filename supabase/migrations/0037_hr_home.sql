-- People & HR home: what needs doing today, who is where, and sending a file to a person.
-- Read-only security-definer functions gated by ops.can_hr(), plus one write: ops.hr_send_document, which stores a
-- paper on a person's record already verified and tells them, in one transaction.

-- ---------------------------------------------------------------- a notification kind for "HR sent you a file"
-- Keep every kind the constraint already allows (another migration may have added some) and add the new one.
do $$
declare v_def text; v_kinds text[];
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c where c.conrelid = 'ops.notification'::regclass and c.conname = 'notification_kind_check';
  select coalesce(array_agg(distinct g[1]), '{}') into v_kinds from regexp_matches(v_def, '''([a-z_]+)''', 'g') as m(g);
  if not ('hr_file' = any (v_kinds)) then v_kinds := array_append(v_kinds, 'hr_file'); end if;
  alter table ops.notification drop constraint notification_kind_check;
  execute format('alter table ops.notification add constraint notification_kind_check check (kind in (%s))',
                 (select string_agg(quote_literal(k), ', ' order by k) from unnest(v_kinds) k));
end $$;

-- ---------------------------------------------------------------- what needs action
-- One prioritised list. Urgent rows first, then oldest first. At most 30 per kind; ops.hr_counts() has the true totals.
create or replace function ops.hr_actions()
returns table (
  kind      text,
  ref_id    text,
  staff_id  uuid,
  full_name text,
  title     text,
  detail    text,
  since     timestamptz,
  due_on    date,
  urgent    boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := ops.today_ist();
begin
  if not ops.can_hr() then raise exception 'Only HR can see this list' using errcode = '42501'; end if;
  return query
  with leave_rows as (
    select 'leave'::text k, r.id::text ref, r.staff_id sid, s.full_name nm, t.name ttl,
           r.days::text || case when r.days = 1 then ' day' else ' days' end dtl,
           r.created_at sn, r.from_date dd, r.from_date <= v_today + 1 urg,
           row_number() over (order by r.created_at) rn
      from ops.leave_request r
      join ops.staff s on s.id = r.staff_id
      join ops.leave_type t on t.id = r.leave_type_id
     where r.state = 'pending' and s.is_active
  ), request_rows as (
    select 'request'::text, q.id::text, q.staff_id, s.full_name, q.subject, q.kind,
           q.created_at, null::date, q.created_at < now() - interval '3 days',
           row_number() over (order by q.created_at)
      from ops.hr_request q join ops.staff s on s.id = q.staff_id
     where q.state = 'open' and s.is_active
  ), document_rows as (
    select 'document'::text, d.id::text, d.staff_id, s.full_name, d.title, d.kind,
           d.created_at, null::date, d.created_at < now() - interval '3 days',
           row_number() over (order by d.created_at)
      from ops.staff_document d join ops.staff s on s.id = d.staff_id
     where d.verified_at is null and d.verify_note is null and s.is_active
  ), expiring_rows as (
    select 'expiring'::text, d.id::text, d.staff_id, s.full_name, d.title, d.kind,
           null::timestamptz, d.expires_on, d.expires_on <= v_today + 7,
           row_number() over (order by d.expires_on)
      from ops.staff_document d join ops.staff s on s.id = d.staff_id
     where d.expires_on is not null and d.expires_on <= v_today + 30 and s.is_active
  ), onboarding_rows as (
    select 'onboarding'::text, o.id::text, o.staff_id, s.full_name, o.title, o.kind || ' - ' || o.owner,
           o.created_at, o.due_on, o.due_on < v_today,
           row_number() over (order by o.due_on, o.created_at)
      from ops.onboarding_task o join ops.staff s on s.id = o.staff_id
     where o.done_at is null and o.due_on <= v_today and s.is_active
  ), everything as (
    select * from leave_rows union all select * from request_rows union all select * from document_rows
    union all select * from expiring_rows union all select * from onboarding_rows
  )
  select e.k, e.ref, e.sid, e.nm, e.ttl, e.dtl, e.sn, e.dd, e.urg
    from everything e
   where e.rn <= 30
   order by e.urg desc, coalesce(e.sn, e.dd::timestamptz) asc, e.nm;
end $$;

-- True totals for the headline strip.
create or replace function ops.hr_counts()
returns table (
  leave_pending    bigint,
  requests_waiting bigint,
  docs_to_verify   bigint,
  docs_expiring    bigint,
  onboarding_due   bigint,
  headcount        bigint,
  on_leave_today   bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := ops.today_ist();
begin
  if not ops.can_hr() then raise exception 'Only HR can see this list' using errcode = '42501'; end if;
  return query select
    (select count(*) from ops.leave_request r join ops.staff s on s.id = r.staff_id where r.state = 'pending' and s.is_active),
    (select count(*) from ops.hr_request q join ops.staff s on s.id = q.staff_id where q.state = 'open' and s.is_active),
    (select count(*) from ops.staff_document d join ops.staff s on s.id = d.staff_id
      where d.verified_at is null and d.verify_note is null and s.is_active),
    (select count(*) from ops.staff_document d join ops.staff s on s.id = d.staff_id
      where d.expires_on is not null and d.expires_on <= v_today + 30 and s.is_active),
    (select count(*) from ops.onboarding_task o join ops.staff s on s.id = o.staff_id
      where o.done_at is null and o.due_on <= v_today and s.is_active),
    (select count(*) from ops.staff where is_active and role in ('founder', 'dept_lead', 'member')),
    (select count(distinct r.staff_id) from ops.leave_request r join ops.staff s on s.id = r.staff_id
      where r.state = 'approved' and s.is_active and v_today between r.from_date and r.to_date);
end $$;

-- ---------------------------------------------------------------- who is where
-- list: on_leave | joining | leaving | probation | setup_gap | birthday | anniversary.
-- Birthdays follow the same privacy rule as the directory: only people who chose to show theirs, never the year.
create or replace function ops.hr_overview()
returns table (list text, staff_id uuid, full_name text, on_date date, detail text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := ops.today_ist();
  v_month_start date := date_trunc('month', ops.today_ist())::date;
  v_month_end date := (date_trunc('month', ops.today_ist()) + interval '1 month' - interval '1 day')::date;
begin
  if not ops.can_hr() then raise exception 'Only HR can see this list' using errcode = '42501'; end if;
  return query
  select 'on_leave'::text, r.staff_id, s.full_name, r.to_date, t.name
    from ops.leave_request r join ops.staff s on s.id = r.staff_id join ops.leave_type t on t.id = r.leave_type_id
   where r.state = 'approved' and s.is_active and v_today between r.from_date and r.to_date
  union all
  select 'joining', p.staff_id, s.full_name, p.joined_on,
         case when p.joined_on > v_today then 'Joins' else 'Joined' end
    from ops.staff_profile p join ops.staff s on s.id = p.staff_id
   where s.is_active and p.joined_on between v_month_start and v_month_end
  union all
  select 'leaving', o.staff_id, s.full_name, max(o.due_on),
         (count(*) - count(o.done_at))::text || ' of ' || count(*)::text || ' steps left'
    from ops.onboarding_task o join ops.staff s on s.id = o.staff_id
   where o.kind = 'leaver'
   group by o.staff_id, s.full_name
  having count(o.done_at) < count(*)
  union all
  select 'probation', p.staff_id, s.full_name, p.probation_end, ''
    from ops.staff_profile p join ops.staff s on s.id = p.staff_id
   where s.is_active and p.probation_end between v_today and v_today + 30
  union all
  select 'setup_gap', s.id, s.full_name, p.joined_on,
         concat_ws(' and ',
           case when p.staff_id is null or p.legal_name is null or p.birth_date is null or p.emergency_name is null
                then 'profile details' end,
           case when not exists (select 1 from ops.staff_document d
                                  where d.staff_id = s.id and d.kind = 'id_proof' and d.verified_at is not null)
                then 'a verified ID proof' end)
    from ops.staff s left join ops.staff_profile p on p.staff_id = s.id
   where s.is_active and s.role in ('founder', 'dept_lead', 'member')
     and (p.joined_on >= v_today - 90
          or exists (select 1 from ops.onboarding_task o where o.staff_id = s.id and o.kind = 'joiner' and o.done_at is null))
     and (p.staff_id is null or p.legal_name is null or p.birth_date is null or p.emergency_name is null
          or not exists (select 1 from ops.staff_document d
                          where d.staff_id = s.id and d.kind = 'id_proof' and d.verified_at is not null))
  union all
  select 'birthday', s.id, s.full_name, n.next_on, ''
    from ops.staff s join ops.staff_profile p on p.staff_id = s.id
    cross join lateral (
      select case when (p.birth_date + (extract(year from v_today) - extract(year from p.birth_date))::int * interval '1 year')::date >= v_today
                  then (p.birth_date + (extract(year from v_today) - extract(year from p.birth_date))::int * interval '1 year')::date
                  else (p.birth_date + (extract(year from v_today) - extract(year from p.birth_date) + 1)::int * interval '1 year')::date
             end as next_on) n
   where s.is_active and s.role <> 'partner' and p.birthday_visible and p.birth_date is not null
     and n.next_on <= v_today + 14
  union all
  select 'anniversary', s.id, s.full_name, n.next_on, ((extract(year from n.next_on) - extract(year from p.joined_on))::int)::text
    from ops.staff s join ops.staff_profile p on p.staff_id = s.id
    cross join lateral (
      select case when (p.joined_on + (extract(year from v_today) - extract(year from p.joined_on))::int * interval '1 year')::date >= v_today
                  then (p.joined_on + (extract(year from v_today) - extract(year from p.joined_on))::int * interval '1 year')::date
                  else (p.joined_on + (extract(year from v_today) - extract(year from p.joined_on) + 1)::int * interval '1 year')::date
             end as next_on) n
   where s.is_active and s.role <> 'partner' and p.joined_on is not null
     and n.next_on <= v_today + 14
     and extract(year from n.next_on) - extract(year from p.joined_on) >= 1
  order by 1, 4, 3;
end $$;

-- ---------------------------------------------------------------- send a file to a person
-- The paper goes onto the person's record already verified (HR is the one handing it over), is logged in the access
-- log, and the person gets a notification. The file itself is uploaded to the private bucket first, in their folder.
create or replace function ops.hr_send_document(
  p_staff uuid, p_kind text, p_title text, p_path text, p_mime text, p_size int, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_title text := btrim(coalesce(p_title, '')); v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if not ops.can_hr() then raise exception 'Only HR can send a file to a person' using errcode = '42501'; end if;
  if p_staff = auth.uid() then raise exception 'Choose someone else. Your own papers go under My documents'; end if;
  if not exists (select 1 from ops.staff where id = p_staff and is_active and role in ('founder', 'dept_lead', 'member')) then
    raise exception 'That person does not keep documents here';
  end if;
  if v_title = '' or char_length(v_title) > 120 then raise exception 'Give the file a title of up to 120 characters'; end if;
  if v_note is not null and char_length(v_note) > 300 then raise exception 'Keep the note under 300 characters'; end if;
  if p_path is null or left(p_path, 37) <> p_staff::text || '/' then
    raise exception 'The file must be stored in the person''s own folder';
  end if;

  insert into ops.staff_document (staff_id, kind, title, path, mime, size_bytes, uploaded_by, verified_by, verified_at)
  values (p_staff, p_kind, v_title, p_path, p_mime, p_size, auth.uid(), auth.uid(), now())
  returning id into v_id;

  perform ops.log_hr_access(p_staff, 'sent document ' || v_title);

  insert into ops.notification (recipient_id, kind, actor_id, message, dedupe_key)
  values (p_staff, 'hr_file', auth.uid(),
          'HR sent you a file: ' || v_title || coalesce(' - ' || v_note, ''),
          'hr_file:' || v_id::text)
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
  return v_id;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.hr_actions(), ops.hr_counts(), ops.hr_overview(),
  ops.hr_send_document(uuid, text, text, text, text, int, text)
  to authenticated, service_role;
