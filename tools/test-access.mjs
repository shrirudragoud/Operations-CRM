// Access (0009) + hardening/team admin (0010) checks. Called from test-migrations.mjs after the
// business-rule checks, with its helpers and fixtures.
export default async function accessTests(t) {
  const { db, run, ok, bad, msg, expectOk, expectErr, expectVal, val, F, S, W, P, V, O, inst } = t;

  const claim = async (uid, email, name) =>
    (await run(uid, `select ops.claim_access() as r`,
      { email, user_metadata: name ? { full_name: name } : {} })).rows[0].r;
  const expectClaim = async (name, uid, email, want, fullName) => {
    try {
      const r = await claim(uid, email, fullName);
      r.status === want ? ok(name) : bad(name, `got ${JSON.stringify(r)}, want status ${want}`);
      return r;
    } catch (e) { bad(name, msg(e)); }
  };

  // new auth users who are not staff yet
  const N1 = '00000000-0000-0000-0000-0000000000d1'; // valid invite (mixed-case email)
  const N2 = '00000000-0000-0000-0000-0000000000d2'; // expired invite
  const N3 = '00000000-0000-0000-0000-0000000000d3'; // no invite
  const N4 = '00000000-0000-0000-0000-0000000000d4'; // second account, same email as N1
  const N5 = '00000000-0000-0000-0000-0000000000d5'; // partner invite via RPC
  const N6 = '00000000-0000-0000-0000-0000000000d6'; // invite without name; name from Google profile
  await db.exec(`insert into auth.users(id) values ('${N1}'),('${N2}'),('${N3}'),('${N4}'),('${N5}'),('${N6}')`);

  console.log('\nInvites (0009 + 0010)');
  await expectOk('founder invites a member via invite_staff', F,
    `select ops.invite_staff('  Asha@Example.IN ', 'member', '{outreach,outreach}', 'Asha K')`);
  await expectVal('invite email normalised, departments de-duplicated',
    `select email || ':' || departments::text from ops.invite where email = 'asha@example.in'`,
    'asha@example.in:{outreach}');
  await expectOk('re-inviting refreshes the open invite instead of duplicating', F,
    `select ops.invite_staff('asha@example.in', 'dept_lead', '{outreach,sales}', 'Asha K')`);
  await expectVal('still one open invite, with the new role',
    `select count(*) || ':' || max(role::text) from ops.invite where email = 'asha@example.in' and accepted_at is null`,
    '1:dept_lead');
  await expectErr('non-founder cannot invite', S,
    `select ops.invite_staff('x@example.in', 'member', '{sales}')`, 'only the founder');
  await expectErr('non-founder cannot insert invites directly', W,
    `insert into ops.invite(email, role, departments) values ('y@example.in','member','{workshop}')`, 'row-level security');
  await expectErr('partner cannot insert invites directly', P,
    `insert into ops.invite(email, role) values ('z@example.in','partner')`, 'row-level security');
  {
    const r = await run(S, `select count(*)::int as c from ops.invite`);
    r.rows[0].c === 0 ? ok('non-founder sees no invites') : bad('non-founder sees no invites', `saw ${r.rows[0].c}`);
    const f = await run(F, `select count(*)::int as c from ops.invite`);
    f.rows[0].c > 0 ? ok('founder sees invites') : bad('founder sees invites', 'none');
  }
  await expectErr('invalid email rejected', F,
    `select ops.invite_staff('not-an-email', 'member', '{sales}')`, 'valid email');
  await expectErr('member without department rejected', F,
    `select ops.invite_staff('nodept@example.in', 'member', '{}')`, 'at least one department');
  await expectErr('partner with departments rejected', F,
    `select ops.invite_staff('pd@example.in', 'partner', '{sales}')`, 'partners cannot belong');
  await expectErr('cannot invite an existing team member', F,
    `select ops.invite_staff('S@x.in', 'member', '{sales}')`, 'already on the team');
  await expectErr('direct insert of a partner with departments violates the constraint', null,
    `insert into ops.invite(email, role, departments) values ('pd2@example.in','partner','{sales}')`, 'invite_partner_no_departments');

  console.log('\nClaiming access');
  await expectErr('claim requires a signed-in user', null, `select ops.claim_access()`, 'not signed in');
  await expectClaim('no invite -> no_invite', N3, 'stranger@gmail.com', 'no_invite');
  await expectVal('no staff row created for an uninvited user', `select count(*) from ops.staff where id = '${N3}'`, 0);
  {
    const r = await run(N3, `select ops.me() as me`, { email: 'stranger@gmail.com' });
    r.rows[0].me === null ? ok('me() is null for an uninvited user') : bad('me() is null for an uninvited user', JSON.stringify(r.rows[0].me));
  }
  const c1 = await expectClaim('valid invite -> claimed (case-insensitive email)', N1, 'ASHA@example.in', 'claimed', 'Google Name');
  if (c1) (c1.role === 'dept_lead' ? ok('claim returns role') : bad('claim returns role', JSON.stringify(c1)));
  await expectVal('staff row created from the invite (invite name wins)',
    `select full_name || ':' || role || ':' || departments::text || ':' || email from ops.staff where id = '${N1}'`,
    'Asha K:dept_lead:{outreach,sales}:asha@example.in');
  await expectVal('invite marked accepted by the new staff row',
    `select accepted_by = '${N1}' and accepted_at is not null from ops.invite where email = 'asha@example.in'`, true);
  await expectClaim('second claim is idempotent -> active', N1, 'asha@example.in', 'active');
  await expectVal('still exactly one staff row', `select count(*) from ops.staff where email = 'asha@example.in'`, 1);
  await expectClaim('accepted invite cannot be claimed by another account', N4, 'asha@example.in', 'no_invite');
  {
    const r = await run(N1, `select ops.me() as me`, { email: 'asha@example.in' });
    r.rows[0].me?.role === 'dept_lead' ? ok('me() returns the new member') : bad('me() returns the new member', JSON.stringify(r.rows[0].me));
  }

  await db.exec(`insert into ops.invite(email, role, departments, expires_at)
                 values ('late@example.in','member','{sales}', now() - interval '1 day')`);
  await expectClaim('expired invite -> no_invite', N2, 'late@example.in', 'no_invite');
  await expectVal('no staff row from an expired invite', `select count(*) from ops.staff where id = '${N2}'`, 0);

  await expectOk('founder invites a partner (no departments)', F,
    `select ops.invite_staff('partner2@example.in', 'partner', '{}', 'Partner Two')`);
  await expectClaim('partner claims', N5, 'partner2@example.in', 'claimed');
  await expectVal('partner staff row has no departments',
    `select role || ':' || departments::text from ops.staff where id = '${N5}'`, 'partner:{}');

  await expectOk('invite without a name', F, `select ops.invite_staff('noname@example.in', 'viewer', '{community}')`);
  await expectClaim('claim without invite name uses the Google profile name', N6, 'noname@example.in', 'claimed', 'Ravi Patil');
  await expectVal('name taken from user_metadata.full_name', `select full_name from ops.staff where id = '${N6}'`, 'Ravi Patil');

  console.log('\nDeactivation');
  await expectOk('founder deactivates a member via update_staff_access', F,
    `select ops.update_staff_access('${N6}', 'viewer', '{community}', false)`);
  await expectClaim('disabled staff -> disabled', N6, 'noname@example.in', 'disabled');
  {
    const r = await run(N6, `select ops.me() as me`);
    r.rows[0].me === null ? ok('me() is null for disabled staff') : bad('me() is null for disabled staff', JSON.stringify(r.rows[0].me));
    const c = await run(N6, `select count(*)::int as c from ops.institution`);
    c.rows[0].c === 0 ? ok('disabled staff see no data immediately') : bad('disabled staff see no data immediately', `saw ${c.rows[0].c}`);
  }
  await expectErr('re-inviting a deactivated person points to reactivation', F,
    `select ops.invite_staff('noname@example.in', 'viewer', '{community}')`, 'reactivate');
  await expectOk('founder reactivates', F, `select ops.update_staff_access('${N6}', 'viewer', '{community}', true)`);
  await expectClaim('reactivated -> active', N6, 'noname@example.in', 'active');

  console.log('\nTeam admin RPCs');
  await expectErr('member cannot change access via RPC', S,
    `select ops.update_staff_access('${S}', 'founder', '{}', true)`, 'only the founder');
  await expectErr('dept lead cannot change access via RPC', W,
    `select ops.update_staff_access('${S}', 'viewer', '{sales}', true)`, 'only the founder');
  await expectErr('update_staff_access validates the role shape', F,
    `select ops.update_staff_access('${S}', 'partner', '{sales}', true)`, 'partners cannot belong');
  await expectErr('unknown staff id', F,
    `select ops.update_staff_access('99999999-0000-0000-0000-000000000009', 'member', '{sales}', true)`, 'not found');
  await expectOk('founder changes a member\'s departments', F,
    `select ops.update_staff_access('${N1}', 'member', '{outreach}', true)`);
  await expectVal('staff change is audit-logged',
    `select count(*) > 0 from ops.audit_log where table_name = 'staff' and row_id = '${N1}' and action = 'UPDATE'`, true);
  await expectVal('invite is audit-logged', `select count(*) > 0 from ops.audit_log where table_name = 'invite'`, true);
  const openInv = await val(`select id from ops.invite where email = 'late@example.in'`);
  await expectErr('non-founder cannot revoke an invite', S, `select ops.revoke_invite('${openInv}')`, 'only the founder');
  await expectOk('founder revokes an open invite', F, `select ops.revoke_invite('${openInv}')`);
  await expectErr('revoking twice fails clearly', F, `select ops.revoke_invite('${openInv}')`, 'not found');
  const accInv = await val(`select id from ops.invite where email = 'asha@example.in'`);
  await expectErr('accepted invites cannot be revoked', F, `select ops.revoke_invite('${accInv}')`, 'already accepted');

  console.log('\nLast founder protection');
  await expectErr('last founder cannot demote themselves', F,
    `select ops.update_staff_access('${F}', 'member', '{sales}', true)`, 'at least one active founder');
  await expectErr('last founder cannot be deactivated', F,
    `update ops.staff set is_active = false where id = '${F}'`, 'at least one active founder');
  await expectErr('last founder cannot be deleted', F,
    `delete from ops.staff where id = '${F}'`, 'at least one active founder');
  await expectOk('promote a second founder', F, `select ops.update_staff_access('${N1}', 'founder', '{}', true)`);
  await expectOk('with two founders, one may step down', N1,
    `select ops.update_staff_access('${N1}', 'member', '{outreach}', true)`);
  await expectErr('...but then the remaining founder is protected again', F,
    `update ops.staff set role = 'member', departments = '{sales}' where id = '${F}'`, 'at least one active founder');

  console.log('\nPartner isolation');
  const other = await val(`select id from ops.institution where name = 'ZP School'`);
  await expectErr('partner cannot open a deal at an institution they do not own', P,
    `insert into ops.deal(institution_id, kind, title, owner_id) values ('${other}', 'workshop', 'poach', '${P}')`,
    'row-level security');
  await expectOk('partner can open a deal at their own institution', P,
    `insert into ops.deal(institution_id, kind, title, owner_id) values ('${inst}', 'fdp', 'FDP', '${P}')`);
  {
    const r = await run(N5, `select (select count(*) from ops.deal)::int as d, (select count(*) from ops.institution)::int as i,
                                    (select count(*) from ops.staff)::int as s`);
    const { d, i, s } = r.rows[0];
    d === 0 && i === 0 && s === 1 ? ok('a second partner sees none of the first partner\'s deals or institutions')
      : bad('a second partner sees none of the first partner\'s deals or institutions', JSON.stringify(r.rows[0]));
  }
  for (const tbl of ['item', 'kit', 'location', 'stock_reservation', 'trainer_profile', 'enrollment',
                     'ph_session', 'review_item', 'insight', 'content_item', 'invite', 'kpi_snapshot', 'task', 'feedback', 'cohort']) {
    const r = await run(P, `select count(*)::int as c from ops.${tbl}`);
    r.rows[0].c === 0 ? ok(`partner sees no ${tbl}`) : bad(`partner sees no ${tbl}`, `saw ${r.rows[0].c}`);
  }
  {
    const r = await run(P, `select count(*)::int as c from ops.event`);
    r.rows[0].c === 1 ? ok('partner sees events at their own institution only') : bad('partner sees events at their own institution only', `saw ${r.rows[0].c}`);
  }
  {
    const r = await run(V, `select count(*)::int as c from ops.invite`);
    r.rows[0].c === 0 ? ok('viewer sees no invites') : bad('viewer sees no invites', `saw ${r.rows[0].c}`);
  }
  {
    const r = await run(O, `select ops.my_departments()::text as d`);
    r.rows[0].d === '{outreach}' ? ok('my_departments() for a member') : bad('my_departments() for a member', r.rows[0].d);
    const f = await run(F, `select cardinality(ops.my_departments()) as n`);
    f.rows[0].n === 6 ? ok('my_departments() is all six for the founder') : bad('my_departments() is all six for the founder', f.rows[0].n);
    const p = await run(P, `select cardinality(ops.my_departments()) as n`);
    p.rows[0].n === 0 ? ok('my_departments() is empty for a partner') : bad('my_departments() is empty for a partner', p.rows[0].n);
  }

  console.log('\nAdvisor-equivalent checks');
  const list = async (sql) => (await db.query(sql)).rows;
  const none = async (name, sql) => {
    try { const rows = await list(sql); rows.length === 0 ? ok(name) : bad(name, JSON.stringify(rows.slice(0, 5))); }
    catch (e) { bad(name, msg(e)); }
  };
  await none('every ops table has RLS enabled', `
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ops' and c.relkind = 'r' and not c.relrowsecurity`);
  await none('every ops table has at least one policy', `
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ops' and c.relkind = 'r'
      and not exists (select 1 from pg_policies p where p.schemaname = 'ops' and p.tablename = c.relname)`);
  await none('every ops function pins search_path (function_search_path_mutable)', `
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'ops' and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
  await none('policies wrap auth.uid() in a sub-select (auth_rls_initplan)', `
    select tablename, policyname from pg_policies where schemaname = 'ops'
      and (regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''), 'SELECT auth\\.uid\\(\\)', '', 'g') ~ 'auth\\.uid\\(\\)')`);
  await none('at most one permissive policy per table, role and action (multiple_permissive_policies)', `
    with x as (
      select tablename, unnest(case when cmd = 'ALL' then array['SELECT','INSERT','UPDATE','DELETE'] else array[cmd] end) as action
      from pg_policies where schemaname = 'ops' and permissive = 'PERMISSIVE')
    select tablename, action, count(*) from x group by 1, 2 having count(*) > 1`);
  await none('every foreign key has a covering index (unindexed_foreign_keys)', `
    select c.conrelid::regclass::text, c.conname from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and n.nspname = 'ops'
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
        and (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)] = c.conkey)`);
  await none('views run with the caller\'s rights (security_definer_view)', `
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ops' and c.relkind = 'v'
      and not coalesce(c.reloptions::text[] && array['security_invoker=true','security_invoker=on'], false)`);
  await none('trigger functions are not executable by authenticated', `
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'ops' and p.prorettype = 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'execute')`);
  await none('anon has no access to the ops schema', `
    select 1 where has_schema_privilege('anon', 'ops', 'usage')`);
  await none('no ops function is executable by PUBLIC', `
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'ops' and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                        where a.grantee = 0 and a.privilege_type = 'EXECUTE')`);
  await none('service-only jobs are not executable by authenticated', `
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'ops' and p.proname in ('assign_review_queue','raise_low_stock_tasks','request_part')
      and has_function_privilege('authenticated', p.oid, 'execute')`);
}
