import fs from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { getOwnerContext } from "@/lib/ownerKey";
import {
  ensureDir,
  deviceGalleryDir,
  userGalleryDir,
  safeJoin,
} from "@/lib/paths";

export type GalleryKind = "image" | "video";
export type GalleryScope = "user" | "device";

export type GalleryMeta = {
  favorite?: boolean;
  renamedName?: string | null;
  originalName?: string | null;
  mediaCategory?: string | null;
  positivePrompt?: string | null;
  negativePrompt?: string | null;
  submitPayload?: any | null;
  sourcePromptId?: string | null;
  sourcePayloadKey?: string | null;
  sourceNodeId?: string | null;
  sourceBucket?: "images" | "videos" | "gifs" | null;
  sourceType?: string | null;
  extendedFromName?: string | null;
  extendSourceFrame?: string | null;
  extendMode?: string | null;
  requestKind?: string | null;
  extendRequestId?: string | null;
  workflowId?: string | null;
  workflowTitle?: string | null;
  audioMix?: Record<string, unknown> | null;
  audioLibrary?: Record<string, unknown> | null;
  ttsAudio?: Record<string, unknown> | null;
  voiceTts?: Record<string, unknown> | null;
  voiceDub?: Record<string, unknown> | null;
  soundEffect?: Record<string, unknown> | null;
  extractedAudio?: Record<string, unknown> | null;
  wooshSfx?: Record<string, unknown> | null;
  stitchVideo?: Record<string, unknown> | null;
  editVideo?: Record<string, unknown> | null;
  videoEdit?: Record<string, unknown> | null;
  ownerKey?: string | null;
  username?: string | null;
  deviceId?: string | null;
  importedFromPath?: string | null;
  importedFromSource?: "disk" | "view" | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  metaVersion?: number | null;
};

export type GallerySource = {
  scope: GalleryScope;
  dir: string;
  ownerKey: string;
  username: string | null;
  deviceId: string;
};

export type GalleryResolvedItem = {
  name: string;
  sourceName?: string;
  path: string;
  scope: GalleryScope;
  url: string;
  kind: GalleryKind;
  createdAt: number;
  updatedAt: number;
  meta: GalleryMeta;
};

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".mkv"]);
const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS]);

export function safeGalleryName(name: string): string {
  if (!name) return "item";

  return String(name)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "_")
    .trim()
    .slice(0, 200);
}

export function isMediaFile(name: string): boolean {
  return MEDIA_EXTS.has(path.extname(String(name || "")).toLowerCase());
}

export function isVideoFile(name: string): boolean {
  return VIDEO_EXTS.has(path.extname(String(name || "")).toLowerCase());
}

export function kindFromName(name: string): GalleryKind {
  return isVideoFile(name) ? "video" : "image";
}

export function metaPathForFile(absPath: string): string {
  return `${absPath}.meta.json`;
}

