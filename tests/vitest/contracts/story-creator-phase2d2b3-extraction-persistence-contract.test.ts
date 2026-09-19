import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const root =
  process.cwd();

function read(
  relativePath: string,
) {
  return fs.readFileSync(
    path.join(
      root,
      relativePath,
    ),
    "utf8",
  );
}

const route =
  read(
    "app/api/story-creator/turn/route.ts",
  );

const persistence =
  read(
    "lib/storyCreator/extractionPersistence.ts",
  );

describe(
  "Story Creator Phase 2D2B3 extraction persistence contract",
  () => {
    it(
      "runs extraction after trusted assistant persistence",
      () => {
        const assistant =
          route.indexOf(
            "const assistantMessage =",
          );

        const extraction =
          route.indexOf(
            "await extractAndPersistStoryBibleProposals",
          );

        const response =
          route.indexOf(
            "return NextResponse.json(",
            extraction,
          );

        expect(
          assistant,
        ).toBeGreaterThan(-1);

        expect(
          extraction,
        ).toBeGreaterThan(
          assistant,
        );

        expect(
          response,
        ).toBeGreaterThan(
          extraction,
        );
      },
    );

    it(
      "keeps successful chat durable when extraction fails",
      () => {
        expect(route).toContain(
          "STORY_BIBLE_POST_ASSISTANT_EXTRACTION_V1",
        );

        expect(route).toContain(
          '"failed" as const',
        );

        expect(route).toContain(
          "storyBibleExtraction,",
        );

        expect(route).toContain(
          "status: 201",
        );
      },
    );

    it(
      "attributes proposals to the persisted assistant",
      () => {
        expect(
          persistence,
        ).toMatch(
          /sourceRole:\s*"assistant"/,
        );

        expect(
          persistence,
        ).toContain(
          "input.assistantMessage.id",
        );
      },
    );

    it(
      "allows only suggestion and unknown facts",
      () => {
        expect(
          persistence,
        ).toContain(
          'fact.canonStatus !==',
        );

        expect(
          persistence,
        ).toContain(
          '"suggestion"',
        );

        expect(
          persistence,
        ).toContain(
          '"unknown"',
        );
      },
    );

    it(
      "reuses exactly one matching existing entity",
      () => {
        expect(
          persistence,
        ).toContain(
          "normalizedEntityIdentity",
        );

        expect(
          persistence,
        ).toContain(
          "matches.length === 1",
        );

        expect(
          persistence,
        ).toContain(
          "reusedExistingEntities",
        );
      },
    );

    it(
      "does not silently resolve ambiguous identities",
      () => {
        expect(
          persistence,
        ).toContain(
          "matches.length > 1",
        );

        expect(
          persistence,
        ).toContain(
          "ambiguousEntities",
        );
      },
    );

    it(
      "keeps proposals off the public HTTP surface",
      () => {
        expect(
          fs.existsSync(
            path.join(
              root,
              "app/api/story-creator/bible/propose/route.ts",
            ),
          ),
        ).toBe(false);
      },
    );
  },
);
