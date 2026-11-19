import "server-only";
import type { Me } from "@/lib/permissions";
import { KIND_LABELS, type ActivityKind } from "@/lib/schemas/activity";
import {
  MEETING_KIND_LABELS, addDays, allDayRange, viewRange, type CalItem, type CalParams, type MeetingKind,
} from "@/lib/schemas/calendar";
import { DEAL_STAGE_LABELS, OPEN_STAGES, type DealStage } from "@/lib/schemas/deal";
import { EVENT_KIND_LABELS, istDay, type EventKind } from "@/lib/schemas/event";
import { taskCalendarItems, type CalendarTask } from "@/lib/task-calendar";
import { LEAD_DAYS } from "@/lib/task-health";
import { todayIST } from "@/lib/format";
import { createClient } from "@/utils/supabase/server";

// Read queries for the calendar (0022, D45). RLS decides what a person can see; the scope (me / a person / team /
// everyone) only narrows what RLS already allows. Meetings and Workshop events carry a clock time; tasks, deals and
// content are dated (all day); outreach is what the person logged. Explicit columns and bounded result sets.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const LIMIT = 500;
const OPEN = ["requested", "scheduled"];
const ACTIVITY_MINUTES = 30;

const MEETING_ROW =
  "id, title, kind, department, status, starts_at, ends_at, location, organizer_id, host_id, awaiting_id, series_id, attendees:meeting_attendee(staff_id, rsvp), institution:institution(name)";
const EVENT_ROW = "id, title, kind, status, starts_at, ends_at, venue, lead_trainer_id, institution:institution!inner(name, owner_id)";

type MeetingRow = {
  id: string; title: string; kind: string; department: string | null; status: string; starts_at: string; ends_at: string;
  location: string | null; organizer_id: string; host_id: string | null; awaiting_id: string | null; series_id: string | null;
  attendees: { staff_id: string; rsvp: string }[]; institution: { name: string } | null;
};
type EventRow = {
  id: string; title: string; kind: string; status: string; starts_at: string | null; ends_at: string | null; venue: string | null;
  lead_trainer_id: string | null; institution: { name: string; owner_id: string | null } | null;
};

function meetingItem(m: MeetingRow, me: Me): CalItem {
  const mine = m.attendees.find((a) => a.staff_id === me.id);
  const pending = m.status === "requested";
  return {
    key: `m:${m.id}`,
    source: "meeting",
    group: "meeting",
    id: m.id,
    href: `/calendar/${m.id}`,
    title: m.title,
    starts_at: m.starts_at,
    ends_at: m.ends_at,
    allDay: false,
    kind: m.kind,
    kindLabel: MEETING_KIND_LABELS[m.kind as MeetingKind] ?? m.kind,
    department: m.department,
    status: m.status,
    pending,
    needsMe: (pending && m.awaiting_id === me.id) || (m.status === "scheduled" && mine?.rsvp === "invited" && m.organizer_id !== me.id),
    done: false,
    place: m.location,
    recurring: m.series_id !== null,
    people: m.attendees.length,
    institution: m.institution?.name ?? null,
    role: null,
    when: null,
  };
}

function eventItem(e: EventRow, subject: string | null, helps: Set<string>): CalItem | null {
  if (!e.starts_at || !e.ends_at) return null;
  const role = !subject ? null : e.lead_trainer_id === subject ? "Leading" : helps.has(e.id) ? "Helping" : "Your institution";
  return {
    key: `e:${e.id}`,
    source: "event",
    group: "workshop",
    id: e.id,
    href: `/workshop/${e.id}`,
    title: e.title,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    allDay: false,
    kind: e.kind,
    kindLabel: EVENT_KIND_LABELS[e.kind as EventKind] ?? e.kind,
    department: "workshop",
    status: e.status,
    pending: false,
    needsMe: false,
    done: e.status === "completed",
    place: e.venue,
    recurring: false,
    people: 0,
    institution: e.institution?.name ?? null,
    role,
    when: null,
  };
}

/** Ids of the people in a department, for the Team scope. */
async function departmentStaff(supabase: Supabase, dept: string): Promise<string[]> {
  const { data } = await supabase.from("staff").select("id").eq("is_active", true).contains("departments", [dept]).limit(500);
  return (data ?? []).map((r) => r.id);
}

