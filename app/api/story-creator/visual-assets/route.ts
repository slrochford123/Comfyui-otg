import { NextRequest, NextResponse } from "next/server";

import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import {
  approveStoryVisualVersion,
  bindStoryVisualVersion,
  listStoryVisualAssets,
  planStoryVisualAssetsFromProduction,
  prepareStoryVisualGeneration,
  recordStoryVisualSubmission,
  rejectStoryVisualVersion,
  restoreStoryVisualVersion,
} from "@/lib/storyCreator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function failure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  const status = error instanceof SessionInvalidError
    ? 401
    : code.endsWith("NOT_FOUND")
      ? 404
      : 400;
  return response({
    ok: false,
    error: error instanceof Error ? error.message : "Visual asset request failed.",
    code,
  }, status);
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const projectId = String(request.nextUrl.searchParams.get("projectId") || "").trim();
    return response({
      ok: true,
      assets: listStoryVisualAssets({ ownerKey: user.ownerKey, projectId }),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const body = await request.json().catch(() => ({}));
    const common = {
      ownerKey: user.ownerKey,
      projectId: body.projectId,
    };
    const action = String(body.action || "");

    if (action === "prepare-generation" || action === "prepare-edit") {
      const prepared = prepareStoryVisualGeneration({
        ...common,
        assetId: body.assetId,
        parentVersionId: action === "prepare-edit" ? body.sourceVersionId : body.parentVersionId,
        visualKind: body.visualKind,
        name: body.name,
        prompt: body.prompt,
        artStyle: body.artStyle,
        aspectRatio: body.aspectRatio,
        referenceVersionIds: body.referenceVersionIds,
        entityId: body.entityId,
        metadata: {
          ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}),
          action,
        },
      });
      return response({ ok: true, ...prepared }, 201);
    }

    if (action === "plan-from-production") {
      return response({ ok: true, result: planStoryVisualAssetsFromProduction(common) }, 201);
    }

    if (action === "record-submission") {
      return response({
        ok: true,
        ...recordStoryVisualSubmission({
          ...common,
          versionId: body.versionId,
          promptId: body.promptId,
          response: body.response,
          endpoint: body.endpoint,
        }),
      });
    }

    if (action === "approve-version") {
      return response({ ok: true, version: approveStoryVisualVersion({ ...common, versionId: body.versionId }) });
    }

    if (action === "reject-version") {
      return response({ ok: true, version: rejectStoryVisualVersion({ ...common, versionId: body.versionId }) });
    }

    if (action === "restore-version") {
      return response({ ok: true, version: restoreStoryVisualVersion({ ...common, versionId: body.versionId }) }, 201);
    }

    if (action === "bind-version") {
      return response({
        ok: true,
        binding: bindStoryVisualVersion({
          ...common,
          versionId: body.versionId,
          bindingType: body.bindingType,
          entityId: body.entityId,
          planVersion: body.planVersion,
          sceneId: body.sceneId,
          shotId: body.shotId,
          role: body.role,
        }),
      }, 201);
    }

    return response({ ok: false, error: "Visual asset action is not supported." }, 400);
  } catch (error) {
    return failure(error);
  }
}
