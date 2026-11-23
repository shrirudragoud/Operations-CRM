"use server";

import { revalidatePath } from "next/cache";
import { actionCaller } from "@/lib/auth";
import { fail, GENERIC_ERROR, PERMISSION_ERROR, type ActionResult } from "@/lib/errors";
import { scanOptionsFromEnv, scanRequired, scanStream, type ScanResult } from "@/lib/clamav";
import { canWrite } from "@/lib/permissions";
import {
  TASK_FILE_BUCKET, TASK_FILE_HEAD_BYTES, TASK_FILE_MAX_BYTES, TASK_FILE_MAX_PER_TASK, TASK_FILE_TYPES, TASK_FILE_TYPE_ERROR,
  checkTaskFile, displayTaskFileName, finishTaskUploadSchema, isTaskFilePath, prepareTaskUploadSchema, resolveTaskFileMime,
  taskAttachmentIdSchema, taskFileMatches, taskFilePath, type TaskFileKind, type TaskFileMime,
} from "@/lib/schemas/task-files";
import { createClient } from "@/utils/supabase/server";

// Files on tasks (0039). Upload is three steps so a 25 MB file never passes through this server:
//   1. prepareTaskUpload: checks name, size and type, and returns a signed upload address for one object path.
//   2. The browser sends the file straight to Storage with that token.
//   3. finishTaskUpload: reads the first bytes of the stored object, checks they match the type, scans it with ClamAV
//      when TASK_FILE_SCAN=required (lib/clamav.ts), and registers
//      the file on the task through the database. Anything that fails is removed from Storage again.

type Supabase = Awaited<ReturnType<typeof createClient>>;

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Check the file and try again.";
}

async function discard(supabase: Supabase, path: string) {
  const { error } = await supabase.storage.from(TASK_FILE_BUCKET).remove([path]);
  if (error) console.error(JSON.stringify({ level: "error", context: "task-files.discard", message: error.message }));
}

