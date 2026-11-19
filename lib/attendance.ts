import { formatHM } from "@/lib/schemas/time";
import type { Tone } from "@/lib/tone";

// Attendance display rules (D51 to D55). The database records and flags (0023); this decides how a day reads.

export type DayRow = {
  staff_id: string;
  work_date: string;
  expected: boolean;
  holiday: string | null;
  first_in: string | null;
  last_out: string | null;
  minutes: number;
  is_late: boolean;
  late_minutes: number;
  left_early: boolean;
  early_minutes: number;
  is_open: boolean;
  missing_checkout: boolean;
  off_network_out: boolean;
  manual: boolean;
  mark: string | null;
  mark_reason: string | null;
  /** Checked in from outside the office (0030). */
  remote?: boolean;
  /** False for days before the person started checking in (0030). Absent on rows from the week grids, which only return tracked days. */
  tracked?: boolean;
  /** The kind of approved leave on this day, set on scheduled working days only (0032). */
  leave_name?: string | null;
  /** The leave covers half of the day, so the person is still expected for the rest. */
  leave_half?: boolean;
};

export type OfficeSettings = {
  start_time: string;
  end_time: string;
  grace_minutes: number;
  work_days: number[];
  flags_on: boolean;
};

export type DayKind =
  | "in" | "present" | "late" | "early" | "late_early" | "missing" | "remote" | "excused"
  | "holiday" | "off" | "upcoming" | "not_yet" | "absent" | "not_tracked" | "leave";

export type DayStatus = { kind: DayKind; label: string; tone: Tone };

/** "11:00:00" -> 660 */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

