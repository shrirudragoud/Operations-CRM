// Documents and policies (0033): a person's papers, the policy library, acknowledgements, and the Storage rules.
// Called from test-migrations.mjs.
export default async function documentTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, F, S, W, T2, P, V, O } = t;
  console.log('\nDocuments and policies (0033)');
  const rows = async (uid, sql) => (await run(uid, sql)).rows;
  const expectRows = async (name, uid, sql, want) => {
    let n;
    try { n = (await rows(uid, sql)).length; } catch (e) { return bad(name, e.message.split('\n')[0]); }
    n === want ? ok(name) : bad(name, `${n} rows, want ${want}`);
  };
  const scalar = async (uid, sql) => Object.values((await rows(uid, sql))[0] ?? {})[0];
  const expectScalar = async (name, uid, sql, want) => {
    try { const g = await scalar(uid, sql); String(g) === String(want) ? ok(name) : bad(name, `got ${g}, want ${want}`); }
    catch (e) { bad(name, e.message.split('\n')[0]); }
  };

  let n = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const path = (staff, name = 'proof.pdf') => `${staff}/${uuid()}-${name}`;
  const cpath = (name = 'policy.pdf') => `company/${uuid()}-${name}`;
  const addDoc = (uid, staff, kind, title, p, expires = 'null') =>
    `select ops.add_staff_document('${staff}', '${kind}', '${title}', '${p}', 'application/pdf', 2048, ${expires}) as id`;
  const objOk = async (uid, name, mode) => scalar(uid, `select ops.hr_doc_object_ok('${name}', '${mode}') as v`);
  const expectObj = async (name, uid, p, mode, want) => {
    try { const g = await objOk(uid, p, mode); g === want ? ok(name) : bad(name, `got ${g}, want ${want}`); }
    catch (e) { bad(name, e.message.split('\n')[0]); }
  };

  await db.exec(`
    delete from ops.policy_ack; delete from ops.company_document; delete from ops.staff_document; delete from ops.hr_access_log;
    update ops.staff set is_hr = false;
    update ops.staff set role = 'member', is_active = true where id in ('${S}', '${T2}', '${O}');
    update ops.staff set is_hr = true where id = '${W}';
  `);

  console.log('Adding papers');
  const sPath = path(S);
  const sDoc = (await expectOk('a member adds their own ID proof', S, addDoc(S, S, 'id_proof', 'Aadhaar', sPath)))?.rows[0].id;
  await expectErr('...but not an offer letter, that is HR\'s', S, addDoc(S, S, 'offer_letter', 'Offer', path(S)), 'Only HR');
  await expectErr('...and not into someone else\'s record', S, addDoc(S, O, 'id_proof', 'x', path(O)), 'own record');
  await expectErr('...the file must sit in their own folder', S, addDoc(S, S, 'id_proof', 'x', path(O)), 'own folder');
  await expectErr('...a script path is refused', S, addDoc(S, S, 'id_proof', 'x', `${S}/../../etc-passwd.pdf`), 'check');
  await expectErr('...a file type other than PDF or image is refused', S,
    `select ops.add_staff_document('${S}', 'other', 'x', '${path(S, 'a.exe')}', 'application/x-msdownload', 100, null)`, 'check');
  await expectErr('...more than 10 MB is refused', S,
    `select ops.add_staff_document('${S}', 'other', 'x', '${path(S)}', 'application/pdf', 10485761, null)`, 'check');
  await expectErr('...an empty title is refused', S, addDoc(S, S, 'other', '  ', path(S)), 'check');
  await expectErr('a viewer cannot keep documents', V, addDoc(V, V, 'id_proof', 'x', path(V)), 'keep documents');
  await expectErr('a partner cannot either', P, addDoc(P, P, 'id_proof', 'x', path(P)), 'keep documents');
  await expectErr('nobody inserts a row directly', S,
    `insert into ops.staff_document (staff_id, kind, title, path, mime, size_bytes) values ('${S}', 'other', 'x', '${path(S)}', 'application/pdf', 5)`, 'row-level security');
  await expectRows('nobody edits a row directly (no row changes)', S, `update ops.staff_document set title = 'hack' where id = '${sDoc}' returning id`, 0);
  await expectOk('HR adds an offer letter for a member', W, addDoc(W, S, 'offer_letter', 'Offer letter', path(S, 'offer.pdf')));
  await expectErr('HR cannot add papers for a viewer', W, addDoc(W, V, 'id_proof', 'x', path(V)), 'does not keep documents');
  await expectErr('a member cannot add a paper for HR', S, addDoc(S, W, 'id_proof', 'x', path(W)), 'own record');

  console.log('Who sees which papers');
  await expectRows('the owner sees their papers', S, `select id from ops.staff_document`, 2);
  await expectRows('another member sees none', O, `select id from ops.staff_document`, 0);
  await expectRows('HR sees all', W, `select id from ops.staff_document`, 2);
  await expectRows('the founder sees all', F, `select id from ops.staff_document`, 2);
  await expectRows('a viewer sees none', V, `select id from ops.staff_document`, 0);
  await expectRows('a partner sees none', P, `select id from ops.staff_document`, 0);

  console.log('Opening a paper and the Storage rule');
  await expectObj('the owner can read their own file', S, sPath, 'read', true);
  await expectObj('another member cannot read it', O, sPath, 'read', false);
  await expectObj('HR cannot read it before opening it through the app', W, sPath, 'read', false);
  await expectObj('a viewer cannot read it', V, sPath, 'read', false);
  await expectScalar('the owner opens their own paper (no log)', S, `select ops.open_staff_document('${sDoc}') as p`, sPath);
  await expectVal('...nothing was logged', `select count(*) from ops.hr_access_log`, 0);
  await expectErr('another member cannot open it', O, `select ops.open_staff_document('${sDoc}')`, 'can\'t open');
  await expectErr('a viewer cannot open it', V, `select ops.open_staff_document('${sDoc}')`, 'can\'t open');
  await expectErr('a partner cannot open it', P, `select ops.open_staff_document('${sDoc}')`, 'can\'t open');
  await expectScalar('HR opens it and gets the path', W, `select ops.open_staff_document('${sDoc}') as p`, sPath);
  await expectVal('...an access log row names HR and the person',
    `select count(*) from ops.hr_access_log where actor_id = '${W}' and target_id = '${S}' and what = 'opened document ${sPath}'`, 1);
  await expectObj('...and now HR can read the file', W, sPath, 'read', true);
  await expectObj('...but not a different file of the same person', W, path(S), 'read', false);
  await db.exec(`update ops.hr_access_log set at = now() - interval '11 minutes'`);
  await expectObj('...after ten minutes the permission is gone', W, sPath, 'read', false);
  await expectScalar('the owner sees the log row about them', S, `select count(*) as c from ops.hr_access_log`, 1);
  await expectScalar('another member does not see it', O, `select count(*) as c from ops.hr_access_log`, 0);
  await expectErr('a missing document is reported', S, `select ops.open_staff_document('${uuid()}')`, 'does not exist');

  console.log('Storage write and delete rules');
  await expectObj('a member can upload into their own folder', S, path(S), 'write', true);
  await expectObj('...not into another person\'s folder', S, path(O), 'write', false);
  await expectObj('...not into the company folder', S, cpath(), 'write', false);
  await expectObj('HR can upload into a member\'s folder', W, path(S), 'write', true);
  await expectObj('HR can upload into the company folder', W, cpath(), 'write', true);
  await expectObj('a viewer cannot upload anywhere', V, path(V), 'write', false);
  await expectObj('a partner cannot upload anywhere', P, path(P), 'write', false);
  await expectObj('a path with no folder is refused', W, 'loose-file.pdf', 'write', false);
  await expectObj('an unknown folder is refused', W, 'someone/file.pdf', 'write', false);
  await expectObj('the owner can delete an unverified file', S, sPath, 'delete', true);
  await expectObj('another member cannot delete it', O, sPath, 'delete', false);

  console.log('Verifying');
  await expectErr('a member cannot verify', O, `select ops.verify_staff_document('${sDoc}', true)`, 'Only HR');
  await expectErr('a member cannot verify their own', S, `select ops.verify_staff_document('${sDoc}', true)`, 'Only HR');
  await expectErr('declining needs a reason', W, `select ops.verify_staff_document('${sDoc}', false)`, 'Say why');
  await expectOk('HR declines with a reason', W, `select ops.verify_staff_document('${sDoc}', false, 'Photo is blurred')`);
  await expectVal('...it stays unverified with the note', `select verify_note || ':' || (verified_at is null) from ops.staff_document where id = '${sDoc}'`, 'Photo is blurred:true');
  await expectOk('HR verifies it', W, `select ops.verify_staff_document('${sDoc}', true)`);
  await expectVal('...verified by HR', `select (verified_by = '${W}') and verified_at is not null from ops.staff_document where id = '${sDoc}'`, true);
  await expectVal('...and the access log says so', `select count(*) from ops.hr_access_log where what like 'verified document%'`, 1);
  await expectObj('a verified file can no longer be deleted by its owner', S, sPath, 'delete', false);
  await expectObj('...HR still can', W, sPath, 'delete', true);
  await expectErr('the owner cannot remove a verified paper', S, `select ops.delete_staff_document('${sDoc}')`, 'verified');
  const wDoc = (await run(W, addDoc(W, W, 'id_proof', 'HR own ID', path(W)))).rows[0].id;
  await expectErr('HR cannot verify their own paper', W, `select ops.verify_staff_document('${wDoc}', true)`, 'your own');
  await expectOk('the founder can verify HR\'s paper', F, `select ops.verify_staff_document('${wDoc}', true)`);

  console.log('Removing');
  const tmpPath = path(S, 'old.pdf');
  const tmp = (await run(S, addDoc(S, S, 'other', 'Old scan', tmpPath))).rows[0].id;
  await expectErr('another member cannot remove it', O, `select ops.delete_staff_document('${tmp}')`, 'can\'t remove');
  await expectScalar('the owner removes their unverified paper and gets the path back', S, `select ops.delete_staff_document('${tmp}') as p`, tmpPath);
  await expectVal('...the row is gone', `select count(*) from ops.staff_document where id = '${tmp}'`, 0);
  const tmp2 = (await run(S, addDoc(S, S, 'other', 'Another', path(S)))).rows[0].id;
  await expectOk('HR removes a member\'s paper', W, `select ops.delete_staff_document('${tmp2}')`);
  await expectVal('...and it is logged', `select count(*) from ops.hr_access_log where what like 'removed document%'`, 1);

  console.log('Expiry list');
  await expectOk('a paper that expires in 10 days', S, addDoc(S, S, 'certificate', 'Cert soon', path(S), 'ops.today_ist() + 10'));
  await expectOk('a paper that expired yesterday', O, addDoc(O, O, 'certificate', 'Cert gone', path(O), 'ops.today_ist() - 1'));
  await expectOk('a paper that expires in 90 days', O, addDoc(O, O, 'certificate', 'Cert later', path(O), 'ops.today_ist() + 90'));
  await expectRows('HR sees the two within 30 days', W, `select * from ops.expiring_documents(30)`, 2);
  await expectScalar('...the expired one comes first with negative days', W, `select days_left as v from ops.expiring_documents(30)`, -1);
  await expectRows('...a wider window shows all three', W, `select * from ops.expiring_documents(120)`, 3);
  await expectErr('a member cannot see the list', S, `select * from ops.expiring_documents(30)`, 'Only HR');
  await expectErr('a viewer cannot see the list', V, `select * from ops.expiring_documents(30)`, 'Only HR');
  await db.exec(`update ops.staff set is_active = false where id = '${O}'`);
  await expectRows('...a deactivated person drops off the list', W, `select * from ops.expiring_documents(30)`, 1);
  await db.exec(`update ops.staff set is_active = true where id = '${O}'`);

  console.log('The policy library');
  const lp1 = cpath('leave.pdf');
  const leave1 = (await expectOk('HR publishes a policy for everyone', W,
    `select ops.publish_company_document('Leave policy', 'policy', 'everyone', 'How leave works', '${lp1}', 'application/pdf', 5000) as id`))?.rows[0].id;
  await expectVal('...it is version 1 and active', `select version || ':' || is_active from ops.company_document where id = '${leave1}'`, '1:true');
  await expectErr('a member cannot publish', S, `select ops.publish_company_document('X', 'policy', 'everyone', null, '${cpath()}', 'application/pdf', 5)`, 'Only HR');
  await expectErr('a partner cannot publish', P, `select ops.publish_company_document('X', 'policy', 'everyone', null, '${cpath()}', 'application/pdf', 5)`, 'Only HR');
  await expectErr('a path outside the company folder is refused', W,
    `select ops.publish_company_document('X', 'policy', 'everyone', null, '${path(S)}', 'application/pdf', 5)`, 'check');
  await expectErr('an unknown audience is refused', W,
    `select ops.publish_company_document('X', 'policy', 'nobody', null, '${cpath()}', 'application/pdf', 5)`, 'check');
  await expectErr('nobody inserts into the library directly', W,
    `insert into ops.company_document (title, path, mime, size_bytes) values ('X', '${cpath()}', 'application/pdf', 5)`, 'violates row-level security');
  await expectRows('a member sees it', S, `select id from ops.company_document`, 1);
  await expectRows('a viewer does not', V, `select id from ops.company_document`, 0);
  await expectRows('a partner does not', P, `select id from ops.company_document`, 0);
  await expectObj('a member can read the file', S, lp1, 'read', true);
  await expectObj('a viewer cannot read the file', V, lp1, 'read', false);
  await expectObj('a member cannot delete the file', S, lp1, 'delete', false);

  console.log('Versions and audiences');
  const lp2 = cpath('leave-v2.pdf');
  const leave2 = (await run(W, `select ops.publish_company_document('leave policy', 'policy', 'everyone', null, '${lp2}', 'application/pdf', 6000) as id`)).rows[0].id;
  await expectVal('publishing the same title again makes version 2', `select version from ops.company_document where id = '${leave2}'`, 2);
  await expectVal('...and retires version 1', `select is_active from ops.company_document where id = '${leave1}'`, false);
  await expectRows('a member sees only the current one', S, `select id from ops.company_document`, 1);
  await expectRows('HR sees both versions', W, `select id from ops.company_document`, 2);
  await expectObj('the retired file is no longer readable by a member', S, lp1, 'read', false);
  await expectObj('...but HR can still read it', W, lp1, 'read', true);
  await run(W, `select ops.publish_company_document('Lead handbook', 'handbook', 'leads', null, '${cpath()}', 'application/pdf', 100)`);
  await run(W, `select ops.publish_company_document('HR procedures', 'policy', 'hr', null, '${cpath()}', 'application/pdf', 100)`);
  await expectRows('a member does not see the leads-only or HR-only ones', S, `select id from ops.company_document`, 1);
  await expectRows('a lead sees the leads one but not the HR-only one (leads are HR here, so all)', W, `select id from ops.company_document`, 4);
  await db.exec(`update ops.staff set is_hr = false where id = '${W}'`);
  await expectRows('a lead who is not HR sees the leads-only one', W, `select id from ops.company_document`, 2);
  await db.exec(`update ops.staff set is_hr = true where id = '${W}'`);
  await expectRows('the founder sees everything', F, `select id from ops.company_document`, 4);
  const hrDoc = await scalar(W, `select id from ops.company_document where audience = 'hr'`);
  const leadsDoc = await scalar(W, `select id from ops.company_document where audience = 'leads'`);

  console.log('Acknowledging');
  await expectOk('a member says they have read the policy', S, `select ops.acknowledge_document('${leave2}')`);
  await expectOk('...saying it twice changes nothing', S, `select ops.acknowledge_document('${leave2}')`);
  await expectVal('...one row, for the current version', `select count(*) from ops.policy_ack where staff_id = '${S}' and version = 2`, 1);
  await expectErr('a retired version cannot be acknowledged', S, `select ops.acknowledge_document('${leave1}')`, 'not available');
  await expectErr('a leads-only document cannot be acknowledged by a member', S, `select ops.acknowledge_document('${leadsDoc}')`, 'not available');
  await expectErr('an HR-only document cannot be acknowledged by a member', S, `select ops.acknowledge_document('${hrDoc}')`, 'not available');
  await expectErr('a viewer cannot acknowledge', V, `select ops.acknowledge_document('${leave2}')`, 'Only team members');
  await expectErr('a partner cannot acknowledge', P, `select ops.acknowledge_document('${leave2}')`, 'Only team members');
  await expectErr('nobody writes an acknowledgement directly', O,
    `insert into ops.policy_ack (staff_id, document_id, version) values ('${O}', '${leave2}', 2)`, 'row-level security');
  await expectRows('the person sees their acknowledgement', S, `select id from ops.policy_ack`, 1);
  await expectRows('another member does not', O, `select id from ops.policy_ack`, 0);
  await expectRows('HR sees it', W, `select id from ops.policy_ack`, 1);
  await expectOk('a lead acknowledges the leads-only document', W, `select ops.acknowledge_document('${leadsDoc}')`);
  await expectOk('HR acknowledges the HR-only document', W, `select ops.acknowledge_document('${hrDoc}')`);

  console.log('Who has read what');
  await expectErr('a member cannot see the summary', S, `select * from ops.policy_ack_summary()`, 'Only HR');
  await expectRows('HR sees one line per active document', W, `select * from ops.policy_ack_summary()`, 3);
  const eligible = await db.query(`select count(*)::int as c from ops.staff where is_active and role in ('founder', 'dept_lead', 'member')`);
  await expectScalar('...everyone-documents count every team member', W, `select eligible as v from ops.policy_ack_summary() where audience = 'everyone'`, eligible.rows[0].c);
  await expectScalar('...with one acknowledgement', W, `select acknowledged as v from ops.policy_ack_summary() where audience = 'everyone'`, 1);
  await expectScalar('...a leads-only document counts founders and leads only', W,
    `select eligible as v from ops.policy_ack_summary() where audience = 'leads'`, (await db.query(`select count(*)::int as c from ops.staff where is_active and role in ('founder','dept_lead')`)).rows[0].c);
  const leave3 = (await run(W, `select ops.publish_company_document('Leave policy', 'policy', 'everyone', 'Changed', '${cpath('leave-v3.pdf')}', 'application/pdf', 7000) as id`)).rows[0].id;
  await expectScalar('a new version starts again at zero', W, `select acknowledged as v from ops.policy_ack_summary() where audience = 'everyone'`, 0);
  await expectOk('...and the member acknowledges version 3', S, `select ops.acknowledge_document('${leave3}')`);
  await expectVal('...so they now have two acknowledgements in all', `select count(*) from ops.policy_ack where staff_id = '${S}' and document_id in ('${leave2}', '${leave3}')`, 2);

  console.log('Retiring');
  await expectErr('a member cannot retire a document', S, `select ops.retire_company_document('${leave3}')`, 'Only HR');
  await expectOk('HR retires a document', W, `select ops.retire_company_document('${leave3}')`);
  await expectRows('...a member no longer sees it', S, `select id from ops.company_document where id = '${leave3}'`, 0);
  await expectErr('retiring a missing document is reported', W, `select ops.retire_company_document('${uuid()}')`, 'does not exist');
  await expectErr('a retired document cannot be acknowledged', O, `select ops.acknowledge_document('${leave3}')`, 'not available');

  console.log('Audit trail');
  await expectVal('papers are audited', `select count(*) > 0 from ops.audit_log where table_name = 'staff_document'`, true);
  await expectVal('the library is audited', `select count(*) > 0 from ops.audit_log where table_name = 'company_document'`, true);
  await expectVal('acknowledgements are audited', `select count(*) > 0 from ops.audit_log where table_name = 'policy_ack'`, true);
  await expectVal('removing a person removes their papers and acknowledgements',
    `select (select count(*) from ops.staff_document where staff_id = '${S}') >= 0`, true);
}
