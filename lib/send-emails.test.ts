import { describe, expect, it } from "vitest";
import { compose, resendSender, sendEmails } from "../scripts/send-emails.mjs";

type Row = { id: number; recipient_id: string; to_email: string; full_name: string; kind: string; subject: string; body: string; link: string | null; attempts: number };
const row = (over: Partial<Row>): Row => ({ id: 1, recipient_id: "a", to_email: "a@x.in", full_name: "Asha Rao", kind: "assigned", subject: "S", body: "B", link: "/tasks/1", attempts: 1, ...over });

function fake(rows: Row[]) {
  const finished: Record<string, unknown>[] = [];
  const client = {
    schema: () => ({
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "claim_emails") return { data: rows, error: null };
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
  it("does nothing when the queue is empty", async () => {
    const f = fake([]);
    expect(await sendEmails(f.client, { ...opts, send: async () => ({ ok: true, id: "x" }) })).toMatchObject({ claimed: 0, sent: 0 });
  });
});
