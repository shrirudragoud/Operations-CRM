import { int16ToFloat32, OUTPUT_RATE } from "@/lib/ai/live";

// Browser audio for voice mode: the microphone in (through an AudioWorklet) and Gemini's voice out (a scheduled queue).
// One AudioContext does both, created inside the tap that starts the call so phones allow sound.

type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

export function voiceSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as AudioWindow;
  return window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof WebSocket !== "undefined" && !!(w.AudioContext ?? w.webkitAudioContext) && typeof AudioWorkletNode !== "undefined";
}

export function newAudioContext(): AudioContext {
  const w = window as AudioWindow;
  const Ctx = w.AudioContext ?? w.webkitAudioContext!;
  return new Ctx({ latencyHint: "interactive" });
}

export function micErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "The microphone is blocked. Allow it in your browser's site settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found on this device.";
  if (name === "NotReadableError" || name === "AbortError") return "The microphone is being used by another app. Close it and try again.";
  return "Could not open the microphone.";
}

export function requestMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
}

export class MicCapture {
  private constructor(
    private stream: MediaStream,
    private source: MediaStreamAudioSourceNode,
    private node: AudioWorkletNode,
    private sink: GainNode,
  ) {}

  static async start(ctx: AudioContext, stream: MediaStream, onChunk: (pcm: Int16Array) => void, onLevel: (rms: number) => void): Promise<MicCapture> {
    await ctx.audioWorklet.addModule("/api/voice-worklet");
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
      onLevel(e.data.rms);
      onChunk(new Int16Array(e.data.pcm));
    };
    // Some browsers only run a node that reaches the speakers, so it goes through a gain of zero.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink).connect(ctx.destination);
    return new MicCapture(stream, source, node, sink);
  }

  setMuted(muted: boolean) {
    for (const t of this.stream.getAudioTracks()) t.enabled = !muted;
  }

  stop() {
    this.node.port.onmessage = null;
    this.source.disconnect();
    this.node.disconnect();
    this.sink.disconnect();
    for (const t of this.stream.getTracks()) t.stop();
  }
}

/** Plays Gemini's 24 kHz speech as it arrives, chunk after chunk with no gaps, and can cut it off at once when the person speaks. */
export class VoicePlayer {
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private gain: GainNode;
  private analyser: AnalyserNode;
  private wave: Uint8Array<ArrayBuffer>;

  constructor(
    private ctx: AudioContext,
    private onActive: (speaking: boolean) => void,
  ) {
    this.gain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.wave = new Uint8Array(this.analyser.fftSize);
    this.gain.connect(this.analyser).connect(ctx.destination);
  }

  /** 1 is the voice as Google sends it; the person's volume setting scales it. */
  setVolume(v: number) {
    this.gain.gain.value = v;
  }

  /** True while speech is queued and the speakers are actually running (a suspended context never finishes anything). */
  get speaking() {
    return this.sources.size > 0 && this.ctx.state === "running";
  }

  /** How loud the voice is right now, 0 to 1. */
  level(): number {
    this.analyser.getByteTimeDomainData(this.wave);
    let sum = 0;
    for (const v of this.wave) sum += ((v - 128) / 128) ** 2;
    return Math.sqrt(sum / this.wave.length);
  }

  /** A short two-note tone, so the person knows the call is live and the sound works. */
  chime() {
    const t = this.ctx.currentTime;
    [[0, 660], [0.13, 880]].forEach(([at, hz]) => {
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.frequency.value = hz!;
      env.gain.setValueAtTime(0.0001, t + at!);
      env.gain.exponentialRampToValueAtTime(0.12, t + at! + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, t + at! + 0.22);
      osc.connect(env).connect(this.gain);
      osc.start(t + at!);
      osc.stop(t + at! + 0.25);
    });
  }

  enqueue(pcm: Int16Array) {
    if (pcm.length === 0) return;
    const samples = int16ToFloat32(pcm);
    const buffer = this.ctx.createBuffer(1, samples.length, OUTPUT_RATE);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    const now = this.ctx.currentTime;
    const startAt = this.sources.size === 0 ? now + 0.06 : Math.max(this.next, now + 0.01);
    src.start(startAt);
    this.next = startAt + buffer.duration;
    const wasIdle = this.sources.size === 0;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (this.sources.size === 0) this.onActive(false);
    };
    if (wasIdle) this.onActive(true);
  }

  /** The person spoke over it: stop everything that is queued. */
  clear() {
    const had = this.sources.size > 0;
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.next = 0;
    if (had) this.onActive(false);
  }
}
