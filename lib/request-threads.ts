export type Attachment = { id: string; name: string; size_bytes: number };
export type ThreadMessage = { id: number; body: string; internal: boolean; created_at: string; author: string | null; files: Attachment[] };

type MessageRow = { id: number; request_id: string; body: string; internal: boolean; created_at: string; author: { full_name: string } | null };
type FileRow = { id: string; request_id: string; message_id: number | null; name: string; size_bytes: number };

/** Groups messages and files by request. Files with no message belong to the request itself. */
export function buildThreads(messages: MessageRow[], files: FileRow[]) {
  const byMessage = new Map<number, Attachment[]>();
  const onRequest = new Map<string, Attachment[]>();
  for (const f of files) {
    const a = { id: f.id, name: f.name, size_bytes: f.size_bytes };
    if (f.message_id === null) onRequest.set(f.request_id, [...(onRequest.get(f.request_id) ?? []), a]);
    else byMessage.set(f.message_id, [...(byMessage.get(f.message_id) ?? []), a]);
  }
  const threads = new Map<string, ThreadMessage[]>();
  for (const m of messages) {
    const list = threads.get(m.request_id) ?? [];
    list.push({
      id: m.id, body: m.body, internal: m.internal, created_at: m.created_at, author: m.author?.full_name ?? null,
      files: byMessage.get(m.id) ?? [],
    });
    threads.set(m.request_id, list);
  }
  return { threads, onRequest };
}
