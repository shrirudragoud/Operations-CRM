import "server-only";
import { num, type AwayRow, type LeaveBalance, type LeaveRequest, type LeaveType } from "@/lib/leave";
import { createClient } from "@/utils/supabase/server";

// Read queries for leave (0032). RLS decides who sees what: a person reads their own requests, a lead their team's, HR and
// the founder everyone's. The policy (leave types) is readable by every internal person.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const TYPE_COLUMNS =
  "id, code, name, paid, has_balance, annual_quota, carry_forward, carry_cap, count_weekends, count_holidays, half_day_allowed, needs_document, is_active, sort_order";

type RawType = Omit<LeaveType, "annual_quota" | "carry_cap"> & { annual_quota: string | number; carry_cap: string | number | null };

export async function listLeaveTypes(supabase: Supabase, includeInactive = false) {
  let q = supabase.from("leave_type").select(TYPE_COLUMNS).order("sort_order").order("name").limit(100);
  if (!includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  const rows = ((data ?? []) as unknown as RawType[]).map((t) => ({ ...t, annual_quota: num(t.annual_quota), carry_cap: t.carry_cap === null ? null : num(t.carry_cap) }));
  return { data: rows as LeaveType[], error };
}

type RawBalance = Omit<LeaveBalance, "annual_quota" | "balance" | "pending" | "used" | "available"> & {
  annual_quota: string | number; balance: string | number; pending: string | number; used: string | number; available: string | number | null;
};

/** One person's balances for a year. Also makes sure the yearly quota has been credited (once). */
export async function getBalances(supabase: Supabase, staffId: string, year?: number) {
  const { data, error } = await supabase.rpc("leave_balances", { p_staff: staffId, ...(year ? { p_year: year } : {}) });
  const rows = ((data ?? []) as unknown as RawBalance[]).map((b) => ({
    ...b, annual_quota: num(b.annual_quota), balance: num(b.balance), pending: num(b.pending), used: num(b.used), available: b.available === null ? null : num(b.available),
  }));
  return { data: rows as LeaveBalance[], error };
}

type RawRequest = Omit<LeaveRequest, "days"> & { days: string | number };
export type RequestWithType = LeaveRequest & { type_name: string };
export type RequestWithPerson = RequestWithType & { staff_name: string; staff_departments: string[] };

const REQUEST_COLUMNS =
  "id, staff_id, leave_type_id, from_date, to_date, day_part, days, reason, state, decided_at, decision_note, created_at, type:leave_type!leave_request_leave_type_id_fkey(name)";

type WithType<T> = T & { type: { name: string } | null };
const withType = (r: WithType<RawRequest>): RequestWithType => ({ ...r, days: num(r.days), type_name: r.type?.name ?? "Leave" });

/** My own requests, newest leave first. */
export async function listMyRequests(supabase: Supabase, meId: string, limit = 60) {
  const { data, error } = await supabase
    .from("leave_request").select(REQUEST_COLUMNS).eq("staff_id", meId).order("from_date", { ascending: false }).limit(limit);
  return { data: ((data ?? []) as unknown as WithType<RawRequest>[]).map(withType), error };
}

type PersonJoin = { staff: { full_name: string; departments: string[] } | null };

/** Requests waiting for a decision that the caller may decide (RLS limits a lead to their own team; never their own). */
export async function listPendingRequests(supabase: Supabase, meId: string) {
  const { data, error } = await supabase
    .from("leave_request")
    .select(`${REQUEST_COLUMNS}, staff:staff!leave_request_staff_id_fkey(full_name, departments)`)
    .eq("state", "pending").neq("staff_id", meId).order("created_at").limit(200);
  const rows = ((data ?? []) as unknown as (WithType<RawRequest> & PersonJoin)[]).map((r): RequestWithPerson => ({
    ...withType(r), staff_name: r.staff?.full_name ?? "Unknown", staff_departments: r.staff?.departments ?? [],
  }));
  return { data: rows, error };
}

/** Recent decisions, so a lead or HR sees what has just been agreed. */
export async function listRecentDecisions(supabase: Supabase, meId: string, limit = 30) {
  const { data, error } = await supabase
    .from("leave_request")
    .select(`${REQUEST_COLUMNS}, staff:staff!leave_request_staff_id_fkey(full_name, departments)`)
    .in("state", ["approved", "rejected"]).neq("staff_id", meId).order("decided_at", { ascending: false }).limit(limit);
  const rows = ((data ?? []) as unknown as (WithType<RawRequest> & PersonJoin)[]).map((r): RequestWithPerson => ({
    ...withType(r), staff_name: r.staff?.full_name ?? "Unknown", staff_departments: r.staff?.departments ?? [],
  }));
  return { data: rows, error };
}

/** Who is away between two dates (the database decides the names and whether the type is shown). */
export async function getAway(supabase: Supabase, from: string, to: string) {
  const { data, error } = await supabase.rpc("team_away", { p_from: from, p_to: to });
  return { data: (data ?? []) as unknown as AwayRow[], error };
}

export async function listLeaveHolidays(supabase: Supabase, fromDate: string) {
  return supabase.from("office_holiday").select("id, holiday_date, name").gte("holiday_date", fromDate).order("holiday_date").limit(100);
}

/** The ledger for one year added up per person and type (HR and the founder read all of it; a lead only their team's). */
export async function listYearBalances(supabase: Supabase, year: number) {
  const { data, error } = await supabase.from("leave_ledger").select("staff_id, leave_type_id, days").eq("year", year).limit(20000);
  const totals = new Map<string, number>();
  for (const r of (data ?? []) as unknown as { staff_id: string; leave_type_id: string; days: string | number }[]) {
    const k = `${r.staff_id}|${r.leave_type_id}`;
    totals.set(k, Math.round((((totals.get(k) ?? 0) + num(r.days)) * 10)) / 10);
  }
  return { data: totals, error };
}

/** Everyone who can take leave, for HR's adjust form and the balances table. */
export async function listLeavePeople(supabase: Supabase) {
  return supabase.from("staff").select("id, full_name, role, departments").eq("is_active", true).not("role", "in", "(viewer,partner)").order("full_name").limit(500);
}
