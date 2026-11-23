// The task assistant: private key vault, private chats, and drafts that only move forward (0042).
// Called from test-migrations.mjs.
export default async function aiAssistantTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, F, S, W, T2, V, P } = t;
  console.log('\nTask assistant (0042)');

  const CIPHER = 'v1.' + 'A'.repeat(60);
  const rows = async (uid, sql) => (await run(uid, sql)).rows;
  const expectRows = async (name, uid, sql, want) => {
    try { const n = (await rows(uid, sql)).length; n === want ? ok(name) : bad(name, `${n} rows, want ${want}`); }
    catch (e) { bad(name, e.message.split('\n')[0]); }
  };

  await db.exec(`
    update ops.staff set is_active = true, role = 'founder', departments = '{}' where id = '${F}';
    update ops.staff set is_active = true, role = 'member', departments = '{sales}' where id = '${S}';
    update ops.staff set is_active = true, role = 'dept_lead', departments = '{workshop}' where id = '${W}';
    update ops.staff set is_active = true, role = 'member', departments = '{workshop}' where id = '${T2}';
    update ops.staff set is_active = true, role = 'viewer', departments = '{sales}' where id = '${V}';
    update ops.staff set is_active = true, role = 'partner', departments = '{}' where id = '${P}';
  `);

  // ---------------------------------------------------------------- the key
  console.log('The Gemini key');
  await expectOk('a member saves their key', T2, `select ops.save_ai_key('${CIPHER}', 'AbCd', 'gemini-2.5-flash')`);
  await expectOk('a lead saves a different one', W, `select ops.save_ai_key('${CIPHER}B', 'WxYz', 'gemini-2.5-pro')`);
  await expectRows('a person sees only their own key row', T2, `select staff_id from ops.ai_key`, 1);
  await expectRows('the founder cannot see other people\'s keys either', F, `select staff_id from ops.ai_key`, 0);
  await expectErr('the ciphertext cannot be selected', T2, `select cipher from ops.ai_key`, 'permission denied');
  await expectErr('...not even with select *', T2, `select * from ops.ai_key`, 'permission denied');
  await expectRows('the hint and model can be', T2, `select key_hint, model from ops.ai_key`, 1);
  await expectErr('a direct insert is refused', S, `insert into ops.ai_key (staff_id, cipher, key_hint, model) values ('${S}', '${CIPHER}', 'x', 'm')`, 'permission denied');
  await expectErr('a direct update is refused', T2, `update ops.ai_key set key_hint = 'zzzz'`, 'permission denied');
  await expectErr('a direct delete is refused', T2, `delete from ops.ai_key`, 'permission denied');
  const mine = await rows(T2, `select * from ops.load_ai_key()`);
  mine.length === 1 && mine[0].cipher === CIPHER && mine[0].model === 'gemini-2.5-flash' ? ok('the owner loads their own ciphertext') : bad('the owner loads their own ciphertext', JSON.stringify(mine));
  const lead = await rows(W, `select * from ops.load_ai_key()`);
  lead.length === 1 && lead[0].cipher === CIPHER + 'B' ? ok('...and each person gets only theirs') : bad('...and each person gets only theirs', JSON.stringify(lead));
  await expectRows('a person with no key loads nothing', S, `select * from ops.load_ai_key()`, 0);
  await expectErr('anonymous users cannot save a key', null, `select ops.save_ai_key('${CIPHER}', 'x', 'm')`, 'Sign in');
  await expectErr('a bad model name is refused', T2, `select ops.save_ai_key('${CIPHER}', 'AbCd', 'bad model!')`, 'violates check constraint');
  await expectErr('a too-short ciphertext is refused', T2, `select ops.save_ai_key('short', 'AbCd', 'm')`, 'violates check constraint');
  await expectOk('the model can be changed', T2, `select ops.set_ai_model('gemini-2.5-flash-lite')`);
  await expectVal('...and only theirs changes', `select count(*) from ops.ai_key where model = 'gemini-2.5-flash-lite'`, 1);
  await expectErr('changing the model with no key says so', S, `select ops.set_ai_model('gemini-2.5-flash')`, 'Add your Gemini key first');
  await expectOk('saving again replaces the key', T2, `select ops.save_ai_key('${CIPHER}C', 'NeWw', 'gemini-2.5-flash')`);
  await expectVal('...there is still one row for them', `select count(*) from ops.ai_key where staff_id = '${T2}'`, 1);
  await expectOk('the key can be deleted', T2, `select ops.delete_ai_key()`);
  await expectVal('...and is gone', `select count(*) from ops.ai_key where staff_id = '${T2}'`, 0);
  await expectVal('...theirs only', `select count(*) from ops.ai_key where staff_id = '${W}'`, 1);
  await db.exec(`update ops.staff set is_active = false where id = '${V}'`);
  await expectErr('a deactivated person cannot save a key', V, `select ops.save_ai_key('${CIPHER}', 'x', 'm')`, 'access was removed');
  await db.exec(`update ops.staff set is_active = true where id = '${V}'`);

  // ---------------------------------------------------------------- chats
  console.log('Chats');
  const chat = (await expectOk('a member starts a chat', T2, `insert into ops.ai_conversation (title) values ('Plan the week') returning id`))?.rows[0]?.id;
  const other = (await expectOk('a lead starts one too', W, `insert into ops.ai_conversation default values returning id`))?.rows[0]?.id;
  await expectRows('each person sees only their chats', T2, `select id from ops.ai_conversation`, 1);
  await expectRows('the founder does not see anyone else\'s chat', F, `select id from ops.ai_conversation`, 0);
  await expectErr('a chat cannot be made for someone else', T2, `insert into ops.ai_conversation (staff_id, title) values ('${W}', 'x')`, 'row-level security');
  await expectErr('an empty title is refused', T2, `update ops.ai_conversation set title = '  ' where id = '${chat}'`, 'violates check constraint');
  await expectOk('a chat can be renamed', T2, `update ops.ai_conversation set title = 'Plan next week' where id = '${chat}'`);
  await expectErr('a chat cannot be handed to someone else', T2, `update ops.ai_conversation set staff_id = '${W}' where id = '${chat}'`, 'cannot change owner');
  await expectVal('someone else\'s chat is not renamed by a guess', `select title from ops.ai_conversation where id = '${other}'`, 'New chat');
  await expectOk('another person\'s rename touches nothing', S, `update ops.ai_conversation set title = 'hacked' where id = '${chat}'`);
  await expectVal('...the title is unchanged', `select title from ops.ai_conversation where id = '${chat}'`, 'Plan next week');

  const msg = (c, role, text) => `insert into ops.ai_message (conversation_id, role, content) values ('${c}', '${role}', '{"role":"${role === 'user' ? 'user' : 'model'}","parts":[{"text":"${text}"}]}') returning id`;
  await expectOk('a message is saved', T2, msg(chat, 'user', 'hello'));
  await expectOk('and a reply', T2, msg(chat, 'model', 'hi'));
  await expectRows('messages are readable by their owner', T2, `select id from ops.ai_message where conversation_id = '${chat}'`, 2);
  await expectRows('...and by nobody else', F, `select id from ops.ai_message`, 0);
  await expectErr('nobody can post into someone else\'s chat', S, msg(chat, 'user', 'sneaky'), 'chat was not found');
  await expectErr('a message cannot claim another owner', T2, `insert into ops.ai_message (conversation_id, staff_id, role, content) values ('${chat}', '${W}', 'user', '{"parts":[]}')`, 'chat was not found');
  await expectErr('a bad role is refused', T2, `insert into ops.ai_message (conversation_id, role, content) values ('${chat}', 'system', '{"parts":[]}')`, 'violates check constraint');
  await expectErr('content must be an object', T2, `insert into ops.ai_message (conversation_id, role, content) values ('${chat}', 'user', '"text"')`, 'violates check constraint');
  await expectErr('a huge message is refused', T2, `insert into ops.ai_message (conversation_id, role, content) values ('${chat}', 'user', jsonb_build_object('t', repeat('x', 100001)))`, 'violates check constraint');
  await expectOk('an edit to a message matches nothing', T2, `update ops.ai_message set role = 'model'`);
  await expectVal('...so the first message is still the question', `select role from ops.ai_message where conversation_id = '${chat}' order by seq limit 1`, 'user');
  await expectErr('no one signed out can post', null, msg(chat, 'user', 'x'), 'Sign in');

  // limits
  const lim = (await expectOk('a chat for the limits', S, `insert into ops.ai_conversation (title) values ('limits') returning id`))?.rows[0]?.id;
  await db.exec(`set session_replication_role = replica; insert into ops.ai_message (conversation_id, staff_id, role, content)
                 select '${lim}', '${S}', 'user', '{"parts":[]}'::jsonb from generate_series(1, 60); set session_replication_role = origin;`);
  await expectErr('more than 60 questions an hour is refused', S, msg(lim, 'user', 'one more'), 'a lot of messages this hour');
  await expectOk('...but the assistant can still answer', S, msg(lim, 'model', 'answer'));
  await db.exec(`update ops.ai_message set created_at = now() - interval '2 hours' where conversation_id = '${lim}' and role = 'user'`);
  await expectOk('an hour later asking works again', S, msg(lim, 'user', 'again'));
  await db.exec(`update ops.ai_message set created_at = now() - interval '2 hours' where conversation_id = '${lim}'`);
  await db.exec(`set session_replication_role = replica; insert into ops.ai_message (conversation_id, staff_id, role, content, created_at)
                 select '${lim}', '${S}', 'user', '{"parts":[]}'::jsonb, now() - interval '3 hours' from generate_series(1, 340); set session_replication_role = origin;`);
  await expectErr('more than 400 a day is refused', S, msg(lim, 'user', 'too many'), 'limit of 400');
  const full = (await expectOk('a chat to fill', V, `insert into ops.ai_conversation default values returning id`))?.rows[0]?.id;
  await db.exec(`set session_replication_role = replica; insert into ops.ai_message (conversation_id, staff_id, role, content)
                 select '${full}', '${V}', 'model', '{"parts":[]}'::jsonb from generate_series(1, 600); set session_replication_role = origin;`);
  await expectErr('a chat holds at most 600 messages', V, msg(full, 'model', 'x'), 'chat is full');
  await db.exec(`set session_replication_role = replica; insert into ops.ai_conversation (staff_id, title) select '${P}', 'c' || g from generate_series(1, 200) g; set session_replication_role = origin;`);
  await expectErr('a person can keep 200 chats', P, `insert into ops.ai_conversation (title) values ('one too many')`, '200 chats');
  await db.exec(`delete from ops.ai_conversation where staff_id = '${P}'`);

  await expectVal('a new message moves its chat to the top', `select updated_at > created_at from ops.ai_conversation where id = '${chat}'`, true);

  // ---------------------------------------------------------------- drafts
  console.log('Drafts');
  const draft = (uid, c, kind = 'create_task', payload = '{"title":"Buy glue"}') =>
    `insert into ops.ai_action (conversation_id, kind, payload, summary) values ('${c}', '${kind}', '${payload}', 'Create "Buy glue"') returning id`;
  const A = (await expectOk('the assistant files a draft', T2, draft(T2, chat)))?.rows[0]?.id;
  await expectVal('...it starts pending and expires in a day', `select status = 'pending' and expires_at > now() + interval '23 hours' and decided_at is null from ops.ai_action where id = '${A}'`, true);
  await expectRows('the owner sees it', T2, `select id from ops.ai_action`, 1);
  await expectRows('nobody else does', F, `select id from ops.ai_action`, 0);
  await expectErr('a draft cannot go into someone else\'s chat', S, draft(S, chat), 'chat was not found');
  await expectErr('a draft needs a known kind', T2, draft(T2, chat, 'delete_everything'), 'violates check constraint');
  await expectErr('a draft payload must be an object', T2, `insert into ops.ai_action (conversation_id, kind, payload, summary) values ('${chat}', 'create_task', '[]', 'x')`, 'violates check constraint');
  const sneaky = (await expectOk('a draft inserted as already done is reset', T2,
    `insert into ops.ai_action (conversation_id, kind, payload, summary, status, result, expires_at) values ('${chat}', 'add_comment', '{"id":"x"}', 'x', 'done', '{"id":"1"}', now() + interval '10 years') returning id`))?.rows[0]?.id;
  await expectVal('...back to pending with a day to live', `select status = 'pending' and result is null and expires_at < now() + interval '2 days' from ops.ai_action where id = '${sneaky}'`, true);

  const areaKinds = ['schedule_meeting', 'update_meeting', 'cancel_meeting', 'rsvp_meeting', 'create_event', 'update_event', 'set_event_team', 'event_status', 'toggle_run_item', 'log_activity', 'create_deal', 'update_deal', 'move_deal'];
  for (const kind of areaKinds) await expectOk(`a ${kind} draft is accepted`, T2, draft(T2, chat, kind, '{}'));
  await expectRows('...and only its owner sees the calendar, workshop and sales drafts', F, `select id from ops.ai_action where kind = any (array[${areaKinds.map((k) => `'${k}'`).join(',')}])`, 0);
  await expectErr('a lookalike kind is still refused', T2, draft(T2, chat, 'schedule_meeting_all'), 'violates check constraint');
  await expectOk('...clean up', T2, `delete from ops.ai_action where kind = any (array[${areaKinds.map((k) => `'${k}'`).join(',')}])`);

  await expectErr('the payload cannot be edited after the fact', T2, `update ops.ai_action set payload = '{"title":"Delete all"}' where id = '${A}'`, 'cannot be changed');
  await expectErr('nor the summary', T2, `update ops.ai_action set summary = 'Something else' where id = '${A}'`, 'cannot be changed');
  await expectErr('nor the expiry', T2, `update ops.ai_action set expires_at = now() + interval '1 year' where id = '${A}'`, 'cannot be changed');
  await expectErr('a draft cannot jump to done', T2, `update ops.ai_action set status = 'done' where id = '${A}'`, 'already pending and cannot be done');
  await expectErr('nor set its own result', T2, `update ops.ai_action set result = '{"id":"1"}' where id = '${A}'`, 'outcome is set when it moves on');
  await expectOk('another person cannot run it (no row matches)', S, `update ops.ai_action set status = 'running' where id = '${A}'`);
  await expectVal('...it is still pending', `select status from ops.ai_action where id = '${A}'`, 'pending');
  await expectOk('the owner claims it', T2, `update ops.ai_action set status = 'running' where id = '${A}'`);
  await expectVal('...the time is noted', `select decided_at is not null from ops.ai_action where id = '${A}'`, true);
  await expectOk('a second claim finds nothing to take', T2, `update ops.ai_action set status = 'running' where id = '${A}' and status = 'pending'`);
  await expectErr('it cannot be cancelled while running', T2, `update ops.ai_action set status = 'cancelled' where id = '${A}'`, 'already running and cannot be cancelled');
  await expectOk('it finishes with a result', T2, `update ops.ai_action set status = 'done', result = '{"task_id":"abc"}' where id = '${A}'`);
  await expectErr('a finished draft cannot run again', T2, `update ops.ai_action set status = 'running' where id = '${A}'`, 'already done and cannot be running');
  await expectErr('...or be cancelled', T2, `update ops.ai_action set status = 'cancelled' where id = '${A}'`, 'already done');

  const B = (await expectOk('a second draft', T2, draft(T2, chat)))?.rows[0]?.id;
  await expectOk('it can be discarded', T2, `update ops.ai_action set status = 'cancelled' where id = '${B}'`);
  await expectErr('a discarded draft cannot run', T2, `update ops.ai_action set status = 'running' where id = '${B}'`, 'already cancelled');
  const C = (await expectOk('a third draft', T2, draft(T2, chat)))?.rows[0]?.id;
  await db.exec(`set session_replication_role = replica; update ops.ai_action set status = 'running' where id = '${C}'; set session_replication_role = origin;`);
  await expectOk('a failed run records why', T2, `update ops.ai_action set status = 'failed', error = 'The due date can''t be in the past.' where id = '${C}'`);
  await expectOk('a failed draft can be retried', T2, `update ops.ai_action set status = 'running' where id = '${C}'`);
  await expectVal('...the old error is cleared', `select error is null from ops.ai_action where id = '${C}'`, true);
  await db.exec(`set session_replication_role = replica; update ops.ai_action set decided_at = now() - interval '10 minutes' where id = '${C}'; set session_replication_role = origin;`);
  await expectOk('a run that never finished can be taken over after 5 minutes', T2, `update ops.ai_action set status = 'running' where id = '${C}'`);
  await expectVal('...and is stamped again', `select decided_at > now() - interval '1 minute' from ops.ai_action where id = '${C}'`, true);
  await db.exec(`set session_replication_role = replica; update ops.ai_action set status = 'done' where id = '${C}'; set session_replication_role = origin;`);

  const D = (await expectOk('a draft that will go stale', T2, draft(T2, chat)))?.rows[0]?.id;
  await db.exec(`alter table ops.ai_action disable trigger t_ai_action_guard; update ops.ai_action set expires_at = now() - interval '1 minute' where id = '${D}'; alter table ops.ai_action enable trigger t_ai_action_guard;`);
  await expectErr('an expired draft cannot be confirmed', T2, `update ops.ai_action set status = 'running' where id = '${D}'`, 'has expired');
  await expectOk('...but can be discarded', T2, `update ops.ai_action set status = 'cancelled' where id = '${D}'`);

  await db.exec(`delete from ops.ai_action where staff_id = '${T2}' and status <> 'pending'`);
  await db.exec(`set session_replication_role = replica; insert into ops.ai_action (conversation_id, staff_id, kind, payload, summary)
                 select '${lim}', '${S}', 'add_comment', '{}'::jsonb, 's' from generate_series(1, 30); set session_replication_role = origin;`);
  await expectErr('30 drafts waiting is the limit', S, draft(S, lim), '30 drafts waiting');

  // ---------------------------------------------------------------- cleaning up
  console.log('Deleting chats');
  await expectOk('a chat is deleted by its owner', T2, `delete from ops.ai_conversation where id = '${chat}'`);
  await expectVal('...its messages and drafts go with it', `select (select count(*) from ops.ai_message where conversation_id = '${chat}') + (select count(*) from ops.ai_action where conversation_id = '${chat}')`, 0);
  await expectOk('someone else\'s delete matches nothing', S, `delete from ops.ai_conversation where id = '${other}'`);
  await expectVal('...the lead\'s chat is still there', `select count(*) from ops.ai_conversation where id = '${other}'`, 1);
  await expectOk('deleting a person removes their key and chats', null, `delete from ops.ai_conversation where staff_id = '${W}'`);

  console.log('Grants');
  await expectErr('the helper that checks the caller is not callable', T2, `select ops.ai_caller()`, 'permission denied');
  await expectErr('the guard triggers are not callable', T2, `select ops.ai_action_guard()`, 'permission denied');
}
