# Access model: login, roles, permissions

## Principles
- **Invite-only.** Signing in does not grant access. A user sees data only if an `ops.staff` row exists for
  their auth user and `is_active`. No row -> every RLS policy returns nothing.
- **Roles + departments.** `ops.staff.role` (enum `app_role`) and `ops.staff.departments`
  (`ops.department[]`). The database decides; UI hides what a user cannot use.
- **Founder = all departments.** Partners are never department members; they own rows.

## Sign-in flow
1. User opens `/login`: **Continue with Google** (primary) and **email magic link** (fallback).
2. `/auth/callback` exchanges the code for a session (`@supabase/ssr`), then calls
   `supabase.schema('ops').rpc('claim_access')`.
3. `claim_access()` returns `{status, role?, departments?}`:
   - `active` -> go to `/`.
   - `claimed` -> an open, unexpired invite for the verified email became a staff row (name from invite or
     Google profile). Mark invite accepted. Go to `/` with a welcome toast.
   - `no_invite` -> `/no-access` ("Ask the founder to invite you", show the email they signed in with, sign-out button).
   - `disabled` -> `/no-access?reason=disabled`.
4. Middleware (every request): refresh session via `supabase.auth.getUser()`; no user -> `/login`
   (except `/login`, `/auth/*`, static). Layout calls `ops.me()`; null -> `/no-access`.

## Onboarding a teammate
Founder opens **Team** (`/team`) -> Invite: email, role, departments, optional name -> row in `ops.invite`
(30-day expiry, one open invite per email). Share the app URL. First sign-in claims it. Founder can later
change role/departments, deactivate (`is_active = false`), or re-invite.
Bootstrap: `supabase/seed_founder.sql` inserts the first founder invite.

## Roles
| Role | Purpose | Typical departments |
| --- | --- | --- |
| `founder` | Everything, incl. cockpit, money, team admin, audit log, mark deals Won | n/a (all) |
| `dept_lead` | Manage their departments' records, assign tasks, delete in dept, see KPI snapshots | 1-2 |
| `member` | Create/edit in their departments | 1-2 |
| `viewer` | Read-only in their departments | any |
| `partner` | External distribution partner: only rows they own (institutions, their activities, their deals incl. value, events of their institutions); own KPI targets | none |

## Permission matrix (what RLS enforces)
| Data | founder | dept_lead / member | viewer | partner |
| --- | --- | --- | --- | --- |
| Institutions, contacts | all | read all; write if Outreach/Sales (Workshop may update) | read | own only |
| Activities (Outreach) | all | Outreach dept | Outreach read | own |
| Deals + lines (Sales) | all (only founder can set Won) | Sales dept | Sales read | own (value visible) |
| Events, run sheets, cohorts | all | Workshop dept; Community/Training/Sales read events | read | events at own institutions (read) |
| Inventory (items, kits, locations, stock, reservations) | all | Workshop dept | Workshop read | none |
| Trainers, programs, enrollments | all | Training dept; Workshop reads | read | none |
| Product tables (PostHog, reviews, insights, incidents, catalog, IDE snapshot) | all | Product dept (IDE snapshot also read by Workshop/Community) | read | none |
| Content | all | Community dept | read | none |
| Tasks, task comments, task history | all | read: their departments' + assigned to / created by them; create: any internal role, for anyone; edit details and reassign: manager only (founder, creator, department lead); claim, hand back, accept, move status: assignee or manager; delete: lead / founder | same | none (open: partners can finish follow-ups assigned to them; confirm) |
| Task watchers, notifications | all | watchers: anyone who can see the task adds themselves or others; remove yourself, managers remove anyone; notifications: only the recipient | same | none |
| Fixed tasks, saved task views | all | fixed tasks: read by internal roles, written by a founder or the department's lead; views: own, plus shared ones | read only | none |
| Time entries | all | read: own, a task's managers, founder; write: own for 14 days (internal roles that can write) | none | none |
| Daily log | all | read: own, a lead of the same department, founder; write: own for 7 days | none | none |
| Meetings, attendees | all | read: organizer, person asked, invitees, and meetings open to their department or the company; create: any internal role (viewers too); edit / cancel: organizer or a lead of its department; delete: organizer; attendees: organizer / lead invite and remove, each person answers for themselves | create and answer only | none |
| Calendar view (D45) | no new data: it only reads meetings, events, tasks, activities, deals and content through the policies above, so what you see on someone else's calendar is your own access applied to their assignments | same | same | none |
| Fixed meetings (series) | all | read: own, invited, or open to them; write: organizer; "whole department": the department's lead | create own | none |
| Feedback | all | owner department + author | read own dept | none |
| Staff list | all, edit | read | read | self only |
| Invites, audit log | founder only | none | none | none |
| KPI targets | all | own row | none | own row |
| KPI snapshots | all | dept_lead only | none | none |
| Delete | all | dept_lead in dept | none | none |

