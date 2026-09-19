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
  POST as runStoryHelperChat,
} from "../../ollama-ai/chat/route";

import {
  claimStoryCreatorTurn,
  completeStoryCreatorTurn,
  failStoryCreatorTurn,
  listStoryCreatorMessages,
  saveStoryCreatorTurnAssistant,
} from "../../../../lib/storyCreator/store";

import {
  extractAndPersistStoryBibleProposals,
} from "@/lib/storyCreator/extractionPersistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function requestError(
  code: string,
  message: string,
  status = 400,
) {
  const error =
    new Error(message) as Error & {
      code?: string;
      status?: number;
    };

  error.code = code;
  error.status = status;

  return error;
}

function jsonResponse(
  body: unknown,
  status: number,
) {
  return NextResponse.json(
    body,
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function jsonError(
  error: unknown,
) {
  const message =
    error instanceof Error
      ? error.message
      : "Story Director turn failed.";

  const code =
    error &&
    typeof error === "object" &&
    "code" in error
      ? String(
          (
            error as {
              code?: unknown;
            }
          ).code || "",
        )
      : "";

  const explicitStatus =
    error &&
    typeof error === "object" &&
    "status" in error
      ? Number(
          (
            error as {
              status?: unknown;
            }
          ).status,
        )
      : 0;

  const status =
    error instanceof SessionInvalidError
      ? 401
      : code === "STORY_PROJECT_NOT_FOUND"
        ? 404
        : Number.isFinite(explicitStatus) &&
            explicitStatus >= 400 &&
            explicitStatus <= 599
          ? explicitStatus
          : 400;

  return jsonResponse(
    {
      ok: false,
      error: message,
      code,
    },
    status,
  );
}

async function authenticatedOwnerKey(
  request: NextRequest,
) {
  const user =
    await requireSessionUser(
      request,
    );

  return user.ownerKey;
}

function assertServerOwnedTurnFields(
  body: unknown,
) {
  if (
    !body ||
    typeof body !== "object"
  ) {
    return;
  }

  const record =
    body as Record<string, unknown>;

  const forbidden = [
    "ownerKey",
    "role",
    "messages",
    "assistantMessage",
    "sourceRole",
    "sourceMessageId",
    "leaseToken",
    "leaseExpiresAt",
    "status",
    "turnId",
    "userMessageId",
    "assistantMessageId",
  ];

  const supplied =
    forbidden.filter(
      (key) =>
        Object.prototype.hasOwnProperty.call(
          record,
          key,
        ),
    );

  if (supplied.length) {
    throw requestError(
      "STORY_DIRECTOR_TURN_SERVER_FIELDS_FORBIDDEN",
      "Story Director ownership, roles, history, assistant provenance, and turn leases are assigned by the server.",
    );
  }
}

function bodyField(
  body: unknown,
  key: string,
) {
  if (
    !body ||
    typeof body !== "object"
  ) {
    return undefined;
  }

  return (
    body as Record<string, unknown>
  )[key];
}

function readStoryHelperMessage(
  data: unknown,
) {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return "";
  }

  const value =
    (
      data as {
        message?: unknown;
      }
    ).message;

  return typeof value === "string"
    ? value.trim()
    : "";
}

function readStoryHelperError(
  data: unknown,
) {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return "";
  }

  const value =
    (
      data as {
        error?: unknown;
      }
    ).error;

  return typeof value === "string"
    ? value.trim()
    : "";
}

/*
 * role: "user"
 * role: "assistant"
 *
 * Both roles remain server-owned.
 */

