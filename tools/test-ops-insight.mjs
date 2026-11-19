// Operations insight (0026): working days, early / on time / late, the original deadline, the backlog snapshot.
// Called from test-migrations.mjs.
export default async function opsInsightTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, val, F, S, W, T2, P, V } = t;

  console.log('\nOperations insight (0026)');

  console.log('Working days (Saturday and Sunday are off)');
  await expectVal('a Monday to Sunday week has five working days', `select ops.working_days('2026-11-16', '2026-11-22')`, 5);
  await expectVal('a weekend alone has none', `select ops.working_days('2026-11-21', '2026-11-22')`, 0);
  await expectVal('Friday to Monday is two', `select ops.working_days('2026-11-20', '2026-11-23')`, 2);
  await expectVal('a backwards range is zero, not an error', `select ops.working_days('2026-11-23', '2026-11-20')`, 0);

  console.log('Early, on time, late (Indian time)');
  const bucket = (fin, due, tm) => val(`select ops.task_bucket(${fin}, ${due}, ${tm})`);
  const check = async (name, got, want) => (got === want ? ok(name) : bad(name, `${got}, want ${want}`));
  await check('the day before the deadline is early', await bucket(`'2026-11-18 10:00+05:30'::timestamptz`, `'2026-11-19'::date`, 'null::time'), 'early');
  await check('the deadline day with no time is on time', await bucket(`'2026-11-18 23:30+05:30'::timestamptz`, `'2026-11-18'::date`, 'null::time'), 'on_time');
  await check('after a deadline time on the day is late', await bucket(`'2026-11-18 10:00+05:30'::timestamptz`, `'2026-11-18'::date`, `'09:00'::time`), 'late');
  await check('before a deadline time on the day is on time', await bucket(`'2026-11-18 10:00+05:30'::timestamptz`, `'2026-11-18'::date`, `'11:00'::time`), 'on_time');
  await check('just after midnight in India is the next day, so late', await bucket(`'2026-11-18 20:00+00'::timestamptz`, `'2026-11-18'::date`, 'null::time'), 'late');
  await check('no deadline has no bucket', await bucket(`'2026-11-18 10:00+05:30'::timestamptz`, 'null::date', 'null::time'), null);
  await check('unfinished has no bucket', await bucket('null::timestamptz', `'2026-11-18'::date`, 'null::time'), null);

  console.log('One row per task');
  const mk = async (name, uid, cols, vals) => {
    const r = await expectOk(name, uid, `insert into ops.task (${cols}) values (${vals}) returning id`);
    return r?.rows[0]?.id;
  };
  const finish = async (id, at) => {
    await db.exec(`update ops.task set status = 'doing' where id = '${id}'`);
    await db.exec(`update ops.task set status = 'done' where id = '${id}'`);
    // The guard keeps completed_at honest, so backdating for the test goes around triggers.
    await db.exec(`set session_replication_role = replica; update ops.task set completed_at = '${at}' where id = '${id}'; set session_replication_role = origin;`);
  };
  const A = await mk('an early task', F, 'department, title, assignee_id, due_date', `'sales','ZZ Ins early','${S}','2026-11-20'`);
  const B = await mk('an on-time task', F, 'department, title, assignee_id, due_date', `'sales','ZZ Ins on time','${S}','2026-11-19'`);
  const C = await mk('a late task (due Friday)', F, 'department, title, assignee_id, due_date', `'sales','ZZ Ins late','${S}','2026-11-13'`);
  const D = await mk('a task whose deadline will move', F, 'department, title, assignee_id, due_date', `'sales','ZZ Ins moved','${S}','2026-11-13'`);
  const E = await mk('a task with no deadline', F, 'department, title, assignee_id', `'sales','ZZ Ins no date','${S}'`);
  const G = await mk('a task whose deadline is added later', F, 'department, title, assignee_id', `'sales','ZZ Ins added','${S}'`);
  const H = await mk('a workshop task', F, 'department, title, assignee_id, due_date', `'workshop','ZZ Ins workshop','${T2}','2026-11-30'`);
  await db.exec(`update ops.task set due_date = '2026-11-20' where id = '${D}'`);
  await db.exec(`update ops.task set due_date = '2026-11-12' where id = '${G}'`);
  await db.exec(`update ops.task set due_date = '2026-11-30' where id = '${G}'`);
  await finish(A, '2026-11-19 10:00+05:30');
  await finish(B, '2026-11-19 16:00+05:30');
  await finish(C, '2026-11-16 11:00+05:30');
  await finish(D, '2026-11-18 11:00+05:30');
  await finish(E, '2026-11-18 11:00+05:30');
  await finish(G, '2026-11-15 11:00+05:30');
  const row = async (id, col) => val(`select ${col} from ops.v_task_timeliness where task_id = '${id}'`);

  await check('early', await row(A, 'bucket'), 'early');
  await check('on time', await row(B, 'bucket'), 'on_time');
  await check('late', await row(C, 'bucket'), 'late');
  await check('Friday deadline, done Monday: one working day late', await row(C, 'days_late'), 1);
  await check('the finish day is in Indian time', await row(A, 'done_day::text'), '2026-11-19');
  await check('a moved deadline is judged on the ORIGINAL one: late', await row(D, 'bucket'), 'late');
  await check('...against the new one it would have been early', await row(D, 'bucket_now'), 'early');
  await check('...the original deadline is kept', await row(D, 'original_due_date::text'), '2026-11-13');
  await check('...and the move is counted', await row(D, 'reschedules'), 1);
  await check('a task with no deadline has no bucket', await row(E, 'bucket'), null);
  await check('a deadline added later counts from when it was first set', await row(G, 'original_due_date::text'), '2026-11-12');
  await check('...so finishing after it is late', await row(G, 'bucket'), 'late');
  await check('...and moving it later is counted as a reschedule', await row(G, 'reschedules'), 1);
  await check('an open task has no bucket', await row(H, 'bucket'), null);
  await expectVal('the first start is remembered', `select started_at is not null from ops.v_task_timeliness where task_id = '${A}'`, true);

  console.log('Blocked and logged time');
  await db.exec(`update ops.task set status = 'blocked', blocked_reason = 'waiting for approval' where id = '${H}'`);
  await db.exec(`update ops.task set status = 'doing' where id = '${H}'`);
  await db.exec(`update ops.task_history set at = now() - interval '3 hours' where task_id = '${H}' and kind = 'status' and to_value = 'blocked'`);
  await db.exec(`update ops.task_history set at = now() - interval '1 hour' where task_id = '${H}' and kind = 'status' and to_value = 'doing'`);
  await expectVal('time spent blocked is the gap to the next status change', `select blocked_minutes between 119 and 121 from ops.v_task_timeliness where task_id = '${H}'`, true);
  await db.exec(`insert into ops.time_entry (staff_id, task_id, source, work_date, minutes) values ('${T2}', '${H}', 'manual', (now() at time zone 'Asia/Kolkata')::date, 45)`);
  await expectVal('logged time adds up', `select logged_minutes from ops.v_task_timeliness where task_id = '${H}'`, 45);

  console.log('Who sees which rows');
  const seen = async (uid) => (await run(uid, `select count(*)::int n from ops.v_task_timeliness where title like 'ZZ Ins %'`)).rows[0].n;
  const n = async (name, uid, want) => {
    try { const g = await seen(uid); g === want ? ok(name) : bad(name, `${g} rows, want ${want}`); } catch (e) { bad(name, e.message); }
  };
  await n('the founder sees every task', F, 7);
  await n('a Sales member sees the Sales tasks only', S, 6);
  await n('the Workshop lead sees the Workshop task only', W, 1);
  await n('a partner sees nothing', P, 0);

  console.log('The backlog snapshot');
  const today = `(now() at time zone 'Asia/Kolkata')::date`;
  await mk('an open, overdue Sales task', F, 'department, title, assignee_id, due_date', `'sales','ZZ Ins open late','${S}', ${today} - 2`);
  await mk('an open Sales task with no owner', F, 'department, title, due_date', `'sales','ZZ Ins unowned', ${today} + 5`);
  await db.exec(`select ops.run_job('kpi_snapshot')`);
  await expectVal('open work is counted per department and person',
    `select open_count = (select count(*) from ops.task where status in ('todo','doing','blocked') and department = 'sales' and assignee_id = '${S}')
       from ops.backlog_snapshot where snapshot_date = ${today} and department = 'sales' and assignee_id = '${S}'`, true);
  await expectVal('overdue means past its deadline at the start of the day',
    `select overdue_count = (select count(*) from ops.task where status in ('todo','doing','blocked') and department = 'sales' and assignee_id = '${S}' and due_date < ${today})
       from ops.backlog_snapshot where snapshot_date = ${today} and department = 'sales' and assignee_id = '${S}'`, true);
  await expectVal('work with no owner has its own row', `select count(*) >= 1 from ops.backlog_snapshot where snapshot_date = ${today} and department = 'sales' and assignee_id is null`, true);
  const before = await val(`select count(*) from ops.backlog_snapshot where snapshot_date = ${today}`);
  await db.exec(`select ops.run_job('kpi_snapshot')`);
  await expectVal('running it again the same day does not duplicate rows', `select count(*) = ${before} from ops.backlog_snapshot where snapshot_date = ${today}`, true);
  await db.exec(`select ops.write_kpi_snapshot(${today} - 3)`);
  await expectVal('an older day is kept', `select count(*) > 0 from ops.backlog_snapshot where snapshot_date = ${today} - 3`, true);
  {
    const f = (await run(F, `select count(*)::int n from ops.backlog_snapshot`)).rows[0].n;
    const s = (await run(S, `select count(*)::int n from ops.backlog_snapshot`)).rows[0].n;
    const w = (await run(W, `select count(*)::int n from ops.backlog_snapshot`)).rows[0].n;
    const wSales = (await run(W, `select count(*)::int n from ops.backlog_snapshot where department = 'sales'`)).rows[0].n;
    f > 0 ? ok('the founder reads the backlog') : bad('the founder reads the backlog', 'none');
    s === 0 ? ok('a member reads none of it') : bad('a member reads none of it', `${s} rows`);
    w > 0 && w < f && wSales === 0 ? ok('a lead reads only their own departments') : bad('a lead reads only their own departments', `${w} of ${f}, ${wSales} Sales`);
  }
  await expectErr('nobody edits the backlog by hand', F, `insert into ops.backlog_snapshot values (current_date, 'sales', null, 1, 1, 1, 1)`, 'row-level security');
  await expectErr('a viewer cannot read job-only functions', V, `select ops.write_kpi_snapshot()`, 'permission denied');
}
