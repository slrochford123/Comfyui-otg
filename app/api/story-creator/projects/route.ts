import { NextRequest, NextResponse } from "next/server";

import {
  createStoryCreatorProject,
  deleteStoryCreatorProject,
  listStoryCreatorProjects,
  STORY_CREATOR_PROJECT_LIMIT,
  updateStoryCreatorProject,
} from "../../../../lib/storyCreator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Story Creator request failed.";

  const code =
    error &&
    typeof error === "object" &&
    "code" in error
      ? String((error as any).code || "")
      : "";

  const status =
    code === "STORY_PROJECT_LIMIT"
      ? 409
      : code === "STORY_PROJECT_NOT_FOUND"
        ? 404
        : 400;

  return NextResponse.json(
    { ok: false, error: message, code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function ownerFromRequest(request: NextRequest) {
  return String(
    request.nextUrl.searchParams.get("owner") ||
      request.headers.get("x-otg-story-owner") ||
      "",
  ).trim();
}

export async function GET(request: NextRequest) {
  try {
    const ownerKey = ownerFromRequest(request);
    const projects = listStoryCreatorProjects(ownerKey);

    return NextResponse.json(
      {
        ok: true,
        projects,
        limit: STORY_CREATOR_PROJECT_LIMIT,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const project = createStoryCreatorProject({
      ownerKey:
        body?.ownerKey ||
        request.headers.get("x-otg-story-owner") ||
        "",
      title: body?.title,
      format: body?.format,
      genre: body?.genre,
    });

    return NextResponse.json(
      {
        ok: true,
        project,
        limit: STORY_CREATOR_PROJECT_LIMIT,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const project = updateStoryCreatorProject({
      ownerKey:
        body?.ownerKey ||
        request.headers.get("x-otg-story-owner") ||
        "",
      id: body?.id,
      title: body?.title,
      format: body?.format,
      genre: body?.genre,
    });

    return NextResponse.json(
      { ok: true, project },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const result = deleteStoryCreatorProject({
      ownerKey:
        body?.ownerKey ||
        request.headers.get("x-otg-story-owner") ||
        "",
      id: body?.id,
    });

    return NextResponse.json(
      result,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}
