"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionCaller } from "@/lib/auth";
import { fail, PERMISSION_ERROR, type ActionResult } from "@/lib/errors";
import { canScheduleMeeting, type Me } from "@/lib/permissions";
import { listBusy } from "@/lib/queries/calendar";
import {
  answerRequestSchema, attendeeSchema, busySchema, cancelMeetingSchema, isoWeekday, istInstant, meetingIdSchema,
  minutesBetween, rsvpSchema, scheduleMeetingSchema, seriesActiveSchema, seriesIdSchema, seriesRsvpSchema, seriesSchema, updateMeetingSchema,
} from "@/lib/schemas/calendar";
import { createClient } from "@/utils/supabase/server";

// Meetings, requests, RSVPs and fixed meetings (0022). The rules are in the database (ops.meeting_guard,
// ops.meeting_attendee_guard, ops.answer_meeting_request, ops.meeting_series_guard, RLS); these actions
// validate, call the table or RPC, and show the database's own message when it refuses.

function invalid(error: z.ZodError): { ok: false; error: string; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) (fieldErrors[issue.path.join(".") || "form"] ??= []).push(issue.message);
  return { ok: false, error: "Check the highlighted fields.", fieldErrors };
}

async function caller(): Promise<{ me: Me } | { ok: false; error: string }> {
  const c = await actionCaller();
  return "error" in c ? { ok: false, error: c.error } : c;
}

function refresh(id?: string) {
  revalidatePath("/calendar");
  revalidatePath("/calendar/series");
  if (id) revalidatePath(`/calendar/${id}`);
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------- Schedule or request

export type Scheduled = { kind: "meeting" | "series"; id: string };

export async function scheduleMeeting(input: unknown): Promise<ActionResult<Scheduled>> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canScheduleMeeting(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = scheduleMeetingSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const supabase = await createClient();

  if (v.repeat !== "none") {
    const day = Number(v.date.slice(8, 10));
    if (v.repeat === "monthly" && day > 28) {
      return { ok: false, error: "A monthly meeting must fall on the 1st to the 28th so it happens every month.", fieldErrors: { date: ["Pick a day from 1 to 28."] } };
    }
    const minutes = minutesBetween(`${v.date}T${v.start_time}:00Z`, `${v.date}T${v.end_time}:00Z`);
    const { data, error } = await supabase
      .from("meeting_series")
      .insert({
        title: v.title,
        description: v.description || null,
        location: v.location || null,
        kind: v.kind,
        visibility: v.visibility,
        department: v.department,
        frequency: v.repeat,
        weekday: v.repeat === "monthly" ? null : isoWeekday(v.date),
        month_day: v.repeat === "monthly" ? day : null,
        start_time: v.start_time,
        duration_minutes: minutes,
        starts_on: v.date,
        ends_on: v.ends_on,
        all_department: v.all_department,
        staff_ids: v.attendees.filter((id) => id !== c.me.id),
      })
      .select("id")
      .single();
    if (error) return fail(error, "scheduleMeeting.series");
    refresh();
    return { ok: true, data: { kind: "series", id: data.id } };
  }

  const starts = istInstant(v.date, v.start_time);
  const ends = istInstant(v.date, v.end_time);
  if (!starts || !ends) return { ok: false, error: "Enter a valid date and time.", fieldErrors: { date: ["Enter a valid date and time."] } };

  const { data, error } = await supabase
    .from("meeting")
    .insert({
      title: v.title,
      description: v.description || null,
      location: v.location || null,
      kind: v.kind,
      visibility: v.visibility,
      department: v.department,
      starts_at: starts,
      ends_at: ends,
      status: v.mode === "request" ? "requested" : "scheduled",
      host_id: v.mode === "request" ? v.host_id : null,
      institution_id: v.institution_id,
    })
    .select("id")
    .single();
  if (error) return fail(error, "scheduleMeeting");

  const invite = [...new Set(v.attendees)].filter((id) => id !== c.me.id && id !== v.host_id);
  if (v.mode === "schedule" && invite.length > 0) {
    const { error: aerr } = await supabase.from("meeting_attendee").insert(invite.map((staff_id) => ({ meeting_id: data.id, staff_id })));
    if (aerr) {
      await supabase.from("meeting").delete().eq("id", data.id);
      return fail(aerr, "scheduleMeeting.attendees");
    }
  }
  refresh(data.id);
  return { ok: true, data: { kind: "meeting", id: data.id } };
}

// ---------------------------------------------------------------- Edit, cancel

export async function updateMeeting(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = updateMeetingSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const starts = istInstant(v.date, v.start_time);
  const ends = istInstant(v.date, v.end_time);
  if (!starts || !ends) return { ok: false, error: "Enter a valid date and time.", fieldErrors: { date: ["Enter a valid date and time."] } };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meeting")
    .update({
      title: v.title,
      description: v.description || null,
      location: v.location || null,
      kind: v.kind,
      visibility: v.visibility,
      department: v.department,
      starts_at: starts,
      ends_at: ends,
      institution_id: v.institution_id,
    })
    .eq("id", v.id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error, "updateMeeting");
  if (!data) return { ok: false, error: "Only the organizer, the founder or the department lead can change this meeting." };
  refresh(v.id);
  return { ok: true, data: undefined };
}

export async function cancelMeeting(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = cancelMeetingSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meeting")
    .update({ status: "cancelled", cancel_reason: parsed.data.reason })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error, "cancelMeeting");
  if (!data) return { ok: false, error: "Only the organizer, the founder or the department lead can cancel this meeting." };
  refresh(parsed.data.id);
  return { ok: true, data: undefined };
}

