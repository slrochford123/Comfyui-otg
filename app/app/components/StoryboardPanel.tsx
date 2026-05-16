"use client";

import { useEffect, useMemo, useState } from "react";

import ProductionAnimateModeSwitch, { type ProductionAnimateMode } from "./ProductionAnimateModeSwitch";
import ProductionDirectorModeUI, { type ProductionDirectorImportedFrame } from "./ProductionDirectorModeUI";
type ProductionStage = "storyboard" | "animate" | "edit" | "assemble";
// OTG_PRODUCTION_EDIT_WORKBENCH_V1_TYPES_START
type ProductionEditVoiceSegment = {
  id: string;
  character: string;
  voice: string;
  startSec: number;
  endSec: number;
  text: string;
  mode: "replace" | "overlay";
  volume: number;
};

type ProductionEditSfxSegment = {
  id: string;
  label: string;
  prompt: string;
  startSec: number;
  durationSec: number;
  volume: number;
};

type ProductionClipEditDraft = {
  trimStartSec: number;
  trimEndSec: number;
  playbackRate: number;
  extendMode: "none" | "freeze_start" | "freeze_end" | "slow_down";
  voiceSegments: ProductionEditVoiceSegment[];
  music: {
    enabled: boolean;
    source: "none" | "generate" | "library" | "upload";
    prompt: string;
    startSec: number;
    endSec: number;
    volume: number;
    fadeInSec: number;
    fadeOutSec: number;
    duckUnderDialogue: boolean;
  };
  sfxSegments: ProductionEditSfxSegment[];
  audioCleanup: {
    muteOriginal: boolean;
    removeOriginalMusic: boolean;
    enhanceSpeech: boolean;
    normalizeVolume: boolean;
  };
  visualFix: {
    enabled: boolean;
    startSec: number;
    endSec: number;
    prompt: string;
  };
  status: "draft" | "ready";
  updatedAt?: string;
};

type ProductionEditClipRow = {
  key: string;
  index: number;
  title: string;
  clip: any;
  frame: any;
  draft: any;
  sourceUrl: string;
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
};

type CharacterReference = {
  id: string;
  label: string;
  fileName?: string;
  previewUrl?: string;
};
type CharacterLibraryPickerItem = {
  id: string;
  name: string;
  imagePath: string;
  imageUrl: string;
};

type ProductionSceneClipStatus = "idle" | "queued" | "ready" | "error";

type ProductionSceneClip = {
  status: ProductionSceneClipStatus;
  promptId?: string;
  fileName?: string;
  url?: string;
  error?: string;
};
type ProductionFrameClipStatus = "idle" | "queued" | "ready" | "error";

type ProductionFrameAnimation = {
  prompt: string;
  durationSeconds: number;
  characterRefIds?: string[];
};

type ProductionFrameClip = {
  status: ProductionFrameClipStatus;
  promptId?: string;
  fileName?: string;
  url?: string;
  error?: string;
  outputPrefix?: string;
  sourceFrameIndex?: number;
  requestedDurationSeconds?: number;
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
};

