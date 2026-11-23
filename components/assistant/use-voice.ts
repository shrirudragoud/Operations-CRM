"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MicCapture, micErrorMessage, newAudioContext, requestMic, VoicePlayer, voiceSupported } from "@/components/assistant/voice-audio";
import { confirmAiAction } from "@/lib/actions/assistant";
import { createVoiceChat, runVoiceTool, saveVoiceTurn, startVoiceSession, type VoiceStart } from "@/lib/actions/voice";
import { audioMessage, closeMessage, int16ToBase64, isSpokenConfirm, parseLiveMessage, toolResponseMessage, TurnBuffer, type LiveCall, type LiveEvent } from "@/lib/ai/live";
import { CONFIRM_DRAFTS_TOOL } from "@/lib/ai/prompt";
import { getVoicePrefs, useVoicePrefs } from "@/components/assistant/voice-prefs-store";
import type { VoicePrefs } from "@/lib/ai/voice-prefs";
import type { DraftCard } from "@/lib/ai/types";

export type VoiceState = "off" | "connecting" | "listening" | "thinking" | "speaking";

/** One thing said in the call, shown in the conversation as it is spoken. Cards the assistant drafted hang off its reply. */
export type VoiceTurn = { id: number; role: "user" | "model"; text: string; draftIds: string[] };

type Options = {
  taskId?: string | null;
  /** The chat that is open, if any. A call in a new chat makes one when the first thing is said or drafted. */
  chatId: string | null;
  onChat: (id: string) => void;
  /** The call is over and its messages are saved: show them, then call `done` in the same update so nothing shows twice. */
  onSaved: (id: string, done: () => void) => Promise<void> | void;
};

const MAX_DRAFTS = 12;
const IDLE_MS = 3 * 60_000;
const SETUP_MS = 12_000;
const RECONNECTS = 3;
const CONFIRM_WAIT_MS = 2500;
const THINK_AFTER_MS = 900;
// After it stops speaking the room still echoes for a moment; the microphone stays closed through that.
const QUIET_MS = 450;
const BARGE_KEY = "ops.voice.bargein";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const noopSubscribe = () => () => {};

