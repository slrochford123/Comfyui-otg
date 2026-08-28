import fs from "node:fs";
import path from "node:path";

import { OTG_DATA_ROOT, ensureDir, readJsonSafe, safeJoin, safeSegment } from "@/lib/paths";

export type AssetImageReference = {
  displayImage: string;
  workflowImage: string;
};

export type AssetRecord = {
  type: "asset";
  id: string;
  name: string;
  description: string;
  defaultImage: AssetImageReference;
  perspectives: Record<string, AssetImageReference>;
  createdAt: string;
  updatedAt: string;
};

export type AssetRecordInput = Partial<AssetRecord> & {
  name?: unknown;
  displayImage?: unknown;
  workflowImage?: unknown;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function assetRoot(ownerKey: string) {
  return safeJoin(path.join(OTG_DATA_ROOT, "assets"), safeSegment(ownerKey || "local"));
}

function assetFile(ownerKey: string, assetId: string) {
  return safeJoin(assetRoot(ownerKey), `${safeSegment(assetId)}.json`);
}

function normalizeImage(value: any): AssetImageReference | null {
  if (typeof value === "string") {
    const image = clean(value);
    return image ? { displayImage: image, workflowImage: image } : null;
  }
  const displayImage = clean(value?.displayImage || value?.imageUrl || value?.workflowImage || value?.imagePath);
  const workflowImage = clean(value?.workflowImage || value?.imagePath || value?.displayImage || value?.imageUrl);
  return displayImage && workflowImage ? { displayImage, workflowImage } : null;
}

function normalizePerspectives(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, AssetImageReference> = {};
  for (const [key, rawImage] of Object.entries(value)) {
    const safeKey = safeSegment(key);
    const image = normalizeImage(rawImage);
    if (safeKey && image) output[safeKey] = image;
    if (Object.keys(output).length >= 12) break;
  }
  return output;
}

function normalizeRecord(input: AssetRecordInput, previous?: AssetRecord | null): AssetRecord {
  const now = new Date().toISOString();
  const name = clean(input.name) || previous?.name || "Untitled Asset";
  const id = safeSegment(input.id || previous?.id || `${name}-${Date.now()}`);
  const defaultImage = normalizeImage(input.defaultImage)
    || normalizeImage({ displayImage: input.displayImage, workflowImage: input.workflowImage })
    || previous?.defaultImage;
  if (!defaultImage) throw new Error("Asset default image is required.");
  return {
    type: "asset",
    id,
    name: name.slice(0, 120),
    description: clean(input.description) || previous?.description || "",
    defaultImage,
    perspectives: { ...(previous?.perspectives || {}), ...normalizePerspectives(input.perspectives) },
    createdAt: previous?.createdAt || clean(input.createdAt) || now,
    updatedAt: now,
  };
}

function writeJsonAtomic(filePath: string, value: unknown) {
  ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

export function listAssets(ownerKey: string): AssetRecord[] {
  const root = assetRoot(ownerKey);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => readJsonSafe<AssetRecord | null>(safeJoin(root, entry.name), null))
    .filter((record): record is AssetRecord => record?.type === "asset" && Boolean(record.id && record.name && record.defaultImage))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function loadAsset(ownerKey: string, assetId: string) {
  const record = readJsonSafe<AssetRecord | null>(assetFile(ownerKey, assetId), null);
  return record?.type === "asset" ? record : null;
}

export function saveAsset(ownerKey: string, input: AssetRecordInput) {
  const existing = input.id ? loadAsset(ownerKey, String(input.id)) : null;
  const record = normalizeRecord(input, existing);
  writeJsonAtomic(assetFile(ownerKey, record.id), record);
  return record;
}

export function deleteAsset(ownerKey: string, assetId: string) {
  const filePath = assetFile(ownerKey, assetId);
  const deleted = fs.existsSync(filePath);
  if (deleted) fs.unlinkSync(filePath);
  return { deleted };
}
