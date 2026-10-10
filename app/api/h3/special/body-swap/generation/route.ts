import { validateH3LoraSelections } from "@/lib/h3LoraCatalogServer";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import sharp from "sharp";

import { isAcceptedH3MediaFile, supportedH3MediaExtensions, type H3InputMediaKind } from "@/lib/h3MediaTypes";
import { readCompletedH3StagedUpload } from "@/lib/h3StagedUploads";
import {
  cancelH3BodySwapJob,
  createH3BodySwapJob,
  ensureH3BodySwapJobRunner,
  getH3BodySwapJob,
  getLatestH3BodySwapJob,
  h3BodySwapPublicStatus,
  startH3BodySwapJob,
  validateH3BodySwapJobInput,
  type H3BodySwapMedia,
} from "@/lib/h3SpecialModes/bodySwapJobs";
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
type H3BodySwapStagedMedia = {
  sourceVideo?: unknown;
  replacementImage?: unknown;
};
type H3BodySwapMediaPayload = {
  sourceVideo: H3BodySwapMedia | null;
  replacementImage: H3BodySwapMedia | null;
};

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, { ...init, headers: { "Cache-Control": "private, no-store", ...(init?.headers || {}) } });
}

function parseConfig(form: FormData) {
  const raw = String(form.get("config") || "");
  return JSON.parse(raw || "{}") as Record<string, unknown>;
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
  label: string,
): Promise<H3BodySwapMedia> {
  if (!isAcceptedH3MediaFile(category, source)) {
    throw new Error(`Choose a supported Body Swap ${label} file (${supportedH3MediaExtensions(category).join(", ")}).`);
  }
  const extension = category === "image"
    ? ".png"
    : path.extname(source.name).toLowerCase() || ".mp4";
  const directory = safeJoin(OTG_DATA_ROOT, "h3-special", "body-swap", safeSegment(ownerKey), "uploads", safeSegment(requestId));
  ensureDir(directory);
  const target = safeJoin(directory, `${safeSegment(label)}${extension}`);
  if (category === "image") {
    try {
      await sharp(source.bytes, { animated: false, failOn: "error", limitInputPixels: false })
        .rotate()
        .png()
        .toFile(target);
    } catch {
      throw new Error("This replacement image format could not be decoded. Try PNG, JPEG, WebP, TIFF, AVIF, HEIC, GIF, BMP, or SVG.");
    }
  } else {
    await fsp.writeFile(target, source.bytes);
  }
  return { path: target, name: path.basename(source.name) };
}

async function saveFile(ownerKey: string, requestId: string, file: File, category: H3InputMediaKind, label: string) {
  return saveMediaBytes(
    ownerKey,
    requestId,
    {
      name: file.name,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    },
    category,
    label,
  );
}

async function saveStagedFile(ownerKey: string, requestId: string, value: unknown, category: H3InputMediaKind, label: string) {
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
    label,
  );
}

function errorResponse(error: unknown) {
  if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
  return noStore({ ok: false, error: error instanceof Error ? error.message : "H3 Body Swap generation request failed." }, { status: 400 });
}

function freshH3BodySwapRetrySeed(previousSeed: number) {
  let nextSeed = crypto.randomBytes(6).readUIntBE(0, 6);
  while (nextSeed === previousSeed) {
    nextSeed = crypto.randomBytes(6).readUIntBE(0, 6);
  }
  return nextSeed;
}

function readH3BodySwapGenerationConfig(config: Record<string, unknown>) {
  const mode = String(config.mode || "");
  const quality = String(config.quality || "") as H3Quality;
  const orientation = String(config.orientation || "") as H3Orientation;
  const durationSeconds = Number(config.durationSeconds) as H3ProductionDuration;
  if (mode !== "h3-body-swap") throw new Error("Choose Body Swap mode.");
  if (!H3_QUALITY_OPTIONS.includes(quality)) throw new Error("Choose SH, LQ, or HQ.");
  if (!H3_ORIENTATION_OPTIONS.includes(orientation)) throw new Error("Choose Landscape or Portrait orientation.");
  if (!H3_PRODUCTION_DURATION_OPTIONS.includes(durationSeconds)) throw new Error("Choose a 5- or 10-second duration.");
  return {
    mode: "h3-body-swap" as const,
    quality,
    orientation,
    durationSeconds,
    prompt: String(config.prompt || "").trim(),
    selector: String(config.selector || "person").trim() || "person",
    compiledPromptOverride: String(config.compiledPromptOverride || "").trim(),
    preserveOriginalAudio: config.preserveOriginalAudio !== false,
    rifeInterpolation60Fps: config.rifeInterpolation60Fps === true,
    creative: config.creative && typeof config.creative === "object"
      ? config.creative as Record<string, unknown>
      : undefined,
    optionalLoras: validateH3LoraSelections(
      config.optionalLoras,
      "h3-body-swap",
    ).resolved,
    seed: Number.isSafeInteger(Number(config.seed)) && Number(config.seed) >= 0 ? Number(config.seed) : crypto.randomBytes(6).readUIntBE(0, 6),
  };
}

