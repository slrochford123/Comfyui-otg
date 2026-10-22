import { NextRequest, NextResponse } from "next/server";

import {
  createOpenAIText,
  openAIEnabled,
  openAIModels,
} from "@/lib/openai/provider";
import { requireSessionUser } from "@/lib/sessionUser";
import { buildStoryDirectorProjectContext } from "@/lib/storyCreator/context";
import {
  createEmptyStoryProductionPlan,
  parseStoryProductionPlanResponse,
  storyProductionWorkload,
} from "@/lib/storyCreator/productionPlan";
import {
  approveStoryProductionPlan,
  getStoryProductionPlan,
  listStoryCreatorMessages,
  listStoryCreatorProjects,
  listStoryProductionPlanVersions,
  saveStoryProductionPlan,
} from "@/lib/storyCreator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

function noStore(payload: unknown, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "private, no-store",
      ...(init?.headers || {}),
    },
  });
}

function errorResponse(error: unknown, fallback: string) {
  const status =
    typeof error === "object" && error && "status" in error
      ? Number((error as { status?: unknown }).status) || 500
      : 500;
  return noStore(
    {
      ok: false,
      error:
        status === 401
          ? "Unauthorized"
          : error instanceof Error
            ? error.message
            : fallback,
      code:
        typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code || "")
          : "",
    },
    { status },
  );
}

function projectForOwner(ownerKey: string, projectId: string) {
  const project = listStoryCreatorProjects(ownerKey).find(
    (item) => item.id === projectId,
  );
  if (!project) {
    const error = new Error("Story project was not found.") as Error & {
      status?: number;
      code?: string;
    };
    error.status = 404;
    error.code = "STORY_PROJECT_NOT_FOUND";
    throw error;
  }
  return project;
}

