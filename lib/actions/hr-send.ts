"use server";

import { revalidatePath } from "next/cache";
import { actionCaller } from "@/lib/auth";
import { fail, type ActionResult } from "@/lib/errors";
import { checkUpload, safeFileName } from "@/lib/schemas/documents";
import { sendFileSchema } from "@/lib/schemas/hr-send";
import { createClient } from "@/utils/supabase/server";

const BUCKET = "hr-docs";

// HR hands a file to a person: it is stored privately in their folder, lands on their record already verified, and
// they are told. The RPC does the last two steps in one transaction; if it refuses, the stored file is removed.
export async function sendFileToPerson(form: FormData): Promise<ActionResult> {
  const c = await actionCaller("hr");
  if ("error" in c) return { ok: false, error: c.error };

  const text: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") text[k] = v;
  const p = sendFileSchema.safeParse(text);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the highlighted fields." };

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file to send." };
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const check = checkUpload(file, head);
  if (!check.ok) return { ok: false, error: check.error };

  const path = `${p.data.staff_id}/${crypto.randomUUID()}-${safeFileName(file.name, check.ext)}`;
  const supabase = await createClient();
  const { error: storeError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: check.mime, upsert: false });
  if (storeError) {
    console.error(JSON.stringify({ level: "error", context: "hrSend.store", message: storeError.message }));
    return { ok: false, error: "The file could not be saved. Try again." };
  }

  const { error } = await supabase.rpc("hr_send_document", {
    p_staff: p.data.staff_id, p_kind: p.data.kind, p_title: p.data.title, p_path: path, p_mime: check.mime, p_size: file.size,
    ...(p.data.note ? { p_note: p.data.note } : {}),
  });
  if (error) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([path]);
    if (removeError) console.error(JSON.stringify({ level: "error", context: "hrSend.discard", message: removeError.message }));
    return fail(error, "sendFileToPerson");
  }
  revalidatePath("/hr");
  revalidatePath("/hr/documents");
  revalidatePath("/me/documents");
  return { ok: true, data: undefined };
}
