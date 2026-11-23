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

// Mirrors ops.email_group(): which heading a notification sits under. Order here is the order of sections in a digest.
const TOPICS = [
  { id: "assigned", label: "Assigned to you" },
  { id: "mentions", label: "Mentions" },
  { id: "due", label: "Due and overdue", warn: true },
  { id: "meetings", label: "Meetings" },
  { id: "hr", label: "HR" },
  { id: "activity", label: "Task updates" },
  { id: "test", label: "Test" },
  { id: "other", label: "Updates" },
];
export function topicOf(kind) {
  const k = String(kind ?? "");
  if (k === "assigned" || k === "recurring") return "assigned";
  if (k === "mentioned") return "mentions";
  if (k === "due_today" || k === "overdue") return "due";
  if (k === "status" || k === "dates" || k === "comment") return "activity";
  if (k.startsWith("meeting_")) return "meetings";
  if (k.startsWith("request_") || k === "hr_file") return "hr";
  if (k === "test") return "test";
  return "other";
}
const LABELS = { due_today: "Due today", overdue: "Overdue" };
const labelOf = (r) => LABELS[r.kind] ?? TOPICS.find((t) => t.id === topicOf(r.kind)).label;

/** The button text follows where the link leads. */
export function buttonLabel(link) {
  const l = String(link ?? "");
  if (l.startsWith("/tasks/")) return "Open task";
  if (l.startsWith("/calendar/")) return "Open meeting";
  if (l.includes("/requests")) return "Open request";
  if (l.startsWith("/me/documents")) return "Open documents";
  if (l.startsWith("/account")) return "Open account";
  return "Open Hard-Code Ops";
}

const INK = "#18181b";
const MUTED = "#71717a";
const LINE = "#e4e4e7";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const pill = (text, warn) =>
  `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;letter-spacing:.02em;` +
  `background:${warn ? "#fef2f2" : "#f4f4f5"};color:${warn ? "#b91c1c" : "#3f3f46"}">${esc(text)}</span>`;
const button = (href, text) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px"><tr>` +
  `<td bgcolor="${INK}" style="border-radius:8px"><a href="${esc(href)}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${esc(text)}</a></td>` +
  `</tr></table>`;

const IST = "Asia/Kolkata";
const fmt = (d, o, tz = IST) => new Intl.DateTimeFormat("en-IN", { timeZone: tz, ...o }).format(d).replace(/\s/g, " ").replace(/, (\d{4})$/, " $1");
const DAY = { weekday: "short", day: "numeric", month: "short", year: "numeric" };
const TIME = { hour: "numeric", minute: "2-digit", hour12: true };
const dayOf = (d) => fmt(d, DAY);
const timeOf = (d) => fmt(d, TIME).toLowerCase();
const PRIORITY = { 1: "Urgent", 2: "High", 3: "Normal", 4: "Low" };
const KIND_LABELS = { experience_letter: "Experience letter", address_proof: "Address proof", salary_certificate: "Salary certificate", detail_change: "Detail change", other: "Other" };
const STATE_LABELS = { open: "Open", in_progress: "In progress", done: "Done", rejected: "Rejected" };
const title = (s) => String(s).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s ?? ""));

/** "Wed, 25 Nov 2026, 2:30 pm to 3:30 pm IST" (the end carries its own date when the meeting crosses midnight). */
export function whenText(startsAt, endsAt) {
  if (!startsAt) return null;
  const s = new Date(startsAt);
  if (Number.isNaN(s.getTime())) return null;
  const e = endsAt ? new Date(endsAt) : null;
  if (!e || Number.isNaN(e.getTime())) return `${dayOf(s)}, ${timeOf(s)} IST`;
  return dayOf(s) === dayOf(e) ? `${dayOf(s)}, ${timeOf(s)} to ${timeOf(e)} IST` : `${dayOf(s)}, ${timeOf(s)} to ${dayOf(e)}, ${timeOf(e)} IST`;
}
function dueText(date, time) {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = fmt(d, DAY, "UTC");
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time ?? ""));
  if (!m) return day;
  const h = Number(m[1]);
  return `${day}, ${h % 12 || 12}:${m[2]} ${h < 12 ? "am" : "pm"}`;
}

/** The facts behind a notification (ops.email_details) as label/value rows, plus an optional excerpt. */
export function detailRows(d) {
  if (!d || typeof d !== "object") return { rows: [], note: null };
  const rows = [];
  const add = (label, value, href) => value != null && value !== "" && rows.push({ label, value: String(value), href });
  if (d.type === "task") {
    add("Due", dueText(d.due_date, d.due_time));
    add("Priority", PRIORITY[d.priority]);
    add("Assignee", d.assignee);
    add("Assigned by", d.assigned_by);
    add("Department", d.department && title(d.department));
    add("Status", d.status && title(d.status));
    return { rows, note: d.description || null };
  }
  if (d.type === "meeting") {
    add("When", whenText(d.starts_at, d.ends_at));
    add("Where", d.location, isUrl(d.location) ? d.location : undefined);
    add("Organizer", d.organizer);
    const names = Array.isArray(d.attendees) ? d.attendees : [];
    const hidden = Number(d.attendee_count ?? names.length) - names.length;
    if (names.length) add("With", names.join(", ") + (hidden > 0 ? ` and ${hidden} more` : ""));
    if (d.status === "cancelled") add("Reason", d.cancel_reason);
    return { rows, note: d.description || null };
  }
  if (d.type === "request") {
    add("Request", d.subject);
    add("Type", KIND_LABELS[d.kind] ?? d.kind);
    add("Status", STATE_LABELS[d.state] ?? d.state);
    add("From", d.from);
    return { rows, note: null };
  }
  return { rows, note: null };
}

