"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { H3LoraCatalogEntry } from "@/lib/h3LoraCatalogServer";
import {
  buildH3StudioLockedReferences,
  composeH3StudioFinalPrompt,
  h3StudioPromptFingerprint,
  preserveH3QuotedDialogue,
  type H3StudioLoraSelection,
  type H3StudioReferenceDescriptor,
} from "@/lib/h3Studio";
import { H3_MEDIA_ACCEPT } from "@/lib/h3MediaTypes";
import { H3_REFERENCE_VIDEO_CLIP_SECONDS } from "@/lib/h3ReferenceVideo";
import { resolveH3CanonicalStyle } from "@/lib/h3StyleRegistry";
import H3AdvancedControls from "@/app/app/components/H3AdvancedControls";
import H3StyleSelector from "@/app/app/components/H3StyleSelector";
import VideoSnapshotPicker from "@/app/app/components/VideoSnapshotPicker";
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
} from "@/lib/production/promptOptions";
import type { ProductionV2H3Mode } from "@/lib/production/h3Workflows";

type Mode = ProductionV2H3Mode;
type MediaKind = "image" | "video" | "audio";
type MediaInput = H3StudioReferenceDescriptor & {
  file: File;
  url: string;
  sourceDurationSeconds?: number;
};
type PersistedMediaInput = Omit<MediaInput, "url">;
type H3StudioPersistedDraft = {
  mode: Mode;
  quality: H3Quality;
  h3Settings: H3AdvancedSettings;
  duration: 5 | 10;
  orientation: H3Orientation;
  originalPrompt: string;
  scenePrompt: string;
  promptSource: "direct" | "builder";
  reviewedFingerprint: string;
  stylePresetId: string;
  cameraFeel: string;
  shotFlow: string;
  enhancementLevel: "short" | "medium" | "long";
  firstImage: PersistedMediaInput | null;
  lastImage: PersistedMediaInput | null;
  references: PersistedMediaInput[];
  selectedLoras: H3StudioLoraSelection[];
};
type JobStatus = {
  id: string;
  status: string;
  statusMessage: string;
  mode: Mode;
  quality: H3Quality;
  orientation: H3Orientation;
  durationSeconds: 5 | 10;
  prompt: string;
  seed: number;
  rawPrompt?: string;
  promptFingerprint?: string | null;
  backend: string | null;
  backendLabel: string | null;
  workflowId: string | null;
  workflowFile: string | null;
  nativeResolution: string | null;
  etaSeconds: number | null;
  etaMinSeconds: number;
  etaMaxSeconds: number;
  promptId: string | null;
  queueRemaining: number | null;
  progressPercent: number | null;
  currentNode: string | null;
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
  sceneHunter?: boolean;
  sceneHunterSourceJobId?: string | null;
  sceneHunterPromotedJobId?: string | null;
  previewEnabled?: boolean;
};

const MODE_OPTIONS: Array<{ id: Mode; label: string; detail: string }> = [
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
];
const surface =
  "min-w-0 max-w-full rounded-[8px] border border-white/10 bg-[#090b15]/90 p-4 shadow-[0_18px_45px_rgba(0,0,0,.22)]";
const field =
  "min-w-0 max-w-full w-full rounded-[6px] border border-white/15 bg-black/45 px-3 py-2 text-sm text-white [overflow-wrap:anywhere] outline-none focus:border-violet-300/70";
const command =
  "min-h-10 rounded-[6px] border border-white/15 bg-white/[0.06] px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.11] disabled:cursor-not-allowed disabled:opacity-45";
const primary =
  "border-violet-300/60 bg-violet-300 text-[#090b15] hover:bg-violet-200";
const selectedChoice =
  "!border-violet-300/80 !bg-violet-300/20 text-white shadow-[0_0_0_1px_rgba(196,181,253,.12),0_0_18px_rgba(139,92,246,.18)]";
const REFERENCE_LIMIT_HELP =
  "Up to 9 images, 3 videos, and 3 standalone audio references.";
const QUALITY_LABELS: Record<H3Quality, string> = { sh: "SH", lq: "LQ", hq: "HQ" };
const QUALITY_DETAILS: Record<H3Quality, string> = {
  sh: "Scene Hunter · 0.2 MP quick scene search",
  lq: "0.6 MP native",
  hq: "1.0 MP native",
};
const H3_STUDIO_DRAFT_DB = "otg-h3-studio-draft-v1";
const H3_STUDIO_DRAFT_STORE = "drafts";
const H3_STUDIO_DRAFT_KEY = "current";

function openH3StudioDraftDb() {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }
  return new Promise<IDBDatabase | null>((resolve) => {
    const request = window.indexedDB.open(H3_STUDIO_DRAFT_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(H3_STUDIO_DRAFT_STORE);
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
  });
}

