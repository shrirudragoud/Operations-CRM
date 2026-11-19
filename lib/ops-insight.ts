// Operations insight (D60): pure maths behind the Cockpit's Operations view. The database decides what is early, on
// time or late (ops.v_task_timeliness, migration 0026); this file only counts, groups and compares. Days are Indian
// calendar days written YYYY-MM-DD, weeks run Monday to Sunday, and Saturday and Sunday are off.
import { addDays } from "@/lib/task-layout";
import { weekStart } from "@/lib/schemas/time";

export const PERIODS = ["today", "week", "month"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABELS: Record<Period, string> = { today: "Today", week: "Week", month: "Month" };

export type Bucket = "early" | "on_time" | "late";

/** A row of ops.v_task_timeliness, as the app reads it. */
export type TaskRow = {
  task_id: string;
  title: string;
  department: string | null;
  priority: number;
  status: string;
  assignee_id: string | null;
  created_day: string;
  done_day: string | null;
  due_date: string | null;
  original_due_date: string | null;
  bucket: Bucket | null;
  days_late: number | null;
  estimate_minutes: number | null;
  logged_minutes: number;
  blocked_minutes: number;
  reschedules: number;
  reassigns: number;
};

/** The same row as the database view returns it, where every column of a view can be null. */
export type RawTaskRow = { [K in keyof Omit<TaskRow, "bucket">]?: TaskRow[K] | null } & { bucket?: string | null };

/** Drops rows that are missing what every row has, and fills the counters that can be null with zero. */
export function normalizeRows(raw: RawTaskRow[]): TaskRow[] {
  const out: TaskRow[] = [];
  for (const r of raw) {
    if (!r.task_id || !r.title || !r.status || !r.created_day) continue;
    out.push({
      task_id: r.task_id,
      title: r.title,
      department: r.department ?? null,
      priority: r.priority ?? 3,
      status: r.status,
      assignee_id: r.assignee_id ?? null,
      created_day: r.created_day,
      done_day: r.done_day ?? null,
      due_date: r.due_date ?? null,
      original_due_date: r.original_due_date ?? null,
      bucket: r.bucket === "early" || r.bucket === "on_time" || r.bucket === "late" ? r.bucket : null,
      days_late: r.days_late ?? null,
      estimate_minutes: r.estimate_minutes ?? null,
      logged_minutes: r.logged_minutes ?? 0,
      blocked_minutes: r.blocked_minutes ?? 0,
      reschedules: r.reschedules ?? 0,
      reassigns: r.reassigns ?? 0,
    });
  }
  return out;
}

export const OPEN_STATUSES =["todo", "doing", "blocked"] as const;
export const isOpen = (t: Pick<TaskRow, "status">): boolean => (OPEN_STATUSES as readonly string[]).includes(t.status);

// ---------------------------------------------------------------- dates
const dow = (ymd: string): number => (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
export const isWeekend = (ymd: string): boolean => dow(ymd) >= 5;

export function daysIn(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const workingDaysIn = (from: string, to: string): number => daysIn(from, to).filter((d) => !isWeekend(d)).length;

function monthBounds(ymd: string): { from: string; to: string } {
  const [y, m] = ymd.split("-").map(Number) as [number, number];
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from, to: addDays(next, -1) };
}

export type Range = { period: Period; from: string; to: string; prevFrom: string; prevTo: string; label: string; prevLabel: string };

function previousWorkingDay(ymd: string): string {
  let d = addDays(ymd, -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}

const fmtDay = (ymd: string): string =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
const fmtDayLong = (ymd: string): string =>
  new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
const fmtMonth = (ymd: string): string =>
  new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));

/** The period that contains `on`, and the one before it. Today compares with the previous working day. */
export function periodRange(period: Period, on: string): Range {
  if (period === "today") {
    const prev = previousWorkingDay(on);
    return { period, from: on, to: on, prevFrom: prev, prevTo: prev, label: fmtDayLong(on), prevLabel: fmtDayLong(prev) };
  }
  if (period === "week") {
    const from = weekStart(on);
    const to = addDays(from, 6);
    const prevFrom = addDays(from, -7);
    return { period, from, to, prevFrom, prevTo: addDays(from, -1), label: `${fmtDay(from)} to ${fmtDay(to)}`, prevLabel: `${fmtDay(prevFrom)} to ${fmtDay(addDays(from, -1))}` };
  }
  const { from, to } = monthBounds(on);
  const prev = monthBounds(addDays(from, -1));
  return { period, from, to, prevFrom: prev.from, prevTo: prev.to, label: fmtMonth(from), prevLabel: fmtMonth(prev.from) };
}

/** Move to the previous or next period; returns a day inside it. */
export function shiftPeriod(period: Period, on: string, steps: number): string {
  if (period === "today") {
    let d = on;
    for (let i = 0; i < Math.abs(steps); i += 1) {
      d = addDays(d, steps < 0 ? -1 : 1);
      while (isWeekend(d)) d = addDays(d, steps < 0 ? -1 : 1);
    }
    return d;
  }
  if (period === "week") return addDays(on, 7 * steps);
  const { from, to } = monthBounds(on);
  return steps < 0 ? addDays(from, -1) : addDays(to, 1);
}

export type InsightParams = { period: Period; on: string; department: string | null; person: string | null };

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isRealDay = (s: string): boolean => {
  if (!YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const UUID =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseInsightParams(raw: Record<string, string | string[] | undefined>, today: string, departments: readonly string[]): InsightParams {
  const period = PERIODS.find((p) => p === one(raw.period)) ?? "week";
  const on = one(raw.on);
  const dept = one(raw.dept);
  const person = one(raw.person);
  return {
    period,
    // A day that is not a real date, or one in the future, falls back to today.
    on: on && isRealDay(on) && on <= today ? on : today,
    department: dept && departments.includes(dept) ? dept : null,
    person: person && UUID.test(person) ? person : null,
  };
}

export function insightQuery(p: InsightParams, today: string): string {
  const q = new URLSearchParams();
  if (p.period !== "week") q.set("period", p.period);
  if (p.on !== today) q.set("on", p.on);
  if (p.department) q.set("dept", p.department);
  if (p.person) q.set("person", p.person);
  return q.toString();
}

// ---------------------------------------------------------------- scope
export type Scope = {
  /** People the viewer may see; null = everyone (founder). */
  people: ReadonlySet<string> | null;
  /** Departments whose unowned work the viewer may see; null = all. */
  departments: ReadonlySet<string> | null;
  department: string | null;
  person: string | null;
};

/**
 * What the viewer may see. The founder sees everything. A lead sees the people who share their departments and
 * unowned work in those departments; a filter outside that is dropped rather than widening it.
 */
export function buildScope(
  me: { role: string; departments: readonly string[] },
  visible: readonly { id: string }[],
  params: Pick<InsightParams, "department" | "person">,
): Scope {
  if (me.role === "founder") return { people: null, departments: null, department: params.department, person: params.person };
  const people = new Set(visible.map((p) => p.id));
  const departments = new Set(me.departments);
  return {
    people,
    departments,
    department: params.department && departments.has(params.department) ? params.department : null,
    person: params.person && people.has(params.person) ? params.person : null,
  };
}

export function inScope(t: Pick<TaskRow, "assignee_id" | "department">, s: Scope): boolean {
  if (s.department && t.department !== s.department) return false;
  if (s.person && t.assignee_id !== s.person) return false;
  if (s.people === null) return true;
  return t.assignee_id ? s.people.has(t.assignee_id) : (t.department !== null && (s.departments?.has(t.department) ?? false));
}

// ---------------------------------------------------------------- summaries
export type Summary = {
  done: number;
  early: number;
  onTime: number;
  late: number;
  noDeadline: number;
  /** Share of finished work with a deadline that was early or on time; null when none had a deadline. */
  onTimeRate: number | null;
  /** Finished tasks that had a deadline. Shown next to the percentage so 2 of 3 never reads as a trend. */
  withDeadline: number;
  created: number;
  avgDaysLate: number | null;
  reschedules: number;
  loggedMinutes: number;
  /** Logged minutes of finished tasks that had an estimate, against those estimates; null with no such task. */
  estimateRatio: number | null;
};

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);

export function summarize(rows: TaskRow[], from: string, to: string): Summary {
  let early = 0;
  let onTime = 0;
  let late = 0;
  let noDeadline = 0;
  let created = 0;
  let lateDays = 0;
  let reschedules = 0;
  let logged = 0;
  let est = 0;
  let actual = 0;
  for (const t of rows) {
    if (t.created_day >= from && t.created_day <= to) created += 1;
    if (t.status !== "done" || !t.done_day || t.done_day < from || t.done_day > to) continue;
    if (t.bucket === "early") early += 1;
    else if (t.bucket === "on_time") onTime += 1;
    else if (t.bucket === "late") {
      late += 1;
      lateDays += t.days_late ?? 0;
    } else noDeadline += 1;
    reschedules += t.reschedules;
    logged += t.logged_minutes;
    if (t.estimate_minutes && t.logged_minutes > 0) {
      est += t.estimate_minutes;
      actual += t.logged_minutes;
    }
  }
  const withDeadline = early + onTime + late;
  return {
    done: withDeadline + noDeadline,
    early,
    onTime,
    late,
    noDeadline,
    onTimeRate: pct(early + onTime, withDeadline),
    withDeadline,
    created,
    avgDaysLate: late > 0 ? Math.round((lateDays / late) * 10) / 10 : null,
    reschedules,
    loggedMinutes: logged,
    estimateRatio: est > 0 ? Math.round((actual / est) * 100) : null,
  };
}

export type Delta = { diff: number; direction: "up" | "down" | "same" };
/** Change from the previous period; null when either side has nothing to compare. */
export function delta(cur: number | null, prev: number | null): Delta | null {
  if (cur === null || prev === null) return null;
  const diff = cur - prev;
  return { diff, direction: diff > 0 ? "up" : diff < 0 ? "down" : "same" };
}

// ---------------------------------------------------------------- series
export type DayPoint = { day: string; label: string; weekend: boolean; early: number; onTime: number; late: number; noDeadline: number; done: number; created: number };

export function dailySeries(rows: TaskRow[], from: string, to: string): DayPoint[] {
  const days = daysIn(from, to);
  const map = new Map<string, DayPoint>(
    days.map((day) => [day, { day, label: fmtDay(day), weekend: isWeekend(day), early: 0, onTime: 0, late: 0, noDeadline: 0, done: 0, created: 0 }]),
  );
  for (const t of rows) {
    const made = map.get(t.created_day);
    if (made) made.created += 1;
    if (t.status !== "done" || !t.done_day) continue;
    const p = map.get(t.done_day);
    if (!p) continue;
    p.done += 1;
    if (t.bucket === "early") p.early += 1;
    else if (t.bucket === "on_time") p.onTime += 1;
    else if (t.bucket === "late") p.late += 1;
    else p.noDeadline += 1;
  }
  return days.map((d) => map.get(d)!);
}

export type WeekLine = { from: string; to: string; label: string; summary: Summary };
/** Week by week inside a longer range, each week clipped to the range. */
export function weekLines(rows: TaskRow[], from: string, to: string): WeekLine[] {
  const out: WeekLine[] = [];
  for (let w = weekStart(from); w <= to; w = addDays(w, 7)) {
    const a = w < from ? from : w;
    const sunday = addDays(w, 6);
    const b = sunday > to ? to : sunday;
    out.push({ from: a, to: b, label: `${fmtDay(a)} to ${fmtDay(b)}`, summary: summarize(rows, a, b) });
  }
  return out;
}

// ---------------------------------------------------------------- calendar heatmap
export type HeatCell = { day: string; count: number; level: 0 | 1 | 2 | 3 | 4; future: boolean; weekend: boolean };
export type HeatWeek = { start: string; cells: HeatCell[] };

/** Twelve weeks ending with the week of `today`; one cell per day with the number of tasks finished that day. */
export function heatmap(rows: TaskRow[], today: string, weeks = 12): HeatWeek[] {
  const counts = new Map<string, number>();
  for (const t of rows) if (t.status === "done" && t.done_day) counts.set(t.done_day, (counts.get(t.done_day) ?? 0) + 1);
  const firstWeek = addDays(weekStart(today), -7 * (weeks - 1));
  const max = Math.max(0, ...[...counts.entries()].filter(([d]) => d >= firstWeek).map(([, n]) => n));
  const level = (n: number): HeatCell["level"] => (n === 0 || max === 0 ? 0 : (Math.min(4, Math.ceil((n / max) * 4)) as HeatCell["level"]));
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(firstWeek, 7 * i);
    return {
      start,
      cells: Array.from({ length: 7 }, (_, j) => {
        const day = addDays(start, j);
        const count = counts.get(day) ?? 0;
        return { day, count, level: level(count), future: day > today, weekend: isWeekend(day) };
      }),
    };
  });
}

