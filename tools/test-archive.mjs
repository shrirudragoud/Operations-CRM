// Archive rules (0011). Called from test-migrations.mjs after the access tests.
export default async function archiveTests(t) {
  const { db, run, ok, bad, msg, expectOk, expectErr, expectVal, val, F, S, W, P, ev, ev2 } = t;

  console.log('\nArchive (soft delete)');
  const inst = await val(`insert into ops.institution(name,kind,city) values ('Archive Test College','engineering_college','Pune') returning id`);

  await expectErr('a sales member cannot archive an institution', S,
    `update ops.institution set archived_at = now() where id = '${inst}'`, 'only a founder or department lead');
  await expectOk('the founder archives an institution with no open work', F,
    `update ops.institution set archived_at = now() where id = '${inst}'`);
  await expectVal('archived_by records who did it', `select archived_by = '${F}' from ops.institution where id = '${inst}'`, true);
  await expectOk('the founder restores it', F, `update ops.institution set archived_at = null where id = '${inst}'`);
  await expectVal('restoring clears archived_by', `select archived_by is null and archived_at is null from ops.institution where id = '${inst}'`, true);

  const deal = await val(`insert into ops.deal(institution_id,kind,title,owner_id) values ('${inst}','workshop','Archive test deal','${F}') returning id`);
  await expectErr('an institution with an open deal cannot be archived', F,
    `update ops.institution set archived_at = now() where id = '${inst}'`, 'open deals');
  await expectErr('an open deal cannot be archived', F,
    `update ops.deal set archived_at = now() where id = '${deal}'`, 'won or lost');
  await expectOk('lose the deal', F, `update ops.deal set stage = 'lost', lost_reason = 'budget' where id = '${deal}'`);
  await expectOk('a lost deal can be archived', F, `update ops.deal set archived_at = now() where id = '${deal}'`);
  await expectOk('then the institution can be archived', F, `update ops.institution set archived_at = now() where id = '${inst}'`);

  await expectErr('a scheduled event cannot be archived', F,
    `update ops.event set archived_at = now() where id = '${ev2}'`, 'cancel or complete');
  await expectOk('a department lead can archive a completed event', W,
    `update ops.event set archived_at = now() where id = '${ev}'`);
  await expectErr('a partner cannot archive even their own institution', P,
    `update ops.institution set archived_at = now() where owner_id = '${P}'`, 'only a founder or department lead');
  await expectErr('a lead trainer-level member cannot restore either', S,
    `update ops.deal set archived_at = null where id = '${deal}'`, 'only a founder or department lead');

  const n = await val(`select count(*) from ops.institution where archived_at is null`);
  Number(n) >= 2 ? ok('active filter still returns the other institutions') : bad('active filter', `got ${n}`);
}
