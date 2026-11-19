"use server";

import { revalidatePath } from "next/cache";
import { actionCaller } from "@/lib/auth";
import { fail, PERMISSION_ERROR, type ActionResult } from "@/lib/errors";
import { hrProfileSchema, personalProfileSchema } from "@/lib/schemas/profile";
import { createClient } from "@/utils/supabase/server";

// The database decides: RLS lets a person change only their own row, and the guard trigger refuses the HR-owned fields.
export async function saveMyProfile(input: unknown): Promise<ActionResult> {
  const c = await actionCaller("me");
  if ("error" in c) return { ok: false, error: c.error };
  const p = personalProfileSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the highlighted fields." };
  const { data, error } = await (await createClient())
    .from("staff_profile").update(p.data).eq("staff_id", c.me.id).select("staff_id").maybeSingle();
  if (error) return fail(error, "saveMyProfile");
  if (!data) return { ok: false, error: PERMISSION_ERROR };
  revalidatePath("/me/profile");
  revalidatePath("/me/directory");
  return { ok: true, data: undefined };
}

// HR sets the employee code, designation, joined date, employment type, probation end and manager.
export async function saveHrProfile(input: unknown): Promise<ActionResult> {
  const c = await actionCaller("hr");
  if ("error" in c) return { ok: false, error: c.error };
  const p = hrProfileSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the highlighted fields." };
  const { staff_id, ...fields } = p.data;
  const { data, error } = await (await createClient())
    .from("staff_profile").update(fields).eq("staff_id", staff_id).select("staff_id").maybeSingle();
  if (error) return fail(error, "saveHrProfile");
  if (!data) return { ok: false, error: PERMISSION_ERROR };
  revalidatePath("/hr/people");
  revalidatePath(`/hr/people/${staff_id}`);
  revalidatePath("/me/directory");
  return { ok: true, data: undefined };
}
