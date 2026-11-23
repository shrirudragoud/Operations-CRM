-- Files on HR requests, in both directions (builds on 0033 documents and 0034 requests).
-- 1. ops.hr_request_file: up to 5 files per message (or on the request itself), kept in the private hr-docs bucket
--    in the requester's own folder, so the storage rules from 0033 already decide who can read them.
-- 2. create_hr_request / add_hr_request_message take the files and write message + files in one transaction.
-- 3. Notifications: HR replies tell the person; the person's requests and replies tell HR. Internal notes tell nobody.
-- 4. HR can keep a copy of a reply's file on the person's record (new document kind 'letter', already verified).
-- 5. ops.open_request_file: the only way to open one; an HR open is written to hr_access_log first.

-- ---------------------------------------------------------------- a 'letter' document kind
alter table ops.staff_document drop constraint staff_document_kind_check;
alter table ops.staff_document add constraint staff_document_kind_check check (kind in (
  'id_proof', 'address_proof', 'education', 'certificate', 'offer_letter', 'contract', 'payslip', 'letter', 'other'));

-- ---------------------------------------------------------------- notifications about requests
alter table ops.notification add column request_id uuid references ops.hr_request (id) on delete cascade;
create index notification_request_idx on ops.notification (request_id);

-- Keep every kind the constraint already allows (0037 adds one) and add the three request kinds.
do $$
declare v_def text; v_kinds text[]; k text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c where c.conrelid = 'ops.notification'::regclass and c.conname = 'notification_kind_check';
  select coalesce(array_agg(distinct g[1]), '{}') into v_kinds from regexp_matches(v_def, '''([a-z_]+)''', 'g') as m(g);
  foreach k in array array['request_new', 'request_person_reply', 'request_hr_reply'] loop
    if not (k = any (v_kinds)) then v_kinds := array_append(v_kinds, k); end if;
  end loop;
  alter table ops.notification drop constraint notification_kind_check;
  execute format('alter table ops.notification add constraint notification_kind_check check (kind in (%s))',
                 (select string_agg(quote_literal(x), ', ' order by x) from unnest(v_kinds) x));
end $$;

create or replace function ops.notification_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.recipient_id := old.recipient_id;
    new.kind := old.kind;
    new.task_id := old.task_id;
    new.meeting_id := old.meeting_id;
    new.request_id := old.request_id;
    new.actor_id := old.actor_id;
    new.message := old.message;
    new.dedupe_key := old.dedupe_key;
    new.created_at := old.created_at;
    new.read_at := coalesce(old.read_at, new.read_at);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- files
create table ops.hr_request_file (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references ops.hr_request (id) on delete cascade,
  message_id  bigint references ops.hr_request_message (id) on delete cascade,
  staff_id    uuid not null references ops.staff (id) on delete cascade,
  uploaded_by uuid references ops.staff (id) on delete set null,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  path        text not null unique check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,80}$' and left(path, 36) = staff_id::text),
  mime        text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes  int not null check (size_bytes between 1 and 10485760),
  created_at  timestamptz not null default now()
);
create index hr_request_file_request_idx on ops.hr_request_file (request_id, created_at);
create index hr_request_file_message_idx on ops.hr_request_file (message_id);
create index hr_request_file_staff_idx on ops.hr_request_file (staff_id);
create index hr_request_file_uploader_idx on ops.hr_request_file (uploaded_by);

-- Written only by the RPCs below. Files never go on internal notes, so the person may see every file on their request.
alter table ops.hr_request_file enable row level security;
create policy hr_request_file_sel on ops.hr_request_file for select to authenticated
  using (staff_id = (select auth.uid()) or (select ops.can_hr()));

