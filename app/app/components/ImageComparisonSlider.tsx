"use client";
import React, {useState} from "react";

export default function ImageComparisonSlider({before, after, position, onChange}: {
  before: string; after: string; position: number; onChange: (position: number) => void;
}) {
  const [aspect, setAspect] = useState(1);
  const value = Math.max(0, Math.min(100, position));
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.type === "pointermove" && !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (event.type === "pointerdown") event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width) onChange(Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)));
  };
  return <div className="space-y-2">
    <div data-otg="before-after-comparison" className="relative isolate mx-auto select-none overflow-hidden rounded-2xl border border-white/15 bg-black" style={{touchAction: "pan-y", width: `min(100%, ${65 * aspect}vh)`, aspectRatio: aspect}}
      onPointerDown={move} onPointerMove={move} onPointerUp={event => {if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);}}>
      <img src={before} alt="Before: original image" draggable={false} className="absolute inset-0 h-full w-full object-contain"
        onLoad={event => {const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) setAspect(image.naturalWidth / image.naturalHeight);}} />
      <div className="pointer-events-none absolute inset-0" style={{clipPath: `inset(0 0 0 ${value}%)`}}>
        <img src={after} alt="After: edited image" draggable={false} className="h-full w-full object-contain" />
      </div>
      <span className="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/75 px-3 py-1 text-xs font-bold">Before</span>
      <span className="pointer-events-none absolute right-3 top-3 rounded-lg bg-black/75 px-3 py-1 text-xs font-bold">After</span>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-lg" style={{left: `${value}%`}}>
        <span className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-violet-700 text-xl font-bold shadow-lg" aria-hidden="true">↔</span>
      </div>
    </div>
    <label className="block text-sm text-white/65">Slide to compare
      <input aria-label="Before and after comparison" aria-valuetext={`${Math.round(value)}% original image`} type="range" min={0} max={100} step={1} value={value}
        onChange={event => onChange(Number(event.target.value))} className="block min-h-12 w-full accent-violet-400" />
    </label>
  </div>;
}
