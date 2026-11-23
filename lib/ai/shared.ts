import "server-only";
import { decryptKey, KeyVaultError } from "@/lib/ai/crypto";
import { GeminiError } from "@/lib/ai/gemini";
import { loadNames, toDraftCard } from "@/lib/ai/thread";
import type { DraftCard } from "@/lib/ai/types";
import { actionCaller } from "@/lib/auth";
import { fail } from "@/lib/errors";
import type { createClient } from "@/utils/supabase/server";

// Pieces the assistant's server actions (chat and voice) have in common.

export type Supabase = Awaited<ReturnType<typeof createClient>>;

export const ACTION_COLS = "id, kind, summary, status, payload, result, error, expires_at, conversation_id";

export const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function problem(e: unknown): string {
  if (e instanceof KeyVaultError || e instanceof GeminiError) return e.message;
  console.error(JSON.stringify({ level: "error", context: "assistant", message: e instanceof Error ? e.message : String(e) }));
  return "Something went wrong. Please try again.";
}

export async function caller() {
  const c = await actionCaller();
  return "error" in c ? ({ ok: false, error: c.error } as const) : c;
}

export async function storedKey(supabase: Supabase, staffId: string): Promise<{ apiKey: string; model: string } | { error: string }> {
  const { data, error } = await supabase.rpc("load_ai_key");
  if (error) return { error: fail(error, "assistant.load_key").error };
  const row = data?.[0];
  if (!row) return { error: "Add your Gemini key in the assistant settings first." };
  try {
    return { apiKey: decryptKey(row.cipher, staffId), model: row.model };
  } catch (e) {
    return { error: problem(e) };
  }
}

export async function cardOf(supabase: Supabase, row: Parameters<typeof toDraftCard>[0]): Promise<DraftCard> {
  return toDraftCard(row, Date.now(), await loadNames(supabase, [row]));
}
