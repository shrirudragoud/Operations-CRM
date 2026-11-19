# Plan: speed, task and meeting logic, employee portal (from 19 Nov 2026)

Status: **proposed, nothing built yet.** Estimates are for one engineer/agent. Decisions marked **(confirm)** are assumptions
until the founder says otherwise; record the final answers in `DECISIONS.md` as D61 onward.

## Order and why

| # | Phase | Size | Why here |
| --- | --- | --- | --- |
| 0 | Measure | 0.5 d | Nothing is tuned without numbers; also fixes a wrong line in `ARCHITECTURE.md`. |
| 1 | Move the database to Mumbai, cut network round trips | 1.5 d | Cheapest while there are 8 staff and 22 tasks. The portal will hold payroll and ID documents, which should start in India. Email/SMTP and Google sign-in are set up on the new project once, not twice. |
| 2 | Repeating meetings (one invite, accept once) | 1 d | Small, self-contained, a daily annoyance. |
| 3 | Tasks: several assignees, optional department, Internal and Other | 4 d | The riskiest schema change. Done before tuning so indexes and policies are tuned once. |
| 4 | Speed, part two: fewer calls per page, caching rules, volume hardening | 4 d | Tuned against the final task and meeting model, on seeded production-sized data. |
| 5 | Employee portal: profile, documents, payroll records | 7 to 9 d | Largest new surface, needs founder decisions, benefits from phases 1 and 4. |

Every phase ends with its own gate. No phase starts until the previous gate has passed.

## Standing rules for every migration (production logic)
1. One numbered migration file (`0027`, `0028`, ...): table, RLS, policies, grants and indexes together. Foreign keys always indexed.
2. Tests first for the rules: `tools/test-*.mjs` (PGlite) for DB behaviour, vitest for pure logic, one Playwright flow per user-visible rule.
3. Update `DATA_MODEL.md`, `BUSINESS_RULES.md`, `ACCESS_MODEL.md`, regenerate `lib/db.types.ts` and `all_migrations.sql`.
4. Local stack first (`supabase migration up`), then hosted only on the founder's go-ahead, after a dump of the `ops` schema taken just before.
5. Migrations add and relax; they never drop data in the same release (drop columns later, in their own migration).
6. Run Advisors after applying; no new ERROR, no new WARN without a written reason.
7. Nothing is committed or pushed without being asked.

---

## Phase 0: Measure (0.5 d)
Findings so far (measured 19 Nov 2026): data is tiny; the database is in **Tokyo (`ap-northeast-1`)**, not Mumbai; a warm call
costs about 160 ms; `proxy.ts` makes a network `auth.getUser()` on every request; new TLS connections stall about 3.3 s on this
network path (host and container).
- Add a `Server-Timing` header and a structured log line per request: total, number of Supabase calls, slowest call.
- Run `EXPLAIN (ANALYZE, BUFFERS)` on the ten heaviest queries against a seeded local database (see phase 4 seed sizes).
- Re-run the TLS test from the real production host over a cable. If the stall is there too, fix at the router/ISP (or MTU), not in code.
- Fix the hosting line in `ARCHITECTURE.md` (done with this plan).
- **Budget to hold from now on:** a page navigation is under 1 s at the 75th percentile; My day makes at most 6 database calls.
Gate: a table of the ten slowest pages with milliseconds and call counts, checked into `HANDOFF.md`.

## Phase 1: Mumbai database and fewer round trips (1.5 d)
Supabase cannot change a project's region, so this is a new project in `ap-south-1`.
Cut-over (evening, about 30 minutes of "read only" notice):
1. Create the project; enable the same extensions; run migrations 0001 to 0026 with the CLI.
2. Configure before any user is moved: **custom SMTP (Resend, `no-reply@hard-code.in`) and a raised email rate limit**, Site URL and redirect
   URLs, password sign-in, Google provider if the OAuth client exists, password policy, JWT expiry. Confirm asymmetric JWT signing keys are on.
3. Freeze writes (maintenance banner), dump data of schema `ops` plus `auth.users` and `auth.identities`, restore, then verify row counts
   table by table and that `ops.staff` ids still match `auth.users` ids.
4. Confirm `pg_cron` schedules (0024) exist and one `kpi_snapshot` run succeeds.
5. Switch `NEXT_PUBLIC_SUPABASE_URL`, anon key and service key in the environment, rebuild the Docker image (the public values are baked in at
   build time), restart, smoke test: sign in, check in, create a task, `/api/health`.
6. Keep the Tokyo project **read-only for 7 days** as the rollback; then delete it. Everyone signs in again once (new JWT secret). That is expected.
Code changes in the same phase:
- Replace `getUser()` in `utils/supabase/proxy.ts` with `getClaims()` (verifies the JWT locally, saves one 160 ms hop per request).
  Keep `getUser()` only where a fresh server-side check matters (sign-in callback, claim, password change).