/** Meeting ids that have one of these people as an attendee and touch [from, to). */
async function meetingIdsFor(supabase: Supabase, staffIds: string[], from: string, to: string): Promise<string[]> {
  if (staffIds.length === 0) return [];
  const { data } = await supabase
    .from("meeting_attendee")
    .select("meeting_id, meeting:meeting!inner(starts_at, ends_at, status)")
    .in("staff_id", staffIds)
    .in("meeting.status", OPEN)
    .lt("meeting.starts_at", to)
    .gt("meeting.ends_at", from)
    .limit(LIMIT * 2);
  return [...new Set((data ?? []).map((r) => r.meeting_id))].slice(0, LIMIT);
}

async function meetingsByIds(supabase: Supabase, ids: string[]): Promise<MeetingRow[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("meeting").select(MEETING_ROW).in("id", ids).order("starts_at", { ascending: true }).limit(LIMIT);
  return (data ?? []) as unknown as MeetingRow[];
}

/**
 * Workshop events a set of people lead, help with, or own the institution of, touching [from, to).
 * `helps` lists the events they are an assistant on, so the calendar can say "Helping".
 */
async function eventsFor(supabase: Supabase, staffIds: string[] | null, from: string, to: string): Promise<{ rows: EventRow[]; helps: Set<string> }> {
  const base = () =>
    supabase
      .from("event")
      .select(EVENT_ROW)
      .is("archived_at", null)
      .not("status", "in", "(cancelled,draft)")
      .lt("starts_at", to)
      .gt("ends_at", from)
      .order("starts_at", { ascending: true })
      .limit(LIMIT);
  if (!staffIds) {
    const { data } = await base();
    return { rows: (data ?? []) as unknown as EventRow[], helps: new Set() };
  }
  if (staffIds.length === 0) return { rows: [], helps: new Set() };
  const { data: helpRows } = await supabase.from("event_staff").select("event_id").in("staff_id", staffIds).limit(1000);
  const helpIds = [...new Set((helpRows ?? []).map((r) => r.event_id))];
  const lead = `lead_trainer_id.in.(${staffIds.join(",")})`;
  const [mine, owned] = await Promise.all([
    base().or(helpIds.length > 0 ? `${lead},id.in.(${helpIds.join(",")})` : lead),
    base().in("institution.owner_id", staffIds),
  ]);
  const rows = new Map<string, EventRow>();
  for (const r of [...(mine.data ?? []), ...(owned.data ?? [])] as unknown as EventRow[]) rows.set(r.id, r);
  const sorted = [...rows.values()].sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? ""));
  return { rows: sorted, helps: new Set(helpIds) };
}

type Subject = { ids: string[] | null; single: string | null; dept: string };

type TaskRow = CalendarTask & { due_time: string | null; assignee_id: string | null };

const TASK_COLUMNS = "id, title, status, due_date, due_time, department, assignee_id, start_date, estimate_minutes, accepted_at, updated_at";
const CARRY_LIMIT = 200;

function scopeTasks<T extends { or: (f: string) => T; in: (c: string, v: string[]) => T }>(q: T, subject: Subject): T {
  if (!subject.ids) return q;
  const mine = `assignee_id.in.(${subject.ids.join(",")})`;
  return subject.dept ? q.or(`${mine},department.eq.${subject.dept}`) : q.in("assignee_id", subject.ids);
}

/**
 * Tasks due in the window, plus those due up to LEAD_DAYS after it (their lead-up reminders fall inside it), plus,
 * when today is in view, the open tasks that are already overdue (carried onto today).
 */
async function tasksFor(supabase: Supabase, subject: Subject, fromDay: string, toDay: string, today: string): Promise<TaskRow[]> {
  if (subject.ids && subject.ids.length === 0) return [];
  const main = scopeTasks(
    supabase.from("task").select(TASK_COLUMNS).gte("due_date", fromDay).lt("due_date", addDays(toDay, LEAD_DAYS)).neq("status", "cancelled"),
    subject,
  )
    .order("due_date", { ascending: true })
    .limit(LIMIT);
  const carry =
    today >= fromDay && today < toDay
      ? scopeTasks(supabase.from("task").select(TASK_COLUMNS).lt("due_date", fromDay).in("status", ["todo", "doing", "blocked"]), subject)
          .order("due_date", { ascending: false })
          .limit(CARRY_LIMIT)
      : null;
  const [a, b] = await Promise.all([main, carry ?? Promise.resolve({ data: [] })]);
  return [...(a.data ?? []), ...(b.data ?? [])] as TaskRow[];
}

