# Hard-Code Ops: database

Everything the ops CRM needs in Postgres: schema `ops`, 34 tables, 3 views, business rules
(state machines, automations, inventory RPCs) and row-level security. No MCP required.

## Apply it to your Supabase project (pick one)

**A. SQL editor (easiest, no tools):**
1. Supabase dashboard > SQL Editor > New query.
2. Paste the contents of `supabase/all_migrations.sql` and Run. (If you prefer, run the eight
   files in `supabase/migrations/` in order, 0001 to 0008.)
3. Settings > Data API > **Exposed schemas**: add `ops`. Without this the app cannot see the tables.
4. Sign in once to the app (or add a user under Authentication > Users), then run
   `supabase/seed_founder.sql` with your email. Until you do, RLS shows you nothing.
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
Loads the migrations into an in-memory Postgres, stubs Supabase auth, and runs 84 checks:
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
