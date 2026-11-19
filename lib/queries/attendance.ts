import "server-only";
import type { DayRow, OfficeSettings } from "@/lib/attendance";
import { createClient } from "@/utils/supabase/server";

// Read queries for attendance (0023). RLS decides who sees what: a person sees their own records, a lead sees their
// department's, the founder everyone's; networks and refusals are the founder's alone.

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function getOfficeSettings(supabase: Supabase) {
  const { data, error } = await supabase
    .from("office_settings")
    .select("start_time, end_time, grace_minutes, work_days, flags_on, ip_header, ip_hops")
    .maybeSingle();
  return { data: data as (OfficeSettings & { ip_header: string; ip_hops: number }) | null, error };
}

/** My open stretch, if any. One flagged "no check-out" is not open: it needs a lead. */
export async function getMyOpenSession(supabase: Supabase, meId: string) {
  return supabase
    .from("attendance_session")
    .select("id, check_in_at, work_date")
    .eq("staff_id", meId)
    .is("check_out_at", null)
    .eq("missing_checkout", false)
    .maybeSingle();
}

export async function getDays(supabase: Supabase, from: string, to: string, staffId?: string) {
  const { data, error } = await supabase.rpc("attendance_days", { p_from: from, p_to: to, ...(staffId ? { p_staff: staffId } : {}) });
  return { data: (data ?? []) as unknown as DayRow[], error };
}

/** One person's calendar month, future days included (0030). RLS (sees_attendance) decides whose month you may read. */
export async function getMonth(supabase: Supabase, staffId: string, month: string) {
  const { data, error } = await supabase.rpc("attendance_month", { p_staff: staffId, p_month: `${month}-01` });
  return { data: (data ?? []) as unknown as DayRow[], error };
}

export async function listTagged(supabase: Supabase) {
  return supabase.from("staff").select("id, full_name, role, departments").eq("works_from_office", true).eq("is_active", true).order("full_name").limit(500);
}

export async function listRequests(supabase: Supabase, status: "pending" | "decided") {
  const q = supabase
    .from("attendance_request")
    .select("id, staff_id, work_date, in_time, out_time, reason, status, decided_at, decision_note, created_at, staff:staff!attendance_request_staff_id_fkey(full_name)");
  return status === "pending"
    ? q.eq("status", "pending").order("created_at").limit(200)
    : q.neq("status", "pending").order("decided_at", { ascending: false }).limit(30);
}
export type RequestRow = NonNullable<Awaited<ReturnType<typeof listRequests>>["data"]>[number];

export async function listMissing(supabase: Supabase) {
  return supabase
    .from("attendance_session")
    .select("id, staff_id, work_date, check_in_at, staff:staff!attendance_session_staff_id_fkey(full_name)")
    .eq("missing_checkout", true)
    .order("work_date", { ascending: false })
    .limit(100);
}
export type MissingRow = NonNullable<Awaited<ReturnType<typeof listMissing>>["data"]>[number];

export async function listHolidays(supabase: Supabase, fromDate: string) {
  return supabase.from("office_holiday").select("id, holiday_date, name").gte("holiday_date", fromDate).order("holiday_date").limit(100);
}

export async function listNetworks(supabase: Supabase) {
  return supabase.from("office_network").select("id, label, cidr, is_active, last_seen_at, created_at").order("created_at").limit(50);
}

/** Refused check-ins in the last day: how many people, so the founder can see when the office address has changed. */
export async function recentRefusals(supabase: Supabase) {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data, error } = await supabase.from("attendance_failure").select("staff_id").gte("attempted_at", since).limit(500);
  const byPerson = new Map<string, number>();
  for (const r of data ?? []) byPerson.set(r.staff_id, (byPerson.get(r.staff_id) ?? 0) + 1);
  return { byPerson, error };
}

export async function listMarks(supabase: Supabase, from: string, to: string) {
  return supabase
    .from("attendance_day_mark")
    .select("id, staff_id, mark_date, kind, reason, staff:staff!attendance_day_mark_staff_id_fkey(full_name)")
    .gte("mark_date", from)
    .lte("mark_date", to)
    .order("mark_date")
    .limit(200);
}
