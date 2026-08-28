import fs from "node:fs";
import path from "node:path";

import { OTG_DATA_ROOT, ensureDir, readJsonSafe, safeJoin, safeSegment } from "@/lib/paths";
import type { CharacterVoiceProfile, VoiceModelArtifact } from "@/lib/characterVoiceAudioStudio";

export type CharacterReferenceAsset = {
  serverPath: string;
  url?: string;
  width: number;
  height: number;
  sourcePath?: string;
  promptId?: string;
};

export type CharacterReferencePackage = {
  pipelineVersion: 1;
  status: "pending" | "generating_angles" | "upscaling" | "stitching" | "complete" | "failed";
  completionJobId?: string;
  anglePromptId?: string;
  upscalePromptIds?: Partial<Record<"front" | "back" | "leftProfile" | "rightProfile", string>>;
  body?: {
    front?: CharacterReferenceAsset;
    back?: CharacterReferenceAsset;
    leftProfile?: CharacterReferenceAsset;
    rightProfile?: CharacterReferenceAsset;
  };
  characterCard?: CharacterReferenceAsset;
  completedAt?: string;
  error?: string;
};

export type CharacterRecord = {
  id: string;
  name: string;
  imagePath: string;
  previewImagePath?: string;
  transparentImagePath?: string;
  originalSourceImagePath?: string;
  fullBodyImagePath?: string;
  characterCardPath?: string;
  characterCardWorkflowImagePath?: string;
  characterCardPreviewImagePath?: string;
  characterReferences?: CharacterReferencePackage;
  defaultCharacterImagePath?: string;
  defaultCharacterPreviewImagePath?: string;
  defaultCharacterSourceImagePath?: string;
  backgroundRemovedDefaultImagePath?: string;
  defaultCharacterImageStatus?: "background_removed" | "fallback_original_card" | "missing";
  description: string;
  voiceStyleDefinition: string;
  introLine: string;
  introVideoPath?: string;
  referenceAudioPath?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  voiceSettings?: Record<string, unknown>;
  characterVoiceProfile?: CharacterVoiceProfile | null;
  characterStatus?: string;
  voiceStatus?: string;
  hasCustomVoice?: boolean;
  voiceModelArtifacts?: VoiceModelArtifact[];
  voicePackPaths?: Record<string, string>;
  voiceEngineUsed?: string;
  voicePromptPresetMetadata?: Record<string, unknown>;
  yellingPresetMetadata?: Record<string, unknown>;
  globalPromptIdentityBlock?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateCharacterInput = {
  id?: string;
  name: string;
  imagePath: string;
  previewImagePath?: string;
  transparentImagePath?: string;
  originalSourceImagePath?: string;
  fullBodyImagePath?: string;
  characterCardPath?: string;
  characterCardWorkflowImagePath?: string;
  characterCardPreviewImagePath?: string;
  characterReferences?: CharacterReferencePackage;
  defaultCharacterImagePath?: string;
  defaultCharacterPreviewImagePath?: string;
  defaultCharacterSourceImagePath?: string;
  backgroundRemovedDefaultImagePath?: string;
  defaultCharacterImageStatus?: "background_removed" | "fallback_original_card" | "missing";
  description: string;
  voiceStyleDefinition?: string;
  introLine?: string;
  introVideoPath?: string;
  referenceAudioPath?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  voiceSettings?: Record<string, unknown>;
  characterVoiceProfile?: CharacterVoiceProfile | null;
  characterStatus?: string;
  voiceStatus?: string;
  hasCustomVoice?: boolean;
  voiceModelArtifacts?: VoiceModelArtifact[];
  voicePackPaths?: Record<string, string>;
  voiceEngineUsed?: string;
  voicePromptPresetMetadata?: Record<string, unknown>;
  yellingPresetMetadata?: Record<string, unknown>;
  globalPromptIdentityBlock?: string;
};

export type UpdateCharacterVoiceSelectionInput = {
  referenceAudioPath: string;
  voiceSettings?: Record<string, unknown>;
  voiceEngineUsed?: string;
  voiceStyleDefinition?: string;
  metadata?: Record<string, unknown>;
};

function charactersRoot(ownerKey: string): string {
  const dir = path.join(OTG_DATA_ROOT, "characters", safeSegment(ownerKey || "local"));
  ensureDir(dir);
  return dir;
}

function characterFile(ownerKey: string, characterId: string): string {
  return safeJoin(charactersRoot(ownerKey), `${safeSegment(characterId || "character")}.json`);
}

function nextUpdatedAt(previous: string | undefined): string {
  const now = Date.now();
  const previousMs = Date.parse(String(previous || ""));
  return new Date(Number.isFinite(previousMs) ? Math.max(now, previousMs + 1) : now).toISOString();
}

function normalizeRecord(input: CreateCharacterInput, existing?: CharacterRecord | null): CharacterRecord {
  if (input.characterVoiceProfile) {
    validateCharacterVoiceProfileArtifactFiles(input.characterVoiceProfile);
  }
  const id = safeSegment(input.id || input.name || `character_${Date.now()}`);
  const now = new Date().toISOString();
  return {
    id,
    name: String(input.name || "Untitled Character").trim() || "Untitled Character",
    imagePath: String(input.imagePath || "").trim(),
    previewImagePath: input.previewImagePath ? String(input.previewImagePath).trim() : undefined,
    transparentImagePath: input.transparentImagePath ? String(input.transparentImagePath).trim() : undefined,
    originalSourceImagePath: input.originalSourceImagePath ? String(input.originalSourceImagePath).trim() : undefined,
    fullBodyImagePath: input.fullBodyImagePath ? String(input.fullBodyImagePath).trim() : undefined,
    characterCardPath: input.characterCardPath ? String(input.characterCardPath).trim() : undefined,
    characterCardWorkflowImagePath: input.characterCardWorkflowImagePath ? String(input.characterCardWorkflowImagePath).trim() : undefined,
    characterCardPreviewImagePath: input.characterCardPreviewImagePath ? String(input.characterCardPreviewImagePath).trim() : undefined,
    characterReferences:
      input.characterReferences && typeof input.characterReferences === "object" && !Array.isArray(input.characterReferences)
        ? (input.characterReferences as CharacterReferencePackage)
        : undefined,
    defaultCharacterImagePath: input.defaultCharacterImagePath ? String(input.defaultCharacterImagePath).trim() : undefined,
    defaultCharacterPreviewImagePath: input.defaultCharacterPreviewImagePath ? String(input.defaultCharacterPreviewImagePath).trim() : undefined,
    defaultCharacterSourceImagePath: input.defaultCharacterSourceImagePath ? String(input.defaultCharacterSourceImagePath).trim() : undefined,
    backgroundRemovedDefaultImagePath: input.backgroundRemovedDefaultImagePath ? String(input.backgroundRemovedDefaultImagePath).trim() : undefined,
    defaultCharacterImageStatus: input.defaultCharacterImageStatus,
    description: String(input.description || "").trim(),
    voiceStyleDefinition: String(input.voiceStyleDefinition || "").trim(),
    introLine: String(input.introLine || "").trim(),
    introVideoPath: input.introVideoPath ? String(input.introVideoPath).trim() : undefined,
    referenceAudioPath: input.referenceAudioPath ? String(input.referenceAudioPath).trim() : undefined,
    source: input.source ? String(input.source).trim() : undefined,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : undefined,
    voiceSettings: input.voiceSettings && typeof input.voiceSettings === "object" ? input.voiceSettings : undefined,
    characterVoiceProfile: input.characterVoiceProfile === null ? null : input.characterVoiceProfile && typeof input.characterVoiceProfile === "object" ? input.characterVoiceProfile : undefined,
    characterStatus: input.characterStatus ? String(input.characterStatus).trim() : undefined,
    voiceStatus: input.voiceStatus ? String(input.voiceStatus).trim() : undefined,
    hasCustomVoice: typeof input.hasCustomVoice === "boolean" ? input.hasCustomVoice : undefined,
    voiceModelArtifacts: Array.isArray(input.voiceModelArtifacts) ? input.voiceModelArtifacts : undefined,
    voicePackPaths: input.voicePackPaths && typeof input.voicePackPaths === "object" ? input.voicePackPaths : undefined,
    voiceEngineUsed: input.voiceEngineUsed ? String(input.voiceEngineUsed).trim() : undefined,
    voicePromptPresetMetadata: input.voicePromptPresetMetadata && typeof input.voicePromptPresetMetadata === "object" ? input.voicePromptPresetMetadata : undefined,
    yellingPresetMetadata: input.yellingPresetMetadata && typeof input.yellingPresetMetadata === "object" ? input.yellingPresetMetadata : undefined,
    globalPromptIdentityBlock: input.globalPromptIdentityBlock ? String(input.globalPromptIdentityBlock).trim() : undefined,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

function hasBytes(filePath: string | undefined): boolean {
  const clean = String(filePath || "").trim();
  if (!clean) return false;
  try {
    return fs.existsSync(clean) && fs.statSync(clean).isFile() && fs.statSync(clean).size > 0;
  } catch {
    return false;
  }
}

function isInsideDataRoot(filePath: string): boolean {
  const dataRoot = path.resolve(OTG_DATA_ROOT);
  const resolved = path.resolve(filePath);
  const relative = path.relative(dataRoot, resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRealTrainedArtifactCandidate(item: unknown): item is Record<string, unknown> & { modelPath?: string; indexPath?: string } {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const artifact = item as Record<string, unknown>;
  return (
    artifact.adapter === "applio_real_training" ||
    artifact.mode === "real" ||
    artifact.mock === false ||
    artifact.status === "trained"
  );
}

function validateCharacterVoiceProfileArtifactFiles(profile: CharacterVoiceProfile): void {
  const candidates: Array<{ label: string; modelPath?: string; indexPath?: string }> = [];
  if (
    profile.status === "trained" ||
    profile.trainingAdapter === "applio_real_training" ||
    profile.trainingMock === false
  ) {
    candidates.push({ label: "characterVoiceProfile", modelPath: profile.modelPath, indexPath: profile.indexPath });
  }
  if (Array.isArray(profile.voiceModelArtifacts)) {
    for (const artifact of profile.voiceModelArtifacts) {
      if (isRealTrainedArtifactCandidate(artifact)) {
        candidates.push({
          label: `voiceModelArtifacts.${String(artifact.id || artifact.sourceJobId || "artifact")}`,
          modelPath: artifact.modelPath,
          indexPath: artifact.indexPath,
        });
      }
    }
  }

  for (const candidate of candidates) {
    if (!hasBytes(candidate.modelPath)) {
      throw new Error(`Cannot persist trained Applio voice profile: ${candidate.label}.modelPath is missing or empty.`);
    }
    if (!hasBytes(candidate.indexPath)) {
      throw new Error(`Cannot persist trained Applio voice profile: ${candidate.label}.indexPath is missing or empty.`);
    }
  }
}

export function listCharacters(ownerKey: string): CharacterRecord[] {
  const root = charactersRoot(ownerKey);
  const entries = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : [];
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => readJsonSafe<CharacterRecord | null>(path.join(root, entry.name), null))
    .filter((record): record is CharacterRecord => !!record && !!record.id && !!record.name)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

export function loadCharacter(ownerKey: string, characterId: string): CharacterRecord | null {
  return readJsonSafe<CharacterRecord | null>(characterFile(ownerKey, characterId), null);
}

export function createCharacter(ownerKey: string, input: CreateCharacterInput): CharacterRecord {
  const next = normalizeRecord(input, null);
  if (!next.imagePath) throw new Error("Character imagePath is required.");
  const filePath = characterFile(ownerKey, next.id);
  if (fs.existsSync(filePath)) {
    throw new Error("Character already exists. Characters are immutable after creation; delete and recreate instead.");
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function updateCharacterVoiceSelection(
  ownerKey: string,
  characterId: string,
  input: UpdateCharacterVoiceSelectionInput,
): CharacterRecord | null {
  const filePath = characterFile(ownerKey, characterId);
  const existing = readJsonSafe<CharacterRecord | null>(filePath, null);
  if (!existing) return null;

  const referenceAudioPath = String(input.referenceAudioPath || "").trim();
  if (!referenceAudioPath) {
    throw new Error("Character referenceAudioPath is required.");
  }
  if (!isInsideDataRoot(referenceAudioPath)) {
    throw new Error("Character reference audio must be inside the OTG data folder.");
  }
  if (!hasBytes(referenceAudioPath)) {
    throw new Error("Character reference audio is missing or empty.");
  }

  const next: CharacterRecord = {
    ...existing,
    referenceAudioPath,
    characterStatus: "complete",
    voiceStatus: "ready",
    hasCustomVoice: true,
    voiceSettings:
      input.voiceSettings && typeof input.voiceSettings === "object" && !Array.isArray(input.voiceSettings)
        ? input.voiceSettings
        : existing.voiceSettings,
    voiceEngineUsed: input.voiceEngineUsed
      ? String(input.voiceEngineUsed).trim()
      : existing.voiceEngineUsed,
    voiceStyleDefinition: input.voiceStyleDefinition !== undefined
      ? String(input.voiceStyleDefinition || "").trim()
      : existing.voiceStyleDefinition,
    metadata: {
      ...(existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
      ...(input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : {}),
    },
    updatedAt: nextUpdatedAt(existing.updatedAt),
  };

  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function updateCharacterVoiceProfile(
  ownerKey: string,
  characterId: string,
  characterVoiceProfile: CharacterVoiceProfile
): CharacterRecord | null {
  const filePath = characterFile(ownerKey, characterId);
  const existing = readJsonSafe<CharacterRecord | null>(filePath, null);
  if (!existing) return null;
  validateCharacterVoiceProfileArtifactFiles(characterVoiceProfile);

  const next: CharacterRecord = {
    ...existing,
    characterVoiceProfile,
    updatedAt: nextUpdatedAt(existing.updatedAt),
  };
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function deleteCharacter(ownerKey: string, characterId: string): { deleted: boolean; removedFiles: string[] } {
  const filePath = characterFile(ownerKey, characterId);
  const removedFiles: string[] = [];
  let deleted = false;

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    deleted = true;
    removedFiles.push(filePath);
  }

  // NOTE: We intentionally do NOT unlink imagePath, referenceAudioPath, or any other
  // referenced asset.  createCharacter() only persists file paths by reference — it does
  // not copy assets into an explicitly character-owned directory — so being inside
  // OTG_DATA_ROOT is NOT proof of exclusive ownership.  Deleting those files would risk
  // destroying shared resources (generations, voice models, gallery media) owned by the
  // same user/device or another entity entirely.

  return { deleted, removedFiles };
}
