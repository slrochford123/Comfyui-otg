import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type BackgroundImageAssetV36B = {
  displayImage: string;
  workflowImage: string;
  imagePath?: string;
  imageUrl?: string;
};

export type BackgroundAngleKeyV36B =
  | "front"
  | "left45"
  | "right45"
  | "left90"
  | "right90"
  | "back"
  | "up"
  | "down"
  | "low"
  | "high"
  | "close";

export type BackgroundRecordV36B = {
  type: "background";
  id: string;
  name: string;
  locationType: string;
  style: string;
  masterPrompt: string;
  continuityBlock: string;
  doNotChange: string[];
  establishingImage?: BackgroundImageAssetV36B;
  panoramaImage?: BackgroundImageAssetV36B;
  angleImages: Partial<Record<BackgroundAngleKeyV36B, BackgroundImageAssetV36B>>;
  displayImage?: string;
  workflowImage?: string;
  imagePath?: string;
  imageUrl?: string;
  source: "created" | "uploaded" | "manual";
  createdAt: string;
  updatedAt: string;
};

export type BackgroundRecordInputV36B = Partial<BackgroundRecordV36B> & {
  name?: unknown;
  prompt?: unknown;
};

const OTG_DATA_ROOT = path.resolve(
  process.env.OTG_DATA_ROOT ||
    process.env.OTG_DATA_DIR ||
    path.join(process.cwd(), "data"),
);

function safeSegment(value: unknown, fallback = "background") {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);

  return cleaned || fallback;
}

function safeId(value: unknown) {
  return safeSegment(value, `background-${Date.now()}-${randomUUID().slice(0, 8)}`);
}

function backgroundRoot(ownerKey: string) {
  const safeOwner = safeSegment(ownerKey || "local", "local");
  return path.join(OTG_DATA_ROOT, "backgrounds", safeOwner);
}

function backgroundJsonPath(ownerKey: string, id: string) {
  return path.join(backgroundRoot(ownerKey), `${safeSegment(id)}.json`);
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonSafe(filePath: string): BackgroundRecordV36B | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (parsed.type !== "background") return null;
    return parsed as BackgroundRecordV36B;
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath: string, value: unknown) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

function cleanString(value: unknown, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function cleanStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => cleanString(item)).filter(Boolean).slice(0, 24);
  }

  return String(value || "")
    .split(/\r?\n|,/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function normalizeImageAsset(input: any): BackgroundImageAssetV36B | undefined {
  const imagePath = cleanString(input?.imagePath || input?.path || input?.serverPath);
  const imageUrl = cleanString(input?.imageUrl || input?.url || input?.fileUrl || input?.displayImage);
  const workflowImage = cleanString(input?.workflowImage || imagePath || imageUrl);
  const displayImage = cleanString(input?.displayImage || imageUrl || imagePath);

  if (!workflowImage && !displayImage) return undefined;

  return {
    displayImage: displayImage || workflowImage,
    workflowImage: workflowImage || displayImage,
    imagePath: imagePath || undefined,
    imageUrl: imageUrl || undefined,
  };
}

function normalizeAngleImages(value: unknown): BackgroundRecordV36B["angleImages"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const source = value as Record<string, unknown>;
  const allowed: BackgroundAngleKeyV36B[] = [
    "front",
    "left45",
    "right45",
    "left90",
    "right90",
    "back",
    "up",
    "down",
    "low",
    "high",
    "close",
  ];

  const output: BackgroundRecordV36B["angleImages"] = {};

  for (const key of allowed) {
    const asset = normalizeImageAsset(source[key]);
    if (asset) output[key] = asset;
  }

  return output;
}

export function hasUsableBackgroundImageV36AO(record: Partial<BackgroundRecordV36B> | null | undefined) {
  if (!record) return false;

  if (cleanString(record.displayImage) || cleanString(record.workflowImage) || cleanString(record.imagePath) || cleanString(record.imageUrl)) {
    return true;
  }

  if (normalizeImageAsset(record.establishingImage) || normalizeImageAsset(record.panoramaImage)) {
    return true;
  }

  return Object.values(record.angleImages || {}).some((asset) => Boolean(normalizeImageAsset(asset)));
}

export function backgroundImageUrlForPath(filePath: string) {
  return `/api/file?path=${encodeURIComponent(filePath)}`;
}

export function backgroundAssetDir(ownerKey: string) {
  const dir = path.join(backgroundRoot(ownerKey), "assets");
  ensureDir(dir);
  return dir;
}

export function safeBackgroundAssetName(name: string, fallbackStem = "background") {
  const parsed = path.parse(String(name || "background.png"));
  const ext = isAllowedBackgroundImageExt(parsed.ext) ? parsed.ext.toLowerCase() : ".png";
  const stem =
    parsed.name
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 110) || safeSegment(fallbackStem, "background");

  return `${stem}${ext}`;
}

