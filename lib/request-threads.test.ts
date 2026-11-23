import { describe, expect, it } from "vitest";
import { buildThreads } from "@/lib/request-threads";

const msg = (id: number, request_id: string, internal = false) => ({
  id, request_id, body: `m${id}`, internal, created_at: "2026-11-20T10:00:00Z", author: id === 2 ? null : { full_name: "HR" },
});
const file = (id: string, request_id: string, message_id: number | null) => ({ id, request_id, message_id, name: `${id}.pdf`, size_bytes: 10 });

describe("buildThreads", () => {
  it("puts each message under its request, in order", () => {
    const { threads } = buildThreads([msg(1, "a"), msg(2, "b"), msg(3, "a")], []);
    expect(threads.get("a")?.map((m) => m.id)).toEqual([1, 3]);
    expect(threads.get("b")?.[0]?.author).toBeNull();
  });
  it("hangs files on their message, and message-less files on the request", () => {
    const { threads, onRequest } = buildThreads([msg(1, "a"), msg(3, "a")], [file("f1", "a", 3), file("f2", "a", null), file("f3", "a", 3)]);
    expect(threads.get("a")?.[0]?.files).toEqual([]);
    expect(threads.get("a")?.[1]?.files.map((f) => f.id)).toEqual(["f1", "f3"]);
    expect(onRequest.get("a")?.map((f) => f.id)).toEqual(["f2"]);
  });
  it("copes with no data", () => {
    const { threads, onRequest } = buildThreads([], []);
    expect(threads.size + onRequest.size).toBe(0);
  });
});
