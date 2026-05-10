import fs from "node:fs";
import path from "node:path";
import { OTG_DATA_ROOT, ensureDir, readJsonSafe, safeSegment } from "@/lib/paths";

export type ProductionStepKey =
  | "setup"
  | "characters"
  | "prompt"
  | "video"
  | "validation"
  | "stitch"
  | "review";

export type PersistedProductionCharacter = {
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
};

export type PersistedProductionScene = {
  card: number;
  imagePath?: string;
  videoPath: string;
  audioPath?: string;
  prompt?: string;
  characterNames?: string[];
};

export type PersistedProductionTimelineScene = {
  id: string;
  title?: string;
  prompt: string;
  durationSec: number;
  characterNames?: string[];
  hardCut?: boolean;
};

export type PersistedProductionState = {
  productionId: string;
  name: string;
  activeStep: ProductionStepKey;
  currentCard: number;
  totalCards: number;
  characterCount: 1 | 2 | 3 | 4 | 5 | null;
  backgroundPrompt: string;
  backgroundPreset?: string;
  backgroundImagePath?: string;
  backgroundImageMode?: "upload" | "generated" | null;
  defaultLens: string;
  defaultMood: string;
  defaultStyle: string;
  defaultIdentity: string;
  positivePrompt: string;
  negativePrompt: string;
  timelineGlobalPrompt?: string;
  timelineScenes?: PersistedProductionTimelineScene[];
  timelineFps?: number;
  timelineUseVideoReasoning?: boolean;
  timelineUseCrispEnhance?: boolean;
  usePreviousLength: boolean;
  usePreviousIdentityLock: boolean;
  usePreviousStyleLock: boolean;
  characters: PersistedProductionCharacter[];
  savedCardVideos?: PersistedProductionScene[];
  stitchedVideoPath?: string;
  completedAt?: string;
  status?: "active" | "completed";
};

export type PersistedProductionRecord = {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  state: PersistedProductionState;
};

export type ProductionSummary = {
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
  status: "active" | "completed";
};

const PRODUCTIONS_ROOT = path.join(OTG_DATA_ROOT, "productions");
const STEP_KEYS: ProductionStepKey[] = ["setup", "characters", "prompt", "video", "validation", "stitch", "review"];

function ownerRoot(ownerKey: string): string {
  const dir = path.join(PRODUCTIONS_ROOT, safeSegment(ownerKey || "local"));
  ensureDir(dir);
  return dir;
}

function activeFile(ownerKey: string): string {
  return path.join(ownerRoot(ownerKey), "active.json");
}

function fileForProduction(ownerKey: string, productionId: string): string {
  return path.join(ownerRoot(ownerKey), `${safeSegment(productionId || "production")}.json`);
}

function normalizeId(name: string, productionId?: string): string {
  const raw = (productionId || "").trim();
  if (raw) return safeSegment(raw);
  const slug = safeSegment(name || "production");
  return `${slug}_${Date.now()}`;
}

function normalizeStep(step: string | undefined): ProductionStepKey {
  return STEP_KEYS.includes(step as ProductionStepKey) ? (step as ProductionStepKey) : "setup";
}

function normalizeScene(scene: any): PersistedProductionScene | null {
  const videoPath = scene?.videoPath ? String(scene.videoPath) : "";
  if (!videoPath) return null;
  const card = Math.max(1, Math.min(5, Number(scene?.card || 1)));
  const characterNames = Array.isArray(scene?.characterNames)
    ? scene.characterNames.map((name: any) => String(name || "").trim()).filter(Boolean)
    : [];
  return {
    card,
    imagePath: scene?.imagePath ? String(scene.imagePath) : undefined,
    videoPath,
    audioPath: scene?.audioPath ? String(scene.audioPath) : undefined,
    prompt: scene?.prompt ? String(scene.prompt) : undefined,
    characterNames,
  };
}

