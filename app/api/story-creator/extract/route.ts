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
  QWEN_CLUSTER_MODEL,
} from "@/lib/workers/qwenClusterRouter";

import {
  qwenDurableFetch,
} from "@/lib/workers/qwenDurableFetch";

import {
  applyStoryExtraction,
  getStoryCreatorMessage,
  listStoryBibleEntities,
  listStoryCreatorMessages,
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

function readMessageContent(data: unknown) {
  if (
    data &&
    typeof data === "object" &&
    "message" in data
  ) {
    const message = (data as any).message;

    if (
      message &&
      typeof message === "object" &&
      typeof message.content === "string"
    ) {
      return message.content;
    }
  }

  if (
    data &&
    typeof data === "object" &&
    typeof (data as any).response === "string"
  ) {
    return (data as any).response;
  }

  return "";
}

function extractionSystemPrompt() {
  return [
    "You are the Story Creator V2 extractor.",
    "Read the primary source Story Director message and return JSON only.",
    "Use supporting context only to understand names and references in the primary source message.",
    "Extract only story information that is present in the primary source message.",
    "Do not invent canon. Do not approve canon.",
    "Even if the source message was written by the user, extracted facts are still suggestions or unknowns.",
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
    "PRIMARY SOURCE MESSAGE:",
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
    const sourceMessageId = String(
      body?.sourceMessageId || "",
    ).trim();

    if (!sourceMessageId) {
      throw requestError(
        "STORY_EXTRACT_SOURCE_MESSAGE_REQUIRED",
        "Story extraction requires a stored source message.",
      );
    }

    const sourceMessage =
      getStoryCreatorMessage({
        ownerKey: user.ownerKey,
        projectId,
        messageId: sourceMessageId,
      });

    const messages =
      listStoryCreatorMessages({
        ownerKey: user.ownerKey,
        projectId,
      });

    const recentMessages = messages.slice(-48);
    const contextMessages = recentMessages.some(
      (message) => message.id === sourceMessage.id,
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

    const response =
      await qwenDurableFetch(
        "/api/chat",
        {
          model: QWEN_CLUSTER_MODEL,
          stream: false,
          think: false,
          messages: [
            {
              role: "system",
              content: extractionSystemPrompt(),
            },
            {
              role: "user",
              content: buildExtractionUserPrompt({
                sourceMessage,
                contextMessages,
                entityNames:
                  existingEntities.map(
                    (entity) => entity.name,
                  ),
              }),
            },
          ],
          options: {
            temperature: 0.1,
            top_p: 0.85,
            repeat_penalty: 1.05,
            num_predict: 1400,
          },
        },
        {
          timeoutMs: 120_000,
          ownerKey: user.ownerKey,
          requestKind: "story-creator-extract",
        },
      );

    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) : null;
    const text = readMessageContent(payload);

    if (!response.ok || !text.trim()) {
      throw new Error(
        String(
          (payload && (payload as any).error) ||
            raw ||
            "Story extractor did not return content.",
        ),
      );
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
      });

    return NextResponse.json(
      {
        ok: true,
        ...result,
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
