import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const root = process.cwd();

const source =
  fs.readFileSync(
    path.join(
      root,
      "lib/storyCreator/extraction.ts",
    ),
    "utf8",
  );

describe(
  "Story Creator Phase 2D2B2A pure extraction parser contract",
  () => {
    it(
      "defines entities and facts as the structured extraction shape",
      () => {
        expect(source).toContain(
          "STORY_BIBLE_EXTRACTION_SCHEMA_TEXT",
        );

        expect(source).toContain(
          "StoryBibleExtractionEntity",
        );

        expect(source).toContain(
          "StoryBibleExtractionFact",
        );

        expect(source).toContain(
          'canonStatus": "suggestion|unknown"',
        );
      },
    );

    it(
      "enforces the advertised Story Bible entity type enum",
      () => {
        expect(source).toContain(
          "STORY_BIBLE_EXTRACTION_ENTITY_TYPES",
        );

        for (
          const entityType of [
            "character",
            "location",
            "object",
            "power",
            "other",
          ]
        ) {
          expect(source).toContain(
            `"${entityType}"`,
          );
        }

        expect(source).toContain(
          "extractionEntityType(",
        );
      },
    );

    it(
      "does not grant Canon authority to extraction",
      () => {
        expect(source).toContain(
          'cleaned === "suggestion"',
        );

        expect(source).toContain(
          'cleaned === "unknown"',
        );

        expect(source).not.toContain(
          'cleaned === "canon"',
        );
      },
    );

    it(
      "supports local refs and allowlisted existing entity ids",
      () => {
        expect(source).toContain(
          "knownEntityIds?: Iterable<string>",
        );

        expect(source).toContain(
          "localRefs",
        );

        expect(source).toContain(
          "knownEntityIds.has(",
        );
      },
    );

    it(
      "uses exact fence normalization without scraping JSON from arbitrary prose",
      () => {
        expect(source).toContain(
          "function normalizeExtractionEnvelope",
        );

        expect(source).toContain(
          "text.match(",
        );

        expect(source).toContain(
          'text.includes("```")',
        );

        expect(source).not.toContain(
          'indexOf("{")',
        );

        expect(source).not.toContain(
          'lastIndexOf("}")',
        );
      },
    );

    it(
      "enforces bounded extraction input and field sizes",
      () => {
        expect(source).toContain(
          "rawText: 200_000",
        );

        expect(source).toContain(
          "entities: 24",
        );

        expect(source).toContain(
          "facts: 48",
        );

        expect(source).toContain(
          "entityType: 80",
        );

        expect(source).toContain(
          "entityName: 160",
        );

        expect(source).toContain(
          "predicate: 160",
        );

        expect(source).toContain(
          "valueText: 100_000",
        );
      },
    );

    it(
      "has no network, route, sqlite, or Story Bible proposal dependency",
      () => {
        expect(source).not.toContain(
          "qwenDurableFetch",
        );

        expect(source).not.toContain(
          "proposeStoryBibleEntity",
        );

        expect(source).not.toContain(
          "proposeStoryBibleFact",
        );

        expect(source).not.toContain(
          "better-sqlite3",
        );

        expect(source).not.toContain(
          "NextRequest",
        );

        expect(source).not.toContain(
          "NextResponse",
        );
      },
    );
  },
);
