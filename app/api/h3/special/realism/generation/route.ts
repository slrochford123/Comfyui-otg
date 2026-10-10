import { validateH3LoraSelections } from "@/lib/h3LoraCatalogServer";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { probeDurationSeconds } from "@/lib/ffmpeg";
import { isAcceptedH3MediaFile, supportedH3MediaExtensions, type H3InputMediaKind } from "@/lib/h3MediaTypes";
import { readCompletedH3StagedUpload } from "@/lib/h3StagedUploads";
import {
  cancelH3RealismJob,
  createH3RealismJob,
  ensureH3RealismJobRunner,
  getH3RealismJob,
  getLatestH3RealismJob,
  h3RealismPublicStatus,
  startH3RealismJob,
  validateH3RealismJobInput,
  type H3RealismReference,
} from "@/lib/h3SpecialModes/realismJobs";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import {
  H3_ORIENTATION_OPTIONS,
  H3_PRODUCTION_DURATION_OPTIONS,
  H3_QUALITY_OPTIONS,
  type H3Orientation,
  type H3ProductionDuration,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";
import { ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OwnerContext = Awaited<ReturnType<typeof getOwnerContext>>;
type SavedH3RealismMedia = {
  path: string;
  name: string;
  durationSeconds?: number | null;
};
type H3RealismMedia = {
  images: H3RealismReference[];
  videos: H3RealismReference[];
  audios: H3RealismReference[];
};
type H3RealismStagedMedia = {
  referenceImages?: unknown;
  referenceVideos?: unknown;
  referenceAudios?: unknown;
};

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, { ...init, headers: { "Cache-Control": "private, no-store", ...(init?.headers || {}) } });
}

function parseConfig(form: FormData) {
  const raw = String(form.get("config") || "");
  return JSON.parse(raw || "{}") as Record<string, unknown>;
}

function descriptions(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()) : [];
}

