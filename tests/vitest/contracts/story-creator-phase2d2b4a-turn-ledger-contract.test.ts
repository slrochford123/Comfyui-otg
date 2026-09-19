import fs from "node:fs";
import path from "node:path";
import {
  describe,
  expect,
  it,
} from "vitest";

const source = fs.readFileSync(
  path.join(
    process.cwd(),
    "lib/storyCreator/store.ts",
  ),
  "utf8",
);

describe(
  "Story Creator 2D2B4A turn ledger contract",
  () => {
    it("uses a dedicated ledger", () => {
      expect(source).toContain(
        "CREATE TABLE IF NOT EXISTS story_turns",
      );
      expect(source).not.toContain(
        "ALTER TABLE story_messages",
      );
    });

    it("has a database unique turn key", () => {
      expect(source).toMatch(
        /UNIQUE\(\s*owner_key,\s*project_id,\s*client_turn_id\s*\)/,
      );
    });

    it("claims atomically", () => {
      const start = source.indexOf(
        "export function claimStoryCreatorTurn",
      );
      const end = source.indexOf(
        "export function saveStoryCreatorTurnAssistant",
        start,
      );
      const block = source.slice(start, end);

      expect(block).toContain(
        "write.immediate()",
      );
      expect(block).toContain(
        '"in_progress"',
      );
      expect(block).toContain(
        '"STORY_DIRECTOR_TURN_ID_CONFLICT"',
      );
    });

    it("keeps roles server-owned", () => {
      expect(source).toMatch(
        /claimStoryCreatorTurn[\s\S]*?role:\s*"user"/,
      );
      expect(source).toMatch(
        /saveStoryCreatorTurnAssistant[\s\S]*?role:\s*"assistant"/,
      );
    });

    it("models all stages", () => {
      for (
        const state of [
          "running",
          "assistant_saved",
          "completed",
          "failed",
        ]
      ) {
        expect(source).toContain(
          `"${state}"`,
        );
      }
    });

    it("enforces lease expiry", () => {
      expect(source).toContain(
        "assertStoryCreatorTurnLease",
      );
      expect(source).toContain(
        "turn.leaseExpiresAt <= now",
      );
      expect(source).toContain(
        '"STORY_DIRECTOR_TURN_LEASE_LOST"',
      );
    });

    it("has explicit transitions", () => {
      expect(source).toContain(
        "export function saveStoryCreatorTurnAssistant",
      );
      expect(source).toContain(
        "export function completeStoryCreatorTurn",
      );
      expect(source).toContain(
        "export function failStoryCreatorTurn",
      );
    });
  },
);
