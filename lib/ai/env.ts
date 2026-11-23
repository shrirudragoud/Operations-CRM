import "server-only";
import type { CurrentTask, DraftKind } from "@/lib/ai/drafts";
import type { Person, TaskBrief, TaskDetailView, ToolEnv, WorkloadRow } from "@/lib/ai/tools";
import type { Json } from "@/lib/db.types";
import { dbErrorMessage } from "@/lib/errors";
import { todayIST } from "@/lib/format";
import type { LeaveRequestView } from "@/lib/ai/areas/leave";
import { getTimelinessRows, TIMELINESS_LIMIT } from "@/lib/queries/cockpit";
import { getMeeting, listBusy, listCalendarItems, listWaitingForMe } from "@/lib/queries/calendar";
import { getBalances, getAway, listMyRequests, listPendingRequests } from "@/lib/queries/leave";
import { listFollowUps } from "@/lib/queries/outreach";
import { getDeal, listBoard, pipelineRows } from "@/lib/queries/sales";
import { getInstitution360, listInstitutions } from "@/lib/queries/institution";
import { getEvent, listEvents } from "@/lib/queries/workshop";
import { listLowStock, listReservations, listStock } from "@/lib/queries/inventory";
import { normalizeRows } from "@/lib/ops-insight";
import { getParentTask, getTask, listSubtasks, listTaskComments, listTaskHistory, sharedOwners } from "@/lib/queries/tasks";
import type { Me } from "@/lib/permissions";
import type { TaskStatus } from "@/lib/schemas/activity";
import { parseSalesParams } from "@/lib/schemas/deal";
import { parseWorkshopParams } from "@/lib/schemas/event";
import { cleanSearch, DEFAULT_LIST_PARAMS } from "@/lib/schemas/institution";
import { describeHistory, OPEN_TASK_STATUSES } from "@/lib/schemas/task";
import type { createClient } from "@/utils/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const BRIEF = "id, title, status, priority, due_date, due_time, department, assignee_id, parent_task_id, assignee:staff!task_assignee_id_fkey(full_name)";

