// A small Gemini REST client. No SDK: one fetch per call, the key in the x-goog-api-key header (never the URL),
// every failure mapped to a GeminiError with a message that is safe to show a person. GEMINI_API_BASE lets tests
// point at a local stub.

export type Part = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
  [key: string]: unknown;
};
export type Content = { role: "user" | "model"; parts: Part[] };
export type FunctionDeclaration = { name: string; description: string; parameters?: Record<string, unknown> };

export type GeminiErrorKind =
  | "bad_key"
  | "quota"
  | "rate"
  | "blocked"
  | "model"
  | "unavailable"
  | "timeout"
  | "bad_request"
  | "empty"
  | "malformed";

const MESSAGES: Record<GeminiErrorKind, string> = {
  bad_key: "Google rejected your Gemini key. Check it in the assistant settings and add it again.",
  quota: "Your Gemini key has run out of quota. Check your Google AI Studio plan, or try again later.",
  rate: "Gemini is rate limiting your key. Wait a minute and try again.",
  blocked: "Gemini declined to answer that. Try rephrasing.",
  model: "That Gemini model is not available to your key. Choose another model in the assistant settings.",
  unavailable: "Gemini is not responding right now. Try again in a moment, or pick a different model in the assistant settings.",
  timeout: "Gemini took too long to answer. Try again.",
  bad_request: "Gemini could not process that request.",
  empty: "Gemini sent back an empty answer. Try again.",
  malformed: "Gemini produced a broken tool call. Try again.",
};

export class GeminiError extends Error {
  constructor(
    public kind: GeminiErrorKind,
    public status?: number,
    detail?: string,
  ) {
    super(detail ? `${MESSAGES[kind]} (${detail})` : MESSAGES[kind]);
  }
}

export function scrub(text: string): string {
  return text.replace(/(?:AIza|AQ\.)[0-9A-Za-z._-]{10,}/g, "[key]").replace(/\s+/g, " ").trim().slice(0, 200);
}

export const baseUrl = () => (process.env.GEMINI_API_BASE?.trim() || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");

export type Usage = { prompt: number; output: number };
export type Generated = { content: Content; finishReason: string; usage: Usage };

export type GenerateInput = {
  apiKey: string;
  model: string;
  system: string;
  contents: Content[];
  tools?: FunctionDeclaration[];
  signal?: AbortSignal;
  temperature?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const RETRIES = 2;

export async function call(url: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal, sleep = wait): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const timer = AbortSignal.timeout(timeoutMs);
    const signal = outer ? AbortSignal.any([outer, timer]) : timer;
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal });
    } catch (e) {
      if (outer?.aborted) throw e;
      if (timer.aborted || (e instanceof Error && e.name === "TimeoutError")) throw new GeminiError("timeout");
      const why = e instanceof Error ? `${e.name}: ${e.message}${e.cause ? ` (${String((e.cause as { code?: string }).code ?? e.cause)})` : ""}` : String(e);
      if (attempt < RETRIES) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      console.error(`[gemini] request failed before a response: ${scrub(why)}`);
      throw new GeminiError("unavailable");
    }
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new GeminiError("unavailable", res.status);
      }
    }
    const raw = await res.text().catch(() => "");
    let message = raw;
    try {
      message = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? raw;
    } catch {
      /* not JSON */
    }
    const detail = scrub(message);
    if (!(res.status >= 500 && attempt < RETRIES)) console.error(`[gemini] HTTP ${res.status}: ${detail}`);
    if (res.status >= 500 && attempt < RETRIES) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    throw mapStatus(res.status, detail);
  }
}

function mapStatus(status: number, detail: string): GeminiError {
  const lower = detail.toLowerCase();
  if (status === 401 || status === 403 || (status === 400 && /api key|api_key/.test(lower))) return new GeminiError("bad_key", status);
  if (status === 404) return new GeminiError("model", status);
  if (status === 429) return new GeminiError(/per ?day|daily|billing/.test(lower) ? "quota" : "rate", status);
  if (status >= 500) return new GeminiError("unavailable", status);
  return new GeminiError("bad_request", status, detail);
}

