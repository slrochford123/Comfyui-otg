import {
  H3_ORIENTATION_OPTIONS,
  H3_PRODUCTION_DURATION_OPTIONS,
  H3_QUALITY_OPTIONS,
  type H3Orientation,
  type H3ProductionDuration,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";

export type H3RefModCategory =
  | "character"
  | "motion"
  | "audio"
  | "bundle"
  | "uncategorized";
export type H3RefModComponents = "Auto" | "All" | "Visual" | "Audio";
export type H3RefModSourceKind = "image" | "video" | "audio" | "bundle" | "unknown";

export type H3RefModSlotInput = {
  id?: unknown;
  name?: unknown;
  category?: unknown;
  sourceKind?: unknown;
  strength?: unknown;
  components?: unknown;
  visualStrength?: unknown;
  audioStrength?: unknown;
  copies?: unknown;
  description?: unknown;
  characterId?: unknown;
};

export type H3RefModSlot = {
  id: string;
  name: string;
  category: H3RefModCategory;
  sourceKind: H3RefModSourceKind;
  strength: number;
  components: H3RefModComponents;
  visualStrength: number;
  audioStrength: number;
  copies: number;
  description: string;
  characterId: string;
};

export type H3RefModLibraryEntry = {
  id: string;
  name: string;
  category: H3RefModCategory;
  file: string;
  kind: H3RefModSourceKind;
  concept: string;
  description: string;
  tokens: number | null;
  shape: number[] | null;
  hasVisual: boolean;
  hasAudio: boolean;
  sourceType: "installed-refmod" | "otg-created" | "unknown";
  sizeBytes?: number | null;
  createdAt?: string | null;
  modifiedAt?: string | null;
  characterId?: string | null;
};

export type H3RefModsRequestInput = {
  mode?: unknown;
  quality?: unknown;
  orientation?: unknown;
  durationSeconds?: unknown;
  prompt?: unknown;
  refMods?: unknown;
  turbo?: unknown;
  seed?: unknown;
};

export type H3RefModsCompileInput = {
  prompt: string;
  refMods: H3RefModSlot[];
};

export const H3_REFMOD_LIMITS = {
  maxRefMods: 8,
  minStrength: 0,
  maxStrength: 1,
  minCopies: 1,
  maxCopies: 10,
} as const;

const COMPONENTS: H3RefModComponents[] = ["Auto", "All", "Visual", "Audio"];
const CATEGORIES: H3RefModCategory[] = [
  "character",
  "motion",
  "audio",
  "bundle",
  "uncategorized",
];

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function cleanId(value: unknown, fallback: string) {
  const cleaned = clean(value).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 96);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : fallback;
}

function numberInRange(value: unknown, min: number, max: number, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return Number(number.toFixed(3));
}

function normalizeCategory(value: unknown): H3RefModCategory {
  const raw = clean(value).toLowerCase();
  if (raw === "people" || raw === "characters" || raw === "identity") return "character";
  if (raw === "video" || raw === "pose_motion" || raw === "motion") return "motion";
  if (raw === "voice" || raw === "music" || raw === "sound_fx" || raw === "ambience") return "audio";
  if (raw === "bundle" || raw === "bundles") return "bundle";
  return CATEGORIES.includes(raw as H3RefModCategory)
    ? raw as H3RefModCategory
    : "uncategorized";
}

function normalizeSourceKind(value: unknown): H3RefModSourceKind {
  const raw = clean(value).toLowerCase();
  return ["image", "video", "audio", "bundle"].includes(raw)
    ? raw as H3RefModSourceKind
    : "unknown";
}

function normalizeComponents(value: unknown): H3RefModComponents {
  const raw = clean(value);
  return COMPONENTS.includes(raw as H3RefModComponents)
    ? raw as H3RefModComponents
    : "Auto";
}

