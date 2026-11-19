"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionCaller } from "@/lib/auth";
import { fail, PERMISSION_ERROR, type ActionResult } from "@/lib/errors";
import { isFounder, type Me } from "@/lib/permissions";
import {
  clearMarkSchema, correctSchema, decideSchema, excuseSchema, holidaySchema, idSchema, networkActiveSchema, networkSchema,
  modeSchema, remoteSchema, requestSchema, settingsSchema, tagSchema,
} from "@/lib/schemas/attendance";
import { createClient } from "@/utils/supabase/server";

// Attendance (0023). Checking in and out are NOT here: they must run in the browser so the database sees the
// person's own network address (components/attendance-controls.tsx). Everything else goes through these actions;
// the database decides who may do what and says why when it refuses.

function invalid(error: z.ZodError): { ok: false; error: string; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) (fieldErrors[issue.path.join(".") || "form"] ??= []).push(issue.message);
  return { ok: false, error: "Check the highlighted fields.", fieldErrors };
}

async function caller(founderOnly = false): Promise<{ me: Me } | { ok: false; error: string }> {
  const c = await actionCaller("attendance");
  if ("error" in c) return { ok: false, error: c.error };
  if (founderOnly && !isFounder(c.me)) return { ok: false, error: PERMISSION_ERROR };
  return c;
}

function refresh() {
  revalidatePath("/attendance");
  revalidatePath("/", "layout");
}

export async function requestAttendance(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const p = requestSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).rpc("request_attendance", {
    p_date: p.data.work_date, p_in: p.data.in_time, p_out: p.data.out_time, p_reason: p.data.reason,
  });
  if (error) return fail(error, "requestAttendance");
  refresh();
  return { ok: true, data: undefined };
}

export async function decideRequest(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const p = decideSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).rpc("decide_attendance_request", {
    p_id: p.data.id, p_approve: p.data.approve, p_note: p.data.note ?? undefined,
  });
  if (error) return fail(error, "decideRequest");
  refresh();
  return { ok: true, data: undefined };
}

export async function correctCheckout(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const p = correctSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).rpc("correct_checkout", {
    p_session: p.data.session_id, p_out: `${p.data.work_date}T${p.data.out_time}:00+05:30`, p_note: p.data.note,
  });
  if (error) return fail(error, "correctCheckout");
  refresh();
  return { ok: true, data: undefined };
}

export async function declareRemote(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const p = remoteSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).rpc("declare_remote", { p_date: p.data.date, p_reason: p.data.reason });
  if (error) return fail(error, "declareRemote");
  refresh();
  return { ok: true, data: undefined };
}

export async function excuseDay(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const p = excuseSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).rpc("excuse_day", { p_staff: p.data.staff_id, p_date: p.data.date, p_reason: p.data.reason });
  if (error) return fail(error, "excuseDay");
  refresh();
  return { ok: true, data: undefined };
}

export async function clearDayMark(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const p = clearMarkSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).rpc("clear_day_mark", { p_staff: p.data.staff_id, p_date: p.data.date });
  if (error) return fail(error, "clearDayMark");
  refresh();
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------- founder: the tag, hours, holidays, networks

export async function setWorksFromOffice(input: unknown): Promise<ActionResult> {
  const c = await actionCaller("team");
  if ("error" in c) return { ok: false, error: c.error };
  const p = tagSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { data, error } = await (await createClient())
    .from("staff").update({ works_from_office: p.data.works_from_office }).eq("id", p.data.staff_id).select("id").maybeSingle();
  if (error) return fail(error, "setWorksFromOffice");
  if (!data) return { ok: false, error: PERMISSION_ERROR };
  revalidatePath("/team");
  refresh();
  return { ok: true, data: undefined };
}

export async function setAttendanceMode(input: unknown): Promise<ActionResult> {
  const c = await actionCaller("team");
  if ("error" in c) return { ok: false, error: c.error };
  const p = modeSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { data, error } = await (await createClient())
    .from("staff").update({ attendance_mode: p.data.attendance_mode }).eq("id", p.data.staff_id).select("id").maybeSingle();
  if (error) return fail(error, "setAttendanceMode");
  if (!data) return { ok: false, error: PERMISSION_ERROR };
  revalidatePath("/team");
  refresh();
  return { ok: true, data: undefined };
}

export async function saveOfficeSettings(input: unknown): Promise<ActionResult> {
  const c = await caller(true);
  if ("ok" in c) return c;
  const p = settingsSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { data, error } = await (await createClient())
    .from("office_settings")
    .update({ ...p.data, work_days: [...p.data.work_days].sort() })
    .eq("id", true)
    .select("id")
    .maybeSingle();
  if (error) return fail(error, "saveOfficeSettings");
  if (!data) return { ok: false, error: PERMISSION_ERROR };
  refresh();
  return { ok: true, data: undefined };
}

export async function addHoliday(input: unknown): Promise<ActionResult> {
  const c = await caller(true);
  if ("ok" in c) return c;
  const p = holidaySchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).from("office_holiday").insert(p.data);
  if (error) return error.code === "23505" ? { ok: false, error: "That day is already a holiday." } : fail(error, "addHoliday");
  refresh();
  return { ok: true, data: undefined };
}

export async function removeHoliday(input: unknown): Promise<ActionResult> {
  const c = await caller(true);
  if ("ok" in c) return c;
  const p = idSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).from("office_holiday").delete().eq("id", p.data.id);
  if (error) return fail(error, "removeHoliday");
  refresh();
  return { ok: true, data: undefined };
}

export async function addNetwork(input: unknown): Promise<ActionResult> {
  const c = await caller(true);
  if ("ok" in c) return c;
  const p = networkSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).from("office_network").insert({ label: p.data.label, cidr: p.data.cidr });
  if (error) return error.code === "22P02" || error.code === "22P04" ? { ok: false, error: "That isn't a valid address or range." } : fail(error, "addNetwork");
  refresh();
  return { ok: true, data: undefined };
}

export async function setNetworkActive(input: unknown): Promise<ActionResult> {
  const c = await caller(true);
  if ("ok" in c) return c;
  const p = networkActiveSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).from("office_network").update({ is_active: p.data.is_active }).eq("id", p.data.id);
  if (error) return fail(error, "setNetworkActive");
  refresh();
  return { ok: true, data: undefined };
}

export async function removeNetwork(input: unknown): Promise<ActionResult> {
  const c = await caller(true);
  if ("ok" in c) return c;
  const p = idSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).from("office_network").delete().eq("id", p.data.id);
  if (error) return fail(error, "removeNetwork");
  refresh();
  return { ok: true, data: undefined };
}

/** After the browser called ops.trust_this_network (it must run there to see the founder's own address). */
export async function refreshAttendance(): Promise<void> {
  const c = await caller(true);
  if ("ok" in c) return;
  refresh();
}
