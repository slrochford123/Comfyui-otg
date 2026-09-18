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
  "Story Creator Phase 2A Story Bible store contract",
  () => {
    it(
      "adds durable entity and fact tables",
      () => {
        expect(store).toContain(
          "CREATE TABLE IF NOT EXISTS story_entities",
        );

        expect(store).toContain(
          "CREATE TABLE IF NOT EXISTS story_facts",
        );

        expect(store).toContain(
          "idx_story_entities_project_name",
        );

        expect(store).toContain(
          "idx_story_facts_project_status",
        );
      },
    );

    it(
      "models canon suggestion and unknown explicitly",
      () => {
        expect(store).toContain(
          'export type StoryBibleFactStatus =',
        );

        expect(store).toContain(
          '| "canon"',
        );

        expect(store).toContain(
          '| "suggestion"',
        );

        expect(store).toContain(
          '| "unknown"',
        );

        expect(store).toContain(
          "CHECK(canon_status IN ('canon', 'suggestion', 'unknown'))",
        );
      },
    );

    it(
      "stores provenance and source-message linkage",
      () => {
        expect(store).toContain(
          "source_role TEXT NOT NULL",
        );

        expect(store).toContain(
          "source_message_id TEXT",
        );

        expect(store).toContain(
          "REFERENCES story_messages(id)",
        );

        expect(store).toContain(
          "STORY_BIBLE_SOURCE_ROLE_MISMATCH",
        );
      },
    );

    it(
      "prevents assistant suggestions from silently becoming canon",
      () => {
        expect(store).toContain(
          "source_role = 'assistant'",
        );

        expect(store).toContain(
          "canon_status = 'canon'",
        );

        expect(store).toContain(
          "STORY_BIBLE_ASSISTANT_CANON_FORBIDDEN",
        );

        expect(store).toContain(
          "cannot become canon without user adoption",
        );
      },
    );

    it(
      "preserves fact history through append-only supersession",
      () => {
        expect(store).toContain(
          "supersedes_fact_id TEXT",
        );

        expect(store).toContain(
          "REFERENCES story_facts(id)",
        );

        expect(store).toContain(
          "STORY_BIBLE_FACT_ALREADY_SUPERSEDED",
        );

        expect(store).toContain(
          "STORY_BIBLE_REVISION_SCOPE_MISMATCH",
        );

        expect(store).toContain(
          "includeSuperseded?: boolean",
        );
      },
    );

    it(
      "keeps Story Bible ownership scoped to the Story project",
      () => {
        expect(store).toContain(
          "assertOwnedActiveProject(",
        );

        expect(store).toContain(
          "assertOwnedStoryBibleEntity",
        );

        expect(store).toContain(
          "assertOwnedStoryBibleFact",
        );

        expect(store).toContain(
          "project_id = ?",
        );

        expect(store).toContain(
          "owner_key = ?",
        );
      },
    );

    it(
      "exposes entity and fact store operations without changing chat",
      () => {
        expect(store).toContain(
          "export function listStoryBibleEntities(",
        );

        expect(store).toContain(
          "export function createStoryBibleEntity(",
        );

        expect(store).toContain(
          "export function listStoryBibleFacts(",
        );

        expect(store).toContain(
          "export function addStoryBibleFact(",
        );
      },
    );
  },
);
