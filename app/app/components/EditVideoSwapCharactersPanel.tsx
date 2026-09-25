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
  engine?: SwapEngine;
  prompt?: string;
  recipe?: Record<string, unknown>;
  swaps?: Array<Record<string, unknown>>;
  safety?: { inferenceSubmitted?: boolean; note?: string };
  error?: string;
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

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function EditVideoSwapCharactersPanel(_props: Props) {
  void _props;
  const [engine, setEngine] = React.useState<SwapEngine>("scail2");
  const [selectedVideo, setSelectedVideo] = React.useState<SelectedVideo | null>(null);
  const [galleryOpen, setGalleryOpen] = React.useState(false);
  const [galleryBusy, setGalleryBusy] = React.useState(false);
  const [galleryError, setGalleryError] = React.useState("");
  const [galleryVideos, setGalleryVideos] = React.useState<GalleryVideoItem[]>([]);
  const [rows, setRows] = React.useState<SwapRow[]>(() => [createRow(1)]);
  const [outputTitle, setOutputTitle] = React.useState("character_swap_preview");
  const [previewSeconds, setPreviewSeconds] = React.useState(5);
  const [preserveAudio, setPreserveAudio] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [plan, setPlan] = React.useState<PlanResult | null>(null);

  React.useEffect(() => {
    return () => {
      if (selectedVideo?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(selectedVideo.previewUrl);
      rows.forEach((row) => {
        if (row.replacementPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(row.replacementPreviewUrl);
      });
    };
  }, [rows, selectedVideo]);

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
    if (selectedVideo?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(selectedVideo.previewUrl);
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
    setOutputTitle(cleanTitle(displayVideoName(item)) || "character_swap_preview");
    setGalleryOpen(false);
    setPlan(null);
    setStatus("Selected source video for character swapping.");
  }

  function onUploadVideo(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("video/") && !/\.(mp4|webm|mov|mkv|avi)$/i.test(file.name || "")) {
      setStatus("Use a video file: MP4, WEBM, MOV, MKV, or AVI.");
      return;
    }
    if (selectedVideo?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(selectedVideo.previewUrl);
    setSelectedVideo({
      source: "upload",
      file,
      fileName: file.name || "uploaded_video.mp4",
      title: file.name || "Uploaded video",
      previewUrl: URL.createObjectURL(file),
      sizeBytes: file.size,
    });
    setOutputTitle(cleanTitle(file.name) || "character_swap_preview");
    setPlan(null);
    setStatus("Uploaded source video for character swapping.");
  }

  function patchRow(rowId: number, patch: Partial<SwapRow>) {
    setPlan(null);
    setRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) return row;
        if (patch.replacementPreviewUrl && row.replacementPreviewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(row.replacementPreviewUrl);
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
    setPlan(null);
    setRows((current) => {
      const removed = current.find((row) => row.id === rowId);
      if (removed?.replacementPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(removed.replacementPreviewUrl);
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
      replacementPreviewUrl: URL.createObjectURL(file),
    });
    setStatus("Replacement image loaded.");
  }

  async function buildPlan() {
    if (!selectedVideo) {
      setStatus("Choose or upload a source video first.");
      return;
    }
    const missingReplacement = rows.find((row) => !row.replacementFile);
    if (missingReplacement) {
      setStatus(`Upload a replacement image for ${missingReplacement.replacementLabel}.`);
      return;
    }

    const form = new FormData();
    form.set("engine", engine);
    form.set("video_source", selectedVideo.source);
    form.set("video_name", selectedVideo.fileName);
    form.set("video_title", selectedVideo.title);
    form.set("video_scope", selectedVideo.scope || "");
    form.set("output_title", cleanTitle(outputTitle) || "character_swap_preview");
    form.set("preview_seconds", String(previewSeconds));
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

    setBusy(true);
    setPlan(null);
    setStatus("Building character swap test recipe...");
    try {
      const response = await fetch("/api/edit-video/swap-characters/plan", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as PlanResult;
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Swap plan failed.");
      setPlan(data);
      setStatus("Test recipe is ready. No ComfyUI inference was submitted.");
    } catch (error: unknown) {
      setStatus(errorMessage(error, "Swap plan failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[28px] border border-white/10 bg-black/45 p-4 md:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white/78">Swap Characters</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
            Test the new character-swap flow with a source video, replacement pictures, and explicit source-to-reference mappings. This first pass builds the ComfyUI recipe only.
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
                setPlan(null);
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
            <label className="rounded-[18px] border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/75">
              <span className="block">Preview seconds</span>
              <input
                type="number"
                min={1}
                max={15}
                value={previewSeconds}
                onChange={(event) => setPreviewSeconds(Math.max(1, Math.min(15, Number(event.target.value) || 5)))}
                className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/45 px-3 py-2 text-white outline-none focus:border-cyan-300/40"
              />
            </label>
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
            onClick={() => void buildPlan()}
            disabled={busy || !selectedVideo}
            className={cn(
              "mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-full px-5 py-3 text-base font-black transition",
              busy || !selectedVideo
                ? "cursor-not-allowed border border-white/10 bg-white/5 text-white/35"
                : "border border-purple-300/30 bg-[linear-gradient(90deg,rgba(145,92,255,0.75),rgba(40,200,255,0.45))] text-white shadow-[0_0_28px_rgba(120,95,255,0.22)] hover:brightness-110",
            )}
          >
            {busy ? "Building Test Recipe..." : "Build Test Recipe"}
          </button>

          {status ? <div className="mt-4 rounded-[18px] border border-white/10 bg-black/35 px-4 py-3 text-sm text-white/70">{status}</div> : null}
        </div>
      </div>

      {plan ? (
        <div className="mt-5 rounded-[24px] border border-cyan-400/15 bg-cyan-400/[0.04] p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/70">Generated test recipe</p>
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
