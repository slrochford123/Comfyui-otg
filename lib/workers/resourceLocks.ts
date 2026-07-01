import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ensureDir, OTG_DATA_ROOT } from "@/lib/paths";
import { REQUIRED_RESOURCE_LOCK_IDS, type WorkerResourceLockId } from "@/lib/workers/workerCatalog";

export type ResourceLockOwnerType = "lifecycle-command" | "job" | "agent" | "manual" | "system";

export type ResourceLock = {
  lockId: WorkerResourceLockId;
  ownerId: string;
  ownerType: ResourceLockOwnerType;
  workerId: string;
  resourceName: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  fencingToken: string;
};

type ResourceLockStoreFile = {
  version: 1;
  locks: ResourceLock[];
};

type AcquireResourceLockInput = {
  lockId: WorkerResourceLockId;
  ownerId: string;
  ownerType: ResourceLockOwnerType;
  workerId: string;
  resourceName?: string;
  ttlSeconds?: number;
};

const DEFAULT_LOCK_TTL_SECONDS = 10 * 60;
let resourceLockStorePathOverrideForTests: string | null = null;

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function addSecondsIso(base: Date, seconds: number): string {
  return new Date(base.getTime() + Math.max(1, seconds) * 1000).toISOString();
}

function parseTime(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRequiredLockId(value: unknown): value is WorkerResourceLockId {
  return typeof value === "string" && (REQUIRED_RESOURCE_LOCK_IDS as readonly string[]).includes(value);
}

function storeDir(): string {
  const configured = cleanString(process.env.OTG_WORKER_CONTROL_STORE_DIR);
  return configured ? path.resolve(configured) : path.join(OTG_DATA_ROOT, "worker-control");
}

export function getResourceLockStorePath(): string {
  return resourceLockStorePathOverrideForTests || path.join(storeDir(), "resource-locks.json");
}

export function setResourceLockStorePathForTests(filePath: string | null): void {
  resourceLockStorePathOverrideForTests = filePath;
}

function emptyStore(): ResourceLockStoreFile {
  return { version: 1, locks: [] };
}

function isResourceLock(value: unknown): value is ResourceLock {
  const lock = value as Partial<ResourceLock>;
  return (
    isRequiredLockId(lock?.lockId) &&
    typeof lock.ownerId === "string" &&
    typeof lock.ownerType === "string" &&
    typeof lock.workerId === "string" &&
    typeof lock.resourceName === "string" &&
    typeof lock.acquiredAt === "string" &&
    typeof lock.heartbeatAt === "string" &&
    typeof lock.expiresAt === "string" &&
    typeof lock.fencingToken === "string"
  );
}

function normalizeStore(value: unknown): ResourceLockStoreFile {
  const raw = value as Partial<ResourceLockStoreFile>;
  return { version: 1, locks: Array.isArray(raw?.locks) ? raw.locks.filter(isResourceLock) : [] };
}

function readStore(): ResourceLockStoreFile {
  const filePath = getResourceLockStorePath();
  try {
    if (!fs.existsSync(filePath)) return emptyStore();
    return normalizeStore(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return emptyStore();
  }
}

function writeStore(store: ResourceLockStoreFile): void {
  const filePath = getResourceLockStorePath();
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
}

export function createFencingToken(): string {
  return `lock_${Date.now().toString(36)}_${crypto.randomBytes(10).toString("hex")}`;
}

export function isResourceLockExpired(lock: ResourceLock, now = new Date()): boolean {
  const expiresAt = parseTime(lock.expiresAt);
  return expiresAt !== null && expiresAt <= now.getTime();
}

export function cleanupExpiredResourceLocks(now = new Date()): ResourceLock[] {
  const store = readStore();
  const before = store.locks.length;
  store.locks = store.locks.filter((lock) => !isResourceLockExpired(lock, now));
  if (store.locks.length !== before) writeStore(store);
  return store.locks;
}

export function listResourceLocks(): ResourceLock[] {
  return cleanupExpiredResourceLocks().map((lock) => ({ ...lock }));
}

export function acquireResourceLock(input: AcquireResourceLockInput): { ok: true; lock: ResourceLock } | { ok: false; error: string; existing?: ResourceLock } {
  if (!isRequiredLockId(input.lockId)) return { ok: false, error: "Unknown resource lock ID." };
  const ownerId = cleanString(input.ownerId);
  const workerId = cleanString(input.workerId);
  if (!ownerId) return { ok: false, error: "Missing lock ownerId." };
  if (!workerId) return { ok: false, error: "Missing lock workerId." };

  const store = readStore();
  const now = new Date();
  store.locks = store.locks.filter((lock) => !isResourceLockExpired(lock, now));
  const existing = store.locks.find((lock) => lock.lockId === input.lockId);
  if (existing && existing.ownerId !== ownerId) {
    return { ok: false, error: "Resource lock is already held by another owner.", existing: { ...existing } };
  }

  const timestamp = now.toISOString();
  const ttlSeconds = Number.isFinite(Number(input.ttlSeconds)) && Number(input.ttlSeconds) > 0
    ? Math.floor(Number(input.ttlSeconds))
    : DEFAULT_LOCK_TTL_SECONDS;
  const next: ResourceLock = {
    lockId: input.lockId,
    ownerId,
    ownerType: input.ownerType,
    workerId,
    resourceName: cleanString(input.resourceName) || input.lockId,
    acquiredAt: existing?.acquiredAt || timestamp,
    heartbeatAt: timestamp,
    expiresAt: addSecondsIso(now, ttlSeconds),
    fencingToken: existing?.fencingToken || createFencingToken(),
  };

  store.locks = [...store.locks.filter((lock) => lock.lockId !== input.lockId), next];
  writeStore(store);
  return { ok: true, lock: { ...next } };
}

export function heartbeatResourceLock(lockId: WorkerResourceLockId, ownerId: string, ttlSeconds = DEFAULT_LOCK_TTL_SECONDS): ResourceLock | null {
  const store = readStore();
  const now = new Date();
  store.locks = store.locks.filter((lock) => !isResourceLockExpired(lock, now));
  const index = store.locks.findIndex((lock) => lock.lockId === lockId && lock.ownerId === cleanString(ownerId));
  if (index < 0) {
    writeStore(store);
    return null;
  }
  store.locks[index] = {
    ...store.locks[index],
    heartbeatAt: now.toISOString(),
    expiresAt: addSecondsIso(now, ttlSeconds),
  };
  writeStore(store);
  return { ...store.locks[index] };
}

export function releaseResourceLock(lockId: WorkerResourceLockId, ownerId: string): boolean {
  const store = readStore();
  const before = store.locks.length;
  store.locks = store.locks.filter((lock) => !(lock.lockId === lockId && lock.ownerId === cleanString(ownerId)));
  if (store.locks.length !== before) {
    writeStore(store);
    return true;
  }
  cleanupExpiredResourceLocks();
  return false;
}

export function clearResourceLocksForTests(): void {
  writeStore(emptyStore());
}
