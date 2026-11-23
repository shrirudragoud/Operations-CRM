"use server";

import { revalidatePath } from "next/cache";
import { actionCaller } from "@/lib/auth";
import { fail, type ActionResult } from "@/lib/errors";
import { pushEndpointSchema, pushGroupsSchema, pushSubscriptionSchema } from "@/lib/schemas/push";
import { createClient } from "@/utils/supabase/server";

// The database owns the rules (ops.save_push_subscription checks the address; a trigger queues the pushes). These only call it.
export async function savePushSubscription(input: unknown): Promise<ActionResult> {
  const c = await actionCaller();
  if ("error" in c) return { ok: false, error: c.error };
  const p = pushSubscriptionSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "This browser sent something we could not use. Try again." };
  const { error } = await (await createClient()).rpc("save_push_subscription", {
    p_endpoint: p.data.endpoint, p_p256dh: p.data.p256dh, p_auth: p.data.auth, p_user_agent: p.data.userAgent,
  });
  if (error) return fail(error, "savePushSubscription");
  revalidatePath("/account");
  return { ok: true, data: undefined };
}

export async function removePushSubscription(input: unknown): Promise<ActionResult> {
  const c = await actionCaller();
  if ("error" in c) return { ok: false, error: c.error };
  const p = pushEndpointSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "This browser sent something we could not use." };
  const { error } = await (await createClient()).rpc("remove_push_subscription", { p_endpoint: p.data.endpoint });
  if (error) return fail(error, "removePushSubscription");
  revalidatePath("/account");
  return { ok: true, data: undefined };
}

export async function savePushGroups(input: unknown): Promise<ActionResult> {
  const c = await actionCaller();
  if ("error" in c) return { ok: false, error: c.error };
  const p = pushGroupsSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check your choices." };
  const { error } = await (await createClient()).rpc("set_push_groups", { p_groups: p.data.groups });
  if (error) return fail(error, "savePushGroups");
  revalidatePath("/account");
  return { ok: true, data: undefined };
}

export async function sendTestPush(): Promise<ActionResult<number>> {
  const c = await actionCaller();
  if ("error" in c) return { ok: false, error: c.error };
  const { data, error } = await (await createClient()).rpc("queue_test_push");
  if (error) return fail(error, "sendTestPush");
  return { ok: true, data: Number(data ?? 0) };
}
