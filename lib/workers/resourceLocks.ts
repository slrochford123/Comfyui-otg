import crypto from "node:crypto";
import path from "node:path";

import Database from "better-sqlite3";

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

type AcquireResourceLockInput = {
  lockId: WorkerResourceLockId;
  ownerId: string;
  ownerType: ResourceLockOwnerType;
  workerId: string;
  resourceName?: string;
  ttlSeconds?: number;
};

type LockRow = {
  lock_id: string;
  owner_id: string;
  owner_type: string;
  worker_id: string;
  resource_name: string;
  acquired_at: string;
  heartbeat_at: string;
  expires_at: string;
  fencing_token: string;
};

const DEFAULT_LOCK_TTL_SECONDS = 10 * 60;
let resourceLockStorePathOverrideForTests: string | null = null;
let connection: any = null;
let connectionPath: string | null = null;

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function addSecondsIso(base: Date, seconds: number): string {
  return new Date(base.getTime() + Math.max(1, seconds) * 1000).toISOString();
}

function isRequiredLockId(value: unknown): value is WorkerResourceLockId {
  return typeof value === "string" && (REQUIRED_RESOURCE_LOCK_IDS as readonly string[]).includes(value);
}

function storeDir(): string {
  const configured = cleanString(process.env.OTG_WORKER_CONTROL_STORE_DIR);
  return configured ? path.resolve(configured) : path.join(OTG_DATA_ROOT, "worker-control");
}

export function getResourceLockStorePath(): string {
  return resourceLockStorePathOverrideForTests || path.join(storeDir(), "resource-locks.sqlite");
}

function closeConnection(): void {
  if (!connection) return;
  try {
    connection.close();
  } catch {
    // Best effort during test-path changes and process shutdown.
  }
  connection = null;
  connectionPath = null;
}

export function setResourceLockStorePathForTests(filePath: string | null): void {
  closeConnection();
  resourceLockStorePathOverrideForTests = filePath;
}

function db(): any {
  const filePath = getResourceLockStorePath();
  if (connection && connectionPath === filePath) return connection;
  closeConnection();
  ensureDir(path.dirname(filePath));
  const next: any = new (Database as any)(filePath);
  next.pragma("busy_timeout = 10000");
  next.pragma("synchronous = FULL");
  next.exec(`
    CREATE TABLE IF NOT EXISTS resource_locks (
      lock_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      owner_type TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      fencing_token TEXT NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS resource_locks_expires_at_idx ON resource_locks(expires_at);
  `);
  connection = next;
  connectionPath = filePath;
  return next;
}

function fromRow(row: LockRow): ResourceLock {
  return {
    lockId: row.lock_id as WorkerResourceLockId,
    ownerId: row.owner_id,
    ownerType: row.owner_type as ResourceLockOwnerType,
    workerId: row.worker_id,
    resourceName: row.resource_name,
    acquiredAt: row.acquired_at,
    heartbeatAt: row.heartbeat_at,
    expiresAt: row.expires_at,
    fencingToken: row.fencing_token,
  };
}

export function createFencingToken(): string {
  return `lock_${Date.now().toString(36)}_${crypto.randomBytes(16).toString("hex")}`;
}

export function isResourceLockExpired(lock: ResourceLock, now = new Date()): boolean {
  const parsed = Date.parse(lock.expiresAt);
  return Number.isFinite(parsed) && parsed <= now.getTime();
}

export function cleanupExpiredResourceLocks(now = new Date()): ResourceLock[] {
  const database = db();
  const cleanup = database.transaction((timestamp: string) => {
    database.prepare("DELETE FROM resource_locks WHERE expires_at <= ?").run(timestamp);
    return database.prepare("SELECT * FROM resource_locks ORDER BY lock_id").all() as LockRow[];
  });
  return cleanup(now.toISOString()).map(fromRow);
}

export function listResourceLocks(): ResourceLock[] {
  return cleanupExpiredResourceLocks();
}

