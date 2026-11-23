import "server-only";
import { createClient } from "@/utils/supabase/server";

// Reads for the People & HR home (0037). Every function is HR-only in the database.

type Supabase = Awaited<ReturnType<typeof createClient>>;

export function listHrActions(supabase: Supabase) {
  return supabase.rpc("hr_actions");
}

export function getHrCounts(supabase: Supabase) {
  return supabase.rpc("hr_counts");
}

export function listHrOverview(supabase: Supabase) {
  return supabase.rpc("hr_overview");
}

export function listRecentAccess(supabase: Supabase) {
  return supabase
    .from("hr_access_log")
    .select("id, what, at, actor:staff!hr_access_log_actor_id_fkey(full_name), target:staff!hr_access_log_target_id_fkey(full_name)")
    .order("at", { ascending: false })
    .range(0, 49);
}
