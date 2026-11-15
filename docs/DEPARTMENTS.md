# Department workspaces: work types, screens, KPIs

Each workspace = one main record, one workflow, its screens, its KPIs. All write to the shared core
(`institution`, `contact`, `task`, `feedback`, `audit_log`). shadcn components listed are suggestions.

## Shared screens (every role)
- **My work** (`/`): my tasks due today/overdue, my events this week, my review quota (if Product).
- **Institution 360** (`/institutions/[id]`): header (name, stage badge, owner), tabs: Overview, Contacts,
  Activity timeline, Deals, Events, Kits at site, Feedback, Files. The anchor of the whole app.
- **Tasks** (`/tasks`), **Feedback inbox** (`/feedback`), global search (`command`, Cmd+K) across
  institutions, contacts, events.
Components: `sidebar`, `breadcrumb`, `command`, `data-table` (TanStack), `tabs`, `badge`, `sheet`,
`sonner`, `skeleton`.

## 1. Outreach: activity-based
Record: `ops.activity` (visit, call, email, whatsapp, stem_class, event_booth; outcome; next step + due).
Workflow: prospect -> contacted -> **qualified** (handoff). Qualified = decision-maker identified, lab/budget
known, interest confirmed. Logging outcome `qualified` auto-creates a Sales deal at *Meeting*; a next-step
with due date auto-creates a follow-up task.
Screens: territory list by district/type with filters; today's follow-ups; STEM class calendar; CSV lead
import; quick "log activity" `sheet`.
KPIs: institutions contacted/week, demos + STEM classes, qualified leads/week, lead->won conversion,
days to qualify.
Components: `data-table`, `sheet`, `form`, `select`, `calendar`, `popover`, `badge`.

## 2. Sales: pipeline
Records: `ops.deal` (kind: workshop | fdp | lab_setup | bundle; stage meeting -> proposal -> negotiation ->
won | lost; value, probability, expected close, owner, lost reason), `ops.deal_line`, files in Storage.
Rules: skip-stage blocked; lost needs reason; only founder marks Won; Won auto-creates event + tasks.
Screens: kanban pipeline (drag between adjacent stages, `dialog` for lost reason), forecast by month,
my deals, proposals awaiting reply, lost-reason report, partner scorecard.
KPIs: pipeline value, won value/month, win rate, cycle length, revenue by deal type.
Components: `card`, dnd-kit kanban, `dialog`, `tabs`, `chart`, `table`.

## 3. Workshop: events, run sheets, inventory
Records: `event` (draft -> scheduled -> in_progress -> completed | cancelled), `event_staff`, `cohort`
(code `HC-XXXX`), `run_sheet_item` (pre/day/post, from `run_sheet_template`), inventory: `item`, `kit`,
`kit_component`, `location`, `stock_movement`, `stock_reservation`.
Flow: won deal -> draft event -> set trainer/dates/venue/headcount -> **schedule** (needs certified, free
trainer; creates cohort + run sheet) -> reserve kits -> issue kits -> run -> **complete** (needs actual
headcount + finished run sheet; raises survey/returns/report/photos tasks) -> close returns.
Screens: event calendar (by trainer / institution), event detail with run-sheet checklist + status
stepper, kits-out-in-field, stock by location, receive stock, reserve/issue/return dialogs, low-stock alerts.
KPIs: events delivered, students trained, attendance rate, kit loss/damage rate, 7-day activation,
satisfaction score.
Components: calendar (FullCalendar), `checkbox` + `progress`, `combobox` (trainer picker), `drawer`,
`alert`, `form`, `table`, `tabs`.

## 4. Training: roster and certification
Records: `trainer_profile` (level L1-L3, skills), `training_program` (audience internal_trainer |
school_teacher, modules jsonb), `enrollment` (progress, score, status -> certified).
Rules: only certified trainers (or the founder) can lead a scheduled event; teacher certification of the
last enrolled teacher at an institution moves it to `teachers_trained`.
Screens: trainer roster + availability, certification pipeline, teacher progress board, leaderboard.
KPIs: certified trainers by level, teachers certified, teacher-led sessions, trainer rating, utilisation.
Components: `table`, `progress`, `hover-card`, `tabs`, `dialog`.

## 5. Product: four kinds of work
**a) User/product analytics review queue.** Nightly job builds `review_item`s from PostHog sessions
(rage clicks, errors, failed compile/flash, agent errors, first sessions, new-cohort users);
`ops.assign_review_queue(day, quota)` round-robins highest-signal sessions across reviewers (default 15/day).
Reviewer opens the replay in PostHog (`ph_session.replay_url`) and logs an `observation` (tag bug | friction
| confusion | delight | feature_request, severity 1-4, feature, note, replay timestamp). Observations group
into `insight`s -> linked to an issue -> shipped. Logging an observation marks the item reviewed.
KPIs: replays reviewed, observations/day, insights, insight->fix time, activation funnel per cohort
(`v_cohort_activation`: signed_up, compiled_7d, flashed_7d, published).
Components: `resizable` (list | replay link + form), `toggle-group` (tag), `slider` (severity),
`combobox` (attach to insight), funnel `chart`.
**b) Tech/infra + tests:** `incident` log (sev1-3, root cause, follow-ups), deploy log, CI results, cloud
credit burn vs runway.
**c) DB store (component catalog):** `catalog_request` queue requested -> researching -> added -> verified
-> published; agent "part not found" errors call `ops.request_part()` which dedupes and counts.
**d) Feedback:** owns product-tagged items of the shared inbox.

## 6. Community: growth + content
Metrics (automatic, from product DB + PostHog, snapshotted to `kpi_snapshot`): projects published, forks,
active creators (7/30-day), repos, projects per institution/cohort, top projects.
Record: `content_item` (video | story | post | promotion; stage idea -> script -> shoot -> edit -> review
-> published; published needs a URL). Also featured-project queue and student/teacher spotlights sourced
from workshop cohorts; campaign calendar tied to events.
KPIs: weekly published projects, remix rate, active creators, content shipped, reach, share of workshop
students who publish.
Components: kanban, `chart`, `carousel`, `calendar`.

## Founder cockpit (`/cockpit`, founder only)
Funnel chart, revenue/pipeline by month, kit loss, credit runway, partner scorecards, top insights,
drill-downs. Components: `card`, `chart`, `table`, `tabs`.

## Team admin (`/team`, founder only)
Staff list, invite dialog (email, role, departments), edit role/departments, deactivate, pending invites.
See `ACCESS_MODEL.md`.
