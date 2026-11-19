import { todayIST } from "@/lib/format";
import type { Tone } from "@/lib/tone";

// Task health (D48): how worried should we be about this task, today? Pure functions of the task row and the
// clock, so the same answer shows on My day, the board, the table, the calendar and the workload page.
// It is advice, not a rule: the database never blocks on it.

export type HealthKey = "overdue" | "at_risk" | "due_today" | "soon" | "on_track" | "later" | "no_date" | "finished";

export type HealthTask = {
  status: string;
  due_date: string | null;
  due_time?: string | null;
  start_date?: string | null;
  estimate_minutes?: number | null;
  /** null = assigned to someone who has not accepted yet; undefined = not loaded, so the check is skipped. */
  accepted_at?: string | null;
  assignee_id?: string | null;
  updated_at?: string | null;
  /** Open subtasks, when known. */
  subOpen?: number;
};

export type Health = {
  key: HealthKey;
  tone: Tone;
  /** Short pill text: "Due tomorrow", "At risk · in 2 days", "Overdue 3 d". */
  label: string;
  /** One sentence for a tooltip: the timing, then every reason. */
  detail: string;
  /** Whole days from today to the deadline: negative once late. null without a deadline. */
  daysLeft: number | null;
  /** 0 fine, 1 heads-up, 2 act today, 3 late. */
  level: 0 | 1 | 2 | 3;
  /** Sort key: higher is more urgent. */
  rank: number;
  reasons: string[];
};

/** Days before the deadline when the lead-up starts to show (the 10th and 11th for a task due on the 12th). */
export const LEAD_DAYS = 3;
const WORK_MINUTES_PER_DAY = 6 * 60;
const STALE_DAYS = 3;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function istDayOf(iso: string): string {
  return todayIST(new Date(iso));
}

function clock(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}

/** Working days from today up to and including the due date (Sundays do not count). At least 1 when due today. */
function workingDaysLeft(today: string, due: string): number {
  let n = 0;
  const total = daysBetween(today, due);
  for (let i = 0; i <= total; i += 1) {
    const d = new Date(Date.parse(`${today}T00:00:00Z`) + i * 86_400_000);
    if (d.getUTCDay() !== 0) n += 1;
  }
  return n;
}

function when(daysLeft: number): string {
  if (daysLeft === 0) return "today";
  if (daysLeft === 1) return "tomorrow";
  return `in ${daysLeft} days`;
}

/** The colour ladder for the lead-up. Blue three days out, amber two, orange the last day and the day itself. */
export function leadTone(daysLeft: number): Tone {
  if (daysLeft >= 3) return "blue";
  if (daysLeft === 2) return "amber";
  return "orange";
}

function riskReasons(t: HealthTask, today: string, daysLeft: number): string[] {
  const reasons: string[] = [];
  if (t.status === "blocked") reasons.push("Blocked");
  if (t.status === "todo" && daysLeft <= 2) reasons.push("Not started");
  if (t.status === "todo" && t.assignee_id && t.accepted_at === null) reasons.push("Not accepted yet");
  if (t.status === "todo" && t.estimate_minutes && t.due_date) {
    const days = workingDaysLeft(today, t.due_date);
    if (t.estimate_minutes > days * WORK_MINUTES_PER_DAY) {
      const h = Math.round((t.estimate_minutes / 60) * 10) / 10;
      reasons.push(`Needs about ${h} h but only ${days} working ${days === 1 ? "day" : "days"} left`);
    }
  }
  if (t.subOpen && daysLeft <= 1) reasons.push(`${t.subOpen} ${t.subOpen === 1 ? "subtask" : "subtasks"} still open`);
  if (t.status === "doing" && t.updated_at) {
    const idle = daysBetween(istDayOf(t.updated_at), today);
    if (idle >= STALE_DAYS) reasons.push(`No update for ${idle} days`);
  }
  if (t.status === "todo" && t.start_date && t.due_date && t.due_date > t.start_date) {
    const span = daysBetween(t.start_date, t.due_date);
    const used = daysBetween(t.start_date, today);
    if (span > 0 && used / span >= 0.5 && !reasons.includes("Not started")) reasons.push("Half the time is gone and it has not started");
  }
  return reasons;
}

