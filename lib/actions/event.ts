"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionCaller } from "@/lib/auth";
import type { TablesUpdate } from "@/lib/db.types";
import { fail, PERMISSION_ERROR, type ActionResult } from "@/lib/errors";
import { canArchiveEvent, canManageEvents, type Me } from "@/lib/permissions";
import {
  availabilitySchema, cancelEventSchema, completeEventSchema, createEventSchema, defaultEventTitle, eventIdSchema,
  eventTeamSchema, istLocalToIso, runSheetToggleSchema, scheduleMissing, updateEventSchema,
} from "@/lib/schemas/event";
import { createClient } from "@/utils/supabase/server";

// Workshop writes. The state machine, the "certified, not double-booked" checks, the 2-assistant cap, the
// cancel reason and the run-sheet stamps all live in the database (0017 + ops.event_guard); these actions
// validate, pre-check the friendly cases and show the database's own message otherwise.

const NOT_FOUND = "That event was not found, or you don't have permission to change it.";

function invalid(error: z.ZodError): { ok: false; error: string; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) (fieldErrors[issue.path.join(".") || "form"] ??= []).push(issue.message);
  return { ok: false, error: "Check the highlighted fields.", fieldErrors };
}

async function caller(): Promise<{ me: Me } | { ok: false; error: string }> {
  const c = await actionCaller("workshop");
  return "error" in c ? { ok: false, error: c.error } : c;
}

