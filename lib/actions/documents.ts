"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionCaller } from "@/lib/auth";
import { fail, GENERIC_ERROR, type ActionResult } from "@/lib/errors";
import {
  checkUpload, hrDocumentSchema, ownDocumentSchema, publishSchema, safeFileName, verifySchema,
} from "@/lib/schemas/documents";
import { createClient } from "@/utils/supabase/server";

const BUCKET = "hr-docs";
const SIGNED_URL_SECONDS = 60;

type Supabase = Awaited<ReturnType<typeof createClient>>;

function fields(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

// Checks the type, size and real content of an upload, and gives it a path the database accepts.
async function prepareUpload(form: FormData, folder: string): Promise<{ file: File; mime: string; path: string } | { error: string }> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const check = checkUpload(file, head);
  if (!check.ok) return { error: check.error };
  return { file, mime: check.mime, path: `${folder}/${crypto.randomUUID()}-${safeFileName(file.name, check.ext)}` };
}

async function store(supabase: Supabase, path: string, file: File, mime: string): Promise<string | null> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false });
  if (!error) return null;
  console.error(JSON.stringify({ level: "error", context: "documents.store", message: error.message }));
  return "The file could not be saved. Try again.";
}

async function discard(supabase: Supabase, path: string) {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.error(JSON.stringify({ level: "error", context: "documents.discard", message: error.message }));
}

// A person adds their own paper. The Storage policy keeps them in their own folder; the RPC checks the kind.
export async function uploadMyDocument(form: FormData): Promise<ActionResult> {
  const c = await actionCaller("me");
  if ("error" in c) return { ok: false, error: c.error };
  const p = ownDocumentSchema.safeParse(fields(form));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the highlighted fields." };
  const up = await prepareUpload(form, c.me.id);
  if ("error" in up) return { ok: false, error: up.error };

  const supabase = await createClient();
  const stored = await store(supabase, up.path, up.file, up.mime);
  if (stored) return { ok: false, error: stored };
  const { error } = await supabase.rpc("add_staff_document", {
    p_staff: c.me.id, p_kind: p.data.kind, p_title: p.data.title, p_path: up.path, p_mime: up.mime, p_size: up.file.size,
    ...(p.data.expires_on ? { p_expires: p.data.expires_on } : {}),
  });
  if (error) {
    await discard(supabase, up.path);
    return fail(error, "uploadMyDocument");
  }
  revalidatePath("/me/documents");
  return { ok: true, data: undefined };
}

// HR adds a paper to someone else's record, including the kinds only HR may add (offer letter, contract, payslip).
export async function uploadStaffDocument(form: FormData): Promise<ActionResult> {
  const c = await actionCaller("hr");
  if ("error" in c) return { ok: false, error: c.error };
  const p = hrDocumentSchema.safeParse(fields(form));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the highlighted fields." };
  const up = await prepareUpload(form, p.data.staff_id);
  if ("error" in up) return { ok: false, error: up.error };

  const supabase = await createClient();
  const stored = await store(supabase, up.path, up.file, up.mime);
  if (stored) return { ok: false, error: stored };
  const { error } = await supabase.rpc("add_staff_document", {
    p_staff: p.data.staff_id, p_kind: p.data.kind, p_title: p.data.title, p_path: up.path, p_mime: up.mime, p_size: up.file.size,
    ...(p.data.expires_on ? { p_expires: p.data.expires_on } : {}),
  });
  if (error) {
    await discard(supabase, up.path);
    return fail(error, "uploadStaffDocument");
  }
  revalidatePath("/hr/documents");
  revalidatePath("/me/documents");
  return { ok: true, data: undefined };
}

