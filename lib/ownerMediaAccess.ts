import fs from "node:fs";
import path from "node:path";
import { getOwnerDirs, OTG_DATA_ROOT, safeSegment } from "@/lib/paths";

export class OwnerMediaAccessError extends Error {
  constructor() { super("Media is unavailable for this account."); }
}
export function assertOwnerMediaFile(file: string, ownerKey: string) {
  const owner = safeSegment(ownerKey);
  const dirs = getOwnerDirs(ownerKey);
  const roots = [dirs.inbox, dirs.gallery, dirs.preview,
    ...['characters', 'assets', 'backgrounds', 'voice_dub_jobs', 'voice_tts_jobs', 'voice_gallery', 'worker-artifacts'].map(kind => path.join(OTG_DATA_ROOT, kind, owner)),
    path.join(OTG_DATA_ROOT, 'uploads', 'characters', owner), path.join(OTG_DATA_ROOT, 'uploads', 'voices', owner)];
  for (const kind of ['samples', 'outputs']) {
    const parent = path.join(OTG_DATA_ROOT, 'uploads', 'voices', kind);
    try { for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith(owner + '__')) roots.push(path.join(parent, entry.name));
    } } catch {}
  }
  const inside = (root: string, candidate: string) => {
    const rel = path.relative(path.resolve(root), path.resolve(candidate));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  if (!roots.some(root => {
    if (!inside(root, file)) return false;
    try { return fs.statSync(file).isFile() && inside(fs.realpathSync(root), fs.realpathSync(file)); } catch { return false; }
  })) throw new OwnerMediaAccessError();
}
