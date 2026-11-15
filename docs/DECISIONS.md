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
