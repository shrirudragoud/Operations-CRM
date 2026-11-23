"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionCaller } from "@/lib/auth";
import { fail, GENERIC_ERROR, PERMISSION_ERROR, type ActionResult } from "@/lib/errors";
import { BUCKET, discardFiles, filesPayload, prepareFiles, storeFiles } from "@/lib/request-uploads";
import { messageSchema, requestSchema, requireMessage, startOnboardingSchema, stateSchema, templateSchema } from "@/lib/schemas/hr-requests";
import { createClient } from "@/utils/supabase/server";

const SIGNED_URL_SECONDS = 60;

const first = (e: z.ZodError) => e.issues[0]?.message ?? "Check the highlighted fields.";

function refresh(...paths: string[]) {
  for (const p of paths) revalidatePath(p);
}

function formFields(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

// The form carries the request fields and any files. Files go to the private bucket first, then the database
// writes the request and the file list in one step; if that fails the uploads are removed again.
export async function createHrRequest(form: FormData): Promise<ActionResult<{ id: string }>> {
  const c = await actionCaller("me");
  if ("error" in c) return { ok: false, error: c.error };
  const p = requestSchema.safeParse(formFields(form));
  if (!p.success) return { ok: false, error: first(p.error) };
  const up = await prepareFiles(form, c.me.id);
  if ("error" in up) return { ok: false, error: up.error };

  const supabase = await createClient();
  const stored = await storeFiles(supabase, up.files);
  if (stored) return { ok: false, error: stored };
  const { data, error } = await supabase.rpc("create_hr_request", {
    p_kind: p.data.kind, p_subject: p.data.subject, p_details: p.data.details, p_files: filesPayload(up.files),
  });
  if (error) {
    await discardFiles(supabase, up.files);
    return fail(error, "createHrRequest");
  }
  refresh("/me/requests", "/hr/requests");
  return { ok: true, data: { id: data } };
}

// A reply from either side, with files. HR can also keep a copy on the person's record and finish the request with it.
export async function addRequestMessage(form: FormData): Promise<ActionResult> {
  const c = await actionCaller("me");
  if ("error" in c) return { ok: false, error: c.error };
  const raw = formFields(form);
  const p = messageSchema.safeParse({
    request_id: raw.request_id, body: raw.body ?? "",
    internal: raw.internal === "true", keep_copy: raw.keep_copy === "true", finish: raw.finish === "true",
  });
  if (!p.success) return { ok: false, error: first(p.error) };

  const supabase = await createClient();
  // The files live in the requester's folder, whoever sends them.
  const { data: request } = await supabase.from("hr_request").select("staff_id").eq("id", p.data.request_id).maybeSingle();
  if (!request) return { ok: false, error: "That request does not exist." };
  const up = await prepareFiles(form, request.staff_id);
  if ("error" in up) return { ok: false, error: up.error };
  const missing = requireMessage(p.data.body, up.files.length);
  if (missing) return { ok: false, error: missing };

  const stored = await storeFiles(supabase, up.files);
  if (stored) return { ok: false, error: stored };
  const { error } = await supabase.rpc("add_hr_request_message", {
    p_request: p.data.request_id, p_body: p.data.body, p_internal: p.data.internal,
    p_files: filesPayload(up.files), p_keep_copy: p.data.keep_copy, p_finish: p.data.finish,
  });
  if (error) {
    await discardFiles(supabase, up.files);
    return fail(error, "addRequestMessage");
  }
  refresh("/me/requests", "/hr/requests", "/me/documents", "/hr/documents");
  return { ok: true, data: undefined };
}

// The database logs an HR person opening someone else's file, and only then does the Storage policy let them read it.
export async function openRequestFile(id: unknown): Promise<ActionResult<{ url: string }>> {
  const c = await actionCaller("me");
  if ("error" in c) return { ok: false, error: c.error };
  const p = z.uuid().safeParse(id);
  if (!p.success) return { ok: false, error: "That file does not exist." };
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("open_request_file", { p_file: p.data });
  if (error) return fail(error, "openRequestFile");
  const { data, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (signError || !data) {
    console.error(JSON.stringify({ level: "error", context: "openRequestFile", message: signError?.message }));
    return { ok: false, error: GENERIC_ERROR };
  }
  return { ok: true, data: { url: data.signedUrl } };
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
