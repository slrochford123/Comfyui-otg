"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { withDeviceHeader } from "../studio/deviceHeader";
import ProductionTaskWidget, { type ProductionStepItem, type ProductionStepKey } from "./ProductionTaskWidget";


function pickVideoPath(payload: any): string {
  return (
    payload?.videoPath ||
    payload?.serverPath ||
    payload?.generatedVideoPath ||
    ""
  );
}

function pickVideoUrl(payload: any): string {
  return (
    payload?.videoUrl ||
    payload?.serverUrl ||
    payload?.generatedVideoUrl ||
    ""
  );
}

function withCacheBust(url: string, token: string): string {
  const trimmed = String(url || "").trim();
  if (!trimmed) return "";
  const joiner = trimmed.includes("?") ? "&" : "?";
  return `${trimmed}${joiner}otgVideoRequest=${encodeURIComponent(token)}&otgTs=${Date.now()}`;
}

function fileUrlFor(pathValue?: string): string {
  const p = String(pathValue || "").trim();
  return p ? `/api/file?path=${encodeURIComponent(p)}` : "";
}

type StoryboardCount = 1 | 2 | 3 | 4 | 5;

type CharacterSlot = {
  id: string;
  name: string;
  nameLocked?: boolean;
  file?: File;
  previewUrl?: string;
  serverPath?: string;
  clearedServerPath?: string;
  descriptor: string;
  sourceCharacterId?: string;
  sourceCharacterName?: string;
  introVideoPath?: string;
  referenceAudioPath?: string;
  voiceStyleDefinition?: string;
  introLine?: string;
  status?: string;
  error?: string;
};

type CharacterLibraryRecord = {
  id: string;
  name: string;
  imagePath: string;
  description: string;
  voiceStyleDefinition: string;
  introLine: string;
  introVideoPath?: string;
  referenceAudioPath?: string;
  createdAt: string;
  updatedAt: string;
};

type VoiceLibraryItem = {
  voiceId: string;
  name: string;
  refAudioUrl?: string;
  type?: string;
};

type RecentProductionImage = {
  imagePath: string;
  imageUrl: string;
  name: string;
  createdAt?: number;
};

type SavedCardVideo = {
  card: number;
  imagePath?: string;
  imageUrl?: string;
  videoPath: string;
  videoUrl: string;
  audioPath?: string;
  audioUrl?: string;
  prompt?: string;
  characterNames?: string[];
  lockedAt?: string;
};

type PersistedProductionState = {
  productionId: string;
  name: string;
  activeStep: ProductionStepKey;
  currentCard: number;
  totalCards: number;
  characterCount: StoryboardCount | null;
  backgroundPrompt: string;
  backgroundPreset: BackgroundPresetKey;
  backgroundImagePath?: string;
  backgroundImageMode?: "upload" | "generated" | null;
  defaultLens: string;
  defaultMood: string;
  defaultStyle: string;
  defaultIdentity: string;
  positivePrompt: string;
  negativePrompt: string;
  usePreviousLength: boolean;
  usePreviousIdentityLock: boolean;
  usePreviousStyleLock: boolean;
  savedCardVideos?: SavedCardVideo[];
  stitchedVideoPath?: string;
  completedAt?: string;
  status?: "active" | "completed";
  characters: Array<{
    id: string;
    name: string;
    nameLocked?: boolean;
    serverPath?: string;
    clearedServerPath?: string;
    descriptor: string;
    sourceCharacterId?: string;
    sourceCharacterName?: string;
    introVideoPath?: string;
    referenceAudioPath?: string;
    voiceStyleDefinition?: string;
    introLine?: string;
  }>;
};

type PersistedProductionRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  state: PersistedProductionState;
};

type ProductionSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentCard: number;
  totalCards: number;
  characterCount: number;
  activeStep: ProductionStepKey;
  sceneCount: number;
  stitchedVideoPath?: string;
  completedAt?: string;
  status?: "active" | "completed";
};

type PanelMode = "menu" | "new" | "load" | "delete" | "completed" | "completedView" | "builder";
type SaveTone = "warn" | "success" | "error";
type BackgroundPresetKey = "anime" | "unreal_engine" | "realistic" | "noir" | "old_school";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const OVERLAY_MODE_KEY = "otg:overlayMode";
const LENS_PRESETS = ["24mm", "35mm", "50mm", "85mm"];
const STYLE_PRESETS = [
  "realistic cinematic style",
  "realistic cinematic style, film grain, shallow depth of field",
  "realistic cinematic style, soft natural lighting, high detail",
  "anime cinematic style, clean linework, vibrant color contrast",
];
const IDENTITY_PRESETS = [
  "Identity/Face lock: match Character 1 exactly; no face drift; same hair, age, outfit",
  "Identity/Face lock: preserve facial proportions and hairstyle; no identity swap",
  "Identity/Face lock: keep facial structure, age, and outfit consistent across cards",
  "Identity/Face lock: strict face match; keep skin texture, hairline, and wardrobe continuity",
];
const MOOD_PRESETS = ["tense anticipation", "hopeful resolve", "quiet suspense", "somber reflection", "elevated cinematic energy"];
const BACKGROUND_PRESETS: Array<{ key: BackgroundPresetKey; label: string; inject: string }> = [
  { key: "anime", label: "Anime", inject: "anime cinematic background, clean linework, vivid cel shading" },
  { key: "unreal_engine", label: "Unreal Engine", inject: "unreal engine environment, high detail, cinematic lighting" },
  { key: "realistic", label: "Realistic", inject: "realistic environment, natural lighting, photoreal detail" },
  { key: "noir", label: "Noir", inject: "film noir environment, moody shadows, dramatic contrast" },
  { key: "old_school", label: "Old School", inject: "old school cinematic environment, vintage texture, classic color treatment" },
];

const PRODUCTION_STEPS: Array<{ key: ProductionStepKey; label: string; description: string }> = [
  { key: "setup", label: "Setup", description: "Set the production name, choose character count, and lock the scene background." },
  { key: "characters", label: "Characters", description: "Upload and refine the active character references for this card." },
  { key: "prompt", label: "Prompt Builder", description: "Preview continuity references and build the still-image prompt inputs." },
  { key: "video", label: "Create Video", description: "This step will carry the saved image into the LTX2 video workflow in a later patch." },
  { key: "validation", label: "Validation", description: "Validation stays flexible for now and will be finalized before stitch." },
  { key: "review", label: "Review", description: "Review locked scenes before stitching." },
  { key: "stitch", label: "Stitch", description: "Stitch locked scene videos and complete the project." },
];

const ID_LORA_PROMPT_TEMPLATE = "[VISUAL]: \n[SPEECH]: \n[SOUNDS]: ";
const CREATE_VIDEO_EXAMPLE_PROMPT = `[Scene] A modern bar.

[Characters] Female: Dressed in a fashionable evening dress. Male: Dressed in elegant party club wearâ€”with a sleek fitted shirt and blazer.

Shot 1 (Medium Shot, 4s): The female character looking at the male with gentle eyes speaks: "Wine in a club? You're full of surprises."

Shot 2 (Close-up, 3s): The camera pushes in to focus on the male characters face. With confident smirk, leans in slightly to reply: "Only the good kind. Like you."

Shot 3 (Medium Shot, 5s): The female character looks at the male and replies coyly: "Flatterer! What's your next trick?"`;
const CHARACTER_BUTTON_STYLES = [
  "border-rose-300/35 bg-rose-500/14 text-rose-100",
  "border-sky-300/35 bg-sky-500/14 text-sky-100",
  "border-fuchsia-300/35 bg-fuchsia-500/14 text-fuchsia-100",
  "border-amber-300/35 bg-amber-500/14 text-amber-100",
  "border-emerald-300/35 bg-emerald-500/14 text-emerald-100",
] as const;

function hasRequiredIdLoraPromptFormat(value: string): boolean {
  const text = String(value || "");
  const visualIndex = text.search(/\[VISUAL\]:/i);
  const speechIndex = text.search(/\[SPEECH\]:/i);
  const soundsIndex = text.search(/\[SOUNDS\]:/i);
  return visualIndex >= 0 && speechIndex > visualIndex && soundsIndex > speechIndex;
}

function normalizePromptInsertSegment(value?: string): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .replace(/[;,]+$/g, "");
}

function buildCharacterPromptInsert(character: CharacterSlot): string {
  const name = normalizePromptInsertSegment(character.name) || "Character";
  const descriptor = normalizePromptInsertSegment(character.descriptor);
  const voice = normalizePromptInsertSegment(character.voiceStyleDefinition);
  const details: string[] = [];
  if (descriptor) details.push(`appearance: ${descriptor}`);
  if (voice) details.push(`voice: ${voice}`);
  return details.length ? `${name} (${details.join("; ")})` : name;
}

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function lockCount(value: number): StoryboardCount {
  if (value <= 1) return 1;
  if (value === 2) return 2;
  if (value === 3) return 3;
  if (value === 4) return 4;
  return 5;
}

