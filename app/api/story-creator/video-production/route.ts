import { NextRequest, NextResponse } from "next/server";

import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import {
  approveStoryVideoBatch,
  cancelQueuedStoryVideoTake,
  getStoryVideoShotContext,
  prepareStoryVideoBatch,
  prepareStoryVideoRetry,
  prepareStoryVideoTake,
  resolveStoryVideoDirectorAction,
  setStoryVideoTakeDecision,
  storyVideoProductionSnapshot,
  submitStoryVideoTake,
} from "@/lib/storyCreator/videoProduction";
import {
  requestProductionV2H3SchedulerTick,
  startProductionV2H3Scheduler,
} from "@/lib/production/h3GenerationScheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function failure(error: unknown) {
  const status = error instanceof SessionInvalidError
    ? 401
    : typeof error === "object" && error && "status" in error
    ? Number((error as { status?: unknown }).status) || 400
    : 400;
  return response({
    ok: false,
    error: status === 401
      ? "Unauthorized"
      : error instanceof Error
        ? error.message
        : "Story video production request failed.",
  }, status);
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const projectId = String(request.nextUrl.searchParams.get("projectId") || "").trim();
    const sceneId = String(request.nextUrl.searchParams.get("sceneId") || "").trim();
    const shotId = String(request.nextUrl.searchParams.get("shotId") || "").trim();
    const snapshot = storyVideoProductionSnapshot({ ownerKey: user.ownerKey, projectId });
    return response({
      ok: true,
      ...snapshot,
      context: sceneId && shotId
        ? getStoryVideoShotContext({
            ownerKey: user.ownerKey,
            projectId,
            planVersion: snapshot.plan?.version,
            sceneId,
            shotId,
          })
        : null,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "").trim();
    const common = { ownerKey: user.ownerKey, projectId: body.projectId };

    if (action === "director-action") {
      return response({
        ok: true,
        result: resolveStoryVideoDirectorAction({
          ...common,
          instruction: body.instruction,
          sceneId: body.sceneId,
          shotId: body.shotId,
          idempotencyKey: body.idempotencyKey,
        }),
      }, 201);
    }

    if (action === "prepare-take") {
      return response({
        ok: true,
        ...prepareStoryVideoTake({
          ...common,
          planVersion: body.planVersion,
          sceneId: body.sceneId,
          shotId: body.shotId,
          method: body.method,
          motion: body.motion,
          durationSeconds: body.durationSeconds,
          orientation: body.orientation,
          quality: body.quality,
          seed: body.seed,
          rifeInterpolation60Fps: body.rifeInterpolation60Fps,
          userLoras: body.userLoras,
          h3Settings: body.h3Settings,
          referenceVersionIds: body.referenceVersionIds,
          sourceTakeId: body.sourceTakeId,
          videoClipStartSeconds: body.videoClipStartSeconds,
          idempotencyKey: body.idempotencyKey,
        }),
      }, 201);
    }

    if (action === "submit-take") {
      const result = submitStoryVideoTake({
        ...common,
        takeId: body.takeId,
        authorized: body.authorized,
      });
      startProductionV2H3Scheduler();
      requestProductionV2H3SchedulerTick();
      return response({ ok: true, ...result }, 202);
    }

    if (action === "retry-take" || action === "promote-scene-hunter") {
      return response({
        ok: true,
        ...prepareStoryVideoRetry({
          ...common,
          takeId: body.takeId,
          motion: body.motion,
          promoteSceneHunter: action === "promote-scene-hunter",
          idempotencyKey: body.idempotencyKey,
        }),
      }, 201);
    }

    if (action === "accept-take" || action === "reject-take") {
      return response({
        ok: true,
        take: setStoryVideoTakeDecision({
          ...common,
          takeId: body.takeId,
          decision: action === "accept-take" ? "accept" : "reject",
        }),
      });
    }

    if (action === "cancel-take") {
      return response({
        ok: true,
        take: cancelQueuedStoryVideoTake({ ...common, takeId: body.takeId }),
      });
    }

    if (action === "prepare-batch") {
      return response({
        ok: true,
        ...prepareStoryVideoBatch({
          ...common,
          sceneIds: body.sceneIds,
          maxJobs: body.maxJobs,
          defaults: body.defaults && typeof body.defaults === "object" && !Array.isArray(body.defaults)
            ? body.defaults as Record<string, unknown>
            : undefined,
          idempotencyKey: body.idempotencyKey,
        }),
      }, 201);
    }

    if (action === "approve-batch") {
      const result = approveStoryVideoBatch({
        ...common,
        batchId: body.batchId,
        authorized: body.authorized,
        maxJobs: body.maxJobs,
      });
      if (result.submitted.length) {
        startProductionV2H3Scheduler();
        requestProductionV2H3SchedulerTick();
      }
      return response({ ok: true, ...result }, 202);
    }

    return response({ ok: false, error: "Story video production action is not supported." }, 400);
  } catch (error) {
    return failure(error);
  }
}
