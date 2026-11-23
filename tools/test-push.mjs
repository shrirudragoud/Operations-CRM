// Browser notifications (0047). Called from test-migrations.mjs.
export default async function pushTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, val, F, S, W, T2, P, V } = t;

  console.log('\nBrowser notifications (0047)');
  const expectRows = async (name, uid, sql, want) => {
    let n;
    try { n = (await run(uid, sql)).rows.length; } catch (e) { return bad(name, e.message); }
    n === want ? ok(name) : bad(name, `${n} rows, want ${want}`);
  };
  const notify = (to, kind, msg = 'Something happened') =>
    db.exec(`insert into ops.notification (recipient_id, kind, message) values ('${to}', '${kind}', '${msg}')`);
  const device = (uid, n) => run(uid, `select ops.save_push_subscription('https://push.example/${n}', 'key-${n}', 'auth-${n}', 'Test browser')`);
  const rows = (to) => `select count(*) from ops.push_outbox where recipient_id = '${to}'`;
  const reset = () => db.exec(`delete from ops.push_outbox; delete from ops.push_subscription; delete from ops.push_pref; delete from ops.email_outbox`);

  await reset();

  console.log('A person registers a device');
  await expectOk('saves this browser', S, `select ops.save_push_subscription('https://push.example/s1', 'key-s1', 'auth-s1', 'Firefox')`);
  await expectVal('...it belongs to them', `select count(*) from ops.push_subscription where staff_id = '${S}'`, 1);
  await expectErr('a non-https address is refused', S, `select ops.save_push_subscription('http://push.example/x', 'k', 'a')`, 'invalid address');
  await expectErr('an empty key is refused', S, `select ops.save_push_subscription('https://push.example/x', '', 'a')`, 'check');
  await expectOk('saving again just refreshes it', S, `select ops.save_push_subscription('https://push.example/s1', 'key-s1b', 'auth-s1b', 'Firefox')`);
  await expectVal('...still one device, new key', `select count(*) from ops.push_subscription where staff_id = '${S}' and p256dh_key = 'key-s1b'`, 1);
  await expectOk('the same browser signed in as someone else', T2, `select ops.save_push_subscription('https://push.example/s1', 'key-t', 'auth-t', 'Firefox')`);
  await expectVal('...moves to them', `select staff_id::text from ops.push_subscription where endpoint = 'https://push.example/s1'`, T2);
  await reset();
  for (let i = 1; i <= 12; i++) await device(S, `many${i}`);
  await expectVal('only the ten most recent devices are kept', `select count(*) from ops.push_subscription where staff_id = '${S}'`, 10);
  await reset();
  await device(S, 's1'); await device(S, 's2'); await device(T2, 't1');

  console.log('Privacy: your own devices and queue only');
  await expectRows('sees own devices', S, `select id from ops.push_subscription`, 2);
  await expectRows('another person does not see them', T2, `select id from ops.push_subscription where staff_id = '${S}'`, 0);
  await expectRows('a partner sees none', P, `select id from ops.push_subscription`, 0);
  await expectRows('even the founder cannot read others\' devices', F, `select id from ops.push_subscription`, 0);
  await expectErr('cannot add a device by hand', S, `insert into ops.push_subscription (staff_id, endpoint, p256dh_key, auth_key) values ('${S}', 'https://x.y/z', 'k', 'a')`, 'row-level security');
  await expectRows('cannot edit a device', S, `update ops.push_subscription set staff_id = '${T2}' returning id`, 0);
  await expectRows('cannot delete a device by hand', S, `delete from ops.push_subscription returning id`, 0);
  await run(S, `select ops.remove_push_subscription('https://push.example/t1')`);
  await expectVal('cannot remove someone else\'s device', `select count(*) from ops.push_subscription where endpoint = 'https://push.example/t1'`, 1);
  await expectOk('removes their own', S, `select ops.remove_push_subscription('https://push.example/s2')`);
  await expectVal('...gone', `select count(*) from ops.push_subscription where staff_id = '${S}'`, 1);
  await device(S, 's2');

  console.log('A notification becomes one push per device');
  await notify(S, 'assigned', 'Ravi assigned you: Order boards');
  await expectVal('two devices, two rows', `select count(*) from ops.push_outbox where recipient_id = '${S}' and status = 'queued'`, 2);
  await expectVal('...with the group as title', `select distinct title from ops.push_outbox where recipient_id = '${S}'`, 'Assigned to you');
  await expectVal('...and the message as body', `select distinct body from ops.push_outbox where recipient_id = '${S}'`, 'Ravi assigned you: Order boards');
  await expectVal('...linked to the notification', `select count(*) from ops.push_outbox where notification_id is not null and recipient_id = '${S}'`, 2);
  await notify(T2, 'mentioned', 'You were mentioned');
  await expectVal('a person with one device gets one row', rows(T2), 1);

  console.log('Defaults (0048): every topic');
  await notify(S, 'comment', 'Someone commented');
  await expectVal('a comment is pushed by default', await rows(S), 4);
  await notify(S, 'due_today', 'Due today'); await notify(S, 'meeting_invite', 'Invited'); await notify(S, 'hr_file', 'HR sent a file');
  await expectVal('due, meetings and HR are pushed', await rows(S), 10);
  await notify(S, 'status', 'Status changed');
  await expectVal('a status change is pushed', await rows(S), 12);
  await expectVal('the default list is what the database says', `select array_to_string(ops.default_push_groups(), ',')`, 'assigned,mentions,due,meetings,hr,activity');
  await expectVal('a kind with no group is never pushed', `select ops.email_group('nonsense') is null`, true);

  console.log('A person chooses');
  await expectOk('turns on task activity, turns off mentions', S, `select ops.set_push_groups('{assigned,activity}')`);
  await notify(S, 'comment', 'Another comment');
  await expectVal('...a comment is now pushed', await rows(S), 14);
  await notify(S, 'mentioned', 'Mentioned again');
  await expectVal('...a mention is not', await rows(S), 14);
  await expectOk('turns everything off', S, `select ops.set_push_groups('{}')`);
  await notify(S, 'assigned', 'Assigned while off');
  await expectVal('...nothing is queued', await rows(S), 14);
  await expectErr('an unknown choice is refused', S, `select ops.set_push_groups('{spam}')`, 'Unknown notification choice');
  await expectVal('choices are stored', `select array_to_string(groups, ',') from ops.push_pref where staff_id = '${S}'`, '');
  await expectRows('can read their own choices', S, `select staff_id from ops.push_pref`, 1);
  await expectRows('another person cannot', T2, `select staff_id from ops.push_pref`, 0);
  await expectOk('turns the defaults back on', S, `select ops.set_push_groups('{assigned,mentions,due,meetings,hr,activity}')`);

  console.log('Who is not pushed');
  await notify(P, 'assigned', 'To someone without a device');
  await expectVal('no device, no row', await rows(P), 0);
  await device(V, 'v1');
  await db.exec(`update ops.staff set is_active = false where id = '${V}'`);
  await notify(V, 'assigned', 'To an inactive person');
  await expectVal('an inactive person', await rows(V), 0);
  await db.exec(`update ops.staff set is_active = true where id = '${V}'`);

  console.log('One rule for where a notification leads');
  await reset();
  await notify(S, 'request_new', 'New request'); await notify(S, 'request_person_reply', 'They replied'); await notify(S, 'request_hr_reply', 'HR replied'); await notify(S, 'hr_file', 'A file');
  await expectVal('a new request leads HR to the inbox', `select link from ops.email_outbox where kind = 'request_new'`, '/hr/requests');
  await expectVal('a person\'s reply leads HR to the inbox too', `select link from ops.email_outbox where kind = 'request_person_reply'`, '/hr/requests');
  await expectVal('HR\'s reply leads the person to their requests', `select link from ops.email_outbox where kind = 'request_hr_reply'`, '/me/requests');
  await expectVal('a file leads to documents', `select link from ops.email_outbox where kind = 'hr_file'`, '/me/documents');

  console.log('The queue is private');
  await reset();
  await device(S, 's1'); await device(T2, 't1');
  await notify(S, 'assigned', 'For S'); await notify(T2, 'assigned', 'For T2');
  await expectRows('sees own rows', S, `select id from ops.push_outbox`, 1);
  await expectRows('another person sees none of them', T2, `select id from ops.push_outbox where recipient_id = '${S}'`, 0);
  await expectRows('a partner sees none', P, `select id from ops.push_outbox`, 0);
  await expectRows('even the founder cannot read others\' rows', F, `select id from ops.push_outbox`, 0);
  await expectRows('cannot edit the queue', S, `update ops.push_outbox set status = 'sent' returning id`, 0);
  await expectErr('cannot add to the queue', S, `insert into ops.push_outbox (subscription_id, recipient_id, kind, title, body) values (1, '${S}', 'x', 't', 'b')`, 'row-level security');
  await expectRows('cannot delete from the queue', S, `delete from ops.push_outbox returning id`, 0);

  console.log('Who can run the sender');
  await expectErr('a person cannot claim pushes', F, `select * from ops.claim_pushes()`, 'permission denied');
  await expectErr('a person cannot finish pushes', F, `select ops.finish_pushes('{1}', true)`, 'permission denied');
  await expectErr('a person cannot prune', F, `select ops.prune_outboxes()`, 'permission denied');
  await expectOk('the founder can see push health', F, `select ops.push_health()`);
  await expectErr('a lead cannot', W, `select ops.push_health()`, 'Only the founder');

  console.log('Test notification');
  await reset();
  await expectErr('no device yet', S, `select ops.queue_test_push()`, 'Turn notifications on');
  await device(S, 's1'); await device(S, 's2');
  {
    const r = (await expectOk('asks for a test', S, `select ops.queue_test_push() as n`))?.rows[0]?.n;
    Number(r) === 2 ? ok('...one row per device') : bad('...one row per device', String(r));
  }
  await expectErr('...but not twice in a moment', S, `select ops.queue_test_push()`, 'just sent');
  await expectVal('a test ignores topic choices', `select count(*) from ops.push_outbox where kind = 'test' and recipient_id = '${S}'`, 2);

  console.log('The sender claims, sends and closes');
  await reset();
  await device(S, 's1'); await device(T2, 't1');
  await notify(S, 'assigned', 'A'); await notify(T2, 'assigned', 'B');
  const got = (await db.query(`select * from ops.claim_pushes(50)`)).rows;
  got.length === 2 ? ok('everything due is claimed') : bad('everything due is claimed', `${got.length}`);
  await expectVal('...with the device address and keys', `select count(*) from ops.push_outbox where status = 'sending' and attempts = 1`, 2);
  got[0]?.endpoint?.startsWith('https://push.example/') && got[0]?.p256dh_key && got[0]?.auth_key ? ok('...handed to the sender') : bad('...handed to the sender', JSON.stringify(got[0]));
  await expectVal('claimed rows are not handed out again', `select count(*) from ops.claim_pushes(50)`, 0);
  const ids = got.map((r) => r.id);
  await expectVal('success marks them sent', `select ops.finish_pushes('{${ids.join(',')}}', true)`, 2);
  await expectVal('...with a time', `select count(*) from ops.push_outbox where status = 'sent' and sent_at is not null`, 2);
  await expectVal('...and the device is marked as working', `select count(*) from ops.push_subscription where last_ok_at is not null`, 2);

  console.log('Failures retry, then give up');
  await reset();
  await device(S, 's1'); await notify(S, 'assigned', 'Doomed');
  for (let i = 1; i <= 4; i++) {
    await db.exec(`update ops.push_outbox set next_attempt_at = now() - interval '1 second' where status = 'queued'`);
    const c = (await db.query(`select id from ops.claim_pushes()`)).rows.map((r) => r.id);
    await db.query(`select ops.finish_pushes('{${c.join(',')}}', false, 'timeout')`);
    if (i === 1) {
      await expectVal('a failure puts it back for a moment later', `select count(*) from ops.push_outbox where status = 'queued' and attempts = 1 and last_error = 'timeout' and next_attempt_at > now()`, 1);
    }
  }
  await expectVal('four failed tries mark it failed', `select status from ops.push_outbox`, 'failed');

  console.log('A device that no longer exists is removed');
  await reset();
  await device(S, 's1'); await device(S, 's2'); await notify(S, 'assigned', 'Gone');
  const gone = (await db.query(`select id, endpoint from ops.claim_pushes()`)).rows.find((r) => r.endpoint.endsWith('/s1'));
  await db.query(`select ops.finish_pushes('{${gone.id}}', false, '410 gone', true)`);
  await expectVal('the dead device is deleted', `select count(*) from ops.push_subscription where endpoint = 'https://push.example/s1'`, 0);
  await expectVal('...the other device is untouched', `select count(*) from ops.push_subscription where endpoint = 'https://push.example/s2'`, 1);
  await expectVal('...its queue row went with it', `select count(*) from ops.push_outbox where id = ${gone.id}`, 0);

  console.log('A problem on our side does not use up tries');
  await reset();
  await device(S, 's1'); await notify(S, 'assigned', 'Bad key day');
  const c3 = (await db.query(`select id from ops.claim_pushes()`)).rows.map((r) => r.id);
  await db.query(`select ops.finish_pushes('{${c3.join(',')}}', false, '403 bad vapid key', false, true)`);
  await expectVal('released: queued again with the try given back', `select count(*) from ops.push_outbox where status = 'queued' and attempts = 0 and next_attempt_at > now()`, 1);

  console.log('Stale and stuck rows');
  await reset();
  await device(S, 's1'); await notify(S, 'assigned', 'Old news');
  await db.exec(`update ops.push_outbox set created_at = now() - interval '2 hours'`);
  await expectVal('an hour-old push is dropped, not sent', `select count(*) from ops.claim_pushes()`, 0);
  await expectVal('...marked skipped', `select status from ops.push_outbox`, 'skipped');
  await reset();
  await device(S, 's1'); await notify(S, 'assigned', 'Stuck');
  await db.query(`select * from ops.claim_pushes()`);
  await db.exec(`update ops.push_outbox set next_attempt_at = now() - interval '3 minutes'`);
  await expectVal('a row stuck while sending is handed out again', `select count(*) from ops.claim_pushes()`, 1);

  console.log('Deleting things');
  await reset();
  await device(S, 's1'); await notify(S, 'assigned', 'Will be deleted');
  await db.exec(`delete from ops.notification where message = 'Will be deleted'`);
  await expectVal('deleting a notification keeps the queue row', `select count(*) from ops.push_outbox where notification_id is null`, 1);
  await db.exec(`delete from ops.push_subscription`);
  await expectVal('deleting a device removes its queue rows', `select count(*) from ops.push_outbox`, 0);

  console.log('Housekeeping');
  await reset();
  await device(S, 's1'); await device(T2, 't1');
  await db.exec(`update ops.push_subscription set last_ok_at = now() - interval '200 days' where staff_id = '${T2}'`);
  await notify(S, 'assigned', 'Old sent'); await notify(S, 'assigned', 'New sent');
  await db.exec(`update ops.push_outbox set status = 'sent', sent_at = now(); update ops.push_outbox set created_at = now() - interval '40 days' where body = 'Old sent'`);
  await db.exec(`update ops.email_outbox set status = 'sent', sent_at = now(); update ops.email_outbox set created_at = now() - interval '40 days' where subject = 'Old sent'`);
  const pruned = (await db.query(`select ops.prune_outboxes() as r`)).rows[0].r;
  pruned.push_rows === 1 && pruned.email_rows === 1 && pruned.devices === 1 ? ok('old finished rows and unseen devices are removed') : bad('old finished rows and unseen devices are removed', JSON.stringify(pruned));
  await expectVal('...recent rows are kept', `select count(*) from ops.push_outbox`, 1);

  await reset();
}