- Reuse connections to Supabase (keep-alive agent) so new handshakes are rare.
Rollback: switch the environment back to the Tokyo project; data written after the cut-over must be replayed, so the freeze window is strict.
Gate: median warm call under 40 ms from the app host; a full sign-in and check-in works on the new project; Advisors unchanged.

## Phase 2: Repeating meetings (migration 0027, 1 d)
Cause (from the code): every occurrence is its own `meeting` row with its own `meeting_attendee.rsvp = 'invited'`, and the nightly job keeps
adding more. Each person ends up with many pending answers. (Confirm where the founder sees "multiple invites"; the fix covers all three places.)
Design:
- New `ops.meeting_series_response (series_id, staff_id, rsvp, responded_at)`, one row per person per series.
- `generate_series_meetings` creates each new occurrence's attendee row with the person's series answer (default `invited`).
- **Accept any occurrence = accept the series (confirm):** a trigger on `meeting_attendee` (skipped for system and RPC writes, so it cannot loop)
  records the series answer and sets every later occurrence still `invited` to `accepted`. It does not overwrite a person's own decline or
  "maybe", and does not touch occurrences marked `customised`.
- **Decline or maybe on one occurrence affects only that one.** An RPC `answer_meeting_series(series, rsvp)` handles "decline all".
- One invite per person per series (dedupe key `series:<id>:<person>` already exists); the organizer gets one "accepted" notification, not one per occurrence.
- People added to a series later get one invite; people removed lose only future occurrences.
- Backfill: where someone already accepted a future occurrence, create the series answer.
- UI: meeting page shows "Going to all upcoming" with "Only this one" as the exception; the bell groups a series into one entry.
Tests: a weekly series with 3 people gives exactly 1 notification each and 1 pending answer each; accepting one occurrence accepts the rest and the
nightly generation arrives pre-accepted; a decline of one stays single; removed attendee; `customised` occurrence untouched; idempotent re-run.
Gate: the repeated-meeting scenario above passes in the DB tests and in Playwright.

## Phase 3: Tasks (migration 0028, 4 d)
Three changes, one migration, built in this order inside it.
**3a. Department becomes optional; add category (confirm: a separate field).**
- `task.department` drops `not null`. New `task.category text check (category in ('internal','other'))`, null for ordinary department work.
  Reason: "Internal" and "Other" are not teams; adding them to the department list would leak into staff access, workspaces and lead scoping.
- Visibility without a department: the assignee, creator, watchers, the founder, and a lead of the assignee's team (reuse `ops.leads_staff(assignee_id)`).
  A task with neither department nor assignee is visible to its creator and the founder only.
- Re-write `task_sel`, `task_upd`, `task_guard` (manager = founder, creator, lead of the department **or of the assignee**), the history line for department changes
  (null to value and back), and `new-task-dialog` plus `lib/schemas/task.ts` (department optional, category choice).
- Cockpit and insight: `v_task_timeliness` already carries department; show null as "No department"; `buildScope` already includes work whose assignee is in a lead's team.
  `backlog_snapshot_key` must treat a null department the same way it treats a null assignee (`coalesce`), and the nightly writer must be re-tested with null departments.
- Fixed (recurring) tasks keep a required department for now (they target a whole department); revisit separately.
**3b. Several assignees: one task per person, linked by `group_id` (confirm).**
- `task.group_id uuid` (indexed, partial). The dialog accepts several people; one RPC `ops.create_task_group(...)` creates all rows in one transaction
  (one round trip), checks each person is active and internal, de-duplicates, caps at 20, and relies on the existing assignment notification per person.
- Each person keeps their own status, dates, timer and on-time record, so workload, time tracking and the Operations insight need no change.
- Group view: "2 of 3 done", who is late, one link from each task to its siblings.
- **Edits (confirm):** shared details (title, description, priority, category, department) change for everyone only when the manager chooses "apply to everyone"
  (RPC, not a trigger, to avoid loops). Status, deadline and estimate stay per person. Cancelling the group is an explicit action.
**3c. "Assign to a person with no department selected"** is the same screen: person first, department optional.
Tests: permission matrix per role with and without department; lead sees a null-department task of their team member and not of another team;
a member cannot reassign or edit shared details; group create is atomic (one bad person rolls back all); history written per row; snapshot job and
`v_task_timeliness` with null departments; load check that `task_sel` still uses an index on a 50k-row table (phase 4 seed).
Gate: a lead creates one task for three people with no department, each finishes at a different time, and the Cockpit counts three finished tasks with the right early, on time or late result.

