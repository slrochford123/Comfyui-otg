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

import { createOpenAIText, openAIEnabled, openAIModels } from "@/lib/openai/provider";

import {
  applyStoryExtraction,
  listUnreviewedStoryMessages,
  listStoryBibleEntities,
  listStoryCreatorMessages,
  recordStoryMemoryReview,
} from "../../../../lib/storyCreator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

type ExtractedEntity = {
  entityType?: unknown;
  name?: unknown;
};

type ExtractedFact = {
  subjectName?: unknown;
  predicate?: unknown;
  valueText?: unknown;
  canonStatus?: unknown;
};

type ExtractedOpenQuestion = {
  question?: unknown;
};

function jsonError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Story extraction failed.";

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
        : code === "STORY_MESSAGE_NOT_FOUND"
          ? 404
          : code === "STORY_EXTRACT_SOURCE_MESSAGE_REQUIRED"
            ? 400
            : code === "AI_PAYMENT_AUTHORIZATION_REQUIRED"
              ? 402
            : code === "qwen_context_unsupported"
              ? 400
              : code === "qwen_cluster_busy"
                ? 503
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

function requirePaidExtractionAuthorization(value: unknown) {
  const authorization =
    value && typeof value === "object"
      ? value as Record<string, unknown>
      : {};
  const maxOutputTokens = Number(authorization.maxOutputTokens);

  if (
    authorization.approved !== true ||
    authorization.operation !== "story-memory-extraction" ||
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 1 ||
    maxOutputTokens > 1000
  ) {
    throw requestError(
      "AI_PAYMENT_AUTHORIZATION_REQUIRED",
      "Story Memory extraction requires explicit paid-operation authorization.",
    );
  }

  return { maxOutputTokens };
}

function cleanLabel(value: unknown, limit: number) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, limit);
}

function cleanJsonText(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/g, "")
    .trim();
}

function parseExtractionJson(value: string) {
  const cleaned = cleanJsonText(value);

  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");

    if (first >= 0 && last > first) {
      return JSON.parse(cleaned.slice(first, last + 1));
    }

    throw new Error(
      "Story extractor did not return valid JSON.",
    );
  }
}

function extractionSystemPrompt() {
  return [
    "You are the Story Creator V2 extractor.",
    "Read the unreviewed user messages and return JSON only.",
    "Use supporting context only to understand names and references in those user messages.",
    "Extract only story information established by the user in the unreviewed messages.",
    "Do not invent canon. Do not approve canon.",
    "The server will reconcile ordinary details with established canon after extraction.",
    "Use canonStatus suggestion for candidate facts and unknown for missing information.",
    "Put direct story gaps into openQuestions as questions for the user.",
    "Keep predicates short snake_case, such as role, location, power, rule, tone, timeline_event, relationship, motivation.",
    "Return this exact JSON shape:",
    "{\"entities\":[{\"entityType\":\"character|location|faction|rule|tone|timeline|object|other\",\"name\":\"...\"}],\"facts\":[{\"subjectName\":\"...\",\"predicate\":\"...\",\"valueText\":\"...\",\"canonStatus\":\"suggestion|unknown\"}],\"openQuestions\":[{\"question\":\"...\"}]}",
  ].join(" ");
}

function buildExtractionUserPrompt(input: {
  sourceMessage: {
    role: string;
    content: string;
  };
  contextMessages: {
    role: string;
    content: string;
  }[];
  entityNames: string[];
}) {
  return [
    "Existing Story Bible entity names:",
    input.entityNames.length
      ? input.entityNames.join(", ")
      : "(none yet)",
    "",
    "UNREVIEWED USER MESSAGES:",
    `${input.sourceMessage.role.toUpperCase()}: ${input.sourceMessage.content}`,
    "",
    "Supporting recent Story Director context:",
    ...input.contextMessages.map(
      (message) =>
        `${message.role.toUpperCase()}: ${message.content}`,
    ),
  ].join("\n");
}

