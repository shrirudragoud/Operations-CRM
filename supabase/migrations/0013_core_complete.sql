-- 0013 core complete: the last database pieces the Phase 1 screens need, so the schema can be frozen
-- while workspaces are built on top of it.
--   1. available_trainers()   trainer picker (trainer_conflict is no longer callable by users, 0012)
--   2. import_institutions()  CSV import: validate everything, dry run, all-or-nothing write
--   3. trigram search indexes for institution name/city
--   4. job_run                log of scheduled jobs (Edge Functions write it with the service role)
--   5. forget_ide_user()      DPDP erasure of IDE-user-linked rows

-- ---------------------------------------------------------------- 1. trainer picker
-- Certified (or founder) active staff, each flagged free/busy for the window. Workshop only.
-- Pass the event's own id as p_exclude_event when re-scheduling it so it does not block itself.
create or replace function ops.available_trainers(p_from timestamptz, p_to timestamptz,
                                                  p_exclude_event uuid default null)
returns table (staff_id uuid, full_name text, level text, is_free boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ops.in_dept('workshop') then
    raise exception 'Only Workshop can look up trainer availability' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a valid start and end';
  end if;
  return query
    select s.id, s.full_name, tp.level, not ops.trainer_conflict(s.id, p_from, p_to, p_exclude_event)
      from ops.staff s
      left join ops.trainer_profile tp on tp.staff_id = s.id
     where s.is_active and s.role <> 'partner'
       and (s.role = 'founder'
            or exists (select 1 from ops.v_certified_trainer c where c.staff_id = s.id))
     order by 4 desc, s.full_name;
end $$;

-- ---------------------------------------------------------------- 2. CSV import
-- p_rows: [{"name","kind","city","district","state","affiliation","source","notes","owner_email"}, ...]
-- Validates every row first. Any error (or p_dry_run) writes nothing and returns the error list, so the
-- screen can show "row 14: Already exists". Runs as the caller (RLS applies): partners can only import
-- institutions they will own, so their rows are always owned by themselves.
create or replace function ops.import_institutions(p_rows jsonb, p_dry_run boolean default true)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb; idx int := 0; n int;
  nm text; kd text; ct text; own_email text; msg text; key text; owner uuid;
  seen text[] := '{}';
  good jsonb := '[]'::jsonb; errs jsonb := '[]'::jsonb; ins int := 0; g jsonb;
begin
  if not ops.can_write() or not (ops.in_dept('outreach') or ops.in_dept('sales')
                                 or ops.my_role() = 'partner') then
    raise exception 'You do not have permission to import institutions' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a list'; end if;
  n := jsonb_array_length(p_rows);
  if n = 0 then raise exception 'The file has no rows'; end if;
  if n > 2000 then raise exception 'Import at most 2000 rows at a time'; end if;

  for item in select * from jsonb_array_elements(p_rows) loop
    idx := idx + 1; msg := null; owner := null;
    nm := btrim(coalesce(item ->> 'name', ''));
    kd := lower(btrim(coalesce(item ->> 'kind', '')));
    ct := nullif(btrim(coalesce(item ->> 'city', '')), '');
    own_email := lower(btrim(coalesce(item ->> 'owner_email', '')));

    if nm = '' then
      msg := 'Name is required';
    elsif length(nm) > 200 then
      msg := 'Name is longer than 200 characters';
    elsif kd not in ('school', 'engineering_college', 'polytechnic', 'university', 'other') then
      msg := 'Kind must be one of: school, engineering_college, polytechnic, university, other';
    else
      key := lower(nm) || '|' || lower(coalesce(ct, ''));
      if key = any (seen) then
        msg := 'Duplicate of an earlier row in this file';
      elsif exists (select 1 from ops.institution i
                    where lower(i.name) = lower(nm) and lower(coalesce(i.city, '')) = lower(coalesce(ct, ''))) then
        msg := 'Already exists';
      end if;
      seen := seen || key;
    end if;

    if msg is null then
      if ops.my_role() = 'partner' then
        owner := auth.uid();
      elsif own_email <> '' then
        select s.id into owner from ops.staff s where lower(s.email) = own_email and s.is_active;
        if owner is null then msg := 'Unknown owner email'; end if;
      end if;
    end if;

    if msg is not null then
      errs := errs || jsonb_build_object('row', idx, 'name', nm, 'message', msg);
    else
      good := good || jsonb_build_object(
        'name', nm, 'kind', kd, 'city', ct, 'owner_id', owner,
        'district', nullif(btrim(coalesce(item ->> 'district', '')), ''),
        'state', coalesce(nullif(btrim(coalesce(item ->> 'state', '')), ''), 'Maharashtra'),
        'affiliation', nullif(btrim(coalesce(item ->> 'affiliation', '')), ''),
        'source', coalesce(nullif(btrim(coalesce(item ->> 'source', '')), ''), 'csv_import'),
        'notes', nullif(btrim(coalesce(item ->> 'notes', '')), ''));
    end if;
  end loop;

  if p_dry_run or jsonb_array_length(errs) > 0 then
    return jsonb_build_object('dry_run', p_dry_run, 'total', n, 'valid', jsonb_array_length(good),
                              'errors', errs, 'inserted', 0);
  end if;

  for g in select * from jsonb_array_elements(good) loop
    insert into ops.institution (name, kind, city, district, state, affiliation, source, notes, owner_id)
    values (g ->> 'name', g ->> 'kind', g ->> 'city', g ->> 'district', g ->> 'state',
            g ->> 'affiliation', g ->> 'source', g ->> 'notes', (g ->> 'owner_id')::uuid);
    ins := ins + 1;
  end loop;
  return jsonb_build_object('dry_run', false, 'total', n, 'valid', jsonb_array_length(good),
                            'errors', errs, 'inserted', ins);
end $$;

-- ---------------------------------------------------------------- 3. search
create extension if not exists pg_trgm with schema extensions;
create index institution_name_trgm_idx on ops.institution using gin (name extensions.gin_trgm_ops);
create index institution_city_trgm_idx on ops.institution using gin (city extensions.gin_trgm_ops);

-- ---------------------------------------------------------------- 4. job log
-- Edge Functions (service role, bypasses RLS) insert/update rows; the founder reads them.
create table ops.job_run (
  id            uuid primary key default gen_random_uuid(),
  job           text not null,
  status        text not null default 'running' check (status in ('running', 'ok', 'failed')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  rows_affected int,
  error         text,
  details       jsonb not null default '{}',
  check (finished_at is null or finished_at >= started_at)
);
create index job_run_job_started_idx on ops.job_run (job, started_at desc);
alter table ops.job_run enable row level security;
create policy job_run_sel on ops.job_run for select to authenticated using ((select ops.is_founder()));

-- ---------------------------------------------------------------- 5. DPDP erasure
-- Removes or anonymises everything tied to an IDE user (by IDE user id and/or email). Founder (or service
-- role) only. The audit entry records counts, never the email or id.
create or replace function ops.forget_ide_user(p_ide_user_id text default null, p_email text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u text := nullif(btrim(coalesce(p_ide_user_id, '')), '');
  m text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  ids text[]; n_snap int; n_daily int; n_sess int; n_fb int;
begin
  if auth.uid() is not null and not ops.is_founder() then
    raise exception 'Only the founder can erase a user''s data' using errcode = '42501';
  end if;
  if u is null and m is null then raise exception 'Provide an IDE user id or an email'; end if;

  select coalesce(array_agg(ide_user_id), '{}') into ids from ops.ide_user_snapshot
   where (u is not null and ide_user_id = u) or (m is not null and lower(email) = m);
  if u is not null and not (u = any (ids)) then ids := ids || u; end if;

  delete from ops.ide_user_snapshot where ide_user_id = any (ids);  get diagnostics n_snap = row_count;
  delete from ops.ph_user_daily where distinct_id = any (ids);       get diagnostics n_daily = row_count;
  update ops.ph_session set distinct_id = null where distinct_id = any (ids);  get diagnostics n_sess = row_count;
  update ops.feedback set ide_user_id = null where ide_user_id = any (ids);    get diagnostics n_fb = row_count;

  insert into ops.audit_log (table_name, row_id, action, after)
  values ('ide_user_snapshot', null, 'FORGET',
          jsonb_build_object('snapshots', n_snap, 'daily_rows', n_daily, 'sessions', n_sess, 'feedback', n_fb));
  return jsonb_build_object('snapshots', n_snap, 'daily_rows', n_daily, 'sessions', n_sess, 'feedback', n_fb);
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on all functions in schema ops from public;
grant execute on function ops.available_trainers(timestamptz, timestamptz, uuid),
                          ops.import_institutions(jsonb, boolean),
                          ops.forget_ide_user(text, text)
  to authenticated, service_role;
