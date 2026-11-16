import { z } from "zod";
import { todayIST } from "@/lib/format";

// Shared by the Workshop forms and Server Actions. The database re-validates everything: the status
// machine, "who can lead", trainer double-booking, completion rules and the cancel reason live in
// ops.event_guard / ops.event_staff_guard / ops.set_event_team (0007, 0013, 0017).

export const EVENT_KINDS = ["school_workshop", "college_workshop", "fdp", "stem_class", "cohort"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  school_workshop: "School workshop",
  college_workshop: "College workshop",
  fdp: "Faculty training",
  stem_class: "STEM class",
  cohort: "Cohort",
};

export const EVENT_STATUSES = ["draft", "scheduled", "in_progress", "completed", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: "Needs scheduling",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};
/** The steps of the normal path; Cancelled is shown as a badge instead. */
export const EVENT_STEPS = ["draft", "scheduled", "in_progress", "completed"] as const satisfies readonly EventStatus[];

const TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["draft", "in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/** Mirrors ops.event_guard. */
export function allowedEventMoves(from: EventStatus): readonly EventStatus[] {
  return TRANSITIONS[from];
}

export const MAX_ASSISTANTS = 2;
export const WORKSHOP_DAY_HOURS = 6;
export const DURATION_DAYS = [1, 3, 5] as const;

export const RUN_PHASES = ["pre", "day", "post"] as const;
export type RunPhase = (typeof RUN_PHASES)[number];
export const RUN_PHASE_LABELS: Record<RunPhase, string> = { pre: "Before the event", day: "On the day", post: "After the event" };

/** What ops.event_guard asks for before an event can be scheduled, in plain words. */
export function scheduleMissing(e: {
  lead_trainer_id: string | null; starts_at: string | null; ends_at: string | null; venue: string | null; expected_headcount: number | null;
}): string[] {
  const missing: string[] = [];
  if (!e.lead_trainer_id) missing.push("lead trainer");
  if (!e.starts_at) missing.push("start");
  if (!e.ends_at) missing.push("end");
  if (!e.venue || e.venue.trim() === "") missing.push("venue");
  if (e.expected_headcount === null) missing.push("expected headcount");
  return missing;
}

// ---------------------------------------------------------------- India time

const TZ = "Asia/Kolkata";
const IST_OFFSET = "+05:30";
const localRe = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** "2026-12-01T09:30" typed in a datetime-local box is India time; returns the ISO instant, or null if invalid. */
export function istLocalToIso(local: string): string | null {
  const m = localRe.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(h) > 23 || Number(mi) > 59) return null;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:00${IST_OFFSET}`);
  if (Number.isNaN(date.getTime())) return null;
  // Reject 31 Feb style dates that JS would roll over.
  return isoToIstLocal(date.toISOString()) === local ? date.toISOString() : null;
}

/** An ISO instant as the value of a datetime-local box, in India time. */
export function isoToIstLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** The India calendar day (yyyy-mm-dd) of an instant. */
export function istDay(iso: string): string {
  return todayIST(new Date(iso));
}

/** Prefill the end for a 1, 3 or 5 day workshop: last day, WORKSHOP_DAY_HOURS after the start time. */
export function endForDuration(startLocal: string, days: number): string {
  const m = localRe.exec(startLocal);
  if (!m) return "";
  const start = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])));
  const end = new Date(start.getTime() + ((days - 1) * 24 + WORKSHOP_DAY_HOURS) * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}T${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}`;
}

// ---------------------------------------------------------------- calendar maths (all in India dates)

const nums = (s: string): number[] => s.split("-").map(Number);

