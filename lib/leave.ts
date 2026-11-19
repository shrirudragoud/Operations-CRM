import type { Me } from "@/lib/permissions";
import { isHr } from "@/lib/permissions";
import type { Tone } from "@/lib/tone";

// Leave display rules (0032). The database counts the days and keeps the balances; this words them and previews the count.

export type LeaveType = {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  has_balance: boolean;
  annual_quota: number;
  carry_forward: boolean;
  carry_cap: number | null;
  count_weekends: boolean;
  count_holidays: boolean;
  half_day_allowed: boolean;
  needs_document: boolean;
  is_active: boolean;
  sort_order: number;
};

export type LeaveBalance = {
  leave_type_id: string;
  code: string;
  name: string;
  paid: boolean;
  has_balance: boolean;
  annual_quota: number;
  balance: number;
  pending: number;
  used: number;
  available: number | null;
};

export type LeaveState = "pending" | "approved" | "rejected" | "cancelled";
export type DayPart = "full" | "first_half" | "second_half";

export type LeaveRequest = {
  id: string;
  staff_id: string;
  leave_type_id: string;
  from_date: string;
  to_date: string;
  day_part: DayPart;
  days: number;
  reason: string;
  state: LeaveState;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
};

export type AwayRow = {
  request_id: string;
  staff_id: string;
  full_name: string;
  leave_type: string | null;
  from_date: string;
  to_date: string;
  day_part: DayPart;
};

/** Anyone on the team can apply: not viewers or partners (ops.can_take_leave). */
export function canTakeLeave(me: Me | null): boolean {
  return !!me && me.role !== "viewer" && me.role !== "partner";
}

/** Who may decide a request: HR, the founder, or a department lead for their own team (ops.decide_leave). Not their own. */
export function canDecideLeave(me: Me | null): boolean {
  return !!me && (isHr(me) || me.role === "dept_lead");
}

/** Numbers from the database arrive as strings (numeric) or numbers; a missing value is zero. */
export function num(v: string | number | null | undefined): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** "1 day", "2.5 days", "Half a day". */
export function daysText(n: number): string {
  if (n === 0.5) return "Half a day";
  const t = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${t} ${n === 1 ? "day" : "days"}`;
}

const DAY_PART_TEXT: Record<DayPart, string> = { full: "", first_half: "first half", second_half: "second half" };

const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" });
const dayYearFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const asDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

/** "12 Mar", "12 to 14 Mar", "30 Mar to 2 Apr", "12 Mar (first half)". Years are added when the dates are not this year. */
export function rangeText(from: string, to: string, part: DayPart = "full", thisYear?: string): string {
  const showYear = thisYear !== undefined && from.slice(0, 4) !== thisYear;
  const fmt = showYear ? dayYearFmt : dayFmt;
  const suffix = part === "full" ? "" : ` (${DAY_PART_TEXT[part]})`;
  if (from === to) return `${fmt.format(asDate(from))}${suffix}`;
  const f = asDate(from);
  const t = asDate(to);
  if (!showYear && f.getUTCMonth() === t.getUTCMonth()) return `${f.getUTCDate()} to ${fmt.format(t)}${suffix}`;
  return `${fmt.format(f)} to ${fmt.format(t)}${suffix}`;
}

export const STATE_LABELS: Record<LeaveState, string> = {
  pending: "Waiting for a decision", approved: "Approved", rejected: "Turned down", cancelled: "Cancelled",
};
export const STATE_TONE: Record<LeaveState, Tone> = { pending: "amber", approved: "green", rejected: "red", cancelled: "slate" };

/** The shape of a leave type as a sentence HR can check at a glance. */
export function policySummary(t: Pick<LeaveType, "has_balance" | "annual_quota" | "carry_forward" | "carry_cap" | "count_weekends" | "count_holidays" | "paid">): string {
  const parts: string[] = [];
  const plain = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? "day" : "days"}`;
  parts.push(t.has_balance ? `${plain(t.annual_quota)} a year` : "No balance kept");
  if (t.has_balance) parts.push(t.carry_forward ? (t.carry_cap === null ? "carries over" : `carries over up to ${plain(t.carry_cap)}`) : "does not carry over");
  parts.push(t.count_weekends ? "weekends count" : "weekends skipped");
  parts.push(t.count_holidays ? "holidays count" : "holidays skipped");
  parts.push(t.paid ? "paid" : "unpaid");
  return parts.join(", ");
}

/** The share of a year's quota that is still free, 0 to 100, for a meter. Types with no quota show a full bar only if anything is left. */
export function availableShare(b: Pick<LeaveBalance, "annual_quota" | "balance" | "available">): number {
  const free = Math.max(0, b.available ?? b.balance);
  const base = Math.max(b.annual_quota, b.balance, 0);
  if (base <= 0) return 0;
  return Math.min(100, Math.round((free / base) * 100));
}

export type CountRules = Pick<LeaveType, "count_weekends" | "count_holidays">;

/**
 * A preview of how many days the database will count for a request. The database does the same sum when it saves it;
 * this only lets the form say "3 days" before the person presses the button.
 * `workDays` are ISO weekdays (Monday = 1), `holidays` are yyyy-mm-dd.
 */
export function previewDays(rules: CountRules, from: string, to: string, part: DayPart, workDays: readonly number[], holidays: ReadonlySet<string>): number {
  if (!from || !to || to < from) return 0;
  const start = asDate(from).getTime();
  const end = asDate(to).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end - start > 400 * 86_400_000) return 0;
  let n = 0;
  for (let t = start; t <= end; t += 86_400_000) {
    const d = new Date(t);
    const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (!rules.count_weekends && !workDays.includes(iso)) continue;
    if (!rules.count_holidays && holidays.has(d.toISOString().slice(0, 10))) continue;
    n += 1;
  }
  return part === "full" ? n : n * 0.5;
}

/** Can the person withdraw it themselves? Pending any time; approved only before it starts. HR can always (the database decides). */
export function canWithdraw(r: Pick<LeaveRequest, "state" | "from_date">, today: string, hr: boolean): boolean {
  if (r.state === "pending") return true;
  if (r.state === "approved") return hr || r.from_date > today;
  return false;
}

/** A yyyy-mm-dd date moved by some days. */
export function shiftDate(ymd: string, days: number): string {
  return new Date(asDate(ymd).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Group who-is-away rows by person so a two-week leave is one line. */
export function awayByPerson(rows: AwayRow[]): { staff_id: string; full_name: string; items: AwayRow[] }[] {
  const by = new Map<string, { staff_id: string; full_name: string; items: AwayRow[] }>();
  for (const r of rows) {
    const g = by.get(r.staff_id) ?? { staff_id: r.staff_id, full_name: r.full_name, items: [] };
    g.items.push(r);
    by.set(r.staff_id, g);
  }
  return [...by.values()];
}

/** Is someone away on this day? (Approved rows only come from the database.) */
export function isAwayOn(rows: AwayRow[], staffId: string, date: string): boolean {
  return rows.some((r) => r.staff_id === staffId && r.from_date <= date && r.to_date >= date);
}
