// Email for notifications (0045). Called from test-migrations.mjs.
export default async function emailTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, val, F, S, W, T2, P, V } = t;

  console.log('\nEmail for notifications (0045)');
  const expectRows = async (name, uid, sql, want) => {
    let n;
    try { n = (await run(uid, sql)).rows.length; } catch (e) { return bad(name, e.message); }
    n === want ? ok(name) : bad(name, `${n} rows, want ${want}`);
  };
  const notify = (to, kind, msg = 'Something happened') =>
    db.exec(`insert into ops.notification (recipient_id, kind, message) values ('${to}', '${kind}', '${msg}')`);
  const queued = (to) => val(`select count(*) from ops.email_outbox where recipient_id = '${to}'`);
  const reset = () => db.exec(`delete from ops.email_outbox; delete from ops.email_pref`);

  await reset();

  console.log('A notification becomes one queued email');
  await notify(S, 'assigned', 'Ravi assigned you: Order boards');
  await expectVal('one row queued for the person', `select count(*) from ops.email_outbox where recipient_id = '${S}' and status = 'queued'`, 1);
  await expectVal('...with their address', `select to_email from ops.email_outbox where recipient_id = '${S}'`, await val(`select email from ops.staff where id = '${S}'`));
  await expectVal('...and the message as subject', `select subject from ops.email_outbox where recipient_id = '${S}'`, 'Ravi assigned you: Order boards');
  await expectVal('...linked to the notification', `select count(*) from ops.email_outbox where notification_id is not null and recipient_id = '${S}'`, 1);

  console.log('Defaults (0048): everything except due today and overdue');
  await notify(S, 'comment', 'Someone commented');
  await expectVal('a comment is mailed by default', `select count(*) from ops.email_outbox where recipient_id = '${S}'`, 2);
  await notify(S, 'due_today', 'Due today: Order boards');
  await expectVal('due today is not mailed by default (the dashboard shows it)', `select count(*) from ops.email_outbox where recipient_id = '${S}'`, 2);
  await notify(S, 'mentioned', 'You were mentioned');
  await notify(S, 'meeting_invite', 'Invited: Weekly');
  await notify(S, 'hr_file', 'HR sent you a file');
  await expectVal('mentions, meetings and HR are mailed', `select count(*) from ops.email_outbox where recipient_id = '${S}'`, 5);
  await expectVal('the default list is what the database says', `select array_to_string(ops.default_email_groups(), ',')`, 'assigned,mentions,meetings,hr,activity');
  await expectVal('a link is built for a task', `select count(*) from ops.email_outbox where link is not null`, 1);

  console.log('A person chooses');
  await expectOk('turns the task-activity mail on', S, `select ops.set_email_pref(true, '{assigned,activity}')`);
  await notify(S, 'comment', 'Another comment');
  await expectVal('...a comment is now mailed', `select count(*) from ops.email_outbox where recipient_id = '${S}'`, 6);
  await notify(S, 'mentioned', 'Mentioned again');
  await expectVal('...a mention, now switched off, is not', `select count(*) from ops.email_outbox where recipient_id = '${S}'`, 6);
  await expectOk('switches everything off', S, `select ops.set_email_pref(false, '{assigned,mentions,due,activity,meetings,hr}')`);
  await notify(S, 'assigned', 'Assigned while off');
  await expectVal('...nothing is queued', `select count(*) from ops.email_outbox where recipient_id = '${S}'`, 6);
  await expectErr('an unknown choice is refused', S, `select ops.set_email_pref(true, '{spam}')`, 'Unknown email choice');
  await expectVal('choices are stored', `select enabled::text || ':' || array_to_string(groups, ',') from ops.email_pref where staff_id = '${S}'`, 'false:activity,assigned,due,hr,meetings,mentions');

  console.log('Who is not mailed');
  await db.exec(`update ops.staff set is_active = false where id = '${V}'`);
  await notify(V, 'assigned', 'To an inactive person');
  await expectVal('an inactive person', `select count(*) from ops.email_outbox where recipient_id = '${V}'`, 0);
  await db.exec(`update ops.staff set is_active = true where id = '${V}'`);
  await expectVal('a kind with no email group', `select ops.email_group('nonsense') is null`, true);
  await expectVal('recurring is grouped with assignments', `select ops.email_group('recurring')`, 'assigned');
  await expectVal('request kinds are grouped under HR', `select ops.email_group('request_new')`, 'hr');

  console.log('Privacy: your own rows only');
  await expectRows('sees own mail rows', S, `select id from ops.email_outbox`, 6);
  await expectRows('another person sees none of them', T2, `select id from ops.email_outbox`, 0);
  await expectRows('a partner sees none', P, `select id from ops.email_outbox`, 0);
  await expectRows('even the founder cannot read others\' mail', F, `select id from ops.email_outbox`, 0);
  await expectRows('cannot edit the queue', S, `update ops.email_outbox set status = 'sent' returning id`, 0);
  await expectErr('cannot add to the queue', S, `insert into ops.email_outbox (recipient_id, to_email, kind, subject, body) values ('${S}', 'a@b.c', 'x', 's', 'b')`, 'row-level security');
  await expectRows('cannot delete from the queue', S, `delete from ops.email_outbox returning id`, 0);
  await expectRows('cannot read someone else\'s choices', T2, `select staff_id from ops.email_pref`, 0);
  await expectRows('can read their own choices', S, `select staff_id from ops.email_pref`, 1);

  console.log('Who can run the sender');
  await expectErr('a person cannot claim mail', F, `select * from ops.claim_emails()`, 'permission denied');
  await expectErr('a person cannot finish mail', F, `select ops.finish_emails('{1}', true)`, 'permission denied');
  await expectOk('the founder can see the queue health', F, `select ops.email_health()`);
  await expectErr('a lead cannot', W, `select ops.email_health()`, 'Only the founder');

  console.log('Test email');
  await expectOk('a person asks for a test email', T2, `select ops.queue_test_email()`);
  await expectVal('...one row queued', `select count(*) from ops.email_outbox where recipient_id = '${T2}' and kind = 'test'`, 1);
  await expectErr('...but not twice in a minute', T2, `select ops.queue_test_email()`, 'Wait a minute');

  console.log('The sender claims, sends and closes');
  await reset();
  await notify(S, 'assigned', 'A'); await notify(S, 'assigned', 'B'); await notify(T2, 'assigned', 'C');
  await db.exec(`insert into ops.email_pref (staff_id, enabled) values ('${S}', true)`);
  await expectVal('the daily cap limits how many people are mailed', `select count(distinct recipient_id) from ops.claim_emails(50, 1, 0)`, 1);
  await expectVal('...and all of that person\'s rows come together', `select count(*) from ops.email_outbox where status = 'sending'`, 2);
  await expectVal('...the other person waits', `select count(*) from ops.email_outbox where status = 'queued'`, 1);
  const ids = (await db.query(`select array_agg(id) a from ops.email_outbox where status = 'sending'`)).rows[0].a;
  await expectVal('a failure puts them back for later', `select ops.finish_emails('{${ids.join(',')}}', false, 'timeout')`, 2);
  await expectVal('...queued again, one try used', `select count(*) from ops.email_outbox where status = 'queued' and attempts = 1 and last_error = 'timeout'`, 2);
  await expectVal('...but not yet due', `select count(*) from ops.email_outbox where status = 'queued' and attempts = 1 and next_attempt_at > now()`, 2);
  await db.exec(`update ops.email_outbox set next_attempt_at = now() - interval '1 second'`);
  const got = (await db.query(`select id from ops.claim_emails(50, 90)`)).rows.map((r) => r.id);
  got.length === 3 ? ok('everyone is claimed once they are due') : bad('everyone is claimed once they are due', `${got.length}`);
  await expectVal('success marks them sent', `select ops.finish_emails('{${got.join(',')}}', true, null, 're_123')`, 3);
  await expectVal('...with the provider id', `select count(*) from ops.email_outbox where status = 'sent' and provider_id = 're_123' and sent_at is not null`, 3);
  await expectVal('...and sent rows are not handed out again', `select count(*) from ops.claim_emails(50, 90)`, 0);
  await expectVal('the daily cap counts emails, not rows', `select count(*) from ops.claim_emails(50, 1)`, 0);
  {
    const r = (await expectOk('health counts the sent mail', F, `select ops.email_health() as h`))?.rows[0]?.h;
    r?.sent_24h === 1 && r?.queued === 0 ? ok('...one email sent, none waiting') : bad('...one email sent, none waiting', JSON.stringify(r));
  }

  console.log('Failures give up');
  await reset();
  await notify(S, 'assigned', 'Doomed');
  for (let i = 1; i <= 5; i++) {
    await db.exec(`update ops.email_outbox set next_attempt_at = now() - interval '1 second' where status = 'queued'`);
    const c = (await db.query(`select id from ops.claim_emails()`)).rows.map((r) => r.id);
    await db.query(`select ops.finish_emails('{${c.join(',')}}', false, 'boom')`);
  }
  await expectVal('five failed tries mark it failed', `select status from ops.email_outbox`, 'failed');
  await reset();
  await notify(S, 'assigned', 'Bad address');
  const c2 = (await db.query(`select id from ops.claim_emails()`)).rows.map((r) => r.id);
  await db.query(`select ops.finish_emails('{${c2.join(',')}}', false, 'invalid address', null, true)`);
  await expectVal('a permanent error fails at once', `select status from ops.email_outbox`, 'failed');

  console.log('A problem on our side does not use up tries');
  await reset();
  await notify(S, 'assigned', 'Bad key day');
  const c3 = (await db.query(`select id from ops.claim_emails()`)).rows.map((r) => r.id);
  await db.query(`select ops.finish_emails('{${c3.join(',')}}', false, '401 bad key', null, false, true)`);
  await expectVal('released: queued again with the try given back', `select count(*) from ops.email_outbox where status = 'queued' and attempts = 0 and next_attempt_at > now()`, 1);

  console.log('Stale and stuck rows');
  await reset();
  await notify(S, 'assigned', 'Old news');
  await db.exec(`update ops.email_outbox set created_at = now() - interval '2 days'`);
  await expectVal('a day-old mail is dropped, not sent', `select count(*) from ops.claim_emails()`, 0);
  await expectVal('...marked skipped', `select status from ops.email_outbox`, 'skipped');
  await reset();
  await notify(S, 'assigned', 'Stuck');
  await db.query(`select * from ops.claim_emails()`);
  await db.exec(`update ops.email_outbox set next_attempt_at = now() - interval '11 minutes'`);
  await expectVal('a row stuck while sending is handed out again', `select count(*) from ops.claim_emails()`, 1);

  console.log('Lanes (0046): direct mail goes first and has room kept for it');
  const direct = (to, subject = 'Customer reply') =>
    db.exec(`insert into ops.email_outbox (recipient_id, to_email, kind, lane, subject, body) values ('${to}', 'x@y.in', 'reply', 'direct', '${subject}', 'b')`);
  await reset();
  await expectOk('a test email is queued', T2, `select ops.queue_test_email()`);
  await expectVal('...in the direct lane', `select lane from ops.email_outbox where kind = 'test'`, 'direct');
  await reset();
  await notify(S, 'assigned', 'Notice for S');
  await expectVal('a notification is in the notice lane', `select lane from ops.email_outbox where recipient_id = '${S}'`, 'notice');
  await direct(T2);
  await expectVal('direct mail is claimed before notices when room is short', `select lane from ops.claim_emails(1, 90, 0)`, 'direct');
  await expectVal('...the notice waits', `select count(*) from ops.email_outbox where status = 'queued' and lane = 'notice'`, 1);

  await reset();
  await notify(S, 'assigned', 'N1'); await notify(F, 'assigned', 'N2'); await notify(W, 'assigned', 'N3');
  await expectVal('notices stop short of the cap by the reserve (cap 3, reserve 2: one person)', `select count(distinct recipient_id) from ops.claim_emails(50, 3, 2)`, 1);
  await reset();
  await notify(S, 'assigned', 'N1'); await direct(T2); await direct(P);
  await expectVal('direct mail may use the whole cap', `select count(*) from ops.claim_emails(50, 3, 2)`, 3);

  await reset();
  await notify(S, 'assigned', 'Already sent');
  const sent = (await db.query(`select id from ops.claim_emails(50, 90, 0)`)).rows.map((r) => r.id);
  await db.query(`select ops.finish_emails('{${sent.join(',')}}', true, null, 're_notice')`);
  await notify(F, 'assigned', 'Next notice'); await direct(T2);
  await expectVal('notice room used up: notices wait, direct mail still goes', `select string_agg(lane, ',') from ops.claim_emails(50, 3, 2)`, 'direct');
  await expectVal('...the notice is still queued', `select count(*) from ops.email_outbox where status = 'queued' and lane = 'notice'`, 1);

  await reset();
  await notify(S, 'assigned', 'Digest item'); await direct(S, 'Reply to a customer');
  await expectVal('one person with both lanes gets two separate groups', `select string_agg(lane, ',' order by lane) from ops.claim_emails()`, 'direct,notice');

  await reset();
  await direct(T2); await db.exec(`update ops.email_outbox set created_at = now() - interval '2 days'`);
  await expectVal('direct mail two days old is still sent', `select count(*) from ops.claim_emails()`, 1);
  await reset();
  await direct(T2); await db.exec(`update ops.email_outbox set created_at = now() - interval '4 days'`);
  await expectVal('direct mail four days old is dropped', `select count(*) from ops.claim_emails()`, 0);

  await reset();
  await direct(T2);
  const dsent = (await db.query(`select id from ops.claim_emails()`)).rows.map((r) => r.id);
  await db.query(`select ops.finish_emails('{${dsent.join(',')}}', true, null, 're_direct')`);
  {
    const r = (await expectOk('health separates direct mail', F, `select ops.email_health() as h`))?.rows[0]?.h;
    r?.sent_direct_24h === 1 ? ok('...one direct mail sent') : bad('...one direct mail sent', JSON.stringify(r));
  }
  await expectErr('claim_emails is still not for people', F, `select * from ops.claim_emails(50, 90, 30)`, 'permission denied');

  console.log('Details for the mail (0049)');
  await reset();
  const t1 = (await db.query(`insert into ops.task (title, assignee_id, assigned_by, priority, due_date, department, description, created_by)
    values ('ZZ Mail task', '${S}', '${W}', 1, current_date + 3, 'workshop', '${'x'.repeat(400)}', '${W}') returning id`)).rows[0].id;
  const m1 = (await db.query(`insert into ops.meeting (title, organizer_id, starts_at, ends_at, location, description)
    values ('ZZ Mail meeting', '${W}', now() + interval '2 days', now() + interval '2 days 1 hour', 'Room 4', 'Agenda') returning id`)).rows[0].id;
  await db.exec(`insert into ops.meeting_attendee (meeting_id, staff_id) values ('${m1}', '${S}'), ('${m1}', '${T2}') on conflict do nothing`);
  const rq = (await db.query(`insert into ops.hr_request (staff_id, kind, subject) values ('${S}', 'other', 'ZZ Mail request') returning id`)).rows[0].id;
  await db.exec(`delete from ops.email_outbox`);
  await db.exec(`insert into ops.notification (recipient_id, actor_id, kind, message, task_id) values ('${S}', '${W}', 'assigned', 'task msg', '${t1}');
                 insert into ops.notification (recipient_id, actor_id, kind, message, meeting_id) values ('${S}', '${W}', 'meeting_invite', 'meeting msg', '${m1}');
                 insert into ops.notification (recipient_id, actor_id, kind, message, request_id) values ('${S}', '${W}', 'request_hr_reply', 'request msg', '${rq}');`);
  await db.exec(`insert into ops.email_outbox (recipient_id, to_email, kind, lane, subject, body) values ('${S}', 'x@y.in', 'test', 'direct', 's', 'b')`);
  const detail = async (msg) => (await db.query(`select d.details from ops.email_outbox o join ops.email_details(array[o.id]) d on d.id = o.id where o.body = '${msg}'`)).rows[0]?.details;
  const td = await detail('task msg');
  td?.type === 'task' && td.title === 'ZZ Mail task' && td.priority === 1 && td.department === 'workshop' && td.by === (await val(`select full_name from ops.staff where id = '${W}'`)) && td.assigned_by === td.by
    ? ok('a task mail carries the task details') : bad('a task mail carries the task details', JSON.stringify(td));
  td?.description?.length === 280 ? ok('...the description is cut to 280 characters') : bad('...the description is cut to 280 characters', String(td?.description?.length));
  const md = await detail('meeting msg');
  md?.type === 'meeting' && md.location === 'Room 4' && md.attendee_count === 3 && md.attendees.length === 3 && md.organizer_email && md.starts_at && md.ends_at && md.meeting_id === m1
    ? ok('a meeting mail carries time, place, organizer and who is invited') : bad('a meeting mail carries time, place, organizer and who is invited', JSON.stringify(md));
  const rd = await detail('request msg');
  rd?.type === 'request' && rd.subject === 'ZZ Mail request' && rd.state === 'open' && rd.kind === 'other'
    ? ok('a request mail carries the request') : bad('a request mail carries the request', JSON.stringify(rd));
  const nd = (await db.query(`select d.details from ops.email_outbox o join ops.email_details(array[o.id]) d on d.id = o.id where o.kind = 'test'`)).rows[0];
  nd && nd.details === null ? ok('a mail with no record behind it has no details') : bad('a mail with no record behind it has no details', JSON.stringify(nd));
  await expectVal('an unknown id returns nothing', `select count(*) from ops.email_details(array[-1::bigint])`, 0);
  await db.exec(`insert into auth.users (id) select ('00000000-0000-4000-8000-0000000007' || lpad(g::text, 2, '0'))::uuid from generate_series(1, 14) g`);
  await db.exec(`insert into ops.staff (id, email, full_name, role, departments) select ('00000000-0000-4000-8000-0000000007' || lpad(g::text, 2, '0'))::uuid, 'zz' || g || '@x.in', 'ZZ Guest ' || lpad(g::text, 2, '0'), 'member', '{workshop}' from generate_series(1, 14) g`);
  await db.exec(`insert into ops.meeting_attendee (meeting_id, staff_id) select '${m1}', id from ops.staff where full_name like 'ZZ Guest%'`);
  const big = await detail('meeting msg');
  big?.attendees?.length === 12 && big.attendee_count === 17 ? ok('a long guest list is cut to twelve names, with the true count') : bad('a long guest list is cut to twelve names, with the true count', `${big?.attendees?.length}/${big?.attendee_count}`);
  await db.exec(`delete from ops.meeting_attendee where staff_id in (select id from ops.staff where full_name like 'ZZ Guest%'); delete from ops.staff where full_name like 'ZZ Guest%'; delete from auth.users where id::text like '00000000-0000-4000-8000-0000000007%'`);
  await expectErr('a person cannot ask for mail details', F, `select * from ops.email_details('{1}')`, 'permission denied');
  await expectErr('even a member cannot', S, `select * from ops.email_details('{1}')`, 'permission denied');
  await db.exec(`delete from ops.notification where message in ('task msg', 'meeting msg', 'request msg'); delete from ops.meeting where id = '${m1}'; delete from ops.hr_request where id = '${rq}'; delete from ops.task where id = '${t1}'`);

  console.log('Deleting a notification keeps the mail row');
  await reset();
  await notify(S, 'assigned', 'Will be deleted');
  await db.exec(`delete from ops.notification where message = 'Will be deleted'`);
  await expectVal('the mail row survives', `select count(*) from ops.email_outbox where notification_id is null`, 1);

  await reset();
}
