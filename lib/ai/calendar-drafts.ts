// Meeting drafts: checked with the same zod schemas the Calendar forms use, shown on a card, and run later through the
// same server actions. Edit drafts keep only what changes and are laid over the live meeting when they run.

import type { MeetingView } from "@/lib/ai/areas/calendar";
import type { Checked } from "@/lib/ai/drafts";
import { clip, dayLabel } from "@/lib/ai/when";
import type { CardRow } from "@/lib/ai/types";
import {
  cancelMeetingSchema, formatTimeRange, FREQUENCY_LABELS, istInstant, MEETING_KIND_LABELS, rsvpSchema, RSVP_LABELS, scheduleMeetingSchema,
  updateMeetingSchema, VISIBILITY_LABELS, type Frequency, type MeetingKind, type Rsvp, type Visibility,
} from "@/lib/schemas/calendar";
import { isoToIstLocal } from "@/lib/schemas/event";
import type { z } from "zod";

export const MAX_INVITEES = 30;
export const UPDATE_KEYS = ["title", "description", "location", "kind", "visibility", "department", "date", "start_time", "end_time", "institution_id"] as const;

type Rec = Record<string, unknown>;
type PersonName = (id: string) => string;

const asRecord = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const text = (v: unknown): string => (typeof v === "string" ? v : "");

function issues(error: z.ZodError): string[] {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
}

/** The meeting as the edit form sees it: India date and times, empty strings for blanks. */
export function formValues(live: MeetingView) {
  const [date = "", start = ""] = isoToIstLocal(live.starts_at).split("T");
  const end = isoToIstLocal(live.ends_at).split("T")[1] ?? "";
  return {
    id: live.id,
    title: live.title,
    description: live.description ?? "",
    location: live.location ?? "",
    kind: live.kind,
    visibility: live.visibility,
    department: live.department ?? "",
    date,
    start_time: start,
    end_time: end,
    institution_id: live.institution?.id ?? "",
  };
}

/** The input updateMeeting takes: the live meeting with the drafted changes laid over it. */
export function mergeMeeting(live: MeetingView, changes: Rec): Rec {
  return { ...formValues(live), ...changes };
}

export function checkScheduleMeeting(args: unknown, today: string): Checked {
  const a = asRecord(args);
  const mode = a.mode === "request" ? "request" : "schedule";
  const input = {
    title: a.title,
    description: text(a.description),
    location: text(a.location),
    kind: a.kind ?? (mode === "request" ? "one_to_one" : "team"),
    visibility: a.visibility ?? "invitees",
    department: text(a.department),
    date: a.date,
    start_time: a.start_time,
    end_time: a.end_time,
    attendees: mode === "request" ? [] : (a.attendee_ids ?? []),
    institution_id: text(a.institution_id),
    mode,
    host_id: text(a.host_id),
    repeat: a.repeat ?? "none",
    ends_on: text(a.ends_on),
    all_department: a.all_department === true,
  };
  const r = scheduleMeetingSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: issues(r.error) };
  if (r.data.date < today) return { ok: false, errors: ["date: A meeting cannot be set in the past."] };
  if (r.data.attendees.length > MAX_INVITEES) return { ok: false, errors: [`attendee_ids: Invite at most ${MAX_INVITEES} people here. Use the Calendar page for bigger groups.`] };
  return { ok: true, payload: input };
}

export function checkUpdateMeeting(live: MeetingView, args: unknown, today: string): Checked {
  if (live.status === "cancelled" || live.status === "declined") return { ok: false, errors: [`That meeting is ${live.status}. It cannot be changed.`] };
  const a = asRecord(args);
  const changes: Rec = {};
  for (const k of UPDATE_KEYS) if (a[k] !== undefined) changes[k] = a[k] === null ? "" : a[k];
  if (Object.keys(changes).length === 0) return { ok: false, errors: ["Say what to change: title, description, place, type, who can see it, date, start_time or end_time."] };
  const r = updateMeetingSchema.safeParse(mergeMeeting(live, changes));
  if (!r.success) return { ok: false, errors: issues(r.error) };
  if (changes.date !== undefined && r.data.date < today) return { ok: false, errors: ["date: A meeting cannot be moved into the past."] };
  return { ok: true, payload: { id: live.id, meeting_title: live.title, changes } };
}

export function checkCancelMeeting(live: MeetingView, args: unknown): Checked {
  if (live.status === "cancelled") return { ok: false, errors: ["That meeting is already cancelled."] };
  const r = cancelMeetingSchema.safeParse({ id: live.id, reason: asRecord(args).reason });
  if (!r.success) return { ok: false, errors: issues(r.error) };
  return { ok: true, payload: { id: live.id, meeting_title: live.title, reason: r.data.reason } };
}

