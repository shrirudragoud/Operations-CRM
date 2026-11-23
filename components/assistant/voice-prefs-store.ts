"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_PREFS, normalisePrefs, type VoicePrefs } from "@/lib/ai/voice-prefs";

// The person's voice settings, kept in this browser. One object, shared by every part of the page that shows or uses it.
const KEY = "ops.voice.prefs";
const listeners = new Set<() => void>();
let current: VoicePrefs | null = null;

function load(): VoicePrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? normalisePrefs(JSON.parse(raw)) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function getVoicePrefs(): VoicePrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  return (current ??= load());
}

export function setVoicePrefs(patch: Partial<VoicePrefs>) {
  current = normalisePrefs({ ...getVoicePrefs(), ...patch });
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* the choice only lasts until the page is closed */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    current = null;
    cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useVoicePrefs(): VoicePrefs {
  return useSyncExternalStore(subscribe, getVoicePrefs, () => DEFAULT_PREFS);
}
