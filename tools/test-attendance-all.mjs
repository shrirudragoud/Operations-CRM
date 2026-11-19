// Attendance for everyone: remote mode, HR visibility and the month (0030). Called from test-migrations.mjs.
export default async function attendanceAllTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, val, F, S, W, T2, O } = t;

  console.log('\nAttendance for everyone (0030)');
  const today = `(now() at time zone 'Asia/Kolkata')::date`;
  const monthFirst = `date_trunc('month', ${today})::date`;
  const OFFICE = '203.0.113.7';
  const rows = async (uid, sql) => (await run(uid, sql)).rows.length;
  const expectRows = async (name, uid, sql, want) => {
    let n;
    try { n = await rows(uid, sql); } catch (e) { return bad(name, e.message); }
    n === want ? ok(name) : bad(name, `${n} rows, want ${want}`);
  };
  const expectAsF = async (name, sql, want) => {
    let r;
    try { r = await run(F, sql); } catch (e) { return bad(name, e.message); }
    const got = Object.values(r.rows[0] ?? {})[0];
    got === want || Number(got) === want ? ok(name) : bad(name, `got ${got}, want ${want}`);
  };
  const headers = (h) => db.exec(`select set_config('request.headers', '${JSON.stringify(h).replace(/'/g, "''")}', false)`);
  const clearHeaders = () => db.exec(`select set_config('request.headers', '', false)`);
  const at = (day, time) => `((${day}) + time '${time}') at time zone 'Asia/Kolkata'`;
  const setSince = (expr) =>
    db.exec(`select set_config('session_replication_role', 'replica', false); update ops.staff set office_since = ${expr} where id = '${S}'; select set_config('session_replication_role', 'origin', false);`);
  const reset = () =>
    db.exec(`
      delete from ops.attendance_session; delete from ops.attendance_request; delete from ops.attendance_day_mark;
      delete from ops.attendance_failure; delete from ops.office_holiday;
      update ops.office_settings set work_days = '{1,2,3,4,5,6,7}';
      update ops.staff set is_hr = false;
      update ops.staff set role = 'member' where id = '${T2}';
      update ops.staff set works_from_office = true, attendance_mode = 'office' where id in ('${S}', '${T2}');
      select set_config('session_replication_role', 'replica', false);
      update ops.staff set office_since = ${today} - 90 where id in ('${S}', '${T2}');
      select set_config('session_replication_role', 'origin', false);
    `);
  await reset();
  await clearHeaders();

  console.log('The mode');
  await expectVal('the default is the office', `select attendance_mode from ops.staff where id = '${S}'`, 'office');
  await expectErr('only office or remote', F, `update ops.staff set attendance_mode = 'bogus' where id = '${S}'`, 'attendance_mode');
  await expectRows('a lead cannot change it', W, `update ops.staff set attendance_mode = 'remote' where id = '${T2}' returning id`, 0);
  await expectRows('a person cannot change their own', S, `update ops.staff set attendance_mode = 'remote' where id = '${S}' returning id`, 0);
  await expectOk('the founder sets a person to remote', F, `update ops.staff set attendance_mode = 'remote' where id = '${S}'`);
  {
    const r = await run(S, `select ops.me() ->> 'attendance_mode' as v`);
    r.rows[0].v === 'remote' ? ok('me() reports the mode') : bad('me() reports the mode', r.rows[0].v);
  }

  console.log('Checking in from anywhere');
  await expectOk('a remote person checks in with no office network', S, `select ops.check_in()`);
  await expectVal('...the session says remote', `select in_source from ops.attendance_session where staff_id = '${S}'`, 'remote');
  await expectVal('...no failed attempt is recorded', `select count(*) from ops.attendance_failure where staff_id = '${S}'`, 0);
  await expectErr('...a second check-in is refused', S, `select ops.check_in()`, 'already checked in');
  await expectOk('...and they check out', S, `select ops.check_out()`);
  await expectVal('...the check-out says remote', `select out_source from ops.attendance_session where staff_id = '${S}'`, 'remote');
  {
    const r = await run(S, `select (ops.check_in() ->> 'ok')::boolean as ok`);
    r.rows[0].ok === true ? ok('they can check in again after leaving') : bad('they can check in again after leaving', JSON.stringify(r.rows[0]));
  }
  await expectOk('...and out', S, `select ops.check_out()`);
  await headers({ 'cf-connecting-ip': '198.51.100.9' });
  {
    const r = await run(T2, `select ops.check_in() ->> 'reason' as v`);
    r.rows[0].v === 'not_on_network' ? ok('an office person away from the network is refused') : bad('an office person away from the network is refused', r.rows[0].v);
  }
  await expectVal('...and the attempt is recorded', `select count(*) from ops.attendance_failure where staff_id = '${T2}'`, 1);
  await clearHeaders();
  await db.exec(`update ops.staff set works_from_office = false where id = '${O}'`);
  await expectErr('someone who is not switched on cannot check in', O, `select ops.check_in()`, 'not switched on for you');

  console.log('Late and early flags still apply');
  await db.exec(`
    delete from ops.attendance_session where staff_id = '${S}';
    insert into ops.attendance_session (staff_id, work_date, check_in_at, check_out_at, in_source, out_source) values
      ('${S}', ${today} - 3, ${at(`${today} - 3`, '12:00')}, ${at(`${today} - 3`, '17:30')}, 'remote', 'remote'),
      ('${S}', ${today} - 2, ${at(`${today} - 2`, '10:50')}, ${at(`${today} - 2`, '16:00')}, 'remote', 'remote');
    select ops.recompute_day_flags('${S}', ${today} - 3);
    select ops.recompute_day_flags('${S}', ${today} - 2);
  `);
  await expectVal('a remote person arriving at noon is late by an hour',
    `select is_late and late_minutes = 60 and not left_early from ops.attendance_session where staff_id = '${S}' and work_date = ${today} - 3`, true);
  await expectVal('...leaving at four is early by an hour',
    `select left_early and early_minutes = 60 and not is_late from ops.attendance_session where staff_id = '${S}' and work_date = ${today} - 2`, true);
  await setSince(`${today} - 6`);
  await expectAsF('the days view carries the flags and the remote mark',
    `select count(*) from ops.attendance_days(${today} - 10, ${today}, '${S}') where work_date = ${today} - 3 and is_late and remote`, 1);

  console.log('Who sees attendance');
  await db.exec(`
    delete from ops.attendance_session where staff_id = '${S}';
    insert into ops.attendance_session (staff_id, work_date, check_in_at, check_out_at, in_source, out_source)
      values ('${S}', ${today} - 1, ${at(`${today} - 1`, '10:00')}, ${at(`${today} - 1`, '18:00')}, 'remote', 'remote');
    insert into ops.attendance_request (staff_id, work_date, in_time, out_time, reason)
      values ('${S}', ${today} - 4, '10:00', '17:00', 'ZZ forgot to check in');
    insert into ops.attendance_day_mark (staff_id, mark_date, kind, reason)
      values ('${S}', ${today} - 5, 'excused', 'ZZ clinic visit');
  `);
  const seeAll = async (who, name, want) => {
    await expectRows(`${name}: sessions`, who, `select id from ops.attendance_session where staff_id = '${S}'`, want);
    await expectRows(`${name}: requests`, who, `select id from ops.attendance_request where staff_id = '${S}'`, want);
    await expectRows(`${name}: day marks`, who, `select id from ops.attendance_day_mark where staff_id = '${S}'`, want);
  };
  await seeAll(S, 'the person sees their own', 1);
  await seeAll(F, 'the founder sees them', 1);
  await seeAll(T2, 'a colleague does not', 0);
  await seeAll(W, 'a lead of another team does not', 0);
  await db.exec(`update ops.staff set is_hr = true where id = '${O}'`);
  await seeAll(O, 'HR sees them without leading the team', 1);
  await db.exec(`update ops.staff set is_hr = false where id = '${O}'`);
  await seeAll(O, 'the same person without the flag does not', 0);

  console.log('The month');
  const dim = `extract(day from (${monthFirst} + interval '1 month - 1 day'))::int`;
  await db.exec(`insert into ops.office_holiday (holiday_date, name) values (${monthFirst}, 'ZZ Month start')`);
  await db.exec(`delete from ops.attendance_session where staff_id = '${S}'`);
  await setSince(`${monthFirst} - 40`);
  await expectAsF('the month has one row per calendar day',
    `select count(*) = ${dim} from ops.attendance_month('${S}', ${today})`, true);
  await expectAsF('...starting on the first and ending on the last',
    `select min(work_date) = ${monthFirst} and max(work_date) = (${monthFirst} + interval '1 month - 1 day')::date from ops.attendance_month('${S}', ${today})`, true);
  await expectAsF('...any date in the month will do',
    `select count(*) = ${dim} from ops.attendance_month('${S}', ${monthFirst} + 2)`, true);
  await expectAsF('...every day is tracked when they started earlier',
    `select bool_and(tracked) from ops.attendance_month('${S}', ${today})`, true);
  await expectAsF('...a holiday has its name and is not expected',
    `select holiday = 'ZZ Month start' and not expected from ops.attendance_month('${S}', ${today}) where work_date = ${monthFirst}`, true);
  await expectAsF('...other days are expected', `select bool_and(expected) from ops.attendance_month('${S}', ${today}) where work_date > ${monthFirst}`, true);
  await expectAsF('...a remote person is shown as remote', `select bool_and(remote) from ops.attendance_month('${S}', ${today})`, true);
  await expectAsF('...future days of the month are included',
    `select count(*) = ${dim} - extract(day from ${today})::int from ops.attendance_month('${S}', ${today}) where work_date > ${today}`, true);
  await db.exec(`
    insert into ops.attendance_day_mark (staff_id, mark_date, kind, reason) values ('${S}', ${monthFirst} + 1, 'excused', 'ZZ marked day')
      on conflict do nothing;
    insert into ops.attendance_session (staff_id, work_date, check_in_at, check_out_at, in_source, out_source)
      values ('${S}', ${monthFirst} + 2, ${at(`${monthFirst} + 2`, '10:00')}, ${at(`${monthFirst} + 2`, '18:00')}, 'remote', 'remote');
  `);
  await expectAsF('...a marked day carries its mark and reason',
    `select mark = 'excused' and mark_reason = 'ZZ marked day' from ops.attendance_month('${S}', ${today}) where work_date = ${monthFirst} + 1`, true);
  await expectAsF('...a worked day carries its minutes',
    `select minutes = 480 and first_in is not null and last_out is not null from ops.attendance_month('${S}', ${today}) where work_date = ${monthFirst} + 2`, true);
  await setSince(`${monthFirst} + 9`);
  await expectAsF('days before they started are not tracked',
    `select count(*) filter (where tracked) = ${dim} - 9 and count(*) filter (where not tracked) = 9 from ops.attendance_month('${S}', ${today})`, true);
  await expectRows('...and the older week view leaves them out', S,
    `select * from ops.attendance_days(${monthFirst}, ${monthFirst} + 20, '${S}') where work_date < ${monthFirst} + 9`, 0);

  console.log('The month: access');
  await expectRows('the person reads their own month', S, `select * from ops.attendance_month('${S}', ${today})`, Number(await val(`select ${dim}`)));
  await expectRows('the founder reads it', F, `select * from ops.attendance_month('${S}', ${today})`, Number(await val(`select ${dim}`)));
  await db.exec(`update ops.staff set is_hr = true where id = '${O}'`);
  await expectRows('HR reads it', O, `select * from ops.attendance_month('${S}', ${today})`, Number(await val(`select ${dim}`)));
  await db.exec(`update ops.staff set is_hr = false where id = '${O}'`);
  await expectRows('a colleague gets nothing', T2, `select * from ops.attendance_month('${S}', ${today})`, 0);
  await expectRows('a lead of another team gets nothing', W, `select * from ops.attendance_month('${S}', ${today})`, 0);
  await expectRows('a person not switched on gets nothing', O, `select * from ops.attendance_month('${O}', ${today})`, 0);
  await expectErr('a month needs a person', F, `select * from ops.attendance_month(null, ${today})`, 'Choose a person and a month');
  await expectErr('a month needs a month', F, `select * from ops.attendance_month('${S}', null)`, 'Choose a person and a month');
  await expectRows('the lead of the team reads a teammate', W, `select * from ops.attendance_month('${T2}', ${today})`, Number(await val(`select ${dim}`)));

  console.log('The week view still behaves');
  await setSince(`${today} - 4`);
  await expectRows('only tracked days, up to today', S, `select * from ops.attendance_days(${today} - 10, ${today} + 5, '${S}')`, 5);
  await expectErr('a range over 62 days is refused', F, `select * from ops.attendance_days(${today} - 70, ${today}, '${S}')`, 'at most 62 days');
  await expectRows('a colleague sees nobody else\'s days', T2, `select * from ops.attendance_days(${today} - 10, ${today}, '${S}')`, 0);

  await reset();
}
