"use server";

import { revalidatePath } from "next/cache";
import { actionCaller } from "@/lib/auth";
import { fail, type ActionResult } from "@/lib/errors";
import { emailPrefsSchema } from "@/lib/schemas/email";
import { createClient } from "@/utils/supabase/server";

// The database owns the rules (ops.set_email_pref checks the choices; a trigger queues the mail). These only call it.
export async function saveEmailPrefs(input: unknown): Promise<ActionResult> {
  const c = await actionCaller();
  if ("error" in c) return { ok: false, error: c.error };
  const p = emailPrefsSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check your choices." };
  const { error } = await (await createClient()).rpc("set_email_pref", { p_enabled: p.data.enabled, p_groups: p.data.groups });
  if (error) return fail(error, "saveEmailPrefs");
  revalidatePath("/account");
  return { ok: true, data: undefined };
}

export async function sendTestEmail(): Promise<ActionResult> {
  const c = await actionCaller();
  if ("error" in c) return { ok: false, error: c.error };
  const { error } = await (await createClient()).rpc("queue_test_email");
  if (error) return fail(error, "sendTestEmail");
  revalidatePath("/account");
  return { ok: true, data: undefined };
}
