import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const db = new PGlite();
let pass = 0, fail = 0;

const ok = (name) => { pass++; console.log('  ok   ' + name); };
const bad = (name, why) => { fail++; console.log('  FAIL ' + name + '\n       ' + why); };
const msg = (e) => (e?.message ?? String(e)).split('\n')[0];

// run SQL as a given user (authenticated role + jwt sub); uid=null => superuser/service
async function run(uid, sql) {
  if (uid) {
    await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
  }
  try { return await db.query(sql); }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
}
async function expectOk(name, uid, sql) {
  try { const r = await run(uid, sql); ok(name); return r; } catch (e) { bad(name, msg(e)); }
}
async function expectErr(name, uid, sql, part) {
  try { await run(uid, sql); bad(name, 'expected an error but it succeeded'); }
  catch (e) { msg(e).toLowerCase().includes(part.toLowerCase()) ? ok(name) : bad(name, `wrong error: ${msg(e)}`); }
}
async function val(sql) { const r = await db.query(sql); return r.rows[0] ? Object.values(r.rows[0])[0] : null; }
async function expectVal(name, sql, want) {
  try { const got = await val(sql); String(got) === String(want) ? ok(name) : bad(name, `got ${got}, want ${want}`); }
  catch (e) { bad(name, msg(e)); }
}

// ---- Supabase stubs
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, service_role;
  grant execute on function auth.uid() to authenticated, service_role;
  grant select on auth.users to authenticated;
`);

process.on('unhandledRejection', (e) => { console.error('\nUNEXPECTED: ' + msg(e)); process.exit(2); });
console.log('Applying migrations');
for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(dir, f), 'utf8')); ok(f); }
  catch (e) { bad(f, msg(e)); console.log('\nAborting: migration failed.'); process.exit(1); }
}

// ---- people
const F = '00000000-0000-0000-0000-00000000000f'; // founder
const S = '00000000-0000-0000-0000-000000000005'; // sales member
const W = '00000000-0000-0000-0000-000000000006'; // workshop+training lead (trainer)
const T2 = '00000000-0000-0000-0000-000000000007'; // second trainer
const P = '00000000-0000-0000-0000-0000000000a1'; // partner
const V = '00000000-0000-0000-0000-0000000000b1'; // viewer (sales)
const O = '00000000-0000-0000-0000-000000000004'; // outreach member
await db.exec(`
  insert into auth.users(id) values ('${F}'),('${S}'),('${W}'),('${T2}'),('${P}'),('${V}'),('${O}');
  insert into ops.staff(id, full_name, email, role, departments) values
   ('${F}','Founder','f@x.in','founder','{}'),
   ('${S}','Sales','s@x.in','member','{sales}'),
   ('${W}','Workshop Lead','w@x.in','dept_lead','{workshop,training}'),
   ('${T2}','Trainer Two','t2@x.in','member','{workshop,training}'),
   ('${P}','Partner','p@x.in','partner','{sales}'),
   ('${V}','Viewer','v@x.in','viewer','{sales}'),
   ('${O}','Outreach','o@x.in','member','{outreach}');
