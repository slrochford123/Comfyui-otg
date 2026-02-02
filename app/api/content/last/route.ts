import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getOwnerContext } from "@/lib/ownerKey";
import { getOwnerDirs, deviceGalleryDir, userGalleryDir } from "@/lib/paths";
import { readState, writeState } from "@/lib/contentState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MediaKind = "image" | "video";

function isMediaFile(name: string) {
  const ext = path.extname(name).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov"].includes(ext);
}

function kindFromName(name: string): MediaKind {
  const ext = path.extname(name).toLowerCase();
  return ext === ".mp4" || ext === ".webm" || ext === ".mov" ? "video" : "image";
}

function newestMatchingFile(dir: string, ownerKey: string): string | null {
  if (!fs.existsSync(dir)) return null;
  let best: { name: string; mtime: number; score: number } | null = null;

  for (const name of fs.readdirSync(dir)) {
    if (!isMediaFile(name)) continue;
    // Most of Shawn's filenames include ownerKey (e.g. __slrochford123_00001_.png)
    // Prefer files that include ownerKey, but do not require it (videos may not include it)

    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      const mtime = st.mtimeMs || 0;
      const score = ownerKey && name.toLowerCase().includes(ownerKey.toLowerCase()) ? 1 : 0;
      if (!best || score > best.score || (score === best.score && mtime > best.mtime)) best = { name, mtime, score };
    } catch {
      // ignore
    }
  }
  return best ? best.name : null;
}

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function copyToLatest(srcFull: string, dstDir: string): { name: string; kind: MediaKind } | null {
  try {
    ensureDir(dstDir);
    const ext = path.extname(srcFull).toLowerCase();
    const dstName = `latest${ext}`;
    const dstFull = path.join(dstDir, dstName);

    // Only copy if it changed (size differs)
    try {
      if (fs.existsSync(dstFull)) {
        const a = fs.statSync(srcFull);
        const b = fs.statSync(dstFull);
        if (a.size === b.size) {
          return { name: dstName, kind: kindFromName(dstName) };
        }
      }
    } catch {
      // ignore
    }

    fs.copyFileSync(srcFull, dstFull);
    return { name: dstName, kind: kindFromName(dstName) };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const owner = await getOwnerContext(req as any);
  const dirs = getOwnerDirs(owner.ownerKey);

  const state = readState(owner.ownerKey) || {};
  const deviceId = owner.deviceId || "local";

  // Primary preview source:
  // - Logged in users: user-scoped gallery (data/user_galleries/<username>)
  // - Anonymous users: device-scoped gallery (data/device_galleries/<deviceId>)
  const sourceDir = owner.scope === "user" && owner.username ? userGalleryDir(owner.username) : deviceGalleryDir(deviceId);
  const newest = newestMatchingFile(sourceDir, owner.ownerKey);

  let file: { name: string; kind: MediaKind; url: string } | null = null;

  if (newest) {
    const copied = copyToLatest(path.join(sourceDir, newest), dirs.preview);
    if (copied) {
      file = {
        name: copied.name,
        kind: copied.kind,
        url: `/api/preview/file?name=${encodeURIComponent(copied.name)}`,
      };
    }
  }

  // If we have a preview file, update last.json metadata (fileName only) but
  // treat it as *metadata*, not the source of truth.
  if (file) {
    try {
      writeState(owner.ownerKey, {
        ...state,
        fileName: file.name,
        kind: file.kind,
        updatedAt: Date.now(),
      });
    } catch {
      // ignore
    }
  }

  return NextResponse.json({
    ok: true,
    scope: owner.scope,
    ownerKey: owner.ownerKey,
    username: owner.username,
    deviceId,
    status: state.status || "idle",
    favorited: !!state.favorited,
    updatedAt: state.updatedAt || null,
    startedAt: state.startedAt || null,
    readyAt: state.readyAt || null,
    file,
    baseDir: dirs.preview,
    sourceDir,
  });
}
