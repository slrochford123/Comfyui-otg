import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const ROOT = process.cwd();

function source(relative: string) {
  return fs.readFileSync(
    path.join(ROOT, relative),
    "utf8",
  );
}

describe(
  "Production V2 LTX 2.5 Ingredients API integration contract",
  () => {
    it(
      "locks the real canonical Ingredients manifest into the reviewed final prompt",
      () => {
        const prompt =
          source(
            "lib/production/promptBuilder.ts",
          );

        expect(prompt).toContain(
          "buildLtx25IngredientsManifest",
        );

        expect(prompt).toContain(
          "buildLtx25IngredientsLockedContext",
        );

        expect(prompt).toContain(
          "composeProductionV2FinalPrompt(",
        );

        expect(prompt).toContain(
          "lockedReferenceContext,",
        );

        expect(prompt).not.toContain(
          "INGREDIENTS SHEET MAP:",
        );
      },
    );

    it(
      "routes LTX jobs through the durable LTX scheduler without changing the H3 route contract",
      () => {
        const route =
          source(
            "app/api/production/v2/generation/route.ts",
          );

        expect(route).toContain(
          "createProductionV2Ltx25GenerationJob",
        );

        expect(route).toContain(
          "getLatestProductionV2Ltx25SceneGeneration",
        );

        expect(route).toContain(
          "startProductionV2Ltx25Scheduler",
        );

        expect(route).toContain(
          "runProductionV2Ltx25SchedulerTick",
        );

        expect(route).toContain(
          "reconcileProductionV2Ltx25GenerationJob",
        );

        expect(route).toContain(
          'scene.durationSeconds !== 5',
        );

        expect(route).toContain(
          "startProductionV2H3Scheduler",
        );

        expect(route).toContain(
          "requestProductionV2H3SchedulerTick",
        );
      },
    );

    it(
      "persists completed LTX output as ordinary Production V2 generated media",
      () => {
        const v2 =
          source(
            "lib/production/v2.ts",
          );

        const result =
          source(
            "lib/production/ltx25IngredientsProduction.ts",
          );

        expect(v2).toContain(
          "model?: ProductionV2Model;",
        );

        expect(v2).toContain(
          "mode?: ProductionV2GenerationMode;",
        );

        expect(v2).toContain(
          'value.model === "ltx-2.5"',
        );

        expect(v2).toContain(
          'value.mode === "ltx-ingredients-image-to-video"',
        );

        expect(result).toContain(
          "appendProductionV2SceneMediaVersion",
        );

        expect(result).toContain(
          "appendProductionV2GenerationAttempt",
        );

        expect(result).toContain(
          "syncProductionV2AssemblyClips",
        );

        expect(result).toContain(
          'model: "ltx-2.5"',
        );

        expect(result).toContain(
          '"ltx-ingredients-image-to-video"',
        );
      },
    );
  },
);
