import type { NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/proxy";

// Next 16 renamed middleware.ts to proxy.ts; behaviour is the same (docs/DECISIONS.md D13).
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
