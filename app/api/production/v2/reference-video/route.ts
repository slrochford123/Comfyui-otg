import crypto from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { H3_REFERENCE_VIDEO_CLIP_SECONDS, normalizeH3ReferenceVideoClip } from "@/lib/h3ReferenceVideo";
import { isAcceptedH3MediaFile, supportedH3MediaExtensions } from "@/lib/h3MediaTypes";
import { mediaFileResponse } from "@/lib/mediaResponse";
import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";
import {
  assertProductionV2OwnedFile,
  probeProductionV2Media,
  productionV2SceneOutputRoot,
} from "@/lib/production/postProduction";
import {
  invalidateProductionV2Prompts,
  type ProductionV2,
  type ProductionV2H3UploadedVideoReference,
} from "@/lib/production/v2";
import { productionV2Store } from "@/lib/production/v2Store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: { "Cache-Control": "private, no-store", ...(init?.headers || {}) },
  });
}

function updateScene(
  production: ProductionV2,
  sceneId: string,
  updater: (scene: ProductionV2["scenes"][number]) => ProductionV2["scenes"][number],
) {
  return {
    ...production,
    scenes: production.scenes.map((scene) => scene.id === sceneId ? updater(scene) : scene),
  };
}

function validateScene(production: ProductionV2, sceneId: string) {
  if (production.status !== "draft") throw new Error("Completed Productions cannot change reference videos.");
  const scene = production.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error("Production Scene not found.");
  if (scene.model !== "minimax-h3" || scene.generationMode !== "h3-reference-to-video") {
    throw new Error("Upload Video is available only for MiniMax H3 Reference-to-Video scenes.");
  }
  return scene;
}

async function serve(req: NextRequest, method: "GET" | "HEAD") {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();
  try {
    const { ownerKey } = await getOwnerContext(req);
    const productionId = String(req.nextUrl.searchParams.get("productionId") || "").trim();
    const sceneId = String(req.nextUrl.searchParams.get("sceneId") || "").trim();
    const uploadId = String(req.nextUrl.searchParams.get("uploadId") || "").trim();
    const production = productionId ? productionV2Store.load(ownerKey, productionId) : null;
    const upload = production?.scenes.find((scene) => scene.id === sceneId)
      ?.modelState.h3.referenceToVideo.uploadedVideo;
    if (!production || !upload || upload.id !== uploadId) {
      return noStore({ ok: false, error: "Uploaded reference video not found." }, { status: 404 });
    }
    const sourcePath = assertProductionV2OwnedFile(ownerKey, productionId, upload.sourcePath);
    return mediaFileResponse(req, sourcePath, {
      method,
      cacheControl: "private, no-transform, max-age=3600",
    });
  } catch (error) {
    if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    return noStore({ ok: false, error: error instanceof Error ? error.message : "Could not serve the reference video." }, { status: 404 });
  }
}

export function GET(req: NextRequest) {
  return serve(req, "GET");
}

export function HEAD(req: NextRequest) {
  return serve(req, "HEAD");
}

