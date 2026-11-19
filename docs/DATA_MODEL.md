# Data model (schema `ops`)

36 tables, 5 views, enums `department`, `app_role`, `lifecycle_stage`. Source of truth:
`supabase/migrations/`. Keys are `uuid` (`gen_random_uuid()`), money `numeric(12,2)` INR, times `timestamptz`.

## Tables by group
| Group (migration) | Tables | Owner dept |
| --- | --- | --- |
| Core (0001) | `staff` (1:1 `auth.users`), `institution`, `contact`, `task`, `feedback`, `audit_log`, `kpi_target`, `kpi_snapshot` | shared |
| Access (0009) | `invite` | founder |
| Outreach (0002) | `activity` | Outreach |
| Sales (0002) | `deal`, `deal_line` | Sales |
| Workshop (0003) | `event`, `event_staff`, `cohort`, `run_sheet_template`, `run_sheet_item` | Workshop |
| Inventory (0003) | `item`, `kit`, `kit_component`, `location`, `stock_movement`, `stock_reservation` | Workshop |
| Training (0004) | `trainer_profile`, `training_program`, `enrollment` | Training |
| Product (0005) | `ide_user_snapshot`, `ph_user_daily`, `ph_session`, `insight`, `review_item`, `observation`, `incident`, `catalog_request` | Product |
| Community (0006) | `content_item` | Community |

## Views (all `security_invoker`)
`v_stock` (on_hand, in_warehouse, reserved, available per item), `v_stock_by_location`,
`v_low_stock`, `v_certified_trainer`, `v_cohort_activation` (per cohort: signed_up, compiled_7d,
flashed_7d, published).

## Key relationships
```
institution 1-* contact, activity, deal, event, enrollment(teachers), content_item, feedback
deal 1-* deal_line ; deal 1-0..1 event (created when Won)
event 1-1 cohort ; event 1-* run_sheet_item, event_staff, stock_reservation, stock_movement
kit *-* item (kit_component) ; item 1-* stock_movement ; location 1-* stock_movement
staff 1-0..1 trainer_profile ; staff/contact 1-* enrollment -> training_program
cohort.code <- ide_user_snapshot.cohort_code (joins workshop to product usage)
ph_session 1-1 review_item 1-* observation *-1 insight ; feedback *-1 insight
```

## Tasks (0018)
`task` carries description, `due_time` (India), `estimate_minutes`, `parent_task_id` (one level), `assigned_by` / `assigned_at`,
`accepted_at`, `blocked_reason`, `cancel_reason`, `completed_at` / `completed_by`. `task_history` (task, actor, `kind`,
`from_value`, `to_value`, `note`, `at`) is written only by a trigger; assignees are stored by name. `task_comment`
(task, author, body 1-4000). Both child tables cascade with the task and have RLS that follows task visibility.

## Task collaboration (0019)
`task` gains `start_date`, `recurrence_id` and `period_start` (which fixed task and which period generated it). New tables:
`task_watcher` (task, person), `notification` (recipient, kind, task, actor, message, `read_at`), `task_recurrence` (a fixed task:
title, department, priority, estimate, frequency, weekday / month day, due offset and time, start and end dates, whole department
or `staff_ids`, active) and `task_view` (owner, name, query string, shared). `task_comment.mentions` lists the people mentioned.

## Time and daily log (0020)
`time_entry` (person, task, `source` timer or manual, `work_date`, `started_at`, `ended_at`, `minutes` 1-960, note); a partial
unique index allows one running timer per person. `daily_log` (person, `log_date`, `did`, `next_up`, `blockers`; unique per person
per day). Helpers: `today_ist()`, `leads_staff()`, `can_track_time()`. `run_task_automation()` now also closes stale timers.

