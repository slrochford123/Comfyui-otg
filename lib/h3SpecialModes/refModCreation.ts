import fs from "node:fs";
import path from "node:path";

import { OTG_DATA_ROOT, ensureDir, safeJoin, safeSegment } from "@/lib/paths";

export type H3RefModCreateKind = "character" | "motion" | "audio";
export type H3RefModAudioCategory = "music" | "ambience" | "sound_fx";

export type H3RefModCreateSource = {
  path: string;
  name: string;
  kind: "image" | "video" | "audio";
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
};

export type H3RefModCreateConfigInput = {
  kind?: unknown;
  name?: unknown;
  description?: unknown;
  characterId?: unknown;
  audioCategory?: unknown;
  replace?: unknown;
};

export type H3RefModCreateConfig = {
  kind: H3RefModCreateKind;
  name: string;
  libraryName: string;
  subfolder: string;
  description: string;
  characterId: string;
  audioCategory: H3RefModAudioCategory | null;
  replace: boolean;
};

export type H3RefModSidecar = {
  version: 1;
  libraryName: string;
  name: string;
  category: H3RefModCreateKind;
  subfolder: string;
  sourceType: "otg-created";
  createdAt: string;
  updatedAt: string;
  jobId: string;
  ownerKey: string;
  characterId?: string | null;
  description?: string;
  savedPath?: string | null;
  sourceAssets: Array<{
    name: string;
    kind: "image" | "video" | "audio";
    path: string;
    durationSeconds?: number | null;
    width?: number | null;
    height?: number | null;
  }>;
};

export const H3_REFMOD_CREATE_LIMITS = {
  characterMinImages: 4,
  characterMaxImages: 8,
  motionMaxSeconds: 30,
  audioMaxSeconds: 30,
  audioRecommendedMinSeconds: 5,
  audioRecommendedMaxSeconds: 15,
} as const;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeKind(value: unknown): H3RefModCreateKind {
  const raw = clean(value).toLowerCase();
  if (raw === "character" || raw === "person" || raw === "people" || raw === "identity") return "character";
  if (raw === "motion" || raw === "video" || raw === "pose_motion") return "motion";
  if (raw === "audio" || raw === "music" || raw === "ambience" || raw === "sound_fx" || raw === "sfx") return "audio";
  throw new Error("Choose Character, Motion, or Audio RefMod creation.");
}

function normalizeAudioCategory(value: unknown): H3RefModAudioCategory {
  const raw = clean(value).toLowerCase();
  if (raw === "music" || raw === "music_style") return "music";
  if (raw === "sound_fx" || raw === "sound effect" || raw === "sound-effect" || raw === "sfx") return "sound_fx";
  return "ambience";
}

export function isSafeRefModBaseName(value: unknown) {
  const name = clean(value);
  if (!name || name.length > 96) return false;
  if (name.includes("/") || name.includes("\\") || name.endsWith(".safetensors")) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)
    && name !== "."
    && name !== "..";
}

export function h3RefModSubfolderForKind(
  kind: H3RefModCreateKind,
  _audioCategory: H3RefModAudioCategory | null = null,
) {
  if (kind === "character") return "characters";
  if (kind === "motion") return "video";
  return "audio";
}

export function normalizeH3RefModCreateConfig(input: H3RefModCreateConfigInput) {
  const kind = normalizeKind(input.kind);
  const name = clean(input.name);
  if (!isSafeRefModBaseName(name)) {
    throw new Error("RefMod name must be a simple file-safe name without slashes or extension.");
  }
  const audioCategory = kind === "audio" ? normalizeAudioCategory(input.audioCategory) : null;
  const subfolder = h3RefModSubfolderForKind(kind, audioCategory);
  return {
    kind,
    name,
    libraryName: `${subfolder}/${name}`,
    subfolder,
    description: clean(input.description).slice(0, 2000),
    characterId: clean(input.characterId).slice(0, 128),
    audioCategory,
    replace: input.replace === true || clean(input.replace).toLowerCase() === "true",
  } satisfies H3RefModCreateConfig;
}

export function validateH3RefModCreateSources(
  config: H3RefModCreateConfig,
  sources: H3RefModCreateSource[],
) {
  if (config.kind === "character") {
    const images = sources.filter((source) => source.kind === "image");
    if (images.length !== sources.length) throw new Error("Character RefMods require images only.");
    if (
      images.length < H3_REFMOD_CREATE_LIMITS.characterMinImages
      || images.length > H3_REFMOD_CREATE_LIMITS.characterMaxImages
    ) {
      throw new Error(`Character RefMods require ${H3_REFMOD_CREATE_LIMITS.characterMinImages}-${H3_REFMOD_CREATE_LIMITS.characterMaxImages} images.`);
    }
  } else if (config.kind === "motion") {
    if (sources.length !== 1 || sources[0]?.kind !== "video") {
      throw new Error("Motion RefMods require exactly one video clip.");
    }
    const duration = sources[0].durationSeconds;
    if (Number.isFinite(duration) && Number(duration) > H3_REFMOD_CREATE_LIMITS.motionMaxSeconds) {
      throw new Error(`Motion RefMod source videos must be ${H3_REFMOD_CREATE_LIMITS.motionMaxSeconds} seconds or shorter.`);
    }
  } else {
    if (sources.length !== 1 || sources[0]?.kind !== "audio") {
      throw new Error("Audio RefMods require exactly one audio upload.");
    }
    const duration = sources[0].durationSeconds;
    if (Number.isFinite(duration) && Number(duration) > H3_REFMOD_CREATE_LIMITS.audioMaxSeconds) {
      throw new Error(`Audio RefMod source audio must be ${H3_REFMOD_CREATE_LIMITS.audioMaxSeconds} seconds or shorter.`);
    }
  }
  return sources;
}

export function validateH3RefModCreateRequest(
  input: H3RefModCreateConfigInput,
  sources: H3RefModCreateSource[],
) {
  const config = normalizeH3RefModCreateConfig(input);
  return {
    config,
    sources: validateH3RefModCreateSources(config, sources),
  };
}

function registryRoot() {
  const root = safeJoin(OTG_DATA_ROOT, "h3-special", "refmods", "registry");
  ensureDir(root);
  return root;
}

export function h3RefModSidecarPath(libraryName: string) {
  const parts = libraryName.split("/").map((part) => safeSegment(part));
  if (!parts.length || parts.some((part) => !part)) {
    throw new Error("RefMod library name is invalid.");
  }
  return safeJoin(registryRoot(), ...parts) + ".json";
}

export function readH3RefModSidecar(libraryName: string) {
  try {
    return JSON.parse(fs.readFileSync(h3RefModSidecarPath(libraryName), "utf8")) as H3RefModSidecar;
  } catch {
    return null;
  }
}

export function writeH3RefModSidecar(sidecar: H3RefModSidecar) {
  const target = h3RefModSidecarPath(sidecar.libraryName);
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, JSON.stringify(sidecar, null, 2), "utf8");
  return target;
}
