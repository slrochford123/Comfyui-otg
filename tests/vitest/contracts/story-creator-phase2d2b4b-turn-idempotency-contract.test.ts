import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const root =
  process.cwd();

const route =
  fs.readFileSync(
    path.join(
      root,
      "app/api/story-creator/turn/route.ts",
    ),
    "utf8",
  );

const panel =
  fs.readFileSync(
    path.join(
      root,
      "app/app/components/StoryCreatorPanel.tsx",
    ),
    "utf8",
  );

const messagesRoute =
  fs.readFileSync(
    path.join(
      root,
      "app/api/story-creator/messages/route.ts",
    ),
    "utf8",
  );

describe(
  "Story Creator Phase 2D2B4B trusted turn idempotency contract",
  () => {
    it("uses the durable ledger", () => {
      expect(route).toContain(
        "claimStoryCreatorTurn",
      );
      expect(route).toContain(
        "saveStoryCreatorTurnAssistant",
      );
      expect(route).toContain(
        "completeStoryCreatorTurn",
      );
      expect(route).toContain(
        "failStoryCreatorTurn",
      );
      expect(route).not.toContain(
        "addStoryCreatorMessage",
      );
    });

    it("keeps turn authority server-owned", () => {
      expect(route).toContain(
        '"clientTurnId"',
      );
      expect(route).toContain(
        '"leaseToken"',
      );
      expect(route).toContain(
        '"leaseExpiresAt"',
      );
      expect(route).toContain(
        "STORY_DIRECTOR_TURN_SERVER_FIELDS_FORBIDDEN",
      );
    });

    it("handles replay before helper", () => {
      const completed =
        route.indexOf(
          'claim.action === "completed"',
        );

      const helper =
        route.indexOf(
          "await runStoryHelperChat",
        );

      expect(completed).toBeGreaterThan(
        -1,
      );

      expect(helper).toBeGreaterThan(
        completed,
      );

      expect(route).toContain(
        "STORY_DIRECTOR_TURN_IN_PROGRESS",
      );
    });

    it("uses failure and assistant transitions", () => {
      expect(route).toContain(
        "failStoryCreatorTurn({",
      );
      expect(route).toContain(
        "saveStoryCreatorTurnAssistant({",
      );
      expect(route).toContain(
        "STORY_DIRECTOR_AI_FAILED",
      );
      expect(route).toContain(
        "STORY_DIRECTOR_EMPTY_RESPONSE",
      );
    });

    it("completes after extraction", () => {
      const extraction =
        route.indexOf(
          "await extractAndPersistStoryBibleProposals",
        );

      const completion =
        route.indexOf(
          "completeStoryCreatorTurn({",
        );

      expect(completion).toBeGreaterThan(
        extraction,
      );

      expect(route).toContain(
        '"resume_assistant"',
      );
    });

    it("creates persistent browser turn IDs", () => {
      expect(panel).toContain(
        "STORY_CREATOR_PENDING_TURN_V1",
      );
      expect(panel).toContain(
        'typeof cryptoApi.randomUUID === "function"',
      );

      expect(panel).toContain(
        "cryptoApi.randomUUID()",
      );

      expect(panel).toContain(
        'typeof cryptoApi.getRandomValues !== "function"',
      );

      expect(panel).toContain(
        "cryptoApi.getRandomValues",
      );

      expect(panel).toContain(
        "(bytes[6] & 0x0f) | 0x40",
      );

      expect(panel).toContain(
        "(bytes[8] & 0x3f) | 0x80",
      );
      expect(panel).toContain(
        "window.sessionStorage.setItem",
      );
      expect(panel).toContain(
        "pendingTurn.clientTurnId",
      );
    });

    it("keeps legacy send lock and dedupe merge", () => {
      expect(panel).toContain(
        "storySendLockRef.current = true;",
      );
      expect(panel).toContain(
        "storySendLockRef.current = false;",
      );
      expect(panel).toContain(
        "mergeStoryMessages(",
      );
    });

    it("keeps generic POST user-only", () => {
      expect(
        messagesRoute,
      ).toContain(
        "STORY_MESSAGE_ASSISTANT_ROLE_CLIENT_FORBIDDEN",
      );

      expect(
        fs.existsSync(
          path.join(
            root,
            "app/api/story-creator/bible/propose/route.ts",
          ),
        ),
      ).toBe(false);
    });
  },
);