export async function deleteMeeting(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = meetingIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.from("meeting").delete().eq("id", parsed.data.id).select("id").maybeSingle();
  if (error) return fail(error, "deleteMeeting");
  if (!data) return { ok: false, error: "Only the organizer or the founder can delete a meeting." };
  refresh();
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------- Invitations

export async function respondToMeeting(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = rsvpSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meeting_attendee")
    .update({ rsvp: parsed.data.rsvp, note: parsed.data.note })
    .eq("meeting_id", parsed.data.meeting_id)
    .eq("staff_id", c.me.id)
    .select("meeting_id")
    .maybeSingle();
  if (error) return fail(error, "respondToMeeting");
  if (!data) return { ok: false, error: "You are not invited to this meeting." };
  refresh(parsed.data.meeting_id);
  return { ok: true, data: undefined };
}

export async function respondToSeries(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = seriesRsvpSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_meeting_series", { p_series: parsed.data.series_id, p_rsvp: parsed.data.rsvp });
  if (error) return fail(error, "respondToSeries");
  refresh();
  return { ok: true, data: undefined };
}

export async function addAttendee(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = attendeeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("meeting_attendee").insert({ meeting_id: parsed.data.meeting_id, staff_id: parsed.data.staff_id });
  if (error) return fail(error, "addAttendee");
  refresh(parsed.data.meeting_id);
  return { ok: true, data: undefined };
}

export async function removeAttendee(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = attendeeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meeting_attendee")
    .delete()
    .eq("meeting_id", parsed.data.meeting_id)
    .eq("staff_id", parsed.data.staff_id)
    .select("meeting_id")
    .maybeSingle();
  if (error) return fail(error, "removeAttendee");
  if (!data) return { ok: false, error: "Only the organizer, the founder or the department lead can remove someone." };
  refresh(parsed.data.meeting_id);
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------- Requests

export async function answerMeetingRequest(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = answerRequestSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  let start: string | undefined;
  let end: string | undefined;
  if (v.action === "propose") {
    const s = istInstant(v.date ?? "", v.start_time ?? "");
    const e = istInstant(v.date ?? "", v.end_time ?? "");
    if (!s || !e) return { ok: false, error: "Enter a valid date and time.", fieldErrors: { date: ["Enter a valid date and time."] } };
    start = s;
    end = e;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_meeting_request", {
    p_meeting: v.id,
    p_action: v.action,
    p_start: start,
    p_end: end,
    p_note: v.note ?? undefined,
  });
  if (error) return fail(error, "answerMeetingRequest");
  refresh(v.id);
  return { ok: true, data: undefined };
}

/** The organizer takes a request back. A request nobody has answered is simply cancelled with a reason. */
export async function withdrawRequest(input: unknown): Promise<ActionResult> {
  const parsed = meetingIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return cancelMeeting({ id: parsed.data.id, reason: "Request withdrawn" });
}

// ---------------------------------------------------------------- Double-booking warning

export type BusyHit = { staff_id: string; kind: string; starts_at: string; ends_at: string };

/** Who is already booked in a window. A warning for the form; it never blocks scheduling. */
export async function checkBusy(input: unknown): Promise<ActionResult<BusyHit[]>> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = busySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const from = istInstant(v.date, v.start_time);
  const to = istInstant(v.date, v.end_time);
  if (!from || !to || to <= from) return { ok: true, data: [] };

  const supabase = await createClient();
  const rows = await listBusy(supabase, v.staff_ids, from, to, v.exclude || null);
  return { ok: true, data: rows.map((r) => ({ staff_id: r.staff_id, kind: r.kind, starts_at: r.starts_at, ends_at: r.ends_at })) };
}

// ---------------------------------------------------------------- Fixed meetings

export async function saveSeries(input: unknown): Promise<ActionResult<{ id: string }>> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canScheduleMeeting(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = seriesSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { id, ...v } = parsed.data;

  const row = {
    title: v.title,
    description: v.description || null,
    location: v.location || null,
    kind: v.kind,
    visibility: v.visibility,
    department: v.department,
    frequency: v.frequency,
    weekday: v.frequency === "monthly" ? null : (v.weekday ?? null),
    month_day: v.frequency === "monthly" ? (v.month_day ?? null) : null,
    start_time: v.start_time,
    duration_minutes: v.duration_minutes,
    starts_on: v.starts_on,
    ends_on: v.ends_on,
    all_department: v.all_department,
    staff_ids: v.staff_ids,
  };
  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase.from("meeting_series").update(row).eq("id", id).select("id").maybeSingle();
    if (error) return fail(error, "saveSeries");
    if (!data) return { ok: false, error: "Only the organizer or the founder can change a fixed meeting." };
    refresh();
    return { ok: true, data: { id: data.id } };
  }
  const { data, error } = await supabase.from("meeting_series").insert(row).select("id").single();
  if (error) return fail(error, "saveSeries");
  refresh();
  return { ok: true, data: { id: data.id } };
}

export async function setSeriesActive(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = seriesActiveSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.from("meeting_series").update({ active: parsed.data.active }).eq("id", parsed.data.id).select("id").maybeSingle();
  if (error) return fail(error, "setSeriesActive");
  if (!data) return { ok: false, error: "Only the organizer or the founder can pause a fixed meeting." };
  refresh();
  return { ok: true, data: undefined };
}

export async function deleteSeries(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = seriesIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.from("meeting_series").delete().eq("id", parsed.data.id).select("id").maybeSingle();
  if (error) return fail(error, "deleteSeries");
  if (!data) return { ok: false, error: "Only the organizer or the founder can remove a fixed meeting." };
  refresh();
  return { ok: true, data: undefined };
}
