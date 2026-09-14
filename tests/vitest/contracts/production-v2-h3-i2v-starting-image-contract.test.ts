import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  assertProductionV2H3StartingImage,
  type ProductionV2VisualReference,
} from "@/lib/production/v2";

function reference(
  patch: Partial<ProductionV2VisualReference> = {},
): ProductionV2VisualReference {
  return {
    id: "test-reference",
    name: "Test Reference",
    sourceKind: "asset",
    generationSourceType: "asset-default",
    workflowImage: "/workflow/test.png",
    ...patch,
  };
}

describe(
  "Production V2 H3 I2V Starting Image contract",
  () => {
    it(
      "accepts the saved Character Card but rejects a Character default image",
      () => {
        expect(
          () =>
            assertProductionV2H3StartingImage(
              reference({
                sourceKind: "character",
                generationSourceType:
                  "character-card",
              }),
            ),
        ).not.toThrow();

        expect(
          () =>
            assertProductionV2H3StartingImage(
              reference({
                sourceKind: "character",
                generationSourceType:
                  "asset-default",
              }),
            ),
        ).toThrow(
          /Character Card/,
        );
      },
    );

    it(
      "accepts Background Master and exact canonical directional plates",
      () => {
        expect(
          () =>
            assertProductionV2H3StartingImage(
              reference({
                sourceKind: "background",
                generationSourceType:
                  "background-master",
              }),
            ),
        ).not.toThrow();

        expect(
          () =>
            assertProductionV2H3StartingImage(
              reference({
                sourceKind: "background",
                generationSourceType:
                  "background-angle",
                perspectiveKey:
                  "left90",
              }),
            ),
        ).not.toThrow();
      },
    );

    it(
      "rejects malformed Background directional metadata",
      () => {
        expect(
          () =>
            assertProductionV2H3StartingImage(
              reference({
                sourceKind: "background",
                generationSourceType:
                  "background-angle",
              }),
            ),
        ).toThrow(
          /valid canonical perspective/,
        );

        expect(
          () =>
            assertProductionV2H3StartingImage(
              reference({
                sourceKind: "background",
                generationSourceType:
                  "background-master",
                perspectiveKey:
                  "front",
              }),
            ),
        ).toThrow(
          /Background Master/,
        );
      },
    );

    it(
      "keeps Assets on the saved default image contract",
      () => {
        expect(
          () =>
            assertProductionV2H3StartingImage(
              reference({
                sourceKind: "asset",
                generationSourceType:
                  "asset-default",
              }),
            ),
        ).not.toThrow();

        expect(
          () =>
            assertProductionV2H3StartingImage(
              reference({
                sourceKind: "asset",
                generationSourceType:
                  "asset-default",
                perspectiveKey:
                  "left",
              }),
            ),
        ).toThrow(
          /must not declare a perspective/,
        );
      },
    );

    it(
      "exposes Master plus canonical Background views in the H3 I2V picker while Assets remain Default-only",
      () => {
        const source =
          fs.readFileSync(
            path.join(
              process.cwd(),
              "app/app/components/ProductionV2Panel.tsx",
            ),
            "utf8",
          );

        expect(source).toContain(
          "OTG_PRODUCTION_V2_H3_I2V_BACKGROUND_CANDIDATES_V1",
        );

        expect(source).toContain(
          "backgroundStartingImageReferences",
        );

        expect(source).toContain(
          '"background-angle"',
        );

        expect(source).toContain(
          "perspective.key",
        );

        expect(source).toContain(
          'visualReference(\n          "asset",\n          item.id,\n          item.name,\n          item.defaultImage,',
        );
      },
    );

    it(
      "tracks the directional plate in the fingerprint and validates the Starting Image at both delivery boundaries",
      () => {
        const domain =
          fs.readFileSync(
            path.join(
              process.cwd(),
              "lib/production/v2.ts",
            ),
            "utf8",
          );

        const route =
          fs.readFileSync(
            path.join(
              process.cwd(),
              "app/api/production/v2/generation/route.ts",
            ),
            "utf8",
          );

        const scheduler =
          fs.readFileSync(
            path.join(
              process.cwd(),
              "lib/production/h3GenerationScheduler.ts",
            ),
            "utf8",
          );

        expect(domain).toContain(
          "startingImage?.perspectiveKey",
        );

        expect(route).toContain(
          "assertProductionV2H3StartingImage(",
        );

        expect(scheduler).toContain(
          "assertProductionV2H3StartingImage(",
        );
      },
    );
  },
);
