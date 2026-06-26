"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  QWEN_PREVIEW_LINES,
  defaultQwenVoiceDesignInput,
  qwenVoiceDesignStorageRecord,
  type QwenVoiceCandidateInstruction,
  type QwenVoiceDesignInput,
} from "../../../lib/characters/qwenVoiceDesign";
import {
  COSY_LANGUAGES,
  DELIVERY_STYLES,
  QWEN_OFFICIAL_PRESETS,
  SPEAKER_IDENTITIES,
  VOICE_AGE_RANGES,
  VOICE_ENERGIES,
  VOICE_GENDER_PRESENTATIONS,
  VOICE_PACES,
  VOICE_PITCHES,
  VOICE_TIMBRES,
  VOICE_TONES,
  accentOptionsForModel,
  buildVoiceRequestPayload,
  defaultVoiceDesignProfile,
  statusForAccent,
  voiceDesignWarnings,
  voiceModels,
  type VoiceDesignMode,
  type VoiceDesignProfile,
} from "../../../lib/characters/voiceDesignModels";
import {
  DEFAULT_SIMPLE_VOICE_FX,
  VOICE_FX_CATEGORIES,
  findVoiceFxPresetDefinition,
  voiceFxPresetsForCategory,
  type SimpleVoiceFxSettings,
  type VoiceFxParam,
  type VoiceFxPresetDefinition,
} from "../../../lib/characters/voiceFxPresets";
import type {
  ApplioTrainingQualityPresetKey,
  CharacterVoiceProfile,
  VoiceFxPreset,
  VoiceGeneratorProvider,
} from "../../../lib/characterVoiceAudioStudio";
import {
  APPLIO_TRAINING_QUALITY_PRESETS,
  DEFAULT_APPLIO_TRAINING_QUALITY_PRESET,
  buildApplioTrainingArtifactVoiceProfile,
  findUsableTrainedVoiceArtifact,
} from "../../../lib/characterVoiceAudioStudio";
import {
  getCharacterVoiceJob,
  isTerminalJobStatus,
  listCharacterVoiceJobs,
  queueCharacterVoiceJob,
  tickVoicePipelineWorker,
  updateCharacterVoiceJob,
} from "../../../lib/client/voicePipelineClient";
import {
  getBaseVoicePlaybackSelection,
  getTrainedVoicePlaybackSelection,
  selectLatestTrainedVoicePlaybackJob,
} from "../../../lib/characters/trainedVoicePlayback";
import {
  CHARACTER_PREVIEW_DUB_SCRIPT,
  getCharacterPreviewDubSelection,
} from "../../../lib/characters/characterPreviewDub";
import type { CharacterVoicePipelineAction, QueuedContractJob } from "../../../lib/jobs/voicePipelineJobs";

type CharacterRecord = {
  character3dModel?: any;
  character3dModelPath?: string;
  character3dModelUrl?: string;
  character3dModelOutputPath?: string;
  character3dModelEngine?: string;
  id: string;
  name: string;
  imagePath: string;
  previewImagePath?: string;
  characterCardPath?: string;
  description?: string;
  globalPromptIdentityBlock?: string;
  characterVoiceProfile?: CharacterVoiceProfile;
  characterStatus?: string;
  voiceStatus?: string;
  hasCustomVoice?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type CandidateImage = {
  id: string;
  label: string;
  url: string;
  serverPath?: string;
  internalPrompt?: string;
  promptId?: string;
  workflowId?: string;
};

type ImageCompleteness = "full_body" | "half_body" | "face_only";
type BuilderStep = "source" | "generate" | "upload" | "card" | "details" | "voice" | "review";

type CharacterDetails = {
  name: string;
  age: string;
  species: string;
  gender: string;
  height: "short" | "average" | "tall";
  build: "thin" | "average" | "big";
  hairFurColor: string;
  eyeColor: string;
  surfaceDescription: string;
  hasAccent: boolean;
  accentType: string;
  clothingAccessories: string;
};

type VoiceSettings = {
  voiceAge: "child" | "teen" | "young adult" | "adult" | "older";
  genderExpression: "male" | "female" | "androgynous";
  pitch: "low" | "medium" | "high";
  resonance: "thin" | "balanced" | "full";
  energy: "low" | "medium" | "high";
  texture: "clean" | "slightly rough" | "raspy" | "breathy" | "nasal";
  personalityTone: string[];
  hasAccent: boolean;
  accentType: string;
  speciesFlavor: "none" | "subtle" | "medium" | "strong";
  speciesTrait: string;
};

type VoiceFxSettings = {
  preset: VoiceFxPreset;
  pitchSemitones: number;
  speed: number;
  gainDb: number;
  highpassHz: number;
  lowpassHz: number;
  echo: "off" | "subtle" | "room" | "cave";
  normalize: boolean;
  tonePreset?: "neutral" | "dark" | "bright" | "radio" | "telephone";
  bodyMode?: "lighter" | "normal" | "deeper" | "huge";
  gritAmount?: number;
  compression?: "off" | "light" | "medium" | "strong";
  layerMode?: "off" | "octave_down" | "octave_up" | "monster_double" | "ghost_double" | "robot_double";
  layerMix?: number;
};


const STYLE_PRESETS = ["Anime", "Photorealistic", "Unreal Engine", "3D Pixar", "Comic Book", "Cinematic"] as const;
const PERSONALITY_TONES = ["shy", "confident", "nervous", "mischievous", "heroic", "cold", "kind", "sarcastic", "threatening"];
const SPECIES_TRAITS = ["rat-like", "angelic", "robotic", "monstrous", "cute", "bunny-like", "reptilian", "fantasy creature", "custom"];

const CHARACTER_BUILDER_DRAFT_VERSION = 1;
const BUILDER_STEP_ORDER = ["source", "card", "details", "voice", "review"] as const;
type BuilderCanonicalStep = (typeof BUILDER_STEP_ORDER)[number];

function normalizeBuilderStepForNav(value: string): BuilderCanonicalStep {
  if (value === "generate" || value === "upload") return "source";
  return BUILDER_STEP_ORDER.includes(value as BuilderCanonicalStep) ? (value as BuilderCanonicalStep) : "source";
}

function builderStepIndexFor(value: string) {
  const found = BUILDER_STEP_ORDER.findIndex((item) => item === normalizeBuilderStepForNav(value));
  return found >= 0 ? found : 0;
}

function clampLockedBuilderStepIndex(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return -1;
  return Math.max(-1, Math.min(BUILDER_STEP_ORDER.length - 2, Math.floor(value)));
}

const PREVIEW_LINES = [
  {
    id: "neutral",
    label: "Neutral",
    text: "Hey, you just created me. I'm ready to step into the story whenever you are.",
  },
  {
    id: "vulnerable",
    label: "Emotional / vulnerable",
    text: "I don't know what happens next, but I'm here, and I'm trying.",
  },
  {
    id: "intense",
    label: "Intense / raised",
    text: "Back off! I said don't test me again, and this time I mean it.",
  },
];

const VOICE_PACK_EMOTIONS = ["neutral", "happy", "sad", "angry", "yelling", "scared", "quiet / whisper", "surprised"];
function normalizeCharacterOwnerSegment(value: unknown, fallback = "web_characters_builder"): string {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const safe = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 80);
  return safe || fallback;
}

function readCharacterOwnerCandidate(value: unknown): string {
  if (!value) return "";

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";

    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return readCharacterOwnerCandidate(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }

    return trimmed;
  }

  if (typeof value !== "object" || Array.isArray(value)) return "";

  const record = value as Record<string, unknown>;

  const directKeys = [
    "ownerKey",
    "ownerId",
    "deviceId",
    "userId",
    "username",
    "userName",
    "profileId",
    "profileName",
    "name",
    "id",
  ];

  for (const key of directKeys) {
    const candidate = readCharacterOwnerCandidate(record[key]);
    if (candidate) return candidate;
  }

  const nestedKeys = ["user", "profile", "account", "session", "currentUser", "activeUser", "activeProfile"];
  for (const key of nestedKeys) {
    const candidate = readCharacterOwnerCandidate(record[key]);
    if (candidate) return candidate;
  }

  return "";
}

function readCharacterOwnerKey(): string {
  const fallback = "profile_unresolved";

  if (typeof window === "undefined") {
    return fallback;
  }

  const storageKeys = [
    "otg:test-last-user:v1",
    "otg:last-user:v1",
    "otg:current-user:v1",
    "otg:active-user:v1",
    "otg:profile:v1",
    "otg:active-profile:v1",
    "otg:appState_v1",
    "otg:test:page-state:v1",
  ];

  for (const key of storageKeys) {
    try {
      const raw = window.localStorage.getItem(key);
      const candidate = readCharacterOwnerCandidate(raw);
      if (candidate) {
        const normalized = normalizeCharacterOwnerSegment(candidate, fallback);
        if (normalized && normalized !== "web_characters_builder") return normalized;
      }
    } catch {
      // Ignore broken localStorage entries.
    }
  }

  return fallback;
}

const CHARACTER_DEVICE_ID = readCharacterOwnerKey();
const CHARACTER_BUILDER_DRAFT_KEY = `${CHARACTER_DEVICE_ID}:character_builder_draft:v${CHARACTER_BUILDER_DRAFT_VERSION}`;
// OTG_PROFILE_ISOLATION_PURGE_FOREIGN_LOCAL_CHARACTER_CACHE
// Prevent restored local caches from carrying another profile's voice/image/character data.
if (typeof window !== "undefined") {
  purgeForeignCharacterBuilderLocalCaches(CHARACTER_DEVICE_ID);
  purgeCurrentCharacterBuilderLocalCacheIfForeign(CHARACTER_DEVICE_ID);
}
function characterBuilderCacheText(value: unknown): string {
  try {
    return JSON.stringify(value || "");
  } catch {
    return String(value || "");
  }
}

function characterBuilderCacheHasForeignOwnerText(text: string, activeOwnerKey: string): boolean {
  const active = normalizeCharacterOwnerSegment(activeOwnerKey, "");
  if (!active) return false;

  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    decoded = text;
  }

  if (active !== "web_characters_builder" && (text.includes("web_characters_builder") || decoded.includes("web_characters_builder"))) {
    return true;
  }

  if (active !== "web_characters_builder" && (text.includes("owner=web_characters_builder") || decoded.includes("owner=web_characters_builder"))) {
    return true;
  }

  return false;
}

function purgeForeignCharacterBuilderLocalCaches(activeOwnerKey: string): string[] {
  if (typeof window === "undefined") return [];

  const removed: string[] = [];
  const active = normalizeCharacterOwnerSegment(activeOwnerKey, "");

  if (!active || active === "web_characters_builder") {
    return removed;
  }

  for (let i = window.localStorage.length - 1; i >= 0; i--) {
    const key = window.localStorage.key(i) || "";

    if (
      !key.includes("character_builder_draft") &&
      !key.startsWith("web_characters_builder:")
    ) {
      continue;
    }

    const value = window.localStorage.getItem(key) || "";
    const keyIsLegacyGlobal = key.startsWith("web_characters_builder:");
    const valueHasForeignOwner = characterBuilderCacheHasForeignOwnerText(value, active);

    if (keyIsLegacyGlobal || valueHasForeignOwner) {
      window.localStorage.removeItem(key);
      removed.push(key);
    }
  }

  return removed;
}

function purgeCurrentCharacterBuilderLocalCacheIfForeign(activeOwnerKey: string): boolean {
  if (typeof window === "undefined") return false;

  const active = normalizeCharacterOwnerSegment(activeOwnerKey, "");
  if (!active || active === "web_characters_builder") return false;

  const value = window.localStorage.getItem(CHARACTER_BUILDER_DRAFT_KEY) || "";
  if (!value) return false;

  if (!characterBuilderCacheHasForeignOwnerText(value, active)) {
    return false;
  }

  window.localStorage.removeItem(CHARACTER_BUILDER_DRAFT_KEY);
  return true;
}
function characterBuilderDraftHasForeignOwner(value: unknown, activeOwnerKey: string): boolean {
  const active = normalizeCharacterOwnerSegment(activeOwnerKey, "");
  if (!active) return false;

  let text = "";

  try {
    text = JSON.stringify(value || "");
  } catch {
    text = String(value || "");
  }

  if (!text) return false;

  // Hard block the old global builder owner from restoring into any real profile.
  if (active !== "web_characters_builder" && text.includes("web_characters_builder")) {
    return true;
  }

  const decoded = (() => {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  })();

  if (active !== "web_characters_builder" && decoded.includes("owner=web_characters_builder")) {
    return true;
  }

  return false;
}
const CHARACTER_JSON_HEADERS = {
  "Content-Type": "application/json",
  "x-otg-device-id": CHARACTER_DEVICE_ID,
};
const CHARACTER_FETCH_OPTIONS = {
  credentials: "omit" as const,
  headers: { "x-otg-device-id": CHARACTER_DEVICE_ID },
};
const CHARACTER_IMAGE_NEGATIVE_PROMPT = [
  "cropped head",
  "cropped feet",
  "cut off body",
  "out of frame",
  "close-up only",
  "portrait bust",
  "half body",
  "waist up",
  "missing legs",
  "missing feet",
  "extra limbs",
  "deformed hands",
  "blurry",
  "low quality",
].join(", ");

const DEFAULT_DETAILS: CharacterDetails = {
  name: "",
  age: "",
  species: "",
  gender: "",
  height: "average",
  build: "average",
  hairFurColor: "",
  eyeColor: "",
  surfaceDescription: "",
  hasAccent: false,
  accentType: "",
  clothingAccessories: "",
};

const DEFAULT_VOICE: VoiceSettings = {
  voiceAge: "teen",
  genderExpression: "male",
  pitch: "medium",
  resonance: "thin",
  energy: "medium",
  texture: "slightly rough",
  personalityTone: ["mischievous"],
  hasAccent: false,
  accentType: "",
  speciesFlavor: "subtle",
  speciesTrait: "rat-like",
};

const DEFAULT_VOICE_FX: VoiceFxSettings = {
  preset: "clean_dialogue",
  pitchSemitones: 0,
  speed: 1,
  gainDb: 0,
  highpassHz: 60,
  lowpassHz: 12000,
  echo: "off",
  normalize: true,
};

const VOICE_FX_PRESETS: Record<VoiceFxSettings["preset"], VoiceFxSettings> = {
  clean_dialogue: {
    preset: "clean_dialogue",
    pitchSemitones: 0,
    speed: 1,
    gainDb: 0,
    highpassHz: 60,
    lowpassHz: 12000,
    echo: "off",
    normalize: true,
  },
  monstrous: {
    preset: "monstrous",
    pitchSemitones: -5,
    speed: 0.92,
    gainDb: 0,
    highpassHz: 45,
    lowpassHz: 7000,
    echo: "room",
    normalize: true,
    bodyMode: "huge",
    gritAmount: 45,
    compression: "medium",
    layerMode: "monster_double",
    layerMix: 35,
  },
  angelic: {
    preset: "angelic",
    pitchSemitones: 3,
    speed: 1.02,
    gainDb: 0,
    highpassHz: 90,
    lowpassHz: 14000,
    echo: "room",
    normalize: true,
    tonePreset: "bright",
    layerMode: "octave_up",
    layerMix: 18,
  },
  stutter: {
    preset: "stutter",
    pitchSemitones: 0,
    speed: 0.96,
    gainDb: 0,
    highpassHz: 70,
    lowpassHz: 10000,
    echo: "off",
    normalize: true,
  },
  echo: {
    preset: "echo",
    pitchSemitones: 0,
    speed: 1,
    gainDb: 0,
    highpassHz: 60,
    lowpassHz: 12000,
    echo: "cave",
    normalize: true,
  },
  electric: {
    preset: "electric",
    pitchSemitones: 1,
    speed: 1,
    gainDb: 0,
    highpassHz: 90,
    lowpassHz: 9000,
    echo: "subtle",
    normalize: true,
    tonePreset: "bright",
    layerMode: "robot_double",
    layerMix: 30,
  },
  stone_person: {
    preset: "stone_person",
    pitchSemitones: -4,
    speed: 0.9,
    gainDb: 0,
    highpassHz: 40,
    lowpassHz: 6500,
    echo: "room",
    normalize: true,
    bodyMode: "huge",
    gritAmount: 30,
  },
  zombie: {
    preset: "zombie",
    pitchSemitones: -3,
    speed: 0.86,
    gainDb: -1,
    highpassHz: 55,
    lowpassHz: 5200,
    echo: "subtle",
    normalize: true,
    gritAmount: 55,
    compression: "strong",
  },
  ghost: {
    preset: "ghost",
    pitchSemitones: -1,
    speed: 0.94,
    gainDb: -1,
    highpassHz: 120,
    lowpassHz: 6500,
    echo: "cave",
    normalize: true,
    layerMode: "ghost_double",
    layerMix: 35,
  },
  radio: {
    preset: "radio",
    pitchSemitones: 0,
    speed: 1,
    gainDb: -1,
    highpassHz: 300,
    lowpassHz: 3400,
    echo: "off",
    normalize: true,
    tonePreset: "radio",
    compression: "strong",
  },
  robotic: {
    preset: "robotic",
    pitchSemitones: 0,
    speed: 1,
    gainDb: 0,
    highpassHz: 90,
    lowpassHz: 9000,
    echo: "subtle",
    normalize: true,
    layerMode: "robot_double",
    layerMix: 45,
  },
  distant_voice: {
    preset: "distant_voice",
    pitchSemitones: 0,
    speed: 1,
    gainDb: -5,
    highpassHz: 180,
    lowpassHz: 6000,
    echo: "cave",
    normalize: true,
  },
  whisper: {
    preset: "whisper",
    pitchSemitones: 1,
    speed: 0.98,
    gainDb: -4,
    highpassHz: 150,
    lowpassHz: 9000,
    echo: "subtle",
    normalize: true,
    tonePreset: "bright",
  },
  custom: {
    preset: "custom",
    pitchSemitones: 0,
    speed: 1,
    gainDb: 0,
    highpassHz: 60,
    lowpassHz: 12000,
    echo: "off",
    normalize: true,
  },
};

type QueuedJobUiState = {
  phase: "idle" | "submitting" | "queued" | "polling" | "error";
  job?: QueuedContractJob;
  error?: string;
};

type VoiceLabPage = "design" | "fx" | "training" | "preview";

const VOICE_LAB_PAGES: Array<{ id: VoiceLabPage; label: string; detail: string }> = [
  { id: "design", label: "Voice Design", detail: "Provider, identity, and base sample" },
  { id: "fx", label: "Voice FX", detail: "Tune or stylize the locked base voice" },
  { id: "training", label: "Training", detail: "Prepare data and train the voice model" },
  { id: "preview", label: "Test + Preview", detail: "Playback and preview video" },
];
const VOICE_LAB_PAGE_ORDER = VOICE_LAB_PAGES.map((item) => item.id);

function voiceLabPageIndexFor(value: string) {
  const found = VOICE_LAB_PAGE_ORDER.findIndex((item) => item === value);
  return found >= 0 ? found : 0;
}

function clampLockedVoiceLabPageIndex(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return -1;
  return Math.max(-1, Math.min(VOICE_LAB_PAGE_ORDER.length - 2, Math.floor(value)));
}

const VOICE_FX_PRESET_LABELS: Record<VoiceFxPreset, string> = {
  clean_dialogue: "Clean Dialogue",
  monstrous: "Monstrous",
  angelic: "Angelic",
  stutter: "Stutter",
  echo: "Echo",
  electric: "Electric",
  stone_person: "Stone Person",
  zombie: "Zombie",
  ghost: "Ghost",
  radio: "Radio",
  robotic: "Robotic",
  distant_voice: "Distant Voice",
  whisper: "Whisper",
  custom: "Custom",
};


function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

function prettyVoiceLabel(value: string) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function voiceFileUrlFor(pathValue?: string | null) {
  if (!pathValue) return "";
  const normalized = String(pathValue).replace(/\\/g, "/");
  const marker = "/data/";
  const markerIndex = normalized.indexOf(marker);
  const relativePath = markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : normalized.replace(/^\/+/, "");
  return `/api/characters/voice-file?path=${encodeURIComponent(relativePath)}&v=${Date.now()}`;
}

function isVoiceSampleFileUrl(value?: string | null) {
  return String(value || "").includes("/api/characters/voice-sample/file");
}

function fileUrlFor(pathValue?: string | null) {
  const value = String(pathValue || "").trim();
  if (!value) return "";
  if (/^(https?:|blob:|data:)/i.test(value)) return value;
  return `/api/file?path=${encodeURIComponent(value)}`;
}

function safeId(value: string) {
  return String(value || "character")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "character";
}

function buildInternalPrompt(userPrompt: string, preset: string) {
  const style = preset ? `${preset.toLowerCase()} style` : "cinematic style";
  return `Full-body portrait of ${userPrompt.trim()}, head to feet visible, full costume visible, standing pose, centered character, no cropped head, no cropped feet, portrait 720x1280, ${style}.`;
}

function workflowForCharacterStyle(preset: string) {
  return String(preset).toLowerCase() === "anime" ? "presets/Create Anime Images" : "presets/Create a Picture";
}

function workflowForUploadedFullBodyCompletion() {
  return "presets/Edit Image";
}

function workflowForCharacterCard() {
  return "presets/character_card_8_angles_low_angle";
}

function randomSeed() {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return String(values[0] || Date.now());
  }
  return String(Date.now() + Math.floor(Math.random() * 1_000_000));
}

