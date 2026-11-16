import { redirectTo } from "@/lib/redirect";
import { createClient } from "@/utils/supabase/server";

// POST only (a form button), so a link or prefetch can never sign someone out.
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return redirectTo("/login", 303);
}
