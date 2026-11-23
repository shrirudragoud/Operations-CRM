import { formatBytes } from "@/lib/schemas/documents";
import { TASK_FILE_TYPES, isTaskFileMime } from "@/lib/schemas/task-files";

/** A task file as the page shows it. Built on the server, so dates are already formatted and permissions decided. */
export type FileView = {
  id: string;
  name: string;
  mime: string;
  kind: "image" | "document";
  size_bytes: number;
  href: string;
  uploader: string | null;
  at: string;
  canRemove: boolean;
};

export function fileTypeLabel(mime: string): string {
  return isTaskFileMime(mime) ? TASK_FILE_TYPES[mime].label : "File";
}

/** "PDF, 12 KB" */
export function fileSummary(f: Pick<FileView, "mime" | "size_bytes">): string {
  return `${fileTypeLabel(f.mime)}, ${formatBytes(f.size_bytes)}`;
}

/** "Asha, 5 Dec 2026" or just the date when the uploader is gone. */
export function fileByline(f: Pick<FileView, "uploader" | "at">): string {
  return f.uploader ? `${f.uploader}, ${f.at}` : f.at;
}

/** Files on the task itself, and files grouped under the comment they came with. */
export function splitFilesByComment<T extends { comment_id: string | null }>(files: T[]): { task: T[]; byComment: Map<string, T[]> } {
  const task: T[] = [];
  const byComment = new Map<string, T[]>();
  for (const f of files) {
    if (f.comment_id === null) task.push(f);
    else byComment.set(f.comment_id, [...(byComment.get(f.comment_id) ?? []), f]);
  }
  return { task, byComment };
}
