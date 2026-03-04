import fs from "node:fs";
import path from "node:path";

import { OTG_DATA_ROOT, ensureDir, safeJoin, safeSegment } from "@/lib/paths";

export const OTG_VOICES_ROOT = (() => {
  const root = path.join(OTG_DATA_ROOT, "voices");
  ensureDir(root);
  return root;
})();

export function voicesUserIdFromAuth(email: string, username: string): string {
  // Prefer username when present; it makes nicer folder names.
  const key = (username || email || "admin").toString();
  return safeSegment(key);
}

export function voicesUserRoot(userId: string): string {
  const dir = safeJoin(OTG_VOICES_ROOT, "users", safeSegment(userId));
  ensureDir(dir);
  return dir;
}

export function voicesExtractionsRoot(userId: string): string {
  const dir = safeJoin(voicesUserRoot(userId), "extractions");
  ensureDir(dir);
  return dir;
}

export function voicesProfilesRoot(userId: string): string {
  const dir = safeJoin(voicesUserRoot(userId), "profiles");
  ensureDir(dir);
  return dir;
}

export function writeFileAtomic(filePath: string, buf: Buffer): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buf);
}
