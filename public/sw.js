/* ComfyUI OTG Service Worker
 * Keeps installability and enables basic offline shell caching.
 * NOTE: keep this file at /public/sw.js so it is served at /sw.js
 *
 * IMPORTANT:
 * - Do NOT cache Next.js build assets (/_next/static/*). Caching those causes "Loading chunk failed"
 *   after deployments because old cached runtime requests chunks that no longer exist.
 */
const VERSION = "otg-sw-v2";
const SHELL_CACHE = `otg-shell-${VERSION}`;

// Minimal offline shell only (HTML routes + manifest)
const SHELL_ASSETS = [
  "/",
  "/login",
  "/signup",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_ASSETS.map((u) => new Request(u, { cache: "reload" })));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => (k.startsWith("otg-shell-") && k !== SHELL_CACHE) ? caches.delete(k) : Promise.resolve())
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache Next.js build assets or API routes.
  if (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req));
    return;
  }

  const accept = req.headers.get("accept") || "";
  const isNavigation = req.mode === "navigate" || accept.includes("text/html");

  // Navigation: network-first (fresh HTML), fallback to cached shell
  if (isNavigation) {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        // When offline, prefer the login shell (works for signed-out and avoids caching app JS)
        const cached = await cache.match("/login");
        return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" }});
      }
    })());
    return;
  }

  // Other same-origin GETs: network-first, fallback to cache (safe for images/fonts/etc),
  // but we keep caching conservative to avoid JS chunk staleness.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);

    try {
      const fresh = await fetch(req);
      if (fresh.ok) {
        // Only cache non-JS, non-HTML assets.
        const ct = fresh.headers.get("content-type") || "";
        const isJs = ct.includes("javascript") || url.pathname.endsWith(".js");
        const isHtml = ct.includes("text/html") || url.pathname.endsWith(".html");
        if (!isJs && !isHtml) {
          cache.put(req, fresh.clone()).catch(() => {});
        }
      }
      return fresh;
    } catch {
      const cached = await cache.match(req);
      return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" }});
    }
  })());
});

// Open the app to Gallery when the user taps a notification
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = (event.notification && event.notification.data && event.notification.data.url)
    ? String(event.notification.data.url)
    : "/app?tab=gallery";

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of allClients) {
      try {
        if ("focus" in client) await client.focus();
        if ("navigate" in client) await client.navigate(url);
        return;
      } catch {
        // keep trying
      }
    }
    await self.clients.openWindow(url);
  })());
});
