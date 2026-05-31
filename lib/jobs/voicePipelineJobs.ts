import {
  isApplioTrainingQualityPreset,
  type VoiceFxPreset,
  type VoiceGeneratorProvider,
} from "@/lib/characterVoiceAudioStudio";
import { ensureDir, OTG_DATA_ROOT } from "@/lib/paths";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CHARACTER_VOICE_PIPELINE_ACTIONS = [
  "create_voice_sample",
  "apply_voice_fx",
  "generate_training_dataset",
  "start_applio_training",
  "test_character_voice",
  "test_trained_voice",
  "generate_preview_video",
  "dub_preview_video",
  "save_voice_to_character",
] as const;

export const PRODUCTION_AUDIO_STUDIO_ACTIONS = [
  "dub_existing_voice",
  "add_voice_to_clip",
  "add_background_music",
  "add_sound_effect",
  "replace_voice",
  "render_audio_mix",
] as const;

const PROVIDERS = ["qwen3", "cosy"] as const satisfies readonly VoiceGeneratorProvider[];
const VOICE_FX_PRESETS = [
  "clean_dialogue",
  "monstrous",
  "angelic",
  "stutter",
  "echo",
  "electric",
  "stone_person",
  "zombie",
  "ghost",
  "radio",
  "robotic",
  "distant_voice",
  "whisper",
  "custom",
] as const satisfies readonly VoiceFxPreset[];
const TRAINING_PRESETS = ["quick", "balanced", "high_quality"] as const;

export type CharacterVoicePipelineAction = (typeof CHARACTER_VOICE_PIPELINE_ACTIONS)[number];
export type ProductionAudioStudioAction = (typeof PRODUCTION_AUDIO_STUDIO_ACTIONS)[number];
export type VoiceTrainingPreset = (typeof TRAINING_PRESETS)[number];
export type QueuedContractJobType = "character_voice_pipeline" | "production_audio_studio";
export type QueuedContractJobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export type QueuedContractJob = {
  jobId: string;
  jobType: QueuedContractJobType;
  action: CharacterVoicePipelineAction | ProductionAudioStudioAction;
  status: QueuedContractJobStatus;
  createdAt: string;
  updatedAt: string;
  characterId: string | null;
  clipId: string | null;
  input: Record<string, unknown>;
  result: unknown | null;
  error: string | null;
  progress?: number;
  message?: string | null;
};

type StoredQueuedContractJob = QueuedContractJob & {
  ownerKey: string;
};

type VoicePipelineJobStoreFile = {
  version: 1;
  jobs: StoredQueuedContractJob[];
};

export type VoicePipelineJobUpdate = {
  status?: QueuedContractJobStatus;
  progress?: number;
  message?: string | null;
  result?: unknown | null;
  error?: string | null;
};

export type JobValidationResult =
  | { ok: true; job: QueuedContractJob }
  | { ok: false; status: 400; error: string };

const STORE_FILE_NAME = "voice-pipeline-jobs.json";
let jobStorePathOverrideForTests: string | null = null;

export function getVoicePipelineJobStorePath(): string {
  return jobStorePathOverrideForTests || path.join(OTG_DATA_ROOT, STORE_FILE_NAME);
}

export function setVoicePipelineJobStorePathForTests(filePath: string | null): void {
  jobStorePathOverrideForTests = filePath;
}

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function includesString<T extends readonly string[]>(items: T, value: unknown): value is T[number] {
  return typeof value === "string" && (items as readonly string[]).includes(value);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth_limit]";
  if (value === null) return null;
  if (typeof value === "string") return value.trim().slice(0, 4000);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (!isPlainObject(value)) return undefined;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80);
    if (!safeKey) continue;
    const safeValue = sanitizeValue(item, depth + 1);
    if (safeValue !== undefined) out[safeKey] = safeValue;
  }
  return out;
}

export function sanitizeJobInput(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};
  return sanitizeValue(raw) as Record<string, unknown>;
}

function publicJob(job: StoredQueuedContractJob): QueuedContractJob {
  return {
    jobId: job.jobId,
    jobType: job.jobType,
    action: job.action,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    characterId: job.characterId,
    clipId: job.clipId,
    input: job.input,
    result: job.result,
    error: job.error,
    progress: job.progress,
    message: job.message,
  };
}

function emptyStore(): VoicePipelineJobStoreFile {
  return { version: 1, jobs: [] };
}

