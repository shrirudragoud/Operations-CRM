# Local agent handoff: run it, understand it, continue it

For an agent (or engineer) taking over on a normal machine with a browser. Follow the three parts in order.
Written 15 Nov 2026 at commit `afde0d5` on branch `claude/magical-albattani-8t9v2l`.

---------------------------------------------------------------------------------------------------

## Part 1. Run it (15 minutes)

### 1.1 Get the code and tools
```bash
git clone -b claude/magical-albattani-8t9v2l https://github.com/shrirudragoud/Operations-CRM.git
cd Operations-CRM && npm install && (cd tools && npm install)
```
Needs Node 22+. Docker is only needed for the local Supabase stack (1.4).

### 1.2 Prove the database rules (no Docker, no network)
```bash
npm run test:db       # expect: 197 passed, 0 failed
npm run lint && npm run typecheck && npm test    # expect clean, 32 unit tests
```
If `test:db` fails, stop: the database layer is the foundation and nothing else is trustworthy.

### 1.3 Run the app against the HOSTED ops project
The hosted project is `qngzrzymakuqfljdotwi` (Supabase org "Operations Database", Tokyo). Create `.env.local`
(git-ignored) from `.env.example` with the **URL** and the **publishable key** (Dashboard -> Settings -> API Keys).
```bash
npm run dev           # http://localhost:3000
```
Sign in with **email + password** (the founder's Supabase Auth user was created in the dashboard with Auto
Confirm; the founder invite is in `ops.invite`; the first sign-in claims it and creates the founder staff row).
Check by hand (this is the Phase 0 gate on the real project):
1. `/login` -> sign in -> you land on My work as **Founder** with the full sidebar.
2. `/team` -> Invite a **member** (Sales) and a **partner**. Create their Supabase Auth users in the dashboard
   (Authentication -> Users -> Add user, Auto Confirm) because email links need SMTP, which is not set up yet.
3. Sign in as each (private window): member sees only shared areas + Sales; partner sees only
   "My institutions / My activities / My deals"; both get an access-denied panel on other URLs.
4. An Auth user with **no invite** must land on `/no-access`. Deactivate someone on `/team`: their next page load
   goes to `/no-access`. The last founder cannot be demoted or deactivated.

Where to look in the dashboard: tables are in schema **`ops`**, not `public` (use the schema dropdown in
Database -> Tables). `public` is empty on purpose.

### 1.4 Run the browser tests on a LOCAL Supabase stack (never against hosted)
```bash
npx supabase start -x studio,imgproxy,vector,logflare,edge-runtime,realtime,storage-api,postgres-meta,supavisor
npx playwright install chromium     # first time only
npx playwright test --trace off     # expect: 9 passed
```
The tests reset data, so `playwright.config.ts` builds a separate copy (`NEXT_DIST_DIR=.next-e2e`) against
`127.0.0.1` and throws on any non-local URL. Do not weaken that guard. Magic-link mail is read from Mailpit
(`http://127.0.0.1:54324`).

### 1.5 Optional: keep a production build running
`scripts/serve.sh start|stop|redeploy|status` (port 3000, restarts on crash, logs in `.run/app.log`).

---------------------------------------------------------------------------------------------------

## Part 2. Understand it (read in this order, about 45 minutes)

| # | Read | Why |
| --- | --- | --- |
| 1 | `CLAUDE.md` | The non-negotiable rules and commands |
| 2 | `docs/HANDOFF.md` | Current state, hosted status, accepted Advisor warnings, known gaps |
| 3 | `docs/PRODUCT_OVERVIEW.md` | One journey: Outreach -> Sales -> Workshop -> Training -> Product -> Community |
| 4 | `docs/DECISIONS.md` | D1-D22: what was decided and why; open questions at the bottom |
| 5 | `docs/BUSINESS_RULES.md` | Every database rule, its trigger, and its exact error text |
| 6 | `docs/ACCESS_MODEL.md` | Invite-only login, roles, the permission matrix, RLS patterns |
| 7 | `docs/BUILD_PLAN.md` | Phases and acceptance criteria (Phase 1 is next) |
| 8 | `docs/DEPARTMENTS.md`, `DATA_MODEL.md` | Per-department screens and KPIs; tables and RPCs |
| 9 | `docs/ARCHITECTURE.md`, `PRODUCTION_STANDARDS.md` | Stack, data-access rules, Definition of Done |
| 10 | `docs/INTEGRATIONS.md` | PostHog / IDE sync / jobs (Phase 2+) |

### The mental model in ten lines
1. One Supabase Postgres, schema `ops` (35 tables, 5 views). Migrations `supabase/migrations/0001-0012`.
2. **Rules live in the database** (triggers, RPCs, RLS). The UI calls them and shows their error text.
3. **Invite-only**: signing in grants nothing. `ops.claim_access()` turns an invite into a `staff` row.
4. Roles: `founder`, `dept_lead`, `member`, `viewer`, `partner`; departments: outreach, sales, workshop,
   training, product, community. Founder = all departments. Partners own rows and have no departments.
