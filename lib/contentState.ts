import path from "node:path";
import { OTG_DATA_ROOT, ensureDir, readJsonSafe, writeJsonSafe } from "@/lib/paths";

export type ContentStateStatus = "idle" | "running" | "done" | "error";

export type ContentState = {
  status?: ContentStateStatus;
  fileName?: string | null;
  kind?: "image" | "video" | null;
  deviceId?: string | null;
  workflowId?: string | null;
  workflowTitle?: string | null;
  promptId?: string | null;
  positivePrompt?: string | null;
  negativePrompt?: string | null;
  submitPayload?: any | null;
  favorited?: boolean;
  lastSyncedPromptId?: string | null;
  updatedAt?: number | null;
  startedAt?: number | null;
  readyAt?: number | null;
  error?: string | null;
};

const STATE_DIR = path.join(OTG_DATA_ROOT, "content_state");

export function statePath(ownerKey: string) {
  return path.join(STATE_DIR, `${ownerKey}.json`);
}

export function readState(ownerKey: string): ContentState {
  return readJsonSafe<ContentState>(statePath(ownerKey), {
    status: "idle",
    fileName: null,
    kind: null,
    deviceId: null,
    workflowId: null,
    workflowTitle: null,
    promptId: null,
    positivePrompt: null,
    negativePrompt: null,
    submitPayload: null,
    favorited: false,
    lastSyncedPromptId: null,
    startedAt: null,
    readyAt: null,
    updatedAt: null,
    error: null,
  });
}

export function writeState(ownerKey: string, patch: Partial<ContentState>) {
  const cur = readState(ownerKey);
  const next: ContentState = {
    ...cur,
    ...patch,
    updatedAt: Date.now(),
  };
  ensureDir(path.dirname(statePath(ownerKey)));
  writeJsonSafe(statePath(ownerKey), next);
  return next;
}

export function resetState(ownerKey: string) {
  return writeState(ownerKey, {
    status: "idle",
    fileName: null,
    kind: null,
    promptId: null,
    positivePrompt: null,
    negativePrompt: null,
    submitPayload: null,
    favorited: false,
    lastSyncedPromptId: null,
    startedAt: null,
    readyAt: null,
    error: null,
  });
}

export function markRunning(
  ownerKey: string,
  meta?: {
    title?: string | null;
    workflowId?: string | null;
    deviceId?: string | null;
    promptId?: string | null;
    positivePrompt?: string | null;
    negativePrompt?: string | null;
    submitPayload?: any | null;
  },
) {
  const now = Date.now();

  return writeState(ownerKey, {
    status: "running",
    startedAt: now,
    workflowId: meta?.workflowId ?? null,
    deviceId: meta?.deviceId ?? null,
    workflowTitle: meta?.title ?? null,
    promptId: meta?.promptId ?? null,
    positivePrompt: meta?.positivePrompt ?? null,
    negativePrompt: meta?.negativePrompt ?? null,
    submitPayload: meta?.submitPayload ?? null,
    fileName: null,
    kind: null,
    error: null,
    readyAt: null,
    lastSyncedPromptId: null,
  });
}

export function markReady(ownerKey: string, fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  const kind = [".mp4", ".webm", ".mov", ".mkv"].includes(ext) ? "video" : "image";
  return writeState(ownerKey, {
    status: "done",
    fileName,
    kind,
    readyAt: Date.now(),
    error: null,
  });
}

export function markError(ownerKey: string, message: string) {
  return writeState(ownerKey, {
    status: "error",
    error: message || "Unknown error",
  });
}
