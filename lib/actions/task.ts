"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionCaller } from "@/lib/auth";
import { fail, PERMISSION_ERROR, type ActionResult } from "@/lib/errors";
import { canCreateTask, canWrite, type Me } from "@/lib/permissions";
import {
  assignTaskSchema, cancelTaskGroupSchema, createTaskSchema, deleteCommentSchema, scheduleTaskSchema, taskCommentSchema,
  taskIdSchema, taskOwnerSchema, taskStatusSchema, updateTaskGroupSchema, updateTaskSchema,
} from "@/lib/schemas/task";
import { createClient } from "@/utils/supabase/server";

// Task writes. Every rule (who may reassign, reopen or edit details; reasons for blocked/cancelled; subtask
// limits; history) lives in the database (0018, ops.task_guard). These actions validate, then show the
// database's own message when it refuses.

const NOT_FOUND = "That task was not found, or you don't have permission to change it.";

function invalid(error: z.ZodError): { ok: false; error: string; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) (fieldErrors[issue.path.join(".") || "form"] ??= []).push(issue.message);
  return { ok: false, error: "Check the highlighted fields.", fieldErrors };
}

// No area check: the tasks area is open to every internal role, and RLS plus the guard decide the rest.
async function caller(): Promise<{ me: Me } | { ok: false; error: string }> {
  const c = await actionCaller();
  return "error" in c ? { ok: false, error: c.error } : c;
}

function refresh(id?: string, parentId?: string | null) {
  revalidatePath("/tasks");
  if (id) revalidatePath(`/tasks/${id}`);
  if (parentId) revalidatePath(`/tasks/${parentId}`);
  revalidatePath("/");
  revalidatePath("/outreach");
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function parentOf(supabase: Supabase, id: string) {
  const { data } = await supabase.from("task").select("parent_task_id").eq("id", id).maybeSingle();
  return data?.parent_task_id ?? null;
}

/** One person gets one task; several people each get their own copy, linked as a group, all or nothing (ops.create_task_group),
 * or share one task that any of them can finish (ops.create_shared_task). */
export async function createTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canCreateTask(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const people = [...new Set([...(v.assignee_id ? [v.assignee_id] : []), ...v.also_assignee_ids])];
  if (people.length > 1 && (v.mode === "shared" || v.parent_task_id)) {
    const { data: id, error: sharedError } = await supabase.rpc("create_shared_task", {
      title: v.title,
      assignees: people,
      description: v.description ?? undefined,
      priority: v.priority,
      due_date: v.due_date ?? undefined,
      due_time: v.due_time ?? undefined,
      start_date: v.start_date ?? undefined,
      estimate_minutes: v.estimate_minutes ?? undefined,
      department: v.department ?? undefined,
      category: v.category ?? undefined,
      parent_task: v.parent_task_id ?? undefined,
    });
    if (sharedError) return fail(sharedError, "createSharedTask");
    if (!id) return { ok: false, error: "The task was not created. Try again." };
    refresh(id);
    return { ok: true, data: { id } };
  }
  if (people.length > 1) {
    const { data: ids, error: groupError } = await supabase.rpc("create_task_group", {
      title: v.title,
      assignees: people,
      description: v.description ?? undefined,
      priority: v.priority,
      due_date: v.due_date ?? undefined,
      due_time: v.due_time ?? undefined,
      start_date: v.start_date ?? undefined,
      estimate_minutes: v.estimate_minutes ?? undefined,
      department: v.department ?? undefined,
      category: v.category ?? undefined,
    });
    if (groupError) return fail(groupError, "createTaskGroup");
    const first = ids?.[0];
    if (!first) return { ok: false, error: "The tasks were not created. Try again." };
    refresh(first);
    return { ok: true, data: { id: first } };
  }

  const { data, error } = await supabase
    .from("task")
    .insert({
      title: v.title,
      description: v.description,
      department: v.department,
      category: v.category,
      assignee_id: v.assignee_id,
      start_date: v.start_date,
      due_date: v.due_date,
      due_time: v.due_time,
      priority: v.priority,
      estimate_minutes: v.estimate_minutes,
      parent_task_id: v.parent_task_id,
      entity_type: v.entity_type,
      entity_id: v.entity_id,
    })
    .select("id")
    .single();
  if (error) return fail(error, "createTask");
  refresh(data.id, v.parent_task_id);
  return { ok: true, data: { id: data.id } };
}

/** Title, description, department and schedule. The guard refuses the detail fields unless the caller manages the task. */
export async function updateTask(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canWrite(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { id, ...v } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task")
    .update({
      title: v.title,
      description: v.description,
      department: v.department,
      category: v.category,
      start_date: v.start_date,
      due_date: v.due_date,
      due_time: v.due_time,
      priority: v.priority,
      estimate_minutes: v.estimate_minutes,
    })
    .eq("id", id)
    .select("id, parent_task_id")
    .maybeSingle();
  if (error) return fail(error, "updateTask");
  if (!data) return { ok: false, error: NOT_FOUND };
  refresh(id, data.parent_task_id);
  return { ok: true, data: undefined };
}

/** Shared details (title, details, priority, department, category) for every open task in the group. Creator or founder only. */
export async function updateTaskGroup(input: unknown): Promise<ActionResult<{ updated: number }>> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canWrite(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = updateTaskGroupSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { id, ...v } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_task_group", {
    p_task: id,
    title: v.title,
    description: v.description ?? undefined,
    priority: v.priority,
    department: v.department ?? undefined,
    category: v.category ?? undefined,
  });
  if (error) return fail(error, "updateTaskGroup");
  refresh(id);
  return { ok: true, data: { updated: data ?? 0 } };
}

