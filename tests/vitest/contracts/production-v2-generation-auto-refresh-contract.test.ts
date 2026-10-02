import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const panel =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "app/app/components/ProductionV2Panel.tsx",
    ),
    "utf8",
  );

describe(
  "Production V2 automatic completed-generation refresh",
  () => {
    it(
      "polls the exact submitted job when its id is known",
      () => {
        expect(
          panel,
        ).toContain(
          'const trackedJobId = generationJob?.id || "";',
        );

        expect(
          panel,
        ).toContain(
          "jobId=${encodeURIComponent(trackedJobId)}",
        );
      },
    );

    it(
      "waits until the completed job media version is persisted",
      () => {
        expect(
          panel,
        ).toContain(
          "async function loadCompletedGeneration(jobId: string)",
        );

        expect(
          panel,
        ).toContain(
          "const completedMediaId = `media-${jobId}`;",
        );

        expect(
          panel,
        ).toContain(
          "version.metadata?.generationJobId === jobId",
        );

        expect(
          panel,
        ).toContain(
          "The finished video loaded automatically.",
        );
      },
    );

    it(
      "retries transient status and media synchronization failures",
      () => {
        expect(
          panel.match(
            /timer = setTimeout\(poll, 3_000\);/g,
          )?.length,
        ).toBeGreaterThanOrEqual(
          2,
        );

        expect(
          panel,
        ).toContain(
          "Waiting for the finished video to become available...",
        );
      },
    );
  },
);
