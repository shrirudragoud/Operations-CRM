// Tasks without a department, categories, and one task per person for several assignees (0028).
export default async function taskGroupTests(t) {
  const { run, ok, bad, expectOk, expectErr, expectVal, val, F, S, W, T2, P, V, O } = t;
  console.log('\nOptional department, categories and task groups (0028)');
  const rows = async (uid, sql) => (await run(uid, sql)).rows.length;
  const expectRows = async (name, uid, sql, want) => {
    const n = await rows(uid, sql);
    n === want ? ok(name) : bad(name, `${n} rows, want ${want}`);
  };
  const mk = async (name, uid, cols, vals) => (await expectOk(name, uid, `insert into ops.task (${cols}) values (${vals}) returning id`))?.rows[0]?.id;
  const upd = (id, set) => `update ops.task set ${set} where id = '${id}' returning id`;
  const today = `(now() at time zone 'Asia/Kolkata')::date`;

  console.log('No department');
  const nd = await mk('a Sales member gives T2 a task with no department', S, 'title, assignee_id, due_date', `'ZZ No dept', '${T2}', ${today} + 3`);
  await expectVal('...it has no department and no category', `select department is null and category is null from ops.task where id='${nd}'`, true);
  await expectRows('the assignee sees it', T2, `select id from ops.task where id='${nd}'`, 1);
  await expectRows('the creator sees it', S, `select id from ops.task where id='${nd}'`, 1);
  await expectRows('the founder sees it', F, `select id from ops.task where id='${nd}'`, 1);
  await expectRows('a lead of the assignee team sees it', W, `select id from ops.task where id='${nd}'`, 1);
  await expectRows('a lead of another team does not', O, `select id from ops.task where id='${nd}'`, 0);
  await expectRows('a colleague in neither team does not', V, `select id from ops.task where id='${nd}'`, 0);
  await expectOk('the lead of the assignee team can edit its details', W, upd(nd, `title = 'ZZ No dept (lead edit)'`));
  await expectRows('a member of another team cannot edit it', O, upd(nd, `title = 'x'`), 0);
  await expectRows('the assignee can still change their own status', T2, upd(nd, `status = 'doing'`), 1);
  await expectErr('the assignee cannot rename it', T2, upd(nd, `title = 'mine now'`), 'can edit its details');
  await expectOk('the creator gives it a department later', S, upd(nd, `department = 'workshop'`));
  await expectVal('...the change is in the history', `select count(*) from ops.task_history where task_id='${nd}' and kind='department' and from_value is null and to_value='workshop'`, 1);
  await expectOk('...and takes it away again', S, upd(nd, `department = null`));
  await expectVal('...also in the history', `select count(*) from ops.task_history where task_id='${nd}' and kind='department' and to_value is null`, 1);
  const lone = await mk('a task with no department and no person', S, 'title', `'ZZ Nobody'`);
  await expectRows('...only its creator and the founder see it', S, `select id from ops.task where id='${lone}'`, 1);
  await expectRows('...no one else does', W, `select id from ops.task where id='${lone}'`, 0);
  await expectRows('...the founder does', F, `select id from ops.task where id='${lone}'`, 1);
  await expectRows('a lead can delete a team task with no department', W, `delete from ops.task where id='${nd}' returning id`, 1);

  console.log('Categories');
  const cat = await mk('an Internal task', S, 'title, category, assignee_id', `'ZZ Office tidy', 'internal', '${O}'`);
  await expectVal('...is saved with its category', `select category from ops.task where id='${cat}'`, 'internal');
  await mk('an Others task', S, 'title, category', `'ZZ Misc', 'other'`);
  await expectErr('an unknown category is refused', S, `insert into ops.task (title, category) values ('x','sales')`, 'task_category_check');
  await expectErr('the assignee cannot change the category', O, upd(cat, `category = 'other'`), 'can edit its details');
  await expectOk('the creator can', S, upd(cat, `category = 'other'`));

  console.log('Several assignees');
  const mkGroup = (uid, people, extra = '') =>
    run(uid, `select ops.create_task_group(title => 'ZZ Group job', description => 'shared', assignees => array[${people.map((p) => `'${p}'`).join(',')}]::uuid[], priority => 2, due_date => ${today} + 5 ${extra})`);
  const g = await expectOk('a lead creates one task for three people with no department', W, `select ops.create_task_group(title => 'ZZ Group job', description => 'shared', assignees => array['${T2}','${O}','${S}']::uuid[], priority => 2, due_date => ${today} + 5)`);
  const ids = g?.rows[0] ? Object.values(g.rows[0])[0] : [];
  ids?.length === 3 ? ok('...three tasks come back') : bad('...three tasks come back', JSON.stringify(ids));
  const grp = await val(`select group_id from ops.task where id='${ids[0]}'`);
  await expectVal('...they share one group', `select count(distinct group_id) = 1 and bool_and(group_id is not null) from ops.task where id = any (array['${ids.join("','")}']::uuid[])`, true);
  await expectVal('...each has its own assignee, no department, and the shared details',
    `select count(distinct assignee_id) = 3 and bool_and(department is null and title = 'ZZ Group job' and priority = 2 and created_by = '${W}' and assigned_by = '${W}') from ops.task where group_id='${grp}'`, true);
  await expectVal('...each person was told once', `select count(*) from ops.notification where kind='assigned' and task_id = any (array['${ids.join("','")}']::uuid[])`, 3);
  await expectVal('...history says created and assigned for each', `select count(*) from ops.task_history where task_id = any (array['${ids.join("','")}']::uuid[]) and kind in ('created','assigned')`, 6);
  await expectRows('each person sees their own', O, `select id from ops.task where group_id='${grp}'`, 1);
  await expectRows('the creator sees all three', W, `select id from ops.task where group_id='${grp}'`, 3);
  await expectRows('the founder sees all three', F, `select id from ops.task where group_id='${grp}'`, 3);
  await expectErr('one person who cannot be given tasks cancels the whole group', W,
    `select ops.create_task_group(title => 'ZZ Bad group', assignees => array['${T2}','${V}']::uuid[])`, 'viewer');
  await expectVal('...nothing was created', `select count(*) from ops.task where title = 'ZZ Bad group'`, 0);
  await expectErr('a group needs a title', W, `select ops.create_task_group(title => '  ', assignees => array['${T2}','${O}']::uuid[])`, 'title');
  await expectErr('a group has at most 20 people', W,
    `select ops.create_task_group(title => 'ZZ big', assignees => array(select gen_random_uuid() from generate_series(1, 21)))`, 'at most 20');
  await expectErr('a viewer cannot create one', V, `select ops.create_task_group(title => 'ZZ v', assignees => array['${T2}','${O}']::uuid[])`, 'cannot');
  await expectErr('a partner cannot create one', P, `select ops.create_task_group(title => 'ZZ p', assignees => array['${T2}','${O}']::uuid[])`, 'cannot');
  const dup = await expectOk('the same person twice is one task', W, `select ops.create_task_group(title => 'ZZ dup', assignees => array['${T2}','${T2}','${O}']::uuid[])`);
  const dupIds = dup?.rows[0] ? Object.values(dup.rows[0])[0] : [];
  dupIds?.length === 2 ? ok('...two tasks') : bad('...two tasks', JSON.stringify(dupIds));
  const one = await expectOk('one person gives an ordinary task with no group', W, `select ops.create_task_group(title => 'ZZ solo', assignees => array['${T2}']::uuid[])`);
  const soloId = one?.rows[0] ? Object.values(one.rows[0])[0][0] : null;
  await expectVal('...no group id', `select group_id is null from ops.task where id='${soloId}'`, true);
  await expectOk('a direct insert with a made-up group link', W, `insert into ops.task (title, group_id) values ('ZZ forged', gen_random_uuid()) returning id`);
  const forged = await val(`select count(*) from ops.task where title = 'ZZ forged' and group_id is not null`);
  Number(forged) === 0 ? ok('a direct insert cannot link a task to a group') : bad('a direct insert cannot link a task to a group', `${forged}`);

  console.log('Each person finishes on their own');
  const [tA, tB, tC] = await Promise.all(['T2', 'O', 'S'].map(async (k) => val(`select id from ops.task where group_id='${grp}' and assignee_id='${{ T2, O, S }[k]}'`)));
  await expectOk('one person finishes', T2, upd(tA, `status = 'done'`));
  await expectVal('...the others are untouched', `select count(*) from ops.task where group_id='${grp}' and status = 'todo'`, 2);
  await expectErr('an assignee cannot change shared details', O, upd(tB, `priority = 1`).replace('priority = 1', `title = 'x'`), 'can edit its details');
  await expectErr('an assignee cannot change the group for everyone', O, `select ops.update_task_group('${tB}', title => 'ZZ changed')`, 'created');
  await expectOk('the creator changes the shared details for everyone', W, `select ops.update_task_group('${tB}', title => 'ZZ Group job v2', priority => 1)`);
  await expectVal('...open siblings follow', `select count(*) from ops.task where group_id='${grp}' and title = 'ZZ Group job v2' and priority = 1`, 2);
  await expectVal('...a finished one keeps its record', `select title from ops.task where id='${tA}'`, 'ZZ Group job');
  await expectErr('cancelling the whole group needs a reason', W, `select ops.cancel_task_group('${tB}', '')`, 'why');
  await expectErr('an assignee cannot cancel the group', O, `select ops.cancel_task_group('${tB}', 'no')`, 'created');
  await expectOk('the creator cancels the open ones', W, `select ops.cancel_task_group('${tB}', 'ZZ client postponed')`);
  await expectVal('...the finished one stays done, the others are cancelled',
    `select string_agg(status, ',' order by status) from ops.task where group_id='${grp}'`, 'cancelled,cancelled,done');
  await expectVal('...with the reason kept', `select bool_and(cancel_reason = 'ZZ client postponed') from ops.task where group_id='${grp}' and status = 'cancelled'`, true);

  console.log('Timeliness and the nightly snapshot with no department');
  await expectVal('the timeliness view carries tasks with no department',
    `select count(*) from ops.v_task_timeliness where task_id = '${tA}' and department is null and bucket is not null`, 1);
  await val(`select ops.write_kpi_snapshot()`);
  await expectVal('the snapshot writes a row for open work with no department',
    `select count(*) >= 1 from ops.backlog_snapshot where snapshot_date = ${today} and department is null`, true);
  const before = await val(`select count(*) from ops.backlog_snapshot where snapshot_date = ${today}`);
  await val(`select ops.write_kpi_snapshot()`);
  await expectVal('...running it again does not duplicate rows', `select count(*) = ${before} from ops.backlog_snapshot where snapshot_date = ${today}`, true);
  await expectRows('a lead sees the no-department snapshot rows of their team', W, `select 1 from ops.backlog_snapshot where snapshot_date = ${today} and department is null and assignee_id = '${T2}'`, 1);
}
