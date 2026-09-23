"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import { H3_STYLE_PRESETS, resolveH3StylePreset } from "@/lib/h3StylePresets";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function H3StylePresetPicker({
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  value: string;
  onChange: (styleId: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const selected = useMemo(
    () => resolveH3StylePreset(value) || H3_STYLE_PRESETS[0],
    [value],
  );
  const reducedMotion = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const browserVideoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserPreviewId, setBrowserPreviewId] = useState<string | null>(null);
  const preview = selected?.preview;
  const shouldAutoplay = Boolean(preview && !reducedMotion);

  useEffect(() => {
    setPlaying(shouldAutoplay);
  }, [selected?.id, shouldAutoplay]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      void video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  }, [playing, selected?.id]);

  useEffect(() => {
    const video = browserVideoRef.current;
    if (!video || !browserPreviewId) return;

    video.currentTime = 0;
    void video.play().catch(() => setBrowserPreviewId(null));
  }, [browserPreviewId]);

  function previewPreset(styleId: string) {
    setPlaying(false);
    videoRef.current?.pause();

    const currentPreview = browserVideoRef.current;

    if (browserPreviewId === styleId && currentPreview) {
      currentPreview.currentTime = 0;
      void currentPreview.play().catch(() => setBrowserPreviewId(null));
      return;
    }

    setBrowserPreviewId(styleId);
  }

  function toggleBrowser() {
    if (browserOpen) {
      browserVideoRef.current?.pause();
      setBrowserPreviewId(null);
      setPlaying(shouldAutoplay);
    } else {
      setPlaying(false);
      videoRef.current?.pause();
    }

    setBrowserOpen((current) => !current);
  }

  function selectPreset(styleId: string) {
    browserVideoRef.current?.pause();
    setBrowserPreviewId(null);
    onChange(styleId);
    setPlaying(shouldAutoplay);
    setBrowserOpen(false);
  }

  return (
    <div className="space-y-3" data-otg="h3-style-preset-picker">
      <div
        className={`rounded-[8px] border px-4 py-3 transition-all ${
          selected?.id === "none"
            ? "border-white/10 bg-black/25"
            : "border-violet-300/40 bg-gradient-to-r from-violet-500/15 via-fuchsia-500/10 to-cyan-400/10 shadow-[0_0_24px_rgba(139,92,246,.12)]"
        }`}
        data-otg="h3-selected-style-preview"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,340px)]">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-200/60">
              Current preset
            </p>
            <p className="mt-1 text-base font-black text-white">
              {selected?.label || "Default / None"}
            </p>
            <p className="mt-1 text-[11px] font-semibold text-white/50">
              {selected?.subtitle || "H3 default behavior"}
            </p>
            {selected?.description ? (
              <p className="mt-2 max-w-4xl text-[11px] leading-relaxed text-white/45">
                {selected.description}
              </p>
            ) : null}
          </div>

          <div className="min-w-0">
            {preview ? (
              <button
                type="button"
                className="group relative block aspect-video w-full overflow-hidden rounded-[8px] border border-white/10 bg-black text-left"
                onClick={() => setPlaying((current) => !current)}
                aria-label={`${playing ? "Pause" : "Play"} ${selected?.label} style preview`}
                data-otg="h3-selected-style-video-toggle"
              >
                <video
                  key={selected?.id}
                  ref={videoRef}
                  src={preview.previewVideo}
                  poster={preview.poster}
                  muted
                  loop
                  playsInline
                  autoPlay={shouldAutoplay}
                  preload="metadata"
                  className="h-full w-full object-cover"
                  data-otg="h3-selected-style-video"
                />
                <span className="pointer-events-none absolute bottom-2 left-2 rounded-full border border-white/25 bg-black/70 px-3 py-1 text-[11px] font-black text-white shadow-lg backdrop-blur-sm">
                  {playing ? "Pause" : "Play"}
                </span>
              </button>
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-[8px] border border-dashed border-white/12 bg-black/25 px-4 text-center text-xs font-bold text-white/40">
                {selected?.id === "none"
                  ? "Default H3 behavior"
                  : "Animated example coming soon. The style remains fully usable."}
              </div>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={disabled}
        aria-expanded={browserOpen}
        aria-controls="h3-style-card-browser"
        onClick={toggleBrowser}
        className="min-h-10 w-full rounded-[8px] border border-violet-300/35 bg-violet-300/10 px-4 py-2 text-sm font-black text-violet-50 transition hover:bg-violet-300/18 disabled:cursor-not-allowed disabled:opacity-45"
        data-otg="h3-style-browser-toggle"
      >
        {browserOpen ? "Hide Styles" : "Choose Style"}
      </button>

      {browserOpen ? (
        <div
          id="h3-style-card-browser"
          className={`grid gap-2 ${compact ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4"}`}
          data-otg="h3-style-card-browser"
        >
          {H3_STYLE_PRESETS.map((preset) => {
            const isSelected = preset.id === selected?.id;
            const isBrowserPreviewing = browserPreviewId === preset.id;
            const hasPreview = Boolean(preset.preview?.previewVideo);

            return (
              <div
                key={preset.id}
                onClick={() => {
                  if (!disabled) selectPreset(preset.id);
                }}
                className={`group relative min-h-[156px] overflow-hidden rounded-[8px] border p-0 text-left transition-all duration-200 ${
                  isSelected
                    ? "z-10 -translate-y-0.5 border-violet-300/75 bg-violet-500/15 shadow-[0_0_0_1px_rgba(196,181,253,.16),0_10px_30px_rgba(124,58,237,.22)] ring-1 ring-violet-300/45"
                    : "border-white/10 bg-[#11172a]/90 hover:-translate-y-0.5 hover:border-violet-300/30 hover:bg-white/[0.08]"
                } ${disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer"}`}
                data-otg="h3-style-card"
              >
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={isSelected}
                  aria-label={`Select ${preset.label} style`}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectPreset(preset.id);
                  }}
                  className="absolute inset-0 z-0 rounded-[8px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70"
                  data-otg="h3-style-card-select"
                >
                  <span className="sr-only">Select {preset.label}</span>
                </button>

                <div className="pointer-events-none relative z-10">
                  <div className="aspect-video bg-black/50">
                    {isBrowserPreviewing && preset.preview?.previewVideo ? (
                      <video
                        ref={browserVideoRef}
                        src={preset.preview.previewVideo}
                        poster={preset.preview.poster}
                        muted
                        playsInline
                        preload="metadata"
                        onEnded={() =>
                          setBrowserPreviewId((current) =>
                            current === preset.id ? null : current,
                          )
                        }
                        className="h-full w-full object-cover"
                        data-otg="h3-style-card-video"
                      />
                    ) : preset.preview?.poster ? (
                      <img
                        src={preset.preview.poster}
                        alt={`${preset.label} style poster`}
                        loading="lazy"
                        className="h-full w-full object-cover"
                        data-otg="h3-style-card-poster"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center px-3 text-center text-[11px] font-bold text-white/35">
                        Default
                      </div>
                    )}
                  </div>

                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 text-sm font-black text-white">
                        {preset.label}
                      </div>

                      {hasPreview ? (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={(event) => {
                            event.stopPropagation();
                            previewPreset(preset.id);
                          }}
                          className="pointer-events-auto shrink-0 rounded-[6px] border border-violet-300/35 bg-violet-300/10 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-violet-100 transition hover:bg-violet-300/20 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Preview ${preset.label} style`}
                          data-otg="h3-style-card-preview-button"
                        >
                          Preview
                        </button>
                      ) : null}
                    </div>

                    <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-white/45">
                      {preset.category}
                    </div>

                    <div className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-white/42">
                      {preset.description}
                    </div>
                  </div>

                  {isSelected ? (
                    <span className="absolute right-2 top-2 rounded-full border border-violet-200/40 bg-violet-300/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-violet-50">
                      Selected
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