`);

console.log('\nOutreach -> Sales');
const inst = await val(`insert into ops.institution(name,kind,city,owner_id) values ('WCE Sangli','engineering_college','Sangli','${P}') returning id`);
const inst2 = await val(`insert into ops.institution(name,kind,city) values ('ZP School','school','Sangli') returning id`);
await expectOk('outreach member logs a qualified visit', O,
  `insert into ops.activity(institution_id, kind, outcome, next_step, next_step_due)
   values ('${inst}','visit','qualified','Send proposal', current_date + 3)`);
await expectVal('institution moved to qualified', `select stage from ops.institution where id='${inst}'`, 'qualified');
await expectVal('deal auto-created at meeting, owned by institution owner',
  `select stage||':'||(owner_id='${P}') from ops.deal where institution_id='${inst}'`, 'meeting:true');
await expectVal('follow-up task created', `select count(*) from ops.task where template='follow_up' and entity_id='${inst}'`, 1);
await expectOk('prospect -> contacted on interested call', O,
  `insert into ops.activity(institution_id, kind, outcome) values ('${inst2}','call','interested')`);
await expectVal('school contacted', `select stage from ops.institution where id='${inst2}'`, 'contacted');

console.log('\nDeal state machine');
const deal = await val(`select id from ops.deal where institution_id='${inst}'`);
await expectErr('cannot skip meeting -> negotiation', S, `update ops.deal set stage='negotiation' where id='${deal}'`, 'cannot move');
await expectErr('sales member cannot insert deal beyond meeting', S,
  `insert into ops.deal(institution_id,kind,title,stage,owner_id) values ('${inst}','fdp','x','proposal','${S}')`, 'meeting stage');
await expectErr('lost needs a reason', S, `update ops.deal set stage='lost' where id='${deal}'`, 'lost reason');
await expectOk('partner moves own deal to proposal', P, `update ops.deal set stage='proposal' where id='${deal}'`);
await expectOk('sales lead moves to negotiation', S, `update ops.deal set stage='negotiation' where id='${deal}'`);
await expectErr('partner cannot mark won', P, `update ops.deal set stage='won' where id='${deal}'`, 'only the founder');
await expectErr('sales member cannot mark won', S, `update ops.deal set stage='won' where id='${deal}'`, 'only the founder');
await expectOk('founder marks won', F, `update ops.deal set stage='won' where id='${deal}'`);
await expectVal('won creates a draft event', `select count(*) from ops.event where deal_id='${deal}' and status='draft'`, 1);
await expectVal('won_at stamped', `select won_at is not null from ops.deal where id='${deal}'`, true);
await expectVal('trainer + kit tasks created', `select count(*) from ops.task where template in ('trainer_request','reserve_kits')`, 2);
await expectVal('institution at deal_won', `select stage from ops.institution where id='${inst}'`, 'deal_won');
await expectErr('won deal is frozen', F, `update ops.deal set stage='lost', lost_reason='x' where id='${deal}'`, 'cannot change');
await expectErr('stage cannot move backwards (non-founder)', S,
  `update ops.institution set stage='prospect' where id='${inst}'`, 'backwards');
await expectOk('founder may correct stage', F, `update ops.institution set stage='qualified' where id='${inst}'`);
await db.exec(`update ops.institution set stage='deal_won' where id='${inst}'`);

console.log('\nEvent scheduling rules');
const ev = await val(`select id from ops.event where deal_id='${deal}'`);
await expectErr('cannot schedule without details', W, `update ops.event set status='scheduled' where id='${ev}'`, 'to schedule');
const t0 = `now() + interval '10 days'`, t1 = `now() + interval '12 days'`;
await db.exec(`update ops.event set lead_trainer_id='${W}', starts_at=${t0}, ends_at=${t1}, venue='Lab 3', expected_headcount=60 where id='${ev}'`);
await expectErr('uncertified trainer rejected', W, `update ops.event set status='scheduled' where id='${ev}'`, 'not certified');
await db.exec(`
  insert into ops.training_program(id,name,audience) values ('11111111-1111-1111-1111-111111111111','Trainer L1','internal_trainer');
  insert into ops.enrollment(program_id, staff_id, status, certified_at)
    values ('11111111-1111-1111-1111-111111111111','${W}','certified', now()),
           ('11111111-1111-1111-1111-111111111111','${T2}','certified', now());
`);
await expectOk('certified trainer can schedule', W, `update ops.event set status='scheduled' where id='${ev}'`);
await expectVal('cohort code generated (HC-XXXX)', `select code ~ '^HC-[A-Z2-9]{4}$' from ops.cohort where event_id='${ev}'`, true);
await expectVal('run sheet created from template', `select count(*) from ops.run_sheet_item where event_id='${ev}'`, 12);
const ev2 = await val(`insert into ops.event(institution_id,kind,title,lead_trainer_id,starts_at,ends_at,venue,expected_headcount)
  values ('${inst2}','school_workshop','Overlap', '${W}', now() + interval '11 days', now() + interval '13 days','Hall',30) returning id`);
await expectErr('trainer double-booking rejected', W, `update ops.event set status='scheduled' where id='${ev2}'`, 'already booked');
await expectOk('a free trainer can take it', W, `update ops.event set lead_trainer_id='${T2}', status='scheduled' where id='${ev2}'`);
await expectErr('assistant double-booking rejected', W,
  `insert into ops.event_staff(event_id, staff_id) values ('${ev2}','${W}')`, 'already booked');

console.log('\nInventory');
await db.exec(`
  insert into ops.item(id,sku,name,reorder_level) values
    ('aaaaaaaa-0000-0000-0000-000000000001','ESP32','ESP32 board', 30),
    ('aaaaaaaa-0000-0000-0000-000000000002','JMP','Jumper pack', 10);
  insert into ops.kit(id,name) values ('bbbbbbbb-0000-0000-0000-000000000001','Starter Kit');
  insert into ops.kit_component values
    ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',1),
    ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002',2);
  insert into ops.location(id,name,kind) values
    ('cccccccc-0000-0000-0000-000000000001','Main warehouse','warehouse'),
    ('cccccccc-0000-0000-0000-000000000002','WCE lab','institution');
