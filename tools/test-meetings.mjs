// Calendar and meetings (0022). Called from test-migrations.mjs after the time tests.
export default async function meetingTests(t) {
  const { run, ok, bad, expectOk, expectErr, expectVal, val, F, S, W, T2, P, V, O } = t;

  console.log('\nCalendar and meetings (0022)');
  const expectRows = async (name, uid, sql, want) => {
    const n = (await run(uid, sql)).rows.length;
    n === want ? ok(name) : bad(name, `${n} rows, want ${want}`);
  };
  const atp = (days, hour = 10, mins = 60) => {
    const base = `date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '${days} days' + interval '${hour} hours'`;
    return [`(${base}) at time zone 'Asia/Kolkata'`, `(${base} + interval '${mins} minutes') at time zone 'Asia/Kolkata'`];
  };
  const at = (...a) => atp(...a).join(', ');
  const mk = async (name, uid, cols, vals) =>
    (await expectOk(name, uid, `insert into ops.meeting (${cols}) values (${vals}) returning id`))?.rows[0]?.id;
  const sched = (uid, name, title, days = 2, extra = '', extraVals = '') =>
    mk(name, uid, `title, starts_at, ends_at${extra}`, `'${title}', ${at(days)}${extraVals}`);
  const notes = (uid, kind, mtg) => val(`select count(*) from ops.notification where recipient_id='${uid}' and kind='${kind}' and meeting_id='${mtg}'`);
  const expectNotes = async (name, uid, kind, mtg, want) => {
    const n = Number(await notes(uid, kind, mtg));
    n === want ? ok(name) : bad(name, `got ${n}, want ${want}`);
  };

  // ------------------------------------------------------------ scheduling
  console.log('Scheduling');
  const m1 = await mk('a salesperson schedules a meeting', S, 'title, starts_at, ends_at, organizer_id, status, host_id, series_id',
    `'ZZ Pricing sync', ${at(2)}, '${F}', 'scheduled', '${O}', null`);
  await expectVal('the organizer is the caller, not whoever was typed, and no host is kept',
    `select organizer_id = '${S}' and host_id is null and awaiting_id is null and series_id is null from ops.meeting where id='${m1}'`, true);
  await expectVal('the organizer is an accepted attendee',
    `select rsvp = 'accepted' and responded_at is not null from ops.meeting_attendee where meeting_id='${m1}' and staff_id='${S}'`, true);
  await expectErr('a start in the past is refused', S, `insert into ops.meeting (title, starts_at, ends_at) values ('ZZ old', now() - interval '2 hours', now() - interval '1 hour')`, 'future');
  await expectErr('an end before the start is refused', S, `insert into ops.meeting (title, starts_at, ends_at) values ('ZZ bad', ${atp(2)[0]}, ${atp(2, 9)[0]})`, 'meeting_times');
  await expectErr('a meeting over 24 hours is refused', S, `insert into ops.meeting (title, starts_at, ends_at) values ('ZZ long', ${at(2, 10, 1500)})`, 'meeting_times');
  await expectErr('a blank title is refused', S, `insert into ops.meeting (title, starts_at, ends_at) values ('   ', ${at(2)})`, 'meeting_title_check');
  await expectErr('a partner cannot schedule', P, `insert into ops.meeting (title, starts_at, ends_at) values ('ZZ partner', ${at(2)})`, 'row-level security');
  await mk('a viewer can schedule (internal people can)', V, 'title, starts_at, ends_at', `'ZZ Viewer huddle', ${at(3)}`);

  console.log('Invitations');
  await expectOk('the organizer invites a colleague', S, `insert into ops.meeting_attendee (meeting_id, staff_id) values ('${m1}', '${O}')`);
  await expectNotes('...who is told', O, 'meeting_invite', m1, 1);
  await expectVal('...and starts as invited', `select rsvp = 'invited' from ops.meeting_attendee where meeting_id='${m1}' and staff_id='${O}'`, true);
  await expectErr('a partner cannot be invited', S, `insert into ops.meeting_attendee (meeting_id, staff_id) values ('${m1}', '${P}')`, 'Only active team members');
  await expectErr('an invitee cannot invite others', O, `insert into ops.meeting_attendee (meeting_id, staff_id) values ('${m1}', '${W}')`, 'row-level security');
  await expectErr('a stranger cannot invite anyone', W, `insert into ops.meeting_attendee (meeting_id, staff_id) values ('${m1}', '${T2}')`, 'row-level security');
  await expectOk('the founder can invite to any meeting', F, `insert into ops.meeting_attendee (meeting_id, staff_id) values ('${m1}', '${W}')`);
  await expectRows('an invitee sees the meeting', O, `select id from ops.meeting where id='${m1}'`, 1);
  await expectRows('...and who else is coming', O, `select staff_id from ops.meeting_attendee where meeting_id='${m1}'`, 3);
  await expectRows('the organizer sees it', S, `select id from ops.meeting where id='${m1}'`, 1);
  await expectRows('the founder sees it', F, `select id from ops.meeting where id='${m1}'`, 1);
  await expectRows('a colleague who is not invited does not', T2, `select id from ops.meeting where id='${m1}'`, 0);
  await expectRows('...nor the attendee list', T2, `select staff_id from ops.meeting_attendee where meeting_id='${m1}'`, 0);
  await expectRows('a viewer who is not invited does not', V, `select id from ops.meeting where id='${m1}'`, 0);
  await expectRows('a partner does not', P, `select id from ops.meeting where id='${m1}'`, 0);

  console.log('Answering an invitation');
  await expectOk('an invitee accepts', O, `update ops.meeting_attendee set rsvp = 'accepted', note = 'ZZ fine' where meeting_id='${m1}' and staff_id='${O}'`);
  await expectVal('...the time of the answer is stamped', `select responded_at is not null from ops.meeting_attendee where meeting_id='${m1}' and staff_id='${O}'`, true);
  await expectNotes('...and the organizer is told', S, 'meeting_response', m1, 1);
  await expectOk('they change their mind to tentative', O, `update ops.meeting_attendee set rsvp = 'tentative' where meeting_id='${m1}' and staff_id='${O}'`);
  await expectRows('nobody answers for someone else', O, `update ops.meeting_attendee set rsvp = 'declined' where meeting_id='${m1}' and staff_id='${S}' returning staff_id`, 0);
  await expectRows('...not even the organizer', S, `update ops.meeting_attendee set rsvp = 'declined' where meeting_id='${m1}' and staff_id='${O}' returning staff_id`, 0);
  await expectErr('the organizer cannot decline their own meeting', S, `update ops.meeting_attendee set rsvp = 'declined' where meeting_id='${m1}' and staff_id='${S}'`, 'organizer can not decline');
  await expectErr('the organizer cannot be removed', S, `delete from ops.meeting_attendee where meeting_id='${m1}' and staff_id='${S}'`, 'can not be removed');
  await expectOk('an invitee declines', O, `update ops.meeting_attendee set rsvp = 'declined' where meeting_id='${m1}' and staff_id='${O}'`);
  await expectRows('an invitee cannot remove another person', O, `delete from ops.meeting_attendee where meeting_id='${m1}' and staff_id='${W}' returning staff_id`, 0);
  await expectRows('the organizer removes an invitee', S, `delete from ops.meeting_attendee where meeting_id='${m1}' and staff_id='${W}' returning staff_id`, 1);
  const n0 = Number(await val(`select count(*) from ops.notification where meeting_id='${m1}' and recipient_id='${O}'`));
  await expectOk('a notification can be marked read', O, `update ops.notification set read_at = now() where meeting_id='${m1}' and recipient_id='${O}'`);
  await expectOk('...but its meeting link cannot be changed', O, `update ops.notification set meeting_id = null where recipient_id='${O}' and meeting_id='${m1}'`);
  await expectVal('...the link is unchanged', `select count(*) from ops.notification where meeting_id='${m1}' and recipient_id='${O}'`, n0);

  console.log('Changing a meeting');
  await expectOk('the invitee accepts again before the move', O, `update ops.meeting_attendee set rsvp = 'accepted' where meeting_id='${m1}' and staff_id='${O}'`);
  await expectRows('a colleague cannot edit the meeting', O, `update ops.meeting set title = 'ZZ hijack' where id='${m1}' returning id`, 0);
  await expectOk('the organizer moves it', S, `update ops.meeting set starts_at = ${atp(4)[0]}, ends_at = ${atp(4)[1]} where id='${m1}'`);
  await expectVal('...invitees must answer again', `select rsvp from ops.meeting_attendee where meeting_id='${m1}' and staff_id='${O}'`, 'invited');
  await expectVal('...the organizer stays accepted', `select rsvp from ops.meeting_attendee where meeting_id='${m1}' and staff_id='${S}'`, 'accepted');
  await expectNotes('...and they are told', O, 'meeting_update', m1, 1);
  await expectOk('the organizer tries to turn it into a request', S, `update ops.meeting set host_id = '${O}', awaiting_id = '${O}' where id='${m1}'`);
  await expectVal('...the request fields are not user-writable', `select host_id is null and awaiting_id is null and status = 'scheduled' from ops.meeting where id='${m1}'`, true);
  await expectErr('the organizer cannot be changed', S, `update ops.meeting set organizer_id = '${O}' where id='${m1}'`, 'organizer of a meeting can not change');
  await expectErr('a scheduled meeting cannot jump to declined', S, `update ops.meeting set status = 'declined' where id='${m1}'`, 'can not become');

  console.log('Cancelling');
  await expectErr('a cancel needs a reason', S, `update ops.meeting set status = 'cancelled' where id='${m1}'`, 'why the meeting is cancelled');
  await expectOk('the organizer cancels with a reason', S, `update ops.meeting set status = 'cancelled', cancel_reason = '  ZZ client moved  ' where id='${m1}'`);
  await expectVal('...the reason is trimmed', `select cancel_reason from ops.meeting where id='${m1}'`, 'ZZ client moved');
  await expectNotes('...the invitee is told', O, 'meeting_cancel', m1, 1);
  await expectErr('a cancelled meeting is frozen', S, `update ops.meeting set title = 'ZZ again' where id='${m1}'`, 'can not be changed');
  await expectErr('nobody can be invited to it', S, `insert into ops.meeting_attendee (meeting_id, staff_id) values ('${m1}', '${T2}')`, 'cancelled meeting');
  await expectErr('nobody can answer it', O, `update ops.meeting_attendee set rsvp = 'accepted' where meeting_id='${m1}' and staff_id='${O}'`, 'was cancelled');

  const m2 = await sched(S, 'a second meeting to cancel', 'ZZ Cancel me', 3);
  await expectOk('invite', S, `insert into ops.meeting_attendee (meeting_id, staff_id) values ('${m2}', '${O}')`);
  await expectOk('the founder cancels someone else\'s meeting', F, `update ops.meeting set status = 'cancelled', cancel_reason = 'ZZ office closed' where id='${m2}'`);
  await expectNotes('...the invitee is told', O, 'meeting_cancel', m2, 1);
  const m3 = await sched(S, 'a third meeting to delete', 'ZZ Delete me', 3);
  await expectRows('a colleague cannot delete a meeting', O, `delete from ops.meeting where id='${m3}' returning id`, 0);
  await expectRows('the organizer can delete it (the attendee rows go with it)', S, `delete from ops.meeting where id='${m3}' returning id`, 1);
  await expectVal('...no attendees are left behind', `select count(*) from ops.meeting_attendee where meeting_id='${m3}'`, 0);

  // ------------------------------------------------------------ visibility
  console.log('Who can open a meeting to a team');
  await expectErr('a member cannot open a meeting to the department', S, `insert into ops.meeting (title, starts_at, ends_at, department, visibility) values ('ZZ x', ${at(2)}, 'sales', 'department')`, 'lead of that department');
  await expectErr('a department visibility needs a department', W, `insert into ops.meeting (title, starts_at, ends_at, visibility) values ('ZZ x', ${at(2)}, 'department')`, 'Choose the department');
  await expectErr('a lead cannot open another department\'s meeting', W, `insert into ops.meeting (title, starts_at, ends_at, department, visibility) values ('ZZ x', ${at(2)}, 'sales', 'department')`, 'lead of that department');
  await expectErr('a lead cannot make a meeting company wide', W, `insert into ops.meeting (title, starts_at, ends_at, visibility) values ('ZZ x', ${at(2)}, 'company')`, 'Only the founder');
  const md = await mk('a lead opens a meeting to the Workshop department', W, 'title, starts_at, ends_at, department, visibility',
    `'ZZ Workshop huddle', ${at(2)}, 'workshop', 'department'`);
  await expectRows('a Workshop member sees it without an invite', T2, `select id from ops.meeting where id='${md}'`, 1);
  await expectRows('a Sales member does not', S, `select id from ops.meeting where id='${md}'`, 0);
  await expectRows('a Sales viewer does not', V, `select id from ops.meeting where id='${md}'`, 0);
  await expectRows('a partner does not', P, `select id from ops.meeting where id='${md}'`, 0);
  await expectRows('the founder does', F, `select id from ops.meeting where id='${md}'`, 1);
  await expectOk('a department member can be invited from another department', W, `insert into ops.meeting_attendee (meeting_id, staff_id) values ('${md}', '${S}')`);
  await expectRows('...and then sees it', S, `select id from ops.meeting where id='${md}'`, 1);
  await expectOk('the lead of the department can edit it', W, `update ops.meeting set location = 'ZZ Lab 2' where id='${md}'`);
  await expectRows('a member of the department cannot edit it', T2, `update ops.meeting set location = 'ZZ nope' where id='${md}' returning id`, 0);
  await expectErr('a lead cannot widen it to everyone', W, `update ops.meeting set visibility = 'company' where id='${md}'`, 'Only the founder');
  const mc = await mk('the founder makes an all-hands visible to everyone', F, 'title, starts_at, ends_at, visibility', `'ZZ All hands', ${at(5)}, 'company'`);
  await expectRows('a member sees it', O, `select id from ops.meeting where id='${mc}'`, 1);
  await expectRows('a viewer sees it', V, `select id from ops.meeting where id='${mc}'`, 1);
  await expectRows('a partner does not', P, `select id from ops.meeting where id='${mc}'`, 0);
  await expectRows('...nor its attendees', P, `select staff_id from ops.meeting_attendee where meeting_id='${mc}'`, 0);

  // ------------------------------------------------------------ requests
  console.log('Requesting a meeting');
  await expectErr('a request needs someone to ask', S, `insert into ops.meeting (title, starts_at, ends_at, status) values ('ZZ x', ${at(2)}, 'requested')`, 'Choose who you are asking');
  await expectErr('you cannot ask yourself', S, `insert into ops.meeting (title, starts_at, ends_at, status, host_id) values ('ZZ x', ${at(2)}, 'requested', '${S}')`, 'Choose who you are asking');
  await expectErr('a partner cannot be asked', S, `insert into ops.meeting (title, starts_at, ends_at, status, host_id) values ('ZZ x', ${at(2)}, 'requested', '${P}')`, 'active team member');
  await expectErr('a meeting cannot be created already cancelled', S, `insert into ops.meeting (title, starts_at, ends_at, status) values ('ZZ x', ${at(2)}, 'cancelled')`, 'scheduled or requested');
  const r1 = await mk('a salesperson requests time with a trainer lead', S, 'title, starts_at, ends_at, status, host_id', `'ZZ Demo kit prep', ${at(3)}, 'requested', '${W}'`);
  await expectVal('...it waits on the person asked', `select status = 'requested' and awaiting_id = '${W}' and host_id = '${W}' from ops.meeting where id='${r1}'`, true);
  await expectNotes('...who is told', W, 'meeting_request', r1, 1);
  await expectRows('the person asked sees it', W, `select id from ops.meeting where id='${r1}'`, 1);
  await expectRows('a bystander does not', T2, `select id from ops.meeting where id='${r1}'`, 0);
  await expectRows('a partner does not', P, `select id from ops.meeting where id='${r1}'`, 0);
  await expectOk('the requester adds a colleague to the request', S, `insert into ops.meeting_attendee (meeting_id, staff_id) values ('${r1}', '${O}')`);
  await expectNotes('...who is not told until it is accepted', O, 'meeting_invite', r1, 0);
  await expectErr('nobody answers an invitation to a request', O, `update ops.meeting_attendee set rsvp = 'accepted' where meeting_id='${r1}' and staff_id='${O}'`, 'Wait until the request');
  await expectErr('the requester cannot accept their own request', S, `select ops.answer_meeting_request('${r1}', 'accept')`, 'Only the person asked');
  await expectErr('a bystander cannot accept it', T2, `select ops.answer_meeting_request('${r1}', 'accept')`, 'Only the person asked');
  await expectErr('the requester cannot flip the status by hand', S, `update ops.meeting set status = 'scheduled', awaiting_id = null where id='${r1}'`, 'Only the person asked');
  await expectErr('an unknown answer is refused', W, `select ops.answer_meeting_request('${r1}', 'maybe')`, 'accept, decline or propose');

  console.log('Suggesting another time');
  await expectErr('a new time needs a start and an end', W, `select ops.answer_meeting_request('${r1}', 'propose')`, 'start and an end');
  await expectErr('a new time cannot be in the past', W, `select ops.answer_meeting_request('${r1}', 'propose', now() - interval '1 day', now() - interval '23 hours')`, 'future');
  await expectOk('the person asked suggests another time', W, `select ops.answer_meeting_request('${r1}', 'propose', ${at(4, 15)})`);
  await expectVal('...the time moved and the ball is back with the requester',
    `select status = 'requested' and awaiting_id = '${S}' and host_id = '${W}' and starts_at = ${atp(4, 15)[0]} from ops.meeting where id='${r1}'`, true);
  await expectNotes('...the requester is told', S, 'meeting_request', r1, 1);
  await expectErr('the one who suggested cannot answer their own suggestion', W, `select ops.answer_meeting_request('${r1}', 'accept')`, 'Only the person asked');
  await expectOk('the requester counter-suggests', S, `select ops.answer_meeting_request('${r1}', 'propose', ${at(4, 16)})`);
  await expectVal('...and it flips back to the person asked', `select awaiting_id = '${W}' from ops.meeting where id='${r1}'`, true);
  await expectOk('the requester moves the time by hand while it is open', S, `update ops.meeting set starts_at = ${atp(5, 11)[0]}, ends_at = ${atp(5, 11)[1]} where id='${r1}'`);
  await expectVal('...it stays a request awaiting the person asked', `select status = 'requested' and awaiting_id = '${W}' from ops.meeting where id='${r1}'`, true);

  console.log('Accepting');
  await expectOk('the person asked accepts', W, `select ops.answer_meeting_request('${r1}', 'accept')`);
  await expectVal('...it is scheduled and nobody is awaited', `select status = 'scheduled' and awaiting_id is null and host_id = '${W}' from ops.meeting where id='${r1}'`, true);
  await expectVal('...both people are accepted', `select count(*) from ops.meeting_attendee where meeting_id='${r1}' and staff_id in ('${S}','${W}') and rsvp = 'accepted'`, 2);
  await expectVal('...the colleague on the request is still to answer', `select rsvp from ops.meeting_attendee where meeting_id='${r1}' and staff_id='${O}'`, 'invited');
  await expectNotes('...the colleague is invited now', O, 'meeting_invite', r1, 1);
  await expectNotes('...the requester is told', S, 'meeting_response', r1, 1);
  await expectErr('it cannot be accepted twice', W, `select ops.answer_meeting_request('${r1}', 'accept')`, 'no longer open');

  console.log('Declining');
  const r2 = await mk('another request', O, 'title, starts_at, ends_at, status, host_id', `'ZZ Review notes', ${at(3)}, 'requested', '${T2}'`);
  await expectErr('a decline needs a reason', T2, `select ops.answer_meeting_request('${r2}', 'decline')`, 'Say why you are declining');
  await expectErr('...not just spaces', T2, `select ops.answer_meeting_request('${r2}', 'decline', null, null, '   ')`, 'Say why you are declining');
  await expectOk('the person asked declines with a reason', T2, `select ops.answer_meeting_request('${r2}', 'decline', null, null, 'ZZ on a school visit')`);
  await expectVal('...the request is declined with the reason', `select status = 'declined' and awaiting_id is null and cancel_reason = 'ZZ on a school visit' from ops.meeting where id='${r2}'`, true);
  await expectNotes('...the requester is told', O, 'meeting_response', r2, 1);
  await expectErr('a declined request is frozen', O, `update ops.meeting set title = 'ZZ again' where id='${r2}'`, 'can not be changed');
  await expectErr('...and cannot be answered again', T2, `select ops.answer_meeting_request('${r2}', 'accept')`, 'no longer open');

  console.log('Withdrawing a request');
  const r3 = await mk('a request to withdraw', O, 'title, starts_at, ends_at, status, host_id', `'ZZ Withdraw', ${at(3)}, 'requested', '${T2}'`);
  await expectOk('the requester withdraws with a reason', O, `update ops.meeting set status = 'cancelled', cancel_reason = 'ZZ not needed' where id='${r3}'`);
  await expectVal('...nobody is awaited', `select status = 'cancelled' and awaiting_id is null from ops.meeting where id='${r3}'`, true);
  await expectNotes('...the person asked is told', T2, 'meeting_cancel', r3, 1);

  // ------------------------------------------------------------ busy
  console.log('Who is busy');
  const [wFrom, wTo] = atp(5, 11);
  const bn = async (name, uid, who, want, exclude = 'null') => {
    const r = await run(uid, `select count(*) from ops.calendar_busy(array['${who}']::uuid[], ${wFrom}, ${wTo}, ${exclude})`);
    const n = Number(r.rows[0].count);
    n === want ? ok(name) : bad(name, `got ${n}, want ${want}`);
  };
  await bn('an accepted meeting shows as busy', S, W, 1);
  await bn('...for the other person too', S, S, 1);
  await bn('...and not for someone not in it', S, T2, 0);
  await bn('the meeting being edited can be left out', S, W, 0, `'${r1}'`);
  await bn('a partner learns nothing', P, W, 0);
  await expectOk('a declined invitee is not busy', O, `update ops.meeting_attendee set rsvp = 'declined' where meeting_id='${r1}' and staff_id='${O}'`);
  await bn('...the declined person shows as free', S, O, 0);

  // ------------------------------------------------------------ fixed meetings
  console.log('Fixed meetings');
  const today = `(now() at time zone 'Asia/Kolkata')::date`;
  const days = (cond) => `select count(*) from generate_series(${today}, ${today} + 35, interval '1 day') g(d) where ${cond}`;
  const mon = (id) => `select count(*) from ops.meeting where series_id='${id}'`;
  const sr = async (name, uid, cols, vals) =>
    (await expectOk(name, uid, `insert into ops.meeting_series (${cols}) values (${vals}) returning id`))?.rows[0]?.id;

  await expectErr('a member cannot set up a meeting for a whole team', S,
    `insert into ops.meeting_series (title, frequency, weekday, start_time, department, all_department) values ('ZZ x','weekly',1,'10:00','sales',true)`, 'lead of that department');
  await expectErr('a series needs people', S, `insert into ops.meeting_series (title, frequency, weekday, start_time) values ('ZZ x','weekly',1,'10:00')`, 'whole department or at least one person');
  await expectErr('a weekly series needs a weekday', S, `insert into ops.meeting_series (title, frequency, start_time, staff_ids) values ('ZZ x','weekly','10:00', array['${O}']::uuid[])`, 'meeting_series_weekly_day');
  await expectErr('a monthly series needs a day of the month', S, `insert into ops.meeting_series (title, frequency, start_time, staff_ids) values ('ZZ x','monthly','10:00', array['${O}']::uuid[])`, 'meeting_series_monthly_day');
  await expectErr('a partner cannot set one up', P, `insert into ops.meeting_series (title, frequency, weekday, start_time, staff_ids) values ('ZZ x','weekly',1,'10:00', array['${O}']::uuid[])`, 'row-level security');
  await expectErr('only the founder makes one company wide', W, `insert into ops.meeting_series (title, frequency, weekday, start_time, staff_ids, visibility) values ('ZZ x','weekly',1,'10:00', array['${O}']::uuid[], 'company')`, 'Only the founder');

  const dow = async (plus) => Number(await val(`select extract(isodow from (now() at time zone 'Asia/Kolkata')::date + ${plus})`));
  const wdWeekly = await dow(3);
  const sw = await sr('a salesperson sets up a weekly one to one', S, 'title, frequency, weekday, start_time, duration_minutes, staff_ids',
    `'ZZ Weekly sync', 'weekly', ${wdWeekly}, '11:00', 45, array['${O}']::uuid[]`);
  const nWeekly = Number(await val(days(`extract(isodow from d) = ${wdWeekly}`)));
  await expectVal('...one meeting per matching day', mon(sw), nWeekly);
  await expectVal('...at the right Indian time and length',
    `select bool_and((starts_at at time zone 'Asia/Kolkata')::time = '11:00' and ends_at - starts_at = interval '45 minutes'
       and (starts_at at time zone 'Asia/Kolkata')::date = occurrence_date and extract(isodow from occurrence_date) = ${wdWeekly}) from ops.meeting where series_id='${sw}'`, true);
  await expectVal('...each has the organizer and the person picked',
    `select bool_and(c = 2) from (select count(*) c from ops.meeting_attendee a join ops.meeting m on m.id = a.meeting_id where m.series_id='${sw}' group by m.id) x`, true);
  await expectVal('...the organizer is not told about their own meeting', `select count(*) from ops.notification where recipient_id='${S}' and message like '%fixed meeting%'`, 0);
  await expectVal('...the person picked gets one invitation, not one per week',
    `select count(*) from ops.notification where recipient_id='${O}' and kind='meeting_invite' and dedupe_key like 'series:${sw}:%'`, nWeekly > 0 ? 1 : 0);
  await expectRows('...the person picked sees the meetings', O, `select id from ops.meeting where series_id='${sw}'`, nWeekly);
  await expectRows('...a stranger does not', T2, `select id from ops.meeting where series_id='${sw}'`, 0);
  await expectRows('...a partner does not', P, `select id from ops.meeting_series where id='${sw}'`, 0);
  await expectRows('the person picked sees the series', O, `select id from ops.meeting_series where id='${sw}'`, 1);
  await expectRows('...a stranger does not', T2, `select id from ops.meeting_series where id='${sw}'`, 0);
  await expectRows('...a viewer who is not in it does not', V, `select id from ops.meeting_series where id='${sw}'`, 0);
  await expectRows('...the person picked cannot edit it', O, `update ops.meeting_series set title = 'ZZ hijack' where id='${sw}' returning id`, 0);
  await expectRows('...the founder can', F, `update ops.meeting_series set location = 'ZZ Room 1' where id='${sw}' returning id`, 1);
  await expectVal('running the generator again makes nothing new', `select ops.generate_series_meetings()`, 0);
  await expectVal('...and no duplicates exist', `select count(*) from ops.meeting where series_id='${sw}'`, nWeekly);

  console.log('One occurrence');
  const occ = await val(`select id from ops.meeting where series_id='${sw}' and starts_at > now() + interval '1 day' order by starts_at limit 1`);
  const occ2 = await val(`select id from ops.meeting where series_id='${sw}' and starts_at > now() + interval '1 day' order by starts_at offset 1 limit 1`);
  const occ3 = await val(`select id from ops.meeting where series_id='${sw}' and starts_at > now() + interval '1 day' order by starts_at offset 2 limit 1`);
  await expectOk('one occurrence is moved by the organizer', S, `update ops.meeting set starts_at = starts_at + interval '2 hours', ends_at = ends_at + interval '2 hours' where id='${occ}'`);
  await expectVal('...it is marked as customised', `select customised from ops.meeting where id='${occ}'`, true);
  await expectOk('another occurrence is cancelled', S, `update ops.meeting set status = 'cancelled', cancel_reason = 'ZZ holiday' where id='${occ2}'`);
  await expectRows('a colleague cannot change the series link of an occurrence', O, `update ops.meeting set series_id = null where id='${occ3}' returning id`, 0);
  await expectOk('the organizer tries to detach an occurrence', S, `update ops.meeting set series_id = null, customised = false where id='${occ3}'`);
  await expectVal('...the link is unchanged', `select series_id = '${sw}' and not customised from ops.meeting where id='${occ3}'`, true);
  await expectOk('the series is renamed', S, `update ops.meeting_series set title = 'ZZ Weekly sync (renamed)' where id='${sw}'`);
  await expectVal('...future occurrences follow', `select title from ops.meeting where id='${occ3}'`, 'ZZ Weekly sync (renamed)');
  await expectVal('...a customised one keeps its own title', `select title from ops.meeting where id='${occ}'`, 'ZZ Weekly sync');
  await expectVal('...a cancelled one is left alone', `select title from ops.meeting where id='${occ2}'`, 'ZZ Weekly sync');
  await expectVal('generating again does not bring the cancelled one back', `select ops.generate_series_meetings()`, 0);
  await expectOk('the series time changes', S, `update ops.meeting_series set start_time = '15:30' where id='${sw}'`);
  await expectVal('...the untouched future ones moved',
    `select bool_and((starts_at at time zone 'Asia/Kolkata')::time = '15:30') from ops.meeting where series_id='${sw}' and not customised and status = 'scheduled'`, true);
  await expectVal('...the moved one kept its own time', `select (starts_at at time zone 'Asia/Kolkata')::time = '13:00' from ops.meeting where id='${occ}'`, true);
  await expectVal('...the cancelled one is still cancelled and not duplicated', `select count(*) from ops.meeting where series_id='${sw}' and id='${occ2}' and status='cancelled'`, 1);
  await expectVal('...the total is still one per matching day', mon(sw), nWeekly);

  console.log('Pausing and removing people');
  await expectErr('a series cannot end up with nobody', S, `update ops.meeting_series set staff_ids = '{}' where id='${sw}'`, 'whole department or at least one person');
  await expectOk('the series is repointed at a different person', S, `update ops.meeting_series set staff_ids = array['${T2}']::uuid[] where id='${sw}'`);
  await expectVal('...the old person is off the future meetings',
    `select count(*) from ops.meeting_attendee a join ops.meeting m on m.id = a.meeting_id where m.series_id='${sw}' and m.starts_at > now() and m.status = 'scheduled' and a.staff_id='${O}'`, 0);
  await expectVal('...the new person is on them',
    `select bool_and(exists (select 1 from ops.meeting_attendee a where a.meeting_id = m.id and a.staff_id='${T2}')) from ops.meeting m where m.series_id='${sw}' and m.starts_at > now() and m.status = 'scheduled'`, true);
  await expectOk('the series is paused', S, `update ops.meeting_series set active = false where id='${sw}'`);
  await expectVal('...future untouched meetings are gone',
    `select count(*) from ops.meeting where series_id='${sw}' and starts_at > now() and not customised and status = 'scheduled'`, 0);
  await expectVal('...nothing is generated while paused', `select ops.generate_series_meetings()`, 0);
  await expectOk('the series is resumed', S, `update ops.meeting_series set active = true where id='${sw}'`);
  await expectVal('...meetings are back', `select count(*) > 0 from ops.meeting where series_id='${sw}' and not customised and status = 'scheduled'`, true);
  await expectRows('the organizer deletes the series', S, `delete from ops.meeting_series where id='${sw}' returning id`, 1);
  await expectVal('...future untouched meetings are removed',
    `select count(*) from ops.meeting where series_id='${sw}' and starts_at > now() and not customised and status = 'scheduled'`, 0);

  console.log('Other rhythms');
  const sb = await sr('every two weeks', S, 'title, frequency, weekday, start_time, staff_ids', `'ZZ Fortnightly review', 'biweekly', ${await dow(4)}, '16:00', array['${O}']::uuid[]`);
  const nBi = Number(await val(`select count(*) from generate_series(${today}, ${today} + 35, interval '1 day') g(d) where extract(isodow from d) = ${await dow(4)}`));
  const gaps = await val(`select coalesce(bool_and(gap = 14), true) from (select occurrence_date - lag(occurrence_date) over (order by occurrence_date) as gap from ops.meeting where series_id='${sb}') x where gap is not null`);
  gaps === true ? ok('...meetings are exactly two weeks apart') : bad('...meetings are exactly two weeks apart', `got ${gaps}`);
  const cBi = Number(await val(mon(sb)));
  cBi === Math.ceil(nBi / 2) ? ok('...every other week is used') : bad('...every other week is used', `${cBi} of ${nBi}`);
  const sm = await sr('monthly on the 15th', S, 'title, frequency, month_day, start_time, staff_ids', `'ZZ Monthly planning', 'monthly', 15, '10:00', array['${O}']::uuid[]`);
  const nMo = Number(await val(`select count(*) from generate_series(${today}, ${today} + 35, interval '1 day') g(d) where extract(day from d) = 15`));
  await expectVal('...one meeting on each 15th in the window', mon(sm), nMo);
  await expectVal('...a monthly series keeps no weekday', `select weekday is null and month_day = 15 from ops.meeting_series where id='${sm}'`, true);
  await expectErr('an end before the start is refused', S, `insert into ops.meeting_series (title, frequency, weekday, start_time, staff_ids, starts_on, ends_on) values ('ZZ x','weekly',1,'10:00', array['${O}']::uuid[], current_date, current_date - 1)`, 'meeting_series_dates');

  console.log('A whole department');
  const sd = await sr('a lead sets up a weekly Workshop stand-up for everyone in Workshop', W,
    'title, frequency, weekday, start_time, department, all_department, visibility', `'ZZ Workshop stand-up', 'weekly', ${await dow(2)}, '09:30', 'workshop', true, 'department'`);
  const dept = Number(await val(`select count(*) from ops.staff where is_active and role <> 'partner' and 'workshop' = any (departments)`));
  const nMon = Number(await val(`select count(*) from generate_series(${today}, ${today} + 35, interval '1 day') g(d) where extract(isodow from d) = ${await dow(2)}`));
  await expectVal('...everyone in the department is invited to each', `select bool_and(c >= ${dept}) from (select count(*) c from ops.meeting_attendee a join ops.meeting m on m.id = a.meeting_id where m.series_id='${sd}' group by m.id) x`, true);
  await expectVal('...no partner is ever invited', `select count(*) from ops.meeting_attendee a join ops.meeting m on m.id = a.meeting_id join ops.staff st on st.id = a.staff_id where m.series_id='${sd}' and st.role = 'partner'`, 0);
  await expectRows('...a department member sees the series', T2, `select id from ops.meeting_series where id='${sd}'`, 1);
  await expectRows('...a Sales member does not', S, `select id from ops.meeting_series where id='${sd}'`, 0);
  await expectRows('...a department member sees its meetings', T2, `select id from ops.meeting where series_id='${sd}'`, nMon);
  await expectRows('...a Sales member does not see them', S, `select id from ops.meeting where series_id='${sd}'`, 0);
  await expectOk('the lead pauses it', W, `update ops.meeting_series set active = false where id='${sd}'`);

  // ------------------------------------------------------------ one answer for a whole series (0027)
  console.log('One answer for a whole series (0027)');
  const wdS = await dow(5);
  const ss = await sr('a weekly series for two people', S, 'title, frequency, weekday, start_time, staff_ids',
    `'ZZ Answer sync', 'weekly', ${wdS}, '12:00', array['${O}','${T2}']::uuid[]`);
  const occs = (await run(F, `select id from ops.meeting where series_id='${ss}' and starts_at > now() order by starts_at`)).rows.map((r) => r.id);
  occs.length >= 4 ? ok('...there are several occurrences to answer') : bad('...there are several occurrences to answer', `${occs.length}`);
  const rs = (who) => `select string_agg(rsvp, ',' order by m.starts_at) from ops.meeting_attendee a join ops.meeting m on m.id = a.meeting_id
    where m.series_id='${ss}' and m.starts_at > now() and a.staff_id='${who}'`;
  const nOcc = occs.length;
  await expectOk('the organizer moves one occurrence', S, `update ops.meeting set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id='${occs[4] ?? occs[nOcc - 1]}'`);
  const mv = occs[4] ?? occs[nOcc - 1];
  const mvIdx = occs.indexOf(mv);
  await expectVal('a new series starts with every occurrence unanswered', rs(O), Array(nOcc).fill('invited').join(','));
  await expectOk('Outreach accepts the first occurrence', O, `update ops.meeting_attendee set rsvp='accepted' where meeting_id='${occs[0]}' and staff_id='${O}'`);
  const want = (skip) => occs.map((_, i) => (i === skip ? 'invited' : 'accepted')).join(',');
  await expectVal('...every later occurrence is accepted too (a moved one is left alone)', rs(O), want(mvIdx));
  await expectVal('...the other person is still unanswered everywhere', rs(T2), Array(nOcc).fill('invited').join(','));
  await expectVal('...the series answer is remembered', `select rsvp from ops.meeting_series_response where series_id='${ss}' and staff_id='${O}'`, 'accepted');
  await expectVal('...the organizer got one answer, not one per occurrence',
    `select count(*) from ops.notification where recipient_id='${S}' and kind='meeting_response' and actor_id='${O}' and meeting_id = any (array(select id from ops.meeting where series_id='${ss}'))`, 1);
  await expectOk('Outreach declines one occurrence only', O, `update ops.meeting_attendee set rsvp='declined' where meeting_id='${occs[2]}' and staff_id='${O}'`);
  await expectVal('...only that one changed', rs(O), occs.map((_, i) => (i === mvIdx ? 'invited' : i === 2 ? 'declined' : 'accepted')).join(','));
  await expectOk('the second person declines one and says maybe to another', T2, `update ops.meeting_attendee set rsvp='declined' where meeting_id='${occs[1]}' and staff_id='${T2}'`);
  await expectOk('...maybe', T2, `update ops.meeting_attendee set rsvp='tentative' where meeting_id='${occs[2]}' and staff_id='${T2}'`);
  await expectOk('...then accepts a later one', T2, `update ops.meeting_attendee set rsvp='accepted' where meeting_id='${occs[3]}' and staff_id='${T2}'`);
  await expectVal('...their decline and maybe stay, every other unanswered one is accepted',
    rs(T2), occs.map((_, i) => (i === 1 ? 'declined' : i === 2 ? 'tentative' : i === mvIdx ? 'invited' : 'accepted')).join(','));
  await expectVal('...a decline of one occurrence is not a series answer', `select count(*) from ops.meeting_series_response where series_id='${ss}' and rsvp <> 'accepted'`, 0);

  const gone = await val(`select occurrence_date::text from ops.meeting where id='${occs[3]}'`);
  await val(`delete from ops.meeting where id='${occs[3]}'`);
  await val(`select ops.generate_series_meetings('${ss}')`);
  await expectVal('the nightly job brings a missing occurrence back already accepted',
    `select a.rsvp from ops.meeting_attendee a join ops.meeting m on m.id = a.meeting_id where m.series_id='${ss}' and a.staff_id='${O}' and m.occurrence_date = '${gone}'`, 'accepted');
  await expectVal('...and nothing else changed', `select count(*) from ops.meeting where series_id='${ss}' and starts_at > now()`, nOcc);
  await expectVal('...it created no new invitation', `select count(*) from ops.notification where recipient_id='${O}' and dedupe_key like 'series:${ss}:%'`, 1);

  await expectOk('the series time changes', S, `update ops.meeting_series set start_time = '14:00' where id='${ss}'`);
  await expectVal('...regenerated occurrences are still accepted (the answer is not lost)',
    `select bool_and(a.rsvp = 'accepted') from ops.meeting_attendee a join ops.meeting m on m.id = a.meeting_id
      where m.series_id='${ss}' and m.starts_at > now() and not m.customised and a.staff_id='${O}'`, true);

  await expectErr('someone outside the series cannot answer it', V, `select ops.answer_meeting_series('${ss}', 'declined')`, 'not invited');
  await expectErr('the organizer cannot decline their own series', S, `select ops.answer_meeting_series('${ss}', 'declined')`, 'organizer');
  await expectErr('only accepted, maybe or declined', O, `select ops.answer_meeting_series('${ss}', 'invited')`, 'Choose');
  await expectOk('Outreach declines every upcoming occurrence at once', O, `select ops.answer_meeting_series('${ss}', 'declined')`);
  await expectVal('...all of them, including the moved one',
    `select bool_and(a.rsvp = 'declined') from ops.meeting_attendee a join ops.meeting m on m.id = a.meeting_id where m.series_id='${ss}' and m.starts_at > now() and a.staff_id='${O}'`, true);
  await expectVal('...and the series answer is declined', `select rsvp from ops.meeting_series_response where series_id='${ss}' and staff_id='${O}'`, 'declined');
  await expectVal('...new occurrences arrive declined, not as new invitations',
    `select count(*) from ops.meeting_attendee a join ops.meeting m on m.id = a.meeting_id where m.series_id='${ss}' and a.staff_id='${O}' and a.rsvp = 'invited'`, 0);
  await expectOk('Outreach changes their mind for the whole series', O, `select ops.answer_meeting_series('${ss}', 'accepted')`);
  await expectVal('...every upcoming occurrence is accepted again',
    `select bool_and(a.rsvp = 'accepted') from ops.meeting_attendee a join ops.meeting m on m.id = a.meeting_id where m.series_id='${ss}' and m.starts_at > now() and a.staff_id='${O}'`, true);
  await expectVal('running the generator again makes nothing new', `select ops.generate_series_meetings()`, 0);

  await expectRows('Outreach sees their own series answer', O, `select 1 from ops.meeting_series_response where series_id='${ss}'`, 1);
  await expectRows('...the second person sees only their own', T2, `select 1 from ops.meeting_series_response where series_id='${ss}'`, 1);
  await expectRows('...the organizer sees every answer', S, `select 1 from ops.meeting_series_response where series_id='${ss}'`, 2);
  await expectErr('nobody can write an answer directly', O, `insert into ops.meeting_series_response (series_id, staff_id, rsvp) values ('${ss}', '${O}', 'declined')`, 'row-level security');

  await expectOk('someone is added to the series later', S, `update ops.meeting_series set staff_ids = array['${O}','${T2}','${W}']::uuid[] where id='${ss}'`);
  await expectVal('...they get one invitation', `select count(*) from ops.notification where recipient_id='${W}' and kind='meeting_invite' and dedupe_key = 'series:${ss}:${W}'`, 1);
  await expectOk('the series is edited again', S, `update ops.meeting_series set title = 'ZZ Answer sync 2' where id='${ss}'`);
  await expectVal('...nobody is invited twice', `select count(*) from ops.notification where kind='meeting_invite' and dedupe_key like 'series:${ss}:%'`, 3);
  await expectOk('someone is taken off the series', S, `update ops.meeting_series set staff_ids = array['${O}','${W}']::uuid[] where id='${ss}'`);
  await expectVal('...their series answer goes too', `select count(*) from ops.meeting_series_response where series_id='${ss}' and staff_id='${T2}'`, 0);

  // ------------------------------------------------------------ reminders and automation
  console.log('Reminders and automation');
  const rm = await mk('a meeting later today', S, 'title, starts_at, ends_at', `'ZZ Today huddle', now() + interval '1 minute', now() + interval '31 minutes'`);
  await expectOk('invite', S, `insert into ops.meeting_attendee (meeting_id, staff_id) values ('${rm}', '${O}')`);
  const sent = Number(await val(`select ops.run_meeting_reminders()`));
  sent >= 2 ? ok('everyone coming is reminded on the morning of the meeting') : bad('everyone coming is reminded on the morning of the meeting', `sent ${sent}`);
  await expectNotes('...the invitee has one reminder', O, 'meeting_reminder', rm, 1);
  await expectVal('running the reminders again sends nothing', `select ops.run_meeting_reminders()`, 0);
  await expectErr('users cannot send reminders directly', S, `select ops.run_meeting_reminders()`, 'permission denied');
  await expectErr('users cannot run the series generator directly', S, `select ops.generate_series_meetings()`, 'permission denied');
  await expectErr('users cannot send meeting notifications directly', S, `select ops.notify_meeting('${O}','meeting_reminder',null,null,'x')`, 'permission denied');
  await expectOk('the page-load automation still runs for a user', S, `select ops.run_task_automation()`);
  await expectVal('...and reports the meeting work', `select ops.run_task_automation() ?& array['created','meetings','meeting_reminders']`, true);
}
