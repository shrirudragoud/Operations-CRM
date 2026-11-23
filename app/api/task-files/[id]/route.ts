import { NextResponse } from "next/server";
import { z } from "zod";
import { INLINE_IMAGE_MIMES, TASK_FILE_BUCKET, isTaskFileMime } from "@/lib/schemas/task-files";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

// Serves a task file to someone who may read it. The row is read as the signed-in user, so RLS decides: a file
// they cannot see (other team, a subtask-only holder, a removed file that is not theirs) is a plain 404.
// The bytes are streamed from the private bucket, never redirected to a Storage address.
const NOT_FOUND = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });

function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await ctx.params).id);
  if (!id.success) return NOT_FOUND();

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Sign in", { status: 401, headers: { "Cache-Control": "private, no-store" } });

  const { data: row } = await supabase.from("task_attachment").select("path, name, mime").eq("id", id.data).maybeSingle();
  if (!row || !isTaskFileMime(row.mime)) return NOT_FOUND();

  const { data: blob, error } = await supabase.storage.from(TASK_FILE_BUCKET).download(row.path);
  if (error || !blob) return NOT_FOUND();

  const inline = INLINE_IMAGE_MIMES.includes(row.mime);
  return new NextResponse(blob.stream(), {
    status: 200,
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(blob.size),
      "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", row.name),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, max-age=300",
    },
  });
}
