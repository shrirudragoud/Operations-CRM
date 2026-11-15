-- 0010 hardening + team admin.
-- 1. Security Advisor: fixed search_path on every function; trigger/internal functions not callable by users.
-- 2. Performance Advisor: one permissive policy per table and command; auth.uid() and ops.* helpers wrapped
--    in (select ...) so Postgres evaluates them once per statement, not once per row; FK indexes.
-- 3. Team admin RPCs used by the app's Team page (founder only), with plain-language errors.
-- 4. Access rules: partners never have departments; internal roles need at least one department;
--    partners may only open deals at institutions they own.
-- Policies are recreated from scratch here, so this file is the single source of truth for RLS.

-- ---------------------------------------------------------------- 1. function hygiene
alter function ops.touch_updated_at() set search_path = '';

-- every user can only run what is granted explicitly (0008 granted authenticated already).
-- Postgres grants EXECUTE to PUBLIC on every new function and per-schema default privileges cannot
-- remove that, so each migration that adds functions must end with this revoke (a test checks it).
revoke execute on all functions in schema ops from public;

-- trigger functions fire regardless of EXECUTE; nobody needs to call them directly
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as fn
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'ops' and p.prorettype = 'trigger'::regtype loop
    execute format('revoke execute on function %s from authenticated', r.fn);
  end loop;
end $$;
revoke execute on function ops.gen_cohort_code() from authenticated;

-- ---------------------------------------------------------------- 2a. helper for array-based department checks
-- departments the caller acts in: founder = all, partner/inactive/unknown = none
create or replace function ops.my_departments() returns ops.department[]
language sql stable security definer set search_path = '' as $$
  select coalesce((select case when s.role = 'founder' then enum_range(null::ops.department)
                               when s.role = 'partner' then '{}'::ops.department[]
                               else s.departments end
                     from ops.staff s where s.id = auth.uid() and s.is_active),
                  '{}'::ops.department[])
$$;

-- active, non-partner staff (any internal role incl. viewer)
create or replace function ops.is_internal() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.staff
                 where id = auth.uid() and is_active and role <> 'partner')
$$;
grant execute on function ops.my_departments(), ops.is_internal() to authenticated, service_role;

