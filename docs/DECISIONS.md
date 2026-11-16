# Decisions and open questions

## Decisions made (with reasons)
| # | Decision | Why |
| --- | --- | --- |
| D1 | Build an internal app on Supabase rather than HubSpot/Notion/Sortly | One DB joins deals, events, stock and IDE usage (cohort activation); stays in the stack the founder already runs |
| D2 | One shared core + six department workspaces | The institution journey crosses all departments; separate tools break at handoffs |
| D3 | Business rules in Postgres (triggers/RPC/RLS) | Every client (UI, imports, Edge Functions) must obey them; testable without a browser |
| D4 | Stock is an append-only ledger; availability = warehouse/store stock minus reservations | Auditable, race-safe, no hand-typed counts |
| D5 | Invite-only access with `claim_access()` | Google sign-in alone must not grant access; clear onboarding for team and partners |
| D6 | Sales sells, Workshop delivers; won deal auto-creates the event | Removes the Workshops/Cohorts overlap in the ops chart |
| D7 | Only the founder can mark a deal Won | Partner KPIs and equity depend on it; prevents self-reporting |
| D8 | Partners see the value of their own deals | One DB role cannot hide a column per user; they negotiate those deals anyway |
| D9 | Cohort code `HC-XXXX` links workshop students to IDE usage | The single join that produces the activation metric investors ask for |
| D10 | Link to PostHog replays, do not rebuild replay | Cost and scope |
| D11 | Trainer must be certified (or the founder) to lead a scheduled event | Quality control; founder often delivers |
| D12 | Postgres tested with PGlite in CI | Fast, no external DB needed, runs every rule and RLS check |
| D13 | Next.js 16: `proxy.ts` instead of `middleware.ts`; `cacheComponents` off, pages render dynamically | Next 16 renamed middleware; every page is per-user + RLS, so Cache Components would add Suspense/validation work with little benefit. Revisit for the cockpit if it gets slow |
| D14 | shadcn preset `radix-vega` + `field` components instead of `new-york` + `form` | shadcn retired the `new-york` style name (vega is the classic look) and replaced `form` with `field`; React Hook Form + Zod unchanged |
| D15 | RLS policies consolidated to one per table/action, helpers wrapped in `(select ...)` (`0010`) | Clears the Performance Advisor warnings (37 WARN on 0001-0009) before data grows; policies live in one file |
| D16 | Partners can open deals only at institutions they own; partners have no departments | Matches the "own rows only" matrix; previously a partner could open a deal at any institution id |
| D17 | `lib/db.types.ts` generated from the migrations (`tools/gen-types.mjs`) | Types stay in step with migrations without network access to the project; same format as `supabase gen types`, so either can overwrite it |

| D18 | A workshop is a physical event at a school/college/institution lasting 1, 3 or 5 days. 1-3 trainers travel with a component kit; trainers teach, hand out controllers/sensors, and students build on the IDE in the workshop or with the online builder (founder, 15 Nov 2026) | Confirms events carry a lead trainer + up to 2 assistants (`event_staff`), kits issued per event, and a duration of 1-5 days |
| D19 | Workshops may be paid or free promotional ones; Won is allowed at INR 0 and no value rule is added (founder) | Closes open question 4. Keep `deal.value_inr` as is; reporting should split paid vs promotional by value = 0 |
| D20 | Team is under 9 people, about 2 per department, people share departments and roles stay flexible (founder) | Closes open question 2. No UI merge: give people several departments (already supported). Revisit the partner/role split only if needed |
| D21 | Archive instead of hard delete for institutions, deals and events (founder) | Closes open question 11. Implemented as `archived_at` columns + RLS/UI filters in migration 0011 (Phase 1) |
| D22 | No partner-specific KPIs yet; `kpi_target` stays unused until the partner contract defines metrics (founder) | Closes open question 10 for now. Priority is a solid operations tool first |

