export const STORY_BIBLE_EXTRACTION_LIMITS = {
  rawText: 200_000,
  entities: 24,
  facts: 48,
  entityRef: 80,
  entityType: 80,
  entityName: 160,
  predicate: 160,
  valueText: 100_000,
  entityId: 240,
} as const;

export type StoryBibleExtractionStatus =
  | "suggestion"
  | "unknown";

export type StoryBibleExtractionEntity = {
  ref: string;
  entityType: string;
  name: string;
};

export type StoryBibleExtractionFact = {
  subjectRef: string | null;
  subjectEntityId: string | null;
  predicate: string;
  valueText: string;
  objectRef: string | null;
  objectEntityId: string | null;
  canonStatus: StoryBibleExtractionStatus;
};

export type StoryBibleExtractionValue = {
  entities: StoryBibleExtractionEntity[];
  facts: StoryBibleExtractionFact[];
  rejectedEntities: number;
  rejectedFacts: number;
};

export type StoryBibleExtractionParseResult =
  | {
      ok: true;
      value: StoryBibleExtractionValue;
    }
  | {
      ok: false;
      error: string;
    };

export type StoryBibleExtractionParseOptions = {
  knownEntityIds?: Iterable<string>;
};

export const STORY_BIBLE_EXTRACTION_SCHEMA_TEXT = `{
  "entities": [
    {
      "ref": "local short reference such as e1",
      "entityType": "character|location|object|power|other",
      "name": "entity name"
    }
  ],
  "facts": [
    {
      "subjectRef": "local entity ref or null",
      "subjectEntityId": "known existing entity id or null",
      "predicate": "short relationship or property",
      "valueText": "literal value or empty string",
      "objectRef": "local entity ref or null",
      "objectEntityId": "known existing entity id or null",
      "canonStatus": "suggestion|unknown"
    }
  ]
}`;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

const STORY_BIBLE_EXTRACTION_ENTITY_TYPES = new Set([
  "character",
  "location",
  "object",
  "power",
  "other",
]);

function extractionEntityType(
  value: unknown,
) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned =
    value
      .trim()
      .toLowerCase();

  if (
    !STORY_BIBLE_EXTRACTION_ENTITY_TYPES.has(
      cleaned,
    )
  ) {
    return null;
  }

  return cleaned;
}

function requiredString(
  value: unknown,
  maxLength: number,
) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();

  if (
    !cleaned ||
    cleaned.length > maxLength
  ) {
    return null;
  }

  return cleaned;
}

function optionalString(
  value: unknown,
  maxLength: number,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return {
      ok: true as const,
      value: "",
    };
  }

  if (typeof value !== "string") {
    return {
      ok: false as const,
      value: "",
    };
  }

  const cleaned = value.trim();

  if (cleaned.length > maxLength) {
    return {
      ok: false as const,
      value: "",
    };
  }

  return {
    ok: true as const,
    value: cleaned,
  };
}

function optionalReference(
  value: unknown,
  maxLength: number,
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return {
      ok: true as const,
      value: null as string | null,
    };
  }

  if (typeof value !== "string") {
    return {
      ok: false as const,
      value: null as string | null,
    };
  }

  const cleaned = value.trim();

  if (
    !cleaned ||
    cleaned.length > maxLength
  ) {
    return {
      ok: false as const,
      value: null as string | null,
    };
  }

  return {
    ok: true as const,
    value: cleaned,
  };
}

function extractionStatus(
  value: unknown,
): StoryBibleExtractionStatus | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned =
    value
      .trim()
      .toLowerCase();

  if (
    cleaned === "suggestion" ||
    cleaned === "unknown"
  ) {
    return cleaned;
  }

  return null;
}

function normalizeExtractionEnvelope(
  input: string,
) {
  let text =
    input
      .replace(/^\uFEFF/, "")
      .trim();

  if (!text) {
    return null;
  }

  const fenced =
    text.match(
      /^```(?:json)?\s*([\s\S]*?)\s*```$/i,
    );

  if (fenced) {
    return fenced[1].trim();
  }

  if (text.includes("```")) {
    return null;
  }

  return text;
}

function buildKnownEntityIdSet(
  values:
    | Iterable<string>
    | undefined,
) {
  const ids = new Set<string>();

  if (!values) {
    return ids;
  }

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const cleaned = value.trim();

    if (
      cleaned &&
      cleaned.length <=
        STORY_BIBLE_EXTRACTION_LIMITS.entityId
    ) {
      ids.add(cleaned);
    }
  }

  return ids;
}

