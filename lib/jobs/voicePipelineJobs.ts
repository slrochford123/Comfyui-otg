import {
  isApplioTrainingQualityPreset,
  type VoiceFxPreset,
  type VoiceGeneratorProvider,
} from "@/lib/characterVoiceAudioStudio";
import { CHARACTER_PREVIEW_DUB_SCRIPT } from "@/lib/characters/characterPreviewDub";
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
  "generate_character_preview",
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

export const CHARACTER_ANIMATION_PREVIEW_ACTIONS = [
  "animate_preview",
] as const;

const PROVIDERS = ["qwen3", "cosy", "ltx", "unnatural_ltx"] as const satisfies readonly VoiceGeneratorProvider[];
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
export type CharacterAnimationPreviewAction = (typeof CHARACTER_ANIMATION_PREVIEW_ACTIONS)[number];
export type VoiceTrainingPreset = (typeof TRAINING_PRESETS)[number];
export type QueuedContractJobType = "character_voice_pipeline" | "production_audio_studio" | "character_animation_preview";
export type QueuedContractJobStatus = "queued" | "running" | "interrupted" | "ready_for_review" | "completed" | "failed" | "canceled" | "terminated";

export type QueuedContractJob = {
  jobId: string;
  jobType: QueuedContractJobType;
  action: CharacterVoicePipelineAction | ProductionAudioStudioAction | CharacterAnimationPreviewAction;
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
  ownerKey?: string;
  workerId?: string | null;
  claimedAt?: string | null;
  heartbeatAt?: string | null;
  leaseExpiresAt?: string | null;
  attempt?: number;
  lastProgressAt?: string | null;
  interruptedAt?: string | null;
  resumeCount?: number;
  resumeRequestedAt?: string | null;
  resumeRequestedBy?: string | null;
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
  workerId?: string | null;
  claimedAt?: string | null;
  heartbeatAt?: string | null;
  leaseExpiresAt?: string | null;
  attempt?: number;
  lastProgressAt?: string | null;
  interruptedAt?: string | null;
  resumeCount?: number;
  resumeRequestedAt?: string | null;
  resumeRequestedBy?: string | null;
};

export type JobValidationResult =
  | { ok: true; job: QueuedContractJob }
  | { ok: false; status: 400; error: string };

const STORE_FILE_NAME = "voice-pipeline-jobs.json";
let jobStorePathOverrideForTests: string | null = null;
const DEFAULT_WORKER_LEASE_MS = 5 * 60 * 1000;

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

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function getWorkerLeaseMs(): number {
  return readPositiveIntegerEnv("OTG_WORKER_LEASE_MS", DEFAULT_WORKER_LEASE_MS);
}

function addMsIso(date: Date, ms: number): string {
  return new Date(date.getTime() + ms).toISOString();
}

function parseTime(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function compareTimeDesc(a: unknown, b: unknown): number {
  return (parseTime(b) ?? 0) - (parseTime(a) ?? 0);
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
    ownerKey: job.ownerKey,
    workerId: job.workerId ?? null,
    claimedAt: job.claimedAt ?? null,
    heartbeatAt: job.heartbeatAt ?? null,
    leaseExpiresAt: job.leaseExpiresAt ?? null,
    attempt: Number.isFinite(Number(job.attempt)) ? Number(job.attempt) : 0,
    lastProgressAt: job.lastProgressAt ?? null,
    interruptedAt: job.interruptedAt ?? null,
    resumeCount: Number.isFinite(Number(job.resumeCount)) ? Number(job.resumeCount) : 0,
    resumeRequestedAt: job.resumeRequestedAt ?? null,
    resumeRequestedBy: job.resumeRequestedBy ?? null,
  };
}

function emptyStore(): VoicePipelineJobStoreFile {
  return { version: 1, jobs: [] };
}

