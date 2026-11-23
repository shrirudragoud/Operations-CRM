import { describe, expect, it } from "vitest";
import { buildSetup } from "./live";
import {
  activityDetection, DEFAULT_PREFS, normalisePrefs, pickVoice, VOICE_NAME, VOICES, voicePrefsSchema, voiceStylePrompt, type VoicePrefs,
} from "./voice-prefs";

const with_ = (p: Partial<VoicePrefs>): VoicePrefs => ({ ...DEFAULT_PREFS, ...p });

describe("voices", () => {
  const voiceOf = (voice?: string | null) => buildSetup({ model: "m", system: "s", tools: [], voice }).setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName;

  it("defaults to a female voice and uses the one asked for", () => {
    expect(VOICES.find((v) => v.id === VOICE_NAME)?.gender).toBe("female");
    expect(voiceOf()).toBe(VOICE_NAME);
    expect(voiceOf("Charon")).toBe("Charon");
  });

  it("never sends a name that is not on the list", () => {
    expect(pickVoice("Nobody")).toBe(VOICE_NAME);
    expect(pickVoice(null)).toBe(VOICE_NAME);
    expect(voiceOf("Nobody")).toBe(VOICE_NAME);
    expect(new Set(VOICES.map((v) => v.id)).size).toBe(VOICES.length);
  });
});

describe("normalisePrefs", () => {
  it("gives the defaults for nothing, junk or a stale value", () => {
    expect(normalisePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalisePrefs("x")).toEqual(DEFAULT_PREFS);
    expect(normalisePrefs({ voice: "Gone", pace: "fast", volume: 99, noisyRoom: "yes" })).toEqual({ ...DEFAULT_PREFS, pace: "fast" });
  });

  it("keeps good values and drops only the bad ones", () => {
    const p = normalisePrefs({ voice: "Aoede", style: "calm", language: "hi", volume: 1.2, patience: "nope" });
    expect(p).toEqual({ ...DEFAULT_PREFS, voice: "Aoede", style: "calm", language: "hi", volume: 1.2 });
    expect(voicePrefsSchema.safeParse(p).success).toBe(true);
  });

  it("is rejected by the server schema when anything is off", () => {
    expect(voicePrefsSchema.safeParse({ ...DEFAULT_PREFS, voice: "Nobody" }).success).toBe(false);
    expect(voicePrefsSchema.safeParse({ ...DEFAULT_PREFS, volume: 5 }).success).toBe(false);
  });
});

describe("voiceStylePrompt", () => {
  it("adds nothing at the defaults", () => {
    expect(voiceStylePrompt(DEFAULT_PREFS)).toBe("");
  });

  it("asks for the chosen tone, pace, length and language", () => {
    const t = voiceStylePrompt(with_({ style: "calm", pace: "slow", length: "brief", language: "hinglish" }));
    expect(t).toMatch(/calm/i);
    expect(t).toMatch(/slowly/i);
    expect(t).toMatch(/one short sentence/i);
    expect(t).toMatch(/Hinglish/);
  });
});

describe("activityDetection", () => {
  it("leaves Google's defaults alone unless something is chosen", () => {
    expect(activityDetection(DEFAULT_PREFS)).toBeNull();
    expect(buildSetup({ model: "m", system: "s", tools: [], activity: null }).setup).not.toHaveProperty("realtimeInputConfig");
  });

  it("maps patience and a noisy room onto the voice-detection settings", () => {
    expect(activityDetection(with_({ patience: "patient" }))).toEqual({ endOfSpeechSensitivity: "END_SENSITIVITY_LOW", silenceDurationMs: 1200 });
    expect(activityDetection(with_({ patience: "quick", noisyRoom: true }))).toEqual({
      startOfSpeechSensitivity: "START_SENSITIVITY_LOW", endOfSpeechSensitivity: "END_SENSITIVITY_HIGH", silenceDurationMs: 400,
    });
    const setup = buildSetup({ model: "m", system: "s", tools: [], activity: activityDetection(with_({ noisyRoom: true })) }).setup;
    expect(setup).toHaveProperty("realtimeInputConfig.automaticActivityDetection.startOfSpeechSensitivity", "START_SENSITIVITY_LOW");
  });
});
