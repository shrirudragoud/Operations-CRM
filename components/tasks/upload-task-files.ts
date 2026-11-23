"use client";

import { finishTaskUpload, prepareTaskUpload } from "@/lib/actions/task-files";
import { TASK_FILE_BUCKET, TASK_FILE_TYPE_ERROR, checkTaskFile } from "@/lib/schemas/task-files";
import { createClient } from "@/utils/supabase/client";

export type UploadOutcome = { name: string; error: string | null };

const MAX_PARALLEL = 3;

/** The file's own problem, in words people can act on, or null when it can be sent. */
export function fileProblem(file: File): string | null {
  const check = checkTaskFile({ name: file.name, size: file.size, type: file.type });
  return check.ok ? null : check.error;
}

export function rejectionMessage(file: File): string {
  return fileProblem(file) ?? TASK_FILE_TYPE_ERROR;
}

async function uploadOne(taskId: string, file: File, commentId?: string): Promise<UploadOutcome> {
  const name = file.name;
  const problem = fileProblem(file);
  if (problem) return { name, error: problem };

  const prepared = await prepareTaskUpload({ task_id: taskId, name, mime: file.type, size: file.size });
  if (!prepared.ok) return { name, error: prepared.error };

  const { error: sendError } = await createClient()
    .storage.from(TASK_FILE_BUCKET)
    .uploadToSignedUrl(prepared.data.path, prepared.data.token, file, { contentType: prepared.data.mime });
  if (sendError) return { name, error: "The upload did not go through. Check your connection and try again." };

  const finished = await finishTaskUpload({
    task_id: taskId, path: prepared.data.path, name, mime: prepared.data.mime,
    ...(commentId ? { comment_id: commentId } : {}),
  });
  return { name, error: finished.ok ? null : finished.error };
}

/** Sends files straight to Storage, three at a time, and reports each one as it settles. */
export async function uploadTaskFiles(
  taskId: string, files: File[], opts: { commentId?: string; onSettled?: (file: File, outcome: UploadOutcome) => void } = {},
): Promise<UploadOutcome[]> {
  const out: UploadOutcome[] = new Array(files.length);
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const i = next++;
      const file = files[i]!;
      let outcome: UploadOutcome;
      try {
        outcome = await uploadOne(taskId, file, opts.commentId);
      } catch {
        outcome = { name: file.name, error: "Something went wrong while uploading. Try again." };
      }
      out[i] = outcome;
      opts.onSettled?.(file, outcome);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, files.length) }, worker));
  return out;
}
