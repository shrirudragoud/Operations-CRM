import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db.types";
import { supabaseEnv } from "@/lib/env";

// Browser client: publishable key + the user's session cookie. RLS decides what it sees.
export function createClient() {
  const { url, publishableKey } = supabaseEnv();
  return createBrowserClient<Database>(url, publishableKey, { db: { schema: "ops" } });
}
