# Architecture

```
Staff browser --(Google / magic link)--> Next.js app (App Router)
                                              | supabase-js + @supabase/ssr (publishable key, user JWT)
                                              v
                              Supabase project (ops): Auth . Postgres `ops` schema (RLS, triggers, RPC)
                                              . Storage (private buckets) . Edge Functions + pg_cron
                                              ^                         ^
                         PostHog (events, replays)        IDE product DB (Idea_labs_DB, read-only)
```
The browser never talks to PostHog or the product DB. Scheduled Edge Functions (service role) are the only
path by which external data enters `ops`.

## Stack
| Layer | Choice |
| --- | --- |
| Web | Next.js (App Router), TypeScript strict, Tailwind v4 |
| UI | shadcn/ui (new-york), Radix, lucide-react, sonner toasts |
| Forms / validation | React Hook Form + Zod (schemas shared by actions) |
| Tables | TanStack Table; calendar: FullCalendar; kanban: dnd-kit; charts: shadcn `chart` (Recharts) |
| Data | Supabase Postgres 17, schema `ops` |
| Auth | Supabase Auth: Google OAuth + email magic link, invite-only (`ACCESS_MODEL.md`) |
| Jobs | Edge Functions (Deno) on `pg_cron` schedules |
| Hosting | Vercel (app) + Supabase (data), region close to ap-south-1 |
| Types | `supabase gen types typescript --project-id <ref> --schema ops > lib/db.types.ts` |

## Repo layout (target)
```
app/
  (auth)/login, auth/callback/route.ts, no-access
  (app)/layout.tsx            # sidebar + header, calls ops.me()
  (app)/page.tsx              # My work
  (app)/institutions/[id]/    # 360 page
  (app)/{outreach,sales,workshop,inventory,training,product,community}/
  (app)/{tasks,feedback,cockpit,team}/
components/ui/                # shadcn
components/{app-sidebar,data-table,...}
lib/{db.types.ts,permissions.ts,actions/,schemas/,format.ts}
utils/supabase/{server,client,middleware}.ts
middleware.ts
supabase/{migrations,functions,seed_founder.sql,config.toml}
tools/test-migrations.mjs
docs/
```

## Supabase client helpers (corrected from the Supabase quickstart)
Use the `@supabase/ssr` helpers from the Supabase docs, with these fixes:
1. **Refresh the session in middleware.** After building the server client call
   `const { data: { user } } = await supabase.auth.getUser()`; if no user and path is not public,
   redirect to `/login`. Return the response that carries refreshed cookies. (The quickstart snippet
   never calls `getUser()`, so sessions would not refresh.)
2. Root `middleware.ts` calls the helper; matcher skips static assets:
   `'/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'`.
3. Always `supabase.schema('ops')`; add `ops` to **Exposed schemas** in Data API settings.
4. Use `getUser()` (validates the JWT) for authorization decisions on the server, not `getSession()`.
5. Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` reach the browser.

## Data access rules
- **Reads:** Server Components with the user's client (RLS applies). Use `select` with explicit columns and
  embedded relations; paginate lists server-side (keyset or `range`); never `select *` on big tables.
- **Writes:** Server Actions (validate with Zod, call the client with the user's JWT). Multi-row business
  operations go through RPCs. Return `{ok, error}`; surface Postgres `message` for known rule errors
  (`BUSINESS_RULES.md`) and a generic message otherwise (log the detail).
- **Never** use the service-role key in `app/`. If a feature seems to need it, it belongs in an Edge Function.
- **Realtime:** not needed in v1. Use `revalidatePath` after mutations; consider Realtime for the event
  calendar and kanban later.

## Environments and migrations
| Env | Supabase | Purpose |
| --- | --- | --- |
| local | `supabase start` (optional) or PGlite tests | dev + `tools/test-migrations.mjs` |
| staging | Supabase **branch** or second project | apply every migration here first |
| prod | main ops project | after staging + Security Advisor clean |
Migrations are forward-only files; apply with `supabase db push` or the SQL editor in order. Never edit an
applied file.

## Jobs (Edge Functions + pg_cron), all service-role
Specs in `INTEGRATIONS.md`: `posthog-sync` (nightly), `ide-sync` (nightly), `build-review-queue` (nightly,
then `ops.assign_review_queue`), `kpi-snapshot` (nightly), `low-stock` (daily,
`ops.raise_low_stock_tasks`), `notify` (on task/event triggers, later). Each: idempotent, logs to a
`job_run` table (add one), alerts on failure.

## Observability
Supabase logs + Advisors; app errors to Sentry (or equivalent); structured server logs for Server Actions;
`audit_log` for business changes. Define alerts: failed job, RLS/permission-denied spike, 5xx rate.

## Performance budget
LCP < 2.5 s on 4G for list pages, server pagination (page size 25-50), no N+1 queries (embed relations),
`next/dynamic` for calendar/kanban/charts, indexes verified by `EXPLAIN` on tables > 10k rows.
