// Browser side of notifications: the service worker, the permission and the push subscription. Client components only.
import { removePushSubscription, savePushSubscription } from "@/lib/actions/push";

export type Outcome = { ok: true } | { ok: false; error: string };

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const raw = atob(base64Url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64Url.length / 4) * 4, "="));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(sub: PushSubscription, base64Url: string): boolean {
  const have = sub.options.applicationServerKey;
  if (!have) return false;
  const a = new Uint8Array(have);
  const b = keyBytes(base64Url);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** This browser's current subscription, if any. Does not ask for anything. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

function toInput(sub: PushSubscription) {
  const j = sub.toJSON();
  return { endpoint: j.endpoint ?? sub.endpoint, p256dh: j.keys?.p256dh ?? "", auth: j.keys?.auth ?? "", userAgent: navigator.userAgent.slice(0, 300) };
}

/** Asks permission, subscribes this browser and tells the server. */
export async function enablePush(vapidKey: string): Promise<Outcome> {
  if (!pushSupported()) return { ok: false, error: "This browser cannot show notifications from a website." };
  const permission = await Notification.requestPermission();
  if (permission === "denied") return { ok: false, error: "Notifications are blocked for this site. Allow them in your browser's site settings, then try again." };
  if (permission !== "granted") return { ok: false, error: "You did not allow notifications." };
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, vapidKey)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) });
    return await savePushSubscription(toInput(sub));
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? `Could not turn notifications on: ${e.message}` : "Could not turn notifications on." };
  }
}

/** Forgets this device on the server and in the browser. */
export async function disablePush(): Promise<Outcome> {
  try {
    const sub = await currentSubscription();
    if (sub) {
      const r = await removePushSubscription({ endpoint: sub.endpoint });
      if (!r.ok) return r;
      await sub.unsubscribe();
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not turn notifications off." };
  }
}

/** Run just before signing out: the next person on this computer must not see this person's notifications. Never blocks long. */
export async function releaseThisDevice(): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await Promise.race([removePushSubscription({ endpoint: sub.endpoint }), new Promise((r) => setTimeout(r, 3000))]);
    await sub.unsubscribe();
  } catch {
    // signing out matters more than tidying up; the database drops a dead device on its next failed push
  }
}

/** Re-registers this device so the server keeps it (call at most once a day). */
export async function refreshDevice(): Promise<void> {
  const sub = await currentSubscription();
  if (sub) await savePushSubscription(toInput(sub));
}
