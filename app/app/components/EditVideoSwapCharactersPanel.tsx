"use client";

import React from "react";
import { cn } from "@/lib/cn";

type GalleryVideoItem = {
  fileName?: string;
  name?: string;
  sourceName?: string;
  url?: string;
  video?: boolean;
  kind?: "image" | "video";
  source?: "user" | "device" | string;
  scope?: string;
  sizeBytes?: number;
  size?: number;
  meta?: {
    renamedName?: string | null;
    originalName?: string | null;
    durationSeconds?: number | null;
    width?: number | null;
    height?: number | null;
  };
};

type SelectedVideo = {
  source: "upload" | "gallery";
  file?: File;
  fileName: string;
  title: string;
  previewUrl: string;
  scope?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  sizeBytes?: number;
};

type SwapEngine = "scail2" | "minimax-h3";

type SwapRow = {
  id: number;
  sourceLabel: string;
  sourceSelector: string;
  replacementLabel: string;
  replacementFile: File | null;
  replacementPreviewUrl: string;
  notes: string;
};

type PlanResult = {
  ok?: boolean;
  mode?: "planning" | "submitted";
  engine?: SwapEngine;
  prompt?: string;
  recipe?: Record<string, unknown>;
  selectedClip?: {
    startSeconds?: number;
    durationSeconds?: number;
  };
  swaps?: Array<Record<string, unknown>>;
  safety?: { inferenceSubmitted?: boolean; note?: string };
  error?: string;
};

type SwapVideoResult = {
  status?: string;
  engine?: SwapEngine;
  backend?: string;
  backendLabel?: string | null;
  jobId?: string;
  promptId?: string | null;
  fileName?: string;
  url?: string | null;
  videoUrl?: string | null;
  galleryUrl?: string | null;
  galleryFileName?: string | null;
  sizeBytes?: number;
};

type H3JobStatus = {
  id: string;
  status: string;
  statusMessage?: string;
  progressPercent?: number | null;
  backendLabel?: string | null;
  promptId?: string | null;
  videoUrl?: string | null;
  galleryUrl?: string | null;
  galleryFileName?: string | null;
  error?: string | null;
};

type SubmitResponse = {
  ok?: boolean;
  mode?: "submitted" | "completed";
  engine?: SwapEngine;
  plan?: PlanResult;
  result?: SwapVideoResult;
  job?: H3JobStatus;
  error?: string;
  stage?: string;
};

type Props = {
  onRefreshGallery?: () => void;
};

const engineCopy: Record<SwapEngine, { label: string; summary: string; bestFor: string }> = {
  scail2: {
    label: "SCAIL-2",
    summary: "Mask-guided character replacement with SAM3 tracking and colored correspondence masks.",
    bestFor: "Best default when you can clearly identify each person in the source video.",
  },
  "minimax-h3": {
    label: "MiniMax H3",
    summary: "Reference-to-video generation using the source clip plus replacement pictures.",
    bestFor: "Best alternate when you want a more generative reinterpretation or SCAIL tracking struggles.",
  },
};
const SWAP_WORKFLOW_CLIP_SECONDS = 5;

function createRow(id: number): SwapRow {
  const sourceIndex = (id - 1) * 2;
  return {
    id,
    sourceLabel: `Character ${String.fromCharCode(65 + sourceIndex)}`,
    sourceSelector: id === 1 ? "left person in the video" : id === 2 ? "center person in the video" : "right person in the video",
    replacementLabel: `Character ${String.fromCharCode(66 + sourceIndex)}`,
    replacementFile: null,
    replacementPreviewUrl: "",
    notes: "",
  };
}

function galleryLookupName(item: GalleryVideoItem) {
  return String(item.fileName || item.sourceName || item.name || "").trim();
}

function displayVideoName(item: GalleryVideoItem) {
  return String(item.meta?.renamedName || item.name || item.sourceName || item.fileName || "Gallery video").trim();
}

function isVideoItem(item: GalleryVideoItem) {
  const name = galleryLookupName(item).toLowerCase();
  return Boolean(item.video || item.kind === "video" || /\.(mp4|webm|mov|mkv|avi)$/i.test(name));
}

