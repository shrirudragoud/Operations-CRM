"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionCaller } from "@/lib/auth";
import { fail, PERMISSION_ERROR, type ActionResult } from "@/lib/errors";
import { canTakeLeave } from "@/lib/leave";
import { isHr, type Me } from "@/lib/permissions";
import { adjustSchema, applySchema, decideSchema, holidaySchema, idSchema, leaveTypeSchema } from "@/lib/schemas/leave";
import { createClient } from "@/utils/supabase/server";

// Leave (0032). Every change goes through a database function that decides who may do what and says why when it refuses
// (apply_leave, decide_leave, cancel_leave, hr_adjust_balance); the leave policy and holidays are plain writes that RLS limits to HR.

function invalid(error: z.ZodError): { ok: false; error: string; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) (fieldErrors[issue.path.join(".") || "form"] ??= []).push(issue.message);
  return { ok: false, error: "Check the highlighted fields.", fieldErrors };
}

async function caller(need: "any" | "applicant" | "hr" = "any"): Promise<{ me: Me } | { ok: false; error: string }> {
  const c = await actionCaller();
  if ("error" in c) return { ok: false, error: c.error };
  if (need === "applicant" && !canTakeLeave(c.me)) return { ok: false, error: PERMISSION_ERROR };
  if (need === "hr" && !isHr(c.me)) return { ok: false, error: PERMISSION_ERROR };
  return c;
}

function refresh() {
  revalidatePath("/me/leave");
  revalidatePath("/hr/leave");
  revalidatePath("/me/attendance");
  revalidatePath("/attendance");
  revalidatePath("/", "layout");
}

/** Apply for leave. With `staff_id`, HR records it for someone else and it is approved at once. */
export async function applyForLeave(input: unknown): Promise<ActionResult> {
  const c = await caller("applicant");
  if ("ok" in c) return c;
  const p = applySchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).rpc("apply_leave", {
    p_type: p.data.leave_type_id, p_from: p.data.from_date, p_to: p.data.to_date, p_part: p.data.day_part, p_reason: p.data.reason,
    ...(p.data.staff_id ? { p_staff: p.data.staff_id } : {}),
  });
  if (error) return fail(error, "applyForLeave");
  refresh();
  return { ok: true, data: undefined };
}

export async function decideLeave(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const p = decideSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).rpc("decide_leave", { p_id: p.data.id, p_approve: p.data.approve, p_note: p.data.note ?? undefined });
  if (error) return fail(error, "decideLeave");
  refresh();
  return { ok: true, data: undefined };
}

export async function cancelLeave(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const p = idSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).rpc("cancel_leave", { p_id: p.data.id });
  if (error) return fail(error, "cancelLeave");
  refresh();
  return { ok: true, data: undefined };
}

export async function adjustBalance(input: unknown): Promise<ActionResult> {
  const c = await caller("hr");
  if ("ok" in c) return c;
  const p = adjustSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).rpc("hr_adjust_balance", {
    p_staff: p.data.staff_id, p_type: p.data.leave_type_id, p_year: p.data.year, p_days: p.data.days, p_note: p.data.note,
  });
  if (error) return fail(error, "adjustBalance");
  refresh();
  return { ok: true, data: undefined };
}

export async function startLeaveYear(input: unknown): Promise<ActionResult<{ people: number }>> {
  const c = await caller("hr");
  if ("ok" in c) return c;
  const p = z.object({ year: z.coerce.number().int().min(2000).max(2200) }).safeParse(input);
  if (!p.success) return { ok: false, error: "Pick a year." };
  const { data, error } = await (await createClient()).rpc("credit_annual_quota", { p_year: p.data.year });
  if (error) return fail(error, "startLeaveYear");
  refresh();
  return { ok: true, data: { people: Number(data ?? 0) } };
}

// ---------------------------------------------------------------- the policy (HR)

/** Create a leave type, or save changes to one (when `id` is given). The code is fixed once the type exists. */
export async function saveLeaveType(input: unknown): Promise<ActionResult> {
  const c = await caller("hr");
  if ("ok" in c) return c;
  const p = leaveTypeSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { id, code, ...fields } = p.data;
  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase.from("leave_type").update(fields).eq("id", id).select("id").maybeSingle();
    if (error) return error.code === "23505" ? { ok: false, error: "A leave type with that name already exists." } : fail(error, "saveLeaveType");
    if (!data) return { ok: false, error: PERMISSION_ERROR };
  } else {
    const made = code?.length ? code : fields.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
    if (!/^[a-z][a-z0-9_]{1,23}$/.test(made)) return { ok: false, error: "Check the highlighted fields.", fieldErrors: { name: ["Start the name with a letter."] } };
    const { error } = await supabase.from("leave_type").insert({ ...fields, code: made });
    if (error) return error.code === "23505" ? { ok: false, error: "A leave type with that name or code already exists." } : fail(error, "saveLeaveType");
  }
  refresh();
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------- holidays (HR)

export async function addLeaveHoliday(input: unknown): Promise<ActionResult> {
  const c = await caller("hr");
  if ("ok" in c) return c;
  const p = holidaySchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).from("office_holiday").insert(p.data);
  if (error) return error.code === "23505" ? { ok: false, error: "That day is already a holiday." } : fail(error, "addLeaveHoliday");
  refresh();
  return { ok: true, data: undefined };
}

export async function removeLeaveHoliday(input: unknown): Promise<ActionResult> {
  const c = await caller("hr");
  if ("ok" in c) return c;
  const p = idSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const { error } = await (await createClient()).from("office_holiday").delete().eq("id", p.data.id);
  if (error) return fail(error, "removeLeaveHoliday");
  refresh();
  return { ok: true, data: undefined };
}
