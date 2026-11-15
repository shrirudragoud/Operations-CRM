import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/db.types";
import { supabaseEnv } from "@/lib/env";

/** Paths reachable without a session. Everything else needs a signed-in user. */
export function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/auth/");
}

// Runs on every matched request (docs/ARCHITECTURE.md, corrected quickstart):
// 1. builds a server client bound to the request/response cookies,
// 2. calls auth.getUser(), which validates the JWT and refreshes the session cookies,
// 3. redirects users without a session to /login (keeping refreshed cookies on the redirect).
// This is an optimistic gate only; pages and actions re-check access via ops.me() and RLS.
export async function updateSession(request: NextRequest) {
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

  // Do not put code between createServerClient and getUser(): it would make sessions flaky.
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
