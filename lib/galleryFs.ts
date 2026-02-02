import fs from "node:fs";
import path from "node:path";

export type MediaFile = { name: string; mtimeMs: number; size: number };

const MEDIA_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".mkv"]);

export function listMediaFiles(dir: string): MediaFile[] {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const out: MediaFile[] = [];
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const name = ent.name;
      const ext = path.extname(name).toLowerCase();
      if (!MEDIA_EXTS.has(ext)) continue;
      const abs = path.join(dir, name);
      const st = fs.statSync(abs);
      out.push({ name, mtimeMs: st.mtimeMs, size: st.size });
    }
    out.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return out;
  } catch {
    return [];
  }
}

export function safeBasename(name: string): string | null {
  const n = (name || "").toString();
  const base = path.basename(n);
  if (!base || base === "." || base === "..") return null;
  if (base.includes("/") || base.includes("\\")) return null;
  // keep it permissive but safe
  if (!/^[a-zA-Z0-9._\-+()\s]+$/.test(base)) return base; // still allow, but basename only
  return base;
}
