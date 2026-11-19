# Production standards

This is the bar for "done". Check items off per phase; Phase 5 verifies all of them.

## Definition of Done (every feature)
- [ ] Business rule enforced in the database, with a test in `tools/test-migrations.mjs` (allowed and
      forbidden paths, at least two roles when access is involved).
- [ ] RLS policies exist for new tables and cover select/insert/update/delete deliberately.
- [ ] Inputs validated with Zod on the server; client validation is only a convenience.
- [ ] Loading, empty, error and permission-denied states designed (skeleton, helpful message, retry).
- [ ] Server-side pagination/filtering/sorting for lists; no unbounded `select`.
- [ ] Keyboard operable, visible focus, labels on inputs, colour contrast AA, no information by colour alone.
- [ ] Rule errors shown in plain language next to the action, not a generic toast.
- [ ] Audit-relevant changes land in `audit_log` (add trigger when money, stock, stage or access changes).
- [ ] Types regenerated; lint, typecheck, unit/integration tests and `next build` pass in CI.
- [ ] Docs updated (`DATA_MODEL`, `BUSINESS_RULES`, `ACCESS_MODEL`, `HANDOFF`).

## Security
- [ ] Secrets only in env/secret stores; secret key never in client bundle or repo (secret-scan in CI).
- [ ] RLS on every `ops` table; Security Advisor shows zero errors/warnings before each release.
- [ ] `SECURITY DEFINER` functions: `set search_path = ''`, schema-qualified names, minimal grants,
      `revoke ... from public` where not meant for users.
- [ ] Invite-only access verified; deactivated users lose access immediately (RLS uses `is_active`).
- [ ] Authorization uses `getUser()`; Server Actions re-check the caller's role, not only the UI.
- [ ] Rate-limit auth and expensive endpoints; CSRF defaults of Server Actions kept; strict CSP and
      security headers (HSTS, frame-ancestors none, referrer-policy) in `next.config`.
- [ ] Storage buckets private, signed URLs short-lived, file type/size limits, virus scan for uploads
      that leave the company.
- [ ] Dependency audit in CI (`npm audit`, Dependabot), pinned lockfile.
- [ ] Least-privilege read-only DB role for the IDE sync; secrets rotated when staff change.
- [ ] Penetration-style review of RLS: try every table as partner, viewer, member of another department,
      and a signed-in user with no staff row.

## Data protection (India: DPDP Act 2023)
- [ ] Student data minimised to IDE user id, email, cohort code; no names/phones of minors in `ops`.
- [x] `forget_ide_user()` (0013) erases/anonymises IDE-linked rows. [ ] Documented request process.
- [ ] Retention policy: attendance is done (two years, 0024); audit log, replays links, snapshots still to define.
- [ ] Data-processing notes for vendors (Supabase, PostHog, Vercel) and consent text consistent with the IDE.

## Reliability and operations
- [ ] Staging environment mirrors prod; every migration applied to staging first.
- [ ] Supabase backups verified and **PITR** enabled (paid plan) before real data; restore drill documented.
- [x] Jobs idempotent, logged in `ops.job_run`, overdue shown by `ops.job_health()` (0024). [ ] Alert (email) on failure, once SMTP exists. [x] Schedules applied to hosted (18 Nov 2026).
- [ ] Monitoring: error tracking (Sentry), uptime check, Supabase log alerts; dashboards for job health.
- [ ] Runbooks: failed deploy/rollback, failed migration, stuck job, stock reconciliation, lost-access
      recovery (promote founder via SQL editor), incident template (reuse `ops.incident` fields).
- [ ] Rollback plan per migration (forward-fix migration; never edit applied files).
- [ ] Release checklist: Advisors clean, tests green, types regenerated, staging smoke test, tag + changelog.

## Quality
- [ ] CI: DB rule tests, lint, typecheck, unit tests (permissions, formatters), component tests for forms,
      Playwright e2e for critical paths: login/invite, deal-won -> event, schedule + conflict, issue/return
      kits, review a replay.
- [x] Seed script with realistic fake data (`scripts/seed-demo.sh`, local only, no real PII).
- [ ] Performance: list pages P95 < 500 ms server time at 10k rows; LCP < 2.5 s on 4G; `EXPLAIN` checked
      for indexes; images/fonts optimised; heavy widgets dynamically imported.
- [ ] Accessibility audit (axe + manual screen-reader pass) on core flows.
- [ ] Browser support: current Chrome, Edge, Safari, Firefox; usable on a tablet (workshop day) and
      phone (field logging of activities and attendance).

## Code standards
- TypeScript strict, no `any`, ESLint + Prettier, import aliases, small server-only modules.
- No business logic in components; actions are thin wrappers over RPCs/queries.
- Naming: tables singular snake_case, migrations `00NN_snake_case.sql`, enums for vocab that rarely changes.
- Conventional, imperative commit messages; PRs small, one workspace each, with screenshots for UI.
- Error handling: expected rule errors mapped to user messages; unexpected errors logged with a request id.

## Operational policies
- Money in INR; show en-IN formatting; dates in Asia/Kolkata (store UTC).
- Every stock change is a movement with who/when; adjustments need a reason; monthly stock count reconciles
  `v_stock_by_location` with physical counts.
- Partner/KPI data is generated from records only; edits to targets are audit-logged.
