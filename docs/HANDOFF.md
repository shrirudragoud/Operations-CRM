# Handoff

Last updated: 16 Nov 2026 (session 3: Institutions workspace + Docker/Cloudflare run). **Taking over locally? Read `docs/LOCAL_AGENT_HANDOFF.md` first.** Owner/founder: Shri (Hard-Code / Idea-Labs).

## What exists
| Area | State |
| --- | --- |
| Product plan, department work types, data model | Written (this `docs/` folder) |
| Database: 36 tables, 5 views, business rules, RLS, invite-only access, archive, trainer picker, CSV import, job log, DPDP erasure | **Written and tested** (`supabase/migrations/0001-0013`). 243 PGlite checks (`npm run test:db`); also applied cleanly to a local Supabase stack (Postgres 17). **Core is frozen for Phase 1** except `0014` automatic stages (needs founder definitions) |
| `0010_hardening_team.sql` | Fixes every Advisor finding on 0001-0009 (below); founder-only team RPCs; partner deal/department rules |
| Supabase Advisors | Run locally with `supabase db advisors`: **0001-0009: 37 WARN + 38 INFO. After 0010: 0 ERROR, 0 WARN**, only INFO `unused_index` (expected on an empty DB) |
| Applied to the hosted ops project (`qngzrzymakuqfljdotwi`, Tokyo) | **YES, migrations 0001-0013** (via `supabase db query --remote -f`; this sandbox cannot open a direct Postgres connection for `db push`). `ops` is **exposed** in the Data API. Founder invite for the founder email exists. Hosted Advisors: 0 ERROR; 13 WARN: 12 accepted as below + 1 Supabase Auth setting (leaked-password protection, a paid-plan feature, off) (see Known gaps); 0 tables without RLS |
| Next.js app | **Phase 0 built.** Next 16 (App Router, `proxy.ts`), TypeScript strict, Tailwind v4, shadcn/ui (`radix-vega`), Supabase SSR clients |
| Phase 0 screens | `/login` (Google + magic link), `/auth/callback` (exchange + `claim_access`), `/auth/signout`, `/no-access` (not invited vs deactivated), app shell (role-aware sidebar, Ctrl+K workspace jump, user menu, theme, toasts), **My work** (open tasks), **Team** (invite, edit role/departments, deactivate/reactivate, extend/revoke invites), guarded placeholders for every later workspace |
| Phase 0 gate | **Passed on a local Supabase stack** (`e2e/phase0-gate.spec.ts`, 7 Playwright tests): founder claims invite, invites member + partner, each sees only their matrix, uninvited -> `/no-access`, last founder protected, deactivation is immediate. Not yet run on the hosted project |
| `0014_deal_types_segments_community.sql` | Deal types Workshop / Faculty training / Lab deal / Other (`bundle` -> `other`), one open deal per type, `institution.segment`, `v_funnel` + `v_pipeline` views, `community_membership` table. **Applied to hosted** (281 PGlite checks, 0 Advisor issues locally). Community/product user data is read from PostHog (D26), not stored separately |
| `0016_deal_guards.sql` | Negative deal values refused; Won deals editable by the founder only (`deal_guard`, `deal_line_guard`); `deal_line.seq` keeps line order; `replace_deal_lines(deal, jsonb)` saves proposal lines atomically. **Applied to hosted**; 311 PGlite checks. Adds one accepted Advisor WARN (`authenticated_security_definer_function_executable` for `replace_deal_lines`, same category as the other RLS helper RPCs); hosted smoke test (rolled back, ZZ data) passed |
| `0017_workshop_guards.sql` | `event.cancel_reason` (cancelling needs a reason); `event_guard` re-checks the lead when an in-progress event's dates or lead change; `event_staff_guard` re-checks assistant conflicts; `run_sheet_stamp` trigger (the database stamps `done_by` / `done_at`, keeps the first stamp, freezes cancelled events); `set_event_team(event, lead, assistants[])` saves the team atomically (certified lead, max 2 assistants, refused on completed/cancelled). **Applied to the LOCAL database only, NOT hosted: apply with the founder**; 356 PGlite checks |
| Workshop workspace (Phase 1B step 4) | **Built** (branch `phase1-institutions`, migration `0017`, local only). `/workshop` has two tabs: **Calendar** (server-rendered month grid, Monday first, India time; status-coloured chips, max 3 per day plus "+N more", multi-day events on every day, cancelled events hidden, "Needs scheduling" alert for drafts, Prev / Today / Next) and **Events** (paginated list; filters Type, Status, Trainer = Mine or All). **New event** (Workshop writers) creates a draft and opens it. **Event detail** `/workshop/[id]`: status stepper, cohort code with copy button, **Details** form (title, start, end with 1 / 3 / 5-day buttons, venue, expected students), **Team** card (lead + up to 2 assistants from the certified/founder list; busy people are disabled and marked "(busy)"; needs saved dates first), **Run sheet** (checkbox per item by phase; the DB stamps who and when), Institution (deal link if Sales access) and Open tasks cards. Actions: Schedule (lists what is missing), Start, Complete (actual students, optional satisfaction; blocked until all pre and day items are done), Back to draft, Cancel (reason required), Archive / Restore for founder and leads. Only the Workshop department opens Workshop (Sales and partners see the access page; RLS still lets Sales read events); the Institution 360 Events tab links to the event for people who can open Workshop |
| Institutions workspace (Phase 1 step 1) | **Built** on branch `phase1-institutions`: `/institutions` (server-paginated list, filters stage/kind/district/owner/search), `/institutions/new`, `/institutions/[id]` (Institution 360: Overview, Contacts CRUD, Activities, Deals, Events, Notes), `/institutions/import` (CSV parse, dry run via `import_institutions`, error table, commit, template). Stage is a read-only badge (event-driven); founder-only "Correct stage"; archive/restore for founder/dept_lead only with DB rule errors inline; no delete button. Controls mirror RLS via `lib/permissions.ts`. Screenshots (desktop + phone): `docs/screenshots/` |
| Outreach workspace (Phase 1A step 2) | **Built** (branch `phase1-institutions`, migration `0015_territory_view.sql`, live on hosted). `/outreach` has three tabs: **Follow-ups** (open `follow_up` tasks grouped overdue / today / upcoming, Mine or Everyone, one-click Done), **Territory** (`v_territory`: last touch and touch count per institution; filters segment, district, untouched, no touch in 30 days; server-paginated) and **Activity** history. **Log activity** dialog (header on Outreach, and on the Institution 360 Activities tab with a contact picker): kind, outcome, date (backdating allowed, not future), notes, next step + due date (both or neither). It is a plain `activity` insert: the `on_activity` trigger moves the stage, opens the Workshop deal on *qualified* and creates the follow-up task. `/tasks` is now real (mine / my departments, open / done, Start and Done); My work has a Done button. Partners log only for institutions they own and can finish follow-ups assigned to them. Only Outreach writers, founder and partners can log (mirrors `activity_ins`); Sales and viewers cannot |
| Sales workspace (Phase 1A step 3) | **Built** (branch `phase1-institutions`, migration `0016_deal_guards.sql`, live on hosted). `/sales` has three tabs: **Pipeline** (kanban Meeting / Proposal / Negotiation / Won / Lost with filters Type, Segment, Owner; each card links to the deal and has a Move menu), **Forecast and reports** (open pipeline, weighted forecast, won, win rate; pipeline by deal type x stage from `v_pipeline`; forecast by expected-close month; institution funnel from `v_funnel`) and **Partners** (scorecard: institutions, open/won/lost deals and values; no targets, D22). **New deal** (Sales header and Institution 360 Deals tab): institution, type, optional title, value, chance, expected close; starts at Meeting; a second open deal of the same type is refused with a friendly message. **Deal detail** `/sales/[id]`: details form, proposal lines editor (saved atomically, total, "use lines total as deal value"), move menu with rule errors inline, **lost** dialog (reason required), founder-only **Mark won** (lists what it creates, then shows the linked event), archive/restore for founder and Sales leads, institution and history cards. Won deals are founder-edit only (D28). Partners see "My deals", open deals only at institutions they own, and never see Mark won or the Partners tab; viewers are read-only |
| Tests | DB: 356 checks. Unit (Vitest): 145. E2E: 34 on the local stack (7 Phase 0 gate, 2 password sign-in, 5 institutions, 6 outreach, 9 sales, 5 workshop). `SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts` regenerates the screenshots (local stack only). `E2E_PORT` overrides the e2e app port (default 3100) when something else holds it |
| CI (`.github/workflows/ci.yml`) | DB tests + combined SQL + types freshness; lint, typecheck, unit, build, `npm audit` (prod: 0 vulnerabilities); gitleaks; e2e job starts Supabase, **fails on any Advisor WARN**, runs Playwright |
| Edge Functions / cron jobs, notifications | Not written (specs in `docs/INTEGRATIONS.md`) |