export async function POST(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();
  try {
    const { ownerKey } = await getOwnerContext(req);
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = await req.json() as Record<string, unknown>;
      if (String(body.action || "") !== "select-window") {
        return noStore({ ok: false, error: "Unsupported reference-video action." }, { status: 400 });
      }
      const productionId = String(body.productionId || "").trim();
      const sceneId = String(body.sceneId || "").trim();
      const production = productionV2Store.load(ownerKey, productionId);
      if (!production) return noStore({ ok: false, error: "Production not found." }, { status: 404 });
      const scene = validateScene(production, sceneId);
      const upload = scene.modelState.h3.referenceToVideo.uploadedVideo;
      if (!upload || upload.id !== String(body.uploadId || "").trim()) {
        return noStore({ ok: false, error: "Uploaded reference video not found." }, { status: 404 });
      }
      const sourcePath = assertProductionV2OwnedFile(ownerKey, productionId, upload.sourcePath);
      const probe = await probeProductionV2Media(sourcePath);
      const clip = normalizeH3ReferenceVideoClip(probe.durationSeconds, Number(body.clipStartSeconds));
      if (clip.durationSeconds < H3_REFERENCE_VIDEO_CLIP_SECONDS - 0.1) {
        return noStore({ ok: false, error: "Reference videos must contain at least five seconds." }, { status: 400 });
      }
      const nextUpload: ProductionV2H3UploadedVideoReference = {
        ...upload,
        durationSeconds: probe.durationSeconds,
        clipStartSeconds: clip.startSeconds,
        clipDurationSeconds: H3_REFERENCE_VIDEO_CLIP_SECONDS,
        includeAudio: probe.hasAudio,
      };
      const saved = productionV2Store.save(ownerKey, updateScene(production, sceneId, (current) =>
        invalidateProductionV2Prompts({
          ...current,
          modelState: {
            ...current.modelState,
            h3: {
              ...current.modelState.h3,
              referenceToVideo: { ...current.modelState.h3.referenceToVideo, uploadedVideo: nextUpload },
            },
          },
        }),
      ));
      return noStore({ ok: true, production: saved, uploadedVideo: nextUpload });
    }

    const form = await req.formData();
    const productionId = String(form.get("productionId") || "").trim();
    const sceneId = String(form.get("sceneId") || "").trim();
    const file = form.get("video");
    const production = productionV2Store.load(ownerKey, productionId);
    if (!production) return noStore({ ok: false, error: "Production not found." }, { status: 404 });
    validateScene(production, sceneId);
    if (!(file instanceof File) || !file.size || !isAcceptedH3MediaFile("video", file)) {
      return noStore({ ok: false, error: "Choose a supported video file." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return noStore({ ok: false, error: "Reference video uploads must be 512 MB or smaller." }, { status: 413 });
    }
    const allowedExtensions = supportedH3MediaExtensions("video");
    const rawExtension = path.extname(file.name).toLowerCase();
    const extension = allowedExtensions.includes(rawExtension) ? rawExtension : ".mp4";
    const uploadId = `reference-video-${crypto.randomUUID()}`;
    const sourcePath = path.join(
      productionV2SceneOutputRoot(ownerKey, productionId, sceneId),
      `${uploadId}${extension}`,
    );
    await writeFile(sourcePath, Buffer.from(await file.arrayBuffer()));
    let probe: Awaited<ReturnType<typeof probeProductionV2Media>>;
    let clip: ReturnType<typeof normalizeH3ReferenceVideoClip>;
    try {
      probe = await probeProductionV2Media(sourcePath);
      clip = normalizeH3ReferenceVideoClip(probe.durationSeconds, 0);
      if (clip.durationSeconds < H3_REFERENCE_VIDEO_CLIP_SECONDS - 0.1) {
        throw new Error("Reference videos must contain at least five seconds.");
      }
    } catch (error) {
      await rm(sourcePath, { force: true });
      throw error;
    }
    const uploadedVideo: ProductionV2H3UploadedVideoReference = {
      id: uploadId,
      originalName: file.name.slice(0, 240) || "Uploaded video",
      sourcePath,
      previewUrl: `/api/production/v2/reference-video?productionId=${encodeURIComponent(productionId)}&sceneId=${encodeURIComponent(sceneId)}&uploadId=${encodeURIComponent(uploadId)}`,
      durationSeconds: probe.durationSeconds,
      clipStartSeconds: clip.startSeconds,
      clipDurationSeconds: H3_REFERENCE_VIDEO_CLIP_SECONDS,
      includeAudio: probe.hasAudio,
      createdAt: new Date().toISOString(),
    };
    const saved = productionV2Store.save(ownerKey, updateScene(production, sceneId, (current) =>
      invalidateProductionV2Prompts({
        ...current,
        modelState: {
          ...current.modelState,
          h3: {
            ...current.modelState.h3,
            referenceToVideo: { ...current.modelState.h3.referenceToVideo, uploadedVideo },
          },
        },
      }),
    ));
    return noStore({ ok: true, production: saved, uploadedVideo }, { status: 201 });
  } catch (error) {
    if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    return noStore({ ok: false, error: error instanceof Error ? error.message : "Could not save the reference video." }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();
  try {
    const { ownerKey } = await getOwnerContext(req);
    const body = await req.json() as Record<string, unknown>;
    const productionId = String(body.productionId || "").trim();
    const sceneId = String(body.sceneId || "").trim();
    const production = productionV2Store.load(ownerKey, productionId);
    if (!production) return noStore({ ok: false, error: "Production not found." }, { status: 404 });
    validateScene(production, sceneId);
    const saved = productionV2Store.save(ownerKey, updateScene(production, sceneId, (current) =>
      invalidateProductionV2Prompts({
        ...current,
        modelState: {
          ...current.modelState,
          h3: {
            ...current.modelState.h3,
            referenceToVideo: { ...current.modelState.h3.referenceToVideo, uploadedVideo: null },
          },
        },
      }),
    ));
    return noStore({ ok: true, production: saved });
  } catch (error) {
    if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    return noStore({ ok: false, error: error instanceof Error ? error.message : "Could not remove the reference video." }, { status: 400 });
  }
}
