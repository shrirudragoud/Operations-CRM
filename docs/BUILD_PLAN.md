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

## Build order (founder decision, 16 Nov 2026, D27)
**Institutions -> Outreach -> Sales -> Workshop -> Inventory -> Product -> Community.** The main funnel
(find institution -> visit/call -> qualified -> deal -> won) is built first and must be reliable and
tested before anything downstream. One workspace per PR; each ships migration (if any) + tests + UI + docs.

## Phase 1A: Main funnel (Institutions, Outreach, Sales)
Progress: database core frozen (`0011`-`0013` on hosted); `0014` (deal types Workshop / Faculty training /
Lab deal / Other, segments, funnel + pipeline views, community membership) tested locally, to be applied to
hosted with the Sales PR. **Institutions + contacts + 360 + CSV import: done** (`phase1-institutions`).
1. **Institutions (DONE):** list (filters: stage, district, type, owner), create/edit, CSV import
   (dry-run, error report), **Institution 360** page.
2. **Outreach (DONE, `0015`):** log activity (visit, call, email, WhatsApp, STEM class, booth) from the list, the 360 and a
   quick-add sheet; outcome (no answer, interested, not interested, follow up, qualified); next step + due
   date creates the follow-up task; **follow-up queue** (overdue / today / upcoming, mark done);
   **territory list** (by district/segment: untouched, contacted, qualified, last touch); my activity
   history. Qualified -> institution `qualified` + a Workshop deal at *meeting* (DB rule, UI shows it).
3. **Sales (DONE, `0016`):** kanban pipeline by deal type (Workshop, Faculty training, Lab deal, Other) with a
   School/College segment filter; create deal from an institution; deal detail (lines, value, probability,
   expected close, history); move stage with DB rule errors inline; **lost** dialog (reason required);
   founder-only **Mark won** (shows the event/tasks it creates); forecast (value + weighted); funnel and
   pipeline reports from `v_funnel` / `v_pipeline`; partner scorecard.
Acceptance
- A visit logged as *qualified* produces exactly one deal at meeting and the institution moves to qualified.
- Follow-up tasks appear in the queue and in My work; completing one removes it.
- Only the founder sees/uses Mark won; a lost deal needs a reason; illegal stage moves show the DB error.
- Won Workshop/Faculty training creates one draft event + two tasks; Lab deal one planning task; Other one
  Sales task.
- Partners see and edit only their own institutions, activities and deals; viewers are read-only.
Gate: **a real prospect travels visit -> qualified -> deal -> won in the live system**, and the funnel and
pipeline numbers match the records.

## Phase 1B: Delivery (Workshop, Inventory)
4. **Workshop:** event calendar + detail, status stepper, trainer picker (only certified/free shown),
   run-sheet checklist, cohort code display/copy.
5. **Inventory:** items, kits (BOM editor), locations, receive stock, reserve/issue/return dialogs
   (`close_event_returns` form with per-item returned/damaged/lost), stock-by-location, low-stock panel.
Acceptance (selected)
- Scheduling an uncertified or double-booked trainer shows the DB error inline; trainer picker prevents it.
- Reserving more than available fails with the SKU named; issue/return keep totals correct.
- Returns form blocks until every issued item balances; loss requires a note.
Gate: **one real workshop runs end to end** in the system (deal won -> event -> kits issued/returned ->
cohort students visible in activation view).

## Phase 2: Product insight (about 2 weeks; after Workshop and Inventory)
Product and community user data comes from the existing PostHog (D26); no parallel user store.
- [ ] `ops.job_run` table; Edge Functions `posthog-sync`, `build-review-queue`, `ide-sync` + cron
      (`INTEGRATIONS.md`); IDE cohort-code change shipped.
- [ ] Review queue screen (`resizable`): my 15 items, open replay link, observation form, skip with reason.
- [ ] Insights board (group observations, link issue, status), unified feedback inbox with routing.
- [ ] Activation funnel per cohort/institution (`v_cohort_activation`), Product dashboard.
- [ ] Incidents, catalog request queue.
Gate: a reviewer clears a 15-replay queue in under 45 minutes; one insight linked to a shipped fix.

## Phase 3: Community and people (about 2 weeks; after Product)
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
