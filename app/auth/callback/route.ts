import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";

type ClaimStatus = "active" | "claimed" | "disabled" | "no_invite";

// OAuth (Google) and magic-link (PKCE) sign-ins land here. Exchange the code for a session, then ask
// the database whether this person has access (docs/ACCESS_MODEL.md "Sign-in flow").
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const toLogin = (reason: string) => NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);

  // Provider-side errors (user cancelled Google, expired link) arrive as ?error=...
  if (searchParams.get("error")) return toLogin(searchParams.get("error_description") ?? "sign_in_failed");
  if (!code) return toLogin("missing_code");

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return toLogin("link_invalid");

  const { data, error } = await supabase.rpc("claim_access");
  if (error) {
    console.error(JSON.stringify({ level: "error", context: "claim_access", code: error.code, message: error.message }));
    return toLogin("claim_failed");
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