async function outreachFor(supabase: Supabase, subject: Subject, from: string, to: string): Promise<CalItem[]> {
  let q = supabase
    .from("activity")
    .select("id, kind, outcome, happened_at, institution_id, institution:institution(name)")
    .gte("happened_at", from)
    .lt("happened_at", to);
  if (subject.ids) {
    if (subject.ids.length === 0) return [];
    q = q.in("staff_id", subject.ids);
  }
  const { data } = await q.order("happened_at", { ascending: true }).limit(LIMIT);
  return (data ?? []).map((a) => {
    const kind = KIND_LABELS[a.kind as ActivityKind] ?? a.kind;
    const institution = (a.institution as { name: string } | null)?.name ?? null;
    return {
      key: `a:${a.id}`,
      source: "activity" as const,
      group: "other" as const,
      id: a.id,
      href: `/institutions/${a.institution_id}`,
      title: institution ? `${kind} · ${institution}` : kind,
      starts_at: a.happened_at,
      ends_at: new Date(new Date(a.happened_at).getTime() + ACTIVITY_MINUTES * 60_000).toISOString(),
      allDay: false,
      kind: a.kind,
      kindLabel: kind,
      department: "outreach",
      status: a.outcome ?? "logged",
      pending: false,
      needsMe: false,
      done: false,
      place: null,
      recurring: false,
      people: 0,
      institution,
      role: null,
      when: null,
    };
  });
}

async function dealsFor(supabase: Supabase, subject: Subject, fromDay: string, toDay: string): Promise<CalItem[]> {
  let q = supabase
    .from("deal")
    .select("id, title, stage, expected_close, institution:institution(name)")
    .is("archived_at", null)
    .in("stage", [...OPEN_STAGES])
    .gte("expected_close", fromDay)
    .lt("expected_close", toDay);
  if (subject.ids) {
    if (subject.ids.length === 0) return [];
    q = q.in("owner_id", subject.ids);
  }
  const { data } = await q.order("expected_close", { ascending: true }).limit(LIMIT);
  return (data ?? []).flatMap((d) => {
    if (!d.expected_close) return [];
    return [{
      key: `d:${d.id}`,
      source: "deal" as const,
      group: "other" as const,
      id: d.id,
      href: `/sales/${d.id}`,
      title: d.title,
      ...allDayRange(d.expected_close),
      allDay: true,
      kind: "deal",
      kindLabel: "Deal expected to close",
      department: "sales",
      status: DEAL_STAGE_LABELS[d.stage as DealStage] ?? d.stage,
      pending: false,
      needsMe: false,
      done: false,
      place: null,
      recurring: false,
      people: 0,
      institution: (d.institution as { name: string } | null)?.name ?? null,
      role: null,
      when: "Expected close",
    }];
  });
}

async function contentFor(supabase: Supabase, subject: Subject, fromDay: string, toDay: string): Promise<CalItem[]> {
  let q = supabase
    .from("content_item")
    .select("id, title, kind, stage, platform, publish_date")
    .gte("publish_date", fromDay)
    .lt("publish_date", toDay);
  if (subject.ids) {
    if (subject.ids.length === 0) return [];
    q = q.in("owner_id", subject.ids);
  }
  const { data } = await q.order("publish_date", { ascending: true }).limit(LIMIT);
  return (data ?? []).flatMap((c) => {
    if (!c.publish_date) return [];
    return [{
      key: `c:${c.id}`,
      source: "content" as const,
      group: "other" as const,
      id: c.id,
      href: "/community",
      title: c.title,
      ...allDayRange(c.publish_date),
      allDay: true,
      kind: "content",
      kindLabel: "Content to publish",
      department: "community",
      status: c.stage,
      pending: false,
      needsMe: false,
      done: c.stage === "published",
      place: c.platform,
      recurring: false,
      people: 0,
      institution: null,
      role: null,
      when: "Publish",
    }];
  });
}