| D24 | Deal types are Workshop, Faculty training (`fdp`), Lab deal (`lab_setup`) and Other (`other`, replaces `bundle`); one open deal per type per institution; schools and colleges are one institution list with a derived `segment` (school / college / other) used by every funnel and pipeline report (founder, 16 Nov 2026) | Migration `0014`. Winning Other creates a Sales task only (no event, no kits) |
| D25 | Community relationships (clubs, ambassadors) are tracked in `ops.community_membership`, many per institution, written by Community (founder, 16 Nov 2026) | Migration `0014`. Hand-entered relationship data only |
| D26 | Product and community **user data comes from the existing PostHog**, synced into `ide_user_snapshot` / `ph_user_daily` / `ph_session` (Phase 2 Edge Functions); the CRM never creates its own user or product-usage store (founder, 16 Nov 2026) | The product already runs on infra; a second source would drift. Community screens read these tables |
| D27 | Build order: Institutions -> Outreach -> Sales -> Workshop -> Inventory -> Product -> Community; the main funnel must work reliably before delivery and insight workspaces (founder, 16 Nov 2026) | Revenue funnel first; one workspace per PR |
| D23 | Database core frozen after `0013_core_complete` for the Phase 1 screens; automatic stages (`active`, `lab_customer`, `renewal`) wait for founder definitions and now ship as `0018` (`0014` = deal types, segments, community membership; `0015` = Outreach territory view; `0016` = deal guards; `0017` = Workshop guards) | Screens can be built on a stable schema; the stage rules need business input. Proposal pending: `active` = at least 10 workshop students with a compile/flash in the last 14 days |
| D28 | A deal value cannot be negative; once Won, only the founder can change its value, type, institution, owner, title, chance or close date, or its proposal lines; proposal lines are saved as one atomic set by `ops.replace_deal_lines` (agent decision, 16 Nov 2026, to confirm with the founder) | Migration `0016`. Partner KPIs and equity (D7) depend on Won deals, so they must not be editable afterwards. Founder can revisit if Sales needs to correct a won deal |
| D29 | The Workshop calendar is a server-rendered month grid (links for month, type and trainer), not FullCalendar; cancelled and archived events are not shown because they no longer hold a date or trainer (agent decision, 16 Nov 2026) | No client calendar bundle, URL state is shareable. Week/day views and drag to reschedule can be added if the team asks |
| D30 | An event's team is saved as one set (lead + at most 2 assistants) by `ops.set_event_team`; cancelling needs a reason; run-sheet ticks are stamped by the database, never by the client (agent decision, 16 Nov 2026) | Migration `0017`. `event_staff` delete is lead-only under RLS, so a security-definer RPC is needed; stamps must be trustworthy |
| D31 | `in_progress` is a manual **Start** button, not a cron at `starts_at` (agent default, 16 Nov 2026, to confirm) | Simple and predictable; completion does not need it. Revisit when cron jobs exist (Phase 5) |

## Open questions for the founder (answer before the phase noted)
1. **Which Supabase project is the ops DB?** The intended ops project is separate from the IDE product DB
   (`Idea_labs_DB`). Confirm, and decide copy-by-sync vs read-only views if they ever share a project. (Phase 0)
2. **Team size per department.** If under 2 per department, merge Outreach into Sales and Training into
   Workshop in the UI for v1 (schema unchanged). (Phase 0)
3. **Are workshop kits and Buy-store stock the same physical inventory?** Decides one ledger vs two
   location groups and when `sold` movements are written. (Phase 1)
4. **Are workshops paid by institutions or free to win lab deals?** Decides whether Won requires value > 0
   and how revenue is reported. (Phase 1)
5. **PostHog Cloud (US/EU) or self-hosted?** Decides the sync host and auth. (Phase 2)
6. **Issue tracker for insights:** GitHub Issues or Linear. (Phase 2)
7. **When does an event become `in_progress`:** button or automatic at start time. (Phase 1)
8. **Definition of an `active` institution** (N students, window) and of `lab_customer`/`renewal`. (Phase 4)
9. **Notification channel and provider:** email, WhatsApp, both; sender identity. (Phase 4)
10. **Partner contract KPIs:** metrics and quarterly targets to encode in `kpi_target`. (Phase 1)
11. **Soft delete vs hard delete** for institutions/deals/events. (Phase 1)
12. **Data residency / backup plan** beyond Supabase defaults (PITR plan tier). (Phase 5)

## How to record a change
Add a row to the table above (next number), state the reason, and link the migration/PR. Do not silently
change a decision in code.
