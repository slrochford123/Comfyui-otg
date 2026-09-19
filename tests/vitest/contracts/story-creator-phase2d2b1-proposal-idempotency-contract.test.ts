import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const root = process.cwd();

const store = fs.readFileSync(
  path.join(
    root,
    "lib/storyCreator/store.ts",
  ),
  "utf8",
);

describe(
  "Story Creator Phase 2D2B1 proposal replay idempotency contract",
  () => {
    it(
      "adds explicit same-source-message replay protection",
      () => {
        expect(store).toContain(
          "STORY_BIBLE_PROPOSAL_REPLAY_IDEMPOTENCY_V1",
        );

        expect(store).toContain(
          "source_message_id = ?",
        );

        expect(store).toContain(
          "source_role = ?",
        );
      },
    );

    it(
      "normalizes and compares proposal identity fields",
      () => {
        expect(store).toContain(
          "entity_type = ? COLLATE NOCASE",
        );

        expect(store).toContain(
          "name = ? COLLATE NOCASE",
        );

        expect(store).toContain(
          "predicate = ? COLLATE NOCASE",
        );

        expect(store).toContain(
          "value_text = ?",
        );
      },
    );

    it(
      "validates source-message provenance before replay lookup",
      () => {
        const entityStart =
          store.indexOf(
            "export function proposeStoryBibleEntity",
          );

        const factStart =
          store.indexOf(
            "export function proposeStoryBibleFact",
          );

        expect(entityStart).toBeGreaterThan(-1);
        expect(factStart).toBeGreaterThan(
          entityStart,
        );

        const entityBody =
          store.slice(
            entityStart,
            factStart,
          );

        const factBody =
          store.slice(
            factStart,
          );

        expect(entityBody).toContain(
          "assertStoryBibleSourceMessage",
        );

        expect(factBody).toContain(
          "assertStoryBibleSourceMessage",
        );
      },
    );

    it(
      "does not grant revision or canon authority",
      () => {
        const factStart =
          store.indexOf(
            "export function proposeStoryBibleFact",
          );

        const factBody =
          store.slice(
            factStart,
          );

        expect(factBody).toContain(
          "STORY_BIBLE_PROPOSAL_CANON_FORBIDDEN",
        );

        expect(factBody).not.toContain(
          "supersedesFactId:",
        );
      },
    );
  },
);
