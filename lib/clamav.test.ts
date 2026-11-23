import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { scanOptionsFromEnv, scanRequired, scanStream } from "./clamav";

let server: Server | undefined;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

type Seen = { command: string; chunks: number[]; ended: boolean };

// A stand-in for clamd: reads zINSTREAM, the length-prefixed chunks and the zero terminator, then answers.
async function clamd(answer: (seen: Seen) => string | null): Promise<{ port: number; seen: Seen }> {
  const seen: Seen = { command: "", chunks: [], ended: false };
  server = createServer((sock) => {
    let buf = Buffer.alloc(0);
    let started = false;
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (!started) {
        const nul = buf.indexOf(0);
        if (nul < 0) return;
        seen.command = buf.subarray(0, nul).toString();
        buf = buf.subarray(nul + 1);
        started = true;
      }
      while (buf.length >= 4 && !seen.ended) {
        const n = buf.readUInt32BE(0);
        if (n === 0) {
          seen.ended = true;
          const reply = answer(seen);
          if (reply !== null) sock.end(reply);
          return;
        }
        if (buf.length < 4 + n) return;
        seen.chunks.push(n);
        buf = buf.subarray(4 + n);
      }
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return { port: (server.address() as { port: number }).port, seen };
}

async function* bytes(...sizes: number[]) {
  for (const n of sizes) yield new Uint8Array(n).fill(7);
}

describe("scanStream", () => {
  it("reports a clean file and sends the INSTREAM protocol", async () => {
    const { port, seen } = await clamd(() => "stream: OK\0");
    const r = await scanStream(bytes(10, 20), { host: "127.0.0.1", port });
    expect(r).toEqual({ status: "clean" });
    expect(seen.command).toBe("zINSTREAM");
    expect(seen.chunks).toEqual([10, 20]);
    expect(seen.ended).toBe(true);
  });

  it("reports the signature of an infected file", async () => {
    const { port } = await clamd(() => "stream: Eicar-Test-Signature FOUND\0");
    expect(await scanStream(bytes(5), { host: "127.0.0.1", port })).toEqual({ status: "infected", signature: "Eicar-Test-Signature" });
  });

  it("splits a large part into chunks of the configured size", async () => {
    const { port, seen } = await clamd(() => "stream: OK\0");
    await scanStream(bytes(250), { host: "127.0.0.1", port, chunkBytes: 100 });
    expect(seen.chunks).toEqual([100, 100, 50]);
  });

  it("scans an empty stream", async () => {
    const { port, seen } = await clamd(() => "stream: OK\0");
    expect(await scanStream(bytes(), { host: "127.0.0.1", port })).toEqual({ status: "clean" });
    expect(seen.chunks).toEqual([]);
  });

  it("reports a scanner error, such as a size limit, as an error and not as clean", async () => {
    const { port } = await clamd(() => "INSTREAM size limit exceeded. ERROR\0");
    const r = await scanStream(bytes(5), { host: "127.0.0.1", port });
    expect(r.status).toBe("error");
  });

  it("times out when the scanner never answers", async () => {
    const { port } = await clamd(() => null);
    const r = await scanStream(bytes(5), { host: "127.0.0.1", port, timeoutMs: 200 });
    expect(r).toMatchObject({ status: "error", message: expect.stringContaining("too long") });
  });

  it("reports an unreachable scanner", async () => {
    const { port } = await clamd(() => "stream: OK\0");
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    const r = await scanStream(bytes(5), { host: "127.0.0.1", port, timeoutMs: 2000 });
    expect(r).toMatchObject({ status: "error", message: expect.stringContaining("not reachable") });
  });

  it("reports an error when the source fails part-way", async () => {
    const { port } = await clamd(() => "stream: OK\0");
    async function* broken() {
      yield new Uint8Array(3);
      throw new Error("download dropped");
    }
    const r = await scanStream(broken(), { host: "127.0.0.1", port });
    expect(r).toMatchObject({ status: "error", message: expect.stringContaining("download dropped") });
  });
});

describe("scan settings", () => {
  it("falls back to the defaults for settings that are undefined", async () => {
    const r = await scanStream(bytes(1), { host: undefined, port: undefined, timeoutMs: 3000 });
    expect(r).toMatchObject({ status: "error", message: expect.stringMatching(/not reachable|too long/) });
  });
  it("is required only when asked for", () => {
    expect(scanRequired({})).toBe(false);
    expect(scanRequired({ TASK_FILE_SCAN: "required" })).toBe(true);
    expect(scanRequired({ TASK_FILE_SCAN: "off" })).toBe(false);
  });
  it("reads the host and port, ignoring a bad port", () => {
    expect(scanOptionsFromEnv({ CLAMAV_HOST: "scan", CLAMAV_PORT: "3311" })).toEqual({ host: "scan", port: 3311 });
    expect(scanOptionsFromEnv({ CLAMAV_PORT: "abc" })).toEqual({ host: undefined, port: undefined });
  });
});
