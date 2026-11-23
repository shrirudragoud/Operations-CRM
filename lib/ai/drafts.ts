import { z } from "zod";
import type { TaskStatus } from "@/lib/schemas/activity";
import { TASK_STATUS_LABELS } from "@/lib/schemas/activity";
import {
  allowedTaskMoves, assignTaskSchema, createTaskSchema, formatDue, PRIORITY_LABELS, scheduleTaskSchema, taskCommentSchema,
  taskStatusSchema, updateTaskSchema, type Priority,
} from "@/lib/schemas/task";

// What the assistant may propose. A draft is validated here with the same zod schemas the task forms use, stored as a
// pending ops.ai_action row, and only runs when the person confirms it (lib/actions/assistant.ts). The edit drafts keep
// only the fields that change and merge them into the live task when they run, so a stale draft never overwrites newer edits.

export const TASK_DRAFT_KINDS = ["create_task", "create_subtasks", "update_task", "set_schedule", "change_status", "assign_task", "add_comment"] as const;
export type TaskDraftKind = (typeof TASK_DRAFT_KINDS)[number];
export const MEETING_DRAFT_KINDS = ["schedule_meeting", "update_meeting", "cancel_meeting", "rsvp_meeting"] as const;
export type MeetingDraftKind = (typeof MEETING_DRAFT_KINDS)[number];
export const WORKSHOP_DRAFT_KINDS = ["create_event", "update_event", "set_event_team", "event_status", "toggle_run_item"] as const;
export type WorkshopDraftKind = (typeof WORKSHOP_DRAFT_KINDS)[number];
export const SALES_DRAFT_KINDS = ["log_activity", "create_deal", "update_deal", "move_deal"] as const;
export type SalesDraftKind = (typeof SALES_DRAFT_KINDS)[number];
export const DRAFT_KINDS = [...TASK_DRAFT_KINDS, ...MEETING_DRAFT_KINDS, ...WORKSHOP_DRAFT_KINDS, ...SALES_DRAFT_KINDS] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];
export const isTaskDraft = (kind: string): kind is TaskDraftKind => (TASK_DRAFT_KINDS as readonly string[]).includes(kind);
export const MAX_SUBTASKS = 15;

export type CurrentTask = {
  id: string;
  title: string;
  description: string | null;
  department: string | null;
  category: string | null;
  status: TaskStatus;
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  priority: number;
  estimate_minutes: number | null;
};

export type Checked = { ok: true; payload: Record<string, unknown> } | { ok: false; errors: string[] };
export type Names = { task: (id: string) => string; person: (id: string) => string };

const DETAIL_KEYS = ["title", "description", "department", "category"] as const;
const SCHEDULE_KEYS = ["start_date", "due_date", "due_time", "priority", "estimate_minutes"] as const;

function issues(error: z.ZodError): string[] {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
}

