-- Employee portal P4: documents and policies (docs/PLAN_EMPLOYEE_PORTAL.md, rows 0033).
-- 1. A private Storage bucket `hr-docs`. Paths: `<staff id>/<uuid>-<file name>` for a person's own papers and
--    `company/<uuid>-<file name>` for the policy library. Nothing is public. The Storage policies call
--    ops.hr_doc_object_ok() so the rules live in one place and are tested in PGlite.
-- 2. staff_document: a person's papers (ID, address proof, certificates...). Written only through RPCs. HR verifies.
--    HR opening someone else's paper goes through ops.open_staff_document(), which writes the access log; the Storage
--    policy only lets HR read another person's object for ten minutes after that log row.
-- 3. company_document: the policy library (handbook, policies, forms), versioned, with an audience.
-- 4. policy_ack: "I have read this", one row per person, document and version.
-- 5. ops.expiring_documents(), ops.policy_ack_summary() for HR.

create or replace function ops.is_employee() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.staff
                 where id = auth.uid() and is_active and role in ('founder', 'dept_lead', 'member'))
$$;

-- ---------------------------------------------------------------- company library
create table ops.company_document (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(btrim(title)) between 1 and 120),
  kind         text not null default 'policy' check (kind in ('policy', 'handbook', 'form', 'other')),
  version      int not null default 1 check (version >= 1),
  audience     text not null default 'everyone' check (audience in ('everyone', 'leads', 'hr')),
  summary      text check (summary is null or char_length(summary) <= 500),
  path         text not null unique check (path ~ '^company/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,80}$'),
  mime         text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes   int not null check (size_bytes between 1 and 10485760),
  is_active    boolean not null default true,
  published_by uuid references ops.staff (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (title, version)
);
create index company_document_published_by_idx on ops.company_document (published_by);
create unique index company_document_one_active_idx on ops.company_document (lower(title)) where is_active;

-- Who may read a library entry. HR sees every entry, including retired versions.
create or replace function ops.company_doc_visible(p_audience text, p_active boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select ops.can_hr()
      or (p_active
          and ops.is_employee()
          and (p_audience = 'everyone'
               or (p_audience = 'leads'
                   and exists (select 1 from ops.staff where id = auth.uid() and role in ('founder', 'dept_lead')))))
$$;

alter table ops.company_document enable row level security;
create policy company_document_sel on ops.company_document for select to authenticated
  using ((select ops.company_doc_visible(audience, is_active)));

create trigger t_company_document_audit after insert or update or delete on ops.company_document
  for each row execute function ops.audit();

-- ---------------------------------------------------------------- a person's papers
create table ops.staff_document (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references ops.staff (id) on delete cascade,
  kind          text not null check (kind in ('id_proof', 'address_proof', 'education', 'certificate', 'offer_letter',
                                              'contract', 'payslip', 'other')),
  title         text not null check (char_length(btrim(title)) between 1 and 120),
  path          text not null unique check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,80}$'),
  mime          text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes    int not null check (size_bytes between 1 and 10485760),
  expires_on    date,
  uploaded_by   uuid references ops.staff (id) on delete set null,
  created_at    timestamptz not null default now(),
  verified_by   uuid references ops.staff (id) on delete set null,
  verified_at   timestamptz,
  verify_note   text check (verify_note is null or char_length(verify_note) <= 300),
  check (verified_at is not null or verified_by is null)
);
create index staff_document_staff_idx on ops.staff_document (staff_id, created_at desc);
create index staff_document_uploaded_by_idx on ops.staff_document (uploaded_by);
create index staff_document_verified_by_idx on ops.staff_document (verified_by);
create index staff_document_expiry_idx on ops.staff_document (expires_on) where expires_on is not null;

alter table ops.staff_document enable row level security;
create policy staff_document_sel on ops.staff_document for select to authenticated
  using (staff_id = (select auth.uid()) or (select ops.can_hr()));

create trigger t_staff_document_audit after insert or update or delete on ops.staff_document
  for each row execute function ops.audit();

-- ---------------------------------------------------------------- acknowledgements
create table ops.policy_ack (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references ops.staff (id) on delete cascade,
  document_id uuid not null references ops.company_document (id) on delete cascade,
  version     int not null,
  at          timestamptz not null default now(),
  unique (staff_id, document_id, version)
);
create index policy_ack_document_idx on ops.policy_ack (document_id);

alter table ops.policy_ack enable row level security;
create policy policy_ack_sel on ops.policy_ack for select to authenticated
  using (staff_id = (select auth.uid()) or (select ops.can_hr()));

