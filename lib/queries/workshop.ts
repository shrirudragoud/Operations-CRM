import "server-only";
import type { Me } from "@/lib/permissions";
import { gridRange, OPEN_STATUSES, WORKSHOP_PAGE_SIZE, type WorkshopParams } from "@/lib/schemas/event";
import { createClient } from "@/utils/supabase/server";

// Read queries for the Workshop workspace. Explicit columns and bounded result sets. RLS decides who sees
// events; "mine" (I am lead or assistant) is a convenience filter only.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const CALENDAR_LIMIT = 500;
const DRAFT_LIMIT = 50;

const ROW =
  "id, title, kind, status, starts_at, ends_at, venue, expected_headcount, lead_trainer_id, institution:institution!inner(id, name, city), lead:staff!event_lead_trainer_id_fkey(full_name)";

async function myEventIds(supabase: Supabase, me: Me): Promise<string[]> {
  const { data } = await supabase.from("event_staff").select("event_id").eq("staff_id", me.id).limit(1000);
  return (data ?? []).map((r) => r.event_id);
}

function mineClause(me: Me, ids: string[]): string {
  return ids.length > 0 ? `lead_trainer_id.eq.${me.id},id.in.(${ids.join(",")})` : `lead_trainer_id.eq.${me.id}`;
}

/** Events that touch the visible month grid. Cancelled ones are not shown: they no longer hold the date or the trainer. */
export async function listCalendar(supabase: Supabase, me: Me, p: WorkshopParams) {
  const { from, to } = gridRange(p.month);
  const mine = p.scope === "mine" ? mineClause(me, await myEventIds(supabase, me)) : null;
  let q = supabase
    .from("event")
    .select(ROW, { count: "exact" })
    .is("archived_at", null)
    .neq("status", "cancelled")
    .lt("starts_at", to)
    .gte("ends_at", from);
  if (p.kind) q = q.eq("kind", p.kind);
  if (mine) q = q.or(mine);
  return q.order("starts_at", { ascending: true }).limit(CALENDAR_LIMIT);
}

export type CalendarRow = NonNullable<Awaited<ReturnType<typeof listCalendar>>["data"]>[number];

/** Draft events (won deals waiting for a date and a trainer), oldest first. */
export async function listNeedsScheduling(supabase: Supabase, me: Me, p: WorkshopParams) {
  let q = supabase
    .from("event")
    .select(ROW, { count: "exact" })
    .is("archived_at", null)
    .eq("status", "draft");
  if (p.kind) q = q.eq("kind", p.kind);
  if (p.scope === "mine") q = q.or(mineClause(me, await myEventIds(supabase, me)));
  return q.order("created_at", { ascending: true }).limit(DRAFT_LIMIT);
}

/** Paginated events list. Open work is soonest first (undated last); finished work is newest first. */
export async function listEvents(supabase: Supabase, me: Me, p: WorkshopParams) {
  let q = supabase.from("event").select(ROW, { count: "exact" }).is("archived_at", null);
  if (p.kind) q = q.eq("kind", p.kind);
  if (p.status === "open") q = q.in("status", [...OPEN_STATUSES]);
  else if (p.status !== "all") q = q.eq("status", p.status);
  if (p.scope === "mine") q = q.or(mineClause(me, await myEventIds(supabase, me)));
  const finished = p.status === "completed" || p.status === "cancelled";
  const from = (p.page - 1) * WORKSHOP_PAGE_SIZE;
  return q
    .order("starts_at", { ascending: !finished, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, from + WORKSHOP_PAGE_SIZE - 1);
}

export type EventRow = NonNullable<Awaited<ReturnType<typeof listEvents>>["data"]>[number];

/** Everything the event detail page needs. Null data = not found or not visible. */
export async function getEvent(supabase: Supabase, id: string) {
  return supabase
    .from("event")
    .select(
      `id, title, kind, status, starts_at, ends_at, venue, expected_headcount, actual_headcount, satisfaction_score,
       lead_trainer_id, deal_id, cancel_reason, returns_closed_at, archived_at, created_at, updated_at,
       institution:institution!inner(id, name, kind, city, district, archived_at),
       lead:staff!event_lead_trainer_id_fkey(full_name),
       archiver:staff!event_archived_by_fkey(full_name),
       team:event_staff(staff_id, role, staff:staff(full_name)),
       cohort(code),
       run_sheet_item(id, phase, label, sort, done_at, done_by, doneBy:staff!run_sheet_item_done_by_fkey(full_name))`,
    )
    .eq("id", id)
    .order("sort", { referencedTable: "run_sheet_item", ascending: true })
    .maybeSingle();
}

export type EventDetail = NonNullable<Awaited<ReturnType<typeof getEvent>>["data"]>;

/** Open tasks hanging off an event (trainer request, kit reservation, post-event work). */
export async function listEventTasks(supabase: Supabase, eventId: string) {
  return supabase
    .from("task")
    .select("id, title, department, status, due_date, priority, assignee:staff!task_assignee_id_fkey(full_name)")
    .eq("entity_type", "event")
    .eq("entity_id", eventId)
    .order("created_at", { ascending: true })
    .limit(50);
}

/** Institution picker for the New event dialog (active, not archived). */
export async function eventInstitutionOptions(supabase: Supabase) {
  return supabase.from("institution").select("id, name, city").is("archived_at", null).order("name").limit(1000);
}
