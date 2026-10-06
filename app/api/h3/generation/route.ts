import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { cancelH3DirectJob, createH3DirectJob, ensureH3DirectJobRunner, getH3DirectJob, getLatestH3DirectJob, h3DirectPublicStatus, startH3DirectJob, validateH3DirectInput, type H3DirectReference } from "@/lib/h3DirectJobs";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import {
  H3_ORIENTATION_OPTIONS,
  H3_PRODUCTION_DURATION_OPTIONS,
  H3_QUALITY_OPTIONS,
  getH3NativeDimensions,
  type H3Orientation,
  type H3ProductionDuration,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";
import type { ProductionV2H3Mode } from "@/lib/production/h3Workflows";
import { normalizeH3AdvancedSettings } from "@/lib/production/h3Settings";
import { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";
import { isAcceptedH3MediaFile, supportedH3MediaExtensions, type H3InputMediaKind } from "@/lib/h3MediaTypes";
import { readCompletedH3StagedUpload } from "@/lib/h3StagedUploads";
import {
  H3_REFERENCE_VIDEO_CLIP_SECONDS,
  trimH3ReferenceVideoClip,
} from "@/lib/h3ReferenceVideoClip";
import {
  composeH3StylePrompt,
  resolveH3StylePreset,
} from "@/lib/h3StylePresets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES: ProductionV2H3Mode[] = ["h3-text-to-video", "h3-image-to-video", "h3-reference-to-video"];
type OwnerContext = Awaited<ReturnType<typeof getOwnerContext>>;
type SavedH3Media = {
  path: string;
  name: string;
};
type H3GenerationMedia = {
  firstFiles: H3DirectReference[];
  lastFiles: H3DirectReference[];
  images: H3DirectReference[];
  videos: H3DirectReference[];
  audios: H3DirectReference[];
};
type H3StagedGenerationMedia = {
  firstImage?: unknown;
  lastImage?: unknown;
  referenceImages?: unknown;
  referenceVideos?: unknown;
  referenceAudios?: unknown;
};
type H3ReferenceVideoClipBounds = {
  maxWidth: number;
  maxHeight: number;
};

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

function numbers(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => Number(item)).map((item) => Number.isFinite(item) ? item : 0)
    : [];
}

function h3ReferenceVideoClipBounds(config: Record<string, unknown>): H3ReferenceVideoClipBounds {
  const quality = String(config.quality || "") as H3Quality;
  const orientation = String(config.orientation || "") as H3Orientation;
  if (!H3_QUALITY_OPTIONS.includes(quality)) throw new Error("Choose SH, LQ, or HQ.");
  if (!H3_ORIENTATION_OPTIONS.includes(orientation)) throw new Error("Choose Landscape or Portrait orientation.");
  const dimensions = getH3NativeDimensions(quality, orientation);
  return {
    maxWidth: dimensions.width,
    maxHeight: dimensions.height,
  };
}

async function saveMediaBytes(
  ownerKey: string,
  requestId: string,
  source: {
    name: string;
    type: string;
    bytes: Buffer;
  },
  category: H3InputMediaKind,
  index: number,
) {
  if (!isAcceptedH3MediaFile(category, source)) {
    throw new Error(`Choose a supported H3 ${category} file (${supportedH3MediaExtensions(category).join(", ")}).`);
  }
  const extension = category === "image"
    ? ".png"
    : path.extname(source.name).toLowerCase() || (category === "video" ? ".mp4" : ".wav");
  const directory = safeJoin(OTG_DATA_ROOT, "h3-direct", safeSegment(ownerKey), "uploads", safeSegment(requestId));
  ensureDir(directory);
  const target = safeJoin(directory, `${category}-${index + 1}${extension}`);
  const bytes = source.bytes;
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
  return { path: target, name: path.basename(source.name) };
}

async function saveFile(ownerKey: string, requestId: string, file: File, category: H3InputMediaKind, index: number) {
  return saveMediaBytes(
    ownerKey,
    requestId,
    {
      name: file.name,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    },
    category,
    index,
  );
}

async function saveStagedFile(
  ownerKey: string,
  requestId: string,
  value: unknown,
  category: H3InputMediaKind,
  index: number,
) {
  const staged = await readCompletedH3StagedUpload(ownerKey, value, category);
  return saveMediaBytes(
    ownerKey,
    requestId,
    {
      name: staged.name,
      type: staged.type,
      bytes: await fsp.readFile(staged.path),
    },
    category,
    index,
  );
}

async function toH3Reference(
  saved: SavedH3Media,
  category: H3InputMediaKind,
  index: number,
  notes: string[],
  audioFlags: boolean[] = [],
  videoClipStarts: number[] = [],
  videoClipBounds?: H3ReferenceVideoClipBounds,
): Promise<H3DirectReference> {
  if (category !== "video") {
    return {
      ...saved,
      description: notes[index] || "",
      includeAudio: undefined,
    };
  }

  const includeAudio = audioFlags[index] === true;
  const clip = await trimH3ReferenceVideoClip({
    inputPath: saved.path,
    outputDir: path.join(path.dirname(saved.path), "clips"),
    outputPrefix: `${path.parse(saved.name).name || `video-${index + 1}`}`,
    startSeconds: videoClipStarts[index] || 0,
    includeAudio,
    maxWidth: videoClipBounds?.maxWidth,
    maxHeight: videoClipBounds?.maxHeight,
  });

  return {
    path: clip.outputPath,
    name: `${path.parse(saved.name).name || `video-${index + 1}`}_clip_${clip.startSeconds.toFixed(2)}s_${H3_REFERENCE_VIDEO_CLIP_SECONDS}s.mp4`,
    description: [
      notes[index] || "",
      `Use selected ${H3_REFERENCE_VIDEO_CLIP_SECONDS}-second reference window ${clip.startSeconds.toFixed(2)}s-${(clip.startSeconds + H3_REFERENCE_VIDEO_CLIP_SECONDS).toFixed(2)}s.`,
    ].filter(Boolean).join(" "),
    includeAudio,
  };
}

async function fileList(
  form: FormData,
  key: string,
  ownerKey: string,
  requestId: string,
  category: H3InputMediaKind,
  notes: string[],
  audioFlags: boolean[] = [],
  videoClipStarts: number[] = [],
  videoClipBounds?: H3ReferenceVideoClipBounds,
) {
  const files = form.getAll(key).filter((item): item is File => item instanceof File && item.size > 0);
  return Promise.all(files.map(async (file, index): Promise<H3DirectReference> => {
    const saved = await saveFile(ownerKey, requestId, file, category, index);
    return toH3Reference(saved, category, index, notes, audioFlags, videoClipStarts, videoClipBounds);
  }));
}

async function stagedList(
  values: unknown,
  ownerKey: string,
  requestId: string,
  category: H3InputMediaKind,
  notes: string[],
  audioFlags: boolean[] = [],
  videoClipStarts: number[] = [],
  videoClipBounds?: H3ReferenceVideoClipBounds,
) {
  const uploads = Array.isArray(values)
    ? values
    : values
      ? [values]
      : [];

  return Promise.all(uploads.map(async (value, index): Promise<H3DirectReference> => {
    const saved = await saveStagedFile(ownerKey, requestId, value, category, index);
    return toH3Reference(saved, category, index, notes, audioFlags, videoClipStarts, videoClipBounds);
  }));
}

function errorResponse(error: unknown) {
  if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
  return noStore({ ok: false, error: error instanceof Error ? error.message : "H3 generation request failed." }, { status: 400 });
}

function freshH3RetrySeed(previousSeed: number) {
  let nextSeed = crypto.randomBytes(6).readUIntBE(0, 6);
  while (nextSeed === previousSeed) {
    nextSeed = crypto.randomBytes(6).readUIntBE(0, 6);
  }
  return nextSeed;
}

function readH3GenerationConfig(
  config: Record<string, unknown>,
) {
  const mode = String(config.mode || "") as ProductionV2H3Mode;
  const quality = String(config.quality || "") as H3Quality;
  const orientation = String(config.orientation || "") as H3Orientation;
  const durationSeconds = Number(config.durationSeconds) as H3ProductionDuration;
  if (!MODES.includes(mode)) throw new Error("Choose Text, Image, or Reference mode.");
  if (!H3_QUALITY_OPTIONS.includes(quality)) throw new Error("Choose SH, LQ, or HQ.");
  if (!H3_ORIENTATION_OPTIONS.includes(orientation)) throw new Error("Choose Landscape or Portrait orientation.");
  if (!H3_PRODUCTION_DURATION_OPTIONS.includes(durationSeconds)) throw new Error("Choose a 5- or 10-second duration.");

  const rawPrompt = String(config.prompt || "").trim();
  const stylePreset = resolveH3StylePreset(config.stylePresetId);
  const finalPrompt = composeH3StylePrompt(rawPrompt, stylePreset);

  return {
    mode,
    quality,
    orientation,
    durationSeconds,
    finalPrompt,
    h3Settings: config.h3Settings,
    seed: Number.isSafeInteger(Number(config.seed)) && Number(config.seed) >= 0 ? Number(config.seed) : crypto.randomBytes(6).readUIntBE(0, 6),
    optionalLoras: Array.isArray(config.optionalLoras) ? config.optionalLoras as any : [],
  };
}

async function startGenerationJob(
  ownerKey: string,
  owner: OwnerContext,
  config: Record<string, unknown>,
  media: H3GenerationMedia,
) {
  const generation =
    readH3GenerationConfig(
      config,
    );

  const input = validateH3DirectInput({
    mode: generation.mode,
    quality: generation.quality,
    orientation: generation.orientation,
    durationSeconds: generation.durationSeconds,
    prompt: generation.finalPrompt,
    h3Settings: normalizeH3AdvancedSettings(
      generation.h3Settings,
      media.images.length,
    ),
    seed: generation.seed,
    optionalLoras: generation.optionalLoras,
    firstImage: media.firstFiles[0] || null,
    lastImage: media.lastFiles[0] || null,
    images: media.images,
    videos: media.videos,
    audios: media.audios,
  });
  const job = await createH3DirectJob(ownerKey, input, owner);
  startH3DirectJob(job);
  return noStore({ ok: true, job: h3DirectPublicStatus(job) }, { status: 202 });
}

async function stagedMedia(
  ownerKey: string,
  requestId: string,
  config: Record<string, unknown>,
  staged: H3StagedGenerationMedia,
): Promise<H3GenerationMedia> {
  const imageDescriptions = descriptions(config.imageDescriptions);
  const videoDescriptions = descriptions(config.videoDescriptions);
  const audioDescriptions = descriptions(config.audioDescriptions);
  const videoAudioFlags = Array.isArray(config.videoAudioFlags) ? config.videoAudioFlags.map(Boolean) : [];
  const videoClipStarts = numbers(config.videoClipStartSeconds);
  const videoClipBounds =
    h3ReferenceVideoClipBounds(
      config,
    );

  return {
    firstFiles: await stagedList(staged.firstImage, ownerKey, requestId, "image", [""]),
    lastFiles: await stagedList(staged.lastImage, ownerKey, requestId, "image", [""]),
    images: await stagedList(staged.referenceImages, ownerKey, requestId, "image", imageDescriptions),
    videos: await stagedList(staged.referenceVideos, ownerKey, requestId, "video", videoDescriptions, videoAudioFlags, videoClipStarts, videoClipBounds),
    audios: await stagedList(staged.referenceAudios, ownerKey, requestId, "audio", audioDescriptions),
  };
}

async function multipartMedia(
  form: FormData,
  ownerKey: string,
  requestId: string,
  config: Record<string, unknown>,
): Promise<H3GenerationMedia> {
  const imageDescriptions = descriptions(config.imageDescriptions);
  const videoDescriptions = descriptions(config.videoDescriptions);
  const audioDescriptions = descriptions(config.audioDescriptions);
  const videoAudioFlags = Array.isArray(config.videoAudioFlags) ? config.videoAudioFlags.map(Boolean) : [];
  const videoClipStarts = numbers(config.videoClipStartSeconds);
  const videoClipBounds =
    h3ReferenceVideoClipBounds(
      config,
    );

  return {
    firstFiles: await fileList(form, "firstImage", ownerKey, requestId, "image", [""]),
    lastFiles: await fileList(form, "lastImage", ownerKey, requestId, "image", [""]),
    images: await fileList(form, "referenceImages", ownerKey, requestId, "image", imageDescriptions),
    videos: await fileList(form, "referenceVideos", ownerKey, requestId, "video", videoDescriptions, videoAudioFlags, videoClipStarts, videoClipBounds),
    audios: await fileList(form, "referenceAudios", ownerKey, requestId, "audio", audioDescriptions),
  };
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const { ownerKey } = owner;
    const id = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    const job = id ? await getH3DirectJob(ownerKey, id) : await getLatestH3DirectJob(ownerKey);
    if (!job) {
      return id
        ? noStore({ ok: false, error: "H3 generation job not found." }, { status: 404 })
        : noStore({ ok: true, job: null });
    }
    ensureH3DirectJobRunner(job);
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
      const body = await req.json().catch(() => null) as {
        action?: unknown;
        jobId?: unknown;
        config?: unknown;
        staged?: H3StagedGenerationMedia;
      } | null;
      if (body?.action === "cancel") {
        const canceled = await cancelH3DirectJob(ownerKey, String(body.jobId || ""));
        return noStore({ ok: true, job: h3DirectPublicStatus(canceled) });
      }
      if (body?.action === "retry") {
        const source = await getH3DirectJob(ownerKey, String(body.jobId || ""));
        if (!source) throw new Error("H3 generation job not found.");
        const retryInput = {
          ...source.input,
          seed: freshH3RetrySeed(source.input.seed),
        };
        const retry = await createH3DirectJob(ownerKey, retryInput, source.galleryOwner || owner);
        startH3DirectJob(retry);
        return noStore({ ok: true, job: h3DirectPublicStatus(retry) }, { status: 202 });
      }
      if (body?.config && typeof body.config === "object") {
        const requestId = crypto.randomUUID();
        const config = body.config as Record<string, unknown>;
        const media = await stagedMedia(
          ownerKey,
          requestId,
          config,
          body.staged || {},
        );
        return await startGenerationJob(
          ownerKey,
          owner,
          config,
          media,
        );
      }
      throw new Error("Unknown H3 generation action.");
    }
    const form = await req.formData();
    const config = parseConfig(form);
    const requestId = crypto.randomUUID();
    const media = await multipartMedia(
      form,
      ownerKey,
      requestId,
      config,
    );
    return await startGenerationJob(
      ownerKey,
      owner,
      config,
      media,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
