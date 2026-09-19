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

let store: StoryStore;
let tempRoot = "";

const previousDataDir =
  process.env.OTG_DATA_DIR;

const previousDataRoot =
  process.env.OTG_DATA_ROOT;

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
        ? String(
            (
              error as {
                code?: unknown;
              }
            ).code || "",
          )
        : "",
    ).toBe(expectedCode);

    return;
  }

  throw new Error(
    `Expected error code ${expectedCode}, but the action succeeded.`,
  );
}

describe(
  "Story Creator Phase 2D1 proposal store behavior",
  () => {
    beforeAll(async () => {
      tempRoot = fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "otg-story-proposal-",
        ),
      );

      process.env.OTG_DATA_DIR =
        tempRoot;

      process.env.OTG_DATA_ROOT =
        tempRoot;

      vi.resetModules();

      store = await import(
        "../../../lib/storyCreator/store"
      );
    });

    afterAll(() => {
      if (
        previousDataDir === undefined
      ) {
        delete process.env.OTG_DATA_DIR;
      } else {
        process.env.OTG_DATA_DIR =
          previousDataDir;
      }

      if (
        previousDataRoot === undefined
      ) {
        delete process.env.OTG_DATA_ROOT;
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
    });

    it(
      "allows only attributable non-canon assistant/system proposals",
      () => {
        const owner =
          "phase2d1-owner";

        const project =
          store.createStoryCreatorProject(
            {
              ownerKey: owner,
              title:
                "Phase 2D1 Proposal Story",
              format: "feature",
              genre: "drama",
            },
          );

        const userMessage =
          store.addStoryCreatorMessage(
            {
              ownerKey: owner,
              projectId:
                project.id,
              role: "user",
              content:
                "A character named Lena Hart lives in Springfield.",
            },
          );

        const assistantMessage =
          store.addStoryCreatorMessage(
            {
              ownerKey: owner,
              projectId:
                project.id,
              role: "assistant",
              content:
                "A possible structured suggestion identifies Lena Hart as a character.",
            },
          );

        const lena =
          store.proposeStoryBibleEntity(
            {
              ownerKey: owner,
              projectId:
                project.id,
              entityType:
                "character",
              name: "Lena Hart",
              sourceRole:
                "assistant",
              sourceMessageId:
                assistantMessage.id,
            },
          );

        expect(lena.name).toBe(
          "Lena Hart",
        );

        expect(lena.sourceRole).toBe(
          "assistant",
        );

        expect(
          lena.sourceMessageId,
        ).toBe(
          assistantMessage.id,
        );

        const residence =
          store.proposeStoryBibleFact(
            {
              ownerKey: owner,
              projectId:
                project.id,
              subjectEntityId:
                lena.id,
              predicate:
                "residence",
              valueText:
                "Springfield",
              canonStatus:
                "suggestion",
              sourceRole:
                "assistant",
              sourceMessageId:
                assistantMessage.id,
            },
          );

        expect(
          residence.canonStatus,
        ).toBe("suggestion");

        expect(
          residence.sourceRole,
        ).toBe("assistant");

        expect(
          residence.sourceMessageId,
        ).toBe(
          assistantMessage.id,
        );

        const unknown =
          store.proposeStoryBibleFact(
            {
              ownerKey: owner,
              projectId:
                project.id,
              subjectEntityId:
                lena.id,
              predicate:
                "exact_age",
              canonStatus:
                "unknown",
              sourceRole:
                "system",
            },
          );

        expect(
          unknown.canonStatus,
        ).toBe("unknown");

        expect(
          unknown.valueText,
        ).toBe("");

        expect(
          unknown.sourceRole,
        ).toBe("system");

        expectCode(
          () =>
            store.proposeStoryBibleFact(
              {
                ownerKey: owner,
                projectId:
                  project.id,
                subjectEntityId:
                  lena.id,
                predicate:
                  "silent_canon_attempt",
                valueText:
                  "must fail",
                canonStatus:
                  "canon",
                sourceRole:
                  "assistant",
                sourceMessageId:
                  assistantMessage.id,
              },
            ),
          "STORY_BIBLE_PROPOSAL_CANON_FORBIDDEN",
        );

        expectCode(
          () =>
            store.proposeStoryBibleFact(
              {
                ownerKey: owner,
                projectId:
                  project.id,
                subjectEntityId:
                  lena.id,
                predicate:
                  "user_proposal_attempt",
                valueText:
                  "must fail",
                canonStatus:
                  "suggestion",
                sourceRole: "user",
                sourceMessageId:
                  userMessage.id,
              },
            ),
          "STORY_BIBLE_PROPOSAL_SOURCE_ROLE_FORBIDDEN",
        );

        expectCode(
          () =>
            store.proposeStoryBibleEntity(
              {
                ownerKey: owner,
                projectId:
                  project.id,
                entityType:
                  "location",
                name:
                  "Missing Source",
                sourceRole:
                  "assistant",
              },
            ),
          "STORY_BIBLE_PROPOSAL_SOURCE_MESSAGE_REQUIRED",
        );

        expectCode(
          () =>
            store.proposeStoryBibleEntity(
              {
                ownerKey: owner,
                projectId:
                  project.id,
                entityType:
                  "location",
                name:
                  "Wrong Source Role",
                sourceRole:
                  "assistant",
                sourceMessageId:
                  userMessage.id,
              },
            ),
          "STORY_BIBLE_SOURCE_ROLE_MISMATCH",
        );

        const entities =
          store.listStoryBibleEntities(
            {
              ownerKey: owner,
              projectId:
                project.id,
            },
          );

        const facts =
          store.listStoryBibleFacts(
            {
              ownerKey: owner,
              projectId:
                project.id,
            },
          );

        expect(entities).toHaveLength(
          1,
        );

        expect(facts).toHaveLength(
          2,
        );

        expect(
          facts.some(
            (fact) =>
              fact.canonStatus ===
              "canon",
          ),
        ).toBe(false);

        const tempDb =
          path.join(
            tempRoot,
            "story-creator",
            "story-creator.sqlite",
          );

        expect(
          fs.existsSync(tempDb),
        ).toBe(true);
      },
    );
  },
);
