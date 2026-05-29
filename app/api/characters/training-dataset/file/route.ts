import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";

import {
  resolveTrainingDatasetCanonicalSourcePath,
  resolveTrainingDatasetClipPath,
} from "@/lib/jobs/trainingDatasetManifest";
import { mediaFileResponse } from "@/lib/mediaResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSafeSegment(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return false;
  return /^[a-zA-Z0-9._-]+$/.test(trimmed);
}

function jsonError(error: string, status = 400) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function serveTrainingDatasetClip(req: NextRequest, method: "GET" | "HEAD") {
  const owner = String(req.nextUrl.searchParams.get("owner") || "").trim();
  const characterId = String(req.nextUrl.searchParams.get("characterId") || "").trim();
  const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();
  const clipId = String(req.nextUrl.searchParams.get("clipId") || "").trim();
  const file = String(req.nextUrl.searchParams.get("file") || "").trim();

  if (!isSafeSegment(owner)) return jsonError("Invalid owner.", 400);
  if (!isSafeSegment(characterId)) return jsonError("Invalid characterId.", 400);
  if (!isSafeSegment(jobId)) return jsonError("Invalid jobId.", 400);
  if (file && file !== "source.wav") return jsonError("Invalid training dataset file.", 400);
  if (!file && !/^clip_\d{3}$/.test(clipId)) return jsonError("Invalid clipId.", 400);

  let clipPath: string;
  try {
    clipPath = file === "source.wav"
      ? resolveTrainingDatasetCanonicalSourcePath(owner, characterId, jobId)
      : resolveTrainingDatasetClipPath(owner, characterId, jobId, clipId);
  } catch {
    return jsonError("Invalid training dataset clip path.", 400);
  }

  if (!(await fileExists(clipPath))) {
    return jsonError(file === "source.wav" ? "Training dataset source not found." : "Training dataset clip not found.", 404);
  }

  const response = mediaFileResponse(req, clipPath, {
    method,
    contentType: "audio/wav",
    download: req.nextUrl.searchParams.get("download") === "1",
    fileName: file === "source.wav" ? "source.wav" : `${clipId}.wav`,
    cacheControl: "private, no-store",
  });

  response.headers.set("X-OTG-Training-Dataset-Clip", "1");
  response.headers.set("X-OTG-Resolved-Clip", file === "source.wav" ? "source.wav" : clipId);

  return response;
}

export async function GET(req: NextRequest) {
  return serveTrainingDatasetClip(req, "GET");
}

export async function HEAD(req: NextRequest) {
  return serveTrainingDatasetClip(req, "HEAD");
}
