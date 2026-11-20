# Handoff

Last updated: 16 Nov 2026. Owner/founder: Shri (Hard-Code / Idea-Labs).

## What exists
| Area | State |
| --- | --- |
| Product plan, department work types, data model | Written (this `docs/` folder; original plan also in a shared Claude doc) |
| Database: 35 tables, 5 views, business rules, RLS, invite-only access | **Written and tested** (`supabase/migrations/0001-0009`, 85 passing checks in PGlite) |
| Applied to a real Supabase project | **NO.** The agent that wrote it had no network/MCP access to Supabase. Apply it first (below). |
| Next.js app | **NOT STARTED.** No app code exists yet. |
| Edge Functions / cron jobs | Not written (specs in `docs/INTEGRATIONS.md`) |
| CI | `.github/workflows/ci.yml` runs the database tests on every push/PR |

## Product evolution loop (added 21 Nov 2026)
Planned on top of BUILD_PLAN Phase 0-1: `docs/loop/`. Nothing built yet. Loop phases B-E are **blocked on the
founder's answers** in `docs/loop/OPEN_QUESTIONS.md`; ask before coding.

## Do these first, in order
1. **Apply the database.** Supabase dashboard (the new ops project) -> SQL Editor -> run
   `supabase/all_migrations.sql`. Then Settings -> Data API -> **Exposed schemas** -> add `ops`.
   Or: `supabase link --project-ref <ref> && supabase db push`.
2. **Seed the founder invite:** edit `supabase/seed_founder.sql` with the founder's Google email and run it.
3. Run Supabase **Security Advisor** and **Performance Advisor**; fix anything raised on the `ops` schema.
4. **Write the missing tests for `0009_access.sql`** in `tools/test-migrations.mjs` (stub `auth.jwt()` to
   return `email` and `user_metadata.full_name`): claim with valid invite, expired invite, no invite,
   disabled user, double-claim, last-founder protection, invite visible only to founder.
5. **Scaffold the app** per `docs/ARCHITECTURE.md` and start `docs/BUILD_PLAN.md` Phase 0.
6. Answer or confirm the questions in `docs/DECISIONS.md` ("Open questions") with the founder before Phase 1.

## Environment notes
- The previous agent's workspace could reach npm but **not** the shadcn registry, GitHub raw, or Supabase.
  If you can, use `npx shadcn@latest init` and `add` (list in `docs/BUILD_PLAN.md`).
- Keys in `.env.local` (git-ignored): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
  Template in `.env.example`.
- Two Supabase projects exist: the **IDE product DB** (`Idea_labs_DB`, ap-south-1) and the **new ops project**.
  Do not run ops migrations against the product DB. IDE data reaches ops through the sync in
  `docs/INTEGRATIONS.md`.

## Known gaps and honest caveats
- `0009_access.sql` is applied by the test run but has no dedicated checks (item 4 above).
- No cron schedules or Edge Functions exist yet: PostHog sync, review-queue build, KPI snapshots, low-stock
  job, notifications.
- Event status `in_progress` is never set automatically; decide: manual button, or cron at `starts_at`.
- Institution stages `active`, `lab_customer`, `renewal`, `churned` have no automatic rule yet
  (proposals in `docs/BUSINESS_RULES.md` section "Not yet implemented").
- A won `lab_setup` deal creates a task only; it does not yet create a lab entity or set `lab_customer`.
- `stock_reservation.status = 'draft'` is unused.
- `kpi_snapshot` has a table but no writer. `ops.v_cohort_activation` exists but the IDE must first send
  `cohort_code` at sign-up (see `docs/INTEGRATIONS.md`).
- Partners see the value of their own deals (by design; one DB role cannot hide a column per user).
- DPDP: `ide_user_snapshot` holds IDE user id + email + cohort code only. A `forget_user()` routine is not
  written yet.
- Deletes are hard deletes with cascades on child tables; consider soft delete for institutions/deals
  before production data accumulates.

## Definition of finished (whole project)
All phases in `docs/BUILD_PLAN.md` complete, every item in `docs/PRODUCTION_STANDARDS.md` checked,
founder cockpit produces the fundraising funnel without a spreadsheet, and one real workshop has run
end to end in the system.
