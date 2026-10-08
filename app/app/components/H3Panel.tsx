"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { H3LoraCatalogEntry } from "@/lib/h3LoraCatalogServer";
import {
  buildH3StudioLockedReferences,
  composeH3StudioFinalPrompt,
  h3StudioPromptFingerprint,
  type H3StudioLoraSelection,
  type H3StudioReferenceDescriptor,
} from "@/lib/h3Studio";
import { H3_MEDIA_ACCEPT } from "@/lib/h3MediaTypes";
import {
  H3_STYLE_PRESETS,
  resolveH3PromptBuilderVisualStyle,
  resolveH3StylePreset,
} from "@/lib/h3StylePresets";
import { H3StylePresetPicker } from "./H3StylePresetPicker";
import H3AdvancedControls from "./H3AdvancedControls";
import VideoSnapshotPicker from "./VideoSnapshotPicker";
import {
  DEFAULT_H3_ADVANCED_SETTINGS,
  normalizeH3AdvancedSettings,
  type H3AdvancedSettings,
} from "@/lib/production/h3Settings";
import {
  getH3NativeDimensions,
  getH3ProductionTimeEstimate,
  H3_ORIENTATION_OPTIONS,
  H3_PRODUCTION_DURATION_OPTIONS,
  H3_QUALITY_OPTIONS,
  type H3Orientation,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";
import {
  DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS,
  H3_CAMERA_FEEL_OPTIONS,
  H3_SHOT_FLOW_OPTIONS,
  H3_VISUAL_STYLE_OPTIONS,
} from "@/lib/production/promptOptions";
import {
  compileH3RealismPrompt,
  H3_REALISM_LIMITS,
  H3_REALISM_PRESETS,
  H3_REALISM_SPEED_LORAS,
  normalizeH3RealismLoras,
  validateH3RealismReferences,
  type H3RealismPresetId,
  type H3RealismSpeedLoraId,
} from "@/lib/h3SpecialModes/realism";
import { compileH3BodySwapPrompt } from "@/lib/h3SpecialModes/bodySwap";
import {
  compileH3RefModsPrompt,
  H3_REFMOD_LIMITS,
  normalizeH3RefModSlots,
  refModSlotWarnings,
  type H3RefModCategory,
  type H3RefModComponents,
  type H3RefModLibraryEntry,
  type H3RefModSlot,
  type H3RefModSourceKind,
} from "@/lib/h3SpecialModes/refMods";
import type { ProductionV2H3Mode } from "@/lib/production/h3Workflows";
import { normalizeProfileStorageOwner, profileStorageKey } from "@/lib/client/profileStorage";
import {
  clearPersistedH3InputState,
  clearPersistedH3MediaFiles,
  mediaStorageKey,
  readPersistedH3InputState,
  readPersistedH3MediaFiles,
  writePersistedH3InputState,
  writePersistedH3MediaFiles,
  type PersistedH3InputState,
  type PersistedH3MediaMeta,
  type PersistedH3MediaRecord,
} from "./h3InputPersistence";

type Mode = ProductionV2H3Mode;
type H3StudioMode = Mode | "h3-realism" | "h3-body-swap" | "h3-refmods";
type MediaKind = "image" | "video" | "audio";
type MediaInput = H3StudioReferenceDescriptor & {
  file: File;
  url: string;
  sourceDurationSeconds?: number;
  clipStartSeconds?: number;
  clipDurationSeconds?: number;
};
type H3GenerationConfig = {
  mode: Mode;
  quality: H3Quality;
  orientation: H3Orientation;
  durationSeconds: 5 | 10;
  prompt: string;
  stylePresetId: string;
  h3Settings: H3AdvancedSettings;
  rifeInterpolation60Fps: boolean;
  optionalLoras: H3StudioLoraSelection[];
  imageDescriptions: string[];
  videoDescriptions: string[];
  audioDescriptions: string[];
  videoAudioFlags: boolean[];
  videoClipStartSeconds: number[];
};
type H3StagedUploadDescriptor = {
  id: string;
  kind: MediaKind;
  name: string;
  type: string;
  size: number;
  complete: boolean;
};
type H3StagedGenerationPayload = {
  firstImage?: H3StagedUploadDescriptor;
  lastImage?: H3StagedUploadDescriptor;
  referenceImages: H3StagedUploadDescriptor[];
  referenceVideos: H3StagedUploadDescriptor[];
  referenceAudios: H3StagedUploadDescriptor[];
};
type H3StagedBodySwapPayload = {
  sourceVideo?: H3StagedUploadDescriptor;
  replacementImage?: H3StagedUploadDescriptor;
};
type JobStatus = {
  id: string;
  status: string;
  statusMessage: string;
  mode: H3StudioMode;
  quality: H3Quality;
  orientation: H3Orientation;
  durationSeconds: 5 | 10;
  prompt: string;
  backend: string | null;
  backendLabel: string | null;
  workflowId: string | null;
  workflowFile: string | null;
  nativeResolution: string | null;
  nativeFps?: number;
  finalFps?: number;
  rifeInterpolation60Fps?: boolean;
  etaSeconds: number | null;
  etaMinSeconds: number;
  etaMaxSeconds: number;
  promptId: string | null;
  queueRemaining: number | null;
  progressPercent: number | null;
  currentNode: string | null;
  approximatePreview: {
    label: "Approximate Preview";
    imageUrl: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    step: number | null;
    total: number | null;
    frameCount: number | null;
    updatedAt: number;
    source: "ModelPreviewOverrideKJ";
  } | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  galleryStatus: "pending" | "saving" | "saved" | "failed";
  galleryFileName: string | null;
  galleryUrl: string | null;
  galleryError: string | null;
};
type RefModCreateJobStatus = {
  id: string;
  status: string;
  statusMessage: string;
  backendUrl: string;
  promptId: string | null;
  workflowId: string | null;
  workflowFile: string | null;
  libraryName: string;
  savedPath: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

const MODE_OPTIONS: Array<{ id: H3StudioMode; label: string; detail: string }> = [
  { id: "h3-text-to-video", label: "Text", detail: "Create from a prompt" },
  {
    id: "h3-image-to-video",
    label: "Image",
    detail: "Animate first or first + last frames",
  },
  {
    id: "h3-reference-to-video",
    label: "Reference",
    detail: "Guide with images, video, and audio",
  },
  {
    id: "h3-realism",
    label: "Realism",
    detail: "Structured reference realism",
  },
  {
    id: "h3-body-swap",
    label: "Body Swap",
    detail: "Replace a tracked person",
  },
  {
    id: "h3-refmods",
    label: "Ref Mods",
    detail: "Reuse saved H3 references",
  },
];
const LEGACY_H3_MODES: Mode[] = [
  "h3-text-to-video",
  "h3-image-to-video",
  "h3-reference-to-video",
];
function isLegacyH3Mode(value: H3StudioMode): value is Mode {
  return LEGACY_H3_MODES.includes(value as Mode);
}
const surface =
  "rounded-[8px] border border-white/10 bg-[#090b15]/90 p-4 shadow-[0_18px_45px_rgba(0,0,0,.22)]";
const field =
  "w-full rounded-[6px] border border-white/15 bg-black/45 px-3 py-2 text-sm text-white outline-none focus:border-violet-300/70";
const command =
  "min-h-10 rounded-[6px] border border-white/15 bg-white/[0.06] px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.11] disabled:cursor-not-allowed disabled:opacity-45";
const primary =
  "border-violet-300/60 bg-violet-300 text-[#090b15] hover:bg-violet-200";
const selectedChoice =
  "!border-violet-300/80 !bg-violet-300/20 text-white shadow-[0_0_0_1px_rgba(196,181,253,.12),0_0_18px_rgba(139,92,246,.18)]";
const REFERENCE_LIMIT_HELP =
  "Up to 9 images, 3 videos, and 3 standalone audio references.";
const H3_ANDROID_UPLOAD_BUDGET_BYTES = 90 * 1024 * 1024;
const H3_STAGED_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const H3_STAGED_UPLOAD_MAX_BYTES = 512 * 1024 * 1024;
const QUALITY_LABELS: Record<H3Quality, string> = { sh: "SH", lq: "LQ", hq: "HQ" };
const QUALITY_DETAILS: Record<H3Quality, string> = {
  sh: "Scene Hunter quick scene search",
  lq: "0.6 MP native",
  hq: "1.0 MP native",
};
const H3_LAST_JOB_STORAGE_KEY = "otg:h3:last-direct-job-id:v1";

function refModDefaultStrength(category: H3RefModCategory) {
  return category === "character" ? 0.9 : 1;
}

function createRefModSlot(entry?: H3RefModLibraryEntry): H3RefModSlot {
  const category = entry?.category || "character";
  return {
    id: `refmod-${crypto.randomUUID()}`,
    name: entry?.name || "",
    category,
    sourceKind: entry?.kind || "unknown",
    strength: refModDefaultStrength(category),
    components: "Auto",
    visualStrength: 1,
    audioStrength: 1,
    copies: 1,
    description: entry?.description || "",
    characterId: entry?.characterId || "",
  };
}

function categoryLabel(category: H3RefModCategory) {
  return category === "character"
    ? "Character"
    : category === "motion"
      ? "Motion"
      : category === "audio"
        ? "Audio"
        : category === "bundle"
          ? "Bundle"
          : "Uncategorized";
}
const H3_PERSISTED_JOB_STORAGE_KEY = "otg:h3:persisted-direct-job:v1";
const H3_INPUT_STORAGE_KEY = "otg:h3:generator-inputs:v1";
const H3_REFERENCE_VIDEO_CLIP_SECONDS = 5;

type H3PanelProps = {
  authenticatedOwnerKey?: string;
};

type H3PersistedJob = {
  version: 1;
  savedAt: string;
  job: JobStatus;
};

function isTerminalH3JobStatus(status: string | null | undefined) {
  return status === "completed" || status === "failed" || status === "canceled";
}

function validStoredH3Job(value: unknown): JobStatus | null {
  const job = (value as H3PersistedJob | null)?.job;
  if (!job || typeof job !== "object") return null;
  if (typeof job.id !== "string" || !job.id.trim()) return null;
  if (typeof job.status !== "string" || !job.status.trim()) return null;
  return job as JobStatus;
}

function readPersistedH3Job(storageKey: string) {
  if (typeof window === "undefined") return null;
  try {
    return validStoredH3Job(
      JSON.parse(window.localStorage.getItem(storageKey) || "null"),
    );
  } catch {
    return null;
  }
}

function writePersistedH3Job(storageKey: string, job: JobStatus) {
  if (typeof window === "undefined") return;
  try {
    const payload: H3PersistedJob = {
      version: 1,
      savedAt: new Date().toISOString(),
      job,
    };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {}
}

function clearPersistedH3Job(storageKey: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {}
}

function readRememberedH3JobId(storageKey: string) {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(storageKey) || "";
}

function rememberH3Job(storageKey: string, job: Pick<JobStatus, "id"> | null | undefined) {
  if (typeof window === "undefined" || !job?.id) return;
  window.localStorage.setItem(storageKey, job.id);
}

async function fetchH3JobStatus(id: string) {
  for (const url of h3JobStatusUrls(id)) {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "include",
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok || response.status !== 404) {
      return { response, data: data as { job?: JobStatus; error?: string } };
    }
  }
  const response = new Response(null, { status: 404 });
  return { response, data: { error: "H3 generation job not found." } as { job?: JobStatus; error?: string } };
}

function h3GenerationEndpointFor(jobOrId?: Pick<JobStatus, "id" | "mode"> | string | null) {
  const id = typeof jobOrId === "string" ? jobOrId : jobOrId?.id || "";
  const mode = typeof jobOrId === "string" ? "" : jobOrId?.mode || "";
  if (mode === "h3-body-swap" || id.startsWith("h3-body-swap-")) {
    return "/api/h3/special/body-swap/generation";
  }
  if (mode === "h3-refmods" || id.startsWith("h3-refmods-")) {
    return "/api/h3/special/refmods/generation";
  }
  return mode === "h3-realism" || id.startsWith("h3-realism-")
    ? "/api/h3/special/realism/generation"
    : "/api/h3/generation";
}

function h3GalleryEndpointFor(job: Pick<JobStatus, "id" | "mode">) {
  const generationEndpoint = h3GenerationEndpointFor(job);
  if (generationEndpoint === "/api/h3/special/realism/generation") {
    return "/api/h3/special/realism/generation/gallery";
  }
  if (generationEndpoint === "/api/h3/special/body-swap/generation") {
    return "/api/h3/special/body-swap/generation/gallery";
  }
  if (generationEndpoint === "/api/h3/special/refmods/generation") {
    return "/api/h3/special/refmods/generation/gallery";
  }
  return "/api/h3/generation/gallery";
}

const H3_REFMOD_PENDING_SELECTION_KEY = "otg:h3:pending-refmod-selection:v1";
const H3_REFMOD_USE_IN_H3_EVENT = "otg:h3:use-refmod";

function storePendingRefModSelection(entry: H3RefModLibraryEntry) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(H3_REFMOD_PENDING_SELECTION_KEY, JSON.stringify(entry));
  window.dispatchEvent(new CustomEvent(H3_REFMOD_USE_IN_H3_EVENT, { detail: entry }));
}

function takePendingRefModSelection() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(H3_REFMOD_PENDING_SELECTION_KEY);
  if (!raw) return null;
  window.localStorage.removeItem(H3_REFMOD_PENDING_SELECTION_KEY);
  try {
    const parsed = JSON.parse(raw) as H3RefModLibraryEntry;
    return parsed?.name ? parsed : null;
  } catch {
    return null;
  }
}

function h3JobStatusUrls(id?: string) {
  const endpoints = [
    "/api/h3/generation",
    "/api/h3/special/realism/generation",
    "/api/h3/special/body-swap/generation",
    "/api/h3/special/refmods/generation",
  ];
  if (!id) return endpoints;
  const primary = `${h3GenerationEndpointFor(id)}?jobId=${encodeURIComponent(id)}`;
  return [
    primary,
    ...endpoints
      .filter((endpoint) => endpoint !== h3GenerationEndpointFor(id))
      .map((endpoint) => `${endpoint}?jobId=${encodeURIComponent(id)}`),
  ];
}

function formatDuration(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  return value >= 60
    ? `${Math.floor(value / 60)}m ${value % 60}s`
    : `${value}s`;
}
function elapsedSeconds(job: JobStatus | null, now: number) {
  return job?.startedAt
    ? Math.max(
        0,
        ((job.completedAt ? Date.parse(job.completedAt) : now) -
          Date.parse(job.startedAt)) /
          1000,
      )
    : 0;
}
function choiceClass(selected: boolean) {
  return selected
    ? selectedChoice
    : "!border-white/10 !bg-[#11172a] text-white hover:!bg-white/[0.08]";
}

function MediaPreview({ item }: { item: MediaInput }) {
  if (item.kind === "image")
    return (
      <div className="relative aspect-video w-full min-w-0 overflow-hidden rounded-[6px] bg-black">
        <img
          src={item.url}
          alt={item.name}
          className="absolute inset-0 h-full w-full max-w-full object-contain"
        />
      </div>
    );
  if (item.kind === "video")
    return (
      <div className="relative aspect-video w-full min-w-0 overflow-hidden rounded-[6px] bg-black">
        <video
          src={item.url}
          controls
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full max-w-full object-contain"
        />
      </div>
    );
  return (
    <audio src={item.url} controls preload="metadata" className="w-full" />
  );
}

