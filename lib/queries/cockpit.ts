import "server-only";
import { createClient } from "@/utils/supabase/server";

// Read queries for the Cockpit (founder only). Bounded result sets; the heavy counting is in views and nightly snapshots.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const TREND_METRICS = ["pipeline_value_inr", "pipeline_weighted_inr", "won_value_inr", "deals_won", "institutions", "tasks_overdue", "kit_loss_inr"];

export const getFunnelSteps = (s: Supabase) => s.from("v_funnel_steps").select("segment, ord, step, label, institutions");

export async function getIdeFunnel(s: Supabase) {
  const { data, error } = await s.rpc("ide_funnel");
  return { data: data?.[0] ?? null, error };
}

export const getPipelineRows = (s: Supabase) => s.from("v_pipeline").select("kind, segment, stage, deals, value_inr, weighted_inr");

/** Nightly snapshot rows for the headline numbers, about five weeks back. */
export function getSnapshotRows(s: Supabase, since: string) {
  return s
    .from("kpi_snapshot")
    .select("snapshot_date, metric, dimension, value")
    .in("metric", TREND_METRICS)
    .eq("dimension", "all")
    .gte("snapshot_date", since)
    .order("snapshot_date", { ascending: true })
    .limit(500);
}

export const getKitMovements = (s: Supabase) =>
  s
    .from("stock_movement")
    .select("kind, qty, item:item!inner(id, name, sku, unit_cost_inr)")
    .in("kind", ["damaged", "lost"])
    .limit(1000);

/** Every open task with who it is for, for the Operations view. */
export const getOpenTasks = (s: Supabase) =>
  s
    .from("task")
    .select("id, title, status, department, start_date, due_date, due_time, estimate_minutes, assignee_id, accepted_at, updated_at, assignee:staff!task_assignee_id_fkey(full_name)")
    .in("status", ["todo", "doing", "blocked"])
    .limit(2000);

export const getLowStock = (s: Supabase) =>
  s.from("v_low_stock").select("item_id, sku, name, reorder_level, available").order("available", { ascending: true }).limit(20);

export async function getJobHealth(s: Supabase) {
  const { data, error } = await s.rpc("job_health");
  return { data: data ?? [], error };
}

export const TIMELINESS_LIMIT = 5000;

/**
 * Tasks the Operations view counts: finished or created since `since`, and everything still open (what is overdue
 * now). RLS limits the rows to what the caller may see: all for the founder, their departments and people for a lead.
 */
export function getTimelinessRows(s: Supabase, since: string) {
  return s
    .from("v_task_timeliness")
    .select(
      "task_id, title, department, priority, status, assignee_id, created_day, done_day, due_date, original_due_date, bucket, days_late, estimate_minutes, logged_minutes, blocked_minutes, reschedules, reassigns",
    )
    .or(`done_day.gte.${since},created_day.gte.${since},status.in.(todo,doing,blocked)`)
    .limit(TIMELINESS_LIMIT);
}

export const getBacklogRows = (s: Supabase, since: string) =>
  s
    .from("backlog_snapshot")
    .select("snapshot_date, department, assignee_id, open_count, overdue_count, blocked_count, no_deadline_count")
    .gte("snapshot_date", since)
    .order("snapshot_date", { ascending: true })
    .limit(5000);

export const getPeople = (s: Supabase) =>
  s.from("staff").select("id, full_name, role, departments").eq("is_active", true).order("full_name").limit(500);
