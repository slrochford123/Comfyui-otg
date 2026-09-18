import { NextRequest, NextResponse } from "next/server";

import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";

import {
  listStoryBibleEntities,
  listStoryBibleFacts,
} from "../../../../lib/storyCreator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Story Bible request failed.";

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

async function authenticatedOwnerKey(
  request: NextRequest,
) {
  const user = await requireSessionUser(request);
  return user.ownerKey;
}

export async function GET(request: NextRequest) {
  try {
    const ownerKey =
      await authenticatedOwnerKey(request);

    const projectId = String(
      request.nextUrl.searchParams.get(
        "projectId",
      ) || "",
    ).trim();

    const entities = listStoryBibleEntities({
      ownerKey,
      projectId,
    });

    const facts = listStoryBibleFacts({
      ownerKey,
      projectId,
      includeSuperseded: false,
    });

    return NextResponse.json(
      {
        ok: true,
        entities,
        facts,
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