export function useVoice(options: Options) {
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });

  const supported = useSyncExternalStore(noopSubscribe, voiceSupported, () => false);
  const [state, setStateRaw] = useState<VoiceState>("off");
  const [message, setMessage] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [soundBlocked, setSoundBlocked] = useState(false);
  // Talking over the assistant only works well on headphones; on speakers it hears itself and cuts itself off.
  const [bargeIn, setBargeIn] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(BARGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [drafts, setDrafts] = useState<DraftCard[]>([]);
  const level = useRef(0);
  const turnsRef = useRef<VoiceTurn[]>([]);
  const turnSeq = useRef(0);
  const bargeRef = useRef(bargeIn);

  // Everything the audio and socket callbacks need lives in refs, so they never see stale state.
  const stateRef = useRef<VoiceState>("off");
  const draftsRef = useRef<DraftCard[]>([]);
  const mutedRef = useRef(false);
  const run = useRef({
    session: 0,
    discard: false,
    quietUntil: 0,
    userOpen: false,
    pendingDrafts: [] as string[],
    ctx: null as AudioContext | null,
    mic: null as MicCapture | null,
    player: null as VoicePlayer | null,
    ws: null as WebSocket | null,
    ready: false,
    closing: false,
    reconnecting: false,
    reconnects: 0,
    model: null as string | null,
    prefs: null as VoicePrefs | null,
    handle: null as string | null,
    chat: null as Promise<string> | null,
    buffer: new TurnBuffer(),
    turnDrafts: [] as string[],
    draftsMade: 0,
    confirmFloor: 0,
    batch: [] as string[],
    toolsInFlight: 0,
    cancelled: new Set<string>(),
    saving: Promise.resolve(),
    saveWarned: false,
    lastActivity: 0,
    setupTimer: 0 as unknown as ReturnType<typeof setTimeout>,
    thinkTimer: 0 as unknown as ReturnType<typeof setTimeout>,
    idleTimer: 0 as unknown as ReturnType<typeof setInterval>,
    wake: null as { release(): Promise<void> } | null,
  });

  const setState = useCallback((s: VoiceState) => {
    stateRef.current = s;
    setStateRaw(s);
  }, []);

  const putDrafts = useCallback((next: DraftCard[]) => {
    draftsRef.current = next;
    setDrafts(next);
  }, []);

  const setDraft = useCallback(
    (d: DraftCard) => {
      if (draftsRef.current.some((x) => x.id === d.id)) putDrafts(draftsRef.current.map((x) => (x.id === d.id ? d : x)));
    },
    [putDrafts],
  );

  const putTurns = useCallback((next: VoiceTurn[]) => {
    turnsRef.current = next;
    setTurns(next);
  }, []);

  const speak = useCallback(
    (role: "user" | "model", text: string) => {
      const r = run.current;
      const list = turnsRef.current;
      const last = list.at(-1);
      if (last && last.role === role && (role === "model" || r.userOpen)) putTurns([...list.slice(0, -1), { ...last, text: last.text + text }]);
      else if (text.trim() !== "") putTurns([...list, { id: ++turnSeq.current, role, text: text.trimStart(), draftIds: role === "model" ? r.pendingDrafts.splice(0) : [] }]);
      r.userOpen = role === "user";
    },
    [putTurns],
  );

  const attachDraft = useCallback(
    (id: string) => {
      const list = turnsRef.current;
      const last = list.at(-1);
      if (last?.role === "model") putTurns([...list.slice(0, -1), { ...last, draftIds: [...last.draftIds, id] }]);
      else run.current.pendingDrafts.push(id);
    },
    [putTurns],
  );

  const touch = useCallback(() => {
    run.current.lastActivity = Date.now();
  }, []);

  const ensureChat = useCallback((): Promise<string> => {
    const r = run.current;
    r.chat ??= (async () => {
      if (opts.current.chatId) return opts.current.chatId;
      const res = await createVoiceChat();
      if (!res.ok) throw new Error(res.error);
      opts.current.onChat(res.data.id);
      return res.data.id;
    })();
    r.chat.catch(() => {
      r.chat = null;
    });
    return r.chat;
  }, []);

  /** Save what has been said since the last save as ordinary chat messages, one save at a time and in order. */
  const flush = useCallback(() => {
    const r = run.current;
    const messages = r.buffer.take();
    const draftIds = r.turnDrafts.splice(0);
    if (messages.length === 0 && draftIds.length === 0) return r.saving;
    if (messages.length === 0) messages.push({ role: "model", text: "I drafted this for you." });
    r.saving = r.saving.then(async () => {
      try {
        const id = await ensureChat();
        const res = await saveVoiceTurn({ conversation_id: id, messages, draft_ids: draftIds });
        if (!res.ok) throw new Error(res.error);
      } catch (e) {
        if (!r.saveWarned) {
          r.saveWarned = true;
          setMessage(e instanceof Error && e.message ? `Could not save this part of the conversation. ${e.message}` : "Could not save this part of the conversation.");
        }
      }
    });
    return r.saving;
  }, [ensureChat]);

  const releaseDevices = useCallback(() => {
    const r = run.current;
    clearTimeout(r.setupTimer);
    clearTimeout(r.thinkTimer);
    clearInterval(r.idleTimer);
    r.mic?.stop();
    r.player?.clear();
    void r.ctx?.close().catch(() => {});
    void r.wake?.release().catch(() => {});
    r.mic = r.player = r.ctx = r.wake = null;
    level.current = 0;
  }, []);

  const stop = useCallback(
    (reason?: string) => {
      const r = run.current;
      if (stateRef.current === "off" && !r.ctx) return;
      r.closing = true;
      const ws = r.ws;
      r.ws = null;
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000);
      releaseDevices();
      r.ready = false;
      void flush();
      const session = r.session;
      const chat = r.chat;
      if (chat) {
        r.saving = r.saving.then(async () => {
          try {
            await opts.current.onSaved(await chat, () => {
              if (r.session === session && !r.saveWarned) putTurns([]);
            });
          } catch {
            /* the saved messages show up next time the chat is opened */
          }
        });
      }
      setState("off");
      setSoundBlocked(false);
      setMuted(false);
      mutedRef.current = false;
      if (reason) setMessage(reason);
    },
    [flush, putTurns, releaseDevices, setState],
  );

  // ---------------------------------------------------------------- tools

  const waitForSpokenConfirm = useCallback(async () => {
    const r = run.current;
    const deadline = Date.now() + CONFIRM_WAIT_MS;
    for (;;) {
      if (r.buffer.utterances > r.confirmFloor && isSpokenConfirm(r.buffer.lastUser())) return true;
      if (Date.now() >= deadline) return false;
      await wait(150);
    }
  }, []);

  const confirmByVoice = useCallback(async (): Promise<Record<string, unknown>> => {
    // Only what was drafted most recently: older cards the person left alone stay as they are until they tap them.
    const waiting = draftsRef.current.filter((d) => run.current.batch.includes(d.id) && ((d.status === "pending" && !d.expired) || d.status === "failed"));
    if (waiting.length === 0) return { error: "There is nothing waiting to be confirmed." };
    if (!(await waitForSpokenConfirm())) {
      return { error: "The person has not said create or yes since you drafted this. Ask them to say create, or to tap the button on the card. Do not call this again until they have said it." };
    }
    const confirmed: Record<string, unknown>[] = [];
    for (const d of waiting) {
      const res = await confirmAiAction({ id: d.id });
      if (res.ok) {
        setDraft(res.data);
        confirmed.push({ task: res.data.task?.title ?? res.data.summary, status: res.data.status, ...(res.data.error ? { error: res.data.error } : {}) });
      } else confirmed.push({ task: d.task?.title ?? d.summary, status: "failed", error: res.error });
    }
    return { confirmed };
  }, [setDraft, waitForSpokenConfirm]);

  const runCall = useCallback(
    async (call: LiveCall): Promise<{ id: string; name: string; response: Record<string, unknown> }> => {
      const r = run.current;
      const answer = (response: Record<string, unknown>) => ({ id: call.id, name: call.name, response });
      try {
        if (call.name === CONFIRM_DRAFTS_TOOL) return answer(await confirmByVoice());
        const chat = await ensureChat();
        const res = await runVoiceTool({ conversation_id: chat, name: call.name, args: call.args, drafts_left: Math.max(0, MAX_DRAFTS - r.draftsMade) });
        if (!res.ok) return answer({ error: res.error });
        if (res.data.draft) {
          r.draftsMade++;
          r.turnDrafts.push(res.data.draft.id);
          if (r.confirmFloor !== r.buffer.utterances) r.batch = [];
          r.confirmFloor = r.buffer.utterances;
          r.batch.push(res.data.draft.id);
          putDrafts([...draftsRef.current.filter((d) => d.id !== res.data.draft!.id), res.data.draft]);
          attachDraft(res.data.draft.id);
        }
        return answer(res.data.result);
      } catch {
        return answer({ error: "That did not work. Tell the person you could not do it just now." });
      }
    },
    [attachDraft, confirmByVoice, ensureChat, putDrafts],
  );

  const handleCalls = useCallback(
    async (calls: LiveCall[], socket: WebSocket) => {
      const r = run.current;
      r.toolsInFlight += calls.length;
      r.buffer.breakUtterance();
      r.userOpen = false;
      r.discard = false;
      clearTimeout(r.thinkTimer);
      setState("thinking");
      const responses = await Promise.all(calls.map(runCall));
      r.toolsInFlight -= calls.length;
      const live = responses.filter((x) => !r.cancelled.delete(x.id));
      if (r.ws === socket && socket.readyState === WebSocket.OPEN && live.length > 0) socket.send(toolResponseMessage(live));
    },
    [runCall, setState],
  );

  // ---------------------------------------------------------------- socket

  const onEvent = useCallback(
    (ev: LiveEvent, socket: WebSocket) => {
      const r = run.current;
      switch (ev.type) {
        case "ready":
          clearTimeout(r.setupTimer);
          r.ready = true;
          touch();
          setState("listening");
          r.quietUntil = Date.now() + 700;
          r.player?.chime();
          if (r.ctx && r.ctx.state !== "running") setSoundBlocked(true);
          break;
        case "handle":
          r.handle = ev.handle;
          break;
        case "audio":
          clearTimeout(r.thinkTimer);
          touch();
          if (r.discard) break;
          if (r.ctx?.state === "suspended") void r.ctx.resume();
          r.player?.enqueue(ev.pcm);
          break;
        case "heard":
          r.reconnects = 0;
          r.discard = false;
          touch();
          r.buffer.user(ev.text);
          speak("user", ev.text);
          clearTimeout(r.thinkTimer);
          r.thinkTimer = setTimeout(() => {
            if (stateRef.current === "listening" && !r.player?.speaking) setState("thinking");
          }, THINK_AFTER_MS);
          break;
        case "said":
          touch();
          clearTimeout(r.thinkTimer);
          r.buffer.model(ev.text);
          speak("model", ev.text);
          break;
        case "interrupted":
          r.discard = false;
          r.player?.clear();
          setState("listening");
          break;
        case "turnComplete":
          r.discard = false;
          if (r.toolsInFlight === 0 && r.buffer.hasModel) void flush();
          if (!r.player?.speaking && r.toolsInFlight === 0) setState("listening");
          break;
        case "toolCall":
          touch();
          for (const c of ev.calls) r.cancelled.delete(c.id);
          void handleCalls(ev.calls, socket);
          break;
        case "toolCancelled":
          for (const id of ev.ids) r.cancelled.add(id);
          break;
        case "goAway":
          break;
      }
    },
    [flush, handleCalls, setState, speak, touch],
  );

  const reconnectRef = useRef<() => void>(() => {});

  const connect = useCallback(
    (start: VoiceStart) => {
      const r = run.current;
      r.model = start.model;
      r.ready = false;
      const ws = new WebSocket(start.wsUrl);
      ws.binaryType = "arraybuffer";
      r.ws = ws;
      clearTimeout(r.setupTimer);
      r.setupTimer = setTimeout(() => {
        if (r.ws === ws && !r.ready) stop("Could not reach Gemini. Check your connection and try again.");
      }, SETUP_MS);

      ws.onopen = () => ws.send(JSON.stringify(start.setup));
      ws.onmessage = (e: MessageEvent<string | ArrayBuffer>) => {
        if (r.ws !== ws) return;
        const raw = typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data);
        for (const ev of parseLiveMessage(raw)) onEvent(ev, ws);
      };
      ws.onclose = (e) => {
        if (r.ws !== ws || r.closing) return;
        const wasReady = r.ready;
        r.ready = false;
        if (wasReady && r.handle && r.reconnects < RECONNECTS) {
          reconnectRef.current();
          return;
        }
        stop(closeMessage(e.code, e.reason));
      };
    },
    [onEvent, stop],
  );

  const reconnect = useCallback(async () => {
    const r = run.current;
    if (r.reconnecting || r.closing) return;
    r.reconnecting = true;
    r.reconnects++;
    setState("connecting");
    r.player?.clear();
    const res = await startVoiceSession({ model: r.model ?? undefined, prefs: r.prefs ?? undefined, resume_handle: r.handle ?? undefined, task_id: opts.current.taskId ?? undefined });
    r.reconnecting = false;
    if (r.closing) return;
    if (!res.ok) return stop(res.error);
    connect(res.data);
  }, [connect, setState, stop]);

  useEffect(() => {
    reconnectRef.current = () => void reconnect();
  }, [reconnect]);

  // ---------------------------------------------------------------- start, mute

  const start = useCallback(async () => {
    const r = run.current;
    if (stateRef.current !== "off" || !voiceSupported()) return;
    setMessage(null);
    r.session++;
    putTurns([]);
    r.pendingDrafts = [];
    r.discard = false;
    r.quietUntil = 0;
    r.userOpen = false;
    setSoundBlocked(false);
    setState("connecting");
    r.closing = false;
    r.reconnects = 0;
    r.handle = null;
    r.model = null;
    r.prefs = getVoicePrefs();
    r.chat = null;
    r.draftsMade = 0;
    r.confirmFloor = 0;
    r.batch = [];
    r.toolsInFlight = 0;
    r.saveWarned = false;
    r.buffer = new TurnBuffer();
    r.turnDrafts = [];
    putDrafts([]);

    // The audio context and the microphone request must begin inside the tap, or phones keep the sound locked.
    const ctx = newAudioContext();
    r.ctx = ctx;
    void ctx.resume();
    ctx.onstatechange = () => setSoundBlocked(ctx.state === "suspended" || (ctx.state as string) === "interrupted");
    let stream: MediaStream | null = null;
    try {
      const [mic, started] = await Promise.all([requestMic().then((s) => (stream = s)), startVoiceSession({ prefs: r.prefs ?? undefined, task_id: opts.current.taskId ?? undefined })]);
      if (!started.ok) throw new Error(started.error);
      if (r.ctx !== ctx) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      r.player = new VoicePlayer(ctx, (speaking) => {
        if (speaking) setState("speaking");
        else {
          r.quietUntil = Date.now() + QUIET_MS;
          if (r.ready && r.toolsInFlight === 0 && stateRef.current === "speaking") setState("listening");
        }
      });
      r.player.setVolume(getVoicePrefs().volume);
      r.mic = await MicCapture.start(
        ctx,
        mic,
        (pcm) => {
          const ws = r.ws;
          if (!r.ready || mutedRef.current || !ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 1_000_000) return;
          if (!bargeRef.current && (r.player?.speaking || Date.now() < r.quietUntil)) return;
          ws.send(audioMessage(int16ToBase64(pcm)));
        },
        (rms) => {
          level.current = mutedRef.current ? 0 : rms;
        },
      );
      touch();
      r.idleTimer = setInterval(() => {
        if (Date.now() - r.lastActivity > IDLE_MS) stop("Voice ended after a few quiet minutes.");
      }, 15_000);
      try {
        const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
        r.wake = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        /* the screen may sleep; the call carries on */
      }
      connect(started.data);
    } catch (e) {
      (stream as MediaStream | null)?.getTracks().forEach((t) => t.stop());
      r.closing = true;
      releaseDevices();
      setState("off");
      setMessage(e instanceof DOMException ? micErrorMessage(e) : e instanceof Error && e.message ? e.message : "Could not start voice.");
    }
  }, [connect, putDrafts, putTurns, releaseDevices, setState, stop, touch]);

  const interrupt = useCallback(() => {
    const r = run.current;
    if (!r.player?.speaking) return;
    r.discard = true;
    r.player.clear();
    setState("listening");
  }, [setState]);

  const enableSound = useCallback(() => {
    void run.current.ctx?.resume();
  }, []);

  const toggleBargeIn = useCallback(() => {
    const next = !bargeRef.current;
    bargeRef.current = next;
    setBargeIn(next);
    try {
      window.localStorage.setItem(BARGE_KEY, next ? "1" : "0");
    } catch {
      /* the choice only lasts for this call */
    }
  }, []);

  /** How loud the voice in the room is: the assistant's while it speaks, otherwise the person's. 0 to 1. */
  const getLevel = useCallback(() => {
    const p = run.current.player;
    return p?.speaking ? Math.min(1, p.level() * 3) : Math.min(1, level.current * 7);
  }, []);

  const toggleMute = useCallback(() => {
    const r = run.current;
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    r.mic?.setMuted(next);
    if (next && r.ws?.readyState === WebSocket.OPEN) r.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
  }, []);

  useEffect(() => {
    const again = () => {
      const r = run.current;
      const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
      if (document.visibilityState === "visible" && stateRef.current !== "off" && !r.wake) {
        void nav.wakeLock?.request("screen").then((w) => (r.wake = w)).catch(() => {});
      }
      if (document.visibilityState === "visible") void r.ctx?.resume();
    };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, []);

  // Volume is the one setting that can change in the middle of a call; the rest are read when a call starts.
  const volume = useVoicePrefs().volume;
  useEffect(() => {
    run.current.player?.setVolume(volume);
  }, [volume]);

  useEffect(() => () => stop(), [stop]);

  return { supported, state, message, muted, turns, drafts, soundBlocked, bargeIn, getLevel, start, stop: () => stop(), interrupt, enableSound, toggleBargeIn, toggleMute, setDraft, clearMessage: () => setMessage(null) };
}