function formatClipSeconds(value: number) {
  return `${Math.max(0, value).toFixed(2)}s`;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function h3UploadBytes(files: Array<File | null | undefined>) {
  return files.reduce((total, file) => total + (file?.size || 0), 0);
}

function isAndroidUploadRuntime() {
  if (typeof navigator === "undefined") return false;
  return /\bAndroid\b/i.test(navigator.userAgent || "");
}

function h3UploadId() {
  return globalThis.crypto?.randomUUID?.()
    || `h3-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function h3FileSignature(
  item: MediaInput | null | undefined,
) {
  return item
    ? [
        item.id,
        item.kind,
        item.file.name,
        item.file.type,
        item.file.size,
        item.file.lastModified,
      ].join(":")
    : "";
}

function normalizePersistedMode(
  value: unknown,
): Mode {
  const mode =
    String(
      value || "",
    );

  return LEGACY_H3_MODES.includes(
    mode as Mode,
  )
    ? mode as Mode
    : "h3-text-to-video";
}

function normalizePersistedQuality(
  value: unknown,
): H3Quality {
  return H3_QUALITY_OPTIONS.includes(
    value as H3Quality,
  )
    ? value as H3Quality
    : "lq";
}

function normalizePersistedDuration(
  value: unknown,
): 5 | 10 {
  return value === 10
    ? 10
    : 5;
}

function normalizePersistedOrientation(
  value: unknown,
): H3Orientation {
  return H3_ORIENTATION_OPTIONS.includes(
    value as H3Orientation,
  )
    ? value as H3Orientation
    : "landscape";
}

function normalizePersistedPromptSource(
  value: unknown,
): "direct" | "builder" {
  return value === "builder"
    ? "builder"
    : "direct";
}

function normalizePersistedEnhancementLevel(
  value: unknown,
): "short" | "medium" | "long" {
  return value === "short" || value === "long"
    ? value
    : "medium";
}

function h3MediaMeta(
  storageKey: string,
  slot: string,
  item: MediaInput | null,
): PersistedH3MediaMeta | null {
  if (!item) return null;

  return {
    id:
      item.id,
    kind:
      item.kind,
    storageKey:
      mediaStorageKey(
        storageKey,
        slot,
      ),
    name:
      item.file.name || item.name,
    type:
      item.file.type || "",
    size:
      item.file.size,
    lastModified:
      item.file.lastModified || Date.now(),
    description:
      item.description || "",
    includeAudio:
      item.includeAudio,
    sourceDurationSeconds:
      item.sourceDurationSeconds,
    clipStartSeconds:
      item.clipStartSeconds,
    clipDurationSeconds:
      item.clipDurationSeconds,
  };
}

function h3InputMediaRecords(
  storageKey: string,
  firstImage: MediaInput | null,
  lastImage: MediaInput | null,
  references: MediaInput[],
): PersistedH3MediaRecord[] {
  const records: PersistedH3MediaRecord[] = [];

  if (firstImage) {
    records.push(
      {
        key:
          mediaStorageKey(
            storageKey,
            "first-image",
          ),
        file:
          firstImage.file,
      },
    );
  }

  if (lastImage) {
    records.push(
      {
        key:
          mediaStorageKey(
            storageKey,
            "last-image",
          ),
        file:
          lastImage.file,
      },
    );
  }

  references.forEach(
    (item) => {
      records.push(
        {
          key:
            mediaStorageKey(
              storageKey,
              `reference-${item.id}`,
            ),
          file:
            item.file,
        },
      );
    },
  );

  return records;
}

function h3PersistedMediaMetas(
  state: PersistedH3InputState,
) {
  return [
    state.firstImage,
    state.lastImage,
    ...state.references,
  ].filter(
    (item): item is PersistedH3MediaMeta => Boolean(item),
  );
}

function h3SubmitNetworkMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/failed to fetch|networkerror|load failed|cancelled|canceled/i.test(message)) {
    return [
      "H3 upload could not reach the server.",
      "On Android this usually means the selected reference files are too large for the public .win upload path or the connection dropped during upload.",
      "Use a shorter/compressed reference video or fewer references, then try again.",
    ].join(" ");
  }
  return message || "H3 generation could not be submitted.";
}

function h3WorkflowNotice(
  job: JobStatus | null,
  message: string,
): { tone: "info" | "success" | "warning" | "error"; title: string; detail: string } | null {
  const cleanMessage = message.trim();
  if (job) {
    if (job.status === "completed") {
      return {
        tone: "success",
        title: "Workflow completed",
        detail: job.videoUrl
          ? "Final video is ready below."
          : job.statusMessage || "The workflow completed. Refresh if the final video is still saving.",
      };
    }
    if (job.status === "failed") {
      return {
        tone: "error",
        title: "Workflow failed",
        detail: job.error || job.statusMessage || "The H3 workflow failed.",
      };
    }
    if (job.status === "canceled") {
      return {
        tone: "warning",
        title: "Workflow canceled",
        detail: job.statusMessage || "The H3 workflow was canceled.",
      };
    }
    return {
      tone: "info",
      title: job.promptId ? "Workflow accepted" : "Workflow submitted",
      detail:
        job.statusMessage ||
        (job.promptId
          ? "ComfyUI accepted the workflow and generation is running."
          : "The workflow is waiting for ComfyUI acceptance."),
    };
  }
  if (!cleanMessage) return null;
  return {
    tone: /failed|error|could not|too large|must|required|choose|add at least|enter a prompt/i.test(cleanMessage)
      ? "error"
      : "info",
    title: /submitting/i.test(cleanMessage)
      ? "Workflow submitted"
      : /accepted|ready|saved|added|reviewed/i.test(cleanMessage)
        ? "Workflow update"
        : "H3 status",
    detail: cleanMessage,
  };
}

function VideoReferenceWindowControl({
  item,
  onChange,
}: {
  item: MediaInput;
  onChange: (patch: Partial<MediaInput>) => void;
}) {
  const duration = Number(item.sourceDurationSeconds || 0);
  const maxStart = Math.max(0, duration - H3_REFERENCE_VIDEO_CLIP_SECONDS);
  const clipStart = Math.min(
    Math.max(0, Number(item.clipStartSeconds || 0)),
    maxStart,
  );
  const canChoose = duration >= H3_REFERENCE_VIDEO_CLIP_SECONDS;

  return (
    <div className="mt-3 rounded-[6px] border border-cyan-300/20 bg-cyan-300/[0.06] p-3">
      <video
        src={item.url}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => {
          const next = event.currentTarget.duration;
          if (Number.isFinite(next) && next > 0) {
            const nextMax = Math.max(0, next - H3_REFERENCE_VIDEO_CLIP_SECONDS);
            onChange({
              sourceDurationSeconds: next,
              clipStartSeconds: Math.min(clipStart, nextMax),
              clipDurationSeconds: H3_REFERENCE_VIDEO_CLIP_SECONDS,
            });
          }
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-cyan-100">
            5-second reference window
          </p>
          <p className="mt-1 text-[11px] text-white/45">
            Only this selected portion is sent to H3.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 bg-black/35 px-2 py-1 text-[11px] font-bold text-white/70">
          {formatClipSeconds(clipStart)} -{" "}
          {formatClipSeconds(clipStart + H3_REFERENCE_VIDEO_CLIP_SECONDS)}
        </span>
      </div>
      <input
        aria-label="Reference video 5-second start time"
        className="mt-3 w-full"
        type="range"
        min={0}
        max={Math.max(0, maxStart)}
        step="0.05"
        value={clipStart}
        disabled={!canChoose}
        onChange={(event) =>
          onChange({
            clipStartSeconds: Number(event.target.value),
            clipDurationSeconds: H3_REFERENCE_VIDEO_CLIP_SECONDS,
          })
        }
      />
      <div className="mt-1 flex justify-between text-[11px] text-white/40">
        <span>0.00s</span>
        <span>
          {duration > 0
            ? `${formatClipSeconds(duration)} source`
            : "Reading video length..."}
        </span>
      </div>
      {duration > 0 && !canChoose ? (
        <p className="mt-2 rounded-[6px] border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-xs text-amber-100">
          Reference video must be at least {H3_REFERENCE_VIDEO_CLIP_SECONDS}{" "}
          seconds long.
        </p>
      ) : null}
    </div>
  );
}

function GalleryPicker({
  kind,
  onPick,
  onClose,
}: {
  kind: "image" | "video";
  onPick: (file: File) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<
    Array<{ name: string; url: string; kind?: string; video?: boolean }>
  >([]);
  const [message, setMessage] = useState("Loading Gallery...");
  useEffect(() => {
    void fetch(`/api/gallery?media=${kind}&sort=newest&per=80`, {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data.items)
          ? data.items
          : Array.isArray(data.files)
            ? data.files
            : [];
        setItems(
          list.filter((item: any) =>
            kind === "video"
              ? item.video === true || item.kind === "video"
              : item.video !== true && item.kind !== "video",
          ),
        );
        setMessage("");
      })
      .catch(() => setMessage("Gallery could not be loaded."));
  }, [kind]);
  async function choose(item: { name: string; url: string }) {
    setMessage("Loading selection...");
    const response = await fetch(item.url, { credentials: "include" });
    if (!response.ok) return setMessage("Gallery media could not be read.");
    const blob = await response.blob();
    onPick(
      new File([blob], item.name || `gallery-${kind}`, { type: blob.type }),
    );
    onClose();
  }
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-3"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-[8px] border border-violet-300/30 bg-[#080a13] p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black">
            Gallery {kind === "image" ? "Images" : "Videos"}
          </h2>
          <button className={command} onClick={onClose}>
            Close
          </button>
        </div>
        {message ? (
          <p className="text-sm text-white/60">{message}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {items.map((item, index) => (
              <button
                key={`${item.name}-${index}`}
                className="overflow-hidden rounded-[6px] border border-white/10 bg-black text-left"
                onClick={() => void choose(item)}
              >
                {kind === "image" ? (
                  <img
                    src={item.url}
                    alt={item.name}
                    className="aspect-video w-full object-contain"
                  />
                ) : (
                  <video
                    src={item.url}
                    className="aspect-video w-full object-contain"
                    preload="metadata"
                  />
                )}
                <span className="block truncate p-2 text-xs">{item.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default function H3Panel({ authenticatedOwnerKey = "" }: H3PanelProps) {
  const storageOwnerKey = useMemo(
    () => normalizeProfileStorageOwner(authenticatedOwnerKey),
    [authenticatedOwnerKey],
  );
  const h3JobStorageKey = useMemo(
    () => profileStorageKey(H3_PERSISTED_JOB_STORAGE_KEY, storageOwnerKey),
    [storageOwnerKey],
  );
  const h3LastJobStorageKey = useMemo(
    () => profileStorageKey(H3_LAST_JOB_STORAGE_KEY, storageOwnerKey),
    [storageOwnerKey],
  );
  const h3InputStorageKey = useMemo(
    () => profileStorageKey(H3_INPUT_STORAGE_KEY, storageOwnerKey),
    [storageOwnerKey],
  );
  const [mode, setMode] = useState<Mode>("h3-text-to-video");
  const [studioMode, setStudioMode] =
    useState<H3StudioMode>("h3-text-to-video");
  const [quality, setQuality] = useState<H3Quality>("lq");
  const [h3Settings, setH3Settings] =
    useState<H3AdvancedSettings>(DEFAULT_H3_ADVANCED_SETTINGS);
  const [rifeInterpolation60Fps, setRifeInterpolation60Fps] = useState(false);
  const [duration, setDuration] = useState<5 | 10>(5);
  const [orientation, setOrientation] =
    useState<H3Orientation>("landscape");
  const [originalPrompt, setOriginalPrompt] = useState("");
  const [undoPrompt, setUndoPrompt] = useState("");
  const [scenePrompt, setScenePrompt] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [suggestionDraft, setSuggestionDraft] = useState("");
  const [reviewedFingerprint, setReviewedFingerprint] = useState("");
  const [promptSource, setPromptSource] = useState<"direct" | "builder">(
    "direct",
  );
  const [visualStyle, setVisualStyle] = useState<string>(
    DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.visualStyle,
  );
  const [stylePresetId, setStylePresetId] = useState("none");
  const [cameraFeel, setCameraFeel] = useState<string>(
    DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.cameraFeel,
  );
  const [shotFlow, setShotFlow] = useState<string>(
    DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.shotFlow,
  );
  const [realismPrompt, setRealismPrompt] = useState("");
  const [realismReferences, setRealismReferences] = useState<MediaInput[]>([]);
  const [realismPreset, setRealismPreset] =
    useState<H3RealismPresetId>("balanced");
  const [realismSpeedLora, setRealismSpeedLora] =
    useState<H3RealismSpeedLoraId>(
      H3_REALISM_PRESETS.balanced.speedLora,
    );
  const [realismPeopleEnabled, setRealismPeopleEnabled] = useState(true);
  const [realismSeedMode, setRealismSeedMode] =
    useState<"random" | "fixed">("random");
  const [realismSeed, setRealismSeed] = useState("");
  const [realismExpertEdit, setRealismExpertEdit] = useState(false);
  const [realismCompiledPromptDraft, setRealismCompiledPromptDraft] =
    useState("");
  const [bodySwapSourceVideo, setBodySwapSourceVideo] =
    useState<MediaInput | null>(null);
  const [bodySwapReplacementImage, setBodySwapReplacementImage] =
    useState<MediaInput | null>(null);
  const [bodySwapSelector, setBodySwapSelector] = useState("person");
  const [bodySwapPrompt, setBodySwapPrompt] = useState("");
  const [bodySwapPreserveAudio, setBodySwapPreserveAudio] = useState(true);
  const [bodySwapSeedMode, setBodySwapSeedMode] =
    useState<"random" | "fixed">("random");
  const [bodySwapSeed, setBodySwapSeed] = useState("");
  const [refModsPrompt, setRefModsPrompt] = useState("");
  const [refModSlots, setRefModSlots] = useState<H3RefModSlot[]>([]);
  const [refModLibrary, setRefModLibrary] = useState<H3RefModLibraryEntry[]>([]);
  const [refModLibraryStatus, setRefModLibraryStatus] =
    useState<"idle" | "loading" | "ready" | "error">("idle");
  const [refModLibraryMessage, setRefModLibraryMessage] = useState("");
  const [refModPickerOpen, setRefModPickerOpen] = useState(false);
  const [refModPickerFilter, setRefModPickerFilter] =
    useState<"all" | H3RefModCategory>("all");
  const [refModPickerSearch, setRefModPickerSearch] = useState("");
  const [refModsTurbo, setRefModsTurbo] = useState(true);
  const [refModsSeedMode, setRefModsSeedMode] =
    useState<"random" | "fixed">("random");
  const [refModsSeed, setRefModsSeed] = useState("");
  const [refModCreateKind, setRefModCreateKind] =
    useState<"character" | "motion" | "audio">("character");
  const [refModCreateMotionType, setRefModCreateMotionType] =
    useState<"subject" | "camera_scene">("subject");
  const [refModCreateIsolateSubject, setRefModCreateIsolateSubject] =
    useState(true);
  const [refModCreateName, setRefModCreateName] = useState("");
  const [refModCreateDescription, setRefModCreateDescription] = useState("");
  const [refModCreateAudioCategory, setRefModCreateAudioCategory] =
    useState<"music" | "ambience" | "sound_fx">("ambience");
  const [refModCreateReplace, setRefModCreateReplace] = useState(false);
  const [refModCreateImages, setRefModCreateImages] = useState<File[]>([]);
  const [refModCreateVideo, setRefModCreateVideo] = useState<File | null>(null);
  const [refModCreateAudio, setRefModCreateAudio] = useState<File | null>(null);
  const [refModCreateJob, setRefModCreateJob] =
    useState<RefModCreateJobStatus | null>(null);
  const [firstImage, setFirstImage] = useState<MediaInput | null>(null);
  const [lastImage, setLastImage] = useState<MediaInput | null>(null);
  const [references, setReferences] = useState<MediaInput[]>([]);
  const [catalog, setCatalog] = useState<H3LoraCatalogEntry[]>([]);
  const [maxLoras, setMaxLoras] = useState(3);
  const [selectedLoras, setSelectedLoras] = useState<H3StudioLoraSelection[]>(
    [],
  );
  const [galleryTarget, setGalleryTarget] = useState<
    "first" | "last" | "reference-image" | "reference-video" | ""
  >("");
  const [snapshotTarget, setSnapshotTarget] = useState<
    "first" | "last" | "reference-image" | ""
  >("");
  const [enhancing, setEnhancing] = useState("");
  const [enhancementLevel, setEnhancementLevel] = useState<
    "short" | "medium" | "long"
  >("medium");
  const [building, setBuilding] = useState(false);
  const [micState, setMicState] = useState<
    "idle" | "listening" | "processing" | "done" | "error"
  >("idle");
  const [job, setJob] = useState<JobStatus | null>(() => readPersistedH3Job(h3JobStorageKey));
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelRecordingRef = useRef(false);
  const objectUrlsRef = useRef(new Set<string>());
  const promptVideoUploadCacheRef = useRef(
    new Map<
      string,
      {
        signature: string;
        upload: H3StagedUploadDescriptor;
      }
    >(),
  );
  const [inputStateHydrated, setInputStateHydrated] = useState(false);
  const active = Boolean(job && !isTerminalH3JobStatus(job.status));
  const legacyModeActive = isLegacyH3Mode(studioMode);
  const specialModeLabel =
    MODE_OPTIONS.find((item) => item.id === studioMode)?.label || "H3";
  const realismLoras = useMemo(
    () =>
      normalizeH3RealismLoras({
        preset: realismPreset,
        speedLora: realismSpeedLora,
        peopleRealismEnabled: realismPeopleEnabled,
      }),
    [realismPreset, realismSpeedLora, realismPeopleEnabled],
  );
  const estimate = useMemo(
    () =>
      getH3ProductionTimeEstimate(mode, duration, quality, job?.backend as any),
    [mode, duration, quality, job?.backend],
  );
  const descriptors = references.map(
    ({ id, kind, name, description, includeAudio, clipStartSeconds, clipDurationSeconds }) => ({
      id,
      kind,
      name,
      description,
      includeAudio,
      clipStartSeconds,
      clipDurationSeconds,
    }),
  );
  const refModReferenceOptions = references
    .filter((item) => item.kind === "image")
    .map((item, index) => ({
      label: item.name || `Picture ${index + 1}`,
    }));
  const videoReferences = references.filter((item) => item.kind === "video");
  const videoReferenceTooShort = videoReferences.some(
    (item) =>
      Number(item.sourceDurationSeconds || 0) > 0
      && Number(item.sourceDurationSeconds || 0) < H3_REFERENCE_VIDEO_CLIP_SECONDS,
  );
  const selectedStylePreset = resolveH3StylePreset(stylePresetId);
  const promptBuilderVisualStyle =
    resolveH3PromptBuilderVisualStyle(stylePresetId, visualStyle);

  const promptContext = {
    mode,
    quality,
    orientation,
    durationSeconds: duration,
    originalPrompt,
    scenePrompt,
    stylePresetId,
    visualStyle: promptBuilderVisualStyle,
    cameraFeel,
    shotFlow,
    firstImageName: firstImage?.name,
    lastImageName: lastImage?.name,
    references: descriptors,
    loras: selectedLoras,
  };
  const currentFingerprint =
    `${h3StudioPromptFingerprint(promptContext)}|stylePreset:${stylePresetId}`;
  const builderPromptStale =
    promptSource === "builder"
    && (!reviewedFingerprint || reviewedFingerprint !== currentFingerprint);
  const generationPrompt =
    promptSource === "builder" ? scenePrompt : originalPrompt;
  const hasReferenceVideo =
    legacyModeActive
    && mode === "h3-reference-to-video"
    && references.some((item) => item.kind === "video");
  const canBuildPrompt =
    legacyModeActive
    && (Boolean(originalPrompt.trim()) || hasReferenceVideo);
  const lockedReferences = buildH3StudioLockedReferences(promptContext);
  const exactFinalPrompt = composeH3StudioFinalPrompt(
    lockedReferences,
    generationPrompt,
  );
  const nativeDimensions = getH3NativeDimensions(quality, orientation);
  const realismCompiledPrompt = useMemo(() => {
    if (!realismPrompt.trim()) return "";
    try {
      return compileH3RealismPrompt({
        prompt: realismPrompt,
        durationSeconds: duration,
        orientation,
        references: realismReferences.map((item) => ({
          kind: item.kind,
          name: item.name,
          description: item.description,
          durationSeconds: item.sourceDurationSeconds,
        })),
        loras: realismLoras,
      });
    } catch {
      return "";
    }
  }, [
    realismPrompt,
    duration,
    orientation,
    realismReferences,
    realismLoras,
  ]);
  const finalRealismPrompt =
    realismExpertEdit && realismCompiledPromptDraft.trim()
      ? realismCompiledPromptDraft
      : realismCompiledPrompt;
  const realismReferenceCounts = {
    image: realismReferences.filter((item) => item.kind === "image").length,
    video: realismReferences.filter((item) => item.kind === "video").length,
    audio: realismReferences.filter((item) => item.kind === "audio").length,
  };
  const realismReferenceLimitMessage = useMemo(() => {
    try {
      validateH3RealismReferences(
        realismReferences.map((item) => ({
          kind: item.kind,
          name: item.name,
          description: item.description,
          durationSeconds: item.sourceDurationSeconds,
        })),
      );
      return "";
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "Realism reference limits are invalid.";
    }
  }, [realismReferences]);
  const bodySwapCompiledPrompt = useMemo(
    () =>
      compileH3BodySwapPrompt({
        prompt: bodySwapPrompt,
        selector: bodySwapSelector,
        preserveOriginalAudio: bodySwapPreserveAudio,
      }),
    [bodySwapPrompt, bodySwapSelector, bodySwapPreserveAudio],
  );
  const refModsCompiledPrompt = useMemo(() => {
    if (!refModsPrompt.trim() || !refModSlots.length) return "";
    try {
      return compileH3RefModsPrompt({
        prompt: refModsPrompt,
        refMods: refModSlots,
      });
    } catch {
      return "";
    }
  }, [refModsPrompt, refModSlots]);
  const filteredRefModLibrary = useMemo(() => {
    const search = refModPickerSearch.trim().toLowerCase();
    return refModLibrary.filter((entry) => {
      const categoryMatch =
        refModPickerFilter === "all" || entry.category === refModPickerFilter;
      const haystack = `${entry.name} ${entry.category} ${entry.kind} ${entry.description || ""}`.toLowerCase();
      return categoryMatch && (!search || haystack.includes(search));
    });
  }, [refModLibrary, refModPickerFilter, refModPickerSearch]);
  const refModsWarningMessages = refModSlots.flatMap(refModSlotWarnings);
  const refModsValidationMessage = useMemo(() => {
    try {
      normalizeH3RefModSlots(refModSlots);
      if (refModSlots.length > H3_REFMOD_LIMITS.maxRefMods) {
        return `Use at most ${H3_REFMOD_LIMITS.maxRefMods} RefMods.`;
      }
      if (
        refModsSeedMode === "fixed"
        && (
          !Number.isSafeInteger(Number(refModsSeed))
          || Number(refModsSeed) < 0
        )
      ) {
        return "Enter a non-negative whole-number Ref Mods seed.";
      }
      return "";
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "Ref Mods settings are invalid.";
    }
  }, [refModSlots, refModsSeedMode, refModsSeed]);
  const refModCreateValidationMessage = useMemo(() => {
    if (!refModCreateName.trim()) return "Name the RefMod before creating it.";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(refModCreateName.trim())) {
      return "Use a file-safe RefMod name without spaces, slashes, or extension.";
    }
    if (refModCreateKind === "character") {
      if (refModCreateImages.length < 4 || refModCreateImages.length > 8) {
        return "Character RefMods require 4-8 images.";
      }
    } else if (refModCreateKind === "motion") {
      if (!refModCreateVideo) return "Choose one motion video clip.";
    } else if (!refModCreateAudio) {
      return "Choose one audio clip.";
    }
    return "";
  }, [
    refModCreateName,
    refModCreateKind,
    refModCreateMotionType,
    refModCreateIsolateSubject,
    refModCreateImages.length,
    refModCreateVideo,
    refModCreateAudio,
  ]);
  const canGenerate = Boolean(
    legacyModeActive
      && generationPrompt.trim()
      && !builderPromptStale
      && (mode !== "h3-image-to-video" || firstImage)
      && (mode !== "h3-reference-to-video" || references.length)
      && !videoReferenceTooShort,
  );
  const canGenerateRealism = Boolean(
    studioMode === "h3-realism"
      && realismPrompt.trim()
      && finalRealismPrompt.trim()
      && !realismReferenceLimitMessage
      && (
        realismSeedMode === "random"
        || (
          Number.isSafeInteger(Number(realismSeed))
          && Number(realismSeed) >= 0
        )
      ),
  );
  const canGenerateBodySwap = Boolean(
    studioMode === "h3-body-swap"
      && bodySwapSourceVideo
      && bodySwapReplacementImage
      && bodySwapSelector.trim()
      && (
        bodySwapSeedMode === "random"
        || (
          Number.isSafeInteger(Number(bodySwapSeed))
          && Number(bodySwapSeed) >= 0
        )
      ),
  );
  const canGenerateRefMods = Boolean(
    studioMode === "h3-refmods"
      && refModsPrompt.trim()
      && refModSlots.length
      && refModsCompiledPrompt.trim()
      && !refModsValidationMessage,
  );
  const workflowNotice = h3WorkflowNotice(job, message);
  const workflowNoticeClass =
    workflowNotice?.tone === "success"
      ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-50"
      : workflowNotice?.tone === "error"
        ? "border-red-300/30 bg-red-500/10 text-red-50"
        : workflowNotice?.tone === "warning"
          ? "border-amber-300/30 bg-amber-300/10 text-amber-50"
          : "border-cyan-300/30 bg-cyan-400/10 text-cyan-50";
  const mediaFileSignature = useMemo(
    () => [
      h3FileSignature(firstImage),
      h3FileSignature(lastImage),
      ...references.map(h3FileSignature),
    ].join("|"),
    [
      firstImage,
      lastImage,
      references,
    ],
  );

  useEffect(() => {
    if (job) writePersistedH3Job(h3JobStorageKey, job);
    else clearPersistedH3Job(h3JobStorageKey);
  }, [h3JobStorageKey, job]);

  useEffect(() => {
    let cancelled = false;

    async function restoreInputs() {
      setInputStateHydrated(false);
      promptVideoUploadCacheRef.current.clear();

      const stored =
        readPersistedH3InputState(
          h3InputStorageKey,
        );

      if (!stored) {
        releaseAllMedia();
        setInputStateHydrated(true);
        return;
      }

      const metas =
        h3PersistedMediaMetas(
          stored,
        );

      const files =
        await readPersistedH3MediaFiles(
          metas,
        );

      if (cancelled) return;

      releaseAllMedia();
      const restoredMode = normalizePersistedMode(stored.mode);
      setMode(restoredMode);
      setStudioMode(restoredMode);
      setQuality(normalizePersistedQuality(stored.quality));
      setRifeInterpolation60Fps(stored.rifeInterpolation60Fps === true);
      setH3Settings(
        normalizeH3AdvancedSettings(
          stored.h3Settings,
          stored.references.filter((item) => item.kind === "image").length,
        ),
      );
      setDuration(normalizePersistedDuration(stored.duration));
      setOrientation(normalizePersistedOrientation(stored.orientation));
      setOriginalPrompt(stored.originalPrompt || "");
      setUndoPrompt(stored.undoPrompt || "");
      setScenePrompt(stored.scenePrompt || "");
      setSuggestion(stored.suggestion || "");
      setSuggestionDraft(stored.suggestionDraft || "");
      setReviewedFingerprint(stored.reviewedFingerprint || "");
      setPromptSource(normalizePersistedPromptSource(stored.promptSource));
      setVisualStyle(
        H3_VISUAL_STYLE_OPTIONS.includes(stored.visualStyle as any)
          ? stored.visualStyle
          : DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.visualStyle,
      );
      setStylePresetId(
        resolveH3StylePreset(stored.stylePresetId)?.id || "none",
      );
      setCameraFeel(
        H3_CAMERA_FEEL_OPTIONS.includes(stored.cameraFeel as any)
          ? stored.cameraFeel
          : DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.cameraFeel,
      );
      setShotFlow(
        H3_SHOT_FLOW_OPTIONS.includes(stored.shotFlow as any)
          ? stored.shotFlow
          : DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.shotFlow,
      );
      setSelectedLoras(
        Array.isArray(stored.selectedLoras)
          ? stored.selectedLoras
              .map((item) => ({
                id: String(item.id || "").trim(),
                strength: Number(item.strength),
              }))
              .filter((item) => item.id && Number.isFinite(item.strength))
          : [],
      );
      setEnhancementLevel(
        normalizePersistedEnhancementLevel(
          stored.enhancementLevel,
        ),
      );
      setFirstImage(
        stored.firstImage
          ? mediaFromPersisted(
              stored.firstImage,
              files.get(stored.firstImage.storageKey),
            )
          : null,
      );
      setLastImage(
        stored.lastImage
          ? mediaFromPersisted(
              stored.lastImage,
              files.get(stored.lastImage.storageKey),
            )
          : null,
      );
      setReferences(
        stored.references
          .map((item) =>
            mediaFromPersisted(
              item,
              files.get(item.storageKey),
            ),
          )
          .filter((item): item is MediaInput => Boolean(item)),
      );
      setMessage("Restored your saved H3 generator inputs.");
      setInputStateHydrated(true);
    }

    void restoreInputs();

    return () => {
      cancelled = true;
    };
  }, [h3InputStorageKey]);

  useEffect(() => {
    if (!inputStateHydrated) return;

    writePersistedH3InputState(
      h3InputStorageKey,
      {
        version: 1,
        savedAt: new Date().toISOString(),
        mode,
        quality,
        h3Settings,
        rifeInterpolation60Fps,
        duration,
        orientation,
        originalPrompt,
        undoPrompt,
        scenePrompt,
        suggestion,
        suggestionDraft,
        reviewedFingerprint,
        promptSource,
        visualStyle,
        stylePresetId,
        cameraFeel,
        shotFlow,
        selectedLoras,
        enhancementLevel,
        firstImage:
          h3MediaMeta(
            h3InputStorageKey,
            "first-image",
            firstImage,
          ),
        lastImage:
          h3MediaMeta(
            h3InputStorageKey,
            "last-image",
            lastImage,
          ),
        references:
          references.map((item) =>
            h3MediaMeta(
              h3InputStorageKey,
              `reference-${item.id}`,
              item,
            ),
          ).filter(
            (item): item is PersistedH3MediaMeta => Boolean(item),
          ),
      },
    );
  }, [
    inputStateHydrated,
    h3InputStorageKey,
    mode,
    quality,
    h3Settings,
    rifeInterpolation60Fps,
    duration,
    orientation,
    originalPrompt,
    undoPrompt,
    scenePrompt,
    suggestion,
    suggestionDraft,
    reviewedFingerprint,
    promptSource,
    visualStyle,
    stylePresetId,
    cameraFeel,
    shotFlow,
    selectedLoras,
    enhancementLevel,
    firstImage,
    lastImage,
    references,
  ]);

  useEffect(() => {
    if (!inputStateHydrated) return;

    void writePersistedH3MediaFiles(
      h3InputStorageKey,
      h3InputMediaRecords(
        h3InputStorageKey,
        firstImage,
        lastImage,
        references,
      ),
    ).catch(
      () => undefined,
    );
  }, [
    inputStateHydrated,
    h3InputStorageKey,
    mediaFileSignature,
  ]);

  useEffect(() => {
    if (!legacyModeActive) {
      setCatalog([]);
      setMaxLoras(0);
      setSelectedLoras([]);
      return;
    }
    void fetch(`/api/h3/loras?mode=${encodeURIComponent(mode)}`, {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        const entries = Array.isArray(data.entries) ? data.entries : [];
        setCatalog(entries);
        setMaxLoras(Number(data.maxSelections) || 3);
        setSelectedLoras((current) => {
          const removed = current.filter(
            (selection) =>
              !entries.some(
                (entry: H3LoraCatalogEntry) => entry.id === selection.id,
              ),
          );
          if (removed.length)
            setMessage(
              `Removed ${removed.map((item) => item.id).join(", ")} because it is not approved or available for ${MODE_OPTIONS.find((item) => item.id === mode)?.label}.`,
            );
          return current.filter((selection) =>
            entries.some(
              (entry: H3LoraCatalogEntry) => entry.id === selection.id,
            ),
          );
        });
      })
      .catch(() =>
        setMessage("The approved H3 LoRA catalog could not be loaded."),
      );
  }, [legacyModeActive, mode]);
  useEffect(() => {
    if (studioMode !== "h3-refmods" || refModLibraryStatus !== "idle") return;
    let cancelled = false;
    setRefModLibraryStatus("loading");
    void fetch("/api/h3/special/refmods/library", {
      cache: "no-store",
      credentials: "include",
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok || !data.ok) throw new Error(data.error || "Could not read RefMod library.");
        setRefModLibrary(Array.isArray(data.entries) ? data.entries : []);
        setRefModLibraryStatus("ready");
        setRefModLibraryMessage(
          `${Array.isArray(data.entries) ? data.entries.length : 0} RefMods found.`,
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setRefModLibraryStatus("error");
        setRefModLibraryMessage(
          error instanceof Error
            ? error.message
            : "Could not read RefMod library.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [studioMode, refModLibraryStatus]);
  useEffect(() => {
    function consume(entry: H3RefModLibraryEntry | null) {
      if (!entry?.name) return;
      setStudioMode("h3-refmods");
      setRefModLibraryStatus("idle");
      addRefModSlot(entry);
      setMessage(`Added ${entry.name} to Ref Mods.`);
    }
    consume(takePendingRefModSelection());
    const handler = (event: Event) => {
      consume((event as CustomEvent<H3RefModLibraryEntry>).detail || takePendingRefModSelection());
    };
    window.addEventListener(H3_REFMOD_USE_IN_H3_EVENT, handler);
    return () => window.removeEventListener(H3_REFMOD_USE_IN_H3_EVENT, handler);
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (!active || !job) return;
    const timer = setInterval(() => void refreshJob(job.id), 4000);
    return () => clearInterval(timer);
  }, [active, job?.id]);
  useEffect(() => {
    const jobId = refModCreateJob?.id;
    const running = Boolean(
      refModCreateJob
        && !["completed", "failed"].includes(refModCreateJob.status),
    );
    if (!running || !jobId) return;
    const timer = setInterval(() => void refreshRefModCreateJob(jobId), 4000);
    return () => clearInterval(timer);
  }, [refModCreateJob?.id, refModCreateJob?.status]);
  useEffect(() => {
    let cancelled = false;
    async function restoreLatestJob() {
      const rememberedId = readRememberedH3JobId(h3LastJobStorageKey);
      const urls = [
        ...h3JobStatusUrls(),
        ...(rememberedId ? h3JobStatusUrls(rememberedId) : []),
      ].filter(Boolean);
      for (const url of urls) {
        const response = await fetch(url, {
          cache: "no-store",
          credentials: "include",
        }).catch(() => null);
        if (!response) continue;
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (response.ok && data.job) {
          setJob(data.job);
          rememberH3Job(h3LastJobStorageKey, data.job);
          setNow(Date.now());
          return;
        }
      }
    }
    void restoreLatestJob();
    return () => {
      cancelled = true;
    };
  }, [h3LastJobStorageKey]);
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  function releaseAllMedia() {
    objectUrlsRef.current.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    objectUrlsRef.current.clear();
  }

  function mediaFromPersisted(
    meta: PersistedH3MediaMeta,
    file: File | undefined,
  ): MediaInput | null {
    if (!file) return null;

    const url =
      URL.createObjectURL(
        file,
      );

    objectUrlsRef.current.add(
      url,
    );

    return {
      id:
        meta.id,
      kind:
        meta.kind,
      file,
      url,
      name:
        meta.name || file.name,
      description:
        meta.description || "",
      includeAudio:
        meta.includeAudio === true,
      sourceDurationSeconds:
        meta.sourceDurationSeconds,
      clipStartSeconds:
        meta.kind === "video"
          ? Number(meta.clipStartSeconds || 0)
          : undefined,
      clipDurationSeconds:
        meta.kind === "video"
          ? H3_REFERENCE_VIDEO_CLIP_SECONDS
          : undefined,
    };
  }

  function media(file: File, kind: MediaKind): MediaInput {
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.add(url);
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind,
      file,
      url,
      name: file.name,
      description: "",
      includeAudio: false,
      clipStartSeconds: kind === "video" ? 0 : undefined,
      clipDurationSeconds:
        kind === "video" ? H3_REFERENCE_VIDEO_CLIP_SECONDS : undefined,
    };
  }
  function release(item: MediaInput | null) {
    if (item) {
      URL.revokeObjectURL(item.url);
      objectUrlsRef.current.delete(item.url);
    }
  }
  function replaceSingle(
    current: MediaInput | null,
    file: File,
    setter: (item: MediaInput | null) => void,
  ) {
    release(current);
    setter(media(file, "image"));
  }
  function replaceMedia(
    current: MediaInput | null,
    file: File,
    kind: MediaKind,
    setter: (item: MediaInput | null) => void,
  ) {
    release(current);
    setter(media(file, kind));
  }
  function addReference(kind: MediaKind, file: File) {
    const limit = kind === "image" ? 9 : 3;
    if (references.filter((item) => item.kind === kind).length >= limit)
      return setMessage(`H3 supports at most ${limit} ${kind} references.`);
    setReferences((current) => [...current, media(file, kind)]);
  }
  function addRealismReference(kind: MediaKind, file: File) {
    const next = [...realismReferences, media(file, kind)];
    try {
      validateH3RealismReferences(
        next.map((item) => ({
          kind: item.kind,
          name: item.name,
          description: item.description,
          durationSeconds: item.sourceDurationSeconds,
        })),
      );
      setRealismReferences(next);
      setMessage("");
    } catch (error) {
      release(next[next.length - 1]);
      setMessage(
        error instanceof Error
          ? error.message
          : "Realism reference limit exceeded.",
      );
    }
  }
  function updateRealismReference(id: string, patch: Partial<MediaInput>) {
    setRealismReferences((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }
  function removeRealismReference(id: string) {
    setRealismReferences((current) => {
      release(current.find((item) => item.id === id) || null);
      return current.filter((item) => item.id !== id);
    });
  }
  function applyRealismPreset(id: H3RealismPresetId) {
    const preset = H3_REALISM_PRESETS[id] || H3_REALISM_PRESETS.balanced;
    setRealismPreset(preset.id);
    setRealismSpeedLora(preset.speedLora);
    setRealismPeopleEnabled(preset.peopleRealismEnabled);
  }
  function selectStudioMode(nextMode: H3StudioMode) {
    setStudioMode(nextMode);
    if (isLegacyH3Mode(nextMode)) {
      setMode(nextMode);
      setMessage("");
      return;
    }
    setSelectedLoras([]);
    setPromptSource("direct");
    setMessage(
      nextMode === "h3-realism"
        ? "Realism uses its dedicated TEST workflow adapter and will not call the legacy H3 route."
        : nextMode === "h3-refmods"
          ? "Ref Mods is isolated from legacy H3 while its dedicated T2V adapter is validated."
        : `${MODE_OPTIONS.find((item) => item.id === nextMode)?.label || "This mode"} is isolated while its dedicated adapter is being prepared.`,
    );
  }
  function updateReference(id: string, patch: Partial<MediaInput>) {
    setReferences((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }
  function removeReference(id: string) {
    setReferences((current) => {
      release(current.find((item) => item.id === id) || null);
      promptVideoUploadCacheRef.current.delete(id);
      return current.filter((item) => item.id !== id);
    });
  }

  function resetH3Inputs() {
    releaseAllMedia();
    promptVideoUploadCacheRef.current.clear();
    setMode("h3-text-to-video");
    setStudioMode("h3-text-to-video");
    setQuality("lq");
    setH3Settings(DEFAULT_H3_ADVANCED_SETTINGS);
    setDuration(5);
    setOrientation("landscape");
    setOriginalPrompt("");
    setUndoPrompt("");
    setScenePrompt("");
    setSuggestion("");
    setSuggestionDraft("");
    setReviewedFingerprint("");
    setPromptSource("direct");
    setVisualStyle(DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.visualStyle);
    setStylePresetId("none");
    setCameraFeel(DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.cameraFeel);
    setShotFlow(DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.shotFlow);
    setRealismPrompt("");
    setRealismReferences([]);
    applyRealismPreset("balanced");
    setRealismSeedMode("random");
    setRealismSeed("");
    setRealismExpertEdit(false);
    setRealismCompiledPromptDraft("");
    setBodySwapSourceVideo(null);
    setBodySwapReplacementImage(null);
    setBodySwapSelector("person");
    setBodySwapPrompt("");
    setBodySwapPreserveAudio(true);
    setBodySwapSeedMode("random");
    setBodySwapSeed("");
    setRefModsPrompt("");
    setRefModSlots([]);
    setRefModsTurbo(true);
    setRefModsSeedMode("random");
    setRefModsSeed("");
    setFirstImage(null);
    setLastImage(null);
    setReferences([]);
    setSelectedLoras([]);
    setEnhancementLevel("medium");
    setMessage("H3 generator inputs reset.");
    clearPersistedH3InputState(h3InputStorageKey);
    void clearPersistedH3MediaFiles(
      h3InputStorageKey,
    ).catch(
      () => undefined,
    );
  }

  function referenceMoveTarget(index: number, delta: number) {
    const kind = references[index]?.kind;
    const matching = references
      .map((item, itemIndex) => (item.kind === kind ? itemIndex : -1))
      .filter((itemIndex) => itemIndex >= 0);
    const position = matching.indexOf(index);
    return matching[position + delta] ?? -1;
  }
  function moveReference(index: number, delta: number) {
    setReferences((current) => {
      const next = [...current];
      const kind = next[index]?.kind;
      const matching = next
        .map((item, itemIndex) => (item.kind === kind ? itemIndex : -1))
        .filter((itemIndex) => itemIndex >= 0);
      const position = matching.indexOf(index);
      const target = matching[position + delta] ?? -1;
      if (target < 0) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  function replaceOriginal(value: string) {
    setUndoPrompt(originalPrompt);
    setOriginalPrompt(value);
    setPromptSource("direct");
  }

  async function enhance(level: "short" | "medium" | "long") {
    setEnhancementLevel(level);
    if (!originalPrompt.trim())
      return setMessage("Enter a prompt before enhancing.");
    setEnhancing(level);
    setMessage("");
    try {
      const response = await fetch("/api/enhance-prompt", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: originalPrompt,
          enhanceLevel: level,
          contextType: "video",
          mediaMode: "video",
          videoGenerationType: mode,
          durationSeconds: duration,
          workflowLabel: "MiniMax H3",
          selectedStyle: {
            label: promptBuilderVisualStyle,
            prompt: promptBuilderVisualStyle,
          },
          visualContext: descriptors
            .map((item) => `${item.kind}: ${item.description || item.name}`)
            .join("\n"),
        }),
      });
      const data = await response.json();
      const value = String(data.enhancedPrompt || data.prompt || "").trim();
      if (!response.ok || !value)
        throw new Error(data.error || "Enhance Prompt returned no text.");
      replaceOriginal(value);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Prompt enhancement failed.",
      );
    } finally {
      setEnhancing("");
    }
  }

  async function pollPrompt(url: string) {
    for (;;) {
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status === "failed")
        throw new Error(data.error || "Ollama Prompt Builder failed.");
      if (data.status === "completed" && data.result?.scenePrompt)
        return String(data.result.scenePrompt);
      setMessage(data.statusMessage || "Ollama is building the H3 prompt...");
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  async function ensurePromptVideoUpload(
    item: MediaInput,
    index: number,
  ) {
    const signature =
      h3FileSignature(
        item,
      );

    const cached =
      promptVideoUploadCacheRef.current.get(
        item.id,
      );

    if (
      cached
      && cached.signature === signature
    ) {
      return cached.upload;
    }

    const upload =
      await uploadH3StagedFile(
        item.file,
        "video",
        `Prompt Builder video reference ${index + 1}`,
      );

    promptVideoUploadCacheRef.current.set(
      item.id,
      {
        signature,
        upload,
      },
    );

    return upload;
  }

  async function describePromptVideoFrame(
    item: MediaInput,
    index: number,
  ) {
    const upload =
      await ensurePromptVideoUpload(
        item,
        index,
      );

    setMessage(
      `Preparing first-frame context for video reference ${index + 1}...`,
    );

    const response =
      await fetch(
        "/api/h3/prompt/video-reference",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            {
              reference:
                upload,
              name:
                item.name,
              clipStartSeconds:
                item.clipStartSeconds || 0,
              clipDurationSeconds:
                H3_REFERENCE_VIDEO_CLIP_SECONDS,
            },
          ),
        },
      );

    const data =
      await response
        .json()
        .catch(
          () => ({}),
        );

    if (
      !response.ok
      || !data.descriptor
    ) {
      throw new Error(
        data.error
        || `Could not describe video reference ${index + 1}.`,
      );
    }

    const start =
      Number(
        data.frame?.startSeconds
        ?? item.clipStartSeconds
        ?? 0,
      );

    return [
      `First frame of selected ${H3_REFERENCE_VIDEO_CLIP_SECONDS}-second video window ${start.toFixed(2)}s-${(start + H3_REFERENCE_VIDEO_CLIP_SECONDS).toFixed(2)}s:`,
      String(
        data.descriptor,
      ).trim(),
    ].join(
      " ",
    );
  }

  async function promptReferencesWithVideoFrames() {
    if (
      mode !== "h3-reference-to-video"
    ) {
      return descriptors;
    }

    const videos =
      references.filter(
        (item) => item.kind === "video",
      );

    if (!videos.length) {
      return descriptors;
    }

    const promptDescriptions =
      new Map<string, string>();

    const emptyDescriptionUpdates:
      Array<{
        id: string;
        description: string;
      }> = [];

    for (
      let index = 0;
      index < videos.length;
      index += 1
    ) {
      const item =
        videos[index];

      const frameDescription =
        await describePromptVideoFrame(
          item,
          index,
        );

      const existing =
        item.description.trim();

      const promptDescription =
        existing
          ? `${existing} ${frameDescription}`
          : frameDescription;

      promptDescriptions.set(
        item.id,
        promptDescription,
      );

      if (!existing) {
        emptyDescriptionUpdates.push(
          {
            id:
              item.id,
            description:
              frameDescription,
          },
        );
      }
    }

    if (
      emptyDescriptionUpdates.length
    ) {
      setReferences(
        (current) =>
          current.map(
            (item) => {
              const update =
                emptyDescriptionUpdates.find(
                  (candidate) => candidate.id === item.id,
                );

              return update
                ? {
                    ...item,
                    description:
                      update.description,
                  }
                : item;
            },
          ),
      );
    }

    return descriptors.map(
      (item) => {
        const description =
          promptDescriptions.get(
            item.id,
          );

        return description
          ? {
              ...item,
              description,
            }
          : item;
      },
    );
  }

  async function buildPrompt() {
    if (!legacyModeActive)
      return setMessage(
        `${specialModeLabel} will use its own prompt compiler and cannot call the legacy H3 Prompt Builder.`,
      );
    if (!canBuildPrompt)
      return setMessage(
        mode === "h3-reference-to-video"
          ? "Add a video reference or write a scene before using Prompt Builder."
          : "Write your scene before using Prompt Builder.",
      );
    if (mode === "h3-image-to-video" && !firstImage)
      return setMessage(
        "Choose a First Image before building the Image prompt.",
      );
    setBuilding(true);
    setMessage(
      mode === "h3-reference-to-video"
        ? "Preparing H3 reference context for Prompt Builder..."
        : "Sending the scene to the shared Production Ollama engine...",
    );
    try {
      const promptReferences =
        await promptReferencesWithVideoFrames();

      setMessage("Sending the scene to the shared Production Ollama engine...");

      const response = await fetch("/api/h3/prompt", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...promptContext,
          references:
            promptReferences,
          loras: selectedLoras,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.pollUrl)
        throw new Error(data.error || "Prompt Builder could not start.");
      const value = await pollPrompt(data.pollUrl);
      setSuggestion(value);
      setSuggestionDraft(value);
      setMessage("Ollama suggestion ready. Review it before generation.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Prompt Builder failed.",
      );
    } finally {
      setBuilding(false);
    }
  }
  function acceptPrompt(value: string) {
    const next = value.trim();
    if (!next) return setMessage("The reviewed Scene Prompt cannot be empty.");
    setScenePrompt(next);
    setPromptSource("builder");
    setReviewedFingerprint(
      `${h3StudioPromptFingerprint({
        ...promptContext,
        scenePrompt: next,
      })}|stylePreset:${stylePresetId}`,
    );
    setMessage("Prompt reviewed and ready.");
  }

  function useCurrentRawPrompt() {
    if (!originalPrompt.trim()) {
      return setMessage("Enter a prompt before generating.");
    }
    setPromptSource("direct");
    setMessage("Using your current prompt directly. Prompt Builder is optional.");
  }

  async function mic() {
    if (micState === "listening") {
      recorderRef.current?.stop();
      return;
    }
    try {
      chunksRef.current = [];
      cancelRecordingRef.current = false;
      setMicState("listening");
      setMessage("Listening...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (cancelRecordingRef.current) return setMicState("idle");
        setMicState("processing");
        try {
          const body = new FormData();
          body.set(
            "audio",
            new File(chunksRef.current, `h3-${Date.now()}.webm`, {
              type: "audio/webm",
            }),
          );
          const response = await fetch("/api/ollama-ai/transcribe", {
            method: "POST",
            body,
            credentials: "include",
          });
          const data = await response.json();
          const text = String(data.text || "").trim();
          if (!response.ok || !text)
            throw new Error(
              data.detail || data.error || "No transcript returned.",
            );
          replaceOriginal(
            [originalPrompt.trim(), text].filter(Boolean).join("\n"),
          );
          setMicState("done");
          setMessage("Transcription added. You can edit it before building.");
        } catch (error) {
          setMicState("error");
          setMessage(
            error instanceof Error ? error.message : "Transcription failed.",
          );
        }
      };
      recorder.start();
    } catch (error) {
      setMicState("error");
      setMessage(
        error instanceof Error ? error.message : "Microphone access failed.",
      );
    }
  }
  function cancelMic() {
    cancelRecordingRef.current = true;
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setMicState("idle");
    setMessage("Recording cancelled.");
  }
  function updateLora(id: string, strength: number) {
    const entry = catalog.find((item) => item.id === id);
    if (!entry) return;
    const value = Math.max(
      entry.minStrength,
      Math.min(entry.maxStrength, Number(strength.toFixed(2))),
    );
    setSelectedLoras((current) =>
      current.map((item) =>
        item.id === id ? { ...item, strength: value } : item,
      ),
    );
  }
  function addLora(id: string) {
    const entry = catalog.find((item) => item.id === id);
    if (!entry || selectedLoras.some((item) => item.id === id)) return;
    if (selectedLoras.length >= maxLoras)
      return setMessage(
        `You can select at most ${maxLoras} optional H3 LoRAs.`,
      );
    setSelectedLoras((current) => [
      ...current,
      { id, strength: entry.defaultStrength },
    ]);
  }

  async function refreshJob(id = job?.id) {
    if (!id) return null;
    const { response, data } = await fetchH3JobStatus(id);
    if (data.job) {
      setJob(data.job);
      rememberH3Job(h3LastJobStorageKey, data.job);
      return data.job;
    }
    if (response.status === 404) {
      setJob((current) => (current?.id === id ? null : current));
      clearPersistedH3Job(h3JobStorageKey);
      setMessage((current) => current || "The saved H3 job is no longer available for this session.");
    }
    return null;
  }
  function clearJob() {
    if (job && !isTerminalH3JobStatus(job.status)) {
      setMessage("Cancel the active H3 generation before clearing it.");
      return;
    }
    setJob(null);
    clearPersistedH3Job(h3JobStorageKey);
    setMessage("Cleared the H3 result from this device.");
  }
  async function retry() {
    if (!job) return;
    const response = await fetch(h3GenerationEndpointFor(job), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry", jobId: job.id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.job)
      return setMessage(data.error || "Retry failed.");
    setJob(data.job);
    rememberH3Job(h3LastJobStorageKey, data.job);
    setNow(Date.now());
  }
  async function cancelGeneration() {
    if (!job || !active) return;
    setMessage("Canceling H3 generation...");
    const response = await fetch(h3GenerationEndpointFor(job), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", jobId: job.id }),
    });
    const data = await response.json().catch(() => ({}));
    if (data.job) {
      setJob(data.job);
      rememberH3Job(h3LastJobStorageKey, data.job);
    }
    setMessage(response.ok ? "H3 generation canceled." : data.error || "Could not cancel H3 generation.");
  }
  function h3GenerationConfig(): H3GenerationConfig {
    return {
      mode,
      quality,
      orientation,
      durationSeconds: duration,
      prompt: generationPrompt,
      stylePresetId,
      h3Settings: normalizeH3AdvancedSettings(
        h3Settings,
        refModReferenceOptions.length,
      ),
      rifeInterpolation60Fps,
      optionalLoras: selectedLoras,
      imageDescriptions: references
        .filter((item) => item.kind === "image")
        .map((item) => item.description),
      videoDescriptions: references
        .filter((item) => item.kind === "video")
        .map((item) => item.description),
      audioDescriptions: references
        .filter((item) => item.kind === "audio")
        .map((item) => item.description),
      videoAudioFlags: references
        .filter((item) => item.kind === "video")
        .map((item) => Boolean(item.includeAudio)),
      videoClipStartSeconds: references
        .filter((item) => item.kind === "video")
        .map((item) => item.clipStartSeconds || 0),
    };
  }
  function appendH3GenerationFiles(body: FormData) {
    if (firstImage) body.append("firstImage", firstImage.file);
    if (lastImage) body.append("lastImage", lastImage.file);
    references
      .filter((item) => item.kind === "image")
      .forEach((item) => body.append("referenceImages", item.file));
    references
      .filter((item) => item.kind === "video")
      .forEach((item) => body.append("referenceVideos", item.file));
    references
      .filter((item) => item.kind === "audio")
      .forEach((item) => body.append("referenceAudios", item.file));
  }
  function h3RealismGenerationConfig() {
    return {
      mode: "h3-realism",
      quality,
      orientation,
      durationSeconds: duration,
      prompt: realismPrompt,
      compiledPromptOverride:
        realismExpertEdit && finalRealismPrompt.trim()
          ? finalRealismPrompt
          : "",
      rifeInterpolation60Fps,
      loraSettings: {
        preset: realismPreset,
        speedLora: realismSpeedLora,
        peopleRealismEnabled: realismPeopleEnabled,
      },
      seed:
        realismSeedMode === "fixed"
          ? Number(realismSeed)
          : undefined,
      imageDescriptions: realismReferences
        .filter((item) => item.kind === "image")
        .map((item) => item.description),
      videoDescriptions: realismReferences
        .filter((item) => item.kind === "video")
        .map((item) => item.description),
      audioDescriptions: realismReferences
        .filter((item) => item.kind === "audio")
        .map((item) => item.description),
      videoDurations: realismReferences
        .filter((item) => item.kind === "video")
        .map((item) => item.sourceDurationSeconds || null),
      audioDurations: realismReferences
        .filter((item) => item.kind === "audio")
        .map((item) => item.sourceDurationSeconds || null),
    };
  }
  function appendH3RealismGenerationFiles(body: FormData) {
    realismReferences
      .filter((item) => item.kind === "image")
      .forEach((item) => body.append("referenceImages", item.file));
    realismReferences
      .filter((item) => item.kind === "video")
      .forEach((item) => body.append("referenceVideos", item.file));
    realismReferences
      .filter((item) => item.kind === "audio")
      .forEach((item) => body.append("referenceAudios", item.file));
  }
  function h3BodySwapGenerationConfig() {
    return {
      mode: "h3-body-swap",
      quality,
      orientation,
      durationSeconds: duration,
      prompt: bodySwapPrompt,
      selector: bodySwapSelector,
      preserveOriginalAudio: bodySwapPreserveAudio,
      rifeInterpolation60Fps,
      seed:
        bodySwapSeedMode === "fixed"
          ? Number(bodySwapSeed)
          : undefined,
    };
  }
  function appendH3BodySwapGenerationFiles(body: FormData) {
    if (bodySwapSourceVideo) body.append("sourceVideo", bodySwapSourceVideo.file);
    if (bodySwapReplacementImage) body.append("replacementImage", bodySwapReplacementImage.file);
  }
  function h3RefModsGenerationConfig() {
    return {
      mode: "h3-refmods",
      quality,
      orientation,
      durationSeconds: duration,
      prompt: refModsPrompt,
      refMods: refModSlots,
      turbo: refModsTurbo,
      rifeInterpolation60Fps,
      seed:
        refModsSeedMode === "fixed"
          ? Number(refModsSeed)
          : undefined,
    };
  }
  function addRefModSlot(entry?: H3RefModLibraryEntry) {
    setRefModSlots((current) => {
      if (current.length >= H3_REFMOD_LIMITS.maxRefMods) {
        setMessage(`Use at most ${H3_REFMOD_LIMITS.maxRefMods} RefMods.`);
        return current;
      }
      return [...current, createRefModSlot(entry)];
    });
  }
  function updateRefModSlot(id: string, patch: Partial<H3RefModSlot>) {
    setRefModSlots((current) =>
      current.map((slot) =>
        slot.id === id
          ? {
              ...slot,
              ...patch,
              strength: patch.strength === undefined ? slot.strength : Number(patch.strength),
              visualStrength: patch.visualStrength === undefined ? slot.visualStrength : Number(patch.visualStrength),
              audioStrength: patch.audioStrength === undefined ? slot.audioStrength : Number(patch.audioStrength),
              copies: patch.copies === undefined ? slot.copies : Number(patch.copies),
            }
          : slot,
      ),
    );
  }
  function removeRefModSlot(id: string) {
    setRefModSlots((current) => current.filter((slot) => slot.id !== id));
  }
  function moveRefModSlot(id: string, direction: -1 | 1) {
    setRefModSlots((current) => {
      const index = current.findIndex((slot) => slot.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const copy = [...current];
      const [slot] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, slot);
      return copy;
    });
  }
  async function refreshRefModCreateJob(id = refModCreateJob?.id) {
    if (!id) return;
    const response = await fetch(
      `/api/h3/special/refmods/create?jobId=${encodeURIComponent(id)}`,
      { cache: "no-store", credentials: "include" },
    );
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.job) {
      setRefModCreateJob(data.job);
      if (data.job.status === "completed") {
        setRefModLibraryStatus("idle");
        setRefModLibraryMessage(`Created ${data.job.libraryName}.`);
      }
    }
  }
  async function createRefMod() {
    if (refModCreateValidationMessage) {
      setMessage(refModCreateValidationMessage);
      return;
    }
    const form = new FormData();
    form.append("config", JSON.stringify({
      kind: refModCreateKind,
      name: refModCreateName.trim(),
      description: refModCreateDescription,
      audioCategory: refModCreateAudioCategory,
      motionType: refModCreateMotionType,
      isolateSubject:
        refModCreateKind === "motion"
        && refModCreateMotionType === "subject"
        && refModCreateIsolateSubject,
      replace: refModCreateReplace,
    }));
    if (refModCreateKind === "character") {
      refModCreateImages.forEach((file) => form.append("images", file));
    } else if (refModCreateKind === "motion" && refModCreateVideo) {
      form.append("video", refModCreateVideo);
    } else if (refModCreateKind === "audio" && refModCreateAudio) {
      form.append("audio", refModCreateAudio);
    }
    setMessage("Submitting RefMod creation workflow...");
    try {
      const response = await fetch("/api/h3/special/refmods/create", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.job) {
        throw new Error(data.error || "RefMod creation could not be submitted.");
      }
      setRefModCreateJob(data.job);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "RefMod creation could not be submitted.");
    }
  }
  async function generateRefMods() {
    if (!canGenerateRefMods) {
      return setMessage(refModsValidationMessage || "Add a prompt and at least one RefMod.");
    }
    setMessage("Validating Ref Mods request...");
    try {
      const response = await fetch("/api/h3/special/refmods/generation", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: h3RefModsGenerationConfig() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.job) {
        throw new Error(data.error || "H3 Ref Mods generation could not be submitted.");
      }
      setJob(data.job);
      rememberH3Job(h3LastJobStorageKey, data.job);
      setNow(Date.now());
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "H3 Ref Mods generation could not be submitted.");
    }
  }
  async function uploadH3StagedFile(
    file: File,
    kind: MediaKind,
    label: string,
  ): Promise<H3StagedUploadDescriptor> {
    const uploadId =
      h3UploadId();

    const chunkCount =
      Math.max(
        1,
        Math.ceil(
          file.size / H3_STAGED_UPLOAD_CHUNK_BYTES,
        ),
      );

    let lastUpload:
      H3StagedUploadDescriptor
      | null =
      null;

    for (
      let chunkIndex = 0;
      chunkIndex < chunkCount;
      chunkIndex += 1
    ) {
      const start =
        chunkIndex
        * H3_STAGED_UPLOAD_CHUNK_BYTES;

      const end =
        Math.min(
          file.size,
          start
          + H3_STAGED_UPLOAD_CHUNK_BYTES,
        );

      const chunk =
        file.slice(
          start,
          end,
          file.type || "application/octet-stream",
        );

      const body =
        new FormData();

      body.set("uploadId", uploadId);
      body.set("kind", kind);
      body.set("name", file.name);
      body.set("type", file.type || "");
      body.set("size", String(file.size));
      body.set("chunkIndex", String(chunkIndex));
      body.set("chunkCount", String(chunkCount));
      body.set("chunk", chunk, file.name || `${kind}-${chunkIndex}`);

      setMessage(
        `Uploading ${label} ${chunkIndex + 1}/${chunkCount} (${formatBytes(end)} of ${formatBytes(file.size)}).`,
      );

      const response =
        await fetch(
          "/api/h3/generation/upload",
          {
            method: "POST",
            credentials: "include",
            body,
          },
        );

      const data =
        await response
          .json()
          .catch(
            () => ({}),
          );

      if (
        !response.ok
        || !data.upload
      ) {
        throw new Error(
          data.error
          || `Could not upload ${label}.`,
        );
      }

      lastUpload =
        data.upload;
    }

    if (
      !lastUpload?.complete
    ) {
      throw new Error(
        `Could not finish uploading ${label}.`,
      );
    }

    return lastUpload;
  }
  async function uploadH3StagedReferences(): Promise<H3StagedGenerationPayload> {
    const staged: H3StagedGenerationPayload = {
      referenceImages: [],
      referenceVideos: [],
      referenceAudios: [],
    };

    if (firstImage) {
      staged.firstImage =
        await uploadH3StagedFile(
          firstImage.file,
          "image",
          "the first image",
        );
    }

    if (lastImage) {
      staged.lastImage =
        await uploadH3StagedFile(
          lastImage.file,
          "image",
          "the last image",
        );
    }

    const imageReferences =
      references.filter(
        (item) => item.kind === "image",
      );

    for (
      let index = 0;
      index < imageReferences.length;
      index += 1
    ) {
      staged.referenceImages.push(
        await uploadH3StagedFile(
          imageReferences[index].file,
          "image",
          `image reference ${index + 1}`,
        ),
      );
    }

    const videoReferences =
      references.filter(
        (item) => item.kind === "video",
      );

    for (
      let index = 0;
      index < videoReferences.length;
      index += 1
    ) {
      staged.referenceVideos.push(
        await uploadH3StagedFile(
          videoReferences[index].file,
          "video",
          `video reference ${index + 1}`,
        ),
      );
    }

    const audioReferences =
      references.filter(
        (item) => item.kind === "audio",
      );

    for (
      let index = 0;
      index < audioReferences.length;
      index += 1
    ) {
      staged.referenceAudios.push(
        await uploadH3StagedFile(
          audioReferences[index].file,
          "audio",
          `audio reference ${index + 1}`,
        ),
      );
    }

    return staged;
  }
  async function uploadH3StagedRealismReferences(): Promise<H3StagedGenerationPayload> {
    const staged: H3StagedGenerationPayload = {
      referenceImages: [],
      referenceVideos: [],
      referenceAudios: [],
    };

    const imageReferences = realismReferences.filter((item) => item.kind === "image");
    for (let index = 0; index < imageReferences.length; index += 1) {
      staged.referenceImages.push(
        await uploadH3StagedFile(
          imageReferences[index].file,
          "image",
          `Realism image reference ${index + 1}`,
        ),
      );
    }

    const videoReferences = realismReferences.filter((item) => item.kind === "video");
    for (let index = 0; index < videoReferences.length; index += 1) {
      staged.referenceVideos.push(
        await uploadH3StagedFile(
          videoReferences[index].file,
          "video",
          `Realism video reference ${index + 1}`,
        ),
      );
    }

    const audioReferences = realismReferences.filter((item) => item.kind === "audio");
    for (let index = 0; index < audioReferences.length; index += 1) {
      staged.referenceAudios.push(
        await uploadH3StagedFile(
          audioReferences[index].file,
          "audio",
          `Realism audio reference ${index + 1}`,
        ),
      );
    }

    return staged;
  }
  async function uploadH3StagedBodySwapMedia(): Promise<H3StagedBodySwapPayload> {
    const staged: H3StagedBodySwapPayload = {};

    if (bodySwapSourceVideo) {
      staged.sourceVideo =
        await uploadH3StagedFile(
          bodySwapSourceVideo.file,
          "video",
          "Body Swap source video",
        );
    }

    if (bodySwapReplacementImage) {
      staged.replacementImage =
        await uploadH3StagedFile(
          bodySwapReplacementImage.file,
          "image",
          "Body Swap replacement image",
        );
    }

    return staged;
  }
  async function generateRealism() {
    if (!realismPrompt.trim())
      return setMessage("Enter a Realism prompt before generating.");
    if (realismReferenceLimitMessage)
      return setMessage(realismReferenceLimitMessage);
    if (
      realismSeedMode === "fixed"
      && (
        !Number.isSafeInteger(Number(realismSeed))
        || Number(realismSeed) < 0
      )
    ) {
      return setMessage("Enter a non-negative whole-number Realism seed.");
    }

    const uploadBytes = h3UploadBytes(realismReferences.map((item) => item.file));
    const useStagedUpload =
      uploadBytes > 0
      && isAndroidUploadRuntime();

    if (
      useStagedUpload
      && uploadBytes > H3_STAGED_UPLOAD_MAX_BYTES
    ) {
      return setMessage(
        [
          `Selected Realism references total ${formatBytes(uploadBytes)}.`,
          `Android staged H3 uploads support up to ${formatBytes(H3_STAGED_UPLOAD_MAX_BYTES)}.`,
          "Use shorter/compressed references or fewer references, then try again.",
        ].join(" "),
      );
    }

    if (!useStagedUpload && uploadBytes > H3_ANDROID_UPLOAD_BUDGET_BYTES) {
      return setMessage(
        [
          `Selected Realism references total ${formatBytes(uploadBytes)}.`,
          `Android .win uploads should stay under ${formatBytes(H3_ANDROID_UPLOAD_BUDGET_BYTES)} so the request has room for multipart overhead.`,
          "Use shorter/compressed references or fewer references, then try again.",
        ].join(" "),
      );
    }

    const config = h3RealismGenerationConfig();
    setMessage(
      useStagedUpload
        ? "Preparing H3 Realism media upload..."
        : "Submitting the H3 Realism prompt...",
    );
    try {
      const response = useStagedUpload
        ? await fetch("/api/h3/special/realism/generation", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              config,
              staged: await uploadH3StagedRealismReferences(),
            }),
          })
        : await (async () => {
            const body = new FormData();
            body.set("config", JSON.stringify(config));
            appendH3RealismGenerationFiles(body);
            return fetch("/api/h3/special/realism/generation", {
              method: "POST",
              credentials: "include",
              body,
            });
          })();
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.job)
        throw new Error(data.error || "H3 Realism generation could not be submitted.");
      setJob(data.job);
      rememberH3Job(h3LastJobStorageKey, data.job);
      setNow(Date.now());
      setMessage("");
    } catch (error) {
      setMessage(h3SubmitNetworkMessage(error));
    }
  }
  async function generateBodySwap() {
    if (!bodySwapSourceVideo)
      return setMessage("Choose a Body Swap source video.");
    if (!bodySwapReplacementImage)
      return setMessage("Choose a Body Swap replacement image.");
    if (!bodySwapSelector.trim())
      return setMessage("Describe the target person to track.");
    if (
      bodySwapSeedMode === "fixed"
      && (
        !Number.isSafeInteger(Number(bodySwapSeed))
        || Number(bodySwapSeed) < 0
      )
    ) {
      return setMessage("Enter a non-negative whole-number Body Swap seed.");
    }

    const uploadBytes = h3UploadBytes([
      bodySwapSourceVideo.file,
      bodySwapReplacementImage.file,
    ]);
    const useStagedUpload =
      uploadBytes > 0
      && isAndroidUploadRuntime();

    if (
      useStagedUpload
      && uploadBytes > H3_STAGED_UPLOAD_MAX_BYTES
    ) {
      return setMessage(
        [
          `Selected Body Swap files total ${formatBytes(uploadBytes)}.`,
          `Android staged H3 uploads support up to ${formatBytes(H3_STAGED_UPLOAD_MAX_BYTES)}.`,
          "Use a shorter/compressed source video, then try again.",
        ].join(" "),
      );
    }

    if (!useStagedUpload && uploadBytes > H3_ANDROID_UPLOAD_BUDGET_BYTES) {
      return setMessage(
        [
          `Selected Body Swap files total ${formatBytes(uploadBytes)}.`,
          `Android .win uploads should stay under ${formatBytes(H3_ANDROID_UPLOAD_BUDGET_BYTES)} so the request has room for multipart overhead.`,
          "Use a shorter/compressed source video, then try again.",
        ].join(" "),
      );
    }

    const config = h3BodySwapGenerationConfig();
    setMessage(
      useStagedUpload
        ? "Preparing Body Swap media upload..."
        : "Submitting the Body Swap prompt...",
    );
    try {
      const response = useStagedUpload
        ? await fetch("/api/h3/special/body-swap/generation", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              config,
              staged: await uploadH3StagedBodySwapMedia(),
            }),
          })
        : await (async () => {
            const body = new FormData();
            body.set("config", JSON.stringify(config));
            appendH3BodySwapGenerationFiles(body);
            return fetch("/api/h3/special/body-swap/generation", {
              method: "POST",
              credentials: "include",
              body,
            });
          })();
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.job)
        throw new Error(data.error || "H3 Body Swap generation could not be submitted.");
      setJob(data.job);
      rememberH3Job(h3LastJobStorageKey, data.job);
      setNow(Date.now());
      setMessage("");
    } catch (error) {
      setMessage(h3SubmitNetworkMessage(error));
    }
  }
  async function generate() {
    if (!legacyModeActive)
      return setMessage(
        `${specialModeLabel} is waiting for its dedicated H3 adapter and cannot call the legacy generation route.`,
      );
    if (builderPromptStale)
      return setMessage("The optional Builder prompt changed. Use your current raw prompt or review the Builder result again.");
    if (!generationPrompt.trim())
      return setMessage("Enter a prompt before generating.");
    if (mode === "h3-image-to-video" && !firstImage)
      return setMessage("Choose a First Image.");
    if (mode === "h3-reference-to-video" && !references.length)
      return setMessage("Add at least one reference.");
    if (mode === "h3-reference-to-video" && videoReferenceTooShort) {
      return setMessage(
        `Reference videos must be at least ${H3_REFERENCE_VIDEO_CLIP_SECONDS} seconds long.`,
      );
    }
    const uploadBytes = h3UploadBytes([
      firstImage?.file,
      lastImage?.file,
      ...references.map((item) => item.file),
    ]);
    const useStagedUpload =
      uploadBytes > 0
      && isAndroidUploadRuntime();

    if (
      useStagedUpload
      && uploadBytes > H3_STAGED_UPLOAD_MAX_BYTES
    ) {
      return setMessage(
        [
          `Selected H3 references total ${formatBytes(uploadBytes)}.`,
          `Android staged H3 uploads support up to ${formatBytes(H3_STAGED_UPLOAD_MAX_BYTES)}.`,
          "Use a shorter/compressed reference video or fewer references, then try again.",
        ].join(" "),
      );
    }

    if (!useStagedUpload && uploadBytes > H3_ANDROID_UPLOAD_BUDGET_BYTES) {
      return setMessage(
        [
          `Selected H3 references total ${formatBytes(uploadBytes)}.`,
          `Android .win uploads should stay under ${formatBytes(H3_ANDROID_UPLOAD_BUDGET_BYTES)} so the request has room for multipart overhead.`,
          "Use a shorter/compressed reference video or fewer references, then try again.",
        ].join(" "),
      );
    }
    const config = h3GenerationConfig();
    setMessage(
      useStagedUpload
        ? "Preparing H3 media upload..."
        : "Submitting the H3 prompt...",
    );
    try {
      const response = useStagedUpload
        ? await fetch("/api/h3/generation", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              config,
              staged: await uploadH3StagedReferences(),
            }),
          })
        : await (async () => {
            const body = new FormData();
            body.set(
              "config",
              JSON.stringify(config),
            );
            appendH3GenerationFiles(body);
            return fetch("/api/h3/generation", {
              method: "POST",
              credentials: "include",
              body,
            });
          })();
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.job)
        throw new Error(data.error || "H3 generation could not be submitted.");
      setJob(data.job);
      rememberH3Job(h3LastJobStorageKey, data.job);
      setNow(Date.now());
      setMessage("");
    } catch (error) {
      setMessage(h3SubmitNetworkMessage(error));
    }
  }
  async function retryGallerySave() {
    if (!job) return;
    const response = await fetch(h3GalleryEndpointFor(job), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    });
    const data = await response.json();
    setMessage(
      response.ok
        ? `Saved ${data.fileName} to Gallery.`
        : data.error || "Could not save video to Gallery.",
    );
    if (response.ok) await refreshJob(job.id);
  }
  async function useAsReference() {
    if (!job?.videoUrl) return;
    const response = await fetch(job.videoUrl);
    const blob = await response.blob();
    addReference(
      "video",
      new File([blob], `h3-result-${job.id}.mp4`, {
        type: blob.type || "video/mp4",
      }),
    );
    setMode("h3-reference-to-video");
    setStudioMode("h3-reference-to-video");
    setPromptSource("direct");
    setMessage(
      "Result added as a video reference. Your raw prompt can generate directly; Prompt Builder remains optional.",
    );
  }

  function renderRife60FpsControl() {
    return (
      <div
        className="mt-4 rounded-[6px] border border-white/10 bg-black/30 p-3"
        data-otg="h3-rife-60fps-control"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-white/50">
              60 FPS (RIFE)
            </p>
            <p className="mt-1 text-xs leading-5 text-white/50">
              Interpolates the finished video to 60 FPS. H3 still renders natively at 24 FPS.
            </p>
          </div>
          <div
            className="grid min-w-32 grid-cols-2 gap-1"
            role="group"
            aria-label="60 FPS RIFE interpolation"
          >
            <button
              type="button"
              aria-pressed={!rifeInterpolation60Fps}
              className={`${command} px-2 py-2 text-xs ${choiceClass(!rifeInterpolation60Fps)}`}
              onClick={() => setRifeInterpolation60Fps(false)}
            >
              OFF
            </button>
            <button
              type="button"
              aria-pressed={rifeInterpolation60Fps}
              className={`${command} px-2 py-2 text-xs ${choiceClass(rifeInterpolation60Fps)}`}
              onClick={() => setRifeInterpolation60Fps(true)}
            >
              ON
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mx-auto max-w-7xl space-y-4 pb-28 pt-8 md:pt-0"
      data-testid="h3-panel"
    >
      <section className="relative overflow-hidden rounded-[8px] border border-violet-300/20 bg-[linear-gradient(135deg,#100d25_0%,#09101b_55%,#071216_100%)] px-4 py-5 shadow-[0_20px_60px_rgba(76,29,149,.18)]">
        <div className="absolute inset-y-0 right-0 w-1 bg-gradient-to-b from-violet-300 via-cyan-300 to-transparent" />
        <p className="text-xs font-black uppercase text-violet-200">
          MiniMax creation suite
        </p>
        <h1 className="mt-1 text-3xl font-black text-white">H3 Studio</h1>
        <p className="mt-1 text-sm text-white/58">Create with MiniMax H3</p>
        <div
          className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
          role="tablist"
          aria-label="H3 generation mode"
        >
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.id}
              role="tab"
              aria-selected={studioMode === option.id}
              onClick={() => selectStudioMode(option.id)}
              className={`min-h-20 rounded-[6px] border p-2 text-left transition ${choiceClass(studioMode === option.id)}`}
            >
              <span className="block text-sm font-black text-white">
                {option.label}
              </span>
              <span className="mt-1 block text-[11px] leading-4 text-white/48">
                {option.detail}
              </span>
            </button>
          ))}
        </div>
      </section>
      {message ? (
        <div className="rounded-[6px] border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
          {message}
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,.75fr)]">
        <main className="space-y-4">
          {studioMode === "h3-realism" ? (
            <>
              <section className={surface} data-otg="h3-realism-workspace">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-violet-200/75">
                      01 / Realism Prompt
                    </p>
                    <h2 className="mt-1 text-lg font-black">
                      Natural language in, H3 structure out
                    </h2>
                  </div>
                  <span className="rounded-full bg-cyan-300/15 px-2 py-1 text-[11px] font-bold text-cyan-100">
                    Dedicated TEST mode
                  </span>
                </div>
                <textarea
                  id="h3-realism-prompt"
                  rows={5}
                  className={`${field} mt-3 resize-y text-base leading-6`}
                  value={realismPrompt}
                  onChange={(event) => {
                    setRealismPrompt(event.target.value);
                    setRealismCompiledPromptDraft("");
                  }}
                  placeholder="Example: the man walks into the cafe to buy a drink"
                />
                <details className="mt-4 rounded-[6px] border border-white/10 p-3">
                  <summary className="cursor-pointer text-sm font-black">
                    View Compiled Prompt
                  </summary>
                  <div className="mt-3 text-xs text-white/45">
                    The People Realism trigger is added automatically when that
                    LoRA is enabled.
                  </div>
                  <label className="mt-3 flex items-center gap-2 text-sm text-white/70">
                    <input
                      type="checkbox"
                      checked={realismExpertEdit}
                      onChange={(event) => {
                        setRealismExpertEdit(event.target.checked);
                        setRealismCompiledPromptDraft(
                          event.target.checked
                            ? finalRealismPrompt
                            : "",
                        );
                      }}
                    />
                    Expert edit compiled prompt for this submission
                  </label>
                  <textarea
                    rows={14}
                    className={`${field} mt-3 resize-y font-mono text-xs leading-5`}
                    value={
                      realismExpertEdit
                        ? realismCompiledPromptDraft
                        : finalRealismPrompt
                    }
                    readOnly={!realismExpertEdit}
                    onChange={(event) =>
                      setRealismCompiledPromptDraft(event.target.value)
                    }
                    placeholder="Compiled prompt will appear after you enter a Realism prompt."
                  />
                </details>
              </section>
              <section className={surface}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-violet-200/75">
                      02 / Realism References
                    </p>
                    <h2 className="mt-1 text-lg font-black">
                      Add only the references you need
                    </h2>
                    <p className="text-xs text-white/45">
                      Max {H3_REALISM_LIMITS.maxImages} images,{" "}
                      {H3_REALISM_LIMITS.maxVideos} videos,{" "}
                      {H3_REALISM_LIMITS.maxAudios} audio,{" "}
                      {H3_REALISM_LIMITS.maxCombinedReferences} combined.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(["image", "video", "audio"] as const).map((kind) => (
                      <label key={kind} className={`${command} cursor-pointer`}>
                        + {kind[0].toUpperCase() + kind.slice(1)}
                        <input
                          hidden
                          type="file"
                          accept={H3_MEDIA_ACCEPT[kind]}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) addRealismReference(kind, file);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {realismReferences.map((item, index) => (
                    <article
                      key={item.id}
                      className="min-w-0 overflow-hidden rounded-[6px] border border-white/10 bg-black/30 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-black uppercase text-cyan-200">
                            {item.kind} reference {index + 1}
                          </p>
                          <p className="truncate text-xs text-white/45">
                            {item.name}
                          </p>
                        </div>
                        <button
                          className={command}
                          onClick={() => removeRealismReference(item.id)}
                        >
                          Remove
                        </button>
                      </div>
                      <div className="mt-3">
                        <MediaPreview item={item} />
                      </div>
                      <input
                        className={`${field} mt-3`}
                        value={item.description}
                        onChange={(event) =>
                          updateRealismReference(item.id, {
                            description: event.target.value,
                          })
                        }
                        placeholder="Identity, continuity, motion, pace, ambience"
                      />
                      {item.kind !== "image" ? (
                        <label className="mt-3 block text-xs text-white/55">
                          Approx. duration seconds
                          <input
                            className={`${field} mt-1`}
                            type="number"
                            min={item.kind === "video" ? H3_REALISM_LIMITS.minVideoSeconds : 0}
                            max={H3_REALISM_LIMITS.maxVideoSeconds}
                            step="0.1"
                            value={item.sourceDurationSeconds ?? ""}
                            onChange={(event) =>
                              updateRealismReference(item.id, {
                                sourceDurationSeconds:
                                  event.target.value === ""
                                    ? undefined
                                    : Number(event.target.value),
                              })
                            }
                          />
                        </label>
                      ) : null}
                    </article>
                  ))}
                </div>
                {!realismReferences.length ? (
                  <div className="mt-4 rounded-[6px] border border-dashed border-white/15 py-8 text-center text-sm text-white/35">
                    Add image, video, or audio references only when this shot
                    needs them.
                  </div>
                ) : null}
                {realismReferenceLimitMessage ? (
                  <div className="mt-4 rounded-[6px] border border-red-300/30 bg-red-500/10 p-3 text-sm text-red-50">
                    {realismReferenceLimitMessage}
                  </div>
                ) : null}
              </section>
              <details className={surface} open>
                <summary className="cursor-pointer text-sm font-black">
                  LoRA Guide and Advanced
                </summary>
                <div className="mt-4 grid gap-2 md:grid-cols-4">
                  {(Object.values(H3_REALISM_PRESETS) as Array<
                    (typeof H3_REALISM_PRESETS)[H3RealismPresetId]
                  >).map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={realismPreset === preset.id}
                      className={`${command} text-left ${choiceClass(realismPreset === preset.id)}`}
                      onClick={() => applyRealismPreset(preset.id)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="text-xs text-white/55">
                    Speed LoRA
                    <select
                      className={`${field} mt-1`}
                      value={realismSpeedLora}
                      onChange={(event) =>
                        setRealismSpeedLora(
                          event.target.value as H3RealismSpeedLoraId,
                        )
                      }
                    >
                      {Object.values(H3_REALISM_SPEED_LORAS).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 pt-6 text-sm text-white/70">
                    <input
                      type="checkbox"
                      checked={realismPeopleEnabled}
                      onChange={(event) =>
                        setRealismPeopleEnabled(event.target.checked)
                      }
                    />
                    People Realism LoRA with automatic r34l1sm trigger
                  </label>
                </div>
                <div className="mt-4 rounded-[6px] border border-amber-300/25 bg-amber-300/10 p-3 text-xs leading-5 text-amber-50">
                  One speed LoRA only. People Realism may combine with one
                  speed LoRA. SH/LQ are TEST draft modes for this workflow;
                  HQ is closest to the supplied workflow target.
                </div>
              </details>
            </>
          ) : studioMode === "h3-body-swap" ? (
            <>
              <section className={surface} data-otg="h3-body-swap-workspace">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-violet-200/75">
                      01 / Body Swap Inputs
                    </p>
                    <h2 className="mt-1 text-lg font-black">
                      Single-person SAM3 body replacement
                    </h2>
                    <p className="mt-1 text-xs text-white/45">
                      First milestone: one tracked target, one replacement image.
                    </p>
                  </div>
                  <span className="rounded-full bg-cyan-300/15 px-2 py-1 text-[11px] font-bold text-cyan-100">
                    TEST single-person
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <article className="min-w-0 overflow-hidden rounded-[6px] border border-white/10 bg-black/30 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-black">Source Video</h3>
                        <p className="text-xs text-white/45">
                          Provides scene, camera, motion, and original audio
                        </p>
                      </div>
                      {bodySwapSourceVideo ? (
                        <button
                          className={command}
                          onClick={() => {
                            release(bodySwapSourceVideo);
                            setBodySwapSourceVideo(null);
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    {bodySwapSourceVideo ? (
                      <div className="mt-3">
                        <MediaPreview item={bodySwapSourceVideo} />
                      </div>
                    ) : (
                      <div className="mt-3 flex aspect-video items-center justify-center rounded-[6px] border border-dashed border-white/15 text-sm text-white/35">
                        No source video selected
                      </div>
                    )}
                    <label className={`${command} mt-3 inline-flex cursor-pointer`}>
                      Upload Source Video
                      <input
                        hidden
                        type="file"
                        accept={H3_MEDIA_ACCEPT.video}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) replaceMedia(bodySwapSourceVideo, file, "video", setBodySwapSourceVideo);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </article>
                  <article className="min-w-0 overflow-hidden rounded-[6px] border border-white/10 bg-black/30 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-black">Replacement Image</h3>
                        <p className="text-xs text-white/45">
                          Authoritative identity for the inserted person
                        </p>
                      </div>
                      {bodySwapReplacementImage ? (
                        <button
                          className={command}
                          onClick={() => {
                            release(bodySwapReplacementImage);
                            setBodySwapReplacementImage(null);
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    {bodySwapReplacementImage ? (
                      <div className="mt-3">
                        <MediaPreview item={bodySwapReplacementImage} />
                      </div>
                    ) : (
                      <div className="mt-3 flex aspect-video items-center justify-center rounded-[6px] border border-dashed border-white/15 text-sm text-white/35">
                        No replacement image selected
                      </div>
                    )}
                    <label className={`${command} mt-3 inline-flex cursor-pointer`}>
                      Upload Replacement Image
                      <input
                        hidden
                        type="file"
                        accept={H3_MEDIA_ACCEPT.image}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) replaceMedia(bodySwapReplacementImage, file, "image", setBodySwapReplacementImage);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </article>
                </div>
              </section>
              <section className={surface}>
                <p className="text-xs font-black uppercase text-violet-200/75">
                  02 / Target and Prompt
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="text-xs text-white/55">
                    Target selector
                    <input
                      className={`${field} mt-1`}
                      value={bodySwapSelector}
                      onChange={(event) => setBodySwapSelector(event.target.value)}
                      placeholder="person"
                    />
                  </label>
                  <label className="flex items-center gap-2 pt-6 text-sm text-white/70">
                    <input
                      type="checkbox"
                      checked={bodySwapPreserveAudio}
                      onChange={(event) =>
                        setBodySwapPreserveAudio(event.target.checked)
                      }
                    />
                    Preserve Original Audio
                  </label>
                </div>
                <textarea
                  rows={4}
                  className={`${field} mt-3 resize-y text-sm leading-6`}
                  value={bodySwapPrompt}
                  onChange={(event) => setBodySwapPrompt(event.target.value)}
                  placeholder="Optional instruction, e.g. keep the walk natural and match the coat movement"
                />
                <details className="mt-4 rounded-[6px] border border-white/10 p-3">
                  <summary className="cursor-pointer text-sm font-black">
                    View Compiled Prompt
                  </summary>
                  <textarea
                    readOnly
                    rows={14}
                    className={`${field} mt-3 resize-y font-mono text-xs leading-5`}
                    value={bodySwapCompiledPrompt}
                  />
                </details>
                <div className="mt-4 rounded-[6px] border border-amber-300/25 bg-amber-300/10 p-3 text-xs leading-5 text-amber-50">
                  Multi-person Body Swap is not advertised yet. This path keeps
                  SAM3 at max_objects=1 and track index 0 until single-person
                  tests are stable.
                </div>
              </section>
            </>
          ) : studioMode === "h3-refmods" ? (
            <>
              <section className={surface} data-otg="h3-refmods-workspace">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-violet-200/75">
                      01 / Ref Mods Prompt
                    </p>
                    <h2 className="mt-1 text-lg font-black">
                      Saved H3 references in deterministic slot order
                    </h2>
                    <p className="mt-1 text-xs text-white/45">
                      Up to {H3_REFMOD_LIMITS.maxRefMods} RefMods. Slot order controls subject/reference mapping.
                    </p>
                  </div>
                  <span className="rounded-full bg-cyan-300/15 px-2 py-1 text-[11px] font-bold text-cyan-100">
                    TEST adapter
                  </span>
                </div>
                <textarea
                  rows={5}
                  className={`${field} mt-3 resize-y text-base leading-6`}
                  value={refModsPrompt}
                  onChange={(event) => setRefModsPrompt(event.target.value)}
                  placeholder="Example: Isabella and Mika are sitting together at a cafe talking."
                />
                <details className="mt-4 rounded-[6px] border border-white/10 p-3">
                  <summary className="cursor-pointer text-sm font-black">
                    View Compiled Prompt
                  </summary>
                  <textarea
                    readOnly
                    rows={14}
                    className={`${field} mt-3 resize-y font-mono text-xs leading-5`}
                    value={refModsCompiledPrompt}
                    placeholder="Compiled prompt will appear after you enter a prompt and add at least one RefMod."
                  />
                </details>
              </section>
              <section className={surface} data-otg="h3-refmods-selected-slots">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-violet-200/75">
                      02 / Selected RefMods
                    </p>
                    <h2 className="mt-1 text-lg font-black">
                      Slots 1-8
                    </h2>
                    <p className="mt-1 text-xs text-white/45">
                      Create and manage RefMods in Characters → Ref Mod Gallery. H3 only selects and generates.
                    </p>
                  </div>
                  <button
                    type="button"
                    className={command}
                    onClick={() => {
                      setRefModPickerOpen(true);
                      setRefModLibraryStatus("idle");
                    }}
                  >
                    Add RefMod
                  </button>
                </div>
                <div className="mt-4 grid gap-3">
                  {refModSlots.map((slot, index) => (
                    <article
                      key={slot.id}
                      className="rounded-[6px] border border-white/10 bg-black/30 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-black uppercase text-cyan-200">
                            Slot {index + 1}
                          </p>
                          <p className="text-sm font-bold text-white/80">
                            {slot.name || "Choose a RefMod"}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" className={command} onClick={() => moveRefModSlot(slot.id, -1)}>
                            Up
                          </button>
                          <button type="button" className={command} onClick={() => moveRefModSlot(slot.id, 1)}>
                            Down
                          </button>
                          <button type="button" className={command} onClick={() => removeRefModSlot(slot.id)}>
                            Remove
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <label className="text-xs text-white/55 md:col-span-2">
                          Library name
                          <input
                            className={`${field} mt-1`}
                            value={slot.name}
                            onChange={(event) => updateRefModSlot(slot.id, { name: event.target.value })}
                            placeholder="characters/isabella"
                          />
                        </label>
                        <label className="text-xs text-white/55">
                          Type
                          <select
                            className={`${field} mt-1`}
                            value={slot.category}
                            onChange={(event) =>
                              updateRefModSlot(slot.id, {
                                category: event.target.value as H3RefModCategory,
                                strength: refModDefaultStrength(event.target.value as H3RefModCategory),
                              })
                            }
                          >
                            {(["character", "motion", "audio", "bundle", "uncategorized"] as H3RefModCategory[]).map((value) => (
                              <option key={value} value={value}>
                                {categoryLabel(value)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs text-white/55">
                          Components
                          <select
                            className={`${field} mt-1`}
                            value={slot.components}
                            onChange={(event) =>
                              updateRefModSlot(slot.id, {
                                components: event.target.value as H3RefModComponents,
                              })
                            }
                          >
                            {(["Auto", "All", "Visual", "Audio"] as H3RefModComponents[]).map((value) => (
                              <option key={value} value={value}>{value}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs text-white/55">
                          Overall strength
                          <input
                            className={`${field} mt-1`}
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            value={slot.strength}
                            onChange={(event) => updateRefModSlot(slot.id, { strength: Number(event.target.value) })}
                          />
                        </label>
                        <label className="text-xs text-white/55">
                          Source kind
                          <select
                            className={`${field} mt-1`}
                            value={slot.sourceKind}
                            onChange={(event) =>
                              updateRefModSlot(slot.id, {
                                sourceKind: event.target.value as H3RefModSourceKind,
                              })
                            }
                          >
                            {(["unknown", "image", "video", "audio", "bundle"] as H3RefModSourceKind[]).map((value) => (
                              <option key={value} value={value}>{value}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs text-white/55">
                          Visual strength
                          <input
                            className={`${field} mt-1`}
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            value={slot.visualStrength}
                            onChange={(event) => updateRefModSlot(slot.id, { visualStrength: Number(event.target.value) })}
                          />
                        </label>
                        <label className="text-xs text-white/55">
                          Audio strength
                          <input
                            className={`${field} mt-1`}
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            value={slot.audioStrength}
                            onChange={(event) => updateRefModSlot(slot.id, { audioStrength: Number(event.target.value) })}
                          />
                        </label>
                        <label className="text-xs text-white/55">
                          Copies
                          <input
                            className={`${field} mt-1`}
                            type="number"
                            min={1}
                            max={10}
                            step={1}
                            value={slot.copies}
                            onChange={(event) => updateRefModSlot(slot.id, { copies: Number(event.target.value) })}
                          />
                        </label>
                      </div>
                      <input
                        className={`${field} mt-3`}
                        value={slot.description}
                        onChange={(event) => updateRefModSlot(slot.id, { description: event.target.value })}
                        placeholder="Identity, motion, ambience, or bundle notes"
                      />
                      {refModSlotWarnings(slot).map((warning) => (
                        <div key={warning} className="mt-2 rounded-[6px] border border-amber-300/25 bg-amber-300/10 p-2 text-xs text-amber-50">
                          {warning}
                        </div>
                      ))}
                    </article>
                  ))}
                </div>
                {!refModSlots.length ? (
                  <div className="mt-4 rounded-[6px] border border-dashed border-white/15 py-8 text-center text-sm text-white/35">
                    Use Add RefMod to choose from the shared Characters Ref Mod Gallery.
                  </div>
                ) : null}
                {refModsValidationMessage ? (
                  <div className="mt-4 rounded-[6px] border border-red-300/30 bg-red-500/10 p-3 text-sm text-red-50">
                    {refModsValidationMessage}
                  </div>
                ) : refModsWarningMessages.length ? (
                  <div className="mt-4 rounded-[6px] border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-50">
                    {refModsWarningMessages[0]}
                  </div>
                ) : null}
              </section>
              {refModPickerOpen ? (
                <div className="fixed inset-0 z-50 flex items-end bg-black/70 p-3 sm:items-center sm:justify-center">
                  <section className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-[18px] border border-white/15 bg-zinc-950 shadow-2xl" data-otg="h3-refmods-picker">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 p-4">
                      <div>
                        <p className="text-xs font-black uppercase text-violet-200/75">
                          Ref Mod Picker
                        </p>
                        <h2 className="mt-1 text-lg font-black text-white">
                          Add RefMod to next slot
                        </h2>
                        <p className="mt-1 text-xs text-white/45">
                          {refModLibraryStatus === "loading"
                            ? "Loading RefMods..."
                            : refModLibraryStatus === "error"
                              ? "Could not load RefMod library. Retry."
                              : refModLibraryMessage || "Shared with Characters → Ref Mod Gallery."}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" className={command} onClick={() => setRefModLibraryStatus("idle")}>
                          Retry
                        </button>
                        <button type="button" className={command} onClick={() => setRefModPickerOpen(false)}>
                          Close
                        </button>
                      </div>
                    </div>
                    <div className="space-y-3 overflow-y-auto p-4">
                      <input
                        className={field}
                        value={refModPickerSearch}
                        onChange={(event) => setRefModPickerSearch(event.target.value)}
                        placeholder="Search RefMods"
                      />
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                        {(["all", "character", "motion", "audio", "bundle"] as Array<"all" | H3RefModCategory>).map((filter) => (
                          <button
                            key={filter}
                            type="button"
                            className={`${command} ${choiceClass(refModPickerFilter === filter)}`}
                            onClick={() => setRefModPickerFilter(filter)}
                          >
                            {filter === "all" ? "All" : categoryLabel(filter)}
                          </button>
                        ))}
                      </div>
                      {refModLibraryStatus === "loading" ? (
                        <div className="rounded-[6px] border border-white/10 p-6 text-center text-sm text-white/50">
                          Loading RefMods...
                        </div>
                      ) : refModLibraryStatus === "error" ? (
                        <div className="rounded-[6px] border border-red-300/30 bg-red-500/10 p-4 text-sm text-red-50">
                          Could not load RefMod library. Retry. {refModLibraryMessage}
                        </div>
                      ) : filteredRefModLibrary.length ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          {filteredRefModLibrary.map((entry) => (
                            <article key={entry.id} className="rounded-[6px] border border-white/10 bg-black/30 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-black text-white">{entry.name}</p>
                                  <p className="text-xs text-white/45">
                                    {categoryLabel(entry.category)} · {entry.kind}
                                    {entry.category === "motion" ? ` · ${entry.motionType === "camera_scene" ? "Camera Motion" : "Subject Motion"}${entry.isolationEnabled ? " · Isolated" : " · Original"}` : ""}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  className={command}
                                  onClick={() => {
                                    addRefModSlot(entry);
                                    setRefModPickerOpen(false);
                                  }}
                                >
                                  Add to Slot
                                </button>
                              </div>
                              {entry.description ? <p className="mt-2 line-clamp-2 text-xs text-white/55">{entry.description}</p> : null}
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-[6px] border border-dashed border-white/15 p-6 text-center text-sm text-white/35">
                          No RefMods created yet.
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              ) : null}
            </>
          ) : !legacyModeActive ? (
            <section
              className={surface}
              data-otg="h3-special-mode-quarantine"
            >
              <p className="text-xs font-black uppercase text-violet-200/75">
                01 / {specialModeLabel}
              </p>
              <h2 className="mt-1 text-lg font-black">
                Dedicated workflow adapter pending
              </h2>
              <p className="mt-3 text-sm leading-6 text-white/60">
                {specialModeLabel} is separated from the standard Text, Image,
                and Reference generation routes. This prevents the new workflow
                from falling through into the legacy H3 Prompt Builder, LoRA
                catalog, or generation API before its adapter is validated.
              </p>
              <div className="mt-4 rounded-[6px] border border-cyan-300/25 bg-cyan-300/10 p-3 text-sm text-cyan-50">
                Legacy H3 modes are unchanged. Use Text, Image, or Reference
                for the existing production routes while this TEST mode is wired.
              </div>
            </section>
          ) : (
            <>
          <section className={surface}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase text-violet-200/75">
                  01 / Prompt Workspace
                </p>
                <h2 className="mt-1 text-lg font-black">Your Scene</h2>
              </div>
              <span
                className={`rounded-full px-2 py-1 text-[11px] font-bold ${builderPromptStale ? "bg-amber-300/15 text-amber-100" : promptSource === "builder" ? "bg-emerald-300/15 text-emerald-100" : "bg-cyan-300/15 text-cyan-100"}`}
              >
                {builderPromptStale
                  ? "Optional Builder prompt changed"
                  : promptSource === "builder"
                    ? "Builder prompt selected"
                    : originalPrompt.trim()
                      ? "Direct prompt ready"
                      : hasReferenceVideo
                        ? "Video reference ready"
                      : "Prompt required"}
              </span>
            </div>
            <textarea
              id="h3-prompt"
              rows={6}
              className={`${field} mt-3 resize-y text-base leading-6`}
              value={originalPrompt}
              onChange={(event) => replaceOriginal(event.target.value)}
              placeholder="Describe the scene, action, camera, dialogue, and sound."
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={command} onClick={() => replaceOriginal("")}>
                Clear
              </button>
              <button
                className={command}
                disabled={!undoPrompt}
                onClick={() => {
                  const value = originalPrompt;
                  setOriginalPrompt(undoPrompt);
                  setUndoPrompt(value);
                  setScenePrompt("");
                }}
              >
                Undo
              </button>
            </div>
            <div className="mt-2" role="group" aria-label="Enhancement level">
              <p className="mb-2 text-xs font-bold text-white/50">
                Enhancement level
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(["short", "medium", "long"] as const).map((level) => (
                  <button
                    key={level}
                    aria-pressed={enhancementLevel === level}
                    className={`${command} px-2 ${choiceClass(enhancementLevel === level)}`}
                    disabled={Boolean(enhancing)}
                    onClick={() => void enhance(level)}
                  >
                    {enhancing === level
                      ? "Enhancing..."
                      : `Enhance ${level[0].toUpperCase() + level.slice(1)}`}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className={`${command} ${primary}`}
                disabled={building}
                onClick={() => void buildPrompt()}
              >
                {building
                  ? "Building with Ollama..."
                  : "AI Prompt Builder · Optional"}
              </button>
              <button
                className={command}
                disabled={micState === "processing"}
                onClick={() => void mic()}
              >
                {micState === "listening"
                  ? "Stop Mic"
                  : micState === "processing"
                    ? "Processing..."
                    : "Mic"}
              </button>
              {micState === "listening" ? (
                <button className={command} onClick={cancelMic}>
                  Cancel
                </button>
              ) : null}
              {micState === "error" ? (
                <button className={command} onClick={() => void mic()}>
                  Retry Mic
                </button>
              ) : null}
            </div>
          </section>
          <details className={surface}>
            <summary className="cursor-pointer text-sm font-black">
              Choose the Look
            </summary>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="text-xs text-white/55 md:col-span-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-bold text-white/85">
                      Visual Style
                    </span>
                    <p className="mt-0.5 text-[11px] text-white/40">
                      Choose a visual identity for the entire H3 video.
                    </p>
                  </div>

                  <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/45">
                    {H3_STYLE_PRESETS.length - 1} creative styles
                  </span>
                </div>

                <H3StylePresetPicker
                  value={stylePresetId}
                  onChange={setStylePresetId}
                />
              </div>

              <label className="text-xs text-white/55">
                Prompt Builder Visual Style
                <select
                  className={`${field} mt-1 ${
                    stylePresetId !== "none" ? "opacity-60" : ""
                  }`}
                  value={promptBuilderVisualStyle}
                  disabled={stylePresetId !== "none"}
                  onChange={(event) => setVisualStyle(event.target.value)}
                >
                  {H3_VISUAL_STYLE_OPTIONS.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-white/55">
                Camera Feel
                <select
                  className={`${field} mt-1`}
                  value={cameraFeel}
                  onChange={(event) => setCameraFeel(event.target.value)}
                >
                  {H3_CAMERA_FEEL_OPTIONS.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-white/55">
                Shot Flow
                <select
                  className={`${field} mt-1`}
                  value={shotFlow}
                  onChange={(event) => setShotFlow(event.target.value)}
                >
                  {H3_SHOT_FLOW_OPTIONS.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>
          </details>
          {suggestion ? (
            <section className={surface}>
              <p className="text-xs font-black uppercase text-violet-200/75">
                Ollama Review
              </p>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div>
                  <h3 className="text-sm font-black">Your Original</h3>
                  <div className="mt-2 min-h-32 whitespace-pre-wrap rounded-[6px] border border-white/10 bg-black/35 p-3 text-sm text-white/70">
                    {originalPrompt}
                  </div>
                  <button
                    className={`${command} mt-2`}
                    onClick={useCurrentRawPrompt}
                  >
                    Keep Original
                  </button>
                </div>
                <div>
                  <h3 className="text-sm font-black">Ollama Suggestion</h3>
                  <textarea
                    rows={8}
                    className={`${field} mt-2 resize-y`}
                    value={suggestionDraft}
                    onChange={(event) => setSuggestionDraft(event.target.value)}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      className={`${command} ${primary}`}
                      onClick={() => acceptPrompt(suggestion)}
                    >
                      Use Suggested Prompt
                    </button>
                    <button
                      className={command}
                      onClick={() => acceptPrompt(suggestionDraft)}
                    >
                      Edit Suggested Prompt
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ) : null}
          {mode === "h3-image-to-video" ? (
            <section className={surface}>
              <p className="text-xs font-black uppercase text-violet-200/75">
                02 / Image Conditioning
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {(
                  [
                    ["First Image", true, firstImage, setFirstImage, "first"],
                    ["Last Image", false, lastImage, setLastImage, "last"],
                  ] as const
                ).map(([label, required, item, setter, target]) => (
                  <article
                    key={label}
                    className="rounded-[6px] border border-white/10 bg-black/30 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-black">{label}</h3>
                        <p className="text-xs text-white/45">
                          {required ? "Required" : "Optional when supported"}
                        </p>
                      </div>
                      {item ? (
                        <button
                          className={command}
                          onClick={() => {
                            release(item);
                            setter(null);
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    {item ? (
                      <div className="mt-3">
                        <MediaPreview item={item} />
                      </div>
                    ) : (
                      <div className="mt-3 flex aspect-video items-center justify-center rounded-[6px] border border-dashed border-white/15 text-sm text-white/35">
                        No image selected
                      </div>
                    )}
                    <div className="mt-3 flex gap-2">
                      <label className={`${command} cursor-pointer`}>
                        Upload
                        <input
                          hidden
                          type="file"
                          accept={H3_MEDIA_ACCEPT.image}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) replaceSingle(item, file, setter);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                      <button
                        className={command}
                        onClick={() => setGalleryTarget(target)}
                      >
                        Gallery
                      </button>
                        <button
                          type="button"
                          className={command}
                          onClick={() => setSnapshotTarget(target)}
                        >
                          Snapshot
                        </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {mode === "h3-reference-to-video" ? (
            <section className={surface}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase text-violet-200/75">
                    02 / Reference Deck
                  </p>
                  <h2 className="mt-1 text-lg font-black">
                    Ordered References
                  </h2>
                  <p className="text-xs text-white/45">
                    {REFERENCE_LIMIT_HELP}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["image", "video", "audio"] as const).map((kind) => (
                    <label key={kind} className={`${command} cursor-pointer`}>
                      + {kind[0].toUpperCase() + kind.slice(1)}
                      <input
                        hidden
                        type="file"
                        accept={H3_MEDIA_ACCEPT[kind]}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) addReference(kind, file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  ))}
                  <button
                    className={command}
                    onClick={() => setGalleryTarget("reference-image")}
                  >
                    Gallery Image
                  </button>
                    <button
                      type="button"
                      className={command}
                      onClick={() => setSnapshotTarget("reference-image")}
                    >
                      Snapshot
                    </button>
                  <button
                    className={command}
                    onClick={() => setGalleryTarget("reference-video")}
                  >
                    Gallery Video
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {references.map((item, index) => (
                  <article
                    key={item.id}
                    className="min-w-0 overflow-hidden rounded-[6px] border border-white/10 bg-black/30 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase text-cyan-200">
                          {item.kind} reference {index + 1}
                        </p>
                        <p className="truncate text-xs text-white/45">
                          {item.name}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          className={command}
                          disabled={referenceMoveTarget(index, -1) < 0}
                          onClick={() => moveReference(index, -1)}
                        >
                          Up
                        </button>
                        <button
                          className={command}
                          disabled={referenceMoveTarget(index, 1) < 0}
                          onClick={() => moveReference(index, 1)}
                        >
                          Down
                        </button>
                        <button
                          className={command}
                          onClick={() => removeReference(item.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <div className="mt-3">
                      <MediaPreview item={item} />
                    </div>
                    <input
                      className={`${field} mt-3`}
                      value={item.description}
                      onChange={(event) =>
                        updateReference(item.id, {
                          description: event.target.value,
                        })
                      }
                      placeholder="Identity, role, motion, or sound use"
                    />
                    {item.kind === "video" ? (
                      <>
                        <VideoReferenceWindowControl
                          item={item}
                          onChange={(patch) => updateReference(item.id, patch)}
                        />
                        <label className="mt-3 flex items-center gap-2 text-sm text-white/70">
                          <input
                            type="checkbox"
                            checked={item.includeAudio === true}
                            onChange={(event) =>
                              updateReference(item.id, {
                                includeAudio: event.target.checked,
                              })
                            }
                          />
                          Use Audio From Video
                        </label>
                      </>
                    ) : null}
                  </article>
                ))}
              </div>
              {!references.length ? (
                <div className="mt-4 rounded-[6px] border border-dashed border-white/15 py-8 text-center text-sm text-white/35">
                  Add references to begin
                </div>
              ) : null}
            </section>
          ) : null}
          {originalPrompt.trim() || scenePrompt.trim() || lockedReferences ? (
            <details className={surface}>
              <summary className="cursor-pointer text-sm font-black">
                View Exact Final Prompt
              </summary>
              <label className="mt-3 block text-xs font-black uppercase text-white/45">
                Locked References
                <textarea
                  readOnly
                  rows={Math.max(2, lockedReferences.split("\n").length)}
                  className={`${field} mt-1 font-mono text-xs`}
                  value={
                    lockedReferences ||
                    "No locked reference block for Text mode."
                  }
                />
              </label>
              {scenePrompt ? (
                <label className="mt-3 block text-xs font-black uppercase text-white/45">
                  Editable Builder Scene Prompt
                  <textarea
                    rows={10}
                    className={`${field} mt-1 resize-y font-mono text-xs leading-5`}
                    value={scenePrompt}
                    onChange={(event) => setScenePrompt(event.target.value)}
                  />
                </label>
              ) : null}
              <label className="mt-3 block text-xs font-black uppercase text-white/45">
                Exact Final Prompt
                <textarea
                  readOnly
                  rows={10}
                  className={`${field} mt-1 resize-y font-mono text-xs leading-5`}
                  value={exactFinalPrompt}
                />
              </label>
              {builderPromptStale ? (
                <div className="mt-3 rounded-[6px] border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
                  The optional Builder prompt changed. You can review it again or use your current raw prompt directly.
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {scenePrompt ? (
                  <button
                    className={command}
                    onClick={() => acceptPrompt(scenePrompt)}
                  >
                    Review Current Builder Prompt
                  </button>
                ) : null}
                {promptSource === "builder" ? (
                  <button className={command} onClick={useCurrentRawPrompt}>
                    Use Current Raw Prompt
                  </button>
                ) : null}
              </div>
            </details>
          ) : null}
            </>
          )}
        </main>
        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          {studioMode === "h3-realism" ? (
            <section className={surface} data-otg="h3-realism-controls">
              <p className="text-xs font-black uppercase text-violet-200/75">
                Realism Controls
              </p>
              <p className="mb-2 mt-4 text-xs font-bold text-white/50">
                Quality
              </p>
              <div
                className="grid grid-cols-3 gap-2"
                role="group"
                aria-label="Realism quality"
              >
                {H3_QUALITY_OPTIONS.map((value) => (
                  <button
                    key={value}
                    aria-pressed={quality === value}
                    className={`${command} ${choiceClass(quality === value)}`}
                    onClick={() => setQuality(value)}
                  >
                    {QUALITY_LABELS[value]}
                    <span className="mt-1 block text-[11px] font-bold leading-4 text-white/45">
                      {getH3NativeDimensions(value, orientation).width}x{getH3NativeDimensions(value, orientation).height}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mb-2 mt-4 text-xs font-bold text-white/50">
                Duration
              </p>
              <div
                className="grid grid-cols-2 gap-2"
                role="group"
                aria-label="Realism duration"
              >
                {H3_PRODUCTION_DURATION_OPTIONS.map((value) => (
                  <button
                    key={value}
                    aria-pressed={duration === value}
                    className={`${command} ${choiceClass(duration === value)}`}
                    onClick={() => setDuration(value)}
                  >
                    {value} sec
                  </button>
                ))}
              </div>
              <p className="mb-2 mt-4 text-xs font-bold text-white/50">
                Orientation
              </p>
              <div
                className="grid grid-cols-2 gap-2"
                role="group"
                aria-label="Realism orientation"
              >
                {H3_ORIENTATION_OPTIONS.map((value) => (
                  <button
                    key={value}
                    aria-pressed={orientation === value}
                    className={`${command} ${choiceClass(orientation === value)}`}
                    onClick={() => setOrientation(value)}
                  >
                    {value === "landscape" ? "Landscape" : "Portrait"}
                  </button>
                ))}
              </div>
              {renderRife60FpsControl()}
              <p className="mb-2 mt-4 text-xs font-bold text-white/50">
                Seed
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(["random", "fixed"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={realismSeedMode === value}
                    className={`${command} ${choiceClass(realismSeedMode === value)}`}
                    onClick={() => setRealismSeedMode(value)}
                  >
                    {value === "random" ? "Random" : "Explicit"}
                  </button>
                ))}
              </div>
              {realismSeedMode === "fixed" ? (
                <input
                  className={`${field} mt-2`}
                  type="number"
                  min={0}
                  step={1}
                  value={realismSeed}
                  onChange={(event) => setRealismSeed(event.target.value)}
                  placeholder="Seed"
                />
              ) : null}
              <div className="mt-4 rounded-[6px] border border-white/10 bg-black/30 p-3 text-sm text-white/60">
                <span className="font-semibold text-white/80">
                  References:
                </span>{" "}
                {realismReferenceCounts.image} image /{" "}
                {realismReferenceCounts.video} video /{" "}
                {realismReferenceCounts.audio} audio
                <br />
                <span className="font-semibold text-white/80">
                  Compiled:
                </span>{" "}
                {finalRealismPrompt ? "ready" : "waiting for prompt"}
              </div>
              <button
                className={`${command} ${primary} mt-4 min-h-14 w-full text-base`}
                disabled={!canGenerateRealism || active}
                onClick={() => void generateRealism()}
              >
                {active ? "Generation Running" : "Generate Realism"}
              </button>
            </section>
          ) : studioMode === "h3-body-swap" ? (
            <section className={surface} data-otg="h3-body-swap-controls">
              <p className="text-xs font-black uppercase text-violet-200/75">
                Body Swap Controls
              </p>
              <p className="mb-2 mt-4 text-xs font-bold text-white/50">
                Quality
              </p>
              <div
                className="grid grid-cols-3 gap-2"
                role="group"
                aria-label="Body Swap quality"
              >
                {H3_QUALITY_OPTIONS.map((value) => (
                  <button
                    key={value}
                    aria-pressed={quality === value}
                    className={`${command} ${choiceClass(quality === value)}`}
                    onClick={() => setQuality(value)}
                  >
                    {QUALITY_LABELS[value]}
                    <span className="mt-1 block text-[11px] font-bold leading-4 text-white/45">
                      {QUALITY_DETAILS[value]}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mb-2 mt-4 text-xs font-bold text-white/50">
                Duration
              </p>
              <div
                className="grid grid-cols-2 gap-2"
                role="group"
                aria-label="Body Swap duration"
              >
                {H3_PRODUCTION_DURATION_OPTIONS.map((value) => (
                  <button
                    key={value}
                    aria-pressed={duration === value}
                    className={`${command} ${choiceClass(duration === value)}`}
                    onClick={() => setDuration(value)}
                  >
                    {value} sec
                  </button>
                ))}
              </div>
              <p className="mb-2 mt-4 text-xs font-bold text-white/50">
                Orientation
              </p>
              <div
                className="grid grid-cols-2 gap-2"
                role="group"
                aria-label="Body Swap orientation"
              >
                {H3_ORIENTATION_OPTIONS.map((value) => (
                  <button
                    key={value}
                    aria-pressed={orientation === value}
                    className={`${command} ${choiceClass(orientation === value)}`}
                    onClick={() => setOrientation(value)}
                  >
                    {value === "landscape" ? "Landscape" : "Portrait"}
                  </button>
                ))}
              </div>
              {renderRife60FpsControl()}
              <p className="mb-2 mt-4 text-xs font-bold text-white/50">
                Seed
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(["random", "fixed"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={bodySwapSeedMode === value}
                    className={`${command} ${choiceClass(bodySwapSeedMode === value)}`}
                    onClick={() => setBodySwapSeedMode(value)}
                  >
                    {value === "random" ? "Random" : "Explicit"}
                  </button>
                ))}
              </div>
              {bodySwapSeedMode === "fixed" ? (
                <input
                  className={`${field} mt-2`}
                  type="number"
                  min={0}
                  step={1}
                  value={bodySwapSeed}
                  onChange={(event) => setBodySwapSeed(event.target.value)}
                  placeholder="Seed"
                />
              ) : null}
              <div className="mt-4 rounded-[6px] border border-white/10 bg-black/30 p-3 text-sm text-white/60">
                <span className="font-semibold text-white/80">
                  Source:
                </span>{" "}
                {bodySwapSourceVideo ? "ready" : "missing"}
                <br />
                <span className="font-semibold text-white/80">
                  Replacement:
                </span>{" "}
                {bodySwapReplacementImage ? "ready" : "missing"}
                <br />
                <span className="font-semibold text-white/80">
                  Audio:
                </span>{" "}
                {bodySwapPreserveAudio ? "preserve original" : "render silent"}
                <br />
                <span className="text-xs">
                  First TEST adapter keeps the source video dimensions from the
                  imported graph; duration controls the 24 fps frame cap.
                </span>
              </div>
              <button
                className={`${command} ${primary} mt-4 min-h-14 w-full text-base`}
                disabled={!canGenerateBodySwap || active}
                onClick={() => void generateBodySwap()}
              >
                {active ? "Generation Running" : "Generate Body Swap"}
              </button>
            </section>
          ) : studioMode === "h3-refmods" ? (
            <section className={surface} data-otg="h3-refmods-controls">
              <p className="text-xs font-black uppercase text-violet-200/75">
                Ref Mods Controls
              </p>
              <p className="mb-2 mt-4 text-xs font-bold text-white/50">
                Quality
              </p>
              <div
                className="grid grid-cols-3 gap-2"
                role="group"
                aria-label="Ref Mods quality"
              >
                {H3_QUALITY_OPTIONS.map((value) => (
                  <button
                    key={value}
                    aria-pressed={quality === value}
                    className={`${command} ${choiceClass(quality === value)}`}
                    onClick={() => setQuality(value)}
                  >
                    {QUALITY_LABELS[value]}
                  </button>
                ))}
              </div>
              <p className="mb-2 mt-4 text-xs font-bold text-white/50">
                Duration
              </p>
              <div
                className="grid grid-cols-2 gap-2"
                role="group"
                aria-label="Ref Mods duration"
              >
                {H3_PRODUCTION_DURATION_OPTIONS.map((value) => (
                  <button
                    key={value}
                    aria-pressed={duration === value}
                    className={`${command} ${choiceClass(duration === value)}`}
                    onClick={() => setDuration(value)}
                  >
                    {value} sec
                  </button>
                ))}
              </div>
              <p className="mb-2 mt-4 text-xs font-bold text-white/50">
                Orientation
              </p>
              <div
                className="grid grid-cols-2 gap-2"
                role="group"
                aria-label="Ref Mods orientation"
              >
                {H3_ORIENTATION_OPTIONS.map((value) => (
                  <button
                    key={value}
                    aria-pressed={orientation === value}
                    className={`${command} ${choiceClass(orientation === value)}`}
                    onClick={() => setOrientation(value)}
                  >
                    {value === "landscape" ? "Landscape" : "Portrait"}
                  </button>
                ))}
              </div>
              {renderRife60FpsControl()}
              <p className="mb-2 mt-4 text-xs font-bold text-white/50">
                Turbo
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([true, false] as const).map((value) => (
                  <button
                    key={String(value)}
                    type="button"
                    aria-pressed={refModsTurbo === value}
                    className={`${command} ${choiceClass(refModsTurbo === value)}`}
                    onClick={() => setRefModsTurbo(value)}
                  >
                    {value ? "Turbo" : "Native"}
                  </button>
                ))}
              </div>
              <p className="mb-2 mt-4 text-xs font-bold text-white/50">
                Seed
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(["random", "fixed"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={refModsSeedMode === value}
                    className={`${command} ${choiceClass(refModsSeedMode === value)}`}
                    onClick={() => setRefModsSeedMode(value)}
                  >
                    {value === "random" ? "Random" : "Explicit"}
                  </button>
                ))}
              </div>
              {refModsSeedMode === "fixed" ? (
                <input
                  className={`${field} mt-2`}
                  type="number"
                  min={0}
                  step={1}
                  value={refModsSeed}
                  onChange={(event) => setRefModsSeed(event.target.value)}
                  placeholder="Seed"
                />
              ) : null}
              <div className="mt-4 rounded-[6px] border border-white/10 bg-black/30 p-3 text-sm text-white/60">
                <span className="font-semibold text-white/80">
                  RefMods:
                </span>{" "}
                {refModSlots.length} / {H3_REFMOD_LIMITS.maxRefMods}
                <br />
                <span className="font-semibold text-white/80">
                  Compiled:
                </span>{" "}
                {refModsCompiledPrompt ? "ready" : "waiting for prompt"}
                <br />
                <span className="text-xs">
                  Uses the validated RefMod T2V adapter on the RTX 3090 test backend.
                </span>
              </div>
              <button
                className={`${command} ${primary} mt-4 min-h-14 w-full text-base`}
                disabled={!canGenerateRefMods || active}
                onClick={() => void generateRefMods()}
              >
                {active ? "Generation Running" : "Generate Ref Mods"}
              </button>
            </section>
          ) : !legacyModeActive ? (
            <section className={surface}>
              <p className="text-xs font-black uppercase text-violet-200/75">
                Safety Gate
              </p>
              <h2 className="mt-1 text-lg font-black">
                {specialModeLabel} cannot submit yet
              </h2>
              <p className="mt-3 text-sm leading-6 text-white/60">
                The TEST tab is visible, but Generate is intentionally disabled
                until a dedicated special-mode route validates inputs and builds
                the correct ComfyUI workflow.
              </p>
              <button
                className={`${command} mt-4 min-h-14 w-full text-base`}
                disabled
              >
                Dedicated Adapter Required
              </button>
            </section>
          ) : (
            <>
          <section className={surface}>
            <p className="text-xs font-black uppercase text-violet-200/75">
              03 / Output
            </p>
            <p className="mb-2 mt-3 text-xs font-bold text-white/50">Quality</p>
            <div
              className="grid grid-cols-1 gap-2 sm:grid-cols-3"
              role="group"
              aria-label="H3 quality"
            >
              {H3_QUALITY_OPTIONS.map((value) => (
                <button
                  key={value}
                  aria-pressed={quality === value}
                  className={`${command} text-left ${choiceClass(quality === value)}`}
                  onClick={() => setQuality(value)}
                >
                  <span className="block font-black">
                    {value === "sh" ? "SH · Scene Hunter" : QUALITY_LABELS[value]} · {getH3NativeDimensions(value, orientation).width}x{getH3NativeDimensions(value, orientation).height}
                  </span>
                  <span className="mt-1 block text-[11px] font-bold leading-4 text-white/45">
                    {QUALITY_DETAILS[value]}
                  </span>
                </button>
              ))}
            </div>
            <p className="mb-2 mt-4 text-xs font-bold text-white/50">
              Duration
            </p>
            <div
              className="grid grid-cols-2 gap-2"
              role="group"
              aria-label="H3 duration"
            >
              {H3_PRODUCTION_DURATION_OPTIONS.map((value) => (
                <button
                  key={value}
                  aria-pressed={duration === value}
                  className={`${command} ${choiceClass(duration === value)}`}
                  onClick={() => setDuration(value)}
                >
                  {value} sec
                </button>
              ))}
            </div>
            <p className="mb-2 mt-4 text-xs font-bold text-white/50">
              Orientation
            </p>
            <div
              className="grid grid-cols-2 gap-2"
              role="group"
              aria-label="H3 orientation"
            >
              {H3_ORIENTATION_OPTIONS.map((value) => (
                <button
                  key={value}
                  aria-pressed={orientation === value}
                  className={`${command} ${choiceClass(orientation === value)}`}
                  onClick={() => setOrientation(value)}
                >
                  {value === "landscape" ? "Landscape" : "Portrait"}
                </button>
              ))}
            </div>
            {renderRife60FpsControl()}
            <div className="mt-4 rounded-[6px] border border-white/10 bg-black/30 p-3 text-sm text-white/60">
              <span className="font-semibold text-white/80">Canvas:</span>{" "}
              {nativeDimensions.width}x{nativeDimensions.height}
              <br />
              <span className="font-semibold text-white/80">Estimate:</span> ~
              {formatDuration(estimate.minSeconds)} to{" "}
              {formatDuration(estimate.maxSeconds)}
              <br />
              <span className="text-xs">
                Actual time varies by GPU and queue. Portrait inherits the matching landscape estimate and is not independently benchmarked.
              </span>
            </div>
          </section>
          <details className={surface}>
            <summary className="cursor-pointer text-sm font-black">
              LoRAs and Creative Controls
            </summary>
            <div
              className="mt-4"
              data-otg="h3-advanced-controls-panel"
            >
              <H3AdvancedControls
                value={h3Settings}
                onChange={setH3Settings}
                referenceOptions={refModReferenceOptions}
                disabled={active}
              />
            </div>

            <div className="mt-4 rounded-[6px] border border-cyan-300/25 bg-cyan-300/10 p-3">
              <p className="text-sm font-black">
                {h3Settings.renderMode === "native"
                  ? "MiniMax H3 Native · 20-step"
                  : "MiniMax H3 Turbo · 8-step"}
              </p>
              <p className="text-xs text-white/60">
                {h3Settings.checkpointMode === "singularity"
                  ? `Singularity · Realism On · Combat ${h3Settings.combatLoraEnabled ? "On" : "Off"}`
                  : "Standard model"}{" "}
                · SLA attention
              </p>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black uppercase text-white/50">
                  Optional H3 LoRAs
                </p>
                <span className="text-xs text-white/40">
                  {selectedLoras.length}/{maxLoras}
                </span>
              </div>
              <select
                className={`${field} mt-2`}
                value=""
                onChange={(event) => addLora(event.target.value)}
              >
                <option value="">+ Add approved LoRA</option>
                {catalog
                  .filter(
                    (entry) =>
                      !selectedLoras.some((item) => item.id === entry.id),
                  )
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.displayName}
                    </option>
                  ))}
              </select>
              {selectedLoras.map((selection) => {
                const entry = catalog.find((item) => item.id === selection.id);
                if (!entry) return null;
                return (
                  <article
                    key={selection.id}
                    className="mt-3 rounded-[6px] border border-white/10 bg-black/30 p-3"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-black">{entry.displayName}</p>
                        <p className="text-xs text-white/45">
                          {entry.description}
                        </p>
                      </div>
                      <button
                        className={command}
                        onClick={() =>
                          setSelectedLoras((current) =>
                            current.filter((item) => item.id !== selection.id),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-[40px_1fr_40px_58px] items-center gap-2">
                      <button
                        className={command}
                        aria-label={`Decrease ${entry.displayName}`}
                        onClick={() =>
                          updateLora(selection.id, selection.strength - 0.05)
                        }
                      >
                        -
                      </button>
                      <input
                        type="range"
                        min={entry.minStrength}
                        max={entry.maxStrength}
                        step="0.05"
                        value={selection.strength}
                        onChange={(event) =>
                          updateLora(selection.id, Number(event.target.value))
                        }
                      />
                      <button
                        className={command}
                        aria-label={`Increase ${entry.displayName}`}
                        onClick={() =>
                          updateLora(selection.id, selection.strength + 0.05)
                        }
                      >
                        +
                      </button>
                      <input
                        className={`${field} px-2 text-center`}
                        type="number"
                        min={entry.minStrength}
                        max={entry.maxStrength}
                        step="0.05"
                        value={selection.strength}
                        onChange={(event) =>
                          updateLora(selection.id, Number(event.target.value))
                        }
                      />
                    </div>
                    <p className="mt-2 text-[11px] text-white/45">
                      Recommended {entry.recommendedMin}-{entry.recommendedMax}.
                      Available: {entry.discoveredOn.join(", ")}.
                    </p>
                    {entry.triggerWords.length ? (
                      <button
                        className={`${command} mt-2`}
                        onClick={() =>
                          replaceOriginal(
                            [
                              originalPrompt,
                              ...entry.triggerWords.filter(
                                (word) =>
                                  !originalPrompt
                                    .toLowerCase()
                                    .includes(word.toLowerCase()),
                              ),
                            ]
                              .filter(Boolean)
                              .join("\n"),
                          )
                        }
                      >
                        Add recommended trigger words
                      </button>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </details>
          <button
            className={`${command} ${primary} min-h-14 w-full text-base`}
            disabled={active || !canGenerate}
            onClick={() => void generate()}
          >
            {active
              ? quality === "sh" ? "Scene Hunter Running" : "Generation Running"
              : builderPromptStale
                ? "Use Raw Prompt or Review Builder"
                : !canGenerate
                  ? "Add Prompt and Required Inputs"
                : quality === "sh" ? "Generate Scene Hunter" : "Generate Video"}
          </button>
          {workflowNotice ? (
            <div
              role="status"
              aria-live="polite"
              className={`rounded-[6px] border px-4 py-3 text-sm font-semibold ${workflowNoticeClass}`}
              data-otg="h3-workflow-status-near-generate"
            >
              <div className="font-black">{workflowNotice.title}</div>
              <div className="mt-1 text-white/75">{workflowNotice.detail}</div>
              {job?.promptId ? (
                <div className="mt-1 break-all font-mono text-xs text-white/55">
                  Prompt ID: {job.promptId}
                </div>
              ) : null}
            </div>
          ) : null}
            </>
          )}
        </aside>
      </div>
      {workflowNotice ? (
        <section
          role="status"
          aria-live="polite"
          className={`rounded-[6px] border px-4 py-3 text-sm font-semibold ${workflowNoticeClass}`}
          data-otg="h3-workflow-status-above-preview"
        >
          <div className="font-black">{workflowNotice.title}</div>
          <div className="mt-1 text-white/75">{workflowNotice.detail}</div>
          {job?.promptId ? (
            <div className="mt-1 break-all font-mono text-xs text-white/55">
              Prompt ID: {job.promptId}
            </div>
          ) : null}
        </section>
      ) : null}
      {job ? (
        <section className={surface}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase text-violet-200/75">
                Live H3 Job
              </p>
              <h2 className="mt-1 text-lg font-black">{job.statusMessage}</h2>
              <p className="mt-1 text-sm text-white/55">
                Elapsed {formatDuration(elapsedSeconds(job, now))} |{" "}
                {job.backendLabel || "GPU assignment pending"}
              </p>
            </div>
            <div className="text-right text-xs text-white/45">
              Job {job.id}
              <br />
              Prompt {job.promptId || "pending"}
              <br />
              {job.nativeResolution || "Resolution pending"}
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-violet-300 transition-all"
              style={{ width: `${job.progressPercent ?? 0}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-white/45">
            <span>
              {job.progressPercent ?? 0}% estimated execution progress
            </span>
            <span>
              Queue remaining: {job.queueRemaining ?? "not reported"} | Node:{" "}
              {job.currentNode || "not reported by ComfyUI"}
            </span>
          </div>
          {job.error ? (
            <div className="mt-4 rounded-[6px] border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">
              {job.error}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button className={command} onClick={() => void refreshJob()}>
              Refresh
            </button>
            {active ? (
              <button className={command} onClick={() => void cancelGeneration()}>
                {job.status === "canceling" ? "Canceling..." : "Cancel Generation"}
              </button>
            ) : null}
            <button
              className={command}
              disabled={active}
              onClick={() => void retry()}
            >
              Retry
            </button>
            <button
              className={command}
              disabled={active}
              onClick={clearJob}
            >
              Clear Result
            </button>
          </div>
          {active && job.approximatePreview ? (
            <div
              className="mt-4 rounded-[6px] border border-cyan-300/25 bg-cyan-300/[0.06] p-3"
              data-otg="h3-approximate-preview"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-black text-cyan-50">Approximate Preview</h3>
                  <p className="text-xs text-cyan-100/60">Sampling preview only. Final quality appears after completion.</p>
                </div>
                <span className="text-xs font-bold text-cyan-100/60">
                  {job.approximatePreview.step !== null && job.approximatePreview.total !== null
                    ? `Step ${job.approximatePreview.step}/${job.approximatePreview.total}`
                    : "Live"}
                </span>
              </div>
              {job.approximatePreview.mimeType.startsWith("video/") ? (
                <video
                  key={job.approximatePreview.updatedAt}
                  src={job.approximatePreview.imageUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="auto"
                  className="max-h-[48vh] w-full rounded-[6px] bg-black object-contain"
                />
              ) : (
                <img
                  src={job.approximatePreview.imageUrl}
                  alt="Approximate Preview"
                  className="max-h-[48vh] w-full rounded-[6px] bg-black object-contain"
                />
              )}
            </div>
          ) : active ? (
            <div className="mt-4 rounded-[6px] border border-white/10 bg-black/25 p-3 text-sm text-white/45" data-otg="h3-approximate-preview-empty">
              Approximate Preview will appear when the sampler emits the first preview frame.
            </div>
          ) : null}
          {job.videoUrl ? (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-black text-white">Final Video</h3>
              <video
                src={job.videoUrl}
                poster={job.thumbnailUrl || undefined}
                controls
                playsInline
                preload="metadata"
                className="max-h-[70vh] w-full rounded-[6px] bg-black"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`${job.videoUrl}${job.videoUrl.includes("?") ? "&" : "?"}download=1`}
                  download={job.galleryFileName || "MiniMax-H3-video.mp4"}
                  className={command}
                >
                  Download
                </a>
                {job.galleryStatus === "saved" ? (
                  <a className={command} href={job.galleryUrl || "#"}>
                    Saved to Gallery
                  </a>
                ) : job.galleryStatus === "failed" ? (
                  <button className={command} onClick={() => void retryGallerySave()}>
                    Retry Gallery Save
                  </button>
                ) : (
                  <span className="rounded-[6px] border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-bold text-cyan-100">
                    Saving to Gallery...
                  </span>
                )}
                <button
                  className={command}
                  onClick={() => void useAsReference()}
                >
                  Use as Reference
                </button>
              </div>
              {job.galleryError ? (
                <p className="mt-2 text-sm text-amber-100">Gallery save: {job.galleryError}</p>
              ) : null}
              <details className="mt-4 rounded-[6px] border border-white/10 p-3">
                <summary className="cursor-pointer text-sm font-black">
                  Diagnostics
                </summary>
                <dl className="mt-3 grid gap-2 text-sm text-white/60 md:grid-cols-2">
                  <div>
                    <dt className="font-bold text-white/80">Workflow</dt>
                    <dd className="break-all">{job.workflowId}</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-white/80">File</dt>
                    <dd className="break-all">{job.workflowFile}</dd>
                  </div>
                  <div className="md:col-span-2">
                    <dt className="font-bold text-white/80">
                      Exact Prompt Used
                    </dt>
                    <dd className="whitespace-pre-wrap">{job.prompt}</dd>
                  </div>
                </dl>
              </details>
            </div>
          ) : null}
        </section>
      ) : null}
      <section className={surface}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-white/45">
              Generator Reset
            </p>
            <p className="mt-1 text-sm text-white/55">
              Clears saved H3 prompts, controls, images, video references, audio references, and LoRAs on this device.
            </p>
          </div>
          <button
            type="button"
            className={command}
            onClick={resetH3Inputs}
          >
            Reset H3 Generator
          </button>
        </div>
      </section>
      <VideoSnapshotPicker
        open={Boolean(snapshotTarget)}
        onClose={() => setSnapshotTarget("")}
        onSnapshot={({ file }) => {
          if (snapshotTarget === "first") {
            replaceSingle(
              firstImage,
              file,
              setFirstImage,
            );
          } else if (snapshotTarget === "last") {
            replaceSingle(
              lastImage,
              file,
              setLastImage,
            );
          } else if (snapshotTarget === "reference-image") {
            addReference(
              "image",
              file,
            );
          }

          setSnapshotTarget("");
        }}
      />
      {galleryTarget ? (
        <GalleryPicker
          kind={galleryTarget.includes("video") ? "video" : "image"}
          onClose={() => setGalleryTarget("")}
          onPick={(file) => {
            if (galleryTarget === "first")
              replaceSingle(firstImage, file, setFirstImage);
            else if (galleryTarget === "last")
              replaceSingle(lastImage, file, setLastImage);
            else
              addReference(
                galleryTarget === "reference-video" ? "video" : "image",
                file,
              );
          }}
        />
      ) : null}
    </div>
  );
}
