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
  addStoryCreatorMessage,
  listStoryCreatorMessages,
} from "../../../../lib/storyCreator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function requestError(
  code: string,
  message: string,
  status = 400,
) {
  const error = new Error(message) as Error & {
    code?: string;
    status?: number;
  };

  error.code = code;
  error.status = status;

  return error;
}

function jsonError(error: unknown) {
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
      "Story Director ownership, message roles, history, and assistant provenance are assigned by the server.",
    );
  }
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

    assertServerOwnedTurnFields(body);

    const projectId =
      body &&
      typeof body === "object"
        ? (
            body as {
              projectId?: unknown;
            }
          ).projectId
        : undefined;

    const content =
      body &&
      typeof body === "object"
        ? (
            body as {
              content?: unknown;
            }
          ).content
        : undefined;

    /*
     * Persist the user turn before AI work.
     *
     * If Story Helper fails, the user's authored turn remains
     * durable and the response includes that saved message.
     */
    const userMessage =
      addStoryCreatorMessage({
        ownerKey,
        projectId,
        role: "user",
        content,
      });

    const history =
      listStoryCreatorMessages({
        ownerKey,
        projectId:
          userMessage.projectId,
      });

    /*
     * Reuse the accepted strict-canon Story Helper handler
     * in-process. The browser never chooses assistant
     * provenance for the resulting message.
     */
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
          body: JSON.stringify({
            messages:
              history.map(
                ({
                  role,
                  content: messageContent,
                }) => ({
                  role,
                  content:
                    messageContent,
                }),
              ),
          }),
        },
      );

    const helperResponse =
      await runStoryHelperChat(
        helperRequest,
      );

    const helperData =
      await helperResponse
        .json()
        .catch(() => ({}));

    if (!helperResponse.ok) {
      const helperError =
        helperData &&
        typeof helperData === "object" &&
        typeof (
          helperData as {
            error?: unknown;
          }
        ).error === "string"
          ? String(
              (
                helperData as {
                  error?: unknown;
                }
              ).error,
            ).trim()
          : "";

      return NextResponse.json(
        {
          ok: false,
          error:
            helperError ||
            "Story Director could not respond.",
          code:
            "STORY_DIRECTOR_AI_FAILED",
          userMessage,
        },
        {
          status:
            helperResponse.status >= 400 &&
            helperResponse.status <= 599
              ? helperResponse.status
              : 502,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    const responseText =
      readStoryHelperMessage(
        helperData,
      );

    if (!responseText) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Story Director returned an empty response.",
          code:
            "STORY_DIRECTOR_EMPTY_RESPONSE",
          userMessage,
        },
        {
          status: 502,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    /*
     * Normal Story Director assistant provenance is assigned
     * only here, after the trusted Story Helper response exists.
     */
    const assistantMessage =
      addStoryCreatorMessage({
        ownerKey,
        projectId:
          userMessage.projectId,
        role: "assistant",
        content: responseText,
      });

    return NextResponse.json(
      {
        ok: true,
        userMessage,
        assistantMessage,
        storyHelperGuard:
          helperData &&
          typeof helperData === "object"
            ? (
                helperData as {
                  storyHelperGuard?: unknown;
                }
              ).storyHelperGuard ??
              null
            : null,
        model:
          helperData &&
          typeof helperData === "object"
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
    return jsonError(error);
  }
}
