#!/usr/bin/env node
// Sends the browser-notification queue (ops.push_outbox). Run it every 10 seconds from a timer (deploy/send-push.timer).
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@hard-code.in \
//   node scripts/send-push.mjs
// The database says who is notified and what (ops.queue_notification_push); this only delivers, one push per device.
// A device the browser says is gone (404/410) is removed by the database. Other failures are retried by the database
// (ops.finish_pushes). Secrets are read from the environment only.
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

const CONCURRENCY = 10;
const TTL_SECONDS = 3600;

/** The JSON the service worker shows. */
export function payloadFor(row) {
  return JSON.stringify({
    title: row.title,
    body: row.body,
    url: row.link ?? "/",
    tag: row.notification_id ? `n-${row.notification_id}` : `p-${row.id}`,
    kind: row.kind,
  });
}

/** Delivery through the web-push library. Returns { ok } or { ok: false, error, gone }. */
export function webPushSender(webpush) {
  return async (row) => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh_key, auth: row.auth_key } },
        payloadFor(row),
        { TTL: TTL_SECONDS, urgency: row.kind === "test" ? "high" : "normal", timeout: 15_000 },
      );
      return { ok: true };
    } catch (e) {
      const code = e?.statusCode;
      if (code === 404 || code === 410) return { ok: false, gone: true, error: `${code} subscription gone` };
      return { ok: false, gone: false, error: code ? `${code} ${String(e.body ?? e.message ?? "error").slice(0, 200)}` : `network: ${e?.message ?? "error"}` };
    }
  };
}

/** @param client a supabase-js client created with the secret key */
export async function sendPushes(client, { send, limit = 100, log = () => {} }) {
  const ops = client.schema("ops");
  const summary = { claimed: 0, sent: 0, gone: 0, failed: 0 };

  const { data, error } = await ops.rpc("claim_pushes", { p_limit: limit });
  if (error) throw new Error(`claim_pushes: ${error.message}`);
  const rows = data ?? [];
  summary.claimed = rows.length;
  if (rows.length === 0) return summary;

  const results = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const slice = rows.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(slice.map(async (row) => ({ row, r: await send(row) })))));
  }

  const finish = async (ids, args) => {
    const { error: e } = await ops.rpc("finish_pushes", { p_ids: ids, p_ok: false, p_error: null, p_gone: false, p_release: false, ...args });
    if (e) log({ event: "finish-failed", error: e.message, ids });
  };

  const okIds = results.filter((x) => x.r.ok).map((x) => x.row.id);
  const goneIds = results.filter((x) => !x.r.ok && x.r.gone).map((x) => x.row.id);
  if (okIds.length) await finish(okIds, { p_ok: true });
  if (goneIds.length) await finish(goneIds, { p_gone: true, p_error: "device gone" });
  const byError = new Map();
  for (const x of results.filter((y) => !y.r.ok && !y.r.gone)) byError.set(x.r.error, [...(byError.get(x.r.error) ?? []), x.row.id]);
  for (const [error, ids] of byError) {
    await finish(ids, { p_error: error });
    log({ event: "push-failed", error, count: ids.length });
  }

  summary.sent = okIds.length;
  summary.gone = goneIds.length;
  summary.failed = results.length - okIds.length - goneIds.length;
  return summary;
}

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv } = process.env;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:notifications@hard-code.in";
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY");
  if (!pub || !priv) throw new Error("Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys)");
  const mod = await import("web-push");
  const webpush = mod.default ?? mod;
  webpush.setVapidDetails(subject, pub, priv);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const log = (o) => console.log(JSON.stringify({ at: new Date().toISOString(), ...o }));
  const summary = await sendPushes(client, { send: webPushSender(webpush), log });
  if (summary.claimed > 0) log({ event: "summary", ...summary });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(JSON.stringify({ at: new Date().toISOString(), event: "error", error: e.message }));
    process.exit(1);
  });
}
