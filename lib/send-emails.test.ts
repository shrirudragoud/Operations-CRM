import { describe, expect, it } from "vitest";
import { buttonLabel, compose, detailRows, meetingIcs, resendSender, sendEmails, sublineOf, topicOf, whenText } from "../scripts/send-emails.mjs";

type Row = { id: number; recipient_id: string; to_email: string; full_name: string; kind: string; subject: string; body: string; link: string | null; attempts: number; lane: string; details?: unknown };
const row = (over: Partial<Row>): Row => ({ id: 1, recipient_id: "a", to_email: "a@x.in", full_name: "Asha Rao", kind: "assigned", subject: "S", body: "B", link: "/tasks/1", attempts: 1, lane: "notice", ...over });

function fake(rows: Row[]) {
  const finished: Record<string, unknown>[] = [];
  const client = {
    schema: () => ({
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "claim_emails") return { data: rows, error: null };
        if (name === "email_details") return { data: [], error: null };
        finished.push(args);
        return { data: 1, error: null };
      },
    }),
  };
  return { client, finished };
}

describe("compose", () => {
  it("uses the message as the subject for one item and links to it", () => {
    const m = compose([row({ subject: "Ravi assigned you: Boards", body: "Ravi assigned you: Boards" })], "https://ops.hard-code.in/");
    expect(m.subject).toBe("Ravi assigned you: Boards");
    expect(m.text).toContain("Hi Asha,");
    expect(m.text).toContain("https://ops.hard-code.in/tasks/1");
    expect(m.text).toContain("https://ops.hard-code.in/account");
  });
  it("folds several items into one message and caps the list", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row({ id: i, body: `Item ${i}` }));
    const m = compose(rows, "https://x.in");
    expect(m.subject).toBe("20 updates in Hard-Code Ops");
    expect(m.text).toContain("and 5 more");
    expect(m.text).not.toContain("Item 19");
  });
  it("escapes what other people typed", () => {
    const m = compose([row({ body: '<script>alert("x")</script>' })], "https://x.in");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
  });
});

describe("email layout", () => {
  it("puts a button on a single notification, named for where it leads", () => {
    const m = compose([row({ body: "Test user gave you a task: Email test", link: "/tasks/9" })], "https://x.in");
    expect(m.html).toContain("Open task");
    expect(m.html).toContain('href="https://x.in/tasks/9"');
    expect(m.html).toContain("Assigned to you");
    expect(m.text).toContain("Open task: https://x.in/tasks/9");
  });
  it("groups a digest under headings in a fixed order", () => {
    const m = compose(
      [row({ id: 1, kind: "comment", body: "A comment" }), row({ id: 2, kind: "assigned", body: "A task" }), row({ id: 3, kind: "due_today", body: "Due one" })],
      "https://x.in",
    );
    const h = m.html;
    expect(h.indexOf("Assigned to you")).toBeLessThan(h.indexOf("Due and overdue"));
    expect(h.indexOf("Due and overdue")).toBeLessThan(h.indexOf("Task updates"));
    expect(m.text.indexOf("ASSIGNED TO YOU")).toBeLessThan(m.text.indexOf("TASK UPDATES"));
    expect(h).toContain("3 updates");
  });
  it("labels due and overdue reminders as such", () => {
    expect(compose([row({ kind: "due_today", body: "Due" })], "https://x.in").html).toContain("Due today");
    expect(compose([row({ kind: "overdue", body: "Late" })], "https://x.in").html).toContain("Overdue");
  });
  it("maps kinds like the database does", () => {
    expect(topicOf("recurring")).toBe("assigned");
    expect(topicOf("meeting_invite")).toBe("meetings");
    expect(topicOf("request_hr_reply")).toBe("hr");
    expect(topicOf("hr_file")).toBe("hr");
    expect(topicOf("test")).toBe("test");
    expect(topicOf("nonsense")).toBe("other");
  });
  it("names the button for each destination", () => {
    expect(buttonLabel("/calendar/1")).toBe("Open meeting");
    expect(buttonLabel("/hr/requests")).toBe("Open request");
    expect(buttonLabel("/me/requests")).toBe("Open request");
    expect(buttonLabel("/me/documents")).toBe("Open documents");
    expect(buttonLabel("/account")).toBe("Open account");
    expect(buttonLabel(null)).toBe("Open Hard-Code Ops");
  });
  it("has a hidden preview line and escapes the link", () => {
    const m = compose([row({ body: "Preview me", link: '/tasks/1"><x' })], "https://x.in");
    expect(m.html).toContain("Preview me</div>");
    expect(m.html).not.toContain('"><x');
  });
});

