import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  PRODUCTION_V2_MAX_SCENES,
  normalizeProductionV2DurationForModel,
  productionV2DurationsForModel,
  productionV2ModesForModel,
} from "@/lib/production/v2";

const v2Source =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "lib/production/v2.ts",
    ),
    "utf8",
  );

const panelSource =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "app/app/components/ProductionV2Panel.tsx",
    ),
    "utf8",
  );

describe(
  "Production V2 storyboard scene setup",
  () => {
    it(
      "limits a production to eight scenes",
      () => {
        expect(
          PRODUCTION_V2_MAX_SCENES,
        ).toBe(
          8,
        );
      },
    );

    it(
      "exposes only qualified modes for each model",
      () => {
        expect(
          productionV2ModesForModel(
            "minimax-h3",
          ),
        ).toEqual([
          "h3-text-to-video",
          "h3-image-to-video",
          "h3-reference-to-video",
        ]);

        expect(
          productionV2ModesForModel(
            "ltx-2.5",
          ),
        ).toEqual([
          "ltx-ingredients-image-to-video",
        ]);
      },
    );

    it(
      "uses model-specific production durations",
      () => {
        expect(
          productionV2DurationsForModel(
            "minimax-h3",
          ),
        ).toEqual([
          5,
          10,
        ]);

        expect(
          productionV2DurationsForModel(
            "ltx-2.5",
          ),
        ).toEqual([
          5,
          10,
        ]);
      },
    );

    it(
      "normalizes persisted durations to each model qualified duration set",
      () => {
        expect(
          normalizeProductionV2DurationForModel(
            "minimax-h3",
            15,
          ),
        ).toBe(
          10,
        );

        expect(
          normalizeProductionV2DurationForModel(
            "ltx-2.5",
            15,
          ),
        ).toBe(
          10,
        );
        expect(
          normalizeProductionV2DurationForModel(
            "ltx-2.5",
            10,
          ),
        ).toBe(
          10,
        );
      },
    );

    it(
      "applies duration normalization when the scene model changes",
      () => {
        expect(
          v2Source,
        ).toContain(
          "OTG_PRODUCTION_V2_MODEL_AWARE_DURATION_POLICY_V1",
        );

        expect(
          v2Source,
        ).toContain(
          "const durationSeconds = normalizeProductionV2DurationForModel(",
        );
      },
    );

    it(
      "renders only durations valid for the selected scene model",
      () => {
        expect(
          panelSource,
        ).toContain(
          "productionV2DurationsForModel(selectedScene.model).map",
        );

        expect(
          panelSource,
        ).not.toContain(
          "PRODUCTION_V2_DURATION_OPTIONS.map",
        );
      },
    );
  },
);
