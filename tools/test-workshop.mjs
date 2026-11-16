// Workshop guards (0017). Called from test-migrations.mjs after the core tests.
export default async function workshopTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, val, F, S, W, T2, P, V } = t;

  console.log('\nWorkshop guards (0017)');
  const T3 = '00000000-0000-0000-0000-000000000008'; // active, not certified
  const GONE = '00000000-0000-0000-0000-000000000009'; // deactivated
  await db.exec(`
    insert into auth.users(id) values ('${T3}'),('${GONE}');
    insert into ops.staff(id, full_name, email, role, departments, is_active) values
      ('${T3}','Trainer Three','t3@x.in','member','{workshop}', true),
      ('${GONE}','Former Trainer','gone@x.in','member','{workshop}', false);
  `);
  const inst = await val(`insert into ops.institution(name,kind,city) values ('Workshop Guard College','engineering_college','Nashik') returning id`);
  const mk = (title, lead, from, to) => val(`insert into ops.event(institution_id,kind,title,lead_trainer_id,starts_at,ends_at,venue,expected_headcount)
    values ('${inst}','college_workshop','${title}', ${lead ? `'${lead}'` : 'null'}, now() + interval '${from} days', now() + interval '${to} days', 'Hall', 40) returning id`);
  const team = (uid, ev, lead, assistants) =>
    `select ops.set_event_team('${ev}', ${lead ? `'${lead}'` : 'null'}, array[${assistants.map((a) => `'${a}'`).join(',')}]::uuid[])`;

  const A = await mk('Guard A', null, 50, 51);

  await expectErr('a sales member cannot change an event team', S, team(S, A, W, []), 'permission');
  await expectErr('a viewer cannot change an event team', V, team(V, A, W, []), 'permission');
  await expectErr('a partner cannot change an event team', P, team(P, A, W, []), 'permission');
  await expectErr('the lead must be certified (or the founder)', T2, team(T2, A, T3, []), 'not certified');
  await expectErr('the lead cannot also be an assistant', T2, team(T2, A, W, [W]), 'cannot also be');
  await expectErr('at most 2 assistants', T2, team(T2, A, W, [T2, T3, F]), 'at most 2');
  await expectErr('a partner cannot be an assistant', T2, team(T2, A, W, [P]), 'active member');
  await expectErr('a deactivated person cannot be an assistant', T2, team(T2, A, W, [GONE]), 'active member');
  await expectOk('a Workshop member saves lead + assistant in one step', T2, team(T2, A, W, [T3]));
  await expectVal('the team was written', `select (select lead_trainer_id from ops.event where id='${A}') = '${W}' and (select count(*) from ops.event_staff where event_id='${A}') = 1`, true);
  await expectOk('...and replaced as a set (assistant removed)', T2, team(T2, A, W, []));
  await expectVal('no assistants left', `select count(*) from ops.event_staff where event_id='${A}'`, 0);
  await expectErr('direct inserts obey the 2-assistant cap', W,
    `insert into ops.event_staff(event_id,staff_id) values ('${A}','${T3}'),('${A}','${T2}'),('${A}','${F}')`, 'at most 2');
  await db.exec(`delete from ops.event_staff where event_id='${A}'`);
  await db.exec(`insert into ops.event_staff(event_id,staff_id) values ('${A}','${T3}')`);
  await expectErr('direct updates cannot make an assistant the lead', W,
    `update ops.event set lead_trainer_id='${T3}' where id='${A}'`, 'cannot also be');
  await db.exec(`delete from ops.event_staff where event_id='${A}'`);

  console.log('\nScheduling checks assistants too');
  await expectOk('team for A: lead W, assistant T3', W, team(W, A, W, [T3]));
  await expectOk('A is scheduled', W, `update ops.event set status='scheduled' where id='${A}'`);
  const B = await mk('Guard B', F, 60, 61);
  await expectOk('team for B: lead founder, assistant T3', F, team(F, B, F, [T3]));
  await expectOk('B is scheduled', F, `update ops.event set status='scheduled' where id='${B}'`);
  await expectErr('moving A onto B double-books the assistant', W,
    `update ops.event set starts_at = now() + interval '60 days', ends_at = now() + interval '61 days' where id='${A}'`, 'assistant trainer three is already booked');
  const G = await mk('Guard G', T2, 60, 61);
  await expectOk('G gets assistant W', W, team(W, G, T2, [W]));
  await expectErr('the team RPC refuses a busy assistant', W, team(W, G, T2, [T3]), 'already booked');
  await expectVal('...and keeps the old team (atomic)', `select string_agg(staff_id::text, ',') from ops.event_staff where event_id='${G}'`, W);
  await expectVal('A still has its team and dates', `select (lead_trainer_id='${W}') and (select count(*) from ops.event_staff where event_id='${A}')=1 and starts_at < now() + interval '55 days' from ops.event where id='${A}'`, true);

  const C = await mk('Guard C', T2, 70, 71);
  await db.exec(`update ops.event set starts_at = null, ends_at = null where id='${C}'`);
  await db.exec(`insert into ops.event_staff(event_id, staff_id) values ('${C}','${T3}')`);
  await db.exec(`update ops.event set starts_at = now() + interval '60 days', ends_at = now() + interval '61 days' where id='${C}'`);
  await expectErr('scheduling a draft whose assistant is busy is refused', W, `update ops.event set status='scheduled' where id='${C}'`, 'assistant trainer three is already booked');

  console.log('\nRun sheet stamps');
  const item = await val(`select id from ops.run_sheet_item where event_id='${A}' and phase='pre' order by sort limit 1`);
  await expectOk('a member ticks an item, trying to forge the stamp', T2,
    `update ops.run_sheet_item set done_at = '2020-01-01', done_by = '${F}' where id='${item}'`);
  await expectVal('the database stamped the real person and time',
    `select done_by = '${T2}' and done_at > now() - interval '1 minute' from ops.run_sheet_item where id='${item}'`, true);
  await expectOk('re-saving a ticked item cannot change who ticked it', W,
    `update ops.run_sheet_item set done_by = '${W}', done_at = now() - interval '5 days' where id='${item}'`);
  await expectVal('the first stamp is kept', `select done_by = '${T2}' from ops.run_sheet_item where id='${item}'`, true);
  await expectOk('unticking clears the stamp', W, `update ops.run_sheet_item set done_at = null where id='${item}'`);
  await expectVal('no leftover done_by', `select done_by is null from ops.run_sheet_item where id='${item}'`, true);
  await expectErr('an item cannot be moved to another event', W, `update ops.run_sheet_item set event_id='${B}' where id='${item}'`, 'another event');

  console.log('\nCancelling needs a reason');
  await expectErr('cancelling without a reason is refused', W, `update ops.event set status='cancelled' where id='${A}'`, 'reason is required');
  await expectErr('a blank reason is refused', W, `update ops.event set status='cancelled', cancel_reason='   ' where id='${A}'`, 'reason is required');
  await expectOk('cancelling with a reason works', W, `update ops.event set status='cancelled', cancel_reason='College postponed the camp' where id='${A}'`);
  await expectErr('the team of a cancelled event is frozen', W, team(W, A, T2, []), 'cannot be changed');
  await expectErr('run sheet items of a cancelled event are frozen', W, `update ops.run_sheet_item set done_at = now() where id='${item}'`, 'cancelled event');
  await expectErr('a cancelled event cannot be reopened', W, `update ops.event set status='draft' where id='${A}'`, 'cannot move');
  await expectOk('a draft can be cancelled with a reason', W, `update ops.event set status='cancelled', cancel_reason='Duplicate' where id='${C}'`);

  console.log('\nIn-progress events keep the rules');
  const D = await mk('Guard D', W, 80, 81);
  await expectOk('D scheduled', W, `update ops.event set status='scheduled' where id='${D}'`);
  await expectOk('D started', W, `update ops.event set status='in_progress' where id='${D}'`);
  await expectOk('headcount can be edited while in progress', W, `update ops.event set actual_headcount = 35 where id='${D}'`);
  const E = await mk('Guard E', F, 90, 91);
  await expectOk('E scheduled', F, `update ops.event set status='scheduled' where id='${E}'`);
  await expectOk('E started', F, `update ops.event set status='in_progress' where id='${E}'`);
  await expectErr('an in-progress event cannot be moved onto another trainer booking', F,
    `update ops.event set lead_trainer_id='${W}', starts_at = now() + interval '80 days', ends_at = now() + interval '81 days' where id='${E}'`, 'already booked');
}
