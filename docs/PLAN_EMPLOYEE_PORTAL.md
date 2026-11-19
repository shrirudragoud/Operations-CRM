# Plan: Employee portal ("My space"), replaces Phase 5 of `PLAN_SCALE_PORTAL_TASKS.md` (19 Nov 2026)

Status: plan agreed in outline on 19 Nov 2026; building starts with P0. Items marked **(confirm)** are assumptions waiting for the founder.

**Founder's answers (19 Nov 2026):** (1) full leave module: yes. (2) Payroll: **skipped for now** (no payslips, salary or bank details in this build; the tables are not created, the Payslips tab and P5 are removed). (3) HR is **a flag on a person** (`is_hr`). (4) **Everyone gets attendance, leave, holidays and the late / absent flags**, not only people tagged "works from office"; remote staff check in too (see section 5).

## 1. Goal
One place where every employee runs their working life with Hard-Code: see how they are doing this month (attendance, hours, tasks), ask for
things (time corrections, leave, letters), find their documents, keep their details right, and know what the company expects
(policies, holidays, who is who). HR and the founder get the matching admin side. It is not a payroll calculator and not a performance ranking.

Principles
- **Their own data first, nobody else's.** Every query and file is limited to the person by the database (RLS and storage policies), not by the page.
- **Rules in the database** (CLAUDE.md rule 1): leave balance, approval, locking of HR fields are triggers and RPCs with tests as two roles.
- **No personal or pay data on `ops.staff`** (every internal user can read that table).
- **Facts, not scores.** The portal shows counts and dates. No single score or ranking of people (as in D60).
- **Useful on a phone.** Staff check in and look at their month from a phone; every screen is designed for narrow widths first.

## 2. What we already have (reuse, do not rebuild)
| Need | Already there |
|---|---|
| Check in / out, late, early, missing check-out, remote / excused marks, holidays, office hours | `0023`: `attendance_session`, `attendance_request`, `attendance_day_mark`, `office_holiday`, `office_settings`, `attendance_days(from, to, staff)` (max 62 days) |
| Weekly view and "ask for time" | `/attendance` (My week, Requests, Team) |
| Time worked on tasks, daily log | `0020` `time_entry`, `/timesheet` |
| Tasks done, early / on time / late | `0026` `v_task_timeliness`, Cockpit |
| Notifications, mentions | `notification`, bell |
| Role, departments, active flag, works-from-office tag | `ops.staff`, Team page |
| Sign-in, password change | `/account` |
| Audit | `ops.audit()` triggers, `/audit-log` |

## 3. Gaps the portal must fill
1. Attendance only shows **a week** and only for people tagged "works from office". There is no **month** statement, no totals, no printable record.
2. **No leave at all**: no types, balances, applications or approvals. Without it a month of attendance cannot be read (an absence is either leave or a problem).
3. No **profile** (legal name, birth date, address, emergency contact), no employee code, joining date, manager, designation.
4. No **documents** (ID proofs, offer letter, agreements) and no company **policy library** with acknowledgements.
5. No **directory**, birthdays, work anniversaries, org chart.
6. No **HR requests** (letters, address change) or onboarding / offboarding checklist.
7. No HR role: only founder, lead, member, viewer, partner.

## 4. Information architecture
New sidebar group **Me** (visible to every internal user, hidden for partner): `/me`.
`/me` is one page with route tabs (ui-sdk **Tabs**, route-based, so each tab is a link and works with back/forward):

| Tab | For the employee | Source |
|---|---|---|
| **Overview** | Today (check in / out), this month at a glance, what needs me (pending requests, tasks due, unread), next holiday, expiring documents | existing + new |
| **Attendance** | **Month calendar** coloured by status, month totals (days present, on time, late, left early, average hours, leave, absent), the list of days, ask for time, my requests and their state, **monthly statement** (print / PDF, CSV) | `attendance_days` extended to a month; new view |
| **Leave** | Balances by type, apply (dates, half day, reason), my applications and state, team calendar of who is away (names only for my team), holidays | new 0032 |
| **Work** | Hours logged per week, tasks finished this month with early / on time / late counts, open tasks | existing views, own rows only |
| **Profile** | Personal details, emergency contact, address, photo; locked fields (employee code, designation, joined on, manager) shown read-only | new 0031 |
| **Documents** | My documents with status (uploaded, verified, expiring), upload; company library (handbook, policies, forms) with "I have read this" | new 0033 |
| **Requests** | Ask HR (experience letter, address proof, detail change), track status | new 0034 |

