-- Employee portal P5: HR requests and onboarding (docs/PLAN_EMPLOYEE_PORTAL.md, row 0034).
-- 1. hr_request + hr_request_message: "ask HR" (experience letter, address proof, detail change...) with a thread.
--    HR can leave internal notes the employee never sees. Written only through RPCs.
-- 2. onboarding_template: the standard joiner and leaver checklists HR keeps (direct HR writes, RLS).
--    onboarding_task: the checklist one person actually gets, started by ops.start_onboarding().
--    The employee sees their own checklist and can tick their own items; HR sees and ticks everything.
-- The birthday consent flag is NOT here (it lives with the profile in 0031).

-- ---------------------------------------------------------------- requests
create table ops.hr_request (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references ops.staff (id) on delete cascade,
  kind        text not null check (kind in ('experience_letter', 'address_proof', 'salary_certificate', 'detail_change', 'other')),
  subject     text not null check (char_length(btrim(subject)) between 1 and 140),
  details     text not null default '' check (char_length(details) <= 2000),
  state       text not null default 'open' check (state in ('open', 'in_progress', 'done', 'rejected')),
  handled_by  uuid references ops.staff (id) on delete set null,
  resolution  text check (resolution is null or char_length(resolution) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  closed_at   timestamptz,
  check ((state in ('done', 'rejected')) = (closed_at is not null))
);
create index hr_request_staff_idx on ops.hr_request (staff_id, created_at desc);
create index hr_request_handled_by_idx on ops.hr_request (handled_by);
create index hr_request_state_idx on ops.hr_request (state, created_at) where state in ('open', 'in_progress');

create table ops.hr_request_message (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references ops.hr_request (id) on delete cascade,
  author_id   uuid references ops.staff (id) on delete set null,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  internal    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index hr_request_message_request_idx on ops.hr_request_message (request_id, created_at);
create index hr_request_message_author_idx on ops.hr_request_message (author_id);

create trigger t_hr_request_touch before update on ops.hr_request
  for each row execute function ops.touch_updated_at();
create trigger t_hr_request_audit after insert or update or delete on ops.hr_request
  for each row execute function ops.audit();

alter table ops.hr_request enable row level security;
alter table ops.hr_request_message enable row level security;
create policy hr_request_sel on ops.hr_request for select to authenticated
  using (staff_id = (select auth.uid()) or (select ops.can_hr()));
create policy hr_request_message_sel on ops.hr_request_message for select to authenticated
  using ((select ops.can_hr())
         or (not internal and exists (select 1 from ops.hr_request r
                                      where r.id = request_id and r.staff_id = (select auth.uid()))));

create or replace function ops.create_hr_request(p_kind text, p_subject text, p_details text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not ops.is_employee() then raise exception 'Only team members can ask HR' using errcode = '42501'; end if;
  if (select count(*) from ops.hr_request where staff_id = auth.uid() and state in ('open', 'in_progress')) >= 10 then
    raise exception 'You already have ten open requests. Wait for HR to answer some first.';
  end if;
  insert into ops.hr_request (staff_id, kind, subject, details)
  values (auth.uid(), p_kind, btrim(p_subject), coalesce(p_details, ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function ops.add_hr_request_message(p_request uuid, p_body text, p_internal boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare r ops.hr_request;
begin
  select * into r from ops.hr_request where id = p_request;
  if not found then raise exception 'That request does not exist'; end if;
  if ops.can_hr() then
    insert into ops.hr_request_message (request_id, author_id, body, internal)
    values (p_request, auth.uid(), p_body, coalesce(p_internal, false));
  elsif r.staff_id = auth.uid() and ops.is_employee() then
    if p_internal then raise exception 'Only HR can leave internal notes' using errcode = '42501'; end if;
    if r.state in ('done', 'rejected') then raise exception 'This request is closed. Open a new one.'; end if;
    insert into ops.hr_request_message (request_id, author_id, body, internal) values (p_request, auth.uid(), p_body, false);
  else
    raise exception 'You can''t write on this request' using errcode = '42501';
  end if;
  update ops.hr_request set updated_at = now() where id = p_request;
end $$;

-- open -> in_progress -> done or rejected; HR can also reopen a closed one. Rejecting needs a reason.
create or replace function ops.set_hr_request_state(p_request uuid, p_state text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r ops.hr_request;
begin
  if not ops.can_hr() then raise exception 'Only HR can answer requests' using errcode = '42501'; end if;
  select * into r from ops.hr_request where id = p_request;
  if not found then raise exception 'That request does not exist'; end if;
  if p_state not in ('open', 'in_progress', 'done', 'rejected') then raise exception 'Unknown state'; end if;
  if p_state = r.state then raise exception 'It is already %', replace(p_state, '_', ' '); end if;
  if p_state = 'rejected' and (p_note is null or btrim(p_note) = '') then raise exception 'Say why the request is rejected'; end if;
  update ops.hr_request
     set state = p_state,
         handled_by = auth.uid(),
         resolution = case when p_state in ('done', 'rejected') then nullif(btrim(p_note), '') else null end,
         closed_at = case when p_state in ('done', 'rejected') then now() end
   where id = p_request;
  if p_note is not null and btrim(p_note) <> '' then
    insert into ops.hr_request_message (request_id, author_id, body, internal)
    values (p_request, auth.uid(), btrim(p_note), false);
  end if;
end $$;

-- ---------------------------------------------------------------- onboarding
create table ops.onboarding_template (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('joiner', 'leaver')),
  title       text not null check (char_length(btrim(title)) between 1 and 140),
  detail      text check (detail is null or char_length(detail) <= 500),
  owner       text not null check (owner in ('hr', 'employee', 'lead')),
  due_offset  int not null default 0 check (due_offset between -60 and 60),
  position    int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index onboarding_template_kind_idx on ops.onboarding_template (kind, position);

create table ops.onboarding_task (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references ops.staff (id) on delete cascade,
  kind         text not null check (kind in ('joiner', 'leaver')),
  title        text not null,
  detail       text,
  owner        text not null check (owner in ('hr', 'employee', 'lead')),
  assignee_id  uuid references ops.staff (id) on delete set null,
  due_on       date not null,
  position     int not null default 0,
  template_id  uuid references ops.onboarding_template (id) on delete set null,
  done_at      timestamptz,
  done_by      uuid references ops.staff (id) on delete set null,
  created_by   uuid references ops.staff (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (done_by is null or done_at is not null)
);
create index onboarding_task_staff_idx on ops.onboarding_task (staff_id, kind, position);
create index onboarding_task_assignee_idx on ops.onboarding_task (assignee_id) where done_at is null;
create index onboarding_task_template_idx on ops.onboarding_task (template_id);
create index onboarding_task_done_by_idx on ops.onboarding_task (done_by);
create index onboarding_task_created_by_idx on ops.onboarding_task (created_by);

alter table ops.onboarding_template enable row level security;
alter table ops.onboarding_task enable row level security;

create policy onboarding_template_sel on ops.onboarding_template for select to authenticated
  using ((select ops.can_hr()));
create policy onboarding_template_ins on ops.onboarding_template for insert to authenticated
  with check ((select ops.can_hr()));
create policy onboarding_template_upd on ops.onboarding_template for update to authenticated
  using ((select ops.can_hr())) with check ((select ops.can_hr()));
create policy onboarding_template_del on ops.onboarding_template for delete to authenticated
  using ((select ops.can_hr()));

create policy onboarding_task_sel on ops.onboarding_task for select to authenticated
  using ((select ops.can_hr()) or staff_id = (select auth.uid()) or assignee_id = (select auth.uid()));

create trigger t_onboarding_template_audit after insert or update or delete on ops.onboarding_template
  for each row execute function ops.audit();
create trigger t_onboarding_task_audit after insert or update or delete on ops.onboarding_task
  for each row execute function ops.audit();

insert into ops.onboarding_template (kind, title, detail, owner, due_offset, position) values
  ('joiner', 'Sign in and check your details', 'Open My space and make sure your name and phone are right.', 'employee', 0, 10),
  ('joiner', 'Upload your ID and address proof', 'Add them under My space, Documents.', 'employee', 3, 20),
  ('joiner', 'Read the company handbook and policies', 'Tick "I have read this" on each one in Documents.', 'employee', 3, 30),
  ('joiner', 'Set up email and tool accounts', null, 'hr', 0, 40),
  ('joiner', 'Decide office or remote check-in', 'The founder sets this on the Team page.', 'hr', 1, 50),
  ('joiner', 'Give a first-week plan and a buddy', null, 'lead', 0, 60),
  ('joiner', 'First-week check-in', 'A short chat on how the first week went.', 'lead', 7, 70),
  ('leaver', 'Hand over open tasks and deals', 'Reassign every open task, deal and follow-up.', 'employee', -3, 10),
  ('leaver', 'Return boards, laptop and keys', null, 'employee', 0, 20),
  ('leaver', 'Exit conversation', null, 'lead', -2, 30),
  ('leaver', 'Remove access to tools and accounts', null, 'hr', 0, 40),
  ('leaver', 'Issue the experience letter', null, 'hr', 1, 50),
  ('leaver', 'Deactivate the account on the Team page', null, 'hr', 1, 60);

-- Starts the checklist for a person (HR only). Refuses to start the same kind twice while items are open.
-- "employee" items go to the person, "hr" items to whoever starts it, "lead" items to a lead who shares one of
-- their departments (else the founder). Due dates count from p_date: the start day for joiners, the last day for leavers.
create or replace function ops.start_onboarding(p_staff uuid, p_kind text, p_date date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  s ops.staff;
  v_date date := coalesce(p_date, ops.today_ist());
  v_lead uuid;
  n int;
begin
  if not ops.can_hr() then raise exception 'Only HR can start a checklist' using errcode = '42501'; end if;
  if p_kind not in ('joiner', 'leaver') then raise exception 'Joiner or leaver'; end if;
  select * into s from ops.staff where id = p_staff;
  if not found or s.role not in ('founder', 'dept_lead', 'member') then
    raise exception 'That person does not have a checklist';
  end if;
  if p_kind = 'joiner' and not s.is_active then raise exception 'That person is deactivated'; end if;
  if exists (select 1 from ops.onboarding_task where staff_id = p_staff and kind = p_kind and done_at is null) then
    raise exception 'That checklist is already running';
  end if;
  select l.id into v_lead from ops.staff l
   where l.is_active and l.role = 'dept_lead' and l.id <> p_staff and l.departments && s.departments
   order by l.full_name limit 1;
  if v_lead is null then
    select id into v_lead from ops.staff where is_active and role = 'founder' order by created_at limit 1;
  end if;
  perform ops.log_hr_access(p_staff, 'started ' || p_kind || ' checklist');
  insert into ops.onboarding_task (staff_id, kind, title, detail, owner, assignee_id, due_on, position, template_id, created_by)
  select p_staff, t.kind, t.title, t.detail, t.owner,
         case t.owner when 'employee' then p_staff when 'hr' then auth.uid() else v_lead end,
         v_date + t.due_offset, t.position, t.id, auth.uid()
    from ops.onboarding_template t
   where t.kind = p_kind and t.is_active;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'There is no % checklist yet. Add items first.', p_kind; end if;
  return n;
end $$;

-- The person ticks their own items, the assignee ticks theirs, HR ticks anything.
create or replace function ops.set_onboarding_task(p_task uuid, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare t ops.onboarding_task;
begin
  select * into t from ops.onboarding_task where id = p_task;
  if not found then raise exception 'That item does not exist'; end if;
  if not (ops.can_hr()
          or (t.owner = 'employee' and t.staff_id = auth.uid() and ops.is_employee())
          or (t.assignee_id = auth.uid() and ops.is_employee())) then
    raise exception 'You can''t tick this item' using errcode = '42501';
  end if;
  update ops.onboarding_task
     set done_at = case when p_done then now() end,
         done_by = case when p_done then auth.uid() end
   where id = p_task;
end $$;

-- One row per person and kind with items: how many there are and how many are done. HR sees everyone,
-- anyone else sees only their own.
create or replace function ops.onboarding_progress(p_staff uuid default null)
returns table (staff_id uuid, full_name text, kind text, total bigint, done bigint, next_due date, completed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.staff_id, s.full_name, t.kind, count(*), count(t.done_at),
         min(t.due_on) filter (where t.done_at is null),
         case when count(*) = count(t.done_at) then max(t.done_at) end
    from ops.onboarding_task t join ops.staff s on s.id = t.staff_id
   where (p_staff is null or t.staff_id = p_staff)
     and (ops.can_hr() or t.staff_id = auth.uid())
   group by t.staff_id, s.full_name, t.kind
   order by max(t.created_at) desc
$$;

revoke execute on all functions in schema ops from public;
grant execute on function
  ops.create_hr_request(text, text, text), ops.add_hr_request_message(uuid, text, boolean),
  ops.set_hr_request_state(uuid, text, text), ops.start_onboarding(uuid, text, date),
  ops.set_onboarding_task(uuid, boolean), ops.onboarding_progress(uuid)
  to authenticated, service_role;
