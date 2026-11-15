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
