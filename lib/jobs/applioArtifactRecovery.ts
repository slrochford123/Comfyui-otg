import fs from "node:fs";
import path from "node:path";

import {
  buildApplioTrainingArtifactVoiceProfile,
  findUsableTrainedVoiceArtifact,
  type CharacterVoiceProfile,
} from "@/lib/characterVoiceAudioStudio";
import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { listVoicePipelineJobs } from "@/lib/jobs/voicePipelineJobs";

export type ApplioArtifactRecoverySource = "saved_profile" | "builder_profile" | "completed_job" | "artifact_file";

export type RecoveredApplioVoiceProfile = {
  profile: CharacterVoiceProfile;
  source: ApplioArtifactRecoverySource;
  message: string;
};

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function hasFileBytes(filePath: unknown): boolean {
  const clean = cleanString(filePath);
  if (!clean) return false;
  try {
    const stat = fs.statSync(clean);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function validRealTrainedProfile(profile: CharacterVoiceProfile | null | undefined): CharacterVoiceProfile | null {
  if (!profile) return null;
  const artifact = findUsableTrainedVoiceArtifact(profile);
  if (!artifact || artifact.mock !== false || artifact.adapter !== "applio_real_training") return null;
  if (!hasFileBytes(artifact.modelPath) || !hasFileBytes(artifact.indexPath)) return null;
  return profile;
}

function artifactUrl(ownerKey: string, characterId: string, jobId: string): string {
  const search = new URLSearchParams({
    owner: ownerKey,
    characterId,
    jobId,
  });
  return `/api/characters/applio-training/artifact?${search.toString()}`;
}

function artifactRoot(ownerKey: string, characterId: string): string {
  return path.join(OTG_DATA_ROOT, "characters", safeSegment(ownerKey), "applio-models", safeSegment(characterId));
}

function artifactJsonPaths(ownerKey: string, characterId: string): string[] {
  const root = artifactRoot(ownerKey, characterId);
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, "training-artifact.json"))
      .filter((filePath) => fs.existsSync(filePath))
      .sort((a, b) => {
        const aTime = fs.statSync(a).mtimeMs;
        const bTime = fs.statSync(b).mtimeMs;
        return bTime - aTime;
      });
  } catch {
    return [];
  }
}

function profileFromResult(input: {
  ownerKey: string;
  characterId: string;
  jobId: string;
  currentProfile?: CharacterVoiceProfile | null;
  result: unknown;
  jobInput?: Record<string, unknown>;
  artifactPath?: string;
}): CharacterVoiceProfile | null {
  const result =
    input.result && typeof input.result === "object" && !Array.isArray(input.result)
      ? {
          ...(input.result as Record<string, unknown>),
          artifactPath: cleanString((input.result as Record<string, unknown>).artifactPath) || input.artifactPath,
          trainingArtifactPath:
            cleanString((input.result as Record<string, unknown>).trainingArtifactPath) || input.artifactPath,
          artifactUrl:
            cleanString((input.result as Record<string, unknown>).artifactUrl) ||
            artifactUrl(input.ownerKey, input.characterId, input.jobId),
          trainingArtifactUrl:
            cleanString((input.result as Record<string, unknown>).trainingArtifactUrl) ||
            artifactUrl(input.ownerKey, input.characterId, input.jobId),
        }
      : input.result;

  const profile = buildApplioTrainingArtifactVoiceProfile({
    characterId: input.characterId,
    jobId: input.jobId,
    result,
    jobInput: input.jobInput,
    currentProfile: input.currentProfile,
    now: new Date().toISOString(),
  });
  return validRealTrainedProfile(profile);
}

export function recoverLatestTrainedApplioVoiceProfile(input: {
  ownerKey: string;
  characterId: string;
  savedProfile?: CharacterVoiceProfile | null;
  builderProfile?: CharacterVoiceProfile | null;
}): RecoveredApplioVoiceProfile | null {
  const ownerKey = cleanString(input.ownerKey);
  const characterId = safeSegment(cleanString(input.characterId));
  if (!ownerKey || !characterId) return null;

  const savedProfile = validRealTrainedProfile(input.savedProfile);
  if (savedProfile) {
    return {
      profile: savedProfile,
      source: "saved_profile",
      message: "Trained voice model loaded from saved character profile.",
    };
  }

  const builderProfile = validRealTrainedProfile(input.builderProfile);
  if (builderProfile) {
    return {
      profile: builderProfile,
      source: "builder_profile",
      message: "Trained voice model loaded from builder profile.",
    };
  }

  const latestCompletedJob = listVoicePipelineJobs(ownerKey)
    .filter((job) => job.action === "start_applio_training")
    .filter((job) => job.characterId === characterId)
    .filter((job) => job.status === "completed")
    .sort((a, b) => cleanString(b.updatedAt || b.createdAt).localeCompare(cleanString(a.updatedAt || a.createdAt)))[0];

  if (latestCompletedJob) {
    const profile = profileFromResult({
      ownerKey,
      characterId,
      jobId: latestCompletedJob.jobId,
      currentProfile: input.savedProfile || input.builderProfile || null,
      result: latestCompletedJob.result,
      jobInput: latestCompletedJob.input,
    });
    if (profile) {
      return {
        profile,
        source: "completed_job",
        message: "Recovered trained voice model from completed training job.",
      };
    }
  }

  for (const trainingArtifactPath of artifactJsonPaths(ownerKey, characterId)) {
    try {
      const artifact = JSON.parse(fs.readFileSync(trainingArtifactPath, "utf8"));
      const jobId = cleanString(artifact?.jobId) || path.basename(path.dirname(trainingArtifactPath));
      const profile = profileFromResult({
        ownerKey,
        characterId,
        jobId,
        currentProfile: input.savedProfile || input.builderProfile || null,
        result: artifact,
        artifactPath: trainingArtifactPath,
      });
      if (profile) {
        return {
          profile,
          source: "artifact_file",
          message: "Recovered trained voice model from completed training artifact.",
        };
      }
    } catch {
      // Ignore malformed artifacts and continue scanning older candidates.
    }
  }

  return null;
}
