"use client";

import { useEffect } from "react";
import { currentSubscription, pushSupported, refreshDevice } from "@/lib/push-client";
import { createClient } from "@/utils/supabase/client";

const REFRESHED_KEY = "ops-push-refreshed";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps this browser's notification subscription honest, without showing anything.
 * - A subscription the signed-in person does not own (the last person on this computer) is dropped, so their notifications stop here.
 * - One the person does own is refreshed once a day, so the server does not mistake it for an abandoned device.
 */
export function PushSync() {
  useEffect(() => {
    if (!pushSupported() || Notification.permission !== "granted") return;
    let cancelled = false;
    (async () => {
      const sub = await currentSubscription();
      if (!sub || cancelled) return;
      const { data, error } = await createClient().from("push_subscription").select("id").eq("endpoint", sub.endpoint).maybeSingle();
      if (cancelled || error) return;
      if (!data) {
        await sub.unsubscribe();
        return;
      }
      const last = Number(localStorage.getItem(REFRESHED_KEY) ?? 0);
      if (Date.now() - last > DAY_MS) {
        await refreshDevice();
        localStorage.setItem(REFRESHED_KEY, String(Date.now()));
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