export function listBackgrounds(ownerKey: string): BackgroundRecordV36B[] {
  const dir = backgroundRoot(ownerKey);
  ensureDir(dir);

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJsonSafe(path.join(dir, name)))
    .filter((item): item is BackgroundRecordV36B => Boolean(item))
    .filter((item) => hasUsableBackgroundImageV36AO(item))
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

export function loadBackground(ownerKey: string, id: string): BackgroundRecordV36B | null {
  return readJsonSafe(backgroundJsonPath(ownerKey, id));
}

export function saveBackground(ownerKey: string, input: BackgroundRecordInputV36B): BackgroundRecordV36B {
  const now = new Date().toISOString();
  const existingId = cleanString(input.id);
  const name = cleanString(input.name, "Scene Background");
  const id = existingId ? safeId(existingId) : safeId(`${name}-${Date.now()}`);
  const previous = loadBackground(ownerKey, id);

  const directDisplayImage = cleanString(input.displayImage || input.imageUrl || input.imagePath);
  const directWorkflowImage = cleanString(input.workflowImage || input.imagePath || input.imageUrl || directDisplayImage);

  const establishingImage =
    normalizeImageAsset(input.establishingImage) ||
    (directDisplayImage
      ? normalizeImageAsset({
          displayImage: directDisplayImage,
          workflowImage: directDisplayImage,
          imagePath: input.imagePath,
          imageUrl: input.imageUrl || directDisplayImage,
        })
      : undefined) ||
    normalizeImageAsset(input) ||
    previous?.establishingImage;

  const panoramaImage =
    normalizeImageAsset(input.panoramaImage) ||
    (directWorkflowImage && directWorkflowImage !== directDisplayImage
      ? normalizeImageAsset({
          displayImage: directWorkflowImage,
          workflowImage: directWorkflowImage,
          imagePath: directWorkflowImage,
          imageUrl: directWorkflowImage,
        })
      : undefined) ||
    previous?.panoramaImage;

  const angleImages = {
    ...(previous?.angleImages || {}),
    ...normalizeAngleImages(input.angleImages),
  };

  const canonicalAngleKeys: BackgroundAngleKeyV36B[] = [
    "front",
    "left90",
    "right90",
    "back",
    "up",
    "down",
  ];

  const hasCanonicalBackgroundCard = canonicalAngleKeys.every(
    (key) => Boolean(angleImages[key]),
  );

  const displayImage =
    cleanString(input.displayImage) ||
    establishingImage?.displayImage ||
    panoramaImage?.displayImage ||
    Object.values(angleImages)[0]?.displayImage ||
    previous?.displayImage ||
    "";

  // Complete six-view Background Cards use the accepted Master as the
  // compatibility workflow image. Legacy stitched-plate records retain
  // their historical panorama-first fallback.
  const workflowImage =
    (hasCanonicalBackgroundCard
      ? establishingImage?.workflowImage
      : cleanString(input.workflowImage) || panoramaImage?.workflowImage) ||
    establishingImage?.workflowImage ||
    panoramaImage?.workflowImage ||
    Object.values(angleImages)[0]?.workflowImage ||
    previous?.workflowImage ||
    "";

  const record: BackgroundRecordV36B = {
    type: "background",
    id,
    name,
    locationType: cleanString(input.locationType, previous?.locationType || ""),
    style: cleanString(input.style, previous?.style || "cinematic realistic"),
    masterPrompt: cleanString(input.masterPrompt || input.prompt, previous?.masterPrompt || ""),
    continuityBlock: cleanString(input.continuityBlock, previous?.continuityBlock || ""),
    doNotChange: cleanStringArray(input.doNotChange || previous?.doNotChange || []),
    establishingImage,
    panoramaImage,
    angleImages,
    displayImage: displayImage || undefined,
    workflowImage: workflowImage || undefined,
    imagePath: cleanString(input.imagePath, previous?.imagePath || establishingImage?.imagePath || "") || undefined,
    imageUrl: cleanString(input.imageUrl, previous?.imageUrl || establishingImage?.imageUrl || "") || undefined,
    source: input.source === "uploaded" || input.source === "created" || input.source === "manual" ? input.source : previous?.source || "manual",
    createdAt: previous?.createdAt || cleanString(input.createdAt, now),
    updatedAt: now,
  };

  if (!hasUsableBackgroundImageV36AO(record)) {
    throw new Error("Background save rejected: at least one usable display or workflow image is required.");
  }

  writeJsonAtomic(backgroundJsonPath(ownerKey, id), record);
  return record;
}

