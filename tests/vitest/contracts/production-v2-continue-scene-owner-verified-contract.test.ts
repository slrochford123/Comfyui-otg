import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const root =
  process.cwd();

function source(relativePath: string) {
  return fs.readFileSync(
    path.join(
      root,
      relativePath,
    ),
    "utf8",
  );
}

describe(
  "Production V2 owner-verified Continue Scene contract",
  () => {
    it(
      "persists server-prepared continuation lineage",
      () => {
        const v2 =
          source(
            "lib/production/v2.ts",
          );

        expect(v2).toContain(
          "OTG_PRODUCTION_V2_CONTINUATION_SOURCE_V1",
        );

        expect(v2).toContain(
          "export type ProductionV2ContinuationSource",
        );

        expect(v2).toContain(
          "continuation: ProductionV2ContinuationSource | null;",
        );

        expect(v2).toContain(
          "continuation: null,",
        );

        expect(v2).toContain(
          "normalizeProductionV2Continuation",
        );
      },
    );

    it(
      "extracts the exact final decoded frame without changing Gallery Extend behavior",
      () => {
        const videoFrame =
          source(
            "lib/videoFrame.ts",
          );

        expect(videoFrame).toContain(
          "OTG_PRODUCTION_V2_EXACT_FINAL_FRAME_V1",
        );

        expect(videoFrame).toContain(
          "extractFinalFrameToImage",
        );

        expect(videoFrame).toContain(
          '"-sseof"',
        );

        expect(videoFrame).toContain(
          '"reverse"',
        );

        expect(videoFrame).toContain(
          "extractTailFrameToImage",
        );
      },
    );

    it(
      "resolves the source media version and owner boundary on the server",
      () => {
        const route =
          source(
            "app/api/production/v2/postprocess/route.ts",
          );

        expect(route).toContain(
          "OTG_PRODUCTION_V2_OWNER_VERIFIED_CONTINUE_SCENE_V1",
        );

        expect(route).toContain(
          'action === "prepare-continuation"',
        );

        expect(route).toContain(
          "resolveProductionV2Version(production, sceneId, versionId)",
        );

        expect(route).toContain(
          "assertProductionV2OwnedFile(ownerKey, productionId, version.mediaPath)",
        );

        expect(route).toContain(
          "productionV2SceneOutputRoot",
        );

        expect(route).toContain(
          "extractFinalFrameToImage",
        );

        expect(route).toContain(
          "markProductionV2SceneSaved",
        );

        expect(route).toContain(
          "addProductionV2Scene",
        );

        expect(route).toContain(
          "lastFramePath",
        );
      },
    );

    it(
      "re-verifies continuation lineage before LTX durable job creation",
      () => {
        const route =
          source(
            "app/api/production/v2/generation/route.ts",
          );

        expect(route).toContain(
          "OTG_PRODUCTION_V2_LTX_CONTINUATION_OWNER_VERIFIED_HANDOFF_V1",
        );

        expect(route).toMatch(
          /scene\.continuation\s*\.sourceSceneId/,
        );

        expect(route).toMatch(
          /scene\.continuation\s*\.sourceMediaVersionId/,
        );

        expect(route).toMatch(
          /scene\.continuation\s*\.lastFramePath/,
        );

        expect(route).toContain(
          "continuationFirstFramePath,",
        );
      },
    );

    it(
      "uses the selected active media version and exposes Continue Scene on the qualified Production paths",
      () => {
        const panel =
          source(
            "app/app/components/ProductionV2Panel.tsx",
          );

        expect(panel).toContain(
          "OTG_PRODUCTION_V2_LTX_CONTINUE_SCENE_UI_V1",
        );

        expect(panel).toContain(
          "? selectedSceneVersion(selectedScene)",
        );

        expect(panel).not.toContain(
          "? selectedScene.mediaVersions.at(-1) || selectedSceneVersion(selectedScene)",
        );

        expect(panel).toContain(
          'action:'
          + '\n                  "prepare-continuation"',
        );

        expect(panel).toContain(
          'data-otg="production-v2-continue-scene"',
        );

        expect(panel).toContain(
          'selectedScene.model === "ltx-2.5"',
        );
      },
    );
  },
);
