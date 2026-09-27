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
  approveStoryBibleFact,
  getStoryFactReview,
} from "../../../../../lib/storyCreator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function jsonError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Story Bible canon approval failed.";

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
        : code === "STORY_BIBLE_FACT_NOT_FOUND"
          ? 404
          : code === "STORY_BIBLE_FACT_ALREADY_SUPERSEDED"
            ? 409
            : code === "STORY_BIBLE_FACT_ALREADY_REVIEWED"
              ? 409
              : code === "STORY_CANON_CONFLICT_REQUIRES_RESOLUTION"
                ? 409
                : code === "STORY_BIBLE_FACT_ALREADY_CANON"
                  ? 409
                  : code === "STORY_BIBLE_APPROVAL_STATUS_INVALID"
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

async function authenticatedOwnerKey(
  request: NextRequest,
) {
  const user =
    await requireSessionUser(request);

  return user.ownerKey;
}

function assertServerOwnedApproval(
  body: unknown,
) {
  if (
    body &&
    typeof body === "object" &&
    (
      "ownerKey" in body ||
      "sourceRole" in body ||
      "canonStatus" in body ||
      "supersedesFactId" in body
    )
  ) {
    throw requestError(
      "STORY_BIBLE_APPROVAL_CLIENT_AUTHORITY_FORBIDDEN",
      "Canon approval authority is assigned by the authenticated user action.",
    );
  }
}

export async function POST(
  request: NextRequest,
) {
  try {
    const ownerKey =
      await authenticatedOwnerKey(request);

    const body =
      await request
        .json()
        .catch(() => ({}));

    assertServerOwnedApproval(body);

    const fact =
      approveStoryBibleFact({
        ownerKey,
        projectId: body?.projectId,
        factId: body?.factId,
        valueText: body?.valueText,
        objectEntityId: body?.objectEntityId,
      });

    const review =
      getStoryFactReview({
        ownerKey,
        projectId: body?.projectId,
        proposalFactId: body?.factId,
      });

    return NextResponse.json(
      {
        ok: true,
        fact,
        review,
      },
      {
        status: 201,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return jsonError(error);
  }
}