function isStoredJob(value: unknown): value is StoredQueuedContractJob {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.jobId === "string" &&
    includesString(["character_voice_pipeline", "production_audio_studio"] as const, value.jobType) &&
    typeof value.action === "string" &&
    includesString(["queued", "running", "completed", "failed", "canceled"] as const, value.status) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.ownerKey === "string" &&
    isPlainObject(value.input)
  );
}

function normalizeStore(raw: unknown): VoicePipelineJobStoreFile {
  if (!isPlainObject(raw) || !Array.isArray(raw.jobs)) return emptyStore();
  return {
    version: 1,
    jobs: raw.jobs.filter(isStoredJob),
  };
}

function readStore(): VoicePipelineJobStoreFile {
  const filePath = getVoicePipelineJobStorePath();
  try {
    if (!fs.existsSync(filePath)) return emptyStore();
    return normalizeStore(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return emptyStore();
  }
}

function writeStore(store: VoicePipelineJobStoreFile): void {
  const filePath = getVoicePipelineJobStorePath();
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function createJobId(jobType: QueuedContractJobType): string {
  const prefix = jobType === "character_voice_pipeline" ? "cvp" : "pas";
  const randomPart = randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${Date.now()}_${randomPart}`;
}

function createQueuedJob(input: {
  ownerKey: string;
  jobType: QueuedContractJobType;
  action: CharacterVoicePipelineAction | ProductionAudioStudioAction;
  characterId: string | null;
  clipId: string | null;
  sanitizedInput: Record<string, unknown>;
}): QueuedContractJob {
  const timestamp = new Date().toISOString();
  const job: StoredQueuedContractJob = {
    jobId: createJobId(input.jobType),
    jobType: input.jobType,
    action: input.action,
    status: "queued",
    createdAt: timestamp,
    updatedAt: timestamp,
    characterId: input.characterId,
    clipId: input.clipId,
    input: input.sanitizedInput,
    result: null,
    error: null,
    progress: 0,
    message: "Queued job accepted.",
    ownerKey: input.ownerKey,
  };
  const store = readStore();
  store.jobs.push(job);
  writeStore(store);
  return publicJob(job);
}

export function supersedePendingCreateVoiceJobs(ownerKey: string, characterId: string, exceptJobId: string): QueuedContractJob[] {
  const normalizedOwnerKey = cleanString(ownerKey);
  const normalizedCharacterId = cleanString(characterId);
  const normalizedExceptJobId = cleanString(exceptJobId);
  if (!normalizedOwnerKey || !normalizedCharacterId || !normalizedExceptJobId) return [];

  const store = readStore();
  const timestamp = new Date().toISOString();
  const superseded: QueuedContractJob[] = [];

  store.jobs = store.jobs.map((job) => {
    const shouldSupersede =
      job.ownerKey === normalizedOwnerKey &&
      job.characterId === normalizedCharacterId &&
      job.jobId !== normalizedExceptJobId &&
      job.jobType === "character_voice_pipeline" &&
      job.action === "create_voice_sample" &&
      (job.status === "queued" || job.status === "running");

    if (!shouldSupersede) return job;

    const next: StoredQueuedContractJob = {
      ...job,
      status: "canceled",
      updatedAt: timestamp,
      progress: 100,
      message: "Superseded by newer Create Voice request.",
      error: "Superseded by newer Create Voice request.",
    };
    superseded.push(publicJob(next));
    return next;
  });

  if (superseded.length) writeStore(store);
  return superseded;
}

function validateProvider(raw: Record<string, unknown>): string | null {
  if (raw.provider === undefined || raw.provider === null || raw.provider === "") return null;
  return includesString(PROVIDERS, raw.provider) ? null : "Invalid provider. Expected qwen3 or cosy.";
}

function validateVoiceFxPreset(raw: Record<string, unknown>): string | null {
  if (raw.fxPreset === undefined || raw.fxPreset === null || raw.fxPreset === "") return null;
  return includesString(VOICE_FX_PRESETS, raw.fxPreset) ? null : "Invalid voice FX preset.";
}

function validateTrainingPreset(raw: Record<string, unknown>): string | null {
  if (raw.trainingPreset === undefined || raw.trainingPreset === null || raw.trainingPreset === "") return null;
  return includesString(TRAINING_PRESETS, raw.trainingPreset) ? null : "Invalid training preset. Expected quick, balanced, or high_quality.";
}

function validatePositiveIntegerField(raw: Record<string, unknown>, fieldName: "epochs" | "saveEveryEpoch"): string | null {
  if (raw[fieldName] === undefined || raw[fieldName] === null || raw[fieldName] === "") return null;
  const value = Number(raw[fieldName]);
  return Number.isInteger(value) && value > 0 ? null : `${fieldName} must be a positive integer.`;
}

function validateApplioTrainingQuality(raw: Record<string, unknown>): string | null {
  if (raw.trainingQualityPreset !== undefined && raw.trainingQualityPreset !== null && raw.trainingQualityPreset !== "") {
    if (!isApplioTrainingQualityPreset(raw.trainingQualityPreset)) {
      return "Invalid trainingQualityPreset. Expected fast, normal, or quality.";
    }
  }
  return validatePositiveIntegerField(raw, "epochs") || validatePositiveIntegerField(raw, "saveEveryEpoch");
}

function validateTrainedVoiceTest(raw: Record<string, unknown>): string | null {
  if (!hasValue(raw.trainedModelPath) && !hasValue(raw.modelPath)) {
    return "Missing trainedModelPath for test_trained_voice.";
  }
  if (!hasValue(raw.trainedIndexPath) && !hasValue(raw.indexPath)) {
    return "Missing trainedIndexPath for test_trained_voice.";
  }
  if (!hasValue(raw.inputAudioPath)) {
    return "Missing inputAudioPath for test_trained_voice.";
  }
  if (raw.trainedArtifactMock !== false && raw.trainingMock !== false && raw.artifactMock !== false) {
    return "test_trained_voice requires a real trained artifact with mock:false.";
  }
  return null;
}

export function createCharacterVoicePipelineJob(ownerKey: string, rawInput: unknown): JobValidationResult {
  if (!isPlainObject(rawInput)) return { ok: false, status: 400, error: "Missing JSON object body." };
  const action = cleanString(rawInput.action);
  if (!action) return { ok: false, status: 400, error: "Missing action." };
  if (!includesString(CHARACTER_VOICE_PIPELINE_ACTIONS, action)) {
    return { ok: false, status: 400, error: "Unknown character voice-pipeline action." };
  }

  const characterId = cleanString(rawInput.characterId);
  if (!characterId) return { ok: false, status: 400, error: "Missing characterId." };

  const providerError = validateProvider(rawInput);
  if (providerError) return { ok: false, status: 400, error: providerError };
  if (action === "create_voice_sample" && !includesString(PROVIDERS, rawInput.provider)) {
    return { ok: false, status: 400, error: "Missing provider for create_voice_sample." };
  }

  const fxError = action === "apply_voice_fx" ? validateVoiceFxPreset(rawInput) : null;
  if (fxError) return { ok: false, status: 400, error: fxError };
  if (action === "apply_voice_fx" && !hasValue(rawInput.fxPreset)) {
    return { ok: false, status: 400, error: "Missing fxPreset for apply_voice_fx." };
  }

  const trainingError =
    action === "generate_training_dataset" || action === "start_applio_training"
      ? validateTrainingPreset(rawInput)
      : null;
  if (trainingError) return { ok: false, status: 400, error: trainingError };
  const applioTrainingQualityError = action === "start_applio_training" ? validateApplioTrainingQuality(rawInput) : null;
  if (applioTrainingQualityError) return { ok: false, status: 400, error: applioTrainingQualityError };
  if ((action === "generate_training_dataset" || action === "start_applio_training") && !hasValue(rawInput.approvedSampleUrl)) {
    return { ok: false, status: 400, error: "Missing approvedSampleUrl for training jobs." };
  }
  const trainedVoiceTestError = action === "test_trained_voice" ? validateTrainedVoiceTest(rawInput) : null;
  if (trainedVoiceTestError) return { ok: false, status: 400, error: trainedVoiceTestError };

  const job = createQueuedJob({
    ownerKey,
    jobType: "character_voice_pipeline",
    action,
    characterId,
    clipId: null,
    sanitizedInput: sanitizeJobInput(rawInput),
  });

  if (action === "create_voice_sample") {
    supersedePendingCreateVoiceJobs(ownerKey, characterId, job.jobId);
  }

  return { ok: true, job };
}

export function createProductionAudioStudioJob(ownerKey: string, rawInput: unknown): JobValidationResult {
  if (!isPlainObject(rawInput)) return { ok: false, status: 400, error: "Missing JSON object body." };
  const action = cleanString(rawInput.action);
  if (!action) return { ok: false, status: 400, error: "Missing action." };
  if (!includesString(PRODUCTION_AUDIO_STUDIO_ACTIONS, action)) {
    return { ok: false, status: 400, error: "Unknown production audio-studio action." };
  }

  const clipId = cleanString(rawInput.clipId);
  if (!clipId) return { ok: false, status: 400, error: "Missing clipId." };

  const providerError = validateProvider(rawInput);
  if (providerError) return { ok: false, status: 400, error: providerError };

  const fxError = validateVoiceFxPreset(rawInput);
  if (fxError) return { ok: false, status: 400, error: fxError };

  return {
    ok: true,
    job: createQueuedJob({
      ownerKey,
      jobType: "production_audio_studio",
      action,
      characterId: hasValue(rawInput.characterId) ? cleanString(rawInput.characterId) : null,
      clipId,
      sanitizedInput: sanitizeJobInput(rawInput),
    }),
  };
}

export function getQueuedContractJob(ownerKey: string, jobId: string): QueuedContractJob | null {
  const normalizedJobId = cleanString(jobId);
  const job = readStore().jobs.find((item) => item.jobId === normalizedJobId);
  if (!job || job.ownerKey !== ownerKey) return null;
  return publicJob(job);
}


export function findVoicePipelineJobOwnerKey(jobId: string): string | null {
  const normalizedJobId = cleanString(jobId);
  if (!normalizedJobId) return null;
  const job = readStore().jobs.find((item) => item.jobId === normalizedJobId);
  return job?.ownerKey || null;
}
export const createVoicePipelineJob = createCharacterVoicePipelineJob;
export const getVoicePipelineJob = getQueuedContractJob;

export function listVoicePipelineJobs(ownerKey: string): QueuedContractJob[] {
  return readStore().jobs
    .filter((job) => job.ownerKey === ownerKey)
    .map(publicJob);
}

export function listVoicePipelineJobsByStatus(ownerKey: string, status: QueuedContractJobStatus): QueuedContractJob[] {
  return readStore().jobs
    .filter((job) => job.ownerKey === ownerKey && job.status === status)
    .map(publicJob);
}

function sanitizeProgress(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return undefined;
  return Math.max(0, Math.min(100, numberValue));
}

export function updateVoicePipelineJob(ownerKey: string, jobId: string, patch: VoicePipelineJobUpdate): QueuedContractJob | null {
  const normalizedJobId = cleanString(jobId);
  const store = readStore();
  const index = store.jobs.findIndex((job) => job.jobId === normalizedJobId && job.ownerKey === ownerKey);
  if (index < 0) return null;

  const current = store.jobs[index];
  const progress = sanitizeProgress(patch.progress);
  const next: StoredQueuedContractJob = {
    ...current,
    status: patch.status || current.status,
    updatedAt: new Date().toISOString(),
    progress: progress === undefined ? current.progress : progress,
    message: patch.message === undefined ? current.message ?? null : patch.message,
    result: patch.result === undefined ? current.result : sanitizeValue(patch.result),
    error: patch.error === undefined ? current.error : patch.error,
  };
  if (next.status === "completed" && progress === undefined) next.progress = 100;
  if (next.status === "failed" && !next.error) next.error = "Job failed.";

  store.jobs[index] = next;
  writeStore(store);
  return publicJob(next);
}

function mergeJobResult(current: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base = current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {};
  return { ...base, ...patch };
}

export type RemoteVoicePipelineWorkerAction = "generate_training_dataset" | "start_applio_training";

function remoteWorkerActionLabel(action: RemoteVoicePipelineWorkerAction): string {
  if (action === "start_applio_training") return "Windows Applio training worker";
  return "Windows IndexTTS2 worker";
}

function remoteWorkerDefaultId(action: RemoteVoicePipelineWorkerAction): string {
  if (action === "start_applio_training") return "windows-applio-worker";
  return "windows-indextts2-worker";
}

export function claimRemoteVoicePipelineWorkerJob(
  ownerKey: string,
  workerId: string,
  action: RemoteVoicePipelineWorkerAction = "generate_training_dataset",
): QueuedContractJob | null {
  const normalizedOwnerKey = cleanString(ownerKey);
  const normalizedWorkerId = cleanString(workerId) || remoteWorkerDefaultId(action);
  if (!normalizedOwnerKey) return null;

  const store = readStore();
  const index = store.jobs.findIndex((job) =>
    job.ownerKey === normalizedOwnerKey &&
    job.jobType === "character_voice_pipeline" &&
    job.action === action &&
    job.status === "queued"
  );

  if (index < 0) return null;

  const current = store.jobs[index];
  const now = new Date().toISOString();
  const label = remoteWorkerActionLabel(action);
  const next: StoredQueuedContractJob = {
    ...current,
    status: "running",
    updatedAt: now,
    progress: Math.max(5, Number(current.progress || 0)),
    message: `Claimed by remote ${label}: ${normalizedWorkerId}.`,
    error: null,
    result: mergeJobResult(current.result, {
      remoteWorker: true,
      workerId: normalizedWorkerId,
      claimedAt: now,
      action,
      status: "claimed",
    }),
  };

  store.jobs[index] = next;
  writeStore(store);
  return publicJob(next);
}

export function claimRemoteTrainingDatasetJob(ownerKey: string, workerId: string): QueuedContractJob | null {
  return claimRemoteVoicePipelineWorkerJob(ownerKey, workerId, "generate_training_dataset");
}

export function completeRemoteTrainingDatasetJob(
  ownerKey: string,
  jobId: string,
  result: unknown,
  message?: string,
): QueuedContractJob | null {
  const normalizedMessage = cleanString(message);
  const safeResult = sanitizeValue(result);

  return updateVoicePipelineJob(ownerKey, jobId, {
    status: "completed",
    progress: 100,
    message: normalizedMessage || "Remote Windows IndexTTS2 training dataset completed.",
    result: safeResult,
    error: null,
  });
}

export function failRemoteTrainingDatasetJob(
  ownerKey: string,
  jobId: string,
  error: string,
  result?: unknown,
): QueuedContractJob | null {
  const normalizedError = cleanString(error) || "Remote Windows IndexTTS2 training dataset failed.";
  const patch: VoicePipelineJobUpdate = {
    status: "failed",
    progress: 100,
    message: normalizedError,
    error: normalizedError,
  };

  if (result !== undefined) {
    patch.result = sanitizeValue(result);
  }

  return updateVoicePipelineJob(ownerKey, jobId, patch);
}
export function stopVoicePipelineJob(ownerKey: string, jobId: string): QueuedContractJob | null {
  const current = getQueuedContractJob(ownerKey, jobId);
  if (!current) return null;
  if (current.jobType !== "character_voice_pipeline") return null;
  if (current.action !== "generate_training_dataset" && current.action !== "start_applio_training") {
    return updateVoicePipelineJob(ownerKey, jobId, {
      status: "failed",
      progress: 100,
      message: "This job type cannot be stopped from Voice Lab.",
      error: "This job type cannot be stopped from Voice Lab.",
    });
  }
  if (current.status !== "queued" && current.status !== "running") return current;

  return updateVoicePipelineJob(ownerKey, jobId, {
    status: "canceled",
    message: "Stopped by user. Click Resume to continue from the durable job state.",
    error: "Stopped by user.",
    result: mergeJobResult(current.result, {
      stoppedByUser: true,
      stoppedAt: new Date().toISOString(),
      resumeAvailable: true,
    }),
  });
}

export function resumeVoicePipelineJob(ownerKey: string, jobId: string): QueuedContractJob | null {
  const current = getQueuedContractJob(ownerKey, jobId);
  if (!current) return null;
  if (current.jobType !== "character_voice_pipeline") return null;
  if (current.action !== "generate_training_dataset" && current.action !== "start_applio_training") return current;
  if (current.status !== "canceled" && current.status !== "failed") return current;

  return updateVoicePipelineJob(ownerKey, jobId, {
    status: "queued",
    progress: Math.min(99, Math.max(0, Number(current.progress || 0))),
    message: "Resume requested. Worker will continue from the durable job state.",
    error: null,
    result: mergeJobResult(current.result, {
      resumedAt: new Date().toISOString(),
      resumeAvailable: false,
    }),
  });
}

export function clearQueuedContractJobsForTests(): void {
  const filePath = getVoicePipelineJobStorePath();
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // best-effort cleanup for tests
  }
}
