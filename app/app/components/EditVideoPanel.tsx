"use client";

import EditVideoRemoveMusicPanel from "./EditVideoRemoveMusicPanel";
import React from "react";
import { cn } from "@/lib/cn";
import EditVideoEditAnythingPanel from "./EditVideoEditAnythingPanel";
import EditVideoWooshPanel from "./EditVideoWooshPanel";
import EditVideoVoiceDubbingPanel from "./EditVideoVoiceDubbingPanel";
import EditVideoExtractAudioPanel from "./EditVideoExtractAudioPanel";

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

type StitchMode = "stable" | "fast";

type StitchSlot = {
  id: number;
  source?: "upload" | "gallery";
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

type StitchResult = {
  jobId: string;
  fileName: string;
  url: string;
  galleryUrl?: string;
  saved?: boolean;
  durationSeconds?: number;
  sizeBytes?: number;
  width?: number;
  height?: number;
  stitchMode?: StitchMode;
  fallbackUsed?: boolean;
  clipCount?: number;
};

type AudioMixResult = {
  jobId: string;
  fileName: string;
  url: string;
  galleryUrl?: string;
  saved?: boolean;
  durationSeconds?: number;
  sizeBytes?: number;
  width?: number;
  height?: number;
  keepOriginalAudio?: boolean;
  loopMusic?: boolean;
  videoVolume?: number;
  musicVolume?: number;
};

type AceMusicModel = "turbo" | "base" | "sft";
type AceMusicMode = "reference" | "text";

type GeneratedMusicResult = {
  jobId: string;
  promptId?: string;
  fileName: string;
  title: string;
  url: string;
  audioPath?: string;
  saved?: boolean;
  model: AceMusicModel;
  prompt: string;
  durationSeconds?: number;
  bpm?: number;
  sizeBytes?: number;
};

type MusicLibraryItem = {
  fileName: string;
  title?: string;
  url: string;
  audioPath?: string;
  sizeBytes?: number;
  createdAt?: string;
  model?: string;
  prompt?: string;
};

type Props = {
  onRefreshGallery?: () => void;
};

function createEmptySlots(): StitchSlot[] {
  return Array.from({ length: 5 }, (_, index) => ({ id: index + 1 }));
}

function displayVideoName(item: GalleryVideoItem) {
  return String(item.meta?.renamedName || item.name || item.sourceName || item.fileName || "Gallery video").trim();
}

function galleryLookupName(item: GalleryVideoItem) {
  return String(item.fileName || item.sourceName || item.name || "").trim();
}

function isVideoItem(item: GalleryVideoItem) {
  const name = galleryLookupName(item).toLowerCase();
  return Boolean(item.video || item.kind === "video" || /\.(mp4|webm|mov|mkv)$/i.test(name));
}

function withDownload(url: string) {
  if (!url) return "#";
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

function revokeSlotPreview(slot: StitchSlot) {
  if (slot.previewUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(slot.previewUrl);
  }
}

function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "Unknown";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatBytes(bytes?: number) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "Unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
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

function ordinal(position: number) {
  if (position === 1) return "1st";
  if (position === 2) return "2nd";
  if (position === 3) return "3rd";
  return `${position}th`;
}

export default function EditVideoPanel({ onRefreshGallery }: Props) {
  const [activeTool, setActiveTool] = React.useState<"stitch" | "audio" | "voice" | "extract" | "remove" | "video">("stitch");
  const [slots, setSlots] = React.useState<StitchSlot[]>(() => createEmptySlots());
  const [galleryPickerSlot, setGalleryPickerSlot] = React.useState<number | null>(null);
  const [audioGalleryOpen, setAudioGalleryOpen] = React.useState(false);
  const [galleryVideos, setGalleryVideos] = React.useState<GalleryVideoItem[]>([]);
  const [galleryBusy, setGalleryBusy] = React.useState(false);
  const [galleryError, setGalleryError] = React.useState("");
  const [stitchBusy, setStitchBusy] = React.useState(false);
  const [saveBusy, setSaveBusy] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [outputTitle, setOutputTitle] = React.useState("stitched_video");
  const [stitchMode, setStitchMode] = React.useState<StitchMode>("stable");
  const [result, setResult] = React.useState<StitchResult | null>(null);

  const [audioVideo, setAudioVideo] = React.useState<StitchSlot | null>(null);
  const [musicFile, setMusicFile] = React.useState<File | null>(null);
  const [musicPreviewUrl, setMusicPreviewUrl] = React.useState("");
  const [musicFileName, setMusicFileName] = React.useState("");
  const [keepOriginalAudio, setKeepOriginalAudio] = React.useState(true);
  const [videoVolume, setVideoVolume] = React.useState(100);
  const [musicVolume, setMusicVolume] = React.useState(25);
  const [loopMusic, setLoopMusic] = React.useState(true);
  const [audioOutputTitle, setAudioOutputTitle] = React.useState("video_with_music");
  const [audioBusy, setAudioBusy] = React.useState(false);
  const [audioSaveBusy, setAudioSaveBusy] = React.useState(false);
  const [audioStatus, setAudioStatus] = React.useState("");
  const [audioResult, setAudioResult] = React.useState<AudioMixResult | null>(null);

  const [musicGeneratorPrompt, setMusicGeneratorPrompt] = React.useState("cinematic ambient background music, emotional, clean mix, no copyrighted melody");
  const [musicGeneratorModel, setMusicGeneratorModel] = React.useState<AceMusicModel>("turbo");
  const [musicGeneratorMode, setMusicGeneratorMode] = React.useState<AceMusicMode>("reference");
  const [musicGeneratorDuration, setMusicGeneratorDuration] = React.useState(30);
  const [musicGeneratorBpm, setMusicGeneratorBpm] = React.useState(95);
  const [musicGeneratorKey, setMusicGeneratorKey] = React.useState("E minor");
  const [musicGeneratorSeed, setMusicGeneratorSeed] = React.useState(-1);
  const [musicGenerateBusy, setMusicGenerateBusy] = React.useState(false);
  const [musicLibraryBusy, setMusicLibraryBusy] = React.useState(false);
  const [musicGeneratorStatus, setMusicGeneratorStatus] = React.useState("");
  const [generatedMusicResult, setGeneratedMusicResult] = React.useState<GeneratedMusicResult | null>(null);
  const [musicLibraryOpen, setMusicLibraryOpen] = React.useState(false);
  const [musicLibraryItems, setMusicLibraryItems] = React.useState<MusicLibraryItem[]>([]);
  const [musicLibraryError, setMusicLibraryError] = React.useState("");

  const slotsRef = React.useRef<StitchSlot[]>(slots);

  const selectedSlots = React.useMemo(() => slots.filter((slot) => slot.previewUrl && slot.fileName), [slots]);
  const totalDuration = React.useMemo(
    () => selectedSlots.reduce((sum, slot) => sum + (Number(slot.durationSeconds) || 0), 0),
    [selectedSlots],
  );

  React.useEffect(() => {
    if (galleryPickerSlot === null && !audioGalleryOpen) return;

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
  }, [galleryPickerSlot, audioGalleryOpen]);

  React.useEffect(() => {
    if (!musicLibraryOpen) return;

    let cancelled = false;
    setMusicLibraryBusy(true);
    setMusicLibraryError("");

    fetch("/api/edit-video/music-library", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.ok === false) {
          throw new Error(data?.error || "Music library could not be loaded.");
        }
        const items = Array.isArray(data?.items) ? data.items : [];
        if (!cancelled) setMusicLibraryItems(items);
      })
      .catch((error) => {
        if (!cancelled) setMusicLibraryError(error?.message || "Music library could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setMusicLibraryBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [musicLibraryOpen]);

  React.useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  React.useEffect(() => {
    return () => {
      slotsRef.current.forEach(revokeSlotPreview);
      if (musicPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(musicPreviewUrl);
      if (audioVideo?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(audioVideo.previewUrl);
    };
  }, [audioVideo, musicPreviewUrl]);

  function updateSlot(slotId: number, next: StitchSlot) {
    setResult(null);
    setStatus("");
    setSlots((current) =>
      current.map((slot) => {
        if (slot.id !== slotId) return slot;
        revokeSlotPreview(slot);
        return { ...next, id: slotId };
      }),
    );
  }

  function patchSlot(slotId: number, patch: Partial<StitchSlot>) {
    setSlots((current) => current.map((slot) => (slot.id === slotId ? { ...slot, ...patch } : slot)));
  }

  function clearSlot(slotId: number) {
    updateSlot(slotId, { id: slotId });
  }

  function clearAll() {
    slots.forEach(revokeSlotPreview);
    setSlots(createEmptySlots());
    setResult(null);
    setStatus("");
  }

  function moveSlot(slotId: number, direction: -1 | 1) {
    setResult(null);
    setStatus("");
    setSlots((current) => {
      const index = current.findIndex((slot) => slot.id === slotId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const swapped = current.map((slot) => ({ ...slot }));
      const currentSlot = current[index];
      const nextSlot = current[nextIndex];
      swapped[index] = { ...nextSlot, id: currentSlot.id };
      swapped[nextIndex] = { ...currentSlot, id: nextSlot.id };
      return swapped;
    });
  }

  function handleUpload(slotId: number, file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("video/") && !/\.(mp4|webm|mov|mkv)$/i.test(file.name)) {
      setStatus("Select a video file only.");
      return;
    }

    updateSlot(slotId, {
      id: slotId,
      source: "upload",
      file,
      fileName: file.name,
      title: file.name,
      previewUrl: URL.createObjectURL(file),
      sizeBytes: file.size,
    });
  }

  function selectGalleryVideo(item: GalleryVideoItem) {
    if (audioGalleryOpen) {
      selectAudioGalleryVideo(item);
      return;
    }
    if (galleryPickerSlot === null) return;
    const name = galleryLookupName(item);
    if (!name || !item.url) {
      setGalleryError("That Gallery item is missing a video URL or filename.");
      return;
    }

    updateSlot(galleryPickerSlot, {
      id: galleryPickerSlot,
      source: "gallery",
      fileName: name,
      title: displayVideoName(item),
      previewUrl: item.url,
      scope: String(item.source || ""),
      sizeBytes: Number(item.sizeBytes || item.size || 0) || undefined,
      durationSeconds: Number(item.meta?.durationSeconds || 0) || undefined,
      width: Number(item.meta?.width || 0) || undefined,
      height: Number(item.meta?.height || 0) || undefined,
    });
    setGalleryPickerSlot(null);
  }

  function captureVideoMetadata(slotId: number, video: HTMLVideoElement) {
    patchSlot(slotId, {
      durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined,
      width: video.videoWidth || undefined,
      height: video.videoHeight || undefined,
    });
  }

  async function stitchVideos() {
    const selected = slots.filter((slot) => slot.previewUrl && slot.fileName);
    if (selected.length < 2) {
      setStatus("Select at least 2 videos before stitching.");
      return;
    }
    if (selected.length > 5) {
      setStatus("Use no more than 5 videos in this phase.");
      return;
    }

    const form = new FormData();
    form.append("count", String(selected.length));
    form.append("title", cleanTitle(outputTitle.trim()) || "stitched_video");
    form.append("stitchMode", stitchMode);

    selected.forEach((slot, index) => {
      form.append(`slot_${index}_source`, slot.source || "");
      form.append(`slot_${index}_title`, slot.title || slot.fileName || `Video ${index + 1}`);
      form.append(`slot_${index}_duration`, String(slot.durationSeconds || ""));
      form.append(`slot_${index}_width`, String(slot.width || ""));
      form.append(`slot_${index}_height`, String(slot.height || ""));
      if (slot.source === "upload" && slot.file) {
        form.append(`slot_${index}_file`, slot.file, slot.file.name);
      } else if (slot.source === "gallery") {
        form.append(`slot_${index}_name`, slot.fileName || "");
        form.append(`slot_${index}_scope`, slot.scope || "");
      }
    });

    setStitchBusy(true);
    setStatus(stitchMode === "fast" ? "Trying fast stitch. If clips do not match, the server will fall back to stable mode." : "Stitching videos with stable FFmpeg re-encode...");
    setResult(null);

    try {
      const response = await fetch("/api/edit-video/stitch", {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || "Video stitch failed.");
      }
      setResult({
        jobId: String(data.jobId || ""),
        fileName: String(data.fileName || "stitched_video.mp4"),
        url: String(data.url || ""),
        saved: false,
        durationSeconds: Number(data.durationSeconds || 0) || undefined,
        sizeBytes: Number(data.sizeBytes || 0) || undefined,
        width: Number(data?.target?.width || 0) || undefined,
        height: Number(data?.target?.height || 0) || undefined,
        stitchMode: String(data.stitchMode || stitchMode) as StitchMode,
        fallbackUsed: Boolean(data.fallbackUsed),
        clipCount: Number(data.inputs || selected.length),
      });
      setStatus(data.fallbackUsed ? "Fast stitch was not compatible, so the server used stable mode. Stitched video is ready." : "Stitched video is ready. Preview it, then save it to Gallery or download it.");
    } catch (error: any) {
      setStatus(error?.message || "Video stitch failed.");
    } finally {
      setStitchBusy(false);
    }
  }

  async function saveResultToGallery() {
    if (!result || result.saved) return;
    setSaveBusy(true);
    setStatus("Saving stitched video to Gallery...");

    try {
      const response = await fetch("/api/edit-video/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: result.jobId,
          fileName: result.fileName,
          title: cleanTitle(outputTitle.trim()) || "stitched_video",
          stitchMode: result.stitchMode || stitchMode,
          fallbackUsed: result.fallbackUsed,
          durationSeconds: result.durationSeconds,
          sizeBytes: result.sizeBytes,
          clipCount: selectedSlots.length,
          clipNames: selectedSlots.map((slot) => slot.title || slot.fileName || "Untitled video"),
          sourceClips: selectedSlots.map((slot, index) => ({
            order: index + 1,
            title: slot.title || slot.fileName || "Untitled video",
            fileName: slot.fileName || "",
            source: slot.source || "",
            durationSeconds: slot.durationSeconds || null,
            width: slot.width || null,
            height: slot.height || null,
          })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || "Save to Gallery failed.");
      }
      setResult((current) =>
        current
          ? {
              ...current,
              galleryUrl: String(data.url || ""),
              fileName: String(data.fileName || current.fileName),
              saved: true,
            }
          : current,
      );
      onRefreshGallery?.();
      setStatus("Saved to Gallery.");
    } catch (error: any) {
      setStatus(error?.message || "Save to Gallery failed.");
    } finally {
      setSaveBusy(false);
    }
  }


  function clearAudioVideo() {
    if (audioVideo?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(audioVideo.previewUrl);
    setAudioVideo(null);
    setAudioResult(null);
    setAudioStatus("");
  }

  function handleAudioVideoUpload(file: File | null) {
    if (!file) return;
    if (audioVideo?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(audioVideo.previewUrl);
    setAudioResult(null);
    setAudioStatus("");
    setAudioVideo({
      id: 1,
      source: "upload",
      file,
      fileName: file.name,
      title: file.name,
      previewUrl: URL.createObjectURL(file),
      sizeBytes: file.size,
    });
  }

  function selectAudioGalleryVideo(item: GalleryVideoItem) {
    const name = galleryLookupName(item);
    if (!name || !item.url) {
      setGalleryError("That Gallery item is missing a video URL or filename.");
      return;
    }
    if (audioVideo?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(audioVideo.previewUrl);
    setAudioResult(null);
    setAudioStatus("");
    setAudioVideo({
      id: 1,
      source: "gallery",
      fileName: name,
      title: displayVideoName(item),
      previewUrl: item.url,
      scope: String(item.source || ""),
      sizeBytes: Number(item.sizeBytes || item.size || 0) || undefined,
      durationSeconds: Number(item.meta?.durationSeconds || 0) || undefined,
      width: Number(item.meta?.width || 0) || undefined,
      height: Number(item.meta?.height || 0) || undefined,
    });
    setAudioGalleryOpen(false);
  }

  function captureAudioVideoMetadata(video: HTMLVideoElement) {
    setAudioVideo((current) =>
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

  function handleMusicUpload(file: File | null) {
    if (!file) return;
    if (musicPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(musicPreviewUrl);
    setAudioResult(null);
    setAudioStatus("");
    setMusicFile(file);
    setMusicFileName(file.name);
    setMusicPreviewUrl(URL.createObjectURL(file));
  }

  function clearMusic() {
    if (musicPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(musicPreviewUrl);
    setMusicFile(null);
    setMusicFileName("");
    setMusicPreviewUrl("");
    setAudioResult(null);
    setAudioStatus("");
  }

  function clearAudioMix() {
    clearAudioVideo();
    clearMusic();
    setAudioOutputTitle("video_with_music");
    setKeepOriginalAudio(true);
    setVideoVolume(100);
    setMusicVolume(25);
    setLoopMusic(true);
    setAudioResult(null);
    setAudioStatus("");
    setGeneratedMusicResult(null);
    setMusicGeneratorStatus("");
  }

  async function useMusicFromUrl(url: string, fileName: string) {
    if (!url) {
      setMusicGeneratorStatus("Music file URL is missing.");
      return;
    }

    try {
      setMusicGeneratorStatus("Loading music into background music slot...");
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Music file could not be loaded (${response.status}).`);
      const blob = await response.blob();
      const safeName = fileName || "generated_music.mp3";
      const file = new File([blob], safeName, { type: blob.type || "audio/mpeg" });
      handleMusicUpload(file);
      setMusicGeneratorStatus("Music loaded into Step 2. You can now mix it with the selected video.");
      setMusicLibraryOpen(false);
    } catch (error: any) {
      setMusicGeneratorStatus(error?.message || "Music file could not be loaded.");
    }
  }

  async function generateAceStepMusic() {
    const prompt = musicGeneratorPrompt.trim();
    if (!prompt) {
      setMusicGeneratorStatus("Enter a music prompt/vibe first.");
      return;
    }

    setMusicGenerateBusy(true);
    setGeneratedMusicResult(null);
    setMusicGeneratorStatus("Submitting ACE-Step 1.5 API music generation...");

    try {
      const durationSeconds = Math.max(10, Math.min(600, Number(musicGeneratorDuration) || 30));
      const bpm = Math.max(40, Math.min(220, Number(musicGeneratorBpm) || 95));
      let response: Response;

      if (musicGeneratorMode === "reference" && audioVideo?.source === "upload" && audioVideo.file) {
        const form = new FormData();
        form.append("prompt", prompt);
        form.append("title", cleanTitle(audioOutputTitle || "generated_music") || "generated_music");
        form.append("durationSeconds", String(durationSeconds));
        form.append("bpm", String(bpm));
        form.append("keyscale", musicGeneratorKey || "E minor");
        form.append("seed", String(Number(musicGeneratorSeed)));
        form.append("referenceVideoFile", audioVideo.file, audioVideo.file.name);
        response = await fetch("/api/edit-video/ace-music", {
          method: "POST",
          body: form,
        });
      } else {
        response = await fetch("/api/edit-video/ace-music", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: musicGeneratorModel,
            prompt,
            title: cleanTitle(audioOutputTitle || "generated_music") || "generated_music",
            durationSeconds,
            bpm,
            keyscale: musicGeneratorKey || "E minor",
            seed: Number(musicGeneratorSeed),
            referenceVideo: musicGeneratorMode === "reference" && audioVideo?.source === "gallery"
              ? {
                  fileName: audioVideo.fileName || "",
                  scope: audioVideo.scope || "",
                }
              : null,
          }),
        });
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        const detailBits = [];
        if (data?.stage) detailBits.push("stage=" + data.stage);
        if (Array.isArray(data?.receivedKeys)) detailBits.push("receivedKeys=" + data.receivedKeys.join(","));
        if (data?.rawBodyPreview) detailBits.push("rawBody=" + String(data.rawBodyPreview).slice(0, 160));
        // OTG_PHASE3B_MUSIC_ERROR_DETAIL
        throw new Error((data?.error || "ACE-Step music generation failed.") + (detailBits.length ? " (" + detailBits.join(" | ") + ")" : ""));
      }
      setGeneratedMusicResult({
        jobId: String(data.jobId || ""),
        promptId: String(data.promptId || ""),
        fileName: String(data.fileName || "generated_music.mp3"),
        title: String(data.title || audioOutputTitle || "Generated music"),
        url: String(data.url || ""),
        audioPath: String(data.audioPath || ""),
        saved: false,
        model: String(data.model || musicGeneratorModel) as AceMusicModel,
        prompt,
        durationSeconds: Number(data.durationSeconds || musicGeneratorDuration) || undefined,
        bpm: Number(data.bpm || musicGeneratorBpm) || undefined,
        sizeBytes: Number(data.sizeBytes || 0) || undefined,
      });
      setMusicGeneratorStatus(data?.referenceUsed ? "Generated reference-based music is ready. Preview it, use it as background music, or save it to the music library." : "Generated music is ready. Preview it, use it as background music, or save it to the music library.");
    } catch (error: any) {
      setMusicGeneratorStatus(error?.message || "ACE-Step music generation failed.");
    } finally {
      setMusicGenerateBusy(false);
    }
  }

  async function saveGeneratedMusicToLibrary() {
    if (!generatedMusicResult?.audioPath) {
      setMusicGeneratorStatus("No generated music file is available to save.");
      return;
    }

    setMusicLibraryBusy(true);
    setMusicGeneratorStatus("Saving generated music to the music library...");

    try {
      const response = await fetch("/api/edit-video/music-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioPath: generatedMusicResult.audioPath,
          title: generatedMusicResult.title || generatedMusicResult.fileName,
          fileName: generatedMusicResult.fileName,
          model: generatedMusicResult.model,
          prompt: generatedMusicResult.prompt,
          durationSeconds: generatedMusicResult.durationSeconds,
          bpm: generatedMusicResult.bpm,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || "Save to music library failed.");
      }
      setGeneratedMusicResult((current) => current ? { ...current, saved: true, url: String(data.url || current.url), audioPath: String(data.audioPath || current.audioPath) } : current);
      setMusicGeneratorStatus("Saved to music library.");
    } catch (error: any) {
      setMusicGeneratorStatus(error?.message || "Save to music library failed.");
    } finally {
      setMusicLibraryBusy(false);
    }
  }

  async function mixBackgroundMusic() {
    if (!audioVideo?.previewUrl || !audioVideo.fileName) {
      setAudioStatus("Choose a video first.");
      return;
    }
    if (!musicFile) {
      setAudioStatus("Upload an MP3, WAV, or M4A music file first.");
      return;
    }

    const form = new FormData();
    form.append("title", cleanTitle(audioOutputTitle.trim()) || "video_with_music");
    form.append("video_source", audioVideo.source || "");
    form.append("video_title", audioVideo.title || audioVideo.fileName || "Selected video");
    form.append("video_duration", String(audioVideo.durationSeconds || ""));
    form.append("video_width", String(audioVideo.width || ""));
    form.append("video_height", String(audioVideo.height || ""));
    form.append("keep_original_audio", keepOriginalAudio ? "1" : "0");
    form.append("video_volume", String(Math.max(0, Math.min(100, videoVolume)) / 100));
    form.append("music_volume", String(Math.max(0, Math.min(100, musicVolume)) / 100));
    form.append("loop_music", loopMusic ? "1" : "0");
    form.append("music_file", musicFile, musicFile.name);

    if (audioVideo.source === "upload" && audioVideo.file) {
      form.append("video_file", audioVideo.file, audioVideo.file.name);
    } else if (audioVideo.source === "gallery") {
      form.append("video_name", audioVideo.fileName || "");
      form.append("video_scope", audioVideo.scope || "");
    }

    setAudioBusy(true);
    setAudioResult(null);
    setAudioStatus(keepOriginalAudio ? "Mixing background music under the original video audio..." : "Replacing the original audio with background music...");

    try {
      const response = await fetch("/api/edit-video/audio-mix", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || "Audio mix failed.");
      }
      setAudioResult({
        jobId: String(data.jobId || ""),
        fileName: String(data.fileName || "video_with_music.mp4"),
        url: String(data.url || ""),
        saved: false,
        durationSeconds: Number(data.durationSeconds || 0) || undefined,
        sizeBytes: Number(data.sizeBytes || 0) || undefined,
        width: Number(data?.target?.width || 0) || undefined,
        height: Number(data?.target?.height || 0) || undefined,
        keepOriginalAudio,
        loopMusic,
        videoVolume,
        musicVolume,
      });
      setAudioStatus("Background music mix is ready. Preview it, then save it to Gallery or download it.");
    } catch (error: any) {
      setAudioStatus(error?.message || "Audio mix failed.");
    } finally {
      setAudioBusy(false);
    }
  }

  async function saveAudioResultToGallery() {
    if (!audioResult || audioResult.saved) return;
    setAudioSaveBusy(true);
    setAudioStatus("Saving audio-edited video to Gallery...");

    try {
      const response = await fetch("/api/edit-video/audio-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: audioResult.jobId,
          fileName: audioResult.fileName,
          title: cleanTitle(audioOutputTitle.trim()) || "video_with_music",
          videoName: audioVideo?.title || audioVideo?.fileName || "Selected video",
          musicName: musicFileName || "Uploaded music",
          keepOriginalAudio,
          videoVolume: Math.max(0, Math.min(100, videoVolume)) / 100,
          musicVolume: Math.max(0, Math.min(100, musicVolume)) / 100,
          loopMusic,
          durationSeconds: audioResult.durationSeconds,
          sizeBytes: audioResult.sizeBytes,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || "Save to Gallery failed.");
      }
      setAudioResult((current) =>
        current
          ? {
              ...current,
              galleryUrl: String(data.url || ""),
              fileName: String(data.fileName || current.fileName),
              saved: true,
            }
          : current,
      );
      onRefreshGallery?.();
      setAudioStatus("Saved to Gallery.");
    } catch (error: any) {
      setAudioStatus(error?.message || "Save to Gallery failed.");
    } finally {
      setAudioSaveBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-200/70">Video tools</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight text-white">Edit Video</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/62">
          Combine generated clips and add background music outside Production. Phase 3B adds ACE-Step music generation while keeping Woosh sound effects, dialogue separation, and LTX video effects for later phases.
        </p>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-black/45 p-4 md:p-5">
        <div className="flex flex-wrap gap-3">
          {[
            { id: "stitch", label: "Stitch Video", disabled: false },
            { id: "audio", label: "Audio Editing", disabled: false },
            { id: "voice", label: "Voice Dubbing", disabled: false },
            { id: "extract", label: "Extract Audio", disabled: false },
            { id: "remove", label: "Remove Music" },
            { id: "video", label: "Video Editing", disabled: false },
          ].map((tool) => (
            <button
              key={tool.id}
              type="button"
              disabled={tool.disabled}
              onClick={() => !tool.disabled && setActiveTool(tool.id as "stitch" | "audio" | "voice" | "extract" | "remove" | "video")}
              className={cn(
                "inline-flex min-h-12 items-center justify-center rounded-full border px-5 py-3 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-45",
                activeTool === tool.id
                  ? "border-cyan-400/40 bg-[linear-gradient(90deg,rgba(145,92,255,0.55),rgba(40,200,255,0.35))] text-white"
                  : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
              )}
            >
              {tool.label}
              {tool.disabled ? <span className="ml-2 text-xs text-white/45">Later</span> : null}
            </button>
          ))}
        </div>
      </section>

      {activeTool === "stitch" ? (
        <section className="rounded-[28px] border border-white/10 bg-black/45 p-4 md:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white/78">Stitch Video</h2>
              <p className="mt-2 text-sm leading-6 text-white/60">
                Select videos in order. Slot 1 plays first, then Slot 2, and so on. Use the Gallery picker preview before choosing.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(220px,320px)_minmax(190px,240px)]">
              <div>
                <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Output name</label>
                <input
                  value={outputTitle}
                  onChange={(event) => setOutputTitle(cleanTitle(event.target.value))}
                  className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                  placeholder="stitched_video"
                />
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Stitch mode</label>
                <select
                  value={stitchMode}
                  onChange={(event) => setStitchMode(event.target.value as StitchMode)}
                  className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/45"
                >
                  <option value="stable">Stable / Re-encode</option>
                  <option value="fast">Fast / Copy if compatible</option>
                </select>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 rounded-[22px] border border-white/10 bg-white/[0.035] p-4 md:grid-cols-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Selected clips</p>
              <p className="mt-1 text-lg font-black text-white">{selectedSlots.length}/5</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Estimated duration</p>
              <p className="mt-1 text-lg font-black text-white">{totalDuration > 0 ? formatDuration(totalDuration) : "Waiting for metadata"}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Output file</p>
              <p className="mt-1 break-words text-lg font-black text-white">{cleanTitle(outputTitle) || "stitched_video"}.mp4</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-5">
            {slots.map((slot, index) => (
              <div key={slot.id} className="rounded-[24px] border border-white/10 bg-black/35 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-white">Video {slot.id}</p>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/38">{ordinal(index + 1)} clip</p>
                  </div>
                  {slot.previewUrl ? (
                    <button type="button" onClick={() => clearSlot(slot.id)} className="text-xs font-semibold text-red-200/80 hover:text-red-100">
                      Remove
                    </button>
                  ) : null}
                </div>

                <div className="overflow-hidden rounded-[18px] border border-white/10 bg-black/55">
                  {slot.previewUrl ? (
                    <video
                      src={slot.previewUrl}
                      controls
                      muted
                      preload="metadata"
                      onLoadedMetadata={(event) => captureVideoMetadata(slot.id, event.currentTarget)}
                      className="aspect-video w-full object-contain"
                    />
                  ) : (
                    <div className="flex aspect-video items-center justify-center px-3 text-center text-xs text-white/42">No video selected</div>
                  )}
                </div>

                <p className="mt-3 min-h-[2.5rem] break-words text-xs leading-5 text-white/62">{slot.title || slot.fileName || "Select upload or Gallery."}</p>

                {slot.previewUrl ? (
                  <div className="mt-3 space-y-1 rounded-[16px] border border-white/10 bg-black/35 p-3 text-[11px] leading-5 text-white/52">
                    <p>Source: {slot.source === "gallery" ? "Gallery" : "Upload"}</p>
                    <p>Duration: {formatDuration(slot.durationSeconds)}</p>
                    <p>Resolution: {slot.width && slot.height ? `${slot.width}x${slot.height}` : "Unknown"}</p>
                    <p>Size: {formatBytes(slot.sizeBytes)}</p>
                  </div>
                ) : null}

                <div className="mt-3 grid gap-2">
                  <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/82 transition hover:bg-white/10">
                    Upload Video
                    <input
                      type="file"
                      accept="video/*,.mp4,.webm,.mov,.mkv"
                      className="hidden"
                      onChange={(event) => {
                        handleUpload(slot.id, event.target.files?.[0] || null);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setGalleryPickerSlot(slot.id)}
                    className="inline-flex min-h-10 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15"
                  >
                    Choose from Gallery
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={index === 0 || !slot.previewUrl}
                      onClick={() => moveSlot(slot.id, -1)}
                      className="min-h-9 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Move Up
                    </button>
                    <button
                      type="button"
                      disabled={index === slots.length - 1 || !slot.previewUrl}
                      onClick={() => moveSlot(slot.id, 1)}
                      className="min-h-9 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Move Down
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void stitchVideos()}
              disabled={stitchBusy || selectedSlots.length < 2}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-cyan-400/20 bg-[linear-gradient(90deg,rgba(145,92,255,0.35),rgba(40,200,255,0.28))] px-5 py-3 text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {stitchBusy ? "Stitching..." : "Stitch Videos"}
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={stitchBusy || saveBusy}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear All
            </button>
            <p className="text-sm text-white/55">Need at least 2 videos. Maximum 5 videos.</p>
          </div>

          {status ? <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">{status}</div> : null}

          {result?.url ? (
            <div className="mt-5 rounded-[24px] border border-white/10 bg-black/35 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-[0.18em] text-white/72">Final stitched video</h3>
                  <p className="mt-2 break-words text-lg font-black text-white">{result.fileName}</p>
                </div>
                <div className="grid gap-2 text-xs text-white/56 sm:grid-cols-2 md:text-right">
                  <p>Duration: {formatDuration(result.durationSeconds)}</p>
                  <p>Size: {formatBytes(result.sizeBytes)}</p>
                  <p>Clips: {result.clipCount || selectedSlots.length}</p>
                  <p>Mode: {result.fallbackUsed ? "Stable fallback" : result.stitchMode === "fast" ? "Fast copy" : "Stable"}</p>
                </div>
              </div>
              <div className="mt-3 overflow-hidden rounded-[20px] border border-white/10 bg-black/60">
                <video src={result.galleryUrl || result.url} controls preload="metadata" className="max-h-[520px] w-full object-contain" />
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={withDownload(result.galleryUrl || result.url)}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => void saveResultToGallery()}
                  disabled={saveBusy || result.saved}
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
                <button
                  type="button"
                  onClick={clearAll}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10"
                >
                  Start New Stitch
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}


      {activeTool === "audio" ? (
        <section className="rounded-[28px] border border-white/10 bg-black/45 p-4 md:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white/78">Audio Editing</h2>
              <p className="mt-2 text-sm leading-6 text-white/60">
                Phase 3B adds generated music with ACE-Step. Upload music, choose saved music, or generate a new MP3, then mix it into a video with FFmpeg.
              </p>
            </div>
            <div className="w-full max-w-sm">
              <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Output name</label>
              <input
                value={audioOutputTitle}
                onChange={(event) => setAudioOutputTitle(cleanTitle(event.target.value))}
                className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-300/40"
                placeholder="video_with_music"
              />
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[24px] border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-[0.18em] text-white/60">Step 1: Choose video</h3>
                  <p className="mt-2 text-sm text-white/55">Upload a video or choose one from Gallery.</p>
                </div>
                {audioVideo ? (
                  <button
                    type="button"
                    onClick={clearAudioVideo}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/72 hover:bg-white/10"
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              {audioVideo?.previewUrl ? (
                <div className="mt-4">
                  <div className="overflow-hidden rounded-[20px] border border-white/10 bg-black/60">
                    <video
                      src={audioVideo.previewUrl}
                      controls
                      preload="metadata"
                      className="aspect-video w-full object-contain"
                      onLoadedMetadata={(event) => captureAudioVideoMetadata(event.currentTarget)}
                    />
                  </div>
                  <p className="mt-3 break-words text-sm font-semibold text-white/84">{audioVideo.title || audioVideo.fileName}</p>
                  <div className="mt-2 grid gap-1 text-xs text-white/48 sm:grid-cols-2">
                    <p>Source: {audioVideo.source === "gallery" ? "Gallery" : "Upload"}</p>
                    <p>Duration: {formatDuration(audioVideo.durationSeconds)}</p>
                    <p>Resolution: {audioVideo.width && audioVideo.height ? `${audioVideo.width}x${audioVideo.height}` : "Unknown"}</p>
                    <p>Size: {formatBytes(audioVideo.sizeBytes)}</p>
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
                      handleAudioVideoUpload(event.target.files?.[0] || null);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setAudioGalleryOpen(true)}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15"
                >
                  Choose from Gallery
                </button>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-[0.18em] text-white/60">Step 2: Choose background music</h3>
                  <p className="mt-2 text-sm text-white/55">Upload music, choose saved music, or generate original music with ACE-Step.</p>
                </div>
                {musicFile ? (
                  <button
                    type="button"
                    onClick={clearMusic}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/72 hover:bg-white/10"
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              {musicFile ? (
                <div className="mt-4 rounded-[20px] border border-white/10 bg-black/35 p-3">
                  <p className="break-words text-sm font-semibold text-white/84">{musicFileName}</p>
                  <p className="mt-1 text-xs text-white/45">Size: {formatBytes(musicFile.size)}</p>
                  {musicPreviewUrl ? <audio src={musicPreviewUrl} controls preload="metadata" className="mt-3 w-full" /> : null}
                </div>
              ) : (
                <div className="mt-4 rounded-[20px] border border-dashed border-white/10 bg-black/25 px-4 py-8 text-center text-sm text-white/45">
                  No music selected.
                </div>
              )}

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/82 transition hover:bg-white/10">
                  Upload Music
                  <input
                    type="file"
                    accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,.mp3,.wav,.m4a,.aac"
                    className="hidden"
                    onChange={(event) => {
                      handleMusicUpload(event.target.files?.[0] || null);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setMusicLibraryOpen(true)}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15"
                >
                  Choose Saved Music
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-[24px] border border-white/10 bg-white/[0.035] p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h3 className="text-xs font-black uppercase tracking-[0.18em] text-white/60">Optional: Generate or extend music</h3>
                <p className="mt-2 text-sm text-white/55">ACE-Step 1.5 API can create a music bed from text, or use the selected video audio as a 4-second style reference.</p>
              </div>
              <div className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-cyan-50">Phase 3B</div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_260px]">
                <div className="rounded-[18px] border border-white/10 bg-black/25 p-3">
                  <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Generation mode</label>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setMusicGeneratorMode("reference")}
                      className={cn(
                        "min-h-11 rounded-[14px] border px-3 py-2 text-sm font-black transition",
                        musicGeneratorMode === "reference"
                          ? "border-cyan-300/40 bg-cyan-300/20 text-cyan-50"
                          : "border-white/10 bg-white/[0.06] text-white/70 hover:bg-white/10"
                      )}
                    >
                      Use Video Reference
                    </button>
                    <button
                      type="button"
                      onClick={() => setMusicGeneratorMode("text")}
                      className={cn(
                        "min-h-11 rounded-[14px] border px-3 py-2 text-sm font-black transition",
                        musicGeneratorMode === "text"
                          ? "border-cyan-300/40 bg-cyan-300/20 text-cyan-50"
                          : "border-white/10 bg-white/[0.06] text-white/70 hover:bg-white/10"
                      )}
                    >
                      Text Only
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-white/45">
                    {musicGeneratorMode === "reference"
                      ? audioVideo
                        ? `Reference source: ${audioVideo.title || audioVideo.fileName || "selected video"}`
                        : "Select or upload a video in Step 1 to use its first seconds as the reference."
                      : "Text-only mode ignores the selected video."}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Music prompt / vibe</label>
                <textarea
                  value={musicGeneratorPrompt}
                  onChange={(event) => setMusicGeneratorPrompt(event.target.value)}
                  className="mt-2 min-h-[110px] w-full resize-y rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/35 focus:border-cyan-300/40"
                  placeholder="Example: cinematic emotional background score, 90 BPM, soft piano, light strings, no vocals"
                />
              </div>
              <div className="grid gap-3">
                <div>
                  <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Model</label>
                  <select
                    value={musicGeneratorModel}
                    onChange={(event) => setMusicGeneratorModel(event.target.value as AceMusicModel)}
                    className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/40"
                  >
                    <option value="turbo">XL Turbo / fastest</option>
                    <option value="base">XL Base / quality test</option>
                    <option value="sft">XL SFT / prompt adherence</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Seconds</label>
                    <input type="number" min="10" max="600" value={musicGeneratorDuration} onChange={(event) => setMusicGeneratorDuration(Number(event.target.value))} className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" />
                  </div>
                  <div>
                    <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">BPM</label>
                    <input type="number" min="40" max="220" value={musicGeneratorBpm} onChange={(event) => setMusicGeneratorBpm(Number(event.target.value))} className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Key</label>
                    <input value={musicGeneratorKey} onChange={(event) => setMusicGeneratorKey(event.target.value)} className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" />
                  </div>
                  <div>
                    <label className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Seed</label>
                    <input type="number" value={musicGeneratorSeed} onChange={(event) => setMusicGeneratorSeed(Number(event.target.value))} className="mt-2 w-full rounded-[18px] border border-white/10 bg-black/45 px-4 py-3 text-sm text-white outline-none" />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void generateAceStepMusic()}
                disabled={musicGenerateBusy || !musicGeneratorPrompt.trim()}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-5 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {musicGenerateBusy ? "Generating..." : "Generate Music"}
              </button>
              <p className="text-sm text-white/50">Use 30 seconds for a standard background bed; the first run may initialize ACE models.</p>
            </div>

            {musicGeneratorStatus ? <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">{musicGeneratorStatus}</div> : null}

            {generatedMusicResult?.url ? (
              <div className="mt-4 rounded-[20px] border border-white/10 bg-black/35 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="break-words text-sm font-black text-white">{generatedMusicResult.fileName}</p>
                    <p className="mt-1 text-xs text-white/45">Model: {generatedMusicResult.model.toUpperCase()} Ã¢â‚¬Â¢ Duration: {formatDuration(generatedMusicResult.durationSeconds)} Ã¢â‚¬Â¢ BPM: {generatedMusicResult.bpm || "Unknown"}</p>
                  </div>
                  <p className="text-xs text-white/45">Size: {formatBytes(generatedMusicResult.sizeBytes)}</p>
                </div>
                <audio src={generatedMusicResult.url} controls preload="metadata" className="mt-3 w-full" />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void useMusicFromUrl(generatedMusicResult.url, generatedMusicResult.fileName)} className="inline-flex min-h-10 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-50 hover:bg-cyan-400/15">Use as Background Music</button>
                  <a href={withDownload(generatedMusicResult.url)} className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">Download MP3</a>
                  <button type="button" onClick={() => void saveGeneratedMusicToLibrary()} disabled={musicLibraryBusy || generatedMusicResult.saved} className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50">{generatedMusicResult.saved ? "Saved to Library" : musicLibraryBusy ? "Saving..." : "Save to Music Library"}</button>
                </div>
              </div>
            ) : null}
          </div>

          <EditVideoWooshPanel audioVideo={audioVideo} />

          <div className="mt-5 rounded-[24px] border border-white/10 bg-white/[0.035] p-4">
            <h3 className="text-xs font-black uppercase tracking-[0.18em] text-white/60">Step 3: Mix settings</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="flex items-center justify-between gap-3 rounded-[18px] border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/75">
                <span>Keep original video audio</span>
                <input type="checkbox" checked={keepOriginalAudio} onChange={(event) => setKeepOriginalAudio(event.target.checked)} />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-[18px] border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/75">
                <span>Loop music if shorter than video</span>
                <input type="checkbox" checked={loopMusic} onChange={(event) => setLoopMusic(event.target.checked)} />
              </label>
              <div className="rounded-[18px] border border-white/10 bg-black/25 px-4 py-3">
                <div className="flex items-center justify-between text-sm text-white/75">
                  <span>Original audio volume</span>
                  <span>{videoVolume}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="150"
                  value={videoVolume}
                  disabled={!keepOriginalAudio}
                  onChange={(event) => setVideoVolume(Number(event.target.value))}
                  className="mt-3 w-full"
                />
              </div>
              <div className="rounded-[18px] border border-white/10 bg-black/25 px-4 py-3">
                <div className="flex items-center justify-between text-sm text-white/75">
                  <span>Background music volume</span>
                  <span>{musicVolume}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="150"
                  value={musicVolume}
                  onChange={(event) => setMusicVolume(Number(event.target.value))}
                  className="mt-3 w-full"
                />
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void mixBackgroundMusic()}
              disabled={audioBusy || !audioVideo || !musicFile}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-cyan-400/20 bg-[linear-gradient(90deg,rgba(145,92,255,0.35),rgba(40,200,255,0.28))] px-5 py-3 text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {audioBusy ? "Mixing..." : "Add Background Music"}
            </button>
            <button
              type="button"
              onClick={clearAudioMix}
              disabled={audioBusy || audioSaveBusy}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear Audio Edit
            </button>
            <p className="text-sm text-white/55">Default mix: original audio 100%, background music 25%.</p>
          </div>

          {audioStatus ? <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">{audioStatus}</div> : null}

          {audioResult?.url ? (
            <div className="mt-5 rounded-[24px] border border-white/10 bg-black/35 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-[0.18em] text-white/72">Final video with music</h3>
                  <p className="mt-2 break-words text-lg font-black text-white">{audioResult.fileName}</p>
                </div>
                <div className="grid gap-2 text-xs text-white/56 sm:grid-cols-2 md:text-right">
                  <p>Duration: {formatDuration(audioResult.durationSeconds)}</p>
                  <p>Size: {formatBytes(audioResult.sizeBytes)}</p>
                  <p>Original audio: {keepOriginalAudio ? `${videoVolume}%` : "Removed"}</p>
                  <p>Music volume: {musicVolume}%</p>
                </div>
              </div>
              <div className="mt-3 overflow-hidden rounded-[20px] border border-white/10 bg-black/60">
                <video src={audioResult.galleryUrl || audioResult.url} controls preload="metadata" className="max-h-[520px] w-full object-contain" />
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={withDownload(audioResult.galleryUrl || audioResult.url)}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => void saveAudioResultToGallery()}
                  disabled={audioSaveBusy || audioResult.saved}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-5 py-3 text-base font-semibold text-cyan-50 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {audioResult.saved ? "Saved to Gallery" : audioSaveBusy ? "Saving..." : "Save to Gallery"}
                </button>
                <button
                  type="button"
                  onClick={() => setAudioResult(null)}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10"
                >
                  Clear Result
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {musicLibraryOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/82 p-4 backdrop-blur-sm">
          <div className="mx-auto max-w-5xl rounded-[28px] border border-white/10 bg-[#080812] p-4 shadow-2xl md:p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200/70">Music library</p>
                <h3 className="mt-1 text-2xl font-black text-white">Choose saved music</h3>
                <p className="mt-1 text-sm text-white/55">Preview a saved MP3, then load it into the background music slot.</p>
              </div>
              <button
                type="button"
                onClick={() => setMusicLibraryOpen(false)}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
              >
                Close
              </button>
            </div>

            {musicLibraryBusy ? <p className="mt-5 text-sm text-white/60">Loading saved music...</p> : null}
            {musicLibraryError ? <div className="mt-5 rounded-[18px] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100/85">{musicLibraryError}</div> : null}
            {!musicLibraryBusy && !musicLibraryError && musicLibraryItems.length === 0 ? (
              <div className="mt-5 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/62">No saved music found. Generate music first, then save it to the library.</div>
            ) : null}

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {musicLibraryItems.map((item) => (
                <div key={`${item.fileName}:${item.createdAt || ""}`} className="rounded-[22px] border border-white/10 bg-black/35 p-3">
                  <p className="break-words text-sm font-black text-white">{item.title || item.fileName}</p>
                  <p className="mt-1 text-xs text-white/42">{item.model ? `Model: ${item.model}` : "Saved music"} Ã¢â‚¬Â¢ {formatBytes(item.sizeBytes)}</p>
                  {item.prompt ? <p className="mt-2 line-clamp-2 text-xs text-white/46">{item.prompt}</p> : null}
                  <audio src={item.url} controls preload="metadata" className="mt-3 w-full" />
                  <button
                    type="button"
                    onClick={() => void useMusicFromUrl(item.url, item.fileName)}
                    className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15"
                  >
                    Use This Music
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}



      {activeTool === "voice" ? (
        <EditVideoVoiceDubbingPanel onSaved={onRefreshGallery} />
      ) : null}

      {activeTool === "extract" ? (
        <EditVideoExtractAudioPanel onSaved={onRefreshGallery} />
      ) : null}

      {activeTool === "remove" ? (
        <EditVideoRemoveMusicPanel onRefreshGallery={onRefreshGallery} />
      ) : null}

      {activeTool === "video" ? (
        <EditVideoEditAnythingPanel onRefreshGallery={onRefreshGallery} />
      ) : null}

      {galleryPickerSlot !== null || audioGalleryOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/82 p-4 backdrop-blur-sm">
          <div className="mx-auto max-w-6xl rounded-[28px] border border-white/10 bg-[#080812] p-4 shadow-2xl md:p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200/70">Gallery picker</p>
                <h3 className="mt-1 text-2xl font-black text-white">{audioGalleryOpen ? "Choose video for Audio Editing" : `Choose video for Slot ${galleryPickerSlot}`}</h3>
                <p className="mt-1 text-sm text-white/55">Preview the video first, then press Use This Video.</p>
              </div>
              <button
                type="button"
                onClick={() => { setGalleryPickerSlot(null); setAudioGalleryOpen(false); }}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
              >
                Close
              </button>
            </div>

            {galleryBusy ? <p className="mt-5 text-sm text-white/60">Loading Gallery videos...</p> : null}
            {galleryError ? <div className="mt-5 rounded-[18px] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100/85">{galleryError}</div> : null}
            {!galleryBusy && !galleryError && galleryVideos.length === 0 ? (
              <div className="mt-5 rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/62">No Gallery videos found.</div>
            ) : null}

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
                    <button
                      type="button"
                      onClick={() => selectGalleryVideo(item)}
                      className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/15"
                    >
                      Use This Video
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
