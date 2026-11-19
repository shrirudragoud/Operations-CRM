// Staff profile (0031) and directory (0035). Called from test-migrations.mjs.
export default async function profileTests(t) {
  const { db, run, ok, bad, expectOk, expectErr, expectVal, val, F, S, W, P, V, O } = t;
  console.log('\nStaff profile (0031) and directory (0035)');
  const rows = async (uid, sql) => (await run(uid, sql)).rows;
  const expectRows = async (name, uid, sql, want) => {
    let n;
    try { n = (await rows(uid, sql)).length; } catch (e) { return bad(name, (e.message ?? '').split('\n')[0]); }
    n === want ? ok(name) : bad(name, `${n} rows, want ${want}`);
  };
  const MONTH = `extract(month from current_date)::int`;

  // Known starting point: the Workshop lead is a plain lead (not HR) until the HR section below.
  await db.exec(`update ops.staff set is_hr = false, is_active = true where id in ('${W}','${S}','${O}')`);

  console.log('Every person has a row');
  await expectVal('every existing person got a profile row', `select (select count(*) from ops.staff) = (select count(*) from ops.staff_profile)`, true);
  await db.exec(`insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000f1');
    insert into ops.staff(id, full_name, email, role, departments) values ('00000000-0000-0000-0000-0000000000f1','New Joiner','new@x.in','member','{sales}')`);
  await expectVal('a new person gets a row at once', `select count(*) from ops.staff_profile where staff_id = '00000000-0000-0000-0000-0000000000f1'`, 1);

  console.log('A person and their own record');
  await expectRows('a member reads their own profile', S, `select staff_id from ops.staff_profile`, 1);
  await expectVal('...and it is their own', `select count(*) from ops.staff_profile where staff_id = '${S}'`, 1);
  await expectOk('a member fills in their personal details', S,
    `update ops.staff_profile set legal_name = 'Sana Sales', personal_email = 'sana@home.in', personal_phone = '+91 98765 43210',
       address = '12 Station Road, Sangli', emergency_name = 'Mother', emergency_phone = '9876500000', emergency_relation = 'Parent',
       blood_group = 'B+' where staff_id = '${S}'`);
  await expectVal('...they are saved', `select legal_name || '|' || blood_group from ops.staff_profile where staff_id = '${S}'`, 'Sana Sales|B+');
  await expectVal('...and the change is stamped with who made it', `select updated_by = '${S}' from ops.staff_profile where staff_id = '${S}'`, true);
  await expectErr('a member cannot change their designation', S, `update ops.staff_profile set designation = 'CEO' where staff_id = '${S}'`, 'Only HR');
  await expectErr('...nor the employee code', S, `update ops.staff_profile set employee_code = 'HC-1' where staff_id = '${S}'`, 'Only HR');
  await expectErr('...nor the joined date', S, `update ops.staff_profile set joined_on = date '2024-01-01' where staff_id = '${S}'`, 'Only HR');
  await expectErr('...nor the employment type', S, `update ops.staff_profile set employment_type = 'full_time' where staff_id = '${S}'`, 'Only HR');
  await expectErr('...nor the probation end', S, `update ops.staff_profile set probation_end = date '2030-01-01' where staff_id = '${S}'`, 'Only HR');
  await expectErr('...nor their manager', S, `update ops.staff_profile set manager_id = '${F}' where staff_id = '${S}'`, 'Only HR');
  await expectErr('a profile cannot be handed to someone else', S, `update ops.staff_profile set staff_id = '${O}' where staff_id = '${S}'`, 'cannot be moved');
  await expectErr('a member cannot create a profile row', S, `insert into ops.staff_profile (staff_id) values ('${O}')`, 'row-level security');
  await expectRows('a member cannot delete their profile', S, `delete from ops.staff_profile where staff_id = '${S}' returning staff_id`, 0);
  await expectErr('a bad blood group is refused', S, `update ops.staff_profile set blood_group = 'Z+' where staff_id = '${S}'`, 'check');
  await expectErr('a bad personal email is refused', S, `update ops.staff_profile set personal_email = 'not-an-email' where staff_id = '${S}'`, 'check');
  await expectErr('a bad phone number is refused', S, `update ops.staff_profile set personal_phone = 'call me' where staff_id = '${S}'`, 'check');
  await expectErr('a birth date in the future is refused', S, `update ops.staff_profile set birth_date = current_date where staff_id = '${S}'`, 'check');
  await expectErr('an emergency contact needs a name and a number', S, `update ops.staff_profile set emergency_phone = null where staff_id = '${S}'`, 'emergency_pair');

  console.log('Nobody else reads it');
  await expectRows('another member sees no one else', O, `select staff_id from ops.staff_profile where staff_id = '${S}'`, 0);
  await expectRows('...they see only their own row', O, `select staff_id from ops.staff_profile`, 1);
  await expectRows('another member cannot edit it', O, `update ops.staff_profile set address = 'x' where staff_id = '${S}' returning staff_id`, 0);
  await expectRows('a lead who is not HR sees no one else', W, `select staff_id from ops.staff_profile where staff_id <> '${W}'`, 0);
  await expectRows('...and cannot edit anyone else', W, `update ops.staff_profile set address = 'x' where staff_id = '${S}' returning staff_id`, 0);
  await expectRows('a viewer reads nothing, not even their own', V, `select staff_id from ops.staff_profile`, 0);
  await expectRows('a viewer cannot edit their own', V, `update ops.staff_profile set address = 'x' where staff_id = '${V}' returning staff_id`, 0);
  await expectRows('a partner reads nothing', P, `select staff_id from ops.staff_profile`, 0);
  await expectRows('...and cannot edit', P, `update ops.staff_profile set address = 'x' where staff_id = '${P}' returning staff_id`, 0);
  await db.exec(`update ops.staff set is_active = false where id = '${O}'`);
  await expectRows('a deactivated person reads nothing', O, `select staff_id from ops.staff_profile`, 0);
  await db.exec(`update ops.staff set is_active = true where id = '${O}'`);

  console.log('HR');
  await expectOk('the founder makes the lead HR', F, `update ops.staff set is_hr = true where id = '${W}'`);
  await expectRows('...all of them', W, `select staff_id from ops.staff_profile`, Number(await val(`select count(*) from ops.staff_profile`)));
  await expectRows('the founder reads every row', F, `select staff_id from ops.staff_profile`, Number(await val(`select count(*) from ops.staff_profile`)));
  await expectOk('HR sets the HR-owned fields', W,
    `update ops.staff_profile set employee_code = 'HC-0005', designation = 'Sales Executive', employment_type = 'full_time',
       joined_on = current_date - interval '2 years', probation_end = current_date - interval '1 year 6 months', manager_id = '${F}'
     where staff_id = '${S}'`);
  await expectVal('...they are saved', `select employee_code || '|' || designation from ops.staff_profile where staff_id = '${S}'`, 'HC-0005|Sales Executive');
  await expectVal('...stamped with HR as the editor', `select updated_by = '${W}' from ops.staff_profile where staff_id = '${S}'`, true);
  await expectErr('an employee code is unique', W, `update ops.staff_profile set employee_code = 'HC-0005' where staff_id = '${O}'`, 'unique');
  await expectErr('a manager cannot be a partner', W, `update ops.staff_profile set manager_id = '${P}' where staff_id = '${O}'`, 'manager must be');
  await expectErr('a manager cannot be a viewer', W, `update ops.staff_profile set manager_id = '${V}' where staff_id = '${O}'`, 'manager must be');
  await expectErr('a person cannot be their own manager', W, `update ops.staff_profile set manager_id = '${O}' where staff_id = '${O}'`, 'not_own_manager');
  await expectErr('probation cannot end before the joined date', W,
    `update ops.staff_profile set joined_on = date '2025-06-01', probation_end = date '2025-01-01' where staff_id = '${O}'`, 'probation_after_join');
  await expectErr('a bad employee code is refused', W, `update ops.staff_profile set employee_code = 'has space' where staff_id = '${O}'`, 'check');
  await expectOk('the founder can edit a profile too', F, `update ops.staff_profile set designation = 'Founder' where staff_id = '${F}'`);
  await expectOk('the person still edits their own personal fields afterwards', S, `update ops.staff_profile set address = '14 Station Road' where staff_id = '${S}'`);

  console.log('Opening a full record is logged');
  await expectErr('a member cannot open another person\'s record through the function', S, `select * from ops.hr_profile('${O}')`, 'Only HR');
  const before = Number(await val(`select count(*) from ops.hr_access_log`));
  const opened = await rows(W, `select * from ops.hr_profile('${S}')`);
  opened.length === 1 && opened[0].address === '14 Station Road' ? ok('HR opens a full record') : bad('HR opens a full record', JSON.stringify(opened));
  await expectVal('...one row is added to the access log', `select count(*) - ${before} from ops.hr_access_log`, 1);
  await expectVal('...it says what and whom', `select what || '|' || target_id::text from ops.hr_access_log order by id desc limit 1`, `opened profile|${S}`);
  await expectRows('...and the person looked at can see it', S, `select id from ops.hr_access_log where what = 'opened profile'`, 1);
  await run(W, `select * from ops.hr_profile('${W}')`);
  await expectVal('opening your own record is not logged', `select count(*) - ${before} from ops.hr_access_log`, 1);

  console.log('The directory');
  const active = Number(await val(`select count(*) from ops.staff where is_active and role <> 'partner'`));
  await expectRows('a member sees every active team member', S, `select * from ops.directory()`, active);
  await expectRows('...a partner is not listed', S, `select * from ops.directory() where staff_id = '${P}'`, 0);
  const cols = Object.keys((await rows(S, `select * from ops.directory() limit 1`))[0]).sort().join(',');
  cols === 'departments,designation,email,full_name,manager_id,manager_name,phone,role,staff_id'
    ? ok('...it carries work-contact fields only') : bad('...it carries work-contact fields only', cols);
  const me = (await rows(O, `select designation, manager_name from ops.directory() where staff_id = '${S}'`))[0];
  me?.designation === 'Sales Executive' && me?.manager_name === 'Founder' ? ok('...with the designation and manager name') : bad('...with the designation and manager name', JSON.stringify(me));
  await expectRows('a viewer gets an empty directory', V, `select * from ops.directory()`, 0);
  await expectRows('a partner gets an empty directory', P, `select * from ops.directory()`, 0);
  await db.exec(`update ops.staff set is_active = false where id = '${O}'`);
  await expectRows('a deactivated person is not listed', S, `select * from ops.directory() where staff_id = '${O}'`, 0);
  await expectRows('...and cannot read it', O, `select * from ops.directory()`, 0);
  await db.exec(`update ops.staff set is_active = true where id = '${O}'`);
  try { await db.exec(`set role anon; select * from ops.directory()`); bad('the directory function is not open to the public', 'anon could run it'); }
  catch (e) { /permission denied/i.test(e.message) ? ok('the directory function is not open to the public') : bad('the directory function is not open to the public', e.message.split('\n')[0]); }
  finally { await db.exec(`reset role`); }

  console.log('Birthdays and anniversaries');
  await expectOk('a member sets a birth date this month', S,
    `update ops.staff_profile set birth_date = make_date(1995, ${MONTH}, 5) where staff_id = '${S}'`);
  await expectRows('it is hidden until they agree', O, `select * from ops.directory_events(${MONTH}) where kind = 'birthday'`, 0);
  await expectOk('they agree to share it', S, `update ops.staff_profile set birthday_visible = true where staff_id = '${S}'`);
  const bd = await rows(O, `select * from ops.directory_events(${MONTH}) where kind = 'birthday'`);
  bd.length === 1 && bd[0].day === 5 && bd[0].full_name === 'Sales' ? ok('colleagues see the day') : bad('colleagues see the day', JSON.stringify(bd));
  Object.keys(bd[0] ?? {}).sort().join(',') === 'day,full_name,kind,staff_id,years'
    ? ok('...and never the year of birth') : bad('...and never the year of birth', Object.keys(bd[0] ?? {}).join(','));
  await expectRows('...a viewer sees none', V, `select * from ops.directory_events(${MONTH})`, 0);
  await expectOk('they take it back', S, `update ops.staff_profile set birthday_visible = false where staff_id = '${S}'`);
  await expectRows('...and it disappears', O, `select * from ops.directory_events(${MONTH}) where kind = 'birthday'`, 0);
  const an = await rows(O, `select * from ops.directory_events(${MONTH}) where kind = 'anniversary' and staff_id = '${S}'`);
  an.length === 1 && an[0].years === 2 ? ok('a work anniversary shows without any consent, in whole years') : bad('a work anniversary shows without any consent, in whole years', JSON.stringify(an));
  await expectErr('a month outside 1 to 12 is refused', O, `select * from ops.directory_events(13)`, 'between 1 and 12');
  await expectOk('someone who joined this month has no anniversary yet', W, `update ops.staff_profile set joined_on = current_date where staff_id = '${O}'`);
  await expectRows('...a first-year joiner is not listed', O, `select * from ops.directory_events(${MONTH}) where staff_id = '${O}'`, 0);

  // leave the lead as plain as we found them for whatever test runs next
  await db.exec(`update ops.staff set is_hr = false where id = '${W}'`);
}
