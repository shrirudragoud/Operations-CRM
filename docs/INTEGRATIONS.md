# Integrations and scheduled jobs

All jobs are Supabase Edge Functions (Deno, service-role key as a function secret), scheduled by `pg_cron`
(`select cron.schedule(...)` calling the function via `net.http_post`, or Supabase Cron UI). All must be
**idempotent**, log start/end/rows/error to a `ops.job_run` table (create in a migration), and be safe to
re-run. Times in UTC; nightly window 20:30 UTC = 02:00 IST.

## 1. PostHog sync (`posthog-sync`)
Env: `POSTHOG_HOST`, `POSTHOG_PROJECT_ID`, `POSTHOG_PERSONAL_API_KEY` (read-only scope).
- **Daily aggregates -> `ops.ph_user_daily`:** HogQL via `POST /api/projects/:id/query` for the previous day:
  events, compiles, flashes, errors per `distinct_id`. Upsert on `(day, distinct_id)`.
- **Sessions -> `ops.ph_session`:** `GET /api/projects/:id/session_recordings` (last 48h): recording id,
  distinct id, start, duration, console error count, rage-click count, start URL, `replay_url`
  (`{host}/project/:id/replay/{recording_id}`). Upsert on `recording_id`. Store links and counts only,
  never recordings.
- Paginate, respect rate limits (back off on 429), and no PII beyond distinct id.

## 2. Review queue builder (`build-review-queue`)
After `posthog-sync`: insert `ops.review_item` for new sessions that match a reason, skipping those already
queued (`recording_id` unique):
`rage_click` (>=3), `console_error` (>=1), `flash_failed`/`compile_failed`/`agent_error` (from events),
`new_cohort_user` (first session of a user whose `cohort_code` is set), `first_session`. Then
`select ops.assign_review_queue(current_date, 15)`. Reviewers = active Product staff.

## 3. IDE sync (`ide-sync`)
Source: IDE product DB (`Idea_labs_DB`, ap-south-1). Use a **read-only Postgres role** limited to the needed
views (create views in the product DB: `ops_export_users`, `ops_export_projects`). Fields -> 
`ops.ide_user_snapshot`: `ide_user_id`, `email`, `cohort_code`, `signed_up_at`, `first_compile_at`,
`first_flash_at`, `first_publish_at`. Community growth counters (projects, forks, creators) -> 
`ops.kpi_snapshot`. Upsert on `ide_user_id`. Minors: no names/phones; follow the IDE's DPDP consent rules.
Alternative if both live in one project: read-only views instead of a copy.

## 4. Cohort code in the IDE (required change in the IDE repo)
The IDE sign-up accepts `?cohort=HC-XXXX` (also a manual field), stores `cohort_code` on the IDE user, and
validates the format `^HC-[A-HJ-NP-Z2-9]{4}$`. Without this, `v_cohort_activation` is empty and the
fundraising metric (workshop students who flashed hardware within 7 days) cannot be produced. Workshop run
sheet already includes "students signed up with the cohort code".

## 5. Catalog requests (`request_part`)
When the IDE agent fails with "part not found", call `ops.request_part(query, 'agent_error')` (service
role, via a small authenticated endpoint or the IDE backend). Dedupes by lowercased query and increments
`request_count`.

## 6. KPI snapshot (`kpi-snapshot`)
Write `ops.kpi_snapshot(snapshot_date, metric, dimension, value)` nightly. Metrics and dimensions to define
in a migration + test (suggested): `institutions_by_stage`, `qualified_leads`, `deals_won`, `won_value_inr`,
`pipeline_value_inr`, `events_completed`, `students_trained`, `kit_loss_units`, `cohort_signed_up/
compiled_7d/flashed_7d/published` (dimension `cohort:<code>`), `reviews_done`, `projects_published`,
`remixes`, `active_creators_7d/30d`, `content_published`. Partner scorecards read from here + live tables.

## 7. Low stock (`low-stock`)
Daily: `select ops.raise_low_stock_tasks()`.

## 8. Buy store orders (later)
Fulfilled order lines -> `stock_movement(kind='sold', qty<0, order_ref)` from the fulfilment location.
Decide with the founder whether workshop kits and Buy stock are the same physical inventory (see
`DECISIONS.md`).

## 9. Notifications (later)
In-app first (tasks). Then email/WhatsApp via an Edge Function on events: task assigned, event scheduled
(trainer), low stock, kit loss, returns overdue. Provider TBD (open question).

## Secrets
Function secrets only: `SUPABASE_SECRET_KEY` (service role), `POSTHOG_PERSONAL_API_KEY`, IDE read-only DB
URL. Rotate on staff changes. Never commit, never paste in chats or tickets.
