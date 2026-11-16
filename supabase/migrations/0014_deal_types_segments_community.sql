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
