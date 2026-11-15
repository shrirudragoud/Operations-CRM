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