function wrap<T extends z.ZodType>(schema: T, input: unknown): { ok: true; data: z.output<T> } | { ok: false; errors: string[] } {
  const r = schema.safeParse(input);
  return r.success ? { ok: true, data: r.data } : { ok: false, errors: issues(r.error) };
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function pick(args: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (args[k] !== undefined) out[k] = args[k];
  return out;
}

/** The input the task action takes for an edit draft: the live task with the drafted changes laid over it. */
export function mergeEdit(kind: "update_task" | "set_schedule", current: CurrentTask, changes: Record<string, unknown>) {
  const base = {
    id: current.id,
    title: current.title,
    description: current.description,
    department: current.department,
    category: current.category,
    start_date: current.start_date,
    due_date: current.due_date,
    due_time: current.due_time ? current.due_time.slice(0, 5) : null,
    priority: current.priority,
    estimate_minutes: current.estimate_minutes,
  };
  if (kind === "set_schedule") {
    const { id, start_date, due_date, due_time, priority, estimate_minutes } = { ...base, ...changes };
    return { id, start_date, due_date, due_time, priority, estimate_minutes };
  }
  return { ...base, ...changes };
}

export function checkCreateTask(args: unknown): Checked {
  const r = wrap(createTaskSchema, args);
  return r.ok ? { ok: true, payload: r.data } : r;
}

export function checkCreateSubtasks(args: unknown): Checked {
  const a = asRecord(args);
  const head = wrap(z.object({ parent_task_id: z.uuid("parent_task_id must be a task id from search_tasks or get_task."), subtasks: z.array(z.record(z.string(), z.unknown())).min(1, "Add at least one subtask.").max(MAX_SUBTASKS, `At most ${MAX_SUBTASKS} subtasks in one draft.`) }), a);
  if (!head.ok) return head;
  const errors: string[] = [];
  const subtasks = head.data.subtasks.map((s, i) => {
    const r = wrap(createTaskSchema, { ...s, parent_task_id: head.data.parent_task_id });
    if (!r.ok) errors.push(...r.errors.map((e) => `subtask ${i + 1}: ${e}`));
    return r.ok ? r.data : null;
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, payload: { parent_task_id: head.data.parent_task_id, subtasks } };
}

export function checkUpdateTask(current: CurrentTask, args: unknown): Checked {
  const changes = pick(asRecord(args), DETAIL_KEYS);
  if (Object.keys(changes).length === 0) return { ok: false, errors: ["Say what to change: title, description, department or category."] };
  const r = wrap(updateTaskSchema, mergeEdit("update_task", current, changes));
  if (!r.ok) return r;
  const parsed = r.data as Record<string, unknown>;
  const normalized = Object.fromEntries(Object.keys(changes).map((k) => [k, parsed[k] ?? null]));
  return { ok: true, payload: { id: current.id, changes: normalized } };
}

export function checkSchedule(current: CurrentTask, args: unknown, today: string): Checked {
  const changes = pick(asRecord(args), SCHEDULE_KEYS);
  if (Object.keys(changes).length === 0) return { ok: false, errors: ["Say what to change: start_date, due_date, due_time, priority or estimate_minutes."] };
  const r = wrap(scheduleTaskSchema, mergeEdit("set_schedule", current, changes));
  if (!r.ok) return r;
  const parsed = r.data as Record<string, unknown>;
  if (changes.due_date !== undefined && typeof parsed.due_date === "string" && parsed.due_date < today) {
    return { ok: false, errors: ["due_date: The due date can't be in the past."] };
  }
  const normalized = Object.fromEntries(Object.keys(changes).map((k) => [k, parsed[k] ?? null]));
  return { ok: true, payload: { id: current.id, changes: normalized } };
}

export function checkStatus(current: CurrentTask, args: unknown): Checked {
  const r = wrap(taskStatusSchema, args);
  if (!r.ok) return r;
  if (r.data.status === current.status) return { ok: false, errors: [`The task is already ${TASK_STATUS_LABELS[current.status]}.`] };
  if (!allowedTaskMoves(current.status).includes(r.data.status)) {
    const allowed = allowedTaskMoves(current.status).map((s) => TASK_STATUS_LABELS[s]).join(", ");
    return { ok: false, errors: [`A ${TASK_STATUS_LABELS[current.status]} task can only move to: ${allowed}.`] };
  }
  return { ok: true, payload: r.data };
}

export function checkAssign(args: unknown): Checked {
  const r = wrap(assignTaskSchema, args);
  return r.ok ? { ok: true, payload: r.data } : r;
}

export function checkComment(args: unknown): Checked {
  const r = wrap(taskCommentSchema, args);
  return r.ok ? { ok: true, payload: r.data } : r;
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

function people(ids: unknown, names: Names): string {
  return Array.isArray(ids) ? ids.map((i) => names.person(String(i))).join(", ") : "";
}

function taskLine(p: Record<string, unknown>, names: Names): string {
  const bits: string[] = [];
  const who = [p.assignee_id, ...(Array.isArray(p.also_assignee_ids) ? p.also_assignee_ids : [])].filter((x): x is string => typeof x === "string");
  if (who.length > 0) bits.push(`${p.mode === "shared" && who.length > 1 ? "shared by" : "for"} ${people(who, names)}`);
  if (typeof p.due_date === "string") bits.push(`due ${formatDue(p.due_date, typeof p.due_time === "string" ? p.due_time : null)}`);
  if (typeof p.priority === "number" && p.priority !== 3) bits.push(`${PRIORITY_LABELS[p.priority as Priority] ?? p.priority} priority`);
  if (typeof p.department === "string") bits.push(`${p.department} department`);
  return bits.length ? ` (${bits.join(", ")})` : "";
}

const FIELD_LABEL: Record<string, string> = {
  title: "title", description: "description", department: "department", category: "category",
  start_date: "start date", due_date: "due date", due_time: "due time", priority: "priority", estimate_minutes: "estimate",
};

function changeLine(changes: Record<string, unknown>): string {
  return Object.entries(changes)
    .map(([k, v]) => {
      if (v === null || v === "") return `clear the ${FIELD_LABEL[k] ?? k}`;
      if (k === "priority") return `priority to ${PRIORITY_LABELS[v as Priority] ?? v}`;
      if (k === "due_date") return `due date to ${formatDue(String(v), null)}`;
      if (k === "start_date") return `start date to ${formatDue(String(v), null)}`;
      if (k === "estimate_minutes") return `estimate to ${v} min`;
      if (k === "description") return "the description";
      return `${FIELD_LABEL[k] ?? k} to "${clip(String(v), 60)}"`;
    })
    .join(", ");
}

export function summarize(kind: TaskDraftKind, payload: Record<string, unknown>, names: Names): string {
  let text: string;
  switch (kind) {
    case "create_task":
      text = `Create the task "${clip(String(payload.title ?? ""), 120)}"${payload.parent_task_id ? ` under ${names.task(String(payload.parent_task_id))}` : ""}${taskLine(payload, names)}`;
      break;
    case "create_subtasks": {
      const subs = Array.isArray(payload.subtasks) ? (payload.subtasks as Record<string, unknown>[]) : [];
      text = `Add ${subs.length} subtask${subs.length === 1 ? "" : "s"} to ${names.task(String(payload.parent_task_id))}: ${subs.map((s) => `"${clip(String(s.title ?? ""), 50)}"`).join(", ")}`;
      break;
    }
    case "update_task":
      text = `Change ${changeLine(asRecord(payload.changes))} on ${names.task(String(payload.id))}`;
      break;
    case "set_schedule":
      text = `Set ${changeLine(asRecord(payload.changes))} on ${names.task(String(payload.id))}`;
      break;
    case "change_status": {
      const reason = typeof payload.reason === "string" && payload.reason ? `: ${clip(payload.reason, 120)}` : "";
      text = `Mark ${names.task(String(payload.id))} as ${TASK_STATUS_LABELS[payload.status as TaskStatus] ?? payload.status}${reason}`;
      break;
    }
    case "assign_task":
      text = payload.assignee_id
        ? `Assign ${names.task(String(payload.id))} to ${names.person(String(payload.assignee_id))}`
        : `Move ${names.task(String(payload.id))} back to the team queue (no assignee)`;
      break;
    case "add_comment": {
      const mentions = Array.isArray(payload.mentions) && payload.mentions.length ? `, mentioning ${people(payload.mentions, names)}` : "";
      text = `Comment on ${names.task(String(payload.task_id))}: "${clip(String(payload.body ?? ""), 200)}"${mentions}`;
      break;
    }
  }
  return clip(text, 590);
}
