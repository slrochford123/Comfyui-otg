import {
  listStoryAssets,
  listStoryBibleEntities,
  listStoryBibleFacts,
  type StoryAsset,
  type StoryBibleEntity,
  type StoryBibleFact,
  type StoryAssetType,
} from "./store";

export type StoryDesignContext = {
  projectId: string;
  entity: StoryBibleEntity;
  entityKind: "character" | "location" | "object";
  authoritativeFacts: StoryBibleFact[];
  relatedEntities: StoryBibleEntity[];
  relatedFacts: StoryBibleFact[];
  readyAssets: StoryAsset[];
  unapprovedHints: StoryBibleFact[];
  userInstruction: string;
  temporaryOverride: boolean;
  knowledgeSummary: string[];
  prompt: string;
  provenance: {
    selectedEntityId: string;
    factIdsUsed: string[];
    relatedEntityIdsUsed: string[];
    readyAssetIdsUsed: string[];
    assembledPrompt: string;
    userDesignInstruction: string;
    generatedAt: string;
    referencesMode: "prompt-context-only";
  };
};

const VISUAL_PREDICATE_RE =
  /(appear|age|species|gender|height|build|hair|eye|skin|cloth|wear|armor|armour|weapon|sword|item|object|power|magic|role|occupation|captain|faction|station|live|work|home|location|environment|fortress|city|room|landscape|weather|color|colour|scar|mark|symbol|uniform|gear|asset|prop|material|shape|size|condition|damage)/i;

const RELATION_PREDICATE_RE =
  /(station|live|work|home|located|location|from|in|at|carries|carry|has|owns|uses|wears|member|captain|serves|guards|protects|rules|leads|relationship|ally|enemy|parent|child|sibling|mentor)/i;

function cleanText(value: unknown, max = 900) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function entityKind(value: string): StoryDesignContext["entityKind"] | null {
  const raw = value.toLowerCase();
  if (raw.includes("character") || raw.includes("person")) return "character";
  if (
    raw.includes("location") ||
    raw.includes("environment") ||
    raw.includes("place") ||
    raw.includes("setting")
  ) {
    return "location";
  }
  if (
    raw.includes("object") ||
    raw.includes("item") ||
    raw.includes("asset") ||
    raw.includes("prop") ||
    raw.includes("weapon")
  ) {
    return "object";
  }
  return null;
}

function factText(
  fact: StoryBibleFact,
  entitiesById: Map<string, StoryBibleEntity>,
) {
  const subject = fact.subjectEntityId
    ? entitiesById.get(fact.subjectEntityId)?.name
    : "";
  const object = fact.objectEntityId
    ? entitiesById.get(fact.objectEntityId)?.name
    : "";
  const value = cleanText(fact.valueText);
  const predicate = cleanText(fact.predicate, 120).replace(/_/g, " ");
  const tail = value || object;
  if (subject && tail) return `${subject} ${predicate}: ${tail}`;
  if (tail) return `${predicate}: ${tail}`;
  return predicate;
}

function isVisualFact(fact: StoryBibleFact) {
  return (
    VISUAL_PREDICATE_RE.test(fact.predicate) ||
    VISUAL_PREDICATE_RE.test(fact.valueText)
  );
}

