"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionCaller } from "@/lib/auth";
import { fail, PERMISSION_ERROR, type ActionResult } from "@/lib/errors";
import { canManageRecurrence, canWrite, type Me } from "@/lib/permissions";
import {
  deleteTaskViewSchema, notificationIdsSchema, recurrenceActiveSchema, recurrenceIdSchema, recurrenceSchema,
  saveTaskViewSchema, watcherSchema,
} from "@/lib/schemas/task";
import { createClient } from "@/utils/supabase/server";

// Watchers, notifications, fixed (recurring) tasks and saved views. The rules are in 0019; these actions
// validate, call the table or RPC, and show the database's own message when it refuses.

function invalid(error: z.ZodError): { ok: false; error: string; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) (fieldErrors[issue.path.join(".") || "form"] ??= []).push(issue.message);
  return { ok: false, error: "Check the highlighted fields.", fieldErrors };
}

async function caller(): Promise<{ me: Me } | { ok: false; error: string }> {
  const c = await actionCaller();
  return "error" in c ? { ok: false, error: c.error } : c;
}

// ---------------------------------------------------------------- Watchers

export async function addWatcher(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canWrite(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = watcherSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("task_watcher").insert({ task_id: parsed.data.task_id, staff_id: parsed.data.staff_id });
  if (error) return fail(error, "addWatcher");
  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true, data: undefined };
}

export async function removeWatcher(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = watcherSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_watcher")
    .delete()
    .eq("task_id", parsed.data.task_id)
    .eq("staff_id", parsed.data.staff_id)
    .select("task_id")
    .maybeSingle();
  if (error) return fail(error, "removeWatcher");
  if (!data) return { ok: false, error: "You can only remove yourself, unless you manage the task." };
  revalidatePath(`/tasks/${parsed.data.task_id}`);
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------- Notifications

/** Mark the given notifications (or all of mine) as read. RLS limits this to the recipient. */
export async function markNotificationsRead(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = notificationIdsSchema.safeParse(input ?? {});
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  let q = supabase.from("notification").update({ read_at: new Date().toISOString() }).eq("recipient_id", c.me.id).is("read_at", null);
  if (parsed.data.ids?.length) q = q.in("id", parsed.data.ids);
  const { error } = await q;
  if (error) return fail(error, "markNotificationsRead");
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function clearNotifications(): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const supabase = await createClient();
  const { error } = await supabase.from("notification").delete().eq("recipient_id", c.me.id).not("read_at", "is", null);
  if (error) return fail(error, "clearNotifications");
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/**
 * Creates the fixed tasks that are due and sends the due-today / overdue reminders. Idempotent, so it is safe
 * for every signed-in person to trigger it; the browser (components/task-automation.tsx) keeps itself to about
 * one run every 10 minutes. The action sets no cookie: a cookie write makes Next re-render the current page.
 * A scheduled job can call ops.run_task_automation() later with no change here.
 */
export async function runTaskAutomation(): Promise<ActionResult<{ created: number; reminders: number }>> {
  const c = await caller();
  if ("ok" in c) return c;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("run_task_automation");
  if (error) return fail(error, "runTaskAutomation");
  const r = (data ?? {}) as { created?: number; reminders?: number };
  return { ok: true, data: { created: r.created ?? 0, reminders: r.reminders ?? 0 } };
}

// ---------------------------------------------------------------- Fixed tasks

export async function saveRecurrence(input: unknown): Promise<ActionResult<{ id: string }>> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = recurrenceSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { id, ...v } = parsed.data;
  if (!canManageRecurrence(c.me, v.department)) {
    return { ok: false, error: "Only a founder or a lead of that department can set up fixed tasks for it." };
  }

  const row = {
    title: v.title,
    description: v.description,
    department: v.department,
    priority: v.priority,
    estimate_minutes: v.estimate_minutes,
    frequency: v.frequency,
    weekday: v.frequency === "weekly" ? v.weekday : null,
    month_day: v.frequency === "monthly" ? v.month_day : null,
    due_after_days: v.due_after_days ?? 0,
    due_time: v.due_time,
    starts_on: v.starts_on,
    ends_on: v.ends_on,
    all_department: v.all_department,
    staff_ids: v.all_department ? [] : v.staff_ids,
    active: v.active,
  };
  const supabase = await createClient();
  const res = id
    ? await supabase.from("task_recurrence").update(row).eq("id", id).select("id").maybeSingle()
    : await supabase.from("task_recurrence").insert(row).select("id").single();
  if (res.error) return fail(res.error, "saveRecurrence");
  if (!res.data) return { ok: false, error: "That fixed task was not found, or you don't have permission to change it." };
  revalidatePath("/tasks/fixed");
  return { ok: true, data: { id: res.data.id } };
}

export async function setRecurrenceActive(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = recurrenceActiveSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.from("task_recurrence").update({ active: parsed.data.active }).eq("id", parsed.data.id).select("id").maybeSingle();
  if (error) return fail(error, "setRecurrenceActive");
  if (!data) return { ok: false, error: PERMISSION_ERROR };
  revalidatePath("/tasks/fixed");
  return { ok: true, data: undefined };
}

export async function deleteRecurrence(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = recurrenceIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.from("task_recurrence").delete().eq("id", parsed.data.id).select("id").maybeSingle();
  if (error) return fail(error, "deleteRecurrence");
  if (!data) return { ok: false, error: PERMISSION_ERROR };
  revalidatePath("/tasks/fixed");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------- Saved views

export async function saveTaskView(input: unknown): Promise<ActionResult<{ id: string }>> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canWrite(c.me) || c.me.role === "partner") return { ok: false, error: PERMISSION_ERROR };
  const parsed = saveTaskViewSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_view")
    .insert({ name: parsed.data.name, query: parsed.data.query.replace(/^\?/, ""), shared: parsed.data.shared })
    .select("id")
    .single();
  if (error) return fail(error, "saveTaskView");
  revalidatePath("/tasks");
  return { ok: true, data: { id: data.id } };
}

export async function deleteTaskView(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = deleteTaskViewSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.from("task_view").delete().eq("id", parsed.data.id).select("id").maybeSingle();
  if (error) return fail(error, "deleteTaskView");
  if (!data) return { ok: false, error: "Only the person who saved a view can remove it." };
  revalidatePath("/tasks");
  return { ok: true, data: undefined };
}
