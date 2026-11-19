"use client";

import React, {useEffect, useRef, useState, type PointerEvent} from "react";

type Point = {x: number; y: number};
type View = Point & {scale: number};
const initialView = {x: 0, y: 0, scale: 1};

export default function ImageComparisonSlider({before, after, position, onChange}: {
  before: string; after: string; position: number; onChange: (position: number) => void;
}) {
  const [aspect, setAspect] = useState(1);
  const [view, setView] = useState(initialView);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const value = Math.max(0, Math.min(100, position));

  useEffect(() => {setView(initialView);}, [before, after]);

  function clamp(next: View, rect: DOMRect) {
    const x = rect.width * (next.scale - 1) / 2;
    const y = rect.height * (next.scale - 1) / 2;
    return {...next, x: Math.max(-x, Math.min(x, next.x)), y: Math.max(-y, Math.min(y, next.y))};
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const point = {x: event.clientX, y: event.clientY};
    const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
    pointers.current.set(event.pointerId, point);
    const rect = event.currentTarget.getBoundingClientRect();
    if (other) {
      const distance = Math.hypot(previous.x - other.x, previous.y - other.y);
      if (distance < 1) return;
      const ratio = Math.hypot(point.x - other.x, point.y - other.y) / distance;
      const x = (other.x + previous.x) / 2 - rect.left - rect.width / 2;
      const y = (other.y + previous.y) / 2 - rect.top - rect.height / 2;
      setView(current => {
        const scale = Math.max(1, Math.min(6, current.scale * ratio));
        return clamp({scale, x: x + (current.x - x) * scale / current.scale + (point.x - previous.x) / 2,
          y: y + (current.y - y) * scale / current.scale + (point.y - previous.y) / 2}, rect);
      });
    } else if (view.scale > 1) {
      setView(current => clamp({...current, x: current.x + point.x - previous.x, y: current.y + point.y - previous.y}, rect));
    } else {
      onChange(Math.max(0, Math.min(100, 100 * (point.x - rect.left) / rect.width)));
    }
  }

  const transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  const button = "min-h-11 rounded-lg border border-white/20 px-3 font-semibold disabled:opacity-40";
  function comparison(expanded: boolean) {
    return <div className="space-y-2">
      <div data-otg="before-after-comparison" className="relative isolate mx-auto select-none overflow-hidden rounded-2xl border border-white/15 bg-black"
        style={{touchAction: "none", width: `min(100%, ${(expanded ? 72 : 65) * aspect}vh)`, aspectRatio: aspect}}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, {x: event.clientX, y: event.clientY});
          if (event.pointerType === "mouse" && view.scale === 1) move(event);
        }}
        onPointerMove={move}
        onLostPointerCapture={event => {pointers.current.delete(event.pointerId);}}>
        <img src={before} alt="Before: original image" draggable={false} className="absolute inset-0 h-full w-full object-contain" style={{transform}}
          onLoad={event => {const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) setAspect(image.naturalWidth / image.naturalHeight);}} />
        <div className="pointer-events-none absolute inset-0" style={{clipPath: `inset(0 0 0 ${value}%)`}}>
          <img src={after} alt="After: edited image" draggable={false} className="h-full w-full object-contain" style={{transform}} />
        </div>
        <span className="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/75 px-3 py-1 text-xs font-bold">Before</span>
        <span className="pointer-events-none absolute right-3 top-3 rounded-lg bg-black/75 px-3 py-1 text-xs font-bold">After</span>
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-lg" style={{left: `${value}%`}} />
      </div>
      <label className="block text-sm text-white/70">Slide to compare
        <input aria-label={expanded ? "Expanded before and after comparison" : "Before and after comparison"} aria-valuetext={`${Math.round(value)}% original image`}
          type="range" min={0} max={100} value={value} onChange={event => onChange(Number(event.target.value))} className="block min-h-10 w-full accent-violet-400" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={() => setView(current => ({...initialView, scale: Math.min(6, current.scale + 0.5)}))} disabled={view.scale >= 6}>Zoom in</button>
        <button type="button" className={button} onClick={() => setView(initialView)} disabled={view.scale === 1}>Reset zoom</button>
        {expanded ? <button type="button" className={button} onClick={() => dialog.current?.close()}>Close comparison</button>
          : <button type="button" className={button} onClick={() => {setView(initialView);setExpanded(true);dialog.current?.showModal();}}>Expand comparison</button>}
      </div>
    </div>;
  }

  return <>
    {comparison(false)}
    <dialog ref={dialog} aria-label="Expanded image comparison" onClose={() => {setExpanded(false);setView(initialView);}}
      className="m-auto max-h-[95dvh] w-[96vw] max-w-6xl overflow-auto rounded-xl border border-white/20 bg-zinc-950 p-3 text-white backdrop:bg-black/85">
      {expanded && comparison(true)}
    </dialog>
  </>;
}