// OTG_BACKGROUND_STABLE_ASSET_STORE_V36BPI1
// OTG_BACKGROUND_STORE_REJECT_METADATA_ONLY_V36AO

function localPathFromStoredReference(value: unknown) {
  const reference = cleanString(value);
  if (!reference) return "";
  if (path.isAbsolute(reference) && !reference.startsWith("/api/")) {
    return path.resolve(reference);
  }

  try {
    const parsed = new URL(reference, "http://otg.local");
    if (parsed.pathname !== "/api/file") return "";
    const requestedPath = cleanString(parsed.searchParams.get("path"));
    return requestedPath ? path.resolve(requestedPath) : "";
  } catch {
    return "";
  }
}

function recordAssetPaths(ownerKey: string, record: BackgroundRecordV36B | null) {
  if (!record) return new Set<string>();
  const assets = [
    record.imagePath,
    record.imageUrl,
    record.displayImage,
    record.workflowImage,
    record.establishingImage?.imagePath,
    record.establishingImage?.imageUrl,
    record.establishingImage?.displayImage,
    record.establishingImage?.workflowImage,
    record.panoramaImage?.imagePath,
    record.panoramaImage?.imageUrl,
    record.panoramaImage?.displayImage,
    record.panoramaImage?.workflowImage,
    ...Object.values(record.angleImages || {}).flatMap((asset) => [
      asset?.imagePath,
      asset?.imageUrl,
      asset?.displayImage,
      asset?.workflowImage,
    ]),
  ];
  const assetRoot = path.resolve(backgroundAssetDir(ownerKey));
  const output = new Set<string>();

  for (const reference of assets) {
    const candidate = localPathFromStoredReference(reference);
    if (!candidate) continue;
    const relative = path.relative(assetRoot, candidate);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      output.add(candidate);
    }
  }
  return output;
}

export function deleteBackground(ownerKey: string, id: string) {
  const filePath = backgroundJsonPath(ownerKey, id);
  const deletedRecord = readJsonSafe(filePath);
  if (!deletedRecord || !fs.existsSync(filePath)) {
    return false;
  }

  const candidateAssets = recordAssetPaths(ownerKey, deletedRecord);
  fs.unlinkSync(filePath);

  const retainedAssets = new Set(
    listBackgrounds(ownerKey).flatMap((record) => Array.from(recordAssetPaths(ownerKey, record))),
  );
  for (const candidate of candidateAssets) {
    if (retainedAssets.has(candidate) || !fs.existsSync(candidate)) continue;
    const stat = fs.lstatSync(candidate);
    if (stat.isFile() || stat.isSymbolicLink()) {
      fs.unlinkSync(candidate);
    }
  }

  return true;
}

export function backgroundUploadDir(ownerKey: string) {
  const dir = path.join(backgroundRoot(ownerKey), "uploads");
  ensureDir(dir);
  return dir;
}

export function isAllowedBackgroundImageExt(ext: string) {
  return [".png", ".jpg", ".jpeg", ".webp", ".bmp"].includes(ext.toLowerCase());
}

export function safeBackgroundUploadName(name: string) {
  const parsed = path.parse(String(name || "background.png"));
  const ext = isAllowedBackgroundImageExt(parsed.ext) ? parsed.ext.toLowerCase() : ".png";
  const stem =
    parsed.name
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 90) || "background";

  return `${Date.now()}_${stem}_${randomUUID().slice(0, 8)}${ext}`;
}

// OTG_BACKGROUND_DELETE_UNSHARED_ASSETS_V36BSEC1
