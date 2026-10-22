import { NextRequest, NextResponse } from "next/server";

import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import {
  authorizeStoryAudioAsset,
  authorizeStoryAudioBatch,
  listStoryAudioAssets,
  prepareStoryAudioAsset,
  prepareStoryAudioBatch,
  prepareStoryAudioRevision,
  resolveStoryAudioDirectorAction,
  saveStoryVoiceAssignment,
  setStoryAudioDecision,
  storyAudioProductionSnapshot,
} from "@/lib/storyCreator/audioProduction";
import { dispatchStoryAudioAssets } from "@/lib/storyCreator/audioProductionExecutor";

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
        : "Story audio production request failed.",
  }, status);
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const projectId = String(request.nextUrl.searchParams.get("projectId") || "").trim();
    const sceneId = String(request.nextUrl.searchParams.get("sceneId") || "").trim();
    const shotId = String(request.nextUrl.searchParams.get("shotId") || "").trim();
    const queued = listStoryAudioAssets({ ownerKey: user.ownerKey, projectId })
      .filter((asset) => asset.status === "queued")
      .slice(0, 2);
    if (queued.length) {
      dispatchStoryAudioAssets({
        ownerKey: user.ownerKey,
        projectId,
        assetIds: queued.map((asset) => asset.id),
        cookie: request.headers.get("cookie") || "",
      });
    }
    return response({
      ok: true,
      ...storyAudioProductionSnapshot({ ownerKey: user.ownerKey, projectId, sceneId, shotId }),
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

    if (action === "assign-voice") {
      return response({
        ok: true,
        assignment: saveStoryVoiceAssignment({
          ...common,
          characterName: body.characterName,
          entityId: body.entityId,
          voiceId: body.voiceId,
          variant: body.variant,
          speakingStyle: body.speakingStyle,
          stability: body.stability,
          authorizedReference: body.authorizedReference,
        }),
      }, 201);
    }

    if (action === "director-action") {
      return response({
        ok: true,
        asset: resolveStoryAudioDirectorAction({
          ...common,
          sceneId: body.sceneId,
          shotId: body.shotId,
          instruction: body.instruction,
          idempotencyKey: body.idempotencyKey,
        }),
      }, 201);
    }

    if (action === "prepare-asset") {
      return response({
        ok: true,
        asset: prepareStoryAudioAsset({
          ...common,
          planVersion: body.planVersion,
          sceneId: body.sceneId,
          shotId: body.shotId,
          kind: body.kind,
          speakerName: body.speakerName,
          exactText: body.exactText,
          prompt: body.prompt,
          emotion: body.emotion,
          delivery: body.delivery,
          startSeconds: body.startSeconds,
          durationSeconds: body.durationSeconds,
          voiceAssignmentId: body.voiceAssignmentId,
          videoTakeId: body.videoTakeId,
          sourceAssetIds: body.sourceAssetIds,
          sourcePaths: body.sourcePaths,
          keepOriginalAudio: body.keepOriginalAudio,
          idempotencyKey: body.idempotencyKey,
          provider: body.provider,
          model: body.model,
          speed: body.speed,
          bpm: body.bpm,
          keyScale: body.keyScale,
          lyrics: body.lyrics,
          visualVersionId: body.visualVersionId,
          sourceAudioAssetId: body.sourceAudioAssetId,
        }),
      }, 201);
    }

    if (action === "authorize-asset") {
      if (body.authorized !== true) {
        return response({ ok: false, error: "Explicit generation authorization is required." }, 400);
      }
      const asset = authorizeStoryAudioAsset({ ...common, assetId: body.assetId });
      dispatchStoryAudioAssets({
        ownerKey: user.ownerKey,
        projectId: asset.projectId,
        assetIds: [asset.id],
        cookie: request.headers.get("cookie") || "",
      });
      return response({
        ok: true,
        asset,
        executionStatus: "authorized-and-dispatched",
      }, 202);
    }

    if (action === "revise-asset") {
      return response({
        ok: true,
        asset: prepareStoryAudioRevision({
          ...common,
          assetId: body.assetId,
          idempotencyKey: body.idempotencyKey,
          emotion: body.emotion,
          delivery: body.delivery,
          prompt: body.prompt,
          exactText: body.exactText,
        }),
      }, 201);
    }

    if (action === "accept-asset" || action === "reject-asset") {
      return response({
        ok: true,
        asset: setStoryAudioDecision({
          ...common,
          assetId: body.assetId,
          decision: action === "accept-asset" ? "accepted" : "rejected",
        }),
      });
    }

    if (action === "prepare-batch") {
      return response({
        ok: true,
        batch: prepareStoryAudioBatch({
          ...common,
          sceneIds: body.sceneIds,
          maxJobs: body.maxJobs,
          idempotencyKey: body.idempotencyKey,
        }),
      }, 201);
    }

    if (action === "authorize-batch") {
      if (body.authorized !== true) {
        return response({ ok: false, error: "Explicit batch authorization is required." }, 400);
      }
      const batch = authorizeStoryAudioBatch({ ...common, batchId: body.batchId });
      dispatchStoryAudioAssets({
        ownerKey: user.ownerKey,
        projectId: batch.projectId,
        assetIds: batch.assetIds.slice(0, batch.maxJobs),
        cookie: request.headers.get("cookie") || "",
      });
      return response({
        ok: true,
        batch,
        executionStatus: "authorized-and-dispatched",
      }, 202);
    }

    return response({ ok: false, error: "Story audio production action is not supported." }, 400);
  } catch (error) {
    return failure(error);
  }
}