export function isSafeRefModName(value: unknown) {
  const name = clean(value).replaceAll("\\", "/");
  if (!name || name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return false;
  if (name.endsWith(".safetensors")) return false;
  return name.split("/").every((part) =>
    Boolean(part)
    && part !== "."
    && part !== ".."
    && part !== ".git"
    && part !== "__pycache__"
    && part !== "graph_presets"
  );
}

export function normalizeH3RefModSlots(value: unknown): H3RefModSlot[] {
  const items = Array.isArray(value) ? value : [];
  if (items.length > H3_REFMOD_LIMITS.maxRefMods) {
    throw new Error(`Use at most ${H3_REFMOD_LIMITS.maxRefMods} RefMods.`);
  }

  return items.map((item, index) => {
    const record = item && typeof item === "object" ? item as H3RefModSlotInput : {};
    const name = clean(record.name);
    if (!isSafeRefModName(name)) {
      throw new Error(`RefMod slot ${index + 1} must use a saved RefMod library name without traversal or extension.`);
    }
    return {
      id: cleanId(record.id, `refmod-${index + 1}`),
      name,
      category: normalizeCategory(record.category),
      sourceKind: normalizeSourceKind(record.sourceKind),
      strength: numberInRange(
        record.strength ?? 0.9,
        H3_REFMOD_LIMITS.minStrength,
        H3_REFMOD_LIMITS.maxStrength,
        `RefMod slot ${index + 1} strength`,
      ),
      components: normalizeComponents(record.components),
      visualStrength: numberInRange(
        record.visualStrength ?? 1,
        H3_REFMOD_LIMITS.minStrength,
        H3_REFMOD_LIMITS.maxStrength,
        `RefMod slot ${index + 1} visual strength`,
      ),
      audioStrength: numberInRange(
        record.audioStrength ?? 1,
        H3_REFMOD_LIMITS.minStrength,
        H3_REFMOD_LIMITS.maxStrength,
        `RefMod slot ${index + 1} audio strength`,
      ),
      copies: Math.round(numberInRange(
        record.copies ?? 1,
        H3_REFMOD_LIMITS.minCopies,
        H3_REFMOD_LIMITS.maxCopies,
        `RefMod slot ${index + 1} copies`,
      )),
      description: clean(record.description),
      characterId: clean(record.characterId),
    };
  });
}

export function refModSlotWarnings(slot: H3RefModSlot) {
  const warnings: string[] = [];
  const loadsVisual = slot.components === "Auto" || slot.components === "All" || slot.components === "Visual";
  if (loadsVisual && slot.visualStrength === 0) {
    warnings.push("Visual component is disabled for this RefMod.");
  }
  const loadsAudio = slot.components === "Auto" || slot.components === "All" || slot.components === "Audio";
  if (loadsAudio && slot.audioStrength === 0) {
    warnings.push("Audio component is disabled for this RefMod.");
  }
  if (slot.strength === 0) warnings.push("Overall strength is zero; this slot will be skipped.");
  return warnings;
}

export function reorderH3RefMods(slots: H3RefModSlot[], orderedIds: string[]) {
  const byId = new Map(slots.map((slot) => [slot.id, slot]));
  const ordered: H3RefModSlot[] = [];
  orderedIds.forEach((id) => {
    const slot = byId.get(id);
    if (slot && !ordered.includes(slot)) ordered.push(slot);
  });
  slots.forEach((slot) => {
    if (!ordered.includes(slot)) ordered.push(slot);
  });
  return ordered;
}

export function categorizeH3RefModLibraryEntry(value: {
  kind?: unknown;
  concept?: unknown;
  name?: unknown;
  description?: unknown;
}): H3RefModCategory {
  const kind = normalizeSourceKind(value.kind);
  const concept = clean(value.concept).toLowerCase();
  const name = clean(value.name).toLowerCase();
  const description = clean(value.description).toLowerCase();
  const haystack = `${concept} ${name} ${description}`;
  if (kind === "bundle") return "bundle";
  if (kind === "audio" || /(voice|singing|music|sound|sfx|ambience|ambient)/.test(haystack)) return "audio";
  if (/(identity|character|person|people|face|body)/.test(haystack)) return "character";
  if (kind === "video" || /(motion|pose|gesture|walk|dance|camera)/.test(haystack)) return "motion";
  return "uncategorized";
}

export function normalizeH3RefModLibraryEntry(value: Record<string, unknown>): H3RefModLibraryEntry {
  const name = clean(value.name);
  if (!isSafeRefModName(name)) {
    throw new Error("RefMod library entry has an unsafe name.");
  }
  const kind = normalizeSourceKind(value.kind);
  const concept = clean(value.concept || "generic");
  const description = clean(value.description);
  const shape = Array.isArray(value.shape)
    ? value.shape.map((item) => Number(item)).filter((item) => Number.isFinite(item))
    : null;
  const category = categorizeH3RefModLibraryEntry({ kind, concept, name, description });
  const hasAudio = kind === "audio" || category === "audio" || kind === "bundle";
  const hasVisual = kind === "image" || kind === "video" || kind === "bundle" || category === "character" || category === "motion";

  return {
    id: name,
    name,
    category,
    file: clean(value.path),
    kind,
    concept,
    description,
    tokens: Number.isFinite(Number(value.tokens)) ? Number(value.tokens) : null,
    shape,
    hasVisual,
    hasAudio,
    sourceType: "installed-refmod",
  };
}

function visualLabel(slot: H3RefModSlot, visualIndex: number) {
  if (slot.sourceKind === "image") return `<Picture ${visualIndex}>`;
  return `<Video ${visualIndex}>`;
}

export function compileH3RefModsPrompt(input: H3RefModsCompileInput) {
  const prompt = clean(input.prompt);
  if (!prompt) throw new Error("Enter a Ref Mods prompt.");
  const refMods = normalizeH3RefModSlots(input.refMods);
  if (!refMods.length) throw new Error("Add at least one RefMod.");

  let visualCount = 0;
  let audioCount = 0;
  let subjectCount = 0;
  const subjectLines: string[] = [];
  const retentionLines: string[] = [];
  const soundLines: string[] = [];

  refMods.forEach((slot, index) => {
    const slotNumber = index + 1;
    const loadsVisual = slot.components !== "Audio" && slot.visualStrength > 0 && slot.strength > 0;
    const loadsAudio = slot.components !== "Visual" && slot.audioStrength > 0 && slot.strength > 0;
    const visual = loadsVisual ? visualLabel(slot, ++visualCount) : "";
    const audio = loadsAudio && (slot.category === "audio" || slot.sourceKind === "audio" || slot.sourceKind === "bundle")
      ? `<Audio ${++audioCount}>`
      : "";

    if (slot.category === "character") {
      subjectCount += 1;
      subjectLines.push(`<Subject ${subjectCount}> = RefMod slot ${slotNumber} "${slot.name}"${visual ? ` (${visual})` : ""}. Preserve the character identity, face, skin tone, hairstyle, body build, wardrobe continuity, and any supplied description: ${slot.description || "no extra description supplied"}.`);
      retentionLines.push(`RefMod slot ${slotNumber} is the authoritative identity reference for <Subject ${subjectCount}>. Keep slot order deterministic; if this RefMod moves, the subject mapping moves with it.`);
    } else if (slot.category === "motion") {
      retentionLines.push(`RefMod slot ${slotNumber} "${slot.name}"${visual ? ` (${visual})` : ""} anchors the requested motion, pose rhythm, gesture, or camera movement without adding a new character.`);
    } else if (slot.category === "audio") {
      soundLines.push(`RefMod slot ${slotNumber} "${slot.name}"${audio ? ` (${audio})` : ""} guides the music, ambience, or sound effect texture. Do not treat it as reliable voice cloning.`);
    } else if (slot.category === "bundle") {
      retentionLines.push(`RefMod slot ${slotNumber} "${slot.name}" is a bundle. Use its visual and audio members according to the loader component settings without duplicating the same RefMod elsewhere.`);
    } else {
      retentionLines.push(`RefMod slot ${slotNumber} "${slot.name}"${visual ? ` (${visual})` : ""} is an additional reusable reference. Apply it according to the user's prompt and the slot description: ${slot.description || "none"}.`);
    }
  });

  if (!subjectLines.length) {
    subjectLines.push("No explicit character RefMod is loaded. Do not invent extra characters; use RefMods only for the requested motion, audio, style, or scene guidance.");
  }
  if (!soundLines.length) {
    soundLines.push("Use natural diegetic ambience appropriate to the scene unless the user provided dialogue or audio instructions.");
  }

  return [
    "subject_definitions:",
    ...subjectLines,
    "summary:",
    prompt,
    "retention_analysis:",
    ...retentionLines,
    "detailed_description:",
    "Preserve the user's exact intent and dialogue. Follow the loaded RefMods in slot order, keep identity mappings deterministic, and avoid adding unrequested people or actions.",
    "overall_soundscape:",
    ...soundLines,
    "non_diegetic_music:",
    "Only add music when the user requested music or an audio RefMod is explicitly categorized as music. Otherwise keep non-diegetic music minimal or absent.",
  ].join("\n");
}

export function validateH3RefModsRequest(input: H3RefModsRequestInput) {
  const mode = clean(input.mode);
  const quality = clean(input.quality) as H3Quality;
  const orientation = clean(input.orientation) as H3Orientation;
  const durationSeconds = Number(input.durationSeconds) as H3ProductionDuration;
  if (mode !== "h3-refmods") throw new Error("Choose Ref Mods mode.");
  if (!H3_QUALITY_OPTIONS.includes(quality)) throw new Error("Choose SH, LQ, or HQ.");
  if (!H3_ORIENTATION_OPTIONS.includes(orientation)) throw new Error("Choose Landscape or Portrait orientation.");
  if (!H3_PRODUCTION_DURATION_OPTIONS.includes(durationSeconds)) throw new Error("Choose a 5- or 10-second duration.");
  const prompt = clean(input.prompt);
  if (!prompt) throw new Error("Enter a Ref Mods prompt.");
  const refMods = normalizeH3RefModSlots(input.refMods);
  if (!refMods.length) throw new Error("Add at least one RefMod.");
  const seed = input.seed === undefined || input.seed === null || input.seed === ""
    ? undefined
    : Number(input.seed);
  if (seed !== undefined && (!Number.isSafeInteger(seed) || seed < 0)) {
    throw new Error("Ref Mods seed must be a non-negative safe integer.");
  }
  return {
    mode: "h3-refmods" as const,
    quality,
    orientation,
    durationSeconds,
    prompt,
    refMods,
    turbo: input.turbo !== false,
    seed,
    compiledPrompt: compileH3RefModsPrompt({ prompt, refMods }),
  };
}
