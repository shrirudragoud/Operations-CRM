import { todayIST } from "@/lib/format";

// Pure date helpers for the Calendar and Timeline layouts. Everything is a yyyy-mm-dd string in India time
// and is computed in UTC so the machine's own time zone never shifts a day.

export const TIMELINE_DAYS = 14;
export const LAYOUT_LIMIT = 300;

const parts = (ymd: string): [number, number, number] => {
  const [y = 0, m = 1, d = 1] = ymd.split("-").map(Number);
  return [y, m, d];
};
const toDate = (ymd: string) => {
  const [y, m, d] = parts(ymd);
  return new Date(Date.UTC(y, m - 1, d));
};
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(ymd: string, n: number): string {
  const d = toDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

/** Whole days from a to b (negative if b is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

export function mondayOf(ymd: string): string {
  const weekday = (toDate(ymd).getUTCDay() + 6) % 7;
  return addDays(ymd, -weekday);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = parts(`${month}-01`);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The month (yyyy-mm) a URL `at` points at; a bad or empty value means this month. */
export function calendarMonth(at: string, today: string = todayIST()): string {
  return /^\d{4}-(0[1-9]|1[0-2])/.test(at) ? at.slice(0, 7) : today.slice(0, 7);
}

/** Weeks (Monday first) covering the month, each day as yyyy-mm-dd. */
export function monthWeeks(month: string): string[][] {
  const first = `${month}-01`;
  const weekday = (toDate(first).getUTCDay() + 6) % 7;
  const [y, m] = parts(first);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = addDays(first, -weekday);
  const weeks = Math.ceil((weekday + daysInMonth) / 7);
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

/** First day of the timeline window: the Monday on or before `at` (a full date), or this week's Monday. */
export function timelineStart(at: string, today: string = todayIST()): string {
  const ok = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(at);
  return mondayOf(ok ? at : today);
}

export function timelineDays(start: string): string[] {
  return Array.from({ length: TIMELINE_DAYS }, (_, i) => addDays(start, i));
}

type Dated = { start_date: string | null; due_date: string | null };

/** The first and last day a task covers: start to deadline, or just the one date it has. Null if it has none. */
export function taskSpan(t: Dated): { start: string; end: string } | null {
  const end = t.due_date ?? t.start_date;
  if (!end) return null;
  const start = t.start_date ?? end;
  return start > end ? { start: end, end } : { start, end };
}

/** The dated range a layout shows, used to ask the database only for tasks that touch it. */
export function layoutWindow(layout: string, at: string, today: string = todayIST()): { from: string; to: string } | null {
  if (layout === "calendar") {
    const weeks = monthWeeks(calendarMonth(at, today));
    return { from: weeks[0]?.[0] ?? today, to: weeks[weeks.length - 1]?.[6] ?? today };
  }
  if (layout === "timeline") {
    const start = timelineStart(at, today);
    return { from: start, to: addDays(start, TIMELINE_DAYS - 1) };
  }
  return null;
}

/** Tasks per day for the given days (a task shows on every day from its start to its deadline). */
export function tasksByDay<T extends Dated>(tasks: T[], days: string[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return map;
  for (const t of tasks) {
    const span = taskSpan(t);
    if (!span || span.end < first || span.start > last) continue;
    const from = span.start < first ? first : span.start;
    const to = span.end > last ? last : span.end;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const list = map.get(d);
      if (list) list.push(t);
      else map.set(d, [t]);
    }
  }
  return map;
}

/** 1-based grid columns (start inclusive, end exclusive) a task's bar covers inside a window, or null if outside it. */
export function barColumns(t: Dated, windowStart: string, days: number = TIMELINE_DAYS): { col: number; end: number; clippedStart: boolean; clippedEnd: boolean } | null {
  const span = taskSpan(t);
  if (!span) return null;
  const windowEnd = addDays(windowStart, days - 1);
  if (span.end < windowStart || span.start > windowEnd) return null;
  const s = span.start < windowStart ? windowStart : span.start;
  const e = span.end > windowEnd ? windowEnd : span.end;
  return { col: daysBetween(windowStart, s) + 1, end: daysBetween(windowStart, e) + 2, clippedStart: span.start < windowStart, clippedEnd: span.end > windowEnd };
}

export type Person = { id: string | null; name: string };

/** Group tasks by assignee, people alphabetically and "Unassigned" last. */
export function groupByPerson<T extends { assignee_id: string | null; assignee?: { full_name: string } | null }>(tasks: T[]): { person: Person; tasks: T[] }[] {
  const map = new Map<string, { person: Person; tasks: T[] }>();
  for (const t of tasks) {
    const key = t.assignee_id ?? "none";
    const g = map.get(key) ?? { person: { id: t.assignee_id, name: t.assignee?.full_name ?? "Unassigned" }, tasks: [] };
    g.tasks.push(t);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => (a.person.id === null ? 1 : b.person.id === null ? -1 : a.person.name.localeCompare(b.person.name)));
}
