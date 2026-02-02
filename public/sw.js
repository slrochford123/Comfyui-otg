/* ComfyUI OTG Service Worker
 * Keeps installability and enables basic offline shell caching.
 * NOTE: keep this file at /public/sw.js so it is served at /sw.js
 */
const VERSION = "otg-sw-v1";
const SHELL_CACHE = `otg-shell-${VERSION}`;

const SHELL_ASSETS = [
  "/",              // start_url (will likely redirect to /login for signed-out users)
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
    await Promise.all(keys.map((k) => (k.startsWith("otg-shell-") && k !== SHELL_CACHE) ? caches.delete(k) : Promise.resolve()));
    await self.clients.claim();
  })());
});

// Network-first for navigation, cache-first for other GETs
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  if (isNavigation) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        return fresh;
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(url.pathname === "/" ? "/login" : req);
        return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" }});
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    const fresh = await fetch(req);
    // Only cache successful same-origin responses
    if (fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
    return fresh;
  })());
});

// Open the app to Gallery when the user taps a notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = (event.notification && event.notification.data && event.notification.data.url)
    ? String(event.notification.data.url)
    : '/app?tab=gallery';

  event.waitUntil((async () => {
    // Prefer focusing an existing client
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      try {
        if ('focus' in client) {
          await client.focus();
        }
        // Navigate the existing window if possible
        if ('navigate' in client) {
          await client.navigate(url);
        }
        return;
      } catch {
        // keep trying
      }
    }

    // Otherwise open a new window
    await self.clients.openWindow(url);
  })());
});
