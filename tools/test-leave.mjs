// Leave (0032): the policy HR sets, applying, deciding, cancelling, the ledger, and the month view. Called from test-migrations.mjs.
export default async function leaveTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, val, F } = t;
  console.log('\nLeave (0032)');

  // People of our own, so earlier tests cannot change who is what.
  const E1 = '00000000-0000-0000-0000-0000000001e1'; // member, sales
  const E2 = '00000000-0000-0000-0000-0000000001e2'; // member, sales (colleague)
  const E3 = '00000000-0000-0000-0000-0000000001e3'; // member, outreach (another team)
  const L = '00000000-0000-0000-0000-0000000001e4'; // dept_lead, sales
  const H = '00000000-0000-0000-0000-0000000001e5'; // member, outreach, is_hr
  const VW = '00000000-0000-0000-0000-0000000001e6'; // viewer
  const PT = '00000000-0000-0000-0000-0000000001e7'; // partner
  const E4 = '00000000-0000-0000-0000-0000000001e8'; // member, sales (carry-forward with a cap)
  const E5 = '00000000-0000-0000-0000-0000000001e9'; // member, sales (back-dating)
  const origWorkDays = await val(`select work_days::text from ops.office_settings`);
  await db.exec(`
    insert into auth.users(id) values ('${E1}'),('${E2}'),('${E3}'),('${L}'),('${H}'),('${VW}'),('${PT}'),('${E4}'),('${E5}');
    insert into ops.staff(id, full_name, email, role, departments) values
      ('${E1}','Lv Employee','lv1@x.in','member','{sales}'),
      ('${E2}','Lv Colleague','lv2@x.in','member','{sales}'),
      ('${E3}','Lv Outreach','lv3@x.in','member','{outreach}'),
      ('${L}','Lv Lead','lv4@x.in','dept_lead','{sales}'),
      ('${H}','Lv HR','lv5@x.in','member','{outreach}'),
      ('${VW}','Lv Viewer','lv6@x.in','viewer','{sales}'),
      ('${PT}','Lv Partner','lv7@x.in','partner','{}'),
      ('${E4}','Lv Capped','lv8@x.in','member','{sales}'),
      ('${E5}','Lv Backdate','lv9@x.in','member','{sales}');
    update ops.staff set is_hr = true where id = '${H}';
    update ops.office_settings set work_days = '{1,2,3,4,5}';
  `);

  const T = async (code) => val(`select id from ops.leave_type where code = '${code}'`);
  const casual = await T('casual'), sick = await T('sick'), earned = await T('earned'), unpaid = await T('unpaid'), comp = await T('comp_off');
  const cur = Number(await val(`select extract(year from ops.today_ist())::int`));
  const ny = cur + 1;
  // A Monday in March of next year, then days relative to it (all in next year, so the quota is real and nothing is back-dated).
  const mar1 = new Date(Date.UTC(ny, 2, 1));
  const monday = new Date(mar1.getTime() + ((8 - (mar1.getUTCDay() || 7)) % 7) * 86400000);
  const day = (n) => new Date(monday.getTime() + n * 86400000).toISOString().slice(0, 10);
  const [MON, TUE, WED, THU, FRI, SAT, SUN, MON2, TUE2] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(day);
  const [WK3, WK3_END, WK4, WK4_END, WK5, WK5_END, WK6, WK10, WK10_END, WK12] = [14, 25, 21, 21, 28, 29, 35, 42, 46, 56].map(day);
  const apply = (uid, type, from, to, part = 'full', reason = 'Family function', staff = null) =>
    run(uid, `select ops.apply_leave('${type}', '${from}', '${to}', '${part}', '${reason}', ${staff ? `'${staff}'` : 'null'}) as id`);
  const applied = async (name, uid, type, from, to, part, reason, staff) => {
    try { return (await apply(uid, type, from, to, part, reason, staff)).rows[0].id; } catch (e) { bad(name, e.message.split('\n')[0]); return null; }
  };
  const rows = async (uid, sql) => (await run(uid, sql)).rows.length;
  const expectRows = async (name, uid, sql, want) => {
    let n; try { n = await rows(uid, sql); } catch (e) { return bad(name, e.message); }
    n === want ? ok(name) : bad(name, `${n} rows, want ${want}`);
  };
  const ledgerSum = (staff, type, yr) => val(`select coalesce(sum(days), 0) from ops.leave_ledger where staff_id = '${staff}' and leave_type_id = '${type}' and year = ${yr}`);
  const balanceOf = async (uid, staff, type, yr) =>
    (await run(uid, `select balance, pending, used, available from ops.leave_balances('${staff}', ${yr}) where leave_type_id = '${type}'`)).rows[0];
  const state = (id) => val(`select state from ops.leave_request where id = '${id}'`);

  console.log('The policy');
  await expectVal('five starting types', `select count(*) from ops.leave_type`, 5);
  await expectVal('casual starts at 12 days', `select annual_quota from ops.leave_type where code = 'casual'`, '12.0');
  await expectVal('unpaid keeps no balance', `select has_balance from ops.leave_type where code = 'unpaid'`, false);
  await expectVal('earned carries forward with a cap', `select carry_forward::text || ':' || carry_cap from ops.leave_type where code = 'earned'`, 'true:30.0');
  await expectRows('an employee reads the types', E1, `select id from ops.leave_type`, 5);
  await expectRows('a viewer reads the types (it is policy, not a record)', VW, `select id from ops.leave_type`, 5);
  await expectRows('a partner does not', PT, `select id from ops.leave_type`, 0);
  await expectRows('an employee cannot change a type (no row changes)', E1, `update ops.leave_type set annual_quota = 99 where id = '${casual}' returning id`, 0);
  await expectRows('a lead cannot change a type', L, `update ops.leave_type set annual_quota = 99 where id = '${casual}' returning id`, 0);
  await expectErr('an employee cannot add a type', E1, `insert into ops.leave_type (code, name) values ('extra', 'Extra')`, 'row-level security');
  await expectOk('HR adds a type', H, `insert into ops.leave_type (code, name, annual_quota, count_weekends, count_holidays, has_balance, half_day_allowed, sort_order) values ('wfh_ill', ' Study leave ', 3, true, true, true, false, 9)`);
  await expectVal('...the name is trimmed', `select name from ops.leave_type where code = 'wfh_ill'`, 'Study leave');
  await expectErr('a name cannot repeat, even in another case', H, `insert into ops.leave_type (code, name) values ('study2', 'STUDY LEAVE')`, 'leave_type_name_uniq');
  await expectErr('a code must be lower-case letters and digits', H, `insert into ops.leave_type (code, name) values ('Bad Code', 'Other')`, 'check');
  await expectErr('the code cannot be changed later', H, `update ops.leave_type set code = 'other_code' where code = 'wfh_ill'`, 'cannot change');
  await expectErr('days a year cannot be negative', H, `update ops.leave_type set annual_quota = -1 where code = 'wfh_ill'`, 'check');
  await expectErr('a type cannot be deleted by HR', H, `delete from ops.leave_type where code = 'wfh_ill'`, 'permission denied');
  await expectOk('the founder edits a type', F, `update ops.leave_type set annual_quota = 4 where code = 'wfh_ill'`);
  const study = await T('wfh_ill');

  console.log('Counting days (weekends and holidays are a setting per type)');
  const days = async (type, from, to, part = 'full') => Number((await run(E1, `select ops.leave_days('${type}', '${from}', '${to}', '${part}') as v`)).rows[0].v);
  const eq = (name, got, want) => (got === want ? ok(name) : bad(name, `got ${got}, want ${want}`));
  eq('Mon to Fri is five days', await days(casual, MON, FRI), 5);
  eq('Fri to next Mon skips the weekend', await days(casual, FRI, MON2), 2);
  eq('a Saturday alone is no day', await days(casual, SAT, SUN), 0);
  eq('a half day is half', await days(casual, MON, MON, 'first_half'), 0.5);
  await expectOk('HR makes casual count weekends', H, `update ops.leave_type set count_weekends = true where id = '${casual}'`);
  eq('...Fri to Mon is now four days', await days(casual, FRI, MON2), 4);
  await expectOk('HR switches it back', H, `update ops.leave_type set count_weekends = false where id = '${casual}'`);
  eq('...two again', await days(casual, FRI, MON2), 2);
  await expectOk('HR adds a holiday on the second Monday', H, `insert into ops.office_holiday (holiday_date, name) values ('${MON2}', 'Leave test holiday')`);
  eq('a holiday inside the leave is not counted', await days(casual, FRI, MON2), 1);
  await expectOk('HR makes casual count holidays', H, `update ops.leave_type set count_holidays = true where id = '${casual}'`);
  eq('...it counts again', await days(casual, FRI, MON2), 2);
  await expectOk('HR switches it back', H, `update ops.leave_type set count_holidays = false where id = '${casual}'`);
  eq('a type that counts both uses every calendar day', await days(study, FRI, MON2), 4);
  eq('a range that is only a weekend and a holiday has no days', await days(casual, SAT, MON2), 0);
  await expectErr('the end cannot be before the start', E1, `select ops.leave_days('${casual}', '${TUE}', '${MON}', 'full')`, 'before');

  console.log('Holidays belong to HR');
  await expectOk('HR edits a holiday', H, `update ops.office_holiday set name = 'Leave test holiday 2' where holiday_date = '${MON2}'`);
  await expectRows('an employee cannot edit one (no row changes)', E1, `update ops.office_holiday set name = 'x' where holiday_date = '${MON2}' returning id`, 0);
  await expectErr('an employee cannot add one', E1, `insert into ops.office_holiday (holiday_date, name) values ('${TUE2}', 'x')`, 'row-level security');
  await expectErr('a lead cannot add one', L, `insert into ops.office_holiday (holiday_date, name) values ('${TUE2}', 'x')`, 'row-level security');
  await expectOk('the founder can still add one', F, `insert into ops.office_holiday (holiday_date, name) values ('${TUE2}', 'Founder holiday')`);
  await expectRows('HR deletes a holiday', H, `delete from ops.office_holiday where holiday_date = '${TUE2}' returning id`, 1);
  await expectRows('an employee cannot delete one', E1, `delete from ops.office_holiday where holiday_date = '${MON2}' returning id`, 0);

  console.log('Applying');
  await expectErr('a viewer cannot apply', VW, `select ops.apply_leave('${casual}', '${MON}', '${MON}', 'full', 'Trip')`, 'not available');
  await expectErr('a partner cannot apply', PT, `select ops.apply_leave('${casual}', '${MON}', '${MON}', 'full', 'Trip')`, 'not available');
  await expectErr('a reason is needed', E1, `select ops.apply_leave('${casual}', '${MON}', '${MON}', 'full', ' ')`, 'Say why');
  await expectErr('a backwards range is refused', E1, `select ops.apply_leave('${casual}', '${TUE}', '${MON}', 'full', 'Trip')`, 'before the start');
  await expectErr('a half day is for one day', E1, `select ops.apply_leave('${casual}', '${MON}', '${TUE}', 'first_half', 'Trip')`, 'single day');
  await expectErr('a made-up day part is refused', E1, `select ops.apply_leave('${casual}', '${MON}', '${MON}', 'quarter', 'Trip')`, 'whole day or a half day');
  await expectErr('leave cannot cross the new year', E1, `select ops.apply_leave('${casual}', '${cur}-12-29', '${ny}-01-02', 'full', 'Trip')`, 'one calendar year');
  await expectErr('a weekend alone has nothing to take leave on', E1, `select ops.apply_leave('${casual}', '${SAT}', '${SUN}', 'full', 'Trip')`, 'no days');
  await expectErr('a type that has no half days refuses one', E1, `select ops.apply_leave('${study}', '${MON}', '${MON}', 'first_half', 'Trip')`, 'half days');
  await expectErr('two years ahead is too far', E1, `select ops.apply_leave('${casual}', '${cur + 2}-03-02', '${cur + 2}-03-02', 'full', 'Trip')`, 'next year');
  await expectErr('more than 90 days in one go is refused', E1, `select ops.apply_leave('${unpaid}', '${ny}-01-01', '${ny}-12-31', 'full', 'Long break')`, '90 days');
  await expectErr('someone else cannot apply for me', E2, `select ops.apply_leave('${casual}', '${MON}', '${MON}', 'full', 'Trip', '${E1}')`, 'Only HR');

  const r1 = await applied('an employee applies for Mon to Wed', E1, casual, MON, WED, 'full', 'Family function');
  await expectVal('...it waits for a decision', `select state from ops.leave_request where id = '${r1}'`, 'pending');
  await expectVal('...the database worked out three days', `select days from ops.leave_request where id = '${r1}'`, '3.0');
  await expectVal('...nothing is spent until it is approved', `select count(*) from ops.leave_ledger where request_id = '${r1}'`, 0);
  await expectVal('...the yearly quota was credited once', `select count(*) from ops.leave_ledger where staff_id = '${E1}' and leave_type_id = '${casual}' and year = ${ny} and kind = 'credit'`, 1);
  {
    const b = await balanceOf(E1, E1, casual, ny);
    eq('...balance 12, pending 3, available 9', [b.balance, b.pending, b.available].map(Number).join('/'), '12/3/9');
  }
  await expectErr('overlapping leave is refused', E1, `select ops.apply_leave('${sick}', '${WED}', '${THU}', 'full', 'Fever')`, 'already have leave');
  await expectErr('a whole day over a half day is refused', E1, `select ops.apply_leave('${casual}', '${TUE}', '${TUE}', 'first_half', 'Trip')`, 'already have leave');
  await expectErr('asking for more than is left is refused', E1, `select ops.apply_leave('${casual}', '${WK12}', '${day(84)}', 'full', 'Long trip')`, 'Not enough');
  await expectOk('unpaid leave needs no balance', E1, `select ops.apply_leave('${unpaid}', '${WK10}', '${WK10_END}', 'full', 'Exam preparation')`);
  await expectErr('comp-off with no days is refused', E1, `select ops.apply_leave('${comp}', '${WK4}', '${WK4_END}', 'full', 'Worked Sunday')`, 'Not enough');
  await expectVal('...the failed attempts left nothing behind', `select count(*) from ops.leave_request where staff_id = '${E1}'`, 2);

  console.log('Half days on one date');
  const h1 = await applied('a first half-day is accepted', E2, casual, MON, MON, 'first_half', 'Dentist');
  await expectOk('...and the second half of the same day too', E2, `select ops.apply_leave('${casual}', '${MON}', '${MON}', 'second_half', 'Bank work')`);
  await expectErr('...but the same half twice is refused', E2, `select ops.apply_leave('${sick}', '${MON}', '${MON}', 'first_half', 'Again')`, 'already have leave');
  await expectVal('...each is half a day', `select sum(days) from ops.leave_request where staff_id = '${E2}'`, '1.0');

  console.log('Who can see what');
  await expectRows('the employee sees their own requests', E1, `select id from ops.leave_request`, 2);
  await expectRows('a colleague sees none of them', E2, `select id from ops.leave_request where staff_id = '${E1}'`, 0);
  await expectRows('another team sees none of them', E3, `select id from ops.leave_request where staff_id = '${E1}'`, 0);
  await expectRows('the lead of the team sees them', L, `select id from ops.leave_request where staff_id = '${E1}'`, 2);
  await expectRows('HR sees them', H, `select id from ops.leave_request where staff_id = '${E1}'`, 2);
  await expectRows('the founder sees them', F, `select id from ops.leave_request where staff_id = '${E1}'`, 2);
  await expectRows('a viewer sees none', VW, `select id from ops.leave_request`, 0);
  await expectRows('a partner sees none', PT, `select id from ops.leave_request`, 0);
  eq('the employee sees their own ledger', (await rows(E1, `select id from ops.leave_ledger`)) >= 3, true);
  eq('...and only theirs', await rows(E1, `select id from ops.leave_ledger where staff_id <> '${E1}'`), 0);
  await expectRows('a colleague sees no ledger of theirs', E3, `select id from ops.leave_ledger where staff_id = '${E1}'`, 0);
  await expectErr('a colleague cannot read someone else\'s balances', E3, `select * from ops.leave_balances('${E1}', ${ny})`, 'cannot see');
  await expectOk('the lead can', L, `select * from ops.leave_balances('${E1}', ${ny})`);
  await expectOk('HR can', H, `select * from ops.leave_balances('${E1}', ${ny})`);
  await expectRows('a viewer has no balances to show', VW, `select * from ops.leave_balances('${VW}', ${ny})`, 0);

  console.log('The ledger and requests cannot be written directly');
  await expectErr('no one inserts a request by hand', E1, `insert into ops.leave_request (staff_id, leave_type_id, from_date, to_date, days, reason) values ('${E1}', '${casual}', '${THU}', '${THU}', 1, 'Sneaky')`, 'permission denied');
  await expectErr('no one edits a request by hand', E1, `update ops.leave_request set state = 'approved' where id = '${r1}'`, 'permission denied');
  await expectErr('no one inserts a ledger row', H, `insert into ops.leave_ledger (staff_id, leave_type_id, year, kind, days) values ('${E1}', '${casual}', ${ny}, 'adjustment', 50)`, 'permission denied');
  await expectErr('no one edits a ledger row', H, `update ops.leave_ledger set days = 99 where staff_id = '${E1}'`, 'permission denied');
  await expectErr('no one deletes a ledger row', F, `delete from ops.leave_ledger where staff_id = '${E1}'`, 'permission denied');
  await expectErr('the yearly credit cannot be written twice', null, `insert into ops.leave_ledger (staff_id, leave_type_id, year, kind, days) values ('${E1}', '${casual}', ${ny}, 'credit', 12)`, 'leave_ledger_credit_once');
  await expectErr('a debit must be negative', null, `insert into ops.leave_ledger (staff_id, leave_type_id, year, kind, days) values ('${E1}', '${casual}', ${ny}, 'debit', 2)`, 'check');
  await expectErr('a credit must be positive', null, `insert into ops.leave_ledger (staff_id, leave_type_id, year, kind, days) values ('${E1}', '${sick}', ${ny}, 'credit', -2)`, 'check');

  console.log('Deciding');
  await expectErr('the employee cannot approve their own', E1, `select ops.decide_leave('${r1}', true)`, 'own leave');
  await expectErr('a colleague cannot approve it', E2, `select ops.decide_leave('${r1}', true)`, 'cannot decide');
  await expectErr('a lead of another team cannot', E3, `select ops.decide_leave('${r1}', true)`, 'cannot decide');
  await expectErr('a viewer cannot', VW, `select ops.decide_leave('${r1}', true)`, 'cannot decide');
  await expectErr('turning it down needs a reason', L, `select ops.decide_leave('${r1}', false)`, 'why');
  await expectOk('the lead approves', L, `select ops.decide_leave('${r1}', true, 'Enjoy')`);
  await expectVal('...it is approved', `select state from ops.leave_request where id = '${r1}'`, 'approved');
  await expectVal('...by the lead', `select decided_by from ops.leave_request where id = '${r1}'`, L);
  await expectVal('...three days came off the balance', `select sum(days) from ops.leave_ledger where request_id = '${r1}'`, '-3.0');
  {
    const b = await balanceOf(E1, E1, casual, ny);
    eq('...balance 9, none pending, 3 used', [b.balance, b.pending, b.used, b.available].map(Number).join('/'), '9/0/3/9');
  }
  await expectErr('an approved request cannot be decided again', L, `select ops.decide_leave('${r1}', false, 'Changed my mind')`, 'already approved');
  const r2 = await applied('the employee asks for a Friday', E1, sick, FRI, FRI, 'full', 'Fever');
  await expectErr('a lead cannot approve their own leave', L, `select ops.decide_leave('${await applied('the lead applies', L, casual, WED, WED, 'full', 'Errand')}', true)`, 'own leave');
  await expectOk('HR turns the Friday down with a reason', H, `select ops.decide_leave('${r2}', false, 'Release day')`);
  await expectVal('...it is rejected', `select state from ops.leave_request where id = '${r2}'`, 'rejected');
  await expectVal('...nothing was spent', `select count(*) from ops.leave_ledger where request_id = '${r2}'`, 0);
  await expectVal('...the reason is kept', `select decision_note from ops.leave_request where id = '${r2}'`, 'Release day');
  await expectOk('the founder approves the lead\'s own leave', F, `select ops.decide_leave('${await val(`select id from ops.leave_request where staff_id = '${L}'`)}', true)`);
  await expectOk('HR can approve for another team', H, `select ops.decide_leave('${await applied('another team applies', E3, casual, TUE, TUE, 'full', 'Errand')}', true)`);

  console.log('A pending request counts against what is left');
  await expectOk('E5 asks for ten of twelve days', E5, `select ops.apply_leave('${casual}', '${WK3}', '${WK3_END}', 'full', 'Trip abroad')`);
  await expectErr('...a second ask beyond the two left is refused', E5, `select ops.apply_leave('${casual}', '${WK6}', '${day(39)}', 'full', 'More travel')`, 'Not enough');
  await expectOk('...two days are still allowed', E5, `select ops.apply_leave('${casual}', '${WK5}', '${WK5_END}', 'full', 'Short trip')`);
  await expectVal('...pending now equals the whole balance', `select pending from ops.leave_balances('${E5}', ${ny}) where leave_type_id = '${casual}'`, '12.0');

  console.log('Cancelling');
  await expectErr('a colleague cannot cancel it', E2, `select ops.cancel_leave('${r1}')`, 'cannot cancel');
  await expectOk('the employee cancels approved leave that has not started', E1, `select ops.cancel_leave('${r1}')`);
  await expectVal('...it is cancelled', `select state from ops.leave_request where id = '${r1}'`, 'cancelled');
  await expectVal('...the days came back through a reversal row', `select sum(days) from ops.leave_ledger where request_id = '${r1}'`, '0.0');
  await expectVal('...the debit is still on the record', `select count(*) from ops.leave_ledger where request_id = '${r1}' and kind = 'debit'`, 1);
  await expectErr('a cancelled request cannot be cancelled again', E1, `select ops.cancel_leave('${r1}')`, 'already cancelled');
  await expectVal('...balance is back to 12', `select balance from ops.leave_balances('${E1}', ${ny}) where leave_type_id = '${casual}'`, '12.0');
  {
    const pend = await applied('a pending one to withdraw', E1, casual, TUE, TUE, 'full', 'Errand');
    await expectOk('the employee withdraws a pending request', E1, `select ops.cancel_leave('${pend}')`);
    await expectVal('...no ledger row was needed', `select count(*) from ops.leave_ledger where request_id = '${pend}'`, 0);
  }

  await db.exec(`update ops.office_settings set work_days = '{1,2,3,4,5,6,7}'`);
  console.log('Leave that has started');
  {
    const today = await val(`select ops.today_ist()::text`);
    const id = await applied('HR records leave that starts today', H, casual, today, today, 'full', 'Sudden illness', E5);
    void id;
  }
  await expectVal('...it needs no approval', `select state from ops.leave_request where staff_id = '${E5}' and from_date = ops.today_ist()`, 'approved');
  await expectVal('...and the days were taken off at once', `select count(*) from ops.leave_ledger where staff_id = '${E5}' and kind = 'debit' and note = 'Recorded by HR'`, 1);
  {
    const started = await val(`select id from ops.leave_request where staff_id = '${E5}' and from_date = ops.today_ist()`);
    await expectErr('the person cannot cancel leave that has started', E5, `select ops.cancel_leave('${started}')`, 'only be cancelled by HR');
    await expectOk('HR can', H, `select ops.cancel_leave('${started}')`);
  }

  console.log('Back-dating');
  await expectErr('an employee cannot start leave a month ago', E1, `select ops.apply_leave('${casual}', ops.today_ist() - 30, ops.today_ist() - 30, 'full', 'Forgot')`, 'at most 14 days back');
  await expectOk('HR records old leave for someone', H, `select ops.apply_leave('${unpaid}', ops.today_ist() - 30, ops.today_ist() - 30, 'full', 'Told verbally', '${E1}')`);
  await expectErr('HR cannot record it for a viewer', H, `select ops.apply_leave('${unpaid}', '${MON}', '${MON}', 'full', 'x', '${VW}')`, 'cannot take leave');

  await db.exec(`update ops.office_settings set work_days = '{1,2,3,4,5}'`);
  console.log('HR adjusts a balance');
  await expectErr('an employee cannot adjust', E1, `select ops.hr_adjust_balance('${E1}', '${casual}', ${ny}, 2, 'Bonus day')`, 'Only HR');
  await expectErr('a lead cannot adjust', L, `select ops.hr_adjust_balance('${E1}', '${casual}', ${ny}, 2, 'Bonus day')`, 'Only HR');
  await expectErr('a note is required', H, `select ops.hr_adjust_balance('${E1}', '${casual}', ${ny}, 2, ' ')`, 'Say why');
  await expectErr('zero is not an adjustment', H, `select ops.hr_adjust_balance('${E1}', '${casual}', ${ny}, 0, 'Nothing')`, 'other than zero');
  await expectErr('a type with no balance cannot be adjusted', H, `select ops.hr_adjust_balance('${E1}', '${unpaid}', ${ny}, 1, 'Nope')`, 'does not keep a balance');
  await expectErr('it cannot take the balance below zero', H, `select ops.hr_adjust_balance('${E1}', '${casual}', ${ny}, -50, 'Too much')`, 'below zero');
  await expectErr('it cannot reach years away', H, `select ops.hr_adjust_balance('${E1}', '${casual}', ${cur - 5}, 1, 'Ancient')`, 'last year or next');
  await expectOk('HR gives a comp-off day', H, `select ops.hr_adjust_balance('${E1}', '${comp}', ${ny}, 1, 'Worked on a Sunday')`);
  await expectVal('...the balance shows it', `select balance from ops.leave_balances('${E1}', ${ny}) where leave_type_id = '${comp}'`, '1.0');
  await expectOk('...and the employee can use it', E1, `select ops.apply_leave('${comp}', '${WK4}', '${WK4_END}', 'full', 'Comp-off for Sunday')`);
  await expectOk('HR takes back a day', H, `select ops.hr_adjust_balance('${E1}', '${sick}', ${ny}, -2, 'Used 2 days outside the system')`);
  await expectVal('...the access is logged', `select count(*) from ops.hr_access_log where actor_id = '${H}' and target_id = '${E1}' and what = 'adjusted leave balance'`, 2);

  console.log('Carry forward and the cap');
  await expectOk('HR sets the earned cap to 10', H, `update ops.leave_type set carry_cap = 10 where id = '${earned}'`);
  await expectOk('E4 opens this year', E4, `select * from ops.leave_balances('${E4}', ${cur})`);
  await expectVal('...this year\'s quota is there', `select sum(days) from ops.leave_ledger where staff_id = '${E4}' and leave_type_id = '${earned}' and year = ${cur}`, '15.0');
  await expectOk('E4 opens next year', E4, `select * from ops.leave_balances('${E4}', ${ny})`);
  await expectVal('...earned carried over, capped at 10', `select days from ops.leave_ledger where staff_id = '${E4}' and leave_type_id = '${earned}' and year = ${ny} and kind = 'carry'`, '10.0');
  await expectVal('...so next year has 25', `select balance from ops.leave_balances('${E4}', ${ny}) where leave_type_id = '${earned}'`, '25.0');
  await expectVal('...casual does not carry (it is off)', `select count(*) from ops.leave_ledger where staff_id = '${E4}' and leave_type_id = '${casual}' and year = ${ny} and kind = 'carry'`, 0);
  await expectOk('HR removes the cap', H, `update ops.leave_type set carry_cap = null where id = '${earned}'`);
  await expectOk('E2 opens next year (never opened this year)', E2, `select * from ops.leave_balances('${E2}', ${ny})`);
  await expectVal('...nothing is invented for a year the system never ran for them', `select count(*) from ops.leave_ledger where staff_id = '${E2}' and year = ${ny} and kind = 'carry'`, 0);
  await expectOk('opening again changes nothing', E4, `select * from ops.leave_balances('${E4}', ${ny})`);
  await expectVal('...still one credit and one carry', `select count(*) from ops.leave_ledger where staff_id = '${E4}' and leave_type_id = '${earned}' and year = ${ny}`, 2);
  await expectOk('HR switches carry forward off for earned', H, `update ops.leave_type set carry_forward = false where id = '${earned}'`);
  await expectOk('E3 opens this year then next', E3, `select * from ops.leave_balances('${E3}', ${cur})`);
  await expectOk('...next year', E3, `select * from ops.leave_balances('${E3}', ${ny})`);
  await expectVal('...nothing carried now', `select count(*) from ops.leave_ledger where staff_id = '${E3}' and year = ${ny} and kind = 'carry'`, 0);
  await expectOk('HR puts it back', H, `update ops.leave_type set carry_forward = true, carry_cap = 30 where id = '${earned}'`);

  console.log('Starting the year for everyone');
  await expectErr('an employee cannot', E1, `select ops.credit_annual_quota(${ny})`, 'Only HR');
  {
    const n = Number((await run(H, `select ops.credit_annual_quota(${ny}) as n`)).rows[0].n);
    n >= 8 ? ok('HR credits everyone eligible') : bad('HR credits everyone eligible', `only ${n}`);
  }
  await expectVal('...a viewer got nothing', `select count(*) from ops.leave_ledger where staff_id = '${VW}'`, 0);
  await expectVal('...a partner got nothing', `select count(*) from ops.leave_ledger where staff_id = '${PT}'`, 0);
  await expectVal('...the founder, an employee too, got a quota (one credit per type with a balance)', `select count(*) from ops.leave_ledger where staff_id = '${F}' and year = ${ny} and kind = 'credit'`, 4);
  await expectOk('...doing it again is harmless', H, `select ops.credit_annual_quota(${ny})`);
  await expectVal('...no duplicates', `select count(*) from ops.leave_ledger where kind = 'credit' and year = ${ny} group by staff_id, leave_type_id having count(*) > 1`, 'null');

  console.log('The ledger always adds up');
  {
    for (const [who, label] of [[E1, 'the employee'], [E4, 'the capped one'], [E5, 'the back-dater']]) {
      for (const [type, name] of [[casual, 'casual'], [sick, 'sick'], [earned, 'earned']]) {
        const sum = Number(await ledgerSum(who, type, ny));
        const shown = Number((await balanceOf(who, who, type, ny)).balance);
        eq(`${label}: ${name} balance equals the sum of the ledger`, shown, sum);
      }
    }
    eq('E1 casual: 12 credited, the approved leave was cancelled', Number(await ledgerSum(E1, casual, ny)), 12);
    eq('E1 sick: 12 credited, 2 taken back by HR', Number(await ledgerSum(E1, sick, ny)), 10);
    eq('E5 casual: 12 credited, nothing approved in next year', Number(await ledgerSum(E5, casual, ny)), 12);
    const mism = await val(`
      select count(*) from ops.leave_ledger l
       where l.kind = 'debit' and not exists (select 1 from ops.leave_request r where r.id = l.request_id and r.state in ('approved', 'cancelled'))`);
    eq('every debit belongs to an approved or cancelled request', Number(mism), 0);
    const open = await val(`
      select count(*) from ops.leave_request r
       where r.state = 'approved' and r.days <> -(select coalesce(sum(l.days), 0) from ops.leave_ledger l where l.request_id = r.id)
         and exists (select 1 from ops.leave_type t where t.id = r.leave_type_id and t.has_balance)`);
    eq('approved leave on a balance type is paid for by exactly its days', Number(open), 0);
    const cancelled = await val(`
      select count(*) from ops.leave_request r
       where r.state in ('cancelled', 'rejected', 'pending') and coalesce((select sum(l.days) from ops.leave_ledger l where l.request_id = r.id), 0) <> 0`);
    eq('cancelled, rejected and pending requests cost nothing', Number(cancelled), 0);
    const negative = await val(`select count(*) from (select sum(days) s from ops.leave_ledger group by staff_id, leave_type_id, year) q where s < 0`);
    eq('no balance is below zero', Number(negative), 0);
  }

  console.log('Who is away');
  await expectOk('HR approves the lead\'s colleague Monday half-days', H, `select ops.decide_leave('${h1}', true)`);
  const away = (uid, from, to) => run(uid, `select staff_id, full_name, leave_type from ops.team_away('${from}', '${to}')`).then((r) => r.rows);
  {
    const e1 = await applied('E1 applies for Wednesday', E1, casual, WED, WED, 'full', 'Errand');
    await expectOk('the lead approves it', L, `select ops.decide_leave('${e1}', true)`);
  }
  {
    const seenByColleague = await away(E2, MON, WED);
    eq('a colleague sees the team away on a date', seenByColleague.some((r) => r.full_name === 'Lv Employee'), true);
    eq('...without the kind of leave (their own is shown to themselves)', seenByColleague.filter((r) => r.staff_id !== E2).every((r) => r.leave_type === null), true);
    const seenByLead = await away(L, MON, WED);
    eq('the lead sees the kind of leave', seenByLead.some((r) => r.full_name === 'Lv Employee' && r.leave_type === 'Casual leave'), true);
    const otherTeam = await away(E3, MON, WED);
    eq('another team does not see them', otherTeam.some((r) => r.full_name === 'Lv Employee'), false);
    const hr = await away(H, MON, WED);
    eq('HR sees every team with the kind', hr.some((r) => r.full_name === 'Lv Employee' && r.leave_type === 'Casual leave'), true);
    const founder = await away(F, MON, WED);
    eq('the founder sees everyone', founder.length >= 2, true);
    const pending = await away(H, THU, FRI);
    eq('pending requests are not shown', pending.length === 0, true);
  }
  await expectErr('a partner cannot ask', PT, `select * from ops.team_away('${MON}', '${FRI}')`, 'Not available');
  await expectOk('a viewer can see who is away (read only)', VW, `select * from ops.team_away('${MON}', '${FRI}')`);
  await expectErr('a very long range is refused', E1, `select * from ops.team_away('${MON}', '${ny}-12-31')`, '93 days');

  console.log('The month view and absence');
  await db.exec(`
    select set_config('session_replication_role', 'replica', false);
    update ops.staff set works_from_office = true, office_since = ops.today_ist() - 900 where id in ('${E1}', '${E2}');
    select set_config('session_replication_role', 'origin', false);`);
  {
    const grid = async (uid, staff) => (await run(uid, `select work_date::text d, expected, leave_name, leave_half from ops.attendance_month('${staff}', '${MON}')`)).rows;
    const m = await grid(L, E1);
    const wed = m.find((r) => r.d === WED), mon = m.find((r) => r.d === MON);
    eq('an approved day shows its leave name', wed?.leave_name, 'Casual leave');
    eq('...and is not an expected working day (so it is not an absence)', wed?.expected, false);
    eq('a day without leave has no name', mon?.leave_name, null);
    eq('...and is still expected', mon?.expected, true);
    const half = (await grid(L, E2)).find((r) => r.d === MON);
    eq('a half day shows its leave name', half?.leave_name, 'Casual leave');
    eq('...flagged as half', half?.leave_half, true);
    eq('...and still expected for the other half', half?.expected, true);
    const cancelledDay = (await grid(L, E1)).find((r) => r.d === TUE);
    eq('a cancelled day shows nothing', cancelledDay?.leave_name, null);
    const own = await grid(E1, E1);
    eq('a person reads their own month', own.find((r) => r.d === WED)?.leave_name, 'Casual leave');
  }

  // Leave the shared data as other suites expect it.
  await db.exec(`
    delete from ops.office_holiday where name like 'Leave test holiday%';
    update ops.office_settings set work_days = '${origWorkDays}';`);
}
