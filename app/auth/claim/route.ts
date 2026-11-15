import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { finishSignIn } from "@/lib/claim";
import { safeNextPath } from "@/lib/safe-redirect";

// Password sign-in has no code to exchange: the browser already holds a session, so just run the
// access check. Requires a valid session (getUser validates the JWT with Supabase Auth).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login?error=link_invalid`);
  return finishSignIn(origin, safeNextPath(searchParams.get("next")));
}