Other surfaces
- **People** (`/people`): directory with search, department, manager, birthdays and anniversaries this month, org chart. Shows work contact only (name, department, designation, work email, work phone, photo). Personal data never appears here.
- **HR** (`/hr`, founder and `is_hr`): employees list and record, onboarding / offboarding checklists, leave approvals and balances, document verification queue, attendance month report for everyone (CSV), expiring documents, joiners and leavers, **access log** of every HR read.
- Leads (not HR) get in **Team**: approve leave and time requests for their people (already so for attendance requests), team month attendance, who is away.

## 5. Attendance month view (the part you asked for first)
Employee sees, for any month (default current, up to 24 months back):
- A month grid. Each day shows one of: present, late (minutes), left early, missing check-out, remote, excused, on leave (type), holiday (name), weekly off, absent, future. Colour **and** an icon or letter (not colour alone).
- Totals: working days, days present, on-time days, late days with total minutes, early leaves, average hours, leave days by type, absent days, remote days. Each total links to its days.
- Day detail: first in, last out, hours, source (network or manual), notes, who corrected it.
- Actions: ask for time for a day (existing), explain a missing check-out, apply leave for the day.
- **Statement**: a clean print layout with name, employee code, month, the table, the totals; CSV. HR can generate it for any person and the access is logged.
- Shadow mode (D56) still applies: while `flags_on` is false, late, early and absent are not shown as flags.
- **Everyone is covered, remote staff too (founder's answer).** Two modes per person, set by the founder or HR: **office** (today's rule: check in only from a trusted office network) and **remote** (check in from anywhere, with the same hours, late, early, missing check-out and absent flags; a remote check-in is stored as `remote`, never refused for the network). Everyone internal except viewers and partners is in one of the two modes, so the month grid, leave, holidays and flags look the same for all. `office_since` (renamed in the UI "tracked since") still stops earlier days from counting as absent. The flags stay in shadow mode (D56) until the founder switches `flags_on` on in Settings; the portal says so when it is off.
- Replaces D51's "only tagged people" rule: needs a new decision row (D63) and a migration that adds `attendance_mode` to `staff` (default `office` for those already tagged, `remote` for the rest, tracked since = the day the migration runs).

Database: `0030` adds `attendance_month(p_staff, p_month)` (one row per day, includes leave and holiday, replaces the 62-day limit for a single person) and a totals function; `attendance_days` stays for the team views. Must be fast: one call per page, an index on `(staff_id, work_date)` already exists.

## 6. Data model (migrations 0029 to 0035, each with PGlite tests as two roles)
Access helper in 0029: `staff.is_hr boolean` (founder sets it, guard trigger) and `ops.can_hr()`.

