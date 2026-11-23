// People & HR home (0037): what needs action, who is where, and sending a file to a person.
// Called from test-migrations.mjs.
export default async function hrHomeTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, val, F, S, W, T2, P, V, O } = t;
  console.log('\nPeople & HR home (0037)');
  const rows = async (uid, sql) => (await run(uid, sql)).rows;
  const expectRows = async (name, uid, sql, want) => {
    let n;
    try { n = (await rows(uid, sql)).length; } catch (e) { return bad(name, e.message.split('\n')[0]); }
    n === want ? ok(name) : bad(name, `${n} rows, want ${want}`);
  };
  const expectScalar = async (name, uid, sql, want) => {
    try { const g = Object.values((await rows(uid, sql))[0] ?? {})[0]; String(g) === String(want) ? ok(name) : bad(name, `got ${g}, want ${want}`); }
    catch (e) { bad(name, e.message.split('\n')[0]); }
  };

  let n = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++n + 900).padStart(12, '0')}`;
  const path = (staff, name = 'letter.pdf') => `${staff}/${uuid()}-${name}`;
  const send = (staff, kind, title, p, mime = 'application/pdf', size = 2048, note = 'null') =>
    `select ops.hr_send_document('${staff}', '${kind}', '${title}', '${p}', '${mime}', ${size}, ${note}) as id`;
  const actions = (uid, where = 'true') => rows(uid, `select * from ops.hr_actions() where ${where}`);
  const overview = (uid, where = 'true') => rows(uid, `select * from ops.hr_overview() where ${where}`);

  await db.exec(`
    delete from ops.notification;
    delete from ops.leave_ledger; delete from ops.leave_request;
    delete from ops.onboarding_task; delete from ops.hr_request_message; delete from ops.hr_request;
    delete from ops.staff_document; delete from ops.hr_access_log;
    update ops.staff set is_hr = false;
    update ops.staff set role = 'member', is_active = true where id in ('${S}', '${T2}', '${O}');
    update ops.staff set role = 'dept_lead', is_active = true, is_hr = true where id = '${W}';
    update ops.staff_profile set legal_name = null, birth_date = null, birthday_visible = false, emergency_name = null,
           emergency_phone = null, joined_on = null, probation_end = null;
  `);

  console.log('Who can look');
  for (const [who, uid] of [['a member', S], ['a lead who is not HR', T2], ['a viewer', V], ['a partner', P]]) {
    await expectErr(`${who} cannot read the action list`, uid, `select * from ops.hr_actions()`, 'Only HR');
    await expectErr(`${who} cannot read the totals`, uid, `select * from ops.hr_counts()`, 'Only HR');
    await expectErr(`${who} cannot read the overview`, uid, `select * from ops.hr_overview()`, 'Only HR');
  }
  await expectOk('HR can read the action list', W, `select * from ops.hr_actions()`);
  await expectOk('the founder can read the totals', F, `select * from ops.hr_counts()`);
  await expectOk('HR can read the overview', W, `select * from ops.hr_overview()`);

  console.log('Needs action');
  const casual = await val(`select id from ops.leave_type where code = 'casual'`);
  await db.exec(`
    insert into ops.leave_request (staff_id, leave_type_id, from_date, to_date, days, reason, state, created_at)
    values ('${S}', '${casual}', ops.today_ist() + 1, ops.today_ist() + 2, 2, 'Family function', 'pending', now() - interval '2 days'),
           ('${T2}', '${casual}', ops.today_ist() + 20, ops.today_ist() + 20, 1, 'Trip', 'pending', now() - interval '1 day'),
           ('${O}', '${casual}', ops.today_ist(), ops.today_ist() + 1, 2, 'Away', 'approved', now() - interval '3 days');
    update ops.leave_request set decided_by = '${W}', decided_at = now() where state = 'approved';
  `);
  await expectOk('a member asks HR for a letter', S, `select ops.create_hr_request('experience_letter', 'Experience letter', 'For a visa')`);
  await db.exec(`update ops.hr_request set created_at = now() - interval '5 days' where staff_id = '${S}'`);
  const sDoc = (await expectOk('a member adds an ID proof', S,
    `select ops.add_staff_document('${S}', 'id_proof', 'Aadhaar', '${path(S, 'id.pdf')}', 'application/pdf', 2048, null) as id`))?.rows[0].id;
  await expectOk('another member adds a paper that expires in five days', T2,
    `select ops.add_staff_document('${T2}', 'certificate', 'Driving licence', '${path(T2, 'dl.pdf')}', 'application/pdf', 2048, ops.today_ist() + 5) as id`);
  await expectOk('HR starts a joiner checklist for O', W, `select ops.start_onboarding('${O}', 'joiner', ops.today_ist() - 10)`);

  const all = await actions(W);
  const kinds = new Set(all.map((r) => r.kind));
  for (const k of ['leave', 'request', 'document', 'expiring', 'onboarding']) {
    kinds.has(k) ? ok(`the list has ${k} rows`) : bad(`the list has ${k} rows`, [...kinds].join(','));
  }
  await expectScalar('a pending leave names the person', W, `select full_name from ops.hr_actions() where kind = 'leave' and staff_id = '${S}'`,
    await val(`select full_name from ops.staff where id = '${S}'`));
  await expectScalar('...and its type', W, `select title from ops.hr_actions() where kind = 'leave' and staff_id = '${S}'`, 'Casual leave');
  await expectScalar('...and how many days', W, `select detail from ops.hr_actions() where kind = 'leave' and staff_id = '${S}'`, '2.0 days');
  await expectScalar('the leave starting tomorrow is urgent, the one in three weeks is not', W,
    `select string_agg(staff_id::text || ':' || urgent::text, ',' order by staff_id) from ops.hr_actions() where kind = 'leave'`,
    [`${S}:true`, `${T2}:false`].sort().join(','));
  await expectScalar('an approved leave is not an action', W, `select count(*) from ops.hr_actions() where kind = 'leave' and staff_id = '${O}'`, 0);
  await expectScalar('a request waiting five days is urgent', W, `select urgent from ops.hr_actions() where kind = 'request'`, true);
  await expectScalar('the expiring licence carries its date', W, `select due_on = ops.today_ist() + 5 from ops.hr_actions() where kind = 'expiring'`, true);
  await expectScalar('the unverified ID proof is listed', W, `select count(*) from ops.hr_actions() where kind = 'document' and ref_id = '${sDoc}'`, 1);
  await expectScalar('overdue joiner steps are listed for O', W, `select count(*) > 0 from ops.hr_actions() where kind = 'onboarding' and staff_id = '${O}'`, true);
  const first = all[0];
  first.urgent ? ok('urgent rows come first') : bad('urgent rows come first', JSON.stringify(first).slice(0, 120));
  let sorted = true;
  for (let i = 1; i < all.length; i++) if (all[i - 1].urgent === false && all[i].urgent === true) sorted = false;
  sorted ? ok('...and no urgent row follows a calm one') : bad('urgent rows are not all first');

  console.log('Totals');
  const c = (await rows(W, `select * from ops.hr_counts()`))[0];
  Number(c.leave_pending) === 2 ? ok('two leave requests are waiting') : bad('two leave requests are waiting', String(c.leave_pending));
  Number(c.requests_waiting) === 1 ? ok('one request is waiting') : bad('one request is waiting', String(c.requests_waiting));
  Number(c.docs_to_verify) === 2 ? ok('two papers wait for verification') : bad('two papers wait for verification', String(c.docs_to_verify));
  Number(c.docs_expiring) === 1 ? ok('one paper is expiring') : bad('one paper is expiring', String(c.docs_expiring));
  Number(c.onboarding_due) >= 1 ? ok('onboarding steps are due') : bad('onboarding steps are due', String(c.onboarding_due));
  Number(c.on_leave_today) === 1 ? ok('one person is on leave today') : bad('one person is on leave today', String(c.on_leave_today));
  const people = await val(`select count(*) from ops.staff where is_active and role in ('founder', 'dept_lead', 'member')`);
  Number(c.headcount) === Number(people) ? ok('the headcount counts team members only') : bad('the headcount counts team members only', String(c.headcount));

  await expectOk('HR declines the ID proof', W, `select ops.verify_staff_document('${sDoc}', false, 'The photo is blurry')`);
  await expectScalar('a declined paper is no longer waiting on HR', W, `select count(*) from ops.hr_actions() where kind = 'document' and ref_id = '${sDoc}'`, 0);
  await expectScalar('...and the total drops', W, `select docs_to_verify from ops.hr_counts()`, 1);

  await db.exec(`update ops.staff set is_active = false where id = '${T2}'`);
  await expectScalar('a person who has left drops off the lists', W, `select count(*) from ops.hr_actions() where staff_id = '${T2}'`, 0);
  await db.exec(`update ops.staff set is_active = true where id = '${T2}'`);

  console.log('People overview');
  await db.exec(`
    update ops.staff_profile set joined_on = ops.today_ist() where staff_id = '${O}';
    update ops.staff_profile set probation_end = ops.today_ist() + 10 where staff_id = '${S}';
    update ops.staff_profile set probation_end = ops.today_ist() + 60 where staff_id = '${T2}';
    update ops.staff_profile set birth_date = (ops.today_ist() + 3) - interval '30 years', birthday_visible = true where staff_id = '${S}';
    update ops.staff_profile set birth_date = (ops.today_ist() + 3) - interval '31 years', birthday_visible = false where staff_id = '${T2}';
    update ops.staff_profile set joined_on = (ops.today_ist() + 5) - interval '2 years' where staff_id = '${T2}';
  `);
  expectOkRows('O is on leave today', await overview(W, `list = 'on_leave' and staff_id = '${O}'`), 1);
  expectOkRows('O is joining this month', await overview(W, `list = 'joining' and staff_id = '${O}'`), 1);
  expectOkRows('S has probation ending within 30 days', await overview(W, `list = 'probation' and staff_id = '${S}'`), 1);
  expectOkRows('T2 does not, probation ends in 60 days', await overview(W, `list = 'probation' and staff_id = '${T2}'`), 0);
  expectOkRows('a shared birthday shows', await overview(W, `list = 'birthday' and staff_id = '${S}'`), 1);
  expectOkRows('a private birthday does not', await overview(W, `list = 'birthday' and staff_id = '${T2}'`), 0);
  await expectScalar('the birthday is on the right day', W, `select on_date = ops.today_ist() + 3 from ops.hr_overview() where list = 'birthday' and staff_id = '${S}'`, true);
  await expectScalar('the anniversary is two years', W, `select detail from ops.hr_overview() where list = 'anniversary' and staff_id = '${T2}'`, '2');
  await expectScalar('...and falls on the right day', W, `select on_date = ops.today_ist() + 5 from ops.hr_overview() where list = 'anniversary' and staff_id = '${T2}'`, true);
  expectOkRows('O just joined and has gaps', await overview(W, `list = 'setup_gap' and staff_id = '${O}'`), 1);
  await expectScalar('...naming the profile and the ID proof', W, `select detail from ops.hr_overview() where list = 'setup_gap' and staff_id = '${O}'`,
    'profile details and a verified ID proof');
  await expectOk('HR hands O an ID proof', W, send(O, 'id_proof', 'Aadhaar copy', path(O, 'id.pdf')));
  await expectScalar('a verified ID proof leaves only the profile gap', W, `select detail from ops.hr_overview() where list = 'setup_gap' and staff_id = '${O}'`, 'profile details');
  await db.exec(`update ops.staff_profile set legal_name = 'Olive Ops', birth_date = date '1995-05-05', emergency_name = 'Mum', emergency_phone = '9999999999' where staff_id = '${O}'`);
  expectOkRows('a complete profile and a verified ID leave no gap', await overview(W, `list = 'setup_gap' and staff_id = '${O}'`), 0);

  await expectOk('HR starts a leaver checklist for T2', W, `select ops.start_onboarding('${T2}', 'leaver', ops.today_ist() + 7)`);
  expectOkRows('a running leaver checklist shows under leaving', await overview(W, `list = 'leaving' and staff_id = '${T2}'`), 1);

  console.log('Sending a file');
  const doc1 = (await expectOk('HR sends S a file', W, send(S, 'offer_letter', 'Offer letter', path(S, 'offer.pdf'), 'application/pdf', 4096, `'Please keep a copy'`)))?.rows[0].id;
  await expectScalar('...it is on their record already verified', S, `select verified_at is not null and verified_by = '${W}' from ops.staff_document where id = '${doc1}'`, true);
  await expectScalar('...and says who uploaded it', S, `select uploaded_by from ops.staff_document where id = '${doc1}'`, W);
  await expectScalar('...so it is not waiting for verification', W, `select count(*) from ops.hr_actions() where ref_id = '${doc1}'`, 0);
  await expectRows('the person is told', S, `select id from ops.notification where kind = 'hr_file'`, 1);
  await expectScalar('...with the title and the note', S, `select message from ops.notification where kind = 'hr_file'`, 'HR sent you a file: Offer letter - Please keep a copy');
  await expectScalar('...and it names HR as the sender', S, `select actor_id from ops.notification where kind = 'hr_file'`, W);
  await expectRows('nobody else is told', O, `select id from ops.notification where kind = 'hr_file' and recipient_id <> '${O}'`, 0);
  await expectRows('another member cannot see the file', T2, `select id from ops.staff_document where id = '${doc1}'`, 0);
  await expectRows('the person sees it', S, `select id from ops.staff_document where id = '${doc1}'`, 1);
  await expectScalar('the hand-over is in the access log', W, `select count(*) from ops.hr_access_log where target_id = '${S}' and what = 'sent document Offer letter'`, 1);
  await expectOk('the founder can send too', F, send(S, 'payslip', 'October payslip', path(S, 'pay.pdf'), 'image/png'));
  await expectErr('a member cannot send a file', S, send(O, 'other', 'Hi', path(O)), 'Only HR');
  await expectErr('a lead who is not HR cannot either', T2, send(O, 'other', 'Hi', path(O)), 'Only HR');
  await expectErr('a viewer cannot', V, send(O, 'other', 'Hi', path(O)), 'Only HR');
  await expectErr('HR cannot send to themselves', W, send(W, 'other', 'Hi', path(W)), 'someone else');
  await expectErr('a viewer cannot receive one', W, send(V, 'other', 'Hi', path(V)), 'does not keep documents');
  await expectErr('a partner cannot receive one', W, send(P, 'other', 'Hi', path(P)), 'does not keep documents');
  await db.exec(`update ops.staff set is_active = false where id = '${O}'`);
  await expectErr('someone who has left cannot receive one', W, send(O, 'other', 'Hi', path(O)), 'does not keep documents');
  await db.exec(`update ops.staff set is_active = true where id = '${O}'`);
  await expectErr('the file must sit in the person\'s own folder', W, send(S, 'other', 'Hi', path(O)), 'own folder');
  await expectErr('a title is needed', W, send(S, 'other', '   ', path(S)), 'title');
  await expectErr('an unknown kind is refused', W, send(S, 'bonus', 'Hi', path(S)), 'check');
  await expectErr('a file type that is not allowed is refused', W, send(S, 'other', 'Hi', path(S), 'application/zip'), 'check');
  await expectErr('a file over 10 MB is refused', W, send(S, 'other', 'Hi', path(S), 'application/pdf', 10485761), 'check');
  await expectErr('a long note is refused', W, send(S, 'other', 'Hi', path(S), 'application/pdf', 100, `'${'x'.repeat(301)}'`), 'under 300');
  await expectScalar('refused sends left nothing behind', W, `select count(*) from ops.staff_document where title = 'Hi'`, 0);

  console.log('The notification kinds');
  await expectOk('an older kind is still allowed', F, `select 1`);
  await db.exec(`insert into ops.notification (recipient_id, kind, message) values ('${S}', 'meeting_invite', 'Old kind still works')`);
  ok('...meeting invites are still allowed');
  await expectVal('the check names the new kind and keeps the old ones', `select pg_get_constraintdef(oid) like '%hr_file%' and pg_get_constraintdef(oid) like '%meeting_reminder%' and pg_get_constraintdef(oid) like '%overdue%' from pg_constraint where conname = 'notification_kind_check'`, true);

  function expectOkRows(name, got, want) {
    got.length === want ? ok(name) : bad(name, `${got.length} rows, want ${want}`);
  }
}
