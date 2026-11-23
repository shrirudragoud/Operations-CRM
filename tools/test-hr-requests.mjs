// HR requests and onboarding (0034): asking HR for a letter, the thread, and the joiner and leaver checklists.
// Called from test-migrations.mjs.
export default async function hrRequestTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, F, S, W, T2, P, V, O } = t;
  console.log('\nHR requests and onboarding (0034)');
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
  const ask = (kind, subject, details = '') => `select ops.create_hr_request('${kind}', '${subject}', '${details}') as id`;
  const state = (id, s, note = null) => `select ops.set_hr_request_state('${id}', '${s}', ${note === null ? 'null' : `'${note}'`})`;
  const say = (id, body, internal = false) => `select ops.add_hr_request_message('${id}', '${body}', ${internal})`;

  await db.exec(`
    delete from ops.onboarding_task; delete from ops.hr_request_message; delete from ops.hr_request; delete from ops.hr_access_log;
    update ops.staff set is_hr = false;
    update ops.staff set role = 'member', is_active = true where id in ('${S}', '${T2}', '${O}');
    update ops.staff set role = 'dept_lead', is_active = true, is_hr = true where id = '${W}';
  `);

  console.log('Asking HR');
  const r1 = (await expectOk('a member asks for an experience letter', S, ask('experience_letter', 'Experience letter', 'For a visa')))?.rows[0].id;
  await expectScalar('...it starts open', S, `select state from ops.hr_request where id = '${r1}'`, 'open');
  await expectErr('a viewer cannot ask HR', V, ask('other', 'x'), 'team members');
  await expectErr('a partner cannot either', P, ask('other', 'x'), 'team members');
  await expectErr('an empty subject is refused', S, ask('other', '  '), 'check');
  await expectErr('an unknown kind is refused', S, ask('bonus', 'Please'), 'check');
  await expectErr('nobody inserts a request directly', S,
    `insert into ops.hr_request (staff_id, kind, subject) values ('${S}', 'other', 'x')`, 'row-level security');
  await expectRows('nobody edits a request directly (no row changes)', S, `update ops.hr_request set state = 'done' where id = '${r1}' returning id`, 0);
  await expectOk('the founder can ask too', F, ask('address_proof', 'Address proof'));

  console.log('Who sees which requests');
  await expectRows('the person sees their own', S, `select id from ops.hr_request`, 1);
  await expectRows('another member sees none of them', O, `select id from ops.hr_request`, 0);
  await expectRows('HR sees every request', W, `select id from ops.hr_request`, 2);
  await expectRows('the founder sees every request', F, `select id from ops.hr_request`, 2);
  await expectRows('a viewer sees none', V, `select id from ops.hr_request`, 0);

  console.log('The thread');
  await expectOk('the person adds a note', S, say(r1, 'It is needed by Friday'));
  await expectOk('HR replies in the open', W, say(r1, 'I will have it ready tomorrow'));
  await expectOk('HR leaves an internal note', W, say(r1, 'Check the joining date first', true));
  await expectRows('the person sees the open messages only', S, `select id from ops.hr_request_message where request_id = '${r1}'`, 2);
  await expectRows('HR sees all three', W, `select id from ops.hr_request_message where request_id = '${r1}'`, 3);
  await expectRows('another member sees no messages', O, `select id from ops.hr_request_message`, 0);
  await expectErr('the person cannot leave an internal note', S, say(r1, 'secret', true), 'internal notes');
  await expectErr('another member cannot write on it', O, say(r1, 'hello'), 'write on this request');
  await expectErr('a viewer cannot write on it', V, say(r1, 'hello'), 'write on this request');
  await expectErr('an empty message is refused', S, say(r1, '  '), 'Write a message');
  await expectErr('nobody inserts a message directly', S,
    `insert into ops.hr_request_message (request_id, author_id, body) values ('${r1}', '${S}', 'x')`, 'row-level security');
  await expectErr('a request that does not exist is refused', S, say('00000000-0000-4000-8000-0000000000aa', 'hi'), 'does not exist');

  console.log('Answering');
  await expectErr('a member cannot answer a request', S, state(r1, 'done'), 'Only HR');
  await expectErr('another member cannot either', O, state(r1, 'done'), 'Only HR');
  await expectOk('HR picks it up', W, state(r1, 'in_progress'));
  await expectScalar('...and is recorded as the handler', S, `select handled_by from ops.hr_request where id = '${r1}'`, W);
  await expectErr('picking it up twice is refused', W, state(r1, 'in_progress'), 'already');
  await expectErr('rejecting without a reason is refused', W, state(r1, 'rejected'), 'why');
  await expectErr('rejecting with a blank reason is refused', W, state(r1, 'rejected', '   '), 'why');
  await expectErr('an unknown state is refused', W, state(r1, 'maybe'), 'Unknown state');
  await expectOk('HR finishes it with a note', W, state(r1, 'done', 'Letter is on your documents page'));
  await expectScalar('...it is closed', S, `select closed_at is not null from ops.hr_request where id = '${r1}'`, true);
  await expectScalar('...the note is the resolution', S, `select resolution from ops.hr_request where id = '${r1}'`, 'Letter is on your documents page');
  await expectRows('...and shows in the thread for the person', S, `select id from ops.hr_request_message where request_id = '${r1}' and body = 'Letter is on your documents page'`, 1);
  await expectErr('the person cannot write on a closed request', S, say(r1, 'thanks'), 'closed');
  await expectOk('HR can still write on a closed request', W, say(r1, 'Glad to help'));
  await expectOk('HR reopens it', W, state(r1, 'open'));
  await expectScalar('...the closing time is cleared', S, `select closed_at is null from ops.hr_request where id = '${r1}'`, true);
  await expectOk('...so the person can write again', S, say(r1, 'One more thing'));
  const r2 = (await expectOk('a second request', S, ask('detail_change', 'Change my phone number', '98xxxx')))?.rows[0].id;
  await expectOk('HR rejects it with a reason', W, state(r2, 'rejected', 'Change it yourself under My profile'));
  await expectScalar('...it reads as rejected', S, `select state from ops.hr_request where id = '${r2}'`, 'rejected');

  console.log('Ten open at most');
  for (let i = 0; i < 9; i++) await run(T2, ask('other', `Request ${i + 1}`));
  await expectOk('the tenth open request is allowed', T2, ask('other', 'Request 10'));
  await expectErr('the eleventh is refused', T2, ask('other', 'Request 11'), 'ten open');
  const t2Open = await rows(T2, `select id from ops.hr_request where state = 'open' limit 1`);
  await expectOk('HR closes one', W, state(t2Open[0].id, 'done'));
  await expectOk('...and the person can ask again', T2, ask('other', 'Request 11'));
  await db.exec(`delete from ops.hr_request where staff_id = '${T2}'`);

  console.log('Checklist templates');
  await expectScalar('the joiner checklist is seeded', W, `select count(*) from ops.onboarding_template where kind = 'joiner'`, 7);
  await expectScalar('so is the leaver checklist', W, `select count(*) from ops.onboarding_template where kind = 'leaver'`, 6);
  await expectRows('a member cannot read the templates', S, `select id from ops.onboarding_template`, 0);
  await expectRows('a viewer cannot either', V, `select id from ops.onboarding_template`, 0);
  await expectErr('a member cannot add a template item', S,
    `insert into ops.onboarding_template (kind, title, owner) values ('joiner', 'x', 'hr')`, 'row-level security');
  await expectRows('a member cannot edit one (no row changes)', S, `update ops.onboarding_template set title = 'x' returning id`, 0);
  await expectRows('a member cannot delete one (no row changes)', S, `delete from ops.onboarding_template returning id`, 0);
  const tmpl = (await expectOk('HR adds an item', W,
    `insert into ops.onboarding_template (kind, title, owner, due_offset, position) values ('joiner', 'Collect a photo', 'hr', 2, 80) returning id`))?.rows[0].id;
  await expectOk('HR edits it', W, `update ops.onboarding_template set detail = 'Passport size' where id = '${tmpl}'`);
  await expectErr('an unknown owner is refused', W,
    `insert into ops.onboarding_template (kind, title, owner) values ('joiner', 'x', 'janitor')`, 'check');
  await expectErr('a due date far away is refused', W,
    `insert into ops.onboarding_template (kind, title, owner, due_offset) values ('joiner', 'x', 'hr', 400)`, 'check');
  await expectOk('HR switches it off', W, `update ops.onboarding_template set is_active = false where id = '${tmpl}'`);

  console.log('Starting a checklist');
  await expectErr('a member cannot start a checklist', S, `select ops.start_onboarding('${O}', 'joiner', null)`, 'Only HR');
  await expectErr('a lead who is not HR cannot either', T2, `select ops.start_onboarding('${O}', 'joiner', null)`, 'Only HR');
  await expectErr('a viewer has no checklist', W, `select ops.start_onboarding('${V}', 'joiner', null)`, 'does not have a checklist');
  await expectErr('a partner has no checklist', W, `select ops.start_onboarding('${P}', 'joiner', null)`, 'does not have a checklist');
  await expectErr('an unknown kind is refused', W, `select ops.start_onboarding('${O}', 'promotion', null)`, 'Joiner or leaver');
  await expectScalar('HR starts the joiner list for an outreach member', W, `select ops.start_onboarding('${O}', 'joiner', '2026-12-01')`, 7);
  await expectScalar('...the switched-off item was left out', W, `select count(*) from ops.onboarding_task where staff_id = '${O}' and title = 'Collect a photo'`, 0);
  await expectScalar('...due dates count from the start day', W, `select to_char(min(due_on), 'YYYY-MM-DD') from ops.onboarding_task where staff_id = '${O}'`, '2026-12-01');
  await expectScalar('...the latest item is a week after', W, `select to_char(max(due_on), 'YYYY-MM-DD') from ops.onboarding_task where staff_id = '${O}'`, '2026-12-08');
  await expectScalar('...their own items go to them', W, `select count(*) from ops.onboarding_task where staff_id = '${O}' and owner = 'employee' and assignee_id = '${O}'`, 3);
  await expectScalar('...HR items go to whoever started it', W, `select count(*) from ops.onboarding_task where staff_id = '${O}' and owner = 'hr' and assignee_id = '${W}'`, 2);
  await expectScalar('...lead items go to the founder when no lead shares a department', W,
    `select count(*) from ops.onboarding_task where staff_id = '${O}' and owner = 'lead' and assignee_id = '${F}'`, 2);
  await expectScalar('starting it was logged as an HR look', W, `select count(*) from ops.hr_access_log where target_id = '${O}' and what = 'started joiner checklist'`, 1);
  await expectErr('starting the same list again is refused', W, `select ops.start_onboarding('${O}', 'joiner', null)`, 'already running');
  await expectScalar('a trainer gets lead items for the shared workshop lead', W, `select ops.start_onboarding('${T2}', 'joiner', null)`, 7);
  await expectScalar('...assigned to that lead', W, `select count(*) from ops.onboarding_task where staff_id = '${T2}' and owner = 'lead' and assignee_id = '${W}'`, 2);
  await db.exec(`update ops.staff set is_active = false where id = '${S}'`);
  await expectErr('a deactivated person cannot be a joiner', W, `select ops.start_onboarding('${S}', 'joiner', null)`, 'deactivated');
  await expectScalar('...but a leaver list can be started', W, `select ops.start_onboarding('${S}', 'leaver', '2026-12-31')`, 6);
  await expectScalar('...leaver dates count from the last day', W, `select to_char(min(due_on), 'YYYY-MM-DD') from ops.onboarding_task where staff_id = '${S}'`, '2026-12-28');
  await db.exec(`update ops.staff set is_active = true where id = '${S}'`);
  await db.exec(`update ops.onboarding_template set is_active = false where kind = 'leaver'`);
  await expectErr('an empty list is refused', W, `select ops.start_onboarding('${F}', 'leaver', null)`, 'no leaver checklist');
  await db.exec(`update ops.onboarding_template set is_active = true where kind = 'leaver'`);

  console.log('Who sees which checklist');
  await expectRows('the person sees their own list', O, `select id from ops.onboarding_task`, 7);
  await db.exec(`update ops.staff set is_hr = false where id = '${W}'`);
  await expectRows('a lead who is not HR sees only the items given to them', W, `select id from ops.onboarding_task where assignee_id is distinct from '${W}'`, 0);
  await expectRows('...and not the person\'s other items', W, `select id from ops.onboarding_task where staff_id = '${O}' and owner = 'employee'`, 0);
  await db.exec(`update ops.staff set is_hr = true where id = '${W}'`);
  await expectRows('HR sees all lists', W, `select id from ops.onboarding_task`, 7 + 7 + 6);
  await expectRows('the founder sees all lists', F, `select id from ops.onboarding_task where staff_id = '${O}'`, 7);
  await expectRows('another member sees nothing of it', V, `select id from ops.onboarding_task`, 0);
  await expectRows('a member sees nothing of anyone else\'s list', T2, `select id from ops.onboarding_task where staff_id = '${O}'`, 0);
  await expectErr('nobody inserts a checklist item directly', O,
    `insert into ops.onboarding_task (staff_id, kind, title, owner, due_on) values ('${O}', 'joiner', 'x', 'employee', current_date)`, 'row-level security');
  await expectRows('nobody edits an item directly (no row changes)', O, `update ops.onboarding_task set done_at = now() returning id`, 0);

  console.log('Ticking items');
  const own = (await rows(O, `select id from ops.onboarding_task where owner = 'employee' order by position limit 1`))[0].id;
  const hrItem = (await rows(F, `select id from ops.onboarding_task where staff_id = '${O}' and owner = 'hr' order by position limit 1`))[0].id;
  const leadItem = (await rows(F, `select id from ops.onboarding_task where staff_id = '${O}' and owner = 'lead' order by position limit 1`))[0].id;
  await expectOk('the person ticks their own item', O, `select ops.set_onboarding_task('${own}', true)`);
  await expectScalar('...it records who and when', O, `select done_by = '${O}' and done_at is not null from ops.onboarding_task where id = '${own}'`, true);
  await expectOk('...and can untick it', O, `select ops.set_onboarding_task('${own}', false)`);
  await expectScalar('...which clears who and when', O, `select done_by is null and done_at is null from ops.onboarding_task where id = '${own}'`, true);
  await expectErr('the person cannot tick an HR item', O, `select ops.set_onboarding_task('${hrItem}', true)`, 'can\'t tick');
  await expectErr('the person cannot tick a lead item', O, `select ops.set_onboarding_task('${leadItem}', true)`, 'can\'t tick');
  await expectErr('another member cannot tick anything on it', T2, `select ops.set_onboarding_task('${own}', true)`, 'can\'t tick');
  await expectErr('a viewer cannot either', V, `select ops.set_onboarding_task('${own}', true)`, 'can\'t tick');
  await expectOk('HR ticks an HR item', W, `select ops.set_onboarding_task('${hrItem}', true)`);
  await expectOk('the assigned founder ticks a lead item', F, `select ops.set_onboarding_task('${leadItem}', true)`);
  await expectOk('HR can tick anyone\'s own item', W, `select ops.set_onboarding_task('${own}', true)`);
  await expectErr('an item that does not exist is refused', W, `select ops.set_onboarding_task('00000000-0000-4000-8000-0000000000bb', true)`, 'does not exist');

  console.log('Progress');
  await expectScalar('HR sees how far a person is', W, `select done from ops.onboarding_progress('${O}') where kind = 'joiner'`, 3);
  await expectScalar('...out of the total', W, `select total from ops.onboarding_progress('${O}') where kind = 'joiner'`, 7);
  await expectScalar('...not completed yet', W, `select completed_at is null from ops.onboarding_progress('${O}') where kind = 'joiner'`, true);
  await expectRows('HR sees every running list', W, `select 1 from ops.onboarding_progress()`, 3);
  await expectRows('the person sees only their own', O, `select 1 from ops.onboarding_progress()`, 1);
  await expectRows('another member sees none of theirs', V, `select 1 from ops.onboarding_progress()`, 0);
  await expectRows('asking for someone else\'s shows nothing', T2, `select 1 from ops.onboarding_progress('${O}')`, 0);
  await db.exec(`update ops.onboarding_task set done_at = now(), done_by = '${F}' where staff_id = '${O}' and done_at is null`);
  await expectScalar('a finished list shows when it finished', W, `select completed_at is not null from ops.onboarding_progress('${O}') where kind = 'joiner'`, true);
  await expectScalar('a finished list can be started again', W, `select ops.start_onboarding('${O}', 'joiner', null)`, 7);

  console.log('Files on requests (0036)');
  const { randomUUID } = await import('node:crypto');
  const file = (owner, name = 'letter.pdf', over = {}) =>
    ({ path: `${owner}/${randomUUID()}-${name}`, name, mime: 'application/pdf', size: 2048, ...over });
  const json = (arr) => `'${JSON.stringify(arr)}'::jsonb`;
  const askWith = (subject, files) => `select ops.create_hr_request('other', '${subject}', '', ${json(files)}) as id`;
  const sayWith = (id, body, files, { internal = false, keep = false, finish = false } = {}) =>
    `select ops.add_hr_request_message('${id}', '${body}', ${internal}, ${json(files)}, ${keep}, ${finish})`;
  const notified = (uid, kind) => `select count(*) from ops.notification where recipient_id = '${uid}' and kind = '${kind}'`;

  await db.exec(`delete from ops.notification where kind like 'request_%'; delete from ops.staff_document where kind = 'letter'; delete from ops.hr_request;`);

  const firstFiles = [file(S, 'id-card.pdf'), file(S, 'photo.png', { mime: 'image/png' })];
  const rf = (await expectOk('a person asks with two files attached', S, askWith('Visa letter', firstFiles)))?.rows[0].id;
  await expectScalar('...both files are stored on the request', S, `select count(*) from ops.hr_request_file where request_id = '${rf}'`, 2);
  await expectScalar('...with no message attached to them', S, `select count(*) from ops.hr_request_file where request_id = '${rf}' and message_id is null`, 2);
  await expectScalar('HR is told about the new request', W, notified(W, 'request_new'), 1);
  await expectScalar('...so is the founder', F, notified(F, 'request_new'), 1);
  await expectScalar('...the person is not told about their own request', S, notified(S, 'request_new'), 0);
  await expectScalar('...the message says how many files', W, `select message from ops.notification where recipient_id = '${W}' and kind = 'request_new'`, 'Sales asked HR: Visa letter (2 files)');

  console.log('Who sees the files');
  await expectRows('the person sees their files', S, `select id from ops.hr_request_file`, 2);
  await expectRows('HR sees them', W, `select id from ops.hr_request_file`, 2);
  await expectRows('another member sees none', O, `select id from ops.hr_request_file`, 0);
  await expectRows('a viewer sees none', V, `select id from ops.hr_request_file`, 0);
  await expectErr('nobody inserts a file row directly', S,
    `insert into ops.hr_request_file (request_id, staff_id, name, path, mime, size_bytes) values ('${rf}', '${S}', 'x.pdf', '${S}/${randomUUID()}-x.pdf', 'application/pdf', 5)`, 'row-level security');

  console.log('What a file must be');
  await expectErr('six files are too many', S, sayWith(rf, 'Here', Array.from({ length: 6 }, (_, i) => file(S, `a${i}.pdf`))), 'at most 5');
  await expectErr('a file in someone else\'s folder is refused', S, sayWith(rf, 'Here', [file(O)]), 'own folder');
  await expectErr('a path that is not a stored path is refused', S, sayWith(rf, 'Here', [{ ...file(S), path: `${S}/../x.pdf` }]), 'own folder');
  await expectErr('an executable is refused', S, sayWith(rf, 'Here', [file(S, 'run.pdf', { mime: 'application/x-msdownload' })]), 'PDF or an image');
  await expectErr('an empty file is refused', S, sayWith(rf, 'Here', [file(S, 'e.pdf', { size: 0 })]), '10 MB');
  await expectErr('a file over 10 MB is refused', S, sayWith(rf, 'Here', [file(S, 'big.pdf', { size: 10485761 })]), '10 MB');
  await expectErr('a nameless file is refused', S, sayWith(rf, 'Here', [file(S, 'n.pdf', { name: '  ' })]), 'name');
  await expectErr('another member cannot attach to it', O, sayWith(rf, 'Here', [file(S)]), 'write on this request');
  await expectScalar('a refused message leaves nothing behind', S, `select count(*) from ops.hr_request_file where request_id = '${rf}'`, 2);
  await expectScalar('...nor a message', S, `select count(*) from ops.hr_request_message where request_id = '${rf}'`, 0);
  await expectErr('a blank message with no file is refused', S, sayWith(rf, '  ', []), 'Write a message');

  console.log('HR replies with a file');
  const hrFile = file(S, 'draft.pdf');
  await expectOk('HR replies with a file in the person\'s folder', W, sayWith(rf, 'Draft attached', [hrFile]));
  await expectScalar('...the person is told', S, notified(S, 'request_hr_reply'), 1);
  await expectScalar('...the file is tied to the reply', S, `select count(*) from ops.hr_request_file f join ops.hr_request_message m on m.id = f.message_id where f.request_id = '${rf}' and m.author_id = '${W}'`, 1);
  await expectScalar('...nothing was kept on the record without asking', S, `select count(*) from ops.staff_document where kind = 'letter'`, 0);
  await expectOk('a file-only reply is allowed', W, sayWith(rf, '', [file(S, 'second.pdf')]));
  await expectScalar('...it gets a plain body', S, `select count(*) from ops.hr_request_message where request_id = '${rf}' and body = 'Sent a file.'`, 1);
  const before = await scalar(S, notified(S, 'request_hr_reply'));
  await expectErr('an internal note cannot carry a file', W, sayWith(rf, 'secret', [file(S)], { internal: true }), 'Internal notes');
  await expectOk('an internal note without a file is fine', W, sayWith(rf, 'Check the dates', [], { internal: true }));
  await expectScalar('...and tells the person nothing', S, notified(S, 'request_hr_reply'), before);
  await expectOk('the person replies with a file', S, sayWith(rf, 'Corrected copy', [file(S, 'fixed.pdf')]));
  await expectScalar('...HR is told', W, notified(W, 'request_person_reply'), 1);
  await expectScalar('...the founder too', F, notified(F, 'request_person_reply'), 1);
  await expectOk('the person asks for a copy anyway', S, sayWith(rf, 'Please keep it', [file(S, 'again.pdf')], { keep: true }));
  await expectScalar('...a person cannot put papers on their own record that way', S, `select count(*) from ops.staff_document where kind = 'letter'`, 0);
  await expectErr('a person cannot finish a request', S, sayWith(rf, 'Done', [], { finish: true }), 'Only HR');

  console.log('Opening a file');
  const dfid = await scalar(W, `select id from ops.hr_request_file where name = 'draft.pdf'`);
  const fileId = () => `'${dfid}'`;
  await expectScalar('the person opens their own file', S, `select ops.open_request_file(${fileId('draft.pdf')}) = '${hrFile.path}'`, true);
  await expectErr('another member cannot open it', O, `select ops.open_request_file(${fileId('draft.pdf')})`, 'can\'t open');
  await expectErr('a viewer cannot open it', V, `select ops.open_request_file(${fileId('draft.pdf')})`, 'can\'t open');
  await expectErr('a file that does not exist is refused', S, `select ops.open_request_file('00000000-0000-4000-8000-0000000000cc')`, 'does not exist');
  const obj = (path, mode) => `select ops.hr_doc_object_ok('${path}', '${mode}')`;
  await expectScalar('HR cannot read the object before opening it', W, obj(hrFile.path, 'read'), false);
  await expectScalar('another member cannot read it', O, obj(hrFile.path, 'read'), false);
  await expectScalar('the person can read it', S, obj(hrFile.path, 'read'), true);
  await expectOk('HR opens it', W, `select ops.open_request_file(${fileId('draft.pdf')})`);
  await expectScalar('...the open is in the access log', W, `select count(*) from ops.hr_access_log where actor_id = '${W}' and target_id = '${S}' and what = 'opened document ${hrFile.path}'`, 1);
  await expectScalar('...the person can see who opened it', S, `select count(*) from ops.hr_access_log where actor_id = '${W}' and what = 'opened document ${hrFile.path}'`, 1);
  await expectScalar('...and now HR can read the object', W, obj(hrFile.path, 'read'), true);
  await expectScalar('the person cannot delete a file tied to a request', S, obj(hrFile.path, 'delete'), false);
  await expectScalar('...neither can HR', W, obj(hrFile.path, 'delete'), false);
  await expectScalar('a file with no request can still be cleaned up', S, obj(`${S}/${randomUUID()}-stray.pdf`, 'delete'), true);

  console.log('Finishing with a copy on the record');
  const letter = file(S, 'experience-letter.pdf');
  await expectOk('HR answers with the letter and keeps a copy', W, sayWith(rf, 'Your letter is attached', [letter], { keep: true, finish: true }));
  await expectScalar('...the request is done', S, `select state from ops.hr_request where id = '${rf}'`, 'done');
  await expectScalar('...with the reply as the answer', S, `select resolution from ops.hr_request where id = '${rf}'`, 'Your letter is attached');
  await expectScalar('...handled by HR', S, `select handled_by from ops.hr_request where id = '${rf}'`, W);
  await expectScalar('...a letter is on the person\'s record', S, `select count(*) from ops.staff_document where kind = 'letter' and path = '${letter.path}'`, 1);
  await expectScalar('...already verified', S, `select verified_at is not null and verified_by = '${W}' from ops.staff_document where path = '${letter.path}'`, true);
  await expectScalar('...titled after the request', S, `select title from ops.staff_document where path = '${letter.path}'`, 'Visa letter');
  await expectRows('...another member cannot see it', O, `select id from ops.staff_document where path = '${letter.path}'`, 0);
  await expectScalar('...the person is told the request is answered', S, `select count(*) from ops.notification where recipient_id = '${S}' and message = 'HR answered: Visa letter'`, 1);
  await expectScalar('...the copy cannot be deleted from storage by the person', S, obj(letter.path, 'delete'), false);
  await expectErr('the person cannot write on it any more', S, sayWith(rf, 'thanks', []), 'closed');
  await expectErr('it cannot be answered twice', W, sayWith(rf, 'again', [], { finish: true }), 'already closed');
  await expectErr('a person cannot add a letter to their own record', S,
    `select ops.add_staff_document('${S}', 'letter', 'Mine', '${S}/${randomUUID()}-m.pdf', 'application/pdf', 10)`, 'Only HR');
  await expectOk('HR can add a letter to a record directly', W,
    `select ops.add_staff_document('${S}', 'letter', 'Relieving letter', '${S}/${randomUUID()}-r.pdf', 'application/pdf', 10)`);

  console.log('Notifications are read-only for the person');
  await run(S, `update ops.notification set request_id = null where recipient_id = '${S}'`);
  await expectScalar('...it still points at the request', S, `select count(*) from ops.notification where recipient_id = '${S}' and request_id = '${rf}'`, 3);
  await expectScalar('another member has none of these', O, `select count(*) from ops.notification where request_id = '${rf}'`, 0);
  await db.exec(`delete from ops.hr_request where id = '${rf}'`);
  await expectScalar('deleting the request removes its files', F, `select count(*) from ops.hr_request_file`, 0);
  await expectScalar('...and its notices', F, `select count(*) from ops.notification where request_id is not null`, 0);

  console.log('Audit trail');
  await expectScalar('requests are audited', F, `select count(*) > 0 from ops.audit_log where table_name = 'hr_request'`, true);
  await expectScalar('so are checklist items', F, `select count(*) > 0 from ops.audit_log where table_name = 'onboarding_task'`, true);

  await db.exec(`delete from ops.notification where kind like 'request_%'; delete from ops.staff_document where kind = 'letter'; delete from ops.onboarding_task; delete from ops.hr_request; delete from ops.hr_access_log;`);
}
