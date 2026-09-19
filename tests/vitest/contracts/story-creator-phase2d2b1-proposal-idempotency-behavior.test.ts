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

describe(
  "Story Creator Phase 2D2B1 proposal replay idempotency behavior",
  () => {
    let tempRoot = "";

    let previousDataDir:
      | string
      | undefined;

    let previousDataRoot:
      | string
      | undefined;

    let store: typeof import(
      "../../../lib/storyCreator/store"
    );

    beforeAll(async () => {
      previousDataDir =
        process.env.OTG_DATA_DIR;

      previousDataRoot =
        process.env.OTG_DATA_ROOT;

      tempRoot =
        fs.mkdtempSync(
          path.join(
            os.tmpdir(),
            "otg-story-2d2b1-",
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
    });

    afterAll(() => {
      if (
        previousDataDir ===
        undefined
      ) {
        delete process.env.OTG_DATA_DIR;
      } else {
        process.env.OTG_DATA_DIR =
          previousDataDir;
      }

      if (
        previousDataRoot ===
        undefined
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
      "reuses identical proposals from one assistant message without merging different messages",
      () => {
        const owner =
          "phase2d2b1-owner";

        const project =
          store.createStoryCreatorProject({
            ownerKey: owner,
            title:
              "Phase 2D2B1 Replay Story",
            format: "feature",
            genre: "drama",
          });

        const assistantOne =
          store.addStoryCreatorMessage({
            ownerKey: owner,
            projectId:
              project.id,
            role: "assistant",
            content:
              "Lena Hart may live in Springfield.",
          });

        const entityOne =
          store.proposeStoryBibleEntity({
            ownerKey: owner,
            projectId:
              project.id,
            entityType:
              "character",
            name:
              "Lena Hart",
            sourceRole:
              "assistant",
            sourceMessageId:
              assistantOne.id,
          });

        const entityReplay =
          store.proposeStoryBibleEntity({
            ownerKey: owner,
            projectId:
              project.id,
            entityType:
              "Character",
            name:
              "lena hart",
            sourceRole:
              "assistant",
            sourceMessageId:
              assistantOne.id,
          });

        expect(
          entityReplay.id,
        ).toBe(
          entityOne.id,
        );

        const factOne =
          store.proposeStoryBibleFact({
            ownerKey: owner,
            projectId:
              project.id,
            subjectEntityId:
              entityOne.id,
            predicate:
              "residence",
            valueText:
              "Springfield",
            canonStatus:
              "suggestion",
            sourceRole:
              "assistant",
            sourceMessageId:
              assistantOne.id,
          });

        const factReplay =
          store.proposeStoryBibleFact({
            ownerKey: owner,
            projectId:
              project.id,
            subjectEntityId:
              entityOne.id,
            predicate:
              "Residence",
            valueText:
              "  Springfield  ",
            canonStatus:
              "suggestion",
            sourceRole:
              "assistant",
            sourceMessageId:
              assistantOne.id,
          });

        expect(
          factReplay.id,
        ).toBe(
          factOne.id,
        );

        expect(
          store.listStoryBibleEntities({
            ownerKey: owner,
            projectId:
              project.id,
          }),
        ).toHaveLength(1);

        expect(
          store.listStoryBibleFacts({
            ownerKey: owner,
            projectId:
              project.id,
          }),
        ).toHaveLength(1);

        /*
         * A different persisted assistant message is a different
         * provenance event. Phase 2D2B1 intentionally does not
         * silently merge it.
         */
        const assistantTwo =
          store.addStoryCreatorMessage({
            ownerKey: owner,
            projectId:
              project.id,
            role: "assistant",
            content:
              "Lena Hart may live in Springfield.",
          });

        const entityTwo =
          store.proposeStoryBibleEntity({
            ownerKey: owner,
            projectId:
              project.id,
            entityType:
              "character",
            name:
              "Lena Hart",
            sourceRole:
              "assistant",
            sourceMessageId:
              assistantTwo.id,
          });

        expect(
          entityTwo.id,
        ).not.toBe(
          entityOne.id,
        );

        const factTwo =
          store.proposeStoryBibleFact({
            ownerKey: owner,
            projectId:
              project.id,
            subjectEntityId:
              entityTwo.id,
            predicate:
              "residence",
            valueText:
              "Springfield",
            canonStatus:
              "suggestion",
            sourceRole:
              "assistant",
            sourceMessageId:
              assistantTwo.id,
          });

        expect(
          factTwo.id,
        ).not.toBe(
          factOne.id,
        );

        expect(
          store.listStoryBibleEntities({
            ownerKey: owner,
            projectId:
              project.id,
          }),
        ).toHaveLength(2);

        expect(
          store.listStoryBibleFacts({
            ownerKey: owner,
            projectId:
              project.id,
          }),
        ).toHaveLength(2);

        expect(
          store.listStoryBibleFacts({
            ownerKey: owner,
            projectId:
              project.id,
          }).some(
            (fact) =>
              fact.canonStatus ===
              "canon",
          ),
        ).toBe(false);
      },
    );
  },
);