// The first bytes of a stored object, read with a short-lived signed address and a Range request.
async function readHead(supabase: Supabase, path: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage.from(TASK_FILE_BUCKET).createSignedUrl(path, 60);
  if (error || !data) return null;
  try {
    const res = await fetch(data.signedUrl, {
      headers: { Range: `bytes=0-${TASK_FILE_HEAD_BYTES - 1}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    while (got < TASK_FILE_HEAD_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      got += value.length;
    }
    await reader.cancel().catch(() => undefined);
    const head = new Uint8Array(Math.min(got, TASK_FILE_HEAD_BYTES));
    let at = 0;
    for (const c of chunks) {
      const room = head.length - at;
      if (room <= 0) break;
      head.set(c.subarray(0, room), at);
      at += Math.min(c.length, room);
    }
    return head;
  } catch {
    return null;
  }
}

// The whole stored object, streamed to the virus scanner. Fails closed: if it cannot be read or scanned, it is an error.
async function scanObject(supabase: Supabase, path: string): Promise<ScanResult> {
  const { data, error } = await supabase.storage.from(TASK_FILE_BUCKET).createSignedUrl(path, 120);
  if (error || !data) return { status: "error", message: "The file could not be read for scanning" };
  try {
    const res = await fetch(data.signedUrl, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
    if (!res.ok || !res.body) return { status: "error", message: "The file could not be read for scanning" };
    return await scanStream(res.body as unknown as AsyncIterable<Uint8Array>, scanOptionsFromEnv());
  } catch {
    return { status: "error", message: "The file could not be read for scanning" };
  }
}

export type PreparedTaskUpload = { path: string; token: string; mime: TaskFileMime; name: string };

/** Step 1. The database decides who may upload (Storage policy); this checks the file itself and the 100-file limit. */
export async function prepareTaskUpload(input: unknown): Promise<ActionResult<PreparedTaskUpload>> {
  const c = await actionCaller();
  if ("error" in c) return { ok: false, error: c.error };
  if (!canWrite(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const p = prepareTaskUploadSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const check = checkTaskFile({ name: p.data.name, size: p.data.size, type: p.data.mime });
  if (!check.ok) return { ok: false, error: check.error };

  const supabase = await createClient();
  const { data: task, error: taskError } = await supabase
    .from("task").select("attachment_count").eq("id", p.data.task_id).maybeSingle();
  if (taskError) return fail(taskError, "prepareTaskUpload");
  if (!task) return { ok: false, error: "That task was not found." };
  if (task.attachment_count >= TASK_FILE_MAX_PER_TASK) {
    return { ok: false, error: `A task can hold at most ${TASK_FILE_MAX_PER_TASK} files. Remove one first.` };
  }

  const path = taskFilePath(p.data.task_id, check.mime, p.data.name);
  const { data, error } = await supabase.storage.from(TASK_FILE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error(JSON.stringify({ level: "error", context: "prepareTaskUpload", message: error?.message }));
    return { ok: false, error: /row-level security|not authorized|unauthorized/i.test(error?.message ?? "") ? PERMISSION_ERROR : GENERIC_ERROR };
  }
  return { ok: true, data: { path, token: data.token, mime: check.mime, name: displayTaskFileName(p.data.name, check.mime) } };
}

export type FinishedTaskUpload = { id: string; name: string; mime: TaskFileMime; kind: TaskFileKind; href: string };

/** Step 3. Checks what was really stored, then registers it. On any failure the object is removed from Storage. */
export async function finishTaskUpload(input: unknown): Promise<ActionResult<FinishedTaskUpload>> {
  const c = await actionCaller();
  if ("error" in c) return { ok: false, error: c.error };
  if (!canWrite(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const p = finishTaskUploadSchema.safeParse(input);
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { task_id, path, comment_id } = p.data;
  if (!isTaskFilePath(path, task_id)) return { ok: false, error: "That file was not stored in this task's folder." };

  const supabase = await createClient();
  const mime = resolveTaskFileMime(p.data.name, p.data.mime);
  if (!mime) {
    await discard(supabase, path);
    return { ok: false, error: TASK_FILE_TYPE_ERROR };
  }
  const name = displayTaskFileName(p.data.name, mime);
  const kind: TaskFileKind = TASK_FILE_TYPES[mime].kind;
  if (p.data.inline && kind !== "image") {
    await discard(supabase, path);
    return { ok: false, error: "Only an image can be placed inside the description." };
  }

  const { data: info, error: infoError } = await supabase.storage.from(TASK_FILE_BUCKET).info(path);
  const size = typeof info?.size === "number" ? info.size : 0;
  if (infoError || size <= 0) return { ok: false, error: "The file was not uploaded. Try again." };
  if (size > TASK_FILE_MAX_BYTES) {
    await discard(supabase, path);
    return { ok: false, error: "That file is over 25 MB. Choose a smaller one." };
  }

  const head = await readHead(supabase, path);
  if (!head) {
    await discard(supabase, path);
    return { ok: false, error: "The file could not be checked. Try again." };
  }
  if (!taskFileMatches(mime, head)) {
    await discard(supabase, path);
    return { ok: false, error: `${name} doesn't look like a real ${TASK_FILE_TYPES[mime].label}.` };
  }

  if (scanRequired()) {
    const scan = await scanObject(supabase, path);
    if (scan.status === "infected") {
      console.error(JSON.stringify({ level: "warn", context: "task-files.scan", task_id, signature: scan.signature }));
      await discard(supabase, path);
      return { ok: false, error: `${name} was blocked because the virus scanner flagged it.` };
    }
    if (scan.status === "error") {
      console.error(JSON.stringify({ level: "error", context: "task-files.scan", task_id, message: scan.message }));
      await discard(supabase, path);
      return { ok: false, error: "The file could not be scanned for viruses just now. Try again in a minute." };
    }
  }

  const { data: id, error } = await supabase.rpc("register_task_attachment", {
    p_task: task_id, p_path: path, p_name: name, p_mime: mime, p_size: size,
    ...(comment_id ? { p_comment: comment_id } : {}),
    ...(p.data.inline ? { p_inline: true } : {}),
  });
  if (error || !id) {
    await discard(supabase, path);
    return error ? fail(error, "finishTaskUpload") : { ok: false, error: GENERIC_ERROR };
  }
  revalidatePath(`/tasks/${task_id}`);
  return { ok: true, data: { id, name, mime, kind, href: `/api/task-files/${id}` } };
}

async function change(input: unknown, rpc: "remove_task_attachment" | "restore_task_attachment"): Promise<ActionResult> {
  const c = await actionCaller();
  if ("error" in c) return { ok: false, error: c.error };
  if (!canWrite(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const p = taskAttachmentIdSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "That file does not exist." };
  const supabase = await createClient();
  const { data: row } = await supabase.from("task_attachment").select("task_id").eq("id", p.data.id).maybeSingle();
  const { error } = await supabase.rpc(rpc, { p_id: p.data.id });
  if (error) return fail(error, rpc);
  if (row) revalidatePath(`/tasks/${row.task_id}`);
  return { ok: true, data: undefined };
}

export async function removeTaskAttachment(input: unknown): Promise<ActionResult> {
  return change(input, "remove_task_attachment");
}

export async function restoreTaskAttachment(input: unknown): Promise<ActionResult> {
  return change(input, "restore_task_attachment");
}
