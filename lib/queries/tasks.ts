import "server-only";
import type { Me } from "@/lib/permissions";
import { LAYOUT_LIMIT } from "@/lib/task-layout";
import { MAX_TASK_GROUP, OPEN_TASK_STATUSES, TASK_PAGE_SIZE, type TaskParams } from "@/lib/schemas/task";
import { subtaskRollup, type SubRollup } from "@/lib/task-health";
import { createClient } from "@/utils/supabase/server";

// Read queries for the Tasks workspace. Explicit columns, bounded result sets. RLS decides which tasks a
// person sees (their departments, their assignments, what they created); the tabs only narrow that.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const ROW =
  "id, title, department, template, status, priority, start_date, due_date, due_time, estimate_minutes, parent_task_id, group_id, shared, assignee_id, created_by, accepted_at, updated_at, recurrence_id, entity_type, entity_id, assignee:staff!task_assignee_id_fkey(full_name)";

const OPEN = [...OPEN_TASK_STATUSES];
const DONE = ["done", "cancelled"];

/** The Board's default view also shows work finished in the last two weeks, so the Done column is not empty. */
export const BOARD_DONE_DAYS = 14;

/** Tasks the person co-owns (shared tasks), besides the ones with them as the first owner. */
export async function ownedTaskIds(supabase: Supabase, meId: string): Promise<string[]> {
  const { data } = await supabase.from("task_owner").select("task_id").eq("staff_id", meId).limit(2000);
  return (data ?? []).map((r) => r.task_id);
}

/** "Mine" for a query on ops.task: assigned to the person, or one of the owners of a shared task. */
export function mineOr(meId: string, owned: string[]): string {
  return owned.length === 0 ? `assignee_id.eq.${meId}` : `assignee_id.eq.${meId},id.in.(${owned.join(",")})`;
}

function filtered(supabase: Supabase, me: Me, p: TaskParams, owned: string[]) {
  let q = supabase.from("task").select(ROW, { count: "exact" });
  if (p.view === "open" && p.layout === "board") {
    const since = new Date(Date.now() - BOARD_DONE_DAYS * 86_400_000).toISOString();
    q = q.or(`status.in.(${OPEN.join(",")}),and(status.eq.done,completed_at.gte.${since})`);
  } else if (p.view === "open") q = q.in("status", OPEN);
  else if (p.view === "done") q = q.in("status", DONE);
  if (p.tab === "mine") q = q.or(mineOr(me.id, owned));
  else if (p.tab === "created") q = q.eq("created_by", me.id);
  if (p.department) q = q.eq("department", p.department as never);
  if (p.tab === "team" && p.assignee === "none") q = q.is("assignee_id", null);
  else if (p.tab === "team" && p.assignee) q = q.eq("assignee_id", p.assignee);
  if (p.q) q = q.ilike("title", `%${p.q}%`);
  // Subtasks live under their parent. On "Assigned to me" they stay: that list is the person's own work.
  if (!p.subtasks && p.tab !== "mine") q = q.is("parent_task_id", null);
  return q;
}

export async function listTasks(supabase: Supabase, me: Me, p: TaskParams) {
  const from = (p.page - 1) * TASK_PAGE_SIZE;
  return filtered(supabase, me, p, p.tab === "mine" ? await ownedTaskIds(supabase, me.id) : [])
    .order("due_date", { ascending: p.view !== "done", nullsFirst: false })
    .order("priority", { ascending: true })
    .order("id")
    .range(from, from + TASK_PAGE_SIZE - 1);
}

/**
 * Tasks for the Board, Calendar and Timeline: the same filters as the Table, no paging, at most LAYOUT_LIMIT rows.
 * With a window, only tasks whose start-to-deadline span touches it, plus tasks with no dates at all.
 */
export async function listTasksForLayout(supabase: Supabase, me: Me, p: TaskParams, window: { from: string; to: string } | null) {
  let q = filtered(supabase, me, p, p.tab === "mine" ? await ownedTaskIds(supabase, me.id) : []);
  if (window) {
    const { from, to } = window;
    q = q.or(
      [
        `and(due_date.gte.${from},start_date.lte.${to})`,
        `and(due_date.gte.${from},due_date.lte.${to},start_date.is.null)`,
        `and(due_date.is.null,start_date.gte.${from},start_date.lte.${to})`,
        "and(due_date.is.null,start_date.is.null)",
      ].join(","),
    );
  }
  return q
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: true })
    .order("id")
    .range(0, LAYOUT_LIMIT - 1);
}

export type TaskRow = NonNullable<Awaited<ReturnType<typeof listTasks>>["data"]>[number];

/** A row with the numbers its subtasks add to its health, when they were loaded. */
export type TaskRowRolled = TaskRow & Partial<SubRollup>;

/** Days of finished work the on-time rate looks back over. */
export const ON_TIME_DAYS = 30;

