import "server-only";
import { redirectTo } from "@/lib/redirect";
import { createClient } from "@/utils/supabase/server";

type ClaimStatus = "active" | "claimed" | "disabled" | "no_invite";

/**
 * Shared tail of every sign-in method (Google, magic link, password): ask the database whether the
 * signed-in person has access (docs/ACCESS_MODEL.md "Sign-in flow") and route them accordingly.
 */
export async function finishSignIn(next: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_access");
  if (error) {
    console.error(JSON.stringify({ level: "error", context: "claim_access", code: error.code, message: error.message }));
    return redirectTo("/login?error=claim_failed");
  }
  const status = (data as { status?: ClaimStatus } | null)?.status;
  switch (status) {
    case "active":
      return redirectTo(next);
    case "claimed":
      return redirectTo("/?welcome=1");
    case "disabled":
      return redirectTo("/no-access?reason=disabled");
    default:
      return redirectTo("/no-access");
  }
}
