import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getOwnerContext, SessionInvalidError } from "@/lib/ownerKey";
import { isProductionFeatureEnabled, productionDisabledResponse } from "@/lib/production/featureGate";
import {
  DEFAULT_PRODUCTION_V2_H3_USER_LORAS,
  assertProductionV2H3UserLoraTriggers,
  normalizeProductionV2H3UserLoras,
} from "@/lib/production/h3Loras";
import {
  createProductionV2GenerationJob,
  getLatestProductionV2SceneGeneration,
  getLatestProductionV2SceneVideoGeneration,
  getProductionV2GenerationJob,
} from "@/lib/production/h3GenerationJobs";
import {
  productionV2GenerationPublicStatus,
  reconcileProductionV2GenerationJob,
  runProductionV2H3SchedulerTick,
  startProductionV2H3Scheduler,
} from "@/lib/production/h3GenerationScheduler";
import {
  composeProductionV2FinalPrompt,
  productionV2GenerationReadiness,
  productionV2PromptFingerprint,
  type ProductionV2H3State,
} from "@/lib/production/v2";
import { productionV2Store } from "@/lib/production/v2Store";
import { assertProductionV2OwnedFile, resolveProductionV2Version } from "@/lib/production/postProduction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: { "Cache-Control": "private, no-store", ...(init?.headers || {}) },
  });
}

function seed() {
  return crypto.randomBytes(6).readUIntBE(0, 6);
}

function retrySeed(previous: number) {
  let next = seed();
  while (next === previous) next = seed();
  return next;
}

function failure(error: unknown) {
  if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
  return noStore({ ok: false, error: error instanceof Error ? error.message : "Production H3 generation failed." }, { status: 500 });
}