/** Tasks finished in the last ON_TIME_DAYS with a deadline, for the on-time rate. One person, or everyone RLS lets you see. */
export async function listRecentlyDone(supabase: Supabase, assigneeId: string | null) {
  const since = new Date(Date.now() - ON_TIME_DAYS * 86_400_000).toISOString();
  let q = supabase
    .from("task")
    .select("assignee_id, due_date, completed_at")
    .eq("status", "done")
    .not("due_date", "is", null)
    .gte("completed_at", since);
  if (assigneeId) q = q.eq("assignee_id", assigneeId);
  return q.limit(3000);
}

const chunks = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** What a parent card or row shows about one subtask when it is expanded. */
export type SubPreview = { id: string; title: string; status: string; due_date: string | null; due_time: string | null; assignee: string | null };

/** The subtasks of the visible parents, oldest first. Ids go in groups so the URL stays short; each group is capped at 1000 rows. */
async function fetchSubs(supabase: Supabase, parentIds: string[]): Promise<Map<string, SubPreview[]>> {
  const out = new Map<string, SubPreview[]>();
  await Promise.all(
    chunks(parentIds, 100).map(async (group) => {
      const { data } = await supabase
        .from("task")
        .select("id, title, status, due_date, due_time, parent_task_id, assignee:staff!task_assignee_id_fkey(full_name)")
        .in("parent_task_id", group)
        .order("created_at", { ascending: true })
        .limit(1000);
      for (const r of data ?? []) {
        if (!r.parent_task_id) continue;
        const list = out.get(r.parent_task_id) ?? [];
        list.push({ id: r.id, title: r.title, status: r.status, due_date: r.due_date, due_time: r.due_time, assignee: r.assignee?.full_name ?? null });
        out.set(r.parent_task_id, list);
      }
    }),
  );
  return out;
}

export type SubSummary = SubRollup & { total: number; items: SubPreview[] };

function summarize(items: SubPreview[], now: Date): SubSummary {
  return { ...subtaskRollup(items, now), total: items.length, items };
}

/** Subtask counts, roll-up numbers and previews for the visible parents. */
export async function subtaskCounts(supabase: Supabase, parentIds: string[], now: Date = new Date()) {
  const counts = new Map<string, SubSummary>();
  if (parentIds.length === 0) return counts;
  for (const [id, items] of await fetchSubs(supabase, parentIds)) counts.set(id, summarize(items, now));
  return counts;
}

/** Titles of the parents of the given subtasks. A parent the viewer cannot read is simply missing from the map. */
export async function parentTitles(supabase: Supabase, parentIds: string[]) {
  const titles = new Map<string, string>();
  const ids = [...new Set(parentIds)];
  await Promise.all(
    chunks(ids, 100).map(async (group) => {
      const { data } = await supabase.from("task").select("id, title").in("id", group).limit(100);
      for (const r of data ?? []) titles.set(r.id, r.title);
    }),
  );
  return titles;
}

export type CardExtras = SubRollup & { subTotal: number; subs: SubPreview[]; watchers: number; comments: number; logged: number };

/** Subtasks, watchers, comments and minutes logged for the cards on the Board. Ids go in groups so the URL stays short. */
export async function cardExtras(supabase: Supabase, ids: string[], now: Date = new Date()): Promise<Map<string, CardExtras>> {
  const out = new Map<string, CardExtras>();
  const get = (id: string) => {
    let e = out.get(id);
    if (!e) out.set(id, (e = { subOpen: 0, subOverdue: 0, subBlocked: 0, subTotal: 0, subs: [], watchers: 0, comments: 0, logged: 0 }));
    return e;
  };
  for (const [id, items] of await fetchSubs(supabase, ids)) {
    const s = summarize(items, now);
    Object.assign(get(id), { subOpen: s.subOpen, subOverdue: s.subOverdue, subBlocked: s.subBlocked, subTotal: s.total, subs: items });
  }
  await Promise.all(
    chunks(ids, 100).map(async (group) => {
      const [watchers, comments, time] = await Promise.all([
        supabase.from("task_watcher").select("task_id").in("task_id", group).limit(2000),
        supabase.from("task_comment").select("task_id").in("task_id", group).limit(2000),
        supabase.from("time_entry").select("task_id, minutes").in("task_id", group).not("minutes", "is", null).limit(5000),
      ]);
      for (const r of watchers.data ?? []) get(r.task_id).watchers += 1;
      for (const r of comments.data ?? []) get(r.task_id).comments += 1;
      for (const r of time.data ?? []) get(r.task_id).logged += r.minutes ?? 0;
    }),
  );
  return out;
}

/** Number of open tasks in each tab, for the tab badges. */
export async function tabCounts(supabase: Supabase, me: Me) {
  const open = () => supabase.from("task").select("id", { count: "exact", head: true }).in("status", OPEN);
  const owned = await ownedTaskIds(supabase, me.id);
  const [mine, team, created] = await Promise.all([
    open().or(mineOr(me.id, owned)),
    open(),
    open().eq("created_by", me.id),
  ]);
  return { mine: mine.count ?? 0, team: team.count ?? 0, created: created.count ?? 0 };
}