async function startGenerationJob(
  ownerKey: string,
  owner: OwnerContext,
  config: Record<string, unknown>,
  media: H3BodySwapMediaPayload,
) {
  const generation = readH3BodySwapGenerationConfig(config);
  const input = validateH3BodySwapJobInput({
    ...generation,
    sourceVideo: media.sourceVideo!,
    replacementImage: media.replacementImage!,
  });
  const job = await createH3BodySwapJob(ownerKey, input, owner);
  startH3BodySwapJob(job);
  return noStore({ ok: true, job: h3BodySwapPublicStatus(job) }, { status: 202 });
}

async function stagedMedia(
  ownerKey: string,
  requestId: string,
  staged: H3BodySwapStagedMedia,
): Promise<H3BodySwapMediaPayload> {
  return {
    sourceVideo: staged.sourceVideo
      ? await saveStagedFile(ownerKey, requestId, staged.sourceVideo, "video", "source-video")
      : null,
    replacementImage: staged.replacementImage
      ? await saveStagedFile(ownerKey, requestId, staged.replacementImage, "image", "replacement-image")
      : null,
  };
}

async function multipartMedia(
  form: FormData,
  ownerKey: string,
  requestId: string,
): Promise<H3BodySwapMediaPayload> {
  const sourceVideo = form.get("sourceVideo");
  const replacementImage = form.get("replacementImage");
  return {
    sourceVideo: sourceVideo instanceof File && sourceVideo.size > 0
      ? await saveFile(ownerKey, requestId, sourceVideo, "video", "source-video")
      : null,
    replacementImage: replacementImage instanceof File && replacementImage.size > 0
      ? await saveFile(ownerKey, requestId, replacementImage, "image", "replacement-image")
      : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const { ownerKey } = owner;
    const id = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    const job = id ? await getH3BodySwapJob(ownerKey, id) : await getLatestH3BodySwapJob(ownerKey);
    if (!job) {
      return id
        ? noStore({ ok: false, error: "H3 Body Swap job not found." }, { status: 404 })
        : noStore({ ok: true, job: null });
    }
    ensureH3BodySwapJobRunner(job);
    return noStore({ ok: true, job: h3BodySwapPublicStatus(job) });
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
        staged?: H3BodySwapStagedMedia;
      } | null;
      if (body?.action === "cancel") {
        const canceled = await cancelH3BodySwapJob(ownerKey, String(body.jobId || ""));
        return noStore({ ok: true, job: h3BodySwapPublicStatus(canceled) });
      }
      if (body?.action === "retry") {
        const source = await getH3BodySwapJob(ownerKey, String(body.jobId || ""));
        if (!source) throw new Error("H3 Body Swap job not found.");
        const retryInput = {
          ...source.input,
          seed: freshH3BodySwapRetrySeed(source.input.seed),
        };
        const retry = await createH3BodySwapJob(ownerKey, retryInput, source.galleryOwner || owner);
        startH3BodySwapJob(retry);
        return noStore({ ok: true, job: h3BodySwapPublicStatus(retry) }, { status: 202 });
      }
      if (body?.config && typeof body.config === "object") {
        const requestId = crypto.randomUUID();
        const media = await stagedMedia(ownerKey, requestId, body.staged || {});
        return await startGenerationJob(ownerKey, owner, body.config as Record<string, unknown>, media);
      }
      throw new Error("Unknown H3 Body Swap generation action.");
    }

    const form = await req.formData();
    const config = parseConfig(form);
    const requestId = crypto.randomUUID();
    const media = await multipartMedia(form, ownerKey, requestId);
    return await startGenerationJob(ownerKey, owner, config, media);
  } catch (error) {
    return errorResponse(error);
  }
}