function cleanTitle(value: string) {
  return String(value || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function formatDuration(value?: number | null) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "Unknown";
  if (seconds < 60) return `${seconds.toFixed(1)} sec`;
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rem}`;
}

function formatClipSeconds(value: number) {
  return `${Math.max(0, value).toFixed(2)}s`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function EditVideoSwapCharactersPanel({ onRefreshGallery }: Props) {
  const [engine, setEngine] = React.useState<SwapEngine>("scail2");
  const [h3Backend, setH3Backend] = React.useState<"rtx3090" | "rtx5060ti">("rtx3090");
  const [selectedVideo, setSelectedVideo] = React.useState<SelectedVideo | null>(null);
  const [galleryOpen, setGalleryOpen] = React.useState(false);
  const [galleryBusy, setGalleryBusy] = React.useState(false);
  const [galleryError, setGalleryError] = React.useState("");
  const [galleryVideos, setGalleryVideos] = React.useState<GalleryVideoItem[]>([]);
  const [rows, setRows] = React.useState<SwapRow[]>(() => [createRow(1)]);
  const [outputTitle, setOutputTitle] = React.useState("character_swap_preview");
  const [clipStartSeconds, setClipStartSeconds] = React.useState(0);
  const [preserveAudio, setPreserveAudio] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const submitInFlight = React.useRef(false);
  const [status, setStatus] = React.useState("");
  const [plan, setPlan] = React.useState<PlanResult | null>(null);
  const [result, setResult] = React.useState<SwapVideoResult | null>(null);
  const [h3Job, setH3Job] = React.useState<H3JobStatus | null>(null);
  const sourceVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const objectUrlsRef = React.useRef<Set<string>>(new Set());
  const sourceDurationSeconds = Number(selectedVideo?.durationSeconds || 0);
  const clipMaxStart = Math.max(0, sourceDurationSeconds - SWAP_WORKFLOW_CLIP_SECONDS);
  const clampedClipStartSeconds = Math.min(Math.max(0, clipStartSeconds), clipMaxStart);
  const clipCanRender = !sourceDurationSeconds || sourceDurationSeconds >= SWAP_WORKFLOW_CLIP_SECONDS;

  React.useEffect(() => {
    const objectUrls = objectUrlsRef.current;
    return () => {
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.clear();
    };
  }, []);

  function createObjectUrl(file: File) {
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.add(url);
    return url;
  }

  function revokeObjectUrl(url?: string) {
    if (!url?.startsWith("blob:")) return;
    URL.revokeObjectURL(url);
    objectUrlsRef.current.delete(url);
  }

  function clearOutputs() {
    setPlan(null);
    setResult(null);
    setH3Job(null);
  }

  React.useEffect(() => {
    setClipStartSeconds((current) => Math.min(Math.max(0, current), clipMaxStart));
  }, [clipMaxStart]);

  function selectClipStartSeconds(value: number) {
    const next = Math.min(Math.max(0, Number(value) || 0), clipMaxStart);
    setClipStartSeconds(next);
    clearOutputs();
    const video = sourceVideoRef.current;
    if (video && Number.isFinite(video.duration)) {
      try {
        video.currentTime = next;
      } catch {}
    }
  }

  async function loadGalleryVideos() {
    setGalleryOpen(true);
    setGalleryBusy(true);
    setGalleryError("");
    try {
      const response = await fetch("/api/gallery?media=videos&sort=newest&per=5000", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Gallery videos could not be loaded.");
      const raw = Array.isArray(data?.items) ? data.items : Array.isArray(data?.files) ? data.files : [];
      setGalleryVideos(raw.filter(isVideoItem));
    } catch (error: unknown) {
      setGalleryError(errorMessage(error, "Gallery videos could not be loaded."));
      setGalleryVideos([]);
    } finally {
      setGalleryBusy(false);
    }
  }

  function selectGalleryVideo(item: GalleryVideoItem) {
    const name = galleryLookupName(item);
    const url = String(item.url || "");
    if (!name || !url) {
      setGalleryError("Selected Gallery item is missing a file name or URL.");
      return;
    }
    revokeObjectUrl(selectedVideo?.previewUrl);
    setSelectedVideo({
      source: "gallery",
      fileName: name,
      title: displayVideoName(item),
      previewUrl: url,
      scope: String(item.source || item.scope || ""),
      durationSeconds: Number(item.meta?.durationSeconds || 0) || undefined,
      width: Number(item.meta?.width || 0) || undefined,
      height: Number(item.meta?.height || 0) || undefined,
      sizeBytes: Number(item.sizeBytes || item.size || 0) || undefined,
    });
    setClipStartSeconds(0);
    setOutputTitle(cleanTitle(displayVideoName(item)) || "character_swap_preview");
    setGalleryOpen(false);
    clearOutputs();
    setStatus("Selected source video for character swapping.");
  }

  function onUploadVideo(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("video/") && !/\.(mp4|webm|mov|mkv|avi)$/i.test(file.name || "")) {
      setStatus("Use a video file: MP4, WEBM, MOV, MKV, or AVI.");
      return;
    }
    revokeObjectUrl(selectedVideo?.previewUrl);
    setSelectedVideo({
      source: "upload",
      file,
      fileName: file.name || "uploaded_video.mp4",
      title: file.name || "Uploaded video",
      previewUrl: createObjectUrl(file),
      sizeBytes: file.size,
    });
    setClipStartSeconds(0);
    setOutputTitle(cleanTitle(file.name) || "character_swap_preview");
    clearOutputs();
    setStatus("Uploaded source video for character swapping.");
  }

  function patchRow(rowId: number, patch: Partial<SwapRow>) {
    clearOutputs();
    setRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) return row;
        if (patch.replacementPreviewUrl && row.replacementPreviewUrl?.startsWith("blob:")) {
          revokeObjectUrl(row.replacementPreviewUrl);
        }
        return { ...row, ...patch };
      }),
    );
  }

  function addRow() {
    if (rows.length >= 3) return;
    setRows((current) => [...current, createRow(current.length + 1)]);
  }

  function removeRow(rowId: number) {
    if (rows.length <= 1) return;
    clearOutputs();
    setRows((current) => {
      const removed = current.find((row) => row.id === rowId);
      revokeObjectUrl(removed?.replacementPreviewUrl);
      return current.filter((row) => row.id !== rowId).map((row, index) => ({ ...row, id: index + 1 }));
    });
  }

  function setReplacement(rowId: number, file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp)$/i.test(file.name || "")) {
      setStatus("Use a replacement image: PNG, JPG, JPEG, or WEBP.");
      return;
    }
    patchRow(rowId, {
      replacementFile: file,
      replacementPreviewUrl: createObjectUrl(file),
    });
    setStatus("Replacement image loaded.");
  }

  async function pollH3Job(jobId: string) {
    const deadline = Date.now() + 90 * 60 * 1000;

    while (Date.now() < deadline) {
      await wait(4000);
      const response = await fetch(`/api/h3/generation?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; job?: H3JobStatus; error?: string };
      if (!response.ok || data?.ok === false || !data.job) throw new Error(data?.error || "MiniMax H3 status check failed.");

      const job = data.job;
      setH3Job(job);
      const progress = Number(job.progressPercent || 0);
      setStatus(`${job.backendLabel || "MiniMax H3"}: ${job.statusMessage || job.status}${progress ? ` (${Math.round(progress)}%)` : ""}`);

      if (job.status === "completed") {
        const videoUrl = job.videoUrl || job.galleryUrl || "";
        setResult({
          status: "completed",
          engine: "minimax-h3",
          backendLabel: job.backendLabel,
          jobId: job.id,
          promptId: job.promptId,
          url: videoUrl,
          videoUrl: job.videoUrl,
          galleryUrl: job.galleryUrl,
          galleryFileName: job.galleryFileName,
        });
        onRefreshGallery?.();
        setStatus("MiniMax H3 character-swap video is ready.");
        return;
      }

      if (["failed", "canceled"].includes(job.status)) {
        throw new Error(job.error || job.statusMessage || `MiniMax H3 job ${job.status}.`);
      }
    }

    throw new Error("Timed out waiting for MiniMax H3 character-swap video.");
  }

  async function submitSwap() {
    if (submitInFlight.current) return;
    if (!selectedVideo) {
      setStatus("Choose or upload a source video first.");
      return;
    }
    const missingReplacement = rows.find((row) => !row.replacementFile);
    if (missingReplacement) {
      setStatus(`Upload a replacement image for ${missingReplacement.replacementLabel}.`);
      return;
    }
    if (!clipCanRender) {
      setStatus(`Source video must be at least ${SWAP_WORKFLOW_CLIP_SECONDS} seconds long.`);
      return;
    }

    const form = new FormData();
    form.set("engine", engine);
    if (engine === "minimax-h3") form.set("targetBackend", h3Backend);
    form.set("video_source", selectedVideo.source);
    form.set("video_name", selectedVideo.fileName);
    form.set("video_title", selectedVideo.title);
    form.set("video_scope", selectedVideo.scope || "");
    form.set("output_title", cleanTitle(outputTitle) || "character_swap_preview");
    form.set("preview_seconds", String(SWAP_WORKFLOW_CLIP_SECONDS));
    form.set("clip_start_seconds", clampedClipStartSeconds.toFixed(3));
    form.set("clip_duration_seconds", String(SWAP_WORKFLOW_CLIP_SECONDS));
    form.set("preserve_audio", preserveAudio ? "true" : "false");
    form.set("swap_count", String(rows.length));
    if (selectedVideo.source === "upload" && selectedVideo.file) {
      form.set("video_file", selectedVideo.file, selectedVideo.file.name || "uploaded_video.mp4");
    }

    rows.forEach((row, index) => {
      form.set(`swap_${index}_source_label`, row.sourceLabel);
      form.set(`swap_${index}_source_selector`, row.sourceSelector);
      form.set(`swap_${index}_replacement_label`, row.replacementLabel);
      form.set(`swap_${index}_replacement_name`, row.replacementFile?.name || "");
      form.set(`swap_${index}_notes`, row.notes);
      if (row.replacementFile) {
        form.set(`replacement_${index}_file`, row.replacementFile, row.replacementFile.name);
      }
    });

    submitInFlight.current = true;
    setBusy(true);
    clearOutputs();
    setStatus(`Submitting ${formatClipSeconds(clampedClipStartSeconds)}-${formatClipSeconds(clampedClipStartSeconds + SWAP_WORKFLOW_CLIP_SECONDS)} character swap clip to ComfyUI...`);
    try {
      const response = await fetch("/api/edit-video/swap-characters/submit", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as SubmitResponse;
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Swap plan failed.");
      if (data.plan) setPlan(data.plan);
      if (data.result) {
        setResult(data.result);
        onRefreshGallery?.();
        setStatus(`${engineCopy[data.result.engine || engine].label} character-swap video is ready.`);
        return;
      }
      if (data.job?.id) {
        setH3Job(data.job);
        setStatus(`${data.job.backendLabel || "MiniMax H3"} queued. Waiting for ComfyUI output...`);
        await pollH3Job(data.job.id);
        return;
      }
      throw new Error("Swap submission returned no video result or job.");
    } catch (error: unknown) {
      setStatus(errorMessage(error, "Swap submission failed."));
    } finally {
      submitInFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[28px] border border-white/10 bg-black/45 p-4 md:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white/78">Swap Characters</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
            Choose a source video and replacement pictures, identify who to replace, then generate the edited video.
          </p>
        </div>
        <div className="w-full max-w-sm">
          <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Output name</label>
          <input
            value={outputTitle}
            onChange={(event) => setOutputTitle(cleanTitle(event.target.value))}
            className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-300/40"
            placeholder="character_swap_preview"
          />
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {(Object.keys(engineCopy) as SwapEngine[]).map((id) => {
          const active = engine === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                setEngine(id);
                clearOutputs();
              }}
              className={cn(
                "rounded-[22px] border p-4 text-left transition",
                active
                  ? "border-cyan-300/40 bg-cyan-400/10 shadow-[0_0_28px_rgba(34,211,238,0.08)]"
                  : "border-white/10 bg-white/[0.035] hover:bg-white/[0.06]",
              )}
            >
              <span className="text-lg font-black text-white">{engineCopy[id].label}</span>
              <span className="mt-2 block text-sm leading-6 text-white/62">{engineCopy[id].summary}</span>
              <span className="mt-3 block rounded-[16px] border border-white/10 bg-black/30 px-3 py-2 text-xs leading-5 text-white/52">{engineCopy[id].bestFor}</span>
            </button>
          );
        })}
      </div>

      {engine === "minimax-h3" ? (
        <div className="mt-5 rounded-[22px] border border-white/10 bg-white/[0.035] p-4">
          <label htmlFor="swap-h3-backend" className="text-xs font-black uppercase tracking-[0.18em] text-white/70">MiniMax H3 GPU</label>
          <select
            id="swap-h3-backend"
            value={h3Backend}
            disabled={busy}
            onChange={(event) => {
              const backend = event.target.value;
              if (backend !== "rtx3090" && backend !== "rtx5060ti") return;
              setH3Backend(backend);
              clearOutputs();
            }}
            className="mt-2 min-h-11 w-full rounded-[16px] border border-white/15 bg-slate-950 px-3 py-2 text-base text-white"
          >
            <option value="rtx3090">RTX 3090</option>
            <option value="rtx5060ti">RTX 5060 Ti</option>
          </select>
          <p className="mt-2 text-sm text-white/60">Only the selected GPU is used. There is no automatic GPU fallback.</p>
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="rounded-[24px] border border-white/10 bg-white/[0.035] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/60">Step 1</p>
              <h3 className="mt-1 text-xl font-black text-white">Choose source video</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                Upload Video
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,video/x-matroska,video/*"
                  className="hidden"
                  onChange={(event) => {
                    onUploadVideo(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => void loadGalleryVideos()}
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15"
              >
                Choose from Gallery
              </button>
            </div>
          </div>

          {selectedVideo ? (
            <div className="mt-4 rounded-[20px] border border-white/10 bg-black/35 p-3">
              <video
                ref={sourceVideoRef}
                src={selectedVideo.previewUrl}
                controls
                preload="metadata"
                className="aspect-video w-full rounded-[16px] bg-black object-contain"
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  setSelectedVideo((current) =>
                    current
                      ? {
                          ...current,
                          durationSeconds: Number.isFinite(video.duration) ? video.duration : current.durationSeconds,
                          width: video.videoWidth || current.width,
                          height: video.videoHeight || current.height,
                        }
                      : current,
                  );
                }}
              />
              <p className="mt-3 break-words text-sm font-bold text-white">{selectedVideo.title}</p>
              <p className="mt-1 text-xs text-white/45">
                Source: {selectedVideo.source} | Duration: {formatDuration(selectedVideo.durationSeconds)}
              </p>
              <div className="mt-3 rounded-[18px] border border-cyan-300/20 bg-cyan-300/[0.06] p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/85">5-second workflow clip</p>
                    <p className="mt-1 text-xs text-white/45">Only this window is sent to ComfyUI.</p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-black/35 px-3 py-1 text-xs font-bold text-white/72">
                    {formatClipSeconds(clampedClipStartSeconds)} - {formatClipSeconds(clampedClipStartSeconds + SWAP_WORKFLOW_CLIP_SECONDS)}
                  </span>
                </div>
                <input
                  aria-label="Swap Characters five-second clip start time"
                  className="mt-3 w-full"
                  type="range"
                  min={0}
                  max={clipMaxStart}
                  step="0.05"
                  value={clampedClipStartSeconds}
                  disabled={!clipCanRender}
                  onChange={(event) => selectClipStartSeconds(Number(event.target.value))}
                />
                <div className="mt-1 flex justify-between text-[11px] text-white/40">
                  <span>0.00s</span>
                  <span>{sourceDurationSeconds > 0 ? `${formatClipSeconds(sourceDurationSeconds)} source` : "Reading video length..."}</span>
                </div>
                {sourceDurationSeconds > 0 && !clipCanRender ? (
                  <p className="mt-2 rounded-[12px] border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                    Source video must be at least {SWAP_WORKFLOW_CLIP_SECONDS} seconds.
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-[20px] border border-dashed border-white/15 bg-black/25 p-5 text-sm text-white/55">
              Start with a short clip where each person is visible and easy to describe.
            </div>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex min-h-[54px] items-center justify-between gap-3 rounded-[18px] border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/75">
              <span>Preserve original audio</span>
              <input type="checkbox" checked={preserveAudio} onChange={(event) => setPreserveAudio(event.target.checked)} />
            </label>
            <div className="flex min-h-[54px] items-center justify-between gap-3 rounded-[18px] border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/75">
              <span>Workflow clip length</span>
              <span className="font-black text-cyan-100">{SWAP_WORKFLOW_CLIP_SECONDS} sec</span>
            </div>
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white/[0.035] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/60">Step 2</p>
              <h3 className="mt-1 text-xl font-black text-white">Map source people to pictures</h3>
            </div>
            <button
              type="button"
              onClick={addRow}
              disabled={rows.length >= 3}
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Add Person
            </button>
          </div>

          <div className="mt-4 space-y-4">
            {rows.map((row) => (
              <div key={row.id} className="rounded-[22px] border border-white/10 bg-black/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-black text-white">Swap {row.id}</p>
                  {rows.length > 1 ? (
                    <button type="button" onClick={() => removeRow(row.id)} className="text-xs font-semibold text-red-200/80 hover:text-red-100">
                      Remove
                    </button>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="block text-xs font-black uppercase tracking-[0.18em] text-white/45">
                    Source label
                    <input value={row.sourceLabel} onChange={(event) => patchRow(row.id, { sourceLabel: event.target.value })} className="mt-2 w-full rounded-[16px] border border-white/10 bg-black/45 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" />
                  </label>
                  <label className="block text-xs font-black uppercase tracking-[0.18em] text-white/45">
                    Replacement label
                    <input value={row.replacementLabel} onChange={(event) => patchRow(row.id, { replacementLabel: event.target.value })} className="mt-2 w-full rounded-[16px] border border-white/10 bg-black/45 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-cyan-300/40" />
                  </label>
                </div>

                <label className="mt-3 block text-xs font-black uppercase tracking-[0.18em] text-white/45">
                  Which person in the source video?
                  <input
                    value={row.sourceSelector}
                    onChange={(event) => patchRow(row.id, { sourceSelector: event.target.value })}
                    className="mt-2 w-full rounded-[16px] border border-white/10 bg-black/45 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none placeholder:text-white/30 focus:border-cyan-300/40"
                    placeholder="left person in red jacket"
                  />
                </label>

                <div className="mt-3 grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
                  <div className="overflow-hidden rounded-[18px] border border-white/10 bg-black/55">
                    {row.replacementPreviewUrl ? (
                      <>
                        {/* Blob previews are local user-selected files; next/image cannot optimize them. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={row.replacementPreviewUrl} alt={`${row.replacementLabel} reference`} className="aspect-square w-full object-cover" />
                      </>
                    ) : (
                      <div className="flex aspect-square items-center justify-center px-3 text-center text-xs text-white/42">No replacement image</div>
                    )}
                  </div>
                  <div>
                    <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/82 transition hover:bg-white/10">
                      Upload Replacement Picture
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/*"
                        className="hidden"
                        onChange={(event) => {
                          setReplacement(row.id, event.target.files?.[0] || null);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <p className="mt-2 break-words text-xs text-white/48">{row.replacementFile?.name || "Use a clear full-body or waist-up image close to the source framing."}</p>
                    <textarea
                      value={row.notes}
                      onChange={(event) => patchRow(row.id, { notes: event.target.value })}
                      rows={3}
                      className="mt-3 w-full rounded-[16px] border border-white/10 bg-black/45 px-3 py-2 text-sm leading-5 text-white outline-none placeholder:text-white/30 focus:border-cyan-300/40"
                      placeholder="Optional notes: keep outfit, preserve hairstyle, full-body reference, etc."
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void submitSwap()}
            disabled={busy || !selectedVideo}
            className={cn(
              "mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-full px-5 py-3 text-base font-black transition",
              busy || !selectedVideo
                ? "cursor-not-allowed border border-white/10 bg-white/5 text-white/35"
                : "border border-purple-300/30 bg-[linear-gradient(90deg,rgba(145,92,255,0.75),rgba(40,200,255,0.45))] text-white shadow-[0_0_28px_rgba(120,95,255,0.22)] hover:brightness-110",
            )}
          >
            {busy ? "Generating Video..." : "Submit 5-Second Clip"}
          </button>

          {status ? <div className="mt-4 rounded-[18px] border border-white/10 bg-black/35 px-4 py-3 text-sm text-white/70">{status}</div> : null}

          {h3Job && !result ? (
            <div className="mt-4 rounded-[18px] border border-purple-300/15 bg-purple-400/[0.06] px-4 py-3 text-sm text-white/70">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{h3Job.backendLabel || "MiniMax H3"} job: {h3Job.statusMessage || h3Job.status}</span>
                <span className="text-xs text-white/48">{Math.round(Number(h3Job.progressPercent || 0))}%</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-cyan-300" style={{ width: `${Math.max(2, Math.min(100, Number(h3Job.progressPercent || 2)))}%` }} />
              </div>
            </div>
          ) : null}

          {result ? (
            <div className="mt-4 rounded-[20px] border border-emerald-300/20 bg-emerald-400/[0.06] p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-200/70">Returned video</p>
                  <p className="mt-1 text-sm font-semibold text-white">{engineCopy[result.engine || engine].label} result</p>
                </div>
                {result.galleryUrl ? (
                  <a href={result.galleryUrl} className="text-sm font-semibold text-cyan-100 underline decoration-cyan-200/40 underline-offset-4">
                    Open Gallery File
                  </a>
                ) : null}
              </div>
              {result.url || result.videoUrl || result.galleryUrl ? (
                <video
                  src={result.url || result.videoUrl || result.galleryUrl || ""}
                  controls
                  preload="metadata"
                  className="mt-4 aspect-video w-full rounded-[16px] bg-black object-contain"
                />
              ) : null}
              <div className="mt-3 grid gap-1 text-xs text-white/48 sm:grid-cols-2">
                {result.jobId ? <p className="break-all">Job: {result.jobId}</p> : null}
                {result.promptId ? <p className="break-all">Prompt: {result.promptId}</p> : null}
                {result.fileName || result.galleryFileName ? <p className="break-all">File: {result.galleryFileName || result.fileName}</p> : null}
                {result.sizeBytes ? <p>Size: {Math.max(1, Math.round(result.sizeBytes / 1024))} KB</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {plan ? (
        <div className="mt-5 rounded-[24px] border border-cyan-400/15 bg-cyan-400/[0.04] p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/70">Generation details</p>
              <h3 className="mt-1 text-2xl font-black text-white">{engineCopy[plan.engine || engine].label} swap plan</h3>
              <p className="mt-2 text-sm text-white/58">{plan.safety?.note || "No render submitted."}</p>
            </div>
            <div className="rounded-[16px] border border-white/10 bg-black/35 px-4 py-3 text-xs text-white/58">
              Inference submitted: {plan.safety?.inferenceSubmitted ? "yes" : "no"}
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div>
              <h4 className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Prompt / instruction</h4>
              <pre className="mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-[18px] border border-white/10 bg-black/45 p-4 text-xs leading-5 text-white/72">{plan.prompt}</pre>
            </div>
            <div>
              <h4 className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Backend recipe</h4>
              <pre className="mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-[18px] border border-white/10 bg-black/45 p-4 text-xs leading-5 text-white/72">{JSON.stringify(plan.recipe, null, 2)}</pre>
            </div>
          </div>
        </div>
      ) : null}

      {galleryOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/82 p-4 backdrop-blur-sm">
          <div className="mx-auto max-w-6xl rounded-[28px] border border-white/10 bg-[#080812] p-4 shadow-2xl md:p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200/70">Gallery picker</p>
                <h3 className="mt-1 text-2xl font-black text-white">Choose source video</h3>
                <p className="mt-1 text-sm text-white/55">Preview the video first, then press Use This Video.</p>
              </div>
              <button type="button" onClick={() => setGalleryOpen(false)} className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">
                Close
              </button>
            </div>

            {galleryBusy ? <p className="mt-5 text-sm text-white/60">Loading Gallery videos...</p> : null}
            {galleryError ? <div className="mt-5 rounded-[18px] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100/85">{galleryError}</div> : null}
            {!galleryBusy && !galleryError && galleryVideos.length === 0 ? <div className="mt-5 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/62">No Gallery videos found.</div> : null}

            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {galleryVideos.map((item) => {
                const name = displayVideoName(item);
                const key = `${item.source || item.scope || "gallery"}:${galleryLookupName(item)}`;
                return (
                  <div key={key} className="rounded-[22px] border border-white/10 bg-black/35 p-3">
                    <video src={item.url} controls muted preload="metadata" className="aspect-video w-full rounded-[18px] bg-black object-contain" />
                    <p className="mt-3 break-words text-sm font-semibold text-white/82">{name}</p>
                    <p className="mt-1 text-xs text-white/42">{String(item.source || item.scope || "gallery")}</p>
                    <button type="button" onClick={() => selectGalleryVideo(item)} className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15">
                      Use This Video
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
