// Core-complete checks (0013): trainer picker, CSV import, search index, job log, DPDP erasure.
export default async function coreTests(t) {
  const { db, run, ok, bad, msg, expectOk, expectErr, expectVal, val, F, S, W, T2, P, V, O, ev2 } = t;
  const rows = async (uid, sql) => (await run(uid, sql)).rows;

  console.log('\nTrainer picker (available_trainers)');
  // ev2 is scheduled with lead T2 at now()+11d..+13d (see the event rules above)
  const win = `now() + interval '12 days', now() + interval '12 days 1 hour'`;
  {
    const r = await rows(W, `select staff_id, full_name, is_free from ops.available_trainers(${win}) order by full_name`);
    const byName = Object.fromEntries(r.map((x) => [x.full_name, x.is_free]));
    byName['Trainer Two'] === false ? ok('a booked trainer is shown as busy') : bad('a booked trainer is shown as busy', JSON.stringify(r));
    byName['Workshop Lead'] === true ? ok('a certified free trainer is shown as free') : bad('a certified free trainer is shown as free', JSON.stringify(r));
    byName['Founder'] === true ? ok('the founder is always eligible') : bad('the founder is always eligible', JSON.stringify(r));
    !('Sales' in byName) && !('Partner' in byName) && !('Viewer' in byName) && !('Outreach' in byName)
      ? ok('uncertified staff and partners are never offered') : bad('uncertified staff and partners are never offered', JSON.stringify(r));
  }
  {
    const r = await rows(W, `select is_free from ops.available_trainers(${win}, '${ev2}') where full_name = 'Trainer Two'`);
    r[0]?.is_free === true ? ok('excluding an event frees its own trainer (re-scheduling)') : bad('excluding an event frees its own trainer', JSON.stringify(r));
  }
  await expectErr('only Workshop can look up availability (sales)', S, `select * from ops.available_trainers(${win})`, 'only workshop');
  await expectErr('a partner cannot look up availability', P, `select * from ops.available_trainers(${win})`, 'only workshop');
  await expectErr('an inverted window is rejected', W, `select * from ops.available_trainers(now() + interval '2 days', now() + interval '1 day')`, 'valid start and end');

  console.log('\nCSV import (import_institutions)');
  const good = `[{"name":"  Import College A ","kind":"Engineering_College","city":"Satara","district":"Satara"},
                  {"name":"Import School B","kind":"school","city":"Karad","owner_email":"s@x.in"}]`;
  {
    const r = (await run(O, `select ops.import_institutions('${good}', true) as r`)).rows[0].r;
    r.valid === 2 && r.errors.length === 0 && r.inserted === 0 && r.dry_run === true
      ? ok('dry run validates and writes nothing') : bad('dry run validates and writes nothing', JSON.stringify(r));
    await expectVal('dry run really inserted nothing', `select count(*) from ops.institution where name like 'Import %'`, 0);
  }
  const badRows = `[{"name":"","kind":"school"},
                    {"name":"X","kind":"gurukul"},
                    {"name":"WCE Sangli","kind":"engineering_college","city":"sangli"},
                    {"name":"Dup","kind":"school","city":"Pune"},
                    {"name":"dup","kind":"school","city":"pune"},
                    {"name":"Owned","kind":"school","owner_email":"nobody@x.in"}]`;
  {
    const r = (await run(O, `select ops.import_institutions('${badRows}', false) as r`)).rows[0].r;
    const msgs = Object.fromEntries(r.errors.map((e) => [e.row, e.message]));
    msgs[1] === 'Name is required' && /Kind must be one of/.test(msgs[2] ?? '') && msgs[3] === 'Already exists'
      && /Duplicate of an earlier row/.test(msgs[5] ?? '') && msgs[6] === 'Unknown owner email' && !msgs[4]
      ? ok('every bad row is reported with its row number') : bad('every bad row is reported with its row number', JSON.stringify(r.errors));
    r.inserted === 0 ? ok('one bad row stops the whole import (all or nothing)') : bad('one bad row stops the whole import', JSON.stringify(r));
    await expectVal('nothing from a failed import was written', `select count(*) from ops.institution where name in ('Dup','dup','Owned','X')`, 0);
  }
  {
    const r = (await run(O, `select ops.import_institutions('${good}', false) as r`)).rows[0].r;
    r.inserted === 2 && r.errors.length === 0 ? ok('a clean file imports every row') : bad('a clean file imports every row', JSON.stringify(r));
    await expectVal('values are trimmed and the kind is normalised',
      `select name || ':' || kind || ':' || source from ops.institution where city = 'Satara'`, 'Import College A:engineering_college:csv_import');
    await expectVal('owner_email resolves to a staff id', `select owner_id = '${S}' from ops.institution where name = 'Import School B'`, true);
    await expectVal('default state applied', `select state from ops.institution where name = 'Import School B'`, 'Maharashtra');
  }
  {
    const r = (await run(O, `select ops.import_institutions('${good}', true) as r`)).rows[0].r;
    r.errors.length === 2 ? ok('re-importing the same file is caught as duplicates') : bad('re-importing the same file is caught as duplicates', JSON.stringify(r));
  }
  await expectErr('a viewer cannot import', V, `select ops.import_institutions('${good}', true)`, 'permission to import');
  await expectErr('an empty file is rejected', O, `select ops.import_institutions('[]', true)`, 'no rows');
  await expectErr('more than 2000 rows is rejected', O,
    `select ops.import_institutions((select jsonb_agg(jsonb_build_object('name','n'||g,'kind','school')) from generate_series(1,2001) g), true)`, 'at most 2000');
  await expectErr('rows must be a list', O, `select ops.import_institutions('{"name":"x"}', true)`, 'must be a list');
  await expectOk('a partner can import and owns what they import', P,
    `select ops.import_institutions('[{"name":"Partner Import School","kind":"school","city":"Miraj","owner_email":"s@x.in"}]', false)`);
  await expectVal('partner rows are owned by the partner (owner_email ignored)',
    `select owner_id = '${P}' from ops.institution where name = 'Partner Import School'`, true);
  await expectErr('a workshop-only member cannot import', T2,
    `select ops.import_institutions('${good}', true)`, 'permission to import');

  console.log('\nSearch indexes');
  await expectVal('trigram indexes exist',
    `select count(*) from pg_indexes where schemaname = 'ops' and indexname in ('institution_name_trgm_idx','institution_city_trgm_idx')`, 2);
  await expectVal('partial-name search works', `select count(*) from ops.institution where name ilike '%import coll%'`, 1);

  console.log('\nJob log (job_run)');
  await expectOk('the service role records a job run', null,
    `insert into ops.job_run (job, status, finished_at, rows_affected) values ('posthog-sync', 'ok', now(), 120)`);
  {
    const f = await rows(F, `select count(*)::int as c from ops.job_run`);
    f[0].c === 1 ? ok('the founder can read job runs') : bad('the founder can read job runs', JSON.stringify(f));
    for (const [who, uid] of [['a dept lead', W], ['a member', S], ['a partner', P]]) {
      const r = await rows(uid, `select count(*)::int as c from ops.job_run`);
      r[0].c === 0 ? ok(`${who} cannot read job runs`) : bad(`${who} cannot read job runs`, JSON.stringify(r));
    }
  }
  await expectErr('even the founder cannot write job runs from the app', F,
    `insert into ops.job_run (job) values ('x')`, 'row-level security');
  await expectErr('a failed job needs a valid status', null, `insert into ops.job_run (job, status) values ('x', 'weird')`, 'check constraint');

  console.log('\nDPDP erasure (forget_ide_user)');
  await db.exec(`
    insert into ops.ide_user_snapshot (ide_user_id, email, cohort_code) values
      ('kid-1', 'Kid@School.in', 'HC-AAAA'), ('kid-2', 'other@school.in', 'HC-AAAA');
    insert into ops.ph_user_daily (day, distinct_id, events) values (current_date, 'kid-1', 5), (current_date, 'kid-2', 7);
    insert into ops.ph_session (recording_id, distinct_id, replay_url) values ('forget-1', 'kid-1', 'https://ph/f1');
    insert into ops.feedback (source, owner_department, body, ide_user_id) values ('community', 'community', 'loved it', 'kid-1');
  `);
  await expectErr('only the founder can erase data', S, `select ops.forget_ide_user('kid-1')`, 'only the founder');
  await expectErr('a dept lead cannot either', W, `select ops.forget_ide_user('kid-1')`, 'only the founder');
  await expectErr('an id or email is required', F, `select ops.forget_ide_user()`, 'provide an ide user id');
  {
    const r = (await run(F, `select ops.forget_ide_user(null, ' KID@school.in ') as r`)).rows[0].r;
    r.snapshots === 1 && r.daily_rows === 1 && r.sessions === 1 && r.feedback === 1
      ? ok('erasing by email (case-insensitive) finds every linked row') : bad('erasing by email finds every linked row', JSON.stringify(r));
  }
  await expectVal('the snapshot is gone', `select count(*) from ops.ide_user_snapshot where ide_user_id = 'kid-1'`, 0);
  await expectVal('daily usage is gone', `select count(*) from ops.ph_user_daily where distinct_id = 'kid-1'`, 0);
  await expectVal('the replay row is kept but anonymised', `select distinct_id is null from ops.ph_session where recording_id = 'forget-1'`, true);
  await expectVal('feedback is kept but unlinked from the user', `select ide_user_id is null from ops.feedback where body = 'loved it'`, true);
  await expectVal('other users are untouched', `select count(*) from ops.ide_user_snapshot where ide_user_id = 'kid-2'`, 1);
  await expectVal('the erasure is audit-logged with counts and no personal data',
    `select count(*) from ops.audit_log where action = 'FORGET' and after::text not like '%kid%' and after::text not like '%school.in%'`, 1);
  await expectOk('the service role can erase by id', null, `select ops.forget_ide_user('kid-2')`);
}
