import fs from "node:fs";
import path from "node:path";
import {
  describe,
  expect,
  it,
} from "vitest";

import {
  matchesComfyHistoryImageRequest,
} from "../../../lib/comfyImageOutputLookup";

const repoRoot = process.cwd();

const panelSource = fs.readFileSync(
  path.join(
    repoRoot,
    "app/app/components/AssetGalleryPanel.tsx",
  ),
  "utf8",
);

describe(
  "PP-06 Asset Master history resolution",
  () => {
    it(
      "allows the actual SeedVR temp filename when matching by output node",
      () => {
        const actualSeedVrOutput = {
          filename:
            "ComfyUI_temp_bkala_00002_.png",
          subfolder: "",
          type: "temp",
          nodeId: "73",
        };

        expect(
          matchesComfyHistoryImageRequest(
            actualSeedVrOutput,
            {
              nodeId: "73",
            },
          ),
        ).toBe(true);

        expect(
          matchesComfyHistoryImageRequest(
            actualSeedVrOutput,
            {
              nodeId: "73",
              filenamePrefix:
                "otg-asset-master-test-",
            },
          ),
        ).toBe(false);
      },
    );

    it(
      "does not require filenamePrefix while waiting for the Asset Master",
      () => {
        const marker =
          "OTG_ASSET_MASTER_HISTORY_NODE_MATCH_PP06_V1";

        expect(
          panelSource,
        ).toContain(marker);

        const markerIndex =
          panelSource.indexOf(marker);

        expect(
          markerIndex,
        ).toBeGreaterThan(0);

        const start =
          Math.max(
            0,
            markerIndex - 300,
          );

        const block =
          panelSource.slice(
            start,
            markerIndex + 700,
          );

        expect(
          block,
        ).toContain(
          "ASSET_MASTER_OUTPUT_NODE",
        );

        expect(
          block,
        ).not.toMatch(
          /filenamePrefix\s*:/,
        );
      },
    );
  },
);
