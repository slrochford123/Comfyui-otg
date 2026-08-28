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

type ExtractMode = "raw" | "enhance";

const VIDEO_RE = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;
const DEFAULT_ENHANCE_FILTER = "highpass=f=80,lowpass=f=12000,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11";
const COMMAND_TIMEOUT_MS = Number(process.env.EXTRACT_AUDIO_TIMEOUT_MS || 300000);

function voiceGalleryRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "voice_gallery", safeSegment(ownerKey || "local"));
}

function cleanTitle(value: string) {
  return String(value || "extracted_voice_audio")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "extracted_voice_audio";
}

function ffmpegExe() {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

function ffprobeExe() {
  const configured = process.env.FFPROBE_PATH?.trim();
  if (configured) return configured;
  const ffmpeg = ffmpegExe();
  if (/ffmpeg(?:\.exe)?$/i.test(ffmpeg)) return ffmpeg.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
  return "ffprobe";
}

async function saveUpload(file: File, outPath: string) {
  const bytes = Buffer.from(await file.arrayBuffer());
  await fsp.writeFile(outPath, bytes);
}

async function runProcess(command: string, args: string[], timeoutMs = COMMAND_TIMEOUT_MS) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false });
    let stderr = "";
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(command)} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} failed with exit code ${code}. ${stderr || stdout}`.slice(0, 5000)));
    });
  });
}

async function probeDurationSeconds(filePath: string) {
  try {
    const command = ffprobeExe();
    const args = ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath];
    const value = await new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, { windowsHide: true, shell: false });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("ffprobe timed out"));
      }, 30000);
      child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(stderr || stdout));
      });
    });
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
  } catch {
    return undefined;
  }
}

function audioUrl(fileName: string) {
  return `/api/edit-video/extract-audio/file?name=${encodeURIComponent(fileName)}`;
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const form = await req.formData();
    const video = form.get("video");
    if (!(video instanceof File) || video.size <= 0) {
      return NextResponse.json({ ok: false, error: "video is required." }, { status: 400 });
    }

    const originalName = String(video.name || "video.mp4");
    if (!VIDEO_RE.test(originalName) && !String(video.type || "").startsWith("video/")) {
      return NextResponse.json({ ok: false, error: "Upload a video file." }, { status: 400 });
    }

    const mode: ExtractMode = String(form.get("mode") || "raw").toLowerCase() === "enhance" ? "enhance" : "raw";
    const title = cleanTitle(String(form.get("title") || originalName));
    const galleryRoot = voiceGalleryRoot(owner.ownerKey);
    const jobsRoot = path.join(OTG_DATA_ROOT, "extract_audio_jobs", safeSegment(owner.ownerKey || "local"));
    ensureDir(galleryRoot);
    ensureDir(jobsRoot);

    const jobId = `extract-audio-${Date.now()}`;
    const jobDir = safeJoin(jobsRoot, jobId);
    ensureDir(jobDir);

    const inputExt = path.extname(originalName).toLowerCase() || ".mp4";
    const inputPath = safeJoin(jobDir, `input${inputExt}`);
    const fileName = `${title}_${mode}_${Date.now()}.wav`;
    const outputPath = safeJoin(galleryRoot, fileName);
    await saveUpload(video, inputPath);

    const args = ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "44100"];
    if (mode === "enhance") {
      args.push("-af", process.env.EXTRACT_AUDIO_ENHANCE_FILTER || DEFAULT_ENHANCE_FILTER);
    }
    args.push("-c:a", "pcm_s16le", outputPath);
    await runProcess(ffmpegExe(), args);

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
      throw new Error("Audio extraction did not write an output file.");
    }

    const stat = fs.statSync(outputPath);
    const durationSeconds = await probeDurationSeconds(outputPath);
    const meta = {
      type: "voice-gallery-audio",
      source: "edit-video-extract-audio",
      operation: mode === "enhance" ? "extract-audio-enhance" : "extract-audio",
      mode,
      sourceVideoName: originalName,
      outputFileName: fileName,
      sizeBytes: stat.size,
      durationSeconds: durationSeconds || null,
      createdAt: new Date().toISOString(),
    };
    await fsp.writeFile(`${outputPath}.json`, JSON.stringify(meta, null, 2), "utf8");

    return NextResponse.json({
      ok: true,
      jobId,
      fileName,
      mode,
      url: audioUrl(fileName),
      sizeBytes: stat.size,
      durationSeconds,
      message: mode === "enhance" ? "Enhanced audio extracted and saved to the voices gallery." : "Raw audio extracted and saved to the voices gallery.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "Audio extraction failed" }, { status: 500 });
  }
}
