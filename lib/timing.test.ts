import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishRequest, opName, recordCall, timedFetch } from "./timing";

let logged: Array<Record<string, unknown>>;

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "log").mockImplementation((s: string) => {
    logged.push(JSON.parse(s));
  });
});
afterEach(() => vi.restoreAllMocks());

describe("opName", () => {
  it("names the call without its query string", () => {
    expect(opName("https://x.supabase.co/rest/v1/task?select=*&title=eq.secret", "GET")).toBe("GET rest:task");
    expect(opName(new URL("https://x.supabase.co/rest/v1/rpc/me"), "POST")).toBe("POST rest:rpc/me");
    expect(opName("https://x.supabase.co/auth/v1/user")).toBe("GET auth:user");
  });
  it("copes with a relative address", () => {
    expect(opName("/rest/v1/task?a=1")).toBe("GET rest:task");
  });
});

describe("per-request summary", () => {
  it("adds up the calls of one request and clears them", () => {
    recordCall("r1", "GET rest:task", 40, 200, 1000);
    recordCall("r1", "POST rest:rpc/me", 90, 200, 1000);
    recordCall("r2", "GET rest:notification", 10, 200, 1000);
    finishRequest("r1", "/tasks", 900, 1500);
    const page = logged.find((l) => l.kind === "page");
    expect(page).toMatchObject({ rid: "r1", path: "/tasks", total_ms: 600, calls: 2, db_ms: 130, slowest_ms: 90, slowest_op: "POST rest:rpc/me" });
    finishRequest("r1", "/tasks", 900, 1500);
    expect(logged.filter((l) => l.kind === "page").at(-1)).toMatchObject({ calls: 0 });
  });

  it("forgets requests that never finished", () => {
    recordCall("old", "GET rest:task", 5, 200, 0);
    recordCall("new", "GET rest:task", 5, 200, 120_000);
    finishRequest("old", "/x", 0, 120_001);
    expect(logged.filter((l) => l.kind === "page").at(-1)).toMatchObject({ calls: 0 });
  });
});

describe("timedFetch", () => {
  it("records the call and returns the response untouched", async () => {
    const res = new Response("ok", { status: 201 });
    const f = timedFetch(async () => "rid9", async () => res);
    expect(await f("https://x.supabase.co/rest/v1/task", { method: "POST" })).toBe(res);
    expect(logged.find((l) => l.kind === "db")).toMatchObject({ rid: "rid9", op: "POST rest:task", status: 201 });
  });

  it("never breaks the request when the request id cannot be read", async () => {
    const res = new Response("ok");
    const f = timedFetch(async () => {
      throw new Error("outside a request");
    }, async () => res);
    expect(await f("https://x.supabase.co/rest/v1/task")).toBe(res);
  });

  it("stays quiet without a request id", async () => {
    const f = timedFetch(async () => undefined, async () => new Response("ok"));
    await f("https://x.supabase.co/rest/v1/task");
    expect(logged).toHaveLength(0);
  });
});
