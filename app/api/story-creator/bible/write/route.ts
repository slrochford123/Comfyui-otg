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
  addStoryBibleFact,
  createStoryBibleEntity,
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
      : "Story Bible write request failed.";

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
            : code === "STORY_BIBLE_REVISION_SCOPE_MISMATCH"
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

function assertServerOwnedProvenance(
  body: unknown,
) {
  if (
    body &&
    typeof body === "object" &&
    (
      "ownerKey" in body ||
      "sourceRole" in body
    )
  ) {
    throw requestError(
      "STORY_BIBLE_PROVENANCE_CLIENT_FORBIDDEN",
      "Story Bible ownership and source role are assigned by the server.",
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

    assertServerOwnedProvenance(body);

    const action = String(
      body?.action || "",
    ).trim();

    if (action === "create-entity") {
      const entity =
        createStoryBibleEntity({
          ownerKey,
          projectId: body?.projectId,
          entityType: body?.entityType,
          name: body?.name,
          sourceRole: "user",
          sourceMessageId:
            body?.sourceMessageId,
        });

      return NextResponse.json(
        {
          ok: true,
          action,
          entity,
        },
        {
          status: 201,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (action === "add-fact") {
      const fact =
        addStoryBibleFact({
          ownerKey,
          projectId: body?.projectId,
          subjectEntityId:
            body?.subjectEntityId,
          predicate: body?.predicate,
          valueText: body?.valueText,
          objectEntityId:
            body?.objectEntityId,
          canonStatus:
            body?.canonStatus,
          sourceRole: "user",
          sourceMessageId:
            body?.sourceMessageId,
          supersedesFactId:
            body?.supersedesFactId,
        });

      return NextResponse.json(
        {
          ok: true,
          action,
          fact,
        },
        {
          status: 201,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    throw requestError(
      "STORY_BIBLE_WRITE_ACTION_INVALID",
      "Story Bible write action must be create-entity or add-fact.",
    );
  } catch (error) {
    return jsonError(error);
  }
}
