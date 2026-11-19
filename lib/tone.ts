// One colour language for the whole app. A tone is a colour family; screens map their own values
// (priority, status, outcome, stage...) to a tone here so the same meaning always looks the same.

export type Tone = "red" | "orange" | "amber" | "green" | "teal" | "blue" | "violet" | "slate";

/** Soft filled chip: tinted background, strong text, thin border. Works in light and dark mode. */
export const TONE_CHIP: Record<Tone, string> = {
  red: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300",
  orange: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/50 dark:text-orange-300",
  amber: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
  teal: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/50 dark:text-teal-300",
  blue: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300",
  violet: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300",
  slate: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300",
};

/** Strong text colour, for icons and numbers. */
export const TONE_TEXT: Record<Tone, string> = {
  red: "text-red-600 dark:text-red-400",
  orange: "text-orange-600 dark:text-orange-400",
  amber: "text-amber-600 dark:text-amber-400",
  green: "text-emerald-600 dark:text-emerald-400",
  teal: "text-teal-600 dark:text-teal-400",
  blue: "text-blue-600 dark:text-blue-400",
  violet: "text-violet-600 dark:text-violet-400",
  slate: "text-slate-500 dark:text-slate-400",
};

/** Solid colour, for dots, stripes and bars. */
export const TONE_SOLID: Record<Tone, string> = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  green: "bg-emerald-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  slate: "bg-slate-400",
};

/** Left edge stripe on a card. */
export const TONE_STRIPE: Record<Tone, string> = {
  red: "border-l-red-500",
  orange: "border-l-orange-500",
  amber: "border-l-amber-500",
  green: "border-l-emerald-500",
  teal: "border-l-teal-500",
  blue: "border-l-blue-500",
  violet: "border-l-violet-500",
  slate: "border-l-slate-300 dark:border-l-slate-600",
};

/** Soft tinted panel behind a column or widget. */
export const TONE_PANEL: Record<Tone, string> = {
  red: "bg-red-50/60 dark:bg-red-950/20",
  orange: "bg-orange-50/60 dark:bg-orange-950/20",
  amber: "bg-amber-50/60 dark:bg-amber-950/20",
  green: "bg-emerald-50/60 dark:bg-emerald-950/20",
  teal: "bg-teal-50/60 dark:bg-teal-950/20",
  blue: "bg-blue-50/60 dark:bg-blue-950/20",
  violet: "bg-violet-50/60 dark:bg-violet-950/20",
  slate: "bg-slate-100/70 dark:bg-slate-900/40",
};

export const PRIORITY_TONE: Record<number, Tone> = { 1: "red", 2: "orange", 3: "blue", 4: "slate" };

export const TASK_STATUS_TONE: Record<string, Tone> = {
  todo: "slate",
  doing: "blue",
  blocked: "red",
  done: "green",
  cancelled: "slate",
};

export const OUTCOME_TONE: Record<string, Tone> = {
  no_answer: "slate",
  interested: "green",
  not_interested: "red",
  follow_up: "amber",
  qualified: "violet",
};

export const STAGE_TONE: Record<string, Tone> = {
  prospect: "slate",
  contacted: "blue",
  qualified: "violet",
  deal_won: "green",
  workshop_delivered: "teal",
  teachers_trained: "teal",
  active: "green",
  lab_customer: "green",
  renewal: "amber",
  churned: "red",
};

export const DEAL_STAGE_TONE: Record<string, Tone> = {
  meeting: "slate",
  proposal: "blue",
  negotiation: "amber",
  won: "green",
  lost: "red",
};

export const EVENT_STATUS_TONE: Record<string, Tone> = {
  draft: "slate",
  scheduled: "blue",
  in_progress: "amber",
  completed: "green",
  cancelled: "red",
};

export const MEETING_KIND_TONE: Record<string, Tone> = {
  team: "blue",
  one_to_one: "teal",
  review: "amber",
  institution: "violet",
  other: "slate",
};

export const RSVP_TONE: Record<string, Tone> = { invited: "slate", accepted: "green", tentative: "amber", declined: "red" };

export const DEPARTMENT_TONE: Record<string, Tone> = {
  outreach: "violet",
  sales: "blue",
  workshop: "orange",
  training: "teal",
  product: "amber",
  community: "green",
};

/** Sidebar icon colour per area, so each workspace is recognisable at a glance. */
export const AREA_TONE: Record<string, Tone> = {
  my_work: "blue",
  calendar: "violet",
  institutions: "violet",
  tasks: "green",
  timesheet: "amber",
  workload: "teal",
  reports: "blue",
  feedback: "orange",
  outreach: "violet",
  sales: "blue",
  workshop: "orange",
  inventory: "amber",
  training: "teal",
  product: "amber",
  community: "green",
  cockpit: "red",
  me: "teal",
  hr: "violet",
  team: "slate",
  audit_log: "slate",
};

export type DueState = "overdue" | "today" | "soon" | "later" | "none";

/** How close a deadline is, in India time. Done and cancelled work has no urgency. */
export function dueState(task: { status: string; due_date: string | null; due_time?: string | null }, today: string, overdue: boolean): DueState {
  if (!task.due_date || task.status === "done" || task.status === "cancelled") return "none";
  if (overdue) return "overdue";
  if (task.due_date === today) return "today";
  const days = Math.round((Date.parse(`${task.due_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days <= 3 ? "soon" : "later";
}

export const DUE_TONE: Record<DueState, Tone> = { overdue: "red", today: "amber", soon: "blue", later: "slate", none: "slate" };
