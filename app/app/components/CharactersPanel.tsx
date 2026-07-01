"use client";

function otgDisplayImageUrlV36BP6(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(data:image\/|blob:|https?:\/\/)/i.test(raw)) return raw;
  if (raw.startsWith("/api/otg/local-image")) return raw;

  if (/^\/[A-Za-z]:[\\/]/.test(raw)) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw.slice(1))}`;
  }

  if (raw.startsWith("/")) return raw;

  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.includes("\\data\\") || raw.includes("/data/")) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw)}`;
  }

  return raw.replace(/\\/g, "/");
}

function characterDisplayImagePathV36BP6(character: any) {
  return (
    character?.defaultCharacterPreviewImagePath ||
    character?.defaultCharacterImagePath ||
    character?.backgroundRemovedDefaultImagePath ||
    character?.previewImagePath ||
    character?.imagePath ||
    character?.characterCardPreviewImagePath ||
    character?.characterCardPath ||
    character?.characterCardWorkflowImagePath ||
    ""
  );
}


import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  QWEN_PREVIEW_LINES,
  defaultQwenVoiceDesignInput,
  qwenVoiceDesignStorageRecord,
  type QwenVoiceCandidateInstruction,
  type QwenVoiceDesignInput,
} from "../../../lib/characters/qwenVoiceDesign";
import {
  DELIVERY_STYLES,
  SPEAKER_IDENTITIES,
  VOICE_AGE_RANGES,
  VOICE_ENERGIES,
  VOICE_GENDER_PRESENTATIONS,
  VOICE_PACES,
  VOICE_PITCHES,
  VOICE_TIMBRES,
  VOICE_TONES,
  DEFAULT_LTX_VOICE_DIALECT_ID,
  DEFAULT_VOICE_SAMPLE_TEXT,
  accentOptionsForModel,
  buildVoiceRequestPayload,
  defaultVoiceDesignProfile,
  getLtxDialectSampleText,
  isLtxDialectSampleText,
  statusForAccent,
  voiceDesignWarnings,
  voiceModels,
  type VoiceDesignModelId,
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
import {
  UNNATURAL_VOICE_CATEGORIES,
  UNNATURAL_VOICE_PRESETS,
  buildUnnaturalVoicePrompt,
  type UnnaturalVoiceCategory,
} from "../../../lib/characters/unnaturalVoicePresets";
import {
  VOICE_EFFECT_CATEGORIES,
  VOICE_EFFECT_PRESETS,
  type VoiceEffectCategory,
  type VoiceEffectIntensity,
} from "../../../lib/characters/voiceEffectPresets";
import type { CharacterVoicePipelineAction, QueuedContractJob } from "../../../lib/jobs/voicePipelineJobs";


// OTG_CHARACTER_GENERATOR_OPTIONS_ZTURBO_V1
type CharacterGeneratorOptionId = "ernie" | "zturbo" | "krea2";

const CHARACTER_GENERATOR_OPTIONS: Array<{
  id: CharacterGeneratorOptionId;
  title: string;
  subtitle: string;
  workflowFile?: string;
  workflowPath?: string;
  workflowJsonPath?: string;
  workflowLabel?: string;
}> = [
  {
    id: "ernie",
    title: "Generator Option 1",
    subtitle: "Ernie Images",
  },
  {
    id: "zturbo",
    title: "Generator Option 2",
    subtitle: "ZTurbo Image",
    workflowFile: "character-z-image-turbo.json",
    workflowPath: "workflows/characters/character-z-image-turbo.json",
    workflowJsonPath: "workflows/characters/character-z-image-turbo.json",
    workflowLabel: "characters/z-image-turbo",
  },
  {
    id: "krea2",
    title: "Generator Option 3",
    subtitle: "Krea2 Turbo",
    workflowFile: "krea2-turbo.json",
    workflowPath: "workflows/characters/krea2-turbo.json",
    workflowJsonPath: "workflows/characters/krea2-turbo.json",
    workflowLabel: "characters/krea2-turbo",
  },
];

function characterGeneratorPayload(optionId: CharacterGeneratorOptionId) {
  const option = CHARACTER_GENERATOR_OPTIONS.find((item) => item.id === optionId) || CHARACTER_GENERATOR_OPTIONS[0];

  if (option.id === "ernie") {
    return {
      characterGeneratorOption: "ernie",
      characterGeneratorLabel: "Ernie Images",
    };
  }

  const payload: Record<string, string | undefined> = {
    characterGeneratorOption: option.id,
    characterGeneratorLabel: option.subtitle,
    workflowFile: option.workflowPath || option.workflowFile,
    workflowPath: option.workflowPath,
    workflowJsonPath: option.workflowJsonPath,
    workflowPresetPath: option.workflowJsonPath,
    workflowLabel: option.workflowLabel,
  };

  if (option.id === "krea2") {
    payload.promptNodeId = "51";
    payload.promptNodeInput = "text";
    payload.positivePromptNodeId = "51";
    payload.positivePromptNodeInput = "text";
    payload.saveImageNodeId = "29";
    payload.saveImageInput = "filename_prefix";
    payload.seedNodeId = "53";
    payload.seedNodeInput = "seed";
  }

  return payload;
}

function CharacterGeneratorOptionsControl({
  selected,
  onSelect,
}: {
  selected: CharacterGeneratorOptionId;
  onSelect: (id: CharacterGeneratorOptionId) => void;
}) {
  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-black/25 p-3" data-otg="OTG_CHARACTER_GENERATOR_OPTIONS_ZTURBO_V1">
      <div className="grid gap-3 sm:grid-cols-3">
        {CHARACTER_GENERATOR_OPTIONS.map((option) => {
          const active = selected === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelect(option.id)}
              className={active
                ? "rounded-xl border border-purple-300 bg-purple-500/80 px-4 py-3 text-left text-white shadow-[0_0_28px_rgba(168,85,247,0.28)]"
                : "rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-left text-white/75 transition hover:border-purple-300/70 hover:text-white"}
              aria-pressed={active}
            >
              <div className="text-sm font-black uppercase tracking-[0.16em]">{option.title}</div>
              <div className="mt-1 text-xs font-bold text-white/80">{option.subtitle}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}


type CharacterRecord = {
  id: string;
  name: string;
  imagePath: string;
  previewImagePath?: string;
  characterCardPath?: string;
  characterCardWorkflowImagePath?: string;
  characterCardPreviewImagePath?: string;
  defaultCharacterImagePath?: string;
  defaultCharacterPreviewImagePath?: string;
  defaultCharacterSourceImagePath?: string;
  backgroundRemovedDefaultImagePath?: string;
  defaultCharacterImageStatus?: "background_removed" | "fallback_original_card" | "missing";
  description?: string;
  globalPromptIdentityBlock?: string;
  transparentImagePath?: string;
  originalSourceImagePath?: string;
  fullBodyImagePath?: string;
  source?: string;
  metadata?: Record<string, unknown>;
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


type CharacterBackgroundReferenceV36A = {
  type?: "background";
  id: string;
  name: string;
  locationType?: string;
  style?: string;
  prompt?: string;
  masterPrompt?: string;
  continuityBlock?: string;
  doNotChange?: string[];
  imagePath?: string;
  imageUrl?: string;
  displayImage?: string;
  workflowImage?: string;
  source: "created" | "uploaded" | "manual";
  createdAt: string;
  updatedAt?: string;
};

const CHARACTER_BACKGROUND_LIBRARY_KEY_V36A = "otg:character-background-library:v36a";

function safeCharacterBackgroundIdV36A(value: unknown, fallback = "background") {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return cleaned || fallback;
}

function normalizeCharacterBackgroundReferenceV36B(input: any): CharacterBackgroundReferenceV36A | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const imagePath = String(input.workflowImage || input.imagePath || input.establishingImage?.workflowImage || "").trim();
  const imageUrl = String(input.displayImage || input.imageUrl || input.establishingImage?.displayImage || "").trim();
  const usableImage = imagePath || imageUrl;

  if (!usableImage) return null;

  const id = String(input.id || `background-${Date.now()}`).trim();
  const name = String(input.name || "Scene Background").trim() || "Scene Background";

  return {
    type: "background",
    id,
    name,
    locationType: String(input.locationType || "").trim(),
    style: String(input.style || "cinematic realistic").trim(),
    prompt: String(input.prompt || input.masterPrompt || "").trim(),
    masterPrompt: String(input.masterPrompt || input.prompt || "").trim(),
    continuityBlock: String(input.continuityBlock || "").trim(),
    doNotChange: Array.isArray(input.doNotChange) ? input.doNotChange.map(String).filter(Boolean) : [],
    imagePath: imagePath || undefined,
    imageUrl: imageUrl || undefined,
    displayImage: imageUrl || imagePath || undefined,
    workflowImage: imagePath || imageUrl || undefined,
    source: input.source === "created" || input.source === "uploaded" || input.source === "manual" ? input.source : "manual",
    createdAt: String(input.createdAt || new Date().toISOString()),
    updatedAt: String(input.updatedAt || input.createdAt || new Date().toISOString()),
  };
}

function readCharacterBackgroundLibraryV36A(): CharacterBackgroundReferenceV36A[] {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHARACTER_BACKGROUND_LIBRARY_KEY_V36A) || "[]");
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(normalizeCharacterBackgroundReferenceV36B)
      .filter((item): item is CharacterBackgroundReferenceV36A => Boolean(item))
      .slice(0, 60);
  } catch {
    return [];
  }
}

function writeCharacterBackgroundLibraryV36A(items: CharacterBackgroundReferenceV36A[]) {
  if (typeof window === "undefined") return;

  const cleaned = items
    .map(normalizeCharacterBackgroundReferenceV36B)
    .filter((item): item is CharacterBackgroundReferenceV36A => Boolean(item))
    .slice(0, 60);

  window.localStorage.setItem(CHARACTER_BACKGROUND_LIBRARY_KEY_V36A, JSON.stringify(cleaned));
}

function upsertCharacterBackgroundReferenceV36A(
  current: CharacterBackgroundReferenceV36A[],
  next: CharacterBackgroundReferenceV36A,
) {
  const normalized = normalizeCharacterBackgroundReferenceV36B(next);
  if (!normalized) return current;

  return [
    normalized,
    ...current.filter((item) => item.id !== normalized.id),
  ].slice(0, 60);
}

async function fetchCharacterBackgroundLibraryFromServerV36B(): Promise<CharacterBackgroundReferenceV36A[]> {
  const response = await fetch("/api/backgrounds", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });

  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok || !Array.isArray(json.items)) {
    throw new Error(json?.error || `Background library load failed (${response.status}).`);
  }

  return json.items
    .map(normalizeCharacterBackgroundReferenceV36B)
    .filter((item: CharacterBackgroundReferenceV36A | null): item is CharacterBackgroundReferenceV36A => Boolean(item));
}

async function persistCharacterBackgroundReferenceToServerV36B(background: CharacterBackgroundReferenceV36A) {
  const response = await fetch("/api/backgrounds", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "save",
      background: {
        ...background,
        type: "background",
        masterPrompt: background.masterPrompt || background.prompt || "",
        establishingImage: {
          displayImage: background.displayImage || background.imageUrl || background.imagePath || "",
          workflowImage: background.workflowImage || background.imagePath || background.imageUrl || "",
          imagePath: background.imagePath || background.workflowImage || "",
          imageUrl: background.imageUrl || background.displayImage || "",
        },
        angleImages: {},
      },
    }),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) {
    throw new Error(json?.error || `Background library save failed (${response.status}).`);
  }

  return normalizeCharacterBackgroundReferenceV36B(json.background);
}


type CharacterBackgroundPreviewCandidateV36C = {
  id: string;
  name: string;
  imagePath?: string;
  imageUrl?: string;
  displayImage?: string;
  workflowImage?: string;
  prompt: string;
  provider: string;
  createdAt: string;
};

type CharacterBackgroundPromptPartsV36C = {
  name: string;
  locationType: string;
  style: string;
  describeScene: string;
  promptOverride: string;
};

const CHARACTER_BACKGROUND_STYLE_PRESETS_V36C = [
  "Anime",
  "Unreal Engine",
  "Comic Book",
  "Photorealistic",
  "3D Picture",
  "Cinematic",
] as const;

const CHARACTER_BACKGROUND_PROVIDER_PRESETS_V36C = [
  {
    id: "ernie-image",
    label: "Ernie Image",
    description: "Create a landscape 1280x720 background with Ernie Image.",
  },
  {
    id: "z-turbo",
    label: "Z Turbo",
    description: "Create a landscape 1280x720 background with Z Turbo.",
  },
  {
    id: "production-background",
    label: "Production Background Disabled",
    description: "Disabled old route.",
  },
  {
    id: "qwen-image",
    label: "Qwen Image Disabled",
    description: "Image model prompt path. Uses the current background route until dedicated Qwen routing is wired.",
  },
  {
    id: "qwen-360",
    label: "Qwen 360 Disabled",
    description: "360 environment intent. Dedicated 360 workflow wiring comes later.",
  },
] as const;

function buildCharacterBackgroundPromptV36C(parts: CharacterBackgroundPromptPartsV36C) {
  const manualPrompt = String(parts.promptOverride || "").trim();
  const landscapeLock = "Landscape 16:9 composition, 1280x720 resolution, horizontal frame, wide cinematic background plate, no vertical portrait framing.";

  if (manualPrompt) {
    return `${manualPrompt} ${landscapeLock}`.trim();
  }

  return [
    "Create a reusable production background image with no characters and no text.",
    landscapeLock,
    parts.name ? `Background name: ${parts.name}.` : "",
    parts.locationType ? `Location type: ${parts.locationType}.` : "",
    parts.style ? `Visual style: ${parts.style}.` : "",
    parts.describeScene ? `Scene description: ${parts.describeScene}.` : "",
    "The image should be clean, cinematic, detailed, and suitable as a stable background reference for later storyboard scenes.",
  ]
    .filter(Boolean)
    .join(" ");
}

function clampCharacterBackgroundPreviewCountV36C(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(5, Math.floor(n)));
}

// OTG_CHARACTER_BACKGROUND_STUDIO_UX_V36C

type CharacterBackgroundPreviewCandidateV36E = {
  id: string;
  name: string;
  imagePath?: string;
  imageUrl?: string;
  displayImage?: string;
  workflowImage?: string;
  prompt: string;
  provider: string;
  createdAt: string;
};

const CHARACTER_BACKGROUND_STYLE_PRESETS_V36E = [
  "Anime",
  "Unreal Engine",
  "Comic Book",
  "Photorealistic",
  "3D Picture",
  "Cinematic",
] as const;

const CHARACTER_BACKGROUND_PROVIDER_PRESETS_V36E = [
  {
    id: "ernie-image" as const,
    label: "Ernie Image",
    description: "Create one 1280x720 landscape preview with the existing Ernie image path.",
  },
  {
    id: "z-turbo" as const,
    label: "Z Turbo",
    description: "Create one 1280x720 landscape preview with the Z Turbo workflow.",
  },
] as const;

function buildCharacterBackgroundPromptV36E(args: {
  name: string;
  locationType: string;
  style: string;
  describeScene: string;
  promptOverride: string;
}) {
  const landscapeLock = "Landscape 16:9 composition, 1280x720 resolution, horizontal frame, wide cinematic background plate, no vertical portrait framing, no characters, no text.";
  const manualPrompt = String(args.promptOverride || "").trim();

  if (manualPrompt) {
    return `${manualPrompt} ${landscapeLock}`.trim();
  }

  return [
    "Create a reusable production background image.",
    landscapeLock,
    args.name ? `Background name: ${args.name}.` : "",
    args.locationType ? `Location type: ${args.locationType}.` : "",
    args.style ? `Visual style: ${args.style}.` : "",
    args.describeScene ? `Scene description: ${args.describeScene}.` : "",
    "Clean stable environment reference, detailed but not cluttered, suitable for later 360 panorama and angle-plate generation.",
  ]
    .filter(Boolean)
    .join(" ");
}

function clampCharacterBackgroundPreviewCountV36E(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(1, Math.min(5, Math.floor(parsed)));
}

function randomCharacterBackgroundSeedV36E() {
  return String(Math.floor(Math.random() * 999_999_999_999_999));
}

function appendBackgroundComfyRoutingFieldsV36E(
  body: FormData,
  provider: "ernie-image" | "z-turbo" | "krea2-turbo" | "krea2-turbo",
) {
  body.set("orientation", "landscape");
  body.set("width", "1280");
  body.set("height", "720");
  body.set("imageWidth", "1280");
  body.set("imageHeight", "720");
  body.set("resolution", "1280x720");
  body.set("aspectRatio", "16:9");
  body.set("seed", randomCharacterBackgroundSeedV36E());
  body.set("batchSize", "1");
  body.set("numImages", "1");
  body.set("imageCount", "1");
  body.set("requestKind", "characters-background-studio-preview");
  body.set("sourceType", "characters-background-studio");
  body.set("saveToGallery", "false");
  body.set("save_to_gallery", "false");
  body.set("persistToGallery", "false");
  body.set("addToGallery", "false");
  body.set("copyToGallery", "false");
  body.set("gallery", "false");
  body.set("assetLibraryOnly", "true");
  body.set("outputLibrary", "backgrounds");
  body.set("galleryExclusionPolicy", "background-candidate-only");
  body.set("outputFormat", "png");

  if (provider === "z-turbo") {
    body.set("workflowId", "workflows/characters/character-z-image-turbo.json");
    body.set("workflowFile", "workflows/characters/character-z-image-turbo.json");
    body.set("workflowPath", "workflows/characters/character-z-image-turbo.json");
    body.set("workflowJsonPath", "workflows/characters/character-z-image-turbo.json");
    body.set("workflowPresetPath", "workflows/characters/character-z-image-turbo.json");
    body.set("workflowLabel", "characters/z-image-turbo");
    body.set("characterGeneratorOption", "z-turbo");
    body.set("characterGeneratorLabel", "Z Turbo");
    return;
  }

  if (provider === "krea2-turbo") {
    body.set("workflowId", "workflows/backgrounds/krea2-turbo.json");
    body.set("workflowFile", "workflows/backgrounds/krea2-turbo.json");
    body.set("workflowPath", "workflows/backgrounds/krea2-turbo.json");
    body.set("workflowJsonPath", "workflows/backgrounds/krea2-turbo.json");
    body.set("workflowPresetPath", "workflows/backgrounds/krea2-turbo.json");
    body.set("workflowLabel", "backgrounds/krea2-turbo");
    body.set("characterGeneratorOption", "krea2-turbo");
    body.set("characterGeneratorLabel", "Krea2 Turbo");
    body.set("promptNodeId", "51");
    body.set("promptNodeInput", "text");
    body.set("positivePromptNodeId", "51");
    body.set("positivePromptNodeInput", "text");
    body.set("saveImageNodeId", "29");
    body.set("saveImageInput", "filename_prefix");
    body.set("seedNodeId", "53");
    body.set("seedNodeInput", "seed");
    return;
  }

  body.set("workflowId", "presets/Create a Picture");
  body.set("workflowLabel", "Ernie Images");
  body.set("characterGeneratorOption", "ernie");
  body.set("characterGeneratorLabel", "Ernie Images");
}

function firstStringV36E(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }

  return "";
}

function extractBackgroundPreviewCandidateV36E(args: {
  json: any;
  provider: string;
  prompt: string;
  index: number;
  name: string;
}): CharacterBackgroundPreviewCandidateV36E {
  const firstImage =
    Array.isArray(args.json?.images) && args.json.images[0] ? args.json.images[0] :
    Array.isArray(args.json?.items) && args.json.items[0] ? args.json.items[0] :
    Array.isArray(args.json?.outputs) && args.json.outputs[0] ? args.json.outputs[0] :
    null;

  const imagePath = firstStringV36E(
    args.json?.imagePath,
    args.json?.outputPath,
    args.json?.filePath,
    args.json?.serverPath,
    args.json?.path,
    firstImage?.imagePath,
    firstImage?.outputPath,
    firstImage?.filePath,
    firstImage?.serverPath,
    firstImage?.path,
  );

  const imageUrl = firstStringV36E(
    args.json?.imageUrl,
    args.json?.fileUrl,
    args.json?.outputUrl,
    args.json?.url,
    firstImage?.imageUrl,
    firstImage?.fileUrl,
    firstImage?.outputUrl,
    firstImage?.url,
  );

  const displayImage = imageUrl || imagePath;
  const workflowImage = imagePath || imageUrl;

  if (!displayImage && !workflowImage) {
    throw new Error("ComfyUI preview response did not include an image path or URL.");
  }

  return {
    id: `background-preview-${Date.now()}-${args.index}`,
    name: `${args.name || "Background"} Preview ${args.index + 1}`,
    imagePath: imagePath || undefined,
    imageUrl: imageUrl || undefined,
    displayImage: displayImage || undefined,
    workflowImage: workflowImage || undefined,
    prompt: args.prompt,
    provider: args.provider,
    createdAt: new Date().toISOString(),
  };
}


async function waitForBackgroundPreviewV36G(ms: number) {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeRecentBackgroundImageV36G(item: any, fallbackName: string) {
  if (!item || typeof item !== "object") return null;

  const imagePath = firstStringV36E(
    item.imagePath,
    item.filePath,
    item.serverPath,
    item.path,
    item.filename,
    item.name,
  );

  const imageUrl = firstStringV36E(
    item.imageUrl,
    item.fileUrl,
    item.outputUrl,
    item.url,
    item.src,
  );

  const displayImage = imageUrl || imagePath;
  const workflowImage = imagePath || imageUrl;

  if (!displayImage && !workflowImage) return null;

  return {
    imagePath: imagePath || undefined,
    imageUrl: imageUrl || undefined,
    displayImage: displayImage || undefined,
    workflowImage: workflowImage || undefined,
    name: firstStringV36E(item.name, item.filename, fallbackName),
  };
}

async function findRecentBackgroundPreviewCandidateV36G(args: {
  provider: string;
  prompt: string;
  index: number;
  name: string;
  title: string;
}): Promise<CharacterBackgroundPreviewCandidateV36E | null> {
  const searchTerms = [
    args.title.toLowerCase(),
    `${args.name}-preview-${args.index + 1}`.toLowerCase(),
    args.name.toLowerCase(),
    "z-image-turbo",
  ].filter(Boolean);

  const endpoints = [
    "/api/production/recent-images",
    "/api/gallery?limit=50",
    "/api/gallery/recent?limit=50",
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) continue;

      const json = await response.json().catch(() => null);
      const arrays = [
        json?.items,
        json?.images,
        json?.files,
        json?.results,
        Array.isArray(json) ? json : null,
      ].filter(Array.isArray) as any[][];

      for (const list of arrays) {
        for (const item of list) {
          const haystack = JSON.stringify(item || {}).toLowerCase();
          const matched = searchTerms.some((term) => term && haystack.includes(term));
          if (!matched) continue;

          const normalized = normalizeRecentBackgroundImageV36G(item, args.title);
          if (!normalized) continue;

          return {
            id: `background-preview-${Date.now()}-${args.index}`,
            name: normalized.name || `${args.name || "Background"} Preview ${args.index + 1}`,
            imagePath: normalized.imagePath,
            imageUrl: normalized.imageUrl,
            displayImage: normalized.displayImage,
            workflowImage: normalized.workflowImage,
            prompt: args.prompt,
            provider: args.provider,
            createdAt: new Date().toISOString(),
          };
        }
      }
    } catch {
      // Try the next endpoint.
    }
  }

  return null;
}

// OTG_BACKGROUND_PREVIEW_RECOVERY_V36G

function displayUrlForBackgroundCandidateV36H(value: string) {
  const text = String(value || "").trim();
  if (!text) return "";

  if (/^https?:\/\//i.test(text) || text.startsWith("/api/") || text.startsWith("/")) {
    return text;
  }

  if (/^[a-zA-Z]:\\/.test(text) || text.startsWith("\\\\")) {
    return `/api/file?path=${encodeURIComponent(text)}`;
  }

  if (/\.(png|jpg|jpeg|webp|bmp)$/i.test(text)) {
    return `/api/comfy-image?filename=${encodeURIComponent(text)}&type=output`;
  }

  return text;
}

function collectBackgroundImageStringsV36H(value: any, output: string[] = [], depth = 0) {
  if (depth > 8 || value == null) return output;

  if (typeof value === "string") {
    const text = value.trim();
    if (
      /^https?:\/\//i.test(text) ||
      text.startsWith("/api/") ||
      text.startsWith("/") ||
      /^[a-zA-Z]:\\/.test(text) ||
      /\.(png|jpg|jpeg|webp|bmp)$/i.test(text)
    ) {
      output.push(text);
    }
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectBackgroundImageStringsV36H(item, output, depth + 1);
    return output;
  }

  if (typeof value === "object") {
    for (const key of [
      "imagePath",
      "imageUrl",
      "filePath",
      "fileUrl",
      "outputPath",
      "outputUrl",
      "serverPath",
      "path",
      "url",
      "src",
      "filename",
      "name",
    ]) {
      if (typeof value[key] === "string") {
        collectBackgroundImageStringsV36H(value[key], output, depth + 1);
      }
    }

    for (const nested of Object.values(value)) {
      collectBackgroundImageStringsV36H(nested, output, depth + 1);
    }
  }

  return output;
}

function extractBackgroundPreviewCandidateV36H(args: {
  json: any;
  provider: string;
  prompt: string;
  index: number;
  name: string;
}): CharacterBackgroundPreviewCandidateV36E {
  const found = collectBackgroundImageStringsV36H(args.json)
    .filter((value, index, array) => array.indexOf(value) === index)
    .find((value) => /\.(png|jpg|jpeg|webp|bmp)(\?|$)/i.test(value) || value.includes("/api/file") || value.includes("/api/comfy-image"));

  if (!found) {
    throw new Error("ComfyUI preview response did not include an image path or URL.");
  }

  const isLocalPath = /^[a-zA-Z]:\\/.test(found) || found.startsWith("\\\\");
  const isFilenameOnly = !isLocalPath && !/^https?:\/\//i.test(found) && !found.startsWith("/") && /\.(png|jpg|jpeg|webp|bmp)$/i.test(found);

  const imagePath = isLocalPath || isFilenameOnly ? found : "";
  const imageUrl = displayUrlForBackgroundCandidateV36H(found);

  return {
    id: `background-preview-${Date.now()}-${args.index}`,
    name: `${args.name || "Background"} Preview ${args.index + 1}`,
    imagePath: imagePath || undefined,
    imageUrl: imageUrl || undefined,
    displayImage: imageUrl || imagePath || undefined,
    workflowImage: imagePath || imageUrl || undefined,
    prompt: args.prompt,
    provider: args.provider,
    createdAt: new Date().toISOString(),
  };
}

// OTG_BACKGROUND_PREVIEW_EXTRACTOR_V36H

function displayUrlForBackgroundCandidateV36I(value: string) {
  const text = String(value || "").trim();
  if (!text) return "";

  if (/^https?:\/\//i.test(text) || text.startsWith("/api/") || text.startsWith("/")) {
    return text;
  }

  if (/^[a-zA-Z]:\\/.test(text) || text.startsWith("\\\\")) {
    return `/api/file?path=${encodeURIComponent(text)}`;
  }

  if (/\.(png|jpg|jpeg|webp|bmp)$/i.test(text)) {
    return `/api/comfy-image?filename=${encodeURIComponent(text)}&type=output`;
  }

  return text;
}

function collectBackgroundImageStringsV36I(value: any, output: string[] = [], depth = 0) {
  if (depth > 8 || value == null) return output;

  if (typeof value === "string") {
    const text = value.trim();

    if (
      /^https?:\/\//i.test(text) ||
      text.startsWith("/api/") ||
      text.startsWith("/") ||
      /^[a-zA-Z]:\\/.test(text) ||
      /\.(png|jpg|jpeg|webp|bmp)$/i.test(text)
    ) {
      output.push(text);
    }

    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectBackgroundImageStringsV36I(item, output, depth + 1);
    return output;
  }

  if (typeof value === "object") {
    for (const nested of Object.values(value)) {
      collectBackgroundImageStringsV36I(nested, output, depth + 1);
    }
  }

  return output;
}

async function findAnyRecentBackgroundPreviewCandidateV36I(args: {
  provider: "ernie-image" | "z-turbo" | "krea2-turbo" | "krea2-turbo" | "krea2-turbo";
  prompt: string;
  index: number;
  name: string;
  title: string;
}): Promise<CharacterBackgroundPreviewCandidateV36E | null> {
  const endpoints = [
    "/api/progress",
    "/api/production/recent-images",
    "/api/gallery?limit=100",
    "/api/content/last",
    "/api/preview",
  ];

  const searchTerms = [
    args.title.toLowerCase(),
    `${args.name}-preview-${args.index + 1}`.toLowerCase(),
    args.name.toLowerCase(),
    "z-image-turbo",
    "preview",
  ].filter(Boolean);

  let fallbackValue = "";

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) continue;

      const json = await response.json().catch(() => null);
      const values = collectBackgroundImageStringsV36I(json)
        .filter((value, index, array) => array.indexOf(value) === index)
        .filter((value) => /\.(png|jpg|jpeg|webp|bmp)(\?|$)/i.test(value) || value.includes("/api/file") || value.includes("/api/comfy-image"));

      for (const value of values) {
        const haystack = value.toLowerCase();

        if (!fallbackValue) {
          fallbackValue = value;
        }

        if (searchTerms.some((term) => term && haystack.includes(term))) {
          const displayImage = displayUrlForBackgroundCandidateV36I(value);
          const isLocalPath = /^[a-zA-Z]:\\/.test(value) || value.startsWith("\\\\");
          const isFilenameOnly = !isLocalPath && !/^https?:\/\//i.test(value) && !value.startsWith("/") && /\.(png|jpg|jpeg|webp|bmp)$/i.test(value);

          return {
            id: `background-preview-${Date.now()}-${args.index}`,
            name: `${args.name || "Background"} Preview ${args.index + 1}`,
            imagePath: isLocalPath || isFilenameOnly ? value : undefined,
            imageUrl: displayImage,
            displayImage,
            workflowImage: isLocalPath || isFilenameOnly ? value : displayImage,
            prompt: args.prompt,
            provider: args.provider,
            createdAt: new Date().toISOString(),
          };
        }
      }
    } catch {
      // Try next endpoint.
    }
  }

  if (fallbackValue) {
    const displayImage = displayUrlForBackgroundCandidateV36I(fallbackValue);
    const isLocalPath = /^[a-zA-Z]:\\/.test(fallbackValue) || fallbackValue.startsWith("\\\\");
    const isFilenameOnly = !isLocalPath && !/^https?:\/\//i.test(fallbackValue) && !fallbackValue.startsWith("/") && /\.(png|jpg|jpeg|webp|bmp)$/i.test(fallbackValue);

    return {
      id: `background-preview-${Date.now()}-${args.index}`,
      name: `${args.name || "Background"} Preview ${args.index + 1}`,
      imagePath: isLocalPath || isFilenameOnly ? fallbackValue : undefined,
      imageUrl: displayImage,
      displayImage,
      workflowImage: isLocalPath || isFilenameOnly ? fallbackValue : displayImage,
      prompt: args.prompt,
      provider: args.provider,
      createdAt: new Date().toISOString(),
    };
  }

  return null;
}

// OTG_BACKGROUND_PREVIEW_FALLBACK_V36I

function backgroundPreviewDisplayUrlV36J(value: string) {
  const text = String(value || "").trim();
  if (!text) return "";

  if (/^https?:\/\//i.test(text) || text.startsWith("/api/") || text.startsWith("/")) {
    return text;
  }

  if (/^[a-zA-Z]:\\/.test(text) || text.startsWith("\\\\")) {
    return `/api/file?path=${encodeURIComponent(text)}`;
  }

  if (/\.(png|jpg|jpeg|webp|bmp)$/i.test(text)) {
    return `/api/comfy-image?filename=${encodeURIComponent(text)}&type=output`;
  }

  return text;
}

function collectBackgroundImageStringsV36J(value: any, output: string[] = [], depth = 0) {
  if (depth > 8 || value == null) return output;

  if (typeof value === "string") {
    const text = value.trim();

    if (
      /^https?:\/\//i.test(text) ||
      text.startsWith("/api/") ||
      text.startsWith("/") ||
      /^[a-zA-Z]:\\/.test(text) ||
      /\.(png|jpg|jpeg|webp|bmp)$/i.test(text)
    ) {
      output.push(text);
    }

    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectBackgroundImageStringsV36J(item, output, depth + 1);
    return output;
  }

  if (typeof value === "object") {
    for (const nested of Object.values(value)) {
      collectBackgroundImageStringsV36J(nested, output, depth + 1);
    }
  }

  return output;
}

function safeBackgroundPreviewSlugV36J(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function makeBackgroundCandidateFromImageValueV36J(args: {
  value: string;
  provider: "ernie-image" | "z-turbo" | "krea2-turbo" | "krea2-turbo" | "krea2-turbo";
  prompt: string;
  index: number;
  name: string;
}): CharacterBackgroundPreviewCandidateV36E {
  const value = String(args.value || "").trim();
  const displayImage = backgroundPreviewDisplayUrlV36J(value);
  const isLocalPath = /^[a-zA-Z]:\\/.test(value) || value.startsWith("\\\\");
  const isFilenameOnly =
    !isLocalPath &&
    !/^https?:\/\//i.test(value) &&
    !value.startsWith("/") &&
    /\.(png|jpg|jpeg|webp|bmp)$/i.test(value);

  return {
    id: `background-preview-${Date.now()}-${args.index}-${Math.random().toString(36).slice(2, 8)}`,
    name: `${args.name || "Background"} Preview ${args.index + 1}`,
    imagePath: isLocalPath || isFilenameOnly ? value : undefined,
    imageUrl: displayImage,
    displayImage,
    workflowImage: isLocalPath || isFilenameOnly ? value : displayImage,
    prompt: args.prompt,
    provider: args.provider,
    createdAt: new Date().toISOString(),
  };
}

async function recoverBackgroundPreviewBatchV36J(args: {
  provider: "ernie-image" | "z-turbo" | "krea2-turbo" | "krea2-turbo" | "krea2-turbo";
  prompt: string;
  previewCount: number;
  name: string;
}) {
  const endpoints = [
    "/api/progress",
    "/api/production/recent-images",
    "/api/gallery?limit=120",
    "/api/content/last",
    "/api/preview",
  ];

  const entries: Array<{ value: string; haystack: string; order: number }> = [];
  let order = 0;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) continue;

      const json = await response.json().catch(() => null);

      const walk = (value: any, depth = 0) => {
        if (depth > 7 || value == null) return;

        if (typeof value === "object") {
          const haystack = JSON.stringify(value || {}).toLowerCase();
          const images = collectBackgroundImageStringsV36J(value)
            .filter((item, index, array) => array.indexOf(item) === index)
            .filter((item) => /\.(png|jpg|jpeg|webp|bmp)(\?|$)/i.test(item) || item.includes("/api/file") || item.includes("/api/comfy-image"));

          for (const image of images) {
            entries.push({
              value: image,
              haystack,
              order: order++,
            });
          }

          if (Array.isArray(value)) {
            for (const item of value) walk(item, depth + 1);
          } else {
            for (const nested of Object.values(value)) walk(nested, depth + 1);
          }
        }
      };

      walk(json);
    } catch {
      // Try the next endpoint.
    }
  }

  const uniqueEntries: Array<{ value: string; haystack: string; order: number }> = [];
  const seenValues = new Set<string>();

  for (const entry of entries) {
    const key = entry.value.toLowerCase();
    if (seenValues.has(key)) continue;
    seenValues.add(key);
    uniqueEntries.push(entry);
  }

  const selected: CharacterBackgroundPreviewCandidateV36E[] = [];
  const usedValues = new Set<string>();
  const baseSlug = safeBackgroundPreviewSlugV36J(args.name || "background");

  for (let index = 0; index < args.previewCount; index += 1) {
    const previewNo = index + 1;
    const expectedTerms = [
      `${baseSlug}-preview-${previewNo}`,
      `preview-${previewNo}`,
      `${args.name || ""}-preview-${previewNo}`.toLowerCase(),
    ].filter(Boolean);

    let match = uniqueEntries.find((entry) => {
      if (usedValues.has(entry.value.toLowerCase())) return false;
      return expectedTerms.some((term) => entry.haystack.includes(term) || entry.value.toLowerCase().includes(term));
    });

    if (!match) {
      match = uniqueEntries.find((entry) => !usedValues.has(entry.value.toLowerCase()));
    }

    if (!match) continue;

    usedValues.add(match.value.toLowerCase());

    selected.push(makeBackgroundCandidateFromImageValueV36J({
      value: match.value,
      provider: args.provider,
      prompt: args.prompt,
      index,
      name: args.name,
    }));
  }

  return selected.slice(0, args.previewCount);
}

// OTG_BACKGROUND_MULTI_PREVIEW_RECOVERY_V36J

