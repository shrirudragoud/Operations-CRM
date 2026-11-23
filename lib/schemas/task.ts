import { z } from "zod";
import { todayIST } from "@/lib/format";
import { DEPARTMENTS } from "@/lib/permissions";
import { TASK_STATUSES, TASK_STATUS_LABELS, type TaskStatus } from "@/lib/schemas/activity";
import { cleanSearch } from "@/lib/schemas/institution";

// Shared by the task forms and the Server Actions. The database (0018, ops.task_guard) re-validates every
// rule here: status moves, reasons, who may reassign or reopen, subtask limits.

export const PRIORITIES = [1, 2, 3, 4] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { 1: "Urgent", 2: "High", 3: "Normal", 4: "Low" };

export const TASK_PAGE_SIZE = 25;
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ["todo", "doing", "blocked"];

/** Where a task may go from a status (mirrors ops.task_guard). Reopening done/cancelled also needs permission. */
export function allowedTaskMoves(from: TaskStatus): TaskStatus[] {
  switch (from) {
    case "todo": return ["doing", "blocked", "done", "cancelled"];
    case "doing": return ["todo", "blocked", "done", "cancelled"];
    case "blocked": return ["todo", "doing", "done", "cancelled"];
    case "done": return ["todo", "doing"];
    case "cancelled": return ["todo"];
  }
}

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

const optionalUuid = z.union([z.literal(""), z.uuid()]).nullable().optional().transform((v) => (v ? v : null));

const optionalDepartment = z
  .union([z.literal(""), z.enum(DEPARTMENTS)], { message: "Choose a department." })
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));

export const TASK_CATEGORIES = ["internal", "other"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = { internal: "Internal", other: "Others" };

const optionalCategory = z
  .union([z.literal(""), z.enum(TASK_CATEGORIES)], { message: "Choose a category." })
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));

/** Everyone who gets their own copy of one task (the first is the "Assign to" person). At most 20, as the database allows. */
export const MAX_TASK_GROUP = 20;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `Keep ${label} under ${max} characters.`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const title = z.string().trim().min(1, "Give the task a title.").max(200, "Keep the title under 200 characters.");

const optionalDate = z
  .string()
  .trim()
  .nullable()
  .optional()
  .refine((v) => !v || ymd.test(v), "Enter a valid date.")
  .transform((v) => (v ? v : null));

const optionalTime = z
  .string()
  .trim()
  .nullable()
  .optional()
  .refine((v) => !v || hhmm.test(v), "Enter a valid time.")
  .transform((v) => (v ? v : null));

const estimate = z
  .union([z.literal(""), z.number(), z.string()])
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v === "" || v === null || v === undefined) return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 6000) {
      ctx.addIssue({ code: "custom", message: "Enter whole minutes between 1 and 6000." });
      return z.NEVER;
    }
    return n;
  });

const priority = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v, ctx): Priority => {
    if (v === undefined || v === "") return 3;
    const n = Number(v);
    if (n !== 1 && n !== 2 && n !== 3 && n !== 4) {
      ctx.addIssue({ code: "custom", message: "Choose a priority." });
      return z.NEVER;
    }
    return n;
  });

export const TASK_MODES = ["separate", "shared"] as const;
export type TaskMode = (typeof TASK_MODES)[number];

const taskFields = {
  title,
  description: optionalText(4000, "the description"),
  department: optionalDepartment,
  category: optionalCategory,
  assignee_id: optionalUuid,
  start_date: optionalDate,
  due_date: optionalDate,
  due_time: optionalTime,
  priority,
  estimate_minutes: estimate,
};

function dueRules(v: { start_date: string | null; due_date: string | null; due_time: string | null }, ctx: z.RefinementCtx) {
  if (v.due_time && !v.due_date) {
    ctx.addIssue({ code: "custom", path: ["due_date"], message: "Pick a date for the due time." });
  }
  if (v.start_date && v.due_date && v.start_date > v.due_date) {
    ctx.addIssue({ code: "custom", path: ["start_date"], message: "The start can't be after the deadline." });
  }
}