function encodeSvg(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function makePortraitPlaceholder(title: string, subtitle: string, accent: string) {
  const safeTitle = title.replace(/[<&>]/g, "");
  const safeSubtitle = subtitle.replace(/[<&>]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
  <rect width="720" height="1280" fill="#101820"/>
  <rect x="70" y="70" width="580" height="1140" rx="36" fill="#f8f4e8"/>
  <circle cx="360" cy="250" r="94" fill="${accent}"/>
  <rect x="292" y="342" width="136" height="326" rx="62" fill="${accent}"/>
  <rect x="214" y="500" width="292" height="340" rx="48" fill="#263640"/>
  <line x1="292" y1="840" x2="252" y2="1096" stroke="${accent}" stroke-width="54" stroke-linecap="round"/>
  <line x1="428" y1="840" x2="468" y2="1096" stroke="${accent}" stroke-width="54" stroke-linecap="round"/>
  <line x1="220" y1="544" x2="132" y2="720" stroke="${accent}" stroke-width="46" stroke-linecap="round"/>
  <line x1="500" y1="544" x2="588" y2="720" stroke="${accent}" stroke-width="46" stroke-linecap="round"/>
  <text x="360" y="118" text-anchor="middle" font-family="Arial" font-size="30" fill="#263640">${safeTitle}</text>
  <text x="360" y="1162" text-anchor="middle" font-family="Arial" font-size="24" fill="#263640">${safeSubtitle}</text>
</svg>`;
  return encodeSvg(svg);
}

function makeCardPlaceholder(title: string, sourceLabel: string) {
  const labels = ["FACE", "FRONT", "BACK", "LEFT", "RIGHT"];
  const cells = labels
    .map((label, index) => {
      const x = 48 + (index % 3) * 650;
      const y = index < 3 ? 170 : 1060;
      return `<g>
  <rect x="${x}" y="${y}" width="575" height="780" rx="20" fill="#f7f3e8" stroke="#263640" stroke-width="5"/>
  <circle cx="${x + 288}" cy="${y + 170}" r="76" fill="#b1764b"/>
  <rect x="${x + 228}" y="${y + 270}" width="120" height="250" rx="55" fill="#b1764b"/>
  <rect x="${x + 166}" y="${y + 408}" width="244" height="180" rx="42" fill="#263640"/>
  <text x="${x + 288}" y="${y + 720}" text-anchor="middle" font-family="Arial" font-size="42" font-weight="700" fill="#263640">${label}</text>
</g>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 2048 2048">
  <rect width="2048" height="2048" fill="#ffffff"/>
  <text x="1024" y="88" text-anchor="middle" font-family="Arial" font-size="54" font-weight="700" fill="#101820">${title.replace(/[<&>]/g, "")}</text>
  <text x="1024" y="132" text-anchor="middle" font-family="Arial" font-size="26" fill="#5c6670">Character card generated from ${sourceLabel.replace(/[<&>]/g, "")}</text>
  ${cells}
</svg>`;
  return encodeSvg(svg);
}

async function uploadBlob(blob: Blob, filename: string) {
  const file = new File([blob], filename.replace(/\.[a-z0-9]+$/i, ".png"), { type: "image/png" });
  const form = new FormData();
  form.append("image", file);
  const upload = await fetch("/api/characters/upload", {
    method: "POST",
    headers: { "x-otg-device-id": CHARACTER_DEVICE_ID },
    credentials: "omit",
    body: form,
  });
  const json = await upload.json().catch(() => null);
  if (!upload.ok || !json?.ok) throw new Error(json?.error || "Character image upload failed.");
  return { serverPath: String(json.serverPath || ""), fileUrl: String(json.fileUrl || "") };
}

async function uploadDataUrl(dataUrl: string, filename: string) {
  let blob: Blob;
  if (dataUrl.startsWith("data:image/svg+xml")) {
    blob = await svgDataUrlToPngBlob(dataUrl);
  } else {
    const response = await fetch(dataUrl);
    blob = await response.blob();
  }
  return uploadBlob(blob, filename);
}

async function submitCharacterImageJob(internalPrompt: string, stylePreset: string) {
  const workflowId = workflowForCharacterStyle(stylePreset);
  const body = new FormData();
  body.set("workflowId", workflowId);
  body.set("workflowLabel", `Characters Create ${stylePreset}`);
  body.set("title", "Character Builder Image");
  body.set("requestKind", "character-builder-image");
  body.set("sourceType", "characters-tab-builder");
  body.set("prompt", internalPrompt);
  body.set("positivePrompt", internalPrompt);
  body.set("negativePrompt", CHARACTER_IMAGE_NEGATIVE_PROMPT);
  body.set("orientation", "portrait");
  body.set("width", "720");
  body.set("height", "1280");
  body.set("seed", randomSeed());
  if (workflowId === "presets/Create Anime Images") {
    body.set("requestKind", "anime-image");
  }

  const response = await fetch("/api/comfy", {
    method: "POST",
    body,
    ...CHARACTER_FETCH_OPTIONS,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) {
    throw new Error(json?.error || `Character image generation submit failed (${response.status}).`);
  }
  const promptId = String(json.prompt_id || json.promptId || "").trim();
  if (!promptId) {
    throw new Error("Character image generation did not return a ComfyUI prompt id.");
  }
  return { promptId, workflowId };
}

async function submitUploadedFullBodyCompletionJob(instruction: string, sourceServerPath: string) {
  const body = new FormData();
  body.set("workflowId", workflowForUploadedFullBodyCompletion());
  body.set("workflowLabel", "Characters Full Body Completion");
  body.set("prompt", instruction);
  body.set("positivePrompt", instruction);
  body.set("negativePrompt", "cropped body, cropped feet, cropped head, changed face, changed identity, changed visible clothing, different character, extra limbs, bad anatomy, blurry, low quality, watermark, text");
  body.set("orientation", "portrait");
  body.set("width", "720");
  body.set("height", "1280");
  body.set("seed", randomSeed());
  body.set("requestKind", "characters-upload-fullbody-completion");
  body.set("imageAPath", sourceServerPath);

  const response = await fetch("/api/comfy", {
    method: "POST",
    body,
    ...CHARACTER_FETCH_OPTIONS,
  });

  const json = await response.json().catch(() => null);
  if (!response.ok || !json) {
    throw new Error(json?.error || "Full-body completion submit failed (" + response.status + ").");
  }

  const promptId = String(json.prompt_id || json.promptId || "").trim();
  if (!promptId) {
    throw new Error("Full-body completion did not return a ComfyUI prompt id.");
  }

  return { promptId };
}

async function submitCharacterCardJob(instruction: string, sourceServerPath: string) {
  const body = new FormData();
  body.set("workflowId", workflowForCharacterCard());
  body.set("workflowLabel", "Characters 8-Angle Character Card");
  body.set("orientation", "portrait");
  body.set("width", "720");
  body.set("height", "1280");
  body.set("seed", randomSeed());
  body.set("requestKind", "characters-8-angle-card");
  body.set("sourceType", "characters-8-angle-card");
  body.set("imageAPath", sourceServerPath);

  const response = await fetch("/api/comfy", {
    method: "POST",
    body,
    ...CHARACTER_FETCH_OPTIONS,
  });

  const json = await response.json().catch(() => null);
  if (!response.ok || !json) {
    throw new Error(json?.error || "Character card submit failed (" + response.status + ").");
  }

  const promptId = String(json.prompt_id || json.promptId || "").trim();
  if (!promptId) {
    throw new Error("Character card workflow did not return a ComfyUI prompt id.");
  }

  return { promptId };
}

async function waitForCharacterImage(promptId: string) {
  const started = Date.now();
  const maxMs = 8 * 60 * 1000;
  let lastStatus = "queued";
  let completedFileName = "";

  while (Date.now() - started < maxMs) {
    const progress = await fetch(`/api/progress?promptId=${encodeURIComponent(promptId)}`, {
      cache: "no-store",
      ...CHARACTER_FETCH_OPTIONS,
    });
    const progressJson = await progress.json().catch(() => null);
    if (!progress.ok || !progressJson?.ok) {
      throw new Error(progressJson?.error || `Character image progress check failed (${progress.status}).`);
    }

    lastStatus = String(progressJson.status || lastStatus);

    const progressFileName = String(progressJson.fileName || progressJson.filename || "").trim();
    if (progressFileName) {
      completedFileName = progressFileName;
    }

    if (progressJson.prompt_error) {
      throw new Error(String(progressJson.prompt_error));
    }
    if (progressJson.prompt_complete || progressJson.status === "complete") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  if (lastStatus !== "complete") {
    throw new Error(`Timed out waiting for character image generation. Last status: ${lastStatus}.`);
  }

  if (completedFileName) {
    const gallery = await fetch("/api/gallery?media=image&sort=newest&per=120", {
      cache: "no-store",
      ...CHARACTER_FETCH_OPTIONS,
    });
    const galleryJson = await gallery.json().catch(() => null);

    if (gallery.ok && galleryJson?.ok) {
      const items = Array.isArray(galleryJson.items)
        ? galleryJson.items
        : Array.isArray(galleryJson.files)
          ? galleryJson.files
          : [];

      const exact = items.find((item: any) => {
        const names = [
          item?.sourceName,
          item?.fileName,
          item?.filename,
          item?.name,
        ].map((value) => String(value || "").trim());

        return names.includes(completedFileName);
      });

      const exactUrl = String(exact?.url || "").trim();
      if (exactUrl) {
        return { url: exactUrl, sourceName: completedFileName };
      }
    }

    return {
      url: `/api/preview/file?name=${encodeURIComponent(completedFileName)}`,
      sourceName: completedFileName,
    };
  }

  const latest = await fetch("/api/content/last", {
    cache: "no-store",
    ...CHARACTER_FETCH_OPTIONS,
  });
  const latestJson = await latest.json().catch(() => null);
  if (!latest.ok || !latestJson?.ok) {
    throw new Error(latestJson?.error || `Could not load generated character image (${latest.status}).`);
  }
  const url = String(latestJson?.file?.url || "").trim();
  const sourceName = String(latestJson?.file?.sourceName || latestJson?.file?.name || "").trim();
  if (!url) {
    throw new Error("Generation completed, but no generated image URL was returned.");
  }
  return { url, sourceName };
}
async function getImageNaturalSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
    image.onerror = () => reject(new Error("Could not inspect generated image dimensions."));
    image.src = url;
  });
}

async function waitForCharacterCardImage(promptId: string) {
  await waitForCharacterImage(promptId);

  const gallery = await fetch("/api/gallery?media=image&sort=newest&per=80", {
    cache: "no-store",
    ...CHARACTER_FETCH_OPTIONS,
  });

  const galleryJson = await gallery.json().catch(() => null);
  if (!gallery.ok || !galleryJson?.ok) {
    throw new Error(galleryJson?.error || "Could not inspect gallery outputs for character card.");
  }

  const items = Array.isArray(galleryJson.items) ? galleryJson.items : Array.isArray(galleryJson.files) ? galleryJson.files : [];
  const imageItems = items
    .filter((item: any) => String(item?.url || "").trim())
    .slice(0, 60);

  const namedCard = imageItems.find((item: any) => {
    const name = String(item?.sourceName || item?.fileName || item?.name || "").toLowerCase();
    return name.includes("character card") || name.includes("charactercard");
  });

  if (namedCard) {
    return {
      url: String(namedCard.url || "").trim(),
      sourceName: String(namedCard.sourceName || namedCard.fileName || namedCard.name || "").trim(),
    };
  }

  let bestByArea: { url: string; sourceName: string; area: number } | null = null;
  let fallback: { url: string; sourceName: string } | null = null;

  for (const item of imageItems) {
    const url = String(item.url || "").trim();
    const sourceName = String(item.sourceName || item.fileName || item.name || "").trim();
    if (!fallback) fallback = { url, sourceName };

    try {
      const size = await getImageNaturalSize(url);
      const area = Math.max(0, size.width) * Math.max(0, size.height);
      if (!bestByArea || area > bestByArea.area) {
        bestByArea = { url, sourceName, area };
      }
    } catch {
      // keep scanning
    }
  }

  if (bestByArea) {
    return { url: bestByArea.url, sourceName: bestByArea.sourceName };
  }

  if (fallback) return fallback;

  throw new Error("Character card workflow completed, but no gallery image output was found.");
}

async function copyGeneratedImageToCharacterUpload(imageUrl: string, filename: string) {
  const imageResponse = await fetch(imageUrl, {
    cache: "no-store",
    ...CHARACTER_FETCH_OPTIONS,
  });
  if (!imageResponse.ok) {
    throw new Error(`Could not fetch generated character image (${imageResponse.status}).`);
  }
  const blob = await imageResponse.blob();
  return uploadBlob(blob, filename);
}

function svgDataUrlToPngBlob(dataUrl: string) {
  return new Promise<Blob>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || 720;
      canvas.height = image.naturalHeight || 1280;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas is unavailable for character placeholder export."));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode character placeholder PNG."));
      }, "image/png");
    };
    image.onerror = () => reject(new Error("Could not render character placeholder."));
    image.src = dataUrl;
  });
}

function cleanVisionDescriptor(value: string) {
  const blocked = new Set([
    "none",
    "no",
    "n/a",
    "na",
    "null",
    "undefined",
    "unknown",
    "not",
    "applicable",
    "not applicable",
    "nothing",
    "empty",
  ]);

  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !blocked.has(item.toLowerCase()))
    .join(", ")
    .replace(/\bwith,\s*/gi, "with ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ",")
    .replace(/^,\s*|,\s*$/g, "")
    .trim();

  return cleaned;
}

function buildIdentityBlock(details: CharacterDetails, voice: VoiceSettings) {
  const name = details.name.trim() || "This character";
  const accent = details.hasAccent && details.accentType.trim() ? ` They have a ${details.accentType.trim()} accent.` : "";
  const clothing = details.clothingAccessories.trim() ? ` They wear ${details.clothingAccessories.trim()}.` : "";
  const surface = details.surfaceDescription.trim() ? ` ${details.surfaceDescription.trim()}.` : "";
  const voiceLine = ` Their voice is ${voice.voiceAge} ${voice.genderExpression}, ${voice.pitch} pitch, ${voice.resonance} resonance, ${voice.energy} energy, ${voice.texture} texture, and ${voice.personalityTone.join(" / ")}.`;
  return `${name} is a ${details.age.trim() || "unspecified-age"} ${details.gender.trim() || "unspecified-gender"} ${details.species.trim() || "character"}. They are ${details.height} and ${details.build}.${surface} They have ${details.hairFurColor.trim() || "unspecified hair/fur color"} and ${details.eyeColor.trim() || "unspecified eye color"}.${clothing}${accent}${voiceLine}`;
}


function characterHasCustomVoice(character: CharacterRecord) {
  const profile = character.characterVoiceProfile as any;
  return Boolean(
    character.hasCustomVoice ||
      character.voiceStatus === "ready" ||
      profile?.voiceModelArtifactId ||
      profile?.voiceModelArtifacts?.length ||
      profile?.trainedModelPath ||
      profile?.trainedIndexPath ||
      profile?.approvedSampleUrl ||
      profile?.approvedSamplePath ||
      profile?.tunedSampleUrl ||
      profile?.tunedSamplePath ||
      profile?.baseSampleUrl ||
      profile?.baseSamplePath
  );
}
export default function CharactersPanel() {
  return <CharacterBuilder />;
}

function CharacterBuilder() {
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [step, setStep] = useState<BuilderStep>("source");
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [stylePreset, setStylePreset] = useState<(typeof STYLE_PRESETS)[number]>("Anime");
  const [candidates, setCandidates] = useState<CandidateImage[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [uploadedImage, setUploadedImage] = useState<CandidateImage | null>(null);
  const [imageCompleteness, setImageCompleteness] = useState<ImageCompleteness>("full_body");
  const [missingGuidance, setMissingGuidance] = useState("");
  const [selectedFullBody, setSelectedFullBody] = useState<CandidateImage | null>(null);
  const [characterCard, setCharacterCard] = useState<CandidateImage | null>(null);
  const [details, setDetails] = useState<CharacterDetails>(DEFAULT_DETAILS);
  const [voice, setVoice] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [voiceProvider, setVoiceProvider] = useState<VoiceGeneratorProvider>("qwen3");
  const [voiceDesignProfile, setVoiceDesignProfile] = useState<VoiceDesignProfile>(() => defaultVoiceDesignProfile());
  const [qwenVoiceDesign, setQwenVoiceDesign] = useState<QwenVoiceDesignInput>(() => defaultQwenVoiceDesignInput());
  const [qwenVoiceCandidates, setQwenVoiceCandidates] = useState<QwenVoiceCandidateInstruction[]>([]);
  const [selectedQwenVoiceCandidateId, setSelectedQwenVoiceCandidateId] = useState("");
  const [qwenVoiceDesignRecord, setQwenVoiceDesignRecord] = useState<any | null>(null);
  const [qwenVoiceInstructionAdvancedEdit, setQwenVoiceInstructionAdvancedEdit] = useState(false);
  const [voicePromptSnapshot, setVoicePromptSnapshot] = useState<any | null>(null);
  const [voicePackCreated, setVoicePackCreated] = useState(false);
  const [voicePackRecord, setVoicePackRecord] = useState<any | null>(null);
  const [voicePreview, setVoicePreview] = useState<any | null>(null);
  const [voiceFx, setVoiceFx] = useState<VoiceFxSettings>(DEFAULT_VOICE_FX);
  const [simpleVoiceFx, setSimpleVoiceFx] = useState<SimpleVoiceFxSettings>(DEFAULT_SIMPLE_VOICE_FX);
  const [voiceFxPreview, setVoiceFxPreview] = useState<any | null>(null);
  const [voiceFxAdvancedOpen, setVoiceFxAdvancedOpen] = useState(false);
  const [voiceFxPresetCategory, setVoiceFxPresetCategory] = useState<string>("Monsters");
  const [voiceFxPresetId, setVoiceFxPresetId] = useState<string>("dragon");
  const [voiceFxChainOpen, setVoiceFxChainOpen] = useState(false);
  const [voiceFxStatus, setVoiceFxStatus] = useState<"Ready" | "Previewing..." | "Applied" | "Error">("Ready");
  const [voiceLabPage, setVoiceLabPage] = useState<VoiceLabPage>("design");
  const [lockedBuilderStepIndex, setLockedBuilderStepIndex] = useState(-1);
  const [lockedVoiceLabPageIndex, setLockedVoiceLabPageIndex] = useState(-1);
  const [selectedIndexVoiceReference, setSelectedIndexVoiceReference] = useState<any | null>(null);
  const [indexVoicePack, setIndexVoicePack] = useState<any | null>(null);
  const [voiceTestText, setVoiceTestText] = useState("This is a test line for the character voice.");
  const [voicePipelineJobs, setVoicePipelineJobs] = useState<Partial<Record<CharacterVoicePipelineAction, QueuedJobUiState>>>({});
  const [trainingDatasetPreviewOpen, setTrainingDatasetPreviewOpen] = useState(false);
  const [trainingDatasetPreviewIndex, setTrainingDatasetPreviewIndex] = useState(1);
  const [voiceUploadState, setVoiceUploadState] = useState<{ phase: "idle" | "uploading" | "ready" | "error"; fileName?: string; error?: string }>({ phase: "idle" });
  const [builderCharacterVoiceProfile, setBuilderCharacterVoiceProfile] = useState<CharacterVoiceProfile | null>(null);
  const [applioTrainingQualityPreset, setApplioTrainingQualityPreset] = useState<ApplioTrainingQualityPresetKey>(DEFAULT_APPLIO_TRAINING_QUALITY_PRESET);
  const persistedMockVoiceSampleJobIdsRef = useRef<Set<string>>(new Set());
  const persistedVoiceFxJobIdsRef = useRef<Set<string>>(new Set());
  const persistedApplioArtifactJobIdsRef = useRef<Set<string>>(new Set());
  const reconciledApplioArtifactCharacterIdsRef = useRef<Set<string>>(new Set());

  const [character3dModel, setCharacter3dModel] = useState<any | null>(null);
  const characterDraftHydratedRef = useRef(false);
  const [characterDraftHydrated, setCharacterDraftHydrated] = useState(false);
  const [characterDraftRestoreError, setCharacterDraftRestoreError] = useState("");
  const characterDraftSaveTimeoutRef = useRef<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadCharacters();
  }, []);

  const restoreCharacterBuilderDraftState = useCallback((saved: any) => {
      const restoredStep = saved.step || saved.activeBuilderPage || saved.lastBuilderStep;
      if (restoredStep) {
        setStep(restoredStep);
        setLockedBuilderStepIndex(
          "lockedBuilderStepIndex" in saved
            ? clampLockedBuilderStepIndex(saved.lockedBuilderStepIndex)
            : clampLockedBuilderStepIndex(builderStepIndexFor(restoredStep) - 1),
        );
      }
      if (STYLE_PRESETS.includes(saved.stylePreset)) setStylePreset(saved.stylePreset);
      if (typeof saved.generationPrompt === "string") setGenerationPrompt(saved.generationPrompt);
      if (Array.isArray(saved.candidates)) setCandidates(saved.candidates);
      if (typeof saved.selectedCandidateId === "string") setSelectedCandidateId(saved.selectedCandidateId);
      if ("uploadedImage" in saved) setUploadedImage(saved.uploadedImage || null);
      if (saved.imageCompleteness) setImageCompleteness(saved.imageCompleteness);
      if (typeof saved.missingGuidance === "string") setMissingGuidance(saved.missingGuidance);
      if ("selectedFullBody" in saved) setSelectedFullBody(saved.selectedFullBody || null);
      if ("characterCard" in saved) setCharacterCard(saved.characterCard || null);
      if (saved.details) setDetails({ ...DEFAULT_DETAILS, ...saved.details });
      if (saved.voice) setVoice({ ...DEFAULT_VOICE, ...saved.voice });
      if (saved.voiceProvider === "qwen3" || saved.voiceProvider === "cosy") setVoiceProvider(saved.voiceProvider);
      if (saved.voiceDesignProfile) setVoiceDesignProfile(defaultVoiceDesignProfile(saved.voiceDesignProfile));
      if (saved.qwenVoiceDesign) setQwenVoiceDesign(defaultQwenVoiceDesignInput(saved.qwenVoiceDesign));
      if (Array.isArray(saved.qwenVoiceCandidates)) setQwenVoiceCandidates(saved.qwenVoiceCandidates);
      if (typeof saved.selectedQwenVoiceCandidateId === "string") setSelectedQwenVoiceCandidateId(saved.selectedQwenVoiceCandidateId);
      if ("qwenVoiceDesignRecord" in saved) setQwenVoiceDesignRecord(saved.qwenVoiceDesignRecord || null);
      if ("voicePromptSnapshot" in saved) setVoicePromptSnapshot(saved.voicePromptSnapshot || null);
      if (typeof saved.voicePackCreated === "boolean") setVoicePackCreated(saved.voicePackCreated);
      if ("voicePackRecord" in saved) setVoicePackRecord(saved.voicePackRecord || null);
      if ("voicePreview" in saved) setVoicePreview(saved.voicePreview || null);
      if (saved.voiceFx) setVoiceFx({ ...DEFAULT_VOICE_FX, ...saved.voiceFx });
      if (saved.simpleVoiceFx) setSimpleVoiceFx({ ...DEFAULT_SIMPLE_VOICE_FX, ...saved.simpleVoiceFx });
      if ("voiceFxPreview" in saved) setVoiceFxPreview(saved.voiceFxPreview || null);
      if (typeof saved.voiceFxAdvancedOpen === "boolean") setVoiceFxAdvancedOpen(saved.voiceFxAdvancedOpen);
      if (typeof saved.voiceFxPresetCategory === "string") setVoiceFxPresetCategory(saved.voiceFxPresetCategory);
      if (typeof saved.voiceFxPresetId === "string") setVoiceFxPresetId(saved.voiceFxPresetId);
      if (typeof saved.voiceFxChainOpen === "boolean") setVoiceFxChainOpen(saved.voiceFxChainOpen);
      if (saved.voiceFxStatus === "Ready" || saved.voiceFxStatus === "Previewing..." || saved.voiceFxStatus === "Applied" || saved.voiceFxStatus === "Error") {
        setVoiceFxStatus(saved.voiceFxStatus);
      }
      const restoredVoiceLabPage = saved.voiceLabPage || saved.lastVoiceLabPage;
      if (restoredVoiceLabPage === "design" || restoredVoiceLabPage === "fx" || restoredVoiceLabPage === "training" || restoredVoiceLabPage === "preview") {
        setVoiceLabPage(restoredVoiceLabPage);
        setLockedVoiceLabPageIndex(
          "lockedVoiceLabPageIndex" in saved
            ? clampLockedVoiceLabPageIndex(saved.lockedVoiceLabPageIndex)
            : clampLockedVoiceLabPageIndex(voiceLabPageIndexFor(restoredVoiceLabPage) - 1),
        );
      }
      if (saved.voicePipelineJobs && typeof saved.voicePipelineJobs === "object" && !Array.isArray(saved.voicePipelineJobs)) {
        setVoicePipelineJobs(saved.voicePipelineJobs as Partial<Record<CharacterVoicePipelineAction, QueuedJobUiState>>);
        setMessage("Restored durable voice pipeline jobs from builder draft.");
      }
      if ("selectedIndexVoiceReference" in saved) setSelectedIndexVoiceReference(saved.selectedIndexVoiceReference || null);
      if ("indexVoicePack" in saved) setIndexVoicePack(saved.indexVoicePack || null);
      if (saved.applioTrainingQualityPreset === "fast" || saved.applioTrainingQualityPreset === "normal" || saved.applioTrainingQualityPreset === "quality") {
        setApplioTrainingQualityPreset(saved.applioTrainingQualityPreset);
      }
      if ("builderCharacterVoiceProfile" in saved) {
        setBuilderCharacterVoiceProfile(saved.builderCharacterVoiceProfile || null);
        if (saved.builderCharacterVoiceProfile?.sourceJobId) {
          persistedMockVoiceSampleJobIdsRef.current.add(String(saved.builderCharacterVoiceProfile.sourceJobId));
        }
        if (saved.builderCharacterVoiceProfile?.tunedSourceJobId) {
          persistedVoiceFxJobIdsRef.current.add(String(saved.builderCharacterVoiceProfile.tunedSourceJobId));
        }
        if (Array.isArray(saved.builderCharacterVoiceProfile?.voiceModelArtifacts)) {
          for (const artifact of saved.builderCharacterVoiceProfile.voiceModelArtifacts) {
            if (artifact?.sourceJobId) persistedApplioArtifactJobIdsRef.current.add(String(artifact.sourceJobId));
            if (artifact?.jobId) persistedApplioArtifactJobIdsRef.current.add(String(artifact.jobId));
          }
        }
      }


      if ("character3dModel" in saved) setCharacter3dModel(saved.character3dModel || null);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    const restore = async () => {
      try {
        const response = await fetch(`/api/characters/builder-draft?ownerId=${encodeURIComponent(CHARACTER_DEVICE_ID)}`, {
          cache: "no-store",
          credentials: "omit",
          headers: { "x-otg-device-id": CHARACTER_DEVICE_ID },
        });
        const json = await response.json().catch(() => null);
        const serverState = json?.draft?.state;
        if (!cancelled && response.ok && serverState && typeof serverState === "object") {
          restoreCharacterBuilderDraftState(serverState);
          window.localStorage.setItem(
            CHARACTER_BUILDER_DRAFT_KEY,
            JSON.stringify({
              version: CHARACTER_BUILDER_DRAFT_VERSION,
              savedAt: json?.draft?.updatedAt || new Date().toISOString(),
              state: serverState,
            }),
          );
          setMessage("Restored saved character creation progress.");
          return;
        }

        const raw = window.localStorage.getItem(CHARACTER_BUILDER_DRAFT_KEY);
        if (raw) {
          const draft = JSON.parse(raw);
          if (!cancelled && draft?.version === CHARACTER_BUILDER_DRAFT_VERSION && draft.state && !characterBuilderDraftHasForeignOwner(draft, CHARACTER_DEVICE_ID)) {
            restoreCharacterBuilderDraftState(draft.state);
            setMessage("Restored local character creation cache.");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setCharacterDraftRestoreError(error instanceof Error ? error.message : "Could not restore draft.");
        }
      } finally {
        if (!cancelled) {
          characterDraftHydratedRef.current = true;
          setCharacterDraftHydrated(true);
        }
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, [restoreCharacterBuilderDraftState]);

  const buildCharacterBuilderDraftState = useCallback((overrides: Record<string, unknown> = {}) => {
    const nextStep = typeof overrides.step === "string" ? overrides.step : step;
    const nextVoiceLabPage = typeof overrides.voiceLabPage === "string" ? overrides.voiceLabPage : voiceLabPage;
    const nextDetails = overrides.details && typeof overrides.details === "object" && !Array.isArray(overrides.details)
      ? { ...details, ...(overrides.details as Record<string, unknown>) }
      : details;
    const nextDetailsRecord = nextDetails as Record<string, unknown>;
    const nextCharacterId = safeId(String(nextDetailsRecord.name || details.name || ""));
    return {
      schemaVersion: 2,
      activeBuilderPage: nextStep,
      activeCharacterId: nextCharacterId,
      activeCharacterSlug: nextCharacterId,
      lastOpenedCharacterId: nextCharacterId,
      lastBuilderStep: nextStep,
      lastVoiceLabPage: nextVoiceLabPage,
      completedSteps: BUILDER_STEP_ORDER.slice(0, Math.max(0, lockedBuilderStepIndex + 1)),
      updatedAt: new Date().toISOString(),
      step: nextStep,
      lockedBuilderStepIndex,
      stylePreset,
      generationPrompt,
      candidates,
      selectedCandidateId,
      uploadedImage,
      imageCompleteness,
      missingGuidance,
      selectedFullBody,
      characterCard,
      details: nextDetails,
      voice,
      voiceProvider,
      voiceDesignProfile,
      qwenVoiceDesign,
      qwenVoiceCandidates,
      selectedQwenVoiceCandidateId,
      qwenVoiceDesignRecord,

      voicePromptSnapshot,
      voicePackCreated,
      voicePackRecord,
      voicePreview,
      voiceFx,
      simpleVoiceFx,
      voiceFxPreview,
      voiceFxAdvancedOpen,
      voiceFxPresetCategory,
      voiceFxPresetId,
      voiceFxChainOpen,
      voiceFxStatus,
      voiceLabPage: nextVoiceLabPage,
      lockedVoiceLabPageIndex,
      selectedIndexVoiceReference,
      indexVoicePack,
      voiceTestText,
      voicePipelineJobs,
      activeDatasetJobId: voicePipelineJobs.generate_training_dataset?.job?.jobId || "",
      activeDatasetManifestPath: String((voicePipelineJobs.generate_training_dataset?.job?.result as Record<string, unknown> | undefined)?.manifestPath || ""),
      activeDatasetManifestUrl: String((voicePipelineJobs.generate_training_dataset?.job?.result as Record<string, unknown> | undefined)?.manifestUrl || ""),
      datasetStatus: voicePipelineJobs.generate_training_dataset?.job?.status || "",
      datasetGeneratedClipCount: Number((voicePipelineJobs.generate_training_dataset?.job?.result as Record<string, unknown> | undefined)?.generatedClipCount || 0),
      datasetRequestedClipCount: Number((voicePipelineJobs.generate_training_dataset?.job?.result as Record<string, unknown> | undefined)?.requestedClipCount || 0),
      activeModelTrainingJobId: voicePipelineJobs.start_applio_training?.job?.jobId || "",
      modelTrainingStatus: voicePipelineJobs.start_applio_training?.job?.status || "",
      applioTrainingQualityPreset,
      builderCharacterVoiceProfile,
      character3dModel,
      ...overrides,
    };
  }, [
    step,
    lockedBuilderStepIndex,
    stylePreset,
    generationPrompt,
    candidates,
    selectedCandidateId,
    uploadedImage,
    imageCompleteness,
    missingGuidance,
    selectedFullBody,
    characterCard,
    details,
    voice,
    voiceProvider,
    voiceDesignProfile,
    qwenVoiceDesign,
    qwenVoiceCandidates,
    selectedQwenVoiceCandidateId,
    qwenVoiceDesignRecord,
    voicePromptSnapshot,
    voicePackCreated,
    voicePackRecord,
    voicePreview,
    voiceFx,
    simpleVoiceFx,
    voiceFxPreview,
    voiceFxAdvancedOpen,
    voiceFxPresetCategory,
    voiceFxPresetId,
    voiceFxChainOpen,
    voiceFxStatus,
    voiceLabPage,
    lockedVoiceLabPageIndex,
    selectedIndexVoiceReference,
    indexVoicePack,
    voiceTestText,
    voicePipelineJobs,
    applioTrainingQualityPreset,
    builderCharacterVoiceProfile,
    character3dModel,
  ]);

  const saveCharacterBuilderDraftNow = useCallback((overrides: Record<string, unknown> = {}) => {
    if (typeof window === "undefined") return;
    if (!characterDraftHydratedRef.current) return;
    const state = buildCharacterBuilderDraftState(overrides);
    const currentStage = String(state.step || step);
    const characterId = String(state.activeCharacterId || safeId(details.name));
    const draft = {
      version: CHARACTER_BUILDER_DRAFT_VERSION,
      savedAt: new Date().toISOString(),
      state,
    };
    try {
      window.localStorage.setItem(CHARACTER_BUILDER_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Local cache is best effort; server draft is authoritative.
    }
    void fetch(`/api/characters/builder-draft?ownerId=${encodeURIComponent(CHARACTER_DEVICE_ID)}`, {
      method: "PUT",
      headers: CHARACTER_JSON_HEADERS,
      credentials: "omit",
      body: JSON.stringify({
        mode: "new_character",
        characterId,
        currentStage,
        state,
      }),
    }).catch(() => {
      // Local cache remains available if the immediate server write fails.
    });
  }, [buildCharacterBuilderDraftState, details.name, step]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!characterDraftHydratedRef.current) return;

    const state = buildCharacterBuilderDraftState();
    const draft = {
      version: CHARACTER_BUILDER_DRAFT_VERSION,
      savedAt: new Date().toISOString(),
      state,
    };

    try {
      window.localStorage.setItem(CHARACTER_BUILDER_DRAFT_KEY, JSON.stringify(draft));
      if (characterDraftSaveTimeoutRef.current !== null) {
        window.clearTimeout(characterDraftSaveTimeoutRef.current);
      }
      characterDraftSaveTimeoutRef.current = window.setTimeout(() => {
        void fetch(`/api/characters/builder-draft?ownerId=${encodeURIComponent(CHARACTER_DEVICE_ID)}`, {
          method: "PUT",
          headers: CHARACTER_JSON_HEADERS,
          credentials: "omit",
          body: JSON.stringify({
            mode: "new_character",
            characterId: safeId(details.name),
            currentStage: step,
            state,
          }),
        }).catch(() => {
          // Local draft remains the primary fallback when the server draft write fails.
        });
      }, 750);
    } catch {
      // Ignore quota/private-mode failures.
    }

    return () => {
      if (characterDraftSaveTimeoutRef.current !== null) {
        window.clearTimeout(characterDraftSaveTimeoutRef.current);
      }
    };
  }, [
    step,
    lockedBuilderStepIndex,
    stylePreset,
    generationPrompt,
    candidates,
    selectedCandidateId,
    uploadedImage,
    imageCompleteness,
    missingGuidance,
    selectedFullBody,
    characterCard,
    details,
    voice,
    voiceProvider,
    voiceDesignProfile,
    qwenVoiceDesign,
    qwenVoiceCandidates,
    selectedQwenVoiceCandidateId,
    qwenVoiceDesignRecord,

    voicePromptSnapshot,
    voicePackCreated,
    voicePackRecord,
    voicePreview,
    voiceFx,
    simpleVoiceFx,
    voiceFxPreview,
    voiceFxAdvancedOpen,
    voiceFxPresetCategory,
    voiceFxPresetId,
    voiceFxChainOpen,
    voiceFxStatus,
    voiceLabPage,
    lockedVoiceLabPageIndex,
    selectedIndexVoiceReference,
    indexVoicePack,
    voiceTestText,
    voicePipelineJobs,
    applioTrainingQualityPreset,
    builderCharacterVoiceProfile,
    character3dModel,
    details.name,
    buildCharacterBuilderDraftState,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const flushDraft = () => saveCharacterBuilderDraftNow();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushDraft();
    };
    window.addEventListener("pagehide", flushDraft);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushDraft);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [saveCharacterBuilderDraftNow]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && characterDraftSaveTimeoutRef.current !== null) {
        window.clearTimeout(characterDraftSaveTimeoutRef.current);
      }
    };
  }, []);

  const selectedCandidate = useMemo(() => candidates.find((item) => item.id === selectedCandidateId) || null, [candidates, selectedCandidateId]);
  const identityBlock = useMemo(() => buildIdentityBlock(details, voice), [details, voice]);
  const selectedQwenVoiceCandidate = useMemo(
    () => qwenVoiceCandidates.find((candidate) => candidate.candidateId === selectedQwenVoiceCandidateId) || null,
    [qwenVoiceCandidates, selectedQwenVoiceCandidateId],
  );
  const latestCompletedVoiceFxJob =
    voicePipelineJobs.apply_voice_fx?.job?.status === "completed"
      ? voicePipelineJobs.apply_voice_fx.job
      : null;
  const latestCompletedVoiceFxResult =
    latestCompletedVoiceFxJob?.result &&
    typeof latestCompletedVoiceFxJob.result === "object" &&
    !Array.isArray(latestCompletedVoiceFxJob.result)
      ? latestCompletedVoiceFxJob.result as Record<string, unknown>
      : null;
  const latestVoiceFxSampleUrl =
    String(latestCompletedVoiceFxResult?.processedSampleUrl || latestCompletedVoiceFxResult?.fxSampleUrl || "").trim();
  const latestVoiceFxSamplePath =
    String(latestCompletedVoiceFxResult?.processedSamplePath || latestCompletedVoiceFxResult?.fxSamplePath || "").trim();

  const rawVoicePreviewPath = String(voicePreview?.audioPath || voicePreview?.outputPath || "").trim();
  const rawVoicePreviewUrl = voiceFileUrlFor(rawVoicePreviewPath) || String(voicePreview?.audioUrl || "").trim();
  const tunedVoicePreviewPath =
    String(voiceFxPreview?.audioPath || voiceFxPreview?.outputPath || latestVoiceFxSamplePath || "").trim();
  const tunedVoicePreviewUrl =
    latestVoiceFxSampleUrl || voiceFileUrlFor(tunedVoicePreviewPath) || String(voiceFxPreview?.audioUrl || "").trim();
  const approvedSampleUrl = String(builderCharacterVoiceProfile?.approvedSampleUrl || "").trim();
  const selectedApplioTrainingQuality = APPLIO_TRAINING_QUALITY_PRESETS[applioTrainingQualityPreset];
  const approvedSampleType =
    approvedSampleUrl && builderCharacterVoiceProfile?.tunedSampleUrl && approvedSampleUrl === builderCharacterVoiceProfile.tunedSampleUrl
      ? "tuned"
      : approvedSampleUrl && builderCharacterVoiceProfile?.baseSampleUrl && approvedSampleUrl === builderCharacterVoiceProfile.baseSampleUrl
        ? "base"
        : approvedSampleUrl
          ? "unknown"
          : "";
  const approvedSourceJobId =
    approvedSampleType === "tuned"
      ? builderCharacterVoiceProfile?.tunedSourceJobId || builderCharacterVoiceProfile?.sourceJobId || ""
      : approvedSampleType === "base"
        ? builderCharacterVoiceProfile?.sourceJobId || ""
        : builderCharacterVoiceProfile?.tunedSourceJobId || builderCharacterVoiceProfile?.sourceJobId || "";
  const lockedTrainingVoiceUrl = String(
    builderCharacterVoiceProfile?.approvedSampleUrl ||
      builderCharacterVoiceProfile?.tunedSampleUrl ||
      builderCharacterVoiceProfile?.baseSampleUrl ||
      "",
  ).trim();
  const lockedTrainingVoicePath = String(
    builderCharacterVoiceProfile?.approvedSamplePath ||
      builderCharacterVoiceProfile?.tunedSamplePath ||
      builderCharacterVoiceProfile?.baseSamplePath ||
      "",
  ).trim();
  const lockedTrainingVoiceType =
    builderCharacterVoiceProfile?.approvedSampleUrl
      ? approvedSampleType || "approved"
      : builderCharacterVoiceProfile?.tunedSampleUrl
        ? "tuned"
        : builderCharacterVoiceProfile?.baseSampleUrl
          ? "base"
          : "";
  const voiceDesignPayload = useMemo(() => buildVoiceRequestPayload(voiceDesignProfile), [voiceDesignProfile]);
  const voiceDesignAccent = statusForAccent(voiceDesignProfile);
  const voiceDesignAccentOptions = useMemo(() => accentOptionsForModel(voiceDesignProfile), [voiceDesignProfile]);
  const qwenVoiceInstruction = String(voiceDesignPayload.instruct || voiceDesignPayload.prompt || "").trim();
  const qwenSamplePhrase = voiceDesignProfile.sampleText?.trim() || QWEN_PREVIEW_LINES.neutral_standard;
  const qwenWarnings = voiceDesignWarnings(voiceDesignProfile);
  const approvedVoiceSourceInput = {
    approvedSampleUrl: lockedTrainingVoiceUrl,
    approvedSamplePath: lockedTrainingVoicePath,
    approvedSampleType: lockedTrainingVoiceType || "unknown",
    approvedSourceJobId,
    sourceProvider: builderCharacterVoiceProfile?.provider || voiceProvider,
    voiceInstruction: String(qwenVoiceDesignRecord?.voiceInstruction || voicePromptSnapshot?.instruct || voicePromptSnapshot?.prompt || qwenVoiceInstruction),
    voiceDesign: (voicePromptSnapshot?.payload || voiceDesignPayload).voiceDesign,
    modelConfig: voicePromptSnapshot?.payload || voiceDesignPayload,
    baseSamplePath: builderCharacterVoiceProfile?.baseSamplePath || "",
    baseSampleUrl: builderCharacterVoiceProfile?.baseSampleUrl || "",
    tunedSamplePath: builderCharacterVoiceProfile?.tunedSamplePath || "",
    tunedSampleUrl: builderCharacterVoiceProfile?.tunedSampleUrl || "",
    tunedFxPreset: builderCharacterVoiceProfile?.tunedFxPreset || "",
  };
  const indexTts2TrainingDatasetAvailable = true;
  const indexTts2TrainingDatasetBlockedMessage =
    "Training dataset generation is disabled because IndexTTS2 model weights are not installed/configured on this server.";
  const trainingDatasetResult =
    voicePipelineJobs.generate_training_dataset?.job?.result &&
    typeof voicePipelineJobs.generate_training_dataset.job.result === "object" &&
    !Array.isArray(voicePipelineJobs.generate_training_dataset.job.result)
      ? voicePipelineJobs.generate_training_dataset.job.result as Record<string, unknown>
      : null;
  const trainingDatasetClipCount = Number(trainingDatasetResult?.clipCount || 0);
  const trainingDatasetGeneratedClipCount = Number(trainingDatasetResult?.generatedClipCount || 0);
  const trainingVoicePackReady =
    Boolean(trainingDatasetResult) &&
    trainingDatasetGeneratedClipCount > 0 &&
    trainingDatasetGeneratedClipCount >= Math.max(1, trainingDatasetClipCount) &&
    voicePipelineJobs.generate_training_dataset?.job?.status === "completed";
  const trainingDatasetReadyForReview = voicePipelineJobs.generate_training_dataset?.job?.status === "ready_for_review";
  const trainingDatasetTerminated = voicePipelineJobs.generate_training_dataset?.job?.status === "terminated";
  const trainingDatasetRequestedCount = Math.max(1, trainingDatasetClipCount || 200);
  const currentTrainingDatasetPreviewIndex = Math.max(1, Math.min(trainingDatasetRequestedCount, trainingDatasetPreviewIndex));
  const trainingDatasetPreviewUrl =
    voicePipelineJobs.generate_training_dataset?.job?.ownerKey && voicePipelineJobs.generate_training_dataset?.job?.characterId && voicePipelineJobs.generate_training_dataset?.job?.jobId
      ? `/api/characters/training-dataset/file?owner=${encodeURIComponent(String(voicePipelineJobs.generate_training_dataset.job.ownerKey))}&characterId=${encodeURIComponent(String(voicePipelineJobs.generate_training_dataset.job.characterId))}&jobId=${encodeURIComponent(String(voicePipelineJobs.generate_training_dataset.job.jobId))}&index=${currentTrainingDatasetPreviewIndex}`
      : "";
  const applioManifestInput = trainingDatasetResult
    ? {
        manifestPath: String(trainingDatasetResult.manifestPath || ""),
        manifestUrl: String(trainingDatasetResult.manifestUrl || ""),
        sourceDatasetJobId: voicePipelineJobs.generate_training_dataset?.job?.jobId || "",
        clipCount: trainingDatasetClipCount,
        generatedClipCount: trainingDatasetGeneratedClipCount,
      }
    : {};
  useEffect(() => {
    if (!characterDraftHydratedRef.current || !characterDraftHydrated) return;
    if (step !== "voice" || voiceLabPage !== "training") return;

    const characterId = safeId(details.name);
    if (!characterId) return;

    let cancelled = false;

    const hydrateActiveTrainingDatasetJobFromServer = async () => {
      let job: any | null = null;

      try {
        const response = await fetch(
          `/api/characters/voice-pipeline/active-dataset?characterId=${encodeURIComponent(characterId)}`,
          {
            credentials: "include",
            cache: "no-store",
          },
        );
        const json = await response.json().catch(() => null);
        if (response.ok && json?.job) {
          job = json.job;
        }
      } catch {
        job = null;
      }

      if (cancelled || !job || job.action !== "generate_training_dataset") return;

      const result =
        job.result && typeof job.result === "object" && !Array.isArray(job.result)
          ? job.result as Record<string, unknown>
          : {};

      const requestedClipCount = Number(result.requestedClipCount || result.clipCount || 200);
      const generatedClipCount = Number(result.generatedClipCount || result.readyClipCount || 0);
      const progress =
        requestedClipCount > 0
          ? Math.max(0, Math.min(100, Math.round((generatedClipCount / requestedClipCount) * 100)))
          : Math.max(0, Math.min(100, Number(job.progress || 0)));

      setVoicePipelineJobs((prev) => {
        const current = prev.generate_training_dataset?.job;
        const currentResult =
          current?.result && typeof current.result === "object" && !Array.isArray(current.result)
            ? current.result as Record<string, unknown>
            : {};
        const currentGenerated = Number(currentResult.generatedClipCount || currentResult.readyClipCount || 0);

        if (current?.jobId === job.jobId && currentGenerated >= generatedClipCount) {
          return prev;
        }

        return {
          ...prev,
          generate_training_dataset: {
            ...(prev.generate_training_dataset || {}),
            phase: String(job.status || "queued"),
            progress,
            message: String(job.message || ""),
            error: String(job.error || ""),
            job,
          } as QueuedJobUiState,
        };
      });

      saveCharacterBuilderDraftNow({
        step: "voice",
        activeBuilderPage: "voice",
        lastBuilderStep: "voice",
        voiceLabPage: "training",
        lastVoiceLabPage: "training",
        activeDatasetJobId: job.jobId,
      });
    };

    void hydrateActiveTrainingDatasetJobFromServer();

    return () => {
      cancelled = true;
    };
  }, [
    characterDraftHydrated,
    step,
    voiceLabPage,
    details.name,
    saveCharacterBuilderDraftNow,
  ]);
  const usableTrainedVoiceArtifact = findUsableTrainedVoiceArtifact(builderCharacterVoiceProfile);
  const trainedModelPath = String(usableTrainedVoiceArtifact?.modelPath || "").trim();
  const trainedIndexPath = String(usableTrainedVoiceArtifact?.indexPath || "").trim();
  const trainedVoiceInputAudioPath = String(
    builderCharacterVoiceProfile?.approvedSamplePath ||
      builderCharacterVoiceProfile?.tunedSamplePath ||
      builderCharacterVoiceProfile?.baseSamplePath ||
      "",
  ).trim();
  const trainedVoiceInputAudioUrl = String(
    builderCharacterVoiceProfile?.approvedSampleUrl ||
      builderCharacterVoiceProfile?.tunedSampleUrl ||
      builderCharacterVoiceProfile?.baseSampleUrl ||
      "",
  ).trim();
  const trainedVoiceReady = Boolean(usableTrainedVoiceArtifact && trainedModelPath && trainedIndexPath);
  const characterPreviewSourceImagePath = String(selectedFullBody?.serverPath || uploadedImage?.serverPath || "").trim();
  const characterPreviewSourceImageUrl = String(selectedFullBody?.url || uploadedImage?.url || "").trim();
  const characterPreviewDubSelection = getCharacterPreviewDubSelection(voicePipelineJobs.generate_character_preview?.job);

  const characterPreviewModelSpinJob = voicePipelineJobs.generate_character_preview?.job;
  const characterPreviewModelSpinResult =
    characterPreviewModelSpinJob?.result && typeof characterPreviewModelSpinJob.result === "object" && !Array.isArray(characterPreviewModelSpinJob.result)
      ? (characterPreviewModelSpinJob.result as Record<string, unknown>)
      : null;
  const characterModelSpinVideoSrc = (() => {
    if (!characterPreviewModelSpinJob) return "";

    const explicitUrl = String(
      characterPreviewModelSpinResult?.modelSpinVideoUrl ||
        characterPreviewModelSpinResult?.modelSpinUrl ||
        ""
    ).trim();

    if (explicitUrl) return explicitUrl;

    const owner = String(characterPreviewModelSpinJob.ownerKey || "").trim();
    const characterId = String(characterPreviewModelSpinJob.characterId || details.name || "").trim();
    const jobId = String(characterPreviewModelSpinJob.jobId || "").trim();

    if (!owner || !characterId || !jobId) return "";

    const version = String(
      characterPreviewModelSpinResult?.modelSpinVideoBytes ||
        characterPreviewModelSpinJob.updatedAt ||
        jobId
    );

    return `/api/characters/character-preview/file?owner=${encodeURIComponent(owner)}&characterId=${encodeURIComponent(characterId)}&jobId=${encodeURIComponent(jobId)}&file=model-spin.mp4&v=${encodeURIComponent(version)}`;
  })();  const characterPreviewDubReady = Boolean(characterPreviewDubSelection);
  const characterPreviewSubmitting = voicePipelineJobs.generate_character_preview?.phase === "submitting";
  const characterPreviewDisabled = characterPreviewSubmitting || !trainedVoiceReady || !characterPreviewSourceImagePath;
  useEffect(() => {
    if (!characterDraftHydratedRef.current || !characterDraftHydrated) return;
    if (step !== "voice" || voiceLabPage !== "preview") return;

    const characterId = safeId(details.name);
    if (!characterId) return;

    let cancelled = false;

    const hydrateLatestTrainedPlaybackJob = async () => {
      try {
        const jobs = await listCharacterVoiceJobs({
          action: "test_trained_voice",
          characterId,
          status: "completed",
        });
        if (cancelled) return;

        const selected = selectLatestTrainedVoicePlaybackJob(jobs);
        if (!selected) return;

        setVoicePipelineJobs((current) => {
          const existing = getTrainedVoicePlaybackSelection(current.test_trained_voice?.job);
          if (existing && existing.job.jobId === selected.job.jobId && existing.outputBytes === selected.outputBytes) return current;

          return {
            ...current,
            test_trained_voice: {
              ...(current.test_trained_voice || {}),
              phase: "queued",
              job: selected.job as QueuedContractJob,
              error: undefined,
            },
          };
        });
      } catch {
        // Best-effort hydration. The Test Trained Voice button can still create a fresh playback job.
      }
    };

    void hydrateLatestTrainedPlaybackJob();

    return () => {
      cancelled = true;
    };
  }, [characterDraftHydrated, step, voiceLabPage, details.name]);
  const advancedVoiceFxPresets = useMemo(() => voiceFxPresetsForCategory(voiceFxPresetCategory), [voiceFxPresetCategory]);
  const selectedVoiceFxPreset = useMemo(() => {
    const categoryHit = advancedVoiceFxPresets.find((preset) => preset.id === voiceFxPresetId);
    return categoryHit || advancedVoiceFxPresets[0] || findVoiceFxPresetDefinition("dragon");
  }, [advancedVoiceFxPresets, voiceFxPresetId]);
  const selectedVoiceFxChain = selectedVoiceFxPreset.chain;
  const voiceFxBusy =
    loading ||
    voicePipelineJobs.apply_voice_fx?.phase === "submitting" ||
    Boolean(voicePipelineJobs.apply_voice_fx?.job?.jobId && !isTerminalJobStatus(voicePipelineJobs.apply_voice_fx.job.status));
  const createVoiceJobState = voicePipelineJobs.create_voice_sample || { phase: "idle" as const };
  const createVoiceJob = createVoiceJobState.job;
  const createVoiceBusy =
    createVoiceJobState.phase === "submitting" ||
    Boolean(createVoiceJob?.jobId && !isTerminalJobStatus(createVoiceJob.status));
  const baseVoiceIsDevMock = Boolean(builderCharacterVoiceProfile?.mockResult && builderCharacterVoiceProfile.mockResult.mock !== false);
  const allowMockVoiceTraining = process.env.NEXT_PUBLIC_OTG_ALLOW_MOCK_VOICE_TRAINING === "1";
  const baseVoiceCanAdvance = Boolean(builderCharacterVoiceProfile?.baseSampleUrl && (!baseVoiceIsDevMock || allowMockVoiceTraining));
  // OTG_REJECT_LOCAL_MOCK_BASE_VOICE_V2
  useEffect(() => {
    if (!baseVoiceIsDevMock || allowMockVoiceTraining) return;

    setBuilderCharacterVoiceProfile(null);
    setVoicePreview(null);
    setError("Mock output rejected. Start the real Qwen3/Cosy worker and click Create Voice again.");
  }, [baseVoiceIsDevMock, allowMockVoiceTraining]);

  const voicePipelineJobsRef = useRef(voicePipelineJobs);
  const activeVoicePipelineJobIds = useMemo(
    () =>
      Object.values(voicePipelineJobs)
        .map((state) => state?.job)
        .filter((job): job is QueuedContractJob => Boolean(job?.jobId) && !isTerminalJobStatus(job?.status))
        .map((job) => job.jobId)
        .sort()
        .join("|"),
    [voicePipelineJobs],
  );

  useEffect(() => {
    voicePipelineJobsRef.current = voicePipelineJobs;
  }, [voicePipelineJobs]);

  const persistCharacterVoiceProfile = useCallback(async (
    characterId: string,
    profile: CharacterVoiceProfile,
    savedMessage: string,
    unsavedMessage: string,
    failureMessage: string,
  ) => {
    setBuilderCharacterVoiceProfile(profile);

    try {
      const response = await fetch("/api/characters", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({
          action: "update_voice_profile",
          id: characterId,
          characterVoiceProfile: profile,
        }),
      });
      const json = await response.json().catch(() => null);
      if (response.status === 404) {
        setMessage(unsavedMessage);
        return;
      }
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || failureMessage);
      }
      setCharacters(Array.isArray(json.items) ? json.items : []);
      setMessage(savedMessage);
    } catch (error) {
      setError(error instanceof Error ? error.message : failureMessage);
    }
  }, []);

  useEffect(() => {
    if (!characterDraftHydratedRef.current) return;
    const characterId = safeId(details.name);
    if (!characterId || reconciledApplioArtifactCharacterIdsRef.current.has(characterId)) return;

    const currentProfile =
      builderCharacterVoiceProfile?.characterId === characterId
        ? builderCharacterVoiceProfile
        : characters.find((character) => character.id === characterId)?.characterVoiceProfile || null;

    let cancelled = false;
    reconciledApplioArtifactCharacterIdsRef.current.add(characterId);
    const reconcile = async () => {
      try {
        const response = await fetch("/api/characters", {
          method: "POST",
          headers: CHARACTER_JSON_HEADERS,
          credentials: "omit",
          body: JSON.stringify({
            action: "recover_applio_voice_profile",
            id: characterId,
            characterVoiceProfile: currentProfile,
          }),
        });
        if (cancelled) return;
        if (response.status === 404) return;
        const json = await response.json().catch(() => null);
        if (!response.ok || !json?.ok || !json.characterVoiceProfile) return;

        const recoveredProfile = json.characterVoiceProfile as CharacterVoiceProfile;
        setBuilderCharacterVoiceProfile(recoveredProfile);
        if (Array.isArray(json.items)) setCharacters(json.items);
        const recoveredJobId = String(recoveredProfile.sourceTrainingJobId || recoveredProfile.trainingJobId || "").trim();
        if (recoveredJobId) persistedApplioArtifactJobIdsRef.current.add(recoveredJobId);
        if (json.source === "completed_job" || json.source === "artifact_file") {
          setMessage(String(json.message || "Recovered trained voice model from completed training artifact."));
        }
      } catch {
        // Recovery is best-effort; active job polling still handles normal in-session completion.
      }
    };

    void reconcile();
    return () => {
      cancelled = true;
    };
  }, [details.name, builderCharacterVoiceProfile, characters]);

  useEffect(() => {
    if (!activeVoicePipelineJobIds) return;

    let cancelled = false;
    const poll = async () => {
      const activeJobs = Object.entries(voicePipelineJobsRef.current)
        .map(([action, state]) => ({ action: action as CharacterVoicePipelineAction, job: state?.job }))
        .filter((item): item is { action: CharacterVoicePipelineAction; job: QueuedContractJob } => Boolean(item.job?.jobId) && !isTerminalJobStatus(item.job?.status));

      await Promise.all(activeJobs.map(async ({ action, job }) => {
        try {
          const latest = await getCharacterVoiceJob(job.jobId);
          if (cancelled) return;
          setVoicePipelineJobs((current) => ({
            ...current,
            [action]: {
              phase: isTerminalJobStatus(latest.status) ? "queued" : "polling",
              job: latest,
              error: undefined,
            },
          }));
        } catch (error) {
          if (cancelled) return;
          setVoicePipelineJobs((current) => ({
            ...current,
            [action]: {
              ...(current[action] || { phase: "error" }),
              phase: "error",
              error: error instanceof Error ? error.message : "Could not poll queued job.",
            },
          }));
        }
      }));
    };

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeVoicePipelineJobIds]);

  useEffect(() => {
    if (!activeVoicePipelineJobIds || process.env.NODE_ENV === "production") return;

    let cancelled = false;
    let timeoutId: number | undefined;

    const tickAndRefresh = async () => {
      const activeJobs = Object.entries(voicePipelineJobsRef.current)
        .map(([action, state]) => ({ action: action as CharacterVoicePipelineAction, job: state?.job }))
        .filter((item): item is { action: CharacterVoicePipelineAction; job: QueuedContractJob } => Boolean(item.job?.jobId) && !isTerminalJobStatus(item.job?.status));

      if (activeJobs.length === 0) return;

      let hasActiveJobs = false;
      for (const { action, job } of activeJobs) {
        try {
          let latest: QueuedContractJob;

          if (action === "create_voice_sample" || action === "generate_character_preview") {
            // Do not auto-advance jobs that require dedicated Windows workers through the dev no-op worker.
            // create_voice_sample requires the persistent Qwen3/Cosy voice worker.
            // generate_character_preview requires the persistent character preview dub worker so LTX/ffmpeg/Applio run on Windows.
            latest = await getCharacterVoiceJob(job.jobId);
          } else {
            const ticked = await tickVoicePipelineWorker(1, job.jobId);
            if (cancelled) return;

            const tickedCurrentJob = ticked.jobs.find((item) => item.jobId === job.jobId);
            latest = tickedCurrentJob || (await getCharacterVoiceJob(job.jobId));
          }

          if (cancelled) return;

          if (!isTerminalJobStatus(latest.status)) hasActiveJobs = true;
          setVoicePipelineJobs((current) => ({
            ...current,
            [action]: {
              phase: isTerminalJobStatus(latest.status) ? "queued" : "polling",
              job: latest,
              error: undefined,
            },
          }));
        } catch (error) {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : `Could not advance ${action}.`;
          if (message.includes("404") || message.toLowerCase().includes("not found")) return;
          setVoicePipelineJobs((current) => ({
            ...current,
            [action]: {
              ...(current[action] || { phase: "error" }),
              phase: "error",
              error: message,
            },
          }));
        }
      }

      if (!cancelled && hasActiveJobs) {
        timeoutId = window.setTimeout(tickAndRefresh, 1800);
      }
    };

    timeoutId = window.setTimeout(tickAndRefresh, 250);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [activeVoicePipelineJobIds]);

  useEffect(() => {
    const job = voicePipelineJobs.create_voice_sample?.job;
    if (!job || job.status !== "completed" || persistedMockVoiceSampleJobIdsRef.current.has(job.jobId)) return;

    const result = job.result && typeof job.result === "object" && !Array.isArray(job.result)
      ? job.result as Record<string, unknown>
      : {};

    if (result.mock !== false) {
      persistedMockVoiceSampleJobIdsRef.current.add(job.jobId);
      const message = "Real voice creation failed: mock output is disabled. Start the real Qwen3/Cosy worker and click Create Voice again.";

      setVoicePipelineJobs((current) => ({
        ...current,
        create_voice_sample: {
          ...(current.create_voice_sample || { phase: "error" }),
          phase: "error",
          job,
          error: message,
        },
      }));

      setBuilderCharacterVoiceProfile(null);
      setVoicePreview(null);
      setError(message);
      return;
    }

    const sampleUrl = String(result.sampleUrl || "").trim();
    const samplePath = String(result.samplePath || "").trim();

    if (!sampleUrl) {
      persistedMockVoiceSampleJobIdsRef.current.add(job.jobId);
      const message = "Real voice creation failed: worker completed without a sample URL.";

      setVoicePipelineJobs((current) => ({
        ...current,
        create_voice_sample: {
          ...(current.create_voice_sample || { phase: "error" }),
          phase: "error",
          job,
          error: message,
        },
      }));

      setBuilderCharacterVoiceProfile(null);
      setVoicePreview(null);
      setError(message);
      return;
    }

    persistedMockVoiceSampleJobIdsRef.current.add(job.jobId);
    const characterId = String(job.characterId || safeId(details.name)).trim();
    const provider = job.input?.provider === "cosy" ? "cosy" : "qwen3";

    const profile: CharacterVoiceProfile = {
      characterId,
      provider,
      status: "sample_ready",
      baseSamplePath: samplePath || undefined,
      baseSampleUrl: sampleUrl,
      approvedSamplePath: samplePath || undefined,
      approvedSampleUrl: sampleUrl,
      sourceJobId: job.jobId,
      mockResult: result,
      updatedAt: new Date().toISOString(),
    };

    void persistCharacterVoiceProfile(
      characterId,
      profile,
      "Real base voice sample saved to character profile.",
      "Real voice sample ready. It will be saved with the character profile when this character is saved.",
      "Could not save real voice sample to character profile.",
    );
  }, [voicePipelineJobs.create_voice_sample?.job, details.name, persistCharacterVoiceProfile]);

  useEffect(() => {
    const job = voicePipelineJobs.apply_voice_fx?.job;
    if (!job || job.status !== "completed" || persistedVoiceFxJobIdsRef.current.has(job.jobId)) return;

    const result = job.result && typeof job.result === "object" && !Array.isArray(job.result)
      ? job.result as Record<string, unknown>
      : {};
    const tunedSampleUrl = String(result.processedSampleUrl || result.fxSampleUrl || "").trim();
    const tunedSamplePath = String(result.processedSamplePath || result.fxSamplePath || "").trim();
    if (!tunedSampleUrl) {
      persistedVoiceFxJobIdsRef.current.add(job.jobId);
      setError("Voice FX job completed without a processed sample URL. The tuned profile was not updated.");
      return;
    }

    setVoiceFxPreview((current: any | null) => {
      const currentUrl = String(current?.processedSampleUrl || current?.audioUrl || "").trim();
      if (currentUrl === tunedSampleUrl) return current;
      return {
        ...(current || {}),
        audioUrl: tunedSampleUrl,
        audioPath: tunedSamplePath || "",
        outputPath: tunedSamplePath || "",
        processedSampleUrl: tunedSampleUrl,
        processedSamplePath: tunedSamplePath || "",
        fxPreset: result.fxPreset || job.input?.fxPreset || voiceFx.preset,
      };
    });

    persistedVoiceFxJobIdsRef.current.add(job.jobId);
    const characterId = String(job.characterId || safeId(details.name)).trim();
    const savedProfile = characters.find((character) => character.id === characterId)?.characterVoiceProfile || null;
    const currentProfile =
      builderCharacterVoiceProfile?.characterId === characterId
        ? builderCharacterVoiceProfile
        : savedProfile;
    const now = new Date().toISOString();
    const profile: CharacterVoiceProfile = {
      ...(currentProfile || {
        characterId,
        provider: job.input?.provider === "cosy" ? "cosy" : voiceProvider,
        status: "sample_ready" as const,
        updatedAt: now,
      }),
      characterId,
      provider: currentProfile?.provider || (job.input?.provider === "cosy" ? "cosy" : voiceProvider),
      status: currentProfile?.status || "sample_ready",
      tunedSampleUrl,
      tunedSamplePath: tunedSamplePath || undefined,
      tunedFxPreset: (result.fxPreset || job.input?.fxPreset || voiceFx.preset) as VoiceFxPreset,
      tunedSourceJobId: job.jobId,
      tunedAt: now,
      tunedResult: result,
      updatedAt: now,
    };

    void persistCharacterVoiceProfile(
      characterId,
      profile,
      "Tuned voice sample saved to character profile.",
      "Tuned voice sample ready. It will be saved with the character profile when this character is saved.",
      "Could not save tuned voice sample to character profile.",
    );
  }, [
    voicePipelineJobs.apply_voice_fx?.job,
    details.name,
    characters,
    builderCharacterVoiceProfile,
    voiceProvider,
    voiceFx.preset,
    persistCharacterVoiceProfile,
  ]);

  useEffect(() => {
    const job = voicePipelineJobs.start_applio_training?.job;
    if (!job || job.status !== "completed" || persistedApplioArtifactJobIdsRef.current.has(job.jobId)) return;

    const result = job.result && typeof job.result === "object" && !Array.isArray(job.result)
      ? job.result as Record<string, unknown>
      : {};
    const characterId = String(job.characterId || safeId(details.name)).trim();
    const savedProfile = characters.find((character) => character.id === characterId)?.characterVoiceProfile || null;
    const currentProfile =
      builderCharacterVoiceProfile?.characterId === characterId
        ? builderCharacterVoiceProfile
        : savedProfile;
    const profile = buildApplioTrainingArtifactVoiceProfile({
      characterId,
      jobId: job.jobId,
      result,
      jobInput: job.input,
      currentProfile,
      fallbackProvider: job.input?.provider === "cosy" ? "cosy" : voiceProvider,
    });

    persistedApplioArtifactJobIdsRef.current.add(job.jobId);
    if (!profile) {
      setError("Applio job completed without verified artifact metadata. The voice model profile was not updated.");
      return;
    }

    void persistCharacterVoiceProfile(
      characterId,
      profile,
      "Voice model artifact saved to character profile.",
      "Voice model artifact ready. It will be saved with the character profile when this character is saved.",
      "Could not save voice model artifact to character profile.",
    );
  }, [
    voicePipelineJobs.start_applio_training?.job,
    details.name,
    characters,
    builderCharacterVoiceProfile,
    voiceProvider,
    persistCharacterVoiceProfile,
  ]);



  const character3dModelUrl = String(character3dModel?.modelUrl || "").trim();
  const character3dModelPath = String(character3dModel?.modelPath || character3dModel?.outputPath || "").trim();
  const hasActiveCreateCharacterDraft =
    step !== "source" ||
    Boolean(
      generationPrompt.trim() ||
      candidates.length ||
      selectedFullBody ||
      characterCard ||
      details.name.trim() ||
      builderCharacterVoiceProfile ||
      voicePreview ||
      voiceFxPreview ||
      selectedIndexVoiceReference ||
      indexVoicePack ||
      character3dModel ||
      Object.keys(voicePipelineJobs).length,
    );
  const showSavedCharactersStrip = step === "source" && !hasActiveCreateCharacterDraft;
  function currentBuilderStepIndex() {
    return builderStepIndexFor(step);
  }

  function builderStepCompletionError(stepId: BuilderCanonicalStep) {
    if (stepId === "source" && !selectedFullBody?.serverPath) {
      return "Choose or upload a full-body character image before moving forward. Completed pages lock after you advance.";
    }
    if (stepId === "card" && !characterCard?.serverPath) {
      return "Create the character card before moving forward. Completed pages lock after you advance.";
    }
    if (stepId === "details" && !details.name.trim()) {
      return "Character Name is required before moving to Voice Lab. Completed pages lock after you advance.";
    }
    if (stepId === "voice" && !voicePackCreated && !builderCharacterVoiceProfile?.baseSampleUrl) {
      return "Create or upload the base character voice before moving to Review & Save.";
    }
    return "";
  }

  function lockCurrentBuilderStep() {
    setLockedBuilderStepIndex((current) => Math.max(current, currentBuilderStepIndex()));
  }

  function advanceToBuilderStep(targetStep: BuilderCanonicalStep, options: { skipValidation?: boolean; message?: string } = {}) {
    const currentIndex = currentBuilderStepIndex();
    const targetIndex = builderStepIndexFor(targetStep);
    if (targetIndex <= lockedBuilderStepIndex) {
      setMessage("That page is locked. Use Start Over if you need to change completed character setup.");
      return false;
    }
    if (targetIndex < currentIndex) {
      setMessage("Completed pages are locked. Use Start Over if you need to change an earlier page.");
      return false;
    }
    if (targetIndex > currentIndex + 1) {
      setError("Finish the current page before moving farther ahead.");
      return false;
    }
    if (!options.skipValidation) {
      const errorMessage = builderStepCompletionError(BUILDER_STEP_ORDER[currentIndex]);
      if (errorMessage) {
        setError(errorMessage);
        return false;
      }
    }
    const nextLockedBuilderStepIndex = Math.max(lockedBuilderStepIndex, currentIndex);
    setError("");
    setLockedBuilderStepIndex(nextLockedBuilderStepIndex);
    setStep(targetStep as BuilderStep);
    saveCharacterBuilderDraftNow({
      step: targetStep,
      activeBuilderPage: targetStep,
      lastBuilderStep: targetStep,
      lockedBuilderStepIndex: nextLockedBuilderStepIndex,
      completedSteps: BUILDER_STEP_ORDER.slice(0, Math.max(0, nextLockedBuilderStepIndex + 1)),
    });
    if (options.message) setMessage(options.message);
    return true;
  }

  function resetVoiceLabForNewCharacterEntry(nextLockedBuilderStepIndex: number) {
    const resetVoice = { ...DEFAULT_VOICE };
    const resetVoiceDesignProfile = defaultVoiceDesignProfile();
    const resetQwenVoiceDesign = defaultQwenVoiceDesignInput();
    const resetVoiceFx = { ...DEFAULT_VOICE_FX };
    const resetSimpleVoiceFx = { ...DEFAULT_SIMPLE_VOICE_FX };

    setVoice(resetVoice);
    setVoiceProvider("qwen3");
    setVoiceDesignProfile(resetVoiceDesignProfile);
    setQwenVoiceDesign(resetQwenVoiceDesign);
    setQwenVoiceCandidates([]);
    setSelectedQwenVoiceCandidateId("");
    setQwenVoiceDesignRecord(null);
    setVoicePromptSnapshot(null);
    setVoicePackCreated(false);
    setVoicePackRecord(null);
    setVoicePreview(null);
    setVoiceFx(resetVoiceFx);
    setSimpleVoiceFx(resetSimpleVoiceFx);
    setVoiceFxPreview(null);
    setVoiceFxAdvancedOpen(false);
    setVoiceFxPresetCategory("Monsters");
    setVoiceFxPresetId("dragon");
    setVoiceFxChainOpen(false);
    setVoiceFxStatus("Ready");
    setSelectedIndexVoiceReference(null);
    setIndexVoicePack(null);
    setVoiceTestText("This is a test line for the character voice.");
    setVoicePipelineJobs({});
    setVoiceUploadState({ phase: "idle" });
    setBuilderCharacterVoiceProfile(null);
    setApplioTrainingQualityPreset(DEFAULT_APPLIO_TRAINING_QUALITY_PRESET);
    persistedMockVoiceSampleJobIdsRef.current.clear();
    persistedVoiceFxJobIdsRef.current.clear();
    persistedApplioArtifactJobIdsRef.current.clear();

    setVoiceLabPage("design");
    setLockedVoiceLabPageIndex(-1);

    saveCharacterBuilderDraftNow({
      step: "voice",
      activeBuilderPage: "voice",
      lastBuilderStep: "voice",
      lockedBuilderStepIndex: nextLockedBuilderStepIndex,
      completedSteps: BUILDER_STEP_ORDER.slice(0, Math.max(0, nextLockedBuilderStepIndex + 1)),
      voice: resetVoice,
      voiceProvider: "qwen3",
      voiceDesignProfile: resetVoiceDesignProfile,
      qwenVoiceDesign: resetQwenVoiceDesign,
      qwenVoiceCandidates: [],
      selectedQwenVoiceCandidateId: "",
      qwenVoiceDesignRecord: null,
      voicePromptSnapshot: null,
      voicePackCreated: false,
      voicePackRecord: null,
      voicePreview: null,
      voiceFx: resetVoiceFx,
      simpleVoiceFx: resetSimpleVoiceFx,
      voiceFxPreview: null,
      voiceFxAdvancedOpen: false,
      voiceFxPresetCategory: "Monsters",
      voiceFxPresetId: "dragon",
      voiceFxChainOpen: false,
      voiceFxStatus: "Ready",
      voiceLabPage: "design",
      lastVoiceLabPage: "design",
      lockedVoiceLabPageIndex: -1,
      selectedIndexVoiceReference: null,
      indexVoicePack: null,
      voiceTestText: "This is a test line for the character voice.",
      voicePipelineJobs: {},
      activeDatasetJobId: "",
      activeDatasetManifestPath: "",
      activeDatasetManifestUrl: "",
      datasetStatus: "",
      datasetGeneratedClipCount: 0,
      datasetRequestedClipCount: 0,
      activeModelTrainingJobId: "",
      modelTrainingStatus: "",
      applioTrainingQualityPreset: DEFAULT_APPLIO_TRAINING_QUALITY_PRESET,
      builderCharacterVoiceProfile: null,
    });
  }

  function continueNewCharacterToVoiceLab() {
    const currentIndex = currentBuilderStepIndex();
    const targetIndex = builderStepIndexFor("voice");

    if (targetIndex <= lockedBuilderStepIndex) {
      setMessage("That page is locked. Use Start Over if you need to change completed character setup.");
      return false;
    }
    if (targetIndex < currentIndex) {
      setMessage("Completed pages are locked. Use Start Over if you need to change an earlier page.");
      return false;
    }
    if (targetIndex > currentIndex + 1) {
      setError("Finish the current page before moving farther ahead.");
      return false;
    }

    const errorMessage = builderStepCompletionError(BUILDER_STEP_ORDER[currentIndex]);
    if (errorMessage) {
      setError(errorMessage);
      return false;
    }

    const nextLockedBuilderStepIndex = Math.max(lockedBuilderStepIndex, currentIndex);
    setError("");
    setLockedBuilderStepIndex(nextLockedBuilderStepIndex);
    setStep("voice");
    resetVoiceLabForNewCharacterEntry(nextLockedBuilderStepIndex);
    setMessage("Character details saved and locked. Start with Voice Design.");
    return true;
  }
  function showBuilderStepIfEditable(targetStep: BuilderStep) {
    const targetIndex = builderStepIndexFor(targetStep);
    if (targetIndex <= lockedBuilderStepIndex) {
      setMessage("That page is locked. Use Start Over if you need to change completed character setup.");
      return false;
    }
    setStep(targetStep);
    saveCharacterBuilderDraftNow({
      step: targetStep,
      activeBuilderPage: targetStep,
      lastBuilderStep: targetStep,
    });
    return true;
  }

  function goToBuilderStepByOffset(offset: number) {
    const currentIndex = currentBuilderStepIndex();
    if (offset < 0) {
      const nextIndex = currentIndex - 1;
      if (nextIndex <= lockedBuilderStepIndex) {
        setMessage("Completed pages are locked. Use Start Over if you need to change an earlier page.");
        return;
      }
      const targetStep = BUILDER_STEP_ORDER[Math.max(0, nextIndex)] as BuilderStep;
      setStep(targetStep);
      saveCharacterBuilderDraftNow({
        step: targetStep,
        activeBuilderPage: targetStep,
        lastBuilderStep: targetStep,
      });
      return;
    }
    const nextIndex = Math.max(0, Math.min(BUILDER_STEP_ORDER.length - 1, currentIndex + offset));
    if (nextIndex !== currentIndex) {
      const targetStep = BUILDER_STEP_ORDER[nextIndex];
      if (targetStep === "voice" && step === "details") {
        continueNewCharacterToVoiceLab();
      } else {
        advanceToBuilderStep(targetStep);
      }
    }
  }

  function voiceLabCompletionError(page: VoiceLabPage) {
    if (page === "design" && !baseVoiceCanAdvance) {
      return "Create or upload a real base voice before moving to Voice Effects.";
    }
    if (page === "fx" && !lockedTrainingVoiceUrl) {
      return "Create or upload a voice before moving to Training.";
    }
    if (page === "training" && !trainedVoiceReady && voicePipelineJobs.start_applio_training?.job?.status !== "completed") {
      return "Train the voice model before moving to Test + Preview.";
    }
    return "";
  }

  function advanceToVoiceLabPage(targetPage: VoiceLabPage, options: { skipValidation?: boolean; message?: string } = {}) {
    const currentIndex = voiceLabPageIndexFor(voiceLabPage);
    const targetIndex = voiceLabPageIndexFor(targetPage);
    if (targetIndex <= lockedVoiceLabPageIndex) {
      setMessage("That Voice Lab page is locked. Use Start Over if you need to change completed voice setup.");
      return false;
    }
    if (targetIndex < currentIndex) {
      setMessage("Completed Voice Lab pages are locked. Use Start Over if you need to change an earlier voice step.");
      return false;
    }
    if (targetIndex > currentIndex + 1) {
      setError("Finish the current Voice Lab page before moving farther ahead.");
      return false;
    }
    if (!options.skipValidation) {
      const errorMessage = voiceLabCompletionError(voiceLabPage);
      if (errorMessage) {
        setError(errorMessage);
        return false;
      }
    }
    const nextLockedVoiceLabPageIndex = Math.max(lockedVoiceLabPageIndex, currentIndex);
    setError("");
    setLockedVoiceLabPageIndex(nextLockedVoiceLabPageIndex);
    setVoiceLabPage(targetPage);
    saveCharacterBuilderDraftNow({
      step: "voice",
      activeBuilderPage: "voice",
      lastBuilderStep: "voice",
      voiceLabPage: targetPage,
      lastVoiceLabPage: targetPage,
      lockedVoiceLabPageIndex: nextLockedVoiceLabPageIndex,
    });
    if (options.message) setMessage(options.message);
    return true;
  }

    const [savedCharacter3dBusyId, setSavedCharacter3dBusyId] = useState<string | null>(null);
  const [savedCharacter3dNoticeCharacterId, setSavedCharacter3dNoticeCharacterId] = useState<string | null>(null);
  const [savedCharacter3dMessage, setSavedCharacter3dMessage] = useState<string>("");
  const [savedCharacter3dError, setSavedCharacter3dError] = useState<string>("");

  const [savedCharacterAnimateBusyId, setSavedCharacterAnimateBusyId] = useState<string>("");
  const [savedCharacterAnimateNoticeId, setSavedCharacterAnimateNoticeId] = useState<string>("");
  const [savedCharacterAnimateMessage, setSavedCharacterAnimateMessage] = useState<string>("");
  const [savedCharacterAnimateError, setSavedCharacterAnimateError] = useState<string>("");
  const [savedCharacterAnimateVideoUrlById, setSavedCharacterAnimateVideoUrlById] = useState<Record<string, string>>({});  async function generateAnimatePreviewForSavedCharacter(character: CharacterRecord) {
    const characterSafeId = safeId(String(character.id || character.name || ""));

    setSavedCharacterAnimateBusyId(characterSafeId);
    setSavedCharacterAnimateNoticeId(characterSafeId);
    setSavedCharacterAnimateMessage(`Preparing animation preview for ${character.name || "this character"}...`);
    setSavedCharacterAnimateError("");

    try {
      const response = await fetch("/api/characters/animate-preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          characterId: characterSafeId,
          imagePath: character.imagePath || character.previewImagePath || (character as any).fullBodyImagePath || "",
          script: "Hey, thanks for creating me. I'm your new character. Let's make some great movies.",
          shot: "full-body character standing, camera slowly pushes in to a close-up of the character face, cinematic widescreen",
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `Animate Me failed with HTTP ${response.status}`);
      }

      if (payload.status === "queued" && payload.jobId) {
        setSavedCharacterAnimateMessage(payload.message || "Animation preview queued for the Windows worker.");
        setSavedCharacterAnimateVideoUrlById((current) => {
          const next = { ...current };
          delete next[characterSafeId];
          return next;
        });
        return;
      }

      if (payload.videoUrl) {
        setSavedCharacterAnimateVideoUrlById((current) => ({
          ...current,
          [characterSafeId]: payload.videoUrl,
        }));
      }

      setSavedCharacterAnimateMessage(payload.message || "Animation preview completed.");
    } catch (error: any) {
      setSavedCharacterAnimateError(error?.message || "Animation preview failed.");
      setSavedCharacterAnimateMessage("");
    } finally {
      setSavedCharacterAnimateBusyId("");
    }
  }
async function generate3dModelForSavedCharacter(character: CharacterRecord) {
    const characterId = safeId(String(character.id || character.name || ""));
    const imagePath = String(character.imagePath || character.previewImagePath || "").trim();

    if (!characterId) {
      setSavedCharacter3dNoticeCharacterId(null);
      setSavedCharacter3dMessage("");
      setSavedCharacter3dError("Cannot generate 3D model: saved character is missing an id/name.");
      return;
    }

    if (!imagePath) {
      setSavedCharacter3dNoticeCharacterId(characterId);
      setSavedCharacter3dMessage("");
      setSavedCharacter3dError("Cannot generate 3D model: saved character is missing imagePath/previewImagePath.");
      return;
    }

    setSavedCharacter3dBusyId(characterId);
    setSavedCharacter3dNoticeCharacterId(characterId);
    setSavedCharacter3dMessage(`Generating 3D model for ${character.name || characterId}...`);
    setSavedCharacter3dError("");

    try {
      const response = await fetch("/api/characters/3d-model", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          characterId,
          imagePath,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMessage =
          typeof payload?.error === "string"
            ? payload.error
            : typeof payload?.message === "string"
              ? payload.message
              : `3D model generation failed with HTTP ${response.status}.`;

        throw new Error(errorMessage);
      }

      setSavedCharacter3dMessage(`3D model ready for ${character.name || characterId}.`);
      setSavedCharacter3dError("");
      await loadCharacters();
    } catch (error) {
      setSavedCharacter3dMessage("");
      setSavedCharacter3dError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavedCharacter3dBusyId(null);
    }
  }

async function loadCharacters() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/characters", {
        cache: "no-store",
        credentials: "omit",
        headers: { "x-otg-device-id": CHARACTER_DEVICE_ID },
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "Could not load characters.");
      setCharacters(Array.isArray(json.items) ? json.items : []);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  function resetBuilder() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(CHARACTER_BUILDER_DRAFT_KEY);
      if (characterDraftSaveTimeoutRef.current !== null) {
        window.clearTimeout(characterDraftSaveTimeoutRef.current);
      }
      void fetch(`/api/characters/builder-draft?ownerId=${encodeURIComponent(CHARACTER_DEVICE_ID)}`, {
        method: "DELETE",
        credentials: "omit",
        headers: { "x-otg-device-id": CHARACTER_DEVICE_ID },
      }).catch(() => {
        // Local reset should still complete if server draft cleanup fails.
      });
    }
    setStep("source");
    setLockedBuilderStepIndex(-1);
    setLockedVoiceLabPageIndex(-1);
    setMessage("");
    setError("");
    setGenerationPrompt("");
    setStylePreset("Anime");
    setCandidates([]);
    setSelectedCandidateId("");
    setUploadedImage(null);
    setImageCompleteness("full_body");
    setMissingGuidance("");
    setSelectedFullBody(null);
    setCharacterCard(null);
    setDetails(DEFAULT_DETAILS);
    setVoice(DEFAULT_VOICE);
    setVoiceProvider("qwen3");
    setQwenVoiceDesign(defaultQwenVoiceDesignInput());
    setQwenVoiceCandidates([]);
    setSelectedQwenVoiceCandidateId("");
    setQwenVoiceDesignRecord(null);
    setVoicePromptSnapshot(null);
    setVoicePackCreated(false);
    setVoicePackRecord(null);
    setVoicePreview(null);
    setVoiceFx(DEFAULT_VOICE_FX);
    setVoiceFxPreview(null);    setSelectedIndexVoiceReference(null);
    setIndexVoicePack(null);
    setVoiceTestText("This is a test line for the character voice.");
    setVoicePipelineJobs({});
    setVoiceUploadState({ phase: "idle" });
    setBuilderCharacterVoiceProfile(null);
    persistedMockVoiceSampleJobIdsRef.current.clear();
    persistedVoiceFxJobIdsRef.current.clear();
    persistedApplioArtifactJobIdsRef.current.clear();
    setCharacter3dModel(null);
  }

  function pushCandidate(candidate: CandidateImage) {
    setCandidates((current) => {
      const withNext = [...current, candidate];
      if (withNext.length <= 5) return withNext;
      const removable = withNext.find((item) => item.id !== selectedCandidateId && item.id !== candidate.id);
      return removable ? withNext.filter((item) => item.id !== removable.id) : withNext.slice(-5);
    });
    setSelectedCandidateId(candidate.id);
  }

  async function generateCharacterCandidate() {
    const prompt = generationPrompt.trim();
    if (!prompt) {
      setError("Enter a character prompt before generating.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const id = `generated-${Date.now()}`;
      const internalPrompt = buildInternalPrompt(prompt, stylePreset);
      setMessage("Character image job queued. Waiting for ComfyUI output...");
      const job = await submitCharacterImageJob(internalPrompt, stylePreset);
      setMessage(`Character image job submitted. Prompt ID: ${job.promptId}. Waiting for output...`);
      const generated = await waitForCharacterImage(job.promptId);
      const upload = await copyGeneratedImageToCharacterUpload(generated.url, `${id}.png`);
      pushCandidate({
        id,
        label: `${stylePreset} candidate`,
        url: upload.fileUrl || generated.url,
        serverPath: upload.serverPath,
        internalPrompt,
        promptId: job.promptId,
        workflowId: job.workflowId,
      });
      setMessage(`Generated a real character candidate. Prompt ID: ${job.promptId}. Latest image is selected.`);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function uploadCharacterImage(file: File | null) {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("image", file);
      const response = await fetch("/api/characters/upload", {
        method: "POST",
        headers: { "x-otg-device-id": CHARACTER_DEVICE_ID },
        credentials: "omit",
        body: form,
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "Upload failed.");
      setUploadedImage({
        id: `uploaded-${Date.now()}`,
        label: file.name,
        url: String(json.fileUrl || ""),
        serverPath: String(json.serverPath || ""),
      });
      setMessage("Uploaded image is ready for completeness review.");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  function continueUploadedImage() {
    if (!uploadedImage) {
      setError("Upload a character image first.");
      return;
    }
    setError("");
    if (imageCompleteness === "full_body") {
      setSelectedFullBody(uploadedImage);
      lockCurrentBuilderStep();
      setStep("card");
      setMessage("Source image saved and locked. Create the character card next.");
      return;
    }
    setCandidates([]);
    setSelectedCandidateId("");
    setMessage("Partial image selected. Complete full-body candidates before creating the card.");
  }

  async function completePartialImage() {
    if (!uploadedImage) {
      setError("Upload a partial character image first.");
      return;
    }

    const sourceServerPath = uploadedImage.serverPath || "";
    if (!sourceServerPath) {
      setError("Uploaded image does not have a stable server path for Qwen Image Edit.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const id = "completed-" + Date.now();
      const guidance = missingGuidance.trim() || "simple matching outfit";
      const instruction = "Use the uploaded image as the identity reference. Preserve the face, head shape, species, colors, and visible clothing. Extend the character into a full-body portrait from head to feet. For unseen lower-body areas, use this user guidance: " + guidance + ". If no guidance is provided, generate a simple matching outfit. Do not change visible identity features. Portrait 720x1280. Full body, head to feet visible, centered standing pose, no cropped head, no cropped feet.";

      setMessage("Completing full-body character image with Qwen Image Edit...");
      const job = await submitUploadedFullBodyCompletionJob(instruction, sourceServerPath);
      setMessage("Full-body completion job submitted. Prompt ID: " + job.promptId + ". Waiting for output...");

      const generated = await waitForCharacterImage(job.promptId);
      const upload = await copyGeneratedImageToCharacterUpload(generated.url, id + ".png");

      const completedCandidate: CandidateImage = {
        id,
        label: "Completed full-body candidate",
        url: upload.fileUrl || generated.url,
        serverPath: upload.serverPath,
        internalPrompt: instruction,
        promptId: job.promptId,
        workflowId: workflowForUploadedFullBodyCompletion(),
      };

      pushCandidate(completedCandidate);
      setMessage("Full-body completion created. Review the generated candidates below, select the one you want, then click Use This Character.");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  function useSelectedCandidate() {
    if (!selectedCandidate) {
      setError("Select a character candidate first.");
      return;
    }
    setSelectedFullBody(selectedCandidate);
    lockCurrentBuilderStep();
    setStep("card");
    setMessage("Character source saved and locked. Create the character card next.");
  }

  async function createCharacterCard() {
    if (!selectedFullBody) {
      setError("Select a full-body character image first.");
      return;
    }

    const sourceServerPath = selectedFullBody.serverPath || "";
    if (!sourceServerPath) {
      setError("Selected full-body image does not have a stable server path for the character-card workflow.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const id = "character-card-" + Date.now();
      const instruction = "Create a clean character reference sheet from the selected full-body character image. Preserve the exact same character identity, face, hairstyle, outfit, body proportions, colors, materials, clothing, and accessories. Arrange one composite card with five labeled views: FACE CLOSE-UP, FRONT VIEW, BACK VIEW, LEFT SIDE VIEW, and RIGHT SIDE VIEW. Keep the character centered, neutral, uncropped, full body visible for body views, no redesign, no new clothing, no changed accessories, no different character.";

      setMessage("Creating 8-angle character card...");
      const job = await submitCharacterCardJob(instruction, sourceServerPath);
      setMessage("Character card job submitted. Prompt ID: " + job.promptId + ". Waiting for output...");

      const generated = await waitForCharacterCardImage(job.promptId);
      const upload = await copyGeneratedImageToCharacterUpload(generated.url, id + ".png");

      setCharacterCard({
        id,
        label: "Multi-angle character card",
        url: upload.fileUrl || generated.url,
        serverPath: upload.serverPath,
        internalPrompt: instruction,
        promptId: job.promptId,
        workflowId: workflowForCharacterCard(),
      });

      lockCurrentBuilderStep();
      showBuilderStepIfEditable("details");
      setMessage("Character card created. Continue with details.");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  function setDetail<K extends keyof CharacterDetails>(key: K, value: CharacterDetails[K]) {
    setDetails((current) => ({ ...current, [key]: value }));
  }

  function setVoiceField<K extends keyof VoiceSettings>(key: K, value: VoiceSettings[K]) {
    setVoice((current) => ({ ...current, [key]: value }));
  }


  function clearQwenVoiceSelection() {
    setQwenVoiceCandidates([]);
    setSelectedQwenVoiceCandidateId("");
    setQwenVoiceDesignRecord(null);
    setVoicePromptSnapshot(null);
    setVoicePackCreated(false);
    setVoicePackRecord(null);
    setVoicePreview(null);
    setBuilderCharacterVoiceProfile(null);
  }

  function setVoiceDesignField<K extends keyof VoiceDesignProfile>(key: K, value: VoiceDesignProfile[K]) {
    setVoiceDesignProfile((current) => {
      const next = { ...current, [key]: value };
      if (key === "model") {
        next.mode = value === "cosyvoice" ? "instruct" : "voice_design";
        next.language = value === "cosyvoice" ? "Chinese" : "English";
        next.accentDialectId = value === "cosyvoice" ? "sichuan" : "neutral_american_english";
        setVoiceProvider(value === "cosyvoice" ? "cosy" : "qwen3");
      }
      if (key === "language" && current.model === "cosyvoice") {
        next.accentDialectId = value === "Chinese" ? "sichuan" : "neutral_international_english";
      }
      if (key === "qwenPresetSpeaker") {
        next.accentDialectId = String(value);
      }
      return next;
    });
    clearQwenVoiceSelection();
  }

  function saveReusableVoiceProfile() {
    if (!voicePromptSnapshot) {
      setError("Generate Voice Options first. Reusable profiles must be saved from a generated prompt snapshot.");
      return;
    }

    const payload = voicePromptSnapshot.payload || buildVoiceRequestPayload(voiceDesignProfile);
    const record = {
      status: "voice_design_saved",
      savedAt: new Date().toISOString(),
      model: payload.model,
      mode: payload.mode,
      provider: voiceProvider,
      voiceInstruction: voicePromptSnapshot.instruct || voicePromptSnapshot.prompt || "",
      sampleText: voicePromptSnapshot.sampleText || voicePromptSnapshot.text || payload.text,
      voiceDesign: payload.voiceDesign,
      accentDialect: payload.accentDialect,
      promptSnapshot: voicePromptSnapshot,
    };

    setQwenVoiceDesignRecord(record);
    setVoicePackRecord(record);
    setMessage("Reusable voice design profile saved from the generated prompt snapshot.");
  }

  async function copyGeneratedVoicePrompt() {
    if (!voicePromptSnapshot) {
      setError("No generated voice prompt yet. Click Generate Voice Options first.");
      return;
    }

    const text = JSON.stringify(voicePromptSnapshot.payload || voicePromptSnapshot, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Generated voice prompt/config copied.");
    } catch {
      setError("Could not copy generated prompt/config.");
    }
  }

  function generateQwenVoiceDesignCandidates() {
    const payload = buildVoiceRequestPayload(voiceDesignProfile);
    const baseInstruction = String(payload.instruct || payload.prompt || "").trim();
    const previewText = voiceDesignProfile.sampleText?.trim() || QWEN_PREVIEW_LINES.neutral_standard;

    if (!baseInstruction) {
      setError("No voice prompt was generated. Check the selected voice model and required fields.");
      return;
    }

    const generatedAt = new Date().toISOString();
    const promptPayload = {
      ...payload,
      provider: voiceProvider,
      generatedAt,
    };

    const promptSnapshot = {
      generatedAt,
      provider: voiceProvider,
      model: promptPayload.model,
      mode: promptPayload.mode,
      instruct: baseInstruction,
      prompt: String(promptPayload.prompt || ""),
      text: previewText,
      sampleText: previewText,
      voiceDesign: promptPayload.voiceDesign,
      accentDialect: promptPayload.accentDialect,
      payload: promptPayload,
    };

    const candidateCount = qwenVoiceDesign.candidateCount === 5 ? 5 : 3;
    const candidates = Array.from({ length: candidateCount }, (_unused, index) => ({
      candidateId: `candidate_${String(index + 1).padStart(2, "0")}`,
      label: `Voice Option ${index + 1}`,
      previewText,
      baseInstruction,
      variantInstruction: "",
      fullInstruction: baseInstruction,
    }));

    setVoicePromptSnapshot(promptSnapshot);
    setQwenVoiceCandidates(candidates);
    setSelectedQwenVoiceCandidateId(candidates[0]?.candidateId || "");
    setQwenVoiceDesignRecord(null);
    setVoicePackCreated(false);
    setVoicePackRecord(null);
    setVoicePreview(null);
    setBuilderCharacterVoiceProfile(null);
    setError("");
    setMessage(`Generated a clean ${voiceDesignProfile.model === "qwen3tts" ? "Qwen3-TTS" : "CosyVoice"} prompt snapshot. Pick one option, then click Create Voice.`);
  }

  function selectQwenVoiceCandidate(candidate: QwenVoiceCandidateInstruction) {
    const activePayload = voicePromptSnapshot?.payload || voiceDesignPayload;
    const record = {
      ...qwenVoiceDesignStorageRecord(qwenVoiceDesign, candidate),
      model: activePayload.model,
      mode: activePayload.mode,
      voiceInstruction: candidate.fullInstruction,
      sampleText: candidate.previewText,
      voiceDesign: activePayload.voiceDesign,
      accentDialect: activePayload.accentDialect,
      promptSnapshot: voicePromptSnapshot,
    };

    setSelectedQwenVoiceCandidateId(candidate.candidateId);
    setQwenVoiceDesignRecord(record);
    setVoicePackCreated(false);
    setVoicePackRecord(null);
    setVoicePreview(null);
    setBuilderCharacterVoiceProfile(null);
    setMessage(`${candidate.label} selected. Click Create Voice to generate this exact prompt.`);
  }

  async function describeClothingAccessories() {
    const imagePath = characterCard?.serverPath || selectedFullBody?.serverPath || "";
    if (!imagePath) {
      setError("Create a character card or select a full-body character image before using Auto Describe.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("Running Ollama Vision on the character card...");
    try {
      const response = await fetch("/api/vision-prompt", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({
          imagePath,
          purpose: "character_details",
          characterName: details.name.trim(),
          promptHint: "Only describe visible clothing, armor, footwear, accessories, props, skin/fur/surface texture, hair/fur color, eye color, colors, and materials. Do not infer or overwrite age, species, gender, height, build, name, or story.",
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok || !json) {
        throw new Error(json?.error || "Ollama Vision description failed (" + response.status + ").");
      }

      const visionDetails = json.details || {};
      const descriptor = String(json.descriptor || "").trim();

      const clothing = cleanVisionDescriptor(String(visionDetails.clothingAccessories || descriptor || ""));
      if (!clothing) {
        throw new Error("Ollama Vision returned an empty clothing/accessory description.");
      }

      setDetails((current) => ({
        ...current,
        clothingAccessories: clothing,
        surfaceDescription: current.surfaceDescription.trim() || cleanVisionDescriptor(String(visionDetails.surfaceDescription || "")),
        hairFurColor: current.hairFurColor.trim() || cleanVisionDescriptor(String(visionDetails.hairFurColor || "")),
        eyeColor: current.eyeColor.trim() || cleanVisionDescriptor(String(visionDetails.eyeColor || "")),
      }));

      setMessage("Auto Describe completed. Review the clothing/accessories field before continuing.");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  function buildVoiceFxPipelinePayload() {
    return {
      inputPath: builderCharacterVoiceProfile?.baseSamplePath || rawVoicePreviewPath,
      sourceSampleUrl: builderCharacterVoiceProfile?.baseSampleUrl || rawVoicePreviewUrl,

      // Keep both names because older adapter paths may read either preset or fxPreset.
      preset: voiceFx.preset,
      fxPreset: voiceFx.preset,

      pitchSemitones: voiceFx.pitchSemitones,
      speed: voiceFx.speed,
      gainDb: voiceFx.gainDb,
      highpassHz: voiceFx.highpassHz,
      lowpassHz: voiceFx.lowpassHz,
      echo: voiceFx.echo,
      normalize: voiceFx.normalize,

      tonePreset: voiceFx.tonePreset || "neutral",
      bodyMode: voiceFx.bodyMode || "normal",
      gritAmount: voiceFx.gritAmount || 0,
      compression: voiceFx.compression || "off",
      layerMode: voiceFx.layerMode || "off",
      layerMix: voiceFx.layerMix || 0,
      simpleControls: simpleVoiceFx,
      advancedPresetId: selectedVoiceFxPreset.id,
      advancedPresetName: selectedVoiceFxPreset.name,
      advancedPresetCategory: selectedVoiceFxPreset.category,
      advancedPresetDescription: selectedVoiceFxPreset.description,
      effectChain: selectedVoiceFxPreset.chain,
    };
  }
  async function queueCharacterVoicePipelineAction(action: CharacterVoicePipelineAction, extraInput: Record<string, unknown> = {}) {
    const characterId = safeId(details.name);

    if (!details.name.trim() || !characterId) {
      setError("Character name is required before queueing voice pipeline jobs.");
      showBuilderStepIfEditable("details");
      setVoicePipelineJobs((current) => ({
        ...current,
        [action]: { phase: "error", error: "Missing characterId. Add a character name first." },
      }));
      return;
    }

    if (action === "create_voice_sample") {
      if (!voicePromptSnapshot || !selectedQwenVoiceCandidate) {
        const message = "Generate Voice Options first before Create Voice.";
        setError(message);
        setVoicePipelineJobs((current) => ({
          ...current,
          [action]: { phase: "error", error: message },
        }));
        return;
      }
    }

    if (action === "generate_training_dataset" && !indexTts2TrainingDatasetAvailable) {
      const message = indexTts2TrainingDatasetBlockedMessage;
      setError(message);
      setVoicePipelineJobs((current) => ({
        ...current,
        [action]: { phase: "error", error: message },
      }));
      return;
    }

    if ((action === "generate_training_dataset" || action === "start_applio_training") && !lockedTrainingVoiceUrl) {
      const message = "Create, upload, or approve a voice before starting training.";
      setError(message);
      setVoicePipelineJobs((current) => ({
        ...current,
        [action]: { phase: "error", error: message },
      }));
      return;
    }

    if (
      (action === "generate_training_dataset" || action === "start_applio_training") &&
      !lockedTrainingVoicePath &&
      !isVoiceSampleFileUrl(lockedTrainingVoiceUrl)
    ) {
      const message = "The selected voice is not locked to a local character voice sample yet. Recreate or re-upload the voice before training.";
      setError(message);
      setVoicePipelineJobs((current) => ({
        ...current,
        [action]: { phase: "error", error: message },
      }));
      return;
    }

    if (action === "test_trained_voice") {
      const message = !trainedVoiceReady
        ? "A verified real trained Applio model and index are required before testing the trained voice."
        : !trainedVoiceInputAudioPath
          ? "A local approved input voice sample is required for trained model playback."
          : "";

      if (message) {
        setError(message);
        setVoicePipelineJobs((current) => ({
          ...current,
          [action]: { phase: "error", error: message },
        }));
        return;
      }
    }

    if (action === "generate_character_preview") {
      const message = !trainedVoiceReady
        ? "Train the voice model before generating the character preview."
        : !characterPreviewSourceImagePath
          ? "Character source image is missing. Cannot generate preview."
          : "";

      if (message) {
        setError(message);
        setVoicePipelineJobs((current) => ({
          ...current,
          [action]: { phase: "error", error: message },
        }));
        return;
      }
    }

    const activeGeneratedVoicePayload: Record<string, any> | null =
      action === "create_voice_sample" && voicePromptSnapshot?.payload && typeof voicePromptSnapshot.payload === "object"
        ? voicePromptSnapshot.payload as Record<string, any>
        : null;

    const selectedGeneratedVoiceInstruction =
      selectedQwenVoiceCandidate?.fullInstruction ||
      String(qwenVoiceDesignRecord?.voiceInstruction || activeGeneratedVoicePayload?.instruct || activeGeneratedVoicePayload?.prompt || "");

    const selectedGeneratedSampleText =
      selectedQwenVoiceCandidate?.previewText ||
      String(qwenVoiceDesignRecord?.sampleText || voicePromptSnapshot?.sampleText || activeGeneratedVoicePayload?.text || qwenSamplePhrase);
    const createVoiceRequestSeed =
      action === "create_voice_sample"
        ? Math.floor(Math.random() * 2147483647) + 1
        : undefined;

    setError("");
    setMessage(action === "create_voice_sample" ? "Voice creating started." : `Submitting ${action.replace(/_/g, " ")} job...`);
    setVoicePipelineJobs((current) => ({
      ...current,
      [action]: { phase: "submitting", error: undefined },
    }));

    try {
      const job = await queueCharacterVoiceJob({
        action,
        characterId,
        provider: voiceProvider,
        fxPreset: voiceFx.preset,
        trainingPreset: "balanced",
        testText: voiceTestText,
        rawVoicePreviewPath,
        tunedVoicePreviewPath,
        selectedReferencePath: selectedIndexVoiceReference?.audioPath || "",
        selectedCandidateId: selectedQwenVoiceCandidate?.candidateId || "",
        voiceInstruction: action === "create_voice_sample" ? selectedGeneratedVoiceInstruction : undefined,
        sampleText: action === "create_voice_sample" ? selectedGeneratedSampleText : undefined,
        previewText: action === "create_voice_sample" ? selectedGeneratedSampleText : undefined,
        voiceDesign: action === "create_voice_sample" ? activeGeneratedVoicePayload?.voiceDesign : undefined,
        modelConfig: action === "create_voice_sample" ? activeGeneratedVoicePayload : undefined,
        seed: action === "create_voice_sample" ? createVoiceRequestSeed : undefined,
        requestSeed: action === "create_voice_sample" ? createVoiceRequestSeed : undefined,
        qwenVoiceDesignRecord:
          action === "create_voice_sample"
            ? (qwenVoiceDesignRecord || (selectedQwenVoiceCandidate ? {
                ...qwenVoiceDesignStorageRecord(qwenVoiceDesign, selectedQwenVoiceCandidate),
                model: activeGeneratedVoicePayload?.model,
                mode: activeGeneratedVoicePayload?.mode,
                voiceInstruction: selectedGeneratedVoiceInstruction,
                sampleText: selectedGeneratedSampleText,
                voiceDesign: activeGeneratedVoicePayload?.voiceDesign,
                accentDialect: activeGeneratedVoicePayload?.accentDialect,
                promptSnapshot: voicePromptSnapshot,
              } : null))
            : undefined,
        ...((action === "generate_training_dataset" || action === "start_applio_training") ? approvedVoiceSourceInput : {}),
        ...(action === "test_trained_voice" ? {
          trainedArtifactId: usableTrainedVoiceArtifact?.id || "",
          voiceModelArtifactId: usableTrainedVoiceArtifact?.id || "",
          trainedArtifactMock: usableTrainedVoiceArtifact?.mock,
          trainedAdapter: usableTrainedVoiceArtifact?.adapter || "",
          trainedModelPath,
          trainedIndexPath,
          inputAudioPath: trainedVoiceInputAudioPath,
          inputAudioUrl: trainedVoiceInputAudioUrl,
          text: voiceTestText,
        } : {}),
        ...(action === "generate_character_preview" ? {
          trainedArtifactId: usableTrainedVoiceArtifact?.id || "",
          voiceModelArtifactId: usableTrainedVoiceArtifact?.id || "",
          trainedArtifactMock: usableTrainedVoiceArtifact?.mock,
          trainedAdapter: usableTrainedVoiceArtifact?.adapter || "",
          trainedModelPath,
          trainedIndexPath,
          sourceImagePath: characterPreviewSourceImagePath,
          sourceImageUrl: characterPreviewSourceImageUrl,
          originalSourceImagePath: uploadedImage?.serverPath || "",
          fullBodyImagePath: selectedFullBody?.serverPath || "",
          previewScript: CHARACTER_PREVIEW_DUB_SCRIPT,
        } : {}),
        ...(action === "apply_voice_fx" ? { ...buildVoiceFxPipelinePayload(), ...extraInput } : extraInput),
      });

      setVoicePipelineJobs((current) => ({
        ...current,
        [action]: { phase: "queued", job, error: undefined },
      }));

      if (action === "apply_voice_fx") {
        try {
          const ticked = await tickVoicePipelineWorker(1, job.jobId);
          const tickedCurrentJob = ticked.jobs.find((item) => item.jobId === job.jobId);
          const latest = tickedCurrentJob || (await getCharacterVoiceJob(job.jobId));

          setVoicePipelineJobs((current) => ({
            ...current,
            [action]: {
              phase: latest.status === "failed" ? "error" : "queued",
              job: latest,
              error: latest.error || undefined,
            },
          }));

          if (latest.status === "completed") {
            setVoiceFxStatus("Applied");
            setMessage("Voice FX processed. Tuned voice ready.");
          } else if (latest.status === "failed") {
            setVoiceFxStatus("Error");
            setError(latest.error || "Voice FX failed.");
          } else {
            setMessage(`Queued job: ${job.jobId}. Voice FX worker started.`);
          }
        } catch (tickError: any) {
          setMessage(`Queued job: ${job.jobId}. Waiting for worker.`);
        }
      } else if (action === "create_voice_sample") {
        setMessage("Voice creating started.");
      } else {
        setMessage(`Queued job: ${job.jobId}. Waiting for worker.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not queue voice pipeline job.";
      setVoicePipelineJobs((current) => ({
        ...current,
        [action]: { phase: "error", error: message },
      }));
      if (action === "apply_voice_fx") setVoiceFxStatus("Error");
      setError(message);
    }
  }

  async function updateLongRunningVoiceJob(action: CharacterVoicePipelineAction, jobAction: "stop" | "resume" | "terminate" | "complete_dataset") {
    const job = voicePipelineJobs[action]?.job;
    if (!job?.jobId) return;

    setError("");
    setMessage(
      jobAction === "stop"
        ? "Stopping voice job..."
        : jobAction === "terminate"
          ? "Terminating voice job..."
          : jobAction === "complete_dataset"
            ? "Completing dataset..."
            : "Resuming voice job...",
    );
    try {
      const updated = await updateCharacterVoiceJob(job.jobId, jobAction);
      if (jobAction === "complete_dataset" && action === "generate_training_dataset") {
        const result = updated.result && typeof updated.result === "object" && !Array.isArray(updated.result)
          ? updated.result as Record<string, unknown>
          : {};
        setBuilderCharacterVoiceProfile((current) => ({
          ...(current || {}),
          datasetManifestPath: String(result.datasetManifestPath || result.manifestPath || ""),
          datasetManifestUrl: String(result.datasetManifestUrl || result.manifestUrl || ""),
          sourceDatasetJobId: updated.jobId,
          datasetStatus: "completed",
          datasetCompletedAt: new Date().toISOString(),
        } as CharacterVoiceProfile));
      }
      setVoicePipelineJobs((current) => ({
        ...current,
        [action]: {
          phase: isTerminalJobStatus(updated.status) ? "queued" : "polling",
          job: updated,
          error: undefined,
        },
      }));
      setMessage(
        jobAction === "stop"
          ? "Voice job stopped. Resume is available."
          : jobAction === "terminate"
            ? "Voice job terminated. Start a new dataset when ready."
            : jobAction === "complete_dataset"
              ? "Dataset completed and locked. Train Voice Model is now available."
              : "Voice job resumed. Keep the worker running until complete.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : `Could not ${jobAction} voice job.`;
      setVoicePipelineJobs((current) => ({
        ...current,
        [action]: {
          ...(current[action] || { phase: "error" }),
          phase: "error",
          error: message,
        },
      }));
      setError(message);
    }
  }

  function voiceJobEffectiveStatus(job: any | null | undefined): string {
    if (!job?.status) return "idle";
    if (job.status !== "running") return job.status;
    const isDatasetJob = job.action === "generate_training_dataset";
    const result = job.result && typeof job.result === "object" && !Array.isArray(job.result)
      ? job.result as Record<string, unknown>
      : {};
    if (isDatasetJob && job.workerId === "local-voice-pipeline-worker") {
      const generated = Number(result.generatedClipCount || result.readyClipCount || 0);
      return generated > 0 ? "interrupted" : "queued";
    }
    if (!job.workerId || !job.claimedAt || !job.heartbeatAt) {
      const generated = Number(result.generatedClipCount || result.readyClipCount || 0);
      return generated > 0 ? "interrupted" : "queued";
    }
    const leaseTime = job.leaseExpiresAt ? Date.parse(job.leaseExpiresAt) : NaN;
    if (Number.isFinite(leaseTime) && leaseTime <= Date.now()) return "interrupted";
    const heartbeatTime = Date.parse(String(job.heartbeatAt || job.updatedAt || ""));
    if (Number.isFinite(heartbeatTime) && heartbeatTime + 5 * 60 * 1000 <= Date.now()) return "interrupted";
    return job.status;
  }

  function renderLongRunningVoiceJobControls(action: "generate_training_dataset" | "start_applio_training" | "generate_character_preview") {
    const job = voicePipelineJobs[action]?.job;
    if (!job?.jobId) return null;

    const isDataset = action === "generate_training_dataset";
    const effectiveStatus = voiceJobEffectiveStatus(job);
    const canStop = !isDataset && (effectiveStatus === "queued" || effectiveStatus === "running");
    const canTerminate = effectiveStatus === "queued" || effectiveStatus === "running" || effectiveStatus === "interrupted" || effectiveStatus === "ready_for_review" || effectiveStatus === "failed" || effectiveStatus === "canceled";
    const canResume = effectiveStatus === "canceled" || effectiveStatus === "failed" || effectiveStatus === "interrupted";
    const canCompleteDataset = isDataset && effectiveStatus === "ready_for_review";
    if (!canStop && !canTerminate && !canResume && !canCompleteDataset) return null;

    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {canStop ? (
          <button
            type="button"
            onClick={() => void updateLongRunningVoiceJob(action, "stop")}
            className="rounded-lg border border-red-400/50 bg-red-400/10 px-3 py-2 text-xs font-bold text-red-100 hover:bg-red-400/20"
          >
            Stop
          </button>
        ) : null}
        {canTerminate ? (
          <button
            type="button"
            onClick={() => void updateLongRunningVoiceJob(action, "terminate")}
            className="rounded-lg border border-red-400/50 bg-red-400/10 px-3 py-2 text-xs font-bold text-red-100 hover:bg-red-400/20"
          >
            Terminate
          </button>
        ) : null}
        {canResume ? (
          <button
            type="button"
            onClick={() => void updateLongRunningVoiceJob(action, "resume")}
            className="rounded-lg border border-emerald-400/50 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100 hover:bg-emerald-400/20"
          >
            Resume
          </button>
        ) : null}
        {canCompleteDataset ? (
          <button
            type="button"
            onClick={() => void updateLongRunningVoiceJob(action, "complete_dataset")}
            className="rounded-lg border border-emerald-400/50 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100 hover:bg-emerald-400/20"
          >
            Complete Dataset
          </button>
        ) : null}
      </div>
    );
  }

  function renderVoicePipelineJobStatus(action: CharacterVoicePipelineAction) {
    const state = voicePipelineJobs[action] || { phase: "idle" as const };
    const job = state.job;
    const progress = Math.max(0, Math.min(100, typeof job?.progress === "number" ? job.progress : 0));
    const result = job?.result && typeof job.result === "object" && !Array.isArray(job.result)
      ? job.result as Record<string, unknown>
      : null;
    const trainedPlayback = action === "test_trained_voice" ? getTrainedVoicePlaybackSelection(job) : null;
    const basePlayback = action === "test_character_voice" ? getBaseVoicePlaybackSelection(job) : null;
    const characterPreview = action === "generate_character_preview" ? getCharacterPreviewDubSelection(job) : null;
    const audioUrl =
      action === "test_trained_voice"
        ? trainedPlayback?.audioSrc || ""
        : action === "test_character_voice"
          ? basePlayback?.audioSrc || ""
        : result
          ? String(result.outputAudioUrl || result.processedSampleUrl || result.fxSampleUrl || result.previewAudioUrl || result.sampleUrl || "").trim()
          : "";
    const videoUrl = action === "generate_character_preview"
      ? (() => {
          if (!job) return "";

          const explicitUrl = String(
            result?.rawPreviewVideoUrl ||
              result?.rawPreviewUrl ||
              result?.originalPreviewVideoUrl ||
              ""
          ).trim();

          if (explicitUrl) return explicitUrl;

          const owner = String(job.ownerKey || "").trim();
          const characterId = String(job.characterId || details.name || "").trim();
          const jobId = String(job.jobId || "").trim();

          if (!owner || !characterId || !jobId) return "";

          const version = String(
            result?.rawPreviewBytes ||
              result?.rawPreviewVideoBytes ||
              job.updatedAt ||
              jobId
          );

          return `/api/characters/character-preview/file?owner=${encodeURIComponent(owner)}&characterId=${encodeURIComponent(characterId)}&jobId=${encodeURIComponent(jobId)}&file=raw-preview.mp4&v=${encodeURIComponent(version)}`;
        })()
      : "";
    const resultEntries =
      result
        ? Object.entries(result)
        : [];
    const completed = job?.status === "completed";
    const effectiveStatus = voiceJobEffectiveStatus(job);
    const datasetGeneratedCount = action === "generate_training_dataset" ? Number(result?.generatedClipCount || 0) : 0;
    const datasetRequestedCount = action === "generate_training_dataset" ? Math.max(1, Number(result?.requestedClipCount || result?.clipCount || job?.input?.requestedClipCount || job?.input?.clipCount || 200)) : 0;
    const displayProgress = action === "generate_training_dataset" && job
      ? Math.max(0, Math.min(100, Math.round((datasetGeneratedCount / datasetRequestedCount) * 100)))
      : progress;
    const isMockResult = Boolean(result && result.mock !== false);
    const labels: Record<CharacterVoicePipelineAction, Partial<Record<string, string>> & { idle: string; title: string }> = {
      create_voice_sample: {
        title: "Base voice",
        idle: "No voice creation job yet.",
        queued: "Waiting for Windows voice worker...",
        running: "Voice creating...",
        completed: isMockResult ? "Voice creation failed - real worker required" : "Voice ready",
        failed: "Voice creation failed",
        canceled: "Voice creation canceled",
      },
      apply_voice_fx: {
        title: "Voice effects",
        idle: "No voice effects job yet.",
        queued: "Waiting to start effects...",
        running: "Applying voice effects...",
        completed: "Tuned voice ready",
        failed: "Voice effects failed",
        canceled: "Voice effects canceled",
      },
      generate_training_dataset: {
        title: "Training dataset",
        idle: "No dataset job yet.",
        queued: "Queued / waiting for Windows worker",
        running: "Dataset running",
        interrupted: "Dataset interrupted - resume available",
        ready_for_review: "Dataset ready for review",
        completed: "Dataset completed",
        failed: "Dataset failed",
        canceled: "Dataset canceled",
        terminated: "Dataset terminated",
      },
      start_applio_training: {
        title: "Voice model training",
        idle: "No training job yet.",
        queued: "Voice model training queued",
        running: "Voice model training running",
        interrupted: "Voice model training interrupted - resume available",
        ready_for_review: "Voice model training ready for review",
        completed: "Voice model training completed",
        failed: "Voice model training failed",
        canceled: "Voice model training canceled",
        terminated: "Voice model training terminated",
      },
      test_character_voice: {
        title: "Test playback",
        idle: "No test playback job yet.",
        queued: "Test playback queued",
        running: "Generating test playback...",
        completed: "Test playback completed",
        failed: "Test playback failed",
        canceled: "Test playback canceled",
      },
      test_trained_voice: {
        title: "Trained model playback",
        idle: "No trained model playback job yet.",
        queued: "Trained voice test queued",
        running: "Running trained Applio inference...",
        completed: "Trained voice playback ready",
        failed: "Trained voice playback failed",
        canceled: "Trained voice playback canceled",
      },
      generate_preview_video: {
        title: "Preview video",
        idle: "No preview job yet.",
        queued: "Preview queued",
        running: "Generating preview...",
        completed: "Preview completed",
        failed: "Preview failed",
        canceled: "Preview canceled",
      },
      dub_preview_video: {
        title: "Preview dub",
        idle: "No dub job yet.",
        queued: "Dub queued",
        running: "Generating dub...",
        completed: "Dub completed",
        failed: "Dub failed",
        canceled: "Dub canceled",
      },
      generate_character_preview: {
        title: "Character preview dub",
        idle: "No character preview job yet.",
        queued: "Waiting for Windows character preview worker",
        running: "Generating character preview dub...",
        interrupted: "Character preview interrupted - resume available",
        completed: characterPreview ? "Character preview ready" : "Character preview output missing",
        failed: "Character preview failed",
        canceled: "Character preview canceled",
        terminated: "Character preview terminated",
      },
      save_voice_to_character: {
        title: "Save voice",
        idle: "No save job yet.",
        queued: "Save queued",
        running: "Saving voice...",
        completed: "Voice saved",
        failed: "Save failed",
        canceled: "Save canceled",
      },
    };
    const labelSet = labels[action];
    const statusText = (() => {
      if (state.phase === "submitting") return action === "create_voice_sample" ? "Voice creating started." : "Submitting job...";
      if (!job) return labelSet.idle;
      return labelSet[effectiveStatus] || effectiveStatus;
    })();
    const trainingDetailSource = action === "start_applio_training" ? { ...(job?.input || {}), ...(result || {}) } : null;
    const trainingDetails = trainingDetailSource ? {
      preset: String(trainingDetailSource.trainingQualityPreset || ""),
      epochs: String(trainingDetailSource.epochs || ""),
      saveEveryEpoch: String(trainingDetailSource.saveEveryEpoch || ""),
      estimate: String(trainingDetailSource.estimatedDurationLabel || ""),
      currentStage: String(trainingDetailSource.currentStage || ""),
      elapsed: String(trainingDetailSource.elapsedTrainingLabel || trainingDetailSource.totalTrainingLabel || ""),
      stageElapsed: String(trainingDetailSource.currentStageElapsedLabel || ""),
      currentEpoch: String(trainingDetailSource.currentEpoch || ""),
      totalEpochs: String(trainingDetailSource.totalEpochs || trainingDetailSource.epochs || ""),
      epochProgressPercent: String(trainingDetailSource.epochProgressPercent || ""),
      estimatedCompletionAt: String(trainingDetailSource.estimatedCompletionAt || ""),
      completedAt: String(trainingDetailSource.trainingCompletedAt || ""),
      failedStage: String(trainingDetailSource.failedStage || ""),
    } : null;

    return (
      <div className="mt-3 rounded-xl border border-zinc-800 bg-black/20 p-3 text-xs leading-5 text-zinc-400">
        <div className="flex items-center justify-between gap-3">
          <div className="font-semibold text-zinc-200">{labelSet.title}</div>
          {job ? <div className="uppercase tracking-[0.16em] text-zinc-500">{effectiveStatus}</div> : null}
        </div>
        <div className={classNames("mt-1 font-semibold", effectiveStatus === "failed" ? "text-red-300" : effectiveStatus === "completed" ? "text-emerald-200" : effectiveStatus === "interrupted" ? "text-amber-200" : "text-zinc-200")}>{statusText}</div>
        {job ? (
          <>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={classNames("h-full rounded-full transition-all", effectiveStatus === "failed" ? "bg-red-400" : effectiveStatus === "completed" ? "bg-emerald-300" : effectiveStatus === "interrupted" ? "bg-orange-300" : "bg-amber-300")}
                style={{ width: `${effectiveStatus === "queued" ? Math.max(4, displayProgress) : displayProgress}%` }}
              />
            </div>
            {action === "generate_training_dataset" ? (
              <div className="mt-1">Progress: {displayProgress}% ({datasetGeneratedCount} / {datasetRequestedCount} clips)</div>
            ) : typeof job.progress === "number" ? (
              <div className="mt-1">Progress: {progress}%</div>
            ) : null}
            {trainingDetails ? (
              <div className="mt-3 grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-zinc-300 sm:grid-cols-2">
                {trainingDetails.preset ? <div>Preset: {trainingDetails.preset}</div> : null}
                {trainingDetails.epochs ? <div>Epochs: {trainingDetails.epochs}</div> : null}
                {trainingDetails.saveEveryEpoch ? <div>Save every epoch: {trainingDetails.saveEveryEpoch}</div> : null}
                {trainingDetails.estimate ? <div>Estimated duration: {trainingDetails.estimate}</div> : null}
                {trainingDetails.currentStage ? <div>Current stage: {trainingDetails.currentStage}</div> : null}
                {trainingDetails.elapsed ? <div>Elapsed: {trainingDetails.elapsed}</div> : null}
                {trainingDetails.stageElapsed ? <div>Stage elapsed: {trainingDetails.stageElapsed}</div> : null}
                {trainingDetails.currentEpoch ? <div>Epoch: {trainingDetails.currentEpoch}/{trainingDetails.totalEpochs || "?"}</div> : null}
                {trainingDetails.epochProgressPercent ? <div>Epoch progress: {trainingDetails.epochProgressPercent}%</div> : null}
                {trainingDetails.estimatedCompletionAt ? <div className="break-all">ETA: {trainingDetails.estimatedCompletionAt}</div> : null}
                {trainingDetails.completedAt ? <div className="break-all">Completed: {trainingDetails.completedAt}</div> : null}
                {trainingDetails.failedStage ? <div>Failed stage: {trainingDetails.failedStage}</div> : null}
                {effectiveStatus === "running" && !trainingDetails.currentEpoch ? (
                  <div className="sm:col-span-2 text-zinc-500">Completion estimate updates when epoch progress is available.</div>
                ) : null}
              </div>
            ) : null}

            {completed ? (
              <div className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-emerald-100">
                <div className="font-semibold">{statusText}</div>
                {action === "create_voice_sample" && isMockResult ? (
                  <div className="mt-1 text-emerald-100/80">Rejected mock result - real Qwen3/Cosy worker was not used for this job.</div>
                ) : null}
                {audioUrl ? (
                  <audio
                    key={trainedPlayback ? trainedPlayback.audioKey : basePlayback ? basePlayback.audioKey : audioUrl}
                    controls
                    preload="metadata"
                    src={audioUrl}
                    className="mt-3 w-full"
                  />
                ) : videoUrl ? (
                  <>
                    {action === "generate_character_preview" ? (
                      <div className="mt-3 text-xs font-semibold text-emerald-100">Original preview before dub</div>
                    ) : null}
                    <video
                      key={action === "generate_character_preview" ? `original-${videoUrl}` : characterPreview ? characterPreview.videoKey : videoUrl}
                      controls
                      preload="metadata"
                      src={videoUrl}
                      className={action === "generate_character_preview" ? "mt-2 w-full rounded-lg bg-black" : "mt-3 w-full rounded-lg bg-black"}
                    />
                                  </>
                ) : action === "test_trained_voice" ? (
                  <div className="mt-2 text-emerald-100/70">No trained playback audio generated yet.</div>
                ) : action === "test_character_voice" ? (
                  <div className="mt-2 text-emerald-100/70">Base test playback is not available yet.</div>
                ) : action === "generate_character_preview" ? (
                  <div className="mt-2 text-emerald-100/70">No valid dubbed preview video generated yet.</div>
                ) : null}
                {resultEntries.length ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-emerald-100/80">Technical details</summary>
                  <div className="mt-2 space-y-1">
                    {resultEntries.map(([key, value]) => (
                      <div key={key} className="break-all">
                        <span className="font-semibold">{key}:</span> {String(value)}
                      </div>
                    ))}
                  </div>
                  </details>
                ) : (
                  <div className="mt-2 text-emerald-100/70">No mock artifact URL returned.</div>
                )}
              </div>
            ) : (
              <details className="mt-2">
                <summary className="cursor-pointer text-zinc-500">Technical details</summary>
                <div className="mt-2 break-all">Queued job: {job.jobId}</div>
                {job.message ? <div className="break-all">Message: {job.message}</div> : null}
                {job.error ? <div className="break-all text-red-300">Error: {job.error}</div> : null}
              </details>
            )}
            {(action === "generate_training_dataset" || action === "start_applio_training" || action === "generate_character_preview") ? renderLongRunningVoiceJobControls(action) : null}
          </>
        ) : state.phase === "idle" ? (
          <div>{labelSet.idle}</div>
        ) : null}
        {state.error ? <div className="text-red-300">Error: {state.error}</div> : null}
      </div>
    );
  }

  async function createVoicePack() {
    if (!details.name.trim()) {
      setError("Character name is required before creating a voice pack.");
      showBuilderStepIfEditable("details");
      return;
    }

    if (!selectedQwenVoiceCandidate) {
      setError("Generate Qwen voice design options and select one before creating the voice.");
      return;
    }

    const designRecord = qwenVoiceDesignRecord || qwenVoiceDesignStorageRecord(qwenVoiceDesign, selectedQwenVoiceCandidate);

    setLoading(true);
    setError("");
    setMessage("Preparing Qwen voice design metadata...");
    try {
      const characterId = safeId(details.name);
      const response = await fetch("/api/characters/voice-pack", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({
          characterId,
          characterName: details.name.trim(),
          characterDetails: details,
          voiceSettings: {
            legacyVoiceSettings: voice,
            qwenVoiceDesign,
            qwenVoiceDesignRecord: designRecord,
          },
          previewLines: [
            {
              id: designRecord.selectedCandidateId,
              label: selectedQwenVoiceCandidate.label,
              text: selectedQwenVoiceCandidate.previewText,
            },
          ],
          selectedPreviewLineId: designRecord.selectedCandidateId,
          identityBlock,
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "Create Voice failed.");
      }

      setQwenVoiceDesignRecord(designRecord);
      setVoicePackCreated(true);
      setVoicePackRecord(json.voicePack || { status: "qwen_voice_design_metadata_only", qwenVoiceDesignRecord: designRecord });
      setMessage("Qwen voice design metadata saved. Real Qwen audio generation will be wired next.");
    } catch (err: any) {
      setVoicePackCreated(false);
      setVoicePackRecord(null);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function generateVoicePreview() {
    if (!details.name.trim()) {
      setError("Character name is required before generating a voice preview.");
      showBuilderStepIfEditable("details");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("Generating Qwen3-TTS voice preview...");
    try {
      const characterId = safeId(details.name);
      const response = await fetch("/api/characters/voice-preview", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({
          characterId,
          characterName: details.name.trim(),
          voiceSettings: {
            legacyVoiceSettings: voice,
            qwenVoiceDesign,
            qwenVoiceDesignRecord: qwenVoiceDesignRecord || (selectedQwenVoiceCandidate ? qwenVoiceDesignStorageRecord(qwenVoiceDesign, selectedQwenVoiceCandidate) : null),
          },
          candidateId: selectedQwenVoiceCandidate?.candidateId || "",
          text: selectedQwenVoiceCandidate?.previewText || PREVIEW_LINES[0].text,
          previewLineId: selectedQwenVoiceCandidate?.candidateId || PREVIEW_LINES[0].id,
          language: "english",
          dtype: "float16",
          emotionAlpha: 0.6,
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "Voice preview generation failed.");
      }

      setVoicePreview(json);
      setSelectedIndexVoiceReference((current: any) => current || buildIndexVoiceReference("raw_qwen_preview", json));
      setMessage("Voice preview generated. Listen before saving the character.");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  function setVoiceFxField<K extends keyof VoiceFxSettings>(key: K, value: VoiceFxSettings[K]) {
    setVoiceFx((current) => ({ ...current, [key]: value, preset: key === "preset" ? value as VoiceFxSettings["preset"] : "custom" }));
    setVoiceFxStatus("Ready");
    setVoiceFxPreview(null);
    setSelectedIndexVoiceReference((current: any) => current?.source === "tuned_voice_fx" ? null : current);
  }

  function setSimpleVoiceFxField<K extends keyof SimpleVoiceFxSettings>(key: K, value: SimpleVoiceFxSettings[K]) {
    setSimpleVoiceFx((current) => ({ ...current, [key]: value }));
    setVoiceFxStatus("Ready");
    setVoiceFxPreview(null);
    setSelectedIndexVoiceReference((current: any) => current?.source === "tuned_voice_fx" ? null : current);
  }

  function mapSimpleFxToVoiceFx(settings: SimpleVoiceFxSettings): VoiceFxSettings {
    const sizeOffset = Math.round((settings.voiceSize - 50) / 10);
    const intensity = Math.max(0, Math.min(100, settings.intensity));
    const roughness = Math.max(0, Math.min(100, settings.roughness));
    const typePitch =
      settings.voiceType === "Monster" || settings.voiceType === "Creature"
        ? -3
        : settings.voiceType === "Ghost"
          ? -1
          : settings.voiceType === "Alien"
            ? 1
            : 0;

    return {
      ...voiceFx,
      preset: "custom",
      pitchSemitones: Math.max(-12, Math.min(12, typePitch - sizeOffset)),
      speed: Number((1 + (settings.voiceSize < 35 ? 0.04 : settings.voiceSize > 70 ? -0.05 : 0)).toFixed(2)),
      gainDb: 0,
      highpassHz: settings.transmission === "Radio" ? 300 : settings.voiceType === "Ghost" ? 140 : 60,
      lowpassHz: settings.transmission === "Radio" ? 3400 : settings.transmission === "Broken" ? 6500 : 12000,
      echo: settings.space === "Cave" || settings.space === "Void" ? "cave" : settings.space === "Room" ? "room" : "off",
      normalize: true,
      tonePreset: settings.transmission === "Radio" ? "radio" : settings.voiceType === "Robot" ? "telephone" : settings.voiceType === "Monster" ? "dark" : "neutral",
      bodyMode: settings.voiceSize >= 80 ? "huge" : settings.voiceSize >= 62 ? "deeper" : settings.voiceSize <= 30 ? "lighter" : "normal",
      gritAmount: Math.round((roughness * 0.7) + (intensity * 0.2)),
      compression: intensity >= 70 ? "strong" : intensity >= 40 ? "medium" : "light",
      layerMode: settings.voiceType === "Robot" ? "robot_double" : settings.voiceType === "Ghost" ? "ghost_double" : settings.voiceType === "Monster" || settings.voiceType === "Creature" ? "monster_double" : "off",
      layerMix: Math.round(settings.voiceType === "Human" ? 0 : intensity * 0.45),
    };
  }

  function applySimpleFxToPayload() {
    setVoiceFx(mapSimpleFxToVoiceFx(simpleVoiceFx));
  }

  function applyVoiceFxPreset(preset: VoiceFxSettings["preset"]) {
    setVoiceFx(VOICE_FX_PRESETS[preset] || VOICE_FX_PRESETS.custom);
    setVoiceFxStatus("Ready");
    setVoiceFxPreview(null);
    setSelectedIndexVoiceReference((current: any) => current?.source === "tuned_voice_fx" ? null : current);
  }

  function applyAdvancedVoiceFxPreset(preset: VoiceFxPresetDefinition) {
    setVoiceFxPresetId(preset.id);
    setSimpleVoiceFx((current) => ({ ...current, ...preset.simpleControls }));
    const nextSimple = { ...simpleVoiceFx, ...preset.simpleControls } as SimpleVoiceFxSettings;
    setVoiceFx({
      ...mapSimpleFxToVoiceFx(nextSimple),
      preset:
        preset.id === "ghost"
          ? "ghost"
          : preset.id === "robot"
            ? "robotic"
            : preset.id === "radio_comms" || preset.id === "telephone"
              ? "radio"
              : preset.id === "zombie"
                ? "zombie"
                : preset.category === "Monsters" || preset.id === "dragon" || preset.id === "beast"
                  ? "monstrous"
                  : preset.id === "whisper"
                    ? "whisper"
                    : "custom",
    });
    setVoiceFxStatus("Ready");
    setVoiceFxPreview(null);
    setSelectedIndexVoiceReference((current: any) => current?.source === "tuned_voice_fx" ? null : current);
  }

  function previewVoiceFx(settings: Record<string, unknown>) {
    setVoiceFxStatus("Previewing...");
    setError("");
    window.setTimeout(() => {
      setVoiceFxStatus("Ready");
      setMessage(`FX preview hook is ready for the Windows worker. No audio was rendered yet. Settings: ${String(settings.mode || "voice_fx")}.`);
    }, 250);
  }

  function resetVoiceFx() {
    setSimpleVoiceFx(DEFAULT_SIMPLE_VOICE_FX);
    setVoiceFx(DEFAULT_VOICE_FX);
    setVoiceFxPresetCategory("Monsters");
    setVoiceFxPresetId("dragon");
    setVoiceFxChainOpen(false);
    setVoiceFxStatus("Ready");
    setVoiceFxPreview(null);
    setSelectedIndexVoiceReference((current: any) => current?.source === "tuned_voice_fx" ? null : current);
    setMessage("Voice FX reset.");
  }

  function renderVoiceFxParam(param: VoiceFxParam) {
    if (param.type === "toggle") {
      return (
        <label key={param.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-300">
          <span>{param.label}</span>
          <input type="checkbox" checked={Boolean(param.value)} readOnly className="accent-cyan-300" />
        </label>
      );
    }

    if (param.type === "select") {
      return (
        <label key={param.id} className="block text-xs text-zinc-300">
          <span className="mb-1 block text-zinc-500">{param.label}</span>
          <select value={String(param.value)} disabled className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-2 text-xs text-zinc-300">
            {(param.options || [String(param.value)]).map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
      );
    }

    return (
      <label key={param.id} className="block text-xs text-zinc-300">
        <span className="mb-1 flex items-center justify-between gap-2 text-zinc-500">
          <span>{param.label}</span>
          <span>{String(param.value)}{param.unit || ""}</span>
        </span>
        <input
          type="range"
          min={param.min ?? 0}
          max={param.max ?? 100}
          value={Number(param.value)}
          readOnly
          className="w-full accent-cyan-300"
        />
      </label>
    );
  }

  async function applyVoiceFx() {
    if (!details.name.trim()) {
      setError("Character name is required before applying Voice FX.");
      showBuilderStepIfEditable("details");
      return;
    }

    const inputPath = String(voicePreview?.audioPath || voicePreview?.outputPath || "").trim();

    if (!inputPath) {
      setError("Generate a Qwen audio preview before applying Voice FX.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("Applying Voice FX...");
    try {
      const characterId = safeId(details.name);
      const response = await fetch("/api/characters/voice-fx", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({
          characterId,
          candidateId: selectedQwenVoiceCandidate?.candidateId || "candidate",
          inputPath,
          preset: voiceFx.preset,
          pitchSemitones: voiceFx.pitchSemitones,
          speed: voiceFx.speed,
          gainDb: voiceFx.gainDb,
          highpassHz: voiceFx.highpassHz,
          lowpassHz: voiceFx.lowpassHz,
          echo: voiceFx.echo,
          normalize: voiceFx.normalize,
          tonePreset: voiceFx.tonePreset || "neutral",
          bodyMode: voiceFx.bodyMode || "normal",
          gritAmount: voiceFx.gritAmount || 0,
          compression: voiceFx.compression || "off",
          layerMode: voiceFx.layerMode || "off",
          layerMix: voiceFx.layerMix || 0,
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "Voice FX failed.");
      }

      setVoiceFxPreview(json);
      setSelectedIndexVoiceReference(buildIndexVoiceReference("tuned_voice_fx", json));
      setMessage("Voice FX applied. Compare the raw preview and tuned preview.");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  function buildIndexVoiceReference(source: "raw_qwen_preview" | "tuned_voice_fx", preview: any) {
    const audioPath = String(preview?.audioPath || preview?.outputPath || "").trim();
    const audioUrl = String(preview?.audioUrl || "").trim() || voiceFileUrlFor(audioPath);

    if (!audioPath) {
      return null;
    }

    return {
      source,
      engine: source === "tuned_voice_fx" ? "OTG Voice FX" : "Base Voice",
      characterId: safeId(details.name || "character"),
      candidateId: selectedQwenVoiceCandidate?.candidateId || "",
      selectedAt: new Date().toISOString(),
      audioPath,
      audioUrl,
      qwenVoiceDesign,
      qwenVoiceDesignRecord,
      voiceFx: source === "tuned_voice_fx" ? voiceFx : null,
      voiceFxPreview: source === "tuned_voice_fx" ? preview : null,
      rawVoicePreview: voicePreview || null,
    };
  }

  function approveRawPreviewAsIndexReference() {
    const characterId = safeId(details.name);
    const baseSampleUrl = String(builderCharacterVoiceProfile?.baseSampleUrl || rawVoicePreviewUrl || "").trim();
    const baseSamplePath = String(builderCharacterVoiceProfile?.baseSamplePath || rawVoicePreviewPath || "").trim();

    if (builderCharacterVoiceProfile?.mockResult && builderCharacterVoiceProfile.mockResult.mock !== false && !allowMockVoiceTraining) {
      setError("Mock output rejected. Start the real Qwen3/Cosy worker and click Create Voice again.");
      return;
    }

    if (!baseSampleUrl && !baseSamplePath) {
      setError("Create or upload a base voice before using the raw voice for training.");
      return;
    }

    const record = buildIndexVoiceReference("raw_qwen_preview", voicePreview) || {
      source: "raw_qwen_preview",
      engine: builderCharacterVoiceProfile?.provider === "uploaded" ? "Uploaded Voice" : "Base Voice",
      characterId,
      candidateId: selectedQwenVoiceCandidate?.candidateId || "",
      selectedAt: new Date().toISOString(),
      audioPath: baseSamplePath,
      audioUrl: baseSampleUrl || voiceFileUrlFor(baseSamplePath),
      qwenVoiceDesign,
      qwenVoiceDesignRecord,
      voiceFx: null,
      voiceFxPreview: null,
      rawVoicePreview: voicePreview || null,
    };

    if (!String(record.audioPath || "").trim() && !String(record.audioUrl || "").trim()) {
      setError("Raw voice selection failed because no usable audio path or URL was found.");
      return;
    }

    setSelectedIndexVoiceReference(record);
    setIndexVoicePack(null);
    setCharacter3dModel(null);

    const now = new Date().toISOString();
    const nextProfile: CharacterVoiceProfile = {
      ...(builderCharacterVoiceProfile || {
        characterId,
        provider: voiceProvider,
        status: "sample_ready",
        updatedAt: now,
      }),
      characterId,
      provider: builderCharacterVoiceProfile?.provider || voiceProvider,
      status: builderCharacterVoiceProfile?.status || "sample_ready",
      baseSampleUrl: baseSampleUrl || builderCharacterVoiceProfile?.baseSampleUrl,
      baseSamplePath: baseSamplePath || builderCharacterVoiceProfile?.baseSamplePath || undefined,
      approvedSampleUrl: baseSampleUrl || record.audioUrl,
      approvedSamplePath: baseSamplePath || record.audioPath || undefined,
      updatedAt: now,
    };

    void persistCharacterVoiceProfile(
      characterId,
      nextProfile,
      "Raw base sample approved on character profile.",
      "Raw base sample selected for training and will be saved with the character.",
      "Could not approve raw base sample on character profile.",
    );
  }
  function approveTunedPreviewAsIndexReference() {
    const record = buildIndexVoiceReference("tuned_voice_fx", voiceFxPreview);
    const characterId = safeId(details.name);
    const tunedSampleUrl =
      builderCharacterVoiceProfile?.tunedSampleUrl || tunedVoicePreviewUrl || latestVoiceFxSampleUrl;
    const tunedSamplePath =
      builderCharacterVoiceProfile?.tunedSamplePath || tunedVoicePreviewPath || latestVoiceFxSamplePath;
    const tunedSourceJobId =
      builderCharacterVoiceProfile?.tunedSourceJobId || latestCompletedVoiceFxJob?.jobId || "";
    const tunedFxPreset =
      (builderCharacterVoiceProfile?.tunedFxPreset ||
        latestCompletedVoiceFxResult?.fxPreset ||
        latestCompletedVoiceFxJob?.input?.fxPreset ||
        voiceFx.preset) as VoiceFxPreset;
    if (!record && !tunedSampleUrl) {
      setError("Apply Voice FX before using the tuned voice for training.");
      return;
    }

    if (record) setSelectedIndexVoiceReference(record);
    setIndexVoicePack(null);

    setCharacter3dModel(null);
    if (builderCharacterVoiceProfile?.characterId === characterId && tunedSampleUrl) {
      void persistCharacterVoiceProfile(
        characterId,
        {
          ...builderCharacterVoiceProfile,
          tunedSampleUrl,
          tunedSamplePath: tunedSamplePath || undefined,
          tunedFxPreset,
          tunedSourceJobId: tunedSourceJobId || undefined,
          approvedSampleUrl: tunedSampleUrl,
          approvedSamplePath: tunedSamplePath || undefined,
          updatedAt: new Date().toISOString(),
        },
        "Tuned voice sample approved on character profile.",
        "Tuned voice sample approved and will be saved with the character.",
        "Could not approve tuned voice sample on character profile.",
      );
      return;
    }
    setMessage("Tuned voice selected for training.");
  }

  async function uploadVoiceSample(file: File | null) {
    const characterId = safeId(details.name);
    if (!file) return;
    if (!details.name.trim() || !characterId) {
      setError("Character name is required before uploading a voice sample.");
      showBuilderStepIfEditable("details");
      return;
    }

    setError("");
    setVoiceUploadState({ phase: "uploading", fileName: file.name });
    setMessage("Uploading voice sample...");

    try {
      const form = new FormData();
      form.append("characterId", characterId);
      form.append("file", file);
      const response = await fetch("/api/characters/voice-sample/upload", {
        method: "POST",
        headers: { "x-otg-device-id": CHARACTER_DEVICE_ID },
        credentials: "omit",
        body: form,
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "Voice upload failed.");
      }

      const sampleUrl = String(json.sampleUrl || "").trim();
      const samplePath = String(json.samplePath || "").trim();
      if (!sampleUrl) throw new Error("Voice upload did not return a sample URL.");

      const now = new Date().toISOString();
      const profile = {
        characterId,
        provider: "uploaded" as const,
        status: "sample_ready" as const,
        baseSamplePath: samplePath || undefined,
        baseSampleUrl: sampleUrl,
        approvedSamplePath: samplePath || undefined,
        approvedSampleUrl: sampleUrl,
        sourceJobId: "uploaded_voice",
        mockResult: {
          provider: "uploaded",
          adapter: "uploaded_voice",
          mock: false,
          samplePath,
          sampleUrl,
          outputBytes: json.outputBytes,
          uploadId: json.uploadId,
        },
        updatedAt: now,
      };

      await persistCharacterVoiceProfile(
        characterId,
        profile,
        "Uploaded voice saved to character profile.",
        "Uploaded voice ready. It will be saved with the character profile when this character is saved.",
        "Could not save uploaded voice to character profile.",
      );
      setVoiceUploadState({ phase: "ready", fileName: file.name });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Voice upload failed.";
      setVoiceUploadState({ phase: "error", fileName: file.name, error: message });
      setError(message);
    }
  }


  function startVoiceLabForSavedCharacter(character: CharacterRecord) {
    const characterId = safeId(String(character.id || character.name || ""));
    const imagePath = String(character.imagePath || character.previewImagePath || "").trim();
    const cardPath = String(character.characterCardPath || "").trim();

    if (!characterId) {
      setError("Cannot add voice: saved character is missing an id/name.");
      return;
    }

    if (characterHasCustomVoice(character)) {
      setMessage(`${character.name || characterId} already has a voice. Add Voice is disabled for this character.`);
      return;
    }

    if (!imagePath) {
      setError("Cannot add voice: saved character is missing imagePath/previewImagePath.");
      return;
    }

    setError("");
    setGenerationPrompt("");
    setCandidates([]);
    setSelectedCandidateId("");
    setUploadedImage(null);
    setImageCompleteness("full_body");
    setMissingGuidance("");

    setSelectedFullBody({
      id: `${characterId}-saved-full-body`,
      label: `${character.name || characterId} saved image`,
      url: fileUrlFor(imagePath),
      serverPath: imagePath,
    });

    if (cardPath) {
      setCharacterCard({
        id: `${characterId}-saved-card`,
        label: `${character.name || characterId} saved character card`,
        url: fileUrlFor(cardPath),
        serverPath: cardPath,
      });
    } else {
      setCharacterCard(null);
    }

    setDetails((current) => ({
      ...DEFAULT_DETAILS,
      ...current,
      name: character.name || characterId,
      surfaceDescription: current.surfaceDescription || character.description || character.globalPromptIdentityBlock || "",
    }));

    setVoice(DEFAULT_VOICE);
    setVoiceProvider("qwen3");
    setVoiceDesignProfile(defaultVoiceDesignProfile());
    setQwenVoiceDesign(defaultQwenVoiceDesignInput());
    setQwenVoiceCandidates([]);
    setSelectedQwenVoiceCandidateId("");
    setQwenVoiceDesignRecord(null);
    setVoicePromptSnapshot(null);
    setVoicePackCreated(false);
    setVoicePackRecord(null);
    setVoicePreview(null);
    setVoiceFx(DEFAULT_VOICE_FX);
    setVoiceFxPreview(null);
    setSelectedIndexVoiceReference(null);
    setIndexVoicePack(null);
    setVoicePipelineJobs({});
    setBuilderCharacterVoiceProfile(null);
    setCharacter3dModel(null);

    setStep("voice");
    setVoiceLabPage("design");
    setLockedBuilderStepIndex(2);
    setLockedVoiceLabPageIndex(-1);
    setMessage(`Adding a custom voice for ${character.name || characterId}.`);
  }
  async function deleteSavedCharacter(character: CharacterRecord) {
    const id = safeId(String(character.id || character.name || ""));
    if (!id) {
      setError("Cannot delete character: missing character id.");
      return;
    }
    if (typeof window !== "undefined" && !window.confirm("Delete this character? This cannot be undone.")) return;

    setError("");
    setMessage(`Deleting ${character.name || id}...`);
    try {
      const response = await fetch("/api/characters", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({ action: "delete", id }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "Could not delete character.");
      }
      setCharacters(Array.isArray(json.items) ? json.items : []);
      setMessage("Character deleted.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not delete character.");
    }
  }

  async function generateIndexVoicePack() {
    if (!selectedIndexVoiceReference?.audioPath) {
      setError("Select a raw or tuned Index voice reference before generating the Index voice pack.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("Generating IndexTTS2 voice pack. This can take several minutes...");
    try {
      const characterId = safeId(details.name || "character");
      const response = await fetch("/api/characters/voice-pack", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({
          characterId,
          characterName: details.name || "",
          indexVoiceReference: selectedIndexVoiceReference,
          indexVoiceReferencePath: selectedIndexVoiceReference.audioPath,
          voiceSettings: {
            ...voice,
            qwenVoiceDesign,
            qwenVoiceDesignRecord,
          },
          characterDetails: details,
          identityBlock,
        }),
      });

      const json = await response.json().catch(() => null);

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "Index voice pack generation failed.");
      }

      setIndexVoicePack(json.voicePack || json);
      setMessage("Index voice pack generated. Review each style before saving the character.");
    } catch (error: any) {
      setError(error?.message || "Index voice pack generation failed.");
    } finally {
      setLoading(false);
    }
  }
  async function generateCharacter3dModel() {
    if (!details.name.trim()) {
      setError("Character name is required before generating a 3D model.");
      showBuilderStepIfEditable("details");
      return;
    }

    const imagePath = selectedFullBody?.serverPath || characterCard?.serverPath || "";

    if (!imagePath) {
      setError("Select a full-body image or create a character card before generating a 3D model.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("Generating TripoSplat 3D Model. This can take several minutes...");
    try {
      const characterId = safeId(details.name || "character");
      const response = await fetch("/api/characters/3d-model", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({
          characterId,
          imagePath,
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "3D model generation failed.");
      }

      setCharacter3dModel(json);
      setMessage("HY3D model generated. Open or download the GLB before saving.");
    } catch (error: any) {
      setError(error?.message || "3D model generation failed.");
    } finally {
      setLoading(false);
    }
  }


  async function completeCharacterCardOnly() {
    if (!details.name.trim()) {
      setError("Character Name is required before completing the character card.");
      showBuilderStepIfEditable("details");
      return;
    }

    if (!selectedFullBody?.serverPath || !characterCard?.serverPath) {
      setError("A selected full-body image and character card are required before completing without voice.");
      showBuilderStepIfEditable(!selectedFullBody?.serverPath ? "source" : "card");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const characterId = safeId(details.name);
      const response = await fetch("/api/characters", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({
          id: characterId,
          name: details.name.trim(),
          imagePath: characterCard.serverPath,
          previewImagePath: characterCard.serverPath,
          fullBodyImagePath: selectedFullBody.serverPath,
          characterCardPath: characterCard.serverPath,
          originalSourceImagePath: uploadedImage?.serverPath || selectedFullBody.serverPath,
          description: identityBlock,
          metadata: details,
          voiceSettings: voice,
          characterVoiceProfile: null,
          voicePackPaths: {},
          globalPromptIdentityBlock: identityBlock,
          voiceStyleDefinition: "",
          introLine: PREVIEW_LINES[0].text,
          source: "characters_tab_card_only",
          characterStatus: "card_complete",
          voiceStatus: "none",
          hasCustomVoice: false,
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "Could not complete character card.");
      }

      await loadCharacters();
      resetBuilder();
      setMessage("Character card saved without a custom voice. Use Add Voice from Saved Characters later.");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveCharacterCardOnly() {
    if (!details.name.trim()) {
      setError("Character Name is required before saving the character card.");
      showBuilderStepIfEditable("details");
      return;
    }

    if (!selectedFullBody?.serverPath || !characterCard?.serverPath) {
      setError("A selected full-body image and character card are required before saving card-only.");
      showBuilderStepIfEditable(!selectedFullBody?.serverPath ? "source" : "card");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const characterId = safeId(details.name);

      const response = await fetch("/api/characters", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({
          id: characterId,
          name: details.name.trim(),
          imagePath: characterCard.serverPath,
          previewImagePath: characterCard.serverPath,
          fullBodyImagePath: selectedFullBody.serverPath,
          characterCardPath: characterCard.serverPath,
          originalSourceImagePath: uploadedImage?.serverPath || selectedFullBody.serverPath,
          description: identityBlock,
          metadata: details,
          voiceSettings: voice,
          characterVoiceProfile: null,
          voicePackPaths: {},
          globalPromptIdentityBlock: identityBlock,
          voiceStyleDefinition: "",
          introLine: PREVIEW_LINES[0].text,
          source: "characters_tab_card_only",
          characterStatus: "card_complete",
          voiceStatus: "none",
          hasCustomVoice: false,

          character3dModel,
          character3dModelPath: character3dModel?.modelPath || "",
          character3dModelUrl: character3dModel?.modelUrl || "",
          character3dModelOutputPath: character3dModel?.outputPath || "",
          character3dModelEngine: character3dModel?.engine || "",
        }),
      });

      const json = await response.json().catch(() => null);

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "Could not save character card.");
      }

      setMessage("Character card saved. You can add a custom voice later from Saved Characters.");
      await loadCharacters();
      resetBuilder();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }
  async function saveCharacter() {
    if (!details.name.trim()) {
      setError("Character Name is required.");
      showBuilderStepIfEditable("details");
      return;
    }
    if (!selectedFullBody?.serverPath || !characterCard?.serverPath) {
      setError("A selected full-body image and character card are required.");
      return;
    }
    if (!voicePackCreated && !builderCharacterVoiceProfile?.baseSampleUrl) {
      setError("Create Voice is required before final save.");
      return;
    }
    const completedPreview = getCharacterPreviewDubSelection(voicePipelineJobs.generate_character_preview?.job);
    if (!completedPreview) {
      setError("Complete Character requires a valid dubbed preview video. Click Test & Preview Character first.");
      advanceToVoiceLabPage("preview");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const characterId = safeId(details.name);
      const voicePackPaths = Object.fromEntries(
        VOICE_PACK_EMOTIONS.map((emotion) => [emotion, `VoiceLab/characters/${characterId}/voice_pack/${emotion.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}.wav`]),
      );
      const characterVoiceProfile: CharacterVoiceProfile = builderCharacterVoiceProfile?.characterId === characterId ? builderCharacterVoiceProfile : {
        characterId,
        provider: voiceProvider,
        baseSamplePath: rawVoicePreviewPath || undefined,
        approvedSamplePath: selectedIndexVoiceReference?.audioPath || rawVoicePreviewPath || undefined,
        fxPreset: voiceFx.preset,
        fxSamplePath: tunedVoicePreviewPath || undefined,
        status: selectedIndexVoiceReference?.audioPath ? "needs_approval" : "draft",
        updatedAt: new Date().toISOString(),
      };
      const response = await fetch("/api/characters", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({
          id: characterId,
          name: details.name.trim(),
          imagePath: characterCard.serverPath,
          previewImagePath: characterCard.serverPath,
          fullBodyImagePath: selectedFullBody.serverPath,
          characterCardPath: characterCard.serverPath,
          originalSourceImagePath: uploadedImage?.serverPath || selectedFullBody.serverPath,
          description: identityBlock,
          metadata: details,
          voiceSettings: voice,
          characterVoiceProfile,
          characterPreviewDub: {
            jobId: completedPreview.job.jobId || "",
            dubbedPreviewVideoPath: completedPreview.dubbedPreviewVideoPath,
            dubbedPreviewVideoUrl: completedPreview.dubbedPreviewVideoUrl,
            outputBytes: completedPreview.outputBytes,
            previewScript: CHARACTER_PREVIEW_DUB_SCRIPT,
          },
          dubbedPreviewVideoPath: completedPreview.dubbedPreviewVideoPath,
          dubbedPreviewVideoUrl: completedPreview.dubbedPreviewVideoUrl,
          dubbedPreviewVideoBytes: completedPreview.outputBytes,
          voicePackPaths,
          indexVoiceReference: selectedIndexVoiceReference,
          indexVoiceReferencePath: selectedIndexVoiceReference?.audioPath || "",
          indexVoiceReferenceUrl: selectedIndexVoiceReference?.audioUrl || "",
          indexVoiceReferenceSource: selectedIndexVoiceReference?.source || "",
          indexVoicePack,
          indexVoicePackPath: indexVoicePack?.voicePackPath || "",

          character3dModel,
          character3dModelPath: character3dModel?.modelPath || "",
          character3dModelUrl: character3dModel?.modelUrl || "",
          character3dModelOutputPath: character3dModel?.outputPath || "",
          character3dModelEngine: character3dModel?.engine || "",
          voiceEngineUsed: "IndexTTS2 direct",
          voicePromptPresetMetadata: {
            previewLines: PREVIEW_LINES,
            defaultEngine: "IndexTTS2 direct",
            fixedPreviewLinesOnly: true,
            voiceDesignProfile,
            generatedVoiceConfig: voicePromptSnapshot?.payload || voiceDesignPayload,
            reusableVoiceProfile: qwenVoiceDesignRecord || null,
          },
          yellingPresetMetadata: {
            sourceExperimentClip: "yell_004_strained_lower_yell.wav",
            prompt: "strained lower-register yell, angry but controlled, boyish voice, rough breath, clear pronunciation",
            avoid: ["high-pitched scream", "shrill scream", "girl-like scream", "cartoon yell", "robotic distortion"],
          },
          globalPromptIdentityBlock: identityBlock,
          voiceStyleDefinition: `${voice.voiceAge} ${voice.genderExpression}, ${voice.pitch} pitch, ${voice.resonance} resonance, ${voice.energy} energy, ${voice.texture}, ${voice.personalityTone.join(" / ")}`,
          introLine: PREVIEW_LINES[0].text,
          source: "characters_tab_builder",
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "Save failed.");
      setMessage("Character saved and available for movie/video generation.");
      await loadCharacters();
      resetBuilder();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!characterDraftHydrated) {
    return (
      <section className="space-y-5">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
          <p className="text-xs uppercase tracking-[0.22em] text-amber-300">Characters</p>
          <h2 className="mt-2 text-2xl font-semibold text-zinc-50">Restoring character creation progress...</h2>
          <p className="mt-2 max-w-3xl text-sm text-zinc-400">
            Loading the latest saved builder draft before showing the Character tab.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-amber-300">Characters</p>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-50">Character Builder</h2>
            <p className="mt-2 max-w-3xl text-sm text-zinc-400">
              Characters are created here through Image, Character Card, Details, Voice Lab, then Review & Save. Generated media from the Generate tab is no longer sent directly to Characters.
            </p>
            {characterDraftRestoreError ? (
              <p className="mt-2 max-w-3xl rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                Could not restore the server draft: {characterDraftRestoreError}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => goToBuilderStepByOffset(-1)}
              disabled={currentBuilderStepIndex() === 0 || currentBuilderStepIndex() - 1 <= lockedBuilderStepIndex}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 disabled:opacity-40 hover:border-cyan-300 hover:text-cyan-100"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => goToBuilderStepByOffset(1)}
              disabled={currentBuilderStepIndex() === BUILDER_STEP_ORDER.length - 1}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 disabled:opacity-40 hover:border-cyan-300 hover:text-cyan-100"
            >
              Next
            </button>
            <button
              type="button"
              onClick={resetBuilder}
              className="rounded-2xl border border-red-400 bg-red-600/20 px-6 py-3 text-base font-black text-red-100 shadow-[0_0_28px_rgba(239,68,68,0.18)] transition hover:bg-red-500 hover:text-white"
            >
              Start Over
            </button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 text-xs">
          {[
            ["source", "Image"],
            ["card", "Character Card"],
            ["details", "Details"],
            ["voice", "Voice Lab"],
            ["review", "Review & Save"],
          ].map(([id, label]) => {
            const isActive = step === id || (id === "source" && ["source", "generate", "upload"].includes(step));
            const isLocked = builderStepIndexFor(id) <= lockedBuilderStepIndex;
            return (
            <span key={id} className={classNames("rounded-full border px-3 py-1", isActive ? "border-amber-300 bg-amber-300/10 text-amber-100" : isLocked ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100" : "border-zinc-800 text-zinc-500")}>
              {label}
              {isLocked ? " - Locked" : ""}
            </span>
          );
          })}
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Character creation progress auto-saves on this device. Once you move forward, the completed page is locked; use Start Over if you need to change earlier work.
        </p>
        {message ? <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{message}</div> : null}
        {error ? <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div> : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {step === "source" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <button type="button" onClick={() => setStep("generate")} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-left hover:border-amber-300">
                <h3 className="text-xl font-semibold text-zinc-50">Create Character</h3>
                <p className="mt-2 text-sm text-zinc-400">Generate a new full-body portrait when you do not have your own image.</p>
              </button>
              <button type="button" onClick={() => setStep("upload")} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-left hover:border-amber-300">
                <h3 className="text-xl font-semibold text-zinc-50">Upload Character Image</h3>
                <p className="mt-2 text-sm text-zinc-400">Use an existing full-body, half-body, or face image as the identity source.</p>
              </button>
            </div>
          ) : null}

          {step === "generate" ? (
            <Panel title="Create Character">
              <label className="block text-sm font-medium text-zinc-200">Prompt</label>
              <textarea value={generationPrompt} onChange={(event) => setGenerationPrompt(event.target.value)} rows={4} className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-100 outline-none focus:border-amber-300" placeholder="mutant rat teenager" />
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {STYLE_PRESETS.map((preset) => (
                  <button key={preset} type="button" onClick={() => setStylePreset(preset)} className={classNames("rounded-full border px-3 py-1.5 text-sm", stylePreset === preset ? "border-amber-300 bg-amber-300/10 text-amber-100" : "border-zinc-800 text-zinc-300 hover:border-zinc-600")}>
                    {preset}
                  </button>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button type="button" onClick={generateCharacterCandidate} disabled={loading} className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50">
                  Generate
                </button>
                <button type="button" onClick={useSelectedCandidate} disabled={!selectedCandidate} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-100 disabled:opacity-40">
                  Use This Character
                </button>
              </div>
              <ImageChooser candidates={candidates} selectedId={selectedCandidateId} onSelect={setSelectedCandidateId} onDelete={(id) => setCandidates((items) => items.filter((item) => item.id !== id))} />
            </Panel>
          ) : null}

          {step === "upload" ? (
            <Panel title="Upload Character Image">
              <input type="file" accept="image/*" onChange={(event) => void uploadCharacterImage(event.target.files?.[0] || null)} className="block w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-300" />
              {uploadedImage ? <img src={uploadedImage.url} alt="Uploaded character" className="mt-4 max-h-[520px] rounded-xl border border-zinc-800 object-contain" /> : null}
              {uploadedImage ? (
                <div className="mt-5 space-y-3">
                  <p className="text-sm font-medium text-zinc-200">Image completeness</p>
                  {[
                    ["full_body", "Full-body character image"],
                    ["half_body", "Half-body / waist-up image"],
                    ["face_only", "Face / head-only image"],
                  ].map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 text-sm text-zinc-300">
                      <input type="radio" checked={imageCompleteness === value} onChange={() => setImageCompleteness(value as ImageCompleteness)} />
                      {label}
                    </label>
                  ))}
                  {imageCompleteness === "full_body" ? (
                    <button type="button" onClick={continueUploadedImage} className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950">
                      Create Character Card
                    </button>
                  ) : (
                    <div className="space-y-4">
                      <label className="block text-sm font-medium text-zinc-200">Missing Body / Outfit Guidance</label>
                      <textarea value={missingGuidance} onChange={(event) => setMissingGuidance(event.target.value)} rows={3} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-100" placeholder="Only describe the missing parts. Do not redescribe the face unless you want it changed." />
                      <div className="flex flex-wrap gap-3">
                        <button type="button" onClick={continueUploadedImage} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-100">
                          OK / Continue
                        </button>
                        <button type="button" onClick={completePartialImage} className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950">
                          Complete Full Body
                        </button>
                        <button type="button" onClick={useSelectedCandidate} disabled={!selectedCandidate} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-100 disabled:opacity-40">
                          Use This Character
                        </button>
                      </div>
                      <ImageChooser candidates={candidates} selectedId={selectedCandidateId} onSelect={setSelectedCandidateId} onDelete={(id) => setCandidates((items) => items.filter((item) => item.id !== id))} />
                    </div>
                  )}
                </div>
              ) : null}
            </Panel>
          ) : null}

          {step === "card" ? (
            <Panel title="Character Card">
              <p className="text-sm text-zinc-400">Create consistent face, front, back, left side, and right side reference views from the selected full-body character.</p>
              {selectedFullBody ? <img src={selectedFullBody.url} alt="Selected full body character" className="mt-4 max-h-[520px] rounded-xl border border-zinc-800 object-contain" /> : null}
              <button type="button" onClick={createCharacterCard} disabled={loading || !selectedFullBody} className="mt-5 rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50">
                Create Character Card
              </button>
            </Panel>
          ) : null}

          {step === "details" ? (
            <Panel title="Character Details">
              {characterCard ? (
                <div className="mb-5 space-y-3">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
                    <img
                      src={characterCard.url}
                      alt="Character card"
                      className="h-auto w-full max-w-[860px] rounded-xl object-contain"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={createCharacterCard}
                      disabled={loading || !selectedFullBody}
                      className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/10 disabled:opacity-50"
                    >
                      Fix / Regenerate Character Card
                    </button>
                    <a
                      href={characterCard.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 hover:border-cyan-300 hover:text-cyan-100"
                    >
                      Open Full Size
                    </a>
                    <p className="max-w-xl text-xs text-zinc-500">
                      Reruns the character-card workflow from the selected full-body image using a new seed. Use this when the face, angle layout, or stitched card is wrong.
                    </p>
                  </div>
                </div>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                <TextField label="Character Name" value={details.name} onChange={(value) => setDetail("name", value)} required />
                <TextField label="Age" value={details.age} onChange={(value) => setDetail("age", value)} required />
                <TextField label="Race / Species" value={details.species} onChange={(value) => setDetail("species", value)} required />
                <TextField label="Gender" value={details.gender} onChange={(value) => setDetail("gender", value)} required />
                <SelectField label="Height" value={details.height} options={["short", "average", "tall"]} onChange={(value) => setDetail("height", value as CharacterDetails["height"])} />
                <SelectField label="Build / Weight" value={details.build} options={["thin", "average", "big"]} onChange={(value) => setDetail("build", value as CharacterDetails["build"])} />
                <TextField label="Hair / fur color" value={details.hairFurColor} onChange={(value) => setDetail("hairFurColor", value)} required />
                <TextField label="Eye color" value={details.eyeColor} onChange={(value) => setDetail("eyeColor", value)} required />
              </div>
              <TextArea label="Skin / fur / surface description" value={details.surfaceDescription} onChange={(value) => setDetail("surfaceDescription", value)} />
              <label className="mt-4 flex items-center gap-2 text-sm text-zinc-300">
                <input type="checkbox" checked={details.hasAccent} onChange={(event) => setDetail("hasAccent", event.target.checked)} />
                Accent
              </label>
              {details.hasAccent ? <TextField label="Accent type" value={details.accentType} onChange={(value) => setDetail("accentType", value)} /> : null}
              <div className="mt-5 rounded-xl border border-zinc-800 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-zinc-200">Clothing and Accessories</p>
                    <p className="text-xs text-zinc-500">Ollama Vision should only describe visible clothing/accessories here.</p>
                  </div>
                  <button type="button" onClick={describeClothingAccessories} disabled={loading || (!characterCard?.serverPath && !selectedFullBody?.serverPath)} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 disabled:opacity-50">
                    {loading ? "Describing..." : "Auto Describe"}
                  </button>
                </div>
                <TextArea label="" value={details.clothingAccessories} onChange={(value) => setDetail("clothingAccessories", value)} />
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={saveCharacterCardOnly}
                  disabled={saving || !details.name.trim() || !selectedFullBody?.serverPath || !characterCard?.serverPath}
                  className="rounded-xl border border-emerald-300 bg-emerald-300/10 px-4 py-2 text-sm font-semibold text-emerald-100 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-emerald-300/20"
                >
                  {saving ? "Saving..." : "Save Character Card Only"}
                </button>
                <button
                  type="button"
                  onClick={continueNewCharacterToVoiceLab}
                  className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950"
                >
                  Continue to Voice Lab
                </button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Save Character Card Only creates a completed saved character without a custom voice. You can add a voice later from Saved Characters.
              </p>
            </Panel>
          ) : null}

          {step === "voice" ? (
            <Panel title="Character Voice + Audio Studio Prep">
              <p className="mb-4 text-sm text-zinc-400">
                Create the character voice in order: design the base voice, optionally tune it, train it, then test and preview it.
              </p>

              <div className="mb-5 grid gap-3 md:grid-cols-4">
                {VOICE_LAB_PAGES.map((item, index) => {
                  const locked = index <= lockedVoiceLabPageIndex;
                  const complete =
                    item.id === "design"
                      ? Boolean(voicePackCreated || rawVoicePreviewPath || builderCharacterVoiceProfile?.status === "sample_ready")
                      : item.id === "fx"
                        ? Boolean(tunedVoicePreviewPath)
                        : item.id === "training"
                          ? Boolean(indexVoicePack?.outputs || voicePipelineJobs.start_applio_training?.job?.status === "completed")
                          : item.id === "preview"
                            ? Boolean(getCharacterPreviewDubSelection(voicePipelineJobs.generate_character_preview?.job))
                          : false;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => advanceToVoiceLabPage(item.id)}
                      disabled={locked && voiceLabPage !== item.id}
                      className={classNames(
                        "rounded-xl border p-3 text-left transition disabled:cursor-not-allowed",
                        voiceLabPage === item.id
                          ? "border-amber-300 bg-amber-300/10"
                          : locked
                            ? "border-emerald-400/40 bg-emerald-400/10 opacity-80"
                            : complete
                            ? "border-emerald-400/40 bg-emerald-400/10"
                            : "border-zinc-800 bg-zinc-950 hover:border-zinc-600",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">{index + 1}</span>
                        <span className={locked ? "text-xs font-semibold text-emerald-200" : complete ? "text-xs font-semibold text-emerald-200" : "text-xs font-semibold text-amber-200"}>{locked ? "Locked" : complete ? "Ready" : "Open"}</span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-zinc-100">{item.label}</p>
                      <p className="mt-1 text-xs text-zinc-500">{item.detail}</p>
                    </button>
                  );
                })}
              </div>

              <div className="mb-5 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                <p className="text-sm font-semibold text-zinc-100">
                  {VOICE_LAB_PAGES.find((item) => item.id === voiceLabPage)?.label || "Voice Lab"}
                </p>
                <p className="mt-1 text-sm text-zinc-400">
                  {voiceLabPage === "design"
                    ? "Choose a provider, shape the voice, then create the base voice sample."
                    : voiceLabPage === "fx"
                      ? "Carry the created base voice forward, then use it raw or apply optional effects."
                      : voiceLabPage === "training"
                        ? "Prepare training data and train the selected voice model."
                        : "Test the trained voice and prepare the character preview video."}
                </p>
              </div>

              {voiceLabPage === "design" ? (
              <div className="grid gap-5 xl:grid-cols-[minmax(280px,0.85fr)_minmax(360px,1fr)_minmax(360px,0.9fr)]">
                <div className="space-y-5">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="text-sm font-semibold text-zinc-100">Model selector</p>
                    <p className="mt-1 text-xs text-zinc-500">Choose the backend style before shaping the prompt.</p>
                    <div className="mt-4 grid gap-3">
                      {(["qwen3tts", "cosyvoice"] as const).map((model) => (
                        <button
                          key={model}
                          type="button"
                          onClick={() => setVoiceDesignField("model", model)}
                          className={classNames(
                            "rounded-xl border p-4 text-left transition",
                            voiceDesignProfile.model === model ? "border-amber-300 bg-amber-300/10 text-amber-100" : "border-zinc-800 text-zinc-300 hover:border-zinc-600",
                          )}
                        >
                          <span className="block text-sm font-semibold">{voiceModels[model].label}</span>
                          <span className="mt-1 block text-xs text-zinc-500">{voiceModels[model].strengths.join(" / ")}</span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-4 grid gap-3">
                      <SelectField
                        label="Mode"
                        value={voiceDesignProfile.mode}
                        options={voiceModels[voiceDesignProfile.model].modes}
                        onChange={(value) => setVoiceDesignField("mode", value as VoiceDesignMode)}
                      />
                      {voiceDesignProfile.model === "cosyvoice" ? (
                        <SelectField
                          label="CosyVoice model"
                          value={voiceDesignProfile.modelVersion}
                          options={["cosyvoice", "cosyvoice3"]}
                          onChange={(value) => setVoiceDesignField("modelVersion", value as VoiceDesignProfile["modelVersion"])}
                        />
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="text-sm font-semibold text-zinc-100">Character / Voice Profile</p>
                    <div className="mt-4 grid gap-4">
                      <SelectField label="Speaker identity" value={voiceDesignProfile.speakerIdentity} options={SPEAKER_IDENTITIES} onChange={(value) => setVoiceDesignField("speakerIdentity", value as VoiceDesignProfile["speakerIdentity"])} />
                      <SelectField label="Voice age range" value={voiceDesignProfile.ageRange} options={VOICE_AGE_RANGES} onChange={(value) => setVoiceDesignField("ageRange", value as VoiceDesignProfile["ageRange"])} />
                      <SelectField label="Gender / presentation" value={voiceDesignProfile.genderPresentation} options={VOICE_GENDER_PRESENTATIONS} onChange={(value) => setVoiceDesignField("genderPresentation", value as VoiceDesignProfile["genderPresentation"])} />
                      <SelectField
                        label="Language"
                        value={voiceDesignProfile.language}
                        options={voiceDesignProfile.model === "cosyvoice" ? COSY_LANGUAGES : ["English", "Chinese", "Japanese", "Korean"]}
                        onChange={(value) => setVoiceDesignField("language", value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="text-sm font-semibold text-zinc-100">Accent / dialect</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Official options are separated from prompt-based accent guidance. Prompt-based accents work best with matching reference audio.
                    </p>
                    {voiceDesignProfile.model === "qwen3tts" && voiceDesignProfile.mode === "custom_voice" ? (
                      <SelectField
                        label="Qwen3-TTS preset speaker"
                        value={voiceDesignProfile.qwenPresetSpeaker}
                        options={QWEN_OFFICIAL_PRESETS.map((preset) => preset.speaker || preset.id)}
                        onChange={(value) => setVoiceDesignField("qwenPresetSpeaker", value)}
                      />
                    ) : (
                      <label className="mt-4 block text-sm text-zinc-300">
                        <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Accent or dialect</span>
                        <select
                          value={voiceDesignProfile.accentDialectId}
                          onChange={(event) => setVoiceDesignField("accentDialectId", event.target.value)}
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-300"
                        >
                          {voiceDesignAccentOptions.map((option) => (
                            <option key={option.id} value={option.id}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    {voiceDesignAccent ? (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full border border-zinc-700 px-2 py-1 text-zinc-300">
                          {voiceDesignAccent.kind === "official" ? "Official" : voiceDesignAccent.kind === "preset_speaker" ? "Preset speaker" : voiceDesignAccent.kind === "chinese_dialect" ? "Chinese dialect" : "Prompt-based"}
                        </span>
                        {voiceDesignAccent.referenceRecommended ? <span className="rounded-full border border-cyan-400/40 px-2 py-1 text-cyan-100">Reference recommended</span> : null}
                      </div>
                    ) : null}
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <SelectField label="Tone" value={voiceDesignProfile.tone} options={VOICE_TONES} onChange={(value) => setVoiceDesignField("tone", value)} />
                      <SelectField label="Delivery style" value={voiceDesignProfile.deliveryStyle} options={DELIVERY_STYLES} onChange={(value) => setVoiceDesignField("deliveryStyle", value)} />
                      <SelectField label="Pace" value={voiceDesignProfile.pace} options={VOICE_PACES} onChange={(value) => setVoiceDesignField("pace", value as VoiceDesignProfile["pace"])} />
                      <SelectField label="Pitch" value={voiceDesignProfile.pitch} options={VOICE_PITCHES} onChange={(value) => setVoiceDesignField("pitch", value as VoiceDesignProfile["pitch"])} />
                      <SelectField label="Energy" value={voiceDesignProfile.energy} options={VOICE_ENERGIES} onChange={(value) => setVoiceDesignField("energy", value as VoiceDesignProfile["energy"])} />
                      <SelectField label="Texture / timbre" value={voiceDesignProfile.timbre} options={VOICE_TIMBRES} onChange={(value) => setVoiceDesignField("timbre", value)} />
                    </div>
                  </div>

                  <details className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-zinc-100">Optional advanced settings</summary>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <TextField label="Use case / context" value={voiceDesignProfile.useCaseContext} onChange={(value) => setVoiceDesignField("useCaseContext", value)} />
                      <TextField label="Seed if supported" value={voiceDesignProfile.seed} onChange={(value) => setVoiceDesignField("seed", value)} />
                      <TextField label="Reference audio name" value={voiceDesignProfile.referenceAudioName} onChange={(value) => setVoiceDesignField("referenceAudioName", value)} />
                      <TextField label="Reference text" value={voiceDesignProfile.referenceText} onChange={(value) => setVoiceDesignField("referenceText", value)} />
                      <SelectField label="Emotion strength" value={String(voiceDesignProfile.emotionStrength)} options={["0", "25", "50", "75", "100"]} onChange={(value) => setVoiceDesignField("emotionStrength", Number(value))} />
                      <SelectField label="Accent strength" value={String(voiceDesignProfile.accentStrength)} options={["0", "25", "50", "75", "100"]} onChange={(value) => setVoiceDesignField("accentStrength", Number(value))} />
                      <SelectField label="Speaking rate" value={String(voiceDesignProfile.speakingRate)} options={["0.75", "1", "1.25", "1.5"]} onChange={(value) => setVoiceDesignField("speakingRate", Number(value))} />
                      <SelectField label="Volume" value={String(voiceDesignProfile.volume)} options={["0.8", "1", "1.2"]} onChange={(value) => setVoiceDesignField("volume", Number(value))} />
                    </div>
                    <div className="mt-4 grid gap-4">
                      <TextArea label="Avoid list" value={voiceDesignProfile.avoidList} onChange={(value) => setVoiceDesignField("avoidList", value)} />
                      <TextArea label="Optional extra notes" value={voiceDesignProfile.extraNotes} onChange={(value) => setVoiceDesignField("extraNotes", value)} />
                    </div>
                  </details>
                </div>

                <div className="space-y-5">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="text-sm font-semibold text-zinc-100">Prompt preview / generated model instruction</p>
                    <TextArea label="Sample phrase" value={voiceDesignProfile.sampleText} onChange={(value) => setVoiceDesignField("sampleText", value)} />
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-xs text-zinc-400">
                        <input type="checkbox" checked={qwenVoiceInstructionAdvancedEdit} onChange={(event) => setQwenVoiceInstructionAdvancedEdit(event.target.checked)} />
                        Advanced edit
                      </label>
                      <button type="button" onClick={() => void copyGeneratedVoicePrompt()} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-zinc-500">
                        Copy generated prompt
                      </button>
                    </div>
                    {qwenVoiceInstructionAdvancedEdit ? (
                      <textarea
                        value={voiceDesignProfile.advancedInstructionOverride || String(voicePromptSnapshot?.instruct || voicePromptSnapshot?.prompt || "")}
                        onChange={(event) => setVoiceDesignField("advancedInstructionOverride", event.target.value)}
                        rows={9}
                        className="mt-3 w-full rounded-lg border border-zinc-800 bg-black/40 p-3 text-xs leading-5 text-zinc-200 outline-none focus:border-amber-300"
                      />
                    ) : (
                      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-black/40 p-3 text-xs leading-5 text-zinc-300">
                        {voicePromptSnapshot ? JSON.stringify(voicePromptSnapshot.payload || voicePromptSnapshot, null, 2) : ""}
                      </pre>
                    )}
                    {qwenWarnings.length ? (
                      <div className="mt-3 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-100">
                        {qwenWarnings.map((warning) => <div key={warning}>{warning}</div>)}
                      </div>
                    ) : null}
                    <div className="mt-6 grid gap-3 md:grid-cols-2">
                      <button type="button" onClick={generateQwenVoiceDesignCandidates} className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950">
                        Generate Voice Options
                      </button>
                      <button type="button" onClick={saveReusableVoiceProfile} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 hover:border-zinc-500">
                        Save reusable voice profile
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="mb-3 text-sm font-semibold text-zinc-100">Voice Options</p>
                    {qwenVoiceCandidates.length === 0 ? (
                      <p className="text-sm text-zinc-500">Generate options to see Qwen prompt candidates.</p>
                    ) : (
                      <div className="flex gap-3 overflow-x-auto pb-1">
                        {qwenVoiceCandidates.map((candidate) => (
                          <div
                            key={candidate.candidateId}
                            className={classNames(
                              "rounded-xl border p-3",
                              selectedQwenVoiceCandidateId === candidate.candidateId
                                ? "border-amber-300 bg-amber-300/10"
                                : "border-zinc-800 bg-black/20",
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-zinc-100">{candidate.label}</p>
                              <button
                                type="button"
                                onClick={() => selectQwenVoiceCandidate(candidate)}
                                className="rounded-lg border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-100"
                              >
                                Use This Voice Design
                              </button>
                            </div>
                            <p className="mt-2 text-xs text-zinc-400">{candidate.variantInstruction}</p>
                            <details className="mt-3">
                              <summary className="cursor-pointer text-xs text-zinc-500">Show generated Qwen prompt</summary>
                              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs text-zinc-300">
                                {candidate.fullInstruction}
                              </pre>
                            </details>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="text-sm font-semibold text-zinc-100">Selected Voice Design</p>
                    {selectedQwenVoiceCandidate ? (
                      <div className="mt-3 space-y-2 text-sm text-zinc-300">
                        <p>{selectedQwenVoiceCandidate.label}</p>
                        <p className="text-xs text-zinc-500">{selectedQwenVoiceCandidate.variantInstruction}</p>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-zinc-500">No Qwen voice design selected yet.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="text-sm font-semibold text-zinc-100">Upload Voice / Reference Voice</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Use an existing voice sample as the base voice for effects and training. Uploaded voices are treated as real user-provided references, not mock model output.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <label className="cursor-pointer rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 hover:border-zinc-500">
                        Upload Voice
                        <input
                          type="file"
                          accept=".wav,.mp3,.m4a,.flac,.ogg,audio/wav,audio/mpeg,audio/mp4,audio/flac,audio/ogg"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0] || null;
                            event.currentTarget.value = "";
                            void uploadVoiceSample(file);
                          }}
                        />
                      </label>
                      <label className="cursor-pointer rounded-xl border border-cyan-400/60 px-4 py-2 text-sm font-semibold text-cyan-100 hover:border-cyan-300">
                        Upload Reference Voice
                        <input
                          type="file"
                          accept=".wav,.mp3,.m4a,.flac,.ogg,audio/wav,audio/mpeg,audio/mp4,audio/flac,audio/ogg"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0] || null;
                            event.currentTarget.value = "";
                            void uploadVoiceSample(file);
                          }}
                        />
                      </label>
                    </div>
                    {voiceUploadState.fileName ? (
                      <div className="mt-3 text-xs text-zinc-400">Selected file: {voiceUploadState.fileName}</div>
                    ) : null}
                    {voiceUploadState.phase === "uploading" ? (
                      <div className="mt-3">
                        <div className="text-xs text-amber-100">Uploading voice...</div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
                          <div className="h-full w-1/2 rounded-full bg-amber-300" />
                        </div>
                      </div>
                    ) : null}
                    {voiceUploadState.phase === "ready" ? (
                      <div className="mt-3 text-xs text-emerald-300">Uploaded voice is locked as the base voice.</div>
                    ) : null}
                    {voiceUploadState.phase === "error" ? (
                      <div className="mt-3 text-xs text-red-300">{voiceUploadState.error}</div>
                    ) : null}
                  </div>
                </div>
              </div>
              ) : null}

              {voiceLabPage === "fx" ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-cyan-100">Voice Effects</p>
                      <p className="mt-1 max-w-2xl text-xs text-zinc-400">
                        Shape the locked base voice with simple controls, or open Advanced FX for model-ready preset chains. Rendering remains queued through the Windows worker.
                      </p>
                    </div>
                    <div className={classNames(
                      "rounded-full border px-3 py-1 text-xs font-semibold",
                      voiceFxStatus === "Applied" ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100" :
                      voiceFxStatus === "Error" ? "border-red-400/40 bg-red-400/10 text-red-100" :
                      "border-cyan-400/40 bg-cyan-400/10 text-cyan-100",
                    )}>
                      {voiceFxStatus}
                    </div>
                  </div>
                  {renderVoicePipelineJobStatus("apply_voice_fx")}
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">Base Voice</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {details.name.trim() || builderCharacterVoiceProfile?.characterId || "Current character"} / {builderCharacterVoiceProfile?.provider || voiceProvider}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setMessage(rawVoicePreviewUrl ? "Original voice is available below." : "No original voice audio is available yet.")} className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-500">
                        Play Original
                      </button>
                      <button type="button" onClick={() => previewVoiceFx({ mode: "simple_fx_preview", simpleControls: simpleVoiceFx })} disabled={voiceFxBusy} className="rounded-xl border border-cyan-400 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:opacity-40">
                        Preview FX
                      </button>
                      <button type="button" onClick={() => { setVoiceFxStatus("Ready"); setMessage("Voice FX preview stopped."); }} className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-500">
                        Stop
                      </button>
                    </div>
                  </div>
                  {rawVoicePreviewUrl || builderCharacterVoiceProfile?.baseSampleUrl ? (
                    <audio controls preload="metadata" src={rawVoicePreviewUrl || builderCharacterVoiceProfile?.baseSampleUrl} className="mt-3 w-full" />
                  ) : null}
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">Simple FX</p>
                      <p className="mt-1 text-xs text-zinc-500">Friendly controls for fast character voice shaping.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => { applySimpleFxToPayload(); previewVoiceFx({ mode: "simple_fx_preview", simpleControls: simpleVoiceFx }); }} disabled={voiceFxBusy} className="rounded-xl border border-cyan-400 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:opacity-40">
                        Preview FX
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = mapSimpleFxToVoiceFx(simpleVoiceFx);
                          setVoiceFx(next);
                          void queueCharacterVoicePipelineAction("apply_voice_fx", { ...buildVoiceFxPipelinePayload(), ...next, simpleControls: simpleVoiceFx });
                        }}
                        disabled={voiceFxBusy || (!baseVoiceCanAdvance && !rawVoicePreviewPath)}
                        className="rounded-xl border border-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-40"
                      >
                        Apply to Voice
                      </button>
                      <button type="button" onClick={resetVoiceFx} className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-500">
                        Reset
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <label className="block text-sm text-zinc-300">
                      <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Voice Type</span>
                      <select value={simpleVoiceFx.voiceType} onChange={(event) => setSimpleVoiceFxField("voiceType", event.target.value as SimpleVoiceFxSettings["voiceType"])} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100">
                        {["Human", "Monster", "Robot", "Ghost", "Alien", "Creature"].map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm text-zinc-300">
                      <span className="mb-1 flex justify-between text-xs uppercase tracking-[0.16em] text-zinc-500"><span>Voice Size</span><span>{simpleVoiceFx.voiceSize < 35 ? "Tiny" : simpleVoiceFx.voiceSize > 70 ? "Giant" : "Normal"}</span></span>
                      <input type="range" min={0} max={100} value={simpleVoiceFx.voiceSize} onChange={(event) => setSimpleVoiceFxField("voiceSize", Number(event.target.value))} className="w-full accent-cyan-300" />
                    </label>
                    <label className="block text-sm text-zinc-300">
                      <span className="mb-1 flex justify-between text-xs uppercase tracking-[0.16em] text-zinc-500"><span>Roughness</span><span>{simpleVoiceFx.roughness < 25 ? "Clean" : simpleVoiceFx.roughness > 70 ? "Distorted" : "Raspy"}</span></span>
                      <input type="range" min={0} max={100} value={simpleVoiceFx.roughness} onChange={(event) => setSimpleVoiceFxField("roughness", Number(event.target.value))} className="w-full accent-cyan-300" />
                    </label>
                    <label className="block text-sm text-zinc-300">
                      <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Space</span>
                      <select value={simpleVoiceFx.space} onChange={(event) => setSimpleVoiceFxField("space", event.target.value as SimpleVoiceFxSettings["space"])} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100">
                        {["Dry", "Room", "Cave", "Void"].map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm text-zinc-300">
                      <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Transmission</span>
                      <select value={simpleVoiceFx.transmission} onChange={(event) => setSimpleVoiceFxField("transmission", event.target.value as SimpleVoiceFxSettings["transmission"])} className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100">
                        {["Clean", "Radio", "Broken", "Glitch"].map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm text-zinc-300">
                      <span className="mb-1 flex justify-between text-xs uppercase tracking-[0.16em] text-zinc-500"><span>Intensity</span><span>{simpleVoiceFx.intensity}%</span></span>
                      <input type="range" min={0} max={100} value={simpleVoiceFx.intensity} onChange={(event) => setSimpleVoiceFxField("intensity", Number(event.target.value))} className="w-full accent-cyan-300" />
                    </label>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <button type="button" onClick={() => setVoiceFxAdvancedOpen((current) => !current)} className="flex w-full items-center justify-between gap-3 text-left">
                    <span>
                      <span className="block text-sm font-semibold text-zinc-100">Advanced FX</span>
                      <span className="mt-1 block text-xs text-zinc-500">Preset categories, relevant controls, and view-only effect chain.</span>
                    </span>
                    <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300">{voiceFxAdvancedOpen ? "Hide" : "Show"}</span>
                  </button>

                  {voiceFxAdvancedOpen ? (
                    <div className="mt-4 space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="block text-sm text-zinc-300">
                          <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Preset Category</span>
                          <select
                            value={voiceFxPresetCategory}
                            onChange={(event) => {
                              const nextCategory = event.target.value;
                              const firstPreset = voiceFxPresetsForCategory(nextCategory)[0];
                              setVoiceFxPresetCategory(nextCategory);
                              if (firstPreset) applyAdvancedVoiceFxPreset(firstPreset);
                            }}
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                          >
                            {VOICE_FX_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                          </select>
                        </label>
                        <label className="block text-sm text-zinc-300">
                          <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Preset</span>
                          <select
                            value={selectedVoiceFxPreset.id}
                            onChange={(event) => applyAdvancedVoiceFxPreset(findVoiceFxPresetDefinition(event.target.value))}
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                          >
                            {advancedVoiceFxPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                          </select>
                        </label>
                      </div>

                      <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3">
                        <p className="text-sm font-semibold text-cyan-100">{selectedVoiceFxPreset.name}</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-400">{selectedVoiceFxPreset.description}</p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => previewVoiceFx({ mode: "advanced_preset_preview", presetId: selectedVoiceFxPreset.id })} disabled={voiceFxBusy} className="rounded-xl border border-cyan-400 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:opacity-40">
                          Preview Preset
                        </button>
                        <button type="button" onClick={() => { applyAdvancedVoiceFxPreset(selectedVoiceFxPreset); void queueCharacterVoicePipelineAction("apply_voice_fx", { ...buildVoiceFxPipelinePayload(), advancedPresetId: selectedVoiceFxPreset.id, effectChain: selectedVoiceFxPreset.chain }); }} disabled={voiceFxBusy || (!baseVoiceCanAdvance && !rawVoicePreviewPath)} className="rounded-xl border border-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-40">
                          Apply Preset
                        </button>
                        <button type="button" onClick={() => setMessage("Custom FX settings saved in the character draft. Backend custom preset storage is not connected yet.")} className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-500">
                          Save Custom
                        </button>
                        <button type="button" onClick={() => applyAdvancedVoiceFxPreset(selectedVoiceFxPreset)} className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-500">
                          Reset Preset
                        </button>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {selectedVoiceFxPreset.controls.filter((group) => group.params.length > 0).map((group) => (
                          <div key={group.group} className="rounded-xl border border-zinc-800 bg-black/20 p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{group.group}</p>
                            <div className="mt-3 space-y-3">{group.params.map(renderVoiceFxParam)}</div>
                          </div>
                        ))}
                      </div>

                      <div className="rounded-xl border border-zinc-800 bg-black/20 p-3">
                        <button type="button" onClick={() => setVoiceFxChainOpen((current) => !current)} className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-zinc-100">
                          <span>Show Effect Chain</span>
                          <span className="text-xs text-zinc-500">{voiceFxChainOpen ? "Hide" : "Show"}</span>
                        </button>
                        {voiceFxChainOpen ? (
                          <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs text-zinc-300">
                            {selectedVoiceFxChain.map((stepItem, index) => (
                              <li key={`${stepItem.effect}-${index}`}>
                                <span className="font-semibold text-zinc-100">{stepItem.effect}</span>
                                {Object.keys(stepItem).filter((key) => key !== "effect").length ? (
                                  <span className="text-zinc-500"> / {Object.entries(stepItem).filter(([key]) => key !== "effect").map(([key, value]) => `${key}: ${String(value)}`).join(", ")}</span>
                                ) : null}
                              </li>
                            ))}
                          </ol>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-zinc-500">Advanced FX is collapsed by default so the page stays focused on the simple controls.</p>
                  )}
                </div>

                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-emerald-100">Selected Voice for Training</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Choose whether training should use the raw base voice or the tuned voice.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={approveRawPreviewAsIndexReference}
                        disabled={(!rawVoicePreviewPath && !rawVoicePreviewUrl && !builderCharacterVoiceProfile?.baseSampleUrl && !builderCharacterVoiceProfile?.baseSamplePath) || (baseVoiceIsDevMock && !allowMockVoiceTraining)}
                        className="rounded-xl border border-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-40 hover:bg-emerald-400/10"
                      >
                        Use Raw
                      </button>
                      <button
                        type="button"
                        onClick={approveTunedPreviewAsIndexReference}
                        disabled={!tunedVoicePreviewUrl && !builderCharacterVoiceProfile?.tunedSampleUrl}
                        className="rounded-xl border border-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-40 hover:bg-emerald-400/10"
                      >
                        Use Tuned
                      </button>
                    </div>
                  </div>

                  {selectedIndexVoiceReference ? (
                    <div className="mt-3 space-y-1 text-xs text-zinc-300">
                      <p>Source: {selectedIndexVoiceReference.source === "tuned_voice_fx" ? "Tuned voice" : "Raw base voice"}</p>
                      <p>Engine: {String(selectedIndexVoiceReference.engine || "")}</p>
                      <p className="break-all text-zinc-500">Path: {String(selectedIndexVoiceReference.audioPath || "")}</p>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-zinc-500">
                      No training voice selected yet. Use Raw to train the base voice, or apply effects and Use Tuned.
                    </p>
                  )}

                  <div className="mt-6 grid gap-3 md:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!builderCharacterVoiceProfile?.baseSampleUrl && !builderCharacterVoiceProfile?.baseSamplePath && !rawVoicePreviewUrl && !rawVoicePreviewPath) {
                          setError("Create or upload a base voice before moving to Training.");
                          return;
                        }
                        if (!selectedIndexVoiceReference && !builderCharacterVoiceProfile?.approvedSampleUrl) {
                          approveRawPreviewAsIndexReference();
                        }
                        advanceToVoiceLabPage("training", { skipValidation: true, message: "Raw voice selected. Prepare training data next." });
                      }}
                      disabled={!baseVoiceCanAdvance}
                      className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:opacity-40 hover:border-zinc-500"
                    >
                      Next: Training
                    </button>
                  </div>
                </div>
              </div>
              ) : null}
              {/* Removed duplicate Voice Model Training panel. */}

              {(voiceLabPage === "training" || voiceLabPage === "preview") ? (
              <div className={classNames("mt-5 grid gap-4", voiceLabPage === "training" ? "xl:grid-cols-1" : "xl:grid-cols-2")}>
                {voiceLabPage === "training" ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-sm font-semibold text-zinc-100">Voice Model Training</p>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">
                    Prepare the voice training dataset first. When it is ready, choose Fast, Normal, or Quality and train the model.
                  </p>
                  <div className={classNames(
                    "mt-4 rounded-xl border p-3 text-xs leading-5",
                    lockedTrainingVoiceUrl
                      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                      : "border-amber-400/30 bg-amber-400/10 text-amber-100",
                  )}>
                    <div className="font-semibold">Selected Voice</div>
                    {lockedTrainingVoiceUrl ? (
                      <>
                        <div>Voice type: {lockedTrainingVoiceType === "tuned" ? "Tuned voice" : lockedTrainingVoiceType === "base" ? "Raw base voice" : "Selected voice"}</div>
                        {approvedSourceJobId ? <div className="break-all">Source job: {approvedSourceJobId}</div> : null}
                        {builderCharacterVoiceProfile?.tunedFxPreset && lockedTrainingVoiceType === "tuned" ? (
                          <div>FX preset: {builderCharacterVoiceProfile.tunedFxPreset}</div>
                        ) : null}
                        <div className="break-all">Voice source: {lockedTrainingVoiceUrl}</div>

                      </>
                    ) : (
                      <div>No voice detected yet. Create or upload a voice before training.</div>
                    )}
                  </div>
                  <div className="mt-4 rounded-xl border border-zinc-800 bg-black/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Choose Training Quality</p>
                        <p className="mt-1 text-sm font-semibold text-zinc-100">{selectedApplioTrainingQuality.label}</p>
                      </div>
                      <div className="text-xs text-zinc-500">
                        {selectedApplioTrainingQuality.epochs} epochs / save every {selectedApplioTrainingQuality.saveEveryEpoch}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      {Object.values(APPLIO_TRAINING_QUALITY_PRESETS).map((preset) => (
                        <button
                          key={preset.key}
                          type="button"
                          onClick={() => setApplioTrainingQualityPreset(preset.key)}
                          className={classNames(
                            "rounded-xl border p-3 text-left text-xs leading-5 transition",
                            applioTrainingQualityPreset === preset.key
                              ? "border-amber-300 bg-amber-300/10 text-amber-100"
                              : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600",
                          )}
                        >
                          <div className="font-semibold text-zinc-100">{preset.label}</div>
                          <div>{preset.estimatedDurationLabel}</div>
                          <div className="mt-1 text-zinc-500">{preset.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-6 grid gap-3 md:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!indexTts2TrainingDatasetAvailable) {
                          setError(indexTts2TrainingDatasetBlockedMessage);
                          setVoicePipelineJobs((current) => ({
                            ...current,
                            generate_training_dataset: {
                              phase: "error",
                              error: indexTts2TrainingDatasetBlockedMessage,
                            },
                          }));
                          return;
                        }

                        const confirmed = window.confirm(
                          "Prepare Voice Training Dataset will generate 200 same-speaker IndexTTS2 clone clips and can take 30-90 minutes. Keep the worker running until the dataset is ready. Continue?",
                        );
                        if (confirmed) void queueCharacterVoicePipelineAction("generate_training_dataset", { trainingPreset: "balanced", requestedClipCount: 200 });
                      }}
                      disabled={voicePipelineJobs.generate_training_dataset?.phase === "submitting" || !lockedTrainingVoiceUrl || !indexTts2TrainingDatasetAvailable}
                      className="w-full rounded-2xl border border-purple-300 bg-purple-300/10 px-5 py-5 text-base font-black text-purple-100 shadow-lg shadow-purple-950/20 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-purple-300/20 md:col-span-2"
                    >
                      {!indexTts2TrainingDatasetAvailable
                        ? "IndexTTS2 Not Configured"
                        : voicePipelineJobs.generate_training_dataset?.phase === "submitting"
                          ? "Preparing Dataset..."
                          : "Prepare Voice Training Dataset"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void queueCharacterVoicePipelineAction("start_applio_training", {
                        trainingPreset: "balanced",
                        trainingQualityPreset: selectedApplioTrainingQuality.key,
                        epochs: selectedApplioTrainingQuality.epochs,
                        saveEveryEpoch: selectedApplioTrainingQuality.saveEveryEpoch,
                        estimatedDurationLabel: selectedApplioTrainingQuality.estimatedDurationLabel,
                        ...applioManifestInput,
                      })}
                      disabled={voicePipelineJobs.start_applio_training?.phase === "submitting" || !lockedTrainingVoiceUrl || !trainingVoicePackReady}
                      className="w-full rounded-2xl border border-amber-300 bg-amber-300/10 px-5 py-5 text-base font-black text-amber-100 shadow-lg shadow-amber-950/20 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-amber-300/20 md:col-span-2"
                    >
                      {voicePipelineJobs.start_applio_training?.phase === "submitting" ? "Training..." : "Train Voice Model"}
                    </button>
                  </div>
                                    <p className="mt-2 text-xs leading-5 text-amber-100/80">
                    {indexTts2TrainingDatasetAvailable
                      ? "Preparing the dataset creates 200 same-speaker voice clips and can take 30 to 90 minutes. Keep the worker running until the status says Ready."
                      : indexTts2TrainingDatasetBlockedMessage}
                  </p>
                  {trainingDatasetResult ? (
                    <div className={classNames(
                      "mt-3 rounded-xl border p-3 text-xs leading-5",
                      trainingVoicePackReady
                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                        : "border-amber-400/30 bg-amber-400/10 text-amber-100",
                    )}>
                      <div className="font-semibold">
                        {trainingVoicePackReady
                          ? "Voice pack completed"
                          : trainingDatasetReadyForReview
                            ? "Voice pack ready for review"
                            : trainingDatasetTerminated
                              ? "Voice pack terminated"
                              : "Voice pack not ready"}
                      </div>
                      <div>
                        Clips ready: {trainingDatasetGeneratedClipCount || 0}
                        {trainingDatasetClipCount ? ` / ${trainingDatasetClipCount}` : ""}
                      </div>
                      {trainingDatasetResult.manifestPath ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer">Technical manifest path</summary>
                          <div className="mt-1 break-all opacity-80">{String(trainingDatasetResult.manifestPath)}</div>
                        </details>
                      ) : null}
                      {trainingDatasetGeneratedClipCount > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setTrainingDatasetPreviewIndex(1);
                              setTrainingDatasetPreviewOpen((open) => !open);
                            }}
                            className="rounded-lg border border-sky-300/50 bg-sky-300/10 px-3 py-2 text-xs font-bold text-sky-100 hover:bg-sky-300/20"
                          >
                            Preview Samples
                          </button>
                          {trainingDatasetReadyForReview ? (
                            <button
                              type="button"
                              onClick={() => void updateLongRunningVoiceJob("generate_training_dataset", "complete_dataset")}
                              className="rounded-lg border border-emerald-300/50 bg-emerald-300/10 px-3 py-2 text-xs font-bold text-emerald-100 hover:bg-emerald-300/20"
                            >
                              Complete Dataset
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {trainingDatasetPreviewOpen && trainingDatasetPreviewUrl ? (
                        <div className="mt-3 rounded-lg border border-zinc-700 bg-black/20 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs font-semibold">
                              Clip {currentTrainingDatasetPreviewIndex} / {trainingDatasetRequestedCount}
                            </div>
                            <div className="text-xs opacity-75">
                              {currentTrainingDatasetPreviewIndex <= trainingDatasetGeneratedClipCount ? "ready" : "pending"}
                            </div>
                          </div>
                          <audio key={trainingDatasetPreviewUrl} controls className="mt-2 w-full" src={trainingDatasetPreviewUrl} />
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setTrainingDatasetPreviewIndex((value) => Math.max(1, value - 1))}
                              className="rounded-lg border border-zinc-700 px-3 py-1 text-xs font-semibold hover:border-zinc-500"
                            >
                              Previous
                            </button>
                            <button
                              type="button"
                              onClick={() => setTrainingDatasetPreviewIndex((value) => Math.min(trainingDatasetRequestedCount, value + 1))}
                              className="rounded-lg border border-zinc-700 px-3 py-1 text-xs font-semibold hover:border-zinc-500"
                            >
                              Next
                            </button>
                            <input
                              type="number"
                              min={1}
                              max={trainingDatasetRequestedCount}
                              value={currentTrainingDatasetPreviewIndex}
                              onChange={(event) => setTrainingDatasetPreviewIndex(Math.max(1, Math.min(trainingDatasetRequestedCount, Number(event.target.value) || 1)))}
                              className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
                              aria-label="Jump to training dataset clip number"
                            />
                            <div className="text-xs opacity-75">clip_{String(currentTrainingDatasetPreviewIndex).padStart(3, "0")}.wav</div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* OTG_MINIMAL_DATASET_STATUS_CARD_V2 */}
                  <div className={classNames(
                    "mt-4 rounded-xl border p-4 text-sm leading-6",
                    trainingVoicePackReady
                      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
                      : voicePipelineJobs.generate_training_dataset?.phase === "submitting"
                        ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
                        : "border-zinc-800 bg-black/20 text-zinc-300",
                  )}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] opacity-70">Dataset Status</div>
                        <div className="mt-1 text-lg font-black">
                          {trainingVoicePackReady
                            ? "Completed"
                            : trainingDatasetReadyForReview
                              ? "Ready for Review"
                              : trainingDatasetTerminated
                                ? "Terminated"
                                : voicePipelineJobs.generate_training_dataset?.phase === "submitting"
                              ? "Preparing"
                              : "Not Prepared"}
                        </div>
                      </div>
                      <div className="text-right text-xs opacity-80">
                        Clips: {trainingDatasetGeneratedClipCount || 0}
                        {trainingDatasetClipCount ? " / " + trainingDatasetClipCount : " / 200"}
                      </div>
                    </div>

                    {trainingVoicePackReady ? (
                      <p className="mt-2 text-xs opacity-80">Ready. Choose a training quality and click Train Voice Model.</p>
                    ) : trainingDatasetReadyForReview ? (
                      <p className="mt-2 text-xs opacity-80">Review sample clips, then click Complete Dataset to unlock Train Voice Model.</p>
                    ) : trainingDatasetTerminated ? (
                      <p className="mt-2 text-xs opacity-80">This dataset session was terminated. Start a new dataset when ready.</p>
                    ) : (
                      <p className="mt-2 text-xs opacity-80">Prepare the dataset before training can start.</p>
                    )}
                  </div>

                  {renderVoicePipelineJobStatus("generate_training_dataset")}
                  {renderVoicePipelineJobStatus("start_applio_training")}
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => advanceToVoiceLabPage("preview", { message: "Training page saved and locked. Test and preview the trained voice next." })}
                      disabled={!trainedVoiceReady && voicePipelineJobs.start_applio_training?.job?.status !== "completed"}
                      className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:opacity-40 hover:border-zinc-500"
                    >
                      Next: Test + Preview
                    </button>
                  </div>
                </div>
                ) : null}
                {voiceLabPage === "preview" ? (
<div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                                    <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                    <p className="text-sm font-semibold text-emerald-100">Voice Model Status</p>
                    <div className="mt-3 space-y-1 text-xs leading-5 text-emerald-100/85">
                      <div>Selected voice: {lockedTrainingVoiceUrl ? (lockedTrainingVoiceType === "tuned" ? "Tuned voice" : lockedTrainingVoiceType === "base" ? "Raw base voice" : "Ready") : "Not selected"}</div>
                      <div>Training data: {trainingVoicePackReady ? `Voice pack ready (${trainingDatasetGeneratedClipCount}/${trainingDatasetClipCount || 200} clips)` : "Not prepared"}</div>
                      <div>Voice model: {builderCharacterVoiceProfile?.status === "trained" && builderCharacterVoiceProfile?.modelPath && builderCharacterVoiceProfile?.indexPath ? "Trained model ready" : builderCharacterVoiceProfile?.voiceModelArtifactId ? "Training artifact saved" : "Not trained yet"}</div>
                      {builderCharacterVoiceProfile?.voiceModelArtifactId ? <div className="break-all">Artifact: {builderCharacterVoiceProfile.voiceModelArtifactId}</div> : null}
                      {usableTrainedVoiceArtifact?.id ? <div className="break-all">Selected trained artifact: {usableTrainedVoiceArtifact.id}</div> : null}
                      {trainedModelPath ? <div className="break-all">Model: {trainedModelPath}</div> : null}
                      {trainedIndexPath ? <div className="break-all">Index: {trainedIndexPath}</div> : null}
                      {builderCharacterVoiceProfile?.trainingQualityPreset ? <div>Preset: {builderCharacterVoiceProfile.trainingQualityPreset}</div> : null}
                      {builderCharacterVoiceProfile?.epochs ? <div>Epochs: {builderCharacterVoiceProfile.epochs}</div> : null}
                      {builderCharacterVoiceProfile?.totalTrainingLabel ? <div>Total training time: {builderCharacterVoiceProfile.totalTrainingLabel}</div> : null}
                      {builderCharacterVoiceProfile?.trainingCompletedAt ? <div className="break-all">Completed: {builderCharacterVoiceProfile.trainingCompletedAt}</div> : null}
                    </div>
                    <p className="mt-2 text-xs text-emerald-100/70">
                      If the voice is not right, go back to Voice Design and create a new voice.
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-zinc-100">Character Preview Dub</p>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">
                    Generate a short preview video and dub it with the trained character voice.
                  </p>
                  <div className="mt-3 rounded-xl border border-zinc-800 bg-black/20 p-3 text-xs leading-5 text-zinc-400">
                    <div>Source image: {characterPreviewSourceImagePath ? "Original portrait/full-body image ready" : "Missing original portrait/full-body image"}</div>
                    <div>Voice model: {trainedVoiceReady ? "Verified trained model and index ready" : "Missing verified trained model/index"}</div>
                    <div>Guide speech: fixed hidden preview line</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void queueCharacterVoicePipelineAction("generate_character_preview")}
                    disabled={characterPreviewDisabled}
                    className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 disabled:opacity-40"
                  >
                    {characterPreviewSubmitting ? "Submitting..." : "Test & Preview Character"}
                  </button>
                  {!trainedVoiceReady ? (
                    <p className="mt-2 text-sm text-amber-200">Train the voice model before generating the character preview.</p>
                  ) : !characterPreviewSourceImagePath ? (
                    <p className="mt-2 text-sm text-amber-200">Character source image is missing. Cannot generate preview.</p>
                  ) : null}
                  {characterPreviewDubSelection ? (
                    <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3">
                      <p className="text-sm font-semibold text-emerald-100">Dubbed preview with character voice</p>
                      <video
                        key={characterPreviewDubSelection.videoKey}
                        controls
                        preload="metadata"
                        src={characterPreviewDubSelection.videoSrc}
                        className="mt-3 w-full rounded-lg bg-black"
                      />
                    </div>
                  ) : null}
                  {renderVoicePipelineJobStatus("generate_character_preview")}
                  {characterPreviewDubReady ? (
                    <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
                      <p className="text-sm font-semibold text-sky-100">Model spin preview</p>
                      <p className="mt-2 text-xs leading-5 text-zinc-500">
                        TripoSplat model-only orbit render. This is intentionally muted and looped for visual comparison.
                      </p>
                      {characterModelSpinVideoSrc ? (
                        <video
                          key={`model-spin-${characterModelSpinVideoSrc}`}
                          controls
                          muted
                          loop
                          preload="metadata"
                          src={characterModelSpinVideoSrc}
                          className="mt-3 aspect-square w-full rounded-lg bg-black object-contain"
                        />
                      ) : (
                        <div className="mt-3 rounded-lg border border-zinc-800 bg-black/20 p-3 text-xs text-zinc-500">
                          Model-spin video is not generated yet. Generate a fresh Test & Preview Character job after the model-spin worker patch is active.
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
                ) : null}
              </div>
              ) : null}

              {(voiceLabPage === "design" || voiceLabPage === "preview") ? (
              <div className="mt-5 flex flex-wrap gap-3">
                {voiceLabPage === "design" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void queueCharacterVoicePipelineAction("create_voice_sample")}
                      disabled={createVoiceBusy}
                      className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50"
                    >
                      {createVoiceBusy
                        ? "Creating Voice..."
                        : builderCharacterVoiceProfile?.baseSampleUrl
                          ? "Create Again"
                          : "Create Voice"}
                    </button>

                    <button
                      type="button"
                      onClick={() => advanceToVoiceLabPage("fx", { message: "Voice Design saved and locked. Continue with Voice Effects." })}
                      disabled={!baseVoiceCanAdvance}
                      className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:opacity-40 hover:border-zinc-500"
                    >
                      Next: Voice Effects
                    </button>

                    <div className="w-full">
                      {renderVoicePipelineJobStatus("create_voice_sample")}
                    </div>

                    {builderCharacterVoiceProfile?.baseSampleUrl ? (
                      <div className="w-full rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-xs leading-5 text-emerald-100">
                        <div className="text-sm font-semibold">
                          {builderCharacterVoiceProfile.mockResult && builderCharacterVoiceProfile.mockResult.mock !== false ? "Rejected mock base voice" : "Base voice ready"}
                        </div>
                        <div>Provider: {builderCharacterVoiceProfile.provider || voiceProvider}</div>
                        {builderCharacterVoiceProfile.sourceJobId ? <div className="break-all">Source job: {builderCharacterVoiceProfile.sourceJobId}</div> : null}
                        <div className="break-all">Base sample URL: {builderCharacterVoiceProfile.baseSampleUrl}</div>
                        <audio controls preload="metadata" src={builderCharacterVoiceProfile.baseSampleUrl} className="mt-3 w-full" />
                        <div className="mt-2 text-emerald-100/75">
                          This is the locked base voice that will carry into Voice Effects. Click Create Again to generate a different base voice.
                        </div>
                        {baseVoiceIsDevMock && !allowMockVoiceTraining ? (
                          <div className="mt-2 rounded-lg border border-amber-300/30 bg-amber-300/10 p-2 text-amber-100">
                            Mock output rejected. Start the real Qwen3/Cosy worker and click Create Voice again.
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="w-full text-xs text-zinc-500">
                        Click Create Voice to generate the base character voice from the selected provider and voice design. After it is ready, continue to Voice Effects.
                      </p>
                    )}

                    {voicePackRecord ? (
                      <p className="w-full text-xs text-emerald-300">
                        Voice design metadata saved. Status: {String(voicePackRecord.status || "metadata_only")}.
                      </p>
                    ) : null}
                  </>
                ) : null}

                {voiceLabPage === "preview" ? (
                <button
                  type="button"
                  onClick={() => advanceToBuilderStep("review", { message: "Voice Lab saved and locked. Review the character before saving." })}
                  disabled={!voicePackCreated && !builderCharacterVoiceProfile?.baseSampleUrl}
                  className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-100 disabled:opacity-40"
                >
                  Continue to Review & Save
                </button>
                ) : null}
              </div>
              ) : null}
            </Panel>
          ) : null}

          {step === "review" ? (
            <Panel title="Review & Save">
              <div className="grid gap-4 md:grid-cols-2">
                {selectedFullBody ? <img src={selectedFullBody.url} alt="Final full body" className="rounded-xl border border-zinc-800" /> : null}
                {characterCard ? (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
                    <img src={characterCard.url} alt="Final character card" className="h-auto w-full rounded-xl object-contain" />
                  </div>
                ) : null}
              </div>
              <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-sm font-medium text-zinc-200">LTX Global Prompt Identity Block</p>
                <p className="mt-2 text-sm text-zinc-400">{identityBlock}</p>
              </div>
              <div className="mt-5 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-sky-100">3D Model</p>
                    <p className="mt-1 max-w-2xl text-xs text-zinc-400">
                      Generate a TripoSplat 3D Model from the selected full-body image. This is saved with the character for later production handoff.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={generateCharacter3dModel}
                    disabled={loading || !selectedFullBody?.serverPath}
                    className="rounded-xl border border-sky-400 px-4 py-2 text-xs font-semibold text-sky-100 disabled:opacity-40 hover:bg-sky-400/10"
                  >
                    {loading ? "Generating..." : "Generate 3D Model"}
                  </button>
                </div>

                <p className="mt-3 break-all text-xs text-zinc-500">
                  Source image: {selectedFullBody?.serverPath || characterCard?.serverPath || "No image selected"}
                </p>

                {character3dModel ? (
                  <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-zinc-200">3D Model ready</p>
                      <p className="text-xs text-zinc-500">{Number(character3dModel.bytes || 0).toLocaleString()} bytes</p>
                    </div>
                    <p className="mt-2 break-all text-xs text-zinc-500">{character3dModelPath}</p>
                    {character3dModelUrl ? (
                      <a
                        href={character3dModelUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex rounded-lg border border-sky-400 px-3 py-1.5 text-xs font-semibold text-sky-100 hover:bg-sky-400/10"
                      >
                        Open / Download 3D Model
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-zinc-500">
                    No 3D model generated yet.
                  </p>
                )}
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button type="button" onClick={saveCharacter} disabled={saving || !characterPreviewDubReady} className="rounded-xl bg-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50">
                  {saving ? "Saving..." : "Complete Character"}
                </button>
                <button
                  type="button"
                  onClick={() => void queueCharacterVoicePipelineAction("save_voice_to_character", { selectedReferencePath: selectedIndexVoiceReference?.audioPath || "" })}
                  disabled={voicePipelineJobs.save_voice_to_character?.phase === "submitting"}
                  className="rounded-xl border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-100 disabled:opacity-40"
                >
                  {voicePipelineJobs.save_voice_to_character?.phase === "submitting" ? "Submitting..." : "Queue Save Voice Link"}
                </button>
              </div>
              {renderVoicePipelineJobStatus("save_voice_to_character")}
            </Panel>
          ) : null}
        </div>

        <aside className={classNames(showSavedCharactersStrip ? "block lg:col-span-2" : "hidden", "rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4")}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-zinc-50">Saved Characters</h3>
            <p className="text-[11px] text-zinc-500">Create-character drafts auto-save. Long voice jobs continue in the worker.</p>
            <button type="button" onClick={() => void loadCharacters()} className="text-xs text-zinc-400 hover:text-amber-200">
              Refresh
            </button>
          </div>
          {loading && !characters.length ? <p className="mt-3 text-sm text-zinc-500">Loading...</p> : null}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {characters.length ? (
              characters.map((character) => (
                <div key={character.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                  {character.previewImagePath || character.imagePath ? <img src={fileUrlFor(character.previewImagePath || character.imagePath)} alt={character.name} className="mb-3 h-52 w-full rounded-lg bg-black/30 object-contain" /> : null}
                  <p className="font-medium text-zinc-100">{character.name}</p>
                  {character.globalPromptIdentityBlock || character.description ? (
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                      {character.globalPromptIdentityBlock || character.description}
                    </p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-white/70">
                      3D Model: {character.character3dModelUrl ? "Ready" : "Not generated"}
                    </span>
                    <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-white/70">
                      Voice: {character.characterVoiceProfile?.voiceModelArtifactId ? "Artifact ready" : character.characterVoiceProfile?.tunedSampleUrl ? "Tuned sample ready" : character.characterVoiceProfile?.approvedSampleUrl || character.characterVoiceProfile?.approvedSamplePath ? "Sample approved" : "Planned"}
                    </span>
                    <button
                      type="button"
                      onClick={() => startVoiceLabForSavedCharacter(character)}
                      disabled={characterHasCustomVoice(character)}
                      className="rounded-full border border-cyan-500/60 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-500"
                    >
                      {characterHasCustomVoice(character) ? "Voice Added" : "Add Voice"}
                    </button>


                    <button
                      type="button"
                      onClick={() => generateAnimatePreviewForSavedCharacter(character)}
                      disabled={savedCharacterAnimateBusyId === safeId(String(character.id || character.name || ""))}
                      className="rounded-full border border-fuchsia-500/60 bg-fuchsia-500/10 px-2 py-1 text-[11px] text-fuchsia-100 transition hover:bg-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savedCharacterAnimateBusyId === safeId(String(character.id || character.name || "")) ? "Animating..." : "Animate Me"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSavedCharacter(character)}
                      className="rounded-full border border-red-500/60 bg-red-500/10 px-2 py-1 text-[11px] text-red-100 transition hover:bg-red-500/20"
                    >
                      Delete
                    </button>
                  </div>
                  {savedCharacterAnimateNoticeId === safeId(String(character.id || character.name || "")) && savedCharacterAnimateMessage ? (
                    <p className="mt-2 text-xs text-cyan-200">{savedCharacterAnimateMessage}</p>
                  ) : null}

                  {savedCharacterAnimateNoticeId === safeId(String(character.id || character.name || "")) && savedCharacterAnimateError ? (
                    <p className="mt-2 text-xs text-red-300">{savedCharacterAnimateError}</p>
                  ) : null}

                  {character.characterVoiceProfile ? (
                    <div className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs leading-5 text-emerald-100/85">
                      <div className="font-semibold text-emerald-100">Voice profile</div>
                      <div>Provider: {character.characterVoiceProfile.provider}</div>
                      <div>Status: {character.characterVoiceProfile.status}</div>
                      {character.characterVoiceProfile.sourceJobId ? <div className="break-all">Source job: {character.characterVoiceProfile.sourceJobId}</div> : null}
                      {character.characterVoiceProfile.baseSampleUrl ? <div className="break-all">Base sample URL: {character.characterVoiceProfile.baseSampleUrl}</div> : null}
                      {character.characterVoiceProfile.tunedSampleUrl ? <div className="break-all">Tuned sample URL: {character.characterVoiceProfile.tunedSampleUrl}</div> : null}
                      {character.characterVoiceProfile.tunedFxPreset ? <div>FX preset: {character.characterVoiceProfile.tunedFxPreset}</div> : null}
                      {character.characterVoiceProfile.tunedSourceJobId ? <div className="break-all">Tuned job: {character.characterVoiceProfile.tunedSourceJobId}</div> : null}
                      {character.characterVoiceProfile.approvedSampleUrl ? <div className="break-all">Selected voice URL: {character.characterVoiceProfile.approvedSampleUrl}</div> : null}
                      {character.characterVoiceProfile.voiceModelArtifactId ? <div className="break-all">Voice model artifact: {character.characterVoiceProfile.voiceModelArtifactId}</div> : null}
                      {character.characterVoiceProfile.trainingArtifactPath ? <div className="break-all">Training artifact: {character.characterVoiceProfile.trainingArtifactPath}</div> : null}
                      {character.characterVoiceProfile.datasetManifestPath ? <div className="break-all">Dataset manifest: {character.characterVoiceProfile.datasetManifestPath}</div> : null}
                      {character.characterVoiceProfile.modelPath ? <div className="break-all">Model path: {character.characterVoiceProfile.modelPath}</div> : null}
                      {character.characterVoiceProfile.indexPath ? <div className="break-all">Index path: {character.characterVoiceProfile.indexPath}</div> : null}
                      {character.characterVoiceProfile.mockResult ? <div>Mock result - real adapter was not used for this sample.</div> : null}
                    </div>
                  ) : null}

                  {savedCharacterAnimateVideoUrlById[safeId(String(character.id || character.name || ""))] ? (
                    <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/30 p-2">
                      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                        Animation preview ready
                      </div>
                      <video
                        src={savedCharacterAnimateVideoUrlById[safeId(String(character.id || character.name || ""))]}
                        controls
                        className="h-auto w-full rounded-lg bg-black"
                      />
                    </div>
                  ) : null}
</div>
              ))
            ) : (
              <p className="text-sm text-zinc-500">No saved characters yet.</p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
      <h3 className="text-lg font-semibold text-zinc-50">{title}</h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function TextField({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return (
    <label className="block text-sm text-zinc-300">
      {label} {required ? <span className="text-amber-300">*</span> : null}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-100 outline-none focus:border-amber-300" />
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mt-4 block text-sm text-zinc-300">
      {label}
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-100 outline-none focus:border-amber-300" />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm text-zinc-300">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-100 outline-none focus:border-amber-300">
        {options.map((option) => (
          <option key={option} value={option}>
            {prettyVoiceLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ImageChooser({ candidates, selectedId, onSelect, onDelete }: { candidates: CandidateImage[]; selectedId: string; onSelect: (id: string) => void; onDelete: (id: string) => void }) {
  const selected = candidates.find((item) => item.id === selectedId);
  return (
    <div className="mt-5">
      <div className="min-w-[8rem] rounded-xl border border-zinc-800 bg-zinc-950 p-3">
        {selected ? <img src={selected.url} alt={selected.label} className="mx-auto max-h-[640px] rounded-lg object-contain" /> : <div className="flex h-80 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">Main preview</div>}
      </div>
      <div className="mt-3 grid grid-cols-5 gap-2">
        {candidates.map((candidate) => (
          <div key={candidate.id} className={classNames("relative rounded-xl border p-1", selectedId === candidate.id ? "border-amber-300" : "border-zinc-800")}>
            <button type="button" onClick={() => onSelect(candidate.id)} className="block w-full">
              <img src={candidate.url} alt={candidate.label} className="aspect-[9/12] w-full rounded-lg object-cover" />
              {selectedId === candidate.id ? <span className="absolute left-2 top-2 rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-semibold text-zinc-950">Selected</span> : null}
            </button>
            <button type="button" onClick={() => onDelete(candidate.id)} className="mt-1 w-full rounded-lg border border-zinc-800 py-1 text-[11px] text-zinc-400 hover:text-red-200">
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