const meeting = {
  type: "meeting", meeting_id: "m-1", title: "Weekly sync", status: "scheduled", kind: "team",
  starts_at: "2026-11-25T09:00:00+00:00", ends_at: "2026-11-25T10:00:00+00:00", updated_at: "2026-11-23T10:00:00+00:00",
  location: "Room 4", description: "Agenda: boards", cancel_reason: null, organizer: "Ravi Kumar", organizer_email: "ravi@x.in",
  attendees: ["Asha Rao", "Ravi Kumar"], attendee_count: 5,
};
const task = { type: "task", title: "Order boards", status: "open", priority: 1, due_date: "2026-11-27", due_time: "17:00:00", department: "workshop", assignee: "Asha Rao", assigned_by: "Ravi Kumar", description: "Ten <b>boards</b>" };
const decode = (b64: string) => Buffer.from(b64, "base64").toString("utf8");

describe("details in the mail", () => {
  it("formats a meeting time in IST", () => {
    expect(whenText("2026-11-25T09:00:00Z", "2026-11-25T10:00:00Z")).toBe("Wed, 25 Nov 2026, 2:30 pm to 3:30 pm IST");
    expect(whenText("2026-11-25T17:30:00Z", "2026-11-25T19:30:00Z")).toContain("Wed, 25 Nov 2026, 11:00 pm to Thu, 26 Nov 2026, 1:00 am IST");
    expect(whenText("nonsense", null)).toBeNull();
  });
  it("lists a meeting's time, place, organizer and guests", () => {
    const { rows, note } = detailRows(meeting);
    expect(rows.map((r) => `${r.label}: ${r.value}`)).toEqual([
      "When: Wed, 25 Nov 2026, 2:30 pm to 3:30 pm IST", "Where: Room 4", "Organizer: Ravi Kumar", "With: Asha Rao, Ravi Kumar and 3 more",
    ]);
    expect(note).toBe("Agenda: boards");
  });
  it("links a meeting URL and shows why it was cancelled", () => {
    const r = detailRows({ ...meeting, location: "https://meet.example/abc", status: "cancelled", cancel_reason: "Clash with a school visit" }).rows;
    expect(r.find((x) => x.label === "Where")?.href).toBe("https://meet.example/abc");
    expect(r.find((x) => x.label === "Reason")?.value).toBe("Clash with a school visit");
    expect(detailRows(meeting).rows.find((x) => x.label === "Where")?.href).toBeUndefined();
  });
  it("lists a task's due date, priority, people and department", () => {
    expect(detailRows(task).rows.map((r) => `${r.label}: ${r.value}`)).toEqual([
      "Due: Fri, 27 Nov 2026, 5:00 pm", "Priority: Urgent", "Assignee: Asha Rao", "Assigned by: Ravi Kumar", "Department: Workshop", "Status: Open",
    ]);
    expect(detailRows({ ...task, due_date: null, priority: 3, assignee: null }).rows.map((r) => r.label)).toEqual(["Priority", "Assigned by", "Department", "Status"]);
  });
  it("lists an HR request", () => {
    expect(detailRows({ type: "request", kind: "salary_certificate", subject: "Need a letter", state: "in_progress", from: "Asha Rao" }).rows.map((r) => `${r.label}: ${r.value}`)).toEqual([
      "Request: Need a letter", "Type: Salary certificate", "Status: In progress", "From: Asha Rao",
    ]);
  });
  it("has nothing for a mail with no record behind it", () => {
    expect(detailRows(null)).toEqual({ rows: [], note: null });
    expect(detailRows({ type: "other" }).rows).toEqual([]);
    expect(sublineOf(null)).toBe("");
  });
  it("shows the details under a single task or meeting mail, escaped", () => {
    const m = compose([row({ kind: "meeting_invite", body: "Ravi invited you: Weekly sync", link: "/calendar/m-1", details: meeting })], "https://x.in");
    expect(m.text).toContain("When: Wed, 25 Nov 2026, 2:30 pm to 3:30 pm IST");
    expect(m.text).toContain("Where: Room 4");
    expect(m.html).toContain("Organizer");
    expect(m.html).toContain("Agenda: boards");
    const t = compose([row({ body: "Ravi gave you a task: Order boards", details: task })], "https://x.in");
    expect(t.html).toContain("Urgent");
    expect(t.html).toContain("Ten &lt;b&gt;boards&lt;/b&gt;");
    expect(t.html).not.toContain("<b>boards");
  });
  it("adds a short line under digest items", () => {
    const m = compose([row({ id: 1, kind: "meeting_invite", body: "Invited: Weekly sync", details: meeting }), row({ id: 2, body: "A task", details: task })], "https://x.in");
    expect(m.html).toContain("Wed, 25 Nov 2026, 2:30 pm IST · Room 4");
    expect(m.text).toContain("Due Fri, 27 Nov 2026, 5:00 pm · Urgent");
    expect(m.attachments).toEqual([]);
  });
  it("still composes when no details were found", () => {
    const m = compose([row({ body: "Plain message" })], "https://x.in");
    expect(m.text).toContain("Plain message");
    expect(m.attachments).toEqual([]);
  });
});

