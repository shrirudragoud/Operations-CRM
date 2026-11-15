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
