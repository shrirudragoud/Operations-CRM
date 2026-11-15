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

## Database

Everything the ops CRM needs in Postgres: schema `ops`, 35 tables, 5 views, business rules
(state machines, automations, inventory RPCs) and row-level security. No MCP required.

## Apply it to your Supabase project (pick one)

**A. SQL editor (easiest, no tools):**
1. Supabase dashboard > SQL Editor > New query.
2. Paste the contents of `supabase/all_migrations.sql` and Run. (If you prefer, run the eight
   files in `supabase/migrations/` in order, 0001 to 0008.)
3. Settings > Data API > **Exposed schemas**: add `ops`. Without this the app cannot see the tables.
4. Run `supabase/seed_founder.sql` with your sign-in email (it creates a founder invite). The first
   time you sign in, the app turns it into your founder account. Everyone else is invited from the
   Team page. Without an invite, a signed-in user sees nothing.
5. Security Advisor must show no new errors.

**B. Supabase CLI:**
```
npm i -g supabase            # or: npx supabase ...
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase db push             # applies supabase/migrations/*
```
Then do steps 3 and 4 above.

## Check the rules locally (no database needed)
```
cd tools && npm install && node test-migrations.mjs
```
Loads the migrations into an in-memory Postgres, stubs Supabase auth, and runs 85 checks:
deal and event state machines, trainer double-booking, stock ledger, kit returns, RLS per role.

## Rules enforced in the database
- Institution stage only moves forward (founder can correct).
- Deals: meeting > proposal > negotiation > won/lost. Lost needs a reason. Only the founder can mark Won.
  Won creates the draft event, a trainer-request task and a kit task, and moves the institution to deal_won.
- Events: scheduling needs trainer, dates, venue, headcount; trainer must be certified (or the founder)
  and free. Scheduling creates the cohort code and the run sheet. Completing needs actual headcount
  and a finished run sheet, then raises the post-event tasks.
- Stock is a ledger: no negative balances per location, reservations cannot exceed warehouse stock,
  issue/return are paired movements, returns must add up to what was issued, losses need a note.
- Partners see only the institutions, activities, deals and events they own.
- Jobs (`assign_review_queue`, `raise_low_stock_tasks`, `request_part`) are service-role only.