const addDays = (ymd: string, n: number): string => {
  const [y = 0, m = 1, d = 1] = nums(ymd);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export const isMonth = (v: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export function currentMonth(now: Date = new Date()): string {
  return todayIST(now).slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y = 0, m = 1] = nums(month);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Weeks (Monday first) covering the month, each day as yyyy-mm-dd. */
export function monthGrid(month: string): string[][] {
  const first = `${month}-01`;
  const [y = 0, m = 1] = nums(month);
  const weekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = addDays(first, -weekday);
  const weeks = Math.ceil((weekday + daysInMonth) / 7);
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

/** ISO bounds of the visible grid: from the first cell's midnight (IST) to the day after the last cell. */
export function gridRange(month: string): { from: string; to: string } {
  const grid = monthGrid(month);
  const first = grid[0]?.[0] ?? `${month}-01`;
  const last = grid[grid.length - 1]?.[6] ?? first;
  return { from: new Date(`${first}T00:00:00${IST_OFFSET}`).toISOString(), to: new Date(`${addDays(last, 1)}T00:00:00${IST_OFFSET}`).toISOString() };
}

/** Every India calendar day an event touches (capped so a bad date range cannot flood the grid). */
export function eventDays(startsAt: string, endsAt: string, cap = 62): string[] {
  const first = istDay(startsAt);
  const last = istDay(endsAt);
  const days: string[] = [];
  for (let d = first; d <= last && days.length < cap; d = addDays(d, 1)) days.push(d);
  return days;
}

export type CalendarEvent = { id: string; starts_at: string | null; ends_at: string | null };

/** Group events by the days they cover. Events without dates are not on the calendar. */
export function eventsByDay<T extends CalendarEvent>(events: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const e of events) {
    if (!e.starts_at || !e.ends_at) continue;
    for (const day of eventDays(e.starts_at, e.ends_at)) {
      const list = map.get(day) ?? [];
      list.push(e);
      map.set(day, list);
    }
  }
  for (const list of map.values()) list.sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? ""));
  return map;
}

/** "Day 2 of 3" for a multi-day event on a given day, or null for a one-day event. */
export function dayOfEvent(startsAt: string, endsAt: string, day: string): string | null {
  const days = eventDays(startsAt, endsAt);
  if (days.length < 2) return null;
  const i = days.indexOf(day);
  return i < 0 ? null : `Day ${i + 1} of ${days.length}`;
}

// ---------------------------------------------------------------- forms

const optionalDateTime = z
  .string()
  .trim()
  .refine((v) => v === "" || istLocalToIso(v) !== null, "Enter a valid date and time.")
  .transform((v) => (v === "" ? null : (istLocalToIso(v) as string)));

const headcount = z
  .string()
  .trim()
  .refine((v) => v === "" || (/^\d{1,5}$/.test(v) && Number(v) > 0), "Enter a whole number above zero.")
  .transform((v) => (v === "" ? null : Number(v)));

const title = z.string().trim().min(1, "Enter a title.").max(200, "Keep the title under 200 characters.");

export const createEventSchema = z.object({
  institution_id: z.uuid({ message: "Choose an institution." }),
  kind: z.enum(EVENT_KINDS, { message: "Choose the event type." }),
  title: z.string().trim().max(200, "Keep the title under 200 characters."),
});
export type CreateEventInput = z.input<typeof createEventSchema>;

export function defaultEventTitle(kind: EventKind, institutionName: string): string {
  return `${EVENT_KIND_LABELS[kind]} - ${institutionName}`.slice(0, 200);
}

export const updateEventSchema = z
  .object({
    id: z.uuid(),
    title,
    starts_at: optionalDateTime,
    ends_at: optionalDateTime,
    venue: z.string().trim().max(200, "Keep the venue under 200 characters."),
    expected_headcount: headcount,
  })
  .superRefine((v, ctx) => {
    if ((v.starts_at === null) !== (v.ends_at === null)) {
      ctx.addIssue({ code: "custom", path: [v.starts_at === null ? "starts_at" : "ends_at"], message: "Set both the start and the end." });
    } else if (v.starts_at && v.ends_at && v.ends_at < v.starts_at) {
      ctx.addIssue({ code: "custom", path: ["ends_at"], message: "The end cannot be before the start." });
    }
  });
export type UpdateEventInput = z.input<typeof updateEventSchema>;

export const eventIdSchema = z.object({ id: z.uuid() });

const optionalUuid = z.union([z.literal(""), z.uuid()]).transform((v) => (v === "" ? null : v));

export const eventTeamSchema = z
  .object({
    id: z.uuid(),
    lead_trainer_id: optionalUuid,
    assistants: z.array(z.uuid()).max(MAX_ASSISTANTS, `An event can have at most ${MAX_ASSISTANTS} assistants.`),
  })
  .superRefine((v, ctx) => {
    if (v.lead_trainer_id && v.assistants.includes(v.lead_trainer_id)) {
      ctx.addIssue({ code: "custom", path: ["assistants"], message: "The lead trainer cannot also be an assistant." });
    }
  });
