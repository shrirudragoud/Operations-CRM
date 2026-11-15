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
