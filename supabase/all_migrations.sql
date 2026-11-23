-- 0001 core: schema, enums, staff, institution, contact, task, feedback, audit, KPI
create schema if not exists ops;

create type ops.department as enum
  ('outreach','sales','workshop','training','product','community');
create type ops.app_role as enum
  ('founder','dept_lead','member','partner','viewer');
-- order matters: stage may only move forward (see 0007)
create type ops.lifecycle_stage as enum
  ('prospect','contacted','qualified','deal_won','workshop_delivered',
   'teachers_trained','active','lab_customer','renewal','churned');

create or replace function ops.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

create table ops.staff (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null,
  email        text not null unique,
  phone        text,
  role         ops.app_role not null default 'member',
  departments  ops.department[] not null default '{}',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table ops.institution (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null check (kind in
              ('school','engineering_college','polytechnic','university','other')),
  affiliation text,
  city        text,
  district    text,
  state       text default 'Maharashtra',
  stage       ops.lifecycle_stage not null default 'prospect',
  owner_id    uuid references ops.staff(id),
  source      text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (name, city)
);
create trigger t_institution_upd before update on ops.institution
  for each row execute function ops.touch_updated_at();

create table ops.contact (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references ops.institution(id) on delete cascade,
  full_name      text not null,
  designation    text,
  influence      text check (influence in ('decision_maker','influencer','user','other')),
  phone          text,
  email          text,
  created_at     timestamptz not null default now()
);

create table ops.task (
  id          uuid primary key default gen_random_uuid(),
  department  ops.department not null,
  template    text,
  title       text not null,
  status      text not null default 'todo'
              check (status in ('todo','doing','blocked','done','cancelled')),
  priority    smallint not null default 3 check (priority between 1 and 4),
  assignee_id uuid references ops.staff(id),
  due_date    date,
  entity_type text,
  entity_id   uuid,
  created_by  uuid references ops.staff(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on ops.task (assignee_id, status, due_date);
create index on ops.task (entity_type, entity_id);
create trigger t_task_upd before update on ops.task
  for each row execute function ops.touch_updated_at();

create table ops.feedback (
  id               uuid primary key default gen_random_uuid(),
  source           text not null check (source in
                   ('session_replay','workshop_survey','community','teacher','sales_call','support','other')),
  owner_department ops.department not null,
  tag              text,
  severity         smallint check (severity between 1 and 4),
  body             text not null,
  institution_id   uuid references ops.institution(id),
  event_id         uuid,   -- fk added in 0003
  ide_user_id      text,
  insight_id       uuid,   -- fk added in 0005
  status           text not null default 'new'
                   check (status in ('new','triaged','linked','closed')),
  created_by       uuid references ops.staff(id) default auth.uid(),
  created_at       timestamptz not null default now()
);

create table ops.audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  row_id     uuid,
  action     text not null,
  actor_id   uuid default auth.uid(),
  before     jsonb,
  after      jsonb,
  at         timestamptz not null default now()
);

create or replace function ops.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into ops.audit_log(table_name, row_id, action, before, after)
  values (tg_table_name,
          coalesce((to_jsonb(new)->>'id')::uuid, (to_jsonb(old)->>'id')::uuid),
          tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger t_institution_audit after insert or update or delete on ops.institution
  for each row execute function ops.audit();

create table ops.kpi_target (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references ops.staff(id),
  metric       text not null,
  period_start date not null,
  period_end   date not null,
  target_value numeric not null,
  notes        text,
  check (period_end >= period_start)
);
create trigger t_kpi_target_audit after insert or update or delete on ops.kpi_target
  for each row execute function ops.audit();

create table ops.kpi_snapshot (
  snapshot_date date not null,
  metric        text not null,
  dimension     text not null default 'all',
  value         numeric not null,
  primary key (snapshot_date, metric, dimension)
);
-- 0002 outreach + sales
create table ops.activity (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references ops.institution(id) on delete cascade,
  contact_id     uuid references ops.contact(id),
  staff_id       uuid not null references ops.staff(id) default auth.uid(),
  kind           text not null check (kind in
                 ('visit','call','email','whatsapp','stem_class','event_booth')),
  outcome        text check (outcome in
                 ('no_answer','interested','not_interested','follow_up','qualified')),
  notes          text,
  happened_at    timestamptz not null default now(),
  next_step      text,
  next_step_due  date
);
create index on ops.activity (institution_id, happened_at desc);

create table ops.deal (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references ops.institution(id),
  kind           text not null check (kind in ('workshop','fdp','lab_setup','bundle')),
  title          text not null,
  stage          text not null default 'meeting'
                 check (stage in ('meeting','proposal','negotiation','won','lost')),
  value_inr      numeric(12,2) not null default 0,
  probability    smallint check (probability between 0 and 100),
  expected_close date,
  owner_id       uuid not null references ops.staff(id),
  lost_reason    text,
  won_at         timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (stage <> 'lost' or lost_reason is not null)
);
create index on ops.deal (stage, expected_close);
create trigger t_deal_upd before update on ops.deal
  for each row execute function ops.touch_updated_at();
create trigger t_deal_audit after insert or update or delete on ops.deal
  for each row execute function ops.audit();

create table ops.deal_line (
  id             uuid primary key default gen_random_uuid(),
  deal_id        uuid not null references ops.deal(id) on delete cascade,
  description    text not null,
  qty            numeric not null default 1 check (qty > 0),
  unit_price_inr numeric(12,2) not null default 0
);
-- 0003 workshop + inventory
create table ops.event (
  id                 uuid primary key default gen_random_uuid(),
  institution_id     uuid not null references ops.institution(id),
  deal_id            uuid references ops.deal(id),
  kind               text not null check (kind in
                     ('school_workshop','college_workshop','fdp','stem_class','cohort')),
  title              text not null,
  starts_at          timestamptz,
  ends_at            timestamptz,
  venue              text,
  lead_trainer_id    uuid references ops.staff(id),
  expected_headcount int check (expected_headcount > 0),
  actual_headcount   int check (actual_headcount >= 0),
  status             text not null default 'draft'
                     check (status in ('draft','scheduled','in_progress','completed','cancelled')),
  satisfaction_score numeric(3,2) check (satisfaction_score between 0 and 5),
  returns_closed_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);
create index on ops.event (lead_trainer_id, starts_at);
create trigger t_event_upd before update on ops.event
  for each row execute function ops.touch_updated_at();
create trigger t_event_audit after insert or update or delete on ops.event
  for each row execute function ops.audit();

alter table ops.feedback
  add constraint feedback_event_fk foreign key (event_id) references ops.event(id);

create table ops.event_staff (
  event_id uuid references ops.event(id) on delete cascade,
  staff_id uuid references ops.staff(id),
  role     text not null default 'assistant',
  primary key (event_id, staff_id)
);

create table ops.cohort (
  id       uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references ops.event(id) on delete cascade,
  code     text not null unique
);

create table ops.run_sheet_template (
  id         uuid primary key default gen_random_uuid(),
  event_kind text not null,
  phase      text not null check (phase in ('pre','day','post')),
  label      text not null,
  sort       int not null default 0
);

create table ops.run_sheet_item (
  id       uuid primary key default gen_random_uuid(),
  event_id uuid not null references ops.event(id) on delete cascade,
  phase    text not null check (phase in ('pre','day','post')),
  label    text not null,
  sort     int not null default 0,
  done_by  uuid references ops.staff(id),
  done_at  timestamptz
);
create index on ops.run_sheet_item (event_id, phase, sort);

create table ops.item (
  id                   uuid primary key default gen_random_uuid(),
  sku                  text not null unique,
  name                 text not null,
  category             text,
  catalog_component_id text,
  unit_cost_inr        numeric(10,2),
  reorder_level        int not null default 0
);

create table ops.kit (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);
create table ops.kit_component (
  kit_id  uuid references ops.kit(id) on delete cascade,
  item_id uuid references ops.item(id),
  qty     int not null check (qty > 0),
  primary key (kit_id, item_id)
);

create table ops.location (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  kind           text not null check (kind in
                 ('warehouse','trainer','institution','transit','store')),
  institution_id uuid references ops.institution(id),
  staff_id       uuid references ops.staff(id)
);

-- Physical stock only. Signed qty. A transfer = two rows sharing transfer_id.
create table ops.stock_movement (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references ops.item(id),
  location_id uuid not null references ops.location(id),
  qty         int not null check (qty <> 0),
  kind        text not null check (kind in
              ('received','issued','returned','damaged','lost','sold','adjustment')),
  transfer_id uuid,
  event_id    uuid references ops.event(id),
  order_ref   text,
  note        text,
  created_by  uuid references ops.staff(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  check (kind not in ('damaged','lost','adjustment') or note is not null),
  check ((kind = 'received' and qty > 0)
      or (kind in ('sold','damaged','lost') and qty < 0)
      or kind in ('issued','returned','adjustment'))
);
create index on ops.stock_movement (item_id, location_id);
create index on ops.stock_movement (event_id);
create trigger t_stock_audit after insert on ops.stock_movement
  for each row execute function ops.audit();

create table ops.stock_reservation (
  id       uuid primary key default gen_random_uuid(),
  event_id uuid not null references ops.event(id) on delete cascade,
  item_id  uuid not null references ops.item(id),
  qty      int not null check (qty > 0),
  status   text not null default 'reserved'
           check (status in ('draft','reserved','fulfilled','released')),
  unique (event_id, item_id)
);

create view ops.v_stock with (security_invoker = true) as
select i.id as item_id, i.sku, i.name, i.reorder_level,
       coalesce(m.total, 0)  as on_hand,          -- everywhere, incl. kits out in the field
       coalesce(m.wh, 0)     as in_warehouse,     -- warehouse + store only
       coalesce(r.reserved, 0) as reserved,
       coalesce(m.wh, 0) - coalesce(r.reserved, 0) as available
from ops.item i
left join (
  select sm.item_id, sum(sm.qty)::int as total,
         (sum(sm.qty) filter (where l.kind in ('warehouse','store')))::int as wh
  from ops.stock_movement sm join ops.location l on l.id = sm.location_id
  group by sm.item_id) m on m.item_id = i.id
left join (
  select item_id, sum(qty)::int as reserved from ops.stock_reservation
  where status = 'reserved' group by item_id) r on r.item_id = i.id;

create view ops.v_stock_by_location with (security_invoker = true) as
select item_id, location_id, sum(qty)::int as qty
from ops.stock_movement group by item_id, location_id having sum(qty) <> 0;
-- 0004 training
create table ops.trainer_profile (
  staff_id  uuid primary key references ops.staff(id) on delete cascade,
  level     text not null default 'L1' check (level in ('L1','L2','L3')),
  skills    text[] not null default '{}',
  home_city text
);

create table ops.training_program (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  audience text not null check (audience in ('internal_trainer','school_teacher')),
  modules  jsonb not null default '[]'
);

create table ops.enrollment (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references ops.training_program(id),
  staff_id       uuid references ops.staff(id),
  contact_id     uuid references ops.contact(id),
  institution_id uuid references ops.institution(id),
  progress       jsonb not null default '{}',
  score          numeric(5,2),
  status         text not null default 'enrolled'
                 check (status in ('enrolled','in_progress','certified','dropped')),
  certified_at   timestamptz,
  check (num_nonnulls(staff_id, contact_id) = 1),
  check (status <> 'certified' or certified_at is not null)
);

-- a trainer is "certified" for an event if they have a certified internal enrollment
create view ops.v_certified_trainer with (security_invoker = true) as
select distinct e.staff_id
from ops.enrollment e
join ops.training_program p on p.id = e.program_id
where p.audience = 'internal_trainer' and e.status = 'certified' and e.staff_id is not null;
-- 0005 product
create table ops.ide_user_snapshot (
  ide_user_id      text primary key,
  email            text,
  cohort_code      text,
  signed_up_at     timestamptz,
  first_compile_at timestamptz,
  first_flash_at   timestamptz,
  first_publish_at timestamptz,
  synced_at        timestamptz not null default now()
);
create index on ops.ide_user_snapshot (cohort_code);

create table ops.ph_user_daily (
  day         date not null,
  distinct_id text not null,
  events      int not null,
  compiles    int not null default 0,
  flashes     int not null default 0,
  errors      int not null default 0,
  primary key (day, distinct_id)
);

create table ops.ph_session (
  recording_id   text primary key,
  distinct_id    text,
  started_at     timestamptz,
  duration_s     int,
  console_errors int,
  rage_clicks    int,
  start_url      text,
  replay_url     text not null
);

create table ops.insight (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  feature     text,
  status      text not null default 'open'
              check (status in ('open','planned','in_progress','shipped','wont_fix')),
  issue_url   text,
  owner_id    uuid references ops.staff(id),
  created_at  timestamptz not null default now()
);
alter table ops.feedback
  add constraint feedback_insight_fk foreign key (insight_id) references ops.insight(id);

create table ops.review_item (
  id           uuid primary key default gen_random_uuid(),
  recording_id text not null unique references ops.ph_session(recording_id),
  reason       text not null,
  assigned_to  uuid references ops.staff(id),
  assigned_for date not null default current_date,
  status       text not null default 'pending'
               check (status in ('pending','reviewed','skipped')),
  skip_reason  text,
  check (status <> 'skipped' or skip_reason is not null)
);
create index on ops.review_item (assigned_to, assigned_for, status);

create table ops.observation (
  id             uuid primary key default gen_random_uuid(),
  review_item_id uuid references ops.review_item(id) on delete cascade,
  tag            text not null check (tag in
                 ('bug','friction','confusion','delight','feature_request')),
  severity       smallint not null check (severity between 1 and 4),
  feature        text,
  note           text not null,
  replay_ts_s    int,
  insight_id     uuid references ops.insight(id),
  created_by     uuid references ops.staff(id) default auth.uid(),
  created_at     timestamptz not null default now()
);

create table ops.incident (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  severity    text not null check (severity in ('sev1','sev2','sev3')),
  started_at  timestamptz not null,
  resolved_at timestamptz,
  root_cause  text,
  follow_ups  text,
  owner_id    uuid references ops.staff(id),
  check (resolved_at is null or resolved_at >= started_at)
);

create table ops.catalog_request (
  id                   uuid primary key default gen_random_uuid(),
  part_query           text not null unique,
  source               text not null check (source in ('agent_error','user_request','workshop')),
  request_count        int not null default 1,
  status               text not null default 'requested'
                       check (status in ('requested','researching','added','verified','published','rejected')),
  catalog_component_id text,
  owner_id             uuid references ops.staff(id),
  created_at           timestamptz not null default now()
);

create view ops.v_cohort_activation with (security_invoker = true) as
select c.code, e.id as event_id, e.institution_id,
  count(u.ide_user_id)::int as signed_up,
  (count(*) filter (where u.first_compile_at < e.ends_at + interval '7 days'))::int as compiled_7d,
  (count(*) filter (where u.first_flash_at   < e.ends_at + interval '7 days'))::int as flashed_7d,
  (count(*) filter (where u.first_publish_at is not null))::int as published
from ops.cohort c
join ops.event e on e.id = c.event_id
left join ops.ide_user_snapshot u on u.cohort_code = c.code
group by c.code, e.id, e.institution_id;
-- 0006 community
create table ops.content_item (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('video','story','post','promotion')),
  title          text not null,
  stage          text not null default 'idea'
                 check (stage in ('idea','script','shoot','edit','review','published')),
  platform       text,
  owner_id       uuid references ops.staff(id),
  institution_id uuid references ops.institution(id),
  event_id       uuid references ops.event(id),
  ide_project_id text,
  publish_date   date,
  url            text,
  views          int,
  created_at     timestamptz not null default now(),
  check (stage <> 'published' or url is not null)
);
-- 0007 business logic: helpers, state machines, automations, inventory RPCs.
-- Rules live here so every client (UI, imports, Edge Functions) must obey them.

-- ---------------------------------------------------------------- helpers
create or replace function ops.my_role() returns ops.app_role
language sql stable security definer set search_path = '' as $$
  select role from ops.staff where id = auth.uid() and is_active
$$;

create or replace function ops.is_founder() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'founder' from ops.staff
                   where id = auth.uid() and is_active), false)
$$;

-- member of a department (founder counts as all). Partners are NOT department
-- members: they only ever see rows they own (see 0008).
create or replace function ops.in_dept(d ops.department) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.staff
                 where id = auth.uid() and is_active and role <> 'partner'
                   and (role = 'founder' or d = any(departments)))
$$;

create or replace function ops.can_write() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role <> 'viewer' from ops.staff
                   where id = auth.uid() and is_active), false)
$$;

-- ---------------------------------------------------------------- institution stage: forward only
create or replace function ops.guard_institution_stage() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.stage is distinct from old.stage
     and new.stage < old.stage and new.stage <> 'churned'
     and auth.uid() is not null and not ops.is_founder() then
    raise exception 'Institution stage cannot move backwards (% -> %)', old.stage, new.stage
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger t_institution_stage before update of stage on ops.institution
  for each row execute function ops.guard_institution_stage();

-- ---------------------------------------------------------------- outreach activity -> stage, deal, follow-up task
create or replace function ops.on_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inst ops.institution%rowtype;
begin
  select * into inst from ops.institution where id = new.institution_id;

  if new.outcome = 'qualified' then
    if inst.stage < 'qualified' then
      update ops.institution set stage = 'qualified' where id = inst.id;
    end if;
    if not exists (select 1 from ops.deal where institution_id = inst.id
                   and stage in ('meeting','proposal','negotiation')) then
      insert into ops.deal (institution_id, kind, title, owner_id)
      values (inst.id, 'workshop', 'Workshop - ' || inst.name, coalesce(inst.owner_id, new.staff_id));
    end if;
  elsif new.outcome in ('interested','not_interested','follow_up') and inst.stage = 'prospect' then
    update ops.institution set stage = 'contacted' where id = inst.id;
  end if;

  if new.next_step is not null and new.next_step_due is not null then
    insert into ops.task (department, template, title, assignee_id, due_date,
                          entity_type, entity_id, created_by)
    values ('outreach', 'follow_up', new.next_step, new.staff_id, new.next_step_due,
            'institution', new.institution_id, new.staff_id);
  end if;
  return new;
end $$;
create trigger t_activity_after after insert on ops.activity
  for each row execute function ops.on_activity();

-- ---------------------------------------------------------------- deal state machine
create or replace function ops.deal_insert_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.stage <> 'meeting' and auth.uid() is not null and not ops.is_founder() then
    raise exception 'New deals must start at the Meeting stage';
  end if;
  return new;
end $$;
create trigger t_deal_0_insert before insert on ops.deal
  for each row execute function ops.deal_insert_guard();

create or replace function ops.deal_transition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.stage is distinct from old.stage then
    if old.stage = 'won' then
      raise exception 'A won deal cannot change stage';
    end if;
    if not ((old.stage = 'meeting'     and new.stage in ('proposal','lost'))
         or (old.stage = 'proposal'    and new.stage in ('meeting','negotiation','lost'))
         or (old.stage = 'negotiation' and new.stage in ('proposal','won','lost'))
         or (old.stage = 'lost'        and new.stage = 'meeting')) then
      raise exception 'Deal cannot move from % to %', old.stage, new.stage;
    end if;
    if new.stage = 'won' then
      if auth.uid() is not null and not ops.is_founder() then
        raise exception 'Only the founder can mark a deal as won';
      end if;
      new.won_at := now();
    end if;
    if new.stage = 'lost' and coalesce(btrim(new.lost_reason), '') = '' then
      raise exception 'A lost reason is required';
    end if;
    if new.stage <> 'lost' then new.lost_reason := null; end if;
  end if;
  return new;
end $$;
create trigger t_deal_1_transition before update of stage on ops.deal
  for each row execute function ops.deal_transition();

-- Won -> draft event + trainer request + kit task; institution -> deal_won
create or replace function ops.on_deal_won() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inst ops.institution%rowtype; v_event uuid;
begin
  if new.stage = 'won' and old.stage is distinct from 'won' then
    select * into inst from ops.institution where id = new.institution_id;
    if new.kind in ('workshop','fdp','bundle') then
      insert into ops.event (institution_id, deal_id, kind, title)
      values (new.institution_id, new.id,
              case when new.kind = 'fdp' then 'fdp'
                   when inst.kind = 'school' then 'school_workshop'
                   else 'college_workshop' end,
              new.title)
      returning id into v_event;
      insert into ops.task (department, template, title, entity_type, entity_id, priority)
      values ('training', 'trainer_request', 'Assign trainer: ' || new.title, 'event', v_event, 2),
             ('workshop', 'reserve_kits',     'Reserve kits: '  || new.title, 'event', v_event, 2);
    else
      insert into ops.task (department, template, title, entity_type, entity_id, priority)
      values ('workshop', 'plan_lab_setup', 'Plan lab setup: ' || new.title, 'deal', new.id, 2);
    end if;
    if inst.stage < 'deal_won' then
      update ops.institution set stage = 'deal_won' where id = inst.id;
    end if;
  end if;
  return new;
end $$;
create trigger t_deal_2_won after update of stage on ops.deal
  for each row execute function ops.on_deal_won();

-- ---------------------------------------------------------------- cohort codes
create or replace function ops.gen_cohort_code() returns text
language plpgsql volatile set search_path = '' as $$
declare alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; candidate text; i int;
begin
  loop
    candidate := 'HC-';
    for i in 1..4 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from ops.cohort c where c.code = candidate);
  end loop;
  return candidate;
end $$;

-- ---------------------------------------------------------------- trainer availability
create or replace function ops.trainer_conflict(p_staff uuid, p_from timestamptz,
                                                p_to timestamptz, p_exclude uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from ops.event e
    where e.id is distinct from p_exclude
      and e.status in ('scheduled','in_progress')
      and e.starts_at is not null and e.ends_at is not null
      and tstzrange(e.starts_at, e.ends_at, '[]') && tstzrange(p_from, p_to, '[]')
      and (e.lead_trainer_id = p_staff
           or exists (select 1 from ops.event_staff s
                      where s.event_id = e.id and s.staff_id = p_staff)));
$$;

create or replace function ops.event_staff_guard() returns trigger
language plpgsql set search_path = '' as $$
declare e ops.event%rowtype;
begin
  select * into e from ops.event where id = new.event_id;
  if e.starts_at is not null and e.ends_at is not null
     and ops.trainer_conflict(new.staff_id, e.starts_at, e.ends_at, e.id) then
    raise exception 'Trainer is already booked during this event';
  end if;
  return new;
end $$;
create trigger t_event_staff_guard before insert on ops.event_staff
  for each row execute function ops.event_staff_guard();

-- ---------------------------------------------------------------- event state machine
create or replace function ops.event_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'New events must start as draft'; end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'draft'       and new.status in ('scheduled','cancelled'))
         or (old.status = 'scheduled'   and new.status in ('draft','in_progress','completed','cancelled'))
         or (old.status = 'in_progress' and new.status in ('completed','cancelled'))) then
      raise exception 'Event cannot move from % to %', old.status, new.status;
    end if;
  end if;

  if new.status = 'scheduled' then
    if new.lead_trainer_id is null or new.starts_at is null or new.ends_at is null
       or coalesce(btrim(new.venue), '') = '' or new.expected_headcount is null then
      raise exception 'To schedule an event set: lead trainer, start, end, venue and expected headcount';
    end if;
    if not (exists (select 1 from ops.staff s
                    where s.id = new.lead_trainer_id and s.role = 'founder')
            or exists (select 1 from ops.v_certified_trainer c
                       where c.staff_id = new.lead_trainer_id)) then
      raise exception 'Lead trainer is not certified';
    end if;
    if ops.trainer_conflict(new.lead_trainer_id, new.starts_at, new.ends_at, new.id) then
      raise exception 'Lead trainer is already booked during this time';
    end if;
  end if;

  if new.status = 'completed' and old.status is distinct from 'completed' then
    if new.actual_headcount is null then
      raise exception 'Enter actual headcount before completing the event';
    end if;
    if exists (select 1 from ops.run_sheet_item
               where event_id = new.id and phase in ('pre','day') and done_at is null) then
      raise exception 'Finish all pre-event and event-day run sheet items first';
    end if;
  end if;
  return new;
end $$;
create trigger t_event_0_guard before insert or update on ops.event
  for each row execute function ops.event_guard();

create or replace function ops.on_event_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = old.status then return new; end if;

  if new.status = 'scheduled' then
    insert into ops.cohort (event_id, code) values (new.id, ops.gen_cohort_code())
    on conflict (event_id) do nothing;
    if not exists (select 1 from ops.run_sheet_item where event_id = new.id) then
      insert into ops.run_sheet_item (event_id, phase, label, sort)
      select new.id, phase, label, sort from ops.run_sheet_template where event_kind = new.kind;
    end if;

  elsif new.status = 'completed' then
    insert into ops.task (department, template, title, assignee_id, due_date, entity_type, entity_id)
    values ('workshop', 'send_survey',    'Send feedback survey: ' || new.title, new.lead_trainer_id, current_date + 1, 'event', new.id),
           ('workshop', 'close_returns',  'Close kit returns: '    || new.title, new.lead_trainer_id, current_date + 2, 'event', new.id),
           ('community','collect_photos', 'Collect photos/stories: '|| new.title, null,               current_date + 3, 'event', new.id),
           ('workshop', 'college_report', 'College report: '       || new.title, new.lead_trainer_id, current_date + 5, 'event', new.id);
    update ops.institution set stage = 'workshop_delivered'
      where id = new.institution_id and stage < 'workshop_delivered';

  elsif new.status = 'cancelled' then
    update ops.stock_reservation set status = 'released'
      where event_id = new.id and status = 'reserved';
  end if;
  return new;
end $$;
create trigger t_event_1_status after update of status on ops.event
  for each row execute function ops.on_event_status();

-- default run-sheet templates
insert into ops.run_sheet_template (event_kind, phase, label, sort)
select k.kind, t.phase, t.label, t.sort
from (values ('school_workshop'),('college_workshop'),('fdp'),('stem_class'),('cohort')) as k(kind)
cross join (values
  ('pre','Venue and dates confirmed',1),
  ('pre','Trainer assigned',2),
  ('pre','Kits reserved',3),
  ('pre','Cohort code shared with the institution',4),
  ('pre','Student list received',5),
  ('day','Attendance taken',1),
  ('day','Kits issued',2),
  ('day','Students signed up to the IDE with the cohort code',3),
  ('post','Kits returned and checked',1),
  ('post','Feedback survey sent',2),
  ('post','College report shared',3),
  ('post','Photos uploaded for Community',4)
) as t(phase, label, sort);

-- ---------------------------------------------------------------- inventory
create or replace function ops.guard_stock() returns trigger
language plpgsql security definer set search_path = '' as $$
declare bal int;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.item_id::text || new.location_id::text, 0));
  select coalesce(sum(qty), 0) into bal from ops.stock_movement
   where item_id = new.item_id and location_id = new.location_id;
  if bal + new.qty < 0 then
    raise exception 'Insufficient stock for item % at location % (have %, change %)',
      new.item_id, new.location_id, bal, new.qty;
  end if;
  return new;
end $$;
create trigger t_stock_guard before insert on ops.stock_movement
  for each row execute function ops.guard_stock();

create or replace function ops.reserve_kit(p_event uuid, p_kit uuid, p_qty int)
returns void language plpgsql set search_path = '' as $$
declare r record; st text; avail int; n int := 0;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be positive'; end if;
  select status into st from ops.event where id = p_event;
  if st is null then raise exception 'Event not found'; end if;
  if st not in ('draft','scheduled') then
    raise exception 'Kits can only be reserved for draft or scheduled events (event is %)', st;
  end if;
  for r in select c.item_id, c.qty * p_qty as need, i.sku
           from ops.kit_component c join ops.item i on i.id = c.item_id
           where c.kit_id = p_kit order by i.sku loop
    n := n + 1;
    perform pg_advisory_xact_lock(hashtextextended('res' || r.item_id::text, 0));
    select available into avail from ops.v_stock where item_id = r.item_id;
    if avail < r.need then
      raise exception 'Not enough % available: need %, available %', r.sku, r.need, avail;
    end if;
    insert into ops.stock_reservation (event_id, item_id, qty)
    values (p_event, r.item_id, r.need)
    on conflict (event_id, item_id) do update
      set qty = ops.stock_reservation.qty + excluded.qty, status = 'reserved';
  end loop;
  if n = 0 then raise exception 'Kit not found or has no components'; end if;
end $$;

create or replace function ops.issue_kit(p_event uuid, p_kit uuid, p_qty int,
                                         p_from uuid, p_to uuid)
returns void language plpgsql set search_path = '' as $$
declare r record; st text; t uuid := gen_random_uuid(); n int := 0;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be positive'; end if;
  if p_from = p_to then raise exception 'From and to locations must differ'; end if;
  select status into st from ops.event where id = p_event;
  if st not in ('scheduled','in_progress') then
    raise exception 'Kits can only be issued for scheduled or in-progress events';
  end if;
  for r in select c.item_id, c.qty * p_qty as need
           from ops.kit_component c where c.kit_id = p_kit loop
    n := n + 1;
    insert into ops.stock_movement (item_id, location_id, qty, kind, transfer_id, event_id)
    values (r.item_id, p_from, -r.need, 'issued', t, p_event),
           (r.item_id, p_to,    r.need, 'issued', t, p_event);
    update ops.stock_reservation set status = 'fulfilled'
      where event_id = p_event and item_id = r.item_id and status = 'reserved';
  end loop;
  if n = 0 then raise exception 'Kit not found or has no components'; end if;
end $$;

-- p_returns: [{"item_id": "...", "returned": n, "damaged": n, "lost": n}, ...]
create or replace function ops.close_event_returns(p_event uuid, p_field uuid, p_back uuid,
                                                   p_returns jsonb, p_note text default null)
returns void language plpgsql set search_path = '' as $$
declare r record; line jsonb; ret int; dmg int; lst int; t uuid; st text; closed timestamptz;
        total_bad int := 0;
begin
  select status, returns_closed_at into st, closed from ops.event where id = p_event;
  if st is null then raise exception 'Event not found'; end if;
  if st not in ('in_progress','completed') then
    raise exception 'Returns can be closed once the event has run';
  end if;
  if closed is not null then raise exception 'Returns already closed for this event'; end if;

  for r in select item_id, sum(qty)::int as issued from ops.stock_movement
           where event_id = p_event and location_id = p_field and kind = 'issued' and qty > 0
           group by item_id loop
    select x into line from jsonb_array_elements(p_returns) x
     where (x->>'item_id')::uuid = r.item_id;
    if line is null then raise exception 'Missing return line for item %', r.item_id; end if;
    ret := coalesce((line->>'returned')::int, 0);
    dmg := coalesce((line->>'damaged')::int, 0);
    lst := coalesce((line->>'lost')::int, 0);
    if ret < 0 or dmg < 0 or lst < 0 or ret + dmg + lst <> r.issued then
      raise exception 'Item %: returned + damaged + lost must equal issued (%)', r.item_id, r.issued;
    end if;
    if (dmg + lst) > 0 and coalesce(btrim(p_note), '') = '' then
      raise exception 'A note is required when items are damaged or lost';
    end if;
    total_bad := total_bad + dmg + lst;
    t := gen_random_uuid();
    if ret > 0 then
      insert into ops.stock_movement (item_id, location_id, qty, kind, transfer_id, event_id)
      values (r.item_id, p_field, -ret, 'returned', t, p_event),
             (r.item_id, p_back,   ret, 'returned', t, p_event);
    end if;
    if dmg > 0 then
      insert into ops.stock_movement (item_id, location_id, qty, kind, event_id, note)
      values (r.item_id, p_field, -dmg, 'damaged', p_event, p_note);
    end if;
    if lst > 0 then
      insert into ops.stock_movement (item_id, location_id, qty, kind, event_id, note)
      values (r.item_id, p_field, -lst, 'lost', p_event, p_note);
    end if;
  end loop;

  update ops.event set returns_closed_at = now() where id = p_event;
  update ops.task set status = 'done'
   where entity_type = 'event' and entity_id = p_event and template = 'close_returns';
  if total_bad > 0 then
    insert into ops.task (department, template, title, entity_type, entity_id, priority)
    values ('workshop', 'review_kit_loss',
            'Review ' || total_bad || ' damaged/lost item(s): ' || p_note, 'event', p_event, 2);
  end if;
end $$;

create view ops.v_low_stock with (security_invoker = true) as
select * from ops.v_stock where reorder_level > 0 and available < reorder_level;

create or replace function ops.raise_low_stock_tasks() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into ops.task (department, template, title, priority, entity_type, entity_id)
  select 'workshop', 'low_stock',
         'Reorder ' || s.name || ' (available ' || s.available || ', level ' || s.reorder_level || ')',
         2, 'item', s.item_id
  from ops.v_low_stock s
  where not exists (select 1 from ops.task t
                    where t.entity_type = 'item' and t.entity_id = s.item_id
                      and t.template = 'low_stock' and t.status in ('todo','doing','blocked'));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- training: certification -> stage
create or replace function ops.on_enrollment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'certified' and new.contact_id is not null and new.institution_id is not null then
    if not exists (select 1 from ops.enrollment e
                   where e.institution_id = new.institution_id and e.program_id = new.program_id
                     and e.contact_id is not null and e.status in ('enrolled','in_progress')) then
      update ops.institution set stage = 'teachers_trained'
       where id = new.institution_id and stage < 'teachers_trained';
    end if;
  end if;
  return new;
end $$;
create trigger t_enrollment_after after insert or update of status on ops.enrollment
  for each row execute function ops.on_enrollment();

-- ---------------------------------------------------------------- product
create or replace function ops.on_observation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update ops.review_item set status = 'reviewed'
   where id = new.review_item_id and status = 'pending';
  return new;
end $$;
create trigger t_observation_after after insert on ops.observation
  for each row execute function ops.on_observation();

-- daily review queue: round-robin the highest-signal sessions across product reviewers
create or replace function ops.assign_review_queue(p_day date default current_date,
                                                   p_quota int default 15)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with reviewers as (
    select id, row_number() over (order by id) as rn, count(*) over () as cnt
    from ops.staff
    where is_active and 'product' = any(departments) and role in ('founder','dept_lead','member')),
  cand as (
    select ri.id, row_number() over (order by s.rage_clicks desc nulls last,
                                              s.console_errors desc nulls last, ri.id) as k
    from ops.review_item ri join ops.ph_session s on s.recording_id = ri.recording_id
    where ri.assigned_to is null and ri.status = 'pending')
  update ops.review_item ri
     set assigned_to = rv.id, assigned_for = p_day
    from cand c join reviewers rv on rv.rn = ((c.k - 1) % rv.cnt) + 1
   where ri.id = c.id and c.k <= p_quota * rv.cnt;
  get diagnostics n = row_count;
  return n;
end $$;

-- part requests from agent failures: dedupe + count
create or replace function ops.request_part(p_query text, p_source text default 'agent_error')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into ops.catalog_request (part_query, source) values (lower(btrim(p_query)), p_source)
  on conflict (part_query) do update set request_count = ops.catalog_request.request_count + 1
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- feedback routing
create or replace function ops.route_feedback() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.owner_department is null then
    new.owner_department := case new.source
      when 'session_replay'   then 'product'
      when 'workshop_survey'  then 'workshop'
      when 'community'        then 'community'
      when 'teacher'          then 'training'
      when 'sales_call'       then 'sales'
      else 'product' end;
  end if;
  return new;
end $$;
create trigger t_feedback_route before insert on ops.feedback
  for each row execute function ops.route_feedback();
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
-- 0009 access: invite-only team onboarding.
-- Flow: founder invites an email with a role + departments -> person signs in with Google/magic
-- link -> app calls ops.claim_access() -> a staff row is created from the invite.
-- No invite = no staff row = RLS shows nothing.

create table ops.invite (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email = lower(btrim(email)) and email like '%_@_%.__%'),
  full_name   text,
  role        ops.app_role not null default 'member',
  departments ops.department[] not null default '{}',
  invited_by  uuid references ops.staff(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  accepted_at timestamptz,
  accepted_by uuid references ops.staff(id)
);
-- one open invite per email
create unique index invite_open_email on ops.invite (email) where accepted_at is null;
create trigger t_invite_audit after insert or update or delete on ops.invite
  for each row execute function ops.audit();
create trigger t_staff_audit after insert or update or delete on ops.staff
  for each row execute function ops.audit();

alter table ops.invite enable row level security;
create policy invite_founder on ops.invite for all to authenticated
  using (ops.is_founder()) with check (ops.is_founder());

-- never lock the company out: the last active founder cannot be demoted, disabled or deleted
create or replace function ops.guard_last_founder() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'founder' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'founder' or not new.is_active) then
    if not exists (select 1 from ops.staff
                   where role = 'founder' and is_active and id <> old.id) then
      raise exception 'There must be at least one active founder';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger t_staff_last_founder before update or delete on ops.staff
  for each row execute function ops.guard_last_founder();

-- Called by the app right after every sign-in. Returns the caller's access state.
--   active | disabled | claimed (just created from an invite) | no_invite
create or replace function ops.claim_access() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid   uuid := auth.uid();
  mail  text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  nm    text := nullif(btrim(coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', '')), '');
  s     ops.staff%rowtype;
  inv   ops.invite%rowtype;
begin
  if uid is null then raise exception 'Not signed in'; end if;

  select * into s from ops.staff where id = uid;
  if found then
    return jsonb_build_object('status', case when s.is_active then 'active' else 'disabled' end,
                              'role', s.role, 'departments', s.departments);
  end if;

  select * into inv from ops.invite
   where email = mail and accepted_at is null and expires_at > now()
   for update;
  if not found then
    return jsonb_build_object('status', 'no_invite');
  end if;

  insert into ops.staff (id, full_name, email, role, departments)
  values (uid, coalesce(inv.full_name, nm, split_part(mail, '@', 1)), mail, inv.role, inv.departments);
  update ops.invite set accepted_at = now(), accepted_by = uid where id = inv.id;

  return jsonb_build_object('status', 'claimed', 'role', inv.role, 'departments', inv.departments);
end $$;
revoke execute on function ops.claim_access() from public, anon;
grant execute on function ops.claim_access() to authenticated;

-- what the app needs to render the shell: who am I and what may I open
create or replace function ops.me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('id', id, 'full_name', full_name, 'email', email,
                               'role', role, 'departments', departments)
       from ops.staff where id = auth.uid() and is_active),
    'null'::jsonb)
$$;
grant execute on function ops.me() to authenticated;
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
-- 0011 archive: soft delete for institutions, deals and events (decision D21).
-- Records are archived, not deleted, so history (audit log, stock movements, KPIs) stays intact.
-- Screens hide archived rows by default (`archived_at is null`); restoring clears the stamp.
alter table ops.institution
  add column archived_at timestamptz,
  add column archived_by uuid references ops.staff(id);
alter table ops.deal
  add column archived_at timestamptz,
  add column archived_by uuid references ops.staff(id);
