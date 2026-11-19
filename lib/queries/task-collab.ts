import "server-only";
import { createClient } from "@/utils/supabase/server";

// Read queries for watchers, notifications, fixed tasks and saved views (0019). RLS decides who sees what.

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function listWatchers(supabase: Supabase, taskId: string) {
  return supabase
    .from("task_watcher")
    .select("staff_id, added_by, staff:staff!task_watcher_staff_id_fkey(full_name)")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true })
    .limit(100);
}

export async function unreadNotificationCount(supabase: Supabase, meId: string) {
  const { count } = await supabase
    .from("notification")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", meId)
    .is("read_at", null);
  return count ?? 0;
}

export async function listNotifications(supabase: Supabase, meId: string, limit = 30) {
  return supabase
    .from("notification")
    .select("id, kind, task_id, meeting_id, message, created_at, read_at, actor:staff!notification_actor_id_fkey(full_name)")
    .eq("recipient_id", meId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
}

export async function listRecurrences(supabase: Supabase) {
  return supabase
    .from("task_recurrence")
    .select(
      "id, title, description, department, priority, estimate_minutes, frequency, weekday, month_day, due_after_days, due_time, starts_on, ends_on, all_department, staff_ids, active, created_by, creator:staff!task_recurrence_created_by_fkey(full_name)",
    )
    .order("active", { ascending: false })
    .order("title")
    .limit(200);
}

export type RecurrenceRow = NonNullable<Awaited<ReturnType<typeof listRecurrences>>["data"]>[number];

export async function listTaskViews(supabase: Supabase) {
  return supabase.from("task_view").select("id, owner_id, name, query, shared").order("name").limit(100);
}
