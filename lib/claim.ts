import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type ClaimStatus = "active" | "claimed" | "disabled" | "no_invite";

/**
 * Shared tail of every sign-in method (Google, magic link, password): ask the database whether the
 * signed-in person has access (docs/ACCESS_MODEL.md "Sign-in flow") and route them accordingly.
 */
export async function finishSignIn(origin: string, next: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_access");
  if (error) {
    console.error(JSON.stringify({ level: "error", context: "claim_access", code: error.code, message: error.message }));
    return NextResponse.redirect(`${origin}/login?error=claim_failed`);
  }
  const status = (data as { status?: ClaimStatus } | null)?.status;
  switch (status) {
    case "active":
      return NextResponse.redirect(`${origin}${next}`);
    case "claimed":
      return NextResponse.redirect(`${origin}/?welcome=1`);
    case "disabled":
      return NextResponse.redirect(`${origin}/no-access?reason=disabled`);
    default:
      return NextResponse.redirect(`${origin}/no-access`);
  }
}
