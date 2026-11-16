// Deal types, segments, funnel views and community membership (0014).
export default async function pipelineTests(t) {
  const { run, ok, bad, expectOk, expectErr, expectVal, val, F, S, W, P, V, O } = t;
  const rows = async (uid, sql) => (await run(uid, sql)).rows;

  console.log('\nDeal types (0014)');
  const school = await val(`insert into ops.institution(name,kind,city) values ('Pipe School','school','Pune') returning id`);
  const college = await val(`insert into ops.institution(name,kind,city) values ('Pipe College','polytechnic','Pune') returning id`);
  const other = await val(`insert into ops.institution(name,kind,city) values ('Pipe Other','other','Pune') returning id`);
  const win = async (name, id) => {
    try {
      for (const st of ['proposal', 'negotiation']) await run(S, `update ops.deal set stage='${st}' where id='${id}'`);
      await run(F, `update ops.deal set stage='won' where id='${id}'`);
      ok(name);
    } catch (e) { bad(name, e.message); }
  };
  const mk = (inst, kind) => `insert into ops.deal(institution_id,kind,title,owner_id) values ('${inst}','${kind}','t','${S}') returning id`;

  await expectErr('the old "bundle" type is gone', S, mk(school, 'bundle'), 'deal_kind_check');
  await expectOk('a Workshop deal opens', S, mk(school, 'workshop'));
  await expectErr('a second open Workshop deal at the same institution is blocked', S, mk(school, 'workshop'), 'deal_one_open_per_kind');
  const lab = await val(`insert into ops.deal(institution_id,kind,title,owner_id) values ('${school}','lab_setup','Lab','${S}') returning id`);
  const fdp = await val(`insert into ops.deal(institution_id,kind,title,owner_id) values ('${school}','fdp','FDP','${S}') returning id`);
  const oth = await val(`insert into ops.deal(institution_id,kind,title,owner_id) values ('${school}','other','Other','${S}') returning id`);
  ok('Lab, Faculty training and Other deals run in parallel with the Workshop deal');
  await expectOk('a lost deal frees its slot', S, `update ops.deal set stage='lost', lost_reason='budget' where id='${oth}'`);
  await expectOk('so another Other deal can open', S, mk(school, 'other'));

  await win('Lab deal walks meeting -> proposal -> negotiation -> won', lab);
  await expectVal('Lab win makes a lab-planning task and no event',
    `select (select count(*) from ops.task where template='plan_lab_setup' and entity_id='${lab}') || ':' || (select count(*) from ops.event where deal_id='${lab}')`, '1:0');
  await win('Faculty training deal reaches won', fdp);
  await expectVal('Faculty training win makes an fdp event and its two tasks',
    `select (select count(*) from ops.event where deal_id='${fdp}' and kind='fdp') || ':' || (select count(*) from ops.task where entity_type='event' and entity_id=(select id from ops.event where deal_id='${fdp}'))`, '1:2');
  const o2 = await val(`select id from ops.deal where institution_id='${school}' and kind='other' and stage='meeting'`);
  await win('Other deal reaches won', o2);
  await expectVal('Other win makes a Sales task only (no event, no kit reservation)',
    `select (select count(*) from ops.task where template='plan_other_deal' and entity_id='${o2}') || ':' || (select count(*) from ops.event where deal_id='${o2}')`, '1:0');

  await expectOk('a qualified visit still creates a Workshop deal at a clean institution', O,
    `insert into ops.activity(institution_id, kind, outcome) values ('${college}','visit','qualified')`);
  await expectVal('...and only one', `select count(*) from ops.deal where institution_id='${college}'`, 1);
  await expectOk('a second qualified visit does not add another', O,
    `insert into ops.activity(institution_id, kind, outcome) values ('${college}','call','qualified')`);
  await expectVal('still one open deal', `select count(*) from ops.deal where institution_id='${college}'`, 1);

  console.log('\nSegments and funnel views (0014)');
  await expectVal('school kind -> school segment', `select segment from ops.institution where id='${school}'`, 'school');
  await expectVal('polytechnic -> college segment', `select segment from ops.institution where id='${college}'`, 'college');
  await expectVal('other kind -> other segment', `select segment from ops.institution where id='${other}'`, 'other');
  await expectErr('segment cannot be written by hand', F, `update ops.institution set segment='school' where id='${college}'`, 'only be updated to default');
  {
    const r = await rows(S, `select segment, sum(institutions)::int n from ops.v_funnel group by segment order by segment`);
    r.length >= 3 && r.every((x) => x.n > 0) ? ok('the funnel view counts institutions per segment') : bad('the funnel view counts institutions per segment', JSON.stringify(r));
  }
  await expectVal('the pipeline view counts deals by type and segment',
    `select deals from ops.v_pipeline where kind='lab_setup' and segment='school' and stage='won'`, 1);
  await expectOk('a partner can query the views (RLS limits them to owned rows)', P, `select * from ops.v_pipeline`);
  {
    const r = await rows(P, `select count(*)::int n from ops.v_funnel`);
    r[0].n === 1 ? ok('a partner funnel only counts the institution they own') : bad('a partner funnel only counts the institution they own', JSON.stringify(r));
  }

  console.log('\nCommunity membership (0014)');
  const C = '00000000-0000-0000-0000-0000000000e1';
  await t.db.exec(`insert into auth.users(id) values ('${C}');
    insert into ops.staff(id, full_name, email, role, departments) values ('${C}','Community','cm@x.in','member','{community}')`);
  const ins = (name, kind = 'club') => `insert into ops.community_membership(institution_id, kind, name) values ('${school}','${kind}','${name}') returning id`;
  await expectOk('Community adds a club', C, ins('Robotics Club'));
  await expectOk('the same institution can have several memberships', C, ins('Priya Ambassador', 'ambassador'));
  await expectErr('a duplicate (institution, kind, name) is rejected', C, ins(' robotics club '), 'community_membership_unique');
  await expectErr('an unknown status is rejected', C,
    `insert into ops.community_membership(institution_id, kind, name, status) values ('${school}','club','X','legend')`, 'check');
  await expectErr('Sales cannot add a membership', S, ins('Sales Club'), 'row-level security');
  await expectErr('a viewer cannot add a membership', V, ins('Viewer Club'), 'row-level security');
  await expectErr('a partner cannot add a membership', P, ins('Partner Club'), 'row-level security');
  await expectOk('the founder can', F, ins('Founder Club'));
  await expectOk('Community promotes a club to champion', C, `update ops.community_membership set status='champion' where name='Robotics Club'`);
  {
    const r = await rows(S, `select count(*)::int n from ops.community_membership`);
    r[0].n === 3 ? ok('Sales can read memberships') : bad('Sales can read memberships', JSON.stringify(r));
    const p = await rows(P, `select count(*)::int n from ops.community_membership`);
    p[0].n === 0 ? ok('a partner cannot read memberships') : bad('a partner cannot read memberships', JSON.stringify(p));
  }
  await expectVal('membership changes are audited', `select count(*) > 0 from ops.audit_log where table_name='community_membership'`, true);
  await run(C, `delete from ops.community_membership where name='Founder Club'`);
  await expectVal('a community member (not lead) cannot delete a membership', `select count(*) from ops.community_membership where name='Founder Club'`, 1);
}