## Apply the database to the hosted ops project (founder: run these, then tell the agent)
Do **not** run any of this against `Idea_labs_DB`. Check the dashboard URL contains `qngzrzymakuqfljdotwi`.

1. **Staging first (recommended):** if your plan has Branching, create a branch and run steps 2-4 there first.
2. **Apply migrations 0001-0010.** Preferred, because it records migration history so later `db push` runs only new files:
   ```bash
   npx supabase login
   ```
   ```bash
   npx supabase link --project-ref qngzrzymakuqfljdotwi
   ```
   ```bash
   npx supabase db push
   ```
   **Already done for 0001-0010 (see "What exists").** Because it was applied through the SQL API, the CLI's
   migration history table is empty: run `npx supabase migration repair --status applied 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010`
   from a machine that can reach Postgres before the next `db push`, or `db push` will try to re-apply them.
   Alternative: Dashboard -> SQL Editor -> paste `supabase/all_migrations.sql` -> Run. If you use the editor,
   afterwards run `npx supabase migration repair --status applied 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010`
   so the CLI knows they are applied.
3. **Expose the schema:** Settings -> Data API -> Exposed schemas -> add `ops` -> Save.
4. **Verify** in the SQL editor (expected `35 | 5 | 130 | 0`):
   ```sql
   select (select count(*) from pg_tables where schemaname='ops')  as tables,
          (select count(*) from pg_views  where schemaname='ops')  as views,
          (select count(*) from pg_policies where schemaname='ops') as policies,
          (select count(*) from pg_tables where schemaname='ops' and not rowsecurity) as tables_without_rls;
   ```
