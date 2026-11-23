"use client";

import { useEffect, useRef } from "react";
import { AudioLinesIcon, MicIcon, MicOffIcon, PhoneOffIcon, Volume2Icon } from "lucide-react";
import type { VoiceState } from "@/components/assistant/use-voice";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "cn";

const LABEL: Record<VoiceState, string> = {
  off: "",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
};

type Props = {
  state: VoiceState;
  muted: boolean;
  /** Anything has been said yet in this call. */
  started: boolean;
  soundBlocked: boolean;
  bargeIn: boolean;
  getLevel: () => number;
  onMute: () => void;
  onStop: () => void;
  onInterrupt: () => void;
  onEnableSound: () => void;
  onBargeIn: () => void;
};

/** The call controls, in place of the message box: what it hears, a big round state button that moves with the voice, mute and end. */
export function VoiceDock({ state, muted, started, soundBlocked, bargeIn, getLevel, onMute, onStop, onInterrupt, onEnableSound, onBargeIn }: Props) {
  const ring = useRef<HTMLSpanElement>(null);
  const halo = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let smooth = 0;
    const tick = () => {
      smooth = smooth * 0.8 + getLevel() * 0.2;
      if (ring.current) ring.current.style.transform = `scale(${1 + smooth * 0.55})`;
      if (halo.current) halo.current.style.transform = `scale(${1 + smooth * 1.1})`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getLevel]);

  const showMuted = muted && state !== "connecting";
  const label = showMuted ? "Muted" : LABEL[state];
  const speaking = state === "speaking";
  const busy = state === "connecting" || state === "thinking";
  const caption = showMuted
    ? "Your microphone is off."
    : speaking
      ? bargeIn
        ? "Just start talking to interrupt."
        : "Tap the circle to interrupt."
      : state === "connecting"
        ? "Setting up your microphone…"
        : state === "listening"
          ? started
            ? "Go ahead, I’m listening."
            : "Say something, like “What’s on my day?”"
          : "";
  const orb = (
    <span className={cn("relative z-10 grid size-16 place-items-center rounded-full text-white shadow-md transition-colors", showMuted ? "bg-muted-foreground" : "bg-primary")}>
      {busy ? <Spinner className="size-7" /> : speaking ? <AudioLinesIcon aria-hidden className="size-7" /> : showMuted ? <MicOffIcon aria-hidden className="size-7" /> : <MicIcon aria-hidden className="size-7" />}
    </span>
  );

  return (
    <div className="pt-3" role="group" aria-label="Voice call">
      <div className="bg-card flex flex-col items-center gap-3 rounded-2xl border px-4 pt-3.5 pb-3 shadow-xs">
        <div className="flex items-center gap-2">
          <span aria-hidden className={cn("size-2 rounded-full", showMuted ? "bg-muted-foreground" : state === "connecting" ? "bg-amber-500" : "bg-emerald-500 motion-safe:animate-pulse")} />
          <p role="status" aria-live="polite" className="text-sm font-medium">
            {label}
          </p>
        </div>

        <p className="text-muted-foreground min-h-5 max-w-md text-center text-sm leading-snug break-words">{caption}</p>

        <div className="flex items-start gap-7">
          <div className="flex flex-col items-center gap-1">
            <Button type="button" variant="outline" size="icon-lg" className="size-12 rounded-full" aria-label={muted ? "Unmute microphone" : "Mute microphone"} aria-pressed={muted} onClick={onMute}>
              {muted ? <MicOffIcon aria-hidden /> : <MicIcon aria-hidden />}
            </Button>
            <span className="text-muted-foreground text-xs">{muted ? "Unmute" : "Mute"}</span>
          </div>

          <div className="relative grid size-24 place-items-center">
            <span ref={halo} aria-hidden className={cn("absolute size-16 rounded-full", showMuted ? "bg-transparent" : "bg-primary/10")} />
            <span ref={ring} data-testid="voice-ring" aria-hidden className={cn("absolute size-16 rounded-full", showMuted ? "bg-transparent" : "bg-primary/20", speaking && "motion-safe:animate-pulse")} />
            {speaking ? (
              <button type="button" aria-label="Interrupt the assistant" className="focus-visible:ring-ring/50 relative z-10 cursor-pointer rounded-full outline-none focus-visible:ring-3" onClick={onInterrupt}>
                {orb}
              </button>
            ) : (
              orb
            )}
          </div>

          <div className="flex flex-col items-center gap-1">
            <Button type="button" variant="destructive" size="icon-lg" className="size-12 rounded-full" aria-label="End voice call" onClick={onStop}>
              <PhoneOffIcon aria-hidden />
            </Button>
            <span className="text-muted-foreground text-xs">End</span>
          </div>
        </div>

        {soundBlocked && (
          <Button type="button" size="sm" onClick={onEnableSound}>
            <Volume2Icon aria-hidden /> Tap to turn the sound on
          </Button>
        )}

        <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs">
          <Switch size="sm" checked={bargeIn} onCheckedChange={onBargeIn} aria-label="Talk over the assistant" />
          Talk over it (use headphones)
        </label>
      </div>
    </div>
  );
}
