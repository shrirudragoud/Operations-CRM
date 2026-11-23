import { connect } from "node:net";

export type ScanResult =
  | { status: "clean" }
  | { status: "infected"; signature: string }
  | { status: "error"; message: string };

export type ScanOptions = { host?: string; port?: number; timeoutMs?: number; chunkBytes?: number };

const DEFAULTS = { host: "clamav", port: 3310, timeoutMs: 60_000, chunkBytes: 64 * 1024 };

/** Streams bytes to a clamd daemon with the INSTREAM command and reports what it says. Never throws. */
export function scanStream(source: AsyncIterable<Uint8Array>, options: ScanOptions = {}): Promise<ScanResult> {
  const set = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
  const { host, port, timeoutMs, chunkBytes } = { ...DEFAULTS, ...set };
  return new Promise((resolve) => {
    let settled = false;
    let reply = "";
    const socket = connect({ host, port });
    const finish = (r: ScanResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ status: "error", message: "The virus scanner took too long" }), timeoutMs);

    socket.on("error", (e) => finish({ status: "error", message: `The virus scanner is not reachable (${e.message})` }));
    socket.on("close", () => {
      if (!settled) finish(parse(reply) ?? { status: "error", message: "The virus scanner closed the connection without an answer" });
    });
    socket.on("data", (d) => {
      reply += d.toString("utf8");
      if (reply.includes("\0") || reply.includes("\n")) finish(parse(reply) ?? { status: "error", message: "The virus scanner gave an answer that was not understood" });
    });

    const write = (buf: Uint8Array) =>
      new Promise<void>((done, fail) => {
        if (settled) return fail(new Error("closed"));
        socket.write(buf, (err) => (err ? fail(err) : done()));
      });

    socket.on("connect", async () => {
      try {
        await write(Buffer.from("zINSTREAM\0"));
        for await (const part of source) {
          for (let at = 0; at < part.length; at += chunkBytes) {
            const piece = part.subarray(at, at + chunkBytes);
            const head = Buffer.alloc(4);
            head.writeUInt32BE(piece.length);
            await write(Buffer.concat([head, piece]));
          }
        }
        await write(Buffer.alloc(4));
      } catch (e) {
        finish({ status: "error", message: `The file could not be sent to the virus scanner (${(e as Error).message})` });
      }
    });
  });
}

function parse(raw: string): ScanResult | null {
  const text = raw.replace(/\0/g, "").trim();
  if (!text) return null;
  if (/\bOK$/.test(text)) return { status: "clean" };
  const found = /^[^:]*:\s*(.+?)\s+FOUND$/.exec(text);
  if (found) return { status: "infected", signature: found[1]! };
  return { status: "error", message: text.replace(/^[^:]*:\s*/, "") };
}

/** Whether uploads must pass a scan. Unset means no scanner is wired up (local development, tests). */
export function scanRequired(env: Record<string, string | undefined> = process.env): boolean {
  return env.TASK_FILE_SCAN === "required";
}

export function scanOptionsFromEnv(env: Record<string, string | undefined> = process.env): ScanOptions {
  const port = Number(env.CLAMAV_PORT);
  return { host: env.CLAMAV_HOST || undefined, port: Number.isInteger(port) && port > 0 ? port : undefined };
}