export const createTaskSchema = z
  .object({
    ...taskFields,
    parent_task_id: optionalUuid,
    entity_type: z.enum(["institution", "deal", "event"]).nullable().optional().transform((v) => v ?? null),
    entity_id: optionalUuid,
    also_assignee_ids: z.array(z.uuid()).max(MAX_TASK_GROUP, `At most ${MAX_TASK_GROUP} people.`).optional().transform((v) => v ?? []),
    mode: z.enum(TASK_MODES).optional().transform((v) => v ?? "separate"),
  })
  .superRefine((v, ctx) => {
    dueRules(v, ctx);
    if (v.also_assignee_ids.length > 0 && v.entity_type) {
      ctx.addIssue({ code: "custom", path: ["also_assignee_ids"], message: "A linked task goes to one person." });
    }
    if (!!v.entity_type !== !!v.entity_id) {
      ctx.addIssue({ code: "custom", path: ["entity_id"], message: "Link both the record type and the record." });
    }
    if (v.due_date && v.due_date < todayIST()) {
      ctx.addIssue({ code: "custom", path: ["due_date"], message: "The due date can't be in the past." });
    }
  });
export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type CreateTaskValues = z.output<typeof createTaskSchema>;

/** Edit the details. A person who is only the assignee cannot change title/description/department (the database refuses). */
export const updateTaskSchema = z
  .object({ id: z.uuid(), ...taskFields })
  .superRefine(dueRules);
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;
export type UpdateTaskValues = z.output<typeof updateTaskSchema>;

/** Due date / time / priority / estimate: the fields an assignee may change on their own task. */
export const scheduleTaskSchema = z
  .object({
    id: z.uuid(),
    start_date: optionalDate,
    due_date: optionalDate,
    due_time: optionalTime,
    priority,
    estimate_minutes: estimate,
  })
  .superRefine(dueRules);

/** Shared details for every open task of a group: the creator or a founder only (ops.update_task_group). */
export const updateTaskGroupSchema = z.object({
  id: z.uuid(),
  title,
  description: optionalText(4000, "the description"),
  priority,
  department: optionalDepartment,
  category: optionalCategory,
});

export const cancelTaskGroupSchema = z.object({ id: z.uuid(), reason: z.string().trim().min(1, "Say why.").max(500) });

export const taskOwnerSchema = z.object({ task_id: z.uuid(), staff_id: z.uuid() });

export const taskIdSchema = z.object({ id: z.uuid() });

export const assignTaskSchema = z.object({ id: z.uuid(), assignee_id: optionalUuid });

export const reasonText = (message: string) =>
  z.string().trim().min(1, message).max(500, "Keep the reason under 500 characters.");

export const taskStatusSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(TASK_STATUSES, { message: "Choose a status." }),
    reason: z.string().trim().max(500, "Keep the reason under 500 characters.").optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (v.status === "blocked" && !v.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Say what is blocking the task." });
    }
    if (v.status === "cancelled" && !v.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Say why the task is cancelled." });
    }
  });
export type TaskStatusInput = z.input<typeof taskStatusSchema>;

export const taskCommentSchema = z.object({
  task_id: z.uuid(),
  body: z.string().trim().min(1, "Write a comment first.").max(4000, "Keep the comment under 4000 characters."),
  mentions: z.array(z.uuid()).max(10, "Mention up to 10 people.").optional().default([]),
});

export const watcherSchema = z.object({ task_id: z.uuid(), staff_id: z.uuid() });

export const notificationIdsSchema = z.object({ ids: z.array(z.number().int().positive()).max(200).optional() });

export const saveTaskViewSchema = z.object({
  name: z.string().trim().min(1, "Name the view.").max(60, "Keep the name under 60 characters."),
  query: z.string().trim().max(500).default(""),
  shared: z.boolean().optional().default(false),
});
export const deleteTaskViewSchema = z.object({ id: z.uuid() });

// ---------------------------------------------------------------- Fixed (recurring) tasks
export const RECURRENCE_FREQUENCIES = ["daily", "weekdays", "weekly", "monthly"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];
export const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  daily: "Every day",
  weekdays: "Every weekday (Mon to Fri)",
  weekly: "Every week",
  monthly: "Every month",
};
export const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const smallInt = (min: number, max: number, message: string, fallback: number | null) =>
  z
    .union([z.literal(""), z.number(), z.string()])
    .nullable()
    .optional()
    .transform((v, ctx) => {
      if (v === "" || v === null || v === undefined) return fallback;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return n;
    });

