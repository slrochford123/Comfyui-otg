"use client";

import React from "react";

type ExtractMode = "raw" | "enhance";

type ExtractResult = {
  jobId: string;
  fileName: string;
  url: string;
  mode: ExtractMode;
  sizeBytes?: number;
  durationSeconds?: number;
};

type VoiceGalleryItem = {
  fileName: string;
  url: string;
  mode?: ExtractMode;
  sourceVideoName?: string;
  durationSeconds?: number;
  sizeBytes?: number;
  createdAt?: string;
};

function cleanName(value: string) {
  return (
    String(value || "extracted_voice_audio")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-zA-Z0-9._ -]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "extracted_voice_audio"
  );
}

function withDownload(url: string) {
  if (!url) return "#";
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "Unknown";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatBytes(bytes?: number) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "Unknown";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export default function EditVideoExtractAudioPanel({ onSaved }: { onSaved?: () => void }) {
  const [mode, setMode] = React.useState<ExtractMode>("raw");
  const [videoFile, setVideoFile] = React.useState<File | null>(null);
  const [videoUrl, setVideoUrl] = React.useState("");
  const [outputName, setOutputName] = React.useState("extracted_voice_audio");
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [result, setResult] = React.useState<ExtractResult | null>(null);
  const [libraryBusy, setLibraryBusy] = React.useState(false);
  const [libraryError, setLibraryError] = React.useState("");
  const [libraryItems, setLibraryItems] = React.useState<VoiceGalleryItem[]>([]);

  React.useEffect(() => {
    void loadLibrary();
    return () => {
      if (videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setVideo(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("video/") && !/\.(mp4|webm|mov|mkv)$/i.test(file.name)) {
      setStatus("Select a video file only.");
      return;
    }
    if (videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
    setResult(null);
    setStatus("");
    if (!outputName || outputName === "extracted_voice_audio") {
      setOutputName(cleanName(file.name));
    }
  }

  async function loadLibrary() {
    setLibraryBusy(true);
    setLibraryError("");
    try {
      const response = await fetch("/api/edit-video/extract-audio/library", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Voice gallery load failed.");
      setLibraryItems(Array.isArray(data?.items) ? data.items : []);
    } catch (error: any) {
      setLibraryError(error?.message || "Voice gallery load failed.");
    } finally {
      setLibraryBusy(false);
    }
  }

  async function extractAudio() {
    if (!videoFile) {
      setStatus("Upload a video first.");
      return;
    }
    const form = new FormData();
    form.append("video", videoFile, videoFile.name);
    form.append("mode", mode);
    form.append("title", cleanName(outputName));
    setBusy(true);
    setResult(null);
    setStatus(mode === "enhance" ? "Extracting and enhancing audio..." : "Extracting raw audio...");
    try {
      const response = await fetch("/api/edit-video/extract-audio", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Audio extraction failed.");
      const nextResult: ExtractResult = {
        jobId: String(data.jobId || ""),
        fileName: String(data.fileName || "extracted_audio.wav"),
        url: String(data.url || ""),
        mode: data.mode === "enhance" ? "enhance" : "raw",
        durationSeconds: Number(data.durationSeconds || 0) || undefined,
        sizeBytes: Number(data.sizeBytes || 0) || undefined,
      };
      setResult(nextResult);
      setStatus(data?.message || "Audio extracted and saved to the voice gallery.");
      await loadLibrary();
      onSaved?.();
    } catch (error: any) {
      setStatus(error?.message || "Audio extraction failed.");
    } finally {
      setBusy(false);
    }
  }

  const modeLabel = mode === "enhance" ? "Extract Audio + Enhance" : "Extract Audio";

  return (
    <section className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_40px_rgba(80,80,180,0.08)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.24em] text-white/55">Extract Audio</p>
          <h2 className="mt-1 text-2xl font-black text-white">Video to voice gallery</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-white/58">
            Extract audio from a video and save it into the local voices gallery. Use raw extraction for clean source audio, or enhance to reduce noise and normalize loudness.
          </p>
        </div>
        <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-cyan-100">FFmpeg</span>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode("raw")}
          className={`inline-flex min-h-10 items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition ${mode === "raw" ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-50" : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10"}`}
        >
          Extract Audio
        </button>
        <button
          type="button"
          onClick={() => setMode("enhance")}
          className={`inline-flex min-h-10 items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition ${mode === "enhance" ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-50" : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10"}`}
        >
          Extract Audio + Enhance
        </button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded-[22px] border border-white/10 bg-black/30 p-4">
          <h3 className="text-sm font-black text-white">Step 1: Select video</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer rounded-full border border-cyan-400/20 bg-cyan-400/10 px-5 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-400/15">
              Upload Video
              <input
                type="file"
                accept="video/*,.mp4,.webm,.mov,.mkv"
                className="hidden"
                onChange={(event) => {
                  setVideo(event.target.files?.[0] || null);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setVideoFile(null);
                if (videoUrl.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
                setVideoUrl("");
                setResult(null);
                setStatus("");
              }}
              className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-semibold text-white hover:bg-white/10"
            >
              Clear
            </button>
          </div>
          {videoUrl ? (
            <div className="mt-4 overflow-hidden rounded-[20px] border border-white/10 bg-black/60">
              <video src={videoUrl} controls preload="metadata" className="max-h-[420px] w-full object-contain" />
            </div>
          ) : (
            <div className="mt-4 rounded-[18px] border border-white/10 bg-black/35 px-4 py-8 text-center text-sm text-white/45">No video selected.</div>
          )}
          <p className="mt-3 break-words text-xs text-white/55">{videoFile?.name || "Upload MP4, WebM, MOV, or MKV."}</p>
        </div>

        <div className="rounded-[22px] border border-white/10 bg-black/30 p-4">
          <h3 className="text-sm font-black text-white">Step 2: Output</h3>
          <label className="mt-3 block text-xs font-black uppercase tracking-[0.18em] text-white/45">Output name</label>
          <input
            value={outputName}
            onChange={(event) => setOutputName(cleanName(event.target.value))}
            className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none"
          />
          <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.035] p-3 text-xs leading-5 text-white/58">
            <p>Mode: {modeLabel}</p>
            <p>Output: {(cleanName(outputName) || "extracted_voice_audio")}.wav</p>
            <p>Destination: local voices gallery</p>
          </div>
          <button
            type="button"
            onClick={() => void extractAudio()}
            disabled={busy || !videoFile}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-5 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Working..." : modeLabel}
          </button>
        </div>
      </div>

      {status ? <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">{status}</div> : null}

      {result?.url ? (
        <div className="mt-5 rounded-[22px] border border-white/10 bg-black/30 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Latest extracted audio</p>
              <h3 className="mt-1 break-words text-lg font-black text-white">{result.fileName}</h3>
            </div>
            <div className="text-xs leading-5 text-white/52 md:text-right">
              <p>Mode: {result.mode === "enhance" ? "Enhanced" : "Raw"}</p>
              <p>Duration: {formatDuration(result.durationSeconds)}</p>
              <p>Size: {formatBytes(result.sizeBytes)}</p>
            </div>
          </div>
          <audio src={result.url} controls preload="metadata" className="mt-3 w-full" />
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={withDownload(result.url)} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">Download</a>
            <button type="button" onClick={() => void loadLibrary()} className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-400/15">Refresh Voice Gallery</button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 rounded-[22px] border border-white/10 bg-black/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-white">Voices gallery</h3>
            <p className="mt-1 text-xs text-white/50">Extracted audio files are saved here for later voice work.</p>
          </div>
          <button type="button" onClick={() => void loadLibrary()} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white/75 hover:bg-white/10">Refresh</button>
        </div>
        {libraryBusy ? <p className="mt-4 text-sm text-white/55">Loading voices gallery...</p> : null}
        {libraryError ? <div className="mt-4 rounded-[18px] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100/85">{libraryError}</div> : null}
        {!libraryBusy && !libraryError && libraryItems.length === 0 ? (
          <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/62">No extracted voice audio yet.</div>
        ) : null}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {libraryItems.map((item) => (
            <div key={`${item.fileName}:${item.createdAt || ""}`} className="rounded-[20px] border border-white/10 bg-black/35 p-3">
              <p className="break-words text-sm font-black text-white">{item.fileName}</p>
              <p className="mt-1 text-xs text-white/45">{item.mode === "enhance" ? "Enhanced" : "Raw"} | {formatDuration(item.durationSeconds)} | {formatBytes(item.sizeBytes)}</p>
              {item.sourceVideoName ? <p className="mt-1 break-words text-xs text-white/42">Source: {item.sourceVideoName}</p> : null}
              <audio src={item.url} controls preload="metadata" className="mt-3 w-full" />
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={withDownload(item.url)} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10">Download</a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
