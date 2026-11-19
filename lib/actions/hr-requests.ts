"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionCaller } from "@/lib/auth";
import { fail, PERMISSION_ERROR, type ActionResult } from "@/lib/errors";
import { messageSchema, requestSchema, startOnboardingSchema, stateSchema, templateSchema } from "@/lib/schemas/hr-requests";
import { createClient } from "@/utils/supabase/server";

const first = (e: z.ZodError) => e.issues[0]?.message ?? "Check the highlighted fields.";

function refresh(...paths: string[]) {
  for (const p of paths) revalidatePath(p);
}

export async function createHrRequest(input: unknown): Promise<ActionResult<{ id: string }>> {
  const c = await actionCaller("me");
  if ("error" in c) return { ok: false, error: c.error };
  const p = requestSchema.safeParse(input);
  if (!p.success) return { ok: false, error: first(p.error) };
  const { data, error } = await (await createClient()).rpc("create_hr_request", {
    p_kind: p.data.kind, p_subject: p.data.subject, p_details: p.data.details,
  });
  if (error) return fail(error, "createHrRequest");
  refresh("/me/requests", "/hr/requests");
  return { ok: true, data: { id: data } };
}

export async function addRequestMessage(input: unknown): Promise<ActionResult> {
  const c = await actionCaller("me");
  if ("error" in c) return { ok: false, error: c.error };
  const p = messageSchema.safeParse(input);
  if (!p.success) return { ok: false, error: first(p.error) };
  const { error } = await (await createClient()).rpc("add_hr_request_message", {
    p_request: p.data.request_id, p_body: p.data.body, p_internal: p.data.internal,
  });
  if (error) return fail(error, "addRequestMessage");
  refresh("/me/requests", "/hr/requests");
  return { ok: true, data: undefined };
}

export async function setRequestState(input: unknown): Promise<ActionResult> {
  const c = await actionCaller("hr");
  if ("error" in c) return { ok: false, error: c.error };
  const p = stateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: first(p.error) };
  const { error } = await (await createClient()).rpc("set_hr_request_state", {
    p_request: p.data.request_id, p_state: p.data.state, ...(p.data.note ? { p_note: p.data.note } : {}),
  });
  if (error) return fail(error, "setRequestState");
  refresh("/me/requests", "/hr/requests");
  return { ok: true, data: undefined };
}

export async function startOnboarding(input: unknown): Promise<ActionResult<{ items: number }>> {
  const c = await actionCaller("hr");
  if ("error" in c) return { ok: false, error: c.error };
  const p = startOnboardingSchema.safeParse(input);
  if (!p.success) return { ok: false, error: first(p.error) };
  const { data, error } = await (await createClient()).rpc("start_onboarding", {
    p_staff: p.data.staff_id, p_kind: p.data.kind, ...(p.data.date ? { p_date: p.data.date } : {}),
  });
  if (error) return fail(error, "startOnboarding");
  refresh("/hr/onboarding", "/me/requests");
  return { ok: true, data: { items: data } };
}

// The person ticks their own items, the assignee theirs, HR anything; the database decides which.
export async function setOnboardingTask(input: unknown): Promise<ActionResult> {
  const c = await actionCaller("me");
  if ("error" in c) return { ok: false, error: c.error };
  const p = z.object({ task_id: z.uuid(), done: z.boolean() }).safeParse(input);
  if (!p.success) return { ok: false, error: first(p.error) };
  const { error } = await (await createClient()).rpc("set_onboarding_task", { p_task: p.data.task_id, p_done: p.data.done });
  if (error) return fail(error, "setOnboardingTask");
  refresh("/hr/onboarding", "/me/requests");
  return { ok: true, data: undefined };
}

export async function addTemplateItem(input: unknown): Promise<ActionResult> {
  const c = await actionCaller("hr");
  if ("error" in c) return { ok: false, error: c.error };
  const p = templateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: first(p.error) };
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("onboarding_template").select("position").eq("kind", p.data.kind).order("position", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("onboarding_template").insert({
    kind: p.data.kind, title: p.data.title, detail: p.data.detail || null, owner: p.data.owner,
    due_offset: p.data.due_offset, position: (last?.position ?? 0) + 10,
  });
  if (error) return fail(error, "addTemplateItem");
  refresh("/hr/onboarding");
  return { ok: true, data: undefined };
}

export async function setTemplateActive(input: unknown): Promise<ActionResult> {
  const c = await actionCaller("hr");
  if ("error" in c) return { ok: false, error: c.error };
  const p = z.object({ id: z.uuid(), is_active: z.boolean() }).safeParse(input);
  if (!p.success) return { ok: false, error: first(p.error) };
  const { data, error } = await (await createClient())
    .from("onboarding_template").update({ is_active: p.data.is_active }).eq("id", p.data.id).select("id").maybeSingle();
  if (error) return fail(error, "setTemplateActive");
  if (!data) return { ok: false, error: PERMISSION_ERROR };
  refresh("/hr/onboarding");
  return { ok: true, data: undefined };
}

export async function deleteTemplateItem(id: unknown): Promise<ActionResult> {
  const c = await actionCaller("hr");
  if ("error" in c) return { ok: false, error: c.error };
  const p = z.uuid().safeParse(id);
  if (!p.success) return { ok: false, error: "That step does not exist." };
  const { data, error } = await (await createClient()).from("onboarding_template").delete().eq("id", p.data).select("id").maybeSingle();
  if (error) return fail(error, "deleteTemplateItem");
  if (!data) return { ok: false, error: PERMISSION_ERROR };
  refresh("/hr/onboarding");
  return { ok: true, data: undefined };
}
