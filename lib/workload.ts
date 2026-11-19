import { addDays } from "@/lib/task-layout";
import { isOverdue } from "@/lib/schemas/task";
import { onTimeRate, summarizeHealth, type HealthSummary, type HealthTask } from "@/lib/task-health";

// Pure helpers for My day (grouping one person's open tasks) and Team workload (per-person totals, task health, on-time rate).

export const OVERLOAD_MINUTES = 40 * 60;
export const SOON_DAYS = 7;

export type DayTask = {
  status: string;
  start_date: string | null;
  due_date: string | null;
  due_time?: string | null;
};

export type DayBucket = "overdue" | "today" | "soon" | "later" | "unscheduled";
export const DAY_BUCKETS: DayBucket[] = ["overdue", "today", "soon", "later", "unscheduled"];
export const DAY_BUCKET_LABELS: Record<DayBucket, string> = {
  overdue: "Overdue",
  today: "Due today",
  soon: "Starting soon / this week",
  later: "Later",
  unscheduled: "Unscheduled",
};

export function bucketTask(t: DayTask, today: string, now: Date = new Date()): DayBucket {
  if (isOverdue({ ...t, due_time: t.due_time ?? null }, now)) return "overdue";
  const horizon = addDays(today, SOON_DAYS);
  if (t.due_date === today || (!t.due_date && t.start_date === today)) return "today";
  if ((t.due_date && t.due_date <= horizon) || (t.start_date && t.start_date <= horizon)) return "soon";
  if (t.due_date || t.start_date) return "later";
  return "unscheduled";
}

export function groupTasks<T extends DayTask>(tasks: T[], today: string, now: Date = new Date()): Record<DayBucket, T[]> {
  const out: Record<DayBucket, T[]> = { overdue: [], today: [], soon: [], later: [], unscheduled: [] };
  for (const t of tasks) out[bucketTask(t, today, now)].push(t);
  return out;
}

export type WorkloadTask = DayTask & HealthTask & { assignee_id: string | null; estimate_minutes: number | null };
export type DoneTask = { assignee_id: string | null; due_date: string | null; completed_at: string | null };
export type WorkloadPerson = { id: string; full_name: string };

export type PersonLoad = {
  id: string;
  full_name: string;
  open: number;
  overdue: number;
  dueSoon: number;
  estimatedMinutes: number;
  unestimated: number;
  weekMinutes: number;
  overloaded: boolean;
  /** Open tasks by health (D48). */
  health: HealthSummary;
  /** Share of the last 30 days' finished tasks that met their deadline; null when none had a deadline. */
  onTime: { rate: number | null; total: number };
};

export function buildWorkload(input: {
  people: WorkloadPerson[];
  tasks: WorkloadTask[];
  minutes: { staff_id: string; minutes: number | null }[];
  done?: DoneTask[];
  today: string;
  now?: Date;
}): PersonLoad[] {
  const { people, tasks, minutes, today } = input;
  const now = input.now ?? new Date();
  const horizon = addDays(today, SOON_DAYS);
  const rows = new Map<string, PersonLoad>(
    people.map((p) => [
      p.id,
      { id: p.id, full_name: p.full_name, open: 0, overdue: 0, dueSoon: 0, estimatedMinutes: 0, unestimated: 0, weekMinutes: 0, overloaded: false, health: summarizeHealth([], now), onTime: { rate: null, total: 0 } },
    ]),
  );
  const byPerson = new Map<string, WorkloadTask[]>();
  for (const t of tasks) {
    if (t.assignee_id) byPerson.set(t.assignee_id, [...(byPerson.get(t.assignee_id) ?? []), t]);
    const r = t.assignee_id ? rows.get(t.assignee_id) : undefined;
    if (!r) continue;
    r.open += 1;
    if (isOverdue({ ...t, due_time: t.due_time ?? null }, now)) r.overdue += 1;
    else if (t.due_date && t.due_date >= today && t.due_date <= horizon) r.dueSoon += 1;
    if (t.estimate_minutes) r.estimatedMinutes += t.estimate_minutes;
    else r.unestimated += 1;
  }
  for (const m of minutes) {
    const r = rows.get(m.staff_id);
    if (r) r.weekMinutes += m.minutes ?? 0;
  }
  const doneBy = new Map<string, DoneTask[]>();
  for (const d of input.done ?? []) if (d.assignee_id) doneBy.set(d.assignee_id, [...(doneBy.get(d.assignee_id) ?? []), d]);
  for (const r of rows.values()) {
    r.overloaded = r.estimatedMinutes > OVERLOAD_MINUTES;
    r.health = summarizeHealth(byPerson.get(r.id) ?? [], now);
    const rate = onTimeRate(doneBy.get(r.id) ?? []);
    r.onTime = { rate: rate.rate, total: rate.total };
  }
  return [...rows.values()].sort((a, b) => b.health.attention - a.health.attention || b.overdue - a.overdue || b.open - a.open || a.full_name.localeCompare(b.full_name));
}

/** The people a caller may see on the workload page: everyone internal for a founder, department mates for a lead. */
export function visiblePeople<T extends { id: string; role: string; departments: string[] | null }>(
  staff: T[],
  me: { role: string; departments: string[] },
): T[] {
  return staff.filter((s) => {
    if (s.role === "partner" || s.role === "viewer") return false;
    if (me.role === "founder") return true;
    return (s.departments ?? []).some((d) => me.departments.includes(d));
  });
}
