import { NextResponse } from "next/server";

/**
 * Redirect with a relative Location. Behind the Cloudflare tunnel the Docker server binds 0.0.0.0:3000,
 * so `request.nextUrl.origin` is that internal address, not ops.hard-code.in; a relative Location is
 * resolved by the browser against the URL it actually used.
 */
export function redirectTo(path: string, status: 301 | 302 | 303 | 307 | 308 = 307): NextResponse {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("redirectTo needs a same-site path");
  return new NextResponse(null, { status, headers: { Location: path } });
}
