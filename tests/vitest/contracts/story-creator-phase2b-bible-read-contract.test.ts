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

const route = read(
  "app/api/story-creator/bible/route.ts",
);

const panel = read(
  "app/app/components/StoryCreatorPanel.tsx",
);

describe(
  "Story Creator Phase 2B Story Bible read contract",
  () => {
    it(
      "requires authenticated ownership for Story Bible reads",
      () => {
        expect(route).toContain(
          "requireSessionUser",
        );

        expect(route).toContain(
          "authenticatedOwnerKey",
        );

        expect(route).toContain(
          "SessionInvalidError",
        );

        expect(route).toContain(
          "? 401",
        );
      },
    );

    it(
      "exposes only the current entity and fact read path",
      () => {
        expect(route).toContain(
          "export async function GET",
        );

        expect(route).toContain(
          "listStoryBibleEntities",
        );

        expect(route).toContain(
          "listStoryBibleFacts",
        );

        expect(route).toContain(
          "includeSuperseded: false",
        );

        expect(route).not.toContain(
          "export async function POST",
        );

        expect(route).not.toContain(
          "export async function PATCH",
        );

        expect(route).not.toContain(
          "export async function DELETE",
        );
      },
    );

    it(
      "does not expose Story Bible write helpers through the API",
      () => {
        expect(route).not.toContain(
          "createStoryBibleEntity",
        );

        expect(route).not.toContain(
          "addStoryBibleFact",
        );
      },
    );

    it(
      "loads Story Bible records independently of Story Director chat",
      () => {
        expect(panel).toContain(
          "/api/story-creator/bible?projectId=",
        );

        expect(panel).toContain(
          "loadStoryBible",
        );

        expect(panel).toContain(
          "storyBibleEntities",
        );

        expect(panel).toContain(
          "storyBibleFacts",
        );

        expect(panel).toContain(
          "Array.isArray(data?.entities)",
        );

        expect(panel).toContain(
          "Array.isArray(data?.facts)",
        );
      },
    );

    it(
      "renders explicit canon suggestion and unknown sections",
      () => {
        expect(panel).toContain(
          '"Canon"',
        );

        expect(panel).toContain(
          '"Suggestions"',
        );

        expect(panel).toContain(
          '"Unknown"',
        );

        expect(panel).toContain(
          "storyBibleFactsByStatus.canon",
        );

        expect(panel).toContain(
          "storyBibleFactsByStatus.suggestion",
        );

        expect(panel).toContain(
          "storyBibleFactsByStatus.unknown",
        );
      },
    );

    it(
      "keeps the Phase 2B UI read only",
      () => {
        expect(panel).toContain(
          "Review only",
        );

        expect(
          panel.replace(/\s+/g, " "),
        ).toContain(
          "cannot promote them to canon",
        );

        expect(panel).not.toContain(
          "createStoryBibleEntity(",
        );

        expect(panel).not.toContain(
          "addStoryBibleFact(",
        );
      },
    );
  },
);