5. **Advisors:** Dashboard -> Advisors -> Security Advisor and Performance Advisor -> Refresh. Expected: no
   errors or warnings for `ops`; INFO "unused index" is normal until there is traffic. Send the agent anything else.
6. **Auth settings** (Authentication -> URL Configuration / Providers / Emails):
   - Site URL = the production app URL; Redirect URLs = `https://<app-domain>/auth/callback` and
     `http://localhost:3000/auth/callback`.
   - Google provider on (Google Cloud OAuth client; authorised redirect URI
     `https://qngzrzymakuqfljdotwi.supabase.co/auth/v1/callback`). Email provider on (magic link).
   - "Allow new users to sign up" must stay **on** so an invited person's first sign-in can create their auth
     user. Access is still invite-gated by `claim_access()`.
   - **Custom SMTP** before inviting anyone: Supabase's built-in mailer only sends to project team members and
     is heavily rate-limited, so magic links to invitees will not arrive without it.
7. **Founder invite:** put your sign-in email in `supabase/seed_founder.sql` (or tell the agent) and run it once.
8. **App env:** `.env.local` (git-ignored) with `NEXT_PUBLIC_SUPABASE_URL=https://qngzrzymakuqfljdotwi.supabase.co`
   and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...` (Settings -> API Keys). Same two in Vercel.
   The secret key is not used by the app at all.
9. Sign in at the app with your Google account -> you become founder -> run the Phase 0 gate by hand
   (invite a member + a partner from `/team`, sign in as each).

## Running the app while building (session 2 setup)
- `scripts/serve.sh start|stop|redeploy|status` keeps the production build on `:3000` against the **hosted** ops
  project (`.env.local`, git-ignored) and restarts it on crash. Logs in `.run/app.log`. `redeploy` rebuilds.
- Sign-in options: Google, email link (needs SMTP, not set up yet) and **email + password** (Supabase Auth, no
  email service needed). Every method ends in `ops.claim_access()`, so an invite is still required.
- **First founder login:** needs one Supabase Auth user for the founder email. Easiest: Dashboard ->
  Authentication -> Users -> Add user -> Create new user (tick Auto Confirm User) with the founder email and a
  password; then sign in on `/login`. `claim_access` turns the existing invite into the founder staff row.
  Do not turn off email confirmation project-wide: `claim_access` trusts the JWT email, so unverified signups
  could claim an invite.
- **Production URL: https://ops.hard-code.in** (16 Nov 2026). Docker container `hardcode-ops-app` (`docker compose
  --env-file .env.local up -d --build app`, `restart: unless-stopped`) listens on `127.0.0.1:3400`. The host's existing
  named tunnel `hardcode-prod` (systemd user service `cloudflared.service`, config `~/.cloudflared/config.yml`, backup
  `config.yml.bak-2026-11-16`) has the rule `ops.hard-code.in -> http://127.0.0.1:3400`, and a Cloudflare CNAME to the
  tunnel exists. After editing that file run `systemctl --user restart cloudflared.service` (also briefly drops
  api/portal/www). Only the two `NEXT_PUBLIC_*` values are Docker build args; no secret enters the image.
  The image talks to the **hosted** ops project, so Supabase Auth -> URL Configuration needs Site URL
  `https://ops.hard-code.in` and Redirect URLs `https://ops.hard-code.in/auth/callback` (+ `http://127.0.0.1:3400/auth/callback`).
  The compose `tunnel` profile is only for throwaway trycloudflare URLs.
