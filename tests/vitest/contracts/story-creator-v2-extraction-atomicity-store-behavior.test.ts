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
  typeof import("../../../lib/storyCreator/store");

let store: StoryStore;
let tempRoot = "";

const previousDataDir = process.env.OTG_DATA_DIR;
const previousDataRoot = process.env.OTG_DATA_ROOT;

function expectCode(
  action: () => unknown,
  expectedCode: string,
) {
  try {
    action();
  } catch (error) {
    expect(
      error &&
        typeof error === "object" &&
        "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "",
    ).toBe(expectedCode);

    return;
  }

  throw new Error(
    `Expected error code ${expectedCode}, but the action succeeded.`,
  );
}

function projectWithMessage(input: {
  ownerKey: string;
  title: string;
  role?: "user" | "assistant";
  content?: string;
}) {
  const project =
    store.createStoryCreatorProject({
      ownerKey: input.ownerKey,
      title: input.title,
    });

  const message =
    store.addStoryCreatorMessage({
      ownerKey: input.ownerKey,
      projectId: project.id,
      role: input.role || "assistant",
      content:
        input.content ||
        "Mara is a pilot from North Pier.",
    });

  return {
    project,
    message,
  };
}

describe(
  "Story Creator V2 extraction atomicity store behavior",
  () => {
    beforeAll(async () => {
      tempRoot = fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "otg-story-v2-extraction-atomicity-",
        ),
      );

      process.env.OTG_DATA_DIR = tempRoot;
      process.env.OTG_DATA_ROOT = tempRoot;

      vi.resetModules();

      store = await import(
        "../../../lib/storyCreator/store"
      );
    });

    afterAll(() => {
      if (previousDataDir === undefined) {
        delete process.env.OTG_DATA_DIR;
      } else {
        process.env.OTG_DATA_DIR = previousDataDir;
      }

      if (previousDataRoot === undefined) {
        delete process.env.OTG_DATA_ROOT;
      } else {
        process.env.OTG_DATA_ROOT = previousDataRoot;
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
    });

    it(
      "commits entities facts questions and provenance together",
      () => {
        const ownerKey = "extract-success-owner";
        const { project, message } =
          projectWithMessage({
            ownerKey,
            title: "Extraction Success Story",
          });

        const result =
          store.applyStoryExtraction({
            ownerKey,
            projectId: project.id,
            sourceMessageId: message.id,
            entities: [
              {
                entityType: "character",
                name: "Mara",
              },
            ],
            facts: [
              {
                subjectName: "Mara",
                predicate: "role",
                valueText: "pilot",
                canonStatus: "suggestion",
              },
            ],
            openQuestions: [
              {
                question: "Why did Mara leave North Pier?",
              },
            ],
          });

        expect(result.entitiesCreated).toBe(1);
        expect(result.factsCreated).toBe(1);
        expect(result.questionsCreated).toBe(1);

        const [entity] =
          store.listStoryBibleEntities({
            ownerKey,
            projectId: project.id,
          });
        expect(entity.sourceMessageId).toBe(message.id);

        const [fact] =
          store.listStoryBibleFacts({
            ownerKey,
            projectId: project.id,
          });
        expect(fact.sourceMessageId).toBe(message.id);
        expect(fact.canonStatus).toBe("suggestion");

        const [question] =
          store.listStoryOpenQuestions({
            ownerKey,
            projectId: project.id,
            status: "open",
          });
        expect(question.sourceMessageId).toBe(message.id);
      },
    );

    it(
      "rolls back an entity write failure while keeping pre-run data",
      () => {
        const ownerKey = "extract-rollback-entity-owner";
        const { project, message } =
          projectWithMessage({
            ownerKey,
            title: "Extraction Entity Rollback",
          });

        const preExisting =
          store.createStoryBibleEntity({
            ownerKey,
            projectId: project.id,
            entityType: "character",
            name: "Existing",
            sourceRole: "assistant",
          });

        expectCode(
          () =>
            store.applyStoryExtraction({
              ownerKey,
              projectId: project.id,
              sourceMessageId: message.id,
              entities: [
                {
                  entityType: "character",
                  name: "Rollback Mara",
                },
              ],
              debugFailurePoint: "afterEntityWrite",
            }),
          "STORY_EXTRACT_DEBUG_FAILURE",
        );

        expect(
          store
            .listStoryBibleEntities({
              ownerKey,
              projectId: project.id,
            })
            .map((entity) => entity.id),
        ).toEqual([preExisting.id]);
      },
    );

    it(
      "rolls back facts questions and entities after a later extraction failure",
      () => {
        const ownerKey = "extract-rollback-fact-owner";
        const { project, message } =
          projectWithMessage({
            ownerKey,
            title: "Extraction Fact Rollback",
          });

        expectCode(
          () =>
            store.applyStoryExtraction({
              ownerKey,
              projectId: project.id,
              sourceMessageId: message.id,
              entities: [
                {
                  entityType: "character",
                  name: "Rollback Mara",
                },
              ],
              facts: [
                {
                  subjectName: "Rollback Mara",
                  predicate: "role",
                  valueText: "pilot",
                  canonStatus: "suggestion",
                },
              ],
              openQuestions: [
                {
                  question: "What does Rollback Mara fear?",
                },
              ],
              debugFailurePoint: "afterFactCreation",
            }),
          "STORY_EXTRACT_DEBUG_FAILURE",
        );

        expect(
          store.listStoryBibleEntities({
            ownerKey,
            projectId: project.id,
          }),
        ).toEqual([]);
        expect(
          store.listStoryBibleFacts({
            ownerKey,
            projectId: project.id,
            includeSuperseded: true,
          }),
        ).toEqual([]);
        expect(
          store.listStoryOpenQuestions({
            ownerKey,
            projectId: project.id,
          }),
        ).toEqual([]);
      },
    );

    it(
      "rejects source messages from another project or owner",
      () => {
        const ownerKey = "extract-source-owner";
        const first =
          projectWithMessage({
            ownerKey,
            title: "Source One",
          });
        const second =
          projectWithMessage({
            ownerKey,
            title: "Source Two",
          });
        const otherOwner =
          projectWithMessage({
            ownerKey: "extract-source-other-owner",
            title: "Source Other",
          });

        expectCode(
          () =>
            store.applyStoryExtraction({
              ownerKey,
              projectId: second.project.id,
              sourceMessageId: first.message.id,
              entities: [],
            }),
          "STORY_MESSAGE_NOT_FOUND",
        );

        expectCode(
          () =>
            store.applyStoryExtraction({
              ownerKey,
              projectId: first.project.id,
              sourceMessageId: otherOwner.message.id,
              entities: [],
            }),
          "STORY_MESSAGE_NOT_FOUND",
        );
      },
    );

    it(
      "retries the same source message without duplicating entities facts questions or conflicts",
      () => {
        const ownerKey = "extract-retry-owner";
        const { project, message } =
          projectWithMessage({
            ownerKey,
            title: "Extraction Retry Story",
          });

        const first =
          store.applyStoryExtraction({
            ownerKey,
            projectId: project.id,
            sourceMessageId: message.id,
            entities: [
              {
                entityType: "character",
                name: "Nia",
              },
            ],
            facts: [
              {
                subjectName: "Nia",
                predicate: "role",
                valueText: "navigator",
                canonStatus: "suggestion",
              },
            ],
            openQuestions: [
              {
                question: "Where did Nia learn the old maps?",
              },
            ],
          });

        const second =
          store.applyStoryExtraction({
            ownerKey,
            projectId: project.id,
            sourceMessageId: message.id,
            entities: [
              {
                entityType: "character",
                name: "Nia",
              },
            ],
            facts: [
              {
                subjectName: "Nia",
                predicate: "role",
                valueText: "navigator",
                canonStatus: "suggestion",
              },
            ],
            openQuestions: [
              {
                question: "Where did Nia learn the old maps?",
              },
            ],
          });

        expect(first.entitiesCreated).toBe(1);
        expect(first.factsCreated).toBe(1);
        expect(first.questionsCreated).toBe(1);
        expect(second.entitiesReused).toBe(1);
        expect(second.factsReused).toBe(1);
        expect(second.questionsReused).toBe(1);
        expect(
          store.listStoryBibleEntities({
            ownerKey,
            projectId: project.id,
          }),
        ).toHaveLength(1);
        expect(
          store.listStoryBibleFacts({
            ownerKey,
            projectId: project.id,
            includeSuperseded: true,
          }),
        ).toHaveLength(1);
        expect(
          store.listStoryOpenQuestions({
            ownerKey,
            projectId: project.id,
          }),
        ).toHaveLength(1);
      },
    );

    it(
      "creates deterministic conflicts automatically and does not alter canon",
      () => {
        const ownerKey = "extract-conflict-owner";
        const { project, message } =
          projectWithMessage({
            ownerKey,
            title: "Extraction Conflict Story",
          });

        const lena =
          store.createStoryBibleEntity({
            ownerKey,
            projectId: project.id,
            entityType: "character",
            name: "Lena",
            sourceRole: "user",
          });

        const canon =
          store.addStoryBibleFact({
            ownerKey,
            projectId: project.id,
            subjectEntityId: lena.id,
            predicate: "eye_color",
            valueText: "blue",
            canonStatus: "canon",
            sourceRole: "user",
          });

        const first =
          store.applyStoryExtraction({
            ownerKey,
            projectId: project.id,
            sourceMessageId: message.id,
            entities: [
              {
                entityType: "character",
                name: "Lena",
              },
            ],
            facts: [
              {
                subjectName: "Lena",
                predicate: "eye_color",
                valueText: "green",
                canonStatus: "suggestion",
              },
            ],
          });

        const second =
          store.applyStoryExtraction({
            ownerKey,
            projectId: project.id,
            sourceMessageId: message.id,
            entities: [
              {
                entityType: "character",
                name: "Lena",
              },
            ],
            facts: [
              {
                subjectName: "Lena",
                predicate: "eye_color",
                valueText: "green",
                canonStatus: "suggestion",
              },
            ],
          });

        expect(first.conflictsCreated).toBe(1);
        expect(second.conflictsExisting).toBe(1);
        expect(
          store.listStoryConflicts({
            ownerKey,
            projectId: project.id,
            status: "open",
          }),
        ).toHaveLength(1);

        const currentCanon =
          store
            .listStoryBibleFacts({
              ownerKey,
              projectId: project.id,
            })
            .filter((fact) => fact.canonStatus === "canon");

        expect(currentCanon).toHaveLength(1);
        expect(currentCanon[0].id).toBe(canon.id);
        expect(currentCanon[0].valueText).toBe("blue");
      },
    );

    it(
      "keeps extracted user and assistant messages non-canon even when the model asks for canon",
      () => {
        const userCase =
          projectWithMessage({
            ownerKey: "extract-user-message-owner",
            title: "User Authored Extraction",
            role: "user",
          });
        const assistantCase =
          projectWithMessage({
            ownerKey: "extract-assistant-message-owner",
            title: "Assistant Authored Extraction",
            role: "assistant",
          });

        store.applyStoryExtraction({
          ownerKey: "extract-user-message-owner",
          projectId: userCase.project.id,
          sourceMessageId: userCase.message.id,
          facts: [
            {
              predicate: "tone",
              valueText: "hopeful",
              canonStatus: "canon",
            },
          ],
        });

        store.applyStoryExtraction({
          ownerKey: "extract-assistant-message-owner",
          projectId: assistantCase.project.id,
          sourceMessageId: assistantCase.message.id,
          facts: [
            {
              predicate: "theme",
              valueText: "memory",
              canonStatus: "canon",
            },
            {
              predicate: "lost_detail",
              canonStatus: "unknown",
            },
          ],
        });

        const userFacts =
          store.listStoryBibleFacts({
            ownerKey: "extract-user-message-owner",
            projectId: userCase.project.id,
          });
        const assistantFacts =
          store.listStoryBibleFacts({
            ownerKey: "extract-assistant-message-owner",
            projectId: assistantCase.project.id,
          });

        expect(userFacts[0].canonStatus).toBe("suggestion");
        expect(userFacts[0].sourceRole).toBe("assistant");
        expect(userFacts[0].sourceMessageId).toBe(
          userCase.message.id,
        );
        expect(
          assistantFacts.map((fact) => fact.canonStatus),
        ).toEqual(["suggestion", "unknown"]);
        expect(
          assistantFacts.every(
            (fact) => fact.sourceRole === "assistant",
          ),
        ).toBe(true);
      },
    );

    it(
      "keeps Story Director messages after extraction persistence fails",
      () => {
        const ownerKey = "extract-message-survives-owner";
        const { project, message } =
          projectWithMessage({
            ownerKey,
            title: "Message Survives Extraction Failure",
          });

        expectCode(
          () =>
            store.applyStoryExtraction({
              ownerKey,
              projectId: project.id,
              sourceMessageId: message.id,
              entities: [
                {
                  entityType: "character",
                  name: "Temporary",
                },
              ],
              debugFailurePoint: "afterEntityWrite",
            }),
          "STORY_EXTRACT_DEBUG_FAILURE",
        );

        expect(
          store
            .listStoryCreatorMessages({
              ownerKey,
              projectId: project.id,
            })
            .map((item) => item.id),
        ).toEqual([message.id]);
      },
    );
  },
);
