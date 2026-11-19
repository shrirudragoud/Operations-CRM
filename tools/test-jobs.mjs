// Scheduled jobs, the job log and the nightly KPI snapshot (0024). Called from test-migrations.mjs.
export default async function jobTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, val, F, S, W } = t;

  console.log('\nJobs and the KPI snapshot (0024)');
  const today = `(now() at time zone 'Asia/Kolkata')::date`;

  console.log('Who can run a job');
  await expectErr('a member cannot run a job', S, `select ops.run_job('kpi_snapshot')`, 'permission denied');
  await expectErr('the founder cannot run a job from the app either', F, `select ops.run_job('kpi_snapshot')`, 'permission denied');
  await expectErr('a member cannot write a snapshot', S, `select ops.write_kpi_snapshot()`, 'permission denied');
  await expectErr('an unknown job name is refused', null, `select ops.run_job('drop_everything')`, 'Unknown job');

  console.log('The KPI snapshot');
  await db.exec(`insert into ops.institution (name, kind, city) values ('ZZ Snapshot College', 'engineering_college', 'Pune')`);
  const r1 = await val(`select ops.run_job('kpi_snapshot')->>'status'`);
  r1 === 'ok' ? ok('the snapshot job runs') : bad('the snapshot job runs', r1);
  await expectVal('it records every institution', `select value = (select count(*) from ops.institution where archived_at is null) from ops.kpi_snapshot where snapshot_date = ${today} and metric = 'institutions' and dimension = 'all'`, true);
  await expectVal('it records the open pipeline value', `select value = (select coalesce(sum(value_inr),0) from ops.deal where stage in ('meeting','proposal','negotiation') and archived_at is null) from ops.kpi_snapshot where snapshot_date = ${today} and metric = 'pipeline_value_inr'`, true);
  const before = await val(`select count(*) from ops.kpi_snapshot where snapshot_date = ${today}`);
  await db.exec(`select ops.run_job('kpi_snapshot')`);
  await expectVal('running it again the same day does not duplicate rows', `select count(*) = ${before} from ops.kpi_snapshot where snapshot_date = ${today}`, true);
  await db.exec(`select ops.write_kpi_snapshot(${today} - 3)`);
  await db.exec(`select ops.run_job('kpi_snapshot')`);
  await expectVal('an older day is kept when today is rewritten', `select count(*) > 0 from ops.kpi_snapshot where snapshot_date = ${today} - 3`, true);
  {
    const f = await run(F, `select count(*)::int n from ops.kpi_snapshot`);
    const m = await run(S, `select count(*)::int n from ops.kpi_snapshot`);
    f.rows[0].n > 0 ? ok('the founder reads snapshot rows') : bad('the founder reads snapshot rows', 'none');
    m.rows[0].n === 0 ? ok('a member reads no snapshot rows') : bad('a member reads no snapshot rows', `${m.rows[0].n} rows`);
  }
  await expectErr('nobody edits a snapshot by hand', F, `insert into ops.kpi_snapshot values (current_date, 'x', 'all', 1)`, 'row-level security');

  console.log('The job log');
  await expectVal('a run is logged as ok with a finish time', `select status = 'ok' and finished_at is not null from ops.job_run where job = 'kpi_snapshot' order by started_at desc limit 1`, true);
  const ta = await val(`select ops.run_job('task_automation')->>'status'`);
  ta === 'ok' ? ok('task automation runs with no signed-in user') : bad('task automation runs with no signed-in user', ta);
  const ls = await val(`select ops.run_job('low_stock')->>'status'`);
  ls === 'ok' ? ok('low-stock check runs') : bad('low-stock check runs', ls);

  console.log('A failing job');
  await db.exec(`alter function ops.raise_low_stock_tasks() rename to raise_low_stock_tasks_real;
                 create function ops.raise_low_stock_tasks() returns int language plpgsql as $$ begin raise exception 'ZZ boom'; end $$;`);
  const bad1 = await val(`select ops.run_job('low_stock')->>'status'`);
  await db.exec(`drop function ops.raise_low_stock_tasks(); alter function ops.raise_low_stock_tasks_real() rename to raise_low_stock_tasks;`);
  bad1 === 'failed' ? ok('a failing job is reported as failed, not thrown') : bad('a failing job is reported as failed, not thrown', bad1);
  await expectVal('the error is kept in the log', `select status = 'failed' and error like '%ZZ boom%' from ops.job_run where job = 'low_stock' order by started_at desc limit 1`, true);
  await expectVal('...and the next good run is ok again', `select ops.run_job('low_stock')->>'status' = 'ok'`, true);

  console.log('A run that died');
  await db.exec(`insert into ops.job_run (job, status, started_at) values ('kpi_snapshot', 'running', now() - interval '3 hours')`);
  await db.exec(`select ops.run_job('kpi_snapshot')`);
  await expectVal('it is closed as failed on the next run', `select count(*) = 1 from ops.job_run where job = 'kpi_snapshot' and status = 'failed' and error = 'Did not finish'`, true);

  console.log('Job health');
  await db.exec(`select ops.run_job('attendance_retention')`);
  await expectErr('a lead cannot read job health', W, `select * from ops.job_health()`, 'Only the founder');
  {
    const r = await run(F, `select job, last_status, overdue from ops.job_health() order by job`);
    r.rows.length === 4 ? ok('the founder sees the four jobs') : bad('the founder sees the four jobs', `${r.rows.length} rows`);
    r.rows.every((x) => x.overdue === false) ? ok('none is overdue right after running') : bad('none is overdue right after running', JSON.stringify(r.rows));
  }
  await db.exec(`delete from ops.job_run where job = 'low_stock'`);
  {
    const r = await run(F, `select overdue from ops.job_health() where job = 'low_stock'`);
    r.rows[0].overdue === true ? ok('a job that never ran is overdue') : bad('a job that never ran is overdue', JSON.stringify(r.rows));
  }

  console.log('Attendance retention');
  const old = await val(`insert into ops.attendance_session (staff_id, work_date, check_in_at, check_out_at, in_source, out_source)
    select id, ${today} - 800, now() - interval '800 days', now() - interval '800 days' + interval '6 hours', 'manual', 'correction' from ops.staff limit 1 returning id`);
  const fresh = await val(`insert into ops.attendance_session (staff_id, work_date, check_in_at, check_out_at, in_source, out_source)
    select id, ${today} - 30, now() - interval '30 days', now() - interval '30 days' + interval '6 hours', 'manual', 'correction' from ops.staff limit 1 returning id`);
  await db.exec(`insert into ops.attendance_failure (staff_id, attempted_at) select id, now() - interval '120 days' from ops.staff limit 1`);
  const rr = await val(`select ops.run_job('attendance_retention')->>'status'`);
  rr === 'ok' ? ok('the retention job runs') : bad('the retention job runs', rr);
  await expectVal('a day from over two years ago is removed', `select count(*) = 0 from ops.attendance_session where id = '${old}'`, true);
  await expectVal('a recent day is kept', `select count(*) = 1 from ops.attendance_session where id = '${fresh}'`, true);
  await expectVal('its audit copies are removed too', `select count(*) = 0 from ops.audit_log where table_name = 'attendance_session' and row_id = '${old}'`, true);
  await expectVal('the recent day keeps its audit trail', `select count(*) > 0 from ops.audit_log where table_name = 'attendance_session' and row_id = '${fresh}'`, true);
  await expectVal('old failed attempts are removed', `select count(*) = 0 from ops.attendance_failure where attempted_at < now() - interval '90 days'`, true);
}