function numbers(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => Number(item)).map((item) => Number.isFinite(item) ? item : null)
    : [];
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
): Promise<SavedH3RealismMedia> {
  if (!isAcceptedH3MediaFile(category, source)) {
    throw new Error(`Choose a supported H3 Realism ${category} file (${supportedH3MediaExtensions(category).join(", ")}).`);
  }
  const extension = category === "image"
    ? ".png"
    : path.extname(source.name).toLowerCase() || (category === "video" ? ".mp4" : ".wav");
  const directory = safeJoin(OTG_DATA_ROOT, "h3-special", "realism", safeSegment(ownerKey), "uploads", safeSegment(requestId));
  ensureDir(directory);
  const target = safeJoin(directory, `${category}-${index + 1}${extension}`);
  if (category === "image") {
    try {
      await sharp(source.bytes, { animated: false, failOn: "error", limitInputPixels: false })
        .rotate()
        .png()
        .toFile(target);
    } catch {
      throw new Error("This image format could not be decoded. Try PNG, JPEG, WebP, TIFF, AVIF, HEIC, GIF, BMP, or SVG.");
    }
    return { path: target, name: path.basename(source.name) };
  }

  await fsp.writeFile(target, source.bytes);
  const durationSeconds = await probeDurationSeconds(target);
  if (!Number.isFinite(durationSeconds)) {
    throw new Error(`Could not read the duration for ${source.name}. Use a standard ${category} file with readable timing metadata.`);
  }
  return { path: target, name: path.basename(source.name), durationSeconds };
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

function toRealismReference(
  saved: SavedH3RealismMedia,
  category: H3InputMediaKind,
  index: number,
  notes: string[],
  configuredDurations: Array<number | null>,
): H3RealismReference {
  return {
    kind: category,
    path: saved.path,
    name: saved.name,
    description: notes[index] || "",
    durationSeconds: saved.durationSeconds ?? configuredDurations[index] ?? null,
  };
}

async function fileList(
  form: FormData,
  key: string,
  ownerKey: string,
  requestId: string,
  category: H3InputMediaKind,
  notes: string[],
  durations: Array<number | null>,
) {
  const files = form.getAll(key).filter((item): item is File => item instanceof File && item.size > 0);
  return Promise.all(files.map(async (file, index): Promise<H3RealismReference> => {
    const saved = await saveFile(ownerKey, requestId, file, category, index);
    return toRealismReference(saved, category, index, notes, durations);
  }));
}

async function stagedList(
  values: unknown,
  ownerKey: string,
  requestId: string,
  category: H3InputMediaKind,
  notes: string[],
  durations: Array<number | null>,
) {
  const uploads = Array.isArray(values)
    ? values
    : values
      ? [values]
      : [];

  return Promise.all(uploads.map(async (value, index): Promise<H3RealismReference> => {
    const saved = await saveStagedFile(ownerKey, requestId, value, category, index);
    return toRealismReference(saved, category, index, notes, durations);
  }));
}

function errorResponse(error: unknown) {
  if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
  return noStore({ ok: false, error: error instanceof Error ? error.message : "H3 Realism generation request failed." }, { status: 400 });
}

function freshH3RealismRetrySeed(previousSeed: number) {
  let nextSeed = crypto.randomBytes(6).readUIntBE(0, 6);
  while (nextSeed === previousSeed) {
    nextSeed = crypto.randomBytes(6).readUIntBE(0, 6);
  }
  return nextSeed;
}

function readH3RealismGenerationConfig(
  config: Record<string, unknown>,
) {
  const mode = String(config.mode || "");
  const quality = String(config.quality || "") as H3Quality;
  const orientation = String(config.orientation || "") as H3Orientation;
  const durationSeconds = Number(config.durationSeconds) as H3ProductionDuration;
  if (mode !== "h3-realism") throw new Error("Choose Realism mode.");
  if (!H3_QUALITY_OPTIONS.includes(quality)) throw new Error("Choose SH, LQ, or HQ.");
  if (!H3_ORIENTATION_OPTIONS.includes(orientation)) throw new Error("Choose Landscape or Portrait orientation.");
  if (!H3_PRODUCTION_DURATION_OPTIONS.includes(durationSeconds)) throw new Error("Choose a 5- or 10-second duration.");

  const checkpointMode: "standard" | "singularity" =
    config.checkpointMode === "singularity"
      ? "singularity"
      : "standard";

  return {
    mode: "h3-realism" as const,
    quality,
    orientation,
    durationSeconds,
    prompt: String(config.prompt || "").trim(),
    compiledPromptOverride: String(config.compiledPromptOverride || "").trim(),
    rifeInterpolation60Fps: config.rifeInterpolation60Fps === true,
    seed: Number.isSafeInteger(Number(config.seed)) && Number(config.seed) >= 0 ? Number(config.seed) : crypto.randomBytes(6).readUIntBE(0, 6),
    checkpointMode,
    combatLoraEnabled:
      checkpointMode === "singularity"
      && config.combatLoraEnabled === true,
    loraSettings: config.loraSettings && typeof config.loraSettings === "object"
      ? config.loraSettings as Record<string, unknown>
      : undefined,
    optionalLoras: validateH3LoraSelections(
      config.optionalLoras,
      "h3-realism",
    ).resolved,
  };
}

async function startGenerationJob(
  ownerKey: string,
  owner: OwnerContext,
  config: Record<string, unknown>,
  media: H3RealismMedia,
) {
  const generation = readH3RealismGenerationConfig(config);
  const input = validateH3RealismJobInput({
    ...generation,
    references: [
      ...media.images,
      ...media.videos,
      ...media.audios,
    ],
  });
  const job = await createH3RealismJob(ownerKey, input, owner);
  startH3RealismJob(job);
  return noStore({ ok: true, job: h3RealismPublicStatus(job) }, { status: 202 });
}

async function stagedMedia(
  ownerKey: string,
  requestId: string,
  config: Record<string, unknown>,
  staged: H3RealismStagedMedia,
): Promise<H3RealismMedia> {
  const imageDescriptions = descriptions(config.imageDescriptions);
  const videoDescriptions = descriptions(config.videoDescriptions);
  const audioDescriptions = descriptions(config.audioDescriptions);
  const videoDurations = numbers(config.videoDurations);
  const audioDurations = numbers(config.audioDurations);

  return {
    images: await stagedList(staged.referenceImages, ownerKey, requestId, "image", imageDescriptions, []),
    videos: await stagedList(staged.referenceVideos, ownerKey, requestId, "video", videoDescriptions, videoDurations),
    audios: await stagedList(staged.referenceAudios, ownerKey, requestId, "audio", audioDescriptions, audioDurations),
  };
}

async function multipartMedia(
  form: FormData,
  ownerKey: string,
  requestId: string,
  config: Record<string, unknown>,
): Promise<H3RealismMedia> {
  const imageDescriptions = descriptions(config.imageDescriptions);
  const videoDescriptions = descriptions(config.videoDescriptions);
  const audioDescriptions = descriptions(config.audioDescriptions);
  const videoDurations = numbers(config.videoDurations);
  const audioDurations = numbers(config.audioDurations);

  return {
    images: await fileList(form, "referenceImages", ownerKey, requestId, "image", imageDescriptions, []),
    videos: await fileList(form, "referenceVideos", ownerKey, requestId, "video", videoDescriptions, videoDurations),
    audios: await fileList(form, "referenceAudios", ownerKey, requestId, "audio", audioDescriptions, audioDurations),
  };
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const { ownerKey } = owner;
    const id = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    const job = id ? await getH3RealismJob(ownerKey, id) : await getLatestH3RealismJob(ownerKey);
    if (!job) {
      return id
        ? noStore({ ok: false, error: "H3 Realism job not found." }, { status: 404 })
        : noStore({ ok: true, job: null });
    }
    ensureH3RealismJobRunner(job);
    return noStore({ ok: true, job: h3RealismPublicStatus(job) });
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
        staged?: H3RealismStagedMedia;
      } | null;
      if (body?.action === "cancel") {
        const canceled = await cancelH3RealismJob(ownerKey, String(body.jobId || ""));
        return noStore({ ok: true, job: h3RealismPublicStatus(canceled) });
      }
      if (body?.action === "retry") {
        const source = await getH3RealismJob(ownerKey, String(body.jobId || ""));
        if (!source) throw new Error("H3 Realism job not found.");
        const retryInput = {
          ...source.input,
          seed: freshH3RealismRetrySeed(source.input.seed),
        };
        const retry = await createH3RealismJob(ownerKey, retryInput, source.galleryOwner || owner);
        startH3RealismJob(retry);
        return noStore({ ok: true, job: h3RealismPublicStatus(retry) }, { status: 202 });
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
        return await startGenerationJob(ownerKey, owner, config, media);
      }
      throw new Error("Unknown H3 Realism generation action.");
    }

    const form = await req.formData();
    const config = parseConfig(form);
    const requestId = crypto.randomUUID();
    const media = await multipartMedia(form, ownerKey, requestId, config);
    return await startGenerationJob(ownerKey, owner, config, media);
  } catch (error) {
    return errorResponse(error);
  }
}
