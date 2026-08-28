import fs from 'node:fs';
import path from 'node:path';

export type MediaCategory = 'image' | 'video' | 'audio' | 'unknown';

export type GalleryMetadata = {
  name: string;
  ownerKey: string | null;
  category: MediaCategory;
  favorite: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  size?: number;
  sourcePath?: string | null;
};

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO = new Set(['.mp4', '.webm', '.mov']);
const AUDIO = new Set(['.mp3', '.wav', '.m4a', '.ogg']);

export function mediaCategoryFromName(name: string): MediaCategory {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (IMAGE.has(ext)) return 'image';
  if (VIDEO.has(ext)) return 'video';
  if (AUDIO.has(ext)) return 'audio';
  return 'unknown';
}

export function sidecarPathFor(mediaPath: string) {
  return `${mediaPath}.json`;
}

export function normalizeGalleryMetadata(input: Partial<GalleryMetadata> | null | undefined, fallback: { name: string; ownerKey?: string | null; size?: number }): GalleryMetadata {
  const now = new Date().toISOString();
  const tags = Array.isArray(input?.tags) ? input!.tags.map(String).filter(Boolean) : [];
  return {
    name: String(input?.name || fallback.name),
    ownerKey: input?.ownerKey === undefined ? fallback.ownerKey ?? null : input.ownerKey,
    category: input?.category || mediaCategoryFromName(fallback.name),
    favorite: Boolean(input?.favorite),
    tags,
    createdAt: input?.createdAt || now,
    updatedAt: now,
    size: input?.size ?? fallback.size,
    sourcePath: input?.sourcePath ?? null,
  };
}

export function readGalleryMetadata(mediaPath: string): GalleryMetadata | null {
  const sidecar = sidecarPathFor(mediaPath);
  if (!fs.existsSync(sidecar)) return null;
  const raw = fs.readFileSync(sidecar, 'utf8');
  return JSON.parse(raw) as GalleryMetadata;
}

export function writeGalleryMetadata(mediaPath: string, metadata: GalleryMetadata) {
  const sidecar = sidecarPathFor(mediaPath);
  fs.mkdirSync(path.dirname(sidecar), { recursive: true });
  fs.writeFileSync(sidecar, JSON.stringify(metadata, null, 2) + '\n', 'utf8');
  return sidecar;
}

export function repairGalleryMetadata(mediaPath: string, fallback: { ownerKey?: string | null } = {}) {
  const stat = fs.existsSync(mediaPath) ? fs.statSync(mediaPath) : null;
  const current = stat ? readGalleryMetadata(mediaPath) : null;
  const metadata = normalizeGalleryMetadata(current, {
    name: path.basename(mediaPath),
    ownerKey: fallback.ownerKey ?? current?.ownerKey ?? null,
    size: stat?.size,
  });
  writeGalleryMetadata(mediaPath, metadata);
  return metadata;
}

export function scanGalleryDirectory(root: string) {
  const media: string[] = [];
  const brokenSidecars: string[] = [];
  const missingSidecars: string[] = [];
  const orphanSidecars: string[] = [];

  if (!fs.existsSync(root)) return { media, brokenSidecars, missingSidecars, orphanSidecars };

  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    const full = path.join(root, ent.name);
    if (ent.name.endsWith('.json')) {
      const mediaPath = full.slice(0, -'.json'.length);
      if (!fs.existsSync(mediaPath)) orphanSidecars.push(full);
      try { JSON.parse(fs.readFileSync(full, 'utf8')); }
      catch { brokenSidecars.push(full); }
      continue;
    }
    const category = mediaCategoryFromName(ent.name);
    if (category === 'unknown') continue;
    media.push(full);
    if (!fs.existsSync(sidecarPathFor(full))) missingSidecars.push(full);
  }

  return { media, brokenSidecars, missingSidecars, orphanSidecars };
}
