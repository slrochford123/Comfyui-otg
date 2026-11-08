import { NextRequest, NextResponse } from "next/server";

import { SessionInvalidError } from "@/lib/ownerKey";
import { requireSessionUser } from "@/lib/sessionUser";
import { getStoryMedia } from "@/lib/storyCreator/mediaStore";

import {
  addStoryCreatorMessage,
  listStoryCreatorMessages,
  removeStoryChatItems,
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
      : code.endsWith("_NOT_FOUND")
        ? 404
        : code === "STORY_TURN_BUSY" ? 409 : 400;

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
  const user = await requireSessionUser(request);
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


export async function DELETE(request: NextRequest) {
  try {
    const ownerKey = await authenticatedOwnerKey(request);
    const headers = { "Cache-Control": "no-store" };
    const origin = request.headers.get("origin");
    if ((origin && new URL(origin).host !== request.headers.get("host")) ||
        request.headers.get("sec-fetch-site") === "cross-site") {
      return NextResponse.json({ ok: false, error: "Same-origin request required." }, { status: 403, headers });
    }
    const params = request.nextUrl.searchParams;
    const projectId = params.get("projectId") || "";
    const kind = params.get("kind");
    const id = params.get("id") || "";
    if (kind !== "all" && ((kind !== "message" && kind !== "media") || !id)) {
      return NextResponse.json({ ok: false, error: "Choose content to remove from this chat." }, { status: 400, headers });
    }
    if (kind === "media") getStoryMedia(ownerKey, projectId, id);
    const removedMessages = removeStoryChatItems({ ownerKey, projectId, target: kind === "all" ? { kind } : { kind, id } });
    return NextResponse.json({ ok: true, removedMessages }, { headers });
  } catch (error) {
    return jsonError(error);
  }
}