function normalizeExtractionPayload(value: {
  entities?: ExtractedEntity[];
  facts?: ExtractedFact[];
  openQuestions?: ExtractedOpenQuestion[];
}) {
  return {
    entities: Array.isArray(value.entities)
      ? value.entities
          .slice(0, 30)
          .map((entity) => ({
            entityType:
              cleanLabel(entity.entityType, 80) || "other",
            name: cleanLabel(entity.name, 160),
          }))
          .filter((entity) => entity.name)
      : [],
    facts: Array.isArray(value.facts)
      ? value.facts.slice(0, 60).map((fact) => ({
          subjectName: cleanLabel(fact.subjectName, 160),
          predicate: cleanLabel(fact.predicate, 160),
          valueText: String(fact.valueText || "")
            .replace(/\r\n/g, "\n")
            .trim()
            .slice(0, 100_000),
          canonStatus:
            fact.canonStatus === "unknown"
              ? "unknown"
              : "suggestion",
        }))
      : [],
    openQuestions: Array.isArray(value.openQuestions)
      ? value.openQuestions
          .slice(0, 30)
          .map((item) => ({
            question: String(item.question || "")
              .replace(/\r\n/g, "\n")
              .trim()
              .slice(0, 2000),
          }))
          .filter((item) => item.question)
      : [],
  };
}

export async function POST(request: NextRequest) {
  try {
    const user =
      await requireSessionUser(request);

    const body =
      await request
        .json()
        .catch(() => ({}));

    const projectId = String(
      body?.projectId || "",
    ).trim();
    const paidAuthorization =
      requirePaidExtractionAuthorization(
        body?.paidOperationAuthorization,
      );

    const unreviewedMessages = listUnreviewedStoryMessages({
      ownerKey: user.ownerKey,
      projectId,
    });
    if (!unreviewedMessages.length) {
      return NextResponse.json({
        ok: true,
        alreadyCurrent: true,
        factsCreated: 0,
        factsReused: 0,
        factsAutoSaved: 0,
        conflictsCreated: 0,
        conflictsExisting: 0,
        message: "Story details are already up to date.",
      }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const reviewMessages = unreviewedMessages.slice(0, 48);
    const throughMessage = reviewMessages[reviewMessages.length - 1];
    const sourceMessageId = throughMessage.id;
    const sourceMessage = {
      role: "user",
      content: reviewMessages
        .map((message) => message.content)
        .join("\n\n"),
    };

    const messages =
      listStoryCreatorMessages({
        ownerKey: user.ownerKey,
        projectId,
      });

    const recentMessages = messages.slice(-48);
    const contextMessages = recentMessages.some(
      (message) => message.id === sourceMessageId,
    )
      ? recentMessages
      : [
          ...recentMessages.slice(-47),
          sourceMessage,
        ];

    const existingEntities =
      listStoryBibleEntities({
        ownerKey: user.ownerKey,
        projectId,
      });


    if (!openAIEnabled()) {
      throw new Error("OpenAI Story extraction is unavailable.");
    }

    const aiResult = await createOpenAIText({
      ownerKey: user.ownerKey,
      projectId,
      useCase: "story-helper",
      model: openAIModels().story,
      instructions: extractionSystemPrompt(),
      input: buildExtractionUserPrompt({
        sourceMessage,
        contextMessages,
        entityNames: existingEntities.map(
          (entity) => entity.name,
        ),
      }),
      maxOutputTokens: paidAuthorization.maxOutputTokens,
      timeoutMs: 120000,
    });

    const text = aiResult.text;

    if (!text?.trim()) {
      throw new Error("OpenAI Story extraction returned no content.");
    }

    const extracted =
      parseExtractionJson(text) as {
        entities?: ExtractedEntity[];
        facts?: ExtractedFact[];
        openQuestions?: ExtractedOpenQuestion[];
      };

    const normalized =
      normalizeExtractionPayload(extracted);

    const result =
      applyStoryExtraction({
        ownerKey: user.ownerKey,
        projectId,
        sourceMessageId,
        entities: normalized.entities,
        facts: normalized.facts,
        openQuestions: normalized.openQuestions,
        autoCanonizeNonconflicting: true,
      });

    const factsSaved = Number(result.factsAutoSaved || 0);
    const conflictsFound = Number(result.conflictsCreated || 0) +
      Number(result.conflictsExisting || 0);
    const messagesRemaining = Math.max(0, unreviewedMessages.length - reviewMessages.length);
    recordStoryMemoryReview({
      ownerKey: user.ownerKey,
      projectId,
      throughMessageId: sourceMessageId,
      messageIds: reviewMessages.map((message) => message.id),
      factsSaved,
      conflictsFound,
    });

    return NextResponse.json(
      {
        ok: true,
        ...result,
        messagesReviewed: reviewMessages.length,
        messagesRemaining,
        message: messagesRemaining
          ? `Story details updated. ${factsSaved} details saved. ${conflictsFound} conflicts need your attention. ${messagesRemaining} older messages remain for another authorized review.`
          : conflictsFound
          ? `Story details updated. ${factsSaved} details saved. ${conflictsFound} conflicts need your attention.`
          : `Story details updated. ${factsSaved} details saved.`,
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
