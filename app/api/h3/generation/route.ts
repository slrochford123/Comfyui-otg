import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { createH3DirectJob, getH3DirectJob, h3DirectPublicStatus, startH3DirectJob, validateH3DirectInput, type H3DirectReference } from "@/lib/h3DirectJobs";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import {
  H3_ORIENTATION_OPTIONS,
  H3_PRODUCTION_DURATION_OPTIONS,
  H3_QUALITY_OPTIONS,
  type H3Orientation,
  type H3ProductionDuration,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";
import type { ProductionV2H3Mode } from "@/lib/production/h3Workflows";
import { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";
import { isAcceptedH3MediaFile, supportedH3MediaExtensions, type H3InputMediaKind } from "@/lib/h3MediaTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES: ProductionV2H3Mode[] = ["h3-text-to-video", "h3-image-to-video", "h3-reference-to-video"];
function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, { ...init, headers: { "Cache-Control": "private, no-store", ...(init?.headers || {}) } });
}

function parseConfig(form: FormData) {
  const raw = String(form.get("config") || "");
  const parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
  return parsed;
}

function descriptions(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()) : [];
}

async function saveFile(ownerKey: string, requestId: string, file: File, category: H3InputMediaKind, index: number) {
  if (!isAcceptedH3MediaFile(category, file)) {
    throw new Error(`Choose a supported H3 ${category} file (${supportedH3MediaExtensions(category).join(", ")}).`);
  }
  const extension = category === "image"
    ? ".png"
    : path.extname(file.name).toLowerCase() || (category === "video" ? ".mp4" : ".wav");
  const directory = safeJoin(OTG_DATA_ROOT, "h3-direct", safeSegment(ownerKey), "uploads", safeSegment(requestId));
  ensureDir(directory);
  const target = safeJoin(directory, `${category}-${index + 1}${extension}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (category === "image") {
    try {
      await sharp(bytes, { animated: false, failOn: "error", limitInputPixels: false })
        .rotate()
        .png()
        .toFile(target);
    } catch {
      throw new Error("This image format could not be decoded. Try PNG, JPEG, WebP, TIFF, AVIF, HEIC, GIF, BMP, or SVG.");
    }
  } else {
    await fsp.writeFile(target, bytes);
  }
  return { path: target, name: path.basename(file.name) };
}

async function fileList(form: FormData, key: string, ownerKey: string, requestId: string, category: H3InputMediaKind, notes: string[], audioFlags: boolean[] = []) {
  const files = form.getAll(key).filter((item): item is File => item instanceof File && item.size > 0);
  return Promise.all(files.map(async (file, index): Promise<H3DirectReference> => ({
    ...(await saveFile(ownerKey, requestId, file, category, index)),
    description: notes[index] || "",
    includeAudio: category === "video" ? audioFlags[index] === true : undefined,
  })));
}

function errorResponse(error: unknown) {
  if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
  return noStore({ ok: false, error: error instanceof Error ? error.message : "H3 generation request failed." }, { status: 400 });
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const { ownerKey } = owner;
    const id = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    const job = id ? await getH3DirectJob(ownerKey, id) : null;
    if (!job) return noStore({ ok: false, error: "H3 generation job not found." }, { status: 404 });
    return noStore({ ok: true, job: h3DirectPublicStatus(job) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const { ownerKey } = owner;
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.json().catch(() => null) as { action?: unknown; jobId?: unknown } | null;
      if (body?.action !== "retry") throw new Error("Unknown H3 generation action.");
      const source = await getH3DirectJob(ownerKey, String(body.jobId || ""));
      if (!source) throw new Error("H3 generation job not found.");
      const retry = await createH3DirectJob(ownerKey, source.input, source.galleryOwner || owner);
      startH3DirectJob(retry);
      return noStore({ ok: true, job: h3DirectPublicStatus(retry) }, { status: 202 });
    }
    const form = await req.formData();
    const config = parseConfig(form);
    const mode = String(config.mode || "") as ProductionV2H3Mode;
    const quality = String(config.quality || "") as H3Quality;
    const orientation = String(config.orientation || "") as H3Orientation;
    const durationSeconds = Number(config.durationSeconds) as H3ProductionDuration;
    if (!MODES.includes(mode)) throw new Error("Choose Text, Image, or Reference mode.");
    if (!H3_QUALITY_OPTIONS.includes(quality)) throw new Error("Choose LQ or HQ.");
    if (!H3_ORIENTATION_OPTIONS.includes(orientation)) throw new Error("Choose Landscape or Portrait orientation.");
    if (!H3_PRODUCTION_DURATION_OPTIONS.includes(durationSeconds)) throw new Error("Choose a 5- or 10-second duration.");

    const requestId = crypto.randomUUID();
    const imageDescriptions = descriptions(config.imageDescriptions);
    const videoDescriptions = descriptions(config.videoDescriptions);
    const audioDescriptions = descriptions(config.audioDescriptions);
    const videoAudioFlags = Array.isArray(config.videoAudioFlags) ? config.videoAudioFlags.map(Boolean) : [];
    const firstFiles = await fileList(form, "firstImage", ownerKey, requestId, "image", [""]);
    const lastFiles = await fileList(form, "lastImage", ownerKey, requestId, "image", [""]);
    const images = await fileList(form, "referenceImages", ownerKey, requestId, "image", imageDescriptions);
    const videos = await fileList(form, "referenceVideos", ownerKey, requestId, "video", videoDescriptions, videoAudioFlags);
    const audios = await fileList(form, "referenceAudios", ownerKey, requestId, "audio", audioDescriptions);

    const input = validateH3DirectInput({
      mode,
      quality,
      orientation,
      durationSeconds,
      prompt: String(config.prompt || "").trim(),
      seed: Number.isSafeInteger(Number(config.seed)) && Number(config.seed) >= 0 ? Number(config.seed) : crypto.randomBytes(6).readUIntBE(0, 6),
      optionalLoras: Array.isArray(config.optionalLoras) ? config.optionalLoras as any : [],
      firstImage: firstFiles[0] || null,
      lastImage: lastFiles[0] || null,
      images,
      videos,
      audios,
    });
    const job = await createH3DirectJob(ownerKey, input, owner);
    startH3DirectJob(job);
    return noStore({ ok: true, job: h3DirectPublicStatus(job) }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
