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

import { useEffect, useMemo, useState } from "react";

import ProductionAnimateModeSwitch, { type ProductionAnimateMode } from "./ProductionAnimateModeSwitch";
import ProductionDirectorModeUI, { type ProductionDirectorImportedFrame } from "./ProductionDirectorModeUI";
type ProductionStage = "storyboard" | "animate" | "edit" | "assemble";

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
  sourceCharacterId?: string;
  sourceCharacterName?: string;
  referenceAudioPath?: string;
};
type CharacterLibraryPickerItem = {
  id: string;
  name: string;
  imagePath: string;
  imageUrl: string;
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

type ProductionFrameAnimation = {
  prompt: string;
  durationSeconds: number;
  characterRefIds?: string[];
  queueForGeneration?: boolean;
  animationMode?: "auto" | "image_to_video" | "first_last_frame";
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
const THEME_STORAGE_KEY = "otg:production:theme";
const STORYBOARD_IMAGE_WORKFLOW_ID = "internal/production/qwen_image_edit_2511_storyboard";
const CHARACTER_REFERENCE_SLOTS = 5;

// PRODUCTION_STORYBOARD_SETUP_PATCH
const MAX_PRODUCTION_SCENES = 15;
const DEFAULT_SCENE_DURATION_SECONDS = 15;
const MAX_SCENE_DURATION_SECONDS = 30;
// OTG_PRODUCTION_ANIMATE_FIRST_LAST_FRAME_V1
const MIN_ANIMATE_FRAME_DURATION_SECONDS = 3;
const MAX_ANIMATE_FRAME_DURATION_SECONDS = 15;
const DEFAULT_SCENE_IMAGE_COUNT = 4;
const MAX_SCENE_IMAGE_COUNT = 16;

const stages: Array<{ id: ProductionStage; label: string; description: string }> = [
  { id: "storyboard", label: "Storyboard", description: "Create scenes and images" },
  { id: "animate", label: "Animate", description: "Generate scene clips" },
  { id: "edit", label: "Edit", description: "Trim, audio, effects" },
  { id: "assemble", label: "Assemble", description: "Preview and export" },
];

const initialScenes: ProductionScene[] = [
  {
    id: "scene_001",
    title: "Scene 1",
    durationSeconds: DEFAULT_SCENE_DURATION_SECONDS,
    imageCount: DEFAULT_SCENE_IMAGE_COUNT,
    aspectRatio: "16:9",
    prompt: Array.from({ length: DEFAULT_SCENE_IMAGE_COUNT }, (_, index) => `Next Scene ${index + 1}: `).join("\n"),
    motionNotes: "",
    style: "Cinematic Fantasy",
    status: "pending_images",
    images: [],
    characterRefs: createCharacterSlots(),
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
    "15 second scene from 8 storyboard images: slow tracking shots, quiet stalking movement, subtle fog drift, glowing crystal reflections, tense cinematic pacing.",
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
      return { label: "Not Started", dot: "bg-white/35", text: "text-white/55" };
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

function createCharacterSlots(existing?: CharacterReference[]) {
  return Array.from({ length: CHARACTER_REFERENCE_SLOTS }, (_, index) => {
    const current = existing?.[index];
    return {
      id: current?.id || `character_${index + 1}`,
      label: current?.label || `Character ${index + 1}`,
      fileName: current?.fileName,
      previewUrl: current?.previewUrl,
      sourceCharacterId: current?.sourceCharacterId,
      sourceCharacterName: current?.sourceCharacterName,
      referenceAudioPath: current?.referenceAudioPath,
    };
  });
}

function extractNextScenePrompts(raw: string) {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const prompts: string[] = [];

  for (const line of lines) {
    if (/^Next Scene\s+\d+\s*:/i.test(line)) {
      prompts.push(line);
    } else if (prompts.length) {
      prompts[prompts.length - 1] = `${prompts[prompts.length - 1]} ${line}`.replace(/\s+/g, " ").trim();
    }
  }

  return prompts;
}

function storyboardFramePrompt(scene: ProductionScene, frameIndex: number) {
  const explicitPrompts = extractNextScenePrompts(scene.prompt);
  if (explicitPrompts[frameIndex]) return explicitPrompts[frameIndex];

  const total = Math.max(1, scene.imageCount);
  const position = total === 1 ? 0 : frameIndex / (total - 1);
  const beat =
    position < 0.2
      ? "opening establishing frame"
      : position < 0.4
        ? "early action frame"
        : position < 0.65
          ? "middle tension frame"
          : position < 0.85
            ? "late escalation frame"
            : "final transition frame";

  return [
    `Next Scene ${frameIndex + 1}:`,
    `The camera creates a ${beat} for this ${scene.durationSeconds.toFixed(1)} second scene; ${scene.prompt.trim()}`,
    scene.motionNotes.trim() ? scene.motionNotes.trim() : "",
    "Identity/Face lock: keep the same subject, outfit, environment, lighting, and visual style consistent.",
    `${scene.style || "realistic cinematic style"}.`,
    "No text, watermark, subtitles, UI, or logo.",
  ]
    .filter(Boolean)
    .join(" ");
}

function StageShell({ stage, active }: { stage: ProductionStage; active: ProductionStage }) {
  const content: Record<ProductionStage, { title: string; body: string; actions: string[] }> = {
    storyboard: {
      title: "Storyboard first",
      body: "Build every scene and approve the image set before moving into animation.",
      actions: ["Generate Images", "Regenerate Selected", "Lock Storyboard"],
    },
    animate: {
      title: "Animate approved scenes",
      body: "Use locked storyboard images as source material. Prompt editing stays back in Storyboard.",
      actions: ["Animate Scene", "Animate All Ready", "Approve Clip"],
    },
    edit: {
      title: "Edit generated clips",
      body: "Trim scene clips, add effects, voice, music, and scene-level polish after animation exists.",
      actions: ["Trim Clip", "Add Effects", "Add Audio"],
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
  const [activeStage, setActiveStage] = useState<ProductionStage>("storyboard");



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
  const [saveDetails, setSaveDetails] = useState("Production autosave is ready.");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [busySceneId, setBusySceneId] = useState("");
  const [scenes, setScenes] = useState<ProductionScene[]>(initialScenes);
  const [selectedSceneId, setSelectedSceneId] = useState(initialScenes[0]?.id || "");
  const [characterFiles, setCharacterFiles] = useState<Record<string, Record<number, File>>>({});
  // STORYBOARD_FROM_CHARACTERS_PATCH
  const [characterPickerSceneId, setCharacterPickerSceneId] = useState("");
  const [characterPickerSlotIndex, setCharacterPickerSlotIndex] = useState<number | null>(null);
  const [characterPickerItems, setCharacterPickerItems] = useState<CharacterLibraryPickerItem[]>([]);
  const [characterPickerLoading, setCharacterPickerLoading] = useState(false);
  const [characterPickerError, setCharacterPickerError] = useState("");
  const [characterPickerSelectingId, setCharacterPickerSelectingId] = useState("");
  const [productionVoiceModels, setProductionVoiceModels] = useState<ProductionVoiceModelOption[]>([]);
  const [productionUploadedVoiceOptions, setProductionUploadedVoiceOptions] = useState<ProductionVoiceModelOption[]>([]);
  const [productionVoiceModelsLoading, setProductionVoiceModelsLoading] = useState(false);
  const [productionVoiceModelsError, setProductionVoiceModelsError] = useState("");

  const selectedIndex = scenes.findIndex((scene) => scene.id === selectedSceneId);
  const selectedScene = scenes[selectedIndex] || scenes[0];
  const selectedSceneStoryboardStatusKey = selectedScene
    ? selectedScene.images.map((image) => `${image?.status || "empty"}:${image?.promptId || ""}`).join("|")
    : "";
  const selectedSceneAnimateStatusKey = selectedScene
    ? animateFrameClips(selectedScene).map((clip: any) => `${clip?.status || "empty"}:${clip?.promptId || ""}:${clip?.fileName || ""}`).join("|")
    : "";

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
    const promptIds = Array.from(new Set(clips.map((clip: any) => String(clip?.promptId || "").trim()).filter(Boolean)));
    const readyCount = clips.filter((clip: any) => clip?.status === "ready").length;

    if (!promptIds.length) {
      if (clips.length && readyCount >= clips.length) {
        setAnimateComfyProgress({
          ...emptyComfyProgressState(),
          readyToSync: false,
          percent: 100,
          label: "Frame clips synced.",
          completedPrompts: clips.length,
          totalPrompts: clips.length,
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
        const totalPrompts = Math.max(promptIds.length, clips.length || promptIds.length);
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
              ? "Comfy frame clips are complete. Run Sync Frame Clips."
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
  }, [activeStage, selectedScene?.id, selectedSceneAnimateStatusKey, animateGenerationRunId]);

  useEffect(() => {
    if (activeStage !== "edit") return;

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
      productionAnimateMode,
      exportPreset,
      snapshots: productionSnapshots.slice(0, 12),
      updatedAt: new Date().toISOString(),
      scenes,
    }),
    [activeStage, exportPreset, productionAnimateMode, productionSnapshots, projectTitle, scenes, selectedScene?.id, selectedSceneId]
  );

  const manifestPreview = useMemo(() => JSON.stringify(manifest, null, 2), [manifest]);

  function formatSaveTime(value: string) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }

  function persistProductionDraftSnapshot(snapshot: string, savedAt: string, mode: "manual" | "auto") {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, snapshot);
    setLastSavedAt(savedAt);
    setSaveState((current) => (mode === "manual" || current !== "saved" ? (mode === "manual" ? "saved" : "autosaved") : current));
    setSaveDetails(
      `${mode === "manual" ? "Saved" : "Auto-saved"} ${scenes.length} scene${scenes.length === 1 ? "" : "s"}, ${totals.images} image slot${totals.images === 1 ? "" : "s"}, page ${stages.findIndex((stage) => stage.id === activeStage) + 1} of ${stages.length}.`
    );
  }

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);

      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<ProductionManifest>;
      if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) return;
      setProjectTitle(String(parsed.projectTitle || "Untitled Production"));
      setActiveStage(parsed.activeStage && stages.some((stage) => stage.id === parsed.activeStage) ? parsed.activeStage : "storyboard");
      if (parsed.productionAnimateMode === "default" || parsed.productionAnimateMode === "director") {
        setProductionAnimateMode(parsed.productionAnimateMode);
      }
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
      setLastSavedAt(String(parsed.updatedAt || ""));
      setSaveState("autosaved");
      setSaveDetails("Restored your saved Production workspace exactly where it was left.");
      setNotice("Loaded saved Production workspace.");
    } catch {
      setSaveState("error");
      setSaveDetails("Saved draft could not be loaded. Your current browser storage may be unavailable or corrupted.");
      setNotice("Saved draft could not be loaded.");
    } finally {
      setDraftHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;
    const timer = window.setTimeout(() => {
      try {
        persistProductionDraftSnapshot(manifestPreview, manifest.updatedAt, "auto");
      } catch (error) {
        setSaveState("error");
        setSaveDetails(error instanceof Error ? error.message : "Autosave failed. Use Save Project and check browser storage.");
      }
    }, 550);

    return () => window.clearTimeout(timer);
  }, [draftHydrated, manifestPreview, manifest.updatedAt]);

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

  function updateSelectedScene(patch: Partial<ProductionScene>) {
    if (!selectedScene) return;
    setScenes((prev) => prev.map((scene) => (scene.id === selectedScene.id ? { ...scene, ...patch } : scene)));
  }

  // PRODUCTION_STORYBOARD_MAIN_LAYOUT_TWEAKS_V2_PATCH
  // PRODUCTION_STORYBOARD_MAIN_LAYOUT_TWEAKS_V7_PATCH
  function visibleCharacterReferenceSlotCount(scene: ProductionScene | null | undefined) {
    const usedCount = (scene?.characterRefs || []).filter((ref) => {
      const maybeRef = ref as CharacterReference & { imagePath?: string };
      return Boolean(ref?.previewUrl || ref?.fileName || maybeRef?.imagePath);
    }).length;

    return Math.max(
      1,
      Math.min(
        CHARACTER_REFERENCE_SLOTS,
        Math.max(usedCount, scene?.characterRefSlotCount || 1)
      )
    );
  }

  function addCharacterReferenceSlot() {
    if (!selectedScene) return;

    const nextCount = Math.min(
      CHARACTER_REFERENCE_SLOTS,
      visibleCharacterReferenceSlotCount(selectedScene) + 1
    );

    updateSelectedScene({ characterRefSlotCount: nextCount });
  }

  function clampStoryboardDuration(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_SCENE_DURATION_SECONDS;
    return Math.max(1, Math.min(MAX_SCENE_DURATION_SECONDS, Math.round(value)));
  }

  function clampStoryboardImageCount(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_SCENE_IMAGE_COUNT;
    return Math.max(1, Math.min(MAX_SCENE_IMAGE_COUNT, Math.round(value)));
  }

  function normalizePromptLine(line: string) {
    // Preserve live textarea whitespace. Do not trim here or the spacebar appears broken.
    return String(line || "").replace(/^\s*next\s+scene\s*\d*\s*:\s*/i, "");
  }

  function scenePromptLines(scene: ProductionScene | null | undefined, countOverride?: number) {
    const count = clampStoryboardImageCount(countOverride ?? scene?.imageCount ?? DEFAULT_SCENE_IMAGE_COUNT);
    const lines = Array.from({ length: count }, () => "");
    const rawLines = String(scene?.prompt || "").split(/\r?\n/);
    let activeIndex: number | null = null;
    let sawIndexedLine = false;

    rawLines.forEach((rawLine, fallbackIndex) => {
      const match = rawLine.match(/^\s*next\s+scene\s*(\d+)\s*:\s*(.*)$/i);
      if (match) {
        const nextIndex = Number(match[1]) - 1;
        activeIndex = nextIndex >= 0 && nextIndex < count ? nextIndex : null;
        sawIndexedLine = true;
        if (activeIndex !== null) lines[activeIndex] = match[2] || "";
        return;
      }

      if (sawIndexedLine) {
        if (activeIndex !== null && rawLine.trim()) {
          lines[activeIndex] = `${lines[activeIndex]} ${rawLine.trim()}`.replace(/\s+/g, " ").trim();
        }
        return;
      }

      if (fallbackIndex < count) lines[fallbackIndex] = normalizePromptLine(rawLine);
    });

    return lines;
  }

  function buildCompiledScenePrompt(lines: string[]) {
    return lines
      .map((line, index) => `Next Scene ${index + 1}: ${normalizePromptLine(line)}`)
      .join("\n");
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
      prompt: Array.from({ length: DEFAULT_SCENE_IMAGE_COUNT }, (_, index) => `Next Scene ${index + 1}: `).join("\n"),
      motionNotes: "",
      status: "pending_images" as SceneStatus,
      images: [],
      characterRefs: createCharacterSlots(),
    characterRefSlotCount: 1,
};
  }

  function handleNewProduction() {
    const currentTitle = projectTitle.trim();
    const nextTitle = window.prompt(
      "New production name",
      currentTitle && currentTitle !== "Untitled Production" ? currentTitle : ""
    );

    if (nextTitle === null) return;

    const cleanTitle = nextTitle.trim() || "Untitled Production";
    const firstScene = makeFreshProductionScene(0);

    setProjectTitle(cleanTitle);
    setActiveStage("storyboard");
    setScenes([firstScene]);
    setSelectedSceneId(firstScene.id);
    setCharacterFiles({});
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
      prompt: buildCompiledScenePrompt(currentLines),
    });
  }

  function updateSelectedScenePromptLine(lineIndex: number, value: string) {
    if (!selectedScene) return;

    const lines = scenePromptLines(selectedScene);
    lines[lineIndex] = normalizePromptLine(value);

    updateSelectedScene({
      prompt: buildCompiledScenePrompt(lines),
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
      setNotice("There are no character references to clear.");
      return;
    }
    if (!window.confirm("Clear all character references for this scene?")) return;

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
              characterRefs: createCharacterSlots(),
              characterRefSlotCount: 1,
            }
          : item
      )
    );
    setNotice("Cleared all character references for this scene.");
  }

  function characterReferenceSlotLabel(slotIndex: number) {
    return `Character ${slotIndex + 1}`;
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
          const imagePath = String(entry?.imagePath || "").trim();
          const name = String(entry?.name || entry?.title || entry?.label || `Character ${index + 1}`).trim();

          return {
            id: String(entry?.id || imagePath || name || index),
            name,
            imagePath,
            imageUrl: imagePath ? characterLibraryImageUrl(imagePath) : "",
            referenceAudioPath: entry?.referenceAudioPath ? String(entry.referenceAudioPath) : undefined,
          };
        })
        .filter((item) => {
          if (!item.imagePath || !item.imageUrl) return false;
          if (seen.has(item.imagePath)) return false;
          seen.add(item.imagePath);
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
    if (!characterPickerSceneId || characterPickerSlotIndex === null || !item.imageUrl) return;

    setCharacterPickerSelectingId(item.id);
    setCharacterPickerError("");

    try {
      const res = await fetch(item.imageUrl, {

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
    setNotice(`Cleared storyboard image ${imageIndex + 1}.`);
  }

  function clearAllStoryboardImages(sceneId: string) {
    const scene = scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    const hasImages = scene.images.some((image) => storyboardImageHasContent(image) || image?.status === "queued" || image?.status === "error");
    if (!hasImages) {
      setNotice("There are no storyboard images to clear.");
      return;
    }
    if (!window.confirm("Clear all storyboard images for this scene? Prompt text will stay in place.")) return;

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
    setNotice("Cleared all storyboard images for this scene. Prompt text was kept.");
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
        aria-label="Expanded storyboard image preview"
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
            <img src={row.url} alt={`${scene.title} storyboard image ${row.index + 1}`} className="max-h-[72vh] w-full object-contain" />
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
      persistProductionDraftSnapshot(manifestPreview, manifest.updatedAt, "manual");
      setNotice("Project saved. You can refresh or leave this page and return to the same scene and step.");
    } catch (error) {
      setSaveState("error");
      setSaveDetails(error instanceof Error ? error.message : "Could not save project.");
      setNotice(error instanceof Error ? error.message : "Could not save draft.");
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
    setSaveState("idle");
    setLastSavedAt("");
    setSaveDetails("Project was reset manually. Autosave will keep this new default draft.");
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
    const prompt = String(scene.prompt || "").trim();
    const { width, height } = aspectToSize(scene.aspectRatio);
    const body = new FormData();

    body.set("workflowId", STORYBOARD_IMAGE_WORKFLOW_ID);
    body.set("preset", STORYBOARD_IMAGE_WORKFLOW_ID);
    body.set("workflowLabel", "Qwen 2511 Storyboard Scene");
    body.set("title", `${projectTitle.trim() || "Production"} - ${scene.title}`);
    body.set("requestKind", "production-storyboard-scene");
    body.set("prompt", prompt);
    body.set("positivePrompt", prompt);
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

  async function generateSelectedSceneImages() {
    if (!selectedScene || busySceneId) return;

    const imageCount = clampStoryboardImageCount(selectedScene.imageCount);
    const sceneId = selectedScene.id;
    const promptLines = scenePromptLines(selectedScene, imageCount);
    const existingImages = Array.from({ length: imageCount }, (_, index) => selectedScene.images[index]);
    const targets = storyboardSlotGenerationTargets(selectedScene);
    const targetIndexes = targets.map((target) => target.index);
    const textOnlyTargets = targets.filter((target) => target.mode === "generate");
    const uploadedEditTargets = targets.filter((target) => target.mode === "edit_uploaded" && target.uploadedPath);

    if (!targets.length) {
      setNotice("Add prompt text to an empty slot or to an uploaded image slot before generating. Uploaded images with no prompt are skipped.");
      return;
    }

    const sceneCharacterFiles = characterFiles[sceneId] || {};

    setBusySceneId(sceneId);
    resetStoryboardGenerationProgress(targets.length);
    setNotice(`Submitting storyboard image job(s) for ${targets.length} prompted slot(s). Blank slots and uploaded images without prompts are skipped.`);

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

    updateSceneById(sceneId, {
      imageCount,
      status: "pending_images",
      images: queuedImages,
    });

    try {
      const promptIdsByIndex = new Map<number, string>();

      if (textOnlyTargets.length) {
        const prompt = buildCompiledScenePrompt(textOnlyTargets.map((target) => promptLines[target.index] || ""));
        const promptId = await submitStoryboardScene(
          {
            ...selectedScene,
            imageCount: textOnlyTargets.length,
            prompt,
            images: selectedScene.images.slice(),
          },
          sceneCharacterFiles
        );
        textOnlyTargets.forEach((target) => promptIdsByIndex.set(target.index, promptId));
      }

      for (const target of uploadedEditTargets) {
        const promptId = await submitStoryboardScene(
          {
            ...selectedScene,
            imageCount: 1,
            prompt: buildCompiledScenePrompt([promptLines[target.index] || ""]),
            images: selectedScene.images.slice(),
          },
          sceneCharacterFiles,
          { sourceImagePath: target.uploadedPath }
        );
        promptIdsByIndex.set(target.index, promptId);
      }

      updateSceneById(sceneId, {
        imageCount,
        status: "pending_images",
        images: queuedImages.map((image, index) =>
          targetIndexes.includes(index)
            ? {
                ...image,
                promptId: promptIdsByIndex.get(index),
                status: "queued" as const,
                approved: false,
                error: undefined,
                source: "generated" as const,
              }
            : image
        ),
      });

      setNotice(`Submitted ${new Set(promptIdsByIndex.values()).size} storyboard job(s) for ${targets.length} prompted slot(s). Use Sync Results after Comfy finishes.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not submit storyboard scene job.";
      setStoryboardComfyProgress({
        ...emptyComfyProgressState(),
        running: false,
        readyToSync: false,
        percent: 0,
        label: "Storyboard generation failed to start.",
        detail: message,
      });

      updateSceneById(sceneId, {
        imageCount,
        status: "pending_images",
        images: queuedImages.map((image, index) => ({
          ...image,
          status: index === targetIndexes[0] ? ("error" as const) : image.status,
          error: index === targetIndexes[0] ? message : undefined,
        })),
      });

      setNotice(message);
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

  async function syncSelectedSceneImages() {
    if (!selectedScene || busySceneId) return;

    const syncTargetIndexes = Array.from({ length: clampStoryboardImageCount(selectedScene.imageCount) }, (_, index) => index)
      .filter((index) => {
        const image = selectedScene.images[index];
        return Boolean(
          image?.promptId &&
            image.status === "queued" &&
            (image.editingUploadedSource || !storyboardImageHasContent({ ...image, status: image.status }))
        );
      });

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
          body: JSON.stringify({ promptId }),
        });

        const data = await res.json().catch(() => null);

        if (!res.ok || data?.ok === false) {
          const message = data?.error || data?.normalSyncError || `Sync failed (${res.status})`;
          setNotice(message);
          continue;
        }

        const directItems = Array.isArray(data?.items)
          ? data.items
              .map((item: any) => {
                const name = String(item?.name || item?.fileName || "").trim();
                const url = String(item?.url || "").trim();
                return name && url ? { name, url } : null;
              })
              .filter((item: { name: string; url: string } | null): item is { name: string; url: string } => Boolean(item))
          : [];

        const legacyItems =
          !directItems.length && Array.isArray(data?.saved)
            ? data.saved
                .map((name: unknown) => String(name || "").trim())
                .filter(Boolean)
                .map((name: string) => ({
                  name,
                  url: `/api/gallery/file?name=${encodeURIComponent(name)}`,
                }))
            : [];

        for (const item of [...directItems, ...legacyItems]) {
          if (!savedItems.some((existing) => existing.name === item.name)) savedItems.push(item);
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
        setNotice("No storyboard images were returned yet. Run Sync Results again after Comfy finishes.");
      } else if (ready >= expectedCount) {
        setNotice(`Mapped generated image(s) into the empty slots. All ${expectedCount} storyboard slots are ready.`);
        setStoryboardComfyProgress({
          ...emptyComfyProgressState(),
          running: false,
          readyToSync: false,
          percent: 100,
          label: "Storyboard images synced.",
          detail: "sync-complete",
        });
      } else {
        setNotice(`Mapped storyboard results into empty slots. ${ready}/${expectedCount} total slot(s) are ready.`);
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
    return createCharacterSlots(scene?.characterRefs)
      .filter((ref) => {
        const maybeRef = ref as CharacterReference & { imagePath?: string; description?: string };
        return Boolean(ref.previewUrl || ref.fileName || maybeRef.imagePath);
      })
      .map((ref, index) => {
        const maybeRef = ref as CharacterReference & { imagePath?: string; description?: string; name?: string };
        const fileName = String(ref.fileName || maybeRef.imagePath || "").trim();
        const previewUrl = String(ref.previewUrl || "").trim();
        const stableSource = `${index}_${fileName || maybeRef.imagePath || previewUrl || ref.id || `character_${index + 1}`}`;
        const stableId = stableSource
          .replace(/[^a-zA-Z0-9_.-]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 140) || `character_${index + 1}`;

        return {
          id: stableId,
          sourceId: ref.id,
          index,
          label: String(ref.label || maybeRef.name || `Character ${index + 1}`).trim(),
          fileName,
          previewUrl,
          description: String(maybeRef.description || ref.label || maybeRef.name || `Character ${index + 1}`).trim(),
        };
      });
  }







  function selectedAnimateCharacters(scene: ProductionScene | null | undefined, frameIndex: number) {
    const drafts = animateFrameDrafts(scene);
    const ids = new Set<string>(drafts[frameIndex]?.characterRefIds || []);
    return animateCharacterOptions(scene).filter((character) => ids.has(character.id));
  }

  function animateGlobalPromptForFrame(scene: ProductionScene | null | undefined, frameIndex: number) {
    const sceneTitle = String(scene?.title || "Scene").trim();
    const selectedCharacters = selectedAnimateCharacters(scene, frameIndex);
    const lines = [
      `Scene context: ${sceneTitle}.`,
      "Maintain visual continuity with the storyboard frame.",
    ];

    if (selectedCharacters.length) {
      lines.push(
        `Characters in this clip: ${selectedCharacters
          .map((character) => `${character.label}: ${character.description}`)
          .join("; ")}.`
      );
      lines.push("Preserve the selected characters' identity, outfit, proportions, and facial details.");
    } else {
      lines.push("No recurring character is intentionally present in this clip.");
    }

    return lines.join(" ");
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

  // PRODUCTION_ANIMATE_GENERATE_V1_PATCH

// OTG_PRODUCTION_DEFAULT_ANIMATE_USE_GENERATE_I2V_V1_START
  const PRODUCTION_DEFAULT_I2V_WORKFLOW_ID =
    process.env.NEXT_PUBLIC_OTG_PRODUCTION_DEFAULT_I2V_WORKFLOW_ID || "Create a Video from Images";
  const PRODUCTION_DEFAULT_I2V_WORKFLOW_LABEL =
    process.env.NEXT_PUBLIC_OTG_PRODUCTION_DEFAULT_I2V_WORKFLOW_LABEL || "Create a Video from Images";
  const PRODUCTION_FIRST_LAST_WORKFLOW_ID =
    process.env.NEXT_PUBLIC_OTG_PRODUCTION_FIRST_LAST_WORKFLOW_ID || "presets/Create First Image to Last Image Video";
  const PRODUCTION_FIRST_LAST_WORKFLOW_LABEL =
    process.env.NEXT_PUBLIC_OTG_PRODUCTION_FIRST_LAST_WORKFLOW_LABEL || "Create First to Last Image Video";

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
    if (requestKind && requestKind !== "production-default-image-to-video") return false;

    const workflowId = productionDefaultStrictWorkflowId(item);
    if (
      workflowId &&
      PRODUCTION_DEFAULT_I2V_WORKFLOW_ID &&
      workflowId !== PRODUCTION_DEFAULT_I2V_WORKFLOW_ID
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
      .map((clip, index) => (drafts[index]?.queueForGeneration !== false && clip?.promptId ? index : -1))
      .filter((index) => index >= 0);

    if (!frameClips.length) {
      setNotice("No frame clip slots found for this scene.");
      return;
    }

    if (!syncTargetIndexes.length) {
      setNotice("No queued Animate clips are waiting to sync. Check a frame as Queue and generate it first.");
      return;
    }

    setBusySceneId(sceneId);
    setNotice(`Syncing ${syncTargetIndexes.length} queued frame clip(s) from gallery output...`);

    try {
      const galleryItems = (await productionDefaultAnimateFetchGalleryItems())
        .filter(productionDefaultAnimateIsVideoItem)
        .sort((a, b) => productionDefaultStrictUpdatedAt(b) - productionDefaultStrictUpdatedAt(a));

      if (!galleryItems.length) {
        setNotice("No generated video clips found yet. Wait for Comfy to finish, then Sync Frame Clips again.");
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

    const sceneSnapshot = selectedScene;
    const sceneId = sceneSnapshot.id;
    const frames = storyboardFramesForAnimate(sceneSnapshot);
    const drafts = animateFrameDrafts(sceneSnapshot);
    const existingClips = animateFrameClips(sceneSnapshot);
    const expectedCount = clampStoryboardImageCount(sceneSnapshot.imageCount);
    const queuedFrameIndexes = drafts
      .map((draft, index) => (draft.queueForGeneration !== false && !isAnimateLastFrameConsumed(draft) ? index : -1))
      .filter((index) => index >= 0);
    const missingFrames = frames.filter((frame) => !frame.approved || !frame.url);

    if (missingFrames.length) {
      setNotice(`Approve and sync all storyboard images before animation. Missing ${missingFrames.length}/${expectedCount}.`);
      return;
    }

    if (!queuedFrameIndexes.length) {
      setNotice("No Animate frames are queued. Check at least one frame as Queue before generating.");
      return;
    }

    setBusySceneId(sceneId);
    resetAnimateGenerationProgress(queuedFrameIndexes.length);
    setNotice(`Submitting ${queuedFrameIndexes.length} queued LTX 2.3 image-to-video clip job(s).`);

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
        const lastFrame = isFirstLastFrame ? frames[pairedLastFrameIndex] : null;
        const selectedCharacters = selectedAnimateCharacters(sceneSnapshot, index);
        const firstUsableCharacter = selectedCharacters.find((character) => {
          const url = String(character.previewUrl || "");
          return url && !url.startsWith("blob:");
        });

        const indexImageUrl = firstUsableCharacter?.previewUrl || frame.url;
        const localPrompt = String(draft.prompt || "").trim();
        const globalPrompt = animateGlobalPromptForFrame(sceneSnapshot, index);

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

        const form = new FormData();
        form.append("workflowId", isFirstLastFrame ? PRODUCTION_FIRST_LAST_WORKFLOW_ID : PRODUCTION_DEFAULT_I2V_WORKFLOW_ID);
        form.append("preset", isFirstLastFrame ? PRODUCTION_FIRST_LAST_WORKFLOW_ID : PRODUCTION_DEFAULT_I2V_WORKFLOW_ID);
        form.append("workflowLabel", isFirstLastFrame ? PRODUCTION_FIRST_LAST_WORKFLOW_LABEL : PRODUCTION_DEFAULT_I2V_WORKFLOW_LABEL);
        form.append("requestKind", isFirstLastFrame ? "production-first-last-frame-video" : "production-default-image-to-video");
        form.append("title", isFirstLastFrame ? `${sceneSnapshot.title} - Clip ${index + 1} FF-LF` : `${sceneSnapshot.title} - Clip ${index + 1}`);
        form.append("prompt", `${globalPrompt}\n\n${localPrompt}`.trim());
        form.append("positivePrompt", `${globalPrompt}\n\n${localPrompt}`.trim());
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
        form.append("outputPrefix", outputPrefix);
        form.append("sceneId", sceneId);
        form.append("sceneTitle", sceneSnapshot.title);
        form.append("frameIndex", String(index));
        form.append("animationMode", isFirstLastFrame ? "first_last_frame" : "image_to_video");
        form.append("promptSourceFrameIndex", String(index));
        form.append("imageA", sourceFile, sourceFile.name);
        if (lastFrameFile) {
          form.append("imageB", lastFrameFile, lastFrameFile.name);
          form.append("lastFrameIndex", String(pairedLastFrameIndex));
        } else {
          form.append("image", sourceFile, sourceFile.name);
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
          animationMode: isFirstLastFrame ? "first_last_frame" : "image_to_video",
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

      setNotice(`Submitted ${queuedFrameIndexes.length} queued LTX 2.3 frame clip job(s). Use Sync Frame Clips after Comfy finishes.`);
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
      const url = String(
        image?.url ||
          (fileName ? `/api/gallery/file?name=${encodeURIComponent(fileName)}` : "")
      ).trim();

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
    const sourcePrompts = scenePromptLines(scene, expectedCount);
    const existing = scene?.animationFrames || [];
    const fallbackSeconds = defaultAnimateFrameDuration(scene);

    return Array.from({ length: expectedCount }, (_, index) => ({
      prompt: existing[index]?.prompt ?? sourcePrompts[index] ?? "",
      durationSeconds: clampAnimateFrameDuration(existing[index]?.durationSeconds ?? fallbackSeconds),
      characterRefIds: existing[index]?.characterRefIds || [],
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

  function updateAnimateFrameDraft(index: number, patch: Partial<ProductionFrameAnimation>) {
    if (!selectedScene) return;

    const frames = animateFrameDrafts(selectedScene);
    frames[index] = {
      ...frames[index],
      ...patch,
      durationSeconds: clampAnimateFrameDuration(patch.durationSeconds ?? frames[index].durationSeconds),
      queueForGeneration: patch.queueForGeneration ?? frames[index].queueForGeneration,
    };

    updateSelectedScene({ animationFrames: frames });
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
        prompt: String(drafts[frame.index]?.prompt || scene.prompt || "").trim(),
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

  function setAnimateNextSceneAsLastFrame(frameIndex: number, enabled: boolean) {
    if (!selectedScene) return;

    const frames = storyboardFramesForAnimate(selectedScene);
    const drafts = animateFrameDrafts(selectedScene);
    const nextIndex = frameIndex + 1;

    if (!enabled) {
      const pairedLastIndex = drafts[frameIndex]?.lastFrameIndex;
      drafts[frameIndex] = {
        ...drafts[frameIndex],
        animationMode: "image_to_video",
        firstFrameIndex: undefined,
        lastFrameIndex: undefined,
        promptSourceFrameIndex: undefined,
      };

      if (pairedLastIndex !== undefined && drafts[pairedLastIndex]?.consumedByFrameIndex === frameIndex) {
        drafts[pairedLastIndex] = {
          ...drafts[pairedLastIndex],
          timelineRole: "normal",
          consumedByFrameIndex: undefined,
          queueForGeneration: true,
        };
      }

      updateSelectedScene({ animationFrames: drafts });
      setNotice(`Unpaired Frame ${frameIndex + 1}. Frame ${nextIndex + 1} can animate independently again.`);
      return;
    }

    if (frameIndex >= frames.length - 1) {
      setNotice("The final Animate frame cannot use the next scene as a last frame.");
      return;
    }

    if (isAnimateLastFrameConsumed(drafts[frameIndex])) {
      setNotice(`Frame ${frameIndex + 1} is already being used as another clip's last frame. Unpair it first.`);
      return;
    }

    if (isAnimateLastFrameConsumed(drafts[nextIndex])) {
      setNotice(`Frame ${nextIndex + 1} is already being used as another clip's last frame.`);
      return;
    }

    if (!frames[frameIndex]?.url || !frames[nextIndex]?.url) {
      setNotice(`Frame ${frameIndex + 1} and Frame ${nextIndex + 1} both need approved images before pairing.`);
      return;
    }

    drafts[frameIndex] = {
      ...drafts[frameIndex],
      animationMode: "first_last_frame",
      firstFrameIndex: frameIndex,
      lastFrameIndex: nextIndex,
      promptSourceFrameIndex: frameIndex,
      timelineRole: "normal",
      consumedByFrameIndex: undefined,
      queueForGeneration: true,
    };
    drafts[nextIndex] = {
      ...drafts[nextIndex],
      animationMode: "image_to_video",
      timelineRole: "last_frame_for",
      consumedByFrameIndex: frameIndex,
      queueForGeneration: false,
      keepAsSeparateSceneAfterPairing: drafts[nextIndex]?.keepAsSeparateSceneAfterPairing ?? false,
    };

    updateSelectedScene({ animationFrames: drafts });
    setNotice(`Frame ${frameIndex + 1} will use Frame ${nextIndex + 1} as its last frame. Frame ${nextIndex + 1} is skipped by default.`);
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
      label: readyToSync ? "Comfy generation looks complete. Run Sync Results." : running ? "Comfy generation is running." : "",
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
    const sorted = sortStoryboardSavedItems(savedItems || []);
    const seen = new Set<string>();
    const unique: any[] = [];

    for (const item of sorted) {
      const key = storyboardSavedItemDedupeKey(item);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      unique.push(item);
    }

    return unique
      .slice(0, Math.max(expectedCount, unique.length))
      .sort((a, b) => {
        const an = storyboardSavedItemOrderNumber(a);
        const bn = storyboardSavedItemOrderNumber(b);
        if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
        if (Number.isFinite(an)) return -1;
        if (Number.isFinite(bn)) return 1;
        return 0;
      })
      .slice(0, expectedCount);
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
            <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/80">
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
              ? "Comfy appears finished. Click Sync Results to map one unique output into each storyboard slot."
              : storyboardComfyProgress.running
                ? storyboardComfyProgress.label || "Comfy is still generating. Sync Results should be used after it completes."
                : "If Comfy has finished, click Sync Results. The sync step now deduplicates temp and renamed copies."}
        </div>
      </div>
    );
  }

  function renderAnimateGenerationStatus(scene: ProductionScene | null | undefined) {
    const clips = animateFrameClips(scene);
    const total = clips.length;
    const ready = clips.filter((clip: any) => clip?.status === "ready").length;
    const queued = clips.filter((clip: any) => clip?.status === "queued" || clip?.promptId).length;
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
            <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-100/80">
              {ready >= total ? "Frame clips synced" : animateComfyProgress.readyToSync ? "Ready to sync clips" : "Animating frame clips"}
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
            ? "All frame clips are synced and ready for review."
            : animateComfyProgress.readyToSync
              ? "Comfy appears finished. Click Sync Frame Clips to import and map each clip."
              : animateComfyProgress.label || "ComfyUI is animating frame clips."}
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
    const directorImportedFrames = buildDirectorImportedFrames();

    return (
      <section className="space-y-4">
        {renderExpandedAnimateClipModal(selectedScene, selectedScene ? animateFrameClips(selectedScene) : [])} {/* OTG_PRODUCTION_ANIMATE_CLIP_EXPAND_SCENE_REFERENCE_FIX_V1 */}
        <ProductionAnimateModeSwitch mode={productionAnimateMode} onChange={setProductionAnimateMode} />
        {productionAnimateMode === "director" ? (
          <ProductionDirectorModeUI
            productionId={selectedScene?.id || ""}
            productionName={selectedScene?.title || "Untitled Production"}
            importedFrames={directorImportedFrames}
          />
        ) : (
          renderDefaultAnimateStage()
        )}
      </section>
    );
  }
function renderDefaultAnimateStage() {
    const scene = selectedScene;
    const frames = storyboardFramesForAnimate(scene);
    const animateDrafts = animateFrameDrafts(scene);
    const frameClips = animateFrameClips(scene);
    const characterOptions = animateCharacterOptions(scene);
    const approvedFrames = frames.filter((frame) => frame.approved && frame.url);
    const expectedCount = clampStoryboardImageCount(scene?.imageCount ?? DEFAULT_SCENE_IMAGE_COUNT);
    const totalAnimateSeconds = animateTotalSeconds(scene);
    const readyClips = frameClips.filter((clip) => clip.status === "ready" && clip.url);
    const canPrepareClips = Boolean(scene && approvedFrames.length >= expectedCount);
    const queuedAnimateFrames = animateDrafts.filter((draft) => draft.queueForGeneration !== false).length;

    return (
      <section className="space-y-6 pb-28">
        <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/80">Animate</p>
              <h2 className="mt-2 text-2xl font-black text-white">Image-to-Video Clip Setup</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">
                Each storyboard image becomes its own LTX 2.3 image-to-video clip. Expand a frame, write its motion prompt, set seconds, and choose which storyboard characters are present.
              </p>
            </div>

            <div className="rounded-[14px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/70">
              <div className="font-black text-white">{scene?.title || "No scene selected"}</div>
              <div>Frames ready: {approvedFrames.length}/{expectedCount}</div>
              <div>Clips ready: {readyClips.length}/{expectedCount}</div>
              <div>Queued: {queuedAnimateFrames}/{expectedCount}</div>
              <div>Total clip time: {totalAnimateSeconds}s</div>
            </div>
          </div>

          {!canPrepareClips ? (
            <div className="mt-4 rounded-[14px] border border-amber-300/25 bg-amber-300/10 p-4 text-sm text-amber-100">
              Approve and sync all storyboard images for this scene before animation.
            </div>
          ) : (
            <div className="mt-4 rounded-[14px] border border-emerald-300/25 bg-emerald-300/10 p-4 text-sm text-emerald-100">
              Storyboard frames are ready. Each frame will submit one Generate-page image-to-video job.
            </div>
          )}
        </div>

        <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-white/45">Ordered Frames</p>
              <h3 className="text-lg font-black text-white">Frame Animation Prompts</h3>
              <p className="mt-1 text-sm text-white/55">
                Expand each frame, inspect the image, choose included characters, then write exact motion instructions and clip length.
              </p>
            </div>
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-black text-white/60">
              {queuedAnimateFrames} queued image-to-video job{queuedAnimateFrames === 1 ? "" : "s"}
            </span>
          </div>

          <div className="space-y-3">
            {frames.map((frame) => {
              const draft = animateDrafts[frame.index];
              const clip = frameClips[frame.index];
              const selectedIds = new Set(draft.characterRefIds || []);
              const globalPromptPreview = animateGlobalPromptForFrame(scene, frame.index);
              const isQueuedForGeneration = draft.queueForGeneration !== false;
              const pairedLastFrameIndex = draft.animationMode === "first_last_frame" ? draft.lastFrameIndex : undefined;
              const isFirstLastFrame = pairedLastFrameIndex === frame.index + 1;
              const consumedByFrameIndex = draft.consumedByFrameIndex;
              const isConsumedLastFrame = isAnimateLastFrameConsumed(draft);
              const nextFrame = frames[frame.index + 1];

              return (
                <details key={frame.index} className={isConsumedLastFrame ? "overflow-hidden rounded-[16px] border border-purple-300/20 bg-purple-950/20 opacity-70" : "overflow-hidden rounded-[16px] border border-white/10 bg-black/20"}>
                  <summary className="grid cursor-pointer list-none gap-3 p-3 md:grid-cols-[220px_1fr_auto] md:items-center">
                    <div className="relative aspect-video overflow-hidden rounded-[12px] bg-white/5">
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
                          onChange={(event) => updateAnimateFrameDraft(frame.index, { queueForGeneration: event.target.checked })}
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
                        <span className="rounded-full bg-white/5 px-2 py-1 text-xs font-black text-white/55">
                          {draft.durationSeconds}s
                        </span>
                        <span className="rounded-full bg-white/5 px-2 py-1 text-xs font-black text-white/55">
                          Characters: {selectedIds.size}
                        </span>
                        <span className="rounded-full bg-white/5 px-2 py-1 text-xs font-black text-white/55">
                          Clip: {clip.status}
                        </span>
                        <span className={isQueuedForGeneration ? "rounded-full bg-cyan-300/15 px-2 py-1 text-xs font-black text-cyan-200" : "rounded-full bg-white/5 px-2 py-1 text-xs font-black text-white/45"}>
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
                      <div className="truncate rounded-[12px] border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/50">
                        {frame.fileName || "No source file"}
                      </div>

                      <div className="rounded-[14px] border border-white/10 bg-white/[0.03] p-3">
                        <div className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                          Characters Present
                        </div>

                        {characterOptions.length ? (
                          <div className="mt-3 space-y-2">
                            {characterOptions.map((character) => (
                              <label
                                key={character.id}
                                className="flex cursor-pointer items-center gap-3 rounded-[12px] border border-white/10 bg-black/20 p-2"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(character.id)}
                                  onChange={(event) => toggleAnimateFrameCharacter(frame.index, character.id, event.target.checked)}
                                  onClick={(event) => event.stopPropagation()}
                                  className="h-4 w-4"
                                />
                                <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[10px] border border-white/10 bg-white/5 text-xs font-black text-white/45">
                                  {character.previewUrl ? (
                                    <img src={character.previewUrl} alt={character.label} className="h-full w-full object-cover" />
                                  ) : (
                                    character.index + 1
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-black text-white">{character.label}</div>
                                  <div className="truncate text-xs text-white/45">{character.fileName || "Storyboard reference"}</div>
                                </div>
                              </label>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm leading-6 text-white/50">
                            No storyboard character references are available for this scene.
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
                          onChange={(event) => updateAnimateFrameDraft(frame.index, { prompt: event.target.value })}
                          rows={6}
                          className="mt-2 w-full resize-y rounded-[14px] border border-white/10 bg-black/30 p-3 text-sm leading-6 text-white outline-none focus:border-cyan-300/50"
                          placeholder={`Describe how frame ${frame.index + 1} should move. Include camera motion, subject motion, speed, mood, and what must stay consistent.`}
                        />
                      </label>

                      <label className="block max-w-[220px]">
                        <span className="text-xs font-black uppercase tracking-[0.18em] text-white/45">
                          Clip Duration - {draft.durationSeconds}s
                        </span>
                        <input
                          type="range"
                          min={MIN_ANIMATE_FRAME_DURATION_SECONDS}
                          max={MAX_ANIMATE_FRAME_DURATION_SECONDS}
                          step={1}
                          value={draft.durationSeconds}
                          onChange={(event) => updateAnimateFrameDraft(frame.index, { durationSeconds: Number(event.target.value) })}
                          className="mt-2 w-full accent-cyan-300"
                        />
                        <div className="mt-1 flex justify-between text-[11px] font-black uppercase tracking-[0.16em] text-white/35">
                          <span>{MIN_ANIMATE_FRAME_DURATION_SECONDS}s</span>
                          <span>{MAX_ANIMATE_FRAME_DURATION_SECONDS}s</span>
                        </div>
                      </label>

                      <div className="rounded-[14px] border border-purple-300/20 bg-purple-300/10 p-3">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="text-xs font-black uppercase tracking-[0.18em] text-purple-100/70">
                              First-frame / Last-frame Pair
                            </div>
                            <p className="mt-1 text-sm leading-6 text-purple-50/75">
                              Use Frame {frame.index + 1} as the first frame and Frame {frame.index + 2} as the last frame. Prompt stays from Frame {frame.index + 1}.
                            </p>
                          </div>
                          {isFirstLastFrame ? (
                            <button
                              type="button"
                              onClick={() => setAnimateNextSceneAsLastFrame(frame.index, false)}
                              className="rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-xs font-black text-white"
                            >
                              Unpair
                            </button>
                          ) : (
                            <label className="flex cursor-pointer items-center gap-2 rounded-[12px] border border-purple-300/25 bg-black/20 px-3 py-2 text-xs font-black text-purple-50">
                              <input
                                type="checkbox"
                                checked={false}
                                disabled={frame.index >= frames.length - 1 || isConsumedLastFrame}
                                onChange={(event) => {
                                  if (event.target.checked) setAnimateNextSceneAsLastFrame(frame.index, true);
                                }}
                                className="h-4 w-4 accent-purple-300"
                              />
                              Use next scene as last frame
                            </label>
                          )}
                        </div>
                        {isFirstLastFrame ? (
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div className="overflow-hidden rounded-[12px] border border-white/10 bg-black/25">
                              <div className="px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-white/45">First: Frame {frame.index + 1}</div>
                              {frame.url ? <img src={frame.url} alt={`First frame ${frame.index + 1}`} className="aspect-video w-full object-cover" /> : null}
                            </div>
                            <div className="overflow-hidden rounded-[12px] border border-white/10 bg-black/25">
                              <div className="px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-white/45">Last: Frame {Number(pairedLastFrameIndex) + 1}</div>
                              {nextFrame?.url ? <img src={nextFrame.url} alt={`Last frame ${Number(pairedLastFrameIndex) + 1}`} className="aspect-video w-full object-cover" /> : (
                                <div className="flex aspect-video items-center justify-center text-xs text-white/35">Missing last frame</div>
                              )}
                            </div>
                          </div>
                        ) : isConsumedLastFrame ? (
                          <p className="mt-3 rounded-[12px] border border-purple-300/20 bg-black/20 px-3 py-2 text-sm text-purple-50/75">
                            This frame is consumed as the last frame for Frame {Number(consumedByFrameIndex) + 1}. Unpair that source frame to animate this one separately.
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

        <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-white/45">Review</p>
              <h3 className="text-lg font-black text-white">Generated Clips</h3>
              <p className="mt-1 text-sm text-white/55">
                Synced clips will appear here for review before moving to the next Production step. Double-click a clip to expand it.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!scene || Boolean(busySceneId) || queuedAnimateFrames < 1}
                onClick={generateSelectedFrameClips}
                className="rounded-[12px] bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Generate Frame Clips
              </button>
              <button
                type="button"
                disabled={!frameClips.some((clip, index) => animateDrafts[index]?.queueForGeneration !== false && clip.promptId) || Boolean(busySceneId)}
                onClick={syncSelectedFrameClips}
                className="rounded-[12px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Sync Frame Clips
              </button>
            </div>
          </div>

          {renderAnimateGenerationStatus(scene)}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {frameClips.map((clip, index) => {
              const draft = animateDrafts[index];
              const consumed = isAnimateLastFrameConsumed(draft);
              return (
              <div key={index} className={consumed ? "overflow-hidden rounded-[14px] border border-purple-300/20 bg-purple-950/20 opacity-70" : "overflow-hidden rounded-[14px] border border-white/10 bg-black/25"}>
                <div className="relative aspect-video bg-white/5">
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
                  <div className={clip.status === "ready" ? "font-black text-emerald-300" : clip.status === "error" ? "font-black text-red-300" : "font-black text-white/50"}>
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
      prompt: String(segment?.prompt || segment?.source || ""),
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
      prompt: String(range?.prompt || ""),
      strength: Math.max(0, Math.min(1, Number(range?.strength) || 0.5)),
    })) as ProductionEditVisualFxRange[];

    if (normalized.length) return normalized;

    if (legacyVisualFix?.enabled || legacyVisualFix?.prompt) {
      return [
        {
          id: "vfx_0",
          startSeconds: clampEditSeconds(Number(legacyVisualFix?.startSec), 0),
          endSeconds: clampEditSeconds(Number(legacyVisualFix?.endSec), durationSec),
          prompt: String(legacyVisualFix?.prompt || ""),
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
        prompt: String(music.prompt || ""),
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

    if (!manifest.sourceUrl && !manifest.sourceFileName) {
      setNotice("Select a generated source clip before rendering.");
      return;
    }

    if (manifest.expandMode === "freeze_start" || manifest.expandMode === "freeze_end") {
      setNotice("Freeze start/end expand modes are not supported by this render path yet. Use None or Slow down.");
      return;
    }

    if (manifest.expandMode === "slow_down" && manifest.playbackRate >= 1) {
      setNotice("Slow down requires playback rate below 1.");
      return;
    }

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
            playbackRate: manifest.playbackRate,
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

setNotice(`Rendered edited Clip ${row.index + 1}.`);
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
        <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/80">Edit</p>
              <h2 className="mt-2 text-2xl font-black text-white">Clip Edit Workbench</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">
                Finish each generated clip before Assemble. Keep edits per clip: trim, timed dubbing, music, sound effects, audio cleanup, and visual-fix notes.
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
                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-purple-100/80">Gallery</p>
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
                              className="relative rounded-[12px] border border-white/20 bg-black/65 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white/85 shadow-[0_14px_40px_rgba(0,0,0,0.35)] transition hover:border-purple-300/50 hover:text-purple-100 disabled:cursor-not-allowed disabled:opacity-35"
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
                <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs font-black text-white/50">
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
                              <span className={isSaved ? "shrink-0 rounded-full bg-emerald-300/15 px-2 py-1 text-[11px] font-black text-emerald-300" : "shrink-0 rounded-full bg-white/5 px-2 py-1 text-[11px] font-black text-white/45"}>
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
                <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-4">
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

                <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-4">
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

              <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-6">
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
                    <input
                      type="number"
                      min={0}
                      max={durationSec}
                      step={0.1}
                      value={draft.trimStartSeconds}
                      onChange={(event) => {
                        const range = clampEditRange(Number(event.target.value), draft.trimEndSeconds, durationSec);
                        updateEditDraft(activeKey, durationSec, { trimStartSeconds: range.start, trimEndSeconds: range.end, status: "draft" });
                      }}
                      className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">End seconds</span>
                    <input
                      type="number"
                      min={0}
                      max={durationSec}
                      step={0.1}
                      value={draft.trimEndSeconds}
                      onChange={(event) => {
                        const range = clampEditRange(draft.trimStartSeconds, Number(event.target.value), durationSec);
                        updateEditDraft(activeKey, durationSec, { trimStartSeconds: range.start, trimEndSeconds: range.end, status: "draft" });
                      }}
                      className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Playback rate</span>
                    <input
                      type="number"
                      min={0.25}
                      max={2}
                      step={0.05}
                      value={draft.playbackRate}
                      onChange={(event) => updateEditDraft(activeKey, durationSec, { playbackRate: Math.max(0.25, Math.min(2, Number(event.target.value) || 1)), status: "draft" })}
                      className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Expand mode</span>
                    <select
                      value={draft.expandMode}
                      onChange={(event) => updateEditDraft(activeKey, durationSec, { expandMode: event.target.value as ProductionClipEditManifest["expandMode"], status: "draft" })}
                      className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50"
                    >
                      <option value="none" className="bg-slate-950">None</option>
                      <option value="freeze_start" className="bg-slate-950">Freeze start</option>
                      <option value="freeze_end" className="bg-slate-950">Freeze end</option>
                      <option value="slow_down" className="bg-slate-950">Slow down</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Voice Dubbing</p>
                    <h3 className="text-lg font-black text-white">Timed voice conversion</h3>
                    <p className="mt-1 max-w-2xl text-xs leading-5 text-white/50">
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

                <div className="mt-3 rounded-[12px] border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/55">
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
                                <option key={character.id} value={character.id} className="bg-slate-950">
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
                            <label className="block text-xs text-white/55">
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
                            <label className="block text-xs text-white/55">
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
                <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-6">
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
                          <p className="mt-1 text-xs leading-5 text-white/50">Uses the selected clip audio as a 4-second style reference, then saves the generated music into the gallery for render.</p>
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
                        <p className="mt-2 text-xs font-bold text-white/58">{aceMusicStatusByClipKey[activeKey]}</p>
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

                <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-6">
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
                          <div className="rounded-[10px] border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/55">
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
                                : "border-white/10 bg-black/20 text-white/55"
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
                                : "border-white/10 bg-black/20 text-white/55"
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
                <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-6">
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

                    <div className="rounded-[12px] border border-white/10 bg-black/20 p-3 text-xs leading-5 text-white/50">
                      Render supports trim, audio cleanup, timed voice, music, SFX, and optional LTX visual FX.
                    </div>
                  </div>
                </div>

                <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-6">
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

              <details className="rounded-[18px] border border-white/10 bg-white/[0.04] p-6">
                <summary className="cursor-pointer text-sm font-black uppercase tracking-[0.18em] text-white/55">Edit Manifest Preview</summary>
                <pre className="mt-3 max-h-80 overflow-auto rounded-[14px] bg-black/40 p-4 text-xs leading-5 text-cyan-50/80">{JSON.stringify(draft, null, 2)}</pre>
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
    setProductionAnimateMode(next.productionAnimateMode || "default");
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
                  <span className="text-xs font-black text-white/55">{item.done}/{item.total}</span>
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
    setNotice("Stitching Assemble timeline with selected transitions...");

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
      const outputLibrary = [result, ...(selectedScene.assembledOutputs || [])].slice(0, 12);
      setAssembleResult(result);
      updateSelectedScene({
        assembleTransitions: transitions,
        assembledVideoUrl: result.videoUrl,
        assembledVideoPath: result.videoPath,
        assembledOutputs: outputLibrary,
        exportPreset,
        status: "complete",
      });
      setNotice(`Assembled timeline is ready. Applied ${result.transitionsApplied} transition${result.transitionsApplied === 1 ? "" : "s"}.`);
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

                <div className="mt-3 space-y-1 text-xs text-white/55">
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
          <summary className="cursor-pointer text-sm font-black uppercase tracking-[0.18em] text-white/55">Assemble Source Manifest</summary>
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
      </section>
    );
  }
// OTG_PRODUCTION_ASSEMBLE_EDIT_HANDOFF_V1_END
// OTG_PRODUCTION_EDIT_WORKBENCH_V1_END
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
              if (previousStage) setActiveStage(previousStage.id);
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
                onClick={() => setActiveStage(stage.id)}
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

          <button
            type="button"
            disabled={!nextStage}
            onClick={() => {
              if (nextStage) setActiveStage(nextStage.id);
            }}
            className="rounded-[12px] bg-violet-600 px-4 py-3 text-sm font-black text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next{nextStage ? `: ${nextStage.label}` : ""}
          </button>
        </div>

        <div className="mt-3 text-center text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
          Page {currentIndex >= 0 ? currentIndex + 1 : 1} of {stages.length}
        </div>
      </nav>
    );
  }
// OTG_PRODUCTION_STAGE_BOTTOM_NAV_V1_END
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
      <header className="border-b border-slate-200 bg-white px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-600">Production Workflow</p>
            <input
              value={projectTitle}
              onChange={(event) => setProjectTitle(event.target.value)}
              className="mt-1 w-full max-w-xl rounded-[8px] border border-transparent bg-transparent px-0 py-1 text-2xl font-black tracking-tight text-slate-950 outline-none hover:border-slate-200 hover:px-2 focus:border-violet-300 focus:bg-white focus:px-2"
              aria-label="Project title"
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex items-center gap-2 rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} production theme`}
            >
              <span className={classNames("relative h-5 w-9 rounded-full border", theme === "dark" ? "border-violet-300 bg-violet-600" : "border-slate-300 bg-slate-100")}>
                <span className={classNames("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm", theme === "dark" ? "left-4" : "left-0.5")} />
              </span>
              {theme === "light" ? "Light" : "Dark"}
            </button>
            <button type="button" onClick={handleNewProduction} className="rounded-[8px] border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-bold text-violet-700">New</button>
            <button
              type="button"
              onClick={saveDraft}
              className="rounded-[10px] border border-emerald-300 bg-emerald-500 px-4 py-2 text-sm font-black text-white shadow-[0_10px_30px_rgba(16,185,129,0.28)] transition hover:bg-emerald-600"
            >
              Save Project
            </button>
            <button type="button" onClick={resetDraft} className="rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">Reset</button>
          </div>
        </div>
        <div
          className={classNames(
            "mt-4 rounded-[12px] border px-4 py-3 shadow-sm",
            saveState === "saved"
              ? "border-emerald-300 bg-emerald-50"
              : saveState === "error"
                ? "border-rose-300 bg-rose-50"
                : "border-cyan-200 bg-cyan-50"
          )}
          aria-live="polite"
        >
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div
                className={classNames(
                  "flex items-center gap-2 text-sm font-black",
                  saveState === "saved" ? "text-emerald-700" : saveState === "error" ? "text-rose-700" : "text-cyan-800"
                )}
              >
                <span
                  className={classNames(
                    "h-3 w-3 rounded-full",
                    saveState === "saved" ? "bg-emerald-500" : saveState === "error" ? "bg-rose-500" : "bg-cyan-500"
                  )}
                />
                {saveState === "saved"
                  ? "Project saved"
                  : saveState === "error"
                    ? "Save needs attention"
                    : "Autosave is protecting this project"}
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-600">
                {saveDetails}
                {lastSavedAt ? ` Last saved ${formatSaveTime(lastSavedAt)}.` : ""}
              </p>
            </div>
            <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
              {selectedScene ? `${selectedScene.title} - ${stages.find((stage) => stage.id === activeStage)?.label || "Storyboard"}` : "No scene selected"}
            </div>
          </div>
        </div>
        {notice ? <p className="mt-3 text-sm font-semibold text-slate-500">{notice}</p> : null}

        <nav className="mt-5 grid gap-2 md:grid-cols-4">
          {stages.map((stage, index) => {
            const active = activeStage === stage.id;
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => setActiveStage(stage.id)}
                className={classNames(
                  "flex items-center gap-3 rounded-[8px] border px-4 py-3 text-left transition",
                  active ? "border-violet-500 bg-violet-600 text-white shadow-sm" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
                )}
              >
                <span className={classNames("grid h-7 w-7 place-items-center rounded-full text-xs font-black", active ? "bg-white/18 text-white" : "bg-white text-slate-500")}>{index + 1}</span>
                <span>
                  <span className="block text-sm font-black">{stage.label}</span>
                  <span className={classNames("block text-xs", active ? "text-white/78" : "text-slate-500")}>{stage.description}</span>
                </span>
              </button>
            );
          })}
        </nav>
      </header>

      <div
        className={[
          "grid min-h-[720px] grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)]",
          activeStage === "edit"
            ? "xl:grid-cols-[280px_minmax(0,1fr)]"
            : "xl:grid-cols-[280px_minmax(0,1fr)_280px]",
        ].join(" ")}
      >
        <aside className="border-b border-slate-200 bg-white p-4 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">Scenes</h2>
              <p className="mt-1 text-xs text-slate-500">{readyScenes}/{scenes.length} ready</p>
            </div>
            <button type="button" onClick={addSceneLimited} disabled={scenes.length >= MAX_PRODUCTION_SCENES} className="rounded-[8px] border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">Add</button>
          </div>

          <div className="mt-4 space-y-2">
            {scenes.map((scene, index) => {
              const meta = statusMeta(scene.status);
              const selected = scene.id === selectedScene?.id;
              return (
                <button
                  key={scene.id}
                  type="button"
                  onClick={() => setSelectedSceneId(scene.id)}
                  className={classNames(
                    "flex w-full gap-3 rounded-[8px] border p-2 text-left transition",
                    selected ? "border-violet-400 bg-violet-50" : "border-slate-200 bg-white hover:border-slate-300"
                  )}
                >
                  <div className={classNames("h-14 w-14 shrink-0 rounded-[8px] bg-gradient-to-br", thumbnailClass(index))} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black text-slate-950">{sceneNumber(index)} {scene.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{scene.durationSeconds.toFixed(1)}s - {scene.imageCount} images</div>
                    <div className={classNames("mt-1 flex items-center gap-1.5 text-xs font-bold", meta.text)}>
                      <span className={classNames("h-2 w-2 rounded-full", meta.dot)} />
                      {meta.label}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0 bg-slate-50 p-4 pb-32 md:p-6 md:pb-36">
          {activeStage === "storyboard" && selectedScene ? (
            <section className="space-y-5">
              {renderExpandedStoryboardImageModal(selectedScene)}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-2xl font-black tracking-tight text-slate-950">Scene {sceneNumber(selectedIndex)}</h2>
                    <input
                      value={selectedScene.title}
                      onChange={(event) => updateSelectedScene({ title: event.target.value })}
                      className="min-w-[220px] rounded-[8px] border border-transparent bg-transparent px-2 py-1 text-xl font-semibold text-slate-600 outline-none hover:border-slate-200 focus:border-violet-300 focus:bg-white"
                    />
                  </div>
                  <p className="mt-1 text-sm text-slate-500">Create and approve all images before animation.</p>
                  {renderStoryboardGenerationStatus(selectedScene)}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={duplicateScene} className="rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">Duplicate</button>
                  <button type="button" onClick={deleteScene} className="rounded-[8px] border border-rose-200 bg-white px-3 py-2 text-sm font-bold text-rose-600">Delete</button>
                </div>
              </div>




              <div className="rounded-[8px] border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">Storyboard Images</h3>
                    <div className="storyboard-image-count-controls flex items-center gap-2 rounded-[8px] border border-slate-200 bg-slate-50 px-2 py-1">
                      <div className="min-w-[44px] text-center text-sm font-black text-slate-700">
                        {selectedScene.imageCount}
                      </div>
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          aria-label="Increase storyboard image count"
                          onClick={() => updateSelectedSceneImageCount(selectedScene.imageCount + 1)}
                          disabled={selectedScene.imageCount >= MAX_SCENE_IMAGE_COUNT}
                          className="grid h-5 w-6 place-items-center rounded border border-slate-200 bg-white text-[10px] font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          {"\u2191"}
                        </button>
                        <button
                          type="button"
                          aria-label="Decrease storyboard image count"
                          onClick={() => updateSelectedSceneImageCount(selectedScene.imageCount - 1)}
                          disabled={selectedScene.imageCount <= 1}
                          className="grid h-5 w-6 place-items-center rounded border border-slate-200 bg-white text-[10px] font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          {"\u2193"}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => clearAllStoryboardImages(selectedScene.id)}
                      disabled={busySceneId === selectedScene.id || !selectedScene.images.some((image) => storyboardImageHasContent(image) || image?.status === "queued" || image?.status === "error")}
                      className="rounded-[8px] border border-rose-200 bg-white px-4 py-2 text-sm font-bold text-rose-600 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Clear All Images
                    </button>
                    <button
                      type="button"
                      onClick={generateSelectedSceneImages}
                      disabled={busySceneId === selectedScene.id || storyboardSlotGenerationTargets(selectedScene).length === 0}
                      className="rounded-[8px] bg-violet-600 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
                    >
                      {busySceneId === selectedScene.id ? "Working..." : "Generate Images"}
                    </button>
                    <button
                      type="button"
                      onClick={syncSelectedSceneImages}
                      disabled={busySceneId === selectedScene.id || !selectedScene.images.some((image) => image.status === "queued" && image.promptId)}
                      className="rounded-[8px] border border-slate-200 px-4 py-2 text-sm font-bold text-slate-500 disabled:opacity-55"
                    >
                      Sync Results
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {Array.from({ length: selectedScene.imageCount }, (_, index) => {
                    const img = selectedScene.images[index];
                    const state = img?.status || (img?.approved ? "ready" : "empty");
                    return (
                      <div key={`${selectedScene.id}-image-${index}`} className="group overflow-hidden rounded-[8px] border border-slate-200 bg-slate-100">
                        <div
                          className={classNames(
                            "relative aspect-video bg-gradient-to-br",
                            img?.url ? "cursor-zoom-in" : "",
                            img ? thumbnailClass(index) : "from-slate-100 to-slate-200"
                          )}
                          onDoubleClick={() => {
                            if (img?.url) setExpandedStoryboardImageIndex(index);
                          }}
                        >
                          {img?.url ? (
                            <button
                              type="button"
                              onClick={() => setExpandedStoryboardImageIndex(index)}
                              className="block h-full w-full"
                              aria-label={`Expand storyboard image ${index + 1}`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={img.url} alt={`${selectedScene.title} storyboard frame ${index + 1}`} className="h-full w-full object-cover" />
                              <span className="absolute bottom-2 right-2 rounded-full bg-black/65 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white opacity-0 transition group-hover:opacity-100">
                                Expand
                              </span>
                            </button>
                          ) : null}
                          <span className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-xs font-black text-white">{index + 1}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                          <span
                            title={img?.error || img?.promptId || undefined}
                            className={classNames(
                              "flex min-w-0 items-center gap-1.5 truncate font-bold",
                              state === "ready" ? "text-emerald-600" : state === "queued" ? "text-amber-600" : state === "error" ? "text-rose-600" : "text-slate-400"
                            )}
                          >
                            <span
                              className={classNames(
                                "h-2 w-2 shrink-0 rounded-full",
                                state === "ready" ? "bg-emerald-500" : state === "queued" ? "bg-amber-500" : state === "error" ? "bg-rose-500" : "bg-slate-300"
                              )}
                            />
                            {state === "ready" ? (img?.source === "uploaded" ? "Uploaded" : "Approved") : state === "queued" ? "Queued" : state === "error" ? "Error" : "Empty"}
                          </span>
                          <span className="truncate text-slate-400">{img?.fileName || ""}</span>
                        </div>
                        <label className="mx-3 mb-3 flex cursor-pointer items-center justify-center rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:border-violet-300 hover:text-violet-700">
                          Upload Image
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            className="sr-only"
                            onChange={(event) => {
                              void uploadStoryboardImageSlot(selectedScene.id, index, event.target.files?.[0]);
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => clearStoryboardImageSlot(selectedScene.id, index)}
                          disabled={!img || (!storyboardImageHasContent(img) && img.status !== "queued" && img.status !== "error")}
                          className="mx-3 mb-3 flex w-[calc(100%-1.5rem)] items-center justify-center rounded-[8px] border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Clear Image
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-4">
                  <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">Character References</div>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          Optional. Add 1 to 5 reference images before writing scene prompts.
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-slate-400">
                          {visibleCharacterReferenceSlotCount(selectedScene)}/{CHARACTER_REFERENCE_SLOTS}
                        </span>
                        <button
                          type="button"
                          onClick={addCharacterReferenceSlot}
                          disabled={visibleCharacterReferenceSlotCount(selectedScene) >= CHARACTER_REFERENCE_SLOTS}
                          className="rounded-[8px] border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          + Add Character
                        </button>
                        <button
                          type="button"
                          onClick={() => clearAllCharacterReferences(selectedScene.id)}
                          disabled={!createCharacterSlots(selectedScene.characterRefs).some((ref) => ref.fileName || ref.previewUrl || ref.sourceCharacterId || ref.referenceAudioPath)}
                          className="rounded-[8px] border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Clear All
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {createCharacterSlots(selectedScene.characterRefs).slice(0, visibleCharacterReferenceSlotCount(selectedScene)).map((ref, index) => (
                        <div key={ref.id} className="rounded-[8px] border border-slate-200 bg-white p-2">
                          <div className="flex items-center gap-2">
                            <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[8px] border border-slate-200 bg-slate-100 text-xs font-black text-slate-400">
                              {ref.previewUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={ref.previewUrl} alt={ref.label} className="h-full w-full object-cover" />
                              ) : (
                                index + 1
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <input
                                value={ref.label}
                                onChange={(event) => updateCharacterReference(selectedScene.id, index, { label: event.target.value })}
                                className="w-full rounded-[8px] border border-slate-200 px-2 py-1 text-xs font-bold outline-none focus:border-violet-300"
                                aria-label={`Character ${index + 1} label`}
                              />
                              <div className="mt-1 truncate text-[11px] text-slate-500">{ref.fileName || "No image selected"}</div>
                            </div>
                          </div>
                          <div className="mt-2 flex gap-2">
                            <label className="flex-1 cursor-pointer rounded-[8px] border border-slate-200 px-2 py-1.5 text-center text-xs font-bold text-slate-600">
                              Choose
                              <input
                                type="file"
                                accept="image/*"
                                className="sr-only"
                                onChange={(event) => setCharacterReferenceFile(selectedScene.id, index, event.target.files?.[0] || null)}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => openCharacterPicker(selectedScene.id, index)}
                              className="flex-1 rounded-[8px] border border-cyan-300/40 bg-cyan-50 px-2 py-1.5 text-center text-xs font-bold text-cyan-700 transition hover:bg-cyan-100"
                            >
                              From Characters
                            </button>
                            <button
                              type="button"
                              onClick={() => setCharacterReferenceFile(selectedScene.id, index, null)}
                              className="rounded-[8px] border border-slate-200 px-2 py-1.5 text-xs font-bold text-slate-500"
                            >
                              Clear
                            </button>
                            <button
                              type="button"
                              onClick={() => removeCharacterReferenceSlot(selectedScene.id, index)}
                              className="rounded-[8px] border border-rose-200 px-2 py-1.5 text-xs font-bold text-rose-600"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <section className="rounded-[8px] border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">
                          Scene {selectedIndex + 1} Setup
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          Each image gets its own prompt. The compiled Next Scene lines below are what generation uses.
                        </p>
                      </div>
                      <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-500">
                        Status: {statusMeta(selectedScene.status).label}
                      </div>
                    </div>




                    <div className="mt-5">
                      <div className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">Scene Prompts</div>
                      <div className="mt-3 grid gap-3">
                        {scenePromptLines(selectedScene).map((line, index) => (
                          <label key={`${selectedScene.id}_scene_prompt_${index}`} className="block rounded-[8px] border border-slate-200 bg-slate-50 p-3">
                            <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                              Scene Prompt {index + 1}
                            </span>
                            <textarea
                              value={line}
                              onChange={(event) => updateSelectedScenePromptLine(index, event.target.value)}
                              rows={3}
                              className="mt-2 w-full resize-none rounded-[8px] border border-slate-200 px-3 py-2 text-sm leading-6 text-slate-700 outline-none focus:border-violet-300"
                              placeholder={`Next Scene ${index + 1}: describe what image ${index + 1} should show.`}
                            />
                          </label>
                        ))}
                      </div>
                    </div>

                    <details className="mt-5 rounded-[8px] border border-slate-200 bg-slate-50 p-3">
                      <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                        Compiled Scene Prompt / Next Scene Lines
                      </summary>
                      <textarea
                        value={selectedScene.prompt}
                        onChange={(event) => updateSelectedScene({ prompt: event.target.value })}
                        rows={6}
                        className="mt-3 w-full resize-none rounded-[8px] border border-slate-200 px-3 py-3 text-sm leading-6 text-slate-700 outline-none focus:border-violet-300"
                        placeholder="Next Scene 1: ..."
                      />
                    </details>
                  </section>
                </div>
                <div className="grid gap-3">
                  <button type="button" disabled className="rounded-[8px] border border-slate-200 bg-white px-4 py-3 text-left text-sm font-black text-slate-400">Review Storyboard</button>
                  <button type="button" disabled className="rounded-[8px] bg-violet-600 px-4 py-3 text-left text-sm font-black text-white disabled:opacity-60">Lock Storyboard & Continue</button>
                </div>
              </div>

              <details className="rounded-[8px] border border-slate-200 bg-white p-4">
                <summary className="cursor-pointer text-sm font-black uppercase tracking-[0.14em] text-slate-500">Production Manifest Preview</summary>
                <pre className="mt-3 max-h-72 overflow-auto rounded-[8px] bg-slate-950 p-4 text-xs leading-5 text-slate-100">{manifestPreview}</pre>
              </details>
            </section>
          ) : activeStage === "animate" ? (renderAnimateStage()) : activeStage === "edit" ? (renderEditStage()) : activeStage === "assemble" ? (renderAssembleStage()) : (<StageShell stage={activeStage} active={activeStage} />)}
          {renderProductionStageNavigation()}
        </main>

        <aside className={["border-t border-slate-200 bg-white p-4 xl:border-l xl:border-t-0", activeStage === "edit" ? "hidden" : ""].join(" ")}>
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-violet-600">Scene Properties</h2>
          {selectedScene ? (
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-xs font-bold text-slate-500">Title</span>
                <input value={selectedScene.title} onChange={(event) => updateSelectedScene({ title: event.target.value })} className="mt-1 w-full rounded-[8px] border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-300" />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-slate-500">Style</span>
                <select value={selectedScene.style} onChange={(event) => updateSelectedScene({ style: event.target.value })} className="mt-1 w-full rounded-[8px] border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-300">
                  <option>Cinematic Fantasy</option>
                  <option>Realistic Film</option>
                  <option>Anime Feature</option>
                  <option>Noir Trailer</option>
                </select>
              </label>
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
                            className="group overflow-hidden rounded-[14px] border border-slate-200 bg-white text-left transition hover:border-cyan-300 hover:bg-cyan-50 disabled:cursor-wait disabled:opacity-60"
                          >
                            <div className="aspect-square bg-slate-100">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={item.imageUrl}
                                alt={item.name}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            </div>
                            <div className="border-t border-slate-200 px-3 py-2">
                              <div className="truncate text-xs font-black text-slate-800">{item.name}</div>
                              {characterPickerSelectingId === item.id ? (
                                <div className="mt-1 text-[11px] font-bold text-cyan-700">Selecting...</div>
                              ) : null}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <label className="block">
                <span className="text-xs font-bold text-slate-500">Motion Notes</span>
                <textarea value={selectedScene.motionNotes} onChange={(event) => updateSelectedScene({ motionNotes: event.target.value })} rows={4} className="mt-1 w-full resize-none rounded-[8px] border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-300" placeholder="Slow push-in, subtle drift..." />
              </label>
              <div className="grid grid-cols-2 gap-3 rounded-[8px] border border-slate-200 bg-slate-50 p-3">
                <div>
                  <div className="text-xs font-bold text-slate-500">Total Scenes</div>
                  <div className="mt-1 text-lg font-black">{scenes.length}</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-500">Total Images</div>
                  <div className="mt-1 text-lg font-black">{totals.images}</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-500">Duration</div>
                  <div className="mt-1 text-lg font-black">{totals.duration.toFixed(1)}s</div>
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-500">Ready</div>
                  <div className="mt-1 text-lg font-black">{readyScenes}</div>
                </div>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
