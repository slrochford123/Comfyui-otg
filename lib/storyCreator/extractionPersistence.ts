import {
  runStoryBibleExtractionModel,
} from "./extractionModel";

import {
  listStoryBibleEntities,
  proposeStoryBibleEntity,
  proposeStoryBibleFact,
} from "./store";

export const STORY_BIBLE_EXTRACTION_PERSISTENCE_V1 =
  true;

type KnownStoryBibleEntity = ReturnType<
  typeof listStoryBibleEntities
>[number];

export type StoryBibleExtractionPersistenceInput = {
  ownerKey: string;
  projectId: string;
  userMessage: {
    content: string;
  };
  assistantMessage: {
    id: string;
    content: string;
  };
};

export type StoryBibleExtractionPersistenceDependencies = {
  runModel?: typeof runStoryBibleExtractionModel;
  listEntities?: typeof listStoryBibleEntities;
  proposeEntity?: typeof proposeStoryBibleEntity;
  proposeFact?: typeof proposeStoryBibleFact;
};

export type StoryBibleExtractionPersistenceResult =
  | {
      status: "empty";
      rejectedEntities: number;
      rejectedFacts: number;
    }
  | {
      status: "applied";
      proposedEntities: number;
      reusedExistingEntities: number;
      ambiguousEntities: number;
      persistedFacts: number;
      skippedFacts: number;
      rejectedEntities: number;
      rejectedFacts: number;
    }
  | {
      status: "failed";
      error: string;
    };

function normalizedEntityIdentity(
  entityType: string,
  name: string,
) {
  return [
    entityType
      .trim()
      .toLowerCase(),
    name
      .trim()
      .toLowerCase(),
  ].join("\u0000");
}

function errorMessage(
  error: unknown,
) {
  return error instanceof Error &&
    error.message.trim()
    ? error.message.trim()
    : "Story Bible extraction failed.";
}

export async function extractAndPersistStoryBibleProposals(
  input: StoryBibleExtractionPersistenceInput,
  dependencies:
    StoryBibleExtractionPersistenceDependencies = {},
): Promise<StoryBibleExtractionPersistenceResult> {
  const runModel =
    dependencies.runModel ??
    runStoryBibleExtractionModel;

  const listEntities =
    dependencies.listEntities ??
    listStoryBibleEntities;

  const proposeEntity =
    dependencies.proposeEntity ??
    proposeStoryBibleEntity;

  const proposeFact =
    dependencies.proposeFact ??
    proposeStoryBibleFact;

  let knownEntities:
    KnownStoryBibleEntity[];

  try {
    knownEntities =
      listEntities({
        ownerKey:
          input.ownerKey,
        projectId:
          input.projectId,
      });
  } catch (error) {
    return {
      status: "failed",
      error:
        errorMessage(error),
    };
  }

  let extraction:
    Awaited<
      ReturnType<
        typeof runStoryBibleExtractionModel
      >
    >;

  try {
    extraction =
      await runModel({
        userMessage:
          input.userMessage.content,
        assistantMessage:
          input.assistantMessage.content,
        knownEntities:
          knownEntities.map(
            (entity) => ({
              id:
                entity.id,
              entityType:
                entity.entityType,
              name:
                entity.name,
            }),
          ),
      });
  } catch (error) {
    return {
      status: "failed",
      error:
        errorMessage(error),
    };
  }

  if (!extraction.ok) {
    return {
      status: "failed",
      error:
        extraction.error,
    };
  }

  if (
    extraction.value.entities.length === 0 &&
    extraction.value.facts.length === 0
  ) {
    return {
      status: "empty",
      rejectedEntities:
        extraction.value.rejectedEntities,
      rejectedFacts:
        extraction.value.rejectedFacts,
    };
  }

  const resolutionEntities = [
    ...knownEntities,
  ];

  const localEntityIds =
    new Map<string, string>();

  let proposedEntities = 0;
  let reusedExistingEntities = 0;
  let ambiguousEntities = 0;

  for (
    const entity of
    extraction.value.entities
  ) {
    const identity =
      normalizedEntityIdentity(
        entity.entityType,
        entity.name,
      );

    const matches =
      resolutionEntities.filter(
        (candidate) =>
          normalizedEntityIdentity(
            candidate.entityType,
            candidate.name,
          ) === identity,
      );

    if (matches.length === 1) {
      localEntityIds.set(
        entity.ref.toLowerCase(),
        matches[0].id,
      );

      reusedExistingEntities += 1;
      continue;
    }

    if (matches.length > 1) {
      ambiguousEntities += 1;
      continue;
    }

    let proposed:
      ReturnType<
        typeof proposeStoryBibleEntity
      >;

    try {
      proposed =
        proposeEntity({
          ownerKey:
            input.ownerKey,
          projectId:
            input.projectId,
          entityType:
            entity.entityType,
          name:
            entity.name,
          sourceRole:
            "assistant",
          sourceMessageId:
            input.assistantMessage.id,
        });
    } catch (error) {
      return {
        status: "failed",
        error:
          errorMessage(error),
      };
    }

    localEntityIds.set(
      entity.ref.toLowerCase(),
      proposed.id,
    );

    resolutionEntities.push(
      proposed,
    );

    proposedEntities += 1;
  }

  let persistedFacts = 0;
  let skippedFacts = 0;

  for (
    const fact of
    extraction.value.facts
  ) {
    /*
     * Defense in depth:
     * parser blocks Canon, and proposal store blocks Canon.
     */
    if (
      fact.canonStatus !==
        "suggestion" &&
      fact.canonStatus !==
        "unknown"
    ) {
      skippedFacts += 1;
      continue;
    }

    let subjectEntityId =
      fact.subjectEntityId;

    if (fact.subjectRef) {
      subjectEntityId =
        localEntityIds.get(
          fact.subjectRef
            .toLowerCase(),
        ) ?? null;

      if (!subjectEntityId) {
        skippedFacts += 1;
        continue;
      }
    }

    let objectEntityId =
      fact.objectEntityId;

    if (fact.objectRef) {
      objectEntityId =
        localEntityIds.get(
          fact.objectRef
            .toLowerCase(),
        ) ?? null;

      if (!objectEntityId) {
        skippedFacts += 1;
        continue;
      }
    }

    try {
      proposeFact({
        ownerKey:
          input.ownerKey,
        projectId:
          input.projectId,
        subjectEntityId:
          subjectEntityId ??
          undefined,
        predicate:
          fact.predicate,
        valueText:
          fact.valueText,
        objectEntityId:
          objectEntityId ??
          undefined,
        canonStatus:
          fact.canonStatus,
        sourceRole:
          "assistant",
        sourceMessageId:
          input.assistantMessage.id,
      });
    } catch (error) {
      return {
        status: "failed",
        error:
          errorMessage(error),
      };
    }

    persistedFacts += 1;
  }

  return {
    status: "applied",
    proposedEntities,
    reusedExistingEntities,
    ambiguousEntities,
    persistedFacts,
    skippedFacts,
    rejectedEntities:
      extraction.value.rejectedEntities,
    rejectedFacts:
      extraction.value.rejectedFacts,
  };
}
