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

describe(
  "Android H3 staged upload contract",
  () => {
    it(
      "uploads Android H3 media in small authenticated chunks before generation submit",
      () => {
        const panel =
          read(
            "app/app/components/H3Panel.tsx",
          );

        expect(
          panel,
        ).toContain(
          "isAndroidUploadRuntime",
        );

        expect(
          panel,
        ).toContain(
          "H3_STAGED_UPLOAD_CHUNK_BYTES",
        );

        expect(
          panel,
        ).toContain(
          "file.slice(",
        );

        expect(
          panel,
        ).toContain(
          '"/api/h3/generation/upload"',
        );

        expect(
          panel,
        ).toContain(
          'credentials: "include"',
        );

        expect(
          panel,
        ).toContain(
          '"chunkIndex"',
        );

        expect(
          panel,
        ).toContain(
          '"chunkCount"',
        );

        expect(
          panel,
        ).toContain(
          "staged: await uploadH3StagedReferences()",
        );
      },
    );

    it(
      "keeps staged H3 uploads owner scoped and bounded on disk",
      () => {
        const route =
          read(
            "app/api/h3/generation/upload/route.ts",
          );

        const helper =
          read(
            "lib/h3StagedUploads.ts",
          );

        expect(
          route,
        ).toContain(
          "getOwnerContext",
        );

        expect(
          route,
        ).toContain(
          "request.formData()",
        );

        expect(
          route,
        ).toContain(
          "MAX_STAGED_H3_CHUNK_BYTES",
        );

        expect(
          route,
        ).toContain(
          "assembleChunks",
        );

        expect(
          helper,
        ).toContain(
          'OTG_DATA_ROOT,\n      "h3-direct"',
        );

        expect(
          helper,
        ).toContain(
          '"staged"',
        );

        expect(
          helper,
        ).toContain(
          "safeJoin",
        );

        expect(
          helper,
        ).toContain(
          "MAX_STAGED_H3_UPLOAD_BYTES",
        );

        expect(
          helper,
        ).toContain(
          "H3_STAGED_UPLOAD_TTL_MS",
        );
      },
    );

    it(
      "submits staged media through the existing H3 generation validation path",
      () => {
        const generation =
          read(
            "app/api/h3/generation/route.ts",
          );

        expect(
          generation,
        ).toContain(
          "readCompletedH3StagedUpload",
        );

        expect(
          generation,
        ).toContain(
          "stagedMedia",
        );

        expect(
          generation,
        ).toContain(
          "startGenerationJob",
        );

        expect(
          generation,
        ).toContain(
          "saveMediaBytes",
        );

        expect(
          generation,
        ).toContain(
          "trimH3ReferenceVideoClip",
        );

        expect(
          generation,
        ).toContain(
          "validateH3DirectInput",
        );
      },
    );
  },
);
