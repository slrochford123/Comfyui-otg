import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  SessionInvalidError,
} from "@/lib/ownerKey";

import {
  requireSessionUser,
} from "@/lib/sessionUser";

import {
  addStoryAsset,
  addStoryGenerationJob,
  listStoryAssets,
  listStoryGenerationJobs,
} from "../../../../lib/storyCreator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Story asset request failed.";

  const code =
    error &&
    typeof error === "object" &&
    "code" in error
      ? String((error as any).code || "")
      : "";

  const status =
    error instanceof SessionInvalidError
      ? 401
      : code === "STORY_PROJECT_NOT_FOUND"
        ? 404
        : code === "STORY_ASSET_NOT_FOUND"
          ? 404
          : 400;

  return NextResponse.json(
    {
      ok: false,
      error: message,
      code,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const projectId = String(
      request.nextUrl.searchParams.get("projectId") || "",
    ).trim();

    const assets = listStoryAssets({
      ownerKey: user.ownerKey,
      projectId,
    });

    const jobs = listStoryGenerationJobs({
      ownerKey: user.ownerKey,
      projectId,
    });

    return NextResponse.json(
      {
        ok: true,
        assets,
        jobs,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const body = await request.json().catch(() => ({}));
    const projectId = String(body?.projectId || "").trim();

    const asset = addStoryAsset({
      ownerKey: user.ownerKey,
      projectId,
      assetType: body?.assetType,
      name: body?.name,
      prompt: body?.prompt,
      status: body?.status || "planned",
      provider: body?.provider || "",
      url: body?.url || null,
      filePath: body?.filePath || null,
      jobId:
        body?.jobId ||
        body?.promptId ||
        body?.generation?.promptId ||
        null,
      metadata: body?.metadata || {},
    });

    let job = null;

    if (
      body?.generation &&
      typeof body.generation === "object"
    ) {
      job = addStoryGenerationJob({
        ownerKey: user.ownerKey,
        projectId,
        assetId: asset.id,
        jobType: body.generation.jobType || body?.assetType,
        provider:
          body.generation.provider ||
          body?.provider ||
          "",
        status: body.generation.status || "submitted",
        promptId:
          body.generation.promptId ||
          body?.promptId ||
          body?.jobId ||
          null,
        externalJobId:
          body.generation.externalJobId || null,
        endpoint: body.generation.endpoint || "",
        request: body.generation.request || {},
        response: body.generation.response || {},
        errorText: body.generation.errorText || "",
      });
    }

    return NextResponse.json(
      {
        ok: true,
        asset,
        job,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return jsonError(error);
  }
}
