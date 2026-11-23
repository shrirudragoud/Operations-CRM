// What a draft card shows for the kinds that are not a task: its rows, the people it names and where it points once done.
// Pure (no database): the thread loader looks the names up and hands them in.

import { meetingPeople, meetingRows } from "@/lib/ai/calendar-drafts";
import { MEETING_DRAFT_KINDS, SALES_DRAFT_KINDS, WORKSHOP_DRAFT_KINDS } from "@/lib/ai/drafts";
import { salesRows } from "@/lib/ai/sales-drafts";
import type { CardRow, DraftLink } from "@/lib/ai/types";
import { eventPeople, eventRows } from "@/lib/ai/workshop-drafts";

type Rec = Record<string, unknown>;

const isMeeting = (kind: string) => (MEETING_DRAFT_KINDS as readonly string[]).includes(kind);
const isEvent = (kind: string) => (WORKSHOP_DRAFT_KINDS as readonly string[]).includes(kind);
const isSales = (kind: string) => (SALES_DRAFT_KINDS as readonly string[]).includes(kind);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function cardRows(kind: string, payload: Rec, name: (id: string) => string): CardRow[] {
  if (isMeeting(kind)) return meetingRows(kind, payload, name);
  if (isSales(kind)) return salesRows(kind, payload);
  return isEvent(kind) ? eventRows(kind, payload, name) : [];
}

/** Person ids a card needs names for. */
export function personIdsOf(kind: string, payload: Rec): string[] {
  if (isMeeting(kind)) return meetingPeople(kind, payload);
  return isEvent(kind) ? eventPeople(kind, payload) : [];
}

/** Where a finished draft can be opened. Only a draft that ran has something to open. */
export function doneLinks(kind: string, payload: Rec, result: Rec): DraftLink[] {
  if (kind === "schedule_meeting") {
    const id = str(result.id);
    if (!id) return [];
    return result.kind === "series"
      ? [{ href: "/calendar/series", label: "Open fixed meetings", ref: null }]
      : [{ href: `/calendar/${id}`, label: "Open the meeting", ref: { kind: "meeting", id } }];
  }
  if (isMeeting(kind)) {
    const id = str(payload.id) ?? str(payload.meeting_id);
    return id ? [{ href: `/calendar/${id}`, label: "Open the meeting", ref: { kind: "meeting", id } }] : [];
  }
  if (kind === "log_activity") {
    const id = str(payload.institution_id);
    return id ? [{ href: `/institutions/${id}`, label: "Open the institution", ref: { kind: "institution", id } }] : [];
  }
  if (isSales(kind)) {
    const id = str(kind === "create_deal" ? result.id : payload.id);
    return id ? [{ href: `/sales/${id}`, label: "Open the deal", ref: { kind: "deal", id } }] : [];
  }
  if (isEvent(kind)) {
    const id = str(kind === "create_event" ? result.id : kind === "toggle_run_item" ? payload.event_id : payload.id);
    return id ? [{ href: `/workshop/${id}`, label: "Open the event", ref: { kind: "event", id } }] : [];
  }
  return [];
}
