import { cardRows, doneLinks, personIdsOf } from "@/lib/ai/draft-views";
import { isTaskDraft } from "@/lib/ai/drafts";
import type { Part } from "@/lib/ai/gemini";
import type { ChatMessage, DraftCard, DraftLink, DraftStatus, TaskPreview, Thread } from "@/lib/ai/types";
import { formatDue } from "@/lib/schemas/task";
import type { createClient } from "@/utils/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type MessageRow = { id: string; role: string; content: unknown; created_at: string };
export type ActionRow = { id: string; kind: string; summary: string; status: string; payload: unknown; result: unknown; error: string | null; expires_at: string };

const NO_ANSWER = "I could not put an answer together for that. Try asking in a different way.";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** What the person sees: their own words and the assistant's answers. Tool calls, tool results and thoughts stay hidden. */
export function toChatMessages(rows: MessageRow[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const r of rows) {
    if (r.role !== "user" && r.role !== "model") continue;
    const c = rec(r.content);
    const parts = (Array.isArray(c.parts) ? c.parts : []) as Part[];
    if (r.role === "model" && parts.some((p) => p.functionCall)) continue;
    const text = parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("").trim();
    if (r.role === "user" && !text) continue;
    out.push({
      id: r.id,
      role: r.role,
      text: text || NO_ANSWER,
      draftIds: Array.isArray(c.drafts) ? c.drafts.filter((d): d is string => typeof d === "string") : [],
      error: c.error === true,
      at: r.created_at,
    });
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function taskIdsOf(payload: Record<string, unknown>, result: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && UUID.test(v)) ids.add(v);
  };
  add(result.id);
  for (const v of Object.values(rec(result.created))) add(v);
  add(payload.id);
  add(payload.task_id);
  add(payload.parent_task_id);
  return [...ids];
}

function previewOf(row: ActionRow, names: Map<string, string>): TaskPreview | null {
  if (row.kind !== "create_task") return null;
  const p = rec(row.payload);
  const ids = [p.assignee_id, ...(Array.isArray(p.also_assignee_ids) ? p.also_assignee_ids : [])].filter((x): x is string => typeof x === "string" && x !== "");
  return {
    title: typeof p.title === "string" ? p.title : "",
    description: typeof p.description === "string" && p.description.trim() ? p.description : null,
    assignees: ids.map((id) => names.get(id) ?? "A colleague"),
    shared: p.mode === "shared" && ids.length > 1,
    dueLabel: typeof p.due_date === "string" && p.due_date ? formatDue(p.due_date, typeof p.due_time === "string" ? p.due_time : null) : null,
    priority: typeof p.priority === "number" ? p.priority : 3,
    department: typeof p.department === "string" && p.department ? p.department : null,
    parent: typeof p.parent_task_id === "string" && p.parent_task_id !== "",
  };
}

/** Names of the people a set of new-task drafts is for, so a card can say "for Asha" and not show an id. */
export async function loadNames(supabase: Supabase, rows: Pick<ActionRow, "kind" | "payload">[]): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const r of rows) {
    const p = rec(r.payload);
    const named = r.kind === "create_task" ? [p.assignee_id, ...(Array.isArray(p.also_assignee_ids) ? p.also_assignee_ids : [])] : personIdsOf(r.kind, p);
    for (const v of named) if (typeof v === "string" && UUID.test(v)) ids.add(v);
  }
  if (ids.size === 0) return new Map();
  const { data } = await supabase.from("staff").select("id, full_name").in("id", [...ids]);
  return new Map((data ?? []).map((s) => [s.id, s.full_name]));
}

export function toDraftCard(row: ActionRow, now = Date.now(), names: Map<string, string> = new Map()): DraftCard {
  const expired = row.status === "pending" && new Date(row.expires_at).getTime() <= now;
  const payload = rec(row.payload);
  const result = rec(row.result);
  const [headline = "", ...notes] = row.summary.split("\n");
  const taskIds = isTaskDraft(row.kind) ? taskIdsOf(payload, result) : [];
  const links: DraftLink[] = isTaskDraft(row.kind)
    ? taskIds.slice(0, 3).map((id, i) => ({ href: `/tasks/${id}`, label: i === 0 ? "Open the task" : `Open task ${i + 1}`, ref: { kind: "task", id } }))
    : doneLinks(row.kind, payload, result);
  return {
    id: row.id,
    kind: row.kind,
    summary: headline,
    notes,
    rows: cardRows(row.kind, payload, (id) => names.get(id) ?? "A colleague"),
    task: previewOf(row, names),
    status: row.status as DraftStatus,
    error: row.error,
    taskIds,
    links,
    expiresAt: row.expires_at,
    expired,
  };
}

export async function loadThread(supabase: Supabase, conversationId: string): Promise<Thread | null> {
  const { data: chat } = await supabase.from("ai_conversation").select("id, title").eq("id", conversationId).maybeSingle();
  if (!chat) return null;
  const [messages, actions] = await Promise.all([
    supabase.from("ai_message").select("id, role, content, created_at").eq("conversation_id", conversationId).order("seq", { ascending: true }).limit(700),
    supabase.from("ai_action").select("id, kind, summary, status, payload, result, error, expires_at").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(300),
  ]);
  const names = await loadNames(supabase, actions.data ?? []);
  return {
    id: chat.id,
    title: chat.title,
    messages: toChatMessages(messages.data ?? []),
    drafts: (actions.data ?? []).map((a) => toDraftCard(a, Date.now(), names)),
  };
}
