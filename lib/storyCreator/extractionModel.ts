import {
  qwenDurableFetch,
} from "@/lib/workers/qwenDurableFetch";

import {
  parseStoryBibleExtractionText,
  STORY_BIBLE_EXTRACTION_SCHEMA_TEXT,
  type StoryBibleExtractionParseResult,
} from "./extraction";

export const STORY_BIBLE_EXTRACTION_MODEL =
  "qwen3.5:4b";

export const STORY_BIBLE_EXTRACTION_NUM_CTX =
  16 * 1024;

export const STORY_BIBLE_EXTRACTION_NUM_PREDICT =
  1200;

export const STORY_BIBLE_EXTRACTION_TIMEOUT_MS =
  60_000;

export const STORY_BIBLE_EXTRACTION_KEEP_ALIVE =
  "30m";

const STORY_BIBLE_EXTRACTION_SOURCE_CHAR_LIMIT =
  24_000;

const STORY_BIBLE_EXTRACTION_KNOWN_ENTITY_LIMIT =
  100;

export type StoryBibleExtractionKnownEntity = {
  id: string;
  entityType: string;
  name: string;
};

export type StoryBibleExtractionModelInput = {
  userMessage: unknown;
  assistantMessage: unknown;
  knownEntities?:
    Iterable<StoryBibleExtractionKnownEntity>;
};

export type StoryBibleExtractionModelDependencies = {
  qwenFetch?: typeof qwenDurableFetch;
};

function cleanSourceText(
  value: unknown,
) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(
      0,
      STORY_BIBLE_EXTRACTION_SOURCE_CHAR_LIMIT,
    );
}

function cleanKnownEntity(
  value: unknown,
): StoryBibleExtractionKnownEntity | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const row =
    value as Record<string, unknown>;

  const id =
    typeof row.id === "string"
      ? row.id.trim()
      : "";

  const entityType =
    typeof row.entityType === "string"
      ? row.entityType
          .trim()
          .toLowerCase()
      : "";

  const name =
    typeof row.name === "string"
      ? row.name.trim()
      : "";

  if (
    !id ||
    !entityType ||
    !name
  ) {
    return null;
  }

  if (
    id.length > 240 ||
    entityType.length > 80 ||
    name.length > 160
  ) {
    return null;
  }

  return {
    id,
    entityType,
    name,
  };
}

function normalizeKnownEntities(
  values:
    | Iterable<StoryBibleExtractionKnownEntity>
    | undefined,
) {
  if (!values) {
    return [];
  }

  const output:
    StoryBibleExtractionKnownEntity[] = [];

  const seen =
    new Set<string>();

  for (const value of values) {
    const cleaned =
      cleanKnownEntity(value);

    if (!cleaned) {
      continue;
    }

    if (
      seen.has(
        cleaned.id,
      )
    ) {
      continue;
    }

    seen.add(
      cleaned.id,
    );

    output.push(
      cleaned,
    );

    if (
      output.length >=
      STORY_BIBLE_EXTRACTION_KNOWN_ENTITY_LIMIT
    ) {
      break;
    }
  }

  return output;
}