export async function GET(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();
  try {
    const { ownerKey } = await getOwnerContext(req);
    const jobId = String(req.nextUrl.searchParams.get("jobId") || "").trim();
    const productionId = String(req.nextUrl.searchParams.get("productionId") || "").trim();
    const sceneId = String(req.nextUrl.searchParams.get("sceneId") || "").trim();
    const job = jobId
      ? getProductionV2GenerationJob(jobId, ownerKey)
      : productionId && sceneId
        ? getLatestProductionV2SceneGeneration(ownerKey, productionId, sceneId)
        : null;
    if (!job) return noStore({ ok: false, error: "Production generation job not found." }, { status: 404 });
    reconcileProductionV2GenerationJob(job);
    startProductionV2H3Scheduler();
    void runProductionV2H3SchedulerTick();
    return noStore({ ok: true, job: productionV2GenerationPublicStatus(job) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  if (!isProductionFeatureEnabled()) return productionDisabledResponse();
  try {
    const body = await req.clone().json().catch(() => null) as { productionId?: unknown; sceneId?: unknown; action?: unknown; versionId?: unknown; editPrompt?: unknown } | null;
    const { ownerKey } = await getOwnerContext(req);
    const productionId = String(body?.productionId || "").trim();
    const sceneId = String(body?.sceneId || "").trim();
    if (!productionId || !sceneId) return noStore({ ok: false, error: "productionId and sceneId are required." }, { status: 400 });
    const production = productionV2Store.load(ownerKey, productionId);
    if (!production) return noStore({ ok: false, error: "Production not found." }, { status: 404 });
    if (production.status !== "draft") return noStore({ ok: false, error: "Completed Productions cannot submit new video generations." }, { status: 409 });
    const scene = production.scenes.find((item) => item.id === sceneId);
    if (!scene) return noStore({ ok: false, error: "Production Scene not found." }, { status: 404 });
    const action = String(body?.action || "scene-generation").trim();
    if (action === "visual-edit") {
      const versionId = String(body?.versionId || "").trim();
      const editPrompt = String(body?.editPrompt || "").trim();
      if (!versionId) return noStore({ ok: false, error: "Select the exact source media version for the H3 edit." }, { status: 400 });
      if (!editPrompt) return noStore({ ok: false, error: "Describe the requested visual changes." }, { status: 400 });
      if (editPrompt.length > 4_000) return noStore({ ok: false, error: "Visual edit instructions must be 4,000 characters or fewer." }, { status: 400 });
      const selected = resolveProductionV2Version(production, sceneId, versionId);
      const mediaPath = assertProductionV2OwnedFile(ownerKey, productionId, selected.version.mediaPath);
      const finalPrompt = [
        "Use <Video 1> as the exact temporal and visual reference.",
        "Preserve the source video's subjects, action, timing, composition, and audio unless the requested edit explicitly changes them.",
        `Requested visual transformation: ${editPrompt}`,
      ].join("\n");
      const promptFingerprint = crypto.createHash("sha256").update(JSON.stringify({ operation: "visual-edit", versionId, editPrompt })).digest("hex");
      const job = createProductionV2GenerationJob({
        ownerKey,
        productionId,
        sceneId,
        mode: "h3-reference-to-video",
        payload: {
          operation: "visual-edit",
          finalPrompt,
          promptFingerprint,
          durationSeconds: scene.durationSeconds,
          seed: seed(),
          startImage: null,
          references: [],
          voices: [],
          userLoras: normalizeProductionV2H3UserLoras(DEFAULT_PRODUCTION_V2_H3_USER_LORAS),
          videoReference: { mediaVersionId: selected.version.id, mediaPath, includeAudio: true },
        },
      });
      startProductionV2H3Scheduler();
      void runProductionV2H3SchedulerTick();
      return noStore({ ok: true, job: productionV2GenerationPublicStatus(job) }, { status: 202 });
    }
    if (action !== "scene-generation" && action !== "retry") return noStore({ ok: false, error: "Unsupported H3 generation action." }, { status: 400 });
    if (scene.model !== "minimax-h3" || (scene.generationMode !== "h3-image-to-video" && scene.generationMode !== "h3-reference-to-video")) {
      return noStore({ ok: false, error: "This integration pass supports MiniMax H3 I2V and R2V only." }, { status: 400 });
    }
    const readiness = productionV2GenerationReadiness(scene);
    if (!readiness.ok) return noStore({ ok: false, error: readiness.reason }, { status: 409 });
    const prompt = scene.promptStateByMode[scene.generationMode];
    assertProductionV2H3UserLoraTriggers(prompt.scenePrompt, scene.modelState.h3.userLoras);
    if (prompt.finalPrompt !== composeProductionV2FinalPrompt(prompt.lockedReferenceContext, prompt.scenePrompt)) {
      return noStore({ ok: false, error: "The reviewed final prompt changed after review. Rebuild and review it." }, { status: 409 });
    }
    const fingerprint = productionV2PromptFingerprint(scene);
    if (prompt.reviewedFingerprint !== fingerprint) return noStore({ ok: false, error: "The reviewed final prompt is stale." }, { status: 409 });

    if (action === "retry") {
      const previous = getLatestProductionV2SceneVideoGeneration(ownerKey, productionId, sceneId);
      if (!previous) return noStore({ ok: false, error: "Retry requires a prior MiniMax H3 video generation attempt." }, { status: 409 });
      if (["pending", "queued_waiting_for_gpu", "claimed", "submitted", "running", "postprocessing_waiting_for_gpu", "postprocessing_submitted", "postprocessing_running"].includes(previous.status)) {
        return noStore({ ok: false, error: `Generation ${previous.id} is already active; duplicate Retry was blocked.` }, { status: 409 });
      }
      if (previous.status !== "completed" && previous.status !== "failed") {
        return noStore({ ok: false, error: "The prior video attempt is not retryable." }, { status: 409 });
      }
      if (previous.payload.finalPrompt !== prompt.finalPrompt || previous.payload.promptFingerprint !== fingerprint) {
        return noStore({ ok: false, error: "Retry is blocked because the reviewed final prompt no longer exactly matches the prior attempt." }, { status: 409 });
      }
      const job = createProductionV2GenerationJob({
        ownerKey,
        productionId,
        sceneId,
        mode: previous.mode,
        payload: {
          ...previous.payload,
          finalPrompt: previous.payload.finalPrompt,
          promptFingerprint: previous.payload.promptFingerprint,
          seed: retrySeed(previous.payload.seed),
          retryOfJobId: previous.id,
        },
      });
      startProductionV2H3Scheduler();
      void runProductionV2H3SchedulerTick();
      return noStore({ ok: true, job: productionV2GenerationPublicStatus(job) }, { status: 202 });
    }

    const startImage = scene.generationMode === "h3-image-to-video" ? scene.modelState.h3.imageToVideo.startingImage : null;
    if (startImage?.sourceKind === "character" && startImage.generationSourceType !== "character-card") {
      return noStore({ ok: false, error: "Character generation requires the saved Character Card; default Character images are UI thumbnails only." }, { status: 400 });
    }
    const references = scene.generationMode === "h3-reference-to-video" ? scene.referencePlan.modelFacingReferences : [];
    references.forEach((reference) => {
      if (reference.sourceKind === "character" && reference.generationSourceType !== "character-card") {
        throw new Error(`${reference.name} does not resolve to a Character Card. Rebuild the Scene Prompt after selecting a completed Character Card.`);
      }
    });
    const voices = scene.generationMode === "h3-reference-to-video" ? scene.referencePlan.resolvedVoiceReferences : [];
    const job = createProductionV2GenerationJob({
      ownerKey,
      productionId,
      sceneId,
      mode: scene.generationMode as ProductionV2H3State["lastMode"],
      payload: {
        operation: "scene-generation",
        finalPrompt: prompt.finalPrompt,
        promptFingerprint: fingerprint,
        durationSeconds: scene.durationSeconds,
        seed: seed(),
        startImage,
        references,
        voices,
        userLoras: scene.modelState.h3.userLoras,
      },
    });
    startProductionV2H3Scheduler();
    void runProductionV2H3SchedulerTick();
    return noStore({ ok: true, job: productionV2GenerationPublicStatus(job) }, { status: 202 });
  } catch (error) {
    return failure(error);
  }
}
