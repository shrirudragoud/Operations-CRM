import { NextResponse } from "next/server";
import { supabaseEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// For uptime checks. Public, reveals nothing but up or down.
// "db" is true when Postgres itself answers. The REST root needs a secret key, so we ask for an ops table as anon:
// Postgres refuses with 42501 (anon has no access), and that refusal proves the database round trip works.
export async function GET() {
  const { url, publishableKey } = supabaseEnv();
  let db = false;
  try {
    const res = await fetch(`${url}/rest/v1/staff?select=id&limit=1`, {
      headers: { apikey: publishableKey, "Accept-Profile": "ops" },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    const body: unknown = await res.json().catch(() => null);
    db = res.ok || (typeof body === "object" && body !== null && "code" in body && body.code === "42501");
  } catch {
    db = false;
  }
  return NextResponse.json({ status: db ? "ok" : "degraded", db }, { status: db ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
