"use server";

import { z } from "zod";
import { capResult } from "@/lib/ai/agent";
import { vaultConfigured } from "@/lib/ai/crypto";
import { buildToolEnv } from "@/lib/ai/env";
import { buildSetup, pickLiveModel, type LiveTool } from "@/lib/ai/live";
import { liveSocketUrl, listLiveModels, mintLiveToken } from "@/lib/ai/live-server";
import { CONFIRM_DRAFTS_TOOL, voicePrompt } from "@/lib/ai/prompt";
import { activityDetection, DEFAULT_PREFS, voicePrefsSchema, voiceStylePrompt } from "@/lib/ai/voice-prefs";
import { ACTION_COLS, caller, cardOf, problem, storedKey } from "@/lib/ai/shared";
import { runTool, toolsFor } from "@/lib/ai/registry";
import { MAX_DRAFTS_PER_MESSAGE } from "@/lib/ai/tools";
import type { DraftCard } from "@/lib/ai/types";
import type { Json } from "@/lib/db.types";
import { fail, type ActionResult } from "@/lib/errors";
import { todayIST } from "@/lib/format";
import { createClient } from "@/utils/supabase/server";

// The server's side of voice mode. The browser talks to Gemini directly with a short-lived token, so the person's key
// stays here. Tool calls come back through runVoiceTool, which runs them under the person's own session exactly like a
// typed message does: reads answer, writes only become draft cards that the person confirms.

const VOICE_TITLE = "Voice chat";

const CONFIRM_TOOL: LiveTool = {
  name: CONFIRM_DRAFTS_TOOL,
  description: "Confirm the task drafts waiting for the person. Call it only after the person has just said 'create', 'yes', 'confirm' or 'go ahead' out loud. Never on your own.",
  parameters: { type: "object", properties: {} },
};

const startSchema = z.object({
  model: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/).optional(),
  resume_handle: z.string().min(1).max(500).optional(),
  prefs: voicePrefsSchema.optional(),
  task_id: z.uuid().optional(),
});
const toolSchema = z.object({
  conversation_id: z.uuid(),
  name: z.string().min(1).max(60),
  args: z.record(z.string(), z.unknown()).default({}),
  drafts_left: z.number().int().min(0).max(MAX_DRAFTS_PER_MESSAGE),
});
const saveSchema = z.object({
  conversation_id: z.uuid(),
  messages: z.array(z.object({ role: z.enum(["user", "model"]), text: z.string().trim().min(1).max(4000) })).min(1).max(40),
  draft_ids: z.array(z.uuid()).max(MAX_DRAFTS_PER_MESSAGE).default([]),
});

const invalid = (e: z.ZodError) => ({ ok: false, error: e.issues[0]?.message ?? "Check what you entered." }) as const;

export type VoiceStart = { wsUrl: string; setup: ReturnType<typeof buildSetup>; model: string };

export async function startVoiceSession(input: unknown): Promise<ActionResult<VoiceStart>> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = startSchema.safeParse(input ?? {});
  if (!parsed.success) return invalid(parsed.error);
  if (!vaultConfigured()) return { ok: false, error: "The assistant is not set up on this server yet. Tell the founder." };

  const supabase = await createClient();
  const key = await storedKey(supabase, c.me.id);
  if ("error" in key) return { ok: false, error: key.error };

  const prefs = parsed.data.prefs ?? DEFAULT_PREFS;
  try {
    const model = parsed.data.model ?? pickLiveModel(await listLiveModels(key.apiKey));
    if (!model) return { ok: false, error: "Your Gemini key has no voice model. Voice needs a Gemini Live model; check your plan in Google AI Studio." };

    let current: { id: string; title: string } | null = null;
    if (parsed.data.task_id) {
      const { data } = await supabase.from("task").select("id, title").eq("id", parsed.data.task_id).maybeSingle();
      current = data ?? null;
    }
    const { token } = await mintLiveToken(key.apiKey);
    return {
      ok: true,
      data: {
        wsUrl: liveSocketUrl(token),
        model,
        setup: buildSetup({
          model,
          system: voicePrompt({ me: c.me, today: todayIST(), current }) + voiceStylePrompt(prefs),
          tools: [...toolsFor(c.me), CONFIRM_TOOL],
          resumeHandle: parsed.data.resume_handle,
          voice: prefs.voice,
          activity: activityDetection(prefs),
        }),
      },
    };
  } catch (e) {
    return { ok: false, error: problem(e) };
  }
}

export async function createVoiceChat(): Promise<ActionResult<{ id: string }>> {
  const c = await caller();
  if ("ok" in c) return c;
  const { data, error } = await (await createClient()).from("ai_conversation").insert({ title: VOICE_TITLE }).select("id").single();
  if (error) return fail(error, "voice.new_chat");
  return { ok: true, data: { id: data.id } };
}

export async function runVoiceTool(input: unknown): Promise<ActionResult<{ result: Record<string, unknown>; draft: DraftCard | null }>> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = toolSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { conversation_id, name, args, drafts_left } = parsed.data;

  const supabase = await createClient();
  const result = capResult(await runTool(buildToolEnv(supabase, c.me, conversation_id), name, args, { drafts: drafts_left }));
  let draft: DraftCard | null = null;
  if (typeof result.draft_id === "string") {
    const { data } = await supabase.from("ai_action").select(ACTION_COLS).eq("id", result.draft_id).maybeSingle();
    if (data) draft = await cardOf(supabase, data);
  }
  return { ok: true, data: { result, draft } };
}

/** Save what was said in a spoken exchange as ordinary chat messages, so it shows up in the chat history. */
export async function saveVoiceTurn(input: unknown): Promise<ActionResult> {
  const c = await caller();
  if ("ok" in c) return c;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { conversation_id, messages } = parsed.data;
  const supabase = await createClient();

  let drafts: string[] = [];
  if (parsed.data.draft_ids.length > 0) {
    const { data } = await supabase.from("ai_action").select("id").eq("conversation_id", conversation_id).in("id", parsed.data.draft_ids);
    drafts = (data ?? []).map((d) => d.id);
  }
  const rows = messages.map((m) => ({ conversation_id, role: m.role, content: { parts: [{ text: m.text }] } as Json }));
  if (drafts.length > 0) {
    const last = rows.findLastIndex((r) => r.role === "model");
    if (last >= 0) rows[last] = { ...rows[last]!, content: { parts: [{ text: messages[last]!.text }], drafts } as Json };
    else rows.push({ conversation_id, role: "model", content: { parts: [{ text: "I drafted this for you." }], drafts } as Json });
  }
  const { error } = await supabase.from("ai_message").insert(rows);
  if (error) return fail(error, "voice.save_turn");

  const firstUser = messages.find((m) => m.role === "user");
  if (firstUser) await supabase.from("ai_conversation").update({ title: firstUser.text.slice(0, 60) }).eq("id", conversation_id).eq("title", VOICE_TITLE);
  return { ok: true, data: undefined };
}