- Local pm2 services hold ports 3000/3100/3210/8080; the compose app uses 3400, e2e uses `E2E_PORT` (3320 used).
- E2E tests build their own copy against the local stack (`NEXT_DIST_DIR=.next-e2e`) and refuse non-local URLs,
  so they can never reset the hosted project.

## Next steps (in order)
0. Founder: revoke the Supabase CLI token `hardcode-ops-agent`; from a machine that reaches Postgres run
   `npx supabase migration repair --status applied 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012 0013 0014 0015 0016` (and `0017` once applied) (hosted history table is empty because migrations went through the SQL API).
1. Founder: steps above, plus answers to the open questions in `docs/DECISIONS.md` (3, 4, 7, 10, 11 block Phase 1; 2 decides the UI merge).
2. Agent: once applied, confirm Advisors, run the gate on the hosted project, deploy to Vercel (security headers
   and CSP are in `next.config.ts`).
3. Build order (D27, `docs/BUILD_PLAN.md`), one workspace per PR: ~~Institutions~~ (done) -> ~~Outreach~~ (done) -> ~~Sales~~ (done) -> ~~Workshop~~ (built, `0017` not yet on hosted) ->
   **Inventory** -> Product -> Community. Outreach + Sales are the main funnel and are built; `0014`-`0016` are applied to hosted and the app is rebuilt on ops.hard-code.in (login redirect fix `lib/redirect.ts` included). The founder still runs the UI smoke test by hand.

## Environment notes
- This session's container could reach npm, the shadcn registry, GitHub raw and Docker images, so the full
  local Supabase stack runs (`npx supabase start -x studio,imgproxy,vector,logflare,edge-runtime,realtime,storage-api,postgres-meta,supavisor`; may need `dockerd &` first).
- Two Supabase projects exist: the **IDE product DB** (`Idea_labs_DB`, ap-south-1) and the **ops project**
  (`qngzrzymakuqfljdotwi`). Never run ops migrations against the product DB.
- The Next 16 package ships its own docs in `node_modules/next/dist/docs/` (see `AGENTS.md`); read them, APIs changed.

## Known gaps and honest caveats
- **Leaked-password protection is off** (Supabase Auth setting; paid plans only). Passwords are used for sign-in,
  so use long passwords and move to Google/magic link once SMTP/OAuth exist, or upgrade the plan.
