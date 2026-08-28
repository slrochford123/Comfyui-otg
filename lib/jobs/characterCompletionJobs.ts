import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { ensureDir, OTG_DATA_ROOT } from "@/lib/paths";

export const CHARACTER_COMPLETION_ACTIONS = ["complete_character"] as const;

export type CharacterCompletionAction = (typeof CHARACTER_COMPLETION_ACTIONS)[number];
export type CharacterCompletionStatus =
  | "queued"
  | "running"
  | "interrupted"
  | "completed"
  | "failed"
  | "canceled";

export type CharacterCompletionJob = {
  jobId: string;
  ownerKey: string;
  characterId: string;
  action: CharacterCompletionAction;
  status: CharacterCompletionStatus;
  createdAt: string;
  updatedAt: string;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  progress: number;
  message: string;
  workerId: string | null;
  claimedAt: string | null;
  heartbeatAt: string | null;
  leaseExpiresAt: string | null;
  attempt: number;
};

type CharacterCompletionStore = {
  version: 1;
  jobs: CharacterCompletionJob[];
};

const STORE_FILE_NAME = "character-completion-jobs.json";
const DEFAULT_LEASE_MS = 10 * 60 * 1000;
let storePathOverrideForTests: string | null = null;

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth_limit]";
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, 16000);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeValue(item, depth + 1));
  if (!isPlainObject(value)) return undefined;

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 300)) {
    const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 160);
    if (!safeKey) continue;
    const safeValue = sanitizeValue(item, depth + 1);
    if (safeValue !== undefined) output[safeKey] = safeValue;
  }
  return output;
}

function safeObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? (sanitizeValue(value) as Record<string, unknown>) : {};
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseTime(value: unknown): number | null {
  const parsed = Date.parse(cleanString(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function leaseMs(): number {
  const configured = Number(process.env.OTG_CHARACTER_COMPLETION_LEASE_MS);
  return Number.isInteger(configured) && configured >= 60_000 ? configured : DEFAULT_LEASE_MS;
}

function leaseIso(): string {
  return new Date(Date.now() + leaseMs()).toISOString();
}

export function getCharacterCompletionStorePath(): string {
  return storePathOverrideForTests || path.join(OTG_DATA_ROOT, STORE_FILE_NAME);
}

export function setCharacterCompletionStorePathForTests(filePath: string | null): void {
  storePathOverrideForTests = filePath;
}

function emptyStore(): CharacterCompletionStore {
  return { version: 1, jobs: [] };
}

function isStatus(value: unknown): value is CharacterCompletionStatus {
  return ["queued", "running", "interrupted", "completed", "failed", "canceled"].includes(cleanString(value));
}

function isStoredJob(value: unknown): value is CharacterCompletionJob {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.jobId === "string" &&
    typeof value.ownerKey === "string" &&
    typeof value.characterId === "string" &&
    value.action === "complete_character" &&
    isStatus(value.status) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    isPlainObject(value.input)
  );
}

function normalizeStore(value: unknown): CharacterCompletionStore {
  if (!isPlainObject(value) || !Array.isArray(value.jobs)) return emptyStore();
  return {
    version: 1,
    jobs: value.jobs.filter(isStoredJob),
  };
}

function readStore(): CharacterCompletionStore {
  const filePath = getCharacterCompletionStorePath();
  try {
    if (!fs.existsSync(filePath)) return emptyStore();
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return normalizeStore(JSON.parse(raw));
  } catch {
    return emptyStore();
  }
}

function writeStore(store: CharacterCompletionStore): void {
  const filePath = getCharacterCompletionStorePath();
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function markExpiredLeases(store: CharacterCompletionStore): boolean {
  const now = Date.now();
  let changed = false;
  store.jobs = store.jobs.map((job) => {
    if (job.status !== "running") return job;
    const lease = parseTime(job.leaseExpiresAt);
    if (lease !== null && lease > now) return job;
    changed = true;
    return {
      ...job,
      status: "interrupted" as const,
      updatedAt: nowIso(),
      error: "Worker lease expired. Job is eligible for automatic resume.",
      message: "Worker lease expired. Waiting for Worker Manager to resume the character completion job.",
      workerId: null,
      claimedAt: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
    };
  });
  return changed;
}

function readFreshStore(): CharacterCompletionStore {
  const store = readStore();
  if (markExpiredLeases(store)) writeStore(store);
  return store;
}

function mergeResult(current: Record<string, unknown> | null, patch: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(current || {}),
    ...safeObject(patch),
  };
}

function activeStatus(status: CharacterCompletionStatus): boolean {
  return status === "queued" || status === "running" || status === "interrupted";
}

function publicJob(job: CharacterCompletionJob): CharacterCompletionJob {
  return JSON.parse(JSON.stringify(job)) as CharacterCompletionJob;
}

export function createCharacterCompletionJob(
  ownerKeyRaw: unknown,
  inputRaw: unknown,
): { ok: true; job: CharacterCompletionJob; reused: boolean } | { ok: false; status: 400; error: string } {
  const ownerKey = cleanString(ownerKeyRaw);
  if (!ownerKey) return { ok: false, status: 400, error: "Missing owner key." };
  if (!isPlainObject(inputRaw)) return { ok: false, status: 400, error: "Missing JSON object body." };

  const characterId = cleanString(inputRaw.characterId || inputRaw.id);
  const characterName = cleanString(inputRaw.characterName || inputRaw.name);
  const deferCharacterSave = inputRaw.deferCharacterSave === true;
  const sourceImagePath = cleanString(
    inputRaw.sourceImagePath ||
      inputRaw.fullBodyImagePath ||
      inputRaw.defaultCharacterSourceImagePath ||
      inputRaw.imagePath,
  );

  if (!characterId) return { ok: false, status: 400, error: "Missing characterId." };
  if (!characterName && !deferCharacterSave) {
    return { ok: false, status: 400, error: "Missing characterName." };
  }
  if (!sourceImagePath) return { ok: false, status: 400, error: "Missing sourceImagePath." };

  const store = readFreshStore();
  const existing = [...store.jobs]
    .reverse()
    .find((job) => job.ownerKey === ownerKey && job.characterId === characterId && activeStatus(job.status));
  if (existing) return { ok: true, job: publicJob(existing), reused: true };

  const timestamp = nowIso();
  const job: CharacterCompletionJob = {
    jobId: `ccj_${Date.now()}_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    ownerKey,
    characterId,
    action: "complete_character",
    status: "queued",
    createdAt: timestamp,
    updatedAt: timestamp,
    input: safeObject({ ...inputRaw, action: "complete_character", characterId, characterName, sourceImagePath }),
    result: null,
    error: null,
    progress: 0,
    message: "Character completion job queued for Worker Manager.",
    workerId: null,
    claimedAt: null,
    heartbeatAt: null,
    leaseExpiresAt: null,
    attempt: 0,
  };
  store.jobs.push(job);
  writeStore(store);
  return { ok: true, job: publicJob(job), reused: false };
}

export function listCharacterCompletionJobs(ownerKeyRaw: unknown, characterIdRaw?: unknown): CharacterCompletionJob[] {
  const ownerKey = cleanString(ownerKeyRaw);
  const characterId = cleanString(characterIdRaw);
  if (!ownerKey) return [];
  return readFreshStore().jobs
    .filter((job) => job.ownerKey === ownerKey && (!characterId || job.characterId === characterId))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map(publicJob);
}

export function getCharacterCompletionJob(ownerKeyRaw: unknown, jobIdRaw: unknown): CharacterCompletionJob | null {
  const ownerKey = cleanString(ownerKeyRaw);
  const jobId = cleanString(jobIdRaw);
  if (!ownerKey || !jobId) return null;
  const job = readFreshStore().jobs.find((item) => item.ownerKey === ownerKey && item.jobId === jobId);
  return job ? publicJob(job) : null;
}

export function claimCharacterCompletionJob(workerIdRaw: unknown): CharacterCompletionJob | null {
  const workerId = cleanString(workerIdRaw) || "linux-character-completion-worker";
  const store = readFreshStore();
  const index = store.jobs.findIndex((job) => job.action === "complete_character" && (job.status === "queued" || job.status === "interrupted"));
  if (index < 0) return null;

  const timestamp = nowIso();
  const current = store.jobs[index];
  const next: CharacterCompletionJob = {
    ...current,
    status: "running",
    updatedAt: timestamp,
    error: null,
    progress: Math.max(5, Number(current.progress || 0)),
    message: `Claimed by Worker Manager: ${workerId}.`,
    workerId,
    claimedAt: timestamp,
    heartbeatAt: timestamp,
    leaseExpiresAt: leaseIso(),
    attempt: Math.max(0, Number(current.attempt || 0)) + 1,
    result: mergeResult(current.result, {
      remoteWorker: true,
      workerId,
      currentStage: "claimed",
      claimedAt: timestamp,
    }),
  };
  store.jobs[index] = next;
  writeStore(store);
  return publicJob(next);
}

function updateJob(
  ownerKeyRaw: unknown,
  jobIdRaw: unknown,
  updater: (current: CharacterCompletionJob) => CharacterCompletionJob,
): CharacterCompletionJob | null {
  const ownerKey = cleanString(ownerKeyRaw);
  const jobId = cleanString(jobIdRaw);
  if (!ownerKey || !jobId) return null;
  const store = readFreshStore();
  const index = store.jobs.findIndex((job) => job.ownerKey === ownerKey && job.jobId === jobId);
  if (index < 0) return null;
  const next = updater(store.jobs[index]);
  store.jobs[index] = next;
  writeStore(store);
  return publicJob(next);
}

export function checkpointCharacterCompletionJob(
  ownerKey: unknown,
  jobId: unknown,
  progressRaw: unknown,
  messageRaw: unknown,
  resultRaw: unknown,
): CharacterCompletionJob | null {
  const progress = Math.max(1, Math.min(99, Number(progressRaw) || 1));
  const message = cleanString(messageRaw) || "Character completion worker checkpoint.";
  const resultPatch = safeObject(resultRaw);
  return updateJob(ownerKey, jobId, (current) => {
    if (current.status === "completed" || current.status === "failed" || current.status === "canceled") return current;
    const timestamp = nowIso();
    return {
      ...current,
      status: "running",
      updatedAt: timestamp,
      progress,
      message,
      error: null,
      heartbeatAt: timestamp,
      leaseExpiresAt: leaseIso(),
      result: mergeResult(current.result, {
        ...resultPatch,
        currentStage: cleanString(resultPatch.currentStage) || cleanString(current.result?.currentStage) || "running",
        checkpointAt: timestamp,
      }),
    };
  });
}

export function completeCharacterCompletionJob(
  ownerKey: unknown,
  jobId: unknown,
  resultRaw: unknown,
  messageRaw?: unknown,
): CharacterCompletionJob | null {
  const result = safeObject(resultRaw);
  const cardImagePath = cleanString(result.cardImagePath || result.characterCardPath);
  const savedCharacterId = cleanString(result.characterId || result.savedCharacterId);
  if (!cardImagePath || !savedCharacterId) return null;

  return updateJob(ownerKey, jobId, (current) => ({
    ...current,
    status: "completed",
    updatedAt: nowIso(),
    progress: 100,
    message: cleanString(messageRaw) || "Character completion finished.",
    error: null,
    heartbeatAt: null,
    leaseExpiresAt: null,
    result: mergeResult(current.result, {
      ...result,
      currentStage: "completed",
      completedAt: nowIso(),
    }),
  }));
}

export function failCharacterCompletionJob(
  ownerKey: unknown,
  jobId: unknown,
  errorRaw: unknown,
  resultRaw?: unknown,
): CharacterCompletionJob | null {
  const error = cleanString(errorRaw) || "Character completion worker failed.";
  return updateJob(ownerKey, jobId, (current) => {
    if (current.status === "completed" || current.status === "canceled") return current;
    return {
      ...current,
      status: "failed",
      updatedAt: nowIso(),
      progress: 100,
      message: error,
      error,
      heartbeatAt: null,
      leaseExpiresAt: null,
      result: mergeResult(current.result, {
        ...safeObject(resultRaw),
        currentStage: "failed",
        failedAt: nowIso(),
      }),
    };
  });
}

export function clearCharacterCompletionJobsForTests(): void {
  try {
    fs.rmSync(getCharacterCompletionStorePath(), { force: true });
  } catch {
    // best effort
  }
}


/* OTG_CHARACTER_COMPLETION_USER_CANCEL_V1 */
export function cancelCharacterCompletionJob(
  ownerKeyRaw: unknown,
  jobIdRaw: unknown,
): CharacterCompletionJob | null {
  const ownerKey = cleanString(ownerKeyRaw);
  const jobId = cleanString(jobIdRaw);
  if (!ownerKey || !jobId) return null;

  const store = readFreshStore();
  const index = store.jobs.findIndex(
    (job) => job.ownerKey === ownerKey && job.jobId === jobId,
  );
  if (index < 0) return null;

  const current = store.jobs[index];
  if (
    current.status === "completed" ||
    current.status === "failed" ||
    current.status === "canceled"
  ) {
    return publicJob(current);
  }

  const timestamp = nowIso();
  const canceled: CharacterCompletionJob = {
    ...current,
    status: "canceled",
    updatedAt: timestamp,
    message: "Character completion canceled by user.",
    error: "Character completion canceled by user.",
    workerId: null,
    claimedAt: null,
    heartbeatAt: null,
    leaseExpiresAt: null,
  };

  store.jobs[index] = canceled;
  writeStore(store);
  return publicJob(canceled);
}
