// Attendance: check in and out for people who work from the office (0023). Called from test-migrations.mjs.
export default async function attendanceTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, val, F, S, W, T2, P, V, O } = t;

  console.log('\nAttendance (0023)');
  const today = `(now() at time zone 'Asia/Kolkata')::date`;
  const rows = async (uid, sql) => (await run(uid, sql)).rows.length;
  const expectRows = async (name, uid, sql, want) => {
    let n;
    try { n = await rows(uid, sql); } catch (e) { return bad(name, e.message); }
    n === want ? ok(name) : bad(name, `${n} rows, want ${want}`);
  };
  const OFFICE = '203.0.113.7';
  const headers = (h) => db.exec(`select set_config('request.headers', '${JSON.stringify(h).replace(/'/g, "''")}', false)`);
  const clearHeaders = () => db.exec(`select set_config('request.headers', '', false)`);
  // Every day counts as a working day unless a test says otherwise, so results don't depend on today's weekday.
  await db.exec(`update ops.office_settings set work_days = '{1,2,3,4,5,6,7}'`);

  console.log('The tag');
  await expectRows('a lead cannot tag people (no row changes)', W, `update ops.staff set works_from_office = true where id = '${T2}' returning id`, 0);
  await expectRows('a member cannot tag themselves', T2, `update ops.staff set works_from_office = true where id = '${T2}' returning id`, 0);
  await expectErr('a partner cannot be tagged', F, `update ops.staff set works_from_office = true where id = '${P}'`, 'Partners can');
  await expectOk('the founder tags a trainer', F, `update ops.staff set works_from_office = true where id = '${T2}'`);
  await expectOk('the founder tags a salesperson', F, `update ops.staff set works_from_office = true where id = '${S}'`);
  await expectOk('the founder tags a viewer', F, `update ops.staff set works_from_office = true where id = '${V}'`);
  await expectVal('the database sets the date they started', `select office_since = ${today} from ops.staff where id = '${T2}'`, true);
  await expectOk('the founder cannot move the start date by hand', F, `update ops.staff set office_since = '2020-01-01' where id = '${T2}'`);
  await expectVal('...it did not move', `select office_since = ${today} from ops.staff where id = '${T2}'`, true);
  {
    const r = await run(T2, `select ops.me() ->> 'works_from_office' as v`);
    r.rows[0].v === 'true' ? ok('me() reports the tag to the person') : bad('me() reports the tag to the person', r.rows[0].v);
    const r2 = await run(O, `select ops.me() ->> 'works_from_office' as v`);
    r2.rows[0].v === 'false' ? ok('...and false for an untagged person') : bad('...and false for an untagged person', r2.rows[0].v);
  }

  console.log('Who can read the network');
  await db.exec(`insert into ops.office_network (label, cidr) values ('ZZ Office', '${OFFICE}/32')`);
  await expectRows('the founder reads the networks', F, `select id from ops.office_network`, 1);
  await expectRows('a member cannot read the networks', T2, `select id from ops.office_network`, 0);
  await expectRows('a lead cannot read the networks', W, `select id from ops.office_network`, 0);
  await expectErr('a member cannot add a network (denied)', T2, `insert into ops.office_network (label, cidr) values ('x', '198.51.100.0/24')`, 'row-level security');
  await expectRows('everybody internal reads the settings', O, `select * from ops.office_settings`, 1);
  await expectRows('a partner does not read the settings', P, `select * from ops.office_settings`, 0);
  await expectRows('a member cannot change the settings', T2, `update ops.office_settings set grace_minutes = 99 returning id`, 0);
  await expectErr('office hours must end after they start', F, `update ops.office_settings set end_time = '10:00'`, 'end after');
  await expectErr('at least one working day', F, `update ops.office_settings set work_days = '{}'`, 'working day');

  console.log('Checking in');
  await headers({ 'cf-connecting-ip': OFFICE });
  {
    const r = await run(T2, `select ops.my_network() as n`);
    r.rows[0].n?.on_network === true && r.rows[0].n?.label === 'ZZ Office' ? ok('my_network names the office, not the address') : bad('my_network names the office', JSON.stringify(r.rows[0].n));
    const txt = JSON.stringify(r.rows[0].n);
    txt.includes(OFFICE) ? bad('the address is not returned', txt) : ok('the address is not returned');
    const r2 = await run(O, `select ops.my_network() as n`);
    r2.rows[0].n === null ? ok('an untagged person gets nothing from my_network') : bad('an untagged person gets nothing', JSON.stringify(r2.rows[0].n));
  }
  await expectErr('an untagged person cannot check in', O, `select ops.check_in()`, 'not switched on for you');
  await expectErr('a partner cannot check in', P, `select ops.check_in()`, 'not switched on for you');
  await expectErr('a person cannot write a session directly', T2,
    `insert into ops.attendance_session (staff_id, work_date, check_in_at, in_source) values ('${T2}', ${today}, now(), 'network')`, 'permission denied');
  await expectErr('the founder cannot write a session directly either', F,
    `insert into ops.attendance_session (staff_id, work_date, check_in_at, in_source) values ('${T2}', ${today}, now(), 'network')`, 'permission denied');

  const ci = (await expectOk('a tagged person on the office network checks in', T2, `select ops.check_in() as r`))?.rows[0]?.r;
  ci?.ok === true ? ok('...and is told it worked') : bad('...and is told it worked', JSON.stringify(ci));
  await expectVal('the session is today, from the network, with no raw address stored',
    `select work_date = ${today} and in_source = 'network' and in_network_id is not null and check_out_at is null
       from ops.attendance_session where staff_id = '${T2}'`, true);
  await expectVal('the network was marked as seen', `select last_seen_at is not null from ops.office_network`, true);
  await expectErr('checking in twice is refused', T2, `select ops.check_in()`, 'already checked in');

  console.log('Not on the office network');
  await headers({ 'cf-connecting-ip': '198.51.100.9' });
  {
    const r = (await expectOk('another address is not an error', S, `select ops.check_in() as r`))?.rows[0]?.r;
    r?.ok === false && r?.reason === 'not_on_network' ? ok('...it is refused with a reason') : bad('...it is refused with a reason', JSON.stringify(r));
  }
  await expectVal('no session was written', `select count(*) from ops.attendance_session where staff_id = '${S}'`, 0);
  await expectVal('the refusal was recorded', `select count(*) from ops.attendance_failure where staff_id = '${S}'`, 1);
  await expectRows('the founder reads the refusals', F, `select id from ops.attendance_failure`, 1);
  await expectRows('a lead does not', W, `select id from ops.attendance_failure`, 0);
  await headers({});
  {
    const r = (await expectOk('no address at all is refused too', S, `select ops.check_in() as r`))?.rows[0]?.r;
    r?.ok === false ? ok('...with the same reason') : bad('...with the same reason', JSON.stringify(r));
    const m = (await run(S, `select ops.my_network() as n`)).rows[0].n;
    m.readable === false && m.on_network === false ? ok('my_network says the address cannot be read') : bad('my_network readable flag', JSON.stringify(m));
  }
  // A forged x-forwarded-for does not help when the trusted header is cf-connecting-ip.
  await headers({ 'x-forwarded-for': OFFICE, 'cf-connecting-ip': '198.51.100.9' });
  {
    const r = (await expectOk('a forged x-forwarded-for is ignored', S, `select ops.check_in() as r`))?.rows[0]?.r;
    r?.ok === false ? ok('...still refused') : bad('...still refused', JSON.stringify(r));
  }
  await headers({ 'cf-connecting-ip': 'not an address' });
  {
    const r = (await expectOk('garbage in the header does not crash', S, `select ops.check_in() as r`))?.rows[0]?.r;
    r?.ok === false ? ok('...it is refused') : bad('...it is refused', JSON.stringify(r));
  }

  console.log('The header the founder chose');
  await db.exec(`update ops.office_settings set ip_header = 'x-forwarded-for', ip_hops = 1`);
  await headers({ 'x-forwarded-for': `198.51.100.9, ${OFFICE}` });
  {
    const r = (await expectOk('x-forwarded-for: the last hop is the real address', S, `select ops.check_in() as r`))?.rows[0]?.r;
    r?.ok === true ? ok('...the office address in the last place is accepted') : bad('...accepted', JSON.stringify(r));
  }
  await expectOk('and checks out', S, `select ops.check_out()`);
  await headers({ 'x-forwarded-for': `${OFFICE}, 198.51.100.9` });
  {
    const r = (await expectOk('a client-supplied office address in the first place', V, `select ops.check_in() as r`))?.rows[0]?.r;
    r?.ok === false ? ok('...does not count') : bad('...does not count', JSON.stringify(r));
  }
  await db.exec(`update ops.office_settings set ip_header = 'cf-connecting-ip'`);

  console.log('Checking out');
  await headers({ 'cf-connecting-ip': '198.51.100.9' });
  {
    const r = (await expectOk('checking out from elsewhere is allowed', T2, `select ops.check_out() as r`))?.rows[0]?.r;
    r?.off_network === true ? ok('...and flagged as off the network') : bad('...and flagged', JSON.stringify(r));
  }
  await expectVal('the stretch is closed and says where from',
    `select check_out_at >= check_in_at and out_source = 'off_network' and out_network_id is null from ops.attendance_session where staff_id = '${T2}'`, true);
  await expectErr('checking out when not checked in is refused', T2, `select ops.check_out()`, 'not checked in');
  await headers({ 'cf-connecting-ip': OFFICE });
  await expectOk('a second stretch the same day is fine', T2, `select ops.check_in()`);
  await expectOk('closed from the office', T2, `select ops.check_out()`);
  await expectVal('two stretches today', `select count(*) from ops.attendance_session where staff_id = '${T2}' and work_date = ${today}`, 2);
  await expectVal('only the first can be late',
    `select count(*) from ops.attendance_session where staff_id = '${T2}' and work_date = ${today} and (late_minutes > 0 or is_late)
       and check_in_at <> (select min(check_in_at) from ops.attendance_session where staff_id = '${T2}')`, 0);

  console.log('Who sees the records');
  await expectRows('a person sees their own sessions', T2, `select id from ops.attendance_session`, 2);
  await expectRows('...and not a colleague\'s', S, `select id from ops.attendance_session where staff_id = '${T2}'`, 0);
  await expectRows('the lead of their department sees them', W, `select id from ops.attendance_session where staff_id = '${T2}'`, 2);
  await expectRows('the lead of another department does not', O, `select id from ops.attendance_session`, 0);
  await expectRows('the founder sees everyone', F, `select id from ops.attendance_session`, 3);
  await expectErr('a person cannot edit a session', T2, `update ops.attendance_session set check_in_at = now() - interval '9 hours'`, 'permission denied');
  await expectErr('a person cannot delete a session', T2, `delete from ops.attendance_session`, 'permission denied');

  console.log('Asking for time to be added');
  // Clear today's sessions so these requests do not overlap what the clicks wrote.
  await db.exec(`delete from ops.attendance_session`);
  await expectErr('an untagged person cannot ask', O, `select ops.request_attendance(${today} - 1, '11:00', '17:00', 'ZZ mobile data')`, 'tagged');
  await expectErr('not more than 7 days back', T2, `select ops.request_attendance(${today} - 8, '11:00', '17:00', 'ZZ old')`, 'last 7 days');
  await expectErr('not the future', T2, `select ops.request_attendance(${today} + 1, '11:00', '17:00', 'ZZ future')`, 'last 7 days');
  await expectErr('leaving must be after arriving', T2, `select ops.request_attendance(${today} - 1, '17:00', '11:00', 'ZZ backwards')`, 'after the arrival');
  await expectErr('a reason is needed', T2, `select ops.request_attendance(${today} - 1, '11:00', '17:00', ' ')`, 'why');
  const rq1 = (await expectOk('a request for yesterday with a reason', T2, `select ops.request_attendance(${today} - 1, '11:20', '16:30', 'ZZ phone hotspot, VPN on') as id`))?.rows[0]?.id;
  await expectErr('the same request twice is refused', T2, `select ops.request_attendance(${today} - 1, '11:20', '16:30', 'ZZ again')`, 'already asked');
  await expectRows('the person sees their request', T2, `select id from ops.attendance_request`, 1);
  await expectRows('their lead sees it', W, `select id from ops.attendance_request`, 1);
  await expectRows('a colleague does not', S, `select id from ops.attendance_request`, 0);
  await expectErr('the person cannot approve their own request', T2, `select ops.decide_attendance_request('${rq1}', true)`, 'lead or the founder');
  await expectErr('another department cannot decide it', O, `select ops.decide_attendance_request('${rq1}', true)`, 'lead or the founder');
  await expectErr('turning down needs a reason', W, `select ops.decide_attendance_request('${rq1}', false)`, 'why');
  await expectOk('the lead approves', W, `select ops.decide_attendance_request('${rq1}', true, 'ok')`);
  await expectVal('a manual session appears with the times asked for',
    `select in_source = 'manual' and out_source = 'manual'
        and (check_in_at at time zone 'Asia/Kolkata')::time = '11:20' and (check_out_at at time zone 'Asia/Kolkata')::time = '16:30'
        and work_date = ${today} - 1 from ops.attendance_session where staff_id = '${T2}'`, true);
  await expectVal('...20 minutes late, which is past the leeway', `select late_minutes = 20 and is_late from ops.attendance_session where staff_id = '${T2}'`, true);
  await expectVal('...30 minutes early, which is past the leeway', `select early_minutes = 30 and left_early from ops.attendance_session where staff_id = '${T2}'`, true);
  await expectVal('the request records who decided', `select status = 'approved' and decided_by = '${W}' and decided_at is not null from ops.attendance_request where id = '${rq1}'`, true);
  await expectErr('a request is decided once', W, `select ops.decide_attendance_request('${rq1}', false, 'changed my mind')`, 'already been decided');

  const rq2 = (await expectOk('an overlapping request', T2, `select ops.request_attendance(${today} - 1, '12:00', '14:00', 'ZZ overlap') as id`))?.rows[0]?.id;
  await expectErr('an overlap with recorded time cannot be approved', W, `select ops.decide_attendance_request('${rq2}', true)`, 'overlaps');
  await expectOk('it can be turned down with a reason', W, `select ops.decide_attendance_request('${rq2}', false, 'already recorded')`);
  await expectVal('a turned-down request writes nothing', `select count(*) from ops.attendance_session where staff_id = '${T2}'`, 1);

  // On time within the leeway: 11:15 is on time, 11:16 is late; 16:45 is a full day, 16:44 is early.
  const rq3 = (await expectOk('a request that is 15 minutes late and 15 minutes early', T2, `select ops.request_attendance(${today} - 2, '11:15', '16:45', 'ZZ edge') as id`))?.rows[0]?.id;
  await expectOk('approved by the founder', F, `select ops.decide_attendance_request('${rq3}', true)`);
  await expectVal('11:15 and 16:45 are inside the leeway',
    `select late_minutes = 15 and not is_late and early_minutes = 15 and not left_early from ops.attendance_session where staff_id = '${T2}' and work_date = ${today} - 2`, true);
  const rq4 = (await expectOk('one minute outside the leeway', T2, `select ops.request_attendance(${today} - 3, '11:16', '16:44', 'ZZ edge2') as id`))?.rows[0]?.id;
  await expectOk('approved', F, `select ops.decide_attendance_request('${rq4}', true)`);
  await expectVal('11:16 is late and 16:44 is early',
    `select is_late and left_early from ops.attendance_session where staff_id = '${T2}' and work_date = ${today} - 3`, true);
  const rq5 = (await expectOk('an early arrival', T2, `select ops.request_attendance(${today} - 4, '10:30', '17:30', 'ZZ early bird') as id`))?.rows[0]?.id;
  await expectOk('approved', F, `select ops.decide_attendance_request('${rq5}', true)`);
  await expectVal('early in and late out are never flagged',
    `select late_minutes = 0 and not is_late and early_minutes = 0 and not left_early from ops.attendance_session where staff_id = '${T2}' and work_date = ${today} - 4`, true);

  console.log('Holidays and non-working days');
  await expectErr('a member cannot add a holiday', T2, `insert into ops.office_holiday (holiday_date, name) values (${today} - 5, 'x')`, 'row-level security');
  await expectOk('the founder adds a holiday', F, `insert into ops.office_holiday (holiday_date, name) values (${today} - 5, 'ZZ Founders day')`);
  const rq6 = (await expectOk('a request on a holiday', T2, `select ops.request_attendance(${today} - 5, '12:00', '15:00', 'ZZ came anyway') as id`))?.rows[0]?.id;
  await expectOk('approved', F, `select ops.decide_attendance_request('${rq6}', true)`);
  await expectVal('nobody is late or early on a holiday',
    `select not is_late and not left_early and late_minutes = 0 and early_minutes = 0 from ops.attendance_session where staff_id = '${T2}' and work_date = ${today} - 5`, true);
  await expectRows('everyone internal reads holidays', O, `select id from ops.office_holiday`, 1);

  console.log('Missing check-outs');
  await db.exec(`insert into ops.attendance_session (staff_id, work_date, check_in_at, in_source, in_network_id)
                 select '${S}', ${today} - 1, now() - interval '30 hours', 'network', id from ops.office_network`);
