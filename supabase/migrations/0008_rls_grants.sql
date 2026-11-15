-- 0008 row level security + grants
-- Model: department membership (ops.in_dept) decides access. Founder = all departments.
-- Partners are not department members; they see only rows they own.

grant usage on schema ops to authenticated, service_role;
grant all on all tables in schema ops to authenticated, service_role;
grant all on all sequences in schema ops to authenticated, service_role;
grant execute on all functions in schema ops to authenticated, service_role;
alter default privileges in schema ops grant all on tables to authenticated, service_role;
alter default privileges in schema ops grant all on sequences to authenticated, service_role;

-- service-only jobs (Edge Functions with the secret key)
revoke execute on function ops.assign_review_queue(date, int) from public, authenticated;
revoke execute on function ops.raise_low_stock_tasks()        from public, authenticated;
revoke execute on function ops.request_part(text, text)       from public, authenticated;

-- ---------------------------------------------------------------- department-owned tables
do $$
declare r record;
begin
  for r in select * from (values
    ('activity','outreach'), ('deal','sales'), ('deal_line','sales'),
    ('event','workshop'), ('event_staff','workshop'), ('cohort','workshop'),
    ('run_sheet_template','workshop'), ('run_sheet_item','workshop'),
    ('item','workshop'), ('kit','workshop'), ('kit_component','workshop'),
    ('location','workshop'), ('stock_movement','workshop'), ('stock_reservation','workshop'),
    ('trainer_profile','training'), ('training_program','training'), ('enrollment','training'),
    ('ph_session','product'), ('ph_user_daily','product'), ('review_item','product'),
    ('observation','product'), ('insight','product'), ('incident','product'),
    ('catalog_request','product'), ('ide_user_snapshot','product'),
    ('content_item','community')
  ) as v(tbl, dept) loop
    execute format('alter table ops.%I enable row level security', r.tbl);
    execute format('create policy %I on ops.%I for select to authenticated using (ops.in_dept(%L))',
                   r.tbl || '_sel', r.tbl, r.dept);
    execute format('create policy %I on ops.%I for insert to authenticated with check (ops.in_dept(%L) and ops.can_write())',
                   r.tbl || '_ins', r.tbl, r.dept);
    execute format('create policy %I on ops.%I for update to authenticated using (ops.in_dept(%L) and ops.can_write()) with check (ops.in_dept(%L) and ops.can_write())',
                   r.tbl || '_upd', r.tbl, r.dept, r.dept);
    execute format('create policy %I on ops.%I for delete to authenticated using (ops.in_dept(%L) and ops.my_role() in (''founder'',''dept_lead''))',
                   r.tbl || '_del', r.tbl, r.dept);
  end loop;
end $$;

-- ---------------------------------------------------------------- cross-department reads
-- Workshop assigns trainers and reads activation; Community reads activation + events.
create policy trainer_profile_sel_workshop on ops.trainer_profile for select to authenticated
  using (ops.in_dept('workshop'));
create policy enrollment_sel_workshop on ops.enrollment for select to authenticated
  using (ops.in_dept('workshop'));
create policy ide_user_sel_workshop on ops.ide_user_snapshot for select to authenticated
  using (ops.in_dept('workshop') or ops.in_dept('community'));
create policy event_sel_community on ops.event for select to authenticated
  using (ops.in_dept('community') or ops.in_dept('training') or ops.in_dept('sales'));
create policy cohort_sel_other on ops.cohort for select to authenticated
  using (ops.in_dept('product') or ops.in_dept('community') or ops.in_dept('sales'));
create policy kit_sel_sales on ops.kit for select to authenticated using (ops.in_dept('sales'));

-- ---------------------------------------------------------------- partner access (own rows only)
create policy activity_partner on ops.activity for all to authenticated
  using (staff_id = auth.uid() and ops.my_role() = 'partner')
  with check (staff_id = auth.uid() and ops.my_role() = 'partner');
-- a partner's own deals include their value (they negotiate them); stage rules are in triggers
create policy deal_partner_sel on ops.deal for select to authenticated
  using (owner_id = auth.uid() and ops.my_role() = 'partner');
create policy deal_partner_ins on ops.deal for insert to authenticated
  with check (owner_id = auth.uid() and ops.my_role() = 'partner');
create policy deal_partner_upd on ops.deal for update to authenticated
  using (owner_id = auth.uid() and ops.my_role() = 'partner')
  with check (owner_id = auth.uid() and ops.my_role() = 'partner');
