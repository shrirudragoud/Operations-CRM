// Workshop event drafts: checked with the same zod schemas the Workshop forms use, shown on a card, and run later through
// the same server actions. Edit drafts keep only what changes and are laid over the live event when they run.

import type { EventView } from "@/lib/ai/areas/workshop";
import type { Checked } from "@/lib/ai/drafts";
import type { CardRow } from "@/lib/ai/types";
import { clip, dayLabel } from "@/lib/ai/when";
import {
  allowedEventMoves, cancelEventSchema, completeEventSchema, createEventSchema, defaultEventTitle, EVENT_KIND_LABELS, EVENT_STATUS_LABELS,
  eventTeamSchema, isoToIstLocal, runSheetProgress, runSheetToggleSchema, scheduleMissing, updateEventSchema,
  type EventKind, type EventStatus,
} from "@/lib/schemas/event";
import type { z } from "zod";

export const EVENT_ACTIONS = ["schedule", "start", "complete", "cancel"] as const;
export type EventAction = (typeof EVENT_ACTIONS)[number];

const ACTION_TARGET: Record<EventAction, EventStatus> = { schedule: "scheduled", start: "in_progress", complete: "completed", cancel: "cancelled" };
const ACTION_WORDS: Record<EventAction, string> = { schedule: "Schedule", start: "Start", complete: "Mark as completed:", cancel: "Cancel" };
const ACTION_PAST: Record<EventAction, string> = { schedule: "scheduled", start: "started", complete: "completed", cancel: "cancelled" };

type Rec = Record<string, unknown>;
type PersonName = (id: string) => string;

const asRecord = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const text = (v: unknown): string => (typeof v === "string" ? v : "");

function issues(error: z.ZodError): string[] {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
}

function closed(live: EventView): string | null {
  if (live.archived) return "That event is archived. It has to be restored on the Workshop page first.";
  if (live.status === "completed" || live.status === "cancelled") return `That event is ${live.status}. It cannot be changed.`;
  return null;
}

// ---------------------------------------------------------------- create

export function checkCreateEvent(args: unknown, institution: { name: string; archived: boolean } | null): Checked {
  const a = asRecord(args);
  const input = { institution_id: a.institution_id, kind: a.kind, title: text(a.title) };
  const r = createEventSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: issues(r.error) };
  if (!institution) return { ok: false, errors: ["institution_id: No institution with that id is visible to this person. Use search_institutions."] };
  if (institution.archived) return { ok: false, errors: ["institution_id: That institution is archived. It has to be restored before it can have an event."] };
  return { ok: true, payload: { institution_id: r.data.institution_id, institution_name: institution.name, kind: r.data.kind, title: r.data.title } };
}

// ---------------------------------------------------------------- edit

/** The event as the edit form sees it: India date-times, empty strings for blanks. */
export function formValues(live: EventView) {
  return {
    id: live.id,
    title: live.title,
    starts_at: isoToIstLocal(live.starts_at),
    ends_at: isoToIstLocal(live.ends_at),
    venue: live.venue ?? "",
    expected_headcount: live.expected_headcount === null ? "" : String(live.expected_headcount),
  };
}

/** The input updateEvent takes: the live event with the drafted changes laid over it. */
export function mergeEvent(live: EventView, changes: Rec): Rec {
  return { ...formValues(live), ...changes };
}

function dateTime(a: Rec, dateKey: string, timeKey: string, live: string): { value: string } | { error: string } | null {
  if (a[dateKey] === undefined && a[timeKey] === undefined) return null;
  const [liveDate = "", liveTime = ""] = live.split("T");
  const date = a[dateKey] === undefined ? liveDate : text(a[dateKey]);
  const time = a[timeKey] === undefined ? liveTime : text(a[timeKey]);
  if (!date || !time) return { error: `Give both ${dateKey} (YYYY-MM-DD) and ${timeKey} (HH:MM, India time).` };
  return { value: `${date}T${time}` };
}