function refresh(id?: string, institutionId?: string) {
  revalidatePath("/workshop");
  if (id) revalidatePath(`/workshop/${id}`);
  if (institutionId) revalidatePath(`/institutions/${institutionId}`);
  revalidatePath("/tasks");
  revalidatePath("/");
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function loadEvent(supabase: Supabase, id: string) {
  return supabase
    .from("event")
    .select("id, institution_id, status, archived_at, lead_trainer_id, starts_at, ends_at, venue, expected_headcount")
    .eq("id", id)
    .maybeSingle();
}

const ARCHIVED = "This event is archived. Restore it first.";

export async function createEvent(input: unknown): Promise<ActionResult<{ id: string }>> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canManageEvents(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const { data: inst, error: instError } = await supabase
    .from("institution")
    .select("id, name, archived_at")
    .eq("id", v.institution_id)
    .maybeSingle();
  if (instError) return fail(instError, "createEvent.institution");
  if (!inst) return { ok: false, error: "That institution was not found, or you don't have access to it." };
  if (inst.archived_at) return { ok: false, error: "This institution is archived. Restore it before adding an event." };

  const { data, error } = await supabase
    .from("event")
    .insert({ institution_id: v.institution_id, kind: v.kind, title: v.title || defaultEventTitle(v.kind, inst.name) })
    .select("id")
    .single();
  if (error) return fail(error, "createEvent");
  refresh(data.id, v.institution_id);
  return { ok: true, data: { id: data.id } };
}

export async function updateEvent(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canManageEvents(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = updateEventSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const { data: ev, error: readError } = await loadEvent(supabase, v.id);
  if (readError) return fail(readError, "updateEvent.read");
  if (!ev) return { ok: false, error: NOT_FOUND };
  if (ev.archived_at) return { ok: false, error: ARCHIVED };
  if (ev.status === "completed" || ev.status === "cancelled") {
    return { ok: false, error: `A ${ev.status} event cannot be edited.` };
  }

  const { data, error } = await supabase
    .from("event")
    .update({
      title: v.title,
      starts_at: v.starts_at,
      ends_at: v.ends_at,
      venue: v.venue === "" ? null : v.venue,
      expected_headcount: v.expected_headcount,
    })
    .eq("id", v.id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error, "updateEvent");
  if (!data) return { ok: false, error: NOT_FOUND };
  refresh(v.id, ev.institution_id);
  return { ok: true, data: undefined };
}

/** Save the lead and the assistants as one set (ops.set_event_team). */
export async function setEventTeam(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canManageEvents(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = eventTeamSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const { data: ev, error: readError } = await loadEvent(supabase, v.id);
  if (readError) return fail(readError, "setEventTeam.read");
  if (!ev) return { ok: false, error: NOT_FOUND };
  if (ev.archived_at) return { ok: false, error: ARCHIVED };

  const { error } = await supabase.rpc("set_event_team", {
    p_event: v.id,
    p_lead: v.lead_trainer_id as string,
    p_assistants: v.assistants,
  });
  if (error) return fail(error, "setEventTeam");
  refresh(v.id, ev.institution_id);
  return { ok: true, data: undefined };
}

export type TrainerOption = { staff_id: string; full_name: string; level: string; is_free: boolean };

/** Certified trainers and founders for a time window, with who is free (ops.available_trainers). */
export async function listAvailableTrainers(input: unknown): Promise<ActionResult<TrainerOption[]>> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canManageEvents(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = availabilitySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("available_trainers", {
    p_from: istLocalToIso(v.starts_at) as string,
    p_to: istLocalToIso(v.ends_at) as string,
    ...(v.exclude_event ? { p_exclude_event: v.exclude_event } : {}),
  });
  if (error) return fail(error, "listAvailableTrainers");
  return { ok: true, data };
}

type Move = TablesUpdate<"event"> & { status: string };

async function transition(id: string, patch: Move, context: string, precheck?: (ev: NonNullable<Awaited<ReturnType<typeof loadEvent>>["data"]>) => string | null): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canManageEvents(c.me)) return { ok: false, error: PERMISSION_ERROR };

  const supabase = await createClient();
  const { data: ev, error: readError } = await loadEvent(supabase, id);
  if (readError) return fail(readError, `${context}.read`);
  if (!ev) return { ok: false, error: NOT_FOUND };
  if (ev.archived_at) return { ok: false, error: ARCHIVED };
  const blocked = precheck?.(ev);
  if (blocked) return { ok: false, error: blocked };

  const { data, error } = await supabase.from("event").update(patch).eq("id", id).select("id").maybeSingle();
  if (error) return fail(error, context);
  if (!data) return { ok: false, error: NOT_FOUND };
  refresh(id, ev.institution_id);
  if (patch.status === "completed") revalidatePath("/inventory");
  return { ok: true, data: undefined };
}

export async function scheduleEvent(input: unknown): Promise<ActionResult> {
  const parsed = eventIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return transition(parsed.data.id, { status: "scheduled" }, "scheduleEvent", (ev) => {
    const missing = scheduleMissing(ev);
    return missing.length > 0 ? `To schedule this event, set: ${missing.join(", ")}.` : null;
  });
}

export async function unscheduleEvent(input: unknown): Promise<ActionResult> {
  const parsed = eventIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return transition(parsed.data.id, { status: "draft" }, "unscheduleEvent");
}

export async function startEvent(input: unknown): Promise<ActionResult> {
  const parsed = eventIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return transition(parsed.data.id, { status: "in_progress" }, "startEvent");
}

export async function completeEvent(input: unknown): Promise<ActionResult> {
  const parsed = completeEventSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  return transition(
    v.id,
    { status: "completed", actual_headcount: v.actual_headcount, satisfaction_score: v.satisfaction_score },
    "completeEvent",
  );
}

export async function cancelEvent(input: unknown): Promise<ActionResult> {
  const parsed = cancelEventSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return transition(parsed.data.id, { status: "cancelled", cancel_reason: parsed.data.reason }, "cancelEvent");
}

/** Tick or untick a run-sheet item. The database stamps who and when (never taken from the client). */
export async function toggleRunSheetItem(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  if (!canManageEvents(c.me)) return { ok: false, error: PERMISSION_ERROR };
  const parsed = runSheetToggleSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("run_sheet_item")
    .update({ done_at: v.done ? new Date().toISOString() : null })
    .eq("id", v.id)
    .select("event_id")
    .maybeSingle();
  if (error) return fail(error, "toggleRunSheetItem");
  if (!data) return { ok: false, error: NOT_FOUND };
  revalidatePath(`/workshop/${data.event_id}`);
  revalidatePath("/");
  return { ok: true, data: undefined };
}

async function setArchived(input: unknown, archive: boolean, context: string): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = eventIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  if (!canArchiveEvent(c.me)) return { ok: false, error: "Only a founder or department lead can archive or restore records" };

  const supabase = await createClient();
  const { data: ev, error: readError } = await loadEvent(supabase, parsed.data.id);
  if (readError) return fail(readError, `${context}.read`);
  if (!ev) return { ok: false, error: NOT_FOUND };

  // guard_archive stamps archived_by and refuses to archive an event that is still scheduled or running.
  const { data, error } = await supabase
    .from("event")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error, context);
  if (!data) return { ok: false, error: NOT_FOUND };
  refresh(parsed.data.id, ev.institution_id);
  return { ok: true, data: undefined };
}

export async function archiveEvent(input: unknown): Promise<ActionResult> {
  return setArchived(input, true, "archiveEvent");
}

export async function restoreEvent(input: unknown): Promise<ActionResult> {
  return setArchived(input, false, "restoreEvent");
}
