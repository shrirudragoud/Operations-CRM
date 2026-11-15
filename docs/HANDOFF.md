# Handoff

Last updated: 15 Nov 2026 (session 2). **Taking over locally? Read `docs/LOCAL_AGENT_HANDOFF.md` first.** Owner/founder: Shri (Hard-Code / Idea-Labs).

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
| Tests | DB: 243 checks. Unit (Vitest): 32 (`permissions`, `nav`, error mapping, formatters, schemas, safe redirects). E2E: 7 |
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
- A public URL is **not available from this sandbox** (it only has an HTTPS egress proxy: Cloudflare/ngrok/
  localtunnel tunnels cannot connect). Port 3000 is registered as a preview port for the Claude app. For a real
  URL deploy to Vercel (or any Node host) with the two `NEXT_PUBLIC_` variables, then add its
  `/auth/callback` to Supabase Auth redirect URLs and set the Site URL.
- E2E tests build their own copy against the local stack (`NEXT_DIST_DIR=.next-e2e`) and refuse non-local URLs,
  so they can never reset the hosted project.

## Next steps (in order)
1. Founder: steps above, plus answers to the open questions in `docs/DECISIONS.md` (3, 4, 7, 10, 11 block Phase 1; 2 decides the UI merge).
2. Agent: once applied, confirm Advisors, run the gate on the hosted project, deploy to Vercel (security headers
   and CSP are in `next.config.ts`).
3. Phase 1 (`docs/BUILD_PLAN.md`), one workspace per PR: Institutions + contacts + 360 -> Outreach -> Sales ->
   Workshop -> Inventory.

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
- Lists in Phase 0 are capped (My work 50, Team 500) rather than paginated; Phase 1 lists need real
  server pagination (TanStack Table).
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
