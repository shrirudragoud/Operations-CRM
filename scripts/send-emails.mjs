#!/usr/bin/env node
// Sends the email queue (ops.email_outbox). Run it every minute from a timer (deploy/send-emails.timer).
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... RESEND_API_KEY=... MAIL_FROM="Hard-Code Ops <notifications@hard-code.in>" \
//   APP_URL=https://ops.hard-code.in node scripts/send-emails.mjs [--daily-cap 90] [--reserve 30]
// Of the daily cap, --reserve mails are kept for "direct" mail (a person's own test mail, later customer replies); automatic
// notification mail stops that many short, and direct mail is always sent first (ops.claim_emails, migration 0046).
// The database says who is mailed and what (ops.queue_notification_email); this only delivers. One mail per person per run:
// several notifications that piled up together are folded into one message, which also keeps us inside the provider's
// free daily limit. Failures are retried by the database (ops.finish_emails). Secrets are read from the environment only.
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

const MAX_LISTED = 15;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One person's claimed rows -> one message. */
export function compose(rows, appUrl) {
  const base = appUrl.replace(/\/+$/, "");
  const first = rows[0];
  const name = (first.full_name ?? "").split(" ")[0] || "there";
  const url = (r) => (r.link ? `${base}${r.link}` : base);
  const listed = rows.slice(0, MAX_LISTED);
  const more = rows.length - listed.length;
  const subject = rows.length === 1 ? first.subject : `${rows.length} updates in Hard-Code Ops`;

  const textLines = listed.map((r) => (rows.length === 1 ? `${r.body}\n${url(r)}` : `- ${r.body}\n  ${url(r)}`));
  if (more > 0) textLines.push(`...and ${more} more. Open ${base} to see them.`);
  const text = [`Hi ${name},`, "", ...textLines, "", `Choose what you get by email: ${base}/account`].join("\n");

  const items = listed
    .map((r) => `<li style="margin:0 0 10px"><a href="${esc(url(r))}" style="color:#111;text-decoration:none">${esc(r.body)}</a></li>`)
    .join("");
  const html =
    `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">` +
    `<p>Hi ${esc(name)},</p><ul style="padding-left:18px">${items}</ul>` +
    (more > 0 ? `<p>...and ${more} more. <a href="${esc(base)}">Open Hard-Code Ops</a>.</p>` : "") +
    `<p style="color:#666;font-size:13px">Choose what you get by email in <a href="${esc(base)}/account" style="color:#666">your account</a>.</p></div>`;
  return { subject, text, html, unsubscribe: `${base}/account` };
}

/** Delivery through Resend. Returns { ok, id } or { ok: false, error, permanent, fatal }. */
export function resendSender(apiKey, fetchImpl = fetch) {
  return async ({ from, to, subject, text, html, unsubscribe, idempotencyKey }) => {
    let res;
    try {
      res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ from, to: [to], subject, text, html, headers: { "List-Unsubscribe": `<${unsubscribe}>` } }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      return { ok: false, error: `network: ${e.message}`, permanent: false, fatal: false };
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.id) return { ok: true, id: body.id };
    const error = `${res.status} ${body.message ?? body.name ?? "error"}`;
    // Bad key or sending domain not verified: nothing in this run can work, so stop and keep the rows for the next one.
    if (res.status === 401 || res.status === 403) return { ok: false, error, permanent: false, fatal: true };
    return { ok: false, error, permanent: res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408, fatal: false };
  };
}

/** @param client a supabase-js client created with the secret key */
export async function sendEmails(client, { send, from, appUrl, dailyCap = 90, reserve = 30, prune = false, log = () => {} }) {
  const ops = client.schema("ops");
  const summary = { claimed: 0, people: 0, sent: 0, failed: 0, stoppedEarly: false };

  if (prune) {
    const { data: pruned, error: pe } = await ops.rpc("prune_outboxes");
    if (pe) log({ event: "prune-failed", error: pe.message });
    else log({ event: "pruned", ...pruned });
  }

  const { data, error } = await ops.rpc("claim_emails", { p_limit: 50, p_daily_cap: dailyCap, p_reserve: reserve });
  if (error) throw new Error(`claim_emails: ${error.message}`);
  const rows = data ?? [];
  summary.claimed = rows.length;

  // One mail per person per lane: direct mail (claimed first) is never folded into a notification digest.
  const byPerson = new Map();
  for (const r of rows) {
    const key = `${r.lane ?? "notice"}:${r.recipient_id}`;
    byPerson.set(key, [...(byPerson.get(key) ?? []), r]);
  }
  summary.people = byPerson.size;

  const finish = async (ids, ok, extra = {}) => {
    const { error: e } = await ops.rpc("finish_emails", { p_ids: ids, p_ok: ok, p_error: extra.error ?? null, p_provider_id: extra.id ?? null, p_permanent: extra.permanent ?? false, p_release: extra.release ?? false });
    if (e) log({ event: "finish-failed", error: e.message, ids });
  };

  const queue = [...byPerson.values()];
  for (let i = 0; i < queue.length; i++) {
    const group = queue[i];
    const ids = group.map((r) => r.id);
    const msg = compose(group, appUrl);
    const r = await send({ from, to: group[0].to_email, ...msg, idempotencyKey: `outbox-${ids.join("-")}-${group[0].attempts}` });
    if (r.ok) {
      await finish(ids, true, { id: r.id });
      summary.sent += 1;
      log({ event: "sent", to: group[0].to_email, items: group.length, id: r.id });
    } else {
      await finish(ids, false, { error: r.error, permanent: r.permanent, release: r.fatal });
      summary.failed += 1;
      log({ event: "send-failed", to: group[0].to_email, error: r.error, permanent: r.permanent });
      if (r.fatal) {
        for (const rest of queue.slice(i + 1)) await finish(rest.map((x) => x.id), false, { error: r.error, release: true });
        summary.stoppedEarly = true;
        break;
      }
    }
  }
  return summary;
}

function flag(args, name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const n = Number(args[i + 1]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} needs a whole number`);
  return n;
}

async function main() {
  const args = process.argv.slice(2);
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  const appUrl = process.env.APP_URL;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY");
  if (!apiKey || !from || !appUrl) throw new Error("Set RESEND_API_KEY, MAIL_FROM and APP_URL");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const log = (o) => console.log(JSON.stringify({ at: new Date().toISOString(), ...o }));
  const summary = await sendEmails(client, {
    send: resendSender(apiKey),
    from,
    appUrl,
    dailyCap: flag(args, "--daily-cap", 90),
    reserve: flag(args, "--reserve", 30),
    prune: new Date().getMinutes() === 7,
    log,
  });
  if (summary.claimed > 0 || summary.failed > 0) log({ event: "summary", ...summary });
  if (summary.stoppedEarly) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(JSON.stringify({ at: new Date().toISOString(), event: "error", error: e.message }));
    process.exit(1);
  });
}