export function acquireResourceLock(
  input: AcquireResourceLockInput,
): { ok: true; lock: ResourceLock } | { ok: false; error: string; existing?: ResourceLock } {
  if (!isRequiredLockId(input.lockId)) return { ok: false, error: "Unknown resource lock ID." };
  const ownerId = cleanString(input.ownerId);
  const workerId = cleanString(input.workerId);
  if (!ownerId) return { ok: false, error: "Missing lock ownerId." };
  if (!workerId) return { ok: false, error: "Missing lock workerId." };

  const database = db();
  const now = new Date();
  const timestamp = now.toISOString();
  const ttlSeconds = Number.isFinite(Number(input.ttlSeconds)) && Number(input.ttlSeconds) > 0
    ? Math.floor(Number(input.ttlSeconds))
    : DEFAULT_LOCK_TTL_SECONDS;

  const acquire = database.transaction(() => {
    // Stale removal and replacement execute under one SQLite write transaction.
    // A concurrent process cannot observe the lock as absent and insert until this
    // transaction commits; the primary key is the final exclusivity constraint.
    database.prepare("DELETE FROM resource_locks WHERE lock_id = ? AND expires_at <= ?").run(input.lockId, timestamp);
    const existingRow = database.prepare("SELECT * FROM resource_locks WHERE lock_id = ?").get(input.lockId) as LockRow | undefined;
    if (existingRow) {
      const existing = fromRow(existingRow);
      if (existing.ownerId !== ownerId) {
        return { ok: false as const, error: "Resource lock is already held by another owner.", existing };
      }
      database.prepare(`
        UPDATE resource_locks SET heartbeat_at = ?, expires_at = ?
        WHERE lock_id = ? AND owner_id = ? AND fencing_token = ?
      `).run(timestamp, addSecondsIso(now, ttlSeconds), input.lockId, ownerId, existing.fencingToken);
      const renewed = database.prepare("SELECT * FROM resource_locks WHERE lock_id = ?").get(input.lockId) as LockRow;
      return { ok: true as const, lock: fromRow(renewed) };
    }

    const fencingToken = createFencingToken();
    database.prepare(`
      INSERT INTO resource_locks (
        lock_id, owner_id, owner_type, worker_id, resource_name,
        acquired_at, heartbeat_at, expires_at, fencing_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.lockId,
      ownerId,
      input.ownerType,
      workerId,
      cleanString(input.resourceName) || input.lockId,
      timestamp,
      timestamp,
      addSecondsIso(now, ttlSeconds),
      fencingToken,
    );
    return {
      ok: true as const,
      lock: fromRow(database.prepare("SELECT * FROM resource_locks WHERE lock_id = ?").get(input.lockId) as LockRow),
    };
  });

  return acquire.immediate();
}

export function heartbeatResourceLock(
  lockId: WorkerResourceLockId,
  ownerId: string,
  fencingToken: string,
  ttlSeconds = DEFAULT_LOCK_TTL_SECONDS,
): ResourceLock | null {
  const database = db();
  const now = new Date();
  const result = database.prepare(`
    UPDATE resource_locks SET heartbeat_at = ?, expires_at = ?
    WHERE lock_id = ? AND owner_id = ? AND fencing_token = ? AND expires_at > ?
  `).run(
    now.toISOString(),
    addSecondsIso(now, ttlSeconds),
    lockId,
    cleanString(ownerId),
    cleanString(fencingToken),
    now.toISOString(),
  );
  if (result.changes !== 1) return null;
  const row = database.prepare("SELECT * FROM resource_locks WHERE lock_id = ?").get(lockId) as LockRow;
  return fromRow(row);
}

export function releaseResourceLock(lockId: WorkerResourceLockId, ownerId: string, fencingToken: string): boolean {
  const result = db().prepare(`
    DELETE FROM resource_locks WHERE lock_id = ? AND owner_id = ? AND fencing_token = ?
  `).run(lockId, cleanString(ownerId), cleanString(fencingToken));
  return result.changes === 1;
}

export function clearResourceLocksForTests(): void {
  db().prepare("DELETE FROM resource_locks").run();
}
