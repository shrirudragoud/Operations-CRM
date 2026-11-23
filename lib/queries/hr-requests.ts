import "server-only";
import { createClient } from "@/utils/supabase/server";

// Reads for HR requests and onboarding (0034). RLS decides: a person sees their own requests and the open messages,
// HR sees everything including internal notes.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const REQUEST_COLUMNS = "id, staff_id, kind, subject, details, state, resolution, created_at, updated_at, closed_at, owner:staff!hr_request_staff_id_fkey(full_name)";
const MESSAGE_COLUMNS = "id, request_id, body, internal, created_at, author:staff!hr_request_message_author_id_fkey(full_name)";

export async function listMyRequests(supabase: Supabase, meId: string) {
  return supabase.from("hr_request").select(REQUEST_COLUMNS).eq("staff_id", meId).order("created_at", { ascending: false }).limit(100);
}

/** HR's inbox: open and in-progress first, then the most recent closed ones. */
export async function listAllRequests(supabase: Supabase) {
  return supabase.from("hr_request").select(REQUEST_COLUMNS).order("created_at", { ascending: false }).limit(300);
}

export async function listMessages(supabase: Supabase, requestIds: string[]) {
  if (requestIds.length === 0) return { data: [], error: null };
  return supabase.from("hr_request_message").select(MESSAGE_COLUMNS).in("request_id", requestIds).order("created_at").limit(2000);
}

/** Files on the given requests. RLS: the person sees their own, HR sees all. */
export async function listRequestFiles(supabase: Supabase, requestIds: string[]) {
  if (requestIds.length === 0) return { data: [], error: null };
  return supabase
    .from("hr_request_file")
    .select("id, request_id, message_id, name, size_bytes")
    .in("request_id", requestIds)
    .order("created_at")
    .limit(2000);
}

export async function listMyChecklist(supabase: Supabase, meId: string) {
  return supabase
    .from("onboarding_task")
    .select("id, staff_id, kind, title, detail, owner, assignee_id, due_on, position, done_at")
    .eq("staff_id", meId)
    .order("kind")
    .order("position")
    .limit(100);
}

/** Items someone else's checklist has given to me (a lead's items), not yet done. */
export async function listAssignedToMe(supabase: Supabase, meId: string) {
  return supabase
    .from("onboarding_task")
    .select("id, staff_id, kind, title, detail, owner, due_on, done_at, person:staff!onboarding_task_staff_id_fkey(full_name)")
    .eq("assignee_id", meId)
    .neq("staff_id", meId)
    .is("done_at", null)
    .order("due_on")
    .limit(100);
}

export async function listProgress(supabase: Supabase) {
  return supabase.rpc("onboarding_progress");
}

export async function listTasksFor(supabase: Supabase, staffId: string) {
  return supabase
    .from("onboarding_task")
    .select("id, kind, title, detail, owner, due_on, position, done_at, assignee:staff!onboarding_task_assignee_id_fkey(full_name)")
    .eq("staff_id", staffId)
    .order("kind")
    .order("position")
    .limit(100);
}

export async function listTemplates(supabase: Supabase) {
  return supabase
    .from("onboarding_template")
    .select("id, kind, title, detail, owner, due_offset, position, is_active")
    .order("kind")
    .order("position")
    .limit(200);
}
