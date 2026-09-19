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
    path.join(root, relativePath),
    "utf8",
  );
}

const store = read(
  "lib/storyCreator/store.ts",
);

const writeRoute = read(
  "app/api/story-creator/bible/write/route.ts",
);

const messageRoute = read(
  "app/api/story-creator/messages/route.ts",
);

describe(
  "Story Creator Phase 2D1 guarded proposal store contract",
  () => {
    it(
      "adds internal proposal-capable store functions",
      () => {
        expect(store).toContain(
          "export function proposeStoryBibleEntity",
        );

        expect(store).toContain(
          "export function proposeStoryBibleFact",
        );

        expect(store).toContain(
          "assertStoryBibleProposalProvenance",
        );
      },
    );

    it(
      "permits only assistant or system proposal provenance",
      () => {
        expect(store).toContain(
          "STORY_BIBLE_PROPOSAL_SOURCE_ROLE_FORBIDDEN",
        );

        expect(store).toContain(
          'input.sourceRole === "user"',
        );

        expect(store).toContain(
          "STORY_BIBLE_PROPOSAL_SOURCE_MESSAGE_REQUIRED",
        );

        expect(store).toContain(
          'input.sourceRole === "assistant"',
        );
      },
    );

    it(
      "forbids canon through the proposal fact path",
      () => {
        expect(store).toContain(
          "STORY_BIBLE_PROPOSAL_CANON_FORBIDDEN",
        );

        expect(store).toContain(
          'if (canonStatus === "canon")',
        );

        expect(store).toContain(
          "Story Bible proposals may only be suggestions or unknowns.",
        );
      },
    );

    it(
      "does not expose revision authority through proposals",
      () => {
        const proposalStart =
          store.indexOf(
            "export function proposeStoryBibleFact",
          );

        expect(proposalStart).toBeGreaterThan(-1);

        const proposalBlock =
          store.slice(proposalStart);

        expect(proposalBlock).not.toContain(
          "supersedesFactId",
        );
      },
    );

    it(
      "does not create a browser-facing proposal endpoint",
      () => {
        expect(
          fs.existsSync(
            path.join(
              root,
              "app/api/story-creator/bible/propose/route.ts",
            ),
          ),
        ).toBe(false);

        expect(writeRoute).not.toContain(
          "proposeStoryBibleEntity",
        );

        expect(writeRoute).not.toContain(
          "proposeStoryBibleFact",
        );

        expect(messageRoute).not.toContain(
          "proposeStoryBibleEntity",
        );

        expect(messageRoute).not.toContain(
          "proposeStoryBibleFact",
        );
      },
    );

    it(
      "preserves the accepted manual user writer",
      () => {
        expect(writeRoute).toContain(
          'sourceRole: "user"',
        );

        expect(writeRoute).toContain(
          '"create-entity"',
        );

        expect(writeRoute).toContain(
          '"add-fact"',
        );
      },
    );
  },
);
