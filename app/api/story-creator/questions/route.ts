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
  addStoryOpenQuestion,
  listStoryOpenQuestions,
} from "../../../../lib/storyCreator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Story questions request failed.";

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

export async function GET(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const projectId = String(
      request.nextUrl.searchParams.get("projectId") || "",
    ).trim();

    const questions = listStoryOpenQuestions({
      ownerKey: user.ownerKey,
      projectId,
      status:
        request.nextUrl.searchParams.get("status") ||
        "open",
    });

    return NextResponse.json(
      {
        ok: true,
        questions,
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

    const question = addStoryOpenQuestion({
      ownerKey: user.ownerKey,
      projectId: body?.projectId,
      question: body?.question,
      status: body?.status || "open",
      sourceRole: "user",
    });

    return NextResponse.json(
      {
        ok: true,
        question,
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
