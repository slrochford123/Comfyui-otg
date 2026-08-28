import fs from "node:fs";
import path from "node:path";
import { deviceFavoritesDir, deviceGalleryDir, ensureDir, safeSegment, userFavoritesDir, userGalleryDir } from "@/lib/paths";

export type GalleryMediaKind = "image" | "video";

export type GalleryMeta = {
  displayName?: string;
  favorite?: boolean;
  prompt?: string;
  negativePrompt?: string;
  submitPayload?: unknown;
  sourceWorkflow?: string;
  mediaType?: GalleryMediaKind;
  createdAt?: number;
  updatedAt?: number;
};

export type GalleryListItem = {
  name: string;
  displayName: string;
  url: string;
  thumbUrl: string;
  hoverPreviewUrl: string | null;
  posterUrl: string;
  kind: GalleryMediaKind;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  size: number;
  metaPath: string | null;
};

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".mkv"]);
const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS]);

export function isMediaName(name: string): boolean {
  return MEDIA_EXTS.has(path.extname(name || "").toLowerCase());
}

export function mediaKindFromName(name: string): GalleryMediaKind {
  return VIDEO_EXTS.has(path.extname(name || "").toLowerCase()) ? "video" : "image";
}

export function safeMediaName(name: string): string {
  const base = path.basename((name || "").trim());
  if (!base || base.includes("..") || base.includes("/") || base.includes("\\")) {
    throw new Error("Invalid media name");
  }
  if (!isMediaName(base)) {
    throw new Error("Unsupported media file");
  }
  return base;
}

export function metaPathForMedia(absMediaPath: string): string {
  return `${absMediaPath}.meta.json`;
}

export function readGalleryMeta(absMediaPath: string): GalleryMeta {
  const metaPath = metaPathForMedia(absMediaPath);
  try {
    const raw = fs.readFileSync(metaPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as GalleryMeta) : {};
  } catch {
    return {};
  }
}

export function writeGalleryMeta(absMediaPath: string, nextMeta: GalleryMeta): string {
  const metaPath = metaPathForMedia(absMediaPath);
  ensureDir(path.dirname(metaPath));
  const now = Date.now();
  const existing = readGalleryMeta(absMediaPath);
  const merged: GalleryMeta = {
    ...existing,
    ...nextMeta,
    mediaType: mediaKindFromName(absMediaPath),
    updatedAt: now,
    createdAt: existing.createdAt || nextMeta.createdAt || now,
  };
  fs.writeFileSync(metaPath, JSON.stringify(merged, null, 2), "utf8");
  return metaPath;
}

export function ownerGalleryDir(username: string | null, deviceId: string): string {
  return username ? userGalleryDir(username) : deviceGalleryDir(deviceId);
}

export function ownerFavoritesDir(username: string | null, deviceId: string): string {
  return username ? userFavoritesDir(username) : deviceFavoritesDir(deviceId);
}

function legacyFavoriteExists(name: string, username: string | null, deviceId: string): boolean {
  try {
    const favAbs = path.join(ownerFavoritesDir(username, deviceId), name);
    return fs.existsSync(favAbs);
  } catch {
    return false;
  }
}

export function ensureFavoriteCopy(absMediaPath: string, username: string | null, deviceId: string, favorite: boolean): void {
  const name = path.basename(absMediaPath);
  const favoritesDir = ownerFavoritesDir(username, deviceId);
  ensureDir(favoritesDir);
  const favAbs = path.join(favoritesDir, name);
  const srcMeta = metaPathForMedia(absMediaPath);
  const favMeta = metaPathForMedia(favAbs);

  if (favorite) {
    fs.copyFileSync(absMediaPath, favAbs);
    if (fs.existsSync(srcMeta)) {
      fs.copyFileSync(srcMeta, favMeta);
    } else {
      try { fs.unlinkSync(favMeta); } catch {}
    }
    return;
  }

  try { fs.unlinkSync(favAbs); } catch {}
  try { fs.unlinkSync(favMeta); } catch {}
}