/** Everything the task page needs. Null data = not found or not visible. */
export async function getTask(supabase: Supabase, id: string) {
  return supabase
    .from("task")
    .select(
      `id, title, description, department, category, group_id, template, status, priority, start_date, due_date, due_time, estimate_minutes, recurrence_id,
       parent_task_id, shared, assignee_id, created_by, created_at, updated_at, assigned_by, assigned_at, accepted_at,
       blocked_reason, cancel_reason, completed_at, completed_by, entity_type, entity_id,
       assignee:staff!task_assignee_id_fkey(full_name),
       creator:staff!task_created_by_fkey(full_name),
       assigner:staff!task_assigned_by_fkey(full_name),
       completer:staff!task_completed_by_fkey(full_name)`,
    )
    .eq("id", id)
    .maybeSingle();
}

export type TaskDetail = NonNullable<Awaited<ReturnType<typeof getTask>>["data"]>;

export async function listSubtasks(supabase: Supabase, parentId: string) {
  return supabase
    .from("task")
    .select("id, title, status, priority, start_date, due_date, due_time, department, assignee_id, created_by, completed_by, shared, assignee:staff!task_assignee_id_fkey(full_name)")
    .eq("parent_task_id", parentId)
    .order("created_at", { ascending: true })
    .limit(100);
}

/** The other tasks given out together with this one: only the ones the caller can see (a person sees their own). */
export async function listGroupTasks(supabase: Supabase, groupId: string) {
  return supabase
    .from("task")
    .select("id, status, due_date, assignee_id, assignee:staff!task_assignee_id_fkey(full_name)")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true })
    .limit(MAX_TASK_GROUP);
}

export async function getParentTask(supabase: Supabase, id: string) {
  return supabase.from("task").select("id, title, status").eq("id", id).maybeSingle();
}

export async function listTaskHistory(supabase: Supabase, taskId: string) {
  return supabase
    .from("task_history")
    .select("id, kind, from_value, to_value, note, at, actor:staff!task_history_actor_id_fkey(full_name)")
    .eq("task_id", taskId)
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
}

export async function listTaskComments(supabase: Supabase, taskId: string) {
  return supabase
    .from("task_comment")
    .select("id, body, created_at, author_id, author:staff!task_comment_author_id_fkey(full_name)")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true })
    .limit(200);
}

/** Name of the record a task hangs off (institution, deal or event), for a link on the task page. */
export async function getTaskEntity(supabase: Supabase, type: string | null, id: string | null) {
  if (!type || !id) return null;
  if (type === "institution") {
    const { data } = await supabase.from("institution").select("id, name").eq("id", id).maybeSingle();
    return data ? { label: data.name, href: `/institutions/${data.id}` } : null;
  }
  if (type === "event") {
    const { data } = await supabase.from("event").select("id, title").eq("id", id).maybeSingle();
    return data ? { label: data.title ?? "Event", href: `/workshop/${data.id}` } : null;
  }
  if (type === "deal") {
    const { data } = await supabase.from("deal").select("id, institution:institution(name)").eq("id", id).maybeSingle();
    return data ? { label: `Deal: ${data.institution?.name ?? "deal"}`, href: `/sales/${data.id}` } : null;
  }
  return null;
}

export type OwnerRow = { staff_id: string; full_name: string };

/** Owners of the shared tasks among these ids, first owner first. A task that is not shared has no entry. */
export async function sharedOwners(supabase: Supabase, taskIds: string[]): Promise<Map<string, OwnerRow[]>> {
  const out = new Map<string, OwnerRow[]>();
  await Promise.all(
    chunks(taskIds, 100).map(async (group) => {
      const { data } = await supabase
        .from("task_owner")
        .select("task_id, staff_id, added_at, staff:staff!task_owner_staff_id_fkey(full_name)")
        .in("task_id", group)
        .order("added_at", { ascending: true })
        .limit(2000);
      for (const r of data ?? []) {
        const list = out.get(r.task_id) ?? [];
        list.push({ staff_id: r.staff_id, full_name: r.staff?.full_name ?? "Unknown" });
        out.set(r.task_id, list);
      }
    }),
  );
  return out;
}

/** How far along each group is, whoever can see the other copies (ops.task_group_progress). A group the caller cannot see is missing. */
export async function groupTotals(supabase: Supabase, groupIds: string[]): Promise<Map<string, { done: number; total: number }>> {
  const out = new Map<string, { done: number; total: number }>();
  await Promise.all(
    [...new Set(groupIds)].slice(0, 100).map(async (id) => {
      const { data } = await supabase.rpc("task_group_progress", { p_group: id });
      const row = data?.[0];
      if (row && row.total > 0) out.set(id, { done: row.done, total: row.total });
    }),
  );
  return out;
}
