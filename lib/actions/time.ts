"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionCaller } from "@/lib/auth";
import { fail, PERMISSION_ERROR, type ActionResult } from "@/lib/errors";
import { canTrackTime, type Me } from "@/lib/permissions";
import {
  dailyLogSchema, deleteEntrySchema, manualEntrySchema, startTimerSchema, stopTimerSchema, timerNoteSchema, updateEntrySchema,
} from "@/lib/schemas/time";
import { createClient } from "@/utils/supabase/server";

// Time tracking and the daily log. The rules are in 0020 (ops.time_entry_guard, ops.daily_log_guard): who may
// log, the day window, the 24-hour cap, one running timer. These actions validate, write, and show the
// database's own message when it refuses.

function invalid(error: z.ZodError): { ok: false; error: string; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) (fieldErrors[issue.path.join(".") || "form"] ??= []).push(issue.message);
  return { ok: false, error: "Check the highlighted fields.", fieldErrors };
}

async function caller(): Promise<{ me: Me } | { ok: false; error: string }> {
  const c = await actionCaller();
  if ("error" in c) return { ok: false, error: c.error };
  if (!canTrackTime(c.me)) return { ok: false, error: PERMISSION_ERROR };
  return c;
}

function refresh(taskId?: string) {
  if (taskId) revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/timesheet");
  revalidatePath("/workload");
  revalidatePath("/", "layout");
}

export async function startTimer(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = startTimerSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("time_entry").insert({ task_id: parsed.data.task_id, source: "timer", work_date: "2000-01-01" });
  if (error) return fail(error, "startTimer");
  refresh(parsed.data.task_id);
  return { ok: true, data: undefined };
}

export async function stopTimer(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = stopTimerSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_entry")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .is("ended_at", null)
    .select("task_id")
    .maybeSingle();
  if (error) return fail(error, "stopTimer");
  if (!data) return { ok: false, error: "That timer is not running any more." };
  refresh(data.task_id);
  return { ok: true, data: undefined };
}

export async function setTimerNote(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = timerNoteSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.from("time_entry").update({ note: parsed.data.note }).eq("id", parsed.data.id).select("task_id").maybeSingle();
  if (error) return fail(error, "setTimerNote");
  if (!data) return { ok: false, error: PERMISSION_ERROR };
  refresh(data.task_id);
  return { ok: true, data: undefined };
}

export async function addTimeEntry(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = manualEntrySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase
    .from("time_entry")
    .insert({ task_id: parsed.data.task_id, source: "manual", work_date: parsed.data.work_date, minutes: parsed.data.minutes, note: parsed.data.note });
  if (error) return fail(error, "addTimeEntry");
  refresh(parsed.data.task_id);
  return { ok: true, data: undefined };
}

export async function updateTimeEntry(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = updateEntrySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_entry")
    .update({ work_date: parsed.data.work_date, minutes: parsed.data.minutes, note: parsed.data.note })
    .eq("id", parsed.data.id)
    .select("task_id")
    .maybeSingle();
  if (error) return fail(error, "updateTimeEntry");
  if (!data) return { ok: false, error: "Time can only be changed for 14 days after the day it was worked, and only by the person who logged it." };
  refresh(data.task_id);
  return { ok: true, data: undefined };
}

export async function deleteTimeEntry(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = deleteEntrySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.from("time_entry").delete().eq("id", parsed.data.id).select("task_id").maybeSingle();
  if (error) return fail(error, "deleteTimeEntry");
  if (!data) return { ok: false, error: "Time can only be removed for 14 days after the day it was worked, and only by the person who logged it." };
  refresh(data.task_id);
  return { ok: true, data: undefined };
}

/** One note per person per day: writing it again for the same day replaces the earlier one. */
export async function saveDailyLog(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = dailyLogSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("daily_log")
    .upsert({ staff_id: c.me.id, log_date: v.log_date, did: v.did, next_up: v.next_up, blockers: v.blockers }, { onConflict: "staff_id,log_date" });
  if (error) return fail(error, "saveDailyLog");
  revalidatePath("/");
  revalidatePath("/workload");
  return { ok: true, data: undefined };
}
