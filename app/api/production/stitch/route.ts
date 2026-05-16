import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SceneInput = {
  card?: number;
  videoPath?: string;
};

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)$/i;

function fileUrlFor(absPath: string) {
  return `/api/file?path=${encodeURIComponent(absPath)}`;
}

function resolveVideoPath(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw || !VIDEO_EXT_RE.test(raw)) return "";
  if (!path.isAbsolute(raw)) return "";
  return fssync.existsSync(raw) ? raw : "";
}

function ffmpegBin() {
  return String(process.env.FFMPEG_PATH || process.env.OTG_FFMPEG_PATH || "ffmpeg").trim() || "ffmpeg";
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

function concatLine(filePath: string) {
  return `file '${filePath.replace(/'/g, "'\\''").replace(/\\/g, "/")}'`;
}

export async function POST(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();

  try {
    const owner = await getOwnerContext(req);
    const ownerKey = owner.ownerKey;
    const body = await req.json().catch(() => null);
    const productionId = safeSegment(String(body?.productionId || "production").trim() || "production");
    const scenes = Array.isArray(body?.scenes) ? (body.scenes as SceneInput[]) : [];
    const orderedVideos = scenes
      .map((scene) => ({ card: Number(scene?.card || 1), videoPath: resolveVideoPath(scene?.videoPath) }))
      .filter((scene) => scene.videoPath)
      .sort((a, b) => a.card - b.card);

    if (!orderedVideos.length) {
      return NextResponse.json({ ok: false, error: "At least one completed scene video is required." }, { status: 400 });
    }

    const outputDir = path.join(OTG_DATA_ROOT, "productions", safeSegment(ownerKey || "local"), productionId, "stitched");
    await ensureDir(outputDir);
    const outputPath = path.join(outputDir, `stitched_${Date.now()}.mp4`);

    if (orderedVideos.length === 1) {
      await fs.copyFile(orderedVideos[0].videoPath, outputPath);
    } else {
      const listPath = path.join(os.tmpdir(), `otg_stitch_${productionId}_${Date.now()}.txt`);
      await fs.writeFile(listPath, orderedVideos.map((item) => concatLine(item.videoPath)).join("\n"), "utf8");
      try {
        await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
      } catch {
        await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", outputPath]);
      } finally {
        await fs.rm(listPath, { force: true }).catch(() => undefined);
      }
    }

    if (!fssync.existsSync(outputPath)) {
      return NextResponse.json({ ok: false, error: "Stitch failed: output file was not created." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, videoPath: outputPath, videoUrl: fileUrlFor(outputPath), sceneCount: orderedVideos.length });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "Stitch failed" }, { status: 500 });
  }
}
