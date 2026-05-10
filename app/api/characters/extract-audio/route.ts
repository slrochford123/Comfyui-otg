import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function fileUrlFor(absPath: string) {
  return `/api/file?path=${encodeURIComponent(absPath)}`;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    const key = process.platform === "win32" ? raw.toLowerCase() : raw;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

function isInsideRoot(candidate: string, root: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function configuredComfyOutputRoots() {
  const envRoots = String(process.env.OTG_GALLERY_IMPORT_ROOTS || "")
    .split(/[;\n,]+/)
    .map((v) => v.trim())
    .filter(Boolean);

  return uniqueStrings([
    process.env.COMFY_OUTPUT_DIR || null,
    process.env.ADMIN_GALLERY_ROOT || null,
    ...envRoots,
    "E:/Renders/ComfyUI",
  ]).map((p) => path.resolve(p));
}

function isAllowedIntroVideoPath(candidate: string) {
  if (isInsideRoot(candidate, OTG_DATA_ROOT)) return true;
  return configuredComfyOutputRoots().some((root) => isInsideRoot(candidate, root));
}

export async function POST(req: NextRequest) {
  try {
    const { ownerKey } = await getOwnerContext(req);
    const body = (await req.json().catch(() => ({}))) as { videoPath?: unknown };
    const videoPath = path.resolve(String(body.videoPath || "").trim());

    if (!videoPath) {
      return NextResponse.json({ ok: false, error: "videoPath is required" }, { status: 400 });
    }
    if (!fs.existsSync(videoPath)) {
      return NextResponse.json({ ok: false, error: "Intro video file was not found on disk." }, { status: 400 });
    }
    if (!isAllowedIntroVideoPath(videoPath)) {
      return NextResponse.json(
        { ok: false, error: "Intro video path is outside the allowed OTG/Comfy roots." },
        { status: 400 },
      );
    }

    const ownerDir = path.join(OTG_DATA_ROOT, "uploads", "characters", safeSegment(ownerKey));
    ensureDir(ownerDir);

    const id = crypto.randomUUID();
    const normalizedAudioPath = path.join(ownerDir, `character_reference_audio_from_intro_${id}.wav`);
    const ffmpeg = resolveFfmpegPath();
    const args = [
      "-y",
      "-i",
      videoPath,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ar",
      "24000",
      "-ac",
      "1",
      normalizedAudioPath,
    ];
    const result = await runCmd(ffmpeg, args, { timeoutMs: 180000 });
    if (result.code !== 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "ffmpeg failed while extracting audio from the intro video",
          detail: (result.stderr || result.stdout || "").trim() || undefined,
        },
        { status: 500 },
      );
    }

    if (!fs.existsSync(normalizedAudioPath)) {
      return NextResponse.json({ ok: false, error: "Intro video audio extraction failed" }, { status: 500 });
    }

    return NextResponse.json(
      {
        ok: true,
        referenceAudioPath: normalizedAudioPath,
        referenceAudioUrl: fileUrlFor(normalizedAudioPath),
        sourceVideoPath: videoPath,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    if (e instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "Extract audio failed" }, { status: 500 });
  }
}
