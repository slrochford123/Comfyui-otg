import fs from "fs";
import path from "path";

/**
 * OTG data root.
 * Prefer OTG_DATA_DIR (or OTG_DATA_ROOT) env var.
 * Falls back to <repo>/data for local dev.
 */
export const OTG_DATA_ROOT: string = (() => {
  const env = process.env.OTG_DATA_DIR || process.env.OTG_DATA_ROOT;
  const root = env && env.trim().length ? env.trim() : path.join(process.cwd(), "data");
  return path.resolve(root);
})();

/** Back-compat symbol some routes import */
export const OTG_USER_OUTPUT_ROOT: string = path.join(OTG_DATA_ROOT, "user_galleries");

/** OTG Law: central device galleries root override */
export const OTG_DEVICE_OUTPUT_ROOT: string = (() => {
  const env = process.env.OTG_DEVICE_OUTPUT_ROOT;
  if (env && env.trim().length) return path.resolve(env.trim());
  return path.join(OTG_DATA_ROOT, "device_galleries");
})();

/** Convenience getter used by debug endpoints */
export function getResolvedDataRoot(): string {
  return OTG_DATA_ROOT;
}

// -------------------------
// Small filesystem helpers
// -------------------------
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJsonSafe<T = any>(filePath: string, fallback: T): T {
  try {
    const s = fs.readFileSync(filePath, "utf8");
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonSafe(filePath: string, data: any): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Join and resolve safely under a base directory.
 * Throws if the resolved path escapes the base.
 */
export function safeJoin(baseDir: string, ...segments: string[]): string {
  const base = path.resolve(baseDir);
  const target = path.resolve(baseDir, ...segments);
  const rel = path.relative(base, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`safeJoin: path escapes baseDir: ${target}`);
  }
  return target;
}

// -------------------------
// Sanitizers
// -------------------------
export function safeSegment(input: string): string {
  const s = (input || "local").toString().trim().toLowerCase();
  const cleaned = s.replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length ? cleaned : "local";
}

export function safeDeviceId(deviceId: string): string {
  return safeSegment(deviceId || "local");
}

// -------------------------
// Roots & directory getters
// -------------------------
export function getDeviceGalleriesRoot(): string {
  ensureDir(OTG_DEVICE_OUTPUT_ROOT);
  return OTG_DEVICE_OUTPUT_ROOT;
}

export function getDeviceInboxRoot(): string {
  const dir = path.join(OTG_DATA_ROOT, "device_inbox");
  ensureDir(dir);
  return dir;
}

export function getUserGalleriesRoot(): string {
  ensureDir(OTG_USER_OUTPUT_ROOT);
  return OTG_USER_OUTPUT_ROOT;
}

export function getUserInboxRoot(): string {
  const dir = path.join(OTG_DATA_ROOT, "user_inbox");
  ensureDir(dir);
  return dir;
}

export function getUserFavoritesRoot(): string {
  const dir = path.join(OTG_DATA_ROOT, "user_favorites");
  ensureDir(dir);
  return dir;
}

export function getDeviceFavoritesRoot(): string {
  const dir = path.join(OTG_DATA_ROOT, "device_favorites");
  ensureDir(dir);
  return dir;
}

// Device-scoped dirs
export function deviceGalleryDir(deviceId: string): string {
  const safe = safeDeviceId(deviceId || "local");
  const dir = path.join(getDeviceGalleriesRoot(), safe);
  ensureDir(dir);
  return dir;
}

export function deviceInboxDir(deviceId: string): string {
  const safe = safeDeviceId(deviceId || "local");
  const dir = path.join(getDeviceInboxRoot(), safe);
  ensureDir(dir);
  return dir;
}

export function deviceFavoritesDir(deviceId: string): string {
  const safe = safeDeviceId(deviceId || "local");
  const dir = path.join(getDeviceFavoritesRoot(), safe);
  ensureDir(dir);
  return dir;
}

// User-scoped dirs
export function userGalleryDir(userId: string): string {
  const safe = safeSegment(userId || "local");
  const dir = path.join(getUserGalleriesRoot(), safe);
  ensureDir(dir);
  return dir;
}

export function userInboxDir(userId: string): string {
  const safe = safeSegment(userId || "local");
  const dir = path.join(getUserInboxRoot(), safe);
  ensureDir(dir);
  return dir;
}


export function userPreviewDir(userId: string) {
  return path.join(OTG_DATA_ROOT, "user_previews", safeSegment(userId));
}

export function userFavoritesDir(userId: string): string {
  const safe = safeSegment(userId || "local");
  const dir = path.join(getUserFavoritesRoot(), safe);
  ensureDir(dir);
  return dir;
}

/**
 * OwnerDirs: provide BOTH the new generic names and legacy aliases
 * used across older routes (userInboxDir, userGalleryDir, etc.).
 */
export type OwnerDirs = {
  userId: string;

  // root for ad-hoc paths (studio inbox etc.)
  otgDataDir: string;

  // preferred generic names
  inbox: string;
  gallery: string;
  favorites: string;
  preview: string;

  // legacy aliases expected by some routes
  userInboxDir: string;
  userGalleryDir: string;
  userPreviewDir: string;
  userFavoritesDir: string;
};

export function getOwnerDirs(ownerKey: string): OwnerDirs {
  const userId = safeSegment(ownerKey || "local");

  const inbox = userInboxDir(userId);
  const gallery = userGalleryDir(userId);
  const favorites = userFavoritesDir(userId);
  const preview = userPreviewDir(userId);

  return {
    userId,
    otgDataDir: OTG_DATA_ROOT,
    inbox,
    gallery,
    favorites,
    preview,
    userInboxDir: inbox,
    userGalleryDir: gallery,
    userFavoritesDir: favorites,
    userPreviewDir: preview,
  };
}
