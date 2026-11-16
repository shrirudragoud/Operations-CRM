"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionCaller } from "@/lib/auth";
import { fail, PERMISSION_ERROR, type ActionResult } from "@/lib/errors";
import { canLogActivity, canUpdateTask, type Me } from "@/lib/permissions";
import { activitySchema, happenedAtFor, setTaskStatusSchema } from "@/lib/schemas/activity";
import { cleanSearch } from "@/lib/schemas/institution";
import { createClient } from "@/utils/supabase/server";

// Outreach writes. Logging an activity is a plain insert: the on_activity trigger moves the
// institution's stage, opens the Workshop deal on "qualified" and creates the follow-up task, so
// this file never touches stage, deals or tasks for that (docs/BUSINESS_RULES.md).

const NOT_FOUND = "That record was not found, or you don't have permission to change it.";

function invalid(error: z.ZodError): { ok: false; error: string; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) (fieldErrors[issue.path.join(".") || "form"] ??= []).push(issue.message);
  return { ok: false, error: "Check the highlighted fields.", fieldErrors };
}

async function caller(area?: "outreach"): Promise<{ me: Me } | { ok: false; error: string }> {
  const c = await actionCaller(area);
  return "error" in c ? { ok: false, error: c.error } : c;
}

export type LoggedActivity = { id: string; dealCreated: boolean; followUpCreated: boolean };

export async function logActivity(input: unknown): Promise<ActionResult<LoggedActivity>> {
  const c = await caller("outreach");
  if ("ok" in c) return c;
  if (!canLogActivity(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  // RLS hides institutions a partner does not own, so this also stops a partner logging elsewhere.
  const { data: inst, error: instError } = await supabase
    .from("institution")
    .select("id, archived_at")
    .eq("id", v.institution_id)
    .maybeSingle();
  if (instError) return fail(instError, "logActivity.institution");
  if (!inst) return { ok: false, error: NOT_FOUND };
  if (inst.archived_at) return { ok: false, error: "This institution is archived. Restore it before logging activity." };

  if (v.contact_id) {
    const { data: contact, error } = await supabase
      .from("contact")
      .select("id")
      .eq("id", v.contact_id)
      .eq("institution_id", v.institution_id)
      .maybeSingle();
    if (error) return fail(error, "logActivity.contact");
    if (!contact) return { ok: false, error: "That contact does not belong to this institution.", fieldErrors: { contact_id: ["Choose a contact from this institution."] } };
  }

  const happenedAt = happenedAtFor(v.happened_on);
  const { data, error } = await supabase
    .from("activity")
    .insert({
      institution_id: v.institution_id,
      contact_id: v.contact_id,
      kind: v.kind,
      outcome: v.outcome,
      notes: v.notes,
      next_step: v.next_step,
      next_step_due: v.next_step_due,
      ...(happenedAt ? { happened_at: happenedAt } : {}),
    })
    .select("id")
    .single();
  if (error) return fail(error, "logActivity");

  revalidatePath("/outreach");
  revalidatePath("/institutions");
  revalidatePath(`/institutions/${v.institution_id}`);
  revalidatePath("/tasks");
  revalidatePath("/");
  if (v.outcome === "qualified") revalidatePath("/sales");
  return {
    ok: true,
    data: { id: data.id, dealCreated: v.outcome === "qualified", followUpCreated: !!(v.next_step && v.next_step_due) },
  };
}

export type InstitutionOption = { id: string; name: string; city: string | null; stage: string };

/** Type-ahead for the institution picker. Archived rows are left out; RLS limits a partner to their own. */
export async function searchInstitutions(q: string): Promise<ActionResult<InstitutionOption[]>> {
  const c = await caller("outreach");
  if ("ok" in c) return c;
  const term = cleanSearch(typeof q === "string" ? q : "");
  const supabase = await createClient();
  let query = supabase.from("institution").select("id, name, city, stage").is("archived_at", null);
  if (term) query = query.or(`name.ilike.*${term}*,city.ilike.*${term}*`);
  const { data, error } = await query.order("name").limit(10);
  if (error) return fail(error, "searchInstitutions");
  return { ok: true, data };
}

export async function setTaskStatus(input: unknown): Promise<ActionResult> {
  // No area check: canUpdateTask + RLS decide (a partner may finish a follow-up assigned to them).
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = setTaskStatusSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data: task, error: readError } = await supabase
    .from("task")
    .select("department, assignee_id")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (readError) return fail(readError, "setTaskStatus.read");
  if (!task) return { ok: false, error: NOT_FOUND };
  if (!canUpdateTask(c.me, task)) return { ok: false, error: PERMISSION_ERROR };

  const { data, error } = await supabase
    .from("task")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error, "setTaskStatus");
  if (!data) return { ok: false, error: NOT_FOUND };
  revalidatePath("/outreach");
  revalidatePath("/tasks");
  revalidatePath("/");
  return { ok: true, data: undefined };
}
