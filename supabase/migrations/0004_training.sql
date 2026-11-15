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
