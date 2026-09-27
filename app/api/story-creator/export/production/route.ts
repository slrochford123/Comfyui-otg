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
  addStoryExport,
  listStoryAssets,
  listStoryBibleEntities,
  listStoryBibleFacts,
  listStoryConflicts,
  listStoryCreatorMessages,
  listStoryCreatorProjects,
  listStoryGenerationJobs,
} from "../../../../../lib/storyCreator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORY_WORKFLOW_BUNDLE = [
  "comfy_workflows/internal/story-creator/qwen21-story-character-t2i-api.json",
  "comfy_workflows/internal/story-creator/qwen21-story-location-t2i-api.json",
  "comfy_workflows/internal/story-creator/qwen21-story-asset-t2i-api.json",
  "comfy_workflows/internal/story-creator/qwen21-story-image-edit-api.json",
  "comfy_workflows/internal/story-creator/qwen21-story-character-card-api.json",
  "comfy_workflows/internal/story-creator/h3-story-preview-i2v-api.json",
  "comfy_workflows/internal/story-creator/h3-story-preview-r2v-api.json",
] as const;

function jsonError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Story export request failed.";

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

function projectNotFoundError() {
  const error = new Error("Story project not found.") as Error & {
    code?: string;
  };
  error.code = "STORY_PROJECT_NOT_FOUND";
  return error;
}

function buildPackage(input: {
  ownerKey: string;
  projectId: string;
}) {
  const project =
    listStoryCreatorProjects(input.ownerKey).find(
      (item) => item.id === input.projectId,
    );

  if (!project) {
    throw projectNotFoundError();
  }

  const entities = listStoryBibleEntities(input);
  const facts = listStoryBibleFacts(input);
  const canonFacts = facts.filter(
    (fact) => fact.canonStatus === "canon",
  );
  const suggestions = facts.filter(
    (fact) => fact.canonStatus === "suggestion",
  );
  const unknowns = facts.filter(
    (fact) => fact.canonStatus === "unknown",
  );
  const conflicts = listStoryConflicts({
    ...input,
    status: "open",
  });
  const assets = listStoryAssets(input);
  const jobs = listStoryGenerationJobs(input);
  const messages = listStoryCreatorMessages(input).slice(-20);

  return {
    version: 2,
    generatedAt: Date.now(),
    project,
    counts: {
      messages: messages.length,
      entities: entities.length,
      canonFacts: canonFacts.length,
      suggestions: suggestions.length,
      unknowns: unknowns.length,
      openConflicts: conflicts.length,
      assets: assets.length,
      generationJobs: jobs.length,
    },
    canon: {
      entities,
      facts: canonFacts,
    },
    review: {
      suggestions,
      unknowns,
      openConflicts: conflicts,
    },
    assets,
    generationJobs: jobs,
    recentMessages: messages,
    workflowBundle: STORY_WORKFLOW_BUNDLE,
    handoffTargets: {
      qwenImage21: "/api/assets/create-image",
      qwenImageEdit21:
        "presets/image_qwen_image_2_1_image_edit",
      qwenCharacterCard21:
        "presets/character_card_qwen_image_2_1",
      h3Preview: "/api/h3/generation",
      voicePreview: "/api/characters/voice-preview",
      productionV2: "/api/production/v2/generation",
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const projectId = String(
      request.nextUrl.searchParams.get("projectId") || "",
    ).trim();
    const storyPackage = buildPackage({
      ownerKey: user.ownerKey,
      projectId,
    });

    return NextResponse.json(
      {
        ok: true,
        package: storyPackage,
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
    const projectId = String(body?.projectId || "").trim();
    const storyPackage = buildPackage({
      ownerKey: user.ownerKey,
      projectId,
    });

    const storyExport = addStoryExport({
      ownerKey: user.ownerKey,
      projectId,
      exportType: "production-package",
      status: "ready",
      payload: storyPackage,
    });

    return NextResponse.json(
      {
        ok: true,
        export: storyExport,
        package: storyPackage,
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