async function resolveSubject(supabase: Supabase, me: Me, p: Pick<CalParams, "scope" | "dept" | "who">): Promise<Subject> {
  if (p.scope === "me") return { ids: [me.id], single: me.id, dept: "" };
  if (p.scope === "person") {
    const who = p.who || me.id;
    return { ids: [who], single: who, dept: "" };
  }
  if (p.scope === "team") {
    const dept = p.dept || me.departments[0] || "";
    return { ids: dept ? await departmentStaff(supabase, dept) : [me.id], single: null, dept };
  }
  return { ids: null, single: null, dept: "" };
}

/**
 * Everything one calendar view shows for the scope: Workshop events, meetings, dated tasks, and outreach, deals and
 * content, narrowed by the "show" filter. `truncated` says a source hit its row limit (narrow the view).
 */
export async function listCalendarItems(supabase: Supabase, me: Me, p: CalParams): Promise<{ items: CalItem[]; truncated: boolean }> {
  const { from, to } = viewRange(p.view, p.date);
  const fromDay = istDay(from);
  const toDay = istDay(to);
  const now = new Date();
  const subject = await resolveSubject(supabase, me, p);
  const want = {
    workshops: p.show === "all" || p.show === "workshops",
    meetings: p.show === "all" || p.show === "meetings",
    tasks: p.show === "all" || p.show === "tasks",
    other: p.show === "all" || p.show === "other",
  };

  const meetingsQuery = async (): Promise<MeetingRow[]> => {
    if (!want.meetings) return [];
    if (!subject.ids) {
      const { data } = await supabase
        .from("meeting")
        .select(MEETING_ROW)
        .in("status", OPEN)
        .lt("starts_at", to)
        .gt("ends_at", from)
        .order("starts_at", { ascending: true })
        .limit(LIMIT);
      return (data ?? []) as unknown as MeetingRow[];
    }
    const ids = new Set(await meetingIdsFor(supabase, subject.ids, from, to));
    if (subject.dept) {
      const { data } = await supabase
        .from("meeting")
        .select("id")
        .eq("department", subject.dept as never)
        .in("status", OPEN)
        .lt("starts_at", to)
        .gt("ends_at", from)
        .limit(LIMIT);
      for (const r of data ?? []) ids.add(r.id);
    }
    return meetingsByIds(supabase, [...ids].slice(0, LIMIT));
  };

  // The Workshop department's team calendar is every event, not only the ones its people lead.
  const eventStaff = subject.dept === "workshop" ? null : subject.ids;
  const [meetings, events, tasks, outreach, deals, content] = await Promise.all([
    meetingsQuery(),
    want.workshops ? eventsFor(supabase, eventStaff, from, to) : Promise.resolve({ rows: [] as EventRow[], helps: new Set<string>() }),
    want.tasks ? tasksFor(supabase, subject, fromDay, toDay, todayIST()) : Promise.resolve([] as TaskRow[]),
    want.other ? outreachFor(supabase, subject, from, to) : Promise.resolve([] as CalItem[]),
    want.other ? dealsFor(supabase, subject, fromDay, toDay) : Promise.resolve([] as CalItem[]),
    want.other ? contentFor(supabase, subject, fromDay, toDay) : Promise.resolve([] as CalItem[]),
  ]);

  const truncated = [meetings.length, events.rows.length, tasks.length, outreach.length, deals.length, content.length].some((n) => n >= LIMIT);
  const items = [
    ...events.rows.map((e) => eventItem(e, subject.single, events.helps)).filter((i): i is CalItem => i !== null),
    ...meetings.map((m) => meetingItem(m, me)),
    ...tasks.flatMap((t) => taskCalendarItems(t, { fromDay, toDay, now })),
    ...outreach,
    ...deals,
    ...content,
  ];
  return { items: items.sort((a, b) => a.starts_at.localeCompare(b.starts_at)), truncated };
}