// The database logs an HR person opening someone else's paper, and only then does the Storage policy let them read it.
export async function openStaffDocument(id: unknown): Promise<ActionResult<{ url: string }>> {
  const c = await actionCaller("me");
  if ("error" in c) return { ok: false, error: c.error };
  const p = z.uuid().safeParse(id);
  if (!p.success) return { ok: false, error: "That document does not exist." };
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("open_staff_document", { p_id: p.data });
  if (error) return fail(error, "openStaffDocument");
  const { data, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (signError || !data) {
    console.error(JSON.stringify({ level: "error", context: "openStaffDocument", message: signError?.message }));
    return { ok: false, error: GENERIC_ERROR };
  }
  revalidatePath("/hr");
  return { ok: true, data: { url: data.signedUrl } };
}

export async function deleteStaffDocument(id: unknown): Promise<ActionResult> {
  const c = await actionCaller("me");
  if ("error" in c) return { ok: false, error: c.error };
  const p = z.uuid().safeParse(id);
  if (!p.success) return { ok: false, error: "That document does not exist." };
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("delete_staff_document", { p_id: p.data });
  if (error) return fail(error, "deleteStaffDocument");
  await discard(supabase, path);
  revalidatePath("/me/documents");
  revalidatePath("/hr/documents");
  return { ok: true, data: undefined };
}

export async function verifyStaffDocument(input: unknown): Promise<ActionResult> {
  const c = await actionCaller("hr");
  if ("error" in c) return { ok: false, error: c.error };
  const p = verifySchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the highlighted fields." };
  const { error } = await (await createClient()).rpc("verify_staff_document", {
    p_id: p.data.id, p_ok: p.data.ok, ...(p.data.note ? { p_note: p.data.note } : {}),
  });
  if (error) return fail(error, "verifyStaffDocument");
  revalidatePath("/hr/documents");
  revalidatePath("/me/documents");
  return { ok: true, data: undefined };
}

// HR publishes a policy, handbook or form. Publishing a title that is already live starts its next version.
export async function publishCompanyDocument(form: FormData): Promise<ActionResult> {
  const c = await actionCaller("hr");
  if ("error" in c) return { ok: false, error: c.error };
  const p = publishSchema.safeParse(fields(form));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the highlighted fields." };
  const up = await prepareUpload(form, "company");
  if ("error" in up) return { ok: false, error: up.error };

  const supabase = await createClient();
  const stored = await store(supabase, up.path, up.file, up.mime);
  if (stored) return { ok: false, error: stored };
  const { error } = await supabase.rpc("publish_company_document", {
    p_title: p.data.title, p_kind: p.data.kind, p_audience: p.data.audience, p_summary: p.data.summary,
    p_path: up.path, p_mime: up.mime, p_size: up.file.size,
  });
  if (error) {
    await discard(supabase, up.path);
    return fail(error, "publishCompanyDocument");
  }
  revalidatePath("/hr/documents");
  revalidatePath("/me/documents");
  return { ok: true, data: undefined };
}

export async function retireCompanyDocument(id: unknown): Promise<ActionResult> {
  const c = await actionCaller("hr");
  if ("error" in c) return { ok: false, error: c.error };
  const p = z.uuid().safeParse(id);
  if (!p.success) return { ok: false, error: "That document does not exist." };
  const { error } = await (await createClient()).rpc("retire_company_document", { p_id: p.data });
  if (error) return fail(error, "retireCompanyDocument");
  revalidatePath("/hr/documents");
  revalidatePath("/me/documents");
  return { ok: true, data: undefined };
}

export async function openCompanyDocument(id: unknown): Promise<ActionResult<{ url: string }>> {
  const c = await actionCaller("me");
  if ("error" in c) return { ok: false, error: c.error };
  const p = z.uuid().safeParse(id);
  if (!p.success) return { ok: false, error: "That document does not exist." };
  const supabase = await createClient();
  const { data: doc } = await supabase.from("company_document").select("path").eq("id", p.data).maybeSingle();
  if (!doc) return { ok: false, error: "That document is not available to you." };
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.path, SIGNED_URL_SECONDS);
  if (error || !data) {
    console.error(JSON.stringify({ level: "error", context: "openCompanyDocument", message: error?.message }));
    return { ok: false, error: GENERIC_ERROR };
  }
  return { ok: true, data: { url: data.signedUrl } };
}

export async function acknowledgeDocument(id: unknown): Promise<ActionResult> {
  const c = await actionCaller("me");
  if ("error" in c) return { ok: false, error: c.error };
  const p = z.uuid().safeParse(id);
  if (!p.success) return { ok: false, error: "That document does not exist." };
  const { error } = await (await createClient()).rpc("acknowledge_document", { p_document: p.data });
  if (error) return fail(error, "acknowledgeDocument");
  revalidatePath("/me/documents");
  revalidatePath("/hr/documents");
  return { ok: true, data: undefined };
}