-- ---------------------------------------------------------------- 2b. drop every existing ops policy
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'ops' loop
    execute format('drop policy %I on ops.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------- 2c. department-owned tables (no extra readers)
do $$
declare r record;
begin
  for r in select * from (values
    ('event_staff','workshop'), ('run_sheet_template','workshop'), ('run_sheet_item','workshop'),
    ('kit_component','workshop'), ('location','workshop'), ('item','workshop'),
    ('stock_movement','workshop'), ('stock_reservation','workshop'),
    ('training_program','training'),
    ('ph_session','product'), ('ph_user_daily','product'), ('review_item','product'),
    ('observation','product'), ('insight','product'), ('incident','product'),
    ('catalog_request','product'),
    ('content_item','community')
  ) as v(tbl, dept) loop
    execute format('alter table ops.%I enable row level security', r.tbl);
    execute format($p$create policy %I on ops.%I for select to authenticated
                      using ((select ops.in_dept(%L)))$p$, r.tbl || '_sel', r.tbl, r.dept);
    execute format($p$create policy %I on ops.%I for insert to authenticated
                      with check ((select ops.in_dept(%L)) and (select ops.can_write()))$p$,
                   r.tbl || '_ins', r.tbl, r.dept);
    execute format($p$create policy %I on ops.%I for update to authenticated
                      using ((select ops.in_dept(%L)) and (select ops.can_write()))
                      with check ((select ops.in_dept(%L)) and (select ops.can_write()))$p$,
                   r.tbl || '_upd', r.tbl, r.dept, r.dept);
    execute format($p$create policy %I on ops.%I for delete to authenticated
                      using ((select ops.in_dept(%L)) and (select ops.my_role()) in ('founder','dept_lead'))$p$,
                   r.tbl || '_del', r.tbl, r.dept);
  end loop;
end $$;

-- department tables with extra readers: (table, owner dept, select expression)
do $$
declare r record;
begin
  for r in select * from (values
    ('cohort','workshop', '(select ops.in_dept(''workshop'')) or (select ops.in_dept(''product'')) or (select ops.in_dept(''community'')) or (select ops.in_dept(''sales''))'),
    ('kit','workshop', '(select ops.in_dept(''workshop'')) or (select ops.in_dept(''sales''))'),
    ('trainer_profile','training', '(select ops.in_dept(''training'')) or (select ops.in_dept(''workshop''))'),
    ('enrollment','training', '(select ops.in_dept(''training'')) or (select ops.in_dept(''workshop''))'),
    ('ide_user_snapshot','product', '(select ops.in_dept(''product'')) or (select ops.in_dept(''workshop'')) or (select ops.in_dept(''community''))'),
    ('event','workshop', '(select ops.in_dept(''workshop'')) or (select ops.in_dept(''community'')) or (select ops.in_dept(''training'')) or (select ops.in_dept(''sales''))'
       || ' or ((select ops.my_role()) = ''partner'' and exists (select 1 from ops.institution i where i.id = institution_id and i.owner_id = (select auth.uid())))')
  ) as v(tbl, dept, sel) loop
    execute format('create policy %I on ops.%I for select to authenticated using (%s)',
                   r.tbl || '_sel', r.tbl, r.sel);
    execute format($p$create policy %I on ops.%I for insert to authenticated
                      with check ((select ops.in_dept(%L)) and (select ops.can_write()))$p$,
                   r.tbl || '_ins', r.tbl, r.dept);
    execute format($p$create policy %I on ops.%I for update to authenticated
                      using ((select ops.in_dept(%L)) and (select ops.can_write()))
                      with check ((select ops.in_dept(%L)) and (select ops.can_write()))$p$,
                   r.tbl || '_upd', r.tbl, r.dept, r.dept);
    execute format($p$create policy %I on ops.%I for delete to authenticated
                      using ((select ops.in_dept(%L)) and (select ops.my_role()) in ('founder','dept_lead'))$p$,
                   r.tbl || '_del', r.tbl, r.dept);
  end loop;
end $$;

-- ---------------------------------------------------------------- 2d. outreach activity (dept + partner own rows)
create policy activity_sel on ops.activity for select to authenticated
  using ((select ops.in_dept('outreach'))
         or (staff_id = (select auth.uid()) and (select ops.my_role()) = 'partner'));
create policy activity_ins on ops.activity for insert to authenticated
  with check (((select ops.in_dept('outreach')) and (select ops.can_write()))
              or (staff_id = (select auth.uid()) and (select ops.my_role()) = 'partner'));
create policy activity_upd on ops.activity for update to authenticated
  using (((select ops.in_dept('outreach')) and (select ops.can_write()))
         or (staff_id = (select auth.uid()) and (select ops.my_role()) = 'partner'))
  with check (((select ops.in_dept('outreach')) and (select ops.can_write()))
              or (staff_id = (select auth.uid()) and (select ops.my_role()) = 'partner'));
create policy activity_del on ops.activity for delete to authenticated
  using (((select ops.in_dept('outreach')) and (select ops.my_role()) in ('founder','dept_lead'))
         or (staff_id = (select auth.uid()) and (select ops.my_role()) = 'partner'));

-- ---------------------------------------------------------------- 2e. sales: deals + lines (dept + partner own)
create policy deal_sel on ops.deal for select to authenticated
  using ((select ops.in_dept('sales'))
         or (owner_id = (select auth.uid()) and (select ops.my_role()) = 'partner'));
-- a partner may open deals only at institutions they own
create policy deal_ins on ops.deal for insert to authenticated
  with check (((select ops.in_dept('sales')) and (select ops.can_write()))
              or (owner_id = (select auth.uid()) and (select ops.my_role()) = 'partner'
                  and exists (select 1 from ops.institution i
                              where i.id = institution_id and i.owner_id = (select auth.uid()))));
create policy deal_upd on ops.deal for update to authenticated
  using (((select ops.in_dept('sales')) and (select ops.can_write()))
         or (owner_id = (select auth.uid()) and (select ops.my_role()) = 'partner'))
  with check (((select ops.in_dept('sales')) and (select ops.can_write()))
              or (owner_id = (select auth.uid()) and (select ops.my_role()) = 'partner'
                  and exists (select 1 from ops.institution i
                              where i.id = institution_id and i.owner_id = (select auth.uid()))));
create policy deal_del on ops.deal for delete to authenticated
  using ((select ops.in_dept('sales')) and (select ops.my_role()) in ('founder','dept_lead'));

create policy deal_line_sel on ops.deal_line for select to authenticated
  using ((select ops.in_dept('sales'))
         or ((select ops.my_role()) = 'partner' and exists
             (select 1 from ops.deal d where d.id = deal_id and d.owner_id = (select auth.uid()))));
create policy deal_line_ins on ops.deal_line for insert to authenticated
  with check (((select ops.in_dept('sales')) and (select ops.can_write()))
              or ((select ops.my_role()) = 'partner' and exists
                  (select 1 from ops.deal d where d.id = deal_id and d.owner_id = (select auth.uid()))));
create policy deal_line_upd on ops.deal_line for update to authenticated
  using (((select ops.in_dept('sales')) and (select ops.can_write()))
         or ((select ops.my_role()) = 'partner' and exists
             (select 1 from ops.deal d where d.id = deal_id and d.owner_id = (select auth.uid()))))
  with check (((select ops.in_dept('sales')) and (select ops.can_write()))
              or ((select ops.my_role()) = 'partner' and exists
                  (select 1 from ops.deal d where d.id = deal_id and d.owner_id = (select auth.uid()))));
create policy deal_line_del on ops.deal_line for delete to authenticated
  using (((select ops.in_dept('sales')) and (select ops.my_role()) in ('founder','dept_lead'))
         or ((select ops.my_role()) = 'partner' and exists
             (select 1 from ops.deal d where d.id = deal_id and d.owner_id = (select auth.uid()))));

-- ---------------------------------------------------------------- 2f. core tables
create policy staff_sel on ops.staff for select to authenticated
  using (id = (select auth.uid()) or (select ops.is_internal()));
create policy staff_ins on ops.staff for insert to authenticated with check ((select ops.is_founder()));
create policy staff_upd on ops.staff for update to authenticated
  using ((select ops.is_founder())) with check ((select ops.is_founder()));
create policy staff_del on ops.staff for delete to authenticated using ((select ops.is_founder()));

create policy institution_sel on ops.institution for select to authenticated
  using ((select ops.is_internal()) or owner_id = (select auth.uid()));
create policy institution_ins on ops.institution for insert to authenticated
  with check ((select ops.can_write()) and (
    (select ops.in_dept('outreach')) or (select ops.in_dept('sales'))
    or ((select ops.my_role()) = 'partner' and owner_id = (select auth.uid()))));
create policy institution_upd on ops.institution for update to authenticated
  using ((select ops.can_write()) and (
    (select ops.in_dept('outreach')) or (select ops.in_dept('sales')) or (select ops.in_dept('workshop'))
    or owner_id = (select auth.uid())))
  with check ((select ops.can_write()) and (
    (select ops.in_dept('outreach')) or (select ops.in_dept('sales')) or (select ops.in_dept('workshop'))
    or owner_id = (select auth.uid())));
create policy institution_del on ops.institution for delete to authenticated
  using ((select ops.is_founder()));

create policy contact_sel on ops.contact for select to authenticated
  using ((select ops.is_internal())
         or exists (select 1 from ops.institution i
                    where i.id = institution_id and i.owner_id = (select auth.uid())));
create policy contact_ins on ops.contact for insert to authenticated
  with check ((select ops.can_write()) and ((select ops.in_dept('outreach')) or (select ops.in_dept('sales'))
              or exists (select 1 from ops.institution i
                         where i.id = institution_id and i.owner_id = (select auth.uid()))));
create policy contact_upd on ops.contact for update to authenticated
  using ((select ops.can_write()) and ((select ops.in_dept('outreach')) or (select ops.in_dept('sales'))
         or exists (select 1 from ops.institution i
                    where i.id = institution_id and i.owner_id = (select auth.uid()))))
  with check ((select ops.can_write()) and ((select ops.in_dept('outreach')) or (select ops.in_dept('sales'))
              or exists (select 1 from ops.institution i
                         where i.id = institution_id and i.owner_id = (select auth.uid()))));
create policy contact_del on ops.contact for delete to authenticated
  using ((select ops.can_write()) and ((select ops.in_dept('outreach')) or (select ops.in_dept('sales'))
         or exists (select 1 from ops.institution i
                    where i.id = institution_id and i.owner_id = (select auth.uid()))));

create policy task_sel on ops.task for select to authenticated
  using (department = any ((select ops.my_departments())::ops.department[])
         or assignee_id = (select auth.uid()) or created_by = (select auth.uid()));
create policy task_ins on ops.task for insert to authenticated
  with check ((select ops.can_write())
              and (department = any ((select ops.my_departments())::ops.department[]) or assignee_id = (select auth.uid())));
create policy task_upd on ops.task for update to authenticated
  using ((select ops.can_write())
         and (department = any ((select ops.my_departments())::ops.department[]) or assignee_id = (select auth.uid())))
  with check ((select ops.can_write())
              and (department = any ((select ops.my_departments())::ops.department[]) or assignee_id = (select auth.uid())));
create policy task_del on ops.task for delete to authenticated
  using (department = any ((select ops.my_departments())::ops.department[])
         and (select ops.my_role()) in ('founder','dept_lead'));

create policy feedback_sel on ops.feedback for select to authenticated
  using (owner_department = any ((select ops.my_departments())::ops.department[]) or created_by = (select auth.uid()));
create policy feedback_ins on ops.feedback for insert to authenticated
  with check ((select ops.can_write()) and (select ops.is_internal()));
create policy feedback_upd on ops.feedback for update to authenticated
  using (owner_department = any ((select ops.my_departments())::ops.department[]) and (select ops.can_write()))
  with check ((select ops.can_write()));

create policy audit_log_sel on ops.audit_log for select to authenticated
  using ((select ops.is_founder()));

create policy kpi_target_sel on ops.kpi_target for select to authenticated
  using ((select ops.is_founder()) or staff_id = (select auth.uid()));
create policy kpi_target_ins on ops.kpi_target for insert to authenticated
  with check ((select ops.is_founder()));
create policy kpi_target_upd on ops.kpi_target for update to authenticated
  using ((select ops.is_founder())) with check ((select ops.is_founder()));
create policy kpi_target_del on ops.kpi_target for delete to authenticated
  using ((select ops.is_founder()));

create policy kpi_snapshot_sel on ops.kpi_snapshot for select to authenticated
  using ((select ops.my_role()) in ('founder','dept_lead'));

create policy invite_founder on ops.invite for all to authenticated
  using ((select ops.is_founder())) with check ((select ops.is_founder()));

-- ---------------------------------------------------------------- 2g. index every foreign key
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(c.conkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace
     where c.contype = 'f' and n.nspname = 'ops'
       and not exists (
         select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)] = c.conkey)
  loop
    execute format('create index %I on %s (%s)', left(r.conname, 58) || '_ix', r.tbl, r.cols);
  end loop;
