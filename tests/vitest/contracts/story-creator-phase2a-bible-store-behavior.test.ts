import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

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
  "Story Creator Phase 2A Story Bible SQLite behavior",
  () => {
    beforeAll(async () => {
      tempRoot = fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "otg-story-bible-behavior-",
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
      "enforces Story Bible provenance, canon, ownership, and revision rules in SQLite",
      () => {
        const ownerA = "behavior-owner-a";
        const ownerB = "behavior-owner-b";

        const projectA =
          store.createStoryCreatorProject({
            ownerKey: ownerA,
            title: "Behavior Story A",
            format: "feature",
            genre: "drama",
          });

        const projectB =
          store.createStoryCreatorProject({
            ownerKey: ownerB,
            title: "Behavior Story B",
            format: "feature",
            genre: "drama",
          });

        const userMessage =
          store.addStoryCreatorMessage({
            ownerKey: ownerA,
            projectId: projectA.id,
            role: "user",
            content:
              "Paul White is the name his mother gave him.",
          });

        const assistantMessage =
          store.addStoryCreatorMessage({
            ownerKey: ownerA,
            projectId: projectA.id,
            role: "assistant",
            content:
              "A possible suggestion is that Paul is protective.",
          });

        const paul =
          store.createStoryBibleEntity({
            ownerKey: ownerA,
            projectId: projectA.id,
            entityType: "character",
            name: "Paul White",
            sourceRole: "user",
            sourceMessageId: userMessage.id,
          });

        expect(
          store
            .listStoryBibleEntities({
              ownerKey: ownerA,
              projectId: projectA.id,
            })
            .map((entity) => entity.id),
        ).toEqual([paul.id]);

        const userCanon =
          store.addStoryBibleFact({
            ownerKey: ownerA,
            projectId: projectA.id,
            subjectEntityId: paul.id,
            predicate: "given_name",
            valueText: "Paul White",
            canonStatus: "canon",
            sourceRole: "user",
            sourceMessageId: userMessage.id,
          });

        expect(userCanon.canonStatus).toBe(
          "canon",
        );

        const assistantSuggestion =
          store.addStoryBibleFact({
            ownerKey: ownerA,
            projectId: projectA.id,
            subjectEntityId: paul.id,
            predicate: "personality",
            valueText: "protective",
            canonStatus: "suggestion",
            sourceRole: "assistant",
            sourceMessageId:
              assistantMessage.id,
          });

        expect(
          assistantSuggestion.canonStatus,
        ).toBe("suggestion");

        expectCode(
          () =>
            store.addStoryBibleFact({
              ownerKey: ownerA,
              projectId: projectA.id,
              subjectEntityId: paul.id,
              predicate:
                "assistant_attempted_canon",
              valueText:
                "must never silently become canon",
              canonStatus: "canon",
              sourceRole: "assistant",
              sourceMessageId:
                assistantMessage.id,
            }),
          "STORY_BIBLE_ASSISTANT_CANON_FORBIDDEN",
        );

        expectCode(
          () =>
            store.addStoryBibleFact({
              ownerKey: ownerA,
              projectId: projectA.id,
              subjectEntityId: paul.id,
              predicate:
                "system_attempted_canon",
              valueText:
                "system must not silently become canon",
              canonStatus: "canon",
              sourceRole: "system",
            }),
          "STORY_BIBLE_SYSTEM_CANON_FORBIDDEN",
        );

        const unknownFact =
          store.addStoryBibleFact({
            ownerKey: ownerA,
            projectId: projectA.id,
            subjectEntityId: paul.id,
            predicate: "father_identity",
            canonStatus: "unknown",
            sourceRole: "user",
            sourceMessageId: userMessage.id,
          });

        expect(unknownFact.valueText).toBe(
          "",
        );

        expectCode(
          () =>
            store.addStoryBibleFact({
              ownerKey: ownerA,
              projectId: projectA.id,
              subjectEntityId: paul.id,
              predicate:
                "source_role_mismatch",
              valueText: "should reject",
              canonStatus: "suggestion",
              sourceRole: "assistant",
              sourceMessageId:
                userMessage.id,
            }),
          "STORY_BIBLE_SOURCE_ROLE_MISMATCH",
        );

        expect(() =>
          store.listStoryBibleFacts({
            ownerKey: ownerB,
            projectId: projectA.id,
          }),
        ).toThrow();

        expect(() =>
          store.addStoryBibleFact({
            ownerKey: ownerB,
            projectId: projectB.id,
            subjectEntityId: paul.id,
            predicate: "cross_owner_write",
            valueText: "must reject",
            canonStatus: "canon",
            sourceRole: "user",
          }),
        ).toThrow();

        const residenceV1 =
          store.addStoryBibleFact({
            ownerKey: ownerA,
            projectId: projectA.id,
            subjectEntityId: paul.id,
            predicate: "residence",
            valueText: "poor community",
            canonStatus: "canon",
            sourceRole: "user",
            sourceMessageId: userMessage.id,
          });

        const residenceV2 =
          store.addStoryBibleFact({
            ownerKey: ownerA,
            projectId: projectA.id,
            subjectEntityId: paul.id,
            predicate: "residence",
            valueText:
              "poor mutant community",
            canonStatus: "canon",
            sourceRole: "user",
            sourceMessageId: userMessage.id,
            supersedesFactId:
              residenceV1.id,
          });

        const currentFacts =
          store.listStoryBibleFacts({
            ownerKey: ownerA,
            projectId: projectA.id,
          });

        expect(
          currentFacts.some(
            (fact) =>
              fact.id === residenceV1.id,
          ),
        ).toBe(false);

        expect(
          currentFacts.some(
            (fact) =>
              fact.id === residenceV2.id,
          ),
        ).toBe(true);

        const historyFacts =
          store.listStoryBibleFacts({
            ownerKey: ownerA,
            projectId: projectA.id,
            includeSuperseded: true,
          });

        expect(
          historyFacts.some(
            (fact) =>
              fact.id === residenceV1.id,
          ),
        ).toBe(true);

        expect(
          historyFacts.some(
            (fact) =>
              fact.id === residenceV2.id,
          ),
        ).toBe(true);

        expectCode(
          () =>
            store.addStoryBibleFact({
              ownerKey: ownerA,
              projectId: projectA.id,
              subjectEntityId: paul.id,
              predicate: "residence",
              valueText:
                "another residence revision",
              canonStatus: "canon",
              sourceRole: "user",
              sourceMessageId:
                userMessage.id,
              supersedesFactId:
                residenceV1.id,
            }),
          "STORY_BIBLE_FACT_ALREADY_SUPERSEDED",
        );

        const ageWindow =
          store.addStoryBibleFact({
            ownerKey: ownerA,
            projectId: projectA.id,
            subjectEntityId: paul.id,
            predicate: "age_window",
            valueText: "approximately 12-16",
            canonStatus: "canon",
            sourceRole: "user",
            sourceMessageId: userMessage.id,
          });

        expectCode(
          () =>
            store.addStoryBibleFact({
              ownerKey: ownerA,
              projectId: projectA.id,
              subjectEntityId: paul.id,
              predicate: "exact_age",
              valueText: "14",
              canonStatus: "canon",
              sourceRole: "user",
              sourceMessageId:
                userMessage.id,
              supersedesFactId:
                ageWindow.id,
            }),
          "STORY_BIBLE_REVISION_SCOPE_MISMATCH",
        );

        const finalCurrent =
          store.listStoryBibleFacts({
            ownerKey: ownerA,
            projectId: projectA.id,
          });

        const finalHistory =
          store.listStoryBibleFacts({
            ownerKey: ownerA,
            projectId: projectA.id,
            includeSuperseded: true,
          });

        expect(finalCurrent).toHaveLength(5);
        expect(finalHistory).toHaveLength(6);

        expect(
          store.listStoryBibleEntities({
            ownerKey: ownerA,
            projectId: projectA.id,
          }),
        ).toHaveLength(1);

        const tempDb = path.join(
          tempRoot,
          "story-creator",
          "story-creator.sqlite",
        );

        expect(
          fs.existsSync(tempDb),
        ).toBe(true);


        const raw = new Database(tempDb);

        try {
          expect(() =>
            raw
              .prepare(`
                INSERT INTO story_facts (
                  id,
                  project_id,
                  owner_key,
                  predicate,
                  value_text,
                  canon_status,
                  source_role,
                  created_at,
                  updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `)
              .run(
                "direct-system-canon",
                projectA.id,
                ownerA,
                "direct_sql_system_canon",
                "must be blocked",
                "canon",
                "system",
                Date.now(),
                Date.now(),
              ),
          ).toThrow(
            /STORY_BIBLE_NON_USER_CANON_FORBIDDEN/,
          );
        } finally {
          raw.close();
        }
      },
    );
  },
);
