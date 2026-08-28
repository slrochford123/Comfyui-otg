import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { getOwnerDirs, deviceGalleryDir, userGalleryDir } from "@/lib/paths";
import { readState, writeState } from "@/lib/contentState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MediaKind = "image" | "video";

function isMediaFile(name: string) {
  const ext = path.extname(name).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".mkv"].includes(ext);
}

function kindFromName(name: string): MediaKind {
  const ext = path.extname(name).toLowerCase();
  return [".mp4", ".webm", ".mov", ".mkv"].includes(ext) ? "video" : "image";
}

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function resolveCandidateDirs(username: string | null, deviceId: string) {
  const dirs: string[] = [];
  if (username) dirs.push(userGalleryDir(username));
  if (deviceId) dirs.push(deviceGalleryDir(deviceId));
  return Array.from(new Set(dirs));
}

function findExactFile(name: string, dirs: string[]): string | null {
  for (const dir of dirs) {
    const full = path.join(dir, name);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    } catch {
      // ignore
    }
  }
  return null;
}

function newestFileAcrossDirs(dirs: string[]): string | null {
  let best: { full: string; mtime: number } | null = null;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!isMediaFile(name)) continue;
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        const mtime = st.mtimeMs || 0;
        if (!best || mtime > best.mtime) best = { full, mtime };
      } catch {
        // ignore
      }
    }
  }
  return best?.full || null;
}

function copyToLatest(srcFull: string, dstDir: string): { name: string; kind: MediaKind } | null {
  try {
    ensureDir(dstDir);
    const ext = path.extname(srcFull).toLowerCase();
    const dstName = `latest${ext}`;
    const dstFull = path.join(dstDir, dstName);

    try {
      if (fs.existsSync(dstFull)) {
        const a = fs.statSync(srcFull);
        const b = fs.statSync(dstFull);
        if (a.size === b.size && a.mtimeMs === b.mtimeMs) {
          return { name: dstName, kind: kindFromName(dstName) };
        }
      }
    } catch {
      // ignore
    }

    fs.copyFileSync(srcFull, dstFull);
    const st = fs.statSync(srcFull);
    fs.utimesSync(dstFull, st.atime, st.mtime);
    return { name: dstName, kind: kindFromName(dstName) };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  let owner;
  try {
    owner = await getOwnerContext(req as any);
  } catch (err) {
    if (err instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 401 });
    }
    throw err;
  }
  const dirs = getOwnerDirs(owner.ownerKey);
  const state = readState(owner.ownerKey) || {};
  const deviceId = owner.deviceId || "local";
  const candidateDirs = resolveCandidateDirs(owner.username, deviceId);

  let sourceFull: string | null = null;

  if (state?.fileName) {
    sourceFull = findExactFile(String(state.fileName), candidateDirs);
  }

  if (!sourceFull && state?.status === "running") {
    return NextResponse.json({
      ok: true,
      scope: owner.scope,
      ownerKey: owner.ownerKey,
      username: owner.username,
      deviceId,
      status: state.status || "running",
      favorited: !!state.favorited,
      updatedAt: state.updatedAt || null,
      startedAt: state.startedAt || null,
      readyAt: state.readyAt || null,
      file: null,
      baseDir: dirs.preview,
      sourceDir: null,
    });
  }

  if (!sourceFull) {
    sourceFull = newestFileAcrossDirs(candidateDirs);
  }

  let file: { name: string; kind: MediaKind; url: string; sourceName: string } | null = null;

  if (sourceFull) {
    const copied = copyToLatest(sourceFull, dirs.preview);
    if (copied) {
      file = {
        name: copied.name,
        kind: copied.kind,
        url: `/api/preview/file?name=${encodeURIComponent(copied.name)}`,
        sourceName: path.basename(sourceFull),
      };
    }

    try {
      writeState(owner.ownerKey, {
        fileName: path.basename(sourceFull),
        kind: kindFromName(sourceFull),
      });
    } catch {
      // ignore
    }
  }

  const nextState = readState(owner.ownerKey) || state;

  return NextResponse.json({
    ok: true,
    scope: owner.scope,
    ownerKey: owner.ownerKey,
    username: owner.username,
    deviceId,
    status: nextState.status || "idle",
    favorited: !!nextState.favorited,
    updatedAt: nextState.updatedAt || null,
    startedAt: nextState.startedAt || null,
    readyAt: nextState.readyAt || null,
    file,
    baseDir: dirs.preview,
    sourceDir: sourceFull ? path.dirname(sourceFull) : null,
  });
}
