import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ensureDir, OTG_DATA_ROOT } from "@/lib/paths";
import {
  getWorkerCatalogEntry,
  validateWorkerLifecycleRequest,
  type WorkerLifecycleAction,
  type WorkerPlatform,
} from "@/lib/workers/workerCatalog";

export type WorkerLifecycleCommandStatus = "queued" | "claimed" | "running" | "complete" | "failed" | "expired";

export type WorkerLifecycleCommand = {
  id: string;
  workerId: string;
  action: WorkerLifecycleAction;
  status: WorkerLifecycleCommandStatus;
  requestedBy: string;
  requestedAt: string;
  claimedByAgentId: string | null;
  claimedAt: string | null;
  heartbeatAt: string | null;
  leaseExpiresAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  error: string | null;
  dryRun: boolean;
  reason: string | null;
  jobId?: string | null;
  leaseSeconds?: number | null;
  result?: unknown;
};

type WorkerLifecycleStoreFile = {
  version: 1;
  commands: WorkerLifecycleCommand[];
};

type EnqueueWorkerLifecycleCommandInput = {
  workerId: string;
  action: WorkerLifecycleAction;
  requestedBy: string;
  dryRun?: boolean;
  reason?: string | null;
  jobId?: string | null;
  leaseSeconds?: number | null;
};

type ClaimWorkerLifecycleCommandInput = {
  agentId: string;
  platform: WorkerPlatform;
  capabilities: string[];
  leaseSeconds?: number;
};

const DEFAULT_COMMAND_LEASE_SECONDS = 60;
const MAX_RECENT_COMMANDS = 100;
let lifecycleStorePathOverrideForTests: string | null = null;

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function addSecondsIso(base: Date, seconds: number): string {
  return new Date(base.getTime() + Math.max(1, seconds) * 1000).toISOString();
}

function parseTime(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function storeDir(): string {
  const configured = cleanString(process.env.OTG_WORKER_CONTROL_STORE_DIR);
  return configured ? path.resolve(configured) : path.join(OTG_DATA_ROOT, "worker-control");
}

export function getWorkerLifecycleStorePath(): string {
  return lifecycleStorePathOverrideForTests || path.join(storeDir(), "lifecycle-commands.json");
}

export function setWorkerLifecycleStorePathForTests(filePath: string | null): void {
  lifecycleStorePathOverrideForTests = filePath;
}

function emptyStore(): WorkerLifecycleStoreFile {
  return { version: 1, commands: [] };
}

function isLifecycleCommand(value: unknown): value is WorkerLifecycleCommand {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.workerId === "string" &&
    typeof value.action === "string" &&
    ["queued", "claimed", "running", "complete", "failed", "expired"].includes(String(value.status)) &&
    typeof value.requestedBy === "string" &&
    typeof value.requestedAt === "string"
  );
}

function normalizeStore(value: unknown): WorkerLifecycleStoreFile {
  if (!isRecord(value) || !Array.isArray(value.commands)) return emptyStore();
  return { version: 1, commands: value.commands.filter(isLifecycleCommand) };
}

