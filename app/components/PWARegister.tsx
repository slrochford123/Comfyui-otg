"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js in production and keeps it updated.
 * This is the minimum needed for Android "Install app" eligibility.
 */
export default function PWARegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

        // If there's an updated SW waiting, activate it.
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });

        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              // New content available; refresh on next navigation
              // (We avoid force reload loops.)
              console.log("[PWA] update installed");
            }
          });
        });
      } catch (err) {
        console.warn("[PWA] SW register failed", err);
      }
    };

    register();
  }, []);

  return null;
}
