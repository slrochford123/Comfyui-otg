import { ensureDir, OTG_DATA_ROOT } from "@/lib/paths";
import {
  PRODUCTION_AUDIO_STUDIO_ACTIONS,
  type ProductionAudioStudioAction,
} from "@/lib/jobs/voicePipelineJobs";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type PersistedAudioStudioResult = {
  status: "mock_ready";
  action: ProductionAudioStudioAction;
  sourceJobId: string;
  updatedClipUrl?: string;
  dubbedClipUrl?: string;
  finalClipUrl?: string;
  mockResult: Record<string, unknown>;
  updatedAt: string;
};

export type ProductionAudioStudioResultItem = {
  clipId: string;
  audioStudioResult: PersistedAudioStudioResult;
  updatedAt: string;
};

type OwnerResultStore = {
  items: Record<string, ProductionAudioStudioResultItem>;
};

type ProductionAudioStudioResultsStoreFile = {
  schemaVersion: 1;
  owners: Record<string, OwnerResultStore>;
};

export type SaveProductionAudioStudioResultResult =
  | { ok: true; item: ProductionAudioStudioResultItem; items: ProductionAudioStudioResultItem[] }
  | { ok: false; status: 400; error: string };

const STORE_FILE_NAME = "production-audio-studio-results.json";
let storePathOverrideForTests: string | null = null;

export function getProductionAudioStudioResultsStorePath(): string {
  return storePathOverrideForTests || path.join(OTG_DATA_ROOT, STORE_FILE_NAME);
}

export function setProductionAudioStudioResultsStorePathForTests(filePath: string | null): void {
  storePathOverrideForTests = filePath;
}

function emptyStore(): ProductionAudioStudioResultsStoreFile {
  return { schemaVersion: 1, owners: {} };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown): string {
  return String(value || "").trim();
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

function sanitizeRecord(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return {};
  return sanitizeValue(value) as Record<string, unknown>;
}

function normalizeResult(value: unknown): PersistedAudioStudioResult | null {
  if (!isPlainObject(value)) return null;
  if (value.status !== "mock_ready") return null;
  if (!includesString(PRODUCTION_AUDIO_STUDIO_ACTIONS, value.action)) return null;

  const sourceJobId = cleanString(value.sourceJobId);
  if (!sourceJobId) return null;

  const updatedAt = cleanString(value.updatedAt) || new Date().toISOString();
  const result: PersistedAudioStudioResult = {
    status: "mock_ready",
    action: value.action,
    sourceJobId,
    mockResult: sanitizeRecord(value.mockResult),
    updatedAt,
  };

  const updatedClipUrl = cleanString(value.updatedClipUrl);
  const dubbedClipUrl = cleanString(value.dubbedClipUrl);
  const finalClipUrl = cleanString(value.finalClipUrl);
  if (updatedClipUrl) result.updatedClipUrl = updatedClipUrl;
  if (dubbedClipUrl) result.dubbedClipUrl = dubbedClipUrl;
  if (finalClipUrl) result.finalClipUrl = finalClipUrl;

  return result;
}

function isStoredItem(value: unknown): value is ProductionAudioStudioResultItem {
  if (!isPlainObject(value)) return false;
  return Boolean(cleanString(value.clipId)) && Boolean(normalizeResult(value.audioStudioResult));
}

function normalizeStore(raw: unknown): ProductionAudioStudioResultsStoreFile {
  if (!isPlainObject(raw)) return emptyStore();

  const ownersSource = isPlainObject(raw.owners) ? raw.owners : {};
  const owners: Record<string, OwnerResultStore> = {};
  for (const [ownerKey, ownerValue] of Object.entries(ownersSource)) {
    if (!isPlainObject(ownerValue) || !isPlainObject(ownerValue.items)) continue;

    const items: Record<string, ProductionAudioStudioResultItem> = {};
    for (const [clipId, itemValue] of Object.entries(ownerValue.items)) {
      if (!isStoredItem(itemValue)) continue;
      const normalizedClipId = cleanString(itemValue.clipId || clipId);
      const normalizedResult = normalizeResult(itemValue.audioStudioResult);
      if (!normalizedClipId || !normalizedResult) continue;
      items[normalizedClipId] = {
        clipId: normalizedClipId,
        audioStudioResult: normalizedResult,
        updatedAt: cleanString(itemValue.updatedAt) || normalizedResult.updatedAt,
      };
    }
    owners[ownerKey] = { items };
  }

  return { schemaVersion: 1, owners };
}

function readStore(): ProductionAudioStudioResultsStoreFile {
  const filePath = getProductionAudioStudioResultsStorePath();
  try {
    if (!fs.existsSync(filePath)) return emptyStore();
    return normalizeStore(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return emptyStore();
  }
}

function writeStore(store: ProductionAudioStudioResultsStoreFile): void {
  const filePath = getProductionAudioStudioResultsStorePath();
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function listItemsFromStore(store: ProductionAudioStudioResultsStoreFile, ownerKey: string): ProductionAudioStudioResultItem[] {
  return Object.values(store.owners[ownerKey]?.items || {}).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listProductionAudioStudioResults(ownerKey: string): ProductionAudioStudioResultItem[] {
  return listItemsFromStore(readStore(), ownerKey);
}

export function getProductionAudioStudioResult(ownerKey: string, clipId: string): ProductionAudioStudioResultItem | null {
  const normalizedClipId = cleanString(clipId);
  if (!normalizedClipId) return null;
  return readStore().owners[ownerKey]?.items[normalizedClipId] || null;
}

export function saveProductionAudioStudioResult(
  ownerKey: string,
  input: { clipId?: unknown; audioStudioResult?: unknown },
): SaveProductionAudioStudioResultResult {
  const clipId = cleanString(input.clipId);
  if (!clipId) return { ok: false, status: 400, error: "clipId is required." };

  const audioStudioResult = normalizeResult(input.audioStudioResult);
  if (!audioStudioResult) return { ok: false, status: 400, error: "Valid audioStudioResult is required." };

  const updatedAt = new Date().toISOString();
  const item: ProductionAudioStudioResultItem = {
    clipId,
    audioStudioResult: {
      ...audioStudioResult,
      updatedAt,
    },
    updatedAt,
  };

  const store = readStore();
  store.owners[ownerKey] ||= { items: {} };
  store.owners[ownerKey].items[clipId] = item;
  writeStore(store);

  return { ok: true, item, items: listItemsFromStore(store, ownerKey) };
}

export function clearProductionAudioStudioResultsForTests(): void {
  const filePath = getProductionAudioStudioResultsStorePath();
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Test cleanup only.
  }
}