function decodePreviewMatchTextV36R(value: string) {
  const text = String(value || "").toLowerCase();

  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function backgroundPreviewDisplayUrlV36R(value: string) {
  const text = String(value || "").trim();
  if (!text) return "";

  if (/^https?:\/\//i.test(text) || text.startsWith("/api/") || text.startsWith("/")) {
    return text;
  }

  if (/^[a-zA-Z]:\\/.test(text) || text.startsWith("\\\\")) {
    return `/api/file?path=${encodeURIComponent(text)}`;
  }

  if (/\.(png|jpg|jpeg|webp|bmp)$/i.test(text)) {
    return `/api/comfy-image?filename=${encodeURIComponent(text)}&type=output`;
  }

  return text;
}

function collectBackgroundPreviewImageStringsV36R(value: any, output: string[] = [], depth = 0) {
  if (depth > 8 || value == null) return output;

  if (typeof value === "string") {
    const text = value.trim();

    if (
      /^https?:\/\//i.test(text) ||
      text.startsWith("/api/") ||
      text.startsWith("/") ||
      /^[a-zA-Z]:\\/.test(text) ||
      /\.(png|jpg|jpeg|webp|bmp)$/i.test(text)
    ) {
      output.push(text);
    }

    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectBackgroundPreviewImageStringsV36R(item, output, depth + 1);
    return output;
  }

  if (typeof value === "object") {
    for (const nested of Object.values(value)) {
      collectBackgroundPreviewImageStringsV36R(nested, output, depth + 1);
    }
  }

  return output;
}

function makeExactBackgroundPreviewCandidateV36R(args: {
  value: string;
  provider: "ernie-image" | "z-turbo" | "krea2-turbo" | "krea2-turbo" | "krea2-turbo";
  prompt: string;
  index: number;
  name: string;
}) {
  const value = String(args.value || "").trim();
  const displayImage = backgroundPreviewDisplayUrlV36R(value);
  const isLocalPath = /^[a-zA-Z]:\\/.test(value) || value.startsWith("\\\\");
  const isFilenameOnly =
    !isLocalPath &&
    !/^https?:\/\//i.test(value) &&
    !value.startsWith("/") &&
    /\.(png|jpg|jpeg|webp|bmp)$/i.test(value);

  return {
    id: `background-preview-${Date.now()}-${args.index}-${Math.random().toString(36).slice(2, 8)}`,
    name: `${args.name || "Background"} Preview ${args.index + 1}`,
    imagePath: isLocalPath || isFilenameOnly ? value : undefined,
    imageUrl: displayImage,
    displayImage,
    workflowImage: isLocalPath || isFilenameOnly ? value : displayImage,
    prompt: args.prompt,
    provider: args.provider,
    createdAt: new Date().toISOString(),
  } as CharacterBackgroundPreviewCandidateV36E;
}

async function findExactBackgroundPreviewCandidateV36R(args: {
  provider: "ernie-image" | "z-turbo" | "krea2-turbo" | "krea2-turbo" | "krea2-turbo";
  prompt: string;
  index: number;
  name: string;
  title: string;
}): Promise<CharacterBackgroundPreviewCandidateV36E | null> {
  const exactTitle = String(args.title || "").trim().toLowerCase();

  if (!exactTitle) return null;

  // OTG_BACKGROUND_EXACT_COMFY_OUTPUT_PROBE_V36BPV4
  // Current-run background previews may be visible in ComfyUI output before they appear in app
  // progress/gallery/content endpoints. Probe the exact expected SaveImage filenames first.
  const exactOutputFilenamesV36BPV4 = [
    `${args.title}_00001_.png`,
    `${args.title}_00001.png`,
    `${args.title}.png`,
  ].filter((value, index, array) => value && array.indexOf(value) === index);

  for (const filename of exactOutputFilenamesV36BPV4) {
    try {
      const response = await fetch(
        `/api/preview/file?name=${encodeURIComponent(filename)}&t=${Date.now().toString(36)}`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
      );

      if (!response.ok) continue;

      return makeExactBackgroundPreviewCandidateV36R({
          value: filename,
          provider: args.provider,
          prompt: args.prompt,
          index: args.index,
          name: args.name,
      });
    } catch {
      // Keep polling fallback endpoints.
    }
  }

  const endpoints = [
    "/api/progress",
    "/api/production/recent-images",
    "/api/gallery?limit=150",
    "/api/content/last",
    "/api/preview",
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) continue;

      const json = await response.json().catch(() => null);
      const values = collectBackgroundPreviewImageStringsV36R(json)
        .filter((value, index, array) => array.indexOf(value) === index)
        .filter((value) => /\.(png|jpg|jpeg|webp|bmp)(\?|$)/i.test(value) || value.includes("/api/file") || value.includes("/api/comfy-image"));

      for (const value of values) {
        const raw = String(value || "").toLowerCase();
        const decoded = decodePreviewMatchTextV36R(value);

        if (raw.includes(exactTitle) || decoded.includes(exactTitle)) {
          return makeExactBackgroundPreviewCandidateV36R({
            value,
            provider: args.provider,
            prompt: args.prompt,
            index: args.index,
            name: args.name,
          });
        }
      }
    } catch {
      // Try next endpoint.
    }
  }

  return null;
}


function backgroundPreviewBestImageValueV36S(candidate: Partial<CharacterBackgroundPreviewCandidateV36E & CharacterBackgroundReferenceV36A> | null | undefined) {
  const item: any = candidate || {};
  return String(item.workflowImage || item.imagePath || item.displayImage || item.imageUrl || "").trim();
}

function backgroundPreviewFullResSrcV36S(value: string) {
  const src = backgroundPreviewDisplayUrlV36R(value);
  if (!src) return "";

  const raw = String(value || "").trim();
  const version = encodeURIComponent(raw.slice(-96) || "image");
  const joiner = src.includes("?") ? "&" : "?";

  return `${src}${joiner}otgFullRes=1&v=${version}`;
}

function backgroundPreviewImageSrcV36S(candidate: Partial<CharacterBackgroundPreviewCandidateV36E & CharacterBackgroundReferenceV36A> | null | undefined) {
  return backgroundPreviewFullResSrcV36S(backgroundPreviewBestImageValueV36S(candidate));
}

function backgroundPreviewComfyLoadImageValueV36S(value: string) {
  let text = String(value || "").trim();
  if (!text) return "";

  try {
    const parsed = new URL(text, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const filename = parsed.searchParams.get("filename");
    const path = parsed.searchParams.get("path");

    if (filename) text = filename;
    if (path) text = path;
  } catch {
    // Keep original text.
  }

  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep original text.
  }

  text = text.replace(/\?.*$/, "").replace(/\\/g, "/").trim();

  if (/\s\[(output|input|temp)\]$/i.test(text)) {
    return text;
  }

  const basename = text.split("/").filter(Boolean).pop() || text;

  if (/\.(png|jpg|jpeg|webp|bmp)$/i.test(basename)) {
    return `${basename} [output]`;
  }

  return basename;
}


function backgroundPreviewComfyFilenameV36V(value: string) {
  let text = String(value || "").trim();
  if (!text) return "";

  try {
    const parsed = new URL(text, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const filename = parsed.searchParams.get("filename");
    const path = parsed.searchParams.get("path");

    if (filename) text = filename;
    else if (path) text = path;
  } catch {
    // Keep original text.
  }

  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep original text.
  }

  text = text.replace(/\?.*$/, "").replace(/\\/g, "/").trim();

  if (/\s\[(output|input|temp)\]$/i.test(text)) {
    text = text.replace(/\s\[(output|input|temp)\]$/i, "").trim();
  }

  const basename = text.split("/").filter(Boolean).pop() || text;

  if (!/\.(png|jpg|jpeg|webp|bmp)$/i.test(basename)) {
    return "";
  }

  return basename;
}

function backgroundPreviewNativeComfyBaseV36V() {
  if (typeof window === "undefined") return "http://127.0.0.1:8188";

  const stored =
    window.localStorage.getItem("otg:comfy-browser-base-url:v36v") ||
    window.localStorage.getItem("otg:comfy-browser-base-url") ||
    "";

  return String(stored || "http://127.0.0.1:8188").replace(/\/+$/, "");
}

function backgroundPreviewNativeComfySrcV36V(candidate: Partial<CharacterBackgroundPreviewCandidateV36E & CharacterBackgroundReferenceV36A> | null | undefined) {
  const value = backgroundPreviewBestImageValueV36S(candidate);
  const filename = backgroundPreviewComfyFilenameV36V(value);

  if (!filename) return "";

  const base = backgroundPreviewNativeComfyBaseV36V();
  const stamp = Date.now().toString(36);

  return `${base}/view?filename=${encodeURIComponent(filename)}&type=output&subfolder=&t=${stamp}`;
}

function backgroundPreviewProxySrcV36V(candidate: Partial<CharacterBackgroundPreviewCandidateV36E & CharacterBackgroundReferenceV36A> | null | undefined) {
  return backgroundPreviewImageSrcV36S(candidate);
}

function backgroundPreviewPreferredDisplaySrcV36V(candidate: Partial<CharacterBackgroundPreviewCandidateV36E & CharacterBackgroundReferenceV36A> | null | undefined) {
  return backgroundPreviewNativeComfySrcV36V(candidate) || backgroundPreviewProxySrcV36V(candidate);
}

function backgroundPreviewFallbackToProxyV36V(event: React.SyntheticEvent<HTMLImageElement>, candidate: Partial<CharacterBackgroundPreviewCandidateV36E & CharacterBackgroundReferenceV36A> | null | undefined) {
  const proxySrc = backgroundPreviewProxySrcV36V(candidate);

  if (!proxySrc) return;

  const image = event.currentTarget;

  if (image.src !== proxySrc) {
    image.src = proxySrc;
  }
}

// OTG_BACKGROUND_NATIVE_COMFY_PREVIEW_V36V