function normalizeTimelineScene(scene: any, index: number): PersistedProductionTimelineScene | null {
  const prompt = String(scene?.prompt || "").trim();
  if (!prompt) return null;
  const durationSec = Math.max(1, Math.min(30, Number(scene?.durationSec || scene?.seconds || scene?.duration || 5) || 5));
  const characterNames = Array.isArray(scene?.characterNames)
    ? scene.characterNames.map((name: any) => String(name || "").trim()).filter(Boolean)
    : [];
  return {
    id: String(scene?.id || `scene-${index + 1}`),
    title: scene?.title ? String(scene.title) : undefined,
    prompt,
    durationSec,
    characterNames,
    hardCut: scene?.hardCut !== false,
  };
}

function normalizeState(input: PersistedProductionState): PersistedProductionState {
  const safeCount =
    input.characterCount == null
      ? null
      : (Math.max(1, Math.min(5, Number(input.characterCount || 1))) as 1 | 2 | 3 | 4 | 5);

  const characters = Array.isArray(input.characters)
    ? input.characters.map((character, index) => ({
        id: (character?.id || `c${index + 1}`).toString(),
        name: (character?.name || `Character ${index + 1}`).toString(),
        nameLocked: !!character?.nameLocked,
        serverPath: character?.serverPath ? String(character.serverPath) : undefined,
        clearedServerPath: character?.clearedServerPath ? String(character.clearedServerPath) : undefined,
        descriptor: (character?.descriptor || "").toString(),
        sourceCharacterId: character?.sourceCharacterId ? String(character.sourceCharacterId) : undefined,
        sourceCharacterName: character?.sourceCharacterName ? String(character.sourceCharacterName) : undefined,
        introVideoPath: character?.introVideoPath ? String(character.introVideoPath) : undefined,
        referenceAudioPath: character?.referenceAudioPath ? String(character.referenceAudioPath) : undefined,
        voiceStyleDefinition: character?.voiceStyleDefinition ? String(character.voiceStyleDefinition) : undefined,
        introLine: character?.introLine ? String(character.introLine) : undefined,
      }))
    : [];

  const savedCardVideos = Array.isArray(input.savedCardVideos)
    ? input.savedCardVideos
        .map((scene) => normalizeScene(scene))
        .filter((scene): scene is PersistedProductionScene => !!scene)
        .sort((a, b) => a.card - b.card)
    : [];

  const timelineScenes = Array.isArray(input.timelineScenes)
    ? input.timelineScenes
        .map((scene, index) => normalizeTimelineScene(scene, index))
        .filter((scene): scene is PersistedProductionTimelineScene => !!scene)
    : [];

  return {
    productionId: normalizeId(input.name || "production", input.productionId),
    name: (input.name || "Untitled Production").toString().trim() || "Untitled Production",
    activeStep: normalizeStep(input.activeStep),
    currentCard: Math.max(1, Math.min(5, Number(input.currentCard || 1))),
    totalCards: 5,
    characterCount: safeCount,
    backgroundPrompt: (input.backgroundPrompt || "").toString(),
    backgroundPreset: input.backgroundPreset ? String(input.backgroundPreset) : undefined,
    backgroundImagePath: input.backgroundImagePath ? String(input.backgroundImagePath) : undefined,
    backgroundImageMode:
      input.backgroundImageMode === "generated" ? "generated" : input.backgroundImageMode === "upload" ? "upload" : null,
    defaultLens: (input.defaultLens || "").toString(),
    defaultMood: (input.defaultMood || "").toString(),
    defaultStyle: (input.defaultStyle || "").toString(),
    defaultIdentity: (input.defaultIdentity || "").toString(),
    positivePrompt: (input.positivePrompt || "").toString(),
    negativePrompt: (input.negativePrompt || "").toString(),
    timelineGlobalPrompt: input.timelineGlobalPrompt ? String(input.timelineGlobalPrompt) : undefined,
    timelineScenes,
    timelineFps: Math.max(1, Math.min(60, Number(input.timelineFps || 24) || 24)),
    timelineUseVideoReasoning: !!input.timelineUseVideoReasoning,
    timelineUseCrispEnhance: !!input.timelineUseCrispEnhance,
    usePreviousLength: !!input.usePreviousLength,
    usePreviousIdentityLock: !!input.usePreviousIdentityLock,
    usePreviousStyleLock: !!input.usePreviousStyleLock,
    characters,
    savedCardVideos,
    stitchedVideoPath: input.stitchedVideoPath ? String(input.stitchedVideoPath) : undefined,
    completedAt: input.completedAt ? String(input.completedAt) : undefined,
    status: input.status === "completed" || input.completedAt ? "completed" : "active",
  };
}