describe("calendar file", () => {
  it("attaches an event to a single meeting invite", () => {
    const m = compose([row({ kind: "meeting_invite", body: "Invited", link: "/calendar/m-1", details: meeting })], "https://x.in");
    expect(m.attachments).toHaveLength(1);
    const a = m.attachments[0]!;
    expect(a.filename).toBe("meeting.ics");
    expect(a.contentType).toContain("method=PUBLISH");
    const ics = decode(a.content);
    expect(ics).toContain("\r\nUID:meeting-m-1@hard-code.in\r\n");
    expect(ics).toContain("DTSTART:20261125T090000Z");
    expect(ics).toContain("DTEND:20261125T100000Z");
    expect(ics).toContain("SUMMARY:Weekly sync");
    expect(ics).toContain("LOCATION:Room 4");
    expect(ics).toContain("ORGANIZER;CN=Ravi Kumar:mailto:ravi@x.in");
    expect(ics).toContain("URL:https://x.in/calendar/m-1");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
  it("cancels the same event with a higher sequence when the meeting changes", () => {
    const a = decode(meetingIcs("meeting_update", meeting, "")!.content);
    const later = decode(meetingIcs("meeting_cancel", { ...meeting, status: "cancelled", cancel_reason: "Clash", updated_at: "2026-11-24T10:00:00+00:00" }, "")!.content);
    const seq = (s: string) => Number(/SEQUENCE:(\d+)/.exec(s)?.[1]);
    expect(seq(later)).toBeGreaterThan(seq(a));
    expect(later).toContain("METHOD:CANCEL");
    expect(later).toContain("STATUS:CANCELLED");
    expect(later).toContain("UID:meeting-m-1@hard-code.in");
    expect(later).toContain("Cancelled: Clash");
  });
  it("escapes text and folds long lines", () => {
    const ics = decode(meetingIcs("meeting_invite", { ...meeting, title: "Plan; budget, review", description: "x".repeat(200) }, "")!.content);
    expect(ics).toContain("SUMMARY:Plan\\; budget\\, review");
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });
  it("is not attached to reminders, other kinds or a meeting with no times", () => {
    expect(meetingIcs("meeting_reminder", meeting, "")).toBeNull();
    expect(meetingIcs("assigned", meeting, "")).toBeNull();
    expect(meetingIcs("meeting_invite", { ...meeting, starts_at: null }, "")).toBeNull();
    expect(meetingIcs("meeting_invite", null, "")).toBeNull();
  });
});

describe("resendSender", () => {
  const args = { from: "o@x.in", to: "a@x.in", subject: "s", text: "t", html: "h", unsubscribe: "https://x.in/account", idempotencyKey: "k" };
  const reply = (status: number, body: object) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("returns the provider id on success", async () => {
    expect(await resendSender("key", reply(200, { id: "re_1" }))(args)).toEqual({ ok: true, id: "re_1" });
  });
  it("treats a bad key as fatal and not permanent", async () => {
    expect(await resendSender("key", reply(401, { message: "bad key" }))(args)).toMatchObject({ ok: false, fatal: true, permanent: false });
  });
  it("treats a rejected address as permanent", async () => {
    expect(await resendSender("key", reply(422, { message: "invalid to" }))(args)).toMatchObject({ ok: false, permanent: true, fatal: false });
  });
  it("retries rate limits and server errors", async () => {
    expect(await resendSender("key", reply(429, {}))(args)).toMatchObject({ permanent: false, fatal: false });
    expect(await resendSender("key", reply(500, {}))(args)).toMatchObject({ permanent: false, fatal: false });
  });
  it("sends attachments in the provider's shape", async () => {
    let body: Record<string, unknown> = {};
    const spy = (async (_u: string, init: { body: string }) => ((body = JSON.parse(init.body)), new Response(JSON.stringify({ id: "re_2" }), { status: 200 }))) as unknown as typeof fetch;
    await resendSender("key", spy)({ ...args, attachments: [{ filename: "meeting.ics", content: "QUJD", contentType: "text/calendar" }] } as typeof args);
    expect(body.attachments).toEqual([{ filename: "meeting.ics", content: "QUJD", content_type: "text/calendar" }]);
    await resendSender("key", spy)(args);
    expect(body.attachments).toBeUndefined();
  });
  it("retries when the network fails", async () => {
    const boom = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    expect(await resendSender("key", boom)(args)).toMatchObject({ ok: false, permanent: false });
  });
});

describe("sendEmails", () => {
  const opts = { from: "o@x.in", appUrl: "https://x.in" };
  it("sends one mail per person and marks all of their rows", async () => {
    const f = fake([row({ id: 1 }), row({ id: 2 }), row({ id: 3, recipient_id: "b", to_email: "b@x.in" })]);
    const sent: string[] = [];
    const s = await sendEmails(f.client, { ...opts, send: async (m: { to: string }) => (sent.push(m.to), { ok: true, id: "re_9" }) });
    expect(sent).toEqual(["a@x.in", "b@x.in"]);
    expect(s).toMatchObject({ claimed: 3, people: 2, sent: 2, failed: 0 });
    expect(f.finished[0]).toMatchObject({ p_ids: [1, 2], p_ok: true, p_provider_id: "re_9" });
  });
  it("keeps direct mail apart from a person's notification digest", async () => {
    const f = fake([row({ id: 1, lane: "direct", subject: "Reply" }), row({ id: 2 }), row({ id: 3 })]);
    const subjects: string[] = [];
    const s = await sendEmails(f.client, { ...opts, send: async (m: { subject: string }) => (subjects.push(m.subject), { ok: true, id: "re_1" }) });
    expect(s).toMatchObject({ claimed: 3, people: 2, sent: 2 });
    expect(subjects[0]).toBe("Reply");
    expect(f.finished.map((x) => x.p_ids)).toEqual([[1], [2, 3]]);
  });
  it("asks the database for the reserve and the cap", async () => {
    const f = fake([]);
    const seen: Record<string, unknown>[] = [];
    f.client.schema = () => ({ rpc: async (_n: string, a: Record<string, unknown>) => (seen.push(a), { data: [], error: null }) });
    await sendEmails(f.client, { ...opts, dailyCap: 80, reserve: 25, send: async () => ({ ok: true, id: "x" }) });
    expect(seen[0]).toMatchObject({ p_daily_cap: 80, p_reserve: 25 });
  });
  it("prunes old queue rows only when asked, and a failed prune does not stop the run", async () => {
    const calls: string[] = [];
    const logs: { event: string }[] = [];
    const client = {
      schema: () => ({
        rpc: async (name: string) => {
          calls.push(name);
          return name === "prune_outboxes" ? { data: null, error: { message: "boom" } } : { data: [], error: null };
        },
      }),
    };
    const run = (prune: boolean) => sendEmails(client, { ...opts, prune, log: ((e: { event: string }) => void logs.push(e)) as () => void, send: async () => ({ ok: true, id: "x" }) });
    await run(false);
    expect(calls).toEqual(["claim_emails"]);
    calls.length = 0;
    await run(true);
    expect(calls).toEqual(["prune_outboxes", "claim_emails"]);
    expect(logs).toContainEqual({ event: "prune-failed", error: "boom" });
  });
  it("hands a failed person back to the database to retry", async () => {
    const f = fake([row({ id: 1 })]);
    const s = await sendEmails(f.client, { ...opts, send: async () => ({ ok: false, error: "500 down", permanent: false }) });
    expect(s.failed).toBe(1);
    expect(f.finished[0]).toMatchObject({ p_ok: false, p_error: "500 down", p_permanent: false });
  });
  it("stops after a fatal error and releases everyone left", async () => {
    const f = fake([row({ id: 1 }), row({ id: 2, recipient_id: "b", to_email: "b@x.in" }), row({ id: 3, recipient_id: "c", to_email: "c@x.in" })]);
    let calls = 0;
    const s = await sendEmails(f.client, { ...opts, send: async () => (calls++, { ok: false, error: "401 bad key", fatal: true }) });
    expect(calls).toBe(1);
    expect(s.stoppedEarly).toBe(true);
    expect(f.finished.map((x) => x.p_ids)).toEqual([[1], [2], [3]]);
    expect(f.finished.every((x) => x.p_release === true)).toBe(true);
  });
  it("fetches the details for what it claimed and mails them", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const client = {
      schema: () => ({
        rpc: async (name: string, a: Record<string, unknown>) => {
          calls.push({ name, args: a });
          if (name === "claim_emails") return { data: [row({ id: 7, kind: "meeting_invite", body: "Invited", link: "/calendar/m-1" })], error: null };
          if (name === "email_details") return { data: [{ id: 7, details: meeting }], error: null };
          return { data: 1, error: null };
        },
      }),
    };
    const sent: { text: string; attachments: unknown[] }[] = [];
    await sendEmails(client, { ...opts, send: async (m: { text: string; attachments: unknown[] }) => (sent.push(m), { ok: true, id: "re_1" }) });
    expect(calls.find((c) => c.name === "email_details")?.args).toEqual({ p_ids: [7] });
    expect(sent[0]?.text).toContain("Where: Room 4");
    expect(sent[0]?.attachments).toHaveLength(1);
  });
  it("sends without details when they cannot be fetched", async () => {
    const logs: { event: string }[] = [];
    const client = {
      schema: () => ({
        rpc: async (name: string) => {
          if (name === "claim_emails") return { data: [row({ id: 1, body: "Plain" })], error: null };
          if (name === "email_details") return { data: null, error: { message: "nope" } };
          return { data: 1, error: null };
        },
      }),
    };
    const s = await sendEmails(client, { ...opts, log: ((e: { event: string }) => void logs.push(e)) as () => void, send: async () => ({ ok: true, id: "x" }) });
    expect(s.sent).toBe(1);
    expect(logs).toContainEqual({ event: "details-failed", error: "nope" });
  });
  it("does nothing when the queue is empty", async () => {
    const f = fake([]);
    expect(await sendEmails(f.client, { ...opts, send: async () => ({ ok: true, id: "x" }) })).toMatchObject({ claimed: 0, sent: 0 });
  });
});