5. **Stock is a ledger** (`stock_movement`); availability comes from `v_stock`. Never UPDATE counts.
6. **Institution stage is event-driven** (activities, deals, events, certifications move it forward).
7. Only the founder can mark a deal Won; Won creates a draft event + tasks.
8. Soft delete: `archived_at` on institution/deal/event (0011); founder/dept_lead only.
9. App: Next 16 App Router, `proxy.ts` (was middleware), Server Components read, Server Actions call RPCs.
10. Access in the UI mirrors RLS in `lib/permissions.ts` (`canAccess`); pages use `requireArea()`, actions
    `actionCaller()`; the DB is still the real guard.

### Code map
```
supabase/migrations/        0001-0012 (never edit an applied file; add 0013+)
supabase/config.toml, seed.sql   local stack only (seed.sql = local demo founder invite)
supabase/seed_founder.sql   one-time hosted founder invite (already run)
tools/test-migrations.mjs   PGlite suite entry; test-access.mjs, test-archive.mjs are called from it
tools/gen-types.mjs         generates lib/db.types.ts from migrations (CI checks it is fresh)
lib/permissions.ts          roles, areas, canAccess (unit-tested)      lib/nav.ts   sidebar items per role
lib/auth.ts                 getMe (ops.me()), requireMe/requireArea/actionCaller
lib/errors.ts               maps DB errors -> user messages (RAISE EXCEPTION text shown as-is)
lib/actions/team.ts         Server Actions over the founder-only RPCs      lib/schemas/  Zod schemas
utils/supabase/{client,server,proxy}.ts   Supabase SSR clients, session refresh   proxy.ts   route gate
app/(auth)/login, app/auth/{callback,claim,signout}, app/no-access   sign-in flow
app/(app)/                  signed-in shell: layout, My work, Team, Account, placeholders for later workspaces
components/ui/              shadcn (vendor code, regenerate with `npx shadcn add`, do not hand-edit)
e2e/                        Playwright (local stack only)       scripts/serve.sh   runner
```

### Things that will surprise you (learned the hard way)
- **Next 16 differs from your training data.** Read `node_modules/next/dist/docs/` (see `AGENTS.md`).
  `middleware.ts` is `proxy.ts`; `forbidden()` needs an experimental flag so we render `AccessDenied` instead;
  `cacheComponents` is off on purpose (D13).
- **shadcn changed**: preset `radix-vega` (not new-york); use `Field*` components, not `form` (D14).
- **Policies are recreated in 0010.** Rules for new ones: one per table+action, wrap `auth.uid()`/helpers in
  `(select ...)`, index every FK, end with `revoke execute on all functions in schema ops from public;`.
  Tests enforce all of these; a new table also needs RLS + a test as two roles.
- **The local Advisor lies about hosted.** After `ops` was exposed in the Data API the hosted Advisor reported
  extra WARNs the local one never showed. Run `npx supabase db advisors --remote --level warn` after each
  migration (8 `authenticated_security_definer_function_executable` on RLS helpers + 2 on Supabase's own
  `public.rls_auto_enable()` are accepted; anything else is new and needs fixing).
- **Never `supabase config push`.** `config.toml` holds local-only values (localhost redirect URLs, relaxed
  email rate limit) that would overwrite hosted auth settings.
- **`claim_access` trusts the JWT email**, so keep "confirm email" on in Supabase Auth. Turning it off would let
  an unverified sign-up claim an invite.
- **Dashboard "Invite user" is the wrong tool** here: its link goes to the Site URL with tokens in the hash,
  which this app does not read. Use Add user -> Create new user with a password and Auto Confirm.
- `supabase` CLI under an agent defaults to JSON mode and may refuse prompts; pass `--agent no --output-format text`.
- If you only have an HTTPS egress proxy (cloud sandbox): `db push` cannot connect; use
  `supabase db query --remote --yes -f <migration.sql>` and run `migration repair` later (below).

### Hosted project status (verify, do not assume)
```bash
npx supabase login && npx supabase link --project-ref qngzrzymakuqfljdotwi
npx supabase db query --remote --read-only "select count(*) from pg_tables where schemaname='ops'"   # 35
npx supabase db advisors --remote --level warn
```
Migrations 0001-0012 were applied through the SQL API, so the CLI's migration history table is **empty**. Before
the first `db push` from a machine that can reach Postgres, run:
```bash
npx supabase migration repair --status applied 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012
```
then `npx supabase db push --dry-run` must report nothing to apply.

---------------------------------------------------------------------------------------------------

## Part 3. Continue the work

### 3.1 Open items that need the founder (do not guess)
| Item | State |
| --- | --- |
| Public URL | None yet. Deploy to Vercel with the two `NEXT_PUBLIC_` vars, then in Supabase Auth set Site URL + add `https://<domain>/auth/callback`. Add the domain to the CSP only if it differs from same-origin (it should not) |
| SMTP | Not set up. Needed for magic links and for inviting people without creating their password by hand (Resend/Brevo free tier). Founder postponed it |
| Google sign-in | Not configured (needs a Google Cloud OAuth client). Code path is the same as magic link |
| Event `in_progress` | Unanswered. Default: a manual **Start event** button (do not auto-start by time) |
| Kits vs Buy-store stock | Unanswered. Default: one ledger, warehouse + store locations; `sold` movements only from store |
| Revoke the CLI token | A Supabase CLI login named `hardcode-ops-agent` was created in the cloud sandbox; the founder should revoke it (Account -> Access Tokens) |

