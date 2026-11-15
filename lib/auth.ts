import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { canAccess, meSchema, type Area, type Me } from "@/lib/permissions";

/**
 * The signed-in staff member, from ops.me() (null if not signed in, no staff row, or deactivated).
 * Memoised per request so layout + page + actions share one round trip.
 */
export const getMe = cache(async (): Promise<Me | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("me");
  if (error) {
    console.error(JSON.stringify({ level: "error", context: "getMe", code: error.code, message: error.message }));
    return null;
  }
  const parsed = meSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
});

/** For pages inside the app shell: no active staff row -> /no-access. */
export async function requireMe(): Promise<Me> {
  const me = await getMe();
  if (!me) redirect("/no-access");
  return me;
}

/** For pages: returns the user and whether they may open the area (render AccessDenied if not). */
export async function requireArea(area: Area): Promise<{ me: Me; allowed: boolean }> {
  const me = await requireMe();
  return { me, allowed: canAccess(me, area) };
}

/** For Server Actions: re-check the caller server-side; never trust the UI alone. */
export async function actionCaller(area?: Area): Promise<{ me: Me } | { error: string }> {
  const me = await getMe();
  if (!me) return { error: "Your session has expired or your access was removed. Sign in again." };
  if (area && !canAccess(me, area)) return { error: "You don't have permission to do that." };
  return { me };
}
