import fs from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { extractReferenceAudio, generateAceMusic } from "@/lib/aceStep";
import { getGallerySourcesForRequest, resolveGalleryItemByName } from "@/lib/gallery";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const VIDEO_RE = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;

function cleanTitle(value: string) {
  return String(value || "ace_music")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "ace_music";
}

function numberOr(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function outputUrl(filePath: string) {
  return `/api/file?path=${encodeURIComponent(filePath)}`;
}

async function saveUpload(file: File, outPath: string) {
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(outPath, bytes);
}

async function parseInput(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    return {
      prompt: String(form.get("prompt") || form.get("musicGeneratorPrompt") || ""),
      title: String(form.get("title") || ""),
      durationSeconds: numberOr(form.get("durationSeconds") || form.get("duration"), 30),
      bpm: numberOr(form.get("bpm"), 95),
      keyscale: String(form.get("keyscale") || form.get("key") || "E minor"),
      seed: numberOr(form.get("seed"), -1),
      referenceVideoName: String(form.get("referenceVideoName") || form.get("video_name") || ""),
      referenceVideoScope: String(form.get("referenceVideoScope") || form.get("video_scope") || ""),
      referenceVideoFile: form.get("referenceVideoFile") || form.get("video_file"),
    };
  }

  const body = await req.json().catch(() => ({}));
  const referenceVideo = body?.referenceVideo && typeof body.referenceVideo === "object" ? body.referenceVideo : {};
  return {
    prompt: String(body?.prompt || body?.musicGeneratorPrompt || ""),
    title: String(body?.title || ""),
    durationSeconds: numberOr(body?.durationSeconds || body?.duration, 30),
    bpm: numberOr(body?.bpm, 95),
    keyscale: String(body?.keyscale || body?.key || "E minor"),
    seed: numberOr(body?.seed, -1),
    referenceVideoName: String(referenceVideo.fileName || body?.referenceVideoName || ""),
    referenceVideoScope: String(referenceVideo.scope || body?.referenceVideoScope || ""),
    referenceVideoFile: null,
  };
}

async function resolveReferenceVideo(req: NextRequest, name: string, scopeHint: string) {
  const cleanName = path.basename(String(name || "").trim());
  if (!cleanName) return "";
  const { sources } = await getGallerySourcesForRequest(req);
  const hit = resolveGalleryItemByName({ sources, name: cleanName, scopeHint });
  return hit?.path || "";
}

export async function POST(req: NextRequest) {
  try {
    if (process.env.ACE_STEP_ENABLED === "0") {
      return NextResponse.json({ ok: false, error: "ACE-Step is disabled." }, { status: 503 });
    }

    const owner = await getOwnerContext(req);
    const input = await parseInput(req);
    const prompt = input.prompt.trim();
    if (!prompt) {
      return NextResponse.json({ ok: false, error: "Music prompt is required." }, { status: 400 });
    }

    const ownerKey = safeSegment(owner.ownerKey || "local");
    const jobId = `ace-music-${Date.now()}`;
    const jobDir = safeJoin(OTG_DATA_ROOT, "edit_video", "ace_music_jobs", ownerKey, jobId);
    const generatedDir = safeJoin(OTG_DATA_ROOT, "edit_video", "music", ownerKey, "generated");
    ensureDir(jobDir);
    ensureDir(generatedDir);

    let referenceAudioPath = "";
    const uploaded = input.referenceVideoFile;
    if (uploaded instanceof File && uploaded.size > 0) {
      const originalName = String(uploaded.name || "reference.mp4");
      if (!VIDEO_RE.test(originalName) && !String(uploaded.type || "").startsWith("video/")) {
        return NextResponse.json({ ok: false, error: "Reference upload must be a video file." }, { status: 400 });
      }
      const inputPath = safeJoin(jobDir, `reference${path.extname(originalName) || ".mp4"}`);
      await saveUpload(uploaded, inputPath);
      referenceAudioPath = await extractReferenceAudio(inputPath, safeJoin(jobDir, "reference.wav"), 4);
    } else if (input.referenceVideoName) {
      const videoPath = await resolveReferenceVideo(req, input.referenceVideoName, input.referenceVideoScope);
      if (videoPath) {
        referenceAudioPath = await extractReferenceAudio(videoPath, safeJoin(jobDir, "reference.wav"), 4);
      }
    }

    const generated = await generateAceMusic({
      prompt,
      durationSeconds: input.durationSeconds,
      bpm: input.bpm,
      keyscale: input.keyscale,
      seed: input.seed,
      referenceAudioPath,
    });

    const title = cleanTitle(input.title || prompt);
    const fileName = `${title}_ace_${Date.now()}.mp3`;
    const audioPath = safeJoin(generatedDir, fileName);
    await fs.writeFile(audioPath, generated.audioBuffer);
    const stat = await fs.stat(audioPath);
    const meta = {
      type: "edit-video-ace-step-music",
      source: "ace-step-1.5-api",
      operation: referenceAudioPath ? "reference-music-bed" : "text-music-bed",
      prompt,
      referenceVideoName: input.referenceVideoName || null,
      durationSeconds: generated.durationSeconds || input.durationSeconds,
      bpm: generated.bpm || input.bpm,
      keyscale: input.keyscale,
      model: generated.model || null,
      sizeBytes: stat.size,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(`${audioPath}.json`, JSON.stringify(meta, null, 2), "utf8");

    return NextResponse.json({
      ok: true,
      jobId,
      fileName,
      title,
      url: outputUrl(audioPath),
      audioPath,
      model: "turbo",
      prompt,
      durationSeconds: generated.durationSeconds || input.durationSeconds,
      bpm: generated.bpm || input.bpm,
      sizeBytes: stat.size,
      referenceUsed: Boolean(referenceAudioPath),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    if (error instanceof SessionInvalidError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: error?.message || "ACE-Step music generation failed." }, { status: 500 });
  }
}