end $$;

-- ---------------------------------------------------------------- 4. access shape rules
alter table ops.staff
  add constraint staff_partner_no_departments check (role <> 'partner' or departments = '{}'),
  add constraint staff_internal_has_department
    check (role in ('founder','partner') or cardinality(departments) > 0);
alter table ops.invite
  add constraint invite_partner_no_departments check (role <> 'partner' or departments = '{}'),
  add constraint invite_internal_has_department
    check (role in ('founder','partner') or cardinality(departments) > 0);
create unique index staff_email_lower on ops.staff (lower(email));

-- ---------------------------------------------------------------- 3. team admin RPCs (founder only)
-- shared validation so invite and edit give the same messages
create or replace function ops.check_access_shape(p_role ops.app_role, p_departments ops.department[])
returns ops.department[] language plpgsql immutable set search_path = '' as $$
declare deps ops.department[] := array(select distinct d from unnest(coalesce(p_departments, '{}')) d order by d);
begin
  if p_role is null then raise exception 'Choose a role'; end if;
  if p_role = 'partner' and cardinality(deps) > 0 then
    raise exception 'Partners cannot belong to departments; they see only the records they own';
  end if;
  if p_role not in ('founder','partner') and cardinality(deps) = 0 then
    raise exception 'Choose at least one department for this role';
  end if;
  return deps;