/** What waits for me: requests I must answer and invitations I have not answered yet (upcoming only). */
export async function listWaitingForMe(supabase: Supabase, me: Me) {
  const now = new Date().toISOString();
  const [requests, invites] = await Promise.all([
    supabase
      .from("meeting")
      .select("id, title, kind, starts_at, ends_at, organizer:staff!meeting_organizer_id_fkey(full_name)")
      .eq("status", "requested")
      .eq("awaiting_id", me.id)
      .gt("ends_at", now)
      .order("starts_at", { ascending: true })
      .limit(50),
    supabase
      .from("meeting_attendee")
      .select("meeting_id, meeting:meeting!inner(id, title, kind, starts_at, ends_at, organizer_id, status, organizer:staff!meeting_organizer_id_fkey(full_name))")
      .eq("staff_id", me.id)
      .eq("rsvp", "invited")
      .eq("meeting.status", "scheduled")
      .neq("meeting.organizer_id", me.id)
      .gt("meeting.ends_at", now)
      .limit(50),
  ]);
  const invitations = (invites.data ?? [])
    .map((r) => r.meeting)
    .filter((m): m is NonNullable<typeof m> => !!m)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return { requests: requests.data ?? [], invitations };
}

/** Requests I sent that still wait for an answer. */
export async function listMyOpenRequests(supabase: Supabase, me: Me) {
  return supabase
    .from("meeting")
    .select("id, title, starts_at, ends_at, awaiting_id, host_id, host:staff!meeting_host_id_fkey(full_name), awaiting:staff!meeting_awaiting_id_fkey(full_name)")
    .eq("status", "requested")
    .eq("organizer_id", me.id)
    .gt("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(50);
}

/** A person's meetings and Workshop events in a window, for the My day card. */
export async function listScheduleBetween(supabase: Supabase, me: Me, from: string, to: string): Promise<CalItem[]> {
  const [meetings, events] = await Promise.all([
    meetingsByIds(supabase, await meetingIdsFor(supabase, [me.id], from, to)),
    eventsFor(supabase, [me.id], from, to),
  ]);
  return [
    ...meetings.map((m) => meetingItem(m, me)),
    ...events.rows.map((e) => eventItem(e, me.id, events.helps)).filter((i): i is CalItem => i !== null),
  ].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/** One meeting with everything the detail page shows. Null data = not found or not visible. */
export async function getMeeting(supabase: Supabase, id: string) {
  return supabase
    .from("meeting")
    .select(
      `id, title, description, kind, department, visibility, status, starts_at, ends_at, location, organizer_id, host_id, awaiting_id,
       cancel_reason, institution_id, deal_id, event_id, series_id, occurrence_date, customised, created_at, updated_at,
       organizer:staff!meeting_organizer_id_fkey(full_name),
       host:staff!meeting_host_id_fkey(full_name),
       awaiting:staff!meeting_awaiting_id_fkey(full_name),
       institution:institution(id, name, city),
       event:event(id, title),
       series:meeting_series(id, title, frequency, weekday, month_day, start_time, active, organizer_id),
       attendees:meeting_attendee(staff_id, rsvp, note, responded_at, staff:staff!meeting_attendee_staff_id_fkey(full_name))`,
    )
    .eq("id", id)
    .maybeSingle();
}

export type MeetingDetail = NonNullable<Awaited<ReturnType<typeof getMeeting>>["data"]>;

/** Busy people in a window, from ops.calendar_busy. A warning source only: a double booking is never blocked. */
export async function listBusy(supabase: Supabase, staffIds: string[], from: string, to: string, exclude?: string | null) {
  const { data } = await supabase.rpc("calendar_busy", { p_staff: staffIds, p_from: from, p_to: to, p_exclude: exclude ?? undefined });
  return data ?? [];
}

/** Fixed meetings I can see: mine, ones I am in, and my departments'. */
export async function listSeries(supabase: Supabase) {
  return supabase
    .from("meeting_series")
    .select(
      "id, title, description, kind, department, visibility, frequency, weekday, month_day, start_time, duration_minutes, location, starts_on, ends_on, all_department, staff_ids, active, organizer_id, organizer:staff!meeting_series_organizer_id_fkey(full_name)",
    )
    .order("active", { ascending: false })
    .order("title")
    .limit(200);
}

export type SeriesRow = NonNullable<Awaited<ReturnType<typeof listSeries>>["data"]>[number];

/** Active people a meeting can invite (never a partner). */
export async function listPeople(supabase: Supabase) {
  return supabase
    .from("staff")
    .select("id, full_name, role, departments")
    .eq("is_active", true)
    .neq("role", "partner")
    .order("full_name")
    .limit(500);
}

export type Person = NonNullable<Awaited<ReturnType<typeof listPeople>>["data"]>[number];