export function checkUpdateEvent(live: EventView, args: unknown, today: string): Checked {
  const blocked = closed(live);
  if (blocked) return { ok: false, errors: [blocked] };
  const a = asRecord(args);
  const changes: Rec = {};
  if (a.title !== undefined) changes.title = text(a.title);
  if (a.venue !== undefined) changes.venue = a.venue === null ? "" : text(a.venue);
  if (a.expected_headcount !== undefined) changes.expected_headcount = a.expected_headcount === null ? "" : typeof a.expected_headcount === "number" ? String(a.expected_headcount) : text(a.expected_headcount);
  for (const [key, d, t, current] of [["starts_at", "start_date", "start_time", live.starts_at], ["ends_at", "end_date", "end_time", live.ends_at]] as const) {
    const v = dateTime(a, d, t, isoToIstLocal(current));
    if (v && "error" in v) return { ok: false, errors: [v.error] };
    if (v) changes[key] = v.value;
  }
  if (Object.keys(changes).length === 0) return { ok: false, errors: ["Say what to change: title, venue, expected_headcount, start_date and start_time, or end_date and end_time."] };
  const r = updateEventSchema.safeParse(mergeEvent(live, changes));
  if (!r.success) return { ok: false, errors: issues(r.error) };
  if (typeof changes.starts_at === "string" && changes.starts_at.slice(0, 10) < today) return { ok: false, errors: ["start_date: An event cannot be moved into the past."] };
  return { ok: true, payload: { id: live.id, event_title: live.title, changes } };
}

// ---------------------------------------------------------------- team

export function checkEventTeam(live: EventView, args: unknown): Checked {
  const blocked = closed(live);
  if (blocked) return { ok: false, errors: [blocked] };
  const a = asRecord(args);
  const lead = text(a.lead_trainer_id);
  if (!lead) return { ok: false, errors: ["lead_trainer_id: Name the lead trainer. Use available_trainers to see who can lead."] };
  const assistants = Array.isArray(a.assistant_ids)
    ? [...new Set(a.assistant_ids.filter((x): x is string => typeof x === "string"))]
    : live.team.map((t) => t.staff_id).filter((id) => id !== lead);
  const r = eventTeamSchema.safeParse({ id: live.id, lead_trainer_id: lead, assistants });
  if (!r.success) return { ok: false, errors: issues(r.error) };
  return { ok: true, payload: { id: live.id, event_title: live.title, lead_trainer_id: lead, assistants } };
}

// ---------------------------------------------------------------- status

export function checkEventStatus(live: EventView, args: unknown): Checked {
  const a = asRecord(args);
  const action = EVENT_ACTIONS.find((x) => x === a.action);
  if (!action) return { ok: false, errors: [`action: Use one of ${EVENT_ACTIONS.join(", ")}.`] };
  if (live.archived) return { ok: false, errors: ["That event is archived. It has to be restored on the Workshop page first."] };
  const from = live.status as EventStatus;
  if (!allowedEventMoves(from).includes(ACTION_TARGET[action])) {
    return { ok: false, errors: [`A ${EVENT_STATUS_LABELS[from]?.toLowerCase() ?? from} event cannot be ${ACTION_PAST[action]} from here.`] };
  }
  const base = { id: live.id, event_title: live.title, action };

  if (action === "schedule") {
    const missing = scheduleMissing(live);
    if (missing.length > 0) return { ok: false, errors: [`To schedule this event, set: ${missing.join(", ")}. Draft those first.`] };
    return { ok: true, payload: base };
  }
  if (action === "start") return { ok: true, payload: base };
  if (action === "cancel") {
    const r = cancelEventSchema.safeParse({ id: live.id, reason: a.reason });
    if (!r.success) return { ok: false, errors: issues(r.error) };
    return { ok: true, payload: { ...base, reason: r.data.reason } };
  }

  const blocking = runSheetProgress(live.run_sheet.map((i) => ({ phase: i.phase, done_at: i.done ? "x" : null }))).blocking;
  if (blocking > 0) return { ok: false, errors: [`${blocking} run sheet ${blocking === 1 ? "item" : "items"} before or on the day must be ticked off first. Use get_event to see them.`] };
  const input = {
    id: live.id,
    actual_headcount: typeof a.actual_headcount === "number" ? String(a.actual_headcount) : text(a.actual_headcount),
    satisfaction_score: a.satisfaction_score === undefined || a.satisfaction_score === null ? "" : String(a.satisfaction_score),
  };
  const r = completeEventSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: issues(r.error) };
  return { ok: true, payload: { ...base, actual_headcount: input.actual_headcount, satisfaction_score: input.satisfaction_score } };
}

// ---------------------------------------------------------------- run sheet

