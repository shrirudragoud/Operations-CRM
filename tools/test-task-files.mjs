// Files on tasks: register, remove, restore, purge, counters and the Storage rules (0039).
// Called from test-migrations.mjs.
import { randomUUID } from 'node:crypto';

export default async function taskFileTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, val, F, S, W, T2, P, V, O } = t;
  console.log('\nTask files (0039)');

  const rows = async (uid, sql) => (await run(uid, sql)).rows;
  const expectRows = async (name, uid, sql, want) => {
    try { const n = (await rows(uid, sql)).length; n === want ? ok(name) : bad(name, `${n} rows, want ${want}`); }
    catch (e) { bad(name, e.message.split('\n')[0]); }
  };
  const asVal = async (name, uid, sql, want) => {
    try { const got = (await run(uid, sql)).rows[0]?.v; String(got) === String(want) ? ok(name) : bad(name, `got ${got}, want ${want}`); }
    catch (e) { bad(name, e.message.split('\n')[0]); }
  };
  const path = (task, name = 'photo.png') => `${task}/${randomUUID()}/${name}`;
  const PNG = 'image/png';
  const PDF = 'application/pdf';
  const reg = (task, p, { name = 'photo.png', mime = PNG, size = 1000, comment = null, inline = false } = {}) =>
    `select ops.register_task_attachment('${task}', '${p}', '${name}', '${mime}', ${size}, ${comment ? `'${comment}'` : 'null'}, ${inline}) as v`;

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

  // ---------------------------------------------------------------- setup
  const mk = async (name, uid, dept, assignee) =>
    (await expectOk(name, uid, `insert into ops.task (title, department, assignee_id) values ('ZZ Files ${name.slice(0, 20)}', ${dept ? `'${dept}'` : 'null'}, ${assignee ? `'${assignee}'` : 'null'}) returning id`))?.rows[0]?.id;
  const X = await mk('a workshop task for a trainer', W, 'workshop', T2);
  const Y = await mk('a second workshop task for the cap', W, 'workshop', T2);
  const SALES = await mk('a sales task the viewer can read', S, 'sales', S);
  const child = (await expectOk('the lead gives an outreach member a subtask of it', W,
    `insert into ops.task (title, parent_task_id, assignee_id) values ('ZZ Files subtask', '${X}', '${O}') returning id`))?.rows[0]?.id;
  await db.exec(`insert into ops.task_watcher (task_id, staff_id) values ('${Y}', '${O}')`);

  // ---------------------------------------------------------------- registering
  console.log('Registering a file');
  const p1 = path(X);
  const A1 = (await expectOk('the assignee registers an image on the task', T2, reg(X, p1)))?.rows[0]?.v;
  await expectVal('...the row is an image, not inline, uploaded by them', `select kind = 'image' and not is_inline and uploaded_by = '${T2}' and size_bytes = 1000 and comment_id is null from ops.task_attachment where id = '${A1}'`, true);
  await expectVal('...the task counts one file', `select attachment_count from ops.task where id = '${X}'`, 1);
  await expectVal('...the history says a file was added', `select count(*) from ops.task_history where task_id = '${X}' and kind = 'file_added' and to_value = 'photo.png' and actor_id = '${T2}'`, 1);
  const A2 = (await expectOk('the department lead (and creator) registers a PDF', W, reg(X, path(X, 'plan.pdf'), { name: 'plan.pdf', mime: PDF, size: 2048 })))?.rows[0]?.v;
  await expectVal('...a PDF is a document', `select kind from ops.task_attachment where id = '${A2}'`, 'document');
  await expectOk('the founder registers a Word file', F, reg(X, path(X, 'brief.docx'), { name: 'brief.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  await expectOk('an inline image is allowed', T2, reg(X, path(X, 'inline.webp'), { name: 'inline.webp', mime: 'image/webp', inline: true }));
  await expectVal('...and is marked inline', `select count(*) from ops.task_attachment where task_id = '${X}' and is_inline`, 1);
  for (const [name, mime] of [['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], ['deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
                              ['data.csv', 'text/csv'], ['notes.txt', 'text/plain'], ['readme.md', 'text/markdown'], ['anim.gif', 'image/gif'], ['pic.jpg', 'image/jpeg']]) {
    await expectOk(`a ${name.split('.')[1]} file is allowed`, T2, reg(X, path(X, name), { name, mime }));
  }
  await expectVal('...the counter follows every file', `select attachment_count from ops.task where id = '${X}'`, 11);

  console.log('What is refused');
  await expectErr('a vector image is refused', T2, reg(X, path(X, 'logo.svg'), { name: 'logo.svg', mime: 'image/svg+xml' }), 'not allowed');
  await expectErr('a zip is refused', T2, reg(X, path(X, 'a.zip'), { name: 'a.zip', mime: 'application/zip' }), 'not allowed');
  await expectErr('a video is refused', T2, reg(X, path(X, 'a.mp4'), { name: 'a.mp4', mime: 'video/mp4' }), 'not allowed');
  await expectErr('html is refused', T2, reg(X, path(X, 'a.html'), { name: 'a.html', mime: 'text/html' }), 'not allowed');
  await expectErr('an empty file is refused', T2, reg(X, path(X), { size: 0 }), '1 byte and 25 MB');
  await expectErr('a file over 25 MB is refused', T2, reg(X, path(X), { size: 26214401 }), '1 byte and 25 MB');
  await expectOk('exactly 25 MB is fine', T2, reg(X, path(X), { size: 26214400 }));
  await expectErr('an inline PDF is refused', T2, reg(X, path(X, 'a.pdf'), { name: 'a.pdf', mime: PDF, inline: true }), 'Only an image');
  await expectErr('a blank name is refused', T2, reg(X, path(X), { name: '   ' }), 'file name');
  await expectErr('a name over 160 characters is refused', T2, reg(X, path(X), { name: 'a'.repeat(161) }), 'file name');
  await expectErr('a path in another task\'s folder is refused', T2, reg(X, path(Y)), 'own folder');
  await expectErr('a path with no folder is refused', T2, reg(X, `${X}/photo.png`), 'own folder');
  await expectErr('a path with a dot-dot name is refused', T2, reg(X, `${X}/${randomUUID()}/..`), 'own folder');
  await expectErr('a path with a space is refused', T2, reg(X, `${X}/${randomUUID()}/my photo.png`), 'own folder');
  await expectErr('a path with an upper-case task id is refused', T2, reg(X, path(X).replace(/^[^/]+/, X.toUpperCase())), 'own folder');
  await expectErr('the same path twice is refused', T2, reg(X, p1), 'duplicate key');
  await expectErr('an unknown task is reported', T2, reg(randomUUID(), path(randomUUID())), 'not found');

  console.log('Who may register');
  await expectErr('a sales member who cannot see the task', S, reg(X, path(X)), 'not found');
  await expectErr('the holder of a subtask cannot add files to the parent', O, reg(X, path(X)), 'not found');
  await expectErr('a partner cannot', P, reg(X, path(X)), 'not found');
  await expectErr('a viewer cannot on a task they can read', V, reg(SALES, path(SALES)), 'do not have access');
  await expectErr('a watcher who may not edit the task cannot add to the task', O, reg(Y, path(Y)), 'cannot add files');
  await expectErr('a signed-out call is refused', null, reg(X, path(X)), 'Sign in');

  console.log('Files on a comment');
  const cm = (await expectOk('a watcher comments on the task', O, `insert into ops.task_comment (task_id, body) values ('${Y}', 'see attached') returning id`))?.rows[0]?.id;
  const cm2 = (await expectOk('the assignee comments too', T2, `insert into ops.task_comment (task_id, body) values ('${Y}', 'ok') returning id`))?.rows[0]?.id;
  await expectVal('...the task counts two comments', `select comment_count from ops.task where id = '${Y}'`, 2);
  const CA = (await expectOk('the watcher attaches a file to their own comment', O, reg(Y, path(Y), { comment: cm })))?.rows[0]?.v;
  await expectVal('...it is tied to the comment', `select comment_id from ops.task_attachment where id = '${CA}'`, cm);
  await expectErr('...but not to somebody else\'s comment', O, reg(Y, path(Y), { comment: cm2 }), 'your own comment');
  await expectErr('...nor to a comment on another task', T2, reg(X, path(X), { comment: cm2 }), 'your own comment');
  await expectOk('the assignee can still attach to their own comment', T2, reg(Y, path(Y), { comment: cm2 }));
  await expectOk('deleting a comment leaves its file on the task', null, `delete from ops.task_comment where id = '${cm}'`);
  await expectVal('...the file is still there, with no comment', `select comment_id is null from ops.task_attachment where id = '${CA}'`, true);
  await expectVal('...and the comment counter dropped', `select comment_count from ops.task where id = '${Y}'`, 1);

  console.log('Up to 100 files per task');
  const Z = await mk('a third workshop task to fill', W, 'workshop', T2);
  await db.exec(`insert into ops.task_attachment (task_id, path, name, mime, size_bytes, kind)
                 select '${Z}', '${Z}/' || gen_random_uuid() || '/f' || g || '.png', 'f' || g, 'image/png', 10, 'image' from generate_series(1, 99) g`);
  await expectVal('99 files sit on it', `select attachment_count from ops.task where id = '${Z}'`, 99);
  await expectOk('the hundredth is fine', T2, reg(Z, path(Z)));
  await expectErr('the 101st is refused', T2, reg(Z, path(Z)), 'at most 100');

  // ---------------------------------------------------------------- reading
  console.log('Who sees the files');
  await expectRows('the assignee sees them all', T2, `select id from ops.task_attachment where task_id = '${X}'`, 12);
  await expectRows('the creating lead sees them', W, `select id from ops.task_attachment where task_id = '${X}'`, 12);
  await expectRows('the founder sees them', F, `select id from ops.task_attachment where task_id = '${X}'`, 12);
  await expectRows('a sales member sees none', S, `select id from ops.task_attachment where task_id = '${X}'`, 0);
  await expectRows('a viewer sees none of another team\'s', V, `select id from ops.task_attachment where task_id = '${X}'`, 0);
  await expectRows('a partner sees none', P, `select id from ops.task_attachment where task_id = '${X}'`, 0);
  await expectRows('the holder of a subtask sees none of the parent\'s (it can read the task, not its files)', O, `select id from ops.task_attachment where task_id = '${X}'`, 0);
  await expectRows('...though it can still read the parent task itself', O, `select id from ops.task where id = '${X}'`, 1);
  await expectRows('a watcher sees the files of the task they watch', O, `select id from ops.task_attachment where task_id = '${Y}'`, 2);

  console.log('Files are written only through the functions');
  await expectErr('nobody can insert a row directly', T2, `insert into ops.task_attachment (task_id, path, name, mime, size_bytes, kind) values ('${X}', '${path(X)}', 'a', 'image/png', 1, 'image')`, 'row-level security');
  await expectErr('not even the founder', F, `insert into ops.task_attachment (task_id, path, name, mime, size_bytes, kind) values ('${X}', '${path(X)}', 'a', 'image/png', 1, 'image')`, 'row-level security');
  await expectRows('nobody can change a row directly', T2, `update ops.task_attachment set name = 'x' where id = '${A1}' returning id`, 0);
  await expectRows('nobody can delete a row directly', W, `delete from ops.task_attachment where id = '${A1}' returning id`, 0);
  await expectErr('the table refuses a file of the wrong shape even for the owner', null, `insert into ops.task_attachment (task_id, path, name, mime, size_bytes, kind) values ('${X}', '${path(X)}', 'a', 'image/svg+xml', 1, 'image')`, 'violates check');
  await expectErr('...a kind that does not match the type', null, `insert into ops.task_attachment (task_id, path, name, mime, size_bytes, kind) values ('${X}', '${path(X)}', 'a', 'application/pdf', 1, 'image')`, 'violates check');
  await expectErr('...a size over 25 MB', null, `insert into ops.task_attachment (task_id, path, name, mime, size_bytes, kind) values ('${X}', '${path(X)}', 'a', 'image/png', 26214401, 'image')`, 'violates check');

  // ---------------------------------------------------------------- removing and restoring
  console.log('Removing and restoring');
  await expectErr('a watcher who did not upload it cannot remove it', O, `select ops.remove_task_attachment('${A2}')`, 'not found');
  await expectOk('the uploader removes their file', T2, `select ops.remove_task_attachment('${A1}')`);
  await expectVal('...it is marked removed, by them', `select deleted_at is not null and deleted_by = '${T2}' from ops.task_attachment where id = '${A1}'`, true);
  await expectVal('...the counter dropped', `select attachment_count from ops.task where id = '${X}'`, 11);
  await expectVal('...the history says so', `select count(*) from ops.task_history where task_id = '${X}' and kind = 'file_removed' and from_value = 'photo.png'`, 1);
  await expectErr('removing it twice is refused', T2, `select ops.remove_task_attachment('${A1}')`, 'already removed');
  await expectRows('the uploader still sees the removed file', T2, `select id from ops.task_attachment where id = '${A1}'`, 1);
  await expectRows('so does an editor of the task', W, `select id from ops.task_attachment where id = '${A1}'`, 1);
  await expectOk('an editor who did not upload it can remove another file', W, `select ops.remove_task_attachment('${A2}')`);
  await expectVal('...the counter followed', `select attachment_count from ops.task where id = '${X}'`, 10);
  const CB = (await expectOk('a watcher uploads to their comment', O, reg(Y, path(Y, 'w.png'), { comment: (await run(O, `insert into ops.task_comment (task_id, body) values ('${Y}', 'again') returning id`)).rows[0].id })))?.rows[0]?.v;
  await expectOk('the watcher removes their own file', O, `select ops.remove_task_attachment('${CB}')`);
  await expectRows('...a removed file is hidden from a watcher who did not upload it', O, `select id from ops.task_attachment where id = '${A1}'`, 0);
  await expectErr('a watcher who did not upload it cannot restore it', O, `select ops.restore_task_attachment('${A1}')`, 'not found');
  await expectOk('the uploader restores their own file', T2, `select ops.restore_task_attachment('${A1}')`);
  await expectVal('...it is back and counted', `select deleted_at is null and deleted_by is null from ops.task_attachment where id = '${A1}'`, true);
  await expectVal('...the counter followed', `select attachment_count from ops.task where id = '${X}'`, 11);
  await expectVal('...the history says restored', `select count(*) from ops.task_history where task_id = '${X}' and kind = 'file_restored'`, 1);
  await expectErr('restoring a file that is not removed is refused', T2, `select ops.restore_task_attachment('${A1}')`, 'not removed');
  await expectErr('a stranger cannot remove', S, `select ops.remove_task_attachment('${A1}')`, 'not found');
  await expectErr('a viewer cannot remove', V, `select ops.remove_task_attachment('${A1}')`, 'not found');
  await expectErr('an unknown file is reported', T2, `select ops.remove_task_attachment(gen_random_uuid())`, 'not found');
  await expectOk('an editor removes one more from the full task', W, `select ops.remove_task_attachment((select id from ops.task_attachment where task_id = '${Z}' limit 1))`);
  await expectOk('...and a new one takes the place', T2, reg(Z, path(Z)));
  await expectErr('...so restoring the removed one now is refused', W, `select ops.restore_task_attachment((select id from ops.task_attachment where task_id = '${Z}' and deleted_at is not null limit 1))`, 'at most 100');

  // ---------------------------------------------------------------- purge
  console.log('Purging');
  await expectErr('a signed-in user cannot purge', F, `select * from ops.purge_task_attachments(0)`, 'permission denied');
  await expectErr('...nor acknowledge', F, `select ops.ack_task_file_orphans(array['x'])`, 'permission denied');
  await expectRows('a signed-in user sees no orphan paths', W, `select * from ops.task_file_orphan`, 0);
  await expectOk('the scheduled job purges with 30 days: nothing is old enough', null, `select * from ops.purge_task_attachments(30)`);
  await expectVal('...the removed files are still there', `select count(*) from ops.task_attachment where deleted_at is not null`, 3);
  await db.exec(`update ops.task_attachment set deleted_at = now() - interval '31 days' where id = '${A2}'`);
  const purged = await expectOk('the job purges after 30 days', null, `select * from ops.purge_task_attachments(30)`);
  const gone = purged?.rows.map((r) => r.purge_task_attachments);
  gone?.length === 1 && gone[0].startsWith(X + '/') ? ok('...it returns the one path to delete from Storage') : bad('...it returns the one path to delete from Storage', JSON.stringify(gone));
  await expectVal('...that row is gone and the others stay', `select count(*) from ops.task_attachment where id = '${A2}'`, 0);
  await expectRows('the founder can read the waiting paths', F, `select * from ops.task_file_orphan`, 1);
  await expectVal('...the job acknowledges them', `select ops.ack_task_file_orphans(array['${gone?.[0]}'])`, 1);
  await expectVal('...and the list is empty', `select count(*) from ops.task_file_orphan`, 0);
  await expectErr('a negative number of days is refused', null, `select * from ops.purge_task_attachments(-1)`, 'number of days');
  await expectOk('deleting a task takes its files with it', F, `delete from ops.task where id = '${Z}'`);
  await expectVal('...the file rows are gone', `select count(*) from ops.task_attachment where task_id = '${Z}'`, 0);
  await expectVal('...and their paths wait to be cleaned from Storage', `select count(*) from ops.task_file_orphan where left(path, 36) = '${Z}'`, 101);
  await db.exec(`delete from ops.task_file_orphan`);

  // ---------------------------------------------------------------- storage rules
  console.log('Storage rules');
  const sobj = async (name, uid, task, mode, want, p = path(task)) =>
    asVal(name, uid, `select ops.task_file_object_ok('${p}', '${mode}') as v`, want);
  await sobj('the assignee may upload into the task\'s folder', T2, X, 'write', true);
  await sobj('the lead may upload', W, X, 'write', true);
  await sobj('a watcher may upload (to comment on it)', O, Y, 'write', true);
  await sobj('a sales member may not', S, X, 'write', false);
  await sobj('the holder of a subtask may not', O, X, 'write', false);
  await sobj('a viewer may not even on a task they read', V, SALES, 'write', false);
  await sobj('a partner may not', P, X, 'write', false);
  await sobj('a made-up folder is refused', T2, X, 'write', false, `${X}/photo.png`);
  await sobj('another task id as the folder is refused', S, X, 'write', false, path(X));
  await sobj('an odd mode is refused', T2, X, 'delete_all', false);
  await sobj('the assignee may read', T2, X, 'read', true);
  await sobj('a sales member may not read', S, X, 'read', false);
  await sobj('the holder of a subtask may not read the parent\'s files', O, X, 'read', false);
  await sobj('a viewer may not read another team\'s file', V, X, 'read', false);
  const regd = (await run(T2, `select path from ops.task_attachment where id = '${A1}'`)).rows[0].path;
  await sobj('a registered file\'s object cannot be deleted from the browser', T2, X, 'delete', false, regd);
  await sobj('an unregistered object can be (a failed check)', T2, X, 'delete', true);
  await sobj('...but not by a stranger', S, X, 'delete', false);
  await expectOk('the uploader removes a file', T2, `select ops.remove_task_attachment('${A1}')`);
  const wpath = (await run(T2, `select path from ops.task_attachment where id = '${A1}'`)).rows[0].path;
  await db.exec(`insert into ops.task_watcher (task_id, staff_id) values ('${X}', '${O}') on conflict do nothing`);
  await sobj('a watcher can read the objects of a task they watch', O, X, 'read', true, (await run(F, `select path from ops.task_attachment where task_id = '${X}' and deleted_at is null limit 1`)).rows[0].path);
  await sobj('...but not the object of a removed file', O, X, 'read', false, wpath);
  await sobj('the uploader can still read a removed file\'s object', T2, X, 'read', true, wpath);
  await sobj('an editor can too', W, X, 'read', true, wpath);

  console.log('Counters');
  const C = await mk('a task to count on', W, 'workshop', T2);
  await expectVal('a new task has no files and no comments', `select attachment_count = 0 and comment_count = 0 from ops.task where id = '${C}'`, true);
  const c1 = (await run(T2, `insert into ops.task_comment (task_id, body) values ('${C}', 'one') returning id`)).rows[0].id;
  await run(T2, `insert into ops.task_comment (task_id, body) values ('${C}', 'two') returning id`);
  await expectVal('two comments are counted', `select comment_count from ops.task where id = '${C}'`, 2);
  await expectOk('a comment is deleted', T2, `delete from ops.task_comment where id = '${c1}'`);
  await expectVal('...and the count follows', `select comment_count from ops.task where id = '${C}'`, 1);
  await expectVal('adding a file does not change the task\'s status or title', `select status = 'todo' and title like 'ZZ Files%' from ops.task where id = '${C}'`, true);

  console.log('Storage clean-up (0041)');
  await expectErr('a member cannot list stray objects', T2, `select * from ops.list_unregistered_task_objects()`, 'permission denied');
  await expectErr('a founder cannot either (service role only)', F, `select * from ops.list_unregistered_task_objects()`, 'permission denied');
  await expectErr('...nor ask which paths are deletable', F, `select * from ops.task_files_deletable(array['x'])`, 'permission denied');
  await expectErr('a member cannot ask which paths are deletable', T2, `select * from ops.task_files_deletable(array['x'])`, 'permission denied');
  await expectOk('with no Storage there is nothing to list', null, `select * from ops.list_unregistered_task_objects()`);
  await expectErr('uploads younger than an hour cannot be asked for', null, `select * from ops.list_unregistered_task_objects(interval '10 minutes')`, 'younger than an hour');
  await expectErr('the list size is bounded', null, `select * from ops.list_unregistered_task_objects(interval '24 hours', 5000)`, 'between 1 and 1000');
  const live = (await run(T2, `select path from ops.task_attachment where task_id = '${X}' and deleted_at is null limit 1`)).rows[0].path;
  const stray = path(X, 'stray.png');
  const fresh = path(X, 'fresh.png');
  const queued = path(X, 'queued.png');
  await db.exec(`
    create schema if not exists storage;
    create table storage.objects (bucket_id text, name text, created_at timestamptz default now(), metadata jsonb);
    insert into storage.objects (bucket_id, name, created_at) values
      ('task-files', '${live}', now() - interval '3 days'),
      ('task-files', '${stray}', now() - interval '3 days'),
      ('task-files', '${queued}', now() - interval '3 days'),
      ('task-files', '${fresh}', now() - interval '1 hour'),
      ('other', '${path(X, 'elsewhere.png')}', now() - interval '3 days');
    insert into ops.task_file_orphan (path) values ('${queued}');`);
  const listed = (await expectOk('the job lists stray objects', null, `select * from ops.list_unregistered_task_objects(interval '24 hours')`))?.rows.map((r) => r.list_unregistered_task_objects);
  JSON.stringify(listed) === JSON.stringify([stray]) ? ok('...only the old, unregistered, unqueued one in this bucket') : bad('...only the old, unregistered, unqueued one in this bucket', JSON.stringify(listed));
  await expectVal('...a file that is only soft-removed still counts as registered', `select count(*) from ops.list_unregistered_task_objects(interval '24 hours') p where p = '${wpath}'`, 0);
  const safe = (await expectOk('the job asks which paths it may delete', null, `select * from ops.task_files_deletable(array['${live}', '${stray}', '${wpath}'])`))?.rows.map((r) => r.task_files_deletable);
  JSON.stringify(safe) === JSON.stringify([stray]) ? ok('...a live or soft-removed file is never deletable') : bad('...a live or soft-removed file is never deletable', JSON.stringify(safe));
  await expectVal('an empty list is fine', `select count(*) from ops.task_files_deletable(null)`, 0);
  await db.exec(`drop schema storage cascade; delete from ops.task_file_orphan;`);

  console.log('Grants');
  await expectErr('a member cannot call the purge directly', T2, `select * from ops.purge_task_attachments(0)`, 'permission denied');
  await expectVal('the counters exist on every task', `select count(*) from ops.task where attachment_count < 0 or comment_count < 0`, 0);
}
