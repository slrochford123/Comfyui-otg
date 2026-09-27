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
  listStoryBibleEntities,
  listStoryBibleFacts,
  listStoryCreatorMessages,
} from "../../../../lib/storyCreator/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

type StoryWritingMode =
  | "outline"
  | "chapter"
  | "episode"
  | "scene"
  | "dialogue";

const WRITING_MODES = new Set<StoryWritingMode>([
  "outline",
  "chapter",
  "episode",
  "scene",
  "dialogue",
]);

function jsonError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Story writing request failed.";

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

function cleanMode(value: unknown): StoryWritingMode {
  const mode = String(value || "scene").trim();

  if (WRITING_MODES.has(mode as StoryWritingMode)) {
    return mode as StoryWritingMode;
  }

  return "scene";
}

function cleanInstruction(value: unknown) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, 20_000);
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
      return message.content.trim();
    }
  }

  if (
    data &&
    typeof data === "object" &&
    typeof (data as any).response === "string"
  ) {
    return (data as any).response.trim();
  }

  return "";
}

function modeLabel(mode: StoryWritingMode) {
  if (mode === "outline") return "story outline";
  if (mode === "chapter") return "chapter";
  if (mode === "episode") return "episode";
  if (mode === "dialogue") return "dialogue";
  return "scene";
}

function buildCanonLines(input: {
  entities: ReturnType<typeof listStoryBibleEntities>;
  facts: ReturnType<typeof listStoryBibleFacts>;
}) {
  const entityNames = new Map(
    input.entities.map((entity) => [
      entity.id,
      entity.name,
    ]),
  );

  return input.facts
    .filter((fact) => fact.canonStatus === "canon")
    .map((fact) => {
      const subject = fact.subjectEntityId
        ? entityNames.get(fact.subjectEntityId) ||
          "Unknown entity"
        : "Story";
      const object = fact.objectEntityId
        ? entityNames.get(fact.objectEntityId) ||
          "Unknown entity"
        : "";

      return `${subject} ${fact.predicate}${
        object
          ? ` ${object}`
          : fact.valueText
            ? `: ${fact.valueText}`
            : ""
      }`;
    });
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
    const mode = cleanMode(body?.mode);
    const instruction = cleanInstruction(
      body?.instruction,
    );

    const entities =
      listStoryBibleEntities({
        ownerKey: user.ownerKey,
        projectId,
      });

    const facts =
      listStoryBibleFacts({
        ownerKey: user.ownerKey,
        projectId,
      });

    const canonLines = buildCanonLines({
      entities,
      facts,
    });

    if (!canonLines.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Approve at least one Story Bible canon fact before writing.",
          code: "STORY_WRITE_CANON_REQUIRED",
        },
        {
          status: 409,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const recentMessages =
      listStoryCreatorMessages({
        ownerKey: user.ownerKey,
        projectId,
      }).slice(-12);

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
              content: [
                "You are Story Creator V2 Write mode.",
                "Write only from approved canon supplied by the app.",
                "Do not use suggestions, unknowns, or invented facts as if they are canon.",
                "If information is missing, leave it unspecified or ask a brief missing-info question after the draft.",
                "Do not mention model names or internal routing.",
              ].join(" "),
            },
            {
              role: "user",
              content: [
                `Writing mode: ${modeLabel(mode)}.`,
                instruction
                  ? `User instruction: ${instruction}`
                  : "User instruction: continue from approved canon.",
                "",
                "Approved canon:",
                ...canonLines.map((line) => `- ${line}`),
                "",
                "Recent Story Director context:",
                ...recentMessages.map(
                  (message) =>
                    `${message.role.toUpperCase()}: ${message.content}`,
                ),
              ].join("\n"),
            },
          ],
          options: {
            temperature: 0.55,
            top_p: 0.9,
            repeat_penalty: 1.06,
            num_predict: 1600,
          },
        },
        {
          timeoutMs: 120_000,
          ownerKey: user.ownerKey,
          requestKind: "story-creator-write",
        },
      );

    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) : null;
    const draft = readMessageContent(payload);

    if (!response.ok || !draft) {
      throw new Error(
        String(
          (payload && (payload as any).error) ||
            raw ||
            "Story writing did not return a draft.",
        ),
      );
    }

    return NextResponse.json(
      {
        ok: true,
        mode,
        draft,
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
