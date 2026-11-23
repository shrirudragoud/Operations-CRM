"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AgentFailure, runAgent, type StoredMessage } from "@/lib/ai/agent";
import { encryptKey, keyHint, looksLikeGeminiKey, vaultConfigured } from "@/lib/ai/crypto";
import { mergeMeeting } from "@/lib/ai/calendar-drafts";
import { mergeEdit } from "@/lib/ai/drafts";
import { mergeDeal } from "@/lib/ai/sales-drafts";
import { mergeEvent } from "@/lib/ai/workshop-drafts";
import { buildToolEnv } from "@/lib/ai/env";
import { listModels, pickDefaultModel } from "@/lib/ai/gemini";
import { refLink } from "@/lib/ai/links";
import { ACTION_COLS, caller, cardOf, problem, rec, storedKey, type Supabase } from "@/lib/ai/shared";
import { loadThread } from "@/lib/ai/thread";
import type { AssistantStatus, ChatSummary, DraftCard, ModelOption, Thread } from "@/lib/ai/types";
import type { Json } from "@/lib/db.types";
import { fail, type ActionResult } from "@/lib/errors";
import { logActivity } from "@/lib/actions/activity";
import { createDeal, moveDeal, updateDeal } from "@/lib/actions/deal";
import { cancelEvent, completeEvent, createEvent, scheduleEvent, setEventTeam, startEvent, toggleRunSheetItem, updateEvent } from "@/lib/actions/event";
import { cancelMeeting, respondToMeeting, scheduleMeeting, updateMeeting } from "@/lib/actions/meeting";
import { addTaskComment, assignTask, changeTaskStatus, createTask, scheduleTask, updateTask } from "@/lib/actions/task";
import { createClient } from "@/utils/supabase/server";

// The assistant's server side. The Gemini key is encrypted before it is stored and only decrypted here, for one turn.
// A draft the assistant proposes is stored as a pending row; only confirmAiAction runs it, through the same task actions
// the forms use, so permissions, validation and the database's task rules apply exactly as if the person had clicked.

const TURN_TIMEOUT_MS = 90_000;
const STALE_RUNNING_MS = 5 * 60_000;

const keySchema = z.object({ key: z.string().trim().min(1, "Paste your Gemini API key."), model: z.string().trim().max(80).optional() });
const modelSchema = z.object({ model: z.string().trim().min(1, "Choose a model.").max(80) });
const idSchema = z.object({ id: z.uuid() });
const sendSchema = z.object({
  conversation_id: z.uuid().optional(),
  text: z.string().trim().min(1, "Type a message.").max(4000, "That message is too long. Keep it under 4000 characters."),
  task_id: z.uuid().optional(),
});
const renameSchema = z.object({ id: z.uuid(), title: z.string().trim().min(1, "Give the chat a name.").max(120) });

function invalid(error: z.ZodError): { ok: false; error: string } {
  return { ok: false, error: error.issues[0]?.message ?? "Check what you entered." };
}

function modelOptions(models: { id: string; label: string }[]): ModelOption[] {
  return models.map((m) => ({ id: m.id, label: m.label }));
}

// ---------------------------------------------------------------- key and model

export async function assistantStatus(): Promise<ActionResult<AssistantStatus>> {
  const c = await caller();
  if ("ok" in c) return c;
  const supabase = await createClient();
  const { data, error } = await supabase.from("ai_key").select("key_hint, model").maybeSingle();
  if (error) return fail(error, "assistant.status");
  return { ok: true, data: { vaultConfigured: vaultConfigured(), hasKey: !!data, keyHint: data?.key_hint ?? null, model: data?.model ?? null } };
}

