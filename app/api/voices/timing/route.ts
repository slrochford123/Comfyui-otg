import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";

import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";
import { probeDurationSeconds, resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { resolveVoicesFile } from "@/lib/voicesStudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Body = {
  sourceUrl?: string;
  voiceId?: string;
  leadingSilenceSec?: number;
  trailingSilenceSec?: number;
  persist?: boolean;
};

function mediaExtFromPath(filePath: string): string {
  const ext = path.extname(filePath || "").toLowerCase();
  return [".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"].includes(ext) ? ext : ".wav";
}

function codecForExt(ext: string): string[] {
  switch (ext) {
    case ".wav":
      return ["-c:a", "pcm_s16le"];
    case ".mp3":
      return ["-c:a", "libmp3lame", "-q:a", "2"];
    case ".flac":
      return ["-c:a", "flac"];
    case ".ogg":
      return ["-c:a", "libvorbis", "-q:a", "5"];
    case ".m4a":
    case ".aac":
      return ["-c:a", "aac", "-b:a", "192k"];
    default:
      return ["-c:a", "pcm_s16le"];
  }
}

function assertPathAllowed(absPath: string): string {
  const resolved = path.resolve(absPath);
  const allowedRoots = [path.resolve(OTG_DATA_ROOT), path.resolve(process.cwd())];
  if (!allowedRoots.some((root) => resolved.startsWith(root + path.sep) || resolved === root)) {
    throw new Error("Source path is outside allowed roots");
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("Source audio file not found");
  }
  return resolved;
}

function resolveSourcePath(req: NextRequest, sourceUrlRaw: string): string {
  const sourceUrl = String(sourceUrlRaw || "").trim();
  if (!sourceUrl) throw new Error("Missing sourceUrl");

  const parsed = new URL(sourceUrl, req.url);
  if (parsed.pathname === "/api/file") {
    const p = String(parsed.searchParams.get("path") || "").trim();
    if (!p) throw new Error("Missing file path");
    return assertPathAllowed(p);
  }

  if (parsed.pathname === "/api/voices/file") {
    const rel = String(parsed.searchParams.get("rel") || "").trim();
    if (!rel) throw new Error("Missing rel");
    return assertPathAllowed(resolveVoicesFile(rel));
  }

  throw new Error("Unsupported sourceUrl");
}

function outputDirFor(ownerKey: string, voiceId: string, persist: boolean): string {
  const root = path.join(OTG_DATA_ROOT, "uploads", "voices", "outputs", safeSegment(voiceId || ownerKey || "voice"), persist ? "timed" : "preview");
  ensureDir(root);
  return root;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser(req);
    const body = (await req.json().catch(() => ({}))) as Body;

    const voiceId = safeSegment(String(body.voiceId || "").trim() || "voice");
    const leading = Math.max(0, Number(body.leadingSilenceSec || 0) || 0);
    const trailing = Math.max(0, Number(body.trailingSilenceSec || 0) || 0);
    const persist = Boolean(body.persist);

    const sourcePath = resolveSourcePath(req, String(body.sourceUrl || ""));
    const sourceDuration = (await probeDurationSeconds(sourcePath)) || 0;

    const outDir = outputDirFor(user.ownerKey, voiceId, persist);
    const ext = mediaExtFromPath(sourcePath);
    const stem = persist ? "timed" : "preview_timed";
    const outPath = path.join(outDir, `${stem}_${Date.now()}${ext}`);

    const ffmpeg = resolveFfmpegPath();
    const args: string[] = ["-y"];

    const inputCount = (leading > 0 ? 1 : 0) + 1 + (trailing > 0 ? 1 : 0);
    if (leading > 0) args.push("-f", "lavfi", "-t", String(leading), "-i", "anullsrc=r=48000:cl=stereo");
    args.push("-i", sourcePath);
    if (trailing > 0) args.push("-f", "lavfi", "-t", String(trailing), "-i", "anullsrc=r=48000:cl=stereo");

    if (inputCount === 1) {
      args.push(...codecForExt(ext), outPath);
    } else {
      const labels: string[] = [];
      for (let i = 0; i < inputCount; i += 1) labels.push(`[${i}:a]`);
      args.push(
        "-filter_complex",
        `${labels.join("")}concat=n=${inputCount}:v=0:a=1[a]`,
        "-map",
        "[a]",
        ...codecForExt(ext),
        outPath,
      );
    }

    const r = await runCmd(ffmpeg, args, { timeoutMs: 120000 });
    if (r.code !== 0 || !fs.existsSync(outPath)) {
      throw new Error((r.stderr || r.stdout || "ffmpeg failed").slice(-2000));
    }

    const durationSec = (await probeDurationSeconds(outPath)) || (sourceDuration + leading + trailing);

    return NextResponse.json(
      {
        ok: true,
        audioUrl: `/api/file?path=${encodeURIComponent(outPath)}`,
        audioPath: outPath,
        durationSec,
        sourceDurationSec: sourceDuration,
        leadingSilenceSec: leading,
        trailingSilenceSec: trailing,
        speechStartSec: leading,
        speechEndSec: leading + sourceDuration,
        saved: persist,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "Voice timing failed" }, { status: 500 });
  }
}