async function readH3StudioDraft() {
  const db = await openH3StudioDraftDb();
  if (!db) return null;
  return new Promise<H3StudioPersistedDraft | null>((resolve) => {
    const tx = db.transaction(H3_STUDIO_DRAFT_STORE, "readonly");
    const request = tx.objectStore(H3_STUDIO_DRAFT_STORE).get(H3_STUDIO_DRAFT_KEY);
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve((request.result || null) as H3StudioPersistedDraft | null);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
}

async function writeH3StudioDraft(draft: H3StudioPersistedDraft) {
  const db = await openH3StudioDraftDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(H3_STUDIO_DRAFT_STORE, "readwrite");
    tx.objectStore(H3_STUDIO_DRAFT_STORE).put(draft, H3_STUDIO_DRAFT_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      resolve();
    };
  });
}

function IconSpeaker() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path d="M16 9.2a4 4 0 0 1 0 5.6M18.5 6.5a7.5 7.5 0 0 1 0 11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconStop() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l10-6.5-10-6.5Z" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <rect x="6.5" y="5" width="4" height="14" rx="1" />
      <rect x="13.5" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function IconMic() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 11.5a6 6 0 0 1-12 0M12 17.5V21M9 21h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function finalPromptSpeechChunks(value: string) {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > 220) {
      chunks.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) chunks.push(current);
  return chunks;
}

function formatDuration(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  return value >= 60
    ? `${Math.floor(value / 60)}m ${value % 60}s`
    : `${value}s`;
}
function formatClipTime(seconds: number) {
  const value = Math.max(0, seconds);
  const minutes = Math.floor(value / 60);
  return `${minutes}:${(value % 60).toFixed(1).padStart(4, "0")}`;
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

function MediaPreview({
  item,
  clipStartSeconds = 0,
  onVideoDuration,
}: {
  item: MediaInput;
  clipStartSeconds?: number;
  onVideoDuration?: (durationSeconds: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(clipStartSeconds, video.duration);
  }, [clipStartSeconds, item.url]);
  if (item.kind === "image")
    return (
      <img
        src={item.url}
        alt={item.name}
        className="block aspect-video h-auto w-full min-w-0 max-w-full rounded-[6px] bg-black object-contain"
      />
    );
  if (item.kind === "video")
    return (
      <video
        ref={videoRef}
        src={item.url}
        controls
        preload="metadata"
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (Number.isFinite(video.duration)) {
            onVideoDuration?.(video.duration);
            video.currentTime = Math.min(clipStartSeconds, video.duration);
          }
        }}
        className="block aspect-video h-auto w-full min-w-0 max-w-full rounded-[6px] bg-black object-contain"
      />
    );
  return (
    <audio src={item.url} controls preload="metadata" className="block w-full min-w-0 max-w-full" />
  );
}

