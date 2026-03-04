"use client";

import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";

import { ensureNotificationPermission, notifyRenderComplete } from "@/src/native/notifications";
import { startRenderStatusPolling } from "@/src/native/renderPoller";

type ComfyEvent = { type?: string; prompt_id?: string; status?: string };

function isRenderComplete(evt: ComfyEvent) {
  return evt?.type === "execution_complete" || evt?.status === "completed";
}

function getDeviceId(): string {
  // Phase 1: try URL param first, then localStorage, else fallback.
  // Replace this later with your real device identity source.
  try {
    const url = new URL(window.location.href);
    const fromParam = url.searchParams.get("deviceId");
    if (fromParam) return fromParam;

    const fromStorage = window.localStorage.getItem("otg_device_id");
    if (fromStorage) return fromStorage;
  } catch {}
  return "DEVICEID";
}

export default function NotificationBridge() {
  const pollStopRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let es: EventSource | null = null;
    let cleanupAppListener: null | (() => void) = null;

    const start = async () => {
      await ensureNotificationPermission();

      // Optional: quick test trigger (?notifTest=1)
      try {
        const u = new URL(window.location.href);
        if (u.searchParams.get("notifTest") === "1") {
          setTimeout(() => {
            notifyRenderComplete("TEST_PROMPT_ID");
          }, 2000);
        }
      } catch {}

      // SSE best-effort (usually only reliable while foreground)
      try {
        es = new EventSource("/api/comfy-events");
        es.onmessage = async (msg) => {
          try {
            const data = JSON.parse(msg.data || "{}") as ComfyEvent;
            if (isRenderComplete(data) && data.prompt_id) {
              await notifyRenderComplete(data.prompt_id);
            }
          } catch {}
        };
        es.onerror = () => {};
      } catch {}

      const deviceId = getDeviceId();

      // Polling fallback (returns stop function)
      pollStopRef.current = await startRenderStatusPolling({
        baseUrl: window.location.origin,
        deviceId,
        intervalMs: 5000,
      });

      // On resume, restart polling (forces a fresh check)
      const listener = await CapApp.addListener("appStateChange", async ({ isActive }) => {
        if (!isActive) return;

        pollStopRef.current?.();
        pollStopRef.current = await startRenderStatusPolling({
          baseUrl: window.location.origin,
          deviceId: getDeviceId(),
          intervalMs: 5000,
        });
      });

      cleanupAppListener = () => listener.remove();
    };

    start();

    return () => {
      try { es?.close(); } catch {}
      pollStopRef.current?.();
      cleanupAppListener?.();
    };
  }, []);

  return null;
}
