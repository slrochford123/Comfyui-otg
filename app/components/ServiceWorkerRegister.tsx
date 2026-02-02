"use client";

import { useEffect } from "react";

/**
 * Production parity / stability:
 * - DO NOT register the service worker in dev (it can cache old CSS/JS and make UI look "broken").
 * - In production, register and force-update so new builds take effect quickly.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");

        // Ask the SW to check for updates right away
        reg.update().catch(() => {});

        // If there's already a waiting worker, activate it
        if (reg.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }

        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              // New version installed; tell it to activate
              sw.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });

        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (cancelled) return;
          // Reload once the new SW takes control so CSS/JS match the new build
          window.location.reload();
        });
      } catch {
        // ignore
      }
    };

    // Register after load for smoother startup
    const onLoad = () => void register();
    window.addEventListener("load", onLoad);
    return () => {
      cancelled = true;
      window.removeEventListener("load", onLoad);
    };
  }, []);

  return null;
}
