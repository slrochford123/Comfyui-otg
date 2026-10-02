"use client";

import React, { useEffect, useMemo, useState } from "react";

import {
  H3_STYLE_CATEGORIES,
  H3_STYLE_REGISTRY,
  resolveH3CanonicalStyle,
  type H3CanonicalStyle,
} from "@/lib/h3StyleRegistry";

const control = "min-h-10 rounded-[6px] border border-white/15 bg-white/[0.06] px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.11] disabled:cursor-not-allowed disabled:opacity-45";
const input = "min-w-0 max-w-full w-full rounded-[6px] border border-white/15 bg-black/45 px-3 py-2 text-sm text-white [overflow-wrap:anywhere] outline-none focus:border-violet-300/70";

function SelectedStylePreview({ style }: { style: H3CanonicalStyle }) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  if (style.id === "none") return null;
  return (
    <div className="mt-3 aspect-video w-full min-w-0 max-w-xl overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-violet-500/15 to-cyan-400/10">
      {!videoFailed && style.previewVideo ? (
        <video className="block h-full w-full object-contain" poster={!posterFailed ? style.poster || undefined : undefined} autoPlay={!reducedMotion} controls={reducedMotion} loop muted playsInline preload="metadata" onError={() => setVideoFailed(true)} aria-label={`${style.name} animated style example`}>
          {style.previewWebm ? <source src={style.previewWebm} type="video/webm" /> : null}
          <source src={style.previewVideo} type="video/mp4" />
        </video>
      ) : !posterFailed && style.poster ? (
        <img src={style.poster} alt={`${style.name} style example`} loading="lazy" className="block h-full w-full object-contain" onError={() => setPosterFailed(true)} />
      ) : (
        <div className="flex h-full items-center justify-center px-4 text-center text-xs font-bold text-white/40">Animated example coming soon. The style remains fully usable.</div>
      )}
    </div>
  );
}

export default function H3StyleSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (styleId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const selected = resolveH3CanonicalStyle(value) || H3_STYLE_REGISTRY[0];
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return H3_STYLE_REGISTRY.filter((style) => style.enabled)
      .filter((style) => category === "All" || style.category === category)
      .filter((style) => !query || `${style.name} ${style.shortDescription} ${style.category}`.toLowerCase().includes(query));
  }, [category, search]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  return (
    <section className="min-w-0" aria-label="H3 Style Art">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-black uppercase tracking-wide text-white/70">Style Art</h3>
          <p className="mt-1 text-lg font-black text-white">{selected.name}</p>
          <p className="mt-1 text-xs leading-5 text-white/50">{selected.shortDescription}</p>
          <SelectedStylePreview key={selected.id} style={selected} />
        </div>
        <button type="button" className={control} onClick={() => setOpen(true)} disabled={disabled} aria-haspopup="dialog">Change Style</button>
      </div>
      <details className="mt-3 rounded-[6px] border border-white/10 bg-black/20 p-3 text-xs text-white/55">
        <summary className="cursor-pointer font-bold text-white/75">Advanced Details</summary>
        <p className="mt-2"><span className="font-bold text-white/70">Category:</span> {selected.category}</p>
        <p className="mt-1"><span className="font-bold text-white/70">Prompt Builder mapping:</span> {selected.promptBuilderVisualStyle}</p>
        {selected.h3PromptInstructions ? <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{selected.h3PromptInstructions}</p> : null}
      </details>
      {open ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Choose H3 visual style" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
          <div className="flex max-h-[88dvh] w-full min-w-0 max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-white/15 bg-[#090b15] shadow-2xl sm:rounded-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
              <div><h3 className="text-lg font-black">Choose Style Art</h3><p className="text-xs text-white/45">{H3_STYLE_REGISTRY.length - 1} creative styles</p></div>
              <button type="button" className={control} onClick={() => setOpen(false)} aria-label="Close style selector">Close</button>
            </div>
            <div className="grid gap-2 border-b border-white/10 p-4 sm:grid-cols-[1fr_220px]">
              <input className={input} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search styles" aria-label="Search visual styles" autoFocus />
              <select className={input} value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter styles by category">
                <option>All</option>
                {H3_STYLE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>
            <div className="grid min-h-0 flex-1 gap-2 overflow-y-auto overscroll-contain p-4 [content-visibility:auto] sm:grid-cols-2">
              {filtered.map((style) => {
                const isSelected = style.id === selected.id;
                return (
                  <button key={style.id} type="button" aria-pressed={isSelected} onClick={() => { onChange(style.id); setOpen(false); }} className={`grid min-w-0 grid-cols-[84px_1fr] gap-3 rounded-xl border p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${isSelected ? "border-violet-300/70 bg-violet-300/15" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"}`}>
                    <div className="aspect-video overflow-hidden rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-400/10">{style.poster ? <img src={style.poster} alt="" loading="lazy" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.hidden = true; }} /> : null}</div>
                    <span className="min-w-0"><span className="block font-black text-white">{style.name}{isSelected ? " ✓" : ""}</span><span className="mt-0.5 block text-[10px] font-bold uppercase tracking-wide text-violet-200/55">{style.category}</span><span className="mt-1 line-clamp-2 block text-xs leading-4 text-white/45">{style.shortDescription}</span></span>
                  </button>
                );
              })}
              {!filtered.length ? <p className="py-10 text-center text-sm text-white/45 sm:col-span-2">No styles match this search.</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
