// Time tracking and the daily log (0020). Called from test-migrations.mjs after the task tests.
export default async function timeTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, val, F, S, W, T2, P, V, O } = t;

  console.log('\nTime tracking and daily log (0020)');
  const rows = async (uid, sql) => (await run(uid, sql)).rows.length;
  const expectRows = async (name, uid, sql, want) => {
    const n = await rows(uid, sql);
    n === want ? ok(name) : bad(name, `${n} rows, want ${want}`);
  };
  const mk = async (name, uid, cols, vals) => {
    const r = await expectOk(name, uid, `insert into ops.task (${cols}) values (${vals}) returning id`);
    return r?.rows[0]?.id;
  };
  const today = `(now() at time zone 'Asia/Kolkata')::date`;

  const w1 = await mk('a Workshop task for a trainer', F, 'department, title, assignee_id', `'workshop','ZZ Calibrate kits','${T2}'`);
  const w2 = await mk('a second Workshop task', F, 'department, title, assignee_id', `'workshop','ZZ Pack kits','${T2}'`);
  const s1 = await mk('a Sales task for a salesperson', F, 'department, title, assignee_id', `'sales','ZZ Quote','${S}'`);

  console.log('Timer');
  const t1 = (await expectOk('the assignee starts a timer', T2, `insert into ops.time_entry (task_id, source) values ('${w1}', 'timer') returning id`))?.rows[0]?.id;
  await expectVal('the database stamps the person, the start and the day',
    `select staff_id = '${T2}' and started_at is not null and ended_at is null and minutes is null and work_date = ${today} from ops.time_entry where id='${t1}'`, true);
  const spoof = (await expectOk('a spoofed person and start are ignored', T2,
    `insert into ops.time_entry (task_id, source, staff_id, started_at, work_date) values ('${w2}', 'timer', '${F}', now() - interval '5 hours', current_date - 3) returning id`))?.rows[0]?.id;
  await expectVal('...the entry is mine, starting now',
    `select staff_id = '${T2}' and started_at > now() - interval '1 minute' and work_date = ${today} from ops.time_entry where id='${spoof}'`, true);
  await expectVal('starting a second timer stopped the first', `select ended_at is not null and minutes >= 1 from ops.time_entry where id='${t1}'`, true);
  await expectVal('only one timer runs at a time', `select count(*) from ops.time_entry where staff_id='${T2}' and source='timer' and ended_at is null`, 1);
  await expectOk('the timer is stopped with a far-future end', T2, `update ops.time_entry set ended_at = now() + interval '5 hours' where id='${spoof}'`);
  await expectVal('...the database decides the end and length',
    `select ended_at <= now() and minutes between 1 and 2 from ops.time_entry where id='${spoof}'`, true);
  await expectOk('a stopped timer cannot be given more minutes', T2, `update ops.time_entry set minutes = 900 where id='${spoof}'`);
  await expectVal('...the length is unchanged', `select minutes between 1 and 2 from ops.time_entry where id='${spoof}'`, true);
  await expectErr('an entry cannot be moved to another task', T2, `update ops.time_entry set task_id = '${w2}' where id='${t1}'`, 'Only the length');
  await expectErr('a person who cannot see the task cannot track time on it', S, `insert into ops.time_entry (task_id, source) values ('${w1}', 'timer')`, 'row-level security');
  await expectErr('a partner cannot track time', P, `insert into ops.time_entry (task_id, source) values ('${w1}', 'timer')`, 'Only team members');
  await expectErr('a viewer cannot track time', V, `insert into ops.time_entry (task_id, source) values ('${s1}', 'timer')`, 'Only team members');

  console.log('Manual entries');
  const m1 = (await expectOk('a manual entry for yesterday', T2,
    `insert into ops.time_entry (task_id, source, work_date, minutes, note) values ('${w1}', 'manual', ${today} - 1, 90, 'ZZ kit calibration') returning id`))?.rows[0]?.id;
  await expectVal('...has no clock times', `select started_at is null and ended_at is null and minutes = 90 from ops.time_entry where id='${m1}'`, true);
  await expectErr('a future day is refused', T2, `insert into ops.time_entry (task_id, source, work_date, minutes) values ('${w1}', 'manual', ${today} + 1, 30)`, 'future day');
  await expectErr('more than 30 days back is refused', T2, `insert into ops.time_entry (task_id, source, work_date, minutes) values ('${w1}', 'manual', ${today} - 31, 30)`, 'last 30 days');
  await expectErr('zero minutes is refused', T2, `insert into ops.time_entry (task_id, source, work_date, minutes) values ('${w1}', 'manual', ${today}, 0)`, 'time_entry_minutes_check');
  await expectErr('more than 16 hours in one entry is refused', T2, `insert into ops.time_entry (task_id, source, work_date, minutes) values ('${w1}', 'manual', ${today}, 961)`, 'time_entry_minutes_check');
  await expectErr('a manual entry needs a length', T2, `insert into ops.time_entry (task_id, source, work_date) values ('${w1}', 'manual', ${today})`, 'how long');
  await expectOk('the person edits their own manual entry', T2, `update ops.time_entry set minutes = 120, note = 'ZZ longer' where id='${m1}'`);
  await expectVal('...it changed', `select minutes = 120 from ops.time_entry where id='${m1}'`, true);

  console.log('Who sees the time');
  await expectRows('the person sees their own entries', T2, `select id from ops.time_entry where task_id='${w1}'`, 2);
  await expectRows('the lead of the department sees them', W, `select id from ops.time_entry where task_id='${w1}'`, 2);
  await expectRows('the founder sees them', F, `select id from ops.time_entry where task_id='${w1}'`, 2);
  await expectRows('the creator of the task sees them', F, `select id from ops.time_entry where task_id='${w2}'`, 1);
  await expectRows('another department does not', S, `select id from ops.time_entry`, 0);
  await expectRows('a colleague on the same task cannot edit the entry', W, `update ops.time_entry set minutes = 1 where id='${m1}' returning id`, 0);
  await expectRows('a lead cannot delete a colleague\'s entry', W, `delete from ops.time_entry where id='${m1}' returning id`, 0);

  await expectOk('a long day is logged', T2, `insert into ops.time_entry (task_id, source, work_date, minutes) values ('${w2}', 'manual', ${today} - 2, 960)`);
  await expectErr('a day cannot hold more than 24 hours', T2, `insert into ops.time_entry (task_id, source, work_date, minutes) values ('${w2}', 'manual', ${today} - 2, 600)`, 'more than 24 hours');

  console.log('Edit window');
  await db.exec(`alter table ops.time_entry disable trigger t_time_entry_guard;
                 update ops.time_entry set work_date = current_date - 20 where id='${m1}';
                 alter table ops.time_entry enable trigger t_time_entry_guard;`);
  await expectRows('after 14 days the person can no longer edit it', T2, `update ops.time_entry set minutes = 10 where id='${m1}' returning id`, 0);
  await expectRows('...or delete it', T2, `delete from ops.time_entry where id='${m1}' returning id`, 0);
  await expectRows('the founder can still delete it', F, `delete from ops.time_entry where id='${m1}' returning id`, 1);

  console.log('Finishing a task');
  const t3 = (await expectOk('a timer runs on a task', T2, `insert into ops.time_entry (task_id, source) values ('${w1}', 'timer') returning id`))?.rows[0]?.id;
  await expectOk('the task is finished', T2, `update ops.task set status = 'done' where id='${w1}'`);
  await expectVal('...the timer stopped by itself', `select ended_at is not null and minutes >= 1 from ops.time_entry where id='${t3}'`, true);

  console.log('A forgotten timer');
  const t4 = (await expectOk('a timer is started and forgotten', T2, `insert into ops.time_entry (task_id, source) values ('${w2}', 'timer') returning id`))?.rows[0]?.id;
  await db.exec(`alter table ops.time_entry disable trigger t_time_entry_guard;
                 update ops.time_entry set started_at = now() - interval '13 hours', work_date = ${today} - 1 where id='${t4}';
                 alter table ops.time_entry enable trigger t_time_entry_guard;`);
  const res = await val(`select (ops.run_task_automation()->>'timers_stopped')::int`);
  Number(res) === 1 ? ok('the automation stops it') : bad('the automation stops it', `stopped ${res}`);
  await expectVal('...capped at 12 hours with a note', `select minutes = 720 and note like '%stopped automatically%' from ops.time_entry where id='${t4}'`, true);

  console.log('Daily log');
  const l1 = (await expectOk('a person writes today\'s log', T2,
    `insert into ops.daily_log (log_date, did, next_up, blockers) values (${today}, '  Calibrated 12 kits  ', 'Pack kits', '   ') returning id`))?.rows[0]?.id;
  await expectVal('the text is trimmed and an empty blocker is dropped', `select did = 'Calibrated 12 kits' and blockers is null from ops.daily_log where id='${l1}'`, true);
  await expectErr('one log per day', T2, `insert into ops.daily_log (log_date, did) values (${today}, 'again')`, 'daily_log_staff_id_log_date_key');
  await expectErr('a future log is refused', T2, `insert into ops.daily_log (log_date, did) values (${today} + 1, 'x')`, 'future day');
  await expectErr('a log older than 7 days is refused', T2, `insert into ops.daily_log (log_date, did) values (${today} - 8, 'x')`, 'last 7 days');
  await expectErr('a log needs text', T2, `insert into ops.daily_log (log_date, did) values (${today} - 1, '   ')`, 'daily_log_did_check');
  await expectOk('a spoofed person is ignored', T2, `insert into ops.daily_log (staff_id, log_date, did) values ('${F}', ${today} - 2, 'ZZ mine') returning id`);
  await expectVal('...the log is mine', `select count(*) from ops.daily_log where did = 'ZZ mine' and staff_id = '${T2}'`, 1);
  await expectOk('the person edits their log', T2, `update ops.daily_log set did = 'Calibrated 14 kits' where id='${l1}'`);
  await expectErr('the day cannot change', T2, `update ops.daily_log set log_date = ${today} - 1 where id='${l1}'`, 'can\'t change');
  await expectRows('the lead of their department reads it', W, `select id from ops.daily_log where id='${l1}'`, 1);
  await expectRows('the founder reads it', F, `select id from ops.daily_log where id='${l1}'`, 1);
  await expectRows('another department does not', S, `select id from ops.daily_log`, 0);
  await expectRows('nobody else edits it', W, `update ops.daily_log set did = 'x' where id='${l1}' returning id`, 0);
  await expectErr('a partner cannot write a log', P, `insert into ops.daily_log (log_date, did) values (${today}, 'x')`, 'Only team members');
  await expectErr('a viewer cannot write a log', V, `insert into ops.daily_log (log_date, did) values (${today}, 'x')`, 'Only team members');
  await db.exec(`alter table ops.daily_log disable trigger t_daily_log_guard;
                 update ops.daily_log set log_date = current_date - 10 where id='${l1}';
                 alter table ops.daily_log enable trigger t_daily_log_guard;`);
  await expectRows('after 7 days the log is locked', T2, `update ops.daily_log set did = 'late' where id='${l1}' returning id`, 0);
  void O;
}

