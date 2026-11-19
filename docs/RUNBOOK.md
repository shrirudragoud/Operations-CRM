# Runbook

Short procedures for when something goes wrong. The hosted project is `qngzrzymakuqfljdotwi`; the app is the
Docker container `hardcode-ops-app` behind the Cloudflare tunnel. Never touch `rjxchzcmxsjxhdfaasxx` (the IDE product DB).

## Is it up?
- `GET https://ops.hard-code.in/api/health`: 200 `{"status":"ok","db":true}` is healthy; 503 means the app is up but cannot reach the database (it asks Postgres for an ops table as anon and expects the 42501 refusal).
- Point an uptime monitor at it (the founder picks the tool; any 1-minute HTTP check that alerts on non-200 works).
- App errors: `docker logs hardcode-ops-app` shows one JSON line per unhandled server error (`level":"error"`, with `path` and `digest`).

## Backups and restore drill
Backups are Supabase's. Free plan: daily backups are not downloadable and there is no point-in-time restore, so
**before real data matters, upgrade to a plan with PITR** (Dashboard, Database, Backups).

Until then, take your own copy weekly from a machine that can reach Postgres:

    pg_dump "$HOSTED_DB_URL" --schema=ops --format=custom --file=ops-$(date +%F).dump

Keep the last four copies somewhere other than the server. The connection string comes from the Dashboard; do not commit it.

Restore drill (do it once now, then every quarter), always on a **local** database, never on hosted:

1. `npx supabase start` (local stack).
2. `pg_restore --clean --if-exists --no-owner -d "postgresql://postgres:postgres@127.0.0.1:54322/postgres" ops-YYYY-MM-DD.dump`
3. Check: `select count(*) from ops.institution;` matches what the app shows, and `select max(started_at) from ops.job_run;` is recent.
4. Write the date and result at the bottom of this file.

To restore into hosted after a real loss: use the Dashboard (PITR, or the latest backup) rather than `pg_restore`; then run the migration check below.

## A job is overdue or failing
1. As the founder: `select * from ops.job_health();` (SQL editor or the app once the Cockpit shows it).
2. `select job, status, started_at, error from ops.job_run order by started_at desc limit 20;` shows the error.
3. Run it by hand with the service role: `select ops.run_job('kpi_snapshot');`. A `skipped` result means it is already running.
4. If every job is overdue, pg_cron is not running or the schedules are missing: `select jobname, schedule, active from cron.job;`
   and `select * from cron.job_run_details order by start_time desc limit 10;`. Re-apply `supabase/schedules.sql` if empty.

## A migration failed or went wrong
- Never edit an applied migration. Fix forward with a new `00NN_name.sql`.
- Apply: `npx supabase db query --remote --yes -f supabase/migrations/00NN_name.sql`. Each file is one transaction-sized unit; if it
  stopped half way, inspect what exists before re-running (most files use `create or replace` / `if not exists`).
- After applying: `npx supabase db advisors --level info --linked` and compare with the accepted warnings in `docs/HANDOFF.md`.

## A bad deploy
- Roll back by rebuilding the previous commit: `git checkout <good-sha> && docker compose --env-file .env.local up -d --build app`.
- The database is not rolled back by a deploy; a schema change that the old code cannot read needs a forward-fix migration.

## Nobody can sign in as founder
In the SQL editor (service role): `update ops.staff set role = 'founder', is_active = true where email = '<email>';`
The person must already have signed in once so a staff row exists.

## Stock does not match the shelf
Stock is a ledger. Never edit counts. Count the shelf, then record the difference as an `adjustment` movement
with a note (Inventory, the item, Adjust). `ops.v_stock` is then correct again.

## Incident template
When: / Who noticed: / What people saw: / Cause: / Fix: / What stops it happening again:
(Use the `ops.incident` fields in the app for anything that touched a customer.)

## Restore drill log
(none yet)
