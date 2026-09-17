import { NextRequest, NextResponse } from "next/server";

import { SessionInvalidError } from "@/lib/ownerKey";
import { getSessionUser } from "@/lib/sessionUser";

import {
  addStoryCreatorMessage,
  listStoryCreatorMessages,
} from "../../../../lib/storyCreator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Story Creator message request failed.";

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

async function authenticatedOwnerKey(request: NextRequest) {
  const user = await getSessionUser(request);
  return user.ownerKey;
}

export async function GET(request: NextRequest) {
  try {
    const ownerKey = await authenticatedOwnerKey(request);

    const projectId = String(
      request.nextUrl.searchParams.get("projectId") || "",
    ).trim();

    const messages = listStoryCreatorMessages({
      ownerKey,
      projectId,
    });

    return NextResponse.json(
      {
        ok: true,
        messages,
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
    const ownerKey = await authenticatedOwnerKey(request);
    const body = await request.json().catch(() => ({}));

    const message = addStoryCreatorMessage({
      ownerKey,
      projectId: body?.projectId,
      role: body?.role,
      content: body?.content,
    });

    return NextResponse.json(
      {
        ok: true,
        message,
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
