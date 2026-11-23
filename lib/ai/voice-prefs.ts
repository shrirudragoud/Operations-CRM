// What a person can set about how the assistant sounds and listens. Pure: shared by the server (which checks the choices and
// turns them into the session setup and prompt) and the browser (which stores them and draws the settings panel).
import { z } from "zod";

/** Gemini's prebuilt voices. The API has no call that lists them, so the list lives here and the server checks against it. */
export const VOICES = [
  { id: "Kore", gender: "female", tone: "Firm" },
  { id: "Aoede", gender: "female", tone: "Breezy" },
  { id: "Leda", gender: "female", tone: "Youthful" },
  { id: "Zephyr", gender: "female", tone: "Bright" },
  { id: "Sulafat", gender: "female", tone: "Warm" },
  { id: "Vindemiatrix", gender: "female", tone: "Gentle" },
  { id: "Despina", gender: "female", tone: "Smooth" },
  { id: "Achernar", gender: "female", tone: "Soft" },
  { id: "Callirrhoe", gender: "female", tone: "Easy-going" },
  { id: "Autonoe", gender: "female", tone: "Bright" },
  { id: "Erinome", gender: "female", tone: "Clear" },
  { id: "Laomedeia", gender: "female", tone: "Upbeat" },
  { id: "Gacrux", gender: "female", tone: "Mature" },
  { id: "Pulcherrima", gender: "female", tone: "Forward" },
  { id: "Puck", gender: "male", tone: "Upbeat" },
  { id: "Charon", gender: "male", tone: "Informative" },
  { id: "Fenrir", gender: "male", tone: "Excitable" },
  { id: "Orus", gender: "male", tone: "Firm" },
  { id: "Enceladus", gender: "male", tone: "Breathy" },
  { id: "Iapetus", gender: "male", tone: "Clear" },
  { id: "Umbriel", gender: "male", tone: "Easy-going" },
  { id: "Algieba", gender: "male", tone: "Smooth" },
  { id: "Algenib", gender: "male", tone: "Gravelly" },
  { id: "Rasalgethi", gender: "male", tone: "Informative" },
  { id: "Alnilam", gender: "male", tone: "Firm" },
  { id: "Schedar", gender: "male", tone: "Even" },
  { id: "Achird", gender: "male", tone: "Friendly" },
  { id: "Zubenelgenubi", gender: "male", tone: "Casual" },
  { id: "Sadachbia", gender: "male", tone: "Lively" },
  { id: "Sadaltager", gender: "male", tone: "Knowledgeable" },
] as const;

export type VoiceId = (typeof VOICES)[number]["id"];
export const VOICE_NAME: VoiceId = "Kore";
export const VOICE_IDS = VOICES.map((v) => v.id) as [VoiceId, ...VoiceId[]];

/** A saved choice that is no longer on the list (or was never valid) falls back to the default. */
export function pickVoice(id: string | null | undefined): VoiceId {
  return VOICES.find((v) => v.id === id)?.id ?? VOICE_NAME;
}

// The voice API has no pitch or speed setting, so tone, pace, length and language are asked for in the prompt.
export const STYLES = [
  { id: "friendly", label: "Friendly", prompt: "Sound warm, friendly and relaxed, like a helpful colleague." },
  { id: "professional", label: "Professional", prompt: "Sound polished and businesslike: courteous, precise, no chit-chat." },
  { id: "calm", label: "Calm", prompt: "Sound calm and reassuring, unhurried and soft-spoken." },
  { id: "energetic", label: "Energetic", prompt: "Sound upbeat and energetic, with a lively, encouraging tone." },
] as const;

export const PACES = [
  { id: "slow", label: "Slower", prompt: "Speak slowly and clearly, with short pauses between sentences." },
  { id: "normal", label: "Normal", prompt: null },
  { id: "fast", label: "Faster", prompt: "Speak at a brisk pace and get to the point quickly." },
] as const;

export const LENGTHS = [
  { id: "brief", label: "Brief", prompt: "Keep every answer to one short sentence unless asked for more." },
  { id: "normal", label: "Normal", prompt: null },
  { id: "detailed", label: "Detailed", prompt: "Give fuller answers of up to five short spoken sentences when it helps, still without lists." },
] as const;