// ---------------------------------------------------------------- weekday profile
export type WeekdayPoint = { name: string; days: number; done: number; avgDone: number; late: number; lateRate: number | null };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

/** Average finished per weekday over a range (working days only) and how often work finished on that day was late. */
export function weekdayProfile(rows: TaskRow[], from: string, to: string): WeekdayPoint[] {
  const days = new Array<number>(5).fill(0);
  for (const d of daysIn(from, to)) if (!isWeekend(d)) days[dow(d)] = (days[dow(d)] ?? 0) + 1;
  const done = new Array<number>(5).fill(0);
  const late = new Array<number>(5).fill(0);
  const dated = new Array<number>(5).fill(0);
  for (const t of rows) {
    if (t.status !== "done" || !t.done_day || t.done_day < from || t.done_day > to || isWeekend(t.done_day)) continue;
    const i = dow(t.done_day);
    done[i] = (done[i] ?? 0) + 1;
    if (t.bucket) dated[i] = (dated[i] ?? 0) + 1;
    if (t.bucket === "late") late[i] = (late[i] ?? 0) + 1;
  }
  return WEEKDAYS.map((name, i) => ({
    name,
    days: days[i] ?? 0,
    done: done[i] ?? 0,
    avgDone: days[i] ? Math.round(((done[i] ?? 0) / (days[i] ?? 1)) * 10) / 10 : 0,
    late: late[i] ?? 0,
    lateRate: pct(late[i] ?? 0, dated[i] ?? 0),
  }));
}