async function waitForBackgroundRemovePeopleOutputCandidateV36AE(args: {
  provider: "ernie-image" | "z-turbo" | "krea2-turbo" | "krea2-turbo" | "krea2-turbo";
  prompt: string;
  index: number;
  name: string;
  prefix: string;
  timeoutMs?: number;
}) {
  const cleanPrefix = String(args.prefix || "").trim();

  if (!cleanPrefix) return null;

  const timeoutMs = args.timeoutMs || 240000;
  const started = Date.now();

  const candidateFilenames = [
    `${cleanPrefix}_00001_.png`,
    `${cleanPrefix}_00001.png`,
    `${cleanPrefix}.png`,
  ];

  while (Date.now() - started < timeoutMs) {
    for (const filename of candidateFilenames) {
      try {
        const response = await fetch(
          `/api/preview/file?name=${encodeURIComponent(filename)}&t=${Date.now().toString(36)}`,
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          },
        );

        if (!response.ok) continue;

        const json = await response.json().catch(() => null);

        if (json?.ok && (json?.resolvedPath || json?.exists)) {
          return makeExactBackgroundPreviewCandidateV36R({
            value: filename,
            provider: args.provider,
            prompt: args.prompt,
            index: args.index,
            name: args.name,
          });
        }
      } catch {
        // Keep polling until timeout.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return null;
}

// OTG_BACKGROUND_REMOVE_PEOPLE_REPLACE_PREVIEW_V36AE

async function waitForBackgroundAnglePlateOutputCandidateV36AF(args: {
  provider: "ernie-image" | "z-turbo" | "krea2-turbo" | "krea2-turbo" | "krea2-turbo";
  prompt: string;
  index: number;
  name: string;
  prefix: string;
  timeoutMs?: number;
}) {
  const cleanPrefix = String(args.prefix || "").trim();

  if (!cleanPrefix) return null;

  const timeoutMs = args.timeoutMs || 900000;
  const started = Date.now();

  const candidateFilenames = [
    `${cleanPrefix}_00001_.png`,
    `${cleanPrefix}_00001.png`,
    `${cleanPrefix}.png`,
  ];

  while (Date.now() - started < timeoutMs) {
    for (const filename of candidateFilenames) {
      try {
        const response = await fetch(
          `/api/preview/file?name=${encodeURIComponent(filename)}&t=${Date.now().toString(36)}`,
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          },
        );

        if (!response.ok) continue;

        const json = await response.json().catch(() => null);

        if (json?.ok && (json?.resolvedPath || json?.exists)) {
          return makeExactBackgroundPreviewCandidateV36R({
            value: filename,
            provider: args.provider,
            prompt: args.prompt,
            index: args.index,
            name: args.name,
          });
        }
      } catch {
        // Keep polling.
      }
    }

    await new Promise((resolve) => window.setTimeout(resolve, 5000));
  }

  return null;
}


function normalizeCompleteBackgroundPlateCandidateForSaveV36AG(candidate: CharacterBackgroundPreviewCandidateV36E) {
  const item: any = candidate || {};

  if (!item?.isCompleteBackgroundPlateV36AF) {
    return candidate;
  }

  const sourceDisplay =
    String(
      item.sourceDisplayImageV36AF ||
        item.sourceWorkflowImageV36AF ||
        item.displayImage ||
        item.imageUrl ||
        item.imagePath ||
        item.workflowImage ||
        "",
    ).trim();

  const plateWorkflow =
    String(
      item.plateWorkflowImageV36AF ||
        item.workflowImage ||
        item.imagePath ||
        item.displayImage ||
        item.imageUrl ||
        "",
    ).trim();

  return {
    ...candidate,

    // This is what the user sees as the saved background card/default reference.
    displayImage: sourceDisplay,
    imageUrl: sourceDisplay,
    imagePath: sourceDisplay,

    // This is what should be sent to ComfyUI/Storyboard workflows.
    workflowImage: plateWorkflow,
    plateWorkflowImageV36AF: plateWorkflow,

    sourceDisplayImageV36AF: sourceDisplay,
    sourceWorkflowImageV36AF: sourceDisplay,
    isCompleteBackgroundPlateV36AF: true,
  } as CharacterBackgroundPreviewCandidateV36E;
}


function fixBackgroundMojibakeV36AH3(value: string) {
  return String(value || "")
    .replace(/\u00c2\u00b7/g, " - ")
    .replace(/\u00c3\u0097/g, "x")
    .replace(/\u00e2\u0080\u0093/g, "-")
    .replace(/\u00e2\u0080\u0094/g, "-")
    .replace(/\u00e2\u0080\u0099/g, "'")
    .replace(/\s+-\s+/g, " - ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function savedBackgroundDisplayImageValueV36AH3(background: any) {
  const item: any = background || {};

  return String(
    item.sourceDisplayImageV36AF ||
      item.sourceWorkflowImageV36AF ||
      item.displayImage ||
      item.imageUrl ||
      item.imagePath ||
      "",
  ).trim();
}

function savedBackgroundWorkflowImageValueV36AH3(background: any) {
  const item: any = background || {};

  return String(
    item.plateWorkflowImageV36AF ||
      item.workflowImage ||
      item.imagePath ||
      item.displayImage ||
      item.imageUrl ||
      "",
  ).trim();
}

function savedBackgroundDisplaySrcV36AH3(background: any) {
  const displayValue = savedBackgroundDisplayImageValueV36AH3(background);

  if (displayValue) {
    return backgroundPreviewFullResSrcV36S(displayValue);
  }

  return backgroundPreviewProxySrcV36V(background);
}

function normalizeSavedBackgroundCandidateForSaveV36AH3(candidate: any) {
  const item: any = candidate || {};

  if (!item?.isCompleteBackgroundPlateV36AF) {
    return candidate;
  }

  const sourceDisplay = String(
    item.sourceDisplayImageV36AF ||
      item.sourceWorkflowImageV36AF ||
      item.displayImage ||
      item.imageUrl ||
      item.imagePath ||
      "",
  ).trim();

  const plateWorkflow = String(
    item.plateWorkflowImageV36AF ||
      item.workflowImage ||
      "",
  ).trim();

  const finalDisplay = sourceDisplay || String(item.displayImage || item.imageUrl || item.imagePath || "").trim();
  const finalWorkflow = plateWorkflow || String(item.workflowImage || item.imagePath || finalDisplay || "").trim();

  return {
    ...candidate,
    displayImage: finalDisplay,
    imageUrl: finalDisplay,
    imagePath: finalDisplay,
    workflowImage: finalWorkflow,
    sourceDisplayImageV36AF: finalDisplay,
    sourceWorkflowImageV36AF: finalDisplay,
    plateWorkflowImageV36AF: finalWorkflow,
    isCompleteBackgroundPlateV36AF: true,
  };
}

// OTG_SAVED_BACKGROUND_DISPLAY_FIX_V36AH3
// OTG_BACKGROUND_CARD_DISPLAY_VS_PLATE_V36AG
// OTG_BACKGROUND_ANGLE_PLATE_UI_V36AF
// OTG_BACKGROUND_FULL_RES_PREVIEW_AND_REMOVE_PEOPLE_V36S
// OTG_BACKGROUND_EXACT_PREVIEW_SYNC_V36R
// OTG_BACKGROUND_EXACT_PREVIEW_SYNC_VERIFIED_V36R - Sync only accepts exact current-run outputs
// OTG_BACKGROUND_STUDIO_DEDICATED_PAGE_V36E
// OTG_BACKGROUND_LIBRARY_API_V36B
// OTG_CHARACTER_BACKGROUND_STUDIO_V36A
type ImageCompleteness = "full_body" | "half_body" | "face_only";
type CharacterAnatomyMode = "standard" | "freeform";
type CharacterInputMode = "create" | "upload";
type CharacterCreateOrientation = "portrait" | "landscape";
type SourceFraming = "face" | "half_body" | "full_body";
type FullBodyStatus = "not_required" | "required" | "generated" | "approved";
type BuilderStep = "source" | "generate" | "upload" | "card" | "details" | "voice" | "review";

const FULL_BODY_REQUIRED_MESSAGE = "Full-body character image required before Character Card and Angles. Use the full-body generator or upload a complete full-body image.";
const FREEFORM_FULL_BODY_CONFIRM_MESSAGE = "Confirm the Freeform character is full-body/full-form before continuing.";
const FREEFORM_FULL_BODY_NOTICE = "Freeform characters must show the complete body or full form. No face-only, half-body, or cropped final images are allowed for Character Card or Angles.";

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

type CharacterIdentity = {
  name: string;
  age?: string;
  characterAnatomyMode?: CharacterAnatomyMode;
  characterInputMode?: CharacterInputMode;
  characterType?: string;
  bodyForm?: string;
  lowerBodyLocomotion?: string;
  surfaceDescription?: string;
  hairFurColor?: string;
  eyeColor?: string;
  clothingAccessories?: string;
  distinctiveFeatures?: string;
  doNotChange: string[];
  promptReadyDescription: string;
  lockedAt?: string;
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

async function characterFetchNestedDisabled(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlText = String(input || "");

  // OTG_CHARACTER_FETCH_TOP_LEVEL_GUARD
  // Prevent unresolved/shared pseudo owners from writing/restoring character data.
  if (
    urlText.includes("owner=profile_unresolved") ||
    urlText.includes("ownerId=profile_unresolved") ||
    urlText.includes("owner=web_characters_builder") ||
    urlText.includes("ownerId=web_characters_builder")
  ) {
    return new Response(
      JSON.stringify({
        ok: false,
        blocked: true,
        error: "Blocked Characters request with unresolved or shared owner.",
      }),
      {
        status: 409,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return fetch(input, init);
}
const characterFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlText = String(input || "");

  // OTG_CHARACTER_FETCH_TOP_LEVEL_GUARD_V2
  // Prevent unresolved/shared pseudo owners from writing/restoring character data.
  if (
    urlText.includes("owner=profile_unresolved") ||
    urlText.includes("ownerId=profile_unresolved") ||
    urlText.includes("owner=web_characters_builder") ||
    urlText.includes("ownerId=web_characters_builder")
  ) {
    return new Response(
      JSON.stringify({
        ok: false,
        blocked: true,
        error: "Blocked Characters request with unresolved or shared owner.",
      }),
      {
        status: 409,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return fetch(input, init);
};
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
function normalizeCharacterOwnerSegment(value: unknown, fallback = ""): string {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const safe = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 80);
  return safe || fallback;
}

function isRealCharacterOwnerKey(value: unknown): boolean {
  const key = normalizeCharacterOwnerSegment(value, "");
  if (!key) return false;
  if (key === "web_characters_builder") return false;
  if (key === "profile_unresolved") return false;
  if (key === "undefined") return false;
  if (key === "null") return false;
  if (key.length < 3) return false;
  return true;
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
    "profile",
    "name",
    "id",
  ];

  for (const key of directKeys) {
    const candidate = readCharacterOwnerCandidate(record[key]);
    if (isRealCharacterOwnerKey(candidate)) return candidate;
  }

  const nestedKeys = ["user", "account", "session", "currentUser", "activeUser", "activeProfile", "currentProfile"];
  for (const key of nestedKeys) {
    const candidate = readCharacterOwnerCandidate(record[key]);
    if (isRealCharacterOwnerKey(candidate)) return candidate;
  }

  return "";
}

function readCharacterOwnerFromDocument(): string {
  if (typeof document === "undefined") return "";

  const blocked = new Set([
    "dark",
    "classicui",
    "classic_ui",
    "settings",
    "characters",
    "comfyuiconnected",
    "back",
    "next",
    "startover",
    "image-locked",
    "charactercard-locked",
    "details-locked",
    "voicelab",
    "review&save",
    "reviewandsave",
  ]);

  const nodes = Array.from(document.querySelectorAll("button, [data-user], [data-profile], [aria-label]")) as HTMLElement[];
  const candidates: string[] = [];

  for (const el of nodes) {
    const raw = (
      el.getAttribute("data-user") ||
      el.getAttribute("data-profile") ||
      el.getAttribute("aria-label") ||
      el.textContent ||
      ""
    ).trim();

    if (!raw) continue;

    const cleanedRaw = raw.replace(/^profile\s*[:=-]\s*/i, "").trim();
    const owner = normalizeCharacterOwnerSegment(cleanedRaw, "");

    if (!isRealCharacterOwnerKey(owner)) continue;
    if (blocked.has(owner)) continue;

    candidates.push(owner);
  }

  return candidates.length ? candidates[candidates.length - 1] : "";
}

function readCharacterOwnerFromLocalStorage(): string {
  if (typeof window === "undefined") return "";

  const preferredKeys = [
    "otg:test-last-user:v1",
    "otg:last-user:v1",
    "otg:current-user:v1",
    "otg:active-user:v1",
    "otg:profile:v1",
    "otg:active-profile:v1",
    "otg:appState_v1",
    "otg:test:page-state:v1",
    "otg_user",
    "otg_profile",
    "user",
    "profile",
  ];

  for (const key of preferredKeys) {
    try {
      const raw = window.localStorage.getItem(key);
      const candidate = readCharacterOwnerCandidate(raw);
      const normalized = normalizeCharacterOwnerSegment(candidate, "");
      if (isRealCharacterOwnerKey(normalized)) return normalized;
    } catch {
      // Ignore broken localStorage values.
    }
  }

  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i) || "";
    if (!/user|profile|owner|session|auth|account/i.test(key)) continue;

    try {
      const raw = window.localStorage.getItem(key);
      const candidate = readCharacterOwnerCandidate(raw);
      const normalized = normalizeCharacterOwnerSegment(candidate, "");
      if (isRealCharacterOwnerKey(normalized)) return normalized;
    } catch {
      // Ignore broken localStorage values.
    }
  }

  return "";
}

function readCharacterOwnerKey(): string {
  // OTG_CHARACTER_OWNER_RESOLVER_STRICT_PROFILE_ONLY
  // Do not return shared fallback owners. Unresolved owner is not allowed to restore or write character data.
  const storageOwner = readCharacterOwnerFromLocalStorage();
  if (isRealCharacterOwnerKey(storageOwner)) return storageOwner;

  const domOwner = readCharacterOwnerFromDocument();
  if (isRealCharacterOwnerKey(domOwner)) return domOwner;

  return "profile_unresolved";
}

function getCharacterDeviceId(): string {
  return readCharacterOwnerKey();
}

function getCharacterBuilderDraftKey(ownerKey: string = getCharacterDeviceId()): string {
  return `${ownerKey}:character_builder_draft:v${CHARACTER_BUILDER_DRAFT_VERSION}`;
}

function requireResolvedCharacterOwner(context: string): string | null {
  const owner = getCharacterDeviceId();

  if (isRealCharacterOwnerKey(owner)) {
    return owner;
  }

  console.warn(`[OTG] Blocked Characters ${context}: active profile owner is unresolved.`);
  return null;
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
  "x-otg-device-id": getCharacterDeviceId(),
};
const CHARACTER_FETCH_OPTIONS = {
  credentials: "omit" as const,
  headers: { "x-otg-device-id": getCharacterDeviceId() },
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

const EMPTY_CHARACTER_IDENTITY: CharacterIdentity = {
  name: "",
  doNotChange: [],
  promptReadyDescription: "",
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

type LtxAudioPostProcessAction = "remove_background" | "enhance_voice";

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

function fileUrlFor(pathValue?: string | null){
  return otgDisplayImageUrlV36BP6(pathValue);
}

function safeId(value: string) {
  return String(value || "character")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "character";
}

function buildInternalPrompt(
  userPrompt: string,
  preset: string,
  anatomyMode: CharacterAnatomyMode = "standard",
  orientation: CharacterCreateOrientation = "portrait",
) {
  const style = preset ? `${preset.toLowerCase()} style` : "cinematic style";
  if (anatomyMode === "freeform") {
    const framing = orientation === "landscape"
      ? "landscape 1280x720 character reference canvas, wide composition, complete full body or full form visible inside the frame"
      : "portrait 832x1216 character reference canvas, vertical composition, complete full body or full form visible inside the frame";
    return `Complete full-body/full-form character reference of ${userPrompt.trim()}, ${framing}, preserve natural creature/object anatomy, do not force humanoid legs, arms, hands, or feet unless requested, if animal show all natural limbs, if mermaid or aquatic show the full tail and fins, if tree, plant, robot, object, floating, spirit, or amorphous character show the full visible body/form/base, centered character reference, no cropping, ${style}.`;
  }
  return `Full-body portrait of ${userPrompt.trim()}, head to feet visible, full costume visible, standing pose, centered character, no cropped head, no cropped feet, portrait 832x1216, ${style}.`;
}

function workflowForCharacterStyle(preset: string) {
  return String(preset).toLowerCase() === "anime" ? "presets/Create Anime Images" : "presets/Create a Picture";
}

function workflowForUploadedFullBodyCompletion() {
  return "presets/Edit Image";
}

function buildUploadedFullBodyCompletionPrompt(anatomyMode: CharacterAnatomyMode, userPrompt: string) {
  const guidance = userPrompt.trim();
  if (anatomyMode === "freeform") {
    return [
      "Create a complete full-body/full-form character from the uploaded reference.",
      "Preserve the original creature/object anatomy.",
      "Do not force humanoid legs, arms, hands, or feet unless requested.",
      "If animal, show the full body and all natural limbs.",
      "If mermaid/aquatic, show the full tail/fins.",
      "If tree/plant/object, show the full object/body/base/stump.",
      "If floating/spirit/amorphous, show the full visible form.",
      "No cropping.",
      "Entire character visible from top to bottom.",
      `User full-body/full-form description: ${guidance}`,
    ].join(" ");
  }

  return [
    "Create a complete full-body humanoid character from the uploaded reference.",
    "Preserve the face, identity, colors, and style.",
    "Add the missing torso, arms, legs, clothing, shoes, and body proportions.",
    "Front-facing full-body character reference.",
    "No cropping.",
    "Entire character visible from head to feet.",
    `User full-body description: ${guidance}`,
  ].join(" ");
}

function negativePromptForUploadedFullBodyCompletion(anatomyMode: CharacterAnatomyMode) {
  if (anatomyMode === "freeform") {
    return "cropped character, cropped form, cropped base, cropped tail, changed identity, changed colors, forced humanoid anatomy, human legs unless requested, human hands unless requested, different creature, blurry, low quality, watermark, text";
  }
  return "cropped body, cropped feet, cropped head, changed face, changed identity, changed visible clothing, different character, extra limbs, bad anatomy, blurry, low quality, watermark, text";
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
  const upload = await characterFetch("/api/characters/upload", {
    method: "POST",
    headers: { "x-otg-device-id": getCharacterDeviceId() },
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

async function submitCharacterImageJob(
  internalPrompt: string,
  stylePreset: string,
  orientation: CharacterCreateOrientation = "portrait",
) {
  const workflowId = workflowForCharacterStyle(stylePreset);
  const isLandscape = orientation === "landscape";
  const body = new FormData();
  body.set("workflowId", workflowId);
  body.set("workflowLabel", `Characters Create ${stylePreset}`);
  body.set("title", "Character Builder Image");
  body.set("requestKind", "character-builder-image");
  body.set("sourceType", "characters-tab-builder");
  body.set("saveToGallery", "false");
  body.set("save_to_gallery", "false");
  body.set("persistToGallery", "false");
  body.set("addToGallery", "false");
  body.set("copyToGallery", "false");
  body.set("gallery", "false");
  body.set("assetLibraryOnly", "true");
  body.set("outputLibrary", "characters");
  body.set("galleryExclusionPolicy", "character-candidate-only");
  body.set("prompt", internalPrompt);
  body.set("positivePrompt", internalPrompt);
  body.set("negativePrompt", CHARACTER_IMAGE_NEGATIVE_PROMPT);
  body.set("orientation", orientation);
  body.set("width", isLandscape ? "1280" : "720");
  body.set("height", isLandscape ? "720" : "1280");
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

async function submitUploadedFullBodyCompletionJob(instruction: string, sourceServerPath: string, anatomyMode: CharacterAnatomyMode) {
  const body = new FormData();
  body.set("workflowId", workflowForUploadedFullBodyCompletion());
  body.set("workflowLabel", "Characters Full Body Completion");
  body.set("prompt", instruction);
  body.set("positivePrompt", instruction);
  body.set("negativePrompt", negativePromptForUploadedFullBodyCompletion(anatomyMode));
  const characterBuilderOutputOrientationV36BP3C: CharacterCreateOrientation =
    /\blandscape\b|1280x720|wide composition/i.test(String(body.get("positivePrompt") || body.get("prompt") || "")) ? "landscape" : "portrait";
  body.set("orientation", characterBuilderOutputOrientationV36BP3C);
  body.set("aspectRatio", characterBuilderOutputOrientationV36BP3C === "landscape" ? "16:9" : "9:16");
  body.set("width", characterBuilderOutputOrientationV36BP3C === "landscape" ? "1280" : "832");
  body.set("height", characterBuilderOutputOrientationV36BP3C === "landscape" ? "720" : "1216");
  body.set("seed", randomSeed());
  body.set("requestKind", "characters-upload-fullbody-completion");
  body.set("sourceType", "characters-tab-builder-upload-fullbody");
  body.set("saveToGallery", "false");
  body.set("save_to_gallery", "false");
  body.set("persistToGallery", "false");
  body.set("addToGallery", "false");
  body.set("copyToGallery", "false");
  body.set("gallery", "false");
  body.set("skipGallery", "true");
  body.set("skipGeneralGallery", "true");
  body.set("assetLibraryOnly", "true");
  body.set("outputLibrary", "characters");
  body.set("galleryExclusionPolicy", "character-builder-fullbody-completion-only");
  body.set("characterAnatomyMode", anatomyMode);
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
  void instruction;

  const body = new FormData();
  body.set("workflowId", workflowForCharacterCard());
  body.set("workflowLabel", "Characters 8-Angle Character Card");
  body.set("requestKind", "characters-8-angle-card");
  body.set("sourceType", "characters-8-angle-card");
  body.set("imageAPath", sourceServerPath);
  body.set("loadImageNodeId", "25");
  body.set("saveImageNodeId", "439");
  body.set("characterCardOutputNodeId", "439");

  body.set("saveToGallery", "false");
  body.set("save_to_gallery", "false");
  body.set("persistToGallery", "false");
  body.set("addToGallery", "false");
  body.set("copyToGallery", "false");
  body.set("gallery", "false");
  body.set("skipGallery", "true");
  body.set("skipGeneralGallery", "true");
  body.set("assetLibraryOnly", "true");
  body.set("outputLibrary", "characters");
  body.set("galleryExclusionPolicy", "character-card-only");

  for (const staleKey of [
    "workflowFile",
    "workflowPath",
    "workflowJsonPath",
    "workflowPresetPath",
    "characterGeneratorOption",
    "characterGeneratorLabel",
    "prompt",
    "positivePrompt",
    "negativePrompt",
    "neg",
    "filenamePrefix",
    "filename_prefix",
    "characterCardFilenamePrefix",
    "saveImageInput",
  ]) {
    body.delete(staleKey);
  }

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
}type CharacterGeneratedImageResultV36BP9 = {
  url: string;
  sourceName: string;
};

function firstNonEmptyStringV36BP9(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }

  return "";
}

async function fetchComfyHistoryImageForPromptV36BP9(
  promptId: string,
  opts: { nodeId?: string; filenamePrefix?: string } = {},
): Promise<CharacterGeneratedImageResultV36BP9 | null> {
  if (!promptId) return null;

  try {
    const params = new URLSearchParams({
      promptId,
      t: Date.now().toString(36),
    });
    if (opts.nodeId) params.set("nodeId", opts.nodeId);
    if (opts.filenamePrefix) params.set("filenamePrefix", opts.filenamePrefix);
    const response = await fetch(`/api/comfy/history-image?${params.toString()}`, {
      cache: "no-store",
      ...CHARACTER_FETCH_OPTIONS,
    });

    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) return null;

    const url = firstNonEmptyStringV36BP9(json.url, json.imageUrl, json.file?.url);
    const sourceName = firstNonEmptyStringV36BP9(json.sourceName, json.filename, json.fileName, json.name, json.file?.name);
    if (!url) return null;

    return {
      url,
      sourceName,
    };
  } catch {
    return null;
  }
}

function characterGeneratedImageFromProgressV36BP9(progressJson: any): CharacterGeneratedImageResultV36BP9 | null {
  if (!progressJson || typeof progressJson !== "object") return null;

  const file = progressJson.file && typeof progressJson.file === "object" ? progressJson.file : null;
  const url = firstNonEmptyStringV36BP9(
    progressJson.imageUrl,
    progressJson.fileUrl,
    progressJson.outputUrl,
    progressJson.url,
    file?.url,
    file?.imageUrl,
    file?.fileUrl,
  );

  if (!url) return null;

  return {
    url,
    sourceName: firstNonEmptyStringV36BP9(
      progressJson.sourceName,
      progressJson.fileName,
      progressJson.filename,
      progressJson.name,
      file?.sourceName,
      file?.fileName,
      file?.filename,
      file?.name,
    ),
  };
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

    const directProgressImage = characterGeneratedImageFromProgressV36BP9(progressJson);
    if (directProgressImage?.url) {
      return directProgressImage;
    }

    lastStatus = String(progressJson.status || lastStatus).toLowerCase();

    const progressFileName = String(progressJson.fileName || progressJson.filename || "").trim();
    if (progressFileName) {
      completedFileName = progressFileName;
    }

    if (progressJson.prompt_error) {
      throw new Error(String(progressJson.prompt_error));
    }

    if (progressJson.prompt_complete || lastStatus === "complete" || lastStatus === "completed") {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  if (lastStatus !== "complete" && lastStatus !== "completed") {
    throw new Error(`Timed out waiting for character image generation. Last status: ${lastStatus}.`);
  }

  const historyImage = await fetchComfyHistoryImageForPromptV36BP9(promptId);
  if (historyImage?.url) {
    return historyImage;
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

async function fetchCharacterCardOutputImageV36BPT5(promptId: string): Promise<CharacterGeneratedImageResultV36BP9 | null> {
  if (!promptId) return null;

  const params = new URLSearchParams();
  params.set("promptId", promptId);
  params.set("nodeId", "439");
  params.set("t", Date.now().toString(36));

  const response = await fetch(`/api/comfy/history-image?${params.toString()}`, {
    cache: "no-store",
    ...CHARACTER_FETCH_OPTIONS,
  });

  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) return null;

  const url = firstNonEmptyStringV36BP9(json.url, json.imageUrl, json.file?.url);
  const sourceName = firstNonEmptyStringV36BP9(json.sourceName, json.filename, json.fileName, json.name, json.file?.name);
  if (!url) return null;

  return { url, sourceName };
}

async function waitForCharacterCardImage(promptId: string) {
  const started = Date.now();
  let lastError = "";

  while (Date.now() - started < 10 * 60 * 1000) {
    try {
      const exact = await fetchCharacterCardOutputImageV36BPT5(promptId);
      if (exact?.url) return exact;
    } catch (err: any) {
      lastError = err?.message || String(err);
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(
    `Character Card workflow timed out without final SaveImage node 439 output for prompt ${promptId}.` +
      (lastError ? ` Last error: ${lastError}` : "")
  );
}async function copyGeneratedImageToCharacterUpload(imageUrl: string, filename: string) {
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

function compactIdentityValue(value: unknown, max = 180) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^["'`\s]+|["'`\s]+$/g, "")
    .trim()
    .slice(0, max);
}

function addUniqueIdentityAnchor(anchors: string[], value: unknown) {
  const cleaned = compactIdentityValue(value, 160);
  if (!cleaned) return;
  const key = cleaned.toLowerCase();
  if (/^(human|male|female|man|woman|person|bipedal|two legs|adult|character)$/i.test(key)) return;
  if (anchors.some((item) => item.toLowerCase() === key)) return;
  anchors.push(cleaned);
}

const CLOTHING_ACCESSORY_NOUNS = [
  "hat",
  "fedora",
  "cap",
  "coat",
  "trench coat",
  "jacket",
  "shirt",
  "tie",
  "necktie",
  "vest",
  "pants",
  "trousers",
  "dress",
  "skirt",
  "boots",
  "shoes",
  "gloves",
  "belt",
  "bag",
  "pouch",
  "necklace",
  "armor",
  "robe",
  "cloak",
  "glasses",
  "weapon",
  "cane",
  "staff",
  "jewelry",
];

function sanitizeClothingAccessoriesInput(value: unknown) {
  const cleaned = cleanVisionDescriptor(String(value || ""));
  if (!cleaned) return { clothingAccessories: "", rejectedDescriptor: "" };
  const lower = cleaned.toLowerCase();
  const hasClothingNoun = CLOTHING_ACCESSORY_NOUNS.some((noun) => new RegExp(`\\b${noun.replace(/\s+/g, "\\s+")}s?\\b`, "i").test(lower));
  const descriptorHits = [
    /\b(human|species|male|female|gender|tall|short|average build|thin|big|bipedal|quadruped|serious expression|expression|jawline|body form|detective|personality)\b/i,
    /\b(sharp cheekbones|sharp jawline|standing|front-facing|side view|full body)\b/i,
  ].filter((rx) => rx.test(lower)).length;

  if (!hasClothingNoun && descriptorHits > 0) {
    return { clothingAccessories: "", rejectedDescriptor: cleaned };
  }

  if (!hasClothingNoun && cleaned.split(/\s+/).length > 6) {
    return { clothingAccessories: "", rejectedDescriptor: cleaned };
  }

  return { clothingAccessories: cleaned, rejectedDescriptor: "" };
}

function splitIdentityAnchors(value: unknown, maxItems = 4) {
  return cleanVisionDescriptor(String(value || ""))
    .split(/\s*,\s*/)
    .map((item) => compactIdentityValue(item, 120))
    .filter(Boolean)
    .slice(0, maxItems);
}

function buildPromptReadyCharacterDescription(args: {
  name: string;
  age: string;
  characterType: string;
  bodyForm: string;
  surfaceDescription: string;
  hairFurColor: string;
  eyeColor: string;
  clothingAccessories: string;
  distinctiveFeatures: string;
  doNotChange: string[];
}) {
  const agePhrase = args.age ? `${args.age}-year-old ` : "";
  const typePhrase = [agePhrase + args.characterType, args.bodyForm].filter(Boolean).join(" with ");
  const visualParts = [args.surfaceDescription, args.hairFurColor ? `${args.hairFurColor} hair/fur` : "", args.eyeColor ? `${args.eyeColor} eyes` : ""].filter(Boolean);
  const intro = `${args.name} is ${typePhrase || "a character"}${visualParts.length ? ` with ${visualParts.join(", ")}` : ""}.`;
  const clothingSentence = args.clothingAccessories ? `${args.name} wears ${args.clothingAccessories}.` : "";
  const distinctSentence = args.distinctiveFeatures ? `Distinctive features: ${args.distinctiveFeatures}.` : "";
  const keepSentence = args.doNotChange.length ? `Keep ${args.doNotChange.join(", ")} consistent whenever ${args.name} appears.` : "";
  return [intro, clothingSentence, distinctSentence, keepSentence].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function buildCompleteDescriptionIdentity(args: {
  details: CharacterDetails;
  characterAnatomyMode: CharacterAnatomyMode;
  characterInputMode: CharacterInputMode;
  visionDetails?: Record<string, unknown>;
  lockedAt?: string;
}): CharacterIdentity {
  const vision = args.visionDetails || {};
  const name = compactIdentityValue(args.details.name || "Unnamed character", 80);
  const age = compactIdentityValue(args.details.age, 80);
  const species = compactIdentityValue(args.details.species || vision.characterType || vision.character_type, 120);
  const characterType = compactIdentityValue(species || (args.characterAnatomyMode === "freeform" ? "freeform character" : "standard character"), 160);
  const bodyForm = compactIdentityValue(
    vision.bodyForm || vision.body_form || [args.details.build !== "average" ? args.details.build : "", args.details.gender, species].filter(Boolean).join(" "),
    180,
  );
  const lowerBodyLocomotion = compactIdentityValue(vision.lowerBodyLocomotion || vision.lower_body_locomotion || (args.characterAnatomyMode === "standard" ? "two legs" : ""), 120);
  const surfaceDescription = compactIdentityValue(args.details.surfaceDescription || vision.surfaceDescription || vision.surface_description, 220);
  const hairFurColor = compactIdentityValue(args.details.hairFurColor || vision.hairFurColor || vision.hair_fur_color, 140);
  const eyeColor = compactIdentityValue(args.details.eyeColor || vision.eyeColor || vision.eye_color, 120);
  const manualClothing = sanitizeClothingAccessoriesInput(args.details.clothingAccessories);
  const visionClothing = sanitizeClothingAccessoriesInput(vision.clothingAccessories || vision.clothing_accessories);
  const clothingAccessories = compactIdentityValue(manualClothing.clothingAccessories || visionClothing.clothingAccessories, 320);
  const distinctiveFeatures = compactIdentityValue(
    [
      vision.distinctiveFeatures || vision.distinctFeatures || vision.distinctive_features || vision.distinct_features,
      manualClothing.rejectedDescriptor,
    ].filter(Boolean).join(", "),
    260
  );
  const doNotChange: string[] = [];
  for (const anchor of splitIdentityAnchors(clothingAccessories, 5)) addUniqueIdentityAnchor(doNotChange, anchor);
  addUniqueIdentityAnchor(doNotChange, hairFurColor ? `${hairFurColor} hair/fur` : "");
  addUniqueIdentityAnchor(doNotChange, eyeColor ? `${eyeColor} eyes` : "");
  addUniqueIdentityAnchor(doNotChange, distinctiveFeatures);
  addUniqueIdentityAnchor(doNotChange, surfaceDescription);
  addUniqueIdentityAnchor(doNotChange, args.characterAnatomyMode === "freeform" ? bodyForm : "");
  const cappedDoNotChange = doNotChange.slice(0, 8);
  const promptReadyDescription = buildPromptReadyCharacterDescription({
    name,
    age,
    characterType,
    bodyForm,
    surfaceDescription,
    hairFurColor,
    eyeColor,
    clothingAccessories,
    distinctiveFeatures,
    doNotChange: cappedDoNotChange,
  });

  return {
    name,
    age,
    characterAnatomyMode: args.characterAnatomyMode,
    characterInputMode: args.characterInputMode,
    characterType,
    bodyForm,
    lowerBodyLocomotion,
    surfaceDescription,
    hairFurColor,
    eyeColor,
    clothingAccessories,
    distinctiveFeatures,
    doNotChange: cappedDoNotChange,
    promptReadyDescription,
    lockedAt: args.lockedAt,
  };
}

function buildCharacterIdentity(args: Parameters<typeof buildCompleteDescriptionIdentity>[0]): CharacterIdentity {
  return buildCompleteDescriptionIdentity(args);
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
  const [selectedCharacterGeneratorOption, setSelectedCharacterGeneratorOption] = useState<CharacterGeneratorOptionId>(() => {
    if (typeof window === "undefined") return "ernie";
    const stored = window.localStorage.getItem("otg-character-generator-option");
    return stored === "zturbo" || stored === "krea2" ? (stored as CharacterGeneratorOptionId) : "ernie";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("otg-character-generator-option", selectedCharacterGeneratorOption);
  }, [selectedCharacterGeneratorOption]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const loweredUrl = String(url || "").toLowerCase();
        const isCharacterCreatePost =
          selectedCharacterGeneratorOption !== "ernie" &&
          loweredUrl.includes("/api/") &&
          (loweredUrl.includes("character") || loweredUrl.includes("comfy")) &&
          String(init?.method || "GET").toUpperCase() === "POST";
  
        if (isCharacterCreatePost && init?.body) {
          const isCharacterCardRequest =
            init.body instanceof FormData
              ? String(init.body.get("requestKind") || init.body.get("sourceType") || init.body.get("workflowId") || "")
                  .toLowerCase()
                  .includes("characters-8-angle-card") ||
                String(init.body.get("workflowId") || "")
                  .toLowerCase()
                  .includes("presets/character_card_8_angles_low_angle")
              : typeof init.body === "string" &&
                /characters-8-angle-card|presets\/character_card_8_angles_low_angle/i.test(init.body);

          if (isCharacterCardRequest) {
            return originalFetch(input as any, init);
          }

          const payload = characterGeneratorPayload(selectedCharacterGeneratorOption);
          if (init.body instanceof FormData) {
            for (const [key, value] of Object.entries(payload)) {
              if (value) init.body.set(key, String(value));
            }
          } else if (typeof init.body === "string") {
            const parsed = JSON.parse(init.body);
            init = {
              ...init,
              body: JSON.stringify({ ...parsed, ...payload }),
            };
          }
        }
      } catch {
        // Do not block character creation if generator payload decoration fails.
      }
      return originalFetch(input as any, init);
    }) as typeof window.fetch;
  
    return () => {
      window.fetch = originalFetch;
    };
  }, [selectedCharacterGeneratorOption]);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [step, setStep] = useState<BuilderStep>("source");
  const [expandedCharacterDescriptions, setExpandedCharacterDescriptions] = useState<Record<string, boolean>>({});
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [stylePreset, setStylePreset] = useState<(typeof STYLE_PRESETS)[number]>("Anime");
  const [candidates, setCandidates] = useState<CandidateImage[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [savedForLaterCandidateIdsV36BPS3, setSavedForLaterCandidateIdsV36BPS3] = useState<Record<string, boolean>>({});
  const [saveForLaterProgressByIdV36BPS6B, setSaveForLaterProgressByIdV36BPS6B] = useState<Record<string, "idle" | "saving" | "saved" | "error">>({});
  const [uploadedImage, setUploadedImage] = useState<CandidateImage | null>(null);
  const [imageCompleteness, setImageCompleteness] = useState<ImageCompleteness>("full_body");
  const [characterAnatomyMode, setCharacterAnatomyMode] = useState<CharacterAnatomyMode>("standard");
  const [characterInputMode, setCharacterInputMode] = useState<CharacterInputMode>("create");
  const [sourceFraming, setSourceFraming] = useState<SourceFraming>("full_body");
  const [fullBodyStatus, setFullBodyStatus] = useState<FullBodyStatus>("not_required");
  const [missingGuidance, setMissingGuidance] = useState("");
  const [fullBodyPrompt, setFullBodyPrompt] = useState("");
  const [freeformFullBodyConfirmed, setFreeformFullBodyConfirmed] = useState(false);
  const [freeformCreateOrientation, setFreeformCreateOrientation] = useState<CharacterCreateOrientation>("portrait");
  const [backgroundRemovalStatus, setBackgroundRemovalStatus] = useState<"idle" | "running" | "done" | "warning">("idle");
  const [backgroundRemovalWarning, setBackgroundRemovalWarning] = useState("");
  const [characterBackgroundPrompt, setCharacterBackgroundPrompt] = useState("");
  const [characterBackgroundName, setCharacterBackgroundName] = useState("Scene Background");
  const [characterBackgroundBusy, setCharacterBackgroundBusy] = useState(false);
  const [characterBackgroundStatus, setCharacterBackgroundStatus] = useState("");
  const [characterBackgroundRefs, setCharacterBackgroundRefs] = useState<CharacterBackgroundReferenceV36A[]>([]);
  const [characterBackgroundLocationType, setCharacterBackgroundLocationType] = useState("");
  const [characterBackgroundStyle, setCharacterBackgroundStyle] = useState("cinematic realistic");
  const [characterBackgroundContinuityBlock, setCharacterBackgroundContinuityBlock] = useState("");
  const [characterBackgroundDoNotChange, setCharacterBackgroundDoNotChange] = useState("");
  const [characterBackgroundStudioOpen, setCharacterBackgroundStudioOpen] = useState(false);
  const [characterBackgroundProvider, setCharacterBackgroundProvider] = useState<"ernie-image" | "z-turbo" | "krea2-turbo">("ernie-image");
  const [characterBackgroundPreviewCount, setCharacterBackgroundPreviewCount] = useState(5);
  const [characterBackgroundPreviewCandidates, setCharacterBackgroundPreviewCandidates] = useState<CharacterBackgroundPreviewCandidateV36E[]>([]);
  const [selectedCharacterBackgroundCandidateId, setSelectedCharacterBackgroundCandidateId] = useState("");
  const [expandedCharacterBackgroundCandidateId, setExpandedCharacterBackgroundCandidateId] = useState("");


  const [selectedFullBody, setSelectedFullBody] = useState<CandidateImage | null>(null);
  const [characterCard, setCharacterCard] = useState<CandidateImage | null>(null);
  const [previousCharacterCardBeforeBackgroundRemovalV36BPT6, setPreviousCharacterCardBeforeBackgroundRemovalV36BPT6] = useState<CandidateImage | null>(null);
  const [characterCardBackgroundRemovalStatusV36BPT6, setCharacterCardBackgroundRemovalStatusV36BPT6] = useState<"idle" | "running" | "removed" | "error">("idle");
  const [details, setDetails] = useState<CharacterDetails>(DEFAULT_DETAILS);
  const [voice, setVoice] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [voiceProvider, setVoiceProvider] = useState<VoiceGeneratorProvider>("qwen3");
  // OTG_VOICE_EFFECTS_UI_P2_STATE_FIX
  const [voiceEffectCategory, setVoiceEffectCategory] = useState<VoiceEffectCategory>("space_distance");
  const [voiceEffectId, setVoiceEffectId] = useState("far_away_voice");
  const [voiceEffectIntensity, setVoiceEffectIntensity] = useState<VoiceEffectIntensity>("medium");
  const [voiceEffectProcessing, setVoiceEffectProcessing] = useState<{ jobId: string; message: string } | null>(null);
  const [voiceEffectMessage, setVoiceEffectMessage] = useState("");
  const [voiceEffectOutputs, setVoiceEffectOutputs] = useState<Record<string, Array<{
    effectId: string;
    effectLabel: string;
    category: string;
    intensity: string;
    engine: string;
    audioPath: string;
    audioUrl: string;
  }>>>({});
  // OTG_VOICE_EFFECTS_REWORK_P3A_STATE
  const [voiceEffectsAdvancedOpen, setVoiceEffectsAdvancedOpen] = useState(false);
  const [simplePitchEffectId, setSimplePitchEffectId] = useState("simple_pitch_normal");
  const [simpleEchoEffectId, setSimpleEchoEffectId] = useState("simple_echo_none");
  const [voiceEffectWorkingByJob, setVoiceEffectWorkingByJob] = useState<Record<string, {
    audioPath: string;
    audioUrl: string;
    label: string;
  }>>({});
  const [voiceEffectChainByJob, setVoiceEffectChainByJob] = useState<Record<string, Array<{
    label: string;
    effectId: string;
    engine: string;
    audioPath: string;
    audioUrl: string;
  }>>>({});
  const [ffmpegAdvancedPresetId, setFfmpegAdvancedPresetId] = useState("clean_robot");
  const [pedalboardPresetId, setPedalboardPresetId] = useState("pedalboard_studio");
  const [soxPresetId, setSoxPresetId] = useState("sox_synthwave");
  const [ffmpegControlsUnlocked, setFfmpegControlsUnlocked] = useState(false);
  // OTG_VOICE_EFFECTS_3C_FFMPEG_MANUAL_STATE
  const [ffmpegManualControls, setFfmpegManualControls] = useState({
    pitchSemitones: 0,
    grit: 0,
    echoDelayMs: 0,
    echoDecay: 0,
    tremoloRate: 0,
    tremoloDepth: 0,
    vibratoRate: 0,
    vibratoDepth: 0,
    chorusMix: 0,
    highpassHz: 80,
    lowpassHz: 12000,
    compression: 30,
    gainDb: 0,
  });

  function setFfmpegManualControl(key: keyof typeof ffmpegManualControls, value: number) {
    setFfmpegManualControls((current) => ({
      ...current,
      [key]: value,
    }));
  }
  const [pedalboardControlsUnlocked, setPedalboardControlsUnlocked] = useState(false);
  const [soxControlsUnlocked, setSoxControlsUnlocked] = useState(false);
  // OTG_VOICE_EFFECTS_3C2_PEDALBOARD_SOX_MANUAL_STATE
  const [pedalboardManualControls, setPedalboardManualControls] = useState({
    driveDb: 0,
    phaserRate: 0,
    phaserDepth: 0,
    chorusRate: 0,
    chorusDepth: 0,
    delayMs: 0,
    delayFeedback: 0,
    delayMix: 0,
    reverbRoomSize: 0,
    reverbWet: 0,
    pitchSemitones: 0,
    highpassHz: 80,
    lowpassHz: 12000,
    compression: 30,
    gainDb: 0,
  });

  const [soxManualControls, setSoxManualControls] = useState({
    pitchCents: 0,
    tempo: 1,
    overdriveGain: 0,
    overdriveColour: 20,
    echoDelayMs: 0,
    echoDecay: 0,
    highpassHz: 80,
    lowpassHz: 12000,
    chorusDelayMs: 0,
    chorusDecay: 0,
    bassDb: 0,
    trebleDb: 0,
    gainDb: 0,
    normalize: true,
  });

  function setPedalboardManualControl(key: keyof typeof pedalboardManualControls, value: number) {
    setPedalboardManualControls((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function setSoxManualControl(key: keyof typeof soxManualControls, value: number | boolean) {
    setSoxManualControls((current) => ({
      ...current,
      [key]: value,
    }));
  }
  const [voiceDesignProfile, setVoiceDesignProfile] = useState<VoiceDesignProfile>(() => defaultVoiceDesignProfile());
  const [qwenVoiceDesign, setQwenVoiceDesign] = useState<QwenVoiceDesignInput>(() => defaultQwenVoiceDesignInput());
  const [qwenVoiceCandidates, setQwenVoiceCandidates] = useState<QwenVoiceCandidateInstruction[]>([]);
  const [selectedQwenVoiceCandidateId, setSelectedQwenVoiceCandidateId] = useState("");
  const [qwenVoiceDesignRecord, setQwenVoiceDesignRecord] = useState<any | null>(null);
  const [qwenVoiceInstructionAdvancedEdit, setQwenVoiceInstructionAdvancedEdit] = useState(false);
  const [voicePromptSnapshot, setVoicePromptSnapshot] = useState<any | null>(null);
  const [ltxSampleTextIsCustom, setLtxSampleTextIsCustom] = useState(false);
  const [unnaturalVoiceCategory, setUnnaturalVoiceCategory] = useState<UnnaturalVoiceCategory>("Demonic / Infernal");
  const [unnaturalVoicePresetId, setUnnaturalVoicePresetId] = useState("abyss_demon");
  const [ltxAudioProcessing, setLtxAudioProcessing] = useState<{
    action: LtxAudioPostProcessAction | "";
    jobId: string;
    message: string;
  }>({ action: "", jobId: "", message: "" });
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

  const characterDraftHydratedRef = useRef(false);
  const [characterDraftHydrated, setCharacterDraftHydrated] = useState(false);
  const [characterDraftRestoreError, setCharacterDraftRestoreError] = useState("");
  const characterDraftSaveTimeoutRef = useRef<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [autoDescribeLoading, setAutoDescribeLoading] = useState(false);
  const [characterIdentity, setCharacterIdentity] = useState<CharacterIdentity>(EMPTY_CHARACTER_IDENTITY);

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
      if (saved.characterAnatomyMode === "standard" || saved.characterAnatomyMode === "freeform") setCharacterAnatomyMode(saved.characterAnatomyMode);
      if (saved.characterInputMode === "create" || saved.characterInputMode === "upload") setCharacterInputMode(saved.characterInputMode);
      if (saved.sourceFraming === "face" || saved.sourceFraming === "half_body" || saved.sourceFraming === "full_body") setSourceFraming(saved.sourceFraming);
      if (saved.fullBodyStatus === "not_required" || saved.fullBodyStatus === "required" || saved.fullBodyStatus === "generated" || saved.fullBodyStatus === "approved") {
        setFullBodyStatus(saved.fullBodyStatus);
      }
      if (saved.imageCompleteness) {
        setImageCompleteness(saved.imageCompleteness);
        if (!saved.sourceFraming) {
          setSourceFraming(saved.imageCompleteness === "face_only" ? "face" : saved.imageCompleteness);
        }
      }
      if (typeof saved.missingGuidance === "string") setMissingGuidance(saved.missingGuidance);
      if (typeof saved.fullBodyPrompt === "string") {
        setFullBodyPrompt(saved.fullBodyPrompt);
      } else if (typeof saved.missingGuidance === "string") {
        setFullBodyPrompt(saved.missingGuidance);
      }
      if (typeof saved.freeformFullBodyConfirmed === "boolean") setFreeformFullBodyConfirmed(saved.freeformFullBodyConfirmed);
      if (saved.freeformCreateOrientation === "portrait" || saved.freeformCreateOrientation === "landscape") setFreeformCreateOrientation(saved.freeformCreateOrientation);
      if (saved.backgroundRemovalStatus === "idle" || saved.backgroundRemovalStatus === "running" || saved.backgroundRemovalStatus === "done" || saved.backgroundRemovalStatus === "warning") {
        setBackgroundRemovalStatus(saved.backgroundRemovalStatus === "running" ? "idle" : saved.backgroundRemovalStatus);
      }
      if (typeof saved.backgroundRemovalWarning === "string") setBackgroundRemovalWarning(saved.backgroundRemovalWarning);
      if ("selectedFullBody" in saved) setSelectedFullBody(saved.selectedFullBody || null);
      if ("characterCard" in saved) setCharacterCard(saved.characterCard || null);
      if (saved.characterIdentity && typeof saved.characterIdentity === "object" && !Array.isArray(saved.characterIdentity)) {
        setCharacterIdentity({
          ...EMPTY_CHARACTER_IDENTITY,
          ...saved.characterIdentity,
          doNotChange: Array.isArray(saved.characterIdentity.doNotChange) ? saved.characterIdentity.doNotChange.map(String) : [],
          promptReadyDescription: String(saved.characterIdentity.promptReadyDescription || saved.promptReadyDescription || ""),
        });
      } else if (typeof saved.promptReadyDescription === "string" && saved.promptReadyDescription.trim()) {
        setCharacterIdentity({ ...EMPTY_CHARACTER_IDENTITY, promptReadyDescription: saved.promptReadyDescription });
      }
      if (saved.details) setDetails({ ...DEFAULT_DETAILS, ...saved.details });
      if (saved.voice) setVoice({ ...DEFAULT_VOICE, ...saved.voice });
      if (saved.voiceProvider === "qwen3" || saved.voiceProvider === "cosy" || saved.voiceProvider === "ltx") setVoiceProvider(saved.voiceProvider);
      if (saved.voiceDesignProfile) setVoiceDesignProfile(defaultVoiceDesignProfile(saved.voiceDesignProfile));
      if (UNNATURAL_VOICE_CATEGORIES.includes(saved.unnaturalVoiceCategory as UnnaturalVoiceCategory)) {
        setUnnaturalVoiceCategory(saved.unnaturalVoiceCategory as UnnaturalVoiceCategory);
      }
      if (typeof saved.unnaturalVoicePresetId === "string" && UNNATURAL_VOICE_PRESETS.some((preset) => preset.id === saved.unnaturalVoicePresetId)) {
        setUnnaturalVoicePresetId(saved.unnaturalVoicePresetId);
      }
      if (typeof saved.ltxSampleTextIsCustom === "boolean") {
        setLtxSampleTextIsCustom(saved.ltxSampleTextIsCustom);
      } else if (saved.voiceDesignProfile?.model === "ltxvoice" && typeof saved.voiceDesignProfile.sampleText === "string") {
        setLtxSampleTextIsCustom(!isLtxDialectSampleText(saved.voiceDesignProfile.sampleText));
      }
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
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    const restore = async () => {
      try {
        const response = await characterFetch(`/api/characters/builder-draft?ownerId=${encodeURIComponent(getCharacterDeviceId())}`, {
          cache: "no-store",
          credentials: "omit",
          headers: { "x-otg-device-id": getCharacterDeviceId() },
        });
        const json = await response.json().catch(() => null);
        const serverState = json?.draft?.state;
        if (!cancelled && response.ok && serverState && typeof serverState === "object") {
          restoreCharacterBuilderDraftState(serverState);
          window.localStorage.setItem(
            getCharacterBuilderDraftKey(),
            JSON.stringify({
              version: CHARACTER_BUILDER_DRAFT_VERSION,
              savedAt: json?.draft?.updatedAt || new Date().toISOString(),
              state: serverState,
            }),
          );
          setMessage("Restored saved character creation progress.");
          return;
        }

        const raw = window.localStorage.getItem(getCharacterBuilderDraftKey());
        if (raw) {
          const draft = JSON.parse(raw);
          if (!cancelled && isRealCharacterOwnerKey(getCharacterDeviceId()) && draft?.version === CHARACTER_BUILDER_DRAFT_VERSION && draft.state && !characterBuilderDraftHasForeignOwner(draft, getCharacterDeviceId())) {
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
      characterAnatomyMode,
      characterInputMode,
      sourceFraming,
      fullBodyStatus,
      imageCompleteness,
      missingGuidance,
      fullBodyPrompt,
      freeformFullBodyConfirmed,
      freeformCreateOrientation,
      backgroundRemovalStatus,
      backgroundRemovalWarning,
      selectedFullBody,
      characterCard,
      characterIdentity,
      promptReadyDescription: characterIdentity.promptReadyDescription,
      details: nextDetails,
      voice,
      voiceProvider,
      voiceDesignProfile,
      unnaturalVoiceCategory,
      unnaturalVoicePresetId,
      ltxSampleTextIsCustom,
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
    characterAnatomyMode,
    characterInputMode,
    sourceFraming,
    fullBodyStatus,
    imageCompleteness,
    missingGuidance,
    fullBodyPrompt,
    freeformFullBodyConfirmed,
    freeformCreateOrientation,
    backgroundRemovalStatus,
    backgroundRemovalWarning,
    selectedFullBody,
    characterCard,
    characterIdentity,
    details,
    voice,
    voiceProvider,
    voiceDesignProfile,
    unnaturalVoiceCategory,
    unnaturalVoicePresetId,
    ltxSampleTextIsCustom,
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
      window.localStorage.setItem(getCharacterBuilderDraftKey(), JSON.stringify(draft));
    } catch {
      // Local cache is best effort; server draft is authoritative.
    }
    void characterFetch(`/api/characters/builder-draft?ownerId=${encodeURIComponent(getCharacterDeviceId())}`, {
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
      window.localStorage.setItem(getCharacterBuilderDraftKey(), JSON.stringify(draft));
      if (characterDraftSaveTimeoutRef.current !== null) {
        window.clearTimeout(characterDraftSaveTimeoutRef.current);
      }
      characterDraftSaveTimeoutRef.current = window.setTimeout(() => {
        void characterFetch(`/api/characters/builder-draft?ownerId=${encodeURIComponent(getCharacterDeviceId())}`, {
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
    characterAnatomyMode,
    characterInputMode,
    sourceFraming,
    fullBodyStatus,
    imageCompleteness,
    missingGuidance,
    fullBodyPrompt,
    freeformFullBodyConfirmed,
    freeformCreateOrientation,
    backgroundRemovalStatus,
    backgroundRemovalWarning,
    selectedFullBody,
    characterCard,
    characterIdentity,
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
  const selectedTrainingVoiceIsTuned = selectedIndexVoiceReference?.source === "tuned_voice_fx";
  const selectedTrainingVoicePath = String(selectedTrainingVoiceIsTuned ? selectedIndexVoiceReference?.audioPath || "" : "").trim();
  const selectedTrainingVoiceUrl = String(
    selectedTrainingVoiceIsTuned
      ? selectedIndexVoiceReference?.audioUrl || voiceFileUrlFor(selectedTrainingVoicePath) || ""
      : "",
  ).trim();
  const effectiveApprovedSampleUrl = String(selectedTrainingVoiceUrl || builderCharacterVoiceProfile?.approvedSampleUrl || "").trim();
  const effectiveApprovedSamplePath = String(selectedTrainingVoicePath || builderCharacterVoiceProfile?.approvedSamplePath || "").trim();
  const approvedSampleUrl = effectiveApprovedSampleUrl;
  const selectedApplioTrainingQuality = APPLIO_TRAINING_QUALITY_PRESETS[applioTrainingQualityPreset];
  const approvedSampleType =
    selectedTrainingVoiceIsTuned
      ? "tuned"
      : approvedSampleUrl && builderCharacterVoiceProfile?.tunedSampleUrl && approvedSampleUrl === builderCharacterVoiceProfile.tunedSampleUrl
      ? "tuned"
      : approvedSampleUrl && builderCharacterVoiceProfile?.baseSampleUrl && approvedSampleUrl === builderCharacterVoiceProfile.baseSampleUrl
        ? "base"
        : approvedSampleUrl
          ? "unknown"
          : "";
  const approvedSourceJobId =
    selectedTrainingVoiceIsTuned
      ? builderCharacterVoiceProfile?.tunedSourceJobId || "voice_fx_current_version"
      : approvedSampleType === "tuned"
      ? builderCharacterVoiceProfile?.tunedSourceJobId || builderCharacterVoiceProfile?.sourceJobId || ""
      : approvedSampleType === "base"
        ? builderCharacterVoiceProfile?.sourceJobId || ""
        : builderCharacterVoiceProfile?.tunedSourceJobId || builderCharacterVoiceProfile?.sourceJobId || "";
  const lockedTrainingVoiceUrl = String(
    selectedTrainingVoiceUrl ||
      builderCharacterVoiceProfile?.approvedSampleUrl ||
      builderCharacterVoiceProfile?.tunedSampleUrl ||
      builderCharacterVoiceProfile?.baseSampleUrl ||
      "",
  ).trim();
  const lockedTrainingVoicePath = String(
    selectedTrainingVoicePath ||
      builderCharacterVoiceProfile?.approvedSamplePath ||
      builderCharacterVoiceProfile?.tunedSamplePath ||
      builderCharacterVoiceProfile?.baseSamplePath ||
      "",
  ).trim();
  const lockedTrainingVoiceType =
    selectedTrainingVoiceIsTuned
      ? "tuned"
      : builderCharacterVoiceProfile?.approvedSampleUrl
      ? approvedSampleType || "approved"
      : builderCharacterVoiceProfile?.tunedSampleUrl
        ? "tuned"
        : builderCharacterVoiceProfile?.baseSampleUrl
          ? "base"
          : "";
  const voiceDesignPayload = useMemo(() => buildVoiceRequestPayload(voiceDesignProfile), [voiceDesignProfile]);
  const voiceDesignAccent = statusForAccent(voiceDesignProfile);
  const voiceDesignAccentOptions = useMemo(() => accentOptionsForModel(voiceDesignProfile), [voiceDesignProfile]);
  const unnaturalVoicePresetsForCategory = useMemo(
    () => UNNATURAL_VOICE_PRESETS.filter((preset) => preset.category === unnaturalVoiceCategory),
    [unnaturalVoiceCategory],
  );
  const selectedUnnaturalVoicePreset = useMemo(
    () =>
      UNNATURAL_VOICE_PRESETS.find((preset) => preset.id === unnaturalVoicePresetId) ||
      unnaturalVoicePresetsForCategory[0] ||
      UNNATURAL_VOICE_PRESETS[0],
    [unnaturalVoicePresetId, unnaturalVoicePresetsForCategory],
  );

  useEffect(() => {
    if (!unnaturalVoicePresetsForCategory.some((preset) => preset.id === unnaturalVoicePresetId)) {
      setUnnaturalVoicePresetId(unnaturalVoicePresetsForCategory[0]?.id || UNNATURAL_VOICE_PRESETS[0].id);
    }
  }, [unnaturalVoicePresetId, unnaturalVoicePresetsForCategory]);

  // OTG_LTX_DIALECT_SAMPLE_SYNC: keep auto-managed LTX sample text aligned with the selected dialect line.
  useEffect(() => {
    if (voiceDesignProfile.model !== "ltxvoice") return;
    const dialectId = voiceDesignAccentOptions.some((option) => option.id === voiceDesignProfile.accentDialectId)
      ? voiceDesignProfile.accentDialectId
      : DEFAULT_LTX_VOICE_DIALECT_ID;
    const syncedSampleText = getLtxDialectSampleText(dialectId);
    if (voiceDesignProfile.accentDialectId === dialectId && (ltxSampleTextIsCustom || voiceDesignProfile.sampleText === syncedSampleText)) return;
    setVoiceDesignProfile((current) => {
      if (current.model !== "ltxvoice") return current;
      const nextDialectId = voiceDesignAccentOptions.some((option) => option.id === current.accentDialectId)
        ? current.accentDialectId
        : DEFAULT_LTX_VOICE_DIALECT_ID;
      const nextSampleText = getLtxDialectSampleText(nextDialectId);
      if (current.accentDialectId === nextDialectId && (ltxSampleTextIsCustom || current.sampleText === nextSampleText)) return current;
      return {
        ...current,
        accentDialectId: nextDialectId,
        sampleText: ltxSampleTextIsCustom ? current.sampleText : nextSampleText,
      };
    });
  }, [ltxSampleTextIsCustom, voiceDesignAccentOptions, voiceDesignProfile.accentDialectId, voiceDesignProfile.model, voiceDesignProfile.sampleText]);

  const qwenVoiceInstruction = String(voiceDesignPayload.instruct || voiceDesignPayload.prompt || "").trim();
  const qwenSamplePhrase = voiceDesignProfile.sampleText?.trim() || QWEN_PREVIEW_LINES.neutral_standard;
  const qwenWarnings = voiceDesignWarnings(voiceDesignProfile);
  const approvedVoiceSourceInput = {
    approvedSampleUrl: lockedTrainingVoiceUrl,
    approvedSamplePath: lockedTrainingVoicePath,
    approvedSampleType: lockedTrainingVoiceType || "unknown",
    approvedSourceJobId,
    sourceProvider : builderCharacterVoiceProfile?.provider || voiceProvider,
    voiceInstruction: String(qwenVoiceDesignRecord?.voiceInstruction || voicePromptSnapshot?.instruct || voicePromptSnapshot?.prompt || qwenVoiceInstruction),
    voiceDesign: (voicePromptSnapshot?.payload || voiceDesignPayload).voiceDesign,
    modelConfig: voicePromptSnapshot?.payload || voiceDesignPayload,
    baseSamplePath: builderCharacterVoiceProfile?.baseSamplePath || "",
    baseSampleUrl: builderCharacterVoiceProfile?.baseSampleUrl || "",
    tunedSamplePath: selectedTrainingVoicePath || builderCharacterVoiceProfile?.tunedSamplePath || "",
    tunedSampleUrl: selectedTrainingVoiceUrl || builderCharacterVoiceProfile?.tunedSampleUrl || "",
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
  const fullBodyDownstreamGateMessage = getFullBodyGateError();
  const characterPreviewDisabled = characterPreviewSubmitting || Boolean(fullBodyDownstreamGateMessage) || !trainedVoiceReady || !characterPreviewSourceImagePath;
  useEffect(() => {
    setCharacterBackgroundRefs(readCharacterBackgroundLibraryV36A());
    void loadCharacterBackgroundLibraryV36B();
  }, []);

  async function loadCharacterBackgroundLibraryV36B() {
    try {
      const serverItems = await fetchCharacterBackgroundLibraryFromServerV36B();
      setCharacterBackgroundRefs((current) => {
        const merged = serverItems.reduce(
          (items, item) => upsertCharacterBackgroundReferenceV36A(items, item),
          current,
        );
        writeCharacterBackgroundLibraryV36A(merged);
        return merged;
      });
    } catch (error: any) {
      const cached = readCharacterBackgroundLibraryV36A();
      if (cached.length) setCharacterBackgroundRefs(cached);
      setCharacterBackgroundStatus(error?.message || "Background library loaded from local cache.");
    }
  }

  function saveCharacterBackgroundReferenceV36A(next: CharacterBackgroundReferenceV36A) {
    setCharacterBackgroundRefs((current) => {
      const updated = upsertCharacterBackgroundReferenceV36A(current, next);
      writeCharacterBackgroundLibraryV36A(updated);
      return updated;
    });

    void persistCharacterBackgroundReferenceToServerV36B(next)
      .then((saved) => {
        if (!saved) return;
        setCharacterBackgroundRefs((current) => {
          const updated = upsertCharacterBackgroundReferenceV36A(current, saved);
          writeCharacterBackgroundLibraryV36A(updated);
          return updated;
        });
      })
      .catch((error: any) => {
        setCharacterBackgroundStatus(error?.message || "Background saved locally, but server library save failed.");
      });
  }

  async function deleteCharacterBackgroundReferenceV36C(id: string, name: string) {
    if (!id) return;

    const confirmed = window.confirm(`Delete background "${name || id}"? This removes it from the saved Background Library.`);
    if (!confirmed) return;

    setCharacterBackgroundBusy(true);
    setCharacterBackgroundStatus("Deleting background...");

    try {
      const response = await fetch("/api/backgrounds", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "delete",
          id,
        }),
      });

      const json = await response.json().catch(() => null);

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || `Delete background failed (${response.status}).`);
      }

      setCharacterBackgroundRefs((current) => {
        const updated = current.filter((item) => item.id !== id);
        writeCharacterBackgroundLibraryV36A(updated);
        return updated;
      });

      setCharacterBackgroundPreviewCandidates((current) => current.filter((item) => item.id !== id));
      setSelectedCharacterBackgroundCandidateId((current) => (current === id ? "" : current));
      setCharacterBackgroundStatus("Background deleted.");
    } catch (error: any) {
      setCharacterBackgroundStatus(error?.message || "Delete background failed.");
    } finally {
      setCharacterBackgroundBusy(false);
    }
  }

  async function saveSelectedCharacterBackgroundCandidateV36C() {
    const selected =
      characterBackgroundPreviewCandidates.find((candidate) => candidate.id === selectedCharacterBackgroundCandidateId) ||
      characterBackgroundPreviewCandidates[0];

    if (!selected) {
      setCharacterBackgroundStatus("Generate or select a background preview first.");
      return;
    }

    const label = characterBackgroundName.trim() || selected.name || "Scene Background";
    const now = new Date().toISOString();

    const next: CharacterBackgroundReferenceV36A = {
      id: `background-${safeCharacterBackgroundIdV36A(label)}-${Date.now()}`,
      name: label,
      type: "background",
      locationType: characterBackgroundLocationType.trim() || undefined,
      style: characterBackgroundStyle.trim() || "Cinematic",
      prompt: selected.prompt,
      masterPrompt: selected.prompt,
      continuityBlock: characterBackgroundContinuityBlock.trim() || undefined,
      doNotChange: [],
      imagePath: selected.imagePath || undefined,
      imageUrl: selected.imageUrl || undefined,
      displayImage: selected.displayImage || selected.imageUrl || selected.imagePath || undefined,
      workflowImage: selected.workflowImage || selected.imagePath || selected.imageUrl || undefined,
      source: "created",
      createdAt: now,
      updatedAt: now,
    };

    saveCharacterBackgroundReferenceV36A(next);
    setCharacterBackgroundStatus("Selected background saved to the Background Library.");
  }

  async function createCharacterBackgroundV36A() {
    const finalPrompt = buildCharacterBackgroundPromptV36C({
      name: characterBackgroundName.trim(),
      locationType: characterBackgroundLocationType.trim(),
      style: characterBackgroundStyle.trim() || "Cinematic",
      describeScene: characterBackgroundContinuityBlock.trim(),
      promptOverride: characterBackgroundPrompt.trim(),
    });

    if (!finalPrompt.trim()) {
      setCharacterBackgroundStatus("Describe the scene or enter the prompt that should be sent to ComfyUI.");
      return;
    }

    const previewCount = clampCharacterBackgroundPreviewCountV36C(characterBackgroundPreviewCount);

    setCharacterBackgroundBusy(true);
    setCharacterBackgroundStatus(`Creating ${previewCount} background preview${previewCount === 1 ? "" : "s"}...`);
    setCharacterBackgroundPreviewCandidates([]);
    setSelectedCharacterBackgroundCandidateId("");

    try {
      const candidates: CharacterBackgroundPreviewCandidateV36C[] = [];

      for (let index = 0; index < previewCount; index += 1) {
        const response = await fetch("/api/production/background", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "x-otg-device-id": getCharacterDeviceId(),
          },
          body: JSON.stringify({
            prompt: finalPrompt,
            positivePrompt: finalPrompt,
            masterPrompt: finalPrompt,
            preset: characterBackgroundStyle.trim() || "Cinematic",
            style: characterBackgroundStyle.trim() || "Cinematic",
            provider: characterBackgroundProvider,
            previewIndex: index + 1,
            previewCount,
                        // OTG_BACKGROUND_LANDSCAPE_LOCK_V36D
            width: 1280,
            height: 720,
            imageWidth: 1280,
            imageHeight: 720,
            resolution: "1280x720",
            aspectRatio: "16:9",
            orientation: "landscape",
            landscape: true,
            outputFormat: "png",
            sourceType: "characters-tab-background-studio",
          }),
        });

        const json = await response.json().catch(() => null);

        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || `Create background preview ${index + 1} failed (${response.status}).`);
        }

        const imagePath = String(
          json.imagePath ||
            json.outputPath ||
            json.filePath ||
            json.serverPath ||
            json.path ||
            "",
        ).trim();

        const imageUrl = String(
          json.imageUrl ||
            json.fileUrl ||
            json.outputUrl ||
            json.url ||
            "",
        ).trim();

        const workflowImage = imagePath || imageUrl;
        const displayImage = imageUrl || imagePath;

        if (!workflowImage && !displayImage) {
          throw new Error(`Background preview ${index + 1} did not return an image path or URL.`);
        }

        candidates.push({
          id: `background-preview-${Date.now()}-${index}`,
          name: `${characterBackgroundName.trim() || "Scene Background"} Preview ${index + 1}`,
          imagePath: imagePath || undefined,
          imageUrl: imageUrl || undefined,
          displayImage: displayImage || undefined,
          workflowImage: workflowImage || undefined,
          prompt: finalPrompt,
          provider: characterBackgroundProvider,
          createdAt: new Date().toISOString(),
        });

        setCharacterBackgroundPreviewCandidates([...candidates]);
        setSelectedCharacterBackgroundCandidateId((current) => current || candidates[0]?.id || "");
      }

      if (!candidates.length) {
        throw new Error("No background previews were created.");
      }

      setCharacterBackgroundStatus("Background previews created. Select one and save it to the Background Library.");
    } catch (error: any) {
      setCharacterBackgroundStatus(error?.message || "Create background previews failed.");
    } finally {
      setCharacterBackgroundBusy(false);
    }
  }


  useEffect(() => {
    if (!characterBackgroundStudioOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [characterBackgroundStudioOpen]);
  // OTG_BACKGROUND_STUDIO_BODY_SCROLL_LOCK_V36G

  useEffect(() => {
    if (!characterBackgroundStudioOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [characterBackgroundStudioOpen]);
  // OTG_BACKGROUND_STUDIO_BODY_SCROLL_LOCK_V36H

  function resetBackgroundStudioPageScrollV36Q() {
    if (typeof document === "undefined") return;

    document.body.style.overflow = "";
    document.body.style.position = "";
    document.body.style.width = "";
    document.body.style.height = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.classList.remove("overflow-hidden");

    document.documentElement.style.overflow = "";
    document.documentElement.style.position = "";
    document.documentElement.style.width = "";
    document.documentElement.style.height = "";
    document.documentElement.classList.remove("overflow-hidden");
  }

  function closeCharacterBackgroundStudioV36Q() {
    setCharacterBackgroundStudioOpen(false);
    resetBackgroundStudioPageScrollV36Q();

    if (typeof window !== "undefined") {
      window.setTimeout(resetBackgroundStudioPageScrollV36Q, 0);
      window.setTimeout(resetBackgroundStudioPageScrollV36Q, 50);
      window.setTimeout(resetBackgroundStudioPageScrollV36Q, 250);
    }
  }

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    if (!characterBackgroundStudioOpen) {
      resetBackgroundStudioPageScrollV36Q();
      return undefined;
    }

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      resetBackgroundStudioPageScrollV36Q();
    };
  }, [characterBackgroundStudioOpen]);

  // OTG_BACKGROUND_STUDIO_SCROLL_UNLOCK_V36Q
  async function deleteCharacterBackgroundReferenceV36E(id: string, name: string) {
    if (!id) return;

    const confirmed = window.confirm(`Delete background "${name || id}"?`);
    if (!confirmed) return;

    setCharacterBackgroundBusy(true);
    setCharacterBackgroundStatus("Deleting background...");

    try {
      const response = await fetch("/api/backgrounds", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "delete",
          id,
        }),
      });

      const json = await response.json().catch(() => null);

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || `Delete background failed (${response.status}).`);
      }

      setCharacterBackgroundRefs((current) => {
        const updated = current.filter((item) => item.id !== id);
        writeCharacterBackgroundLibraryV36A(updated);
        return updated;
      });

      setCharacterBackgroundStatus("Background deleted.");
    } catch (error: any) {
      setCharacterBackgroundStatus(error?.message || "Delete background failed.");
    } finally {
      setCharacterBackgroundBusy(false);
    }
  }

  async function createCharacterBackgroundPreviewsV36E() {
    const finalPrompt = buildCharacterBackgroundPromptV36E({
      name: characterBackgroundName.trim(),
      locationType: characterBackgroundLocationType.trim(),
      style: characterBackgroundStyle.trim() || "Cinematic",
      describeScene: characterBackgroundContinuityBlock.trim(),
      promptOverride: characterBackgroundPrompt.trim(),
    });

    if (!finalPrompt.trim()) {
      setCharacterBackgroundStatus("Describe the scene or build a prompt first.");
      return;
    }

    const previewCount = clampCharacterBackgroundPreviewCountV36E(characterBackgroundPreviewCount);
    const provider = characterBackgroundProvider === "krea2-turbo" ? "krea2-turbo" : characterBackgroundProvider === "z-turbo" ? "z-turbo" : "ernie-image";
    const backgroundPreviewBatchIdV36R = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const backgroundPreviewRunIdV36R = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    setCharacterBackgroundBusy(true);
    setCharacterBackgroundStatus(`Creating ${previewCount} landscape background preview${previewCount === 1 ? "" : "s"}...`);
    setCharacterBackgroundPreviewCandidates([]);
    setSelectedCharacterBackgroundCandidateId("");

    try {
      const candidates: CharacterBackgroundPreviewCandidateV36E[] = [];

      for (let index = 0; index < previewCount; index += 1) {
        const body = new FormData();
        body.set("prompt", finalPrompt);
        body.set("positivePrompt", finalPrompt);
        body.set("negativePrompt", "characters, people, person, face, body, portrait, text, captions, watermark, logo, blurry, low quality, vertical frame");
        const backgroundPreviewTitleV36G = `${(characterBackgroundName.trim() || "background").replace(/[^a-zA-Z0-9_-]+/g, "-")}-preview-${backgroundPreviewRunIdV36R}-${index + 1}`;
        body.set("title", backgroundPreviewTitleV36G);
        body.set("filenamePrefix", backgroundPreviewTitleV36G);
        body.set("filename_prefix", backgroundPreviewTitleV36G);
        body.set("previewRunId", backgroundPreviewRunIdV36R);
        body.set("previewIndex", String(index + 1));
        body.set("previewCount", String(previewCount));
        body.set("expectedWidth", "1280");
        body.set("expectedHeight", "720");
        body.set("expectedAspectRatio", "16:9");
        body.set("name", characterBackgroundName.trim() || "Scene Background");
        appendBackgroundComfyRoutingFieldsV36E(body, provider);

        const response = await fetch("/api/comfy", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "x-otg-device-id": getCharacterDeviceId(),
          },
          body,
        });

        const json = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(json?.error || `Background preview ${index + 1} failed (${response.status}).`);
        }

        if (json?.ok === false && json?.error) {
          throw new Error(json.error);
        }

        let candidate: CharacterBackgroundPreviewCandidateV36E | null = null;

        try {
          candidate = extractBackgroundPreviewCandidateV36H({
            json,
            provider,
            prompt: finalPrompt,
            index,
            name: characterBackgroundName.trim() || "Scene Background",
          });
        } catch {
          const maxAttempts = 36;
          for (let attempt = 0; attempt < maxAttempts && !candidate; attempt += 1) {
            await waitForBackgroundPreviewV36G(attempt === 0 ? 4000 : 3000);
            candidate = await findExactBackgroundPreviewCandidateV36R({
              provider,
              prompt: finalPrompt,
              index,
              name: characterBackgroundName.trim() || "Scene Background",
              title: backgroundPreviewTitleV36G,
            });
          }
        }

        if (!candidate) {
          throw new Error(`Background preview ${index + 1} was queued, but the app could not find a matching current-run output named ${backgroundPreviewTitleV36G}. It will not sync a random recent image.`);
        }

        candidates.push(candidate);
        setCharacterBackgroundPreviewCandidates([...candidates]);
        setSelectedCharacterBackgroundCandidateId((current) => current || candidate.id);
      }

      const uniqueCandidatesV36R = candidates.filter((candidate, index, array) => {
        const key = String(candidate.workflowImage || candidate.displayImage || candidate.imagePath || candidate.imageUrl || candidate.id).toLowerCase();
        return key && array.findIndex((item) => String(item.workflowImage || item.displayImage || item.imagePath || item.imageUrl || item.id).toLowerCase() === key) === index;
      }).slice(0, previewCount);

      setCharacterBackgroundPreviewCandidates(uniqueCandidatesV36R);
      setSelectedCharacterBackgroundCandidateId((current) => {
        if (current && uniqueCandidatesV36R.some((candidate) => candidate.id === current)) {
          return current;
        }

        return uniqueCandidatesV36R[0]?.id || "";
      });

      setCharacterBackgroundStatus(`${uniqueCandidatesV36R.length} preview${uniqueCandidatesV36R.length === 1 ? "" : "s"} created at 1280x720. Select exactly one preview and click Use Image to create the complete background image plate.`);
    } catch (error: any) {
      setCharacterBackgroundStatus(error?.message || "Create background previews failed.");
    } finally {
      setCharacterBackgroundBusy(false);
    }
  }



  async function removePeopleFromCharacterBackgroundCandidateV36S(candidate: CharacterBackgroundPreviewCandidateV36E | null | undefined) {
    if (!candidate) {
      setCharacterBackgroundStatus("Select a background preview before removing people.");
      return;
    }

    const sourceValue = backgroundPreviewBestImageValueV36S(candidate);
    const loadImageValue = backgroundPreviewComfyLoadImageValueV36S(sourceValue);

    if (!loadImageValue) {
      setCharacterBackgroundStatus("Remove People failed: selected preview has no usable image path.");
      return;
    }

    const originalProvider = candidate.provider === "krea2-turbo" ? "krea2-turbo" : candidate.provider === "z-turbo" ? "z-turbo" : "ernie-image";
    const editRunId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const editTitle = `${(characterBackgroundName.trim() || "background").replace(/[^a-zA-Z0-9_-]+/g, "-")}-remove-people-${editRunId}`;
    const removePeoplePrompt = "remove all people from the image, remove every human figure, fill the removed areas naturally with matching background details, preserve the same room, lighting, architecture, materials, camera angle, perspective, color palette, and cinematic style, no people, no faces, no bodies";

    setCharacterBackgroundBusy(true);
    setCharacterBackgroundStatus("Removing people from selected preview with Qwen Image Edit...");

    try {
      const body = new FormData();
      body.set("prompt", removePeoplePrompt);
      body.set("positivePrompt", removePeoplePrompt);
      body.set("negativePrompt", "");
      body.set("title", editTitle);
      body.set("filenamePrefix", editTitle);
      body.set("filename_prefix", editTitle);

      body.set("workflowFile", "workflows/backgrounds/qwen-image-edit-remove-people.json");
      body.set("workflowPath", "workflows/backgrounds/qwen-image-edit-remove-people.json");
      body.set("workflow", "workflows/backgrounds/qwen-image-edit-remove-people.json");
      body.set("workflowName", "qwen-image-edit-remove-people.json");

      body.set("provider", "qwen-image-edit");
      body.set("mode", "remove-people");
      body.set("operation", "remove-people");

      body.set("inputImage", loadImageValue);
      body.set("sourceImage", loadImageValue);
      body.set("sourceImagePath", loadImageValue);
      body.set("image", loadImageValue);
      body.set("imagePath", loadImageValue);
      body.set("loadImage", loadImageValue);
      body.set("loadImageValue", loadImageValue);

      body.set("loadImageNodeId", "78");
      body.set("loadImageInput", "image");
      body.set("promptNodeId", "433:111");
      body.set("promptNodeInput", "prompt");
      body.set("negativePromptNodeId", "433:110");
      body.set("negativePromptNodeInput", "prompt");
      body.set("saveImageNodeId", "60");
      body.set("saveImageInput", "filename_prefix");
      body.set("seedNodeId", "433:3");
      body.set("seedNodeInput", "seed");

      body.set("nodeOverride.78.inputs.image", loadImageValue);
      body.set("nodeOverride.433:111.inputs.prompt", removePeoplePrompt);
      body.set("nodeOverride.433:110.inputs.prompt", "");
      body.set("nodeOverride.60.inputs.filename_prefix", editTitle);

      const response = await fetch("/api/background-remove-people", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        body,
      });

      const json = await response.json().catch(() => null);

      if (!response.ok || json?.ok === false) {
        throw new Error(json?.error || `Remove People failed (${response.status}).`);
      }

      const removePeopleRoutePrefixV36AE = String(json?.expectedOutputPrefix || json?.filenamePrefix || editTitle);
      setCharacterBackgroundStatus("Remove People queued. Waiting for cleaned output to replace the selected preview...");

      let cleaned: CharacterBackgroundPreviewCandidateV36E | null = await waitForBackgroundRemovePeopleOutputCandidateV36AE({
        provider: originalProvider,
        prompt: candidate.prompt || removePeoplePrompt,
        index: 0,
        name: characterBackgroundName.trim() || candidate.name || "Scene Background",
        prefix: removePeopleRoutePrefixV36AE,
        timeoutMs: 240000,
      });

      const directMatch = collectBackgroundPreviewImageStringsV36R(json)
        .filter((value, index, array) => array.indexOf(value) === index)
        .find((value) => {
          const raw = String(value || "").toLowerCase();
          const decoded = decodePreviewMatchTextV36R(value);
          return raw.includes(editTitle.toLowerCase()) || decoded.includes(editTitle.toLowerCase());
        });

      cleaned = cleaned || (directMatch
        ? makeExactBackgroundPreviewCandidateV36R({
            value: directMatch,
            provider: originalProvider,
            prompt: candidate.prompt || removePeoplePrompt,
            index: 0,
            name: characterBackgroundName.trim() || candidate.name || "Scene Background",
          })
        : null);

      const started = Date.now();

      while (!cleaned && Date.now() - started < 240000) {
        cleaned = await findExactBackgroundPreviewCandidateV36R({
          provider: originalProvider,
          prompt: candidate.prompt || removePeoplePrompt,
          index: 0,
          name: characterBackgroundName.trim() || candidate.name || "Scene Background",
          title: editTitle,
        });

        if (cleaned) break;

        await new Promise((resolve) => window.setTimeout(resolve, 3000));
      }

      if (!cleaned) {
        throw new Error(`Remove People completed or queued, but the app could not find exact output ${removePeopleRoutePrefixV36AE}. The selected preview was not replaced.`);
      }

      const updatedCandidate: CharacterBackgroundPreviewCandidateV36E = {
        ...candidate,
        ...cleaned,
        id: `background-preview-remove-people-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: `${candidate.name || "Background Preview"} - People Removed`,
        prompt: candidate.prompt || removePeoplePrompt,
        provider: originalProvider,
        createdAt: new Date().toISOString(),
      };

      setCharacterBackgroundPreviewCandidates((current) =>
        current.map((item) => (item.id === candidate.id ? updatedCandidate : item)),
      );
      setSelectedCharacterBackgroundCandidateId(updatedCandidate.id);
      setExpandedCharacterBackgroundCandidateId(updatedCandidate.id);
      setCharacterBackgroundStatus("People removed. The selected preview slot was replaced with the cleaned image.");
    } catch (error: any) {
      setCharacterBackgroundStatus(error?.message || "Remove People failed.");
    } finally {
      setCharacterBackgroundBusy(false);
    }
  }

  async function createCharacterBackgroundAnglePlateFromCandidateV36AF(candidate: CharacterBackgroundPreviewCandidateV36E | null | undefined) {
    if (!candidate) {
      setCharacterBackgroundStatus("Select a background preview before creating the complete background image.");
      return;
    }

    const existingPlate = candidate as any;

    if (existingPlate?.isCompleteBackgroundPlateV36AF) {
      useCharacterBackgroundCandidateV36J(normalizeCompleteBackgroundPlateCandidateForSaveV36AG(candidate));
      return;
    }

    const sourceValue = backgroundPreviewBestImageValueV36S(candidate);
    const originalDisplayValue = String((candidate as any).sourceDisplayImageV36AF || candidate.displayImage || candidate.imageUrl || sourceValue || "").trim();
    const originalWorkflowValue = String((candidate as any).sourceWorkflowImageV36AF || candidate.workflowImage || candidate.imagePath || sourceValue || "").trim();

    if (!sourceValue) {
      setCharacterBackgroundStatus("Create angle plate failed: selected preview has no usable image.");
      return;
    }

    const originalProvider = candidate.provider === "krea2-turbo" ? "krea2-turbo" : candidate.provider === "z-turbo" ? "z-turbo" : "ernie-image";
    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const safeName = (characterBackgroundName.trim() || candidate.name || "background").replace(/[^a-zA-Z0-9_-]+/g, "-");
    const platePrefix = `${safeName}-complete-background-plate-${runId}`;

    setCharacterBackgroundBusy(true);
    setCharacterBackgroundPreviewCandidates([]);
    setSelectedCharacterBackgroundCandidateId("");
    setExpandedCharacterBackgroundCandidateId("");
    setCharacterBackgroundStatus("Creating complete background image plate from selected preview...");

    try {
      const body = new FormData();
      body.set("title", characterBackgroundName.trim() || candidate.name || "Scene Background");
      body.set("name", characterBackgroundName.trim() || candidate.name || "Scene Background");
      body.set("filenamePrefix", platePrefix);
      body.set("filename_prefix", platePrefix);
      body.set("loadImageValue", sourceValue);
      body.set("inputImage", sourceValue);
      body.set("sourceImage", sourceValue);
      body.set("sourceImagePath", sourceValue);
      body.set("imagePath", sourceValue);
      body.set("image", sourceValue);

      const response = await fetch("/api/background-angle-plate", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        body,
      });

      const json = await response.json().catch(() => null);

      if (!response.ok || json?.ok === false) {
        throw new Error(json?.error || `Create background plate failed (${response.status}).`);
      }

      const outputPrefix = String(json?.expectedOutputPrefix || json?.filenamePrefix || platePrefix);
      setCharacterBackgroundStatus("Angle workflow queued. Waiting for stitched complete background image...");

      const plateCandidateBase = await waitForBackgroundAnglePlateOutputCandidateV36AF({
        provider: originalProvider,
        prompt: candidate.prompt || characterBackgroundPrompt || "",
        index: 0,
        name: "Complete Background Image",
        prefix: outputPrefix,
        timeoutMs: 900000,
      });

      if (!plateCandidateBase) {
        throw new Error(`Angle workflow queued, but the stitched plate output was not found: ${outputPrefix}`);
      }

      const plateWorkflowValue = String(plateCandidateBase.workflowImage || plateCandidateBase.imagePath || plateCandidateBase.displayImage || plateCandidateBase.imageUrl || "").trim();

      const completePlateCandidate = {
        ...plateCandidateBase,
        id: `background-complete-plate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: "Complete Background Image",
        prompt: candidate.prompt || characterBackgroundPrompt || "",
        provider: originalProvider,
        displayImage: originalDisplayValue || originalWorkflowValue || sourceValue,
        imageUrl: originalDisplayValue || originalWorkflowValue || sourceValue,
        imagePath: originalWorkflowValue || originalDisplayValue || sourceValue,
        workflowImage: plateWorkflowValue,
        createdAt: new Date().toISOString(),
        sourceDisplayImageV36AF: originalDisplayValue || sourceValue,
        sourceWorkflowImageV36AF: originalWorkflowValue || sourceValue,
        plateWorkflowImageV36AF: plateWorkflowValue,
        isCompleteBackgroundPlateV36AF: true,
      } as CharacterBackgroundPreviewCandidateV36E;

      setCharacterBackgroundPreviewCandidates([completePlateCandidate]);
      setSelectedCharacterBackgroundCandidateId(completePlateCandidate.id);
      setExpandedCharacterBackgroundCandidateId(completePlateCandidate.id);
      setCharacterBackgroundStatus("Complete background image created. Select it and click Use Image to save the background card.");
    } catch (error: any) {
      setCharacterBackgroundStatus(error?.message || "Create complete background image failed.");
    } finally {
      setCharacterBackgroundBusy(false);
    }
  }

  function handleCharacterBackgroundUseImageV36AF(candidate: CharacterBackgroundPreviewCandidateV36E | null | undefined) {
    if (!candidate) {
      setCharacterBackgroundStatus("Select a preview first.");
      return;
    }

    if ((candidate as any)?.isCompleteBackgroundPlateV36AF) {
      useCharacterBackgroundCandidateV36J(normalizeCompleteBackgroundPlateCandidateForSaveV36AG(candidate));
      return;
    }

    void createCharacterBackgroundAnglePlateFromCandidateV36AF(candidate);
  }
  function useCharacterBackgroundCandidateV36J(candidate: CharacterBackgroundPreviewCandidateV36E | null | undefined) {
    candidate = normalizeSavedBackgroundCandidateForSaveV36AH3(candidate);

    if (!candidate) {
      setCharacterBackgroundStatus("Select or create a background preview first.");
      return;
    }

    const label = characterBackgroundName.trim() || candidate.name || "Scene Background";
    const now = new Date().toISOString();

    const next: CharacterBackgroundReferenceV36A = {
      id: `background-${safeCharacterBackgroundIdV36A(label)}-${Date.now()}`,
      name: label,
      type: "background",
      locationType: characterBackgroundLocationType.trim() || undefined,
      style: characterBackgroundStyle.trim() || "Cinematic",
      prompt: candidate.prompt,
      masterPrompt: candidate.prompt,
      continuityBlock: characterBackgroundContinuityBlock.trim() || undefined,
      doNotChange: [],
      imagePath: candidate.imagePath || undefined,
      imageUrl: candidate.imageUrl || undefined,
      displayImage: candidate.displayImage || candidate.imageUrl || candidate.imagePath || undefined,
      workflowImage: candidate.workflowImage || candidate.imagePath || candidate.imageUrl || undefined,
      source: "created",
      createdAt: now,
      updatedAt: now,
    };

    saveCharacterBackgroundReferenceV36A(next);
    setExpandedCharacterBackgroundCandidateId("");
    setCharacterBackgroundStatus("Preview image saved. Next phase will create the 10-image background angle plate.");
  }
  function useSelectedCharacterBackgroundImageV36E() {
    const selected =
      characterBackgroundPreviewCandidates.find((candidate) => candidate.id === selectedCharacterBackgroundCandidateId) || null;

    if (!selected) {
      setCharacterBackgroundStatus("Select exactly one background preview first.");
      return;
    }

    const label = characterBackgroundName.trim() || selected.name || "Scene Background";
    const now = new Date().toISOString();

    const next: CharacterBackgroundReferenceV36A = {
      id: `background-${safeCharacterBackgroundIdV36A(label)}-${Date.now()}`,
      name: label,
      type: "background",
      locationType: characterBackgroundLocationType.trim() || undefined,
      style: characterBackgroundStyle.trim() || "Cinematic",
      prompt: selected.prompt,
      masterPrompt: selected.prompt,
      continuityBlock: characterBackgroundContinuityBlock.trim() || undefined,
      doNotChange: [],
      imagePath: selected.imagePath || undefined,
      imageUrl: selected.imageUrl || undefined,
      displayImage: selected.displayImage || selected.imageUrl || selected.imagePath || undefined,
      workflowImage: selected.workflowImage || selected.imagePath || selected.imageUrl || undefined,
      source: "created",
      createdAt: now,
      updatedAt: now,
    };

    saveCharacterBackgroundReferenceV36A(next);
    setCharacterBackgroundStatus("Preview image saved. Next phase will create the 10-image background angle plate.");
  }
  async function uploadCharacterBackgroundV36A(file: File | null | undefined) {
    if (!file) return;

    setCharacterBackgroundBusy(true);
    setCharacterBackgroundStatus("Uploading background...");

    try {
      const uploaded = await uploadBlob(file, file.name || `background-${Date.now()}.png`);
      const imagePath = String(uploaded.serverPath || "").trim();
      const imageUrl = String(uploaded.fileUrl || "").trim();

      if (!imagePath && !imageUrl) {
        throw new Error("Background upload did not return an image path or URL.");
      }

      const label = characterBackgroundName.trim() || file.name.replace(/\.[a-z0-9]+$/i, "") || "Uploaded Background";
      const next: CharacterBackgroundReferenceV36A = {
        id: `background-${safeCharacterBackgroundIdV36A(label)}-${Date.now()}`,
        name: label,
        type: "background",
        locationType: characterBackgroundLocationType.trim() || undefined,
        style: characterBackgroundStyle.trim() || "cinematic realistic",
        masterPrompt: characterBackgroundPrompt.trim(),
        continuityBlock: characterBackgroundContinuityBlock.trim() || undefined,
        imagePath: imagePath || undefined,
        imageUrl: imageUrl || undefined,
        displayImage: imageUrl || imagePath || undefined,
        workflowImage: imagePath || imageUrl || undefined,
        source: "uploaded",
        createdAt: new Date().toISOString(),
      };

      saveCharacterBackgroundReferenceV36A(next);
      setCharacterBackgroundStatus("Background uploaded and saved for Production Storyboard.");
    } catch (error: any) {
      setCharacterBackgroundStatus(error?.message || "Upload background failed.");
    } finally {
      setCharacterBackgroundBusy(false);
    }
  }

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
      const response = await characterFetch("/api/characters", {
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
        const response = await characterFetch("/api/characters", {
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

    const sampleUrl = String(result.enhancedAudioUrl || result.isolatedAudioUrl || result.sampleUrl || "").trim();
    const samplePath = String(result.enhancedAudioPath || result.isolatedAudioPath || result.uploadedSamplePath || result.samplePath || "").trim();

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
    const rawProvider = String(result.provider || job.input?.provider || "").trim();
    const provider = rawProvider === "ltx" || rawProvider === "unnatural_ltx"
      ? rawProvider
      : rawProvider === "cosy"
        ? "cosy"
        : "qwen3";

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
      approvedSampleUrl: tunedSampleUrl,
      approvedSamplePath: tunedSamplePath || undefined,
      updatedAt: now,
    };

    void persistCharacterVoiceProfile(
      characterId,
      profile,
      "Tuned voice sample saved to character profile.",
      "Tuned voice sample ready and selected for training.",
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
      fallbackProvider : job.input?.provider === "cosy" ? "cosy" : voiceProvider,
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
      "Could not attach voice model artifact to character profile.",
    );
  }, [
    voicePipelineJobs.start_applio_training?.job,
    details.name,
    characters,
    builderCharacterVoiceProfile,
    voiceProvider,
    persistCharacterVoiceProfile,
  ]);



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
      Object.keys(voicePipelineJobs).length,
    );
  const showSavedCharactersStrip = step === "source" && !hasActiveCreateCharacterDraft;
  function currentBuilderStepIndex() {
    return builderStepIndexFor(step);
  }

  function getFullBodyGateError() {
    if (characterInputMode === "create" && characterAnatomyMode === "standard") return "";
    if (!selectedFullBody?.serverPath) return FULL_BODY_REQUIRED_MESSAGE;
    if (characterInputMode === "upload" && fullBodyStatus !== "approved") return FULL_BODY_REQUIRED_MESSAGE;
    if (characterAnatomyMode === "freeform" && fullBodyStatus !== "approved") return FULL_BODY_REQUIRED_MESSAGE;
    if (characterAnatomyMode === "freeform" && !freeformFullBodyConfirmed) return FREEFORM_FULL_BODY_CONFIRM_MESSAGE;
    return "";
  }

  function requireFullBodyForDownstream() {
    const fullBodyGateError = getFullBodyGateError();
    if (!fullBodyGateError) return true;
    setError(fullBodyGateError);
    showBuilderStepIfEditable(selectedFullBody?.serverPath ? "card" : characterInputMode === "upload" ? "upload" : "source");
    return false;
  }

  function builderStepCompletionError(stepId: BuilderCanonicalStep) {
    if (stepId === "source" || stepId === "voice") {
      const fullBodyGateError = getFullBodyGateError();
      if (fullBodyGateError) return fullBodyGateError;
    }
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
      voiceProvider : "qwen3",
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
async function loadCharacters() {
    setLoading(true);
    setError("");
    try {
      const response = await characterFetch("/api/characters", {
        cache: "no-store",
        credentials: "omit",
        headers: { "x-otg-device-id": getCharacterDeviceId() },
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
      window.localStorage.removeItem(getCharacterBuilderDraftKey());
      if (characterDraftSaveTimeoutRef.current !== null) {
        window.clearTimeout(characterDraftSaveTimeoutRef.current);
      }
      void characterFetch(`/api/characters/builder-draft?ownerId=${encodeURIComponent(getCharacterDeviceId())}`, {
        method: "DELETE",
        credentials: "omit",
        headers: { "x-otg-device-id": getCharacterDeviceId() },
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
    setCharacterAnatomyMode("standard");
    setCharacterInputMode("create");
    setSourceFraming("full_body");
    setFullBodyStatus("not_required");
    setMissingGuidance("");
    setFullBodyPrompt("");
    setFreeformFullBodyConfirmed(false);
    setFreeformCreateOrientation("portrait");
    setBackgroundRemovalStatus("idle");
    setBackgroundRemovalWarning("");
    setSelectedFullBody(null);
    setCharacterCard(null);
    setCharacterIdentity(EMPTY_CHARACTER_IDENTITY);
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
  }

  function imageCompletenessForSourceFraming(nextSourceFraming: SourceFraming): ImageCompleteness {
    if (nextSourceFraming === "face") return "face_only";
    return nextSourceFraming;
  }

  function fullBodyStatusForEntry(nextAnatomyMode: CharacterAnatomyMode, nextInputMode: CharacterInputMode, nextSourceFraming: SourceFraming): FullBodyStatus {
    if (nextInputMode === "create") return nextAnatomyMode === "freeform" ? "required" : "not_required";
    return nextSourceFraming === "full_body" ? "approved" : "required";
  }

  function chooseCharacterBuilderEntry(nextAnatomyMode: CharacterAnatomyMode, nextInputMode: CharacterInputMode) {
    const nextSourceFraming: SourceFraming = "full_body";
    const nextStep: BuilderStep = nextInputMode === "create" ? "generate" : "upload";
    setCharacterAnatomyMode(nextAnatomyMode);
    setCharacterInputMode(nextInputMode);
    setSourceFraming(nextSourceFraming);
    setImageCompleteness(imageCompletenessForSourceFraming(nextSourceFraming));
    setFullBodyStatus(fullBodyStatusForEntry(nextAnatomyMode, nextInputMode, nextSourceFraming));
    setCandidates([]);
    setSelectedCandidateId("");
    setUploadedImage(null);
    setSelectedFullBody(null);
    setCharacterCard(null);
    setCharacterIdentity(EMPTY_CHARACTER_IDENTITY);
    setMissingGuidance("");
    setFullBodyPrompt("");
    setFreeformFullBodyConfirmed(false);
    setBackgroundRemovalStatus("idle");
    setBackgroundRemovalWarning("");
    setError("");
    setMessage(
      nextAnatomyMode === "freeform"
        ? "Freeform characters must end with a complete body or full form before Character Card or Angles."
        : "Standard character mode selected.",
    );
    setStep(nextStep);
    saveCharacterBuilderDraftNow({
      step: nextStep,
      activeBuilderPage: nextStep,
      lastBuilderStep: nextStep,
      characterAnatomyMode: nextAnatomyMode,
      characterInputMode: nextInputMode,
      sourceFraming: nextSourceFraming,
      imageCompleteness: imageCompletenessForSourceFraming(nextSourceFraming),
      fullBodyStatus: fullBodyStatusForEntry(nextAnatomyMode, nextInputMode, nextSourceFraming),
      candidates: [],
      selectedCandidateId: "",
      uploadedImage: null,
      selectedFullBody: null,
      characterCard: null,
      characterIdentity: EMPTY_CHARACTER_IDENTITY,
      promptReadyDescription: "",
      missingGuidance: "",
      fullBodyPrompt: "",
      freeformFullBodyConfirmed: false,
      freeformCreateOrientation: "portrait",
      backgroundRemovalStatus: "idle",
      backgroundRemovalWarning: "",
    });
  }

  function updateSourceFraming(nextSourceFraming: SourceFraming) {
    setSourceFraming(nextSourceFraming);
    setImageCompleteness(imageCompletenessForSourceFraming(nextSourceFraming));
    setFullBodyStatus(fullBodyStatusForEntry(characterAnatomyMode, characterInputMode, nextSourceFraming));
    setSelectedFullBody(null);
    setCharacterCard(null);
    setCharacterIdentity(EMPTY_CHARACTER_IDENTITY);
    setFreeformFullBodyConfirmed(false);
    setBackgroundRemovalStatus("idle");
    setBackgroundRemovalWarning("");
    saveCharacterBuilderDraftNow({
      sourceFraming: nextSourceFraming,
      imageCompleteness: imageCompletenessForSourceFraming(nextSourceFraming),
      fullBodyStatus: fullBodyStatusForEntry(characterAnatomyMode, characterInputMode, nextSourceFraming),
      selectedFullBody: null,
      characterCard: null,
      characterIdentity: EMPTY_CHARACTER_IDENTITY,
      promptReadyDescription: "",
      freeformFullBodyConfirmed: false,
      freeformCreateOrientation: "portrait",
      backgroundRemovalStatus: "idle",
      backgroundRemovalWarning: "",
    });
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
      const createOrientation: CharacterCreateOrientation =
        characterAnatomyMode === "freeform" && characterInputMode === "create" ? freeformCreateOrientation : "portrait";
      const internalPrompt = buildInternalPrompt(prompt, stylePreset, characterAnatomyMode, createOrientation);
      setMessage(`Character image job queued (${createOrientation}). Waiting for ComfyUI output...`);
      const job = await submitCharacterImageJob(internalPrompt, stylePreset, createOrientation);
      setMessage(`Character image job submitted. Prompt ID: ${job.promptId}. Waiting for output...`);
      const generated = await waitForCharacterImage(job.promptId);
      const upload = await copyGeneratedImageToCharacterUpload(generated.url, `${id}.png`);
      pushCandidate({
        id,
        label: characterAnatomyMode === "freeform" && characterInputMode === "create" ? `${stylePreset} ${createOrientation} candidate` : `${stylePreset} candidate`,
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
      const response = await characterFetch("/api/characters/upload", {
        method: "POST",
        headers: { "x-otg-device-id": getCharacterDeviceId() },
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
      setFullBodyStatus(fullBodyStatusForEntry(characterAnatomyMode, characterInputMode, sourceFraming));
      setMessage("Uploaded image is ready for completeness review.");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  async function removeFreeformBackground(candidate: CandidateImage): Promise<CandidateImage> {
    const sourceServerPath = candidate.serverPath || "";
    if (!sourceServerPath) {
      throw new Error("Selected Freeform image does not have a stable server path for background removal.");
    }

    setBackgroundRemovalStatus("running");
    setBackgroundRemovalWarning("");

    const response = await characterFetch("/api/background-remove", {
      method: "POST",
      headers: CHARACTER_JSON_HEADERS,
      credentials: "omit",
      body: JSON.stringify({ imagePath: sourceServerPath }),
    });
    const json = await response.json().catch(() => null);

    if (!response.ok || !json?.ok) {
      throw new Error(json?.error || "Background removal failed.");
    }

    const removedPath = String(json.imagePath || json.path || "").trim();
    const removedUrl = String(json.url || "").trim();
    if (!removedPath || !removedUrl) {
      throw new Error("Background removal did not return an output image.");
    }

    return {
      ...candidate,
      id: `${candidate.id}-bg-removed-${Date.now()}`,
      label: `${candidate.label} background removed`,
      url: removedUrl,
      serverPath: removedPath,
      workflowId: "utility/birefnet-remove-background",
    };
  }

  async function ensureBackgroundFreeCharacterSourceForSave(): Promise<CandidateImage> {
    if (!selectedFullBody?.serverPath) {
      throw new Error("Select a full-body character image before saving.");
    }

    if (backgroundRemovalStatus === "done") {
      return selectedFullBody;
    }

    setMessage("Processing character source: removing background before save...");
    const removed = await removeFreeformBackground(selectedFullBody);
    setSelectedFullBody(removed);
    setCharacterCard(null);
    setBackgroundRemovalStatus("done");
    setBackgroundRemovalWarning("");
    saveCharacterBuilderDraftNow({
      step: "card",
      activeBuilderPage: "card",
      lastBuilderStep: "card",
      selectedFullBody: removed,
      characterCard: null,
      backgroundRemovalStatus: "done",
      backgroundRemovalWarning: "",
    });

    return removed;
  }

  async function approveFinalFullBodySource(candidate: CandidateImage) {
    setSelectedFullBody(candidate);
    setFullBodyStatus("approved");
    setFreeformFullBodyConfirmed(false);
    setCharacterCard(null);
    setCharacterIdentity(EMPTY_CHARACTER_IDENTITY);
    setError("");

    let finalCandidate = candidate;
    let finalBackgroundRemovalStatus: "idle" | "done" | "warning" = "idle";

    setLoading(true);
    setMessage("Processing source image: removing background before character-card creation...");
    try {
      finalCandidate = await removeFreeformBackground(candidate);
      setSelectedFullBody(finalCandidate);
      setBackgroundRemovalStatus("done");
      finalBackgroundRemovalStatus = "done";
      setBackgroundRemovalWarning("");
      setMessage("Process complete. Background removed. Create the character card next.");
    } catch {
      setBackgroundRemovalStatus("warning");
      finalBackgroundRemovalStatus = "warning";
      setBackgroundRemovalWarning("Process failed: background removal did not complete. The selected image was kept; retry Process before creating the character card if the default image must be transparent.");
      setMessage("Process failed. The selected image was kept. Retry Process before creating the character card if needed.");
    } finally {
      setLoading(false);
    }

    lockCurrentBuilderStep();
    setStep("card");
    saveCharacterBuilderDraftNow({
      step: "card",
      activeBuilderPage: "card",
      lastBuilderStep: "card",
      selectedFullBody: finalCandidate,
      fullBodyStatus: "approved",
      freeformFullBodyConfirmed: false,
      characterCard: null,
      characterIdentity: EMPTY_CHARACTER_IDENTITY,
      promptReadyDescription: "",
      backgroundRemovalStatus: finalBackgroundRemovalStatus,
      backgroundRemovalWarning: finalBackgroundRemovalStatus === "warning" ? "Background removal failed. The approved image is still selected; retry background removal before continuing if needed." : "",
    });
  }

  async function retryFreeformBackgroundRemoval() {
    if (!selectedFullBody) {
      setError("Select a Freeform character image before retrying background removal.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const removed = await removeFreeformBackground(selectedFullBody);
      setSelectedFullBody(removed);
      setFreeformFullBodyConfirmed(false);
      setCharacterCard(null);
      setCharacterIdentity(EMPTY_CHARACTER_IDENTITY);
      setBackgroundRemovalStatus("done");
      setBackgroundRemovalWarning("");
      setMessage("Process complete. Background removed. Create the character card next.");
    } catch {
      setBackgroundRemovalStatus("warning");
      setBackgroundRemovalWarning("Background removal failed. The approved image is still selected; retry background removal before continuing if needed.");
      setMessage("Background removal failed. The selected image was kept.");
    } finally {
      setLoading(false);
    }
  }

  async function continueUploadedImage() {
    if (!uploadedImage) {
      setError("Upload a character image first.");
      return;
    }
    setError("");
    if (sourceFraming === "full_body") {
      await approveFinalFullBodySource(uploadedImage);
      return;
    }
    if (!fullBodyPrompt.trim()) {
      setError(characterAnatomyMode === "freeform" ? "Describe the complete body or full form before generation." : "Describe the missing full body before generation.");
      return;
    }
    setFullBodyStatus("required");
    setCandidates([]);
    setSelectedCandidateId("");
    setMessage("Generate and approve a full-body/full-form character before Character Card or Angles.");
  }

  async function completePartialImage() {
    if (!uploadedImage) {
      setError("Upload a partial character image first.");
      return;
    }
    if (sourceFraming === "full_body") {
      continueUploadedImage();
      return;
    }
    if (!fullBodyPrompt.trim()) {
      setError(characterAnatomyMode === "freeform" ? "Describe the complete body or full form before generation." : "Describe the missing full body before generation.");
      return;
    }
    const sourceServerPath = uploadedImage.serverPath || "";
    if (!sourceServerPath) {
      setError("Uploaded image does not have a stable server path for full-body generation.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const id = "completed-" + Date.now();
      const instruction = buildUploadedFullBodyCompletionPrompt(characterAnatomyMode, fullBodyPrompt);

      setMessage("Generating full-body character from uploaded reference...");
      const job = await submitUploadedFullBodyCompletionJob(instruction, sourceServerPath, characterAnatomyMode);
      setMessage("Full-body generation job submitted. Prompt ID: " + job.promptId + ". Waiting for output...");

      const generated = await waitForCharacterImage(job.promptId);
      const upload = await copyGeneratedImageToCharacterUpload(generated.url, id + ".png");

      const completedCandidate: CandidateImage = {
        id,
        label: characterAnatomyMode === "freeform" ? "Generated full-form candidate" : "Generated full-body candidate",
        url: upload.fileUrl || generated.url,
        serverPath: upload.serverPath,
        internalPrompt: instruction,
        promptId: job.promptId,
        workflowId: workflowForUploadedFullBodyCompletion(),
      };

      pushCandidate(completedCandidate);
      setFullBodyStatus("generated");
      setMessage("Full-body character generated. Review the candidate, select it, then click Use This Character to approve it.");
    } catch (err: any) {
      console.error(err);
      setError("Full-body generation failed. Check ComfyUI/edit-image workflow and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function useSelectedCandidate() {
    if (!selectedCandidate) {
      setError("Select a character candidate first.");
      return;
    }
    await approveFinalFullBodySource(selectedCandidate);
  }

  async function createCharacterCardCandidateFromProcessedSource(processedSource: CandidateImage, options: { forSave?: boolean } = {}): Promise<CandidateImage> {
    const sourceServerPath = processedSource.serverPath || "";
    if (!sourceServerPath) {
      throw new Error("Selected full-body image does not have a stable server path for the character-card workflow.");
    }

    const id = "character-card-" + Date.now();
    const instruction = "Create a clean transparent-background character reference sheet from the selected full-body character image. Preserve the exact same character identity, face, hairstyle, outfit, body proportions, colors, materials, clothing, and accessories. Arrange one composite card with five labeled views: FACE CLOSE-UP, FRONT VIEW, BACK VIEW, LEFT SIDE VIEW, and RIGHT SIDE VIEW. Keep the character centered, neutral, uncropped, full body visible for body views, no redesign, no new clothing, no changed accessories, no different character. Use transparent background only; no room, scenery, environment, backdrop, floor, wall, gradient, shadow plate, or baked-in background.";

    setMessage(options.forSave ? "Creating required character card before save..." : "Creating 8-angle character card...");
    const job = await submitCharacterCardJob(instruction, sourceServerPath);
    setMessage("Character card job submitted. Prompt ID: " + job.promptId + ". Waiting for output...");

    const generated = await waitForCharacterCardImage(job.promptId);
    const upload = await copyGeneratedImageToCharacterUpload(generated.url, id + ".png");
    return {
      id,
      label: "Multi-view character reference card",
      url: upload.fileUrl || generated.url,
      serverPath: upload.serverPath,
      internalPrompt: instruction,
      promptId: job.promptId,
      workflowId: workflowForCharacterCard(),
    };
  }

  async function createCharacterCard() {
    if (!requireFullBodyForDownstream()) return;
    if (!selectedFullBody) {
      setError("Select a full-body character image first.");
      return;
    }

    let processedSource = selectedFullBody;
    try {
      processedSource = await ensureBackgroundFreeCharacterSourceForSave();
    } catch (err: any) {
      setError(err?.message || String(err));
      setMessage("");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const characterCardCandidate = await createCharacterCardCandidateFromProcessedSource(processedSource);

      setPreviousCharacterCardBeforeBackgroundRemovalV36BPT6(null);
      setCharacterCardBackgroundRemovalStatusV36BPT6("idle");
      setCharacterCard(characterCardCandidate);

      lockCurrentBuilderStep();
      showBuilderStepIfEditable("details");
      setMessage("Character card created. Continue with details.");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }


  async function removeCharacterCardBackgroundV36BPT6() {
    if (!characterCard?.serverPath) {
      setError("Character card does not have a stable server path for background removal.");
      return;
    }

    const originalCard = characterCard;
    setCharacterCardBackgroundRemovalStatusV36BPT6("running");
    setError("");
    setMessage("Removing background from character card...");

    try {
      const response = await characterFetch("/api/background-remove", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({ imagePath: originalCard.serverPath }),
      });
      const json = await response.json().catch(() => null);

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "Character card background removal failed.");
      }

      const removedPath = String(json.imagePath || json.path || "").trim();
      const removedUrl = String(json.url || "").trim();
      if (!removedPath || !removedUrl) {
        throw new Error("Background removal did not return a character card output image.");
      }

      const removedCard: CandidateImage = {
        ...originalCard,
        id: `${originalCard.id}-bg-removed-${Date.now()}`,
        label: `${originalCard.label} background removed`,
        url: removedUrl,
        serverPath: removedPath,
        workflowId: "utility/birefnet-remove-background",
      };

      setPreviousCharacterCardBeforeBackgroundRemovalV36BPT6(originalCard);
      setCharacterCard(removedCard);
      setCharacterCardBackgroundRemovalStatusV36BPT6("removed");
      saveCharacterBuilderDraftNow({
        step: "details",
        activeBuilderPage: "details",
        lastBuilderStep: "details",
        characterCard: removedCard,
      });
      setMessage("Character card background removed. Use Undo Remove Background to restore the previous card.");
    } catch (err: any) {
      setCharacterCardBackgroundRemovalStatusV36BPT6("error");
      setError(err?.message || String(err));
      setMessage("Character card background removal failed.");
    }
  }

  function undoCharacterCardBackgroundRemovalV36BPT6() {
    if (!previousCharacterCardBeforeBackgroundRemovalV36BPT6) {
      setError("No previous character card is available to restore.");
      return;
    }

    const restoredCard = previousCharacterCardBeforeBackgroundRemovalV36BPT6;
    setCharacterCard(restoredCard);
    setPreviousCharacterCardBeforeBackgroundRemovalV36BPT6(null);
    setCharacterCardBackgroundRemovalStatusV36BPT6("idle");
    saveCharacterBuilderDraftNow({
      step: "details",
      activeBuilderPage: "details",
      lastBuilderStep: "details",
      characterCard: restoredCard,
    });
    setError("");
    setMessage("Restored the original character card before background removal.");
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
        const model = value as VoiceDesignModelId;
        next.mode = value === "cosyvoice" ? "instruct" : "voice_design";
        next.language = "English";
        next.accentDialectId = model === "ltxvoice" ? DEFAULT_LTX_VOICE_DIALECT_ID : "";
        if (model === "unnaturalvoices") {
          next.sampleText = selectedUnnaturalVoicePreset.sampleLine;
          next.advancedInstructionOverride = buildUnnaturalVoicePrompt(selectedUnnaturalVoicePreset.id);
          setLtxSampleTextIsCustom(false);
        } else if (model === "ltxvoice") {
          const sampleText = getLtxDialectSampleText(next.accentDialectId);
          next.sampleText = ltxSampleTextIsCustom ? current.sampleText : sampleText;
        } else {
          next.sampleText = DEFAULT_VOICE_SAMPLE_TEXT;
          setLtxSampleTextIsCustom(false);
        }
        setVoiceProvider(model === "unnaturalvoices" ? "unnatural_ltx" : model === "ltxvoice" ? "ltx" : model === "cosyvoice" ? "cosy" : "qwen3");
      }
      if (key === "language") {
        next.language = "English";
      }
      if (key === "accentDialectId" && current.model === "ltxvoice" && !ltxSampleTextIsCustom) {
        next.sampleText = getLtxDialectSampleText(String(value));
      }
      if (key === "qwenPresetSpeaker") {
        next.accentDialectId = String(value);
      }
      if (key === "sampleText" && current.model === "ltxvoice") {
        setLtxSampleTextIsCustom(!isLtxDialectSampleText(String(value)));
      }
      return next;
    });
    clearQwenVoiceSelection();
  }

  function selectUnnaturalVoiceCategory(category: UnnaturalVoiceCategory) {
    const firstPreset = UNNATURAL_VOICE_PRESETS.find((preset) => preset.category === category) || UNNATURAL_VOICE_PRESETS[0];
    setUnnaturalVoiceCategory(category);
    setUnnaturalVoicePresetId(firstPreset.id);
    if (voiceDesignProfile.model === "unnaturalvoices") {
      setVoiceDesignProfile((current) => ({
        ...current,
        sampleText: firstPreset.sampleLine,
        advancedInstructionOverride: buildUnnaturalVoicePrompt(firstPreset.id),
      }));
      clearQwenVoiceSelection();
    }
  }

  function selectUnnaturalVoicePreset(presetId: string) {
    const preset = UNNATURAL_VOICE_PRESETS.find((item) => item.id === presetId) || selectedUnnaturalVoicePreset;
    setUnnaturalVoicePresetId(preset.id);
    if (voiceDesignProfile.model === "unnaturalvoices") {
      setVoiceDesignProfile((current) => ({
        ...current,
        sampleText: preset.sampleLine,
        advancedInstructionOverride: buildUnnaturalVoicePrompt(preset.id),
      }));
      clearQwenVoiceSelection();
    }
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
    if (voiceDesignProfile.model === "unnaturalvoices") {
      const preset = selectedUnnaturalVoicePreset;
      setVoicePromptSnapshot({
        generatedAt: new Date().toISOString(),
        provider: "unnatural_ltx",
        model: "unnatural-voices",
        mode: "voice_design",
        prompt: preset.prompt,
        text: preset.sampleLine,
        sampleText: preset.sampleLine,
        unnaturalVoicePreset: preset,
        payload: {
          provider: "unnatural_ltx",
          model: "unnatural-voices",
          mode: "voice_design",
          voiceMode: "unnatural_voice",
          source: "unnatural_voice_preset",
          presetId: preset.id,
          presetName: preset.name,
          presetCategory: preset.category,
          prompt: preset.prompt,
          text: preset.sampleLine,
          sampleText: preset.sampleLine,
          unnaturalVoicePreset: preset,
        },
      });
      setQwenVoiceCandidates([]);
      setSelectedQwenVoiceCandidateId("");
      setQwenVoiceDesignRecord(null);
      setVoicePackCreated(false);
      setVoicePackRecord(null);
      setVoicePreview(null);
      setBuilderCharacterVoiceProfile(null);
      setError("");
      setMessage("Unnatural voice preset ready. Click Generate Voice to run the LTX audio workflow.");
      return;
    }

    const payload = buildVoiceRequestPayload(voiceDesignProfile);
    const baseInstruction = String(payload.instruct || payload.prompt || "").trim();
    const previewText = String(payload.text || voiceDesignProfile.sampleText || QWEN_PREVIEW_LINES.neutral_standard).trim();

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
      label: `${voiceModels[voiceDesignProfile.model].label} Option ${index + 1}`,
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
    setMessage(`Generated a clean ${voiceModels[voiceDesignProfile.model].label} prompt snapshot. Pick one option${voiceDesignProfile.model === "ltxvoice" ? "; ComfyUI execution will be wired in Patch 2." : ", then click Create Voice."}`);
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
    const apiFileUrlFallback = [selectedFullBody?.url, characterCard?.url, uploadedImage?.url]
      .map((value) => String(value || "").trim())
      .find((value) => value.startsWith("/api/file?path=")) || "";
    const imagePath = selectedFullBody?.serverPath || characterCard?.serverPath || uploadedImage?.serverPath || apiFileUrlFallback;
    if (!imagePath) {
      setError("Create a character card or select a full-body character image before using Complete Description.");
      return;
    }

    setAutoDescribeLoading(true);
    setError("");
    setMessage("Completing character description from manual fields and the selected character image...");
    try {
      const response = await fetch("/api/vision-prompt", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({
          imagePath,
          purpose: "character_details",
          characterAnatomyMode,
          characterName: details.name.trim(),
          manualDetails: details,
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok || !json) {
        throw new Error(json?.error || "Complete Description failed. Check provider settings or use manual details.");
      }

      const visionDetails = json.details || {};
      const descriptor = String(json.descriptor || "").trim();
      const manualClothing = sanitizeClothingAccessoriesInput(details.clothingAccessories);
      const providerClothing = cleanVisionDescriptor(String(visionDetails.clothingAccessories || descriptor || ""));

      let nextIdentity: CharacterIdentity = EMPTY_CHARACTER_IDENTITY;

      setDetails((current) => ({
        ...current,
        clothingAccessories: sanitizeClothingAccessoriesInput(current.clothingAccessories).clothingAccessories || providerClothing,
        surfaceDescription: current.surfaceDescription.trim() || cleanVisionDescriptor(String(visionDetails.surfaceDescription || "")),
        hairFurColor: current.hairFurColor.trim() || cleanVisionDescriptor(String(visionDetails.hairFurColor || "")),
        eyeColor: current.eyeColor.trim() || cleanVisionDescriptor(String(visionDetails.eyeColor || "")),
      }));

      const mergedDetails: CharacterDetails = {
        ...details,
        clothingAccessories: manualClothing.clothingAccessories || providerClothing,
        surfaceDescription: details.surfaceDescription.trim() || cleanVisionDescriptor(String(visionDetails.surfaceDescription || "")),
        hairFurColor: details.hairFurColor.trim() || cleanVisionDescriptor(String(visionDetails.hairFurColor || "")),
        eyeColor: details.eyeColor.trim() || cleanVisionDescriptor(String(visionDetails.eyeColor || "")),
      };
      nextIdentity = buildCharacterIdentity({
        details: mergedDetails,
        characterAnatomyMode,
        characterInputMode,
        visionDetails,
      });
      if (!nextIdentity.promptReadyDescription.trim()) {
        throw new Error("Complete Description did not produce a usable identity block.");
      }

      setCharacterIdentity(nextIdentity);
      saveCharacterBuilderDraftNow({
        details: mergedDetails,
        characterIdentity: nextIdentity,
        promptReadyDescription: nextIdentity.promptReadyDescription,
      });
      setMessage("Complete Description generated. Review and lock the character identity before saving.");
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setAutoDescribeLoading(false);
    }
  }

  function lockCharacterDescription() {
    const identity = characterIdentity.promptReadyDescription.trim()
      ? characterIdentity
      : buildCharacterIdentity({ details, characterAnatomyMode, characterInputMode });
    const locked = { ...identity, lockedAt: new Date().toISOString() };
    setCharacterIdentity(locked);
    saveCharacterBuilderDraftNow({
      characterIdentity: locked,
      promptReadyDescription: locked.promptReadyDescription,
    });
    setMessage("Character identity description locked for production continuity.");
  }

  function unlockCharacterDescription() {
    const unlocked = { ...characterIdentity, lockedAt: undefined };
    setCharacterIdentity(unlocked);
    saveCharacterBuilderDraftNow({
      characterIdentity: unlocked,
      promptReadyDescription: unlocked.promptReadyDescription,
    });
    setMessage("Character identity description unlocked for editing.");
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
    const isUnnaturalVoiceCreate = action === "create_voice_sample" && voiceDesignProfile.model === "unnaturalvoices";
    const unnaturalPreset = selectedUnnaturalVoicePreset;

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
      if (isUnnaturalVoiceCreate && (!unnaturalPreset?.id || !unnaturalPreset?.prompt)) {
        const message = "Unnatural voice preset not found.";
        setError(message);
        setVoicePipelineJobs((current) => ({
          ...current,
          [action]: { phase: "error", error: message },
        }));
        return;
      }
      if (!isUnnaturalVoiceCreate && (!voicePromptSnapshot || !selectedQwenVoiceCandidate)) {
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
      const fullBodyGateError = getFullBodyGateError();
      const message = fullBodyGateError
        ? fullBodyGateError
        : !trainedVoiceReady
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

    const unnaturalVoicePayload: Record<string, any> | null =
      isUnnaturalVoiceCreate
        ? {
            provider: "unnatural_ltx",
            model: "unnatural-voices",
            mode: "voice_design",
            voiceMode: "unnatural_voice",
            source: "unnatural_voice_preset",
            presetId: unnaturalPreset.id,
            presetName: unnaturalPreset.name,
            presetCategory: unnaturalPreset.category,
            prompt: unnaturalPreset.prompt,
            text: unnaturalPreset.sampleLine,
            sampleText: unnaturalPreset.sampleLine,
            unnaturalVoicePreset: unnaturalPreset,
          }
        : null;

    const activeGeneratedVoicePayload: Record<string, any> | null =
      isUnnaturalVoiceCreate
        ? unnaturalVoicePayload
        : action === "create_voice_sample" && voicePromptSnapshot?.payload && typeof voicePromptSnapshot.payload === "object"
          ? voicePromptSnapshot.payload as Record<string, any>
          : null;

    const selectedGeneratedVoiceInstruction =
      isUnnaturalVoiceCreate ? String(unnaturalPreset.prompt || "") :
      selectedQwenVoiceCandidate?.fullInstruction ||
      String(qwenVoiceDesignRecord?.voiceInstruction || activeGeneratedVoicePayload?.instruct || activeGeneratedVoicePayload?.prompt || "");

    const selectedGeneratedSampleText =
      isUnnaturalVoiceCreate ? String(unnaturalPreset.sampleLine || "") :
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
        provider: isUnnaturalVoiceCreate ? "unnatural_ltx" : voiceProvider,
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
        ltxDialect:
          action === "create_voice_sample" && voiceDesignProfile.model === "ltxvoice"
            ? activeGeneratedVoicePayload?.accentDialect
            : undefined,
        ltxDialectId:
          action === "create_voice_sample" && voiceDesignProfile.model === "ltxvoice"
            ? activeGeneratedVoicePayload?.accentDialect?.id
            : undefined,
        ltxDialectLabel:
          action === "create_voice_sample" && voiceDesignProfile.model === "ltxvoice"
            ? activeGeneratedVoicePayload?.accentDialect?.label
            : undefined,
        ltxSpokenLine:
          action === "create_voice_sample" && voiceDesignProfile.model === "ltxvoice"
            ? selectedGeneratedSampleText
            : undefined,
        ltxAuditionPrompt:
          action === "create_voice_sample" && voiceDesignProfile.model === "ltxvoice"
            ? String(activeGeneratedVoicePayload?.ltxAuditionPrompt || activeGeneratedVoicePayload?.prompt || selectedGeneratedVoiceInstruction)
            : undefined,
        ...(isUnnaturalVoiceCreate ? {
          // OTG_UNNATURAL_VOICES_P2: fixed preset prompts queue as audio-only LTX jobs.
          provider: "unnatural_ltx",
          voiceMode: "unnatural_voice",
          presetId: unnaturalPreset.id,
          presetName: unnaturalPreset.name,
          presetCategory: unnaturalPreset.category,
          prompt: unnaturalPreset.prompt,
          text: unnaturalPreset.sampleLine,
          sampleLine: unnaturalPreset.sampleLine,
          source: "unnatural_voice_preset",
          ownerKey: getCharacterDeviceId(),
        } : {}),
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

  async function processLtxVoiceAudio(action: LtxAudioPostProcessAction, job: QueuedContractJob, result: Record<string, unknown>) {
    // OTG_LTX_AUDIO_POST_PROCESSING: process completed LTX voice samples without replacing the original.
    const characterId = String(job.characterId || safeId(details.name)).trim();
    const originalPath = String(
      result.samplePath ||
      result.outputAudioPath ||
      result.uploadedSamplePath ||
      builderCharacterVoiceProfile?.baseSamplePath ||
      builderCharacterVoiceProfile?.approvedSamplePath ||
      "",
    ).trim();
    const isolatedPath = String(result.isolatedAudioPath || "").trim();
    const inputPath = action === "enhance_voice" ? (isolatedPath || originalPath) : originalPath;

    if (!inputPath) {
      setError("Cannot process LTX audio because the local sample path is missing.");
      return;
    }

    const statusMessage =
      action === "remove_background"
        ? "Removing background sound and effects..."
        : "Enhancing voice clarity...";
    const failureMessage =
      action === "remove_background"
        ? "Could not isolate voice. Original LTX audio is still available."
        : "Voice enhancement failed. Previous audio is still available.";

    setError("");
    setMessage(statusMessage);
    setLtxAudioProcessing({ action, jobId: job.jobId, message: statusMessage });

    try {
      const response = await fetch("/api/characters/voice-sample/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-otg-device-id": getCharacterDeviceId(),
        },
        credentials: "include",
        cache: "no-store",
        // OTG_LTX_PROCESS_JSON_BODY: keep this as a real JSON Request Payload for Network tab inspection.
        body: JSON.stringify({
          provider: String(result.provider || "ltx") === "unnatural_ltx" ? "unnatural_ltx" : "ltx",
          action,
          samplePath: inputPath,
          originalSamplePath: originalPath,
          ownerKey: job.ownerKey || "",
          characterId,
          jobId: job.jobId,
        }),
      });
      const json = await response.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
        message?: string;
        job?: QueuedContractJob;
      } | null;

      if (!response.ok || !json?.ok || !json.job) {
        throw new Error(json?.error || failureMessage);
      }

      setVoicePipelineJobs((current) => ({
        ...current,
        create_voice_sample: {
          ...(current.create_voice_sample || { phase: "queued" }),
          phase: "queued",
          job: json.job,
          error: undefined,
        },
      }));

      const updatedResult = json.job.result && typeof json.job.result === "object" && !Array.isArray(json.job.result)
        ? json.job.result as Record<string, unknown>
        : {};
      const preferredSampleUrl = String(updatedResult.enhancedAudioUrl || updatedResult.isolatedAudioUrl || updatedResult.sampleUrl || "").trim();
      const preferredSamplePath = String(updatedResult.enhancedAudioPath || updatedResult.isolatedAudioPath || updatedResult.uploadedSamplePath || updatedResult.samplePath || "").trim();

      if (preferredSampleUrl) {
        const profile: CharacterVoiceProfile = {
          ...(builderCharacterVoiceProfile?.characterId === characterId ? builderCharacterVoiceProfile : {
            characterId,
             provider: String(updatedResult.provider || result.provider || "ltx") === "unnatural_ltx" ? "unnatural_ltx" : "ltx",
            status: "sample_ready",
            updatedAt: new Date().toISOString(),
          }),
          characterId,
          provider: String(updatedResult.provider || result.provider || "ltx") === "unnatural_ltx" ? "unnatural_ltx" : "ltx",
          baseSamplePath: String(updatedResult.uploadedSamplePath || updatedResult.samplePath || builderCharacterVoiceProfile?.baseSamplePath || "").trim() || undefined,
          baseSampleUrl: String(updatedResult.sampleUrl || builderCharacterVoiceProfile?.baseSampleUrl || "").trim() || preferredSampleUrl,
          approvedSamplePath: preferredSamplePath || undefined,
          approvedSampleUrl: preferredSampleUrl,
          sourceJobId: json.job.jobId,
          mockResult: updatedResult,
          status: "sample_ready",
          updatedAt: new Date().toISOString(),
        };

        void persistCharacterVoiceProfile(
          characterId,
          profile,
          "LTX processed voice sample saved to character profile.",
          json.message || "LTX processed voice sample ready.",
          "Could not save processed LTX voice sample to character profile.",
        );
      }

      setMessage(json.message || "LTX audio post-processing completed.");
    } catch (error) {
      setError(error instanceof Error ? error.message : failureMessage);
      setMessage(failureMessage);
    } finally {
      setLtxAudioProcessing({ action: "", jobId: "", message: "" });
    }
  }

      // OTG_VOICE_EFFECTS_REWORK_P3A_OPTIONS
  const simplePitchOptions = [
    { id: "simple_pitch_very_deep", label: "Very Deep", effectId: "monster_deep_voice", intensity: "strong" as VoiceEffectIntensity },
    { id: "simple_pitch_deep", label: "Deep", effectId: "monster_deep_voice", intensity: "medium" as VoiceEffectIntensity },
    { id: "simple_pitch_normal", label: "Normal", effectId: "", intensity: "medium" as VoiceEffectIntensity },
    { id: "simple_pitch_high", label: "High", effectId: "tiny_creature", intensity: "medium" as VoiceEffectIntensity },
    { id: "simple_pitch_very_high", label: "Very High", effectId: "tiny_creature", intensity: "strong" as VoiceEffectIntensity },
  ];

  const simpleEchoOptions = [
    { id: "simple_echo_none", label: "None", effectId: "", intensity: "medium" as VoiceEffectIntensity },
    { id: "simple_echo_small", label: "Small Echo", effectId: "far_away_voice", intensity: "subtle" as VoiceEffectIntensity },
    { id: "simple_echo_medium", label: "Medium Echo", effectId: "cave_echo", intensity: "medium" as VoiceEffectIntensity },
    { id: "simple_echo_large", label: "Large Echo", effectId: "cave_echo", intensity: "strong" as VoiceEffectIntensity },
  ];

  const ffmpegAdvancedVoiceOptions = [
    { id: "clean_robot", label: "Robotic", description: "Synthetic robot tone." },
    { id: "demonic_distortion", label: "Distortion", description: "Dark gritty distortion." },
    { id: "buzzing_circuit", label: "Buzz", description: "Electrical circuit buzz." },
    { id: "wah_wah_mutant", label: "Wah-Wah", description: "Moving filter mutant voice." },
    { id: "old_radio_distance", label: "Telephone / Radio", description: "Band-limited radio or phone voice." },
    { id: "alien_modulation", label: "Alien Modulation", description: "Alien vibrato, tremolo, and chorus." },
    { id: "monster_deep_voice", label: "Monster Low Voice", description: "Deep monster pitch and body." },
    { id: "tiny_creature", label: "Chipmunk High Voice", description: "High tiny creature pitch." },
    { id: "cave_echo", label: "Echo", description: "Large echo and room tail." },
    { id: "dream_reverb", label: "Chorus", description: "Soft chorus and dream movement." },
    { id: "haunted_room", label: "Tremolo", description: "Haunted tremolo instability." },
    { id: "glitching_cyborg", label: "Vibrato", description: "Cyborg vibrato and glitch movement." },
    { id: "broken_robot", label: "Bitcrush / Glitchy", description: "Broken robot bitcrush and choppy modulation." },
  ];

  const pedalboardAdvancedOptions = [
    { id: "pedalboard_studio", label: "Studio", description: "Studio polish chain. Manual controls can override this preset when unlocked." },
    { id: "pedalboard_distortion", label: "Distortion", description: "Pedalboard distortion. Manual controls can override this preset when unlocked." },
    { id: "pedalboard_phaser", label: "Phaser", description: "Pedalboard phaser. Manual controls can override this preset when unlocked." },
    { id: "pedalboard_chorus", label: "Chorus", description: "Pedalboard chorus. Manual controls can override this preset when unlocked." },
    { id: "pedalboard_delay", label: "Delay", description: "Pedalboard delay. Manual controls can override this preset when unlocked." },
    { id: "pedalboard_reverb", label: "Reverb", description: "Pedalboard reverb. Manual controls can override this preset when unlocked." },
    { id: "pedalboard_pitch_shift", label: "Pitch-Shifting", description: "Pedalboard pitch shift. Manual controls can override this preset when unlocked." },
    { id: "pedalboard_plugin_chain", label: "Plugin Chain", description: "Future plugin chain support." },
    { id: "pedalboard_vst3_presets", label: "VST3 Effects Presets", description: "Future VST3 preset support." },
  ];

  const soxAdvancedOptions = [
    { id: "sox_synthwave", label: "Synthwave", description: "SoX synthwave effect. Manual controls can override this preset when unlocked." },
    { id: "sox_chip", label: "Chip / Chiptune", description: "SoX chip voice effect. Manual controls can override this preset when unlocked." },
    { id: "sox_overdrive", label: "Overdrive Voice", description: "SoX overdrive. Manual controls can override this preset when unlocked." },
    { id: "sox_echo_filtering", label: "Echo Filtering", description: "SoX echo/filter chain. Manual controls can override this preset when unlocked." },
    { id: "sox_max_conversion", label: "Max Conversion", description: "SoX conversion/normalization chain. Manual controls can override this preset when unlocked." },
  ];
  async function applyVoiceEffectById(args: {
    job: Record<string, unknown>;
    result: Record<string, unknown>;
    effectId: string;
    intensity: VoiceEffectIntensity;
    label: string;
  }) {
    // OTG_VOICE_EFFECTS_REWORK_P3A_CHAIN: apply effect to current working voice if present, otherwise base voice.
    const jobId = String(args.job.jobId || "").trim();
    if (!jobId) {
      setVoiceEffectMessage("Cannot apply effect because the voice job id is missing.");
      return;
    }

    const preset = VOICE_EFFECT_PRESETS.find((item) => item.id === args.effectId);
    if (!preset) {
      setVoiceEffectMessage("Select a valid voice effect preset.");
      return;
    }

    const working = voiceEffectWorkingByJob[jobId];
    const inputPath = String(
      working?.audioPath ||
      args.result.enhancedAudioPath ||
      args.result.isolatedAudioPath ||
      args.result.uploadedSamplePath ||
      args.result.outputAudioPath ||
      args.result.samplePath ||
      args.result.processedSamplePath ||
      args.result.fxSamplePath ||
      builderCharacterVoiceProfile?.approvedSamplePath ||
      builderCharacterVoiceProfile?.tunedSamplePath ||
      builderCharacterVoiceProfile?.baseSamplePath ||
      ""
    ).trim();

    if (!inputPath) {
      setVoiceEffectMessage("Cannot apply effect because the local sample path is missing.");
      return;
    }

    const rawProvider = String(
      args.result.provider ||
      (args.job.input && typeof args.job.input === "object" && !Array.isArray(args.job.input) ? (args.job.input as Record<string, unknown>).provider : "") ||
      builderCharacterVoiceProfile?.provider ||
      voiceProvider ||
      "uploaded"
    ).trim();

    const provider =
      rawProvider === "cosy" ||
      rawProvider === "ltx" ||
      rawProvider === "unnatural_ltx" ||
      rawProvider === "uploaded"
        ? rawProvider
        : "qwen3";

    const characterId = String(
      args.job.characterId ||
      builderCharacterVoiceProfile?.characterId ||
      details.name ||
      "character"
    ).trim();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (typeof window !== "undefined") {
      const deviceId =
        window.localStorage.getItem("otg-device-id") ||
        window.localStorage.getItem("otgDeviceId") ||
        window.localStorage.getItem("deviceId") ||
        "";
      if (deviceId) headers["x-otg-device-id"] = deviceId;
    }

    setVoiceEffectProcessing({
      jobId,
      message: `Applying ${args.label}...`,
    });
    setVoiceEffectMessage("");

    try {
      const response = await fetch("/api/characters/voice-sample/effect", {
        method: "POST",
        headers,
        body: JSON.stringify({
          provider,
          effectId: args.effectId,
          intensity: args.intensity,
          samplePath: inputPath,
          characterId,
          jobId,
        }),
      });

      const json = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok || !json?.ok) {
        throw new Error(String(json?.error || `Voice effect failed with HTTP ${response.status}`));
      }

      const output = {
        effectId: String(json.effectId || args.effectId),
        effectLabel: String(json.effectLabel || args.label),
        category: String(json.category || preset?.category || "ffmpeg"),
        intensity: String(json.intensity || args.intensity),
        engine: String(json.engine || "ffmpeg"),
        audioPath: String(json.audioPath || ""),
        audioUrl: String(json.audioUrl || ""),
      };

      if (!output.audioUrl || !output.audioPath) {
        throw new Error("Voice effect completed but did not return an audio path and URL.");
      }

      setVoiceEffectWorkingByJob((current) => ({
        ...current,
        [jobId]: {
          audioPath: output.audioPath,
          audioUrl: output.audioUrl,
          label: args.label,
        },
      }));

      setVoiceEffectChainByJob((current) => ({
        ...current,
        [jobId]: [
          ...(current[jobId] || []),
          {
            label: args.label,
            effectId: output.effectId,
            engine: output.engine,
            audioPath: output.audioPath,
            audioUrl: output.audioUrl,
          },
        ],
      }));

      setVoiceEffectOutputs((current) => ({
        ...current,
        [jobId]: [...(current[jobId] || []), output],
      }));

      setVoiceEffectMessage(String(json.message || `Voice effect created: ${args.label}.`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVoiceEffectMessage(message || "Voice effect failed. Original audio is still available.");
    } finally {
      setVoiceEffectProcessing(null);
    }
  }

  async function applySimpleVoiceEffects(job: Record<string, unknown>, result: Record<string, unknown>) {
    const pitch = simplePitchOptions.find((item) => item.id === simplePitchEffectId);
    const echo = simpleEchoOptions.find((item) => item.id === simpleEchoEffectId);

    if (!pitch || !echo) {
      setVoiceEffectMessage("Select valid simple pitch and echo options.");
      return;
    }

    if (!pitch.effectId && !echo.effectId) {
      setVoiceEffectMessage("Simple Effects are set to normal/no echo. Nothing to apply.");
      return;
    }

    if (pitch.effectId) {
      await applyVoiceEffectById({
        job,
        result,
        effectId: pitch.effectId,
        intensity: pitch.intensity,
        label: `Simple Pitch: ${pitch.label}`,
      });
    }

    if (echo.effectId) {
      await applyVoiceEffectById({
        job,
        result,
        effectId: echo.effectId,
        intensity: echo.intensity,
        label: `Simple Echo: ${echo.label}`,
      });
    }
  }

  function resetVoiceEffectChain(jobId: string) {
    setVoiceEffectWorkingByJob((current) => {
      const next = { ...current };
      delete next[jobId];
      return next;
    });
    setVoiceEffectChainByJob((current) => ({
      ...current,
      [jobId]: [],
    }));
    setVoiceEffectMessage("Voice effect chain reset to the base voice.");
  }
async function applyVoiceEffectToSample(job: Record<string, unknown>, result: Record<string, unknown>) {
    // OTG_VOICE_EFFECTS_UI_P2: apply FFmpeg-backed effect preset to any completed local voice sample.
    const jobId = String(job.jobId || "").trim();
    if (!jobId) {
      setVoiceEffectMessage("Cannot apply effect because the voice job id is missing.");
      return;
    }

    const selectedPreset = VOICE_EFFECT_PRESETS.find((preset) => preset.id === voiceEffectId);
    if (!selectedPreset) {
      setVoiceEffectMessage("Select a valid voice effect preset.");
      return;
    }

    const inputPath = String(
      result.enhancedAudioPath ||
      result.isolatedAudioPath ||
      result.uploadedSamplePath ||
      result.outputAudioPath ||
      result.samplePath ||
      result.processedSamplePath ||
      result.fxSamplePath ||
      builderCharacterVoiceProfile?.approvedSamplePath ||
      builderCharacterVoiceProfile?.tunedSamplePath ||
      builderCharacterVoiceProfile?.baseSamplePath ||
      ""
    ).trim();

    if (!inputPath) {
      setVoiceEffectMessage("Cannot apply effect because the local sample path is missing.");
      return;
    }

    const rawProvider = String(
      result.provider ||
      (job.input && typeof job.input === "object" && !Array.isArray(job.input) ? (job.input as Record<string, unknown>).provider : "") ||
      builderCharacterVoiceProfile?.provider ||
      voiceProvider ||
      "uploaded"
    ).trim();

    const provider =
      rawProvider === "cosy" ||
      rawProvider === "ltx" ||
      rawProvider === "unnatural_ltx" ||
      rawProvider === "uploaded"
        ? rawProvider
        : "qwen3";

    const characterId = String(
      job.characterId ||
      builderCharacterVoiceProfile?.characterId ||
      details.name ||
      "character"
    ).trim();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (typeof window !== "undefined") {
      const deviceId =
        window.localStorage.getItem("otg-device-id") ||
        window.localStorage.getItem("otgDeviceId") ||
        window.localStorage.getItem("deviceId") ||
        "";
      if (deviceId) headers["x-otg-device-id"] = deviceId;
    }

    setVoiceEffectProcessing({
      jobId,
      message: `Applying ${selectedPreset.label} (${voiceEffectIntensity})...`,
    });
    setVoiceEffectMessage("");

    try {
      const response = await fetch("/api/characters/voice-sample/effect", {
        method: "POST",
        headers,
        body: JSON.stringify({
          provider,
          effectId: selectedPreset.id,
          intensity: voiceEffectIntensity,
          samplePath: inputPath,
          characterId,
          jobId,
        }),
      });

      const json = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok || !json?.ok) {
        throw new Error(String(json?.error || `Voice effect failed with HTTP ${response.status}`));
      }

      const output = {
        effectId: String(json.effectId || selectedPreset.id),
        effectLabel: String(json.effectLabel || selectedPreset.label),
        category: String(json.category || selectedPreset.category),
        intensity: String(json.intensity || voiceEffectIntensity),
        engine: String(json.engine || "ffmpeg"),
        audioPath: String(json.audioPath || ""),
        audioUrl: String(json.audioUrl || ""),
      };

      if (!output.audioUrl) {
        throw new Error("Voice effect completed but did not return an audio URL.");
      }

      setVoiceEffectOutputs((current) => ({
        ...current,
        [jobId]: [...(current[jobId] || []), output],
      }));
      setVoiceEffectMessage(String(json.message || `Voice effect created: ${selectedPreset.label}.`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVoiceEffectMessage(message || "Voice effect failed. Original audio is still available.");
    } finally {
      setVoiceEffectProcessing(null);
    }
  }
function removeLtxBackgroundSoundEffects(job: QueuedContractJob, result: Record<string, unknown>) {
    return processLtxVoiceAudio("remove_background", job, result);
  }

  function enhanceLtxVoice(job: QueuedContractJob, result: Record<string, unknown>) {
    return processLtxVoiceAudio("enhance_voice", job, result);
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
    const completed = job?.status === "completed";
    const audioUrl =
      action === "test_trained_voice"
        ? trainedPlayback?.audioSrc || ""
        : action === "test_character_voice"
          ? basePlayback?.audioSrc || ""
        : result
          ? String(result.outputAudioUrl || result.processedSampleUrl || result.fxSampleUrl || result.previewAudioUrl || result.sampleUrl || "").trim()
          : "";
    const isCompletedLtxVoiceSample =
      action === "create_voice_sample" &&
      completed &&
      result &&
      (String(result.provider || "") === "ltx" || String(result.provider || "") === "unnatural_ltx") &&
      result.mock === false;
    const isUnnaturalLtxVoiceSample = isCompletedLtxVoiceSample && String(result?.provider || "") === "unnatural_ltx";
    const ltxOriginalAudioUrl = isCompletedLtxVoiceSample
      ? String(result.outputAudioUrl || result.sampleUrl || audioUrl || "").trim()
      : "";
    const ltxIsolatedAudioUrl = isCompletedLtxVoiceSample
      ? String(result.isolatedAudioUrl || "").trim()
      : "";
    const ltxEnhancedAudioUrl = isCompletedLtxVoiceSample
      ? String(result.enhancedAudioUrl || "").trim()
      : "";
    const ltxProcessingThisJob = isCompletedLtxVoiceSample && ltxAudioProcessing.jobId === job?.jobId ? ltxAudioProcessing.action : "";
    const voiceEffectPresetsForCategory = VOICE_EFFECT_PRESETS.filter((preset) => preset.category === voiceEffectCategory);
    const selectedVoiceEffectPreset =
      voiceEffectPresetsForCategory.find((preset) => preset.id === voiceEffectId) ||
      voiceEffectPresetsForCategory[0] ||
      VOICE_EFFECT_PRESETS[0];
    const voiceEffectOutputsForJob = job?.jobId ? (voiceEffectOutputs[String(job.jobId)] || []) : [];    const voiceEffectWorkingForJob = job?.jobId ? voiceEffectWorkingByJob[String(job.jobId)] : null;
    const voiceEffectChainForJob = job?.jobId ? (voiceEffectChainByJob[String(job.jobId)] || []) : [];
    const voiceEffectIsProcessing = Boolean(job?.jobId && voiceEffectProcessing?.jobId === String(job.jobId));
    const isVoiceEffectEligible =
      action === "create_voice_sample" &&
      completed &&
      result &&
      result.mock === false &&
      Boolean(String(
        result.enhancedAudioPath ||
        result.isolatedAudioPath ||
        result.uploadedSamplePath ||
        result.outputAudioPath ||
        result.samplePath ||
        result.processedSamplePath ||
        result.fxSamplePath ||
        builderCharacterVoiceProfile?.approvedSamplePath ||
        builderCharacterVoiceProfile?.tunedSamplePath ||
        builderCharacterVoiceProfile?.baseSamplePath ||
        ""
      ).trim());
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
    const effectiveStatus = voiceJobEffectiveStatus(job);
    const datasetGeneratedCount = action === "generate_training_dataset" ? Number(result?.generatedClipCount || 0) : 0;
    const datasetRequestedCount = action === "generate_training_dataset" ? Math.max(1, Number(result?.requestedClipCount || result?.clipCount || job?.input?.requestedClipCount || job?.input?.clipCount || 200)) : 0;
    const displayProgress = action === "generate_training_dataset" && job
      ? Math.max(0, Math.min(100, Math.round((datasetGeneratedCount / datasetRequestedCount) * 100)))
      : progress;
    const isMockResult = Boolean(result && result.mock !== false);
    const labels: Partial<Record<CharacterVoicePipelineAction, Partial<Record<string, string>> & { idle: string; title: string }>> = {
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
    };
    const labelSet = labels[action] || { title: "Job", idle: "No job yet." };
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
              <div className="mt-3 grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-zinc-300 sm:grid-cols-3">
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
                {isCompletedLtxVoiceSample ? (
                  <div className="mt-3 space-y-3">
                    <div>
                      <div className="text-xs font-semibold text-emerald-100">{isUnnaturalLtxVoiceSample ? "Original Unnatural Voice" : "Original LTX Voice"}</div>
                      {ltxOriginalAudioUrl ? (
                        <audio
                          key={`ltx-original-${ltxOriginalAudioUrl}`}
                          controls
                          preload="metadata"
                          src={otgDisplayImageUrlV36BP6(ltxOriginalAudioUrl)}
                          className="mt-2 w-full"
                        />
                      ) : (
                        <div className="mt-2 text-emerald-100/70">Original LTX audio is not available.</div>
                      )}
                    </div>
                    {ltxIsolatedAudioUrl ? (
                      <div>
                        <div className="text-xs font-semibold text-emerald-100">Isolated Voice</div>
                        <audio key={`ltx-isolated-${ltxIsolatedAudioUrl}`} controls preload="metadata" src={otgDisplayImageUrlV36BP6(ltxIsolatedAudioUrl)} className="mt-2 w-full" />
                      </div>
                    ) : null}
                    {ltxEnhancedAudioUrl ? (
                      <div>
                        <div className="text-xs font-semibold text-emerald-100">Enhanced Voice</div>
                        <audio key={`ltx-enhanced-${ltxEnhancedAudioUrl}`} controls preload="metadata" src={otgDisplayImageUrlV36BP6(ltxEnhancedAudioUrl)} className="mt-2 w-full" />
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => job && result ? void removeLtxBackgroundSoundEffects(job, result) : undefined}
                        disabled={Boolean(ltxProcessingThisJob)}
                        className="rounded-lg border border-cyan-400/60 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-100 disabled:opacity-40 hover:bg-cyan-400/20"
                      >
                        {ltxProcessingThisJob === "remove_background" ? "Removing..." : "Remove Background Sound / Effects"}
                      </button>
                      <button
                        type="button"
                        onClick={() => job && result ? void enhanceLtxVoice(job, result) : undefined}
                        disabled={Boolean(ltxProcessingThisJob)}
                        className="rounded-lg border border-emerald-400/60 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100 disabled:opacity-40 hover:bg-emerald-400/20"
                      >
                        {ltxProcessingThisJob === "enhance_voice" ? "Enhancing..." : "Enhance Voice"}
                      </button>
                    </div>
                    {ltxProcessingThisJob ? (
                      <div className="text-xs text-amber-100">{ltxAudioProcessing.message}</div>
                    ) : null}
                  </div>
                ) : audioUrl ? (
                  <audio
                    key={trainedPlayback ? trainedPlayback.audioKey : basePlayback ? basePlayback.audioKey : audioUrl}
                    controls
                    preload="metadata"
                    src={otgDisplayImageUrlV36BP6(audioUrl)}
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
                      src={otgDisplayImageUrlV36BP6(videoUrl)}
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
      const response = await characterFetch("/api/characters/voice-pack", {
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
      const response = await characterFetch("/api/characters/voice-preview", {
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

  // OTG_VOICE_EFFECTS_REWORK_P3A_FXPAGE_HELPERS
  function getVoiceFxPageJobId() {
    return `voice-fx-page-${safeId(details.name || builderCharacterVoiceProfile?.characterId || "character")}`;
  }

  function getVoiceFxPageBaseAudio() {
    const audioPath = String(
      rawVoicePreviewPath ||
      builderCharacterVoiceProfile?.baseSamplePath ||
      builderCharacterVoiceProfile?.approvedSamplePath ||
      builderCharacterVoiceProfile?.tunedSamplePath ||
      ""
    ).trim();

    const audioUrl = String(
      rawVoicePreviewUrl ||
      builderCharacterVoiceProfile?.baseSampleUrl ||
      builderCharacterVoiceProfile?.approvedSampleUrl ||
      builderCharacterVoiceProfile?.tunedSampleUrl ||
      ""
    ).trim();

    return { audioPath, audioUrl };
  }

  async function applyVoiceFxPageEffect(args: {
    effectId: string;
    intensity: VoiceEffectIntensity;
    label: string;
    sourcePath?: string;
    controls?: Record<string, unknown>;
  }): Promise<{ audioPath: string; audioUrl: string; label: string } | null> {
    // OTG_VOICE_EFFECTS_REWORK_P3A_FXPAGE_CHAIN
    const jobId = getVoiceFxPageJobId();
    // OTG_VOICE_EFFECTS_P3B_UI_PRESET_VALIDATION_FIX
    const preset = VOICE_EFFECT_PRESETS.find((item) => item.id === args.effectId);
    const isPedalboardPreset = args.effectId.startsWith("pedalboard_");
    const isSoxPreset = args.effectId.startsWith("sox_");

    if (!preset && !isPedalboardPreset && !isSoxPreset) {
      setVoiceEffectMessage("Select a valid voice effect preset.");
      return null;
    }

    const baseAudio = getVoiceFxPageBaseAudio();
    const working = voiceEffectWorkingByJob[jobId];
    const inputPath = String(args.sourcePath || working?.audioPath || baseAudio.audioPath || "").trim();

    if (!inputPath) {
      setVoiceEffectMessage("Cannot apply effect because the local base voice path is missing.");
      return null;
    }

    const rawProvider = String(builderCharacterVoiceProfile?.provider || voiceProvider || "uploaded").trim();
    const provider =
      rawProvider === "cosy" ||
      rawProvider === "ltx" ||
      rawProvider === "unnatural_ltx" ||
      rawProvider === "uploaded"
        ? rawProvider
        : "qwen3";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (typeof window !== "undefined") {
      const deviceId =
        window.localStorage.getItem("otg-device-id") ||
        window.localStorage.getItem("otgDeviceId") ||
        window.localStorage.getItem("deviceId") ||
        "";
      if (deviceId) headers["x-otg-device-id"] = deviceId;
    }

    setVoiceEffectProcessing({
      jobId,
      message: `Applying ${args.label}...`,
    });
    setVoiceEffectMessage("");

    try {
      const response = await fetch("/api/characters/voice-sample/effect", {
        method: "POST",
        headers,
        body: JSON.stringify({
          provider,
          effectId: args.effectId,
          intensity: args.intensity,
          samplePath: inputPath,
          characterId: safeId(details.name || builderCharacterVoiceProfile?.characterId || "character"),
          jobId,
          controls: args.controls,
        }),
      });

      const json = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok || !json?.ok) {
        throw new Error(String(json?.error || `Voice effect failed with HTTP ${response.status}`));
      }

      const output = {
        effectId: String(json.effectId || args.effectId),
        effectLabel: String(json.effectLabel || args.label),
        category: String(json.category || preset?.category || (isPedalboardPreset ? "pedalboard" : isSoxPreset ? "sox" : "ffmpeg")),
        intensity: String(json.intensity || args.intensity),
        engine: String(json.engine || "ffmpeg"),
        audioPath: String(json.audioPath || ""),
        audioUrl: String(json.audioUrl || ""),
      };

      if (!output.audioPath || !output.audioUrl) {
        throw new Error("Voice effect completed but did not return an audio path and URL.");
      }

      setVoiceEffectWorkingByJob((current) => ({
        ...current,
        [jobId]: {
          audioPath: output.audioPath,
          audioUrl: output.audioUrl,
          label: args.label,
        },
      }));

      setVoiceEffectChainByJob((current) => ({
        ...current,
        [jobId]: [
          ...(current[jobId] || []),
          {
            label: args.label,
            effectId: output.effectId,
            engine: output.engine,
            audioPath: output.audioPath,
            audioUrl: output.audioUrl,
          },
        ],
      }));

      setVoiceEffectOutputs((current) => ({
        ...current,
        [jobId]: [...(current[jobId] || []), output],
      }));

      setVoiceEffectMessage(String(json.message || `Voice effect created: ${args.label}.`));
      return {
        audioPath: output.audioPath,
        audioUrl: output.audioUrl,
        label: args.label,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVoiceEffectMessage(message || "Voice effect failed. Original audio is still available.");
      return null;
    } finally {
      setVoiceEffectProcessing(null);
    }
  }

  async function applyVoiceFxPageSimpleEffects() {
    const pitch = simplePitchOptions.find((item) => item.id === simplePitchEffectId);
    const echo = simpleEchoOptions.find((item) => item.id === simpleEchoEffectId);

    if (!pitch || !echo) {
      setVoiceEffectMessage("Select valid simple pitch and echo options.");
      return;
    }

    if (!pitch.effectId && !echo.effectId) {
      setVoiceEffectMessage("Simple FX is set to Normal and No Echo. Nothing to apply.");
      return;
    }

    let currentPath: string | undefined;

    if (pitch.effectId) {
      const pitchOutput = await applyVoiceFxPageEffect({
        effectId: pitch.effectId,
        intensity: pitch.intensity,
        label: `Simple Pitch: ${pitch.label}`,
      });
      currentPath = pitchOutput?.audioPath || currentPath;
    }

    if (echo.effectId) {
      await applyVoiceFxPageEffect({
        effectId: echo.effectId,
        intensity: echo.intensity,
        label: `Simple Echo: ${echo.label}`,
        sourcePath: currentPath,
      });
    }
  }

  function resetVoiceFxPageChain() {
    const jobId = getVoiceFxPageJobId();

    setVoiceEffectWorkingByJob((current) => {
      const next = { ...current };
      delete next[jobId];
      return next;
    });

    setVoiceEffectChainByJob((current) => ({
      ...current,
      [jobId]: [],
    }));

    setVoiceEffectMessage("Voice FX chain reset to the base voice.");
  }

  function useVoiceFxPageCurrentVersionForTraining() {
    const jobId = getVoiceFxPageJobId();
    const working = voiceEffectWorkingByJob[jobId];
    const characterId = safeId(details.name || builderCharacterVoiceProfile?.characterId || "character");

    if (!working?.audioUrl && !working?.audioPath) {
      setVoiceEffectMessage("No effected working voice is available yet.");
      return;
    }

    setSelectedIndexVoiceReference({
      source: "tuned_voice_fx",
      engine: "OTG Voice FX",
      characterId,
      candidateId: "",
      selectedAt: new Date().toISOString(),
      audioPath: working.audioPath,
      audioUrl: working.audioUrl,
      qwenVoiceDesign,
      qwenVoiceDesignRecord,
      voiceFx,
      voiceFxPreview: null,
      rawVoicePreview: voicePreview || null,
    });

    const now = new Date().toISOString();
    const tunedFxPreset = (builderCharacterVoiceProfile?.tunedFxPreset || voiceFx.preset || "custom") as VoiceFxPreset;
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
      tunedSamplePath: working.audioPath || undefined,
      tunedSampleUrl: working.audioUrl || voiceFileUrlFor(working.audioPath),
      tunedFxPreset,
      tunedSourceJobId: jobId,
      tunedAt: now,
      tunedResult: {
        adapter: "voice_fx_page",
        source: "tuned_voice_fx",
        audioPath: working.audioPath,
        audioUrl: working.audioUrl,
        label: working.label,
      },
      approvedSamplePath: working.audioPath || undefined,
      approvedSampleUrl: working.audioUrl || voiceFileUrlFor(working.audioPath),
      updatedAt: now,
    };

    void persistCharacterVoiceProfile(
      characterId,
      nextProfile,
      "Effected voice sample approved on character profile.",
      "Current effected voice selected for training.",
      "Could not save effected voice selection on character profile.",
    );
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
      const response = await characterFetch("/api/characters/voice-fx", {
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
      const response = await characterFetch("/api/characters/voice-sample/upload", {
        method: "POST",
        headers: { "x-otg-device-id": getCharacterDeviceId() },
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



  function isSavedForLaterCharacterV36BPS2(character: CharacterRecord) {
    const status = String(character.characterStatus || (character as any)?.metadata?.characterStatus || "").trim();
    const source = String((character as any)?.source || "").trim();
    return status === "saved_for_later" || source === "characters_tab_save_for_later" || Boolean((character as any)?.metadata?.savedForLater);
  }

  function savedForLaterSourcePathV36BPS2(character: CharacterRecord) {
    return String(
      character.defaultCharacterSourceImagePath ||
        character.defaultCharacterImagePath ||
        character.backgroundRemovedDefaultImagePath ||
        (character as any).transparentImagePath ||
        (character as any).fullBodyImagePath ||
        character.previewImagePath ||
        character.imagePath ||
        ""
    ).trim();
  }

  async function saveCandidateForLaterV36BPS2(candidate: CandidateImage) {
    if (!candidate?.serverPath) {
      setError("Cannot save for later: selected option is missing a stable server path.");
      return;
    }

    setSaveForLaterProgressByIdV36BPS6B((current) => ({ ...current, [candidate.id]: "saving" }));
    const previousBackgroundRemovalStatus = backgroundRemovalStatus;
    const previousBackgroundRemovalWarning = backgroundRemovalWarning;
    const labelBase = details.name.trim() || candidate.label || "Saved Character";
    const characterName = labelBase.trim() || "Saved Character";
    const characterId = `saved-for-later-${safeId(characterName)}-${Date.now()}`;

    setLoading(true);
    setError("");
    setMessage("Saving character option for later: removing background first...");

    try {
      const processed = await removeFreeformBackground(candidate);
      const processedPath = String(processed.serverPath || "").trim();
      if (!processedPath) {
        throw new Error("Background removal did not return a stable server path.");
      }

      const response = await characterFetch("/api/characters", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({
          id: characterId,
          name: characterName,
          imagePath: processedPath,
          previewImagePath: processedPath,
          transparentImagePath: processedPath,
          fullBodyImagePath: processedPath,
          defaultCharacterImagePath: processedPath,
          defaultCharacterPreviewImagePath: processedPath,
          defaultCharacterSourceImagePath: processedPath,
          backgroundRemovedDefaultImagePath: processedPath,
          defaultCharacterImageStatus: "background_removed",
          originalSourceImagePath: candidate.serverPath,
          description: "",
          globalPromptIdentityBlock: "",
          source: "characters_tab_save_for_later",
          characterStatus: "saved_for_later",
          voiceStatus: "none",
          hasCustomVoice: false,
          metadata: {
            ...details,
            savedForLater: true,
            needsCharacterCard: true,
            needsFinalSave: true,
            characterStatus: "saved_for_later",
            sourceCandidateId: candidate.id,
            sourceCandidateLabel: candidate.label,
            sourceCandidatePromptId: candidate.promptId || "",
            sourceCandidateWorkflowId: candidate.workflowId || "",
            characterAnatomyMode,
            characterInputMode,
            sourceFraming,
            fullBodyStatus: "approved",
            backgroundRemovalStatus: "done",
            backgroundRemovalWarning: "",
          },
          voiceSettings: voice,
          voiceStyleDefinition: "",
          introLine: "",
        }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || `Save for later failed (${response.status}).`);
      }

      await loadCharacters();
      setSaveForLaterProgressByIdV36BPS6B((current) => ({ ...current, [candidate.id]: "saved" }));
      setSavedForLaterCandidateIdsV36BPS3((current) => ({ ...current, [candidate.id]: true }));
      setMessage("Saved. Confirmed in Character Gallery under Save for Later. Use Complete Character when ready.");
    } catch (err: any) {
      setSaveForLaterProgressByIdV36BPS6B((current) => ({ ...current, [candidate.id]: "error" }));
      setError(err?.message || String(err));
      setMessage("Save for Later failed. Fix the error and try again.");
    } finally {
      setBackgroundRemovalStatus(previousBackgroundRemovalStatus === "running" ? "idle" : previousBackgroundRemovalStatus);
      setBackgroundRemovalWarning(previousBackgroundRemovalWarning);
      setLoading(false);
    }
  }

  function completeSavedForLaterCharacterV36BPS2(character: CharacterRecord) {
    const characterId = safeId(String(character.id || character.name || ""));
    const imagePath = savedForLaterSourcePathV36BPS2(character);

    if (!characterId) {
      setError("Cannot complete character: saved-for-later character is missing an id/name.");
      return;
    }

    if (!imagePath) {
      setError("Cannot complete character: saved-for-later character is missing a background-free source image.");
      return;
    }

    const metadata =
      (character as any).metadata && typeof (character as any).metadata === "object" && !Array.isArray((character as any).metadata)
        ? ((character as any).metadata as Record<string, unknown>)
        : {};
    const restoredDetails = {
      ...DEFAULT_DETAILS,
      ...metadata,
      name: String(character.name || metadata.name || characterId),
      surfaceDescription: String(metadata.surfaceDescription || character.description || character.globalPromptIdentityBlock || ""),
    } as CharacterDetails;

    const restoredSource: CandidateImage = {
      id: `${characterId}-save-for-later-source`,
      label: `${character.name || characterId} saved-for-later source`,
      url: fileUrlFor(imagePath),
      serverPath: imagePath,
      workflowId: "characters/save-for-later/background-removed-source",
    };

    setError("");
    setMessage("Loaded saved-for-later character. Create the character card to complete it.");
    setGenerationPrompt("");
    setCandidates([]);
    setSelectedCandidateId("");
    setUploadedImage(null);
    setImageCompleteness("full_body");
    setSourceFraming("full_body");
    setFullBodyStatus("approved");
    setMissingGuidance("");
    setFullBodyPrompt("");
    setFreeformFullBodyConfirmed(true);
    setBackgroundRemovalStatus("done");
    setBackgroundRemovalWarning("");
    setSelectedFullBody(restoredSource);
    setCharacterCard(null);
    setCharacterIdentity(EMPTY_CHARACTER_IDENTITY);
    setDetails(restoredDetails);
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
    setStep("card");
    setLockedBuilderStepIndex(Math.max(lockedBuilderStepIndex, builderStepIndexFor("card") - 1));
    saveCharacterBuilderDraftNow({
      step: "card",
      activeBuilderPage: "card",
      lastBuilderStep: "card",
      selectedFullBody: restoredSource,
      characterCard: null,
      details: restoredDetails,
      fullBodyStatus: "approved",
      imageCompleteness: "full_body",
      sourceFraming: "full_body",
      backgroundRemovalStatus: "done",
      backgroundRemovalWarning: "",
      characterIdentity: EMPTY_CHARACTER_IDENTITY,
    });
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
    setFreeformFullBodyConfirmed(false);
    setBackgroundRemovalStatus("idle");
    setBackgroundRemovalWarning("");
    setCharacterIdentity(EMPTY_CHARACTER_IDENTITY);

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
      const response = await characterFetch("/api/characters", {
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
      const response = await characterFetch("/api/characters/voice-pack", {
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

async function completeCharacterCardOnly() {
    if (!details.name.trim()) {
      setError("Character Name is required before completing the character card.");
      showBuilderStepIfEditable("details");
      return;
    }
    if (!requireFullBodyForDownstream()) return;

    if (!selectedFullBody?.serverPath || !characterCard?.serverPath) {
      setError("A selected full-body image and character card are required before completing without voice.");
      showBuilderStepIfEditable(!selectedFullBody?.serverPath ? "source" : "card");
      return;
    }

    setSaving(true);
    setError("");

    try {
      await ensureBackgroundFreeCharacterSourceForSave();
      const characterId = safeId(details.name);
      const response = await characterFetch("/api/characters", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
          body: JSON.stringify({
            id: characterId,
            name: details.name.trim(),
            fullBodyImagePath: selectedFullBody.serverPath,
            ...(await characterImageContractFromCandidateV36BP5({
              characterName: String((details as any)?.name || "character"),
              characterCard,
            })),
            originalSourceImagePath: uploadedImage?.serverPath || selectedFullBody.serverPath,
          description: identityBlock,
          metadata: { ...details, characterAnatomyMode, characterInputMode, sourceFraming, fullBodyStatus, fullBodyPrompt, freeformFullBodyConfirmed, backgroundRemovalStatus, backgroundRemovalWarning, characterIdentity, promptReadyDescription: characterIdentity.promptReadyDescription },
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
    if (!requireFullBodyForDownstream()) return;

    if (!selectedFullBody?.serverPath || !characterCard?.serverPath) {
      setError("A selected full-body image and character card are required before saving card-only.");
      showBuilderStepIfEditable(!selectedFullBody?.serverPath ? "source" : "card");
      return;
    }

    setSaving(true);
    setError("");

    try {
      await ensureBackgroundFreeCharacterSourceForSave();
      const characterId = safeId(details.name);

      const response = await characterFetch("/api/characters", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
          body: JSON.stringify({
            id: characterId,
            name: details.name.trim(),
            fullBodyImagePath: selectedFullBody.serverPath,
            ...(await characterImageContractFromCandidateV36BP5({
              characterName: String((details as any)?.name || "character"),
              characterCard,
            })),
            originalSourceImagePath: uploadedImage?.serverPath || selectedFullBody.serverPath,
          description: identityBlock,
          metadata: { ...details, characterAnatomyMode, characterInputMode, sourceFraming, fullBodyStatus, fullBodyPrompt, freeformFullBodyConfirmed, backgroundRemovalStatus, backgroundRemovalWarning, characterIdentity, promptReadyDescription: characterIdentity.promptReadyDescription },
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
  
type CharacterDefaultProfileResultV36BP4B = {
  ok: boolean;
  backgroundRemoved: boolean;
  fallback: boolean;
  defaultCharacterImagePath: string;
  defaultCharacterPreviewImagePath: string;
  backgroundRemovedDefaultImagePath: string;
  characterCardWorkflowImagePath: string;
  defaultCharacterImageStatus?: "background_removed" | "fallback_original_card" | "missing";
  warning?: string;
};


function otgDisplayImageUrlV36BP8(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(data:image\/|blob:|https?:\/\/)/i.test(raw)) return raw;
  if (raw.startsWith("/api/otg/local-image")) return raw;

  if (/^\/[A-Za-z]:[\\/]/.test(raw)) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw.slice(1))}`;
  }

  if (raw.startsWith("/")) return raw;

  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.includes("\\data\\") || raw.includes("/data/")) {
    return `/api/otg/local-image?path=${encodeURIComponent(raw)}`;
  }

  return raw.replace(/\\/g, "/");
}

function characterDisplayImagePathV36BP8(character: any) {
  return (
    character?.defaultCharacterPreviewImagePath ||
    character?.defaultCharacterImagePath ||
    character?.backgroundRemovedDefaultImagePath ||
    character?.previewImagePath ||
    character?.imagePath ||
    character?.characterCardPreviewImagePath ||
    character?.characterCardPath ||
    character?.characterCardWorkflowImagePath ||
    ""
  );
}

function getCandidateImageRefV36BP4B(candidate: unknown) {
  const item = (candidate || {}) as any;
  return String(
    item.serverPath ||
      item.workflowImage ||
      item.imagePath ||
      item.imageUrl ||
      item.url ||
      item.previewUrl ||
      item.displayImage ||
      "",
  ).trim();
}

function imageRefFromUnknownV36BP5(candidate: unknown) {
  if (typeof candidate === "string") return candidate.trim();
  const item = (candidate || {}) as any;
  return String(
    item.serverPath ||
      item.workflowImage ||
      item.imagePath ||
      item.imageUrl ||
      item.url ||
      item.previewUrl ||
      item.displayImage ||
      "",
  ).trim();
}

function getUploadDefaultSourceImageRefV36BP5(characterCardCandidate: unknown){
  const uploadDefaultSourceCandidatesV36BP5 = [
    selectedFullBody,
    uploadedImage,
    characterPreviewSourceImagePath,
    characterPreviewSourceImageUrl,
    getCandidateImageRefV36BP4B(characterCardCandidate),
  ];

  for (const candidate of uploadDefaultSourceCandidatesV36BP5) {
    const value = imageRefFromUnknownV36BP5(candidate);
    if (value && value !== "[object File]" && value !== "[object Blob]") return value;
  }

  return getCandidateImageRefV36BP4B(characterCardCandidate);
}

async function createDefaultCharacterProfileImageV36BP4B(args: {
  characterName: string;
  characterCardPath: string;
  defaultCharacterSourceImagePath?: string;
}): Promise<CharacterDefaultProfileResultV36BP4B> {
  const characterCardPath = args.characterCardPath;
  const defaultSource = args.defaultCharacterSourceImagePath || characterCardPath;

  if (!defaultSource && !characterCardPath) {
    return {
      ok: false,
      backgroundRemoved: false,
      fallback: true,
      defaultCharacterImagePath: "",
      defaultCharacterPreviewImagePath: "",
      backgroundRemovedDefaultImagePath: "",
      characterCardWorkflowImagePath: "",
      defaultCharacterImageStatus: "missing",
      warning: "No character image path was available.",
    };
  }

  try {
    const response = await fetch("/api/characters/default-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterName: args.characterName,
        characterCardPath,
        characterCardWorkflowImagePath: characterCardPath,
        defaultCharacterSourceImagePath: defaultSource,
        imageUrl: defaultSource,
      }),
    });

    const json = await response.json().catch(() => null);

    if (!response.ok || !json?.ok) {
      throw new Error(json?.error || `Default profile image request failed with HTTP ${response.status}.`);
    }

    const defaultImagePath = String(json.defaultCharacterImagePath || defaultSource || characterCardPath);
    const defaultPreviewImagePath = String(json.defaultCharacterPreviewImagePath || defaultImagePath);

    return {
      ok: true,
      backgroundRemoved: Boolean(json.backgroundRemoved),
      fallback: Boolean(json.fallback),
      defaultCharacterImagePath: defaultImagePath,
      defaultCharacterPreviewImagePath: defaultPreviewImagePath,
      backgroundRemovedDefaultImagePath: String(json.backgroundRemovedDefaultImagePath || defaultImagePath),
      characterCardWorkflowImagePath: String(json.characterCardWorkflowImagePath || characterCardPath || defaultSource),
      defaultCharacterImageStatus: json.backgroundRemoved ? "background_removed" : "fallback_original_card",
      warning: String(json.warning || ""),
    };
  } catch (error: any) {
    return {
      ok: false,
      backgroundRemoved: false,
      fallback: true,
      defaultCharacterImagePath: defaultSource || characterCardPath,
      defaultCharacterPreviewImagePath: defaultSource || characterCardPath,
      backgroundRemovedDefaultImagePath: defaultSource || characterCardPath,
      characterCardWorkflowImagePath: characterCardPath || defaultSource,
      defaultCharacterImageStatus: "fallback_original_card",
      warning: error?.message || String(error),
    };
  }
}

function characterImageContractPayloadV36BP4B(args: {
  characterCardPath: string;
  defaultProfile: CharacterDefaultProfileResultV36BP4B;
}) {
  const characterCardPath = args.characterCardPath;
  const defaultImagePath = args.defaultProfile.defaultCharacterImagePath || characterCardPath;
  const defaultPreviewPath = args.defaultProfile.defaultCharacterPreviewImagePath || defaultImagePath;

  return {
    imagePath: defaultImagePath,
    previewImagePath: defaultPreviewPath,
    characterCardPath,
    characterCardWorkflowImagePath: args.defaultProfile.characterCardWorkflowImagePath || characterCardPath,
    characterCardPreviewImagePath: characterCardPath,
    defaultCharacterImagePath: defaultImagePath,
    defaultCharacterPreviewImagePath: defaultPreviewPath,
    backgroundRemovedDefaultImagePath: args.defaultProfile.backgroundRemovedDefaultImagePath || defaultImagePath,
    defaultCharacterImageStatus: args.defaultProfile.defaultCharacterImageStatus || "fallback_original_card",
  };
}

async function characterImageContractFromCandidateV36BP5(args: {
  characterName: string;
  characterCard: unknown;
}) {
  const characterCardPath = getCandidateImageRefV36BP4B(args.characterCard);
  const processedDefaultSourcePath =
    imageRefFromUnknownV36BP5(selectedFullBody) ||
    getUploadDefaultSourceImageRefV36BP5(args.characterCard) ||
    characterCardPath;

  const hasProcessedDefault = Boolean(processedDefaultSourcePath && processedDefaultSourcePath !== characterCardPath);
  const defaultImagePath = processedDefaultSourcePath || characterCardPath;

  return {
    imagePath: defaultImagePath,
    previewImagePath: defaultImagePath,
    characterCardPath,
    characterCardWorkflowImagePath: characterCardPath,
    characterCardPreviewImagePath: characterCardPath,
    defaultCharacterImagePath: defaultImagePath,
    defaultCharacterPreviewImagePath: defaultImagePath,
    backgroundRemovedDefaultImagePath: defaultImagePath,
    defaultCharacterImageStatus: hasProcessedDefault ? "background_removed" : "fallback_original_card",
    defaultCharacterSourceImagePath: defaultImagePath,
  };
}

async function characterImageContractFromCandidateV36BP4B(args: {
  characterName: string;
  characterCard: unknown;
}) {
  return characterImageContractFromCandidateV36BP5(args);
}

async function saveCharacter() {
    if (!details.name.trim()) {
      setError("Character Name is required.");
      showBuilderStepIfEditable("details");
      return;
    }
    if (!requireFullBodyForDownstream()) return;
    if (!selectedFullBody?.serverPath) {
      setError("A selected full-body image is required.");
      return;
    }
    if (!voicePackCreated && !builderCharacterVoiceProfile?.baseSampleUrl) {
      setError("Create Voice is required before final save.");
      return;
    }
    const completedPreview = getCharacterPreviewDubSelection(voicePipelineJobs.generate_character_preview?.job);
    // OTG_CHARACTER_COMPLETE_ALLOW_NO_PREVIEW_V1: preview video is optional for saving.
    setSaving(true);
    setError("");
    try {
      const processedFullBody = await ensureBackgroundFreeCharacterSourceForSave();
      const fullBodyForSave = processedFullBody?.serverPath ? processedFullBody : selectedFullBody;
      if (!fullBodyForSave?.serverPath) {
        throw new Error("A selected full-body image is required.");
      }
      let cardForSave = characterCard?.serverPath ? characterCard : null;
      if (!cardForSave) {
        cardForSave = await createCharacterCardCandidateFromProcessedSource(fullBodyForSave, { forSave: true });
        setPreviousCharacterCardBeforeBackgroundRemovalV36BPT6(null);
        setCharacterCardBackgroundRemovalStatusV36BPT6("idle");
        setCharacterCard(cardForSave);
        saveCharacterBuilderDraftNow({
          step: "review",
          activeBuilderPage: "review",
          lastBuilderStep: "review",
          selectedFullBody: fullBodyForSave,
          characterCard: cardForSave,
          backgroundRemovalStatus: "done",
          backgroundRemovalWarning: "",
        });
      }
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
      const response = await characterFetch("/api/characters", {
        method: "POST",
        headers: CHARACTER_JSON_HEADERS,
        credentials: "omit",
        body: JSON.stringify({
          id: characterId,
          name: details.name.trim(),
          fullBodyImagePath: fullBodyForSave.serverPath,
          ...(await characterImageContractFromCandidateV36BP5({
            characterName: String((details as any)?.name || "character"),
            characterCard: cardForSave,
          })),
          originalSourceImagePath: uploadedImage?.serverPath || fullBodyForSave.serverPath,
          description: identityBlock,
          metadata: { ...details, characterAnatomyMode, characterInputMode, sourceFraming, fullBodyStatus, fullBodyPrompt, freeformFullBodyConfirmed, backgroundRemovalStatus, backgroundRemovalWarning, characterIdentity, promptReadyDescription: characterIdentity.promptReadyDescription },
          voiceSettings: voice,
          characterVoiceProfile,
          ...(completedPreview ? {
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
          } : {}),
          voicePackPaths,
          indexVoiceReference: selectedIndexVoiceReference,
          indexVoiceReferencePath: selectedIndexVoiceReference?.audioPath || "",
          indexVoiceReferenceUrl: selectedIndexVoiceReference?.audioUrl || "",
          indexVoiceReferenceSource: selectedIndexVoiceReference?.source || "",
          indexVoicePack,
          indexVoicePackPath: indexVoicePack?.voicePackPath || "",
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
              <button type="button" onClick={() => chooseCharacterBuilderEntry("standard", "create")} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-left hover:border-amber-300">
                <h3 className="text-xl font-semibold text-zinc-50">Create Standard Character</h3>
                <p className="mt-2 text-sm text-zinc-400">Generate a humanoid or biped character using the current full-body character flow.</p>
                <p className="mt-3 text-xs text-zinc-500">Assumes head, torso, two arms, and two legs.</p>
              </button>
              <button type="button" onClick={() => chooseCharacterBuilderEntry("standard", "upload")} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-left hover:border-amber-300">
                <h3 className="text-xl font-semibold text-zinc-50">Upload Standard Character Image</h3>
                <p className="mt-2 text-sm text-zinc-400">Upload a humanoid or biped reference image and confirm whether it is face, half body, or full body.</p>
                <p className="mt-3 text-xs text-zinc-500">Partial uploads use humanoid full-body completion before downstream steps.</p>
              </button>
              <button type="button" onClick={() => chooseCharacterBuilderEntry("freeform", "create")} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-left hover:border-cyan-300">
                <h3 className="text-xl font-semibold text-zinc-50">Create Freeform Character</h3>
                <p className="mt-2 text-sm text-zinc-400">Generate animals, creatures, mermaids, talking trees, robots, monsters, object characters, or floating forms.</p>
                <p className="mt-3 text-xs text-cyan-200">Preserves natural anatomy and does not force humanoid limbs unless requested.</p>
              </button>
              <button type="button" onClick={() => chooseCharacterBuilderEntry("freeform", "upload")} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-left hover:border-cyan-300">
                <h3 className="text-xl font-semibold text-zinc-50">Upload Freeform Character Image</h3>
                <p className="mt-2 text-sm text-zinc-400">Upload a creature, animal, object, robot, plant, or non-standard character reference.</p>
                <p className="mt-3 text-xs text-cyan-200">Final Character Card and Angles source must be a complete full body or full form.</p>
              </button>
            </div>
          ) : null}

          {step === "generate" ? (
            <Panel title="Create Character">
              {characterAnatomyMode === "freeform" ? (
                <div className="mb-4 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
                  {FREEFORM_FULL_BODY_NOTICE}
                </div>
              ) : null}
              <CharacterGeneratorOptionsControl
                selected={selectedCharacterGeneratorOption}
                onSelect={setSelectedCharacterGeneratorOption}
              />
              <label className="block text-sm font-medium text-zinc-200">Prompt</label>
              <textarea value={generationPrompt} onChange={(event) => setGenerationPrompt(event.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-100 outline-none focus:border-amber-300" placeholder="mutant rat teenager" />
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {STYLE_PRESETS.map((preset) => (
                  <button key={preset} type="button" onClick={() => setStylePreset(preset)} className={classNames("rounded-full border px-3 py-1.5 text-sm", stylePreset === preset ? "border-amber-300 bg-amber-300/10 text-amber-100" : "border-zinc-800 text-zinc-300 hover:border-zinc-600")}>
                    {preset}
                  </button>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button type="button" onClick={generateCharacterCandidate} disabled={loading} className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50">
                  Generate
                </button>
                <button type="button" onClick={() => void useSelectedCandidate()} disabled={!selectedCandidate || loading} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-100 disabled:opacity-40">
                  Use This Character
                </button>
                {characterAnatomyMode === "freeform" && characterInputMode === "create" ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100">Freeform Shape</span>
                    {(["portrait", "landscape"] as CharacterCreateOrientation[]).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setFreeformCreateOrientation(option)}
                        disabled={loading}
                        className={classNames(
                          "rounded-lg border px-3 py-1.5 text-xs font-black capitalize transition disabled:opacity-40",
                          freeformCreateOrientation === option
                            ? "border-cyan-200 bg-cyan-200 text-zinc-950"
                            : "border-cyan-300/30 text-cyan-100 hover:border-cyan-200",
                        )}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <ImageChooser candidates={candidates} selectedId={selectedCandidateId} onSelect={setSelectedCandidateId} onDelete={(id) => setCandidates((items) => items.filter((item) => item.id !== id))} onSaveForLater={(candidate) => void saveCandidateForLaterV36BPS2(candidate)} saveForLaterStatusById={savedForLaterCandidateIdsV36BPS3} saveForLaterProgressById={saveForLaterProgressByIdV36BPS6B} />
            </Panel>
          ) : null}

          {step === "upload" ? (
            <Panel title="Upload Character Image">
              {characterAnatomyMode === "freeform" ? (
                <div className="mb-4 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
                  {FREEFORM_FULL_BODY_NOTICE}
                </div>
              ) : null}
              <input type="file" accept="image/*" onChange={(event) => void uploadCharacterImage(event.target.files?.[0] || null)} className="block w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-300" />
              {uploadedImage ? <img src={otgDisplayImageUrlV36BP6(uploadedImage.url)} alt="Uploaded character" className="mt-4 max-h-[520px] rounded-xl border border-zinc-800 object-contain" /> : null}
              {uploadedImage ? (
                <div className="mt-5 space-y-3">
                  <p className="text-sm font-medium text-zinc-200">Source framing</p>
                  {[
                    ["full_body", characterAnatomyMode === "freeform" ? "Full body / full form" : "Full body"],
                    ["half_body", "Half body / partial body"],
                    ["face", "Face only"],
                  ].map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 text-sm text-zinc-300">
                      <input type="radio" checked={sourceFraming === value} onChange={() => updateSourceFraming(value as SourceFraming)} />
                      {label}
                    </label>
                  ))}
                  {sourceFraming === "full_body" ? (
                    <button type="button" onClick={() => void continueUploadedImage()} disabled={loading} className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50">
                      {loading ? "Preparing..." : "Create Character Card"}
                    </button>
                  ) : (
                    <div className="space-y-4">
                      <label className="block text-sm font-medium text-zinc-200">
                        {characterAnatomyMode === "freeform" ? "Describe the complete body or full form." : "Describe the missing full body."}
                      </label>
                      <textarea
                        value={fullBodyPrompt}
                        onChange={(event) => {
                          setFullBodyPrompt(event.target.value);
                          setMissingGuidance(event.target.value);
                        }}
                        rows={3}
                        required
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-100"
                        placeholder={
                          characterAnatomyMode === "freeform"
                            ? "Example: full lion body standing on all four legs, thick mane, long tail, paws visible.\nExample: full talking tree with leafy crown, branch arms, trunk body, stump base touching the ground.\nExample: full mermaid body with tail and fins visible from head to tail tip."
                            : "Example: athletic humanoid body, black tactical jacket, dark pants, boots, standing front-facing."
                        }
                      />
                      <div className="flex flex-wrap gap-3">
                        <button type="button" onClick={() => void completePartialImage()} disabled={loading || !uploadedImage || !fullBodyPrompt.trim()} className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50">
                          {loading ? "Generating..." : "Generate Full-Body Character"}
                        </button>
                        <button type="button" onClick={() => void useSelectedCandidate()} disabled={!selectedCandidate || loading} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-100 disabled:opacity-40">
                          Use This Character
                        </button>
                      </div>
                      {fullBodyStatus === "generated" ? (
                        <p className="text-sm text-emerald-200">Generated full-body/full-form candidate ready. Select the candidate and approve it to continue.</p>
                      ) : (
                        <p className="text-sm text-amber-200">Generate and approve a full-body/full-form character before Character Card or Angles.</p>
                      )}
                      <p className="text-sm text-zinc-400">{FULL_BODY_REQUIRED_MESSAGE}</p>
                      <ImageChooser candidates={candidates} selectedId={selectedCandidateId} onSelect={setSelectedCandidateId} onDelete={(id) => setCandidates((items) => items.filter((item) => item.id !== id))} onSaveForLater={(candidate) => void saveCandidateForLaterV36BPS2(candidate)} saveForLaterStatusById={savedForLaterCandidateIdsV36BPS3} saveForLaterProgressById={saveForLaterProgressByIdV36BPS6B} />
                    </div>
                  )}
                </div>
              ) : null}
            </Panel>
          ) : null}

          {step === "card" ? (
            <Panel title="Character Card">
              <p className="text-sm text-zinc-400">Create consistent face, front, back, left side, and right side reference views from the selected full-body character.</p>
              {selectedFullBody ? <img src={otgDisplayImageUrlV36BP6(selectedFullBody.url)} alt="Processed default character image" className="mt-4 max-h-[520px] rounded-xl border border-zinc-800 object-contain" /> : null}
              {characterAnatomyMode === "freeform" && selectedFullBody ? (
                <div className="mt-5 space-y-3 rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-4">
                  <p className="text-sm text-cyan-100">{FREEFORM_FULL_BODY_NOTICE}</p>
                  {backgroundRemovalStatus === "running" ? (
                    <p className="text-sm text-amber-200">Removing background from the approved Freeform source...</p>
                  ) : backgroundRemovalStatus === "done" ? (
                    <p className="text-sm text-emerald-200">Background removed. This transparent result is the official downstream source.</p>
                  ) : backgroundRemovalStatus === "warning" ? (
                    <div className="space-y-2">
                      <p className="text-sm text-amber-200">{backgroundRemovalWarning || "Background removal failed. The approved image is still selected; retry background removal before continuing if needed."}</p>
                      <button type="button" onClick={() => void retryFreeformBackgroundRemoval()} disabled={loading} className="rounded-xl border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-100 disabled:opacity-40">
                        Retry Background Removal
                      </button>
                    </div>
                  ) : null}
                  <label className="flex items-start gap-2 text-sm text-cyan-50">
                    <input
                      type="checkbox"
                      checked={freeformFullBodyConfirmed}
                      disabled={loading || fullBodyStatus !== "approved" || !selectedFullBody}
                      onChange={(event) => setFreeformFullBodyConfirmed(event.target.checked)}
                      className="mt-1"
                    />
                    <span>I confirm this image shows the complete body or full form of the character.</span>
                  </label>
                  {!freeformFullBodyConfirmed ? <p className="text-sm text-amber-200">{FREEFORM_FULL_BODY_CONFIRM_MESSAGE}</p> : null}
                </div>
              ) : null}
              <button type="button" onClick={createCharacterCard} disabled={loading || !selectedFullBody || Boolean(getFullBodyGateError())} className="mt-5 rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50">
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
                      src={otgDisplayImageUrlV36BP6(characterCard.url)}
                      alt="Character card"
                      className="h-auto w-full max-w-[860px] rounded-xl object-contain"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={createCharacterCard}
                      disabled={loading || !selectedFullBody || characterCardBackgroundRemovalStatusV36BPT6 === "running"}
                      className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/10 disabled:opacity-50"
                    >
                      Fix / Regenerate Character Card
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeCharacterCardBackgroundV36BPT6()}
                      disabled={loading || characterCardBackgroundRemovalStatusV36BPT6 === "running" || !characterCard?.serverPath}
                      className="rounded-xl border border-cyan-300 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50"
                    >
                      {characterCardBackgroundRemovalStatusV36BPT6 === "running" ? "Removing..." : "Remove Background"}
                    </button>
                    {previousCharacterCardBeforeBackgroundRemovalV36BPT6 ? (
                      <button
                        type="button"
                        onClick={undoCharacterCardBackgroundRemovalV36BPT6}
                        disabled={loading || characterCardBackgroundRemovalStatusV36BPT6 === "running"}
                        className="rounded-xl border border-zinc-600 px-4 py-2 text-sm font-semibold text-zinc-100 hover:border-amber-300 hover:text-amber-100 disabled:opacity-50"
                      >
                        Undo Remove Background
                      </button>
                    ) : null}
                    <a
                      href={otgDisplayImageUrlV36BP6(characterCard.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 hover:border-cyan-300 hover:text-cyan-100"
                    >
                      Open Full Size
                    </a>
                    <p className="max-w-xl text-xs text-zinc-500">
                      Reruns the character-card workflow from the selected full-body image using a new seed. Use Remove Background only after the card is created; Undo restores the previous card.
                    </p>
                  </div>
                  {characterCardBackgroundRemovalStatusV36BPT6 === "removed" ? (
                    <p className="text-xs text-emerald-200">Character card background removed. Undo is available until you regenerate or replace the card.</p>
                  ) : characterCardBackgroundRemovalStatusV36BPT6 === "error" ? (
                    <p className="text-xs text-amber-200">Character card background removal failed. The original card is still selected.</p>
                  ) : null}
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
                    <p className="text-xs text-zinc-500">Complete Description fills missing visible fields and builds the production continuity identity block.</p>
                  </div>
                  <button type="button" onClick={() => void describeClothingAccessories()} disabled={autoDescribeLoading || (!selectedFullBody?.serverPath && !characterCard?.serverPath && !uploadedImage?.serverPath)} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 disabled:opacity-50">
                    {autoDescribeLoading ? "Completing..." : "Complete Description"}
                  </button>
                </div>
                <TextArea label="" value={details.clothingAccessories} onChange={(value) => setDetail("clothingAccessories", value)} />
              </div>
              {characterIdentity.promptReadyDescription ? (
                <div className="mt-5 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-sky-100">Character Identity</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {characterIdentity.lockedAt ? `Locked ${characterIdentity.lockedAt}` : "Review this production-ready continuity description, then lock it before saving."}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {characterIdentity.lockedAt ? (
                        <button type="button" onClick={unlockCharacterDescription} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100">
                          Edit Description
                        </button>
                      ) : (
                        <button type="button" onClick={lockCharacterDescription} className="rounded-lg border border-sky-300 px-3 py-1.5 text-xs font-semibold text-sky-100">
                          Lock Description
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-zinc-200">{characterIdentity.promptReadyDescription}</p>
                  {characterIdentity.doNotChange.length ? (
                    <p className="mt-3 text-xs text-zinc-500">Scene notes: {characterIdentity.doNotChange.join(", ")}</p>
                  ) : null}
                </div>
              ) : null}
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
                      {(["qwen3tts", "cosyvoice", "ltxvoice", "unnaturalvoices"] as VoiceDesignModelId[]).map((model) => (
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
                          <span className="mt-2 block text-xs leading-5 text-zinc-400">{voiceModels[model].description}</span>
                        </button>
                      ))}
                    </div>
                    {voiceDesignProfile.model !== "unnaturalvoices" ? (
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
                    ) : null}
                  </div>

                  {voiceDesignProfile.model !== "unnaturalvoices" ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="text-sm font-semibold text-zinc-100">Character / Voice Profile</p>
                    <div className="mt-4 grid gap-4">
                      <SelectField label="Speaker identity" value={voiceDesignProfile.speakerIdentity} options={SPEAKER_IDENTITIES} onChange={(value) => setVoiceDesignField("speakerIdentity", value as VoiceDesignProfile["speakerIdentity"])} />
                      <SelectField label="Voice age range" value={voiceDesignProfile.ageRange} options={VOICE_AGE_RANGES} onChange={(value) => setVoiceDesignField("ageRange", value as VoiceDesignProfile["ageRange"])} />
                      <SelectField label="Gender / presentation" value={voiceDesignProfile.genderPresentation} options={VOICE_GENDER_PRESENTATIONS} onChange={(value) => setVoiceDesignField("genderPresentation", value as VoiceDesignProfile["genderPresentation"])} />
                      <div className="rounded-lg border border-zinc-800 bg-black/20 px-3 py-2 text-sm text-zinc-300">
                        <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Language</span>
                        English fixed
                      </div>
                    </div>
                  </div>
                  ) : null}
                </div>

                <div className="space-y-5">
                  {voiceDesignProfile.model === "unnaturalvoices" ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="text-sm font-semibold text-zinc-100">Unnatural Voices</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      OTG_UNNATURAL_VOICES_P1 / OTG_UNNATURAL_VOICES_P2: fixed creature, fantasy, robot, animal, alien, and elemental presets generate through the audio-only LTX worker.
                    </p>
                    <div className="mt-4 grid gap-4">
                      <label className="block text-sm text-zinc-300">
                        <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Category</span>
                        <select
                          value={unnaturalVoiceCategory}
                          onChange={(event) => selectUnnaturalVoiceCategory(event.target.value as UnnaturalVoiceCategory)}
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-300"
                        >
                          {UNNATURAL_VOICE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                        </select>
                      </label>
                      <label className="block text-sm text-zinc-300">
                        <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Preset</span>
                        <select
                          value={selectedUnnaturalVoicePreset.id}
                          onChange={(event) => selectUnnaturalVoicePreset(event.target.value)}
                          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-300"
                        >
                          {unnaturalVoicePresetsForCategory.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                        </select>
                      </label>
                      <div className="rounded-lg border border-zinc-800 bg-black/20 p-3 text-xs leading-5 text-zinc-300">
                        <div className="font-semibold text-zinc-100">{selectedUnnaturalVoicePreset.index}. {selectedUnnaturalVoicePreset.name}</div>
                        <div className="mt-1 text-zinc-500">{selectedUnnaturalVoicePreset.category}</div>
                      </div>
                    </div>
                  </div>
                  ) : (
                  <>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="text-sm font-semibold text-zinc-100">{voiceDesignProfile.model === "ltxvoice" ? "Accent / dialect" : "Voice traits"}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {voiceDesignProfile.model === "ltxvoice"
                        ? "Choose the LTX spoken dialect/stylized audition line. Video is hidden; later patches return only audio from the workflow."
                        : "Qwen3-TTS and CosyVoice are fixed to English in Character Builder. Accent and language pickers are hidden for these providers."}
                    </p>
                    {voiceDesignProfile.model === "ltxvoice" ? (
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
                    ) : null}
                    {voiceDesignProfile.model === "ltxvoice" && voiceDesignAccent ? (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full border border-zinc-700 px-2 py-1 text-zinc-300">
                          LTX dialect
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
                      <TextField label="Role / archetype" value={voiceDesignProfile.useCaseContext} onChange={(value) => setVoiceDesignField("useCaseContext", value)} />
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
                  </>
                  )}
                </div>

                <div className="space-y-5">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <p className="text-sm font-semibold text-zinc-100">Prompt preview / generated model instruction</p>
                    {voiceDesignProfile.model === "unnaturalvoices" ? (
                      <div className="mt-3 space-y-4">
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Sample line</p>
                          <p className="mt-2 rounded-lg border border-zinc-800 bg-black/20 p-3 text-sm text-zinc-200">{selectedUnnaturalVoicePreset.sampleLine}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Prompt preview</p>
                          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-black/40 p-3 text-xs leading-5 text-zinc-300">
                            {selectedUnnaturalVoicePreset.prompt}
                          </pre>
                        </div>
                      </div>
                    ) : (
                      <>
                        <TextArea label="Sample phrase" value={voiceDesignProfile.sampleText} onChange={(value) => setVoiceDesignField("sampleText", value)} />
                        {voiceDesignProfile.model === "ltxvoice" ? (
                          <p className="mt-2 text-xs text-zinc-500">Defaults to the selected dialect's test line. You can edit it.</p>
                        ) : null}
                      </>
                    )}
                    {voiceDesignProfile.model !== "unnaturalvoices" ? (
                    <>
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
                    </>
                    ) : null}
                    {qwenWarnings.length ? (
                      <div className="mt-3 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-100">
                        {qwenWarnings.map((warning) => <div key={warning}>{warning}</div>)}
                      </div>
                    ) : null}
                    <div className="mt-6 grid gap-3 md:grid-cols-2">
                      <button
                        type="button"
                        onClick={voiceDesignProfile.model === "unnaturalvoices" ? () => void queueCharacterVoicePipelineAction("create_voice_sample") : generateQwenVoiceDesignCandidates}
                        disabled={voiceDesignProfile.model === "unnaturalvoices" && createVoiceBusy}
                        className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50"
                      >
                        {voiceDesignProfile.model === "unnaturalvoices" ? "Generate Voice" : "Generate Voice Options"}
                      </button>
                      {voiceDesignProfile.model !== "unnaturalvoices" ? (
                      <button type="button" onClick={saveReusableVoiceProfile} className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 hover:border-zinc-500">
                        Save reusable voice profile
                      </button>
                      ) : null}
                    </div>
                  </div>

                  {voiceDesignProfile.model !== "unnaturalvoices" ? (
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
                  ) : null}

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
                    <audio controls preload="metadata" src={otgDisplayImageUrlV36BP6(rawVoicePreviewUrl || builderCharacterVoiceProfile?.baseSampleUrl)} className="mt-3 w-full" />
                  ) : null}
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">Simple FX</p>
                      <p className="mt-1 text-xs text-zinc-500">Fast controls only: pitch and echo. Use Advanced FX for robotic, alien, distortion, SoX, or Pedalboard chains.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void applyVoiceFxPageSimpleEffects()}
                        disabled={voiceEffectProcessing?.jobId === getVoiceFxPageJobId()}
                        className="rounded-xl border border-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-100 disabled:opacity-40"
                      >
                        {voiceEffectProcessing?.jobId === getVoiceFxPageJobId() ? "Applying..." : "Apply Simple FX"}
                      </button>
                      <button type="button" onClick={resetVoiceFxPageChain} className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-500">
                        Reset to Base
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="block text-sm text-zinc-300">
                      <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Pitch</span>
                      <select
                        value={simplePitchEffectId}
                        onChange={(event) => setSimplePitchEffectId(event.target.value)}
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                      >
                        {simplePitchOptions.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-sm text-zinc-300">
                      <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Echo</span>
                      <select
                        value={simpleEchoEffectId}
                        onChange={(event) => setSimpleEchoEffectId(event.target.value)}
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                      >
                        {simpleEchoOptions.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {voiceEffectWorkingByJob[getVoiceFxPageJobId()]?.audioUrl ? (
                    <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100">Current Working Voice</p>
                      <p className="mt-1 text-xs text-emerald-100/70">New effects will stack on this version until you reset to base.</p>
                      <audio controls preload="metadata" src={otgDisplayImageUrlV36BP6(voiceEffectWorkingByJob[getVoiceFxPageJobId()].audioUrl)} className="mt-2 w-full" />
                    </div>
                  ) : null}

                  {voiceEffectMessage ? (
                    <p className="mt-3 text-xs text-violet-200">{voiceEffectMessage}</p>
                  ) : null}
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <button type="button" onClick={() => setVoiceFxAdvancedOpen((current) => !current)} className="flex w-full items-center justify-between gap-3 text-left">
                    <span>
                      <span className="block text-sm font-semibold text-zinc-100">Advanced FX</span>
                      <span className="mt-1 block text-xs text-zinc-500">FFmpeg, Pedalboard, and SoX are active. Presets are locked unless manual controls are unlocked. OTG_VOICE_EFFECTS_P3D_FINAL_POLISH</span>
                    </span>
                    <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300">{voiceFxAdvancedOpen ? "Hide" : "Show"}</span>
                  </button>

                  {voiceFxAdvancedOpen ? (
                    <div className="mt-4 space-y-4">
                      <div className="grid gap-4 xl:grid-cols-3">
                        <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-4">
                          <p className="text-sm font-semibold text-cyan-100">FFmpeg</p>
                          <p className="mt-1 text-xs text-zinc-400">Active engine for robotic, distortion, buzz, wah-wah, radio, alien, monster, chipmunk, echo, chorus, tremolo, vibrato, and bitcrush/glitchy voices.</p>

                          <label className="mt-3 block text-sm text-zinc-300">
                            <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Preset / Voice</span>
                            <select
                              value={ffmpegAdvancedPresetId}
                              onChange={(event) => setFfmpegAdvancedPresetId(event.target.value)}
                              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                            >
                              {ffmpegAdvancedVoiceOptions.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </select>
                          </label>

                          <label className="mt-3 flex items-center gap-2 text-xs text-zinc-300">
                            <input
                              type="checkbox"
                              checked={ffmpegControlsUnlocked}
                              onChange={(event) => setFfmpegControlsUnlocked(event.target.checked)}
                            />
                            Unlock manual controls
                          </label>

                          <div className="mt-3 rounded-xl border border-cyan-400/20 bg-black/20 p-3 text-xs leading-5 text-zinc-400">
                            {ffmpegAdvancedVoiceOptions.find((option) => option.id === ffmpegAdvancedPresetId)?.description || "FFmpeg preset"}
                            <div className="mt-1">
                              Controls shown: pitch, grit, echo, tremolo, vibrato, chorus, highpass, lowpass, compression.
                              {ffmpegControlsUnlocked ? " Manual editing comes in Patch 3C." : " Preset controls are locked."}
                            </div>
                          </div>

                                                    {ffmpegControlsUnlocked ? (
                            <div className="mt-3 rounded-xl border border-cyan-400/20 bg-black/20 p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100">Manual FFmpeg Controls</p>{/* OTG_VOICE_EFFECTS_3C_FFMPEG_MANUAL_UI */}
                              <p className="mt-1 text-xs text-zinc-400">These values override the locked FFmpeg preset for this effect only.</p>

                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <label className="block text-xs text-zinc-300">
                                  Pitch: {ffmpegManualControls.pitchSemitones} semitones
                                  <input type="range" min={-12} max={12} step={1} value={ffmpegManualControls.pitchSemitones} onChange={(event) => setFfmpegManualControl("pitchSemitones", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>

                                <label className="block text-xs text-zinc-300">
                                  Grit / Distortion: {ffmpegManualControls.grit}%
                                  <input type="range" min={0} max={100} step={1} value={ffmpegManualControls.grit} onChange={(event) => setFfmpegManualControl("grit", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>

                                <label className="block text-xs text-zinc-300">
                                  Echo Delay: {ffmpegManualControls.echoDelayMs} ms
                                  <input type="range" min={0} max={900} step={10} value={ffmpegManualControls.echoDelayMs} onChange={(event) => setFfmpegManualControl("echoDelayMs", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>

                                <label className="block text-xs text-zinc-300">
                                  Echo Decay: {ffmpegManualControls.echoDecay.toFixed(2)}
                                  <input type="range" min={0} max={0.9} step={0.05} value={ffmpegManualControls.echoDecay} onChange={(event) => setFfmpegManualControl("echoDecay", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>

                                <label className="block text-xs text-zinc-300">
                                  Tremolo Rate: {ffmpegManualControls.tremoloRate}
                                  <input type="range" min={0} max={40} step={1} value={ffmpegManualControls.tremoloRate} onChange={(event) => setFfmpegManualControl("tremoloRate", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>

                                <label className="block text-xs text-zinc-300">
                                  Tremolo Depth: {ffmpegManualControls.tremoloDepth.toFixed(2)}
                                  <input type="range" min={0} max={1} step={0.05} value={ffmpegManualControls.tremoloDepth} onChange={(event) => setFfmpegManualControl("tremoloDepth", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>

                                <label className="block text-xs text-zinc-300">
                                  Vibrato Rate: {ffmpegManualControls.vibratoRate}
                                  <input type="range" min={0} max={15} step={0.5} value={ffmpegManualControls.vibratoRate} onChange={(event) => setFfmpegManualControl("vibratoRate", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>

                                <label className="block text-xs text-zinc-300">
                                  Vibrato Depth: {ffmpegManualControls.vibratoDepth.toFixed(2)}
                                  <input type="range" min={0} max={1} step={0.05} value={ffmpegManualControls.vibratoDepth} onChange={(event) => setFfmpegManualControl("vibratoDepth", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>

                                <label className="block text-xs text-zinc-300">
                                  Chorus Mix: {ffmpegManualControls.chorusMix.toFixed(2)}
                                  <input type="range" min={0} max={1} step={0.05} value={ffmpegManualControls.chorusMix} onChange={(event) => setFfmpegManualControl("chorusMix", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>

                                <label className="block text-xs text-zinc-300">
                                  Highpass: {ffmpegManualControls.highpassHz} Hz
                                  <input type="range" min={20} max={1200} step={10} value={ffmpegManualControls.highpassHz} onChange={(event) => setFfmpegManualControl("highpassHz", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>

                                <label className="block text-xs text-zinc-300">
                                  Lowpass: {ffmpegManualControls.lowpassHz} Hz
                                  <input type="range" min={1200} max={20000} step={100} value={ffmpegManualControls.lowpassHz} onChange={(event) => setFfmpegManualControl("lowpassHz", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>

                                <label className="block text-xs text-zinc-300">
                                  Compression: {ffmpegManualControls.compression}%
                                  <input type="range" min={0} max={100} step={1} value={ffmpegManualControls.compression} onChange={(event) => setFfmpegManualControl("compression", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>

                                <label className="block text-xs text-zinc-300">
                                  Gain: {ffmpegManualControls.gainDb} dB
                                  <input type="range" min={-12} max={12} step={1} value={ffmpegManualControls.gainDb} onChange={(event) => setFfmpegManualControl("gainDb", Number(event.target.value))} className="mt-1 w-full accent-cyan-300" />
                                </label>
                              </div>

                              <button
                                type="button"
                                onClick={() => setFfmpegManualControls({
                                  pitchSemitones: 0,
                                  grit: 0,
                                  echoDelayMs: 0,
                                  echoDecay: 0,
                                  tremoloRate: 0,
                                  tremoloDepth: 0,
                                  vibratoRate: 0,
                                  vibratoDepth: 0,
                                  chorusMix: 0,
                                  highpassHz: 80,
                                  lowpassHz: 12000,
                                  compression: 30,
                                  gainDb: 0,
                                })}
                                className="mt-3 rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-500"
                              >
                                Reset Manual Controls
                              </button>
                            </div>
                          ) : null}
<button
                            type="button"
                            onClick={() => void applyVoiceFxPageEffect({
                              effectId: ffmpegAdvancedPresetId,
                              intensity: voiceEffectIntensity,
                              label: `FFmpeg: ${ffmpegAdvancedVoiceOptions.find((option) => option.id === ffmpegAdvancedPresetId)?.label || ffmpegAdvancedPresetId}`,
                              controls: ffmpegControlsUnlocked ? ffmpegManualControls : undefined,
                            })}
                            disabled={voiceEffectProcessing?.jobId === getVoiceFxPageJobId()}
                            className="mt-3 rounded-xl border border-cyan-400 px-3 py-1.5 text-xs font-semibold text-cyan-100 disabled:opacity-40"
                          >
                            {voiceEffectProcessing?.jobId === getVoiceFxPageJobId() ? "Applying..." : "Add FFmpeg Effect"}
                          </button>
                        </div>

                        <div className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-400/5 p-4">
                          <p className="text-sm font-semibold text-fuchsia-100">Spotify Pedalboard</p>
                          <p className="mt-1 text-xs text-zinc-400">Studio-style effects: distortion, phaser, chorus, delay, reverb, pitch-shifting, plugin chain, and future VST3 presets.</p>

                          <label className="mt-3 block text-sm text-zinc-300">
                            <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Preset / Voice</span>
                            <select
                              value={pedalboardPresetId}
                              onChange={(event) => setPedalboardPresetId(event.target.value)}
                              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                            >
                              {pedalboardAdvancedOptions.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </select>
                          </label>

                          <label className="mt-3 flex items-center gap-2 text-xs text-zinc-300">
                            <input
                              type="checkbox"
                              checked={pedalboardControlsUnlocked}
                              onChange={(event) => setPedalboardControlsUnlocked(event.target.checked)}
                            />
                            Unlock manual controls
                          </label>

                          <div className="mt-3 rounded-xl border border-fuchsia-400/20 bg-black/20 p-3 text-xs leading-5 text-zinc-400">
                            {pedalboardAdvancedOptions.find((option) => option.id === pedalboardPresetId)?.description || "Pedalboard preset"}
                            <div className="mt-1">
                              Controls shown: drive, mix, delay, feedback, reverb room size, phaser rate, chorus depth, pitch shift.
                              {pedalboardControlsUnlocked ? " Manual editing comes in Patch 3C." : " Preset controls are locked."}
                            </div>
                          </div>

                          {/* OTG_VOICE_EFFECTS_BACKEND_P3B_UI */}
                                                    {pedalboardControlsUnlocked ? (
                            <div className="mt-3 rounded-xl border border-fuchsia-400/20 bg-black/20 p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-100">Pedalboard Manual Controls</p>{/* OTG_VOICE_EFFECTS_3C2_PEDALBOARD_MANUAL_UI */}
                              <p className="mt-1 text-xs text-zinc-400">These values override the locked Pedalboard preset for this effect only.</p>

                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <label className="block text-xs text-zinc-300">Drive: {pedalboardManualControls.driveDb} dB<input type="range" min={0} max={40} step={1} value={pedalboardManualControls.driveDb} onChange={(event) => setPedalboardManualControl("driveDb", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Pitch: {pedalboardManualControls.pitchSemitones} semitones<input type="range" min={-12} max={12} step={1} value={pedalboardManualControls.pitchSemitones} onChange={(event) => setPedalboardManualControl("pitchSemitones", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Phaser Rate: {pedalboardManualControls.phaserRate}<input type="range" min={0} max={5} step={0.1} value={pedalboardManualControls.phaserRate} onChange={(event) => setPedalboardManualControl("phaserRate", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Phaser Depth: {pedalboardManualControls.phaserDepth.toFixed(2)}<input type="range" min={0} max={1} step={0.05} value={pedalboardManualControls.phaserDepth} onChange={(event) => setPedalboardManualControl("phaserDepth", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Chorus Rate: {pedalboardManualControls.chorusRate}<input type="range" min={0} max={8} step={0.1} value={pedalboardManualControls.chorusRate} onChange={(event) => setPedalboardManualControl("chorusRate", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Chorus Depth: {pedalboardManualControls.chorusDepth.toFixed(2)}<input type="range" min={0} max={1} step={0.05} value={pedalboardManualControls.chorusDepth} onChange={(event) => setPedalboardManualControl("chorusDepth", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Delay: {pedalboardManualControls.delayMs} ms<input type="range" min={0} max={900} step={10} value={pedalboardManualControls.delayMs} onChange={(event) => setPedalboardManualControl("delayMs", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Delay Feedback: {pedalboardManualControls.delayFeedback.toFixed(2)}<input type="range" min={0} max={0.95} step={0.05} value={pedalboardManualControls.delayFeedback} onChange={(event) => setPedalboardManualControl("delayFeedback", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Delay Mix: {pedalboardManualControls.delayMix.toFixed(2)}<input type="range" min={0} max={1} step={0.05} value={pedalboardManualControls.delayMix} onChange={(event) => setPedalboardManualControl("delayMix", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Reverb Room: {pedalboardManualControls.reverbRoomSize.toFixed(2)}<input type="range" min={0} max={1} step={0.05} value={pedalboardManualControls.reverbRoomSize} onChange={(event) => setPedalboardManualControl("reverbRoomSize", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Reverb Wet: {pedalboardManualControls.reverbWet.toFixed(2)}<input type="range" min={0} max={1} step={0.05} value={pedalboardManualControls.reverbWet} onChange={(event) => setPedalboardManualControl("reverbWet", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                                <label className="block text-xs text-zinc-300">Compression: {pedalboardManualControls.compression}%<input type="range" min={0} max={100} step={1} value={pedalboardManualControls.compression} onChange={(event) => setPedalboardManualControl("compression", Number(event.target.value))} className="mt-1 w-full accent-fuchsia-300" /></label>
                              </div>
                              <button
                                type="button"
                                onClick={() => setPedalboardManualControls({
                                  driveDb: 0,
                                  phaserRate: 0,
                                  phaserDepth: 0,
                                  chorusRate: 0,
                                  chorusDepth: 0,
                                  delayMs: 0,
                                  delayFeedback: 0,
                                  delayMix: 0,
                                  reverbRoomSize: 0,
                                  reverbWet: 0,
                                  pitchSemitones: 0,
                                  highpassHz: 80,
                                  lowpassHz: 12000,
                                  compression: 30,
                                  gainDb: 0,
                                })}
                                className="mt-3 rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-500"
                              >
                                Reset Pedalboard Manual Controls
                              </button>
                              {/* OTG_VOICE_EFFECTS_P3D_PEDALBOARD_RESET */}
                            </div>
                          ) : null}
<button
                            type="button"
                            onClick={() => void applyVoiceFxPageEffect({
                              effectId: pedalboardPresetId,
                              intensity: voiceEffectIntensity,
                              label: `Pedalboard: ${pedalboardAdvancedOptions.find((option) => option.id === pedalboardPresetId)?.label || pedalboardPresetId}`,
                              controls: pedalboardControlsUnlocked ? pedalboardManualControls : undefined,
                            })}
                            disabled={voiceEffectProcessing?.jobId === getVoiceFxPageJobId()}
                            className="mt-3 rounded-xl border border-fuchsia-400 px-3 py-1.5 text-xs font-semibold text-fuchsia-100 disabled:opacity-40"
                          >
                            {voiceEffectProcessing?.jobId === getVoiceFxPageJobId() ? "Applying..." : "Add Pedalboard Effect"}
                          </button>
                        </div>

                        <div className="rounded-xl border border-orange-400/30 bg-orange-400/5 p-4">
                          <p className="text-sm font-semibold text-orange-100">SoX</p>
                          <p className="mt-1 text-xs text-zinc-400">Installed engine for synthwave, chip/chiptune, overdrive voice, echo filtering, and max conversion chains.</p>

                          <label className="mt-3 block text-sm text-zinc-300">
                            <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500">Preset / Voice</span>
                            <select
                              value={soxPresetId}
                              onChange={(event) => setSoxPresetId(event.target.value)}
                              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                            >
                              {soxAdvancedOptions.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                              ))}
                            </select>
                          </label>

                          <label className="mt-3 flex items-center gap-2 text-xs text-zinc-300">
                            <input
                              type="checkbox"
                              checked={soxControlsUnlocked}
                              onChange={(event) => setSoxControlsUnlocked(event.target.checked)}
                            />
                            Unlock manual controls
                          </label>

                          <div className="mt-3 rounded-xl border border-orange-400/20 bg-black/20 p-3 text-xs leading-5 text-zinc-400">
                            {soxAdvancedOptions.find((option) => option.id === soxPresetId)?.description || "SoX preset"}
                            <div className="mt-1">
                              Controls shown: synthwave, chip, overdrive, echo filtering, conversion chain.
                              {soxControlsUnlocked ? " Manual editing comes in Patch 3C." : " Preset controls are locked."}
                            </div>
                          </div>

                                                    {soxControlsUnlocked ? (
                            <div className="mt-3 rounded-xl border border-orange-400/20 bg-black/20 p-3">
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-100">SoX Manual Controls</p>{/* OTG_VOICE_EFFECTS_3C2_SOX_MANUAL_UI */}
                              <p className="mt-1 text-xs text-zinc-400">These values override the locked SoX preset for this effect only.</p>

                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <label className="block text-xs text-zinc-300">Pitch: {soxManualControls.pitchCents} cents<input type="range" min={-1200} max={1200} step={25} value={soxManualControls.pitchCents} onChange={(event) => setSoxManualControl("pitchCents", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Tempo: {soxManualControls.tempo.toFixed(2)}x<input type="range" min={0.5} max={2} step={0.05} value={soxManualControls.tempo} onChange={(event) => setSoxManualControl("tempo", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Overdrive Gain: {soxManualControls.overdriveGain}<input type="range" min={0} max={40} step={1} value={soxManualControls.overdriveGain} onChange={(event) => setSoxManualControl("overdriveGain", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Overdrive Colour: {soxManualControls.overdriveColour}<input type="range" min={0} max={100} step={1} value={soxManualControls.overdriveColour} onChange={(event) => setSoxManualControl("overdriveColour", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Echo Delay: {soxManualControls.echoDelayMs} ms<input type="range" min={0} max={900} step={10} value={soxManualControls.echoDelayMs} onChange={(event) => setSoxManualControl("echoDelayMs", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Echo Decay: {soxManualControls.echoDecay.toFixed(2)}<input type="range" min={0} max={0.9} step={0.05} value={soxManualControls.echoDecay} onChange={(event) => setSoxManualControl("echoDecay", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Highpass: {soxManualControls.highpassHz} Hz<input type="range" min={20} max={1200} step={10} value={soxManualControls.highpassHz} onChange={(event) => setSoxManualControl("highpassHz", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Lowpass: {soxManualControls.lowpassHz} Hz<input type="range" min={1200} max={20000} step={100} value={soxManualControls.lowpassHz} onChange={(event) => setSoxManualControl("lowpassHz", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Chorus Delay: {soxManualControls.chorusDelayMs} ms<input type="range" min={0} max={120} step={5} value={soxManualControls.chorusDelayMs} onChange={(event) => setSoxManualControl("chorusDelayMs", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Chorus Decay: {soxManualControls.chorusDecay.toFixed(2)}<input type="range" min={0} max={1} step={0.05} value={soxManualControls.chorusDecay} onChange={(event) => setSoxManualControl("chorusDecay", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Bass: {soxManualControls.bassDb} dB<input type="range" min={-12} max={12} step={1} value={soxManualControls.bassDb} onChange={(event) => setSoxManualControl("bassDb", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                                <label className="block text-xs text-zinc-300">Treble: {soxManualControls.trebleDb} dB<input type="range" min={-12} max={12} step={1} value={soxManualControls.trebleDb} onChange={(event) => setSoxManualControl("trebleDb", Number(event.target.value))} className="mt-1 w-full accent-orange-300" /></label>
                              </div>

                              <label className="mt-3 flex items-center gap-2 text-xs text-orange-100/80">
                                <input type="checkbox" checked={soxManualControls.normalize} onChange={(event) => setSoxManualControl("normalize", event.target.checked)} />
                                Normalize output
                              </label>
                              <button
                                type="button"
                                onClick={() => setSoxManualControls({
                                  pitchCents: 0,
                                  tempo: 1,
                                  overdriveGain: 0,
                                  overdriveColour: 20,
                                  echoDelayMs: 0,
                                  echoDecay: 0,
                                  highpassHz: 80,
                                  lowpassHz: 12000,
                                  chorusDelayMs: 0,
                                  chorusDecay: 0,
                                  bassDb: 0,
                                  trebleDb: 0,
                                  gainDb: 0,
                                  normalize: true,
                                })}
                                className="mt-3 rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-500"
                              >
                                Reset SoX Manual Controls
                              </button>
                              {/* OTG_VOICE_EFFECTS_P3D_SOX_RESET */}
                            </div>
                          ) : null}
<button
                            type="button"
                            onClick={() => void applyVoiceFxPageEffect({
                              effectId: soxPresetId,
                              intensity: voiceEffectIntensity,
                              label: `SoX: ${soxAdvancedOptions.find((option) => option.id === soxPresetId)?.label || soxPresetId}`,
                              controls: soxControlsUnlocked ? soxManualControls : undefined,
                            })}
                            disabled={voiceEffectProcessing?.jobId === getVoiceFxPageJobId()}
                            className="mt-3 rounded-xl border border-orange-400 px-3 py-1.5 text-xs font-semibold text-orange-100 disabled:opacity-40"
                          >
                            {voiceEffectProcessing?.jobId === getVoiceFxPageJobId() ? "Applying..." : "Add SoX Effect"}
                          </button>
                        </div>
                      </div>

                      {voiceEffectChainByJob[getVoiceFxPageJobId()]?.length ? (
                        <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-4">
                          <p className="text-sm font-semibold text-emerald-100">Applied Effect Chain</p>
                          {voiceEffectChainByJob[getVoiceFxPageJobId()].length >= 3 ? (
                            <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-100">
                              OTG_VOICE_EFFECTS_3C_STACK_WARNING: This chain has 3 or more effects. Stacking too many effects can make the voice noisy, clipped, or unusable. Reset to base if quality drops.
                            </p>
                          ) : null}
                          <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs text-emerald-100/80">
                            {voiceEffectChainByJob[getVoiceFxPageJobId()].map((item, index) => (
                              <li key={`${item.audioUrl}-${index}`}>
                                {item.label} / {item.engine}
                              </li>
                            ))}
                          </ol>

                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" onClick={resetVoiceFxPageChain} className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-500">
                              Reset to Base Voice
                            </button>
                            <button type="button" onClick={useVoiceFxPageCurrentVersionForTraining} className="rounded-xl border border-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-400/10">
                              Use This Version
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-zinc-500">Advanced FX is collapsed by default so the page stays focused on simple pitch and echo.</p>
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
                        advanceToVoiceLabPage("training", {
                          skipValidation: true,
                          message: selectedIndexVoiceReference?.source === "tuned_voice_fx"
                            ? "Tuned voice selected. Prepare training data next."
                            : "Selected voice ready. Prepare training data next.",
                        });
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
                        {approvedSourceJobId ? <div className="break-all">Source job {approvedSourceJobId}</div> : null}
                        {builderCharacterVoiceProfile?.tunedFxPreset && lockedTrainingVoiceType === "tuned" ? (
                          <div>FX preset {builderCharacterVoiceProfile.tunedFxPreset}</div>
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
                          <audio key={trainingDatasetPreviewUrl} controls className="mt-2 w-full" src={otgDisplayImageUrlV36BP6(trainingDatasetPreviewUrl)} />
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
                  {fullBodyDownstreamGateMessage ? (
                    <p className="mt-2 text-sm text-amber-200">{fullBodyDownstreamGateMessage}</p>
                  ) : !trainedVoiceReady ? (
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
                        src={otgDisplayImageUrlV36BP6(characterPreviewDubSelection.videoSrc)}
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
                          src={otgDisplayImageUrlV36BP6(characterModelSpinVideoSrc)}
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
                        : voiceDesignProfile.model === "unnaturalvoices"
                          ? "Generate Voice"
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
                        <div>Provider : {builderCharacterVoiceProfile.provider || voiceProvider}</div>
                        {builderCharacterVoiceProfile.sourceJobId ? <div className="break-all">Source job {builderCharacterVoiceProfile.sourceJobId}</div> : null}
                        <div className="break-all">Base sample URL {builderCharacterVoiceProfile.baseSampleUrl}</div>
                        <audio controls preload="metadata" src={otgDisplayImageUrlV36BP6(builderCharacterVoiceProfile.baseSampleUrl)} className="mt-3 w-full" />
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
                  disabled={Boolean(fullBodyDownstreamGateMessage) || (!voicePackCreated && !builderCharacterVoiceProfile?.baseSampleUrl)}
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
                {selectedFullBody ? <img src={otgDisplayImageUrlV36BP6(selectedFullBody.url)} alt="Processed default character image" className="rounded-xl border border-zinc-800" /> : null}
                {characterCard ? (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
                    <img src={otgDisplayImageUrlV36BP6(characterCard.url)} alt="Final character card" className="h-auto w-full rounded-xl object-contain" />
                  </div>
                ) : null}
              </div>
              <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-sm font-medium text-zinc-200">LTX Global Prompt Identity Block</p>
                <p className="mt-2 text-sm text-zinc-400">{identityBlock}</p>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button type="button" onClick={saveCharacter} disabled={saving} className="rounded-xl bg-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50">
                  {saving ? "Saving..." : "Complete Character"}
                </button>
              </div>
              {fullBodyDownstreamGateMessage ? <p className="mt-3 text-sm text-amber-200">{fullBodyDownstreamGateMessage}</p> : null}
            </Panel>
          ) : null}
        </div>

                        <section
          className="rounded-2xl border border-cyan-400/20 bg-zinc-950/85 p-4 shadow-lg shadow-cyan-950/20 lg:col-span-2"
          data-otg="OTG_CHARACTER_BACKGROUND_STUDIO_V36A"
        >
          <button
            type="button"
            onClick={() => setCharacterBackgroundStudioOpen(true)} style={["source", "generate", "upload"].includes(step) ? undefined : { display: "none" }}
            className="group flex w-full flex-col gap-3 rounded-2xl border border-cyan-300/25 bg-gradient-to-br from-zinc-950 via-slate-950 to-cyan-950/40 p-5 text-left transition hover:border-cyan-300/60 hover:bg-cyan-950/30"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200">Background Library</p>
                <h3 className="mt-2 text-2xl font-black text-zinc-50">Background Studio</h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
                  Create or upload reusable background cards. The preview image starts the Background Studio flow; 360 panorama and angle plates come next.
                </p>
              </div>
              <div className="rounded-full border border-cyan-300/30 bg-cyan-950/40 px-3 py-1 text-xs font-black text-cyan-100">
                {characterBackgroundRefs.length} saved backgrounds
              </div>
            </div>
            <div className="mt-2 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm font-bold text-zinc-100 group-hover:text-cyan-100">
              Open Background Studio
            </div>
          </button>

          {characterBackgroundStudioOpen && ["source", "generate", "upload"].includes(step) ? (
            <div className="fixed inset-0 z-[9999] overflow-y-auto bg-[#05070d] p-2 text-zinc-50 md:p-3">
              <div className="mx-auto max-w-5xl pb-24">
                  {expandedCharacterBackgroundCandidateId ? (() => {
                    const candidate = characterBackgroundPreviewCandidates.find((item) => item.id === expandedCharacterBackgroundCandidateId);
                    if (!candidate) return null;

                    return (
                      <div
                        className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 p-4"
                        data-otg="OTG_BACKGROUND_PREVIEW_EXPAND_MODAL_V36J"
                      >
                        <div className="w-full max-w-7xl rounded-2xl border border-violet-300/30 bg-zinc-950 p-4 shadow-2xl shadow-black">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-200">Preview Image</p>
                              <h3 className="mt-1 text-lg font-black text-zinc-50">{candidate.name}</h3>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleCharacterBackgroundUseImageV36AF(candidate)}
                                className="rounded-xl border border-emerald-300/40 bg-emerald-500/15 px-4 py-2 text-sm font-black text-emerald-50 transition hover:bg-emerald-500/25"
                              >
                                Use This Photo
                              </button>                              <button
                                type="button"
                                onClick={() => void removePeopleFromCharacterBackgroundCandidateV36S(candidate)}
                                disabled={characterBackgroundBusy}
                                data-otg="OTG_BACKGROUND_REMOVE_PEOPLE_BUTTON_V36T"
                                className="rounded-xl border border-amber-300/40 bg-amber-500/15 px-4 py-2 text-sm font-black text-amber-50 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-400"
                              >
                                Remove People
                              </button>                              <a
                                href={backgroundPreviewNativeComfySrcV36V(candidate) || backgroundPreviewProxySrcV36V(candidate)}
                                target="_blank"
                                rel="noreferrer"
                                data-otg="OTG_BACKGROUND_OPEN_NATIVE_COMFY_IMAGE_V36V"
                                className="rounded-xl border border-cyan-300/40 bg-cyan-500/15 px-4 py-2 text-sm font-black text-cyan-50 transition hover:bg-cyan-500/25"
                              >
                                Open Native Comfy Image
                              </a>
                              <a
                                href={backgroundPreviewProxySrcV36V(candidate)}
                                target="_blank"
                                rel="noreferrer"
                                data-otg="OTG_BACKGROUND_OPEN_APP_PROXY_IMAGE_V36V"
                                className="rounded-xl border border-violet-300/40 bg-violet-500/15 px-4 py-2 text-sm font-black text-violet-50 transition hover:bg-violet-500/25"
                              >
                                Open App Proxy Image
                              </a>
                              <button
                                type="button"
                                onClick={() => setExpandedCharacterBackgroundCandidateId("")}
                                className="rounded-xl border border-zinc-700 bg-black/40 px-4 py-2 text-sm font-black text-zinc-100 transition hover:border-violet-300/50"
                              >
                                Close
                              </button>
                            </div>
                          </div>

                          {backgroundPreviewProxySrcV36V(candidate) ? (
                            <img
                              src={otgDisplayImageUrlV36BP6(backgroundPreviewProxySrcV36V(candidate))}
                              alt={candidate.name}
                              width={1280}
                              height={720}
                              decoding="async"
                              data-otg="OTG_BACKGROUND_MODAL_IMAGE_V36U"
                              className="mx-auto aspect-video w-full max-w-[1280px] max-h-[72vh] rounded-xl bg-black object-contain"
                            />
                          ) : null}

                          <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">Full source used by Background Studio</p>
                          <p className="mt-1 break-all text-xs text-zinc-400">
                            {candidate.workflowImage || candidate.displayImage || candidate.imageUrl || candidate.imagePath}
                          </p>
                          <p className="mt-2 break-all text-[11px] text-zinc-500">
                            Native Comfy preview base: {backgroundPreviewNativeComfyBaseV36V()}
                          </p>
                          <p className="mt-1 text-[11px] text-zinc-500">
                            Embedded preview uses app proxy; native link is diagnostic.
                          </p>
                        </div>
                      </div>
                    );
                  })() : null}

                <div className="mb-3 flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-cyan-400/20 bg-zinc-950/90 p-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200">Background Studio</p>
                    <h2 className="mt-1 text-xl font-black text-zinc-50">Create Background Preview</h2>
                    <p className="mt-1 max-w-4xl text-xs leading-5 text-zinc-300">
                      Step 1 creates the main preview image. Generated previews are always landscape 1280x720. Use Remove People when a generated background contains unwanted people. After choosing a preview, the next Background Studio phase will create the 10-image angle plate.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => closeCharacterBackgroundStudioV36Q()}
                    className="rounded-xl border border-zinc-700 bg-black/40 px-4 py-2 text-sm font-black text-zinc-100 transition hover:border-cyan-300/50"
                  >
                    Back to Characters
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3">
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="block">
                        <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-200">Background name</span>
                        <input
                          value={characterBackgroundName}
                          onChange={(event) => setCharacterBackgroundName(event.target.value)}
                          placeholder="Scene Background"
                          className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-500 focus:border-cyan-300 focus:outline-none"
                        />
                      </label>

                      <label className="block">
                        <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-200">Location type</span>
                        <input
                          value={characterBackgroundLocationType}
                          onChange={(event) => setCharacterBackgroundLocationType(event.target.value)}
                          placeholder="Library, bedroom, city street, spaceship bridge"
                          className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-500 focus:border-cyan-300 focus:outline-none"
                        />
                      </label>
                    </div>

                    <div className="mt-4" data-otg="OTG_CHARACTER_BACKGROUND_PROVIDER_KREA2_V36BPV2">
                      <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-200">Image model</span>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        {([
                          ["ernie-image", "Ernie Images"],
                          ["z-turbo", "ZTurbo Image"],
                          ["krea2-turbo", "Krea2 Turbo"],
                        ] as const).map(([providerOption, label]) => {
                          const active = characterBackgroundProvider === providerOption;
                          return (
                            <button
                              key={providerOption}
                              type="button"
                              onClick={() => setCharacterBackgroundProvider(providerOption)}
                              className={active
                                ? "rounded-xl border border-cyan-300 bg-cyan-400/15 px-3 py-2 text-left text-xs font-black text-cyan-50"
                                : "rounded-xl border border-zinc-700 bg-black/30 px-3 py-2 text-left text-xs font-bold text-zinc-300 transition hover:border-cyan-300/60 hover:text-cyan-100"}
                              aria-pressed={active}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-4">
                      <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-200">Style preset</span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {CHARACTER_BACKGROUND_STYLE_PRESETS_V36E.map((style) => {
                          const active = characterBackgroundStyle.toLowerCase() === style.toLowerCase();
                          return (
                            <button
                              key={style}
                              type="button"
                              onClick={() => setCharacterBackgroundStyle(style)}
                              className={classNames(
                                "rounded-full border px-3 py-1.5 text-xs font-black transition",
                                active
                                  ? "border-cyan-300 bg-cyan-400/20 text-cyan-50"
                                  : "border-zinc-700 bg-black/30 text-zinc-200 hover:border-cyan-300/50 hover:text-cyan-100",
                              )}
                            >
                              {style}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-4">
                      <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-200">Image creator</span>
                      <div className="mt-2 grid gap-3 md:grid-cols-2">
                        {CHARACTER_BACKGROUND_PROVIDER_PRESETS_V36E.map((provider) => {
                          const active = characterBackgroundProvider === provider.id;
                          return (
                            <button
                              key={provider.id}
                              type="button"
                              onClick={() => setCharacterBackgroundProvider(provider.id)}
                              className={classNames(
                                "rounded-xl border p-3 text-left transition",
                                active
                                  ? "border-violet-300 bg-violet-500/20 text-violet-50"
                                  : "border-zinc-800 bg-black/30 text-zinc-200 hover:border-violet-300/50",
                              )}
                            >
                              <span className="block text-sm font-black">{provider.label}</span>
                              <span className="mt-1 block text-[11px] leading-4 text-zinc-300">{provider.description}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <label className="mt-4 block">
                      <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-200">Describe scene</span>
                      <textarea
                        value={characterBackgroundContinuityBlock}
                        onChange={(event) => setCharacterBackgroundContinuityBlock(event.target.value)}
                        placeholder="Example: young girl's bedroom, pink bed, posters on the wall, white desk, stuffed animals, warm afternoon sunlight"
                        rows={3}
                        className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm leading-6 text-zinc-50 placeholder:text-zinc-500 focus:border-cyan-300 focus:outline-none"
                      />
                    </label>

                    <label className="mt-4 block">
                      <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-200">Prompt sent to ComfyUI</span>
                      <textarea
                        value={characterBackgroundPrompt}
                        onChange={(event) => setCharacterBackgroundPrompt(event.target.value)}
                        placeholder="Click Build Prompt, or enter the exact prompt to send to ComfyUI."
                        rows={3}
                        className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm leading-6 text-zinc-50 placeholder:text-zinc-500 focus:border-cyan-300 focus:outline-none"
                      />
                    </label>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setCharacterBackgroundPrompt(buildCharacterBackgroundPromptV36E({
                            name: characterBackgroundName.trim(),
                            locationType: characterBackgroundLocationType.trim(),
                            style: characterBackgroundStyle.trim() || "Cinematic",
                            describeScene: characterBackgroundContinuityBlock.trim(),
                            promptOverride: "",
                          }));
                        }}
                        className="rounded-xl border border-zinc-700 bg-black/30 px-4 py-2 text-sm font-black text-zinc-100 transition hover:border-cyan-300/50"
                      >
                        Build Prompt
                      </button>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-300">Previews</span>
                        {[1, 2, 3, 4, 5].map((count) => (
                          <button
                            key={count}
                            type="button"
                            onClick={() => setCharacterBackgroundPreviewCount(count)}
                            className={classNames(
                              "h-8 w-8 rounded-full border text-xs font-black transition",
                              characterBackgroundPreviewCount === count
                                ? "border-cyan-300 bg-cyan-400/20 text-cyan-50"
                                : "border-zinc-700 bg-black/30 text-zinc-200 hover:border-cyan-300/50",
                            )}
                          >
                            {count}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => void createCharacterBackgroundPreviewsV36E()}
                        disabled={characterBackgroundBusy || (!characterBackgroundPrompt.trim() && !characterBackgroundContinuityBlock.trim())}
                        className="rounded-xl border border-cyan-300/40 bg-cyan-500/15 px-4 py-2 text-sm font-black text-cyan-50 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-300"
                      >
                        {characterBackgroundBusy ? "Working..." : `Create ${characterBackgroundPreviewCount} Preview${characterBackgroundPreviewCount === 1 ? "" : "s"}`}
                      </button>

                      <label className="cursor-pointer rounded-xl border border-violet-300/40 bg-violet-500/15 px-4 py-2 text-sm font-black text-violet-50 transition hover:bg-violet-500/25">
                        Upload Background
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={characterBackgroundBusy}
                          onChange={(event) => {
                            const file = event.target.files?.[0] || null;
                            event.target.value = "";
                            void uploadCharacterBackgroundV36A(file);
                          }}
                        />
                      </label>
                    </div>

                    {characterBackgroundStatus ? (
                      <p className="mt-4 text-sm font-semibold text-cyan-100">{characterBackgroundStatus}</p>
                    ) : null}
                  </div>

                  <aside className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-300">Preview images</p>
                        <p className="mt-1 text-[11px] text-zinc-500">Click a preview to enlarge it. Use Image creates the complete background image plate. The final plate is what gets sent to ComfyUI. Sync accepts exact current-run matches only.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => useSelectedCharacterBackgroundImageV36E()}
                        disabled={!selectedCharacterBackgroundCandidateId || !characterBackgroundPreviewCandidates.length}
                        className="rounded-xl border border-emerald-300/40 bg-emerald-500/15 px-4 py-2 text-sm font-black text-emerald-50 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-300"
                      >
                        Use Image
                      </button>
                    </div>

                    {characterBackgroundPreviewCandidates.length ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                        {characterBackgroundPreviewCandidates.slice(0, 5).map((candidate) => {
                          const selected = selectedCharacterBackgroundCandidateId === candidate.id;
                          return (
                            <button
                              key={candidate.id}
                              type="button"
                              onClick={() => {
                                setSelectedCharacterBackgroundCandidateId(candidate.id);
                                setExpandedCharacterBackgroundCandidateId(candidate.id);
                              }}
                              className={classNames(
                                "rounded-xl border bg-black/30 p-2 text-left transition",
                                selected ? "border-emerald-300" : "border-zinc-800 hover:border-cyan-300/50",
                              )}
                            >
                              {backgroundPreviewProxySrcV36V(candidate) ? (
                                <img
                                  src={otgDisplayImageUrlV36BP6(backgroundPreviewProxySrcV36V(candidate))}
                                  alt={candidate.name}
                                  width={320}
                                  height={180}
                                  decoding="async"
                                  data-otg="OTG_BACKGROUND_PREVIEW_CARD_IMAGE_V36U"
                                  className="aspect-video w-full rounded-lg bg-black object-contain"
                                />
                              ) : null}
                              <p className="mt-2 truncate text-xs font-bold text-zinc-100">{candidate.name}</p>
                              <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">{candidate.provider}</p>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-dashed border-zinc-700 bg-black/20 p-6 text-sm leading-6 text-zinc-400">
                        No previews yet. Build a prompt, choose Ernie Image, Z Turbo, or Krea2 Turbo, then create 1-5 previews.
                      </div>
                    )}
                  </aside>
                </div>
              </div>
            </div>
          ) : null}
        </section>
        <aside className={classNames(!characterBackgroundStudioOpen && showSavedCharactersStrip ? "block lg:col-span-1" : "hidden", "rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4")}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-zinc-50">Saved Characters</h3>
            <p className="text-[11px] text-zinc-500">Create-character drafts auto-save. Long voice jobs continue in the worker.</p>
            <button type="button" onClick={() => void loadCharacters()} className="text-xs text-zinc-400 hover:text-amber-200">
              Refresh
            </button>
          </div>
          {loading && !characters.length ? <p className="mt-3 text-sm text-zinc-500">Loading...</p> : null}
          {characters.some((character) => isSavedForLaterCharacterV36BPS2(character)) ? (
            <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/5 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-[0.18em] text-amber-200">Save for Later</h4>
                  <p className="mt-1 text-xs text-zinc-500">Incomplete background-free character sources. Click Complete Character to create the card and finish the character.</p>
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-3">
                {characters.filter((character) => isSavedForLaterCharacterV36BPS2(character)).map((character) => {
                  const characterKey = safeId(String(character.id || character.name || ""));
                  return (
                    <div key={character.id || characterKey} className="rounded-xl border border-amber-300/30 bg-zinc-900/70 p-3">
                      {characterDisplayImagePathV36BP8(character) ? (
                        <img src={otgDisplayImageUrlV36BP8(fileUrlFor(characterDisplayImagePathV36BP8(character)))} alt={character.name} className="mb-3 h-52 w-full rounded-lg bg-black/30 object-contain" />
                      ) : null}
                      <p className="text-base font-semibold leading-snug text-zinc-100">{character.name}</p>
                      <p className="mt-1 text-xs text-amber-100">Saved for later. Character card still required.</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => completeSavedForLaterCharacterV36BPS2(character)}
                          className="rounded-full border border-amber-300/70 bg-amber-300/10 px-2 py-1 text-[11px] font-semibold text-amber-100 transition hover:bg-amber-300/20"
                        >
                          Complete Character
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteSavedCharacter(character)}
                          className="rounded-full border border-red-500/60 bg-red-500/10 px-2 py-1 text-[11px] text-red-100 transition hover:bg-red-500/20"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-3">
            {characters.filter((character) => !isSavedForLaterCharacterV36BPS2(character)).length ? (
              characters.filter((character) => !isSavedForLaterCharacterV36BPS2(character)).map((character) => {
                const characterKey = safeId(String(character.id || character.name || ""));
                const description = String(character.globalPromptIdentityBlock || character.description || "").trim();
                const descriptionExpanded = Boolean(expandedCharacterDescriptions[characterKey]);
                const descriptionLimit = 180;
                const hasLongDescription = description.length > descriptionLimit;
                const displayDescription = hasLongDescription && !descriptionExpanded
                  ? `${description.slice(0, descriptionLimit).trimEnd()}...`
                  : description;
                const hasVoice = characterHasCustomVoice(character);

                return (
                  <div key={character.id || characterKey} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                    {character.previewImagePath || character.imagePath ? (
                      <img src={otgDisplayImageUrlV36BP8(fileUrlFor(characterDisplayImagePathV36BP8(character)))} alt={character.name} className="mb-3 h-52 w-full rounded-lg bg-black/30 object-contain" />
                    ) : null}

                    <p className="text-base font-semibold leading-snug text-zinc-100">{character.name}</p>

                    {description ? (
                      <div className="mt-1">
                        <p className="text-xs leading-5 text-zinc-400">{displayDescription}</p>
                        {hasLongDescription ? (
                          <button
                            type="button"
                            onClick={() => setExpandedCharacterDescriptions((current) => ({
                              ...current,
                              [characterKey]: !descriptionExpanded,
                            }))}
                            className="mt-1 text-[11px] font-semibold text-amber-200 hover:text-amber-100"
                          >
                            {descriptionExpanded ? "Less" : "More"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-white/70">
                        Voice: {hasVoice ? "Artifact ready" : "Planned"}
                      </span>
                      <button
                        type="button"
                        onClick={() => startVoiceLabForSavedCharacter(character)}
                        disabled={hasVoice}
                        className="rounded-full border border-cyan-500/60 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-500"
                      >
                        {hasVoice ? "Voice Added" : "Add Voice"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteSavedCharacter(character)}
                        className="rounded-full border border-red-500/60 bg-red-500/10 px-2 py-1 text-[11px] text-red-100 transition hover:bg-red-500/20"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-zinc-500">No completed characters yet.</p>
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

function ImageChooser({ candidates, selectedId, onSelect, onDelete, onSaveForLater, saveForLaterStatusById = {}, saveForLaterProgressById = {} }: { candidates: CandidateImage[]; selectedId: string; onSelect: (id: string) => void; onDelete: (id: string) => void; onSaveForLater?: (candidate: CandidateImage) => void | Promise<void>; saveForLaterStatusById?: Record<string, boolean>; saveForLaterProgressById?: Record<string, "idle" | "saving" | "saved" | "error"> }) {
  const selected = candidates.find((item) => item.id === selectedId);
  return (
    <div className="mt-5">
      <div className="min-w-[8rem] rounded-xl border border-zinc-800 bg-zinc-950 p-3">
        {selected ? <img src={otgDisplayImageUrlV36BP6(selected.url)} alt={selected.label} className="mx-auto max-h-[640px] rounded-lg object-contain" /> : <div className="flex h-80 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">Main preview</div>}
      </div>
      <div className="mt-3 grid grid-cols-5 gap-2">
        {candidates.map((candidate) => (
          <div key={candidate.id} className={classNames("relative rounded-xl border p-1", selectedId === candidate.id ? "border-amber-300" : "border-zinc-800")}>
            <button type="button" onClick={() => onSelect(candidate.id)} className="block w-full">
              <img src={otgDisplayImageUrlV36BP6(candidate.url)} alt={candidate.label} className="aspect-[9/12] w-full rounded-lg object-cover" />
              {selectedId === candidate.id ? <span className="absolute left-2 top-2 rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-semibold text-zinc-950">Selected</span> : null}
            </button>
            {onSaveForLater ? (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void onSaveForLater(candidate);
                }}
                disabled={saveForLaterProgressById[candidate.id] === "saving" || saveForLaterProgressById[candidate.id] === "saved" || Boolean(saveForLaterStatusById[candidate.id])}
                className={classNames(
                  "mt-1 w-full rounded-lg border py-1 text-[11px] font-semibold disabled:cursor-default",
                  saveForLaterProgressById[candidate.id] === "saved" || saveForLaterStatusById[candidate.id]
                    ? "border-emerald-300/60 bg-emerald-300/10 text-emerald-100"
                    : saveForLaterProgressById[candidate.id] === "saving"
                      ? "border-amber-300/60 bg-amber-300/20 text-amber-50"
                      : saveForLaterProgressById[candidate.id] === "error"
                        ? "border-red-400/60 bg-red-500/10 text-red-100 hover:bg-red-500/20"
                        : "border-amber-300/60 bg-amber-300/10 text-amber-100 hover:bg-amber-300/20",
                )}
              >
                {saveForLaterProgressById[candidate.id] === "saved" || saveForLaterStatusById[candidate.id]
                  ? "Saved"
                  : saveForLaterProgressById[candidate.id] === "saving"
                    ? "Saving..."
                    : saveForLaterProgressById[candidate.id] === "error"
                      ? "Try Save Again"
                      : "Save for Later"}
              </button>
            ) : null}
            <button type="button" onClick={() => onDelete(candidate.id)} className="mt-1 w-full rounded-lg border border-zinc-800 py-1 text-[11px] text-zinc-400 hover:text-red-200">
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
