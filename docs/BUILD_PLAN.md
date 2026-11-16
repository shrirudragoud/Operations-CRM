# Build plan

Phases are ordered by risk and value: money, physical assets and partner accountability first. Each phase
ends with a **gate** that must pass with real (not demo) data. Dates are proposed from 16 Nov 2026 for one
full-time engineer/agent; adjust to capacity.

For every screen: server-side pagination, loading skeletons, empty states, error states, keyboard access,
and the rule errors from `BUSINESS_RULES.md` shown inline. See `PRODUCTION_STANDARDS.md` (Definition of Done).

## shadcn setup
```
npx shadcn@latest init -b radix -p vega   # done; `new-york` is now the `vega` preset (D14), neutral, CSS variables
npx shadcn@latest add button input label textarea select checkbox switch radio-group form card badge \
  avatar separator skeleton alert dialog sheet drawer popover command dropdown-menu tabs table tooltip \
  hover-card progress calendar sonner breadcrumb sidebar scroll-area toggle-group slider resizable \
  carousel chart pagination
npm i @tanstack/react-table react-hook-form zod @hookform/resolvers @dnd-kit/core @dnd-kit/sortable \
  @fullcalendar/react @fullcalendar/daygrid @fullcalendar/timegrid @fullcalendar/interaction \
  @supabase/supabase-js @supabase/ssr date-fns
```
Brand: neutral base with one accent; dark mode via `class`. Typography: system or Inter (self-hosted).

## Phase 0: Foundation (about 1 week)
Tasks
- [ ] Apply migrations 0001-0010 to the hosted ops project; expose `ops`; seed founder invite; Advisors clean.
      (Done on a local Supabase stack: 0 ERROR/WARN. Hosted: waiting on founder, see `HANDOFF.md`.)
- [x] Tests for `0009_access.sql` (list in `ACCESS_MODEL.md`) + `0010` advisor-equivalent checks.
- [x] Scaffold Next.js + shadcn; `utils/supabase/*` and `proxy.ts` (Next 16 name for middleware) per `ARCHITECTURE.md`.
- [x] `/login` (Google + magic link), `/auth/callback` (exchange + `claim_access`), `/no-access`.
- [x] App shell: `sidebar` with role-aware nav from `lib/permissions.ts` (unit-tested), header with user
      menu + sign-out, `breadcrumb`, `command` search stub, dark mode, toasts.
- [x] **Team** page (founder): staff table, invite dialog, edit role/departments, deactivate, pending
      invites (revoke/resend). Server Actions + Zod.
- [x] CI (`.github/workflows/ci.yml`): DB tests, lint, typecheck, unit, build, audit, secret scan, e2e + Advisors.
- [x] Generate `lib/db.types.ts`; error-handling helper that maps rule errors to messages.
Gate: founder signs in, invites a member and a partner; each sees only what the matrix allows; a
non-invited Google account lands on `/no-access`; last founder cannot be removed.
**Status:** passed on a local Supabase stack (`e2e/phase0-gate.spec.ts`); repeat on the hosted project.

## Phase 1: Revenue and assets (about 3 weeks)
Progress: database core done and frozen (`0011` archive, `0012`, `0013`: trainer picker, CSV import, search, job log, DPDP erasure; all applied to hosted). **Institutions + contacts + 360 + CSV import: done** (branch `phase1-institutions`). `0014` (deal types, segments, funnel/pipeline views, community membership) written and tested, not yet on hosted. Next: Outreach, then Sales with the four deal types and a segment filter.
1. **Institutions + contacts (DONE):** list (filters: stage, district, type, owner), create/edit, CSV import
   (dry-run, error report), **Institution 360** page.
2. **Outreach:** activity log `sheet`, follow-up queue, territory list, STEM calendar. Qualified -> deal appears.
3. **Sales:** kanban pipeline, deal detail (lines, files, history), lost dialog, founder "Mark won",
   forecast, partner scorecard.
4. **Workshop:** event calendar + detail, status stepper, trainer picker (only certified/free shown),
   run-sheet checklist, cohort code display/copy.
5. **Inventory:** items, kits (BOM editor), locations, receive stock, reserve/issue/return dialogs
   (`close_event_returns` form with per-item returned/damaged/lost), stock-by-location, low-stock panel.
Acceptance (selected)
- Won deal creates exactly one draft event and two tasks; UI links to them.
- Scheduling an uncertified or double-booked trainer shows the DB error inline; trainer picker prevents it.
- Reserving more than available fails with the SKU named; issue/return keep totals correct.
- Returns form blocks until every issued item balances; loss requires a note.
Gate: **one real workshop runs end to end** in the system (deal won -> event -> kits issued/returned ->
cohort students visible in activation view).

## Phase 2: Product insight (about 2 weeks)
- [ ] `ops.job_run` table; Edge Functions `posthog-sync`, `build-review-queue`, `ide-sync` + cron
      (`INTEGRATIONS.md`); IDE cohort-code change shipped.
- [ ] Review queue screen (`resizable`): my 15 items, open replay link, observation form, skip with reason.
- [ ] Insights board (group observations, link issue, status), unified feedback inbox with routing.
- [ ] Activation funnel per cohort/institution (`v_cohort_activation`), Product dashboard.
- [ ] Incidents, catalog request queue.
Gate: a reviewer clears a 15-replay queue in under 45 minutes; one insight linked to a shipped fix.

## Phase 3: People and community (about 2 weeks)
- [ ] Training: trainer roster + availability, programs/modules, teacher enrollments, certification flow
      (`teachers_trained` rule), leaderboard.
- [ ] Community: growth metrics cards/charts, content kanban (`published` needs URL), featured queue,
      spotlight stories from cohorts, campaign calendar.
Gate: Workshop assigns trainers only from the certified roster; the weekly community report is generated.

## Phase 4: Automation and cockpit (about 2 weeks)
- [ ] `kpi-snapshot`, `low-stock`, notifications (in-app, then email/WhatsApp).
- [ ] Missing rules from `BUSINESS_RULES.md` ("Not yet implemented") decided and shipped with tests.
- [ ] Founder cockpit with drill-downs; partner scorecards; college report PDF after each event.
- [ ] Audit log viewer (founder).
Gate: the fundraising funnel is produced from the cockpit with no spreadsheet.

## Phase 5: Production hardening (overlaps; finish before launch)
Everything in `PRODUCTION_STANDARDS.md`: staging, backups/PITR, monitoring, a11y audit, load check on
seeded data (10k institutions-scale lists, 100k stock movements), security review, runbooks, onboarding doc.

## Working agreement for the next agent
1. One workspace per PR; migrations + tests + UI + docs updates together.
2. Update `docs/HANDOFF.md` "What exists" and "Known gaps" at the end of every session.
3. Ask the founder before changing a decision in `DECISIONS.md`; record new ones there.
