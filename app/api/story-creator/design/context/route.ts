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
  assembleStoryDesignContext,
} from "@/lib/storyCreator/designContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Story design context request failed.";

  const code =
    error &&
    typeof error === "object" &&
    "code" in error
      ? String((error as any).code || "")
      : "";

  const status =
    error instanceof SessionInvalidError
      ? 401
      : code === "STORY_PROJECT_NOT_FOUND" ||
          code === "STORY_DESIGN_ENTITY_NOT_FOUND"
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

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const body = await request.json().catch(() => ({}));

    const context = assembleStoryDesignContext({
      ownerKey: user.ownerKey,
      projectId: body?.projectId,
      entityId: body?.entityId,
      userInstruction: body?.userInstruction,
    });

    return NextResponse.json(
      {
        ok: true,
        context,
        prompt: context.prompt,
        provenance: context.provenance,
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
