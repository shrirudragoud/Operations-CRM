/** The public half of the browser-notification key, read at run time. Null means browser notifications are not set up. */
export function vapidPublicKey(): string | null {
  const k = process.env.VAPID_PUBLIC_KEY?.trim();
  return k ? k : null;
}
