#!/usr/bin/env node
// Summarise OPS_TIMING log lines per page: how often, how long, how many Supabase calls, and in how many sequential waves.
//   docker logs hardcode-ops-app 2>&1 | node scripts/timing-report.mjs
//   node scripts/timing-report.mjs < app.log     (--top 20 for more rows, --json for machine output, --rtt 160 to change the
//                                                 round trip used for the estimate, in ms)
// "waves" = calls that overlap in time count once (they ran in parallel); each further wave waited for the one before it.
// est_ms = (the proxy's sign-in check + waves) x round trip. It is what the page costs from the app host at that distance.
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const num = (flag, dflt) => Number(args[args.indexOf(flag) + 1]) || dflt;
const top = num("--top", 10);
const rtt = num("--rtt", 160);
const asJson = args.includes("--json");

const reqs = new Map(); // rid -> { path, total, calls: [{start, end}], auth }
const get = (rid) => reqs.get(rid) ?? reqs.set(rid, { path: "", total: 0, calls: [], auth: 0, slowest: "" }).get(rid);
for await (const text of createInterface({ input: process.stdin })) {
  const at = text.indexOf("{");
  if (at < 0) continue;
  let o;
  try {
    o = JSON.parse(text.slice(at));
  } catch {
    continue;
  }
  if (o.level !== "timing" || !o.rid) continue;
  const r = get(o.rid);
  if (o.kind === "db") r.calls.push({ start: o.start, end: o.start + o.ms });
  else if (o.kind === "proxy") r.auth = o.auth_ms;
  else if (o.kind === "page") {
    r.path = o.path;
    r.total = o.total_ms;
    r.slowest = o.slowest_op;
  }
}

function waves(calls) {
  const sorted = [...calls].sort((a, b) => a.start - b.start);
  let n = 0;
  let end = -Infinity;
  for (const c of sorted) {
    if (c.start >= end) {
      n += 1;
      end = c.end;
    } else {
      end = Math.max(end, c.end);
    }
  }
  return n;
}
const pct = (a, q) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

const byPath = new Map();
for (const r of reqs.values()) {
  if (!r.path) continue;
  const p = byPath.get(r.path) ?? { path: r.path, total: [], calls: [], waves: [], slowest: new Map() };
  p.total.push(r.total);
  p.calls.push(r.calls.length);
  p.waves.push(waves(r.calls));
  if (r.slowest) p.slowest.set(r.slowest, (p.slowest.get(r.slowest) ?? 0) + 1);
  byPath.set(r.path, p);
}

const rows = [...byPath.values()]
  .map((p) => {
    const w = pct(p.waves, 0.5);
    return {
      path: p.path,
      hits: p.total.length,
      calls: pct(p.calls, 0.5),
      waves: w,
      est_ms: (1 + w) * rtt,
      measured_p95_ms: pct(p.total, 0.95),
      slowest: [...p.slowest.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
    };
  })
  .sort((a, b) => b.est_ms - a.est_ms || b.calls - a.calls)
  .slice(0, top);

if (asJson) console.log(JSON.stringify(rows, null, 2));
else console.table(rows);
