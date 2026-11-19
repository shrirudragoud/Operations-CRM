# Business rules

All rules below are enforced in Postgres (`supabase/migrations/0007_business_logic.sql` unless noted) and
covered by `tools/test-migrations.mjs`. The UI must surface the raised error message to the user.
`auth.uid() is null` (service role / SQL editor / migrations) bypasses user-level guards by design.

## Institution
| Rule | Enforced by | Error |
| --- | --- | --- |
| Stage only moves forward; founder can correct; `churned` always allowed | trigger `t_institution_stage` | "Institution stage cannot move backwards" |
| Qualified activity -> stage `qualified` + a Sales deal at *meeting* if no open deal | `on_activity` | n/a |
| Interested / not_interested / follow_up outcome on a prospect -> `contacted` | `on_activity` | n/a |
| Activity with next step + due date -> follow-up task for the author | `on_activity` | n/a |

## Tasks (`0018`, `ops.task_guard`)
| Rule | Enforced by | Error |
| --- | --- | --- |
| New tasks start *todo*; `created_by` is the caller | `task_guard` | n/a |
| Only a manager (founder, creator, lead of the task's department) changes title, description, department or parent | `task_guard` | "Only the person who created this task, a department lead or a founder can ..." |
| Anyone can claim an unassigned task or hand back their own; any other reassignment needs a manager | `task_guard` | "Only the person who assigned this task, a department lead or a founder can reassign it" |
| Reassigning stamps `assigned_by` / `assigned_at` and clears `accepted_at` (self-assignment is accepted at once) | `task_guard` | n/a |
| Only the assignee accepts; acceptance cannot be undone; the assignee starting or finishing counts as accepting | `task_guard` | refused for anyone else |
| Status path: todo <-> doing, blocked, done, cancelled; done reopens to todo/doing, cancelled to todo; reopening needs a manager or the person who finished it | `task_guard` | "Task cannot move from X to Y" |
| Blocked needs a reason; cancelled needs a reason; reasons clear when the status moves on | `task_guard` | "... needs a reason" |
| A parent cannot be done or cancelled while subtasks are open; subtasks are one level deep | `task_guard` | "Finish or cancel the subtasks first" |
| Every change is written to `task_history`; users cannot write it | AFTER trigger, RLS | n/a |
| Comments: author forced to the caller, 1-4000 characters; author or founder deletes | trigger, RLS | n/a |
| Delete: department leads and founders only | RLS | n/a |

## Task collaboration (`0019`)
| Rule | Enforced by | Error |
| --- | --- | --- |
| A task can have a start date; it cannot be after the deadline. Start date, deadline and time are not manager-only: whoever can update the task (assignee, creator, anyone in its department, founder) can reschedule it | `task_guard`, RLS | "The start date cannot be after the deadline" |
| Watchers see a task and are notified of its changes. The creator, assignee, anyone who comments and anyone @mentioned are added automatically. A person removes themselves; managers remove anyone | trigger `auto_watch`, RLS | n/a |
| Notifications are written only by triggers (assigned to you, status change, comment, @mention, due today, overdue); a person reads and clears their own | triggers, RLS | n/a |
| A fixed task (`task_recurrence`) repeats daily, on weekdays, weekly or monthly for the whole department or picked people. Only a founder or a lead of that department sets one up | RLS, `run_task_recurrences` | n/a |
| Generation is idempotent: at most one task per eligible person per period, so running it again creates no duplicates | `run_task_recurrences` (unique on recurrence, assignee, period) | n/a |
| Saved views store a task filter; private by default, or shared with the team. Only the owner changes or deletes one | RLS | n/a |

## Time tracking and the daily log (`0020`)
| Rule | Enforced by | Error |
| --- | --- | --- |
| Time is tracked by internal people who can write; partners and viewers cannot | `can_track_time`, RLS | "Only team members can track time" |
| One running timer per person; starting a new one stops the old one | unique index, `time_entry_guard` | n/a |
| A timer's start, end and length are set by the database, never the browser. A forgotten timer is capped at 12 hours and closed by the automation | `time_entry_guard`, `close_stale_timers` | n/a |
| Manual entries: 1 minute to 16 hours, not for a future day, not older than 30 days (founder exempt) | `time_entry_guard` | "You can't log time for a future day" / "Time can only be logged for the last 30 days" |
| No more than 24 hours on one day per person | `time_entry_guard` | "That would be more than 24 hours on one day" |
| A person edits or deletes their own entries for 14 days; the task, person and source of an entry never change; a stopped timer keeps its length and can only change its note | RLS, `time_entry_guard` | "Only the length, the day and the note of an entry can change" |
| Finishing or cancelling a task stops any timer running on it | trigger `stop_timers_on_finish` | n/a |
| Time is visible to the person, the task's managers and the founder | RLS | n/a |
| Daily log: one note per person per day (what I did, what is next, what is blocking me); written for the last 7 days, not the future; the person and day never change | `daily_log_guard`, RLS | "The daily log can only be written for the last 7 days" |
| A daily log is read by its author, the founder, and a department lead who shares a department with the author | `leads_staff`, RLS | n/a |

The app no longer shows the daily log (D50); the table and these rules remain in the database.

## Task health (advice only, app code, D48 to D50)
Health (overdue, at risk, due today, soon, on track) is worked out in `lib/task-health.ts` from the task row and the clock. It colours chips, cards and calendar entries and never blocks or changes a task, so nothing is enforced in the database and there is no error message. The on-time rate (finished tasks with a deadline, last 30 days, India date) is read the same way.

## Meetings and the calendar (`0022`, `ops.meeting_guard`)
| Rule | Enforced by | Error |
| --- | --- | --- |
| Internal people (not partners) schedule or request meetings; the organizer is always the caller; a new meeting starts in the future (5 minutes of grace) | RLS, `meeting_guard` | "Pick a start time in the future" |
| The organizer is added as accepted; a request also adds the person asked (host) and waits on them | `meeting_after_ins` | "Choose who you are asking for the meeting" |
| Only the person a request waits on answers it: accept, decline with a reason, or suggest another time (which hands it back to the asker) | `answer_meeting_request` | "Only the person asked to respond can answer this request" / "Say why you are declining" |
| Cancelling needs a reason; cancelled and declined meetings are frozen | `meeting_guard` | "Say why the meeting is cancelled" / "A cancelled meeting can not be changed" |
| Moving a meeting resets everyone's answers to invited and tells them; a changed fixed-meeting occurrence is marked `customised` | `meeting_guard`, `meeting_after_upd` | n/a |
| The organizer cannot decline or be removed from their own meeting; people answer only for themselves; only active team members can be invited | attendee guard, RLS | "The organizer can not decline; cancel the meeting instead" |
| A meeting is visible to the founder, its organizer, the person asked, invitees, and (internal people) anyone it is open to: its department (`department`) or the company (`company`). Only the founder opens a meeting to the company, only the founder or that department's lead to a department | RLS, `meeting_guard` | "Only the founder or a lead of that department can open a meeting to the whole team" |
| Edit or cancel: organizer, founder or the department's lead; delete: organizer or founder | RLS | n/a |
| Fixed meetings: weekly, every two weeks or monthly (day 1 to 28); generated 35 days ahead, idempotent; pausing stops new ones; "everyone in the department" is for the founder or that department's lead and includes later joiners | `meeting_series_after`, `generate_series_meetings`, RLS | "Only the founder or a lead of that department can set up a meeting for a whole team" |
| One answer per series: accepting any upcoming occurrence accepts the upcoming unanswered ones (own decline / maybe and customised occurrences are kept); decline or maybe on one affects only that one; "all upcoming" overrides; new occurrences inherit the answer; one invitation per person per series; the organizer cannot decline their own series | `meeting_attendee_series_accept`, `answer_meeting_series`, `generate_series_meetings`, RLS on `meeting_series_response` | "You are not invited to that fixed meeting"; "The organizer can not decline their own series" |
| Invitees are told of an invite, request, answer, move, cancel; a reminder goes out on the morning of the meeting | triggers, `run_meeting_reminders` | n/a |
| Double-booking is allowed; `calendar_busy` lists clashes (meetings and Workshop events) for the form | `calendar_busy` | n/a |

## Deals
| Rule | Enforced by | Error |
| --- | --- | --- |
| New deals start at *meeting* (founder/service excepted) | `deal_insert_guard` | "New deals must start at the Meeting stage" |
| Allowed moves: meeting->proposal/lost; proposal->meeting/negotiation/lost; negotiation->proposal/won/lost; lost->meeting | `deal_transition` | "Deal cannot move from X to Y" |
| Won is final | `deal_transition` | "A won deal cannot change stage" |
| Only the founder can mark Won; `won_at` stamped | `deal_transition` | "Only the founder can mark a deal as won" |
| Lost needs a reason; leaving lost clears it | `deal_transition` + check | "A lost reason is required" |
| Deal types: `workshop`, `fdp` (Faculty training), `lab_setup` (Lab deal), `other` | check `deal_kind_check` | check violation |
| One open deal per type per institution; different types may run in parallel | unique index `deal_one_open_per_kind` | duplicate key value violates `deal_one_open_per_kind` |
| Won workshop/fdp -> draft event + `trainer_request` (training) + `reserve_kits` (workshop) tasks; institution -> `deal_won`. Won `lab_setup` -> `plan_lab_setup` task. Won `other` -> `plan_other_deal` Sales task only | `on_deal_won` | n/a |
| `institution.segment` (school / college / other) is derived from `kind`; `v_funnel` and `v_pipeline` report by segment and deal type | generated column + views | n/a |
| A deal value cannot be negative | `deal_guard` (0016) | "A deal value cannot be negative" |
| Once Won, only the founder can change a deal's value, type, institution, owner, title, chance or close date | `deal_guard` (0016) | "Only the founder can change a won deal" |
| Only the founder can change the proposal lines of a Won deal | `deal_line_guard`, `replace_deal_lines` (0016) | "Only the founder can change the lines of a won deal" |
| Proposal lines are replaced as one atomic set (max 100, description, quantity above zero, price not negative); Sales or the owning partner only | `replace_deal_lines` (security definer, same access check as `deal_upd`) | "You do not have permission to change this deal" / line errors |
| Community memberships (club / ambassador / other): readable by internal staff, written by Community, deleted by Community lead/founder; unique per institution + kind + name | RLS `community_membership_*` | permission error |

## Events
| Rule | Enforced by | Error |
| --- | --- | --- |
| New events start as draft | `event_guard` | "New events must start as draft" |
| Moves: draft->scheduled/cancelled; scheduled->draft/in_progress/completed/cancelled; in_progress->completed/cancelled | `event_guard` | "Event cannot move from X to Y" |
| Scheduling needs lead trainer, start, end, venue, expected headcount | `event_guard` | "To schedule an event set: ..." |
| Lead trainer must be certified (enrollment certified in an `internal_trainer` program) or founder role | `event_guard` | "Lead trainer is not certified" |
| No trainer double-booking (lead or assistant) across scheduled/in-progress events | `trainer_conflict`, `event_guard`, `event_staff_guard` | "already booked" |
| Scheduled -> cohort code `HC-XXXX` (unambiguous alphabet) + run sheet copied from template | `on_event_status` | n/a |
| Completing needs actual headcount and all pre/day run-sheet items done | `event_guard` | "Enter actual headcount..." / "Finish all pre-event and event-day run sheet items first" |
| Completed -> tasks: send_survey (+1d), close_returns (+2d), collect_photos (+3d, community), college_report (+5d); institution -> `workshop_delivered` | `on_event_status` | n/a |
| Cancelled -> reservations released | `on_event_status` | n/a |
| Cancelling needs a reason (`cancel_reason`) | `event_guard` | "Say why the event is cancelled" (UI); database: "A cancellation reason is required" |
| Assistants are conflict-checked like the lead; at most 2 assistants; the team is saved as one set by `set_event_team` (certified lead, refused on completed/cancelled events) | `event_staff_guard`, `set_event_team` | "already booked" / "An event can have at most 2 assistants" |
| An in-progress event re-checks the lead when its dates or lead change | `event_guard` | "already booked" |
| Run-sheet `done_by` / `done_at` are stamped by the database (first stamp kept); a cancelled event's run sheet is frozen | `run_sheet_stamp` | n/a |

## Inventory (stock is a ledger)
| Rule | Enforced by | Error |
| --- | --- | --- |
| Balance per item+location can never go negative (advisory-locked, race-safe) | `guard_stock` | "Insufficient stock..." |
| received > 0; sold/damaged/lost < 0; damaged/lost/adjustment need a note | check constraints | check violation |
| `reserve_kit`: only draft/scheduled events; cannot exceed *available* (warehouse+store stock minus reserved) | RPC | "Not enough SKU available..." |
| `issue_kit`: only scheduled/in-progress events; paired movements (-from, +to); reservations -> fulfilled | RPC | "Kits can only be issued..." |
| `close_event_returns`: needs a line for every issued item; returned+damaged+lost = issued; note required for loss/damage; once only; raises `review_kit_loss` task | RPC | "must equal issued" / "note is required" / "already closed" |
| `v_stock`: `on_hand` (everywhere), `in_warehouse`, `reserved`, `available = in_warehouse - reserved` | view | n/a |
| `raise_low_stock_tasks()` (service job): one open `low_stock` task per item where available < reorder level | function | n/a |

## Training
| Rule | Enforced by |
| --- | --- |
| Certified enrollment needs `certified_at` | check constraint |
| Last enrolled teacher at an institution certified -> institution `teachers_trained` | `on_enrollment` |

## Product
| Rule | Enforced by |
| --- | --- |
| Observation insert marks its review item reviewed | `on_observation` |
| Skipping a review item needs a reason | check constraint |
| `assign_review_queue(day, quota)` round-robins highest-signal sessions (rage clicks, errors) across active product reviewers | function (service job) |
| `request_part(query, source)` dedupes by normalised query and counts requests | function (service job) |
| Feedback with no owner department is routed by source | `route_feedback` |

## Archive (0011)
| Rule | Enforced by | Error |
| --- | --- | --- |
| Institutions, deals and events are archived (`archived_at`, `archived_by`), not deleted; restore clears them | columns + `guard_archive` | n/a |
| Only founder or dept_lead can archive/restore (partners and members cannot) | `guard_archive` | "Only a founder or department lead can archive or restore records" |
| Institution: no open deals, no scheduled/in-progress events | `guard_archive` | "Close or archive the institution's open deals first" / "Cancel or complete ..." |
| Deal must be won or lost; event must not be scheduled/in progress | `guard_archive` | "Mark the deal won or lost ..." / "Cancel or complete the event ..." |
Screens hide archived rows by default (`archived_at is null`). 0012: `trainer_conflict` is no longer callable by users.

## Core completion (0013)
| Rule | Enforced by | Error |
| --- | --- | --- |
| `available_trainers(from, to, exclude_event)` lists certified (or founder) active staff with `is_free`; Workshop (and founder) only; `exclude_event` stops a re-scheduled event blocking itself | definer RPC | "Only Workshop can look up trainer availability" / "Choose a valid start and end" |
| `import_institutions(rows, dry_run)`: validates every row (name, kind, case-insensitive duplicates in file and database, owner email); any error or dry run writes nothing; max 2000 rows; partners' rows are always owned by themselves; viewers and non-Outreach/Sales cannot import | invoker RPC (RLS applies) | "row N: Already exists" etc. in the returned `errors` list; "You do not have permission to import institutions" |
| `job_run`: founder-readable log; only the service role writes | RLS | n/a |
| `forget_ide_user(ide_user_id, email)`: deletes the IDE snapshot and daily usage, anonymises replay rows, unlinks feedback; founder/service only; audit entry holds counts only | definer RPC | "Only the founder can erase a user's data" |
| Trigram indexes on institution name and city for fast search (`ilike '%x%'`) | indexes | n/a |

## Access and team admin (0009, 0010)
| Rule | Enforced by | Error |
| --- | --- | --- |
| Sign-in grants nothing; an open, unexpired invite for the verified email becomes a staff row on first `claim_access()` | `claim_access` | n/a (returns `no_invite`) |
| Last active founder cannot be demoted, deactivated or deleted | `guard_last_founder` | "There must be at least one active founder" |
| Only the founder invites, revokes, or changes role/departments/active | `invite_staff`, `revoke_invite`, `update_staff_access` + RLS | "Only the founder can ..." |
| Partners have no departments; dept_lead/member/viewer need at least one | check constraints + `check_access_shape` | "Partners cannot belong to departments..." / "Choose at least one department..." |
| Cannot invite someone already on the team (deactivated -> reactivate instead) | `invite_staff` | "... is already on the team" / "... reactivate them ..." |
| Re-inviting an open invite refreshes role, departments and the 30-day expiry (one open invite per email) | `invite_staff` + unique index | n/a |
| Accepted invites cannot be revoked | `revoke_invite` | "Invite not found or already accepted" |
| A partner may open deals only at institutions they own | RLS `deal_ins` / `deal_upd` | permission error |
See `ACCESS_MODEL.md` for the full matrix.

## Attendance (`0023`, D51 to D56)
| Rule | Enforced by | Error |
| --- | --- | --- |
| Only the founder tags `works_from_office`; partners cannot be tagged; untagged people see nothing and are never late or absent | staff guard, RLS, `ops.can_attend()` | "Partners can't be tagged as working from the office" |
| Check in only from an active office network (caller IP from request headers, never sent by the client); a refusal is logged without the IP | `check_in`, `office_network` (`cidr`), `attendance_failure` | returns `not_on_network` |
| One open stretch at a time; several stretches a day are fine | partial unique index, `check_in` / `check_out` | "You're already checked in" / "You're not checked in" |
| Check-out from outside the office network is allowed but flagged (`off_network`) | `check_out` | n/a |
| Times come from the database clock, never the browser | RPCs | n/a |
| Office hours 11:00 to 17:00 IST, 15 minutes' leeway, Mon to Sat (editable by the founder). In by 11:15 is on time, out from 16:45 is a full day. Late and early are flags, never blocks | `office_settings`, `attendance_days`, `lib/attendance.ts` | "Office hours must end after they start" |
| Late, early and absent are hidden until the founder turns `flags_on` on (shadow mode) | `office_settings.flags_on` | n/a |
| Ask for the time: today or the last 7 days, not in the future, a reason; a lead or the founder approves or declines (a decline needs a note); never your own; approval cannot overlap recorded time | `request_attendance`, `decide_attendance_request` | "You can ask for today or any of the last 7 days" / "That overlaps time already recorded for this person" |
| Working remotely (with a reason) and a lead's excused day are not counted as absent; a lead's excuse cannot be overwritten by the person | `declare_remote`, `excuse_day`, `clear_day_mark` | "Your lead has already excused this day" |
| No check-out by end of day becomes "No check-out"; a lead sets the leaving time (after arrival, not future, within 16 hours) with a note | `flag_missing_checkouts`, `correct_checkout` | "Pick a leaving time after arrival, not in the future and within 16 hours of arriving" |
| Only the founder trusts a network, edits hours or holidays | `trust_this_network`, RLS | "Only the founder can do this" |
| A lead reads attendance for their departments; a member reads only their own | RLS, `attendance_days` | n/a |

## Scheduled jobs (0024)
| Rule | Where | Message |
|---|---|---|
| Only the jobs on the list can run; the name is matched, never executed as text | `run_job` | "Unknown job: x" |
| A job never overlaps itself; a second call while one runs is skipped | advisory lock in `run_job` | status `skipped` |
| Every run leaves a `job_run` row; a failure is recorded with its error and does not break the scheduler | `run_job` | status `failed` |
| A run still "running" after an hour is closed as "Did not finish" | `run_job` | n/a |
| One KPI snapshot row per metric per day; running again the same day overwrites | `write_kpi_snapshot` | n/a |
| Attendance older than two years (and its audit copies) is removed; failed check-in attempts after 90 days | `purge_attendance` | n/a |
| A job is overdue when it has no good run in three times its interval; only the founder can see this | `job_health` | "Only the founder can see this" |
| Only the service role runs jobs; nobody runs one from the app | grants | "permission denied" |

## Cockpit funnel (0025, D59)
| Rule | Where | Message |
|---|---|---|
| A funnel step counts institutions whose stage is that step or later; churned and archived are left out; every segment shows all six steps | `v_funnel_steps` | n/a |
| Student steps come from the IDE sync; with no one synced they read "not connected", never zero | `ide_funnel()` (`connected`), snapshot writes no `ide_students` rows | n/a |
| Staff (not partners) read the student totals; a person who cannot read student rows is not told "not connected" | `ide_funnel()` | "Not allowed" |
| The nightly snapshot keeps `funnel_reached` per step (all segments together) | `write_kpi_snapshot` | n/a |

## Operations insight (0026, D60)
| Rule | Where | Message |
|---|---|---|
| Saturday and Sunday are off; `working_days(from, to)` counts Monday to Friday, both ends included | `working_days` | n/a |
| Early = finished on an earlier Indian day than the deadline; on time = finished by the deadline (end of that day when it has no time); late = after it; no deadline or not finished = no verdict | `task_bucket` | n/a |
| `bucket` is judged against the **original** deadline (the first one ever set, from the task history; the current one if it was never changed); `bucket_now` against the current one | `v_task_timeliness` | n/a |
| `days_late` is counted in working days after the original deadline | `v_task_timeliness` | n/a |
| Deadline moves = history rows where the date went later; reopens, reassigns, blocked minutes and logged minutes are counted per task | `v_task_timeliness` | n/a |
| A reader sees only the tasks the task policy lets them see | `security_invoker` view | n/a |
| The nightly job also stores open, overdue (due before that day), blocked and no-deadline counts per department and person; running it twice the same day overwrites that day, older days stay | `write_kpi_snapshot` / `backlog_snapshot` | n/a |
| Only the founder, and a lead for their own departments or people, can read the backlog history; nobody edits it | RLS on `backlog_snapshot` | n/a |

## Optional department, categories and task groups (0028, D62)
| Rule | Where | Message |
|---|---|---|
| A task may have no department; a task with no department is seen by the assignee, creator, watchers, the founder and a lead who leads the assignee (not for the lead's own task) | `task_sel`, `leads_task_assignee` | n/a |
| That lead can also edit and delete such a task; a lead of another team and a colleague in neither team cannot see it | `task_upd`, `task_del`, `task_guard` | "...can edit its details" |
| Category is `internal` or `other` (or empty); only a manager of the task changes it | `task_category_check`, `task_guard` | "...can edit its details" |
| One task for several people is created as one task per person, linked by `group_id`, in one step; 1 to 20 people, repeats ignored, one person means no group; one person who cannot be given tasks cancels all | `create_task_group` | "Choose at least one person", "A task can be given to at most 20 people at once" |
| The group link cannot be set or changed by a direct insert or update | `task_guard` | n/a |
| Change shared details for the group, or cancel it: the creator or a founder only; open tasks only; cancelling needs a reason | `update_task_group`, `cancel_task_group` | "Only the person who created this group of tasks, or a founder, can ... for everyone", "Say why the tasks are cancelled" |
| Changing the department (including to or from none) is written to the task history | `task_guard` | n/a |
| The timeliness view and the nightly backlog snapshot include tasks with no department (stored with an empty department) | `v_task_timeliness`, `write_kpi_snapshot` | n/a |

## HR foundations (0029, D63)
- `staff.is_hr` is changed only by the founder (staff update is founder-only; the guard trigger `ops.staff_hr_flag` repeats it for any other caller). Viewers and partners can never be HR: the flag is cleared whenever the role is one of those.
- `ops.can_hr()` is true for the founder and for an active, non-viewer, non-partner person with `is_hr`. A deactivated HR person has no HR powers.
- `ops.hr_access_log`: one row each time HR opens another person's private record (`ops.log_hr_access(target, what)`, HR only; opening your own is not logged). HR and the founder read all rows; a person reads the rows about them. Nobody inserts directly.
- `ops.me()` includes `is_hr`. The UI's `isHr(me)` and the `hr` area mirror `can_hr()`.

## Staff profile and directory (0031, 0035)
- One private row per person in `ops.staff_profile` (created with the person; existing staff were back-filled). Personal fields (legal name, birth date, personal email and phone, address, emergency contact, blood group, photo path, `birthday_visible`) are edited by the person. HR-owned fields (employee code, designation, joined on, employment type, probation end, manager) are changed only by HR or the founder; `ops.staff_profile_guard` refuses anyone else (42501) and refuses moving a profile to another person.
- Who reads it: the person (only while they are an active, non-viewer, non-partner team member, `ops.is_employee()`), and HR/founder (`ops.can_hr()`). A department lead, another member, a viewer or a partner reads none of it. There is no delete policy; the row goes with the person.
- Checks: emergency contact name and phone come together; probation cannot end before the joined date; nobody is their own manager; a manager must be an active team member (not viewer/partner); the employee code is unique; the birth date is at least 14 years ago.
- HR opens a full record with `ops.hr_profile(staff)`, which writes `ops.hr_access_log` ("opened profile"); opening your own is not logged.
- The directory (`ops.directory()`) is a security definer function because a view could not read other people's profile rows: it returns work-contact columns only (name, work email, work phone, role, departments, designation, manager) for active non-partner staff, and only to team members (viewers and partners get nothing).
- `ops.directory_events(month)` returns birthdays only for people who ticked `birthday_visible` (day and month, never the year) and work anniversaries of one year or more from the joined date. A month outside 1 to 12 is refused.
- Not built: photo upload (the `photo_path` column exists, no screen uses it) and an audit trigger on `staff_profile` (`ops.audit()` needs an `id` column); HR reads are logged instead.

## Documents and policies (0033)
- Papers (`ops.staff_document`) are private: the person and HR/founder (`ops.can_hr()`) read them; a lead, another member, a viewer or a partner reads none. Files live in the private storage bucket `hr-docs` at `<staff id>/<uuid>-<file>`; company files at `company/<uuid>-<file>`. Uploads are PDF or image, at most 10 MB, checked by the server action (size, type, magic bytes, sanitised name).
- HR can read another person's file only for 10 minutes after `ops.open_staff_document(id)` wrote the `hr_access_log` row `opened document <path>` (storage policy `ops.hr_doc_object_ok`). The app hands out a 60 second signed link. Opening your own paper is not logged.
- A paper is pending, verified (`verify_staff_document(id, true)`) or declined (`verified_at` null, a `verify_note` kept; the person sees the reason). Only HR verifies, never their own paper, and declining needs a reason. A person adds only ID proof, address proof, education, certificate or other for themselves (offer letters, contracts and payslips are HR-added) and may delete their own paper only while it is not verified; HR may delete any, and that is written to the access log (`delete_staff_document` returns the path so the app removes the file).
- `expiring_documents(days)` lists papers whose expiry falls within the window (HR only).
- The library (`ops.company_document`) has an audience (everyone, leads, HR). Publishing and retiring are HR only; a retired document disappears from the library but its acknowledgements stay.
- `acknowledge_document(id)` records one acknowledgement per person per version (`policy_ack`); a second call changes nothing. `policy_ack_summary()` gives HR the counts.

## HR requests and onboarding (0034)
- A person asks HR (`create_hr_request`): kinds are experience letter, address proof, salary certificate, detail change, other. At most 10 requests may be open (open or in progress) at once.
- The thread (`hr_request_message`): the person and HR post; HR may mark a message `internal`, and internal notes are invisible to the person (RLS, not only the UI). A closed request accepts no new message from the person.
- States move only through `set_hr_request_state`, HR only: open, in progress, done, rejected, and back to open. Rejecting needs a note; the note becomes the resolution the person sees.
- Standard steps (`onboarding_template`, seeded with 7 joining and 6 leaving steps) are edited by HR through RLS. `start_onboarding(person, kind, date)` copies the active steps into `onboarding_task` with due dates counted from the first or last day; it refuses a person who has unfinished steps of that kind, a deactivated person for a joining list, and a kind that has no active steps.
- Tasks change only through `set_onboarding_task`: HR ticks any step; the person ticks steps owned by "the person"; the person a step is assigned to (a lead) may tick it. Everyone else is refused. `onboarding_progress` summarises done/total per person and kind (HR sees all, a person sees their own).
- No notification rows are written for requests: `ops.notification.kind` is a closed list and this build does not extend it.

## Leave (0032, D64)
- **The policy is data, set by HR on screen.** `ops.leave_type` holds, per type: paid, keeps a balance, days a year, carry forward and its cap, whether weekends and holidays inside a leave count, half days allowed, needs a document, in use. Seeded and editable: casual 12, sick 12, earned 15 (carries up to 30), comp-off 0 (granted by HR), unpaid (no balance). The code is fixed once created; names are unique ignoring case. Only HR/founder (`can_hr()`) insert or change types; nobody deletes (switch "In use" off instead).
- **Balances are a ledger** (`ops.leave_ledger`: credit, carry, debit, reversal, adjustment), never edited. The balance is the sum; days waiting for a decision are held against it. Nobody writes the ledger or requests directly: only `apply_leave`, `decide_leave`, `cancel_leave`, `hr_adjust_balance`, `credit_annual_quota`.
- **Counting days** (`leave_days`): each calendar day in the range counts unless it is a non-working day (`office_settings.work_days`) and the type does not count weekends, or an office holiday and the type does not count holidays. A half day is half of one counted day.
- **Apply** (`apply_leave`): the leave year is the calendar year, one year per request; at most 90 days; an employee may back-date at most 14 days and never into an earlier year; a half day needs a type that allows it and a single date; no overlap with an open request (a first half and a second half of the same date may coexist); the days must be at least half a day; balance minus pending must cover it. HR can record leave for someone else, which is approved at once.
- **Decide** (`decide_leave`): HR/founder for anyone, a department lead for someone in their own departments, never your own (42501); only pending requests; turning one down needs a reason of 3 or more characters; approving re-checks the balance and writes the debit.
- **Cancel** (`cancel_leave`): the owner while it is pending, or approved and not started; HR any time. An approved cancel writes a reversal, so the balance returns.
- **Adjust** (`hr_adjust_balance`): HR only, with a note; the balance may not go below zero; the year is this year, last year or next; adjusting someone else's balance is written to the HR access log.
- **Year start** (`credit_annual_quota` and the lazy `leave_ensure_credit`): the quota is credited once per person, type and year (unique index), with the carry-over from the earlier year capped by the type. Opening a balance does this on demand.
- **Who sees what:** a person their own requests and ledger; a lead their team's; HR and the founder everyone's. `team_away` shows names to the person's department mates, with the leave type only to leads, HR and the founder.
- **Attendance:** an approved leave on a scheduled working day shows as "On leave (Casual)" and is not counted absent (a full-day leave also stops that day being expected; a half day still expects the rest). Having checked in wins over leave; a holiday wins over leave.

## Not yet implemented (decide with the founder, then add as new migrations + tests)
- **Event `in_progress`:** manual button vs cron at `starts_at`.
- **Stage `active`:** proposal: institution becomes `active` when >= N distinct cohort students from it
  have a flash/compile in the last 14 days (compute nightly from `ide_user_snapshot`).
- **Stage `lab_customer`:** proposal: set when a `lab_setup` deal is won; also create a lab
  record and a recurring support/renewal task.
- **`renewal` / `churned`:** proposal: renewal task 60 days before contract end; churned manual.
- **Deal Won requires value > 0** unless a `free` flag is set (open question: are workshops free to win labs?).
- **Soft delete / archive** for institutions, deals, events.
- **Partner scorecard view.** (DPDP erasure is `forget_ide_user`, 0013; the KPI snapshot is written nightly by `run_job`, 0024.)
