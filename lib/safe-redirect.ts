/** Only allow same-site relative paths as post-login destinations (prevents open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next.startsWith("/auth/") || next === "/login" || next.startsWith("/no-access")) return fallback;
  return next;
}
