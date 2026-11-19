-- Demo data for a LOCAL database: realistic fake institutions, deals, workshops, tasks, stock and a month of KPI history.
-- No real people, schools or contacts. Run it with scripts/seed-demo.sh, which refuses anything but the local stack.
-- Run it once after `npx supabase db reset` (it is not meant to be run twice). Sign in as demo-founder@hardcode.local / demo-password-123.
set client_min_messages = warning;

do $$
declare
  fid uuid := gen_random_uuid(); lid uuid := gen_random_uuid(); mid uuid := gen_random_uuid(); tid uuid := gen_random_uuid();
  inst uuid[]; i int; d uuid; e uuid; it uuid; loc uuid; wh uuid;
  names text[] := array['Green Valley High School','Sunrise Public School','Ashoka Engineering College','Sahyadri Polytechnic','Modern English School',
    'Vidya Mandir','Pioneer Institute of Technology','Lotus Valley School','Kohinoor College of Engineering','Saraswati Vidyalaya',
    'Bharat Polytechnic','Orchid International School','Mahatma University','Little Flower High School'];
  cities text[] := array['Pune','Nashik','Pune','Kolhapur','Nagpur','Satara','Pune','Aurangabad','Nashik','Solapur','Pune','Thane','Nagpur','Kolhapur'];
  kinds text[] := array['school','school','engineering_college','polytechnic','school','school','engineering_college','school','engineering_college','school','polytechnic','school','university','school'];
  stages text[] := array['prospect','prospect','contacted','contacted','qualified','qualified','deal_won','workshop_delivered','workshop_delivered','teachers_trained','active','lab_customer','prospect','contacted'];
begin
  -- people
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, reauthentication_token, phone_change, phone_change_token)
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated', x.email, extensions.crypt('demo-password-123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', ''
  from (values (fid, 'demo-founder@hardcode.local'), (lid, 'demo-lead@hardcode.local'), (mid, 'demo-member@hardcode.local'), (tid, 'demo-trainer@hardcode.local')) x (id, email)
  on conflict do nothing;
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
  from auth.users u where u.email like 'demo-%@hardcode.local' on conflict do nothing;
  insert into ops.staff (id, full_name, email, role, departments)
  select u.id, v.n, u.email, v.r::ops.app_role, v.d::ops.department[]
  from auth.users u join (values ('demo-founder@hardcode.local','Demo Founder','founder','{}'), ('demo-lead@hardcode.local','Demo Sales Lead','dept_lead','{sales,outreach}'),
    ('demo-member@hardcode.local','Demo Salesperson','member','{sales}'), ('demo-trainer@hardcode.local','Demo Trainer','member','{workshop,training}')) v (e, n, r, d) on v.e = u.email
  on conflict do nothing;
  select id into fid from ops.staff where email = 'demo-founder@hardcode.local';
  select id into mid from ops.staff where email = 'demo-member@hardcode.local';
  select id into tid from ops.staff where email = 'demo-trainer@hardcode.local';

  -- institutions
  for i in 1..14 loop
    insert into ops.institution (name, kind, city, state, stage, owner_id, source)
    values ('ZZ ' || names[i], kinds[i], cities[i], 'Maharashtra', stages[i]::ops.lifecycle_stage, case when i % 3 = 0 then mid else fid end, 'demo')
    on conflict do nothing;
  end loop;
  select array_agg(id order by name) into inst from ops.institution where name like 'ZZ %';

  -- deals: open ones at each stage, a few won and lost
  for i in 1..10 loop
    insert into ops.deal (institution_id, kind, title, stage, value_inr, probability, expected_close, owner_id)
    values (inst[i], (array['workshop','fdp','lab_setup','other'])[1 + i % 4], 'ZZ Deal ' || i, 'meeting',
            (array[45000, 120000, 350000, 80000, 600000])[1 + i % 5], 20, current_date + (i * 6), case when i % 2 = 0 then mid else fid end)
    returning id into d;
    if i >= 3 then update ops.deal set stage = 'proposal', probability = 40 where id = d; end if;
    if i >= 5 then update ops.deal set stage = 'negotiation', probability = 70 where id = d; end if;
    if i in (8, 9) then update ops.deal set stage = 'won', probability = 100 where id = d; end if;
    if i = 10 then update ops.deal set stage = 'lost', lost_reason = 'Budget went to another vendor' where id = d; end if;
  end loop;

  -- workshops: past completed, upcoming scheduled
  for i in 1..4 loop
    insert into ops.event (institution_id, kind, title, starts_at, ends_at, venue, lead_trainer_id, expected_headcount, status)
    values (inst[i + 6], 'school_workshop', 'ZZ Workshop ' || i, now() - make_interval(days => 40 - i * 8), now() - make_interval(days => 40 - i * 8) + interval '5 hours',
            'Main hall', fid, 40, 'draft') returning id into e;
    update ops.event set status = 'scheduled' where id = e;
    update ops.event set status = 'in_progress' where id = e;
    update ops.run_sheet_item set done_at = now(), done_by = fid where event_id = e;
    update ops.event set status = 'completed', actual_headcount = 32 + i * 4, satisfaction_score = 4.0 + i * 0.2 where id = e;
  end loop;
  for i in 1..3 loop
    insert into ops.event (institution_id, kind, title, starts_at, ends_at, venue, lead_trainer_id, expected_headcount, status)
    values (inst[i], 'college_workshop', 'ZZ Upcoming workshop ' || i, now() + make_interval(days => i * 5), now() + make_interval(days => i * 5) + interval '6 hours', 'Seminar room', fid, 50, 'draft') returning id into e;
    update ops.event set status = 'scheduled' where id = e;
  end loop;

  -- tasks: late, due soon, comfortably ahead, finished
  insert into ops.task (department, title, priority, assignee_id, due_date, created_by)
  select 'sales', 'ZZ Follow up ' || g, 1 + g % 4, case when g % 2 = 0 then mid else fid end, current_date + (g - 3), fid
  from generate_series(1, 9) g;
  update ops.task set status = 'doing' where title = 'ZZ Follow up 5';
  update ops.task set status = 'done' where title = 'ZZ Follow up 7';

  -- stock: a catalog, a warehouse, receipts, then kits issued and some lost and damaged
  insert into ops.location (name, kind) values ('ZZ Pune warehouse', 'warehouse') returning id into wh;
  for i in 1..4 loop
    insert into ops.item (sku, name, category, unit_cost_inr, reorder_level)
    values ('ZZ-' || i, (array['ESP32 board','Sensor pack','Jumper wire set','USB cable'])[i], 'kit', (array[420, 650, 90, 60])[i], 20)
    returning id into it;
    insert into ops.stock_movement (item_id, location_id, qty, kind, created_by) values (it, wh, 100 - i * 20, 'received', fid);
    if i <= 2 then insert into ops.stock_movement (item_id, location_id, qty, kind, note, created_by) values (it, wh, -(i * 2), case when i = 1 then 'damaged' else 'lost' end, 'demo write-off', fid); end if;
  end loop;
end $$;

-- a month of KPI history, shrinking backwards so the trend lines have something to show
do $$
declare k int;
begin
  for k in reverse 30..1 loop
    perform ops.write_kpi_snapshot(ops.today_ist() - k);
    update ops.kpi_snapshot set value = round(value * (1 - k * 0.018), 2)
     where snapshot_date = ops.today_ist() - k and dimension = 'all' and metric not in ('tasks_overdue', 'low_stock_items');
  end loop;
  perform ops.write_kpi_snapshot();
end $$;