alter table ops.event
  add column archived_at timestamptz,
  add column archived_by uuid references ops.staff(id);

create index institution_archived_by_fkey_ix on ops.institution (archived_by);
create index deal_archived_by_fkey_ix on ops.deal (archived_by);
create index event_archived_by_fkey_ix on ops.event (archived_by);
-- lists show active rows only, so keep that path cheap
create index institution_active_idx on ops.institution (name) where archived_at is null;
create index deal_active_idx on ops.deal (stage, expected_close) where archived_at is null;
create index event_active_idx on ops.event (starts_at) where archived_at is null;

-- Who may archive/restore, and what must be finished first. auth.uid() is null (service role,
-- SQL editor, migrations) bypasses the role check like the other guards in 0007.
create or replace function ops.guard_archive() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.archived_at is not distinct from old.archived_at then
    return new;
  end if;

  if auth.uid() is not null and ops.my_role() not in ('founder', 'dept_lead') then
    raise exception 'Only a founder or department lead can archive or restore records';
  end if;

  if new.archived_at is not null and old.archived_at is null then
    if tg_table_name = 'institution' then
      if exists (select 1 from ops.deal d where d.institution_id = new.id
                 and d.archived_at is null and d.stage in ('meeting','proposal','negotiation')) then
        raise exception 'Close or archive the institution''s open deals first';
      end if;
      if exists (select 1 from ops.event e where e.institution_id = new.id
                 and e.archived_at is null and e.status in ('scheduled','in_progress')) then
        raise exception 'Cancel or complete the institution''s scheduled events first';
      end if;
    elsif tg_table_name = 'deal' then
      if new.stage in ('meeting','proposal','negotiation') then
        raise exception 'Mark the deal won or lost before archiving it';
      end if;
    elsif tg_table_name = 'event' then
      if new.status in ('scheduled','in_progress') then
        raise exception 'Cancel or complete the event before archiving it';
      end if;
    end if;
    new.archived_by := auth.uid();
  elsif new.archived_at is null then
    new.archived_by := null;
  end if;
  return new;
end $$;

create trigger t_institution_archive before update of archived_at on ops.institution
  for each row execute function ops.guard_archive();
create trigger t_deal_archive before update of archived_at on ops.deal
  for each row execute function ops.guard_archive();
create trigger t_event_archive before update of archived_at on ops.event
  for each row execute function ops.guard_archive();

-- new functions get PUBLIC execute by default; remove it (see 0010 section 1)
revoke execute on all functions in schema ops from public;
-- 0012: stop signed-in users calling ops.trainer_conflict() directly over the API.
-- With `ops` exposed in the Data API, any authenticated user (incl. partners) could probe whether a
-- named trainer is booked in a time window. Only triggers need it, so make the trigger that calls it
-- SECURITY DEFINER (event_guard already is) and revoke the direct grant.
create or replace function ops.event_staff_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e ops.event%rowtype;
begin
  select * into e from ops.event where id = new.event_id;
  if e.starts_at is not null and e.ends_at is not null
     and ops.trainer_conflict(new.staff_id, e.starts_at, e.ends_at, e.id) then
    raise exception 'Trainer is already booked during this event';
  end if;
  return new;
end $$;

revoke execute on function ops.trainer_conflict(uuid, timestamptz, timestamptz, uuid) from authenticated;
revoke execute on all functions in schema ops from public;
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
-- 0014 deal types, segments, funnel views, community membership
-- 1. Deal types are Workshop, Faculty training (fdp), Lab deal (lab_setup) and Other (replaces bundle).
-- 2. One open deal per type per institution (different types may run in parallel).
-- 3. institution.segment (school / college / other) for funnel and pipeline reports.
-- 4. ops.community_membership: clubs, ambassadors and other community ties, many per institution.

-- ---------------------------------------------------------------- 1. deal types
alter table ops.deal drop constraint deal_kind_check;
update ops.deal set kind = 'other' where kind = 'bundle';
alter table ops.deal add constraint deal_kind_check check (kind in ('workshop','fdp','lab_setup','other'));

-- ---------------------------------------------------------------- 2. one open deal per type
create unique index deal_one_open_per_kind on ops.deal (institution_id, kind)
  where stage in ('meeting','proposal','negotiation') and archived_at is null;

-- The auto-created deal from a qualified activity is a Workshop deal; skip it only when a Workshop
-- deal is already open (a parallel Lab deal does not block it).
create or replace function ops.on_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inst ops.institution%rowtype;
begin
  select * into inst from ops.institution where id = new.institution_id;

  if new.outcome = 'qualified' then
    if inst.stage < 'qualified' then
      update ops.institution set stage = 'qualified' where id = inst.id;
    end if;
    if not exists (select 1 from ops.deal where institution_id = inst.id and archived_at is null
                   and stage in ('meeting','proposal','negotiation')) then
      insert into ops.deal (institution_id, kind, title, owner_id)
      values (inst.id, 'workshop', 'Workshop - ' || inst.name, coalesce(inst.owner_id, new.staff_id));
    end if;
  elsif new.outcome in ('interested','not_interested','follow_up') and inst.stage = 'prospect' then
    update ops.institution set stage = 'contacted' where id = inst.id;
  end if;

  if new.next_step is not null and new.next_step_due is not null then
    insert into ops.task (department, template, title, assignee_id, due_date,
                          entity_type, entity_id, created_by)
    values ('outreach', 'follow_up', new.next_step, new.staff_id, new.next_step_due,
            'institution', new.institution_id, new.staff_id);
  end if;
  return new;
end $$;

-- Won: workshop/fdp -> draft event + trainer + kit tasks; lab_setup -> plan-lab task;
-- other -> a Sales follow-up task only (no event, no kits).
create or replace function ops.on_deal_won() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inst ops.institution%rowtype; v_event uuid;
begin
  if new.stage = 'won' and old.stage is distinct from 'won' then
    select * into inst from ops.institution where id = new.institution_id;
    if new.kind in ('workshop','fdp') then
      insert into ops.event (institution_id, deal_id, kind, title)
      values (new.institution_id, new.id,
              case when new.kind = 'fdp' then 'fdp'
                   when inst.kind = 'school' then 'school_workshop'
                   else 'college_workshop' end,
              new.title)
      returning id into v_event;
      insert into ops.task (department, template, title, entity_type, entity_id, priority)
      values ('training', 'trainer_request', 'Assign trainer: ' || new.title, 'event', v_event, 2),
             ('workshop', 'reserve_kits',     'Reserve kits: '  || new.title, 'event', v_event, 2);
    elsif new.kind = 'lab_setup' then
      insert into ops.task (department, template, title, entity_type, entity_id, priority)
      values ('workshop', 'plan_lab_setup', 'Plan lab setup: ' || new.title, 'deal', new.id, 2);
    else
      insert into ops.task (department, template, title, entity_type, entity_id, priority)
      values ('sales', 'plan_other_deal', 'Plan delivery: ' || new.title, 'deal', new.id, 2);
    end if;
    if inst.stage < 'deal_won' then
      update ops.institution set stage = 'deal_won' where id = inst.id;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- 3. segment
alter table ops.institution add column segment text generated always as (
  case kind when 'school' then 'school'
            when 'other' then 'other'
            else 'college' end) stored;
create index institution_segment_idx on ops.institution (segment) where archived_at is null;

-- Funnel: institutions per segment and lifecycle stage. Pipeline: deals per type, segment and stage.
-- security_invoker, so each viewer only counts what RLS lets them see.
create view ops.v_funnel with (security_invoker = true) as
select i.segment, i.stage, count(*)::int as institutions
from ops.institution i
where i.archived_at is null
group by i.segment, i.stage;

create view ops.v_pipeline with (security_invoker = true) as
select d.kind, i.segment, d.stage, count(*)::int as deals,
       coalesce(sum(d.value_inr), 0)::numeric(14,2) as value_inr,
       coalesce(sum(d.value_inr * coalesce(d.probability, 0) / 100.0), 0)::numeric(14,2) as weighted_inr
from ops.deal d
join ops.institution i on i.id = d.institution_id
where d.archived_at is null
group by d.kind, i.segment, d.stage;

-- ---------------------------------------------------------------- 4. community membership
create table ops.community_membership (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references ops.institution(id) on delete cascade,
  kind           text not null check (kind in ('club','ambassador','other')),
  name           text not null check (btrim(name) <> ''),
  status         text not null default 'invited' check (status in ('invited','active','champion','inactive')),
  contact_id     uuid references ops.contact(id) on delete set null,
  owner_id       uuid references ops.staff(id),
  started_on     date,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index community_membership_unique on ops.community_membership (institution_id, kind, lower(btrim(name)));
create index on ops.community_membership (contact_id);
create index on ops.community_membership (owner_id);
create index on ops.community_membership (status);
create trigger t_community_membership_upd before update on ops.community_membership
  for each row execute function ops.touch_updated_at();
create trigger t_community_membership_audit after insert or update or delete on ops.community_membership
  for each row execute function ops.audit();

alter table ops.community_membership enable row level security;
-- readable by every internal non-partner member (like institutions); written by Community, founder, leads
create policy community_membership_sel on ops.community_membership for select to authenticated
  using ((select ops.my_role()) is not null and (select ops.my_role()) <> 'partner');
create policy community_membership_ins on ops.community_membership for insert to authenticated
  with check ((select ops.can_write()) and (select ops.in_dept('community')));
create policy community_membership_upd on ops.community_membership for update to authenticated
  using ((select ops.can_write()) and (select ops.in_dept('community')))
  with check ((select ops.can_write()) and (select ops.in_dept('community')));
create policy community_membership_del on ops.community_membership for delete to authenticated
  using ((select ops.in_dept('community')) and (select ops.my_role()) in ('founder','dept_lead'));

revoke execute on all functions in schema ops from public;
-- 0015: territory view for the Outreach workspace.
-- One row per live institution with its last touch, so Outreach can list "untouched" or "gone cold"
-- institutions by district/segment with server-side filters and pagination. security_invoker: each
-- viewer only sees institutions and activities their own RLS allows (a partner: only their own).
create view ops.v_territory with (security_invoker = true) as
select i.id, i.name, i.kind, i.segment, i.city, i.district, i.state, i.stage, i.owner_id,
       a.last_activity_at, a.activities
from ops.institution i
left join lateral (
  select max(x.happened_at) as last_activity_at, count(*)::int as activities
  from ops.activity x
  where x.institution_id = i.id
) a on true
where i.archived_at is null;

revoke execute on all functions in schema ops from public;
-- 0016 deal guards (Sales workspace)
-- 1. A deal value can never be negative.
-- 2. Once a deal is Won, only the founder can change what it is worth or who it is for (D7: partner
--    KPIs and equity depend on Won deals, so a partner or member must not edit them afterwards).
-- 3. deal_line.seq keeps the order the lines were entered in (ids are random uuids).
-- 4. ops.replace_deal_lines(): the proposal lines of a deal are saved as one atomic set.

alter table ops.deal_line add column seq bigint generated always as identity;

create or replace function ops.deal_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.value_inr < 0 then
    raise exception 'A deal value cannot be negative';
  end if;
  if tg_op = 'UPDATE' and old.stage = 'won' and auth.uid() is not null and not ops.is_founder()
     and (new.value_inr is distinct from old.value_inr
          or new.kind is distinct from old.kind
          or new.institution_id is distinct from old.institution_id
          or new.owner_id is distinct from old.owner_id
          or new.title is distinct from old.title
          or new.probability is distinct from old.probability
          or new.expected_close is distinct from old.expected_close) then
    raise exception 'Only the founder can change a won deal';
  end if;
  return new;
end $$;
create trigger t_deal_3_guard before insert or update on ops.deal
  for each row execute function ops.deal_guard();

create or replace function ops.deal_line_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_stage text;
begin
  select stage into v_stage from ops.deal where id = coalesce(new.deal_id, old.deal_id);
  if v_stage = 'won' and auth.uid() is not null and not ops.is_founder() then
    raise exception 'Only the founder can change the lines of a won deal';
  end if;
  return coalesce(new, old);
end $$;
create trigger t_deal_line_guard before insert or update or delete on ops.deal_line
  for each row execute function ops.deal_line_guard();

-- Replaces every line of a deal in one transaction. Security definer because deleting lines is a
-- lead-only RLS action while replacing a draft proposal is everyday work for Sales; the access
-- check below is the same one the deal_upd policy applies (write access + Sales, or a partner's own deal).
create or replace function ops.replace_deal_lines(p_deal uuid, p_lines jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare d ops.deal%rowtype; l jsonb; n integer := 0;
begin
  select * into d from ops.deal where id = p_deal;
  if not found then raise exception 'Deal not found'; end if;
  if auth.uid() is not null and not (
       ops.can_write() and (ops.in_dept('sales') or (ops.my_role() = 'partner' and d.owner_id = auth.uid()))) then
    raise exception 'You do not have permission to change this deal' using errcode = '42501';
  end if;
  if d.stage = 'won' and auth.uid() is not null and not ops.is_founder() then
    raise exception 'Only the founder can change the lines of a won deal';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Lines must be a list';
  end if;
  if jsonb_array_length(p_lines) > 100 then
    raise exception 'A deal can have at most 100 lines';
  end if;

  delete from ops.deal_line where deal_id = p_deal;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce(btrim(l->>'description'), '') = '' then raise exception 'Every line needs a description'; end if;
    if length(l->>'description') > 200 then raise exception 'A line description can be at most 200 characters'; end if;
    if coalesce((l->>'qty')::numeric, 0) <= 0 then raise exception 'Every line needs a quantity above zero'; end if;
    if coalesce((l->>'unit_price_inr')::numeric, 0) < 0 then raise exception 'A unit price cannot be negative'; end if;
    insert into ops.deal_line (deal_id, description, qty, unit_price_inr)
    values (p_deal, btrim(l->>'description'), (l->>'qty')::numeric, coalesce((l->>'unit_price_inr')::numeric, 0));
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.replace_deal_lines(uuid, jsonb) to authenticated, service_role;
-- 0017 workshop guards (Workshop workspace)
-- 1. A cancelled event needs a reason (event.cancel_reason).
-- 2. An event has at most 2 assistants (D18); an assistant must be active internal staff and cannot be the lead.
-- 3. Scheduling and re-scheduling re-check every assistant for double-booking, not just the lead
--    (before, moving the dates of a scheduled event could silently double-book an assistant).
-- 4. Run-sheet ticks are stamped by the database: done_by is always the caller and done_at is now().
-- 5. ops.set_event_team(): lead + assistants are saved as one atomic set. Security definer because removing
--    an assistant is a lead-only RLS action while fixing a team is everyday work for Workshop.

alter table ops.event add column cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500);

-- ---------------------------------------------------------------- assistants
create or replace function ops.event_staff_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e ops.event%rowtype; s ops.staff%rowtype;
begin
  select * into e from ops.event where id = new.event_id;
  select * into s from ops.staff where id = new.staff_id;
  if not found or not s.is_active or s.role = 'partner' then
    raise exception 'An assistant must be an active member of the team';
  end if;
  if e.lead_trainer_id = new.staff_id then
    raise exception 'The lead trainer cannot also be an assistant';
  end if;
  if (select count(*) from ops.event_staff x where x.event_id = new.event_id and x.staff_id <> new.staff_id) >= 2 then
    raise exception 'An event can have at most 2 assistants';
  end if;
  if e.starts_at is not null and e.ends_at is not null
     and ops.trainer_conflict(new.staff_id, e.starts_at, e.ends_at, e.id) then
    raise exception 'Trainer is already booked during this event';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- event state machine
create or replace function ops.event_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare busy text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'New events must start as draft'; end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'draft'       and new.status in ('scheduled','cancelled'))
         or (old.status = 'scheduled'   and new.status in ('draft','in_progress','completed','cancelled'))
         or (old.status = 'in_progress' and new.status in ('completed','cancelled'))) then
      raise exception 'Event cannot move from % to %', old.status, new.status;
    end if;
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and coalesce(btrim(new.cancel_reason), '') = '' then
    raise exception 'A cancellation reason is required';
  end if;

  if new.lead_trainer_id is not null and new.lead_trainer_id is distinct from old.lead_trainer_id
     and exists (select 1 from ops.event_staff s where s.event_id = new.id and s.staff_id = new.lead_trainer_id) then
    raise exception 'The lead trainer cannot also be an assistant';
  end if;

  if new.status = 'scheduled' then
    if new.lead_trainer_id is null or new.starts_at is null or new.ends_at is null
       or coalesce(btrim(new.venue), '') = '' or new.expected_headcount is null then
      raise exception 'To schedule an event set: lead trainer, start, end, venue and expected headcount';
    end if;
    if not (exists (select 1 from ops.staff s
                    where s.id = new.lead_trainer_id and s.role = 'founder')
            or exists (select 1 from ops.v_certified_trainer c
                       where c.staff_id = new.lead_trainer_id)) then
      raise exception 'Lead trainer is not certified';
    end if;
    if ops.trainer_conflict(new.lead_trainer_id, new.starts_at, new.ends_at, new.id) then
      raise exception 'Lead trainer is already booked during this time';
    end if;
    select st.full_name into busy
      from ops.event_staff es join ops.staff st on st.id = es.staff_id
     where es.event_id = new.id
       and ops.trainer_conflict(es.staff_id, new.starts_at, new.ends_at, new.id)
     limit 1;
    if busy is not null then
      raise exception 'Assistant % is already booked during this time', busy;
    end if;
  elsif new.status = 'in_progress'
        and (old.status is distinct from 'in_progress' or new.starts_at is distinct from old.starts_at
             or new.ends_at is distinct from old.ends_at or new.lead_trainer_id is distinct from old.lead_trainer_id) then
    if new.lead_trainer_id is null or new.starts_at is null or new.ends_at is null then
      raise exception 'An event in progress needs a lead trainer, start and end';
    end if;
    if ops.trainer_conflict(new.lead_trainer_id, new.starts_at, new.ends_at, new.id) then
      raise exception 'Lead trainer is already booked during this time';
    end if;
    select st.full_name into busy
      from ops.event_staff es join ops.staff st on st.id = es.staff_id
     where es.event_id = new.id
       and ops.trainer_conflict(es.staff_id, new.starts_at, new.ends_at, new.id)
     limit 1;
    if busy is not null then
      raise exception 'Assistant % is already booked during this time', busy;
    end if;
  end if;

  if new.status = 'completed' and old.status is distinct from 'completed' then
    if new.actual_headcount is null then
      raise exception 'Enter actual headcount before completing the event';
    end if;
    if exists (select 1 from ops.run_sheet_item
               where event_id = new.id and phase in ('pre','day') and done_at is null) then
      raise exception 'Finish all pre-event and event-day run sheet items first';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- run sheet stamps
create or replace function ops.run_sheet_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.done_at is not null then new.done_at := now(); new.done_by := auth.uid();
    else new.done_by := null; end if;
    return new;
  end if;
  if new.event_id is distinct from old.event_id then
    raise exception 'A run sheet item cannot move to another event';
  end if;
  if new.done_at is distinct from old.done_at or new.done_by is distinct from old.done_by then
    select status into v_status from ops.event where id = new.event_id;
    if v_status = 'cancelled' then raise exception 'A cancelled event cannot be changed'; end if;
    if new.done_at is null then
      new.done_by := null;
    elsif old.done_at is null then
      new.done_at := now(); new.done_by := auth.uid();
    else
      new.done_at := old.done_at; new.done_by := old.done_by;
    end if;
  end if;
  return new;
end $$;
create trigger t_run_sheet_stamp before insert or update on ops.run_sheet_item
  for each row execute function ops.run_sheet_stamp();

-- ---------------------------------------------------------------- team
create or replace function ops.set_event_team(p_event uuid, p_lead uuid, p_assistants uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare e ops.event%rowtype; a uuid; team uuid[];
begin
  select * into e from ops.event where id = p_event;
  if not found then raise exception 'Event not found'; end if;
  if auth.uid() is not null and not (ops.can_write() and ops.in_dept('workshop')) then
    raise exception 'You do not have permission to change this event' using errcode = '42501';
  end if;
  if e.status in ('completed', 'cancelled') then
    raise exception 'The team of a % event cannot be changed', e.status;
  end if;
  team := coalesce((select array_agg(distinct x) from unnest(coalesce(p_assistants, '{}')) as x where x is not null), '{}');
  if cardinality(team) > 2 then raise exception 'An event can have at most 2 assistants'; end if;
  if p_lead is not null then
    if p_lead = any (team) then raise exception 'The lead trainer cannot also be an assistant'; end if;
    if not (exists (select 1 from ops.staff s where s.id = p_lead and s.role = 'founder' and s.is_active)
            or exists (select 1 from ops.v_certified_trainer c
                       join ops.staff s on s.id = c.staff_id
                      where c.staff_id = p_lead and s.is_active)) then
      raise exception 'Lead trainer is not certified';
    end if;
  end if;

  delete from ops.event_staff where event_id = p_event;
  update ops.event set lead_trainer_id = p_lead where id = p_event;
  foreach a in array team loop
    insert into ops.event_staff (event_id, staff_id, role) values (p_event, a, 'assistant');
  end loop;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.set_event_team(uuid, uuid, uuid[]) to authenticated, service_role;
-- 0018 task core (team collaboration, slice A)
-- 1. ops.task grows from a flat to-do into a real work item: description, due time, estimate, one level of
--    subtasks, who assigned it and when, accepted, blocked and cancel reasons, who finished it and when.
-- 2. Anyone internal can create a task and assign it to any active colleague, in any department (the department is
--    the queue that owns it). RLS lets the creator see and update what they created.
-- 3. ops.task_guard enforces the rules: one owner, a legal status path, reasons for blocked and cancelled, subtasks
--    finished first, stamps (created_by, assigned_by, completed_by) set by the database and never by the client,
--    and who may edit details, reassign or reopen.
-- 4. ops.task_history is a readable timeline written by trigger (audit_log is founder-only).
-- 5. ops.task_comment: discussion on a task, visible to whoever can see the task.

alter table ops.task
  add column description      text check (description is null or length(description) <= 4000),
  add column due_time         time,
  add column estimate_minutes integer check (estimate_minutes is null or estimate_minutes between 1 and 6000),
  add column parent_task_id   uuid references ops.task (id) on delete cascade,
  add column assigned_by      uuid references ops.staff (id),
  add column assigned_at      timestamptz,
  add column accepted_at      timestamptz,
  add column blocked_reason   text check (blocked_reason is null or length(blocked_reason) <= 500),
  add column cancel_reason    text check (cancel_reason is null or length(cancel_reason) <= 500),
  add column completed_at     timestamptz,
  add column completed_by     uuid references ops.staff (id),
  add constraint task_due_time_needs_date check (due_time is null or due_date is not null),
  add constraint task_title_not_blank check (length(btrim(title)) > 0) not valid;

update ops.task set completed_at = updated_at where status = 'done';
update ops.task set assigned_by = created_by, assigned_at = created_at where assignee_id is not null;

create index task_department_status_due_idx on ops.task (department, status, due_date);
create index task_parent_idx on ops.task (parent_task_id) where parent_task_id is not null;
create index task_created_by_idx on ops.task (created_by);
create index task_assigned_by_idx on ops.task (assigned_by);
create index task_completed_by_idx on ops.task (completed_by);

-- ---------------------------------------------------------------- history and comments
create table ops.task_history (
  id         bigint generated always as identity primary key,
  task_id    uuid not null references ops.task (id) on delete cascade,
  actor_id   uuid references ops.staff (id),
  kind       text not null check (kind in ('created', 'assigned', 'status', 'due', 'priority', 'department', 'edited')),
  from_value text,
  to_value   text,
  note       text,
  at         timestamptz not null default now()
);
create index task_history_task_idx on ops.task_history (task_id, at);
create index task_history_actor_idx on ops.task_history (actor_id);

create table ops.task_comment (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references ops.task (id) on delete cascade,
  author_id  uuid not null references ops.staff (id) default auth.uid(),
  body       text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index task_comment_task_idx on ops.task_comment (task_id, created_at);
create index task_comment_author_idx on ops.task_comment (author_id);

-- ---------------------------------------------------------------- guard
create or replace function ops.task_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid     uuid := auth.uid();
  mgr     boolean;
  a       record;
  p       record;
begin
  new.title := btrim(new.title);
  if new.title = '' then raise exception 'A task needs a title'; end if;
  if new.due_date is null then new.due_time := null; end if;

  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    select s.role, s.is_active into a from ops.staff s where s.id = new.assignee_id;
    if not found or not a.is_active then raise exception 'Choose an active team member to assign this task to'; end if;
    if a.role = 'viewer' then raise exception 'A viewer cannot be given tasks'; end if;
    if a.role = 'partner' and coalesce(new.template, '') <> 'follow_up' then
      raise exception 'Partners can only be given follow-up tasks';
    end if;
  end if;

  if new.parent_task_id is not null and (tg_op = 'INSERT' or new.parent_task_id is distinct from old.parent_task_id) then
    if new.parent_task_id = new.id then raise exception 'A task cannot be its own subtask'; end if;
    select t.parent_task_id, t.status into p from ops.task t where t.id = new.parent_task_id;
    if not found then raise exception 'The parent task was not found'; end if;
    if p.parent_task_id is not null then raise exception 'A subtask cannot have subtasks'; end if;
    if p.status in ('done', 'cancelled') then raise exception 'Add subtasks to an open task'; end if;
    if tg_op = 'UPDATE' and exists (select 1 from ops.task c where c.parent_task_id = new.id) then
      raise exception 'A task with subtasks cannot become a subtask';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'todo' then raise exception 'A new task starts as To do'; end if;
    if uid is not null then new.created_by := uid; end if;
    new.completed_at := null;
    new.completed_by := null;
    new.blocked_reason := null;
    new.cancel_reason := null;
    new.accepted_at := null;
    if new.assignee_id is not null then
      new.assigned_by := coalesce(uid, new.created_by);
      new.assigned_at := now();
      if new.assignee_id = uid then new.accepted_at := now(); end if;
    else
      new.assigned_by := null;
      new.assigned_at := null;
    end if;
    return new;
  end if;

  -- stamps are never taken from the caller
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.assigned_by := old.assigned_by;
  new.assigned_at := old.assigned_at;
  new.completed_at := old.completed_at;
  new.completed_by := old.completed_by;

  mgr := uid is null
         or ops.is_founder()
         or old.created_by = uid
         or (ops.my_role() = 'dept_lead' and ops.in_dept(old.department));

  if not mgr and (new.title is distinct from old.title
                  or new.description is distinct from old.description
                  or new.department is distinct from old.department
                  or new.entity_type is distinct from old.entity_type
                  or new.entity_id is distinct from old.entity_id
                  or new.parent_task_id is distinct from old.parent_task_id) then
    raise exception 'Only the person who created this task, a department lead or a founder can edit its details';
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    if not mgr
       and not (new.assignee_id is null and old.assignee_id = uid)
       and not (old.assignee_id is null and new.assignee_id = uid) then
      raise exception 'Only the person who assigned this task, a department lead or a founder can reassign it';
    end if;
    new.assigned_by := uid;
    new.assigned_at := case when new.assignee_id is null then null else now() end;
    new.accepted_at := case when new.assignee_id is not null and new.assignee_id = uid then now() else null end;
  elsif new.accepted_at is distinct from old.accepted_at then
    if new.accepted_at is null then
      new.accepted_at := old.accepted_at;
    elsif uid is not null and uid is distinct from new.assignee_id then
      raise exception 'Only the assignee can accept a task';
    else
      new.accepted_at := coalesce(old.accepted_at, now());
    end if;
  end if;

  if new.status is distinct from old.status then
    if old.status in ('done', 'cancelled') and not (mgr or old.completed_by = uid) then
      raise exception 'Only a lead, a founder, or the person who created or finished this task can reopen it';
    end if;
    if old.status = 'done' and new.status not in ('todo', 'doing') then
      raise exception 'A finished task can only be reopened';
    end if;
    if old.status = 'cancelled' and new.status <> 'todo' then
      raise exception 'A cancelled task can only be reopened';
    end if;
    if new.status = 'blocked' and coalesce(btrim(new.blocked_reason), '') = '' then
      raise exception 'Say what is blocking this task';
    end if;
    if new.status = 'cancelled' and coalesce(btrim(new.cancel_reason), '') = '' then
      raise exception 'Say why the task is cancelled';
    end if;
    if new.status in ('done', 'cancelled')
       and exists (select 1 from ops.task c where c.parent_task_id = new.id and c.status in ('todo', 'doing', 'blocked')) then
      raise exception 'Finish or cancel the subtasks first';
    end if;
    if new.status = 'done' then
      new.completed_at := now();
      new.completed_by := uid;
    elsif old.status = 'done' then
      new.completed_at := null;
      new.completed_by := null;
    end if;
    if new.status in ('doing', 'done') and new.accepted_at is null and new.assignee_id is not null and new.assignee_id = uid then
      new.accepted_at := now();
    end if;
  end if;

  if new.status <> 'blocked' then new.blocked_reason := null; end if;
  if new.status <> 'cancelled' then new.cancel_reason := null; end if;
  return new;
end $$;

create trigger t_task_guard before insert or update on ops.task
  for each row execute function ops.task_guard();

-- ---------------------------------------------------------------- history
create or replace function ops.task_history_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  who text;
  was text;
begin
  if tg_op = 'INSERT' then
    insert into ops.task_history (task_id, actor_id, kind) values (new.id, uid, 'created');
    if new.assignee_id is not null then
      select full_name into who from ops.staff where id = new.assignee_id;
      insert into ops.task_history (task_id, actor_id, kind, to_value) values (new.id, uid, 'assigned', who);
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value, note)
    values (new.id, uid, 'status', old.status, new.status, coalesce(new.blocked_reason, new.cancel_reason));
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    select full_name into was from ops.staff where id = old.assignee_id;
    select full_name into who from ops.staff where id = new.assignee_id;
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value) values (new.id, uid, 'assigned', was, who);
  end if;
  if new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time then
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value)
    values (new.id, uid,
            'due',
            nullif(concat_ws(' ', old.due_date::text, to_char(old.due_time, 'HH24:MI')), ''),
            nullif(concat_ws(' ', new.due_date::text, to_char(new.due_time, 'HH24:MI')), ''));
  end if;
  if new.priority is distinct from old.priority then
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value)
    values (new.id, uid, 'priority', old.priority::text, new.priority::text);
  end if;
  if new.department is distinct from old.department then
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value)
    values (new.id, uid, 'department', old.department::text, new.department::text);
  end if;
  if new.title is distinct from old.title or new.description is distinct from old.description
     or new.estimate_minutes is distinct from old.estimate_minutes then
    insert into ops.task_history (task_id, actor_id, kind) values (new.id, uid, 'edited');
  end if;
  return new;
end $$;

create trigger t_task_history after insert or update on ops.task
  for each row execute function ops.task_history_write();

create or replace function ops.task_comment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.body := btrim(new.body);
  if auth.uid() is not null then new.author_id := auth.uid(); end if;
  return new;
end $$;

create trigger t_task_comment_guard before insert on ops.task_comment
  for each row execute function ops.task_comment_guard();

-- ---------------------------------------------------------------- RLS
drop policy task_ins on ops.task;
drop policy task_upd on ops.task;
create policy task_ins on ops.task for insert to authenticated
  with check ((select ops.can_write())
              and ((select ops.is_internal()) or assignee_id = (select auth.uid())));
create policy task_upd on ops.task for update to authenticated
  using ((select ops.can_write())
         and (department = any ((select ops.my_departments())::ops.department[])
              or assignee_id = (select auth.uid()) or created_by = (select auth.uid())))
  with check ((select ops.can_write())
              and (department = any ((select ops.my_departments())::ops.department[])
                   or assignee_id = (select auth.uid()) or created_by = (select auth.uid())));

alter table ops.task_history enable row level security;
create policy task_history_sel on ops.task_history for select to authenticated
  using (exists (select 1 from ops.task t where t.id = task_id));

alter table ops.task_comment enable row level security;
create policy task_comment_sel on ops.task_comment for select to authenticated
  using (exists (select 1 from ops.task t where t.id = task_id));
create policy task_comment_ins on ops.task_comment for insert to authenticated
  with check ((select ops.can_write())
              and author_id = (select auth.uid())
              and exists (select 1 from ops.task t where t.id = task_id));
create policy task_comment_del on ops.task_comment for delete to authenticated
  using (author_id = (select auth.uid()) or (select ops.is_founder()));

revoke execute on all functions in schema ops from public;
-- 0019 task collaboration (slice B plus fixed tasks and saved views)
-- 1. Start date on tasks (start to deadline), set by the people doing the work or a manager.
-- 2. Watchers: creator and assignee watch automatically; anyone can watch; a manager can add colleagues; a
--    comment author and a mentioned colleague become watchers. Watching a task lets you see it.
-- 3. Notifications: written by the database when a task is assigned, changes status or dates, gets a comment or
--    a mention, is due today or is overdue. Each person reads and clears only their own.
-- 4. Fixed (recurring) tasks: a founder or the department lead defines a template (daily, weekdays, weekly,
--    monthly) for the whole department or picked people; ops.run_task_automation() creates the tasks.
--    It is idempotent, so it can be called from the app, from pg_cron or from an Edge Function.
-- 5. Saved task views (a name plus the filters of the list/board/calendar/timeline), private or shared.
-- 6. The guard and the history writer learn about system jobs: a job runs with ops.system_job set, so the
--    person whose page load triggered it is never recorded as the creator.

-- ---------------------------------------------------------------- helpers
create or replace function ops.is_system() returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is null or coalesce(current_setting('ops.system_job', true), '') = '1'
$$;

create or replace function ops.task_manager(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.task t
                 where t.id = p_task
                   and (ops.is_founder()
                        or t.created_by = auth.uid()
                        or (ops.my_role() = 'dept_lead' and ops.in_dept(t.department))))
$$;

-- ---------------------------------------------------------------- task columns
alter table ops.task
  add column start_date    date,
  add column recurrence_id uuid,
  add column period_start  date,
  add constraint task_start_before_due check (start_date is null or due_date is null or start_date <= due_date);

alter table ops.task_history drop constraint task_history_kind_check;
alter table ops.task_history add constraint task_history_kind_check
  check (kind in ('created', 'assigned', 'status', 'due', 'start', 'priority', 'department', 'edited'));

-- ---------------------------------------------------------------- watchers
create table ops.task_watcher (
  task_id    uuid not null references ops.task (id) on delete cascade,
  staff_id   uuid not null references ops.staff (id) on delete cascade,
  added_by   uuid references ops.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, staff_id)
);
create index task_watcher_staff_idx on ops.task_watcher (staff_id);
create index task_watcher_added_by_idx on ops.task_watcher (added_by);

insert into ops.task_watcher (task_id, staff_id)
select t.id, t.created_by from ops.task t join ops.staff s on s.id = t.created_by
where s.role <> 'partner'
on conflict do nothing;
insert into ops.task_watcher (task_id, staff_id)
select t.id, t.assignee_id from ops.task t join ops.staff s on s.id = t.assignee_id
where s.role <> 'partner'
on conflict do nothing;

create or replace function ops.is_watching(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.task_watcher w where w.task_id = p_task and w.staff_id = auth.uid())
$$;

-- Automatic watching (creator, assignee, commenter) skips partners: they see their own tasks anyway.
create or replace function ops.auto_watch(p_task uuid, p_staff uuid, p_by uuid) returns void
language sql security definer set search_path = '' as $$
  insert into ops.task_watcher (task_id, staff_id, added_by)
  select p_task, s.id, p_by from ops.staff s where s.id = p_staff and s.is_active and s.role <> 'partner'
  on conflict do nothing
$$;

create or replace function ops.task_watcher_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  select role, is_active into s from ops.staff where id = new.staff_id;
  if not found or not s.is_active then raise exception 'Choose an active team member to add as a watcher'; end if;
  if s.role = 'partner' then raise exception 'Partners cannot be added as watchers'; end if;
  if auth.uid() is not null then new.added_by := auth.uid(); end if;
  return new;
end $$;
create trigger t_task_watcher_guard before insert on ops.task_watcher
  for each row execute function ops.task_watcher_guard();

alter table ops.task_watcher enable row level security;
create policy task_watcher_sel on ops.task_watcher for select to authenticated
  using (exists (select 1 from ops.task t where t.id = task_id));
create policy task_watcher_ins on ops.task_watcher for insert to authenticated
  with check ((select ops.can_write())
              and exists (select 1 from ops.task t where t.id = task_id)
              and (staff_id = (select auth.uid()) or (select ops.task_manager(task_id))));
create policy task_watcher_del on ops.task_watcher for delete to authenticated
  using (staff_id = (select auth.uid()) or (select ops.task_manager(task_id)));

-- A watcher can see the task they follow, in any department.
drop policy task_sel on ops.task;
create policy task_sel on ops.task for select to authenticated
  using (department = any ((select ops.my_departments())::ops.department[])
         or assignee_id = (select auth.uid())
         or created_by = (select auth.uid())
         or (select ops.is_watching(id)));

-- ---------------------------------------------------------------- notifications
create table ops.notification (
  id           bigint generated always as identity primary key,
  recipient_id uuid not null references ops.staff (id) on delete cascade,
  kind         text not null check (kind in ('assigned', 'mentioned', 'status', 'dates', 'comment', 'due_today', 'overdue', 'recurring')),
  task_id      uuid references ops.task (id) on delete cascade,
  actor_id     uuid references ops.staff (id) on delete set null,
  message      text not null,
  dedupe_key   text,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);
create index notification_recipient_idx on ops.notification (recipient_id, created_at desc);
create index notification_task_idx on ops.notification (task_id);
create index notification_actor_idx on ops.notification (actor_id);
create unique index notification_dedupe_idx on ops.notification (recipient_id, dedupe_key) where dedupe_key is not null;

alter table ops.notification enable row level security;
create policy notification_sel on ops.notification for select to authenticated
  using (recipient_id = (select auth.uid()));
create policy notification_upd on ops.notification for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));
create policy notification_del on ops.notification for delete to authenticated
  using (recipient_id = (select auth.uid()));

create or replace function ops.notification_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.recipient_id := old.recipient_id;
    new.kind := old.kind;
    new.task_id := old.task_id;
    new.actor_id := old.actor_id;
    new.message := old.message;
    new.dedupe_key := old.dedupe_key;
    new.created_at := old.created_at;
    new.read_at := coalesce(old.read_at, new.read_at);
  end if;
  return new;
end $$;
create trigger t_notification_guard before update on ops.notification
  for each row execute function ops.notification_guard();