end $$;

-- invite (or re-invite: refreshes the open invite and its 30-day expiry)
create or replace function ops.invite_staff(p_email text, p_role ops.app_role,
                                            p_departments ops.department[] default '{}',
                                            p_full_name text default null)
returns ops.invite language plpgsql security invoker set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  deps    ops.department[];
  s       ops.staff%rowtype;
  inv     ops.invite%rowtype;
begin
  if not ops.is_founder() then
    raise exception 'Only the founder can invite people' using errcode = '42501';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception 'Enter a valid email address';
  end if;
  deps := ops.check_access_shape(p_role, p_departments);
  select * into s from ops.staff where lower(email) = v_email;
  if found then
    if s.is_active then
      raise exception '% is already on the team', v_email;
    end if;
    raise exception '% has a deactivated account; reactivate them from the team list instead', v_email;
  end if;
  insert into ops.invite (email, full_name, role, departments, invited_by)
  values (v_email, nullif(btrim(p_full_name), ''), p_role, deps, auth.uid())
  on conflict (email) where accepted_at is null do update
    set full_name = excluded.full_name, role = excluded.role, departments = excluded.departments,
        invited_by = excluded.invited_by, created_at = now(), expires_at = now() + interval '30 days'
  returning * into inv;
  return inv;
end $$;

