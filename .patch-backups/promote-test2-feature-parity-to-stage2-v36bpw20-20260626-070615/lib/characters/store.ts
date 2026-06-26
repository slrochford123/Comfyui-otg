import fs from "node:fs";
import path from "node:path";

import { OTG_DATA_ROOT, ensureDir, readJsonSafe, safeJoin, safeSegment } from "@/lib/paths";
import type { CharacterVoiceProfile, VoiceModelArtifact } from "@/lib/characterVoiceAudioStudio";

export type CharacterRecord = {
  id: string;
  name: string;
  imagePath: string;
  previewImagePath?: string;
  transparentImagePath?: string;
  originalSourceImagePath?: string;
  fullBodyImagePath?: string;
  characterCardPath?: string;
  description: string;
  voiceStyleDefinition: string;
  introLine: string;
  introVideoPath?: string;
  referenceAudioPath?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  voiceSettings?: Record<string, unknown>;
  characterVoiceProfile?: CharacterVoiceProfile;
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
  description: string;
  voiceStyleDefinition?: string;
  introLine?: string;
  introVideoPath?: string;
  referenceAudioPath?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  voiceSettings?: Record<string, unknown>;
  characterVoiceProfile?: CharacterVoiceProfile;
  voiceModelArtifacts?: VoiceModelArtifact[];
  voicePackPaths?: Record<string, string>;
  voiceEngineUsed?: string;
  voicePromptPresetMetadata?: Record<string, unknown>;
  yellingPresetMetadata?: Record<string, unknown>;
  globalPromptIdentityBlock?: string;
};

function charactersRoot(ownerKey: string): string {
  const dir = path.join(OTG_DATA_ROOT, "characters", safeSegment(ownerKey || "local"));
  ensureDir(dir);
  return dir;
}

function characterFile(ownerKey: string, characterId: string): string {
  return safeJoin(charactersRoot(ownerKey), `${safeSegment(characterId || "character")}.json`);
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
    description: String(input.description || "").trim(),
    voiceStyleDefinition: String(input.voiceStyleDefinition || "").trim(),
    introLine: String(input.introLine || "").trim(),
    introVideoPath: input.introVideoPath ? String(input.introVideoPath).trim() : undefined,
    referenceAudioPath: input.referenceAudioPath ? String(input.referenceAudioPath).trim() : undefined,
    source: input.source ? String(input.source).trim() : undefined,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : undefined,
    voiceSettings: input.voiceSettings && typeof input.voiceSettings === "object" ? input.voiceSettings : undefined,
    characterVoiceProfile: input.characterVoiceProfile && typeof input.characterVoiceProfile === "object" ? input.characterVoiceProfile : undefined,
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
    updatedAt: new Date().toISOString(),
  };
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function deleteCharacter(ownerKey: string, characterId: string): { deleted: boolean; removedFiles: string[] } {
  const filePath = characterFile(ownerKey, characterId);
  const existing = readJsonSafe<CharacterRecord | null>(filePath, null);
  const removedFiles: string[] = [];
  let deleted = false;

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    deleted = true;
    removedFiles.push(filePath);
  }

  const dataRoot = path.resolve(OTG_DATA_ROOT);
  for (const candidate of [
    existing?.imagePath,
    existing?.previewImagePath,
    existing?.transparentImagePath,
    existing?.originalSourceImagePath,
    existing?.fullBodyImagePath,
    existing?.characterCardPath,
    existing?.introVideoPath,
    existing?.referenceAudioPath,
  ]) {
    const target = String(candidate || "").trim();
    if (!target) continue;
    const resolved = path.resolve(target);
    const rel = path.relative(dataRoot, resolved);
    const insideDataRoot = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    if (!insideDataRoot) continue;
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        fs.unlinkSync(resolved);
        removedFiles.push(resolved);
      }
    } catch {
      // ignore cleanup failure
    }
  }

  return { deleted, removedFiles };
}
