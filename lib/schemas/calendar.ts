import { z } from "zod";
import { DEPARTMENTS } from "@/lib/permissions";
import { todayIST } from "@/lib/format";
import { currentMonth, gridRange, isMonth, istDay, istLocalToIso, monthGrid } from "@/lib/schemas/event";
import type { Health } from "@/lib/task-health";

// The calendar (0022 and D45): meetings, fixed meetings, Workshop events and the dated work assigned to a person
// (tasks and follow-ups, outreach, deals, content) on one page. The database re-checks every
// rule (ops.meeting_guard, ops.meeting_attendee_guard, ops.answer_meeting_request, ops.meeting_series_guard);
// these schemas validate the forms and keep the URL state tidy.

const TZ = "Asia/Kolkata";
const IST_OFFSET = "+05:30";

export const MEETING_KINDS = ["team", "one_to_one", "review", "institution", "other"] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];
export const MEETING_KIND_LABELS: Record<MeetingKind, string> = {
  team: "Team meeting",
  one_to_one: "One to one",
  review: "Review",
  institution: "Institution call",
  other: "Other",
};

export const MEETING_STATUSES = ["requested", "scheduled", "cancelled", "declined"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  cancelled: "Cancelled",
  declined: "Declined",
};

export const RSVPS = ["invited", "accepted", "tentative", "declined"] as const;
export type Rsvp = (typeof RSVPS)[number];
export const RSVP_LABELS: Record<Rsvp, string> = { invited: "Waiting", accepted: "Going", tentative: "Maybe", declined: "Not going" };

export const VISIBILITIES = ["invitees", "department", "company"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const VISIBILITY_LABELS: Record<Visibility, string> = {
  invitees: "Only the people invited",
  department: "Everyone in the department",
  company: "Everyone at Hard-Code",
};

export const FREQUENCIES = ["weekly", "biweekly", "monthly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const FREQUENCY_LABELS: Record<Frequency, string> = { weekly: "Every week", biweekly: "Every two weeks", monthly: "Every month" };

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const SERIES_HORIZON_DAYS = 35;

// ---------------------------------------------------------------- dates and times (all India time)

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const hm = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isYmd = (v: string): boolean => ymd.test(v) && !Number.isNaN(new Date(`${v}T00:00:00${IST_OFFSET}`).getTime()) && istDay(`${v}T12:00:00${IST_OFFSET}`) === v;

export function addDays(day: string, n: number): string {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Monday = 1 ... Sunday = 7, the same numbering as the database (isodow). */
export function isoWeekday(day: string): number {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

export function weekStart(day: string): string {
  return addDays(day, 1 - isoWeekday(day));
}

export function weekDays(day: string): string[] {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** ISO instant of a India calendar day's midnight. */
export const dayStartIso = (day: string): string => new Date(`${day}T00:00:00${IST_OFFSET}`).toISOString();

/** "2026-12-01" + "09:30" in India time -> ISO instant, or null. */
export function istInstant(day: string, time: string): string | null {
  return istLocalToIso(`${day}T${time}`);
}

export function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
}

const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });

/** "10:30 am" in India time. */
export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso)).replace(/\s?(am|pm)/i, (_, s: string) => ` ${s.toLowerCase()}`);
}

