// The funnel and student steps the Cockpit reads (0025), and the snapshot rows built from them. Called from test-migrations.mjs.
export default async function cockpitTests(t) {
  const { db, run, ok, bad, expectErr, expectVal, val, F, S, P } = t;
  const rows = async (uid, sql) => (await run(uid, sql)).rows;

  console.log('\nCockpit funnel (0025)');
  const reached = async (_uid, seg, step) =>
    Number(await val(`select institutions from ops.v_funnel_steps where segment = '${seg}' and step = '${step}'`));

  const base = {};
  for (const step of ['contacted', 'qualified', 'deal_won', 'workshop_delivered', 'teachers_trained', 'active']) base[step] = await reached(null, 'school', step);

  const mk = async (name, stage) => {
    const id = await val(`insert into ops.institution (name, kind, city) values ('${name}', 'school', 'Pune') returning id`);
    if (stage !== 'prospect') await db.exec(`update ops.institution set stage = '${stage}' where id = '${id}'`);
    return id;
  };
  await mk('ZZ Funnel Prospect', 'prospect');
  await mk('ZZ Funnel Qualified', 'qualified');
  await mk('ZZ Funnel Won', 'deal_won');
  await mk('ZZ Funnel Trained', 'teachers_trained');
  await mk('ZZ Funnel Lab', 'lab_customer');
  await mk('ZZ Funnel Churned', 'churned');

  const grow = async (step) => (await reached(null, 'school', step)) - base[step];
  (await grow('contacted')) === 4 ? ok('a prospect is not counted as contacted, later stages are') : bad('a prospect is not counted as contacted', `${await grow('contacted')}`);
  (await grow('qualified')) === 4 ? ok('every later stage counts as having reached "qualified"') : bad('reached qualified', `${await grow('qualified')}`);
  (await grow('deal_won')) === 3 ? ok('deal won counts won, trained and lab customers') : bad('reached deal won', `${await grow('deal_won')}`);
  (await grow('teachers_trained')) === 2 ? ok('teachers trained counts trained and lab customers') : bad('reached teachers trained', `${await grow('teachers_trained')}`);
  (await grow('active')) === 1 ? ok('a lab customer counts as having reached active') : bad('reached active', `${await grow('active')}`);
  {
    const r = await rows(F, `select count(*)::int n from ops.v_funnel_steps`);
    r[0].n === 18 ? ok('every segment shows all six steps, even with none reached') : bad('six steps for three segments', `${r[0].n}`);
  }
  await db.exec(`update ops.institution set archived_at = now() where name = 'ZZ Funnel Won'`);
  (await grow('deal_won')) === 2 ? ok('an archived institution drops out of the funnel') : bad('archived drops out', `${await grow('deal_won')}`);

  console.log('Student steps from the IDE');
  await db.exec(`delete from ops.ide_user_snapshot`);
  {
    const r = await rows(F, `select * from ops.ide_funnel()`);
    r[0].connected === false && r[0].students_signed_up === 0 ? ok('no IDE sync yet reads as not connected') : bad('not connected without a sync', JSON.stringify(r));
  }
  await db.exec(`insert into ops.ide_user_snapshot (ide_user_id, signed_up_at, first_compile_at, first_flash_at, first_publish_at) values
    ('zz-1', now(), now(), now(), now()), ('zz-2', now(), now(), null, null), ('zz-3', now(), null, null, null)`);
  {
    const r = await rows(F, `select * from ops.ide_funnel()`);
    const x = r[0];
    x.connected && x.students_signed_up === 3 && x.compiled === 2 && x.flashed === 1 && x.published === 1
      ? ok('student steps count each stage reached') : bad('student steps', JSON.stringify(x));
  }
  {
    const r = await rows(S, `select connected from ops.ide_funnel()`);
    r[0].connected === true ? ok('a member outside Workshop still sees the true totals, not "not connected"') : bad('member sees totals', JSON.stringify(r));
  }
  await expectErr('a partner cannot read the student steps', P, `select * from ops.ide_funnel()`, 'Not allowed');

  console.log('Funnel rows in the snapshot');
  await db.exec(`select ops.run_job('kpi_snapshot')`);
  const today = `(now() at time zone 'Asia/Kolkata')::date`;
  await expectVal('the snapshot keeps the six funnel steps', `select count(*) = 6 from ops.kpi_snapshot where snapshot_date = ${today} and metric = 'funnel_reached'`, true);
  await expectVal('...and the totals match the view', `select value = (select sum(institutions) from ops.v_funnel_steps where step = 'qualified') from ops.kpi_snapshot where snapshot_date = ${today} and metric = 'funnel_reached' and dimension = 'qualified'`, true);
  await expectVal('student rows are written once the IDE has sent someone', `select value = 3 from ops.kpi_snapshot where snapshot_date = ${today} and metric = 'ide_students' and dimension = 'signed_up'`, true);
  await db.exec(`delete from ops.ide_user_snapshot`);
  await db.exec(`select ops.run_job('kpi_snapshot')`);
  await expectVal('with no IDE data there are no student rows, not zeros', `select count(*) = 0 from ops.kpi_snapshot where snapshot_date = ${today} and metric = 'ide_students'`, true);
}