/** One line under a digest item. */
export function sublineOf(d) {
  if (!d) return "";
  if (d.type === "task") return [dueText(d.due_date, d.due_time) && `Due ${dueText(d.due_date, d.due_time)}`, PRIORITY[d.priority] && d.priority < 3 ? PRIORITY[d.priority] : null].filter(Boolean).join(" · ");
  if (d.type === "meeting") return [whenText(d.starts_at, null), d.location].filter(Boolean).join(" · ");
  if (d.type === "request") return [d.subject, STATE_LABELS[d.state]].filter(Boolean).join(" · ");
  return "";
}

const icsEscape = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsStamp = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function icsFold(line) {
  const out = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > 74) { out.push(cur); cur = " "; bytes = 1; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

/** An "add to calendar" file for a meeting mail, or null. The same UID with a higher SEQUENCE updates or cancels it. */
export function meetingIcs(kind, d, url) {
  const cancel = kind === "meeting_cancel";
  if (!["meeting_invite", "meeting_update", "meeting_cancel"].includes(kind) || !d || d.type !== "meeting" || !d.meeting_id) return null;
  if (!d.starts_at || !d.ends_at) return null;
  const start = new Date(d.starts_at);
  const end = new Date(d.ends_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const changed = new Date(d.updated_at);
  const stamp = Number.isNaN(changed.getTime()) ? start : changed;
  const sequence = Math.max(0, Math.floor((stamp.getTime() - Date.UTC(2020, 0, 1)) / 60_000));
  const description = [d.description, cancel && d.cancel_reason ? `Cancelled: ${d.cancel_reason}` : null, url].filter(Boolean).join("\n\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hard-Code//Ops//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${cancel ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:meeting-${d.meeting_id}@hard-code.in`,
    `DTSTAMP:${icsStamp(stamp)}`,
    `SEQUENCE:${sequence}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(d.title ?? "Meeting")}`,
    ...(d.location ? [`LOCATION:${icsEscape(d.location)}`] : []),
    ...(description ? [`DESCRIPTION:${icsEscape(description)}`] : []),
    ...(url ? [`URL:${url}`] : []),
    ...(d.organizer_email ? [`ORGANIZER;CN=${icsEscape(d.organizer ?? d.organizer_email).replace(/[":]/g, "")}:mailto:${d.organizer_email}`] : []),
    `STATUS:${cancel ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return { filename: "meeting.ics", content: Buffer.from(lines.map(icsFold).join("\r\n") + "\r\n").toString("base64"), contentType: `text/calendar; charset=utf-8; method=${cancel ? "CANCEL" : "PUBLISH"}` };
}

const detailTable = (rows) =>
  rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;border-top:1px solid ${LINE}">` +
      rows
        .map(
          (r) =>
            `<tr><td valign="top" style="padding:8px 12px 8px 0;border-bottom:1px solid ${LINE};width:96px;font-size:13px;color:${MUTED}">${esc(r.label)}</td>` +
            `<td valign="top" style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px;line-height:1.45;color:${INK}">` +
            (r.href ? `<a href="${esc(r.href)}" style="color:${INK}">${esc(r.value)}</a>` : esc(r.value)) +
            `</td></tr>`,
        )
        .join("") +
      `</table>`
    : "";
const noteBlock = (note) =>
  note ? `<p style="margin:14px 0 0;padding-left:12px;border-left:3px solid ${LINE};font-size:14px;line-height:1.5;color:#52525b">${esc(note)}</p>` : "";

/** One person's claimed rows -> one message. */
export function compose(rows, appUrl) {
  const base = appUrl.replace(/\/+$/, "");
  const first = rows[0];
  const name = (first.full_name ?? "").split(" ")[0] || "there";
  const url = (r) => (r.link ? `${base}${r.link}` : base);
  const listed = rows.slice(0, MAX_LISTED);
  const more = rows.length - listed.length;
  const single = rows.length === 1;
  const subject = single ? first.subject : `${rows.length} updates in Hard-Code Ops`;
  const account = `${base}/account`;

  const detail = single ? detailRows(first.details) : { rows: [], note: null };
  const sections = TOPICS.map((t) => ({ ...t, items: listed.filter((r) => topicOf(r.kind) === t.id) })).filter((t) => t.items.length > 0);

  // Plain text
  const textBody = single
    ? [
        `[${labelOf(first)}]`,
        first.body,
        ...(detail.rows.length ? ["", ...detail.rows.map((r) => `${r.label}: ${r.value}`)] : []),
        ...(detail.note ? ["", detail.note] : []),
        "",
        `${buttonLabel(first.link)}: ${url(first)}`,
      ]
    : [
        `You have ${rows.length} updates.`,
        ...sections.flatMap((t) => ["", t.label.toUpperCase(), ...t.items.map((r) => `- ${r.body}\n${sublineOf(r.details) ? `  ${sublineOf(r.details)}\n` : ""}  ${url(r)}`)]),
        ...(more > 0 ? ["", `...and ${more} more. Open ${base} to see them.`] : []),
      ];
  const text = [`Hi ${name},`, "", ...textBody, "", "--", `Choose what you get by email: ${account}`].join("\n");

  // HTML
  const content = single
    ? `<p style="margin:0 0 10px">${pill(labelOf(first), topicOf(first.kind) === "due")}</p>` +
      `<p style="margin:0;font-size:18px;line-height:1.45;font-weight:600;color:${INK}">${esc(first.body)}</p>` +
      detailTable(detail.rows) +
      noteBlock(detail.note) +
      button(url(first), buttonLabel(first.link))
    : `<p style="margin:0 0 4px;font-size:15px;color:${INK}">You have <strong>${rows.length} updates</strong>.</p>` +
      sections
        .map(
          (t) =>
            `<p style="margin:22px 0 8px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${t.warn ? "#b91c1c" : MUTED}">${esc(t.label)}</p>` +
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
            t.items
              .map(
                (r) =>
                  `<tr><td style="padding:10px 0;border-top:1px solid ${LINE};font-size:15px;line-height:1.45">` +
                  `<a href="${esc(url(r))}" style="color:${INK};text-decoration:none">${esc(r.body)}</a>` +
                  `<span style="color:${MUTED}"> &rarr;</span>` +
                  (sublineOf(r.details) ? `<div style="margin-top:2px;font-size:13px;color:${MUTED}">${esc(sublineOf(r.details))}</div>` : "") +
                  `</td></tr>`,
              )
              .join("") +
            `</table>`,
        )
        .join("") +
      (more > 0 ? `<p style="margin:18px 0 0;font-size:14px;color:${MUTED}">...and ${more} more. <a href="${esc(base)}" style="color:${INK}">Open Hard-Code Ops</a> to see them.</p>` : "") +
      button(base, "Open Hard-Code Ops");

  const preheader = single ? first.body : `${rows.length} updates waiting for you`;
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f4f4f5;font-family:${FONT};color:${INK}">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f4f5"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:12px;overflow:hidden">` +
    `<tr><td bgcolor="${INK}" style="padding:16px 24px;font-size:15px;font-weight:700;letter-spacing:.01em;color:#ffffff">Hard-Code <span style="font-weight:400;color:#a1a1aa">Ops</span></td></tr>` +
    `<tr><td style="padding:24px 24px 8px;font-size:15px;line-height:1.5">` +
    `<p style="margin:0 0 16px;color:${INK}">Hi ${esc(name)},</p>${content}</td></tr>` +
    `<tr><td style="padding:20px 24px 24px;font-size:12px;line-height:1.5;color:${MUTED}">` +
    `<p style="margin:0;border-top:1px solid ${LINE};padding-top:16px">You get this because email notifications are on for your account. ` +
    `<a href="${esc(account)}" style="color:${MUTED};text-decoration:underline">Choose what you get by email</a> or turn it off.</p>` +
    `</td></tr></table>` +
    `<p style="margin:14px 0 0;font-size:12px;color:#a1a1aa">Hard-Code &middot; hard-code.in</p>` +
    `</td></tr></table></body></html>`;
  const ics = single ? meetingIcs(first.kind, first.details, url(first)) : null;
  return { subject, text, html, unsubscribe: account, attachments: ics ? [ics] : [] };
}

/** Delivery through Resend. Returns { ok, id } or { ok: false, error, permanent, fatal }. */
export function resendSender(apiKey, fetchImpl = fetch) {
  return async ({ from, to, subject, text, html, unsubscribe, idempotencyKey, attachments = [] }) => {
    let res;
    try {
      res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ from, to: [to], subject, text, html, headers: { "List-Unsubscribe": `<${unsubscribe}>` },
          ...(attachments.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, content_type: a.contentType })) } : {}) }),
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

  // The facts behind each message (due date, meeting time and place, ...). A mail still goes out without them.
  if (rows.length) {
    const { data: found, error: de } = await ops.rpc("email_details", { p_ids: rows.map((r) => r.id) });
    if (de) log({ event: "details-failed", error: de.message });
    else {
      const byId = new Map((Array.isArray(found) ? found : []).map((d) => [d.id, d.details]));
      for (const r of rows) r.details = byId.get(r.id) ?? null;
    }
  }

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