export function readMetaForFile(absPath: string): GalleryMeta {
  const metaPath = metaPathForFile(absPath);
  try {
    if (!fs.existsSync(metaPath)) return {};
    const raw = fs.readFileSync(metaPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeMetaForFile(absPath: string, patch: GalleryMeta, sourceHint?: GallerySource | null): GalleryMeta {
  const metaPath = metaPathForFile(absPath);
  const current = readMetaForFile(absPath);
  const next = normalizeGalleryMeta(absPath, current, patch, sourceHint);

  ensureDir(path.dirname(metaPath));
  fs.writeFileSync(metaPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function sanitizeMetaString(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizeGalleryMeta(
  absPath: string,
  current: GalleryMeta,
  patch: GalleryMeta = {},
  sourceHint?: GallerySource | null,
): GalleryMeta {
  const stat = fs.statSync(absPath);
  const baseName = path.basename(absPath);
  const submitPayload = patch.submitPayload !== undefined ? patch.submitPayload : current.submitPayload;
  const inferredGalleryExtend =
    sanitizeMetaString(patch.requestKind) === "gallery-extend" ||
    sanitizeMetaString(current.requestKind) === "gallery-extend" ||
    (submitPayload && typeof submitPayload === "object"
      ? sanitizeMetaString((submitPayload as any).requestKind) === "gallery-extend" ||
        !!sanitizeMetaString((submitPayload as any).extendedFromName) ||
        !!sanitizeMetaString((submitPayload as any).extendSourceFrame) ||
        !!sanitizeMetaString((submitPayload as any).extendMode)
      : false);
  const sourceType =
    sanitizeMetaString(patch.sourceType) ||
    sanitizeMetaString(current.sourceType) ||
    (submitPayload && typeof submitPayload === "object"
      ? sanitizeMetaString((submitPayload as any).sourceType)
      : null) ||
    (inferredGalleryExtend ? "gallery-extend" : null) ||
    "legacy-gallery-item";

  return {
    favorite: typeof patch.favorite === "boolean" ? patch.favorite : !!current.favorite,
    renamedName: sanitizeMetaString(patch.renamedName) || sanitizeMetaString(current.renamedName) || baseName,
    originalName: sanitizeMetaString(patch.originalName) || sanitizeMetaString(current.originalName) || baseName,
    positivePrompt: patch.positivePrompt !== undefined ? patch.positivePrompt : current.positivePrompt ?? null,
    negativePrompt: patch.negativePrompt !== undefined ? patch.negativePrompt : current.negativePrompt ?? null,
    submitPayload: submitPayload ?? null,
    mediaCategory: sanitizeMetaString(patch.mediaCategory) || sanitizeMetaString(current.mediaCategory),
    sourcePromptId: sanitizeMetaString(patch.sourcePromptId) || sanitizeMetaString(current.sourcePromptId),
    sourcePayloadKey: sanitizeMetaString(patch.sourcePayloadKey) || sanitizeMetaString(current.sourcePayloadKey),
    sourceNodeId: sanitizeMetaString(patch.sourceNodeId) || sanitizeMetaString(current.sourceNodeId),
    sourceBucket: (patch.sourceBucket ?? current.sourceBucket ?? null) as GalleryMeta["sourceBucket"],
    sourceType,
    extendedFromName:
      sanitizeMetaString(patch.extendedFromName) ||
      sanitizeMetaString(current.extendedFromName) ||
      (submitPayload && typeof submitPayload === "object"
        ? sanitizeMetaString((submitPayload as any).extendedFromName)
        : null),
    extendSourceFrame:
      sanitizeMetaString(patch.extendSourceFrame) ||
      sanitizeMetaString(current.extendSourceFrame) ||
      (submitPayload && typeof submitPayload === "object"
        ? sanitizeMetaString((submitPayload as any).extendSourceFrame)
        : null),
    extendMode:
      sanitizeMetaString(patch.extendMode) ||
      sanitizeMetaString(current.extendMode) ||
      (submitPayload && typeof submitPayload === "object"
        ? sanitizeMetaString((submitPayload as any).extendMode)
        : null),
    requestKind:
      sanitizeMetaString(patch.requestKind) ||
      sanitizeMetaString(current.requestKind) ||
      (submitPayload && typeof submitPayload === "object"
        ? sanitizeMetaString((submitPayload as any).requestKind)
        : null),
    audioMix: patch.audioMix !== undefined ? patch.audioMix : current.audioMix ?? null,
    audioLibrary: patch.audioLibrary !== undefined ? patch.audioLibrary : current.audioLibrary ?? null,
    ttsAudio: patch.ttsAudio !== undefined ? patch.ttsAudio : current.ttsAudio ?? null,
    voiceTts: patch.voiceTts !== undefined ? patch.voiceTts : current.voiceTts ?? null,
    voiceDub: patch.voiceDub !== undefined ? patch.voiceDub : current.voiceDub ?? null,
    soundEffect: patch.soundEffect !== undefined ? patch.soundEffect : current.soundEffect ?? null,
    extractedAudio: patch.extractedAudio !== undefined ? patch.extractedAudio : current.extractedAudio ?? null,
    wooshSfx: patch.wooshSfx !== undefined ? patch.wooshSfx : current.wooshSfx ?? null,
    stitchVideo: patch.stitchVideo !== undefined ? patch.stitchVideo : current.stitchVideo ?? null,
    editVideo: patch.editVideo !== undefined ? patch.editVideo : current.editVideo ?? null,
    videoEdit: patch.videoEdit !== undefined ? patch.videoEdit : current.videoEdit ?? null,
    extendRequestId:
      sanitizeMetaString(patch.extendRequestId) ||
      sanitizeMetaString(current.extendRequestId) ||
      (submitPayload && typeof submitPayload === "object"
        ? sanitizeMetaString((submitPayload as any).extendRequestId)
        : null),
    workflowId: sanitizeMetaString(patch.workflowId) || sanitizeMetaString(current.workflowId),
    workflowTitle: sanitizeMetaString(patch.workflowTitle) || sanitizeMetaString(current.workflowTitle),
    ownerKey: sanitizeMetaString(patch.ownerKey) || sanitizeMetaString(current.ownerKey) || sourceHint?.ownerKey || null,
    username: sanitizeMetaString(patch.username) || sanitizeMetaString(current.username) || sourceHint?.username || null,
    deviceId: sanitizeMetaString(patch.deviceId) || sanitizeMetaString(current.deviceId) || sourceHint?.deviceId || null,
    importedFromPath:
      sanitizeMetaString(patch.importedFromPath) || sanitizeMetaString(current.importedFromPath),
    importedFromSource: (patch.importedFromSource ?? current.importedFromSource ?? null) as GalleryMeta["importedFromSource"],
    createdAt: Number(current.createdAt || patch.createdAt || stat.birthtimeMs || stat.mtimeMs || Date.now()),
    updatedAt: Date.now(),
    metaVersion: Math.max(2, Number(patch.metaVersion || current.metaVersion || 2) || 2),
  };
}

export async function getGallerySourcesForRequest(req: NextRequest): Promise<{
  owner: Awaited<ReturnType<typeof getOwnerContext>>;
  sources: GallerySource[];
}> {
  const owner = await getOwnerContext(req);
  const sources: GallerySource[] = [];

  if (owner.username) {
    sources.push({
      scope: "user",
      dir: userGalleryDir(owner.username),
      ownerKey: owner.ownerKey,
      username: owner.username,
      deviceId: owner.deviceId,
    });
  }
  sources.push({
    scope: "device",
    dir: deviceGalleryDir(owner.deviceId),
    ownerKey: owner.ownerKey,
    username: owner.username,
    deviceId: owner.deviceId,
  });

  return { owner, sources };
}

function listFilesFromSource(source: GallerySource): GalleryResolvedItem[] {
  ensureDir(source.dir);
  const out: GalleryResolvedItem[] = [];

  for (const entry of fs.readdirSync(source.dir)) {
    if (!isMediaFile(entry)) continue;
    const absPath = path.join(source.dir, entry);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(absPath);
    } catch {
      continue;
    }

    const meta = ensureGalleryMetaForFile(
      absPath,
      {
        sourceType: readMetaForFile(absPath).sourceType || "legacy-gallery-item",
      },
      source,
    );
    const displayName = String(meta.renamedName || entry).trim() || entry;

    out.push({
      name: displayName,
      path: absPath,
      scope: source.scope,
      url: `/api/gallery/file?name=${encodeURIComponent(entry)}&scope=${source.scope}`,
      kind: kindFromName(entry),
      createdAt: Number(meta.createdAt || stat.birthtimeMs || stat.mtimeMs || Date.now()),
      updatedAt: Number(meta.updatedAt || stat.mtimeMs || Date.now()),
      meta,
    });
  }

  return out;
}

export type ListGalleryOptions = {
  filter?: "all" | "pictures" | "videos" | "images";
  sort?: "last_created" | "first_created" | "favorited" | "name" | "newest" | "oldest";
  search?: string;
  page?: number;
  per?: number;
};

export function listGalleryItemsFromSources(
  sources: GallerySource[],
  opts: ListGalleryOptions = {},
): {
  items: GalleryResolvedItem[];
  total: number;
  totalPages: number;
} {
  let items = sources.flatMap(listFilesFromSource);

  const filter = String(opts.filter || "all").toLowerCase();
  if (filter === "pictures" || filter === "images") {
    items = items.filter((x) => x.kind === "image");
  } else if (filter === "videos") {
    items = items.filter((x) => x.kind === "video");
  }

  const q = String(opts.search || "").trim().toLowerCase();
  if (q) {
    items = items.filter((x) => {
      const original = String(x.meta?.originalName || "").toLowerCase();
      return x.name.toLowerCase().includes(q) || original.includes(q);
    });
  }

  const sort = String(opts.sort || "last_created").toLowerCase();
  if (sort === "first_created" || sort === "oldest") {
    items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  } else if (sort === "favorited") {
    items.sort((a, b) => {
      const af = a.meta.favorite ? 1 : 0;
      const bf = b.meta.favorite ? 1 : 0;
      if (bf !== af) return bf - af;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  } else if (sort === "name") {
    items.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  const per = Math.max(1, Math.min(5000, Number(opts.per || 100)));
  const page = Math.max(1, Number(opts.page || 1));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / per));
  const start = (page - 1) * per;
  const paged = items.slice(start, start + per);

  return {
    items: paged,
    total,
    totalPages,
  };
}

export function resolveGalleryItemByName(args: {
  sources: GallerySource[];
  name: string;
  scopeHint?: string | null;
}): GalleryResolvedItem | null {
  const rawName = String(args.name || "").trim();
  if (!rawName) return null;

  const baseName = path.basename(rawName);
  const scopeHint = args.scopeHint === "user" || args.scopeHint === "device" ? args.scopeHint : null;

  for (const source of args.sources) {
    if (scopeHint && source.scope !== scopeHint) continue;

    try {
      const direct = safeJoin(source.dir, baseName);
      if (fs.existsSync(direct) && isMediaFile(baseName)) {
        const stat = fs.statSync(direct);
        const meta = ensureGalleryMetaForFile(direct, {}, source);
        return {
          name: String(meta.renamedName || baseName).trim() || baseName,
          path: direct,
          scope: source.scope,
          url: `/api/gallery/file?name=${encodeURIComponent(baseName)}&scope=${source.scope}`,
          kind: kindFromName(baseName),
          createdAt: Number(meta.createdAt || stat.birthtimeMs || stat.mtimeMs || Date.now()),
          updatedAt: Number(meta.updatedAt || stat.mtimeMs || Date.now()),
          meta,
        };
      }
    } catch {
      // ignore direct lookup errors
    }

    try {
      const entries = fs.readdirSync(source.dir).filter(isMediaFile);
      for (const entry of entries) {
        const abs = path.join(source.dir, entry);
        const meta = ensureGalleryMetaForFile(abs, {}, source);
        const renamed = String(meta.renamedName || "").trim();
        if (renamed && renamed === rawName) {
          const stat = fs.statSync(abs);
          return {
            name: renamed,
            path: abs,
            scope: source.scope,
            url: `/api/gallery/file?name=${encodeURIComponent(entry)}&scope=${source.scope}`,
            kind: kindFromName(entry),
            createdAt: Number(meta.createdAt || stat.birthtimeMs || stat.mtimeMs || Date.now()),
            updatedAt: Number(meta.updatedAt || stat.mtimeMs || Date.now()),
            meta,
          };
        }
      }
    } catch {
      // ignore scan errors
    }
  }

  return null;
}

export function sanitizeRenameTarget(input: string): string {
  const value = String(input || "").trim();
  if (!value) return "";

  const noExt = path.basename(value, path.extname(value));
  const cleaned = safeGalleryName(
    noExt
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );

  return cleaned.slice(0, 120);
}

export async function renameGalleryItem(
  item: { path: string; name: string; sourceName?: string; scope?: string; meta?: GalleryMeta },
  newName: string
) {
  if (!item?.path) {
    throw new Error("renameGalleryItem: item.path is missing");
  }

  const currentPath = path.resolve(item.path);
  if (!fs.existsSync(currentPath)) {
    throw new Error("Gallery file not found.");
  }

  const stat = fs.statSync(currentPath);
  if (!stat.isFile()) {
    throw new Error("Gallery path is not a file.");
  }

  const currentBase = path.basename(currentPath);
  const currentExt = path.extname(currentBase);
  const targetStem = sanitizeRenameTarget(newName);

  if (!targetStem) {
    throw new Error("Missing newName");
  }

  const nextBase = `${targetStem}${currentExt}`;
  const nextPath = path.join(path.dirname(currentPath), nextBase);
  const currentMetaPath = metaPathForFile(currentPath);
  const nextMetaPath = metaPathForFile(nextPath);
  const existingMeta = readMetaForFile(currentPath);
  const originalName = String(
    existingMeta.originalName || item.sourceName || currentBase
  ).trim() || currentBase;

  if (currentPath !== nextPath && fs.existsSync(nextPath)) {
    throw new Error("A file with that name already exists.");
  }

  if (currentPath !== nextPath) {
    fs.renameSync(currentPath, nextPath);

    if (fs.existsSync(currentMetaPath)) {
      fs.renameSync(currentMetaPath, nextMetaPath);
    }
  }

  const nextStat = fs.statSync(nextPath);
  const nextMeta = writeMetaForFile(nextPath, {
    ...existingMeta,
    originalName,
    renamedName: nextBase,
    createdAt: Number(existingMeta.createdAt || stat.birthtimeMs || stat.mtimeMs || Date.now()),
    updatedAt: Number(nextStat.mtimeMs || Date.now()),
  });

  return {
    oldName: item.name || currentBase,
    newName: nextBase,
    path: nextPath,
    meta: nextMeta,
  };
}

export function ensureGalleryMetaForFile(
  absPath: string,
  patch: GalleryMeta = {},
  sourceHint?: GallerySource | null,
): GalleryMeta {
  return writeMetaForFile(absPath, patch, sourceHint);
}