Founder decisions already made are D18-D22 in `docs/DECISIONS.md` (workshops are 1/3/5-day physical events with
1-3 trainers plus kits; free promotional workshops are allowed so Won at INR 0 is fine; team under 9 with shared
departments; archive not delete; no partner KPIs yet, ops tool first).

### 3.2 Phase 1, in this order (one workspace per PR; migration + tests + UI + docs together)
Status: `0011_archive` done and applied. **No Phase 1 screen is built yet.**

1. **Institutions + contacts + Institution 360** (start here; nothing blocks it)
   - List: server-side pagination (25-50/page), filters (stage, district, kind, owner, archived), search by
     name, sort. Use `@tanstack/react-table`; query with explicit columns, `range()`, `count: 'exact'`.
     Hide archived by default (`archived_at is null`).
   - Create/edit (React Hook Form + Zod, Server Actions). Stage is **read-only** in the form (event-driven;
     only the founder can correct it, via a dedicated action).
   - Contacts on the 360 page. Archive/restore buttons only for founder/dept_lead (`canArchive` helper +
     the DB trigger errors shown inline).
   - CSV import: dry run first (validate, show row errors, nothing written), then commit in a transaction/RPC;
     dedupe on `(name, city)` (unique constraint exists).
   - 360 page tabs: Overview, Contacts, Activities, Deals, Events, Notes (later tabs can be empty states that
     link to their workspace until those exist).
   - Acceptance: partner sees only own institutions (RLS) and cannot archive; a user without Outreach/Sales
     cannot create; errors from `BUSINESS_RULES.md` appear next to the action; Playwright test for create ->
     edit -> archive -> restore as two roles.
2. **Outreach**: activity log (sheet), follow-up queue, territory list, STEM calendar. Logging a `qualified`
   activity creates the deal (DB does it).
3. **Sales**: kanban (dnd-kit) over `deal.stage`, deal detail with lines, lost-reason dialog, founder-only
   **Mark won** (button hidden for others; DB enforces), forecast. Won creates one draft event + two tasks.
4. **Workshop**: event calendar (FullCalendar), status stepper, trainer picker showing only certified and free
   trainers (`v_certified_trainer`; `trainer_conflict` is now **not** callable by users (0012), so query
   `event`/`event_staff` for availability or add a definer RPC that returns only the caller-safe answer),
   run-sheet checklist, cohort code. 1/3/5-day events are just `starts_at`/`ends_at`; assistants via `event_staff`.
5. **Inventory**: items, kits (BOM), locations, receive stock, reserve/issue/return dialogs (the returns form
   must balance returned + damaged + lost = issued per item and require a note for loss), low-stock panel.
   Use the RPCs (`reserve_kit`, `issue_kit`, `close_event_returns`); never write stock rows from the UI.
   Gate: one real workshop runs end to end (deal won -> event -> kits issued/returned).

Then Phases 2-5 in `docs/BUILD_PLAN.md`.

### 3.3 Definition of done for every change (from `docs/PRODUCTION_STANDARDS.md`)
- Rule in the database with allowed and forbidden tests, at least two roles when access is involved.
- RLS for new tables; Zod validation on the server; loading, empty, error and permission-denied states;
  server-side pagination; keyboard + labels + contrast; rule errors shown next to the action.
- Audit trigger when money, stock, stage or access changes. Types regenerated (`npm run gen:types`).
- `npm run test:db && npm run lint && npm run typecheck && npm test` green; Playwright for the critical path.
- After any migration: `cat supabase/migrations/*.sql > supabase/all_migrations.sql`, apply to hosted
  (staging first if you have Branching), re-run the **remote** Advisor, update `HANDOFF.md`.
- Commit style: imperative subject, body explains why. Do not open PRs unless the founder asks.

### 3.4 Security hygiene
- Only the URL and the **publishable** key are `NEXT_PUBLIC_`. The secret/service-role key is never in this
  app, the repo, or a chat; it belongs only in Edge Function secrets (Phase 2).
- Do not paste sign-in links, access tokens or passwords into chats or commits (one session token was pasted
  in chat once; the user was deleted and recreated to revoke it).
- `gitleaks` runs in CI; `.env*` is git-ignored except `.env.example`.

### 3.5 First things to do in your first session
1. Part 1 end to end; write down anything that does not work.
2. Run the hosted checks in Part 2 and the remote Advisor.
3. Confirm with the founder: public URL decision, event `in_progress` button, kits/store stock.
4. Start Institutions (3.2 #1) on a new branch off this one.
5. End the session by updating `docs/HANDOFF.md` ("What exists", "Known gaps") and this file's status line.