export function checkRunItem(live: EventView, args: unknown): Checked {
  if (live.archived) return { ok: false, errors: ["That event is archived. It has to be restored on the Workshop page first."] };
  if (live.status === "cancelled") return { ok: false, errors: ["That event is cancelled. Its run sheet cannot be changed."] };
  const a = asRecord(args);
  const r = runSheetToggleSchema.safeParse({ id: a.item_id, done: a.done });
  if (!r.success) return { ok: false, errors: ["item_id and done are needed: an item id from get_event, and done true or false."] };
  const item = live.run_sheet.find((i) => i.id === r.data.id);
  if (!item) return { ok: false, errors: ["item_id: That item is not on this event's run sheet. Use get_event for the ids."] };
  if (item.done === r.data.done) return { ok: false, errors: [`That item is already ${item.done ? "ticked off" : "not ticked"}. Nothing to change.`] };
  return { ok: true, payload: { id: item.id, event_id: live.id, event_title: live.title, item: item.label, done: r.data.done } };
}

// ---------------------------------------------------------------- what the person reads

const quoted = (v: unknown) => `"${clip(text(v), 80)}"`;

const CHANGE_LABEL: Record<string, string> = { title: "Title", venue: "Venue", expected_headcount: "Expected students", starts_at: "Starts", ends_at: "Ends" };

function changeValue(key: string, value: unknown): string {
  const v = text(value);
  if (!v) return "Cleared";
  if (key === "starts_at" || key === "ends_at") {
    const [d = "", t = ""] = v.split("T");
    return `${dayLabel(d)}, ${t}`;
  }
  return clip(v, 120);
}

export function summarizeEvent(kind: string, p: Rec, name: PersonName): string {
  switch (kind) {
    case "create_event": {
      const title = text(p.title) || defaultEventTitle(p.kind as EventKind, text(p.institution_name));
      return `New ${(EVENT_KIND_LABELS[p.kind as EventKind] ?? "event").toLowerCase()} for ${clip(text(p.institution_name), 80)}: ${quoted(title)}`;
    }
    case "update_event":
      return `Change ${Object.keys(asRecord(p.changes)).map((k) => (CHANGE_LABEL[k] ?? k).toLowerCase()).join(", ")} on ${quoted(p.event_title)}`;
    case "set_event_team": {
      const n = Array.isArray(p.assistants) ? p.assistants.length : 0;
      return `Set the team of ${quoted(p.event_title)}: ${name(text(p.lead_trainer_id))} leads${n ? `, ${n} ${n === 1 ? "assistant" : "assistants"}` : ""}`;
    }
    case "event_status": {
      const action = p.action as EventAction;
      return `${ACTION_WORDS[action] ?? "Change"} ${quoted(p.event_title)}${action === "cancel" ? `: ${clip(text(p.reason), 120)}` : ""}`;
    }
    default:
      return `${p.done ? "Tick off" : "Untick"} "${clip(text(p.item), 80)}" on ${quoted(p.event_title)}`;
  }
}

export function eventRows(kind: string, p: Rec, name: PersonName): CardRow[] {
  const rows: CardRow[] = [];
  const add = (label: string, value: string) => value && rows.push({ label, value });
  switch (kind) {
    case "create_event":
      add("Institution", clip(text(p.institution_name), 120));
      add("Type", EVENT_KIND_LABELS[p.kind as EventKind] ?? text(p.kind));
      add("Title", clip(text(p.title) || defaultEventTitle(p.kind as EventKind, text(p.institution_name)), 200));
      break;
    case "update_event":
      add("Event", clip(text(p.event_title), 200));
      for (const [k, v] of Object.entries(asRecord(p.changes))) add(CHANGE_LABEL[k] ?? k, changeValue(k, v));
      break;
    case "set_event_team":
      add("Event", clip(text(p.event_title), 200));
      add("Lead", name(text(p.lead_trainer_id)));
      add("Assistants", Array.isArray(p.assistants) && p.assistants.length ? p.assistants.map((i) => name(String(i))).join(", ") : "None");
      break;
    case "event_status": {
      add("Event", clip(text(p.event_title), 200));
      add("Action", (ACTION_WORDS[p.action as EventAction] ?? "Change").replace(/:$/, ""));
      add("Reason", clip(text(p.reason), 300));
      add("Students came", text(p.actual_headcount));
      add("Score", text(p.satisfaction_score));
      break;
    }
    case "toggle_run_item":
      add("Event", clip(text(p.event_title), 200));
      add("Item", clip(text(p.item), 200));
      add("Mark as", p.done ? "Done" : "Not done");
      break;
  }
  return rows;
}

export function eventPeople(kind: string, p: Rec): string[] {
  if (kind !== "set_event_team") return [];
  return [p.lead_trainer_id, ...(Array.isArray(p.assistants) ? p.assistants : [])].filter((x): x is string => typeof x === "string" && x !== "");
}