/** Gemini 3 and newer take a thinking level; at the default level gemini-3.5-flash can sit silent for over a minute. 2.x models use a budget instead and reject this field. */
export function usesThinkingLevel(model: string): boolean {
  return /^gemini-([3-9]|\d{2,})(\.\d+)?-/.test(model);
}

export async function generate(input: GenerateInput): Promise<Generated> {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: input.system }] },
    contents: input.contents,
    generationConfig: { temperature: input.temperature ?? 0.2, ...(usesThinkingLevel(input.model) ? { thinkingConfig: { thinkingLevel: "low" } } : {}) },
  };
  if (input.tools && input.tools.length > 0) {
    body.tools = [{ functionDeclarations: input.tools }];
    body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }
  const json = (await call(
    `${baseUrl()}/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
      body: JSON.stringify(body),
    },
    input.timeoutMs ?? 60_000,
    input.signal,
    input.sleep,
  )) as {
    candidates?: { content?: { role?: string; parts?: Part[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  if (json.promptFeedback?.blockReason) throw new GeminiError("blocked");
  const candidate = json.candidates?.[0];
  const finishReason = candidate?.finishReason ?? "STOP";
  if (finishReason === "SAFETY" || finishReason === "RECITATION" || finishReason === "PROHIBITED_CONTENT" || finishReason === "BLOCKLIST") {
    throw new GeminiError("blocked");
  }
  if (finishReason === "MALFORMED_FUNCTION_CALL") throw new GeminiError("malformed");
  const parts = candidate?.content?.parts ?? [];
  if (parts.length === 0) throw new GeminiError("empty");
  return {
    content: { role: "model", parts },
    finishReason,
    usage: { prompt: json.usageMetadata?.promptTokenCount ?? 0, output: json.usageMetadata?.candidatesTokenCount ?? 0 },
  };
}

/** The visible text of a model turn (thought parts and tool calls left out). */
export function textOf(content: Content): string {
  return content.parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();
}

export function callsOf(content: Content): { name: string; args: Record<string, unknown>; id?: string }[] {
  return content.parts.flatMap((p) => (p.functionCall ? [{ name: p.functionCall.name, args: p.functionCall.args ?? {}, ...(p.functionCall.id ? { id: p.functionCall.id } : {}) }] : []));
}

export type ModelInfo = { id: string; label: string };

const EXCLUDED = /(tts|image|live|embedding|audio|robotics|computer-use|aqa|vision|learnlm|native)/i;

export async function listModels(apiKey: string, opts: { sleep?: (ms: number) => Promise<void>; signal?: AbortSignal } = {}): Promise<ModelInfo[]> {
  const out: ModelInfo[] = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const url = `${baseUrl()}/v1beta/models?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const json = (await call(url, { headers: { "x-goog-api-key": apiKey } }, 20_000, opts.signal, opts.sleep)) as {
      models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[];
      nextPageToken?: string;
    };
    for (const m of json.models ?? []) {
      const id = (m.name ?? "").replace(/^models\//, "");
      if (!id.startsWith("gemini-") || EXCLUDED.test(id)) continue;
      if (!(m.supportedGenerationMethods ?? []).includes("generateContent")) continue;
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) continue;
      out.push({ id, label: m.displayName?.trim() || id });
    }
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return out;
}

const PREFERRED_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];

/** Prefer models seen answering tool calls reliably, in order; else the newest stable flash, then any flash, then anything. */
export function pickDefaultModel(models: ModelInfo[]): string | null {
  if (models.length === 0) return null;
  const liked = PREFERRED_MODELS.find((id) => models.some((m) => m.id === id));
  if (liked) return liked;
  const version = (id: string) => Number(/^gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);
  const rank = (id: string) => {
    const flash = /^gemini-[\d.]+-flash(-latest)?$/.test(id);
    const flashAny = id.includes("flash") && !id.includes("lite");
    return [flash ? 2 : flashAny ? 1 : 0, version(id), /preview|exp/.test(id) ? 0 : 1];
  };
  const sorted = [...models].sort((a, b) => {
    const ra = rank(a.id);
    const rb = rank(b.id);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return (rb[i] ?? 0) - (ra[i] ?? 0);
    return a.id.localeCompare(b.id);
  });
  return sorted[0]?.id ?? null;
}