export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)} - ${formatTime(endIso)}`;
}

/** "45 min", "1 h", "1 h 30 min". */
export function formatLength(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "10:00" -> "10:00 am", for fixed meeting summaries. */
export function clockLabel(time: string): string {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

const ordinal = (n: number): string => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

/** "Every Monday at 10:00 am", "Every other Tuesday at 4:00 pm", "On the 15th of every month at 10:00 am". */
export function seriesSummary(s: { frequency: Frequency; weekday: number | null; month_day: number | null; start_time: string }): string {
  const at = clockLabel(s.start_time.slice(0, 5));
  if (s.frequency === "monthly") return `On the ${ordinal(s.month_day ?? 1)} of every month at ${at}`;
  const day = WEEKDAY_NAMES[(s.weekday ?? 1) - 1] ?? "Monday";
  return `${s.frequency === "weekly" ? "Every" : "Every other"} ${day} at ${at}`;
}

// ---------------------------------------------------------------- the calendar page

export const CAL_SCOPES = ["me", "person", "team", "all"] as const;
export type CalScope = (typeof CAL_SCOPES)[number];
export const CAL_SCOPE_LABELS: Record<CalScope, string> = { me: "Me", person: "A person", team: "Team", all: "Everyone" };

export const CAL_VIEWS = ["month", "week", "agenda"] as const;
export type CalView = (typeof CAL_VIEWS)[number];
export const CAL_VIEW_LABELS: Record<CalView, string> = { month: "Month", week: "Week", agenda: "Agenda" };

export const CAL_SHOWS = ["all", "workshops", "meetings", "tasks", "other"] as const;
export type CalShow = (typeof CAL_SHOWS)[number];
export const CAL_SHOW_LABELS: Record<CalShow, string> = {
  all: "Everything",
  workshops: "Workshops",
  meetings: "Meetings",
  tasks: "Tasks and follow-ups",
  other: "Outreach, sales and content",
};

export const AGENDA_DAYS = 30;

export type CalParams = {
  scope: CalScope;
  dept: "" | (typeof DEPARTMENTS)[number];
  view: CalView;
  date: string;
  show: CalShow;
  /** The person shown when scope is "person". */
  who: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseCalParams(raw: Record<string, string | string[] | undefined>, defaults: { scope?: CalScope } = {}, now: Date = new Date()): CalParams {
  const scope = first(raw.scope);
  const dept = first(raw.dept);
  const view = first(raw.view);
  const date = first(raw.date);
  const show = first(raw.show);
  const month = first(raw.month);
  const who = first(raw.who);
  const day = isYmd(date) ? date : isMonth(month) ? `${month}-01` : todayIST(now);
  return {
    scope: (CAL_SCOPES as readonly string[]).includes(scope) ? (scope as CalScope) : (defaults.scope ?? "me"),
    dept: (DEPARTMENTS as readonly string[]).includes(dept) ? (dept as CalParams["dept"]) : "",
    view: (CAL_VIEWS as readonly string[]).includes(view) ? (view as CalView) : "month",
    date: day,
    show: (CAL_SHOWS as readonly string[]).includes(show) ? (show as CalShow) : "all",
    who: uuid.test(who) ? who.toLowerCase() : "",
  };
}

/** Build a calendar URL query, leaving defaults out. */
export function calQuery(p: Partial<CalParams>, defaults: { scope?: CalScope } = {}, now: Date = new Date()): string {
  const qs = new URLSearchParams();
  if (p.scope && p.scope !== (defaults.scope ?? "me")) qs.set("scope", p.scope);
  if (p.dept) qs.set("dept", p.dept);
  if (p.view && p.view !== "month") qs.set("view", p.view);
  if (p.date && p.date !== todayIST(now)) qs.set("date", p.date);
  if (p.show && p.show !== "all") qs.set("show", p.show);
  if (p.scope === "person" && p.who) qs.set("who", p.who);
  return qs.toString();
}

/** Move the visible range one step: a month, a week or an agenda page. */
export function stepDate(view: CalView, date: string, delta: number): string {
  if (view === "week") return addDays(date, 7 * delta);
  if (view === "agenda") return addDays(date, AGENDA_DAYS * delta);
  const [y = 0, m = 1] = date.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** The ISO window a view shows, and the India days it lists. */
export function viewRange(view: CalView, date: string): { from: string; to: string; days: string[] } {
  if (view === "week") {
    const days = weekDays(date);
    return { from: dayStartIso(days[0]!), to: dayStartIso(addDays(days[6]!, 1)), days };
  }
  if (view === "agenda") {
    const days = Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(date, i));
    return { from: dayStartIso(date), to: dayStartIso(addDays(date, AGENDA_DAYS)), days };
  }
  const month = date.slice(0, 7);
  const { from, to } = gridRange(month);
  return { from, to, days: monthGrid(month).flat() };
}

export function rangeTitle(view: CalView, date: string): string {
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...o }).format(new Date(`${d}T00:00:00Z`));
  if (view === "month") return fmt(`${date.slice(0, 7)}-01`, { month: "long", year: "numeric" });
  const days = view === "week" ? weekDays(date) : [date, addDays(date, AGENDA_DAYS - 1)];
  const a = days[0]!;
  const b = days[days.length - 1]!;
  return `${fmt(a, { day: "numeric", month: "short" })} - ${fmt(b, { day: "numeric", month: "short", year: "numeric" })}`;
}

export { currentMonth };

// ---------------------------------------------------------------- one thing on the calendar

export type CalSource = "meeting" | "event" | "task" | "activity" | "deal" | "content";
/** How the calendar groups things: workshop days first, then meetings, then tasks, then the rest. */
export type CalGroup = "workshop" | "meeting" | "task" | "other";
export const CAL_GROUPS: readonly CalGroup[] = ["workshop", "meeting", "task", "other"];
export const CAL_GROUP_LABELS: Record<CalGroup, string> = {
  workshop: "Workshops",
  meeting: "Meetings",
  task: "Tasks and follow-ups",
  other: "Outreach, sales and content",
};
const GROUP_RANK: Record<CalGroup, number> = { workshop: 0, meeting: 1, task: 2, other: 3 };

export type CalItem = {
  key: string;
  source: CalSource;
  group: CalGroup;
  id: string;
  href: string;
  title: string;
  starts_at: string;
  ends_at: string;
  /** Spans the whole day (a due date, an expected close): no clock time. */
  allDay: boolean;
  kind: string;
  kindLabel: string;
  department: string | null;
  status: string;
  /** A request that still waits for an answer. */
  pending: boolean;
  /** Waiting for me to answer (a request, or an invitation I have not answered). */
  needsMe: boolean;
  /** Finished work (a done task): shown dimmed. */
  done: boolean;
  place: string | null;
  recurring: boolean;
  people: number;
  /** The institution it is about, if any. */
  institution: string | null;
  /** The person's part in it: "Leading", "Helping", "Your institution", ... Only on a single person's calendar. */
  role: string | null;
  /** Ready-made time text for things that have no clock range, such as "Due 5:00 pm". */
  when: string | null;
  /** Tasks only (D48): how worried to be on this day. Absent on everything else. */
  health?: Health | null;
  /** A lead-up reminder or an overdue carry-forward, not the deadline itself: drawn dashed. */
  reminder?: boolean;
};

/** The one-day window of an all-day item, as ISO instants. */
export function allDayRange(day: string): { starts_at: string; ends_at: string } {
  return { starts_at: dayStartIso(day), ends_at: dayStartIso(addDays(day, 1)) };
}

/** India days an item covers, capped so a bad range cannot flood a view. */
export function itemDays(item: Pick<CalItem, "starts_at" | "ends_at">, cap = 62): string[] {
  const start = istDay(item.starts_at);
  // An item that ends exactly at midnight does not touch the next day.
  const end = istDay(new Date(new Date(item.ends_at).getTime() - 1).toISOString());
  const days: string[] = [];
  for (let d = start; d <= (end < start ? start : end) && days.length < cap; d = addDays(d, 1)) days.push(d);
  return days;
}

type DayItem = Pick<CalItem, "starts_at" | "ends_at"> & { group?: CalGroup };

export function itemsByDay<T extends DayItem>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    for (const day of itemDays(item)) {
      const list = map.get(day) ?? [];
      list.push(item);
      map.set(day, list);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.group ? GROUP_RANK[a.group] : 0) - (b.group ? GROUP_RANK[b.group] : 0) || a.starts_at.localeCompare(b.starts_at));
  }
  return map;
}

/** "Day 2 of 3" for an item that spans several India days, or null for a one-day item. */
export function dayPosition(item: Pick<CalItem, "starts_at" | "ends_at">, day: string): { n: number; of: number } | null {
  const days = itemDays(item);
  const n = days.indexOf(day);
  return days.length > 1 && n >= 0 ? { n: n + 1, of: days.length } : null;
}

export type Banner<T> = { item: T; col: number; span: number; continuesBefore: boolean; continuesAfter: boolean };

/** Lay multi-day items out as bars across one week (7 days), one bar per item, stacked in lanes so none overlap. */
export function layoutBanners<T extends Pick<CalItem, "starts_at" | "ends_at">>(items: T[], week: string[]): Banner<T>[][] {
  const first = week[0];
  const last = week[week.length - 1];
  if (!first || !last) return [];
  const bars: Banner<T>[] = [];
  for (const item of items) {
    const days = itemDays(item).filter((d) => d >= first && d <= last);
    const start = days[0];
    if (!start) continue;
    const all = itemDays(item);
    bars.push({
      item,
      col: week.indexOf(start),
      span: days.length,
      continuesBefore: all[0]! < first,
      continuesAfter: all[all.length - 1]! > last,
    });
  }
  bars.sort((a, b) => a.col - b.col || b.span - a.span || a.item.starts_at.localeCompare(b.item.starts_at));
  const lanes: Banner<T>[][] = [];
  for (const bar of bars) {
    const lane = lanes.find((l) => l.every((o) => bar.col >= o.col + o.span || bar.col + bar.span <= o.col));
    if (lane) lane.push(bar);
    else lanes.push([bar]);
  }
  return lanes;
}

/** Pairs of items that overlap in time (a double booking warning, never a block). */
export function overlaps<T extends Pick<CalItem, "key" | "starts_at" | "ends_at">>(items: T[]): Set<string> {
  const sorted = [...items].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const hit = new Set<string>();
  let reach: T | null = null;
  for (const it of sorted) {
    if (reach && it.starts_at < reach.ends_at) {
      hit.add(it.key);
      hit.add(reach.key);
      if (it.ends_at > reach.ends_at) reach = it;
    } else {
      reach = it;
    }
  }
  return hit;
}

// ---------------------------------------------------------------- forms

const title = z.string().trim().min(1, "Enter a title.").max(200, "Keep the title under 200 characters.");
const description = z.string().trim().max(4000, "Keep the notes under 4000 characters.");
const location = z.string().trim().max(300, "Keep the place under 300 characters.");
const optionalUuid = z.union([z.literal(""), z.uuid()]).transform((v) => (v === "" ? null : v));
const day = z.string().trim().refine(isYmd, "Pick a date.");
const time = z.string().trim().regex(hm, "Pick a time.");
const kind = z.enum(MEETING_KINDS, { message: "Choose the kind of meeting." });
const visibility = z.enum(VISIBILITIES, { message: "Choose who can see it." });
const department = z.union([z.literal(""), z.enum(DEPARTMENTS)]).transform((v) => (v === "" ? null : v));

const timeOrder = (v: { date: string; start_time: string; end_time: string }, ctx: z.RefinementCtx) => {
  if (v.end_time <= v.start_time) ctx.addIssue({ code: "custom", path: ["end_time"], message: "The end must be after the start." });
};

const meetingFields = {
  title,
  description,
  location,
  kind,
  visibility,
  department,
  date: day,
  start_time: time,
  end_time: time,
  attendees: z.array(z.uuid()).max(100, "Invite at most 100 people."),
  institution_id: optionalUuid,
};

function visibilityNeedsDepartment(v: { visibility: Visibility; department: string | null }, ctx: z.RefinementCtx) {
  if (v.visibility === "department" && !v.department) {
    ctx.addIssue({ code: "custom", path: ["department"], message: "Choose the department." });
  }
}

/** Schedule now (invitees answer) or request one person (they accept, decline or suggest another time). */
export const scheduleMeetingSchema = z
  .object({
    ...meetingFields,
    mode: z.enum(["schedule", "request"]),
    host_id: optionalUuid,
    repeat: z.union([z.literal("none"), z.enum(FREQUENCIES)]),
    ends_on: z.union([z.literal(""), day]).transform((v) => (v === "" ? null : v)),
    all_department: z.boolean(),
  })
  .superRefine((v, ctx) => {
    timeOrder(v, ctx);
    visibilityNeedsDepartment(v, ctx);
    if (v.mode === "request") {
      if (!v.host_id) ctx.addIssue({ code: "custom", path: ["host_id"], message: "Choose who you are asking." });
      if (v.repeat !== "none") ctx.addIssue({ code: "custom", path: ["repeat"], message: "A request is for one meeting. Schedule it to repeat." });
    } else if (v.repeat !== "none") {
      if (v.all_department && !v.department) ctx.addIssue({ code: "custom", path: ["department"], message: "Choose the department." });
      if (!v.all_department && v.attendees.length === 0) ctx.addIssue({ code: "custom", path: ["attendees"], message: "Choose the whole department or at least one person." });
      if (v.ends_on && v.ends_on < v.date) ctx.addIssue({ code: "custom", path: ["ends_on"], message: "The end cannot be before the start." });
    }
    if (v.mode === "schedule" && v.repeat === "none" && istInstant(v.date, v.start_time) === null) {
      ctx.addIssue({ code: "custom", path: ["date"], message: "Enter a valid date and time." });
    }
  });
export type ScheduleMeetingInput = z.input<typeof scheduleMeetingSchema>;
export type ScheduleMeetingValues = z.output<typeof scheduleMeetingSchema>;

export const updateMeetingSchema = z
  .object({ id: z.uuid(), ...meetingFields })
  .omit({ attendees: true })
  .superRefine((v, ctx) => {
    timeOrder(v, ctx);
    visibilityNeedsDepartment(v, ctx);
  });
export type UpdateMeetingInput = z.input<typeof updateMeetingSchema>;

export const meetingIdSchema = z.object({ id: z.uuid() });

export const cancelMeetingSchema = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(1, "Say why it is cancelled.").max(500, "Keep the reason under 500 characters."),
});
export type CancelMeetingInput = z.input<typeof cancelMeetingSchema>;

export const rsvpSchema = z.object({
  meeting_id: z.uuid(),
  rsvp: z.enum(["accepted", "tentative", "declined"], { message: "Choose Going, Maybe or Not going." }),
  note: z.string().trim().max(300, "Keep the note under 300 characters.").optional().transform((v) => (v ? v : null)),
});
export type RsvpInput = z.input<typeof rsvpSchema>;

export const seriesRsvpSchema = z.object({
  series_id: z.uuid(),
  rsvp: z.enum(["accepted", "tentative", "declined"], { message: "Choose Going, Maybe or Not going." }),
});

export const attendeeSchema = z.object({ meeting_id: z.uuid(), staff_id: z.uuid() });

export const answerRequestSchema = z
  .object({
    id: z.uuid(),
    action: z.enum(["accept", "decline", "propose"]),
    note: z.string().trim().max(500, "Keep the reason under 500 characters.").optional().transform((v) => (v ? v : null)),
    date: z.union([z.literal(""), day]).optional(),
    start_time: z.union([z.literal(""), time]).optional(),
    end_time: z.union([z.literal(""), time]).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === "decline" && !v.note) ctx.addIssue({ code: "custom", path: ["note"], message: "Say why you are declining." });
    if (v.action === "propose") {
      if (!v.date) ctx.addIssue({ code: "custom", path: ["date"], message: "Pick a date." });
      if (!v.start_time) ctx.addIssue({ code: "custom", path: ["start_time"], message: "Pick a time." });
      if (!v.end_time) ctx.addIssue({ code: "custom", path: ["end_time"], message: "Pick a time." });
      if (v.start_time && v.end_time && v.end_time <= v.start_time) ctx.addIssue({ code: "custom", path: ["end_time"], message: "The end must be after the start." });
    }
  });
export type AnswerRequestInput = z.input<typeof answerRequestSchema>;

export const seriesSchema = z
  .object({
    id: z.uuid().optional(),
    title,
    description,
    location,
    kind,
    visibility,
    department,
    frequency: z.enum(FREQUENCIES, { message: "Choose how often." }),
    weekday: z.coerce.number().int().min(1).max(7).optional(),
    month_day: z.coerce.number().int().min(1, "Pick a day from 1 to 28.").max(28, "Pick a day from 1 to 28.").optional(),
    start_time: time,
    duration_minutes: z.coerce.number().int().min(5, "At least 5 minutes.").max(480, "At most 8 hours."),
    starts_on: day,
    ends_on: z.union([z.literal(""), day]).transform((v) => (v === "" ? null : v)),
    all_department: z.boolean(),
    staff_ids: z.array(z.uuid()).max(100, "Choose at most 100 people."),
  })
  .superRefine((v, ctx) => {
    visibilityNeedsDepartment(v, ctx);
    if (v.frequency === "monthly" ? v.month_day === undefined : v.weekday === undefined) {
      ctx.addIssue({ code: "custom", path: [v.frequency === "monthly" ? "month_day" : "weekday"], message: v.frequency === "monthly" ? "Pick the day of the month." : "Pick the day of the week." });
    }
    if (v.all_department && !v.department) ctx.addIssue({ code: "custom", path: ["department"], message: "Choose the department." });
    if (!v.all_department && v.staff_ids.length === 0) ctx.addIssue({ code: "custom", path: ["staff_ids"], message: "Choose the whole department or at least one person." });
    if (v.ends_on && v.ends_on < v.starts_on) ctx.addIssue({ code: "custom", path: ["ends_on"], message: "The end cannot be before the start." });
  });
export type SeriesInput = z.input<typeof seriesSchema>;
export type SeriesValues = z.output<typeof seriesSchema>;

export const seriesActiveSchema = z.object({ id: z.uuid(), active: z.boolean() });
export const seriesIdSchema = z.object({ id: z.uuid() });

export const busySchema = z.object({
  staff_ids: z.array(z.uuid()).min(1).max(100),
  date: day,
  start_time: time,
  end_time: time,
  exclude: z.union([z.literal(""), z.uuid()]).optional(),
});

export function defaultEnd(start: string, minutes = 30): string {
  const [h = 0, m = 0] = start.split(":").map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