## RLS building blocks (`0007`, `0009`, `0010`)
`ops.my_role()`, `ops.is_founder()`, `ops.in_dept(dept)` (excludes partners), `ops.can_write()` (not viewer),
`ops.is_internal()` (active non-partner), `ops.my_departments()` (founder = all six, partner = none),
all `SECURITY DEFINER`, `STABLE`, `search_path = ''`. Pattern per department table: select = `in_dept`,
insert/update = `in_dept AND can_write`, delete = `in_dept AND role in (founder, dept_lead)`.
**`0010` is the single source of truth for policies** (it drops and recreates all of them). Rules for new
policies, all checked by `tools/test-access.mjs`:
- exactly one permissive policy per table and action: put cross-department readers and partner-own rows
  in the same expression with `OR` (Performance Advisor `multiple_permissive_policies`);
- wrap `auth.uid()` and helper calls in a sub-select, e.g. `owner_id = (select auth.uid())`,
  `(select ops.in_dept('sales'))`, `department = any ((select ops.my_departments())::ops.department[])`
  (`auth_rls_initplan`: evaluated once per statement instead of per row);
- every foreign key gets an index; every function pins `search_path`; finish each migration that adds
  functions with `revoke execute on all functions in schema ops from public;` (Postgres grants PUBLIC
  execute by default and per-schema default privileges cannot remove it).
Service-role jobs bypass RLS; their RPCs (`assign_review_queue`, `raise_low_stock_tasks`, `request_part`)
are revoked from `authenticated`.

## Safety rails
- Last active founder cannot be demoted, deactivated or deleted (`guard_last_founder`).
- Staff and invite changes are audit-logged (`audit_log`, founder-readable).
- A member cannot promote themselves (staff update policy is founder-only).
- Only one open invite per email; invites expire.

## UI visibility (derive from `ops.me()`; never rely on it for security)
| Nav item | Visible to |
| --- | --- |
| My work, Institutions, Tasks, Feedback | all non-partner roles; partner sees a reduced "My institutions / deals" set |
| Outreach / Sales / Workshop / Inventory / Training / Product / Community | founder, or role with that department in `departments` |
| Team, Audit log | founder |
| Cockpit | founder (Fundraising and Operations views, low stock, background jobs); department lead (Operations view only, for their own team: people sharing a department plus unowned work in those departments, D60) |

`ops.backlog_snapshot` (0026, the nightly open / overdue / blocked counts) is read by the founder, and by a department
lead for rows in their departments or for people they lead (`leads_staff`). Nobody can write it by hand; only the
nightly job does. `ops.v_task_timeliness` is a `security_invoker` view, so each reader sees only the tasks the task
policy already lets them see.
Write `lib/permissions.ts` as a pure function `canAccess(me, area)` used by sidebar and route guards, with
unit tests, and mirror (not replace) the RLS above.

## Team admin RPCs (`0010`, founder only, used by `/team`)
`invite_staff(email, role, departments, name)` (also re-invite/extend), `revoke_invite(id)`,
`update_staff_access(staff, role, departments, is_active)`. They validate the role shape (partner: no
departments; dept_lead/member/viewer: at least one) and return readable errors; RLS still applies.

## Tests
`tools/test-access.mjs` (run by `tools/test-migrations.mjs`): claim with valid invite (staff row created,
invite accepted); expired invite; no invite; accepted invite cannot be claimed by another account;
disabled staff (and `me()` null, sees no data); case-insensitive email; second claim idempotent; name from
Google profile; last-founder demote/deactivate/delete blocked; non-founder cannot read/insert invites;
founder-only RPCs; partner isolation across 15 tables and other partners' rows; advisor-equivalent checks.
`e2e/phase0-gate.spec.ts`: the same flow through the real UI on a local Supabase stack.
