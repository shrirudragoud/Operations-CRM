# Operations CRM (Hard-Code Ops): agent instructions

Internal operations CRM for Hard-Code (hard-code.in, an AI hardware IDE sold to schools and colleges
in India). One Supabase database, one Next.js app, six department workspaces on a shared core.

**Taking over on a local machine? Start with `docs/LOCAL_AGENT_HANDOFF.md`** (run it, understand it, continue it).
**Read first, in order:** `docs/HANDOFF.md` (state + next steps) -> `docs/PRODUCT_OVERVIEW.md` ->
`docs/BUILD_PLAN.md`. Everything else is reference.

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
cd tools && npm install && cd .. && npm run test:db     # database rules + RLS + access + advisor checks (must pass)
npm run dev | lint | typecheck | test | build           # app (Next 16: read node_modules/next/dist/docs, see AGENTS.md)
npm run gen:types                                       # after any migration change (CI checks freshness)
npx supabase start ... && npx playwright test           # e2e on a local stack (e2e/README.md)
npx supabase db advisors --level info                   # Security + Performance Advisors (local)
```

## Conventions
- Schema `ops` only (query with `supabase.schema('ops')`). Types: `supabase gen types typescript --schema ops`.
- Server Components read; Server Actions / RPC mutate. No service key in the browser.
- UI: shadcn/ui (new-york style, Tailwind v4) in `components/ui`. Forms: React Hook Form + Zod.
- Money is INR `numeric(12,2)`. Timestamps are `timestamptz`; display in Asia/Kolkata.
- Access in the UI: `lib/permissions.ts#canAccess` (mirrors RLS); pages `requireArea()`, actions `actionCaller()`.
- New RLS policies: one per table+action, wrap `auth.uid()`/helpers in `(select ...)`, index every FK,
  end migrations with `revoke execute on all functions in schema ops from public;` (tests enforce all four).
- Commit style: imperative subject, body explains why. Small PRs per workspace.
