import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export type CharacterBuilderDraft = {
  ownerId: string;
  draftId: string;
  mode: "new_character" | "add_voice_to_existing_character";
  characterId: string | null;
  currentStage: string;
  state: Record<string, unknown>;
  updatedAt: string;
  createdAt: string;
};

export type SavedCharacterRecord = {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  characterStatus: "draft" | "card_complete" | "complete";
  voiceStatus:
    | "none"
    | "voice_lab_started"
    | "voice_pack_generating"
    | "training"
    | "ready"
    | "failed";
  hasCustomVoice: boolean;
  voiceProfileId: string | null;
  voiceTrainingId: string | null;
  trainedModelPath: string | null;
  trainedIndexPath: string | null;
  imagePath: string | null;
  cardImagePath: string | null;
  rawDraftState: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const repoRoot = process.cwd();

export function sanitizeOwnerId(ownerId: unknown): string {
  const raw = typeof ownerId === "string" && ownerId.trim() ? ownerId.trim() : "slrochford12300";
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96) || "slrochford12300";
}

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

export function dataRoot(): string {
  return path.join(repoRoot, "data");
}

export function draftPath(ownerId: string): string {
  return path.join(dataRoot(), "character-builder-drafts", `${sanitizeOwnerId(ownerId)}.json`);
}

export function characterDir(ownerId: string): string {
  return path.join(dataRoot(), "characters", sanitizeOwnerId(ownerId));
}

export function characterPath(ownerId: string, characterId: string): string {
  return path.join(characterDir(ownerId), `${characterId}.json`);
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readDraft(ownerId: string): Promise<CharacterBuilderDraft | null> {
  return readJsonFile<CharacterBuilderDraft>(draftPath(ownerId));
}

export async function writeDraft(ownerId: string, input: Partial<CharacterBuilderDraft>): Promise<CharacterBuilderDraft> {
  const safeOwner = sanitizeOwnerId(ownerId);
  const existing = await readDraft(safeOwner);
  const now = new Date().toISOString();

  const draft: CharacterBuilderDraft = {
    ownerId: safeOwner,
    draftId: existing?.draftId || input.draftId || makeId("cbd"),
    mode: input.mode || existing?.mode || "new_character",
    characterId: input.characterId ?? existing?.characterId ?? null,
    currentStage: input.currentStage || existing?.currentStage || "start",
    state: {
      ...(existing?.state || {}),
      ...(input.state || {}),
    },
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await writeJsonFile(draftPath(safeOwner), draft);
  return draft;
}

export async function clearDraft(ownerId: string): Promise<void> {
  try {
    await fs.unlink(draftPath(ownerId));
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function pickString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return null;
}

export async function completeCharacterCardOnly(ownerId: string, state: Record<string, unknown>): Promise<SavedCharacterRecord> {
  const safeOwner = sanitizeOwnerId(ownerId);
  const now = new Date().toISOString();

  const existingCharacterId =
    pickString(state, ["characterId", "id", "selectedCharacterId"]) ||
    makeId("character");

  const name =
    pickString(state, ["name", "characterName", "title"]) ||
    "Untitled Character";

  const description =
    pickString(state, ["description", "characterDescription", "details", "bio", "prompt"]) ||
    "";

  const imagePath =
    pickString(state, ["imagePath", "sourceImagePath", "uploadedImagePath", "imageUrl", "previewUrl"]) ||
    null;

  const cardImagePath =
    pickString(state, ["cardImagePath", "characterCardPath", "cardUrl", "characterCardUrl", "generatedCardUrl"]) ||
    null;

  const existing = await readJsonFile<Partial<SavedCharacterRecord>>(characterPath(safeOwner, existingCharacterId));

  const record: SavedCharacterRecord = {
    id: existingCharacterId,
    ownerId: safeOwner,
    name,
    description,
    characterStatus: "card_complete",
    voiceStatus: "none",
    hasCustomVoice: false,
    voiceProfileId: null,
    voiceTrainingId: null,
    trainedModelPath: null,
    trainedIndexPath: null,
    imagePath,
    cardImagePath,
    rawDraftState: state,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await writeJsonFile(characterPath(safeOwner, existingCharacterId), record);
  await clearDraft(safeOwner);

  return record;
}
