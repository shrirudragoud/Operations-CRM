// Service worker for browser notifications. It only shows pushes and opens the app when one is clicked; it caches nothing.
// Served at /sw.js (public path, never cached: see next.config.ts and utils/supabase/proxy.ts).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Only same-site paths are followed, whatever a payload says.
function safePath(url) {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/";
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Hard-Code Ops";

  event.waitUntil(
    (async () => {
      // When the app is open and in front, the bell and its toast already show the news; do not shout twice.
      // A test notification is always shown, so the person can see that it works.
      if (data.kind !== "test") {
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        if (windows.some((w) => w.visibilityState === "visible")) return;
      }
      await self.registration.showNotification(title, {
        body: typeof data.body === "string" ? data.body : "",
        tag: typeof data.tag === "string" ? data.tag : undefined,
        data: { url: safePath(data.url) },
        icon: "/favicon.ico",
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows[0];
      if (open) {
        await open.focus();
        if ("navigate" in open) await open.navigate(target).catch(() => {});
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
