// Opt-in request timing (set OPS_TIMING=1 on the server). One JSON log line per Supabase call and one per page, joined by a
// request id that the proxy puts on the request. Off by default: nothing here runs and nothing is logged.
export const TIMING_ON = process.env.OPS_TIMING === "1";

export const RID_HEADER = "x-ops-rid";
export const T0_HEADER = "x-ops-t0";
export const PATH_HEADER = "x-ops-path";

type Stat = { at: number; calls: number; ms: number; slowest: number; slowestOp: string };
const stats = new Map<string, Stat>();
const KEEP_MS = 60_000;

function line(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ level: "timing", at: new Date().toISOString(), ...fields }));
}

/** "rest:task", "rest:rpc/me", "auth:user": the call without its query string (which can hold data). */
export function opName(input: RequestInfo | URL, method = "GET"): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let path: string;
  try {
    path = new URL(raw).pathname;
  } catch {
    path = raw.split("?")[0] ?? raw;
  }
  return `${method} ${path.replace("/rest/v1/", "rest:").replace("/auth/v1/", "auth:")}`;
}

export function recordCall(rid: string, op: string, ms: number, status: number, now = Date.now()) {
  for (const [key, s] of stats) if (now - s.at > KEEP_MS) stats.delete(key);
  const s = stats.get(rid) ?? { at: now, calls: 0, ms: 0, slowest: 0, slowestOp: "" };
  s.calls += 1;
  s.ms += ms;
  if (ms > s.slowest) {
    s.slowest = ms;
    s.slowestOp = op;
  }
  stats.set(rid, s);
  line({ kind: "db", rid, op, start: Math.round(now - ms), ms: Math.round(ms), status });
}

/** A fetch for the Supabase client that records every call against the current request id. */
export function timedFetch(getRid: () => Promise<string | undefined>, base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const start = performance.now();
    const res = await base(input, init);
    const ms = performance.now() - start;
    try {
      const rid = await getRid();
      if (rid) recordCall(rid, opName(input, init?.method ?? (input instanceof Request ? input.method : "GET")), ms, res.status);
    } catch {
      // timing must never break a request
    }
    return res;
  };
}

export function logProxy(rid: string, path: string, authMs: number) {
  line({ kind: "proxy", rid, path, auth_ms: Math.round(authMs) });
}

export function finishRequest(rid: string, path: string, t0: number, now = Date.now()) {
  const s = stats.get(rid);
  stats.delete(rid);
  line({
    kind: "page",
    rid,
    path,
    total_ms: now - t0,
    calls: s?.calls ?? 0,
    db_ms: Math.round(s?.ms ?? 0),
    slowest_ms: Math.round(s?.slowest ?? 0),
    slowest_op: s?.slowestOp ?? "",
  });
}