## Meetings and calendar (0022)
`meeting` (title, description, kind team / one_to_one / review / institution / other, department, visibility invitees / department /
company, status requested / scheduled / cancelled / declined, `starts_at`, `ends_at`, location, organizer, host and awaiting (requests),
cancel reason, optional institution, deal and event, `series_id`, `occurrence_date`, `customised`). `meeting_attendee` (meeting, person,
rsvp invited / accepted / tentative / declined, note, responded_at). `meeting_series_response` (one answer per person per series, written only by the database), `meeting_series` (a fixed meeting: title, kind, department,
visibility, frequency weekly / biweekly / monthly, weekday or month day, start time, duration, start and end dates, `all_department`
or `staff_ids`, active). `notification` gains `meeting_id` and the kinds meeting_invite, request, response, update, cancel, reminder.
Functions: `answer_meeting_request`, `calendar_busy`, `generate_series_meetings`, `run_meeting_reminders`; `run_task_automation()`
also returns `meetings` and `meeting_reminders`. The calendar reads `meeting` and `event` (Workshop); nothing is copied between them.

## Jobs, snapshots and the Cockpit (0024 to 0026)
0024: `job_run` (one row per job run), `kpi_snapshot` (one row per metric, dimension and day), `run_job(name)`, `job_health()`,
`write_kpi_snapshot(date)`, retention (`purge_attendance`). 0025: view `v_funnel_steps` and `ide_funnel()`.
0026 (D60): view `v_task_timeliness` (one row per task: original and current deadline, `bucket` early / on_time / late, `days_late`
in working days, estimate, logged and blocked minutes, deadline moves, reopens, reassigns), table `backlog_snapshot` (nightly open,
overdue, blocked and no-deadline counts per day, department and person; read-only for everyone, written by `write_kpi_snapshot`),
functions `working_days(from, to)` (Mon to Fri) and `task_bucket(finished, due_date, due_time)`.

## Optional department, category and task groups (0028, D62)
`task.department` is nullable; `task.category` (`internal` | `other`, check `task_category_check`); `task.group_id` (uuid, no foreign key,
partial index `task_group_idx`) links the per-person tasks created together. `backlog_snapshot.department` is nullable with two partial
unique indexes (`backlog_snapshot_key`, `backlog_snapshot_key_nodept`). Functions: `leads_task_assignee(assignee)`, `create_task_group(...)`
(returns the new ids), `group_owner_check`, `update_task_group(task, ...)`, `cancel_task_group(task, reason)`. `task_manager`, the task
policies and `task_guard` were rewritten for tasks with no department.

## HR foundations (0029, D63)
`staff.is_hr` (boolean, default false; guard trigger `staff_hr_flag`). Functions `can_hr()`, `log_hr_access(target, what)`; `me()` reports
`is_hr`. Table `hr_access_log` (actor_id, target_id, what, at; select-only policy for HR and the person concerned, written only by
`log_hr_access`).

## Polymorphic links
`task.entity_type/entity_id` ('institution' | 'deal' | 'event' | 'item') links a task to any record; no FK.
Use it for "related record" chips in the UI. `audit_log.table_name/row_id` likewise.

## Conventions
- `updated_at` maintained by `ops.touch_updated_at()` where present.
- Audit triggers (`ops.audit()`) on institution, deal, event, stock_movement, kpi_target, staff, invite.
- Enums as `text + check` for rarely-changing business vocab (stages, kinds); Postgres enums only for
  department, role, lifecycle stage. Adding a stage/kind = new migration altering the check.
- Indexes exist on the hot paths (task assignee/status/due, activity by institution, deal stage, event by
  trainer/start, stock by item+location, review queue). Re-check with `EXPLAIN` once real volume exists.
- Everything has RLS; see `ACCESS_MODEL.md`.

