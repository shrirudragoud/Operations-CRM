# Operations CRM (Hard-Code Ops): agent instructions

Internal operations CRM for Hard-Code (hard-code.in, an AI hardware IDE sold to schools and colleges
in India). One Supabase database, one Next.js app, six department workspaces on a shared core.

**Read first, in order:** `docs/HANDOFF.md` (state + next steps) -> `docs/PRODUCT_OVERVIEW.md` ->
`docs/BUILD_PLAN.md`. Everything else is reference.

**Product evolution loop** (sessions, class sign-in, items to the field): `docs/loop/STRATEGY.md` and
`docs/loop/IMPLEMENTATION_PLAN.md`. **Before coding any of it, ask the founder the related questions in
`docs/loop/OPEN_QUESTIONS.md` and wait for answers.**

## Non-negotiables
1. **Business rules live in the database** (triggers, RPCs, RLS), never only in UI code.
   See `docs/BUSINESS_RULES.md`. The UI calls them and shows their error messages.
2. **Never edit an applied migration.** Add `supabase/migrations/00NN_name.sql`. Keep
   `supabase/all_migrations.sql` regenerated (`cat supabase/migrations/*.sql > supabase/all_migrations.sql`).
3. **Every migration change must keep `node tools/test-migrations.mjs` green**, and new rules need new
   checks in that file. It runs the migrations in an in-memory Postgres (PGlite) with Supabase auth stubbed.
4. **RLS on every table.** A new table without RLS + policies + a test as at least two roles is not done.
5. **Secrets:** only the publishable key is ever `NEXT_PUBLIC_`. The secret/service-role key is used only in
   Edge Functions / server-only code and never committed or pasted into chats.
6. **Stock is a ledger, stage fields are event-driven.** Never write `UPDATE` code that edits stock counts
   or institution stage directly from the UI; use the RPCs/triggers.
7. Standards for "done": `docs/PRODUCTION_STANDARDS.md`.

## Commands
```
cd tools && npm install && node test-migrations.mjs    # database rules + RLS (must pass)
# app (once scaffolded)
npm run dev | lint | typecheck | test | build
```

## Conventions
- Schema `ops` only (query with `supabase.schema('ops')`). Types: `supabase gen types typescript --schema ops`.
- Server Components read; Server Actions / RPC mutate. No service key in the browser.
- UI: shadcn/ui (new-york style, Tailwind v4) in `components/ui`. Forms: React Hook Form + Zod.
- Money is INR `numeric(12,2)`. Timestamps are `timestamptz`; display in Asia/Kolkata.
- Commit style: imperative subject, body explains why. Small PRs per workspace.