// ---------------------------------------------------------------- lateness
export type LateBand = { band: string; count: number };
/** How late the late tasks were, in working days. */
export function latenessBands(rows: TaskRow[], from: string, to: string): LateBand[] {
  const bands: LateBand[] = [
    { band: "Same day", count: 0 },
    { band: "1 day", count: 0 },
    { band: "2 to 3 days", count: 0 },
    { band: "4 to 5 days", count: 0 },
    { band: "More than 5", count: 0 },
  ];
  for (const t of rows) {
    if (t.status !== "done" || t.bucket !== "late" || !t.done_day || t.done_day < from || t.done_day > to) continue;
    const d = t.days_late ?? 0;
    const i = d === 0 ? 0 : d === 1 ? 1 : d <= 3 ? 2 : d <= 5 ? 3 : 4;
    bands[i]!.count += 1;
  }
  return bands;
}

/** How long the work that is still overdue has been waiting, in working days. */
export function overdueAge(rows: TaskRow[], today: string): LateBand[] {
  const bands: LateBand[] = [
    { band: "Due earlier today", count: 0 },
    { band: "1 day", count: 0 },
    { band: "2 to 3 days", count: 0 },
    { band: "4 to 5 days", count: 0 },
    { band: "More than 5", count: 0 },
  ];
  for (const t of rows) {
    if (!isOpen(t) || !t.due_date || t.due_date >= today) continue;
    const d = workingDaysIn(addDays(t.due_date, 1), today);
    const i = d <= 0 ? 0 : d === 1 ? 1 : d <= 3 ? 2 : d <= 5 ? 3 : 4;
    bands[i]!.count += 1;
  }
  return bands;
}

