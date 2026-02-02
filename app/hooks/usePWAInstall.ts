"use client";

import { useEffect, useMemo, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isIos(): boolean {
  if (typeof window === "undefined") return false;
  // iPadOS can report as Mac; include touch heuristic.
  const ua = window.navigator.userAgent || "";
  const isApple = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
  return isApple;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari:
  // @ts-expect-error - non-standard on iOS
  const iosStandalone = window.navigator.standalone === true;
  // Other browsers:
  const displayStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
  return iosStandalone || displayStandalone;
}

export type PwaInstallState = {
  canPrompt: boolean;          // true when beforeinstallprompt captured (desktop/android chrome)
  isIos: boolean;              // iOS Safari/Chrome (WebKit)
  isStandalone: boolean;       // already installed / launched standalone
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
};

export function usePWAInstall(): PwaInstallState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState<boolean>(false);

  useEffect(() => {
    setStandalone(isStandalone());

    const onBip = (e: Event) => {
      // Chrome fires this; Safari does not.
      e.preventDefault?.();
      setDeferred(e as BeforeInstallPromptEvent);
    };

    const onDisplayMode = () => setStandalone(isStandalone());

    window.addEventListener("beforeinstallprompt", onBip as EventListener);
    window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", onDisplayMode);

    // iOS standalone can only be detected via navigation changes; re-check on focus.
    window.addEventListener("focus", onDisplayMode);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip as EventListener);
      window.matchMedia?.("(display-mode: standalone)")?.removeEventListener?.("change", onDisplayMode);
      window.removeEventListener("focus", onDisplayMode);
    };
  }, []);

  const state = useMemo<PwaInstallState>(() => {
    return {
      canPrompt: !!deferred,
      isIos: isIos(),
      isStandalone: standalone,
      promptInstall: async () => {
        if (!deferred) return "unavailable";
        try {
          await deferred.prompt();
          const choice = await deferred.userChoice;
          // Once prompted, browsers usually require a new event before prompting again.
          setDeferred(null);
          return choice.outcome;
        } catch {
          return "dismissed";
        }
      },
    };
  }, [deferred, standalone]);

  return state;
}
