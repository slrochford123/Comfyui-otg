"use client";
import {useEffect, useRef} from "react";
import {Capacitor} from "@capacitor/core";
import {App} from "@capacitor/app";
import {H3_RECOVERY_RESUME_EVENT} from "./h3Recovery";

/** Coalesce native/browser resume events; stale listeners cannot mutate new owners. */
export function useH3Resume(callback: () => void | Promise<void>) {
  const latest = useRef(callback);
  useEffect(() => { latest.current = callback; }, [callback]);
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
    let native: {remove: () => Promise<void>} | undefined;
    const resume = () => {
      if (document.visibilityState === "hidden") return;
      clearTimeout(timer);
      timer = setTimeout(() => { if (!disposed) void Promise.resolve(latest.current()).catch(() => {}); }, 100);
    };
    for (const event of ["pageshow", "online", H3_RECOVERY_RESUME_EVENT]) window.addEventListener(event, resume);
    document.addEventListener("visibilitychange", resume);
    if (Capacitor.isNativePlatform()) void App.addListener("appStateChange", ({isActive}) => { if (isActive) resume(); })
      .then(listener => { if (disposed) void listener.remove(); else native = listener; }).catch(() => {});
    return () => {
      disposed = true; clearTimeout(timer); void native?.remove();
      for (const event of ["pageshow", "online", H3_RECOVERY_RESUME_EVENT]) window.removeEventListener(event, resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
}