// ---------------------------------------------------------------- people
export type PersonLine = {
  id: string | null;
  name: string;
  done: number;
  late: number;
  onTimeRate: number | null;
  withDeadline: number;
  openNow: number;
  overdueNow: number;
  noDeadlineOpen: number;
  loggedMinutes: number;
  reschedules: number;
  reassigns: number;
};

export function peopleTable(rows: TaskRow[], people: { id: string; full_name: string }[], from: string, to: string, today: string): PersonLine[] {
  const names = new Map(people.map((p) => [p.id, p.full_name]));
  const ids: (string | null)[] = [...people.map((p) => p.id), null];
  return ids.map((id) => {
    const mine = rows.filter((t) => t.assignee_id === id);
    const s = summarize(mine, from, to);
    const open = mine.filter(isOpen);
    return {
      id,
      name: id ? (names.get(id) ?? "Unknown") : "No owner",
      done: s.done,
      late: s.late,
      onTimeRate: s.onTimeRate,
      withDeadline: s.withDeadline,
      openNow: open.length,
      overdueNow: open.filter((t) => t.due_date !== null && t.due_date < today).length,
      noDeadlineOpen: open.filter((t) => t.due_date === null).length,
      loggedMinutes: s.loggedMinutes,
      reschedules: s.reschedules,
      reassigns: mine.reduce((n, t) => n + (t.done_day && t.done_day >= from && t.done_day <= to ? t.reassigns : 0), 0),
    };
  });
}