export type EventTeamInput = z.input<typeof eventTeamSchema>;

export const availabilitySchema = z.object({
  starts_at: z.string().trim().refine((v) => istLocalToIso(v) !== null, "Set the start and end first."),
  ends_at: z.string().trim().refine((v) => istLocalToIso(v) !== null, "Set the start and end first."),
  exclude_event: z.union([z.literal(""), z.uuid()]).optional(),
});

export const completeEventSchema = z.object({
  id: z.uuid(),
  actual_headcount: z
    .string()
    .trim()
    .refine((v) => /^\d{1,5}$/.test(v), "Enter how many students attended (0 or more).")
    .transform(Number),
  satisfaction_score: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^[0-5](\.\d{1,2})?$/.test(v) && Number(v) <= 5), "Enter a score from 0 to 5.")
    .transform((v) => (v === "" ? null : Number(v))),
});
export type CompleteEventInput = z.input<typeof completeEventSchema>;

export const cancelEventSchema = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(1, "Say why the event is cancelled.").max(500, "Keep the reason under 500 characters."),
});
export type CancelEventInput = z.input<typeof cancelEventSchema>;

export const runSheetToggleSchema = z.object({ id: z.uuid(), done: z.boolean() });

/** Progress of the checklist: items done out of all, and out of the ones that block completion. */
export function runSheetProgress(items: { phase: string; done_at: string | null }[]): { done: number; total: number; blocking: number } {
  const done = items.filter((i) => i.done_at).length;
  const blocking = items.filter((i) => (i.phase === "pre" || i.phase === "day") && !i.done_at).length;
  return { done, total: items.length, blocking };
}

// ---------------------------------------------------------------- Workshop URL state

export const WORKSHOP_TABS = ["calendar", "events"] as const;
export type WorkshopTab = (typeof WORKSHOP_TABS)[number];
export const WORKSHOP_TAB_LABELS: Record<WorkshopTab, string> = { calendar: "Calendar", events: "Events" };

export const STATUS_FILTERS = ["open", "all", ...EVENT_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  open: "Open",
  all: "All",
  ...EVENT_STATUS_LABELS,
};
export const OPEN_STATUSES = ["draft", "scheduled", "in_progress"] as const satisfies readonly EventStatus[];
export const WORKSHOP_PAGE_SIZE = 25;

export type WorkshopParams = {
  tab: WorkshopTab;
  month: string;
  status: StatusFilter;
  kind: "" | EventKind;
  scope: "mine" | "all";
  page: number;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseWorkshopParams(raw: Record<string, string | string[] | undefined>, now: Date = new Date()): WorkshopParams {
  const tab = first(raw.tab);
  const month = first(raw.month);
  const status = first(raw.status);
  const kind = first(raw.kind);
  const page = Number.parseInt(first(raw.page), 10);
  return {
    tab: (WORKSHOP_TABS as readonly string[]).includes(tab) ? (tab as WorkshopTab) : "calendar",
    month: isMonth(month) ? month : currentMonth(now),
    status: (STATUS_FILTERS as readonly string[]).includes(status) ? (status as StatusFilter) : "open",
    kind: (EVENT_KINDS as readonly string[]).includes(kind) ? (kind as EventKind) : "",
    scope: first(raw.scope) === "mine" ? "mine" : "all",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

/** Build a Workshop URL query, leaving defaults out. */
export function workshopQuery(p: Partial<WorkshopParams>, now: Date = new Date()): string {
  const qs = new URLSearchParams();
  if (p.tab && p.tab !== "calendar") qs.set("tab", p.tab);
  if (p.month && p.month !== currentMonth(now)) qs.set("month", p.month);
  if (p.status && p.status !== "open") qs.set("status", p.status);
  if (p.kind) qs.set("kind", p.kind);
  if (p.scope === "mine") qs.set("scope", "mine");
  if (p.page && p.page > 1) qs.set("page", String(p.page));
  return qs.toString();
}
