import "server-only";
import type { TaskFileKind, TaskFileMime } from "@/lib/schemas/task-files";
import type { createClient } from "@/utils/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type TaskFile = {
  id: string;
  task_id: string;
  comment_id: string | null;
  name: string;
  mime: TaskFileMime;
  size_bytes: number;
  kind: TaskFileKind;
  is_inline: boolean;
  uploaded_by: string | null;
  uploader: string | null;
  created_at: string;
  deleted_at: string | null;
  /** Where the file is served: /api/task-files/<id>. Never a Storage address. */
  href: string;
};

const COLS =
  "id, task_id, comment_id, name, mime, size_bytes, kind, is_inline, uploaded_by, created_at, deleted_at, uploader:staff!task_attachment_uploaded_by_fkey(full_name)";

export const taskFileHref = (id: string) => `/api/task-files/${id}`;

type Row = {
  id: string; task_id: string; comment_id: string | null; name: string; mime: string; size_bytes: number; kind: string;
  is_inline: boolean; uploaded_by: string | null; created_at: string; deleted_at: string | null;
  uploader: { full_name: string } | null;
};

function shape(r: Row): TaskFile {
  return {
    id: r.id, task_id: r.task_id, comment_id: r.comment_id, name: r.name, mime: r.mime as TaskFileMime,
    size_bytes: r.size_bytes, kind: r.kind as TaskFileKind, is_inline: r.is_inline, uploaded_by: r.uploaded_by,
    uploader: r.uploader?.full_name ?? null, created_at: r.created_at, deleted_at: r.deleted_at, href: taskFileHref(r.id),
  };
}

/**
 * The files on a task, newest last. Removed files are included only when asked (the trash): RLS shows them to their
 * uploader and to people who may edit the task, nobody else.
 */
export async function listTaskFiles(supabase: Supabase, taskId: string, opts: { removed?: boolean } = {}): Promise<TaskFile[]> {
  let q = supabase.from("task_attachment").select(COLS).eq("task_id", taskId);
  q = opts.removed ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
  const { data, error } = await q.order("created_at", { ascending: true }).limit(200);
  if (error) {
    console.error(JSON.stringify({ level: "error", context: "listTaskFiles", code: error.code, message: error.message }));
    return [];
  }
  return ((data ?? []) as unknown as Row[]).map(shape);
}

export type TaskFileCount = { files: number; images: number };

/** File and image counts per task, for cards. One request per 100 tasks so the URL stays short. */
export async function taskFileCounts(supabase: Supabase, taskIds: string[]): Promise<Map<string, TaskFileCount>> {
  const out = new Map<string, TaskFileCount>();
  for (let i = 0; i < taskIds.length; i += 100) {
    const group = taskIds.slice(i, i + 100);
    const { data, error } = await supabase
      .from("task_attachment")
      .select("task_id, kind")
      .in("task_id", group)
      .is("deleted_at", null)
      .limit(5000);
    if (error) {
      console.error(JSON.stringify({ level: "error", context: "taskFileCounts", code: error.code, message: error.message }));
      continue;
    }
    for (const r of data ?? []) {
      const c = out.get(r.task_id) ?? { files: 0, images: 0 };
      c.files += 1;
      if (r.kind === "image") c.images += 1;
      out.set(r.task_id, c);
    }
  }
  return out;
}
