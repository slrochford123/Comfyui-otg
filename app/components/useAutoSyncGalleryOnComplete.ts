"use client";

function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";
  return (
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "desktop_default"
  );
}
import { useEffect, useRef } from "react";

type Options = {
  deviceId: string;
  loadGallery: () => Promise<void> | void;

  // must return the most recent promptId for the last job
  getLastPromptId: () => string;

  enabled?: boolean;
  progressUrl?: string;
  importUrl?: string;
  intervalMs?: number;
};

export function useAutoImportGalleryOnComplete({
  deviceId,
  loadGallery,
  getLastPromptId,
  enabled = true,
  progressUrl = "/api/progress",
  importUrl = "/api/gallery/import",
  intervalMs = 1500,
}: Options) {
  const lastDoneRef = useRef(false);
  const importingRef = useRef(false);
  const lastImportedPromptRef = useRef<string>("");

  useEffect(() => {
    if (!enabled) return;
    if (!deviceId) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;

      try {
        const pr = await fetch(progressUrl, {
          method: "GET",
          headers: { "x-otg-device-id": deviceId },
          cache: "no-store",
        });
        if (!pr.ok) return;
        const j = await pr.json().catch(() => ({}));

        const done =
          j?.status === "complete" ||
          j?.status === "idle" ||
          j?.queue === 0 ||
          j?.queue_remaining === 0 ||
          j?.running === false;

        if (done && !lastDoneRef.current && !importingRef.current) {
          lastDoneRef.current = true;

          const promptId = (getLastPromptId?.() || "").trim();
          if (!promptId) {
            // No promptId = nothing to import
            return;
          }

          // prevent double-importing same prompt
          if (lastImportedPromptRef.current === promptId) return;

          importingRef.current = true;
          try {
            await fetch(importUrl, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-otg-device-id": deviceId,
              },
              body: JSON.stringify({ promptId, limit: 50 }),
            });

            lastImportedPromptRef.current = promptId;
            await Promise.resolve(loadGallery());
          } finally {
            importingRef.current = false;
          }
        }

        if (!done) lastDoneRef.current = false;
      } catch {
        // ignore
      }
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [deviceId, loadGallery, getLastPromptId, enabled, progressUrl, importUrl, intervalMs]);
}