-- ---------------------------------------------------------------- storage: a file tied to a request is never deleted
create or replace function ops.hr_doc_object_ok(p_name text, p_mode text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_folder text := split_part(p_name, '/', 1);
begin
  if auth.uid() is null or p_name is null then return false; end if;

  if v_folder = 'company' then
    if p_mode = 'read' then
      return exists (select 1 from ops.company_document c
                      where c.path = p_name and ops.company_doc_visible(c.audience, c.is_active));
    end if;
    return ops.can_hr();
  end if;

  if v_folder !~ '^[0-9a-f-]{36}$' then return false; end if;

  if p_mode = 'delete' and exists (select 1 from ops.hr_request_file where path = p_name) then return false; end if;

  if v_folder = auth.uid()::text then
    if not ops.is_employee() then return false; end if;
    if p_mode = 'delete' then
      return not exists (select 1 from ops.staff_document where path = p_name and verified_at is not null);
    end if;
    return true;
  end if;

  if not ops.can_hr() then return false; end if;
  if p_mode = 'read' then
    return exists (select 1 from ops.hr_access_log l
                    where l.actor_id = auth.uid() and l.what = 'opened document ' || p_name
                      and l.at > now() - interval '10 minutes');
  end if;
  return true;
end $$;

-- ---------------------------------------------------------------- helpers (not callable by clients)
-- Checks a list like [{"path": "...", "name": "...", "mime": "...", "size": 123}] and stores it. Returns the count.
create or replace function ops.attach_request_files(p_request uuid, p_message bigint, p_owner uuid, p_files jsonb)
returns int
language plpgsql security definer set search_path = '' as $$
declare f jsonb; n int := 0;
begin
  if p_files is null or p_files = '[]'::jsonb then return 0; end if;
  if jsonb_typeof(p_files) <> 'array' then raise exception 'The files are not in the expected shape'; end if;
  if jsonb_array_length(p_files) > 5 then raise exception 'Attach at most 5 files at a time'; end if;
  for f in select * from jsonb_array_elements(p_files) loop
    if coalesce(f ->> 'path', '') !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,80}$'
       or left(f ->> 'path', 36) <> p_owner::text then
      raise exception 'The file must be stored in the requester''s own folder';
    end if;
    if coalesce(f ->> 'mime', '') not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then
      raise exception 'Attach a PDF or an image (JPG, PNG or WebP)';
    end if;
    if coalesce((f ->> 'size')::numeric, 0) not between 1 and 10485760 then
      raise exception 'Each file must be between 1 byte and 10 MB';
    end if;
    if char_length(btrim(coalesce(f ->> 'name', ''))) not between 1 and 120 then
      raise exception 'Each file needs a name of up to 120 characters';
    end if;
    insert into ops.hr_request_file (request_id, message_id, staff_id, uploaded_by, name, path, mime, size_bytes)
    values (p_request, p_message, p_owner, auth.uid(), btrim(f ->> 'name'), f ->> 'path', f ->> 'mime', (f ->> 'size')::int);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function ops.notify_request(p_recipient uuid, p_kind text, p_request uuid, p_actor uuid, p_message text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_recipient is null or p_recipient is not distinct from p_actor then return; end if;
  if not exists (select 1 from ops.staff where id = p_recipient and is_active) then return; end if;
  insert into ops.notification (recipient_id, kind, request_id, actor_id, message)
  values (p_recipient, p_kind, p_request, p_actor, left(p_message, 300));
end $$;

create or replace function ops.notify_hr_request(p_kind text, p_request uuid, p_actor uuid, p_message text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  for v_id in
    select id from ops.staff
     where is_active and (is_hr or role = 'founder') and role not in ('viewer', 'partner')
  loop
    perform ops.notify_request(v_id, p_kind, p_request, p_actor, p_message);
  end loop;
end $$;

-- ---------------------------------------------------------------- RPCs (the old signatures are replaced)
drop function ops.create_hr_request(text, text, text);
drop function ops.add_hr_request_message(uuid, text, boolean);

create or replace function ops.create_hr_request(p_kind text, p_subject text, p_details text default '', p_files jsonb default '[]')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_files int; v_name text;
begin
  if not ops.is_employee() then raise exception 'Only team members can ask HR' using errcode = '42501'; end if;
  if (select count(*) from ops.hr_request where staff_id = auth.uid() and state in ('open', 'in_progress')) >= 10 then
    raise exception 'You already have ten open requests. Wait for HR to answer some first.';
  end if;
  insert into ops.hr_request (staff_id, kind, subject, details)
  values (auth.uid(), p_kind, btrim(p_subject), coalesce(p_details, ''))
  returning id into v_id;
  v_files := ops.attach_request_files(v_id, null, auth.uid(), p_files);
  select full_name into v_name from ops.staff where id = auth.uid();
  perform ops.notify_hr_request('request_new', v_id, auth.uid(),
    v_name || ' asked HR: ' || btrim(p_subject)
    || case when v_files > 0 then ' (' || v_files || case when v_files = 1 then ' file)' else ' files)' end else '' end);
  return v_id;
end $$;

-- p_finish (HR only): the reply is the answer; the request is marked done with it.
-- p_keep_copy (HR only, files only): also keep each file on the person's record as a verified 'letter'.
create or replace function ops.add_hr_request_message(
  p_request uuid, p_body text, p_internal boolean default false,
  p_files jsonb default '[]', p_keep_copy boolean default false, p_finish boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r ops.hr_request; v_hr boolean := ops.can_hr(); v_internal boolean := coalesce(p_internal, false);
  v_body text := btrim(coalesce(p_body, '')); v_has_files boolean := p_files is not null and p_files <> '[]'::jsonb;
  v_msg bigint; v_files int; v_name text; v_note text;
  f record;
begin
  select * into r from ops.hr_request where id = p_request;
  if not found then raise exception 'That request does not exist'; end if;
  if not v_hr and not (r.staff_id = auth.uid() and ops.is_employee()) then
    raise exception 'You can''t write on this request' using errcode = '42501';
  end if;
  if not v_hr then
    if v_internal then raise exception 'Only HR can leave internal notes' using errcode = '42501'; end if;
    if r.state in ('done', 'rejected') then raise exception 'This request is closed. Open a new one.'; end if;
  end if;
  if v_internal and v_has_files then raise exception 'Internal notes can''t carry files'; end if;
  if p_finish and (not v_hr or v_internal) then raise exception 'Only HR can answer a request' using errcode = '42501'; end if;
  if p_finish and r.state in ('done', 'rejected') then raise exception 'This request is already closed'; end if;
  if v_body = '' then
    if not v_has_files then raise exception 'Write a message first.'; end if;
    v_body := 'Sent a file.';
  end if;

  insert into ops.hr_request_message (request_id, author_id, body, internal)
  values (p_request, auth.uid(), v_body, v_internal)
  returning id into v_msg;
  v_files := ops.attach_request_files(p_request, v_msg, r.staff_id, p_files);

  if p_keep_copy and v_hr and not v_internal and v_files > 0 then
    for f in select * from ops.hr_request_file where message_id = v_msg order by created_at, name loop
      insert into ops.staff_document (staff_id, kind, title, path, mime, size_bytes, uploaded_by, verified_by, verified_at)
      values (r.staff_id, 'letter',
              left(case when v_files = 1 then r.subject else r.subject || ' - ' || f.name end, 120),
              f.path, f.mime, f.size_bytes, auth.uid(), auth.uid(), now());
    end loop;
    perform ops.log_hr_access(r.staff_id, 'kept a copy of ' || v_files || ' file(s) from request ' || r.subject);
  end if;

  update ops.hr_request
     set updated_at = now(),
         state = case when p_finish then 'done' else state end,
         handled_by = case when p_finish then auth.uid() else handled_by end,
         resolution = case when p_finish then left(v_body, 1000) else resolution end,
         closed_at = case when p_finish then now() else closed_at end
   where id = p_request;

  if not v_internal then
    select full_name into v_name from ops.staff where id = auth.uid();
    v_note := case when v_files > 0 then ' sent ' || v_files || case when v_files = 1 then ' file' else ' files' end || ' on: '
              else ' replied on: ' end || r.subject;
    if v_hr then
      perform ops.notify_request(r.staff_id, 'request_hr_reply', p_request, auth.uid(),
        case when p_finish then 'HR answered: ' || r.subject else 'HR' || v_note end);
    else
      perform ops.notify_hr_request('request_person_reply', p_request, auth.uid(), v_name || v_note);
    end if;
  end if;
end $$;

-- Returns the storage path. HR opening someone else's file is written to the access log first; the storage policy
-- (ops.hr_doc_object_ok) reads that log row.
create or replace function ops.open_request_file(p_file uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare f ops.hr_request_file;
begin
  select * into f from ops.hr_request_file where id = p_file;
  if not found then raise exception 'That file does not exist'; end if;
  if f.staff_id = auth.uid() then
    if not ops.is_employee() then raise exception 'You can''t open this file' using errcode = '42501'; end if;
    return f.path;
  end if;
  if not ops.can_hr() then raise exception 'You can''t open this file' using errcode = '42501'; end if;
  perform ops.log_hr_access(f.staff_id, 'opened document ' || f.path);
  return f.path;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function
  ops.create_hr_request(text, text, text, jsonb),
  ops.add_hr_request_message(uuid, text, boolean, jsonb, boolean, boolean),
  ops.open_request_file(uuid)
  to authenticated, service_role;
