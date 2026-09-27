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

describe(
  "Story Creator V2 canon approval store behavior",
  () => {
    beforeAll(async () => {
      tempRoot = fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "otg-story-v2-approval-",
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
      "approves assistant suggestions by appending user canon and recording a review",
      () => {
        const ownerKey = "approval-owner";

        const project =
          store.createStoryCreatorProject({
            ownerKey,
            title: "Approval Story",
          });

        const assistantMessage =
          store.addStoryCreatorMessage({
            ownerKey,
            projectId: project.id,
            role: "assistant",
            content:
              "A possible suggestion is that Mara fears water.",
          });

        const mara =
          store.createStoryBibleEntity({
            ownerKey,
            projectId: project.id,
            entityType: "character",
            name: "Mara",
            sourceRole: "assistant",
            sourceMessageId:
              assistantMessage.id,
          });

        const suggestion =
          store.addStoryBibleFact({
            ownerKey,
            projectId: project.id,
            subjectEntityId: mara.id,
            predicate: "fear",
            valueText: "water",
            canonStatus: "suggestion",
            sourceRole: "assistant",
            sourceMessageId:
              assistantMessage.id,
          });

        expect(
          store.listPendingStoryBibleFacts({
            ownerKey,
            projectId: project.id,
          }).map((fact) => fact.id),
        ).toEqual([suggestion.id]);

        const approved =
          store.approveStoryBibleFact({
            ownerKey,
            projectId: project.id,
            factId: suggestion.id,
          });

        expect(approved.canonStatus).toBe("canon");
        expect(approved.sourceRole).toBe("user");
        expect(approved.sourceMessageId).toBeNull();
        expect(approved.supersedesFactId).toBeNull();
        expect(approved.subjectEntityId).toBe(mara.id);
        expect(approved.predicate).toBe("fear");
        expect(approved.valueText).toBe("water");

        const review =
          store.getStoryFactReview({
            ownerKey,
            projectId: project.id,
            proposalFactId: suggestion.id,
          });

        expect(review?.decision).toBe("approved");
        expect(review?.resultFactId).toBe(approved.id);

        expect(
          store.listPendingStoryBibleFacts({
            ownerKey,
            projectId: project.id,
          }),
        ).toEqual([]);

        const currentFacts =
          store.listStoryBibleFacts({
            ownerKey,
            projectId: project.id,
          });

        expect(
          currentFacts.map((fact) => fact.id),
        ).toEqual([approved.id]);

        const historyFacts =
          store.listStoryBibleFacts({
            ownerKey,
            projectId: project.id,
            includeSuperseded: true,
          });

        expect(
          historyFacts.map((fact) => fact.id),
        ).toEqual([
          suggestion.id,
          approved.id,
        ]);

        expectCode(
          () =>
            store.approveStoryBibleFact({
              ownerKey,
              projectId: project.id,
              factId: suggestion.id,
            }),
          "STORY_BIBLE_FACT_ALREADY_REVIEWED",
        );

        expectCode(
          () =>
            store.approveStoryBibleFact({
              ownerKey,
              projectId: project.id,
              factId: approved.id,
            }),
          "STORY_BIBLE_FACT_ALREADY_CANON",
        );
      },
    );

    it(
      "reuses identical current canon instead of creating duplicate canon",
      () => {
        const ownerKey = "approval-identical-owner";

        const project =
          store.createStoryCreatorProject({
            ownerKey,
            title: "Identical Story",
          });

        const message =
          store.addStoryCreatorMessage({
            ownerKey,
            projectId: project.id,
            role: "user",
            content: "Tala carries a brass key.",
          });

        const tala =
          store.createStoryBibleEntity({
            ownerKey,
            projectId: project.id,
            entityType: "character",
            name: "Tala",
            sourceRole: "user",
            sourceMessageId: message.id,
          });

        const canon =
          store.addStoryBibleFact({
            ownerKey,
            projectId: project.id,
            subjectEntityId: tala.id,
            predicate: "carries",
            valueText: "brass key",
            canonStatus: "canon",
            sourceRole: "user",
            sourceMessageId: message.id,
          });

        const suggestion =
          store.addStoryBibleFact({
            ownerKey,
            projectId: project.id,
            subjectEntityId: tala.id,
            predicate: "carries",
            valueText: "brass key",
            canonStatus: "suggestion",
            sourceRole: "assistant",
          });

        const approved =
          store.approveStoryBibleFact({
            ownerKey,
            projectId: project.id,
            factId: suggestion.id,
          });

        expect(approved.id).toBe(canon.id);

        const currentFacts =
          store.listStoryBibleFacts({
            ownerKey,
            projectId: project.id,
          });

        expect(
          currentFacts.filter(
            (fact) => fact.canonStatus === "canon",
          ),
        ).toHaveLength(1);

        expect(
          store.getStoryFactReview({
            ownerKey,
            projectId: project.id,
            proposalFactId: suggestion.id,
          })?.resultFactId,
        ).toBe(canon.id);
      },
    );

    it(
      "rejects suggestions without leaving them pending",
      () => {
        const ownerKey = "approval-reject-owner";

        const project =
          store.createStoryCreatorProject({
            ownerKey,
            title: "Reject Story",
          });

        const suggestion =
          store.addStoryBibleFact({
            ownerKey,
            projectId: project.id,
            predicate: "tone",
            valueText: "satirical",
            canonStatus: "suggestion",
            sourceRole: "assistant",
          });

        const review =
          store.rejectStoryBibleFact({
            ownerKey,
            projectId: project.id,
            factId: suggestion.id,
          });

        expect(review.decision).toBe("rejected");
        expect(review.resultFactId).toBeNull();
        expect(
          store.listPendingStoryBibleFacts({
            ownerKey,
            projectId: project.id,
          }),
        ).toEqual([]);
        expect(
          store.listStoryBibleFacts({
            ownerKey,
            projectId: project.id,
          }),
        ).toEqual([]);
      },
    );

    it(
      "blocks normal approval when a suggestion conflicts with active canon",
      () => {
        const ownerKey = "approval-conflict-owner";

        const project =
          store.createStoryCreatorProject({
            ownerKey,
            title: "Conflict Approval Story",
          });

        store.addStoryBibleFact({
          ownerKey,
          projectId: project.id,
          predicate: "setting",
          valueText: "desert",
          canonStatus: "canon",
          sourceRole: "user",
        });

        const suggestion =
          store.addStoryBibleFact({
            ownerKey,
            projectId: project.id,
            predicate: "setting",
            valueText: "ocean",
            canonStatus: "suggestion",
            sourceRole: "assistant",
          });

        expectCode(
          () =>
            store.approveStoryBibleFact({
              ownerKey,
              projectId: project.id,
              factId: suggestion.id,
            }),
          "STORY_CANON_CONFLICT_REQUIRES_RESOLUTION",
        );

        expect(
          store.getStoryFactReview({
            ownerKey,
            projectId: project.id,
            proposalFactId: suggestion.id,
          }),
        ).toBeNull();
      },
    );
  },
);