function VideoClipSelector({
  item,
  onChange,
}: {
  item: MediaInput;
  onChange: (patch: Partial<MediaInput>) => void;
}) {
  const sourceDurationSeconds = Number(item.sourceDurationSeconds || 0);
  const clipDurationSeconds = sourceDurationSeconds
    ? Math.min(H3_REFERENCE_VIDEO_CLIP_SECONDS, sourceDurationSeconds)
    : H3_REFERENCE_VIDEO_CLIP_SECONDS;
  const maxStartSeconds = Math.max(
    0,
    sourceDurationSeconds - clipDurationSeconds,
  );
  const clipStartSeconds = Math.min(
    maxStartSeconds,
    Math.max(0, Number(item.clipStartSeconds || 0)),
  );
  return (
    <>
      <MediaPreview
        item={item}
        clipStartSeconds={clipStartSeconds}
        onVideoDuration={(durationSeconds) => {
          const duration = Math.max(0, durationSeconds);
          const selectedDuration = Math.min(
            H3_REFERENCE_VIDEO_CLIP_SECONDS,
            duration,
          );
          onChange({
            sourceDurationSeconds: duration,
            clipDurationSeconds: selectedDuration,
            clipStartSeconds: Math.min(
              Math.max(0, duration - selectedDuration),
              clipStartSeconds,
            ),
          });
        }}
      />
      <div className="mt-3 min-w-0 max-w-full rounded-[6px] border border-violet-300/20 bg-violet-300/[0.07] p-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-black text-violet-100">
            Five-second reference segment
          </span>
          <span className="font-mono text-cyan-100">
            {formatClipTime(clipStartSeconds)}–
            {formatClipTime(clipStartSeconds + clipDurationSeconds)}
          </span>
        </div>
        <input
          className="mt-3 w-full accent-violet-300"
          type="range"
          aria-label={`Choose the five-second segment from ${item.name}`}
          min={0}
          max={maxStartSeconds}
          step={0.1}
          value={clipStartSeconds}
          disabled={!sourceDurationSeconds || maxStartSeconds === 0}
          onChange={(event) =>
            onChange({
              clipStartSeconds: Number(event.target.value),
              clipDurationSeconds,
            })
          }
        />
        <p className="mt-1 text-[11px] leading-4 text-white/45">
          {maxStartSeconds > 0
            ? "Move the handle to choose which five seconds H3 will receive. The preview jumps to the selected start."
            : "This video is five seconds or shorter, so H3 will use the whole clip."}
        </p>
      </div>
    </>
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

export default function H3Panel() {
  const [mode, setMode] = useState<Mode>("h3-text-to-video");
  const [quality, setQuality] = useState<H3Quality>("lq");
  const [h3Settings, setH3Settings] =
    useState<H3AdvancedSettings>(DEFAULT_H3_ADVANCED_SETTINGS);
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
  const [stylePresetId, setStylePresetId] = useState("none");
  const [cameraFeel, setCameraFeel] = useState<string>(
    DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.cameraFeel,
  );
  const [shotFlow, setShotFlow] = useState<string>(
    DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.shotFlow,
  );
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
  const [finalPromptSpeechState, setFinalPromptSpeechState] = useState<
    "idle" | "playing" | "paused"
  >("idle");
  const [showFinalPromptAudio, setShowFinalPromptAudio] = useState(false);
  const [speechVolume, setSpeechVolume] = useState(1);
  const [micState, setMicState] = useState<
    "idle" | "listening" | "processing" | "done" | "error"
  >("idle");
  const [job, setJob] = useState<JobStatus | null>(null);
  const [previewFrame, setPreviewFrame] = useState({
    jobId: "",
    version: 0,
    contentType: "",
  });
  const [previewProgress, setPreviewProgress] = useState<{
    jobId: string;
    value: number;
    max: number;
    node: string | null;
  }>({ jobId: "", value: 0, max: 0, node: null });
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelRecordingRef = useRef(false);
  const speechSessionRef = useRef(0);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechVolumeRef = useRef(1);
  const objectUrlsRef = useRef(new Set<string>());
  const draftReadyRef = useRef(false);
  const draftRestoreAttemptedRef = useRef(false);
  const active = Boolean(job && !["completed", "failed", "canceled"].includes(job.status));
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
  const selectedStylePreset = resolveH3CanonicalStyle(stylePresetId);
  const promptBuilderVisualStyle = selectedStylePreset?.promptBuilderVisualStyle
    || DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.visualStyle;
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
    h3Settings,
  };
  const currentFingerprint =
    `${h3StudioPromptFingerprint(promptContext)}|stylePreset:${stylePresetId}`;
  const builderPromptStale =
    promptSource === "builder"
    && (!reviewedFingerprint || reviewedFingerprint !== currentFingerprint);
  const generationPrompt =
    promptSource === "builder" ? scenePrompt : originalPrompt;
  const lockedReferences = buildH3StudioLockedReferences(promptContext);
  const exactFinalPrompt = composeH3StudioFinalPrompt(
    lockedReferences,
    generationPrompt,
  );
  const nativeDimensions = getH3NativeDimensions(quality, orientation);
  const refModReferenceOptions = references
    .filter((item) => item.kind === "image")
    .map((item, index) => ({ label: item.name || `Picture ${index + 1}` }));
  const canGenerate = Boolean(
    generationPrompt.trim()
      && !builderPromptStale
      && (mode !== "h3-image-to-video" || firstImage)
      && (mode !== "h3-reference-to-video" || references.length),
  );

  useEffect(() => {
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
  }, [mode]);
  useEffect(() => {
    if (draftRestoreAttemptedRef.current) return;
    draftRestoreAttemptedRef.current = true;
    let canceled = false;
    void readH3StudioDraft()
      .then((draft) => {
        if (canceled || !draft) return;
        const nextMode = MODE_OPTIONS.some((item) => item.id === draft.mode)
          ? draft.mode
          : "h3-text-to-video";
        const nextQuality = H3_QUALITY_OPTIONS.includes(draft.quality)
          ? draft.quality
          : "lq";
        const nextDuration = H3_PRODUCTION_DURATION_OPTIONS.includes(draft.duration)
          ? draft.duration
          : 5;
        const nextOrientation = H3_ORIENTATION_OPTIONS.includes(draft.orientation)
          ? draft.orientation
          : "landscape";
        setMode(nextMode);
        setQuality(nextQuality);
        setDuration(nextDuration);
        setOrientation(nextOrientation);
        setOriginalPrompt(String(draft.originalPrompt || ""));
        setScenePrompt(String(draft.scenePrompt || ""));
        setPromptSource(draft.promptSource === "builder" ? "builder" : "direct");
        setReviewedFingerprint(String(draft.reviewedFingerprint || ""));
        setStylePresetId(String(draft.stylePresetId || "none"));
        setCameraFeel(String(draft.cameraFeel || DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.cameraFeel));
        setShotFlow(String(draft.shotFlow || DEFAULT_PRODUCTION_V2_PROMPT_OPTIONS.shotFlow));
        setEnhancementLevel(
          draft.enhancementLevel === "short" || draft.enhancementLevel === "long"
            ? draft.enhancementLevel
            : "medium",
        );
        const restoredFirst = revivePersistedMedia(draft.firstImage);
        const restoredLast = revivePersistedMedia(draft.lastImage);
        const restoredReferences = Array.isArray(draft.references)
          ? draft.references.map((item) => revivePersistedMedia(item)).filter(Boolean) as MediaInput[]
          : [];
        setFirstImage(restoredFirst);
        setLastImage(restoredLast);
        setReferences(restoredReferences);
        setSelectedLoras(Array.isArray(draft.selectedLoras) ? draft.selectedLoras : []);
        setH3Settings(normalizeH3AdvancedSettings(
          draft.h3Settings || DEFAULT_H3_ADVANCED_SETTINGS,
          restoredReferences.filter((item) => item.kind === "image").length,
        ));
      })
      .finally(() => {
        if (!canceled) draftReadyRef.current = true;
      });
    return () => {
      canceled = true;
    };
  }, []);
  useEffect(() => {
    if (!draftReadyRef.current) return;
    const draft: H3StudioPersistedDraft = {
      mode,
      quality,
      h3Settings: normalizeH3AdvancedSettings(h3Settings, refModReferenceOptions.length),
      duration,
      orientation,
      originalPrompt,
      scenePrompt,
      promptSource,
      reviewedFingerprint,
      stylePresetId,
      cameraFeel,
      shotFlow,
      enhancementLevel,
      firstImage: serializeMedia(firstImage),
      lastImage: serializeMedia(lastImage),
      references: serializeMediaList(references),
      selectedLoras,
    };
    const timer = setTimeout(() => {
      void writeH3StudioDraft(draft);
    }, 350);
    const flush = () => {
      void writeH3StudioDraft(draft);
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [
    mode,
    quality,
    h3Settings,
    duration,
    orientation,
    originalPrompt,
    scenePrompt,
    promptSource,
    reviewedFingerprint,
    stylePresetId,
    cameraFeel,
    shotFlow,
    enhancementLevel,
    firstImage,
    lastImage,
    references,
    selectedLoras,
    refModReferenceOptions.length,
  ]);
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
    if (!active || !job?.previewEnabled) {
      setPreviewFrame({ jobId: "", version: 0, contentType: "" });
      setPreviewProgress({ jobId: "", value: 0, max: 0, node: null });
      return;
    }
    const source = new EventSource(`/api/h3/generation/events?jobId=${encodeURIComponent(job.id)}`);
    const onPreview = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { version?: number; contentType?: string };
        if (Number(payload.version) > 0) {
          setPreviewFrame({
            jobId: job.id,
            version: Number(payload.version),
            contentType: String(payload.contentType || ""),
          });
        }
      } catch {}
    };
    const onProgress = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { value?: number; max?: number; node?: string | null };
        setPreviewProgress({
          jobId: job.id,
          value: Number(payload.value || 0),
          max: Number(payload.max || 0),
          node: payload.node == null ? null : String(payload.node),
        });
      } catch {}
    };
    source.addEventListener("preview", onPreview as EventListener);
    source.addEventListener("progress", onProgress as EventListener);
    return () => source.close();
  }, [active, job?.id, job?.previewEnabled]);
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        speechSessionRef.current += 1;
        window.speechSynthesis.cancel();
      }
    },
    [],
  );

  function stopFinalPromptSpeech() {
    speechSessionRef.current += 1;
    speechUtteranceRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setFinalPromptSpeechState("idle");
  }

  function startFinalPromptSpeech() {
    if (
      typeof window === "undefined"
      || !("speechSynthesis" in window)
      || typeof SpeechSynthesisUtterance === "undefined"
    ) {
      setMessage("Read aloud is not supported by this browser.");
      return;
    }
    if (!exactFinalPrompt.trim()) {
      setMessage("Write a prompt before using read aloud.");
      return;
    }

    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    const session = speechSessionRef.current + 1;
    speechSessionRef.current = session;
    const chunks = finalPromptSpeechChunks(exactFinalPrompt);
    const voices = window.speechSynthesis.getVoices?.() || [];
    const voice =
      voices.find((item) => /^en(-|_)/i.test(item.lang) && item.localService)
      || voices.find((item) => /^en(-|_)/i.test(item.lang))
      || voices[0];

    const speakChunk = (index: number) => {
      if (speechSessionRef.current !== session) return;
      if (index >= chunks.length) {
        speechUtteranceRef.current = null;
        setFinalPromptSpeechState("idle");
        return;
      }
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.volume = speechVolumeRef.current;
      utterance.rate = 0.95;
      if (voice) utterance.voice = voice;
      utterance.onend = () => speakChunk(index + 1);
      utterance.onerror = (event) => {
        if (speechSessionRef.current !== session) return;
        speechUtteranceRef.current = null;
        setFinalPromptSpeechState("idle");
        if (!(["canceled", "interrupted"] as string[]).includes(event.error)) {
          setMessage("The browser could not read the final prompt aloud. Check phone media volume and browser speech permissions.");
        }
      };
      speechUtteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    };
    setFinalPromptSpeechState("playing");
    speakChunk(0);
  }

  function toggleFinalPromptPlayback() {
    if (finalPromptSpeechState === "playing") {
      window.speechSynthesis.pause();
      setFinalPromptSpeechState("paused");
      return;
    }
    if (finalPromptSpeechState === "paused") {
      window.speechSynthesis.resume();
      setFinalPromptSpeechState("playing");
      return;
    }
    startFinalPromptSpeech();
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
  function revivePersistedMedia(item: PersistedMediaInput | null): MediaInput | null {
    if (!item?.file) return null;
    const url = URL.createObjectURL(item.file);
    objectUrlsRef.current.add(url);
    return { ...item, url };
  }
  function serializeMedia(item: MediaInput | null): PersistedMediaInput | null {
    if (!item) return null;
    const { url: _url, ...rest } = item;
    return rest;
  }
  function serializeMediaList(items: MediaInput[]): PersistedMediaInput[] {
    return items.map((item) => serializeMedia(item)).filter(Boolean) as PersistedMediaInput[];
  }
  function replaceSingle(
    current: MediaInput | null,
    file: File,
    setter: (item: MediaInput | null) => void,
  ) {
    release(current);
    setter(media(file, "image"));
  }
  function addReference(kind: MediaKind, file: File) {
    const limit = kind === "image" ? 9 : 3;
    if (references.filter((item) => item.kind === kind).length >= limit)
      return setMessage(`H3 supports at most ${limit} ${kind} references.`);
    setReferences((current) => [...current, media(file, kind)]);
  }
  function updateReference(id: string, patch: Partial<MediaInput>) {
    setReferences((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }
  function removeReference(id: string) {
    setReferences((current) => {
      release(current.find((item) => item.id === id) || null);
      return current.filter((item) => item.id !== id);
    });
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
  async function buildPrompt() {
    if (!originalPrompt.trim())
      return setMessage("Write your scene before using Prompt Builder.");
    if (mode === "h3-image-to-video" && !firstImage)
      return setMessage(
        "Choose a First Image before building the Image prompt.",
      );
    setBuilding(true);
    setMessage("Sending the scene to the shared Production Ollama engine...");
    const sourcePrompt = originalPrompt;
    try {
      const response = await fetch("/api/h3/prompt", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...promptContext, loras: selectedLoras }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.pollUrl)
        throw new Error(data.error || "Prompt Builder could not start.");
      const value = preserveH3QuotedDialogue(
        sourcePrompt,
        await pollPrompt(data.pollUrl),
      );
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
    const next = preserveH3QuotedDialogue(originalPrompt, value).trim();
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
      if (
        !navigator.mediaDevices?.getUserMedia
        || typeof MediaRecorder === "undefined"
      ) {
        throw new Error("Microphone recording is not supported by this browser.");
      }
      chunksRef.current = [];
      cancelRecordingRef.current = false;
      setMicState("listening");
      setMessage("Listening...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const preferredType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
      ].find((type) => MediaRecorder.isTypeSupported?.(type));
      const recorder = new MediaRecorder(
        stream,
        preferredType ? { mimeType: preferredType } : undefined,
      );
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (cancelRecordingRef.current) return setMicState("idle");
        setMicState("processing");
        try {
          const recordedType =
            recorder.mimeType
            || chunksRef.current[0]?.type
            || "audio/webm";
          const extension = recordedType.includes("mp4") ? "mp4" : "webm";
          const body = new FormData();
          body.set(
            "audio",
            new File(chunksRef.current, `h3-${Date.now()}.${extension}`, {
              type: recordedType,
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
    if (!id) return;
    const response = await fetch(
      `/api/h3/generation?jobId=${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    const data = await response.json().catch(() => ({}));
    if (data.job) setJob(data.job);
  }
  async function retry() {
    if (!job) return;
    const response = await fetch("/api/h3/generation", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry", jobId: job.id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.job)
      return setMessage(data.error || "Retry failed.");
    setJob(data.job);
    setNow(Date.now());
  }
  async function upscaleSceneHunter() {
    if (!job) return;
    setMessage(`Re-rendering Scene Hunter seed ${job.seed} at HQ…`);
    const response = await fetch("/api/h3/generation", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upscale-scene-hunter", jobId: job.id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.job)
      return setMessage(data.error || "Scene Hunter upscale failed.");
    setJob(data.job);
    setNow(Date.now());
    setMessage(`Upscaling Scene Hunter seed ${data.job.seed || job.seed} at HQ...`);
  }
  async function cancelGeneration() {
    if (!job || !active || job.status === "canceling") return;
    const previous = job;
    setJob({ ...job, status: "canceling", statusMessage: "Canceling…" });
    try {
      const response = await fetch("/api/h3/generation", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", jobId: job.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.job) throw new Error(data.error || "Cancellation failed.");
      setJob(data.job);
      setMessage(data.job.status === "canceled" ? "Generation canceled." : data.job.statusMessage || "Canceling generation…");
    } catch (error) {
      setJob(previous);
      setMessage(error instanceof Error ? error.message : "Cancellation failed.");
    }
  }
  async function generate() {
    if (builderPromptStale)
      return setMessage("The optional Builder prompt changed. Use your current raw prompt or review the Builder result again.");
    if (!generationPrompt.trim())
      return setMessage("Enter a prompt before generating.");
    if (mode === "h3-image-to-video" && !firstImage)
      return setMessage("Choose a First Image.");
    if (mode === "h3-reference-to-video" && !references.length)
      return setMessage("Add at least one reference.");
    const body = new FormData();
    body.set(
      "config",
      JSON.stringify({
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
          .map((item) => item.includeAudio),
        videoClipStartSeconds: references
          .filter((item) => item.kind === "video")
          .map((item) => item.clipStartSeconds || 0),
      }),
    );
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
    setMessage("Submitting the H3 prompt...");
    try {
      const response = await fetch("/api/h3/generation", {
        method: "POST",
        credentials: "include",
        body,
      });
      const data = await response.json();
      if (!response.ok || !data.job)
        throw new Error(data.error || "H3 generation could not be submitted.");
      setJob(data.job);
      setNow(Date.now());
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "H3 generation could not be submitted.",
      );
    }
  }
  async function retryGallerySave() {
    if (!job) return;
    const response = await fetch("/api/h3/generation/gallery", {
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
  async function handleUseAsReference() {
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
    setPromptSource("direct");
    setMessage(
      "Result added as a video reference. Your raw prompt can generate directly; Prompt Builder remains optional.",
    );
  }

  return (
    <div
      className="mx-auto w-full min-w-0 max-w-7xl space-y-4 overflow-x-clip pb-28 pt-8 md:pt-0"
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
          className="mt-5 grid grid-cols-3 gap-2"
          role="tablist"
          aria-label="H3 generation mode"
        >
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.id}
              role="tab"
              aria-selected={mode === option.id}
              onClick={() => setMode(option.id)}
              className={`min-h-20 rounded-[6px] border p-2 text-left transition ${choiceClass(mode === option.id)}`}
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
      <div className="grid min-w-0 max-w-full gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,.75fr)]">
        <main className="min-w-0 max-w-full space-y-4">
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
                      : "Prompt required"}
              </span>
            </div>
            <div className="relative mt-3">
              <textarea
                id="h3-prompt"
                rows={6}
                className={`${field} resize-y pr-14 text-base leading-6`}
                value={originalPrompt}
                onChange={(event) => replaceOriginal(event.target.value)}
                placeholder="Describe the scene, action, camera, dialogue, and sound."
              />
              <button
                type="button"
                aria-label={
                  micState === "listening"
                    ? "Stop voice prompt recording"
                    : micState === "processing"
                      ? "Transcribing voice prompt"
                      : "Record voice prompt"
                }
                title={micState === "listening" ? "Stop and transcribe" : "Speak your prompt"}
                disabled={micState === "processing"}
                className={`absolute right-2 top-2 inline-flex h-10 w-10 items-center justify-center rounded-full border transition ${
                  micState === "listening"
                    ? "animate-pulse border-red-300/70 bg-red-400/25 text-red-100"
                    : "border-white/15 bg-[#11172a] text-white/80 hover:bg-white/[0.12]"
                } disabled:cursor-wait disabled:opacity-50`}
                onClick={() => void mic()}
              >
                <IconMic />
              </button>
            </div>
            <p className="mt-2 text-xs text-white/50">
              Dialogue inside quotation marks is preserved word-for-word by Prompt Builder.
            </p>
            {micState !== "idle" ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/60">
                <span>
                  {micState === "listening"
                    ? "Listening — tap the mic again to finish."
                    : micState === "processing"
                      ? "Transcribing your prompt..."
                      : micState === "done"
                        ? "Voice prompt added."
                        : "Voice prompt failed. Tap the mic to retry."}
                </span>
                {micState === "listening" ? (
                  <button className={command} onClick={cancelMic}>Cancel</button>
                ) : null}
              </div>
            ) : null}
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
            </div>
          </section>
          <details className={surface}>
            <summary className="cursor-pointer text-sm font-black">
              Choose the Look
            </summary>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="min-w-0 md:col-span-3">
                <H3StyleSelector value={stylePresetId} onChange={setStylePresetId} />
              </div>
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
                    className="min-w-0 max-w-full rounded-[6px] border border-white/10 bg-black/30 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase text-cyan-200">
                          {item.kind} reference {index + 1}
                        </p>
                        <p className="whitespace-normal break-all text-xs text-white/45">
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
                      {item.kind === "video" ? (
                        <VideoClipSelector
                          item={item}
                          onChange={(patch) => updateReference(item.id, patch)}
                        />
                      ) : (
                        <MediaPreview item={item} />
                      )}
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
              <div className="mt-3">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="h3-exact-final-prompt"
                    className="text-xs font-black uppercase text-white/45"
                  >
                    Exact Final Prompt
                  </label>
                  <button
                    type="button"
                    aria-label="Show final prompt audio controls"
                    aria-expanded={showFinalPromptAudio}
                    title="Final prompt audio controls"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-white/80 transition hover:bg-white/[0.12]"
                    onClick={() => setShowFinalPromptAudio((value) => !value)}
                  >
                    <IconSpeaker />
                  </button>
                </div>
                {showFinalPromptAudio ? (
                  <div className="mt-2 flex flex-wrap items-center gap-3 rounded-[6px] border border-white/10 bg-white/[0.04] p-2">
                    <button
                      type="button"
                      aria-label={finalPromptSpeechState === "playing" ? "Pause final prompt" : "Play final prompt"}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-violet-300/40 bg-violet-300/15 text-violet-100"
                      onClick={toggleFinalPromptPlayback}
                    >
                      {finalPromptSpeechState === "playing" ? <IconPause /> : <IconPlay />}
                    </button>
                    <button
                      type="button"
                      aria-label="Stop final prompt"
                      disabled={finalPromptSpeechState === "idle"}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-white/75 disabled:opacity-35"
                      onClick={stopFinalPromptSpeech}
                    >
                      <IconStop />
                    </button>
                    <label className="flex min-w-[150px] flex-1 items-center gap-2 text-xs font-bold text-white/60">
                      Volume
                      <input
                        type="range"
                        aria-label="Final prompt volume"
                        min={0}
                        max={1}
                        step={0.05}
                        value={speechVolume}
                        className="w-full accent-violet-300"
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          speechVolumeRef.current = value;
                          if (speechUtteranceRef.current) {
                            speechUtteranceRef.current.volume = value;
                          }
                          setSpeechVolume(value);
                        }}
                      />
                      <span className="w-9 text-right font-mono">{Math.round(speechVolume * 100)}%</span>
                    </label>
                  </div>
                ) : null}
                <textarea
                  id="h3-exact-final-prompt"
                  aria-label="Exact Final Prompt"
                  readOnly
                  rows={10}
                  className={`${field} mt-1 resize-y font-mono text-xs leading-5`}
                  value={exactFinalPrompt}
                />
              </div>
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
        </main>
        <aside className="min-w-0 max-w-full space-y-4 xl:sticky xl:top-4 xl:self-start">
          <section className={surface}>
            <p className="text-xs font-black uppercase text-violet-200/75">
              03 / Output
            </p>
            <p className="mb-2 mt-3 text-xs font-bold text-white/50">Quality</p>
            <div
              className="grid grid-cols-3 gap-2"
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
                  <span className="mt-1 block text-[10px] leading-4 text-white/45">
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
            <div className="mt-5">
              <H3AdvancedControls
                value={h3Settings}
                onChange={setH3Settings}
                referenceOptions={refModReferenceOptions}
              />
            </div>
          </section>
          <details className={surface}>
            <summary className="cursor-pointer text-sm font-black">
              LoRAs and Creative Controls
            </summary>
            <div className="mt-4 rounded-[6px] border border-cyan-300/25 bg-cyan-300/10 p-3">
              <p className="text-sm font-black">MiniMax H3 Turbo 8-step</p>
              <p className="text-xs text-white/60">
                Required | strength 1.0 | locked
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
        </aside>
      </div>
      {job ? (
        <section className={surface}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase text-violet-200/75">
                Live H3 Job
              </p>
              <h2 className="mt-1 text-lg font-black">{job.statusMessage}</h2>
              {job.quality === "sh" ? (
                <p className="mt-1 text-sm font-bold text-cyan-100">
                  Scene Hunter seed: {job.seed}
                </p>
              ) : job.sceneHunterSourceJobId ? (
                <p className="mt-1 text-sm font-bold text-cyan-100">
                  Upscaling Scene Hunter seed {job.seed}
                </p>
              ) : null}
              <p className="mt-1 text-sm text-white/55">
                Elapsed {formatDuration(elapsedSeconds(job, now))} |{" "}
                {job.backendLabel || "GPU assignment pending"}
              </p>
            </div>
            <div className="min-w-0 max-w-full break-all text-right text-xs text-white/45 [overflow-wrap:anywhere]">
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
          {active ? (
            <figure className="mt-4 min-w-0 max-w-full overflow-hidden rounded-[6px] border border-violet-300/20 bg-black/40 p-2">
              <figcaption className="mb-2 text-xs font-black uppercase tracking-wide text-violet-200/80">
                Approximate Preview
              </figcaption>
              {previewFrame.jobId === job.id && previewFrame.version > 0 ? (
                previewFrame.contentType.startsWith("video/") ? (
                  <video
                    key={`${job.id}-${previewFrame.version}`}
                    src={`/api/h3/generation/preview?jobId=${encodeURIComponent(job.id)}&v=${previewFrame.version}`}
                    aria-label="Approximate in-progress H3 video preview"
                    className="block aspect-video h-auto w-full min-w-0 max-w-full bg-black object-contain"
                    autoPlay
                    muted
                    playsInline
                    loop
                    controls
                  />
                ) : (
                  <img
                    src={`/api/h3/generation/preview?jobId=${encodeURIComponent(job.id)}&v=${previewFrame.version}`}
                    alt="Approximate in-progress H3 animated preview"
                    className="block aspect-video h-auto w-full min-w-0 max-w-full bg-black object-contain"
                  />
                )
              ) : (
                <div
                  aria-label="Waiting for first H3 live preview frame"
                  className="flex aspect-video w-full min-w-0 max-w-full items-center justify-center rounded-[4px] border border-dashed border-violet-200/20 bg-black/55 px-4 text-center text-sm font-bold text-violet-100/65"
                >
                  Waiting for the first live preview frame from ComfyUI...
                </div>
              )}
              <p className="mt-2 text-[11px] leading-4 text-white/45">
                {previewProgress.jobId === job.id && previewProgress.max > 0
                  ? `Preview step ${previewProgress.value} / ${previewProgress.max}${previewProgress.node ? ` · ${previewProgress.node}` : ""}`
                  : "Waiting for sampler step updates from ComfyUI."}
                {" "}
                Early previews can be noisy or structurally different from the final video.
              </p>
            </figure>
          ) : null}
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
              <button
                className={`${command} border-red-300/35 bg-red-300/10 text-red-100`}
                disabled={job.status === "canceling"}
                onClick={() => void cancelGeneration()}
              >
                {job.status === "canceling" ? "Canceling…" : "Cancel Generation"}
              </button>
            ) : null}
            <button
              className={command}
              disabled={active}
              onClick={() => void retry()}
            >
              Retry
            </button>
          </div>
          {job.videoUrl ? (
            <div className="mt-4 min-w-0 max-w-full overflow-hidden">
              {job.quality === "sh" ? (
                <div className="mb-3 rounded-[6px] border border-cyan-300/25 bg-cyan-300/10 p-3">
                  <p className="text-sm font-black text-cyan-50">Scene Hunter Preview</p>
                  <p className="mt-1 text-xs text-cyan-100/70">Seed {job.seed} · 0.2 MP</p>
                </div>
              ) : job.sceneHunterSourceJobId && job.status === "completed" ? (
                <div className="mb-3 rounded-[6px] border border-emerald-300/25 bg-emerald-300/10 p-3 text-sm font-black text-emerald-50">
                  HQ Scene Ready
                </div>
              ) : null}
              <video
                src={job.videoUrl}
                poster={job.thumbnailUrl || undefined}
                controls
                playsInline
                preload="metadata"
                className="block h-auto max-h-[70vh] w-full min-w-0 max-w-full rounded-[6px] bg-black object-contain"
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
                ) : job.quality === "sh" ? (
                  <button
                    className={`${command} ${primary}`}
                    disabled={Boolean(job.sceneHunterPromotedJobId)}
                    onClick={() => void upscaleSceneHunter()}
                  >
                    {job.sceneHunterPromotedJobId ? "Upscale Started" : "Upscale"}
                  </button>
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
                  onClick={() => void handleUseAsReference()}
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
                    <dd className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{job.prompt}</dd>
                  </div>
                </dl>
              </details>
            </div>
          ) : null}
        </section>
      ) : null}
      {snapshotTarget ? (
        <VideoSnapshotPicker
          open={Boolean(snapshotTarget)}
          onClose={() => setSnapshotTarget("")}
          onSnapshot={({ file }) => {
            if (snapshotTarget === "first") {
              replaceSingle(firstImage, file, setFirstImage);
            } else if (snapshotTarget === "last") {
              replaceSingle(lastImage, file, setLastImage);
            } else if (snapshotTarget === "reference-image") {
              addReference("image", file);
            }
            setSnapshotTarget("");
          }}
        />
      ) : null}
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