export const recurrenceSchema = z
  .object({
    id: z.uuid().optional(),
    title,
    description: optionalText(4000, "the description"),
    department: z.enum(DEPARTMENTS, { message: "Choose a department." }),
    priority,
    estimate_minutes: estimate,
    frequency: z.enum(RECURRENCE_FREQUENCIES, { message: "Choose how often." }),
    weekday: smallInt(1, 7, "Choose a weekday.", null),
    month_day: smallInt(1, 28, "Choose a day from 1 to 28.", null),
    due_after_days: smallInt(0, 60, "Enter 0 to 60 days.", 0),
    due_time: optionalTime,
    starts_on: z.string().trim().regex(ymd, "Enter a valid date."),
    ends_on: optionalDate,
    all_department: z.boolean(),
    staff_ids: z.array(z.uuid()).max(100).default([]),
    active: z.boolean().optional().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.frequency === "weekly" && !v.weekday) ctx.addIssue({ code: "custom", path: ["weekday"], message: "Choose the weekday." });
    if (v.frequency === "monthly" && !v.month_day) ctx.addIssue({ code: "custom", path: ["month_day"], message: "Choose the day of the month." });
    if (!v.all_department && v.staff_ids.length === 0) {
      ctx.addIssue({ code: "custom", path: ["staff_ids"], message: "Choose the whole department or at least one person." });
    }
    if (v.ends_on && v.ends_on < v.starts_on) ctx.addIssue({ code: "custom", path: ["ends_on"], message: "The end can't be before the start." });
  });
export type RecurrenceInput = z.input<typeof recurrenceSchema>;
export type RecurrenceValues = z.output<typeof recurrenceSchema>;

export const recurrenceIdSchema = z.object({ id: z.uuid() });
export const recurrenceActiveSchema = z.object({ id: z.uuid(), active: z.boolean() });

export function describeRecurrence(r: {
  frequency: string; weekday: number | null; month_day: number | null; due_after_days: number;
}): string {
  const every =
    r.frequency === "weekly" ? `Every ${WEEKDAY_LABELS[(r.weekday ?? 1) - 1] ?? "week"}`
    : r.frequency === "monthly" ? `On day ${r.month_day} of every month`
    : FREQUENCY_LABELS[r.frequency as RecurrenceFrequency] ?? r.frequency;
  const due = r.due_after_days === 0 ? "due the same day" : `due ${r.due_after_days} ${r.due_after_days === 1 ? "day" : "days"} later`;
  return `${every}, ${due}`;
}

export const deleteCommentSchema = z.object({ id: z.uuid(), task_id: z.uuid() });

// ---------------------------------------------------------------- Display helpers

/** Due date (yyyy-mm-dd) and optional time (HH:MM[:SS]) are both IST wall-clock values. */
export function isOverdue(
  task: { status: string; due_date: string | null; due_time: string | null },
  now: Date = new Date(),
): boolean {
  if (!task.due_date || !OPEN_TASK_STATUSES.includes(task.status as TaskStatus)) return false;
  const today = todayIST(now);
  if (task.due_date < today) return true;
  if (task.due_date > today || !task.due_time) return false;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return task.due_time.slice(0, 5) < time;
}

