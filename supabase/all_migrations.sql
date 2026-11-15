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
