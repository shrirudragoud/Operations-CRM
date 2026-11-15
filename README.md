# Hard-Code Ops CRM

Internal operations CRM for Hard-Code. **Start with `CLAUDE.md` and `docs/HANDOFF.md`.**

| Doc | What |
| --- | --- |
| `docs/HANDOFF.md` | State, first steps, known gaps |
| `docs/PRODUCT_OVERVIEW.md` | Purpose, departments, lifecycle |
| `docs/DEPARTMENTS.md` | Work types, screens, KPIs per department |
| `docs/DATA_MODEL.md` | Tables, views, functions |
| `docs/BUSINESS_RULES.md` | Every rule, where enforced, what is missing |
| `docs/ACCESS_MODEL.md` | Login, invites, roles, permission matrix |
| `docs/ARCHITECTURE.md` | Stack, layout, client setup, environments |
| `docs/INTEGRATIONS.md` | PostHog, IDE sync, jobs, cohort code |
| `docs/BUILD_PLAN.md` | Phases, tasks, acceptance, shadcn setup |
| `docs/PRODUCTION_STANDARDS.md` | Definition of Done and launch checklist |
| `docs/DECISIONS.md` | Decisions and open questions |

## Quick start (local, no hosted project needed)
```
npm install && (cd tools && npm install)
npx supabase start -x studio,imgproxy,vector,logflare,edge-runtime,realtime,storage-api,postgres-meta,supavisor
cp .env.example .env.local      # then paste the local URL + publishable key from `npx supabase status`
npm run dev                     # http://localhost:3000, sign in as founder@hardcode.local (link in Mailpit :54324)
```

| Command | What |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js app |
| `npm run lint` / `typecheck` / `test` | ESLint, TypeScript (strict), Vitest unit tests |
| `npm run test:db` | Business rules + RLS + access + advisor checks in PGlite (178 checks) |
| `npx playwright test` | Phase 0 gate end-to-end (needs the local Supabase stack + `npm run build`) |
| `npm run gen:types` | Regenerate `lib/db.types.ts` from the migrations |
| `npx supabase db advisors --level info` | Supabase Security + Performance Advisors against the local stack |

## Database

Schema `ops`: 35 tables, 5 views, business rules (state machines, automations, inventory RPCs),
row-level security and invite-only access, in `supabase/migrations/0001-0010`.

## Apply it to the hosted ops project
See `docs/HANDOFF.md` "Apply the database" for the exact, ordered steps (SQL editor or CLI). Never run
these against the IDE product database (`Idea_labs_DB`).

## Rules enforced in the database
- Institution stage only moves forward (founder can correct).
- Deals: meeting > proposal > negotiation > won/lost. Lost needs a reason. Only the founder can mark Won.
  Won creates the draft event, a trainer-request task and a kit task, and moves the institution to deal_won.
- Events: scheduling needs trainer, dates, venue, headcount; trainer must be certified (or the founder)
  and free. Scheduling creates the cohort code and the run sheet. Completing needs actual headcount
  and a finished run sheet, then raises the post-event tasks.
- Stock is a ledger: no negative balances per location, reservations cannot exceed warehouse stock,
  issue/return are paired movements, returns must add up to what was issued, losses need a note.
- Partners see only the institutions, activities, deals and events they own, and can open deals only at
  their own institutions.
- Access is invite-only; only the founder manages the team; the last active founder cannot be removed.
- Jobs (`assign_review_queue`, `raise_low_stock_tasks`, `request_part`) are service-role only.