`);
const IT1 = 'aaaaaaaa-0000-0000-0000-000000000001', IT2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const KIT = 'bbbbbbbb-0000-0000-0000-000000000001';
const WH = 'cccccccc-0000-0000-0000-000000000001', FIELD = 'cccccccc-0000-0000-0000-000000000002';
await expectErr('sales cannot touch stock', S,
  `insert into ops.stock_movement(item_id,location_id,qty,kind) values ('${IT1}','${WH}',10,'received')`, 'row-level security');
await expectOk('receive stock', W,
  `insert into ops.stock_movement(item_id,location_id,qty,kind) values ('${IT1}','${WH}',100,'received'),('${IT2}','${WH}',250,'received')`);
await expectErr('a "received" movement must be positive', W,
  `insert into ops.stock_movement(item_id,location_id,qty,kind) values ('${IT1}','${WH}',-5,'received')`, 'check constraint');
await expectErr('cannot remove more than exists', W,
  `insert into ops.stock_movement(item_id,location_id,qty,kind,note) values ('${IT1}','${WH}',-101,'lost','oops')`, 'insufficient stock');
await expectErr('lost needs a note', W,
  `insert into ops.stock_movement(item_id,location_id,qty,kind) values ('${IT1}','${WH}',-1,'lost')`, 'check constraint');
await expectOk('reserve 60 kits', W, `select ops.reserve_kit('${ev}','${KIT}',60)`);
await expectVal('available = warehouse - reserved', `select available from ops.v_stock where sku='ESP32'`, 40);
await expectErr('over-reserving is blocked', W, `select ops.reserve_kit('${ev2}','${KIT}',50)`, 'not enough');
await expectOk('issue 60 kits to the lab', W, `select ops.issue_kit('${ev}','${KIT}',60,'${WH}','${FIELD}')`);
await expectVal('warehouse stock dropped, total unchanged',
  `select in_warehouse||'/'||on_hand from ops.v_stock where sku='ESP32'`, '40/100');
await expectVal('reservation fulfilled', `select count(*) from ops.stock_reservation where event_id='${ev}' and status='fulfilled'`, 2);

console.log('\nCompleting the event');
await expectErr('cannot complete before run sheet done', W, `update ops.event set status='completed', actual_headcount=58 where id='${ev}'`, 'run sheet');
await db.exec(`update ops.run_sheet_item set done_at = now(), done_by='${W}' where event_id='${ev}' and phase in ('pre','day')`);
await expectErr('needs actual headcount', W, `update ops.event set status='completed' where id='${ev}'`, 'actual headcount');
await expectOk('complete the event', W, `update ops.event set status='completed', actual_headcount=58 where id='${ev}'`);
await expectVal('institution -> workshop_delivered', `select stage from ops.institution where id='${inst}'`, 'workshop_delivered');
await expectVal('post-event tasks created', `select count(*) from ops.task where entity_id='${ev}' and template in ('send_survey','close_returns','college_report','collect_photos')`, 4);

console.log('\nKit returns');
await expectErr('returns must add up to issued', W,
  `select ops.close_event_returns('${ev}','${FIELD}','${WH}','[{"item_id":"${IT1}","returned":50,"damaged":0,"lost":0},{"item_id":"${IT2}","returned":120,"damaged":0,"lost":0}]')`, 'must equal issued');
await expectErr('loss needs a note', W,
  `select ops.close_event_returns('${ev}','${FIELD}','${WH}','[{"item_id":"${IT1}","returned":57,"damaged":0,"lost":3},{"item_id":"${IT2}","returned":120,"damaged":0,"lost":0}]')`, 'note is required');
await expectOk('close returns with 3 lost boards', W,
  `select ops.close_event_returns('${ev}','${FIELD}','${WH}','[{"item_id":"${IT1}","returned":57,"damaged":0,"lost":3},{"item_id":"${IT2}","returned":120,"damaged":0,"lost":0}]','3 boards not returned by the lab')`);
await expectVal('stock after returns', `select in_warehouse||'/'||on_hand from ops.v_stock where sku='ESP32'`, '97/97');
await expectVal('loss review task raised', `select count(*) from ops.task where template='review_kit_loss'`, 1);
await expectErr('returns cannot be closed twice', W,
  `select ops.close_event_returns('${ev}','${FIELD}','${WH}','[]')`, 'already closed');
await expectVal('no low-stock tasks while above reorder level', `select ops.raise_low_stock_tasks()`, 0);
await db.exec(`update ops.item set reorder_level = 200 where sku = 'ESP32'`);
await expectVal('low-stock task raised when available < reorder level', `select ops.raise_low_stock_tasks()`, 1);
await expectVal('low-stock task is not duplicated', `select ops.raise_low_stock_tasks()`, 0);

console.log('\nTraining and product');
await db.exec(`
  insert into ops.contact(id, institution_id, full_name) values ('dddddddd-0000-0000-0000-000000000001','${inst2}','Teacher A');
  insert into ops.training_program(id,name,audience) values ('22222222-2222-2222-2222-222222222222','Teacher L1','school_teacher');
  insert into ops.enrollment(program_id, contact_id, institution_id) values ('22222222-2222-2222-2222-222222222222','dddddddd-0000-0000-0000-000000000001','${inst2}');
