import "server-only";
import { checkUpload, safeFileName } from "@/lib/schemas/documents";
import { MAX_FILES_PER_MESSAGE } from "@/lib/schemas/hr-requests";
import type { createClient } from "@/utils/supabase/server";

export const BUCKET = "hr-docs";

type Supabase = Awaited<ReturnType<typeof createClient>>;
export type PreparedFile = { file: File; path: string; name: string; mime: string };

/** The files chosen in a form, checked for count, size, type and real content (not what the browser claims). */
export async function prepareFiles(form: FormData, folder: string): Promise<{ files: PreparedFile[] } | { error: string }> {
  const chosen = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (chosen.length > MAX_FILES_PER_MESSAGE) return { error: `Attach at most ${MAX_FILES_PER_MESSAGE} files at a time.` };
  const files: PreparedFile[] = [];
  for (const file of chosen) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const check = checkUpload(file, head);
    if (!check.ok) return { error: `${file.name}: ${check.error}` };
    files.push({
      file,
      mime: check.mime,
      name: file.name.trim().slice(0, 120) || `file.${check.ext}`,
      path: `${folder}/${crypto.randomUUID()}-${safeFileName(file.name, check.ext)}`,
    });
  }
  return { files };
}

export async function discardFiles(supabase: Supabase, files: PreparedFile[]) {
  if (files.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(files.map((f) => f.path));
  if (error) console.error(JSON.stringify({ level: "error", context: "request-uploads.discard", message: error.message }));
}

/** Uploads every file or none: if one fails, the ones already stored are removed. */
export async function storeFiles(supabase: Supabase, files: PreparedFile[]): Promise<string | null> {
  const done: PreparedFile[] = [];
  for (const f of files) {
    const { error } = await supabase.storage.from(BUCKET).upload(f.path, f.file, { contentType: f.mime, upsert: false });
    if (error) {
      console.error(JSON.stringify({ level: "error", context: "request-uploads.store", message: error.message }));
      await discardFiles(supabase, done);
      return `${f.name} could not be saved. Try again.`;
    }
    done.push(f);
  }
  return null;
}

/** The shape ops.attach_request_files expects. */
export function filesPayload(files: PreparedFile[]) {
  return files.map((f) => ({ path: f.path, name: f.name, mime: f.mime, size: f.file.size }));
}