/** Cancel every open task of the group, with one reason. Finished tasks keep their record. */
export async function cancelTaskGroup(input: unknown): Promise<ActionResult<{ cancelled: number }>> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canWrite(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = cancelTaskGroupSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_task_group", { p_task: parsed.data.id, p_reason: parsed.data.reason });
  if (error) return fail(error, "cancelTaskGroup");
  refresh(parsed.data.id);
  return { ok: true, data: { cancelled: data ?? 0 } };
}

/** Start, deadline, priority and estimate only: what the assignee may change on their own task. */
export async function scheduleTask(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canWrite(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = scheduleTaskSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { id, ...v } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task")
    .update({ start_date: v.start_date, due_date: v.due_date, due_time: v.due_time, priority: v.priority, estimate_minutes: v.estimate_minutes })
    .eq("id", id)
    .select("id, parent_task_id")
    .maybeSingle();
  if (error) return fail(error, "scheduleTask");
  if (!data) return { ok: false, error: NOT_FOUND };
  refresh(id, data.parent_task_id);
  return { ok: true, data: undefined };
}

/** Assign, reassign, claim (assignee = me) or release to the queue (null). The guard decides who may. */
export async function assignTask(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canWrite(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = assignTaskSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task")
    .update({ assignee_id: parsed.data.assignee_id })
    .eq("id", parsed.data.id)
    .select("id, parent_task_id")
    .maybeSingle();
  if (error) return fail(error, "assignTask");
  if (!data) return { ok: false, error: NOT_FOUND };
  refresh(data.id, data.parent_task_id);
  return { ok: true, data: undefined };
}

export async function acceptTask(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canWrite(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = taskIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .select("id, parent_task_id")
    .maybeSingle();
  if (error) return fail(error, "acceptTask");
  if (!data) return { ok: false, error: NOT_FOUND };
  refresh(data.id, data.parent_task_id);
  return { ok: true, data: undefined };
}

/** Move a task along its status path. Blocked and cancelled carry a reason; the database clears it when the status moves on. */
export async function changeTaskStatus(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canWrite(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = taskStatusSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { id, status, reason } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task")
    .update({
      status,
      blocked_reason: status === "blocked" ? reason : null,
      cancel_reason: status === "cancelled" ? reason : null,
    })
    .eq("id", id)
    .select("id, parent_task_id")
    .maybeSingle();
  if (error) return fail(error, "changeTaskStatus");
  if (!data) return { ok: false, error: NOT_FOUND };
  refresh(id, data.parent_task_id);
  return { ok: true, data: undefined };
}

export async function deleteTask(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = taskIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const parent = await parentOf(supabase, parsed.data.id);
  const { data, error } = await supabase.from("task").delete().eq("id", parsed.data.id).select("id").maybeSingle();
  if (error) return fail(error, "deleteTask");
  if (!data) return { ok: false, error: "That task was not found, or only a department lead or founder can delete it." };
  refresh(undefined, parent);
  return { ok: true, data: undefined };
}

export async function addTaskComment(input: unknown): Promise<ActionResult<{ id: string }>> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canWrite(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = taskCommentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_comment").insert({ task_id: parsed.data.task_id, body: parsed.data.body, mentions: parsed.data.mentions }).select("id").single();
  if (error) return fail(error, "addTaskComment");
  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true, data: { id: data.id } };
}

export async function deleteTaskComment(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = deleteCommentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.from("task_comment").delete().eq("id", parsed.data.id).select("id").maybeSingle();
  if (error) return fail(error, "deleteTaskComment");
  if (!data) return { ok: false, error: "Only the author or a founder can remove a comment." };
  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true, data: undefined };
}

/** Add a person to a shared task. Its creator, a department lead or a founder (ops.add_task_owner). */
export async function addTaskOwner(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canWrite(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = taskOwnerSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_task_owner", { p_task: parsed.data.task_id, p_staff: parsed.data.staff_id });
  if (error) return fail(error, "addTaskOwner");
  refresh(parsed.data.task_id);
  return { ok: true, data: undefined };
}

/** Take a person off a shared task. A shared task keeps at least two owners (ops.remove_task_owner). */
export async function removeTaskOwner(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canWrite(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = taskOwnerSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_task_owner", { p_task: parsed.data.task_id, p_staff: parsed.data.staff_id });
  if (error) return fail(error, "removeTaskOwner");
  refresh(parsed.data.task_id);
  return { ok: true, data: undefined };
}