export function taskHealth(t: HealthTask, now: Date = new Date()): Health {
  const none = (key: HealthKey, label: string, tone: Tone = "slate"): Health => ({
    key, tone, label, detail: label, daysLeft: null, level: 0, rank: 0, reasons: [],
  });
  if (t.status === "done" || t.status === "cancelled") return none("finished", t.status === "done" ? "Done" : "Cancelled", t.status === "done" ? "green" : "slate");
  if (!t.due_date) return none("no_date", "No deadline");

  const today = todayIST(now);
  const daysLeft = daysBetween(today, t.due_date);
  const timePassed = daysLeft === 0 && !!t.due_time && t.due_time.slice(0, 5) < clock(now);

  if (daysLeft < 0 || timePassed) {
    const late = Math.abs(daysLeft);
    const label = late === 0 ? "Overdue today" : `Overdue ${late} d`;
    const reasons = t.status === "blocked" ? ["Blocked"] : [];
    return {
      key: "overdue", tone: "red", label, daysLeft, level: 3, rank: 300 + Math.min(late, 99), reasons,
      detail: `${late === 0 ? "The time has passed today" : `${late} ${late === 1 ? "day" : "days"} late`}${reasons.length ? `. ${reasons.join(". ")}` : ""}.`,
    };
  }

  if (daysLeft > LEAD_DAYS) {
    if (t.status === "doing") {
      return { key: "on_track", tone: "green", label: "On track", detail: `In progress, due in ${daysLeft} days.`, daysLeft, level: 0, rank: 10, reasons: [] };
    }
    return { key: "later", tone: "slate", label: daysLeft <= 14 ? `Due in ${daysLeft} days` : "Later", detail: `Due in ${daysLeft} days.`, daysLeft, level: 0, rank: 5, reasons: [] };
  }

  const reasons = riskReasons(t, today, daysLeft);
  const dueText = daysLeft === 0 ? "Due today" : daysLeft === 1 ? "Due tomorrow" : `Due in ${daysLeft} days`;
  if (reasons.length) {
    const tone: Tone = daysLeft >= 3 ? "amber" : "orange";
    return {
      key: "at_risk", tone, label: `At risk · ${when(daysLeft)}`, daysLeft, level: 2, rank: 250 - daysLeft * 10 + reasons.length, reasons,
      detail: `${dueText}. ${reasons.join(". ")}.`,
    };
  }
  if (daysLeft === 0) {
    return { key: "due_today", tone: "orange", label: "Due today", detail: "Due today.", daysLeft, level: 2, rank: 220, reasons: [] };
  }
  return {
    key: "soon", tone: leadTone(daysLeft), label: dueText, detail: `${dueText}.`, daysLeft, level: 1, rank: 200 - daysLeft * 10, reasons: [],
  };
}

export type HealthSummary = {
  total: number;
  overdue: number;
  atRisk: number;
  dueToday: number;
  soon: number;
  onTrack: number;
  later: number;
  noDate: number;
  /** Overdue plus at risk: the number to watch. */
  attention: number;
};

export function summarizeHealth(tasks: HealthTask[], now: Date = new Date()): HealthSummary {
  const s: HealthSummary = { total: 0, overdue: 0, atRisk: 0, dueToday: 0, soon: 0, onTrack: 0, later: 0, noDate: 0, attention: 0 };
  for (const t of tasks) {
    const h = taskHealth(t, now);
    if (h.key === "finished") continue;
    s.total += 1;
    if (h.key === "overdue") s.overdue += 1;
    else if (h.key === "at_risk") s.atRisk += 1;
    else if (h.key === "due_today") s.dueToday += 1;
    else if (h.key === "soon") s.soon += 1;
    else if (h.key === "on_track") s.onTrack += 1;
    else if (h.key === "later") s.later += 1;
    else s.noDate += 1;
  }
  s.attention = s.overdue + s.atRisk;
  return s;
}

/** The share of finished tasks that were completed on or before their deadline day (IST). Tasks without a deadline are not counted. */
export function onTimeRate(done: { due_date: string | null; completed_at: string | null }[]): { onTime: number; late: number; total: number; rate: number | null } {
  let onTime = 0;
  let late = 0;
  for (const t of done) {
    if (!t.due_date || !t.completed_at) continue;
    if (istDayOf(t.completed_at) <= t.due_date) onTime += 1;
    else late += 1;
  }
  const total = onTime + late;
  return { onTime, late, total, rate: total ? Math.round((onTime / total) * 100) : null };
}
