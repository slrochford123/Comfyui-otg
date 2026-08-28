import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getGallerySourcesForRequest, resolveGalleryItemByName } from "@/lib/gallery";
import { OTG_DATA_ROOT, ensureDir, safeSegment } from "@/lib/paths";
import { SessionInvalidError } from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CmdResult = { code: number; stdout: string; stderr: string };

type InputVideo = {
  path: string;
  label: string;
  title: string;
  source: "upload" | "gallery";
};

function editVideoJobRoot(ownerKey: string) {
  return path.join(OTG_DATA_ROOT, "edit_video_jobs", safeSegment(ownerKey || "local"));
}

function runCmd(command: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<CmdResult> {
  return new Promise((resolve) => {
    const child = execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({ code: error ? Number((error as any).code || 1) : 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });

    const timeoutMs = Number(opts.timeoutMs || 0);
    if (timeoutMs > 0) {
      setTimeout(() => {
        try { child.kill(); } catch {}
        resolve({ code: 124, stdout: "", stderr: `Command timed out after ${timeoutMs}ms: ${command}` });
      }, timeoutMs).unref?.();
    }
  });
}

function resolveDemucsCommand() {
  const configuredPython = String(process.env.OTG_DEMUCS_PYTHON || process.env.DEMUCS_PYTHON || "").trim();
  const candidates = [
    configuredPython,
    "C:\\AI\\demucs_env\\Scripts\\python.exe",
    "C:\\AI\\Demucs\\demucs_env\\Scripts\\python.exe",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { command: candidate, prefixArgs: ["-m", "demucs"] };
  }

  const configuredCmd = String(process.env.OTG_DEMUCS_CMD || "demucs").trim() || "demucs";
  return { command: configuredCmd, prefixArgs: [] as string[] };
}

function cleanFileName(value: string, fallback: string) {
  const parsed = path.parse(String(value || fallback));
  const stem = (parsed.name || fallback).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || fallback;
  return stem;
}

async function saveUploadedVideo(file: File, inputDir: string): Promise<string> {
  const safeName = path.basename(String(file.name || "uploaded_video.mp4")).replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_") || "uploaded_video.mp4";
  const target = path.join(inputDir, safeName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fsp.writeFile(target, buffer);
  return target;
}

async function resolveInput(req: NextRequest, form: FormData, inputDir: string): Promise<InputVideo> {
  const source = String(form.get("video_source") || "").trim();
  const title = String(form.get("video_title") || "Selected video").trim() || "Selected video";

  if (source === "upload") {
    const file = form.get("video_file") || form.get("file") || form.get("video");
    if (!(file instanceof File) || file.size <= 0) throw new Error("Missing uploaded video.");
    const saved = await saveUploadedVideo(file, inputDir);
    return { path: saved, label: path.basename(saved), title, source: "upload" };
  }

  if (source === "gallery") {
    const videoName = String(form.get("video_name") || "").trim();
    const videoScope = String(form.get("video_scope") || "").trim();
    if (!videoName) throw new Error("Missing gallery video_name.");
    const { sources } = await getGallerySourcesForRequest(req);
    const item = resolveGalleryItemByName({ sources, name: videoName, scopeHint: videoScope || null });
    if (!item || item.kind !== "video") throw new Error(`Gallery video not found: ${videoName}`);
    return { path: item.path, label: path.basename(item.path), title: item.name || title, source: "gallery" };
  }

  const directPath = String(form.get("videoPath") || form.get("video_path") || "").trim();
  if (directPath) return { path: directPath, label: path.basename(directPath), title, source: "gallery" };

  throw new Error("Choose a video first.");
}

async function probeVideo(filePath: string) {
  const result = await runCmd("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath], { timeoutMs: 30000 });
  if (result.code !== 0) return { durationSeconds: 0, width: 0, height: 0 };
  try {
    const parsed = JSON.parse(result.stdout || "{}");
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const video = streams.find((s: any) => s?.codec_type === "video") || {};
    const durationRaw = Number(video.duration || parsed?.format?.duration || 0);
    return {
      durationSeconds: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 0,
      width: Number(video.width || 0) || 0,
      height: Number(video.height || 0) || 0,
    };
  } catch {
    return { durationSeconds: 0, width: 0, height: 0 };
  }
}

export async function POST(req: NextRequest) {
  try {
    const enhance = req.nextUrl.searchParams.get("enhance") === "1";
    const form = await req.formData();
    const { owner } = await getGallerySourcesForRequest(req);
    const jobId = randomUUID();
    const jobRoot = editVideoJobRoot(owner.ownerKey);
    const jobDir = path.join(jobRoot, jobId);
    const inputDir = path.join(jobDir, "inputs");
    const demucsDir = path.join(jobDir, "demucs");
    ensureDir(inputDir);
    ensureDir(demucsDir);

    const input = await resolveInput(req, form, inputDir);
    if (!fs.existsSync(input.path)) throw new Error("Input video was not found on disk: " + input.path);

    const safeBase = cleanFileName(input.label, "remove_music");
    const titleRaw = String(form.get("title") || input.title || "cleaned_video").trim();
    const outputStem = cleanFileName(titleRaw || safeBase, "cleaned_video");
    const outputFileName = `${outputStem}${enhance ? "_clean_enhanced" : "_clean"}.mp4`;
    const outputPath = path.join(jobDir, outputFileName);
    const extractedAudio = path.join(inputDir, `${safeBase}_audio.wav`);
    const enhancedAudio = path.join(inputDir, `${safeBase}_enhanced.wav`);

    const extract = await runCmd("ffmpeg", ["-y", "-i", input.path, "-q:a", "0", "-map", "a", extractedAudio], { timeoutMs: 5 * 60 * 1000 });
    if (extract.code !== 0) throw new Error("FFmpeg audio extraction failed: " + (extract.stderr || extract.stdout));

    const demucs = resolveDemucsCommand();
    const demucsArgs = [...demucs.prefixArgs, "-n", "mdx_extra_q", "--mp3", "-o", demucsDir, extractedAudio];
    const separate = await runCmd(demucs.command, demucsArgs, { timeoutMs: 30 * 60 * 1000 });
    if (separate.code !== 0) throw new Error("Demucs failed: " + (separate.stderr || separate.stdout));

    const vocalsMp3 = path.join(demucsDir, "mdx_extra_q", `${safeBase}_audio`, "vocals.mp3");
    if (!fs.existsSync(vocalsMp3)) throw new Error("Demucs output not found: " + vocalsMp3);

    const audioForMux = enhance ? enhancedAudio : vocalsMp3;
    if (enhance) {
      const filter = "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,highpass=f=80,lowpass=f=12000";
      const enhanceRun = await runCmd("ffmpeg", ["-y", "-i", vocalsMp3, "-af", filter, enhancedAudio], { timeoutMs: 5 * 60 * 1000 });
      if (enhanceRun.code !== 0) throw new Error("FFmpeg enhancement failed: " + (enhanceRun.stderr || enhanceRun.stdout));
    }

    const rebuild = await runCmd("ffmpeg", [
      "-y",
      "-i", input.path,
      "-i", audioForMux,
      "-c:v", "copy",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-ar", "48000",
      "-movflags", "+faststart",
      outputPath,
    ], { timeoutMs: 10 * 60 * 1000 });
    if (rebuild.code !== 0) throw new Error("FFmpeg rebuild failed: " + (rebuild.stderr || rebuild.stdout));

    const probe = await probeVideo(outputPath);
    const stat = fs.statSync(outputPath);
    const url = `/api/edit-video/file?jobId=${encodeURIComponent(jobId)}&name=${encodeURIComponent(outputFileName)}&v=${Date.now()}`;

    return NextResponse.json({
      ok: true,
      jobId,
      fileName: outputFileName,
      url,
      durationSeconds: probe.durationSeconds,
      sizeBytes: stat.size,
      target: { width: probe.width, height: probe.height },
      enhanced: enhance,
      source: { title: input.title, label: input.label, source: input.source },
    });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "Remove music failed." }, { status: 500 });
  }
}
