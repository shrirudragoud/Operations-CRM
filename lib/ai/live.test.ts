import { describe, expect, it } from "vitest";
import { base64ToInt16, buildSetup, closeMessage, int16ToBase64, int16ToFloat32, isSpokenConfirm, parseLiveMessage, pickLiveModel, plainSpeech, toolResponseMessage, TurnBuffer } from "./live";

describe("buildSetup", () => {
  it("fixes model, audio, tools and transcription on the server's terms", () => {
    const s = buildSetup({ model: "gemini-3.8-live", system: "Be brief.", tools: [{ name: "my_day", description: "d" }] }).setup;
    expect(s.model).toBe("models/gemini-3.8-live");
    expect(s.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(s.systemInstruction.parts[0]?.text).toBe("Be brief.");
    expect(s.tools[0]?.functionDeclarations[0]?.name).toBe("my_day");
    expect(s.inputAudioTranscription).toEqual({});
    expect(s.outputAudioTranscription).toEqual({});
    expect(s.sessionResumption).toEqual({});
  });

  it("passes a resume handle through", () => {
    expect(buildSetup({ model: "m", system: "s", tools: [], resumeHandle: "h1" }).setup.sessionResumption).toEqual({ handle: "h1" });
  });
});

describe("pickLiveModel", () => {
  it("prefers the newest known model and falls back to any live one", () => {
    expect(pickLiveModel(["gemini-2.5-flash-native-audio-latest", "gemini-3.1-flash-live-preview"])).toBe("gemini-3.1-flash-live-preview");
    expect(pickLiveModel(["gemini-9-live-x", "gemini-9-live-transcribe"])).toBe("gemini-9-live-x");
    expect(pickLiveModel(["gemini-2.5-flash"])).toBeNull();
    expect(pickLiveModel([])).toBeNull();
  });
});

describe("audio", () => {
  it("round-trips PCM through base64", () => {
    const pcm = Int16Array.from([0, 1, -1, 32767, -32768, 1234]);
    expect([...base64ToInt16(int16ToBase64(pcm))]).toEqual([...pcm]);
  });

  it("handles a large buffer without overflowing the call stack", () => {
    const pcm = new Int16Array(100_000).fill(7);
    expect(base64ToInt16(int16ToBase64(pcm)).length).toBe(100_000);
  });

  it("scales samples into -1..1", () => {
    const f = int16ToFloat32(Int16Array.from([0, 32767, -32768]));
    expect(f[0]).toBe(0);
    expect(f[1]).toBeCloseTo(1);
    expect(f[2]).toBeCloseTo(-1);
  });
});

describe("parseLiveMessage", () => {
  it("ignores junk and unknown fields", () => {
    expect(parseLiveMessage("not json")).toEqual([]);
    expect(parseLiveMessage("[1]")).toEqual([]);
    expect(parseLiveMessage(JSON.stringify({ somethingNew: 1 }))).toEqual([]);
  });

  it("reads setup, audio, transcripts and turn markers", () => {
    const data = int16ToBase64(Int16Array.from([1, 2, 3]));
    const ev = parseLiveMessage(
      JSON.stringify({
        setupComplete: {},
        serverContent: { modelTurn: { parts: [{ inlineData: { data, mimeType: "audio/pcm;rate=24000" } }] }, inputTranscription: { text: "hi" }, outputTranscription: { text: "hello" }, interrupted: true, turnComplete: true },
      }),
    );
    expect(ev.map((e) => e.type)).toEqual(["ready", "audio", "heard", "said", "interrupted", "turnComplete"]);
    const audio = ev.find((e) => e.type === "audio");
    expect(audio && audio.type === "audio" ? [...audio.pcm] : []).toEqual([1, 2, 3]);
  });

  it("reads tool calls, cancellations, goAway and resumption handles", () => {
    const ev = parseLiveMessage(
      JSON.stringify({
        toolCall: { functionCalls: [{ id: "a", name: "my_day", args: { x: 1 } }, { name: "no_id" }] },
        toolCallCancellation: { ids: ["a", 5] },
        goAway: { timeLeft: "5s" },
        sessionResumptionUpdate: { newHandle: "H", resumable: true },
      }),
    );
    expect(ev).toEqual([{ type: "toolCall", calls: [{ id: "a", name: "my_day", args: { x: 1 } }] }, { type: "toolCancelled", ids: ["a"] }, { type: "goAway" }, { type: "handle", handle: "H" }]);
    expect(parseLiveMessage(JSON.stringify({ sessionResumptionUpdate: { newHandle: "H", resumable: false } }))).toEqual([]);
  });

  it("builds a tool response the socket accepts", () => {
    expect(JSON.parse(toolResponseMessage([{ id: "a", name: "my_day", response: { ok: true } }]))).toEqual({ toolResponse: { functionResponses: [{ id: "a", name: "my_day", response: { ok: true } }] } });
  });
});

describe("TurnBuffer", () => {
  it("merges consecutive speech from one side and counts utterances", () => {
    const b = new TurnBuffer();
    b.user("what is ");
    b.user("my day");
    b.model("You have ");
    b.model("two tasks.");
    expect(b.utterances).toBe(1);
    expect(b.lastUser()).toBe("what is my day");
    expect(b.take()).toEqual([
      { role: "user", text: "what is my day" },
      { role: "model", text: "You have two tasks." },
    ]);
    expect(b.isEmpty).toBe(true);
  });

  it("starts a new utterance after a tool call", () => {
    const b = new TurnBuffer();
    b.user("add a task");
    b.breakUtterance();
    b.user("tomorrow");
    expect(b.utterances).toBe(2);
    expect(b.lastUser()).toBe("tomorrow");
    expect(b.hasModel).toBe(false);
    expect(b.take().map((s) => s.text)).toEqual(["add a task", "tomorrow"]);
  });

  it("strips task links from what is saved", () => {
    const b = new TurnBuffer();
    b.model("Open [[task:abc|Send the quote]] now");
    expect(b.take()[0]?.text).toBe("Open Send the quote now");
    expect(plainSpeech("a   b")).toBe("a b");
  });
});

describe("isSpokenConfirm", () => {
  it("accepts a plain yes", () => {
    for (const t of ["create", "Yes please", "do it", "go ahead", "Yeah, create the task.", "okay"]) expect(isSpokenConfirm(t)).toBe(true);
  });

  it("rejects anything that asks for something else", () => {
    for (const t of ["", "no", "yes but change the date", "create it for Ravi tomorrow", "please", "go", "yes yes yes yes yes yes yes"]) expect(isSpokenConfirm(t)).toBe(false);
  });
});

describe("closeMessage", () => {
  it("explains the common closes in plain words", () => {
    expect(closeMessage(1011, "Quota exceeded")).toMatch(/limit/);
    expect(closeMessage(1008, "API key not valid")).toMatch(/key/);
    expect(closeMessage(1008, "model not found")).toMatch(/not available/);
    expect(closeMessage(1000, "")).toBe("The voice session ended.");
    expect(closeMessage(1006, "")).toBe("The voice connection dropped.");
  });
});