create or replace function ops.revoke_invite(p_invite uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if not ops.is_founder() then
    raise exception 'Only the founder can revoke invites' using errcode = '42501';
  end if;
  delete from ops.invite where id = p_invite and accepted_at is null;
  if not found then raise exception 'Invite not found or already accepted'; end if;
end $$;

-- change role / departments / active flag. guard_last_founder still protects the last founder.
create or replace function ops.update_staff_access(p_staff uuid, p_role ops.app_role,
                                                   p_departments ops.department[], p_is_active boolean)
returns ops.staff language plpgsql security invoker set search_path = '' as $$
declare deps ops.department[]; s ops.staff%rowtype;
begin
  if not ops.is_founder() then
    raise exception 'Only the founder can change team access' using errcode = '42501';
  end if;
  if p_is_active is null then raise exception 'Choose active or deactivated'; end if;
  deps := ops.check_access_shape(p_role, p_departments);
  update ops.staff set role = p_role, departments = deps, is_active = p_is_active
   where id = p_staff
  returning * into s;
  if not found then raise exception 'Team member not found'; end if;
  return s;
end $$;

grant execute on function ops.invite_staff(text, ops.app_role, ops.department[], text),
                          ops.revoke_invite(uuid),
                          ops.update_staff_access(uuid, ops.app_role, ops.department[], boolean),
                          ops.check_access_shape(ops.app_role, ops.department[])
  to authenticated;

-- new functions above were created with PUBLIC execute; remove it (see section 1)
revoke execute on all functions in schema ops from public;