create policy deal_line_partner on ops.deal_line for all to authenticated
  using (exists (select 1 from ops.deal d where d.id = deal_id and d.owner_id = auth.uid()) and ops.my_role() = 'partner')
  with check (exists (select 1 from ops.deal d where d.id = deal_id and d.owner_id = auth.uid()) and ops.my_role() = 'partner');
create policy event_partner_sel on ops.event for select to authenticated
  using (ops.my_role() = 'partner' and exists
         (select 1 from ops.institution i where i.id = institution_id and i.owner_id = auth.uid()));

-- ---------------------------------------------------------------- core tables
alter table ops.staff enable row level security;
create policy staff_sel on ops.staff for select to authenticated
  using (id = auth.uid() or (ops.my_role() is not null and ops.my_role() <> 'partner'));
create policy staff_ins on ops.staff for insert to authenticated with check (ops.is_founder());
create policy staff_upd on ops.staff for update to authenticated
  using (ops.is_founder()) with check (ops.is_founder());
create policy staff_del on ops.staff for delete to authenticated using (ops.is_founder());

alter table ops.institution enable row level security;
create policy institution_sel on ops.institution for select to authenticated
  using ((ops.my_role() is not null and ops.my_role() <> 'partner') or owner_id = auth.uid());
create policy institution_ins on ops.institution for insert to authenticated
  with check (ops.can_write() and (ops.is_founder() or ops.in_dept('outreach') or ops.in_dept('sales')
              or (ops.my_role() = 'partner' and owner_id = auth.uid())));
create policy institution_upd on ops.institution for update to authenticated
  using (ops.can_write() and (ops.is_founder() or ops.in_dept('outreach') or ops.in_dept('sales')
         or ops.in_dept('workshop') or owner_id = auth.uid()))
  with check (ops.can_write() and (ops.is_founder() or ops.in_dept('outreach') or ops.in_dept('sales')
         or ops.in_dept('workshop') or owner_id = auth.uid()));
create policy institution_del on ops.institution for delete to authenticated using (ops.is_founder());

alter table ops.contact enable row level security;
create policy contact_sel on ops.contact for select to authenticated
  using ((ops.my_role() is not null and ops.my_role() <> 'partner')
         or exists (select 1 from ops.institution i where i.id = institution_id and i.owner_id = auth.uid()));
create policy contact_rw on ops.contact for all to authenticated
  using (ops.can_write() and (ops.is_founder() or ops.in_dept('outreach') or ops.in_dept('sales')
         or exists (select 1 from ops.institution i where i.id = institution_id and i.owner_id = auth.uid())))
  with check (ops.can_write() and (ops.is_founder() or ops.in_dept('outreach') or ops.in_dept('sales')
         or exists (select 1 from ops.institution i where i.id = institution_id and i.owner_id = auth.uid())));

alter table ops.task enable row level security;
create policy task_sel on ops.task for select to authenticated
  using (ops.in_dept(department) or assignee_id = auth.uid() or created_by = auth.uid());
create policy task_ins on ops.task for insert to authenticated
  with check (ops.can_write() and (ops.in_dept(department) or assignee_id = auth.uid()));
create policy task_upd on ops.task for update to authenticated
  using (ops.can_write() and (ops.in_dept(department) or assignee_id = auth.uid()))
  with check (ops.can_write() and (ops.in_dept(department) or assignee_id = auth.uid()));
create policy task_del on ops.task for delete to authenticated
  using (ops.in_dept(department) and ops.my_role() in ('founder','dept_lead'));

alter table ops.feedback enable row level security;
create policy feedback_sel on ops.feedback for select to authenticated
  using (ops.in_dept(owner_department) or created_by = auth.uid());
create policy feedback_ins on ops.feedback for insert to authenticated
  with check (ops.can_write() and ops.my_role() <> 'partner');
create policy feedback_upd on ops.feedback for update to authenticated
  using (ops.in_dept(owner_department) and ops.can_write())
  with check (ops.can_write());

alter table ops.audit_log enable row level security;
create policy audit_founder on ops.audit_log for select to authenticated using (ops.is_founder());

alter table ops.kpi_target enable row level security;
create policy kpi_target_sel on ops.kpi_target for select to authenticated
  using (ops.is_founder() or staff_id = auth.uid());
create policy kpi_target_wr on ops.kpi_target for all to authenticated
  using (ops.is_founder()) with check (ops.is_founder());

alter table ops.kpi_snapshot enable row level security;
create policy kpi_snapshot_sel on ops.kpi_snapshot for select to authenticated
  using (ops.my_role() in ('founder','dept_lead'));
