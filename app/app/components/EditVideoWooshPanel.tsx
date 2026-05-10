"use client";

import React from "react";

type SelectedVideo = {
  source?: "upload" | "gallery" | string;
  file?: File;
  fileName?: string;
  title?: string;
  previewUrl?: string;
  scope?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  sizeBytes?: number;
};

type WooshResult = {
  jobId: string;
  fileName: string;
  url: string;
  saved?: boolean;
  durationSeconds?: number;
  sizeBytes?: number;
  width?: number;
  height?: number;
  prompt?: string;
  model?: string;
  keepOriginalAudio?: boolean;
  originalVolume?: number;
  sfxVolume?: number;
  sourceDurationSeconds?: number;
  sfxDurationSeconds?: number;
  durationWasCapped?: boolean;
  wooshMaxSeconds?: number;
};

function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return "Unknown";
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `${secs}s`;
}

function formatBytes(bytes?: number) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "Unknown";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function withDownload(url: string) {
  if (!url) return "";
  return url.includes("?") ? `${url}&download=1` : `${url}?download=1`;
}

function cleanTitle(value: string) {
  return String(value || "woosh_sound_effects")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "woosh_sound_effects";
}

function selectedVideoName(video: SelectedVideo | null | undefined) {
  if (!video) return "No video selected";
  return video.title || video.fileName || video.file?.name || "Selected video";
}

