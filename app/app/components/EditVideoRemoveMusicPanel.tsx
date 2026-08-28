"use client";

import React from "react";

type GalleryVideoItem = {
  fileName?: string;
  name?: string;
  sourceName?: string;
  url?: string;
  video?: boolean;
  kind?: "image" | "video";
  source?: "user" | "device" | string;
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

type RemoveMusicResult = {
  ok?: boolean;
  jobId?: string;
  fileName?: string;
  url?: string;
  output?: string;
  saved?: boolean;
  durationSeconds?: number;
  sizeBytes?: number;
  target?: { width?: number; height?: number };
  error?: string;
  enhanced?: boolean;
};

type EditVideoRemoveMusicPanelProps = {
  onRefreshGallery?: () => void;
};

function galleryLookupName(item: GalleryVideoItem) {
  return String(item.fileName || item.sourceName || item.name || "").trim();
}

function displayVideoName(item: GalleryVideoItem) {
  return String(item.meta?.renamedName || item.name || item.sourceName || item.fileName || "Gallery video").trim();
}

function isVideoItem(item: GalleryVideoItem) {
  const name = galleryLookupName(item).toLowerCase();
  return Boolean(item.video || item.kind === "video" || /\.(mp4|webm|mov|mkv)$/i.test(name));
}

function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "Unknown";
  const total = Math.max(0, Math.round(seconds));
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

function cleanTitle(value: string) {
  return (value || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function withDownload(url: string) {
  if (!url) return "#";
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

export default function EditVideoRemoveMusicPanel({ onRefreshGallery }: EditVideoRemoveMusicPanelProps) {
  const [selectedVideo, setSelectedVideo] = React.useState<SelectedVideo | null>(null);
  const [galleryOpen, setGalleryOpen] = React.useState(false);
  const [galleryBusy, setGalleryBusy] = React.useState(false);
  const [galleryError, setGalleryError] = React.useState("");
  const [galleryVideos, setGalleryVideos] = React.useState<GalleryVideoItem[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [saveBusy, setSaveBusy] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [outputTitle, setOutputTitle] = React.useState("cleaned_video");
  const [result, setResult] = React.useState<RemoveMusicResult | null>(null);

  React.useEffect(() => {
    if (!galleryOpen) return;

    let cancelled = false;
    setGalleryBusy(true);
    setGalleryError("");

    fetch("/api/gallery?media=videos&sort=newest&per=5000", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.ok === false) {
          throw new Error(data?.error || "Gallery videos could not be loaded.");
        }
        const rawItems = Array.isArray(data?.items) ? data.items : Array.isArray(data?.files) ? data.files : [];
        const videos = rawItems.filter(isVideoItem);
        if (!cancelled) setGalleryVideos(videos);
      })
      .catch((error) => {
        if (!cancelled) setGalleryError(error?.message || "Gallery videos could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setGalleryBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [galleryOpen]);

  React.useEffect(() => {
    return () => {
      if (selectedVideo?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(selectedVideo.previewUrl);
    };
  }, [selectedVideo]);

  function handleUpload(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("video/") && !/\.(mp4|webm|mov|mkv)$/i.test(file.name)) {
      setStatus("Select a video file only.");
      return;
    }
    if (selectedVideo?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(selectedVideo.previewUrl);
    setResult(null);
    setStatus("");
    setSelectedVideo({
      source: "upload",
      file,
      fileName: file.name,
      title: file.name,
      previewUrl: URL.createObjectURL(file),
      sizeBytes: file.size,
    });
    setOutputTitle(cleanTitle(file.name) || "cleaned_video");
  }

  function selectGalleryVideo(item: GalleryVideoItem) {
    const name = galleryLookupName(item);
    if (!name || !item.url) {
      setGalleryError("That Gallery item is missing a video URL or filename.");
      return;
    }
    if (selectedVideo?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(selectedVideo.previewUrl);
    setResult(null);
    setStatus("");
    setSelectedVideo({
      source: "gallery",
      fileName: name,
      title: displayVideoName(item),
      previewUrl: item.url,
      scope: String(item.source || "user"),
      sizeBytes: Number(item.sizeBytes || item.size || 0) || undefined,
      durationSeconds: Number(item.meta?.durationSeconds || 0) || undefined,
      width: Number(item.meta?.width || 0) || undefined,
      height: Number(item.meta?.height || 0) || undefined,
    });
    setOutputTitle(cleanTitle(displayVideoName(item)) || "cleaned_video");
    setGalleryOpen(false);
  }

  function captureMetadata(video: HTMLVideoElement) {
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
  }

  async function run(enhance: boolean) {
    if (!selectedVideo) {
      setStatus("Choose a video first.");
      return;
    }

    const form = new FormData();
    form.append("title", cleanTitle(outputTitle.trim()) || "cleaned_video");
    form.append("video_source", selectedVideo.source);
    form.append("video_title", selectedVideo.title || selectedVideo.fileName || "Selected video");
    form.append("video_duration", String(selectedVideo.durationSeconds || ""));
    form.append("video_width", String(selectedVideo.width || ""));
    form.append("video_height", String(selectedVideo.height || ""));

    if (selectedVideo.source === "upload" && selectedVideo.file) {
      form.append("video_file", selectedVideo.file, selectedVideo.file.name);
    } else {
      form.append("video_name", selectedVideo.fileName || "");
      form.append("video_scope", selectedVideo.scope || "user");
    }

    setBusy(true);
    setResult(null);
    setStatus(enhance ? "Removing music and enhancing audio..." : "Removing music...");

    try {
      const response = await fetch(enhance ? "/api/edit-video/remove-music?enhance=1" : "/api/edit-video/remove-music", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as RemoveMusicResult;
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || "Remove music failed.");
      }
      setResult({ ...data, saved: false });
      setStatus(enhance ? "Clean enhanced video is ready." : "Clean video is ready.");
    } catch (error: any) {
      setStatus(error?.message || "Remove music failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveToGallery() {
    if (!result?.jobId || !result?.fileName || result.saved) return;
    setSaveBusy(true);
    setStatus("Saving cleaned video to Gallery...");

    try {
      const response = await fetch("/api/edit-video/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: result.jobId,
          fileName: result.fileName,
          title: cleanTitle(outputTitle.trim()) || "cleaned_video",
          clipCount: 1,
          clipNames: [selectedVideo?.title || selectedVideo?.fileName || "Selected video"],
          sourceClips: [
            {
              order: 1,
              title: selectedVideo?.title || selectedVideo?.fileName || "Selected video",
              fileName: selectedVideo?.fileName || "",
              source: selectedVideo?.source || "",
              durationSeconds: selectedVideo?.durationSeconds || null,
              width: selectedVideo?.width || null,
              height: selectedVideo?.height || null,
            },
          ],
          durationSeconds: result.durationSeconds,
          sizeBytes: result.sizeBytes,
          removeMusic: true,
          enhanced: !!result.enhanced,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || "Save to Gallery failed.");
      }
      setResult((current) => (current ? { ...current, saved: true, url: String(data.url || current.url || "") } : current));
      onRefreshGallery?.();
      setStatus("Saved to Gallery.");
    } catch (error: any) {
      setStatus(error?.message || "Save to Gallery failed.");
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <section className="rounded-[28px] border border-white/10 bg-black/45 p-4 md:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white/78">Remove Music</h2>
          <p className="mt-2 text-sm leading-6 text-white/60">
            Remove unwanted LTX background music with Demucs, then rebuild the video with FFmpeg.
          </p>
        </div>
        <div className="w-full max-w-sm">
          <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Output name</label>
          <input
            value={outputTitle}
            onChange={(event) => setOutputTitle(cleanTitle(event.target.value))}
            className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-300/40"
            placeholder="cleaned_video"
          />
        </div>
      </div>

      <div className="mt-5 rounded-[24px] border border-white/10 bg-white/[0.035] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-black uppercase tracking-[0.18em] text-white/60">Step 1: Choose video</h3>
            <p className="mt-2 text-sm text-white/55">Upload a video or choose one from Gallery.</p>
          </div>
          {selectedVideo ? (
            <button
              type="button"
              onClick={() => {
                if (selectedVideo.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(selectedVideo.previewUrl);
                setSelectedVideo(null);
                setResult(null);
                setStatus("");
              }}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/72 hover:bg-white/10"
            >
              Clear
            </button>
          ) : null}
        </div>

        {selectedVideo?.previewUrl ? (
          <div className="mt-4">
            <div className="overflow-hidden rounded-[20px] border border-white/10 bg-black/60">
              <video src={selectedVideo.previewUrl} controls preload="metadata" className="max-h-[520px] w-full object-contain" onLoadedMetadata={(event) => captureMetadata(event.currentTarget)} />
            </div>
            <p className="mt-3 break-words text-sm font-semibold text-white/84">{selectedVideo.title || selectedVideo.fileName}</p>
            <div className="mt-2 grid gap-1 text-xs text-white/48 sm:grid-cols-2">
              <p>Source: {selectedVideo.source === "gallery" ? "Gallery" : "Upload"}</p>
              <p>Duration: {formatDuration(selectedVideo.durationSeconds)}</p>
              <p>Resolution: {selectedVideo.width && selectedVideo.height ? `${selectedVideo.width}x${selectedVideo.height}` : "Unknown"}</p>
              <p>Size: {formatBytes(selectedVideo.sizeBytes)}</p>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-[20px] border border-dashed border-white/10 bg-black/25 px-4 py-8 text-center text-sm text-white/45">
            No video selected.
          </div>
        )}

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/82 transition hover:bg-white/10">
            Upload Video
            <input
              type="file"
              accept="video/*,.mp4,.webm,.mov,.mkv"
              className="hidden"
              onChange={(event) => {
                handleUpload(event.target.files?.[0] || null);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => setGalleryOpen(true)}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15"
          >
            Gallery Video
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-[24px] border border-white/10 bg-white/[0.035] p-4">
        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-white/60">Step 2: Clean audio</h3>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void run(false)}
            disabled={busy || !selectedVideo}
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-5 py-3 text-base font-semibold text-cyan-50 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Processing..." : "Remove Music"}
          </button>
          <button
            type="button"
            onClick={() => void run(true)}
            disabled={busy || !selectedVideo}
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-purple-400/20 bg-purple-400/10 px-5 py-3 text-base font-semibold text-purple-50 transition hover:bg-purple-400/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Remove + Enhance
          </button>
        </div>
      </div>

      {status ? <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">{status}</div> : null}

      {result?.url ? (
        <div className="mt-5 rounded-[24px] border border-white/10 bg-black/35 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="text-sm font-black uppercase tracking-[0.18em] text-white/72">Cleaned video</h3>
              <p className="mt-2 break-words text-lg font-black text-white">{result.fileName || "cleaned_video.mp4"}</p>
            </div>
            <div className="grid gap-2 text-xs text-white/56 sm:grid-cols-2 md:text-right">
              <p>Duration: {formatDuration(result.durationSeconds)}</p>
              <p>Size: {formatBytes(result.sizeBytes)}</p>
              <p>Mode: {result.enhanced ? "Remove + Enhance" : "Remove Music"}</p>
              <p>Save: {result.saved ? "Gallery" : "Not saved"}</p>
            </div>
          </div>
          <div className="mt-3 overflow-hidden rounded-[20px] border border-white/10 bg-black/60">
            <video src={result.url} controls preload="metadata" className="max-h-[520px] w-full object-contain" />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={withDownload(result.url)}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10"
            >
              Download
            </a>
            <button
              type="button"
              onClick={() => void saveToGallery()}
              disabled={saveBusy || result.saved || !result.jobId || !result.fileName}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-5 py-3 text-base font-semibold text-cyan-50 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {result.saved ? "Saved to Gallery" : saveBusy ? "Saving..." : "Save to Gallery"}
            </button>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10"
            >
              Clear Result
            </button>
          </div>
        </div>
      ) : null}

      {galleryOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/82 p-4 backdrop-blur-sm">
          <div className="mx-auto max-w-6xl rounded-[28px] border border-white/10 bg-[#080812] p-4 shadow-2xl md:p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200/70">Gallery picker</p>
                <h3 className="mt-1 text-2xl font-black text-white">Choose video for Remove Music</h3>
                <p className="mt-1 text-sm text-white/55">Pick the Gallery clip you want to clean.</p>
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
                const key = `${item.source || "gallery"}:${galleryLookupName(item)}`;
                return (
                  <div key={key} className="rounded-[22px] border border-white/10 bg-black/35 p-3">
                    <div className="overflow-hidden rounded-[18px] border border-white/10 bg-black/60">
                      <video src={item.url} controls muted preload="metadata" className="aspect-video w-full object-contain" />
                    </div>
                    <p className="mt-3 break-words text-sm font-semibold text-white/82">{name}</p>
                    <p className="mt-1 text-xs text-white/42">{String(item.source || "gallery")}</p>
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
