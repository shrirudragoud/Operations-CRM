-- Schedules for the hosted project (pg_cron). Not a migration: the test database has no pg_cron, and this is applied on
-- purpose after the migration that defines the jobs (0024). Safe to run again: cron.schedule replaces a job of the same name.
--
--   npx supabase db query --remote --yes -f supabase/schedules.sql
--
-- Times are UTC. Every job writes a row to ops.job_run; the founder sees overdue ones through ops.job_health().

create extension if not exists pg_cron with schema pg_catalog;

-- Fixed tasks, reminders, stopping forgotten timers, repeating meetings, missing check-outs.
select cron.schedule('ops-task-automation', '*/15 * * * *', $$select ops.run_job('task_automation')$$);

-- Nightly KPI snapshot at 00:05 India time.
select cron.schedule('ops-kpi-snapshot', '35 18 * * *', $$select ops.run_job('kpi_snapshot')$$);

-- Reorder tasks for low stock at 09:00 India time.
select cron.schedule('ops-low-stock', '30 3 * * *', $$select ops.run_job('low_stock')$$);

-- Attendance older than two years is removed at 02:00 India time.
select cron.schedule('ops-attendance-retention', '30 20 * * *', $$select ops.run_job('attendance_retention')$$);

-- pg_cron keeps its own run history; keep two weeks of it.
select cron.schedule('ops-cron-history-cleanup', '0 21 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '14 days'$$);
