import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
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

const store = read(
  "lib/storyCreator/store.ts",
);

const turnRoute = read(
  "app/api/story-creator/turn/route.ts",
);

describe(
  "Story Creator Mature Language trusted turn contract",
  () => {
    it(
      "exposes an owner-scoped authoritative project getter",
      () => {
        expect(store).toContain(
          "export function getStoryCreatorProject",
        );

        expect(store).toContain(
          "return assertOwnedActiveProject(",
        );
      },
    );

    it(
      "does not allow the turn payload to forge Mature Language",
      () => {
        expect(turnRoute).toContain(
          '"matureLanguageEnabled",',
        );

        expect(turnRoute).toContain(
          "assertServerOwnedTurnFields",
        );
      },
    );

    it(
      "reads the stored project setting on the server",
      () => {
        expect(turnRoute).toContain(
          "getStoryCreatorProject",
        );

        expect(turnRoute).toContain(
          "project.matureLanguageEnabled",
        );
      },
    );

    it(
      "injects the language instruction as a server-owned system message",
      () => {
        expect(turnRoute).toContain(
          "STORY_CREATOR_MATURE_LANGUAGE_SYSTEM_MESSAGE",
        );

        expect(turnRoute).toContain(
          'role: "system"',
        );

        expect(turnRoute).toContain(
          "Strong language and profanity are allowed",
        );

        expect(turnRoute).toContain(
          "This setting applies only to language",
        );

        expect(turnRoute).toContain(
          "continuity and safety rules remain unchanged",
        );

        expect(turnRoute).toContain(
          "helperMessages.unshift",
        );
      },
    );
  },
);