export function renameMediaWithMeta(absOldMediaPath: string, nextBaseName: string, username: string | null, deviceId: string): { newMediaPath: string; newName: string } {
  const currentExt = path.extname(absOldMediaPath).toLowerCase();
  const currentName = path.basename(absOldMediaPath);
  const desiredStem = safeSegment(nextBaseName.replace(path.extname(nextBaseName), "")).replace(/_/g, " ").trim();
  const finalStem = desiredStem || path.basename(currentName, currentExt);
  const finalName = `${finalStem}${currentExt}`;
  const dir = path.dirname(absOldMediaPath);
  const absNewMediaPath = path.join(dir, finalName);

  if (path.basename(absOldMediaPath) === finalName) {
    return { newMediaPath: absOldMediaPath, newName: finalName };
  }
  if (fs.existsSync(absNewMediaPath)) {
    throw new Error("A file with that name already exists.");
  }

  const oldMeta = metaPathForMedia(absOldMediaPath);
  const newMeta = metaPathForMedia(absNewMediaPath);

  fs.renameSync(absOldMediaPath, absNewMediaPath);
  if (fs.existsSync(oldMeta)) {
    fs.renameSync(oldMeta, newMeta);
  }

  const oldFav = path.join(ownerFavoritesDir(username, deviceId), currentName);
  const newFav = path.join(ownerFavoritesDir(username, deviceId), finalName);
  const oldFavMeta = metaPathForMedia(oldFav);
  const newFavMeta = metaPathForMedia(newFav);

  if (fs.existsSync(oldFav)) {
    if (fs.existsSync(newFav)) throw new Error("A favorite with that name already exists.");
    fs.renameSync(oldFav, newFav);
  }
  if (fs.existsSync(oldFavMeta)) {
    fs.renameSync(oldFavMeta, newFavMeta);
  }

  const meta = readGalleryMeta(absNewMediaPath);
  writeGalleryMeta(absNewMediaPath, {
    ...meta,
    displayName: finalStem,
  });

  return { newMediaPath: absNewMediaPath, newName: finalName };
}

export function buildGalleryItem(absMediaPath: string, username: string | null, deviceId: string): GalleryListItem {
  const name = path.basename(absMediaPath);
  const st = fs.statSync(absMediaPath);
  const meta = readGalleryMeta(absMediaPath);
  const favorite = typeof meta.favorite === "boolean" ? meta.favorite : legacyFavoriteExists(name, username, deviceId);
  const kind = mediaKindFromName(name);
  const createdAt = Number(meta.createdAt || st.birthtimeMs || st.mtimeMs || Date.now());
  const updatedAt = Number(meta.updatedAt || st.mtimeMs || createdAt);
  const displayNameRaw = typeof meta.displayName === "string" && meta.displayName.trim()
    ? meta.displayName.trim()
    : path.basename(name, path.extname(name));

  return {
    name,
    displayName: displayNameRaw,
    url: `/api/gallery/file?name=${encodeURIComponent(name)}`,
    thumbUrl: `/api/thumb?collection=gallery&name=${encodeURIComponent(name)}&w=640`,
    hoverPreviewUrl: kind === "video" ? `/api/gallery/file?name=${encodeURIComponent(name)}` : null,
    posterUrl: `/api/thumb?collection=gallery&name=${encodeURIComponent(name)}&w=640`,
    kind,
    favorite,
    createdAt,
    updatedAt,
    size: Number(st.size || 0),
    metaPath: fs.existsSync(metaPathForMedia(absMediaPath)) ? metaPathForMedia(absMediaPath) : null,
  };
}

export function listOwnerGalleryItems(opts: {
  username: string | null;
  deviceId: string;
  search?: string;
  media?: "all" | "image" | "video";
  sort?: "created_asc" | "created_desc" | "favorited";
}): GalleryListItem[] {
  const { username, deviceId } = opts;
  const search = (opts.search || "").trim().toLowerCase();
  const media = opts.media || "all";
  const sort = opts.sort || "created_desc";

  const dir = ownerGalleryDir(username, deviceId);
  ensureDir(dir);

  const items = fs.readdirSync(dir)
    .filter(isMediaName)
    .map((name) => buildGalleryItem(path.join(dir, name), username, deviceId))
    .filter((item) => {
      if (media !== "all" && item.kind !== media) return false;
      if (!search) return true;
      const hay = `${item.displayName} ${item.name}`.toLowerCase();
      return hay.includes(search);
    });

  if (sort === "created_asc") {
    items.sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
  } else if (sort === "favorited") {
    items.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return b.createdAt - a.createdAt || a.name.localeCompare(b.name);
    });
  } else {
    items.sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name));
  }

  return items;
}