await headers({ 'cf-connecting-ip': OFFICE });
  await expectOk('the person can still check in the next day', S, `select ops.check_in()`);
  await expectVal('yesterday\'s stretch is flagged, not closed',
    `select missing_checkout and check_out_at is null and out_source is null from ops.attendance_session where staff_id = '${S}' and work_date = ${today} - 1`, true);
  await expectOk('closing today', S, `select ops.check_out()`);
  const miss = await val(`select id from ops.attendance_session where staff_id = '${S}' and missing_checkout`);
  await expectErr('the person cannot fix their own missing check-out', S,
    `select ops.correct_checkout('${miss}', now() - interval '20 hours', 'ZZ I remember')`, 'lead or the founder');
  await expectErr('a lead of another department cannot', O,
    `select ops.correct_checkout('${miss}', now() - interval '20 hours', 'ZZ guess')`, 'lead or the founder');
  await db.exec(`update ops.staff set departments = '{sales}' where id = '${S}'`);
  await expectErr('a note is required', F, `select ops.correct_checkout('${miss}', now() - interval '25 hours', ' ')`, 'how you know');
  await expectErr('not before arrival', F, `select ops.correct_checkout('${miss}', now() - interval '31 hours', 'ZZ before')`, 'after arrival');
  await expectErr('not in the future', F, `select ops.correct_checkout('${miss}', now() + interval '1 hour', 'ZZ future')`, 'future');
  await expectOk('the founder fixes it', F, `select ops.correct_checkout('${miss}', now() - interval '25 hours', 'ZZ badge log shows 5pm')`);
  await expectVal('it is closed by a correction, with who and why',
    `select not missing_checkout and out_source = 'correction' and corrected_by = '${F}' and note like 'ZZ badge%' from ops.attendance_session where id = '${miss}'`, true);
  await expectErr('a closed one cannot be corrected again', F, `select ops.correct_checkout('${miss}', now() - interval '24 hours', 'ZZ again')`, 'already has');
  await db.exec(`update ops.staff set departments = '{sales}' where id = '${S}'`);

  console.log('Working remotely and excused days');
  await expectErr('an untagged person has nothing to declare', O, `select ops.declare_remote(${today}, 'ZZ home')`, 'tagged');
  await expectErr('a reason is needed', T2, `select ops.declare_remote(${today}, '')`, 'why');
  await expectErr('not in the past', T2, `select ops.declare_remote(${today} - 1, 'ZZ home')`, 'today or a day');
  await expectOk('a person declares today remote', T2, `select ops.declare_remote(${today} + 1, 'ZZ plumber at home')`);
  await expectRows('their lead sees the mark and the reason', W, `select id from ops.attendance_day_mark where kind = 'remote' and reason like 'ZZ plumber%'`, 1);
  await expectRows('a colleague does not', S, `select id from ops.attendance_day_mark where staff_id = '${T2}'`, 0);
  await expectErr('a person cannot excuse themselves', T2, `select ops.excuse_day('${T2}', ${today} - 1, 'ZZ me')`, 'lead or the founder');
  await expectOk('the lead excuses a day', W, `select ops.excuse_day('${T2}', ${today} - 1, 'ZZ hospital')`);
