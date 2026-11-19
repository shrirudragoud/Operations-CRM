import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import type { Database } from "@/lib/db.types";
import { supabaseEnv } from "@/lib/env";
import { RID_HEADER, TIMING_ON, timedFetch } from "@/lib/timing";

const timed = TIMING_ON ? timedFetch(async () => (await headers()).get(RID_HEADER) ?? undefined) : undefined;

// Server client for Server Components, Server Actions and Route Handlers. Uses the user's JWT
// from cookies, so every query runs under RLS as that user. Never use a secret key here.
export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = supabaseEnv();
  return createServerClient<Database>(url, publishableKey, {
    db: { schema: "ops" },
    global: timed ? { fetch: timed } : undefined,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes the
          // session on every request, so this is safe to ignore.
        }
      },
    },
  });
}
