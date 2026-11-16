import "server-only";
import { COLD_AFTER_DAYS, OUTREACH_PAGE_SIZE, type OutreachParams } from "@/lib/schemas/activity";
import type { Me } from "@/lib/permissions";
import { createClient } from "@/utils/supabase/server";

// Read queries for the Outreach workspace. Explicit columns, server-side pagination, no N+1.
// RLS decides what each role sees (Outreach: all activity; partner: their own).

type Supabase = Awaited<ReturnType<typeof createClient>>;

const OPEN_TASK = ["todo", "doing", "blocked"];
const QUEUE_LIMIT = 200;

/** Open follow-up tasks (created by the on_activity trigger), soonest due first, with institution names. */
export async function listFollowUps(supabase: Supabase, me: Me, scope: OutreachParams["scope"]) {
  let query = supabase
    .from("task")
    .select("id, title, status, priority, due_date, department, assignee_id, entity_id, assignee:staff!task_assignee_id_fkey(full_name)", { count: "exact" })
    .eq("template", "follow_up")
    .eq("entity_type", "institution")
    .in("status", OPEN_TASK);
  if (scope === "mine") query = query.eq("assignee_id", me.id);

  const res = await query.order("due_date", { ascending: true, nullsFirst: false }).order("created_at").limit(QUEUE_LIMIT);
  if (res.error) return { ...res, rows: [], institutions: new Map<string, string>() };

  const ids = [...new Set(res.data.map((t) => t.entity_id).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const inst = await supabase.from("institution").select("id, name").in("id", ids);
    if (inst.error) return { ...res, error: inst.error, rows: [], institutions: names };
    for (const i of inst.data) names.set(i.id, i.name);
  }
  return { ...res, rows: res.data, institutions: names };
}

export type FollowUpRow = Awaited<ReturnType<typeof listFollowUps>>["rows"][number];

/** Institutions with their last touch, filtered by segment, district and how recently they were contacted. */
export async function listTerritory(supabase: Supabase, p: OutreachParams) {
  let query = supabase
    .from("v_territory")
    .select("id, name, kind, segment, city, district, stage, last_activity_at, activities", { count: "exact" });
  if (p.segment) query = query.eq("segment", p.segment);
  if (p.district) query = query.ilike("district", `%${p.district}%`);
  if (p.touch === "untouched") query = query.is("last_activity_at", null);
  if (p.touch === "cold") {
    const cutoff = new Date(Date.now() - COLD_AFTER_DAYS * 86_400_000).toISOString();
    query = query.lt("last_activity_at", cutoff);
  }
  const from = (p.page - 1) * OUTREACH_PAGE_SIZE;
  return query
    .order("last_activity_at", { ascending: true, nullsFirst: true })
    .order("name")
    .range(from, from + OUTREACH_PAGE_SIZE - 1);
}

export type TerritoryRow = NonNullable<Awaited<ReturnType<typeof listTerritory>>["data"]>[number];

/** Activity history, newest first. "mine" = what I logged. */
export async function listActivityHistory(supabase: Supabase, me: Me, p: OutreachParams) {
  let query = supabase
    .from("activity")
    .select(
      "id, kind, outcome, notes, happened_at, next_step, next_step_due, institution:institution!activity_institution_id_fkey(id, name), author:staff!activity_staff_id_fkey(full_name)",
      { count: "exact" },
    );
  if (p.scope === "mine") query = query.eq("staff_id", me.id);
  const from = (p.page - 1) * OUTREACH_PAGE_SIZE;
  return query.order("happened_at", { ascending: false }).order("id").range(from, from + OUTREACH_PAGE_SIZE - 1);
}

export type HistoryRow = NonNullable<Awaited<ReturnType<typeof listActivityHistory>>["data"]>[number];
