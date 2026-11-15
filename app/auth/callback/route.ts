import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { finishSignIn } from "@/lib/claim";
import { safeNextPath } from "@/lib/safe-redirect";

// OAuth (Google) and magic-link (PKCE) sign-ins land here: exchange the code for a session, then
// finishSignIn() asks the database whether this person has access.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const toLogin = (reason: string) => NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);

  // Provider-side errors (user cancelled Google, expired link) arrive as ?error=...
  if (searchParams.get("error")) return toLogin(searchParams.get("error_description") ?? "sign_in_failed");
  if (!code) return toLogin("missing_code");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return toLogin("link_invalid");
  return finishSignIn(origin, next);
}