export function parseStoryBibleExtractionText(
  input: unknown,
  options: StoryBibleExtractionParseOptions = {},
): StoryBibleExtractionParseResult {
  if (typeof input !== "string") {
    return {
      ok: false,
      error:
        "Story Bible extraction must be JSON text.",
    };
  }

  if (
    input.length >
    STORY_BIBLE_EXTRACTION_LIMITS.rawText
  ) {
    return {
      ok: false,
      error:
        "Story Bible extraction response is too large.",
    };
  }

  const envelope =
    normalizeExtractionEnvelope(
      input,
    );

  if (!envelope) {
    return {
      ok: false,
      error:
        "Story Bible extraction response is not a clean JSON envelope.",
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(envelope);
  } catch {
    return {
      ok: false,
      error:
        "Story Bible extraction response is not valid JSON.",
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      error:
        "Story Bible extraction response must be a JSON object.",
    };
  }

  if (
    !Array.isArray(parsed.entities) ||
    !Array.isArray(parsed.facts)
  ) {
    return {
      ok: false,
      error:
        "Story Bible extraction response must contain entities and facts arrays.",
    };
  }

  const rawEntityItems =
    parsed.entities as unknown[];

  const rawFactItems =
    parsed.facts as unknown[];

  const knownEntityIds =
    buildKnownEntityIdSet(
      options.knownEntityIds,
    );

  const entities:
    StoryBibleExtractionEntity[] = [];

  const localRefs =
    new Map<string, string>();

  let rejectedEntities =
    Math.max(
      0,
      rawEntityItems.length -
        STORY_BIBLE_EXTRACTION_LIMITS.entities,
    );

  for (
    const item of
    rawEntityItems.slice(
      0,
      STORY_BIBLE_EXTRACTION_LIMITS.entities,
    )
  ) {
    if (!isRecord(item)) {
      rejectedEntities += 1;
      continue;
    }

    const ref =
      requiredString(
        item.ref,
        STORY_BIBLE_EXTRACTION_LIMITS.entityRef,
      );

    const entityType =
      extractionEntityType(
        item.entityType,
      );

    const name =
      requiredString(
        item.name,
        STORY_BIBLE_EXTRACTION_LIMITS.entityName,
      );

    if (
      !ref ||
      !entityType ||
      !name
    ) {
      rejectedEntities += 1;
      continue;
    }

    const key =
      ref.toLowerCase();

    if (localRefs.has(key)) {
      rejectedEntities += 1;
      continue;
    }

    localRefs.set(
      key,
      ref,
    );

    entities.push({
      ref,
      entityType,
      name,
    });
  }

  const facts:
    StoryBibleExtractionFact[] = [];

  let rejectedFacts =
    Math.max(
      0,
      rawFactItems.length -
        STORY_BIBLE_EXTRACTION_LIMITS.facts,
    );

  for (
    const item of
    rawFactItems.slice(
      0,
      STORY_BIBLE_EXTRACTION_LIMITS.facts,
    )
  ) {
    if (!isRecord(item)) {
      rejectedFacts += 1;
      continue;
    }

    const predicate =
      requiredString(
        item.predicate,
        STORY_BIBLE_EXTRACTION_LIMITS.predicate,
      );

    const canonStatus =
      extractionStatus(
        item.canonStatus,
      );

    const valueText =
      optionalString(
        item.valueText,
        STORY_BIBLE_EXTRACTION_LIMITS.valueText,
      );

    const subjectRef =
      optionalReference(
        item.subjectRef,
        STORY_BIBLE_EXTRACTION_LIMITS.entityRef,
      );

    const objectRef =
      optionalReference(
        item.objectRef,
        STORY_BIBLE_EXTRACTION_LIMITS.entityRef,
      );

    const subjectEntityId =
      optionalReference(
        item.subjectEntityId,
        STORY_BIBLE_EXTRACTION_LIMITS.entityId,
      );

    const objectEntityId =
      optionalReference(
        item.objectEntityId,
        STORY_BIBLE_EXTRACTION_LIMITS.entityId,
      );

    if (
      !predicate ||
      !canonStatus ||
      !valueText.ok ||
      !subjectRef.ok ||
      !objectRef.ok ||
      !subjectEntityId.ok ||
      !objectEntityId.ok
    ) {
      rejectedFacts += 1;
      continue;
    }

    if (
      subjectRef.value &&
      subjectEntityId.value
    ) {
      rejectedFacts += 1;
      continue;
    }

    if (
      objectRef.value &&
      objectEntityId.value
    ) {
      rejectedFacts += 1;
      continue;
    }

    let resolvedSubjectRef:
      string | null = null;

    if (subjectRef.value) {
      resolvedSubjectRef =
        localRefs.get(
          subjectRef.value.toLowerCase(),
        ) || null;

      if (!resolvedSubjectRef) {
        rejectedFacts += 1;
        continue;
      }
    }

    let resolvedObjectRef:
      string | null = null;

    if (objectRef.value) {
      resolvedObjectRef =
        localRefs.get(
          objectRef.value.toLowerCase(),
        ) || null;

      if (!resolvedObjectRef) {
        rejectedFacts += 1;
        continue;
      }
    }

    if (
      subjectEntityId.value &&
      !knownEntityIds.has(
        subjectEntityId.value,
      )
    ) {
      rejectedFacts += 1;
      continue;
    }

    if (
      objectEntityId.value &&
      !knownEntityIds.has(
        objectEntityId.value,
      )
    ) {
      rejectedFacts += 1;
      continue;
    }

    if (
      canonStatus === "suggestion" &&
      !valueText.value &&
      !resolvedObjectRef &&
      !objectEntityId.value
    ) {
      rejectedFacts += 1;
      continue;
    }

    facts.push({
      subjectRef:
        resolvedSubjectRef,
      subjectEntityId:
        subjectEntityId.value,
      predicate,
      valueText:
        valueText.value,
      objectRef:
        resolvedObjectRef,
      objectEntityId:
        objectEntityId.value,
      canonStatus,
    });
  }

  return {
    ok: true,
    value: {
      entities,
      facts,
      rejectedEntities,
      rejectedFacts,
    },
  };
}
