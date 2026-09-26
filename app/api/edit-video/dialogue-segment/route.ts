import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv)$/i;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

function jobRoot(ownerKey: string) {
  return path.join(
    OTG_DATA_ROOT,
    "edit_video_dialogue_segment_jobs",
    safeSegment(ownerKey || "local"),
  );
}

function contentTypeFor(name: string) {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mkv") return "video/x-matroska";
  return "video/mp4";
}

async function saveUpload(file: File, outPath: string) {
  await fsp.writeFile(outPath, Buffer.from(await file.arrayBuffer()));
}

async function runTool(command: string, args: string[]) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
    });

    let stdout = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(command)} timed out.`));
    }, COMMAND_TIMEOUT_MS);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${path.basename(command)} failed with exit code ${code}.`));
    });
  });
}

async function probeDuration(filePath: string) {
  const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
  const output = await runTool(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);

  const duration = Number(output);

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not determine source video duration.");
  }

  return duration;
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const url = new URL(req.url);

    const jobId = safeSegment(url.searchParams.get("jobId") || "");
    const name = path.basename(url.searchParams.get("name") || "");

    if (!jobId || !name) {
      return NextResponse.json(
        { ok: false, error: "missing jobId or name" },
        { status: 400 },
      );
    }

    const filePath = safeJoin(jobRoot(owner.ownerKey), jobId, name);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { ok: false, error: "file not found" },
        { status: 404 },
      );
    }

    const data = await fsp.readFile(filePath);

    return new NextResponse(data, {
      headers: {
        "Content-Type": contentTypeFor(name),
        "Content-Length": String(data.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    return NextResponse.json(
      { ok: false, error: "Video segment could not be read." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const form = await req.formData();

    const video = form.get("video");
    const startTime = Number(form.get("start"));
    const requestedEndTime = Number(form.get("end"));

    if (!(video instanceof File) || video.size <= 0) {
      return NextResponse.json(
        { ok: false, error: "Select a source video." },
        { status: 400 },
      );
    }

    if (!VIDEO_EXT_RE.test(video.name)) {
      return NextResponse.json(
        { ok: false, error: "Select an MP4, WEBM, MOV, or MKV video." },
        { status: 400 },
      );
    }

    if (
      !Number.isFinite(startTime) ||
      !Number.isFinite(requestedEndTime) ||
      startTime < 0 ||
      requestedEndTime <= startTime
    ) {
      return NextResponse.json(
        { ok: false, error: "Choose a valid start and end time." },
        { status: 400 },
      );
    }

    const root = jobRoot(owner.ownerKey);
    ensureDir(root);

    const jobId = `dialogue-segment-${Date.now()}`;
    const jobDir = safeJoin(root, jobId);
    ensureDir(jobDir);

    const sourceExt = path.extname(video.name).toLowerCase() || ".mp4";
    const sourceFileName = `source${sourceExt}`;
    const sourcePath = safeJoin(jobDir, sourceFileName);
    const segmentFileName = "dialogue_segment.mp4";
    const segmentPath = safeJoin(jobDir, segmentFileName);

    await saveUpload(video, sourcePath);

    const sourceDuration = await probeDuration(sourcePath);

    if (startTime >= sourceDuration) {
      return NextResponse.json(
        { ok: false, error: "Start time is beyond the end of the video." },
        { status: 400 },
      );
    }

    if (requestedEndTime > sourceDuration + 0.05) {
      return NextResponse.json(
        { ok: false, error: "End time is beyond the end of the video." },
        { status: 400 },
      );
    }

    const endTime = Math.min(requestedEndTime, sourceDuration);
    const duration = endTime - startTime;

    if (duration < 0.05) {
      return NextResponse.json(
        { ok: false, error: "Selected video section is too short." },
        { status: 400 },
      );
    }

    const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

    await runTool(ffmpeg, [
      "-y",
      "-i",
      sourcePath,
      "-ss",
      startTime.toFixed(3),
      "-t",
      duration.toFixed(3),
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-sn",
      "-dn",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      "-avoid_negative_ts",
      "make_zero",
      segmentPath,
    ]);

    if (!fs.existsSync(segmentPath) || fs.statSync(segmentPath).size <= 0) {
      throw new Error("Video segment creation failed.");
    }

    const selection = {
      type: "dialogue-replacement-segment",
      phase: 2,
      operation: "select-dialogue-section",
      sourceOriginalName: video.name,
      sourceFileName,
      segmentFileName,
      startTime,
      endTime,
      duration,
      sourceDuration,
      createdAt: new Date().toISOString(),
    };

    await fsp.writeFile(
      safeJoin(jobDir, "selection.json"),
      JSON.stringify(selection, null, 2),
      "utf8",
    );

    return NextResponse.json(
      {
        ok: true,
        jobId,
        fileName: segmentFileName,
        url: `/api/edit-video/dialogue-segment?jobId=${encodeURIComponent(jobId)}&name=${encodeURIComponent(segmentFileName)}`,
        startTime,
        endTime,
        duration,
        sourceDuration,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    return NextResponse.json(
      { ok: false, error: "Video segment creation failed." },
      { status: 500 },
    );
  }
}
