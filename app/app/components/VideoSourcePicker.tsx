"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { videoDurationLabel, type VideoSourceChoice, type VideoSourceInfo } from "@/lib/videoCharacters/videoSourceContract";

function SourceTile({ clip, selected, disabled, onSelect }: {
  clip: VideoSourceChoice; selected: boolean; disabled: boolean; onSelect: () => void;
}) {
  const [info, setInfo] = useState<VideoSourceInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  function readInfo() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    void fetch(clip.infoUrl, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const body = await response.json();
      if (!controller.signal.aborted) setInfo(body.clip);
    }).catch(() => { /* Selecting and previewing the original video stays available. */ });
  }
  return <button type="button" disabled={disabled} aria-pressed={selected}
    aria-label={`Select clip ${clip.clipId}${info ? ", " + videoDurationLabel(info.duration) : ""}`}
    className={`min-h-20 min-w-0 overflow-hidden rounded-lg border p-1 text-left disabled:opacity-40 ${selected ? "border-cyan-300 bg-cyan-300/15 ring-1 ring-cyan-300" : "border-white/15 bg-black/25"}`}
    onClick={onSelect}>
    {failed ? <span className="flex h-12 items-center justify-center text-center text-[10px] text-white/60">Preview unavailable</span>
      : <img src={clip.posterUrl} alt={`First frame of clip ${clip.clipId}`} width={192} height={108}
        loading="lazy" decoding="async" className="h-12 w-full rounded bg-black object-contain" onLoad={readInfo} onError={() => { setFailed(true); readInfo(); }} />}
    <span className="mt-1 block text-center font-mono text-[10px] leading-4">{clip.clipId}</span>
    <span className="block text-center text-[10px] leading-4 text-white/70">{selected ? "Selected · " : ""}{info ? videoDurationLabel(info.duration) : "—"}</span>
  </button>;
}

export default function VideoSourcePicker({ sources, value, disabled, onChange }: {
  sources: VideoSourceChoice[]; value: string; disabled: boolean; onChange: (key: string) => void;
}) {
  const selected = sources.find(clip => clip.key === value);
  return <section aria-label="Choose an existing TEST video" className="min-w-0 space-y-2">
    <p className="text-sm">Choose a video</p>
    <p className="text-xs text-white/60">Newest first. Each clip keeps its own short ID. Tap a thumbnail to select and preview it.</p>
    {sources.length ? <div className="grid max-h-64 grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-2 overflow-y-auto rounded-lg border border-white/10 p-2">
      {sources.map(clip => <SourceTile key={clip.key} clip={clip} selected={value === clip.key} disabled={disabled} onSelect={() => onChange(clip.key)} />)}
    </div> : <p className="text-sm text-white/60">Your Gallery and H3 test videos will appear here. You can also upload an MP4.</p>}
    {selected && <div className="space-y-2 rounded-lg border border-cyan-300/25 p-2">
      <p className="text-sm">Selected clip <span className="font-mono">{selected.clipId}</span>
        {selected.createdAt > 0 && <span className="ml-2 text-xs text-white/60">{new Date(selected.createdAt).toLocaleString()}</span>}</p>
      <video key={selected.key} controls playsInline preload="metadata" poster={selected.posterUrl} src={selected.previewUrl} className="max-h-52 w-full rounded bg-black" />
      <details className="text-xs text-white/60"><summary className="cursor-pointer">Video details</summary><p className="mt-1 break-all">{selected.name}</p></details>
    </div>}
  </section>;
}
