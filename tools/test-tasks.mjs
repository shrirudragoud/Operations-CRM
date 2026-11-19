// Task core (0018). Called from test-migrations.mjs after the Workshop tests.
export default async function taskTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, val, F, S, W, T2, P, V, O } = t;

  console.log('\nTask core (0018)');
  const mk = async (name, uid, cols, vals) => {
    const r = await expectOk(name, uid, `insert into ops.task (${cols}) values (${vals}) returning id`);
    return r?.rows[0]?.id;
  };
  const upd = (id, set) => `update ops.task set ${set} where id = '${id}' returning id`;
  const rows = async (uid, sql) => (await run(uid, sql)).rows.length;
  const expectRows = async (name, uid, sql, want) => {
    const n = await rows(uid, sql);
    n === want ? ok(name) : bad(name, `${n} rows, want ${want}`);
  };

  console.log('Creating and assigning');
  const a = await mk('a Sales member creates an Outreach task and assigns it to an Outreach colleague', S,
    'department, title, assignee_id, due_date, due_time, priority', `'outreach', '  Call the principal  ', '${O}', current_date + 3, '10:30', 2`);
  await expectVal('the title is trimmed', `select title from ops.task where id='${a}'`, 'Call the principal');
  await expectVal('the database stamps who created and assigned it',
    `select created_by = '${S}' and assigned_by = '${S}' and assigned_at is not null and accepted_at is null from ops.task where id='${a}'`, true);
  await expectVal('the history starts with created and assigned', `select count(*) from ops.task_history where task_id='${a}' and kind in ('created','assigned')`, 2);
  await expectErr('a task cannot be created as already done', S, `insert into ops.task (department, title, status) values ('sales','x','done')`, 'starts as to do');
  await expectErr('a blank title is refused', S, `insert into ops.task (department, title) values ('sales','   ')`, 'needs a title');
  const noDate = await mk('a due time without a date is dropped', S, 'department, title, due_time', `'sales','No date','09:00'`);
  await expectVal('...the time is cleared', `select due_time is null from ops.task where id='${noDate}'`, true);
  await expectErr('a viewer cannot create tasks', V, `insert into ops.task (department, title) values ('sales','x')`, 'row-level security');
  await expectErr('a task cannot be assigned to a viewer', S, `insert into ops.task (department, title, assignee_id) values ('sales','x','${V}')`, 'viewer');
  await expectErr('a partner cannot be given an ordinary task', S, `insert into ops.task (department, title, assignee_id) values ('sales','x','${P}')`, 'follow-up');
  await db.exec(`update ops.staff set is_active = false where id = '${T2}'`);
  await expectErr('a deactivated person cannot be assigned', S, `insert into ops.task (department, title, assignee_id) values ('sales','x','${T2}')`, 'active team member');
  await db.exec(`update ops.staff set is_active = true where id = '${T2}'`);
  await mk('a partner can still be given a follow-up task', S, 'department, title, assignee_id, template', `'outreach','Follow up','${P}','follow_up'`);
  const spoof = await mk('created_by from the client is ignored', S, 'department, title, created_by', `'sales','Spoof','${F}'`);
  await expectVal('...the creator is the caller', `select created_by = '${S}' from ops.task where id='${spoof}'`, true);

  console.log('Visibility');
  await expectRows('the creator sees a task outside their own department', S, `select id from ops.task where id='${a}'`, 1);
  await expectRows('the assignee sees it', O, `select id from ops.task where id='${a}'`, 1);
  await expectRows('the founder sees it', F, `select id from ops.task where id='${a}'`, 1);
  await expectRows('an unrelated department does not', W, `select id from ops.task where id='${a}'`, 0);
  await expectRows('a partner does not', P, `select id from ops.task where id='${a}'`, 0);

  console.log('Who can edit, accept and reassign');
  await expectOk('the assignee accepts the task', O, upd(a, `accepted_at = now()`));
  await expectVal('...the accept time is stamped', `select accepted_at is not null from ops.task where id='${a}'`, true);
  await expectErr('someone else cannot accept it', S, upd(a, `accepted_at = now()`), 'only the assignee');
  const queue = await mk('an unassigned Sales task in the queue', F, 'department, title', `'sales','Quote for ZP school'`);
  await expectOk('a department member claims an unassigned task', S, upd(queue, `assignee_id = '${S}'`));
  await expectVal('...and has accepted it', `select accepted_at is not null and assigned_by = '${S}' from ops.task where id='${queue}'`, true);
  await expectErr('an assignee cannot hand their task to someone else', O, upd(a, `assignee_id = '${S}'`), 'can reassign');
  await expectErr('an assignee cannot rename the task', O, upd(a, `title = 'Something else'`), 'can edit its details');
  await expectRows('a viewer cannot change a task', V, upd(a, `priority = 1`), 0);
  await expectOk('the creator can rename it', S, upd(a, `title = 'Call the principal today'`));
  await expectOk('the creator can reassign it', S, upd(a, `assignee_id = '${F}'`));
  await expectVal('...reassigning resets the accept and stamps who', `select accepted_at is null and assigned_by = '${S}' from ops.task where id='${a}'`, true);
  await expectOk('the new assignee can decline (back to the queue)', F, upd(a, `assignee_id = null`));
  await expectVal('...nobody owns it now', `select assignee_id is null from ops.task where id='${a}'`, true);
  const ws = await mk('a Workshop task with no owner', F, 'department, title', `'workshop','Check the projector'`);
  await expectOk('a department lead assigns a task in their department', W, upd(ws, `assignee_id = '${T2}'`));
  await expectOk('the assignee can move the due date (it is recorded)', T2, upd(ws, `due_date = current_date + 5`));
  await expectVal('...the change is in the history', `select count(*) from ops.task_history where task_id='${ws}' and kind='due'`, 1);

  console.log('Status path and reasons');
  const c = await mk('a task to work through', S, 'department, title, assignee_id', `'sales','Send brochure','${S}'`);
  await expectErr('blocked needs a reason', S, upd(c, `status = 'blocked'`), 'what is blocking');
  await expectOk('blocked with a reason', S, upd(c, `status = 'blocked', blocked_reason = 'Waiting for the principal'`));
  await expectOk('unblocking clears the reason', S, upd(c, `status = 'doing'`));
  await expectVal('...reason cleared', `select blocked_reason is null from ops.task where id='${c}'`, true);
  await expectErr('cancelling needs a reason', S, upd(c, `status = 'cancelled'`), 'why the task is cancelled');
  await expectOk('done stamps who and when', S, upd(c, `status = 'done'`));
  await expectVal('...done by the caller', `select completed_by = '${S}' and completed_at is not null from ops.task where id='${c}'`, true);
  await expectErr('a finished task cannot go straight to blocked', S, upd(c, `status = 'blocked', blocked_reason = 'x'`), 'only be reopened');
  await expectOk('the person who finished it can reopen it', S, upd(c, `status = 'doing'`));
  await expectVal('...reopening clears the stamp', `select completed_at is null and completed_by is null from ops.task where id='${c}'`, true);
  await expectOk('finish it again', S, upd(c, `status = 'done'`));
  const d = await mk('a task the founder will finish', F, 'department, title, assignee_id', `'sales','Reopen me','${S}'`);
  await expectOk('the founder finishes it', F, upd(d, `status = 'done'`));
  await expectErr('the assignee cannot reopen what someone else finished', S, upd(d, `status = 'todo'`), 'reopen');
  await expectOk('a founder can reopen it', F, upd(d, `status = 'todo'`));

  console.log('Subtasks');
  const parent = await mk('a parent task', S, 'department, title, assignee_id', `'sales','Plan the demo','${S}'`);
  const child = await mk('a subtask', S, 'department, title, parent_task_id', `'sales','Book the room','${parent}'`);
  await expectErr('a subtask cannot have subtasks', S, `insert into ops.task (department, title, parent_task_id) values ('sales','x','${child}')`, 'cannot have subtasks');
  await expectErr('a task cannot be its own subtask', S, upd(parent, `parent_task_id = '${parent}'`), 'own subtask');
  await expectErr('a task with subtasks cannot become a subtask', S, upd(parent, `parent_task_id = '${queue}'`), 'cannot become a subtask');
  await expectErr('the parent cannot be finished while a subtask is open', S, upd(parent, `status = 'done'`), 'subtasks first');
  await expectOk('finish the subtask', S, upd(child, `status = 'done'`));
  await expectOk('now the parent can be finished', S, upd(parent, `status = 'done'`));
  await expectErr('no new subtasks on a finished task', S, `insert into ops.task (department, title, parent_task_id) values ('sales','late','${parent}')`, 'open task');

  console.log('History');
  await expectVal('status, assignee, edit and created are all recorded', `select count(distinct kind) >= 4 from ops.task_history where task_id in ('${a}','${c}')`, true);
  await expectVal('a status change records who did it', `select bool_and(actor_id = '${S}') from ops.task_history where task_id='${c}' and kind='status'`, true);
  await expectRows('whoever can see the task can read its history', O, `select id from ops.task_history where task_id='${a}'`, 5);
  await expectRows('...and nobody else can', W, `select id from ops.task_history where task_id='${a}'`, 0);
  await expectErr('history cannot be written by users', S, `insert into ops.task_history (task_id, kind) values ('${a}','created')`, 'row-level security');
  await expectRows('history cannot be rewritten by users', F, `update ops.task_history set kind = 'edited' where task_id = '${a}' returning id`, 0);
  await expectRows('history cannot be deleted by users', F, `delete from ops.task_history where task_id = '${a}' returning id`, 0);

  console.log('Comments');
  await expectOk('the assignee side comments on a task', O, `insert into ops.task_comment (task_id, body) values ('${a}', '  Called, no answer  ')`);
  await expectVal('the comment is trimmed and attributed', `select body = 'Called, no answer' and author_id = '${O}' from ops.task_comment where task_id='${a}'`, true);
  await expectOk('a comment sent with someone else as author is attributed to the caller', S, `insert into ops.task_comment (task_id, author_id, body) values ('${a}', '${F}', 'hi')`);
  await expectVal('...author is S', `select count(*) from ops.task_comment where task_id='${a}' and author_id = '${S}'`, 1);
  await expectErr('a comment cannot be blank', S, `insert into ops.task_comment (task_id, body) values ('${a}', '   ')`, 'task_comment_body_check');
  await expectErr('a person who cannot see the task cannot comment on it', P, `insert into ops.task_comment (task_id, body) values ('${a}', 'hi')`, 'row-level security');
  await expectErr('a viewer cannot comment', V, `insert into ops.task_comment (task_id, body) values ('${a}', 'hi')`, 'row-level security');
  await expectRows('an unrelated department cannot read comments', W, `select id from ops.task_comment where task_id='${a}'`, 0);
  await expectRows('the founder reads comments', F, `select id from ops.task_comment where task_id='${a}'`, 2);
  await expectRows('another member cannot delete a comment', S, `delete from ops.task_comment where task_id='${a}' and author_id='${O}' returning id`, 0);
  await expectRows('an author can delete their own comment', O, `delete from ops.task_comment where task_id='${a}' and author_id='${O}' returning id`, 1);
  await expectRows('the founder can remove any comment', F, `delete from ops.task_comment where task_id='${a}' returning id`, 1);

  console.log('\nTask collaboration (0019)');
  console.log('Start date');
  const sd = await mk('a task with a start date and a deadline', S, 'department, title, assignee_id, start_date, due_date',
    `'sales','Prepare the ZZ proposal','${S}', current_date + 1, current_date + 6`);
  await expectErr('the start date cannot be after the deadline', S, upd(sd, `start_date = current_date + 9`), 'start date cannot be after');
  await expectErr('a new task cannot start after its deadline', S,
    `insert into ops.task (department, title, start_date, due_date) values ('sales','x', current_date + 5, current_date + 2)`, 'start date cannot be after');
  await expectOk('the assignee moves the start date', S, upd(sd, `start_date = current_date + 2`));
  await expectVal('...the change is in the history', `select count(*) from ops.task_history where task_id='${sd}' and kind='start'`, 1);

  console.log('Watchers');
  const wt = await mk('a task created by Sales for Outreach', S, 'department, title, assignee_id', `'outreach','ZZ Call back','${O}'`);
  await expectVal('creator and assignee both watch', `select count(*) from ops.task_watcher where task_id='${wt}'`, 2);
  await expectRows('a workshop member cannot see it yet', T2, `select id from ops.task where id='${wt}'`, 0);
  await expectErr('a workshop member cannot add themselves to a task they cannot see', T2,
    `insert into ops.task_watcher (task_id, staff_id) values ('${wt}','${T2}')`, 'row-level security');
  await expectOk('the creator adds a colleague as a watcher', S, `insert into ops.task_watcher (task_id, staff_id) values ('${wt}','${T2}')`);
  await expectRows('a watcher can now see the task', T2, `select id from ops.task where id='${wt}'`, 1);
  await expectRows('...and its history', T2, `select id from ops.task_history where task_id='${wt}'`, 2);
  await expectRows('a watcher cannot edit the task', T2, upd(wt, `priority = 1`), 0);
  await expectOk('a watcher can stop watching', T2, `delete from ops.task_watcher where task_id='${wt}' and staff_id='${T2}'`);
  await expectRows('...and loses sight of it', T2, `select id from ops.task where id='${wt}'`, 0);
  await expectErr('an assignee cannot add someone else (not a manager)', O,
    `insert into ops.task_watcher (task_id, staff_id) values ('${wt}','${F}')`, 'row-level security');
  await expectErr('a partner cannot be added as a watcher', S, `insert into ops.task_watcher (task_id, staff_id) values ('${wt}','${P}')`, 'partners cannot');
  await db.exec(`update ops.staff set is_active = false where id = '${T2}'`);
  await expectErr('an inactive person cannot be added', S, `insert into ops.task_watcher (task_id, staff_id) values ('${wt}','${T2}')`, 'active team member');
  await db.exec(`update ops.staff set is_active = true where id = '${T2}'`);
  await expectOk('a department lead can add a watcher to a task of their department', W,
    `insert into ops.task_watcher (task_id, staff_id) values ('${ws}','${S}')`);
  await expectVal('added_by is stamped by the database', `select added_by = '${W}' from ops.task_watcher where task_id='${ws}' and staff_id='${S}'`, true);

  console.log('Notifications');
  const nt = await mk('a task to notify about', S, 'department, title, assignee_id', `'outreach','ZZ Send the deck','${O}'`);
  await expectVal('the assignee is told about the new task', `select count(*) from ops.notification where recipient_id='${O}' and task_id='${nt}' and kind='assigned'`, 1);
  await expectVal('...with a readable message', `select message from ops.notification where recipient_id='${O}' and task_id='${nt}'`, 'Sales gave you a task: ZZ Send the deck');
  await expectVal('the person who acted is not told about their own action', `select count(*) from ops.notification where recipient_id='${S}' and task_id='${nt}'`, 0);
  await expectOk('the assignee marks it done', O, upd(nt, `status = 'done'`));
  await expectVal('the creator (a watcher) is told', `select count(*) from ops.notification where recipient_id='${S}' and task_id='${nt}' and kind='status'`, 1);
  await expectOk('the creator changes the deadline', S, upd(nt, `due_date = current_date + 4`));
  await expectVal('the assignee is told the dates changed', `select count(*) from ops.notification where recipient_id='${O}' and task_id='${nt}' and kind='dates'`, 1);
  await expectOk('reassigning tells the new assignee', S, upd(nt, `assignee_id = '${F}'`));
  await expectVal('...the new assignee gets it', `select count(*) from ops.notification where recipient_id='${F}' and task_id='${nt}' and kind='assigned'`, 1);
  await expectVal('...the old assignee is told they were taken off', `select count(*) from ops.notification where recipient_id='${O}' and task_id='${nt}' and message like '%took you off%'`, 1);
  await expectRows('a person reads only their own notifications', S, `select id from ops.notification where recipient_id <> '${S}'`, 0);
  await expectRows('...and the others are visible to their owners', O, `select id from ops.notification where task_id='${nt}'`, 3);
  await expectErr('nobody can write a notification', S, `insert into ops.notification (recipient_id, kind, message) values ('${S}','status','x')`, 'row-level security');
  await expectOk('a person marks their notification read', O, `update ops.notification set read_at = now() where recipient_id='${O}' and task_id='${nt}'`);
  await expectVal('...and it is stamped', `select count(*) from ops.notification where recipient_id='${O}' and task_id='${nt}' and read_at is not null`, 3);
  await expectOk('they cannot rewrite its text (the change is ignored)', O,
    `update ops.notification set message = 'hacked', recipient_id = '${S}' where recipient_id='${O}' and task_id='${nt}'`);
  await expectVal('...the message is intact', `select count(*) from ops.notification where recipient_id='${O}' and message = 'hacked'`, 0);
  await expectRows('another person cannot mark it read', S, `update ops.notification set read_at = now() where recipient_id='${O}' returning id`, 0);
  await expectRows('a person can clear their own notification', O, `delete from ops.notification where recipient_id='${O}' and task_id='${nt}' returning id`, 3);

  console.log('Mentions and comments');
  await expectOk('a comment mentions a colleague and a partner', S,
    `insert into ops.task_comment (task_id, body, mentions) values ('${wt}', 'ZZ please look', array['${T2}','${P}','${S}']::uuid[])`);
  await expectVal('only valid colleagues stay mentioned (not partners, not yourself)',
    `select mentions::text from ops.task_comment where task_id='${wt}' and body='ZZ please look'`, `{${T2}}`);
  await expectVal('the mentioned person is told', `select count(*) from ops.notification where recipient_id='${T2}' and kind='mentioned' and task_id='${wt}'`, 1);
  await expectRows('...and now sees the task', T2, `select id from ops.task where id='${wt}'`, 1);
  await expectVal('the assignee is told about the comment', `select count(*) from ops.notification where recipient_id='${O}' and kind='comment' and task_id='${wt}'`, 1);
  await expectVal('the commenter now watches', `select count(*) from ops.task_watcher where task_id='${wt}' and staff_id='${S}'`, 1);
  await expectOk('a colleague replies without a mention', O, `insert into ops.task_comment (task_id, body) values ('${wt}', 'ZZ done')`);
  await expectVal('the mentioned watcher hears the reply as a comment', `select count(*) from ops.notification where recipient_id='${T2}' and kind='comment' and task_id='${wt}'`, 1);

  console.log('Fixed (recurring) tasks');
  const rec = (uid, cols, vals) => expectOk('define: ' + cols.split(',')[0], uid, `insert into ops.task_recurrence (${cols}) values (${vals}) returning id`);
  await expectErr('a member cannot define a fixed task', S,
    `insert into ops.task_recurrence (title, department, frequency, all_department) values ('x','sales','daily',true)`, 'row-level security');
  await expectErr('a lead cannot define one for another department', W,
    `insert into ops.task_recurrence (title, department, frequency, all_department) values ('x','sales','daily',true)`, 'row-level security');
  await expectErr('someone must receive it', F,
    `insert into ops.task_recurrence (title, department, frequency) values ('x','sales','daily')`, 'whole department or at least one person');
  await expectErr('weekly needs a weekday', F,
    `insert into ops.task_recurrence (title, department, frequency, all_department) values ('x','sales','weekly',true)`, 'task_recurrence_weekly_day');
  await expectErr('monthly needs a day of the month', F,
    `insert into ops.task_recurrence (title, department, frequency, all_department) values ('x','sales','monthly',true)`, 'task_recurrence_monthly_day');
  await expectErr('the end cannot be before the start', F,
    `insert into ops.task_recurrence (title, department, frequency, all_department, starts_on, ends_on) values ('x','sales','daily',true, current_date, current_date - 1)`, 'task_recurrence_dates');
  const r1 = (await rec(W, 'title, department, frequency, all_department, due_after_days, due_time, priority',
    `'  ZZ Daily stand-up notes ', 'workshop', 'daily', true, 0, '18:00', 2`))?.rows[0]?.id;
  const r2 = (await rec(F, 'title, department, frequency, weekday, staff_ids, due_after_days',
    `'ZZ Weekly stock check', 'outreach', 'weekly', extract(isodow from ops.today_ist())::int, array['${O}','${P}','${V}']::uuid[], 2`))?.rows[0]?.id;
  await expectVal('the title is trimmed and the founder is recorded as definer', `select title = 'ZZ Daily stand-up notes' and created_by = '${W}' from ops.task_recurrence where id='${r1}'`, true);
  await expectRows('a lead sees their department templates', W, `select id from ops.task_recurrence where id='${r1}'`, 1);
  await expectRows('a member of another department does not', S, `select id from ops.task_recurrence where id='${r1}'`, 0);

  const nw = Number(await val(`select count(*) from ops.staff where is_active and role not in ('partner','viewer') and 'workshop' = any (departments)`));
  const made = await val(`select ops.run_task_recurrences()`);
  made === nw + 1 ? ok(`automation creates one task for each of the ${nw} workshop people and the 1 picked outreach person`) : bad('automation creates the tasks', `made ${made}, want ${nw + 1}`);
  await expectVal('partners and viewers never get fixed tasks', `select count(*) from ops.task where recurrence_id='${r2}' and assignee_id in ('${P}','${V}')`, 0);
  await expectVal('each task has the schedule of its template',
    `select count(*) from ops.task where recurrence_id='${r1}' and start_date = (now() at time zone 'Asia/Kolkata')::date
       and due_date = start_date and due_time = '18:00' and priority = 2 and accepted_at is not null and template = 'fixed'`, nw);
  await expectVal('the definer is the creator and assigner, not whoever opened the page',
    `select count(*) from ops.task where recurrence_id='${r1}' and created_by='${W}' and assigned_by='${W}'`, nw);
  await expectVal('the history credits the definer', `select count(*) from ops.task_history h join ops.task t on t.id = h.task_id where t.recurrence_id='${r1}' and h.kind='created' and h.actor_id='${W}'`, nw);
  await expectVal('the assignee is told (fixed task)', `select count(*) from ops.notification where recipient_id='${O}' and kind='recurring'`, 1);
  await expectVal('running again makes nothing new', `select ops.run_task_recurrences()`, 0);
  await expectOk('an assignee tries to detach a fixed task from its template', O, `update ops.task set recurrence_id = null where recurrence_id='${r2}' and assignee_id='${O}'`);
  await expectVal('...the link is unchanged', `select count(*) from ops.task where recurrence_id='${r2}'`, 1);
  await expectOk('a lead pauses the template', W, `update ops.task_recurrence set active = false where id='${r1}'`);
  await expectOk('the weekly task can be completed like any task', O, `update ops.task set status = 'done' where recurrence_id='${r2}' and assignee_id='${O}'`);
  await expectOk('the system job can run as a signed-in user (page load)', S, `select ops.run_task_automation()`);
  await expectVal('...and still creates nothing twice', `select count(*) from ops.task where recurrence_id='${r2}'`, 1);
  await expectErr('users cannot call the recurrence job directly', S, `select ops.run_task_recurrences()`, 'permission denied');
  await expectErr('users cannot send notifications directly', S, `select ops.notify('${O}','status',null,null,'x')`, 'permission denied');

  console.log('Reminders');
  const od = await mk('an overdue task', F, 'department, title, assignee_id, due_date', `'sales','ZZ Overdue thing','${S}', (now() at time zone 'Asia/Kolkata')::date - 2`);
  await expectOk('the assignee is also watched by the creator', F, `insert into ops.task_watcher (task_id, staff_id) values ('${od}','${W}') on conflict do nothing`);
  const dt = await mk('a task due today', F, 'department, title, assignee_id, due_date', `'sales','ZZ Due today','${S}', (now() at time zone 'Asia/Kolkata')::date`);
  const sent = await val(`select ops.run_task_reminders()`);
  Number(sent) >= 3 ? ok('reminders were written') : bad('reminders were written', `sent ${sent}`);
  await expectVal('the assignee hears about the overdue task', `select count(*) from ops.notification where recipient_id='${S}' and task_id='${od}' and kind='overdue'`, 1);
  await expectVal('a watcher hears about it too', `select count(*) from ops.notification where recipient_id='${W}' and task_id='${od}' and kind='overdue'`, 1);
  await expectVal('the assignee hears about a task due today', `select count(*) from ops.notification where recipient_id='${S}' and task_id='${dt}' and kind='due_today'`, 1);
  await expectVal('reminders are not repeated', `select ops.run_task_reminders()`, 0);
  await expectOk('moving the deadline allows a fresh reminder later', S, upd(od, `due_date = (now() at time zone 'Asia/Kolkata')::date - 1`));

  console.log('Saved views');
  await expectOk('a member saves a view', S, `insert into ops.task_view (name, query) values ('  My overdue ', 'tab=mine&view=open')`);
  await expectVal('the name is trimmed', `select count(*) from ops.task_view where name = 'My overdue' and owner_id='${S}'`, 1);
  await expectErr('a name is unique per person', S, `insert into ops.task_view (name, query) values ('My overdue', '')`, 'task_view_owner_id_name_key');
  await expectRows('a private view is invisible to others', O, `select id from ops.task_view`, 0);
  await expectOk('a view can be shared', S, `update ops.task_view set shared = true where name = 'My overdue'`);
  await expectRows('...then colleagues see it', O, `select id from ops.task_view`, 1);
  await expectRows('...but cannot change it', O, `update ops.task_view set query = 'x' where name = 'My overdue' returning id`, 0);
  await expectRows('...or delete it', O, `delete from ops.task_view where name = 'My overdue' returning id`, 0);
  await expectRows('a partner never sees shared views', P, `select id from ops.task_view`, 0);
  await expectErr('a viewer-less partner cannot save one', P, `insert into ops.task_view (name) values ('x')`, 'row-level security');
  await expectRows('the owner deletes it', S, `delete from ops.task_view where name = 'My overdue' returning id`, 1);
}
