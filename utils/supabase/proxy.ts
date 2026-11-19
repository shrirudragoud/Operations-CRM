import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/db.types";
import { supabaseEnv } from "@/lib/env";
import { logProxy, PATH_HEADER, RID_HEADER, T0_HEADER, TIMING_ON } from "@/lib/timing";

/** Paths reachable without a session. Everything else needs a signed-in user. */
export function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/api/health" || pathname.startsWith("/auth/");
}

// Runs on every matched request (docs/ARCHITECTURE.md, corrected quickstart):
// 1. builds a server client bound to the request/response cookies,
// 2. calls auth.getClaims(), which verifies the JWT signature locally (cached public keys, no network hop) and refreshes
//    the session cookies when the token has expired. A symmetric-key project falls back to a network check by itself.
// 3. redirects users without a session to /login (keeping refreshed cookies on the redirect).
// This is an optimistic gate only; pages and actions re-check access via ops.me() and RLS.
export async function updateSession(request: NextRequest) {
  const rid = TIMING_ON ? crypto.randomUUID().slice(0, 8) : "";
  if (TIMING_ON) {
    request.headers.set(RID_HEADER, rid);
    request.headers.set(T0_HEADER, String(Date.now()));
    request.headers.set(PATH_HEADER, request.nextUrl.pathname);
  }
  let response = NextResponse.next({ request });
  const { url, publishableKey } = supabaseEnv();

  const supabase = createServerClient<Database>(url, publishableKey, {
    db: { schema: "ops" },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Do not put code between createServerClient and getClaims(): it would make sessions flaky.
  const authStart = TIMING_ON ? performance.now() : 0;
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? data.claims : null;
  if (TIMING_ON) logProxy(rid, request.nextUrl.pathname, performance.now() - authStart);

  const { pathname, search } = request.nextUrl;
  const redirectTo = (path: string) => {
    const target = request.nextUrl.clone();
    target.pathname = path;
    target.search = "";
    if (path === "/login" && pathname !== "/") target.searchParams.set("next", pathname + search);
    const redirect = NextResponse.redirect(target);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (!user && !isPublicPath(pathname)) return redirectTo("/login");
  if (user && pathname === "/login") return redirectTo("/");
  return response;
}