function readStore(): WorkerLifecycleStoreFile {
  const filePath = getWorkerLifecycleStorePath();
  try {
    if (!fs.existsSync(filePath)) return emptyStore();
    return normalizeStore(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return emptyStore();
  }
}

function writeStore(store: WorkerLifecycleStoreFile): void {
  const filePath = getWorkerLifecycleStorePath();
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
}

function commandExpired(command: WorkerLifecycleCommand, now = new Date()): boolean {
  if (command.status !== "claimed" && command.status !== "running") return false;
  const expiresAt = parseTime(command.leaseExpiresAt);
  return expiresAt !== null && expiresAt <= now.getTime();
}

function expireStaleCommandsInStore(store: WorkerLifecycleStoreFile, now = new Date()): boolean {
  let changed = false;
  store.commands = store.commands.map((command) => {
    if (!commandExpired(command, now)) return command;
    changed = true;
    return {
      ...command,
      status: "expired",
      error: "Worker lifecycle command lease expired.",
      failedAt: now.toISOString(),
      leaseExpiresAt: null,
    };
  });
  return changed;
}

function createCommandId(): string {
  return `wlc_${Date.now().toString(36)}_${crypto.randomBytes(8).toString("hex")}`;
}

function sanitizeError(value: unknown): string {
  const text = cleanString(value) || "Worker lifecycle command failed.";
  return text.replace(/bearer\s+[a-z0-9._~+/=-]+/gi, "Bearer [masked]").slice(0, 1000);
}

export function expireStaleLifecycleCommands(): WorkerLifecycleCommand[] {
  const store = readStore();
  if (expireStaleCommandsInStore(store)) writeStore(store);
  return store.commands.map((command) => ({ ...command }));
}

export function listRecentLifecycleCommands(limit = MAX_RECENT_COMMANDS): WorkerLifecycleCommand[] {
  const store = readStore();
  if (expireStaleCommandsInStore(store)) writeStore(store);
  return [...store.commands]
    .sort((a, b) => (parseTime(b.requestedAt) || 0) - (parseTime(a.requestedAt) || 0))
    .slice(0, Math.max(1, Math.min(MAX_RECENT_COMMANDS, Math.floor(limit))))
    .map((command) => ({ ...command }));
}

export function enqueueWorkerLifecycleCommand(input: EnqueueWorkerLifecycleCommandInput): { ok: true; command: WorkerLifecycleCommand } | { ok: false; error: string } {
  const validation = validateWorkerLifecycleRequest(input.workerId, input.action);
  if (!validation.ok) return validation;
  const requestedBy = cleanString(input.requestedBy) || "system";
  const entry = validation.entry;
  const timestamp = nowIso();
  const command: WorkerLifecycleCommand = {
    id: createCommandId(),
    workerId: entry.id,
    action: validation.action,
    status: "queued",
    requestedBy,
    requestedAt: timestamp,
    claimedByAgentId: null,
    claimedAt: null,
    heartbeatAt: null,
    leaseExpiresAt: null,
    completedAt: null,
    failedAt: null,
    error: null,
    dryRun: input.dryRun !== false || entry.dryRunOnly,
    reason: cleanString(input.reason) || null,
    jobId: cleanString(input.jobId) || null,
    leaseSeconds: Number.isFinite(Number(input.leaseSeconds)) && Number(input.leaseSeconds) > 0 ? Math.floor(Number(input.leaseSeconds)) : null,
  };

  const store = readStore();
  if (expireStaleCommandsInStore(store)) {
    // Continue with updated store.
  }
  store.commands.unshift(command);
  store.commands = store.commands.slice(0, 500);
  writeStore(store);
  return { ok: true, command: { ...command } };
}

export function claimWorkerLifecycleCommand(input: ClaimWorkerLifecycleCommandInput): WorkerLifecycleCommand | null {
  const agentId = cleanString(input.agentId);
  const capabilities = new Set((input.capabilities || []).map(cleanString).filter(Boolean));
  if (!agentId || capabilities.size === 0) return null;

  const store = readStore();
  const now = new Date();
  expireStaleCommandsInStore(store, now);
  const index = store.commands.findIndex((command) => {
    if (command.status !== "queued") return false;
    if (!capabilities.has(command.workerId)) return false;
    const entry = getWorkerCatalogEntry(command.workerId);
    return !!entry && entry.enabled && entry.platform === input.platform;
  });
  if (index < 0) {
    writeStore(store);
    return null;
  }

  const leaseSeconds = store.commands[index].leaseSeconds || input.leaseSeconds || DEFAULT_COMMAND_LEASE_SECONDS;
  const timestamp = now.toISOString();
  store.commands[index] = {
    ...store.commands[index],
    status: "claimed",
    claimedByAgentId: agentId,
    claimedAt: timestamp,
    heartbeatAt: timestamp,
    leaseExpiresAt: addSecondsIso(now, leaseSeconds),
    leaseSeconds,
  };
  writeStore(store);
  return { ...store.commands[index] };
}

export function heartbeatWorkerLifecycleCommand(commandId: string, agentId: string, leaseSeconds = DEFAULT_COMMAND_LEASE_SECONDS): WorkerLifecycleCommand | null {
  const store = readStore();
  const now = new Date();
  expireStaleCommandsInStore(store, now);
  const index = store.commands.findIndex((command) => command.id === cleanString(commandId) && command.claimedByAgentId === cleanString(agentId));
  if (index < 0) {
    writeStore(store);
    return null;
  }
  store.commands[index] = {
    ...store.commands[index],
    status: store.commands[index].status === "claimed" ? "running" : store.commands[index].status,
    heartbeatAt: now.toISOString(),
    leaseExpiresAt: addSecondsIso(now, leaseSeconds),
  };
  writeStore(store);
  return { ...store.commands[index] };
}

export function completeWorkerLifecycleCommand(commandId: string, agentId: string, result?: unknown): WorkerLifecycleCommand | null {
  const store = readStore();
  const now = nowIso();
  const index = store.commands.findIndex((command) => command.id === cleanString(commandId) && command.claimedByAgentId === cleanString(agentId));
  if (index < 0) return null;
  store.commands[index] = {
    ...store.commands[index],
    status: "complete",
    completedAt: now,
    heartbeatAt: now,
    leaseExpiresAt: null,
    result: isRecord(result) ? result : undefined,
  };
  writeStore(store);
  return { ...store.commands[index] };
}

export function failWorkerLifecycleCommand(commandId: string, agentId: string, error: unknown, result?: unknown): WorkerLifecycleCommand | null {
  const store = readStore();
  const now = nowIso();
  const index = store.commands.findIndex((command) => command.id === cleanString(commandId) && command.claimedByAgentId === cleanString(agentId));
  if (index < 0) return null;
  store.commands[index] = {
    ...store.commands[index],
    status: "failed",
    failedAt: now,
    heartbeatAt: now,
    leaseExpiresAt: null,
    error: sanitizeError(error),
    result: isRecord(result) ? result : undefined,
  };
  writeStore(store);
  return { ...store.commands[index] };
}

export function clearWorkerLifecycleCommandsForTests(): void {
  writeStore(emptyStore());
}