create trigger t_policy_ack_audit after insert or update or delete on ops.policy_ack
  for each row execute function ops.audit();

-- ---------------------------------------------------------------- RPCs: papers
create or replace function ops.add_staff_document(
  p_staff uuid, p_kind text, p_title text, p_path text, p_mime text, p_size int, p_expires date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if p_staff = auth.uid() then
    if not ops.is_employee() then raise exception 'You can''t keep documents here' using errcode = '42501'; end if;
    if p_kind not in ('id_proof', 'address_proof', 'education', 'certificate', 'other') then
      raise exception 'Only HR can add that kind of document' using errcode = '42501';
    end if;
  elsif not ops.can_hr() then
    raise exception 'You can only add documents to your own record' using errcode = '42501';
  elsif not exists (select 1 from ops.staff where id = p_staff and role in ('founder', 'dept_lead', 'member')) then
    raise exception 'That person does not keep documents here';
  end if;
  if p_path is null or left(p_path, 37) <> p_staff::text || '/' then
    raise exception 'The file must be stored in the person''s own folder';
  end if;
  if p_expires is not null and p_expires < ops.today_ist() - 3650 then
    raise exception 'The expiry date looks wrong';
  end if;
  insert into ops.staff_document (staff_id, kind, title, path, mime, size_bytes, expires_on, uploaded_by)
  values (p_staff, p_kind, btrim(p_title), p_path, p_mime, p_size, p_expires, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Returns the storage path. An HR person opening someone else's paper is written to the access log first;
-- the Storage policy reads that log row (see ops.hr_doc_object_ok).
create or replace function ops.open_staff_document(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare d ops.staff_document;
begin
  select * into d from ops.staff_document where id = p_id;
  if not found then raise exception 'That document does not exist'; end if;
  if d.staff_id = auth.uid() then
    if not ops.is_employee() then raise exception 'You can''t open this document' using errcode = '42501'; end if;
    return d.path;
  end if;
  if not ops.can_hr() then raise exception 'You can''t open this document' using errcode = '42501'; end if;
  perform ops.log_hr_access(d.staff_id, 'opened document ' || d.path);
  return d.path;
end $$;

create or replace function ops.verify_staff_document(p_id uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare d ops.staff_document;
begin
  if not ops.can_hr() then raise exception 'Only HR can verify documents' using errcode = '42501'; end if;
  select * into d from ops.staff_document where id = p_id;
  if not found then raise exception 'That document does not exist'; end if;
  if d.staff_id = auth.uid() then raise exception 'You can''t verify your own document' using errcode = '42501'; end if;
  if not p_ok and (p_note is null or btrim(p_note) = '') then
    raise exception 'Say why you are not accepting the document';
  end if;
  perform ops.log_hr_access(d.staff_id, (case when p_ok then 'verified document ' else 'declined document ' end) || d.title);
  update ops.staff_document
     set verified_by = case when p_ok then auth.uid() end,
         verified_at = case when p_ok then now() end,
         verify_note = nullif(btrim(p_note), '')
   where id = p_id;
end $$;

-- Returns the storage path so the caller can remove the file. An owner can remove their own unverified paper.
create or replace function ops.delete_staff_document(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare d ops.staff_document;
begin
  select * into d from ops.staff_document where id = p_id;
  if not found then raise exception 'That document does not exist'; end if;
  if d.staff_id = auth.uid() and ops.is_employee() then
    if d.verified_at is not null then
      raise exception 'HR has verified this document. Ask HR to remove it.' using errcode = '42501';
    end if;
  elsif ops.can_hr() then
    perform ops.log_hr_access(d.staff_id, 'removed document ' || d.title);
  else
    raise exception 'You can''t remove this document' using errcode = '42501';
  end if;
  delete from ops.staff_document where id = p_id;
  return d.path;
end $$;

-- ---------------------------------------------------------------- RPCs: library
-- Publishing a title that already has an active entry retires it and starts the next version.
create or replace function ops.publish_company_document(
  p_title text, p_kind text, p_audience text, p_summary text, p_path text, p_mime text, p_size int
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_version int; v_id uuid;
begin
  if not ops.can_hr() then raise exception 'Only HR can publish documents' using errcode = '42501'; end if;
  select coalesce(max(version), 0) + 1 into v_version from ops.company_document where lower(title) = lower(btrim(p_title));
  update ops.company_document set is_active = false where lower(title) = lower(btrim(p_title)) and is_active;
  insert into ops.company_document (title, kind, version, audience, summary, path, mime, size_bytes, published_by)
  values (btrim(p_title), p_kind, v_version, p_audience, nullif(btrim(p_summary), ''), p_path, p_mime, p_size, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function ops.retire_company_document(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not ops.can_hr() then raise exception 'Only HR can retire documents' using errcode = '42501'; end if;
  update ops.company_document set is_active = false where id = p_id;
  if not found then raise exception 'That document does not exist'; end if;
end $$;

create or replace function ops.acknowledge_document(p_document uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d ops.company_document;
begin
  if not ops.is_employee() then raise exception 'Only team members can acknowledge documents' using errcode = '42501'; end if;
  select * into d from ops.company_document where id = p_document;
  if not found or not d.is_active or not ops.company_doc_visible(d.audience, d.is_active) then
    raise exception 'That document is not available to you' using errcode = '42501';
  end if;
  insert into ops.policy_ack (staff_id, document_id, version) values (auth.uid(), d.id, d.version)
  on conflict (staff_id, document_id, version) do nothing;
end $$;

-- ---------------------------------------------------------------- HR lists
create or replace function ops.expiring_documents(p_days int default 30)
returns table (document_id uuid, staff_id uuid, full_name text, kind text, title text, expires_on date, days_left int, verified boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ops.can_hr() then raise exception 'Only HR can see this list' using errcode = '42501'; end if;
  return query
    select d.id, d.staff_id, s.full_name, d.kind, d.title, d.expires_on, (d.expires_on - ops.today_ist())::int,
           d.verified_at is not null
      from ops.staff_document d join ops.staff s on s.id = d.staff_id
     where d.expires_on is not null and d.expires_on <= ops.today_ist() + greatest(p_days, 0) and s.is_active
     order by d.expires_on, s.full_name;
end $$;

-- Who has read each active entry: people it is meant for versus acknowledgements of the current version.
create or replace function ops.policy_ack_summary()
returns table (document_id uuid, title text, version int, audience text, eligible bigint, acknowledged bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ops.can_hr() then raise exception 'Only HR can see this list' using errcode = '42501'; end if;
  return query
    select c.id, c.title, c.version, c.audience,
           (select count(*) from ops.staff s
             where s.is_active and s.role in ('founder', 'dept_lead', 'member')
               and (c.audience = 'everyone'
                    or (c.audience = 'leads' and s.role in ('founder', 'dept_lead'))
                    or (c.audience = 'hr' and (s.is_hr or s.role = 'founder')))),
           (select count(*) from ops.policy_ack a where a.document_id = c.id and a.version = c.version)
      from ops.company_document c
     where c.is_active
     order by c.title;
end $$;

-- ---------------------------------------------------------------- Storage rules
-- p_mode: 'read', 'write' (upload) or 'delete'. Called from the policies on storage.objects.
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

-- The bucket and its policies only exist where Supabase Storage is installed (hosted and the local stack).
-- The in-memory test database has no storage schema, so this block skips there and the rules are tested
-- through ops.hr_doc_object_ok() above.
do $do$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('hr-docs', 'hr-docs', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
  if to_regclass('storage.objects') is not null then
    drop policy if exists hr_docs_read on storage.objects;
    drop policy if exists hr_docs_insert on storage.objects;
    drop policy if exists hr_docs_delete on storage.objects;
    create policy hr_docs_read on storage.objects for select to authenticated
      using (bucket_id = 'hr-docs' and (select ops.hr_doc_object_ok(name, 'read')));
    create policy hr_docs_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'hr-docs' and (select ops.hr_doc_object_ok(name, 'write')));
    create policy hr_docs_delete on storage.objects for delete to authenticated
      using (bucket_id = 'hr-docs' and (select ops.hr_doc_object_ok(name, 'delete')));
  end if;
end
$do$;

revoke execute on all functions in schema ops from public;
grant execute on function
  ops.is_employee(), ops.company_doc_visible(text, boolean), ops.hr_doc_object_ok(text, text),
  ops.add_staff_document(uuid, text, text, text, text, int, date), ops.open_staff_document(uuid),
  ops.verify_staff_document(uuid, boolean, text), ops.delete_staff_document(uuid),
  ops.publish_company_document(text, text, text, text, text, text, int), ops.retire_company_document(uuid),
  ops.acknowledge_document(uuid), ops.expiring_documents(int), ops.policy_ack_summary()
  to authenticated, service_role;