/** "11:00:00" -> "11:00 am" */
export function formatClock(t: string): string {
  const total = timeToMinutes(t);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** Minutes past midnight in India for an instant. */
export function istMinutes(now: Date): number {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  return Number(p.find((x) => x.type === "hour")?.value) * 60 + Number(p.find((x) => x.type === "minute")?.value);
}

export function lateText(minutes: number): string {
  return minutes >= 60 ? `${formatHM(minutes)} late` : `${minutes} min late`;
}
export function earlyText(minutes: number): string {
  return minutes >= 60 ? `left ${formatHM(minutes)} early` : `left ${minutes} min early`;
}

/** "Casual leave" -> "Casual", so "On leave (Casual)" does not say leave twice. */
export function leaveShortName(name: string): string {
  const short = name.replace(/\s+leave$/i, "").trim();
  return short.length > 0 ? short : name;
}

/**
 * How one person's day reads. Lateness is shown only once the founder has turned flags on (shadow mode before that).
 * `today` is yyyy-mm-dd in India and `nowMinutes` the time of day there.
 */
export function dayStatus(row: DayRow, settings: OfficeSettings, today: string, nowMinutes: number): DayStatus {
  const flags = settings.flags_on;
  const present = row.first_in !== null;

  if (row.missing_checkout) return { kind: "missing", label: "No check-out", tone: "orange" };
  if (row.is_open) return { kind: "in", label: row.remote ? "Checked in remotely" : "In the office", tone: "blue" };
  if (present) {
    const late = flags && row.is_late;
    const early = flags && row.left_early;
    if (late && early) return { kind: "late_early", label: `${lateText(row.late_minutes)}, ${earlyText(row.early_minutes)}`, tone: "amber" };
    if (late) return { kind: "late", label: lateText(row.late_minutes), tone: "amber" };
    if (early) return { kind: "early", label: earlyText(row.early_minutes), tone: "amber" };
    return { kind: "present", label: "Present", tone: "green" };
  }
  if (row.holiday) return { kind: "holiday", label: row.holiday, tone: "slate" };
  if (row.leave_name) return { kind: "leave", label: `${row.leave_half ? "Half-day leave" : "On leave"} (${leaveShortName(row.leave_name)})`, tone: "teal" };
  if (row.mark === "excused") return { kind: "excused", label: "Excused", tone: "violet" };
  if (row.mark === "remote") return { kind: "remote", label: "Working remotely", tone: "violet" };
  if (!row.expected) return { kind: "off", label: "Day off", tone: "slate" };
  if (row.tracked === false) return { kind: "not_tracked", label: "Before check-in began", tone: "slate" };
  if (row.work_date > today) return { kind: "upcoming", label: "Upcoming", tone: "slate" };
  if (row.work_date === today && nowMinutes < timeToMinutes(settings.end_time)) {
    const late = flags && nowMinutes > timeToMinutes(settings.start_time) + settings.grace_minutes;
    return { kind: "not_yet", label: "Not in yet", tone: late ? "amber" : "slate" };
  }
  return { kind: "absent", label: flags ? "Absent" : "No record", tone: flags ? "red" : "slate" };
}

/** Counts for a person over some days: only days they were expected count, and nothing is counted before flags are on. */
export function summarise(rows: DayRow[], settings: OfficeSettings, today: string, nowMinutes: number) {
  let present = 0, late = 0, early = 0, absent = 0, missing = 0, minutes = 0;
  for (const r of rows) {
    const s = dayStatus(r, settings, today, nowMinutes);
    minutes += r.minutes;
    if (s.kind === "missing") missing += 1;
    if (r.first_in) present += 1;
    if (!settings.flags_on) continue;
    if (s.kind === "late" || s.kind === "late_early") late += 1;
    if (s.kind === "early" || s.kind === "late_early") early += 1;
    if (s.kind === "absent") absent += 1;
  }
  return { present, late, early, absent, missing, minutes };
}

// ---------------------------------------------------------------- the monthly view (/me/attendance)

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-11" -> first and last date and the number of days. */
export function monthBounds(month: string): { first: string; last: string; days: number } {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`Not a month: ${month}`);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, "0")}`, days };
}

/** A month from the address bar, or the month of `today` when it is missing or not a real month. */
export function parseMonth(raw: string | string[] | undefined, today: string): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && MONTH_RE.test(v) ? v : today.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MONTH_NAME = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" });
export function monthLabel(month: string): string {
  return MONTH_NAME.format(new Date(`${month}-01T00:00:00Z`));
}

const WEEKDAY = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short" });
export function weekdayShort(date: string): string {
  return WEEKDAY.format(new Date(`${date}T00:00:00Z`));
}

/** Short word for a calendar cell. Empty where a cell needs no word. */
export const KIND_SHORT: Record<DayKind, string> = {
  in: "In", present: "Present", late: "Late", early: "Left early", late_early: "Late", missing: "No out", remote: "Remote",
  excused: "Excused", holiday: "Holiday", off: "Off", upcoming: "", not_yet: "", absent: "Absent", not_tracked: "", leave: "Leave",
};

export type MonthTotals = {
  /** Days the person was expected to work, up to and including today. */
  workingDays: number;
  present: number;
  absent: number;
  late: number;
  early: number;
  missing: number;
  holidays: number;
  remoteDays: number;
  /** Days of approved leave (half days count as half), never counted as absences. */
  leaveDays: number;
  minutes: number;
  /** Average worked minutes over the days they were present. */
  averageMinutes: number;
};

/** Month counts. Absent, late and early stay at zero until the founder turns flags on, as everywhere else. */
export function monthTotals(rows: DayRow[], settings: OfficeSettings, today: string, nowMinutes: number): MonthTotals {
  const tracked = rows.filter((r) => r.tracked !== false);
  const s = summarise(tracked, settings, today, nowMinutes);
  const workingDays = tracked.filter((r) => r.expected && r.work_date <= today).length;
  const holidays = rows.filter((r) => r.holiday !== null).length;
  const remoteDays = tracked.filter((r) => r.first_in !== null && r.remote === true).length;
  const leaveDays = tracked.filter((r) => r.leave_name && r.first_in === null && r.work_date <= today).reduce((sum, r) => sum + (r.leave_half ? 0.5 : 1), 0);
  return {
    workingDays, present: s.present, absent: s.absent, late: s.late, early: s.early, missing: s.missing,
    holidays, remoteDays, leaveDays, minutes: s.minutes, averageMinutes: s.present > 0 ? Math.round(s.minutes / s.present) : 0,
  };
}

/** A spreadsheet opens a cell starting with = + - @ as a formula. Holiday names and reasons are typed by people. */
function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function clock(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

/** A day's note: where they checked in from and the reason an administrator gave, if any. */
export function dayNote(row: DayRow): string {
  const parts: string[] = [];
  if (row.first_in && row.remote) parts.push("Remote");
  if (row.manual) parts.push("Added by a lead");
  if (row.off_network_out) parts.push("Checked out away from the office");
  if (row.mark_reason) parts.push(row.mark_reason);
  return parts.join("; ");
}

export type DayLine = {
  date: string;
  weekday: string;
  kind: DayKind;
  label: string;
  short: string;
  tone: Tone;
  timeIn: string;
  timeOut: string;
  worked: string;
  note: string;
  /** Days that are not working days or that lie ahead carry no weight in the table. */
  quiet: boolean;
};

/** Everything a screen needs to draw each day of a month, so pages and the calendar share one reading of the rules. */
export function describeDays(rows: DayRow[], settings: OfficeSettings, today: string, nowMinutes: number): DayLine[] {
  return rows.map((r) => {
    const st = dayStatus(r, settings, today, nowMinutes);
    return {
      date: r.work_date, weekday: weekdayShort(r.work_date), kind: st.kind, label: st.label, short: KIND_SHORT[st.kind], tone: st.tone,
      timeIn: clock(r.first_in), timeOut: r.is_open ? "" : clock(r.last_out), worked: r.minutes > 0 ? formatHM(r.minutes) : "", note: dayNote(r),
      quiet: st.kind === "off" || st.kind === "upcoming" || st.kind === "not_tracked" || st.kind === "holiday",
    };
  });
}

export function monthToCsv(rows: DayRow[], settings: OfficeSettings, today: string, nowMinutes: number): string {
  const head = ["Date", "Day", "Status", "In", "Out", "Worked", "Note"];
  const lines = [head.join(",")];
  for (const r of rows) {
    const st = dayStatus(r, settings, today, nowMinutes);
    lines.push([
      r.work_date, weekdayShort(r.work_date), st.label, clock(r.first_in), clock(r.last_out), r.minutes > 0 ? formatHM(r.minutes) : "", dayNote(r),
    ].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** Several tagged people refused in a short time usually means the office address changed, not that people are away. */
export function networkAlert(failuresByPerson: Map<string, number>, threshold = 3): boolean {
  return failuresByPerson.size >= threshold;
}
