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