export async function POST(
  request: NextRequest,
) {
  try {
    const ownerKey =
      await authenticatedOwnerKey(
        request,
      );

    const body =
      await request
        .json()
        .catch(() => ({}));

    assertServerOwnedTurnFields(
      body,
    );

    const projectId =
      bodyField(
        body,
        "projectId",
      );

    const content =
      bodyField(
        body,
        "content",
      );

    const clientTurnId =
      bodyField(
        body,
        "clientTurnId",
      );

    /*
     * STORY_DIRECTOR_TURN_IDEMPOTENCY_V1
     */
    const claim =
      claimStoryCreatorTurn({
        ownerKey,
        projectId,
        clientTurnId,
        content,
      });

    if (
      claim.action === "completed"
    ) {
      return jsonResponse(
        {
          ok: true,
          replayed: true,
          resumed: false,
          clientTurnId:
            claim.turn.clientTurnId,
          userMessage:
            claim.userMessage,
          assistantMessage:
            claim.assistantMessage,
          storyBibleExtraction: null,
          storyHelperGuard: null,
          model: null,
        },
        200,
      );
    }

    if (
      claim.action === "in_progress"
    ) {
      return jsonResponse(
        {
          ok: false,
          error:
            "This Story Director turn is already being processed. Retry shortly with the same request.",
          code:
            "STORY_DIRECTOR_TURN_IN_PROGRESS",
          retryable: true,
          clientTurnId:
            claim.turn.clientTurnId,
          userMessage:
            claim.userMessage,
          assistantMessage:
            claim.assistantMessage,
        },
        409,
      );
    }

    const userMessage =
      claim.userMessage;

    let helperData:
      unknown = null;

    let assistantCandidate =
      claim.action === "resume_assistant"
        ? claim.assistantMessage
        : null;

    if (
      claim.action === "claimed"
    ) {
      const history =
        listStoryCreatorMessages({
          ownerKey,
          projectId:
            userMessage.projectId,
        });

      const helperRequest =
        new NextRequest(
          "http://story-creator.internal/api/ollama-ai/chat",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
              "x-otg-ai-assistance":
                "1",
              "x-otg-ai-assistance-profile":
                "story-helper",
            },
            body:
              JSON.stringify({
                messages:
                  history.map(
                    ({
                      role,
                      content:
                        messageContent,
                    }) => ({
                      role,
                      content:
                        messageContent,
                    }),
                  ),
              }),
          },
        );

      let helperResponse:
        Response;

      try {
        helperResponse =
          await runStoryHelperChat(
            helperRequest,
          );
      } catch (error) {
        failStoryCreatorTurn({
          ownerKey,
          projectId:
            userMessage.projectId,
          clientTurnId:
            claim.turn.clientTurnId,
          leaseToken:
            claim.leaseToken,
          error:
            error instanceof Error
              ? error.message
              : "Story Helper request failed.",
        });

        return jsonResponse(
          {
            ok: false,
            error:
              error instanceof Error &&
              error.message.trim()
                ? error.message.trim()
                : "Story Director could not respond.",
            code:
              "STORY_DIRECTOR_AI_FAILED",
            retryable: true,
            clientTurnId:
              claim.turn.clientTurnId,
            userMessage,
          },
          502,
        );
      }

      helperData =
        await helperResponse
          .json()
          .catch(() => ({}));

      if (
        !helperResponse.ok
      ) {
        const helperError =
          readStoryHelperError(
            helperData,
          );

        failStoryCreatorTurn({
          ownerKey,
          projectId:
            userMessage.projectId,
          clientTurnId:
            claim.turn.clientTurnId,
          leaseToken:
            claim.leaseToken,
          error:
            helperError ||
            "Story Director could not respond.",
        });

        return jsonResponse(
          {
            ok: false,
            error:
              helperError ||
              "Story Director could not respond.",
            code:
              "STORY_DIRECTOR_AI_FAILED",
            retryable: true,
            clientTurnId:
              claim.turn.clientTurnId,
            userMessage,
          },
          helperResponse.status >= 400 &&
            helperResponse.status <= 599
            ? helperResponse.status
            : 502,
        );
      }

      const responseText =
        readStoryHelperMessage(
          helperData,
        );

      if (!responseText) {
        failStoryCreatorTurn({
          ownerKey,
          projectId:
            userMessage.projectId,
          clientTurnId:
            claim.turn.clientTurnId,
          leaseToken:
            claim.leaseToken,
          error:
            "Story Director returned an empty response.",
        });

        return jsonResponse(
          {
            ok: false,
            error:
              "Story Director returned an empty response.",
            code:
              "STORY_DIRECTOR_EMPTY_RESPONSE",
            retryable: true,
            clientTurnId:
              claim.turn.clientTurnId,
            userMessage,
          },
          502,
        );
      }

      assistantCandidate =
        saveStoryCreatorTurnAssistant({
          ownerKey,
          projectId:
            userMessage.projectId,
          clientTurnId:
            claim.turn.clientTurnId,
          leaseToken:
            claim.leaseToken,
          content:
            responseText,
        });
    }

    if (!assistantCandidate) {
      throw requestError(
        "STORY_DIRECTOR_TURN_STATE_CORRUPT",
        "Story Director turn is missing its persisted assistant message.",
        500,
      );
    }

    const assistantMessage =
      assistantCandidate;

    /*
     * STORY_BIBLE_POST_ASSISTANT_EXTRACTION_V1
     */
    let storyBibleExtraction;

    try {
      storyBibleExtraction =
        await extractAndPersistStoryBibleProposals({
          ownerKey,
          projectId:
            userMessage.projectId,
          userMessage: {
            content:
              userMessage.content,
          },
          assistantMessage: {
            id:
              assistantMessage.id,
            content:
              assistantMessage.content,
          },
        });
    } catch (error) {
      storyBibleExtraction = {
        status: "failed" as const,
        error:
          error instanceof Error &&
          error.message.trim()
            ? error.message.trim()
            : "Story Bible extraction failed.",
      };
    }

    completeStoryCreatorTurn({
      ownerKey,
      projectId:
        userMessage.projectId,
      clientTurnId:
        claim.turn.clientTurnId,
      leaseToken:
        claim.leaseToken,
    });

    return NextResponse.json(
      {
        ok: true,
        replayed: false,
        resumed:
          claim.action ===
          "resume_assistant",
        clientTurnId:
          claim.turn.clientTurnId,
        userMessage,
        assistantMessage,
        storyBibleExtraction,
        storyHelperGuard:
          helperData &&
          typeof helperData ===
            "object"
            ? (
                helperData as {
                  storyHelperGuard?:
                    unknown;
                }
              ).storyHelperGuard ??
              null
            : null,
        model:
          helperData &&
          typeof helperData ===
            "object"
            ? (
                helperData as {
                  model?: unknown;
                }
              ).model ??
              null
            : null,
      },
      {
        status: 201,
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  } catch (error) {
    return jsonError(
      error,
    );
  }
}