export function checkRsvp(live: MeetingView, meId: string, args: unknown): Checked {
  if (live.status !== "scheduled") return { ok: false, errors: ["That meeting is not scheduled, so there is nothing to answer."] };
  if (!live.attendees.some((x) => x.staff_id === meId)) return { ok: false, errors: ["You are not invited to that meeting, so you cannot answer it."] };
  const a = asRecord(args);
  const r = rsvpSchema.safeParse({ meeting_id: live.id, rsvp: a.rsvp, ...(typeof a.note === "string" && a.note.trim() ? { note: a.note } : {}) });
  if (!r.success) return { ok: false, errors: issues(r.error) };
  return { ok: true, payload: { meeting_id: live.id, meeting_title: live.title, rsvp: r.data.rsvp, ...(r.data.note ? { note: r.data.note } : {}) } };
}

// ---------------------------------------------------------------- what the person reads

const quoted = (v: unknown) => `"${clip(text(v), 80)}"`;

function whenText(date: unknown, start: unknown, end: unknown): string {
  const s = istInstant(text(date), text(start));
  const e = istInstant(text(date), text(end));
  return s && e ? `${dayLabel(text(date))}, ${formatTimeRange(s, e)}` : `${text(date)} ${text(start)}`;
}

function peopleText(ids: unknown, name: PersonName): string {
  return Array.isArray(ids) ? ids.map((i) => name(String(i))).join(", ") : "";
}

const CHANGE_LABEL: Record<string, string> = {
  title: "Title", description: "Notes", location: "Place", kind: "Type", visibility: "Seen by", department: "Department",
  date: "Date", start_time: "Starts", end_time: "Ends", institution_id: "Institution",
};

function changeValue(key: string, value: unknown): string {
  const v = text(value);
  if (!v) return "Cleared";
  if (key === "kind") return MEETING_KIND_LABELS[v as MeetingKind] ?? v;
  if (key === "visibility") return VISIBILITY_LABELS[v as Visibility] ?? v;
  if (key === "date") return dayLabel(v);
  if (key === "institution_id") return "A different institution";
  return clip(v, 120);
}

export function summarizeMeeting(kind: string, p: Rec, name: PersonName): string {
  switch (kind) {
    case "schedule_meeting": {
      const repeat = p.repeat !== "none" ? `, ${(FREQUENCY_LABELS[p.repeat as Frequency] ?? "repeating").toLowerCase()}` : "";
      return p.mode === "request"
        ? `Ask ${name(text(p.host_id))} for a meeting ${quoted(p.title)} on ${whenText(p.date, p.start_time, p.end_time)}`
        : `Schedule ${quoted(p.title)} on ${whenText(p.date, p.start_time, p.end_time)}${repeat}`;
    }
    case "update_meeting": {
      const changes = asRecord(p.changes);
      return `Change ${Object.keys(changes).map((k) => (CHANGE_LABEL[k] ?? k).toLowerCase()).join(", ")} on ${quoted(p.meeting_title)}`;
    }
    case "cancel_meeting":
      return `Cancel ${quoted(p.meeting_title)}: ${clip(text(p.reason), 120)}`;
    default:
      return `Answer ${quoted(p.meeting_title)}: ${RSVP_LABELS[p.rsvp as Rsvp] ?? text(p.rsvp)}`;
  }
}

export function meetingRows(kind: string, p: Rec, name: PersonName): CardRow[] {
  const rows: CardRow[] = [];
  const add = (label: string, value: string) => value && rows.push({ label, value });
  switch (kind) {
    case "schedule_meeting": {
      add("Meeting", clip(text(p.title), 200));
      add("When", whenText(p.date, p.start_time, p.end_time));
      if (p.repeat !== "none") add("Repeats", `${FREQUENCY_LABELS[p.repeat as Frequency] ?? "Repeats"}${text(p.ends_on) ? ` until ${dayLabel(text(p.ends_on))}` : ""}`);
      if (p.mode === "request") add("Asking", name(text(p.host_id)));
      else if (p.all_department) add("Invited", `Everyone in ${text(p.department) || "the"} department`);
      else add("Invited", peopleText(p.attendees, name) || "Only you");
      add("Place", clip(text(p.location), 120));
      add("Type", MEETING_KIND_LABELS[p.kind as MeetingKind] ?? text(p.kind));
      add("Seen by", VISIBILITY_LABELS[p.visibility as Visibility] ?? text(p.visibility));
      break;
    }
    case "update_meeting":
      add("Meeting", clip(text(p.meeting_title), 200));
      for (const [k, v] of Object.entries(asRecord(p.changes))) add(CHANGE_LABEL[k] ?? k, changeValue(k, v));
      break;
    case "cancel_meeting":
      add("Meeting", clip(text(p.meeting_title), 200));
      add("Reason", clip(text(p.reason), 300));
      break;
    case "rsvp_meeting":
      add("Meeting", clip(text(p.meeting_title), 200));
      add("Your answer", RSVP_LABELS[p.rsvp as Rsvp] ?? text(p.rsvp));
      add("Note", clip(text(p.note), 200));
      break;
  }
  return rows;
}

export function meetingPeople(kind: string, p: Rec): string[] {
  if (kind !== "schedule_meeting") return [];
  return [...(Array.isArray(p.attendees) ? p.attendees : []), p.host_id].filter((x): x is string => typeof x === "string" && x !== "");
}
