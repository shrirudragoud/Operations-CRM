import "server-only";
import { createClient } from "@/utils/supabase/server";

// Reads for papers and the policy library (0033). RLS decides: a person sees their own papers, HR sees everyone's,
// and the library shows each person only the entries meant for them.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const STAFF_DOC_COLUMNS = "id, staff_id, kind, title, mime, size_bytes, expires_on, created_at, verified_at, verify_note, verified_by";

export async function listMyDocuments(supabase: Supabase, meId: string) {
  return supabase
    .from("staff_document")
    .select(STAFF_DOC_COLUMNS)
    .eq("staff_id", meId)
    .order("created_at", { ascending: false })
    .limit(200);
}

/** Every active entry in the library the caller may see, with the versions they have already read. */
export async function listLibrary(supabase: Supabase) {
  return supabase
    .from("company_document")
    .select("id, title, kind, version, audience, summary, mime, size_bytes, created_at")
    .eq("is_active", true)
    .order("title")
    .limit(200);
}

export async function listMyAcknowledgements(supabase: Supabase, meId: string) {
  return supabase.from("policy_ack").select("document_id, version, at").eq("staff_id", meId).limit(500);
}

/** HR: papers waiting to be verified, newest first, with whose they are. */
export async function listPapersToVerify(supabase: Supabase) {
  return supabase
    .from("staff_document")
    .select(`${STAFF_DOC_COLUMNS}, owner:staff!staff_document_staff_id_fkey(full_name)`)
    .is("verified_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
}

export async function listRecentlyVerified(supabase: Supabase) {
  return supabase
    .from("staff_document")
    .select(`${STAFF_DOC_COLUMNS}, owner:staff!staff_document_staff_id_fkey(full_name)`)
    .not("verified_at", "is", null)
    .order("verified_at", { ascending: false })
    .limit(30);
}

export async function listExpiring(supabase: Supabase, days = 60) {
  return supabase.rpc("expiring_documents", { p_days: days });
}

export async function getAckSummary(supabase: Supabase) {
  return supabase.rpc("policy_ack_summary");
}

export async function listAllLibrary(supabase: Supabase) {
  return supabase
    .from("company_document")
    .select("id, title, kind, version, audience, summary, is_active, created_at")
    .order("title")
    .order("version", { ascending: false })
    .limit(300);
}

export async function listStaffChoices(supabase: Supabase) {
  return supabase
    .from("staff")
    .select("id, full_name")
    .eq("is_active", true)
    .in("role", ["founder", "dept_lead", "member"])
    .order("full_name")
    .limit(500);
}
