import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const source =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "lib/storyCreator/extractionModel.ts",
    ),
    "utf8",
  );

describe(
  "Story Creator Phase 2D2B2B extraction model contract",
  () => {
    it(
      "uses the accepted durable Qwen transport",
      () => {
        expect(source).toContain(
          'from "@/lib/workers/qwenDurableFetch"',
        );

        expect(source).toContain(
          '"/api/generate"',
        );

        expect(source).toContain(
          '"qwen3.5:4b"',
        );

        expect(source).toContain(
          'requestKind:',
        );

        expect(source).toContain(
          '"story-bible-extraction"',
        );
      },
    );

    it(
      "requests deterministic non-thinking extraction",
      () => {
        expect(source).toContain(
          "temperature: 0.0",
        );

        expect(source).toContain(
          "think: false",
        );

        expect(source).toContain(
          "stream: false",
        );
      },
    );

    it(
      "shares the sealed parser schema and parser",
      () => {
        expect(source).toContain(
          "STORY_BIBLE_EXTRACTION_SCHEMA_TEXT",
        );

        expect(source).toContain(
          "parseStoryBibleExtractionText",
        );
      },
    );

    it(
      "forbids Canon in the extraction prompt",
      () => {
        expect(source).toContain(
          "Do not promote anything to Canon.",
        );

        expect(source).toContain(
          "canonStatus may ONLY be suggestion or unknown.",
        );
      },
    );

    it(
      "passes only server-known existing entity ids into the parser allowlist",
      () => {
        expect(source).toContain(
          "knownEntityIds:",
        );

        expect(source).toContain(
          "knownEntities.map",
        );
      },
    );

    it(
      "has no Story Bible write dependency",
      () => {
        expect(source).not.toContain(
          "proposeStoryBibleEntity",
        );

        expect(source).not.toContain(
          "proposeStoryBibleFact",
        );

        expect(source).not.toContain(
          "createStoryBibleEntity",
        );

        expect(source).not.toContain(
          "addStoryBibleFact",
        );

        expect(source).not.toContain(
          "better-sqlite3",
        );
      },
    );

    it(
      "is not an HTTP route",
      () => {
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
