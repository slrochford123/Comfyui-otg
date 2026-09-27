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

function makeConflictFixture(ownerKey: string) {
  const project =
    store.createStoryCreatorProject({
      ownerKey,
      title: "Conflict Story",
    });

  const userMessage =
    store.addStoryCreatorMessage({
      ownerKey,
      projectId: project.id,
      role: "user",
      content: "Lena has blue eyes.",
    });

  const assistantMessage =
    store.addStoryCreatorMessage({
      ownerKey,
      projectId: project.id,
      role: "assistant",
      content:
        "Maybe Lena has green eyes instead.",
    });

  const lena =
    store.createStoryBibleEntity({
      ownerKey,
      projectId: project.id,
      entityType: "character",
      name: "Lena",
      sourceRole: "user",
      sourceMessageId: userMessage.id,
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
      sourceMessageId: userMessage.id,
    });

  const suggestion =
    store.addStoryBibleFact({
      ownerKey,
      projectId: project.id,
      subjectEntityId: lena.id,
      predicate: "eye_color",
      valueText: "green",
      canonStatus: "suggestion",
      sourceRole: "assistant",
      sourceMessageId:
        assistantMessage.id,
    });

  const conflicts =
    store.findStoryBibleConflicts({
      ownerKey,
      projectId: project.id,
    });

  return {
    project,
    canon,
    suggestion,
    conflict: conflicts[0],
  };
}

describe(
  "Story Creator V2 conflict store behavior",
  () => {
    beforeAll(async () => {
      tempRoot = fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "otg-story-v2-conflicts-",
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
      "detects suggestion conflicts against current approved canon",
      () => {
        const ownerKey = "conflict-owner";
        const {
          project,
          canon,
          suggestion,
          conflict,
        } = makeConflictFixture(ownerKey);

        expect(conflict.factId).toBe(
          suggestion.id,
        );
        expect(
          conflict.conflictsWithFactId,
        ).toBe(canon.id);
        expect(conflict.status).toBe("open");
        expect(conflict.resolvedAt).toBeNull();
        expect(conflict.sourceRole).toBe(
          "system",
        );
        expect(conflict.summary).toContain(
          "green",
        );
        expect(conflict.summary).toContain(
          "blue",
        );

        const repeated =
          store.findStoryBibleConflicts({
            ownerKey,
            projectId: project.id,
          });

        expect(repeated).toHaveLength(1);
        expect(repeated[0].id).toBe(
          conflict.id,
        );

        const listed =
          store.listStoryConflicts({
            ownerKey,
            projectId: project.id,
            status: "open",
          });

        expect(listed).toHaveLength(1);
      },
    );

    it(
      "keeps current canon by rejecting the proposed suggestion",
      () => {
        const ownerKey = "conflict-keep-owner";
        const {
          project,
          canon,
          suggestion,
          conflict,
        } = makeConflictFixture(ownerKey);

        const result =
          store.resolveStoryConflict({
            ownerKey,
            projectId: project.id,
            conflictId: conflict.id,
            action: "KEEP_CURRENT_CANON",
          });

        expect(result.conflict.status).toBe("resolved");
        expect(result.conflict.resolvedAt).toBeGreaterThan(0);
        expect(result.review?.decision).toBe("rejected");
        expect(result.review?.proposalFactId).toBe(
          suggestion.id,
        );
        expect(result.fact?.id).toBe(canon.id);

        expect(
          store.listPendingStoryBibleFacts({
            ownerKey,
            projectId: project.id,
          }),
        ).toEqual([]);
      },
    );

    it(
      "uses the proposed version by superseding the current canon",
      () => {
        const ownerKey = "conflict-use-owner";
        const {
          project,
          canon,
          suggestion,
          conflict,
        } = makeConflictFixture(ownerKey);

        const result =
          store.resolveStoryConflict({
            ownerKey,
            projectId: project.id,
            conflictId: conflict.id,
            action: "USE_PROPOSED_VERSION",
          });

        expect(result.conflict.status).toBe("resolved");
        expect(result.review?.decision).toBe("approved");
        expect(result.review?.proposalFactId).toBe(
          suggestion.id,
        );
        expect(result.fact?.canonStatus).toBe("canon");
        expect(result.fact?.sourceRole).toBe("user");
        expect(result.fact?.supersedesFactId).toBe(canon.id);
        expect(result.fact?.valueText).toBe("green");

        const currentFacts =
          store.listStoryBibleFacts({
            ownerKey,
            projectId: project.id,
          });

        expect(
          currentFacts.map((fact) => fact.id),
        ).toEqual([result.fact?.id]);
      },
    );

    it(
      "edits the proposed version before approving it",
      () => {
        const ownerKey = "conflict-edit-owner";
        const {
          project,
          canon,
          conflict,
        } = makeConflictFixture(ownerKey);

        const result =
          store.resolveStoryConflict({
            ownerKey,
            projectId: project.id,
            conflictId: conflict.id,
            action: "EDIT_PROPOSED_VERSION",
            valueText: "hazel",
          });

        expect(result.conflict.status).toBe("resolved");
        expect(result.review?.decision).toBe("approved");
        expect(result.fact?.valueText).toBe("hazel");
        expect(result.fact?.supersedesFactId).toBe(canon.id);
      },
    );

    it(
      "dismisses a conflict without reviewing the suggestion",
      () => {
        const ownerKey = "conflict-dismiss-owner";
        const {
          project,
          suggestion,
          conflict,
        } = makeConflictFixture(ownerKey);

        const result =
          store.resolveStoryConflict({
            ownerKey,
            projectId: project.id,
            conflictId: conflict.id,
            action: "DISMISS_CONFLICT",
          });

        expect(result.conflict.status).toBe("dismissed");
        expect(result.review).toBeNull();
        expect(result.fact).toBeNull();
        expect(
          store.getStoryFactReview({
            ownerKey,
            projectId: project.id,
            proposalFactId: suggestion.id,
          }),
        ).toBeNull();
        expect(
          store.listPendingStoryBibleFacts({
            ownerKey,
            projectId: project.id,
          }).map((fact) => fact.id),
        ).toEqual([suggestion.id]);
      },
    );

    it(
      "rolls back conflict resolution if a later review write fails",
      () => {
        const ownerKey = "conflict-rollback-owner";
        const {
          project,
          suggestion,
          conflict,
        } = makeConflictFixture(ownerKey);

        store.rejectStoryBibleFact({
          ownerKey,
          projectId: project.id,
          factId: suggestion.id,
        });

        const beforeFacts =
          store.listStoryBibleFacts({
            ownerKey,
            projectId: project.id,
            includeSuperseded: true,
          });

        expectCode(
          () =>
            store.resolveStoryConflict({
              ownerKey,
              projectId: project.id,
              conflictId: conflict.id,
              action: "USE_PROPOSED_VERSION",
            }),
          "STORY_BIBLE_FACT_ALREADY_REVIEWED",
        );

        const afterFacts =
          store.listStoryBibleFacts({
            ownerKey,
            projectId: project.id,
            includeSuperseded: true,
          });

        expect(afterFacts.map((fact) => fact.id)).toEqual(
          beforeFacts.map((fact) => fact.id),
        );
        expect(
          store.listStoryConflicts({
            ownerKey,
            projectId: project.id,
            status: "open",
          }).map((item) => item.id),
        ).toEqual([conflict.id]);
      },
    );
  },
);
