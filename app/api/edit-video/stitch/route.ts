import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getGallerySourcesForRequest, resolveGalleryItemByName } from "@/lib/gallery";
import { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";
import { getFfmpegVersion, resolveFfmpegPath, resolveFfprobePath, runCmd } from "@/lib/ffmpeg";
import { SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InputVideo = {
  path: string;
  label: string;
};

type ProbeInfo = {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

function firstText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanFileName(value: string, fallback: string): string {
  const base = path.basename(String(value || fallback)).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
  return base || fallback;
}

function editVideoJobRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "edit_video_jobs", safeSegment(ownerKey || "local"));
}

function quoteConcatPath(filePath: string) {
  return filePath.replace(/'/g, "'\\''").replace(/\\/g, "/");
}

async function probeVideo(filePath: string): Promise<ProbeInfo> {
  const ffprobe = resolveFfprobePath();
  const result = await runCmd(
    ffprobe,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      filePath,
    ],
    { timeoutMs: 30000 },
  );

  if (result.code !== 0) {
    throw new Error(`ffprobe failed for ${path.basename(filePath)}: ${result.stderr || result.stdout}`);
  }

  const parsed = JSON.parse(result.stdout || "{}");
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const video = streams.find((stream: any) => stream?.codec_type === "video") || {};
  const audio = streams.find((stream: any) => stream?.codec_type === "audio");
  const durationRaw = Number(video?.duration || parsed?.format?.duration || 0);

  return {
    durationSeconds: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 5,
    width: Math.max(2, Number(video?.width || 1280) || 1280),
    height: Math.max(2, Number(video?.height || 720) || 720),
    hasAudio: Boolean(audio),
  };
}

async function normalizeVideo(args: {
  ffmpeg: string;
  input: InputVideo;
  outputPath: string;
  targetWidth: number;
  targetHeight: number;
}) {
  const probe = await probeVideo(args.input.path);
  const vf = `scale=${args.targetWidth}:${args.targetHeight}:force_original_aspect_ratio=decrease,pad=${args.targetWidth}:${args.targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25,format=yuv420p`;

  const cmdArgs = ["-y", "-hide_banner", "-i", args.input.path];
  if (!probe.hasAudio) {
    cmdArgs.push(
      "-f",
      "lavfi",
      "-t",
      String(Math.max(0.2, probe.durationSeconds)),
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
    );
  }

  cmdArgs.push(
    "-map",
    "0:v:0",
    "-map",
    probe.hasAudio ? "0:a:0" : "1:a:0",
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-shortest",
    "-movflags",
    "+faststart",
    args.outputPath,
  );

  const result = await runCmd(args.ffmpeg, cmdArgs, { timeoutMs: 15 * 60 * 1000 });
  if (result.code !== 0) {
    throw new Error(`Normalize failed for ${args.input.label}: ${result.stderr || result.stdout}`);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const ffmpegVersion = await getFfmpegVersion();
    if (!ffmpegVersion) {
      return NextResponse.json(
        {
          ok: false,
          error: "ffmpeg not available",
          hint: "Set OTG_FFMPEG_PATH and OTG_FFPROBE_PATH, or install ffmpeg in a standard path.",
        },
        { status: 500 },
      );
    }

    const form = await req.formData();
    const count = Math.max(0, Math.min(5, Number(firstText(form.get("count"))) || 0));
    if (count < 2) {
      return NextResponse.json({ ok: false, error: "Select at least 2 videos." }, { status: 400 });
    }

    const { owner, sources } = await getGallerySourcesForRequest(req);
    const jobId = randomUUID();
    const jobDir = path.join(editVideoJobRoot(owner.ownerKey), jobId);
    const inputDir = path.join(jobDir, "inputs");
    const normalizedDir = path.join(jobDir, "normalized");
    ensureDir(inputDir);
    ensureDir(normalizedDir);

    const inputs: InputVideo[] = [];

    for (let index = 0; index < count; index += 1) {
      const source = firstText(form.get(`slot_${index}_source`));
      if (source === "upload") {
        const value = form.get(`slot_${index}_file`);
        if (!(value instanceof File)) {
          return NextResponse.json({ ok: false, error: `Missing uploaded video for slot ${index + 1}.` }, { status: 400 });
        }
        const inputName = cleanFileName(value.name || `upload_${index + 1}.mp4`, `upload_${index + 1}.mp4`);
        const inputPath = safeJoin(inputDir, `${String(index + 1).padStart(2, "0")}_${inputName}`);
        const buffer = Buffer.from(await value.arrayBuffer());
        await fsp.writeFile(inputPath, buffer);
        inputs.push({ path: inputPath, label: inputName });
      } else if (source === "gallery") {
        const name = firstText(form.get(`slot_${index}_name`));
        const scope = firstText(form.get(`slot_${index}_scope`));
        const item = resolveGalleryItemByName({ sources, name, scopeHint: scope || null });
        if (!item || item.kind !== "video") {
          return NextResponse.json({ ok: false, error: `Gallery video not found for slot ${index + 1}.` }, { status: 404 });
        }
        inputs.push({ path: item.path, label: item.name || path.basename(item.path) });
      } else {
        return NextResponse.json({ ok: false, error: `Missing source for slot ${index + 1}.` }, { status: 400 });
      }
    }

    const firstProbe = await probeVideo(inputs[0].path);
    const targetPortrait = firstProbe.height > firstProbe.width;
    const targetWidth = targetPortrait ? 720 : 1280;
    const targetHeight = targetPortrait ? 1280 : 720;
    const ffmpeg = resolveFfmpegPath();

    const normalizedPaths: string[] = [];
    for (const [index, input] of inputs.entries()) {
      const normalizedPath = path.join(normalizedDir, `normalized_${String(index + 1).padStart(2, "0")}.mp4`);
      await normalizeVideo({ ffmpeg, input, outputPath: normalizedPath, targetWidth, targetHeight });
      normalizedPaths.push(normalizedPath);
    }

    const listPath = path.join(jobDir, "inputs.txt");
    await fsp.writeFile(listPath, normalizedPaths.map((filePath) => `file '${quoteConcatPath(filePath)}'`).join("\n"), "utf8");

    const outputFileName = "stitched_video.mp4";
    const outputPath = path.join(jobDir, outputFileName);
    const concatResult = await runCmd(
      ffmpeg,
      ["-y", "-hide_banner", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outputPath],
      { timeoutMs: 20 * 60 * 1000 },
    );

    if (concatResult.code !== 0) {
      throw new Error(`FFmpeg stitch failed: ${concatResult.stderr || concatResult.stdout}`);
    }

    return NextResponse.json({
      ok: true,
      jobId,
      fileName: outputFileName,
      url: `/api/edit-video/file?jobId=${encodeURIComponent(jobId)}&name=${encodeURIComponent(outputFileName)}`,
      inputs: inputs.length,
      normalized: true,
      target: { width: targetWidth, height: targetHeight, fps: 25 },
      ffmpeg: { version: ffmpegVersion },
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "Video stitch failed." }, { status: 500 });
  }
}