- **Accepted Advisor warnings (hosted, `ops` exposed):** `authenticated_security_definer_function_executable` for
  `in_dept`, `can_write`, `is_founder`, `is_internal`, `my_role`, `my_departments`, `me`, `claim_access`, plus
  `available_trainers` and `forget_ide_user` (0013; both check the caller's role inside). These are
  RLS helpers/RPCs that signed-in users must be able to call; each only reports on the caller. Anon cannot call
  them. Moving them to an unexposed schema is the Supabase-recommended alternative (large policy rewrite; do it
  in Phase 5 if wanted). `public.rls_auto_enable()` is Supabase's own `ensure_rls` trigger. NOTE: the local
  `supabase db advisors` did not report these until `ops` was exposed on the hosted project, so a clean local
  run does not prove a clean hosted run; check hosted after every migration (`--remote`).
- Hosted project is migrated and Advisor-checked, but `ops` is **not yet exposed** in Data API settings, auth
  providers/redirect URLs/SMTP are not configured, and the migration history table is empty (see step 2).
  The e2e gate has not been run against it. Never run `supabase config push` from this repo: `config.toml`
  holds local-only values (localhost URLs, relaxed email rate limit) that would overwrite hosted auth settings.
- Google OAuth is untested end to end (needs real Google credentials); it shares `/auth/callback` and
  `claim_access()` with the magic link, which the e2e covers.
- CSP allows `'unsafe-inline'` scripts/styles (Next runtime); move to nonces in Phase 5.
- No rate limiting beyond Supabase Auth's own limits; no Sentry/uptime monitoring yet (Phase 5).
- My work (50), Team (500) and the Outreach follow-up queue (200) are capped rather than paginated; Tasks, Territory and Activity history are server-paginated.
- Outreach: an activity cannot be edited or deleted from the UI yet (the database allows leads to delete); the Territory last-touch column is empty for Sales-only users because they cannot read activities (RLS). The Institutions list is server-paginated.
- Workshop: the calendar is a custom month grid (no week/day view, no drag to reschedule, D29); it shows at most 500 events a month; `in_progress` is a manual Start button (D31); the team card needs saved dates before trainers can be chosen (availability needs a window); New event does not link a deal by hand (won deals create their own event); the `trainer_request` task goes to Training but only Workshop can edit events, so Workshop assigns from the certified roster and the task shows on the event page (open process question for the founder).
- Sales: the board shows at most 300 open deals and the latest 20 Won and 20 Lost (counts shown); History on a deal shows dates only (no audit-log reader yet, the audit log is founder-only); the partner scorecard has no targets until the partner contract defines them (D22); proposal lines do not yet generate a quote PDF.
- Task A (hosted founder-only check with two real Auth users + one uninvited) is the founder's Dashboard job; the same
  behaviours pass locally in `e2e/phase0-gate.spec.ts`. Never run e2e/reset scripts against hosted (the helpers refuse non-local URLs).
- No cron schedules or Edge Functions yet: PostHog sync, review-queue build, KPI snapshots, low-stock job,
  notifications.
- Event status `in_progress` is never set automatically; decide: manual button, or cron at `starts_at`.
- Institution stages `active`, `lab_customer`, `renewal`, `churned` have no automatic rule yet
  (proposals in `docs/BUSINESS_RULES.md` "Not yet implemented").
- A won `lab_setup` deal creates a task only; it does not yet create a lab entity or set `lab_customer`.
- `stock_reservation.status = 'draft'` is unused. `kpi_snapshot` has no writer.
- `ops.v_cohort_activation` needs the IDE to send `cohort_code` at sign-up (`docs/INTEGRATIONS.md`).
- Partners see the value of their own deals (D8). Partners can still create/see tasks assigned to themselves
  (follow-ups from their activities); the matrix says "none" for tasks: confirm this is wanted.
- DPDP: `forget_user()` not written. Deletes are hard deletes (open question 11).

## Definition of finished (whole project)
All phases in `docs/BUILD_PLAN.md` complete, every item in `docs/PRODUCTION_STANDARDS.md` checked,
founder cockpit produces the fundraising funnel without a spreadsheet, and one real workshop has run
end to end in the system.
