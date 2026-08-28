"use client";





function otgProductionVisibleVideoRef() {
  if (typeof document === "undefined") return "";

  const bodyText = String(document.body?.innerText || "");
  const usingMatch = bodyText.match(/Using:\s*([^\r\n]+?\.(?:mp4|webm|mov|m4v))/i);
  if (usingMatch?.[1]) return usingMatch[1].trim();

  const originalMatch = bodyText.match(/Original:\s*([^\r\n]+?\.(?:mp4|webm|mov|m4v))/i);
  if (originalMatch?.[1]) return originalMatch[1].trim();

  const videos = Array.from(document.querySelectorAll("video"));
  const visibleVideos = videos.filter((video) => {
    const rect = video.getBoundingClientRect();
    return rect.width > 20 && rect.height > 20;
  });

  for (const video of [...visibleVideos, ...videos]) {
    const source = video.querySelector("source");
    const src = String(video.currentSrc || video.src || source?.src || "").trim();
    if (src && (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(src) || src.includes("/api/file") || src.includes("/api/gallery/file") || src.includes("/api/edit-video/file"))) {
      return src;
    }
  }

  const mediaMatch = bodyText.match(/([^\s\r\n]+\.(?:mp4|webm|mov|m4v))/i);
  return mediaMatch?.[1]?.trim() || "";
}

function otgProductionClipVideoRef(value: any, index?: number) {
  const clip = value?.clip && typeof value.clip === "object" ? value.clip : {};
  const candidates = [
    value?.videoPath,
    value?.serverPath,
    value?.generatedVideoPath,
    value?.localPath,
    value?.filePath,
    value?.outputPath,
    value?.path,
    value?.url,
    value?.src,
    value?.videoUrl,
    value?.serverUrl,
    value?.generatedVideoUrl,
    value?.fileName,
    value?.filename,
    value?.name,
    value?.sourceName,

    clip?.videoPath,
    clip?.serverPath,
    clip?.generatedVideoPath,
    clip?.localPath,
    clip?.filePath,
    clip?.outputPath,
    clip?.path,
    clip?.url,
    clip?.src,
    clip?.videoUrl,
    clip?.serverUrl,
    clip?.generatedVideoUrl,
    clip?.fileName,
    clip?.filename,
    clip?.name,
    clip?.sourceName,
  ];

  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (text) return text;
  }

  if (typeof document !== "undefined" && typeof index === "number" && Number.isFinite(index)) {
    const videos = Array.from(document.querySelectorAll("video")) as HTMLVideoElement[];
    const video = videos[index];
    const src = String(video?.currentSrc || video?.src || "").trim();
    if (src) return src;
  }

  return "";
}

import { useEffect, useMemo, useRef, useState } from "react";
import QwenSceneBuilderPanel from "./QwenSceneBuilderPanel";

import type { ProductionAnimateMode } from "./ProductionAnimateModeSwitch";
import type { ProductionDirectorImportedFrame } from "./ProductionDirectorModeUI";
import {
  getAudioStudioJob,
  isTerminalJobStatus,
  queueAudioStudioJob,
} from "../../../lib/client/voicePipelineClient";
import type { PersistedAudioStudioResult, ProductionAudioStudioResultItem } from "../../../lib/jobs/productionAudioStudioResults";
import type { ProductionAudioStudioAction, QueuedContractJob } from "../../../lib/jobs/voicePipelineJobs";




// OTG_STORYBOARD_REFERENCE_POOL_BACKGROUND_V30_BOOTSTRAP
// OTG_PRODUCTION_ANIMATE_EXACT_PROMPT_V28
// Production Animate positive prompts must be exactly the LTX Animation Prompt box text.
// Storyboard scene context/global prompt text is valid for scene image creation, not for Animate video prompts.
function otgAnimateManualPromptRawV36BPU24B(value: unknown): string {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function otgExactProductionPromptTextV28(value: unknown): string {
  return otgAnimateManualPromptRawV36BPU24B(value);
}

function otgStripStoryboardSceneContextV28(value: unknown): string {
  let text = otgExactProductionPromptTextV28(value);
  text = text.replace(/^\s*Manual prompt:[\s\S]*?(?:\n\s*\n|$)/i, "");
  text = text.replace(/^\s*Maintain visual continuity with the storyboard frame\.\s*/i, "");
  text = text.replace(/^\s*No recurring character is intentionally present in this clip\.\s*/i, "");
  return otgExactProductionPromptTextV28(text);
}

function otgShouldSanitizeProductionAnimatePromptV28(url: unknown, method: string): boolean {
  if (method !== "POST") return false;
  const target = String(url || "").toLowerCase();
  return (
    target.includes("/api/production/animate") ||
    target.includes("/api/comfy") ||
    target.includes("/api/workflows/run")
  );
}

function otgFindExactProductionPromptV28(payload: any): string {
  const candidates: unknown[] = [];
  const visit = (value: any, depth: number) => {
    if (depth > 7 || value == null) return;
    if (typeof value === "string") return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const lowered = key.toLowerCase();
      if (
        typeof child === "string" &&
        (lowered === "animationprompt" ||
          lowered === "motionprompt" ||
          lowered === "frameprompt" ||
          lowered === "prompttext" ||
          lowered === "ltxanimationprompt")
      ) {
        candidates.push(child);
      }
      visit(child, depth + 1);
    }
  };
  visit(payload, 0);
  for (const candidate of candidates) {
    const cleaned = otgStripStoryboardSceneContextV28(candidate);
    if (cleaned) return cleaned;
  }
  const rawPrompt = typeof payload?.prompt === "string" ? payload.prompt : "";
  return otgStripStoryboardSceneContextV28(rawPrompt);
}

function otgSanitizeProductionAnimatePayloadV28(payload: any): any {
  const exactPrompt = otgFindExactProductionPromptV28(payload);
  const clone = structuredClone(payload);

  const visit = (value: any, depth: number, parentKey = "") => {
    if (depth > 10 || value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1, parentKey));
      return;
    }
    if (typeof value !== "object") return;

    const nodeTitle = String(value.title || value._meta?.title || value.name || "").toLowerCase();
    const looksLikePositivePromptNode = nodeTitle.includes("positive prompt") || nodeTitle === "positive";

    for (const [key, child] of Object.entries(value)) {
      const lowered = key.toLowerCase();

      if (typeof child === "string") {
        const stripped = otgStripStoryboardSceneContextV28(child);
        const isPromptField =
          lowered === "prompt" ||
          lowered === "positive" ||
          lowered === "text" ||
          lowered === "string" ||
          lowered === "animationprompt" ||
          lowered === "motionprompt" ||
          lowered === "frameprompt";

        if (isPromptField && (looksLikePositivePromptNode || lowered !== "text")) {
          (value as Record<string, unknown>)[key] = stripped || exactPrompt;
          continue;
        }

        if (lowered.includes("globalprompt") || lowered === "scenecontext" || lowered === "contextprompt") {
          (value as Record<string, unknown>)[key] = "";
          continue;
        }
      }

      visit(child, depth + 1, lowered);
    }
  };

  visit(clone, 0);

  if (exactPrompt) {
    if (typeof clone.prompt === "string") clone.prompt = exactPrompt;
    if (typeof clone.positive === "string") clone.positive = exactPrompt;
    clone.animationPrompt = exactPrompt;
    clone.motionPrompt = exactPrompt;
  }

  clone.globalPrompt = "";
  clone.globalPromptPreview = "";
  clone.sceneContext = "";
  clone.contextPrompt = "";

  return clone;
}

// OTG_PRODUCTION_REPO_CACHED_COMFY_ASSET_V36BPU29
// Production must not depend on ComfyUI output-folder lifetime.
// Direct Comfy view URLs are rewritten through a repo-backed cache route.
function repoCachedComfyImageUrlV36BPU29(value: unknown): string {
  const text = String(value || "").trim();

  if (!text) return "";
  if (text.includes("/api/production/comfy-cache")) return text;

  const lower = text.toLowerCase();

  if (
    lower.includes("/api/comfy/view") ||
    lower.includes("view?filename=") ||
    /^\/?view\?/i.test(text)
  ) {
    return `/api/production/comfy-cache?src=${encodeURIComponent(text)}`;
  }

  return text;
}

// OTG_VOICE_ACTOR_TRANSCRIBE_UI_V25
// DOM-based bridge so the transcribe button can work without knowing the internal recorder state variable name.
async function transcribeVoiceActorAudioBlobV25(blob: Blob): Promise<string> {
  const formData = new FormData();
  formData.set("audio", blob, "voice-actor-input.webm");

  const endpoints = [
    "/api/audio/transcribe",
    "/api/voice/transcribe",
    "/api/transcribe",
    "/api/whisper/transcribe",
  ];

  let lastError = "";
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        lastError = endpoint + " returned " + response.status;
        continue;
      }

      const json = await response.json().catch(() => null);
      const rawText =
        json?.text ||
        json?.transcript ||
        json?.transcription ||
        json?.result ||
        json?.data?.text ||
        "";
      const cleaned = String(rawText || "").trim();
      if (cleaned) return cleaned;
      lastError = endpoint + " returned no transcript text";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError || "No transcription endpoint returned text.");
}

function setReactTextareaValueV25(textarea: HTMLTextAreaElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
  descriptor?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function findNearestFramePromptTextareaV25(button: HTMLButtonElement): HTMLTextAreaElement | null {
  let current: HTMLElement | null = button;
  for (let depth = 0; current && depth < 12; depth += 1) {
    const textareas = Array.from(current.querySelectorAll("textarea")) as HTMLTextAreaElement[];
    const usable = textareas.filter((textarea) => !textarea.disabled && textarea.offsetParent !== null);
    if (usable.length) return usable[0];
    current = current.parentElement;
  }
  return null;
}

async function handleVoiceActorTranscribeFromButton(button: HTMLButtonElement) {
  const originalText = button.textContent || "Transcribe";
  try {
    button.disabled = true;
    button.textContent = "Transcribing...";

    let current: HTMLElement | null = button;
    let audio: HTMLAudioElement | null = null;
    for (let depth = 0; current && depth < 8 && !audio; depth += 1) {
      audio = current.querySelector("audio");
      current = current.parentElement;
    }

    if (!audio?.src) {
      window.alert("Record and save Voice Actor Input before transcribing.");
      return;
    }

    const audioResponse = await fetch(audio.src);
    if (!audioResponse.ok) {
      throw new Error("Could not read the saved voice actor recording.");
    }

    const blob = await audioResponse.blob();
    const transcript = await transcribeVoiceActorAudioBlobV25(blob);
    const textarea = findNearestFramePromptTextareaV25(button);

    if (!textarea) {
      window.alert("Transcript: " + transcript + "\n\nCould not find the frame prompt box automatically. Copy this text into the prompt.");
      return;
    }

    const existing = textarea.value.trim();
    const nextValue = existing && !existing.includes(transcript) ? existing + " " + transcript : transcript;
    setReactTextareaValueV25(textarea, nextValue.trim());
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "Voice actor transcription failed.");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}
// OTG_PRODUCTION_PROMPT_EXACT_V24B
// Production image-to-video / first-frame-last-frame jobs must send only the user's frame prompt.
// Do not append style wrappers, character descriptions, notes, transcript hints, or UI helper text here.
function exactProductionFramePrompt(value: unknown): string {
  return otgAnimateManualPromptRawV36BPU24B(value);
}

async function transcribeProductionVoiceActorAudio(blob: Blob): Promise<string> {
  const formData = new FormData();
  formData.set("audio", blob, "voice-actor-input.webm");

  const endpoints = [
    "/api/audio/transcribe",
    "/api/voice/transcribe",
    "/api/transcribe",
    "/api/whisper/transcribe",
  ];

  let lastError = "";
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        lastError = `${endpoint} returned ${response.status}`;
        continue;
      }
      const json = await response.json().catch(() => null);
      const text =
        json?.text ||
        json?.transcript ||
        json?.transcription ||
        json?.result ||
        json?.data?.text ||
        "";
      const cleaned = String(text || "").trim();
      if (cleaned) return cleaned;
      lastError = `${endpoint} returned no transcript text`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError || "No transcription endpoint returned text.");
}
type ProductionStage = "storyboard" | "animate" | "edit" | "audio" | "assemble";
type ProductionHomeMode = "home" | "pipeline" | "load" | "delete" | "completed";

type ComfyProgressUiState = {
  running: boolean;
  readyToSync: boolean;
  percent: number | null;
  label: string;
  detail: string;
  elapsedMs: number | null;
  estimatedRemainingMs: number | null;
  doneNodes: number;
  totalNodes: number;
  currentNodeId: string;
  currentNodeProgress: string;
  completedPrompts?: number;
  totalPrompts?: number;
};

function formatProductionProgressDuration(ms: number | null | undefined) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return `${hours}h ${remMinutes}m`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function emptyComfyProgressState(): ComfyProgressUiState {
  return {
    running: false,
    readyToSync: false,
    percent: null,
    label: "",
    detail: "",
    elapsedMs: null,
    estimatedRemainingMs: null,
    doneNodes: 0,
    totalNodes: 0,
    currentNodeId: "",
    currentNodeProgress: "",
  };
}
// OTG_PRODUCTION_EDIT_WORKBENCH_V1_TYPES_START
type ProductionEditStatus = "draft" | "manifest_saved" | "render_ready" | "error";

type ProductionEditVoiceSegment = {
  id: string;
  character: string;
  voice: string;
  characterId?: string;
  targetVoiceId: string;
  targetVoiceName: string;
  targetVoiceEngine: "seed-vc" | "xtts" | "reference" | "character" | "uploaded" | "";
  targetVoicePath: string;
  transcriptStatus?: "idle" | "pending" | "ready" | "error";
  transcriptError?: string;
  uploadedVoiceFileName?: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  mode: "voice_conversion" | "replace_original" | "mix_over_original" | "mute_original_range" | "keep_original";
  volume: number;
};

type ProductionEditSfxSegment = {
  id: string;
  mode: "timed" | "full_clip";
  label: string;
  prompt: string;
  audioUrl: string;
  audioFileName: string;
  startSeconds: number;
  durationSeconds: number;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
};

type ProductionEditVisualFxRange = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  prompt: string;
  strength: number;
};

type ProductionVoiceModelOption = {
  id: string;
  name: string;
  engine: "seed-vc" | "xtts" | "reference" | "character" | "uploaded";
  path: string;
  displayPath?: string;
  samplePath?: string;
  characterId?: string;
  usable: boolean;
  notes?: string;
};

type ProductionClipEditManifest = {
  visualFixPrompt?: string;
  visualEditPromptV36BL2?: string;
  sceneId: string;
  clipIndex: number;
  sourceUrl: string;
  sourceFileName: string;
  trimStartSeconds: number;
  trimEndSeconds: number;
  playbackRate: number;
  expandMode: "none" | "freeze_start" | "freeze_end" | "slow_down";
  voiceSegments: ProductionEditVoiceSegment[];
  music: {
    enabled: boolean;
    source: "none" | "generate" | "library" | "upload";
    prompt: string;
    audioUrl: string;
    audioFileName: string;
    startSeconds: number;
    endSeconds: number;
    volume: number;
    fadeInSec: number;
    fadeOutSec: number;
    duckUnderDialogue: boolean;
  };
  sfxSegments: ProductionEditSfxSegment[];
  visualFxRanges: ProductionEditVisualFxRange[];
  audioCleanup: {
    muteOriginal: boolean;
    reduceOriginalVolume: boolean;
    removeOriginalMusic: boolean;
    enhanceSpeech: boolean;
    normalizeVolume: boolean;
    originalVolume: number;
  };
  audioPolicy: {
    mode: "keep_original" | "mute_original" | "reduce_original" | "replace_original";
    originalVolume: number;
    replacementAudioUrl: string;
    replacementAudioFileName: string;
    replacementVolume: number;
  };
  status: ProductionEditStatus;
  editedUrl?: string;
  editedFileName?: string;
  renderedDurationSeconds?: number;
  error?: string;
  updatedAt: string;
};

type QueuedJobUiState = {
  phase: "idle" | "submitting" | "queued" | "polling" | "error";
  job?: QueuedContractJob;
  error?: string;
};

type ProductionAudioStudioResult = PersistedAudioStudioResult;

type ProductionEditClipRow = {
  key: string;
  index: number;
  title: string;
  clip: ProductionFrameClip;
  frame: any;
  draft: ProductionFrameAnimation | undefined;
  sourceUrl: string;
  sourceFileName: string;
  durationSec: number;
};
// OTG_PRODUCTION_EDIT_WORKBENCH_V1_TYPES_END
type SceneStatus = "not_started" | "pending_images" | "images_ready" | "clip_ready" | "edited" | "complete";

type StoryboardImage = {
  id: string;
  approved: boolean;
  status?: "queued" | "ready" | "error";
  promptId?: string;
  fileName?: string;
  url?: string;
  error?: string;
  source?: "generated" | "uploaded";
  uploadedPath?: string;
  editingUploadedSource?: boolean;
};
type StoryboardGenerationTarget = {
  index: number;
  prompt: string;
  mode: "generate" | "edit_uploaded";
  uploadedPath?: string;
};

type CharacterReference = {
  id: string;
  label: string;
  fileName?: string;
  previewUrl?: string;
  workflowImagePath?: string;
  workflowImageUrl?: string;
  sourceCharacterId?: string;
  sourceCharacterName?: string;
  referenceAudioPath?: string;
};
type CharacterLibraryPickerItem = {
  id: string;
  name: string;
  imagePath: string;
  imageUrl: string;
  workflowImagePath: string;
  workflowImageUrl: string;
  referenceAudioPath?: string;
};

type ProductionSceneClipStatus = "idle" | "queued" | "ready" | "error";

type ProductionSceneClip = {
  status: ProductionSceneClipStatus;
  promptId?: string;
  fileName?: string;
  url?: string;
  error?: string;
};
type ProductionAssembleTransitionType = "cut" | "crossfade" | "fade_black" | "fade_white" | "slide_left" | "slide_right";
type ProductionAssembleTransition = {
  id: string;
  fromClipIndex: number;
  toClipIndex: number;
  type: ProductionAssembleTransitionType;
  durationSeconds: number;
};
type ProductionAssembleStitchResult = {
  videoUrl: string;
  videoPath: string;
  sceneCount: number;
  transitionsApplied: number;
  preset?: ProductionExportPreset;
  createdAt?: string;
};
type ProductionExportPreset = "draft" | "standard" | "high_quality" | "mobile" | "youtube" | "play_store_preview";
type ProductionMediaPreflightClip = {
  clipIndex: number;
  ok: boolean;
  fileName: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
  audioSampleRate: number | null;
  audioChannels: number | null;
  warnings: string[];
  error?: string;
};
type ProductionMediaPreflightResult = {
  ok: boolean;
  checkedAt: string;
  clips: ProductionMediaPreflightClip[];
  summary: {
    clipCount: number;
    readyCount: number;
    warningCount: number;
    hasBlockingIssue: boolean;
  };
};
type ProductionSnapshot = {
  id: string;
  label: string;
  createdAt: string;
  manifest: ProductionManifest;
};
type ProductionFrameClipStatus = "idle" | "queued" | "ready" | "error";

type ProductionLoraSelection = {
  name: string;
  strength: number;
};

type ProductionLoraOption = {
  name: string;
};

type ProductionVoiceActorInput = {
  enabled?: boolean;
  saved?: boolean;
  audioName?: string;
  audioUrl?: string;
  durationSeconds?: number;
  mimeType?: string;
  recordedAt?: string;
};

type ProductionFrameAnimation = {
  prompt: string;
  durationSeconds: number;
  characterRefIds?: string[];
  loras?: ProductionLoraSelection[];
  voiceActorInput?: ProductionVoiceActorInput;
  queueForGeneration?: boolean;
  animationMode?: "auto" | "image_to_video" | "first_last_frame" | "reference_to_video_gguf";
  firstFrameIndex?: number;
  lastFrameIndex?: number;
  promptSourceFrameIndex?: number;
  timelineRole?: "normal" | "last_frame_for";
  consumedByFrameIndex?: number;
  consumedLastFrameIndex?: number;
  keepAsSeparateSceneAfterPairing?: boolean;
};

type ProductionFrameClip = {
  status: ProductionFrameClipStatus;
  promptId?: string;
  fileName?: string;

  // OTG_PRODUCTION_FRAMECLIP_MEDIA_SOURCE_TYPEFIX_V1
  uploadedPath?: string;
  uploadedFileName?: string;
  uploadedUrl?: string;
  filePath?: string;
  videoPath?: string;
  serverPath?: string;
  generatedVideoPath?: string;
  localPath?: string;
  outputPath?: string;
  sourcePath?: string;
  sourceUrl?: string;
  galleryUrl?: string;
  galleryFileName?: string;
  source?: string;
  addedAt?: string;

  url?: string;
  error?: string;

  // OTG_PRODUCTION_FRAMECLIP_REMOVED_TYPEFIX_V1
  removed?: boolean;
  removedAt?: string;
  removedSource?: "production-edit" | "gallery" | string;

  outputPrefix?: string;
  sourceFrameIndex?: number;
  requestedDurationSeconds?: number;

  // OTG_PRODUCTION_FRAMECLIP_ANIMATION_METADATA_TYPEFIX_V1
  animationMode?: "auto" | "image_to_video" | "first_last_frame" | string;
  firstFrameIndex?: number;
  lastFrameIndex?: number;
  promptSourceFrameIndex?: number;
  firstFrameSceneId?: string;
  lastFrameSceneId?: string;
  promptSourceSceneId?: string;
  timelineRole?: "normal" | "last_frame_for" | string;
  consumedBySceneId?: string;
  consumedByFrameIndex?: number;
  consumedLastFrameIndex?: number;
  keepAsSeparateSceneAfterPairing?: boolean;


  // OTG_PRODUCTION_EDIT_REPLACE_SELECTED_RENDER_V1
  editedAt?: string;
  editSource?: "production-edit-render" | string;
  originalFileName?: string;
  originalUrl?: string;
  editManifest?: ProductionClipEditManifest;
  audioStudioResult?: ProductionAudioStudioResult;
};
type ProductionScene = {
  id: string;
  title: string;
  durationSeconds: number;
  imageCount: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
  prompt: string;
  motionNotes: string;
  style: string;
  status: SceneStatus;
  images: StoryboardImage[];
  characterRefs?: CharacterReference[];
  characterRefSlotCount?: number;
  clip?: ProductionSceneClip;
  animationFrames?: ProductionFrameAnimation[];
  frameClips?: ProductionFrameClip[];
  assembleTransitions?: ProductionAssembleTransition[];
  assembledVideoUrl?: string;
  assembledVideoPath?: string;
  assembledOutputs?: ProductionAssembleStitchResult[];
  exportPreset?: ProductionExportPreset;
};

type ProductionManifest = {
  schemaVersion: 1;
  projectTitle: string;
  activeStage: ProductionStage;
  selectedSceneId?: string;
  productionAnimateMode?: ProductionAnimateMode;
  exportPreset?: ProductionExportPreset;
  snapshots?: ProductionSnapshot[];
  updatedAt: string;
  scenes: ProductionScene[];
};

const DRAFT_STORAGE_KEY = "otg:production:storyboard-draft:v1";
const PRODUCTION_MANUAL_SAVE_KEY = "otg:production:manual-save:v1";
const PRODUCTION_AUTOSAVE_KEY = "otg:production:auto-save:v1";
const THEME_STORAGE_KEY = "otg:production:theme";
const QWEN_SCENE_BUILDER_STORAGE_KEY_V36BPU3 = "otg-qwen-scene-builder-v36bo5b";
const QWEN_ANIMATE_HANDOFF_SOURCE_V36BPU3 = "qwen-scene-builder-paired-animate-v36bpu3";

type QwenCompletedSceneForAnimateV36BPU3 = {
  id: string;
  name: string;
  sourceIndex: number;
  url: string;
  workflowImage: string;
};

const STORYBOARD_IMAGE_WORKFLOW_ID = "internal/production/qwen_image_edit_2511_storyboard";
const CHARACTER_REFERENCE_SLOTS = 3;

// PRODUCTION_STORYBOARD_SETUP_PATCH
const MAX_PRODUCTION_SCENES = 8;
const DEFAULT_SCENE_DURATION_SECONDS = 15;
const MAX_SCENE_DURATION_SECONDS = 30;
// OTG_PRODUCTION_ANIMATE_FIRST_LAST_FRAME_V1
const MIN_ANIMATE_FRAME_DURATION_SECONDS = 3;
const MAX_ANIMATE_FRAME_DURATION_SECONDS = 15;
const MAX_PRODUCTION_ANIMATE_LORAS = 3;
const MIN_PRODUCTION_LORA_STRENGTH = 0.2;
const MAX_PRODUCTION_LORA_STRENGTH = 1;
const PRODUCTION_LIPSYNC_WORKFLOW_ID = "production/lipsync-ltx23-1-1";
const PRODUCTION_LIPSYNC_WORKFLOW_LABEL = "Production Voice Actor Input Lip Sync";
const PRODUCTION_LIPSYNC_WORKFLOW_FILE = "production-lipsync.json";
const DEFAULT_SCENE_IMAGE_COUNT = 1;
const MAX_SCENE_IMAGE_COUNT = 16;

const stages: Array<{ id: ProductionStage; label: string; description: string }> = [
  { id: "storyboard", label: "Storyboard", description: "Build one scene image from prompt passes" },
  { id: "animate", label: "Animate", description: "Generate scene clips" },
  { id: "edit", label: "Visual Edit", description: "Trim and visual fixes" },
  { id: "audio", label: "Audio Studio", description: "Dub and add voices" },
  { id: "assemble", label: "Assemble", description: "Preview and export" },
];

const initialScenes: ProductionScene[] = [
  {
    id: "scene_001",
    title: "Scene 1",
    durationSeconds: DEFAULT_SCENE_DURATION_SECONDS,
    imageCount: DEFAULT_SCENE_IMAGE_COUNT,
    aspectRatio: "16:9",
    prompt: "",
    motionNotes: "",
    style: "Cinematic Fantasy",
    status: "pending_images",
    images: [],
    characterRefs: createCharacterSlots([]),
    characterRefSlotCount: 1,
  },
];

const crystalDeerScene: ProductionScene = {
  id: "scene_001",
  title: "The Crystal Deer Hunt",
  durationSeconds: 15,
  imageCount: 8,
  aspectRatio: "16:9",
  prompt:
    "A rugged warrior man hunts a legendary crystal deer through a dense ancient forest. The warrior wears dark leather armor and carries a bow. The deer has translucent glowing blue crystal antlers and faint luminous markings. Mist moves between massive old trees, moss, ferns, wet stones, and shafts of sunlight. Cinematic fantasy realism, tense quiet atmosphere, consistent warrior, consistent crystal deer, dramatic forest lighting.",
  motionNotes:
    "15 second scene from 8 scene pass preview: slow tracking shots, quiet stalking movement, subtle fog drift, glowing crystal reflections, tense cinematic pacing.",
  style: "Cinematic Fantasy",
  status: "pending_images",
  images: [],
};

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function statusMeta(status: SceneStatus) {
  switch (status) {
    case "images_ready":
      return { label: "Images Ready", dot: "bg-emerald-400", text: "text-emerald-300" };
    case "pending_images":
      return { label: "Pending Images", dot: "bg-amber-400", text: "text-amber-300" };
    case "clip_ready":
      return { label: "Clip Ready", dot: "bg-cyan-400", text: "text-cyan-300" };
    case "edited":
      return { label: "Edited", dot: "bg-violet-400", text: "text-violet-300" };
    case "complete":
      return { label: "Complete", dot: "bg-blue-400", text: "text-blue-300" };
    default:
      return { label: "Not Started", dot: "bg-white/35", text: "text-white/35" };
  }
}

function sceneNumber(index: number) {
  return String(index + 1).padStart(2, "0");
}

function thumbnailClass(index: number) {
  const variants = [
    "from-slate-900 via-slate-700 to-cyan-200/70",
    "from-zinc-950 via-stone-700 to-amber-200/70",
    "from-slate-950 via-indigo-900 to-slate-300/80",
    "from-neutral-950 via-neutral-700 to-orange-200/70",
    "from-slate-950 via-emerald-950 to-cyan-100/70",
    "from-zinc-950 via-stone-800 to-violet-200/70",
    "from-slate-950 via-blue-950 to-slate-100/75",
    "from-neutral-950 via-yellow-950 to-amber-100/75",
  ];
  return variants[index % variants.length];
}

function aspectToOrientation(aspectRatio: ProductionScene["aspectRatio"]) {
  return aspectRatio === "9:16" ? "portrait" : "landscape";
}

function aspectToSize(aspectRatio: ProductionScene["aspectRatio"]) {
  if (aspectRatio === "9:16") return { width: 720, height: 1280 };
  if (aspectRatio === "1:1") return { width: 1024, height: 1024 };
  return { width: 1280, height: 720 };
}

function createCharacterSlots(refs: CharacterReference[] | null | undefined = []): CharacterReference[] {
  // OTG_UNIQUE_CHARACTER_SLOT_IDS_V2
  // Slot identity must be positional. Older saved manifests can contain duplicated IDs like character_5,
  // which makes React and checkbox/update logic treat multiple checked characters as the same character.
  const source = Array.isArray(refs) ? refs : [];
  const totalSlots = Math.max(CHARACTER_REFERENCE_SLOTS, source.length);

  return Array.from({ length: totalSlots }, (_unused, index) => {
    const existing = (source[index] || {}) as any;
    const slotId = `character_${index + 1}`;

    return {
      ...existing,
      id: slotId,
      slotId,
      originalId: existing.originalId || existing.id || slotId,
    } as CharacterReference;
  });
}



// OTG V36BO4A: clean prompt passed through to the Qwen next-scene workflow.
function otgCleanNextScenePromptForWorkflowV36BO4(value: unknown) {
  let text = String(value ?? "").replace(/\r\n/g, "\n").trim();

  const hardStops = [
    "Composition rules:",
    "OTG anti-duplicate guard:",
    "Identity/Face lock:",
    "[OTG_TEMP_SCENE_ASSET_RULES_V36BN2]",
    "OTG_TEMP_SCENE_ASSET_RULES_V36BN2",
  ];

  for (const marker of hardStops) {
    const index = text.toLowerCase().indexOf(marker.toLowerCase());
    if (index >= 0) text = text.slice(0, index).trim();
  }

  text = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^Next Scene(?:\s+\d+)?\s*[:;]\s*/i, "")
    .trim();

  return `Next Scene: ${text || "continue the scene"}`;
}

function extractNextScenePrompts(raw: string) {
  const text = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const prompts: string[] = [];

  for (const line of lines) {
    if (/^Next Scene(?:\s+\d+)?\s*[:;]/i.test(line)) {
      prompts.push(line.replace(/^Next Scene(?:\s+\d+)?\s*[:;]\s*/i, "").trim());
    } else if (prompts.length) {
      prompts[prompts.length - 1] = `${prompts[prompts.length - 1]} ${line}`.replace(/\s+/g, " ").trim();
    }
  }

  if (!prompts.length && text) prompts.push(text.replace(/^Next Scene(?:\s+\d+)?\s*[:;]\s*/i, "").trim());
  return prompts.filter(Boolean);
}



function storyboardFramePrompt(scene: ProductionScene, frameIndex: number) {
  const explicitPrompts = extractNextScenePrompts(scene.prompt);
  const promptText = String(explicitPrompts[frameIndex] || explicitPrompts[0] || scene.prompt || "").trim();
  const styleText = String(scene.style || "").trim();
  const base = otgCleanNextScenePromptForWorkflowV36BO4(promptText);
  return styleText ? `${base}\nStyle: ${styleText}` : base;
}

function StageShell({ stage, active }: { stage: ProductionStage; active: ProductionStage }) {
  const content: Record<ProductionStage, { title: string; body: string; actions: string[] }> = {
    storyboard: {
      title: "Storyboard first",
      body: "Build every scene and approve the image set before moving into animation.",
      actions: ["Submit Prompt", "Regenerate Selected", "Lock Storyboard"],
    },
    animate: {
      title: "Animate approved scenes",
      body: "Use locked scene pass preview as source material. Prompt editing stays back in Storyboard.",
      actions: ["Animate Scene", "Animate Current Scene", "Approve Clip"],
    },
    edit: {
      title: "Visual Edit",
      body: "Trim the clip or describe a visual edit. Audio work is handled in Audio Studio.",
      actions: ["Trim Video", "Edit Video", "Save"],
    },
    audio: {
      title: "Audio Studio",
      body: "Dub existing voices or add new off-screen voices after the visual edit is ready.",
      actions: ["Dub Existing Voice", "Add New Voice", "Preview Mix"],
    },
    assemble: {
      title: "Assemble final timeline",
      body: "Arrange finished clips, preview the full sequence, and export the final video.",
      actions: ["Preview Final", "Export MP4", "Export Project"],
    },
  };
  const item = content[stage];

  if (stage === "storyboard") return null;

  return (
    <section className="rounded-[8px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{active}</div>
      <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">{item.title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{item.body}</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {item.actions.map((action) => (
          <button key={action} type="button" disabled className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-400">
            {action}
          </button>
        ))}
      </div>
    </section>
  );
}

export default function StoryboardPanel() {
  

  function getStoryboardPromptKeyV33(fallback: string): string {
    return fallback;
  }

                // OTG_STORYBOARD_PROMPT_REFERENCE_ISOLATION_V35J
        function getStoryboardPromptCanonicalKeyV35J(promptKey: string): string {
          const raw = String(promptKey || "").trim();
          if (!raw) return "scene-prompt-1";
        
          const directScenePrompt = raw.match(/^scene-prompt-(\d+)$/i);
          if (directScenePrompt) return `scene-prompt-${Math.max(1, Number(directScenePrompt[1]) || 1)}`;
        
          const promptZero = raw.match(/^prompt-v(?:30|33)-(\d+)$/i);
          if (promptZero) return `scene-prompt-${(Number(promptZero[1]) || 0) + 1}`;
        
          const sceneOne = raw.match(/^scene-(\d+)$/i);
          if (sceneOne) return `scene-prompt-${Math.max(1, Number(sceneOne[1]) || 1)}`;
        
          const promptOne = raw.match(/^prompt-(\d+)$/i);
          if (promptOne) return `scene-prompt-${Math.max(1, Number(promptOne[1]) || 1)}`;
        
          const imageIndex = raw.match(/(?:^|[_-])img[_-]?(\d+)(?:$|[_-])/i);
          if (imageIndex) return `scene-prompt-${Math.max(1, Number(imageIndex[1]) || 1)}`;
        
          return raw;
        }

function getStoryboardPromptAliasKeysV35G(promptKey: string): string[] {
  const canonical = getStoryboardPromptCanonicalKeyV35J(promptKey);
  const keys = new Set<string>([canonical]);
  const sceneMatch = canonical.match(/^scene-prompt-(\d+)$/i);
  if (sceneMatch) {
    const oneIndex = Math.max(1, Number(sceneMatch[1]) || 1);
    const zeroIndex = oneIndex - 1;
    keys.add(`prompt-v30-${zeroIndex}`);
    keys.add(`prompt-v33-${zeroIndex}`);
    keys.add(`scene-prompt-${oneIndex}`);
    keys.add(`scene-${oneIndex}`);
    keys.add(`prompt-${oneIndex}`);
  } else {
    keys.add(String(promptKey || ""));
  }
  return Array.from(keys);
}



function normalizeStoryboardBackgroundReferenceV36AK(input: any): StoryboardBackgroundReferenceV30 | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const sourceDisplay = String(
    input.sourceDisplayImageV36AF ||
      input.displayImage ||
      input.previewUrl ||
      input.thumbnailUrl ||
      input.thumbnail ||
      input.imageUrl ||
      input.imagePath ||
      "",
  ).trim();

  const plateWorkflow = String(
    input.plateWorkflowImageV36AF ||
      input.sourceWorkflowImageV36AF ||
      input.workflowImage ||
      input.workflowImagePath ||
      input.cardWorkflowImage ||
      input.cardImagePath ||
      input.imagePath ||
      input.imageUrl ||
      input.displayImage ||
      "",
  ).trim();

  const id = String(input.id || input.name || plateWorkflow || sourceDisplay || "").trim();
  const name = String(input.name || input.title || "Scene Background").trim() || "Scene Background";
  const displayImage = sourceDisplay || plateWorkflow;
  const workflowImage = plateWorkflow || displayImage;

  if (!id || (!displayImage && !workflowImage)) return null;

  return {
    id,
    name,
    imagePath: displayImage || undefined,
    imageUrl: displayImage || undefined,
    displayImage: displayImage || undefined,
    workflowImage: workflowImage || undefined,
    plateWorkflowImageV36AF: workflowImage || undefined,
    sourceDisplayImageV36AF: displayImage || undefined,
    sourceWorkflowImageV36AF: workflowImage || undefined,
    promptBlock: String(input.promptBlock || input.prompt || input.masterPrompt || "").trim() || undefined,
  };
}

function storyboardReferenceDisplayImageV36AK(reference: any) {
  const item: any = reference || {};

  return String(
    item.sourceDisplayImageV36AF ||
      item.sourceWorkflowImageV36AF ||
      item.displayImage ||
      item.imageUrl ||
      item.imagePath ||
      "",
  ).trim();
}

function storyboardReferenceWorkflowImageV36AK(reference: any) {
  const item: any = reference || {};

  return String(
    item.plateWorkflowImageV36AF ||
      item.workflowImage ||
      item.workflowImagePath ||
      item.imagePath ||
      item.imageUrl ||
      item.displayImage ||
      "",
  ).trim();
}

function readStoryboardBackgroundLibraryV36AK(): StoryboardBackgroundReferenceV30[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = JSON.parse(window.localStorage.getItem("otg:character-background-library:v36a") || "[]");

    if (!Array.isArray(raw)) return [];

    const seen = new Set<string>();

    return raw
      .map(normalizeStoryboardBackgroundReferenceV36AK)
      .filter((item): item is StoryboardBackgroundReferenceV30 => {
        if (!item) return false;
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
  } catch {
    return [];
  }
}

function openStoryboardBackgroundGalleryOverlayV36AK(args: {
  promptKeys: string[];
  selectedPromptKey: string;
}) {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const existing = document.getElementById("otg-storyboard-background-gallery-v36ak");
  if (existing) existing.remove();

  const backgrounds = readStoryboardBackgroundLibraryV36AK();
  const promptKeys = args.promptKeys.length ? args.promptKeys : ["scene-prompt-1"];
  let activePromptKey = args.selectedPromptKey || promptKeys[0];

  const overlay = document.createElement("div");
  overlay.id = "otg-storyboard-background-gallery-v36ak";
  overlay.setAttribute("role", "dialog");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "999999";
  overlay.style.background = "rgba(0,0,0,0.72)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.padding = "24px";

  const panel = document.createElement("div");
  panel.style.width = "min(1120px, 94vw)";
  panel.style.maxHeight = "86vh";
  panel.style.overflow = "auto";
  panel.style.background = "#080b14";
  panel.style.border = "1px solid rgba(139, 92, 246, 0.75)";
  panel.style.borderRadius = "16px";
  panel.style.padding = "18px";
  panel.style.color = "white";
  panel.style.boxShadow = "0 22px 70px rgba(0,0,0,0.55)";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.gap = "12px";
  header.style.alignItems = "center";
  header.style.marginBottom = "14px";

  const title = document.createElement("div");
  title.innerHTML = "<div style='font-size:18px;font-weight:800;letter-spacing:.06em;'>BACKGROUND GALLERY</div><div style='font-size:13px;color:#c4b5fd;margin-top:4px;'>Choose exactly one background for one scene prompt. Same background can be reused on multiple prompts.</div>";

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.style.border = "1px solid rgba(139, 92, 246, 0.8)";
  close.style.background = "#120b24";
  close.style.color = "white";
  close.style.borderRadius = "10px";
  close.style.padding = "10px 14px";
  close.style.fontWeight = "700";
  close.onclick = () => overlay.remove();

  header.appendChild(title);
  header.appendChild(close);

  const promptWrap = document.createElement("div");
  promptWrap.style.display = "flex";
  promptWrap.style.flexWrap = "wrap";
  promptWrap.style.gap = "8px";
  promptWrap.style.marginBottom = "14px";

  const refreshPromptButtons = () => {
    Array.from(promptWrap.querySelectorAll("button")).forEach((button) => {
      const btn = button as HTMLButtonElement;
      const selected = btn.dataset.promptKey === activePromptKey;
      btn.style.background = selected ? "#6d28d9" : "#111827";
      btn.style.border = selected ? "1px solid #a78bfa" : "1px solid rgba(139, 92, 246, 0.55)";
    });
  };

  promptKeys.forEach((promptKey, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.promptKey = promptKey;
    button.textContent = `Prompt ${index + 1}`;
    button.style.color = "white";
    button.style.borderRadius = "10px";
    button.style.padding = "9px 12px";
    button.style.fontWeight = "800";
    button.onclick = () => {
      activePromptKey = promptKey;
      refreshPromptButtons();
    };
    promptWrap.appendChild(button);
  });

  refreshPromptButtons();

  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(190px, 1fr))";
  grid.style.gap = "12px";

  if (!backgrounds.length) {
    const empty = document.createElement("div");
    empty.textContent = "No saved backgrounds found. Create and save backgrounds from the Characters tab first.";
    empty.style.padding = "16px";
    empty.style.border = "1px solid rgba(139, 92, 246, 0.45)";
    empty.style.borderRadius = "12px";
    empty.style.color = "#cbd5e1";
    grid.appendChild(empty);
  } else {
    backgrounds.forEach((background) => {
      const card = document.createElement("button");
      card.type = "button";
      card.style.textAlign = "left";
      card.style.background = "#030712";
      card.style.border = "1px solid rgba(139, 92, 246, 0.45)";
      card.style.borderRadius = "12px";
      card.style.padding = "10px";
      card.style.color = "white";
      card.style.cursor = "pointer";

      const imgValue = storyboardReferenceDisplayImageV36AK(background);
      const img = document.createElement("img");
      img.alt = background.name;
      img.src = imgValue.startsWith("/api/") || imgValue.startsWith("http")
        ? imgValue
        : `/api/comfy-image?filename=${encodeURIComponent(imgValue.split(/[\\/]/).pop() || imgValue)}&type=output&otgFullRes=1`;
      img.style.width = "100%";
      img.style.aspectRatio = "16 / 9";
      img.style.objectFit = "cover";
      img.style.borderRadius = "9px";
      img.style.background = "#000";

      const name = document.createElement("div");
      name.textContent = background.name;
      name.style.fontWeight = "800";
      name.style.fontSize = "13px";
      name.style.marginTop = "8px";

      const hint = document.createElement("div");
      hint.textContent = "Select for active prompt";
      hint.style.fontSize = "11px";
      hint.style.color = "#a78bfa";
      hint.style.marginTop = "3px";

      card.appendChild(img);
      card.appendChild(name);
      card.appendChild(hint);

      card.onclick = () => {
        window.dispatchEvent(
          new CustomEvent("otg-storyboard-background-selected-v36ak", {
            detail: {
              promptKey: activePromptKey,
              background,
            },
          }),
        );
        overlay.remove();
      };

      grid.appendChild(card);
    });
  }

  panel.appendChild(header);
  panel.appendChild(promptWrap);
  panel.appendChild(grid);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

// OTG_STORYBOARD_PER_PROMPT_BACKGROUND_GALLERY_V36AK



function getStoryboardPromptSelectedIdsV35K(
  promptKey: string,
  selections: Record<string, string[]> = storyboardPromptReferenceSelectionsV30
): string[] {
  // OTG_STORYBOARD_REFERENCE_CHECKBOX_CLICKFIX_V35K
  // Selectors store by canonical scene-prompt key but still honor older prompt-v30/v33 aliases.
  const canonicalPromptKey = getStoryboardPromptCanonicalKeyV35J(promptKey);
  const aliasKeys = getStoryboardPromptAliasKeysV35G(canonicalPromptKey);
  const explicitKey = aliasKeys.find((key) => (selections[key] || []).length > 0);
  if (explicitKey) return selections[explicitKey] || [];
  return [];
}

function getStoryboardSelectedReferencesForPromptV33(promptKey: string): StoryboardPromptSelectedReferenceV33[] {
  const canonicalPromptKey = getStoryboardPromptCanonicalKeyV35J(promptKey);
  const pool = [
    ...sceneReferencePoolV32,
    ...getStoryboardBackgroundRegistryItemsV36AK(),
  ];

  const selectedIds = getStoryboardPromptSelectedIdsV35K(canonicalPromptKey);

  return filterStoryboardSelectedReferenceIdsOneBackgroundV36AK(selectedIds, pool)
    .map((id) => pool.find((item) => item.id === id))
    .filter((item): item is StoryboardSceneReferenceRegistryItemV32 => Boolean(item && item.isSaved))
    .slice(0, 3)
    .map((item, index) => ({
      id: item.id,
      slotId: item.slotId,
      name: item.name,
      kind: (item.kind === "background" ? "background" : "character") as "character" | "background",
      sourceType: item.kind === "background" ? "background" : item.sourceType,
      displayImage: storyboardReferenceDisplayImageV36AK(item),
      workflowImage: storyboardReferenceWorkflowImageV36AK(item),
      referenceNumber: index + 1,
    }));
}

    function buildStoryboardReferenceInstructionV33(references: StoryboardPromptSelectedReferenceV33[]): string {
    if (!references.length) return "";
  
    return references
      .map((reference, index) => {
        const referenceNumber = index + 1;
        const rawName = String(reference.name || reference.slotId || `Reference ${referenceNumber}`).trim();
        const name = rawName || `Reference ${referenceNumber}`;
        const kind = String(reference.kind || "").toLowerCase();
        const sourceType = String(reference.sourceType || "").toLowerCase();
        const isBackground = kind === "background" || sourceType === "background" || /^bg[:\s-]/i.test(name);
  
        if (isBackground) {
          return `Reference Image ${referenceNumber} is the background/environment: ${name}. Keep this environment consistent: layout, floor, walls, ceiling, lighting, props, and spatial orientation.`;
        }
  
        return `Reference Image ${referenceNumber} belongs to character: ${name}. Use this image only for that character's identity, body, face, outfit, and visual continuity.`;
      })
      .join("\n");
  }

                                function getStoryboardPromptKeysV35(): string[] {
                  const keys = new Set<string>();
                  Object.keys(storyboardPromptReferenceSelectionsV30 || {}).forEach((key) => {
                    keys.add(getStoryboardPromptCanonicalKeyV35J(key));
                  });
                
                  const sceneLike = selectedScene as any;
                  const promptContainers = [
                    sceneLike?.prompts,
                    sceneLike?.scenePrompts,
                    sceneLike?.storyboardPrompts,
                    sceneLike?.frames,
                    sceneLike?.images,
                    sceneLike?.generatedImages,
                  ];
                
                  for (const container of promptContainers) {
                    if (!Array.isArray(container)) continue;
                    container.forEach((_item: any, index: number) => {
                      keys.add(`scene-prompt-${index + 1}`);
                    })
                  }
                
                  const promptCount =
                    Number(sceneLike?.promptCount || sceneLike?.scenePromptCount || sceneLike?.imageCount || sceneLike?.storyboardImageCount || 0) || 0;
                  for (let index = 0; index < promptCount; index += 1) {
                    keys.add(`scene-prompt-${index + 1}`);
                  }
                
                  if (!keys.size) keys.add("scene-prompt-1");
                  return Array.from(keys);
                }
        function buildStoryboardReferencePayloadV33(promptKey: string): StoryboardPromptReferencePayloadV35 {
      const selectedReferences = getStoryboardSelectedReferencesForPromptV33(promptKey);
      return {
        promptKey,
        selectedReferences,
        referenceInstruction: buildStoryboardReferenceInstructionV33(selectedReferences),
        selectedReferenceCount: selectedReferences.length,
        workflowImages: selectedReferences.map((reference) => storyboardReferenceWorkflowImageV36AK(reference)).filter(Boolean),
        displayImages: selectedReferences.map((reference) => storyboardReferenceDisplayImageV36AK(reference)).filter(Boolean),
      };
    }

                function getStoryboardPromptReferencePayloadsV35(): Record<string, StoryboardPromptReferencePayloadV35> {
          return Object.fromEntries(
            getStoryboardPromptKeysV35().map((promptKey) => {
              const canonical = getStoryboardPromptCanonicalKeyV35J(promptKey);
              return [canonical, buildStoryboardReferencePayloadV33(canonical)];
            })
          );
        }

    function getStoryboardReferencePayloadForPromptV35(promptKey: string): StoryboardPromptReferencePayloadV35 {
      return buildStoryboardReferencePayloadV33(promptKey);
    }

  

  

// OTG_STORYBOARD_REFERENCE_POOL_BACKGROUND_V30
type StoryboardBackgroundReferenceV30 = {
  id: string;
  name: string;
  imagePath?: string;
  imageUrl?: string;
  displayImage?: string;
  workflowImage?: string;
  plateWorkflowImageV36AF?: string;
  sourceDisplayImageV36AF?: string;
  sourceWorkflowImageV36AF?: string;
  promptBlock?: string;
};

function storyboardReferenceDisplayImageV36AJ(reference: any) {
  const item: any = reference || {};

  return String(
    item.sourceDisplayImageV36AF ||
      item.sourceWorkflowImageV36AF ||
      item.displayImage ||
      item.imageUrl ||
      item.imagePath ||
      "",
  ).trim();
}

function storyboardReferenceWorkflowImageV36AJ(reference: any) {
  const item: any = reference || {};

  return String(
    item.plateWorkflowImageV36AF ||
      item.workflowImage ||
      item.workflowImagePath ||
      item.imagePath ||
      item.imageUrl ||
      item.displayImage ||
      "",
  ).trim();
}

function buildStoryboardBackgroundRegistryItemV36AJ(background: StoryboardBackgroundReferenceV30) {
  const displayImage = storyboardReferenceDisplayImageV36AJ(background);
  const workflowImage = storyboardReferenceWorkflowImageV36AJ(background);

  return {
    id: background.id,
    slotId: background.id,
    name: background.name,
    kind: "background" as const,
    sourceType: "background" as const,
    displayImage,
    workflowImage,
    isSaved: true,
    plateWorkflowImageV36AF: background.plateWorkflowImageV36AF,
    sourceDisplayImageV36AF: background.sourceDisplayImageV36AF,
    sourceWorkflowImageV36AF: background.sourceWorkflowImageV36AF,
  };
}

// OTG_STORYBOARD_BACKGROUND_PLATE_ROUTING_V36AJ



// OTG_STORYBOARD_REFERENCE_REGISTRY_V32

// OTG_STORYBOARD_REFERENCE_REGISTRY_WIRE_V33

// OTG_STORYBOARD_SELECTED_REFERENCE_PAYLOAD_V35C_SAFE
type StoryboardPromptReferencePayloadV35 = {
  promptKey: string;
  selectedReferenceCount: number;
  selectedReferences: StoryboardPromptSelectedReferenceV33[];
  referenceInstruction: string;
  workflowImages: string[];
  displayImages: string[];
};

type StoryboardPromptSelectedReferenceV33 = {
  id: string;
  slotId: string;
  name: string;
  kind: "character" | "background";
  sourceType: "input" | "gallery" | "background";
  displayImage?: string;
  workflowImage?: string;
  referenceNumber: number;
};

type StoryboardSceneReferenceRegistryItemV32 = {
  id: string;
  slotId: string;
  name: string;
  kind: "character" | "background";
  sourceType: "input" | "gallery" | "background";
  displayImage?: string;
  workflowImage?: string;
  isSaved: boolean;
};

type StoryboardPromptReferenceOptionV30 = {
  id: string;
  label: string;
  kind: "character" | "background";
  imagePath?: string;
  imageUrl?: string;
};

function getStoryboardReferenceImageSrcV30(reference: StoryboardPromptReferenceOptionV30): string {
  return String(reference.imageUrl || reference.imagePath || "");
}

function StoryboardPromptReferenceSelectorV30({
  promptKey,
  options,
  selectedIds,
  guideOpen,
  onToggleReference,
  onToggleGuide,
}: {
  promptKey: string;
  options: StoryboardPromptReferenceOptionV30[];
  selectedIds: string[];
  guideOpen: boolean;
  onToggleReference: (promptKey: string, referenceId: string) => void;
  onToggleGuide: (promptKey: string) => void;
}) {
  const selectedCount = selectedIds.length;
  return (
    <div className="mb-3 rounded-2xl border border-purple-300/20 bg-purple-950/20 p-3" data-otg="OTG_STORYBOARD_REFERENCE_POOL_BACKGROUND_V30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-white">References used in this scene image</div>
          <div className="mt-1 text-xs text-white/75">Select saved/gallery characters and the background for this exact frame. Thumbnails are for identification. The workflow receives the registry workflowImage for each selected reference.</div>
        </div>
        <button
          type="button"
          onClick={() => onToggleGuide(promptKey)}
          className="rounded-[8px] border border-cyan-300/30 bg-slate-950 px-3 py-2 text-xs font-black text-cyan-100 shadow-sm transition hover:border-cyan-200 hover:bg-cyan-950 focus:outline-none focus:ring-2 focus:ring-cyan-300/40"
        >
          Prompt Guide
        </button>
      </div>

      {options.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {options.map((option, optionIndex) => {
            const active = selectedIds.includes(option.id);
            const src = getStoryboardReferenceImageSrcV30(option);
            return (
              <label
                key={`${promptKey || "prompt"}_${option.id || "option"}_${optionIndex}`}
                data-otg-storyboard-reference-option-v35k="true"
                data-prompt-key={promptKey}
                data-reference-id={`${promptKey || "prompt"}_${option.id || "option"}_${optionIndex}`}
                className={
                  active
                    ? "flex cursor-pointer items-center gap-2 rounded-xl border border-purple-300 bg-purple-500/35 px-3 py-2 text-left text-xs font-black text-white"
                    : "flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-left text-xs font-bold text-white/70 hover:border-purple-300/60 hover:text-white"
                }
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => onToggleReference(promptKey, option.id)}
                  className="h-4 w-4 rounded border-white/30 bg-slate-950 text-purple-400 focus:ring-2 focus:ring-purple-300"
                />
                {src ? <img src={src} alt="" className="h-7 w-7 rounded-md bg-slate-950 object-contain" /> : null}
                <span>{option.kind === "background" ? "BG: " : ""}{option.label}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-950/20 p-3 text-xs text-amber-100/80">
          No scene references are available yet. Add characters and, ideally, one background before generating scene pass preview.
        </div>
      )}

      {selectedCount > 5 ? (
        <div className="mt-3 rounded-xl border border-red-300/30 bg-red-950/30 p-3 text-xs font-bold text-red-100">
          Too many references selected. Use no more than 5 total references. Best setup is 1-4 characters plus 1 background.
        </div>
      ) : null}

      {guideOpen ? (
        <div className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-950/20 p-3 text-xs text-white/85">
          <div className="font-black uppercase tracking-[0.16em] text-cyan-200">Prompt guide</div>
          <div className="mt-2 space-y-2">
            <p>Start with <strong>Next Scene:</strong> and a camera direction.</p>
            <p>Name only checked characters. Mention where each selected character is located.</p>
            <p>If a background is checked, name it and state what must stay unchanged: layout, floor, walls, lighting, and major props.</p>
            <p>Keep one shot per prompt. Do not describe unused characters.</p>
            <p className="text-cyan-100">Example: Next Scene: Over-the-shoulder shot from Marcus toward Elena. Marcus stands near the library door. Elena stands by the window. Keep the same Grand Library background, same bookshelf layout, same red carpet, and same warm lamp lighting.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}


  const [activeStage, setActiveStage] = useState<ProductionStage>("storyboard");
  const [activeAnimateSceneIndexV36BPU10B, setActiveAnimateSceneIndexV36BPU10B] = useState(0);
  const [firstLastPairDebugV36BPU19, setFirstLastPairDebugV36BPU19] = useState<{
    action: "none" | "panel-capture" | "clicked" | "applied" | "rejected";
    frameIndex?: number;
    sceneId?: string;
    framesLength?: number;
    reason?: string;
  }>({ action: "none" });


  const [sceneReferencePoolV32, setSceneReferencePoolV32] = useState<StoryboardSceneReferenceRegistryItemV32[]>([]);

  // OTG_STORYBOARD_REFERENCE_REGISTRY_DOMSCAN_V33E_SINGLE_OWNER
  // Single writer for sceneReferencePoolV32. This prevents older scanners from clearing valid entries.
  


  // OTG_STORYBOARD_REFERENCE_REGISTRY_DOMSCAN_V33D_ADDITIVE
  // Additive registry scanner. It does not depend on older v32/v33 scanner placement.
  // It reads visible saved Character Reference cards and updates sceneReferencePoolV32.
  




  
// OTG_STORYBOARD_REFERENCE_REGISTRY_V32


  // Reference registry source of truth for per-prompt selectors.


  // displayImage is what the user sees. workflowImage is what will be sent to ComfyUI in the follow-up routing patch.


  




  const [storyboardCharacterReferenceOptionsV31b, setStoryboardCharacterReferenceOptionsV31b] = useState<StoryboardPromptReferenceOptionV30[]>([]);



    // OTG_STORYBOARD_REFERENCE_SELECTOR_TIGHTEN_V31C




  const [storyboardReferenceRefreshTickV31, setStoryboardReferenceRefreshTickV31] = useState(0);






  const [storyboardBackgroundReferenceV30, setStoryboardBackgroundReferenceV30] = useState<StoryboardBackgroundReferenceV30 | null>(null);



    const [storyboardBackgroundReferencesV36AK, setStoryboardBackgroundReferencesV36AK] = useState<StoryboardBackgroundReferenceV30[]>([]);
const [storyboardPromptReferenceSelectionsV30, setStoryboardPromptReferenceSelectionsV30] = useState<Record<string, string[]>>({});

  // OTG_STORYBOARD_ONE_JOB_PER_PROMPT_V36AQ
  type StoryboardPerPromptJobV36AQ = {
    promptKey: string;
    sceneNumber: number;
    rawText: string;
    compiledText: string;
  };

  function storyboardWorkflowFileForReferenceCountV36AQ(count: number) {
    const checkedCount = Math.max(1, Math.min(5, Number(count) || 1));

    if (checkedCount === 1) return "storyboard/StoryBoard 1.json";
    if (checkedCount === 2) return "storyboard/Storyboard 2.json";
    if (checkedCount === 3) return "storyboard/Storyboard 3.json";
    if (checkedCount === 4) return "storyboard/Storyboard 4.json";

    return "storyboard/Storyboard 5.json";
  }

  // OTG_STORYBOARD_ONE_SCENE_BATCH_REQUEST_V36AT
  function storyboardPayloadTextV36AQ(payload: any) {
    const directText = String(
      payload?.prompt ||
        payload?.positivePrompt ||
        payload?.promptText ||
        payload?.scenePrompt ||
        payload?.fullPrompt ||
        payload?.text ||
        "",
    ).replace(/\r\n/g, "\n");

    if (directText.trim()) {
      return directText;
    }

    if (Array.isArray(payload?.scenePrompts)) {
      const joined = payload.scenePrompts
        .map((value: unknown, index: number) => {
          const text = String(value || "").trim();
          if (!text) return "";
          return /^Next\s+Scene\s+\d+\s*:/i.test(text) ? text : `Next Scene ${index + 1}: ${text}`;
        })
        .filter(Boolean)
        .join("\n");
      if (joined.trim()) return joined;
    }

    if (Array.isArray(payload?.scenes)) {
      return payload.scenes
        .map((scene: any, index: number) => {
          const sceneNumber = Number(scene?.sceneNumber || scene?.imageIndex || scene?.frameIndex || index + 1) || index + 1;
          const raw = String(
            scene?.prompt ||
              scene?.positivePrompt ||
              scene?.promptText ||
              scene?.scenePrompt ||
              scene?.fullPrompt ||
              scene?.text ||
              scene?.action ||
              "",
          ).trim();
          if (!raw) return "";
          return /^Next\s+Scene\s+\d+\s*:/i.test(raw) ? raw : `Next Scene ${sceneNumber}: ${raw}`;
        })
        .filter(Boolean)
        .join("\n");
    }

    return "";
  }

  function storyboardOneSceneForPromptJobV36AT(payload: any, job: StoryboardPerPromptJobV36AQ) {
    const scenes = Array.isArray(payload?.scenes) ? payload.scenes : [];
    const byNumber = scenes.find((scene: any, index: number) => {
      const sceneNumber = Number(scene?.sceneNumber || scene?.imageIndex || scene?.frameIndex || index + 1) || index + 1;
      return sceneNumber === job.sceneNumber;
    });

    const sourceScene = byNumber || scenes[Math.max(0, job.sceneNumber - 1)] || {};
    const cleanPrompt = job.rawText.replace(/^\s*Next\s+Scene(?:\s+\d+)?\s*:\s*/i, "").trim();

    return {
      ...sourceScene,
      sceneNumber: job.sceneNumber,
      imageIndex: job.sceneNumber,
      frameIndex: job.sceneNumber,
      prompt: cleanPrompt,
      positivePrompt: cleanPrompt,
      promptText: cleanPrompt,
      scenePrompt: cleanPrompt,
      fullPrompt: job.compiledText,
      text: cleanPrompt,
    };
  }

  function storyboardSplitPayloadIntoPromptJobsV36AQ(payload: any): StoryboardPerPromptJobV36AQ[] {
    const promptText = storyboardPayloadTextV36AQ(payload);
    const jobs: StoryboardPerPromptJobV36AQ[] = [];

    const nextScenePattern = /Next\s+Scene\s+(\d+)\s*:\s*([\s\S]*?)(?=\s*Next\s+Scene\s+\d+\s*:|$)/gi;
    let match: RegExpExecArray | null = null;

    while ((match = nextScenePattern.exec(promptText)) !== null) {
      const sceneNumber = Math.max(1, Number(match[1]) || jobs.length + 1);
      const rawText = String(match[2] || "").trim();

      if (!rawText) continue;

      jobs.push({
        promptKey: getStoryboardPromptCanonicalKeyV35J(`scene-prompt-${sceneNumber}`),
        sceneNumber,
        rawText,
        compiledText: `Next Scene 1: ${rawText}`,
      });
    }

    if (jobs.length) {
      return jobs;
    }

    const fallbackText = promptText
      .replace(/^\s*Next\s+Scene(?:\s+\d+)?\s*:\s*/i, "")
      .trim();

    if (!fallbackText) {
      return [];
    }

    const explicitPromptKey = String(
      payload?.promptKey ||
        payload?.storyboardPromptKey ||
        payload?.scenePromptKey ||
        "scene-prompt-1",
    ).trim();

    return [
      {
        promptKey: getStoryboardPromptCanonicalKeyV35J(explicitPromptKey),
        sceneNumber: 1,
        rawText: fallbackText,
        compiledText: `Next Scene 1: ${fallbackText}`,
      },
    ];
  }

  function storyboardBuildSinglePromptPayloadV36AQ(payload: any, job: StoryboardPerPromptJobV36AQ) {
    const referencePayload = getStoryboardReferencePayloadForPromptV35(job.promptKey);

    const workflowImages = Array.isArray(referencePayload.workflowImages)
      ? referencePayload.workflowImages.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 3)
      : [];

    const displayImages = Array.isArray(referencePayload.displayImages)
      ? referencePayload.displayImages.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 3)
      : [];

    const singleSceneV36AT = storyboardOneSceneForPromptJobV36AT(payload, job);

    if (!workflowImages.length) {
      throw new Error(`Prompt ${job.sceneNumber} has no checked reference images. Select at least one character or background for that prompt.`);
    }

    const checkedCount = Math.max(1, Math.min(5, workflowImages.length));
    const workflowFile = storyboardWorkflowFileForReferenceCountV36AQ(checkedCount);

    return {
      ...payload,

      // One prompt per ComfyUI job.
      prompt: job.compiledText,
      positivePrompt: job.compiledText,
      promptText: job.compiledText,
      scenePrompt: job.compiledText,
      fullPrompt: job.compiledText,
      scenePrompts: [job.compiledText],
      text: job.compiledText,

      // Critical for /api/storyboard/batch-generate:
      // the server route loops over body.scenes, so this split request must contain one scene only.
      scenes: [singleSceneV36AT],


      // Workflow selection is per prompt, based only on that prompt's checked refs.
      storyboardCount: checkedCount,
      workflowFile,

      // Existing route name is characterImages, but this is the ordered checked-reference list.
      // It may contain character images and/or the background plate workflow image.
      characterImages: workflowImages,
      workflowImages,
      displayImages,

      promptKey: job.promptKey,
      storyboardPromptKey: job.promptKey,
      scenePromptKey: job.promptKey,

      imageIndex: job.sceneNumber,
      frameIndex: job.sceneNumber,
      storyboardIndex: job.sceneNumber,
      slotIndex: job.sceneNumber,

      promptReferencePayload: referencePayload,
      selectedReferences: referencePayload.selectedReferences || [],
      selectedReferenceCount: referencePayload.selectedReferenceCount || workflowImages.length,
      referenceInstruction: referencePayload.referenceInstruction || "",

      // Bypass older frontend interceptors if they exist.
      otgOneJobPerPromptV36AQ: true,
      otgOneScenePerBatchRequestV36AT: true,
      otgStoryboardBatchSinglePromptV36AS: true,
      otgPerPromptWorkflowSplitV36AP: true,
      otgCheckedReferenceWorkflowInjectionV36AO: "v36aq-bypass",

      otgOneJobPerPromptSceneNumberV36AQ: job.sceneNumber,
      otgOneJobPerPromptWorkflowFileV36AQ: workflowFile,
      otgOneJobPerPromptReferenceCountV36AQ: checkedCount,
    };
  }

  function storyboardFlattenReturnedImagesV36AQ(value: any): string[] {
    const output: string[] = [];
    const seen = new Set<string>();

    function pushImage(candidate: unknown) {
      const text = String(candidate || "").trim();

      if (!text) return;
      if (seen.has(text)) return;

      if (
        text.endsWith(".png") ||
        text.endsWith(".jpg") ||
        text.endsWith(".jpeg") ||
        text.endsWith(".webp") ||
        text.includes("/api/comfy-image")
      ) {
        seen.add(text);
        output.push(text);
      }
    }

    function walk(input: any) {
      if (!input) return;

      if (typeof input === "string") {
        pushImage(input);
        return;
      }

      if (Array.isArray(input)) {
        input.forEach(walk);
        return;
      }

      if (typeof input === "object") {
        pushImage(input.filename);
        pushImage(input.file);
        pushImage(input.path);
        pushImage(input.image);
        pushImage(input.imageUrl);
        pushImage(input.imagePath);
        pushImage(input.output);

        Object.values(input).forEach(walk);
      }
    }

    walk(value);

    return output;
  }

  useEffect(() => {
    if (activeStage !== "animate") return;
    void loadAnimateSavedCharacterPresetsV36BPU26B();
  }, [activeStage]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const originalFetchV36AQ = window.fetch;

    const wrappedFetchV36AQ: typeof window.fetch = async (input, init) => {
      try {
        const targetUrl = typeof input === "string" ? input : String((input as Request)?.url || "");

        // OTG_STORYBOARD_BATCH_TARGET_V36AS
        // The active storyboard generation route is /api/storyboard/batch-generate.
        // Split both production-picture and batch-generate requests into one job per prompt.
        if (
          !targetUrl.includes("/api/production/picture") &&
          !targetUrl.includes("/api/storyboard/batch-generate")
        ) {
          return originalFetchV36AQ(input, init);
        }

        if (!init || typeof init.body !== "string") {
          return originalFetchV36AQ(input, init);
        }

        const payload = JSON.parse(init.body);

        if (payload?.otgOneJobPerPromptV36AQ) {
          return originalFetchV36AQ(input, init);
        }

        const jobs = storyboardSplitPayloadIntoPromptJobsV36AQ(payload);

        if (!jobs.length) {
          return originalFetchV36AQ(input, init);
        }

        const results: any[] = [];
        const allImages: string[] = [];

        for (const job of jobs) {
          const singlePromptPayload = storyboardBuildSinglePromptPayloadV36AQ(payload, job);

          const response = await originalFetchV36AQ(input, {
            ...init,
            body: JSON.stringify(singlePromptPayload),
          });

          const responseText = await response.text();
          let responseJson: any = null;

          try {
            responseJson = JSON.parse(responseText);
          } catch {
            responseJson = { raw: responseText };
          }

          const returnedImages = storyboardFlattenReturnedImagesV36AQ(responseJson);
          returnedImages.forEach((image) => allImages.push(image));

          results.push({
            ok: response.ok,
            status: response.status,
            promptKey: job.promptKey,
            sceneNumber: job.sceneNumber,
            rawText: job.rawText,
            compiledText: job.compiledText,
            workflowFile: singlePromptPayload.workflowFile,
            storyboardCount: singlePromptPayload.storyboardCount,
            characterImages: singlePromptPayload.characterImages,
            workflowImages: singlePromptPayload.workflowImages,
            displayImages: singlePromptPayload.displayImages,
            returnedImages,
            response: responseJson,
          });

          if (!response.ok) {
            return new Response(
              JSON.stringify({
                ok: false,
                marker: "OTG_STORYBOARD_ONE_JOB_PER_PROMPT_V36AQ",
                error: `ComfyUI job failed for prompt ${job.sceneNumber}.`,
                failedPromptKey: job.promptKey,
                failedSceneNumber: job.sceneNumber,
                results,
              }),
              {
                status: response.status || 500,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
        }

        return new Response(
          JSON.stringify({
            ok: true,
            marker: "OTG_STORYBOARD_ONE_JOB_PER_PROMPT_V36AQ",
            jobCount: results.length,
            splitWorkflowCount: results.length,
            images: allImages,
            outputImages: allImages,
            results,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      } catch (error: any) {
        return new Response(
          JSON.stringify({
            ok: false,
            marker: "OTG_STORYBOARD_ONE_JOB_PER_PROMPT_V36AQ",
            error: String(error?.message || error || "Failed to split storyboard prompts into individual ComfyUI jobs."),
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    };

    // OTG_STORYBOARD_DISABLE_LEGACY_FETCH_INTERCEPTORS_V36BH_V36AQ
    // Disabled: direct generateSelectedSceneImages now submits one normalized /api/production/picture request per prompt.
    // Legacy v36AQ fetch rewriting is no longer installed.

    return () => {
      if (window.fetch === wrappedFetchV36AQ) {
        window.fetch = originalFetchV36AQ;
      }
    };
  }, [
    storyboardPromptReferenceSelectionsV30,
    storyboardBackgroundReferenceV30,
    storyboardBackgroundReferencesV36AK,
    sceneReferencePoolV32
  ]);


  // OTG_STORYBOARD_ONE_WORKFLOW_PER_PROMPT_V36AP
  type StoryboardSplitPromptV36AP = {
    promptKey: string;
    sceneNumber: number;
    text: string;
    compiledText: string;
  };

  function storyboardWorkflowFileForReferenceCountV36AP(count: number) {
    const checkedCount = Math.max(1, Math.min(5, Number(count) || 1));

    return checkedCount === 1
      ? "storyboard/StoryBoard 1.json"
      : `storyboard/Storyboard ${checkedCount}.json`;
  }

  function storyboardPayloadPromptTextV36AP(payload: any) {
    return String(
      payload?.prompt ||
        payload?.positivePrompt ||
        payload?.promptText ||
        payload?.scenePrompt ||
        payload?.text ||
        "",
    );
  }

  function storyboardSplitCompiledPromptV36AP(payload: any): StoryboardSplitPromptV36AP[] {
    const promptText = storyboardPayloadPromptTextV36AP(payload).replace(/\r\n/g, "\n");
    const output: StoryboardSplitPromptV36AP[] = [];

    const nextScenePattern = /Next\s+Scene\s+(\d+)\s*:\s*([\s\S]*?)(?=\s*Next\s+Scene\s+\d+\s*:|$)/gi;
    let match: RegExpExecArray | null = null;

    while ((match = nextScenePattern.exec(promptText)) !== null) {
      const sceneNumber = Math.max(1, Number(match[1]) || output.length + 1);
      const text = String(match[2] || "").trim();

      if (!text) continue;

      output.push({
        promptKey: getStoryboardPromptCanonicalKeyV35J(`scene-prompt-${sceneNumber}`),
        sceneNumber,
        text,
        compiledText: `Next Scene 1: ${text}`,
      });
    }

    if (output.length) {
      return output;
    }

    const fallbackText = promptText.trim();

    if (!fallbackText) {
      return [];
    }

    const explicitPromptKey = String(
      payload?.promptKey ||
        payload?.storyboardPromptKey ||
        payload?.scenePromptKey ||
        "",
    ).trim();

    return [
      {
        promptKey: getStoryboardPromptCanonicalKeyV35J(explicitPromptKey || "scene-prompt-1"),
        sceneNumber: 1,
        text: fallbackText.replace(/^\s*Next\s+Scene(?:\s+\d+)?\s*:\s*/i, "").trim(),
        compiledText: `Next Scene 1: ${fallbackText.replace(/^\s*Next\s+Scene(?:\s+\d+)?\s*:\s*/i, "").trim()}`,
      },
    ];
  }

  function storyboardPatchSinglePromptPayloadV36AP(payload: any, splitPrompt: StoryboardSplitPromptV36AP) {
    const referencePayload = getStoryboardReferencePayloadForPromptV35(splitPrompt.promptKey);

    const checkedWorkflowImages = Array.isArray(referencePayload.workflowImages)
      ? referencePayload.workflowImages.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 3)
      : [];

    const checkedDisplayImages = Array.isArray(referencePayload.displayImages)
      ? referencePayload.displayImages.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 3)
      : [];

    const checkedCount = Math.max(1, Math.min(5, checkedWorkflowImages.length || 1));
    const workflowFile = storyboardWorkflowFileForReferenceCountV36AP(checkedCount);

    return {
      ...payload,

      // Critical: one prompt per workflow. This request only contains the single scene prompt.
      prompt: splitPrompt.compiledText,
      positivePrompt: splitPrompt.compiledText,
      promptText: splitPrompt.compiledText,
      scenePrompt: splitPrompt.compiledText,
      text: splitPrompt.compiledText,

      // Critical: workflow choice is based on this prompt's checked image count.
      storyboardCount: checkedCount,
      workflowFile,

      // The route calls this characterImages, but it is really the ordered checked references.
      // Character refs and background refs both travel here as workflow-ready images.
      characterImages: checkedWorkflowImages,
      workflowImages: checkedWorkflowImages,
      displayImages: checkedDisplayImages,

      promptKey: splitPrompt.promptKey,
      storyboardPromptKey: splitPrompt.promptKey,
      scenePromptKey: splitPrompt.promptKey,
      imageIndex: splitPrompt.sceneNumber,
      frameIndex: splitPrompt.sceneNumber,
      storyboardIndex: splitPrompt.sceneNumber,
      slotIndex: splitPrompt.sceneNumber,

      promptReferencePayload: referencePayload,
      selectedReferences: referencePayload.selectedReferences || [],
      selectedReferenceCount: referencePayload.selectedReferenceCount || checkedWorkflowImages.length,
      referenceInstruction: referencePayload.referenceInstruction || "",

      // Prevent recursive split.
      otgPerPromptWorkflowSplitV36AP: true,
      otgPerPromptWorkflowSceneNumberV36AP: splitPrompt.sceneNumber,
      otgPerPromptWorkflowReferenceCountV36AP: checkedWorkflowImages.length,
      otgPerPromptWorkflowFileV36AP: workflowFile,
    };
  }

  useEffect(() => {
    if (typeof window === "undefined") return;

    const originalFetchV36AP = window.fetch;

    const wrappedFetchV36AP: typeof window.fetch = async (input, init) => {
      try {
        const targetUrl = typeof input === "string" ? input : String((input as Request)?.url || "");

        if (!targetUrl.includes("/api/production/picture")) {
          return originalFetchV36AP(input, init);
        }

        if (!init || typeof init.body !== "string") {
          return originalFetchV36AP(input, init);
        }

        const payload = JSON.parse(init.body);

        if (payload?.otgPerPromptWorkflowSplitV36AP) {
          return originalFetchV36AP(input, init);
        }

        const splitPrompts = storyboardSplitCompiledPromptV36AP(payload);

        if (!splitPrompts.length) {
          return originalFetchV36AP(input, init);
        }

        if (splitPrompts.length === 1) {
          const patchedPayload = storyboardPatchSinglePromptPayloadV36AP(payload, splitPrompts[0]);

          return originalFetchV36AP(input, {
            ...init,
            body: JSON.stringify(patchedPayload),
          });
        }

        const results: any[] = [];

        for (const splitPrompt of splitPrompts) {
          const patchedPayload = storyboardPatchSinglePromptPayloadV36AP(payload, splitPrompt);

          const response = await originalFetchV36AP(input, {
            ...init,
            body: JSON.stringify(patchedPayload),
          });

          const text = await response.text();
          let json: any = null;

          try {
            json = JSON.parse(text);
          } catch {
            json = { raw: text };
          }

          results.push({
            ok: response.ok,
            status: response.status,
            promptKey: splitPrompt.promptKey,
            sceneNumber: splitPrompt.sceneNumber,
            workflowFile: patchedPayload.workflowFile,
            storyboardCount: patchedPayload.storyboardCount,
            characterImages: patchedPayload.characterImages,
            workflowImages: patchedPayload.workflowImages,
            response: json,
          });

          if (!response.ok) {
            return new Response(
              JSON.stringify({
                ok: false,
                marker: "OTG_STORYBOARD_ONE_WORKFLOW_PER_PROMPT_V36AP",
                error: `Per-prompt workflow failed for scene ${splitPrompt.sceneNumber}.`,
                failedSceneNumber: splitPrompt.sceneNumber,
                results,
              }),
              {
                status: response.status || 500,
                headers: {
                  "Content-Type": "application/json",
                },
              },
            );
          }
        }

        return new Response(
          JSON.stringify({
            ok: true,
            marker: "OTG_STORYBOARD_ONE_WORKFLOW_PER_PROMPT_V36AP",
            splitWorkflowCount: results.length,
            results,
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      } catch (error: any) {
        console.warn("[OTG_STORYBOARD_ONE_WORKFLOW_PER_PROMPT_V36AP]", error);

        return originalFetchV36AP(input, init);
      }
    };

    // OTG_STORYBOARD_DISABLE_LEGACY_FETCH_INTERCEPTORS_V36BH_V36AP
    // Disabled: direct generateSelectedSceneImages now owns per-prompt splitting and workflow selection.
    // Legacy v36AP fetch rewriting is no longer installed.

    return () => {
      if (window.fetch === wrappedFetchV36AP) {
        window.fetch = originalFetchV36AP;
      }
    };
  }, [
    storyboardPromptReferenceSelectionsV30,
    storyboardBackgroundReferenceV30, storyboardBackgroundReferencesV36AK
  ]);


  // OTG_STORYBOARD_CHECKED_REF_WORKFLOW_INJECTION_V36AO
  function storyboardWorkflowFileForCheckedReferenceCountV36AO(count: number) {
    const checkedCount = Math.max(1, Math.min(5, Number(count) || 1));

    return checkedCount === 1
      ? "storyboard/StoryBoard 1.json"
      : `storyboard/Storyboard ${checkedCount}.json`;
  }

  function inferStoryboardPromptKeyFromPicturePayloadV36AO(payload: any, sequenceIndex: number) {
    const explicitKey = String(
      payload?.promptKey ||
        payload?.storyboardPromptKey ||
        payload?.scenePromptKey ||
        payload?.referencePromptKey ||
        "",
    ).trim();

    if (explicitKey) {
      return getStoryboardPromptCanonicalKeyV35J(explicitKey);
    }

    const directIndex =
      Number(payload?.imageIndex) ||
      Number(payload?.frameIndex) ||
      Number(payload?.storyboardIndex) ||
      Number(payload?.slotIndex) ||
      Number(payload?.index);

    if (Number.isFinite(directIndex) && directIndex > 0) {
      return getStoryboardPromptCanonicalKeyV35J(`scene-prompt-${Math.max(1, directIndex)}`);
    }

    if (Number.isFinite(directIndex) && directIndex === 0) {
      return "scene-prompt-1";
    }

    const promptText = String(
      payload?.prompt ||
        payload?.positivePrompt ||
        payload?.promptText ||
        payload?.scenePrompt ||
        payload?.text ||
        "",
    );

    const nextSceneMatch = promptText.match(/Next\s+Scene\s+(\d+)/i);
    if (nextSceneMatch) {
      return getStoryboardPromptCanonicalKeyV35J(`scene-prompt-${Math.max(1, Number(nextSceneMatch[1]) || 1)}`);
    }

    return getStoryboardPromptCanonicalKeyV35J(`scene-prompt-${Math.max(1, sequenceIndex + 1)}`);
  }

  function patchProductionPicturePayloadForCheckedReferencesV36AO(payload: any, sequenceIndex: number) {
    const promptKey = inferStoryboardPromptKeyFromPicturePayloadV36AO(payload, sequenceIndex);
    const referencePayload = getStoryboardReferencePayloadForPromptV35(promptKey);

    const checkedWorkflowImagesV36AO = Array.isArray(referencePayload.workflowImages)
      ? referencePayload.workflowImages.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 3)
      : [];

    const checkedDisplayImagesV36AO = Array.isArray(referencePayload.displayImages)
      ? referencePayload.displayImages.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 3)
      : [];

    if (!checkedWorkflowImagesV36AO.length) {
      return {
        ...payload,
        promptKey,
        storyboardPromptKey: promptKey,
        promptReferencePayload: referencePayload,
        selectedReferences: referencePayload.selectedReferences || [],
        referenceInstruction: referencePayload.referenceInstruction || "",
        otgCheckedReferenceWorkflowInjectionV36AO: "no-checked-references",
      };
    }

    const checkedCountV36AO = Math.max(1, Math.min(5, checkedWorkflowImagesV36AO.length));

    return {
      ...payload,

      // This is the important part: the workflow choice must match the checked image count.
      storyboardCount: checkedCountV36AO,
      workflowFile: storyboardWorkflowFileForCheckedReferenceCountV36AO(checkedCountV36AO),

      // The production picture route calls these characterImages, but they are really
      // the ordered checked reference workflow images: characters plus optional background plate.
      characterImages: checkedWorkflowImagesV36AO,
      workflowImages: checkedWorkflowImagesV36AO,
      displayImages: checkedDisplayImagesV36AO,

      promptKey,
      storyboardPromptKey: promptKey,
      promptReferencePayload: referencePayload,
      selectedReferences: referencePayload.selectedReferences || [],
      selectedReferenceCount: referencePayload.selectedReferenceCount || checkedCountV36AO,
      referenceInstruction: referencePayload.referenceInstruction || "",
      otgCheckedReferenceWorkflowInjectionV36AO: true,
    };
  }

  useEffect(() => {
    if (typeof window === "undefined") return;

    let storyboardPictureSequenceV36AO = 0;
    const originalFetchV36AO = window.fetch;

    const wrappedFetchV36AO: typeof window.fetch = async (input, init) => {
      try {
        const targetUrl = typeof input === "string" ? input : String((input as Request)?.url || "");

        if (targetUrl.includes("/api/production/picture") && init && typeof init.body === "string") {
          const payload = JSON.parse(init.body);
          
          // OTG_STORYBOARD_BYPASS_V36AO_REWRITER_V36BG2
          // Direct per-prompt generation already imports/normalizes reference images.
          // Do not let the legacy v36AO fetch interceptor rewrite clean server paths back to stale blob URLs.
          if (
            payload?.otgDirectOneWorkflowPerPromptV36AU ||
            payload?.otgContinuePerPromptErrorsV36AW ||
            payload?.otgImportedBrowserReferencesV36BB ||
            payload?.otgFinalReferenceNormalizerV36BD ||
            payload?.otgOneJobPerPromptV36AQ ||
            payload?.otgPerPromptWorkflowSplitV36AP ||
            payload?.otgOneScenePerBatchRequestV36AT
          ) {
            return originalFetchV36AO(input, init);
          }

          const patchedPayload = patchProductionPicturePayloadForCheckedReferencesV36AO(
            payload,
            storyboardPictureSequenceV36AO,
          );

          storyboardPictureSequenceV36AO += 1;

          return originalFetchV36AO(input, {
            ...init,
            body: JSON.stringify(patchedPayload),
          });
        }
      } catch (error) {
        console.warn("[OTG_STORYBOARD_CHECKED_REF_WORKFLOW_INJECTION_V36AO]", error);
      }

      return originalFetchV36AO(input, init);
    };

    // OTG_STORYBOARD_DISABLE_LEGACY_FETCH_INTERCEPTORS_V36BH_V36AO
    // Disabled: direct generation already injects checked references, imports browser-only blobs, and normalizes image paths.
    // Legacy v36AO fetch rewriting is no longer installed.

    return () => {
      if (window.fetch === wrappedFetchV36AO) {
        window.fetch = originalFetchV36AO;
      }
    };
  }, [
    storyboardPromptReferenceSelectionsV30,
    sceneReferencePoolV32,
    storyboardBackgroundReferenceV30, storyboardBackgroundReferencesV36AK
  ]);


function getStoryboardBackgroundRegistryItemsV36AK() {
  const promptLimit = Math.max(1, getStoryboardPromptKeysV35().length);
  const seen = new Set<string>();
  const backgrounds: StoryboardBackgroundReferenceV30[] = [];

  [...storyboardBackgroundReferencesV36AK, storyboardBackgroundReferenceV30]
    .map(normalizeStoryboardBackgroundReferenceV36AK)
    .forEach((background) => {
      if (!background) return;
      if (seen.has(background.id)) return;
      seen.add(background.id);
      backgrounds.push(background);
    });

  return backgrounds.slice(0, promptLimit).map((background) => ({
    id: background.id,
    slotId: background.id,
    name: background.name,
    kind: "background" as const,
    sourceType: "background" as const,
    displayImage: storyboardReferenceDisplayImageV36AK(background),
    workflowImage: storyboardReferenceWorkflowImageV36AK(background),
    isSaved: true,
  }));
}

function filterStoryboardSelectedReferenceIdsOneBackgroundV36AK(selectedIds: string[], pool: any[]) {
  let hasBackground = false;

  return selectedIds.filter((id) => {
    const item = pool.find((candidate) => candidate?.id === id || candidate?.slotId === id);
    const isBackground = item?.kind === "background" || item?.sourceType === "background";

    if (!isBackground) return true;
    if (hasBackground) return false;

    hasBackground = true;
    return true;
  });
}

function applyStoryboardBackgroundToPromptV36AK(promptKeyRaw: string, input: any) {
  const background = normalizeStoryboardBackgroundReferenceV36AK(input);

  if (!background) {
    return;
  }

  const promptKeys = getStoryboardPromptKeysV35();
  const promptKey = getStoryboardPromptCanonicalKeyV35J(
    promptKeyRaw || promptKeys[0] || "scene-prompt-1",
  );

  const promptLimit = Math.max(1, promptKeys.length);
  const knownBackgroundIds = new Set<string>();

  [...storyboardBackgroundReferencesV36AK, storyboardBackgroundReferenceV30, background]
    .map(normalizeStoryboardBackgroundReferenceV36AK)
    .forEach((item) => {
      if (item?.id) knownBackgroundIds.add(item.id);
    });

  setStoryboardBackgroundReferencesV36AK((current) => {
    const merged: StoryboardBackgroundReferenceV30[] = [];
    const seen = new Set<string>();

    [background, ...current]
      .map(normalizeStoryboardBackgroundReferenceV36AK)
      .forEach((item) => {
        if (!item) return;
        if (seen.has(item.id)) return;
        seen.add(item.id);
        merged.push(item);
      });

    return merged.slice(0, promptLimit);
  });

  setStoryboardBackgroundReferenceV30(background);

  setStoryboardPromptReferenceSelectionsV30((current) => {
    const existing = Array.isArray(current?.[promptKey]) ? current[promptKey] : [];
    const withoutExistingBackground = existing.filter((id) => !knownBackgroundIds.has(id));

    return {
      ...current,
      [promptKey]: [...withoutExistingBackground, background.id],
    };
  });
}

function openStoryboardBackgroundGalleryV36AK(promptKeyRaw = "") {
  const promptKeys = getStoryboardPromptKeysV35();
  const targetPrompt =
    promptKeyRaw ||
    promptKeys.find((promptKey) => {
      const selectedIds = storyboardPromptReferenceSelectionsV30[promptKey] || [];
      const backgroundIds = new Set(getStoryboardBackgroundRegistryItemsV36AK().map((item) => item.id));
      return !selectedIds.some((id) => backgroundIds.has(id));
    }) ||
    promptKeys[0] ||
    "scene-prompt-1";

  openStoryboardBackgroundGalleryOverlayV36AK({
    promptKeys,
    selectedPromptKey: targetPrompt,
  });
}

useEffect(() => {
  function retitleBackgroundButtons() {
    document.querySelectorAll("button").forEach((button) => {
      const text = (button.textContent || "").replace(/\s+/g, " ").trim();

      if (text === "Background Gallery" || text === "Add Background") {
        button.textContent = "Background Gallery";
      }
    });
  }

  function handleClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    const button = target?.closest("button");

    if (!button) return;

    const text = (button.textContent || "").replace(/\s+/g, " ").trim();

    if (text === "Background Gallery" || text === "Add Background" || text === "Background Gallery") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      openStoryboardBackgroundGalleryV36AK();
    }
  }

  function handleSelected(event: Event) {
    const detail = (event as CustomEvent).detail || {};
    applyStoryboardBackgroundToPromptV36AK(String(detail.promptKey || ""), detail.background);
  }

  retitleBackgroundButtons();

  const interval = window.setInterval(retitleBackgroundButtons, 1000);
  document.addEventListener("click", handleClick, true);
  window.addEventListener("otg-storyboard-background-selected-v36ak", handleSelected as EventListener);

  return () => {
    window.clearInterval(interval);
    document.removeEventListener("click", handleClick, true);
    window.removeEventListener("otg-storyboard-background-selected-v36ak", handleSelected as EventListener);
  };
}, [storyboardPromptReferenceSelectionsV30, storyboardBackgroundReferenceV30, storyboardBackgroundReferencesV36AK]);




  // OTG_STORYBOARD_REFERENCE_REGISTRY_WIRE_V33B_ORDERFIX



  const [storyboardPromptGuideOpenV30, setStoryboardPromptGuideOpenV30] = useState<Record<string, boolean>>({});



  function toggleStoryboardPromptReferenceV30(promptKey: string, referenceId: string) {
    // OTG_STORYBOARD_REFERENCE_CHECKBOX_CLICKFIX_V35K_TOGGLE
    const canonicalPromptKey = getStoryboardPromptCanonicalKeyV35J(promptKey);
    const referenceOptions = getStoryboardReferenceOptionsV30();
    const optionById = new Map(referenceOptions.map((option) => [option.id, option]));
    const selectedOption = optionById.get(referenceId);
    const backgroundIds = new Set(referenceOptions.filter((option) => option.kind === "background").map((option) => option.id));
    const characterIds = new Set(referenceOptions.filter((option) => option.kind === "character").map((option) => option.id));

    setStoryboardPromptReferenceSelectionsV30((prev) => {
      const aliasKeys = getStoryboardPromptAliasKeysV35G(canonicalPromptKey);
      const explicitKey = aliasKeys.find((key) => (prev[key] || []).length > 0);
      const startingIds = explicitKey
        ? prev[explicitKey] || []
        : (storyboardBackgroundReferenceV30 ? [storyboardBackgroundReferenceV30.id] : []);
      const current = new Set(startingIds);

      if (current.has(referenceId)) {
        current.delete(referenceId);
      } else if (selectedOption?.kind === "background") {
        backgroundIds.forEach((id) => current.delete(id));
        if (current.size < 5) current.add(referenceId);
      } else {
        const selectedCharacterCount = Array.from(current).filter((id) => characterIds.has(id)).length;
        if (selectedCharacterCount < 4 && current.size < 5) current.add(referenceId);
      }

      const next = { ...prev, [canonicalPromptKey]: Array.from(current) };
      aliasKeys.forEach((key) => {
        if (key !== canonicalPromptKey) delete next[key];
      });
      return next;
    });
  }



  function toggleStoryboardPromptGuideV30(promptKey: string) {
    const canonicalPromptKey = getStoryboardPromptCanonicalKeyV35J(promptKey);
    setStoryboardPromptGuideOpenV30((prev) => ({ ...prev, [canonicalPromptKey]: !prev[canonicalPromptKey] }));
  }



  function getStoryboardReferenceOptionsV30(): StoryboardPromptReferenceOptionV30[] {
    return [
      ...sceneReferencePoolV32
        .filter((item) => item.isSaved)
        .map((item) => ({
          id: item.id,
          label: item.name,
          kind: (item.kind === "background" ? "background" : "character") as "character" | "background",
          imagePath: item.workflowImage,
          imageUrl: item.displayImage,
        })),
      ...(storyboardBackgroundReferenceV30
        ? [{
            id: storyboardBackgroundReferenceV30.id,
            label: storyboardBackgroundReferenceV30.name,
            kind: "background" as const,
            imagePath: storyboardBackgroundReferenceV30.imagePath,
            imageUrl: storyboardBackgroundReferenceV30.imageUrl,
          }]
        : []),
    ];
  }


  const [voiceActorTranscriptByFrame, setVoiceActorTranscriptByFrame] = useState<Record<string, string>>({});
  const [voiceActorTranscribingByFrame, setVoiceActorTranscribingByFrame] = useState<Record<string, boolean>>({});
  const [productionHomeMode, setProductionHomeMode] = useState<ProductionHomeMode>("home");



  const [expandedAnimateClipIndex, setExpandedAnimateClipIndex] = useState<number | null>(null); // OTG_PRODUCTION_ANIMATE_CLIP_EXPAND_V1_STATE
  const [expandedEditClipIndex, setExpandedEditClipIndex] = useState<number | null>(null); // OTG_PRODUCTION_EDIT_EXPANDED_PREVIEW_V1_STATE
  const [expandedStoryboardImageIndex, setExpandedStoryboardImageIndex] = useState<number | null>(null); // OTG_PRODUCTION_STORYBOARD_IMAGE_EXPAND_V1_STATE
  const [storyboardComfyProgress, setStoryboardComfyProgress] = useState<ComfyProgressUiState>(emptyComfyProgressState);
  const [animateComfyProgress, setAnimateComfyProgress] = useState<ComfyProgressUiState>(emptyComfyProgressState);
  const [storyboardGenerationRunId, setStoryboardGenerationRunId] = useState(0); // OTG_PRODUCTION_STORYBOARD_PROGRESS_REFRESH_V1B
  const [animateGenerationRunId, setAnimateGenerationRunId] = useState(0);
  const [selectedEditClipKey, setSelectedEditClipKey] = useState("");
  const [editDraftsByClipKey, setEditDraftsByClipKey] = useState<Record<string, ProductionClipEditManifest>>({});
  const [renderingEditClipKey, setRenderingEditClipKey] = useState("");
  const [renderingVisualFxClipKey, setRenderingVisualFxClipKey] = useState("");
  const [generatingAceMusicClipKey, setGeneratingAceMusicClipKey] = useState("");
  const [aceMusicStatusByClipKey, setAceMusicStatusByClipKey] = useState<Record<string, string>>({});
  const [assemblingSceneId, setAssemblingSceneId] = useState("");
  const [assembleResult, setAssembleResult] = useState<ProductionAssembleStitchResult | null>(null);
  const [assembleReviewMode, setAssembleReviewMode] = useState<"source" | "review" | "library">("source");
  // OTG_ASSEMBLY_BACKGROUND_MUSIC_STABLE_AUDIO_V36BPW15
  const [assemblyMusicPrompt, setAssemblyMusicPrompt] = useState("cinematic fantasy background score with warm strings, soft percussion, low drones, and emotional build for a polished final scene. BPM: 90. Length: 60 seconds");
  const [assemblyMusicVolume, setAssemblyMusicVolume] = useState(0.3);
  // OTG_ASSEMBLY_BACKGROUND_MUSIC_BOTTOM_PLACEMENT_V36BPW16C
  const [assemblyMusicStartSeconds, setAssemblyMusicStartSeconds] = useState(0);
  const [assemblyMusicEndSeconds, setAssemblyMusicEndSeconds] = useState(60);
  // OTG_ASSEMBLY_BACKGROUND_MUSIC_DETECT_FADE_ADD_UNDO_V36BPW17
  const [assemblyMusicDetectedTimelineSeconds, setAssemblyMusicDetectedTimelineSeconds] = useState(0);
  const [assemblyMusicFadeInSeconds, setAssemblyMusicFadeInSeconds] = useState(2);
  const [assemblyMusicFadeOutSeconds, setAssemblyMusicFadeOutSeconds] = useState(3);
  const [assemblyMusicMixing, setAssemblyMusicMixing] = useState(false);
  const [assemblyMusicUndoSnapshot, setAssemblyMusicUndoSnapshot] = useState<any | null>(null);
  // OTG_ASSEMBLY_ADD_FINAL_TO_GALLERY_V36BPW18
  const [assemblyGallerySaving, setAssemblyGallerySaving] = useState(false);
  const [assemblyGalleryResult, setAssemblyGalleryResult] = useState<any | null>(null);
  const [assemblyMusicGenerating, setAssemblyMusicGenerating] = useState(false);
  const [assemblyMusicResult, setAssemblyMusicResult] = useState<any | null>(null);
  const [assemblyMusicError, setAssemblyMusicError] = useState("");
  const [exportPreset, setExportPreset] = useState<ProductionExportPreset>("standard");
  const [mediaPreflight, setMediaPreflight] = useState<ProductionMediaPreflightResult | null>(null);
  const [checkingPreflight, setCheckingPreflight] = useState(false);
  const [productionSnapshots, setProductionSnapshots] = useState<ProductionSnapshot[]>([]);
  const [editArrangeMode, setEditArrangeMode] = useState(false);
  const [uploadingEditClip, setUploadingEditClip] = useState(false);
  const [editGalleryOpen, setEditGalleryOpen] = useState(false);
  const [editGalleryLoading, setEditGalleryLoading] = useState(false);
  const [editGalleryItems, setEditGalleryItems] = useState<any[]>([]);
  const [editGalleryError, setEditGalleryError] = useState("");
  const [editGalleryPreviewKey, setEditGalleryPreviewKey] = useState("");
  const [productionAnimateMode, setProductionAnimateMode] = useState<ProductionAnimateMode>("default");
  const [projectTitle, setProjectTitle] = useState("Untitled Production");
  const [notice, setNotice] = useState("");
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "autosaved" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [manualSavedAt, setManualSavedAt] = useState("");
  const [manualSaveSignature, setManualSaveSignature] = useState("");
  const [saveDetails, setSaveDetails] = useState("Autosave is ready. Manual save has not been created yet.");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [busySceneId, setBusySceneId] = useState("");
  const [scenes, setScenes] = useState<ProductionScene[]>(initialScenes);
  const [selectedSceneId, setSelectedSceneId] = useState(initialScenes[0]?.id || "");
  const [scenePreviewSceneId, setScenePreviewSceneId] = useState("");
  const [characterFiles, setCharacterFiles] = useState<Record<string, Record<number, File>>>({});
  const [productionLoraOptions, setProductionLoraOptions] = useState<ProductionLoraOption[]>([]);
  const [productionLoraLoading, setProductionLoraLoading] = useState(false);
  const [productionLoraError, setProductionLoraError] = useState("");
  const [animateLoraPickByFrame, setAnimateLoraPickByFrame] = useState<Record<number, string>>({});
  const [animateDurationOverrideByFrameV36BPU42, setAnimateDurationOverrideByFrameV36BPU42] = useState<Record<string, number>>({});
  const [voiceActorAudioBlobs, setVoiceActorAudioBlobs] = useState<Record<number, Blob>>({});
  const [voiceActorRecordingFrameIndex, setVoiceActorRecordingFrameIndex] = useState<number | null>(null);
  const voiceActorRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceActorStreamRef = useRef<MediaStream | null>(null);
  const voiceActorChunksRef = useRef<Blob[]>([]);
  const voiceActorStartedAtRef = useRef<number>(0);
  const firstLastPairPointerHandledAtRefV36BPU19 = useRef(0);
  const [lockedSceneNameIds, setLockedSceneNameIds] = useState<Record<string, boolean>>({});
  const [lockedCharacterNameKeys, setLockedCharacterNameKeys] = useState<Record<string, boolean>>({});
  // STORYBOARD_FROM_CHARACTERS_PATCH
  const [characterPickerSceneId, setCharacterPickerSceneId] = useState("");
  const [characterPickerSlotIndex, setCharacterPickerSlotIndex] = useState<number | null>(null);
  const [characterPickerItems, setCharacterPickerItems] = useState<CharacterLibraryPickerItem[]>([]);
  const [animateSavedCharacterPresetsV36BPU26B, setAnimateSavedCharacterPresetsV36BPU26B] = useState<CharacterLibraryPickerItem[]>([]);
  const [animateCharacterPresetLoadingV36BPU26B, setAnimateCharacterPresetLoadingV36BPU26B] = useState(false);
  const [animateCharacterPresetErrorV36BPU26B, setAnimateCharacterPresetErrorV36BPU26B] = useState("");
  const [characterPickerLoading, setCharacterPickerLoading] = useState(false);
  const [characterPickerError, setCharacterPickerError] = useState("");
  const [characterPickerSelectingId, setCharacterPickerSelectingId] = useState("");
  const [productionVoiceModels, setProductionVoiceModels] = useState<ProductionVoiceModelOption[]>([]);
  const [productionUploadedVoiceOptions, setProductionUploadedVoiceOptions] = useState<ProductionVoiceModelOption[]>([]);
  const [productionVoiceModelsLoading, setProductionVoiceModelsLoading] = useState(false);
  const [productionVoiceModelsError, setProductionVoiceModelsError] = useState("");
  const [audioStudioJobs, setAudioStudioJobs] = useState<Partial<Record<ProductionAudioStudioAction, QueuedJobUiState>>>({});
  const [audioStudioPersistedResults, setAudioStudioPersistedResults] = useState<Record<string, ProductionAudioStudioResultItem>>({});
  const persistedAudioStudioJobIdsRef = useRef<Set<string>>(new Set());
  const [recordingScenePromptIndex, setRecordingScenePromptIndex] = useState<number | null>(null);
  const scenePromptRecorderRef = useRef<MediaRecorder | null>(null);
  const scenePromptAudioChunksRef = useRef<Blob[]>([]);

  const selectedIndex = scenes.findIndex((scene) => scene.id === selectedSceneId);
  const selectedScene = scenes[selectedIndex] || scenes[0];

  function animateDurationOverrideKeyV36BPU42(sceneId: string, frameIndex: number) {
    return `${sceneId || "scene"}:${Math.max(0, Math.floor(Number(frameIndex) || 0))}`;
  }

  function animateDurationWithOverrideV36BPU42(sceneId: string, frameIndex: number, fallback: number) {
    const override = animateDurationOverrideByFrameV36BPU42[animateDurationOverrideKeyV36BPU42(sceneId, frameIndex)];
    return clampAnimateFrameDuration(Number.isFinite(override) ? override : fallback);
  }

  // OTG_STORYBOARD_REFERENCE_POOL_STATE_SOURCE_V35F
  // Rebuild prompt selector character pool from selectedScene.characterRefs after v35 payload patches.
  useEffect(() => {
    const refs = (selectedScene?.characterRefs || []) as CharacterReference[];
    const next = refs
      .map((ref, index): StoryboardSceneReferenceRegistryItemV32 | null => {
        if (!ref) return null;
        const lockKey = selectedScene ? characterReferenceLockKey(selectedScene.id, index, ref) : "";
        const isSaved = Boolean(ref.sourceCharacterId || (lockKey && lockedCharacterNameKeys[lockKey]));
        if (!isSaved) return null;
  
        const displayImage = String(ref.previewUrl || ref.workflowImageUrl || ref.workflowImagePath || ref.fileName || "").trim();
        const workflowImage = String(ref.workflowImagePath || ref.workflowImageUrl || ref.previewUrl || ref.fileName || "").trim();
        if (!displayImage && !workflowImage) return null;
  
        const name = String(ref.sourceCharacterName || ref.label || characterReferenceSlotLabel(index)).trim() || characterReferenceSlotLabel(index);
        return {
          id: ref.id || `character-${index + 1}`,
          slotId: `character-${index + 1}`,
          name,
          kind: "character",
          sourceType: ref.sourceCharacterId ? "gallery" : "input",
          displayImage: displayImage || workflowImage,
          workflowImage: workflowImage || displayImage,
          isSaved: true,
        };
      })
      .filter((item): item is StoryboardSceneReferenceRegistryItemV32 => Boolean(item))
      .slice(0, 4);
  
    setSceneReferencePoolV32((previous) => {
      const previousKey = JSON.stringify(previous.map((item) => [item.id, item.name, item.displayImage, item.workflowImage, item.isSaved]));
      const nextKey = JSON.stringify(next.map((item) => [item.id, item.name, item.displayImage, item.workflowImage, item.isSaved]));
      return previousKey === nextKey ? previous : next;
    });
  }, [selectedScene?.id, selectedScene?.characterRefs, lockedCharacterNameKeys]);

  // Direct source of truth: selectedScene.characterRefs. No DOM scanning.


  // OTG_STORYBOARD_SELECTED_REFERENCE_PAYLOAD_V35C_DEBUG
  useEffect(() => {
    if (typeof window === "undefined") return;
    const existing = (window as any).__otgStoryboardReferenceRegistryV33 || {};
    (window as any).__otgStoryboardReferenceRegistryV33 = {
      ...existing,
      sceneReferencePoolV32,
      storyboardPromptReferenceSelectionsV30,
      storyboardBackgroundReferenceV30,
      storyboardSelectedReferencePayloadsV35: getStoryboardPromptReferencePayloadsV35(),
    };
  }, [sceneReferencePoolV32, storyboardPromptReferenceSelectionsV30, storyboardBackgroundReferenceV30]);

  // OTG_STORYBOARD_SELECTED_REFERENCE_PAYLOAD_V35D_FINAL_DEBUG
  // Runs after earlier registry debug exports so payload aliases are not overwritten.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const payloads = getStoryboardPromptReferencePayloadsV35();
    const existing = (window as any).__otgStoryboardReferenceRegistryV33 || {};
    (window as any).__otgStoryboardReferenceRegistryV33 = {
      ...existing,
      sceneReferencePoolV32,
      storyboardPromptReferenceSelectionsV30,
      storyboardBackgroundReferenceV30,
      storyboardSelectedReferencePayloadsV35: payloads,
      storyboardSelectedReferencePayloadV35: payloads,
      selectedReferencePayloadsV35: payloads,
    };
  }, [sceneReferencePoolV32, storyboardPromptReferenceSelectionsV30, storyboardBackgroundReferenceV30]);
  const selectedSceneStoryboardStatusKey = selectedScene
    ? selectedScene.images.map((image) => `${image?.status || "empty"}:${image?.promptId || ""}`).join("|")
    : "";
  const selectedSceneAnimateStatusKey = selectedScene
    ? animateFrameClips(selectedScene).map((clip: any) => `${clip?.status || "empty"}:${clip?.promptId || ""}:${clip?.fileName || ""}`).join("|")
    : "";

  useEffect(() => {
    if (activeStage !== "animate" || !selectedScene) return;

    const completedScenes = loadCompletedQwenScenesForAnimateV36BPU3();
    if (!completedScenes.length) return;

    const signature = qwenSceneHandoffSignatureV36BPU3(completedScenes);
    const sceneAny = selectedScene as any;
    const hasCurrentHandoff = sceneAny.qwenAnimateHandoffSignatureV36BPU3 === signature;
    const hasReadyImages = Array.isArray(selectedScene.images)
      ? selectedScene.images.some((image: any) => image?.approved || image?.status === "ready" || image?.url)
      : false;

    if (hasCurrentHandoff) return;
    if (hasReadyImages && sceneAny.qwenAnimateHandoffSourceV36BPU3) return;

    syncCompletedQwenScenesToAnimateV36BPU3({ silent: true });
  }, [activeStage, selectedScene?.id]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    let hideTimer: number | null = null;
    let header: HTMLElement | null = null;

    const findProductionHeader = () => {
      const headers = Array.from(document.querySelectorAll("header")) as HTMLElement[];
      const productionHeader =
        headers.find((item) => /SLR Studios OTG/i.test(item.textContent || "") && !/Production Workflow/i.test(item.textContent || "")) ||
        headers.find((item) => /ComfyUI Connected|Classic UI|test_profile|Settings/i.test(item.textContent || "") && !/Production Workflow/i.test(item.textContent || "")) ||
        null;

      if (productionHeader && productionHeader !== header) {
        if (header) {
          header.classList.remove("otg-production-header-autohide-target", "otg-production-header-hidden");
        }
        header = productionHeader;
        header.classList.add("otg-production-header-autohide-target");
      }

      return header;
    };

    const ensureStyle = () => {
      const styleId = "otg-production-header-autohide-style";
      if (document.getElementById(styleId)) return;

      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .otg-production-header-autohide-target {
          transition: transform 220ms ease, opacity 220ms ease;
          will-change: transform, opacity;
        }
        .otg-production-header-autohide-target.otg-production-header-hidden {
          transform: translateY(-120%);
          opacity: 0;
          pointer-events: none;
        }
      `;
      document.head.appendChild(style);
    };

    const showHeader = () => {
      const activeHeader = findProductionHeader();
      if (!activeHeader) return;
      activeHeader.classList.remove("otg-production-header-hidden");

      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
      }

      hideTimer = window.setTimeout(() => {
        const target = findProductionHeader();
        if (target) target.classList.add("otg-production-header-hidden");
      }, 2000);
    };

    ensureStyle();

    // Clear the old v5 behavior if it had targeted the inner Production Workflow header.
    document.querySelectorAll(".otg-production-header-autohide-target, .otg-production-header-hidden").forEach((item) => {
      const text = item.textContent || "";
      if (/Production Workflow/i.test(text) && !/SLR Studios OTG/i.test(text)) {
        item.classList.remove("otg-production-header-autohide-target", "otg-production-header-hidden");
      }
    });

    showHeader();

    const events: Array<keyof WindowEventMap> = ["scroll", "wheel", "touchmove"];
    events.forEach((eventName) => window.addEventListener(eventName, showHeader, { passive: true }));

    const observer = new MutationObserver(() => showHeader());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      if (hideTimer !== null) window.clearTimeout(hideTimer);
      events.forEach((eventName) => window.removeEventListener(eventName, showHeader));
      observer.disconnect();
      if (header) {
        header.classList.remove("otg-production-header-autohide-target", "otg-production-header-hidden");
      }
    };
  }, []);
// OTG_PRODUCTION_ANIMATE_LORA_UI_V22_START
  const PRODUCTION_LORA_CACHE_KEY = "otg:production:animate-loras:v1";

  function normalizeProductionLoraOptions(raw: any): ProductionLoraOption[] {
    const rows = Array.isArray(raw) ? raw : [];
    const seen = new Set<string>();
    const out: ProductionLoraOption[] = [];

    for (const row of rows) {
      const name = String(row?.name || row || "").trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push({ name });
    }

    return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  }

  function cacheProductionLoraOptions(options: ProductionLoraOption[]) {
    if (typeof window === "undefined" || !options.length) return;
    try {
      window.localStorage.setItem(
        PRODUCTION_LORA_CACHE_KEY,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          loras: options,
        })
      );
    } catch {
      // localStorage can be unavailable in private/restricted contexts.
    }
  }

  function loadCachedProductionLoraOptions() {
    if (typeof window === "undefined") return [] as ProductionLoraOption[];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(PRODUCTION_LORA_CACHE_KEY) || "null");
      return normalizeProductionLoraOptions(parsed?.loras || []);
    } catch {
      return [];
    }
  }

  async function refreshProductionLoraOptions(forceRefresh = false) {
    if (productionLoraLoading) return;

    if (!forceRefresh && !productionLoraOptions.length) {
      const cached = loadCachedProductionLoraOptions();
      if (cached.length) {
        setProductionLoraOptions(cached);
        setProductionLoraError("");
      }
    }

    setProductionLoraLoading(true);
    setProductionLoraError("");

    try {
      const response = await fetch(`/api/comfy/loras${forceRefresh ? "?refresh=1" : ""}`, {
        cache: "no-store",
        credentials: "include",
      });
      const json = await response.json().catch(() => null);

      if (!response.ok || json?.ok === false) {
        throw new Error(json?.error || "Could not load ComfyUI LORA list.");
      }

      const options = normalizeProductionLoraOptions(json?.loras || []);
      if (options.length) {
        setProductionLoraOptions(options);
        cacheProductionLoraOptions(options);
        setProductionLoraError(json?.cached ? "Using cached LORA list." : "");
      } else {
        setProductionLoraOptions([]);
        setProductionLoraError("No LORAs were returned by ComfyUI.");
      }
    } catch (error) {
      const cached = loadCachedProductionLoraOptions();
      if (cached.length) {
        setProductionLoraOptions(cached);
        setProductionLoraError("Using saved LORA list. Refresh failed.");
      } else {
        setProductionLoraOptions([]);
        setProductionLoraError(error instanceof Error ? error.message : "Could not load ComfyUI LORA list.");
      }
    } finally {
      setProductionLoraLoading(false);
    }
  }

  useEffect(() => {
    if (activeStage !== "animate" || productionLoraOptions.length || productionLoraLoading) return;

    const cached = loadCachedProductionLoraOptions();
    if (cached.length) {
      setProductionLoraOptions(cached);
      setProductionLoraError("");
    }

    void refreshProductionLoraOptions(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStage]);
  // OTG_PRODUCTION_ANIMATE_LORA_UI_V22_END

  const [audioClipAnalysisBusy, setAudioClipAnalysisBusy] = useState(false);
  const [audioClipAnalysisResult, setAudioClipAnalysisResult] = useState<any | null>(null);
  const [audioExpectedSpeakerCount, setAudioExpectedSpeakerCount] = useState(0);
  const [audioClipVoiceCharacterMap, setAudioClipVoiceCharacterMap] = useState<Record<string, string>>({});
  const [audioDubPreviewBusy, setAudioDubPreviewBusy] = useState(false);
  const [audioDubPreviewResult, setAudioDubPreviewResult] = useState<any | null>(null);
  const [audioDubPreviewError, setAudioDubPreviewError] = useState("");
  const [audioStudioSonyWooshBusy, setAudioStudioSonyWooshBusy] = useState(false);
  const [audioStudioSonyWooshError, setAudioStudioSonyWooshError] = useState("");

  const audioStudioJobsRef = useRef(audioStudioJobs);
  const activeAudioStudioJobIds = useMemo(
    () =>
      Object.values(audioStudioJobs)
        .map((state) => state?.job)
        .filter((job): job is QueuedContractJob => !!job && !isTerminalJobStatus(job.status))
        .map((job) => job.jobId)
        .join("|"),
    [audioStudioJobs]
  );

  useEffect(() => {
    audioStudioJobsRef.current = audioStudioJobs;
  }, [audioStudioJobs]);

  useEffect(() => {
    let cancelled = false;
    async function loadPersistedAudioStudioResults() {
      try {
        const response = await fetch("/api/production/audio-studio/results", {
          credentials: "include",
          cache: "no-store",
        });
        const json = await response.json().catch(() => null) as { items?: ProductionAudioStudioResultItem[]; error?: string } | null;
        if (cancelled) return;
        if (!response.ok) {
          setNotice(json?.error || "Could not load saved Audio Studio clip results.");
          return;
        }

        const next: Record<string, ProductionAudioStudioResultItem> = {};
        for (const item of json?.items || []) {
          if (item?.clipId && item.audioStudioResult?.status === "mock_ready") {
            next[item.clipId] = item;
          }
        }
        setAudioStudioPersistedResults(next);
      } catch (error) {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : "Could not load saved Audio Studio clip results.");
        }
      }
    }

    void loadPersistedAudioStudioResults();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const persistedItems = Object.values(audioStudioPersistedResults);
    if (!persistedItems.length) return;

    setScenes((previousScenes) => {
      let changed = false;
      const nextScenes = previousScenes.map((scene) => {
        const rows = editClipRows(scene);
        if (!rows.length) return scene;

        const frameClips = editStageFrameClips(scene).slice();
        let sceneChanged = false;
        for (const row of rows) {
          const item = audioStudioPersistedResults[row.key];
          if (!item) continue;
          const current = frameClips[row.index] || row.clip || { status: "idle" as const };
          if (current.audioStudioResult?.sourceJobId === item.audioStudioResult.sourceJobId) continue;
          frameClips[row.index] = {
            ...current,
            audioStudioResult: item.audioStudioResult,
          };
          sceneChanged = true;
        }

        if (!sceneChanged) return scene;
        changed = true;
        return {
          ...scene,
          frameClips,
        };
      });

      return changed ? nextScenes : previousScenes;
    });
  }, [audioStudioPersistedResults]);

  useEffect(() => {
    if (!activeAudioStudioJobIds) return;

    let cancelled = false;
    const poll = async () => {
      const activeJobs = Object.entries(audioStudioJobsRef.current)
        .map(([action, state]) => ({ action: action as ProductionAudioStudioAction, job: state?.job }))
        .filter((entry): entry is { action: ProductionAudioStudioAction; job: QueuedContractJob } => !!entry.job && !isTerminalJobStatus(entry.job.status));

      await Promise.all(activeJobs.map(async ({ action, job }) => {
        try {
          const latestJob = await getAudioStudioJob(job.jobId);
          if (cancelled) return;
          setAudioStudioJobs((previous) => ({
            ...previous,
            [action]: {
              phase: isTerminalJobStatus(latestJob.status) ? "queued" : "polling",
              job: latestJob,
            },
          }));
        } catch (error) {
          if (cancelled) return;
          setAudioStudioJobs((previous) => ({
            ...previous,
            [action]: {
              phase: "error",
              job,
              error: error instanceof Error ? error.message : "Could not poll audio studio job.",
            },
          }));
        }
      }));
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeAudioStudioJobIds]);

  useEffect(() => {
    const completedJobs = Object.values(audioStudioJobs)
      .map((state) => state?.job)
      .filter((job): job is QueuedContractJob => !!job && Boolean(job.jobId) && job.status === "completed");
    if (!completedJobs.length) return;

    for (const job of completedJobs) {
      if (persistedAudioStudioJobIdsRef.current.has(job.jobId)) continue;
      const audioStudioResult = audioStudioResultFromJob(job);
      if (!audioStudioResult) continue;

      persistedAudioStudioJobIdsRef.current.add(job.jobId);
      let attached = false;
      setScenes((previousScenes) =>
        previousScenes.map((scene) => {
          const rows = editClipRows(scene);
          const row = rows.find((candidate) => candidate.key === job.clipId);
          if (!row) return scene;

          const frameClips = editStageFrameClips(scene).slice();
          frameClips[row.index] = {
            ...(frameClips[row.index] || row.clip || { status: "idle" as const }),
            audioStudioResult,
          };
          attached = true;
          return {
            ...scene,
            frameClips,
          };
        })
      );

      if (attached && job.clipId) {
        void persistAudioStudioResultToServer(job.clipId, audioStudioResult, job.jobId);
      }
      setNotice(
        attached
          ? `Mock Audio Studio result retained on clip. Saving to clip record. Source job: ${job.jobId}.`
          : `Mock Audio Studio result ready, but matching clip was not found in the current storyboard draft. Source job: ${job.jobId}.`
      );
    }
  }, [audioStudioJobs]);

  useEffect(() => {
    if (!selectedScene) return;

    const stats = storyboardImageSyncStats(selectedScene);
    if (!stats.hasQueued || stats.complete) {
      if (stats.complete) {
        setStoryboardComfyProgress({
          ...emptyComfyProgressState(),
          running: false,
          readyToSync: false,
          percent: 100,
          label: "Storyboard images synced.",
          detail: "",
        });
      }
      return;
    }

    let cancelled = false;

    async function pollStoryboardProgress() {
      try {
        const res = await fetch("/api/progress", {
          cache: "no-store",
          credentials: "include",
        });

        const data = await res.json().catch(() => null);
        if (cancelled) return;

        if (!res.ok || !data) {
          setStoryboardComfyProgress({
            ...emptyComfyProgressState(),
            running: true,
            readyToSync: false,
            percent: null,
            label: "Generation submitted. Waiting for Comfy progress.",
            detail: "",
          });
          return;
        }

        setStoryboardComfyProgress(normalizeStoryboardProgressPayload(data));
      } catch {
        if (cancelled) return;
        setStoryboardComfyProgress({
          ...emptyComfyProgressState(),
          running: true,
          readyToSync: false,
          percent: null,
          label: "Generation submitted. Waiting for Comfy progress.",
          detail: "",
        });
      }
    }

    void pollStoryboardProgress();
    const timer = window.setInterval(() => void pollStoryboardProgress(), 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedScene?.id, selectedSceneStoryboardStatusKey, storyboardGenerationRunId]);

  useEffect(() => {
    if (activeStage !== "animate" || !selectedScene) return;

    const clips = animateFrameClips(selectedScene);
    const submittedClips = clips.filter((clip: any) => {
      const promptId = String(clip?.promptId || "").trim();
      return Boolean(promptId || clip?.status === "queued" || clip?.status === "ready");
    });
    const progressTargetClips = submittedClips.length ? submittedClips : clips;
    const promptIds = Array.from(new Set(progressTargetClips.map((clip: any) => String(clip?.promptId || "").trim()).filter(Boolean)));
    const readyCount = progressTargetClips.filter((clip: any) => clip?.status === "ready").length;

    if (!promptIds.length) {
      if (submittedClips.length && readyCount >= submittedClips.length) {
        setAnimateComfyProgress({
          ...emptyComfyProgressState(),
          readyToSync: false,
          percent: 100,
          label: "Scene clips synced.",
          completedPrompts: submittedClips.length,
          totalPrompts: submittedClips.length,
        });
      }
      return;
    }

    let cancelled = false;

    async function pollAnimateProgress() {
      try {
        const rows = await Promise.all(
          promptIds.map(async (promptId) => {
            const res = await fetch(`/api/progress?promptId=${encodeURIComponent(promptId)}`, {
              cache: "no-store",
              credentials: "include",
            });
            const data = await res.json().catch(() => null);
            return data ? { promptId, data, progress: normalizeStoryboardProgressPayload(data) } : null;
          })
        );
        if (cancelled) return;

        const validRows = rows.filter(Boolean) as Array<{ promptId: string; data: any; progress: ComfyProgressUiState }>;
        const totalPrompts = Math.max(
          promptIds.length,
          submittedClips.length,
          animateComfyProgress.totalPrompts || 0,
          1
        );
        const completedPromptsFromComfy = validRows.filter((row) => {
          const status = String(row.data?.status || "").toLowerCase();
          return status === "complete" || row.progress.readyToSync || row.progress.percent === 100;
        }).length;
        const completedPrompts = Math.max(readyCount, completedPromptsFromComfy);
        const runningRow = validRows.find((row) => row.progress.running) || validRows.find((row) => !row.progress.readyToSync);
        const runningPercent = Math.max(0, Math.min(100, runningRow?.progress.percent ?? 0));
        const aggregatePercent = totalPrompts > 0
          ? Math.max(0, Math.min(100, Math.round(((completedPrompts * 100) + (completedPrompts < totalPrompts ? runningPercent : 0)) / totalPrompts)))
          : null;

        setAnimateComfyProgress({
          ...(runningRow?.progress || emptyComfyProgressState()),
          running: completedPrompts < totalPrompts,
          readyToSync: completedPrompts >= totalPrompts,
          percent: aggregatePercent,
          label:
            completedPrompts >= totalPrompts
              ? "Comfy frame clips are complete. Run Sync Scene Clips."
              : `Generating frame clips from ComfyUI (${completedPrompts}/${totalPrompts} complete).`,
          detail: runningRow?.promptId || "",
          completedPrompts,
          totalPrompts,
        });
      } catch {
        if (!cancelled) {
          setAnimateComfyProgress((previous) => ({
            ...previous,
            running: true,
            label: "Frame clip jobs submitted. Waiting for Comfy progress.",
          }));
        }
      }
    }

    void pollAnimateProgress();
    const timer = window.setInterval(() => void pollAnimateProgress(), 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeStage, selectedScene?.id, selectedSceneAnimateStatusKey, animateGenerationRunId, animateComfyProgress.totalPrompts]);

  useEffect(() => {
    if (activeStage !== "edit" && activeStage !== "audio") return;

    let cancelled = false;

    async function loadProductionVoiceModels() {
      setProductionVoiceModelsLoading(true);
      setProductionVoiceModelsError("");
      try {
        const response = await fetch("/api/voice/models", {
          cache: "no-store",
          credentials: "include",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.ok === false) {
          throw new Error(data?.error || `Voice model scan failed (${response.status}).`);
        }

        const items = Array.isArray(data?.items) ? data.items : [];
        if (cancelled) return;
        setProductionVoiceModels(
          items.map((item: any) => ({
            id: String(item?.id || item?.path || item?.name || "").trim(),
            name: String(item?.name || item?.displayPath || "Voice").trim(),
            engine: (["seed-vc", "xtts", "reference", "character"].includes(String(item?.engine))
              ? String(item.engine)
              : "reference") as ProductionVoiceModelOption["engine"],
            path: String(item?.path || "").trim(),
            displayPath: item?.displayPath ? String(item.displayPath) : undefined,
            samplePath: item?.samplePath ? String(item.samplePath) : undefined,
            characterId: item?.characterId ? String(item.characterId) : undefined,
            usable: item?.usable !== false,
            notes: item?.notes ? String(item.notes) : undefined,
          })).filter((item: ProductionVoiceModelOption) => item.id)
        );
      } catch (error) {
        if (!cancelled) {
          setProductionVoiceModels([]);
          setProductionVoiceModelsError(error instanceof Error ? error.message : "Could not load voice models.");
        }
      } finally {
        if (!cancelled) setProductionVoiceModelsLoading(false);
      }
    }

    void loadProductionVoiceModels();

    return () => {
      cancelled = true;
    };
  }, [activeStage]);

  const readyScenes = scenes.filter((scene) => scene.status === "images_ready" || scene.status === "clip_ready" || scene.status === "edited" || scene.status === "complete").length;

  const totals = useMemo(
    () => ({
      duration: scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0),
      images: scenes.reduce((sum, scene) => sum + scene.imageCount, 0),
    }),
    [scenes]
  );

  const manifest = useMemo<ProductionManifest>(
    () => ({
      schemaVersion: 1,
      projectTitle: projectTitle.trim() || "Untitled Production",
      activeStage,
      selectedSceneId: selectedScene?.id || selectedSceneId || scenes[0]?.id || "",
      productionAnimateMode: "default",
      exportPreset,
      snapshots: productionSnapshots.slice(0, 12),
      updatedAt: new Date().toISOString(),
      scenes,
    }),
    [activeStage, exportPreset, productionAnimateMode, productionSnapshots, projectTitle, scenes, selectedScene?.id, selectedSceneId]
  );

  const manifestPreview = useMemo(() => JSON.stringify(manifest, null, 2), [manifest]);
  const manifestComparableSignature = useMemo(() => productionComparableSnapshotFromManifest(manifest), [manifest]);
  const hasUnsavedManualChanges = draftHydrated && manualSaveSignature !== manifestComparableSignature;
  const manualSaveStatusLabel = manualSavedAt && !hasUnsavedManualChanges ? "Project currently saved" : "Project not saved";

  function formatSaveTime(value: string) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
  }

  function productionComparableSnapshotFromManifest(value: ProductionManifest) {
    return JSON.stringify({ ...value, updatedAt: "" });
  }

  function productionComparableSnapshotFromRaw(snapshot: string) {
    try {
      const parsed = JSON.parse(snapshot) as ProductionManifest;
      return productionComparableSnapshotFromManifest(parsed);
    } catch {
      return snapshot;
    }
  }

  function productionSnapshotForStorage(stageOverride: ProductionStage = activeStage) {
    const savedAt = new Date().toISOString();
    const snapshotManifest: ProductionManifest = {
      ...manifest,
      activeStage: stageOverride,
      selectedSceneId: selectedScene?.id || selectedSceneId || scenes[0]?.id || "",
      updatedAt: savedAt,
      scenes,
    };

    return {
      savedAt,
      snapshot: JSON.stringify(snapshotManifest, null, 2),
    };
  }

  function autosaveProductionScenePatchV36BPU43(sceneId: string, patch: Partial<ProductionScene>, stageOverride: ProductionStage = activeStage) {
    if (typeof window === "undefined") return;

    try {
      const savedAt = new Date().toISOString();
      const nextScenes = scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene));
      const snapshotManifest: ProductionManifest = {
        ...manifest,
        activeStage: stageOverride,
        selectedSceneId: selectedScene?.id || selectedSceneId || nextScenes[0]?.id || "",
        updatedAt: savedAt,
        scenes: nextScenes,
      };
      const snapshot = JSON.stringify(snapshotManifest, null, 2);
      window.localStorage.setItem(PRODUCTION_AUTOSAVE_KEY, snapshot);
      window.localStorage.setItem(DRAFT_STORAGE_KEY, snapshot);
      setLastSavedAt(savedAt);
      setSaveState((current) => (current === "saved" ? "saved" : "autosaved"));
      const imageSlots = nextScenes.reduce((sum, scene) => sum + Number(scene?.imageCount || 0), 0);
      setSaveDetails(
        `Autosave: ${nextScenes.length} scene${nextScenes.length === 1 ? "" : "s"}, ${imageSlots} image slot${imageSlots === 1 ? "" : "s"}, page ${stages.findIndex((stage) => stage.id === stageOverride) + 1} of ${stages.length}.`
      );
    } catch {
      setSaveState("error");
      setSaveDetails("Autosave failed while preserving generated clip state.");
    }
  }

  function productionStoredSaveMeta(key: string) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<ProductionManifest>;
      if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) return null;
      return {
        raw,
        projectTitle: String(parsed.projectTitle || "Untitled Production"),
        savedAt: String(parsed.updatedAt || ""),
        activeStage: parsed.activeStage && stages.some((stage) => stage.id === parsed.activeStage) ? parsed.activeStage : "storyboard",
      };
    } catch {
      return null;
    }
  }

  function persistProductionDraftSnapshot(snapshot: string, savedAt: string, mode: "manual" | "auto") {
    const storageKey = mode === "manual" ? PRODUCTION_MANUAL_SAVE_KEY : PRODUCTION_AUTOSAVE_KEY;
    window.localStorage.setItem(storageKey, snapshot);

    // Keep the legacy draft key as an autosave compatibility mirror only.
    if (mode === "auto") {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, snapshot);
      setLastSavedAt(savedAt);
      setSaveState((current) => (current === "saved" ? "saved" : "autosaved"));
    } else {
      setManualSavedAt(savedAt);
      setManualSaveSignature(productionComparableSnapshotFromRaw(snapshot));
      setSaveState("saved");
    }

    setSaveDetails(
      `Autosave: ${scenes.length} scene${scenes.length === 1 ? "" : "s"}, ${totals.images} image slot${totals.images === 1 ? "" : "s"}, page ${stages.findIndex((stage) => stage.id === activeStage) + 1} of ${stages.length}.`
    );
  }

  function restoreProductionSnapshotFromStorage(snapshot: string, source: "manual" | "auto") {
    const parsed = JSON.parse(snapshot) as Partial<ProductionManifest>;
    if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
      throw new Error("Saved production data is empty or invalid.");
    }

    setProjectTitle(String(parsed.projectTitle || "Untitled Production"));
    setActiveStage(parsed.activeStage && stages.some((stage) => stage.id === parsed.activeStage) ? parsed.activeStage : "storyboard");
    // Director Mode is temporarily disabled; always restore Animate to Default Mode for now.
    setProductionAnimateMode("default");
    if (parsed.exportPreset && ["draft", "standard", "high_quality", "mobile", "youtube", "play_store_preview"].includes(parsed.exportPreset)) {
      setExportPreset(parsed.exportPreset);
    }
    if (Array.isArray(parsed.snapshots)) {
      setProductionSnapshots(parsed.snapshots.slice(0, 12) as ProductionSnapshot[]);
    }
    setScenes(parsed.scenes as ProductionScene[]);
    const restoredSceneId = parsed.selectedSceneId && parsed.scenes.some((scene) => scene.id === parsed.selectedSceneId)
      ? parsed.selectedSceneId
      : parsed.scenes[0]?.id || "";
    setSelectedSceneId(restoredSceneId);
    setMediaPreflight(null);
    setAssembleResult(null);
    setProductionHomeMode("pipeline");

    const restoredAt = String(parsed.updatedAt || "");
    if (source === "manual") {
      setManualSavedAt(restoredAt);
      setManualSaveSignature(productionComparableSnapshotFromRaw(snapshot));
      setSaveState("saved");
      setNotice(`Loaded manual save: ${String(parsed.projectTitle || "Untitled Production")}.`);
    } else {
      setLastSavedAt(restoredAt);
      setSaveState("autosaved");
      setNotice(`Continued from autosave: ${String(parsed.projectTitle || "Untitled Production")}.`);
    }

    setSaveDetails(
      `Autosave: ${parsed.scenes.length} scene${parsed.scenes.length === 1 ? "" : "s"}, ${parsed.scenes.reduce((sum, scene) => sum + Number(scene?.imageCount || 0), 0)} image slots, page ${stages.findIndex((stage) => stage.id === (parsed.activeStage || "storyboard")) + 1} of ${stages.length}.`
    );
  }

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);

      const manualMeta = productionStoredSaveMeta(PRODUCTION_MANUAL_SAVE_KEY);
      const autoMeta = productionStoredSaveMeta(PRODUCTION_AUTOSAVE_KEY) || productionStoredSaveMeta(DRAFT_STORAGE_KEY);

      if (manualMeta) {
        setProjectTitle(manualMeta.projectTitle);
        setManualSavedAt(manualMeta.savedAt);
        setManualSaveSignature(productionComparableSnapshotFromRaw(manualMeta.raw));
      } else if (autoMeta) {
        setProjectTitle(autoMeta.projectTitle);
      }

      if (autoMeta) {
        setLastSavedAt(autoMeta.savedAt);
        setSaveState("autosaved");
        setSaveDetails(`Autosave available from ${formatSaveTime(autoMeta.savedAt) || "a previous session"}.`);
      }
    } catch {
      setSaveState("error");
      setSaveDetails("Saved production metadata could not be loaded. Your current browser storage may be unavailable or corrupted.");
      setNotice("Saved production metadata could not be loaded.");
    } finally {
      setDraftHydrated(true);
    }
  }, []);

  useEffect(() => {
    // Autosave is intentionally triggered only by production step navigation.
    // This keeps autosave separate from the manual Save Project state.
  }, [draftHydrated]);

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Non-critical preference persistence only.
      }
      return next;
    });
  }

  async function toggleScenePromptMic(lineIndex: number) {
    if (recordingScenePromptIndex !== null) {
      scenePromptRecorderRef.current?.stop();
      return;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setNotice("Microphone recording is not available in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      scenePromptAudioChunksRef.current = [];
      scenePromptRecorderRef.current = recorder;
      setRecordingScenePromptIndex(lineIndex);
      setNotice(`Recording scene prompt ${lineIndex + 1}. Click the mic again to stop, or wait 10 seconds.`);

      recorder.ondataavailable = (event) => {
        if (event.data?.size) scenePromptAudioChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecordingScenePromptIndex(null);

        const audioBlob = new Blob(scenePromptAudioChunksRef.current, { type: "audio/webm" });
        scenePromptAudioChunksRef.current = [];

        if (!audioBlob.size) {
          setNotice("No microphone audio was captured.");
          return;
        }

        const endpoints = ["/api/whisper/transcribe", "/api/transcribe", "/api/voice/transcribe"];

        for (const endpoint of endpoints) {
          try {
            const body = new FormData();
            body.set("audio", audioBlob, `scene-prompt-${lineIndex + 1}.webm`);

            const response = await fetch(endpoint, {
              method: "POST",
              body,
              credentials: "include",
            });

            if (!response.ok) continue;

            const data = await response.json().catch(() => null);
            const transcript = String(data?.text || data?.transcript || data?.result || data?.segments?.map?.((segment: any) => segment?.text || "").join(" ") || "").trim();

            if (transcript) {
              const currentLines = scenePromptLines(selectedScene);
              const currentLine = String(currentLines[lineIndex] || "").trim();
              updateSelectedScenePromptLine(lineIndex, [currentLine, transcript].filter(Boolean).join(" "));
              setNotice(`Transcribed microphone audio into scene prompt ${lineIndex + 1}.`);
              return;
            }
          } catch {
            // Try the next known transcription route.
          }
        }

        setNotice("Microphone audio was recorded, but no Whisper transcription route responded. Connect this button to the app's Whisper endpoint.");
      };

      recorder.start();
      window.setTimeout(() => {
        if (scenePromptRecorderRef.current?.state === "recording") {
          scenePromptRecorderRef.current.stop();
        }
      }, 10000);
    } catch (error) {
      setRecordingScenePromptIndex(null);
      setNotice(error instanceof Error ? error.message : "Could not start microphone recording.");
    }
  }

  function updateSelectedScene(patch: Partial<ProductionScene>) {
    if (!selectedScene) return;
    setScenes((prev) => prev.map((scene) => (scene.id === selectedScene.id ? { ...scene, ...patch } : scene)));
  }

  function qwenSceneStringV36BPU3(...values: unknown[]) {
    for (const value of values) {
      const text = String(value || "").trim();
      if (text) return text;
    }
    return "";
  }

  function qwenSceneComfyViewProxyUrlV36BPU4(rawUrl: string) {
    const clean = String(rawUrl || "").trim();
    if (!clean) return "";

    try {
      const parsed = new URL(clean, typeof window !== "undefined" ? window.location.origin : "http://localhost");
      const filename = parsed.searchParams.get("filename") || parsed.searchParams.get("name") || "";
      if (!filename) return "";

      const type = parsed.searchParams.get("type") || "output";
      const subfolder = parsed.searchParams.get("subfolder") || "";

      const params = new URLSearchParams();
      params.set("filename", filename);
      params.set("type", type);
      if (subfolder) params.set("subfolder", subfolder);

      return `/api/comfy/view?${params.toString()}`;
    } catch {
      return "";
    }
  }

  function qwenScenePreviewUrlV36BPU3(value: unknown) {
    const clean = String(value || "").trim();
    if (!clean) return "";

    const proxiedComfyView = clean.includes("/view?") ? qwenSceneComfyViewProxyUrlV36BPU4(clean) : "";
    if (proxiedComfyView) return proxiedComfyView;

    if (/^https?:\/\//i.test(clean)) return clean;
    if (clean.startsWith("/view?")) {
      const proxiedRelativeView = qwenSceneComfyViewProxyUrlV36BPU4(clean);
      if (proxiedRelativeView) return proxiedRelativeView;
    }
    if (clean.startsWith("/api/comfy/view?") || clean.startsWith("/api/file?")) return clean;
    if (clean.startsWith("/")) return clean;

    if (/^[a-zA-Z]:[\\/]/.test(clean) || clean.startsWith("\\\\")) {
      return `/api/file?path=${encodeURIComponent(clean)}`;
    }

    if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(clean) && !/[\\/]/.test(clean)) {
      const params = new URLSearchParams();
      params.set("filename", clean);
      params.set("type", "output");
      return `/api/comfy/view?${params.toString()}`;
    }

    return clean;
  }

  function qwenSceneFileNameV36BPU3(value: unknown, fallback: string) {
    const clean = String(value || "").trim();
    if (!clean) return fallback;
    const withoutQuery = clean.split("?")[0] || clean;
    const normalized = withoutQuery.replace(/\\/g, "/");
    const last = normalized.split("/").filter(Boolean).pop() || fallback;
    return last.replace(/[^a-zA-Z0-9._-]+/g, "_") || fallback;
  }

  function loadCompletedQwenScenesForAnimateV36BPU3(): QwenCompletedSceneForAnimateV36BPU3[] {
    if (typeof window === "undefined") return [];

    try {
      const raw = window.localStorage.getItem(QWEN_SCENE_BUILDER_STORAGE_KEY_V36BPU3);
      if (!raw) return [];

      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];

      return parsed
        .map((item: any, index: number) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;

          const passes = Array.isArray(item.passes) ? item.passes : [];
          const lastCompletedPass = [...passes]
            .reverse()
            .find((pass: any) => pass?.resultImageUrl || pass?.resultWorkflowImage || pass?.status === "complete");

          const imageSource = qwenSceneStringV36BPU3(
            item.completedImageUrl,
            lastCompletedPass?.resultImageUrl,
            item.completedWorkflowImage,
            lastCompletedPass?.resultWorkflowImage,
            item.inputSceneImage
          );
          if (!imageSource) return null;

          const workflowImage = qwenSceneStringV36BPU3(
            item.completedWorkflowImage,
            lastCompletedPass?.resultWorkflowImage,
            item.completedImageUrl,
            lastCompletedPass?.resultImageUrl,
            item.inputSceneImage
          );

          return {
            id: qwenSceneStringV36BPU3(item.id, `qwen-scene-${index + 1}`),
            name: qwenSceneStringV36BPU3(item.name, `Scene ${index + 1}`),
            sourceIndex: index,
            url: repoCachedComfyImageUrlV36BPU29(qwenScenePreviewUrlV36BPU3(imageSource)),
            workflowImage,
          } satisfies QwenCompletedSceneForAnimateV36BPU3;
        })
        .filter((item): item is QwenCompletedSceneForAnimateV36BPU3 => Boolean(item?.url))
        .slice(0, MAX_SCENE_IMAGE_COUNT);
    } catch {
      return [];
    }
  }

  function qwenSceneHandoffSignatureV36BPU3(scenesForAnimate: QwenCompletedSceneForAnimateV36BPU3[]) {
    return scenesForAnimate
      .map((scene) => `${scene.id}:${scene.name}:${scene.url}:${scene.workflowImage}`)
      .join("|") + "|scene-by-scene-v36bpu7";
  }

  function qwenSceneImagesForAnimateV36BPU3(scenesForAnimate: QwenCompletedSceneForAnimateV36BPU3[]): StoryboardImage[] {
    return scenesForAnimate.map((scene, index) => ({
      id: `qwen-animate-frame-${index + 1}`,
      promptId: `qwen-scene-${index + 1}`,
      prompt: scene.name,
      status: "ready",
      approved: true,
      url: scene.url,
      fileName: qwenSceneFileNameV36BPU3(scene.workflowImage || scene.url, `qwen_scene_${index + 1}.png`),
      imageUrl: scene.url,
      imagePath: scene.workflowImage || scene.url,
      workflowImage: repoCachedComfyImageUrlV36BPU29(scene.workflowImage || scene.url),
      source: QWEN_ANIMATE_HANDOFF_SOURCE_V36BPU3,
      qwenSceneId: scene.id,
      qwenSceneName: scene.name,
      qwenSceneIndex: scene.sourceIndex,
    } as unknown as StoryboardImage));
  }

  function qwenSceneAnimationDraftsForAnimateV36BPU3(
    scenesForAnimate: QwenCompletedSceneForAnimateV36BPU3[],
    existingDrafts: ProductionFrameAnimation[]
  ): ProductionFrameAnimation[] {
    return scenesForAnimate.map((scene, index) => {
      const existing = existingDrafts[index] || {};

      // V36BPU13: Qwen handoff refresh must not erase manual first-frame/last-frame pairing.
      const existingTimelineRole = existing.timelineRole || "normal";
      const existingIsConsumedLastFrame = existingTimelineRole === "last_frame_for" && existing.consumedByFrameIndex !== undefined;
      const existingIsFirstLastFrame = existing.animationMode === "first_last_frame" && existing.lastFrameIndex !== undefined;
      const existingIsReferenceVideo = existing.animationMode === "reference_to_video_gguf";

      return {
        ...existing,
        prompt: preserveAnimateManualPromptSpacingV36BPU22(existing.prompt ?? ""),
        durationSeconds: clampAnimateFrameDuration(existing.durationSeconds ?? defaultAnimateFrameDuration(selectedScene)),
        characterRefIds: existing.characterRefIds || [],
        loras: normalizeProductionLoras(existing.loras),
        voiceActorInput: existing.voiceActorInput || { enabled: false, saved: false },
        queueForGeneration: existingIsConsumedLastFrame ? existing.queueForGeneration === true : existing.queueForGeneration !== false,
        animationMode: existingIsFirstLastFrame ? "first_last_frame" : existingIsReferenceVideo ? existing.animationMode : "image_to_video",
        firstFrameIndex: existingIsFirstLastFrame ? existing.firstFrameIndex ?? index : undefined,
        lastFrameIndex: existingIsFirstLastFrame ? existing.lastFrameIndex : undefined,
        promptSourceFrameIndex: existing.promptSourceFrameIndex ?? (existingIsFirstLastFrame ? index : undefined),
        timelineRole: existingTimelineRole,
        consumedByFrameIndex: existingIsConsumedLastFrame ? existing.consumedByFrameIndex : undefined,
        consumedLastFrameIndex: existingIsFirstLastFrame ? existing.consumedLastFrameIndex ?? existing.lastFrameIndex : undefined,
        keepAsSeparateSceneAfterPairing: existing.keepAsSeparateSceneAfterPairing ?? false,
      } as ProductionFrameAnimation;
    });
  }

  function qwenSceneFrameClipsForAnimateV36BPU3(
    scenesForAnimate: QwenCompletedSceneForAnimateV36BPU3[],
    existingClips: ProductionFrameClip[]
  ): ProductionFrameClip[] {
    return scenesForAnimate.map((_scene, index) => ({
      ...(existingClips[index] || {}),
      status: existingClips[index]?.status || "idle",
      sourceFrameIndex: index,
    } as ProductionFrameClip));
  }

  function syncCompletedQwenScenesToAnimateV36BPU3(options?: { silent?: boolean }) {
    if (!selectedScene) return 0;

    const completedScenes = loadCompletedQwenScenesForAnimateV36BPU3();
    if (!completedScenes.length) {
      if (!options?.silent) {
        setNotice("No completed Qwen storyboard scenes found. Complete at least one scene in Storyboard first.");
      }
      return 0;
    }

    const images = qwenSceneImagesForAnimateV36BPU3(completedScenes);
    const existingDrafts = animateFrameDrafts(selectedScene);
    const existingClips = animateFrameClips(selectedScene);
    const animationFrames = qwenSceneAnimationDraftsForAnimateV36BPU3(completedScenes, existingDrafts);
    const frameClips = qwenSceneFrameClipsForAnimateV36BPU3(completedScenes, existingClips);
    const outputClipCount = completedScenes.length;
    const signature = qwenSceneHandoffSignatureV36BPU3(completedScenes);

    updateSceneById(selectedScene.id, {
      imageCount: completedScenes.length,
      images,
      animationFrames,
      frameClips,
      prompt: completedScenes.map((scene, index) => `Scene ${index + 1}: ${scene.name}`).join("\n"),
      motionNotes: [
        `Qwen storyboard handoff: ${completedScenes.length} completed scene image(s).`,
        `${outputClipCount} scene-by-scene image-to-video clip(s) queued by default.`,
        "Pair adjacent scenes manually when a first-frame/last-frame transition is needed.",
      ].filter(Boolean).join(" "),
      qwenAnimateHandoffSourceV36BPU3: QWEN_ANIMATE_HANDOFF_SOURCE_V36BPU3,
      qwenAnimateHandoffSignatureV36BPU3: signature,
      qwenAnimateHandoffUpdatedAtV36BPU3: new Date().toISOString(),
    } as any);

    if (!options?.silent) {
      setNotice(
        `Synced ${completedScenes.length} completed storyboard scene image(s) into Animate as ${outputClipCount} scene clip(s). Pair adjacent scenes manually for first-frame/last-frame.`
      );
    }

    return completedScenes.length;
  }


  function focusAnimateSceneEditorV36BPU6(index: number) {
    if (typeof document === "undefined") return;

    const safeIndexV36BPU10B = Math.max(0, Math.floor(Number(index) || 0));
    setActiveAnimateSceneIndexV36BPU10B(safeIndexV36BPU10B);
    index = safeIndexV36BPU10B;

    const selector = `[data-otg-animate-scene-editor="${index}"]`;
    const openEditor = () => {
      const details = document.querySelector(selector) as HTMLDetailsElement | null;
      if (!details) return false;
      details.open = true;
      details.scrollIntoView({ behavior: "smooth", block: "start" });
      return true;
    };

    if (openEditor()) return;

    const synced = syncCompletedQwenScenesToAnimateV36BPU3({ silent: false });
    if (!synced) {
      setNotice(`Scene ${index + 1} editor is not available yet. Sync storyboard scenes first.`);
      return;
    }

    let attemptsV36BPU12 = 0;
    const retryOpenV36BPU12 = () => {
      attemptsV36BPU12 += 1;
      if (openEditor()) return;
      if (attemptsV36BPU12 >= 12) {
        setNotice(`Scene ${index + 1} editor is still not available. Wait for the scene list to refresh, then click it again.`);
        return;
      }
      window.setTimeout(retryOpenV36BPU12, 150);
    };
    window.setTimeout(retryOpenV36BPU12, 150);
  }

  function renderQwenAnimateHandoffSummaryV36BPU3(
    completedScenes: QwenCompletedSceneForAnimateV36BPU3[],
    pairCount: number,
    outputClipCount: number
  ) {
    if (!completedScenes.length) {
      return (
        <div className="mt-4 rounded-[14px] border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
          No completed Qwen storyboard scenes are available for Animate yet. Complete scenes in Storyboard, then return here.
        </div>
      );
    }

    const drafts = selectedScene ? animateFrameDrafts(selectedScene) : [];

    return (
      <div className="mt-4 rounded-[14px] border border-violet-300/20 bg-violet-300/10 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-violet-100/80">Storyboard scene handoff</p>
            <h3 className="mt-1 text-lg font-black text-white">
              {completedScenes.length} storyboard scene(s) - {pairCount} manual first/last pair(s) - {outputClipCount || completedScenes.length} output clip(s)
            </h3>
            <p className="mt-1 text-xs leading-5 text-white/60">
              Each storyboard image is its own scene clip by default. Click a scene card to open its editor below. Pair a scene with the adjacent next scene only when you want first-frame/last-frame output.
            </p>
          </div>
          <button
            type="button"
            disabled={!selectedScene || Boolean(busySceneId)}
            onClick={() => syncCompletedQwenScenesToAnimateV36BPU3({ silent: false })}
            className="rounded-[12px] border border-violet-200/40 bg-violet-300/15 px-4 py-3 text-sm font-black text-violet-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Sync Storyboard Scenes
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {completedScenes.map((scene, index) => {
            const draft = drafts[index] || {};
            const isConsumedLastFrame = isAnimateLastFrameConsumed(draft);
            const isFirstLastFrame = draft.animationMode === "first_last_frame" && draft.lastFrameIndex === index + 1;
            const isReferenceVideo = draft.animationMode === "reference_to_video_gguf";
            const badge = isReferenceVideo
              ? "Reference-to-video GGUF scene"
              : isFirstLastFrame
                ? `Scene ${index + 1} -> Scene ${index + 2}`
                : isConsumedLastFrame
                  ? `Last frame for Scene ${Number(draft.consumedByFrameIndex) + 1}`
                  : "Image-to-video scene";

            return (
              <button
                key={`${scene.id}-${index}`}
                type="button"
                onClick={() => focusAnimateSceneEditorV36BPU6(index)}
                className={isConsumedLastFrame ? "overflow-hidden rounded-[12px] border border-purple-300/30 bg-purple-950/30 text-left opacity-80" : "overflow-hidden rounded-[12px] border border-white/10 bg-black/25 text-left transition hover:border-cyan-300/50"}
              >
                <div className="relative aspect-video bg-black">
                  <img src={scene.url} alt={scene.name} className="h-full w-full object-cover" />
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[10px] font-black text-white">
                    Scene {index + 1}
                  </span>
                  <span className={isFirstLastFrame ? "absolute bottom-2 left-2 rounded-full bg-violet-300/90 px-2 py-1 text-[10px] font-black text-slate-950" : isConsumedLastFrame ? "absolute bottom-2 left-2 rounded-full bg-purple-300/90 px-2 py-1 text-[10px] font-black text-slate-950" : "absolute bottom-2 left-2 rounded-full bg-emerald-300/90 px-2 py-1 text-[10px] font-black text-slate-950"}>
                    {badge}
                  </span>
                </div>
                <div className="p-2 text-xs text-white/70">
                  <div className="truncate font-black text-white">{scene.name}</div>
                  <div className="truncate text-white/40">{scene.workflowImage || scene.url}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // PRODUCTION_STORYBOARD_MAIN_LAYOUT_TWEAKS_V2_PATCH
  // PRODUCTION_STORYBOARD_MAIN_LAYOUT_TWEAKS_V7_PATCH
  

// OTG V36BO4B: count selected background as one of the three Qwen image references.
function otgReferenceHasImageV36BO4B(value: any): boolean {
  if (!value) return false;
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.some((item) => otgReferenceHasImageV36BO4B(item));
  if (typeof value !== "object") return false;

  const imageKeys = [
    "fileName",
    "previewUrl",
    "workflowImage",
    "workflowImagePath",
    "workflowImageUrl",
    "sourceWorkflowImageV36AF",
    "plateWorkflowImageV36AF",
    "sourceDisplayImageV36AF",
    "displayImage",
    "imagePath",
    "imageUrl",
    "backgroundImage",
    "backgroundImagePath",
    "backgroundWorkflowImage",
    "backgroundWorkflowImagePath",
    "selectedBackgroundId",
    "backgroundId",
  ];

  return imageKeys.some((key) => {
    const raw = value?.[key];
    return typeof raw === "string" ? Boolean(raw.trim()) : Boolean(raw);
  });
}

function otgSceneHasBackgroundReferenceV36BO4B(scene: any): boolean {
  if (!scene || typeof scene !== "object") return false;

  const directKeys = [
    "backgroundReference",
    "backgroundRef",
    "selectedBackground",
    "background",
    "backgroundImage",
    "backgroundImagePath",
    "backgroundWorkflowImage",
    "backgroundWorkflowImagePath",
    "backgroundPreviewUrl",
    "backgroundName",
    "storyboardBackgroundReference",
    "storyboardBackgroundReferenceV36AK",
  ];

  if (directKeys.some((key) => otgReferenceHasImageV36BO4B(scene?.[key]))) return true;

  const refs = Array.isArray(scene?.characterRefs) ? scene.characterRefs : [];
  return refs.some((ref: any) => {
    const label = `${ref?.label || ""} ${ref?.sourceCharacterName || ""}`.toLowerCase();
    return label.includes("bg:") || label.includes("background");
  });
}

function selectedSceneReferenceCountV36BO4B(scene: ProductionScene | null | undefined) {
  const characterCount = createCharacterSlots(scene?.characterRefs)
    .filter((ref) => {
      const label = `${ref?.label || ""} ${ref?.sourceCharacterName || ""}`.toLowerCase();
      const isBackgroundChip = label.includes("bg:") || label.includes("background");
      if (isBackgroundChip) return false;
      return Boolean(ref?.fileName || ref?.previewUrl || ref?.sourceCharacterId || ref?.referenceAudioPath);
    })
    .length;

  const backgroundCount = otgSceneHasBackgroundReferenceV36BO4B(scene) ? 1 : 0;
  return Math.min(CHARACTER_REFERENCE_SLOTS, characterCount + backgroundCount);
}

function visibleCharacterReferenceSlotCount(scene: ProductionScene | null | undefined) {
  const usedCount = (scene?.characterRefs || []).filter((ref) => {
    const maybeRef = ref as CharacterReference & { imagePath?: string; workflowImagePath?: string; workflowImageUrl?: string };
    return Boolean(
      ref?.previewUrl ||
        ref?.fileName ||
        ref?.sourceCharacterId ||
        ref?.referenceAudioPath ||
        maybeRef?.imagePath ||
        maybeRef?.workflowImagePath ||
        maybeRef?.workflowImageUrl
    );
  }).length;

  const requestedCount = Math.max(1, Number(scene?.characterRefSlotCount || 1) || 1);
  return Math.min(CHARACTER_REFERENCE_SLOTS, Math.max(1, requestedCount, usedCount));
}

  function addCharacterReferenceSlot() {
    if (!selectedScene) return;

    const nextCount = Math.min(
      CHARACTER_REFERENCE_SLOTS,
      selectedSceneReferenceCountV36BO4D(selectedScene) + 1
    );

    updateSelectedScene({ characterRefSlotCount: nextCount });
  }

  function clampStoryboardDuration(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_SCENE_DURATION_SECONDS;
    return Math.max(1, Math.min(MAX_SCENE_DURATION_SECONDS, Math.round(value)));
  }

  
function clampStoryboardImageCount(value: unknown) {
  const numeric = Math.floor(Number(value));
  if (!Number.isFinite(numeric)) return DEFAULT_SCENE_IMAGE_COUNT;
  return Math.max(1, Math.min(MAX_SCENE_IMAGE_COUNT, numeric));
}

  function normalizePromptLine(line: string) {
    // Preserve live textarea whitespace. Do not trim here or the spacebar appears broken.
    return String(line || "").replace(/^\s*next\s+scene\s*\d*\s*:\s*/i, "");
  }

  
// OTG V36BO4C: prompt parsing and reference counting for Qwen next-scene builder.
function otgCleanScenePromptTextV36BO4C(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^Next Scene(?:\s+\d+)?\s*[:;]\s*/i, "")
    .trim();
}

function otgReferenceHasImageV36BO4C(value: any): boolean {
  if (!value) return false;
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.some((item) => otgReferenceHasImageV36BO4C(item));
  if (typeof value !== "object") return false;

  const imageKeys = [
    "fileName",
    "previewUrl",
    "workflowImage",
    "workflowImagePath",
    "workflowImageUrl",
    "sourceWorkflowImageV36AF",
    "plateWorkflowImageV36AF",
    "sourceDisplayImageV36AF",
    "displayImage",
    "imagePath",
    "imageUrl",
    "backgroundImage",
    "backgroundImagePath",
    "backgroundWorkflowImage",
    "backgroundWorkflowImagePath",
    "selectedBackgroundId",
    "backgroundId",
  ];

  return imageKeys.some((key) => {
    const raw = value?.[key];
    return typeof raw === "string" ? Boolean(raw.trim()) : Boolean(raw);
  });
}

function otgSceneHasBackgroundReferenceV36BO4C(scene: any): boolean {
  if (!scene || typeof scene !== "object") return false;

  const directKeys = [
    "backgroundReference",
    "backgroundRef",
    "selectedBackground",
    "background",
    "backgroundImage",
    "backgroundImagePath",
    "backgroundWorkflowImage",
    "backgroundWorkflowImagePath",
    "backgroundPreviewUrl",
    "backgroundName",
    "storyboardBackgroundReference",
    "storyboardBackgroundReferenceV36AK",
  ];

  if (directKeys.some((key) => otgReferenceHasImageV36BO4C(scene?.[key]))) return true;

  const refs = Array.isArray(scene?.characterRefs) ? scene.characterRefs : [];
  return refs.some((ref: any) => {
    const label = `${ref?.label || ""} ${ref?.sourceCharacterName || ""}`.toLowerCase();
    return label.includes("bg:") || label.includes("background");
  });
}

function selectedSceneReferenceCountV36BO4C(scene: ProductionScene | null | undefined) {
  const characterCount = createCharacterSlots(scene?.characterRefs)
    .filter((ref) => {
      const label = `${ref?.label || ""} ${ref?.sourceCharacterName || ""}`.toLowerCase();
      const isBackgroundChip = label.includes("bg:") || label.includes("background");
      if (isBackgroundChip) return false;
      return Boolean(ref?.fileName || ref?.previewUrl || ref?.sourceCharacterId || ref?.referenceAudioPath);
    })
    .length;

  const backgroundCount = otgSceneHasBackgroundReferenceV36BO4C(scene) ? 1 : 0;
  return Math.min(CHARACTER_REFERENCE_SLOTS, characterCount + backgroundCount);
}



// OTG V36BO4D: repair prompt parsing and reference counting for Qwen next-scene builder.
function otgCleanScenePromptTextV36BO4D(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^Next Scene(?:\s+\d+)?\s*[:;]\s*/i, "")
    .trim();
}

function selectedSceneReferenceCountV36BO4D(scene: ProductionScene | null | undefined) {
  const refs = createCharacterSlots(scene?.characterRefs);
  let backgroundCount = 0;
  let nonBackgroundCount = 0;

  for (const ref of refs) {
    const label = `${ref?.label || ""} ${ref?.sourceCharacterName || ""}`.toLowerCase();
    const hasImage = Boolean(ref?.fileName || ref?.previewUrl || ref?.sourceCharacterId || ref?.referenceAudioPath);
    if (!hasImage) continue;

    if (label.includes("bg:") || label.includes("background")) backgroundCount = 1;
    else nonBackgroundCount += 1;
  }

  const directBackground = Boolean(
    (scene as any)?.backgroundReference ||
      (scene as any)?.backgroundRef ||
      (scene as any)?.selectedBackground ||
      (scene as any)?.background ||
      (scene as any)?.backgroundImage ||
      (scene as any)?.backgroundImagePath ||
      (scene as any)?.backgroundWorkflowImage ||
      (scene as any)?.backgroundWorkflowImagePath ||
      (scene as any)?.storyboardBackgroundReference ||
      (scene as any)?.storyboardBackgroundReferenceV36AK
  );

  if (directBackground) backgroundCount = 1;
  return Math.min(CHARACTER_REFERENCE_SLOTS, nonBackgroundCount + backgroundCount);
}



function scenePromptLines(scene: ProductionScene | null | undefined, countOverride?: number) {
  const count = clampStoryboardImageCount(countOverride ?? scene?.imageCount ?? DEFAULT_SCENE_IMAGE_COUNT);
  const lines = Array.from({ length: count }, () => "");
  const raw = String(scene?.prompt || "").replace(/\r\n/g, "\n").trim();

  if (!raw) return lines;

  const rawLines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let wroteExplicitLine = false;

  for (const line of rawLines) {
    const numbered = line.match(/^Next Scene\s+(\d+)\s*[:;]\s*(.*)$/i);
    if (numbered) {
      const index = Math.max(0, Math.min(count - 1, Number(numbered[1]) - 1));
      lines[index] = otgCleanScenePromptTextV36BO4D(numbered[2]);
      wroteExplicitLine = true;
      continue;
    }

    const unnumbered = line.match(/^Next Scene\s*[:;]\s*(.*)$/i);
    if (unnumbered) {
      const cleaned = otgCleanScenePromptTextV36BO4D(unnumbered[1]);
      lines[0] = [lines[0], cleaned].filter(Boolean).join(" ").trim();
      wroteExplicitLine = true;
      continue;
    }

    if (count === 1 || !wroteExplicitLine) {
      lines[0] = [lines[0], otgCleanScenePromptTextV36BO4D(line)].filter(Boolean).join(" ").trim();
    }
  }

  return lines.map((line) => normalizePromptLine(line));
}


  // OTG_STORYBOARD_RAW_PROMPT_EDIT_V36AM
  function storyboardEditablePromptLineV36AM(value: unknown): string {
    return String(value ?? "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((part) => part.replace(/^\s*Next\s+Scene(?:\s+\d+)?\s*:\s*/i, ""))
      .join("\n");
  }

  // OTG_STORYBOARD_SPACE_TYPING_FIX_V36AN
  function storyboardRawPromptStorageV36AN(lines: string[]): string {
    return lines
      .map((line) => String(line ?? "").replace(/\r\n/g, "\n"))
      .join("\n");
  }

  function storyboardCompiledPromptForDisplayV36AM(scene: ProductionScene): string {
    return buildCompiledScenePrompt(scenePromptLines(scene));
  }
  



function buildCompiledScenePrompt(lines: string[]) {
  const cleaned = lines
    .map((line) => otgCleanScenePromptTextV36BO4D(line))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return `Next Scene: ${cleaned || "continue the scene"}`;
}

  function makeFreshProductionScene(index: number): ProductionScene {
    const base = initialScenes[index] || initialScenes[0] || selectedScene || scenes[0];

    return {
      ...base,
      id: `scene_${Date.now()}_${index + 1}_${Math.random().toString(36).slice(2, 7)}`,
      title: `Scene ${index + 1}`,
      durationSeconds: DEFAULT_SCENE_DURATION_SECONDS,
      imageCount: DEFAULT_SCENE_IMAGE_COUNT,
      aspectRatio: "16:9",
      prompt: "",
      motionNotes: "",
      status: "pending_images" as SceneStatus,
      images: [],
      characterRefs: createCharacterSlots([]),
    characterRefSlotCount: 1,
};
  }

  function handleNewProduction() {
    const nextTitle = window.prompt("Please enter project name", "");

    if (nextTitle === null) return;

    const cleanTitle = nextTitle.trim();
    if (!cleanTitle) {
      setNotice("Project name is required before starting a new production.");
      return;
    }

    const firstScene = makeFreshProductionScene(0);

    setProjectTitle(cleanTitle);
    setActiveStage("storyboard");
    setScenes([firstScene]);
    setSelectedSceneId(firstScene.id);
    setCharacterFiles({});
    setLockedSceneNameIds({});
    setLockedCharacterNameKeys({});
    setExportPreset("standard");
    setProductionSnapshots([]);
    setMediaPreflight(null);
    setAssembleResult(null);
    setManualSavedAt("");
    setManualSaveSignature("");
    setLastSavedAt("");
    setSaveState("idle");
    setSaveDetails("Autosave will start when you move to the next or previous production step.");
    setProductionHomeMode("pipeline");
    setNotice(`New production created: ${cleanTitle}.`);
  }

  function addSceneLimited() {
    if (scenes.length >= MAX_PRODUCTION_SCENES) {
      setNotice(`Maximum ${MAX_PRODUCTION_SCENES} scenes reached.`);
      return;
    }

    const nextScene = makeFreshProductionScene(scenes.length);
    setScenes((prev) => [...prev, nextScene]);
    setSelectedSceneId(nextScene.id);
    setNotice(`Added ${nextScene.title}.`);
  }

  function updateSelectedSceneDuration(value: number) {
    updateSelectedScene({ durationSeconds: clampStoryboardDuration(value) });
  }

  function updateSelectedSceneImageCount(value: number) {
    if (!selectedScene) return;

    const nextCount = clampStoryboardImageCount(value);
    const currentLines = scenePromptLines(selectedScene, nextCount);

    updateSelectedScene({
      imageCount: nextCount,
      prompt: storyboardRawPromptStorageV36AN(currentLines),
    });
  }

  function updateSelectedScenePromptLine(lineIndex: number, value: string) {
    if (!selectedScene) return;

    const lines = scenePromptLines(selectedScene);
    lines[lineIndex] = storyboardEditablePromptLineV36AM(value);

    updateSelectedScene({
      prompt: storyboardRawPromptStorageV36AN(lines),
    });
  }

  function updateCharacterReference(sceneId: string, slotIndex: number, patch: Partial<CharacterReference>) {
    setScenes((prev) =>
      prev.map((scene) => {
        if (scene.id !== sceneId) return scene;
        const refs = createCharacterSlots(scene.characterRefs);
        refs[slotIndex] = { ...refs[slotIndex], ...patch };
        return { ...scene, characterRefs: refs };
      })
    );
  }

  function setCharacterReferenceFile(sceneId: string, slotIndex: number, file: File | null) {
    if (!file) {
      setCharacterFiles((prev) => {
        const sceneFiles = { ...(prev[sceneId] || {}) };
        delete sceneFiles[slotIndex];
        return { ...prev, [sceneId]: sceneFiles };
      });
      updateCharacterReference(sceneId, slotIndex, {
        fileName: undefined,
        previewUrl: undefined,
        workflowImagePath: undefined,
        sourceCharacterId: undefined,
        sourceCharacterName: undefined,
        referenceAudioPath: undefined,
      });
      return;
    }

    setCharacterFiles((prev) => ({
      ...prev,
      [sceneId]: {
        ...(prev[sceneId] || {}),
        [slotIndex]: file,
      },
    }));
    updateCharacterReference(sceneId, slotIndex, {
      fileName: file.name,
      previewUrl: URL.createObjectURL(file),
    });
  }

  function removeCharacterReferenceSlot(sceneId: string, slotIndex: number) {
    const scene = scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const visibleCount = visibleCharacterReferenceSlotCount(scene);

    if (visibleCount <= 1) {
      setCharacterReferenceFile(sceneId, slotIndex, null);
      setNotice("Cleared the character reference.");
      return;
    }

    setCharacterFiles((prev) => {
      const current = prev[sceneId] || {};
      const nextSceneFiles: Record<number, File> = {};
      Object.entries(current).forEach(([rawIndex, file]) => {
        const index = Number(rawIndex);
        if (!Number.isFinite(index) || index === slotIndex) return;
        nextSceneFiles[index > slotIndex ? index - 1 : index] = file;
      });
      return { ...prev, [sceneId]: nextSceneFiles };
    });

    setScenes((prev) =>
      prev.map((item) => {
        if (item.id !== sceneId) return item;
        const refs: CharacterReference[] = createCharacterSlots(item.characterRefs);
        refs.splice(slotIndex, 1);
        refs.push({
          id: `character_${CHARACTER_REFERENCE_SLOTS}`,
          label: `Character ${CHARACTER_REFERENCE_SLOTS}`,
          fileName: undefined,
          previewUrl: undefined,
          sourceCharacterId: undefined,
          sourceCharacterName: undefined,
          referenceAudioPath: undefined,
        });
        return {
          ...item,
          characterRefs: createCharacterSlots(refs),
          characterRefSlotCount: Math.max(1, visibleCount - 1),
        };
      })
    );
    setNotice(`Removed character reference ${slotIndex + 1}.`);
  }

  function clearAllCharacterReferences(sceneId: string) {
    const scene = scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const hasCharacters = createCharacterSlots(scene.characterRefs).some((ref) => ref.fileName || ref.previewUrl || ref.sourceCharacterId || ref.referenceAudioPath);
    if (!hasCharacters) {
      setNotice("There are no character & background references to clear.");
      return;
    }
    if (!window.confirm("Clear all character & background references for this scene?")) return;

    setCharacterFiles((prev) => {
      const next = { ...prev };
      delete next[sceneId];
      return next;
    });
    setScenes((prev) =>
      prev.map((item) =>
        item.id === sceneId
          ? {
              ...item,
              characterRefs: createCharacterSlots([]),
              characterRefSlotCount: 1,
            }
          : item
      )
    );
    setNotice("Cleared all character & background references for this scene.");
  }

  function characterReferenceSlotLabel(slotIndex: number) {
    return `Character ${slotIndex + 1}`;
  }

  function characterReferenceLockKey(sceneId: string, slotIndex: number, ref?: CharacterReference) {
    return `${sceneId}:${slotIndex}:${ref?.id || `character_${slotIndex + 1}`}`;
  }

  function saveSceneName(scene: ProductionScene) {
    const cleanTitle = String(scene.title || "").trim() || scene.title || "Scene";
    updateSceneById(scene.id, { title: cleanTitle });
    setLockedSceneNameIds((previous) => ({ ...previous, [scene.id]: true }));
    setNotice(`Saved scene name: ${cleanTitle}.`);
  }

  function changeSceneName(sceneId: string) {
    setLockedSceneNameIds((previous) => ({ ...previous, [sceneId]: false }));
    setNotice("Scene name unlocked. Edit it, then click Save Name again.");
  }

  function saveCharacterReferenceName(sceneId: string, slotIndex: number, ref: CharacterReference) {
    const cleanLabel = String(ref.label || ref.sourceCharacterName || characterReferenceSlotLabel(slotIndex)).trim() || characterReferenceSlotLabel(slotIndex);
    updateCharacterReference(sceneId, slotIndex, { label: cleanLabel });
    setLockedCharacterNameKeys((previous) => ({ ...previous, [characterReferenceLockKey(sceneId, slotIndex, ref)]: true }));
    setNotice(`Saved character reference name: ${cleanLabel}.`);
  }

  function changeCharacterReferenceName(sceneId: string, slotIndex: number, ref: CharacterReference) {
    setLockedCharacterNameKeys((previous) => ({ ...previous, [characterReferenceLockKey(sceneId, slotIndex, ref)]: false }));
    setNotice("Character name unlocked. Edit it, then click Save again.");
  }

  function characterLibraryImageUrl(imagePath: string) {
    return `/api/file?path=${encodeURIComponent(imagePath)}`;
  }

  function characterLibraryFileName(item: CharacterLibraryPickerItem, mime: string) {
    const ext = mime.includes("jpeg")
      ? "jpg"
      : mime.includes("webp")
        ? "webp"
        : mime.includes("gif")
          ? "gif"
          : "png";

    const base =
      String(item.name || item.imagePath || "character")
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-z0-9_-]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80) || "character";

    return `${base}.${ext}`;
  }

  function characterLibraryDescriptionV36BPU26B(entry: any) {
    const metadata = entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
    const identity = (metadata as any).characterIdentity && typeof (metadata as any).characterIdentity === "object" ? (metadata as any).characterIdentity : {};

    return String(
      entry?.globalPromptIdentityBlock ||
        entry?.description ||
        entry?.completeDescription ||
        entry?.lockedCompleteDescription ||
        entry?.characterDescription ||
        entry?.promptBlock ||
        entry?.identityBlock ||
        (metadata as any).promptReadyDescription ||
        (metadata as any).completeDescription ||
        (metadata as any).lockedCompleteDescription ||
        (metadata as any).identityBlock ||
        (identity as any).promptReadyDescription ||
        (identity as any).description ||
        entry?.name ||
        "",
    ).trim();
  }

  function normalizeCharacterLibraryItemsForAnimateV36BPU26B(data: any): CharacterLibraryPickerItem[] {
    const raw: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.characters)
        ? data.characters
        : Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data?.data)
            ? data.data
            : [];

    const seen = new Set<string>();

    return raw
      .map((entry: any, index: number) => {
        const imagePath = String(
          entry?.defaultCharacterPreviewImagePath ||
            entry?.defaultCharacterImagePath ||
            entry?.backgroundRemovedDefaultImagePath ||
            entry?.previewImagePath ||
            entry?.imagePath ||
            entry?.transparentImagePath ||
            "",
        ).trim();
        const workflowImagePath = String(
          entry?.characterCardWorkflowImagePath ||
            entry?.characterCardPath ||
            entry?.workflowImagePath ||
            entry?.workflowImage ||
            entry?.defaultCharacterImagePath ||
            entry?.imagePath ||
            "",
        ).trim();
        const name = String(entry?.name || entry?.title || entry?.label || `Character ${index + 1}`).trim();
        const id = String(entry?.id || imagePath || workflowImagePath || name || index).trim();
        const imageUrl = imagePath ? characterLibraryImageUrl(imagePath) : "";
        const workflowImageUrl = workflowImagePath ? characterLibraryImageUrl(workflowImagePath) : imageUrl;
        const key = id.toLowerCase();

        if (!id || seen.has(key) || (!imageUrl && !workflowImageUrl)) return null;
        seen.add(key);

        return {
          id,
          name,
          imagePath,
          imageUrl,
          workflowImagePath,
          workflowImageUrl,
          referenceAudioPath: entry?.referenceAudioPath ? String(entry.referenceAudioPath) : undefined,
          description: characterLibraryDescriptionV36BPU26B(entry),
        } as CharacterLibraryPickerItem;
      })
      .filter((item): item is CharacterLibraryPickerItem => Boolean(item))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  }

  async function loadAnimateSavedCharacterPresetsV36BPU26B() {
    if (animateCharacterPresetLoadingV36BPU26B) return;

    setAnimateCharacterPresetLoadingV36BPU26B(true);
    setAnimateCharacterPresetErrorV36BPU26B("");

    try {
      const response = await fetch("/api/characters", {
        cache: "no-store",
        credentials: "include",
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : `Could not load characters (${response.status}).`);
      }

      const items = normalizeCharacterLibraryItemsForAnimateV36BPU26B(data);
      setAnimateSavedCharacterPresetsV36BPU26B(items);
      if (!items.length) setAnimateCharacterPresetErrorV36BPU26B("No saved character presets with usable images were found.");
    } catch (error) {
      setAnimateSavedCharacterPresetsV36BPU26B([]);
      setAnimateCharacterPresetErrorV36BPU26B(error instanceof Error ? error.message : "Could not load saved character presets.");
    } finally {
      setAnimateCharacterPresetLoadingV36BPU26B(false);
    }
  }

  async function loadCharacterPickerItems() {
    setCharacterPickerLoading(true);
    setCharacterPickerError("");

    try {
      const res = await fetch("/api/characters", {
        cache: "no-store",
        credentials: "include",
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : `Could not load characters (${res.status}).`);
      }

      const raw: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.characters)
          ? data.characters
          : Array.isArray(data?.items)
            ? data.items
            : Array.isArray(data?.data)
              ? data.data
              : [];

      const seen = new Set<string>();

      const items: CharacterLibraryPickerItem[] = raw
        .map((entry: any, index: number) => {
          const imagePath = String(entry?.productionReferenceImagePath || entry?.backgroundRemovedImagePath || entry?.previewImagePath || entry?.fullBodyImagePath || entry?.imagePath || "").trim();
          const workflowImagePath = String(entry?.characterCardPath || entry?.cardImagePath || imagePath).trim();
          const name = String(entry?.name || entry?.title || entry?.label || `Character ${index + 1}`).trim();

          return {
            id: String(entry?.id || imagePath || name || index),
            name,
            imagePath,
            imageUrl: imagePath ? characterLibraryImageUrl(imagePath) : "",
            workflowImagePath,
            workflowImageUrl: workflowImagePath ? characterLibraryImageUrl(workflowImagePath) : "",
            referenceAudioPath: entry?.referenceAudioPath ? String(entry.referenceAudioPath) : undefined,
          };
        })
        .filter((item) => {
          if (!item.imagePath || !item.imageUrl || !item.workflowImagePath || !item.workflowImageUrl) return false;
          if (seen.has(item.workflowImagePath)) return false;
          seen.add(item.workflowImagePath);
          return true;
        });

      setCharacterPickerItems(items);

      if (!items.length) {
        setCharacterPickerError("No saved characters with images were found.");
      }
    } catch (error) {
      setCharacterPickerItems([]);
      setCharacterPickerError(error instanceof Error ? error.message : "Could not load saved characters.");
    } finally {
      setCharacterPickerLoading(false);
    }
  }

  function openCharacterPicker(sceneId: string, slotIndex: number) {
    setCharacterPickerSceneId(sceneId);
    setCharacterPickerSlotIndex(slotIndex);
    setCharacterPickerSelectingId("");
    setCharacterPickerError("");
    void loadCharacterPickerItems();
  }

  function closeCharacterPicker() {
    setCharacterPickerSceneId("");
    setCharacterPickerSlotIndex(null);
    setCharacterPickerSelectingId("");
    setCharacterPickerError("");
  }

  async function applyCharacterPickerItem(item: CharacterLibraryPickerItem) {
    if (!characterPickerSceneId || characterPickerSlotIndex === null || !item.workflowImageUrl) return;

    setCharacterPickerSelectingId(item.id);
    setCharacterPickerError("");

    try {
      const res = await fetch(item.workflowImageUrl, {

        cache: "no-store",
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(`Could not load character image (${res.status}).`);
      }

      const blob = await res.blob();

      if (!String(blob.type || "").startsWith("image/")) {
        throw new Error("Selected character file is not an image.");
      }

      const mime = blob.type || "image/png";
      const file = new File([blob], characterLibraryFileName(item, mime), { type: mime });

      setCharacterReferenceFile(characterPickerSceneId, characterPickerSlotIndex, file);
      updateCharacterReference(characterPickerSceneId, characterPickerSlotIndex, {
        fileName: file.name,
        previewUrl: item.imageUrl,
        workflowImagePath: item.workflowImagePath,
        sourceCharacterId: item.id,
        sourceCharacterName: item.name,
        referenceAudioPath: item.referenceAudioPath,
      });
      setNotice(`${item.name} selected for ${characterReferenceSlotLabel(characterPickerSlotIndex)}.`);
      closeCharacterPicker();
    } catch (error) {
      setCharacterPickerError(error instanceof Error ? error.message : "Could not select character.");
    } finally {
      setCharacterPickerSelectingId("");
    }
  }


  function updateSceneById(sceneId: string, patch: Partial<ProductionScene>) {
    setScenes((prev) => prev.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)));
  }

  function updateSceneImage(sceneId: string, imageIndex: number, patch: Partial<StoryboardImage>) {
    setScenes((prev) =>
      prev.map((scene) => {
        if (scene.id !== sceneId) return scene;
        const images = Array.from({ length: scene.imageCount }, (_, index) => {
          const current = scene.images[index] || {
            id: `${scene.id}_img_${index + 1}`,
            approved: false,
          };
          return index === imageIndex ? { ...current, ...patch } : current;
        });
        const readyCount = images.filter((image) => image.status === "ready" || image.approved).length;
        return {
          ...scene,
          status: readyCount >= scene.imageCount ? "images_ready" : "pending_images",
          images,
        };
      })
    );
  }

  function clearStoryboardImageSlot(sceneId: string, imageIndex: number) {
    setScenes((prev) =>
      prev.map((scene) => {
        if (scene.id !== sceneId) return scene;
        const images = Array.from({ length: scene.imageCount }, (_, index) => {
          if (index !== imageIndex) return scene.images[index];
          return {
            id: `${scene.id}_img_${index + 1}`,
            approved: false,
          } as StoryboardImage;
        });
        const readyCount = images.filter((image) => image?.status === "ready" || image?.approved).length;
        return {
          ...scene,
          status: readyCount >= scene.imageCount ? "images_ready" : "pending_images",
          images,
        };
      })
    );
    if (expandedStoryboardImageIndex === imageIndex) setExpandedStoryboardImageIndex(null);
    setNotice(`Cleared scene image ${imageIndex + 1}.`);
  }

  function clearAllStoryboardImages(sceneId: string) {
    const scene = scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const hasImages = scene.images.some((image) => storyboardImageHasContent(image) || image?.status === "queued" || image?.status === "error");
    if (!hasImages) {
      setNotice("There are no scene pass preview to clear.");
      return;
    }
    if (!window.confirm("Clear all scene pass preview for this scene? Prompt text will stay in place.")) return;

    setScenes((prev) =>
      prev.map((item) =>
        item.id === sceneId
          ? {
              ...item,
              status: "pending_images",
              images: Array.from({ length: item.imageCount }, (_, index) => ({
                id: `${item.id}_img_${index + 1}`,
                approved: false,
              })),
            }
          : item
      )
    );
    setExpandedStoryboardImageIndex(null);
    setNotice("Cleared all scene pass preview for this scene. Prompt text was kept.");
  }

  // OTG_PRODUCTION_STORYBOARD_SLOT_UPLOAD_V1
  function storyboardImageHasContent(image: StoryboardImage | undefined | null) {
    return Boolean(
      image &&
        (image.status === "ready" ||
          image.approved ||
          String(image.url || "").trim() ||
          String(image.fileName || "").trim())
    );
  }

  function storyboardSlotGenerationTargets(scene: ProductionScene | null | undefined) {
    if (!scene) return [] as StoryboardGenerationTarget[];

    const imageCount = clampStoryboardImageCount(scene.imageCount);
    const promptLines = scenePromptLines(scene, imageCount);
    const targets: StoryboardGenerationTarget[] = [];

    for (let index = 0; index < imageCount; index += 1) {
      const image = scene.images[index];
      const prompt = String(promptLines[index] || "").trim();
      if (!prompt) continue;

      if (image?.source === "uploaded" && String(image.uploadedPath || "").trim()) {
        targets.push({
          index,
          prompt,
          mode: "edit_uploaded",
          uploadedPath: String(image.uploadedPath || "").trim(),
        });
        continue;
      }

      if (!storyboardImageHasContent(image) || image?.status === "error") {
        targets.push({
          index,
          prompt,
          mode: "generate",
        });
      }
    }

    return targets;
  }

  async function uploadStoryboardImageSlot(sceneId: string, imageIndex: number, file: File | null | undefined) {
    if (!file) return;

    if (!String(file.type || "").startsWith("image/")) {
      setNotice("Upload an image file for storyboard slots.");
      return;
    }

    updateSceneImage(sceneId, imageIndex, {
      status: "queued",
      approved: false,
      fileName: file.name,
      error: undefined,
      source: "uploaded",
    });

    try {
      const form = new FormData();
      form.set("image", file, file.name);

      const response = await fetch("/api/storyboard/upload", {
        method: "POST",
        body: form,
        credentials: "include",
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(String(data?.error || `Upload failed (${response.status}).`));
      }

      const serverPath = String(data?.serverPath || "").trim();
      const filename = String(data?.filename || file.name || "").trim();
      if (!serverPath) {
        throw new Error("Upload did not return a server file path.");
      }

      updateSceneImage(sceneId, imageIndex, {
        status: "ready",
        approved: true,
        promptId: undefined,
        fileName: filename,
        url: `/api/file?path=${encodeURIComponent(serverPath)}&v=${Date.now()}`,
        error: undefined,
        source: "uploaded",
        uploadedPath: serverPath,
        editingUploadedSource: false,
      });
      setNotice(`Uploaded image into storyboard slot ${imageIndex + 1}. Add prompt text in that slot to edit it, or leave it blank to skip it.`);
    } catch (error) {
      updateSceneImage(sceneId, imageIndex, {
        status: "error",
        approved: false,
        error: error instanceof Error ? error.message : "Upload failed.",
        source: "uploaded",
        editingUploadedSource: false,
      });
      setNotice(error instanceof Error ? error.message : "Upload failed.");
    }
  }

  // OTG_PRODUCTION_STORYBOARD_IMAGE_EXPAND_V1
  function renderExpandedStoryboardImageModal(scene: ProductionScene | null | undefined) {
    const expandedIndex = typeof expandedStoryboardImageIndex === "number" ? expandedStoryboardImageIndex : -1;
    if (!scene || expandedIndex < 0) return null;

    const imageRows = Array.from({ length: clampStoryboardImageCount(scene.imageCount) }, (_, index) => {
      const image = scene.images[index];
      const url = String(image?.url || "").trim();
      return {
        index,
        image,
        url,
        fileName: String(image?.fileName || "").trim(),
        status: image?.status || (image?.approved ? "ready" : "empty"),
      };
    }).filter((row) => row.url);

    const row = imageRows.find((candidate) => candidate.index === expandedIndex) || null;
    if (!row) return null;

    const currentPosition = imageRows.findIndex((candidate) => candidate.index === row.index);
    const previousIndex = currentPosition > 0 ? imageRows[currentPosition - 1].index : null;
    const nextIndex = currentPosition >= 0 && currentPosition < imageRows.length - 1 ? imageRows[currentPosition + 1].index : null;
    const promptText = scenePromptLines(scene)[row.index] || "";

    return (
      <div
        className="fixed inset-0 z-[90] grid place-items-center bg-black/80 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Expanded scene image preview"
        onClick={() => setExpandedStoryboardImageIndex(null)}
      >
        <div
          className="w-full max-w-6xl overflow-hidden rounded-[22px] border border-white/15 bg-slate-950 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex flex-col gap-3 border-b border-white/10 bg-white/[0.04] p-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-200/75">Storyboard Image</p>
              <h3 className="mt-1 truncate text-xl font-black text-white">{scene.title} - Image {row.index + 1}</h3>
              <p className="mt-1 truncate text-xs text-white/45">{row.fileName || (row.image?.source === "uploaded" ? "Uploaded image" : "Generated image")}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={previousIndex === null}
                onClick={() => {
                  if (previousIndex !== null) setExpandedStoryboardImageIndex(previousIndex);
                }}
                className="rounded-[12px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={nextIndex === null}
                onClick={() => {
                  if (nextIndex !== null) setExpandedStoryboardImageIndex(nextIndex);
                }}
                className="rounded-[12px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                Next
              </button>
              <a
                href={row.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-[12px] border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100"
              >
                Open File
              </a>
              <button
                type="button"
                onClick={() => setExpandedStoryboardImageIndex(null)}
                className="rounded-[12px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-white"
              >
                Close
              </button>
            </div>
          </div>

          <div className="grid max-h-[72vh] place-items-center bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={row.url} alt={`${scene.title} scene image ${row.index + 1}`} className="max-h-[72vh] w-full object-contain" />
          </div>

          <div className="grid gap-3 border-t border-white/10 bg-white/[0.03] p-4 text-xs text-white/60 md:grid-cols-4">
            <div>
              <span className="block text-white/35">Slot</span>
              <span className="font-black text-white">Image {row.index + 1} of {scene.imageCount}</span>
            </div>
            <div>
              <span className="block text-white/35">Status</span>
              <span className="font-black text-emerald-200">{row.image?.source === "uploaded" ? "Uploaded" : row.status}</span>
            </div>
            <div>
              <span className="block text-white/35">Filename</span>
              <span className="break-all">{row.fileName || "none"}</span>
            </div>
            <div>
              <span className="block text-white/35">Prompt</span>
              <span className="line-clamp-3">{promptText || "No prompt line"}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function addScene() {
    const nextIndex = scenes.length;
    const next: ProductionScene = {
      id: `scene_${String(nextIndex + 1).padStart(3, "0")}`,
      title: `Scene ${sceneNumber(nextIndex)}`,
      durationSeconds: 2,
      imageCount: 8,
      aspectRatio: "16:9",
      prompt: "",
      motionNotes: "",
      style: selectedScene?.style || "Cinematic Fantasy",
      status: "not_started",
      images: [],
    };
    setScenes((prev) => [...prev, next]);
    setSelectedSceneId(next.id);
  }

  function duplicateScene() {
    if (!selectedScene) return;
    const nextIndex = scenes.length;
    const copy: ProductionScene = {
      ...selectedScene,
      id: `scene_${String(nextIndex + 1).padStart(3, "0")}`,
      title: `${selectedScene.title} Copy`,
      status: "not_started",
      images: [],
    };
    setScenes((prev) => [...prev, copy]);
    setSelectedSceneId(copy.id);
  }

  function deleteScene() {
    if (!selectedScene || scenes.length <= 1) return;
    const nextScenes = scenes.filter((scene) => scene.id !== selectedScene.id);
    setScenes(nextScenes);
    setSelectedSceneId(nextScenes[0]?.id || "");
  }

  function saveDraft() {
    try {
      const { snapshot, savedAt } = productionSnapshotForStorage(activeStage);
      persistProductionDraftSnapshot(snapshot, savedAt, "manual");
      setNotice("Save complete. Project currently saved.");
    } catch (error) {
      setSaveState("error");
      setSaveDetails(error instanceof Error ? error.message : "Could not save project.");
      setNotice(error instanceof Error ? error.message : "Could not save draft.");
    }
  }

  function autosaveProductionStep(nextStage: ProductionStage) {
    try {
      const { snapshot, savedAt } = productionSnapshotForStorage(nextStage);
      persistProductionDraftSnapshot(snapshot, savedAt, "auto");
    } catch (error) {
      setSaveState("error");
      setSaveDetails(error instanceof Error ? error.message : "Autosave failed. Use Save Project and check browser storage.");
    }
  }

  function transitionProductionStage(nextStage: ProductionStage) {
    if (nextStage === activeStage) return;
    autosaveProductionStep(nextStage);
    setActiveStage(nextStage);
  }

  function handleBackToProductionHome() {
    if (hasUnsavedManualChanges) {
      const saveFirst = window.confirm(
        "Your project has changes that have not been manually saved. Click OK to save before returning home, or Cancel to return without a manual save. Autosave will still be available through Continue."
      );
      if (saveFirst) saveDraft();
    }
    setProductionHomeMode("home");
  }

  function continueFromAutosave() {
    try {
      const autoMeta = productionStoredSaveMeta(PRODUCTION_AUTOSAVE_KEY) || productionStoredSaveMeta(DRAFT_STORAGE_KEY);
      if (!autoMeta) {
        setNotice("No autosave is available yet. Start a new production or load a manual save.");
        return;
      }
      restoreProductionSnapshotFromStorage(autoMeta.raw, "auto");
    } catch (error) {
      setSaveState("error");
      setNotice(error instanceof Error ? error.message : "Could not continue from autosave.");
    }
  }

  function loadManualProduction() {
    try {
      const manualMeta = productionStoredSaveMeta(PRODUCTION_MANUAL_SAVE_KEY);
      if (!manualMeta) {
        setNotice("No manual save is available yet. Use Save Project inside the production pipeline first.");
        return;
      }

      const autoMeta = productionStoredSaveMeta(PRODUCTION_AUTOSAVE_KEY) || productionStoredSaveMeta(DRAFT_STORAGE_KEY);
      const autoTime = autoMeta?.savedAt ? new Date(autoMeta.savedAt).getTime() : 0;
      const manualTime = manualMeta.savedAt ? new Date(manualMeta.savedAt).getTime() : 0;

      if (autoTime > manualTime) {
        const continueManual = window.confirm(
          "The autosave for this project is more current than the last manual save. Loading this project will open the last manually saved version instead. Click OK to load the manual save, or Cancel and use Continue to open the autosave."
        );
        if (!continueManual) return;
      }

      restoreProductionSnapshotFromStorage(manualMeta.raw, "manual");
    } catch (error) {
      setSaveState("error");
      setNotice(error instanceof Error ? error.message : "Could not load manual save.");
    }
  }

  function resetDraft() {
    setProjectTitle("Untitled Production");
    setActiveStage("storyboard");
    setScenes(initialScenes);
    setSelectedSceneId(initialScenes[0]?.id || "");
    setExportPreset("standard");
    setProductionSnapshots([]);
    setMediaPreflight(null);
    setAssembleResult(null);
    setManualSavedAt("");
    setManualSaveSignature("");
    setSaveState("idle");
    setLastSavedAt("");
    setSaveDetails("Project was reset manually. Autosave will start when you move between production steps.");
    setNotice("Storyboard reset to the default draft.");
  }

  function loadCrystalDeerExample() {
    setProjectTitle("Crystal Deer Hunt Test");
    setActiveStage("storyboard");
    setScenes([crystalDeerScene]);
    setSelectedSceneId(crystalDeerScene.id);
    setNotice("Loaded the 15 second Crystal Deer test scene.");
  }

  // PRODUCTION_SINGLE_SCENE_JOB_PATCH
  async function submitStoryboardScene(
    scene: ProductionScene,
    sceneCharacterFiles: Record<number, File>,
    options: { sourceImagePath?: string } = {}
  ) {
    const prompt = otgCleanNextScenePromptForWorkflowV36BO4(scene.prompt);
    const { width, height } = aspectToSize(scene.aspectRatio);
    const body = new FormData();

    body.set("workflowId", STORYBOARD_IMAGE_WORKFLOW_ID);
    body.set("preset", STORYBOARD_IMAGE_WORKFLOW_ID);
    body.set("workflowLabel", "Qwen 2511 Storyboard Scene");
    body.set("title", `${projectTitle.trim() || "Production"} - ${scene.title}`);
    body.set("requestKind", "production-storyboard-scene");
    body.set("prompt", prompt);
    body.set("positivePrompt", prompt);
    body.set("scenePrompt", prompt);
    body.set("otgNextScenePromptV36BO4D", prompt);
    body.set("otgCompiledPromptV36BO4D", prompt);
    body.set("otgNextScenePromptV36BO4C", prompt);
    body.set("otgCompiledPromptV36BO4C", prompt);
    body.set("otgNextScenePromptV36BO4", prompt);
    body.set("otgCompiledPromptV36BO4", prompt);
    body.set("negativePrompt", "low quality, blurry, distorted anatomy, extra limbs, text, watermark, subtitles, logo, UI overlay");
    body.set("orientation", aspectToOrientation(scene.aspectRatio));
    body.set("width", String(width));
    body.set("height", String(height));
    body.set("seedMode", "random");
    body.set("sceneImageCount", String(clampStoryboardImageCount(scene.imageCount)));

    const sourceImagePath = String(options.sourceImagePath || "").trim();
    const sourceImageFileName = sourceImagePath.split(/[\\/]/).pop()?.toLowerCase() || "";
    if (sourceImagePath) {
      body.set("imageAPath", sourceImagePath);
    }

    Array.from({ length: CHARACTER_REFERENCE_SLOTS }, (_, index) => sceneCharacterFiles[index])
      .filter((file): file is File => Boolean(file && (!sourceImageFileName || file.name.toLowerCase() !== sourceImageFileName)))
      .slice(0, sourceImagePath ? CHARACTER_REFERENCE_SLOTS - 1 : CHARACTER_REFERENCE_SLOTS)
      .forEach((file, index) => {
        const slotIndex = sourceImagePath ? index + 1 : index;
        const key = ["imageA", "imageB", "imageC", "imageD", "imageE"][slotIndex];
        if (key) {
          body.set(key, file, file.name);
        }
      });

    const res = await fetch("/api/comfy", {
      method: "POST",
      body,
      credentials: "include",
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.error || data?.response?.error || `Scene job failed (${res.status})`);
    }

    const promptId = String(data?.prompt_id || data?.promptId || "").trim();
    if (!promptId) throw new Error("Comfy did not return a prompt id.");

    return promptId;
  }

  // OTG_STORYBOARD_STABLE_CARD_REFERENCE_IMAGES_V36AZ3
  // Storyboard production workflows must receive stable app/file references only.
  // Browser preview URLs such as blob:, data:, and filesystem: cannot be read by the server or ComfyUI.
  // Character references prefer saved character-card workflow images.
  // Background references prefer stitched background plate workflow images.
  function storyboardIsBrowserOnlyWorkflowImageV36AZ3(value: unknown) {
    const text = String(value || "").trim();

    return (
      !text ||
      /^blob:/i.test(text) ||
      /^data:/i.test(text) ||
      /^filesystem:/i.test(text)
    );
  }

  function storyboardCleanWorkflowImageCandidateV36AZ3(value: unknown) {
    const text = String(value || "").trim();

    if (storyboardIsBrowserOnlyWorkflowImageV36AZ3(text)) {
      return "";
    }

    return text;
  }

  function storyboardReferenceMatchesV36AZ3(left: any, right: any) {
    const leftId = String(left?.id || "").trim();
    const rightId = String(right?.id || "").trim();

    if (leftId && rightId && leftId === rightId) return true;

    const leftSlotId = String(left?.slotId || "").trim();
    const rightSlotId = String(right?.slotId || "").trim();

    if (leftSlotId && rightSlotId && leftSlotId === rightSlotId) return true;

    const leftName = String(left?.name || left?.label || left?.title || "").trim().toLowerCase();
    const rightName = String(right?.name || right?.label || right?.title || "").trim().toLowerCase();

    if (leftName && rightName && leftName === rightName) return true;

    return false;
  }

  function storyboardFirstStableWorkflowImageV36AZ3(values: unknown[]) {
    for (const value of values) {
      const cleaned = storyboardCleanWorkflowImageCandidateV36AZ3(value);
      if (cleaned) return cleaned;
    }

    return "";
  }

  function storyboardFindRegistryReferenceV36AZ3(reference: any): any {
    const selected = reference || {};
    const pool = Array.isArray(sceneReferencePoolV32) ? sceneReferencePoolV32 : [];

    return pool.find((candidate: any) => storyboardReferenceMatchesV36AZ3(selected, candidate)) || null;
  }

  function storyboardFindSavedBackgroundReferenceV36AZ3(reference: any): any {
    const selected = reference || {};
    const savedBackgrounds = Array.isArray(storyboardBackgroundReferencesV36AK)
      ? storyboardBackgroundReferencesV36AK
      : [];

    return (
      savedBackgrounds.find((candidate: any) => storyboardReferenceMatchesV36AZ3(selected, candidate)) ||
      (storyboardBackgroundReferenceV30 && storyboardReferenceMatchesV36AZ3(selected, storyboardBackgroundReferenceV30)
        ? storyboardBackgroundReferenceV30
        : null)
    );
  }

  function storyboardStableWorkflowImageForReferenceV36AZ3(reference: any) {
    const selected = reference || {};
    const registry = storyboardFindRegistryReferenceV36AZ3(selected) as any;
    const kind = String(selected.kind || selected.sourceType || registry?.kind || registry?.sourceType || "").toLowerCase();
    const isBackground = kind === "background";

    if (isBackground) {
      const savedBackground = storyboardFindSavedBackgroundReferenceV36AZ3(selected) as any;

      return storyboardFirstStableWorkflowImageV36AZ3([
        savedBackground?.plateWorkflowImageV36AF,
        savedBackground?.workflowImage,
        selected.plateWorkflowImageV36AF,
        selected.workflowImage,
        registry?.plateWorkflowImageV36AF,
        registry?.workflowImage,
        savedBackground?.sourceWorkflowImageV36AF,
        selected.sourceWorkflowImageV36AF,
        savedBackground?.imagePath,
        savedBackground?.imageUrl,
        selected.imagePath,
        selected.imageUrl,
        registry?.imagePath,
        registry?.imageUrl,
      ]);
    }

    return storyboardFirstStableWorkflowImageV36AZ3([
      registry?.workflowImage,
      registry?.cardWorkflowImage,
      registry?.characterWorkflowImage,
      registry?.sourceWorkflowImage,
      registry?.sourceImagePath,
      registry?.imagePath,
      registry?.imageUrl,
      selected.workflowImage,
      selected.cardWorkflowImage,
      selected.characterWorkflowImage,
      selected.sourceWorkflowImage,
      selected.sourceImagePath,
      selected.imagePath,
      selected.imageUrl,
      registry?.displayImage,
      selected.displayImage,
    ]);
  }

  function storyboardStableWorkflowImagesForPayloadV36AZ3(referencePayload: StoryboardPromptReferencePayloadV35) {
    const selectedReferences = Array.isArray(referencePayload?.selectedReferences)
      ? referencePayload.selectedReferences
      : [];

    const stableFromSelected = selectedReferences
      .map((reference) => storyboardStableWorkflowImageForReferenceV36AZ3(reference))
      .filter(Boolean);

    const stableFallback = Array.isArray(referencePayload?.workflowImages)
      ? referencePayload.workflowImages
          .map((value) => storyboardCleanWorkflowImageCandidateV36AZ3(value))
          .filter(Boolean)
      : [];

    const combined: string[] = [];
    const seen = new Set<string>();

    for (const value of [...stableFromSelected, ...stableFallback]) {
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(value);
    }

    return combined.slice(0, 3);
  }

  // OTG_STORYBOARD_IMPORT_BROWSER_BLOB_REFERENCES_V36BB
  // Converts browser-only reference URLs into stable server-side files before /api/production/picture.
  // blob:/data:/filesystem: URLs are valid only inside the browser tab; ComfyUI and the backend cannot read them.
  function storyboardIsBrowserOnlyWorkflowImageV36BB(value: unknown) {
    const text = String(value || "").trim();

    return (
      /^blob:/i.test(text) ||
      /^data:/i.test(text) ||
      /^filesystem:/i.test(text)
    );
  }

  function storyboardCleanWorkflowImageCandidateV36BB(value: unknown) {
    const text = String(value || "").trim();

    if (!text || storyboardIsBrowserOnlyWorkflowImageV36BB(text)) {
      return "";
    }

    return text;
  }

  function storyboardReferenceMatchesV36BB(left: any, right: any) {
    const leftId = String(left?.id || "").trim();
    const rightId = String(right?.id || "").trim();

    if (leftId && rightId && leftId === rightId) return true;

    const leftSlotId = String(left?.slotId || "").trim();
    const rightSlotId = String(right?.slotId || "").trim();

    if (leftSlotId && rightSlotId && leftSlotId === rightSlotId) return true;

    const leftName = String(left?.name || left?.label || left?.title || "").trim().toLowerCase();
    const rightName = String(right?.name || right?.label || right?.title || "").trim().toLowerCase();

    return Boolean(leftName && rightName && leftName === rightName);
  }

  function storyboardFirstStableWorkflowImageV36BB(values: unknown[]) {
    for (const value of values) {
      const cleaned = storyboardCleanWorkflowImageCandidateV36BB(value);
      if (cleaned) return cleaned;
    }

    return "";
  }

  function storyboardFirstBrowserOnlyWorkflowImageV36BB(values: unknown[]) {
    for (const value of values) {
      const text = String(value || "").trim();

      if (storyboardIsBrowserOnlyWorkflowImageV36BB(text)) {
        return text;
      }
    }

    return "";
  }

  function storyboardFindRegistryReferenceV36BB(reference: any): any {
    const selected = reference || {};
    const pool = Array.isArray(sceneReferencePoolV32) ? sceneReferencePoolV32 : [];

    return pool.find((candidate: any) => storyboardReferenceMatchesV36BB(selected, candidate)) || null;
  }

  function storyboardFindSavedBackgroundReferenceV36BB(reference: any): any {
    const selected = reference || {};
    const savedBackgrounds = Array.isArray(storyboardBackgroundReferencesV36AK)
      ? storyboardBackgroundReferencesV36AK
      : [];

    return (
      savedBackgrounds.find((candidate: any) => storyboardReferenceMatchesV36BB(selected, candidate)) ||
      (storyboardBackgroundReferenceV30 && storyboardReferenceMatchesV36BB(selected, storyboardBackgroundReferenceV30)
        ? storyboardBackgroundReferenceV30
        : null)
    );
  }

  function storyboardStableWorkflowImageForReferenceV36BB(reference: any) {
    const selected = reference || {};
    const registry = storyboardFindRegistryReferenceV36BB(selected) as any;
    const kind = String(selected.kind || selected.sourceType || registry?.kind || registry?.sourceType || "").toLowerCase();
    const isBackground = kind === "background";

    if (isBackground) {
      const savedBackground = storyboardFindSavedBackgroundReferenceV36BB(selected) as any;

      return storyboardFirstStableWorkflowImageV36BB([
        savedBackground?.plateWorkflowImageV36AF,
        savedBackground?.workflowImage,
        selected.plateWorkflowImageV36AF,
        selected.workflowImage,
        registry?.plateWorkflowImageV36AF,
        registry?.workflowImage,
        savedBackground?.sourceWorkflowImageV36AF,
        selected.sourceWorkflowImageV36AF,
        savedBackground?.imagePath,
        savedBackground?.imageUrl,
        selected.imagePath,
        selected.imageUrl,
        registry?.imagePath,
        registry?.imageUrl,
      ]);
    }

    return storyboardFirstStableWorkflowImageV36BB([
      registry?.workflowImage,
      registry?.cardWorkflowImage,
      registry?.characterWorkflowImage,
      registry?.sourceWorkflowImage,
      registry?.sourceImagePath,
      registry?.imagePath,
      registry?.imageUrl,
      selected.workflowImage,
      selected.cardWorkflowImage,
      selected.characterWorkflowImage,
      selected.sourceWorkflowImage,
      selected.sourceImagePath,
      selected.imagePath,
      selected.imageUrl,
    ]);
  }

  function storyboardBrowserOnlyImageForReferenceV36BB(reference: any) {
    const selected = reference || {};
    const registry = storyboardFindRegistryReferenceV36BB(selected) as any;

    return storyboardFirstBrowserOnlyWorkflowImageV36BB([
      selected.workflowImage,
      selected.cardWorkflowImage,
      selected.characterWorkflowImage,
      selected.sourceWorkflowImage,
      selected.sourceImagePath,
      selected.imagePath,
      selected.imageUrl,
      selected.displayImage,
      registry?.workflowImage,
      registry?.cardWorkflowImage,
      registry?.characterWorkflowImage,
      registry?.sourceWorkflowImage,
      registry?.sourceImagePath,
      registry?.imagePath,
      registry?.imageUrl,
      registry?.displayImage,
    ]);
  }

  async function storyboardImportBrowserOnlyReferenceImageV36BB(source: string, promptKey: string, label: string) {
    const sourceUrl = String(source || "").trim();

    if (!storyboardIsBrowserOnlyWorkflowImageV36BB(sourceUrl)) {
      return "";
    }

    const blobResponse = await fetch(sourceUrl);

    if (!blobResponse.ok) {
      throw new Error(`Could not read browser reference image ${label}.`);
    }

    const blob = await blobResponse.blob();

    if (!blob || !blob.size) {
      throw new Error(`Browser reference image ${label} was empty.`);
    }

    const form = new FormData();
    const safeLabel = String(label || "reference").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "reference";
    const extension = blob.type.includes("jpeg") || blob.type.includes("jpg") ? "jpg" : blob.type.includes("webp") ? "webp" : "png";

    form.set("image", blob, `${safeLabel}.${extension}`);
    form.set("promptKey", promptKey);
    form.set("label", safeLabel);

    const response = await fetch("/api/storyboard/import-reference", {
      method: "POST",
      body: form,
      credentials: "include",
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.ok) {
      throw new Error(String(data?.error || `Could not import browser reference image ${label}.`));
    }

    const serverPath = String(data?.serverPath || data?.workflowImage || data?.imagePath || "").trim();

    if (!serverPath) {
      throw new Error(`Imported browser reference image ${label} returned no server path.`);
    }

    return serverPath;
  }

  async function storyboardEnsureStableWorkflowImagesForPayloadV36BB(referencePayload: StoryboardPromptReferencePayloadV35, promptKey: string) {
    const selectedReferences = Array.isArray(referencePayload?.selectedReferences)
      ? referencePayload.selectedReferences
      : [];

    const combined: string[] = [];
    const seen = new Set<string>();

    function pushStable(value: unknown) {
      const cleaned = storyboardCleanWorkflowImageCandidateV36BB(value);

      if (!cleaned) return;

      const key = cleaned.toLowerCase();

      if (seen.has(key)) return;

      seen.add(key);
      combined.push(cleaned);
    }

    for (const reference of selectedReferences) {
      const stable = storyboardStableWorkflowImageForReferenceV36BB(reference);

      if (stable) {
        pushStable(stable);
        continue;
      }

      const browserOnly = storyboardBrowserOnlyImageForReferenceV36BB(reference);

      if (browserOnly) {
        const imported = await storyboardImportBrowserOnlyReferenceImageV36BB(
          browserOnly,
          promptKey,
          String(reference?.name || (reference as any)?.label || reference?.id || "reference"),
        );

        pushStable(imported);
      }
    }

    const workflowImages = Array.isArray(referencePayload?.workflowImages)
      ? referencePayload.workflowImages
      : [];

    for (let index = 0; index < workflowImages.length; index += 1) {
      const candidate = workflowImages[index];
      const stable = storyboardCleanWorkflowImageCandidateV36BB(candidate);

      if (stable) {
        pushStable(stable);
        continue;
      }

      const browserOnly = String(candidate || "").trim();

      if (storyboardIsBrowserOnlyWorkflowImageV36BB(browserOnly)) {
        const imported = await storyboardImportBrowserOnlyReferenceImageV36BB(
          browserOnly,
          promptKey,
          `workflow-reference-${index + 1}`,
        );

        pushStable(imported);
      }
    }

    const displayImages = Array.isArray(referencePayload?.displayImages)
      ? referencePayload.displayImages
      : [];

    for (let index = 0; index < displayImages.length && combined.length < selectedReferences.length; index += 1) {
      const browserOnly = String(displayImages[index] || "").trim();

      if (storyboardIsBrowserOnlyWorkflowImageV36BB(browserOnly)) {
        const imported = await storyboardImportBrowserOnlyReferenceImageV36BB(
          browserOnly,
          promptKey,
          `display-reference-${index + 1}`,
        );

        pushStable(imported);
      }
    }

    return combined.slice(0, 3);
  }

  // OTG_STORYBOARD_FINAL_REFERENCE_NORMALIZER_V36BD
  // Final gate before /api/production/picture.
  // The production route must never receive browser-only blob/data/filesystem URLs.
  function storyboardIsBrowserOnlyReferenceV36BD(value: unknown) {
    const text = String(value || "").trim();

    return (
      /^blob:/i.test(text) ||
      /^data:/i.test(text) ||
      /^filesystem:/i.test(text)
    );
  }

  function storyboardCleanStableReferenceV36BD(value: unknown) {
    const text = String(value || "").trim();

    if (!text || storyboardIsBrowserOnlyReferenceV36BD(text)) {
      return "";
    }

    return text;
  }

  async function storyboardImportBrowserReferenceV36BD(source: string, promptKey: string, label: string) {
    const sourceUrl = String(source || "").trim();

    if (!storyboardIsBrowserOnlyReferenceV36BD(sourceUrl)) {
      return "";
    }

    const blobResponse = await fetch(sourceUrl);

    if (!blobResponse.ok) {
      throw new Error(`Could not read browser-only storyboard reference ${label}.`);
    }

    const blob = await blobResponse.blob();

    if (!blob || !blob.size) {
      throw new Error(`Browser-only storyboard reference ${label} was empty.`);
    }

    const safeLabel = String(label || "reference")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "reference";

    const extension = blob.type.includes("jpeg") || blob.type.includes("jpg")
      ? "jpg"
      : blob.type.includes("webp")
        ? "webp"
        : "png";

    const form = new FormData();
    form.set("image", blob, `${safeLabel}.${extension}`);
    form.set("promptKey", promptKey);
    form.set("label", safeLabel);

    const response = await fetch("/api/storyboard/import-reference", {
      method: "POST",
      body: form,
      credentials: "include",
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.ok) {
      throw new Error(String(data?.error || `Could not import storyboard reference ${label}.`));
    }

    const serverPath = String(data?.serverPath || data?.workflowImage || data?.imagePath || "").trim();

    if (!serverPath) {
      throw new Error(`Imported storyboard reference ${label} returned no server path.`);
    }

    return serverPath;
  }

  function storyboardPotentialReferenceValuesV36BD(referencePayload: any) {
    const values: unknown[] = [];

    const selectedReferences = Array.isArray(referencePayload?.selectedReferences)
      ? referencePayload.selectedReferences
      : [];

    for (const reference of selectedReferences) {
      values.push(
        reference?.workflowImage,
        reference?.cardWorkflowImage,
        reference?.characterWorkflowImage,
        reference?.sourceWorkflowImage,
        reference?.sourceImagePath,
        reference?.imagePath,
        reference?.imageUrl,
        reference?.displayImage,
      );
    }

    if (Array.isArray(referencePayload?.workflowImages)) {
      values.push(...referencePayload.workflowImages);
    }

    if (Array.isArray(referencePayload?.displayImages)) {
      values.push(...referencePayload.displayImages);
    }

    return values;
  }

  async function storyboardFinalNormalizeWorkflowImagesV36BD(
    currentImages: unknown[],
    referencePayload: any,
    promptKey: string,
    targetNumber: number,
  ) {
    const output: string[] = [];
    const seen = new Set<string>();

    async function pushValue(value: unknown, label: string) {
      const stable = storyboardCleanStableReferenceV36BD(value);

      if (stable) {
        const key = stable.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          output.push(stable);
        }
        return;
      }

      const browserOnly = String(value || "").trim();

      if (storyboardIsBrowserOnlyReferenceV36BD(browserOnly)) {
        const imported = await storyboardImportBrowserReferenceV36BD(browserOnly, promptKey, label);
        const key = imported.toLowerCase();

        if (imported && !seen.has(key)) {
          seen.add(key);
          output.push(imported);
        }
      }
    }

    const primary = Array.isArray(currentImages) ? currentImages : [];

    for (let index = 0; index < primary.length; index += 1) {
      await pushValue(primary[index], `slot-${targetNumber}-workflow-${index + 1}`);
    }

    if (output.some((value) => value)) {
      return output.slice(0, 3);
    }

    const fallbackValues = storyboardPotentialReferenceValuesV36BD(referencePayload);

    for (let index = 0; index < fallbackValues.length && output.length < 3; index += 1) {
      await pushValue(fallbackValues[index], `slot-${targetNumber}-fallback-${index + 1}`);
    }

    return output.slice(0, 3);
  }

  async function generateSelectedSceneImages() {
    // OTG_STORYBOARD_CONTINUE_PER_PROMPT_ERRORS_V36AW
    // One prompt = one workflow job. A failed prompt must not stop later prompts.
    // If five prompted slots fail, all five slots must show Error.
    if (!selectedScene || busySceneId) return;

    const imageCount = clampStoryboardImageCount(selectedScene.imageCount);
    const sceneId = selectedScene.id;
    const promptLines = scenePromptLines(selectedScene, imageCount);
    const targets = storyboardSlotGenerationTargets(selectedScene);
    const targetIndexes = targets.map((target) => target.index);

    if (!targets.length) {
      setNotice("Add prompt text to an empty slot or to an uploaded image slot before generating. Uploaded images with no prompt are skipped.");
      return;
    }

    setBusySceneId(sceneId);
    resetStoryboardGenerationProgress(targets.length);
    setNotice(`Submitting ${targets.length} separate storyboard workflow job(s). Each prompt uses its own checked references and matching StoryBoard JSON.`);

    let completedCount = 0;
    let successCount = 0;
    let failureCount = 0;
    const failures: string[] = [];

    const queuedImages = Array.from({ length: imageCount }, (_, index) => {
      const current = selectedScene.images[index] || {
        id: `${sceneId}_img_${index + 1}`,
        approved: false,
      };
      const target = targets.find((item) => item.index === index);

      if (!target) {
        return current;
      }

      return {
        ...current,
        approved: false,
        status: "queued" as const,
        promptId: undefined,
        error: undefined,
        editingUploadedSource: target.mode === "edit_uploaded",
      };
    });

    let nextImages = queuedImages.slice();

    updateSceneById(sceneId, {
      imageCount,
      status: "pending_images",
      images: nextImages,
    });

    try {
      for (const target of targets) {
        const targetNumber = target.index + 1;

        try {
          const promptKey = getStoryboardPromptCanonicalKeyV35J(`scene-prompt-${targetNumber}`);
          const referencePayload = getStoryboardReferencePayloadForPromptV35(promptKey);

          let referenceWorkflowImages = await storyboardEnsureStableWorkflowImagesForPayloadV36BB(referencePayload, promptKey);

          if (!referenceWorkflowImages.length && target.mode === "edit_uploaded" && String(target.uploadedPath || "").trim()) {
            const uploadedPathSourceV36BB = String(target.uploadedPath || "").trim();

            if (storyboardIsBrowserOnlyWorkflowImageV36BB(uploadedPathSourceV36BB)) {
              const importedUploadedPathV36BB = await storyboardImportBrowserOnlyReferenceImageV36BB(
                uploadedPathSourceV36BB,
                promptKey,
                `uploaded-slot-${targetNumber}`,
              );
              referenceWorkflowImages = importedUploadedPathV36BB ? [importedUploadedPathV36BB] : [];
            } else {
              const uploadedPathV36BB = storyboardCleanWorkflowImageCandidateV36BB(uploadedPathSourceV36BB);
              referenceWorkflowImages = uploadedPathV36BB ? [uploadedPathV36BB] : [];
            }
          }

                    referenceWorkflowImages = await storyboardFinalNormalizeWorkflowImagesV36BD(
            referenceWorkflowImages,
            referencePayload,
            promptKey,
            targetNumber,
          );

          if (referenceWorkflowImages.some((value) => storyboardIsBrowserOnlyReferenceV36BD(value))) {
            throw new Error(`Storyboard image ${targetNumber} still has browser-only reference images after import.`);
          }
if (!referenceWorkflowImages.length) {
            throw new Error(`Storyboard image ${targetNumber} has no checked reference images. Select at least one character or background for that prompt.`);
          }

          const checkedCount = Math.max(1, Math.min(5, referenceWorkflowImages.length));
          const workflowFile = storyboardWorkflowFileForReferenceCountV36AQ(checkedCount);
          const rawPromptLine = String(promptLines[target.index] || target.prompt || "").trim();

          if (!rawPromptLine) {
            throw new Error(`Storyboard image ${targetNumber} has no prompt text.`);
          }

          const singlePrompt = exactProductionFramePrompt(buildCompiledScenePrompt([rawPromptLine]));

          setNotice(`Submitting scene image ${targetNumber} with ${checkedCount} checked reference image(s) using ${workflowFile}.`);

          setStoryboardComfyProgress({
            ...emptyComfyProgressState(),
            running: true,
            readyToSync: false,
            percent: Math.round((completedCount / Math.max(1, targets.length)) * 100),
            label: `Submitting scene image ${targetNumber}...`,
            detail: `${completedCount}/${targets.length} attempted. ${successCount} succeeded, ${failureCount} failed.`,
          });

          const response = await fetch("/api/production/picture", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              productionId: `${projectTitle.trim() || "production"}-${sceneId}-storyboard-${targetNumber}`,
              productionName: projectTitle.trim() || "Production",
              title: `${projectTitle.trim() || "Production"} - ${selectedScene.title} - Image ${targetNumber}`,
              storyboardCount: checkedCount,
              workflowFile,
              characterImages: referenceWorkflowImages,
              workflowImages: referenceWorkflowImages,
              displayImages: Array.isArray(referencePayload.displayImages)
                ? referencePayload.displayImages.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 3)
                : [],
              prompt: singlePrompt,
              positivePrompt: singlePrompt,
              promptText: singlePrompt,
              scenePrompt: singlePrompt,
              fullPrompt: singlePrompt,
              scenePrompts: [singlePrompt],
              negativePrompt: "low quality, blurry, distorted anatomy, extra limbs, text, watermark, subtitles, logo, UI overlay",
              defaultStyle: selectedScene.style || "realistic cinematic style",
              promptKey,
              storyboardPromptKey: promptKey,
              scenePromptKey: promptKey,
              imageIndex: targetNumber,
              frameIndex: targetNumber,
              storyboardIndex: targetNumber,
              slotIndex: targetNumber,
              selectedReferences: referencePayload.selectedReferences || [],
              selectedReferenceCount: referencePayload.selectedReferenceCount || referenceWorkflowImages.length,
              referenceInstruction: referencePayload.referenceInstruction || "",
              otgDirectOneWorkflowPerPromptV36AU: true,
              otgContinuePerPromptErrorsV36AW: true,
              otgImportedBrowserReferencesV36BB: true,
              otgFinalReferenceNormalizerV36BD: true,
              otgOneJobPerPromptV36AQ: true,
              otgPerPromptWorkflowSplitV36AP: true,
              otgOneScenePerBatchRequestV36AT: true,
            }),
          });

          const rawResponseText = await response.text();
          let data: any = null;

          try {
            data = rawResponseText ? JSON.parse(rawResponseText) : null;
          } catch {
            data = { raw: rawResponseText };
          }

          if (!response.ok || !data?.ok) {
            throw new Error(String(data?.error || data?.message || data?.raw || `Storyboard image ${targetNumber} failed (${response.status}).`));
          }

          const promptId = String(data?.promptId || data?.prompt_id || "").trim();
          const imagePath = String(data?.imagePath || data?.serverPath || data?.generatedImagePath || "").trim();
          const imageUrl =
            String(data?.imageUrl || data?.serverUrl || data?.generatedImageUrl || "").trim() ||
            (imagePath ? `/api/file?path=${encodeURIComponent(imagePath)}` : "");

          if (!imageUrl) {
            throw new Error(`Storyboard image ${targetNumber} completed but returned no image URL.`);
          }

          const fileName = String(
            data?.fileName ||
              data?.name ||
              data?.remoteFile?.filename ||
              imagePath.split(/[\\/]/).pop() ||
              `storyboard-image-${targetNumber}.png`,
          ).trim();

          nextImages = nextImages.map((image, index) =>
            index === target.index
              ? {
                  ...image,
                  promptId: promptId || image.promptId,
                  status: "ready" as const,
                  approved: true,
                  error: undefined,
                  source: "generated" as const,
                  fileName,
                  url: `${imageUrl}${imageUrl.includes("?") ? "&" : "?"}v=${Date.now()}`,
                  editingUploadedSource: false,
                }
              : image,
          );

          successCount += 1;
        } catch (targetError) {
          const message = targetError instanceof Error ? targetError.message : `Storyboard image ${targetNumber} failed.`;
          failureCount += 1;
          failures.push(`Image ${targetNumber}: ${message}`);

          nextImages = nextImages.map((image, index) =>
            index === target.index
              ? {
                  ...image,
                  status: "error" as const,
                  approved: false,
                  error: message,
                  editingUploadedSource: false,
                }
              : image,
          );

          setNotice(`Storyboard image ${targetNumber} failed. Continuing with remaining prompts.`);
        } finally {
          completedCount += 1;

          const allReady = Array.from({ length: imageCount }, (_, index) => nextImages[index]).every((image) => storyboardImageHasContent(image));

          updateSceneById(sceneId, {
            imageCount,
            status: allReady ? "images_ready" : "pending_images",
            images: nextImages,
          });

          setStoryboardComfyProgress({
            ...emptyComfyProgressState(),
            running: completedCount < targets.length,
            readyToSync: false,
            percent: Math.round((completedCount / Math.max(1, targets.length)) * 100),
            label:
              completedCount < targets.length
                ? "Storyboard generation running..."
                : failureCount
                  ? "Storyboard generation completed with errors."
                  : "Storyboard images generated.",
            detail: `${completedCount}/${targets.length} attempted. ${successCount} succeeded, ${failureCount} failed.`,
          });
        }
      }

      if (failureCount && successCount) {
        setNotice(`Generated ${successCount} scene image(s). ${failureCount} failed. ${failures.slice(0, 2).join(" ")}`);
      } else if (failureCount) {
        setNotice(`All ${failureCount} scene image job(s) failed. ${failures.slice(0, 2).join(" ")}`);
      } else {
        setNotice(`Generated ${successCount} scene image(s). Each prompt was submitted as its own workflow job.`);
      }
    } finally {
      setBusySceneId("");
    }
  }

  // PRODUCTION_SYNC_SLOT_ORDER_PATCH
  function storyboardFileOrderKey(name: string) {
    const raw = String(name || "");
    const file = raw.split(/[\\/]/).pop() || raw;
    const matches = file.match(/\d+/g) || [];
    const lastNumber = matches.length ? Number(matches[matches.length - 1]) : Number.MAX_SAFE_INTEGER;

    return {
      file,
      lastNumber: Number.isFinite(lastNumber) ? lastNumber : Number.MAX_SAFE_INTEGER,
      raw,
    };
  }

  function sortStoryboardSavedNames(names: string[]) {
    return [...names].sort((a, b) => {
      const ka = storyboardFileOrderKey(a);
      const kb = storyboardFileOrderKey(b);

      if (ka.lastNumber !== kb.lastNumber) return ka.lastNumber - kb.lastNumber;
      return ka.file.localeCompare(kb.file, undefined, { numeric: true, sensitivity: "base" });
    });
  }
  function sortStoryboardSavedItems(items: Array<{ name: string; url: string }>) {
    return [...items].sort((a, b) => {
      const ka = storyboardFileOrderKey(a.name);
      const kb = storyboardFileOrderKey(b.name);

      if (ka.lastNumber !== kb.lastNumber) return ka.lastNumber - kb.lastNumber;
      return ka.file.localeCompare(kb.file, undefined, { numeric: true, sensitivity: "base" });
    });
  }

  function syncableStoryboardImageSlot(scene: ProductionScene | null | undefined, index: number) {
    if (!scene || busySceneId) return false;
    const image = scene.images[index];
    return Boolean(
      image?.promptId &&
        image.status === "queued" &&
        !storyboardImageHasContent(image)
    );
  }

  function normalizeStoryboardSyncItem(raw: any): { name: string; url: string } | null {
    if (!raw) return null;

    if (typeof raw === "string") {
      const name = raw.trim();
      return name ? { name, url: `/api/gallery/file?name=${encodeURIComponent(name)}` } : null;
    }

    const name = String(
      raw?.name ||
        raw?.fileName ||
        raw?.filename ||
        raw?.sourceName ||
        raw?.outputName ||
        raw?.path ||
        raw?.serverPath ||
        ""
    ).trim();

    const directUrl = String(raw?.url || raw?.fileUrl || raw?.publicUrl || raw?.previewUrl || raw?.imageUrl || "").trim();
    const serverPath = String(raw?.serverPath || raw?.path || raw?.filePath || "").trim();

    const url =
      directUrl ||
      (serverPath ? `/api/file?path=${encodeURIComponent(serverPath)}` : "") ||
      (name ? `/api/gallery/file?name=${encodeURIComponent(name)}` : "");

    return name && url ? { name, url } : null;
  }

  function extractStoryboardSyncItems(data: any): Array<{ name: string; url: string }> {
    const buckets = [
      data?.items,
      data?.saved,
      data?.savedItems,
      data?.files,
      data?.outputs,
      data?.images,
      data?.results,
      data?.file ? [data.file] : [],
      data?.image ? [data.image] : [],
      data?.output ? [data.output] : [],
      data?.result ? [data.result] : [],
    ];

    const items: Array<{ name: string; url: string }> = [];

    for (const bucket of buckets) {
      if (!Array.isArray(bucket)) continue;
      for (const raw of bucket) {
        const item = normalizeStoryboardSyncItem(raw);
        if (item && !items.some((existing) => existing.name === item.name || existing.url === item.url)) {
          items.push(item);
        }
      }
    }

    return items;
  }

  async function syncSelectedSceneImages() {
    if (!selectedScene || busySceneId) return;

    const syncTargetIndexes = Array.from({ length: clampStoryboardImageCount(selectedScene.imageCount) }, (_, index) => index)
      .filter((index) => syncableStoryboardImageSlot(selectedScene, index));

    const promptIds = Array.from(
      new Set(syncTargetIndexes.map((index) => selectedScene.images[index]?.promptId).filter((id): id is string => !!id))
    );

    if (!promptIds.length) {
      setNotice("Generate empty storyboard slots first, then sync completed results.");
      return;
    }

    const sceneId = selectedScene.id;
    const expectedCount = clampStoryboardImageCount(selectedScene.imageCount);
    const targetCount = Math.max(1, syncTargetIndexes.length);

    setBusySceneId(sceneId);
    setNotice(`Checking storyboard scene job result(s) and mapping images into ${syncTargetIndexes.length} empty slot(s).`);

    try {
      const savedItems: Array<{ name: string; url: string }> = [];

      for (const promptId of promptIds) {
        const res = await fetch("/api/gallery/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ promptId, forceDirect: true }),
        });

        const data = await res.json().catch(() => null);

        if (!res.ok || data?.ok === false) {
          const message = data?.error || data?.normalSyncError || `Sync failed (${res.status})`;
          setNotice(message);
          continue;
        }

        const extractedItems = extractStoryboardSyncItems(data);

        for (const item of extractedItems) {
          if (!savedItems.some((existing) => existing.name === item.name || existing.url === item.url)) savedItems.push(item);
        }
      }

      const orderedSavedItems = pickUniqueStoryboardSavedItems(savedItems, targetCount);

      const mappedImages = Array.from({ length: expectedCount }, (_, index) => {
        const current = selectedScene.images[index] || {
          id: `${sceneId}_img_${index + 1}`,
          approved: false,
        };

        const targetPosition = syncTargetIndexes.indexOf(index);
        if (targetPosition === -1) return current;

        const savedItem = orderedSavedItems[targetPosition];

        if (!savedItem) {
          return {
            ...current,
            status: current.status === "ready" ? ("ready" as const) : ("queued" as const),
            error: undefined,
          };
        }

        return {
          ...current,
          status: "ready" as const,
          approved: true,
          fileName: savedItem.name,
          url: savedItem.url,
          error: undefined,
          source: "generated" as const,
        };
      });

      const ready = mappedImages.filter((image) => image.status === "ready" || image.approved).length;

      updateSceneById(sceneId, {
        imageCount: expectedCount,
        status: ready >= expectedCount ? "images_ready" : "pending_images",
        images: mappedImages,
      });

      if (!orderedSavedItems.length) {
        setNotice("No image files were returned for this exact promptId. Regenerate this storyboard slot or confirm the sync route can read Comfy history for the prompt.");
      } else if (ready >= expectedCount) {
        setNotice(`Mapped the newest generated image result(s) into empty storyboard slots. All ${expectedCount} storyboard slots are ready.`);
        setStoryboardComfyProgress({
          ...emptyComfyProgressState(),
          running: false,
          readyToSync: false,
          percent: 100,
          label: "Storyboard images synced.",
          detail: "sync-complete",
        });
      } else {
        setNotice(`Mapped the newest storyboard result(s) into empty slots. ${ready}/${expectedCount} total slot(s) are ready.`);
      }
    } finally {
      setBusySceneId("");
    }
  }

  // PRODUCTION_ANIMATE_UI_SCAFFOLD_PATCH
  // PRODUCTION_ANIMATE_FRAME_PROMPTS_UI_PATCH
  // PRODUCTION_ANIMATE_CHARACTER_CONTEXT_UI_PATCH
  function clampAnimateFrameDuration(value: number) {
    if (!Number.isFinite(value)) return MIN_ANIMATE_FRAME_DURATION_SECONDS;
    return Math.max(MIN_ANIMATE_FRAME_DURATION_SECONDS, Math.min(MAX_ANIMATE_FRAME_DURATION_SECONDS, Math.round(value)));
  }





    function animateCharacterOptions(scene: ProductionScene | null | undefined) {
    const sceneOptions = createCharacterSlots(scene?.characterRefs)
      .filter((ref) => {
        const maybeRef = ref as CharacterReference & { imagePath?: string; description?: string };
        return Boolean(ref.previewUrl || ref.fileName || maybeRef.imagePath);
      })
      .map((ref, index) => {
        const maybeRef = ref as CharacterReference & { imagePath?: string; description?: string; name?: string };
        const fileName = String(ref.fileName || maybeRef.imagePath || "").trim();
        const previewUrl = String(ref.previewUrl || "").trim();
        const stableSource = `scene_${index}_${fileName || maybeRef.imagePath || previewUrl || ref.id || `character_${index + 1}`}`;
        const stableId = stableSource
          .replace(/[^a-zA-Z0-9_.-]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 140) || `scene_character_${index + 1}`;

        return {
          id: stableId,
          sourceId: ref.id,
          index,
          label: String(ref.label || maybeRef.name || `Character ${index + 1}`).trim(),
          fileName,
          previewUrl,
          description: String(
            (maybeRef as any).lockedCompleteDescription ||
              (maybeRef as any).completeDescription ||
              (maybeRef as any).characterDescription ||
              (maybeRef as any).promptBlock ||
              (maybeRef as any).identityBlock ||
              (maybeRef as any).globalPromptBlock ||
              maybeRef.description ||
              ref.label ||
              maybeRef.name ||
              `Character ${index + 1}`
          ).trim(),
          sourceType: "scene" as const,
        };
      });

    const savedOptions = animateSavedCharacterPresetsV36BPU26B.map((item, index) => {
      const stableSource = `saved_${item.id || item.name || item.imagePath || index}`;
      const stableId = stableSource
        .replace(/[^a-zA-Z0-9_.-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 140) || `saved_character_${index + 1}`;

      return {
        id: stableId,
        sourceId: item.id,
        index: sceneOptions.length + index,
        label: String(item.name || `Saved Character ${index + 1}`).trim(),
        fileName: String(item.imagePath || item.workflowImagePath || "Saved character preset").trim(),
        previewUrl: String(item.imageUrl || item.workflowImageUrl || "").trim(),
        description: String((item as any).description || item.name || `Saved Character ${index + 1}`).trim(),
        sourceType: "saved" as const,
      };
    });

    const seen = new Set<string>();
    return [...sceneOptions, ...savedOptions].filter((character) => {
      const key = String(character.sourceId || character.id || character.label || "").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }







  function selectedAnimateCharacters(scene: ProductionScene | null | undefined, frameIndex: number) {
    const drafts = animateFrameDrafts(scene);
    const ids = new Set<string>(drafts[frameIndex]?.characterRefIds || []);
    return animateCharacterOptions(scene).filter((character) => ids.has(character.id));
  }

  function repairJoinedAnimatePromptWordsV36BPU39(value: string) {
    return String(value || "")
      .replace(/\b(slowly|quickly|rapidly|gently|carefully|calmly|quietly|suddenly)(walks|walking|walk|runs|running|run|moves|moving|move|steps|stepping|step)\b/gi, "$1 $2")
      .replace(/\b(bottom|top|far|near|left|right|middle)(left|right|corner|side|screen|frame)\b/gi, "$1 $2")
      .replace(/\b(the)(man|woman|boy|girl|character|camera|screen|scene)\b/gi, "$1 $2")
      .replace(/\b(his|her|their|the)(face|back|hands|arms|legs|body|screen)\b/gi, "$1 $2");
  }

  function preserveAnimateManualPromptSpacingV36BPU22(value: unknown) {
    return repairJoinedAnimatePromptWordsV36BPU39(String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  }
const manualAnimatePositivePromptOnlyV36BPU21 = (value: unknown) => preserveAnimateManualPromptSpacingV36BPU22(value);

function animateGlobalPromptForFrame(draft: any, frame?: any) {
    return preserveAnimateManualPromptSpacingV36BPU22(draft?.prompt);
  }



  function toggleAnimateFrameCharacter(frameIndex: number, characterId: string, checked: boolean) {
    if (!selectedScene) return;

    const frames = animateFrameDrafts(selectedScene);
    const currentIds = new Set<string>(frames[frameIndex]?.characterRefIds || []);

    if (checked) {
      currentIds.add(characterId);
    } else {
      currentIds.delete(characterId);
    }

    updateAnimateFrameDraft(frameIndex, {
      characterRefIds: Array.from(currentIds),
    });
  }

  function animateCharacterPromptBlockV36BPU25(character: {
    label?: string;
    description?: string;
    fileName?: string;
    id?: string;
  }) {
    const label = String(character?.label || character?.id || "Character").trim();
    const description = String(character?.description || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

    if (!description || description === label) return label;
    return `${label}: ${description}`;
  }

  function appendAnimateCharacterDescriptionToPromptV36BPU25(
    frameIndex: number,
    character: {
      id: string;
      label?: string;
      description?: string;
      fileName?: string;
    },
  ) {
    if (!selectedScene) return;

    const drafts = animateFrameDrafts(selectedScene);
    const currentPrompt = String(drafts[frameIndex]?.prompt || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const characterBlock = animateCharacterPromptBlockV36BPU25(character);

    if (!characterBlock.trim()) {
      setNotice("Selected character has no usable description to add.");
      return;
    }

    if (currentPrompt.includes(characterBlock)) {
      toggleAnimateFrameCharacter(frameIndex, character.id, true);
      setNotice(`${String(character.label || "Character").trim()} description is already in this Animate prompt.`);
      return;
    }

    const separator = currentPrompt && !currentPrompt.endsWith("\n") ? "\n" : "";
    const nextPrompt = `${currentPrompt}${separator}${characterBlock}`;

    updateAnimateFrameDraft(frameIndex, { prompt: nextPrompt });
    toggleAnimateFrameCharacter(frameIndex, character.id, true);
    setNotice(`Added ${String(character.label || "character").trim()} description to the Animate prompt.`);
  }


  // PRODUCTION_ANIMATE_GENERATE_V1_PATCH

// OTG_PRODUCTION_DEFAULT_ANIMATE_USE_GENERATE_I2V_V1_START
  const PRODUCTION_DEFAULT_I2V_WORKFLOW_ID =
    process.env.NEXT_PUBLIC_OTG_PRODUCTION_DEFAULT_I2V_WORKFLOW_ID || "production/image-to-video-ltx23-1-1";
  const PRODUCTION_DEFAULT_I2V_WORKFLOW_LABEL =
    process.env.NEXT_PUBLIC_OTG_PRODUCTION_DEFAULT_I2V_WORKFLOW_LABEL || "Production Image to Video";
  const PRODUCTION_FIRST_LAST_WORKFLOW_ID =
    process.env.NEXT_PUBLIC_OTG_PRODUCTION_FIRST_LAST_WORKFLOW_ID || "production/first-frame-last-frame-ltx23-1-1";
  const PRODUCTION_FIRST_LAST_WORKFLOW_LABEL =
    process.env.NEXT_PUBLIC_OTG_PRODUCTION_FIRST_LAST_WORKFLOW_LABEL || "Production First Frame Last Frame";
  const PRODUCTION_REFERENCE_VIDEO_GGUF_WORKFLOW_ID = "production-reference-video-gguf";
  const PRODUCTION_REFERENCE_VIDEO_GGUF_WORKFLOW_LABEL = "Production Reference-to-video GGUF";
  const PRODUCTION_REFERENCE_VIDEO_GGUF_VOICE_ACTOR_WORKFLOW_ID = "production-reference-video-gguf-voice-actor";
  const PRODUCTION_REFERENCE_VIDEO_GGUF_VOICE_ACTOR_WORKFLOW_LABEL = "Production Reference-to-video GGUF Voice Actor";

  async function productionDefaultAnimateImageFile(imageUrl: string, fallbackName: string) {
    const url = String(imageUrl || "").trim();
    if (!url) throw new Error("Missing source image URL for Default Animate.");

    const response = await fetch(url, {
      cache: "no-store",
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Could not load Default Animate source image: ${response.status}`);
    }

    const blob = await response.blob();
    if (!blob.size) {
      throw new Error("Default Animate source image was empty.");
    }

    const contentType = blob.type || "image/png";
    const safeName = String(fallbackName || "production-frame.png")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "production-frame.png";

    return new File([blob], safeName, { type: contentType });
  }

  function productionDefaultAnimateOutputPrefix(sceneId: string, frameIndex: number) {
    return `OTG_Default_${sceneId}_frame_${frameIndex + 1}_${Date.now()}`;
  }

  function productionFirstLastAnimateOutputPrefix(sceneId: string, frameIndex: number, lastFrameIndex: number) {
    return `OTG_FirstLast_${sceneId}_frame_${frameIndex + 1}_to_${lastFrameIndex + 1}_${Date.now()}`;
  }

  function productionDefaultAnimatePickPromptId(data: any) {
    return String(data?.promptId || data?.prompt_id || data?.id || data?.response?.prompt_id || "").trim();
  }

  function productionDefaultAnimateGalleryItems(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.files)) return data.files;
    if (Array.isArray(data?.results)) return data.results;
    if (Array.isArray(data?.assets)) return data.assets;
    if (Array.isArray(data?.videos)) return data.videos;
    return [];
  }

  function productionDefaultAnimateIsVideoItem(item: any) {
    const text = [
      item?.name,
      item?.fileName,
      item?.filename,
      item?.path,
      item?.url,
      item?.type,
      item?.mimeType,
    ]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");

    return text.includes(".mp4") || text.includes(".webm") || text.includes(".mov") || text.includes("video");
  }

  function productionDefaultAnimateItemName(item: any) {
    return String(item?.name || item?.fileName || item?.filename || item?.path || "").trim();
  }

  function productionDefaultAnimateItemUrl(item: any) {
    const name = productionDefaultAnimateItemName(item);
    if (name) {
      return `/api/gallery/file?name=${encodeURIComponent(name)}`;
    }

    const direct = String(item?.url || item?.videoUrl || item?.src || "").trim();
    return direct;
  }

  function productionDefaultAnimateItemThumbUrl(item: any, width = 512) {
    const direct = String(item?.thumbUrl || item?.posterUrl || item?.thumbnailUrl || item?.imageUrl || item?.previewUrl || "").trim();
    if (direct) return direct;

    const name = productionDefaultAnimateItemName(item);
    if (!name) return "";

    const params = new URLSearchParams();
    params.set("collection", "gallery");
    params.set("name", name);
    params.set("w", String(width));
    return `/api/thumb?${params.toString()}`;
  }

  async function productionDefaultAnimateFetchGalleryItems() {
    const endpoints = [
      "/api/gallery?type=video",
      "/api/gallery?kind=video",
      "/api/gallery?media=video",
      "/api/gallery",
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          credentials: "include",
        });

        if (!response.ok) continue;

        const data = await response.json().catch(() => null);
        const items = productionDefaultAnimateGalleryItems(data).filter(productionDefaultAnimateIsVideoItem);

        if (items.length) return items;
      } catch {
        // Try next endpoint.
      }
    }

    return [];
  }

  // OTG_PRODUCTION_DEFAULT_SYNC_STRICT_SLOT_MATCH_V3_START
  function productionDefaultStrictNormalize(value: unknown) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function productionDefaultStrictMeta(item: any) {
    return item?.meta && typeof item.meta === "object" ? item.meta : {};
  }

  function productionDefaultStrictSubmitPayload(item: any) {
    const meta = productionDefaultStrictMeta(item);
    return meta?.submitPayload && typeof meta.submitPayload === "object" ? meta.submitPayload : {};
  }

  function productionDefaultStrictPromptId(item: any) {
    const meta = productionDefaultStrictMeta(item);
    const payload = productionDefaultStrictSubmitPayload(item);

    return String(
      item?.promptId ||
        item?.prompt_id ||
        item?.sourcePromptId ||
        meta?.sourcePromptId ||
        meta?.promptId ||
        meta?.prompt_id ||
        payload?.promptId ||
        payload?.prompt_id ||
        ""
    ).trim();
  }

  function productionDefaultStrictRequestKind(item: any) {
    const meta = productionDefaultStrictMeta(item);
    const payload = productionDefaultStrictSubmitPayload(item);

    return String(
      item?.requestKind ||
        meta?.requestKind ||
        payload?.requestKind ||
        ""
    ).trim();
  }

  function productionDefaultStrictWorkflowId(item: any) {
    const meta = productionDefaultStrictMeta(item);
    const payload = productionDefaultStrictSubmitPayload(item);

    return String(
      item?.workflowId ||
        meta?.workflowId ||
        payload?.workflowId ||
        payload?.preset ||
        ""
    ).trim();
  }

  function productionDefaultStrictTitle(item: any) {
    const meta = productionDefaultStrictMeta(item);
    const payload = productionDefaultStrictSubmitPayload(item);

    return String(
      payload?.title ||
        item?.title ||
        meta?.title ||
        item?.name ||
        item?.fileName ||
        item?.filename ||
        meta?.renamedName ||
        meta?.originalName ||
        ""
    ).trim();
  }

  function productionDefaultStrictUpdatedAt(item: any) {
    const meta = productionDefaultStrictMeta(item);

    return Number(
      item?.updatedAt ||
        item?.createdAt ||
        item?.ts ||
        meta?.updatedAt ||
        meta?.createdAt ||
        0
    ) || 0;
  }

  function productionDefaultStrictItemKey(item: any) {
    return [
      productionDefaultAnimateItemName(item),
      productionDefaultStrictPromptId(item),
      productionDefaultStrictUpdatedAt(item),
    ].join("|");
  }

  function productionDefaultStrictExpectedTitle(sceneTitle: string, clipIndex: number) {
    return `${String(sceneTitle || "Scene").trim()} - Clip ${clipIndex + 1}`;
  }

  function productionDefaultStrictItemText(item: any) {
    const meta = productionDefaultStrictMeta(item);
    const payload = productionDefaultStrictSubmitPayload(item);

    return [
      item?.name,
      item?.fileName,
      item?.filename,
      item?.sourceName,
      item?.url,
      meta?.renamedName,
      meta?.originalName,
      meta?.sourcePayloadKey,
      meta?.sourcePromptId,
      meta?.requestKind,
      meta?.workflowId,
      payload?.title,
      payload?.requestKind,
      payload?.workflowId,
      payload?.preset,
      payload?.workflowLabel,
    ]
      .map(productionDefaultStrictNormalize)
      .filter(Boolean)
      .join(" ");
  }

  function productionDefaultStrictItemMatchesSlot(item: any, clip: any, scene: any, clipIndex: number) {
    if (!productionDefaultAnimateIsVideoItem(item)) return false;

    const requestKind = productionDefaultStrictRequestKind(item);
    if (
      requestKind &&
      requestKind !== "production-default-image-to-video" &&
      requestKind !== "production-first-last-frame-video" &&
      requestKind !== "production-reference-video-gguf" &&
      requestKind !== "production-reference-video-gguf-voice-actor" &&
      requestKind !== "production-reference-video-gguf-test"
    ) return false;

    const workflowId = productionDefaultStrictWorkflowId(item);
    if (
      workflowId &&
      PRODUCTION_DEFAULT_I2V_WORKFLOW_ID &&
      workflowId !== PRODUCTION_DEFAULT_I2V_WORKFLOW_ID &&
      workflowId !== PRODUCTION_FIRST_LAST_WORKFLOW_ID &&
      workflowId !== PRODUCTION_REFERENCE_VIDEO_GGUF_WORKFLOW_ID &&
      workflowId !== PRODUCTION_REFERENCE_VIDEO_GGUF_VOICE_ACTOR_WORKFLOW_ID &&
      workflowId !== "production-reference-video-gguf-test"
    ) {
      return false;
    }

    const expectedTitle = productionDefaultStrictNormalize(
      productionDefaultStrictExpectedTitle(scene?.title || "", clipIndex)
    );

    const text = productionDefaultStrictItemText(item);
    const itemTitle = productionDefaultStrictNormalize(productionDefaultStrictTitle(item));
    const itemName = productionDefaultStrictNormalize(productionDefaultAnimateItemName(item));

    const hasExactSlotTitle =
      Boolean(expectedTitle) &&
      (itemTitle.includes(expectedTitle) ||
        itemName.includes(expectedTitle) ||
        text.includes(expectedTitle));

    if (hasExactSlotTitle) return true;

    const clipOutputPrefix = productionDefaultStrictNormalize(clip?.outputPrefix);
    if (clipOutputPrefix && text.includes(clipOutputPrefix)) return true;

    const clipPromptId = productionDefaultStrictNormalize(clip?.promptId);
    const itemPromptId = productionDefaultStrictNormalize(productionDefaultStrictPromptId(item));

    if (clipPromptId && itemPromptId && clipPromptId === itemPromptId) {
      // Prompt IDs are allowed only when the item is not clearly titled for another clip slot.
      // This prevents stale wrong-slot prompt IDs from keeping Clip 4 in Clip 1/2/3.
      const wrongClipPattern = /clip_([0-9]+)/;
      const titleMatch = itemTitle.match(wrongClipPattern) || itemName.match(wrongClipPattern);
      if (!titleMatch) return true;

      const titleClipNumber = Number(titleMatch[1]);
      return titleClipNumber === clipIndex + 1;
    }

    return false;
  }

  function productionDefaultStrictFindSlotItem(
    galleryItems: any[],
    usedKeys: Set<string>,
    clip: any,
    scene: any,
    clipIndex: number
  ) {
    const candidates = galleryItems
      .filter((item) => !usedKeys.has(productionDefaultStrictItemKey(item)))
      .filter((item) => productionDefaultStrictItemMatchesSlot(item, clip, scene, clipIndex))
      .sort((a, b) => productionDefaultStrictUpdatedAt(b) - productionDefaultStrictUpdatedAt(a));

    return candidates[0] || null;
  }

  function productionDefaultStrictClipAlreadyBelongsToSlot(clip: any, scene: any, clipIndex: number) {
    const expectedTitle = productionDefaultStrictNormalize(
      productionDefaultStrictExpectedTitle(scene?.title || "", clipIndex)
    );

    const clipFileName = productionDefaultStrictNormalize(clip?.fileName);
    const clipUrl = productionDefaultStrictNormalize(clip?.url);

    return Boolean(
      expectedTitle &&
        ((clipFileName && clipFileName.includes(expectedTitle)) ||
          (clipUrl && clipUrl.includes(expectedTitle)))
    );
  }

  async function syncSelectedFrameClips() {
    if (!selectedScene || busySceneId) return;

    const sceneId = selectedScene.id;
    const frameClips = animateFrameClips(selectedScene);
    const drafts = animateFrameDrafts(selectedScene);
    const syncTargetIndexes = frameClips
      .map((clip, index) => (
        drafts[index]?.queueForGeneration !== false &&
        !isAnimateLastFrameConsumed(drafts[index]) &&
        clip?.promptId
          ? index
          : -1
      ))
      .filter((index) => index >= 0);

    if (!frameClips.length) {
      setNotice("No scene clip slots found for this production scene.");
      return;
    }

    if (!syncTargetIndexes.length) {
      setNotice("No queued Animate clips are waiting to sync. Check a scene as Queue and generate it first.");
      return;
    }

    setBusySceneId(sceneId);
    setNotice(`Syncing ${syncTargetIndexes.length} queued frame clip(s) from gallery output...`);

    try {
      const galleryItems = (await productionDefaultAnimateFetchGalleryItems())
        .filter(productionDefaultAnimateIsVideoItem)
        .sort((a, b) => productionDefaultStrictUpdatedAt(b) - productionDefaultStrictUpdatedAt(a));

      if (!galleryItems.length) {
        setNotice("No generated video clips found yet. Wait for Comfy to finish, then Sync Scene Clips again.");
        return;
      }

      const usedKeys = new Set<string>();
      let mappedCount = 0;
      let clearedWrongCount = 0;

      const nextClips = frameClips.map((clip, index) => {
        if (!syncTargetIndexes.includes(index)) return clip;

        const matchedItem = productionDefaultStrictFindSlotItem(
          galleryItems,
          usedKeys,
          clip,
          selectedScene,
          index
        );

        if (!matchedItem) {
          if (
            clip?.status === "ready" &&
            !productionDefaultStrictClipAlreadyBelongsToSlot(clip, selectedScene, index)
          ) {
            clearedWrongCount += 1;
            return {
              ...clip,
              status: "queued" as const,
              fileName: "",
              url: "",
              error: undefined,
            };
          }

          return clip;
        }

        usedKeys.add(productionDefaultStrictItemKey(matchedItem));

        const fileName = productionDefaultAnimateItemName(matchedItem);
        const url = productionDefaultAnimateItemUrl(matchedItem);
        const sourcePromptId = productionDefaultStrictPromptId(matchedItem);

        if (!url && !fileName) return clip;

        mappedCount += 1;

        return {
          ...clip,
          status: "ready" as const,
          fileName,
          url,
          promptId: clip.promptId || sourcePromptId,
          sourceFrameIndex: index,
          error: undefined,
        };
      });

      const readyCount = nextClips.filter((clip) => clip.status === "ready").length;

      updateSceneById(sceneId, {
        frameClips: nextClips,
        status: readyCount >= nextClips.length ? "clip_ready" : selectedScene.status,
      });
      autosaveProductionScenePatchV36BPU43(sceneId, {
        frameClips: nextClips,
        status: readyCount >= nextClips.length ? "clip_ready" : selectedScene.status,
      }, "animate");

      if (mappedCount || clearedWrongCount) {
        setNotice(
          `Synced ${mappedCount}/${syncTargetIndexes.length} queued frame clip(s).` +
            (clearedWrongCount ? ` Cleared ${clearedWrongCount} wrong slot assignment(s).` : "")
        );
      } else {
        setNotice(
          "No exact slot matches found. Clip 1 needs a generated file titled Scene - Clip 1, Clip 2 needs Scene - Clip 2, etc."
        );
      }
    } finally {
      setBusySceneId("");
    }
  }
  // OTG_PRODUCTION_DEFAULT_SYNC_STRICT_SLOT_MATCH_V3_END
// OTG_PRODUCTION_DEFAULT_ANIMATE_USE_GENERATE_I2V_V1_END
  async function generateSelectedFrameClips() {
    if (!selectedScene || busySceneId) return;

    let sceneSnapshot = selectedScene;
    const sceneId = sceneSnapshot.id;
    let frames = storyboardFramesForAnimate(sceneSnapshot);
    let drafts = animateFrameDrafts(sceneSnapshot);
    let existingClips = animateFrameClips(sceneSnapshot);
    let expectedCount = clampStoryboardImageCount(sceneSnapshot.imageCount);

    const completedQwenScenesForSubmitV36BPU19 = loadCompletedQwenScenesForAnimateV36BPU3();
    if (completedQwenScenesForSubmitV36BPU19.length > frames.length) {
      const qwenImagesForSubmitV36BPU19 = qwenSceneImagesForAnimateV36BPU3(completedQwenScenesForSubmitV36BPU19);
      const qwenDraftsForSubmitV36BPU19 = qwenSceneAnimationDraftsForAnimateV36BPU3(completedQwenScenesForSubmitV36BPU19, drafts);
      const qwenClipsForSubmitV36BPU19 = qwenSceneFrameClipsForAnimateV36BPU3(completedQwenScenesForSubmitV36BPU19, existingClips);

      frames = qwenImagesForSubmitV36BPU19.map((image, index) => {
        const fileName = String(image.fileName || "").trim();
        const url = String(
          image.url ||
            (image as any).imageUrl ||
            (fileName ? `/api/gallery/file?name=${encodeURIComponent(fileName)}` : "")
        ).trim();

        return {
          index,
          image,
          approved: Boolean(image.approved || image.status === "ready" || url),
          fileName,
          url,
        };
      });
      drafts = qwenDraftsForSubmitV36BPU19;
      existingClips = qwenClipsForSubmitV36BPU19;
      expectedCount = completedQwenScenesForSubmitV36BPU19.length;
      sceneSnapshot = {
        ...sceneSnapshot,
        imageCount: expectedCount,
        images: qwenImagesForSubmitV36BPU19,
        animationFrames: qwenDraftsForSubmitV36BPU19,
        frameClips: qwenClipsForSubmitV36BPU19,
      } as ProductionScene;

      updateSceneById(sceneId, {
        imageCount: expectedCount,
        images: qwenImagesForSubmitV36BPU19,
        animationFrames: qwenDraftsForSubmitV36BPU19,
        frameClips: qwenClipsForSubmitV36BPU19,
      });
    }
    drafts = drafts.map((draft, index) => ({
      ...draft,
      durationSeconds: animateDurationWithOverrideV36BPU42(sceneId, index, draft.durationSeconds),
    }));
    const activeSubmitFrameIndexV36BPU20C = Math.max(
      0,
      Math.min(frames.length - 1, Math.floor(Number(activeAnimateSceneIndexV36BPU10B) || 0))
    );
    const activeSubmitDraftV36BPU20C = drafts[activeSubmitFrameIndexV36BPU20C];

    const queuedFrameIndexes = activeSubmitDraftV36BPU20C?.queueForGeneration !== false && !isAnimateLastFrameConsumed(activeSubmitDraftV36BPU20C)
      ? [activeSubmitFrameIndexV36BPU20C]
      : [];
    const missingFrames = frames.filter((frame) => !frame.approved || !frame.url);

    if (missingFrames.length) {
      setNotice(`Approve and sync all storyboard scene previews before animation. Missing ${missingFrames.length}/${expectedCount}.`);
      return;
    }

    if (!queuedFrameIndexes.length) {
      setNotice("No Animate scenes are queued. Check at least one scene as Queue before generating.");
      return;
    }

    setBusySceneId(sceneId);
    resetAnimateGenerationProgress(queuedFrameIndexes.length);
    setNotice(`Submitting current Animate scene ${activeSubmitFrameIndexV36BPU20C + 1} as 1 LTX 2.3 clip job.`);

    let nextClips: ProductionFrameClip[] = Array.from({ length: expectedCount }, (_, index) => ({
      ...existingClips[index],
      status: queuedFrameIndexes.includes(index) ? ("queued" as const) : (existingClips[index]?.status || "idle"),
      error: undefined,
    }));

    updateSceneById(sceneId, {
      frameClips: nextClips,
    });

    try {
      for (const index of queuedFrameIndexes) {
        const frame = frames[index];
        const draft = drafts[index];
        const pairedLastFrameIndex = draft.animationMode === "first_last_frame" ? draft.lastFrameIndex : undefined;
        const isFirstLastFrame = pairedLastFrameIndex === index + 1;
        const isReferenceVideoGguf = draft.animationMode === "reference_to_video_gguf";
        const isReferenceVideoMode = isReferenceVideoGguf;
        const lastFrame = isFirstLastFrame ? frames[pairedLastFrameIndex] : null;
        const selectedCharacters = selectedAnimateCharacters(sceneSnapshot, index);
        const firstUsableCharacter = selectedCharacters.find((character) => {
          const url = String(character.previewUrl || "");
          return url && !url.startsWith("blob:");
        });

        const referenceVideoCharacter = isReferenceVideoMode ? firstUsableCharacter : undefined;
        const indexImageUrl = isReferenceVideoMode ? frame.url : firstUsableCharacter?.previewUrl || frame.url;
        const localPrompt = preserveAnimateManualPromptSpacingV36BPU22(draft.prompt);
        const globalPrompt = "";

        if (!frame.url) {
          nextClips[index] = {
            ...nextClips[index],
            status: "error" as const,
            error: "Missing storyboard frame image URL.",
          };
          updateSceneById(sceneId, { frameClips: nextClips });
          continue;
        }

        if (isFirstLastFrame && !lastFrame?.url) {
          nextClips[index] = {
            ...nextClips[index],
            status: "error" as const,
            error: `Missing last-frame image from Frame ${Number(pairedLastFrameIndex) + 1}.`,
          };
          updateSceneById(sceneId, { frameClips: nextClips });
          continue;
        }

        if (isReferenceVideoMode && !referenceVideoCharacter?.previewUrl) {
          nextClips[index] = {
            ...nextClips[index],
            status: "error" as const,
            error: "Reference-to-video needs one selected character reference.",
          };
          updateSceneById(sceneId, { frameClips: nextClips });
          continue;
        }

        const outputPrefix = isFirstLastFrame
          ? productionFirstLastAnimateOutputPrefix(sceneId, index, Number(pairedLastFrameIndex))
          : productionDefaultAnimateOutputPrefix(sceneId, index);
        const sourceFile = await productionDefaultAnimateImageFile(
          frame.url,
          `${sceneId}_frame_${index + 1}.png`
        );
        const lastFrameFile = isFirstLastFrame && lastFrame?.url
          ? await productionDefaultAnimateImageFile(lastFrame.url, `${sceneId}_frame_${Number(pairedLastFrameIndex) + 1}_last.png`)
          : null;
        const referenceVideoFile = isReferenceVideoMode && referenceVideoCharacter?.previewUrl
          ? await productionDefaultAnimateImageFile(referenceVideoCharacter.previewUrl, `${sceneId}_frame_${index + 1}_gguf_ref_1.png`)
          : null;

        const voiceActorInput = draft.voiceActorInput || {};
        const useVoiceActorInput = Boolean(voiceActorInput.enabled && voiceActorInput.saved);
        const useReferenceVideoGgufVoiceActor = Boolean(isReferenceVideoGguf && useVoiceActorInput);
        const workflowFileName = useReferenceVideoGgufVoiceActor
            ? "production-reference-video-gguf-voice-actor.json"
          : isReferenceVideoGguf
            ? "production-reference-video-gguf.json"
          : useVoiceActorInput
          ? PRODUCTION_LIPSYNC_WORKFLOW_FILE
          : isFirstLastFrame
              ? "production-first-frame-last-frame.json"
              : "production-image-to-video.json";
        const workflowRelativePath = `workflows/production/${workflowFileName}`;
        const workflowId = useReferenceVideoGgufVoiceActor
            ? PRODUCTION_REFERENCE_VIDEO_GGUF_VOICE_ACTOR_WORKFLOW_ID
          : isReferenceVideoGguf
            ? PRODUCTION_REFERENCE_VIDEO_GGUF_WORKFLOW_ID
          : useVoiceActorInput
          ? PRODUCTION_LIPSYNC_WORKFLOW_ID
          : isFirstLastFrame
              ? PRODUCTION_FIRST_LAST_WORKFLOW_ID
              : PRODUCTION_DEFAULT_I2V_WORKFLOW_ID;
        const workflowLabel = useReferenceVideoGgufVoiceActor
            ? PRODUCTION_REFERENCE_VIDEO_GGUF_VOICE_ACTOR_WORKFLOW_LABEL
          : isReferenceVideoGguf
            ? PRODUCTION_REFERENCE_VIDEO_GGUF_WORKFLOW_LABEL
          : useVoiceActorInput
          ? PRODUCTION_LIPSYNC_WORKFLOW_LABEL
          : isFirstLastFrame
              ? PRODUCTION_FIRST_LAST_WORKFLOW_LABEL
              : PRODUCTION_DEFAULT_I2V_WORKFLOW_LABEL;

        if (voiceActorInput.enabled && !useVoiceActorInput) {
          throw new Error(`Frame ${index + 1} has Voice Actor Input enabled, but no saved recording.`);
        }

        const voiceActorBlob = useVoiceActorInput ? voiceActorAudioBlobs[index] : null;
        if (useVoiceActorInput && !voiceActorBlob) {
          throw new Error(`Frame ${index + 1} voice actor recording is not available in this browser session. Redo the recording.`);
        }

        if (
          useVoiceActorInput &&
          Number(voiceActorInput.durationSeconds || 0) > Number(draft.durationSeconds || 0) + 0.25 &&
          typeof window !== "undefined"
        ) {
          const proceed = window.confirm(
            `Frame ${index + 1} voice actor recording is ${Number(voiceActorInput.durationSeconds || 0).toFixed(1)}s, but the clip duration is ${draft.durationSeconds}s. The workflow trim duration will stay ${draft.durationSeconds}s. Submit anyway?`
          );
          if (!proceed) {
            throw new Error(`Frame ${index + 1} voice actor input needs redo before submit.`);
          }
        }

        const form = new FormData();
        form.append("workflowId", workflowId);
        form.append("preset", workflowId);
        form.append("workflowLabel", workflowLabel);
        form.append("workflowFile", workflowFileName);
        form.append("workflowPath", workflowRelativePath);
        form.append("workflowJsonPath", workflowRelativePath);
        form.append("workflowPresetPath", workflowRelativePath);
        form.append("workflowSource", "production-pipeline-uploaded-json");
        form.append(
          "requestKind",
          useReferenceVideoGgufVoiceActor
              ? "production-reference-video-gguf-voice-actor"
            : isReferenceVideoGguf
              ? "production-reference-video-gguf"
            : useVoiceActorInput
            ? isFirstLastFrame
              ? "production-lipsync-first-last-video"
              : "production-lipsync-image-to-video"
            : isFirstLastFrame
                ? "production-first-last-frame-video"
                : "production-default-image-to-video"
        );
        form.append("voiceActorBaseMode", useVoiceActorInput ? (isReferenceVideoMode ? String(draft.animationMode) : isFirstLastFrame ? "first_last_frame" : "image_to_video") : "");
        form.append("title", isFirstLastFrame ? `${sceneSnapshot.title} - Clip ${index + 1} FF-LF` : `${sceneSnapshot.title} - Clip ${index + 1}`);
        form.append("prompt", localPrompt);
        form.append("positivePrompt", localPrompt);
        form.append("negativePrompt", "");
        form.append("durationSeconds", String(draft.durationSeconds));
        form.append("seconds", String(draft.durationSeconds));
        form.append("duration", String(draft.durationSeconds));
        const requestedFrameCount = Math.max(1, Math.round(Number(draft.durationSeconds || 4) * 24)); // OTG_PRODUCTION_DEFAULT_ANIMATE_DURATION_FIELDS_V2
        form.append("duration_frames", String(requestedFrameCount));
        form.append("durationFrames", String(requestedFrameCount));
        form.append("frameCount", String(requestedFrameCount));
        form.append("numFrames", String(requestedFrameCount));
        form.append("totalFrames", String(requestedFrameCount));
        form.append("targetFrames", String(requestedFrameCount));
        form.append("duration_seconds", String(draft.durationSeconds));
        form.append("targetSeconds", String(draft.durationSeconds));
        form.append("frameRate", "24");
        form.append("fps", "24");
        form.append("width", "1280");
        form.append("height", "720");
        if (isReferenceVideoMode) {
          const referenceVideoFrameCount = Math.max(1, Math.round(Number(draft.durationSeconds || 15) * 25));
          const referenceVideoLatentLength = referenceVideoFrameCount;
          form.set("width", "1280");
          form.set("height", "720");
          form.set("fps", "25");
          form.set("frameRate", "25");
          form.set("frameCount", String(referenceVideoFrameCount));
          form.set("numFrames", String(referenceVideoFrameCount));
          form.set("totalFrames", String(referenceVideoFrameCount));
          form.set("targetFrames", String(referenceVideoFrameCount));
          form.set("referenceVideoFrameCount", String(referenceVideoFrameCount));
          form.set("latentLength", String(referenceVideoLatentLength));
          form.set("videoLength", String(referenceVideoLatentLength));
        }
        form.append("outputPrefix", outputPrefix);
        const frameLoras = normalizeProductionLoras(draft.loras);
        if (frameLoras.length) {
          form.append("loras", JSON.stringify(frameLoras.map((item) => ({
            name: item.name,
            strength: item.strength,
            strengthModel: item.strength,
            strengthClip: item.strength,
          }))));
        }
        if (useVoiceActorInput && voiceActorBlob) {
          const audioName = voiceActorInput.audioName || `voice_actor_frame_${index + 1}.webm`;
          form.append("audioA", voiceActorBlob, audioName);
          form.append("voiceActorInput", "true");
          form.append("voiceActorRecordedSeconds", String(voiceActorInput.durationSeconds || ""));
          form.append("voiceActorTrimSeconds", String(draft.durationSeconds));
        }
        form.append("sceneId", sceneId);
        form.append("sceneTitle", sceneSnapshot.title);
        form.append("frameIndex", String(index));
        form.append("animationMode", isReferenceVideoMode ? String(draft.animationMode) : isFirstLastFrame ? "first_last_frame" : "image_to_video");
        form.append("promptSourceFrameIndex", String(index));
        form.append("imageA", sourceFile, sourceFile.name);
        if (isReferenceVideoMode && referenceVideoFile) {
          form.append("image", sourceFile, sourceFile.name);
          form.append("backgroundImage", sourceFile, sourceFile.name);
          form.append("imageB", referenceVideoFile, referenceVideoFile.name);
          form.append("referenceImage1", referenceVideoFile, referenceVideoFile.name);
          form.append("referenceSlot1", referenceVideoFile, referenceVideoFile.name);
          if (useVoiceActorInput) {
            form.append("voiceActorUsesLastFrame", "false");
          }
        } else if (lastFrameFile) {
          form.append("imageB", lastFrameFile, lastFrameFile.name);
          form.append("lastFrameIndex", String(pairedLastFrameIndex));
          if (useVoiceActorInput) {
            form.append("voiceActorUsesLastFrame", "true");
          }
        } else {
          form.append("image", sourceFile, sourceFile.name);
          if (useVoiceActorInput) {
            form.append("voiceActorUsesLastFrame", "false");
          }
        }

        const res = await fetch("/api/comfy", {
          method: "POST",
          credentials: "include",
          body: form,
        });
const data = await res.json().catch(() => null);

        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || `Animate frame ${index + 1} failed (${res.status}).`);
        }

        const promptId = String(data?.promptId || data?.prompt_id || "").trim();

        if (!promptId) {
          throw new Error(`Animate frame ${index + 1} did not return a promptId.`);
        }

        nextClips[index] = {
          ...nextClips[index],
          status: "queued" as const,
          promptId,
          outputPrefix,
          sourceFrameIndex: index,
          requestedDurationSeconds: draft.durationSeconds,
          animationMode: isReferenceVideoMode ? String(draft.animationMode) : isFirstLastFrame ? "first_last_frame" : "image_to_video",
          firstFrameIndex: index,
          lastFrameIndex: isFirstLastFrame ? Number(pairedLastFrameIndex) : undefined,
          promptSourceFrameIndex: index,
          consumedLastFrameIndex: isFirstLastFrame ? Number(pairedLastFrameIndex) : undefined,
          error: undefined,
        };

        updateSceneById(sceneId, {
          frameClips: nextClips,
        });
      }

      setNotice(`Submitted current Animate scene ${activeSubmitFrameIndexV36BPU20C + 1} as 1 LTX 2.3 clip job. Use Sync Scene Clips after Comfy finishes. Submit frames=${frames.length}; first/last pairs=${drafts.filter((item, itemIndex) => item.animationMode === "first_last_frame" && item.lastFrameIndex === itemIndex + 1).length}.`);
      autosaveProductionScenePatchV36BPU43(sceneId, {
        frameClips: nextClips,
      }, "animate");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not submit frame clips.";
      setNotice(message);
    } finally {
      setBusySceneId("");
    }
  }

  function defaultAnimateFrameDuration(scene: ProductionScene | null | undefined) {
    const expectedCount = clampStoryboardImageCount(scene?.imageCount ?? DEFAULT_SCENE_IMAGE_COUNT);
    const totalSeconds = clampStoryboardDuration(scene?.durationSeconds ?? DEFAULT_SCENE_DURATION_SECONDS);
    return clampAnimateFrameDuration(Math.max(1, Math.round(totalSeconds / Math.max(1, expectedCount))));
  }

  function storyboardFramesForAnimate(scene: ProductionScene | null | undefined) {
    const expectedCount = clampStoryboardImageCount(scene?.imageCount ?? DEFAULT_SCENE_IMAGE_COUNT);

    return Array.from({ length: expectedCount }, (_, index) => {
      const image = scene?.images?.[index];
      const fileName = String(image?.fileName || "").trim();
      const url = repoCachedComfyImageUrlV36BPU29(String(
        image?.url ||
          (fileName ? `/api/gallery/file?name=${encodeURIComponent(fileName)}` : "")
      ).trim());

      return {
        index,
        image,
        approved: Boolean(image?.approved || image?.status === "ready"),
        fileName,
        url,
      };
    });
  }

  function animateFrameDrafts(scene: ProductionScene | null | undefined): ProductionFrameAnimation[] {
    const expectedCount = clampStoryboardImageCount(scene?.imageCount ?? DEFAULT_SCENE_IMAGE_COUNT);
    const existing = scene?.animationFrames || [];
    const fallbackSeconds = defaultAnimateFrameDuration(scene);

    return Array.from({ length: expectedCount }, (_, index) => ({
      prompt: preserveAnimateManualPromptSpacingV36BPU22(existing[index]?.prompt ?? ""),
      durationSeconds: clampAnimateFrameDuration(existing[index]?.durationSeconds ?? fallbackSeconds),
      characterRefIds: existing[index]?.characterRefIds || [],
      loras: normalizeProductionLoras(existing[index]?.loras),
      voiceActorInput: existing[index]?.voiceActorInput || { enabled: false, saved: false },
      queueForGeneration: existing[index]?.queueForGeneration !== false,
      animationMode: existing[index]?.animationMode || "image_to_video",
      firstFrameIndex: existing[index]?.firstFrameIndex,
      lastFrameIndex: existing[index]?.lastFrameIndex,
      promptSourceFrameIndex: existing[index]?.promptSourceFrameIndex,
      timelineRole: existing[index]?.timelineRole || "normal",
      consumedByFrameIndex: existing[index]?.consumedByFrameIndex,
      keepAsSeparateSceneAfterPairing: existing[index]?.keepAsSeparateSceneAfterPairing ?? false,
    }));
  }

  function animateFrameClips(scene: ProductionScene | null | undefined): ProductionFrameClip[] {
    const expectedCount = clampStoryboardImageCount(scene?.imageCount ?? DEFAULT_SCENE_IMAGE_COUNT);
    const existing = scene?.frameClips || [];

    return Array.from({ length: expectedCount }, (_, index) => ({
      status: existing[index]?.status || "idle",
      promptId: existing[index]?.promptId,
      fileName: existing[index]?.fileName,
      url: existing[index]?.url,
      error: existing[index]?.error,
      outputPrefix: existing[index]?.outputPrefix,
      sourceFrameIndex: existing[index]?.sourceFrameIndex,
      requestedDurationSeconds: existing[index]?.requestedDurationSeconds,

      // OTG_PRODUCTION_EDIT_REPLACE_SELECTED_RENDER_V1
      editedAt: existing[index]?.editedAt,
      editSource: existing[index]?.editSource,
      originalFileName: existing[index]?.originalFileName,
      originalUrl: existing[index]?.originalUrl,
      editManifest: existing[index]?.editManifest,
    }));
  }

  function animateTotalSeconds(scene: ProductionScene | null | undefined) {
    return animateFrameDrafts(scene).reduce((total, frame) => total + frame.durationSeconds, 0);
  }

  function clampProductionLoraStrength(value: any) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 1;
    return Math.max(MIN_PRODUCTION_LORA_STRENGTH, Math.min(MAX_PRODUCTION_LORA_STRENGTH, Math.round(numeric * 100) / 100));
  }

  function normalizeProductionLoras(loras: ProductionLoraSelection[] | undefined | null) {
    const seen = new Set<string>();
    const normalized: ProductionLoraSelection[] = [];

    for (const item of Array.isArray(loras) ? loras : []) {
      const name = String(item?.name || "").trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      normalized.push({
        name,
        strength: clampProductionLoraStrength(item?.strength ?? 1),
      });
      if (normalized.length >= MAX_PRODUCTION_ANIMATE_LORAS) break;
    }

    return normalized;
  }

  function selectedProductionLoraName(frameIndex: number) {
    return String(
      animateLoraPickByFrame[frameIndex] ||
        productionLoraOptions[0]?.name ||
        ""
    ).trim();
  }

  function setSelectedProductionLoraName(frameIndex: number, name: string) {
    setAnimateLoraPickByFrame((previous) => ({
      ...previous,
      [frameIndex]: name,
    }));
  }

  function addProductionLoraToFrame(frameIndex: number) {
    const name = selectedProductionLoraName(frameIndex);
    if (!name) {
      setNotice("No LORA selected.");
      return;
    }

    const frames = animateFrameDrafts(selectedScene);
    const current = normalizeProductionLoras(frames[frameIndex]?.loras);
    if (current.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      setNotice(`${name} is already added to Frame ${frameIndex + 1}.`);
      return;
    }
    if (current.length >= MAX_PRODUCTION_ANIMATE_LORAS) {
      setNotice(`Frame ${frameIndex + 1} already has the maximum ${MAX_PRODUCTION_ANIMATE_LORAS} LORAs.`);
      return;
    }

    updateAnimateFrameDraft(frameIndex, {
      loras: [...current, { name, strength: 1 }],
    });
  }

  function updateProductionFrameLoraStrength(frameIndex: number, loraName: string, strength: number) {
    const frames = animateFrameDrafts(selectedScene);
    const current = normalizeProductionLoras(frames[frameIndex]?.loras);
    updateAnimateFrameDraft(frameIndex, {
      loras: current.map((item) =>
        item.name === loraName ? { ...item, strength: clampProductionLoraStrength(strength) } : item
      ),
    });
  }

  function removeProductionLoraFromFrame(frameIndex: number, loraName: string) {
    const frames = animateFrameDrafts(selectedScene);
    const current = normalizeProductionLoras(frames[frameIndex]?.loras);
    updateAnimateFrameDraft(frameIndex, {
      loras: current.filter((item) => item.name !== loraName),
    });
  }

  function voiceActorInputForFrame(frameIndex: number) {
    const frames = animateFrameDrafts(selectedScene);
    return frames[frameIndex]?.voiceActorInput || { enabled: false, saved: false };
  }

  function updateVoiceActorInputForFrame(frameIndex: number, patch: Partial<ProductionVoiceActorInput>) {
    const current = voiceActorInputForFrame(frameIndex);
    updateAnimateFrameDraft(frameIndex, {
      voiceActorInput: {
        ...current,
        ...patch,
      },
    });
  }

  function audioExtensionForMimeType(mimeType: string) {
    const lower = String(mimeType || "").toLowerCase();
    if (lower.includes("wav")) return "wav";
    if (lower.includes("ogg")) return "ogg";
    if (lower.includes("mp4") || lower.includes("m4a")) return "m4a";
    return "webm";
  }

  async function startVoiceActorRecording(frameIndex: number) {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setNotice("This browser does not support microphone recording.");
      return;
    }

    if (voiceActorRecordingFrameIndex !== null) {
      setNotice("Stop the current recording before starting another one.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ];
      const mimeType = preferredTypes.find((type) => {
        try {
          return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type);
        } catch {
          return false;
        }
      });

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      voiceActorChunksRef.current = [];
      voiceActorStartedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          voiceActorChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const actualMime = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(voiceActorChunksRef.current, { type: actualMime });
        const durationSeconds = Math.max(0.1, (Date.now() - voiceActorStartedAtRef.current) / 1000);
        const ext = audioExtensionForMimeType(actualMime);
        const audioName = `voice_actor_frame_${frameIndex + 1}_${Date.now()}.${ext}`;
        const audioUrl = URL.createObjectURL(blob);

        setVoiceActorAudioBlobs((previous) => ({
          ...previous,
          [frameIndex]: blob,
        }));

        updateVoiceActorInputForFrame(frameIndex, {
          enabled: true,
          saved: false,
          audioName,
          audioUrl,
          durationSeconds,
          mimeType: actualMime,
          recordedAt: new Date().toISOString(),
        });

        setVoiceActorRecordingFrameIndex(null);
        voiceActorRecorderRef.current = null;
        voiceActorStreamRef.current?.getTracks().forEach((track) => track.stop());
        voiceActorStreamRef.current = null;
      };

      voiceActorRecorderRef.current = recorder;
      voiceActorStreamRef.current = stream;
      setVoiceActorRecordingFrameIndex(frameIndex);
      recorder.start();
    } catch (error) {
      setVoiceActorRecordingFrameIndex(null);
      voiceActorRecorderRef.current = null;
      voiceActorStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceActorStreamRef.current = null;
      setNotice(error instanceof Error ? error.message : "Could not start microphone recording.");
    }
  }

  function stopVoiceActorRecording() {
    const recorder = voiceActorRecorderRef.current;
    if (!recorder) return;
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  function redoVoiceActorRecording(frameIndex: number) {
    setVoiceActorAudioBlobs((previous) => {
      const next = { ...previous };
      delete next[frameIndex];
      return next;
    });
    updateVoiceActorInputForFrame(frameIndex, {
      saved: false,
      audioName: "",
      audioUrl: "",
      durationSeconds: 0,
      mimeType: "",
      recordedAt: "",
    });
  }

  function saveVoiceActorRecording(frameIndex: number) {
    const input = voiceActorInputForFrame(frameIndex);
    if (!voiceActorAudioBlobs[frameIndex] || !input.audioName) {
      setNotice("Record audio before saving voice actor input.");
      return;
    }
    updateVoiceActorInputForFrame(frameIndex, {
      enabled: true,
      saved: true,
    });
    setNotice(`Voice actor input saved for Frame ${frameIndex + 1}.`);
  }

    function updateAnimateFrameDraft(
      index: number,
      patch: Partial<ProductionFrameAnimation>,
      options?: {
        renderFrames?: ReturnType<typeof storyboardFramesForAnimate>;
        completedQwenScenes?: QwenCompletedSceneForAnimateV36BPU3[];
      }
    ) {
    if (!selectedScene) return;

    const safeIndex = Math.max(0, Math.floor(Number(index) || 0));
    const renderFrames = Array.isArray(options?.renderFrames) ? options.renderFrames : [];
    const completedQwenScenes = Array.isArray(options?.completedQwenScenes) ? options.completedQwenScenes : [];
    if (patch.durationSeconds !== undefined) {
      const nextDuration = clampAnimateFrameDuration(Number(patch.durationSeconds));
      setAnimateDurationOverrideByFrameV36BPU42((previous) => ({
        ...previous,
        [animateDurationOverrideKeyV36BPU42(selectedScene.id, safeIndex)]: nextDuration,
      }));
    }

    setScenes((previousScenes) =>
      previousScenes.map((scene) => {
        if (scene.id !== selectedScene.id) return scene;

        const canonicalFrames = storyboardFramesForAnimate(scene);
        const useRenderFrames = renderFrames.length > canonicalFrames.length;
        const nextScene: ProductionScene = { ...scene };

        if (useRenderFrames) {
          // V36BPU40: duration edits must write to the same hydrated frame list the Animate UI renders.
          const qwenImages = completedQwenScenes.length >= renderFrames.length
            ? qwenSceneImagesForAnimateV36BPU3(completedQwenScenes)
            : [];
          nextScene.imageCount = renderFrames.length;
          nextScene.images = renderFrames.map((frame, frameIndex) => {
            const qwenImage = qwenImages[frameIndex];
            const currentImage = scene.images?.[frameIndex] || frame.image || qwenImage || {};
            const url = String(frame.url || (currentImage as any).url || (currentImage as any).imageUrl || (qwenImage as any)?.url || "").trim();
            const fileName = String(frame.fileName || (currentImage as any).fileName || (qwenImage as any)?.fileName || "").trim();
            return {
              ...(qwenImage || {}),
              ...(currentImage as any),
              id: (currentImage as any).id || (qwenImage as any)?.id || `animate-frame-${frameIndex + 1}`,
              approved: true,
              status: (currentImage as any).status || "ready",
              url,
              imageUrl: (currentImage as any).imageUrl || url,
              fileName,
            } as StoryboardImage;
          });
        }

        const drafts = animateFrameDrafts(nextScene).map((draft) => ({ ...draft }));
        const fallbackDurationSeconds = defaultAnimateFrameDuration(nextScene);

        while (drafts.length <= safeIndex) {
          const nextIndex = drafts.length;
          drafts.push({
            prompt: "",
            durationSeconds: fallbackDurationSeconds,
            characterRefIds: [],
            loras: [],
            voiceActorInput: { enabled: false, saved: false },
            queueForGeneration: true,
            animationMode: "image_to_video",
            firstFrameIndex: undefined,
            lastFrameIndex: undefined,
            promptSourceFrameIndex: nextIndex,
            timelineRole: "normal",
            consumedByFrameIndex: undefined,
            consumedLastFrameIndex: undefined,
            keepAsSeparateSceneAfterPairing: false,
          } as ProductionFrameAnimation);
        }

        const current = drafts[safeIndex] || ({
          prompt: "",
          durationSeconds: fallbackDurationSeconds,
          characterRefIds: [],
          loras: [],
          voiceActorInput: { enabled: false, saved: false },
          queueForGeneration: true,
          animationMode: "image_to_video",
          promptSourceFrameIndex: safeIndex,
          timelineRole: "normal",
          keepAsSeparateSceneAfterPairing: false,
        } as ProductionFrameAnimation);

        drafts[safeIndex] = {
          ...current,
          ...patch,
          prompt: patch.prompt !== undefined ? otgAnimateManualPromptRawV36BPU24B(patch.prompt) : current.prompt,
          durationSeconds: clampAnimateFrameDuration(patch.durationSeconds ?? current.durationSeconds ?? fallbackDurationSeconds),
          characterRefIds: patch.characterRefIds ?? current.characterRefIds ?? [],
          loras: patch.loras !== undefined ? normalizeProductionLoras(patch.loras) : normalizeProductionLoras(current.loras),
          voiceActorInput: patch.voiceActorInput ?? current.voiceActorInput ?? { enabled: false, saved: false },
          queueForGeneration: patch.queueForGeneration ?? current.queueForGeneration ?? true,
          animationMode: patch.animationMode ?? current.animationMode ?? "image_to_video",
          firstFrameIndex: patch.firstFrameIndex ?? current.firstFrameIndex,
          lastFrameIndex: patch.lastFrameIndex ?? current.lastFrameIndex,
          promptSourceFrameIndex: patch.promptSourceFrameIndex ?? current.promptSourceFrameIndex ?? safeIndex,
          timelineRole: patch.timelineRole ?? current.timelineRole ?? "normal",
          consumedByFrameIndex: patch.consumedByFrameIndex ?? current.consumedByFrameIndex,
          consumedLastFrameIndex: patch.consumedLastFrameIndex ?? current.consumedLastFrameIndex,
          keepAsSeparateSceneAfterPairing: patch.keepAsSeparateSceneAfterPairing ?? current.keepAsSeparateSceneAfterPairing ?? false,
        };

        return {
          ...nextScene,
          animationFrames: drafts,
        };
      })
    );
  }

    function buildDirectorImportedFrames(): ProductionDirectorImportedFrame[] {
    const scene = selectedScene;
    if (!scene) return [];

    const frames = storyboardFramesForAnimate(scene);
    const drafts = animateFrameDrafts(scene);
    const imported: ProductionDirectorImportedFrame[] = [];
    const seen = new Set<string>();

    frames.forEach((frame) => {
      const imageUrl = String(frame.url || "").trim();
      const imagePath = String(frame.fileName || "").trim();
      const key = imageUrl || imagePath;

      if (!key || seen.has(key)) return;

      seen.add(key);
      imported.push({
        imagePath,
        imageUrl,
        prompt: preserveAnimateManualPromptSpacingV36BPU22(drafts[frame.index]?.prompt ?? ""),
        label: `${scene.title || "Scene"} frame ${frame.index + 1}`,
      });
    });

    return imported.slice(0, 4);
  }



// OTG_PRODUCTION_STORYBOARD_PROGRESS_REFRESH_V1B_START
  function resetStoryboardGenerationProgress(imageCount: number) {
    const safeCount = Math.max(1, Math.floor(Number(imageCount) || DEFAULT_SCENE_IMAGE_COUNT));

    setStoryboardGenerationRunId((previous) => previous + 1);
    setStoryboardComfyProgress({
      ...emptyComfyProgressState(),
      running: true,
      readyToSync: false,
      percent: 0,
      label: `Starting storyboard generation for ${safeCount} image${safeCount === 1 ? "" : "s"}.`,
      detail: "generation-started",
    });
  }

  function isAnimateLastFrameConsumed(draft: ProductionFrameAnimation | undefined) {
    return draft?.timelineRole === "last_frame_for" && draft.consumedByFrameIndex !== undefined && !draft.keepAsSeparateSceneAfterPairing;
  }

  function sceneForAnimatePairingV36BPU18(
    scene: ProductionScene,
    renderedCompletedScenes?: QwenCompletedSceneForAnimateV36BPU3[],
    renderFrames?: ReturnType<typeof storyboardFramesForAnimate>
  ) {
    let workingScene = scene;
    let frames = storyboardFramesForAnimate(workingScene);
    const canonicalFramesLengthBeforeHydration = frames.length;
    let drafts = animateFrameDrafts(workingScene).map((draft) => ({ ...draft }));
    let frameClips = animateFrameClips(workingScene);
    const completedScenesFromRender = Array.isArray(renderedCompletedScenes) ? renderedCompletedScenes : [];
    const completedScenes = completedScenesFromRender.length ? completedScenesFromRender : loadCompletedQwenScenesForAnimateV36BPU3();
    const renderFramesFromCall = Array.isArray(renderFrames) ? renderFrames : [];
    let syncPatch: Partial<ProductionScene> & Record<string, any> = {};
    const frameFromImageV36BPU22 = (image: StoryboardImage, index: number) => {
      const fileName = String(image.fileName || "").trim();
      const url = String(image.url || (image as any).imageUrl || (fileName ? `/api/gallery/file?name=${encodeURIComponent(fileName)}` : "")).trim();
      return {
        index,
        image,
        approved: Boolean(image.approved || image.status === "ready" || url),
        fileName,
        url,
      };
    };
    const extendDraftsForFrameCountV36BPU22 = (sourceDrafts: ProductionFrameAnimation[], count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...(sourceDrafts[index] || {}),
        prompt: preserveAnimateManualPromptSpacingV36BPU22(sourceDrafts[index]?.prompt || ``),
        durationSeconds: clampAnimateFrameDuration(sourceDrafts[index]?.durationSeconds ?? defaultAnimateFrameDuration(scene)),
        characterRefIds: sourceDrafts[index]?.characterRefIds || [],
        loras: normalizeProductionLoras(sourceDrafts[index]?.loras),
        voiceActorInput: sourceDrafts[index]?.voiceActorInput || { enabled: false, saved: false },
        queueForGeneration: sourceDrafts[index]?.queueForGeneration !== false,
        animationMode: sourceDrafts[index]?.animationMode || "image_to_video",
        timelineRole: sourceDrafts[index]?.timelineRole || "normal",
        keepAsSeparateSceneAfterPairing: sourceDrafts[index]?.keepAsSeparateSceneAfterPairing ?? false,
      } as ProductionFrameAnimation));
    const extendClipsForFrameCountV36BPU22 = (sourceClips: ProductionFrameClip[], count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...(sourceClips[index] || {}),
        status: sourceClips[index]?.status || "idle",
        sourceFrameIndex: sourceClips[index]?.sourceFrameIndex ?? index,
      } as ProductionFrameClip));

    // V36BPU20: Pair/unpair must hydrate the stale canonical scene from the same full Qwen scene list used by render.
    if (completedScenes.length > frames.length) {
      const syncedImages = qwenSceneImagesForAnimateV36BPU3(completedScenes);
      const syncedDrafts = qwenSceneAnimationDraftsForAnimateV36BPU3(completedScenes, drafts).map((draft) => ({ ...draft }));
      const syncedClips = qwenSceneFrameClipsForAnimateV36BPU3(completedScenes, frameClips);

      workingScene = {
        ...workingScene,
        imageCount: completedScenes.length,
        images: syncedImages,
        animationFrames: syncedDrafts,
        frameClips: syncedClips,
      } as ProductionScene;

      frames = syncedImages.map(frameFromImageV36BPU22);
      drafts = syncedDrafts;
      frameClips = syncedClips;
      syncPatch = {
        imageCount: completedScenes.length,
        images: syncedImages,
        animationFrames: syncedDrafts,
        frameClips: syncedClips,
        prompt: completedScenes.map((item, index) => `Scene ${index + 1}: ${item.name}`).join("\n"),
        motionNotes: [
          `Qwen storyboard handoff: ${completedScenes.length} completed scene image(s).`,
          `${completedScenes.length} scene-by-scene image-to-video clip(s) queued by default.`,
          "Pair adjacent scenes manually when a first-frame/last-frame transition is needed.",
        ].filter(Boolean).join(" "),
        qwenAnimateHandoffSourceV36BPU3: QWEN_ANIMATE_HANDOFF_SOURCE_V36BPU3,
        qwenAnimateHandoffSignatureV36BPU3: qwenSceneHandoffSignatureV36BPU3(completedScenes),
        qwenAnimateHandoffUpdatedAtV36BPU3: new Date().toISOString(),
      };
    }

    if (renderFramesFromCall.length > frames.length) {
      const syncedImages = renderFramesFromCall.map((frame, index) => ({
        ...(frame.image || {}),
        id: frame.image?.id || `animate-render-frame-${index + 1}`,
        promptId: frame.image?.promptId || `animate-render-frame-${index + 1}`,
        prompt: (frame.image as any)?.prompt || `Scene ${index + 1}`,
        status: frame.image?.status || "ready",
        approved: frame.image?.approved ?? Boolean(frame.approved || frame.url),
        url: frame.image?.url || frame.url,
        fileName: frame.image?.fileName || frame.fileName || `scene_${index + 1}.png`,
        imageUrl: (frame.image as any)?.imageUrl || frame.url,
        imagePath: (frame.image as any)?.imagePath || (frame.image as any)?.workflowImage || frame.fileName || frame.url,
        workflowImage: (frame.image as any)?.workflowImage || (frame.image as any)?.imagePath || frame.fileName || frame.url,
      } as unknown as StoryboardImage));
      const syncedDrafts = extendDraftsForFrameCountV36BPU22(drafts, renderFramesFromCall.length);
      const syncedClips = extendClipsForFrameCountV36BPU22(frameClips, renderFramesFromCall.length);

      workingScene = {
        ...workingScene,
        imageCount: renderFramesFromCall.length,
        images: syncedImages,
        animationFrames: syncedDrafts,
        frameClips: syncedClips,
      } as ProductionScene;

      frames = renderFramesFromCall;
      drafts = syncedDrafts;
      frameClips = syncedClips;
      syncPatch = {
        ...syncPatch,
        imageCount: renderFramesFromCall.length,
        images: syncedImages,
        animationFrames: syncedDrafts,
        frameClips: syncedClips,
        qwenAnimateHandoffUpdatedAtV36BPU3: new Date().toISOString(),
      };
    }

    return { workingScene, frames, drafts, syncPatch, canonicalFramesLengthBeforeHydration, qwenScenesLength: completedScenes.length, renderFramesLength: renderFramesFromCall.length };
  }

  function firstLastPairDebugTextV36BPU19() {
    const debug = firstLastPairDebugV36BPU19;
    const parts = [
      `Last first/last action: ${debug.action}`,
      debug.sceneId ? `scene=${debug.sceneId}` : "scene=none",
      debug.frameIndex !== undefined ? `frame=${debug.frameIndex}` : "frame=none",
      debug.framesLength !== undefined ? `frames=${debug.framesLength}` : "frames=unknown",
    ];
    if (debug.reason) parts.push(`reason=${debug.reason}`);
    return parts.join(", ");
  }

  function recordFirstLastPairDebugV36BPU19(
    action: "none" | "panel-capture" | "clicked" | "applied" | "rejected",
    sceneId: string,
    frameIndex: number,
    framesLength: number | undefined,
    reason = ""
  ) {
    setFirstLastPairDebugV36BPU19({
      action,
      sceneId,
      frameIndex,
      framesLength,
      reason,
    });
  }

  function pairAnimateSceneWithNext(args: {
    sceneId: string;
    frameIndex: number;
    renderFrames?: ReturnType<typeof storyboardFramesForAnimate>;
    completedQwenScenes?: QwenCompletedSceneForAnimateV36BPU3[];
  }) {
    const { sceneId, frameIndex, renderFrames = [], completedQwenScenes = [] } = args;
    const safeFrameIndex = Math.max(0, Math.floor(Number(frameIndex) || 0));
    const nextIndex = safeFrameIndex + 1;
    setActiveAnimateSceneIndexV36BPU10B(safeFrameIndex);
    setNotice(`Pair button clicked for Scene ${safeFrameIndex + 1}.`);
    recordFirstLastPairDebugV36BPU19("clicked", sceneId, safeFrameIndex, renderFrames.length, `handler=pairAnimateSceneWithNext, renderFrames=${renderFrames.length}, qwenScenes=${completedQwenScenes.length}`);

    let noticeText = "";
    let didApply = false;
    let debugFramesLength = renderFrames.length;
    let debugDetail = `handler=pairAnimateSceneWithNext, renderFrames=${renderFrames.length}, qwenScenes=${completedQwenScenes.length}`;

    setScenes((previousScenes) => {
      let foundScene = false;
      const nextScenes = previousScenes.map((scene) => {
        if (scene.id !== sceneId) return scene;
        foundScene = true;

        const { workingScene, frames, drafts, syncPatch, canonicalFramesLengthBeforeHydration, qwenScenesLength, renderFramesLength } = sceneForAnimatePairingV36BPU18(scene, completedQwenScenes, renderFrames);
        debugFramesLength = frames.length;
        debugDetail = `handler=pairAnimateSceneWithNext, renderFrames=${renderFramesLength}, qwenScenes=${qwenScenesLength}, canonicalBefore=${canonicalFramesLengthBeforeHydration}, hydratedFrames=${frames.length}`;

        if (!drafts[safeFrameIndex]) {
          noticeText = `Pair rejected: Scene ${safeFrameIndex + 1} is not available.`;
          return scene;
        }

        if (safeFrameIndex >= frames.length - 1 || !frames[nextIndex]) {
          noticeText = "Pair rejected: the final Animate scene cannot use the next scene as a last frame.";
          return scene;
        }

        if (isAnimateLastFrameConsumed(drafts[safeFrameIndex])) {
          noticeText = `Pair rejected: Scene ${safeFrameIndex + 1} is already being used as another clip's last frame.`;
          return scene;
        }

        if (isAnimateLastFrameConsumed(drafts[nextIndex])) {
          noticeText = `Pair rejected: Scene ${nextIndex + 1} is already being used as another clip's last frame.`;
          return scene;
        }

        if (!frames[safeFrameIndex]?.url || !frames[nextIndex]?.url) {
          noticeText = `Pair rejected: Scene ${safeFrameIndex + 1} and Scene ${nextIndex + 1} both need approved images before pairing.`;
          return scene;
        }

        // V36BPU18: explicit functional pair write; render reads this same canonical animationFrames array.
        drafts[safeFrameIndex] = {
          ...drafts[safeFrameIndex],
          animationMode: "first_last_frame",
          firstFrameIndex: safeFrameIndex,
          lastFrameIndex: nextIndex,
          promptSourceFrameIndex: safeFrameIndex,
          timelineRole: "normal",
          consumedByFrameIndex: undefined,
          consumedLastFrameIndex: nextIndex,
          queueForGeneration: true,
        };
        drafts[nextIndex] = {
          ...drafts[nextIndex],
          animationMode: "image_to_video",
          firstFrameIndex: undefined,
          lastFrameIndex: undefined,
          promptSourceFrameIndex: undefined,
          timelineRole: "last_frame_for",
          consumedByFrameIndex: safeFrameIndex,
          consumedLastFrameIndex: undefined,
          queueForGeneration: false,
          keepAsSeparateSceneAfterPairing: drafts[nextIndex]?.keepAsSeparateSceneAfterPairing ?? false,
        };

        didApply = true;
        noticeText = `Pair applied Scene ${safeFrameIndex + 1} -> Scene ${nextIndex + 1}. imageA=Scene ${safeFrameIndex + 1}, imageB=Scene ${nextIndex + 1}, animationMode=first_last_frame.`;
        return { ...workingScene, ...syncPatch, animationFrames: drafts };
      });

      if (!foundScene) {
        noticeText = `Pair rejected: selected production scene was not found.`;
        return previousScenes;
      }

      return didApply ? nextScenes : previousScenes;
    });

    window.setTimeout(() => {
      const finalNotice = noticeText || "Pair rejected: no first-frame/last-frame state change was applied.";
      setNotice(finalNotice);
      recordFirstLastPairDebugV36BPU19(didApply ? "applied" : "rejected", sceneId, safeFrameIndex, debugFramesLength, `${debugDetail}, ${didApply ? `Pair applied Scene ${safeFrameIndex + 1} -> Scene ${nextIndex + 1}` : finalNotice}`);
    }, 0);
  }

  function unpairAnimateScene(args: {
    sceneId: string;
    frameIndex: number;
    renderFrames?: ReturnType<typeof storyboardFramesForAnimate>;
    completedQwenScenes?: QwenCompletedSceneForAnimateV36BPU3[];
  }) {
    const { sceneId, frameIndex, renderFrames = [], completedQwenScenes = [] } = args;
    const safeFrameIndex = Math.max(0, Math.floor(Number(frameIndex) || 0));
    const nextIndex = safeFrameIndex + 1;
    setActiveAnimateSceneIndexV36BPU10B(safeFrameIndex);
    setNotice(`Unpair button clicked for Scene ${safeFrameIndex + 1}.`);
    recordFirstLastPairDebugV36BPU19("clicked", sceneId, safeFrameIndex, renderFrames.length, `handler=unpairAnimateScene, renderFrames=${renderFrames.length}, qwenScenes=${completedQwenScenes.length}`);

    let noticeText = "";
    let didApply = false;
    let debugFramesLength = renderFrames.length;
    let debugDetail = `handler=unpairAnimateScene, renderFrames=${renderFrames.length}, qwenScenes=${completedQwenScenes.length}`;

    setScenes((previousScenes) => {
      let foundScene = false;
      const nextScenes = previousScenes.map((scene) => {
        if (scene.id !== sceneId) return scene;
        foundScene = true;

        const { workingScene, frames, drafts, syncPatch, canonicalFramesLengthBeforeHydration, qwenScenesLength, renderFramesLength } = sceneForAnimatePairingV36BPU18(scene, completedQwenScenes, renderFrames);
        debugFramesLength = frames.length;
        debugDetail = `handler=unpairAnimateScene, renderFrames=${renderFramesLength}, qwenScenes=${qwenScenesLength}, canonicalBefore=${canonicalFramesLengthBeforeHydration}, hydratedFrames=${frames.length}`;

        if (!drafts[safeFrameIndex]) {
          noticeText = `Unpair rejected: Scene ${safeFrameIndex + 1} is not available.`;
          return scene;
        }

        const pairedLastIndex = typeof drafts[safeFrameIndex]?.lastFrameIndex === "number" ? Number(drafts[safeFrameIndex].lastFrameIndex) : nextIndex;
        drafts[safeFrameIndex] = {
          ...drafts[safeFrameIndex],
          animationMode: "image_to_video",
          firstFrameIndex: undefined,
          lastFrameIndex: undefined,
          promptSourceFrameIndex: undefined,
          consumedLastFrameIndex: undefined,
          timelineRole: "normal",
          consumedByFrameIndex: undefined,
          queueForGeneration: true,
        };
        if (drafts[pairedLastIndex]?.consumedByFrameIndex === safeFrameIndex) {
          drafts[pairedLastIndex] = {
            ...drafts[pairedLastIndex],
            animationMode: "image_to_video",
            firstFrameIndex: undefined,
            lastFrameIndex: undefined,
            promptSourceFrameIndex: undefined,
            timelineRole: "normal",
            consumedByFrameIndex: undefined,
            consumedLastFrameIndex: undefined,
            queueForGeneration: true,
          };
        }

        didApply = true;
        noticeText = `Unpaired Scene ${safeFrameIndex + 1}. Scene ${pairedLastIndex + 1} can animate independently again.`;
        return { ...workingScene, ...syncPatch, animationFrames: drafts };
      });

      if (!foundScene) {
        noticeText = `Unpair rejected: selected production scene was not found.`;
        return previousScenes;
      }

      return didApply ? nextScenes : previousScenes;
    });

    window.setTimeout(() => {
      const finalNotice = noticeText || "Unpair rejected: no first-frame/last-frame state change was applied.";
      setNotice(finalNotice);
      recordFirstLastPairDebugV36BPU19(didApply ? "applied" : "rejected", sceneId, safeFrameIndex, debugFramesLength, `${debugDetail}, ${finalNotice}`);
    }, 0);
  }

  function setAnimateNextSceneAsLastFrame(frameIndex: number, enabled: boolean) {
    if (!selectedScene?.id) return;
    if (enabled) {
      pairAnimateSceneWithNext({ sceneId: selectedScene.id, frameIndex });
    } else {
      unpairAnimateScene({ sceneId: selectedScene.id, frameIndex });
    }
  }

  function resetAnimateGenerationProgress(clipCount: number) {
    const safeCount = Math.max(1, Math.floor(Number(clipCount) || 1));

    setAnimateGenerationRunId((previous) => previous + 1);
    setAnimateComfyProgress({
      ...emptyComfyProgressState(),
      running: true,
      readyToSync: false,
      percent: 0,
      label: `Starting animation for ${safeCount} frame clip${safeCount === 1 ? "" : "s"}.`,
      detail: "generation-started",
      completedPrompts: 0,
      totalPrompts: safeCount,
    });
  }
// OTG_PRODUCTION_STORYBOARD_PROGRESS_REFRESH_V1B_END
// OTG_PRODUCTION_STORYBOARD_SYNC_PROGRESS_DEDUPE_V1_START
  function storyboardImageSyncStats(scene: ProductionScene | null | undefined) {
    const expectedCount = clampStoryboardImageCount(scene?.imageCount ?? DEFAULT_SCENE_IMAGE_COUNT);
    const images = Array.from({ length: expectedCount }, (_, index) => scene?.images?.[index]).filter(Boolean);
    const ready = images.filter((image: any) => image?.status === "ready" || image?.approved).length;
    const queued = images.filter((image: any) => image?.status === "queued").length;
    const error = images.filter((image: any) => image?.status === "error").length;
    const empty = Math.max(0, expectedCount - images.length);
    const percent = expectedCount > 0 ? Math.round((ready / expectedCount) * 100) : 0;

    return {
      expectedCount,
      ready,
      queued,
      error,
      empty,
      percent,
      complete: ready >= expectedCount,
      hasQueued: queued > 0,
      hasError: error > 0,
    };
  }

  function normalizeStoryboardProgressPayload(data: any) {
    const rawPercent =
      data?.percent ??
      data?.progressPercent ??
      data?.progress ??
      data?.value ??
      data?.currentProgress ??
      null;

    let percent: number | null = null;

    if (typeof rawPercent === "number" && Number.isFinite(rawPercent)) {
      percent = rawPercent <= 1 ? Math.round(rawPercent * 100) : Math.round(rawPercent);
    } else if (typeof rawPercent === "string" && rawPercent.trim()) {
      const parsed = Number(rawPercent.replace("%", ""));
      if (Number.isFinite(parsed)) percent = parsed <= 1 ? Math.round(parsed * 100) : Math.round(parsed);
    }

    if (percent !== null) {
      percent = Math.max(0, Math.min(100, percent));
    }

    const nodeProgress = data?.currentNodeProgress;
    const nodeValue = Number(nodeProgress?.value);
    const nodeMax = Number(nodeProgress?.max);
    const currentNodeProgress =
      Number.isFinite(nodeValue) && Number.isFinite(nodeMax) && nodeMax > 0
        ? `${Math.round(nodeValue)}/${Math.round(nodeMax)}`
        : "";

    const statusText = String(data?.status || data?.serverState || data?.state || data?.message || "").toLowerCase();
    const queueRemaining = Number(
      data?.queueRemaining ??
        data?.queue_remaining ??
        data?.queue?.remaining ??
        data?.queue?.queue_remaining ??
        NaN
    );

    const running =
      statusText.includes("running") ||
      statusText.includes("processing") ||
      statusText.includes("queued") ||
      (Number.isFinite(queueRemaining) && queueRemaining > 0) ||
      (percent !== null && percent > 0 && percent < 100);

    const readyToSync =
      statusText.includes("idle") ||
      statusText.includes("complete") ||
      statusText.includes("completed") ||
      percent === 100 ||
      (Number.isFinite(queueRemaining) && queueRemaining === 0);

    return {
      running,
      readyToSync,
      percent,
      label: readyToSync ? "Comfy generation looks complete. Run Complete Scene." : running ? "Comfy generation is running." : "",
      detail: statusText || "",
      elapsedMs: Number.isFinite(Number(data?.elapsedMs)) ? Number(data.elapsedMs) : null,
      estimatedRemainingMs: Number.isFinite(Number(data?.estimatedRemainingMs)) ? Number(data.estimatedRemainingMs) : null,
      doneNodes: Number.isFinite(Number(data?.doneNodes)) ? Math.max(0, Math.floor(Number(data.doneNodes))) : 0,
      totalNodes: Number.isFinite(Number(data?.totalNodes)) ? Math.max(0, Math.floor(Number(data.totalNodes))) : 0,
      currentNodeId: String(data?.currentNodeId || data?.nodeName || "").trim(),
      currentNodeProgress,
    };
  }

  function storyboardSavedItemDedupeKey(item: any) {
    const haystack = [
      item?.name,
      item?.fileName,
      item?.filename,
      item?.path,
      item?.url,
      item?.imageUrl,
    ]
      .map((value) => String(value || ""))
      .filter(Boolean)
      .join(" ");

    const slashParts = haystack.split(/[\\/]/g);
    const basename = slashParts[slashParts.length - 1] || haystack;

    const numericMatches = Array.from(basename.matchAll(/(?:^|[_\-\s])(\d{4,})(?=\.[a-z0-9]+|\b|$)/gi));
    if (numericMatches.length) {
      return `num:${numericMatches[numericMatches.length - 1][1]}`;
    }

    return basename
      .toLowerCase()
      .replace(/^comfyui_temp_[a-z0-9_-]*_/i, "")
      .replace(/^untitled production\s*-\s*scene\s*\d+\s*/i, "")
      .replace(/\?.*$/, "")
      .trim();
  }

  function storyboardSavedItemOrderNumber(item: any) {
    const key = storyboardSavedItemDedupeKey(item);
    const match = key.match(/num:(\d+)/);
    if (!match) return Number.POSITIVE_INFINITY;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  }

  function pickUniqueStoryboardSavedItems(savedItems: any[], expectedCount: number) {
    const sortedNewestFirst = sortStoryboardSavedItems(savedItems || []).sort((a, b) => {
      const an = storyboardSavedItemOrderNumber(a);
      const bn = storyboardSavedItemOrderNumber(b);

      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return bn - an;
      if (Number.isFinite(an)) return -1;
      if (Number.isFinite(bn)) return 1;
      return 0;
    });

    const seen = new Set<string>();
    const newestUnique: any[] = [];

    for (const item of sortedNewestFirst) {
      const key = storyboardSavedItemDedupeKey(item);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      newestUnique.push(item);
      if (newestUnique.length >= expectedCount) break;
    }

    // Select the newest N outputs, then map them back into slot order.
    // Example: if slots 2 and 4 were regenerated and Comfy produced 00003 and 00004,
    // use 00003 for the first queued slot and 00004 for the next queued slot.
    return newestUnique.sort((a, b) => {
      const an = storyboardSavedItemOrderNumber(a);
      const bn = storyboardSavedItemOrderNumber(b);
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
      if (Number.isFinite(an)) return -1;
      if (Number.isFinite(bn)) return 1;
      return String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { numeric: true, sensitivity: "base" });
    });
  }

  function renderStoryboardGenerationStatus(scene: ProductionScene | null | undefined) {
    const stats = storyboardImageSyncStats(scene);
    const hasSubmitted = stats.queued > 0 || stats.ready > 0 || stats.error > 0 || storyboardComfyProgress.running || storyboardComfyProgress.readyToSync;

    if (!scene || !hasSubmitted) return null;

    const statusLabel = stats.complete
      ? "Storyboard images synced"
      : storyboardComfyProgress.readyToSync
        ? "Ready to sync"
        : stats.hasQueued
          ? "Generating or waiting for sync"
          : stats.hasError
            ? "Needs attention"
            : "Waiting";

    const progressPercent = stats.complete
      ? 100
      : storyboardComfyProgress.percent !== null && stats.ready < stats.expectedCount
        ? Math.max(stats.percent, storyboardComfyProgress.percent)
        : stats.percent;

    return (
      <div className="mt-4 rounded-[14px] border border-cyan-300/20 bg-cyan-300/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-white/80">
              {statusLabel}
            </div>
            <div className="mt-1 text-sm text-cyan-50/80">
              {stats.ready}/{stats.expectedCount} synced
              {stats.queued ? ` - ${stats.queued} queued` : ""}
              {stats.error ? ` - ${stats.error} error` : ""}
              {stats.empty ? ` - ${stats.empty} empty` : ""}
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs font-black text-white/70">
            {progressPercent}%
          </div>
        </div>

        <div className="mt-3 h-3 overflow-hidden rounded-full bg-black/35">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#67e8f9,#a78bfa)] transition-all duration-500"
            style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
          />
        </div>

        <div className="mt-3 grid gap-2 text-xs leading-5 text-cyan-50/70 sm:grid-cols-2">
          <div>
            Elapsed: {storyboardComfyProgress.elapsedMs !== null ? formatProductionProgressDuration(storyboardComfyProgress.elapsedMs) : "--"}
            {" | "}
            ETA: {storyboardComfyProgress.estimatedRemainingMs !== null ? formatProductionProgressDuration(storyboardComfyProgress.estimatedRemainingMs) : "--"}
          </div>
          {storyboardComfyProgress.totalNodes > 0 ? (
            <div>
              Nodes: {Math.min(storyboardComfyProgress.doneNodes, storyboardComfyProgress.totalNodes)}/{storyboardComfyProgress.totalNodes}
              {storyboardComfyProgress.currentNodeId ? ` | Current ${storyboardComfyProgress.currentNodeId}${storyboardComfyProgress.currentNodeProgress ? ` (${storyboardComfyProgress.currentNodeProgress})` : ""}` : ""}
            </div>
          ) : storyboardComfyProgress.currentNodeProgress ? (
            <div>Current node: {storyboardComfyProgress.currentNodeProgress}</div>
          ) : null}
        </div>

        <div className="mt-3 text-xs leading-5 text-cyan-50/75">
          {stats.complete
            ? "All storyboard slots are approved. Continue to Animate."
            : storyboardComfyProgress.readyToSync
              ? "Comfy appears finished. Click Complete Scene to map one unique output into each storyboard slot."
              : storyboardComfyProgress.running
                ? storyboardComfyProgress.label || "Comfy is still generating. Complete Scene should be used after it completes."
                : "If Comfy has finished, click Complete Scene. The sync step now deduplicates temp and renamed copies."}
        </div>
      </div>
    );
  }

  function renderAnimateGenerationStatus(scene: ProductionScene | null | undefined) {
    const clips = animateFrameClips(scene);
    const submittedClips = clips.filter((clip: any) => {
      const promptId = String(clip?.promptId || "").trim();
      return Boolean(promptId || clip?.status === "queued" || clip?.status === "ready");
    });
    const progressClips = submittedClips.length ? submittedClips : clips;
    const total = Math.max(
      progressClips.length,
      animateComfyProgress.totalPrompts || 0,
      animateComfyProgress.running ? 1 : 0
    );
    const ready = progressClips.filter((clip: any) => clip?.status === "ready").length;
    const queued = submittedClips.length;
    const hasSubmitted = queued > 0 || ready > 0 || animateComfyProgress.running || animateComfyProgress.readyToSync;

    if (!scene || !total || !hasSubmitted) return null;

    const progressPercent = ready >= total
      ? 100
      : animateComfyProgress.percent !== null
        ? Math.max(Math.round((ready / total) * 100), animateComfyProgress.percent)
        : Math.round((ready / total) * 100);
    const completedPrompts = animateComfyProgress.completedPrompts ?? ready;
    const totalPrompts = animateComfyProgress.totalPrompts ?? total;

    return (
      <div className="mb-4 rounded-[14px] border border-cyan-300/20 bg-cyan-300/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-white/80">
              {ready >= total ? "Scene clips synced" : animateComfyProgress.readyToSync ? "Ready to sync clips" : "Animating scene clips"}
            </div>
            <div className="mt-1 text-sm text-cyan-50/80">
              {ready}/{total} synced
              {completedPrompts || totalPrompts ? ` | ${completedPrompts}/${totalPrompts} Comfy prompt${totalPrompts === 1 ? "" : "s"} complete` : ""}
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs font-black text-white/70">
            {progressPercent}%
          </div>
        </div>

        <div className="mt-3 h-3 overflow-hidden rounded-full bg-black/35">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#67e8f9,#a78bfa)] transition-all duration-500"
            style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
          />
        </div>

        <div className="mt-3 grid gap-2 text-xs leading-5 text-cyan-50/70 sm:grid-cols-2">
          <div>
            Elapsed: {animateComfyProgress.elapsedMs !== null ? formatProductionProgressDuration(animateComfyProgress.elapsedMs) : "--"}
            {" | "}
            ETA: {animateComfyProgress.estimatedRemainingMs !== null ? formatProductionProgressDuration(animateComfyProgress.estimatedRemainingMs) : "--"}
          </div>
          {animateComfyProgress.totalNodes > 0 ? (
            <div>
              Nodes: {Math.min(animateComfyProgress.doneNodes, animateComfyProgress.totalNodes)}/{animateComfyProgress.totalNodes}
              {animateComfyProgress.currentNodeId ? ` | Current ${animateComfyProgress.currentNodeId}${animateComfyProgress.currentNodeProgress ? ` (${animateComfyProgress.currentNodeProgress})` : ""}` : ""}
            </div>
          ) : animateComfyProgress.currentNodeProgress ? (
            <div>Current node: {animateComfyProgress.currentNodeProgress}</div>
          ) : null}
        </div>

        <div className="mt-3 text-xs leading-5 text-cyan-50/75">
          {ready >= total
            ? "All scene clips are synced and ready for review."
            : animateComfyProgress.readyToSync
              ? "Comfy appears finished. Click Sync Scene Clips to import and map each clip."
              : animateComfyProgress.label || "ComfyUI is animating scene clips."}
        </div>
      </div>
    );
  }
// OTG_PRODUCTION_STORYBOARD_SYNC_PROGRESS_DEDUPE_V1_END

// OTG_PRODUCTION_ANIMATE_IMAGEB64_FIX_V3_START
  async function productionAnimateImageUrlToBase64(imageUrl: string) {
    const url = String(imageUrl || "").trim();
    if (!url) return "";

    const response = await fetch(url, {
      cache: "no-store",
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Could not load Animate source image for base64 payload: ${response.status}`);
    }

    const blob = await response.blob();
    if (!blob.size) {
      throw new Error("Animate source image was empty.");
    }

    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    let binary = "";

    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...Array.from(chunk));
    }

    return window.btoa(binary);
  }
// OTG_PRODUCTION_ANIMATE_IMAGEB64_FIX_V3_END

// OTG_PRODUCTION_ANIMATE_CLIP_EXPAND_V1_START
  function renderExpandedAnimateClipModal(scene: ProductionScene | null | undefined, frameClips: any[]) {
    const expandedIndex = typeof expandedAnimateClipIndex === "number" ? expandedAnimateClipIndex : -1;
    const clip = expandedIndex >= 0 ? frameClips[expandedIndex] : null;

    if (!clip?.url) return null;

    const readyIndexes = frameClips
      .map((candidate, index) => (candidate?.url ? index : -1))
      .filter((index) => index >= 0);

    const readyPosition = readyIndexes.indexOf(expandedIndex);
    const previousIndex = readyPosition > 0 ? readyIndexes[readyPosition - 1] : null;
    const nextIndex = readyPosition >= 0 && readyPosition < readyIndexes.length - 1 ? readyIndexes[readyPosition + 1] : null;
    const clipTitle = `${scene?.title || "Scene"} - Clip ${expandedIndex + 1}`;

    return (
      <div
        className="fixed inset-0 z-[90] grid place-items-center bg-black/80 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Expanded generated clip"
        onClick={() => setExpandedAnimateClipIndex(null)}
      >
        <div
          className="w-full max-w-6xl overflow-hidden rounded-[22px] border border-white/15 bg-slate-950 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex flex-col gap-3 border-b border-white/10 bg-white/[0.04] p-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-200/75">
                Expanded Clip
              </p>
              <h3 className="mt-1 truncate text-xl font-black text-white">{clipTitle}</h3>
              <p className="mt-1 truncate text-xs text-white/45">{clip.fileName || "No filename"}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={previousIndex === null}
                onClick={() => {
                  if (previousIndex !== null) setExpandedAnimateClipIndex(previousIndex);
                }}
                className="rounded-[12px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={nextIndex === null}
                onClick={() => {
                  if (nextIndex !== null) setExpandedAnimateClipIndex(nextIndex);
                }}
                className="rounded-[12px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                Next
              </button>
              <a
                href={clip.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-[12px] border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100"
              >
                Open File
              </a>
              <button
                type="button"
                onClick={() => setExpandedAnimateClipIndex(null)}
                className="rounded-[12px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-white"
              >
                Close
              </button>
            </div>
          </div>

          <div className="bg-black">
            <video
              src={clip.url}
              controls
              autoPlay
              className="max-h-[72vh] w-full bg-black object-contain"
            />
          </div>

          <div className="grid gap-3 border-t border-white/10 bg-white/[0.03] p-4 text-xs text-white/60 md:grid-cols-4">
            <div>
              <span className="block text-white/35">Status</span>
              <span className="font-black text-emerald-200">{clip.status || "unknown"}</span>
            </div>
            <div>
              <span className="block text-white/35">Prompt ID</span>
              <span className="break-all">{clip.promptId || "none"}</span>
            </div>
            <div>
              <span className="block text-white/35">Requested duration</span>
              <span>{clip.requestedDurationSeconds ? `${clip.requestedDurationSeconds}s` : "not recorded"}</span>
            </div>
            <div>
              <span className="block text-white/35">Source frame</span>
              <span>{typeof clip.sourceFrameIndex === "number" ? clip.sourceFrameIndex + 1 : expandedIndex + 1}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
// OTG_PRODUCTION_ANIMATE_CLIP_EXPAND_V1_END
function renderAnimateStage() {
    return (
      <section className="space-y-4">
        {renderExpandedAnimateClipModal(selectedScene, selectedScene ? animateFrameClips(selectedScene) : [])} {/* OTG_PRODUCTION_ANIMATE_CLIP_EXPAND_SCENE_REFERENCE_FIX_V1 */}
        <section className="rounded-[14px] border border-slate-200 bg-slate-950 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-violet-400">Animate Mode</div>
              <p className="mt-1 text-xs text-slate-300">Default Mode is active for Animate. Director Mode is temporarily disabled while the production workflow is being updated.</p>
              <p data-marker="OTG_PRODUCTION_ANIMATE_RESTORE_UI_V1_NOTE" className="mt-2 text-xs font-bold text-emerald-200">Animate controls restored: set scene prompts, queue scene clips, animate all ready clips, then sync generated clips.</p>
            </div>
            <div className="flex rounded-[14px] border border-slate-700 bg-slate-900 p-1 text-xs font-black">
              <span className="rounded-[10px] bg-slate-800 px-4 py-2 text-white">Default Mode</span>
              <span className="rounded-[10px] px-4 py-2 text-slate-500 opacity-60" title="Temporarily disabled">Director Mode</span>
            </div>
          </div>
        </section>
        {renderDefaultAnimateStage()}
      </section>
    );
  }
function renderDefaultAnimateStage() {
    const scene = selectedScene;
    let frames = storyboardFramesForAnimate(scene);
    let animateDrafts = animateFrameDrafts(scene);
    let frameClips = animateFrameClips(scene);
    const characterOptions = animateCharacterOptions(scene);
    let approvedFrames = frames.filter((frame) => frame.approved && frame.url);
    let expectedCount = clampStoryboardImageCount(scene?.imageCount ?? DEFAULT_SCENE_IMAGE_COUNT);
    const totalAnimateSeconds = animateTotalSeconds(scene);
    const readyClips = frameClips.filter((clip) => clip.status === "ready" && clip.url);
    const canPrepareClips = Boolean(scene && approvedFrames.length >= expectedCount);
    let effectiveAnimateClipCountV36BPU3 = animateDrafts.filter((draft) => draft.queueForGeneration !== false && !isAnimateLastFrameConsumed(draft)).length;
    let readyEffectiveClipsV36BPU3 = frameClips.filter((clip, index) => {
      const draft = animateDrafts[index];
      return draft?.queueForGeneration !== false && !isAnimateLastFrameConsumed(draft) && clip.status === "ready" && clip.url;
    }).length;
    let queuedAnimateFrames = effectiveAnimateClipCountV36BPU3;
    const completedQwenScenesForAnimateV36BPU3 = loadCompletedQwenScenesForAnimateV36BPU3();
    if (completedQwenScenesForAnimateV36BPU3.length > frames.length) {
      const qwenImagesForUiV36BPU12 = qwenSceneImagesForAnimateV36BPU3(completedQwenScenesForAnimateV36BPU3);
      frames = qwenImagesForUiV36BPU12.map((image, index) => {
        const fileName = String(image.fileName || "").trim();
        const url = String(image.url || (image as any).imageUrl || (fileName ? `/api/gallery/file?name=${encodeURIComponent(fileName)}` : "")).trim();
        return {
          index,
          image,
          approved: Boolean(image.approved || image.status === "ready" || url),
          fileName,
          url,
        };
      });
      animateDrafts = qwenSceneAnimationDraftsForAnimateV36BPU3(completedQwenScenesForAnimateV36BPU3, animateDrafts);
      frameClips = qwenSceneFrameClipsForAnimateV36BPU3(completedQwenScenesForAnimateV36BPU3, frameClips);
      approvedFrames = frames.filter((frame) => frame.approved && frame.url);
      expectedCount = completedQwenScenesForAnimateV36BPU3.length;
      effectiveAnimateClipCountV36BPU3 = animateDrafts.filter((draft) => draft.queueForGeneration !== false && !isAnimateLastFrameConsumed(draft)).length;
      readyEffectiveClipsV36BPU3 = frameClips.filter((clip, index) => {
        const draft = animateDrafts[index];
        return draft?.queueForGeneration !== false && !isAnimateLastFrameConsumed(draft) && clip.status === "ready" && clip.url;
      }).length;
      queuedAnimateFrames = effectiveAnimateClipCountV36BPU3;
    }
    const qwenFirstLastPairCountV36BPU3 = animateDrafts.filter((draft, index) => draft.animationMode === "first_last_frame" && draft.lastFrameIndex === index + 1 && !isAnimateLastFrameConsumed(draft)).length;
    const qwenOutputClipCountV36BPU6 = animateDrafts.filter((draft) => draft.queueForGeneration !== false && !isAnimateLastFrameConsumed(draft)).length;
    const focusedAnimateSceneIndexV36BPU10B = Math.max(0, Math.min(Math.max(0, frames.length - 1), activeAnimateSceneIndexV36BPU10B));
    return (
      <section className="space-y-6 pb-28">
        <div data-otg-animate-restored="Render Plan" data-marker="OTG_PRODUCTION_ANIMATE_RESTORE_UI_V1" className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/80">Animate</p>
              <h2 className="mt-2 text-2xl font-black text-white">Image-to-Video Clip Setup</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">
                Each storyboard scene becomes its own LTX 2.3 image-to-video clip by default. Click a scene card, write its motion prompt, set seconds, add LoRAs or Voice Actor Input, and optionally pair it with the next scene as last frame.
              </p>
            </div>

            <div className="rounded-[14px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/70">
              <div className="font-black text-white">{scene?.title || "No scene selected"}</div>
              <div>Scenes ready: {approvedFrames.length}/{expectedCount}</div>
              <div>Clips ready: {readyEffectiveClipsV36BPU3}/{effectiveAnimateClipCountV36BPU3 || expectedCount}</div>
              <div>Queued: {queuedAnimateFrames}/{effectiveAnimateClipCountV36BPU3 || expectedCount}</div>
              <div>Total clip time: {totalAnimateSeconds}s</div>
            </div>
          </div>

          {renderQwenAnimateHandoffSummaryV36BPU3(
            completedQwenScenesForAnimateV36BPU3,
            qwenFirstLastPairCountV36BPU3,
            qwenOutputClipCountV36BPU6
          )}

          {!canPrepareClips ? (
            <div className="mt-4 rounded-[14px] border border-amber-300/25 bg-amber-300/10 p-4 text-sm text-amber-100">
              Approve and sync all scene pass preview for this scene before animation.
            </div>
          ) : (
            <div className="mt-4 rounded-[14px] border border-emerald-300/25 bg-emerald-300/10 p-4 text-sm text-emerald-100">
              Storyboard scenes are ready. Each queued scene submits one Animate job; paired last-frame scenes are skipped as separate outputs.
            </div>
          )}
        </div>

        <div data-otg-animate-restored="Render Plan" data-marker="OTG_PRODUCTION_ANIMATE_RESTORE_UI_V1" className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-white/45">Ordered Scenes</p>
              <h3 className="text-lg font-black text-white">Scene Animation Prompts</h3>
              <p className="mt-1 text-sm text-white/35">
                Expand each scene, inspect the image, choose included characters, then write exact motion instructions, clip length, LoRA, and Voice Actor Input.
              </p>
            </div>
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-black text-white/60">
              {queuedAnimateFrames} queued scene clip{queuedAnimateFrames === 1 ? "" : "s"}
            </span>
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-white/10 bg-black/20 p-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Current Scene</div>
              <div className="text-sm font-black text-white">Scene {focusedAnimateSceneIndexV36BPU10B + 1} of {frames.length}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={focusedAnimateSceneIndexV36BPU10B <= 0}
                onClick={() => focusAnimateSceneEditorV36BPU6(focusedAnimateSceneIndexV36BPU10B - 1)}
                className="rounded-[12px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                Previous Scene
              </button>
              <button
                type="button"
                disabled={focusedAnimateSceneIndexV36BPU10B >= frames.length - 1}
                onClick={() => focusAnimateSceneEditorV36BPU6(focusedAnimateSceneIndexV36BPU10B + 1)}
                className="rounded-[12px] border border-violet-300/30 bg-violet-300/10 px-3 py-2 text-xs font-black text-violet-50 disabled:cursor-not-allowed disabled:opacity-35"
              >
                Next Scene
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {frames.filter((frame) => frame.index === focusedAnimateSceneIndexV36BPU10B).map((frame) => {
              const rawDraft = animateDrafts[frame.index];
              const draft = {
                ...rawDraft,
                durationSeconds: animateDurationWithOverrideV36BPU42(scene?.id || "", frame.index, rawDraft.durationSeconds),
              };
              const clip = frameClips[frame.index];
              const selectedIds = new Set(draft.characterRefIds || []);
              const globalPromptPreview = animateGlobalPromptForFrame(scene, frame.index);
              const isQueuedForGeneration = draft.queueForGeneration !== false;
              const pairedLastFrameIndex = draft.animationMode === "first_last_frame" ? draft.lastFrameIndex : undefined;
              const isFirstLastFrame = pairedLastFrameIndex === frame.index + 1;
              const consumedByFrameIndex = draft.consumedByFrameIndex;
              const isConsumedLastFrame = isAnimateLastFrameConsumed(draft);
              const nextFrame = frames[frame.index + 1];
              const updateRenderedAnimateFrameDurationV36BPU41 = (value: number) => updateAnimateFrameDraft(
                frame.index,
                { durationSeconds: Number(value) },
                { renderFrames: frames, completedQwenScenes: completedQwenScenesForAnimateV36BPU3 }
              );

              return (
                <details
                  key={frame.index}
                  id={`animate-scene-editor-${frame.index + 1}`}
                  data-otg-animate-scene-editor={String(frame.index)}
                  open={frame.index === focusedAnimateSceneIndexV36BPU10B}
                  className={isConsumedLastFrame ? "overflow-hidden rounded-[16px] border border-purple-300/20 bg-purple-950/20 opacity-70" : "overflow-hidden rounded-[16px] border border-white/10 bg-black/20"}
                >
                  <summary className="grid cursor-pointer list-none gap-3 p-3 md:grid-cols-[220px_1fr_auto] md:items-center">
                    <div className="relative aspect-video overflow-hidden rounded-[12px] bg-white/3">
                      {frame.url ? (
                        <img
                          src={frame.url}
                          alt={`${scene?.title || "Scene"} frame ${frame.index + 1}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-white/35">
                          Missing frame
                        </div>
                      )}
                      <span className="absolute left-2 top-2 rounded-full bg-black/75 px-2 py-1 text-xs font-black text-white">
                        Frame {frame.index + 1}
                      </span>
                      <label
                        className="absolute bottom-2 left-2 flex cursor-pointer items-center gap-2 rounded-full bg-black/75 px-2 py-1 text-[11px] font-black text-white"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isQueuedForGeneration}
                          disabled={isConsumedLastFrame}
                          onChange={(event) => updateAnimateFrameDraft(
                            frame.index,
                            { queueForGeneration: event.target.checked },
                            { renderFrames: frames, completedQwenScenes: completedQwenScenesForAnimateV36BPU3 }
                          )}
                          className="h-3.5 w-3.5 accent-cyan-300"
                        />
                        {isQueuedForGeneration ? "Queue" : "Skip"}
                      </label>
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-black text-white">Frame {frame.index + 1}</span>
                        <span className={frame.approved ? "rounded-full bg-emerald-300/15 px-2 py-1 text-xs font-black text-emerald-300" : "rounded-full bg-amber-300/15 px-2 py-1 text-xs font-black text-amber-300"}>
                          {frame.approved ? "Storyboard Ready" : "Not Ready"}
                        </span>
                        <span className="rounded-full bg-white/3 px-2 py-1 text-xs font-black text-white/35">
                          {draft.durationSeconds}s
                        </span>
                        <span className="rounded-full bg-white/3 px-2 py-1 text-xs font-black text-white/35">
                          Characters: {selectedIds.size}
                        </span>
                        <span className="rounded-full bg-white/3 px-2 py-1 text-xs font-black text-white/35">
                          Clip: {clip.status}
                        </span>
                        <span className={isQueuedForGeneration ? "rounded-full bg-cyan-300/15 px-2 py-1 text-xs font-black text-cyan-200" : "rounded-full bg-white/3 px-2 py-1 text-xs font-black text-white/45"}>
                          {isQueuedForGeneration ? "Queue" : "Skip"}
                        </span>
                        {isFirstLastFrame ? (
                          <span className="rounded-full bg-purple-300/20 px-2 py-1 text-xs font-black text-purple-100">
                            FF/LF -&gt; Frame {Number(pairedLastFrameIndex) + 1}
                          </span>
                        ) : null}
                        {isConsumedLastFrame ? (
                          <span className="rounded-full bg-purple-300/20 px-2 py-1 text-xs font-black text-purple-100">
                            Last frame for Frame {Number(consumedByFrameIndex) + 1}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-white/60">
                        {draft.prompt || "No animation prompt yet."}
                      </p>
                    </div>

                    <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/80">
                      Expand
                    </div>
                  </summary>

                  <div className="grid gap-4 border-t border-white/10 p-4 lg:grid-cols-[minmax(260px,0.8fr)_1fr]">
                    <div className="space-y-3">
                      <div className="overflow-hidden rounded-[14px] border border-white/10 bg-black/30">
                        {frame.url ? (
                          <img
                            src={frame.url}
                            alt={`${scene?.title || "Scene"} expanded frame ${frame.index + 1}`}
                            className="w-full object-contain"
                          />
                        ) : (
                          <div className="flex aspect-video items-center justify-center text-sm text-white/35">
                            Missing frame
                          </div>
                        )}
                      </div>
                      <div className="truncate rounded-[12px] border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/30">
                        {frame.fileName || "No source file"}
                      </div>

                      <div className="rounded-[14px] border border-white/10 bg-white/[0.03] p-3">
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                          Characters Present
                        </div>

                        {animateCharacterPresetErrorV36BPU26B ? (
                          <p className="mt-2 text-xs leading-5 text-amber-200/75">Saved character preset loading failed: {animateCharacterPresetErrorV36BPU26B}</p>
                        ) : animateCharacterPresetLoadingV36BPU26B ? (
                          <p className="mt-2 text-xs leading-5 text-cyan-100/60">Loading saved character presets...</p>
                        ) : null}

                        {characterOptions.length ? (
                          <div className="mt-3 space-y-2">
                            {characterOptions.map((character) => (
                              <label
                                key={character.id || "character"}
                                className="flex cursor-pointer items-center gap-3 rounded-[12px] border border-white/10 bg-black/20 p-2"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(character.id)}
                                  onChange={(event) => toggleAnimateFrameCharacter(frame.index, character.id, event.target.checked)}
                                  onClick={(event) => event.stopPropagation()}
                                  className="h-4 w-4"
                                />
                                <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[10px] border border-white/10 bg-white/3 text-xs font-black text-white/45">
                                  {character.previewUrl ? (
                                    <img src={character.previewUrl} alt={character.label} className="h-full w-full object-cover" />
                                  ) : (
                                    character.index + 1
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-black text-white">{character.label}</div>
                                  <div className="truncate text-xs text-white/45">{character.fileName || "Storyboard reference"}</div>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      appendAnimateCharacterDescriptionToPromptV36BPU25(frame.index, character);
                                    }}
                                    className="mt-1 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-100 hover:border-cyan-200/50 hover:bg-cyan-300/20"
                                  >
                                    Add description to prompt
                                  </button>
                                </div>
                              </label>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm leading-6 text-white/30">
                            No scene-attached or saved character presets are available for this scene.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="block">
                        <span className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                          LTX 2.3 Animation Prompt
                        </span>
                        <textarea
                          value={draft.prompt}
                          onChange={(event) => updateAnimateFrameDraft(
                            frame.index,
                            { prompt: event.target.value },
                            { renderFrames: frames, completedQwenScenes: completedQwenScenesForAnimateV36BPU3 }
                          )}
                          rows={6}
                          className="mt-2 w-full resize-y rounded-[14px] border border-white/10 bg-black/30 p-3 text-sm leading-6 text-white outline-none focus:border-cyan-300/30"
                          placeholder={`Describe how frame ${frame.index + 1} should move. Include camera motion, subject motion, speed, mood, and what must stay consistent.`}
                        />
                      </label>

                      <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
                        <div className="block">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                              Clip Duration
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  updateRenderedAnimateFrameDurationV36BPU41(draft.durationSeconds - 1);
                                }}
                                disabled={draft.durationSeconds <= MIN_ANIMATE_FRAME_DURATION_SECONDS}
                                className="grid h-7 w-7 place-items-center rounded-[8px] border border-white/10 bg-black/30 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-35"
                                aria-label="Decrease clip duration"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min={MIN_ANIMATE_FRAME_DURATION_SECONDS}
                                max={MAX_ANIMATE_FRAME_DURATION_SECONDS}
                                step={1}
                                value={draft.durationSeconds}
                                onPointerDown={(event) => event.stopPropagation()}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => updateRenderedAnimateFrameDurationV36BPU41(Number(event.target.value))}
                                className="h-7 w-14 rounded-[8px] border border-white/10 bg-black/40 px-2 text-center text-xs font-black text-white outline-none focus:border-cyan-300/40"
                                aria-label="Clip duration seconds"
                              />
                              <span className="text-[11px] font-black text-white/45">s</span>
                              <button
                                type="button"
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  updateRenderedAnimateFrameDurationV36BPU41(draft.durationSeconds + 1);
                                }}
                                disabled={draft.durationSeconds >= MAX_ANIMATE_FRAME_DURATION_SECONDS}
                                className="grid h-7 w-7 place-items-center rounded-[8px] border border-white/10 bg-black/30 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-35"
                                aria-label="Increase clip duration"
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <input
                            type="range"
                            min={MIN_ANIMATE_FRAME_DURATION_SECONDS}
                            max={MAX_ANIMATE_FRAME_DURATION_SECONDS}
                            step={1}
                            value={draft.durationSeconds}
                            onPointerDown={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            onInput={(event) => updateRenderedAnimateFrameDurationV36BPU41(Number(event.currentTarget.value))}
                            onChange={(event) => updateRenderedAnimateFrameDurationV36BPU41(Number(event.target.value))}
                            className="mt-2 w-full touch-none accent-cyan-300"
                          />
                          <div className="mt-1 flex justify-between text-[11px] font-black uppercase tracking-[0.16em] text-white/35">
                            <span>{MIN_ANIMATE_FRAME_DURATION_SECONDS}s</span>
                            <span className="text-cyan-100">{draft.durationSeconds}s</span>
                            <span>{MAX_ANIMATE_FRAME_DURATION_SECONDS}s</span>
                          </div>
                        </div>

                        <div className="rounded-[14px] border border-cyan-300/15 bg-cyan-300/10 p-3">
                          <div className="text-xs font-black uppercase tracking-[0.18em] text-white/80">LORA</div>
                          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                            <select
                              value={selectedProductionLoraName(frame.index)}
                              onChange={(event) => setSelectedProductionLoraName(frame.index, event.target.value)}
                              disabled={productionLoraLoading || !productionLoraOptions.length || normalizeProductionLoras(draft.loras).length >= MAX_PRODUCTION_ANIMATE_LORAS}
                              className="min-w-0 flex-1 rounded-[10px] border border-white/10 bg-black/40 px-3 py-2 text-xs font-bold text-white outline-none focus:border-cyan-300/30 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              {productionLoraOptions.length ? (
                                productionLoraOptions.map((option) => (
                                  <option key={option.name} value={option.name}>{option.name}</option>
                                ))
                              ) : (
                                <option value="">{productionLoraLoading ? "Loading LORAs..." : "No LORAs found"}</option>
                              )}
                            </select>
                            <button
                              type="button"
                              onClick={() => addProductionLoraToFrame(frame.index)}
                              disabled={productionLoraLoading || !selectedProductionLoraName(frame.index) || normalizeProductionLoras(draft.loras).length >= MAX_PRODUCTION_ANIMATE_LORAS}
                              className="rounded-[10px] bg-cyan-400 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Add
                            </button>
                            <button
                              type="button"
                              onClick={() => refreshProductionLoraOptions(true)}
                              disabled={productionLoraLoading}
                              className="rounded-[10px] border border-white/10 bg-black/30 px-3 py-2 text-xs font-black text-cyan-100 transition hover:border-cyan-300/40 disabled:cursor-not-allowed disabled:opacity-45"
                              title="Force reload LORAs from the ComfyUI worker"
                            >
                              {productionLoraLoading ? "Refreshing..." : "Refresh"}
                            </button>
                          </div>
                          {productionLoraError ? (
                            <div className="mt-2 text-[11px] font-bold text-amber-200">{productionLoraError}</div>
                          ) : null}

                          <div className="mt-3 space-y-2">
                            {normalizeProductionLoras(draft.loras).length ? (
                              normalizeProductionLoras(draft.loras).map((lora) => (
                                <div key={lora.name} className="rounded-[10px] border border-white/10 bg-black/25 p-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0 truncate text-xs font-black text-white">{lora.name}</div>
                                    <button
                                      type="button"
                                      onClick={() => removeProductionLoraFromFrame(frame.index, lora.name)}
                                      className="shrink-0 rounded-full border border-white/10 px-2 py-1 text-[10px] font-black text-white/60 transition hover:text-white"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                  <div className="mt-2 flex items-center gap-2">
                                    <input
                                      type="range"
                                      min={MIN_PRODUCTION_LORA_STRENGTH}
                                      max={MAX_PRODUCTION_LORA_STRENGTH}
                                      step={0.05}
                                      value={lora.strength}
                                      onChange={(event) => updateProductionFrameLoraStrength(frame.index, lora.name, Number(event.target.value))}
                                      className="w-full accent-cyan-300"
                                    />
                                    <span className="w-10 text-right text-[11px] font-black text-cyan-100">{lora.strength.toFixed(2)}</span>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="rounded-[10px] border border-dashed border-white/10 px-3 py-2 text-xs text-white/45">
                                No LORAs added. Up to {MAX_PRODUCTION_ANIMATE_LORAS} per clip.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-[14px] border border-rose-300/20 bg-rose-400/10 p-3">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-rose-100/80">Voice Actor Input</div>
                            <p className="mt-1 text-xs leading-5 text-rose-50/65">
                              Record a voice performance for this frame. Works with normal image-to-video and first-frame / last-frame. The saved recording is sent to the lip-sync workflow; trim duration matches the clip duration.
                            </p>
                          </div>
                          <label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-white/70">
                            <input
                              type="checkbox"
                              checked={Boolean(draft.voiceActorInput?.enabled)}
                              onChange={(event) => {
                                const enabled = event.target.checked;
                                updateVoiceActorInputForFrame(frame.index, {
                                  enabled,
                                  saved: enabled ? draft.voiceActorInput?.saved : false,
                                });
                              }}
                              className="h-4 w-4 accent-rose-400"
                            />
                            Enable
                          </label>
                        </div>

                        {draft.voiceActorInput?.enabled ? (
                          <div className="mt-3 rounded-[12px] border border-white/10 bg-black/25 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {voiceActorRecordingFrameIndex === frame.index ? (
                                <button
                                  type="button"
                                  onClick={stopVoiceActorRecording}
                                  className="rounded-full bg-red-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-red-950/30 transition hover:bg-red-500"
                                >
                                  Stop
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => startVoiceActorRecording(frame.index)}
                                  disabled={!draft.voiceActorInput?.enabled || voiceActorRecordingFrameIndex !== null}
                                  className="rounded-full bg-red-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-red-950/30 transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Record
                                </button>
                              )}

                              {draft.voiceActorInput?.audioUrl ? (
                                <>
                                  <audio controls src={draft.voiceActorInput.audioUrl} className="h-9 max-w-full" />
                                  <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] font-black text-white/60">
                                    {Number(draft.voiceActorInput.durationSeconds || 0).toFixed(1)}s recorded
                                  </span>
                                  {Number(draft.voiceActorInput.durationSeconds || 0) > Number(draft.durationSeconds || 0) + 0.25 ? (
                                    <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[11px] font-black text-amber-100">
                                      Longer than {draft.durationSeconds}s clip
                                    </span>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => redoVoiceActorRecording(frame.index)}
                                    className="rounded-[10px] border border-white/10 bg-black/30 px-3 py-2 text-xs font-black text-white/70 transition hover:text-white"
                                  >
                                    Redo
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => saveVoiceActorRecording(frame.index)}
                                    disabled={!voiceActorAudioBlobs[frame.index]}
                                    className="rounded-[10px] bg-emerald-500 px-3 py-2 text-xs font-black text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    {draft.voiceActorInput?.saved ? "Saved" : "Save"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => void handleVoiceActorTranscribeFromButton(event.currentTarget)}
                                    disabled={!draft.voiceActorInput?.audioUrl}
                                    className="rounded-[10px] border border-cyan-300/40 bg-cyan-500/20 px-3 py-2 text-xs font-black text-cyan-50 transition hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    Transcribe
                                  </button>
                                  <div className="basis-full rounded-xl border border-cyan-300/20 bg-cyan-950/20 p-3 text-xs text-cyan-100" data-otg="OTG_VOICE_ACTOR_TRANSCRIBE_VISIBLE_UI_V26">
                                    <div className="font-black uppercase tracking-[0.16em] text-cyan-200">Lip sync note</div>
                                    <p className="mt-1 text-white/80">
                                      For best lip sync, the exact words spoken in Voice Actor Input should also be written in the frame prompt.
                                    </p>
                                  </div>
                                </>
                              ) : (
                                <span className="text-xs font-bold text-white/30">No recording yet.</span>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div
                        className="rounded-[14px] border border-purple-300/20 bg-purple-300/10 p-3"
                        onPointerDownCapture={() => {
                          if (scene?.id) recordFirstLastPairDebugV36BPU19("panel-capture", scene.id, frame.index, frames.length, "pointerdown capture fired");
                        }}
                        onClickCapture={() => {
                          if (scene?.id) recordFirstLastPairDebugV36BPU19("panel-capture", scene.id, frame.index, frames.length, "click capture fired");
                        }}
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-white/75">
                              First-frame / Last-frame Pair
                            </div>
                            <p className="mt-1 text-sm leading-6 text-purple-50/75">
                              Use Scene {frame.index + 1} as the first frame and Scene {frame.index + 2} as the last frame. Prompt stays from Scene {frame.index + 1}.
                            </p>
                          </div>
                          {isFirstLastFrame ? (
                            <button
                              type="button"
                              aria-pressed="true"
                              onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                firstLastPairPointerHandledAtRefV36BPU19.current = Date.now();
                                if (scene?.id) {
                                  unpairAnimateScene({
                                    sceneId: scene.id,
                                    frameIndex: frame.index,
                                    renderFrames: frames,
                                    completedQwenScenes: completedQwenScenesForAnimateV36BPU3,
                                  });
                                }
                              }}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                if (Date.now() - firstLastPairPointerHandledAtRefV36BPU19.current < 800) return;
                                if (scene?.id) {
                                  unpairAnimateScene({
                                    sceneId: scene.id,
                                    frameIndex: frame.index,
                                    renderFrames: frames,
                                    completedQwenScenes: completedQwenScenesForAnimateV36BPU3,
                                  });
                                }
                              }}
                              className="flex cursor-pointer items-center gap-2 rounded-[12px] border border-purple-200/50 bg-purple-300/25 px-3 py-2 text-xs font-black text-purple-50"
                            >
                              <span className="grid h-4 w-4 place-items-center rounded-[4px] border border-purple-100 bg-purple-200 text-[10px] font-black text-slate-950">
                                ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ
                              </span>
                              Unpair next scene as last frame
                            </button>
                          ) : (
                            <button
                              type="button"
                              aria-pressed="false"
                              disabled={frame.index >= frames.length - 1 || isConsumedLastFrame}
                              onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                firstLastPairPointerHandledAtRefV36BPU19.current = Date.now();
                                if (scene?.id) {
                                  pairAnimateSceneWithNext({
                                    sceneId: scene.id,
                                    frameIndex: frame.index,
                                    renderFrames: frames,
                                    completedQwenScenes: completedQwenScenesForAnimateV36BPU3,
                                  });
                                }
                              }}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                if (Date.now() - firstLastPairPointerHandledAtRefV36BPU19.current < 800) return;
                                if (scene?.id) {
                                  pairAnimateSceneWithNext({
                                    sceneId: scene.id,
                                    frameIndex: frame.index,
                                    renderFrames: frames,
                                    completedQwenScenes: completedQwenScenesForAnimateV36BPU3,
                                  });
                                }
                              }}
                              className="flex cursor-pointer items-center gap-2 rounded-[12px] border border-purple-300/25 bg-black/20 px-3 py-2 text-xs font-black text-purple-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <span className="grid h-4 w-4 place-items-center rounded-[4px] border border-purple-200/50 bg-black/40 text-[10px] font-black text-transparent">
                                .
                              </span>
                              Pair next scene as last frame
                            </button>
                          )}
                        </div>

                        <div className="mt-3 rounded-[12px] border border-emerald-300/25 bg-emerald-950/25 px-3 py-3 text-xs leading-5 text-emerald-50/85">
                          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                            <div>
                              <p className="font-black uppercase tracking-[0.14em] text-emerald-100">Reference-to-video GGUF</p>
                              <p className="text-emerald-50/70">Uses this scene image as the background and the first selected character as reference slot 1.</p>
                            </div>
                            <button
                              type="button"
                              disabled={isConsumedLastFrame}
                              onClick={() => {
                                updateAnimateFrameDraft(frame.index, {
                                  animationMode: draft.animationMode === "reference_to_video_gguf" ? "image_to_video" : "reference_to_video_gguf",
                                  firstFrameIndex: undefined,
                                  lastFrameIndex: undefined,
                                  promptSourceFrameIndex: frame.index,
                                  timelineRole: "normal",
                                  consumedByFrameIndex: undefined,
                                  consumedLastFrameIndex: undefined,
                                  queueForGeneration: true,
                                });
                                setNotice(draft.animationMode === "reference_to_video_gguf" ? "Reference-to-video GGUF disabled for this scene." : "Reference-to-video GGUF enabled. Select one character reference for slot 1.");
                              }}
                              className="rounded-[12px] border border-emerald-200/35 bg-black/20 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {draft.animationMode === "reference_to_video_gguf" ? "Use Image-to-video" : "Use GGUF Reference"}
                            </button>
                          </div>
                          {draft.animationMode === "reference_to_video_gguf" ? (
                            <p className="mt-2 rounded-[10px] border border-emerald-200/20 bg-black/25 px-3 py-2 text-emerald-50/80">
                              Workflow queue: GGUF reference-to-video. background = Scene {frame.index + 1}; reference slot 1 = first checked character; Voice Actor uses the GGUF audio-reference workflow when enabled.
                            </p>
                          ) : null}
                        </div>

                        <div className="mt-3 rounded-[12px] border border-fuchsia-200/30 bg-fuchsia-950/30 px-3 py-2 text-xs font-bold leading-5 text-fuchsia-50">
                          {firstLastPairDebugTextV36BPU19()}
                        </div>
                        {isFirstLastFrame ? (
                          <>
                            <div className="mt-3 rounded-[12px] border border-purple-200/25 bg-black/25 px-3 py-2 text-xs leading-5 text-purple-50/80">
                              Workflow queue: first-frame/last-frame preset. imageA = Scene {frame.index + 1}; imageB = Scene {Number(pairedLastFrameIndex) + 1}; animationMode = first_last_frame.
                            </div>
                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div className="overflow-hidden rounded-[12px] border border-white/10 bg-black/25">
                              <div className="px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-white/45">First: Scene {frame.index + 1}</div>
                              {frame.url ? <img src={frame.url} alt={`First frame ${frame.index + 1}`} className="aspect-video w-full object-cover" /> : null}
                            </div>
                            <div className="overflow-hidden rounded-[12px] border border-white/10 bg-black/25">
                              <div className="px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-white/45">Last: Scene {Number(pairedLastFrameIndex) + 1}</div>
                              {nextFrame?.url ? <img src={nextFrame.url} alt={`Last frame ${Number(pairedLastFrameIndex) + 1}`} className="aspect-video w-full object-cover" /> : (
                                <div className="flex aspect-video items-center justify-center text-xs text-white/35">Missing last frame</div>
                              )}
                            </div>
                            </div>
                          </>
                        ) : isConsumedLastFrame ? (
                          <p className="mt-3 rounded-[12px] border border-purple-300/20 bg-black/20 px-3 py-2 text-sm text-purple-50/75">
                            This scene is consumed as the last frame for Scene {Number(consumedByFrameIndex) + 1}. Unpair that source scene to animate this one separately.
                          </p>
                        ) : null}
                      </div>

                      <div className="rounded-[14px] border border-cyan-300/20 bg-cyan-300/10 p-3">
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/70">
                          Global Prompt Preview
                        </div>
                        <p className="mt-2 text-sm leading-6 text-cyan-50/80">
                          {globalPromptPreview}
                        </p>
</div>

                      <div className="rounded-[14px] border border-white/10 bg-white/[0.03] p-3 text-sm text-white/65">
                        <div><span className="text-white/40">Clip status:</span> {clip.status}</div>
                        {clip.promptId ? <div><span className="text-white/40">Prompt ID:</span> {clip.promptId}</div> : null}
                        {clip.fileName ? <div><span className="text-white/40">File:</span> {clip.fileName}</div> : null}
                        {clip.error ? <div className="mt-2 text-red-300">{clip.error}</div> : null}
                      </div>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </div>

        <div data-otg-animate-restored="Render Plan" data-marker="OTG_PRODUCTION_ANIMATE_RESTORE_UI_V1" className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-white/45">Review</p>
              <h3 className="text-lg font-black text-white">Generated Clips</h3>
              <p className="mt-1 text-sm text-white/35">
                Synced clips will appear here for review before moving to the next Production step. Double-click a clip to expand it.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!scene || Boolean(busySceneId) || queuedAnimateFrames < 1}
                onClick={generateSelectedFrameClips}
                className="rounded-[12px] bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >Animate Current Scene</button>
              <button
                type="button"
                disabled={!frameClips.some((clip, index) => animateDrafts[index]?.queueForGeneration !== false && clip.promptId) || Boolean(busySceneId)}
                onClick={syncSelectedFrameClips}
                className="rounded-[12px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
              >Sync Generated Clips</button>
            </div>
          </div>

          {renderAnimateGenerationStatus(scene)}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {frameClips.map((clip, index) => {
              const draft = animateDrafts[index];
              const consumed = isAnimateLastFrameConsumed(draft);
              return (
              <div key={index} className={consumed ? "overflow-hidden rounded-[14px] border border-purple-300/20 bg-purple-950/20 opacity-70" : "overflow-hidden rounded-[14px] border border-white/10 bg-black/25"}>
                <div className="relative aspect-video bg-white/3">
                  {clip.url ? (
                    <video src={clip.url} className="h-full w-full object-cover" controls
                      onDoubleClick={() => setExpandedAnimateClipIndex(index)}
                      title="Double-click to expand clip"
                      data-production-clip-expand="true"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-3 text-center text-xs text-white/35">
                      Clip {index + 1} pending
                    </div>
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-xs font-black text-white">
                    Clip {index + 1}
                  </span>
                  {consumed ? (
                    <span className="absolute bottom-2 left-2 rounded-full bg-purple-300/90 px-2 py-1 text-xs font-black text-slate-950">
                      Last frame for Clip {Number(draft?.consumedByFrameIndex) + 1}
                    </span>
                  ) : null}
                </div>
                <div className="px-3 py-2 text-xs">
                  <div className={clip.status === "ready" ? "font-black text-emerald-300" : clip.status === "error" ? "font-black text-red-300" : "font-black text-white/30"}>
                    {clip.status}
                  </div>
                  <div className="mt-1 truncate text-white/40">{clip.fileName || "No clip yet"}</div>
                  {clip.url ? (
                    <button
                      type="button"
                      onClick={() => setExpandedAnimateClipIndex(index)}
                      className="mt-2 w-full rounded-[10px] border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 hover:bg-cyan-300/15"
                    >
                      Expand Clip
                    </button>
                  ) : null} {/* OTG_PRODUCTION_ANIMATE_CLIP_EXPAND_V1_BUTTON */}
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }


// OTG_PRODUCTION_STAGE_BOTTOM_NAV_V1_START

// OTG_PRODUCTION_EDIT_WORKBENCH_V1_START
// OTG_PRODUCTION_EDIT_MANIFEST_V1_START
  function clampEditSeconds(value: number, fallback = 0) {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(MAX_SCENE_DURATION_SECONDS, Math.round(value * 10) / 10));
  }

  function editStatusLabel(status: ProductionEditStatus | undefined) {
    if (status === "manifest_saved") return "Manifest Saved";
    if (status === "render_ready") return "Render Ready";
    if (status === "error") return "Error";
    return "Draft";
  }

  function fileNameFromUrl(url: string) {
    try {
      const parsed = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
      const name = parsed.searchParams.get("name") || parsed.pathname.split("/").pop() || "";
      return decodeURIComponent(name);
    } catch {
      const clean = String(url || "").split("?")[0] || "";
      return decodeURIComponent(clean.split("/").pop() || "");
    }
  }

  function absolutePathFromFileUrl(url: string) {
    try {
      const parsed = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
      const directPath = parsed.searchParams.get("path");
      return directPath ? decodeURIComponent(directPath) : "";
    } catch {
      return "";
    }
  }

  function galleryScopeFromUrl(url: string) {
    try {
      const parsed = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
      const scope = parsed.searchParams.get("scope");
      return scope === "user" || scope === "device" ? scope : "";
    } catch {
      return "";
    }
  }

  function createProductionEditVoiceSegment(index: number, durationSec: number): ProductionEditVoiceSegment {
    const startSec = index === 0 ? 0 : Math.min(durationSec, index * 5);
    const endSec = Math.min(durationSec, Math.max(startSec + 1, startSec + 5));

    return {
      id: `voice_${Date.now()}_${index}`,
      character: index === 0 ? "Character A" : `Character ${index + 1}`,
      voice: "",
      characterId: "",
      targetVoiceId: "",
      targetVoiceName: "",
      targetVoiceEngine: "",
      targetVoicePath: "",
      transcriptStatus: "idle",
      transcriptError: "",
      uploadedVoiceFileName: "",
      startSeconds: startSec,
      endSeconds: endSec,
      text: "",
      mode: "voice_conversion",
      volume: 1,
    };
  }

  function createProductionEditSfxSegment(index: number): ProductionEditSfxSegment {
    return {
      id: `sfx_${Date.now()}_${index}`,
      mode: "timed",
      label: index === 0 ? "Whoosh" : `SFX ${index + 1}`,
      prompt: index === 0 ? "cinematic whoosh transition" : "",
      audioUrl: "",
      audioFileName: "",
      startSeconds: 0,
      durationSeconds: 1,
      volume: 0.75,
      fadeInSec: 0,
      fadeOutSec: 0,
    };
  }

  function createProductionEditVisualFxRange(index: number, durationSec: number): ProductionEditVisualFxRange {
    return {
      id: `vfx_${Date.now()}_${index}`,
      startSeconds: 0,
      endSeconds: clampEditSeconds(durationSec, 4) || 4,
      prompt: "",
      strength: 0.5,
    };
  }

  function createDefaultProductionEditManifest(
    row: Partial<ProductionEditClipRow> | null | undefined,
    durationSec = 4
  ): ProductionClipEditManifest {
    const safeDuration = clampEditSeconds(durationSec, 4) || 4;
    const sourceUrl = String(row?.sourceUrl || "").trim();
    const sourceFileName = String(row?.sourceFileName || row?.clip?.fileName || (sourceUrl ? fileNameFromUrl(sourceUrl) : "")).trim();

    return {
      sceneId: String(selectedScene?.id || "").trim(),
      clipIndex: Number.isFinite(Number(row?.index)) ? Number(row?.index) : 0,
      sourceUrl,
      sourceFileName,
      trimStartSeconds: 0,
      trimEndSeconds: safeDuration,
      playbackRate: 1,
      expandMode: "none",
      voiceSegments: [createProductionEditVoiceSegment(0, safeDuration)],
      music: {
        enabled: false,
        source: "none",
        prompt: "",
        audioUrl: "",
        audioFileName: "",
        startSeconds: 0,
        endSeconds: safeDuration,
        volume: 0.35,
        fadeInSec: 0.5,
        fadeOutSec: 0.5,
        duckUnderDialogue: true,
      },
      sfxSegments: [],
      visualFxRanges: [createProductionEditVisualFxRange(0, safeDuration)],
      audioCleanup: {
        muteOriginal: false,
        reduceOriginalVolume: false,
        removeOriginalMusic: false,
        enhanceSpeech: false,
        normalizeVolume: true,
        originalVolume: 1,
      },
      audioPolicy: {
        mode: "keep_original",
        originalVolume: 1,
        replacementAudioUrl: "",
        replacementAudioFileName: "",
        replacementVolume: 1,
      },
      status: "draft",
      editedUrl: "",
      editedFileName: "",
      updatedAt: new Date().toISOString(),
    };
  }

  function normalizeProductionEditStatus(value: unknown): ProductionEditStatus {
    const status = String(value || "").trim();
    if (status === "ready") return "manifest_saved";
    if (status === "manifest_saved" || status === "render_ready" || status === "error") return status;
    return "draft";
  }

  function normalizeVoiceSegments(value: unknown, durationSec: number) {
    const segments = Array.isArray(value) ? value : [];
    const normalized = segments.map((segment: any, index) => {
      const modeValue = String(segment?.mode || "");
      const transcriptStatus = String(segment?.transcriptStatus || "idle");
      const targetVoiceEngine = String(segment?.targetVoiceEngine || segment?.voiceEngine || "");
      const targetVoiceName = String(segment?.targetVoiceName || segment?.voiceName || segment?.voice || segment?.voiceId || "").trim();
      const targetVoiceId = String(segment?.targetVoiceId || segment?.voiceId || segment?.voice || targetVoiceName || "").trim();

      return {
        id: String(segment?.id || `voice_${index}`),
        character: String(segment?.character || (index === 0 ? "Character A" : `Character ${index + 1}`)),
        voice: String(segment?.voice || targetVoiceName || targetVoiceId || ""),
        characterId: String(segment?.characterId || ""),
        targetVoiceId,
        targetVoiceName,
        targetVoiceEngine: (["seed-vc", "xtts", "reference", "character", "uploaded"].includes(targetVoiceEngine) ? targetVoiceEngine : "") as ProductionEditVoiceSegment["targetVoiceEngine"],
        targetVoicePath: String(segment?.targetVoicePath || segment?.voicePath || segment?.audioUrl || "").trim(),
        transcriptStatus: (["idle", "pending", "ready", "error"].includes(transcriptStatus) ? transcriptStatus : "idle") as ProductionEditVoiceSegment["transcriptStatus"],
        transcriptError: String(segment?.transcriptError || ""),
        uploadedVoiceFileName: String(segment?.uploadedVoiceFileName || segment?.audioFileName || "").trim(),
        startSeconds: clampEditSeconds(Number(segment?.startSeconds ?? segment?.startSec), 0),
        endSeconds: clampEditSeconds(Number(segment?.endSeconds ?? segment?.endSec), durationSec),
        text: String(segment?.text || segment?.dialogue || ""),
        mode:
          modeValue === "overlay"
            ? "mix_over_original"
            : modeValue === "replace"
              ? "replace_original"
              : (["voice_conversion", "replace_original", "mix_over_original", "mute_original_range", "keep_original"].includes(modeValue)
                  ? modeValue
                  : "voice_conversion"),
        volume: Math.max(0, Math.min(2, Number(segment?.volume) || 1)),
      };
    }) as ProductionEditVoiceSegment[];

    return normalized.length ? normalized : [createProductionEditVoiceSegment(0, durationSec)];
  }

  function normalizeSfxSegments(value: unknown) {
    const segments = Array.isArray(value) ? value : [];
    return segments.map((segment: any, index) => ({
      id: String(segment?.id || `sfx_${index}`),
      mode: segment?.mode === "full_clip" ? "full_clip" : "timed",
      label: String(segment?.label || `SFX ${index + 1}`),
      prompt: exactProductionFramePrompt(String(segment?.prompt || segment?.source || "")),
      audioUrl: String(segment?.audioUrl || ""),
      audioFileName: String(segment?.audioFileName || "").trim(),
      startSeconds: clampEditSeconds(Number(segment?.startSeconds ?? segment?.startSec), 0),
      durationSeconds: clampEditSeconds(Number(segment?.durationSeconds ?? segment?.durationSec), 1),
      volume: Math.max(0, Math.min(2, Number(segment?.volume) || 1)),
      fadeInSec: clampEditSeconds(Number(segment?.fadeInSec), 0),
      fadeOutSec: clampEditSeconds(Number(segment?.fadeOutSec), 0),
    })) as ProductionEditSfxSegment[];
  }

  function normalizeVisualFxRanges(value: unknown, legacyVisualFix: any, durationSec: number) {
    const ranges = Array.isArray(value) ? value : [];
    const normalized = ranges.map((range: any, index) => ({
      id: String(range?.id || `vfx_${index}`),
      startSeconds: clampEditSeconds(Number(range?.startSeconds ?? range?.startSec), 0),
      endSeconds: clampEditSeconds(Number(range?.endSeconds ?? range?.endSec), durationSec),
      prompt: exactProductionFramePrompt(String(range?.prompt || "")),
      strength: Math.max(0, Math.min(1, Number(range?.strength) || 0.5)),
    })) as ProductionEditVisualFxRange[];

    if (normalized.length) return normalized;

    if (legacyVisualFix?.enabled || legacyVisualFix?.prompt) {
      return [
        {
          id: "vfx_0",
          startSeconds: clampEditSeconds(Number(legacyVisualFix?.startSec), 0),
          endSeconds: clampEditSeconds(Number(legacyVisualFix?.endSec), durationSec),
          prompt: exactProductionFramePrompt(String(legacyVisualFix?.prompt || "")),
          strength: 0.5,
        },
      ];
    }

    return [createProductionEditVisualFxRange(0, durationSec)];
  }

  function normalizeAudioPolicy(rawPolicy: any, rawCleanup: any): ProductionClipEditManifest["audioPolicy"] {
    const mode = String(rawPolicy?.mode || "").trim();
    const originalVolume = Math.max(0, Math.min(1, Number(rawPolicy?.originalVolume ?? rawCleanup?.originalVolume ?? 1) || 1));
    const replacementVolume = Math.max(0, Math.min(2, Number(rawPolicy?.replacementVolume ?? 1) || 1));
    let nextMode: ProductionClipEditManifest["audioPolicy"]["mode"] = "keep_original";

    if (mode === "mute_original" || mode === "reduce_original" || mode === "replace_original" || mode === "keep_original") {
      nextMode = mode;
    } else if (rawCleanup?.muteOriginal) {
      nextMode = "mute_original";
    } else if (rawCleanup?.reduceOriginalVolume || originalVolume < 0.999) {
      nextMode = "reduce_original";
    }

    return {
      mode: nextMode,
      originalVolume,
      replacementAudioUrl: String(rawPolicy?.replacementAudioUrl || "").trim(),
      replacementAudioFileName: String(rawPolicy?.replacementAudioFileName || "").trim(),
      replacementVolume,
    };
  }

  function normalizeProductionEditManifest(
    row: ProductionEditClipRow | null | undefined,
    value: Partial<ProductionClipEditManifest> | any,
    durationSec: number
  ): ProductionClipEditManifest {
    const base = createDefaultProductionEditManifest(row, durationSec);
    const raw = value || {};
    const sourceUrl = String(row?.sourceUrl || raw.sourceUrl || base.sourceUrl).trim();
    const sourceFileName = String(row?.sourceFileName || raw.sourceFileName || row?.clip?.fileName || (sourceUrl ? fileNameFromUrl(sourceUrl) : "")).trim();
    const music = raw.music || {};
    const audioPolicy = normalizeAudioPolicy(raw.audioPolicy, raw.audioCleanup);

    return {
      ...base,
      ...raw,
      sceneId: String(row ? selectedScene?.id || raw.sceneId || base.sceneId : raw.sceneId || base.sceneId),
      clipIndex: Number.isFinite(Number(row?.index ?? raw.clipIndex)) ? Number(row?.index ?? raw.clipIndex) : base.clipIndex,
      sourceUrl,
      sourceFileName,
      trimStartSeconds: clampEditSeconds(Number(raw.trimStartSeconds ?? raw.trimStartSec), base.trimStartSeconds),
      trimEndSeconds: clampEditSeconds(Number(raw.trimEndSeconds ?? raw.trimEndSec), base.trimEndSeconds),
      playbackRate: Math.max(0.25, Math.min(2, Number(raw.playbackRate) || 1)),
      expandMode: (["none", "freeze_start", "freeze_end", "slow_down"].includes(String(raw.expandMode ?? raw.extendMode))
        ? String(raw.expandMode ?? raw.extendMode)
        : "none") as ProductionClipEditManifest["expandMode"],
      voiceSegments: normalizeVoiceSegments(raw.voiceSegments, durationSec),
      music: {
        ...base.music,
        ...music,
        enabled: Boolean(music.enabled),
        source: (["none", "generate", "library", "upload"].includes(String(music.source)) ? music.source : "none") as ProductionClipEditManifest["music"]["source"],
        prompt: exactProductionFramePrompt(String(music.prompt || "")),
        audioUrl: String(music.audioUrl || ""),
        audioFileName: String(music.audioFileName || music.fileName || "").trim(),
        startSeconds: clampEditSeconds(Number(music.startSeconds ?? music.startSec), base.music.startSeconds),
        endSeconds: clampEditSeconds(Number(music.endSeconds ?? music.endSec), base.music.endSeconds),
        volume: Math.max(0, Math.min(1, Number(music.volume) || base.music.volume)),
        fadeInSec: clampEditSeconds(Number(music.fadeInSec), base.music.fadeInSec),
        fadeOutSec: clampEditSeconds(Number(music.fadeOutSec), base.music.fadeOutSec),
        duckUnderDialogue: music.duckUnderDialogue !== false,
      },
      sfxSegments: normalizeSfxSegments(raw.sfxSegments),
      visualFxRanges: normalizeVisualFxRanges(raw.visualFxRanges, raw.visualFix, durationSec),
      audioCleanup: {
        ...base.audioCleanup,
        ...(raw.audioCleanup || {}),
        muteOriginal: audioPolicy.mode === "mute_original",
        reduceOriginalVolume: audioPolicy.mode === "reduce_original",
        originalVolume: audioPolicy.originalVolume,
      },
      audioPolicy,
      status: normalizeProductionEditStatus(raw.status),
      editedUrl: String(raw.editedUrl || ""),
      editedFileName: String(raw.editedFileName || ""),
      renderedDurationSeconds: Number.isFinite(Number(raw.renderedDurationSeconds)) ? Number(raw.renderedDurationSeconds) : undefined,
      error: raw.error ? String(raw.error) : undefined,
      updatedAt: String(raw.updatedAt || new Date().toISOString()),
    };
  }

  function editClipStableKey(scene: ProductionScene, clip: ProductionFrameClip, index: number) {
    const raw = [
      scene.id || "scene",
      clip.sourceFrameIndex ?? index,
      clip.fileName || "",
      clip.promptId || "",
      clip.uploadedPath || "",
      index,
    ]
      .join("_")
      .replace(/[^a-zA-Z0-9_.-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return raw || `${scene.id || "scene"}_clip_${index}`;
  }

  function editStageFrameClips(scene: ProductionScene | null | undefined): ProductionFrameClip[] {
    const expectedCount = clampStoryboardImageCount(scene?.imageCount ?? DEFAULT_SCENE_IMAGE_COUNT);
    const existing = scene?.frameClips || [];
    const count = Math.max(expectedCount, existing.length);

    return Array.from({ length: count }, (_, index) => {
      const base = animateFrameClips(scene)[index];
      const saved = existing[index] || {};
      return {
        ...(base || { status: "idle" as const }),
        ...saved,
        status: saved.status || base?.status || "idle",
      };
    });
  }

  function editClipRows(scene: ProductionScene | null | undefined): ProductionEditClipRow[] {
    if (!scene) return [];

    const clips = editStageFrameClips(scene);
    const frames = storyboardFramesForAnimate(scene);
    const drafts = animateFrameDrafts(scene);

    return clips
      .map((clip, index) => {
        const frame = frames[index];
        const draft = drafts[index];
        const fileName = String(clip.fileName || "").trim();
        const clipUrl = String(
          clip.url || (fileName ? `/api/gallery/file?name=${encodeURIComponent(fileName)}` : "")
        ).trim();
        const frameUrl = String(frame?.url || "").trim();
        const sourceUrl = clipUrl || frameUrl;
        const sourceFileName = String(clip.fileName || (clipUrl ? fileNameFromUrl(clipUrl) : "") || frame?.fileName || "").trim();
        const durationSec = clampEditSeconds(clip.requestedDurationSeconds ?? draft?.durationSeconds ?? defaultAnimateFrameDuration(scene), 4) || 4;

        return {
          key: editClipStableKey(scene, clip, index),
          index,
          title: `${scene.title || "Scene"} - Clip ${index + 1}`,
          clip,
          frame,
          draft,
          sourceUrl,
          sourceFileName,
          durationSec,
        };
      })
      .filter((row) => !row.clip?.removed && Boolean(row.sourceUrl || row.clip?.promptId || row.frame?.url));
  }

  function editClipThumbUrl(row: ProductionEditClipRow | null | undefined, width = 384) {
    if (!row) return "";

    const sourceFileName = String(row.sourceFileName || "").trim();
    if (sourceFileName) {
      return productionDefaultAnimateItemThumbUrl({ name: sourceFileName }, width);
    }

    const sourceUrl = String(row.sourceUrl || "").trim();
    const sourceUrlName = sourceUrl ? fileNameFromUrl(sourceUrl) : "";
    if (sourceUrlName) {
      return productionDefaultAnimateItemThumbUrl({ name: sourceUrlName }, width);
    }

    return String(row.frame?.url || "").trim();
  }

  function clampEditRange(start: number, end: number, durationSec: number, minimumGap = 0.1) {
    const max = Math.max(minimumGap, clampEditSeconds(durationSec, DEFAULT_SCENE_DURATION_SECONDS));
    const safeStart = Math.max(0, Math.min(max - minimumGap, clampEditSeconds(start, 0)));
    const safeEnd = Math.max(safeStart + minimumGap, Math.min(max, clampEditSeconds(end, max)));
    return {
      start: Math.round(safeStart * 10) / 10,
      end: Math.round(safeEnd * 10) / 10,
      max,
    };
  }

  function renderEditRangeSlider(opts: {
    label: string;
    start: number;
    end: number;
    durationSec: number;
    disabled?: boolean;
    onChange: (range: { start: number; end: number }) => void;
  }) {
    const range = clampEditRange(opts.start, opts.end, opts.durationSec);
    const left = range.max > 0 ? (range.start / range.max) * 100 : 0;
    const right = range.max > 0 ? (range.end / range.max) * 100 : 100;
    const disabled = Boolean(opts.disabled);

    function updateStart(value: number) {
      const next = clampEditRange(value, range.end, range.max);
      opts.onChange({ start: next.start, end: next.end });
    }

    function updateEnd(value: number) {
      const next = clampEditRange(range.start, value, range.max);
      opts.onChange({ start: next.start, end: next.end });
    }

    return (
      <div className={classNames("rounded-[14px] border border-white/10 bg-black/20 p-3", disabled ? "opacity-50" : "")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">{opts.label}</span>
          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-black text-cyan-100">
            {range.start}s to {range.end}s
          </span>
        </div>
        <div className="relative mt-4 h-10">
          <div className="absolute left-0 right-0 top-4 h-2 rounded-full bg-white/10" />
          <div
            className="absolute top-4 h-2 rounded-full bg-cyan-300"
            style={{ left: `${left}%`, right: `${100 - right}%` }}
          />
          <input
            type="range"
            min={0}
            max={range.max}
            step={0.1}
            value={range.start}
            disabled={disabled}
            aria-label={`${opts.label} start`}
            onChange={(event) => updateStart(Number(event.target.value))}
            className="otg-range-input absolute left-0 right-0 top-1 w-full bg-transparent accent-cyan-300 disabled:cursor-not-allowed"
          />
          <input
            type="range"
            min={0}
            max={range.max}
            step={0.1}
            value={range.end}
            disabled={disabled}
            aria-label={`${opts.label} end`}
            onChange={(event) => updateEnd(Number(event.target.value))}
            className="otg-range-input absolute left-0 right-0 top-1 w-full bg-transparent accent-cyan-300 disabled:cursor-not-allowed"
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] font-bold text-white/35">
          <span>0s</span>
          <span>{range.max}s</span>
        </div>
      </div>
    );
  }

  function findEditRowByKey(clipKey: string) {
    return editClipRows(selectedScene).find((row) => row.key === clipKey) || null;
  }

  function moveEditClip(rowIndex: number, direction: -1 | 1) {
    if (!selectedScene) return;
    const clips = editStageFrameClips(selectedScene).slice();
    const targetIndex = rowIndex + direction;
    if (rowIndex < 0 || targetIndex < 0 || rowIndex >= clips.length || targetIndex >= clips.length) return;

    const moving = clips[rowIndex];
    const target = clips[targetIndex];
    clips[rowIndex] = target;
    clips[targetIndex] = moving;

    updateSelectedScene({ frameClips: clips });
    setSelectedEditClipKey(editClipStableKey(selectedScene, moving, targetIndex));
    setNotice(`Moved Clip ${rowIndex + 1} ${direction < 0 ? "up" : "down"}. Click Arrange again to lock this order.`);
  }

  async function uploadEditClip(file: File | null | undefined) {
    if (!file || !selectedScene || uploadingEditClip) return;
    setUploadingEditClip(true);
    setNotice(`Uploading ${file.name} into Edit clips...`);

    try {
      const form = new FormData();
      form.append("sceneId", selectedScene.id);
      form.append("clip", file, file.name);
      const response = await fetch("/api/production/edit/upload-clip", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error || "Clip upload failed."));
      }

      const clips = editStageFrameClips(selectedScene);
      const nextClip: ProductionFrameClip = {
        status: "ready",
        fileName: String(data.fileName || file.name),
        url: String(data.videoUrl || ""),
        uploadedPath: String(data.videoPath || ""),
        source: "uploaded",
        sourceFrameIndex: clips.length,
        requestedDurationSeconds: DEFAULT_SCENE_DURATION_SECONDS,
      };
      const nextClips = [...clips, nextClip];
      updateSelectedScene({
        frameClips: nextClips,
        status: "clip_ready",
      });
      setSelectedEditClipKey(editClipStableKey(selectedScene, nextClip, nextClips.length - 1));
      setNotice(`Added uploaded clip to Edit: ${file.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Clip upload failed.");
    } finally {
      setUploadingEditClip(false);
    }
  }

  async function openEditGalleryPicker() {
    setEditGalleryOpen(true);
    setEditGalleryError("");
    setEditGalleryPreviewKey("");
    setEditGalleryLoading(true);

    try {
      const items = await productionDefaultAnimateFetchGalleryItems();
      setEditGalleryItems(items.filter(productionDefaultAnimateIsVideoItem));
      if (!items.length) setEditGalleryError("No gallery videos were found.");
    } catch (error) {
      setEditGalleryError(error instanceof Error ? error.message : "Could not load gallery videos.");
    } finally {
      setEditGalleryLoading(false);
    }
  }

  function addEditClipFromGallery(item: any) {
    if (!selectedScene) return;

    const fileName = productionDefaultAnimateItemName(item) || fileNameFromUrl(productionDefaultAnimateItemUrl(item));
    const url = productionDefaultAnimateItemUrl(item);
    if (!fileName && !url) {
      setEditGalleryError("This gallery item does not have a usable video filename or URL.");
      return;
    }

    const clips = editStageFrameClips(selectedScene);
    const nextClip: ProductionFrameClip = {
      status: "ready",
      fileName,
      url,
      source: "uploaded",
      sourceFrameIndex: clips.length,
      requestedDurationSeconds: DEFAULT_SCENE_DURATION_SECONDS,
    };
    const nextClips = [...clips, nextClip];
    updateSelectedScene({
      frameClips: nextClips,
      status: "clip_ready",
    });
    autosaveProductionScenePatchV36BPU43(selectedScene.id, {
      frameClips: nextClips,
      status: "clip_ready",
    }, activeStage);
    setSelectedEditClipKey(editClipStableKey(selectedScene, nextClip, nextClips.length - 1));
    setEditGalleryOpen(false);
    setNotice(`Added gallery clip to Edit: ${fileName || "selected video"}.`);
  }

  function removeEditClip(rowIndex: number) {
    if (!selectedScene) return;

    const clips = editStageFrameClips(selectedScene).slice();
    if (rowIndex < 0 || rowIndex >= clips.length) return;

    const removing = clips[rowIndex];
    const removingKey = editClipStableKey(selectedScene, removing, rowIndex);
    const expectedCount = clampStoryboardImageCount(selectedScene.imageCount);

    if (rowIndex < expectedCount) {
      clips[rowIndex] = {
        status: "idle",
        sourceFrameIndex: rowIndex,
        removed: true,
      };
    } else {
      clips.splice(rowIndex, 1);
    }

    updateSelectedScene({ frameClips: clips });
    autosaveProductionScenePatchV36BPU43(selectedScene.id, { frameClips: clips }, activeStage);
    setEditDraftsByClipKey((current) => {
      const next = { ...current };
      delete next[removingKey];
      return next;
    });

    const nextRows = editClipRows({ ...selectedScene, frameClips: clips });
    setSelectedEditClipKey(nextRows[Math.min(rowIndex, Math.max(0, nextRows.length - 1))]?.key || "");
    setNotice(`Removed Clip ${rowIndex + 1} from this Edit scene. Gallery media was not deleted.`);
  }

  function editDraftForClip(clipKey: string, durationSec: number) {
    const row = findEditRowByKey(clipKey);
    return normalizeProductionEditManifest(row, editDraftsByClipKey[clipKey] || row?.clip?.editManifest, durationSec);
  }

  function sceneCharacterVoiceOptions(scene: ProductionScene | null | undefined) {
    return createCharacterSlots(scene?.characterRefs)
      .slice(0, visibleCharacterReferenceSlotCount(scene))
      .map((ref, index) => ({
        id: String(ref.sourceCharacterId || ref.id || `character_${index + 1}`),
        label: String(ref.sourceCharacterName || ref.label || `Character ${index + 1}`),
        referenceAudioPath: String(ref.referenceAudioPath || ""),
      }))
      .filter((ref) => ref.label || ref.referenceAudioPath || ref.id);
  }

  function productionVoiceOptionsForScene(scene: ProductionScene | null | undefined) {
    const sceneCharacters = sceneCharacterVoiceOptions(scene);
    const sceneCharacterIds = new Set(sceneCharacters.map((character) => character.id).filter(Boolean));
    const allOptions = [...productionVoiceModels, ...productionUploadedVoiceOptions];
    const seen = new Set<string>();
    const ordered: ProductionVoiceModelOption[] = [];

    function pushUnique(option: ProductionVoiceModelOption) {
      const key = option.id || option.path || option.name;
      if (!key || seen.has(key)) return;
      seen.add(key);
      ordered.push(option);
    }

    allOptions
      .filter((option) => option.usable && option.characterId && sceneCharacterIds.has(option.characterId))
      .forEach(pushUnique);
    allOptions
      .filter((option) => option.usable && option.engine === "uploaded")
      .forEach(pushUnique);
    allOptions
      .filter((option) => option.usable)
      .forEach(pushUnique);
    allOptions
      .filter((option) => !option.usable)
      .forEach(pushUnique);

    return ordered;
  }

  function applyVoiceModelToSegment(
    clipKey: string,
    durationSec: number,
    segmentIndex: number,
    modelId: string
  ) {
    const voiceOptions = productionVoiceOptionsForScene(selectedScene);
    const model = voiceOptions.find((option) => option.id === modelId);
    if (!model) {
      updateVoiceSegment(clipKey, durationSec, segmentIndex, {
        voice: "",
        targetVoiceId: "",
        targetVoiceName: "",
        targetVoiceEngine: "",
        targetVoicePath: "",
      });
      return;
    }

    const matchingCharacter = sceneCharacterVoiceOptions(selectedScene).find((character) => character.id === model.characterId);
    updateVoiceSegment(clipKey, durationSec, segmentIndex, {
      character: matchingCharacter?.label || undefined,
      characterId: matchingCharacter?.id || model.characterId || "",
      voice: model.name,
      targetVoiceId: model.id,
      targetVoiceName: model.name,
      targetVoiceEngine: model.engine,
      targetVoicePath: model.path || model.samplePath || "",
      uploadedVoiceFileName: model.engine === "uploaded" ? model.displayPath || model.name : "",
    });
  }

  function handleProductionVoiceUpload(file: File | null | undefined) {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    const option: ProductionVoiceModelOption = {
      id: `uploaded:${Date.now()}:${file.name}`,
      name: file.name,
      engine: "uploaded",
      path: objectUrl,
      displayPath: file.name,
      samplePath: objectUrl,
      usable: true,
      notes: "Uploaded reference staged in the manifest. Backend upload/conversion wiring comes next.",
    };
    setProductionUploadedVoiceOptions((previous) => [option, ...previous]);
    setNotice(`Uploaded voice reference staged: ${file.name}. Save the manifest to keep the selection intent.`);
  }

  async function requestVoiceSegmentTranscript(
    clipKey: string,
    durationSec: number,
    segmentIndex: number,
    segment: ProductionEditVoiceSegment
  ) {
    const row = findEditRowByKey(clipKey);
    if (!row) {
      setNotice("Select a generated source clip before transcribing.");
      return;
    }

    const start = clampEditSeconds(segment.startSeconds, 0);
    const end = clampEditSeconds(segment.endSeconds, durationSec);
    if (end <= start + 0.05) {
      setNotice("Transcript end time must be after the start time.");
      return;
    }

    updateVoiceSegment(clipKey, durationSec, segmentIndex, {
      transcriptStatus: "pending",
      transcriptError: "",
    });
    setNotice(`Transcribing Clip ${row.index + 1} from ${start}s to ${end}s...`);

    try {
      const response = await fetch("/api/production/edit/transcript", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneId: selectedScene?.id || "",
          clipIndex: row.index,
          sourceUrl: row.sourceUrl,
          sourceFileName: row.sourceFileName,
          startSeconds: start,
          endSeconds: end,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || data?.detail || "Transcript failed.");
      }

      const text = String(data?.text || "").trim();
      updateVoiceSegment(clipKey, durationSec, segmentIndex, {
        text,
        transcriptStatus: "ready",
        transcriptError: "",
      });
      setNotice(text ? `Transcript added for Clip ${row.index + 1}.` : "Whisper returned an empty transcript.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transcript failed.";
      updateVoiceSegment(clipKey, durationSec, segmentIndex, {
        transcriptStatus: "error",
        transcriptError: message,
      });
      setNotice(message);
    }
  }

  function updateEditDraft(clipKey: string, durationSec: number, patch: Partial<ProductionClipEditManifest>) {
    if (!clipKey) return;

    setEditDraftsByClipKey((previous) => {
      const row = findEditRowByKey(clipKey);
      const current = normalizeProductionEditManifest(row, previous[clipKey] || row?.clip?.editManifest, durationSec);
      return {
        ...previous,
        [clipKey]: normalizeProductionEditManifest(row, {
          ...current,
          ...patch,
          updatedAt: new Date().toISOString(),
        }, durationSec),
      };
    });
  }



// OTG_PRODUCTION_EDIT_REPLACE_SELECTED_RENDER_V1_START
function productionEditBasename(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = raw.startsWith("http://") || raw.startsWith("https://")
      ? new URL(raw)
      : new URL(raw, "http://otg.local");

    const fromQuery =
      parsed.searchParams.get("name") ||
      parsed.searchParams.get("filename") ||
      parsed.searchParams.get("fileName") ||
      parsed.searchParams.get("path") ||
      "";

    const source = fromQuery || parsed.pathname || raw;
    return decodeURIComponent(source).split(/[\\/]/).pop() || "";
  } catch {
    return raw.split(/[\\/]/).pop() || "";
  }
}

function extractRenderedEditOutput(data: any) {
  const result = data?.result && typeof data.result === "object" ? data.result : {};
  const output = data?.output && typeof data.output === "object" ? data.output : {};

  const url = String(
    data?.renderedVideoUrl ||
      data?.editedVideoUrl ||
      data?.outputUrl ||
      data?.videoUrl ||
      data?.url ||
      result?.renderedVideoUrl ||
      result?.editedVideoUrl ||
      result?.outputUrl ||
      result?.videoUrl ||
      result?.url ||
      output?.renderedVideoUrl ||
      output?.editedVideoUrl ||
      output?.outputUrl ||
      output?.videoUrl ||
      output?.url ||
      ""
  ).trim();

  const path = String(
    data?.renderedVideoPath ||
      data?.editedVideoPath ||
      data?.outputPath ||
      data?.videoPath ||
      data?.path ||
      result?.renderedVideoPath ||
      result?.editedVideoPath ||
      result?.outputPath ||
      result?.videoPath ||
      result?.path ||
      output?.renderedVideoPath ||
      output?.editedVideoPath ||
      output?.outputPath ||
      output?.videoPath ||
      output?.path ||
      ""
  ).trim();

  const fileName = String(
    data?.renderedFileName ||
      data?.editedFileName ||
      data?.outputFileName ||
      data?.fileName ||
      data?.filename ||
      data?.name ||
      result?.renderedFileName ||
      result?.editedFileName ||
      result?.outputFileName ||
      result?.fileName ||
      result?.filename ||
      result?.name ||
      output?.renderedFileName ||
      output?.editedFileName ||
      output?.outputFileName ||
      output?.fileName ||
      output?.filename ||
      output?.name ||
      productionEditBasename(path) ||
      productionEditBasename(url) ||
      ""
  ).trim();

  const promptId = String(
    data?.promptId ||
      data?.prompt_id ||
      result?.promptId ||
      result?.prompt_id ||
      output?.promptId ||
      output?.prompt_id ||
      ""
  ).trim();
  async function handleTranscribeVoiceActorInput(frameId: string, audioBlob?: Blob | null, applyTranscript?: (value: string) => void) {
    if (!audioBlob) {
      window.alert("Record voice actor input before transcribing.");
      return;
    }

    setVoiceActorTranscribingByFrame((prev) => ({ ...prev, [frameId]: true }));
    try {
      const transcript = await transcribeProductionVoiceActorAudio(audioBlob);
      setVoiceActorTranscriptByFrame((prev) => ({ ...prev, [frameId]: transcript }));
      if (applyTranscript) {
        applyTranscript(transcript);
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Voice actor transcription failed.");
    } finally {
      setVoiceActorTranscribingByFrame((prev) => ({ ...prev, [frameId]: false }));
    }
  }

  return { url, path, fileName, promptId };
}

function replaceSelectedEditClipWithRenderedOutput(
  clipKey: string,
  rendered: { url?: string; path?: string; fileName?: string; promptId?: string },
  draft: ProductionClipEditManifest
) {
  if (!selectedScene || !clipKey) return false;

  const rows = editClipRows(selectedScene);
  const row = rows.find((item) => item.key === clipKey);
  if (!row) return false;

  const renderedUrl = String(
    rendered.url ||
      (rendered.fileName ? `/api/gallery/file?name=${encodeURIComponent(rendered.fileName)}` : "") ||
      (rendered.path ? `/api/file?path=${encodeURIComponent(rendered.path)}` : "")
  ).trim();

  const renderedFileName = String(
    rendered.fileName ||
      productionEditBasename(rendered.path) ||
      productionEditBasename(rendered.url) ||
      row.clip?.fileName ||
      ""
  ).trim();

  if (!renderedUrl && !renderedFileName) return false;

  const nextClips = animateFrameClips(selectedScene);
  const oldClip = nextClips[row.index] || row.clip || {};

  nextClips[row.index] = {
    ...oldClip,
    status: "ready",
    url: renderedUrl || oldClip.url,
    fileName: renderedFileName || oldClip.fileName,
    error: undefined,
    promptId: oldClip.promptId || rendered.promptId,
    sourceFrameIndex: row.index,
    requestedDurationSeconds: oldClip.requestedDurationSeconds || row.durationSec,
    editedAt: new Date().toISOString(),
    editSource: "production-edit-render",
    originalFileName: oldClip.originalFileName || oldClip.fileName,
    originalUrl: oldClip.originalUrl || oldClip.url,
    editManifest: draft,
  };

  updateSceneById(selectedScene.id, {
    frameClips: nextClips,
    status: "edited",
  });

  setSelectedEditClipKey(clipKey);
  return true;
}


function restoreSelectedEditClipOriginal(clipKey: string, durationSec: number) {
  if (!selectedScene || !clipKey) return false;

  const rows = editClipRows(selectedScene);
  const row = rows.find((item) => item.key === clipKey);
  if (!row) return false;

  const frameClips = animateFrameClips(selectedScene).slice();
  const currentClip: any = frameClips[row.index] || row.clip || {};
  const originalUrl = String(currentClip.originalUrl || "").trim();
  const originalFileName = String(currentClip.originalFileName || "").trim();

  if (!originalUrl && !originalFileName) {
    updateEditDraft(clipKey, durationSec, {
      trimStartSeconds: 0,
      trimEndSeconds: durationSec,
      playbackRate: 1,
      expandMode: "none",
      editedUrl: "",
      editedFileName: "",
      error: "",
      status: "draft",
    } as any);
    setNotice("No prior edited replacement was found. Reset trim settings only.");
    return false;
  }

  const restoredUrl = originalUrl || currentClip.url || "";
  const restoredFileName = originalFileName || currentClip.fileName || fileNameFromUrl(restoredUrl);
  const restoredDuration = currentClip.requestedDurationSeconds || row.durationSec || durationSec;

  const restoredClip: any = {
    ...currentClip,
    url: restoredUrl,
    fileName: restoredFileName,
    error: undefined,
    sourceFrameIndex: row.index,
    requestedDurationSeconds: restoredDuration,
  };

  delete restoredClip.editedAt;
  delete restoredClip.editSource;

  const restoredManifest = normalizeProductionEditManifest(
    {
      ...row,
      sourceUrl: restoredUrl,
      sourceFileName: restoredFileName,
      clip: restoredClip,
    } as any,
    {
      ...createDefaultProductionEditManifest(
        {
          ...row,
          sourceUrl: restoredUrl,
          sourceFileName: restoredFileName,
          clip: restoredClip,
        } as any,
        restoredDuration
      ),
      sourceUrl: restoredUrl,
      sourceFileName: restoredFileName,
      trimStartSeconds: 0,
      trimEndSeconds: restoredDuration,
      playbackRate: 1,
      expandMode: "none",
      editedUrl: "",
      editedFileName: "",
      error: "",
      status: "draft",
      updatedAt: new Date().toISOString(),
    } as any,
    restoredDuration
  );

  restoredClip.editManifest = restoredManifest;
  frameClips[row.index] = restoredClip;

  updateSceneById(selectedScene.id, {
    frameClips,
  });

  setEditDraftsByClipKey((previous) => ({
    ...previous,
    [clipKey]: restoredManifest,
  }));

  setSelectedEditClipKey(clipKey);
  setNotice(`Restored original Clip ${row.index + 1}.`);
  return true;
}
function handleRenderedEditReplacementResponse(
  clipKey: string,
  durationSec: number,
  draft: ProductionClipEditManifest,
  data: any
) {
  const rendered = extractRenderedEditOutput(data);
  const replaced = replaceSelectedEditClipWithRenderedOutput(clipKey, rendered, draft);

  if (!replaced) {
    throw new Error("Edit render completed, but no replacement video URL, path, or fileName was returned.");
  }

  updateEditDraft(clipKey, durationSec, {
    status: "render_ready",
    updatedAt: new Date().toISOString(),
  });

  setNotice("Edited render replaced the selected clip.");
}
// OTG_PRODUCTION_EDIT_REPLACE_SELECTED_RENDER_V1_END

  function updateEditDraftNested<K extends keyof ProductionClipEditManifest>(
    clipKey: string,
    durationSec: number,
    key: K,
    value: ProductionClipEditManifest[K]
  ) {
    updateEditDraft(clipKey, durationSec, { [key]: value, status: "draft" } as Partial<ProductionClipEditManifest>);
  }

  async function generateProductionAceBackgroundMusic(
    clipKey: string,
    durationSec: number,
    draft: ProductionClipEditManifest
  ) {
    const row = findEditRowByKey(clipKey);
    if (!row) {
      setNotice("Select a source clip before generating background music.");
      return;
    }

    const prompt = String(draft.music.prompt || "").trim() ||
      "cinematic instrumental background music, same mood and tempo as the selected clip, no vocals, clean mix";
    const selectedRangeSeconds = Math.max(0, Number(draft.music.endSeconds) - Number(draft.music.startSeconds));
    const durationSeconds = Math.max(10, Math.min(600, Math.round(selectedRangeSeconds >= 10 ? selectedRangeSeconds : 30)));

    setGeneratingAceMusicClipKey(clipKey);
    setAceMusicStatusByClipKey((previous) => ({
      ...previous,
      [clipKey]: "Generating ACE-Step reference music from the selected clip...",
    }));
    setNotice(`Generating ACE-Step background music for Clip ${row.index + 1}.`);

    try {
      const response = await fetch("/api/production/edit/ace-music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sceneId: draft.sceneId || selectedScene?.id || "",
          clipIndex: draft.clipIndex ?? row.index,
          sourceUrl: draft.sourceUrl || row.sourceUrl,
          sourceFileName: draft.sourceFileName || row.sourceFileName,
          prompt,
          durationSeconds,
          bpm: 95,
          keyscale: "E minor",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || "ACE-Step background music generation failed.");
      }

      updateEditDraftNested(clipKey, durationSec, "music", {
        ...draft.music,
        enabled: true,
        source: "library",
        prompt,
        audioFileName: String(data.fileName || ""),
        audioUrl: String(data.galleryUrl || data.url || ""),
        startSeconds: draft.music.enabled ? draft.music.startSeconds : 0,
        endSeconds: draft.music.enabled ? draft.music.endSeconds : durationSec,
      });

      setAceMusicStatusByClipKey((previous) => ({
        ...previous,
        [clipKey]: `ACE music ready: ${String(data.fileName || "generated music")}`,
      }));
      setNotice(`ACE-Step background music attached to Clip ${row.index + 1}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "ACE-Step background music generation failed.";
      setAceMusicStatusByClipKey((previous) => ({
        ...previous,
        [clipKey]: message,
      }));
      setNotice(message);
    } finally {
      setGeneratingAceMusicClipKey("");
    }
  }

  function updateVoiceSegment(
    clipKey: string,
    durationSec: number,
    segmentIndex: number,
    patch: Partial<ProductionEditVoiceSegment>
  ) {
    if (!clipKey) return;

    setEditDraftsByClipKey((previous) => {
      const row = findEditRowByKey(clipKey);
      const current = normalizeProductionEditManifest(row, previous[clipKey] || row?.clip?.editManifest, durationSec);
      const nextSegments = current.voiceSegments.map((segment, index) => {
        if (index !== segmentIndex) return segment;
        const requestedStart = clampEditSeconds(patch.startSeconds ?? segment.startSeconds, segment.startSeconds);
        const requestedEnd = clampEditSeconds(patch.endSeconds ?? segment.endSeconds, segment.endSeconds);
        const startSeconds = Math.max(0, Math.min(durationSec, Math.min(requestedStart, requestedEnd)));
        const endSeconds = Math.max(startSeconds, Math.min(durationSec, Math.max(requestedStart, requestedEnd)));

        return {
          ...segment,
          ...patch,
          startSeconds,
          endSeconds,
        };
      });

      return {
        ...previous,
        [clipKey]: {
          ...current,
          voiceSegments: nextSegments,
          status: "draft",
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }

  function addVoiceSegment(clipKey: string, durationSec: number) {
    if (!clipKey) return;

    setEditDraftsByClipKey((previous) => {
      const row = findEditRowByKey(clipKey);
      const current = normalizeProductionEditManifest(row, previous[clipKey] || row?.clip?.editManifest, durationSec);
      return {
        ...previous,
        [clipKey]: {
          ...current,
          voiceSegments: [...current.voiceSegments, createProductionEditVoiceSegment(current.voiceSegments.length, durationSec)],
          status: "draft",
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }

  function removeVoiceSegment(clipKey: string, durationSec: number, segmentIndex: number) {
    if (!clipKey) return;

    setEditDraftsByClipKey((previous) => {
      const row = findEditRowByKey(clipKey);
      const current = normalizeProductionEditManifest(row, previous[clipKey] || row?.clip?.editManifest, durationSec);
      const nextSegments = current.voiceSegments.filter((_, index) => index !== segmentIndex);

      return {
        ...previous,
        [clipKey]: {
          ...current,
          voiceSegments: nextSegments.length ? nextSegments : [createProductionEditVoiceSegment(0, durationSec)],
          status: "draft",
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }

  function updateSfxSegment(
    clipKey: string,
    durationSec: number,
    segmentIndex: number,
    patch: Partial<ProductionEditSfxSegment>
  ) {
    if (!clipKey) return;

    setEditDraftsByClipKey((previous) => {
      const row = findEditRowByKey(clipKey);
      const current = normalizeProductionEditManifest(row, previous[clipKey] || row?.clip?.editManifest, durationSec);
      const nextSegments = current.sfxSegments.map((segment, index) =>
        index === segmentIndex
          ? {
              ...segment,
              ...patch,
              startSeconds: clampEditSeconds(patch.startSeconds ?? segment.startSeconds, segment.startSeconds),
              durationSeconds: clampEditSeconds(patch.durationSeconds ?? segment.durationSeconds, segment.durationSeconds),
            }
          : segment
      );

      return {
        ...previous,
        [clipKey]: {
          ...current,
          sfxSegments: nextSegments,
          status: "draft",
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }

  function addSfxSegment(clipKey: string, durationSec: number) {
    if (!clipKey) return;

    setEditDraftsByClipKey((previous) => {
      const row = findEditRowByKey(clipKey);
      const current = normalizeProductionEditManifest(row, previous[clipKey] || row?.clip?.editManifest, durationSec);
      return {
        ...previous,
        [clipKey]: {
          ...current,
          sfxSegments: [...current.sfxSegments, createProductionEditSfxSegment(current.sfxSegments.length)],
          status: "draft",
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }

  function removeSfxSegment(clipKey: string, durationSec: number, segmentIndex: number) {
    if (!clipKey) return;

    setEditDraftsByClipKey((previous) => {
      const row = findEditRowByKey(clipKey);
      const current = normalizeProductionEditManifest(row, previous[clipKey] || row?.clip?.editManifest, durationSec);
      return {
        ...previous,
        [clipKey]: {
          ...current,
          sfxSegments: current.sfxSegments.filter((_, index) => index !== segmentIndex),
          status: "draft",
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }

  function saveEditManifest(clipKey: string, durationSec: number) {
    if (!clipKey) return;

    const row = findEditRowByKey(clipKey);
    if (!row || !selectedScene) return;

    const savedManifest = normalizeProductionEditManifest(row, {
      ...editDraftForClip(clipKey, durationSec),
      status: "manifest_saved",
      updatedAt: new Date().toISOString(),
    }, durationSec);

    setEditDraftsByClipKey((previous) => ({
      ...previous,
      [clipKey]: savedManifest,
    }));

    const nextScenes = scenes.map((scene) => {
      if (scene.id !== selectedScene.id) return scene;
      const frameClips = animateFrameClips(scene).map((clip, index) =>
        index === row.index
          ? {
              ...clip,
              editManifest: savedManifest,
            }
          : clip
      );
      return {
        ...scene,
        frameClips,
      };
    });

    setScenes(nextScenes);

    try {
      window.localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify(
          {
            schemaVersion: 1,
            projectTitle: projectTitle.trim() || "Untitled Production",
            activeStage,
            updatedAt: new Date().toISOString(),
            scenes: nextScenes,
          },
          null,
          2
        )
      );
    } catch {
      // Saving to scene state is enough for the current session; the header Save Draft button can retry local persistence.
    }

    setNotice(`Edit manifest saved for Clip ${row.index + 1}. Source clip remains untouched.`);
  }

  // OTG_PRODUCTION_EDIT_TRIM_RENDER_V1_START
  // OTG_PRODUCTION_EDIT_AUDIO_CLEANUP_V1_START
  // OTG_PRODUCTION_EDIT_VOICE_SEGMENTS_V1_START
  // OTG_PRODUCTION_EDIT_MUSIC_LAYER_V1_START
  // OTG_PRODUCTION_EDIT_SFX_SEGMENTS_V1_START
  // OTG_PRODUCTION_EDIT_VISUAL_FX_V1_START
  async function renderTrimOnlyEditClip(clipKey: string, durationSec: number) {
    if (!clipKey || renderingEditClipKey) return;

    const row = findEditRowByKey(clipKey);
    if (!row || !selectedScene) return;

    const manifest = normalizeProductionEditManifest(row, editDraftForClip(clipKey, durationSec), durationSec);

    // OTG_PRODUCTION_VISUAL_EDIT_CLEANUP_RENDER_RATE_V36BK2
    // Playback rate is display-only on Visual Edit. Slow down uses a fixed safe preview rate.
    const renderPlaybackRateV36BK2 =
      manifest.expandMode === "slow_down" && manifest.playbackRate >= 1 ? 0.5 : manifest.playbackRate;

    if (!manifest.sourceUrl && !manifest.sourceFileName) {
      setNotice("Select a generated source clip before rendering.");
      return;
    }
    // OTG_PRODUCTION_VISUAL_EDIT_CLEANUP_FREEZE_CLIENT_V36BK2
    // Freeze start/end are allowed through the Cut path. The render route handles supported timing behavior.
    // OTG_PRODUCTION_VISUAL_EDIT_CLEANUP_SLOWDOWN_CLIENT_V36BK2
    // Slow down uses renderPlaybackRateV36BK2 because playback rate is no longer user-editable.

    if (manifest.expandMode === "none" && Math.abs(manifest.playbackRate - 1) > 0.001) {
      setNotice("Playback rate changes require expand mode Slow down.");
      return;
    }

    setRenderingEditClipKey(clipKey);
    setNotice(`Rendering edited clip ${row.index + 1}...`);

    try {
      const response = await fetch("/api/production/edit/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sceneId: selectedScene.id,
          clipIndex: row.index,
          sourceUrl: manifest.sourceUrl,
          manifest: {
            trim: {
              startSeconds: manifest.trimStartSeconds,
              endSeconds: manifest.trimEndSeconds,
            },
            trimStartSeconds: manifest.trimStartSeconds,
            trimEndSeconds: manifest.trimEndSeconds,
            playbackRate: renderPlaybackRateV36BK2,
            expandMode: manifest.expandMode,
            sourceFileName: manifest.sourceFileName,
            audioPolicy: manifest.audioPolicy,
            audioCleanup: manifest.audioCleanup,
            voiceSegments: manifest.voiceSegments,
            music: manifest.music,
            sfxSegments: manifest.sfxSegments,
          },
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error || "Trim render failed."));
      }

      const renderedManifest = normalizeProductionEditManifest(row, {
        ...manifest,
        status: "render_ready",
        editedUrl: String(data.editedUrl || ""),
        editedFileName: String(data.editedFileName || ""),
        renderedDurationSeconds: Number(data.durationSeconds) > 0 ? Number(data.durationSeconds) : undefined,
        error: "",
        updatedAt: new Date().toISOString(),
      }, durationSec);

      setEditDraftsByClipKey((previous) => ({
        ...previous,
        [clipKey]: renderedManifest,
      }));

      const nextScenes = scenes.map((scene) => {
        if (scene.id !== selectedScene.id) return scene;
        const frameClips = animateFrameClips(scene).map((clip, index) =>
          index === row.index
            ? {
                ...clip,
                editManifest: renderedManifest,
              }
            : clip
        );
        return {
          ...scene,
          frameClips,
          status: frameClips.some((clip) => clip.editManifest?.status === "render_ready") ? "edited" as const : scene.status,
        };
      });

      setScenes(nextScenes);

      try {
        window.localStorage.setItem(
          DRAFT_STORAGE_KEY,
          JSON.stringify(
            {
              schemaVersion: 1,
              projectTitle: projectTitle.trim() || "Untitled Production",
              activeStage,
              updatedAt: new Date().toISOString(),
              scenes: nextScenes,
            },
            null,
            2
          )
        );
      } catch {
        // The edited manifest remains in scene state even if local persistence is unavailable.
      }


      // OTG_PRODUCTION_EDIT_RENDER_SUCCESS_REPLACE_SELECTED_V3
      handleRenderedEditReplacementResponse(clipKey, durationSec, renderedManifest, {
        ...(data || {}),
        result: {
          ...((data || {}).result || {}),
          ...(renderedManifest as any),
        },
        output: {
          ...((data || {}).output || {}),
          ...(renderedManifest as any),
        },
        renderedVideoUrl:
          (renderedManifest as any).renderedVideoUrl ||
          (renderedManifest as any).editedVideoUrl ||
          (renderedManifest as any).outputUrl ||
          (renderedManifest as any).videoUrl ||
          (renderedManifest as any).url ||
          (data as any)?.renderedVideoUrl ||
          (data as any)?.editedVideoUrl ||
          (data as any)?.outputUrl ||
          (data as any)?.videoUrl ||
          (data as any)?.url,
        renderedVideoPath:
          (renderedManifest as any).renderedVideoPath ||
          (renderedManifest as any).editedVideoPath ||
          (renderedManifest as any).outputPath ||
          (renderedManifest as any).videoPath ||
          (renderedManifest as any).path ||
          (data as any)?.renderedVideoPath ||
          (data as any)?.editedVideoPath ||
          (data as any)?.outputPath ||
          (data as any)?.videoPath ||
          (data as any)?.path,
        renderedFileName:
          (renderedManifest as any).renderedFileName ||
          (renderedManifest as any).editedFileName ||
          (renderedManifest as any).outputFileName ||
          (renderedManifest as any).fileName ||
          (renderedManifest as any).filename ||
          (renderedManifest as any).name ||
          (data as any)?.renderedFileName ||
          (data as any)?.editedFileName ||
          (data as any)?.outputFileName ||
          (data as any)?.fileName ||
          (data as any)?.filename ||
          (data as any)?.name,
        promptId:
          (renderedManifest as any).promptId ||
          (data as any)?.promptId ||
          (data as any)?.prompt_id,
      });

      // OTG_TRIM_REPLACE_SELECTED_CLIP_V1
      handleRenderedEditReplacementResponse(clipKey, durationSec, renderedManifest, {
        ...(data || {}),
        result: {
          ...((data || {}).result || {}),
          ...(renderedManifest as any),
        },
        output: {
          ...((data || {}).output || {}),
          ...(renderedManifest as any),
        },
        editedUrl: renderedManifest.editedUrl,
        editedFileName: renderedManifest.editedFileName,
        renderedVideoUrl: renderedManifest.editedUrl,
        fileName: renderedManifest.editedFileName,
      });

      setNotice(`Cut applied to Clip ${row.index + 1}. The edited clip replaced the original. Use Undo to restore the original.`);
    } catch (error) {
      const failedManifest = normalizeProductionEditManifest(row, {
        ...manifest,
        status: "error",
        error: error instanceof Error ? error.message : "Trim render failed.",
        updatedAt: new Date().toISOString(),
      }, durationSec);

      setEditDraftsByClipKey((previous) => ({
        ...previous,
        [clipKey]: failedManifest,
      }));
      setNotice(failedManifest.error || "Trim render failed.");
    } finally {
      setRenderingEditClipKey("");
    }
  }

  async function renderVisualFxEditClip(clipKey: string, durationSec: number) {
    if (!clipKey || renderingVisualFxClipKey || renderingEditClipKey) return;

    const row = findEditRowByKey(clipKey);
    if (!row || !selectedScene) return;

    const manifest = normalizeProductionEditManifest(row, editDraftForClip(clipKey, durationSec), durationSec);

    // OTG_PRODUCTION_VISUAL_EDIT_CLEANUP_RENDER_RATE_V36BK2
    // Playback rate is display-only on Visual Edit. Slow down uses a fixed safe preview rate.
    const renderPlaybackRateV36BK2 =
      manifest.expandMode === "slow_down" && manifest.playbackRate >= 1 ? 0.5 : manifest.playbackRate;
    const visualRange = manifest.visualFxRanges.find((range) => range.prompt.trim()) || null;
    if (!visualRange) {
      setNotice("Add a Visual Fix prompt before rendering visual FX.");
      return;
    }

    const sourceUrl = manifest.editedUrl || manifest.sourceUrl;
    const sourceFileName = manifest.editedFileName || manifest.sourceFileName || fileNameFromUrl(sourceUrl);
    if (!sourceFileName) {
      setNotice("Visual FX needs an original or edited source clip.");
      return;
    }

    const start = clampEditSeconds(visualRange.startSeconds, 0);
    const end = clampEditSeconds(visualRange.endSeconds, durationSec);
    if (end <= start + 0.05) {
      setNotice("Visual FX end time must be after the start time.");
      return;
    }

    const instruction = `Apply this visual edit only from ${start}s to ${end}s: ${visualRange.prompt.trim()}. Keep identity, framing, motion, audio, and all other time ranges unchanged. Strength ${visualRange.strength}.`;
    const renderDuration = Math.max(1, Math.min(30, Math.round((manifest.trimEndSeconds - manifest.trimStartSeconds || durationSec) * 10) / 10));
    const form = new FormData();
    form.append("video_source", "gallery");
    form.append("video_name", sourceFileName);
    const scope = galleryScopeFromUrl(sourceUrl);
    if (scope) form.append("video_scope", scope);
    form.append("video_title", `${selectedScene.title} Clip ${row.index + 1} Visual FX`);
    form.append("task", "add");
    form.append("instruction", instruction);
    form.append("negativePrompt", "");
    form.append("durationSeconds", String(renderDuration));
    form.append("fps", "24");
    form.append("longerSide", "1024");
    form.append("outputPrefix", `production_edit_vfx_${selectedScene.id}_clip_${row.index + 1}`);

    setRenderingVisualFxClipKey(clipKey);
    setNotice(`Rendering visual FX for Clip ${row.index + 1}...`);

    try {
      const renderResponse = await fetch("/api/edit-video/ltx-edit", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const renderData = await renderResponse.json().catch(() => null);
      if (!renderResponse.ok || !renderData?.ok) {
        throw new Error(String(renderData?.error || "Visual FX render failed."));
      }

      const saveResponse = await fetch("/api/edit-video/ltx-edit-save", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: renderData.jobId,
          fileName: renderData.fileName,
          title: `${selectedScene.title} Clip ${row.index + 1} visual_fx`,
          sourceVideoName: sourceFileName,
          task: "add",
          instruction,
          durationSeconds: renderDuration,
        }),
      });
      const saveData = await saveResponse.json().catch(() => null);
      if (!saveResponse.ok || !saveData?.ok) {
        throw new Error(String(saveData?.error || "Visual FX save failed."));
      }

      const renderedManifest = normalizeProductionEditManifest(row, {
        ...manifest,
        status: "render_ready",
        editedUrl: String(saveData.url || ""),
        editedFileName: String(saveData.fileName || saveData.name || ""),
        error: "",
        updatedAt: new Date().toISOString(),
      }, durationSec);

      setEditDraftsByClipKey((previous) => ({
        ...previous,
        [clipKey]: renderedManifest,
      }));

      const nextScenes = scenes.map((scene) => {
        if (scene.id !== selectedScene.id) return scene;
        const frameClips = animateFrameClips(scene).map((clip, index) =>
          index === row.index
            ? {
                ...clip,
                editManifest: renderedManifest,
              }
            : clip
        );
        return {
          ...scene,
          frameClips,
          status: "edited" as const,
        };
      });

      setScenes(nextScenes);

      try {
        window.localStorage.setItem(
          DRAFT_STORAGE_KEY,
          JSON.stringify(
            {
              schemaVersion: 1,
              projectTitle: projectTitle.trim() || "Untitled Production",
              activeStage,
              updatedAt: new Date().toISOString(),
              scenes: nextScenes,
            },
            null,
            2
          )
        );
      } catch {
        // Scene state already carries the rendered visual FX manifest.
      }


      // OTG_PRODUCTION_EDIT_RENDER_SUCCESS_REPLACE_SELECTED_V3
      handleRenderedEditReplacementResponse(clipKey, durationSec, renderedManifest, {
        ...(renderData || {}),
        result: {
          ...((renderData || {}).result || {}),
          ...(renderedManifest as any),
        },
        output: {
          ...((renderData || {}).output || {}),
          ...(renderedManifest as any),
        },
        renderedVideoUrl:
          (renderedManifest as any).renderedVideoUrl ||
          (renderedManifest as any).editedVideoUrl ||
          (renderedManifest as any).outputUrl ||
          (renderedManifest as any).videoUrl ||
          (renderedManifest as any).url ||
          (renderData as any)?.renderedVideoUrl ||
          (renderData as any)?.editedVideoUrl ||
          (renderData as any)?.outputUrl ||
          (renderData as any)?.videoUrl ||
          (renderData as any)?.url,
        renderedVideoPath:
          (renderedManifest as any).renderedVideoPath ||
          (renderedManifest as any).editedVideoPath ||
          (renderedManifest as any).outputPath ||
          (renderedManifest as any).videoPath ||
          (renderedManifest as any).path ||
          (renderData as any)?.renderedVideoPath ||
          (renderData as any)?.editedVideoPath ||
          (renderData as any)?.outputPath ||
          (renderData as any)?.videoPath ||
          (renderData as any)?.path,
        renderedFileName:
          (renderedManifest as any).renderedFileName ||
          (renderedManifest as any).editedFileName ||
          (renderedManifest as any).outputFileName ||
          (renderedManifest as any).fileName ||
          (renderedManifest as any).filename ||
          (renderedManifest as any).name ||
          (renderData as any)?.renderedFileName ||
          (renderData as any)?.editedFileName ||
          (renderData as any)?.outputFileName ||
          (renderData as any)?.fileName ||
          (renderData as any)?.filename ||
          (renderData as any)?.name,
        promptId:
          (renderedManifest as any).promptId ||
          (renderData as any)?.promptId ||
          (renderData as any)?.prompt_id,
      });

setNotice(`Rendered visual FX for Clip ${row.index + 1}. Assemble will use the edited output.`);
    } catch (error) {
      const failedManifest = normalizeProductionEditManifest(row, {
        ...manifest,
        status: "error",
        error: error instanceof Error ? error.message : "Visual FX render failed.",
        updatedAt: new Date().toISOString(),
      }, durationSec);

      setEditDraftsByClipKey((previous) => ({
        ...previous,
        [clipKey]: failedManifest,
      }));
      setNotice(failedManifest.error || "Visual FX render failed.");
    } finally {
      setRenderingVisualFxClipKey("");
    }
  }
  // OTG_PRODUCTION_EDIT_VISUAL_FX_V1_END
  // OTG_PRODUCTION_EDIT_SFX_SEGMENTS_V1_END
  // OTG_PRODUCTION_EDIT_MUSIC_LAYER_V1_END
  // OTG_PRODUCTION_EDIT_VOICE_SEGMENTS_V1_END
  // OTG_PRODUCTION_EDIT_AUDIO_CLEANUP_V1_END
  // OTG_PRODUCTION_EDIT_TRIM_RENDER_V1_END
// OTG_PRODUCTION_EDIT_MANIFEST_V1_END

// OTG_PRODUCTION_EDIT_EXPANDED_PREVIEW_V1_START
  function renderExpandedEditPreviewModal(scene: ProductionScene | null | undefined, rows: ProductionEditClipRow[]) {
    const expandedIndex = typeof expandedEditClipIndex === "number" ? expandedEditClipIndex : -1;
    const row = rows.find((candidate) => candidate.index === expandedIndex) || null;

    if (!scene || !row?.sourceUrl) return null;

    const availableIndexes = rows
      .filter((candidate) => candidate.sourceUrl)
      .map((candidate) => candidate.index);
    const currentPosition = availableIndexes.indexOf(expandedIndex);
    const previousIndex = currentPosition > 0 ? availableIndexes[currentPosition - 1] : null;
    const nextIndex = currentPosition >= 0 && currentPosition < availableIndexes.length - 1 ? availableIndexes[currentPosition + 1] : null;
    const manifest = normalizeProductionEditManifest(row, editDraftsByClipKey[row.key] || row.clip.editManifest, row.durationSec);

    return (
      <div
        className="fixed inset-0 z-[90] grid place-items-center bg-black/80 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Expanded edit clip preview"
        onClick={() => setExpandedEditClipIndex(null)}
      >
        <div
          className="w-full max-w-6xl overflow-hidden rounded-[22px] border border-white/15 bg-slate-950 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex flex-col gap-3 border-b border-white/10 bg-white/[0.04] p-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-200/75">
                Edit Preview
              </p>
              <h3 className="mt-1 truncate text-xl font-black text-white">{row.title}</h3>
              <p className="mt-1 truncate text-xs text-white/45">{manifest.sourceFileName || "No filename"}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={previousIndex === null}
                onClick={() => {
                  if (previousIndex !== null) setExpandedEditClipIndex(previousIndex);
                }}
                className="rounded-[12px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={nextIndex === null}
                onClick={() => {
                  if (nextIndex !== null) setExpandedEditClipIndex(nextIndex);
                }}
                className="rounded-[12px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                Next
              </button>
              <a
                href={manifest.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-[12px] border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100"
              >
                Open File
              </a>
              <button
                type="button"
                onClick={() => setExpandedEditClipIndex(null)}
                className="rounded-[12px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-white"
              >
                Close
              </button>
            </div>
          </div>

          <div className="bg-black">
            <video
              src={manifest.sourceUrl}
              controls
              autoPlay
              className="max-h-[72vh] w-full bg-black object-contain"
            />
          </div>

          <div className="grid gap-3 border-t border-white/10 bg-white/[0.03] p-4 text-xs text-white/60 md:grid-cols-4">
            <div>
              <span className="block text-white/35">Status</span>
              <span className="font-black text-emerald-200">{editStatusLabel(manifest.status)}</span>
            </div>
            <div>
              <span className="block text-white/35">Source filename</span>
              <span className="break-all">{manifest.sourceFileName || "none"}</span>
            </div>
            <div>
              <span className="block text-white/35">Requested duration</span>
              <span>{row.clip.requestedDurationSeconds ? `${row.clip.requestedDurationSeconds}s` : `${row.durationSec}s`}</span>
            </div>
            <div>
              <span className="block text-white/35">Trim range</span>
              <span>{manifest.trimStartSeconds}s to {manifest.trimEndSeconds}s</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
// OTG_PRODUCTION_EDIT_EXPANDED_PREVIEW_V1_END
  // OTG_SAVE_SELECTED_PRODUCTION_VIDEO_V1_START
  function saveActiveProductionEditClip(clipKey: string, durationSec: number) {
    if (!selectedScene || !clipKey) {
      setNotice("Select a clip before saving.");
      return false;
    }

    const row = findEditRowByKey(clipKey);
    if (!row) {
      setNotice("Could not find the selected clip to save.");
      return false;
    }

    const nowIso = new Date().toISOString();
    const currentDraft = editDraftForClip(clipKey, durationSec);
    const frameClips = animateFrameClips(selectedScene).slice();
    const currentClip: any = frameClips[row.index] || row.clip || {};

    const currentUrl = String(
      currentClip.url ||
      currentDraft.editedUrl ||
      row.sourceUrl ||
      currentDraft.sourceUrl ||
      ""
    ).trim();

    const currentFileName = String(
      currentClip.fileName ||
      currentDraft.editedFileName ||
      currentDraft.sourceFileName ||
      (currentUrl ? fileNameFromUrl(currentUrl) : "") ||
      ""
    ).trim();

    const savedManifest = normalizeProductionEditManifest(
      row,
      {
        ...currentDraft,
        sourceUrl: currentDraft.sourceUrl || row.sourceUrl || currentUrl,
        sourceFileName: currentDraft.sourceFileName || row.sourceFileName || currentFileName,
        editedUrl: currentDraft.editedUrl || (currentClip.editSource ? currentUrl : ""),
        editedFileName: currentDraft.editedFileName || (currentClip.editSource ? currentFileName : ""),
        status: "saved",
        error: "",
        savedAt: nowIso,
        updatedAt: nowIso,
      } as any,
      durationSec
    );

    const savedClip: any = {
      ...currentClip,
      url: currentUrl || currentClip.url,
      fileName: currentFileName || currentClip.fileName,
      editManifest: savedManifest,
      savedAt: nowIso,
      sourceFrameIndex: row.index,
      requestedDurationSeconds: currentClip.requestedDurationSeconds || row.durationSec || durationSec,
    };

    frameClips[row.index] = savedClip;

    updateSceneById(selectedScene.id, {
      frameClips,
    });

    setEditDraftsByClipKey((previous) => ({
      ...previous,
      [clipKey]: savedManifest,
    }));

    setSelectedEditClipKey(clipKey);
    setNotice(`Video saved for Clip ${row.index + 1}. You can click Next: Audio Studio.`);
    return true;
  }
  // OTG_SAVE_SELECTED_PRODUCTION_VIDEO_V1_END

  // OTG_LTX_EDIT_ANYTHING_VIDEO_WIRE_V1_START
  async function renderLtxEditAnythingClip(clipKey: string, durationSec: number) {
    if (!clipKey || renderingVisualFxClipKey || renderingEditClipKey) return;

    const row = findEditRowByKey(clipKey);
    if (!row || !selectedScene) return;

    const field = document.getElementById("otg-production-edit-prompt-v36bl2") as HTMLTextAreaElement | null;
    const editDraftAnyV36BM2 = editDraftForClip(clipKey, durationSec) as any;
    const prompt = String(field?.value || editDraftAnyV36BM2.visualEditPromptV36BL2 || editDraftAnyV36BM2.visualFixPrompt || "").trim();

    if (!prompt) {
      setNotice("Enter an edit instruction first.");
      return;
    }

    const draft = normalizeProductionEditManifest(row, {
      ...editDraftForClip(clipKey, durationSec),
      visualEditPromptV36BL2: prompt,
      visualFixPrompt: prompt,
      visualFixEnabled: true,
      status: "draft",
      updatedAt: new Date().toISOString(),
    } as any, durationSec);

    const sourceUrl = String(
      (row.clip as any)?.url ||
      draft.editedUrl ||
      row.sourceUrl ||
      draft.sourceUrl ||
      ""
    ).trim();

    const sourceFileName = String(
      (row.clip as any)?.fileName ||
      draft.editedFileName ||
      draft.sourceFileName ||
      (sourceUrl ? fileNameFromUrl(sourceUrl) : "") ||
      ""
    ).trim();

    if (!sourceUrl && !sourceFileName) {
      setNotice("Select a source clip before submitting an edit.");
      return;
    }

    setRenderingVisualFxClipKey(clipKey);

    try {
      updateEditDraft(clipKey, durationSec, {
        visualEditPromptV36BL2: prompt,
        visualFixPrompt: prompt,
        visualFixEnabled: true,
        status: "draft",
        error: "",
      } as any);

      const promptLower = prompt.toLowerCase();
      const inferredTask =
        /\bremove|delete|erase\b/.test(promptLower) ? "remove" :
        /\badd|insert|put\b/.test(promptLower) ? "add" :
        /\bstyle|stylize|anime|cartoon|convert|ghibli|paint|render as\b/.test(promptLower) ? "convert" :
        "replace";

      const form = new FormData();
      form.append("video_source", "gallery");
      form.append("video_name", sourceFileName);

      const scope = galleryScopeFromUrl(sourceUrl);
      if (scope) form.append("video_scope", scope);

      form.append("video_title", `${selectedScene.title || "Scene"} Clip ${row.index + 1} Edit`);
      form.append("task", inferredTask);
      form.append("instruction", prompt);
      form.append("negativePrompt", "");
      form.append("durationSeconds", String(Math.max(1, Math.min(16, Number(durationSec) || 8))));
      form.append("fps", "24");
      form.append("longerSide", "512");
      form.append("outputTitle", `production_edit_${selectedScene.id}_clip_${row.index + 1}`);
      form.append("useVideoReasoning", "true");
      form.append("obscuraStrength", "2.3");

      setNotice(`Submitting LTX Edit Anything for Clip ${row.index + 1}.`);

      const response = await fetch("/api/edit-video/ltx-edit", {
        method: "POST",
        credentials: "include",
        body: form,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || "Edit Video render failed.");
      }
const renderedManifest = normalizeProductionEditManifest(row, {
        ...draft,
        status: "render_ready",
        editedUrl: String(data.editedUrl || data.galleryUrl || data.url || data.videoUrl || data.outputUrl || ""),
        editedFileName: String(data.editedFileName || data.fileName || data.name || ""),
        renderedDurationSeconds: Number(data.durationSeconds) > 0 ? Number(data.durationSeconds) : undefined,
        visualEditPromptV36BL2: prompt,
        visualFixPrompt: prompt,
        visualFixEnabled: true,
        error: "",
        updatedAt: new Date().toISOString(),
      } as any, durationSec);

      handleRenderedEditReplacementResponse(clipKey, durationSec, renderedManifest, {
        ...(data || {}),
        editedUrl: renderedManifest.editedUrl,
        editedFileName: renderedManifest.editedFileName,
        renderedVideoUrl: renderedManifest.editedUrl,
        fileName: renderedManifest.editedFileName,
      });

      setNotice(`Edit applied to Clip ${row.index + 1}. The edited clip replaced the original. Use Undo to restore the original.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Edit Video render failed.";
      updateEditDraft(clipKey, durationSec, {
        status: "error",
        error: message,
      } as any);
      setNotice(message);
    } finally {
      setRenderingVisualFxClipKey("");
    }
  }
  // OTG_LTX_EDIT_ANYTHING_VIDEO_WIRE_V1_END


  function renderEditStage() {
    const scene = selectedScene;
    const rows = editClipRows(scene);
    const activeKey =
      selectedEditClipKey && rows.some((row) => row.key === selectedEditClipKey)
        ? selectedEditClipKey
        : rows[0]?.key || "";
    const activeRow = rows.find((row) => row.key === activeKey) || rows[0] || null;
    const durationSec = activeRow?.durationSec || clampStoryboardDuration(scene?.durationSeconds ?? DEFAULT_SCENE_DURATION_SECONDS);
    const draft = activeKey ? editDraftForClip(activeKey, durationSec) : createDefaultProductionEditManifest(activeRow, durationSec);
    const visualRange = draft.visualFxRanges[0] || createProductionEditVisualFxRange(0, durationSec);

    // OTG_SELECTED_EDIT_CLIP_PREVIEW_V1_VARS
    const activePreviewUrl = String(
      (activeRow?.clip as any)?.url ||
      draft.editedUrl ||
      activeRow?.sourceUrl ||
      draft.sourceUrl ||
      ""
    ).trim();

    const activePreviewFileName = String(
      (activeRow?.clip as any)?.fileName ||
      draft.editedFileName ||
      draft.sourceFileName ||
      (activePreviewUrl ? fileNameFromUrl(activePreviewUrl) : "") ||
      "selected clip"
    ).trim();

    const activePreviewIsEdited = Boolean(
      (activeRow?.clip as any)?.editSource ||
      (activeRow?.clip as any)?.editedAt ||
      draft.editedUrl
    );

    const activePreviewCanUndo = Boolean(
      (activeRow?.clip as any)?.originalUrl ||
      (activeRow?.clip as any)?.originalFileName
    );
    const unsupportedEditExpandMode = draft.expandMode === "freeze_start" || draft.expandMode === "freeze_end";
    const invalidSlowDownEditTiming = draft.expandMode === "slow_down" && draft.playbackRate >= 1;
    const invalidPlaybackRateWithoutSlowDown = draft.expandMode === "none" && Math.abs(draft.playbackRate - 1) > 0.001;
    const editRenderBlockedByTiming = unsupportedEditExpandMode || invalidSlowDownEditTiming || invalidPlaybackRateWithoutSlowDown;
    const readyCount = rows.filter((row) => {
      const rowDraft = normalizeProductionEditManifest(row, editDraftsByClipKey[row.key] || row.clip.editManifest, row.durationSec);
      return rowDraft.status === "manifest_saved" || rowDraft.status === "render_ready";
    }).length;
    const sceneVoiceCharacters = sceneCharacterVoiceOptions(scene);
    const voiceModelOptions = productionVoiceOptionsForScene(scene);
    const voiceRangeStep = 0.1;

    if (!scene) {
      return (
        <section className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5 text-white">
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/80">Edit</p>
          <h2 className="mt-2 text-2xl font-black">Clip Edit Workbench</h2>
          <p className="mt-2 text-sm text-white/65">Select a scene before editing clips.</p>
        </section>
      );
    }

    return (
      <section className="space-y-4">
        {renderExpandedEditPreviewModal(scene, rows)}
        <div data-otg-animate-restored="Render Plan" data-marker="OTG_PRODUCTION_ANIMATE_RESTORE_UI_V1" className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/80">Visual Edit</p>
              <h2 className="mt-2 text-2xl font-black text-white">Clip Visual Edit Workbench</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">
                Finish visual timing and visual-fix notes before Audio Studio. Voice dubbing, added voices, music, and mix work are planned in the next Production section.
              </p>
            </div>
            <div className="rounded-[14px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/70">
              <div className="font-black text-white">{scene.title}</div>
              <div>Clips found: {rows.length}</div>
              <div>Edit manifests ready: {readyCount}/{rows.length}</div>
              <div>Arrange: {editArrangeMode ? "on" : "off"}</div>
            </div>
          </div>
        </div>

        {editGalleryOpen ? (
          <div className="rounded-[18px] border border-purple-300/25 bg-purple-300/10 p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-white/80">Gallery</p>
                <h3 className="mt-1 text-lg font-black text-white">Add gallery video to Edit</h3>
                <p className="mt-1 text-sm text-purple-50/70">This adds a clip reference to the scene without deleting or moving the original gallery file.</p>
              </div>
              <button
                type="button"
                onClick={() => setEditGalleryOpen(false)}
                className="rounded-[12px] border border-white/10 bg-black/20 px-4 py-2 text-sm font-black text-white"
              >
                Close
              </button>
            </div>
            {editGalleryLoading ? (
              <div className="mt-4 rounded-[12px] border border-white/10 bg-black/20 p-4 text-sm text-white/60">Loading gallery videos...</div>
            ) : editGalleryError ? (
              <div className="mt-4 rounded-[12px] border border-amber-300/25 bg-amber-300/10 p-4 text-sm text-amber-100">{editGalleryError}</div>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {editGalleryItems.map((item, index) => {
                  const itemName = productionDefaultAnimateItemName(item) || `Gallery video ${index + 1}`;
                  const itemUrl = productionDefaultAnimateItemUrl(item);
                  const itemThumbUrl = productionDefaultAnimateItemThumbUrl(item);
                  const previewKey = `${itemName}_${index}`;
                  const previewActive = editGalleryPreviewKey === previewKey;
                  return (
                    <div key={previewKey} className="overflow-hidden rounded-[14px] border border-white/10 bg-black/25">
                      <div className="relative grid aspect-video place-items-center overflow-hidden bg-black">
                        {itemUrl && previewActive ? (
                          <video
                            key={itemUrl}
                            src={itemUrl}
                            className="h-full w-full object-contain"
                            controls
                            preload="none"
                          />
                        ) : (
                          <>
                            {itemThumbUrl ? (
                              <img
                                src={itemThumbUrl}
                                alt={`${itemName} first frame`}
                                className="absolute inset-0 h-full w-full object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <div className="absolute inset-0 bg-slate-950" />
                            )}
                            <div className="absolute inset-0 bg-black/25" />
                            <button
                              type="button"
                              disabled={!itemUrl}
                              onClick={() => setEditGalleryPreviewKey(previewKey)}
                              className="relative rounded-[12px] border border-white/20 bg-black/65 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white/85 shadow-[0_14px_40px_rgba(0,0,0,0.35)] transition hover:border-purple-300/30 hover:text-purple-100 disabled:cursor-not-allowed disabled:opacity-35"
                            >
                              Preview Clip
                            </button>
                          </>
                        )}
                      </div>
                      <div className="space-y-2 p-3">
                        <div className="truncate text-sm font-black text-white">{itemName}</div>
                        <button
                          type="button"
                          onClick={() => addEditClipFromGallery(item)}
                          className="w-full rounded-[10px] bg-purple-300 px-3 py-2 text-xs font-black text-slate-950"
                        >
                          Add This Clip
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {!rows.length ? (
          <div className="rounded-[18px] border border-amber-300/25 bg-amber-300/10 p-5 text-sm text-amber-100">
            <div className="font-black">No generated clips are available for this scene yet.</div>
            <p className="mt-2 text-amber-50/75">Generate or sync clips in Animate, or add a user video clip directly into this Edit scene.</p>
            <label className="mt-4 inline-flex cursor-pointer items-center justify-center rounded-[12px] border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 text-sm font-black text-cyan-100 transition hover:bg-cyan-300/15">
              {uploadingEditClip ? "Uploading..." : "Add Video Clip"}
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
                disabled={uploadingEditClip}
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  event.target.value = "";
                  void uploadEditClip(file);
                }}
                className="sr-only"
              />
            </label>
            <button
              type="button"
              onClick={() => void openEditGalleryPicker()}
              className="ml-2 mt-4 inline-flex items-center justify-center rounded-[12px] border border-purple-300/30 bg-purple-300/10 px-4 py-3 text-sm font-black text-purple-100 transition hover:bg-purple-300/15"
            >
              Add From Gallery
            </button>
            <button
              type="button"
              disabled
              className="ml-2 mt-4 inline-flex items-center justify-center rounded-[12px] border border-white/10 bg-black/20 px-4 py-3 text-sm font-black text-white/35"
            >
              Arrange
            </button>
          </div>
        ) : (
          <div className="grid gap-5 2xl:grid-cols-[390px_minmax(0,1fr)]">
            <aside className="space-y-3 rounded-[18px] border border-white/10 bg-white/[0.04] p-4 2xl:sticky 2xl:top-24 2xl:max-h-[calc(100vh-220px)] 2xl:overflow-y-auto">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Clip List</p>
                  <h3 className="mt-1 text-lg font-black text-white">Scene clips</h3>
                </div>
                <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs font-black text-white/30">
                  {rows.length} clip{rows.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid gap-2">
                <label className="flex cursor-pointer items-center justify-center rounded-[12px] border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 transition hover:bg-cyan-300/15">
                  {uploadingEditClip ? "Uploading..." : "Add Video Clip"}
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
                    disabled={uploadingEditClip}
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      event.target.value = "";
                      void uploadEditClip(file);
                    }}
                    className="sr-only"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void openEditGalleryPicker()}
                  className="rounded-[12px] border border-purple-300/30 bg-purple-300/10 px-3 py-2 text-xs font-black text-purple-100 transition hover:bg-purple-300/15"
                >
                  Add From Gallery
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditArrangeMode((current) => !current);
                    setNotice(editArrangeMode ? "Clip order locked for Edit and Assemble." : "Arrange mode enabled. Move clips up or down, then click Arrange again to lock the order.");
                  }}
                  className={editArrangeMode ? "rounded-[12px] border border-emerald-300/30 bg-emerald-300/15 px-3 py-2 text-xs font-black text-emerald-100" : "rounded-[12px] border border-white/10 bg-black/20 px-3 py-2 text-xs font-black text-white/70"}
                >
                  {editArrangeMode ? "Done Arrange" : "Arrange"}
                </button>
              </div>

              <div className="space-y-2">
                {rows.map((row) => {
                  const rowDraft = normalizeProductionEditManifest(row, editDraftsByClipKey[row.key] || row.clip.editManifest, row.durationSec);
                  const isActive = row.key === activeKey;
                  const isSaved = rowDraft.status === "manifest_saved" || rowDraft.status === "render_ready";
                  const posterUrl = editClipThumbUrl(row);

                  return (
                    <div
                      key={row.key}
                      className={[
                        "w-full rounded-[14px] border p-2 text-left transition",
                        isActive
                          ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-50"
                          : "border-white/10 bg-black/20 text-white/70 hover:bg-white/[0.06]",
                      ].join(" ")}
                    >
                      <div className="grid gap-3 sm:grid-cols-[132px_minmax(0,1fr)]">
                        {isActive && row.sourceUrl ? (
                          <div className="relative aspect-video overflow-hidden rounded-[12px] border border-white/10 bg-black">
                            <video
                              key={row.sourceUrl}
                              src={row.sourceUrl}
                              poster={posterUrl || undefined}
                              className="h-full w-full object-contain"
                              controls
                              preload="none"
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSelectedEditClipKey(row.key)}
                            className="relative aspect-video overflow-hidden rounded-[12px] border border-white/10 bg-black text-left"
                            aria-label={`Select Clip ${row.index + 1}`}
                          >
                            {posterUrl ? (
                              <img
                                src={posterUrl}
                                alt={`${row.title} first frame`}
                                className="h-full w-full object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <div className="grid h-full w-full place-items-center bg-slate-950 text-[10px] font-black uppercase tracking-[0.14em] text-white/35">
                                No Preview
                              </div>
                            )}
                            <div className="absolute inset-0 grid place-items-center bg-black/20 opacity-0 transition hover:opacity-100">
                              <span className="rounded-full bg-black/70 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white">
                                Select
                              </span>
                            </div>
                          </button>
                        )}

                        <div className="min-w-0">
                          <button type="button" onClick={() => setSelectedEditClipKey(row.key)} className="w-full text-left">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-black">Clip {row.index + 1}</span>
                              <span className={isSaved ? "shrink-0 rounded-full bg-emerald-300/15 px-2 py-1 text-[11px] font-black text-emerald-300" : "shrink-0 rounded-full bg-white/3 px-2 py-1 text-[11px] font-black text-white/45"}>
                                {editStatusLabel(rowDraft.status)}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/45">
                              <span>{row.durationSec}s source</span>
                              {row.clip.source === "uploaded" ? <span className="rounded-full bg-cyan-300/15 px-2 py-0.5 font-black text-cyan-200">User video</span> : null}
                            </div>
                            <div className="mt-1 truncate text-[11px] text-white/35">{row.sourceFileName || "No filename"}</div>
                          </button>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedEditClipKey(row.key);
                                setExpandedEditClipIndex(row.index);
                              }}
                              disabled={!row.sourceUrl}
                              className="rounded-[10px] border border-cyan-300/25 bg-cyan-300/10 px-2 py-2 text-xs font-black text-cyan-100 disabled:cursor-not-allowed disabled:opacity-35"
                            >
                              Preview
                            </button>
                            <button
                              type="button"
                              onClick={() => removeEditClip(row.index)}
                              className="rounded-[10px] border border-red-300/25 bg-red-300/10 px-2 py-2 text-xs font-black text-red-100 hover:bg-red-300/15"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                      {editArrangeMode ? (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            disabled={row.index === 0}
                            onClick={() => moveEditClip(row.index, -1)}
                            className="rounded-[10px] border border-white/10 bg-white/[0.06] px-2 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-35"
                          >
                            Move Up
                          </button>
                          <button
                            type="button"
                            disabled={row.index >= rows.length - 1}
                            onClick={() => moveEditClip(row.index, 1)}
                            className="rounded-[10px] border border-white/10 bg-white/[0.06] px-2 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-35"
                          >
                            Move Down
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </aside>

            <div className="space-y-4">
              <div className="grid gap-5 xl:grid-cols-[minmax(360px,1fr)_minmax(320px,420px)]">
                <div data-otg-animate-restored="Render Plan" data-marker="OTG_PRODUCTION_ANIMATE_RESTORE_UI_V1" className="rounded-[18px] border border-white/10 bg-white/[0.04] p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Preview</p>
                      <h3 className="text-lg font-black text-white">{activeRow?.title || "Clip"}</h3>
                    </div>
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-black text-white/60">
                      {draft.trimStartSeconds}s to {draft.trimEndSeconds}s
                    </span>
                  </div>

                  {activeRow?.sourceUrl ? (
                    <div>
                      <video
                        key={activeRow.sourceUrl}
                        controls
                        onDoubleClick={() => setExpandedEditClipIndex(activeRow.index)}
                        className="aspect-video w-full rounded-[14px] bg-black object-contain"
                      >
                        <source src={activeRow.sourceUrl} />
                      </video>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-white/45">
                        <span className="truncate">{activeRow.sourceFileName || "No source filename"}</span>
                        <button
                          type="button"
                          onClick={() => setExpandedEditClipIndex(activeRow.index)}
                          className="rounded-[10px] border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 font-black text-cyan-100"
                        >
                          Expand Preview
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid aspect-video place-items-center rounded-[14px] border border-dashed border-white/15 bg-black/25 text-sm text-white/45">
                      No clip preview available.
                    </div>
                  )}
                </div>

                <div data-otg-v36bk2-hidden="Render Plan" data-marker="OTG_PRODUCTION_VISUAL_EDIT_CLEANUP_V36BK2" data-otg-v36bl2-hidden="Render Plan" data-otg-v36bl2-marker="OTG_PRODUCTION_EDIT_TWO_CUE_CARDS_V36BL2" className="hidden rounded-[18px] border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Render Plan</p>
                  <div className="mt-3 space-y-2 text-sm text-white/65">
                    <div>1. Trim clip</div>
                    <div>2. Apply visual-fix range if enabled</div>
                    <div>3. Clean original audio</div>
                    <div>4. Add voice segments</div>
                    <div>5. Mix music and SFX</div>
                    <div>6. Save edited clip for Assemble</div>
                  </div>
                  <button
                    type="button"
                    disabled={!activeKey}
                    onClick={() => saveEditManifest(activeKey, durationSec)}
                    className="mt-4 w-full rounded-[12px] bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Save Edited Clip Manifest
                  </button>
                  <button
                    type="button"
                    disabled={
                      !activeKey ||
                      Boolean(renderingEditClipKey) ||
                      editRenderBlockedByTiming
                    }
                    onClick={() => renderTrimOnlyEditClip(activeKey, durationSec)}
                    className="mt-2 w-full rounded-[12px] border border-emerald-300/30 bg-emerald-300/10 px-4 py-3 text-sm font-black text-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {renderingEditClipKey === activeKey ? "Rendering Edit..." : "Render Edited Clip"}
                  </button>
                  {draft.editedUrl ? (
                    <a
                      href={draft.editedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block truncate rounded-[12px] border border-white/10 bg-black/20 px-3 py-2 text-xs font-black text-cyan-100"
                    >
                      Open edited output: {draft.editedFileName || "edited clip"}
                    </a>
                  ) : null}
                  {draft.error ? (
                    <div className="mt-2 rounded-[12px] border border-rose-300/25 bg-rose-300/10 px-3 py-2 text-xs font-bold text-rose-100">
                      {draft.error}
                    </div>
                  ) : null}
                  {unsupportedEditExpandMode ? (
                    <div className="mt-2 rounded-[12px] border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-bold text-amber-100">
                      Freeze start/end expand modes are not supported by this render path yet. Use None or Slow down.
                    </div>
                  ) : invalidSlowDownEditTiming ? (
                    <div className="mt-2 rounded-[12px] border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-bold text-amber-100">
                      Slow down requires playback rate below 1.
                    </div>
                  ) : invalidPlaybackRateWithoutSlowDown ? (
                    <div className="mt-2 rounded-[12px] border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-bold text-amber-100">
                      Playback rate changes require expand mode Slow down.
                    </div>
                  ) : null}
                </div>
              </div>

              <div data-otg-v36bk2-hidden="Voice Dubbing" data-marker="OTG_PRODUCTION_VISUAL_EDIT_CLEANUP_V36BK2" data-otg-v36bl2-hidden="Trim and Timing" data-otg-v36bl2-marker="OTG_PRODUCTION_EDIT_TWO_CUE_CARDS_V36BL2" className="hidden rounded-[18px] border border-white/10 bg-white/[0.04] p-6">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Trim and Timing</p>
                <div className="mt-4">
                  {renderEditRangeSlider({
                    label: "Video trim range",
                    start: draft.trimStartSeconds,
                    end: draft.trimEndSeconds,
                    durationSec,
                    onChange: ({ start, end }) => updateEditDraft(activeKey, durationSec, {
                      trimStartSeconds: start,
                      trimEndSeconds: end,
                      status: "draft",
                    }),
                  })}
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    <label className="block">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Start seconds</span>
                    <div className="mt-2 rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm font-black text-white/80">
                      {Number(draft.trimStartSeconds || 0).toFixed(1)}s
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!activeKey || Boolean(renderingEditClipKey) || editRenderBlockedByTiming}
                        onClick={() => renderTrimOnlyEditClip(activeKey, durationSec)}
                        className="rounded-[10px] border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {renderingEditClipKey === activeKey ? "Cutting..." : "Cut"}
                      </button>
                      <button
                        type="button"
                        disabled={!activeKey || Boolean(renderingEditClipKey)}
                        onClick={() => restoreSelectedEditClipOriginal(activeKey, durationSec)}
                        className="rounded-[10px] border border-white/10 bg-white/3 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-white/75 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Undo
                      </button>
                      <button
                      type="button"
                      disabled={!activeKey || Boolean(renderingVisualFxClipKey) || Boolean(renderingEditClipKey)}
                      onClick={() => saveActiveProductionEditClip(activeKey, durationSec)}
                      className="rounded-[12px] bg-violet-500/20 px-4 py-3 text-sm font-black text-violet-200 transition hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Save
                    </button>
                    </div>
                  </label>
                                    <label className="block">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">End seconds</span>
                    <div className="mt-2 rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm font-black text-white/80">
                      {Number(draft.trimEndSeconds || 0).toFixed(1)}s
                    </div>
                  </label>
                                    <label className="block">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Playback rate</span>
                    <div className="mt-2 rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm font-black text-white/80">
                      {draft.expandMode === "slow_down" ? "0.5x auto" : `${Number(draft.playbackRate || 1).toFixed(2)}x`}
                    </div>
                  </label>
                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Expand mode</span>
                    <select
                      value={draft.expandMode}
                      onChange={(event) => updateEditDraft(activeKey, durationSec, { expandMode: event.target.value as ProductionClipEditManifest["expandMode"], status: "draft" })}
                      className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/30"
                    >
                      <option value="none" className="bg-slate-950">None</option>
                      <option value="freeze_start" className="bg-slate-950">Freeze start</option>
                      <option value="freeze_end" className="bg-slate-950">Freeze end</option>
                      <option value="slow_down" className="bg-slate-950">Slow down</option>
                    </select>
                  </label>
                </div>
              </div>

              <div data-otg-v36bk2-hidden="Voice Dubbing" data-marker="OTG_PRODUCTION_VISUAL_EDIT_CLEANUP_V36BK2" className="hidden rounded-[18px] border border-white/10 bg-white/[0.04] p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Voice Dubbing</p>
                    <h3 className="text-lg font-black text-white">Timed voice conversion</h3>
                    <p className="mt-1 max-w-2xl text-xs leading-5 text-white/30">
                      Select a storyboard character voice, then mark the clip range where that speaker should be converted.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer rounded-[12px] border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-black text-white/80">
                      Upload Voice
                      <input
                        type="file"
                        accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg,.webm"
                        className="sr-only"
                        onChange={(event) => {
                          handleProductionVoiceUpload(event.target.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => addVoiceSegment(activeKey, durationSec)}
                      className="rounded-[12px] border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-100"
                    >
                      Add Voice Segment
                    </button>
                  </div>
                </div>

                <div className="mt-3 rounded-[12px] border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/35">
                  {productionVoiceModelsLoading ? "Loading saved character voices..." : null}
                  {!productionVoiceModelsLoading && productionVoiceModelsError ? productionVoiceModelsError : null}
                  {!productionVoiceModelsLoading && !productionVoiceModelsError
                    ? `${voiceModelOptions.filter((option) => option.usable).length} voice option(s) available for conversion.`
                    : null}
                </div>

                <div className="mt-4 space-y-3">
                  {draft.voiceSegments.map((segment, index) => {
                    const rangeStart = clampEditSeconds(segment.startSeconds, 0);
                    const rangeEnd = clampEditSeconds(segment.endSeconds, durationSec);
                    return (
                      <div key={segment.id} className="rounded-[14px] border border-white/10 bg-black/20 p-4">
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <label className="block">
                            <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Speaker in Clip</span>
                            <select
                              value={segment.characterId || segment.character}
                              onChange={(event) => {
                                const character = sceneVoiceCharacters.find((item) => item.id === event.target.value);
                                updateVoiceSegment(activeKey, durationSec, index, {
                                  character: character?.label || event.target.value,
                                  characterId: character?.id || "",
                                });
                              }}
                              className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
                            >
                              <option value={segment.character || ""} className="bg-slate-950">{segment.character || "Select speaker"}</option>
                              {sceneVoiceCharacters.map((character) => (
                                <option key={character.id || "character"} value={character.id} className="bg-slate-950">
                                  {character.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block xl:col-span-2">
                            <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Target Voice</span>
                            <select
                              value={segment.targetVoiceId || ""}
                              onChange={(event) => applyVoiceModelToSegment(activeKey, durationSec, index, event.target.value)}
                              className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
                            >
                              <option value="" className="bg-slate-950">Select character voice...</option>
                              {voiceModelOptions.map((option) => (
                                <option key={option.id} value={option.id} disabled={!option.usable} className="bg-slate-950">
                                  {option.name} - {option.engine}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Mode</span>
                            <select value={segment.mode} onChange={(event) => updateVoiceSegment(activeKey, durationSec, index, { mode: event.target.value as ProductionEditVoiceSegment["mode"] })} className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none">
                              <option value="voice_conversion" className="bg-slate-950">Voice conversion</option>
                              <option value="replace_original" className="bg-slate-950">Replace original</option>
                              <option value="mix_over_original" className="bg-slate-950">Mix over original</option>
                              <option value="mute_original_range" className="bg-slate-950">Mute original in range</option>
                              <option value="keep_original" className="bg-slate-950">Keep original</option>
                            </select>
                          </label>
                        </div>

                        <div className="mt-4 rounded-[12px] border border-white/10 bg-white/[0.03] p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-black uppercase tracking-[0.16em] text-white/45">
                            <span>Conversion Range</span>
                            <span className="normal-case tracking-normal text-cyan-100">{rangeStart}s to {rangeEnd}s of {durationSec}s</span>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <label className="block text-xs text-white/35">
                              Start
                              <input
                                type="range"
                                min={0}
                                max={durationSec}
                                step={voiceRangeStep}
                                value={rangeStart}
                                onChange={(event) => {
                                  const nextStart = Math.min(Number(event.target.value), Math.max(0, rangeEnd - voiceRangeStep));
                                  updateVoiceSegment(activeKey, durationSec, index, { startSeconds: nextStart });
                                }}
                                className="mt-2 w-full accent-cyan-300"
                              />
                            </label>
                            <label className="block text-xs text-white/35">
                              End
                              <input
                                type="range"
                                min={0}
                                max={durationSec}
                                step={voiceRangeStep}
                                value={rangeEnd}
                                onChange={(event) => {
                                  const nextEnd = Math.max(Number(event.target.value), Math.min(durationSec, rangeStart + voiceRangeStep));
                                  updateVoiceSegment(activeKey, durationSec, index, { endSeconds: nextEnd });
                                }}
                                className="mt-2 w-full accent-cyan-300"
                              />
                            </label>
                          </div>
                        </div>

                        <label className="mt-3 block">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Dialogue / Transcript</span>
                            <button
                              type="button"
                              disabled={segment.transcriptStatus === "pending"}
                              onClick={() => requestVoiceSegmentTranscript(activeKey, durationSec, index, segment)}
                              className="rounded-[10px] border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-black text-white/75 disabled:cursor-wait disabled:opacity-50"
                            >
                              {segment.transcriptStatus === "pending" ? "Transcribing..." : "Transcript"}
                            </button>
                          </div>
                          <textarea value={segment.text} onChange={(event) => updateVoiceSegment(activeKey, durationSec, index, { text: event.target.value })} rows={3} className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm leading-6 text-white outline-none" />
                          {segment.transcriptError ? <p className="mt-2 text-xs text-amber-200/80">{segment.transcriptError}</p> : null}
                        </label>

                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <label className="flex items-center gap-2 text-sm text-white/65">
                            Conversion volume
                            <input type="number" min={0} max={2} step={0.05} value={segment.volume} onChange={(event) => updateVoiceSegment(activeKey, durationSec, index, { volume: Math.max(0, Math.min(2, Number(event.target.value) || 1)) })} className="w-20 rounded-[10px] border border-white/10 bg-black/30 px-2 py-1 text-white outline-none" />
                          </label>
                          <button type="button" onClick={() => removeVoiceSegment(activeKey, durationSec, index)} className="rounded-[10px] border border-rose-300/25 bg-rose-300/10 px-3 py-2 text-sm font-black text-rose-100">
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                <div data-otg-v36bk2-hidden="Background Music" data-marker="OTG_PRODUCTION_VISUAL_EDIT_CLEANUP_V36BK2" className="hidden rounded-[18px] border border-white/10 bg-white/[0.04] p-6">
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Music</p>
                  <h3 className="text-lg font-black text-white">Background music</h3>

                  <div className="mt-4 space-y-3">
                    <label className="flex items-center gap-3 text-sm font-bold text-white/75">
                      <input type="checkbox" checked={draft.music.enabled} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "music", { ...draft.music, enabled: event.target.checked })} />
                      Enable music layer
                    </label>
                    <select value={draft.music.source} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "music", { ...draft.music, source: event.target.value as ProductionClipEditManifest["music"]["source"], enabled: event.target.value !== "none" })} className="w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none">
                      <option value="none" className="bg-slate-950">None</option>
                      <option value="generate" className="bg-slate-950">Generate later</option>
                      <option value="library" className="bg-slate-950">Library</option>
                      <option value="upload" className="bg-slate-950">Upload</option>
                    </select>
                    {draft.music.source === "library" || draft.music.source === "upload" ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="block">
                          <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Music audio gallery filename</span>
                          <input
                            value={draft.music.audioFileName}
                            onChange={(event) => updateEditDraftNested(activeKey, durationSec, "music", { ...draft.music, audioFileName: event.target.value, enabled: true })}
                            placeholder="background_music.wav"
                            className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Music audio URL</span>
                          <input
                            value={draft.music.audioUrl}
                            onChange={(event) => updateEditDraftNested(activeKey, durationSec, "music", { ...draft.music, audioUrl: event.target.value, enabled: true })}
                            placeholder="/api/gallery/file?name=background_music.wav"
                            className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35"
                          />
                        </label>
                      </div>
                    ) : null}
                    <textarea value={draft.music.prompt} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "music", { ...draft.music, prompt: event.target.value })} rows={3} placeholder="Music prompt or library notes" className="w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/35" />
                    <div className="rounded-[14px] border border-cyan-300/15 bg-cyan-300/[0.06] p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-black text-cyan-50">ACE-Step background bed</p>
                          <p className="mt-1 text-xs leading-5 text-white/30">Uses the selected clip audio as a 4-second style reference, then saves the generated music into the gallery for render.</p>
                        </div>
                        <button
                          type="button"
                          disabled={generatingAceMusicClipKey === activeKey || !draft.sourceFileName}
                          onClick={() => void generateProductionAceBackgroundMusic(activeKey, durationSec, draft)}
                          className="rounded-[12px] border border-cyan-300/30 bg-cyan-300/15 px-4 py-2 text-sm font-black text-cyan-50 transition hover:bg-cyan-300/20 disabled:cursor-wait disabled:opacity-50"
                        >
                          {generatingAceMusicClipKey === activeKey ? "Generating..." : "Generate with ACE"}
                        </button>
                      </div>
                      {aceMusicStatusByClipKey[activeKey] ? (
                        <p className="mt-2 text-xs font-bold text-white/38">{aceMusicStatusByClipKey[activeKey]}</p>
                      ) : null}
                    </div>
                    {renderEditRangeSlider({
                      label: "Background music range",
                      start: draft.music.startSeconds,
                      end: draft.music.endSeconds,
                      durationSec,
                      disabled: !draft.music.enabled,
                      onChange: ({ start, end }) => updateEditDraftNested(activeKey, durationSec, "music", {
                        ...draft.music,
                        enabled: true,
                        startSeconds: start,
                        endSeconds: end,
                      }),
                    })}
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="block">
                        <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Start</span>
                        <input type="number" min={0} max={durationSec} step={0.1} value={draft.music.startSeconds} onChange={(event) => {
                          const range = clampEditRange(Number(event.target.value), draft.music.endSeconds, durationSec);
                          updateEditDraftNested(activeKey, durationSec, "music", { ...draft.music, enabled: true, startSeconds: range.start, endSeconds: range.end });
                        }} className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none" />
                      </label>
                      <label className="block">
                        <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">End</span>
                        <input type="number" min={0} max={durationSec} step={0.1} value={draft.music.endSeconds} onChange={(event) => {
                          const range = clampEditRange(draft.music.startSeconds, Number(event.target.value), durationSec);
                          updateEditDraftNested(activeKey, durationSec, "music", { ...draft.music, enabled: true, startSeconds: range.start, endSeconds: range.end });
                        }} className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none" />
                      </label>
                      <label className="block">
                        <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Volume</span>
                        <input type="number" min={0} max={1} step={0.05} value={draft.music.volume} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "music", { ...draft.music, volume: Math.max(0, Math.min(1, Number(event.target.value) || 0)) })} className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none" />
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => updateEditDraftNested(activeKey, durationSec, "music", {
                          ...draft.music,
                          enabled: true,
                          fadeInSec: draft.music.fadeInSec > 0 ? 0 : 0.5,
                        })}
                        className={classNames(
                          "rounded-[12px] border px-4 py-2 text-sm font-black transition",
                          draft.music.fadeInSec > 0
                            ? "border-cyan-300/40 bg-cyan-300/20 text-cyan-50"
                            : "border-white/10 bg-white/[0.06] text-white/70"
                        )}
                      >
                        Fade In
                      </button>
                      <button
                        type="button"
                        onClick={() => updateEditDraftNested(activeKey, durationSec, "music", {
                          ...draft.music,
                          enabled: true,
                          fadeOutSec: draft.music.fadeOutSec > 0 ? 0 : 0.5,
                        })}
                        className={classNames(
                          "rounded-[12px] border px-4 py-2 text-sm font-black transition",
                          draft.music.fadeOutSec > 0
                            ? "border-cyan-300/40 bg-cyan-300/20 text-cyan-50"
                            : "border-white/10 bg-white/[0.06] text-white/70"
                        )}
                      >
                        Fade Out
                      </button>
                    </div>
                    <label className="flex items-center gap-3 text-sm font-bold text-white/75">
                      <input type="checkbox" checked={draft.music.duckUnderDialogue} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "music", { ...draft.music, duckUnderDialogue: event.target.checked })} />
                      Duck under dialogue
                    </label>
                  </div>
                </div>

                <div data-otg-v36bk2-hidden="Sound Effects" data-marker="OTG_PRODUCTION_VISUAL_EDIT_CLEANUP_V36BK2" className="hidden rounded-[18px] border border-white/10 bg-white/[0.04] p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Sound Effects</p>
                      <h3 className="text-lg font-black text-white">Timed SFX</h3>
                    </div>
                    <button type="button" onClick={() => addSfxSegment(activeKey, durationSec)} className="rounded-[12px] border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-100">
                      Add SFX
                    </button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {draft.sfxSegments.length ? draft.sfxSegments.map((segment, index) => {
                      const sfxStart = segment.mode === "full_clip" ? 0 : segment.startSeconds;
                      const sfxEnd = segment.mode === "full_clip" ? durationSec : segment.startSeconds + segment.durationSeconds;
                      const sfxRange = clampEditRange(sfxStart, sfxEnd, durationSec);

                      return (
                      <div key={segment.id} className="rounded-[14px] border border-white/10 bg-black/20 p-3">
                        <input value={segment.label} onChange={(event) => updateSfxSegment(activeKey, durationSec, index, { label: event.target.value })} className="w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm font-black text-white outline-none" />
                        <textarea value={segment.prompt} onChange={(event) => updateSfxSegment(activeKey, durationSec, index, { prompt: event.target.value })} rows={2} className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm leading-6 text-white outline-none" />
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <label className="block">
                            <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Effect Mode</span>
                            <select
                              value={segment.mode}
                              onChange={(event) => updateSfxSegment(activeKey, durationSec, index, { mode: event.target.value as ProductionEditSfxSegment["mode"] })}
                              className="mt-1 w-full rounded-[10px] border border-white/10 bg-black/30 px-2 py-1 text-sm text-white outline-none"
                            >
                              <option value="timed" className="bg-slate-950">Timed range</option>
                              <option value="full_clip" className="bg-slate-950">Entire clip</option>
                            </select>
                          </label>
                          <div className="rounded-[10px] border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/35">
                            {segment.mode === "full_clip"
                              ? `Applies across 0s to ${durationSec}s.`
                              : `Starts at ${segment.startSeconds}s for ${segment.durationSeconds}s.`}
                          </div>
                        </div>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <input value={segment.audioFileName} onChange={(event) => updateSfxSegment(activeKey, durationSec, index, { audioFileName: event.target.value })} placeholder="sfx_whoosh.wav" className="rounded-[10px] border border-white/10 bg-black/30 px-2 py-1 text-sm text-white outline-none placeholder:text-white/35" />
                          <input value={segment.audioUrl} onChange={(event) => updateSfxSegment(activeKey, durationSec, index, { audioUrl: event.target.value })} placeholder="/api/gallery/file?name=sfx_whoosh.wav" className="rounded-[10px] border border-white/10 bg-black/30 px-2 py-1 text-sm text-white outline-none placeholder:text-white/35" />
                        </div>
                        <div className="mt-2">
                          {renderEditRangeSlider({
                            label: "Sound effect range",
                            start: sfxRange.start,
                            end: sfxRange.end,
                            durationSec,
                            disabled: segment.mode === "full_clip",
                            onChange: (range) => {
                              updateSfxSegment(activeKey, durationSec, index, {
                                startSeconds: range.start,
                                durationSeconds: Math.max(0.1, Math.round((range.end - range.start) * 10) / 10),
                              });
                            },
                          })}
                        </div>
                        <div className="mt-2 grid gap-2 md:grid-cols-4">
                          <input type="number" min={0} max={durationSec} step={0.1} value={segment.mode === "full_clip" ? 0 : sfxRange.start} disabled={segment.mode === "full_clip"} onChange={(event) => {
                            const next = clampEditRange(Number(event.target.value), sfxRange.end, durationSec);
                            updateSfxSegment(activeKey, durationSec, index, {
                              startSeconds: next.start,
                              durationSeconds: Math.max(0.1, Math.round((next.end - next.start) * 10) / 10),
                            });
                          }} className="rounded-[10px] border border-white/10 bg-black/30 px-2 py-1 text-sm text-white outline-none disabled:opacity-45" />
                          <input type="number" min={0.1} max={durationSec} step={0.1} value={segment.mode === "full_clip" ? durationSec : Math.max(0.1, Math.round((sfxRange.end - sfxRange.start) * 10) / 10)} disabled={segment.mode === "full_clip"} onChange={(event) => {
                            const nextEnd = sfxRange.start + Number(event.target.value);
                            const next = clampEditRange(sfxRange.start, nextEnd, durationSec);
                            updateSfxSegment(activeKey, durationSec, index, {
                              startSeconds: next.start,
                              durationSeconds: Math.max(0.1, Math.round((next.end - next.start) * 10) / 10),
                            });
                          }} className="rounded-[10px] border border-white/10 bg-black/30 px-2 py-1 text-sm text-white outline-none disabled:opacity-45" />
                          <input type="number" min={0} max={2} step={0.05} value={segment.volume} onChange={(event) => updateSfxSegment(activeKey, durationSec, index, { volume: Math.max(0, Math.min(2, Number(event.target.value) || 1)) })} className="rounded-[10px] border border-white/10 bg-black/30 px-2 py-1 text-sm text-white outline-none" />
                          <button type="button" onClick={() => removeSfxSegment(activeKey, durationSec, index)} className="rounded-[10px] border border-rose-300/25 bg-rose-300/10 px-2 py-1 text-sm font-black text-rose-100">
                            Delete
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => updateSfxSegment(activeKey, durationSec, index, { fadeInSec: segment.fadeInSec > 0 ? 0 : 0.25 })}
                            className={classNames(
                              "rounded-[10px] border px-3 py-2 text-xs font-black",
                              segment.fadeInSec > 0
                                ? "border-cyan-300/40 bg-cyan-300/20 text-cyan-50"
                                : "border-white/10 bg-black/20 text-white/35"
                            )}
                          >
                            Fade In
                          </button>
                          <button
                            type="button"
                            onClick={() => updateSfxSegment(activeKey, durationSec, index, { fadeOutSec: segment.fadeOutSec > 0 ? 0 : 0.25 })}
                            className={classNames(
                              "rounded-[10px] border px-3 py-2 text-xs font-black",
                              segment.fadeOutSec > 0
                                ? "border-cyan-300/40 bg-cyan-300/20 text-cyan-50"
                                : "border-white/10 bg-black/20 text-white/35"
                            )}
                          >
                            Fade Out
                          </button>
                        </div>
                      </div>
                      );
                    }) : (
                      <div className="rounded-[14px] border border-dashed border-white/15 bg-black/20 p-4 text-sm text-white/45">
                        No sound effects added.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                <div data-otg-v36bk2-hidden="Audio Cleanup" data-marker="OTG_PRODUCTION_VISUAL_EDIT_CLEANUP_V36BK2" className="hidden rounded-[18px] border border-white/10 bg-white/[0.04] p-6">
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Audio Cleanup</p>
                  <h3 className="text-lg font-black text-white">Original audio policy</h3>
                  <div className="mt-4 space-y-3">
                    <select
                      value={draft.audioPolicy.mode}
                      onChange={(event) => {
                        const mode = event.target.value as ProductionClipEditManifest["audioPolicy"]["mode"];
                        updateEditDraft(activeKey, durationSec, {
                          audioPolicy: {
                            ...draft.audioPolicy,
                            mode,
                          },
                          audioCleanup: {
                            ...draft.audioCleanup,
                            muteOriginal: mode === "mute_original",
                            reduceOriginalVolume: mode === "reduce_original",
                          },
                          status: "draft",
                        });
                      }}
                      className="w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
                    >
                      <option value="keep_original" className="bg-slate-950">Keep original audio</option>
                      <option value="mute_original" className="bg-slate-950">Mute original audio</option>
                      <option value="reduce_original" className="bg-slate-950">Reduce original audio volume</option>
                      <option value="replace_original" className="bg-slate-950">Replace original audio</option>
                    </select>

                    {draft.audioPolicy.mode === "reduce_original" ? (
                      <label className="block">
                        <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Original volume</span>
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={draft.audioPolicy.originalVolume}
                          onChange={(event) => {
                            const originalVolume = Math.max(0, Math.min(1, Number(event.target.value) || 0));
                            updateEditDraft(activeKey, durationSec, {
                              audioPolicy: { ...draft.audioPolicy, originalVolume },
                              audioCleanup: { ...draft.audioCleanup, originalVolume, reduceOriginalVolume: true },
                              status: "draft",
                            });
                          }}
                          className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
                        />
                      </label>
                    ) : null}

                    {draft.audioPolicy.mode === "replace_original" ? (
                      <div className="space-y-3 rounded-[14px] border border-white/10 bg-black/20 p-3">
                        <label className="block">
                          <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Replacement audio gallery filename</span>
                          <input
                            value={draft.audioPolicy.replacementAudioFileName}
                            onChange={(event) =>
                              updateEditDraft(activeKey, durationSec, {
                                audioPolicy: { ...draft.audioPolicy, replacementAudioFileName: event.target.value },
                                status: "draft",
                              })
                            }
                            placeholder="voiceover.wav or replacement.m4a"
                            className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Replacement volume</span>
                          <input
                            type="number"
                            min={0}
                            max={2}
                            step={0.05}
                            value={draft.audioPolicy.replacementVolume}
                            onChange={(event) =>
                              updateEditDraft(activeKey, durationSec, {
                                audioPolicy: { ...draft.audioPolicy, replacementVolume: Math.max(0, Math.min(2, Number(event.target.value) || 1)) },
                                status: "draft",
                              })
                            }
                            className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
                          />
                        </label>
                      </div>
                    ) : null}

                    <div className="rounded-[12px] border border-white/10 bg-black/20 p-3 text-xs leading-5 text-white/30">
                      Render supports trim, audio cleanup, timed voice, music, SFX, and optional LTX visual FX.
                    </div>
                  </div>
                </div>
                {/* OTG_SELECTED_EDIT_CLIP_PREVIEW_V1_CARD */}
                <div className="xl:col-span-2 rounded-[18px] border border-cyan-300/20 bg-black/30 p-5 shadow-[0_0_28px_rgba(103,232,249,0.08)]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100/65">Selected Clip Preview</p>
                      <h3 className="mt-1 text-lg font-black text-white">
                        {activeRow ? `Clip ${activeRow.index + 1}` : "No clip selected"}
                      </h3>
                      <p className="mt-1 max-w-2xl truncate text-xs font-bold text-white/45">
                        {activePreviewFileName}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={classNames(
                        "rounded-full border px-3 py-1 text-xs font-black",
                        activePreviewIsEdited
                          ? "border-emerald-300/35 bg-emerald-300/12 text-emerald-100"
                          : "border-white/10 bg-white/[0.06] text-white/60"
                      )}>
                        {activePreviewIsEdited ? "Edited clip active" : "Original clip active"}
                      </span>
                      {activePreviewCanUndo ? (
                        <button
                          type="button"
                          disabled={!activeKey || Boolean(renderingEditClipKey)}
                          onClick={() => restoreSelectedEditClipOriginal(activeKey, durationSec)}
                          className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-black text-white/75 transition hover:bg-white/[0.10] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Undo to Original
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {activePreviewUrl ? (
                    <video
                      key={`${activeKey}-${activePreviewUrl}`}
                      src={activePreviewUrl}
                      controls
                      playsInline
                      preload="metadata"
                      className="mt-4 aspect-video w-full rounded-[16px] border border-white/10 bg-black object-contain shadow-inner"
                    />
                  ) : (
                    <div className="mt-4 grid aspect-video place-items-center rounded-[16px] border border-white/10 bg-black/40 text-sm font-bold text-white/45">
                      Select a clip to preview it here.
                    </div>
                  )}
                </div>

                                {/* OTG_PRODUCTION_EDIT_TWO_CUE_CARDS_V36BL2 */}
                <div data-otg-v36bl2-card="trim-video" className="rounded-[18px] border border-white/10 bg-white/[0.04] p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Trim Video</p>
                      <p className="mt-2 text-sm leading-6 text-white/35">
                        Drag the left handle to cut the beginning. Drag the right handle to cut the ending.
                      </p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-black text-white/60">
                      {Number(draft.trimStartSeconds || 0).toFixed(1)}s to {Number(draft.trimEndSeconds || durationSec || 0).toFixed(1)}s
                    </span>
                  </div>
                  {/* OTG_PRODUCTION_TRIM_VISIBLE_RAIL_V36BL3 */}
                  <style>{`
                    .otg-v36bl3-trimSlider {
                      isolation: isolate;
                      overflow: visible;
                    }

                    .otg-v36bl3-trimSlider > div {
                      pointer-events: none;
                    }

                    .otg-v36bl3-range {
                      -webkit-appearance: none;
                      appearance: none;
                      background: transparent;
                      color: transparent;
                      border: 0;
                      outline: none;
                      box-shadow: none;
                      opacity: 0;
                      pointer-events: none;
                    }

                    .otg-v36bl3-range:focus {
                      outline: none;
                      box-shadow: none;
                    }

                    .otg-v36bl3-range::-webkit-slider-runnable-track {
                      width: 100%;
                      height: 80px;
                      background: transparent;
                      border: 0;
                      box-shadow: none;
                    }

                    .otg-v36bl3-range::-webkit-slider-thumb {
                      -webkit-appearance: none;
                      appearance: none;
                      pointer-events: auto;
                      width: 32px;
                      height: 80px;
                      margin-top: 0;
                      background: transparent;
                      border: 0;
                      border-radius: 0;
                      box-shadow: none;
                      cursor: ew-resize;
                    }

                    .otg-v36bl3-range::-moz-range-track {
                      width: 100%;
                      height: 80px;
                      background: transparent;
                      border: 0;
                      box-shadow: none;
                    }

                    .otg-v36bl3-range::-moz-range-progress {
                      background: transparent;
                      border: 0;
                    }

                    .otg-v36bl3-range::-moz-range-thumb {
                      pointer-events: auto;
                      width: 32px;
                      height: 80px;
                      background: transparent;
                      border: 0;
                      border-radius: 0;
                      box-shadow: none;
                      cursor: ew-resize;
                    }
                  `}</style>

                  <div data-otg-v36bl3-trim-rail="true" className="mt-5">
                    {(() => {
                      const safeDurationV36BL3 = Math.max(0.1, Number(durationSec || 0.1));
                      const trimStartV36BL3 = Math.max(
                        0,
                        Math.min(safeDurationV36BL3, Number(draft.trimStartSeconds || 0)),
                      );
                      const trimEndV36BL3 = Math.max(
                        trimStartV36BL3 + 0.1,
                        Math.min(safeDurationV36BL3, Number(draft.trimEndSeconds || safeDurationV36BL3)),
                      );
                      const leftPercentV36BL3 = Math.max(
                        0,
                        Math.min(100, (trimStartV36BL3 / safeDurationV36BL3) * 100),
                      );
                      const rightPercentV36BL3 = Math.max(
                        0,
                        Math.min(100, (trimEndV36BL3 / safeDurationV36BL3) * 100),
                      );
                      const activeWidthV36BL3 = Math.max(0, rightPercentV36BL3 - leftPercentV36BL3);

                      return (
                        <div className="rounded-[16px] border border-white/10 bg-black/25 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Trim Range</p>
                            <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-black text-cyan-100">
                              {trimStartV36BL3.toFixed(1)}s to {trimEndV36BL3.toFixed(1)}s
                            </span>
                          </div>

                          <div className="otg-v36bl3-trimSlider relative mt-8 h-20 overflow-visible">
                            <div className="absolute left-0 right-0 top-1/2 h-3 -translate-y-1/2 rounded-full border border-cyan-100/25 bg-cyan-200/20 shadow-[inset_0_0_12px_rgba(255,255,255,0.10),0_0_18px_rgba(103,232,249,0.16)]" />
                            <div
                              className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full border border-cyan-100/80 bg-cyan-300/90 shadow-[0_0_24px_rgba(103,232,249,0.50)]"
                              style={{
                                left: `${leftPercentV36BL3}%`,
                                width: `${activeWidthV36BL3}%`,
                              }}
                            />
                            <div
                              className="absolute top-0 -translate-x-1/2 rounded-full border border-white/10 bg-slate-950 px-2 py-1 text-[10px] font-black text-white"
                              style={{ left: `${leftPercentV36BL3}%` }}
                            >
                              {trimStartV36BL3.toFixed(1)}s
                            </div>
                            <div
                              className="absolute top-0 -translate-x-1/2 rounded-full border border-white/10 bg-slate-950 px-2 py-1 text-[10px] font-black text-white"
                              style={{ left: `${rightPercentV36BL3}%` }}
                            >
                              {trimEndV36BL3.toFixed(1)}s
                            </div>
                            {/* OTG_V36BL3_VISUAL_BALLPOINTS */}
                            <div
                              aria-hidden="true"
                              className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-cyan-50 bg-cyan-300 shadow-[0_0_0_2px_rgba(15,23,42,0.95),0_0_18px_rgba(103,232,249,0.90),0_0_34px_rgba(103,232,249,0.35)]"
                              style={{ left: `clamp(10px, ${leftPercentV36BL3}%, calc(100% - 10px))` }}
                            />
                            <div
                              aria-hidden="true"
                              className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-cyan-50 bg-cyan-300 shadow-[0_0_0_2px_rgba(15,23,42,0.95),0_0_18px_rgba(103,232,249,0.90),0_0_34px_rgba(103,232,249,0.35)]"
                              style={{ left: `clamp(10px, ${rightPercentV36BL3}%, calc(100% - 10px))` }}
                            />

                            <input
                              aria-label="Trim start seconds"
                              type="range"
                              min={0}
                              max={safeDurationV36BL3}
                              step={0.1}
                              value={trimStartV36BL3}
                              onChange={(event) => {
                                const nextStart = Number(event.target.value);
                                const range = clampEditRange(nextStart, trimEndV36BL3, safeDurationV36BL3);
                                updateEditDraft(activeKey, durationSec, {
                                  trimStartSeconds: range.start,
                                  trimEndSeconds: range.end,
                                  status: "draft",
                                });
                              }}
                              className="otg-v36bl3-range absolute inset-0 h-20 w-full"
                            />
                            <input
                              aria-label="Trim end seconds"
                              type="range"
                              min={0}
                              max={safeDurationV36BL3}
                              step={0.1}
                              value={trimEndV36BL3}
                              onChange={(event) => {
                                const nextEnd = Number(event.target.value);
                                const range = clampEditRange(trimStartV36BL3, nextEnd, safeDurationV36BL3);
                                updateEditDraft(activeKey, durationSec, {
                                  trimStartSeconds: range.start,
                                  trimEndSeconds: range.end,
                                  status: "draft",
                                });
                              }}
                              className="otg-v36bl3-range absolute inset-0 h-20 w-full"
                            />

                            <div className="absolute bottom-0 left-0 text-[10px] font-black text-white/45">0s</div>
                            <div className="absolute bottom-0 right-0 text-[10px] font-black text-white/45">
                              {safeDurationV36BL3.toFixed(1)}s
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[14px] border border-white/10 bg-black/25 px-3 py-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/35">Start seconds</p>
                      <p className="mt-1 text-lg font-black text-white">{Number(draft.trimStartSeconds || 0).toFixed(1)}s</p>
                    </div>
                    <div className="rounded-[14px] border border-white/10 bg-black/25 px-3 py-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/35">End seconds</p>
                      <p className="mt-1 text-lg font-black text-white">{Number(draft.trimEndSeconds || durationSec || 0).toFixed(1)}s</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!activeKey || Boolean(renderingEditClipKey) || editRenderBlockedByTiming}
                      onClick={() => renderTrimOnlyEditClip(activeKey, durationSec)}
                      className="rounded-[12px] border border-emerald-300/30 bg-emerald-300/10 px-4 py-3 text-sm font-black text-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {renderingEditClipKey === activeKey ? "Cutting..." : "Cut"}
                    </button>
                    <button
                      type="button"
                      disabled={!activeKey || Boolean(renderingEditClipKey)}
                      onClick={() => restoreSelectedEditClipOriginal(activeKey, durationSec)}
                      className="rounded-[12px] border border-white/10 bg-white/3 px-4 py-3 text-sm font-black text-white/75 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      disabled={!activeKey || Boolean(renderingVisualFxClipKey) || Boolean(renderingEditClipKey)}
                      onClick={() => saveActiveProductionEditClip(activeKey, durationSec)}
                      className="rounded-[12px] bg-violet-500/20 px-4 py-3 text-sm font-black text-violet-200 transition hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Save
                    </button>
                  </div>

                  {draft.error ? (
                    <div className="mt-3 rounded-[12px] border border-rose-300/25 bg-rose-300/10 px-3 py-2 text-xs font-bold text-rose-100">
                      {draft.error}
                    </div>
                  ) : null}
                </div>

                <div data-otg-v36bl2-card="edit-video" className="rounded-[18px] border border-white/10 bg-white/[0.04] p-6">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Edit Video</p>
                    <p className="mt-2 text-sm leading-6 text-white/35">
                      Type the visual change you want for this clip. Keep the edit specific.
                    </p>
                  </div>

                  <textarea
                    id="otg-production-edit-prompt-v36bl2"
                    data-otg-v36bl2-edit-prompt="true"
                    placeholder="Example: remove the glowing artifact near the character's left hand. Keep the same character, outfit, camera, lighting, and background."
                    className="mt-4 min-h-[120px] w-full rounded-[14px] border border-white/10 bg-black/30 px-3 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/30 focus:border-cyan-300/30"
                  />

                  <div className="mt-4 rounded-[14px] border border-white/10 bg-black/20 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100/75">Edit Guidelines</p>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-white/38">
                      <li>Say exactly what to add, remove, replace, restyle, or fix.</li>
                      <li>Keep identity stable unless the change is intentional.</li>
                      <li>Use one clear edit at a time for better results.</li>
                      <li>Good: "remove the floating artifact near the left hand." Bad: "make it better."</li>
                    </ul>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!activeKey || Boolean(renderingVisualFxClipKey) || Boolean(renderingEditClipKey)}
                      onClick={() => renderLtxEditAnythingClip(activeKey, durationSec)}
                      className="rounded-[12px] border border-emerald-300/30 bg-emerald-300/10 px-4 py-3 text-sm font-black text-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {renderingVisualFxClipKey === activeKey ? "Editing..." : "Submit Edit"}
                    </button>
                    <button
                      type="button"
                      disabled={!activeKey}
                      onClick={() => {
                        const field = document.getElementById("otg-production-edit-prompt-v36bl2") as HTMLTextAreaElement | null;
                        if (field) field.value = "";
                        updateEditDraft(activeKey, durationSec, {
                          visualEditPromptV36BL2: "",
                          visualFixPrompt: "",
                          visualFixEnabled: false,
                          editedUrl: "",
                          editedFileName: "",
                          error: "",
                          status: "draft",
                        } as any);
                      }}
                      className="rounded-[12px] border border-white/10 bg-white/3 px-4 py-3 text-sm font-black text-white/75 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      disabled={!activeKey || Boolean(renderingVisualFxClipKey) || Boolean(renderingEditClipKey)}
                      onClick={() => saveActiveProductionEditClip(activeKey, durationSec)}
                      className="rounded-[12px] bg-violet-500/20 px-4 py-3 text-sm font-black text-violet-200 transition hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Save
                    </button>
                  </div>
                </div>
<div data-otg-v36bl2-hidden="Visual Fix" data-otg-v36bl2-marker="OTG_PRODUCTION_EDIT_TWO_CUE_CARDS_V36BL2" className="hidden rounded-[18px] border border-white/10 bg-white/[0.04] p-6">
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Visual Fix</p>
                  <label className="mt-4 flex items-center gap-3 text-sm font-bold text-white/75">
                    <input type="checkbox" checked={Boolean(visualRange.prompt)} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "visualFxRanges", event.target.checked ? [visualRange] : [{ ...visualRange, prompt: "" }])} />
                    Enable visual edit range
                  </label>
                  <div className="mt-3">
                    {renderEditRangeSlider({
                      label: "Video effect range",
                      start: visualRange.startSeconds,
                      end: visualRange.endSeconds,
                      durationSec,
                      onChange: (range) => updateEditDraftNested(activeKey, durationSec, "visualFxRanges", [
                        {
                          ...visualRange,
                          startSeconds: range.start,
                          endSeconds: range.end,
                        },
                      ]),
                    })}
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <input type="number" min={0} max={durationSec} step={0.1} value={visualRange.startSeconds} onChange={(event) => {
                      const next = clampEditRange(Number(event.target.value), visualRange.endSeconds, durationSec);
                      updateEditDraftNested(activeKey, durationSec, "visualFxRanges", [{ ...visualRange, startSeconds: next.start, endSeconds: next.end }]);
                    }} className="rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none" />
                    <input type="number" min={0} max={durationSec} step={0.1} value={visualRange.endSeconds} onChange={(event) => {
                      const next = clampEditRange(visualRange.startSeconds, Number(event.target.value), durationSec);
                      updateEditDraftNested(activeKey, durationSec, "visualFxRanges", [{ ...visualRange, startSeconds: next.start, endSeconds: next.end }]);
                    }} className="rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none" />
                  </div>
                  <label className="mt-3 block">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Strength</span>
                    <input type="number" min={0} max={1} step={0.05} value={visualRange.strength} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "visualFxRanges", [{ ...visualRange, strength: Math.max(0, Math.min(1, Number(event.target.value) || 0.5)) }])} className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none" />
                  </label>
                  <textarea value={visualRange.prompt} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "visualFxRanges", [{ ...visualRange, prompt: event.target.value }])} rows={4} placeholder="Describe the object, artifact, background, or visual change to fix in this time range." className="mt-3 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/35" />
                  <button
                    type="button"
                    disabled={!activeKey || Boolean(renderingVisualFxClipKey) || !visualRange.prompt.trim()}
                    onClick={() => renderVisualFxEditClip(activeKey, durationSec)}
                    className="mt-3 w-full rounded-[12px] border border-fuchsia-300/30 bg-fuchsia-300/10 px-4 py-3 text-sm font-black text-fuchsia-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {renderingVisualFxClipKey === activeKey ? "Rendering Visual FX..." : "Render Visual FX"}
                  </button>
                </div>
              </div>

              <details data-otg-v36bl2-hidden="Edit Manifest Preview" data-otg-v36bl2-marker="OTG_PRODUCTION_EDIT_TWO_CUE_CARDS_V36BL2" className="hidden rounded-[18px] border border-white/10 bg-white/[0.04] p-6">
                <summary className="cursor-pointer text-sm font-black uppercase tracking-[0.18em] text-white/35">Edit Manifest Preview</summary>
                <pre className="mt-3 max-h-80 overflow-auto rounded-[14px] bg-black/40 p-4 text-xs leading-5 text-cyan-50/80">{JSON.stringify(draft, null, 2)}</pre>
              </details>
            </div>
          </div>
        )}
      </section>
    );
  }

  // OTG_AUDIO_STUDIO_REAL_SONY_WOOSH_SFX_V36BPW11B
  async function startAudioStudioSonyWooshSfx(
    row: ProductionEditClipRow | null | undefined,
    clipKey: string,
    clipDurationSec: number,
    sfxMode: "auto" | "manual" = "auto",
    manualPrompt = ""
  ) {
    const normalizedClipId = String(clipKey || "").trim();
    if (!normalizedClipId || !row) {
      setNotice("Select a clip before rendering Sony Woosh SFX.");
      return;
    }

    const sourceUrl = String(
      (row.clip as any)?.url ||
      row.sourceUrl ||
      ""
    ).trim();
    const sourceFileName = String(
      (row.clip as any)?.fileName ||
      row.sourceFileName ||
      (sourceUrl ? fileNameFromUrl(sourceUrl) : "") ||
      ""
    ).trim();

    if (!sourceFileName) {
      setNotice("Sony Woosh SFX needs a saved gallery/source filename for the selected clip.");
      return;
    }

    const safeDurationSec = Math.max(1, Math.min(8, Number(clipDurationSec || row.durationSec || selectedScene?.durationSeconds || 8) || 8));
    const selectedSonyWooshMode = sfxMode === "manual" ? "manual" : "auto";
    const autoSonyWooshPrompt = "Automatically analyze the video motion and timing, then add polished Sony-style cinematic woosh, swish, pass-by, impact, and transition sound effects synchronized to visible movement. Clean trailer SFX, no dialogue, no music, no narration.";
    const manualSonyWooshPrompt = String(manualPrompt || "").trim();
    if (selectedSonyWooshMode === "manual" && !manualSonyWooshPrompt) {
      setNotice("Enter a manual Sony Woosh sound-effects prompt first.");
      return;
    }
    const prompt = selectedSonyWooshMode === "manual" ? manualSonyWooshPrompt : autoSonyWooshPrompt;
    const title = `${selectedScene?.title || "Scene"} ${row.title || "Clip"} ${selectedSonyWooshMode === "manual" ? "Manual SFX" : "Auto Sony Woosh SFX"}`
      .replace(/[^a-zA-Z0-9_. -]+/g, "_")
      .replace(/\s+/g, " ")
      .trim();

    const form = new FormData();

    // Prefer upload mode when the current preview URL is readable. This avoids Gallery video not found
    // when Audio Studio is using a /api/file preview rather than a saved Gallery item.
    let usedUploadSource = false;
    if (sourceUrl) {
      try {
        const sourceResponse = await fetch(sourceUrl, {
          cache: "no-store",
          credentials: "include",
        });
        if (sourceResponse.ok) {
          const sourceBlob = await sourceResponse.blob();
          if (sourceBlob.size > 0) {
            const uploadName = sourceFileName || fileNameFromUrl(sourceUrl) || "sony_woosh_source.mp4";
            form.append("video_source", "upload");
            form.append("video_file", sourceBlob, uploadName);
            usedUploadSource = true;
          }
        }
      } catch {
        usedUploadSource = false;
      }
    }

    if (!usedUploadSource) {
      form.append("video_source", "gallery");
      form.append("video_name", sourceFileName);
      const scope = galleryScopeFromUrl(sourceUrl);
      if (scope) form.append("video_scope", scope);
    }

    form.append("video_title", title || "sony_woosh_sfx");
    form.append("title", title || "sony_woosh_sfx");
    form.append("prompt", prompt);
    form.append("sfxMode", selectedSonyWooshMode);
    form.append("model", "vflow");
    form.append("durationSeconds", String(safeDurationSec));
    form.append("keepOriginalAudio", "1");
    form.append("originalVolume", "1");
    form.append("sfxVolume", "0.85");

    setAudioStudioSonyWooshBusy(true);
    setAudioStudioSonyWooshError("");
    setNotice("Rendering Sony Woosh SFX with the existing Edit Video Woosh workflow...");

    try {
      const response = await fetch("/api/edit-video/woosh-sfx", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error || "Sony Woosh SFX render failed."));
      }

      let outputUrl = String(data.url || "");
      let outputFileName = String(data.fileName || data.name || "");
      let savedResponseJson: any = null;

      if (data.jobId && data.fileName) {
        const saveResponse = await fetch("/api/edit-video/woosh-save", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: data.jobId,
            fileName: data.fileName,
            title,
            videoName: sourceFileName,
            prompt,
            sfxMode: selectedSonyWooshMode,
            model: data.model || "vflow",
            keepOriginalAudio: data.keepOriginalAudio !== false,
            originalVolume: Number(data.originalVolume ?? 1),
            sfxVolume: Number(data.sfxVolume ?? 0.85),
            durationSeconds: Number(data.durationSeconds || safeDurationSec) || null,
            sizeBytes: Number(data.sizeBytes || 0) || undefined,
          }),
        });
        savedResponseJson = await saveResponse.json().catch(() => null);
        if (saveResponse.ok && savedResponseJson?.ok) {
          outputUrl = String(savedResponseJson.url || outputUrl);
          outputFileName = String(savedResponseJson.fileName || savedResponseJson.name || outputFileName);
        }
      }

      setAudioDubPreviewResult({
        ok: true,
        kind: "sony_woosh_sfx",
        jobId: data.jobId,
        promptId: data.promptId,
        previewVideoUrl: outputUrl,
        previewVideoPath: outputFileName || outputUrl,
        previewVideoFileName: outputFileName,
        sourceVideoName: sourceFileName,
        prompt,
        sfxMode: selectedSonyWooshMode,
        model: data.model || "vflow",
        saved: Boolean(savedResponseJson?.ok),
        raw: data,
      });

      setNotice(
        outputUrl
          ? `Sony Woosh SFX rendered for ${row.title || "selected clip"}. Preview updated${savedResponseJson?.ok ? " and saved to Gallery." : "."}`
          : "Sony Woosh SFX rendered, but no preview URL was returned."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sony Woosh SFX render failed.";
      setAudioStudioSonyWooshError(message);
      setNotice(message);
    } finally {
      setAudioStudioSonyWooshBusy(false);
    }
  }
  async function queueProductionAudioStudioAction(
    action: ProductionAudioStudioAction,
    clipId: string,
    extraInput: Record<string, unknown> = {}
  ) {
    const normalizedClipId = String(clipId || "").trim();
    if (!normalizedClipId) {
      setAudioStudioJobs((previous) => ({
        ...previous,
        [action]: {
          phase: "error",
          error: "Select a clip before queueing an Audio Studio job.",
        },
      }));
      setNotice("Select a clip before queueing an Audio Studio job.");
      return;
    }

    setAudioStudioJobs((previous) => ({
      ...previous,
      [action]: { phase: "submitting" },
    }));
    setNotice("Submitting Audio Studio queued job...");

    try {
      const job = await queueAudioStudioJob({
        action,
        clipId: normalizedClipId,
        characterId: selectedScene?.id || null,
        sceneId: selectedScene?.id || "",
        sceneTitle: selectedScene?.title || "",
        ...extraInput,
      });
      setAudioStudioJobs((previous) => ({
        ...previous,
        [action]: { phase: "queued", job },
      }));
      setNotice(`Queued job: ${job.jobId}. Backend worker not connected yet.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not queue Audio Studio job.";
      setAudioStudioJobs((previous) => ({
        ...previous,
        [action]: { phase: "error", error: message },
      }));
      setNotice(message);
    }
  }

  async function persistAudioStudioResultToServer(
    clipId: string,
    audioStudioResult: ProductionAudioStudioResult,
    jobId: string
  ) {
    try {
      const response = await fetch("/api/production/audio-studio/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          clipId,
          audioStudioResult,
        }),
      });
      const json = await response.json().catch(() => null) as {
        item?: ProductionAudioStudioResultItem;
        items?: ProductionAudioStudioResultItem[];
        error?: string;
      } | null;

      if (!response.ok || !json?.item) {
        throw new Error(json?.error || "Could not save Audio Studio result to clip record.");
      }

      setAudioStudioPersistedResults((previous) => {
        const next = { ...previous };
        for (const item of json.items || [json.item]) {
          if (item?.clipId && item.audioStudioResult?.status === "mock_ready") {
            next[item.clipId] = item;
          }
        }
        return next;
      });
      setNotice(`Mock Audio Studio result saved to clip record. Source job: ${jobId}.`);
    } catch (error) {
      setNotice(
        `${error instanceof Error ? error.message : "Could not save Audio Studio result to clip record."} Retained locally only. Source job: ${jobId}.`
      );
    }
  }

  function audioStudioResultFromJob(job: QueuedContractJob): ProductionAudioStudioResult | null {
    if (job.jobType !== "production_audio_studio" || job.status !== "completed") return null;
    const mockResult =
      job.result && typeof job.result === "object" && !Array.isArray(job.result)
        ? job.result as Record<string, unknown>
        : {};
    const updatedClipUrl = typeof mockResult.updatedClipUrl === "string" ? mockResult.updatedClipUrl : undefined;
    const dubbedClipUrl = typeof mockResult.dubbedClipUrl === "string" ? mockResult.dubbedClipUrl : undefined;
    const finalClipUrl = typeof mockResult.finalClipUrl === "string" ? mockResult.finalClipUrl : undefined;

    return {
      status: "mock_ready",
      action: job.action as ProductionAudioStudioAction,
      sourceJobId: job.jobId,
      updatedClipUrl,
      dubbedClipUrl,
      finalClipUrl,
      mockResult,
      updatedAt: new Date().toISOString(),
    };
  }

  function renderAudioStudioJobStatus(action: ProductionAudioStudioAction) {
    const state = audioStudioJobs[action];
    if (!state || state.phase === "idle") return null;

    if (state.phase === "submitting") {
      return <p className="mt-3 text-xs font-bold text-cyan-100">Submitting...</p>;
    }

    if (state.phase === "error") {
      return <p className="mt-3 text-xs font-bold text-rose-200">{state.error || "Audio Studio job failed."}</p>;
    }

    const job = state.job;
    const resultEntries =
      job?.result && typeof job.result === "object" && !Array.isArray(job.result)
        ? Object.entries(job.result as Record<string, unknown>)
        : [];
    const completed = job?.status === "completed";

    return (
      <div className="mt-3 rounded-[12px] border border-white/10 bg-black/20 p-3 text-xs leading-5 text-white/65">
        <p className="font-black text-white">Queued job: {job?.jobId || "pending"}</p>
        <p>Status: {job?.status || state.phase}</p>
        {typeof job?.progress === "number" ? <p>Progress: {job.progress}%</p> : null}
        {job?.message ? <p>Message: {job.message}</p> : null}

        {completed ? (
          <div className="mt-3 rounded-[10px] border border-emerald-300/25 bg-emerald-300/10 p-3 text-emerald-100">
            <p className="font-black">Mock Audio Studio result ready</p>
            <p className="mt-1 text-emerald-100/75">Mock result - backend adapter not connected yet.</p>
            {resultEntries.length ? (
              <div className="mt-2 space-y-1">
                {resultEntries.map(([key, value]) => (
                  <p key={key} className="break-all">
                    <span className="font-black">{key}:</span> {String(value)}
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-emerald-100/70">No mock artifact URL returned.</p>
            )}
          </div>
        ) : (
          <p>Backend worker not connected yet.</p>
        )}
      </div>
    );
  }

  // OTG_AUDIO_STUDIO_ANALYZE_CLIP_AUDIO_V1_START
  async function analyzeClipAudioForDubbing(clip: any, clipIndex: number) {
    if (!selectedScene) {
      setNotice("Select a scene before analyzing clip audio.");
      return;
    }

    if (!clip) {
      setNotice("No saved clip was found for Audio Studio. Save or sync a clip first.");
      return;
    }

    const sourceUrl = String(clip.url || clip.editedUrl || "").trim();
    const sourceFileName = String(
      clip.fileName ||
      clip.editedFileName ||
      (sourceUrl ? fileNameFromUrl(sourceUrl) : "") ||
      ""
    ).trim();

    if (!sourceUrl && !sourceFileName) {
      setNotice("The selected clip does not have a usable video source.");
      return;
    }

    setAudioClipAnalysisBusy(true);
    setAudioClipAnalysisResult(null);
    setAudioClipVoiceCharacterMap({});
    setAudioDubPreviewResult(null);
    setAudioDubPreviewError("");
    setNotice(`Analyzing audio for Clip ${clipIndex + 1}...`);

    try {
      const response = await fetch("/api/production/audio/analyze-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "include",
        body: JSON.stringify({
          sceneId: selectedScene.id,
          sceneTitle: selectedScene.title,
          clipIndex,
          sourceUrl,
          sourceFileName,
          expectedSpeakerCount: audioExpectedSpeakerCount || undefined,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || "Analyze Clip Audio failed.");
      }

      setAudioClipAnalysisResult(data);

      const voiceCount = Array.isArray(data.voices) ? data.voices.length : 0;
      setAudioClipVoiceCharacterMap(
        Array.isArray(data.voices)
          ? Object.fromEntries(data.voices.map((voice: any, index: number) => [String(voice.id || `speaker_${index + 1}`), ""]))
          : {}
      );
      setNotice(
        voiceCount
          ? `Analyze Clip Audio complete. Detected ${voiceCount} voice lane${voiceCount === 1 ? "" : "s"}.`
          : "Analyze Clip Audio complete, but no clear dialogue was detected."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analyze Clip Audio failed.";
      setNotice(message);
      setAudioClipAnalysisResult({
        ok: false,
        error: message,
        voices: [],
      });
      setAudioClipVoiceCharacterMap({});
    } finally {
      setAudioClipAnalysisBusy(false);
    }
  }
  // OTG_AUDIO_STUDIO_ANALYZE_CLIP_AUDIO_V1_END

  async function startAudioStudioDubPreview(
    clip: { url?: string; fileName?: string; editedUrl?: string; editedFileName?: string } | null,
    clipIndex: number,
    voiceOptions: ProductionVoiceModelOption[],
  ) {
    if (!selectedScene || !clip) {
      setNotice("Select a saved clip before starting voice dub.");
      return;
    }

    // OTG_AUDIO_STUDIO_SEGMENT_FIRST_DUB_V36BPW5
    const detectedVoices = Array.isArray(audioClipAnalysisResult?.voices) ? audioClipAnalysisResult.voices : [];
    const selectedVoiceMappings = Object.entries(audioClipVoiceCharacterMap)
      .filter(([, characterId]) => String(characterId || "").trim())
      .map(([voiceId, characterId]) => {
        const selectedVoice = voiceOptions.find((option) => (
          option.engine === "character" &&
          (option.characterId === characterId || option.id === characterId)
        ));
        const detectedVoice = detectedVoices.find((voice: any, index: number) => (
          String(voice?.id || voice?.voiceId || voice?.speakerId || `speaker_${index + 1}`) === voiceId
        ));
        const segments = (Array.isArray(detectedVoice?.segments) ? detectedVoice.segments : [])
          .map((segment: any) => {
            const start = Number(segment?.start ?? segment?.startSeconds ?? segment?.from ?? segment?.begin);
            const end = Number(segment?.end ?? segment?.endSeconds ?? segment?.to ?? segment?.stop);
            return Number.isFinite(start) && Number.isFinite(end) && end > start
              ? { start, end }
              : null;
          })
          .filter(Boolean);
        return {
          voiceId,
          characterId,
          voiceModelId: selectedVoice?.id || "",
          voicePath: selectedVoice?.path || "",
          voiceName: selectedVoice?.name || String(characterId || ""),
          segments,
        };
      });
    if (!selectedVoiceMappings.length) {
      setNotice("Analyze the clip and map at least one detected voice to a character voice model before starting dub.");
      return;
    }

    const missingVoiceMapping = selectedVoiceMappings.find((mapping) => !mapping.voicePath);
    if (missingVoiceMapping) {
      setNotice(`Detected ${missingVoiceMapping.voiceId} is mapped to a character without a usable Characters-tab voice model.`);
      return;
    }

    const missingSegmentMapping = selectedVoiceMappings.find((mapping) => !Array.isArray(mapping.segments) || !mapping.segments.length);
    if (selectedVoiceMappings.length > 1 && missingSegmentMapping) {
      setNotice(`Detected ${missingSegmentMapping.voiceId} has no usable diarization segments. Re-analyze the clip before starting multi-voice dub.`);
      return;
    }

    const sourceUrl = String(clip.url || clip.editedUrl || "").trim();
    const sourceFileName = String(clip.fileName || clip.editedFileName || (sourceUrl ? fileNameFromUrl(sourceUrl) : "") || "").trim();
    if (!sourceUrl && !sourceFileName) {
      setNotice("The selected clip does not have a usable video source for voice dub.");
      return;
    }

    setAudioDubPreviewBusy(true);
    setAudioDubPreviewResult(null);
    setAudioDubPreviewError("");
    setNotice(`Starting voice dub preview for Clip ${clipIndex + 1}...`);

    try {
      const response = await fetch("/api/production/audio/dub-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "include",
        body: JSON.stringify({
          sceneId: selectedScene.id,
          sceneTitle: selectedScene.title,
          clipIndex,
          sourceUrl,
          sourceFileName,
          voicePath: selectedVoiceMappings[0]?.voicePath || "",
          voiceModelId: selectedVoiceMappings[0]?.voiceModelId || "",
          characterId: selectedVoiceMappings[0]?.characterId || "",
          mappedVoiceId: selectedVoiceMappings[0]?.voiceId || "",
          voiceMappings: selectedVoiceMappings,
          audioClipAnalysis: audioClipAnalysisResult,
          voiceCharacterMap: audioClipVoiceCharacterMap,
          title: `Scene ${clipIndex + 1} voice dub preview`,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || "Voice dub preview failed.");
      }

      setAudioDubPreviewResult(data);
      setNotice("Voice dub preview ready. Play the preview video and approve or adjust the mapping.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Voice dub preview failed.";
      setAudioDubPreviewError(message);
      setNotice(message);
    } finally {
      setAudioDubPreviewBusy(false);
    }
  }



  function renderAudioStudioStage() {
    const scene = selectedScene;
    const rows = editClipRows(scene);
    const activeKey =
      selectedEditClipKey && rows.some((row) => row.key === selectedEditClipKey)
        ? selectedEditClipKey
        : rows[0]?.key || "";
    const activeRow = rows.find((row) => row.key === activeKey) || rows[0] || null;
    const voiceModelOptions = productionVoiceOptionsForScene(scene);
    const characterVoiceModelOptions = voiceModelOptions.filter((option) => option.engine === "character" && option.usable);

    if (!scene) {
      return (
        <section className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5 text-white">
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/80">Audio Studio</p>
          <h2 className="mt-2 text-2xl font-black">Dub and Add Voices</h2>
          <p className="mt-2 text-sm text-white/65">Select a scene before planning audio jobs.</p>
        </section>
      );
    }

    return (
      <section className="space-y-4">
        <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/80">Audio Studio</p>
              <h2 className="mt-2 text-2xl font-black text-white">Dub and Add Voices</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">
                Plan audio jobs after Visual Edit: dub an existing performance into a saved character voice, or add a new off-screen voice to the clip mix.
              </p>
            </div>
            <div className="rounded-[14px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/70">
              <div className="font-black text-white">{scene.title}</div>
              <div>Clips found: {rows.length}</div>
              <div>Character voice models: {characterVoiceModelOptions.length}</div>
              <div>Status: queued job skeleton</div>
            </div>
          </div>
        </div>

        {!rows.length ? (
          <div className="rounded-[18px] border border-amber-300/25 bg-amber-300/10 p-5 text-sm text-amber-100">
            Generate or add a clip in Animate / Visual Edit before creating Audio Studio jobs.
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="space-y-3 rounded-[18px] border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Clip</p>
              {rows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => setSelectedEditClipKey(row.key)}
                  className={classNames(
                    "w-full rounded-[14px] border p-3 text-left transition",
                    row.key === activeKey ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-50" : "border-white/10 bg-black/20 text-white/70 hover:bg-white/[0.06]",
                  )}
                >
                  <span className="block text-sm font-black">Clip {row.index + 1}</span>
                  <span className="mt-1 block truncate text-xs text-white/45">{row.sourceFileName || "No filename"}</span>
                  {row.clip.audioStudioResult ? (
                    <span className="mt-2 inline-flex rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-1 text-[11px] font-black text-emerald-100">
                      Audio mock ready
                    </span>
                  ) : null}
                </button>
              ))}
            </aside>

            <div className="space-y-5">
              <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Preview</p>
                {activeRow?.sourceUrl ? (
                  <video key={activeRow.sourceUrl} controls className="mt-3 aspect-video w-full rounded-[14px] bg-black object-contain">
                    <source src={activeRow.sourceUrl} />
                  </video>
                ) : (
                  <div className="mt-3 grid aspect-video place-items-center rounded-[14px] border border-dashed border-white/15 bg-black/25 text-sm text-white/45">
                    No clip preview available.
                  </div>
                )}
              </div>

              {activeRow?.clip.audioStudioResult ? (
                <div className="rounded-[18px] border border-emerald-300/25 bg-emerald-300/10 p-4 text-sm text-emerald-100">
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-100/70">Stored Audio Studio Result</p>
                  <div className="mt-3 grid gap-1 text-xs leading-5">
                    <div>Status: {activeRow.clip.audioStudioResult.status}</div>
                    <div>Action: {activeRow.clip.audioStudioResult.action}</div>
                    <div className="break-all">Source job: {activeRow.clip.audioStudioResult.sourceJobId}</div>
                    {activeRow.clip.audioStudioResult.updatedClipUrl ? <div className="break-all">updatedClipUrl: {activeRow.clip.audioStudioResult.updatedClipUrl}</div> : null}
                    {activeRow.clip.audioStudioResult.dubbedClipUrl ? <div className="break-all">dubbedClipUrl: {activeRow.clip.audioStudioResult.dubbedClipUrl}</div> : null}
                    {activeRow.clip.audioStudioResult.finalClipUrl ? <div className="break-all">finalClipUrl: {activeRow.clip.audioStudioResult.finalClipUrl}</div> : null}
                    <div>
                      {audioStudioPersistedResults[activeRow.key]?.audioStudioResult?.sourceJobId === activeRow.clip.audioStudioResult.sourceJobId
                        ? "Saved to clip record."
                        : "Retained locally only until the clip record save completes."}
                    </div>
                    <div>Mock result - backend adapter not connected yet.</div>
                  </div>
                </div>
              ) : null}

                              {/* OTG_AUDIO_STUDIO_VOICE_DUBBING_UI_V2_START */}
                {(() => {
                  const sceneAny = (selectedScene || {}) as any;

                  // OTG_AUDIO_STUDIO_ANALYZE_ACTIVE_CLIP_V1
                  const activeAudioStudioClipAny = (activeRow?.clip || {}) as any;
                  const activeAudioStudioClip = activeRow
                    ? {
                        ...activeAudioStudioClipAny,
                        url: activeRow.sourceUrl || activeAudioStudioClipAny.url || "",
                        fileName: activeRow.sourceFileName || activeAudioStudioClipAny.fileName || "",
                        editedUrl: activeAudioStudioClipAny.editedUrl || "",
                        editedFileName: activeAudioStudioClipAny.editedFileName || "",
                      }
                    : null;
                  const activeAudioStudioClipIndex = activeRow?.index ?? 0;


                  const rawCharacterGroups = [
                    sceneAny.characters,
                    sceneAny.characterCards,
                    sceneAny.checkedCharacters,
                    sceneAny.selectedCharacters,
                    sceneAny.productionCharacters,
                    sceneAny.clipCharacters,
                    sceneAny.cast,
                    sceneAny.sceneCharacters,
                  ];

                  const seenDubCharacterIds = new Set<string>();

                  const sceneCharacterDubCharacters = rawCharacterGroups
                    .flatMap((group: any) => Array.isArray(group) ? group : [])
                    .filter((character: any) => character && typeof character === "object")
                    .filter((character: any) => {
                      const roleText = String(character.role || character.type || character.kind || character.category || "").toLowerCase();
                      if (roleText.includes("background") || roleText.includes("environment") || character.isBackground) return false;
                      if (character.checked === false || character.selected === false || character.enabled === false) return false;
                      return true;
                    })
                    .map((character: any, index: number) => {
                      const id = String(character.id || character.cardId || character.name || character.title || `character_${index}`);
                      const name = String(character.name || character.title || character.label || `Character ${index + 1}`).trim();
                      const voiceModel =
                        character.savedVoiceModelId ||
                        character.voiceModelId ||
                        character.applioModelId ||
                        character.voiceModelPath ||
                        character.applioModelPath ||
                        character.voice?.modelId ||
                        character.voice?.modelPath ||
                        character.voiceModel?.id ||
                        character.voiceModel?.path ||
                        "";

                      return {
                        id,
                        name,
                        role: String(character.role || character.type || character.kind || "Character"),
                        voiceModel: String(voiceModel || ""),
                      };
                    });

                  const voiceModelDubCharacters = characterVoiceModelOptions.map((option: ProductionVoiceModelOption, index: number) => ({
                    id: String(option.characterId || option.id || `voice_model_${index + 1}`),
                    name: String(option.name || `Character Voice ${index + 1}`),
                    role: option.engine === "uploaded" ? "Uploaded voice model" : "Character voice model",
                    voiceModel: String(option.path || option.displayPath || option.id || ""),
                  }));

                  const checkedDubCharacters = [...sceneCharacterDubCharacters, ...voiceModelDubCharacters]
                    .filter((character: any) => {
                      if (seenDubCharacterIds.has(character.id)) return false;
                      seenDubCharacterIds.add(character.id);
                      return true;
                    });

                  const analyzedVoiceRows = Array.isArray(audioClipAnalysisResult?.voices)
                    ? audioClipAnalysisResult.voices
                    : [];

                  const detectedVoiceRows = analyzedVoiceRows.length
                    ? analyzedVoiceRows.map((voice: any, index: number) => ({
                        id: String(voice.id || `speaker_${index + 1}`),
                        label: String(voice.label || `Voice ${index + 1}`),
                        description: String(
                          voice.description ||
                          `${voice.segmentCount || voice.segments?.length || 0} detected segment(s), ${Number(voice.totalSpeechSeconds || 0).toFixed(1)}s speech`
                        ),
                        status: String(voice.status || "detected"),
                        segmentCount: Number(voice.segmentCount || voice.segments?.length || 0),
                        totalSpeechSeconds: Number(voice.totalSpeechSeconds || 0),
                      }))
                    : Array.from({ length: 3 }, (_unused, index) => ({
                        id: `speaker_${index + 1}`,
                        label: `Voice ${index + 1}`,
                        description: index === 0 ? "Primary detected dialogue speaker" : `Detected dialogue speaker ${index + 1}`,
                        status: "pending",
                        segmentCount: 0,
                        totalSpeechSeconds: 0,
                      }));

                  return (
                    <div className="space-y-4">
                      <section className="rounded-[18px] border border-cyan-300/20 bg-cyan-300/[0.06] p-5 shadow-[0_0_26px_rgba(103,232,249,0.08)]">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-cyan-200/80">
                              Voice Dubbing
                            </p>
                            <h3 className="mt-2 text-xl font-black text-white">
                              Separate dialogue, detect speakers, map voices to characters
                            </h3>
                            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-white/60">
                              Uses Demucs-style source separation plus speaker diarization. Detect up to five dialogue voices, then map each voice lane to a checked clip character. Checked characters without saved voice models are skipped automatically.
                            </p>
                          </div>

                          <div className="flex flex-wrap items-end gap-3">
                            <label className="grid gap-1 text-xs font-black uppercase tracking-[0.18em] text-cyan-100/70">
                              Expected voices
                              <select
                                value={audioExpectedSpeakerCount}
                                onChange={(event) => setAudioExpectedSpeakerCount(Number(event.target.value) || 0)}
                                className="min-w-[104px] rounded-[12px] border border-cyan-200/25 bg-black/40 px-3 py-2 text-sm font-black normal-case tracking-normal text-white outline-none focus:border-cyan-200/70"
                              >
                                <option value={0}>Auto</option>
                                <option value={1}>1 voice</option>
                                <option value={2}>2 voices</option>
                                <option value={3}>3 voices</option>
                                <option value={4}>4 voices</option>
                                <option value={5}>5 voices</option>
                              </select>
                            </label>
                            <button
                              type="button"
                              onClick={() => analyzeClipAudioForDubbing(activeAudioStudioClip, activeAudioStudioClipIndex)} disabled={audioClipAnalysisBusy || !activeAudioStudioClip}
                              className="rounded-[14px] border border-cyan-200/30 bg-cyan-300/10 px-4 py-3 text-sm font-black text-white transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {audioClipAnalysisBusy ? "Analyzing..." : "Analyze Clip Audio"}
                            </button>
                          </div>
                        </div>
                      </section>

                      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                        <section className="rounded-[18px] border border-violet-300/20 bg-violet-500/[0.08] p-5">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-violet-200/80">
                                Audio Separation
                              </p>
                              <h3 className="mt-2 text-lg font-black text-white">
                                Demucs + speaker diarization
                              </h3>
                            </div>
                            <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs font-black text-white/60">
                              1-5 voices
                            </span>
                          </div>

                          <div className="mt-4 grid gap-3">
                            <div className="rounded-[14px] border border-white/10 bg-black/20 p-4">
                              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Step 1</p>
                              <p className="mt-1 text-sm font-black text-white">Split dialogue from music, SFX, and ambience</p>
                              <p className="mt-1 text-xs font-semibold leading-5 text-white/30">
                                Demucs prepares a cleaner dialogue stem before speaker detection.
                              </p>
                            </div>

                            <div className="rounded-[14px] border border-white/10 bg-black/20 p-4">
                              <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Step 2</p>
                              <p className="mt-1 text-sm font-black text-white">Detect who is talking and create voice lanes</p>
                              <p className="mt-1 text-xs font-semibold leading-5 text-white/30">
                                Speaker diarization returns Voice 1 through Voice 5 with timing ranges.
                              </p>
                            </div>
                          </div>

                          <div className="mt-5 space-y-3">
                            {detectedVoiceRows.map((voiceRow: any) => (
                              <div key={voiceRow.id} className="rounded-[14px] border border-white/10 bg-black/25 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-black text-white">{voiceRow.label}</p>
                                    <p className="mt-1 text-xs font-semibold text-white/45">{voiceRow.description}</p>
                                  </div>
                                  <span className="rounded-full border border-cyan-200/20 bg-cyan-300/10 px-3 py-1 text-xs font-black text-cyan-100">
                                    {voiceRow.status === "detected" ? `${voiceRow.segmentCount || 0} segment(s)` : "Pending analysis"}
                                  </span>
                                </div>
                                {voiceRow.status === "detected" ? (
                                  <p className="mt-2 text-xs font-bold text-white/70">
                                    {Number(voiceRow.totalSpeechSeconds || 0).toFixed(1)}s detected speech. Select a character voice model below to replace this lane.
                                  </p>
                                ) : null}

                                <label className="mt-3 block text-[11px] font-black uppercase tracking-[0.18em] text-white/45">
                                  Map to checked character
                                </label>
                                <select
                                  value={audioClipVoiceCharacterMap[voiceRow.id] || ""}
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setAudioClipVoiceCharacterMap((previous) => ({
                                      ...previous,
                                      [voiceRow.id]: nextValue,
                                    }));
                                  }}
                                  className="mt-2 w-full rounded-[12px] border border-white/10 bg-slate-950/80 px-3 py-3 text-sm font-bold text-white outline-none focus:border-cyan-300/30"
                                >
                                  <option value="">Skip this detected voice</option>
                                  {checkedDubCharacters.map((character: any) => (
                                    <option key={`${voiceRow.id}_${character.id}`} value={character.id} disabled={!character.voiceModel}>
                                      {character.voiceModel ? `${character.name} - saved voice model` : `${character.name} - skip: no saved voice model`}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section className="rounded-[18px] border border-violet-300/20 bg-violet-500/[0.08] p-5">
                          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-violet-200/80">
                            Checked Clip Characters
                          </p>
                          <h3 className="mt-2 text-lg font-black text-white">
                            Available character voice models
                          </h3>
                          <p className="mt-2 text-sm font-semibold leading-6 text-white/35">
                            Backgrounds are excluded. Checked clip characters and saved character voice options appear here.
                          </p>

                          <div className="mt-4 space-y-3">
                            {checkedDubCharacters.length ? (
                              checkedDubCharacters.map((character: any, index: number) => (
                                <div key={character.id || "character"} className="rounded-[14px] border border-white/10 bg-black/25 p-4">
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-black text-white">{index + 1}. {character.name}</p>
                                      <p className="mt-1 text-xs font-semibold text-white/45">{character.role}</p>
                                    </div>

                                    <span className={
                                      character.voiceModel
                                        ? "rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-xs font-black text-emerald-100"
                                        : "rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs font-black text-amber-100"
                                    }>
                                      {character.voiceModel ? "Voice model ready" : "Skipped: no voice"}
                                    </span>
                                  </div>

                                  {character.voiceModel ? (
                                    <p className="mt-3 truncate text-xs font-semibold text-white/45">{character.voiceModel}</p>
                                  ) : (
                                    <p className="mt-3 text-xs font-semibold text-white/45">
                                      Add a saved voice model on the character card to enable dubbing.
                                    </p>
                                  )}
                                </div>
                              ))
                            ) : (
                              <div className="rounded-[14px] border border-amber-300/20 bg-amber-300/[0.07] p-4 text-sm font-bold text-amber-100">
                                No checked non-background clip characters found yet.
                              </div>
                            )}
                          </div>
                        </section>
                      </div>

                      <section className="rounded-[18px] border border-emerald-300/20 bg-emerald-300/[0.06] p-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-emerald-100/80">Voice Dub Preview</p>
                            <h3 className="mt-2 text-lg font-black text-white">Start character voice dub</h3>
                            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-white/55">
                              Uses the selected detected voice mapping and the saved Characters-tab voice model to generate a preview video with the replaced voice.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => startAudioStudioDubPreview(activeAudioStudioClip, activeAudioStudioClipIndex, characterVoiceModelOptions)}
                            disabled={audioDubPreviewBusy || !activeAudioStudioClip || !Object.values(audioClipVoiceCharacterMap).some(Boolean)}
                            className="rounded-[14px] border border-emerald-200/30 bg-emerald-300/10 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {audioDubPreviewBusy ? "Dubbing..." : "Start Dub Preview"}
                          </button>
                        </div>

                        {audioDubPreviewError ? (
                          <p className="mt-4 rounded-[12px] border border-rose-300/25 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-100">
                            {audioDubPreviewError}
                          </p>
                        ) : null}

                        {audioDubPreviewResult?.previewVideoUrl ? (
                          <div className="mt-4 overflow-hidden rounded-[14px] border border-white/10 bg-black/25 p-3">
                            <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-white/45">Dubbed preview</p>
                            <video key={audioDubPreviewResult.previewVideoUrl} controls className="aspect-video w-full rounded-[12px] bg-black object-contain">
                              <source src={audioDubPreviewResult.previewVideoUrl} />
                            </video>
                            <p className="mt-2 break-all text-xs font-semibold text-white/45">{audioDubPreviewResult.previewVideoPath || audioDubPreviewResult.previewVideoUrl}</p>
                          </div>
                        ) : null}
                      </section>
                    </div>
                  );
                })()}
                {/* OTG_AUDIO_STUDIO_VOICE_DUBBING_UI_V2_END */}
<div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Mix Queue</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-1">
                  {([
                    // OTG_AUDIO_STUDIO_SONY_WOOSH_ONLY_MIX_QUEUE_V36BPW12
                    // OTG_AUDIO_STUDIO_SONY_WOOSH_AUTO_MANUAL_BUTTONS_V36BPW13B
                    ["add_sound_effect", "Auto Sony Woosh"],
                    ["add_sound_effect", "Manual Sony Woosh"],
                  ] as Array<[ProductionAudioStudioAction, string]>).map(([action, label]) => (
                    <div key={`${action}-${label}`} className="rounded-[14px] border border-white/10 bg-black/20 p-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (action === "add_sound_effect") {
                            const sonyWooshMode = /manual/i.test(String(label || "")) ? "manual" : "auto";
                            const manualPrompt =
                              sonyWooshMode === "manual"
                                ? window.prompt(
                                    "Describe the sound effects to add to this video.",
                                    "add cinematic whooshes synced to movement, sharp transition swishes, and a deep impact at the cut"
                                  )
                                : "";
                            if (sonyWooshMode === "manual" && !String(manualPrompt || "").trim()) {
                              setNotice("Manual Sony Woosh cancelled or empty.");
                              return;
                            }

                            void startAudioStudioSonyWooshSfx(
                              activeRow,
                              activeKey,
                              activeRow?.durationSec || clampStoryboardDuration(selectedScene?.durationSeconds ?? DEFAULT_SCENE_DURATION_SECONDS),
                              sonyWooshMode,
                              String(manualPrompt || "").trim()
                            );
                            return;
                          }

                          const selectedVoiceMappings = Object.entries(audioClipVoiceCharacterMap)
                            .filter(([, characterId]) => String(characterId || "").trim())
                            .map(([voiceId, characterId]) => ({ voiceId, characterId }));

                          if (action === "replace_voice" && !selectedVoiceMappings.length) {
                            setNotice("Analyze the clip and map at least one detected voice to a checked character voice before replacing voice.");
                            return;
                          }

                          void queueProductionAudioStudioAction(action, activeKey, {
                            sourceFileName: activeRow?.sourceFileName || "",
                            mixMode: action === "render_audio_mix" ? "preview" : "queued_placeholder",
                            ...(action === "replace_voice" ? {
                              audioClipAnalysis: audioClipAnalysisResult,
                              voiceCharacterMap: audioClipVoiceCharacterMap,
                              selectedVoiceMappings,
                            } : {}),
                          });
                        }}
                        disabled={!activeRow || audioStudioJobs[action]?.phase === "submitting" || (action === "add_sound_effect" && audioStudioSonyWooshBusy)}
                        className="w-full rounded-[12px] border border-white/15 bg-white/[0.06] px-3 py-2 text-sm font-black text-white disabled:opacity-45"
                      >
                        {action === "add_sound_effect" && audioStudioSonyWooshBusy ? "Rendering..." : audioStudioJobs[action]?.phase === "submitting" ? "Submitting..." : label}
                      </button>
                      {renderAudioStudioJobStatus(action)}
                      {action === "add_sound_effect" && audioStudioSonyWooshError ? (
                        <div className="mt-2 rounded-[10px] border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-100">
                          {audioStudioSonyWooshError}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <details className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
                <summary className="cursor-pointer text-sm font-black uppercase tracking-[0.18em] text-white/35">Advanced Audio Job Notes</summary>
                <div className="mt-3 grid gap-3 text-sm leading-6 text-white/60 md:grid-cols-2">
                  <p>Sony Woosh SFX calls the existing Edit Video Sony Woosh workflow and saves the result to Gallery when possible.</p>
                  <p>Other Audio Studio Mix Queue actions are hidden for now while Sony Woosh is being validated. Auto uses a video-analysis prompt; Manual asks for your SFX prompt.</p>
                </div>
              </details>
            </div>
          </div>
        )}
      </section>
    );
  }

// OTG_PRODUCTION_ASSEMBLE_EDIT_HANDOFF_V1_START
  const exportPresetOptions: Array<{ id: ProductionExportPreset; label: string; detail: string }> = [
    { id: "draft", label: "Draft", detail: "Fast review render" },
    { id: "standard", label: "Standard", detail: "Balanced quality" },
    { id: "high_quality", label: "High Quality", detail: "Higher bitrate master" },
    { id: "mobile", label: "Mobile", detail: "Smaller share file" },
    { id: "youtube", label: "YouTube", detail: "Web upload ready" },
    { id: "play_store_preview", label: "Play Store Preview", detail: "Store listing preview" },
  ];

  function formatSecondsLabel(value: number | null | undefined) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return "--";
    return `${Math.round(seconds * 10) / 10}s`;
  }

  function sceneProductionCounts(scene: ProductionScene | null | undefined) {
    const images = Array.from({ length: Math.max(0, Number(scene?.imageCount || 0)) }, (_, index) => scene?.images?.[index]);
    const clips = animateFrameClips(scene);
    const editRows = editClipRows(scene);
    const manifestsReady = editRows.filter((row) => {
      const manifest = normalizeProductionEditManifest(row, editDraftsByClipKey[row.key] || row.clip.editManifest, row.durationSec);
      return manifest.status === "manifest_saved" || manifest.status === "render_ready";
    }).length;
    const editedReady = editRows.filter((row) => {
      const manifest = normalizeProductionEditManifest(row, editDraftsByClipKey[row.key] || row.clip.editManifest, row.durationSec);
      return Boolean(manifest.editedUrl || manifest.editedFileName);
    }).length;

    return {
      imageReady: images.filter((image) => image?.status === "ready" || image?.approved).length,
      imageTotal: images.length,
      clipReady: clips.filter((clip) => clip.status === "ready" && clip.url).length,
      clipTotal: clips.length,
      manifestsReady,
      editTotal: editRows.length,
      editedReady,
      assembledReady: Boolean(scene?.assembledVideoUrl || scene?.assembledVideoPath),
    };
  }

  function productionQueueItems() {
    const items: Array<{ id: string; label: string; status: "done" | "running" | "queued" | "blocked"; detail: string }> = [];
    scenes.forEach((scene, sceneIndex) => {
      const counts = sceneProductionCounts(scene);
      const label = `${sceneNumber(sceneIndex)} ${scene.title}`;
      items.push({
        id: `${scene.id}_storyboard`,
        label: `${label} Storyboard`,
        status: counts.imageReady >= counts.imageTotal && counts.imageTotal > 0 ? "done" : busySceneId === scene.id ? "running" : "queued",
        detail: `${counts.imageReady}/${counts.imageTotal} images ready`,
      });
      items.push({
        id: `${scene.id}_animate`,
        label: `${label} Animate`,
        status: counts.clipReady >= counts.clipTotal && counts.clipTotal > 0 ? "done" : busySceneId === scene.id ? "running" : counts.imageReady ? "queued" : "blocked",
        detail: `${counts.clipReady}/${counts.clipTotal} clips ready`,
      });
      items.push({
        id: `${scene.id}_edit`,
        label: `${label} Edit`,
        status: counts.editedReady ? "done" : counts.manifestsReady ? "queued" : counts.clipReady ? "queued" : "blocked",
        detail: `${counts.manifestsReady}/${counts.editTotal} manifests, ${counts.editedReady} edited`,
      });
      items.push({
        id: `${scene.id}_assemble`,
        label: `${label} Assemble`,
        status: counts.assembledReady ? "done" : assemblingSceneId === scene.id ? "running" : counts.clipReady ? "queued" : "blocked",
        detail: counts.assembledReady ? "stitched output ready" : "waiting for source clips",
      });
    });
    return items;
  }

  function createProductionSnapshot() {
    const label = `${projectTitle.trim() || "Production"} - ${new Date().toLocaleString()}`;
    const snapshot: ProductionSnapshot = {
      id: `snapshot_${Date.now()}`,
      label,
      createdAt: new Date().toISOString(),
      manifest: { ...manifest, snapshots: [] },
    };
    setProductionSnapshots((previous) => [snapshot, ...previous].slice(0, 12));
    setNotice(`Snapshot saved: ${label}`);
  }

  function restoreProductionSnapshot(snapshot: ProductionSnapshot) {
    const next = snapshot.manifest;
    setProjectTitle(next.projectTitle || "Untitled Production");
    setActiveStage(next.activeStage || "storyboard");
    // Director Mode is temporarily disabled; always restore Animate to Default Mode for now.
    setProductionAnimateMode("default");
    setExportPreset(next.exportPreset || "standard");
    setScenes(Array.isArray(next.scenes) && next.scenes.length ? next.scenes : initialScenes);
    setSelectedSceneId(next.selectedSceneId || next.scenes?.[0]?.id || initialScenes[0]?.id || "");
    setMediaPreflight(null);
    setAssembleResult(null);
    setNotice(`Restored snapshot: ${snapshot.label}`);
  }

  function removeProductionSnapshot(snapshotId: string) {
    setProductionSnapshots((previous) => previous.filter((snapshot) => snapshot.id !== snapshotId));
  }

  function renderProductionOverviewPanel(scene: ProductionScene | null | undefined) {
    const counts = sceneProductionCounts(scene);
    const items = [
      { label: "Storyboard", done: counts.imageReady, total: counts.imageTotal, detail: "images" },
      { label: "Animate", done: counts.clipReady, total: counts.clipTotal, detail: "clips" },
      { label: "Edit", done: counts.manifestsReady, total: counts.editTotal, detail: "manifests" },
      { label: "Assemble", done: counts.assembledReady ? 1 : 0, total: 1, detail: "output" },
    ];

    return (
      <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/80">Production Timeline</p>
            <h3 className="mt-2 text-xl font-black text-white">Scene status at a glance</h3>
          </div>
          <button type="button" onClick={createProductionSnapshot} className="rounded-[12px] border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-100">
            Save Snapshot
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {items.map((item) => {
            const percent = item.total > 0 ? Math.round((item.done / item.total) * 100) : 0;
            return (
              <div key={item.label} className="rounded-[14px] border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-black text-white">{item.label}</span>
                  <span className="text-xs font-black text-white/35">{item.done}/{item.total}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-cyan-300" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
                </div>
                <p className="mt-2 text-xs text-white/45">{item.detail}</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderProductionQueuePanel() {
    const items = productionQueueItems();
    const visibleItems = items.filter((item) => item.status !== "done").slice(0, 8);
    return (
      <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/80">Render Queue</p>
        <h3 className="mt-2 text-xl font-black text-white">What needs attention</h3>
        <div className="mt-4 grid gap-2">
          {(visibleItems.length ? visibleItems : items.slice(0, 4)).map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-[12px] border border-white/10 bg-black/20 px-3 py-2 text-sm">
              <div>
                <div className="font-black text-white">{item.label}</div>
                <div className="text-xs text-white/45">{item.detail}</div>
              </div>
              <span className={classNames(
                "rounded-full px-3 py-1 text-xs font-black",
                item.status === "done" ? "bg-emerald-300/15 text-emerald-200" : item.status === "running" ? "bg-cyan-300/15 text-cyan-100" : item.status === "blocked" ? "bg-rose-300/15 text-rose-100" : "bg-amber-300/15 text-amber-100"
              )}>
                {item.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderSnapshotPanel() {
    return (
      <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/80">Restore Points</p>
        <h3 className="mt-2 text-xl font-black text-white">Project snapshots</h3>
        <div className="mt-4 space-y-2">
          {productionSnapshots.length ? productionSnapshots.map((snapshot) => (
            <div key={snapshot.id} className="rounded-[12px] border border-white/10 bg-black/20 p-3">
              <div className="text-sm font-black text-white">{snapshot.label}</div>
              <div className="mt-1 text-xs text-white/45">{new Date(snapshot.createdAt).toLocaleString()}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => restoreProductionSnapshot(snapshot)} className="rounded-[10px] border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-black text-cyan-100">Restore</button>
                <button type="button" onClick={() => removeProductionSnapshot(snapshot.id)} className="rounded-[10px] border border-rose-300/25 bg-rose-300/10 px-3 py-1.5 text-xs font-black text-rose-100">Delete</button>
              </div>
            </div>
          )) : (
            <div className="rounded-[12px] border border-dashed border-white/15 bg-black/20 p-4 text-sm text-white/45">
              No snapshots yet. Save one before trying risky edit or transition changes.
            </div>
          )}
        </div>
      </div>
    );
  }

  function defaultAssembleTransition(fromClipIndex: number): ProductionAssembleTransition {
    return {
      id: `transition_${fromClipIndex}_${fromClipIndex + 1}`,
      fromClipIndex,
      toClipIndex: fromClipIndex + 1,
      type: "cut",
      durationSeconds: 0.5,
    };
  }

  function assembleTransitionsForRows(scene: ProductionScene | null | undefined, rowCount: number) {
    const saved = Array.isArray(scene?.assembleTransitions) ? scene?.assembleTransitions || [] : [];
    return Array.from({ length: Math.max(0, rowCount - 1) }, (_, index) => {
      const existing = saved.find((transition) => transition.fromClipIndex === index && transition.toClipIndex === index + 1);
      return {
        ...defaultAssembleTransition(index),
        ...(existing || {}),
        fromClipIndex: index,
        toClipIndex: index + 1,
        durationSeconds: Math.max(0.1, Math.min(2, Number(existing?.durationSeconds || 0.5))),
      };
    });
  }

  function updateAssembleTransition(index: number, patch: Partial<ProductionAssembleTransition>) {
    if (!selectedScene) return;
    const rows = assembleSourceRows(selectedScene);
    const nextTransitions = assembleTransitionsForRows(selectedScene, rows.length).map((transition, transitionIndex) =>
      transitionIndex === index
        ? {
            ...transition,
            ...patch,
            durationSeconds: Math.max(0.1, Math.min(2, Number(patch.durationSeconds ?? transition.durationSeconds) || 0.5)),
          }
        : transition
    );
    updateSelectedScene({ assembleTransitions: nextTransitions });
  }

  function assembleSourceRows(scene: ProductionScene | null | undefined) {
    return editClipRows(scene).filter((row) => !isAnimateLastFrameConsumed(row.draft)).map((row) => {
      const manifest = normalizeProductionEditManifest(row, editDraftsByClipKey[row.key] || row.clip.editManifest, row.durationSec);
      const hasEdited = Boolean(manifest.editedUrl || manifest.editedFileName);
      const editedUrl = manifest.editedUrl || (manifest.editedFileName ? `/api/gallery/file?name=${encodeURIComponent(manifest.editedFileName)}` : "");
      return {
        key: row.key,
        clipIndex: row.index,
        title: row.title,
        sourceKind: hasEdited ? "edited" as const : "original" as const,
        url: hasEdited ? editedUrl : row.sourceUrl,
        videoPath: absolutePathFromFileUrl(hasEdited ? editedUrl : row.sourceUrl),
        fileName: hasEdited ? manifest.editedFileName || fileNameFromUrl(editedUrl) : row.sourceFileName,
        originalFileName: row.sourceFileName,
        editedFileName: manifest.editedFileName || "",
        manifestStatus: manifest.status,
        durationSec: hasEdited && manifest.renderedDurationSeconds ? manifest.renderedDurationSeconds : row.durationSec,
      };
    });
  }

  async function runAssemblePreflight() {
    if (!selectedScene || checkingPreflight) return;
    const rows = assembleSourceRows(selectedScene).filter((row) => row.url);
    if (!rows.length) {
      setNotice("Preflight needs at least one available clip.");
      return;
    }

    setCheckingPreflight(true);
    setMediaPreflight(null);
    setNotice("Checking clip audio, duration, FPS, and size before Assemble...");
    try {
      const response = await fetch("/api/production/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          productionId: selectedScene.id,
          scenes: rows.map((row) => ({
            card: row.clipIndex + 1,
            videoPath: row.videoPath,
            videoUrl: row.url,
            fileName: row.fileName,
          })),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(String(data?.error || "Preflight failed."));
      const result = data as ProductionMediaPreflightResult;
      setMediaPreflight(result);
      setNotice(
        result.summary.hasBlockingIssue
          ? "Preflight found clips that need attention before final Assemble."
          : `Preflight passed for ${result.summary.readyCount}/${result.summary.clipCount} clips.`
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Preflight failed.");
    } finally {
      setCheckingPreflight(false);
    }
  }

  function transitionPreviewRows(scene: ProductionScene | null | undefined) {
    const rows = assembleSourceRows(scene).filter((row) => row.url);
    const transitions = assembleTransitionsForRows(scene, rows.length);
    return transitions.map((transition, index) => ({
      transition,
      from: rows[index],
      to: rows[index + 1],
    })).filter((item) => item.from && item.to);
  }

  async function generateAssemblyBackgroundMusicV36BPW15() {
    if (!selectedScene || assemblyMusicGenerating) return;

    const rows = assembleSourceRows(selectedScene).filter((row) => row.url);
    if (!rows.length) {
      setNotice("Generate or sync Assemble clips before creating background music.");
      return;
    }

    const prompt = assemblyMusicPrompt.trim();
    if (!prompt) {
      setAssemblyMusicError("Enter a background music prompt first.");
      setNotice("Enter a background music prompt first.");
      return;
    }

    const totalTimelineSeconds = Math.max(
      1,
      rows.reduce((sum, row) => sum + Number(row.durationSec || 0), 0) ||
        selectedScene.durationSeconds ||
        DEFAULT_SCENE_DURATION_SECONDS
    );
    const safeStartSeconds = Math.max(0, Math.min(totalTimelineSeconds, Number(assemblyMusicStartSeconds) || 0));
    const safeEndSeconds = Math.max(
      safeStartSeconds + 1,
      Math.min(totalTimelineSeconds, Number(assemblyMusicEndSeconds) || totalTimelineSeconds)
    );
    const durationSeconds = Math.max(5, Math.min(300, Math.round(safeEndSeconds - safeStartSeconds)));

    setAssemblyMusicGenerating(true);
    setAssemblyMusicError("");
    setNotice("Generating background music with Stable Audio 3...");

    try {
      const response = await fetch("/api/production/assembly-music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          productionId: selectedScene.id,
          title: `${selectedScene.title || "scene"}_background_music`,
          prompt,
          durationSeconds,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error || "Background music generation failed."));
      }

      setAssemblyMusicResult(data);
      setNotice(`Background music generated. Volume is set to ${Math.round(assemblyMusicVolume * 100)}%. It will be mixed when you Stitch Timeline.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Background music generation failed.";
      setAssemblyMusicError(message);
      setNotice(message);
    } finally {
      setAssemblyMusicGenerating(false);
    }
  }
  async function detectAssemblyMusicTimelineV36BPW17() {
    if (!selectedScene) return;

    const rows = assembleSourceRows(selectedScene).filter((row) => row.url);
    const fallbackDurationSeconds = Math.max(
      1,
      rows.reduce((sum, row) => sum + Number(row.durationSec || 0), 0) ||
        selectedScene.durationSeconds ||
        DEFAULT_SCENE_DURATION_SECONDS
    );
    const videoPath = String(assembleResult?.videoPath || selectedScene.assembledVideoPath || "").trim();

    setNotice("Detecting final timeline duration...");

    try {
      const response = await fetch("/api/production/assembly-music-detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          videoPath,
          fallbackDurationSeconds,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error || "Timeline detection failed."));
      }

      const detected = Math.max(1, Math.ceil(Number(data.roundedDurationSeconds || data.durationSeconds || fallbackDurationSeconds)));
      setAssemblyMusicDetectedTimelineSeconds(detected);
      setAssemblyMusicStartSeconds(0);
      setAssemblyMusicEndSeconds(detected);
      setNotice(`Detected final timeline length: ${detected}s (${data.source || "timeline"}).`);
    } catch (error) {
      const fallback = Math.max(1, Math.ceil(fallbackDurationSeconds));
      setAssemblyMusicDetectedTimelineSeconds(fallback);
      setAssemblyMusicStartSeconds(0);
      setAssemblyMusicEndSeconds(fallback);
      setNotice(`Timeline detection used fallback row duration: ${fallback}s.`);
    }
  }

  async function addAssemblyMusicToStitchedVideoV36BPW17() {
    if (!selectedScene || assemblyMusicMixing) return;

    const videoPath = String(assembleResult?.videoPath || selectedScene.assembledVideoPath || "").trim();
    if (!videoPath) {
      setNotice("Stitch the timeline first, then add background music.");
      return;
    }

    if (!(assemblyMusicResult?.musicPath || assemblyMusicResult?.audioPath || assemblyMusicResult?.musicFileName || assemblyMusicResult?.audioFileName)) {
      setNotice("Generate background music first.");
      return;
    }

    setAssemblyMusicMixing(true);
    setAssemblyMusicError("");
    setNotice("Adding background music to the stitched video...");

    try {
      const previousOutputs = selectedScene.assembledOutputs || [];
      setAssemblyMusicUndoSnapshot({
        assembleResult,
        assembledVideoUrl: selectedScene.assembledVideoUrl,
        assembledVideoPath: selectedScene.assembledVideoPath,
        assembledOutputs: previousOutputs,
      });

      const mixResponse = await fetch("/api/production/assembly-music-mix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          productionId: selectedScene.id,
          videoPath,
          videoUrl: assembleResult?.videoUrl || selectedScene.assembledVideoUrl,
          musicPath: assemblyMusicResult.musicPath || assemblyMusicResult.audioPath,
          musicFileName: assemblyMusicResult.musicFileName || assemblyMusicResult.audioFileName,
          musicVolume: assemblyMusicVolume,
          musicStartSeconds: assemblyMusicStartSeconds,
          musicEndSeconds: assemblyMusicEndSeconds,
          fadeInSeconds: assemblyMusicFadeInSeconds,
          fadeOutSeconds: assemblyMusicFadeOutSeconds,
        }),
      });
      const mixData = await mixResponse.json().catch(() => null);
      if (!mixResponse.ok || !mixData?.ok) {
        throw new Error(String(mixData?.error || "Background music mix failed."));
      }

      const updatedResult = {
        ...(assembleResult || {}),
        videoUrl: String(mixData.videoUrl || assembleResult?.videoUrl || selectedScene.assembledVideoUrl || ""),
        videoPath: String(mixData.videoPath || assembleResult?.videoPath || selectedScene.assembledVideoPath || ""),
        backgroundMusic: {
          musicPath: mixData.musicPath || assemblyMusicResult.musicPath || assemblyMusicResult.audioPath,
          musicVolume: assemblyMusicVolume,
          musicStartSeconds: mixData.musicStartSeconds ?? assemblyMusicStartSeconds,
          musicEndSeconds: mixData.musicEndSeconds ?? assemblyMusicEndSeconds,
          fadeInSeconds: mixData.fadeInSeconds ?? assemblyMusicFadeInSeconds,
          fadeOutSeconds: mixData.fadeOutSeconds ?? assemblyMusicFadeOutSeconds,
        },
      } as ProductionAssembleStitchResult;

      const outputLibrary = [updatedResult, ...previousOutputs].slice(0, 12);
      setAssembleResult(updatedResult);
      updateSelectedScene({
        assembledVideoUrl: updatedResult.videoUrl,
        assembledVideoPath: updatedResult.videoPath,
        assembledOutputs: outputLibrary,
        status: "complete",
      });

      setNotice("Background music was added to the stitched video.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Background music mix failed.";
      setAssemblyMusicError(message);
      setNotice(message);
    } finally {
      setAssemblyMusicMixing(false);
    }
  }

  function undoAssemblyMusicV36BPW17() {
    if (!selectedScene || !assemblyMusicUndoSnapshot) {
      setNotice("No background music change to undo.");
      return;
    }

    setAssembleResult(assemblyMusicUndoSnapshot.assembleResult || null);
    updateSelectedScene({
      assembledVideoUrl: assemblyMusicUndoSnapshot.assembledVideoUrl,
      assembledVideoPath: assemblyMusicUndoSnapshot.assembledVideoPath,
      assembledOutputs: assemblyMusicUndoSnapshot.assembledOutputs || [],
      status: assemblyMusicUndoSnapshot.assembledVideoPath || assemblyMusicUndoSnapshot.assembledVideoUrl ? "complete" : selectedScene.status,
    });
    setAssemblyMusicUndoSnapshot(null);
    setNotice("Undid the last background music add.");
  }
  async function addAssemblyFinalToGalleryV36BPW18() {
    if (!selectedScene || assemblyGallerySaving) return;

    const videoPath = String(assembleResult?.videoPath || selectedScene.assembledVideoPath || "").trim();
    const videoUrl = String(assembleResult?.videoUrl || selectedScene.assembledVideoUrl || "").trim();

    if (!videoPath) {
      setNotice("Stitch the timeline first, then add the final video to Gallery.");
      return;
    }

    setAssemblyGallerySaving(true);
    setNotice("Adding final Assembly video to Gallery...");

    try {
      const response = await fetch("/api/production/assembly-add-to-gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sceneId: selectedScene.id,
          sceneTitle: selectedScene.title,
          title: `${selectedScene.title || "Scene"} Final Assembly`,
          videoPath,
          videoUrl,
          exportPreset,
          backgroundMusic: (assembleResult as any)?.backgroundMusic || null,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error || "Add to Gallery failed."));
      }

      setAssemblyGalleryResult(data);

      const updatedResult = {
        ...(assembleResult || {}),
        videoUrl: videoUrl || String(data.url || data.galleryUrl || ""),
        videoPath,
        galleryUrl: String(data.url || data.galleryUrl || ""),
        galleryFileName: String(data.fileName || data.name || ""),
        savedToGalleryAt: new Date().toISOString(),
      } as any;

      const outputLibrary = [updatedResult, ...(selectedScene.assembledOutputs || [])].slice(0, 12);
      setAssembleResult(updatedResult as ProductionAssembleStitchResult);
      updateSelectedScene({
        assembledOutputs: outputLibrary,
      });

      setNotice(`Added final Assembly video to Gallery: ${data.fileName || data.name || "saved video"}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Add to Gallery failed.";
      setNotice(message);
    } finally {
      setAssemblyGallerySaving(false);
    }
  }
  async function stitchAssembleTimeline() {
    if (!selectedScene || assemblingSceneId) return;
    const rows = assembleSourceRows(selectedScene).filter((row) => row.url);
    if (!rows.length) {
      setNotice("Assemble needs at least one available clip before stitching.");
      return;
    }

    const transitions = assembleTransitionsForRows(selectedScene, rows.length);
    setAssemblingSceneId(selectedScene.id);
    setAssembleResult(null);
    setNotice(assemblyMusicResult ? "Stitching Assemble timeline, then mixing background music..." : "Stitching Assemble timeline with selected transitions...");

    try {
      const response = await fetch("/api/production/stitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          productionId: selectedScene.id,
          exportPreset,
          scenes: rows.map((row) => ({
            card: row.clipIndex + 1,
            videoPath: row.videoPath,
            videoUrl: row.url,
            fileName: row.fileName,
          })),
          transitions,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error || "Timeline stitch failed."));
      }

      const result: ProductionAssembleStitchResult = {
        videoUrl: String(data.videoUrl || ""),
        videoPath: String(data.videoPath || ""),
        sceneCount: Number(data.sceneCount || rows.length),
        transitionsApplied: Number(data.transitionsApplied || 0),
        preset: exportPreset,
        createdAt: new Date().toISOString(),
      };
      let finalResult = result;
      let backgroundMusicApplied = false;

      if (assemblyMusicResult?.musicPath || assemblyMusicResult?.audioPath || assemblyMusicResult?.musicFileName || assemblyMusicResult?.audioFileName) {
        const mixResponse = await fetch("/api/production/assembly-music-mix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            productionId: selectedScene.id,
            videoPath: result.videoPath,
            videoUrl: result.videoUrl,
            musicPath: assemblyMusicResult.musicPath || assemblyMusicResult.audioPath,
            musicFileName: assemblyMusicResult.musicFileName || assemblyMusicResult.audioFileName,
            musicVolume: assemblyMusicVolume,
            musicStartSeconds: assemblyMusicStartSeconds,
            musicEndSeconds: assemblyMusicEndSeconds,
          }),
        });
        const mixData = await mixResponse.json().catch(() => null);
        if (!mixResponse.ok || !mixData?.ok) {
          throw new Error(String(mixData?.error || "Background music mix failed."));
        }
        finalResult = {
          ...result,
          videoUrl: String(mixData.videoUrl || result.videoUrl),
          videoPath: String(mixData.videoPath || result.videoPath),
        };
        backgroundMusicApplied = true;
      }

      const outputLibrary = [finalResult, ...(selectedScene.assembledOutputs || [])].slice(0, 12);
      setAssembleResult(finalResult);
      updateSelectedScene({
        assembleTransitions: transitions,
        assembledVideoUrl: finalResult.videoUrl,
        assembledVideoPath: finalResult.videoPath,
        assembledOutputs: outputLibrary,
        exportPreset,
        status: "complete",
      });
      setNotice(`Assembled timeline is ready${backgroundMusicApplied ? " with background music" : ""}. Applied ${finalResult.transitionsApplied} transition${finalResult.transitionsApplied === 1 ? "" : "s"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Timeline stitch failed.");
    } finally {
      setAssemblingSceneId("");
    }
  }

  function renderAssembleStage() {
    const scene = selectedScene;
    const rows = assembleSourceRows(scene);
    const transitions = assembleTransitionsForRows(scene, rows.length);
    const clipsFound = rows.filter((row) => row.url).length;
    const editManifestsReady = editClipRows(scene).filter((row) => {
      const manifest = normalizeProductionEditManifest(row, editDraftsByClipKey[row.key] || row.clip.editManifest, row.durationSec);
      return manifest.status === "manifest_saved" || manifest.status === "render_ready";
    }).length;
    const editedClipsReady = rows.filter((row) => row.sourceKind === "edited").length;
    const transitionCount = transitions.filter((transition) => transition.type !== "cut").length;
    const assemblyTimelineSecondsV36BPW17 = Math.max(
      1,
      Math.round(
        assemblyMusicDetectedTimelineSeconds ||
          rows.reduce((sum, row) => sum + Number(row.durationSec || 0), 0) ||
          scene?.durationSeconds ||
          DEFAULT_SCENE_DURATION_SECONDS
      )
    );
    const assemblyMusicStartSafeV36BPW17 = Math.max(0, Math.min(assemblyTimelineSecondsV36BPW17, Number(assemblyMusicStartSeconds) || 0));
    const assemblyMusicEndSafeV36BPW17 = Math.max(
      assemblyMusicStartSafeV36BPW17 + 1,
      Math.min(assemblyTimelineSecondsV36BPW17, Number(assemblyMusicEndSeconds) || assemblyTimelineSecondsV36BPW17)
    );
    const assemblyMusicLengthV36BPW17 = Math.max(1, Math.round(assemblyMusicEndSafeV36BPW17 - assemblyMusicStartSafeV36BPW17));
    const assemblyTimelineSecondsV36BPW16C = Math.max(
      1,
      Math.round(rows.reduce((sum, row) => sum + Number(row.durationSec || 0), 0) || scene?.durationSeconds || DEFAULT_SCENE_DURATION_SECONDS)
    );
    const assemblyMusicStartSafeV36BPW16C = Math.max(0, Math.min(assemblyTimelineSecondsV36BPW16C, Number(assemblyMusicStartSeconds) || 0));
    const assemblyMusicEndSafeV36BPW16C = Math.max(
      assemblyMusicStartSafeV36BPW16C + 1,
      Math.min(assemblyTimelineSecondsV36BPW16C, Number(assemblyMusicEndSeconds) || assemblyTimelineSecondsV36BPW16C)
    );
    const assemblyMusicLengthV36BPW16C = Math.max(1, Math.round(assemblyMusicEndSafeV36BPW16C - assemblyMusicStartSafeV36BPW16C));

    if (!scene) {
      return (
        <section className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5 text-white">
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/80">Assemble</p>
          <h2 className="mt-2 text-2xl font-black">Final Timeline</h2>
          <p className="mt-2 text-sm text-white/65">Select a scene before assembling clips.</p>
        </section>
      );
    }

    return (
      <section className="space-y-4">
        <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/80">Assemble</p>
              <h2 className="mt-2 text-2xl font-black text-white">Final timeline source map</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">
                Assemble now prefers each edited clip output. If a clip has no edited render, it falls back to the original synced Animate clip.
              </p>
            </div>
            <div className="grid gap-2 rounded-[14px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/70">
              <div><span className="text-white/40">clipsFound:</span> <span className="font-black text-white">{clipsFound}</span></div>
              <div><span className="text-white/40">editManifestsReady:</span> <span className="font-black text-white">{editManifestsReady}/{rows.length}</span></div>
              <div><span className="text-white/40">editedClipsReady:</span> <span className="font-black text-white">{editedClipsReady}/{rows.length}</span></div>
              <div><span className="text-white/40">transitions:</span> <span className="font-black text-white">{transitionCount}/{Math.max(0, rows.length - 1)}</span></div>
            </div>
          </div>
        </div>

        {renderProductionOverviewPanel(scene)}

<div className="grid gap-4 xl:grid-cols-2">
          {renderProductionQueuePanel()}
          {renderSnapshotPanel()}
        </div>

        {!rows.length ? (
          <div className="rounded-[18px] border border-amber-300/25 bg-amber-300/10 p-5 text-sm text-amber-100">
            No synced Animate clips are available yet. Assemble needs generated clips before it can build the final source map.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 rounded-[18px] border border-white/10 bg-white/[0.04] p-3">
              {[
                { id: "source", label: "Source Map" },
                { id: "review", label: "Scene Review" },
                { id: "library", label: "Output Library" },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setAssembleReviewMode(item.id as typeof assembleReviewMode)}
                  className={classNames(
                    "rounded-[12px] px-4 py-2 text-sm font-black",
                    assembleReviewMode === item.id ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-black/20 text-white/70"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {assembleReviewMode === "review" ? (
              <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/80">Per-Scene Review</p>
                <h3 className="mt-2 text-xl font-black text-white">Playback in Assemble order</h3>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  {rows.map((row) => (
                    <div key={`${row.key}_review`} className="rounded-[14px] border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-black text-white">Clip {row.clipIndex + 1}</div>
                        <span className={row.sourceKind === "edited" ? "rounded-full bg-emerald-300/15 px-3 py-1 text-xs font-black text-emerald-200" : "rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/60"}>{row.sourceKind}</span>
                      </div>
                      <video controls className="mt-3 aspect-video w-full rounded-[12px] bg-black object-contain">
                        <source src={row.url} />
                      </video>
                    </div>
                  ))}
                </div>
              </div>
            ) : assembleReviewMode === "library" ? (
              <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/80">Assemble Output Library</p>
                <h3 className="mt-2 text-xl font-black text-white">Saved stitched versions</h3>
                <div className="mt-4 grid gap-3">
                  {(scene.assembledOutputs || []).length ? (scene.assembledOutputs || []).map((output, index) => (
                    <div key={`${output.videoPath}_${index}`} className="rounded-[14px] border border-white/10 bg-black/20 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-black text-white">Version {index + 1}</div>
                          <div className="mt-1 text-xs text-white/45">{output.preset || "standard"} - {output.transitionsApplied} transition(s) - {output.createdAt ? new Date(output.createdAt).toLocaleString() : "saved output"}</div>
                        </div>
                        <a href={output.videoUrl} target="_blank" rel="noreferrer" className="rounded-[10px] border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100">Open</a>
                      </div>
                      <p className="mt-2 break-all text-xs text-white/45">{output.videoPath}</p>
                    </div>
                  )) : (
                    <div className="rounded-[14px] border border-dashed border-white/15 bg-black/20 p-4 text-sm text-white/45">
                      No stitched versions yet. Run Stitch Timeline to add one.
                    </div>
                  )}
                </div>
              </div>
            ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {rows.map((row) => (
              <div key={row.key} className="rounded-[18px] border border-white/10 bg-white/[0.04] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Clip {row.clipIndex + 1}</p>
                    <h3 className="text-lg font-black text-white">{row.sourceKind === "edited" ? "edited" : "original"}</h3>
                  </div>
                  <span className={row.sourceKind === "edited" ? "rounded-full bg-emerald-300/15 px-3 py-1 text-xs font-black text-emerald-200" : "rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/60"}>
                    Clip {row.clipIndex + 1}: {row.sourceKind}
                  </span>
                </div>

                {row.url ? (
                  <video controls className="mt-3 aspect-video w-full rounded-[14px] bg-black object-contain">
                    <source src={row.url} />
                  </video>
                ) : (
                  <div className="mt-3 grid aspect-video place-items-center rounded-[14px] border border-dashed border-white/15 bg-black/25 text-sm text-white/45">
                    Missing clip source.
                  </div>
                )}

                <div className="mt-3 space-y-1 text-xs text-white/35">
                  <div className="break-all"><span className="text-white/35">Using:</span> {row.fileName || "none"}</div>
                  <div className="break-all"><span className="text-white/35">Original:</span> {row.originalFileName || "none"}</div>
                  <div className="break-all"><span className="text-white/35">Edited:</span> {row.editedFileName || "none"}</div>
                  <div><span className="text-white/35">Manifest:</span> {editStatusLabel(row.manifestStatus)}</div>
                </div>
              </div>
            ))}
          </div>
            )}
          </div>
        )}

        {transitions.length ? (
          <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/80">Transitions</p>
                <h3 className="mt-2 text-xl font-black text-white">Scene-to-scene transitions before stitch</h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
                  Choose what happens between each assembled clip. Cut is instant; other transitions are rendered into the stitched output.
                </p>
              </div>
              <button
                type="button"
                disabled={assemblingSceneId === scene.id || clipsFound < 1}
                onClick={() => void stitchAssembleTimeline()}
                className="rounded-[14px] border border-emerald-300/30 bg-emerald-300/15 px-5 py-3 text-sm font-black text-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {assemblingSceneId === scene.id ? "Stitching..." : "Stitch Timeline"}
              </button>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_220px]">
              <label className="block rounded-[14px] border border-white/10 bg-black/20 p-4">
                <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Render Preset</span>
                <select
                  value={exportPreset}
                  onChange={(event) => setExportPreset(event.target.value as ProductionExportPreset)}
                  className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
                >
                  {exportPresetOptions.map((preset) => (
                    <option key={preset.id} value={preset.id} className="bg-slate-950">{preset.label} - {preset.detail}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={checkingPreflight || clipsFound < 1}
                onClick={() => void runAssemblePreflight()}
                className="rounded-[14px] border border-cyan-300/30 bg-cyan-300/10 px-5 py-3 text-sm font-black text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {checkingPreflight ? "Checking..." : "Auto-Fix Preflight"}
              </button>
            </div>

            {mediaPreflight ? (
              <div className="mt-4 rounded-[14px] border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Audio / Video Health</p>
                    <h4 className="mt-1 text-lg font-black text-white">
                      {mediaPreflight.summary.readyCount}/{mediaPreflight.summary.clipCount} clips ready, {mediaPreflight.summary.warningCount} warning(s)
                    </h4>
                  </div>
                  <span className={mediaPreflight.summary.hasBlockingIssue ? "rounded-full bg-rose-300/15 px-3 py-1 text-xs font-black text-rose-100" : "rounded-full bg-emerald-300/15 px-3 py-1 text-xs font-black text-emerald-100"}>
                    {mediaPreflight.summary.hasBlockingIssue ? "Needs attention" : "Ready"}
                  </span>
                </div>
                <div className="mt-3 grid gap-2">
                  {mediaPreflight.clips.map((clip) => (
                    <div key={clip.clipIndex} className="rounded-[12px] border border-white/10 bg-white/[0.03] p-3 text-xs text-white/60">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-black text-white">Clip {clip.clipIndex + 1}: {clip.fileName || "unknown"}</span>
                        <span>{clip.width || "--"}x{clip.height || "--"} - {clip.fps ? `${clip.fps}fps` : "--"} - {formatSecondsLabel(clip.durationSeconds)} - audio {clip.hasAudio ? "yes" : "no"}</span>
                      </div>
                      {clip.warnings.length ? <div className="mt-1 text-amber-100">{clip.warnings.join(" ")}</div> : null}
                      {clip.error ? <div className="mt-1 text-rose-100">{clip.error}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {transitionPreviewRows(scene).length ? (
              <div className="mt-4 rounded-[14px] border border-white/10 bg-black/20 p-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Transition Preview</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {transitionPreviewRows(scene).map(({ transition, from, to }) => (
                    <div key={transition.id} className="rounded-[12px] border border-white/10 bg-white/[0.03] p-3">
                      <div className="text-sm font-black text-white">Clip {from.clipIndex + 1} to Clip {to.clipIndex + 1}</div>
                      <div className="mt-1 text-xs text-white/45">{transition.type} - {transition.type === "cut" ? "instant" : `${transition.durationSeconds}s`}</div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <video controls className="aspect-video rounded-[10px] bg-black object-contain"><source src={from.url} /></video>
                        <video controls className="aspect-video rounded-[10px] bg-black object-contain"><source src={to.url} /></video>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 grid gap-3">
              {transitions.map((transition, index) => (
                <div key={transition.id} className="grid gap-3 rounded-[14px] border border-white/10 bg-black/20 p-4 md:grid-cols-[1fr_190px_150px] md:items-end">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-white/35">
                      Clip {transition.fromClipIndex + 1} to Clip {transition.toClipIndex + 1}
                    </p>
                    <div className="mt-2 text-sm font-bold text-white/75">
                      {rows[index]?.fileName || `Clip ${transition.fromClipIndex + 1}`} to {rows[index + 1]?.fileName || `Clip ${transition.toClipIndex + 1}`}
                    </div>
                  </div>
                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Transition</span>
                    <select
                      value={transition.type}
                      onChange={(event) => updateAssembleTransition(index, { type: event.target.value as ProductionAssembleTransitionType })}
                      className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
                    >
                      <option value="cut" className="bg-slate-950">Cut</option>
                      <option value="crossfade" className="bg-slate-950">Crossfade</option>
                      <option value="fade_black" className="bg-slate-950">Fade to black</option>
                      <option value="fade_white" className="bg-slate-950">Dip to white</option>
                      <option value="slide_left" className="bg-slate-950">Slide left</option>
                      <option value="slide_right" className="bg-slate-950">Slide right</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Duration</span>
                    <input
                      type="number"
                      min={0.1}
                      max={2}
                      step={0.1}
                      disabled={transition.type === "cut"}
                      value={transition.durationSeconds}
                      onChange={(event) => updateAssembleTransition(index, { durationSeconds: Number(event.target.value) })}
                      className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none disabled:opacity-45"
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {(assembleResult || scene.assembledVideoUrl) ? (
          <div className="rounded-[18px] border border-emerald-300/25 bg-emerald-300/10 p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-emerald-200/80">Stitched Output</p>
                <h3 className="mt-2 text-xl font-black text-white">Assembled video ready</h3>
                <p className="mt-2 break-all text-sm text-emerald-50/70">{assembleResult?.videoPath || scene.assembledVideoPath}</p>
              </div>
              <a
                href={assembleResult?.videoUrl || scene.assembledVideoUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-[14px] border border-emerald-300/30 bg-emerald-300/15 px-5 py-3 text-sm font-black text-emerald-100"
              >
                Open Output
              </a>
            </div>
            <video controls className="mt-4 aspect-video w-full rounded-[14px] bg-black object-contain">
              <source src={assembleResult?.videoUrl || scene.assembledVideoUrl} />
            </video>
          </div>
        ) : null}

        <details className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
          <summary className="cursor-pointer text-sm font-black uppercase tracking-[0.18em] text-white/35">Assemble Source Manifest</summary>
          <pre className="mt-3 max-h-80 overflow-auto rounded-[14px] bg-black/40 p-4 text-xs leading-5 text-cyan-50/80">{JSON.stringify({
            sceneId: scene.id,
            clipsFound,
            editManifestsReady,
            editedClipsReady,
            clips: rows.map((row) => ({
              clipIndex: row.clipIndex,
              source: row.sourceKind,
              fileName: row.fileName,
              originalFileName: row.originalFileName,
              editedFileName: row.editedFileName,
            })),
            transitions,
            assembledVideoUrl: scene.assembledVideoUrl || "",
            assembledVideoPath: scene.assembledVideoPath || "",
          }, null, 2)}</pre>
        </details>

        <div className="rounded-[18px] border border-emerald-300/20 bg-emerald-300/[0.06] p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-emerald-200/80">Background Music</p>
              <h3 className="mt-2 text-xl font-black text-white">Add music to the final stitched clip</h3>
              <p className="mt-2 text-sm leading-6 text-white/60">
                Detect the final video length, choose when the music starts and stops, generate the track, then use Add Music to place it into the stitched video.
              </p>
              <textarea
                value={assemblyMusicPrompt}
                onChange={(event) => setAssemblyMusicPrompt(event.target.value)}
                rows={3}
                className="mt-4 w-full rounded-[14px] border border-white/10 bg-black/30 px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/35 focus:border-emerald-300/40"
                placeholder="Describe the background music for the final assembled video."
              />

              <div className="mt-4 rounded-[14px] border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-white/45">Music Placement Tool</p>
                    <p className="mt-1 text-xs leading-5 text-white/50">
                      Timeline length: {assemblyTimelineSecondsV36BPW17}s. Music length: {assemblyMusicLengthV36BPW17}s.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void detectAssemblyMusicTimelineV36BPW17()} className="rounded-[10px] border border-emerald-300/30 bg-emerald-300/15 px-3 py-2 text-xs font-black text-emerald-100">
                      Detect Timeline
                    </button>
                    <button type="button" onClick={() => { setAssemblyMusicStartSeconds(0); setAssemblyMusicEndSeconds(assemblyTimelineSecondsV36BPW17); }} className="rounded-[10px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-white/70 hover:border-emerald-300/35 hover:text-emerald-100">
                      Full
                    </button>
                    <button type="button" onClick={() => { setAssemblyMusicStartSeconds(0); setAssemblyMusicEndSeconds(Math.min(12, assemblyTimelineSecondsV36BPW17)); }} className="rounded-[10px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-white/70 hover:border-emerald-300/35 hover:text-emerald-100">
                      Opening
                    </button>
                    <button type="button" onClick={() => { const start = Math.max(0, Math.round(assemblyTimelineSecondsV36BPW17 * 0.25)); const end = Math.max(start + 1, Math.round(assemblyTimelineSecondsV36BPW17 * 0.75)); setAssemblyMusicStartSeconds(start); setAssemblyMusicEndSeconds(end); }} className="rounded-[10px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-white/70 hover:border-emerald-300/35 hover:text-emerald-100">
                      Middle
                    </button>
                    <button type="button" onClick={() => { const start = Math.max(0, assemblyTimelineSecondsV36BPW17 - 12); setAssemblyMusicStartSeconds(start); setAssemblyMusicEndSeconds(assemblyTimelineSecondsV36BPW17); }} className="rounded-[10px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-black text-white/70 hover:border-emerald-300/35 hover:text-emerald-100">
                      Ending
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  <label className="block">
                    <span className="text-[11px] font-black uppercase tracking-[0.16em] text-white/40">Start Second</span>
                    <input
                      type="number"
                      min={0}
                      max={assemblyTimelineSecondsV36BPW17}
                      value={assemblyMusicStartSeconds}
                      onChange={(event) => {
                        const nextStart = Math.max(0, Math.min(assemblyTimelineSecondsV36BPW17, Number(event.target.value) || 0));
                        setAssemblyMusicStartSeconds(nextStart);
                        if (assemblyMusicEndSeconds <= nextStart) setAssemblyMusicEndSeconds(Math.min(assemblyTimelineSecondsV36BPW17, nextStart + 5));
                      }}
                      className="mt-2 w-full rounded-[10px] border border-white/10 bg-black/30 px-3 py-2 text-sm font-bold text-white outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-black uppercase tracking-[0.16em] text-white/40">Stop Second</span>
                    <input
                      type="number"
                      min={Math.max(1, assemblyMusicStartSeconds + 1)}
                      max={assemblyTimelineSecondsV36BPW17}
                      value={assemblyMusicEndSeconds}
                      onChange={(event) => setAssemblyMusicEndSeconds(Math.max(assemblyMusicStartSeconds + 1, Math.min(assemblyTimelineSecondsV36BPW17, Number(event.target.value) || assemblyTimelineSecondsV36BPW17)))}
                      className="mt-2 w-full rounded-[10px] border border-white/10 bg-black/30 px-3 py-2 text-sm font-bold text-white outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-black uppercase tracking-[0.16em] text-white/40">Fade In</span>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      step={0.25}
                      value={assemblyMusicFadeInSeconds}
                      onChange={(event) => setAssemblyMusicFadeInSeconds(Math.max(0, Math.min(30, Number(event.target.value) || 0)))}
                      className="mt-2 w-full rounded-[10px] border border-white/10 bg-black/30 px-3 py-2 text-sm font-bold text-white outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-black uppercase tracking-[0.16em] text-white/40">Fade Out</span>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      step={0.25}
                      value={assemblyMusicFadeOutSeconds}
                      onChange={(event) => setAssemblyMusicFadeOutSeconds(Math.max(0, Math.min(30, Number(event.target.value) || 0)))}
                      className="mt-2 w-full rounded-[10px] border border-white/10 bg-black/30 px-3 py-2 text-sm font-bold text-white outline-none"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="w-full rounded-[14px] border border-white/10 bg-black/20 p-4 xl:w-[340px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Music Volume</span>
                <span className="text-sm font-black text-emerald-100">{Math.round(assemblyMusicVolume * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={assemblyMusicVolume}
                onChange={(event) => setAssemblyMusicVolume(Math.max(0, Math.min(1, Number(event.target.value) || 0)))}
                className="mt-3 w-full"
              />
              <div className="mt-4 grid gap-2">
                <button
                  type="button"
                  disabled={assemblyMusicGenerating || !rows.length}
                  onClick={() => void generateAssemblyBackgroundMusicV36BPW15()}
                  className="w-full rounded-[12px] border border-emerald-300/30 bg-emerald-300/15 px-4 py-3 text-sm font-black text-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {assemblyMusicGenerating ? "Generating Music..." : "Generate Background Music"}
                </button>
                <button
                  type="button"
                  disabled={assemblyMusicMixing || !(assemblyMusicResult?.audioPath || assemblyMusicResult?.musicPath || assemblyMusicResult?.audioFileName || assemblyMusicResult?.musicFileName) || !(assembleResult?.videoPath || scene.assembledVideoPath)}
                  onClick={() => void addAssemblyMusicToStitchedVideoV36BPW17()}
                  className="w-full rounded-[12px] border border-cyan-300/30 bg-cyan-300/15 px-4 py-3 text-sm font-black text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {assemblyMusicMixing ? "Adding Music..." : "Add Music to Video"}
                </button>
                <button
                  type="button"
                  disabled={!assemblyMusicUndoSnapshot}
                  onClick={() => undoAssemblyMusicV36BPW17()}
                  className="w-full rounded-[12px] border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm font-black text-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Undo Music Add
                </button>
                <button
                  type="button"
                  disabled={assemblyGallerySaving || !(assembleResult?.videoPath || scene.assembledVideoPath)}
                  onClick={() => void addAssemblyFinalToGalleryV36BPW18()}
                  className="w-full rounded-[12px] border border-fuchsia-300/30 bg-fuchsia-300/15 px-4 py-3 text-sm font-black text-fuchsia-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {assemblyGallerySaving ? "Adding to Gallery..." : "Add Final to Gallery"}
                </button>
                {assemblyGalleryResult?.url || assemblyGalleryResult?.galleryUrl ? (
                  <a
                    href={assemblyGalleryResult.url || assemblyGalleryResult.galleryUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-[12px] border border-white/10 bg-white/[0.06] px-4 py-3 text-center text-xs font-black text-white/70 hover:border-fuchsia-300/30 hover:text-fuchsia-100"
                  >
                    Open Saved Gallery Video
                  </a>
                ) : null}
              </div>
              {assemblyMusicResult?.audioUrl || assemblyMusicResult?.musicUrl ? (
                <div className="mt-4 rounded-[12px] border border-white/10 bg-black/25 p-3">
                  <p className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-white/40">Generated Music Preview</p>
                  <audio controls src={assemblyMusicResult.audioUrl || assemblyMusicResult.musicUrl} className="w-full" />
                  <p className="mt-2 break-all text-xs text-white/35">{assemblyMusicResult.audioFileName || assemblyMusicResult.musicFileName}</p>
                </div>
              ) : null}
              {assemblyMusicError ? (
                <div className="mt-3 rounded-[12px] border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-100">
                  {assemblyMusicError}
                </div>
              ) : null}
            </div>
          </div>
        </div>
</section>
    );
  }
// OTG_PRODUCTION_ASSEMBLE_EDIT_HANDOFF_V1_END
// OTG_PRODUCTION_EDIT_WORKBENCH_V1_END
// OTG_PRODUCTION_SCENE_CARD_MOSAIC_V1_START
  function sceneReadyStoryboardImages(scene: ProductionScene | null | undefined) {
    if (!scene) return [] as Array<{ index: number; url: string; fileName: string }>;

    return Array.from({ length: clampStoryboardImageCount(scene.imageCount) }, (_, index) => {
      const image = scene.images[index];
      const url = String(image?.url || "").trim();
      return {
        index,
        url,
        fileName: String(image?.fileName || "").trim(),
      };
    }).filter((row) => row.url);
  }

  function scenePreviewGridClass(count: number) {
    if (count <= 1) return "grid-cols-1";
    if (count <= 4) return "grid-cols-2";
    if (count <= 9) return "grid-cols-3";
    return "grid-cols-4";
  }

  function renderSceneCardPreview(scene: ProductionScene, sceneIndex: number) {
    const readyImages = sceneReadyStoryboardImages(scene).slice(0, MAX_SCENE_IMAGE_COUNT);
    const count = readyImages.length;

    if (!count) {
      return <div className={classNames("h-14 rounded-[10px] bg-gradient-to-br", thumbnailClass(sceneIndex))} />;
    }

    return (
      <div
        className={classNames(
          "grid h-14 overflow-hidden rounded-[10px] border border-white/60 bg-slate-900",
          scenePreviewGridClass(count)
        )}
        title={`${count} synced scene image${count === 1 ? "" : "s"}`}
      >
        {readyImages.map((image) => (
          <div key={`${scene.id}-preview-${image.index}`} className="relative min-h-0 min-w-0 overflow-hidden bg-slate-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={`${scene.title} scene image ${image.index + 1}`}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        ))}
      </div>
    );
  }

  function renderScenePreviewModal() {
    if (!scenePreviewSceneId) return null;
    const scene = scenes.find((item) => item.id === scenePreviewSceneId);
    if (!scene) return null;

    const readyImages = sceneReadyStoryboardImages(scene);

    return (
      <div
        className="fixed inset-0 z-[170] overflow-y-auto bg-slate-950/85 px-4 py-6 backdrop-blur-sm"
        onClick={() => setScenePreviewSceneId("")}
      >
        <div
          className="mx-auto max-w-6xl rounded-[22px] border border-violet-300/30 bg-slate-950 p-5 text-white shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-violet-200">Scene Preview</div>
              <h3 className="mt-1 text-2xl font-black">{scene.title}</h3>
              <p className="mt-1 text-sm text-white/60">
                {readyImages.length}/{clampStoryboardImageCount(scene.imageCount)} synced scene image{readyImages.length === 1 ? "" : "s"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setScenePreviewSceneId("")}
              className="rounded-[10px] border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white transition hover:bg-white/15"
            >
              Close
            </button>
          </div>

          {readyImages.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {readyImages.map((image) => (
                <button
                  key={`${scene.id}-modal-${image.index}`}
                  type="button"
                  onClick={() => {
                    setSelectedSceneId(scene.id);
                    setExpandedStoryboardImageIndex(image.index);
                    setScenePreviewSceneId("");
                  }}
                  className="overflow-hidden rounded-[14px] border border-white/10 bg-white/[0.04] text-left transition hover:border-violet-300/60 hover:bg-white/[0.08]"
                >
                  <div className="relative aspect-video bg-slate-900">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.url}
                      alt={`${scene.title} scene image ${image.index + 1}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    <span className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/65 text-xs font-black text-white">
                      {image.index + 1}
                    </span>
                  </div>
                  <div className="px-3 py-2">
                    <div className="truncate text-xs font-bold text-white/75">{image.fileName || `Storyboard image ${image.index + 1}`}</div>
                    <div className="mt-1 text-[11px] font-black uppercase tracking-[0.12em] text-violet-200">Open image</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-6 text-center text-sm text-white/65">
              No synced scene pass preview yet.
            </div>
          )}
        </div>
      </div>
    );
  }
// OTG_PRODUCTION_SCENE_CARD_MOSAIC_V1_END

function renderProductionStageNavigation() {
    const currentIndex = stages.findIndex((stage) => stage.id === activeStage);
    const previousStage = currentIndex > 0 ? stages[currentIndex - 1] : null;
    const nextStage = currentIndex >= 0 && currentIndex < stages.length - 1 ? stages[currentIndex + 1] : null;

    return (
      <nav
        aria-label="Production stage navigation"
        className="mt-6 rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <button
            type="button"
            disabled={!previousStage}
            onClick={() => {
              if (previousStage) transitionProductionStage(previousStage.id);
            }}
            className="rounded-[12px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous{previousStage ? `: ${previousStage.label}` : ""}
          </button>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {stages.map((stage, index) => (
              <button
                key={stage.id}
                type="button"
                onClick={() => transitionProductionStage(stage.id)}
                className={[
                  "h-9 min-w-9 rounded-full border px-3 text-xs font-black transition",
                  stage.id === activeStage
                    ? "border-violet-300 bg-violet-600 text-white"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                ].join(" ")}
                aria-current={stage.id === activeStage ? "page" : undefined}
                title={stage.label}
              >
                {index + 1}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={saveDraft}
              className="rounded-[12px] bg-emerald-500 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-600"
            >
              Save Project
            </button>
            <button
              type="button"
              disabled={!nextStage}
              onClick={() => {
                if (nextStage) transitionProductionStage(nextStage.id);
              }}
              className="rounded-[12px] bg-violet-600 px-4 py-3 text-sm font-black text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next{nextStage ? `: ${nextStage.label}` : ""}
            </button>
          </div>
        </div>

        <div className="mt-3 text-center text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
          Page {currentIndex >= 0 ? currentIndex + 1 : 1} of {stages.length}
        </div>
      </nav>
    );
  }
// OTG_PRODUCTION_STAGE_BOTTOM_NAV_V1_END
  function openProductionPipeline(options: { startAtStoryboard?: boolean } = {}) {
    if (options.startAtStoryboard) transitionProductionStage("storyboard");
    setProductionHomeMode("pipeline");
  }

  const productionHomeCardClass = "rounded-[18px] border border-white/10 bg-white/[0.05] p-5 text-left shadow-[0_18px_60px_rgba(76,29,149,0.22)] transition hover:border-violet-300/60 hover:bg-white/[0.08]";
  const productionHomeButtonClass = "mt-4 rounded-[12px] bg-violet-500 px-4 py-2 text-sm font-black text-white shadow-[0_10px_30px_rgba(139,92,246,0.28)] transition hover:bg-violet-400";

  function renderProductionHomeShell(title: string, children: React.ReactNode) {
    return (
      <div data-theme={theme} className="production-board min-h-[calc(100vh-160px)] rounded-[8px] border border-violet-500/20 bg-slate-950 p-5 text-white shadow-[0_20px_70px_rgba(15,23,42,0.4)]">
        <div className="mx-auto max-w-6xl">
          <button
            type="button"
            onClick={() => setProductionHomeMode("home")}
            className="mb-5 rounded-[12px] border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-black text-violet-100 transition hover:border-violet-300/60 hover:bg-white/[0.08]"
          >
            Back to Production Home
          </button>
          <section className="rounded-[24px] border border-white/10 bg-gradient-to-br from-violet-950 via-slate-950 to-slate-900 p-6 shadow-[0_24px_80px_rgba(76,29,149,0.28)]">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-200">Production</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">Start, resume, manage, or review production projects.</p>
            <div className="mt-6">{children}</div>
          </section>
        </div>
      </div>
    );
  }

  if (productionHomeMode === "home") {
    return (
      <div data-theme={theme} className="production-board min-h-[calc(100vh-160px)] rounded-[8px] border border-violet-500/20 bg-slate-950 p-5 text-white shadow-[0_20px_70px_rgba(15,23,42,0.4)]">
        <div className="mx-auto max-w-6xl">
          <section className="rounded-[24px] border border-white/10 bg-gradient-to-br from-violet-950 via-slate-950 to-slate-900 p-6 shadow-[0_24px_80px_rgba(76,29,149,0.28)]">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-200">Production</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-white">Production</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/65">Start, resume, manage, or review production projects.</p>

            <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <button type="button" onClick={handleNewProduction} className={productionHomeCardClass}>
                <span className="text-lg font-black text-white">New</span>
                <span className="mt-2 block text-xs leading-5 text-white/35">Enter a project name, then open the workflow at Storyboard.</span>
              </button>
              <button type="button" onClick={continueFromAutosave} className={productionHomeCardClass}>
                <span className="text-lg font-black text-white">Continue</span>
                <span className="mt-2 block text-xs leading-5 text-white/35">Resume the latest autosave state.</span>
              </button>
              <button type="button" onClick={() => setProductionHomeMode("load")} className={productionHomeCardClass}>
                <span className="text-lg font-black text-white">Load</span>
                <span className="mt-2 block text-xs leading-5 text-white/35">Choose from available saved production workspaces.</span>
              </button>
              <button type="button" onClick={() => setProductionHomeMode("delete")} className={productionHomeCardClass}>
                <span className="text-lg font-black text-white">Delete</span>
                <span className="mt-2 block text-xs leading-5 text-white/35">Review deletion options without removing media assets.</span>
              </button>
              <button type="button" onClick={() => setProductionHomeMode("completed")} className={productionHomeCardClass}>
                <span className="text-lg font-black text-white">Completed</span>
                <span className="mt-2 block text-xs leading-5 text-white/35">Review finished productions in read-only mode.</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (productionHomeMode === "load") {
    const manualMeta = typeof window !== "undefined" ? productionStoredSaveMeta(PRODUCTION_MANUAL_SAVE_KEY) : null;
    return renderProductionHomeShell(
      "Load Production",
      <div className="rounded-[18px] border border-white/10 bg-black/20 p-4">
        {manualMeta ? (
          <>
            <p className="text-sm font-black text-white">{manualMeta.projectTitle}</p>
            <p className="mt-1 text-xs leading-5 text-white/35">Last manual save: {formatSaveTime(manualMeta.savedAt) || "unknown time"}</p>
            <button type="button" onClick={loadManualProduction} className={productionHomeButtonClass}>
              Load Manual Save
            </button>
          </>
        ) : (
          <>
            <p className="text-sm font-black text-white">No manual saved production yet.</p>
            <p className="mt-1 text-xs leading-5 text-white/35">Use Save Project inside the production pipeline to create a manual load point.</p>
          </>
        )}
      </div>,
    );
  }

  if (productionHomeMode === "delete") {
    return renderProductionHomeShell(
      "Delete Production",
      <div className="rounded-[18px] border border-rose-300/20 bg-rose-500/10 p-4">
        <p className="text-sm font-black text-rose-100">Delete current production</p>
        <p className="mt-2 text-sm leading-6 text-rose-50/70">Production deletion will be enabled after project library storage is finalized.</p>
        <button type="button" disabled className="mt-4 rounded-[12px] border border-rose-300/20 bg-rose-300/10 px-4 py-2 text-sm font-black text-rose-100/30">
          Delete
        </button>
      </div>,
    );
  }

  if (productionHomeMode === "completed") {
    return renderProductionHomeShell(
      "Completed Productions",
      <div className="rounded-[18px] border border-white/10 bg-black/20 p-4">
        <p className="text-sm text-white/65">No completed productions yet.</p>
      </div>,
    );
  }

  return (
  <div data-theme={theme} className="production-board min-h-[calc(100vh-160px)] rounded-[8px] border border-slate-200 bg-slate-50 text-slate-950 shadow-[0_20px_70px_rgba(15,23,42,0.12)]">
      <style jsx global>{`
        .production-board {
          transition: background-color 180ms ease, border-color 180ms ease, color 180ms ease, box-shadow 180ms ease;
        }
        .production-board * {
          transition: background-color 180ms ease, border-color 180ms ease, color 180ms ease, box-shadow 180ms ease;
        }
        .production-board .otg-range-input {
          appearance: none;
          pointer-events: none;
        }
        .production-board .otg-range-input::-webkit-slider-runnable-track {
          height: 2.5rem;
          background: transparent;
        }
        .production-board .otg-range-input::-webkit-slider-thumb {
          appearance: none;
          pointer-events: auto;
          height: 1.15rem;
          width: 1.15rem;
          margin-top: 0.68rem;
          border-radius: 9999px;
          border: 2px solid #0f172a;
          background: #67e8f9;
          box-shadow: 0 0 0 3px rgba(103, 232, 249, 0.24);
        }
        .production-board .otg-range-input::-moz-range-track {
          height: 2.5rem;
          background: transparent;
        }
        .production-board .otg-range-input::-moz-range-thumb {
          pointer-events: auto;
          height: 1.15rem;
          width: 1.15rem;
          border-radius: 9999px;
          border: 2px solid #0f172a;
          background: #67e8f9;
          box-shadow: 0 0 0 3px rgba(103, 232, 249, 0.24);
        }
        .production-board[data-theme="dark"] {
          background: #0f172a !important;
          border-color: #263248 !important;
          color: #e5e7eb !important;
          box-shadow: 0 20px 70px rgba(0, 0, 0, 0.34) !important;
        }
        .production-board[data-theme="dark"] .bg-white,
        .production-board[data-theme="dark"] .bg-slate-50 {
          background-color: #111827 !important;
        }
        .production-board[data-theme="dark"] .bg-slate-100 {
          background-color: #1f2937 !important;
        }
        .production-board[data-theme="dark"] .border-slate-200,
        .production-board[data-theme="dark"] .border-slate-300 {
          border-color: #263248 !important;
        }
        .production-board[data-theme="dark"] .text-slate-950,
        .production-board[data-theme="dark"] .text-slate-700,
        .production-board[data-theme="dark"] .text-slate-600 {
          color: #e5e7eb !important;
        }
        .production-board[data-theme="dark"] .text-slate-500,
        .production-board[data-theme="dark"] .text-slate-400 {
          color: #94a3b8 !important;
        }
        .production-board[data-theme="dark"] input,
        .production-board[data-theme="dark"] select,
        .production-board[data-theme="dark"] textarea {
          background-color: #0b1220 !important;
          border-color: #334155 !important;
          color: #e5e7eb !important;
        }
        .production-board[data-theme="dark"] input::placeholder,
        .production-board[data-theme="dark"] textarea::placeholder {
          color: #64748b !important;
        }
        .production-board[data-theme="dark"] .bg-violet-50 {
          background-color: rgba(109, 40, 217, 0.18) !important;
        }
        .production-board[data-theme="dark"] .text-violet-700,
        .production-board[data-theme="dark"] .text-violet-600 {
          color: #c4b5fd !important;
        }
        .production-board[data-theme="dark"] .border-violet-200,
        .production-board[data-theme="dark"] .border-violet-400 {
          border-color: rgba(167, 139, 250, 0.55) !important;
        }
        .production-board[data-theme="dark"] .bg-violet-600 {
          background-color: #7c3aed !important;
        }
        .production-board[data-theme="dark"] .border-rose-200 {
          border-color: rgba(251, 113, 133, 0.4) !important;
        }
        .production-board[data-theme="dark"] .text-rose-600 {
          color: #fda4af !important;
        }
        .production-board[data-theme="dark"] .from-slate-100 {
          --tw-gradient-from: #1f2937 var(--tw-gradient-from-position) !important;
          --tw-gradient-to: rgb(31 41 55 / 0) var(--tw-gradient-to-position) !important;
          --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to) !important;
        }
        .production-board[data-theme="dark"] .to-slate-200 {
          --tw-gradient-to: #334155 var(--tw-gradient-to-position) !important;
        }
      `}</style>
      <header className="border-b border-white/10 bg-slate-950 px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/90">Production Workflow</p>
            <h1 className="mt-1 max-w-xl truncate text-2xl font-black tracking-tight text-white" title={projectTitle.trim() || "Untitled Production"}>
              {projectTitle.trim() || "Untitled Production"}
            </h1>
            <div className={classNames("mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-black", manualSaveStatusLabel === "Project currently saved" ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-100" : "border-amber-300/40 bg-amber-400/15 text-amber-100")}>
              {manualSaveStatusLabel}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={saveDraft}
              className="rounded-[10px] border border-emerald-300 bg-emerald-500 px-4 py-2 text-sm font-black text-white shadow-[0_10px_30px_rgba(16,185,129,0.28)] transition hover:bg-emerald-600"
            >
              Save Project
            </button>
            <button
              type="button"
              onClick={handleBackToProductionHome}
              className="rounded-[8px] border border-violet-300/30 bg-violet-500/20 px-3 py-2 text-sm font-black text-violet-100 transition hover:bg-violet-500/30"
            >
              Back to Production Home
            </button>
          </div>
        </div>
        <div
          className={classNames(
            "mt-4 rounded-[12px] border px-4 py-3 shadow-sm",
            saveState === "error"
              ? "border-rose-300/40 bg-rose-950/35"
              : "border-cyan-300/35 bg-cyan-950/30"
          )}
          aria-live="polite"
        >
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className={classNames("flex items-center gap-2 text-sm font-black", saveState === "error" ? "text-rose-100" : "text-cyan-100")}>
                <span className={classNames("h-3 w-3 rounded-full", saveState === "error" ? "bg-rose-500" : "bg-cyan-500")} />
                {saveState === "error" ? "Save needs attention" : "Autosave status"}
              </div>
              <p className="mt-1 text-xs font-semibold text-white/75">
                {saveDetails}
                {lastSavedAt ? ` Last autosaved ${formatSaveTime(lastSavedAt)}.` : " Autosave will update when you move to the next or previous production step."}
                {manualSavedAt ? ` Last manual save ${formatSaveTime(manualSavedAt)}.` : ""}
              </p>
            </div>
            <div className="text-xs font-black uppercase tracking-[0.14em] text-white/70">
              {selectedScene ? `${selectedScene.title} - ${stages.find((stage) => stage.id === activeStage)?.label || "Storyboard"}` : "No scene selected"}
            </div>
          </div>
        </div>
        {notice ? <p className="mt-3 text-sm font-semibold text-white/80">{notice}</p> : null}

        <nav className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,2.2fr)_minmax(280px,1fr)]">
          {stages.filter((stage) => stage.id === activeStage).map((stage) => {
            const activeIndex = stages.findIndex((item) => item.id === stage.id);
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => transitionProductionStage(stage.id)}
                className="flex min-h-[132px] items-center gap-4 rounded-[16px] border border-violet-400 bg-violet-600 p-5 text-left text-white shadow-[0_18px_45px_rgba(124,58,237,0.28)] transition"
                aria-current="page"
              >
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white/18 text-xl font-black text-white">{activeIndex + 1}</span>
                <span className="min-w-0">
                  <span className="block text-3xl font-black tracking-tight">{stage.label}</span>
                  <span className="mt-2 block text-sm font-bold text-white/78">{stage.description}</span>
                  <span className="mt-3 inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-white/80">
                    Current production step
                  </span>
                </span>
              </button>
            );
          })}

          <div className="grid gap-2 sm:grid-cols-2">
            {stages.filter((stage) => stage.id !== activeStage).map((stage) => {
              const stageIndex = stages.findIndex((item) => item.id === stage.id);
              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => transitionProductionStage(stage.id)}
                  className="flex items-center gap-2 rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2 text-left text-slate-700 transition hover:bg-white"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-xs font-black text-slate-500">{stageIndex + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-black">{stage.label}</span>
                    <span className="block truncate text-[11px] text-slate-500">{stage.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        <section className="mt-5 rounded-[14px] border border-slate-200 bg-slate-50 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">Scenes</h2>
              <p className="mt-1 text-xs text-slate-500">
                {activeStage === "animate" && selectedScene && (selectedScene as any).qwenAnimateHandoffSourceV36BPU3
                  ? `${storyboardFramesForAnimate(selectedScene).filter((frame) => frame.approved && frame.url).length}/${storyboardFramesForAnimate(selectedScene).length} ready - storyboard scene clips`
                  : `${readyScenes}/${scenes.length} ready - maximum ${MAX_PRODUCTION_SCENES} scenes`}
              </p>
            </div>
            {activeStage === "storyboard" ? (
              <button
                type="button"
                onClick={addSceneLimited}
                disabled={scenes.length >= MAX_PRODUCTION_SCENES}
                className="rounded-[8px] border border-violet-200 bg-white px-3 py-2 text-xs font-black text-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                
              </button>
            ) : null}
          </div>

          {activeStage === "animate" && selectedScene && (selectedScene as any).qwenAnimateHandoffSourceV36BPU3 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {storyboardFramesForAnimate(selectedScene).map((frame) => {
                const draft = animateFrameDrafts(selectedScene)[frame.index];
                const clip = animateFrameClips(selectedScene)[frame.index];
                const consumed = isAnimateLastFrameConsumed(draft);
                const paired = draft?.animationMode === "first_last_frame" && draft?.lastFrameIndex === frame.index + 1;
                const ready = Boolean(frame.approved && frame.url);
                const selected = frame.index === activeAnimateSceneIndexV36BPU10B;
                const statusLabel = consumed
                  ? `Last frame for Scene ${Number(draft?.consumedByFrameIndex) + 1}`
                  : paired
                    ? `Paired to Scene ${Number(draft?.lastFrameIndex) + 1}`
                    : clip?.status === "ready"
                      ? "Clip ready"
                      : ready
                        ? "Storyboard Ready"
                        : "Pending image";

                return (
                  <div key={`animate-scene-strip-${frame.index}`} className={classNames("shrink-0", selected ? "w-56" : "w-40")}>
                    <button
                      type="button"
                      onClick={() => focusAnimateSceneEditorV36BPU6(frame.index)}
                      className={classNames(
                        "block w-full rounded-[12px] border p-2 text-left transition",
                        consumed
                          ? "border-purple-300/40 bg-purple-950/30 hover:border-purple-200/70"
                          : selected
                            ? "border-violet-400 bg-violet-950/40 shadow-sm hover:border-violet-200"
                            : "border-slate-700 bg-slate-950 hover:border-slate-500"
                      )}
                      title={`Open Scene ${frame.index + 1} animation editor`}
                    >
                      <div className="aspect-video overflow-hidden rounded-[10px] bg-slate-900">
                        {frame.url ? (
                          <img
                            src={frame.url}
                            alt={`Scene ${frame.index + 1} storyboard image`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] font-black text-slate-500">No image</div>
                        )}
                      </div>
                      <div className="mt-2 truncate text-xs font-black text-white">Scene {frame.index + 1}</div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        {draft?.durationSeconds || defaultAnimateFrameDuration(selectedScene)}s - {paired ? "first/last pair" : consumed ? "last frame only" : "image-to-video"}
                      </div>
                      <div className={classNames(
                        "mt-1 flex items-center gap-1.5 text-[11px] font-bold",
                        consumed ? "text-purple-200" : ready ? "text-emerald-200" : "text-amber-200"
                      )}>
                        <span className={classNames("h-2 w-2 rounded-full", consumed ? "bg-purple-300" : ready ? "bg-emerald-300" : "bg-amber-300")} />
                        {statusLabel}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {scenes.map((scene, index) => {
                const meta = statusMeta(scene.status);
                const selected = scene.id === selectedScene?.id;
                const readyImages = sceneReadyStoryboardImages(scene);
                return (
                  <div key={scene.id} className={classNames("shrink-0", selected ? "w-56" : "w-36")}>
                    <button
                      type="button"
                      onClick={() => setSelectedSceneId(scene.id)}
                      className={classNames(
                        "block w-full rounded-[12px] border p-2 text-left transition",
                        selected ? "border-violet-400 bg-violet-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"
                      )}
                      title="Select scene"
                    >
                      {renderSceneCardPreview(scene, index)}
                      <div className="mt-2 truncate text-xs font-black text-slate-950">{sceneNumber(index)} {scene.title}</div>
                      <div className="mt-1 text-[11px] text-slate-500">{scene.durationSeconds.toFixed(1)}s - {scene.imageCount} image{scene.imageCount === 1 ? "" : "s"}</div>
                      <div className={classNames("mt-1 flex items-center gap-1.5 text-[11px] font-bold", meta.text)}>
                        <span className={classNames("h-2 w-2 rounded-full", meta.dot)} />
                        {meta.label}
                      </div>
                    </button>

                    {readyImages.length ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSceneId(scene.id);
                          setScenePreviewSceneId(scene.id);
                        }}
                        className="mt-2 w-full rounded-[10px] border border-violet-300 bg-violet-600 px-2 py-2 text-center text-[11px] font-black text-white shadow-sm transition hover:bg-violet-700"
                      >
                        View Synced Images
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </header>

      {renderScenePreviewModal()}

      <div className="grid min-h-[720px] grid-cols-1">
        <main className="min-w-0 bg-slate-50 p-4 pb-32 md:p-6 md:pb-36">
          {activeStage === "storyboard" && selectedScene ? (
            <section className="space-y-5">
              <QwenSceneBuilderPanel
                productionProjectTitle={projectTitle}
                productionSceneId={selectedScene?.id || selectedSceneId}
                productionSceneName={selectedScene?.title || "Scene"}
              />
            </section>
          ) : activeStage === "animate" ? (renderAnimateStage()) : activeStage === "edit" ? (renderEditStage()) : activeStage === "audio" ? (renderAudioStudioStage()) : activeStage === "assemble" ? (renderAssembleStage()) : (<StageShell stage={activeStage} active={activeStage} />)}
          {renderProductionStageNavigation()}
        </main>


        {characterPickerSceneId && characterPickerSlotIndex !== null ? (
                <div
                  className="fixed inset-0 z-[160] overflow-y-auto bg-slate-950/80 px-4 py-6 backdrop-blur-sm"
                  onClick={closeCharacterPicker}
                >
                  <div
                    className="mx-auto flex max-h-[86vh] max-w-5xl flex-col overflow-hidden rounded-[18px] border border-cyan-200 bg-white shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                      <div>
                        <h3 className="text-lg font-black text-slate-900">
                          Choose Character for {characterReferenceSlotLabel(characterPickerSlotIndex)}
                        </h3>
                        <p className="text-sm text-slate-500">
                          Uses saved Characters tab images for this Production reference slot.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void loadCharacterPickerItems()}
                          disabled={characterPickerLoading}
                          className="rounded-[8px] border border-slate-200 px-3 py-2 text-xs font-black text-slate-600 disabled:opacity-50"
                        >
                          {characterPickerLoading ? "Loading..." : "Refresh"}
                        </button>
                        <button
                          type="button"
                          onClick={closeCharacterPicker}
                          className="rounded-[8px] border border-slate-200 px-3 py-2 text-xs font-black text-slate-600"
                        >
                          Close
                        </button>
                      </div>
                    </div>

                    <div className="min-h-[260px] overflow-y-auto p-5">
                      {characterPickerError ? (
                        <div className="mb-4 rounded-[12px] border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
                          {characterPickerError}
                        </div>
                      ) : null}

                      {characterPickerLoading ? (
                        <div className="rounded-[12px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                          Loading saved characters...
                        </div>
                      ) : null}

                      {!characterPickerLoading && !characterPickerError && characterPickerItems.length === 0 ? (
                        <div className="rounded-[12px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                          No saved characters found.
                        </div>
                      ) : null}

                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                        {characterPickerItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => void applyCharacterPickerItem(item)}
                            disabled={Boolean(characterPickerSelectingId)}
                            className="group overflow-hidden rounded-[14px] border border-slate-200 bg-white text-center transition hover:border-cyan-300 hover:bg-cyan-50 disabled:cursor-wait disabled:opacity-60"
                          >
                            <div className="aspect-[3/4] bg-slate-100 p-2">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={item.imageUrl}
                                alt={item.name}
                                className="h-full w-full object-contain"
                                loading="lazy"
                              />
                            </div>
                            <div className="border-t border-slate-200 px-3 py-3 text-center">
                              <div className="truncate text-sm font-black text-slate-900">{item.name}</div>
                              {characterPickerSelectingId === item.id ? (
                                <div className="mt-1 text-xs font-bold text-cyan-700">Selecting...</div>
                              ) : null}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

      </div>
    </div>
  );
}
