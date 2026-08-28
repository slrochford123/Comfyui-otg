import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const AUDIO_EXT_RE = /\.(mp3|wav|flac|m4a|aac|ogg)$/i;

type SaveBody = {
  audioPath?: unknown;
  title?: unknown;
  fileName?: unknown;
  model?: unknown;
  prompt?: unknown;
  durationSeconds?: unknown;
  bpm?: unknown;
};

function cleanTitle(value: string) {
  return String(value || "music")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "music";
}

function ownerDirs(ownerKey: string) {
  const ownerSafe = safeSegment(ownerKey || "local");
  const root = path.join(OTG_DATA_ROOT, "edit_video", "music", ownerSafe);
  return {
    root,
    generated: path.join(root, "generated"),
    library: path.join(root, "library"),
  };
}

function assertInside(base: string, target: string) {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedBase, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeAudioExt(filename: string) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  return AUDIO_EXT_RE.test(ext) ? ext : ".mp3";
}

async function readJsonSidecar(filePath: string) {
  const metaPath = `${filePath}.json`;
  try {
    const parsed = JSON.parse(await fsp.readFile(metaPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function listMusicFiles(dir: string) {
  try {
    if (!fs.existsSync(dir)) return [];
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      if (!entry.isFile() || !AUDIO_EXT_RE.test(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const stat = await fsp.stat(abs);
      const meta = await readJsonSidecar(abs);
      items.push({
        fileName: entry.name,
        title: typeof meta.title === "string" ? meta.title : entry.name,
        url: `/api/file?path=${encodeURIComponent(abs)}`,
        audioPath: abs,
        sizeBytes: stat.size,
        createdAt: stat.birthtime.toISOString(),
        model: typeof meta.model === "string" ? meta.model : "",
        prompt: typeof meta.prompt === "string" ? meta.prompt : "",
        durationSeconds: Number(meta.durationSeconds || 0) || null,
        bpm: Number(meta.bpm || 0) || null,
      });
    }
    return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const { ownerKey } = await getOwnerContext(req);
    const dirs = ownerDirs(ownerKey);
    ensureDir(dirs.library);
    const items = await listMusicFiles(dirs.library);
    return NextResponse.json({ ok: true, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "Music library failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { ownerKey } = await getOwnerContext(req);
    const body = (await req.json().catch(() => ({}))) as SaveBody;
    const audioPath = String(body.audioPath || "").trim();
    if (!audioPath) {
      return NextResponse.json({ ok: false, error: "audioPath is required." }, { status: 400 });
    }
    if (!fs.existsSync(audioPath) || !fs.statSync(audioPath).isFile() || !AUDIO_EXT_RE.test(audioPath)) {
      return NextResponse.json({ ok: false, error: "Audio file was not found or is not a supported audio format." }, { status: 400 });
    }

    const dirs = ownerDirs(ownerKey);
    ensureDir(dirs.generated);
    ensureDir(dirs.library);

    if (!assertInside(dirs.root, audioPath)) {
      return NextResponse.json({ ok: false, error: "Audio file is outside the Edit Video music storage area." }, { status: 400 });
    }

    const title = cleanTitle(String(body.title || body.fileName || path.basename(audioPath)));
    const ext = safeAudioExt(String(body.fileName || audioPath));
    const outPath = path.join(dirs.library, `${Date.now()}_${title}${ext}`);
    await fsp.copyFile(audioPath, outPath);

    const meta = {
      type: "music-asset",
      source: "edit-video",
      operation: "ace-step-generated-music",
      title,
      originalFileName: String(body.fileName || path.basename(audioPath)),
      model: String(body.model || ""),
      prompt: String(body.prompt || ""),
      durationSeconds: Number(body.durationSeconds || 0) || null,
      bpm: Number(body.bpm || 0) || null,
      createdAt: new Date().toISOString(),
    };
    await fsp.writeFile(`${outPath}.json`, JSON.stringify(meta, null, 2), "utf8");
    const stat = await fsp.stat(outPath);

    return NextResponse.json({
      ok: true,
      fileName: path.basename(outPath),
      title,
      audioPath: outPath,
      url: `/api/file?path=${encodeURIComponent(outPath)}`,
      sizeBytes: stat.size,
      meta,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "Save music failed" }, { status: 500 });
  }
}
