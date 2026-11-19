import "server-only";
import { createClient } from "@/utils/supabase/server";

// Read queries for the profile, the HR people list and the directory (0031, 0035). RLS decides who reads what:
// a person reads only their own profile row, HR reads every row, and the directory function returns work-contact fields only.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const PROFILE_COLUMNS =
  "staff_id, legal_name, birth_date, personal_email, personal_phone, address, emergency_name, emergency_phone, emergency_relation, blood_group, birthday_visible, employee_code, designation, joined_on, employment_type, probation_end, manager_id, updated_at";

export async function getMyProfile(supabase: Supabase, meId: string) {
  return supabase.from("staff_profile").select(PROFILE_COLUMNS).eq("staff_id", meId).maybeSingle();
}

/** HR's people list: every active person with the HR-owned fields. */
export async function listPeople(supabase: Supabase) {
  return supabase
    .from("staff")
    .select("id, full_name, email, role, departments, is_active, profile:staff_profile!staff_id(employee_code, designation, joined_on, employment_type, manager_id)")
    .eq("is_active", true)
    .order("full_name")
    .limit(500);
}

/** Opens one person's full record and writes a row to the HR access log (ops.hr_profile). */
export async function openHrProfile(supabase: Supabase, staffId: string) {
  const { data, error } = await supabase.rpc("hr_profile", { p_staff: staffId });
  const row = Array.isArray(data) ? data[0] : data;
  return { data: row ?? null, error };
}

/** People who could manage someone: active members of the team (not viewers or partners). */
export async function listManagers(supabase: Supabase) {
  return supabase
    .from("staff")
    .select("id, full_name, role")
    .eq("is_active", true)
    .not("role", "in", "(viewer,partner)")
    .order("full_name")
    .limit(500);
}

export async function getDirectory(supabase: Supabase) {
  return supabase.rpc("directory");
}

export async function getDirectoryEvents(supabase: Supabase, month: number) {
  return supabase.rpc("directory_events", { p_month: month });
}
