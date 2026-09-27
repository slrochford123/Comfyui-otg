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
  findStoryBibleConflicts,
  listStoryConflicts,
  resolveStoryConflict,
} from "../../../../lib/storyCreator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Story conflict request failed.";

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
        : code === "STORY_CONFLICT_NOT_FOUND"
          ? 404
          : code === "STORY_BIBLE_FACT_NOT_FOUND"
            ? 404
            : code === "STORY_CONFLICT_NOT_OPEN"
              ? 409
              : code === "STORY_CONFLICT_STALE"
                ? 409
                : code === "STORY_BIBLE_FACT_ALREADY_REVIEWED"
                  ? 409
                  : code === "STORY_BIBLE_FACT_ALREADY_SUPERSEDED"
                    ? 409
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

function requestError(
  code: string,
  message: string,
) {
  const error = new Error(message) as Error & {
    code?: string;
  };

  error.code = code;

  return error;
}

async function authenticatedOwnerKey(
  request: NextRequest,
) {
  const user =
    await requireSessionUser(request);

  return user.ownerKey;
}

function assertServerOwnedConflictAction(
  body: unknown,
) {
  if (
    body &&
    typeof body === "object" &&
    (
      "ownerKey" in body ||
      "sourceRole" in body ||
      "canonStatus" in body ||
      "supersedesFactId" in body ||
      "resultFactId" in body
    )
  ) {
    throw requestError(
      "STORY_CONFLICT_CLIENT_AUTHORITY_FORBIDDEN",
      "Conflict resolution authority is assigned by the authenticated user action.",
    );
  }
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

    const conflicts =
      listStoryConflicts({
        ownerKey,
        projectId,
        status: "open",
      });

    return NextResponse.json(
      {
        ok: true,
        conflicts,
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
    const ownerKey =
      await authenticatedOwnerKey(request);

    const body =
      await request
        .json()
        .catch(() => ({}));

    assertServerOwnedConflictAction(body);

    const action =
      typeof body?.action === "string" &&
      body.action.trim()
        ? body.action.trim()
        : "CHECK_CONFLICTS";

    if (action === "CHECK_CONFLICTS") {
      const conflicts =
        findStoryBibleConflicts({
          ownerKey,
          projectId: body?.projectId,
        });

      return NextResponse.json(
        {
          ok: true,
          conflicts,
        },
        {
          status: 201,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const result =
      resolveStoryConflict({
        ownerKey,
        projectId: body?.projectId,
        conflictId: body?.conflictId,
        action,
        valueText: body?.valueText,
        objectEntityId: body?.objectEntityId,
      });

    return NextResponse.json(
      {
        ok: true,
        ...result,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return jsonError(error);
  }
}