export type PersonWeek = { start: string; label: string; done: number; withDeadline: number; onTimeRate: number | null };
export type PersonRow = { id: string; name: string; weeks: PersonWeek[] };

/** People by week: finished work and on-time rate. The grid behind the people heatmap. */
export function peopleByWeek(rows: TaskRow[], people: { id: string; full_name: string }[], weekStarts: string[]): PersonRow[] {
  return people.map((p) => {
    const mine = rows.filter((t) => t.assignee_id === p.id);
    return {
      id: p.id,
      name: p.full_name,
      weeks: weekStarts.map((w) => {
        const s = summarize(mine, w, addDays(w, 6));
        return { start: w, label: fmtDay(w), done: s.done, withDeadline: s.withDeadline, onTimeRate: s.onTimeRate };
      }),
    };
  });
}

export function lastWeeks(today: string, n: number): string[] {
  const first = addDays(weekStart(today), -7 * (n - 1));
  return Array.from({ length: n }, (_, i) => addDays(first, 7 * i));
}

// ---------------------------------------------------------------- plan against actual
export type PlanPoint = { id: string; title: string; estimate: number; logged: number };
export function planVsActual(rows: TaskRow[], from: string, to: string, limit = 60): PlanPoint[] {
  return rows
    .filter((t) => t.status === "done" && t.done_day && t.done_day >= from && t.done_day <= to && t.estimate_minutes && t.logged_minutes > 0)
    .map((t) => ({ id: t.task_id, title: t.title, estimate: t.estimate_minutes ?? 0, logged: t.logged_minutes }))
    .slice(0, limit);
}

// ---------------------------------------------------------------- backlog history
export type BacklogRow = { snapshot_date: string; department: string | null; assignee_id: string | null; open_count: number; overdue_count: number; blocked_count: number; no_deadline_count: number };
export type BacklogPoint = { day: string; label: string; open: number; overdue: number; blocked: number };

export function backlogSeries(rows: BacklogRow[], from: string, to: string, scope: Scope): BacklogPoint[] {
  const map = new Map<string, BacklogPoint>();
  for (const r of rows) {
    if (r.snapshot_date < from || r.snapshot_date > to) continue;
    if (!inScope({ assignee_id: r.assignee_id, department: r.department }, scope)) continue;
    const p = map.get(r.snapshot_date) ?? { day: r.snapshot_date, label: fmtDay(r.snapshot_date), open: 0, overdue: 0, blocked: 0 };
    p.open += r.open_count;
    p.overdue += r.overdue_count;
    p.blocked += r.blocked_count;
    map.set(r.snapshot_date, p);
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export const formatPercent = (n: number | null): string => (n === null ? "No deadlines" : `${n}%`);