await expectOk('the lead excuses a future day', W, `select ops.excuse_day('${T2}', ${today} + 2, 'ZZ wedding')`);
  await expectErr('the person cannot override it', T2, `select ops.declare_remote(${today} + 2, 'ZZ nope')`, 'already excused');
  await expectErr('a lead cannot excuse a person outside their department', W, `select ops.excuse_day('${S}', ${today} - 1, 'ZZ nope')`, 'lead or the founder');
  await expectErr('only a tagged person can be excused', F, `select ops.excuse_day('${O}', ${today} - 1, 'ZZ untagged')`, 'isn\'t tagged');
  await expectErr('not more than 60 days back', F, `select ops.excuse_day('${T2}', ${today} - 61, 'ZZ old')`, 'last 60');
  await expectErr('the person cannot remove an excuse', T2, `select ops.clear_day_mark('${T2}', ${today} + 2)`, 'remove that');
  await expectOk('the person removes their own remote day', T2, `select ops.clear_day_mark('${T2}', ${today} + 1)`);
  await expectOk('the lead removes an excuse', W, `select ops.clear_day_mark('${T2}', ${today} + 2)`);

  console.log('The week grid');
  await db.exec(`alter table ops.staff disable trigger t_staff_office_tag;
                 update ops.staff set office_since = ${today} - 6 where id in ('${T2}', '${S}');
                 alter table ops.staff enable trigger t_staff_office_tag;`);
  const days = async (uid, from, to, who = 'null') =>
    (await run(uid, `select * from ops.attendance_days(${from}, ${to}, ${who})`)).rows;
  {
    const r = await days(F, `${today} - 6`, today);
    const t2 = r.filter((x) => x.staff_id === T2);
    t2.length === 7 ? ok('one row per tagged person per day') : bad('one row per tagged person per day', `${t2.length}`);
    const s = r.filter((x) => x.staff_id === S);
    s.length === 7 ? ok('...for everyone tagged') : bad('...for everyone tagged', `${s.length}`);
    r.some((x) => x.staff_id === O) ? bad('untagged people have no rows', 'found') : ok('untagged people have no rows');
    r.some((x) => x.staff_id === P) ? bad('partners have no rows', 'found') : ok('partners have no rows');
    const dstr = (v) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
    const d1 = t2.find((x) => dstr(x.work_date) === new Date(Date.now() + 5.5 * 3600e3 - 86400e3).toISOString().slice(0, 10));
    d1 && d1.is_late && d1.left_early && d1.minutes === 310 ? ok('a late, early day shows both flags and the hours') : bad('a late, early day', JSON.stringify(d1));
    t2.some((x) => x.holiday === 'ZZ Founders day' && x.expected === false) ? ok('a holiday is not an expected day') : bad('a holiday is not an expected day', 'missing');
    s.some((x) => x.minutes > 0 && x.last_out) ? ok('a corrected day shows its hours') : bad('a corrected day shows its hours', JSON.stringify(s));
  }
  {
    const r = await days(S, `${today} - 6`, today);
    r.every((x) => x.staff_id === S) ? ok('a member sees only their own rows') : bad('a member sees only their own rows', 'saw others');
    const l = await days(W, `${today} - 6`, today);
    l.some((x) => x.staff_id === T2) && !l.some((x) => x.staff_id === S) ? ok('a lead sees their department\'s people') : bad('a lead sees their department', JSON.stringify([...new Set(l.map((x) => x.staff_id))]));
  }
  await expectErr('a range is at most 62 days', F, `select * from ops.attendance_days(${today} - 70, ${today})`, '62 days');
  await expectErr('a backwards range is refused', F, `select * from ops.attendance_days(${today}, ${today} - 1)`, '62 days');
  await db.exec(`update ops.staff set works_from_office = false where id = '${V}'`);
  await expectVal('untagging clears the start date', `select office_since is null from ops.staff where id = '${V}'`, true);

  console.log('Trusting the network I am on');
  await db.exec(`delete from ops.office_network`);
  await headers({ 'cf-connecting-ip': '203.0.113.50' });
  await expectErr('only the founder can trust a network', W, `select ops.trust_this_network('ZZ Home')`, 'founder');
  await expectErr('a name is needed', F, `select ops.trust_this_network(' ')`, 'name');
  {
    const r = (await expectOk('the founder trusts the network they are on', F, `select ops.trust_this_network('ZZ Hex Labs') as r`))?.rows[0]?.r;
    r?.created === true ? ok('...a network was added') : bad('...a network was added', JSON.stringify(r));
    const r2 = (await expectOk('doing it again', F, `select ops.trust_this_network('ZZ Hex Labs') as r`))?.rows[0]?.r;
    r2?.created === false ? ok('...adds nothing, only confirms') : bad('...adds nothing', JSON.stringify(r2));
  }
  await expectVal('the address is stored as a single host', `select cidr = '203.0.113.50/32' and last_seen_at is not null from ops.office_network`, true);
  await expectOk('a person on that address can now check in', T2, `select ops.check_in()`);
  await expectVal('...and the session is on the network', `select in_network_id is not null from ops.attendance_session where staff_id = '${T2}' and check_out_at is null`, true);
  await expectOk('closing it', T2, `select ops.check_out()`);
  await db.exec(`update ops.office_network set is_active = false`);
  {
    const r = (await run(T2, `select ops.check_in() as r`)).rows[0].r;
    r.ok === false ? ok('a switched-off network no longer counts') : bad('a switched-off network no longer counts', JSON.stringify(r));
  }
  await db.exec(`update ops.office_network set is_active = true, cidr = '203.0.113.0/24'`);
  await headers({ 'cf-connecting-ip': '203.0.113.200' });
  {
    const r = (await run(T2, `select ops.check_in() as r`)).rows[0].r;
    r.ok === true ? ok('a range matches any address inside it') : bad('a range matches any address inside it', JSON.stringify(r));
  }
  await expectOk('closing it', T2, `select ops.check_out()`);
  await db.exec(`update ops.office_network set cidr = '2001:db8:1::/64'`);
  await headers({ 'cf-connecting-ip': '2001:db8:1::abcd' });
  {
    const r = (await run(T2, `select ops.check_in() as r`)).rows[0].r;
    r.ok === true ? ok('an IPv6 range works the same way') : bad('an IPv6 range works the same way', JSON.stringify(r));
  }
  await expectOk('closing it', T2, `select ops.check_out()`);

  console.log('Automation and the audit trail');
  await db.exec(`insert into ops.attendance_session (staff_id, work_date, check_in_at, in_source)
                 values ('${T2}', ${today} - 3, now() - interval '70 hours', 'manual')`);
  const flagged = await val(`select (ops.run_task_automation() ->> 'missing_checkouts')::int`);
  Number(flagged) >= 1 ? ok('the daily job flags forgotten check-outs') : bad('the daily job flags forgotten check-outs', String(flagged));
  await expectRows('the grid shows it as a missing check-out', F, `select * from ops.attendance_days(${today} - 6, ${today}, '${T2}') where missing_checkout`, 1);
  await expectErr('a member cannot flag check-outs for everyone', T2, `select ops.flag_missing_checkouts()`, 'permission denied');
  await expectVal('sessions and requests are in the audit trail',
    `select count(distinct table_name) from ops.audit_log where table_name in ('attendance_session', 'attendance_request', 'attendance_day_mark', 'office_network')`, 4);
  await clearHeaders();
}
