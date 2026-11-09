"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: "portrait" | "landscape") => Promise<void>;
};

export default function StudioOrientationButton({
  targetRef,
}: {
  targetRef: RefObject<HTMLElement | null>;
}) {
  const [landscape, setLandscape] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const changing = useRef(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const orientation = window.screen.orientation;
    const update = () => setLandscape(
      orientation?.type
        ? orientation.type.startsWith("landscape")
        : window.innerWidth > window.innerHeight,
    );
    update();
    orientation?.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mounted.current = false;
      orientation?.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      if (locked.current) orientation?.unlock();
    };
  }, []);

  async function rotate() {
    if (changing.current) return;
    const orientation = window.screen.orientation as LockableOrientation | undefined;
    if (!orientation?.lock) {
      setMessage("This browser cannot rotate the studio with a button. Enable auto-rotate and turn your phone.");
      return;
    }
    const target = landscape ? "portrait" : "landscape";
    changing.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (!document.fullscreenElement && targetRef.current?.requestFullscreen)
        await targetRef.current.requestFullscreen();
      if (!mounted.current) return;
      await orientation.lock(target);
      if (!mounted.current) {
        orientation.unlock();
        return;
      }
      locked.current = true;
      setLandscape(target === "landscape");
    } catch {
      setMessage("The browser could not rotate the studio. Enable auto-rotate and turn your phone, or open the editor in Chrome.");
    } finally {
      changing.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="min-h-10 shrink-0 rounded-md border border-white/20 px-2 text-xs font-semibold disabled:opacity-40"
        disabled={busy}
        aria-label={`Rotate studio to ${landscape ? "portrait" : "landscape"}`}
        title="Rotate the studio on your phone"
        onClick={() => void rotate()}
      >
        {busy ? "Rotating…" : landscape ? "Portrait" : "Landscape"}
      </button>
      {message ? (
        <div role="status" className="absolute inset-x-2 top-full z-50 flex items-center gap-2 rounded-lg border border-white/20 bg-slate-900 p-3 text-sm shadow-lg">
          <span className="flex-1">{message}</span>
          <button type="button" aria-label="Dismiss rotation message" className="min-h-10 px-2" onClick={() => setMessage("")}>Close</button>
        </div>
      ) : null}
    </>
  );
}