| Mig | Tables and functions |
|---|---|
| **0029 HR foundations (built)** | `staff.is_hr` (founder sets it; cleared for viewers and partners), `ops.can_hr()`, `ops.hr_access_log` + `ops.log_hr_access()`, `ops.me()` reports `is_hr` |
| **0030 Attendance for everyone and the month** | `staff.attendance_mode` (office / remote), remote check-in, `attendance_month()` and totals, `my_overview()` (one call for the Overview tab) |
| **0031 Profile (built; screens: /me/profile, /hr/people)** | `staff_profile` (1:1 staff; legal name, birth date, personal email and phone, address, emergency contact, blood group optional, employee code unique, designation, joined on, employment type, probation end, manager_id, work location, photo path; HR-owned fields locked for the employee by a guard trigger, the `task_guard` pattern) |
| **0032 Leave** | `leave_type` (code, name, paid, annual quota, carry forward, needs document, half day allowed), `leave_balance` (derived from a ledger: `leave_ledger` credit, debit, adjustment, never edited), `leave_request` (dates, half day, reason, state pending / approved / rejected / cancelled, decided by), `apply_leave`, `decide_leave`, `cancel_leave`; approved leave writes the day marks used by attendance; no overlap with another approved leave; balance cannot go below zero unless the type allows unpaid; a lead approves for their team, HR or the founder for anyone |
| **0033 Documents and policies** | private bucket `hr-docs`, `staff_document` (kind, title, path, expiry, verified by and at), `company_document` (policy library, version, audience), `policy_ack` (person, document, version, at); signed URLs of 60 seconds; every non-owner open is logged |
| **0034 HR requests and onboarding** | `hr_request` (kind, state, thread), `onboarding_template` and `onboarding_task` (per joiner, per leaver), `birthday_visible` consent |
| **0035 Directory (built; screen: /me/directory)** | `ops.directory()` security definer function of work-contact fields only (a `security_invoker` view could not read other people's profile rows under RLS), `ops.directory_events(month)` for birthdays (consent only) and anniversaries |

Retention and privacy: documents of a leaver stay (record-keeping) but the person loses sign-in access; `forget_user` is extended to these tables; privacy notice shown on first open of Profile **(confirm period with the accountant, e.g. 7 years)**.

## 7. Access rules (the tests will assert every row)
| Data | Employee | Lead | HR | Founder | Viewer / partner |
|---|---|---|---|---|---|
| Own profile | read, edit personal fields | n/a | read all, edit all | read all, edit all | none |
| Another's profile | work contact only (directory) | work contact + leave dates of their team | all | all | none |
| Own / others' attendance month | own | their team | all | all | none |
| Leave | own and apply | approve for their team | all | all | none |
| Documents | own, upload | none | all, verify | all | none |
| Access log | none | none | read | read | none |
Through every route: table, view, function, storage, search, realtime, export. A signed URL expires in 60 seconds.

## 8. Frontend with the new ui-sdk (first, as asked)
Why this works: `@ui-sdk/react` is installed (beta.10) with a project skill (`.agents/skills/ui-sdk`) and docs in `node_modules/@ui-sdk/react/docs`. Components render no style of their own; `web.css` is imported in `app/globals.css` inside `@layer ui-sdk` (Tailwind classes win).

Rules for the portal (from the ui-sdk skill)
1. Import each component from its own entry, `@ui-sdk/react/<name>`, in the portal code. No new shadcn/Radix components for portal screens.
2. Forms: `Field` + `FieldLabel` + `Input` (or `NumberInput`, `DateInput`, `Select`), `FieldError` for server errors; validation messages come from the database errors, as today.
3. Style from `data-slot` and state attributes with Tailwind; no inline style for state; `@layer ui-sdk;` stays at the top of the stylesheet.
4. Every control has a name; the interface gets the **agent test** and a keyboard / focus test (ui-sdk testing guide), plus the existing Playwright flows.
5. Check colour contrast in a real browser (4.5:1 text, 3:1 edges) especially for the status colours on the month grid.
6. Read each component's docs page before using it. The other session that is converting `components/ui/*` to ui-sdk keeps doing that; the portal does not wait for it and does not edit those files.

Component map
| Portal need | ui-sdk component |
|---|---|
| Route tabs for /me | Tabs (route tabs, links) |
| Month grid with a status per day | Calendar (`CalendarGrid`, `CalendarDay` with our own status chip and a day-detail Popover) |
| Month, leave range, date of birth | Date Picker, Date Input, Calendar range |
| Leave type, department, employment type | Select |
| Leave apply, request forms, profile forms | Field, Input, Textarea, Number Input, Switch, Checkbox, Radio / Segmented Control (full / half day) |
| Document upload | File Input (PDF or image, 10 MB), Progress |
| Photo | File Input + Image Cropper, Avatar |
| Leave balance, hours against target | Meter, Progress |
| Attendance trail, leave and request history | Timeline |
| Confirm cancel / reject | Alert Dialog |
| Apply leave, ask for time, day detail | Dialog on desktop, Drawer from the bottom on phones |
| Directory search | Combobox / Command, Pagination |
| Success and errors | Toast |
| HR tables | plain `table` styled with Tailwind (ui-sdk has no data table), Pagination, Scroll Area |
| Org chart | Tree for the list form (a drawn chart is v2) |
| Filters and bulk actions | Toolbar, Menu |

Not in ui-sdk, built by us: status chip, month totals cards, print statement layout, charts (existing `components/ops-charts.tsx`), org chart drawing.
Shared pieces to write once: `components/portal/` (`MonthGrid`, `StatusChip`, `StatCard`, `FileDrop`), each a small client component over the ui-sdk parts.

## 9. Phases, order, size and gates
| Step | Content | Size | Gate |
|---|---|---|---|
| **P0 Foundations (0029, done)** | `is_hr`, `can_hr()`, `hr_access_log`, `/me` shell with route tabs on ui-sdk, nav group, portal component kit and the ui-sdk test setup, email/SMTP working (new staff must be able to sign in) | 2 d | `/me` renders for all internal roles on a phone; viewer / partner refused; agent test passes |
| **P1 Attendance for everyone and the month (0030)** | `attendance_mode`, remote check-in, `attendance_month`, month grid, totals, day detail, statement (print + CSV), overview tab | 4 d | A person's month matches the sum of their sessions, marks and holidays on seeded data; HR statement is access-logged |
| **P2 Profile (0031), built; directory (0035) built, awaiting live deploy** | profile tables, guard trigger, My profile, HR employee record, directory | 3 d | Member cannot edit HR-owned fields or read another's personal data via any route |
| **P3 Leave (0032), built locally; not on hosted. Screens: /me/leave, /hr/leave. Policy is set by HR in the UI (answers decision 1 in section 10: all of it is per leave type, none hard-coded)** | types, ledger, apply, approve, calendar of who is away, attendance integration | 4 d | Balance maths property-tested; overlap and negative balance refused; approved leave shows in the month grid |
| **P4 Documents and policies (0033), built locally; not on hosted, real upload untested (no local Storage)** | private bucket, upload / verify, library, acknowledgements, expiry list | 3 d | Signed URL expires; owner-only and HR-only storage reads; access log row per HR open |
| **P5 HR requests, onboarding (0034 built locally, not on hosted); reports and directory (0035)** | requests, checklists, HR dashboards, exports | 3 d | Joiner checklist completed end to end |
Total about 19 working days with tests, in this order. P1 comes first because it answers the first thing asked for and needs no new decisions. Each step ships behind the gate and can be used on its own.

## 10. Decisions
Answered 19 Nov 2026: leave in scope (full); payroll skipped; HR is a flag; everyone has attendance and flags, remote staff check in too.
Still to confirm
1. **Leave policy:** types (casual, sick, earned, unpaid, comp-off?), days per year, carry forward, whether weekends and holidays inside a leave count.
2. Who is HR today (set after P0).
3. Remote check-in rule: any network, no location check (assumed). A daily limit of one open session stays.
4. Privacy periods for documents of leavers, with the accountant.
5. Birthdays on the directory by consent only (assumed).
6. Email sign-in must work for staff added later (SMTP status).

## 11. Risks
- ID documents are the most sensitive data we hold in this build: they ship behind the access log and signed URLs, after backups (PITR) are on. Payroll is out of scope.
- A month view is one more heavy page: one function call per page, measured with the timing tool against the call budget (Phase 4 of the speed plan; the `/me` shell must not add shell calls).
- ui-sdk is beta (0.1.0-beta.10): pin the version, keep imports at the entries, wrap only in `components/portal/` so a change is one place.
- The other session's conversion of `components/ui/*` may change shared looks; portal screens use ui-sdk directly so they do not depend on it.
