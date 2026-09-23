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
  createProductionV2Ltx25GenerationJob,
  getLatestProductionV2Ltx25SceneGeneration,
  getProductionV2Ltx25GenerationJob,
} from "@/lib/production/ltx25IngredientsJobs";
import {
  cancelProductionV2H3Generation,
  productionV2GenerationPublicStatus,
  reconcileProductionV2GenerationJob,
  requestProductionV2H3SchedulerTick,
  startProductionV2H3Scheduler,
} from "@/lib/production/h3GenerationScheduler";
import { H3_BACKEND_PROFILES } from "@/lib/production/h3Workflows";
import {
  productionV2Ltx25GenerationPublicStatus,
  runProductionV2Ltx25SchedulerTick,
  startProductionV2Ltx25Scheduler,
} from "@/lib/production/ltx25IngredientsScheduler";
import {
  buildLtx25IngredientsLockedContext,
  buildLtx25IngredientsManifest,
} from "@/lib/production/ltx25IngredientsManifest";
import {
  reconcileProductionV2Ltx25GenerationJob,
} from "@/lib/production/ltx25IngredientsProduction";
import {
  assertProductionV2BackgroundVisualReference,
  assertProductionV2H3StartingImage,
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

function finiteNumber(value: unknown, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function retrySeed(previous: number) {
  let next = seed();
  while (next === previous) next = seed();
  return next;
}

function failure(error: unknown) {
  if (error instanceof SessionInvalidError) return noStore({ ok: false, error: "Unauthorized" }, { status: 401 });
  return noStore({ ok: false, error: error instanceof Error ? error.message : "Production video generation failed." }, { status: 500 });
}

export async function GET(req: NextRequest) {
  if (!isProductionFeatureEnabled()) {
    return productionDisabledResponse();
  }

  try {
    const { ownerKey } =
      await getOwnerContext(req);

    const jobId =
      String(
        req.nextUrl.searchParams.get("jobId")
        || "",
      ).trim();

    const productionId =
      String(
        req.nextUrl.searchParams.get(
          "productionId",
        )
        || "",
      ).trim();

    const sceneId =
      String(
        req.nextUrl.searchParams.get("sceneId")
        || "",
      ).trim();

    /*
     * Exact job lookup is model-agnostic.
     */
    if (jobId) {
      const h3Job =
        getProductionV2GenerationJob(
          jobId,
          ownerKey,
        );

      if (h3Job) {
        reconcileProductionV2GenerationJob(
          h3Job,
        );
        startProductionV2H3Scheduler();
        requestProductionV2H3SchedulerTick();

        return noStore({
          ok: true,
          job:
            productionV2GenerationPublicStatus(
              h3Job,
            ),
        });
      }

      const ltxJob =
        getProductionV2Ltx25GenerationJob(
          jobId,
          ownerKey,
        );

      if (ltxJob) {
        reconcileProductionV2Ltx25GenerationJob(
          ltxJob,
        );
        startProductionV2Ltx25Scheduler();
        void runProductionV2Ltx25SchedulerTick();

        return noStore({
          ok: true,
          job:
            productionV2Ltx25GenerationPublicStatus(
              ltxJob,
            ),
        });
      }

      return noStore(
        {
          ok: false,
          error:
            "Production generation job not found.",
        },
        { status: 404 },
      );
    }

    if (!productionId || !sceneId) {
      return noStore(
        {
          ok: false,
          error:
            "Production generation job not found.",
        },
        { status: 404 },
      );
    }

    /*
     * Scene lookup follows the Scene's currently selected model
     * so an older job from the other model is never surfaced as
     * the current job merely because it exists in another store.
     */
    const production =
      productionV2Store.load(
        ownerKey,
        productionId,
      );

    const scene =
      production?.scenes.find(
        (item) => item.id === sceneId,
      );

    if (!scene) {
      return noStore(
        {
          ok: false,
          error:
            "Production generation job not found.",
        },
        { status: 404 },
      );
    }

    if (scene.model === "ltx-2.5") {
      const job =
        getLatestProductionV2Ltx25SceneGeneration(
          ownerKey,
          productionId,
          sceneId,
        );

      if (!job) {
        return noStore(
          {
            ok: false,
            error:
              "Production generation job not found.",
          },
          { status: 404 },
        );
      }

      reconcileProductionV2Ltx25GenerationJob(
        job,
      );

      startProductionV2Ltx25Scheduler();
      void runProductionV2Ltx25SchedulerTick();

      return noStore({
        ok: true,
        job:
          productionV2Ltx25GenerationPublicStatus(
            job,
          ),
      });
    }

    const job =
      getLatestProductionV2SceneGeneration(
        ownerKey,
        productionId,
        sceneId,
      );

    if (!job) {
      return noStore(
        {
          ok: false,
          error:
            "Production generation job not found.",
        },
        { status: 404 },
      );
    }

    reconcileProductionV2GenerationJob(job);
    startProductionV2H3Scheduler();
    requestProductionV2H3SchedulerTick();

    return noStore({
      ok: true,
      job:
        productionV2GenerationPublicStatus(job),
    });
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
    if (action === "cancel") {
      const activeJob =
        getProductionV2GenerationJob(String((body as any)?.jobId || ""), ownerKey)
        || getLatestProductionV2SceneGeneration(ownerKey, productionId, sceneId);
      if (!activeJob) return noStore({ ok: false, error: "Production generation job not found." }, { status: 404 });
      if (activeJob.backend) {
        await fetch(`${H3_BACKEND_PROFILES[activeJob.backend].baseUrl}/interrupt`, {
          method: "POST",
          cache: "no-store",
        }).catch(() => undefined);
      }
      const canceled = cancelProductionV2H3Generation(activeJob) || activeJob;
      return noStore({ ok: true, job: productionV2GenerationPublicStatus(canceled) });
    }
    if (action === "visual-edit") {
      const versionId = String(body?.versionId || "").trim();
      const editPrompt = String(body?.editPrompt || "").trim();
      if (!versionId) return noStore({ ok: false, error: "Select the exact source media version for the H3 edit." }, { status: 400 });
      if (!editPrompt) return noStore({ ok: false, error: "Describe the requested visual changes." }, { status: 400 });
      if (editPrompt.length > 4_000) return noStore({ ok: false, error: "Visual edit instructions must be 4,000 characters or fewer." }, { status: 400 });
      const selected = resolveProductionV2Version(production, sceneId, versionId);
      const mediaPath = assertProductionV2OwnedFile(ownerKey, productionId, selected.version.mediaPath);
      const clipStartSeconds = Math.max(0, finiteNumber((body as any)?.videoClipStartSeconds, 0));
      const finalPrompt = [
        "Use <Video 1> as the exact temporal and visual reference.",
        `Use only the selected 5-second reference window starting at ${clipStartSeconds.toFixed(2)} seconds.`,
        "Preserve the source video's subjects, action, timing, composition, and audio unless the requested edit explicitly changes them.",
        `Requested visual transformation: ${editPrompt}`,
      ].join("\n");
      const promptFingerprint = crypto.createHash("sha256").update(JSON.stringify({ operation: "visual-edit", versionId, editPrompt, clipStartSeconds })).digest("hex");
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
          h3Quality: scene.h3Quality,
          seed: seed(),
          startImage: null,
          references: [],
          voices: [],
          userLoras: normalizeProductionV2H3UserLoras(DEFAULT_PRODUCTION_V2_H3_USER_LORAS),
          videoReference: {
            mediaVersionId: selected.version.id,
            mediaPath,
            includeAudio: true,
            clipStartSeconds,
            clipDurationSeconds: 5,
          },
        },
      });
      startProductionV2H3Scheduler();
      requestProductionV2H3SchedulerTick();
      return noStore({ ok: true, job: productionV2GenerationPublicStatus(job) }, { status: 202 });
    }
    if (
      action !== "scene-generation"
      && action !== "retry"
    ) {
      return noStore(
        {
          ok: false,
          error:
            "Unsupported Production generation action.",
        },
        { status: 400 },
      );
    }

    const readiness =
      productionV2GenerationReadiness(scene);

    if (!readiness.ok) {
      return noStore(
        {
          ok: false,
          error: readiness.reason,
        },
        { status: 409 },
      );
    }

    const prompt =
      scene.promptStateByMode[
        scene.generationMode
      ];

    if (
      prompt.finalPrompt
      !== composeProductionV2FinalPrompt(
        prompt.lockedReferenceContext,
        prompt.scenePrompt,
      )
    ) {
      return noStore(
        {
          ok: false,
          error:
            "The final prompt no longer matches the locked references and Scene Prompt. Rebuild it.",
        },
        { status: 409 },
      );
    }

    const fingerprint =
      productionV2PromptFingerprint(scene);

    if (
      prompt.buildFingerprint
      !== fingerprint
    ) {
      return noStore(
        {
          ok: false,
          error:
            "The built final prompt is stale.",
        },
        { status: 409 },
      );
    }

    /*
     * --------------------------------------------------------
     * LTX 2.5 Ingredients
     * --------------------------------------------------------
     */
    if (scene.model === "ltx-2.5") {
      if (
        scene.generationMode
        !== "ltx-ingredients-image-to-video"
      ) {
        return noStore(
          {
            ok: false,
            error:
              "LTX 2.5 currently supports Ingredients Image-to-Video only.",
          },
          { status: 400 },
        );
      }

      if (action === "retry") {
        return noStore(
          {
            ok: false,
            error:
              "LTX 2.5 Retry is not enabled in this integration pass.",
          },
          { status: 409 },
        );
      }

      /* OTG_PRODUCTION_V2_LTX_R13C_ROUTE_DURATION_5S10S_V1 */
      if (
        scene.durationSeconds !== 5
        && scene.durationSeconds !== 10
      ) {
        return noStore(
          {
            ok: false,
            error:
              "LTX 2.5 Ingredients is production-qualified for 5- or 10-second scenes only.",
          },
          { status: 409 },
        );
      }

      let manifest:
        ReturnType<
          typeof buildLtx25IngredientsManifest
        >;

      try {
        manifest =
          buildLtx25IngredientsManifest(
            scene,
          );
      } catch (error) {
        return noStore(
          {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Could not resolve the LTX Ingredients manifest.",
          },
          { status: 409 },
        );
      }

      const lockedReferenceContext =
        buildLtx25IngredientsLockedContext(
          manifest,
        );

      if (
        prompt.lockedReferenceContext
        !== lockedReferenceContext
      ) {
        return noStore(
          {
            ok: false,
            error:
              "The LTX Ingredients reference manifest changed after prompt review. Rebuild and review the Scene Prompt.",
          },
          { status: 409 },
        );
      }

      if (
        prompt.finalPrompt
        !== composeProductionV2FinalPrompt(
          lockedReferenceContext,
          prompt.scenePrompt,
        )
      ) {
        return noStore(
          {
            ok: false,
            error:
              "The exact reviewed LTX prompt no longer matches the locked Ingredients manifest.",
          },
          { status: 409 },
        );
      }

      /*
       * OTG_PRODUCTION_V2_LTX_CONTINUATION_OWNER_VERIFIED_HANDOFF_V1
       *
       * Never trust a client-supplied frame path. Re-resolve the
       * persisted source Scene/version inside this Production, verify
       * its media path, then verify the server-created frame path.
       */
      let continuationFirstFramePath:
        string | null =
        null;

      if (scene.continuation) {
        try {
          const continuationSource =
            resolveProductionV2Version(
              production,
              scene.continuation
                .sourceSceneId,
              scene.continuation
                .sourceMediaVersionId,
            );

          const continuationSourcePath =
            assertProductionV2OwnedFile(
              ownerKey,
              productionId,
              continuationSource
                .version.mediaPath,
            );

          if (
            continuationSourcePath
            !== scene.continuation
              .sourceMediaPath
          ) {
            return noStore(
              {
                ok: false,
                error:
                  "The continuation source media version changed. Prepare Continue Scene again.",
              },
              {
                status: 409,
              },
            );
          }

          continuationFirstFramePath =
            assertProductionV2OwnedFile(
              ownerKey,
              productionId,
              scene.continuation
                .lastFramePath,
            );
        } catch (error) {
          return noStore(
            {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "The continuation source could not be verified.",
            },
            {
              status: 409,
            },
          );
        }
      }

      const job =
        createProductionV2Ltx25GenerationJob({
          ownerKey,
          productionId,
          sceneId,
          payload: {
            finalPrompt:
              prompt.finalPrompt,
            lockedReferenceContext,
            promptFingerprint:
              fingerprint,
            durationSeconds:
              scene.durationSeconds,
            seed: seed(),
            manifest,
            continuationFirstFramePath,
          },
        });

      startProductionV2Ltx25Scheduler();
      void runProductionV2Ltx25SchedulerTick();

      return noStore(
        {
          ok: true,
          job:
            productionV2Ltx25GenerationPublicStatus(
              job,
            ),
        },
        { status: 202 },
      );
    }

    /*
     * --------------------------------------------------------
     * Existing MiniMax H3 path
     * --------------------------------------------------------
     */
    if (
      scene.model !== "minimax-h3"
      || (
        scene.generationMode
        !== "h3-text-to-video"
        && scene.generationMode
        !== "h3-image-to-video"
        && scene.generationMode
        !== "h3-reference-to-video"
      )
    ) {
      return noStore(
        {
          ok: false,
          error:
            "Unsupported Production video model or generation mode.",
        },
        { status: 400 },
      );
    }

    assertProductionV2H3UserLoraTriggers(
      prompt.scenePrompt,
      scene.modelState.h3.userLoras,
    );

    if (action === "retry") {
      const previous =
        getLatestProductionV2SceneVideoGeneration(
          ownerKey,
          productionId,
          sceneId,
        );

      if (!previous) {
        return noStore(
          {
            ok: false,
            error:
              "Retry requires a prior MiniMax H3 video generation attempt.",
          },
          { status: 409 },
        );
      }

      if (
        [
          "pending",
          "queued_waiting_for_gpu",
          "claimed",
          "submitted",
          "running",
          "postprocessing_waiting_for_gpu",
          "postprocessing_submitted",
          "postprocessing_running",
        ].includes(previous.status)
      ) {
        return noStore(
          {
            ok: false,
            error:
              `Generation ${previous.id} is already active; duplicate Retry was blocked.`,
          },
          { status: 409 },
        );
      }

      if (
        previous.status !== "completed"
        && previous.status !== "failed"
      ) {
        return noStore(
          {
            ok: false,
            error:
              "The prior video attempt is not retryable.",
          },
          { status: 409 },
        );
      }

      if (
        previous.payload.finalPrompt
          !== prompt.finalPrompt
        || previous.payload.promptFingerprint
          !== fingerprint
      ) {
        return noStore(
          {
            ok: false,
            error:
              "Retry is blocked because the current final prompt no longer exactly matches the prior attempt.",
          },
          { status: 409 },
        );
      }

      const job =
        createProductionV2GenerationJob({
          ownerKey,
          productionId,
          sceneId,
          mode: previous.mode,
          payload: {
            ...previous.payload,
            finalPrompt:
              previous.payload.finalPrompt,
            promptFingerprint:
              previous.payload
                .promptFingerprint,
            seed:
              retrySeed(
                previous.payload.seed,
              ),
            retryOfJobId:
              previous.id,
          },
        });

      startProductionV2H3Scheduler();
      requestProductionV2H3SchedulerTick();

      return noStore(
        {
          ok: true,
          job:
            productionV2GenerationPublicStatus(
              job,
            ),
        },
        { status: 202 },
      );
    }

    /*
     * OTG_PRODUCTION_V2_H3_R2V_CONTINUATION_GUIDE_HANDOFF_R11B_V1
     *
     * Continue Scene first creates the destination as I2V and stores
     * the exact server-extracted final frame in imageToVideo.startingImage.
     * Switching that continued Scene to R2V preserves this reference.
     *
     * Reuse it as the native MiniMaxH3AddGuide frame-0 image.
     */
    const continuationStartingImage =
      scene.modelState.h3
        .imageToVideo.startingImage;

    const startImage =
      scene.generationMode
        === "h3-image-to-video"
        || (
          scene.generationMode
            === "h3-reference-to-video"
          && Boolean(scene.continuation)
        )
        ? continuationStartingImage
        : null;

    if (startImage) {
      try {
        assertProductionV2H3StartingImage(
          startImage,
        );
      } catch (error) {
        return noStore(
          {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "The selected H3 Starting Image is invalid.",
          },
          { status: 400 },
        );
      }
    }

    const references =
      scene.generationMode
        === "h3-reference-to-video"
        ? scene.referencePlan
            .modelFacingReferences
        : [];

    references.forEach((reference) => {
      assertProductionV2BackgroundVisualReference(
        reference,
      );

      if (
        reference.sourceKind
          === "character"
        && reference.generationSourceType
          !== "character-card"
      ) {
        throw new Error(
          `${reference.name} does not resolve to a Character Card. Rebuild the Scene Prompt after selecting a completed Character Card.`,
        );
      }
    });

    const voices =
      scene.generationMode
        === "h3-reference-to-video"
        ? scene.referencePlan
            .resolvedVoiceReferences
        : [];

    /*
     * OTG_PRODUCTION_V2_H3_CONTINUATION_OWNER_VERIFIED_HANDOFF_V1
     *
     * The browser never supplies H3 continuation media paths to the
     * generation job. Re-resolve the persisted source Scene/version and
     * verify both the source video and server-created final frame here.
     *
     * I2V consumes the final frame.
     * R2V consumes the prior video in addition to the normal current
     * Picture/Subject/voice references.
     */
    let videoReference:
      | {
          mediaVersionId: string;
          mediaPath: string;
          includeAudio: boolean;
        }
      | undefined;

    if (
      scene.continuation
      && (
        scene.generationMode
          === "h3-image-to-video"
        || scene.generationMode
          === "h3-reference-to-video"
      )
    ) {
      try {
        const continuationSource =
          resolveProductionV2Version(
            production,
            scene.continuation.sourceSceneId,
            scene.continuation.sourceMediaVersionId,
          );

        const continuationSourcePath =
          assertProductionV2OwnedFile(
            ownerKey,
            productionId,
            continuationSource.version.mediaPath,
          );

        if (
          continuationSourcePath
          !== scene.continuation.sourceMediaPath
        ) {
          return noStore(
            {
              ok: false,
              error:
                "The H3 continuation source media version changed. Prepare Continue Scene again.",
            },
            { status: 409 },
          );
        }

        const continuationFramePath =
          assertProductionV2OwnedFile(
            ownerKey,
            productionId,
            scene.continuation.lastFramePath,
          );

        /*
         * Both I2V and continued R2V must remain anchored to the exact
         * owner-verified final frame prepared by Continue Scene.
         */
        if (
          !startImage
          || startImage.sourceKind
            !== "production-upload"
          || startImage.generationSourceType
            !== "production-upload"
          || startImage.sourceId
            !== scene.continuation.sourceMediaVersionId
          || startImage.workflowImage
            !== continuationFramePath
        ) {
          return noStore(
            {
              ok: false,
              error:
                "The H3 continuation Starting Image no longer matches the server-prepared final frame. Prepare Continue Scene again.",
            },
            { status: 409 },
          );
        }

        if (
          scene.generationMode
          === "h3-reference-to-video"
        ) {
          videoReference = {
            mediaVersionId:
              continuationSource.version.id,
            mediaPath:
              continuationSourcePath,

            /*
             * The previous Scene video is a visual/temporal reference.
             * Do not inject its prior audio into the next Scene because
             * the next Scene owns its dialogue, voices and sound.
             */
            includeAudio: false,
          };
        }
      } catch (error) {
        return noStore(
          {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "The H3 continuation source could not be verified.",
          },
          { status: 409 },
        );
      }
    }

    const job =
      createProductionV2GenerationJob({
        ownerKey,
        productionId,
        sceneId,
        mode:
          scene.generationMode as ProductionV2H3State["lastMode"],
        payload: {
          operation: "scene-generation",
          finalPrompt:
            prompt.finalPrompt,
          promptFingerprint:
            fingerprint,
          durationSeconds:
            scene.durationSeconds,
          h3Quality:
            scene.h3Quality,
          seed: seed(),
          startImage,
          references,
          voices,
          videoReference,
          userLoras:
            scene.modelState.h3.userLoras,
        },
      });

    startProductionV2H3Scheduler();
    requestProductionV2H3SchedulerTick();

    return noStore(
      {
        ok: true,
        job:
          productionV2GenerationPublicStatus(
            job,
          ),
      },
      { status: 202 },
    );
  } catch (error) {
    return failure(error);
  }
}