export async function saveAiKey(input: unknown): Promise<ActionResult<{ models: ModelOption[]; model: string }>> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = keySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { key, model: wanted } = parsed.data;
  if (!vaultConfigured()) return { ok: false, error: "The assistant is not set up on this server yet. Tell the founder." };
  if (!looksLikeGeminiKey(key)) return { ok: false, error: "That does not look like a Gemini API key. Copy the whole key from Google AI Studio, with no spaces." };

  try {
    const models = await listModels(key);
    if (models.length === 0) return { ok: false, error: "This key works, but it has no chat models available. Check the key in Google AI Studio." };
    const model = wanted && models.some((m) => m.id === wanted) ? wanted : pickDefaultModel(models);
    if (!model) return { ok: false, error: "This key has no chat model I can use." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_ai_key", { p_cipher: encryptKey(key, c.me.id), p_hint: keyHint(key), p_model: model });
    if (error) return fail(error, "assistant.save_key");
    revalidatePath("/assistant");
    return { ok: true, data: { models: modelOptions(models), model } };
  } catch (e) {
    return { ok: false, error: problem(e) };
  }
}

export async function removeAiKey(): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_ai_key");
  if (error) return fail(error, "assistant.delete_key");
  revalidatePath("/assistant");
  return { ok: true, data: undefined };
}

/** The chat models the saved key can use, for the model picker. */
export async function listAiModels(): Promise<ActionResult<{ models: ModelOption[]; model: string }>> {
  const c = await caller();
  if ("ok" in c) return c;
  const supabase = await createClient();
  const key = await storedKey(supabase, c.me.id);
  if ("error" in key) return { ok: false, error: key.error };
  try {
    return { ok: true, data: { models: modelOptions(await listModels(key.apiKey)), model: key.model } };
  } catch (e) {
    return { ok: false, error: problem(e) };
  }
}

export async function setAiModel(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = modelSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const key = await storedKey(supabase, c.me.id);
  if ("error" in key) return { ok: false, error: key.error };
  try {
    const models = await listModels(key.apiKey);
    if (!models.some((m) => m.id === parsed.data.model)) return { ok: false, error: "That model is not available for your key." };
  } catch (e) {
    return { ok: false, error: problem(e) };
  }
  const { error } = await supabase.rpc("set_ai_model", { p_model: parsed.data.model });
  if (error) return fail(error, "assistant.set_model");
  revalidatePath("/assistant");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------- chats

export async function listChats(): Promise<ActionResult<ChatSummary[]>> {
  const c = await caller();
  if ("ok" in c) return c;
  const supabase = await createClient();
  const { data, error } = await supabase.from("ai_conversation").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(200);
  if (error) return fail(error, "assistant.list_chats");
  return { ok: true, data: (data ?? []).map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at })) };
}

export async function loadAssistantThread(input: unknown): Promise<ActionResult<Thread>> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const thread = await loadThread(await createClient(), parsed.data.id);
  return thread ? { ok: true, data: thread } : { ok: false, error: "That chat was not found." };
}

export async function deleteConversation(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { error } = await (await createClient()).from("ai_conversation").delete().eq("id", parsed.data.id);
  if (error) return fail(error, "assistant.delete_chat");
  revalidatePath("/assistant");
  return { ok: true, data: undefined };
}

