// Pure helpers for the Gemini Live voice session. Nothing here touches the network or the browser, so it is shared by the
// server (which builds the setup message) and the client (which parses what Gemini sends back) and is unit tested.

import { pickVoice } from "@/lib/ai/voice-prefs";

export type LiveTool = { name: string; description: string; parameters?: Record<string, unknown> };

export const INPUT_RATE = 16_000;
export const OUTPUT_RATE = 24_000;
export const LIVE_SOCKET_PATH = "/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

/** Newest first. The first one a key can use wins. */
export const LIVE_MODEL_PREFERENCE = ["gemini-3.8-live", "gemini-3.1-flash-live-preview", "gemini-2.5-flash-native-audio-latest", "gemini-2.5-flash-native-audio-preview-12-2025", "gemini-2.5-flash-native-audio-preview-09-2025"];

export function pickLiveModel(ids: string[]): string | null {
  const liked = LIVE_MODEL_PREFERENCE.find((id) => ids.includes(id));
  if (liked) return liked;
  return ids.find((id) => /^gemini-.*(live|native-audio)/.test(id) && !/transcribe|translate|extended/.test(id)) ?? null;
}

/** The first message on the socket. Everything the session needs is fixed here, on the server's terms. */
export function buildSetup(input: { model: string; system: string; tools: LiveTool[]; resumeHandle?: string | null; voice?: string | null; activity?: Record<string, unknown> | null }) {
  return {
    setup: {
      model: `models/${input.model}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: pickVoice(input.voice) } } },
      },
      systemInstruction: { parts: [{ text: input.system }] },
      ...(input.activity ? { realtimeInputConfig: { automaticActivityDetection: input.activity } } : {}),
      tools: [{ functionDeclarations: input.tools }],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      sessionResumption: input.resumeHandle ? { handle: input.resumeHandle } : {},
      contextWindowCompression: { slidingWindow: {} },
    },
  };
}

// ---------------------------------------------------------------- audio

export function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToInt16(data: string): Int16Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length - (binary.length % 2));
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

export function int16ToFloat32(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! / (samples[i]! < 0 ? 0x8000 : 0x7fff);
  return out;
}

export const audioMessage = (data: string) => JSON.stringify({ realtimeInput: { audio: { data, mimeType: `audio/pcm;rate=${INPUT_RATE}` } } });

// ---------------------------------------------------------------- what Gemini sends

export type LiveCall = { id: string; name: string; args: Record<string, unknown> };

export type LiveEvent =
  | { type: "ready" }
  | { type: "audio"; pcm: Int16Array }
  | { type: "heard"; text: string }
  | { type: "said"; text: string }
  | { type: "turnComplete" }
  | { type: "interrupted" }
  | { type: "toolCall"; calls: LiveCall[] }
  | { type: "toolCancelled"; ids: string[] }
  | { type: "goAway" }
  | { type: "handle"; handle: string };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** One socket message, as the events it carries. Anything unknown is ignored so a new field never breaks a call. */
export function parseLiveMessage(raw: string): LiveEvent[] {
  let msg: Record<string, unknown>;
  try {
    msg = rec(JSON.parse(raw));
  } catch {
    return [];
  }
  const out: LiveEvent[] = [];
  if ("setupComplete" in msg) out.push({ type: "ready" });

  const content = rec(msg.serverContent);
  const parts = rec(content.modelTurn).parts;
  if (Array.isArray(parts)) {
    for (const p of parts) {
      const data = rec(rec(p).inlineData).data;
      if (typeof data === "string" && data) out.push({ type: "audio", pcm: base64ToInt16(data) });
    }
  }
  const heard = rec(content.inputTranscription).text;
  if (typeof heard === "string" && heard) out.push({ type: "heard", text: heard });
  const said = rec(content.outputTranscription).text;
  if (typeof said === "string" && said) out.push({ type: "said", text: said });
  if (content.interrupted === true) out.push({ type: "interrupted" });
  if (content.turnComplete === true) out.push({ type: "turnComplete" });

  const calls = rec(msg.toolCall).functionCalls;
  if (Array.isArray(calls)) {
    const list = calls.flatMap((c): LiveCall[] => {
      const r = rec(c);
      return typeof r.name === "string" && typeof r.id === "string" ? [{ id: r.id, name: r.name, args: rec(r.args) }] : [];
    });
    if (list.length > 0) out.push({ type: "toolCall", calls: list });
  }
  const cancelled = rec(msg.toolCallCancellation).ids;
  if (Array.isArray(cancelled)) out.push({ type: "toolCancelled", ids: cancelled.filter((i): i is string => typeof i === "string") });
  if ("goAway" in msg) out.push({ type: "goAway" });
  const update = rec(msg.sessionResumptionUpdate);
  if (update.resumable === true && typeof update.newHandle === "string") out.push({ type: "handle", handle: update.newHandle });
  return out;
}

export const toolResponseMessage = (responses: { id: string; name: string; response: Record<string, unknown> }[]) => JSON.stringify({ toolResponse: { functionResponses: responses } });

// ---------------------------------------------------------------- the transcript

export type Segment = { role: "user" | "model"; text: string };

/** Collects what was said, in order, so a spoken exchange can be saved as ordinary chat messages. */
export class TurnBuffer {
  private segments: Segment[] = [];
  /** Counts separate things the person said since the session began; a model reply or a tool call ends one. */
  utterances = 0;

  user(text: string) {
    const last = this.segments.at(-1);
    if (last?.role === "user") last.text += text;
    else {
      this.segments.push({ role: "user", text });
      this.utterances++;
    }
  }

  model(text: string) {
    const last = this.segments.at(-1);
    if (last?.role === "model") last.text += text;
    else this.segments.push({ role: "model", text });
  }

  /** Something other than speech (a tool call) happened: the next words from the person are a new utterance. */
  breakUtterance() {
    if (this.segments.at(-1)?.role === "user") this.segments.push({ role: "model", text: "" });
  }

  get hasModel() {
    return this.segments.some((s) => s.role === "model" && s.text.trim() !== "");
  }

  get isEmpty() {
    return this.segments.every((s) => s.text.trim() === "");
  }

  lastUser(): string {
    return [...this.segments].reverse().find((s) => s.role === "user")?.text.trim() ?? "";
  }

  take(): Segment[] {
    const out = this.segments.map((s) => ({ ...s, text: plainSpeech(s.text) })).filter((s) => s.text !== "");
    this.segments = [];
    return out;
  }

  get userText(): string {
    return this.segments.filter((s) => s.role === "user").map((s) => s.text).join(" ").trim();
  }

  get modelText(): string {
    return this.segments.filter((s) => s.role === "model").map((s) => s.text).join(" ").trim();
  }
}

/** A spoken transcript has no links; if the model said one anyway, keep the task title. */
export function plainSpeech(text: string): string {
  return text.replace(/\[\[task:[^|\]]*\|([^\]]*)\]\]/g, "$1").replace(/\s+/g, " ").trim();
}

const STRONG = new Set(["create", "confirm", "yes", "yeah", "yep", "yup", "ok", "okay", "sure", "ahead", "good"]);
const ALLOWED = new Set([...STRONG, "go", "do", "it", "looks", "please", "the", "task", "this", "that", "now", "and", "thanks", "thank", "you", "great", "perfect", "right", "all", "so", "then", "just"]);

/** Did the person just say a plain "create" or "yes"? Short, and nothing else asked for. */
export function isSpokenConfirm(text: string): boolean {
  const words = text.toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6 || !words.every((w) => ALLOWED.has(w))) return false;
  return words.some((w) => STRONG.has(w)) || words.join(" ").includes("do it");
}

/** The words for a connection that closed on us. */
export function closeMessage(code: number, reason: string): string {
  const r = reason.toLowerCase();
  if (/quota|exhaust|429|rate/.test(r)) return "Your Gemini key hit its voice limit. Wait a bit, or try again later.";
  if (/api key|permission|403|unauth|invalid|expired/.test(r)) return "Google would not start the voice session. Check your key in the assistant settings.";
  if (/not found|unsupported|not supported|404/.test(r)) return "That voice model is not available to your key.";
  return code === 1000 || code === 1005 ? "The voice session ended." : "The voice connection dropped.";
}
