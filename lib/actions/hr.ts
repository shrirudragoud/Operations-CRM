"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionCaller } from "@/lib/auth";
import { fail, PERMISSION_ERROR, type ActionResult } from "@/lib/errors";
import { createClient } from "@/utils/supabase/server";

const hrFlagSchema = z.object({ staff_id: z.uuid(), is_hr: z.boolean() });

// The database refuses anyone but the founder (staff update policy + ops.staff_hr_flag) and clears the flag for viewers and partners.
export async function setIsHr(input: unknown): Promise<ActionResult> {
  const c = await actionCaller("team");
  if ("error" in c) return { ok: false, error: c.error };
  const p = hrFlagSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Check the highlighted fields." };
  const { data, error } = await (await createClient())
    .from("staff").update({ is_hr: p.data.is_hr }).eq("id", p.data.staff_id).select("id").maybeSingle();
  if (error) return fail(error, "setIsHr");
  if (!data) return { ok: false, error: PERMISSION_ERROR };
  revalidatePath("/team");
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