create or replace function ops.notify(p_recipient uuid, p_kind text, p_task uuid, p_actor uuid, p_message text, p_key text default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_recipient is null or p_recipient is not distinct from p_actor then return false; end if;
  if not exists (select 1 from ops.staff where id = p_recipient and is_active) then return false; end if;
  insert into ops.notification (recipient_id, kind, task_id, actor_id, message, dedupe_key)
  values (p_recipient, p_kind, p_task, p_actor, p_message, p_key)
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ---------------------------------------------------------------- fixed (recurring) tasks
create table ops.task_recurrence (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (length(btrim(title)) between 1 and 200),
  description      text check (description is null or length(description) <= 4000),
  department       ops.department not null,
  priority         smallint not null default 3 check (priority between 1 and 4),
  estimate_minutes integer check (estimate_minutes is null or estimate_minutes between 1 and 6000),
  frequency        text not null check (frequency in ('daily', 'weekdays', 'weekly', 'monthly')),
  weekday          smallint check (weekday between 1 and 7),
  month_day        smallint check (month_day between 1 and 28),
  due_after_days   smallint not null default 0 check (due_after_days between 0 and 60),
  due_time         time,
  starts_on        date not null default current_date,
  ends_on          date,
  all_department   boolean not null default false,
  staff_ids        uuid[] not null default '{}' check (cardinality(staff_ids) <= 100),
  active           boolean not null default true,
  created_by       uuid references ops.staff (id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint task_recurrence_weekly_day check (frequency <> 'weekly' or weekday is not null),
  constraint task_recurrence_monthly_day check (frequency <> 'monthly' or month_day is not null),
  constraint task_recurrence_dates check (ends_on is null or ends_on >= starts_on)
);
create index task_recurrence_department_idx on ops.task_recurrence (department, active);
create index task_recurrence_created_by_idx on ops.task_recurrence (created_by);
create trigger t_task_recurrence_upd before update on ops.task_recurrence
  for each row execute function ops.touch_updated_at();

alter table ops.task
  add constraint task_recurrence_fk foreign key (recurrence_id) references ops.task_recurrence (id) on delete set null;
create unique index task_recurrence_period_idx on ops.task (recurrence_id, assignee_id, period_start);

create or replace function ops.task_recurrence_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.title := btrim(new.title);
  if new.frequency <> 'weekly' then new.weekday := null; end if;
  if new.frequency <> 'monthly' then new.month_day := null; end if;
  if not new.all_department and cardinality(new.staff_ids) = 0 then
    raise exception 'Choose the whole department or at least one person';
  end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
create trigger t_task_recurrence_guard before insert or update on ops.task_recurrence
  for each row execute function ops.task_recurrence_guard();

alter table ops.task_recurrence enable row level security;
create policy task_recurrence_sel on ops.task_recurrence for select to authenticated
  using (department = any ((select ops.my_departments())::ops.department[]));
create policy task_recurrence_ins on ops.task_recurrence for insert to authenticated
  with check ((select ops.my_role()) in ('founder', 'dept_lead')
              and department = any ((select ops.my_departments())::ops.department[]));
create policy task_recurrence_upd on ops.task_recurrence for update to authenticated
  using ((select ops.my_role()) in ('founder', 'dept_lead')
         and department = any ((select ops.my_departments())::ops.department[]))
  with check ((select ops.my_role()) in ('founder', 'dept_lead')
              and department = any ((select ops.my_departments())::ops.department[]));
create policy task_recurrence_del on ops.task_recurrence for delete to authenticated
  using ((select ops.my_role()) in ('founder', 'dept_lead')
         and department = any ((select ops.my_departments())::ops.department[]));

-- ---------------------------------------------------------------- saved views
create table ops.task_view (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references ops.staff (id) on delete cascade default auth.uid(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  query      text not null default '' check (length(query) <= 500),
  shared     boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

create or replace function ops.task_view_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.owner_id := auth.uid(); end if;
  else
    new.owner_id := old.owner_id;
  end if;
  return new;
end $$;
create trigger t_task_view_guard before insert or update on ops.task_view
  for each row execute function ops.task_view_guard();

alter table ops.task_view enable row level security;
create policy task_view_sel on ops.task_view for select to authenticated
  using (owner_id = (select auth.uid()) or (shared and (select ops.is_internal())));
create policy task_view_ins on ops.task_view for insert to authenticated
  with check ((select ops.is_internal()) and owner_id = (select auth.uid()));
create policy task_view_upd on ops.task_view for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy task_view_del on ops.task_view for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------- comments: mentions
alter table ops.task_comment
  add column mentions uuid[] not null default '{}' check (cardinality(mentions) <= 10);

create or replace function ops.task_comment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.body := btrim(new.body);
  if auth.uid() is not null then new.author_id := auth.uid(); end if;
  new.mentions := coalesce((
    select (array_agg(s.id order by s.id))[1:10] from ops.staff s
    where s.id = any (new.mentions) and s.is_active and s.role <> 'partner' and s.id <> new.author_id), '{}');
  return new;
end $$;

-- ---------------------------------------------------------------- guard (0018 plus start date, stamps, system jobs)
create or replace function ops.task_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid     uuid := case when ops.is_system() then null else auth.uid() end;
  mgr     boolean;
  a       record;
  p       record;
begin
  new.title := btrim(new.title);
  if new.title = '' then raise exception 'A task needs a title'; end if;
  if new.due_date is null then new.due_time := null; end if;
  if new.start_date is not null and new.due_date is not null and new.start_date > new.due_date then
    raise exception 'The start date cannot be after the deadline';
  end if;

  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    select s.role, s.is_active into a from ops.staff s where s.id = new.assignee_id;
    if not found or not a.is_active then raise exception 'Choose an active team member to assign this task to'; end if;
    if a.role = 'viewer' then raise exception 'A viewer cannot be given tasks'; end if;
    if a.role = 'partner' and coalesce(new.template, '') <> 'follow_up' then
      raise exception 'Partners can only be given follow-up tasks';
    end if;
  end if;

  if new.parent_task_id is not null and (tg_op = 'INSERT' or new.parent_task_id is distinct from old.parent_task_id) then
    if new.parent_task_id = new.id then raise exception 'A task cannot be its own subtask'; end if;
    select t.parent_task_id, t.status into p from ops.task t where t.id = new.parent_task_id;
    if not found then raise exception 'The parent task was not found'; end if;
    if p.parent_task_id is not null then raise exception 'A subtask cannot have subtasks'; end if;
    if p.status in ('done', 'cancelled') then raise exception 'Add subtasks to an open task'; end if;
    if tg_op = 'UPDATE' and exists (select 1 from ops.task c where c.parent_task_id = new.id) then
      raise exception 'A task with subtasks cannot become a subtask';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'todo' then raise exception 'A new task starts as To do'; end if;
    if uid is not null then new.created_by := uid; end if;
    new.completed_at := null;
    new.completed_by := null;
    new.blocked_reason := null;
    new.cancel_reason := null;
    if uid is not null then
      new.recurrence_id := null;
      new.period_start := null;
    end if;
    if uid is not null or new.assignee_id is null then new.accepted_at := null; end if;
    if new.assignee_id is not null then
      new.assigned_by := coalesce(uid, new.created_by);
      new.assigned_at := now();
      if new.assignee_id = uid then new.accepted_at := now(); end if;
    else
      new.assigned_by := null;
      new.assigned_at := null;
    end if;
    return new;
  end if;

  -- stamps are never taken from the caller
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.assigned_by := old.assigned_by;
  new.assigned_at := old.assigned_at;
  new.completed_at := old.completed_at;
  new.completed_by := old.completed_by;
  new.recurrence_id := old.recurrence_id;
  new.period_start := old.period_start;

  mgr := uid is null
         or ops.is_founder()
         or old.created_by = uid
         or (ops.my_role() = 'dept_lead' and ops.in_dept(old.department));

  if not mgr and (new.title is distinct from old.title
                  or new.description is distinct from old.description
                  or new.department is distinct from old.department
                  or new.entity_type is distinct from old.entity_type
                  or new.entity_id is distinct from old.entity_id
                  or new.parent_task_id is distinct from old.parent_task_id) then
    raise exception 'Only the person who created this task, a department lead or a founder can edit its details';
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    if not mgr
       and not (new.assignee_id is null and old.assignee_id = uid)
       and not (old.assignee_id is null and new.assignee_id = uid) then
      raise exception 'Only the person who assigned this task, a department lead or a founder can reassign it';
    end if;
    new.assigned_by := uid;
    new.assigned_at := case when new.assignee_id is null then null else now() end;
    new.accepted_at := case when new.assignee_id is not null and new.assignee_id = uid then now() else null end;
  elsif new.accepted_at is distinct from old.accepted_at then
    if new.accepted_at is null then
      new.accepted_at := old.accepted_at;
    elsif uid is not null and uid is distinct from new.assignee_id then
      raise exception 'Only the assignee can accept a task';
    else
      new.accepted_at := coalesce(old.accepted_at, now());
    end if;
  end if;

  if new.status is distinct from old.status then
    if old.status in ('done', 'cancelled') and not (mgr or old.completed_by = uid) then
      raise exception 'Only a lead, a founder, or the person who created or finished this task can reopen it';
    end if;
    if old.status = 'done' and new.status not in ('todo', 'doing') then
      raise exception 'A finished task can only be reopened';
    end if;
    if old.status = 'cancelled' and new.status <> 'todo' then
      raise exception 'A cancelled task can only be reopened';
    end if;
    if new.status = 'blocked' and coalesce(btrim(new.blocked_reason), '') = '' then
      raise exception 'Say what is blocking this task';
    end if;
    if new.status = 'cancelled' and coalesce(btrim(new.cancel_reason), '') = '' then
      raise exception 'Say why the task is cancelled';
    end if;
    if new.status in ('done', 'cancelled')
       and exists (select 1 from ops.task c where c.parent_task_id = new.id and c.status in ('todo', 'doing', 'blocked')) then
      raise exception 'Finish or cancel the subtasks first';
    end if;
    if new.status = 'done' then
      new.completed_at := now();
      new.completed_by := uid;
    elsif old.status = 'done' then
      new.completed_at := null;
      new.completed_by := null;
    end if;
    if new.status in ('doing', 'done') and new.accepted_at is null and new.assignee_id is not null and new.assignee_id = uid then
      new.accepted_at := now();
    end if;
  end if;

  if new.status <> 'blocked' then new.blocked_reason := null; end if;
  if new.status <> 'cancelled' then new.cancel_reason := null; end if;
  return new;
end $$;

-- ---------------------------------------------------------------- history (0018 plus start date, system actor)
create or replace function ops.task_history_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := case when ops.is_system() then null else auth.uid() end;
  who text;
  was text;
begin
  if tg_op = 'INSERT' then
    insert into ops.task_history (task_id, actor_id, kind) values (new.id, coalesce(uid, new.created_by), 'created');
    if new.assignee_id is not null then
      select full_name into who from ops.staff where id = new.assignee_id;
      insert into ops.task_history (task_id, actor_id, kind, to_value) values (new.id, coalesce(uid, new.created_by), 'assigned', who);
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value, note)
    values (new.id, uid, 'status', old.status, new.status, coalesce(new.blocked_reason, new.cancel_reason));
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    select full_name into was from ops.staff where id = old.assignee_id;
    select full_name into who from ops.staff where id = new.assignee_id;
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value) values (new.id, uid, 'assigned', was, who);
  end if;
  if new.start_date is distinct from old.start_date then
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value)
    values (new.id, uid, 'start', old.start_date::text, new.start_date::text);
  end if;
  if new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time then
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value)
    values (new.id, uid,
            'due',
            nullif(concat_ws(' ', old.due_date::text, to_char(old.due_time, 'HH24:MI')), ''),
            nullif(concat_ws(' ', new.due_date::text, to_char(new.due_time, 'HH24:MI')), ''));
  end if;
  if new.priority is distinct from old.priority then
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value)
    values (new.id, uid, 'priority', old.priority::text, new.priority::text);
  end if;
  if new.department is distinct from old.department then
    insert into ops.task_history (task_id, actor_id, kind, from_value, to_value)
    values (new.id, uid, 'department', old.department::text, new.department::text);
  end if;
  if new.title is distinct from old.title or new.description is distinct from old.description
     or new.estimate_minutes is distinct from old.estimate_minutes then
    insert into ops.task_history (task_id, actor_id, kind) values (new.id, uid, 'edited');
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- watchers and notifications on task changes
create or replace function ops.task_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid   uuid := case when ops.is_system() then null else auth.uid() end;
  who   text := coalesce((select full_name from ops.staff where id = uid), 'Someone');
  t     text := left(new.title, 80);
  what  text;
  r     uuid;
begin
  if tg_op = 'INSERT' then
    perform ops.auto_watch(new.id, new.created_by, null);
    if new.assignee_id is not null then
      perform ops.auto_watch(new.id, new.assignee_id, uid);
      if uid is null then
        perform ops.notify(new.assignee_id, 'recurring', new.id, null, 'Your fixed task is ready: ' || t);
      else
        perform ops.notify(new.assignee_id, 'assigned', new.id, uid, who || ' gave you a task: ' || t);
      end if;
    end if;
    return new;
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    if new.assignee_id is not null then
      perform ops.auto_watch(new.id, new.assignee_id, uid);
      perform ops.notify(new.assignee_id, 'assigned', new.id, uid, who || ' gave you a task: ' || t);
    end if;
    perform ops.notify(old.assignee_id, 'assigned', new.id, uid, who || ' took you off: ' || t);
  end if;

  if new.status is distinct from old.status then
    what := case new.status
      when 'done' then 'marked it done'
      when 'doing' then case when old.status in ('done', 'cancelled') then 'reopened it' else 'started it' end
      when 'blocked' then 'marked it blocked: ' || coalesce(new.blocked_reason, '')
      when 'cancelled' then 'cancelled it: ' || coalesce(new.cancel_reason, '')
      else case when old.status in ('done', 'cancelled') then 'reopened it' else 'moved it back to to do' end
    end;
    for r in select staff_id from ops.task_watcher where task_id = new.id loop
      perform ops.notify(r, 'status', new.id, uid, who || ' ' || what || ' (' || t || ')');
    end loop;
  end if;

  if new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time
     or new.start_date is distinct from old.start_date then
    for r in select staff_id from ops.task_watcher where task_id = new.id loop
      perform ops.notify(r, 'dates', new.id, uid,
        who || ' changed the dates of ' || t || ': ' ||
        coalesce(to_char(new.start_date, 'DD Mon'), 'no start') || ' to ' || coalesce(to_char(new.due_date, 'DD Mon'), 'no deadline'));
    end loop;
  end if;
  return new;
end $$;

create or replace function ops.task_comment_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text := coalesce((select full_name from ops.staff where id = new.author_id), 'Someone');
  t   text := (select left(title, 80) from ops.task where id = new.task_id);
  r   uuid;
begin
  perform ops.auto_watch(new.task_id, new.author_id, new.author_id);
  foreach r in array new.mentions loop
    perform ops.auto_watch(new.task_id, r, new.author_id);
    perform ops.notify(r, 'mentioned', new.task_id, new.author_id, who || ' mentioned you on ' || t);
  end loop;
  for r in select staff_id from ops.task_watcher
           where task_id = new.task_id and staff_id <> new.author_id and not (staff_id = any (new.mentions)) loop
    perform ops.notify(r, 'comment', new.task_id, new.author_id, who || ' commented on ' || t);
  end loop;
  return new;
end $$;

create trigger t_task_notify after insert or update on ops.task
  for each row execute function ops.task_notify();
create trigger t_task_comment_notify after insert on ops.task_comment
  for each row execute function ops.task_comment_notify();

-- ---------------------------------------------------------------- automation (fixed tasks + reminders)
-- Safe to call any number of times. The app calls it (at most every few minutes per person); pg_cron or an
-- Edge Function can call it too. Each fixed task is created once per person and period.
create or replace function ops.run_task_recurrences() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  today  date := (now() at time zone 'Asia/Kolkata')::date;
  r      record;
  s      record;
  period date;
  made   integer := 0;
  n      integer;
begin
  perform set_config('ops.system_job', '1', true);
  for r in select * from ops.task_recurrence
           where active and starts_on <= today and (ends_on is null or ends_on >= today) loop
    period := case r.frequency
      when 'daily' then today
      when 'weekdays' then today - greatest(extract(isodow from today)::int - 5, 0)
      when 'weekly' then today - ((extract(isodow from today)::int - r.weekday + 7) % 7)
      else case when extract(day from today)::int >= r.month_day
                then date_trunc('month', today::timestamp)::date + (r.month_day - 1)
                else (date_trunc('month', today::timestamp) - interval '1 month')::date + (r.month_day - 1) end
    end;
    continue when period < r.starts_on;
    for s in select st.id from ops.staff st
             where st.is_active and st.role not in ('partner', 'viewer')
               and ((r.all_department and r.department = any (st.departments)) or st.id = any (r.staff_ids)) loop
      insert into ops.task (department, template, title, description, priority, estimate_minutes, assignee_id,
                            start_date, due_date, due_time, created_by, accepted_at, recurrence_id, period_start)
      values (r.department, 'fixed', r.title, r.description, r.priority, r.estimate_minutes, s.id,
              period, period + r.due_after_days, r.due_time, r.created_by, now(), r.id, period)
      on conflict (recurrence_id, assignee_id, period_start) do nothing;
      get diagnostics n = row_count;
      made := made + n;
    end loop;
  end loop;
  perform set_config('ops.system_job', '', true);
  return made;
end $$;

create or replace function ops.run_task_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  r     record;
  w     uuid;
  sent  integer := 0;
begin
  for r in select id, left(title, 80) as t, assignee_id, due_date from ops.task
           where status in ('todo', 'doing', 'blocked') and assignee_id is not null
             and due_date <= today and due_date >= today - 60 loop
    if r.due_date = today then
      if ops.notify(r.assignee_id, 'due_today', r.id, null, 'Due today: ' || r.t, 'due:' || r.id || ':' || r.due_date) then
        sent := sent + 1;
      end if;
    else
      if ops.notify(r.assignee_id, 'overdue', r.id, null,
                    'Overdue since ' || to_char(r.due_date, 'DD Mon') || ': ' || r.t, 'overdue:' || r.id || ':' || r.due_date) then
        sent := sent + 1;
      end if;
      for w in select staff_id from ops.task_watcher where task_id = r.id and staff_id <> r.assignee_id loop
        if ops.notify(w, 'overdue', r.id, null,
                      'Overdue since ' || to_char(r.due_date, 'DD Mon') || ': ' || r.t, 'overdue:' || r.id || ':' || r.due_date) then
          sent := sent + 1;
        end if;
      end loop;
    end if;
  end loop;
  return sent;
end $$;

create or replace function ops.run_task_automation() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare made integer; sent integer;
begin
  made := ops.run_task_recurrences();
  sent := ops.run_task_reminders();
  return jsonb_build_object('created', made, 'reminders', sent);
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.task_manager(uuid), ops.is_watching(uuid) to authenticated, service_role;
grant execute on function ops.run_task_automation() to authenticated, service_role;
-- 0020 time tracking and the daily log (slices C and D)
-- 1. time_entry: time spent on a task, from a timer (start / stop) or typed in by hand. One running timer per
--    person: starting a new one stops the old one. A timer that is forgotten is capped at 12 hours.
--    People edit their own entries for 14 days; a task's managers and department leads see the time on it.
-- 2. Finishing or cancelling a task stops any timer running on it.
-- 3. daily_log: one short end-of-day note per person per day (what I did, what is next, what is blocking me),
--    read by the person and by the lead of their department.

-- ---------------------------------------------------------------- helpers
create or replace function ops.today_ist() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- Can the caller read this person's working notes? Themselves, the founder, or a lead sharing a department.
create or replace function ops.leads_staff(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_staff = auth.uid()
      or ops.is_founder()
      or (ops.my_role() = 'dept_lead'
          and exists (select 1 from ops.staff s
                      where s.id = p_staff and s.departments && ops.my_departments()))
$$;

-- Time can be tracked by internal people who can write; partners and viewers cannot.
create or replace function ops.can_track_time() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role not in ('viewer', 'partner') from ops.staff
                   where id = auth.uid() and is_active), false)
$$;

-- ---------------------------------------------------------------- time_entry
create table ops.time_entry (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null default auth.uid() references ops.staff (id) on delete cascade,
  task_id    uuid not null references ops.task (id) on delete cascade,
  source     text not null check (source in ('timer', 'manual')),
  work_date  date not null,
  started_at timestamptz,
  ended_at   timestamptz,
  minutes    integer check (minutes between 1 and 960),
  note       text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_entry_shape check (
    (source = 'timer' and started_at is not null
       and ((ended_at is null and minutes is null) or (ended_at is not null and minutes is not null and ended_at > started_at)))
    or (source = 'manual' and started_at is null and ended_at is null and minutes is not null)
  )
);
create index time_entry_task_idx on ops.time_entry (task_id);
create index time_entry_staff_date_idx on ops.time_entry (staff_id, work_date);
create unique index time_entry_one_running_idx on ops.time_entry (staff_id) where source = 'timer' and ended_at is null;

create trigger t_time_entry_upd before update on ops.time_entry
  for each row execute function ops.touch_updated_at();

