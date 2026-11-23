// Shared tasks (one task, several owners), read-only parent access for subtask holders, and group progress (0038).
// Called from test-migrations.mjs.
export default async function sharedTaskTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, val, F, S, W, T2, P, V, O } = t;
  console.log('\nShared tasks, subtask access and group progress (0038)');

  const rows = async (uid, sql) => (await run(uid, sql)).rows;
  const expectRows = async (name, uid, sql, want) => {
    try { const n = (await rows(uid, sql)).length; n === want ? ok(name) : bad(name, `${n} rows, want ${want}`); }
    catch (e) { bad(name, e.message.split('\n')[0]); }
  };
  const asVal = async (name, uid, sql, want) => {
    try { const got = (await run(uid, sql)).rows[0]?.v; String(got) === String(want) ? ok(name) : bad(name, `got ${got}, want ${want}`); }
    catch (e) { bad(name, e.message.split('\n')[0]); }
  };
  const people = (...ids) => `array[${ids.map((p) => `'${p}'`).join(',')}]::uuid[]`;
  const shared = async (name, uid, ids, extra = '') => {
    const r = await expectOk(name, uid, `select ops.create_shared_task(title => 'ZZ Shared job', assignees => ${people(...ids)}, due_date => ops.today_ist() + 3 ${extra}) as id`);
    return r?.rows[0]?.id;
  };
  const upd = (id, set) => `update ops.task set ${set} where id = '${id}' returning id`;
  const count = (sql) => val(sql);

  // known starting point, whatever earlier suites left behind
  await db.exec(`
    update ops.staff set is_active = true, role = 'founder', departments = '{}' where id = '${F}';
    update ops.staff set is_active = true, role = 'member', departments = '{sales}' where id = '${S}';
    update ops.staff set is_active = true, role = 'dept_lead', departments = '{workshop,training}' where id = '${W}';
    update ops.staff set is_active = true, role = 'member', departments = '{workshop,training}' where id = '${T2}';
    update ops.staff set is_active = true, role = 'member', departments = '{outreach}' where id = '${O}';
    update ops.staff set is_active = true, role = 'viewer', departments = '{sales}' where id = '${V}';
    update ops.staff set is_active = true, role = 'partner', departments = '{}' where id = '${P}';
    delete from ops.notification;
  `);

  // ---------------------------------------------------------------- creating
  console.log('Creating a shared task');
  const A = await shared('a lead creates one task shared by a trainer and an outreach member', W, [T2, O]);
  await expectVal('...it is one task row', `select count(*) from ops.task where title = 'ZZ Shared job' and shared`, 1);
  await expectVal('...flagged shared, the first person is the primary, and it has no group', `select shared and assignee_id = '${T2}' and group_id is null and created_by = '${W}' from ops.task where id = '${A}'`, true);
  await expectVal('...both people (the primary too) are owners', `select count(*) from ops.task_owner where task_id = '${A}' and staff_id in ('${T2}', '${O}')`, 2);
  await expectVal('...each owner was told once', `select count(*) from ops.notification where task_id = '${A}' and kind = 'assigned' and recipient_id in ('${T2}', '${O}')`, 2);
  await expectVal('...the creator was not told', `select count(*) from ops.notification where task_id = '${A}' and recipient_id = '${W}'`, 0);
  await expectVal('...the creator and both owners watch it', `select count(*) from ops.task_watcher where task_id = '${A}'`, 3);
  await expectVal('...the history says created and assigned for each', `select count(*) from ops.task_history where task_id = '${A}' and kind in ('created', 'assigned')`, 3);
  const dup = await shared('the same person listed twice counts once, so a pair is still a pair', S, [O, O, T2]);
  await expectVal('...two owners, the first listed is primary', `select (select count(*) from ops.task_owner where task_id = '${dup}') = 2 and assignee_id = '${O}' from ops.task where id = '${dup}'`, true);
  await expectErr('one person is not enough', S, `select ops.create_shared_task(title => 'x', assignees => ${people(T2)})`, 'at least two people');
  await expectErr('the same person twice is not enough', S, `select ops.create_shared_task(title => 'x', assignees => ${people(T2, T2)})`, 'at least two people');
  await expectErr('nobody is not enough', S, `select ops.create_shared_task(title => 'x', assignees => '{}'::uuid[])`, 'at least two people');
  await expectErr('a title is required', S, `select ops.create_shared_task(title => '  ', assignees => ${people(T2, O)})`, 'needs a title');
  await expectErr('more than 20 people is refused', S, `select ops.create_shared_task(title => 'x', assignees => array(select gen_random_uuid() from generate_series(1, 21)))`, 'at most 20');
  await expectErr('a viewer cannot be given a shared task', S, `select ops.create_shared_task(title => 'x', assignees => ${people(T2, V)})`, 'viewer cannot be given');
  await expectErr('a partner cannot be given a shared task', S, `select ops.create_shared_task(title => 'x', assignees => ${people(T2, P)})`, 'follow-up');
  await expectErr('someone who is not on the team is refused', S, `select ops.create_shared_task(title => 'x', assignees => array['${T2}', gen_random_uuid()])`, 'active team member');
  await expectErr('a viewer cannot create one', V, `select ops.create_shared_task(title => 'x', assignees => ${people(T2, O)})`, 'cannot create tasks');
  await expectErr('a partner cannot create one', P, `select ops.create_shared_task(title => 'x', assignees => ${people(T2, O)})`, 'cannot create tasks');
  await expectVal('nothing was left behind by the refused ones', `select count(*) from ops.task where title = 'x'`, 0);
  const plain = (await expectOk('a member inserts a task and tries to flag it shared', S, `insert into ops.task (title, shared, assignee_id) values ('ZZ Plain', true, '${T2}') returning id`))?.rows[0]?.id;
  await expectVal('...the flag is dropped', `select shared from ops.task where id = '${plain}'`, false);
  await expectErr('a task that is not shared cannot take owners', W, `select ops.add_task_owner('${plain}', '${O}')`, 'not shared');
  await expectErr('...nor lose them', W, `select ops.remove_task_owner('${plain}', '${T2}')`, 'not shared');
  await expectErr('a missing task is reported', W, `select ops.add_task_owner(gen_random_uuid(), '${O}')`, 'not found');

  // ---------------------------------------------------------------- who sees it
  console.log('Who sees a shared task');
  await expectRows('the primary owner sees it', T2, `select id from ops.task where id = '${A}'`, 1);
  await expectRows('a co-owner sees it, in a team that is not its own', O, `select id from ops.task where id = '${A}'`, 1);
  await expectRows('the creator sees it', W, `select id from ops.task where id = '${A}'`, 1);
  await expectRows('the founder sees it', F, `select id from ops.task where id = '${A}'`, 1);
  await expectRows('a member who is not an owner does not', S, `select id from ops.task where id = '${A}'`, 0);
  await expectRows('a viewer does not', V, `select id from ops.task where id = '${A}'`, 0);
  await expectRows('a partner does not', P, `select id from ops.task where id = '${A}'`, 0);
  await expectRows('an owner sees the list of owners', O, `select * from ops.task_owner where task_id = '${A}'`, 2);
  await expectRows('the creator sees the list of owners', W, `select * from ops.task_owner where task_id = '${A}'`, 2);
  await expectRows('a non-owner sees no owners', S, `select * from ops.task_owner where task_id = '${A}'`, 0);
  await expectRows('a viewer sees no owners', V, `select * from ops.task_owner where task_id = '${A}'`, 0);
  await expectRows('a partner sees no owners', P, `select * from ops.task_owner where task_id = '${A}'`, 0);
  await expectRows('the founder sees every owner row', F, `select * from ops.task_owner where task_id = '${A}'`, 2);

  console.log('Owner list is written only through the functions');
  await expectErr('an owner cannot add a row directly', O, `insert into ops.task_owner (task_id, staff_id) values ('${A}', '${S}')`, 'row-level security');
  await expectErr('the creator cannot either', W, `insert into ops.task_owner (task_id, staff_id) values ('${A}', '${S}')`, 'row-level security');
  await expectErr('the founder cannot either', F, `insert into ops.task_owner (task_id, staff_id) values ('${A}', '${S}')`, 'row-level security');
  await expectRows('nobody can delete an owner row directly', W, `delete from ops.task_owner where task_id = '${A}' returning staff_id`, 0);
  await expectRows('nobody can change one', O, `update ops.task_owner set staff_id = '${S}' where task_id = '${A}' returning staff_id`, 0);
  await expectRows('...so the list is still two', F, `select * from ops.task_owner where task_id = '${A}'`, 2);

  // ---------------------------------------------------------------- co-owner counts as an assignee
  console.log('A co-owner works on it like an assignee');
  await expectOk('a co-owner accepts it', O, upd(A, 'accepted_at = now()'));
  await expectVal('...it is accepted', `select accepted_at is not null from ops.task where id = '${A}'`, true);
  await expectOk('a co-owner starts it', O, upd(A, `status = 'doing'`));
  await expectErr('a co-owner must say what blocks it', O, upd(A, `status = 'blocked'`), 'what is blocking');
  await expectErr('a co-owner cannot rename it', O, upd(A, `title = 'mine'`), 'can edit its details');
  await expectErr('a co-owner cannot hand it to someone else', O, upd(A, `assignee_id = '${S}'`), 'list of owners');
  await expectErr('nor can the creator, the owner list is the only way', W, upd(A, `assignee_id = '${S}'`), 'list of owners');
  await expectErr('nor can anyone clear the primary', T2, upd(A, `assignee_id = null`), 'list of owners');
  await expectRows('a member who is not an owner cannot touch it', S, upd(A, `status = 'done'`), 0);
  await expectRows('a viewer cannot', V, upd(A, `status = 'done'`), 0);
  await expectRows('a partner cannot', P, upd(A, `status = 'done'`), 0);
  await expectOk('a co-owner comments', O, `insert into ops.task_comment (task_id, body) values ('${A}', 'on it')`);
  await expectErr('a member who is not an owner cannot comment', S, `insert into ops.task_comment (task_id, body) values ('${A}', 'hi')`, 'row-level security');
  await expectVal('the primary owner and the creator were told of the comment, the author was not',
    `select string_agg(recipient_id::text, ',' order by recipient_id) from ops.notification where task_id = '${A}' and kind = 'comment'`, [T2, W].sort().join(','));
  await expectRows('a co-owner reads the comments', O, `select * from ops.task_comment where task_id = '${A}'`, 1);
  await expectRows('a non-owner does not', S, `select * from ops.task_comment where task_id = '${A}'`, 0);
  await expectOk('a co-owner logs time on it', O, `insert into ops.time_entry (task_id, source, work_date, minutes) values ('${A}', 'manual', ops.today_ist(), 30)`);
  await expectErr('a member who is not an owner cannot', S, `insert into ops.time_entry (task_id, source, work_date, minutes) values ('${A}', 'manual', ops.today_ist(), 30)`, 'row-level security');
  await expectRows('the creator sees that time', W, `select * from ops.time_entry where task_id = '${A}'`, 1);
  await expectVal('...the status change reached the primary and the creator once each',
    `select string_agg(recipient_id::text, ',' order by recipient_id) from ops.notification where task_id = '${A}' and kind = 'status'`, [T2, W].sort().join(','));

  // ---------------------------------------------------------------- owner list
  console.log('Adding and removing owners');
  await expectErr('an owner cannot add someone', O, `select ops.add_task_owner('${A}', '${S}')`, 'can change its owners');
  await expectErr('a member who cannot see it cannot add someone', S, `select ops.add_task_owner('${A}', '${S}')`, 'can change its owners');
  await expectErr('a viewer cannot add someone', V, `select ops.add_task_owner('${A}', '${S}')`, 'can change its owners');
  await expectOk('the creator adds a third owner', W, `select ops.add_task_owner('${A}', '${S}')`);
  await expectVal('...three owners', `select count(*) from ops.task_owner where task_id = '${A}'`, 3);
  await expectRows('...the new owner now sees it', S, `select id from ops.task where id = '${A}'`, 1);
  await expectVal('...and was told once, and watches it', `select (select count(*) from ops.notification where task_id = '${A}' and recipient_id = '${S}' and kind = 'assigned') = 1
                                                              and (select count(*) from ops.task_watcher where task_id = '${A}' and staff_id = '${S}') = 1`, true);
  await expectVal('...the history shows the new owner', `select count(*) from ops.task_history where task_id = '${A}' and kind = 'assigned' and to_value = (select full_name from ops.staff where id = '${S}')`, 1);
  await expectErr('adding the same person again is refused', W, `select ops.add_task_owner('${A}', '${S}')`, 'already owns');
  await expectErr('a viewer cannot be added', W, `select ops.add_task_owner('${A}', '${V}')`, 'viewer cannot be given');
  await expectErr('a partner cannot be added', W, `select ops.add_task_owner('${A}', '${P}')`, 'follow-up');
  await expectErr('someone who is not on the team cannot be added', W, `select ops.add_task_owner('${A}', gen_random_uuid())`, 'active team member');
  await expectErr('a new owner cannot remove another', S, `select ops.remove_task_owner('${A}', '${O}')`, 'can change its owners');
  await expectOk('the founder can remove an owner', F, `select ops.remove_task_owner('${A}', '${S}')`);
  await expectRows('...who then no longer sees it', S, `select id from ops.task where id = '${A}'`, 0);
  await expectVal('...and was told, and stopped watching', `select (select count(*) from ops.notification where task_id = '${A}' and recipient_id = '${S}' and message like '%took you off%') = 1
                                                               and (select count(*) from ops.task_watcher where task_id = '${A}' and staff_id = '${S}') = 0`, true);
  await expectErr('a shared task keeps at least two owners', W, `select ops.remove_task_owner('${A}', '${O}')`, 'at least two owners');
  await expectErr('someone who is not an owner cannot be removed', W, `select ops.remove_task_owner('${A}', '${S}')`, 'does not own');

  await expectOk('the creator adds the third owner back', W, `select ops.add_task_owner('${A}', '${S}')`);
  await expectOk('the creator removes the primary owner', W, `select ops.remove_task_owner('${A}', '${T2}')`);
  await expectVal('...the primary moves to another owner', `select assignee_id = '${O}' from ops.task where id = '${A}'`, true);
  await expectVal('...acceptance and who assigned it stay as they were', `select accepted_at is not null and assigned_by = '${W}' from ops.task where id = '${A}'`, true);
  await expectVal('...every remaining owner still has a row, the removed one does not', `select count(*) filter (where staff_id in ('${O}', '${S}')) = 2 and count(*) filter (where staff_id = '${T2}') = 0 from ops.task_owner where task_id = '${A}'`, true);
  await expectRows('...the removed primary no longer sees it', T2, `select id from ops.task where id = '${A}'`, 0);
  await expectVal('...and was told', `select count(*) from ops.notification where task_id = '${A}' and recipient_id = '${T2}' and message like '%took you off%'`, 1);
  await expectVal('...the new primary was not sent a second "gave you a task"', `select count(*) from ops.notification where task_id = '${A}' and recipient_id = '${O}' and kind = 'assigned'`, 1);
  await expectOk('the creator adds them back as a plain co-owner', W, `select ops.add_task_owner('${A}', '${T2}')`);

  // ---------------------------------------------------------------- finishing
  console.log('Any owner finishes it');
  await expectOk('an owner who is not the primary finishes it', T2, upd(A, `status = 'done'`));
  await expectVal('...it is done, and the finisher is recorded', `select status = 'done' and completed_by = '${T2}' and completed_at is not null from ops.task where id = '${A}'`, true);
  await expectRows('...the primary sees it done', O, `select id from ops.task where id = '${A}' and status = 'done'`, 1);
  await expectRows('...so does another co-owner', S, `select id from ops.task where id = '${A}' and status = 'done'`, 1);
  await expectVal('...the other owners were told once, the finisher was not',
    `select string_agg(recipient_id::text, ',' order by recipient_id) from ops.notification where task_id = '${A}' and message like '%marked it done%'`, [O, S, W].sort().join(','));
  await expectErr('another owner cannot reopen what someone else finished', S, upd(A, `status = 'doing'`), 'can reopen it');
  await expectErr('the primary cannot either', O, upd(A, `status = 'doing'`), 'can reopen it');
  await expectErr('a finished task takes no new owners', W, `select ops.add_task_owner('${A}', '${F}')`, 'Reopen the task');
  await expectErr('...and loses none', W, `select ops.remove_task_owner('${A}', '${S}')`, 'Reopen the task');
  await expectOk('the finisher can reopen it', T2, upd(A, `status = 'doing'`));
  await expectVal('...no finisher is recorded any more', `select completed_by is null and completed_at is null from ops.task where id = '${A}'`, true);
  await expectOk('the creator finishes it', W, upd(A, `status = 'done'`));
  await expectVal('...the creator is the finisher', `select completed_by from ops.task where id = '${A}'`, W);

  // ---------------------------------------------------------------- department, lead of a co-owner
  console.log('Teams and leads');
  const D = await shared('a Sales member shares a Sales task with a trainer and an outreach member', S, [T2, O], `, department => 'sales'`);
  await expectRows('a co-owner outside Sales still sees it', T2, `select id from ops.task where id = '${D}'`, 1);
  await expectRows('a lead of other teams does not', W, `select id from ops.task where id = '${D}'`, 0);
  await expectOk('a co-owner outside Sales accepts it', O, upd(D, 'accepted_at = now()'));
  await expectErr('...but cannot change its department', O, upd(D, `department = 'workshop'`), 'can edit its details');

  const B = await shared('a Sales member shares a task with no team, outreach first', S, [O, T2]);
  await expectRows('the lead of the second owner sees it', W, `select id from ops.task where id = '${B}'`, 1);
  await expectOk('...and can edit its details', W, upd(B, `title = 'ZZ Shared (lead edit)'`));
  await expectOk('...and accept nothing but may still comment', W, `insert into ops.task_comment (task_id, body) values ('${B}', 'lead here')`);
  await expectRows('a viewer does not see it', V, `select id from ops.task where id = '${B}'`, 0);
  const C = await shared('a Sales member shares a task with themself and an outreach member', S, [S, O]);
  await expectVal('...the creator is an owner, so it is accepted already', `select accepted_at is not null from ops.task where id = '${C}'`, true);
  await expectRows('a lead who leads neither owner does not see it', W, `select id from ops.task where id = '${C}'`, 0);
  await expectRows('a lead who leads neither owner cannot delete it', W, `delete from ops.task where id = '${C}' returning id`, 0);
  await expectRows('the lead of a co-owner can delete a shared task with no team', W, `delete from ops.task where id = '${B}' returning id`, 1);
  await expectVal('...its owners go with it', `select count(*) from ops.task_owner where task_id = '${B}'`, 0);
  await expectRows('an owner cannot delete it', O, `delete from ops.task where id = '${C}' returning id`, 0);

  console.log('Reminders reach every owner');
  const R = await shared('a shared task due today', S, [T2, O]);
  await db.exec(`update ops.task set due_date = ops.today_ist() where id = '${R}'`);
  await db.query(`select ops.run_task_reminders()`);
  await expectVal('...the primary and the co-owner each get "due today"', `select count(*) from ops.notification where task_id = '${R}' and kind = 'due_today' and recipient_id in ('${T2}', '${O}')`, 2);
  await db.exec(`update ops.task set due_date = ops.today_ist() - 1 where id = '${R}'`);
  await db.query(`select ops.run_task_reminders()`);
  await expectVal('...and "overdue", once each, the creator included', `select count(*) from ops.notification where task_id = '${R}' and kind = 'overdue'`, 3);
  await db.query(`select ops.run_task_reminders()`);
  await expectVal('...running it again sends nothing new', `select count(*) from ops.notification where task_id = '${R}' and kind in ('overdue', 'due_today')`, 5);

  // ---------------------------------------------------------------- subtasks: read the parent and siblings
  console.log('A subtask holder reads the parent and the siblings');
  const PT = (await expectOk('a lead makes a task with no team and no person', W, `insert into ops.task (title) values ('ZZ Parent') returning id`))?.rows[0]?.id;
  const sub = async (name, assignee) => (await expectOk(name, W, `insert into ops.task (title, parent_task_id, assignee_id) values ('ZZ Sub', '${PT}', '${assignee}') returning id`))?.rows[0]?.id;
  const ST1 = await sub('...with a subtask for an outreach member', O);
  const ST2 = await sub('...and one for a trainer', T2);
  await expectOk('the lead comments on the parent', W, `insert into ops.task_comment (task_id, body) values ('${PT}', 'private to the parent')`);
  await expectOk('...and on the sibling', W, `insert into ops.task_comment (task_id, body) values ('${ST2}', 'private to the sibling')`);
  await expectRows('a member with no subtask does not see the parent', S, `select id from ops.task where id = '${PT}'`, 0);
  await expectRows('...nor the subtasks', S, `select id from ops.task where parent_task_id = '${PT}'`, 0);
  await expectRows('the subtask holder sees the parent', O, `select id from ops.task where id = '${PT}'`, 1);
  await expectRows('...and every sibling, their own included', O, `select id from ops.task where parent_task_id = '${PT}'`, 2);
  await expectRows('the other subtask holder sees the parent too', T2, `select id from ops.task where id = '${PT}'`, 1);
  await expectRows('a viewer does not', V, `select id from ops.task where id in ('${PT}', '${ST1}', '${ST2}')`, 0);
  await expectRows('a partner does not', P, `select id from ops.task where id in ('${PT}', '${ST1}', '${ST2}')`, 0);
  await asVal('the full-access rule says no for the parent', O, `select ops.sees_task_fully('${PT}') as v`, false);
  await asVal('...and for a sibling', O, `select ops.sees_task_fully('${ST2}') as v`, false);
  await asVal('...but yes for their own', O, `select ops.sees_task_fully('${ST1}') as v`, true);

  console.log('...but only to read');
  await expectRows('the holder cannot change the parent', O, upd(PT, `status = 'done'`), 0);
  await expectRows('...not even its title', O, upd(PT, `title = 'mine'`), 0);
  await expectVal('...nothing changed', `select title = 'ZZ Parent' and status = 'todo' from ops.task where id = '${PT}'`, true);
  await expectRows('the holder cannot change a sibling', O, upd(ST2, `status = 'done'`), 0);
  await expectRows('...but can change their own subtask', O, upd(ST1, `status = 'doing'`), 1);
  await expectRows('the holder cannot delete the parent', O, `delete from ops.task where id = '${PT}' returning id`, 0);
  await expectRows('...nor a sibling', O, `delete from ops.task where id = '${ST2}' returning id`, 0);
  await expectRows('the holder cannot read the parent\'s comments', O, `select * from ops.task_comment where task_id = '${PT}'`, 0);
  await expectRows('...nor a sibling\'s', O, `select * from ops.task_comment where task_id = '${ST2}'`, 0);
  await expectRows('...nor the parent\'s history', O, `select * from ops.task_history where task_id = '${PT}'`, 0);
  await expectRows('...nor a sibling\'s history', O, `select * from ops.task_history where task_id = '${ST2}'`, 0);
  await expectRows('...but reads their own subtask\'s history', O, `select * from ops.task_history where task_id = '${ST1}' and kind = 'created'`, 1);
  await expectRows('...and its comments', O, `select * from ops.task_comment where task_id = '${ST1}'`, 0);
  await expectRows('the holder sees no watchers or owners of the parent', O, `select staff_id from ops.task_watcher where task_id = '${PT}'`, 0);
  await expectErr('...cannot comment on the parent', O, `insert into ops.task_comment (task_id, body) values ('${PT}', 'hi')`, 'row-level security');
  await expectErr('...cannot log time on the parent', O, `insert into ops.time_entry (task_id, source, work_date, minutes) values ('${PT}', 'manual', ops.today_ist(), 10)`, 'row-level security');
  await expectErr('...cannot watch the parent', O, `insert into ops.task_watcher (task_id, staff_id) values ('${PT}', '${O}')`, 'row-level security');
  await expectOk('...can comment on their own subtask', O, `insert into ops.task_comment (task_id, body) values ('${ST1}', 'working')`);
  await expectOk('...and log time on it', O, `insert into ops.time_entry (task_id, source, work_date, minutes) values ('${ST1}', 'manual', ops.today_ist(), 20)`);
  await expectRows('the lead still sees the parent\'s comments', W, `select * from ops.task_comment where task_id = '${PT}'`, 1);

  console.log('...also for a co-owner of a subtask');
  await db.exec(`select set_config('ops.task_rpc', '1', false);
                 insert into ops.task (id, title, parent_task_id, assignee_id, shared, created_by)
                 values ('dddddddd-0000-0000-0000-000000000001', 'ZZ Shared sub', '${PT}', '${T2}', true, '${W}');
                 insert into ops.task_owner (task_id, staff_id, added_by) values
                   ('dddddddd-0000-0000-0000-000000000001', '${T2}', '${W}'), ('dddddddd-0000-0000-0000-000000000001', '${S}', '${W}');
                 select set_config('ops.task_rpc', '', false);`);
  await expectRows('a co-owner of a shared subtask sees the parent', S, `select id from ops.task where id = '${PT}'`, 1);
  await expectRows('...and the other subtasks', S, `select id from ops.task where parent_task_id = '${PT}'`, 3);
  await expectRows('...but cannot change the parent', S, upd(PT, `status = 'done'`), 0);
  await expectRows('...nor read its comments', S, `select * from ops.task_comment where task_id = '${PT}'`, 0);
  await expectRows('...and a member with no part in it still sees nothing', V, `select id from ops.task where parent_task_id = '${PT}'`, 0);
  await expectOk('a co-owner of the subtask starts it', S, upd('dddddddd-0000-0000-0000-000000000001', `status = 'doing'`));
  await db.exec(`delete from ops.task where parent_task_id = '${PT}'`);
  await expectRows('with no subtask left, the access ends', O, `select id from ops.task where id = '${PT}'`, 0);

  // ---------------------------------------------------------------- group progress
  console.log('Group progress');
  const g = await expectOk('a lead gives a task to three people, one each', W, `select ops.create_task_group(title => 'ZZ Progress', assignees => ${people(T2, O, S)}, due_date => ops.today_ist() + 5) as ids`);
  const ids = g?.rows[0]?.ids ?? [];
  const grp = await val(`select group_id from ops.task where id = '${ids[0]}'`);
  const copy = (who) => `(select id from ops.task where group_id = '${grp}' and assignee_id = '${who}')`;
  const prog = (uid) => rows(uid, `select * from ops.task_group_progress('${grp}')`);
  const same = (r, want) => r.length === 1 && Object.entries(want).every(([k, v]) => Number(r[0][k]) === v);
  const check = async (name, uid, want) => {
    try { const r = await prog(uid); same(r, want) ? ok(name) : bad(name, JSON.stringify(r)); } catch (e) { bad(name, e.message.split('\n')[0]); }
  };
  await check('nothing done yet: three open, none overdue, three people', W, { total: 3, done: 0, open: 3, overdue: 0, people: 3 });
  await expectOk('one person finishes their copy', T2, `update ops.task set status = 'done' where id = ${copy(T2)} returning id`);
  await db.exec(`update ops.task set due_date = ops.today_ist() - 1 where id = ${copy(O)}`);
  await check('one done, two open, one of them overdue', W, { total: 3, done: 1, open: 2, overdue: 1, people: 3 });
  await check('the person with the overdue copy sees the same counts', O, { total: 3, done: 1, open: 2, overdue: 1, people: 3 });
  await check('so does the one whose copy is done', T2, { total: 3, done: 1, open: 2, overdue: 1, people: 3 });
  await check('the founder too', F, { total: 3, done: 1, open: 2, overdue: 1, people: 3 });
  await expectRows('...yet a member still sees only their own copy', O, `select id from ops.task where group_id = '${grp}'`, 1);
  await expectRows('...and the summary carries no names', O, `select * from ops.task_group_progress('${grp}')`, 1);
  const cols = Object.keys((await prog(O))[0]).sort().join(',');
  cols === 'done,open,overdue,people,total' ? ok('...only the five counts') : bad('...only the five counts', cols);
  await db.exec(`update ops.task set status = 'cancelled', cancel_reason = 'not needed' where id = ${copy(S)}`);
  await check('a cancelled copy leaves the totals', W, { total: 2, done: 1, open: 1, overdue: 1, people: 2 });
  await check('...and the cancelled person can still see them', S, { total: 2, done: 1, open: 1, overdue: 1, people: 2 });
  await expectRows('a viewer gets nothing', V, `select * from ops.task_group_progress('${grp}')`, 0);
  await expectRows('a partner gets nothing', P, `select * from ops.task_group_progress('${grp}')`, 0);
  const g2 = await expectOk('the lead gives another task to two people', W, `select ops.create_task_group(title => 'ZZ Progress two', assignees => ${people(T2, O)}) as ids`);
  const grp2 = await val(`select group_id from ops.task where id = '${g2?.rows[0]?.ids?.[0]}'`);
  await expectRows('a member with no copy gets nothing', S, `select * from ops.task_group_progress('${grp2}')`, 0);
  await expectRows('an unknown group gets nothing', W, `select * from ops.task_group_progress(gen_random_uuid())`, 0);
  await expectRows('the creator gets the counts', W, `select * from ops.task_group_progress('${grp2}')`, 1);
  await expectVal('a task that is not in a group has no progress', `select count(*) from ops.task_group_progress(null)`, 0);

  console.log('A subtask shared by several people (0040)');
  const SS = (await expectOk('the lead gives one subtask to two people', W, `select ops.create_shared_task(title => 'ZZ Shared sub', assignees => ${people(T2, O)}, parent_task => '${PT}') as id`))?.rows[0]?.id;
  await expectVal('...it is a shared subtask of the parent', `select shared and parent_task_id = '${PT}' from ops.task where id = '${SS}'`, true);
  await expectVal('...both people own it', `select count(*) from ops.task_owner where task_id = '${SS}'`, 2);
  await expectErr('a member who cannot see the parent cannot attach one', S, `select ops.create_shared_task(title => 'x', assignees => ${people(T2, O)}, parent_task => '${PT}')`, 'parent task was not found');
  await expectOk('a holder of a sibling subtask can attach one', O, `select ops.create_shared_task(title => 'ZZ Shared sub two', assignees => ${people(T2, O)}, parent_task => '${PT}') as id`);
  await expectErr('a subtask cannot have subtasks', W, `select ops.create_shared_task(title => 'x', assignees => ${people(T2, O)}, parent_task => '${SS}')`, 'cannot have subtasks');
  await expectErr('an unknown parent is refused', W, `select ops.create_shared_task(title => 'x', assignees => ${people(T2, O)}, parent_task => gen_random_uuid())`, 'parent task was not found');
  await expectVal('...and nothing was left behind', `select count(*) from ops.task where title = 'x'`, 0);

  console.log('Existing rules still hold');
  await expectVal('a group copy is still a plain task, not shared', `select count(*) from ops.task where group_id = '${grp}' and shared`, 0);
  await expectErr('a group task is not shared, so it takes no owners', W, `select ops.add_task_owner(${copy(O)}, '${S}')`, 'not shared');
  await expectErr('a plain task still can only be accepted by its assignee', W, `update ops.task set accepted_at = now() where id = ${copy(T2)}`, 'Only the assignee');
}
