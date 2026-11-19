import "server-only";
import { createClient } from "@/utils/supabase/server";

// Read queries for time tracking and the daily log (0020). RLS decides who sees what: a person sees their own
// time, a task's managers and the founder see the time on a task; a lead sees the logs of their department.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const ENTRY =
  "id, staff_id, task_id, source, work_date, started_at, ended_at, minutes, note, created_at, task:task!time_entry_task_id_fkey(id, title, status), staff:staff!time_entry_staff_id_fkey(full_name)";

export async function getRunningTimer(supabase: Supabase, meId: string) {
  return supabase
    .from("time_entry")
    .select("id, task_id, started_at, note, task:task!time_entry_task_id_fkey(id, title)")
    .eq("staff_id", meId)
    .eq("source", "timer")
    .is("ended_at", null)
    .maybeSingle();
}

export type RunningTimer = NonNullable<Awaited<ReturnType<typeof getRunningTimer>>["data"]>;

export async function listTaskTime(supabase: Supabase, taskId: string) {
  return supabase
    .from("time_entry")
    .select(ENTRY)
    .eq("task_id", taskId)
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
}

export type TimeEntryRow = NonNullable<Awaited<ReturnType<typeof listTaskTime>>["data"]>[number];

/** One person's finished entries between two days (inclusive). A running timer is read with getRunningTimer. */
export async function listEntriesBetween(supabase: Supabase, staffId: string, from: string, to: string) {
  return supabase
    .from("time_entry")
    .select(ENTRY)
    .eq("staff_id", staffId)
    .gte("work_date", from)
    .lte("work_date", to)
    .not("minutes", "is", null)
    .order("work_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1000);
}

/** Everyone's minutes between two days, for the workload page. RLS limits the rows to what the caller may see. */
export async function listMinutesBetween(supabase: Supabase, from: string, to: string) {
  return supabase
    .from("time_entry")
    .select("staff_id, work_date, minutes")
    .gte("work_date", from)
    .lte("work_date", to)
    .not("minutes", "is", null)
    .limit(5000);
}

export async function getDailyLog(supabase: Supabase, staffId: string, day: string) {
  return supabase.from("daily_log").select("id, log_date, did, next_up, blockers, updated_at").eq("staff_id", staffId).eq("log_date", day).maybeSingle();
}

export async function listDailyLogs(supabase: Supabase, from: string, to: string) {
  return supabase
    .from("daily_log")
    .select("id, staff_id, log_date, did, next_up, blockers, staff:staff!daily_log_staff_id_fkey(full_name)")
    .gte("log_date", from)
    .lte("log_date", to)
    .order("log_date", { ascending: false })
    .limit(300);
}

/** Open tasks with an owner, for the workload page. RLS limits them to the caller's departments. */
export async function listOpenAssignedTasks(supabase: Supabase) {
  return supabase
    .from("task")
    .select("id, title, status, department, start_date, due_date, due_time, estimate_minutes, assignee_id, accepted_at, updated_at")
    .in("status", ["todo", "doing", "blocked"])
    .not("assignee_id", "is", null)
    .limit(2000);
}
