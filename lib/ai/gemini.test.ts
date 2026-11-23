import { afterEach, describe, expect, it, vi } from "vitest";
import { callsOf, generate, GeminiError, listModels, pickDefaultModel, scrub, textOf, usesThinkingLevel } from "./gemini";

const KEY = "AIzaSyFAKEFAKEFAKEFAKEFAKE12345";
const noSleep = async () => {};

function reply(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}
function ok(parts: unknown[], extra: Record<string, unknown> = {}) {
  return reply(200, { candidates: [{ content: { role: "model", parts }, finishReason: "STOP", ...extra }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7 } });
}
const base = { apiKey: KEY, model: "gemini-2.5-flash", system: "sys", contents: [{ role: "user" as const, parts: [{ text: "hi" }] }], sleep: noSleep };

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_BASE;
});

function stub(...responses: (Response | Error)[]) {
  const fn = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function kindOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(GeminiError);
    return (e as GeminiError).kind;
  }
  return "none";
}

describe("generate", () => {
  it("sends the key in a header, never in the URL, and returns the model turn", async () => {
    const fn = stub(ok([{ text: "hello" }]));
    const out = await generate({ ...base, tools: [{ name: "t", description: "d" }] });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.tools[0].functionDeclarations[0].name).toBe("t");
    expect(body.toolConfig.functionCallingConfig.mode).toBe("AUTO");
    expect(textOf(out.content)).toBe("hello");
    expect(out.usage).toEqual({ prompt: 5, output: 7 });
  });

  it("uses GEMINI_API_BASE when set", async () => {
    process.env.GEMINI_API_BASE = "http://127.0.0.1:9999/";
    const fn = stub(ok([{ text: "x" }]));
    await generate(base);
    expect((fn.mock.calls[0] as unknown as [string])[0]).toBe("http://127.0.0.1:9999/v1beta/models/gemini-2.5-flash:generateContent");
  });

  it("falls back to Google when GEMINI_API_BASE is set but empty (as docker compose passes it)", async () => {
    process.env.GEMINI_API_BASE = "";
    const fn = stub(ok([{ text: "x" }]));
    await generate(base);
    expect((fn.mock.calls[0] as unknown as [string])[0]).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
  });

  it("keeps thought signatures and tool calls verbatim, and hides thoughts from the text", async () => {
    stub(ok([{ text: "thinking", thought: true }, { functionCall: { name: "find_people", args: { query: "a" } }, thoughtSignature: "sig" }]));
    const out = await generate(base);
    expect(out.content.parts[1]?.thoughtSignature).toBe("sig");
    expect(textOf(out.content)).toBe("");
    expect(callsOf(out.content)).toEqual([{ name: "find_people", args: { query: "a" } }]);
    expect(callsOf({ role: "model", parts: [{ functionCall: { name: "x", args: {}, id: "call_1" } }] })).toEqual([{ name: "x", args: {}, id: "call_1" }]);
  });

  it("maps failures to friendly kinds", async () => {
    stub(reply(400, { error: { message: "API key not valid. Please pass a valid API key." } }));
    expect(await kindOf(generate(base))).toBe("bad_key");
    stub(reply(403, "{}"));
    expect(await kindOf(generate(base))).toBe("bad_key");
    stub(reply(404, "{}"));
    expect(await kindOf(generate(base))).toBe("model");
    stub(reply(429, { error: { message: "Quota exceeded for metric per day" } }));
    expect(await kindOf(generate(base))).toBe("quota");
    stub(reply(429, { error: { message: "You exceeded your current quota. Quota exceeded for metric generate_content_free_tier_requests, limit: 5, PerMinute" } }));
    expect(await kindOf(generate(base))).toBe("rate");
    stub(reply(429, { error: { message: "Resource has been exhausted" } }));
    expect(await kindOf(generate(base))).toBe("rate");
    stub(reply(400, { error: { message: "bad thing" } }));
    expect(await kindOf(generate(base))).toBe("bad_request");
  });

  it("does not retry a 429, but retries a 5xx twice", async () => {
    const limited = stub(reply(429, "{}"));
    await kindOf(generate(base));
    expect(limited).toHaveBeenCalledTimes(1);

    const down = stub(reply(503, "{}"), reply(500, "{}"), reply(502, "{}"));
    expect(await kindOf(generate(base))).toBe("unavailable");
    expect(down).toHaveBeenCalledTimes(3);

    const recovers = stub(reply(503, "{}"), ok([{ text: "back" }]));
    expect(textOf((await generate(base)).content)).toBe("back");
    expect(recovers).toHaveBeenCalledTimes(2);
  });

  it("maps blocked, malformed and empty answers", async () => {
    stub(reply(200, { promptFeedback: { blockReason: "SAFETY" } }));
    expect(await kindOf(generate(base))).toBe("blocked");
    stub(ok([{ text: "x" }], { finishReason: "SAFETY" }));
    expect(await kindOf(generate(base))).toBe("blocked");
    stub(ok([], { finishReason: "MALFORMED_FUNCTION_CALL" }));
    expect(await kindOf(generate(base))).toBe("malformed");
    stub(reply(200, { candidates: [{ content: { parts: [] }, finishReason: "STOP" }] }));
    expect(await kindOf(generate(base))).toBe("empty");
  });

  it("reports a timeout and rethrows a caller abort", async () => {
    stub(Object.assign(new Error("t"), { name: "TimeoutError" }));
    expect(await kindOf(generate({ ...base, timeoutMs: 0 }))).toBe("timeout");
    const ctl = new AbortController();
    ctl.abort();
    stub(new Error("aborted"));
    await expect(generate({ ...base, signal: ctl.signal })).rejects.toThrow("aborted");
  });

  it("never lets the key into an error message", async () => {
    stub(reply(400, { error: { message: `bad request for ${KEY} sorry` } }));
    try {
      await generate(base);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(KEY);
      expect((e as Error).message).toContain("[key]");
    }
    expect(scrub(`x ${KEY} y`)).toBe("x [key] y");
    expect(scrub("bad AQ.FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE0000 end")).toBe("bad [key] end");
  });
});

