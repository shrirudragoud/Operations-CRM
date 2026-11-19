// HR foundations: the is_hr flag, can_hr(), and the access log (0029). Called from test-migrations.mjs.
export default async function hrTests(t) {
  const { run, ok, bad, expectOk, expectErr, expectVal, F, S, W, T2, P, V, O } = t;
  console.log('\nHR foundations (0029)');
  const rows = async (uid, sql) => (await run(uid, sql)).rows.length;
  const expectRows = async (name, uid, sql, want) => {
    let n;
    try { n = await rows(uid, sql); } catch (e) { return bad(name, e.message); }
    n === want ? ok(name) : bad(name, `${n} rows, want ${want}`);
  };
  const canHr = async (uid) => (await run(uid, `select ops.can_hr() as v`)).rows[0].v;
  const isHr = async (uid) => (await run(uid, `select ops.me() ->> 'is_hr' as v`)).rows[0].v;

  console.log('Who is HR');
  (await canHr(F)) === true ? ok('the founder counts as HR') : bad('the founder counts as HR', 'false');
  (await canHr(S)) === false ? ok('a member is not HR by default') : bad('a member is not HR by default', 'true');
  (await isHr(S)) === 'false' ? ok('me() says is_hr false') : bad('me() says is_hr false', 'wrong');
  await expectRows('a lead cannot make someone HR (no row changes)', W, `update ops.staff set is_hr = true where id = '${T2}' returning id`, 0);
  await expectRows('a member cannot make themselves HR', S, `update ops.staff set is_hr = true where id = '${S}' returning id`, 0);
  await expectOk('the founder makes the Workshop lead HR', F, `update ops.staff set is_hr = true where id = '${W}'`);
  (await canHr(W)) === true ? ok('...they can now do HR things') : bad('...they can now do HR things', 'false');
  (await isHr(W)) === 'true' ? ok('...me() says so') : bad('...me() says so', 'wrong');
  await expectOk('the founder makes a member HR', F, `update ops.staff set is_hr = true where id = '${T2}'`);
  await expectOk('the founder gives a viewer the flag', F, `update ops.staff set is_hr = true where id = '${V}'`);
  await expectVal('...it does not stick (viewers are never HR)', `select is_hr from ops.staff where id = '${V}'`, false);
  await expectOk('the founder gives a partner the flag', F, `update ops.staff set is_hr = true where id = '${P}'`);
  await expectVal('...it does not stick for partners either', `select is_hr from ops.staff where id = '${P}'`, false);
  (await canHr(V)) === false ? ok('a viewer is never HR') : bad('a viewer is never HR', 'true');
  await expectOk('the founder turns a member to a viewer', F, `update ops.staff set role = 'viewer' where id = '${T2}'`);
  await expectVal('...the flag is cleared with the role', `select is_hr from ops.staff where id = '${T2}'`, false);
  await expectOk('the founder deactivates the HR lead', F, `update ops.staff set is_active = false where id = '${W}'`);
  (await canHr(W)) === false ? ok('a deactivated HR person has no HR powers') : bad('a deactivated HR person has no HR powers', 'true');
  await expectOk('...and is reactivated', F, `update ops.staff set is_active = true where id = '${W}'`);
  await expectOk('the founder takes the flag away', F, `update ops.staff set is_hr = false where id = '${W}'`);
  (await canHr(W)) === false ? ok('...and they are not HR any more') : bad('...and they are not HR any more', 'true');
  await expectOk('the founder makes the lead HR again', F, `update ops.staff set is_hr = true where id = '${W}'`);

  console.log('The access log');
  await expectErr('a member cannot write to the log', S, `select ops.log_hr_access('${O}', 'opened profile')`, 'Only HR');
  await expectErr('no one can insert into the log directly', W, `insert into ops.hr_access_log (actor_id, target_id, what) values ('${W}', '${O}', 'x')`, 'row-level security');
  await expectOk('HR logs opening a profile', W, `select ops.log_hr_access('${O}', 'opened profile')`);
  await expectOk('...opening their own is not logged', W, `select ops.log_hr_access('${W}', 'own')`);
  await expectVal('...one row, about the other person', `select count(*) from ops.hr_access_log where actor_id = '${W}'`, 1);
  await expectRows('HR reads the log', W, `select id from ops.hr_access_log`, 1);
  await expectRows('the founder reads the log', F, `select id from ops.hr_access_log`, 1);
  await expectRows('the person who was looked at sees it', O, `select id from ops.hr_access_log`, 1);
  await expectRows('someone else does not', S, `select id from ops.hr_access_log`, 0);
  await expectErr('an empty reason is refused', W, `select ops.log_hr_access('${O}', '  ')`, 'check');
}