## Phase 4: Speed, part two (4 d)
1. **One call for the shell.** `ops.bootstrap()` returns `me`, open attendance session, running timer and unread notification count in a single round trip
   (security invoker, authenticated only). The layout makes one call instead of four.
2. **Parallel pages.** Every page issues its independent queries together and never waits on `me` more than once; remove exact counts where the list does not show a total.
3. **Caching rules.** Pages that depend on RLS are never cached across users. Cached with explicit invalidation: reference data identical for everyone (stage definitions,
   staff name list, office networks, institution pickers). Dashboards read nightly rollups. Evaluate Next's client router cache (`staleTimes`) for back/forward only.
4. **Seeded volume.** Extend `scripts/seed-demo.sh`: 40 staff, 50k tasks, 500k audit rows, 200k activities, 100k time entries, 20k institutions.
   Acceptance: each list page under 300 ms of database time at the 95th percentile; plans show index use; `task_sel` rewritten if the watcher check blocks the index.
5. **Pagination and rollups.** Keyset pagination on long lists; the Operations insight aggregates in SQL (`ops.insight_rollup`) and stops loading up to 5000 raw rows into Node.
6. **Retention jobs (through `ops.run_job`).** Proposed: read notifications 90 days, `job_run` 90 days, `attendance_failure` 90 days (exists), `task_history` and `audit_log` kept, reviewed at 1M rows.
7. **Guardrails.** A CI check fails a page that exceeds its call budget in the e2e run.
Gate: the budget in phase 0 holds on the seeded data, on the Mumbai project.

## Phase 5: Employee portal (superseded by `docs/PLAN_EMPLOYEE_PORTAL.md`, 19 Nov 2026; the text below is the first, smaller draft)
Hard rule: **no personal or pay data on `ops.staff`.** Every internal user can read that table (`0010` policy).
Access (confirm): a flag `staff.is_hr` (set by the founder) and a helper `ops.can_hr()`. HR and the founder read all; an employee reads and edits only their own allowed fields.
Payroll scope (confirm): **records and uploaded payslips only**; no salary or tax calculation in v1.
- **5a Profile (0029).** `ops.staff_profile`: legal name, birth date, personal email and phone, address, emergency contact, employee code (unique), designation, joined on, employment type,
  manager, work location, photo. Employee edits personal fields; HR-owned fields are locked by a guard trigger (the `task_guard` pattern). Consent acknowledgement stored. My profile page; HR edit page; org chart list from `manager_id`.
- **5b Documents (0030).** Private storage bucket `hr-docs`, path `<staff_id>/<uuid>`, 10 MB, PDF or image only. `ops.staff_document` (kind, title, path, expiry, uploaded by, verified by and when).
  Storage policies mirror table policies; downloads by signed URL that expires in 60 seconds; an `hr_access_log` row when anyone other than the owner opens a file.
- **5c Payroll records (0031).** `ops.pay_structure` (effective-dated, never overwritten), `ops.payslip` (month, gross, deductions, net, file, published at; unique per person per month), bank details
  with the account number encrypted (Supabase Vault or an app-level key; only the last four digits shown). The employee sees only their own; HR and the founder see all; every change is audited.
- **5d Reports.** HR exports (CSV) with the same access log; expiring-documents list; joiners and leavers.
Before 5c goes live: PITR backups on (decision 12), a written retention period chosen with the accountant, `forget_user` extended to these tables, and the privacy notice shown.
Tests: an employee cannot read another's profile, documents, payslips or bank details through any route (table, view, storage, RPC, search); a member cannot change HR-owned fields; viewer and partner see nothing;
deactivated staff keep records but lose access; signed URLs expire.
Gate: three real employees see only their own profile and payslip; the founder uploads and verifies a document; an access-log entry exists for each HR read.

## Decisions to confirm
1. "Internal" and "Other": a separate `category` field (assumed) or new department values.
2. Group edits: shared details only by "apply to everyone", status and dates per person (assumed).
3. Payroll: record and upload only (assumed); HR as a flag `is_hr` (assumed) or a new role.
4. Evening cut-over to Mumbai with a 30-minute read-only window (assumed), and a short re-sign-in for everyone.
5. Retention periods in phase 4 and for payroll records.

## Risks
- The task read policy is the hottest and riskiest policy; any rewrite is tested with `EXPLAIN` on seeded data before it ships.
- The region move invalidates sessions and needs the new project's environment values baked into the image; do it when nobody is mid-workshop.
- The 3.3 s connection stalls may be the network, not the code; phase 0 decides whether anything in the app needs to change.
- Payroll data raises the cost of a mistake: it ships last, behind PITR and the access log.