export default function EditVideoWooshPanel({ audioVideo }: { audioVideo: SelectedVideo | null }) {
  const [prompt, setPrompt] = React.useState("natural synchronized sound effects matching the action, room tone, movement, footsteps, object sounds");
  const [model, setModel] = React.useState<"vflow" | "dvflow">("vflow");
  // OTG_WOOSH_VIDEO_LENGTH_DURATION: SFX duration follows the selected source video.
  const selectedDurationSeconds = Number(audioVideo?.durationSeconds || 0);
  const effectiveDurationSeconds =
    Number.isFinite(selectedDurationSeconds) && selectedDurationSeconds > 0 ? selectedDurationSeconds : 8;
  const [seed, setSeed] = React.useState(-1);
  const [keepOriginalAudio, setKeepOriginalAudio] = React.useState(true);
  const [originalVolume, setOriginalVolume] = React.useState(100);
  const [sfxVolume, setSfxVolume] = React.useState(70);
  const [busy, setBusy] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [result, setResult] = React.useState<WooshResult | null>(null);

  const canRun = Boolean(audioVideo && prompt.trim() && !busy);

  async function generateWooshSfx() {
    if (!audioVideo) {
      setStatus("Choose a video in Step 1 first.");
      return;
    }
    if (!prompt.trim()) {
      setStatus("Enter a sound-effects prompt first.");
      return;
    }

    setBusy(true);
    setStatus("Submitting Sony Woosh video-to-audio sound-effects job to ComfyUI...");
    setResult(null);

    try {
      const form = new FormData();
      form.append("prompt", prompt.trim());
      form.append("model", model);
      form.append("durationSeconds", String(Math.max(1, Number(effectiveDurationSeconds) || 8)));
      form.append("seed", String(Number(seed)));
      form.append("keepOriginalAudio", keepOriginalAudio ? "1" : "0");
      form.append("originalVolume", String(Math.max(0, Math.min(150, originalVolume)) / 100));
      form.append("sfxVolume", String(Math.max(0, Math.min(150, sfxVolume)) / 100));
      form.append("title", cleanTitle(`woosh_${selectedVideoName(audioVideo)}`));

      if (audioVideo.source === "upload" && audioVideo.file) {
        form.append("video_source", "upload");
        form.append("video_title", selectedVideoName(audioVideo));
        form.append("video_file", audioVideo.file, audioVideo.file.name || "selected_video.mp4");
      } else {
        form.append("video_source", "gallery");
        form.append("video_title", selectedVideoName(audioVideo));
        form.append("video_name", audioVideo.fileName || selectedVideoName(audioVideo));
        form.append("video_scope", audioVideo.scope || "");
      }

      const response = await fetch("/api/edit-video/woosh-sfx", {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || data?.detail?.error?.message || "Sony Woosh sound-effects generation failed.");
      }

      const next: WooshResult = {
        jobId: String(data.jobId),
        fileName: String(data.fileName || "woosh_sound_effects.mp4"),
        url: String(data.url || ""),
        durationSeconds: Number(data.durationSeconds || 0) || undefined,
        sourceDurationSeconds: Number(data.sourceDurationSeconds || 0) || undefined,
        sfxDurationSeconds: Number(data.sfxDurationSeconds || 0) || undefined,
        durationWasCapped: Boolean(data.durationWasCapped),
        wooshMaxSeconds: Number(data.wooshMaxSeconds || 0) || undefined,
        sizeBytes: Number(data.sizeBytes || 0) || undefined,
        width: Number(data.width || data?.target?.width || 0) || undefined,
        height: Number(data.height || data?.target?.height || 0) || undefined,
        prompt: String(data.prompt || prompt.trim()),
        model: String(data.model || model),
        keepOriginalAudio: Boolean(data.keepOriginalAudio ?? keepOriginalAudio),
        originalVolume: Number(data.originalVolume || originalVolume / 100),
        sfxVolume: Number(data.sfxVolume || sfxVolume / 100),
      };
      setResult(next);
      setStatus(
        data.durationWasCapped
          ? `Sony Woosh sound-effects video is ready. SFX matched ${formatDuration(data.sfxDurationSeconds)} of a ${formatDuration(data.sourceDurationSeconds)} source because the current Woosh model cap is ${formatDuration(data.wooshMaxSeconds)}.`
          : "Sony Woosh sound-effects video is ready. SFX duration matched the selected video. Preview it, download it, or save it to Gallery.",
      );
    } catch (error: any) {
      setStatus(error?.message || "Sony Woosh sound-effects generation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveWooshResult() {
    if (!result) {
      setStatus("No Sony Woosh result is ready to save.");
      return;
    }

    setSaving(true);
    setStatus("Saving Sony Woosh result to Gallery...");
    try {
      const response = await fetch("/api/edit-video/woosh-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: result.jobId,
          fileName: result.fileName,
          title: cleanTitle(result.fileName),
          videoName: selectedVideoName(audioVideo),
          prompt: result.prompt || prompt.trim(),
          model: result.model || model,
          keepOriginalAudio: result.keepOriginalAudio,
          originalVolume: result.originalVolume,
          sfxVolume: result.sfxVolume,
          durationSeconds: result.durationSeconds,
          sizeBytes: result.sizeBytes,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Save Sony Woosh result failed.");
      setResult((prev) => (prev ? { ...prev, saved: true } : prev));
      setStatus("Saved Sony Woosh result to Gallery.");
    } catch (error: any) {
      setStatus(error?.message || "Save Sony Woosh result failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-5 rounded-[24px] border border-white/10 bg-white/[0.035] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-xs font-black uppercase tracking-[0.18em] text-white/60">Optional: Generate synced sound effects</h3>
          <p className="mt-2 text-sm text-white/55">
            Sony Woosh generates Foley / environmental sound effects from the selected video. SFX duration now follows the selected video length. Current VFlow/DVFlow models are 8-second models unless your install supports a higher OTG_WOOSH_MAX_SECONDS value.
          </p>
        </div>
        <div className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-cyan-50">Phase 3C</div>
      </div>

      <div className="mt-4 rounded-[18px] border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/65">
        Source video: <span className="font-semibold text-white/85">{selectedVideoName(audioVideo)}</span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
        <div>
          <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Sound effects prompt / keywords</label>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="mt-2 min-h-[110px] w-full resize-y rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/35 focus:border-cyan-300/40"
            placeholder="Example: footsteps on concrete, coat rustle, distant traffic, soft room tone, door creak"
          />
        </div>
        <div className="grid gap-3">
          <div>
            <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Model</label>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value as "vflow" | "dvflow")}
              className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/40"
            >
              <option value="vflow">VFlow / quality</option>
              <option value="dvflow">DVFlow / faster</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-[18px] border border-white/10 bg-black/25 px-4 py-3">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-white/45">SFX length</div>
              <div className="mt-2 text-sm font-semibold text-white">{formatDuration(effectiveDurationSeconds)}</div>
              <div className="mt-1 text-[11px] leading-4 text-white/45">Auto-matches selected video length.</div>
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Seed</label>
              <input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <label className="flex items-center justify-between gap-3 rounded-[18px] border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/75">
          <span>Keep original video audio</span>
          <input type="checkbox" checked={keepOriginalAudio} onChange={(event) => setKeepOriginalAudio(event.target.checked)} />
        </label>
        <div className="rounded-[18px] border border-white/10 bg-black/25 px-4 py-3">
          <div className="flex items-center justify-between text-sm text-white/75">
            <span>Original audio volume</span>
            <span>{originalVolume}%</span>
          </div>
          <input type="range" min="0" max="150" value={originalVolume} disabled={!keepOriginalAudio} onChange={(event) => setOriginalVolume(Number(event.target.value))} className="mt-3 w-full" />
        </div>
        <div className="rounded-[18px] border border-white/10 bg-black/25 px-4 py-3">
          <div className="flex items-center justify-between text-sm text-white/75">
            <span>Sound effects volume</span>
            <span>{sfxVolume}%</span>
          </div>
          <input type="range" min="0" max="150" value={sfxVolume} onChange={(event) => setSfxVolume(Number(event.target.value))} className="mt-3 w-full" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void generateWooshSfx()}
          disabled={!canRun}
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-5 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Generating..." : "Generate Sound Effects"}
        </button>
        <p className="text-sm text-white/50">Woosh is best for Foley and environment sound, not speech/dialogue.</p>
      </div>

      {status ? <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">{status}</div> : null}

      {result?.url ? (
        <div className="mt-4 rounded-[20px] border border-white/10 bg-black/35 p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="break-words text-sm font-black text-white">{result.fileName}</p>
              <p className="mt-1 text-xs text-white/45">SFX window: {formatDuration(result.sfxDurationSeconds || result.durationSeconds)}</p>
              <p className="mt-1 text-xs text-white/45">Model: {String(result.model || model).toUpperCase()} • Duration: {formatDuration(result.durationSeconds)} • Size: {formatBytes(result.sizeBytes)}</p>
            </div>
            {result.width && result.height ? <p className="text-xs text-white/45">{result.width}x{result.height}</p> : null}
          </div>
          <div className="mt-3 overflow-hidden rounded-[18px] border border-white/10 bg-black/60">
            <video src={result.url} controls preload="metadata" className="aspect-video w-full object-contain" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={withDownload(result.url)} className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">Download MP4</a>
            <button type="button" onClick={() => void saveWooshResult()} disabled={saving || result.saved} className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50">{result.saved ? "Saved to Gallery" : saving ? "Saving..." : "Save to Gallery"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