export async function renameConversation(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { error } = await (await createClient()).from("ai_conversation").update({ title: parsed.data.title }).eq("id", parsed.data.id);
  if (error) return fail(error, "assistant.rename_chat");
  revalidatePath("/assistant");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------- one turn

async function dropTurn(supabase: Supabase, userMessageId: string, conversationId: string, createdChat: boolean, draftIds: string[]) {
  if (draftIds.length > 0) await supabase.from("ai_action").update({ status: "cancelled" }).in("id", draftIds).eq("status", "pending");
  if (createdChat) await supabase.from("ai_conversation").delete().eq("id", conversationId);
  else await supabase.from("ai_message").delete().eq("id", userMessageId);
}

// A bad key, spent quota, a rate limit or a missing model fail every retry, so the question is not kept.
const NOT_KEPT = new Set(["bad_key", "quota", "rate", "model"]);

const CONFIRM_WORDS = /^\s*(create|create it|create task|create the task|create this task|confirm|confirm it|yes|yes please|yep|yeah|ok|okay|go ahead|do it|looks good|sure)\s*[.!]*\s*$/i;

/** When the last thing in the chat is a draft waiting for a decision, a short "create" runs it. Returns null if there is none. */
async function confirmByReply(supabase: Supabase, me: Parameters<typeof buildToolEnv>[1], conversationId: string, text: string): Promise<ActionResult<Thread> | null> {
  const { data: last } = await supabase.from("ai_message").select("role, content").eq("conversation_id", conversationId).order("seq", { ascending: false }).limit(1).maybeSingle();
  const ids = last?.role === "model" && Array.isArray(rec(last.content).drafts) ? (rec(last.content).drafts as unknown[]).filter((d): d is string => typeof d === "string") : [];
  if (ids.length === 0) return null;
  const { data: pending } = await supabase.from("ai_action").select("id").in("id", ids).eq("status", "pending").gt("expires_at", new Date().toISOString());
  const todo = ids.filter((id) => (pending ?? []).some((p) => p.id === id));
  if (todo.length === 0) return null;

  const done: DraftCard[] = [];
  const problems: string[] = [];
  for (const id of todo) {
    const r = await confirmDraft(supabase, me, id);
    if (r.ok && r.data.status === "done") done.push(r.data);
    else problems.push(r.ok ? r.data.error ?? "It did not go through." : r.error);
  }

  const links = done.flatMap((d) =>
    d.links.flatMap((l, i) => (l.ref ? [refLink(l.ref.kind, l.ref.id, l.ref.kind === "task" && d.task ? d.task.title : l.label, l.ref.kind === "task" ? (i === 0 ? "Open the task" : `Task ${i + 1}`) : "Open")] : [])),
  );
  const reply = [
    done.length > 0 ? (links.length > 0 ? `Done. ${links.join(", ")}` : "Done.") : "",
    problems.length > 0 ? `That did not go through: ${problems[0]} You can press Try again on the card.` : "",
  ].filter(Boolean).join("\n\n");

  const { error } = await supabase.from("ai_message").insert([
    { conversation_id: conversationId, role: "user", content: { parts: [{ text }] } },
    { conversation_id: conversationId, role: "model", content: { parts: [{ text: reply }], drafts: [] } },
  ]);
  if (error) return fail(error, "assistant.save_message");
  revalidatePath("/assistant");
  const thread = await loadThread(supabase, conversationId);
  return thread ? { ok: true, data: thread } : { ok: false, error: "That chat was not found." };
}

export async function sendAssistantMessage(input: unknown): Promise<ActionResult<Thread>> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { text, task_id } = parsed.data;
  if (!vaultConfigured()) return { ok: false, error: "The assistant is not set up on this server yet. Tell the founder." };

  const supabase = await createClient();

  // Replying "create" or "yes" to a draft is the same as pressing its button. It needs no Gemini call, so no key either.
  if (parsed.data.conversation_id && CONFIRM_WORDS.test(text)) {
    const handled = await confirmByReply(supabase, c.me, parsed.data.conversation_id, text);
    if (handled) return handled;
  }

  const key = await storedKey(supabase, c.me.id);
  if ("error" in key) return { ok: false, error: key.error };

  let conversationId = parsed.data.conversation_id;
  let createdChat = false;
  if (!conversationId) {
    const { data, error } = await supabase.from("ai_conversation").insert({ title: text.slice(0, 60) }).select("id").single();
    if (error) return fail(error, "assistant.new_chat");
    conversationId = data.id;
    createdChat = true;
  }

  // The question is saved before Gemini is called, so the chat limits are enforced before any key use.
  const { data: saved, error: saveError } = await supabase
    .from("ai_message")
    .insert({ conversation_id: conversationId, role: "user", content: { parts: [{ text }] } })
    .select("id, seq")
    .single();
  if (saveError) {
    if (createdChat) await supabase.from("ai_conversation").delete().eq("id", conversationId);
    return fail(saveError, "assistant.save_message");
  }

  let draftIds: string[] = [];
  try {
    const { data: rows } = await supabase
      .from("ai_message")
      .select("role, content, seq")
      .eq("conversation_id", conversationId)
      .lt("seq", saved.seq)
      .order("seq", { ascending: false })
      .limit(300);
    const history = (rows ?? []).reverse().map((r) => ({ role: r.role, content: r.content })) as StoredMessage[];

    let current: { id: string; title: string } | null = null;
    if (task_id) {
      const { data: t } = await supabase.from("task").select("id, title").eq("id", task_id).maybeSingle();
      current = t ?? null;
    }

    const result = await runAgent({
      apiKey: key.apiKey,
      model: key.model,
      env: buildToolEnv(supabase, c.me, conversationId),
      history,
      userText: text,
      current,
      signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
    });
    draftIds = result.draftIds;
    const rest = result.produced.slice(1);
    if (rest.length > 0) {
      const { error } = await supabase.from("ai_message").insert(rest.map((m) => ({ conversation_id: conversationId, role: m.role, content: m.content as unknown as Json })));
      if (error) throw error;
    }
  } catch (e) {
    if (e instanceof AgentFailure) {
      draftIds = e.draftIds;
      if (NOT_KEPT.has(e.cause.kind)) {
        await dropTurn(supabase, saved.id, conversationId, createdChat, draftIds);
        return { ok: false, error: e.cause.message };
      }
      const { error } = await supabase.from("ai_message").insert(e.produced.slice(1).map((m) => ({ conversation_id: conversationId, role: m.role, content: m.content as unknown as Json })));
      if (error) await dropTurn(supabase, saved.id, conversationId, createdChat, draftIds);
      else {
        revalidatePath("/assistant");
        const thread = await loadThread(supabase, conversationId);
        if (thread) return { ok: true, data: thread };
      }
      return { ok: false, error: e.cause.message };
    }
    await dropTurn(supabase, saved.id, conversationId, createdChat, draftIds);
    const aborted = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, error: aborted ? "That took too long. Try a smaller request." : problem(e) };
  }

  revalidatePath("/assistant");
  const thread = await loadThread(supabase, conversationId);
  return thread ? { ok: true, data: thread } : { ok: false, error: "That chat was not found." };
}