function isGif(file?: File) {
  return !!file && (file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif"));
}

function createDefaultCharacters(count = 1): CharacterSlot[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index + 1}`,
    name: `Character ${index + 1}`,
    descriptor: "",
  }));
}

function releaseCharacterUrls(items: CharacterSlot[]) {
  for (const item of items) {
    if (item.previewUrl) {
      try {
        URL.revokeObjectURL(item.previewUrl);
      } catch {
        // ignore
      }
    }
  }
}

function fallbackProductionId(name: string) {
  const base = (name || "production")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "production";
  return `${base}_${Date.now()}`;
}

function statusBadgeClasses(tone: SaveTone) {
  if (tone === "success") return "border-emerald-400/35 bg-emerald-500/12 text-emerald-200";
  if (tone === "error") return "border-rose-400/35 bg-rose-500/12 text-rose-200";
  return "border-amber-300/35 bg-amber-500/12 text-amber-100";
}

async function uploadStoryboardImage(file: File): Promise<{ serverPath: string }> {
  const form = new FormData();
  form.append("image", file, file.name);
  const res = await fetch("/api/storyboard/upload", { method: "POST", headers: withDeviceHeader(), body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Upload failed");
  if (!data?.serverPath) throw new Error("Upload did not return serverPath");
  return { serverPath: String(data.serverPath) };
}

async function callVisionPrompt(args: {
  imagePath: string;
  characterName?: string;
  purpose?: "character" | "background";
}): Promise<{ descriptor: string }> {
  const res = await fetch("/api/vision-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...withDeviceHeader() },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error(data?.error || text || "Auto prompt failed");
  return { descriptor: String(data?.descriptor || "") };
}

async function callEnhancePrompt(args: { text: string; mode: "background" | "scene" | "descriptor"; context?: string }) {
  const res = await fetch("/api/enhance-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...withDeviceHeader() },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error(data?.error || text || "Enhance failed");
  return { enhanced: String(data?.enhanced || "") };
}

async function callRemoveBackground(imagePath: string) {
  const res = await fetch("/api/bg-remove", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...withDeviceHeader() },
    body: JSON.stringify({ imagePath }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Remove background failed");
  const nextPath = data?.bgRemovedPath ?? data?.outputPath ?? data?.serverPath;
  if (!nextPath) throw new Error("Remove background did not return a path");
  return { clearedPath: String(nextPath) };
}

async function createProductionBackground(args: { prompt: string; preset: BackgroundPresetKey }) {
  const res = await fetch("/api/production/background", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...withDeviceHeader() },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error(data?.error || text || "Create background failed");
  if (!data?.serverPath) throw new Error("Create background did not return a server path");
  return {
    serverPath: String(data.serverPath),
    previewUrl: String(data.previewUrl || `/api/file?path=${encodeURIComponent(String(data.serverPath))}`),
    promptId: String(data.promptId || ""),
  };
}

function buildPersistedState(input: {
  productionId: string;
  productionName: string;
  activeStep: ProductionStepKey;
  currentCard: number;
  characterCount: StoryboardCount | null;
  backgroundPrompt: string;
  backgroundPreset: BackgroundPresetKey;
  backgroundImagePath?: string;
  backgroundImageMode?: "upload" | "generated" | null;
  defaultLens: string;
  defaultMood: string;
  defaultStyle: string;
  defaultIdentity: string;
  positivePrompt: string;
  negativePrompt: string;
  usePreviousLength: boolean;
  usePreviousIdentityLock: boolean;
  usePreviousStyleLock: boolean;
  savedCardVideos: SavedCardVideo[];
  stitchedVideoPath?: string;
  completedAt?: string;
  status?: "active" | "completed";
  characters: CharacterSlot[];
}): PersistedProductionState {
  return {
    productionId: input.productionId,
    name: input.productionName.trim() || "Untitled Production",
    activeStep: input.activeStep,
    currentCard: input.currentCard,
    totalCards: 5,
    characterCount: input.characterCount,
    backgroundPrompt: input.backgroundPrompt,
    backgroundPreset: input.backgroundPreset,
    backgroundImagePath: input.backgroundImagePath,
    backgroundImageMode: input.backgroundImageMode || null,
    defaultLens: input.defaultLens,
    defaultMood: input.defaultMood,
    defaultStyle: input.defaultStyle,
    defaultIdentity: input.defaultIdentity,
    positivePrompt: input.positivePrompt,
    negativePrompt: input.negativePrompt,
    usePreviousLength: input.usePreviousLength,
    usePreviousIdentityLock: input.usePreviousIdentityLock,
    usePreviousStyleLock: input.usePreviousStyleLock,
    savedCardVideos: input.savedCardVideos.map((item) => ({
      card: item.card,
      imagePath: item.imagePath,
      imageUrl: item.imageUrl,
      videoPath: item.videoPath,
      videoUrl: item.videoUrl,
      audioPath: item.audioPath,
      audioUrl: item.audioUrl,
      prompt: item.prompt,
      characterNames: Array.isArray(item.characterNames) ? item.characterNames.filter(Boolean) : [],
    })),
    stitchedVideoPath: input.stitchedVideoPath,
    completedAt: input.completedAt,
    status: input.status || "active",
    characters: input.characters.map((character) => ({
      id: character.id,
      name: character.name,
      nameLocked: !!character.nameLocked,
      serverPath: character.serverPath,
      clearedServerPath: character.clearedServerPath,
      descriptor: character.descriptor,
      sourceCharacterId: character.sourceCharacterId,
      sourceCharacterName: character.sourceCharacterName,
      introVideoPath: character.introVideoPath,
      referenceAudioPath: character.referenceAudioPath,
      voiceStyleDefinition: character.voiceStyleDefinition,
      introLine: character.introLine,
    })),
  };
}

function builderSkeletonTitle(step: ProductionStepKey) {
  return PRODUCTION_STEPS.find((item) => item.key === step)?.label || "Production";
}

function ModalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[720px] rounded-[32px] border border-white/10 bg-[#090910] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)] md:p-6">
        <div className="mb-4 text-lg font-black text-white">{title}</div>
        {children}
      </div>
    </div>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-black/40 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm md:p-5">
      <div className="mb-4">
        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200/80">{title}</div>
        {subtitle ? <div className="mt-2 text-sm text-white/68">{subtitle}</div> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}


function CompletedProductionReview({ record, onBack }: { record: PersistedProductionRecord; onBack: () => void }) {
  const state = record.state;
  const scenes = Array.isArray(state.savedCardVideos)
    ? state.savedCardVideos
        .filter((scene) => !!scene.videoPath)
        .slice()
        .sort((a, b) => Number(a.card || 0) - Number(b.card || 0))
    : [];
  const stitchedUrl = state.stitchedVideoPath ? fileUrlFor(state.stitchedVideoPath) : "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-emerald-300/20 bg-emerald-500/10 px-4 py-4">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.18em] text-emerald-100">Completed / Read-only</div>
          <div className="mt-1 text-sm text-emerald-50/75">
            {scenes.length} scene{scenes.length === 1 ? "" : "s"} locked - completed {state.completedAt ? new Date(state.completedAt).toLocaleString() : new Date(record.updatedAt).toLocaleString()}
          </div>
        </div>
        <button type="button" onClick={onBack} className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/85">
          Back to Completed Projects
        </button>
      </div>

      {stitchedUrl ? (
        <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
          <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Final stitched video</div>
          <video controls className="mt-3 h-[320px] w-full rounded-[20px] bg-black object-contain">
            <source src={stitchedUrl} type="video/mp4" />
          </video>
          <div className="mt-3">
            <a href={stitchedUrl} download className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/85">
              Download Final Video
            </a>
          </div>
        </div>
      ) : null}

      {scenes.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {scenes.map((scene) => {
            const imageUrl = scene.imagePath ? fileUrlFor(scene.imagePath) : "";
            const videoUrl = fileUrlFor(scene.videoPath);
            return (
              <div key={scene.card} className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Scene {scene.card}</div>
                  <div className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-100">Locked</div>
                </div>
                {imageUrl ? (
                  <div className="mt-3 overflow-hidden rounded-[18px] border border-white/10 bg-black/35 p-3">
                    <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">Starter image</div>
                    <img src={imageUrl} alt={`Scene ${scene.card} starter image`} className="h-[220px] w-full rounded-[14px] object-contain" />
                  </div>
                ) : null}
                <div className="mt-3 overflow-hidden rounded-[18px] border border-white/10 bg-black/35 p-3">
                  <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">Locked video</div>
                  <video controls className="h-[240px] w-full rounded-[14px] bg-black object-contain">
                    <source src={videoUrl} type="video/mp4" />
                  </video>
                </div>
                {scene.prompt ? (
                  <div className="mt-3 rounded-[18px] border border-white/10 bg-black/35 px-4 py-3 text-xs text-white/70 whitespace-pre-wrap">{scene.prompt}</div>
                ) : null}
                {scene.characterNames?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {scene.characterNames.map((name) => (
                      <span key={`${scene.card}-${name}`} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/75">{name}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/65">No locked scenes were saved with this completed project.</div>
      )}
    </div>
  );
}

export default function StoryboardPanel() {
  const [panelMode, setPanelMode] = useState<PanelMode>("menu");
  const [draftProductionName, setDraftProductionName] = useState("");
  const [productionName, setProductionName] = useState("");
  const [activeProductionId, setActiveProductionId] = useState("");
  const [activeSummary, setActiveSummary] = useState<ProductionSummary | null>(null);
  const [savedProductions, setSavedProductions] = useState<ProductionSummary[]>([]);
  const [completedReviewRecord, setCompletedReviewRecord] = useState<PersistedProductionRecord | null>(null);
  const [menuBusy, setMenuBusy] = useState(false);
  const [menuError, setMenuError] = useState("");

  const [activeStep, setActiveStep] = useState<ProductionStepKey>("setup");
  const [characterCount, setCharacterCount] = useState<StoryboardCount | null>(1);
  const [backgroundPrompt, setBackgroundPrompt] = useState("a city cafe at sunset");
  const [backgroundPreset, setBackgroundPreset] = useState<BackgroundPresetKey>("realistic");
  const [backgroundImagePath, setBackgroundImagePath] = useState<string | undefined>(undefined);
  const [backgroundImageMode, setBackgroundImageMode] = useState<"upload" | "generated" | null>(null);
  const [backgroundImagePreview, setBackgroundImagePreview] = useState("");
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [backgroundError, setBackgroundError] = useState("");

  const [defaultLens, setDefaultLens] = useState("35mm");
  const [defaultMood, setDefaultMood] = useState("tense anticipation");
  const [defaultStyle, setDefaultStyle] = useState(STYLE_PRESETS[0]);
  const [defaultIdentity, setDefaultIdentity] = useState(IDENTITY_PRESETS[0]);

  const [characters, setCharacters] = useState<CharacterSlot[]>(() => createDefaultCharacters(1));
  const [activeCharacterIndex, setActiveCharacterIndex] = useState(0);

  const [positivePrompt, setPositivePrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [promptImagePath, setPromptImagePath] = useState<string | undefined>(undefined);
  const [promptImagePreview, setPromptImagePreview] = useState("");
  const [promptImageBusy, setPromptImageBusy] = useState(false);
  const [promptImageUploadBusy, setPromptImageUploadBusy] = useState(false);
  const [promptImageError, setPromptImageError] = useState("");
  // OTG_PRODUCTION_CHANGE_ANGLE_STATE
  const [productionAngleOpen, setProductionAngleOpen] = useState(false);
  const [productionAngleDirection, setProductionAngleDirection] = useState<"front" | "left" | "right" | "up" | "down">("right");
  const [productionAngleBusy, setProductionAngleBusy] = useState(false);
  const [productionAngleError, setProductionAngleError] = useState("");
  const [productionAngleResultUrl, setProductionAngleResultUrl] = useState("");
  const [productionAngleResultPath, setProductionAngleResultPath] = useState("");
  const [productionAngleResultLabel, setProductionAngleResultLabel] = useState("");
  const [recentImageOpen, setRecentImageOpen] = useState(false);
  const [recentImageBusy, setRecentImageBusy] = useState(false);
  const [recentImageError, setRecentImageError] = useState("");
  const [recentImages, setRecentImages] = useState<RecentProductionImage[]>([]);
  const [usePreviousLength, setUsePreviousLength] = useState(true);
  const [usePreviousIdentityLock, setUsePreviousIdentityLock] = useState(true);
  const [usePreviousStyleLock, setUsePreviousStyleLock] = useState(true);

  const [saveTone, setSaveTone] = useState<SaveTone>("warn");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [exitPromptOpen, setExitPromptOpen] = useState(false);
  const [stepMessage, setStepMessage] = useState("");

  const [enhanceBusyKey, setEnhanceBusyKey] = useState("");
  const [characterActionBusyKey, setCharacterActionBusyKey] = useState("");
  const [expandedImage, setExpandedImage] = useState<{ src: string; alt: string } | null>(null);
  const [currentCard, setCurrentCard] = useState(1);
  const totalCards = 5;
  const [voiceLibraryOpen, setVoiceLibraryOpen] = useState(false);
  const [voiceLibraryBusy, setVoiceLibraryBusy] = useState(false);
  const [voiceLibraryError, setVoiceLibraryError] = useState("");
  const [voiceLibrary, setVoiceLibrary] = useState<VoiceLibraryItem[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [selectedVoiceName, setSelectedVoiceName] = useState("");
  const [voiceDialogue, setVoiceDialogue] = useState("");
  const [voiceClipBusy, setVoiceClipBusy] = useState(false);
  const [voiceClipError, setVoiceClipError] = useState("");
  const [voiceClipDraftPath, setVoiceClipDraftPath] = useState<string | undefined>(undefined);
  const [voiceClipDraftUrl, setVoiceClipDraftUrl] = useState("");
  const [characterLibraryOpen, setCharacterLibraryOpen] = useState(false);
  const [characterLibraryBusy, setCharacterLibraryBusy] = useState(false);
  const [characterLibraryError, setCharacterLibraryError] = useState("");
  const [characterLibraryItems, setCharacterLibraryItems] = useState<CharacterLibraryRecord[]>([]);
  const [characterLibraryTargetIndex, setCharacterLibraryTargetIndex] = useState<number | null>(null);
  const [savedVoiceClipPath, setSavedVoiceClipPath] = useState<string | undefined>(undefined);
  const [savedVoiceClipUrl, setSavedVoiceClipUrl] = useState("");
  const [useCustomVoice, setUseCustomVoice] = useState(true);
  const [videoDurationSec, setVideoDurationSec] = useState(5);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [videoPath, setVideoPath] = useState<string | undefined>(undefined);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState("");
  const [savedCardVideos, setSavedCardVideos] = useState<SavedCardVideo[]>([]);
  const [stitchedVideoPath, setStitchedVideoPath] = useState<string | undefined>(undefined);
  const [stitchedVideoUrl, setStitchedVideoUrl] = useState("");
  const [stitchBusy, setStitchBusy] = useState(false);
  const [stitchError, setStitchError] = useState("");

  const backgroundInputRef = useRef<HTMLInputElement | null>(null);
  const characterInputRef = useRef<HTMLInputElement | null>(null);
  const promptImageInputRef = useRef<HTMLInputElement | null>(null);
  const lastSavedSignatureRef = useRef("");
  const positivePromptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const positivePromptSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const latestVideoRequestRef = useRef("");

  useEffect(() => {
    try {
      window.localStorage.setItem(OVERLAY_MODE_KEY, "production");
      window.dispatchEvent(new CustomEvent("otg:overlay-mode", { detail: "production" }));
    } catch {
      // ignore
    }
    return () => {
      try {
        window.localStorage.removeItem(OVERLAY_MODE_KEY);
        window.dispatchEvent(new CustomEvent("otg:overlay-mode", { detail: "" }));
      } catch {
        // ignore
      }
      releaseCharacterUrls(characters);
      if (backgroundImagePreview && backgroundImagePreview.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(backgroundImagePreview);
        } catch {
          // ignore
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!characterCount) return;
    setCharacters((previous) => {
      const next: CharacterSlot[] = [];
      for (let index = 0; index < characterCount; index += 1) {
        next.push(previous[index] || { id: `c${index + 1}`, name: `Character ${index + 1}`, descriptor: "" });
      }
      for (let index = characterCount; index < previous.length; index += 1) {
        const url = previous[index]?.previewUrl;
        if (url) {
          try {
            URL.revokeObjectURL(url);
          } catch {
            // ignore
          }
        }
      }
      return next;
    });
    setActiveCharacterIndex((prev) => Math.max(0, Math.min(prev, characterCount - 1)));
  }, [characterCount]);

  const persistedState = useMemo(
    () =>
      buildPersistedState({
        productionId: activeProductionId || fallbackProductionId(productionName || draftProductionName),
        productionName: productionName || draftProductionName || "Untitled Production",
        activeStep,
        currentCard,
        characterCount,
        backgroundPrompt,
        backgroundPreset,
        backgroundImagePath,
        backgroundImageMode,
        defaultLens,
        defaultMood,
        defaultStyle,
        defaultIdentity,
        positivePrompt,
        negativePrompt,
        usePreviousLength,
        usePreviousIdentityLock,
        usePreviousStyleLock,
        savedCardVideos,
        stitchedVideoPath,
        status: "active",
        characters,
      }),
    [
      activeProductionId,
      productionName,
      draftProductionName,
      activeStep,
      currentCard,
      characterCount,
      backgroundPrompt,
      backgroundPreset,
      backgroundImagePath,
      backgroundImageMode,
      defaultLens,
      defaultMood,
      defaultStyle,
      defaultIdentity,
      positivePrompt,
      negativePrompt,
      usePreviousLength,
      usePreviousIdentityLock,
      usePreviousStyleLock,
      savedCardVideos,
      stitchedVideoPath,
      characters,
    ]
  );

  const signature = useMemo(() => JSON.stringify(persistedState), [persistedState]);
  const hasUnsavedChanges = panelMode === "builder" && signature !== lastSavedSignatureRef.current;

  useEffect(() => {
    if (panelMode !== "builder") return;
    if (saveTone === "error" && !hasUnsavedChanges) return;
    setSaveTone(hasUnsavedChanges ? "warn" : "success");
  }, [panelMode, hasUnsavedChanges, saveTone]);

  useEffect(() => {
    if (!savedNotice) return;
    const timeout = window.setTimeout(() => setSavedNotice(""), 3000);
    return () => window.clearTimeout(timeout);
  }, [savedNotice]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  const activeCharacters = useMemo(() => {
    if (!characterCount) return [];
    return characters.slice(0, characterCount);
  }, [characters, characterCount]);

  const activeCharacter = activeCharacters[activeCharacterIndex] || activeCharacters[0] || null;
  const activeCharacterPreviewUrl = activeCharacter
    ? activeCharacter.previewUrl || fileUrlFor(activeCharacter.clearedServerPath || activeCharacter.serverPath)
    : "";
  const preferredCharacterVoice = useMemo(() => {
    if (!useCustomVoice) return null;
    const loaded = activeCharacters.find((character) => !!character.referenceAudioPath);
    if (!loaded?.referenceAudioPath) return null;
    return {
      slotId: loaded.id,
      name: loaded.sourceCharacterName || loaded.name || "Character",
      audioPath: String(loaded.referenceAudioPath),
      audioUrl: fileUrlFor(String(loaded.referenceAudioPath)),
    };
  }, [activeCharacters, useCustomVoice]);
  const promptInsertCharacters = useMemo(
    () =>
      activeCharacters.filter((character) => {
        const hasName = !!normalizePromptInsertSegment(character.name);
        const hasDescriptor = !!normalizePromptInsertSegment(character.descriptor);
        const hasVoice = !!normalizePromptInsertSegment(character.voiceStyleDefinition);
        return hasName && (hasDescriptor || hasVoice);
      }),
    [activeCharacters]
  );
  const promptHasHardRuleFormat = useMemo(() => hasRequiredIdLoraPromptFormat(positivePrompt), [positivePrompt]);

  useEffect(() => {
    if (!useCustomVoice) return;
    if (!preferredCharacterVoice?.audioPath) return;
    const nextName = `${preferredCharacterVoice.name} (loaded character)`;
    if (
      savedVoiceClipPath === preferredCharacterVoice.audioPath &&
      savedVoiceClipUrl === preferredCharacterVoice.audioUrl &&
      selectedVoiceName === nextName &&
      !selectedVoiceId
    ) {
      return;
    }
    setSelectedVoiceId("");
    setSelectedVoiceName(nextName);
    setSavedVoiceClipPath(preferredCharacterVoice.audioPath);
    setSavedVoiceClipUrl(preferredCharacterVoice.audioUrl);
    setVoiceClipDraftPath(undefined);
    setVoiceClipDraftUrl("");
    setVoiceClipError("");
  }, [
    useCustomVoice,
    preferredCharacterVoice?.audioPath,
    preferredCharacterVoice?.audioUrl,
    preferredCharacterVoice?.name,
    savedVoiceClipPath,
    savedVoiceClipUrl,
    selectedVoiceId,
    selectedVoiceName,
  ]);

  const openExpandedImage = (src?: string, alt = "Preview image") => {
    if (!src) return;
    setExpandedImage({ src, alt });
  };

  function capturePositivePromptSelection(event: React.SyntheticEvent<HTMLTextAreaElement>) {
    positivePromptTextareaRef.current = event.currentTarget;
    positivePromptSelectionRef.current = {
      start: event.currentTarget.selectionStart ?? 0,
      end: event.currentTarget.selectionEnd ?? 0,
    };
  }

  function applyIdLoraPromptTemplate() {
    const nextPrompt = promptHasHardRuleFormat ? positivePrompt : ID_LORA_PROMPT_TEMPLATE;
    setPositivePrompt(nextPrompt);
    requestAnimationFrame(() => {
      const target = positivePromptTextareaRef.current;
      if (!target) return;
      const visualIndex = nextPrompt.search(/\[VISUAL\]:/i);
      const insertIndex = visualIndex >= 0 ? visualIndex + "[VISUAL]: ".length : nextPrompt.length;
      target.focus();
      target.setSelectionRange(insertIndex, insertIndex);
      positivePromptSelectionRef.current = { start: insertIndex, end: insertIndex };
    });
  }

  function insertCharacterIntoPositivePrompt(character: CharacterSlot) {
    const insertText = buildCharacterPromptInsert(character);
    if (!insertText.trim()) return;
    const basePrompt = promptHasHardRuleFormat ? positivePrompt : ID_LORA_PROMPT_TEMPLATE;
    const fallbackIndex = basePrompt.search(/\[VISUAL\]:/i);
    const defaultStart = fallbackIndex >= 0 ? fallbackIndex + "[VISUAL]: ".length : basePrompt.length;
    const selection = positivePromptSelectionRef.current;
    const start = Number.isFinite(selection.start) ? selection.start : defaultStart;
    const end = Number.isFinite(selection.end) ? selection.end : start;
    const safeStart = Math.max(0, Math.min(start, basePrompt.length));
    const safeEnd = Math.max(safeStart, Math.min(end, basePrompt.length));
    const leading = safeStart > 0 && !/^[\s\n]/.test(basePrompt.slice(safeStart)) && !/[\s\n]$/.test(basePrompt.slice(0, safeStart)) ? " " : "";
    const trailing = safeEnd < basePrompt.length && !/^[\s\n]/.test(basePrompt.slice(safeEnd)) ? " " : "";
    const nextValue = `${basePrompt.slice(0, safeStart)}${leading}${insertText}${trailing}${basePrompt.slice(safeEnd)}`;
    const nextCursor = safeStart + leading.length + insertText.length + trailing.length;
    setPositivePrompt(nextValue);
    requestAnimationFrame(() => {
      const target = positivePromptTextareaRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(nextCursor, nextCursor);
      positivePromptSelectionRef.current = { start: nextCursor, end: nextCursor };
    });
  }

  const setupComplete = !!productionName.trim() && !!characterCount && !!backgroundImagePath;
  const charactersComplete =
    !!characterCount &&
    activeCharacters.length === characterCount &&
    activeCharacters.every((character) => !!character.name.trim() && !!character.serverPath);


  const promptReady = !!positivePrompt.trim() && !!promptImagePath;

  const stepItems = useMemo<ProductionStepItem[]>(
    () =>
      PRODUCTION_STEPS.map((step, index) => ({
        key: step.key,
        index: index + 1,
        label: step.label,
        complete:
          step.key === "setup"
            ? setupComplete
            : step.key === "characters"
              ? charactersComplete
              : step.key === "prompt"
                ? promptReady
                : false,
        locked:
          step.key === "characters"
            ? !setupComplete
            : step.key === "prompt"
              ? !setupComplete || !charactersComplete
              : false,
      })),
    [setupComplete, charactersComplete, promptReady]
  );

  const currentStepMeta = PRODUCTION_STEPS.find((step) => step.key === activeStep) || PRODUCTION_STEPS[0];

  async function refreshProductionList() {
    setMenuBusy(true);
    setMenuError("");
    try {
      const res = await fetch("/api/production", { cache: "no-store", headers: withDeviceHeader() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to load productions");
      setSavedProductions(Array.isArray(data?.items) ? (data.items as ProductionSummary[]) : []);
    } catch (error: any) {
      setMenuError(error?.message || String(error));
      setSavedProductions([]);
    } finally {
      setMenuBusy(false);
    }
  }

  async function refreshActiveProduction() {
    try {
      const res = await fetch("/api/production?mode=active", { cache: "no-store", headers: withDeviceHeader() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to load active production");
      const summary = (data?.summary as ProductionSummary | null) || null;
      setActiveSummary(summary && summary.status !== "completed" ? summary : null);
    } catch {
      setActiveSummary(null);
    }
  }

  useEffect(() => {
    refreshActiveProduction().catch(() => void 0);
  }, []);

  async function refreshCharacterLibrary() {
    setCharacterLibraryBusy(true);
    setCharacterLibraryError("");
    try {
      const res = await fetch("/api/characters", { cache: "no-store", headers: withDeviceHeader() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to load character library");
      setCharacterLibraryItems(Array.isArray(data?.items) ? (data.items as CharacterLibraryRecord[]) : []);
    } catch (error: any) {
      setCharacterLibraryError(error?.message || String(error));
      setCharacterLibraryItems([]);
    } finally {
      setCharacterLibraryBusy(false);
    }
  }

  function openCharacterLibraryForSlot(slotIndex: number) {
    setCharacterLibraryTargetIndex(slotIndex);
    setCharacterLibraryOpen(true);
    setCharacterLibraryError("");
    refreshCharacterLibrary().catch(() => void 0);
  }

  function applyLibraryCharacterToSlot(slotIndex: number, item: CharacterLibraryRecord) {
    setCharacters((previous) =>
      previous.map((character, index) => {
        if (index !== slotIndex) return character;
        return {
          ...character,
          name: item.name || character.name,
          nameLocked: false,
          serverPath: item.imagePath,
          clearedServerPath: undefined,
          previewUrl: fileUrlFor(item.imagePath),
          descriptor: item.description || character.descriptor,
          sourceCharacterId: item.id,
          sourceCharacterName: item.name,
          introVideoPath: undefined,
          referenceAudioPath: item.referenceAudioPath,
          voiceStyleDefinition: item.voiceStyleDefinition,
          introLine: item.introLine,
          status: `${item.name} loaded from Character Library. ID-LoRA workflow will use the saved reference image and saved default voice for this slot.`,
          error: "",
        };
      })
    );
    setCharacterLibraryOpen(false);
    setCharacterLibraryTargetIndex(null);
    setCharacterLibraryError("");
    setStepMessage(`${item.name} loaded into Character ${slotIndex + 1}. Production is now using the saved library image and saved default voice for this slot.`);
  }

  function resetBuilderState(nextName = "") {
    setCompletedReviewRecord(null);
    releaseCharacterUrls(characters);
    if (backgroundImagePreview && backgroundImagePreview.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(backgroundImagePreview);
      } catch {
        // ignore
      }
    }

    setProductionName(nextName);
    setDraftProductionName(nextName);
    setActiveProductionId("");
    setActiveStep("setup");
    setCharacterCount(1);
    setBackgroundPrompt("a city cafe at sunset");
    setBackgroundPreset("realistic");
    setBackgroundImagePath(undefined);
    setBackgroundImageMode(null);
    setBackgroundImagePreview("");
    setRenameOpen(false);
    setRenameDraft("");
    setBackgroundError("");
    setDefaultLens("35mm");
    setDefaultMood("tense anticipation");
    setDefaultStyle(STYLE_PRESETS[0]);
    setDefaultIdentity(IDENTITY_PRESETS[0]);
    setCharacters(createDefaultCharacters(1));
    setActiveCharacterIndex(0);
    setCurrentCard(1);
    setSelectedVoiceId("");
    setSelectedVoiceName("");
    setVoiceDialogue("");
    setVoiceClipDraftPath(undefined);
    setVoiceClipDraftUrl("");
    setCharacterLibraryOpen(false);
    setCharacterLibraryBusy(false);
    setCharacterLibraryError("");
    setCharacterLibraryItems([]);
    setCharacterLibraryTargetIndex(null);
    setSavedVoiceClipPath(undefined);
    setSavedVoiceClipUrl("");
    setUseCustomVoice(true);
    setVideoDurationSec(5);
    setVideoBusy(false);
    setVideoError("");
    setVideoPath(undefined);
    setVideoPreviewUrl("");
    setSavedCardVideos([]);
    setStitchedVideoPath(undefined);
    setStitchedVideoUrl("");
    setStitchBusy(false);
    setStitchError("");
    setPositivePrompt("");
    setNegativePrompt("");
    setPromptImagePath(undefined);
    setPromptImagePreview("");
    setPromptImageError("");
    setUsePreviousLength(true);
    setUsePreviousIdentityLock(true);
    setUsePreviousStyleLock(true);
    setSaveTone("warn");
    setSaveError("");
    setSavedNotice("");
    setStepMessage("");
    lastSavedSignatureRef.current = "";
  }

  function hydrateFromProduction(record: PersistedProductionRecord) {
    const state = record.state;
    if (state?.status === "completed" || state?.completedAt) {
      setCompletedReviewRecord(record);
      setPanelMode("completedView");
      setActiveSummary(null);
      setMenuError("");
      return;
    }
    releaseCharacterUrls(characters);
    if (backgroundImagePreview && backgroundImagePreview.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(backgroundImagePreview);
      } catch {
        // ignore
      }
    }

    const nextCharacters = (state.characters || []).map((character, index) => ({
      id: character.id || `c${index + 1}`,
      name: character.name || `Character ${index + 1}`,
      nameLocked: !!character.nameLocked,
      descriptor: character.descriptor || "",
      serverPath: character.serverPath,
      clearedServerPath: character.clearedServerPath,
      sourceCharacterId: character.sourceCharacterId,
      sourceCharacterName: character.sourceCharacterName,
      introVideoPath: character.introVideoPath,
      referenceAudioPath: character.referenceAudioPath,
      voiceStyleDefinition: character.voiceStyleDefinition,
      introLine: character.introLine,
      previewUrl: fileUrlFor(character.clearedServerPath || character.serverPath),
    }));

    const hydratedScenes: SavedCardVideo[] = Array.isArray(state.savedCardVideos)
      ? state.savedCardVideos
          .map((scene) => ({
            card: Number(scene.card || 1),
            imagePath: scene.imagePath,
            imageUrl: scene.imagePath ? fileUrlFor(scene.imagePath) : "",
            videoPath: scene.videoPath,
            videoUrl: fileUrlFor(scene.videoPath),
            audioPath: scene.audioPath,
            audioUrl: scene.audioPath ? fileUrlFor(scene.audioPath) : "",
            prompt: scene.prompt || "",
            characterNames: Array.isArray(scene.characterNames) ? scene.characterNames : [],
          }))
          .filter((scene) => scene.videoPath)
          .sort((a, b) => a.card - b.card)
      : [];
    const loadedCurrentCard = Math.max(1, Number(state.currentCard || Math.min(5, (hydratedScenes[hydratedScenes.length - 1]?.card || 0) + 1) || 1));
    const loadedStitchedPath = String(state.stitchedVideoPath || "").trim();

    setCompletedReviewRecord(null);
    setPanelMode("builder");
    setActiveProductionId(record.id);
    setProductionName(record.name);
    setDraftProductionName(record.name);
    setActiveStep(state.activeStep || "setup");
    setCharacterCount(state.characterCount || 1);
    setBackgroundPrompt(state.backgroundPrompt || "");
    setBackgroundPreset((state.backgroundPreset as BackgroundPresetKey) || "realistic");
    setBackgroundImagePath(state.backgroundImagePath);
    setBackgroundImageMode(state.backgroundImageMode || null);
    setBackgroundImagePreview(state.backgroundImagePath ? `/api/file?path=${encodeURIComponent(state.backgroundImagePath)}` : "");
    setBackgroundError("");
    setRenameOpen(false);
    setRenameDraft(record.name || state.name || "");
    setDefaultLens(state.defaultLens || "35mm");
    setDefaultMood(state.defaultMood || "");
    setDefaultStyle(state.defaultStyle || STYLE_PRESETS[0]);
    setDefaultIdentity(state.defaultIdentity || IDENTITY_PRESETS[0]);
    setCharacters(nextCharacters.length ? nextCharacters : createDefaultCharacters(state.characterCount || 1));
    setActiveCharacterIndex(0);
    setCurrentCard(loadedCurrentCard);
    setVoiceClipDraftPath(undefined);
    setVoiceClipDraftUrl("");
    setCharacterLibraryOpen(false);
    setCharacterLibraryBusy(false);
    setCharacterLibraryError("");
    setCharacterLibraryItems([]);
    setCharacterLibraryTargetIndex(null);
    setSavedVoiceClipPath(undefined);
    setSavedVoiceClipUrl("");
    setVideoPath(undefined);
    setVideoPreviewUrl("");
    setSavedCardVideos(hydratedScenes);
    setStitchedVideoPath(loadedStitchedPath || undefined);
    setStitchedVideoUrl(loadedStitchedPath ? fileUrlFor(loadedStitchedPath) : "");
    setStitchBusy(false);
    setStitchError("");
    setPositivePrompt(state.positivePrompt || "");
    setNegativePrompt(state.negativePrompt || "");
    setPromptImagePath(undefined);
    setPromptImagePreview("");
    setPromptImageError("");
    setUsePreviousLength(!!state.usePreviousLength);
    setUsePreviousIdentityLock(!!state.usePreviousIdentityLock);
    setUsePreviousStyleLock(!!state.usePreviousStyleLock);
    setSaveError("");
    setSavedNotice("");
    setStepMessage("");

    const nextSignature = JSON.stringify(
      buildPersistedState({
        productionId: record.id,
        productionName: record.name,
        activeStep: state.activeStep || "setup",
        currentCard: loadedCurrentCard,
        characterCount: (state.characterCount || 1) as StoryboardCount,
        backgroundPrompt: state.backgroundPrompt || "",
        backgroundPreset: (state.backgroundPreset as BackgroundPresetKey) || "realistic",
        backgroundImagePath: state.backgroundImagePath,
        backgroundImageMode: state.backgroundImageMode || null,
        defaultLens: state.defaultLens || "35mm",
        defaultMood: state.defaultMood || "",
        defaultStyle: state.defaultStyle || STYLE_PRESETS[0],
        defaultIdentity: state.defaultIdentity || IDENTITY_PRESETS[0],
        positivePrompt: state.positivePrompt || "",
        negativePrompt: state.negativePrompt || "",
        usePreviousLength: !!state.usePreviousLength,
        usePreviousIdentityLock: !!state.usePreviousIdentityLock,
        usePreviousStyleLock: !!state.usePreviousStyleLock,
        stitchedVideoPath: loadedStitchedPath || undefined,
        completedAt: state.completedAt,
        status: state.status || "active",
        savedCardVideos: Array.isArray(state.savedCardVideos)
          ? state.savedCardVideos.map((scene) => ({
              card: Number(scene.card || 1),
              imagePath: scene.imagePath,
              imageUrl: scene.imagePath ? fileUrlFor(scene.imagePath) : "",
              videoPath: scene.videoPath,
              videoUrl: fileUrlFor(scene.videoPath),
              audioPath: scene.audioPath,
              audioUrl: scene.audioPath ? fileUrlFor(scene.audioPath) : "",
              prompt: scene.prompt || "",
              characterNames: Array.isArray(scene.characterNames) ? scene.characterNames : [],
            }))
          : [],
        characters: nextCharacters.length ? nextCharacters : createDefaultCharacters(state.characterCount || 1),
      })
    );
    lastSavedSignatureRef.current = nextSignature;
    setSaveTone("success");
    setActiveSummary({
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      currentCard: loadedCurrentCard,
      totalCards: state.totalCards || 5,
      characterCount: nextCharacters.length,
      activeStep: state.activeStep || "setup",
      sceneCount: Array.isArray(state.savedCardVideos) ? state.savedCardVideos.length : 0,
      stitchedVideoPath: state.stitchedVideoPath || undefined,
      completedAt: state.completedAt || undefined,
      status: String(state.status || "") === "completed" || state.completedAt ? "completed" : "active",
    });
  }

  function startNewProduction() {
    const nextName = draftProductionName.trim();
    if (!nextName) {
      setMenuError("Production name is required.");
      return;
    }
    setCompletedReviewRecord(null);
    resetBuilderState(nextName);
    setProductionName(nextName);
    setDraftProductionName(nextName);
    setPanelMode("builder");
  }

  async function continueActiveProduction() {
    setMenuBusy(true);
    setMenuError("");
    try {
      const res = await fetch("/api/production?mode=active", { cache: "no-store", headers: withDeviceHeader() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to continue production");
      if (!data?.production) throw new Error("No active production found");
      const record = data.production as PersistedProductionRecord;
      if (record.state?.status === "completed" || record.state?.completedAt) {
        setActiveSummary(null);
        throw new Error("That production is completed and read-only. Open it from Completed Projects.");
      }
      hydrateFromProduction(record);
    } catch (error: any) {
      setMenuError(error?.message || String(error));
    } finally {
      setMenuBusy(false);
    }
  }

  async function loadProductionById(productionId: string) {
    setMenuBusy(true);
    setMenuError("");
    try {
      const res = await fetch(`/api/production?mode=load&productionId=${encodeURIComponent(productionId)}`, { cache: "no-store", headers: withDeviceHeader() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to load production");
      if (!data?.production) throw new Error("Production not found");
      const record = data.production as PersistedProductionRecord;
      if (record.state?.status === "completed" || record.state?.completedAt) {
        setCompletedReviewRecord(record);
        setPanelMode("completedView");
        setActiveSummary(null);
        return;
      }
      hydrateFromProduction(record);
    } catch (error: any) {
      setMenuError(error?.message || String(error));
    } finally {
      setMenuBusy(false);
    }
  }

  async function openCompletedProductionById(productionId: string) {
    setMenuBusy(true);
    setMenuError("");
    try {
      const res = await fetch(`/api/production?mode=load&productionId=${encodeURIComponent(productionId)}`, { cache: "no-store", headers: withDeviceHeader() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to load completed production");
      if (!data?.production) throw new Error("Completed production not found");
      const record = data.production as PersistedProductionRecord;
      if (!(record.state?.status === "completed" || record.state?.completedAt)) {
        throw new Error("This production is still editable. Open it from Load Production.");
      }
      setCompletedReviewRecord(record);
      setPanelMode("completedView");
      setActiveSummary(null);
    } catch (error: any) {
      setMenuError(error?.message || String(error));
    } finally {
      setMenuBusy(false);
    }
  }

  async function deleteProductionById(productionId: string, name: string) {
    const ok = window.confirm(`Delete production \"${name}\"?`);
    if (!ok) return;
    setMenuBusy(true);
    setMenuError("");
    try {
      const res = await fetch("/api/production", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...withDeviceHeader() },
        body: JSON.stringify({ action: "delete", productionId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      setSavedProductions(Array.isArray(data?.items) ? (data.items as ProductionSummary[]) : []);
      if (activeProductionId === productionId) {
        setActiveProductionId("");
        setActiveSummary(null);
      }
    } catch (error: any) {
      setMenuError(error?.message || String(error));
    } finally {
      setMenuBusy(false);
    }
  }

  type ProductionSaveOverrides = {
    activeStep?: ProductionStepKey;
    currentCard?: number;
    characterCount?: StoryboardCount | null;
    backgroundPrompt?: string;
    backgroundPreset?: BackgroundPresetKey;
    backgroundImagePath?: string | undefined;
    backgroundImageMode?: "upload" | "generated" | null;
    positivePrompt?: string;
    negativePrompt?: string;
    characters?: CharacterSlot[];
    savedCardVideos?: SavedCardVideo[];
    stitchedVideoPath?: string | undefined;
    completedAt?: string | undefined;
    status?: "active" | "completed";
    savedNoticeText?: string;
  };

  async function saveProductionState(overrides: ProductionSaveOverrides = {}) {
    setSaveBusy(true);
    setSaveError("");
    try {
      const nextActiveStep = overrides.activeStep ?? activeStep;
      const nextCurrentCard = overrides.currentCard ?? currentCard;
      const nextCharacterCount = "characterCount" in overrides ? overrides.characterCount ?? null : characterCount;
      const nextBackgroundPrompt = "backgroundPrompt" in overrides ? String(overrides.backgroundPrompt || "") : backgroundPrompt;
      const nextBackgroundPreset = overrides.backgroundPreset ?? backgroundPreset;
      const nextBackgroundImagePath = "backgroundImagePath" in overrides ? overrides.backgroundImagePath : backgroundImagePath;
      const nextBackgroundImageMode = "backgroundImageMode" in overrides ? overrides.backgroundImageMode || null : backgroundImageMode;
      const nextPositivePrompt = "positivePrompt" in overrides ? String(overrides.positivePrompt || "") : positivePrompt;
      const nextNegativePrompt = "negativePrompt" in overrides ? String(overrides.negativePrompt || "") : negativePrompt;
      const nextCharacters = overrides.characters ?? characters;
      const nextSavedScenes = overrides.savedCardVideos ?? savedCardVideos;
      const nextStitchedVideoPath = "stitchedVideoPath" in overrides ? overrides.stitchedVideoPath : stitchedVideoPath;

      const nextState = buildPersistedState({
        productionId: activeProductionId || persistedState.productionId,
        productionName: productionName || draftProductionName || "Untitled Production",
        activeStep: nextActiveStep,
        currentCard: nextCurrentCard,
        characterCount: nextCharacterCount,
        backgroundPrompt: nextBackgroundPrompt,
        backgroundPreset: nextBackgroundPreset,
        backgroundImagePath: nextBackgroundImagePath,
        backgroundImageMode: nextBackgroundImageMode,
        defaultLens,
        defaultMood,
        defaultStyle,
        defaultIdentity,
        positivePrompt: nextPositivePrompt,
        negativePrompt: nextNegativePrompt,
        usePreviousLength,
        usePreviousIdentityLock,
        usePreviousStyleLock,
        savedCardVideos: nextSavedScenes,
        stitchedVideoPath: nextStitchedVideoPath,
        completedAt: overrides.completedAt,
        status: overrides.status || "active",
        characters: nextCharacters,
      });

      const payload = {
        ...nextState,
        productionId: activeProductionId || nextState.productionId,
        name: (productionName || draftProductionName).trim() || "Untitled Production",
      };
      const res = await fetch("/api/production", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...withDeviceHeader() },
        body: JSON.stringify({ action: "save", production: payload }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Save failed");
      const saved = data?.production as PersistedProductionRecord;
      const summary = data?.summary as ProductionSummary | null;
      const savedId = saved?.id || payload.productionId;
      const savedName = saved?.name || payload.name;
      setActiveProductionId(overrides.status === "completed" ? "" : savedId);
      setProductionName(savedName);
      setDraftProductionName(savedName);
      lastSavedSignatureRef.current = JSON.stringify({ ...payload, productionId: savedId, name: savedName });
      setSaveTone("success");
      setSavedNotice(overrides.savedNoticeText || "Production saved");
      setActiveSummary(overrides.status === "completed" ? null : summary || null);
      refreshProductionList().catch(() => void 0);
      refreshActiveProduction().catch(() => void 0);
      return true;
    } catch (error: any) {
      setSaveTone("error");
      setSaveError(error?.message || String(error));
      return false;
    } finally {
      setSaveBusy(false);
    }
  }

  function requestExitToMenu() {
    if (!hasUnsavedChanges) {
      setPanelMode("menu");
      setMenuError("");
      return;
    }
    setExitPromptOpen(true);
  }

  async function saveAndExit() {
    const ok = await saveProductionState();
    if (!ok) return;
    setExitPromptOpen(false);
    setPanelMode("menu");
  }

  function discardAndExit() {
    setExitPromptOpen(false);
    setPanelMode("menu");
  }

  function setStepWithGuard(step: ProductionStepKey) {
    setStepMessage("");
    if (step === "characters" && !setupComplete) {
      const missing: string[] = [];
      if (!productionName.trim()) missing.push("production name");
      if (!characterCount) missing.push("character count");
      if (!backgroundImagePath) missing.push("background image");
      setStepMessage(`Setup is not complete yet. Missing: ${missing.join(", ")}.`);
      return;
    }
    if (step === "prompt" && (!setupComplete || !charactersComplete)) {
      setStepMessage("Characters are not ready yet. Upload the required character references first.");
      return;
    }
    if (step === "video" && !promptReady) {
      setStepMessage("Prompt Builder is not ready yet. Create and keep a picture first.");
      return;
    }
    if ((step === "review" || step === "stitch") && savedCardVideos.length < 1) {
      setStepMessage("Lock at least one scene video before opening Review or Stitch.");
      return;
    }
    setActiveStep(step);
  }

  function goToPreviousStep() {
    if (activeStep === "stitch") {
      setActiveStep("review");
      setStepMessage("");
      return;
    }
    if (activeStep === "review") {
      setActiveStep("video");
      setStepMessage("");
      return;
    }
    const order: ProductionStepKey[] = ["setup", "characters", "prompt", "video"];
    const currentIndex = order.indexOf(activeStep);
    if (currentIndex <= 0) return;
    setActiveStep(order[currentIndex - 1]);
    setStepMessage("");
  }

  function goToNextStep() {
    if (activeStep === "video") {
      setStepMessage("Use Lock Scene, Next Scene, or Finish Video after a scene video is ready.");
      return;
    }
    if (activeStep === "review") {
      setStepWithGuard("stitch");
      return;
    }
    if (activeStep === "stitch") {
      setStepMessage("Use Stitch Video, then Complete Project after reviewing the stitched output.");
      return;
    }
    const order: ProductionStepKey[] = ["setup", "characters", "prompt", "video"];
    const currentIndex = order.indexOf(activeStep);
    if (currentIndex < 0 || currentIndex >= order.length - 1) return;
    setStepWithGuard(order[currentIndex + 1]);
  }

  function previousStepLabel() {
    if (activeStep === "characters") return "Previous Step Setup";
    if (activeStep === "prompt") return "Previous Step Characters";
    if (activeStep === "video") return "Previous Step Prompt Builder";
    if (activeStep === "review") return "Previous Step Create Video";
    if (activeStep === "stitch") return "Previous Step Review";
    return "";
  }

  function nextStepLabel() {
    if (activeStep === "setup") return "Next Step Characters";
    if (activeStep === "characters") return "Next Step Prompt Builder";
    if (activeStep === "prompt") return "Next Step Create Video";
    if (activeStep === "review") return "Next Step Stitch";
    return "";
  }

  async function enhanceField(key: string, mode: "background" | "scene" | "descriptor", text: string, setter: (value: string) => void) {
    if (!text.trim()) return;
    setEnhanceBusyKey(key);
    setBackgroundError("");
    try {
      const result = await callEnhancePrompt({ text, mode });
      setter(result.enhanced);
    } catch (error: any) {
      setBackgroundError(error?.message || String(error));
    } finally {
      setEnhanceBusyKey("");
    }
  }

  function applyBackgroundPreset(nextPreset: BackgroundPresetKey) {
    const preset = BACKGROUND_PRESETS.find((item) => item.key === nextPreset);
    setBackgroundPreset(nextPreset);
    if (!preset) return;
    const current = backgroundPrompt.trim();
    if (!current) {
      setBackgroundPrompt(preset.inject);
      return;
    }
    if (current.toLowerCase().includes(preset.inject.toLowerCase())) return;
    setBackgroundPrompt(`${preset.inject}, ${current}`);
  }

  async function handleCreateBackground() {
    if (!backgroundPrompt.trim()) {
      setBackgroundError("Global background prompt is required.");
      return;
    }
    setBackgroundBusy(true);
    setBackgroundError("");
    try {
      const created = await createProductionBackground({ prompt: backgroundPrompt, preset: backgroundPreset });
      if (backgroundImagePreview && backgroundImagePreview.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(backgroundImagePreview);
        } catch {
          // ignore
        }
      }
      setBackgroundImagePath(created.serverPath);
      setBackgroundImageMode("generated");
      setBackgroundImagePreview(created.previewUrl);
      setStepMessage("Background created and saved to Setup.");
    } catch (error: any) {
      setBackgroundError(error?.message || String(error));
    } finally {
      setBackgroundBusy(false);
    }
  }

  async function handleBackgroundUpload(file: File) {
    if (!ACCEPTED_TYPES.includes(file.type) && !file.name.toLowerCase().match(/\.(png|jpe?g|webp|gif)$/)) {
      setBackgroundError("Use PNG, JPG, WEBP, or GIF.");
      return;
    }
    setBackgroundBusy(true);
    setBackgroundError("");
    try {
      const previewUrl = URL.createObjectURL(file);
      const upload = await uploadStoryboardImage(file);
      if (backgroundImagePreview && backgroundImagePreview.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(backgroundImagePreview);
        } catch {
          // ignore
        }
      }
      setBackgroundImagePath(upload.serverPath);
      setBackgroundImageMode("upload");
      setBackgroundImagePreview(previewUrl);
    } catch (error: any) {
      setBackgroundError(error?.message || String(error));
    } finally {
      setBackgroundBusy(false);
      if (backgroundInputRef.current) backgroundInputRef.current.value = "";
    }
  }

  async function handleCreatePromptImage() {
    if (!positivePrompt.trim()) {
      setPromptImageError("Positive properties are required.");
      setStepMessage("Add the picture prompt before creating the image.");
      return;
    }
    if (!characterCount) {
      setPromptImageError("Character count is required.");
      return;
    }
    const readyCharacters = activeCharacters.filter((character) => !!(character.clearedServerPath || character.serverPath));
    if (readyCharacters.length !== characterCount) {
      setPromptImageError(`Storyboard workflow requires ${characterCount} character reference image(s).`);
      return;
    }

    setPromptImageBusy(true);
    setPromptImageError("");
    setStepMessage("Submitting storyboard picture workflowÃ¢â‚¬Â¦");
    try {
      const res = await fetch("/api/production/picture", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...withDeviceHeader() },
        body: JSON.stringify({
          storyboardCount: characterCount,
          productionId: activeProductionId || fallbackProductionId(productionName || draftProductionName),
          productionName: productionName || draftProductionName || "Untitled Production",
          workflowFile: characterCount === 1 ? "storyboard/StoryBoard 1.json" : `storyboard/Storyboard ${characterCount}.json`,
          backgroundPrompt,
          defaultLens,
          defaultMood,
          defaultStyle,
          defaultIdentity,
          positivePrompt,
          negativePrompt,
          usePreviousIdentityLock,
          usePreviousStyleLock,
          usePreviousLength,
          characterImages: readyCharacters.map((character) => character.clearedServerPath || character.serverPath),
          characterDescriptors: readyCharacters.map((character) => `${character.name || "Character"}: ${character.descriptor || ""}`.trim()),
        }),
      });
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) throw new Error(data?.error || text || "Create Picture failed");
      const resolvedServerPath = String(data?.serverPath || data?.imagePath || data?.generatedImagePath || "");
      const resolvedPreviewUrl = String(data?.previewUrl || data?.imageUrl || data?.serverUrl || data?.generatedImageUrl || (resolvedServerPath ? `/api/file?path=${encodeURIComponent(resolvedServerPath)}` : ""));
      if (!resolvedServerPath) throw new Error("Create Picture did not return a server path.");
      setPromptImagePath(resolvedServerPath);
      setPromptImagePreview(resolvedPreviewUrl);
      setStepMessage("Picture created successfully. You can continue to Create Video.");
    } catch (error: any) {
      const message = error?.message || String(error);
      setPromptImageError(message);
      setStepMessage(message);
    } finally {
      setPromptImageBusy(false);
    }
  }
  async function handlePromptImageUpload(file: File) {
    if (!ACCEPTED_TYPES.includes(file.type) && !file.name.toLowerCase().match(/\.(png|jpe?g|webp|gif)$/)) {
      setPromptImageError("Use PNG, JPG, WEBP, or GIF.");
      return;
    }
    setPromptImageUploadBusy(true);
    setPromptImageError("");
    try {
      const previewUrl = URL.createObjectURL(file);
      const upload = await uploadStoryboardImage(file);
      if (promptImagePreview && promptImagePreview.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(promptImagePreview);
        } catch {
          // ignore
        }
      }
      setPromptImagePath(upload.serverPath);
      setPromptImagePreview(previewUrl);
      setStepMessage("Uploaded image selected for Create Video.");
    } catch (error: any) {
      const message = error?.message || String(error);
      setPromptImageError(message);
      setStepMessage(message);
    } finally {
      setPromptImageUploadBusy(false);
      if (promptImageInputRef.current) promptImageInputRef.current.value = "";
    }
  }


  // OTG_PRODUCTION_CHANGE_ANGLE_FUNCTIONS
  function getProductionAngleCamera(direction: "front" | "left" | "right" | "up" | "down") {
    if (direction === "left") return { horizontal: 270, vertical: 0, zoom: 0, label: "Left 90" };
    if (direction === "right") return { horizontal: 90, vertical: 0, zoom: 0, label: "Right 90" };
    if (direction === "up") return { horizontal: 0, vertical: 25, zoom: 0, label: "Camera up" };
    if (direction === "down") return { horizontal: 0, vertical: -25, zoom: 0, label: "Camera down" };
    return { horizontal: 0, vertical: 0, zoom: 0, label: "Front" };
  }

  function getProductionAngleSourceUrl() {
    return promptImagePreview || (promptImagePath ? fileUrlFor(promptImagePath) : "");
  }

  // OTG_PRODUCTION_CHANGE_ANGLE_LATEST_PREVIEW_FIX
  function withFreshPreviewUrl(urlValue: string) {
    if (!urlValue) return "";
    const stamp = "v=" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    return urlValue + (urlValue.includes("?") ? "&" : "?") + stamp;
  }
  function extractPathFromApiFileUrl(urlValue: string) {
    try {
      const parsed = new URL(urlValue, window.location.origin);
      if (parsed.pathname === "/api/file") return parsed.searchParams.get("path") || "";
    } catch {
      // ignore invalid URL
    }
    return "";
  }

  function openProductionChangeAngle() {
    const sourceUrl = getProductionAngleSourceUrl();
    if (!sourceUrl) {
      setPromptImageError("Create or select a scene image before changing the angle.");
      return;
    }
    setProductionAngleOpen(true);
    setProductionAngleError("");
    setProductionAngleResultUrl("");
    setProductionAngleResultPath("");
    setProductionAngleResultLabel("");
  }

  async function handleProductionAnglePreview() {
    const sourceUrl = getProductionAngleSourceUrl();
    if (!sourceUrl) {
      setProductionAngleError("No scene image is available for Change Angle.");
      return;
    }

    const camera = getProductionAngleCamera(productionAngleDirection);
    setProductionAngleBusy(true);
    setProductionAngleError("");
    setProductionAngleResultUrl("");
    setProductionAngleResultPath("");
    setProductionAngleResultLabel("");

    try {
      const sourceRes = await fetch(sourceUrl, { cache: "no-store" });
      if (!sourceRes.ok) throw new Error("Could not load source image (" + sourceRes.status + ").");
      const sourceBlob = await sourceRes.blob();
      const ext = sourceBlob.type.includes("webp") ? "webp" : sourceBlob.type.includes("jpeg") ? "jpg" : "png";
      const sourceFile = new File([sourceBlob], "production-change-angle-source." + ext, { type: sourceBlob.type || "image/png" });

      const form = new FormData();
      form.append("image", sourceFile, sourceFile.name);
      form.append("angleHorizontal", String(camera.horizontal));
      form.append("angleVertical", String(camera.vertical));
      form.append("angleZoom", String(camera.zoom));
      form.append("removeBackground", "false");

      const res = await fetch("/api/angles/create-image", {
        method: "POST",
        headers: withDeviceHeader(),
        body: form,
      });
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) throw new Error(data?.error || text || "Change Angle failed.");

      const imageUrl = String(data?.imageUrl || "");
      const imagePath = String(data?.imagePath || data?.serverPath || extractPathFromApiFileUrl(imageUrl));
      if (!imageUrl) throw new Error("Change Angle did not return an image preview.");
      if (!imagePath) throw new Error("Change Angle did not return a reusable image path.");

      setProductionAngleResultUrl(withFreshPreviewUrl(imageUrl));
      setProductionAngleResultPath(imagePath);
      setProductionAngleResultLabel(String(data?.selectedAngle || camera.label));
    } catch (error: any) {
      setProductionAngleError(error?.message || String(error));
    } finally {
      setProductionAngleBusy(false);
    }
  }

  function saveProductionAnglePreview() {
    if (!productionAngleResultUrl || !productionAngleResultPath) {
      setProductionAngleError("Create a Change Angle preview before saving.");
      return;
    }
    setPromptImagePath(productionAngleResultPath);
    setPromptImagePreview(productionAngleResultUrl);
    setProductionAngleOpen(false);
    setProductionAngleError("");
    setProductionAngleResultUrl("");
    setProductionAngleResultPath("");
    setProductionAngleResultLabel("");
    setSaveTone("warn");
    setStepMessage("Changed angle saved as the current scene image.");
  }

  async function loadRecentProductionImages() {
    setRecentImageOpen(true);
    setRecentImageBusy(true);
    setRecentImageError("");
    try {
      const res = await fetch("/api/production/recent-images?limit=36", { cache: "no-store", headers: withDeviceHeader() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to load recent images");
      const items = Array.isArray(data?.items) ? data.items : [];
      setRecentImages(items.map((item: any) => ({
        imagePath: String(item.imagePath || ""),
        imageUrl: String(item.imageUrl || (item.imagePath ? fileUrlFor(String(item.imagePath)) : "")),
        name: String(item.name || "Recent image"),
        createdAt: Number(item.createdAt || 0) || undefined,
      })).filter((item: RecentProductionImage) => !!item.imagePath && !!item.imageUrl));
    } catch (error: any) {
      setRecentImageError(error?.message || String(error));
      setRecentImages([]);
    } finally {
      setRecentImageBusy(false);
    }
  }

  function selectRecentProductionImage(item: RecentProductionImage) {
    if (promptImagePreview && promptImagePreview.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(promptImagePreview);
      } catch {
        // ignore
      }
    }
    setPromptImagePath(item.imagePath);
    setPromptImagePreview(item.imageUrl);
    setPromptImageError("");
    setRecentImageOpen(false);
    setStepMessage(`${item.name || "Recent image"} selected for Create Video.`);
  }



  async function loadVoiceLibrary() {
    setVoiceLibraryBusy(true);
    setVoiceLibraryError("");
    try {
      const res = await fetch("/api/voices/library", { cache: "no-store", headers: withDeviceHeader() });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to load voice library");
      const items = Array.isArray(data?.voices) ? data.voices : [];
      setVoiceLibrary(items.map((item: any) => ({ voiceId: String(item.voiceId || item.id || ""), name: String(item.name || item.displayName || "Voice"), refAudioUrl: String(item.refAudioUrl || ""), type: String(item.type || "") })).filter((item: VoiceLibraryItem) => !!item.voiceId));
    } catch (error: any) {
      setVoiceLibraryError(error?.message || String(error));
      setVoiceLibrary([]);
    } finally {
      setVoiceLibraryBusy(false);
    }
  }

  function openVoiceLibrary() {
    setVoiceLibraryOpen(true);
    setVoiceClipError("");
    if (!voiceLibrary.length) {
      void loadVoiceLibrary();
    }
  }

  async function handleGenerateVoiceClip() {
    if (!selectedVoiceId) {
      setVoiceClipError("Choose a custom voice first.");
      return;
    }
    if (!voiceDialogue.trim()) {
      setVoiceClipError("Enter what the character should say.");
      return;
    }
    setVoiceClipBusy(true);
    setVoiceClipError("");
    try {
      const res = await fetch("/api/tts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...withDeviceHeader() },
        body: JSON.stringify({ voiceId: selectedVoiceId, text: voiceDialogue.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Voice clip generation failed");
      const nextPath = String(data?.audioPath || data?.serverPath || "");
      const nextUrl = String(data?.audioUrl || (nextPath ? `/api/file?path=${encodeURIComponent(nextPath)}` : ""));
      if (!nextPath || !nextUrl) throw new Error("Voice clip generation did not return audio.");
      setVoiceClipDraftPath(nextPath);
      setVoiceClipDraftUrl(nextUrl);
    } catch (error: any) {
      setVoiceClipError(error?.message || String(error));
    } finally {
      setVoiceClipBusy(false);
    }
  }

  function saveGeneratedVoiceClip() {
    if (!voiceClipDraftPath || !voiceClipDraftUrl) {
      setVoiceClipError("Generate a clip first.");
      return;
    }
    setSavedVoiceClipPath(voiceClipDraftPath);
    setSavedVoiceClipUrl(voiceClipDraftUrl);
    setVoiceLibraryOpen(false);
    setStepMessage(`${selectedVoiceName || "Custom voice"} clip saved for card ${currentCard}.`);
  }

  function redoGeneratedVoiceClip() {
    setVoiceClipDraftPath(undefined);
    setVoiceClipDraftUrl("");
    void handleGenerateVoiceClip();
  }

  async function handleCreateVideo() {
    if (!promptImagePath) {
      setVideoError("Create a picture first.");
      setStepMessage("Create a picture first.");
      return;
    }
    if (!hasRequiredIdLoraPromptFormat(positivePrompt)) {
      const message = "Create Video requires the hard-rule ID-LoRA prompt format: [VISUAL], [SPEECH], then [SOUNDS].";
      setVideoError(message);
      setStepMessage(message);
      return;
    }
    const effectiveAudioPath = useCustomVoice ? preferredCharacterVoice?.audioPath || savedVoiceClipPath : undefined;
    const effectiveVoiceLabel = useCustomVoice
      ? preferredCharacterVoice?.name
        ? `${preferredCharacterVoice.name} (loaded character)`
        : selectedVoiceName || "custom voice"
      : "standard LTX audio";
    if (useCustomVoice && !effectiveAudioPath) {
      setVideoError("Load a character with saved reference audio or save a custom voice clip first.");
      setStepMessage("Load a character voice or save a custom voice clip first.");
      return;
    }

    const videoRequestId = `${currentCard}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    latestVideoRequestRef.current = videoRequestId;

    setVideoBusy(true);
    setVideoError("");
    setVideoPath(undefined);
    setVideoPreviewUrl("");
    setStepMessage(`Submitting new video workflow for card ${currentCard} using ${effectiveVoiceLabel}...`);

    try {
      const res = await fetch("/api/production/video", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...withDeviceHeader() },
        body: JSON.stringify({
          productionId: activeProductionId || fallbackProductionId(productionName || draftProductionName),
          productionName: productionName || draftProductionName || "Untitled Production",
          cardIndex: currentCard,
          imagePath: promptImagePath,
          positivePrompt: positivePrompt.trim(),
          negativePrompt: negativePrompt.trim(),
          audioPath: effectiveAudioPath,
          durationSec: videoDurationSec,
          width: 1280,
          height: 720,
          clientRequestId: videoRequestId,
          useCustomVoice,
          workflowFile: useCustomVoice
            ? "internal/production/production_ltx23_ia2v_lipsync_api_template.json"
            : "presets/Create a Video from Images.json",
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Create Video failed");

      if (latestVideoRequestRef.current !== videoRequestId) {
        return;
      }

      const nextPath = String(pickVideoPath(data) || data?.serverPath || "");
      const rawNextUrl = String(pickVideoUrl(data) || data?.serverUrl || (nextPath ? `/api/file?path=${encodeURIComponent(nextPath)}` : ""));
      const nextUrl = withCacheBust(rawNextUrl, videoRequestId);
      if (!nextPath || !nextUrl) throw new Error("Create Video did not return a usable video path.");

      setVideoPath(nextPath);
      setVideoPreviewUrl(nextUrl);
      setStepMessage(`New video preview created for card ${currentCard}. Preview it, then Save Scene ${currentCard}.`);
    } catch (error: any) {
      if (latestVideoRequestRef.current !== videoRequestId) {
        return;
      }
      const message = error?.message || String(error);
      setVideoError(message);
      setStepMessage(message);
    } finally {
      if (latestVideoRequestRef.current === videoRequestId) {
        setVideoBusy(false);
      }
    }
  }

  function buildCurrentSceneEntry(): SavedCardVideo | null {
    if (!videoPath || !videoPreviewUrl) {
      setVideoError("Create a video first.");
      return null;
    }
    if (!promptImagePath || !promptImagePreview) {
      setVideoError("Create or load a scene image first.");
      return null;
    }
    const effectiveAudioPath = useCustomVoice ? preferredCharacterVoice?.audioPath || savedVoiceClipPath : undefined;
    const effectiveAudioUrl = useCustomVoice ? preferredCharacterVoice?.audioUrl || savedVoiceClipUrl : undefined;
    return {
      card: currentCard,
      imagePath: promptImagePath,
      imageUrl: promptImagePreview,
      videoPath,
      videoUrl: videoPreviewUrl,
      audioPath: effectiveAudioPath,
      audioUrl: effectiveAudioUrl,
      prompt: positivePrompt.trim(),
      characterNames: activeCharacters.map((character) => character.name).filter(Boolean),
      lockedAt: new Date().toISOString(),
    };
  }

  function upsertCurrentScene(): SavedCardVideo[] | null {
    const entry = buildCurrentSceneEntry();
    if (!entry) return null;
    const nextScenes = [...savedCardVideos.filter((item) => item.card !== currentCard), entry].sort((a, b) => a.card - b.card);
    setSavedCardVideos(nextScenes);
    return nextScenes;
  }

  function resetSceneDraft(nextCard: number) {
    setCurrentCard(nextCard);
    setPromptImagePath(undefined);
    setPromptImagePreview("");
    setPositivePrompt("");
    setNegativePrompt("");
    setVideoPath(undefined);
    setVideoPreviewUrl("");
    latestVideoRequestRef.current = "";
    setVideoError("");
    setPromptImageError("");
    setSavedVoiceClipPath(undefined);
    setSavedVoiceClipUrl("");
    setVoiceClipDraftPath(undefined);
    setVoiceClipDraftUrl("");
    setVoiceDialogue("");
  }

  function resetSceneSetupForNextCard(nextCard: number) {
    releaseCharacterUrls(characters);
    if (backgroundImagePreview && backgroundImagePreview.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(backgroundImagePreview);
      } catch {
        // ignore
      }
    }
    resetSceneDraft(nextCard);
    setCharacterCount(1);
    setCharacters(createDefaultCharacters(1));
    setActiveCharacterIndex(0);
    setBackgroundPrompt("");
    setBackgroundPreset("realistic");
    setBackgroundImagePath(undefined);
    setBackgroundImageMode(null);
    setBackgroundImagePreview("");
    setBackgroundError("");
    setUseCustomVoice(true);
  }

  async function handleSaveCurrentCardVideo() {
    const nextScenes = upsertCurrentScene();
    if (!nextScenes) return;
    const ok = await saveProductionState({
      savedCardVideos: nextScenes,
      activeStep,
      currentCard,
      savedNoticeText: `Scene ${currentCard} locked in`,
    });
    if (!ok) return;
    setStepMessage(`Scene ${currentCard} is locked in. It will load from the saved video when you Continue Production.`);
  }

  async function handleNextScene() {
    const nextScenes = upsertCurrentScene();
    if (!nextScenes) return;
    if (currentCard >= totalCards) {
      setActiveStep("review");
      await saveProductionState({
        savedCardVideos: nextScenes,
        activeStep: "review",
        currentCard,
        savedNoticeText: `Scene ${currentCard} locked in`,
      });
      setStepMessage(`Scene ${currentCard} is locked in. Review ${nextScenes.length} locked scene${nextScenes.length === 1 ? "" : "s"} before Stitch.`);
      return;
    }
    const completedCard = currentCard;
    const nextCard = currentCard + 1;
    const nextCharacters = createDefaultCharacters(1);
    resetSceneSetupForNextCard(nextCard);
    setActiveStep("setup");
    await saveProductionState({
      savedCardVideos: nextScenes,
      activeStep: "setup",
      currentCard: nextCard,
      characterCount: 1,
      characters: nextCharacters,
      backgroundPrompt: "",
      backgroundPreset: "realistic",
      backgroundImagePath: undefined,
      backgroundImageMode: null,
      positivePrompt: "",
      negativePrompt: "",
      savedNoticeText: `Scene ${completedCard} locked in`,
    });
    setStepMessage(`Scene ${completedCard} is locked in. Set up scene ${nextCard} with its own characters and background.`);
  }

  async function handleFinishVideo() {
    const nextScenes = upsertCurrentScene();
    if (!nextScenes) return;
    setActiveStep("review");
    const ok = await saveProductionState({
      savedCardVideos: nextScenes,
      activeStep: "review",
      currentCard,
      savedNoticeText: `Scene ${currentCard} locked in`,
    });
    if (!ok) return;
    setStepMessage(`Scene ${currentCard} is locked in. Review ${nextScenes.length} locked scene${nextScenes.length === 1 ? "" : "s"} before Stitch.`);
  }

  function handleBeginAgainVideo() {
    setVideoPath(undefined);
    setVideoPreviewUrl("");
    setVideoError("");
    setSavedVoiceClipPath(undefined);
    setSavedVoiceClipUrl("");
    setVoiceClipDraftPath(undefined);
    setVoiceClipDraftUrl("");
  }

  async function handleGoToStitch() {
    if (!savedCardVideos.length) {
      setStepMessage("Lock at least one scene before Stitch.");
      return;
    }
    setActiveStep("stitch");
    await saveProductionState({ activeStep: "stitch", savedNoticeText: "Review accepted" });
    setStepMessage("Stitch uses only the locked scene videos, in scene order.");
  }

  async function handleStitchProduction() {
    if (!savedCardVideos.length) {
      setStitchError("Lock at least one scene before stitching.");
      return;
    }
    setStitchBusy(true);
    setStitchError("");
    setStepMessage("Stitching locked scene videos...");
    try {
      const res = await fetch("/api/production/stitch", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...withDeviceHeader() },
        body: JSON.stringify({
          productionId: activeProductionId || fallbackProductionId(productionName || draftProductionName),
          scenes: savedCardVideos.map((scene) => ({ card: scene.card, videoPath: scene.videoPath })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Stitch failed");
      const nextPath = String(data?.videoPath || data?.serverPath || "").trim();
      const nextUrl = String(data?.videoUrl || data?.serverUrl || (nextPath ? fileUrlFor(nextPath) : "")).trim();
      if (!nextPath || !nextUrl) throw new Error("Stitch did not return a usable video.");
      setStitchedVideoPath(nextPath);
      setStitchedVideoUrl(withCacheBust(nextUrl, `stitch-${Date.now()}`));
      await saveProductionState({
        activeStep: "stitch",
        savedCardVideos,
        stitchedVideoPath: nextPath,
        savedNoticeText: "Stitched video saved",
      });
      setStepMessage("Stitched video created. Review it, then Complete Project.");
    } catch (error: any) {
      const message = error?.message || String(error);
      setStitchError(message);
      setStepMessage(message);
    } finally {
      setStitchBusy(false);
    }
  }

  async function handleCompleteProject() {
    if (!stitchedVideoPath) {
      setStitchError("Stitch the locked scene videos before completing the project.");
      return;
    }
    const completedAt = new Date().toISOString();
    const completedState = buildPersistedState({
      productionId: activeProductionId || persistedState.productionId,
      productionName: productionName || draftProductionName || "Untitled Production",
      activeStep: "stitch",
      currentCard,
      characterCount,
      backgroundPrompt,
      backgroundPreset,
      backgroundImagePath,
      backgroundImageMode,
      defaultLens,
      defaultMood,
      defaultStyle,
      defaultIdentity,
      positivePrompt,
      negativePrompt,
      usePreviousLength,
      usePreviousIdentityLock,
      usePreviousStyleLock,
      savedCardVideos,
      stitchedVideoPath,
      completedAt,
      status: "completed",
      characters,
    });
    const ok = await saveProductionState({
      activeStep: "stitch",
      savedCardVideos,
      stitchedVideoPath,
      completedAt,
      status: "completed",
      savedNoticeText: "Project completed",
    });
    if (!ok) return;
    const completedRecord: PersistedProductionRecord = {
      id: completedState.productionId,
      name: completedState.name,
      createdAt: new Date().toISOString(),
      updatedAt: completedAt,
      state: completedState,
    };
    setCompletedReviewRecord(completedRecord);
    setActiveProductionId("");
    setProductionName("");
    setDraftProductionName("");
    setPanelMode("menu");
    setStepMessage("");
    setMenuError("");
    setActiveSummary(null);
  }

  async function handleCharacterUpload(index: number, file: File) {
    if (!ACCEPTED_TYPES.includes(file.type) && !file.name.toLowerCase().match(/\.(png|jpe?g|webp|gif)$/)) {
      setCharacters((previous) => previous.map((character, idx) => (idx === index ? { ...character, error: "Use PNG, JPG, WEBP, or GIF." } : character)));
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    const key = `upload-${index}`;
    setCharacterActionBusyKey(key);
    setCharacters((previous) =>
      previous.map((character, idx) =>
        idx === index
          ? { ...character, file, previewUrl, status: isGif(file) ? "Uploading GIFÃ¢â‚¬Â¦" : "Uploading imageÃ¢â‚¬Â¦", error: undefined }
          : character
      )
    );
    try {
      const upload = await uploadStoryboardImage(file);
      const currentName = (characters[index]?.name || "").trim();
      const vision = await callVisionPrompt({ imagePath: upload.serverPath, characterName: currentName || undefined, purpose: "character" });
      setCharacters((previous) =>
        previous.map((character, idx) =>
          idx === index
            ? {
                ...character,
                file,
                previewUrl,
                serverPath: upload.serverPath,
                descriptor: vision.descriptor,
                status: undefined,
                error: undefined,
              }
            : character
        )
      );
    } catch (error: any) {
      setCharacters((previous) =>
        previous.map((character, idx) => (idx === index ? { ...character, error: error?.message || String(error), status: undefined } : character))
      );
    } finally {
      setCharacterActionBusyKey("");
      if (characterInputRef.current) characterInputRef.current.value = "";
    }
  }

  async function runCharacterVision(index: number) {
    const slot = characters[index];
    if (!slot?.serverPath) return;
    const key = `vision-${index}`;
    setCharacterActionBusyKey(key);
    setCharacters((previous) => previous.map((character, idx) => (idx === index ? { ...character, status: "Auto promptingÃ¢â‚¬Â¦", error: undefined } : character)));
    try {
      const result = await callVisionPrompt({ imagePath: slot.serverPath, characterName: slot.name.trim() || undefined, purpose: "character" });
      setCharacters((previous) => previous.map((character, idx) => (idx === index ? { ...character, descriptor: result.descriptor, status: undefined } : character)));
    } catch (error: any) {
      setCharacters((previous) => previous.map((character, idx) => (idx === index ? { ...character, error: error?.message || String(error), status: undefined } : character)));
    } finally {
      setCharacterActionBusyKey("");
    }
  }

  async function removeCharacterBackground(index: number) {
    const slot = characters[index];
    if (!slot?.serverPath) return;
    const key = `remove-${index}`;
    setCharacterActionBusyKey(key);
    setCharacters((previous) => previous.map((character, idx) => (idx === index ? { ...character, status: "Removing backgroundÃ¢â‚¬Â¦", error: undefined } : character)));
    try {
      const result = await callRemoveBackground(slot.serverPath);
      setCharacters((previous) => previous.map((character, idx) => (idx === index ? { ...character, clearedServerPath: result.clearedPath, status: undefined } : character)));
    } catch (error: any) {
      setCharacters((previous) => previous.map((character, idx) => (idx === index ? { ...character, error: error?.message || String(error), status: undefined } : character)));
    } finally {
      setCharacterActionBusyKey("");
    }
  }

  const activeProductions = savedProductions.filter((item) => item.status !== "completed" && !item.completedAt);
  const completedProductions = savedProductions.filter((item) => item.status === "completed" || !!item.completedAt);
  const activeEditableSummary = activeSummary && activeSummary.status !== "completed" && !activeSummary.completedAt ? activeSummary : null;
  const activeLabel = activeEditableSummary
    ? `${activeEditableSummary.name} - Card ${activeEditableSummary.currentCard} of ${activeEditableSummary.totalCards} - ${activeEditableSummary.sceneCount || 0} scene${activeEditableSummary.sceneCount === 1 ? "" : "s"} saved`
    : "No saved active production";

  const backgroundPreviewUrl = backgroundImagePreview || (backgroundImagePath ? `/api/file?path=${encodeURIComponent(backgroundImagePath)}` : "");

  return (
    <div className="relative">
      {panelMode === "builder" ? <ProductionTaskWidget steps={stepItems} currentStep={activeStep} /> : null}

      <div className="rounded-[30px] border border-white/10 bg-black/45 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/8 pb-4">
          <div>
            <div className="text-lg font-black tracking-[0.14em] text-white">Production</div>
            <div className="mt-2 text-sm text-white/68">
              Current Production: <span className="font-semibold text-white/88">{productionName || draftProductionName || "Not started"}</span>
            </div>
          </div>
          {panelMode === "builder" ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className={cn("rounded-full border px-4 py-2 text-sm font-semibold", statusBadgeClasses(saveTone))}>
                {saveTone === "success" ? "Changes saved" : saveTone === "error" ? "Save failed" : "Unsaved changes"}
              </div>
              <button
                type="button"
                onClick={requestExitToMenu}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 transition hover:bg-white/10"
              >
                Back to project
              </button>
            </div>
          ) : null}
        </div>

        {panelMode !== "builder" ? (
          <div className="space-y-5 pt-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <button type="button" className="rounded-[26px] border border-white/10 bg-white/5 p-4 text-left transition hover:bg-white/10" onClick={() => { setPanelMode("new"); setMenuError(""); }}>
                <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">New Production</div>
                <div className="mt-2 text-sm text-white/68">Create a named production before entering the guided builder.</div>
              </button>
              <button type="button" disabled={!activeEditableSummary || menuBusy} className="rounded-[26px] border border-white/10 bg-white/5 p-4 text-left transition enabled:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45" onClick={continueActiveProduction}>
                <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Continue Production</div>
                <div className="mt-2 text-sm text-white/68">Restore the active in-progress production.</div>
                <div className="mt-3 text-xs text-white/50">{activeLabel}</div>
              </button>
              <button type="button" disabled={menuBusy} className="rounded-[26px] border border-white/10 bg-white/5 p-4 text-left transition enabled:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45" onClick={async () => { setPanelMode("load"); await refreshProductionList(); }}>
                <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Load Production</div>
                <div className="mt-2 text-sm text-white/68">Open one of the saved production records.</div>
              </button>
              <button type="button" disabled={menuBusy} className="rounded-[26px] border border-emerald-300/30 bg-emerald-500/12 p-4 text-left transition enabled:hover:bg-emerald-500/18 disabled:cursor-not-allowed disabled:opacity-45" onClick={async () => { setPanelMode("completed"); await refreshProductionList(); }}>
                <div className="text-sm font-black uppercase tracking-[0.18em] text-emerald-100">Completed Projects</div>
                <div className="mt-2 text-sm text-emerald-50/70">Review completed read-only productions.</div>
              </button>
              <button type="button" disabled={menuBusy} className="rounded-[26px] border border-white/10 bg-white/5 p-4 text-left transition enabled:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45" onClick={async () => { setPanelMode("delete"); await refreshProductionList(); }}>
                <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Delete Production</div>
                <div className="mt-2 text-sm text-white/68">Remove a saved production record from the TEST repo state store.</div>
              </button>
            </div>

            {panelMode === "new" ? (
              <SectionCard title="New Production" subtitle="This first patch adds the Production shell and save/load baseline. Background generation workflow wiring comes in a later patch.">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-white/85">Production name</label>
                  <div className="flex flex-wrap gap-3">
                    <input
                      value={draftProductionName}
                      onChange={(event) => setDraftProductionName(event.target.value)}
                      className="min-w-[280px] flex-1 rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                      placeholder="Enter production name"
                    />
                    <button type="button" className="rounded-full bg-[linear-gradient(90deg,rgba(111,76,255,0.85),rgba(32,183,255,0.8))] px-5 py-3 text-sm font-black text-white" onClick={startNewProduction}>
                      Start Production
                    </button>
                    <button type="button" className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/80" onClick={() => setPanelMode("menu")}>
                      Cancel
                    </button>
                  </div>
                </div>
              </SectionCard>
            ) : null}

            {panelMode === "load" ? (
              <SectionCard title="Load Production" subtitle="Choose one of the saved productions.">
                <div className="flex justify-end">
                  <button type="button" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80" disabled={menuBusy} onClick={refreshProductionList}>
                    Refresh
                  </button>
                </div>
                {activeProductions.length ? (
                  <div className="space-y-3">
                    {activeProductions.map((item) => (
                      <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-white/10 bg-white/5 p-4">
                        <div>
                          <div className="text-base font-semibold text-white">{item.name}</div>
                          <div className="mt-1 text-sm text-white/58">Card {item.currentCard} of {item.totalCards} - {item.characterCount} character{item.characterCount === 1 ? "" : "s"} - {item.sceneCount || 0} scene{item.sceneCount === 1 ? "" : "s"} saved</div>
                          <div className="mt-1 text-xs text-white/45">Updated {new Date(item.updatedAt).toLocaleString()}</div>
                        </div>
                        <button type="button" className="rounded-full bg-[linear-gradient(90deg,rgba(111,76,255,0.85),rgba(32,183,255,0.8))] px-5 py-3 text-sm font-black text-white" disabled={menuBusy} onClick={() => loadProductionById(item.id)}>
                          Load
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-white/55">No editable productions found.</div>
                )}
              </SectionCard>
            ) : null}

            {panelMode === "completed" ? (
              <SectionCard title="Completed Projects" subtitle="Completed projects are locked and read-only. Open one to review the scenes, prompts, characters, and final stitched video.">
                <div className="flex justify-end">
                  <button type="button" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80" disabled={menuBusy} onClick={refreshProductionList}>
                    Refresh
                  </button>
                </div>
                {completedProductions.length ? (
                  <div className="space-y-3">
                    {completedProductions.map((item) => (
                      <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-emerald-300/20 bg-emerald-500/10 p-4">
                        <div>
                          <div className="text-base font-semibold text-white">{item.name}</div>
                          <div className="mt-1 text-sm text-emerald-50/70">{item.sceneCount || 0} scene{item.sceneCount === 1 ? "" : "s"} locked - read-only</div>
                          <div className="mt-1 text-xs text-white/45">Completed {item.completedAt ? new Date(item.completedAt).toLocaleString() : new Date(item.updatedAt).toLocaleString()}</div>
                        </div>
                        <button type="button" className="rounded-full border border-emerald-300/30 bg-emerald-500/14 px-5 py-3 text-sm font-black text-emerald-100" disabled={menuBusy} onClick={() => openCompletedProductionById(item.id)}>
                          Review
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-white/55">No completed projects found.</div>
                )}
              </SectionCard>
            ) : null}

            {panelMode === "completedView" && completedReviewRecord ? (
              <SectionCard title={`Completed Project: ${completedReviewRecord.name}`} subtitle="Read-only review. This project is locked and cannot be edited after completion.">
                <CompletedProductionReview record={completedReviewRecord} onBack={() => setPanelMode("completed")} />
              </SectionCard>
            ) : null}

            {panelMode === "delete" ? (
              <SectionCard title="Delete Production" subtitle="Delete only removes the saved Production record. It does not touch Gallery outputs.">
                <div className="flex justify-end">
                  <button type="button" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80" disabled={menuBusy} onClick={refreshProductionList}>
                    Refresh
                  </button>
                </div>
                {savedProductions.length ? (
                  <div className="space-y-3">
                    {savedProductions.map((item) => (
                      <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-white/10 bg-white/5 p-4">
                        <div>
                          <div className="text-base font-semibold text-white">{item.name}</div>
                          <div className="mt-1 text-xs text-white/45">{item.status === "completed" || item.completedAt ? "Completed" : "Active"} - Updated {new Date(item.updatedAt).toLocaleString()}</div>
                        </div>
                        <button type="button" className="rounded-full border border-rose-400/30 bg-rose-500/10 px-5 py-3 text-sm font-semibold text-rose-200" disabled={menuBusy} onClick={() => deleteProductionById(item.id, item.name)}>
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-white/55">No saved productions found.</div>
                )}
              </SectionCard>
            ) : null}

            {menuError ? <div className="rounded-[20px] border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{menuError}</div> : null}
          </div>
        ) : null}

        {panelMode === "builder" ? (
          <div className="space-y-5 pt-5">
            <SectionCard title="Guided Flow" subtitle={currentStepMeta.description}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">Step {stepItems.find((item) => item.key === activeStep)?.index}: {builderSkeletonTitle(activeStep)}</div>
                  <div className="mt-1 text-sm text-white/60">Scene {currentCard} of {totalCards}. You can stop after any scene and move to Stitch when the current video is ready.</div>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70">
                  {savedCardVideos.length} saved scene{savedCardVideos.length === 1 ? "" : "s"}
                </div>
              </div>
              {stepMessage ? <div className="rounded-[18px] border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">{stepMessage}</div> : null}
              {saveError ? <div className="rounded-[18px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{saveError}</div> : null}
            </SectionCard>

            {activeStep === "setup" ? (
              <SectionCard title="Setup" subtitle="Background is required. The builder will not move forward without a selected background image.">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-white/85">Production name</label>
                    {!renameOpen ? (
                      <div className="flex flex-wrap items-center gap-3 rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white">
                        <div className="flex-1 min-w-[220px]">
                          <span className="text-white/55">Production Name: </span>
                          <span className="font-semibold text-white">{productionName || "Untitled Production"}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setRenameDraft(productionName || draftProductionName || "");
                            setRenameOpen(true);
                          }}
                          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85"
                        >
                          Rename
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        <input
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          className="min-w-[220px] flex-1 rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                          placeholder="Rename production"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const next = renameDraft.trim();
                            if (!next) return;
                            setProductionName(next);
                            setDraftProductionName(next);
                            setRenameOpen(false);
                          }}
                          className="rounded-full bg-[linear-gradient(90deg,rgba(111,76,255,0.85),rgba(32,183,255,0.8))] px-5 py-3 text-sm font-black text-white"
                        >
                          Save Name
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenameDraft(productionName || draftProductionName || "");
                            setRenameOpen(false);
                          }}
                          className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/80"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-white/85">Character count</label>
                    <select
                      value={characterCount || 1}
                      onChange={(event) => setCharacterCount(lockCount(Number(event.target.value)))}
                      className="w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
                    >
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option key={value} value={value} className="bg-[#090910]">
                          {value} character{value === 1 ? "" : "s"}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-white/85">Global background location prompt</label>
                  <div className="flex flex-wrap gap-3">
                    <select
                      value={backgroundPreset}
                      onChange={(event) => applyBackgroundPreset(event.target.value as BackgroundPresetKey)}
                      className="rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
                    >
                      {BACKGROUND_PRESETS.map((preset) => (
                        <option key={preset.key} value={preset.key} className="bg-[#090910]">
                          {preset.label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={backgroundPrompt}
                      onChange={(event) => setBackgroundPrompt(event.target.value)}
                      className="min-w-[280px] flex-1 rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
                    />
                    <button
                      type="button"
                      disabled={enhanceBusyKey === "bg" || !backgroundPrompt.trim()}
                      onClick={() => enhanceField("bg", "background", backgroundPrompt, setBackgroundPrompt)}
                      className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/85 disabled:opacity-45"
                    >
                      {enhanceBusyKey === "bg" ? "Enhancing..." : "Enhance"}
                    </button>
                    <button
                      type="button"
                      disabled={backgroundBusy || !backgroundPrompt.trim()}
                      onClick={() => void handleCreateBackground()}
                      className="rounded-full border border-fuchsia-400/25 bg-fuchsia-500/10 px-5 py-3 text-sm font-semibold text-fuchsia-100 disabled:opacity-45"
                    >
                      {backgroundBusy && backgroundImageMode !== "upload" ? "Creating..." : "Create Background"}
                    </button>
                    <button
                      type="button"
                      onClick={() => backgroundInputRef.current?.click()}
                      className="rounded-full bg-[linear-gradient(90deg,rgba(111,76,255,0.85),rgba(32,183,255,0.8))] px-5 py-3 text-sm font-black text-white"
                    >
                      {backgroundBusy ? "Uploading..." : "Upload Image"}
                    </button>
                  </div>
                  <input
                    ref={backgroundInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void handleBackgroundUpload(file);
                    }}
                  />
                  {backgroundError ? <div className="text-sm text-rose-200">{backgroundError}</div> : null}
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr),340px]">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-white/85">Default lens</label>
                      <select value={defaultLens} onChange={(event) => setDefaultLens(event.target.value)} className="w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45">
                        {LENS_PRESETS.map((preset) => (
                          <option key={preset} value={preset} className="bg-[#090910]">{preset}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-white/85">Default mood / emotion</label>
                      <select value={defaultMood} onChange={(event) => setDefaultMood(event.target.value)} className="w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45">
                        {MOOD_PRESETS.map((preset) => (
                          <option key={preset} value={preset} className="bg-[#090910]">{preset}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-sm font-semibold text-white/85">Default style lock</label>
                      <select value={defaultStyle} onChange={(event) => setDefaultStyle(event.target.value)} className="w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45">
                        {STYLE_PRESETS.map((preset) => (
                          <option key={preset} value={preset} className="bg-[#090910]">{preset}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-sm font-semibold text-white/85">Default identity face lock</label>
                      <select value={defaultIdentity} onChange={(event) => setDefaultIdentity(event.target.value)} className="w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45">
                        {IDENTITY_PRESETS.map((preset) => (
                          <option key={preset} value={preset} className="bg-[#090910]">{preset}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                    <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Background preview</div>
                    {backgroundPreviewUrl ? (
                      <div className="mt-3 overflow-hidden rounded-[22px] border border-white/10 bg-black/45">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={backgroundPreviewUrl} alt="Background preview" onClick={() => openExpandedImage(backgroundPreviewUrl, "Background preview")} className="h-[220px] w-full cursor-zoom-in object-contain bg-black/35" />
                      </div>
                    ) : (
                      <div className="mt-3 rounded-[22px] border border-dashed border-white/12 bg-black/35 px-4 py-10 text-center text-sm text-white/50">
                        Upload or create a background image to continue.
                      </div>
                    )}
                    <div className="mt-3 text-xs text-white/52">
                      Background is required before moving into Characters.
                    </div>
                  </div>
                </div>
              </SectionCard>
            ) : null}

            {activeStep === "characters" ? (
              <SectionCard title="Characters" subtitle="Character quick-switch controls are above Character Name so the current scene setup stays easy to navigate.">
                <div className="flex flex-wrap gap-2">
                  {activeCharacters.map((character, index) => (
                    <button
                      key={character.id}
                      type="button"
                      onClick={() => setActiveCharacterIndex(index)}
                      className={cn(
                        "rounded-full border px-4 py-2 text-sm font-semibold transition",
                        index === activeCharacterIndex
                          ? "border-cyan-300/40 bg-[linear-gradient(90deg,rgba(111,76,255,0.55),rgba(32,183,255,0.3))] text-white"
                          : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                      )}
                    >
                      Character {index + 1}
                    </button>
                  ))}
                </div>

                {activeCharacter ? (
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr),340px]">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-white/85">Character Name</label>
                        <input
                          value={activeCharacter.name}
                          onChange={(event) =>
                            setCharacters((previous) => previous.map((character, index) => (index === activeCharacterIndex ? { ...character, name: event.target.value } : character)))
                          }
                          className="w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
                        />
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => openCharacterLibraryForSlot(activeCharacterIndex)}
                          className="rounded-full border border-cyan-300/25 bg-cyan-500/12 px-5 py-3 text-sm font-black text-cyan-100"
                        >
                          Load Saved Character
                        </button>
                        <button type="button" onClick={() => characterInputRef.current?.click()} className="rounded-full bg-[linear-gradient(90deg,rgba(111,76,255,0.85),rgba(32,183,255,0.8))] px-5 py-3 text-sm font-black text-white">
                          {characterActionBusyKey === `upload-${activeCharacterIndex}` ? "Uploading..." : "Upload Character"}
                        </button>
                        <button
                          type="button"
                          disabled={!activeCharacter.serverPath || characterActionBusyKey === `vision-${activeCharacterIndex}`}
                          onClick={() => void runCharacterVision(activeCharacterIndex)}
                          className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/80 disabled:opacity-45"
                        >
                          {characterActionBusyKey === `vision-${activeCharacterIndex}` ? "Analyzing..." : "Character Reference"}
                        </button>
                        <button
                          type="button"
                          disabled={!activeCharacter.serverPath || characterActionBusyKey === `remove-${activeCharacterIndex}`}
                          onClick={() => void removeCharacterBackground(activeCharacterIndex)}
                          className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/80 disabled:opacity-45"
                        >
                          {characterActionBusyKey === `remove-${activeCharacterIndex}` ? "Removing..." : "Remove Background"}
                        </button>
                      </div>
                      <div className="rounded-[18px] border border-cyan-400/15 bg-cyan-500/8 px-4 py-3 text-xs text-cyan-100/90">
                        Load a saved character to auto-fill this slot with the library image, description, and default reference audio. Production does not surface the library intro video here. The saved image becomes the slot reference for the ID-LoRA workflow.
                      </div>
                      <input
                        ref={characterInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void handleCharacterUpload(activeCharacterIndex, file);
                        }}
                      />
                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-white/85">Identity notes</label>
                        <textarea
                          rows={10}
                          value={activeCharacter.descriptor}
                          onChange={(event) =>
                            setCharacters((previous) => previous.map((character, index) => (index === activeCharacterIndex ? { ...character, descriptor: event.target.value } : character)))
                          }
                          className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
                        />
                      </div>
                      {activeCharacter.status ? <div className="text-sm text-cyan-100">{activeCharacter.status}</div> : null}
                      {activeCharacter.error ? <div className="text-sm text-rose-200">{activeCharacter.error}</div> : null}
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Reference preview</div>
                          {activeCharacter.sourceCharacterId ? (
                            <div className="rounded-full border border-cyan-300/25 bg-cyan-500/12 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100">
                              Library character loaded
                            </div>
                          ) : null}
                        </div>
                        {activeCharacterPreviewUrl ? (
                          <div className="mt-3 overflow-hidden rounded-[22px] border border-white/10 bg-black/40">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={activeCharacterPreviewUrl}
                              alt={activeCharacter.name}
                              onClick={() => openExpandedImage(activeCharacterPreviewUrl, activeCharacter.name || "Character reference")}
                              className="h-[180px] w-full cursor-zoom-in object-contain bg-black/35"
                            />
                          </div>
                        ) : (
                          <div className="mt-3 rounded-[22px] border border-dashed border-white/12 bg-black/35 px-4 py-10 text-center text-sm text-white/50">
                            Upload the character reference here.
                          </div>
                        )}
                        {activeCharacter.sourceCharacterName ? (
                          <div className="mt-3 text-xs text-white/55">
                            Source: <span className="font-semibold text-white/82">{activeCharacter.sourceCharacterName}</span>
                          </div>
                        ) : null}
                        {activeCharacter.referenceAudioPath ? (
                          <div className="mt-3 rounded-[18px] border border-cyan-400/15 bg-cyan-500/8 px-3 py-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100/80">Loaded character voice</div>
                            <audio controls preload="none" className="mt-2 w-full" src={fileUrlFor(activeCharacter.referenceAudioPath)} />
                          </div>
                        ) : null}
                      </div>
                      {activeCharacter.clearedServerPath ? (
                        <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                          <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Background removed</div>
                          <div className="mt-3 overflow-hidden rounded-[22px] border border-white/10 bg-black/40">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={fileUrlFor(activeCharacter.clearedServerPath)} alt={`${activeCharacter.name} background removed`} onClick={() => openExpandedImage(fileUrlFor(activeCharacter.clearedServerPath), `${activeCharacter.name} background removed`)} className="h-[180px] w-full cursor-zoom-in object-contain bg-black/35" />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </SectionCard>
            ) : null}

            {activeStep === "prompt" ? (
              <SectionCard title={`Prompt Builder Ã‚Â· Card ${currentCard} of ${totalCards}`} subtitle="Build and render the still image for the current production card.">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr),360px]">
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="flex items-center gap-3 rounded-[20px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80">
                        <input type="checkbox" checked={usePreviousLength} onChange={(event) => setUsePreviousLength(event.target.checked)} />
                        <span>Use previous length</span>
                      </label>
                      <label className="flex items-center gap-3 rounded-[20px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80">
                        <input type="checkbox" checked={usePreviousIdentityLock} onChange={(event) => setUsePreviousIdentityLock(event.target.checked)} />
                        <span>Use previous identity face lock</span>
                      </label>
                      <label className="flex items-center gap-3 rounded-[20px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80">
                        <input type="checkbox" checked={usePreviousStyleLock} onChange={(event) => setUsePreviousStyleLock(event.target.checked)} />
                        <span>Use previous style lock</span>
                      </label>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-white/85">Positive properties</label>
                      <textarea
                        ref={positivePromptTextareaRef}
                        rows={8}
                        value={positivePrompt}
                        onChange={(event) => setPositivePrompt(event.target.value)}
                        onFocus={capturePositivePromptSelection}
                        onClick={capturePositivePromptSelection}
                        onKeyUp={capturePositivePromptSelection}
                        onSelect={capturePositivePromptSelection}
                        className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-white/85">Negative properties</label>
                      <textarea rows={6} value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45" />
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button type="button" disabled={promptImageBusy || promptImageUploadBusy} onClick={handleCreatePromptImage} className="rounded-full bg-[linear-gradient(90deg,rgba(111,76,255,0.85),rgba(32,183,255,0.8))] px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">
                        {promptImageBusy ? "Creating PictureÃ¢â‚¬Â¦" : "Create Picture"}
                      </button>
                      <button type="button" disabled={promptImageBusy || promptImageUploadBusy} onClick={() => promptImageInputRef.current?.click()} className="rounded-full border border-cyan-300/30 bg-cyan-500/12 px-5 py-3 text-sm font-black text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50">
                        {promptImageUploadBusy ? "Uploading..." : "Upload Image"}
                      </button>
                      <button type="button" disabled={promptImageBusy || promptImageUploadBusy || recentImageBusy} onClick={() => void loadRecentProductionImages()} className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/82 disabled:cursor-not-allowed disabled:opacity-50">
                        {recentImageBusy ? "Loading..." : "Recent Image"}
                      </button>
                      <button type="button" disabled={promptImageBusy || promptImageUploadBusy || !promptImagePreview} onClick={openProductionChangeAngle} className="rounded-full border border-fuchsia-300/35 bg-fuchsia-500/12 px-5 py-3 text-sm font-black text-fuchsia-100 disabled:cursor-not-allowed disabled:opacity-50">
                        Change Angle
                      </button>
                      <input
                        ref={promptImageInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void handlePromptImageUpload(file);
                        }}
                      />
                      {promptImageError ? <div className="text-sm text-rose-300">{promptImageError}</div> : null}
                    </div>
                    {promptImagePreview ? (
                      <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/35 p-3">
                        <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-white/55">Generated picture preview</div>
                        <img src={promptImagePreview} alt="Generated picture preview" onClick={() => openExpandedImage(promptImagePreview, "Generated picture preview")} className="h-[320px] w-full cursor-zoom-in rounded-[18px] object-contain" />
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-4">
                    <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                      <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Reference thumbnails</div>
                      <div className="mt-3 grid gap-3">
                        <div className="rounded-[20px] border border-white/10 bg-black/35 p-3">
                          <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-white/55">Background</div>
                          {backgroundPreviewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={backgroundPreviewUrl} alt="Background reference" onClick={() => openExpandedImage(backgroundPreviewUrl, "Background reference")} className="h-40 w-full cursor-zoom-in rounded-[18px] object-contain bg-black/35" />
                          ) : (
                            <div className="rounded-[18px] border border-dashed border-white/12 px-3 py-8 text-center text-xs text-white/40">No background selected</div>
                          )}
                        </div>
                        {activeCharacters.map((character) => {
                          const preview = character.previewUrl || (character.clearedServerPath ? `/api/file?path=${encodeURIComponent(character.clearedServerPath)}` : character.serverPath ? `/api/file?path=${encodeURIComponent(character.serverPath)}` : "");
                          return (
                            <div key={character.id} className="rounded-[20px] border border-white/10 bg-black/35 p-3">
                              <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-white/55">{character.name || "Character"}</div>
                              {preview ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={preview} alt={character.name || "Character reference"} onClick={() => openExpandedImage(preview, character.name || "Character reference")} className="h-40 w-full cursor-zoom-in rounded-[18px] object-contain bg-black/35" />
                              ) : (
                                <div className="rounded-[18px] border border-dashed border-white/12 px-3 py-8 text-center text-xs text-white/40">No character image</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </SectionCard>
            ) : null}

            {activeStep === "video" ? (
              <SectionCard title={`Create Video - Scene ${currentCard} of ${totalCards}`} subtitle="Use the saved picture, prompts, and optional custom voice clip to create a 1280x720 landscape video.">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr),420px]">
                  <div className="space-y-4">
                    <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                      <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Incoming saved image</div>
                      {promptImagePreview ? (
                        <div className="mt-3 overflow-hidden rounded-[22px] border border-white/10 bg-black/35 p-3">
                          <img src={promptImagePreview} alt="Prompt Builder result" onClick={() => openExpandedImage(promptImagePreview, "Prompt Builder result")} className="h-[320px] w-full cursor-zoom-in object-contain" />
                        </div>
                      ) : (
                        <div className="mt-3 rounded-[22px] border border-dashed border-white/12 bg-black/35 px-4 py-16 text-center text-sm text-white/45">
                          Create and keep a picture in Prompt Builder first.
                        </div>
                      )}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <label className="text-sm font-semibold text-white/85">Final ID-LoRA prompt</label>
                          <button
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={applyIdLoraPromptTemplate}
                            className="rounded-full border border-cyan-300/35 bg-cyan-500/12 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-cyan-100"
                          >
                            Apply [VISUAL]/[SPEECH]/[SOUNDS] Template
                          </button>
                        </div>
                        <div className="rounded-[18px] border border-cyan-300/18 bg-cyan-500/8 px-4 py-3 text-sm text-cyan-50/88">
                          <div className="font-black uppercase tracking-[0.16em] text-cyan-100/90">Hard rule</div>
                          <div className="mt-2 whitespace-pre-wrap font-mono text-[12px] leading-6">[VISUAL]: scene and appearance description{`
`}[SPEECH]: exact words the person should say{`
`}[SOUNDS]: speaker vocal style + ambient/environmental sounds</div>
                          <div className="mt-2 text-xs text-cyan-100/70">Character buttons are color-coded for editing only. Inserted prompt text stays plain for workflow stability.</div>
                        </div>
                        <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/85">
                          <div className="font-black uppercase tracking-[0.16em] text-white/75">Example prompt</div>
                          <div className="mt-2 whitespace-pre-wrap font-mono text-[12px] leading-6 text-white/82">{CREATE_VIDEO_EXAMPLE_PROMPT}</div>
                        </div>
                        {promptInsertCharacters.length ? (
                          <div className="rounded-[20px] border border-white/10 bg-black/30 p-3">
                            <div className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/60">Insert loaded character reference into prompt</div>
                            <div className="flex flex-wrap gap-2">
                              {promptInsertCharacters.map((character, index) => (
                                <button
                                  key={character.id}
                                  type="button"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => insertCharacterIntoPositivePrompt(character)}
                                  className={cn(
                                    "rounded-full border px-3 py-2 text-xs font-black uppercase tracking-[0.16em] transition hover:brightness-110",
                                    CHARACTER_BUTTON_STYLES[index % CHARACTER_BUTTON_STYLES.length]
                                  )}
                                  title={buildCharacterPromptInsert(character)}
                                >
                                  {character.name || `Character ${index + 1}`}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <textarea
                          ref={positivePromptTextareaRef}
                          rows={9}
                          value={positivePrompt}
                          onChange={(event) => setPositivePrompt(event.target.value)}
                          onFocus={capturePositivePromptSelection}
                          onClick={capturePositivePromptSelection}
                          onKeyUp={capturePositivePromptSelection}
                          onSelect={capturePositivePromptSelection}
                          placeholder={ID_LORA_PROMPT_TEMPLATE}
                          className={cn(
                            "w-full rounded-[24px] border bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45",
                            promptHasHardRuleFormat ? "border-cyan-400/25" : "border-amber-300/25"
                          )}
                        />
                        {!promptHasHardRuleFormat ? (
                          <div className="text-xs text-amber-200/85">Create Video is blocked until the final prompt contains [VISUAL], [SPEECH], and [SOUNDS] in that order.</div>
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-white/85">Negative prompt</label>
                        <textarea rows={6} value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45" />
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Video settings</div>
                          <div className="mt-1 text-sm text-white/60">1280 x 720 - landscape only - 24 fps</div>
                        </div>
                        <div className="rounded-full border border-white/10 bg-black/35 px-4 py-2 text-sm text-white/80">Duration: {videoDurationSec}s</div>
                      </div>
                      <input type="range" min={5} max={15} step={1} value={videoDurationSec} onChange={(event) => setVideoDurationSec(Number(event.target.value) || 5)} className="mt-4 w-full accent-cyan-400" />
                    </div>

                    {videoError ? <div className="rounded-[18px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{videoError}</div> : null}

                    <div className="flex flex-wrap gap-3">
                      <button type="button" onClick={() => void handleCreateVideo()} disabled={videoBusy} className="rounded-full bg-[linear-gradient(90deg,rgba(111,76,255,0.85),rgba(32,183,255,0.8))] px-5 py-3 text-sm font-black text-white disabled:opacity-45">
                        {videoBusy ? "Creating Video..." : "Create Video"}
                      </button>
                      <button type="button" onClick={handleSaveCurrentCardVideo} disabled={videoBusy || !videoPath || !videoPreviewUrl} className="rounded-full border border-cyan-300/30 bg-cyan-500/15 px-5 py-3 text-sm font-black text-cyan-100 disabled:opacity-45">
                        Lock Scene {currentCard}
                      </button>
                      <button type="button" onClick={handleNextScene} disabled={videoBusy || !videoPath || !videoPreviewUrl} className="rounded-full border border-emerald-300/30 bg-emerald-500/12 px-5 py-3 text-sm font-black text-emerald-100 disabled:opacity-45">
                        {currentCard < totalCards ? `Next Scene ${currentCard + 1}` : "Review Scenes"}
                      </button>
                      <button type="button" onClick={handleFinishVideo} disabled={videoBusy || !videoPath || !videoPreviewUrl} className="rounded-full border border-fuchsia-300/30 bg-fuchsia-500/12 px-5 py-3 text-sm font-black text-fuchsia-100 disabled:opacity-45">
                        Finish Video / Review
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-4 rounded-[24px] border border-white/10 bg-white/5 p-4">
                      <label className="flex items-center gap-3 rounded-[18px] border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/80">
                        <input type="checkbox" checked={useCustomVoice} onChange={(event) => setUseCustomVoice(event.target.checked)} />
                        <span>Use custom voice / audio workflow</span>
                      </label>
                      <div className="rounded-[20px] border border-white/10 bg-black/35 p-4 text-sm text-white/70">
                        <div className="font-semibold text-white/85">Selected voice</div>
                        <div className="mt-1">{preferredCharacterVoice ? `${preferredCharacterVoice.name} (loaded character)` : selectedVoiceName || "No voice selected"}</div>
                        <div className="mt-2 text-xs text-white/55">
                          {preferredCharacterVoice
                            ? "The loaded character reference audio is auto-inserted into the single-voice ID-LoRA workflow for this step."
                            : "Choose a voice only when no saved character voice is loaded yet."}
                        </div>
                        {useCustomVoice && (preferredCharacterVoice?.audioUrl || savedVoiceClipUrl) ? (
                          <audio controls className="mt-3 w-full" src={preferredCharacterVoice?.audioUrl || savedVoiceClipUrl} />
                        ) : null}
                        <div className="mt-4 flex flex-wrap gap-3">
                          {preferredCharacterVoice ? (
                            <div className="rounded-full border border-cyan-300/20 bg-cyan-500/10 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-cyan-100">
                              Auto voice source: {preferredCharacterVoice.name}
                            </div>
                          ) : (
                            <>
                              <button type="button" onClick={openVoiceLibrary} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80">
                                Voice Library
                              </button>
                              <button type="button" onClick={() => { setSavedVoiceClipPath(undefined); setSavedVoiceClipUrl(""); setVoiceDialogue(""); }} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80">
                                Clear Voice
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                      <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Generated video preview</div>
                      {videoPreviewUrl ? (
                        <video key={videoPreviewUrl} controls className="mt-3 h-[280px] w-full rounded-[20px] bg-black/40 object-contain">
                          <source src={videoPreviewUrl} type="video/mp4" />
                        </video>
                      ) : (
                        <div className="mt-3 rounded-[22px] border border-dashed border-white/12 bg-black/35 px-4 py-14 text-center text-sm text-white/45">
                          Create the video and it will preview here.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </SectionCard>
            ) : null}

{activeStep === "validation" ? (
              <SectionCard title="Validation" subtitle="Validation stays flexible. This patch keeps the slot visible without hard-locking the later rules.">
                <div className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/65">
                  Validation will be finalized after card generation and video flow are in place. Keeping the slot visible now avoids another structural rewrite later.
                </div>
              </SectionCard>
            ) : null}

            {activeStep === "review" ? (
              <SectionCard title="Review Locked Scenes" subtitle="Review each locked scene before stitching. This shows the starter image, prompt, character names, and the locked video for each scene.">
                {savedCardVideos.length ? (
                  <div className="space-y-4">
                    <div className="rounded-[22px] border border-emerald-300/20 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100">
                      {savedCardVideos.length} scene{savedCardVideos.length === 1 ? "" : "s"} locked. Continue Production will preserve these videos unless you delete the production or replace a scene intentionally.
                    </div>
                    <div className="grid gap-4 xl:grid-cols-2">
                      {savedCardVideos.map((scene) => (
                        <div key={scene.card} className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Scene {scene.card}</div>
                            <div className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-100">Locked</div>
                          </div>
                          {scene.imageUrl ? (
                            <div className="mt-3 overflow-hidden rounded-[18px] border border-white/10 bg-black/35 p-3">
                              <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">Starter image</div>
                              <img src={scene.imageUrl} alt={`Scene ${scene.card} starter image`} onClick={() => openExpandedImage(scene.imageUrl, `Scene ${scene.card} starter image`)} className="h-[220px] w-full cursor-zoom-in rounded-[14px] object-contain" />
                            </div>
                          ) : null}
                          <div className="mt-3 overflow-hidden rounded-[18px] border border-white/10 bg-black/35 p-3">
                            <div className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">Locked video</div>
                            <video controls className="h-[240px] w-full rounded-[14px] bg-black object-contain">
                              <source src={scene.videoUrl} />
                            </video>
                          </div>
                          {scene.prompt ? (
                            <div className="mt-3 rounded-[18px] border border-white/10 bg-black/35 px-4 py-3 text-xs text-white/70 whitespace-pre-wrap">{scene.prompt}</div>
                          ) : null}
                          {scene.characterNames?.length ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {scene.characterNames.map((name) => (
                                <span key={`${scene.card}-${name}`} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/75">{name}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button type="button" onClick={() => setActiveStep("video")} className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/80">
                        Back to Create Video
                      </button>
                      <button type="button" onClick={() => void handleGoToStitch()} className="rounded-full border border-fuchsia-300/30 bg-fuchsia-500/12 px-5 py-3 text-sm font-black text-fuchsia-100">
                        Continue to Stitch
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/65">
                    Lock at least one scene video before Review.
                  </div>
                )}
              </SectionCard>
            ) : null}

            {activeStep === "stitch" ? (
              <SectionCard title="Stitch" subtitle="Only locked scene videos are used here. Starter images, prompts, and character notes stay on the Review page.">
                {savedCardVideos.length ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 xl:grid-cols-2">
                      {savedCardVideos.map((scene) => (
                        <div key={scene.card} className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                          <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Scene {scene.card} video</div>
                          <div className="mt-3 overflow-hidden rounded-[18px] border border-white/10 bg-black/35 p-3">
                            <video controls className="h-[240px] w-full rounded-[14px] bg-black object-contain">
                              <source src={scene.videoUrl} />
                            </video>
                          </div>
                        </div>
                      ))}
                    </div>
                    {stitchError ? <div className="rounded-[18px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{stitchError}</div> : null}
                    <div className="flex flex-wrap gap-3">
                      <button type="button" onClick={() => setActiveStep("review")} disabled={stitchBusy} className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/80 disabled:opacity-45">
                        Back to Review
                      </button>
                      <button type="button" onClick={() => void handleStitchProduction()} disabled={stitchBusy} className="rounded-full bg-[linear-gradient(90deg,rgba(111,76,255,0.85),rgba(32,183,255,0.8))] px-5 py-3 text-sm font-black text-white disabled:opacity-45">
                        {stitchBusy ? "Stitching..." : "Stitch Video"}
                      </button>
                    </div>
                    {stitchedVideoUrl ? (
                      <div className="rounded-[24px] border border-emerald-300/20 bg-emerald-500/10 p-4">
                        <div className="text-sm font-black uppercase tracking-[0.18em] text-emerald-100">Stitched preview</div>
                        <video key={stitchedVideoUrl} controls className="mt-3 h-[320px] w-full rounded-[20px] bg-black object-contain">
                          <source src={stitchedVideoUrl} type="video/mp4" />
                        </video>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <a href={stitchedVideoUrl} download className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/85">
                            Download
                          </a>
                          <button type="button" onClick={() => void handleCompleteProject()} disabled={saveBusy} className="rounded-full border border-emerald-300/30 bg-emerald-500/12 px-5 py-3 text-sm font-black text-emerald-100 disabled:opacity-45">
                            Complete Project
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/65">
                    Lock at least one scene video before opening Stitch.
                  </div>
                )}
              </SectionCard>
            ) : null}

            <div className="sticky bottom-0 z-20 rounded-[28px] border border-white/10 bg-black/75 px-4 py-4 shadow-[0_-8px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-h-[24px] text-sm text-emerald-200">{savedNotice || ""}</div>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" onClick={requestExitToMenu} className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/80">
                    Back to project
                  </button>
                  {previousStepLabel() ? (
                    <button
                      type="button"
                      onClick={goToPreviousStep}
                      className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/85 transition hover:bg-white/10"
                    >
                      {previousStepLabel()}
                    </button>
                  ) : null}
                  {nextStepLabel() ? (
                    <button
                      type="button"
                      onClick={goToNextStep}
                      className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-5 py-3 text-sm font-semibold text-cyan-100"
                    >
                      {nextStepLabel()}
                    </button>
                  ) : null}
                  <button type="button" onClick={() => void saveProductionState()} disabled={saveBusy} className="rounded-full bg-[linear-gradient(90deg,rgba(111,76,255,0.85),rgba(32,183,255,0.8))] px-5 py-3 text-sm font-black text-white disabled:opacity-45">
                    {saveBusy ? "Saving..." : "Save Production"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {characterLibraryOpen ? (
        <ModalShell title={`Character Library${characterLibraryTargetIndex != null ? ` Â· Load into Character ${characterLibraryTargetIndex + 1}` : ""}`}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-white/65">
                Pick a saved character to auto-fill this Production slot for the ID-LoRA workflow. Production only pulls the saved image and default voice here.
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => void refreshCharacterLibrary()} disabled={characterLibraryBusy} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 disabled:opacity-45">
                  {characterLibraryBusy ? "Refreshing..." : "Refresh"}
                </button>
                <button type="button" onClick={() => { setCharacterLibraryOpen(false); setCharacterLibraryTargetIndex(null); setCharacterLibraryError(""); }} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80">
                  Close
                </button>
              </div>
            </div>
            {characterLibraryError ? <div className="rounded-[18px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{characterLibraryError}</div> : null}
            <div className="max-h-[68vh] space-y-3 overflow-auto pr-1">
              {characterLibraryBusy ? <div className="rounded-[20px] border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/60">Loading saved characters...</div> : null}
              {!characterLibraryBusy && !characterLibraryItems.length ? <div className="rounded-[20px] border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/60">No saved characters found in the library yet.</div> : null}
              {characterLibraryItems.map((item) => (
                <div key={item.id} className="grid gap-4 rounded-[22px] border border-white/10 bg-white/5 p-4 md:grid-cols-[120px,minmax(0,1fr),auto]">
                  <div className="overflow-hidden rounded-[18px] border border-white/10 bg-black/35">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={fileUrlFor(item.imagePath)} alt={item.name} className="h-[160px] w-full object-contain bg-black/35" />
                  </div>
                  <div className="space-y-2">
                    <div className="text-base font-semibold text-white">{item.name}</div>
                    <div className="text-sm text-white/62">{item.description || "No description saved."}</div>
                    <div className="flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-white/70">
                      <span className="rounded-full border border-white/10 bg-black/35 px-3 py-1">ID-LoRA ready image</span>
                      {item.referenceAudioPath ? <span className="rounded-full border border-cyan-300/20 bg-cyan-500/10 px-3 py-1 text-cyan-100">Default audio</span> : null}
                    </div>
                    {item.referenceAudioPath ? <audio controls preload="none" className="w-full" src={fileUrlFor(item.referenceAudioPath)} /> : null}
                  </div>
                  <div className="flex items-start justify-end">
                    <button type="button" onClick={() => applyLibraryCharacterToSlot(characterLibraryTargetIndex ?? 0, item)} className="rounded-full bg-[linear-gradient(90deg,rgba(111,76,255,0.85),rgba(32,183,255,0.8))] px-5 py-3 text-sm font-black text-white">
                      Load into Character {(characterLibraryTargetIndex ?? 0) + 1}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ModalShell>
      ) : null}

      {productionAngleOpen ? (
        <ModalShell title="Change Angle">
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),260px]">
              <div className="rounded-[24px] border border-white/10 bg-black/35 p-3">
                <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-white/55">Current scene image</div>
                {getProductionAngleSourceUrl() ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={getProductionAngleSourceUrl()} alt="Current scene image for Change Angle" className="max-h-[52vh] w-full rounded-[18px] bg-black/45 object-contain" />
                ) : (
                  <div className="rounded-[18px] border border-dashed border-white/12 px-4 py-8 text-sm text-white/45">No scene image selected.</div>
                )}
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/80">Camera</div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div />
                  <button type="button" onClick={() => setProductionAngleDirection("up")} className={cn("rounded-2xl border px-3 py-3 text-sm font-black", productionAngleDirection === "up" ? "border-cyan-300/45 bg-cyan-500/18 text-cyan-100" : "border-white/10 bg-black/35 text-white/75")}>Up</button>
                  <div />
                  <button type="button" onClick={() => setProductionAngleDirection("left")} className={cn("rounded-2xl border px-3 py-3 text-sm font-black", productionAngleDirection === "left" ? "border-cyan-300/45 bg-cyan-500/18 text-cyan-100" : "border-white/10 bg-black/35 text-white/75")}>Left</button>
                  <button type="button" onClick={() => setProductionAngleDirection("front")} className={cn("rounded-2xl border px-3 py-3 text-sm font-black", productionAngleDirection === "front" ? "border-cyan-300/45 bg-cyan-500/18 text-cyan-100" : "border-white/10 bg-black/35 text-white/75")}>Front</button>
                  <button type="button" onClick={() => setProductionAngleDirection("right")} className={cn("rounded-2xl border px-3 py-3 text-sm font-black", productionAngleDirection === "right" ? "border-cyan-300/45 bg-cyan-500/18 text-cyan-100" : "border-white/10 bg-black/35 text-white/75")}>Right</button>
                  <div />
                  <button type="button" onClick={() => setProductionAngleDirection("down")} className={cn("rounded-2xl border px-3 py-3 text-sm font-black", productionAngleDirection === "down" ? "border-cyan-300/45 bg-cyan-500/18 text-cyan-100" : "border-white/10 bg-black/35 text-white/75")}>Down</button>
                  <div />
                </div>
                <div className="mt-4 rounded-[18px] border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/55">
                  Uses the current Production scene image and the Angles image workflow. Up/down are passed through as camera metadata; the current workflow mainly supports horizontal branches.
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void handleProductionAnglePreview()} disabled={productionAngleBusy || !getProductionAngleSourceUrl()} className="rounded-full bg-[linear-gradient(90deg,rgba(111,76,255,0.85),rgba(32,183,255,0.8))] px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">
                    {productionAngleBusy ? "Creating..." : "Create Preview"}
                  </button>
                  <button type="button" onClick={saveProductionAnglePreview} disabled={!productionAngleResultUrl || !productionAngleResultPath || productionAngleBusy} className="rounded-full border border-emerald-300/30 bg-emerald-500/12 px-4 py-2 text-sm font-black text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50">
                    Save
                  </button>
                  <button type="button" onClick={() => { setProductionAngleOpen(false); setProductionAngleError(""); }} disabled={productionAngleBusy} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 disabled:opacity-50">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
            {productionAngleError ? <div className="rounded-[18px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{productionAngleError}</div> : null}
            {productionAngleResultUrl ? (
              <div className="rounded-[24px] border border-cyan-300/20 bg-cyan-500/10 p-3">
                <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-cyan-100">Preview {productionAngleResultLabel ? " - " + productionAngleResultLabel : ""}</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img key={productionAngleResultUrl} src={productionAngleResultUrl} alt="Changed angle preview" className="max-h-[52vh] w-full rounded-[18px] bg-black/45 object-contain" />
              </div>
            ) : null}
          </div>
        </ModalShell>
      ) : null}
      {recentImageOpen ? (
        <ModalShell title="Recent production images">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-white/65">Select a recent Gallery image to reuse as the current scene image. Videos are excluded.</div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void loadRecentProductionImages()} disabled={recentImageBusy} className="rounded-full border border-cyan-300/25 bg-cyan-500/10 px-4 py-2 text-sm font-black text-cyan-100 disabled:opacity-45">
                  {recentImageBusy ? "Refreshing..." : "Refresh"}
                </button>
                <button type="button" onClick={() => { setRecentImageOpen(false); setRecentImageError(""); }} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80">
                  Close
                </button>
              </div>
            </div>
            {recentImageError ? <div className="rounded-[18px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{recentImageError}</div> : null}
            <div className="max-h-[68vh] grid gap-3 overflow-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
              {recentImageBusy ? <div className="rounded-[20px] border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/60">Loading recent images...</div> : null}
              {!recentImageBusy && !recentImages.length ? <div className="rounded-[20px] border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/60">No recent Gallery images found.</div> : null}
              {recentImages.map((item) => (
                <button key={`${item.imagePath}-${item.createdAt || 0}`} type="button" onClick={() => selectRecentProductionImage(item)} className="overflow-hidden rounded-[22px] border border-white/10 bg-white/5 p-3 text-left hover:border-cyan-300/40 hover:bg-cyan-500/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.imageUrl} alt={item.name} className="h-[180px] w-full rounded-[16px] bg-black/35 object-contain" />
                  <div className="mt-3 truncate text-sm font-semibold text-white">{item.name}</div>
                  <div className="mt-1 text-xs text-white/45">Use as current scene image</div>
                </button>
              ))}
            </div>
          </div>
        </ModalShell>
      ) : null}


      {voiceLibraryOpen ? (
        <ModalShell title="Custom voice clip">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[220px,minmax(0,1fr)]">
              <div className="space-y-2 rounded-[24px] border border-white/10 bg-black/35 p-3">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/80">Voice library</div>
                <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
                  {voiceLibraryBusy ? <div className="rounded-[16px] border border-white/10 bg-white/5 px-3 py-4 text-sm text-white/60">Loading voicesÃ¢â‚¬Â¦</div> : null}
                  {!voiceLibraryBusy && !voiceLibrary.length ? <div className="rounded-[16px] border border-white/10 bg-white/5 px-3 py-4 text-sm text-white/60">No saved voices found.</div> : null}
                  {voiceLibrary.map((voice) => (
                    <button key={voice.voiceId} type="button" onClick={() => { setSelectedVoiceId(voice.voiceId); setSelectedVoiceName(voice.name); setVoiceClipError(""); }} className={cn("w-full rounded-[18px] border px-3 py-3 text-left text-sm", selectedVoiceId === voice.voiceId ? "border-cyan-300/40 bg-cyan-500/12 text-cyan-100" : "border-white/10 bg-white/5 text-white/80")}>
                      <div className="font-semibold">{voice.name}</div>
                      {voice.refAudioUrl ? <audio controls className="mt-2 w-full" src={voice.refAudioUrl} /> : null}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <div className="rounded-[24px] border border-white/10 bg-black/35 p-4">
                  <div className="text-sm font-semibold text-white/85">Dialogue for {selectedVoiceName || "selected voice"}</div>
                  <textarea rows={8} value={voiceDialogue} onChange={(event) => setVoiceDialogue(event.target.value)} placeholder="Type what the character should say." className="mt-3 w-full rounded-[22px] border border-white/10 bg-black/55 px-4 py-3 text-white outline-none focus:border-cyan-400/45" />
                  {voiceClipError ? <div className="mt-3 rounded-[18px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{voiceClipError}</div> : null}
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button type="button" onClick={() => void handleGenerateVoiceClip()} disabled={voiceClipBusy} className="rounded-full bg-[linear-gradient(90deg,rgba(111,76,255,0.85),rgba(32,183,255,0.8))] px-5 py-3 text-sm font-black text-white disabled:opacity-45">{voiceClipBusy ? "SubmittingÃ¢â‚¬Â¦" : "Submit"}</button>
                    <button type="button" onClick={redoGeneratedVoiceClip} disabled={voiceClipBusy || !selectedVoiceId} className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/80 disabled:opacity-45">Redo</button>
                    <button type="button" onClick={saveGeneratedVoiceClip} disabled={voiceClipBusy || !voiceClipDraftUrl} className="rounded-full border border-cyan-300/30 bg-cyan-500/15 px-5 py-3 text-sm font-black text-cyan-100 disabled:opacity-45">Save</button>
                    <button type="button" onClick={() => { setVoiceLibraryOpen(false); setVoiceClipError(""); }} disabled={voiceClipBusy} className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/80 disabled:opacity-45">Cancel</button>
                  </div>
                </div>
                <div className="rounded-[24px] border border-white/10 bg-black/35 p-4">
                  <div className="text-sm font-black uppercase tracking-[0.18em] text-cyan-200/80">Clip preview</div>
                  {voiceClipDraftUrl ? <audio controls className="mt-3 w-full" src={voiceClipDraftUrl} /> : <div className="mt-3 rounded-[18px] border border-dashed border-white/12 px-4 py-8 text-center text-sm text-white/45">Generate the clip and preview it here.</div>}
                </div>
              </div>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {expandedImage ? (
        <div className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/88 p-4 backdrop-blur-sm" onClick={() => setExpandedImage(null)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Escape" || event.key === "Enter" || event.key === " ") setExpandedImage(null); }}>
          <div className="relative w-full max-w-6xl" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setExpandedImage(null)}
              className="absolute right-2 top-2 z-10 rounded-full border border-white/15 bg-black/65 px-4 py-2 text-sm font-black text-white"
            >
              Close
            </button>
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#05060b] p-3 shadow-[0_20px_80px_rgba(0,0,0,0.55)] md:p-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={expandedImage.src} alt={expandedImage.alt} className="max-h-[82vh] w-full rounded-[20px] object-contain" />
            </div>
          </div>
        </div>
      ) : null}

      {exitPromptOpen ? (
        <ModalShell title="Unsaved changes">
          <div className="space-y-5">
            <div className="text-sm text-white/75">Changes have been made do you want to save?</div>
            {saveError ? <div className="rounded-[18px] border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{saveError}</div> : null}
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => void saveAndExit()} disabled={saveBusy} className="rounded-full bg-[linear-gradient(90deg,rgba(111,76,255,0.85),rgba(32,183,255,0.8))] px-5 py-3 text-sm font-black text-white disabled:opacity-45">
                Save
              </button>
              <button type="button" onClick={discardAndExit} disabled={saveBusy} className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/80 disabled:opacity-45">
                Don't Save
              </button>
              <button type="button" onClick={() => setExitPromptOpen(false)} disabled={saveBusy} className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white/80 disabled:opacity-45">
                Cancel
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}