## Functions (callable surface)
Read helpers: `my_role()`, `is_founder()`, `in_dept(d)`, `can_write()`, `me()`.
User RPCs (authenticated): `claim_access()`, `me()`, `invite_staff(email, role, departments, name)`,
`revoke_invite(id)`, `available_trainers(from, to, exclude_event)`, `import_institutions(rows jsonb, dry_run)`, `forget_ide_user(id, email)` (0013), `update_staff_access(staff, role, departments, is_active)` (founder only, 0010), `reserve_kit(event, kit, qty)`, `issue_kit(event, kit, qty,
from, to)`, `close_event_returns(event, field_loc, back_loc, returns jsonb, note)`.
Service jobs (service_role only): `assign_review_queue(day, quota)`, `raise_low_stock_tasks()`,
`request_part(query, source)`.
Triggers hold the rest (see `BUSINESS_RULES.md`).

`close_event_returns` payload: `[{"item_id": "...", "returned": n, "damaged": n, "lost": n}, ...]`.

## Staff profile and directory (0031, 0035)
`ops.staff_profile` (pk and fk `staff_id` -> staff, cascade): personal fields `legal_name, birth_date, personal_email, personal_phone, address, emergency_name, emergency_phone, emergency_relation, blood_group, photo_path, birthday_visible`; HR-owned fields `employee_code` (unique), `designation, joined_on, employment_type, probation_end, manager_id` (-> staff, set null); `created_at, updated_at, updated_by`. RLS: select and update for the person (employees only) and HR; insert for HR; no delete. Guard trigger `staff_profile_guard`, seed trigger `staff_profile_seed` on `staff`.
Functions: `is_employee()`, `hr_profile(staff)` (logged), `directory()`, `directory_events(month)`.

## Documents and policies (0033)
`ops.staff_document` (staff, kind, title, storage path, mime, size, expires_on, verified_at/by, verify_note), `ops.company_document` (title, kind, audience, summary, path, mime, size, version, retired_at), `ops.policy_ack` (document, version, staff, `at`). Private storage bucket `hr-docs` (created in the migration; policies on `storage.objects` use `ops.hr_doc_object_ok(name, mode)`).
Functions: `add_staff_document`, `open_staff_document` (logged), `verify_staff_document`, `delete_staff_document`, `publish_company_document`, `retire_company_document`, `acknowledge_document`, `expiring_documents(days)`, `policy_ack_summary()`.

## HR requests and onboarding (0034)
`ops.hr_request` (staff, kind, subject, details, state, resolution, closed_at), `ops.hr_request_message` (request, author, body, `internal`), `ops.onboarding_template` (kind, title, detail, owner, due_offset, position, is_active), `ops.onboarding_task` (staff, kind, title, detail, owner, assignee, due_on, position, done_at/by).
Functions: `create_hr_request`, `add_hr_request_message`, `set_hr_request_state`, `start_onboarding`, `set_onboarding_task`, `onboarding_progress(staff)`.

## Leave (0032, D64)
`leave_type` (code, name, paid, has_balance, `annual_quota`, carry_forward, carry_cap, count_weekends, count_holidays, half_day_allowed,
needs_document, is_active, sort_order; unique code and unique lower-cased name), `leave_request` (staff, type, from and to date, day_part
full / first_half / second_half, days, reason, state pending / approved / rejected / cancelled, decided_by / at, decision_note),
`leave_ledger` (staff, type, year, kind credit / carry / debit / reversal / adjustment, days, request, note, created_by; unique partial
indexes keep one credit and one carry per person, type and year). Functions: `can_take_leave()`, `leave_eligible(staff)`,
`leave_days(type, from, to, part)`, `leave_ensure_credit`, `apply_leave`, `decide_leave`, `cancel_leave`, `hr_adjust_balance`,
`credit_annual_quota(year)`, `leave_balances(staff, year)`, `team_away(from, to)`. `attendance_grid` and `attendance_month` gain trailing
columns `leave_name` and `leave_half`; `office_holiday` writes are now HR (`can_hr()`), not only the founder.

## Adding to the model
New migration file; RLS + policies + grants in the same file; tests in `tools/test-migrations.mjs`;
update this doc and `BUSINESS_RULES.md`; regenerate `all_migrations.sql` and the TypeScript types.
