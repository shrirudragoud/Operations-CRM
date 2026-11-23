import { describe, expect, it } from "vitest";
import { payloadFor, sendPushes, webPushSender } from "../scripts/send-push.mjs";

type Row = { id: number; subscription_id: number; endpoint: string; p256dh_key: string; auth_key: string; notification_id: number | null; kind: string; title: string; body: string; link: string | null; attempts: number };
const row = (over: Partial<Row>): Row => ({ id: 1, subscription_id: 1, endpoint: "https://push.example/1", p256dh_key: "k", auth_key: "a", notification_id: 10, kind: "assigned", title: "Assigned to you", body: "Ravi assigned you: Boards", link: "/tasks/1", attempts: 1, ...over });

function fake(rows: Row[]) {
  const finished: Record<string, unknown>[] = [];
  const client = {
    schema: () => ({
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "claim_pushes") return { data: rows, error: null };
        finished.push(args);
        return { data: 1, error: null };
      },
    }),
  };
  return { client, finished };
}

describe("payloadFor", () => {
  it("carries what the service worker shows", () => {
    expect(JSON.parse(payloadFor(row({})))).toEqual({ title: "Assigned to you", body: "Ravi assigned you: Boards", url: "/tasks/1", tag: "n-10", kind: "assigned" });
  });
  it("falls back to the home page and a per-row tag for test pushes", () => {
    expect(JSON.parse(payloadFor(row({ id: 7, notification_id: null, link: null, kind: "test" })))).toMatchObject({ url: "/", tag: "p-7" });
  });
});

describe("webPushSender", () => {
  const err = (statusCode: number, body = "") => Object.assign(new Error("x"), { statusCode, body });
  const lib = (result: () => unknown) => ({ sendNotification: async (...a: unknown[]) => (calls.push(a), result()) });
  const calls: unknown[][] = [];
  it("sends the subscription, payload and a one-hour lifetime", async () => {
    calls.length = 0;
    expect(await webPushSender(lib(() => ({})))(row({}))).toEqual({ ok: true });
    expect(calls[0]?.[0]).toEqual({ endpoint: "https://push.example/1", keys: { p256dh: "k", auth: "a" } });
    expect(calls[0]?.[2]).toMatchObject({ TTL: 3600, urgency: "normal" });
  });
  it("treats 404 and 410 as a device that is gone", async () => {
    for (const code of [404, 410]) {
      const send = webPushSender({ sendNotification: async () => { throw err(code); } });
      expect(await send(row({}))).toMatchObject({ ok: false, gone: true });
    }
  });
  it("retries other errors and network failures", async () => {
    for (const code of [400, 401, 413, 429, 500]) {
      const send = webPushSender({ sendNotification: async () => { throw err(code, "nope"); } });
      expect(await send(row({}))).toMatchObject({ ok: false, gone: false });
    }
    const down = webPushSender({ sendNotification: async () => { throw new Error("down"); } });
    expect(await down(row({}))).toMatchObject({ ok: false, gone: false, error: "network: down" });
  });
});

describe("sendPushes", () => {
  it("marks everything that was delivered as sent in one call", async () => {
    const f = fake([row({ id: 1 }), row({ id: 2 }), row({ id: 3 })]);
    const s = await sendPushes(f.client, { send: async () => ({ ok: true }) });
    expect(s).toEqual({ claimed: 3, sent: 3, gone: 0, failed: 0 });
    expect(f.finished).toEqual([expect.objectContaining({ p_ids: [1, 2, 3], p_ok: true })]);
  });
  it("removes gone devices and hands failures back, grouped by error", async () => {
    const f = fake([row({ id: 1 }), row({ id: 2 }), row({ id: 3 }), row({ id: 4 })]);
    const outcomes: Record<number, object> = { 1: { ok: true }, 2: { ok: false, gone: true }, 3: { ok: false, gone: false, error: "500 down" }, 4: { ok: false, gone: false, error: "500 down" } };
    const s = await sendPushes(f.client, { send: async (r: Row) => outcomes[r.id] });
    expect(s).toEqual({ claimed: 4, sent: 1, gone: 1, failed: 2 });
    expect(f.finished).toContainEqual(expect.objectContaining({ p_ids: [2], p_gone: true }));
    expect(f.finished).toContainEqual(expect.objectContaining({ p_ids: [3, 4], p_ok: false, p_error: "500 down", p_gone: false }));
  });
  it("does nothing when the queue is empty", async () => {
    const f = fake([]);
    expect(await sendPushes(f.client, { send: async () => ({ ok: true }) })).toEqual({ claimed: 0, sent: 0, gone: 0, failed: 0 });
    expect(f.finished).toEqual([]);
  });
  it("works through many devices ten at a time", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => row({ id: i + 1 }));
    let live = 0, peak = 0;
    const f = fake(rows);
    await sendPushes(f.client, { send: async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 2)); live--; return { ok: true }; } });
    expect(peak).toBe(10);
  });
});