function plannerInstructions() {
  return [
    "You are the production planner for SLR Studios Storyteller.",
    "Return only one valid JSON object. Do not use Markdown fences.",
    "The user owns the story. Approved canon is authoritative.",
    "Proposed and unknown details are not canon; do not silently promote them.",
    "Plan Project -> Act -> Scene -> Shot. Include an empty takes array for every shot.",
    "Every scene needs title, purpose, location, timeOfDay, characters, action, dialogue, emotionalTone, continuityRequirements, durationTargetSeconds, screenplaySource, and shots.",
    "Every shot needs shotNumber, screenplayExcerpt, description, cameraFraming, cameraMovement, characterActions, dialogue, referenceAssetIds, generationApproach, requestedDurationSeconds, status, acceptedTakeId, and takes.",
    "generationApproach must be text-to-video, image-to-video, reference-to-video, or video-edit.",
    "requestedDurationSeconds must be 5 or 10. Use enough connected shots to cover each scene's intended duration without cutting dialogue or story action.",
    "Use reference-to-video when established character consistency matters and references are available. Use image-to-video for a composed starting frame. Use text-to-video only when references are unnecessary.",
    "Do not claim media was generated. Every shot starts with status planned and acceptedTakeId null.",
    "Use stable concise IDs or omit IDs and the server will create them.",
    "The root object must include title, format, summary, targetDurationSeconds, status draft, and acts.",
  ].join(" ");
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const projectId = String(
      request.nextUrl.searchParams.get("projectId") || "",
    ).trim();
    if (!projectId) {
      return noStore(
        { ok: false, error: "projectId is required." },
        { status: 400 },
      );
    }
    projectForOwner(user.ownerKey, projectId);
    const record = getStoryProductionPlan({
      ownerKey: user.ownerKey,
      projectId,
    });
    const versions = listStoryProductionPlanVersions({
      ownerKey: user.ownerKey,
      projectId,
    });
    return noStore({
      ok: true,
      record,
      versions,
      workload: record ? storyProductionWorkload(record.plan) : null,
    });
  } catch (error) {
    return errorResponse(error, "Could not load the production plan.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    const body = await request.json().catch(() => null) as
      | Record<string, unknown>
      | null;
    const projectId = String(body?.projectId || "").trim();
    const action = String(body?.action || "").trim().toLowerCase();
    if (!projectId) {
      return noStore(
        { ok: false, error: "projectId is required." },
        { status: 400 },
      );
    }
    const project = projectForOwner(user.ownerKey, projectId);

    if (action === "create") {
      const plan = createEmptyStoryProductionPlan({
        projectId,
        title: project.title,
        format: project.format || "movie",
        targetDurationSeconds: Number(body?.targetDurationSeconds || 60),
      });
      const record = saveStoryProductionPlan({
        ownerKey: user.ownerKey,
        projectId,
        plan,
        sourceRole: "user",
      });
      return noStore(
        { ok: true, record, workload: storyProductionWorkload(record.plan) },
        { status: 201 },
      );
    }

    if (action === "save") {
      const record = saveStoryProductionPlan({
        ownerKey: user.ownerKey,
        projectId,
        plan: body?.plan,
        sourceRole: "user",
      });
      return noStore({
        ok: true,
        record,
        workload: storyProductionWorkload(record.plan),
      });
    }

    if (action === "approve") {
      const record = approveStoryProductionPlan({
        ownerKey: user.ownerKey,
        projectId,
      });
      return noStore({
        ok: true,
        record,
        workload: storyProductionWorkload(record.plan),
        message:
          "Production plan approved. No image, video, audio, paid batch, or GPU generation was started.",
      });
    }

    if (action === "generate") {
      if (!openAIEnabled()) {
        return noStore(
          { ok: false, error: "OpenAI Story planning is unavailable." },
          { status: 503 },
        );
      }
      const direction = String(body?.direction || "").trim().slice(0, 30_000);
      const targetDurationSeconds = Math.max(
        5,
        Math.min(43_200, Number(body?.targetDurationSeconds || 60)),
      );
      const context = buildStoryDirectorProjectContext({
        ownerKey: user.ownerKey,
        projectId,
        query: direction,
      });
      const recentMessages = listStoryCreatorMessages({
        ownerKey: user.ownerKey,
        projectId,
      }).slice(-20);
      const result = await createOpenAIText({
        ownerKey: user.ownerKey,
        projectId,
        useCase: "story-write",
        model: openAIModels().story,
        instructions: plannerInstructions(),
        input: [
          {
            role: "user",
            content: [
              `Target duration: ${targetDurationSeconds} seconds`,
              direction ? `Owner direction: ${direction}` : "Develop a practical production plan from the saved Story.",
              "",
              "PERSISTENT STORY CONTEXT:",
              context.context,
              "",
              "RECENT CONVERSATION:",
              ...recentMessages.map(
                (message) => `${message.role.toUpperCase()}: ${message.content}`,
              ),
            ].join("\n"),
          },
        ],
        maxOutputTokens: 12_000,
        timeoutMs: 180_000,
      });
      const parsed = parseStoryProductionPlanResponse(result.text, projectId);
      const record = saveStoryProductionPlan({
        ownerKey: user.ownerKey,
        projectId,
        plan: {
          ...parsed,
          targetDurationSeconds,
          status: "draft",
        },
        sourceRole: "assistant",
      });
      return noStore(
        {
          ok: true,
          record,
          workload: storyProductionWorkload(record.plan),
          usage: result.usage,
          message:
            "Draft production plan created for review. No generation jobs were started.",
        },
        { status: 201 },
      );
    }

    return noStore(
      { ok: false, error: "Unsupported production plan action." },
      { status: 400 },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return noStore(
        {
          ok: false,
          error: "Story Director returned an invalid production plan. Please retry.",
          code: "STORY_PLAN_INVALID_JSON",
        },
        { status: 502 },
      );
    }
    return errorResponse(error, "Production planning failed.");
  }
}