// ---------------------------------------------------------------- drafts

const clipError = (s: string) => (s.length > 590 ? `${s.slice(0, 589)}…` : s);

/** A form-style failure carries "Check the highlighted fields." and the real reasons beside it; the chat has no fields to highlight. */
function formError(r: { error: string; fieldErrors?: Record<string, string[]> }): string {
  return Object.values(r.fieldErrors ?? {}).flat()[0] ?? r.error;
}

type RunOutcome = { ok: true; result: Json } | { ok: false; error: string; result?: Json };

async function runDraft(
  supabase: Supabase,
  me: Parameters<typeof buildToolEnv>[1],
  row: { kind: string; payload: unknown; result: unknown; conversation_id: string },
): Promise<RunOutcome> {
  const payload = rec(row.payload);
  const done = { ok: true, result: {} } as const;
  const from = <T>(r: ActionResult<T>): RunOutcome => (r.ok ? done : { ok: false, error: r.error });

  switch (row.kind) {
    case "create_task": {
      const r = await createTask(payload);
      return r.ok ? { ok: true, result: { id: r.data.id } } : { ok: false, error: r.error };
    }
    case "create_subtasks": {
      const subtasks = Array.isArray(payload.subtasks) ? payload.subtasks : [];
      const created: Record<string, string> = { ...(rec(rec(row.result).created) as Record<string, string>) };
      for (const [i, sub] of subtasks.entries()) {
        if (created[String(i)]) continue;
        const r = await createTask(sub);
        if (!r.ok) return { ok: false, error: `Subtask ${i + 1} failed: ${r.error}`, result: { created } };
        created[String(i)] = r.data.id;
      }
      return { ok: true, result: { created } };
    }
    case "update_task":
    case "set_schedule": {
      const id = String(payload.id ?? "");
      const live = await buildToolEnv(supabase, me, row.conversation_id).currentTask(id);
      if (!live) return { ok: false, error: "That task was not found, or you don't have permission to change it." };
      const merged = mergeEdit(row.kind, live, rec(payload.changes));
      return from(row.kind === "update_task" ? await updateTask(merged) : await scheduleTask(merged));
    }
    case "change_status":
      return from(await changeTaskStatus(payload));
    case "assign_task":
      return from(await assignTask(payload));
    case "add_comment": {
      const r = await addTaskComment(payload);
      return r.ok ? { ok: true, result: { comment_id: r.data.id } } : { ok: false, error: r.error };
    }
    case "schedule_meeting": {
      const r = await scheduleMeeting(payload);
      return r.ok ? { ok: true, result: { id: r.data.id, kind: r.data.kind } } : { ok: false, error: formError(r) };
    }
    case "update_meeting": {
      const live = await buildToolEnv(supabase, me, row.conversation_id).calendar.meeting(String(payload.id ?? ""));
      if (!live) return { ok: false, error: "That meeting was not found, or you don't have permission to see it." };
      if (live.status === "cancelled" || live.status === "declined") return { ok: false, error: `That meeting is now ${live.status}, so it can no longer be changed.` };
      const r = await updateMeeting(mergeMeeting(live, rec(payload.changes)));
      return r.ok ? done : { ok: false, error: formError(r) };
    }
    case "cancel_meeting": {
      const r = await cancelMeeting({ id: payload.id, reason: payload.reason });
      return r.ok ? done : { ok: false, error: formError(r) };
    }
    case "rsvp_meeting": {
      const r = await respondToMeeting({ meeting_id: payload.meeting_id, rsvp: payload.rsvp, note: payload.note });
      return r.ok ? done : { ok: false, error: formError(r) };
    }
    case "create_event": {
      const r = await createEvent({ institution_id: payload.institution_id, kind: payload.kind, title: payload.title ?? "" });
      return r.ok ? { ok: true, result: { id: r.data.id } } : { ok: false, error: formError(r) };
    }
    case "update_event": {
      const live = await buildToolEnv(supabase, me, row.conversation_id).workshop.event(String(payload.id ?? ""));
      if (!live) return { ok: false, error: "That event was not found, or you don't have permission to see it." };
      const r = await updateEvent(mergeEvent(live, rec(payload.changes)));
      return r.ok ? done : { ok: false, error: formError(r) };
    }
    case "set_event_team": {
      const r = await setEventTeam({ id: payload.id, lead_trainer_id: payload.lead_trainer_id, assistants: payload.assistants ?? [] });
      return r.ok ? done : { ok: false, error: formError(r) };
    }
    case "event_status": {
      const id = payload.id;
      const r =
        payload.action === "schedule"
          ? await scheduleEvent({ id })
          : payload.action === "start"
            ? await startEvent({ id })
            : payload.action === "complete"
              ? await completeEvent({ id, actual_headcount: payload.actual_headcount, satisfaction_score: payload.satisfaction_score ?? "" })
              : payload.action === "cancel"
                ? await cancelEvent({ id, reason: payload.reason })
                : null;
      if (!r) return { ok: false, error: "I do not know how to run that draft." };
      return r.ok ? done : { ok: false, error: formError(r) };
    }
    case "toggle_run_item": {
      const r = await toggleRunSheetItem({ id: payload.id, done: payload.done });
      return r.ok ? done : { ok: false, error: formError(r) };
    }
    case "log_activity": {
      const r = await logActivity({
        institution_id: payload.institution_id,
        contact_id: "",
        kind: payload.kind,
        outcome: payload.outcome ?? "",
        notes: payload.notes ?? "",
        happened_on: payload.happened_on ?? "",
        next_step: payload.next_step ?? "",
        next_step_due: payload.next_step_due ?? "",
      });
      return r.ok ? { ok: true, result: { id: r.data.id } } : { ok: false, error: formError(r) };
    }
    case "create_deal": {
      const r = await createDeal({
        institution_id: payload.institution_id,
        kind: payload.kind,
        title: payload.title ?? "",
        value_inr: payload.value_inr ?? "",
        probability: payload.probability ?? "",
        expected_close: payload.expected_close ?? "",
        owner_id: "",
      });
      return r.ok ? { ok: true, result: { id: r.data.id } } : { ok: false, error: formError(r) };
    }
    case "update_deal": {
      const live = await buildToolEnv(supabase, me, row.conversation_id).sales.deal(String(payload.id ?? ""));
      if (!live) return { ok: false, error: "That deal was not found, or you don't have permission to see it." };
      const r = await updateDeal(mergeDeal(live, rec(payload.changes)));
      return r.ok ? done : { ok: false, error: formError(r) };
    }
    case "move_deal": {
      if (payload.stage === "won") return { ok: false, error: "Only the founder can mark a deal as won, on the deal page." };
      const r = await moveDeal({ id: payload.id, stage: payload.stage, lost_reason: payload.lost_reason ?? "", probability: payload.probability ?? "" });
      return r.ok ? done : { ok: false, error: formError(r) };
    }
    default:
      return { ok: false, error: "I do not know how to run that draft." };
  }
}