export const LANGUAGES = [
  { id: "auto", label: "Match what I speak", prompt: null },
  { id: "en", label: "English", prompt: "English" },
  { id: "hi", label: "Hindi", prompt: "Hindi" },
  { id: "hinglish", label: "Hinglish (Hindi and English mixed)", prompt: "Hinglish, a natural mix of Hindi and English the way people speak in India" },
  { id: "kn", label: "Kannada", prompt: "Kannada" },
  { id: "ta", label: "Tamil", prompt: "Tamil" },
  { id: "te", label: "Telugu", prompt: "Telugu" },
  { id: "mr", label: "Marathi", prompt: "Marathi" },
  { id: "bn", label: "Bengali", prompt: "Bengali" },
  { id: "ml", label: "Malayalam", prompt: "Malayalam" },
  { id: "gu", label: "Gujarati", prompt: "Gujarati" },
] as const;

/** How long the assistant waits in silence before it decides you have finished. */
export const PATIENCE = [
  { id: "quick", label: "Quick, replies at the first pause" },
  { id: "normal", label: "Normal" },
  { id: "patient", label: "Patient, lets me think" },
] as const;

const ids = <T extends readonly { id: string }[]>(list: T) => list.map((x) => x.id) as [T[number]["id"], ...T[number]["id"][]];

export const VOLUME_MIN = 0.4;
export const VOLUME_MAX = 1.6;

export const voicePrefsSchema = z.object({
  voice: z.enum(VOICE_IDS),
  style: z.enum(ids(STYLES)),
  pace: z.enum(ids(PACES)),
  length: z.enum(ids(LENGTHS)),
  language: z.enum(ids(LANGUAGES)),
  patience: z.enum(ids(PATIENCE)),
  noisyRoom: z.boolean(),
  volume: z.number().min(VOLUME_MIN).max(VOLUME_MAX),
});
export type VoicePrefs = z.infer<typeof voicePrefsSchema>;

export const DEFAULT_PREFS: VoicePrefs = {
  voice: VOICE_NAME, style: "friendly", pace: "normal", length: "normal", language: "auto", patience: "normal", noisyRoom: false, volume: 1,
};

/** Whatever was stored, made safe: each setting that is missing or no longer valid goes back to its default. */
export function normalisePrefs(raw: unknown): VoicePrefs {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...DEFAULT_PREFS };
  for (const key of Object.keys(DEFAULT_PREFS) as (keyof VoicePrefs)[]) {
    if (!(key in r)) continue;
    const one = voicePrefsSchema.shape[key].safeParse(r[key]);
    if (one.success) out[key] = one.data;
  }
  return out as VoicePrefs;
}

/** Extra instructions for the assistant. Empty when everything is at its default. */
export function voiceStylePrompt(p: VoicePrefs): string {
  const lines: string[] = [];
  const style = STYLES.find((x) => x.id === p.style);
  if (style && p.style !== "friendly") lines.push(style.prompt);
  const pace = PACES.find((x) => x.id === p.pace)?.prompt;
  if (pace) lines.push(pace);
  const length = LENGTHS.find((x) => x.id === p.length)?.prompt;
  if (length) lines.push(length);
  const lang = LANGUAGES.find((x) => x.id === p.language)?.prompt;
  if (lang) lines.push(`Always speak and reply in ${lang}, even if they speak another language, unless they ask you to switch. Keep names and task titles as written.`);
  return lines.length ? ["", "How this person likes you to sound (these override the style rules above, never the safety rules)", ...lines.map((l) => `- ${l}`)].join("\n") : "";
}

/** The Live API's own voice-detection settings, or null to leave Google's defaults alone. */
export function activityDetection(p: VoicePrefs): Record<string, unknown> | null {
  const d: Record<string, unknown> = {};
  if (p.noisyRoom) d.startOfSpeechSensitivity = "START_SENSITIVITY_LOW";
  if (p.patience === "quick") Object.assign(d, { endOfSpeechSensitivity: "END_SENSITIVITY_HIGH", silenceDurationMs: 400 });
  if (p.patience === "patient") Object.assign(d, { endOfSpeechSensitivity: "END_SENSITIVITY_LOW", silenceDurationMs: 1200 });
  return Object.keys(d).length ? d : null;
}