-- Close a running timer: ended_at is now, but never more than 12 hours after it started.
create or replace function ops.close_timer(p_id uuid, p_note_suffix text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; stop timestamptz;
begin
  select id, started_at, note into r from ops.time_entry where id = p_id and source = 'timer' and ended_at is null;
  if not found then return; end if;
  stop := least(now(), r.started_at + interval '12 hours');
  perform set_config('ops.system_job', '1', true);
  update ops.time_entry
     set ended_at = stop,
         minutes  = least(960, greatest(1, ceil(extract(epoch from (stop - r.started_at)) / 60)::integer)),
         note     = case when p_note_suffix is null then note
                         else left(coalesce(note || ' ', '') || p_note_suffix, 500) end
   where id = p_id;
  perform set_config('ops.system_job', '', true);
end $$;

create or replace function ops.time_entry_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  today date := ops.today_ist();
  total integer;
  r record;
begin
  if tg_op = 'INSERT' then
    if not ops.is_system() then
      new.staff_id := auth.uid();
      if not ops.can_track_time() then raise exception 'Only team members can track time'; end if;
    end if;
    if new.source = 'timer' then
      new.started_at := now();
      new.ended_at := null;
      new.minutes := null;
      new.work_date := ops.today_ist();
      for r in select id from ops.time_entry where staff_id = new.staff_id and source = 'timer' and ended_at is null loop
        perform ops.close_timer(r.id);
      end loop;
    else
      new.started_at := null;
      new.ended_at := null;
      if new.minutes is null then raise exception 'Enter how long you worked'; end if;
      if new.work_date is null then raise exception 'Pick the day you worked'; end if;
      if new.work_date > today then raise exception 'You can''t log time for a future day'; end if;
      if new.work_date < today - 30 and not ops.is_founder() then
        raise exception 'Time can only be logged for the last 30 days';
      end if;
    end if;
  else
    if new.staff_id is distinct from old.staff_id or new.task_id is distinct from old.task_id
       or new.source is distinct from old.source or new.started_at is distinct from old.started_at then
      raise exception 'Only the length, the day and the note of an entry can change';
    end if;
    if not ops.is_system() then
      if old.source = 'timer' and old.ended_at is null then
        -- stopping my timer: the database decides the end and the length
        if new.ended_at is not null then
          new.ended_at := least(now(), old.started_at + interval '12 hours');
          new.minutes := least(960, greatest(1, ceil(extract(epoch from (new.ended_at - old.started_at)) / 60)::integer));
        else
          new.minutes := null;
        end if;
        new.work_date := old.work_date;
      elsif old.source = 'timer' then
        new.ended_at := old.ended_at;
        new.minutes := old.minutes;
        new.work_date := old.work_date;
      else
        new.ended_at := null;
        if new.work_date > today then raise exception 'You can''t log time for a future day'; end if;
        if new.work_date < today - 30 and not ops.is_founder() then
          raise exception 'Time can only be logged for the last 30 days';
        end if;
      end if;
    end if;
  end if;

  if new.ended_at is not null or new.source = 'manual' then
    select coalesce(sum(minutes), 0) into total from ops.time_entry
     where staff_id = new.staff_id and work_date = new.work_date and id is distinct from new.id and minutes is not null;
    if total + coalesce(new.minutes, 0) > 1440 then
      raise exception 'That would be more than 24 hours on one day';
    end if;
  end if;
  return new;
end $$;
create trigger t_time_entry_guard before insert or update on ops.time_entry
  for each row execute function ops.time_entry_guard();

alter table ops.time_entry enable row level security;
create policy time_entry_sel on ops.time_entry for select to authenticated
  using (staff_id = (select auth.uid()) or (select ops.task_manager(task_id)) or (select ops.is_founder()));
create policy time_entry_ins on ops.time_entry for insert to authenticated
  with check ((select ops.can_track_time())
              and staff_id = (select auth.uid())
              and exists (select 1 from ops.task t where t.id = task_id));
create policy time_entry_upd on ops.time_entry for update to authenticated
  using (staff_id = (select auth.uid())
         and (work_date >= (select ops.today_ist()) - 14 or (source = 'timer' and ended_at is null))
         and (select ops.can_track_time()))
  with check (staff_id = (select auth.uid()));
create policy time_entry_del on ops.time_entry for delete to authenticated
  using ((staff_id = (select auth.uid()) and work_date >= (select ops.today_ist()) - 14 and (select ops.can_track_time()))
         or (select ops.is_founder()));

-- A finished or cancelled task has no timer running on it.
create or replace function ops.stop_timers_on_finish() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from ops.time_entry where task_id = new.id and source = 'timer' and ended_at is null loop
    perform ops.close_timer(r.id);
  end loop;
  return null;
end $$;
create trigger t_task_stop_timers after update of status on ops.task
  for each row when (new.status in ('done', 'cancelled') and old.status is distinct from new.status)
  execute function ops.stop_timers_on_finish();

-- ---------------------------------------------------------------- daily log
create table ops.daily_log (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null default auth.uid() references ops.staff (id) on delete cascade,
  log_date   date not null,
  did        text not null check (char_length(btrim(did)) between 1 and 4000),
  next_up    text check (next_up is null or char_length(next_up) <= 2000),
  blockers   text check (blockers is null or char_length(blockers) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, log_date)
);
create index daily_log_date_idx on ops.daily_log (log_date);

create trigger t_daily_log_upd before update on ops.daily_log
  for each row execute function ops.touch_updated_at();

create or replace function ops.daily_log_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare today date := ops.today_ist();
begin
  if tg_op = 'INSERT' then
    if not ops.is_system() then
      new.staff_id := auth.uid();
      if not ops.can_track_time() then raise exception 'Only team members can write a daily log'; end if;
    end if;
    if new.log_date > today then raise exception 'You can''t write the log for a future day'; end if;
    if new.log_date < today - 7 then raise exception 'The daily log can only be written for the last 7 days'; end if;
  else
    if new.staff_id is distinct from old.staff_id or new.log_date is distinct from old.log_date then
      raise exception 'The person and the day of a log can''t change';
    end if;
  end if;
  new.did := btrim(new.did);
  new.next_up := nullif(btrim(coalesce(new.next_up, '')), '');
  new.blockers := nullif(btrim(coalesce(new.blockers, '')), '');
  return new;
end $$;
create trigger t_daily_log_guard before insert or update on ops.daily_log
  for each row execute function ops.daily_log_guard();

alter table ops.daily_log enable row level security;
create policy daily_log_sel on ops.daily_log for select to authenticated
  using ((select ops.leads_staff(staff_id)));
create policy daily_log_ins on ops.daily_log for insert to authenticated
  with check ((select ops.can_track_time()) and staff_id = (select auth.uid()));
create policy daily_log_upd on ops.daily_log for update to authenticated
  using (staff_id = (select auth.uid()) and log_date >= (select ops.today_ist()) - 7 and (select ops.can_track_time()))
  with check (staff_id = (select auth.uid()));
create policy daily_log_del on ops.daily_log for delete to authenticated
  using (staff_id = (select auth.uid()) and log_date >= (select ops.today_ist()) - 7 and (select ops.can_track_time()));

-- ---------------------------------------------------------------- automation: stale timers
create or replace function ops.close_stale_timers() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select id from ops.time_entry
           where source = 'timer' and ended_at is null and started_at < now() - interval '12 hours' loop
    perform ops.close_timer(r.id, '(stopped automatically after 12 hours)');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function ops.run_task_automation() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare made integer; sent integer; stopped integer;
begin
  made := ops.run_task_recurrences();
  sent := ops.run_task_reminders();
  stopped := ops.close_stale_timers();
  return jsonb_build_object('created', made, 'reminders', sent, 'timers_stopped', stopped);
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.task_manager(uuid), ops.is_watching(uuid) to authenticated, service_role;
grant execute on function ops.leads_staff(uuid), ops.can_track_time(), ops.today_ist() to authenticated, service_role;
grant execute on function ops.run_task_automation() to authenticated, service_role;
-- 0021: 0018 added task_created_by_idx, but the foreign-key index task_created_by_fkey_ix already covers ops.task (created_by).
-- The Performance Advisor flags the pair as a duplicate.
drop index if exists ops.task_created_by_idx;
-- 0022: Calendar and meetings.
--
-- 1. ops.meeting: one meeting (internal team, one to one, review, or an institution call). Either scheduled
--    straight away (people then accept or decline) or REQUESTED from one person, who accepts, declines or
--    suggests another time. Cancelled and declined meetings are frozen and keep their reason.
-- 2. ops.meeting_attendee: who is invited and what they answered (invited, accepted, tentative, declined).
-- 3. ops.meeting_series: a fixed meeting (weekly, every two weeks, monthly) for a whole department or chosen
--    people. ops.generate_series_meetings() keeps the next five weeks of dated meetings in place, so one
--    occurrence can be moved or cancelled without touching the rest.
-- 4. Visibility: invitees only (default), the department, or everyone. Only the founder opens a meeting to
--    everyone; only the founder or a lead of that department opens one to a whole team.
-- 5. ops.calendar_busy() tells the app who is already booked (meetings and Workshop events). Double booking
--    is a warning in the UI, not a database refusal (trainer double booking on events stays a hard rule).
-- 6. Notifications learn meeting kinds and a meeting_id link; reminders go out on the morning of a meeting.

-- ---------------------------------------------------------------- helpers
create or replace function ops.leads_department(p_dept ops.department) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_dept is not null
         and coalesce(ops.my_role() in ('founder', 'dept_lead'), false)
         and p_dept = any (ops.my_departments())
$$;

-- ---------------------------------------------------------------- series
create table ops.meeting_series (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (length(btrim(title)) between 1 and 200),
  description      text check (description is null or length(description) <= 4000),
  kind             text not null default 'team' check (kind in ('team', 'one_to_one', 'review', 'institution', 'other')),
  department       ops.department,
  visibility       text not null default 'invitees' check (visibility in ('invitees', 'department', 'company')),
  frequency        text not null check (frequency in ('weekly', 'biweekly', 'monthly')),
  weekday          smallint check (weekday between 1 and 7),
  month_day        smallint check (month_day between 1 and 28),
  start_time       time not null,
  duration_minutes integer not null default 30 check (duration_minutes between 5 and 480),
  location         text check (location is null or length(location) <= 300),
  starts_on        date not null default (now() at time zone 'Asia/Kolkata')::date,
  ends_on          date,
  all_department   boolean not null default false,
  staff_ids        uuid[] not null default '{}' check (cardinality(staff_ids) <= 100),
  active           boolean not null default true,
  organizer_id     uuid not null references ops.staff (id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint meeting_series_weekly_day check (frequency = 'monthly' or weekday is not null),
  constraint meeting_series_monthly_day check (frequency <> 'monthly' or month_day is not null),
  constraint meeting_series_dates check (ends_on is null or ends_on >= starts_on),
  constraint meeting_series_whole_dept check (not all_department or department is not null)
);
create index meeting_series_organizer_idx on ops.meeting_series (organizer_id);
create index meeting_series_department_idx on ops.meeting_series (department, active);
create trigger t_meeting_series_upd before update on ops.meeting_series
  for each row execute function ops.touch_updated_at();

-- ---------------------------------------------------------------- meetings
create table ops.meeting (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (length(btrim(title)) between 1 and 200),
  description     text check (description is null or length(description) <= 4000),
  kind            text not null default 'team' check (kind in ('team', 'one_to_one', 'review', 'institution', 'other')),
  department      ops.department,
  visibility      text not null default 'invitees' check (visibility in ('invitees', 'department', 'company')),
  organizer_id    uuid not null references ops.staff (id) default auth.uid(),
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  location        text check (location is null or length(location) <= 300),
  status          text not null default 'scheduled' check (status in ('requested', 'scheduled', 'cancelled', 'declined')),
  host_id         uuid references ops.staff (id),
  awaiting_id     uuid references ops.staff (id),
  cancel_reason   text check (cancel_reason is null or length(cancel_reason) <= 500),
  institution_id  uuid references ops.institution (id) on delete set null,
  deal_id         uuid references ops.deal (id) on delete set null,
  event_id        uuid references ops.event (id) on delete set null,
  series_id       uuid references ops.meeting_series (id) on delete set null,
  occurrence_date date,
  customised      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint meeting_times check (ends_at > starts_at and ends_at <= starts_at + interval '24 hours'),
  constraint meeting_request_shape check ((status = 'requested') = (awaiting_id is not null))
);
create index meeting_starts_idx on ops.meeting (starts_at);
create index meeting_organizer_idx on ops.meeting (organizer_id);
create index meeting_host_idx on ops.meeting (host_id);
create index meeting_awaiting_idx on ops.meeting (awaiting_id);
create index meeting_department_idx on ops.meeting (department, starts_at);
create index meeting_institution_idx on ops.meeting (institution_id);
create index meeting_deal_idx on ops.meeting (deal_id);
create index meeting_event_idx on ops.meeting (event_id);
create unique index meeting_series_occurrence_idx on ops.meeting (series_id, occurrence_date) where series_id is not null;
create trigger t_meeting_upd before update on ops.meeting
  for each row execute function ops.touch_updated_at();

create table ops.meeting_attendee (
  meeting_id   uuid not null references ops.meeting (id) on delete cascade,
  staff_id     uuid not null references ops.staff (id) on delete cascade,
  rsvp         text not null default 'invited' check (rsvp in ('invited', 'accepted', 'tentative', 'declined')),
  note         text check (note is null or length(note) <= 300),
  responded_at timestamptz,
  primary key (meeting_id, staff_id)
);
create index meeting_attendee_staff_idx on ops.meeting_attendee (staff_id, meeting_id);

-- ---------------------------------------------------------------- visibility helpers
create or replace function ops.is_meeting_attendee(p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.meeting_attendee where meeting_id = p_meeting and staff_id = auth.uid())
$$;

create or replace function ops.can_see_meeting(p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from ops.meeting m
    where m.id = p_meeting
      and (ops.is_founder()
           or m.organizer_id = auth.uid()
           or m.host_id = auth.uid()
           or m.awaiting_id = auth.uid()
           or ops.is_meeting_attendee(m.id)
           or (ops.is_internal()
               and (m.visibility = 'company'
                    or (m.visibility = 'department' and m.department = any (ops.my_departments()))))))
$$;

create or replace function ops.meeting_manager(p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.meeting m
                 where m.id = p_meeting
                   and (m.organizer_id = auth.uid() or ops.is_founder() or ops.leads_department(m.department)))
$$;

-- ---------------------------------------------------------------- notifications
alter table ops.notification add column meeting_id uuid references ops.meeting (id) on delete cascade;
create index notification_meeting_idx on ops.notification (meeting_id);
alter table ops.notification drop constraint notification_kind_check;
alter table ops.notification add constraint notification_kind_check check (kind in (
  'assigned', 'mentioned', 'status', 'dates', 'comment', 'due_today', 'overdue', 'recurring',
  'meeting_invite', 'meeting_request', 'meeting_response', 'meeting_update', 'meeting_cancel', 'meeting_reminder'));

create or replace function ops.notification_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.recipient_id := old.recipient_id;
    new.kind := old.kind;
    new.task_id := old.task_id;
    new.meeting_id := old.meeting_id;
    new.actor_id := old.actor_id;
    new.message := old.message;
    new.dedupe_key := old.dedupe_key;
    new.created_at := old.created_at;
    new.read_at := coalesce(old.read_at, new.read_at);
  end if;
  return new;
end $$;

create or replace function ops.notify_meeting(p_recipient uuid, p_kind text, p_meeting uuid, p_actor uuid, p_message text, p_key text default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_recipient is null or p_recipient is not distinct from p_actor then return false; end if;
  if not exists (select 1 from ops.staff where id = p_recipient and is_active) then return false; end if;
  insert into ops.notification (recipient_id, kind, meeting_id, actor_id, message, dedupe_key)
  values (p_recipient, p_kind, p_meeting, p_actor, p_message, p_key)
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function ops.meeting_when(p_at timestamptz) returns text
language sql stable set search_path = '' as $$
  select to_char(p_at at time zone 'Asia/Kolkata', 'DD Mon, FMHH12:MI am')
$$;

-- ---------------------------------------------------------------- meeting guard
create or replace function ops.meeting_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  sys boolean := ops.is_system();
  rpc boolean := coalesce(current_setting('ops.meeting_rpc', true), '') = '1';
  uid uuid := auth.uid();
  times_changed boolean;
begin
  new.title := btrim(new.title);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.location := nullif(btrim(coalesce(new.location, '')), '');
  new.cancel_reason := nullif(btrim(coalesce(new.cancel_reason, '')), '');

  if tg_op = 'INSERT' then
    if not sys then
      new.organizer_id := uid;
      new.series_id := null;
      new.occurrence_date := null;
      new.customised := false;
    end if;
    if new.status not in ('scheduled', 'requested') then
      raise exception 'A new meeting is either scheduled or requested';
    end if;
    if new.status = 'requested' then
      if new.host_id is null or new.host_id = new.organizer_id then
        raise exception 'Choose who you are asking for the meeting';
      end if;
      if not exists (select 1 from ops.staff where id = new.host_id and is_active and role <> 'partner') then
        raise exception 'The person you are asking must be an active team member';
      end if;
      new.awaiting_id := new.host_id;
    else
      new.awaiting_id := null;
      new.host_id := null;
    end if;
    if not sys and new.starts_at < now() - interval '5 minutes' then
      raise exception 'Pick a start time in the future';
    end if;
  else
    if old.status in ('cancelled', 'declined') then
      -- only the links to institution, deal, event and series may change (they are nulled when the row they point to goes)
      if (new.title, new.description, new.kind, new.department, new.visibility, new.organizer_id, new.starts_at, new.ends_at,
          new.location, new.status, new.cancel_reason, new.host_id, new.awaiting_id)
         is distinct from
         (old.title, old.description, old.kind, old.department, old.visibility, old.organizer_id, old.starts_at, old.ends_at,
          old.location, old.status, old.cancel_reason, old.host_id, old.awaiting_id) then
        raise exception 'A % meeting can not be changed', old.status;
      end if;
      return new;
    end if;
    if new.organizer_id is distinct from old.organizer_id then raise exception 'The organizer of a meeting can not change'; end if;
    if not rpc and not sys then
      new.host_id := old.host_id;
      new.awaiting_id := old.awaiting_id;
      if not (new.series_id is null and old.series_id is not null
              and not exists (select 1 from ops.meeting_series where id = old.series_id)) then
        new.series_id := old.series_id;
      end if;
      new.occurrence_date := old.occurrence_date;
      new.customised := old.customised;
    end if;
    if new.status is distinct from old.status then
      if old.status = 'requested' and new.status in ('scheduled', 'declined') then
        if not rpc and not sys then raise exception 'Only the person asked can accept or decline a request'; end if;
      elsif new.status = 'cancelled' then
        if new.cancel_reason is null then raise exception 'Say why the meeting is cancelled'; end if;
        new.awaiting_id := null;
      else
        raise exception 'A % meeting can not become %', old.status, new.status;
      end if;
    end if;
  end if;

  if new.visibility = 'department' and new.department is null then
    raise exception 'Choose the department this meeting is for';
  end if;
  if not sys and (tg_op = 'INSERT' or new.visibility is distinct from old.visibility or new.department is distinct from old.department) then
    if new.visibility = 'department' and not ops.leads_department(new.department) then
      raise exception 'Only the founder or a lead of that department can open a meeting to the whole team';
    elsif new.visibility = 'company' and not ops.is_founder() then
      raise exception 'Only the founder can make a meeting visible to everyone';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    times_changed := new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at;
    if times_changed and not sys and not rpc then
      if new.starts_at < now() - interval '5 minutes' then raise exception 'Pick a start time in the future'; end if;
      if new.series_id is not null then new.customised := true; end if;
      if new.status = 'requested' then
        new.awaiting_id := case when uid = new.host_id then new.organizer_id else new.host_id end;
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger t_meeting_guard before insert or update on ops.meeting
  for each row execute function ops.meeting_guard();

create or replace function ops.meeting_after_ins() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  insert into ops.meeting_attendee (meeting_id, staff_id, rsvp, responded_at)
  values (new.id, new.organizer_id, 'accepted', now())
  on conflict do nothing;
  if new.host_id is not null then
    insert into ops.meeting_attendee (meeting_id, staff_id) values (new.id, new.host_id) on conflict do nothing;
  end if;
  if new.status = 'requested' and not ops.is_system() then
    select full_name into who from ops.staff where id = new.organizer_id;
    perform ops.notify_meeting(new.awaiting_id, 'meeting_request', new.id, new.organizer_id,
      who || ' would like to meet: ' || left(new.title, 80) || ' · ' || ops.meeting_when(new.starts_at), 'request:' || new.id);
  end if;
  return null;
end $$;
create trigger t_meeting_after_ins after insert on ops.meeting
  for each row execute function ops.meeting_after_ins();

create or replace function ops.meeting_after_upd() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rpc boolean := coalesce(current_setting('ops.meeting_rpc', true), '') = '1';
  sys boolean := coalesce(current_setting('ops.system_job', true), '') = '1';
  uid uuid := auth.uid();
  who text;
  a record;
begin
  if sys then return null; end if;
  select full_name into who from ops.staff where id = coalesce(uid, new.organizer_id);

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    for a in select staff_id from ops.meeting_attendee
             where meeting_id = new.id and rsvp <> 'declined'
               and (old.status = 'scheduled' or staff_id = old.awaiting_id) loop
      perform ops.notify_meeting(a.staff_id, 'meeting_cancel', new.id, uid,
        who || ' cancelled: ' || left(new.title, 80) || ' (' || new.cancel_reason || ')');
    end loop;
  elsif new.status = 'scheduled' and old.status = 'scheduled'
        and (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at) then
    update ops.meeting_attendee set rsvp = 'invited', responded_at = null
     where meeting_id = new.id and staff_id <> new.organizer_id and rsvp <> 'invited';
    for a in select staff_id from ops.meeting_attendee where meeting_id = new.id loop
      perform ops.notify_meeting(a.staff_id, 'meeting_update', new.id, uid,
        who || ' moved: ' || left(new.title, 80) || ' to ' || ops.meeting_when(new.starts_at) || '. Please answer again.');
    end loop;
  elsif new.status = 'requested' and old.status = 'requested' and not rpc
        and (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at) then
    perform ops.notify_meeting(new.awaiting_id, 'meeting_request', new.id, uid,
      who || ' changed the time: ' || left(new.title, 80) || ' · ' || ops.meeting_when(new.starts_at));
  end if;
  return null;
end $$;
create trigger t_meeting_after_upd after update on ops.meeting
  for each row execute function ops.meeting_after_upd();

-- ---------------------------------------------------------------- attendee guard
create or replace function ops.meeting_attendee_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  sys boolean := ops.is_system();
  rpc boolean := coalesce(current_setting('ops.meeting_rpc', true), '') = '1';
  m record;
begin
  select status, organizer_id, ends_at into m from ops.meeting where id = new.meeting_id;
  if tg_op = 'INSERT' then
    if not exists (select 1 from ops.staff where id = new.staff_id and is_active and role <> 'partner') then
      raise exception 'Only active team members can be invited';
    end if;
    if not sys and m.status in ('cancelled', 'declined') then
      raise exception 'Nobody can be invited to a % meeting', m.status;
    end if;
    if new.staff_id <> m.organizer_id then
      new.rsvp := 'invited';
      new.responded_at := null;
    end if;
    return new;
  end if;

  new.meeting_id := old.meeting_id;
  new.staff_id := old.staff_id;
  if new.rsvp is distinct from old.rsvp and not sys and not rpc then
    if m.status = 'requested' then raise exception 'Wait until the request is accepted before answering'; end if;
    if m.status <> 'scheduled' then raise exception 'That meeting was %', m.status; end if;
    if m.ends_at < now() then raise exception 'That meeting is over'; end if;
    if new.rsvp = 'declined' and new.staff_id = m.organizer_id then
      raise exception 'The organizer can not decline; cancel the meeting instead';
    end if;
    new.responded_at := case when new.rsvp = 'invited' then null else now() end;
  end if;
  return new;
end $$;
create trigger t_meeting_attendee_guard before insert or update on ops.meeting_attendee
  for each row execute function ops.meeting_attendee_guard();

create or replace function ops.meeting_attendee_no_organizer_removal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not ops.is_system() and exists (select 1 from ops.meeting where id = old.meeting_id and organizer_id = old.staff_id) then
    raise exception 'The organizer can not be removed from their own meeting';
  end if;
  return old;
end $$;
create trigger t_meeting_attendee_no_organizer_removal before delete on ops.meeting_attendee
  for each row execute function ops.meeting_attendee_no_organizer_removal();

create or replace function ops.meeting_attendee_after_ins() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m record; who text;
begin
  if ops.is_system() or coalesce(current_setting('ops.meeting_rpc', true), '') = '1' then return null; end if;
  select title, status, organizer_id, starts_at into m from ops.meeting where id = new.meeting_id;
  if m.status = 'scheduled' and new.staff_id <> m.organizer_id then
    select full_name into who from ops.staff where id = m.organizer_id;
    perform ops.notify_meeting(new.staff_id, 'meeting_invite', new.meeting_id, m.organizer_id,
      who || ' invited you: ' || left(m.title, 80) || ' · ' || ops.meeting_when(m.starts_at), 'invite:' || new.meeting_id || ':' || new.staff_id);
  end if;
  return null;
end $$;
create trigger t_meeting_attendee_after_ins after insert on ops.meeting_attendee
  for each row execute function ops.meeting_attendee_after_ins();

create or replace function ops.meeting_attendee_after_upd() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m record; who text;
begin
  if ops.is_system() or coalesce(current_setting('ops.meeting_rpc', true), '') = '1' then return null; end if;
  if new.rsvp is not distinct from old.rsvp or new.rsvp = 'invited' then return null; end if;
  select title, organizer_id into m from ops.meeting where id = new.meeting_id;
  select full_name into who from ops.staff where id = new.staff_id;
  perform ops.notify_meeting(m.organizer_id, 'meeting_response', new.meeting_id, new.staff_id,
    who || case new.rsvp when 'accepted' then ' accepted: ' when 'declined' then ' declined: ' else ' might attend: ' end || left(m.title, 80));
  return null;
end $$;
create trigger t_meeting_attendee_after_upd after update on ops.meeting_attendee
  for each row execute function ops.meeting_attendee_after_upd();

-- ---------------------------------------------------------------- request answers
create or replace function ops.answer_meeting_request(
  p_meeting uuid, p_action text, p_start timestamptz default null, p_end timestamptz default null, p_note text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m     ops.meeting;
  me    uuid := auth.uid();
  who   text;
  other uuid;
  a     record;
begin
  select * into m from ops.meeting where id = p_meeting for update;
  if not found or m.status <> 'requested' then raise exception 'That request is no longer open'; end if;
  if m.awaiting_id is distinct from me then raise exception 'Only the person asked to respond can answer this request'; end if;
  if p_action not in ('accept', 'decline', 'propose') then raise exception 'Choose accept, decline or propose'; end if;
  select full_name into who from ops.staff where id = me;
  other := case when me = m.organizer_id then m.host_id else m.organizer_id end;

  perform set_config('ops.meeting_rpc', '1', true);
  if p_action = 'accept' then
    update ops.meeting set status = 'scheduled', awaiting_id = null where id = p_meeting;
    update ops.meeting_attendee set rsvp = 'accepted', responded_at = now()
     where meeting_id = p_meeting and staff_id in (m.organizer_id, m.host_id);
    perform ops.notify_meeting(other, 'meeting_response', p_meeting, me, who || ' accepted: ' || left(m.title, 80) || ' · ' || ops.meeting_when(m.starts_at));
    for a in select staff_id from ops.meeting_attendee
             where meeting_id = p_meeting and staff_id not in (m.organizer_id, m.host_id) loop
      perform ops.notify_meeting(a.staff_id, 'meeting_invite', p_meeting, m.organizer_id,
        (select full_name from ops.staff where id = m.organizer_id) || ' invited you: ' || left(m.title, 80) || ' · ' || ops.meeting_when(m.starts_at),
        'invite:' || p_meeting || ':' || a.staff_id);
    end loop;
  elsif p_action = 'decline' then
    if p_note is null or btrim(p_note) = '' then raise exception 'Say why you are declining'; end if;
    update ops.meeting set status = 'declined', awaiting_id = null, cancel_reason = btrim(p_note) where id = p_meeting;
    perform ops.notify_meeting(other, 'meeting_response', p_meeting, me, who || ' declined: ' || left(m.title, 80) || ' (' || btrim(p_note) || ')');
  else
    if p_start is null or p_end is null or p_end <= p_start then raise exception 'Pick a start and an end for the new time'; end if;
    if p_start < now() - interval '5 minutes' then raise exception 'Pick a start time in the future'; end if;
    update ops.meeting set starts_at = p_start, ends_at = p_end, awaiting_id = other where id = p_meeting;
    perform ops.notify_meeting(other, 'meeting_request', p_meeting, me, who || ' suggested another time: ' || left(m.title, 80) || ' · ' || ops.meeting_when(p_start));
  end if;
  perform set_config('ops.meeting_rpc', '', true);
end $$;

-- ---------------------------------------------------------------- who is busy
create or replace function ops.calendar_busy(p_staff uuid[], p_from timestamptz, p_to timestamptz, p_exclude uuid default null)
returns table (staff_id uuid, kind text, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.staff_id, 'meeting'::text, m.starts_at, m.ends_at
    from ops.meeting_attendee a join ops.meeting m on m.id = a.meeting_id
   where ops.is_internal() and a.staff_id = any (p_staff) and a.rsvp <> 'declined'
     and m.status = 'scheduled' and m.starts_at < p_to and m.ends_at > p_from and m.id is distinct from p_exclude
  union all
  select e.lead_trainer_id, 'workshop'::text, e.starts_at, e.ends_at
    from ops.event e
   where ops.is_internal() and e.lead_trainer_id = any (p_staff) and e.status in ('scheduled', 'in_progress')
     and e.archived_at is null and e.starts_at < p_to and e.ends_at > p_from
  union all
  select es.staff_id, 'workshop'::text, e.starts_at, e.ends_at
    from ops.event_staff es join ops.event e on e.id = es.event_id
   where ops.is_internal() and es.staff_id = any (p_staff) and e.status in ('scheduled', 'in_progress')
     and e.archived_at is null and e.starts_at < p_to and e.ends_at > p_from
$$;

-- ---------------------------------------------------------------- series guard and generation
create or replace function ops.meeting_series_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sys boolean := ops.is_system();
begin
  new.title := btrim(new.title);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.location := nullif(btrim(coalesce(new.location, '')), '');
  if new.frequency = 'monthly' then new.weekday := null; else new.month_day := null; end if;
  if tg_op = 'INSERT' then
    if not sys then new.organizer_id := auth.uid(); end if;
  elsif new.organizer_id is distinct from old.organizer_id then
    raise exception 'The organizer of a fixed meeting can not change';
  end if;
  if not new.all_department and cardinality(new.staff_ids) = 0 then
    raise exception 'Choose the whole department or at least one person';
  end if;
  if new.visibility = 'department' and new.department is null then
    raise exception 'Choose the department this meeting is for';
  end if;
  if not sys then
    if (new.all_department or new.visibility = 'department')
       and (tg_op = 'INSERT' or new.all_department is distinct from old.all_department
            or new.visibility is distinct from old.visibility or new.department is distinct from old.department)
       and not ops.leads_department(new.department) then
      raise exception 'Only the founder or a lead of that department can set up a meeting for a whole team';
    elsif new.visibility = 'company' and not ops.is_founder() then
      raise exception 'Only the founder can make a meeting visible to everyone';
    end if;
  end if;
  return new;
end $$;
create trigger t_meeting_series_guard before insert or update on ops.meeting_series
  for each row execute function ops.meeting_series_guard();

create or replace function ops.generate_series_meetings(p_series uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s         record;
  today     date := (now() at time zone 'Asia/Kolkata')::date;
  d         date;
  last_day  date;
  first_occ date;
  made      integer := 0;
  n         integer;
  was       text := coalesce(current_setting('ops.system_job', true), '');
begin
  perform set_config('ops.system_job', '1', true);
  for s in select * from ops.meeting_series
           where active and (p_series is null or id = p_series)
             and starts_on <= today + 35 and (ends_on is null or ends_on >= today) loop
    last_day := least(coalesce(s.ends_on, today + 35), today + 35);
    d := greatest(s.starts_on, today);
    first_occ := case when s.weekday is null then null
                      else s.starts_on + ((s.weekday - extract(isodow from s.starts_on)::int + 7) % 7) end;
    while d <= last_day loop
      if (s.frequency = 'weekly' and extract(isodow from d)::int = s.weekday)
         or (s.frequency = 'biweekly' and extract(isodow from d)::int = s.weekday and ((d - first_occ) / 7) % 2 = 0)
         or (s.frequency = 'monthly' and extract(day from d)::int = s.month_day) then
        insert into ops.meeting (title, description, kind, department, visibility, organizer_id, starts_at, ends_at, location,
                                 status, series_id, occurrence_date)
        values (s.title, s.description, s.kind, s.department, s.visibility, s.organizer_id,
                (d + s.start_time) at time zone 'Asia/Kolkata',
                (d + s.start_time) at time zone 'Asia/Kolkata' + make_interval(mins => s.duration_minutes),
                s.location, 'scheduled', s.id, d)
        on conflict (series_id, occurrence_date) where series_id is not null do nothing;
        get diagnostics n = row_count;
        made := made + n;
      end if;
      d := d + 1;
    end loop;

    insert into ops.meeting_attendee (meeting_id, staff_id)
    select m.id, st.id
      from ops.meeting m
      join ops.staff st on st.is_active and st.role <> 'partner'
                       and (st.id = s.organizer_id or st.id = any (s.staff_ids)
                            or (s.all_department and s.department = any (st.departments)))
     where m.series_id = s.id and m.status = 'scheduled' and m.starts_at > now()
    on conflict do nothing;
  end loop;
  perform set_config('ops.system_job', was, true);
  return made;
end $$;

create or replace function ops.meeting_series_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  first_id uuid;
  first_at timestamptz;
  who      text;
  r        record;
  was      text := coalesce(current_setting('ops.system_job', true), '');
begin
  if tg_op = 'UPDATE' then
    perform set_config('ops.system_job', '1', true);
    if new.frequency is distinct from old.frequency or new.weekday is distinct from old.weekday
       or new.month_day is distinct from old.month_day or new.start_time is distinct from old.start_time
       or new.duration_minutes is distinct from old.duration_minutes or new.starts_on is distinct from old.starts_on
       or new.ends_on is distinct from old.ends_on or new.active is distinct from old.active then
      delete from ops.meeting where series_id = new.id and starts_at > now() and not customised and status = 'scheduled';
    else
      update ops.meeting set title = new.title, description = new.description, kind = new.kind, department = new.department,
                             visibility = new.visibility, location = new.location
       where series_id = new.id and starts_at > now() and not customised and status = 'scheduled';
    end if;
    delete from ops.meeting_attendee a using ops.meeting m
     where a.meeting_id = m.id and m.series_id = new.id and m.starts_at > now() and m.status = 'scheduled'
       and a.staff_id <> new.organizer_id
       and not (a.staff_id = any (new.staff_ids)
                or (new.all_department and exists (select 1 from ops.staff st where st.id = a.staff_id and new.department = any (st.departments))));
    perform set_config('ops.system_job', was, true);
  end if;

  perform ops.generate_series_meetings(new.id);

  if tg_op = 'INSERT' and new.active then
    select id, starts_at into first_id, first_at from ops.meeting where series_id = new.id order by starts_at limit 1;
    select full_name into who from ops.staff where id = new.organizer_id;
    if first_id is not null then
      for r in select staff_id from ops.meeting_attendee where meeting_id = first_id loop
        perform ops.notify_meeting(r.staff_id, 'meeting_invite', first_id, new.organizer_id,
          who || ' set up a fixed meeting: ' || left(new.title, 80) || ' · ' || ops.meeting_when(first_at),
          'series:' || new.id || ':' || r.staff_id);
      end loop;
    end if;
  end if;
  return null;
end $$;
create trigger t_meeting_series_after after insert or update on ops.meeting_series
  for each row execute function ops.meeting_series_after();

create or replace function ops.meeting_series_before_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare was text := coalesce(current_setting('ops.system_job', true), '');
begin
  perform set_config('ops.system_job', '1', true);
  delete from ops.meeting where series_id = old.id and starts_at > now() and not customised and status = 'scheduled';
  perform set_config('ops.system_job', was, true);
  return old;
end $$;
create trigger t_meeting_series_before_delete before delete on ops.meeting_series
  for each row execute function ops.meeting_series_before_delete();

-- ---------------------------------------------------------------- reminders and automation
create or replace function ops.run_meeting_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  r     record;
  sent  integer := 0;
begin
  for r in select m.id, left(m.title, 80) as t, m.starts_at, a.staff_id
             from ops.meeting m join ops.meeting_attendee a on a.meeting_id = m.id
            where m.status = 'scheduled' and a.rsvp <> 'declined' and m.starts_at > now()
              and (m.starts_at at time zone 'Asia/Kolkata')::date = today loop
    if ops.notify_meeting(r.staff_id, 'meeting_reminder', r.id, null,
                          'Today ' || to_char(r.starts_at at time zone 'Asia/Kolkata', 'FMHH12:MI am') || ': ' || r.t,
                          'remind:' || r.id || ':' || r.staff_id) then
      sent := sent + 1;
    end if;
  end loop;
  return sent;
end $$;

create or replace function ops.run_task_automation() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare made integer; sent integer; stopped integer; meetings integer; reminded integer;
begin
  made := ops.run_task_recurrences();
  sent := ops.run_task_reminders();
  stopped := ops.close_stale_timers();
  meetings := ops.generate_series_meetings();
  reminded := ops.run_meeting_reminders();
  return jsonb_build_object('created', made, 'reminders', sent, 'timers_stopped', stopped,
                            'meetings', meetings, 'meeting_reminders', reminded);
end $$;

-- ---------------------------------------------------------------- RLS
alter table ops.meeting enable row level security;
alter table ops.meeting_attendee enable row level security;
alter table ops.meeting_series enable row level security;

create policy meeting_sel on ops.meeting for select to authenticated
  using ((select ops.is_founder())
         or organizer_id = (select auth.uid())
         or host_id = (select auth.uid())
         or awaiting_id = (select auth.uid())
         or (select ops.is_meeting_attendee(id))
         or ((select ops.is_internal())
             and (visibility = 'company'
                  or (visibility = 'department' and department = any ((select ops.my_departments())::ops.department[])))));
create policy meeting_ins on ops.meeting for insert to authenticated
  with check ((select ops.is_internal()) and organizer_id = (select auth.uid()));
create policy meeting_upd on ops.meeting for update to authenticated
  using (organizer_id = (select auth.uid()) or (select ops.is_founder())
         or ((select ops.my_role()) = 'dept_lead' and department = any ((select ops.my_departments())::ops.department[])))
  with check (organizer_id is not null);
create policy meeting_del on ops.meeting for delete to authenticated
  using (organizer_id = (select auth.uid()) or (select ops.is_founder()));

create policy meeting_attendee_sel on ops.meeting_attendee for select to authenticated
  using (staff_id = (select auth.uid()) or (select ops.can_see_meeting(meeting_id)));
create policy meeting_attendee_ins on ops.meeting_attendee for insert to authenticated
  with check ((select ops.meeting_manager(meeting_id)));
create policy meeting_attendee_upd on ops.meeting_attendee for update to authenticated
  using (staff_id = (select auth.uid()))
  with check (staff_id = (select auth.uid()));
create policy meeting_attendee_del on ops.meeting_attendee for delete to authenticated
  using ((select ops.meeting_manager(meeting_id)));

create policy meeting_series_sel on ops.meeting_series for select to authenticated
  using ((select ops.is_founder())
         or organizer_id = (select auth.uid())
         or (select auth.uid()) = any (staff_ids)
         or (department is not null and department = any ((select ops.my_departments())::ops.department[])
             and (select ops.is_internal())));
create policy meeting_series_ins on ops.meeting_series for insert to authenticated
  with check ((select ops.is_internal()) and organizer_id = (select auth.uid()));
create policy meeting_series_upd on ops.meeting_series for update to authenticated
  using (organizer_id = (select auth.uid()) or (select ops.is_founder()))
  with check (organizer_id is not null);
create policy meeting_series_del on ops.meeting_series for delete to authenticated
  using (organizer_id = (select auth.uid()) or (select ops.is_founder()));

revoke execute on all functions in schema ops from public;
grant execute on function ops.leads_department(ops.department), ops.is_meeting_attendee(uuid), ops.can_see_meeting(uuid),
  ops.meeting_manager(uuid) to authenticated, service_role;
grant execute on function ops.answer_meeting_request(uuid, text, timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function ops.calendar_busy(uuid[], timestamptz, timestamptz, uuid) to authenticated, service_role;
grant execute on function ops.run_task_automation() to authenticated, service_role;
-- 0023 attendance: check in and out for people who work from the office (slice E, D51 to D55)
-- 1. staff.works_from_office: the tag. Only the founder changes it (staff update is founder-only). Untagged people
--    are never late or absent and see nothing. Partners cannot be tagged.
-- 2. office_settings: one row the founder edits (hours 11:00 to 17:00, 15 minutes' leeway, Mon to Sat, which request
--    header carries the caller's real address). flags_on = false is "shadow mode": record and show, no late/early flags.
-- 3. office_holiday, office_network (the office's public addresses; the raw address of a person is never stored).
-- 4. attendance_session: one stretch of presence. Written only by the RPCs below, so the database decides the time and
--    checks the network. Several stretches a day, one open at a time. A stretch left open past its day is flagged
--    "missing check-out" and a lead fixes it: hours are never invented.
-- 5. attendance_request: "add my time" with a reason (mobile data, VPN, forgot), approved by a lead or the founder.
-- 6. attendance_day_mark: "working remotely" (own, with a reason) or "excused" (by a lead, with a reason).
-- 7. attendance_failure: a check-in that was refused for not being on the office network (so the founder sees when the
--    office address has probably changed).
-- 8. ops.attendance_days(): one row per tagged person per day for the week grid.

-- ---------------------------------------------------------------- the tag
alter table ops.staff add column works_from_office boolean not null default false;
alter table ops.staff add column office_since date;

create or replace function ops.staff_office_tag() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.works_from_office then
    if new.role = 'partner' then raise exception 'Partners can''t be tagged as working from the office'; end if;
    if tg_op = 'INSERT' or not old.works_from_office or new.office_since is null then
      new.office_since := ops.today_ist();
    elsif new.office_since is distinct from old.office_since then
      new.office_since := old.office_since;
    end if;
  else
    new.office_since := null;
  end if;
  return new;
end $$;
create trigger t_staff_office_tag before insert or update of works_from_office, role, office_since on ops.staff
  for each row execute function ops.staff_office_tag();

create or replace function ops.can_attend() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select works_from_office and role <> 'partner' from ops.staff
                   where id = auth.uid() and is_active), false)
$$;

-- ---------------------------------------------------------------- settings, holidays, networks
create table ops.office_settings (
  id            boolean primary key default true check (id),
  start_time    time not null default '11:00',
  end_time      time not null default '17:00',
  grace_minutes smallint not null default 15 check (grace_minutes between 0 and 120),
  work_days     smallint[] not null default '{1,2,3,4,5,6}',
  ip_header     text not null default 'cf-connecting-ip' check (ip_header in ('cf-connecting-ip', 'x-real-ip', 'x-forwarded-for')),
  ip_hops       smallint not null default 1 check (ip_hops between 1 and 5),
  flags_on      boolean not null default false,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references ops.staff (id) on delete set null
);
create index office_settings_updated_by_idx on ops.office_settings (updated_by);
insert into ops.office_settings default values;

create or replace function ops.office_settings_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.end_time <= new.start_time then raise exception 'Office hours must end after they start'; end if;
  if coalesce(array_length(new.work_days, 1), 0) = 0 or exists (select 1 from unnest(new.work_days) d where d not between 1 and 7) then
    raise exception 'Pick at least one working day (1 = Monday to 7 = Sunday)';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger t_office_settings_guard before insert or update on ops.office_settings
  for each row execute function ops.office_settings_guard();

create table ops.office_holiday (
  id           uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name         text not null check (char_length(btrim(name)) between 1 and 100),
  created_at   timestamptz not null default now()
);
create trigger t_office_holiday_audit after insert or update or delete on ops.office_holiday
  for each row execute function ops.audit();

create table ops.office_network (
  id           uuid primary key default gen_random_uuid(),
  label        text not null check (char_length(btrim(label)) between 1 and 80),
  cidr         cidr not null,
  is_active    boolean not null default true,
  last_seen_at timestamptz,
  created_by   uuid references ops.staff (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index office_network_created_by_idx on ops.office_network (created_by);
create trigger t_office_network_audit after insert or update or delete on ops.office_network
  for each row execute function ops.audit();

-- ---------------------------------------------------------------- sessions, requests, marks, failures
create table ops.attendance_session (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid not null references ops.staff (id) on delete cascade,
  work_date       date not null,
  check_in_at     timestamptz not null default now(),
  check_out_at    timestamptz,
  in_network_id   uuid references ops.office_network (id) on delete set null,
  out_network_id  uuid references ops.office_network (id) on delete set null,
  in_source       text not null check (in_source in ('network', 'manual')),
  out_source      text check (out_source in ('network', 'off_network', 'manual', 'correction')),
  late_minutes    integer not null default 0,
  is_late         boolean not null default false,
  early_minutes   integer not null default 0,
  left_early      boolean not null default false,
  missing_checkout boolean not null default false,
  note            text check (note is null or char_length(note) <= 500),
  corrected_by    uuid references ops.staff (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint attendance_session_order check (check_out_at is null or check_out_at >= check_in_at),
  constraint attendance_session_missing check (not missing_checkout or check_out_at is null),
  constraint attendance_session_out_source check ((check_out_at is null) = (out_source is null))
);
create index attendance_session_staff_date_idx on ops.attendance_session (staff_id, work_date);
create index attendance_session_date_idx on ops.attendance_session (work_date);
create index attendance_session_in_net_idx on ops.attendance_session (in_network_id);
create index attendance_session_out_net_idx on ops.attendance_session (out_network_id);
create index attendance_session_corrected_by_idx on ops.attendance_session (corrected_by);
create unique index attendance_one_open_idx on ops.attendance_session (staff_id)
  where check_out_at is null and not missing_checkout;
create trigger t_attendance_session_audit after insert or update or delete on ops.attendance_session
  for each row execute function ops.audit();

create table ops.attendance_request (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references ops.staff (id) on delete cascade,
  work_date     date not null,
  in_time       time not null,
  out_time      time not null,
  reason        text not null check (char_length(btrim(reason)) between 3 and 500),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by    uuid references ops.staff (id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_at    timestamptz not null default now(),
  constraint attendance_request_order check (out_time > in_time)
);
create index attendance_request_staff_idx on ops.attendance_request (staff_id, work_date);
create index attendance_request_decided_by_idx on ops.attendance_request (decided_by);
create index attendance_request_pending_idx on ops.attendance_request (status) where status = 'pending';
create trigger t_attendance_request_audit after insert or update or delete on ops.attendance_request
  for each row execute function ops.audit();

create table ops.attendance_day_mark (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references ops.staff (id) on delete cascade,
  mark_date  date not null,
  kind       text not null check (kind in ('remote', 'excused')),
  reason     text not null check (char_length(btrim(reason)) between 3 and 500),
  marked_by  uuid references ops.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (staff_id, mark_date)
);
create index attendance_day_mark_date_idx on ops.attendance_day_mark (mark_date);
create index attendance_day_mark_marked_by_idx on ops.attendance_day_mark (marked_by);
create trigger t_attendance_day_mark_audit after insert or update or delete on ops.attendance_day_mark
  for each row execute function ops.audit();

create table ops.attendance_failure (
  id           bigint generated always as identity primary key,
  staff_id     uuid not null references ops.staff (id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index attendance_failure_staff_idx on ops.attendance_failure (staff_id);
create index attendance_failure_at_idx on ops.attendance_failure (attempted_at);

-- ---------------------------------------------------------------- helpers
create or replace function ops.is_office_day(p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select extract(isodow from p_date)::int = any (s.work_days)
         and not exists (select 1 from ops.office_holiday h where h.holiday_date = p_date)
    from ops.office_settings s
$$;

-- The caller's public address as the database sees it, from the header the founder chose.
-- cf-connecting-ip is set by Cloudflare and cannot be forged by the browser; for x-forwarded-for the hop counted
-- from the right is used, because anything a client sends is added before the real address.
create or replace function ops.client_ip() returns inet
language plpgsql stable security definer set search_path = '' as $$
declare
  hdrs   json;
  s      ops.office_settings;
  raw    text;
  parts  text[];
begin
  begin
    hdrs := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return null;
  end;
  if hdrs is null then return null; end if;
  select * into s from ops.office_settings;
  raw := hdrs ->> s.ip_header;
  if raw is null then return null; end if;
  parts := string_to_array(raw, ',');
  if s.ip_header = 'x-forwarded-for' then
    raw := parts[array_length(parts, 1) - s.ip_hops + 1];
  else
    raw := parts[1];
  end if;
  raw := btrim(coalesce(raw, ''));
  if raw = '' then return null; end if;
  begin
    return raw::inet;
  exception when others then
    return null;
  end;
end $$;

create or replace function ops.network_for_ip(p_ip inet) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from ops.office_network
   where is_active and p_ip is not null and p_ip <<= cidr
   order by masklen(cidr) desc limit 1
$$;

-- Only the name of the matched network, or null. The address itself never reaches the browser.
create or replace function ops.my_network() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare n uuid; lbl text; ip inet;
begin
  if not (ops.can_attend() or ops.is_founder()) then return null; end if;
  ip := ops.client_ip();
  n := ops.network_for_ip(ip);
  select label into lbl from ops.office_network where id = n;
  return jsonb_build_object('on_network', n is not null, 'label', lbl, 'readable', ip is not null);
end $$;

-- Lateness is counted from the start time and flagged only after the leeway; "left early" the same way before the end.
-- Computed again for the whole day whenever a stretch changes: only the first stretch of a day can be late.
create or replace function ops.recompute_day_flags(p_staff uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s        ops.office_settings;
  r        record;
  first_id uuid;
  office   boolean := ops.is_office_day(p_date);
  late     integer;
  early    integer;
begin
  select * into s from ops.office_settings;
  select id into first_id from ops.attendance_session
   where staff_id = p_staff and work_date = p_date order by check_in_at limit 1;
  for r in select id, check_in_at, check_out_at from ops.attendance_session
            where staff_id = p_staff and work_date = p_date loop
    late := case when office and r.id = first_id
                 then greatest(0, ceil(extract(epoch from ((r.check_in_at at time zone 'Asia/Kolkata')::time - s.start_time)) / 60)::integer)
                 else 0 end;
    early := case when not office or r.check_out_at is null then 0
                  when (r.check_out_at at time zone 'Asia/Kolkata')::date > p_date then 0
                  else greatest(0, ceil(extract(epoch from (s.end_time - (r.check_out_at at time zone 'Asia/Kolkata')::time)) / 60)::integer)
             end;
    update ops.attendance_session
       set late_minutes = late, is_late = late > s.grace_minutes,
           early_minutes = early, left_early = early > s.grace_minutes
     where id = r.id;
  end loop;
end $$;

-- A stretch still open after its day ended: flag it, do not guess an end.
create or replace function ops.flag_missing_checkouts(p_staff uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update ops.attendance_session set missing_checkout = true
   where check_out_at is null and not missing_checkout
     and work_date < ops.today_ist()
     and (p_staff is null or staff_id = p_staff);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- check in and out
create or replace function ops.check_in() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid   uuid := auth.uid();
  today date := ops.today_ist();
  net   uuid;
  sid   uuid;
begin
  if not ops.can_attend() then raise exception 'Check-in is only for people tagged as working from the office'; end if;
  perform ops.flag_missing_checkouts(uid);
  if exists (select 1 from ops.attendance_session where staff_id = uid and check_out_at is null and not missing_checkout) then
    raise exception 'You''re already checked in';
  end if;
  net := ops.network_for_ip(ops.client_ip());
  if net is null then
    insert into ops.attendance_failure (staff_id) values (uid);
    return jsonb_build_object('ok', false, 'reason', 'not_on_network');
  end if;
  update ops.office_network set last_seen_at = now() where id = net;
  insert into ops.attendance_session (staff_id, work_date, check_in_at, in_network_id, in_source)
  values (uid, today, now(), net, 'network') returning id into sid;
  perform ops.recompute_day_flags(uid, today);
  return jsonb_build_object('ok', true, 'session_id', sid);
end $$;

-- Checking out from elsewhere is allowed (people leave the building and close the laptop on the way) and recorded as such.
create or replace function ops.check_out() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s   ops.attendance_session;
  net uuid;
begin
  if not ops.can_attend() then raise exception 'Check-out is only for people tagged as working from the office'; end if;
  select * into s from ops.attendance_session
   where staff_id = uid and check_out_at is null and not missing_checkout;
  if not found then raise exception 'You''re not checked in'; end if;
  net := ops.network_for_ip(ops.client_ip());
  if net is not null then update ops.office_network set last_seen_at = now() where id = net; end if;
  update ops.attendance_session
     set check_out_at = greatest(now(), check_in_at), out_network_id = net,
         out_source = case when net is null then 'off_network' else 'network' end
   where id = s.id;
  perform ops.recompute_day_flags(uid, s.work_date);
  return jsonb_build_object('ok', true, 'off_network', net is null);
end $$;

-- ---------------------------------------------------------------- requests and corrections
create or replace function ops.request_attendance(p_date date, p_in time, p_out time, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  today date := ops.today_ist();
  rid   uuid;
begin
  if not ops.can_attend() then raise exception 'Only people tagged as working from the office can ask for this'; end if;
  if p_date is null or p_date > today or p_date < today - 7 then
    raise exception 'You can ask for today or any of the last 7 days';
  end if;
  if p_in is null or p_out is null or p_out <= p_in then raise exception 'The leaving time must be after the arrival time'; end if;
  if p_date = today and p_out > (now() at time zone 'Asia/Kolkata')::time then
    raise exception 'You can''t ask for a time that hasn''t happened yet';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why, in a few words'; end if;
  if exists (select 1 from ops.attendance_request
              where staff_id = auth.uid() and work_date = p_date and status = 'pending'
                and in_time = p_in and out_time = p_out) then
    raise exception 'You''ve already asked for that';
  end if;
  insert into ops.attendance_request (staff_id, work_date, in_time, out_time, reason)
  values (auth.uid(), p_date, p_in, p_out, btrim(p_reason)) returning id into rid;
  return rid;
end $$;

-- A lead or the founder; nobody but the founder decides their own.
create or replace function ops.can_decide_attendance(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select ops.is_founder() or (p_staff <> auth.uid() and ops.leads_staff(p_staff))
$$;

create or replace function ops.decide_attendance_request(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r      ops.attendance_request;
  t_in   timestamptz;
  t_out  timestamptz;
begin
  select * into r from ops.attendance_request where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not ops.can_decide_attendance(r.staff_id) then
    raise exception 'Only a lead or the founder can decide this' using errcode = '42501';
  end if;
  if r.status <> 'pending' then raise exception 'This request has already been decided'; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say why it was turned down';
  end if;
  if p_approve then
    t_in := (r.work_date + r.in_time) at time zone 'Asia/Kolkata';
    t_out := (r.work_date + r.out_time) at time zone 'Asia/Kolkata';
    if exists (select 1 from ops.attendance_session a
                where a.staff_id = r.staff_id
                  and tstzrange(a.check_in_at, coalesce(a.check_out_at, 'infinity'), '[)') && tstzrange(t_in, t_out, '[)')) then
      raise exception 'That overlaps time already recorded for this person';
    end if;
    insert into ops.attendance_session (staff_id, work_date, check_in_at, check_out_at, in_source, out_source, note, corrected_by)
    values (r.staff_id, r.work_date, t_in, t_out, 'manual', 'manual', left('Added on request: ' || r.reason, 500), auth.uid());
    perform ops.recompute_day_flags(r.staff_id, r.work_date);
  end if;
  update ops.attendance_request
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;
end $$;

-- Fix a stretch that was never closed: the lead says when the person actually left, and why that is believed.
create or replace function ops.correct_checkout(p_session uuid, p_out timestamptz, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare s ops.attendance_session;
begin
  select * into s from ops.attendance_session where id = p_session for update;
  if not found then raise exception 'Record not found'; end if;
  if not ops.can_decide_attendance(s.staff_id) then
    raise exception 'Only a lead or the founder can fix this' using errcode = '42501';
  end if;
  if s.check_out_at is not null then raise exception 'This one already has a check-out'; end if;
  if p_out is null or p_out < s.check_in_at or p_out > now() or p_out > s.check_in_at + interval '16 hours' then
    raise exception 'Pick a leaving time after arrival, not in the future and within 16 hours of arriving';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say how you know when they left'; end if;
  update ops.attendance_session
     set check_out_at = p_out, out_source = 'correction', missing_checkout = false,
         corrected_by = auth.uid(), note = left(btrim(p_note), 500)
   where id = p_session;
  perform ops.recompute_day_flags(s.staff_id, s.work_date);
end $$;

-- ---------------------------------------------------------------- day marks
create or replace function ops.declare_remote(p_date date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare today date := ops.today_ist(); existing ops.attendance_day_mark;
begin
  if not ops.can_attend() then raise exception 'Only people tagged as working from the office need this'; end if;
  if p_date is null or p_date < today or p_date > today + 30 then
    raise exception 'Pick today or a day in the next 30 days';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why, in a few words'; end if;
  select * into existing from ops.attendance_day_mark where staff_id = auth.uid() and mark_date = p_date;
  if found and existing.kind = 'excused' then raise exception 'Your lead has already excused this day'; end if;
  insert into ops.attendance_day_mark (staff_id, mark_date, kind, reason, marked_by)
  values (auth.uid(), p_date, 'remote', btrim(p_reason), auth.uid())
  on conflict (staff_id, mark_date) do update set reason = excluded.reason, created_at = now();
end $$;

create or replace function ops.excuse_day(p_staff uuid, p_date date, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare today date := ops.today_ist();
begin
  if not ops.can_decide_attendance(p_staff) then
    raise exception 'Only a lead or the founder can excuse a day' using errcode = '42501';
  end if;
  if not exists (select 1 from ops.staff where id = p_staff and works_from_office) then
    raise exception 'That person isn''t tagged as working from the office';
  end if;
  if p_date is null or p_date > today + 30 or p_date < today - 60 then
    raise exception 'Pick a day in the last 60 days or the next 30';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why, in a few words'; end if;
  insert into ops.attendance_day_mark (staff_id, mark_date, kind, reason, marked_by)
  values (p_staff, p_date, 'excused', btrim(p_reason), auth.uid())
  on conflict (staff_id, mark_date) do update
    set kind = 'excused', reason = excluded.reason, marked_by = excluded.marked_by, created_at = now();
end $$;

create or replace function ops.clear_day_mark(p_staff uuid, p_date date) returns void
language plpgsql security definer set search_path = '' as $$
declare m ops.attendance_day_mark;
begin
  select * into m from ops.attendance_day_mark where staff_id = p_staff and mark_date = p_date;
  if not found then return; end if;
  if not (ops.can_decide_attendance(p_staff)
          or (p_staff = auth.uid() and m.kind = 'remote' and p_date >= ops.today_ist())) then
    raise exception 'You can''t remove that' using errcode = '42501';
  end if;
  delete from ops.attendance_day_mark where id = m.id;
end $$;

-- ---------------------------------------------------------------- founder: trust the network I am on
create or replace function ops.trust_this_network(p_label text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ip   inet := ops.client_ip();
  net  uuid;
  made uuid;
begin
  if not ops.is_founder() then raise exception 'Only the founder can do this' using errcode = '42501'; end if;
  if ip is null then raise exception 'Can''t read this connection''s address; check the header setting'; end if;
  if char_length(btrim(coalesce(p_label, ''))) < 1 then raise exception 'Give the network a name'; end if;
  net := ops.network_for_ip(ip);
  if net is not null then
    update ops.office_network set last_seen_at = now() where id = net;
    return jsonb_build_object('id', net, 'created', false);
  end if;
  insert into ops.office_network (label, cidr, last_seen_at)
  values (btrim(p_label), case when family(ip) = 4 then set_masklen(ip, 32)::cidr else set_masklen(ip, 64)::cidr end, now())
  returning id into made;
  return jsonb_build_object('id', made, 'created', true);
end $$;

-- ---------------------------------------------------------------- the week grid
create or replace function ops.attendance_days(p_from date, p_to date, p_staff uuid default null)
returns table (
  staff_id uuid, work_date date, expected boolean, holiday text,
  first_in timestamptz, last_out timestamptz, minutes integer,
  is_late boolean, late_minutes integer, left_early boolean, early_minutes integer,
  is_open boolean, missing_checkout boolean, off_network_out boolean, manual boolean,
  mark text, mark_reason text)
language plpgsql stable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Pick a range of at most 62 days';
  end if;
  return query
  select st.id, d.dt, (extract(isodow from d.dt)::int = any (cfg.work_days) and h.id is null), h.name,
         a.first_in, a.last_out, a.minutes,
         coalesce(a.is_late, false), coalesce(a.late_minutes, 0), coalesce(a.left_early, false), coalesce(a.early_minutes, 0),
         coalesce(a.is_open, false), coalesce(a.missing, false), coalesce(a.off_out, false), coalesce(a.manual, false),
         m.kind, m.reason
    from ops.staff st
    cross join ops.office_settings cfg
    cross join lateral (select g::date as dt from generate_series(p_from, least(p_to, ops.today_ist()), interval '1 day') g) d
    left join ops.office_holiday h on h.holiday_date = d.dt
    left join lateral (
      select min(x.check_in_at) as first_in,
             max(x.check_out_at) as last_out,
             coalesce(sum(extract(epoch from (x.check_out_at - x.check_in_at)) / 60) filter (where x.check_out_at is not null), 0)::integer as minutes,
             bool_or(x.is_late) as is_late,
             max(x.late_minutes) as late_minutes,
             (array_agg(x.left_early order by x.check_in_at desc))[1] as left_early,
             (array_agg(x.early_minutes order by x.check_in_at desc))[1] as early_minutes,
             bool_or(x.check_out_at is null and not x.missing_checkout) as is_open,
             bool_or(x.missing_checkout) as missing,
             bool_or(x.out_source = 'off_network') as off_out,
             bool_or(x.in_source = 'manual') as manual
        from ops.attendance_session x
       where x.staff_id = st.id and x.work_date = d.dt) a on true
    left join ops.attendance_day_mark m on m.staff_id = st.id and m.mark_date = d.dt
   where st.works_from_office and st.is_active and d.dt >= st.office_since
     and ops.leads_staff(st.id)
     and (p_staff is null or st.id = p_staff)
   order by st.full_name, d.dt;
end $$;

-- ---------------------------------------------------------------- automation, me()
create or replace function ops.run_task_automation() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare made integer; sent integer; stopped integer; meetings integer; reminded integer; flagged integer;
begin
  made := ops.run_task_recurrences();
  sent := ops.run_task_reminders();
  stopped := ops.close_stale_timers();
  meetings := ops.generate_series_meetings();
  reminded := ops.run_meeting_reminders();
  flagged := ops.flag_missing_checkouts();
  return jsonb_build_object('created', made, 'reminders', sent, 'timers_stopped', stopped,
                            'meetings', meetings, 'meeting_reminders', reminded, 'missing_checkouts', flagged);
end $$;

create or replace function ops.me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('id', id, 'full_name', full_name, 'email', email,
                               'role', role, 'departments', departments,
                               'works_from_office', works_from_office and role <> 'partner')
       from ops.staff where id = auth.uid() and is_active),
    'null'::jsonb)
$$;

-- ---------------------------------------------------------------- RLS
alter table ops.office_settings enable row level security;
create policy office_settings_sel on ops.office_settings for select to authenticated
  using ((select ops.is_internal()));
create policy office_settings_upd on ops.office_settings for update to authenticated
  using ((select ops.is_founder())) with check ((select ops.is_founder()));

alter table ops.office_holiday enable row level security;
create policy office_holiday_sel on ops.office_holiday for select to authenticated
  using ((select ops.is_internal()));
create policy office_holiday_ins on ops.office_holiday for insert to authenticated
  with check ((select ops.is_founder()));
create policy office_holiday_upd on ops.office_holiday for update to authenticated
  using ((select ops.is_founder())) with check ((select ops.is_founder()));
create policy office_holiday_del on ops.office_holiday for delete to authenticated
  using ((select ops.is_founder()));

alter table ops.office_network enable row level security;
create policy office_network_sel on ops.office_network for select to authenticated
  using ((select ops.is_founder()));
create policy office_network_ins on ops.office_network for insert to authenticated
  with check ((select ops.is_founder()));
create policy office_network_upd on ops.office_network for update to authenticated
  using ((select ops.is_founder())) with check ((select ops.is_founder()));
create policy office_network_del on ops.office_network for delete to authenticated
  using ((select ops.is_founder()));

alter table ops.attendance_session enable row level security;
create policy attendance_session_sel on ops.attendance_session for select to authenticated
  using ((select ops.leads_staff(staff_id)));

alter table ops.attendance_request enable row level security;
create policy attendance_request_sel on ops.attendance_request for select to authenticated
  using ((select ops.leads_staff(staff_id)));

alter table ops.attendance_day_mark enable row level security;
create policy attendance_day_mark_sel on ops.attendance_day_mark for select to authenticated
  using ((select ops.leads_staff(staff_id)));

alter table ops.attendance_failure enable row level security;
create policy attendance_failure_sel on ops.attendance_failure for select to authenticated
  using ((select ops.is_founder()));

-- These tables change only through the functions above.
revoke insert, update, delete on ops.attendance_session, ops.attendance_request, ops.attendance_day_mark,
  ops.attendance_failure from authenticated;
revoke insert, delete on ops.office_settings from authenticated;

-- ---------------------------------------------------------------- grants
revoke execute on all functions in schema ops from public;
grant execute on function ops.can_attend(), ops.my_network(), ops.check_in(), ops.check_out(),
  ops.request_attendance(date, time, time, text), ops.decide_attendance_request(uuid, boolean, text),
  ops.correct_checkout(uuid, timestamptz, text), ops.declare_remote(date, text), ops.excuse_day(uuid, date, text),
  ops.clear_day_mark(uuid, date), ops.trust_this_network(text), ops.attendance_days(date, date, uuid),
  ops.can_decide_attendance(uuid), ops.is_office_day(date) to authenticated, service_role;
grant execute on function ops.flag_missing_checkouts(uuid) to service_role;
grant execute on function ops.run_task_automation(), ops.me() to authenticated, service_role;
-- 0024: scheduled jobs that leave a trail, and the nightly KPI snapshot.
--
--   1. run_job(name)         the one entry point a scheduler calls. Takes a lock so two runs never overlap, writes a
--                            job_run row, records the error if the job fails, and closes runs that died half way.
--   2. write_kpi_snapshot()  one row per metric per day in kpi_snapshot. Safe to run again the same day (it overwrites).
--   2b. purge_attendance()   removes attendance older than two years (and its audit copies)
--   3. job_health()          founder only: the last run of each job and whether it is overdue.
--
-- The schedule itself (pg_cron) is in supabase/schedules.sql, not here: it needs an extension the test database
-- does not have, and it is applied to hosted on purpose, not by every migration run.

-- ---------------------------------------------------------------- 1. KPI snapshot
create or replace function ops.write_kpi_snapshot(p_date date default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare d date := coalesce(p_date, ops.today_ist()); n integer;
begin
  delete from ops.kpi_snapshot where snapshot_date = d;

  insert into ops.kpi_snapshot (snapshot_date, metric, dimension, value)
  select d, 'institutions', stage::text, count(*)
    from ops.institution where archived_at is null group by stage
  union all
  select d, 'institutions', 'all', count(*) from ops.institution where archived_at is null
  union all
  select d, 'deals_open', 'all', count(*) from ops.deal where stage in ('meeting', 'proposal', 'negotiation') and archived_at is null
  union all
  select d, 'pipeline_value_inr', 'all', coalesce(sum(value_inr), 0)
    from ops.deal where stage in ('meeting', 'proposal', 'negotiation') and archived_at is null
  union all
  select d, 'pipeline_weighted_inr', 'all', coalesce(sum(value_inr * coalesce(probability, 0) / 100.0), 0)
    from ops.deal where stage in ('meeting', 'proposal', 'negotiation') and archived_at is null
  union all
  select d, 'deals_won', 'all', count(*) from ops.deal where stage = 'won' and archived_at is null
  union all
  select d, 'won_value_inr', 'all', coalesce(sum(value_inr), 0) from ops.deal where stage = 'won' and archived_at is null
  union all
  select d, 'events_completed', 'all', count(*) from ops.event where status = 'completed' and archived_at is null
  union all
  select d, 'people_trained', 'all', coalesce(sum(actual_headcount), 0)
    from ops.event where status = 'completed' and archived_at is null
  union all
  select d, 'tasks_open', 'all', count(*) from ops.task where status in ('todo', 'doing', 'blocked')
  union all
  select d, 'tasks_overdue', 'all', count(*) from ops.task where status in ('todo', 'doing', 'blocked') and due_date < d
  union all
  select d, 'kit_loss_inr', 'all', coalesce(sum(-sm.qty * coalesce(i.unit_cost_inr, 0)), 0)
    from ops.stock_movement sm join ops.item i on i.id = sm.item_id where sm.kind in ('damaged', 'lost')
  union all
  select d, 'low_stock_items', 'all', count(*) from ops.v_low_stock
  union all
  -- Funnel steps (view from 0025, read when the job runs): institutions that reached each step, all segments together.
  select d, 'funnel_reached', step, sum(institutions) from ops.v_funnel_steps group by step;

  -- Student steps only once the IDE sync has sent someone: no row is better than a made-up zero.
  if exists (select 1 from ops.ide_user_snapshot) then
    insert into ops.kpi_snapshot (snapshot_date, metric, dimension, value)
    select d, 'ide_students', 'signed_up', count(*) from ops.ide_user_snapshot
    union all select d, 'ide_students', 'compiled', count(first_compile_at) from ops.ide_user_snapshot
    union all select d, 'ide_students', 'flashed', count(first_flash_at) from ops.ide_user_snapshot
    union all select d, 'ide_students', 'published', count(first_publish_at) from ops.ide_user_snapshot;
  end if;

  select count(*) into n from ops.kpi_snapshot where snapshot_date = d;
  return n;
end $$;

-- ---------------------------------------------------------------- 1b. attendance retention (D57: two years)
-- Days older than two years go, and so do their copies in the audit log. Failed check-in attempts (a diagnostic
-- for "the office IP changed") are kept 90 days. Returns how many rows were removed.
create or replace function ops.purge_attendance(p_years integer default 2) returns integer
language plpgsql security definer set search_path = '' as $$
declare cutoff date := ops.today_ist() - (p_years * 365); n integer := 0; k integer;
begin
  delete from ops.attendance_session where work_date < cutoff;
  get diagnostics k = row_count; n := n + k;
  delete from ops.attendance_request where work_date < cutoff;
  get diagnostics k = row_count; n := n + k;
  delete from ops.attendance_day_mark where mark_date < cutoff;
  get diagnostics k = row_count; n := n + k;
  delete from ops.attendance_failure where attempted_at < now() - interval '90 days';
  get diagnostics k = row_count; n := n + k;
  delete from ops.audit_log
   where (table_name in ('attendance_session', 'attendance_request')
          and coalesce(before ->> 'work_date', after ->> 'work_date')::date < cutoff)
      or (table_name = 'attendance_day_mark' and coalesce(before ->> 'mark_date', after ->> 'mark_date')::date < cutoff);
  return n;
end $$;

-- ---------------------------------------------------------------- 2. job runner
-- Only these names can be run. The name is matched, never executed as text.
create or replace function ops.run_job(p_job text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  run_id uuid;
  result jsonb;
  affected integer;
begin
  if p_job not in ('task_automation', 'kpi_snapshot', 'low_stock', 'attendance_retention') then
    raise exception 'Unknown job: %', p_job;
  end if;

  -- A second run of the same job while one is going is skipped, not queued.
  if not pg_try_advisory_xact_lock(hashtext('ops.run_job.' || p_job)) then
    return jsonb_build_object('job', p_job, 'status', 'skipped');
  end if;

  -- A run that never finished (the server died) is closed so the history is honest.
  update ops.job_run set status = 'failed', finished_at = now(), error = 'Did not finish'
   where job = p_job and status = 'running' and started_at < now() - interval '1 hour';

  insert into ops.job_run (job) values (p_job) returning id into run_id;

  begin
    if p_job = 'task_automation' then
      result := ops.run_task_automation();
    elsif p_job = 'kpi_snapshot' then
      affected := ops.write_kpi_snapshot();
      result := jsonb_build_object('metrics', affected);
    elsif p_job = 'low_stock' then
      affected := ops.raise_low_stock_tasks();
      result := jsonb_build_object('tasks_raised', affected);
    else
      affected := ops.purge_attendance();
      result := jsonb_build_object('rows_removed', affected);
    end if;
  exception when others then
    update ops.job_run set status = 'failed', finished_at = now(), error = left(sqlerrm, 500) where id = run_id;
    return jsonb_build_object('job', p_job, 'status', 'failed', 'error', left(sqlerrm, 500));
  end;

  update ops.job_run set status = 'ok', finished_at = now(), details = coalesce(result, '{}'::jsonb) where id = run_id;
  return jsonb_build_object('job', p_job, 'status', 'ok', 'details', coalesce(result, '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------- 3. job health (founder)
create or replace function ops.job_health() returns table (
  job text, every_minutes integer, last_status text, last_started timestamptz, last_ok timestamptz, last_error text, overdue boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ops.is_founder() then raise exception 'Only the founder can see this' using errcode = '42501'; end if;
  return query
  select j.job, j.every_minutes,
         l.status, l.started_at, o.started_at, l.error,
         coalesce(o.started_at, '-infinity'::timestamptz) < now() - make_interval(mins => j.every_minutes * 3)
  from (values ('task_automation', 15), ('kpi_snapshot', 1440), ('low_stock', 1440), ('attendance_retention', 1440)) as j (job, every_minutes)
  left join lateral (select r.status, r.started_at, r.error from ops.job_run r where r.job = j.job
                      order by r.started_at desc limit 1) l on true
  left join lateral (select r.started_at from ops.job_run r where r.job = j.job and r.status = 'ok'
                      order by r.started_at desc limit 1) o on true
  order by j.job;
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on all functions in schema ops from public;
grant execute on function ops.run_job(text), ops.write_kpi_snapshot(date), ops.purge_attendance(integer) to service_role;
grant execute on function ops.job_health() to authenticated, service_role;
-- 0025: the funnel the Cockpit reads.
--
--   1. v_funnel_steps   per segment, how many institutions have REACHED each step. Stages only move forward (0007), so
--                       "reached" is "current stage is this one or later". Churned institutions are left out of the
--                       steps (we do not know how far they got); v_funnel still lists them by stage.
--   2. ide_funnel()     student steps from the IDE sync (signed up, compiled, flashed, published). `connected` is false
--                       until the sync has sent anyone, so the Cockpit shows "not connected" instead of a made-up zero.
--                       A function, not a view, so a lead who cannot read student rows is not told "not connected".
--
-- Step names are the stage names; the "qualified", "signed" (deal_won) and "active" rules live in BUSINESS_RULES.md.

create view ops.v_funnel_steps with (security_invoker = true) as
select seg.segment, st.ord, st.step, st.label,
       (select count(*)::int from ops.institution i
         where i.archived_at is null and i.segment = seg.segment and i.stage <> 'churned' and i.stage >= st.stage) as institutions
from (values ('school'), ('college'), ('other')) as seg (segment)
cross join (values
  (1, 'contacted',          'Contacted',          'contacted'::ops.lifecycle_stage),
  (2, 'qualified',          'Qualified',          'qualified'::ops.lifecycle_stage),
  (3, 'deal_won',           'Deal won',           'deal_won'::ops.lifecycle_stage),
  (4, 'workshop_delivered', 'Workshop delivered', 'workshop_delivered'::ops.lifecycle_stage),
  (5, 'teachers_trained',   'Teachers trained',   'teachers_trained'::ops.lifecycle_stage),
  (6, 'active',             'Active',             'active'::ops.lifecycle_stage)
) as st (ord, step, label, stage);

create or replace function ops.ide_funnel() returns table (
  connected boolean, students_signed_up integer, compiled integer, flashed integer, published integer, last_synced timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ops.is_internal() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return query
  select count(*) > 0, count(*)::int, count(u.first_compile_at)::int, count(u.first_flash_at)::int,
         count(u.first_publish_at)::int, max(u.synced_at)
    from ops.ide_user_snapshot u;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.ide_funnel() to authenticated, service_role;
-- 0026: operations insight (D60). The numbers behind the Cockpit's Operations view and the lead's team view.
--
--   1. working_days(from, to)  Monday to Friday days in a range. Saturday and Sunday are off.
--   2. task_bucket(...)        early / on_time / late for a finished task against a deadline, in Indian time.
--   3. v_task_timeliness       one row per task: who, when it was finished, how that compares with the ORIGINAL
--                              deadline (and the current one), how often the deadline was pushed back, time blocked,
--                              time logged. Reads through RLS, so a lead only sees what a lead may see.
--   4. backlog_snapshot        what was open, overdue and blocked at the start of each day, per department and person.
--                              These cannot be rebuilt later, so the nightly job keeps them from now on.

-- ---------------------------------------------------------------- 1. working days
create or replace function ops.working_days(p_from date, p_to date) returns integer
language sql immutable set search_path = '' as $$
  select count(*)::integer
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
   where extract(isodow from g) < 6
$$;

-- ---------------------------------------------------------------- 2. early, on time, late
-- Early: finished on an earlier day than the deadline. On time: by the deadline (end of day when there is no time).
-- Late: after it. No deadline, or not finished: null.
create or replace function ops.task_bucket(p_finished timestamptz, p_due date, p_due_time time) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_finished is null or p_due is null then null
    when (p_finished at time zone 'Asia/Kolkata')::date < p_due then 'early'
    when (p_finished at time zone 'Asia/Kolkata') <= (p_due + coalesce(p_due_time, time '23:59:59.999')) then 'on_time'
    else 'late'
  end
$$;

-- ---------------------------------------------------------------- 3. one row per task
-- The original deadline is the first one ever set (the 'due' history row's "from", or its "to" when the deadline was
-- added later). Moving a deadline back would otherwise turn late work into on-time work.
create view ops.v_task_timeliness with (security_invoker = true) as
select
  t.id                                    as task_id,
  t.title,
  t.department,
  t.priority,
  t.status,
  t.assignee_id,
  t.created_by,
  t.assigned_by,
  t.parent_task_id is not null            as is_subtask,
  t.created_at,
  (t.created_at at time zone 'Asia/Kolkata')::date as created_day,
  t.assigned_at,
  t.accepted_at,
  h.started_at,
  case when t.status = 'done' then t.completed_at end as done_at,
  case when t.status = 'done' then (t.completed_at at time zone 'Asia/Kolkata')::date end as done_day,
  t.due_date,
  t.due_time,
  coalesce(fd.d, t.due_date)              as original_due_date,
  case when fd.s is not null then fd.tm else t.due_time end as original_due_time,
  case when t.status = 'done' then ops.task_bucket(t.completed_at, coalesce(fd.d, t.due_date), case when fd.s is not null then fd.tm else t.due_time end) end as bucket,
  case when t.status = 'done' then ops.task_bucket(t.completed_at, t.due_date, t.due_time) end as bucket_now,
  case when t.status = 'done'
        and ops.task_bucket(t.completed_at, coalesce(fd.d, t.due_date), case when fd.s is not null then fd.tm else t.due_time end) = 'late'
       then ops.working_days(coalesce(fd.d, t.due_date) + 1, (t.completed_at at time zone 'Asia/Kolkata')::date)
  end                                     as days_late,
  t.estimate_minutes,
  coalesce(tm.minutes, 0)::integer        as logged_minutes,
  coalesce(bl.minutes, 0)::integer        as blocked_minutes,
  coalesce(h.reschedules, 0)::integer     as reschedules,
  coalesce(h.reopens, 0)::integer         as reopens,
  coalesce(h.reassigns, 0)::integer       as reassigns
from ops.task t
left join lateral (
  select count(*) filter (where kind = 'due' and from_value is not null and to_value > from_value) as reschedules,
         count(*) filter (where kind = 'status' and from_value = 'done')                           as reopens,
         count(*) filter (where kind = 'assigned' and from_value is not null)                      as reassigns,
         min(at)  filter (where kind = 'status' and to_value = 'doing')                            as started_at
    from ops.task_history x where x.task_id = t.id
) h on true
left join lateral (
  select s, left(s, 10)::date as d, nullif(substr(s, 12, 5), '')::time as tm
    from (select coalesce(x.from_value, x.to_value) as s
            from ops.task_history x where x.task_id = t.id and x.kind = 'due'
           order by x.at, x.id limit 1) f
) fd on true
left join lateral (
  select sum(e.minutes) as minutes from ops.time_entry e where e.task_id = t.id
) tm on true
left join lateral (
  select sum(extract(epoch from (coalesce(z.nxt, now()) - z.at)) / 60)::integer as minutes
    from (select s.to_value, s.at, lead(s.at) over (order by s.at, s.id) as nxt
            from ops.task_history s where s.task_id = t.id and s.kind = 'status') z
   where z.to_value = 'blocked'
) bl on true;

-- ---------------------------------------------------------------- 4. backlog snapshot
create table ops.backlog_snapshot (
  snapshot_date     date    not null,
  department        ops.department not null,
  assignee_id       uuid    references ops.staff (id) on delete cascade,
  open_count        integer not null,
  overdue_count     integer not null,
  blocked_count     integer not null,
  no_deadline_count integer not null
);
create unique index backlog_snapshot_key
  on ops.backlog_snapshot (snapshot_date, department, coalesce(assignee_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index backlog_snapshot_assignee_idx on ops.backlog_snapshot (assignee_id);

alter table ops.backlog_snapshot enable row level security;
create policy backlog_snapshot_sel on ops.backlog_snapshot for select to authenticated
  using ((select ops.is_founder())
         or ((select ops.my_role()) = 'dept_lead'
             and (department = any ((select ops.my_departments())::ops.department[]) or (select ops.leads_staff(assignee_id)))));

-- The nightly snapshot (from 0024) now also writes the backlog. Same body, one block added.
create or replace function ops.write_kpi_snapshot(p_date date default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare d date := coalesce(p_date, ops.today_ist()); n integer;
begin
  delete from ops.kpi_snapshot where snapshot_date = d;
  delete from ops.backlog_snapshot where snapshot_date = d;

  insert into ops.kpi_snapshot (snapshot_date, metric, dimension, value)
  select d, 'institutions', stage::text, count(*)
    from ops.institution where archived_at is null group by stage
  union all
  select d, 'institutions', 'all', count(*) from ops.institution where archived_at is null
  union all
  select d, 'deals_open', 'all', count(*) from ops.deal where stage in ('meeting', 'proposal', 'negotiation') and archived_at is null
  union all
  select d, 'pipeline_value_inr', 'all', coalesce(sum(value_inr), 0)
    from ops.deal where stage in ('meeting', 'proposal', 'negotiation') and archived_at is null
  union all
  select d, 'pipeline_weighted_inr', 'all', coalesce(sum(value_inr * coalesce(probability, 0) / 100.0), 0)
    from ops.deal where stage in ('meeting', 'proposal', 'negotiation') and archived_at is null
  union all
  select d, 'deals_won', 'all', count(*) from ops.deal where stage = 'won' and archived_at is null
  union all
  select d, 'won_value_inr', 'all', coalesce(sum(value_inr), 0) from ops.deal where stage = 'won' and archived_at is null
  union all
  select d, 'events_completed', 'all', count(*) from ops.event where status = 'completed' and archived_at is null
  union all
  select d, 'people_trained', 'all', coalesce(sum(actual_headcount), 0)
    from ops.event where status = 'completed' and archived_at is null
  union all
  select d, 'tasks_open', 'all', count(*) from ops.task where status in ('todo', 'doing', 'blocked')
  union all
  select d, 'tasks_overdue', 'all', count(*) from ops.task where status in ('todo', 'doing', 'blocked') and due_date < d
  union all
  select d, 'kit_loss_inr', 'all', coalesce(sum(-sm.qty * coalesce(i.unit_cost_inr, 0)), 0)
    from ops.stock_movement sm join ops.item i on i.id = sm.item_id where sm.kind in ('damaged', 'lost')
  union all
  select d, 'low_stock_items', 'all', count(*) from ops.v_low_stock
  union all
  select d, 'funnel_reached', step, sum(institutions) from ops.v_funnel_steps group by step;

  if exists (select 1 from ops.ide_user_snapshot) then
    insert into ops.kpi_snapshot (snapshot_date, metric, dimension, value)
    select d, 'ide_students', 'signed_up', count(*) from ops.ide_user_snapshot
    union all select d, 'ide_students', 'compiled', count(first_compile_at) from ops.ide_user_snapshot
    union all select d, 'ide_students', 'flashed', count(first_flash_at) from ops.ide_user_snapshot
    union all select d, 'ide_students', 'published', count(first_publish_at) from ops.ide_user_snapshot;
  end if;

  insert into ops.backlog_snapshot (snapshot_date, department, assignee_id, open_count, overdue_count, blocked_count, no_deadline_count)
  select d, department, assignee_id,
         count(*),
         count(*) filter (where due_date < d),
         count(*) filter (where status = 'blocked'),
         count(*) filter (where due_date is null)
    from ops.task
   where status in ('todo', 'doing', 'blocked')
   group by department, assignee_id;

  select count(*) into n from ops.kpi_snapshot where snapshot_date = d;
  return n;
end $$;

-- Functions: same grant rules as everywhere (nothing for public).
revoke execute on all functions in schema ops from public;
grant execute on function ops.working_days(date, date), ops.task_bucket(timestamptz, date, time) to authenticated, service_role;
-- 0027: One answer for a whole fixed meeting.
--
-- Problem: every occurrence of a fixed meeting is its own meeting with its own "invited" answer, so a person had
-- to answer each week, and changing the series time (which regenerates the future occurrences) asked them again.
--
-- 1. ops.meeting_series_response: one row per person per series. Written only by the triggers and the RPC below.
-- 2. Accepting any upcoming occurrence accepts every upcoming occurrence still "invited" (a person's own decline or
--    "maybe" stays, a moved or edited (customised) occurrence stays). Declining or "maybe" on one occurrence
--    changes only that one.
-- 3. ops.answer_meeting_series(series, rsvp): "all upcoming" in one call, overriding earlier per-occurrence answers.
-- 4. New occurrences (the nightly job, or a regenerated series) arrive with the person's series answer.
-- 5. One invitation per person per series (also for people added later); the organizer gets one answer
--    notification per action, not one per occurrence.
-- 6. Backfill: where someone already accepted an upcoming occurrence, that becomes their series answer.

create table ops.meeting_series_response (
  series_id    uuid not null references ops.meeting_series (id) on delete cascade,
  staff_id     uuid not null references ops.staff (id) on delete cascade,
  rsvp         text not null check (rsvp in ('accepted', 'tentative', 'declined')),
  responded_at timestamptz not null default now(),
  primary key (series_id, staff_id)
);
create index meeting_series_response_staff_idx on ops.meeting_series_response (staff_id);
alter table ops.meeting_series_response enable row level security;
create policy meeting_series_response_sel on ops.meeting_series_response for select to authenticated
  using (staff_id = (select auth.uid())
         or (select ops.is_founder())
         or exists (select 1 from ops.meeting_series s where s.id = series_id and s.organizer_id = (select auth.uid())));

-- ---------------------------------------------------------------- accept one = accept the upcoming ones
create or replace function ops.meeting_attendee_series_accept() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m   record;
  was text := coalesce(current_setting('ops.meeting_rpc', true), '');
begin
  if ops.is_system() or was = '1' then return null; end if;
  select series_id, organizer_id into m from ops.meeting where id = new.meeting_id;
  if m.series_id is null or new.staff_id = m.organizer_id then return null; end if;

  insert into ops.meeting_series_response (series_id, staff_id, rsvp, responded_at)
  values (m.series_id, new.staff_id, 'accepted', now())
  on conflict (series_id, staff_id) do update set rsvp = 'accepted', responded_at = now();

  perform set_config('ops.meeting_rpc', '1', true);
  update ops.meeting_attendee a set rsvp = 'accepted', responded_at = now()
    from ops.meeting x
   where a.meeting_id = x.id and x.series_id = m.series_id and a.staff_id = new.staff_id
     and a.rsvp = 'invited' and x.status = 'scheduled' and not x.customised and x.starts_at > now();
  perform set_config('ops.meeting_rpc', was, true);
  return null;
end $$;
create trigger t_meeting_attendee_series_accept after update of rsvp on ops.meeting_attendee
  for each row when (new.rsvp = 'accepted' and old.rsvp is distinct from new.rsvp)
  execute function ops.meeting_attendee_series_accept();

-- ---------------------------------------------------------------- answer the whole series
create or replace function ops.answer_meeting_series(p_series uuid, p_rsvp text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me     uuid := auth.uid();
  s      ops.meeting_series;
  who    text;
  next_m uuid;
  was    text := coalesce(current_setting('ops.meeting_rpc', true), '');
begin
  if p_rsvp not in ('accepted', 'tentative', 'declined') then raise exception 'Choose accepted, maybe or declined'; end if;
  select * into s from ops.meeting_series where id = p_series;
  if not found then raise exception 'That fixed meeting does not exist'; end if;
  if s.organizer_id = me then
    if p_rsvp = 'declined' then raise exception 'The organizer can not decline their own series; pause or delete it instead'; end if;
    return;
  end if;
  if not exists (select 1 from ops.meeting_attendee a join ops.meeting m on m.id = a.meeting_id
                  where m.series_id = p_series and a.staff_id = me) then
    raise exception 'You are not invited to that fixed meeting';
  end if;

  insert into ops.meeting_series_response (series_id, staff_id, rsvp, responded_at)
  values (p_series, me, p_rsvp, now())
  on conflict (series_id, staff_id) do update set rsvp = excluded.rsvp, responded_at = now();

  perform set_config('ops.meeting_rpc', '1', true);
  update ops.meeting_attendee a set rsvp = p_rsvp, responded_at = now()
    from ops.meeting m
   where a.meeting_id = m.id and m.series_id = p_series and a.staff_id = me
     and m.status = 'scheduled' and m.starts_at > now();
  perform set_config('ops.meeting_rpc', was, true);

  select id into next_m from ops.meeting
   where series_id = p_series and status = 'scheduled' and starts_at > now() order by starts_at limit 1;
  if next_m is not null then
    select full_name into who from ops.staff where id = me;
    perform ops.notify_meeting(s.organizer_id, 'meeting_response', next_m, me,
      who || case p_rsvp when 'accepted' then ' is coming to every one of: ' when 'declined' then ' can not come to any of: '
                         else ' might come to: ' end || left(s.title, 80));
  end if;
end $$;

-- ---------------------------------------------------------------- new occurrences inherit the answer
create or replace function ops.generate_series_meetings(p_series uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s         record;
  today     date := (now() at time zone 'Asia/Kolkata')::date;
  d         date;
  last_day  date;
  first_occ date;
  made      integer := 0;
  n         integer;
  was       text := coalesce(current_setting('ops.system_job', true), '');
  rpc_was   text := coalesce(current_setting('ops.meeting_rpc', true), '');
begin
  perform set_config('ops.system_job', '1', true);
  for s in select * from ops.meeting_series
           where active and (p_series is null or id = p_series)
             and starts_on <= today + 35 and (ends_on is null or ends_on >= today) loop
    last_day := least(coalesce(s.ends_on, today + 35), today + 35);
    d := greatest(s.starts_on, today);
    first_occ := case when s.weekday is null then null
                      else s.starts_on + ((s.weekday - extract(isodow from s.starts_on)::int + 7) % 7) end;
    while d <= last_day loop
      if (s.frequency = 'weekly' and extract(isodow from d)::int = s.weekday)
         or (s.frequency = 'biweekly' and extract(isodow from d)::int = s.weekday and ((d - first_occ) / 7) % 2 = 0)
         or (s.frequency = 'monthly' and extract(day from d)::int = s.month_day) then
        insert into ops.meeting (title, description, kind, department, visibility, organizer_id, starts_at, ends_at, location,
                                 status, series_id, occurrence_date)
        values (s.title, s.description, s.kind, s.department, s.visibility, s.organizer_id,
                (d + s.start_time) at time zone 'Asia/Kolkata',
                (d + s.start_time) at time zone 'Asia/Kolkata' + make_interval(mins => s.duration_minutes),
                s.location, 'scheduled', s.id, d)
        on conflict (series_id, occurrence_date) where series_id is not null do nothing;
        get diagnostics n = row_count;
        made := made + n;
      end if;
      d := d + 1;
    end loop;

    insert into ops.meeting_attendee (meeting_id, staff_id)
    select m.id, st.id
      from ops.meeting m
      join ops.staff st on st.is_active and st.role <> 'partner'
                       and (st.id = s.organizer_id or st.id = any (s.staff_ids)
                            or (s.all_department and s.department = any (st.departments)))
     where m.series_id = s.id and m.status = 'scheduled' and m.starts_at > now()
    on conflict do nothing;

    perform set_config('ops.meeting_rpc', '1', true);
    update ops.meeting_attendee a set rsvp = r.rsvp, responded_at = r.responded_at
      from ops.meeting_series_response r, ops.meeting m
     where r.series_id = s.id and m.series_id = s.id and a.meeting_id = m.id and a.staff_id = r.staff_id
       and a.rsvp = 'invited' and m.status = 'scheduled' and not m.customised and m.starts_at > now();
    perform set_config('ops.meeting_rpc', rpc_was, true);
  end loop;
  perform set_config('ops.system_job', was, true);
  return made;
end $$;

-- ---------------------------------------------------------------- invitations and removals
create or replace function ops.meeting_series_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  first_id uuid;
  first_at timestamptz;
  who      text;
  r        record;
  was      text := coalesce(current_setting('ops.system_job', true), '');
begin
  if tg_op = 'UPDATE' then
    perform set_config('ops.system_job', '1', true);
    if new.frequency is distinct from old.frequency or new.weekday is distinct from old.weekday
       or new.month_day is distinct from old.month_day or new.start_time is distinct from old.start_time
       or new.duration_minutes is distinct from old.duration_minutes or new.starts_on is distinct from old.starts_on
       or new.ends_on is distinct from old.ends_on or new.active is distinct from old.active then
      delete from ops.meeting where series_id = new.id and starts_at > now() and not customised and status = 'scheduled';
    else
      update ops.meeting set title = new.title, description = new.description, kind = new.kind, department = new.department,
                             visibility = new.visibility, location = new.location
       where series_id = new.id and starts_at > now() and not customised and status = 'scheduled';
    end if;
    delete from ops.meeting_attendee a using ops.meeting m
     where a.meeting_id = m.id and m.series_id = new.id and m.starts_at > now() and m.status = 'scheduled'
       and a.staff_id <> new.organizer_id
       and not (a.staff_id = any (new.staff_ids)
                or (new.all_department and exists (select 1 from ops.staff st where st.id = a.staff_id and new.department = any (st.departments))));
    delete from ops.meeting_series_response x
     where x.series_id = new.id
       and not (x.staff_id = any (new.staff_ids)
                or (new.all_department and exists (select 1 from ops.staff st where st.id = x.staff_id and new.department = any (st.departments))));
    perform set_config('ops.system_job', was, true);
  end if;

  perform ops.generate_series_meetings(new.id);

  if new.active then
    select id, starts_at into first_id, first_at from ops.meeting
     where series_id = new.id and status = 'scheduled' and starts_at > now() order by starts_at limit 1;
    select full_name into who from ops.staff where id = new.organizer_id;
    if first_id is not null then
      for r in select staff_id from ops.meeting_attendee where meeting_id = first_id loop
        perform ops.notify_meeting(r.staff_id, 'meeting_invite', first_id, new.organizer_id,
          who || ' set up a fixed meeting: ' || left(new.title, 80) || ' · ' || ops.meeting_when(first_at),
          'series:' || new.id || ':' || r.staff_id);
      end loop;
    end if;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------- backfill
insert into ops.meeting_series_response (series_id, staff_id, rsvp, responded_at)
select distinct on (m.series_id, a.staff_id) m.series_id, a.staff_id, 'accepted', coalesce(a.responded_at, now())
  from ops.meeting_attendee a
  join ops.meeting m on m.id = a.meeting_id
  join ops.meeting_series s on s.id = m.series_id
 where a.rsvp = 'accepted' and m.status = 'scheduled' and m.starts_at > now() and a.staff_id <> s.organizer_id
 order by m.series_id, a.staff_id, a.responded_at desc nulls last
on conflict do nothing;

update ops.meeting_attendee a set rsvp = 'accepted', responded_at = now()
  from ops.meeting m, ops.meeting_series_response r
 where a.meeting_id = m.id and r.series_id = m.series_id and r.staff_id = a.staff_id and r.rsvp = 'accepted'
   and a.rsvp = 'invited' and m.status = 'scheduled' and not m.customised and m.starts_at > now();

revoke execute on all functions in schema ops from public;
grant execute on function ops.answer_meeting_series(uuid, text) to authenticated, service_role;
-- 0028: Tasks without a department, a category, and one task per person for several assignees.
--
-- 1. ops.task.department becomes optional. A task with no department is seen by its assignee, its creator, its
--    watchers, the founder and a department lead who leads the assignee. That lead can also edit and delete it.
-- 2. ops.task.category ('internal' | 'other'): a separate label, not a new department.
-- 3. ops.task.group_id: tasks given to several people at once are one task per person (own status, deadline,
--    time and timeliness), linked by a group id. Only ops.create_task_group() can set it.
-- 4. ops.create_task_group / update_task_group / cancel_task_group: all-or-nothing group actions.
-- 5. ops.backlog_snapshot.department becomes optional too, so the nightly snapshot keeps counting that work.

-- ---------------------------------------------------------------- columns
alter table ops.task alter column department drop not null;
alter table ops.task add column category text check (category in ('internal', 'other'));
alter table ops.task add column group_id uuid;
create index task_group_idx on ops.task (group_id) where group_id is not null;

alter table ops.backlog_snapshot alter column department drop not null;
drop index ops.backlog_snapshot_key;
create unique index backlog_snapshot_key on ops.backlog_snapshot
  (snapshot_date, department, coalesce(assignee_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where department is not null;
create unique index backlog_snapshot_key_nodept on ops.backlog_snapshot
  (snapshot_date, coalesce(assignee_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where department is null;

-- ---------------------------------------------------------------- who can manage a task
-- A department lead manages a task with no department when they lead its assignee (never their own task).
create or replace function ops.leads_task_assignee(p_assignee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_assignee is not null
     and p_assignee is distinct from auth.uid()
     and ops.my_role() = 'dept_lead'
     and exists (select 1 from ops.staff s
                 where s.id = p_assignee and s.departments && ops.my_departments())
$$;

create or replace function ops.task_manager(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.task t
                 where t.id = p_task
                   and (ops.is_founder()
                        or t.created_by = auth.uid()
                        or (ops.my_role() = 'dept_lead'
                            and (ops.in_dept(t.department)
                                 or (t.department is null and ops.leads_task_assignee(t.assignee_id))))))
$$;

drop policy task_sel on ops.task;
create policy task_sel on ops.task for select to authenticated
  using (department = any ((select ops.my_departments())::ops.department[])
         or assignee_id = (select auth.uid())
         or created_by = (select auth.uid())
         or (select ops.is_watching(id))
         or (department is null and ((select ops.is_founder()) or (select ops.leads_task_assignee(assignee_id)))));

drop policy task_upd on ops.task;
create policy task_upd on ops.task for update to authenticated
  using ((select ops.can_write())
         and (department = any ((select ops.my_departments())::ops.department[])
              or assignee_id = (select auth.uid())
              or created_by = (select auth.uid())
              or (department is null and ((select ops.is_founder()) or (select ops.leads_task_assignee(assignee_id))))))
  with check ((select ops.can_write())
         and (department = any ((select ops.my_departments())::ops.department[])
              or assignee_id = (select auth.uid())
              or created_by = (select auth.uid())
              or (department is null and ((select ops.is_founder()) or (select ops.leads_task_assignee(assignee_id))))));

drop policy task_del on ops.task;
create policy task_del on ops.task for delete to authenticated
  using (((department = any ((select ops.my_departments())::ops.department[]))
          and (select ops.my_role()) in ('founder', 'dept_lead'))
         or (department is null and (select ops.is_founder()))
         or (department is null and (select ops.leads_task_assignee(assignee_id))));

-- ---------------------------------------------------------------- guard: category, group link, null department
create or replace function ops.task_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid     uuid := case when ops.is_system() then null else auth.uid() end;
  mgr     boolean;
  a       record;
  p       record;
begin
  new.title := btrim(new.title);
  if new.title = '' then raise exception 'A task needs a title'; end if;
  if new.due_date is null then new.due_time := null; end if;
  if new.start_date is not null and new.due_date is not null and new.start_date > new.due_date then
    raise exception 'The start date cannot be after the deadline';
  end if;

  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    select s.role, s.is_active into a from ops.staff s where s.id = new.assignee_id;
    if not found or not a.is_active then raise exception 'Choose an active team member to assign this task to'; end if;
    if a.role = 'viewer' then raise exception 'A viewer cannot be given tasks'; end if;
    if a.role = 'partner' and coalesce(new.template, '') <> 'follow_up' then
      raise exception 'Partners can only be given follow-up tasks';
    end if;
  end if;

  if new.parent_task_id is not null and (tg_op = 'INSERT' or new.parent_task_id is distinct from old.parent_task_id) then
    if new.parent_task_id = new.id then raise exception 'A task cannot be its own subtask'; end if;
    select t.parent_task_id, t.status into p from ops.task t where t.id = new.parent_task_id;
    if not found then raise exception 'The parent task was not found'; end if;
    if p.parent_task_id is not null then raise exception 'A subtask cannot have subtasks'; end if;
    if p.status in ('done', 'cancelled') then raise exception 'Add subtasks to an open task'; end if;
    if tg_op = 'UPDATE' and exists (select 1 from ops.task c where c.parent_task_id = new.id) then
      raise exception 'A task with subtasks cannot become a subtask';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'todo' then raise exception 'A new task starts as To do'; end if;
    if uid is not null then new.created_by := uid; end if;
    new.completed_at := null;
    new.completed_by := null;
    new.blocked_reason := null;
    new.cancel_reason := null;
    if uid is not null then
      new.recurrence_id := null;
      new.period_start := null;
    end if;
    if coalesce(current_setting('ops.task_rpc', true), '') <> '1' then new.group_id := null; end if;
    if uid is not null or new.assignee_id is null then new.accepted_at := null; end if;
    if new.assignee_id is not null then
      new.assigned_by := coalesce(uid, new.created_by);
      new.assigned_at := now();
      if new.assignee_id = uid then new.accepted_at := now(); end if;
    else
      new.assigned_by := null;
      new.assigned_at := null;
    end if;
    return new;
  end if;

  -- stamps are never taken from the caller
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.assigned_by := old.assigned_by;
  new.assigned_at := old.assigned_at;
  new.completed_at := old.completed_at;
  new.completed_by := old.completed_by;
  new.recurrence_id := old.recurrence_id;
  new.period_start := old.period_start;
  new.group_id := old.group_id;

  mgr := uid is null
         or ops.is_founder()
         or old.created_by = uid
         or (ops.my_role() = 'dept_lead'
             and (ops.in_dept(old.department)
                  or (old.department is null and ops.leads_task_assignee(old.assignee_id))));

  if not mgr and (new.title is distinct from old.title
                  or new.description is distinct from old.description
                  or new.department is distinct from old.department
                  or new.category is distinct from old.category
                  or new.entity_type is distinct from old.entity_type
                  or new.entity_id is distinct from old.entity_id
                  or new.parent_task_id is distinct from old.parent_task_id) then
    raise exception 'Only the person who created this task, a department lead or a founder can edit its details';
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    if not mgr
       and not (new.assignee_id is null and old.assignee_id = uid)
       and not (old.assignee_id is null and new.assignee_id = uid) then
      raise exception 'Only the person who assigned this task, a department lead or a founder can reassign it';
    end if;
    new.assigned_by := uid;
    new.assigned_at := case when new.assignee_id is null then null else now() end;
    new.accepted_at := case when new.assignee_id is not null and new.assignee_id = uid then now() else null end;
  elsif new.accepted_at is distinct from old.accepted_at then
    if new.accepted_at is null then
      new.accepted_at := old.accepted_at;
    elsif uid is not null and uid is distinct from new.assignee_id then
      raise exception 'Only the assignee can accept a task';
    else
      new.accepted_at := coalesce(old.accepted_at, now());
    end if;
  end if;

  if new.status is distinct from old.status then
    if old.status in ('done', 'cancelled') and not (mgr or old.completed_by = uid) then
      raise exception 'Only a lead, a founder, or the person who created or finished this task can reopen it';
    end if;
    if old.status = 'done' and new.status not in ('todo', 'doing') then
      raise exception 'A finished task can only be reopened';
    end if;
    if old.status = 'cancelled' and new.status <> 'todo' then
      raise exception 'A cancelled task can only be reopened';
    end if;
    if new.status = 'blocked' and coalesce(btrim(new.blocked_reason), '') = '' then
      raise exception 'Say what is blocking this task';
    end if;
    if new.status = 'cancelled' and coalesce(btrim(new.cancel_reason), '') = '' then
      raise exception 'Say why the task is cancelled';
    end if;
    if new.status in ('done', 'cancelled')
       and exists (select 1 from ops.task c where c.parent_task_id = new.id and c.status in ('todo', 'doing', 'blocked')) then
      raise exception 'Finish or cancel the subtasks first';
    end if;
    if new.status = 'done' then
      new.completed_at := now();
      new.completed_by := uid;
    elsif old.status = 'done' then
      new.completed_at := null;
      new.completed_by := null;
    end if;
    if new.status in ('doing', 'done') and new.accepted_at is null and new.assignee_id is not null and new.assignee_id = uid then
      new.accepted_at := now();
    end if;
  end if;

  if new.status <> 'blocked' then new.blocked_reason := null; end if;
  if new.status <> 'cancelled' then new.cancel_reason := null; end if;
  return new;
end $$;

-- ---------------------------------------------------------------- group actions
-- One task per person, all or nothing. One person is an ordinary task with no group.
create or replace function ops.create_task_group(
  title text,
  assignees uuid[],
  description text default null,
  priority integer default 3,
  due_date date default null,
  due_time time default null,
  start_date date default null,
  estimate_minutes integer default null,
  department ops.department default null,
  category text default null)
returns uuid[]
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare
  uid   uuid := auth.uid();
  ppl   uuid[];
  gid   uuid;
  who   uuid;
  new_id uuid;
  ids   uuid[] := '{}';
  was   text := coalesce(current_setting('ops.task_rpc', true), '');
begin
  if uid is null or not ops.can_write() or not ops.is_internal() then
    raise exception 'Your role cannot create tasks for the team';
  end if;
  if coalesce(btrim(title), '') = '' then raise exception 'A task needs a title'; end if;

  select array_agg(x.a order by x.first_at) into ppl
    from (select a, min(o) as first_at from unnest(assignees) with ordinality u(a, o) where a is not null group by a) x;
  if ppl is null or cardinality(ppl) = 0 then raise exception 'Choose at least one person'; end if;
  if cardinality(ppl) > 20 then raise exception 'A task can be given to at most 20 people at once'; end if;

  if cardinality(ppl) > 1 then gid := gen_random_uuid(); end if;
  perform set_config('ops.task_rpc', '1', true);
  foreach who in array ppl loop
    insert into ops.task (title, description, priority, due_date, due_time, start_date, estimate_minutes,
                          department, category, assignee_id, group_id)
    values (title, description, priority, due_date, due_time, start_date, estimate_minutes,
            department, category, who, gid)
    returning id into new_id;
    ids := ids || new_id;
  end loop;
  perform set_config('ops.task_rpc', was, true);
  return ids;
end $$;

-- Is the caller the creator of this task's group (or a founder)? Raises if the task is not in a group.
create or replace function ops.group_owner_check(p_task uuid, p_what text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare g uuid; c uuid;
begin
  select t.group_id, t.created_by into g, c from ops.task t where t.id = p_task;
  if not found then raise exception 'The task was not found'; end if;
  if g is null then raise exception 'This task was not given to several people'; end if;
  if not (ops.is_founder() or (c is not null and c = auth.uid())) then
    raise exception 'Only the person who created this group of tasks, or a founder, can % for everyone', p_what;
  end if;
  return g;
end $$;

-- Shared details only. Finished and cancelled tasks keep their record; status, deadline and estimate stay per person.
create or replace function ops.update_task_group(
  p_task uuid,
  title text default null,
  description text default null,
  priority integer default null,
  department ops.department default null,
  category text default null)
returns integer
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare g uuid; n integer;
begin
  g := ops.group_owner_check(p_task, 'change it');
  if title is not null and btrim(title) = '' then raise exception 'A task needs a title'; end if;
  update ops.task t set
         title       = coalesce(btrim(title), t.title),
         description = coalesce(description, t.description),
         priority    = coalesce(priority, t.priority),
         department  = coalesce(department, t.department),
         category    = coalesce(category, t.category)
   where t.group_id = g and t.status in ('todo', 'doing', 'blocked');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function ops.cancel_task_group(p_task uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare g uuid; n integer;
begin
  g := ops.group_owner_check(p_task, 'cancel it');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the tasks are cancelled'; end if;
  update ops.task c set status = 'cancelled', cancel_reason = btrim(p_reason)
   where c.parent_task_id in (select id from ops.task where group_id = g)
     and c.status in ('todo', 'doing', 'blocked');
  update ops.task t set status = 'cancelled', cancel_reason = btrim(p_reason)
   where t.group_id = g and t.status in ('todo', 'doing', 'blocked');
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.leads_task_assignee(uuid),
                          ops.create_task_group(text, uuid[], text, integer, date, time, date, integer, ops.department, text),
                          ops.update_task_group(uuid, text, text, integer, ops.department, text),
                          ops.cancel_task_group(uuid, text) to authenticated, service_role;
-- Employee portal foundations (docs/PLAN_EMPLOYEE_PORTAL.md, P0).
-- 1. staff.is_hr: a flag on a person. Only the founder sets it; viewers and partners can never be HR.
-- 2. ops.can_hr(): the founder or an active HR person. Everything HR-only in later migrations asks this one question.
-- 3. ops.hr_access_log: who looked at which person's private records. HR and the person themself can read it.
-- 4. ops.me() also reports is_hr.

alter table ops.staff add column is_hr boolean not null default false;

create or replace function ops.staff_hr_flag() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role in ('viewer', 'partner') then
    new.is_hr := false;
  elsif tg_op = 'UPDATE' and new.is_hr is distinct from old.is_hr
        and auth.uid() is not null and not ops.is_founder() then
    raise exception 'Only the founder can make someone HR' using errcode = '42501';
  elsif tg_op = 'INSERT' and new.is_hr and auth.uid() is not null and not ops.is_founder() then
    raise exception 'Only the founder can make someone HR' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger t_staff_hr_flag before insert or update of is_hr, role on ops.staff
  for each row execute function ops.staff_hr_flag();

create or replace function ops.can_hr() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (is_hr or role = 'founder') and role not in ('viewer', 'partner')
                     from ops.staff where id = auth.uid() and is_active), false)
$$;

-- ---------------------------------------------------------------- access log
create table ops.hr_access_log (
  id        bigint generated always as identity primary key,
  actor_id  uuid not null references ops.staff(id),
  target_id uuid not null references ops.staff(id),
  what      text not null check (char_length(btrim(what)) between 1 and 200),
  at        timestamptz not null default now()
);
create index hr_access_log_actor_idx on ops.hr_access_log (actor_id);
create index hr_access_log_target_idx on ops.hr_access_log (target_id, at desc);

alter table ops.hr_access_log enable row level security;
create policy hr_access_log_sel on ops.hr_access_log for select to authenticated
  using ((select ops.can_hr()) or target_id = (select auth.uid()));

create or replace function ops.log_hr_access(p_target uuid, p_what text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not ops.can_hr() then
    raise exception 'Only HR can open private records' using errcode = '42501';
  end if;
  if p_target = auth.uid() then return; end if;
  insert into ops.hr_access_log (actor_id, target_id, what) values (auth.uid(), p_target, p_what);
end $$;

-- ---------------------------------------------------------------- me()
create or replace function ops.me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('id', id, 'full_name', full_name, 'email', email,
                               'role', role, 'departments', departments,
                               'works_from_office', works_from_office and role <> 'partner',
                               'is_hr', is_hr and role not in ('viewer', 'partner'))
       from ops.staff where id = auth.uid() and is_active),
    'null'::jsonb)
$$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.can_hr(), ops.log_hr_access(uuid, text) to authenticated, service_role;
-- Attendance for everyone and the month view (docs/PLAN_EMPLOYEE_PORTAL.md, P1, D63).
-- 1. staff.attendance_mode: 'office' (checks in from an office network, as before) or 'remote' (checks in from anywhere,
--    same hours, same late / early / absent flags). The tag staff.works_from_office still means "attendance is tracked
--    for this person"; the mode says how they check in.
-- 2. Sessions record where the check-in came from: 'remote' joins the existing sources.
-- 3. ops.sees_attendance(): the person, their lead, the founder, and HR. Used by the attendance tables and the month.
-- 4. ops.attendance_grid() is the one place that builds a person's days (whole range, future days too, with `tracked`);
--    ops.attendance_days() (the week grids) and ops.attendance_month() both read it.

alter table ops.staff add column attendance_mode text not null default 'office'
  check (attendance_mode in ('office', 'remote'));

alter table ops.attendance_session drop constraint attendance_session_in_source_check;
alter table ops.attendance_session add constraint attendance_session_in_source_check
  check (in_source in ('network', 'manual', 'remote'));
alter table ops.attendance_session drop constraint attendance_session_out_source_check;
alter table ops.attendance_session add constraint attendance_session_out_source_check
  check (out_source in ('network', 'off_network', 'manual', 'correction', 'remote'));

create or replace function ops.sees_attendance(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select ops.leads_staff(p_staff) or ops.can_hr()
$$;

drop policy attendance_session_sel on ops.attendance_session;
create policy attendance_session_sel on ops.attendance_session for select to authenticated
  using ((select ops.sees_attendance(staff_id)));
drop policy attendance_request_sel on ops.attendance_request;
create policy attendance_request_sel on ops.attendance_request for select to authenticated
  using ((select ops.sees_attendance(staff_id)));
drop policy attendance_day_mark_sel on ops.attendance_day_mark;
create policy attendance_day_mark_sel on ops.attendance_day_mark for select to authenticated
  using ((select ops.sees_attendance(staff_id)));

-- ---------------------------------------------------------------- check in and out
create or replace function ops.check_in() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid    uuid := auth.uid();
  today  date := ops.today_ist();
  net    uuid;
  sid    uuid;
  remote boolean;
begin
  if not ops.can_attend() then raise exception 'Attendance is not switched on for you'; end if;
  perform ops.flag_missing_checkouts(uid);
  if exists (select 1 from ops.attendance_session where staff_id = uid and check_out_at is null and not missing_checkout) then
    raise exception 'You''re already checked in';
  end if;
  select attendance_mode = 'remote' into remote from ops.staff where id = uid;
  if not remote then
    net := ops.network_for_ip(ops.client_ip());
    if net is null then
      insert into ops.attendance_failure (staff_id) values (uid);
      return jsonb_build_object('ok', false, 'reason', 'not_on_network');
    end if;
    update ops.office_network set last_seen_at = now() where id = net;
  end if;
  insert into ops.attendance_session (staff_id, work_date, check_in_at, in_network_id, in_source)
  values (uid, today, now(), net, case when remote then 'remote' else 'network' end) returning id into sid;
  perform ops.recompute_day_flags(uid, today);
  return jsonb_build_object('ok', true, 'session_id', sid);
end $$;

create or replace function ops.check_out() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid    uuid := auth.uid();
  s      ops.attendance_session;
  net    uuid;
  remote boolean;
begin
  if not ops.can_attend() then raise exception 'Attendance is not switched on for you'; end if;
  select * into s from ops.attendance_session
   where staff_id = uid and check_out_at is null and not missing_checkout;
  if not found then raise exception 'You''re not checked in'; end if;
  select attendance_mode = 'remote' into remote from ops.staff where id = uid;
  if not remote then
    net := ops.network_for_ip(ops.client_ip());
    if net is not null then update ops.office_network set last_seen_at = now() where id = net; end if;
  end if;
  update ops.attendance_session
     set check_out_at = greatest(now(), check_in_at), out_network_id = net,
         out_source = case when remote then 'remote' when net is null then 'off_network' else 'network' end
   where id = s.id;
  perform ops.recompute_day_flags(uid, s.work_date);
  return jsonb_build_object('ok', true, 'off_network', not remote and net is null);
end $$;

-- ---------------------------------------------------------------- the grid
drop function ops.attendance_days(date, date, uuid);

create or replace function ops.attendance_grid(p_from date, p_to date, p_staff uuid)
returns table (
  staff_id uuid, work_date date, expected boolean, holiday text,
  first_in timestamptz, last_out timestamptz, minutes integer,
  is_late boolean, late_minutes integer, left_early boolean, early_minutes integer,
  is_open boolean, missing_checkout boolean, off_network_out boolean, manual boolean,
  mark text, mark_reason text, remote boolean, tracked boolean)
language sql stable set search_path = '' as $$
  select st.id, d.dt, (extract(isodow from d.dt)::int = any (cfg.work_days) and h.id is null), h.name,
         a.first_in, a.last_out, coalesce(a.minutes, 0),
         coalesce(a.is_late, false), coalesce(a.late_minutes, 0), coalesce(a.left_early, false), coalesce(a.early_minutes, 0),
         coalesce(a.is_open, false), coalesce(a.missing, false), coalesce(a.off_out, false), coalesce(a.manual, false),
         m.kind, m.reason, coalesce(a.remote, st.attendance_mode = 'remote'), d.dt >= st.office_since
    from ops.staff st
    cross join ops.office_settings cfg
    cross join lateral (select g::date as dt from generate_series(p_from, p_to, interval '1 day') g) d
    left join ops.office_holiday h on h.holiday_date = d.dt
    left join lateral (
      select min(x.check_in_at) as first_in,
             max(x.check_out_at) as last_out,
             coalesce(sum(extract(epoch from (x.check_out_at - x.check_in_at)) / 60) filter (where x.check_out_at is not null), 0)::integer as minutes,
             bool_or(x.is_late) as is_late,
             max(x.late_minutes) as late_minutes,
             (array_agg(x.left_early order by x.check_in_at desc))[1] as left_early,
             (array_agg(x.early_minutes order by x.check_in_at desc))[1] as early_minutes,
             bool_or(x.check_out_at is null and not x.missing_checkout) as is_open,
             bool_or(x.missing_checkout) as missing,
             bool_or(x.out_source = 'off_network') as off_out,
             bool_or(x.in_source = 'manual') as manual,
             bool_or(x.in_source = 'remote') as remote
        from ops.attendance_session x
       where x.staff_id = st.id and x.work_date = d.dt) a on true
    left join ops.attendance_day_mark m on m.staff_id = st.id and m.mark_date = d.dt
   where st.works_from_office and st.is_active
     and ops.sees_attendance(st.id)
     and (p_staff is null or st.id = p_staff)
   order by st.full_name, d.dt
$$;

create or replace function ops.attendance_days(p_from date, p_to date, p_staff uuid default null)
returns table (
  staff_id uuid, work_date date, expected boolean, holiday text,
  first_in timestamptz, last_out timestamptz, minutes integer,
  is_late boolean, late_minutes integer, left_early boolean, early_minutes integer,
  is_open boolean, missing_checkout boolean, off_network_out boolean, manual boolean,
  mark text, mark_reason text, remote boolean)
language plpgsql stable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Pick a range of at most 62 days';
  end if;
  return query
  select g.staff_id, g.work_date, g.expected, g.holiday, g.first_in, g.last_out, g.minutes, g.is_late, g.late_minutes,
         g.left_early, g.early_minutes, g.is_open, g.missing_checkout, g.off_network_out, g.manual, g.mark, g.mark_reason, g.remote
    from ops.attendance_grid(p_from, least(p_to, ops.today_ist()), p_staff) g
   where g.tracked;
end $$;

-- One person's calendar month, future days included (holidays and days off show ahead of time).
create or replace function ops.attendance_month(p_staff uuid, p_month date)
returns table (
  staff_id uuid, work_date date, expected boolean, holiday text,
  first_in timestamptz, last_out timestamptz, minutes integer,
  is_late boolean, late_minutes integer, left_early boolean, early_minutes integer,
  is_open boolean, missing_checkout boolean, off_network_out boolean, manual boolean,
  mark text, mark_reason text, remote boolean, tracked boolean)
language plpgsql stable set search_path = '' as $$
declare first_day date := date_trunc('month', p_month)::date;
begin
  if p_staff is null or p_month is null then raise exception 'Choose a person and a month'; end if;
  return query
  select * from ops.attendance_grid(first_day, (first_day + interval '1 month - 1 day')::date, p_staff);
end $$;

-- ---------------------------------------------------------------- me()
create or replace function ops.me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('id', id, 'full_name', full_name, 'email', email,
                               'role', role, 'departments', departments,
                               'works_from_office', works_from_office and role <> 'partner',
                               'is_hr', is_hr and role not in ('viewer', 'partner'),
                               'attendance_mode', attendance_mode)
       from ops.staff where id = auth.uid() and is_active),
    'null'::jsonb)
$$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.sees_attendance(uuid), ops.attendance_grid(date, date, uuid), ops.attendance_days(date, date, uuid),
                          ops.attendance_month(uuid, date) to authenticated, service_role;
-- Employee portal P2: the staff profile (docs/PLAN_EMPLOYEE_PORTAL.md, section 6).
-- One private row per person. Two kinds of field:
--   * personal, the person edits them: legal name, birth date, personal email and phone, address, emergency contact,
--     blood group, photo, and whether colleagues may see their birthday (birthday_visible);
--   * HR-owned, the person only reads them: employee code, designation, joined on, employment type, probation end, manager.
-- RLS: the person reads and edits their own row; HR (ops.can_hr()) reads and edits every row; nobody else reads any of it.
-- Viewers and partners have no profile access at all. The directory (0035) shows work-contact fields only.
-- HR opens a full record through ops.hr_profile(), which writes a row to ops.hr_access_log.

create table ops.staff_profile (
  staff_id           uuid primary key references ops.staff(id) on delete cascade,
  -- personal (the person edits)
  legal_name         text check (legal_name is null or char_length(btrim(legal_name)) between 1 and 120),
  birth_date         date check (birth_date is null or (birth_date >= date '1900-01-01' and birth_date <= current_date - 14 * 365)),
  personal_email     text check (personal_email is null or (char_length(personal_email) <= 200 and personal_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  personal_phone     text check (personal_phone is null or personal_phone ~ '^[0-9+() -]{7,20}$'),
  address            text check (address is null or char_length(btrim(address)) between 1 and 500),
  emergency_name     text check (emergency_name is null or char_length(btrim(emergency_name)) between 1 and 120),
  emergency_phone    text check (emergency_phone is null or emergency_phone ~ '^[0-9+() -]{7,20}$'),
  emergency_relation text check (emergency_relation is null or char_length(btrim(emergency_relation)) between 1 and 60),
  blood_group        text check (blood_group is null or blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  photo_path         text check (photo_path is null or char_length(photo_path) <= 300),
  birthday_visible   boolean not null default false,
  -- HR-owned (only HR changes them)
  employee_code      text unique check (employee_code is null or employee_code ~ '^[A-Za-z0-9-]{1,20}$'),
  designation        text check (designation is null or char_length(btrim(designation)) between 1 and 120),
  joined_on          date check (joined_on is null or joined_on >= date '2000-01-01'),
  employment_type    text check (employment_type is null or employment_type in ('full_time','part_time','intern','contract','consultant')),
  probation_end      date,
  manager_id         uuid references ops.staff(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references ops.staff(id) on delete set null,
  constraint staff_profile_emergency_pair check ((emergency_name is null) = (emergency_phone is null)),
  constraint staff_profile_probation_after_join check (probation_end is null or joined_on is null or probation_end >= joined_on),
  constraint staff_profile_not_own_manager check (manager_id is null or manager_id <> staff_id)
);
create index staff_profile_manager_idx on ops.staff_profile (manager_id);
create index staff_profile_updated_by_idx on ops.staff_profile (updated_by);

-- ---------------------------------------------------------------- who may have a profile of their own
create or replace function ops.is_employee() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role not in ('viewer', 'partner') from ops.staff where id = auth.uid() and is_active), false)
$$;

-- ---------------------------------------------------------------- guard: the person cannot touch HR-owned fields
create or replace function ops.staff_profile_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.staff_id <> old.staff_id then
      raise exception 'A profile cannot be moved to another person' using errcode = '42501';
    end if;
    if auth.uid() is not null and not ops.can_hr()
       and (new.employee_code, new.designation, new.joined_on, new.employment_type, new.probation_end, new.manager_id)
           is distinct from
           (old.employee_code, old.designation, old.joined_on, old.employment_type, old.probation_end, old.manager_id) then
      raise exception 'Only HR can change the employee code, designation, joined date, employment type, probation end or manager'
        using errcode = '42501';
    end if;
  end if;
  if new.manager_id is not null
     and not exists (select 1 from ops.staff where id = new.manager_id and is_active and role not in ('viewer', 'partner')) then
    raise exception 'A manager must be an active member of the team' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger t_staff_profile_guard before insert or update on ops.staff_profile
  for each row execute function ops.staff_profile_guard();

-- ---------------------------------------------------------------- every person gets an (empty) row
create or replace function ops.staff_profile_seed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into ops.staff_profile (staff_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger t_staff_profile_seed after insert on ops.staff
  for each row execute function ops.staff_profile_seed();
insert into ops.staff_profile (staff_id) select id from ops.staff on conflict do nothing;

-- ---------------------------------------------------------------- RLS
alter table ops.staff_profile enable row level security;
create policy staff_profile_sel on ops.staff_profile for select to authenticated
  using ((select ops.can_hr()) or (staff_id = (select auth.uid()) and (select ops.is_employee())));
create policy staff_profile_ins on ops.staff_profile for insert to authenticated
  with check ((select ops.can_hr()));
create policy staff_profile_upd on ops.staff_profile for update to authenticated
  using ((select ops.can_hr()) or (staff_id = (select auth.uid()) and (select ops.is_employee())))
  with check ((select ops.can_hr()) or (staff_id = (select auth.uid()) and (select ops.is_employee())));

-- ---------------------------------------------------------------- HR opens a full record (logged)
create or replace function ops.hr_profile(p_staff uuid) returns setof ops.staff_profile
language plpgsql security definer set search_path = '' as $$
begin
  if not ops.can_hr() then
    raise exception 'Only HR can open private records' using errcode = '42501';
  end if;
  perform ops.log_hr_access(p_staff, 'opened profile');
  return query select * from ops.staff_profile where staff_id = p_staff;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.is_employee(), ops.hr_profile(uuid) to authenticated, service_role;
-- Leave (docs/PLAN_EMPLOYEE_PORTAL.md, P3).
-- 1. leave_type: the policy HR sets in the app. Which types exist, days a year, carry forward (and a cap), and whether
--    weekends and holidays inside a leave count as leave days. Nothing about a type is hard-coded; the rows below are
--    only starting values that HR edits.
-- 2. leave_ledger: every change to a balance is a row (credit, carry, debit, reversal, adjustment). Rows are never
--    edited or deleted; a balance is the sum of its rows.
-- 3. leave_request: one application, with the days worked out by the database from the type's rules.
-- 4. RPCs: apply_leave, decide_leave, cancel_leave, hr_adjust_balance, credit_annual_quota, leave_balances, team_away.
-- 5. HR (ops.can_hr()) manages holidays, not only the founder.
-- 6. Approved leave shows in the month view and is not counted as absent (attendance_grid gains leave_name, leave_half).
--
-- Leave year = calendar year. A request may not span two years. Balances are enforced for types that "keep a balance";
-- the pending requests of a person count against what is available. Days on a request are fixed when it is made.

-- ---------------------------------------------------------------- who can take leave
create or replace function ops.can_take_leave() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role not in ('viewer', 'partner') from ops.staff where id = auth.uid() and is_active), false)
$$;

create or replace function ops.leave_eligible(p_staff uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role not in ('viewer', 'partner') and is_active from ops.staff where id = p_staff), false)
$$;

-- ---------------------------------------------------------------- the policy
create table ops.leave_type (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[a-z][a-z0-9_]{1,23}$'),
  name             text not null check (char_length(btrim(name)) between 1 and 60),
  paid             boolean not null default true,
  has_balance      boolean not null default true,
  annual_quota     numeric(5,1) not null default 0 check (annual_quota >= 0 and annual_quota <= 366),
  carry_forward    boolean not null default false,
  carry_cap        numeric(5,1) check (carry_cap is null or (carry_cap >= 0 and carry_cap <= 366)),
  count_weekends   boolean not null default false,
  count_holidays   boolean not null default false,
  half_day_allowed boolean not null default true,
  needs_document   boolean not null default false,
  is_active        boolean not null default true,
  sort_order       smallint not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index leave_type_name_uniq on ops.leave_type (lower(btrim(name)));

create or replace function ops.leave_type_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception 'The code of a leave type cannot change; add a new type instead';
  end if;
  new.name := btrim(new.name);
  new.updated_at := now();
  return new;
end $$;
create trigger t_leave_type_guard before insert or update on ops.leave_type
  for each row execute function ops.leave_type_guard();
create trigger t_leave_type_audit after insert or update or delete on ops.leave_type
  for each row execute function ops.audit();

insert into ops.leave_type (code, name, paid, has_balance, annual_quota, carry_forward, carry_cap, half_day_allowed, sort_order) values
  ('casual',   'Casual leave',   true,  true,  12, false, null, true, 1),
  ('sick',     'Sick leave',     true,  true,  12, false, null, true, 2),
  ('earned',   'Earned leave',   true,  true,  15, true,  30,   true, 3),
  ('comp_off', 'Comp-off',       true,  true,   0, false, null, true, 4),
  ('unpaid',   'Unpaid leave',   false, false,  0, false, null, true, 5);

-- ---------------------------------------------------------------- applications
create table ops.leave_request (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references ops.staff (id) on delete cascade,
  leave_type_id uuid not null references ops.leave_type (id),
  from_date     date not null,
  to_date       date not null,
  day_part      text not null default 'full' check (day_part in ('full', 'first_half', 'second_half')),
  days          numeric(5,1) not null check (days > 0),
  reason        text not null check (char_length(btrim(reason)) between 3 and 500),
  state         text not null default 'pending' check (state in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by    uuid references ops.staff (id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(btrim(decision_note)) between 1 and 500),
  cancelled_by  uuid references ops.staff (id) on delete set null,
  cancelled_at  timestamptz,
  created_by    uuid references ops.staff (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (to_date >= from_date),
  check (extract(year from from_date) = extract(year from to_date)),
  check (day_part = 'full' or from_date = to_date)
);
create index leave_request_staff_idx on ops.leave_request (staff_id, from_date desc);
create index leave_request_type_idx on ops.leave_request (leave_type_id);
create index leave_request_decided_by_idx on ops.leave_request (decided_by);
create index leave_request_cancelled_by_idx on ops.leave_request (cancelled_by);
create index leave_request_created_by_idx on ops.leave_request (created_by);
create index leave_request_pending_idx on ops.leave_request (created_at) where state = 'pending';
create index leave_request_approved_idx on ops.leave_request (from_date, to_date) where state = 'approved';
create trigger t_leave_request_audit after insert or update or delete on ops.leave_request
  for each row execute function ops.audit();

-- ---------------------------------------------------------------- the ledger
create table ops.leave_ledger (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references ops.staff (id) on delete cascade,
  leave_type_id uuid not null references ops.leave_type (id),
  year          smallint not null check (year between 2000 and 2200),
  entry_date    date not null default current_date,
  kind          text not null check (kind in ('credit', 'carry', 'debit', 'reversal', 'adjustment')),
  days          numeric(5,1) not null check (days <> 0),
  request_id    uuid references ops.leave_request (id),
  note          text check (note is null or char_length(note) <= 500),
  created_by    uuid references ops.staff (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (kind in ('credit', 'carry', 'reversal') and days > 0 or kind = 'debit' and days < 0 or kind = 'adjustment')
);
create index leave_ledger_balance_idx on ops.leave_ledger (staff_id, leave_type_id, year);
create index leave_ledger_type_idx on ops.leave_ledger (leave_type_id);
create index leave_ledger_request_idx on ops.leave_ledger (request_id);
create index leave_ledger_created_by_idx on ops.leave_ledger (created_by);
-- The yearly quota and the carry-over are written at most once per person, type and year.
create unique index leave_ledger_credit_once on ops.leave_ledger (staff_id, leave_type_id, year) where kind = 'credit';
create unique index leave_ledger_carry_once on ops.leave_ledger (staff_id, leave_type_id, year) where kind = 'carry';

-- ---------------------------------------------------------------- days, credits
create or replace function ops.leave_days(p_type uuid, p_from date, p_to date, p_part text default 'full') returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  t  ops.leave_type;
  wd smallint[];
  n  numeric;
begin
  select * into t from ops.leave_type where id = p_type;
  if not found then raise exception 'Unknown leave type'; end if;
  if p_from is null or p_to is null then raise exception 'Pick the dates'; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;
  select work_days into wd from ops.office_settings;
  select count(*) into n
    from generate_series(0, p_to - p_from) i
   where (t.count_weekends or extract(isodow from (p_from + i))::int = any (wd))
     and (t.count_holidays or not exists (select 1 from ops.office_holiday h where h.holiday_date = p_from + i));
  if p_part <> 'full' then n := n * 0.5; end if;
  return n;
end $$;

-- The yearly quota (and carry-over) for one person. Safe to call again: each is written once.
create or replace function ops.leave_ensure_credit(p_staff uuid, p_year int) returns void
language plpgsql security definer set search_path = '' as $$
declare cur int := extract(year from ops.today_ist())::int;
begin
  if not ops.leave_eligible(p_staff) or p_year not between cur - 1 and cur + 1 then return; end if;
  -- Carry-over only from a year the system already ran for this person (never invents a past year).
  insert into ops.leave_ledger (staff_id, leave_type_id, year, entry_date, kind, days, note)
  select p_staff, t.id, p_year, make_date(p_year, 1, 1), 'carry',
         least(b.bal, coalesce(t.carry_cap, b.bal)), 'Carried forward from ' || (p_year - 1)
    from ops.leave_type t
    cross join lateral (select coalesce(sum(l.days), 0) as bal from ops.leave_ledger l
                         where l.staff_id = p_staff and l.leave_type_id = t.id and l.year = p_year - 1) b
   where t.is_active and t.has_balance and t.carry_forward and b.bal > 0 and least(b.bal, coalesce(t.carry_cap, b.bal)) > 0
     and exists (select 1 from ops.leave_ledger c where c.staff_id = p_staff and c.leave_type_id = t.id and c.year = p_year - 1 and c.kind = 'credit')
  on conflict do nothing;
  insert into ops.leave_ledger (staff_id, leave_type_id, year, entry_date, kind, days, note)
  select p_staff, t.id, p_year, make_date(p_year, 1, 1), 'credit', t.annual_quota, 'Yearly quota'
    from ops.leave_type t
   where t.is_active and t.has_balance and t.annual_quota > 0
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------- apply
create or replace function ops.apply_leave(p_type uuid, p_from date, p_to date, p_part text, p_reason text, p_staff uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid    uuid := auth.uid();
  who    uuid := coalesce(p_staff, auth.uid());
  behalf boolean := coalesce(p_staff, auth.uid()) <> auth.uid();
  today  date := ops.today_ist();
  t      ops.leave_type;
  d      numeric;
  yr     int;
  bal    numeric;
  pend   numeric;
  rid    uuid;
begin
  if not ops.can_take_leave() then raise exception 'Leave is not available to your account'; end if;
  if behalf and not ops.can_hr() then raise exception 'Only HR can record leave for someone else' using errcode = '42501'; end if;
  if not ops.leave_eligible(who) then raise exception 'That person cannot take leave'; end if;
  if p_from is null or p_to is null then raise exception 'Pick the dates'; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;
  select * into t from ops.leave_type where id = p_type and is_active;
  if not found then raise exception 'Choose a leave type that is switched on'; end if;
  if p_part is null or p_part not in ('full', 'first_half', 'second_half') then raise exception 'Choose a whole day or a half day'; end if;
  if p_part <> 'full' and p_from <> p_to then raise exception 'A half day is for a single day'; end if;
  if p_part <> 'full' and not t.half_day_allowed then raise exception '% cannot be taken as half days', t.name; end if;
  if extract(year from p_from) <> extract(year from p_to) then
    raise exception 'Apply for one calendar year at a time: split this leave at the new year';
  end if;
  if p_to - p_from >= 90 then raise exception 'Leave can be at most 90 days in one request'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why, in a few words'; end if;
  yr := extract(year from p_from)::int;
  if yr > extract(year from today)::int + 1 then raise exception 'Leave can be booked up to the end of next year'; end if;
  if not behalf and p_from < greatest(today - 14, make_date(extract(year from today)::int, 1, 1)) then
    raise exception 'Leave can start at most 14 days back, and not in an earlier year. Ask HR to record it';
  end if;

  perform pg_advisory_xact_lock(hashtext('leave:' || who::text));
  if exists (select 1 from ops.leave_request r
              where r.staff_id = who and r.state in ('pending', 'approved')
                and r.from_date <= p_to and r.to_date >= p_from
                and not (p_part <> 'full' and r.day_part <> 'full' and r.from_date = p_from and r.day_part <> p_part)) then
    raise exception 'You already have leave on some of those dates';
  end if;

  d := ops.leave_days(p_type, p_from, p_to, p_part);
  if d <= 0 then
    raise exception 'Those dates have no days to take leave on (weekends and holidays are not counted for %)', t.name;
  end if;

  perform ops.leave_ensure_credit(who, yr);
  if t.has_balance then
    select coalesce(sum(days), 0) into bal from ops.leave_ledger where staff_id = who and leave_type_id = p_type and year = yr;
    select coalesce(sum(days), 0) into pend from ops.leave_request
     where staff_id = who and leave_type_id = p_type and state = 'pending' and extract(year from from_date) = yr;
    if d > bal - pend then
      raise exception 'Not enough % left: % day(s) available, % asked', t.name, bal - pend, d;
    end if;
  end if;

  insert into ops.leave_request (staff_id, leave_type_id, from_date, to_date, day_part, days, reason, state, decided_by, decided_at, created_by)
  values (who, p_type, p_from, p_to, p_part, d, btrim(p_reason),
          case when behalf then 'approved' else 'pending' end,
          case when behalf then uid end, case when behalf then now() end, uid)
  returning id into rid;
  if behalf and t.has_balance then
    insert into ops.leave_ledger (staff_id, leave_type_id, year, entry_date, kind, days, request_id, note, created_by)
    values (who, p_type, yr, p_from, 'debit', -d, rid, 'Recorded by HR', uid);
  end if;
  return rid;
end $$;

-- ---------------------------------------------------------------- decide, cancel
create or replace function ops.decide_leave(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r   ops.leave_request;
  t   ops.leave_type;
  yr  int;
  bal numeric;
begin
  select * into r from ops.leave_request where id = p_id for update;
  if not found then raise exception 'That leave request was not found'; end if;
  if r.staff_id = uid then raise exception 'You cannot decide your own leave' using errcode = '42501'; end if;
  if not (ops.can_hr() or ops.leads_staff(r.staff_id)) then
    raise exception 'You cannot decide this request' using errcode = '42501';
  end if;
  if r.state <> 'pending' then raise exception 'That request is already %', r.state; end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say why you are turning it down'; end if;

  if p_approve then
    select * into t from ops.leave_type where id = r.leave_type_id;
    yr := extract(year from r.from_date)::int;
    perform pg_advisory_xact_lock(hashtext('leave:' || r.staff_id::text));
    if t.has_balance then
      select coalesce(sum(days), 0) into bal from ops.leave_ledger
       where staff_id = r.staff_id and leave_type_id = r.leave_type_id and year = yr;
      if bal < r.days then raise exception 'Not enough % left (% day(s)) to approve this', t.name, bal; end if;
      insert into ops.leave_ledger (staff_id, leave_type_id, year, entry_date, kind, days, request_id, note, created_by)
      values (r.staff_id, r.leave_type_id, yr, r.from_date, 'debit', -r.days, r.id, null, uid);
    end if;
  end if;
  update ops.leave_request
     set state = case when p_approve then 'approved' else 'rejected' end,
         decided_by = uid, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = r.id;
end $$;

create or replace function ops.cancel_leave(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid   uuid := auth.uid();
  r     ops.leave_request;
  spent numeric;
begin
  select * into r from ops.leave_request where id = p_id for update;
  if not found then raise exception 'That leave request was not found'; end if;
  if r.staff_id <> uid and not ops.can_hr() then raise exception 'You cannot cancel this request' using errcode = '42501'; end if;
  if r.state not in ('pending', 'approved') then raise exception 'That request is already %', r.state; end if;
  if r.state = 'approved' and r.staff_id = uid and not ops.can_hr() and r.from_date <= ops.today_ist() then
    raise exception 'Leave that has started can only be cancelled by HR';
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || r.staff_id::text));
  select coalesce(sum(days), 0) into spent from ops.leave_ledger where request_id = r.id;
  if spent < 0 then
    insert into ops.leave_ledger (staff_id, leave_type_id, year, entry_date, kind, days, request_id, note, created_by)
    values (r.staff_id, r.leave_type_id, extract(year from r.from_date)::int, ops.today_ist(), 'reversal', -spent, r.id, 'Leave cancelled', uid);
  end if;
  update ops.leave_request set state = 'cancelled', cancelled_by = uid, cancelled_at = now() where id = r.id;
end $$;

-- ---------------------------------------------------------------- HR: adjust, start the year
create or replace function ops.hr_adjust_balance(p_staff uuid, p_type uuid, p_year int, p_days numeric, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t   ops.leave_type;
  bal numeric;
begin
  if not ops.can_hr() then raise exception 'Only HR can adjust a leave balance' using errcode = '42501'; end if;
  if not ops.leave_eligible(p_staff) then raise exception 'That person cannot take leave'; end if;
  select * into t from ops.leave_type where id = p_type;
  if not found then raise exception 'Unknown leave type'; end if;
  if not t.has_balance then raise exception '% does not keep a balance', t.name; end if;
  if p_days is null or p_days = 0 or abs(p_days) > 366 then raise exception 'Enter a number of days other than zero'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Say why, so the record is clear later'; end if;
  if p_year not between extract(year from ops.today_ist())::int - 1 and extract(year from ops.today_ist())::int + 1 then
    raise exception 'Adjust this year, last year or next year';
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || p_staff::text));
  perform ops.leave_ensure_credit(p_staff, p_year);
  select coalesce(sum(days), 0) into bal from ops.leave_ledger where staff_id = p_staff and leave_type_id = p_type and year = p_year;
  if bal + p_days < 0 then raise exception 'That would take the balance below zero (it is % now)', bal; end if;
  insert into ops.leave_ledger (staff_id, leave_type_id, year, entry_date, kind, days, note, created_by)
  values (p_staff, p_type, p_year, ops.today_ist(), 'adjustment', p_days, btrim(p_note), auth.uid());
  if p_staff <> auth.uid() then perform ops.log_hr_access(p_staff, 'adjusted leave balance'); end if;
end $$;

-- Credit everyone for a year in one go (HR's "Start the year" button). Returns how many people were looked at.
create or replace function ops.credit_annual_quota(p_year int default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  yr int := coalesce(p_year, extract(year from ops.today_ist())::int);
  n  int := 0;
  s  uuid;
begin
  if not ops.can_hr() then raise exception 'Only HR can start the leave year' using errcode = '42501'; end if;
  for s in select id from ops.staff where is_active and role not in ('viewer', 'partner') loop
    perform ops.leave_ensure_credit(s, yr);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- reads
-- One person's balances for a year. Also makes sure the yearly quota has been credited (written once).
create or replace function ops.leave_balances(p_staff uuid, p_year int default null)
returns table (leave_type_id uuid, code text, name text, paid boolean, has_balance boolean, annual_quota numeric,
               balance numeric, pending numeric, used numeric, available numeric)
language plpgsql security definer set search_path = '' as $$
declare yr int := coalesce(p_year, extract(year from ops.today_ist())::int);
begin
  if p_staff is null then raise exception 'Choose a person'; end if;
  if p_staff <> auth.uid() and not (ops.can_hr() or ops.leads_staff(p_staff)) then
    raise exception 'You cannot see that person''s leave' using errcode = '42501';
  end if;
  if not ops.leave_eligible(p_staff) then return; end if;
  perform ops.leave_ensure_credit(p_staff, yr);
  return query
  select t.id, t.code, t.name, t.paid, t.has_balance, t.annual_quota,
         coalesce((select sum(l.days) from ops.leave_ledger l where l.staff_id = p_staff and l.leave_type_id = t.id and l.year = yr), 0),
         coalesce((select sum(r.days) from ops.leave_request r where r.staff_id = p_staff and r.leave_type_id = t.id and r.state = 'pending'
                    and extract(year from r.from_date) = yr), 0),
         coalesce((select sum(r.days) from ops.leave_request r where r.staff_id = p_staff and r.leave_type_id = t.id and r.state = 'approved'
                    and extract(year from r.from_date) = yr), 0),
         case when t.has_balance then
           coalesce((select sum(l.days) from ops.leave_ledger l where l.staff_id = p_staff and l.leave_type_id = t.id and l.year = yr), 0)
           - coalesce((select sum(r.days) from ops.leave_request r where r.staff_id = p_staff and r.leave_type_id = t.id and r.state = 'pending'
                        and extract(year from r.from_date) = yr), 0)
         end
    from ops.leave_type t
   where t.is_active or exists (select 1 from ops.leave_ledger l where l.staff_id = p_staff and l.leave_type_id = t.id and l.year = yr)
   order by t.sort_order, t.name;
end $$;

-- Who is away between two dates. Everyone sees names of people in their own departments; the leave type is shown only to
-- the person's lead, HR and the founder. HR and the founder see everyone.
create or replace function ops.team_away(p_from date, p_to date)
returns table (request_id uuid, staff_id uuid, full_name text, leave_type text, from_date date, to_date date, day_part text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not ops.is_internal() then raise exception 'Not available to your account' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 93 then
    raise exception 'Pick a range of at most 93 days';
  end if;
  return query
  select r.id, s.id, s.full_name,
         case when ops.can_hr() or ops.leads_staff(s.id) then t.name end,
         r.from_date, r.to_date, r.day_part
    from ops.leave_request r
    join ops.staff s on s.id = r.staff_id
    join ops.leave_type t on t.id = r.leave_type_id
   where r.state = 'approved' and r.from_date <= p_to and r.to_date >= p_from and s.is_active
     and (ops.can_hr() or s.id = auth.uid() or ops.leads_staff(s.id) or s.departments && ops.my_departments())
   order by r.from_date, s.full_name;
end $$;

-- ---------------------------------------------------------------- the month view knows about leave
drop function ops.attendance_month(uuid, date);
drop function ops.attendance_grid(date, date, uuid);

create or replace function ops.attendance_grid(p_from date, p_to date, p_staff uuid)
returns table (
  staff_id uuid, work_date date, expected boolean, holiday text,
  first_in timestamptz, last_out timestamptz, minutes integer,
  is_late boolean, late_minutes integer, left_early boolean, early_minutes integer,
  is_open boolean, missing_checkout boolean, off_network_out boolean, manual boolean,
  mark text, mark_reason text, remote boolean, tracked boolean, leave_name text, leave_half boolean)
language sql stable set search_path = '' as $$
  select st.id, d.dt,
         (extract(isodow from d.dt)::int = any (cfg.work_days) and h.id is null and (lv.name is null or lv.half)),
         h.name,
         a.first_in, a.last_out, coalesce(a.minutes, 0),
         coalesce(a.is_late, false), coalesce(a.late_minutes, 0), coalesce(a.left_early, false), coalesce(a.early_minutes, 0),
         coalesce(a.is_open, false), coalesce(a.missing, false), coalesce(a.off_out, false), coalesce(a.manual, false),
         m.kind, m.reason, coalesce(a.remote, st.attendance_mode = 'remote'), d.dt >= st.office_since,
         case when extract(isodow from d.dt)::int = any (cfg.work_days) and h.id is null then lv.name end,
         coalesce(lv.half, false)
    from ops.staff st
    cross join ops.office_settings cfg
    cross join lateral (select g::date as dt from generate_series(p_from, p_to, interval '1 day') g) d
    left join ops.office_holiday h on h.holiday_date = d.dt
    left join lateral (
      select min(x.check_in_at) as first_in,
             max(x.check_out_at) as last_out,
             coalesce(sum(extract(epoch from (x.check_out_at - x.check_in_at)) / 60) filter (where x.check_out_at is not null), 0)::integer as minutes,
             bool_or(x.is_late) as is_late,
             max(x.late_minutes) as late_minutes,
             (array_agg(x.left_early order by x.check_in_at desc))[1] as left_early,
             (array_agg(x.early_minutes order by x.check_in_at desc))[1] as early_minutes,
             bool_or(x.check_out_at is null and not x.missing_checkout) as is_open,
             bool_or(x.missing_checkout) as missing,
             bool_or(x.out_source = 'off_network') as off_out,
             bool_or(x.in_source = 'manual') as manual,
             bool_or(x.in_source = 'remote') as remote
        from ops.attendance_session x
       where x.staff_id = st.id and x.work_date = d.dt) a on true
    left join ops.attendance_day_mark m on m.staff_id = st.id and m.mark_date = d.dt
    left join lateral (
      select t.name, (q.day_part <> 'full') as half
        from ops.leave_request q join ops.leave_type t on t.id = q.leave_type_id
       where q.staff_id = st.id and q.state = 'approved' and d.dt between q.from_date and q.to_date
       order by (q.day_part = 'full') desc limit 1) lv on true
   where st.works_from_office and st.is_active
     and ops.sees_attendance(st.id)
     and (p_staff is null or st.id = p_staff)
   order by st.full_name, d.dt
$$;

create or replace function ops.attendance_month(p_staff uuid, p_month date)
returns table (
  staff_id uuid, work_date date, expected boolean, holiday text,
  first_in timestamptz, last_out timestamptz, minutes integer,
  is_late boolean, late_minutes integer, left_early boolean, early_minutes integer,
  is_open boolean, missing_checkout boolean, off_network_out boolean, manual boolean,
  mark text, mark_reason text, remote boolean, tracked boolean, leave_name text, leave_half boolean)
language plpgsql stable set search_path = '' as $$
declare first_day date := date_trunc('month', p_month)::date;
begin
  if p_staff is null or p_month is null then raise exception 'Choose a person and a month'; end if;
  return query
  select * from ops.attendance_grid(first_day, (first_day + interval '1 month - 1 day')::date, p_staff);
end $$;

-- ---------------------------------------------------------------- holidays are HR's too
drop policy office_holiday_ins on ops.office_holiday;
create policy office_holiday_ins on ops.office_holiday for insert to authenticated
  with check ((select ops.can_hr()));
drop policy office_holiday_upd on ops.office_holiday;
create policy office_holiday_upd on ops.office_holiday for update to authenticated
  using ((select ops.can_hr())) with check ((select ops.can_hr()));
drop policy office_holiday_del on ops.office_holiday;
create policy office_holiday_del on ops.office_holiday for delete to authenticated
  using ((select ops.can_hr()));

-- ---------------------------------------------------------------- access
alter table ops.leave_type enable row level security;
create policy leave_type_sel on ops.leave_type for select to authenticated
  using ((select ops.is_internal()));
create policy leave_type_ins on ops.leave_type for insert to authenticated
  with check ((select ops.can_hr()));
create policy leave_type_upd on ops.leave_type for update to authenticated
  using ((select ops.can_hr())) with check ((select ops.can_hr()));

alter table ops.leave_request enable row level security;
create policy leave_request_sel on ops.leave_request for select to authenticated
  using ((select ops.leads_staff(staff_id)) or (select ops.can_hr()));

alter table ops.leave_ledger enable row level security;
create policy leave_ledger_sel on ops.leave_ledger for select to authenticated
  using ((select ops.leads_staff(staff_id)) or (select ops.can_hr()));

-- Requests and the ledger change only through the functions above; types are never deleted (switch them off).
revoke insert, update, delete on ops.leave_request, ops.leave_ledger from authenticated;
revoke delete on ops.leave_type from authenticated;

revoke execute on all functions in schema ops from public;
grant execute on function ops.can_take_leave(), ops.leave_days(uuid, date, date, text),
  ops.apply_leave(uuid, date, date, text, text, uuid), ops.decide_leave(uuid, boolean, text), ops.cancel_leave(uuid),
  ops.hr_adjust_balance(uuid, uuid, int, numeric, text), ops.credit_annual_quota(int), ops.leave_balances(uuid, int),
  ops.team_away(date, date), ops.attendance_grid(date, date, uuid), ops.attendance_month(uuid, date)
  to authenticated, service_role;
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
-- Employee portal P5: the staff directory (docs/PLAN_EMPLOYEE_PORTAL.md, section 6, row 0035).
-- Work-contact fields only: name, work email, work phone, role, departments, designation, manager.
-- The plan asked for a security_invoker view, but a view cannot read ops.staff_profile for the caller (its RLS lets a
-- person see only their own row). A security definer function returns exactly the work columns instead, and only to
-- active team members (not viewers or partners). Personal fields never leave ops.staff_profile except through RLS.
-- Birthdays are shown only for people who ticked birthday_visible; the year of birth is never returned.

create or replace function ops.directory() returns table (
  staff_id     uuid,
  full_name    text,
  email        text,
  phone        text,
  role         ops.app_role,
  departments  ops.department[],
  designation  text,
  manager_id   uuid,
  manager_name text
)
language sql stable security definer set search_path = '' as $$
  select s.id, s.full_name, s.email, s.phone, s.role, s.departments, p.designation, p.manager_id, m.full_name
    from ops.staff s
    left join ops.staff_profile p on p.staff_id = s.id
    left join ops.staff m on m.id = p.manager_id
   where ops.is_employee() and s.is_active and s.role <> 'partner'
   order by s.full_name
$$;

-- Birthdays (only when the person agreed) and work anniversaries (from the joined date) in one month.
create or replace function ops.directory_events(p_month int) returns table (
  staff_id  uuid,
  full_name text,
  kind      text,
  day       int,
  years     int
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_month is null or p_month not between 1 and 12 then
    raise exception 'The month must be between 1 and 12' using errcode = 'P0001';
  end if;
  if not ops.is_employee() then return; end if;
  return query
    select s.id, s.full_name, 'birthday'::text, extract(day from p.birth_date)::int, null::int
      from ops.staff s join ops.staff_profile p on p.staff_id = s.id
     where s.is_active and s.role <> 'partner' and p.birthday_visible and p.birth_date is not null
       and extract(month from p.birth_date) = p_month
    union all
    select s.id, s.full_name, 'anniversary'::text, extract(day from p.joined_on)::int,
           extract(year from current_date)::int - extract(year from p.joined_on)::int
      from ops.staff s join ops.staff_profile p on p.staff_id = s.id
     where s.is_active and s.role <> 'partner' and p.joined_on is not null
       and extract(month from p.joined_on) = p_month
       and extract(year from current_date)::int - extract(year from p.joined_on)::int >= 1
    order by 4, 2;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.directory(), ops.directory_events(int) to authenticated, service_role;
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
-- 0038: shared tasks (one task, several owners), read-only access to a parent task for the people holding its
-- subtasks, and a counts-only progress summary for a group of per-person copies.
--
-- 1. ops.task.shared + ops.task_owner: ONE task row with several owners, finished when ANY owner finishes it.
--    The "each does their own" model (a copy per person linked by group_id, 0028) is unchanged. For a shared task
--    assignee_id is the primary (first) owner, and every owner including the primary has a task_owner row.
--    Owners are written only by ops.create_shared_task / add_task_owner / remove_task_owner (no DML policy).
-- 2. A co-owner counts as an assignee: sees the task, may update its status, accept it, comment, track time, is
--    watching it, is notified of changes and gets due and overdue reminders. A department lead who leads a
--    co-owner manages a department-less shared task, just as for a primary assignee.
-- 3. The assignee or a co-owner of a SUBTASK can read the parent and the sibling subtasks (task rows only).
--    Comments, history, watchers and time on those tasks stay hidden: those tables now ask ops.sees_task_fully(),
--    which is the task read rule WITHOUT the subtask-holder path. Nothing about UPDATE or DELETE widens.
-- 4. ops.task_group_progress(group): counts only, for anyone who can see at least one copy of the group.

-- ---------------------------------------------------------------- columns and table
alter table ops.task add column shared boolean not null default false;
alter table ops.task add constraint task_shared_no_group check (not shared or group_id is null);

create table ops.task_owner (
  task_id  uuid not null references ops.task (id) on delete cascade,
  staff_id uuid not null references ops.staff (id) on delete cascade,
  added_by uuid references ops.staff (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (task_id, staff_id)
);
create index task_owner_staff_idx on ops.task_owner (staff_id);
create index task_owner_added_by_idx on ops.task_owner (added_by);

-- ---------------------------------------------------------------- helpers
create or replace function ops.is_task_owner(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.task_owner o where o.task_id = p_task and o.staff_id = auth.uid())
$$;

-- A department lead who leads at least one owner (never counting themselves) of a shared task.
create or replace function ops.leads_task_owners(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select ops.my_role() = 'dept_lead'
     and exists (select 1 from ops.task_owner o join ops.staff s on s.id = o.staff_id
                 where o.task_id = p_task and o.staff_id <> auth.uid()
                   and s.departments && ops.my_departments())
$$;

-- Does the caller hold (as assignee or co-owner) a subtask of this parent?
create or replace function ops.holds_subtask_of(p_parent uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.task c
                 where c.parent_task_id = p_parent
                   and (c.assignee_id = auth.uid()
                        or exists (select 1 from ops.task_owner o where o.task_id = c.id and o.staff_id = auth.uid())))
$$;

-- The full task read rule: everything task_sel allows except the subtask-holder paths. Comments, history,
-- watchers, owners and time hang off this, so reading a parent through a subtask never opens them.
create or replace function ops.sees_task_fully(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.task t
                 where t.id = p_task
                   and (t.department = any (ops.my_departments())
                        or t.assignee_id = auth.uid()
                        or t.created_by = auth.uid()
                        or ops.is_watching(t.id)
                        or ops.is_task_owner(t.id)
                        or (t.department is null
                            and (ops.is_founder() or ops.leads_task_assignee(t.assignee_id) or ops.leads_task_owners(t.id)))))
$$;

-- Who may be given a task (same rules the guard applies to the primary assignee).
create or replace function ops.check_task_person(p_staff uuid, p_template text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare a record;
begin
  select s.role, s.is_active into a from ops.staff s where s.id = p_staff;
  if not found or not a.is_active then raise exception 'Choose an active team member to assign this task to'; end if;
  if a.role = 'viewer' then raise exception 'A viewer cannot be given tasks'; end if;
  if a.role = 'partner' and coalesce(p_template, '') <> 'follow_up' then
    raise exception 'Partners can only be given follow-up tasks';
  end if;
end $$;

create or replace function ops.task_manager(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ops.task t
                 where t.id = p_task
                   and (ops.is_founder()
                        or t.created_by = auth.uid()
                        or (ops.my_role() = 'dept_lead'
                            and (ops.in_dept(t.department)
                                 or (t.department is null
                                     and (ops.leads_task_assignee(t.assignee_id) or ops.leads_task_owners(t.id)))))))
$$;

-- ---------------------------------------------------------------- policies on ops.task
drop policy task_sel on ops.task;
create policy task_sel on ops.task for select to authenticated
  using (department = any ((select ops.my_departments())::ops.department[])
         or assignee_id = (select auth.uid())
         or created_by = (select auth.uid())
         or (select ops.is_watching(id))
         or (select ops.is_task_owner(id))
         or (department is null and ((select ops.is_founder()) or (select ops.leads_task_assignee(assignee_id))
                                     or (select ops.leads_task_owners(id))))
         or (select ops.holds_subtask_of(id))
         or (parent_task_id is not null and (select ops.holds_subtask_of(parent_task_id))));

drop policy task_upd on ops.task;
create policy task_upd on ops.task for update to authenticated
  using ((select ops.can_write())
         and (department = any ((select ops.my_departments())::ops.department[])
              or assignee_id = (select auth.uid())
              or created_by = (select auth.uid())
              or (select ops.is_task_owner(id))
              or (department is null and ((select ops.is_founder()) or (select ops.leads_task_assignee(assignee_id))
                                          or (select ops.leads_task_owners(id))))))
  with check ((select ops.can_write())
         and (department = any ((select ops.my_departments())::ops.department[])
              or assignee_id = (select auth.uid())
              or created_by = (select auth.uid())
              or (select ops.is_task_owner(id))
              or (department is null and ((select ops.is_founder()) or (select ops.leads_task_assignee(assignee_id))
                                          or (select ops.leads_task_owners(id))))));

drop policy task_del on ops.task;
create policy task_del on ops.task for delete to authenticated
  using (((department = any ((select ops.my_departments())::ops.department[]))
          and (select ops.my_role()) in ('founder', 'dept_lead'))
         or (department is null and (select ops.is_founder()))
         or (department is null and (select ops.leads_task_assignee(assignee_id)))
         or (department is null and (select ops.leads_task_owners(id))));

-- ---------------------------------------------------------------- policies on tables that hang off a task
alter table ops.task_owner enable row level security;
create policy task_owner_sel on ops.task_owner for select to authenticated
  using ((select ops.sees_task_fully(task_id)));

drop policy task_history_sel on ops.task_history;
create policy task_history_sel on ops.task_history for select to authenticated
  using ((select ops.sees_task_fully(task_id)));

drop policy task_comment_sel on ops.task_comment;
create policy task_comment_sel on ops.task_comment for select to authenticated
  using ((select ops.sees_task_fully(task_id)));
drop policy task_comment_ins on ops.task_comment;
create policy task_comment_ins on ops.task_comment for insert to authenticated
  with check ((select ops.can_write())
              and author_id = (select auth.uid())
              and (select ops.sees_task_fully(task_id)));

drop policy task_watcher_sel on ops.task_watcher;
create policy task_watcher_sel on ops.task_watcher for select to authenticated
  using ((select ops.sees_task_fully(task_id)));
drop policy task_watcher_ins on ops.task_watcher;
create policy task_watcher_ins on ops.task_watcher for insert to authenticated
  with check ((select ops.can_write())
              and (select ops.sees_task_fully(task_id))
              and (staff_id = (select auth.uid()) or (select ops.task_manager(task_id))));

drop policy time_entry_ins on ops.time_entry;
create policy time_entry_ins on ops.time_entry for insert to authenticated
  with check ((select ops.can_track_time())
              and staff_id = (select auth.uid())
              and (select ops.sees_task_fully(task_id)));

-- ---------------------------------------------------------------- guard (0028 plus shared tasks)
create or replace function ops.task_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid     uuid := case when ops.is_system() then null else auth.uid() end;
  mgr     boolean;
  a       record;
  p       record;
  rpc     boolean := coalesce(current_setting('ops.task_rpc', true), '') = '1';
begin
  new.title := btrim(new.title);
  if new.title = '' then raise exception 'A task needs a title'; end if;
  if new.due_date is null then new.due_time := null; end if;
  if new.start_date is not null and new.due_date is not null and new.start_date > new.due_date then
    raise exception 'The start date cannot be after the deadline';
  end if;

  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    select s.role, s.is_active into a from ops.staff s where s.id = new.assignee_id;
    if not found or not a.is_active then raise exception 'Choose an active team member to assign this task to'; end if;
    if a.role = 'viewer' then raise exception 'A viewer cannot be given tasks'; end if;
    if a.role = 'partner' and coalesce(new.template, '') <> 'follow_up' then
      raise exception 'Partners can only be given follow-up tasks';
    end if;
  end if;

  if new.parent_task_id is not null and (tg_op = 'INSERT' or new.parent_task_id is distinct from old.parent_task_id) then
    if new.parent_task_id = new.id then raise exception 'A task cannot be its own subtask'; end if;
    select t.parent_task_id, t.status into p from ops.task t where t.id = new.parent_task_id;
    if not found then raise exception 'The parent task was not found'; end if;
    if p.parent_task_id is not null then raise exception 'A subtask cannot have subtasks'; end if;
    if p.status in ('done', 'cancelled') then raise exception 'Add subtasks to an open task'; end if;
    if tg_op = 'UPDATE' and exists (select 1 from ops.task c where c.parent_task_id = new.id) then
      raise exception 'A task with subtasks cannot become a subtask';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'todo' then raise exception 'A new task starts as To do'; end if;
    if uid is not null then new.created_by := uid; end if;
    new.completed_at := null;
    new.completed_by := null;
    new.blocked_reason := null;
    new.cancel_reason := null;
    if uid is not null then
      new.recurrence_id := null;
      new.period_start := null;
    end if;
    if not rpc then
      new.group_id := null;
      new.shared := false;
    end if;
    if uid is not null or new.assignee_id is null then new.accepted_at := null; end if;
    if new.assignee_id is not null then
      new.assigned_by := coalesce(uid, new.created_by);
      new.assigned_at := now();
      if new.assignee_id = uid then new.accepted_at := now(); end if;
    else
      new.assigned_by := null;
      new.assigned_at := null;
    end if;
    return new;
  end if;

  -- stamps are never taken from the caller
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.assigned_by := old.assigned_by;
  new.assigned_at := old.assigned_at;
  new.completed_at := old.completed_at;
  new.completed_by := old.completed_by;
  new.recurrence_id := old.recurrence_id;
  new.period_start := old.period_start;
  new.group_id := old.group_id;
  new.shared := old.shared;

  mgr := uid is null
         or ops.is_founder()
         or old.created_by = uid
         or (ops.my_role() = 'dept_lead'
             and (ops.in_dept(old.department)
                  or (old.department is null
                      and (ops.leads_task_assignee(old.assignee_id) or ops.leads_task_owners(old.id)))));

  if not mgr and (new.title is distinct from old.title
                  or new.description is distinct from old.description
                  or new.department is distinct from old.department
                  or new.category is distinct from old.category
                  or new.entity_type is distinct from old.entity_type
                  or new.entity_id is distinct from old.entity_id
                  or new.parent_task_id is distinct from old.parent_task_id) then
    raise exception 'Only the person who created this task, a department lead or a founder can edit its details';
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    if old.shared then
      -- owners of a shared task change only through its owner list, which keeps the stamps
      if not rpc then raise exception 'Change who owns a shared task from its list of owners'; end if;
      new.assigned_by := old.assigned_by;
      new.assigned_at := old.assigned_at;
      new.accepted_at := old.accepted_at;
    else
      if not mgr
         and not (new.assignee_id is null and old.assignee_id = uid)
         and not (old.assignee_id is null and new.assignee_id = uid) then
        raise exception 'Only the person who assigned this task, a department lead or a founder can reassign it';
      end if;
      new.assigned_by := uid;
      new.assigned_at := case when new.assignee_id is null then null else now() end;
      new.accepted_at := case when new.assignee_id is not null and new.assignee_id = uid then now() else null end;
    end if;
  elsif new.accepted_at is distinct from old.accepted_at then
    if new.accepted_at is null then
      new.accepted_at := old.accepted_at;
    elsif uid is not null and uid is distinct from new.assignee_id and not (new.shared and ops.is_task_owner(new.id)) then
      raise exception 'Only the assignee can accept a task';
    else
      new.accepted_at := coalesce(old.accepted_at, now());
    end if;
  end if;

  if new.status is distinct from old.status then
    if old.status in ('done', 'cancelled') and not (mgr or old.completed_by = uid) then
      raise exception 'Only a lead, a founder, or the person who created or finished this task can reopen it';
    end if;
    if old.status = 'done' and new.status not in ('todo', 'doing') then
      raise exception 'A finished task can only be reopened';
    end if;
    if old.status = 'cancelled' and new.status <> 'todo' then
      raise exception 'A cancelled task can only be reopened';
    end if;
    if new.status = 'blocked' and coalesce(btrim(new.blocked_reason), '') = '' then
      raise exception 'Say what is blocking this task';
    end if;
    if new.status = 'cancelled' and coalesce(btrim(new.cancel_reason), '') = '' then
      raise exception 'Say why the task is cancelled';
    end if;
    if new.status in ('done', 'cancelled')
       and exists (select 1 from ops.task c where c.parent_task_id = new.id and c.status in ('todo', 'doing', 'blocked')) then
      raise exception 'Finish or cancel the subtasks first';
    end if;
    if new.status = 'done' then
      new.completed_at := now();
      new.completed_by := uid;
    elsif old.status = 'done' then
      new.completed_at := null;
      new.completed_by := null;
    end if;
    if new.status in ('doing', 'done') and new.accepted_at is null and uid is not null
       and ((new.assignee_id is not null and new.assignee_id = uid) or (new.shared and ops.is_task_owner(new.id))) then
      new.accepted_at := now();
    end if;
  end if;

  if new.status <> 'blocked' then new.blocked_reason := null; end if;
  if new.status <> 'cancelled' then new.cancel_reason := null; end if;
  return new;
end $$;

-- ---------------------------------------------------------------- notifications (0019 plus co-owners)
-- A shared task's assignee change (the primary moving to another owner) is announced by the owner RPCs instead.
create or replace function ops.task_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid   uuid := case when ops.is_system() then null else auth.uid() end;
  who   text := coalesce((select full_name from ops.staff where id = uid), 'Someone');
  t     text := left(new.title, 80);
  what  text;
  r     uuid;
begin
  if tg_op = 'INSERT' then
    perform ops.auto_watch(new.id, new.created_by, null);
    if new.assignee_id is not null then
      perform ops.auto_watch(new.id, new.assignee_id, uid);
      if uid is null then
        perform ops.notify(new.assignee_id, 'recurring', new.id, null, 'Your fixed task is ready: ' || t);
      else
        perform ops.notify(new.assignee_id, 'assigned', new.id, uid, who || ' gave you a task: ' || t);
      end if;
    end if;
    return new;
  end if;

  if new.assignee_id is distinct from old.assignee_id and not new.shared then
    if new.assignee_id is not null then
      perform ops.auto_watch(new.id, new.assignee_id, uid);
      perform ops.notify(new.assignee_id, 'assigned', new.id, uid, who || ' gave you a task: ' || t);
    end if;
    perform ops.notify(old.assignee_id, 'assigned', new.id, uid, who || ' took you off: ' || t);
  end if;

  if new.status is distinct from old.status then
    what := case new.status
      when 'done' then 'marked it done'
      when 'doing' then case when old.status in ('done', 'cancelled') then 'reopened it' else 'started it' end
      when 'blocked' then 'marked it blocked: ' || coalesce(new.blocked_reason, '')
      when 'cancelled' then 'cancelled it: ' || coalesce(new.cancel_reason, '')
      else case when old.status in ('done', 'cancelled') then 'reopened it' else 'moved it back to to do' end
    end;
    for r in select w.staff_id from ops.task_watcher w where w.task_id = new.id
             union select o.staff_id from ops.task_owner o where o.task_id = new.id loop
      perform ops.notify(r, 'status', new.id, uid, who || ' ' || what || ' (' || t || ')');
    end loop;
  end if;

  if new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time
     or new.start_date is distinct from old.start_date then
    for r in select w.staff_id from ops.task_watcher w where w.task_id = new.id
             union select o.staff_id from ops.task_owner o where o.task_id = new.id loop
      perform ops.notify(r, 'dates', new.id, uid,
        who || ' changed the dates of ' || t || ': ' ||
        coalesce(to_char(new.start_date, 'DD Mon'), 'no start') || ' to ' || coalesce(to_char(new.due_date, 'DD Mon'), 'no deadline'));
    end loop;
  end if;
  return new;
end $$;

create or replace function ops.task_comment_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text := coalesce((select full_name from ops.staff where id = new.author_id), 'Someone');
  t   text := (select left(title, 80) from ops.task where id = new.task_id);
  r   uuid;
begin
  perform ops.auto_watch(new.task_id, new.author_id, new.author_id);
  foreach r in array new.mentions loop
    perform ops.auto_watch(new.task_id, r, new.author_id);
    perform ops.notify(r, 'mentioned', new.task_id, new.author_id, who || ' mentioned you on ' || t);
  end loop;
  for r in select x.staff_id
             from (select w.staff_id from ops.task_watcher w where w.task_id = new.task_id
                   union select o.staff_id from ops.task_owner o where o.task_id = new.task_id) x
            where x.staff_id <> new.author_id and not (x.staff_id = any (new.mentions)) loop
    perform ops.notify(r, 'comment', new.task_id, new.author_id, who || ' commented on ' || t);
  end loop;
  return new;
end $$;

-- Due today and overdue reminders reach every owner of a shared task, not only the primary.
create or replace function ops.run_task_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  r     record;
  w     uuid;
  sent  integer := 0;
begin
  for r in select id, left(title, 80) as t, assignee_id, due_date from ops.task
           where status in ('todo', 'doing', 'blocked') and assignee_id is not null
             and due_date <= today and due_date >= today - 60 loop
    if r.due_date = today then
      for w in select r.assignee_id union select o.staff_id from ops.task_owner o where o.task_id = r.id loop
        if ops.notify(w, 'due_today', r.id, null, 'Due today: ' || r.t, 'due:' || r.id || ':' || r.due_date) then
          sent := sent + 1;
        end if;
      end loop;
    else
      for w in select r.assignee_id
               union select o.staff_id from ops.task_owner o where o.task_id = r.id
               union select k.staff_id from ops.task_watcher k where k.task_id = r.id loop
        if ops.notify(w, 'overdue', r.id, null,
                      'Overdue since ' || to_char(r.due_date, 'DD Mon') || ': ' || r.t, 'overdue:' || r.id || ':' || r.due_date) then
          sent := sent + 1;
        end if;
      end loop;
    end if;
  end loop;
  return sent;
end $$;

-- ---------------------------------------------------------------- shared task RPCs
-- Same parameters as create_task_group. One task, 2 to 20 people, the first is the primary owner.
create or replace function ops.create_shared_task(
  title text,
  assignees uuid[],
  description text default null,
  priority integer default 3,
  due_date date default null,
  due_time time default null,
  start_date date default null,
  estimate_minutes integer default null,
  department ops.department default null,
  category text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare
  uid    uuid := auth.uid();
  ppl    uuid[];
  who    uuid;
  tid    uuid;
  nm     text;
  was    text := coalesce(current_setting('ops.task_rpc', true), '');
begin
  if uid is null or not ops.can_write() or not ops.is_internal() then
    raise exception 'Your role cannot create tasks for the team';
  end if;
  if coalesce(btrim(title), '') = '' then raise exception 'A task needs a title'; end if;

  select array_agg(x.a order by x.first_at) into ppl
    from (select a, min(o) as first_at from unnest(assignees) with ordinality u(a, o) where a is not null group by a) x;
  if ppl is null or cardinality(ppl) < 2 then raise exception 'A shared task needs at least two people'; end if;
  if cardinality(ppl) > 20 then raise exception 'A task can be shared by at most 20 people'; end if;
  foreach who in array ppl loop
    perform ops.check_task_person(who, null);
  end loop;

  perform set_config('ops.task_rpc', '1', true);
  insert into ops.task (title, description, priority, due_date, due_time, start_date, estimate_minutes,
                        department, category, assignee_id, shared)
  values (title, description, priority, due_date, due_time, start_date, estimate_minutes,
          department, category, ppl[1], true)
  returning id into tid;

  insert into ops.task_owner (task_id, staff_id, added_by) select tid, x, uid from unnest(ppl) x;

  nm := coalesce((select s.full_name from ops.staff s where s.id = uid), 'Someone');
  foreach who in array ppl[2:cardinality(ppl)] loop
    perform ops.auto_watch(tid, who, uid);
    perform ops.notify(who, 'assigned', tid, uid, nm || ' gave you a shared task: ' || left(title, 80));
    insert into ops.task_history (task_id, actor_id, kind, to_value)
    select tid, uid, 'assigned', s.full_name from ops.staff s where s.id = who;
  end loop;

  if uid = any (ppl) then
    update ops.task t set accepted_at = now() where t.id = tid and t.accepted_at is null;
  end if;
  perform set_config('ops.task_rpc', was, true);
  return tid;
end $$;

create or replace function ops.add_task_owner(p_task uuid, p_staff uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t   record;
  n   integer;
  nm  text;
begin
  select x.title, x.shared, x.status, x.template into t from ops.task x where x.id = p_task;
  if not found then raise exception 'The task was not found'; end if;
  if uid is null or not ops.can_write() or not ops.task_manager(p_task) then
    raise exception 'Only the person who created this task, a department lead or a founder can change its owners';
  end if;
  if not t.shared then raise exception 'This task is not shared'; end if;
  if t.status in ('done', 'cancelled') then raise exception 'Reopen the task before changing its owners'; end if;
  if exists (select 1 from ops.task_owner o where o.task_id = p_task and o.staff_id = p_staff) then
    raise exception 'That person already owns this task';
  end if;
  select count(*) into n from ops.task_owner o where o.task_id = p_task;
  if n >= 20 then raise exception 'A task can be shared by at most 20 people'; end if;
  perform ops.check_task_person(p_staff, t.template);

  insert into ops.task_owner (task_id, staff_id, added_by) values (p_task, p_staff, uid);
  nm := coalesce((select s.full_name from ops.staff s where s.id = uid), 'Someone');
  perform ops.auto_watch(p_task, p_staff, uid);
  perform ops.notify(p_staff, 'assigned', p_task, uid, nm || ' gave you a shared task: ' || left(t.title, 80));
  insert into ops.task_history (task_id, actor_id, kind, to_value)
  select p_task, uid, 'assigned', s.full_name from ops.staff s where s.id = p_staff;
end $$;

create or replace function ops.remove_task_owner(p_task uuid, p_staff uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t   record;
  n   integer;
  nxt uuid;
  nm  text;
  was text := coalesce(current_setting('ops.task_rpc', true), '');
begin
  select x.title, x.shared, x.status, x.assignee_id, x.created_by into t from ops.task x where x.id = p_task;
  if not found then raise exception 'The task was not found'; end if;
  if uid is null or not ops.can_write() or not ops.task_manager(p_task) then
    raise exception 'Only the person who created this task, a department lead or a founder can change its owners';
  end if;
  if not t.shared then raise exception 'This task is not shared'; end if;
  if t.status in ('done', 'cancelled') then raise exception 'Reopen the task before changing its owners'; end if;
  if not exists (select 1 from ops.task_owner o where o.task_id = p_task and o.staff_id = p_staff) then
    raise exception 'That person does not own this task';
  end if;
  select count(*) into n from ops.task_owner o where o.task_id = p_task;
  if n <= 2 then raise exception 'A shared task needs at least two owners'; end if;

  delete from ops.task_owner o where o.task_id = p_task and o.staff_id = p_staff;
  if p_staff is distinct from t.created_by then
    delete from ops.task_watcher w where w.task_id = p_task and w.staff_id = p_staff;
  end if;

  if t.assignee_id = p_staff then
    select o.staff_id into nxt from ops.task_owner o where o.task_id = p_task order by o.added_at, o.staff_id limit 1;
    perform set_config('ops.task_rpc', '1', true);
    update ops.task x set assignee_id = nxt where x.id = p_task;
    perform set_config('ops.task_rpc', was, true);
  else
    insert into ops.task_history (task_id, actor_id, kind, from_value)
    select p_task, uid, 'assigned', s.full_name from ops.staff s where s.id = p_staff;
  end if;

  nm := coalesce((select s.full_name from ops.staff s where s.id = uid), 'Someone');
  perform ops.notify(p_staff, 'assigned', p_task, uid, nm || ' took you off: ' || left(t.title, 80));
end $$;

-- ---------------------------------------------------------------- group progress (counts only)
-- total = done + open (cancelled copies are left out). Overdue means open with a deadline before today (India).
create or replace function ops.task_group_progress(p_group uuid)
returns table (total integer, done integer, open integer, overdue integer, people integer)
language sql stable security definer set search_path = '' as $$
  select (count(*) filter (where t.status <> 'cancelled'))::integer,
         (count(*) filter (where t.status = 'done'))::integer,
         (count(*) filter (where t.status in ('todo', 'doing', 'blocked')))::integer,
         (count(*) filter (where t.status in ('todo', 'doing', 'blocked') and t.due_date < ops.today_ist()))::integer,
         (count(distinct t.assignee_id) filter (where t.status <> 'cancelled'))::integer
    from ops.task t
   where t.group_id = p_group
  having coalesce(bool_or(ops.sees_task_fully(t.id)), false)
$$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.is_task_owner(uuid), ops.leads_task_owners(uuid), ops.holds_subtask_of(uuid),
                          ops.sees_task_fully(uuid), ops.task_manager(uuid),
                          ops.create_shared_task(text, uuid[], text, integer, date, time, date, integer, ops.department, text),
                          ops.add_task_owner(uuid, uuid), ops.remove_task_owner(uuid, uuid),
                          ops.task_group_progress(uuid) to authenticated, service_role;
-- 0039: files on tasks (docs/BUSINESS_RULES.md "Task files").
-- 1. A private Storage bucket `task-files`: 25 MB per file, images and documents only. Object path is
--    `<task id>/<uuid>/<safe file name>`. The browser uploads straight to Storage with a signed upload URL; the
--    server then checks the real bytes and calls ops.register_task_attachment(). A file that was never registered is
--    just an object nobody can see in the app.
-- 2. ops.task_attachment: one row per registered file, optionally tied to a comment, optionally an inline image
--    (shown inside the description). Written only through the RPCs below. Removing is a soft delete that anyone
--    who may edit the task can undo until ops.purge_task_attachments() makes it final.
-- 3. ops.task.attachment_count and comment_count, kept by triggers, so a card never has to count rows.
-- 4. ops.task_file_orphan: paths whose row is gone (purged, or the task was deleted). A service job removes
--    the objects from Storage, then calls ops.ack_task_file_orphans().
-- 5. Storage rules call ops.task_file_object_ok() so they live in one place and are tested in PGlite.

-- ---------------------------------------------------------------- who may edit a task (mirrors task_upd)
create or replace function ops.can_edit_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select ops.can_write()
     and exists (select 1 from ops.task t
                 where t.id = p_task
                   and (t.department = any (ops.my_departments())
                        or t.assignee_id = auth.uid()
                        or t.created_by = auth.uid()
                        or ops.is_task_owner(t.id)
                        or (t.department is null
                            and (ops.is_founder() or ops.leads_task_assignee(t.assignee_id) or ops.leads_task_owners(t.id)))))
$$;

-- ---------------------------------------------------------------- history kinds
alter table ops.task_history drop constraint task_history_kind_check;
alter table ops.task_history add constraint task_history_kind_check
  check (kind in ('created', 'assigned', 'status', 'due', 'start', 'priority', 'department', 'edited',
                  'file_added', 'file_removed', 'file_restored'));

-- ---------------------------------------------------------------- counters on the task
alter table ops.task
  add column attachment_count int not null default 0 check (attachment_count >= 0),
  add column comment_count    int not null default 0 check (comment_count >= 0);

alter table ops.task disable trigger t_task_upd;
update ops.task t set comment_count = c.n
  from (select task_id, count(*)::int as n from ops.task_comment group by task_id) c
 where c.task_id = t.id;
alter table ops.task enable trigger t_task_upd;

create or replace function ops.task_comment_count_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_task uuid := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
begin
  update ops.task set comment_count = (select count(*)::int from ops.task_comment where task_id = v_task)
   where id = v_task;
  return null;
end $$;
create trigger t_task_comment_count after insert or delete on ops.task_comment
  for each row execute function ops.task_comment_count_sync();

-- ---------------------------------------------------------------- the files
create table ops.task_attachment (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references ops.task (id) on delete cascade,
  comment_id  uuid references ops.task_comment (id) on delete set null,
  path        text not null unique
              check (path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$'
                 and left(path, 36) = task_id::text),
  name        text not null check (char_length(btrim(name)) between 1 and 160),
  mime        text not null check (mime in (
                'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                'text/csv', 'text/plain', 'text/markdown')),
  size_bytes  int not null check (size_bytes between 1 and 26214400),
  kind        text not null check (kind in ('image', 'document') and ((kind = 'image') = (mime like 'image/%'))),
  is_inline   boolean not null default false check (not is_inline or kind = 'image'),
  uploaded_by uuid references ops.staff (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references ops.staff (id) on delete set null,
  check (deleted_by is null or deleted_at is not null)
);
create index task_attachment_task_idx on ops.task_attachment (task_id, created_at);
create index task_attachment_comment_idx on ops.task_attachment (comment_id);
create index task_attachment_uploader_idx on ops.task_attachment (uploaded_by);
create index task_attachment_deleted_by_idx on ops.task_attachment (deleted_by);
create index task_attachment_deleted_at_idx on ops.task_attachment (deleted_at) where deleted_at is not null;

alter table ops.task_attachment enable row level security;
-- Whoever reads the task in full sees its files. A removed file shows only to its uploader and to people who may edit the task.
create policy task_attachment_sel on ops.task_attachment for select to authenticated
  using ((select ops.sees_task_fully(task_id))
         and (deleted_at is null or uploaded_by = (select auth.uid()) or (select ops.can_edit_task(task_id))));

create or replace function ops.task_attachment_count_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_task uuid := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
begin
  update ops.task set attachment_count = (select count(*)::int from ops.task_attachment where task_id = v_task and deleted_at is null)
   where id = v_task;
  return null;
end $$;
create trigger t_task_attachment_count after insert or update of deleted_at or delete on ops.task_attachment
  for each row execute function ops.task_attachment_count_sync();

-- ---------------------------------------------------------------- paths to clean out of Storage
create table ops.task_file_orphan (
  path      text primary key,
  queued_at timestamptz not null default now()
);
create index task_file_orphan_queued_idx on ops.task_file_orphan (queued_at);
alter table ops.task_file_orphan enable row level security;
create policy task_file_orphan_sel on ops.task_file_orphan for select to authenticated
  using ((select ops.is_founder()));

create or replace function ops.task_attachment_orphan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into ops.task_file_orphan (path) values (old.path) on conflict do nothing;
  return null;
end $$;
create trigger t_task_attachment_orphan after delete on ops.task_attachment
  for each row execute function ops.task_attachment_orphan();

-- ---------------------------------------------------------------- RPCs
-- Registers an uploaded file. The caller must have uploaded the object already (checked here when Storage exists).
-- On the task itself: anyone who may edit the task. On a comment: the comment's own author, who may read the task.
create or replace function ops.register_task_attachment(
  p_task uuid, p_path text, p_name text, p_mime text, p_size int,
  p_comment uuid default null, p_inline boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id    uuid;
  v_name  text := btrim(coalesce(p_name, ''));
  v_kind  text;
  v_size  bigint := p_size;
  v_found boolean;
begin
  if auth.uid() is null then raise exception 'Sign in to add files' using errcode = '42501'; end if;
  if p_task is null or not ops.sees_task_fully(p_task) then raise exception 'That task was not found'; end if;
  if not ops.can_write() then raise exception 'You do not have access to add files' using errcode = '42501'; end if;

  if p_comment is null then
    if not ops.can_edit_task(p_task) then
      raise exception 'You cannot add files to this task' using errcode = '42501';
    end if;
  elsif not exists (select 1 from ops.task_comment c
                     where c.id = p_comment and c.task_id = p_task and c.author_id = auth.uid()) then
    raise exception 'You can only attach files to your own comment on this task';
  end if;

  if coalesce(p_path, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$'
     or left(p_path, 36) <> p_task::text then
    raise exception 'The file must be stored in this task''s own folder';
  end if;
  if char_length(v_name) not between 1 and 160 then raise exception 'A file name must be 1 to 160 characters'; end if;
  v_kind := case when coalesce(p_mime, '') like 'image/%' then 'image' else 'document' end;
  if coalesce(p_mime, '') not in (
       'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation',
       'text/csv', 'text/plain', 'text/markdown') then
    raise exception 'That file type is not allowed. Use an image, PDF, Word, Excel, PowerPoint, CSV, text or Markdown file';
  end if;
  if coalesce(p_inline, false) and v_kind <> 'image' then raise exception 'Only an image can be placed inside the description'; end if;

  if to_regclass('storage.objects') is not null then
    execute 'select true, (metadata ->> ''size'')::bigint from storage.objects where bucket_id = ''task-files'' and name = $1'
      into v_found, v_size using p_path;
    if not coalesce(v_found, false) then raise exception 'The file was not uploaded. Try again'; end if;
    v_size := coalesce(v_size, p_size);
  end if;
  if coalesce(v_size, 0) not between 1 and 26214400 then raise exception 'Each file must be between 1 byte and 25 MB'; end if;

  perform 1 from ops.task where id = p_task for update;
  if (select count(*) from ops.task_attachment where task_id = p_task and deleted_at is null) >= 100 then
    raise exception 'A task can hold at most 100 files. Remove one first';
  end if;

  insert into ops.task_attachment (task_id, comment_id, path, name, mime, size_bytes, kind, is_inline, uploaded_by)
  values (p_task, p_comment, p_path, v_name, p_mime, v_size::int, v_kind, coalesce(p_inline, false), auth.uid())
  returning id into v_id;

  insert into ops.task_history (task_id, actor_id, kind, to_value) values (p_task, auth.uid(), 'file_added', left(v_name, 160));
  return v_id;
end $$;

-- Takes a file off the task (soft delete). The uploader, or anyone who may edit the task.
create or replace function ops.remove_task_attachment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if auth.uid() is null then raise exception 'Sign in to remove files' using errcode = '42501'; end if;
  select x.* into a from ops.task_attachment x where x.id = p_id;
  if not found or not ops.sees_task_fully(a.task_id) then raise exception 'That file was not found'; end if;
  if not ops.can_write() or not (a.uploaded_by = auth.uid() or ops.can_edit_task(a.task_id)) then
    raise exception 'You cannot remove this file' using errcode = '42501';
  end if;
  if a.deleted_at is not null then raise exception 'That file is already removed'; end if;
  update ops.task_attachment set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  insert into ops.task_history (task_id, actor_id, kind, from_value) values (a.task_id, auth.uid(), 'file_removed', left(a.name, 160));
end $$;

create or replace function ops.restore_task_attachment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if auth.uid() is null then raise exception 'Sign in to restore files' using errcode = '42501'; end if;
  select x.* into a from ops.task_attachment x where x.id = p_id;
  if not found or not ops.sees_task_fully(a.task_id) then raise exception 'That file was not found'; end if;
  if not ops.can_write() or not (a.uploaded_by = auth.uid() or ops.can_edit_task(a.task_id)) then
    raise exception 'You cannot restore this file' using errcode = '42501';
  end if;
  if a.deleted_at is null then raise exception 'That file is not removed'; end if;
  perform 1 from ops.task where id = a.task_id for update;
  if (select count(*) from ops.task_attachment where task_id = a.task_id and deleted_at is null) >= 100 then
    raise exception 'A task can hold at most 100 files. Remove one first';
  end if;
  update ops.task_attachment set deleted_at = null, deleted_by = null where id = p_id;
  insert into ops.task_history (task_id, actor_id, kind, to_value) values (a.task_id, auth.uid(), 'file_restored', left(a.name, 160));
end $$;

-- Service job: makes removals older than p_days final and returns the Storage paths waiting to be deleted.
create or replace function ops.purge_task_attachments(p_days integer default 30) returns setof text
language plpgsql security definer set search_path = '' as $$
begin
  if not ops.is_system() then raise exception 'Only the scheduled job can purge files' using errcode = '42501'; end if;
  if p_days is null or p_days < 0 then raise exception 'Give the number of days to keep removed files'; end if;
  delete from ops.task_attachment where deleted_at is not null and deleted_at < now() - make_interval(days => p_days);
  return query select o.path from ops.task_file_orphan o order by o.queued_at limit 1000;
end $$;

-- Service job: the objects at these paths are gone from Storage.
create or replace function ops.ack_task_file_orphans(p_paths text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not ops.is_system() then raise exception 'Only the scheduled job can do this' using errcode = '42501'; end if;
  delete from ops.task_file_orphan where path = any (coalesce(p_paths, '{}'));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- Storage rules
-- p_mode: 'read', 'write' (upload) or 'delete'. Called from the policies on storage.objects.
-- Reading and uploading need the same access as the comments: read the task in full (a person who only holds a
-- subtask is out) and not be a viewer. Whether the upload is then registered on the task or on a comment is
-- decided by the RPC. A registered file's object can never be deleted from the browser; a removed file's object
-- can be read only by who can still see its row.
create or replace function ops.task_file_object_ok(p_name text, p_mode text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_task uuid;
begin
  if auth.uid() is null or p_name is null then return false; end if;
  if p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$' then
    return false;
  end if;
  v_task := left(p_name, 36)::uuid;
  if not ops.sees_task_fully(v_task) then return false; end if;

  if p_mode = 'read' then
    return not exists (select 1 from ops.task_attachment a
                        where a.path = p_name and a.deleted_at is not null
                          and not (a.uploaded_by = auth.uid() or ops.can_edit_task(a.task_id)));
  end if;
  if not ops.can_write() then return false; end if;
  if p_mode = 'delete' then
    return not exists (select 1 from ops.task_attachment a where a.path = p_name);
  end if;
  return p_mode = 'write';
end $$;

do $do$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('task-files', 'task-files', false, 26214400, array[
      'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/csv', 'text/plain', 'text/markdown'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
  if to_regclass('storage.objects') is not null then
    drop policy if exists task_files_read on storage.objects;
    drop policy if exists task_files_insert on storage.objects;
    drop policy if exists task_files_delete on storage.objects;
    create policy task_files_read on storage.objects for select to authenticated
      using (bucket_id = 'task-files' and (select ops.task_file_object_ok(name, 'read')));
    create policy task_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'task-files' and (select ops.task_file_object_ok(name, 'write')));
    create policy task_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'task-files' and (select ops.task_file_object_ok(name, 'delete')));
  end if;
end
$do$;

-- ---------------------------------------------------------------- grants
revoke execute on all functions in schema ops from public;
grant execute on function
  ops.can_edit_task(uuid), ops.task_file_object_ok(text, text),
  ops.register_task_attachment(uuid, text, text, text, int, uuid, boolean),
  ops.remove_task_attachment(uuid), ops.restore_task_attachment(uuid) to authenticated, service_role;
grant execute on function ops.purge_task_attachments(integer), ops.ack_task_file_orphans(text[]) to service_role;
-- 0040: a subtask can be shared by several people.
-- ops.create_shared_task gains an optional parent_task. The subtask rules (open parent, no nesting) are enforced by the
-- task guard as for any subtask; this adds who may attach one: someone who can read the parent in full, or who already
-- holds a subtask of it. The old signature is dropped so a call with named arguments never matches two functions.

drop function ops.create_shared_task(text, uuid[], text, integer, date, time, date, integer, ops.department, text);

create or replace function ops.create_shared_task(
  title text,
  assignees uuid[],
  description text default null,
  priority integer default 3,
  due_date date default null,
  due_time time default null,
  start_date date default null,
  estimate_minutes integer default null,
  department ops.department default null,
  category text default null,
  parent_task uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare
  uid    uuid := auth.uid();
  ppl    uuid[];
  who    uuid;
  tid    uuid;
  nm     text;
  was    text := coalesce(current_setting('ops.task_rpc', true), '');
begin
  if uid is null or not ops.can_write() or not ops.is_internal() then
    raise exception 'Your role cannot create tasks for the team';
  end if;
  if coalesce(btrim(title), '') = '' then raise exception 'A task needs a title'; end if;

  select array_agg(x.a order by x.first_at) into ppl
    from (select a, min(o) as first_at from unnest(assignees) with ordinality u(a, o) where a is not null group by a) x;
  if ppl is null or cardinality(ppl) < 2 then raise exception 'A shared task needs at least two people'; end if;
  if cardinality(ppl) > 20 then raise exception 'A task can be shared by at most 20 people'; end if;
  foreach who in array ppl loop
    perform ops.check_task_person(who, null);
  end loop;

  if parent_task is not null
     and not (ops.sees_task_fully(parent_task) or ops.holds_subtask_of(parent_task)) then
    raise exception 'The parent task was not found';
  end if;

  perform set_config('ops.task_rpc', '1', true);
  insert into ops.task (title, description, priority, due_date, due_time, start_date, estimate_minutes,
                        department, category, assignee_id, shared, parent_task_id)
  values (title, description, priority, due_date, due_time, start_date, estimate_minutes,
          department, category, ppl[1], true, parent_task)
  returning id into tid;

  insert into ops.task_owner (task_id, staff_id, added_by) select tid, x, uid from unnest(ppl) x;

  nm := coalesce((select s.full_name from ops.staff s where s.id = uid), 'Someone');
  foreach who in array ppl[2:cardinality(ppl)] loop
    perform ops.auto_watch(tid, who, uid);
    perform ops.notify(who, 'assigned', tid, uid, nm || ' gave you a shared task: ' || left(title, 80));
    insert into ops.task_history (task_id, actor_id, kind, to_value)
    select tid, uid, 'assigned', s.full_name from ops.staff s where s.id = who;
  end loop;

  if uid = any (ppl) then
    update ops.task t set accepted_at = now() where t.id = tid and t.accepted_at is null;
  end if;
  perform set_config('ops.task_rpc', was, true);
  return tid;
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.create_shared_task(text, uuid[], text, integer, date, time, date, integer, ops.department, text, uuid)
  to authenticated, service_role;
-- 0041: what the scheduled clean-up job needs to keep Storage tidy (see scripts/purge-task-files.mjs).
--  * ops.list_unregistered_task_objects: objects that were uploaded but never registered (the browser closed, or the
--    registration failed and the discard did not run). Anything newer than p_older_than is left alone, so an upload
--    that is still in flight is never touched.
--  * ops.task_files_deletable: of the paths a job is about to delete, the ones with no attachment row at all. This is
--    the safety net: the job asks the database before every delete, so an object that still backs a file is kept.
-- Both are for the service role only. Neither changes any data.

create or replace function ops.list_unregistered_task_objects(p_older_than interval default interval '24 hours', p_limit integer default 500)
returns setof text
language plpgsql security definer set search_path = '' as $$
begin
  if not ops.is_system() then raise exception 'Only the scheduled job can list stray files' using errcode = '42501'; end if;
  if p_older_than is null or p_older_than < interval '1 hour' then raise exception 'Leave uploads younger than an hour alone'; end if;
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'Ask for between 1 and 1000 files'; end if;
  if to_regclass('storage.objects') is null then return; end if;
  return query execute
    'select o.name from storage.objects o
      where o.bucket_id = ''task-files'' and o.created_at < now() - $1
        and not exists (select 1 from ops.task_attachment a where a.path = o.name)
        and not exists (select 1 from ops.task_file_orphan q where q.path = o.name)
      order by o.created_at limit $2'
    using p_older_than, p_limit;
end $$;

create or replace function ops.task_files_deletable(p_paths text[]) returns setof text
language plpgsql security definer set search_path = '' as $$
begin
  if not ops.is_system() then raise exception 'Only the scheduled job can do this' using errcode = '42501'; end if;
  return query
    select p from unnest(coalesce(p_paths, '{}')) as p
     where not exists (select 1 from ops.task_attachment a where a.path = p);
end $$;

revoke execute on all functions in schema ops from public;
grant execute on function ops.list_unregistered_task_objects(interval, integer), ops.task_files_deletable(text[]) to service_role;
-- 0042: the task assistant (bring-your-own Gemini key).
--  * ops.ai_key: one row per person holding their Gemini key, ALREADY ENCRYPTED by the app (AES-256-GCM, bound to the
--    person's id). The ciphertext is never selectable by a signed-in user (column grants) and is only handed back to its
--    owner through ops.load_ai_key(). The database never sees the plain key.
--  * ops.ai_conversation / ops.ai_message: a person's chats, private to them.
--  * ops.ai_action: a DRAFT the assistant proposes (create a task, change a status, ...). Nothing happens until the
--    person confirms it; the app then runs it through the normal task actions with that person's own session, so every
--    task rule and every RLS policy still applies. A draft cannot be edited after it is made, expires after 24 hours,
--    and can only move pending -> running -> done / failed (failed -> running to retry), or pending -> cancelled.
-- Limits that keep one account from running away live here too: chats, messages per hour and day, drafts waiting.

-- ---------------------------------------------------------------- the key
create table ops.ai_key (
  staff_id   uuid primary key references ops.staff (id) on delete cascade,
  cipher     text not null check (char_length(cipher) between 20 and 2000),
  key_hint   text not null check (char_length(key_hint) between 1 and 8),
  model      text not null check (model ~ '^[A-Za-z0-9._-]{1,80}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table ops.ai_key enable row level security;
create policy ai_key_sel on ops.ai_key for select to authenticated
  using (staff_id = (select auth.uid()));
-- No insert/update/delete policy: written only through the functions below.
revoke all on ops.ai_key from authenticated, anon;
grant select (staff_id, key_hint, model, created_at, updated_at) on ops.ai_key to authenticated;

create or replace function ops.ai_caller() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or ops.is_system() then raise exception 'Sign in to use the assistant' using errcode = '42501'; end if;
  if not exists (select 1 from ops.staff where id = uid and is_active) then
    raise exception 'Your access was removed' using errcode = '42501';
  end if;
  return uid;
end $$;

create or replace function ops.save_ai_key(p_cipher text, p_hint text, p_model text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := ops.ai_caller();
begin
  insert into ops.ai_key (staff_id, cipher, key_hint, model) values (uid, p_cipher, p_hint, p_model)
  on conflict (staff_id) do update set cipher = excluded.cipher, key_hint = excluded.key_hint, model = excluded.model, updated_at = now();
end $$;

create or replace function ops.set_ai_model(p_model text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := ops.ai_caller();
begin
  if p_model is null or p_model !~ '^[A-Za-z0-9._-]{1,80}$' then raise exception 'Choose a model'; end if;
  update ops.ai_key set model = p_model, updated_at = now() where staff_id = uid;
  if not found then raise exception 'Add your Gemini key first'; end if;
end $$;

create or replace function ops.delete_ai_key() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := ops.ai_caller();
begin
  delete from ops.ai_key where staff_id = uid;
end $$;

create or replace function ops.load_ai_key() returns table (cipher text, model text)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := ops.ai_caller();
begin
  return query select k.cipher, k.model from ops.ai_key k where k.staff_id = uid;
end $$;

-- ---------------------------------------------------------------- chats
create table ops.ai_conversation (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null default auth.uid() references ops.staff (id) on delete cascade,
  title      text not null default 'New chat' check (char_length(btrim(title)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_conversation_staff_idx on ops.ai_conversation (staff_id, updated_at desc);
alter table ops.ai_conversation enable row level security;
create policy ai_conversation_sel on ops.ai_conversation for select to authenticated using (staff_id = (select auth.uid()));
create policy ai_conversation_ins on ops.ai_conversation for insert to authenticated with check (staff_id = (select auth.uid()));
create policy ai_conversation_upd on ops.ai_conversation for update to authenticated
  using (staff_id = (select auth.uid())) with check (staff_id = (select auth.uid()));
create policy ai_conversation_del on ops.ai_conversation for delete to authenticated using (staff_id = (select auth.uid()));

create or replace function ops.ai_conversation_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform ops.ai_caller();
    if (select count(*) from ops.ai_conversation where staff_id = new.staff_id) >= 200 then
      raise exception 'You have 200 chats. Delete some before starting another';
    end if;
  else
    if new.staff_id <> old.staff_id then raise exception 'A chat cannot change owner'; end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger t_ai_conversation_guard before insert or update on ops.ai_conversation
  for each row execute function ops.ai_conversation_guard();

create table ops.ai_message (
  id              uuid primary key default gen_random_uuid(),
  seq             bigint generated always as identity,
  conversation_id uuid not null references ops.ai_conversation (id) on delete cascade,
  staff_id        uuid not null default auth.uid() references ops.staff (id) on delete cascade,
  role            text not null check (role in ('user', 'model', 'tool')),
  content         jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 100000),
  created_at      timestamptz not null default now()
);
create index ai_message_conversation_idx on ops.ai_message (conversation_id, seq);
create index ai_message_staff_idx on ops.ai_message (staff_id, created_at);
alter table ops.ai_message enable row level security;
create policy ai_message_sel on ops.ai_message for select to authenticated using (staff_id = (select auth.uid()));
create policy ai_message_ins on ops.ai_message for insert to authenticated with check (staff_id = (select auth.uid()));
create policy ai_message_del on ops.ai_message for delete to authenticated using (staff_id = (select auth.uid()));
-- Messages are never edited.

create or replace function ops.ai_message_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform ops.ai_caller();
  if not exists (select 1 from ops.ai_conversation c where c.id = new.conversation_id and c.staff_id = new.staff_id) then
    raise exception 'That chat was not found';
  end if;
  if (select count(*) from ops.ai_message where conversation_id = new.conversation_id) >= 600 then
    raise exception 'This chat is full. Start a new one';
  end if;
  if new.role = 'user' then
    if (select count(*) from ops.ai_message where staff_id = new.staff_id and role = 'user' and created_at > now() - interval '1 hour') >= 60 then
      raise exception 'You have sent a lot of messages this hour. Wait a few minutes and try again';
    end if;
    if (select count(*) from ops.ai_message where staff_id = new.staff_id and role = 'user' and created_at > now() - interval '1 day') >= 400 then
      raise exception 'You have reached today''s limit of 400 messages. Try again tomorrow';
    end if;
  end if;
  return new;
end $$;
create trigger t_ai_message_guard before insert on ops.ai_message
  for each row execute function ops.ai_message_guard();

create or replace function ops.ai_message_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update ops.ai_conversation set updated_at = now() where id = new.conversation_id;
  return null;
end $$;
create trigger t_ai_message_touch after insert on ops.ai_message
  for each row execute function ops.ai_message_touch();

-- ---------------------------------------------------------------- drafts
create table ops.ai_action (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ops.ai_conversation (id) on delete cascade,
  staff_id        uuid not null default auth.uid() references ops.staff (id) on delete cascade,
  kind            text not null check (kind in ('create_task', 'create_subtasks', 'update_task', 'set_schedule', 'change_status', 'assign_task', 'add_comment')),
  payload         jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 30000),
  summary         text not null check (char_length(btrim(summary)) between 1 and 600),
  status          text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  result          jsonb,
  error           text check (char_length(error) <= 600),
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  expires_at      timestamptz not null default now() + interval '24 hours'
);
create index ai_action_conversation_idx on ops.ai_action (conversation_id, created_at);
create index ai_action_staff_idx on ops.ai_action (staff_id, status);
alter table ops.ai_action enable row level security;
create policy ai_action_sel on ops.ai_action for select to authenticated using (staff_id = (select auth.uid()));
create policy ai_action_ins on ops.ai_action for insert to authenticated with check (staff_id = (select auth.uid()));
create policy ai_action_upd on ops.ai_action for update to authenticated
  using (staff_id = (select auth.uid())) with check (staff_id = (select auth.uid()));
create policy ai_action_del on ops.ai_action for delete to authenticated using (staff_id = (select auth.uid()));

create or replace function ops.ai_action_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform ops.ai_caller();
  if tg_op = 'INSERT' then
    if not exists (select 1 from ops.ai_conversation c where c.id = new.conversation_id and c.staff_id = new.staff_id) then
      raise exception 'That chat was not found';
    end if;
    if (select count(*) from ops.ai_action where staff_id = new.staff_id and status = 'pending') >= 30 then
      raise exception 'You have 30 drafts waiting. Confirm or discard some first';
    end if;
    new.status := 'pending'; new.result := null; new.error := null; new.decided_at := null;
    new.created_at := now(); new.expires_at := now() + interval '24 hours';
    return new;
  end if;

  if new.kind is distinct from old.kind or new.payload is distinct from old.payload or new.summary is distinct from old.summary
     or new.staff_id is distinct from old.staff_id or new.conversation_id is distinct from old.conversation_id
     or new.created_at is distinct from old.created_at or new.expires_at is distinct from old.expires_at then
    raise exception 'A draft cannot be changed. Ask for a new one';
  end if;
  if new.status = old.status and new.status = 'running' and old.decided_at < now() - interval '5 minutes' then
    new.decided_at := now();
    return new;
  end if;
  if new.status is not distinct from old.status then
    if new.result is distinct from old.result or new.error is distinct from old.error or new.decided_at is distinct from old.decided_at then
      raise exception 'A draft''s outcome is set when it moves on';
    end if;
    return new;
  end if;
  if not ((old.status = 'pending' and new.status in ('running', 'cancelled'))
       or (old.status = 'running' and new.status in ('done', 'failed'))
       or (old.status = 'failed' and new.status = 'running')) then
    raise exception 'This draft is already % and cannot be %', old.status, new.status;
  end if;
  if new.status = 'running' and old.expires_at < now() then
    raise exception 'This draft has expired. Ask the assistant again';
  end if;
  new.decided_at := now();
  if new.status = 'running' then new.error := null; end if;
  return new;
end $$;
create trigger t_ai_action_guard before insert or update on ops.ai_action
  for each row execute function ops.ai_action_guard();

-- ---------------------------------------------------------------- grants
revoke execute on all functions in schema ops from public;
grant execute on function ops.save_ai_key(text, text, text), ops.set_ai_model(text), ops.delete_ai_key(), ops.load_ai_key() to authenticated;
-- 0043: the assistant learns calendar, workshop and sales drafts. Only the list of draft kinds changes; the table,
-- its RLS policies and the guard trigger (0042) already cover every kind the same way, so a new kind needs no new rule.
-- A draft still only runs when its owner confirms it, through the same server action the screens use.

alter table ops.ai_action drop constraint ai_action_kind_check;
alter table ops.ai_action add constraint ai_action_kind_check check (kind in (
  'create_task', 'create_subtasks', 'update_task', 'set_schedule', 'change_status', 'assign_task', 'add_comment',
  'schedule_meeting', 'update_meeting', 'cancel_meeting', 'rsvp_meeting',
  'create_event', 'update_event', 'set_event_team', 'event_status', 'toggle_run_item',
  'log_activity', 'create_deal', 'update_deal', 'move_deal'
));

revoke execute on all functions in schema ops from public;
grant execute on function ops.save_ai_key(text, text, text), ops.set_ai_model(text), ops.delete_ai_key(), ops.load_ai_key() to authenticated;