function toSummary(record: PersistedProductionRecord): ProductionSummary {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    currentCard: record.state?.currentCard ?? 1,
    totalCards: record.state?.totalCards ?? 5,
    characterCount: Array.isArray(record.state?.characters) ? record.state.characters.length : 0,
    activeStep: normalizeStep(record.state?.activeStep),
    sceneCount: Array.isArray(record.state?.savedCardVideos) ? record.state.savedCardVideos.length : 0,
    stitchedVideoPath: record.state?.stitchedVideoPath || undefined,
    completedAt: record.state?.completedAt || undefined,
    status: record.state?.status === "completed" || record.state?.completedAt ? "completed" : "active",
  };
}

export function saveProduction(ownerKey: string, input: PersistedProductionState): PersistedProductionRecord {
  const state = normalizeState(input);
  const filePath = fileForProduction(ownerKey, state.productionId);
  const existing = readJsonSafe<PersistedProductionRecord | null>(filePath, null);
  const now = new Date().toISOString();

  const record: PersistedProductionRecord = {
    version: 1,
    id: state.productionId,
    name: state.name,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    state,
  };

  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf8");
  if (state.status === "completed" || state.completedAt) {
    const activeId = getActiveProductionId(ownerKey);
    if (activeId && activeId === record.id) {
      setActiveProduction(ownerKey, null);
    }
  } else {
    setActiveProduction(ownerKey, record.id);
  }
  return record;
}

export function listProductions(ownerKey: string): ProductionSummary[] {
  const root = ownerRoot(ownerKey);
  const entries = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : [];
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "active.json")
    .map((entry) => readJsonSafe<PersistedProductionRecord | null>(path.join(root, entry.name), null))
    .filter((record): record is PersistedProductionRecord => !!record && !!record.id)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .map(toSummary);
}

export function loadProduction(ownerKey: string, productionId: string): PersistedProductionRecord | null {
  return readJsonSafe<PersistedProductionRecord | null>(fileForProduction(ownerKey, productionId), null);
}

export function setActiveProduction(ownerKey: string, productionId: string | null): void {
  const filePath = activeFile(ownerKey);
  ensureDir(path.dirname(filePath));
  if (!productionId) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
    return;
  }
  fs.writeFileSync(filePath, JSON.stringify({ productionId: safeSegment(productionId) }, null, 2), "utf8");
}

export function getActiveProductionId(ownerKey: string): string | null {
  const data = readJsonSafe<{ productionId?: string } | null>(activeFile(ownerKey), null);
  const id = (data?.productionId || "").trim();
  return id || null;
}

export function getActiveProduction(ownerKey: string): PersistedProductionRecord | null {
  const productionId = getActiveProductionId(ownerKey);
  if (!productionId) return null;
  const record = loadProduction(ownerKey, productionId);
  if (record && (record.state?.status === "completed" || record.state?.completedAt)) {
    setActiveProduction(ownerKey, null);
    return null;
  }
  return record;
}

export function deleteProduction(ownerKey: string, productionId: string): { deleted: boolean; clearedActive: boolean } {
  const filePath = fileForProduction(ownerKey, productionId);
  let deleted = false;
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    deleted = true;
  }

  const activeId = getActiveProductionId(ownerKey);
  let clearedActive = false;
  if (activeId && activeId === safeSegment(productionId)) {
    setActiveProduction(ownerKey, null);
    clearedActive = true;
  }

  return { deleted, clearedActive };
}

export function summarizeProduction(record: PersistedProductionRecord | null): ProductionSummary | null {
  return record ? toSummary(record) : null;
}