describe("listModels / pickDefaultModel", () => {
  const model = (name: string, methods = ["generateContent"]) => ({ name: `models/${name}`, displayName: name, supportedGenerationMethods: methods });

  it("keeps only usable chat models, follows pages and validates the key via the header", async () => {
    const fn = stub(
      reply(200, { models: [model("gemini-2.5-flash"), model("gemini-2.5-flash-preview-tts"), model("gemini-embedding-001", ["embedContent"]), model("gemma-3")], nextPageToken: "n" }),
      reply(200, { models: [model("gemini-2.5-pro"), model("gemini-2.0-flash-live-001"), model("gemini-2.5-flash-image")] }),
    );
    const list = await listModels(KEY, { sleep: noSleep });
    expect(list.map((m) => m.id)).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
  });

  it("rejects a bad key", async () => {
    stub(reply(400, { error: { message: "API key not valid" } }));
    expect(await kindOf(listModels("nope", { sleep: noSleep }))).toBe("bad_key");
  });

  it("prefers the proven models, in order, over a newer one", () => {
    const m = (id: string) => ({ id, label: id });
    expect(pickDefaultModel([m("gemini-3.8-flash"), m("gemini-2.5-flash"), m("gemini-3.5-flash-lite"), m("gemini-3.5-flash")])).toBe("gemini-3.5-flash");
    expect(pickDefaultModel([m("gemini-3.8-flash"), m("gemini-2.5-flash"), m("gemini-3.5-flash-lite")])).toBe("gemini-3.5-flash-lite");
    expect(pickDefaultModel([m("gemini-3.8-flash"), m("gemini-2.5-flash"), m("gemini-2.5-pro")])).toBe("gemini-2.5-flash");
  });

  it("sends a thinking level only to Gemini 3 and newer models", async () => {
    expect(usesThinkingLevel("gemini-3.5-flash")).toBe(true);
    expect(usesThinkingLevel("gemini-3-flash-preview")).toBe(true);
    expect(usesThinkingLevel("gemini-3.1-pro-preview")).toBe(true);
    expect(usesThinkingLevel("gemini-2.5-flash")).toBe(false);
    expect(usesThinkingLevel("gemini-flash-latest")).toBe(false);
    const fn = stub(ok([{ text: "x" }]), ok([{ text: "x" }]));
    await generate({ ...base, model: "gemini-3.5-flash" });
    await generate(base);
    const sent = (i: number) => JSON.parse(((fn.mock.calls[i] as unknown as [string, RequestInit])[1].body as string)).generationConfig;
    expect(sent(0).thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(sent(1).thinkingConfig).toBeUndefined();
  });

  it("falls back to the newest stable flash", () => {
    const m = (id: string) => ({ id, label: id });
    expect(pickDefaultModel([m("gemini-2.5-pro"), m("gemini-2.0-flash"), m("gemini-2.5-flash-lite"), m("gemini-3-flash-preview")])).toBe("gemini-2.0-flash");
    expect(pickDefaultModel([m("gemini-2.5-pro"), m("gemini-1.5-pro")])).toBe("gemini-2.5-pro");
    expect(pickDefaultModel([])).toBeNull();
  });
});
