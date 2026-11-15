import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/db.types";
import { supabaseEnv } from "@/lib/env";

// Server client for Server Components, Server Actions and Route Handlers. Uses the user's JWT
// from cookies, so every query runs under RLS as that user. Never use a secret key here.
export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = supabaseEnv();
  return createServerClient<Database>(url, publishableKey, {
    db: { schema: "ops" },
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
