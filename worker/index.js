/* global workbox */

// This file is injected into the generated next-pwa service worker.
// It should be "enhancement only" (app still works without it).

try {
  const { registerRoute } = workbox.routing;
  const { NetworkOnly } = workbox.strategies;
  const { BackgroundSyncPlugin } = workbox.backgroundSync;

  // Retry window: 24 hours (in minutes)
  const promptQueue = new BackgroundSyncPlugin("comfy-otg-prompt-queue", {
    maxRetentionTime: 24 * 60,
  });

  const uploadQueue = new BackgroundSyncPlugin("comfy-otg-upload-queue", {
    maxRetentionTime: 24 * 60,
  });

  // Only queue prompt submissions (NOT pings/history/etc)
  registerRoute(
    ({ url, request }) =>
      url.pathname === "/api/comfy" &&
      request.method === "POST" &&
      request.headers.get("X-Comfy-Path") === "/prompt",
    new NetworkOnly({ plugins: [promptQueue] }),
    "POST"
  );

  // Queue image uploads too (optional)
  registerRoute(
    ({ url, request }) =>
      url.pathname === "/api/comfy-upload" &&
      request.method === "POST" &&
      request.headers.get("X-Comfy-Upload") === "1",
    new NetworkOnly({ plugins: [uploadQueue] }),
    "POST"
  );
} catch (e) {
  // no-op
}
