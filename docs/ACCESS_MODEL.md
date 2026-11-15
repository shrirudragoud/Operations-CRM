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
| Tasks | all | their departments' + assigned to / created by them | same | none |
| Feedback | all | owner department + author | read own dept | none |
| Staff list | all, edit | read | read | self only |
| Invites, audit log | founder only | none | none | none |
| KPI targets | all | own row | none | own row |
| KPI snapshots | all | dept_lead only | none | none |
| Delete | all | dept_lead in dept | none | none |

## RLS building blocks (`0007`, `0008`, `0009`)
`ops.my_role()`, `ops.is_founder()`, `ops.in_dept(dept)` (excludes partners), `ops.can_write()` (not viewer),
all `SECURITY DEFINER`, `STABLE`, `search_path = ''`. Pattern per department table: select = `in_dept`,
insert/update = `in_dept AND can_write`, delete = `in_dept AND role in (founder, dept_lead)`. Add extra
permissive policies for cross-department reads and partner-own rows (see `0008`).
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
| Cockpit, Team, Audit log | founder |
Write `lib/permissions.ts` as a pure function `canAccess(me, area)` used by sidebar and route guards, with
unit tests, and mirror (not replace) the RLS above.

## To test (add to `tools/test-migrations.mjs`)
claim with valid invite (staff row created, invite accepted); expired invite; no invite; already claimed;
disabled staff; case-insensitive email; second claim idempotent; last-founder demote/delete blocked;
non-founder cannot read/insert invites; partner cannot see inventory/other partners' deals.
