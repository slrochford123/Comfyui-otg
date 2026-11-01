"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type View = { scale: number; x: number; y: number };
type Point = { x: number; y: number };
const INITIAL: View = { scale: 1, x: 0, y: 0 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const button = "min-h-11 rounded-xl border border-white/25 bg-black/80 px-3 text-sm font-bold text-white";

export default function ExpandedMediaViewer({ url, kind, name = "Media preview", poster, onClose }: {
  url: string; kind: "image" | "video"; name?: string; poster?: string; onClose: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const viewRef = useRef<View>(INITIAL);
  const [view, setView] = useState<View>(INITIAL);
  const [landscape, setLandscape] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const orientationLocked = useRef(false);
  const mounted = useRef(true);
  const isImage = kind === "image";

  function update(next: View) {
    const rect = surface.current?.getBoundingClientRect();
    const scale = clamp(next.scale, 1, 6);
    const width = rect?.width || 0, height = rect?.height || 0;
    const bounded = { scale, x: clamp(next.x, -width * (scale - 1) / 2, width * (scale - 1) / 2), y: clamp(next.y, -height * (scale - 1) / 2, height * (scale - 1) / 2) };
    viewRef.current = bounded; setView(bounded);
  }
  function zoom(scale: number) { update({ ...viewRef.current, scale }); }
  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }
  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const previous = [...pointers.current.values()];
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const next = [...pointers.current.values()];
    if (next.length >= 2) {
      const center = (p: Point[]) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
      const distance = (p: Point[]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const before = center(previous), after = center(next), rect = event.currentTarget.getBoundingClientRect();
      const current = viewRef.current, scale = clamp(current.scale * distance(next) / Math.max(1, distance(previous)), 1, 6), ratio = scale / current.scale;
      update({ scale, x: after.x - rect.left - rect.width / 2 - (before.x - rect.left - rect.width / 2 - current.x) * ratio, y: after.y - rect.top - rect.height / 2 - (before.y - rect.top - rect.height / 2 - current.y) * ratio });
    } else {
      update({ ...viewRef.current, x: viewRef.current.x + next[0].x - previous[0].x, y: viewRef.current.y + next[0].y - previous[0].y });
    }
  }
  function pointerEnd(event: React.PointerEvent<HTMLDivElement>) { pointers.current.delete(event.pointerId); }
  async function fullscreen() {
    try {
      if (container.current?.requestFullscreen && !document.fullscreenElement) await container.current.requestFullscreen();
      else if (!container.current?.requestFullscreen) (video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.();
    } catch { /* The viewport-sized viewer remains usable when fullscreen is unavailable. */ }
  }
  async function rotate() {
    const next = !landscape; setLandscape(next);
    const orientation = screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void> };
    if (!next) {
      if (orientationLocked.current) orientation.unlock?.();
      orientationLocked.current = false; return;
    }
    // Request fullscreen directly from the tap, before trying orientation lock.
    try { if (container.current?.requestFullscreen && !document.fullscreenElement) await container.current.requestFullscreen(); } catch {}
    try { if (orientation.lock) { await orientation.lock("landscape"); if (mounted.current) orientationLocked.current = true; else orientation.unlock?.(); } } catch { /* CSS rotation covers browsers that cannot lock orientation. */ }
  }
  useEffect(() => {
    mounted.current = true;
    const prior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    const media = window.matchMedia("(orientation: portrait)");
    const changed = () => setPortrait(media.matches); changed(); media.addEventListener("change", changed);
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (isImage && ["+", "=", "-", "0"].includes(event.key)) { event.preventDefault(); if (event.key === "0") update(INITIAL); else zoom(viewRef.current.scale + (event.key === "-" ? -0.5 : 0.5)); }
      if (event.key === "Tab") {
        const items = container.current?.querySelectorAll<HTMLElement>('button, video[controls], [tabindex="0"]');
        if (!items?.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const root = container.current;
    document.addEventListener("keydown", keydown);
    return () => {
      mounted.current = false;
      document.body.style.overflow = overflow; document.removeEventListener("keydown", keydown); media.removeEventListener("change", changed);
      if (orientationLocked.current) screen.orientation?.unlock?.();
      if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
      prior?.focus();
    };
    // The open viewer owns its initial focus, scroll lock and keyboard handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (typeof document === "undefined") return null;
  const rotated = landscape && portrait;
  return createPortal(
    <div ref={container} role="dialog" aria-modal="true" aria-label={name} className="fixed inset-0 z-[100000] overflow-hidden bg-black text-white" style={{ width: "100dvw", height: "100dvh" }}>
      <div className="absolute inset-x-0 top-0 z-20 flex flex-wrap items-center justify-end gap-2 bg-gradient-to-b from-black/90 to-transparent p-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        {isImage ? <>
          <button className={button} aria-label="Zoom out" disabled={view.scale <= 1} onClick={() => zoom(viewRef.current.scale - 0.5)}>−</button>
          <button className={button} aria-label="Reset image zoom" onClick={() => update(INITIAL)}>{Math.round(view.scale * 100)}%</button>
          <button className={button} aria-label="Zoom in" disabled={view.scale >= 6} onClick={() => zoom(viewRef.current.scale + 0.5)}>+</button>
        </> : <>
          <button className={button} onClick={() => void fullscreen()}>Full Screen</button>
          <button className={button} aria-pressed={landscape} onClick={() => void rotate()}>{landscape ? "Restore Orientation" : "Rotate to Landscape"}</button>
        </>}
        <button ref={closeButton} className={button} onClick={onClose}>Close</button>
      </div>
      {isImage ? <>
        <div ref={surface} className="absolute inset-0 overflow-hidden" style={{ touchAction: "none", cursor: view.scale > 1 ? "grab" : "zoom-in" }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd} onDoubleClick={() => viewRef.current.scale > 1 ? update(INITIAL) : zoom(2)} onWheel={event => { event.preventDefault(); zoom(viewRef.current.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)); }}>
          <img src={url} alt={name} draggable={false} className="h-full w-full select-none object-contain" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: "center" }} />
        </div>
        <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-white/70">Pinch to zoom · Drag to move · Double tap to zoom / reset</p>
      </> : <div className="absolute left-1/2 top-1/2" style={{ width: rotated ? "100dvh" : "100%", height: rotated ? "100dvw" : "100%", transform: `translate(-50%, -50%)${rotated ? " rotate(90deg)" : ""}` }}>
        <video ref={video} src={url} poster={poster} controls playsInline autoPlay className="h-full w-full object-contain" />
      </div>}
    </div>, document.body,
  );
}

export function ExpandableImage({ url, name, className = "", imageClassName = "h-full w-full object-contain" }: { url: string; name: string; className?: string; imageClassName?: string }) {
  const [expanded, setExpanded] = useState(false);
  return <><button type="button" className={`block ${className}`} aria-label={`Expand ${name}`} onClick={() => setExpanded(true)}><img src={url} alt={name} className={imageClassName} /></button>{expanded ? <ExpandedMediaViewer url={url} name={name} kind="image" onClose={() => setExpanded(false)} /> : null}</>;
}

export function ExpandableVideo({ url, poster, className = "max-h-[70vh] w-full rounded-lg bg-black" }: { url: string; poster?: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const inlineVideo = useRef<HTMLVideoElement>(null);
  return <><video ref={inlineVideo} src={url} poster={poster} controls playsInline preload="metadata" className={className} /><button type="button" className={`${button} mt-2`} onClick={() => { inlineVideo.current?.pause(); setExpanded(true); }}>Expand Video</button>{expanded ? <ExpandedMediaViewer url={url} poster={poster} kind="video" name="Video preview" onClose={() => setExpanded(false)} /> : null}</>;
}
