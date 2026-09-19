import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(
    path.join(
      root,
      relativePath,
    ),
    "utf8",
  );
}

const panel = read(
  "app/app/components/StoryCreatorPanel.tsx",
);

const messagesRoute = read(
  "app/api/story-creator/messages/route.ts",
);

const turnRoute = read(
  "app/api/story-creator/turn/route.ts",
);

describe(
  "Story Creator Phase 2D2A trusted Story Director turn contract",
  () => {
    it(
      "adds an authenticated server-owned turn route",
      () => {
        expect(turnRoute).toContain(
          "requireSessionUser",
        );

        expect(turnRoute).toContain(
          "assertServerOwnedTurnFields",
        );

        expect(turnRoute).toContain(
          "STORY_DIRECTOR_TURN_SERVER_FIELDS_FORBIDDEN",
        );
      },
    );

    it(
      "reuses the accepted Story Helper handler in-process",
      () => {
        expect(turnRoute).toContain(
          "POST as runStoryHelperChat",
        );

        expect(turnRoute).toContain(
          "await runStoryHelperChat",
        );

        expect(turnRoute).toContain(
          '"x-otg-ai-assistance-profile"',
        );

        expect(turnRoute).toContain(
          '"story-helper"',
        );
      },
    );

    it(
      "assigns user and assistant roles on the server",
      () => {
        expect(turnRoute).toContain(
          'role: "user"',
        );

        expect(turnRoute).toContain(
          'role: "assistant"',
        );

        expect(turnRoute).toContain(
          "listStoryCreatorMessages",
        );
      },
    );

    it(
      "prevents generic browser message POST from manufacturing assistant provenance",
      () => {
        expect(messagesRoute).toContain(
          "STORY_MESSAGE_ASSISTANT_ROLE_CLIENT_FORBIDDEN",
        );

        expect(messagesRoute).toContain(
          'role: "user"',
        );

        expect(messagesRoute).not.toContain(
          "role: body?.role",
        );
      },
    );

    it(
      "moves Story Creator send flow onto trusted turn route",
      () => {
        const start =
          panel.indexOf(
            "async function sendStoryMessage()",
          );

        const end =
          panel.indexOf(
            "if (selectedProject)",
            start,
          );

        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);

        const sendFlow =
          panel.slice(
            start,
            end,
          );

        expect(sendFlow).toContain(
          '"/api/story-creator/turn"',
        );

        expect(sendFlow).not.toContain(
          "await persistMessage(",
        );

        expect(sendFlow).not.toContain(
          'fetch(\n          "/api/ollama-ai/chat"',
        );
      },
    );

    it(
      "removes obsolete browser AI parsing and persistence helpers",
      () => {
        expect(panel).not.toContain(
          "function assistantText(",
        );

        expect(panel).not.toContain(
          "async function persistMessage(",
        );
      },
    );

    it(
      "does not enable Story Bible extraction yet",
      () => {
        expect(turnRoute).not.toContain(
          "proposeStoryBibleEntity",
        );

        expect(turnRoute).not.toContain(
          "proposeStoryBibleFact",
        );

        expect(turnRoute).not.toContain(
          "/api/story-creator/bible/write",
        );
      },
    );

    it(
      "keeps the trusted turn route importable",
      async () => {
        const previousAuthSecret =
          process.env.AUTH_SECRET;

        process.env.AUTH_SECRET =
          previousAuthSecret ||
          "phase2d2a-vitest-only-secret";

        try {
          vi.resetModules();

          const module =
            await import(
              "../../../app/api/story-creator/turn/route"
            );

          expect(
            typeof module.POST,
          ).toBe("function");
        } finally {
          if (
            previousAuthSecret ===
            undefined
          ) {
            delete process.env.AUTH_SECRET;
          } else {
            process.env.AUTH_SECRET =
              previousAuthSecret;
          }
        }
      },
    );
  },
);
