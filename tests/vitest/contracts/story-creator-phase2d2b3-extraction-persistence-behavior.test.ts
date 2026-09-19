import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type StoryStore =
  typeof import(
    "../../../lib/storyCreator/store"
  );

type Persistence =
  typeof import(
    "../../../lib/storyCreator/extractionPersistence"
  );

let store:
  StoryStore;

let persistence:
  Persistence;

let tempRoot = "";

const previousDataDir =
  process.env.OTG_DATA_DIR;

const previousDataRoot =
  process.env.OTG_DATA_ROOT;

beforeAll(
  async () => {
    tempRoot =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "otg-story-2d2b3-",
        ),
      );

    process.env.OTG_DATA_DIR =
      tempRoot;

    process.env.OTG_DATA_ROOT =
      tempRoot;

    vi.resetModules();

    store =
      await import(
        "../../../lib/storyCreator/store"
      );

    persistence =
      await import(
        "../../../lib/storyCreator/extractionPersistence"
      );
  },
);

afterAll(
  () => {
    if (
      previousDataDir === undefined
    ) {
      delete process.env
        .OTG_DATA_DIR;
    } else {
      process.env.OTG_DATA_DIR =
        previousDataDir;
    }

    if (
      previousDataRoot === undefined
    ) {
      delete process.env
        .OTG_DATA_ROOT;
    } else {
      process.env.OTG_DATA_ROOT =
        previousDataRoot;
    }

    if (tempRoot) {
      fs.rmSync(
        tempRoot,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

function createTurn(
  suffix: string,
) {
  const owner =
    "phase2d2b3-owner";

  const project =
    store.createStoryCreatorProject({
      ownerKey:
        owner,
      title:
        `2D2B3 Story ${suffix}`,
      format:
        "feature",
      genre:
        "drama",
    });

  const userMessage =
    store.addStoryCreatorMessage({
      ownerKey:
        owner,
      projectId:
        project.id,
      role:
        "user",
      content:
        "Lena Hart lives in Springfield.",
    });

  const assistantMessage =
    store.addStoryCreatorMessage({
      ownerKey:
        owner,
      projectId:
        project.id,
      role:
        "assistant",
      content:
        "Lena Hart lives in Springfield.",
    });

  return {
    owner,
    project,
    userMessage,
    assistantMessage,
  };
}

describe(
  "Story Creator Phase 2D2B3 extraction persistence behavior",
  () => {
    it(
      "persists assistant suggestions and unknowns but never Canon",
      async () => {
        const turn =
          createTurn(
            "basic",
          );

        const result =
          await persistence
            .extractAndPersistStoryBibleProposals(
              {
                ownerKey:
                  turn.owner,
                projectId:
                  turn.project.id,
                userMessage:
                  turn.userMessage,
                assistantMessage:
                  turn.assistantMessage,
              },
              {
                runModel:
                  async () => ({
                    ok: true,
                    value: {
                      entities: [
                        {
                          ref: "e1",
                          entityType:
                            "character",
                          name:
                            "Lena Hart",
                        },
                        {
                          ref: "e2",
                          entityType:
                            "location",
                          name:
                            "Springfield",
                        },
                      ],
                      facts: [
                        {
                          subjectRef:
                            "e1",
                          subjectEntityId:
                            null,
                          predicate:
                            "lives_in",
                          valueText: "",
                          objectRef:
                            "e2",
                          objectEntityId:
                            null,
                          canonStatus:
                            "suggestion",
                        },
                        {
                          subjectRef:
                            "e1",
                          subjectEntityId:
                            null,
                          predicate:
                            "exact_age",
                          valueText: "",
                          objectRef:
                            null,
                          objectEntityId:
                            null,
                          canonStatus:
                            "unknown",
                        },
                      ],
                      rejectedEntities:
                        0,
                      rejectedFacts:
                        0,
                    },
                  }),
              },
            );

        expect(
          result.status,
        ).toBe("applied");

        const entities =
          store.listStoryBibleEntities({
            ownerKey:
              turn.owner,
            projectId:
              turn.project.id,
          });

        const facts =
          store.listStoryBibleFacts({
            ownerKey:
              turn.owner,
            projectId:
              turn.project.id,
          });

        expect(
          entities,
        ).toHaveLength(2);

        expect(
          facts,
        ).toHaveLength(2);

        expect(
          entities.every(
            (entity) =>
              entity.sourceRole ===
                "assistant" &&
              entity.sourceMessageId ===
                turn.assistantMessage.id,
          ),
        ).toBe(true);

        expect(
          facts.every(
            (fact) =>
              fact.sourceRole ===
                "assistant" &&
              fact.sourceMessageId ===
                turn.assistantMessage.id,
          ),
        ).toBe(true);

        expect(
          facts.some(
            (fact) =>
              fact.canonStatus ===
              "canon",
          ),
        ).toBe(false);
      },
    );

    it(
      "keeps same-assistant replay idempotent",
      async () => {
        const turn =
          createTurn(
            "replay",
          );

        const fake =
          async () =>
            ({
              ok: true,
              value: {
                entities: [
                  {
                    ref: "e1",
                    entityType:
                      "character",
                    name:
                      "Lena Hart",
                  },
                ],
                facts: [
                  {
                    subjectRef:
                      "e1",
                    subjectEntityId:
                      null,
                    predicate:
                      "goal",
                    valueText:
                      "Escape",
                    objectRef:
                      null,
                    objectEntityId:
                      null,
                    canonStatus:
                      "suggestion",
                  },
                ],
                rejectedEntities:
                  0,
                rejectedFacts:
                  0,
              },
            } as const);

        const input = {
          ownerKey:
            turn.owner,
          projectId:
            turn.project.id,
          userMessage:
            turn.userMessage,
          assistantMessage:
            turn.assistantMessage,
        };

        await persistence
          .extractAndPersistStoryBibleProposals(
            input,
            {
              runModel:
                fake,
            },
          );

        await persistence
          .extractAndPersistStoryBibleProposals(
            input,
            {
              runModel:
                fake,
            },
          );

        expect(
          store.listStoryBibleEntities({
            ownerKey:
              turn.owner,
            projectId:
              turn.project.id,
          }),
        ).toHaveLength(1);

        expect(
          store.listStoryBibleFacts({
            ownerKey:
              turn.owner,
            projectId:
              turn.project.id,
          }),
        ).toHaveLength(1);
      },
    );

    it(
      "reuses one exact existing entity across messages",
      async () => {
        const owner =
          "phase2d2b3-existing-owner";

        const project =
          store.createStoryCreatorProject({
            ownerKey:
              owner,
            title:
              "Existing Entity Story",
            format:
              "feature",
            genre:
              "drama",
          });

        const earlierAssistant =
          store.addStoryCreatorMessage({
            ownerKey:
              owner,
            projectId:
              project.id,
            role:
              "assistant",
            content:
              "Earlier Lena mention.",
          });

        const existingLena =
          store.proposeStoryBibleEntity({
            ownerKey:
              owner,
            projectId:
              project.id,
            entityType:
              "character",
            name:
              "Lena Hart",
            sourceRole:
              "assistant",
            sourceMessageId:
              earlierAssistant.id,
          });

        const userMessage =
          store.addStoryCreatorMessage({
            ownerKey:
              owner,
            projectId:
              project.id,
            role:
              "user",
            content:
              "Lena Hart entered Springfield.",
          });

        const assistantMessage =
          store.addStoryCreatorMessage({
            ownerKey:
              owner,
            projectId:
              project.id,
            role:
              "assistant",
            content:
              "Lena Hart entered Springfield.",
          });

        const result =
          await persistence
            .extractAndPersistStoryBibleProposals(
              {
                ownerKey:
                  owner,
                projectId:
                  project.id,
                userMessage,
                assistantMessage,
              },
              {
                runModel:
                  async () => ({
                    ok: true,
                    value: {
                      entities: [
                        {
                          ref: "e1",
                          entityType:
                            "character",
                          name:
                            "Lena Hart",
                        },
                        {
                          ref: "e2",
                          entityType:
                            "location",
                          name:
                            "Springfield",
                        },
                      ],
                      facts: [
                        {
                          subjectRef:
                            "e1",
                          subjectEntityId:
                            null,
                          predicate:
                            "entered",
                          valueText: "",
                          objectRef:
                            "e2",
                          objectEntityId:
                            null,
                          canonStatus:
                            "suggestion",
                        },
                      ],
                      rejectedEntities:
                        0,
                      rejectedFacts:
                        0,
                    },
                  }),
              },
            );

        expect(
          result.status,
        ).toBe("applied");

        if (
          result.status !==
          "applied"
        ) {
          return;
        }

        expect(
          result.reusedExistingEntities,
        ).toBe(1);

        const entities =
          store.listStoryBibleEntities({
            ownerKey:
              owner,
            projectId:
              project.id,
          });

        expect(
          entities,
        ).toHaveLength(2);

        expect(
          entities.filter(
            (entity) =>
              entity.entityType ===
                "character" &&
              entity.name ===
                "Lena Hart",
          ),
        ).toHaveLength(1);

        expect(
          entities.find(
            (entity) =>
              entity.name ===
              "Lena Hart",
          )?.id,
        ).toBe(
          existingLena.id,
        );
      },
    );

    it(
      "leaves chat durable when extraction fails",
      async () => {
        const turn =
          createTurn(
            "failure",
          );

        const result =
          await persistence
            .extractAndPersistStoryBibleProposals(
              {
                ownerKey:
                  turn.owner,
                projectId:
                  turn.project.id,
                userMessage:
                  turn.userMessage,
                assistantMessage:
                  turn.assistantMessage,
              },
              {
                runModel:
                  async () => ({
                    ok: false,
                    error:
                      "synthetic extraction failure",
                  }),
              },
            );

        expect(
          result,
        ).toEqual({
          status:
            "failed",
          error:
            "synthetic extraction failure",
        });

        expect(
          store.listStoryCreatorMessages({
            ownerKey:
              turn.owner,
            projectId:
              turn.project.id,
          }),
        ).toHaveLength(2);

        expect(
          store.listStoryBibleEntities({
            ownerKey:
              turn.owner,
            projectId:
              turn.project.id,
          }),
        ).toHaveLength(0);

        expect(
          store.listStoryBibleFacts({
            ownerKey:
              turn.owner,
            projectId:
              turn.project.id,
          }),
        ).toHaveLength(0);
      },
    );

    it(
      "defense in depth drops forged Canon output",
      async () => {
        const turn =
          createTurn(
            "canon",
          );

        const result =
          await persistence
            .extractAndPersistStoryBibleProposals(
              {
                ownerKey:
                  turn.owner,
                projectId:
                  turn.project.id,
                userMessage:
                  turn.userMessage,
                assistantMessage:
                  turn.assistantMessage,
              },
              {
                runModel:
                  async () => ({
                    ok: true,
                    value: {
                      entities: [],
                      facts: [
                        {
                          subjectRef:
                            null,
                          subjectEntityId:
                            null,
                          predicate:
                            "forged",
                          valueText:
                            "must never persist",
                          objectRef:
                            null,
                          objectEntityId:
                            null,
                          canonStatus:
                            "canon",
                        } as never,
                      ],
                      rejectedEntities:
                        0,
                      rejectedFacts:
                        0,
                    },
                  }),
              },
            );

        expect(
          result.status,
        ).toBe("applied");

        if (
          result.status !==
          "applied"
        ) {
          return;
        }

        expect(
          result.persistedFacts,
        ).toBe(0);

        expect(
          result.skippedFacts,
        ).toBe(1);

        expect(
          store.listStoryBibleFacts({
            ownerKey:
              turn.owner,
            projectId:
              turn.project.id,
          }),
        ).toHaveLength(0);
      },
    );
  },
);
