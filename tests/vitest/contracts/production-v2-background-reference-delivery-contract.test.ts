import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  assertProductionV2BackgroundVisualReference,
  type ProductionV2VisualReference,
} from "@/lib/production/v2";

function backgroundReference(
  patch: Partial<ProductionV2VisualReference> = {},
): ProductionV2VisualReference {
  return {
    id: "background:bg:canonical",
    name: "Test Background",
    sourceKind: "background",
    sourceId: "bg",
    generationSourceType:
      "background-master",
    workflowImage:
      "/workflow/background.png",
    ...patch,
  };
}

describe(
  "Production V2 Background reference delivery",
  () => {
    it(
      "accepts a Master Background with no perspective key",
      () => {
        expect(
          () =>
            assertProductionV2BackgroundVisualReference(
              backgroundReference(),
            ),
        ).not.toThrow();
      },
    );

    it(
      "accepts an exact canonical directional Background",
      () => {
        expect(
          () =>
            assertProductionV2BackgroundVisualReference(
              backgroundReference({
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
      "rejects a Master Background that claims a direction",
      () => {
        expect(
          () =>
            assertProductionV2BackgroundVisualReference(
              backgroundReference({
                perspectiveKey:
                  "left90",
              }),
            ),
        ).toThrow(
          /Background Master/,
        );
      },
    );

    it(
      "rejects a directional Background without a canonical direction",
      () => {
        expect(
          () =>
            assertProductionV2BackgroundVisualReference(
              backgroundReference({
                generationSourceType:
                  "background-angle",
              }),
            ),
        ).toThrow(
          /valid canonical perspective/,
        );

        expect(
          () =>
            assertProductionV2BackgroundVisualReference(
              backgroundReference({
                generationSourceType:
                  "background-angle",
                perspectiveKey:
                  "diagonal",
              }),
            ),
        ).toThrow(
          /valid canonical perspective/,
        );
      },
    );

    it(
      "exposes the view control and routes changes through the scene invalidation path",
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
          "OTG_PRODUCTION_V2_BACKGROUND_REFERENCE_VIEW_UI_V1",
        );

        expect(source).toContain(
          'data-otg="production-v2-background-reference-view"',
        );

        expect(source).toContain(
          "PRODUCTION_V2_BACKGROUND_REFERENCE_VIEWS.map",
        );

        expect(source).toContain(
          'referenceView: "master"',
        );

        const start =
          source.indexOf(
            "function changeBackgroundReferenceView",
          );

        const end =
          source.indexOf(
            "function toggleAsset",
            start,
          );

        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);

        const handler =
          source.slice(
            start,
            end,
          );

        expect(handler).toContain(
          "updateSharedSceneInput",
        );

        expect(handler).toContain(
          "true,",
        );
      },
    );

    it(
      "validates Background reference metadata at the API and H3 workflow boundaries",
      () => {
        const route =
          fs.readFileSync(
            path.join(
              process.cwd(),
              "app/api/production/v2/generation/route.ts",
            ),
            "utf8",
          );

        const workflow =
          fs.readFileSync(
            path.join(
              process.cwd(),
              "lib/production/h3Workflows.ts",
            ),
            "utf8",
          );

        expect(route).toMatch(
          /assertProductionV2BackgroundVisualReference\s*\(\s*reference,?\s*\)/,
        );

        expect(workflow).toMatch(
          /assertProductionV2BackgroundVisualReference\s*\(\s*reference,?\s*\)/,
        );
      },
    );
  },
);