`);
await db.exec(`update ops.enrollment set status='certified', certified_at=now() where contact_id='dddddddd-0000-0000-0000-000000000001'`);
await expectVal('all teachers certified -> teachers_trained', `select stage from ops.institution where id='${inst2}'`, 'teachers_trained');
await db.exec(`
  insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000c1');
  insert into ops.staff(id, full_name, email, role, departments) values ('00000000-0000-0000-0000-0000000000c1','PM','pm@x.in','member','{product}');
`);
await db.exec(`
  insert into ops.ph_session(recording_id, rage_clicks, console_errors, replay_url)
    select 'r'||g, g, 0, 'https://ph/r'||g from generate_series(1,40) g;
  insert into ops.review_item(recording_id, reason) select 'r'||g, 'rage_click' from generate_series(1,40) g;
`);
await expectVal('review queue assigns the daily quota to the one product reviewer',
  `select ops.assign_review_queue(current_date, 15)`, 15);
await expectVal('highest-signal sessions go first', `select min(rage_clicks) from ops.review_item ri join ops.ph_session s using (recording_id) where ri.assigned_to is not null`, 26);
await db.exec(`
  insert into ops.observation(review_item_id, tag, severity, note, created_by)
  select id, 'friction', 2, 'cannot find Flash button', '00000000-0000-0000-0000-0000000000c1' from ops.review_item where assigned_to is not null limit 1;
`);
await expectVal('observation marks the item reviewed', `select count(*) from ops.review_item where status='reviewed'`, 1);
await expectVal('request_part dedupes', `select ops.request_part('BME280')::text is not null and ops.request_part(' bme280 ')::text is not null`, true);
await expectVal('request_part counts', `select request_count from ops.catalog_request where part_query='bme280'`, 2);
await db.exec(`insert into ops.feedback(source, body) values ('workshop_survey','Great labs')`);
await expectVal('feedback auto-routed', `select owner_department from ops.feedback where body='Great labs'`, 'workshop');

console.log('\nRow level security');
const cnt = async (uid, tbl) => (await run(uid, `select count(*)::int as c from ops.${tbl}`)).rows[0].c;
const eq = async (name, uid, tbl, want) => { try { const g = await cnt(uid, tbl); g === want ? ok(name) : bad(name, `got ${g}, want ${want}`); } catch (e) { bad(name, msg(e)); } };
await eq('partner sees only own deals', P, 'deal', 1);
await eq('partner sees only their own institution', P, 'institution', 1);
await eq('partner sees no inventory', P, 'item', 0);
await eq('partner sees no stock movements', P, 'stock_movement', 0);
await eq('partner sees only themselves in staff', P, 'staff', 1);
await eq('partner cannot read audit log', P, 'audit_log', 0);
await eq('sales member sees no stock', S, 'stock_movement', 0);
await eq('sales member sees all deals', S, 'deal', 1);
await eq('workshop lead sees the stock ledger', W, 'item', 2);
await eq('outreach member cannot see deals', O, 'deal', 0);
{ const g = await cnt(F, 'audit_log'); g > 0 ? ok('founder reads the audit log') : bad('founder reads the audit log', 'empty'); }
await expectErr('viewer cannot write', V, `insert into ops.deal(institution_id,kind,title,owner_id) values ('${inst}','workshop','x','${V}')`, 'row-level security');
{
  const r = await run(S, `update ops.staff set role='founder' where id='${S}' returning id`);
  r.rows.length === 0 ? ok('member cannot promote themselves') : bad('member cannot promote themselves', 'update succeeded');
}
await expectErr('member cannot call service-only job', S, `select ops.assign_review_queue()`, 'permission denied');
await eq('a signed-in user with no staff row sees nothing', '99999999-0000-0000-0000-000000000009', 'institution', 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
