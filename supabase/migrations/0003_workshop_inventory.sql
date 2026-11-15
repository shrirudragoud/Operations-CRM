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