async function confirmDraft(supabase: Supabase, me: Parameters<typeof buildToolEnv>[1], id: string): Promise<ActionResult<DraftCard>> {
  // Claim it: only one confirm can move a draft to running, so a double click cannot create things twice.
  let claim = await supabase.from("ai_action").update({ status: "running" }).eq("id", id).in("status", ["pending", "failed"]).select(ACTION_COLS).maybeSingle();
  if (claim.error) return fail(claim.error, "assistant.claim");
  if (!claim.data) {
    const stale = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
    claim = await supabase.from("ai_action").update({ status: "running" }).eq("id", id).eq("status", "running").lt("decided_at", stale).select(ACTION_COLS).maybeSingle();
    if (claim.error) return fail(claim.error, "assistant.claim");
  }
  if (!claim.data) {
    const { data: now } = await supabase.from("ai_action").select("status").eq("id", id).maybeSingle();
    if (!now) return { ok: false, error: "That draft was not found." };
    return { ok: false, error: now.status === "running" ? "That draft is already running." : `That draft is already ${now.status}.` };
  }

  let outcome: RunOutcome;
  try {
    outcome = await runDraft(supabase, me, claim.data);
  } catch (e) {
    outcome = { ok: false, error: problem(e) };
  }

  const { data: finished, error } = await supabase
    .from("ai_action")
    .update(outcome.ok ? { status: "done", result: outcome.result, error: null } : { status: "failed", error: clipError(outcome.error), ...(outcome.result ? { result: outcome.result } : {}) })
    .eq("id", id)
    .eq("status", "running")
    .select(ACTION_COLS)
    .single();
  if (error) return fail(error, "assistant.finish");
  revalidatePath("/assistant");
  return { ok: true, data: await cardOf(supabase, finished) };
}

export async function confirmAiAction(input: unknown): Promise<ActionResult<DraftCard>> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return confirmDraft(await createClient(), c.me, parsed.data.id);
}

export async function discardAiAction(input: unknown): Promise<ActionResult<DraftCard>> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { data, error } = await (await createClient())
    .from("ai_action")
    .update({ status: "cancelled" })
    .eq("id", parsed.data.id)
    .eq("status", "pending")
    .select(ACTION_COLS)
    .maybeSingle();
  if (error) return fail(error, "assistant.discard");
  if (!data) return { ok: false, error: "That draft can no longer be discarded." };
  return { ok: true, data: await cardOf(await createClient(), data) };
}