function isRelationFact(fact: StoryBibleFact) {
  return Boolean(fact.objectEntityId) && RELATION_PREDICATE_RE.test(fact.predicate);
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function matchingReadyAssets(args: {
  assets: StoryAsset[];
  entity: StoryBibleEntity;
  kind: StoryDesignContext["entityKind"];
}) {
  const entityName = args.entity.name.toLowerCase();
  const allowedTypes = new Set<StoryAssetType>([
    args.kind === "character"
      ? "character"
      : args.kind === "location"
        ? "location"
        : "object",
    "reference",
    "character_card",
  ]);

  return args.assets
    .filter((asset) => asset.status === "ready")
    .filter((asset) => allowedTypes.has(asset.assetType as StoryAssetType))
    .filter((asset) => {
      const metadata = asset.metadata || {};
      return (
        metadata.selectedEntityId === args.entity.id ||
        metadata.storyDesignContextProvenance &&
          typeof metadata.storyDesignContextProvenance === "object" &&
          (metadata.storyDesignContextProvenance as any).selectedEntityId === args.entity.id ||
        asset.name.toLowerCase().includes(entityName)
      );
    })
    .slice(0, 4);
}

function buildKnowledgeSummary(args: {
  entity: StoryBibleEntity;
  entitiesById: Map<string, StoryBibleEntity>;
  authoritativeFacts: StoryBibleFact[];
  relatedFacts: StoryBibleFact[];
  readyAssets: StoryAsset[];
}) {
  const lines = [
    ...args.authoritativeFacts,
    ...args.relatedFacts,
  ]
    .map((fact) => factText(fact, args.entitiesById))
    .filter(Boolean)
    .slice(0, 12);

  if (args.readyAssets.length) {
    lines.push(
      `Existing ready assets: ${args.readyAssets
        .map((asset) => asset.name)
        .join(", ")}`,
    );
  }

  return uniqueById(
    lines.map((line, index) => ({
      id: `${index}:${line}`,
      value: line,
    })),
  ).map((item) => item.value);
}

function buildVisualPrompt(args: {
  entity: StoryBibleEntity;
  kind: StoryDesignContext["entityKind"];
  entitiesById: Map<string, StoryBibleEntity>;
  authoritativeFacts: StoryBibleFact[];
  relatedFacts: StoryBibleFact[];
  readyAssets: StoryAsset[];
  userInstruction: string;
}) {
  const noun =
    args.kind === "character"
      ? "character design"
      : args.kind === "location"
        ? "environment concept design"
        : "object design";
  const canonLines = args.authoritativeFacts
    .map((fact) => factText(fact, args.entitiesById))
    .filter(Boolean)
    .slice(0, 14);
  const relatedLines = args.relatedFacts
    .map((fact) => factText(fact, args.entitiesById))
    .filter(Boolean)
    .slice(0, 8);
  const assetLines = args.readyAssets
    .map((asset) =>
      cleanText(
        [asset.name, asset.prompt, cleanText((asset.metadata || {}).designDescription)]
          .filter(Boolean)
          .join(": "),
        420,
      ),
    )
    .filter(Boolean);

  return [
    `Create a polished ${noun} for ${args.entity.name}.`,
    canonLines.length
      ? `Approved story canon: ${canonLines.join("; ")}.`
      : "Approved story canon gives only limited visual detail; keep any extra styling as non-canon interpretation.",
    relatedLines.length
      ? `Related story context: ${relatedLines.join("; ")}.`
      : "",
    assetLines.length
      ? `Existing ready design references, prompt context only: ${assetLines.join("; ")}.`
      : "",
    args.userInstruction
      ? `Current user design direction, temporary for this generation only: ${args.userInstruction}.`
      : "",
    "Use creative visual fill only where story canon is unspecified. Do not add text, labels, watermarks, UI, or comic panels.",
    "Cinematic story concept art, production reference, clear readable silhouette, coherent materials, consistent lighting.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function assembleStoryDesignContext(input: {
  ownerKey: unknown;
  projectId: unknown;
  entityId: unknown;
  userInstruction?: unknown;
}): StoryDesignContext {
  const projectId = cleanText(input.projectId, 200);
  const entityId = cleanText(input.entityId, 200);
  const userInstruction = cleanText(input.userInstruction, 1400);
  const entities = listStoryBibleEntities({
    ownerKey: input.ownerKey,
    projectId,
  });
  const entity = entities.find((item) => item.id === entityId);
  if (!entity) {
    throw Object.assign(
      new Error("Story design entity was not found in this Story."),
      { code: "STORY_DESIGN_ENTITY_NOT_FOUND" },
    );
  }

  const kind = entityKind(entity.entityType);
  if (!kind) {
    throw Object.assign(
      new Error("Story design currently supports character, location, and object entities."),
      { code: "STORY_DESIGN_ENTITY_TYPE_UNSUPPORTED" },
    );
  }

  const entitiesById = new Map(entities.map((item) => [item.id, item]));
  const facts = listStoryBibleFacts({
    ownerKey: input.ownerKey,
    projectId,
    includeSuperseded: false,
  });
  const approvedFacts = facts.filter((fact) => fact.canonStatus === "canon");
  const entityFacts = approvedFacts.filter(
    (fact) =>
      fact.subjectEntityId === entity.id ||
      fact.objectEntityId === entity.id,
  );
  const authoritativeFacts = entityFacts.filter(isVisualFact);
  const relatedEntityIds = uniqueById(
    entityFacts
      .filter(isRelationFact)
      .map((fact) =>
        fact.subjectEntityId === entity.id
          ? fact.objectEntityId || ""
          : fact.subjectEntityId || "",
      )
      .filter(Boolean)
      .map((id) => entitiesById.get(id))
      .filter((item): item is StoryBibleEntity => Boolean(item)),
  )
    .slice(0, 4)
    .map((item) => item.id);
  const relatedEntities = relatedEntityIds
    .map((id) => entitiesById.get(id))
    .filter((item): item is StoryBibleEntity => Boolean(item));
  const relatedFacts = approvedFacts
    .filter((fact) => {
      const subjectMatch = fact.subjectEntityId
        ? relatedEntityIds.includes(fact.subjectEntityId)
        : false;
      const objectMatch = fact.objectEntityId
        ? relatedEntityIds.includes(fact.objectEntityId)
        : false;
      return (subjectMatch || objectMatch) && isVisualFact(fact);
    })
    .slice(0, 12);
  const assets = listStoryAssets({
    ownerKey: input.ownerKey,
    projectId,
  });
  const readyAssets = matchingReadyAssets({
    assets,
    entity,
    kind,
  });
  const unapprovedHints = facts
    .filter((fact) => fact.canonStatus !== "canon")
    .filter(
      (fact) =>
        fact.subjectEntityId === entity.id ||
        fact.objectEntityId === entity.id,
    )
    .filter(isVisualFact)
    .slice(0, 8);
  const prompt = buildVisualPrompt({
    entity,
    kind,
    entitiesById,
    authoritativeFacts,
    relatedFacts,
    readyAssets,
    userInstruction,
  });
  const knowledgeSummary = buildKnowledgeSummary({
    entity,
    entitiesById,
    authoritativeFacts,
    relatedFacts,
    readyAssets,
  });

  return {
    projectId,
    entity,
    entityKind: kind,
    authoritativeFacts,
    relatedEntities,
    relatedFacts,
    readyAssets,
    unapprovedHints,
    userInstruction,
    temporaryOverride: Boolean(userInstruction),
    knowledgeSummary,
    prompt,
    provenance: {
      selectedEntityId: entity.id,
      factIdsUsed: uniqueById([...authoritativeFacts, ...relatedFacts]).map(
        (fact) => fact.id,
      ),
      relatedEntityIdsUsed: relatedEntities.map((item) => item.id),
      readyAssetIdsUsed: readyAssets.map((asset) => asset.id),
      assembledPrompt: prompt,
      userDesignInstruction: userInstruction,
      generatedAt: new Date().toISOString(),
      referencesMode: "prompt-context-only",
    },
  };
}