function isStoredJob(value: unknown): value is StoredQueuedContractJob {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.jobId === "string" &&
    includesString(["character_voice_pipeline", "production_audio_studio", "character_animation_preview"] as const, value.jobType) &&
    typeof value.action === "string" &&
    includesString(["queued", "running", "interrupted", "ready_for_review", "completed", "failed", "canceled", "terminated"] as const, value.status) &&
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

function isDurableLeasedJob(job: Pick<StoredQueuedContractJob, "jobType" | "action">): boolean {
  return (
    job.jobType === "character_voice_pipeline" &&
    (
      job.action === "generate_training_dataset" ||
      job.action === "start_applio_training" ||
      job.action === "generate_character_preview"
    )
  );
}

function numericFieldFromObject(value: unknown, field: string): number {
  if (!isPlainObject(value)) return 0;
  const numberValue = Number(value[field]);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function requestedClipCount(job: StoredQueuedContractJob): number {
  return Math.max(
    0,
    numericFieldFromObject(job.result, "requestedClipCount"),
    numericFieldFromObject(job.result, "clipCount"),
    numericFieldFromObject(job.input, "requestedClipCount"),
    numericFieldFromObject(job.input, "clipCount"),
  );
}

function generatedClipCount(job: StoredQueuedContractJob): number {
  return Math.max(
    0,
    numericFieldFromObject(job.result, "generatedClipCount"),
    numericFieldFromObject(job.result, "readyClipCount"),
  );
}

function isLocalDatasetWorkerLease(job: StoredQueuedContractJob): boolean {
  return job.action === "generate_training_dataset" && cleanString(job.workerId) === "local-voice-pipeline-worker";
}

function isLocalDatasetWorkerAllowed(): boolean {
  return String(process.env.OTG_ALLOW_LOCAL_DATASET_WORKER || "").trim() === "1" &&
    String(process.env.OTG_CONTROL_PLANE_ONLY || "").trim() !== "1";
}

export function isVoicePipelineJobLeaseStale(job: QueuedContractJob, now = new Date()): boolean {
  if (job.status !== "running") return false;
  if (!isDurableLeasedJob(job as StoredQueuedContractJob)) return false;
  const nowMs = now.getTime();
  const leaseMs = getWorkerLeaseMs();
  const leaseExpiresMs = parseTime(job.leaseExpiresAt);
  if (leaseExpiresMs !== null) return leaseExpiresMs <= nowMs;
  const heartbeatMs = parseTime(job.heartbeatAt) ?? parseTime(job.updatedAt);
  return heartbeatMs !== null && heartbeatMs + leaseMs <= nowMs;
}

function hasValidRunningWorkerLease(job: StoredQueuedContractJob, now: Date): boolean {
  if (job.status !== "running" || !isDurableLeasedJob(job)) return true;
  if (isLocalDatasetWorkerLease(job) && !isLocalDatasetWorkerAllowed()) return false;
  if (!cleanString(job.workerId) || !parseTime(job.claimedAt) || !parseTime(job.heartbeatAt)) return false;
  return !isVoicePipelineJobLeaseStale(publicJob(job), now);
}

function normalizeInvalidRunningJob(job: StoredQueuedContractJob, now: Date): StoredQueuedContractJob | null {
  if (job.status !== "running" || !isDurableLeasedJob(job) || hasValidRunningWorkerLease(job, now)) return null;

  const timestamp = now.toISOString();
  if (job.action === "generate_training_dataset" && generatedClipCount(job) <= 0) {
    const releasedFromLocalWorker = isLocalDatasetWorkerLease(job);
    return {
      ...job,
      status: "queued",
      updatedAt: timestamp,
      workerId: null,
      claimedAt: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      interruptedAt: null,
      progress: 0,
      message: releasedFromLocalWorker
        ? "Dataset job was released from local dev worker. Waiting for Windows dataset worker."
        : "Queued / waiting for Windows worker.",
      error: null,
      result: mergeJobResult(job.result, {
        generatedClipCount: 0,
        requestedClipCount: requestedClipCount(job) || numericFieldFromObject(job.input, "requestedClipCount") || 200,
        status: "queued",
        resumeAvailable: false,
        ...(releasedFromLocalWorker ? { releasedFromWorkerId: "local-voice-pipeline-worker" } : {}),
      }),
    };
  }

  const localDatasetMessage = isLocalDatasetWorkerLease(job)
    ? "Dataset job was released from local dev worker. Resume with Windows dataset worker."
    : "Worker heartbeat expired. Resume is available.";

  return {
    ...job,
    status: "interrupted",
    updatedAt: timestamp,
    workerId: null,
    claimedAt: null,
    heartbeatAt: null,
    leaseExpiresAt: null,
    interruptedAt: job.interruptedAt || timestamp,
    message: localDatasetMessage,
    result: mergeJobResult(job.result, {
      interruptedAt: job.interruptedAt || timestamp,
      resumeAvailable: true,
      status: "interrupted",
      ...(isLocalDatasetWorkerLease(job) ? { releasedFromWorkerId: "local-voice-pipeline-worker" } : {}),
    }),
  };
}

function shouldInterruptStaleJob(job: StoredQueuedContractJob, now: Date): boolean {
  if (!isVoicePipelineJobLeaseStale(publicJob(job), now)) return false;
  if (job.action === "generate_training_dataset") {
    const requested = requestedClipCount(job);
    return requested <= 0 || generatedClipCount(job) < requested;
  }
  return true;
}

function markStaleLeases(store: VoicePipelineJobStoreFile, now = new Date()): boolean {
  let changed = false;
  const timestamp = now.toISOString();
  store.jobs = store.jobs.map((job) => {
    const normalized = normalizeInvalidRunningJob(job, now);
    if (normalized) {
      changed = true;
      return normalized;
    }
    if (!shouldInterruptStaleJob(job, now)) return job;
    changed = true;
    return {
      ...job,
      status: "interrupted",
      updatedAt: timestamp,
      interruptedAt: job.interruptedAt || timestamp,
      leaseExpiresAt: null,
      message: "Worker heartbeat expired. Resume is available.",
      result: mergeJobResult(job.result, {
        interruptedAt: job.interruptedAt || timestamp,
        resumeAvailable: true,
        status: "interrupted",
      }),
    };
  });
  return changed;
}

function readStoreWithFreshLeases(): VoicePipelineJobStoreFile {
  const store = readStore();
  if (markStaleLeases(store)) writeStore(store);
  return store;
}

function createJobId(jobType: QueuedContractJobType): string {
  const prefix =
    jobType === "character_voice_pipeline"
      ? "cvp"
      : jobType === "production_audio_studio"
        ? "pas"
        : "cap";
  const randomPart = randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${Date.now()}_${randomPart}`;
}

function createQueuedJob(input: {
  ownerKey: string;
  jobType: QueuedContractJobType;
  action: CharacterVoicePipelineAction | ProductionAudioStudioAction | CharacterAnimationPreviewAction;
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

export function supersedeActiveTrainingDatasetJobs(ownerKey: string, characterId: string, exceptJobId: string): QueuedContractJob[] {
  const normalizedOwnerKey = cleanString(ownerKey);
  const normalizedCharacterId = cleanString(characterId);
  const normalizedExceptJobId = cleanString(exceptJobId);
  if (!normalizedOwnerKey || !normalizedCharacterId || !normalizedExceptJobId) return [];

  const store = readStoreWithFreshLeases();
  const timestamp = new Date().toISOString();
  const superseded: QueuedContractJob[] = [];

  store.jobs = store.jobs.map((job) => {
    const shouldSupersede =
      job.ownerKey === normalizedOwnerKey &&
      job.characterId === normalizedCharacterId &&
      job.jobId !== normalizedExceptJobId &&
      job.jobType === "character_voice_pipeline" &&
      job.action === "generate_training_dataset" &&
      (
        job.status === "queued" ||
        job.status === "running" ||
        (job.status === "interrupted" && parseTime(job.resumeRequestedAt) !== null)
      );

    if (!shouldSupersede) return job;

    const next: StoredQueuedContractJob = {
      ...job,
      status: "canceled",
      updatedAt: timestamp,
      progress: Math.min(100, Math.max(0, Number(job.progress || 0))),
      message: "Superseded by newer dataset request for this character.",
      error: "Superseded by newer dataset request for this character.",
      leaseExpiresAt: null,
      resumeRequestedAt: null,
      resumeRequestedBy: null,
      result: mergeJobResult(job.result, {
        supersededByJobId: normalizedExceptJobId,
        supersededAt: timestamp,
        resumeAvailable: false,
      }),
    };
    superseded.push(publicJob(next));
    return next;
  });

  if (superseded.length) writeStore(store);
  return superseded;
}

function validateProvider(raw: Record<string, unknown>): string | null {
  if (raw.provider === undefined || raw.provider === null || raw.provider === "") return null;
  return includesString(PROVIDERS, raw.provider) ? null : "Invalid provider. Expected qwen3, cosy, ltx, or unnatural_ltx.";
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

function hasResolvableApprovedTrainingSample(raw: Record<string, unknown>): boolean {
  if (hasValue(raw.approvedSamplePath) || hasValue(raw.tunedSamplePath) || hasValue(raw.baseSamplePath)) return true;
  return [raw.approvedSampleUrl, raw.tunedSampleUrl, raw.baseSampleUrl]
    .some((value) => typeof value === "string" && value.includes("/api/characters/voice-sample/file"));
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

function validateCharacterPreviewDub(raw: Record<string, unknown>): string | null {
  if (!hasValue(raw.sourceImagePath) && !hasValue(raw.sourceImageUrl)) {
    return "Character source image is missing. Cannot generate preview.";
  }
  if (!hasValue(raw.trainedModelPath) && !hasValue(raw.modelPath)) {
    return "Train the voice model before generating the character preview.";
  }
  if (!hasValue(raw.trainedIndexPath) && !hasValue(raw.indexPath)) {
    return "Train the voice model before generating the character preview.";
  }
  if (raw.trainedArtifactMock !== false && raw.trainingMock !== false && raw.artifactMock !== false) {
    return "Train the voice model before generating the character preview.";
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
  if ((action === "generate_training_dataset" || action === "start_applio_training") && !hasResolvableApprovedTrainingSample(rawInput)) {
    return {
      ok: false,
      status: 400,
      error: "Training jobs require a locked local voice sample. Use a created/uploaded character voice sample before training.",
    };
  }
  const trainedVoiceTestError = action === "test_trained_voice" ? validateTrainedVoiceTest(rawInput) : null;
  if (trainedVoiceTestError) return { ok: false, status: 400, error: trainedVoiceTestError };
  const characterPreviewDubError = action === "generate_character_preview" ? validateCharacterPreviewDub(rawInput) : null;
  if (characterPreviewDubError) return { ok: false, status: 400, error: characterPreviewDubError };

  const sanitizedInput = sanitizeJobInput({
    ...rawInput,
    ...(action === "generate_character_preview" ? { previewScript: CHARACTER_PREVIEW_DUB_SCRIPT } : {}),
  });

  const job = createQueuedJob({
    ownerKey,
    jobType: "character_voice_pipeline",
    action,
    characterId,
    clipId: null,
    sanitizedInput,
  });

  if (action === "create_voice_sample") {
    supersedePendingCreateVoiceJobs(ownerKey, characterId, job.jobId);
  } else if (action === "generate_training_dataset") {
    supersedeActiveTrainingDatasetJobs(ownerKey, characterId, job.jobId);
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

export function createCharacterAnimationPreviewJob(ownerKey: string, rawInput: unknown): JobValidationResult {
  if (!isPlainObject(rawInput)) return { ok: false, status: 400, error: "Missing JSON object body." };

  const characterId = cleanString(rawInput.characterId);
  if (!characterId) return { ok: false, status: 400, error: "Missing characterId." };

  const imagePath = cleanString(rawInput.imagePath);
  if (!imagePath) return { ok: false, status: 400, error: "Missing imagePath." };

  return {
    ok: true,
    job: createQueuedJob({
      ownerKey,
      jobType: "character_animation_preview",
      action: "animate_preview",
      characterId,
      clipId: null,
      sanitizedInput: {
        ...sanitizeJobInput(rawInput),
        action: "animate_preview",
        characterId,
        imagePath,
      },
    }),
  };
}

export function getQueuedContractJob(ownerKey: string, jobId: string): QueuedContractJob | null {
  const normalizedJobId = cleanString(jobId);
  const job = readStoreWithFreshLeases().jobs.find((item) => item.jobId === normalizedJobId);
  if (!job || job.ownerKey !== ownerKey) return null;
  return publicJob(job);
}


export function findVoicePipelineJobOwnerKey(jobId: string): string | null {
  const normalizedJobId = cleanString(jobId);
  if (!normalizedJobId) return null;
  const job = readStoreWithFreshLeases().jobs.find((item) => item.jobId === normalizedJobId);
  return job?.ownerKey || null;
}
export const createVoicePipelineJob = createCharacterVoicePipelineJob;
export const getVoicePipelineJob = getQueuedContractJob;

export function listVoicePipelineJobs(ownerKey: string): QueuedContractJob[] {
  return readStoreWithFreshLeases().jobs
    .filter((job) => job.ownerKey === ownerKey)
    .map(publicJob);
}
export function findLatestActiveTrainingDatasetJobForCharacter(characterId: string, preferredOwnerKey = ""): QueuedContractJob | null {
  const normalizedCharacterId = cleanString(characterId);
  const normalizedPreferredOwnerKey = cleanString(preferredOwnerKey);
  if (!normalizedCharacterId) return null;

  const terminalStatuses = new Set<QueuedContractJobStatus>(["failed", "canceled", "terminated"]);
  const store = readStoreWithFreshLeases();

  const candidates = store.jobs
    .filter((job) =>
      job.jobType === "character_voice_pipeline" &&
      job.action === "generate_training_dataset" &&
      job.characterId === normalizedCharacterId &&
      !terminalStatuses.has(job.status)
    )
    .sort((a, b) => {
      const ownerDelta =
        (b.ownerKey === normalizedPreferredOwnerKey ? 1 : 0) -
        (a.ownerKey === normalizedPreferredOwnerKey ? 1 : 0);
      if (ownerDelta !== 0) return ownerDelta;

      const bTime = Date.parse(b.updatedAt || b.createdAt || "");
      const aTime = Date.parse(a.updatedAt || a.createdAt || "");
      if (Number.isFinite(bTime) && Number.isFinite(aTime) && bTime !== aTime) {
        return bTime - aTime;
      }

      return b.jobId.localeCompare(a.jobId);
    });

  return candidates[0] ? publicJob(candidates[0]) : null;
}

export function listVoicePipelineJobsByStatus(ownerKey: string, status: QueuedContractJobStatus): QueuedContractJob[] {
  return readStoreWithFreshLeases().jobs
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
    workerId: patch.workerId === undefined ? current.workerId ?? null : patch.workerId,
    claimedAt: patch.claimedAt === undefined ? current.claimedAt ?? null : patch.claimedAt,
    heartbeatAt: patch.heartbeatAt === undefined ? current.heartbeatAt ?? null : patch.heartbeatAt,
    leaseExpiresAt: patch.leaseExpiresAt === undefined ? current.leaseExpiresAt ?? null : patch.leaseExpiresAt,
    attempt: patch.attempt === undefined ? current.attempt : patch.attempt,
    lastProgressAt: patch.lastProgressAt === undefined ? current.lastProgressAt ?? null : patch.lastProgressAt,
    interruptedAt: patch.interruptedAt === undefined ? current.interruptedAt ?? null : patch.interruptedAt,
    resumeCount: patch.resumeCount === undefined ? current.resumeCount : patch.resumeCount,
    resumeRequestedAt: patch.resumeRequestedAt === undefined ? current.resumeRequestedAt ?? null : patch.resumeRequestedAt,
    resumeRequestedBy: patch.resumeRequestedBy === undefined ? current.resumeRequestedBy ?? null : patch.resumeRequestedBy,
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

export type RemoteVoicePipelineWorkerAction = "generate_training_dataset" | "start_applio_training" | "test_trained_voice" | "generate_character_preview";
export type RemoteWorkerClaimAction = CharacterVoicePipelineAction | ProductionAudioStudioAction | CharacterAnimationPreviewAction;
export type RemoteWorkerClaimOptions = {
  providers?: readonly string[];
};

function remoteWorkerActionLabel(action: RemoteVoicePipelineWorkerAction): string {
  if (action === "start_applio_training") return "Windows Applio training worker";
  if (action === "test_trained_voice") return "Windows Applio inference worker";
  if (action === "generate_character_preview") return "Windows character preview worker";
  return "Windows IndexTTS2 worker";
}

function remoteWorkerDefaultId(action: RemoteVoicePipelineWorkerAction): string {
  if (action === "start_applio_training") return "windows-applio-worker";
  if (action === "test_trained_voice") return "windows-applio-inference-worker";
  if (action === "generate_character_preview") return "windows-character-preview-worker";
  return "windows-indextts2-worker";
}

function hasExplicitResumeRequest(job: StoredQueuedContractJob): boolean {
  const resumeMs = parseTime(job.resumeRequestedAt);
  if (resumeMs === null) return false;
  const interruptedMs = parseTime(job.interruptedAt);
  return interruptedMs === null || resumeMs > interruptedMs;
}

function isClaimableForRemoteWorker(job: StoredQueuedContractJob, jobType: QueuedContractJobType, action: RemoteWorkerClaimAction): boolean {
  if (job.jobType !== jobType || job.action !== action) return false;
  if (job.status === "queued") return true;
  return job.status === "interrupted" && isDurableLeasedJob(job) && hasExplicitResumeRequest(job);
}

function matchesClaimOptions(job: StoredQueuedContractJob, options?: RemoteWorkerClaimOptions): boolean {
  const providers = (options?.providers || []).map((item) => cleanString(item).toLowerCase()).filter(Boolean);
  if (!providers.length) return true;
  return providers.includes(cleanString(job.input?.provider).toLowerCase());
}

function claimPriority(job: StoredQueuedContractJob): number {
  if (job.status === "queued") return 0;
  if (job.status === "interrupted" && hasExplicitResumeRequest(job)) return 1;
  return 99;
}

function compareClaimCandidates(a: StoredQueuedContractJob, b: StoredQueuedContractJob): number {
  const priorityDelta = claimPriority(a) - claimPriority(b);
  if (priorityDelta !== 0) return priorityDelta;
  if (a.status === "queued" && b.status === "queued") {
    return compareTimeDesc(a.updatedAt, b.updatedAt) || compareTimeDesc(a.createdAt, b.createdAt) || a.jobId.localeCompare(b.jobId);
  }
  return compareTimeDesc(a.resumeRequestedAt || a.updatedAt, b.resumeRequestedAt || b.updatedAt) || a.jobId.localeCompare(b.jobId);
}

function findClaimCandidateIndex(
  jobs: StoredQueuedContractJob[],
  predicate: (job: StoredQueuedContractJob) => boolean,
): number {
  const candidates = jobs
    .map((job, index) => ({ job, index }))
    .filter(({ job }) => predicate(job))
    .sort((a, b) => compareClaimCandidates(a.job, b.job));
  return candidates[0]?.index ?? -1;
}

function buildClaimedJob(current: StoredQueuedContractJob, workerId: string, jobType: QueuedContractJobType, action: RemoteWorkerClaimAction, label: string): StoredQueuedContractJob {
  const now = new Date();
  const nowIso = now.toISOString();
  const leaseExpiresAt = addMsIso(now, getWorkerLeaseMs());
  const attempt = Math.max(0, Number(current.attempt || 0)) + 1;
  return {
    ...current,
    status: "running",
    updatedAt: nowIso,
    workerId,
    claimedAt: nowIso,
    heartbeatAt: nowIso,
    leaseExpiresAt,
    attempt,
    interruptedAt: null,
    resumeRequestedAt: null,
    resumeRequestedBy: null,
    progress: Math.max(5, Number(current.progress || 0)),
    message: `Claimed by remote ${label}: ${workerId}.`,
    error: null,
    result: mergeJobResult(current.result, {
      remoteWorker: true,
      workerId,
      claimedAt: nowIso,
      heartbeatAt: nowIso,
      leaseExpiresAt,
      attempt,
      jobType,
      action,
      status: "claimed",
      resumeAvailable: false,
      resumeRequestedAt: current.resumeRequestedAt || null,
    }),
  };
}

export function claimRemoteVoicePipelineWorkerJob(
  ownerKey: string,
  workerId: string,
  action: RemoteVoicePipelineWorkerAction = "generate_training_dataset",
): QueuedContractJob | null {
  return claimRemoteWorkerJob(ownerKey, workerId, "character_voice_pipeline", action);
}

export function claimRemoteWorkerJob(
  ownerKey: string,
  workerId: string,
  jobType: QueuedContractJobType,
  action: RemoteWorkerClaimAction,
  options?: RemoteWorkerClaimOptions,
): QueuedContractJob | null {
  const normalizedOwnerKey = cleanString(ownerKey);
  const normalizedWorkerId = cleanString(workerId) || (
    jobType === "character_voice_pipeline" && (
      action === "generate_training_dataset" ||
      action === "start_applio_training" ||
      action === "test_trained_voice" ||
      action === "generate_character_preview"
    )
      ? remoteWorkerDefaultId(action)
      : "windows-otg-worker"
  );
  if (!normalizedOwnerKey) return null;

  const store = readStoreWithFreshLeases();
  const index = findClaimCandidateIndex(store.jobs, (job) =>
    job.ownerKey === normalizedOwnerKey &&
    isClaimableForRemoteWorker(job, jobType, action) &&
    matchesClaimOptions(job, options)
  );

  if (index < 0) return null;

  const label = jobType === "character_voice_pipeline" && (
    action === "generate_training_dataset" ||
    action === "start_applio_training" ||
    action === "test_trained_voice" ||
    action === "generate_character_preview"
  )
    ? remoteWorkerActionLabel(action)
    : "Windows OTG worker";
  const current = store.jobs[index];
  const next = buildClaimedJob(current, normalizedWorkerId, jobType, action, label);

  store.jobs[index] = next;
  writeStore(store);
  return publicJob(next);
}

export function claimRemoteWorkerJobAcrossOwners(
  workerId: string,
  jobType: QueuedContractJobType,
  action: RemoteWorkerClaimAction,
  options?: RemoteWorkerClaimOptions,
): QueuedContractJob | null {
  const normalizedWorkerId = cleanString(workerId) || "windows-otg-worker";
  const store = readStoreWithFreshLeases();
  const index = findClaimCandidateIndex(store.jobs, (job) =>
    isClaimableForRemoteWorker(job, jobType, action) &&
    matchesClaimOptions(job, options)
  );

  if (index < 0) return null;

  const label = jobType === "character_voice_pipeline" && (
    action === "generate_training_dataset" ||
    action === "start_applio_training" ||
    action === "test_trained_voice" ||
    action === "generate_character_preview"
  )
    ? remoteWorkerActionLabel(action as RemoteVoicePipelineWorkerAction)
    : "Windows OTG worker";
  const current = store.jobs[index];
  const next = buildClaimedJob(current, normalizedWorkerId, jobType, action, label);
  next.result = mergeJobResult(next.result, { ownerKey: current.ownerKey });

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
  return updateVoicePipelineJob(ownerKey, jobId, {
    status: "ready_for_review",
    progress: 100,
    message: normalizedMessage || "Training dataset ready for review.",
    result: sanitizeValue(result),
    error: null,
    leaseExpiresAt: null,
  });
}

export function completeRemoteWorkerJob(
  ownerKey: string,
  jobId: string,
  result: unknown,
  message?: string,
): QueuedContractJob | null {
  const current = getQueuedContractJob(ownerKey, jobId);
  if (!current) return null;
  const normalizedMessage = cleanString(message);
  const safeResult = sanitizeValue(result);

  if (current.jobType === "character_voice_pipeline" && current.action === "generate_character_preview") {
    const resultObject = isPlainObject(safeResult) ? safeResult : {};
    const videoUrl = cleanString(resultObject.dubbedPreviewVideoUrl || resultObject.outputVideoUrl);
    const outputBytes = Number(resultObject.outputBytes || resultObject.dubbedPreviewVideoBytes || resultObject.videoBytes || 0);
    if (resultObject.mock !== false || !videoUrl || videoUrl.includes("/mock-assets/") || !Number.isFinite(outputBytes) || outputBytes <= 0) {
      return updateVoicePipelineJob(ownerKey, jobId, {
        status: "failed",
        progress: 100,
        message: "Character preview output validation failed.",
        result: mergeJobResult(current.result, {
          ...(isPlainObject(safeResult) ? safeResult as Record<string, unknown> : {}),
          status: "failed",
          previewAvailable: false,
        }),
        error: "Final dubbed preview video is missing or empty.",
        leaseExpiresAt: null,
      });
    }
  }

  return updateVoicePipelineJob(ownerKey, jobId, {
    status: "completed",
    progress: 100,
    message: normalizedMessage || "Remote Windows worker completed.",
    result: safeResult,
    error: null,
    leaseExpiresAt: null,
  });
}

export function checkpointRemoteWorkerJob(
  ownerKey: string,
  jobId: string,
  result: unknown,
  progress: number,
  message?: string,
): QueuedContractJob | null {
  const current = getQueuedContractJob(ownerKey, jobId);
  if (!current) return null;
  if (current.status === "terminated" || current.status === "canceled" || current.status === "completed" || current.status === "ready_for_review") {
    return current;
  }
  const resultPatch = isPlainObject(result) ? sanitizeValue(result) as Record<string, unknown> : {};
  const now = new Date();
  const nowIso = now.toISOString();
  const workerId = cleanString(resultPatch.workerId) || current.workerId || null;

  return updateVoicePipelineJob(ownerKey, jobId, {
    status: current.status === "queued" || current.status === "interrupted" ? "running" : current.status,
    progress,
    message: cleanString(message) || current.message || "Remote Windows worker checkpoint.",
    result: mergeJobResult(current.result, {
      ...resultPatch,
      status: "running",
      checkpointAt: nowIso,
      heartbeatAt: nowIso,
      leaseExpiresAt: addMsIso(now, getWorkerLeaseMs()),
    }),
    error: current.error,
    workerId,
    heartbeatAt: nowIso,
    leaseExpiresAt: addMsIso(now, getWorkerLeaseMs()),
    lastProgressAt: nowIso,
    interruptedAt: null,
  });
}

export function failRemoteTrainingDatasetJob(
  ownerKey: string,
  jobId: string,
  error: string,
  result?: unknown,
): QueuedContractJob | null {
  return failRemoteWorkerJob(ownerKey, jobId, error || "Remote Windows IndexTTS2 training dataset failed.", result);
}

export function failRemoteWorkerJob(
  ownerKey: string,
  jobId: string,
  error: string,
  result?: unknown,
): QueuedContractJob | null {
  const normalizedError = cleanString(error) || "Remote Windows worker failed.";
  const patch: VoicePipelineJobUpdate = {
    status: "failed",
    progress: 100,
    message: normalizedError,
    error: normalizedError,
    leaseExpiresAt: null,
  };

  if (result !== undefined) {
    patch.result = sanitizeValue(result);
  }

  return updateVoicePipelineJob(ownerKey, jobId, patch);
}

export function finalizeTrainingDatasetJob(ownerKey: string, jobId: string, result?: unknown): QueuedContractJob | null {
  const current = getQueuedContractJob(ownerKey, jobId);
  if (!current || current.jobType !== "character_voice_pipeline" || current.action !== "generate_training_dataset") return null;
  if (current.status !== "ready_for_review" && current.status !== "completed") return null;

  return updateVoicePipelineJob(ownerKey, jobId, {
    status: "completed",
    progress: 100,
    message: "Training dataset completed and locked to the character.",
    result: mergeJobResult(current.result, {
      ...(isPlainObject(result) ? sanitizeValue(result) as Record<string, unknown> : {}),
      status: "voice_pack_ready",
      finalizedAt: new Date().toISOString(),
    }),
    error: null,
    leaseExpiresAt: null,
  });
}

export function terminateVoicePipelineJob(ownerKey: string, jobId: string, result?: unknown): QueuedContractJob | null {
  const current = getQueuedContractJob(ownerKey, jobId);
  if (!current) return null;
  if (current.jobType !== "character_voice_pipeline") return null;
  if (current.action !== "generate_training_dataset" && current.action !== "start_applio_training" && current.action !== "test_trained_voice" && current.action !== "generate_character_preview") return current;

  return updateVoicePipelineJob(ownerKey, jobId, {
    status: "terminated",
    progress: Math.min(100, Math.max(0, Number(current.progress || 0))),
    message: "Terminated by user. Start a new dataset session to continue.",
    error: "Terminated by user.",
    result: mergeJobResult(current.result, {
      ...(isPlainObject(result) ? sanitizeValue(result) as Record<string, unknown> : {}),
      terminatedByUser: true,
      terminatedAt: new Date().toISOString(),
      resumeAvailable: false,
    }),
    leaseExpiresAt: null,
  });
}
export function stopVoicePipelineJob(ownerKey: string, jobId: string): QueuedContractJob | null {
  const current = getQueuedContractJob(ownerKey, jobId);
  if (!current) return null;
  if (current.jobType !== "character_voice_pipeline") return null;
  if (current.action !== "generate_training_dataset" && current.action !== "start_applio_training" && current.action !== "test_trained_voice" && current.action !== "generate_character_preview") {
    return updateVoicePipelineJob(ownerKey, jobId, {
      status: "failed",
      progress: 100,
      message: "This job type cannot be stopped from Voice Lab.",
      error: "This job type cannot be stopped from Voice Lab.",
    });
  }
  if (current.status !== "queued" && current.status !== "running" && current.status !== "interrupted") return current;

  return updateVoicePipelineJob(ownerKey, jobId, {
    status: "canceled",
    message: "Stopped by user. Click Resume to continue from the durable job state.",
    error: "Stopped by user.",
    result: mergeJobResult(current.result, {
      stoppedByUser: true,
      stoppedAt: new Date().toISOString(),
      resumeAvailable: true,
    }),
    leaseExpiresAt: null,
  });
}

export function resumeVoicePipelineJob(ownerKey: string, jobId: string): QueuedContractJob | null {
  const current = getQueuedContractJob(ownerKey, jobId);
  if (!current) return null;
  if (current.jobType !== "character_voice_pipeline") return null;
  if (current.action !== "generate_training_dataset" && current.action !== "start_applio_training" && current.action !== "test_trained_voice" && current.action !== "generate_character_preview") return current;
  if (current.status !== "canceled" && current.status !== "failed" && current.status !== "interrupted") return current;
  const now = new Date().toISOString();

  return updateVoicePipelineJob(ownerKey, jobId, {
    status: "queued",
    progress: Math.min(99, Math.max(0, Number(current.progress || 0))),
    message: "Resume requested. Worker will continue from the durable job state.",
    error: null,
    result: mergeJobResult(current.result, {
      resumedAt: now,
      resumeRequestedAt: now,
      resumeRequestedBy: ownerKey,
      resumeAvailable: false,
    }),
    leaseExpiresAt: null,
    heartbeatAt: null,
    interruptedAt: current.interruptedAt ?? null,
    workerId: null,
    resumeRequestedAt: now,
    resumeRequestedBy: ownerKey,
    resumeCount: Math.max(0, Number(current.resumeCount || 0)) + 1,
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