export function buildStoryBibleExtractionPrompt(
  input: {
    userMessage: string;
    assistantMessage: string;
    knownEntities:
      StoryBibleExtractionKnownEntity[];
  },
) {
  const knownEntities =
    input.knownEntities.length
      ? JSON.stringify(
          input.knownEntities,
          null,
          2,
        )
      : "[]";

  return [
    "You are a structured Story Bible memory extractor.",
    "",
    "Analyze ONLY the supplied latest Story Director turn.",
    "Do not invent story details.",
    "Do not promote anything to Canon.",
    "canonStatus may ONLY be suggestion or unknown.",
    "",
    "Extract durable story information such as:",
    "- characters",
    "- locations",
    "- important objects",
    "- powers or abilities",
    "- relationships",
    "- goals or conflicts",
    "- story rules",
    "- timeline or current-situation facts",
    "",
    "Entity type MUST be exactly one of:",
    "character, location, object, power, other.",
    "",
    "If a fact is explicitly stated but not user-confirmed Canon,",
    "use suggestion.",
    "",
    "If the turn explicitly identifies a meaningful missing or",
    "uncertain detail, use unknown.",
    "",
    "Do not create unknown entries merely because information",
    "was not mentioned.",
    "",
    "EXISTING ENTITY RULES:",
    "You may use subjectEntityId/objectEntityId ONLY when the ID",
    "appears in the Existing Story Bible Entities list below.",
    "If an existing entity clearly matches, reference that ID",
    "instead of creating the same entity again.",
    "",
    "For newly discovered entities, add them to entities[] and",
    "assign a short local ref such as e1, e2, e3.",
    "",
    "Facts may reference a new entity by subjectRef/objectRef OR",
    "an existing entity by subjectEntityId/objectEntityId, but",
    "never both on the same side.",
    "",
    "If there is no durable Story Bible information in this turn,",
    'return exactly {"entities":[],"facts":[]}.',
    "",
    "Return ONLY valid JSON.",
    "Do not include explanation or prose.",
    "Do not wrap the JSON in commentary.",
    "",
    "Required JSON shape:",
    STORY_BIBLE_EXTRACTION_SCHEMA_TEXT,
    "",
    "Existing Story Bible Entities:",
    knownEntities,
    "",
    "LATEST USER MESSAGE:",
    input.userMessage,
    "",
    "LATEST STORY DIRECTOR RESPONSE:",
    input.assistantMessage,
  ].join("\n");
}

function readGenerateResponseText(
  value: unknown,
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return "";
  }

  const response =
    (
      value as Record<string, unknown>
    ).response;

  return typeof response === "string"
    ? response.trim()
    : "";
}

export async function runStoryBibleExtractionModel(
  input:
    StoryBibleExtractionModelInput,

  dependencies:
    StoryBibleExtractionModelDependencies = {},
): Promise<StoryBibleExtractionParseResult> {
  const userMessage =
    cleanSourceText(
      input.userMessage,
    );

  const assistantMessage =
    cleanSourceText(
      input.assistantMessage,
    );

  if (
    !userMessage ||
    !assistantMessage
  ) {
    return {
      ok: false,
      error:
        "Story Bible extraction requires both user and assistant message text.",
    };
  }

  const knownEntities =
    normalizeKnownEntities(
      input.knownEntities,
    );

  const prompt =
    buildStoryBibleExtractionPrompt({
      userMessage,
      assistantMessage,
      knownEntities,
    });

  const qwenFetch =
    dependencies.qwenFetch
    || qwenDurableFetch;

  let response: Response;

  try {
    response =
      await qwenFetch(
        "/api/generate",

        {
          model:
            STORY_BIBLE_EXTRACTION_MODEL,

          stream: false,

          prompt,

          think: false,

          options: {
            temperature: 0.0,

            num_ctx:
              STORY_BIBLE_EXTRACTION_NUM_CTX,

            num_predict:
              STORY_BIBLE_EXTRACTION_NUM_PREDICT,
          },
        },

        {
          requiredContextTokens:
            STORY_BIBLE_EXTRACTION_NUM_CTX,

          timeoutMs:
            STORY_BIBLE_EXTRACTION_TIMEOUT_MS,

          allowedNodes:
            [
              "shawn",
              "slr",
            ],

          model:
            STORY_BIBLE_EXTRACTION_MODEL,

          keepAlive:
            STORY_BIBLE_EXTRACTION_KEEP_ALIVE,

          requestKind:
            "story-bible-extraction",
        },
      );
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Story Bible extraction model failed: ${error.message}`
          : "Story Bible extraction model failed.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error:
        `Story Bible extraction model returned HTTP ${response.status}.`,
    };
  }

  let responseData: unknown;

  try {
    responseData =
      await response.json();
  } catch {
    return {
      ok: false,
      error:
        "Story Bible extraction model returned invalid response JSON.",
    };
  }

  const modelText =
    readGenerateResponseText(
      responseData,
    );

  if (!modelText) {
    return {
      ok: false,
      error:
        "Story Bible extraction model returned no extraction text.",
    };
  }

  return parseStoryBibleExtractionText(
    modelText,
    {
      knownEntityIds:
        knownEntities.map(
          (entity) =>
            entity.id,
        ),
    },
  );
}