/** "5 Mar to 9 Mar", "from 5 Mar", or just the deadline. */
export function formatSpan(start: string | null, dueDate: string | null, dueTime: string | null): string {
  if (!start) return formatDue(dueDate, dueTime);
  const day = (v: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(new Date(`${v}T00:00:00+05:30`));
  if (!dueDate) return `From ${day(start)}`;
  if (start === dueDate) return formatDue(dueDate, dueTime);
  return `${day(start)} to ${formatDue(dueDate, dueTime)}`;
}

export function formatDue(dueDate: string | null, dueTime: string | null): string {
  if (!dueDate) return "No due date";
  const d = new Date(`${dueDate}T00:00:00+05:30`);
  const date = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(d);
  if (!dueTime) return date;
  const [h = "0", m = "00"] = dueTime.split(":");
  const hour = Number(h);
  return `${date}, ${hour % 12 || 12}:${m} ${hour < 12 ? "am" : "pm"}`;
}

export function formatMinutes(total: number | null): string {
  if (!total) return "-";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

// ---------------------------------------------------------------- List params (URL state)

export const TASK_TABS = ["mine", "team", "created"] as const;
export type TaskTab = (typeof TASK_TABS)[number];
export const TASK_VIEWS = ["open", "done", "all"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const TASK_LAYOUTS = ["board", "list", "calendar", "timeline"] as const;
export type TaskLayout = (typeof TASK_LAYOUTS)[number];
export const LAYOUT_LABELS: Record<TaskLayout, string> = { list: "Table", board: "Board", calendar: "Calendar", timeline: "Timeline" };

export type TaskParams = {
  tab: TaskTab;
  view: TaskView;
  layout: TaskLayout;
  /** yyyy-mm for the calendar, yyyy-mm-dd (a Monday) for the timeline; "" = now. */
  at: string;
  department: string;
  assignee: string;
  q: string;
  page: number;
  /** Show subtasks as cards and rows of their own. Off, they sit under their parent (your own subtasks always show under "Assigned to me"). */
  subtasks: boolean;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseTaskParams(raw: Record<string, string | string[] | undefined>): TaskParams {
  const tab = first(raw.tab);
  const view = first(raw.view);
  const layout = first(raw.layout);
  const at = first(raw.at);
  const department = first(raw.department);
  const assignee = first(raw.assignee);
  const page = Number.parseInt(first(raw.page), 10);
  return {
    tab: (TASK_TABS as readonly string[]).includes(tab) ? (tab as TaskTab) : "mine",
    view: (TASK_VIEWS as readonly string[]).includes(view) ? (view as TaskView) : "open",
    layout: (TASK_LAYOUTS as readonly string[]).includes(layout) ? (layout as TaskLayout) : "board",
    at: /^\d{4}-\d{2}(-\d{2})?$/.test(at) ? at : "",
    department: (DEPARTMENTS as readonly string[]).includes(department) ? department : "",
    assignee: assignee === "none" || z.uuid().safeParse(assignee).success ? assignee : "",
    q: cleanSearch(first(raw.q)),
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
    subtasks: first(raw.subtasks) === "1",
  };
}

export function taskQuery(p: Partial<TaskParams>): string {
  const qs = new URLSearchParams();
  if (p.tab && p.tab !== "mine") qs.set("tab", p.tab);
  if (p.view && p.view !== "open") qs.set("view", p.view);
  if (p.layout && p.layout !== "board") qs.set("layout", p.layout);
  if (p.at) qs.set("at", p.at);
  if (p.department) qs.set("department", p.department);
  if (p.assignee) qs.set("assignee", p.assignee);
  if (p.q) qs.set("q", p.q);
  if (p.page && p.page > 1) qs.set("page", String(p.page));
  if (p.subtasks) qs.set("subtasks", "1");
  return qs.toString();
}

// ---------------------------------------------------------------- History wording


/** One readable line for a task_history row (assignees are stored by name, statuses and priorities as codes). */
export function describeHistory(h: { kind: string; from_value: string | null; to_value: string | null; note: string | null }): string {
  const status = (v: string | null) => (v ? TASK_STATUS_LABELS[v as TaskStatus] ?? v : "-");
  switch (h.kind) {
    case "created": return "created the task";
    case "assigned":
      return h.to_value
        ? h.from_value ? `reassigned it from ${h.from_value} to ${h.to_value}` : `assigned it to ${h.to_value}`
        : `moved it back to the team queue${h.from_value ? ` (was ${h.from_value})` : ""}`;
    case "status": return `changed the status from ${status(h.from_value)} to ${status(h.to_value)}${h.note ? `: ${h.note}` : ""}`;
    case "start": return `changed the start date from ${h.from_value ?? "none"} to ${h.to_value ?? "none"}`;
    case "due": return `changed the deadline from ${h.from_value ?? "none"} to ${h.to_value ?? "none"}`;
    case "priority": {
      const label = (v: string | null) => PRIORITY_LABELS[Number(v) as Priority] ?? v ?? "-";
      return `changed the priority from ${label(h.from_value)} to ${label(h.to_value)}`;
    }
    case "department": return `moved it from ${h.from_value ?? "-"} to ${h.to_value ?? "-"}`;
    case "edited": return "edited the details";
    case "file_added": return `added the file ${h.to_value ?? ""}`.trim();
    case "file_removed": return `removed the file ${h.from_value ?? ""}`.trim();
    case "file_restored": return `restored the file ${h.to_value ?? ""}`.trim();
    default: return h.kind;
  }
}