/** The assistant's window onto the data: the person's own Supabase session, so RLS decides what exists for them. */
export function buildToolEnv(supabase: Supabase, me: Me, conversationId: string): ToolEnv {
  let roster: Promise<Person[]> | null = null;

  return {
    me,
    today: todayIST(),

    people() {
      roster ??= (async () => {
        const { data } = await supabase.from("staff").select("id, full_name, role, departments").eq("is_active", true).order("full_name").limit(500);
        return (data ?? []).map((p) => ({ id: p.id, full_name: p.full_name, role: p.role, departments: p.departments as string[] }));
      })();
      return roster;
    },

    async searchTasks(f) {
      let q = supabase.from("task").select(BRIEF, { count: "exact" });
      if (f.statuses) q = q.in("status", f.statuses);
      const words = f.query ? cleanSearch(f.query) : "";
      if (words) q = q.ilike("title", `%${words}%`);
      if (f.assignee_id) q = q.eq("assignee_id", f.assignee_id);
      if (f.unassigned) q = q.is("assignee_id", null);
      if (f.created_by_me) q = q.eq("created_by", me.id);
      if (f.department) q = q.eq("department", f.department as never);
      if (f.overdue) q = q.lt("due_date", todayIST());
      if (f.due_from) q = q.gte("due_date", f.due_from);
      if (f.due_to) q = q.lte("due_date", f.due_to);
      if (f.parent_task_id) q = q.eq("parent_task_id", f.parent_task_id);
      const { data, count } = await q.order("due_date", { ascending: true, nullsFirst: false }).order("priority", { ascending: true }).order("id").limit(f.limit);
      const rows: TaskBrief[] = (data ?? []).map((t) => ({
        id: t.id, title: t.title, status: t.status as TaskStatus, priority: t.priority, due_date: t.due_date, due_time: t.due_time,
        department: t.department, assignee_id: t.assignee_id, assignee: t.assignee?.full_name ?? null, parent_task_id: t.parent_task_id,
      }));
      return { rows, total: count ?? rows.length };
    },

    async currentTask(id) {
      const { data } = await getTask(supabase, id);
      return data ? toCurrent(data) : null;
    },

    async taskDetail(id): Promise<TaskDetailView | null> {
      const { data: t } = await getTask(supabase, id);
      if (!t) return null;
      const [subs, comments, history, owners, parent] = await Promise.all([
        listSubtasks(supabase, id),
        listTaskComments(supabase, id),
        listTaskHistory(supabase, id),
        t.shared ? sharedOwners(supabase, [id]) : Promise.resolve(new Map<string, { full_name: string }[]>()),
        t.parent_task_id ? getParentTask(supabase, t.parent_task_id) : Promise.resolve(null),
      ]);
      return {
        ...toCurrent(t),
        assignee: t.assignee?.full_name ?? null,
        assignee_id: t.assignee_id,
        creator: t.creator?.full_name ?? null,
        created_at: t.created_at,
        blocked_reason: t.blocked_reason,
        cancel_reason: t.cancel_reason,
        parent: parent?.data ? { id: parent.data.id, title: parent.data.title } : null,
        shared_owners: (owners.get(id) ?? []).map((o) => o.full_name),
        subtasks: (subs.data ?? []).map((s) => ({ id: s.id, title: s.title, status: s.status as TaskStatus, due_date: s.due_date, assignee: s.assignee?.full_name ?? null })),
        comments: (comments.data ?? []).map((c) => ({ author: c.author?.full_name ?? "Someone", at: todayIST(new Date(c.created_at)), body: c.body })),
        history: (history.data ?? []).map((h) => `${h.actor?.full_name ?? "Someone"} ${describeHistory(h)} (${todayIST(new Date(h.at))})`),
      };
    },

    async taskTitles(ids) {
      const { data } = await supabase.from("task").select("id, title").in("id", ids.slice(0, 100));
      return new Map((data ?? []).map((t) => [t.id, t.title]));
    },

    async workloadRows(): Promise<WorkloadRow[]> {
      const { data } = await supabase.from("task").select("assignee_id, status, due_date").in("status", [...OPEN_TASK_STATUSES]).limit(5000);
      return (data ?? []).map((r) => ({ assignee_id: r.assignee_id, status: r.status as TaskStatus, due_date: r.due_date }));
    },

    async pendingDrafts() {
      const { data } = await supabase.from("ai_action").select("id, kind, payload").eq("conversation_id", conversationId).eq("status", "pending").limit(100);
      return (data ?? []).map((d) => ({ id: d.id, kind: d.kind, payload: (d.payload ?? {}) as Record<string, unknown> }));
    },

    async saveDraft(d: { kind: DraftKind; payload: Record<string, unknown>; summary: string }) {
      const { data, error } = await supabase
        .from("ai_action")
        .insert({ conversation_id: conversationId, kind: d.kind, payload: d.payload as Json, summary: d.summary })
        .select("id")
        .single();
      if (error) return { error: dbErrorMessage(error) };
      return { id: data.id };
    },

    calendar: {
      items: (p) => listCalendarItems(supabase, me, { ...p, view: "agenda" }),

      async meeting(id) {
        const { data: m } = await getMeeting(supabase, id);
        if (!m) return null;
        return {
          id: m.id, title: m.title, description: m.description, kind: m.kind, department: m.department, visibility: m.visibility, status: m.status,
          starts_at: m.starts_at, ends_at: m.ends_at, location: m.location, cancel_reason: m.cancel_reason, organizer_id: m.organizer_id,
          organizer: m.organizer?.full_name ?? null, host: m.host?.full_name ?? null, awaiting: m.awaiting?.full_name ?? null,
          institution: m.institution ? { id: m.institution.id, name: m.institution.name } : null,
          event: m.event ? { id: m.event.id, title: m.event.title } : null,
          recurring: m.series_id !== null,
          attendees: (m.attendees ?? []).map((a) => ({ staff_id: a.staff_id, name: a.staff?.full_name ?? "Someone", rsvp: a.rsvp })),
        };
      },

      busy: (staffIds, from, to) => listBusy(supabase, staffIds, from, to),

      async waiting() {
        const w = await listWaitingForMe(supabase, me);
        const row = (m: { id: string; title: string; kind: string; starts_at: string; ends_at: string; organizer: { full_name: string } | null }) => ({
          id: m.id, title: m.title, kind: m.kind, starts_at: m.starts_at, ends_at: m.ends_at, from: m.organizer?.full_name ?? null,
        });
        return { requests: w.requests.map(row), invitations: w.invitations.map(row) };
      },
    },

    workshop: {
      async events(p) {
        const { data, count } = await listEvents(supabase, me, { ...parseWorkshopParams({}), status: p.status, kind: p.kind, scope: p.mine ? "mine" : "all" });
        const rows = (data ?? []).map((e) => ({
          id: e.id, title: e.title, kind: e.kind, status: e.status, starts_at: e.starts_at, ends_at: e.ends_at, venue: e.venue,
          expected_headcount: e.expected_headcount, lead_trainer_id: e.lead_trainer_id, lead: e.lead?.full_name ?? null,
          institution: e.institution ? { id: e.institution.id, name: e.institution.name, city: e.institution.city } : null,
        }));
        return { rows, total: count ?? rows.length };
      },

      async event(id) {
        const { data: e } = await getEvent(supabase, id);
        if (!e) return null;
        return {
          id: e.id, title: e.title, kind: e.kind, status: e.status, starts_at: e.starts_at, ends_at: e.ends_at, venue: e.venue,
          expected_headcount: e.expected_headcount, lead_trainer_id: e.lead_trainer_id, lead: e.lead?.full_name ?? null,
          institution: e.institution ? { id: e.institution.id, name: e.institution.name, city: e.institution.city } : null,
          actual_headcount: e.actual_headcount, satisfaction_score: e.satisfaction_score, cancel_reason: e.cancel_reason, archived: e.archived_at !== null,
          team: (e.team ?? []).map((t) => ({ staff_id: t.staff_id, name: t.staff?.full_name ?? "Someone", role: t.role })),
          run_sheet: (e.run_sheet_item ?? []).map((r) => ({ id: r.id, phase: r.phase, label: r.label, done: r.done_at !== null })),
        };
      },

      async trainers(from, to, excludeEvent) {
        const { data } = await supabase.rpc("available_trainers", { p_from: from, p_to: to, ...(excludeEvent ? { p_exclude_event: excludeEvent } : {}) });
        return data ?? [];
      },
    },

    sales: {
      async institutions(p) {
        const { data, count } = await listInstitutions(supabase, { ...DEFAULT_LIST_PARAMS, q: p.q, stage: p.stage, kind: p.kind, district: p.district, owner: p.mine ? me.id : null });
        const rows = (data ?? []).map((i) => ({ id: i.id, name: i.name, kind: i.kind, city: i.city, district: i.district, stage: i.stage, owner: i.owner?.full_name ?? null }));
        return { rows, total: count ?? rows.length };
      },

      async institution(id) {
        const { data: i } = await getInstitution360(supabase, id);
        if (!i) return null;
        return {
          id: i.id, name: i.name, kind: i.kind, city: i.city, district: i.district, stage: i.stage, owner: i.owner?.full_name ?? null,
          affiliation: i.affiliation, state: i.state, source: i.source, notes: i.notes, archived: i.archived_at !== null,
          contacts: (i.contacts ?? []).map((c) => ({ name: c.full_name, designation: c.designation, influence: c.influence, phone: c.phone, email: c.email })),
          activities: (i.activities ?? []).map((a) => ({ id: a.id, kind: a.kind, outcome: a.outcome, notes: a.notes, happened_at: a.happened_at, next_step: a.next_step, next_step_due: a.next_step_due, author: a.author?.full_name ?? null })),
          deals: (i.deals ?? []).map((d) => ({ id: d.id, title: d.title, kind: d.kind, stage: d.stage, value_inr: d.value_inr, expected_close: d.expected_close, archived: d.archived_at !== null })),
          events: (i.events ?? []).map((e) => ({ id: e.id, title: e.title, kind: e.kind, status: e.status, starts_at: e.starts_at, archived: e.archived_at !== null })),
        };
      },

      async board(p) {
        const b = await listBoard(supabase, me, { ...parseSalesParams({}), kind: p.kind, scope: p.mine ? "mine" : "all" });
        const list = (r: { data: unknown[] | null; count: number | null }) => {
          const rows = ((r.data ?? []) as Awaited<ReturnType<typeof listBoard>>["open"]["data"] & object).map((d) => ({
            id: d.id, title: d.title, kind: d.kind, stage: d.stage, value_inr: d.value_inr, probability: d.probability, expected_close: d.expected_close,
            owner: d.owner?.full_name ?? null, institution: d.institution ? { id: d.institution.id, name: d.institution.name, city: d.institution.city } : null,
          }));
          return { rows, total: r.count ?? rows.length };
        };
        return { open: list(b.open), won: list(b.won), lost: list(b.lost) };
      },

      async deal(id) {
        const { data: d } = await getDeal(supabase, id);
        if (!d) return null;
        return {
          id: d.id, title: d.title, kind: d.kind, stage: d.stage, value_inr: d.value_inr, probability: d.probability, expected_close: d.expected_close,
          owner: d.owner?.full_name ?? null, owner_id: d.owner_id, institution: d.institution ? { id: d.institution.id, name: d.institution.name, city: d.institution.city } : null,
          lost_reason: d.lost_reason, won_at: d.won_at, archived: d.archived_at !== null,
          lines: (d.lines ?? []).map((l) => ({ description: l.description, qty: l.qty, unit_price_inr: l.unit_price_inr })),
          events: (d.events ?? []).map((e) => ({ id: e.id, title: e.title, status: e.status, starts_at: e.starts_at })),
        };
      },

      async pipeline() {
        const { data } = await pipelineRows(supabase);
        return (data ?? []).map((r) => ({ kind: r.kind ?? "", segment: r.segment ?? "", stage: r.stage ?? "", deals: r.deals ?? 0, value_inr: r.value_inr ?? 0, weighted_inr: r.weighted_inr ?? 0 }));
      },

      async followUps(mine) {
        const r = await listFollowUps(supabase, me, mine ? "mine" : "all");
        const rows = r.rows.map((t) => ({
          id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, assignee: t.assignee?.full_name ?? null,
          institution_id: t.entity_id, institution: t.entity_id ? (r.institutions.get(t.entity_id) ?? null) : null,
        }));
        return { rows, total: "count" in r && typeof r.count === "number" ? r.count : rows.length };
      },
    },

    leave: {
      async balances() {
        const { data } = await getBalances(supabase, me.id);
        return data;
      },
      async myRequests() {
        const { data } = await listMyRequests(supabase, me.id);
        return data.map(toLeaveView);
      },
      async away(from, to) {
        const { data } = await getAway(supabase, from, to);
        return data;
      },
      async pending() {
        const { data } = await listPendingRequests(supabase, me.id);
        return data.map((r) => ({ ...toLeaveView(r), person: r.staff_name }));
      },
    },

    inventory: {
      stock: (q) => listStock(supabase, q),
      lowStock: () => listLowStock(supabase),
      reservations: (eventId) => listReservations(supabase, eventId),
    },

    insights: {
      async taskRows(since) {
        const { data } = await getTimelinessRows(supabase, since);
        const raw = data ?? [];
        return { rows: normalizeRows(raw), truncated: raw.length >= TIMELINESS_LIMIT };
      },
    },
  };
}

const toLeaveView = (r: Awaited<ReturnType<typeof listMyRequests>>["data"][number]): LeaveRequestView => ({
  id: r.id, type_name: r.type_name, from_date: r.from_date, to_date: r.to_date, day_part: r.day_part, days: r.days, state: r.state, reason: r.reason, decision_note: r.decision_note,
});

function toCurrent(t: NonNullable<Awaited<ReturnType<typeof getTask>>["data"]>): CurrentTask {
  return {
    id: t.id, title: t.title, description: t.description, department: t.department, category: t.category, status: t.status as TaskStatus,
    start_date: t.start_date, due_date: t.due_date, due_time: t.due_time, priority: t.priority, estimate_minutes: t.estimate_minutes,
  };
}