type ProductionManifest = {
  schemaVersion: 1;
  projectTitle: string;
  activeStage: ProductionStage;
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
  const [storyboardComfyProgress, setStoryboardComfyProgress] = useState<{
    running: boolean;
    readyToSync: boolean;
    percent: number | null;
    label: string;
    detail: string;
  }>({
    running: false,
    readyToSync: false,
    percent: null,
    label: "",
    detail: "",
  });
  const [storyboardGenerationRunId, setStoryboardGenerationRunId] = useState(0); // OTG_PRODUCTION_STORYBOARD_PROGRESS_REFRESH_V1B
  const [selectedEditClipKey, setSelectedEditClipKey] = useState("");
  const [editDraftsByClipKey, setEditDraftsByClipKey] = useState<Record<string, ProductionClipEditDraft>>({});
  const [productionAnimateMode, setProductionAnimateMode] = useState<ProductionAnimateMode>("default");
  const [projectTitle, setProjectTitle] = useState("Untitled Production");
  const [notice, setNotice] = useState("");
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

  const selectedIndex = scenes.findIndex((scene) => scene.id === selectedSceneId);
  const selectedScene = scenes[selectedIndex] || scenes[0];
  const selectedSceneStoryboardStatusKey = selectedScene
    ? selectedScene.images.map((image) => `${image?.status || "empty"}:${image?.promptId || ""}`).join("|")
    : "";

  useEffect(() => {
    if (!selectedScene) return;

    const stats = storyboardImageSyncStats(selectedScene);
    if (!stats.hasQueued || stats.complete) {
      if (stats.complete) {
        setStoryboardComfyProgress({
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
      updatedAt: new Date().toISOString(),
      scenes,
    }),
    [activeStage, projectTitle, scenes]
  );

  const manifestPreview = useMemo(() => JSON.stringify(manifest, null, 2), [manifest]);

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
      setScenes(parsed.scenes as ProductionScene[]);
      setSelectedSceneId(parsed.scenes[0]?.id || "");
      setNotice("Loaded saved local draft.");
    } catch {
      setNotice("Saved draft could not be loaded.");
    }
  }, []);

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
    const rawLines = String(scene?.prompt || "")
      .split(/\r?\n/)
      .map((line) => normalizePromptLine(line))
      .filter(Boolean);

    return Array.from({ length: count }, (_, index) => rawLines[index] || "");
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
      updateCharacterReference(sceneId, slotIndex, { fileName: undefined, previewUrl: undefined });
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
  }  function characterReferenceSlotLabel(slotIndex: number) {
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
      window.localStorage.setItem(DRAFT_STORAGE_KEY, manifestPreview);
      setNotice("Draft saved locally on this device.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save draft.");
    }
  }

  function resetDraft() {
    setProjectTitle("Untitled Production");
    setActiveStage("storyboard");
    setScenes(initialScenes);
    setSelectedSceneId(initialScenes[0]?.id || "");
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
  async function submitStoryboardScene(scene: ProductionScene, sceneCharacterFiles: Record<number, File>) {
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

    Array.from({ length: CHARACTER_REFERENCE_SLOTS }, (_, index) => sceneCharacterFiles[index])
      .filter((file): file is File => !!file)
      .forEach((file, index) => {
        const key = ["imageA", "imageB", "imageC", "imageD", "imageE"][index];
        body.set(key, file, file.name);
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

    const fullPrompt = String(selectedScene.prompt || "").trim();

    if (!fullPrompt) {
      setNotice("Add scene prompts before generating storyboard images.");
      return;
    }

    const imageCount = clampStoryboardImageCount(selectedScene.imageCount);
    const sceneId = selectedScene.id;
    const sceneSnapshot = {
      ...selectedScene,
      imageCount,
      prompt: fullPrompt,
      images: selectedScene.images.slice(),
    };
    const sceneCharacterFiles = characterFiles[sceneId] || {};

    setBusySceneId(sceneId);
    resetStoryboardGenerationProgress(imageCount);
    setNotice(`Submitting one storyboard scene job for ${imageCount} image(s).`);

    const queuedImages = Array.from({ length: imageCount }, (_, index) => ({
      id: `${sceneId}_img_${index + 1}`,
      approved: false,
      status: "queued" as const,
      error: undefined,
    }));

    updateSceneById(sceneId, {
      imageCount,
      status: "pending_images",
      images: queuedImages,
    });

    try {
      const promptId = await submitStoryboardScene(sceneSnapshot, sceneCharacterFiles);

      updateSceneById(sceneId, {
        imageCount,
        status: "pending_images",
        images: queuedImages.map((image) => ({
          ...image,
          promptId,
          status: "queued" as const,
          approved: false,
          error: undefined,
        })),
      });

      setNotice(`Submitted one storyboard scene job for ${imageCount} image(s). Use Sync Results after Comfy finishes.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not submit storyboard scene job.";
      setStoryboardComfyProgress({
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
          status: index === 0 ? ("error" as const) : image.status,
          error: index === 0 ? message : undefined,
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

    const promptIds = Array.from(
      new Set(selectedScene.images.map((image) => image.promptId).filter((id): id is string => !!id))
    );

    if (!promptIds.length) {
      setNotice("Generate storyboard images first, then sync completed results.");
      return;
    }

    const sceneId = selectedScene.id;
    const expectedCount = clampStoryboardImageCount(selectedScene.imageCount);

    setBusySceneId(sceneId);
    setNotice(`Checking storyboard scene job result(s) and mapping images into slots 1-${expectedCount}.`);

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

      const orderedSavedItems = pickUniqueStoryboardSavedItems(savedItems, expectedCount);

      const mappedImages = Array.from({ length: expectedCount }, (_, index) => {
        const current = selectedScene.images[index] || {
          id: `${sceneId}_img_${index + 1}`,
          approved: false,
        };

        const savedItem = orderedSavedItems[index];

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
        setNotice(`Mapped all ${expectedCount} returned storyboard image(s) into slots 1-${expectedCount}.`);
        setStoryboardComfyProgress({
          running: false,
          readyToSync: false,
          percent: 100,
          label: "Storyboard images synced.",
          detail: "sync-complete",
        });
      } else {
        setNotice(`Mapped ${ready}/${expectedCount} storyboard image(s) into slots. Run Sync Results again after the rest finish.`);
      }
    } finally {
      setBusySceneId("");
    }
  }

  // PRODUCTION_ANIMATE_UI_SCAFFOLD_PATCH
  // PRODUCTION_ANIMATE_FRAME_PROMPTS_UI_PATCH
  // PRODUCTION_ANIMATE_CHARACTER_CONTEXT_UI_PATCH
  function clampAnimateFrameDuration(value: number) {
    if (!Number.isFinite(value)) return 2;
    return Math.max(1, Math.min(MAX_SCENE_DURATION_SECONDS, Math.round(value)));
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
    const direct = String(item?.url || item?.videoUrl || item?.src || "").trim();
    if (direct) return direct;

    const name = productionDefaultAnimateItemName(item);
    return name ? `/api/gallery/file?name=${encodeURIComponent(name)}` : "";
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

  // OTG_PRODUCTION_DEFAULT_ANIMATE_SYNC_GALLERY_MATCH_V2_START
  function productionDefaultAnimateNormalizeMatchText(value: unknown) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function productionDefaultAnimateItemMeta(item: any) {
    return item?.meta && typeof item.meta === "object" ? item.meta : {};
  }

  function productionDefaultAnimateItemSubmitPayload(item: any) {
    const meta = productionDefaultAnimateItemMeta(item);
    return meta?.submitPayload && typeof meta.submitPayload === "object" ? meta.submitPayload : {};
  }

  function productionDefaultAnimateItemPromptId(item: any) {
    const meta = productionDefaultAnimateItemMeta(item);
    const submitPayload = productionDefaultAnimateItemSubmitPayload(item);

    return String(
      item?.promptId ||
        item?.prompt_id ||
        item?.sourcePromptId ||
        meta?.sourcePromptId ||
        meta?.promptId ||
        meta?.prompt_id ||
        submitPayload?.promptId ||
        submitPayload?.prompt_id ||
        ""
    ).trim();
  }

  function productionDefaultAnimateItemRequestKind(item: any) {
    const meta = productionDefaultAnimateItemMeta(item);
    const submitPayload = productionDefaultAnimateItemSubmitPayload(item);

    return String(
      item?.requestKind ||
        meta?.requestKind ||
        submitPayload?.requestKind ||
        ""
    ).trim();
  }

  function productionDefaultAnimateItemWorkflowId(item: any) {
    const meta = productionDefaultAnimateItemMeta(item);
    const submitPayload = productionDefaultAnimateItemSubmitPayload(item);

    return String(
      item?.workflowId ||
        meta?.workflowId ||
        submitPayload?.workflowId ||
        submitPayload?.preset ||
        ""
    ).trim();
  }

  function productionDefaultAnimateItemTitle(item: any) {
    const meta = productionDefaultAnimateItemMeta(item);
    const submitPayload = productionDefaultAnimateItemSubmitPayload(item);

    return String(
      item?.title ||
        item?.name ||
        item?.fileName ||
        item?.filename ||
        meta?.title ||
        submitPayload?.title ||
        meta?.renamedName ||
        meta?.originalName ||
        ""
    ).trim();
  }

  function productionDefaultAnimateItemUpdatedAt(item: any) {
    const meta = productionDefaultAnimateItemMeta(item);

    return Number(
      item?.updatedAt ||
        item?.createdAt ||
        item?.ts ||
        meta?.updatedAt ||
        meta?.createdAt ||
        0
    ) || 0;
  }

  function productionDefaultAnimateItemKey(item: any) {
    return [
      productionDefaultAnimateItemName(item),
      productionDefaultAnimateItemPromptId(item),
      productionDefaultAnimateItemUpdatedAt(item),
    ].join("|");
  }

  function productionDefaultAnimateItemSearchText(item: any) {
    const meta = productionDefaultAnimateItemMeta(item);
    const submitPayload = productionDefaultAnimateItemSubmitPayload(item);

    return [
      item?.name,
      item?.fileName,
      item?.filename,
      item?.sourceName,
      item?.path,
      item?.url,
      item?.type,
      item?.kind,
      item?.mimeType,
      item?.promptId,
      item?.prompt_id,
      item?.sourcePromptId,
      meta?.renamedName,
      meta?.originalName,
      meta?.sourcePromptId,
      meta?.sourcePayloadKey,
      meta?.requestKind,
      meta?.workflowId,
      meta?.workflowTitle,
      meta?.positivePrompt,
      submitPayload?.title,
      submitPayload?.requestKind,
      submitPayload?.workflowId,
      submitPayload?.preset,
      submitPayload?.workflowLabel,
      submitPayload?.positivePrompt,
    ]
      .map(productionDefaultAnimateNormalizeMatchText)
      .filter(Boolean)
      .join(" ");
  }

  function productionDefaultAnimateExpectedClipTitle(sceneTitle: string, clipIndex: number) {
    return `${String(sceneTitle || "Scene").trim()} - Clip ${clipIndex + 1}`;
  }

  function productionDefaultAnimateFindBestGalleryClip(
    galleryItems: any[],
    usedKeys: Set<string>,
    clip: any,
    scene: any,
    clipIndex: number
  ) {
    const expectedTitle = productionDefaultAnimateNormalizeMatchText(
      productionDefaultAnimateExpectedClipTitle(scene?.title || selectedScene?.title || "", clipIndex)
    );
    const expectedClipToken = productionDefaultAnimateNormalizeMatchText(`Clip ${clipIndex + 1}`);
    const expectedSceneToken = productionDefaultAnimateNormalizeMatchText(scene?.title || selectedScene?.title || "");
    const clipPromptId = productionDefaultAnimateNormalizeMatchText(clip?.promptId);
    const clipOutputPrefix = productionDefaultAnimateNormalizeMatchText(clip?.outputPrefix);

    let bestItem: any = null;
    let bestScore = 0;

    for (const item of galleryItems) {
      const key = productionDefaultAnimateItemKey(item);
      if (usedKeys.has(key)) continue;

      const text = productionDefaultAnimateItemSearchText(item);
      const itemRequestKind = productionDefaultAnimateItemRequestKind(item);
      const itemWorkflowId = productionDefaultAnimateItemWorkflowId(item);
      const itemPromptId = productionDefaultAnimateNormalizeMatchText(productionDefaultAnimateItemPromptId(item));
      const itemTitle = productionDefaultAnimateNormalizeMatchText(productionDefaultAnimateItemTitle(item));

      let score = 0;

      if (itemRequestKind === "production-default-image-to-video") score += 300;
      if (itemWorkflowId === PRODUCTION_DEFAULT_I2V_WORKFLOW_ID) score += 80;

      if (clipPromptId && itemPromptId && clipPromptId === itemPromptId) score += 1000;
      if (clipPromptId && text.includes(clipPromptId)) score += 700;

      if (clipOutputPrefix && text.includes(clipOutputPrefix)) score += 700;

      if (expectedTitle && text.includes(expectedTitle)) score += 600;
      if (expectedTitle && itemTitle.includes(expectedTitle)) score += 650;

      if (expectedSceneToken && text.includes(expectedSceneToken)) score += 80;
      if (expectedClipToken && text.includes(expectedClipToken)) score += 140;

      if (productionDefaultAnimateIsVideoItem(item)) score += 40;

      if (score > bestScore) {
        bestItem = item;
        bestScore = score;
      }
    }

    return bestScore >= 300 ? bestItem : null;
  }

  async function syncSelectedFrameClips() {
    if (!selectedScene || busySceneId) return;

    const sceneId = selectedScene.id;
    const frameClips = animateFrameClips(selectedScene);

    if (!frameClips.length) {
      setNotice("No frame clip slots found for this scene.");
      return;
    }

    setBusySceneId(sceneId);
    setNotice("Syncing generated frame clips from gallery output...");

    try {
      const galleryItems = (await productionDefaultAnimateFetchGalleryItems())
        .filter(productionDefaultAnimateIsVideoItem)
        .sort((a, b) => productionDefaultAnimateItemUpdatedAt(b) - productionDefaultAnimateItemUpdatedAt(a));

      if (!galleryItems.length) {
        setNotice("No generated video clips found yet. Wait for Comfy to finish, then Sync Frame Clips again.");
        return;
      }

      const usedKeys = new Set<string>();
      let mappedCount = 0;

      const nextClips = frameClips.map((clip, index) => {
        const matchedItem = productionDefaultAnimateFindBestGalleryClip(
          galleryItems,
          usedKeys,
          clip,
          selectedScene,
          index
        );

        if (!matchedItem) return clip;

        usedKeys.add(productionDefaultAnimateItemKey(matchedItem));

        const fileName = productionDefaultAnimateItemName(matchedItem);
        const url = productionDefaultAnimateItemUrl(matchedItem);
        const sourcePromptId = productionDefaultAnimateItemPromptId(matchedItem);

        if (!url && !fileName) return clip;

        mappedCount += 1;

        return {
          ...clip,
          status: "ready" as const,
          fileName,
          url,
          promptId: clip.promptId || sourcePromptId,
          sourceFrameIndex: typeof clip.sourceFrameIndex === "number" ? clip.sourceFrameIndex : index,
          error: undefined,
        };
      });

      const readyCount = nextClips.filter((clip) => clip.status === "ready").length;

      updateSceneById(sceneId, {
        frameClips: nextClips,
        status: readyCount >= nextClips.length ? "clip_ready" : selectedScene.status,
      });

      setNotice(
        mappedCount
          ? `Synced ${mappedCount}/${nextClips.length} frame clip(s).`
          : "Found generated videos, but none matched this scene's clip slots. Check gallery metadata title/requestKind/sourcePromptId."
      );
    } finally {
      setBusySceneId("");
    }
  }
  // OTG_PRODUCTION_DEFAULT_ANIMATE_SYNC_GALLERY_MATCH_V2_END
// OTG_PRODUCTION_DEFAULT_ANIMATE_USE_GENERATE_I2V_V1_END
  async function generateSelectedFrameClips() {
    if (!selectedScene || busySceneId) return;

    const sceneSnapshot = selectedScene;
    const sceneId = sceneSnapshot.id;
    const frames = storyboardFramesForAnimate(sceneSnapshot);
    const drafts = animateFrameDrafts(sceneSnapshot);
    const existingClips = animateFrameClips(sceneSnapshot);
    const expectedCount = clampStoryboardImageCount(sceneSnapshot.imageCount);
    const missingFrames = frames.filter((frame) => !frame.approved || !frame.url);

    if (missingFrames.length) {
      setNotice(`Approve and sync all storyboard images before animation. Missing ${missingFrames.length}/${expectedCount}.`);
      return;
    }

    setBusySceneId(sceneId);
    setNotice(`Submitting ${expectedCount} LTX 2.3 image-to-video clip job(s).`);

    let nextClips: ProductionFrameClip[] = Array.from({ length: expectedCount }, (_, index) => ({
      ...existingClips[index],
      status: "queued" as const,
      error: undefined,
    }));

    updateSceneById(sceneId, {
      frameClips: nextClips,
    });

    try {
      for (let index = 0; index < expectedCount; index += 1) {
        const frame = frames[index];
        const draft = drafts[index];
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
        const outputPrefix = productionDefaultAnimateOutputPrefix(sceneId, index);
        const sourceFile = await productionDefaultAnimateImageFile(
          frame.url,
          `${sceneId}_frame_${index + 1}.png`
        );

        const form = new FormData();
        form.append("workflowId", PRODUCTION_DEFAULT_I2V_WORKFLOW_ID);
        form.append("preset", PRODUCTION_DEFAULT_I2V_WORKFLOW_ID);
        form.append("workflowLabel", PRODUCTION_DEFAULT_I2V_WORKFLOW_LABEL);
        form.append("requestKind", "production-default-image-to-video");
        form.append("title", `${sceneSnapshot.title} - Clip ${index + 1}`);
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
        form.append("imageA", sourceFile, sourceFile.name);
        form.append("image", sourceFile, sourceFile.name);

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
          error: undefined,
        };

        updateSceneById(sceneId, {
          frameClips: nextClips,
        });
      }

      setNotice(`Submitted ${expectedCount} LTX 2.3 frame clip job(s). Use Sync Frame Clips after Comfy finishes.`);
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
      running: true,
      readyToSync: false,
      percent: 0,
      label: `Starting storyboard generation for ${safeCount} image${safeCount === 1 ? "" : "s"}.`,
      detail: "generation-started",
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

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/35">
          <div
            className="h-full rounded-full bg-cyan-300 transition-all"
            style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
          />
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
function renderAnimateStage() {
    const directorImportedFrames = buildDirectorImportedFrames();

    return (
      <section className="space-y-4">
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

    return (
      <section className="space-y-4">
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
              {expectedCount} image-to-video jobs
            </span>
          </div>

          <div className="space-y-3">
            {frames.map((frame) => {
              const draft = animateDrafts[frame.index];
              const clip = frameClips[frame.index];
              const selectedIds = new Set(draft.characterRefIds || []);
              const globalPromptPreview = animateGlobalPromptForFrame(scene, frame.index);

              return (
                <details key={frame.index} className="overflow-hidden rounded-[16px] border border-white/10 bg-black/20">
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
                          Clip Duration - seconds
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={MAX_SCENE_DURATION_SECONDS}
                          value={draft.durationSeconds}
                          onChange={(event) => updateAnimateFrameDraft(frame.index, { durationSeconds: Number(event.target.value) })}
                          className="mt-2 w-full rounded-[14px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50"
                        />
                      </label>

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
                Synced clips will appear here for review before moving to the next Production step.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!scene || Boolean(busySceneId)}
                onClick={generateSelectedFrameClips}
                className="rounded-[12px] bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Generate Frame Clips
              </button>
              <button
                type="button"
                disabled={!frameClips.some((clip) => clip.promptId) || Boolean(busySceneId)}
                onClick={syncSelectedFrameClips}
                className="rounded-[12px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Sync Frame Clips
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {frameClips.map((clip, index) => (
              <div key={index} className="overflow-hidden rounded-[14px] border border-white/10 bg-black/25">
                <div className="relative aspect-video bg-white/5">
                  {clip.url ? (
                    <video src={clip.url} className="h-full w-full object-cover" controls />
                  ) : (
                    <div className="flex h-full items-center justify-center px-3 text-center text-xs text-white/35">
                      Clip {index + 1} pending
                    </div>
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-xs font-black text-white">
                    Clip {index + 1}
                  </span>
                </div>
                <div className="px-3 py-2 text-xs">
                  <div className={clip.status === "ready" ? "font-black text-emerald-300" : clip.status === "error" ? "font-black text-red-300" : "font-black text-white/50"}>
                    {clip.status}
                  </div>
                  <div className="mt-1 truncate text-white/40">{clip.fileName || "No clip yet"}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }


// OTG_PRODUCTION_STAGE_BOTTOM_NAV_V1_START
  
// OTG_PRODUCTION_EDIT_WORKBENCH_V1_START
  function clampEditSeconds(value: number, fallback = 0) {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(MAX_SCENE_DURATION_SECONDS, Math.round(value * 10) / 10));
  }

  function createProductionEditVoiceSegment(index: number, durationSec: number): ProductionEditVoiceSegment {
    const startSec = index === 0 ? 0 : Math.min(durationSec, index * 5);
    const endSec = Math.min(durationSec, Math.max(startSec + 1, startSec + 5));

    return {
      id: `voice_${Date.now()}_${index}`,
      character: index === 0 ? "Character A" : `Character ${index + 1}`,
      voice: "",
      startSec,
      endSec,
      text: "",
      mode: "replace",
      volume: 1,
    };
  }

  function createProductionEditSfxSegment(index: number): ProductionEditSfxSegment {
    return {
      id: `sfx_${Date.now()}_${index}`,
      label: index === 0 ? "Whoosh" : `SFX ${index + 1}`,
      prompt: index === 0 ? "cinematic whoosh transition" : "",
      startSec: 0,
      durationSec: 1,
      volume: 0.75,
    };
  }

  function createDefaultProductionEditDraft(durationSec = 4): ProductionClipEditDraft {
    const safeDuration = clampEditSeconds(durationSec, 4) || 4;

    return {
      trimStartSec: 0,
      trimEndSec: safeDuration,
      playbackRate: 1,
      extendMode: "none",
      voiceSegments: [createProductionEditVoiceSegment(0, safeDuration)],
      music: {
        enabled: false,
        source: "none",
        prompt: "",
        startSec: 0,
        endSec: safeDuration,
        volume: 0.35,
        fadeInSec: 0.5,
        fadeOutSec: 0.5,
        duckUnderDialogue: true,
      },
      sfxSegments: [],
      audioCleanup: {
        muteOriginal: false,
        removeOriginalMusic: false,
        enhanceSpeech: false,
        normalizeVolume: true,
      },
      visualFix: {
        enabled: false,
        startSec: 0,
        endSec: safeDuration,
        prompt: "",
      },
      status: "draft",
    };
  }

  function editClipRows(scene: ProductionScene | null | undefined): ProductionEditClipRow[] {
    if (!scene) return [];

    const clips = animateFrameClips(scene);
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
        const durationSec = clampEditSeconds(draft?.durationSeconds ?? defaultAnimateFrameDuration(scene), 4) || 4;

        return {
          key: `${scene.id || "scene"}_clip_${index}`,
          index,
          title: `${scene.title || "Scene"} - Clip ${index + 1}`,
          clip,
          frame,
          draft,
          sourceUrl,
          durationSec,
        };
      })
      .filter((row) => Boolean(row.sourceUrl || row.clip?.promptId || row.frame?.url));
  }

  function editDraftForClip(clipKey: string, durationSec: number) {
    return editDraftsByClipKey[clipKey] || createDefaultProductionEditDraft(durationSec);
  }

  function updateEditDraft(clipKey: string, durationSec: number, patch: Partial<ProductionClipEditDraft>) {
    if (!clipKey) return;

    setEditDraftsByClipKey((previous) => {
      const current = previous[clipKey] || createDefaultProductionEditDraft(durationSec);
      return {
        ...previous,
        [clipKey]: {
          ...current,
          ...patch,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }

  function updateEditDraftNested<K extends keyof ProductionClipEditDraft>(
    clipKey: string,
    durationSec: number,
    key: K,
    value: ProductionClipEditDraft[K]
  ) {
    updateEditDraft(clipKey, durationSec, { [key]: value } as Partial<ProductionClipEditDraft>);
  }

  function updateVoiceSegment(
    clipKey: string,
    durationSec: number,
    segmentIndex: number,
    patch: Partial<ProductionEditVoiceSegment>
  ) {
    if (!clipKey) return;

    setEditDraftsByClipKey((previous) => {
      const current = previous[clipKey] || createDefaultProductionEditDraft(durationSec);
      const nextSegments = current.voiceSegments.map((segment, index) =>
        index === segmentIndex
          ? {
              ...segment,
              ...patch,
              startSec: clampEditSeconds(patch.startSec ?? segment.startSec, segment.startSec),
              endSec: clampEditSeconds(patch.endSec ?? segment.endSec, segment.endSec),
            }
          : segment
      );

      return {
        ...previous,
        [clipKey]: {
          ...current,
          voiceSegments: nextSegments,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }

  function addVoiceSegment(clipKey: string, durationSec: number) {
    if (!clipKey) return;

    setEditDraftsByClipKey((previous) => {
      const current = previous[clipKey] || createDefaultProductionEditDraft(durationSec);
      return {
        ...previous,
        [clipKey]: {
          ...current,
          voiceSegments: [...current.voiceSegments, createProductionEditVoiceSegment(current.voiceSegments.length, durationSec)],
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }

  function removeVoiceSegment(clipKey: string, durationSec: number, segmentIndex: number) {
    if (!clipKey) return;

    setEditDraftsByClipKey((previous) => {
      const current = previous[clipKey] || createDefaultProductionEditDraft(durationSec);
      const nextSegments = current.voiceSegments.filter((_, index) => index !== segmentIndex);

      return {
        ...previous,
        [clipKey]: {
          ...current,
          voiceSegments: nextSegments.length ? nextSegments : [createProductionEditVoiceSegment(0, durationSec)],
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
      const current = previous[clipKey] || createDefaultProductionEditDraft(durationSec);
      const nextSegments = current.sfxSegments.map((segment, index) =>
        index === segmentIndex
          ? {
              ...segment,
              ...patch,
              startSec: clampEditSeconds(patch.startSec ?? segment.startSec, segment.startSec),
              durationSec: clampEditSeconds(patch.durationSec ?? segment.durationSec, segment.durationSec),
            }
          : segment
      );

      return {
        ...previous,
        [clipKey]: {
          ...current,
          sfxSegments: nextSegments,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }

  function addSfxSegment(clipKey: string, durationSec: number) {
    if (!clipKey) return;

    setEditDraftsByClipKey((previous) => {
      const current = previous[clipKey] || createDefaultProductionEditDraft(durationSec);
      return {
        ...previous,
        [clipKey]: {
          ...current,
          sfxSegments: [...current.sfxSegments, createProductionEditSfxSegment(current.sfxSegments.length)],
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }

  function removeSfxSegment(clipKey: string, durationSec: number, segmentIndex: number) {
    if (!clipKey) return;

    setEditDraftsByClipKey((previous) => {
      const current = previous[clipKey] || createDefaultProductionEditDraft(durationSec);
      return {
        ...previous,
        [clipKey]: {
          ...current,
          sfxSegments: current.sfxSegments.filter((_, index) => index !== segmentIndex),
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }

  function saveEditManifest(clipKey: string, durationSec: number) {
    if (!clipKey) return;

    updateEditDraft(clipKey, durationSec, {
      status: "ready",
      updatedAt: new Date().toISOString(),
    });

    setNotice("Edit manifest saved. Backend render/mux wiring is the next patch.");
  }

  function renderEditStage() {
    const scene = selectedScene;
    const rows = editClipRows(scene);
    const activeKey =
      selectedEditClipKey && rows.some((row) => row.key === selectedEditClipKey)
        ? selectedEditClipKey
        : rows[0]?.key || "";
    const activeRow = rows.find((row) => row.key === activeKey) || rows[0] || null;
    const durationSec = activeRow?.durationSec || clampStoryboardDuration(scene?.durationSeconds ?? DEFAULT_SCENE_DURATION_SECONDS);
    const draft = activeKey ? editDraftForClip(activeKey, durationSec) : createDefaultProductionEditDraft(durationSec);
    const readyCount = rows.filter((row) => editDraftsByClipKey[row.key]?.status === "ready").length;

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
            </div>
          </div>
        </div>

        {!rows.length ? (
          <div className="rounded-[18px] border border-amber-300/25 bg-amber-300/10 p-5 text-sm text-amber-100">
            No generated clips are available for this scene yet. Generate or sync clips in Animate before editing.
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="space-y-3 rounded-[18px] border border-white/10 bg-white/[0.04] p-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Clip List</p>
                <h3 className="mt-1 text-lg font-black text-white">Scene clips</h3>
              </div>

              <div className="space-y-2">
                {rows.map((row) => {
                  const rowDraft = editDraftsByClipKey[row.key];
                  const isActive = row.key === activeKey;

                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => setSelectedEditClipKey(row.key)}
                      className={[
                        "w-full rounded-[14px] border p-3 text-left transition",
                        isActive
                          ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-50"
                          : "border-white/10 bg-black/20 text-white/70 hover:bg-white/[0.06]",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-black">Clip {row.index + 1}</span>
                        <span className={rowDraft?.status === "ready" ? "rounded-full bg-emerald-300/15 px-2 py-1 text-xs font-black text-emerald-300" : "rounded-full bg-white/5 px-2 py-1 text-xs font-black text-white/45"}>
                          {rowDraft?.status === "ready" ? "Ready" : "Draft"}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-white/45">{row.durationSec}s source</div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Preview</p>
                      <h3 className="text-lg font-black text-white">{activeRow?.title || "Clip"}</h3>
                    </div>
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-black text-white/60">
                      {draft.trimStartSec}s to {draft.trimEndSec}s
                    </span>
                  </div>

                  {activeRow?.sourceUrl ? (
                    <video key={activeRow.sourceUrl} controls className="aspect-video w-full rounded-[14px] bg-black object-contain">
                      <source src={activeRow.sourceUrl} />
                    </video>
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
                </div>
              </div>

              <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Trim and Timing</p>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Start seconds</span>
                    <input
                      type="number"
                      min={0}
                      max={durationSec}
                      step={0.1}
                      value={draft.trimStartSec}
                      onChange={(event) => updateEditDraft(activeKey, durationSec, { trimStartSec: clampEditSeconds(Number(event.target.value), 0), status: "draft" })}
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
                      value={draft.trimEndSec}
                      onChange={(event) => updateEditDraft(activeKey, durationSec, { trimEndSec: clampEditSeconds(Number(event.target.value), durationSec), status: "draft" })}
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
                      value={draft.extendMode}
                      onChange={(event) => updateEditDraft(activeKey, durationSec, { extendMode: event.target.value as ProductionClipEditDraft["extendMode"], status: "draft" })}
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

              <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Voice Dubbing</p>
                    <h3 className="text-lg font-black text-white">Timed voice segments</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => addVoiceSegment(activeKey, durationSec)}
                    className="rounded-[12px] border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-100"
                  >
                    Add Voice Segment
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {draft.voiceSegments.map((segment, index) => (
                    <div key={segment.id} className="rounded-[14px] border border-white/10 bg-black/20 p-4">
                      <div className="grid gap-3 md:grid-cols-6">
                        <label className="block md:col-span-2">
                          <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Character</span>
                          <input value={segment.character} onChange={(event) => updateVoiceSegment(activeKey, durationSec, index, { character: event.target.value })} className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none" />
                        </label>
                        <label className="block md:col-span-2">
                          <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Voice</span>
                          <input value={segment.voice} onChange={(event) => updateVoiceSegment(activeKey, durationSec, index, { voice: event.target.value })} placeholder="Voice name or ID" className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35" />
                        </label>
                        <label className="block">
                          <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Start</span>
                          <input type="number" min={0} max={durationSec} step={0.1} value={segment.startSec} onChange={(event) => updateVoiceSegment(activeKey, durationSec, index, { startSec: Number(event.target.value) })} className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none" />
                        </label>
                        <label className="block">
                          <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">End</span>
                          <input type="number" min={0} max={durationSec} step={0.1} value={segment.endSec} onChange={(event) => updateVoiceSegment(activeKey, durationSec, index, { endSec: Number(event.target.value) })} className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none" />
                        </label>
                      </div>

                      <label className="mt-3 block">
                        <span className="text-xs font-black uppercase tracking-[0.16em] text-white/45">Dialogue</span>
                        <textarea value={segment.text} onChange={(event) => updateVoiceSegment(activeKey, durationSec, index, { text: event.target.value })} rows={3} className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm leading-6 text-white outline-none" />
                      </label>

                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <select value={segment.mode} onChange={(event) => updateVoiceSegment(activeKey, durationSec, index, { mode: event.target.value as ProductionEditVoiceSegment["mode"] })} className="rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none">
                          <option value="replace" className="bg-slate-950">Replace original</option>
                          <option value="overlay" className="bg-slate-950">Overlay</option>
                        </select>
                        <label className="flex items-center gap-2 text-sm text-white/65">
                          Volume
                          <input type="number" min={0} max={2} step={0.05} value={segment.volume} onChange={(event) => updateVoiceSegment(activeKey, durationSec, index, { volume: Math.max(0, Math.min(2, Number(event.target.value) || 1)) })} className="w-20 rounded-[10px] border border-white/10 bg-black/30 px-2 py-1 text-white outline-none" />
                        </label>
                        <button type="button" onClick={() => removeVoiceSegment(activeKey, durationSec, index)} className="rounded-[10px] border border-rose-300/25 bg-rose-300/10 px-3 py-2 text-sm font-black text-rose-100">
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Music</p>
                  <h3 className="text-lg font-black text-white">Background music</h3>

                  <div className="mt-4 space-y-3">
                    <label className="flex items-center gap-3 text-sm font-bold text-white/75">
                      <input type="checkbox" checked={draft.music.enabled} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "music", { ...draft.music, enabled: event.target.checked })} />
                      Enable music layer
                    </label>
                    <select value={draft.music.source} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "music", { ...draft.music, source: event.target.value as ProductionClipEditDraft["music"]["source"], enabled: event.target.value !== "none" })} className="w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none">
                      <option value="none" className="bg-slate-950">None</option>
                      <option value="generate" className="bg-slate-950">Generate</option>
                      <option value="library" className="bg-slate-950">Library</option>
                      <option value="upload" className="bg-slate-950">Upload</option>
                    </select>
                    <textarea value={draft.music.prompt} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "music", { ...draft.music, prompt: event.target.value })} rows={3} placeholder="Music prompt or library notes" className="w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/35" />
                    <div className="grid gap-3 md:grid-cols-3">
                      <input type="number" min={0} max={durationSec} step={0.1} value={draft.music.startSec} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "music", { ...draft.music, startSec: clampEditSeconds(Number(event.target.value), 0) })} className="rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none" />
                      <input type="number" min={0} max={durationSec} step={0.1} value={draft.music.endSec} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "music", { ...draft.music, endSec: clampEditSeconds(Number(event.target.value), durationSec) })} className="rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none" />
                      <input type="number" min={0} max={1} step={0.05} value={draft.music.volume} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "music", { ...draft.music, volume: Math.max(0, Math.min(1, Number(event.target.value) || 0)) })} className="rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none" />
                    </div>
                    <label className="flex items-center gap-3 text-sm font-bold text-white/75">
                      <input type="checkbox" checked={draft.music.duckUnderDialogue} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "music", { ...draft.music, duckUnderDialogue: event.target.checked })} />
                      Duck under dialogue
                    </label>
                  </div>
                </div>

                <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
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
                    {draft.sfxSegments.length ? draft.sfxSegments.map((segment, index) => (
                      <div key={segment.id} className="rounded-[14px] border border-white/10 bg-black/20 p-3">
                        <input value={segment.label} onChange={(event) => updateSfxSegment(activeKey, durationSec, index, { label: event.target.value })} className="w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm font-black text-white outline-none" />
                        <textarea value={segment.prompt} onChange={(event) => updateSfxSegment(activeKey, durationSec, index, { prompt: event.target.value })} rows={2} className="mt-2 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm leading-6 text-white outline-none" />
                        <div className="mt-2 grid gap-2 md:grid-cols-4">
                          <input type="number" min={0} max={durationSec} step={0.1} value={segment.startSec} onChange={(event) => updateSfxSegment(activeKey, durationSec, index, { startSec: Number(event.target.value) })} className="rounded-[10px] border border-white/10 bg-black/30 px-2 py-1 text-sm text-white outline-none" />
                          <input type="number" min={0.1} max={durationSec} step={0.1} value={segment.durationSec} onChange={(event) => updateSfxSegment(activeKey, durationSec, index, { durationSec: Number(event.target.value) })} className="rounded-[10px] border border-white/10 bg-black/30 px-2 py-1 text-sm text-white outline-none" />
                          <input type="number" min={0} max={2} step={0.05} value={segment.volume} onChange={(event) => updateSfxSegment(activeKey, durationSec, index, { volume: Math.max(0, Math.min(2, Number(event.target.value) || 1)) })} className="rounded-[10px] border border-white/10 bg-black/30 px-2 py-1 text-sm text-white outline-none" />
                          <button type="button" onClick={() => removeSfxSegment(activeKey, durationSec, index)} className="rounded-[10px] border border-rose-300/25 bg-rose-300/10 px-2 py-1 text-sm font-black text-rose-100">
                            Delete
                          </button>
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-[14px] border border-dashed border-white/15 bg-black/20 p-4 text-sm text-white/45">
                        No sound effects added.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Audio Cleanup</p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {[
                      ["muteOriginal", "Mute original audio"],
                      ["removeOriginalMusic", "Remove original music"],
                      ["enhanceSpeech", "Enhance speech"],
                      ["normalizeVolume", "Normalize volume"],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-3 rounded-[12px] border border-white/10 bg-black/20 p-3 text-sm font-bold text-white/75">
                        <input
                          type="checkbox"
                          checked={Boolean(draft.audioCleanup[key as keyof ProductionClipEditDraft["audioCleanup"]])}
                          onChange={(event) =>
                            updateEditDraftNested(activeKey, durationSec, "audioCleanup", {
                              ...draft.audioCleanup,
                              [key]: event.target.checked,
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/45">Visual Fix</p>
                  <label className="mt-4 flex items-center gap-3 text-sm font-bold text-white/75">
                    <input type="checkbox" checked={draft.visualFix.enabled} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "visualFix", { ...draft.visualFix, enabled: event.target.checked })} />
                    Enable visual edit range
                  </label>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <input type="number" min={0} max={durationSec} step={0.1} value={draft.visualFix.startSec} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "visualFix", { ...draft.visualFix, startSec: clampEditSeconds(Number(event.target.value), 0) })} className="rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none" />
                    <input type="number" min={0} max={durationSec} step={0.1} value={draft.visualFix.endSec} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "visualFix", { ...draft.visualFix, endSec: clampEditSeconds(Number(event.target.value), durationSec) })} className="rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none" />
                  </div>
                  <textarea value={draft.visualFix.prompt} onChange={(event) => updateEditDraftNested(activeKey, durationSec, "visualFix", { ...draft.visualFix, prompt: event.target.value })} rows={4} placeholder="Describe the object, artifact, background, or visual change to fix in this time range." className="mt-3 w-full rounded-[12px] border border-white/10 bg-black/30 px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/35" />
                </div>
              </div>

              <details className="rounded-[18px] border border-white/10 bg-white/[0.04] p-5">
                <summary className="cursor-pointer text-sm font-black uppercase tracking-[0.18em] text-white/55">Edit Manifest Preview</summary>
                <pre className="mt-3 max-h-80 overflow-auto rounded-[14px] bg-black/40 p-4 text-xs leading-5 text-cyan-50/80">{JSON.stringify(draft, null, 2)}</pre>
              </details>
            </div>
          </div>
        )}
      </section>
    );
  }
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
            <button type="button" onClick={saveDraft} className="rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">Save Draft</button>
            <button type="button" onClick={resetDraft} className="rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">Reset</button>
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

      <div className="grid min-h-[720px] grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_280px]">
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

        <main className="min-w-0 bg-slate-50 p-4 md:p-6">
          {activeStage === "storyboard" && selectedScene ? (
            <section className="space-y-5">
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
                      onClick={generateSelectedSceneImages}
                      disabled={busySceneId === selectedScene.id || !selectedScene.prompt.trim()}
                      className="rounded-[8px] bg-violet-600 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
                    >
                      {busySceneId === selectedScene.id ? "Working..." : "Generate Images"}
                    </button>
                    <button
                      type="button"
                      onClick={syncSelectedSceneImages}
                      disabled={busySceneId === selectedScene.id || !selectedScene.images.some((image) => image.promptId)}
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
                        <div className={classNames("relative aspect-video bg-gradient-to-br", img ? thumbnailClass(index) : "from-slate-100 to-slate-200")}>
                          {img?.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={img.url} alt={`${selectedScene.title} storyboard frame ${index + 1}`} className="h-full w-full object-cover" />
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
                            {state === "ready" ? "Approved" : state === "queued" ? "Queued" : state === "error" ? "Error" : "Empty"}
                          </span>
                          <button type="button" className="text-slate-400">...</button>
                        </div>
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
          ) : activeStage === "animate" ? (renderAnimateStage()) : activeStage === "edit" ? (renderEditStage()) : (<StageShell stage={activeStage} active={activeStage} />)}
          {renderProductionStageNavigation()}
        </main>

        <aside className="border-t border-slate-200 bg-white p-4 xl:border-l xl:border-t-0">
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
