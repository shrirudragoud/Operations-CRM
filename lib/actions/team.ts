"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionCaller } from "@/lib/auth";
import { fail, type ActionResult } from "@/lib/errors";
import { inviteIdSchema, inviteSchema, updateAccessSchema } from "@/lib/schemas/team";
import { createClient } from "@/utils/supabase/server";

// Thin wrappers over founder-only RPCs (0010). Each re-checks the caller, validates with Zod, and
// returns the database's own rule message on failure. RLS + RPC checks are the real guard.

function invalid(error: z.ZodError): { ok: false; error: string; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { ok: false, error: "Check the highlighted fields.", fieldErrors };
}

export async function inviteStaff(input: unknown): Promise<ActionResult<{ email: string }>> {
  const caller = await actionCaller("team");
  if ("error" in caller) return { ok: false, error: caller.error };
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_staff", {
    p_email: parsed.data.email,
    p_role: parsed.data.role,
    p_departments: parsed.data.departments,
    p_full_name: parsed.data.full_name || undefined,
  });
  if (error) return fail(error, "inviteStaff");
  revalidatePath("/team");
  return { ok: true, data: { email: data.email } };
}

/** Re-invite = refresh the open invite's expiry (same role/departments). */
export async function resendInvite(input: unknown): Promise<ActionResult<{ email: string }>> {
  const caller = await actionCaller("team");
  if ("error" in caller) return { ok: false, error: caller.error };
  const parsed = inviteIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data: inv, error: readError } = await supabase
    .from("invite")
    .select("email, full_name, role, departments")
    .eq("id", parsed.data.invite_id)
    .is("accepted_at", null)
    .maybeSingle();
  if (readError) return fail(readError, "resendInvite.read");
  if (!inv) return { ok: false, error: "Invite not found or already accepted." };

  const { data, error } = await supabase.rpc("invite_staff", {
    p_email: inv.email,
    p_role: inv.role,
    p_departments: inv.departments,
    p_full_name: inv.full_name ?? undefined,
  });
  if (error) return fail(error, "resendInvite");
  revalidatePath("/team");
  return { ok: true, data: { email: data.email } };
}

export async function revokeInvite(input: unknown): Promise<ActionResult> {
  const caller = await actionCaller("team");
  if ("error" in caller) return { ok: false, error: caller.error };
  const parsed = inviteIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_invite", { p_invite: parsed.data.invite_id });
  if (error) return fail(error, "revokeInvite");
  revalidatePath("/team");
  return { ok: true, data: undefined };
}

export async function updateStaffAccess(input: unknown): Promise<ActionResult> {
  const caller = await actionCaller("team");
  if ("error" in caller) return { ok: false, error: caller.error };
  const parsed = updateAccessSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_staff_access", {
    p_staff: parsed.data.staff_id,
    p_role: parsed.data.role,
    p_departments: parsed.data.departments,
    p_is_active: parsed.data.is_active,
  });
  if (error) return fail(error, "updateStaffAccess");
  revalidatePath("/team");
  revalidatePath("/", "layout"); // the edited person's nav may change
  return { ok: true, data: undefined };
}
