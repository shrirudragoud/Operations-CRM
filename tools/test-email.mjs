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

  console.log('Defaults: on, but not for chatty task activity');
  await notify(S, 'comment', 'Someone commented');
  await expectVal('a comment is not mailed by default', `select count(*) from ops.email_outbox where recipient_id = '${S}'`, 1);
  await notify(S, 'mentioned', 'You were mentioned');
  await notify(S, 'due_today', 'Due today: Order boards');
  await notify(S, 'meeting_invite', 'Invited: Weekly');
  await notify(S, 'hr_file', 'HR sent you a file');
  await expectVal('mentions, due, meetings and HR are mailed', `select count(*) from ops.email_outbox where recipient_id = '${S}'`, 5);
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
  await expectVal('the daily cap limits how many people are mailed', `select count(distinct recipient_id) from ops.claim_emails(50, 1)`, 1);
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

  console.log('Deleting a notification keeps the mail row');
  await reset();
  await notify(S, 'assigned', 'Will be deleted');
  await db.exec(`delete from ops.notification where message = 'Will be deleted'`);
  await expectVal('the mail row survives', `select count(*) from ops.email_outbox where notification_id is null`, 1);

  await reset();
}
