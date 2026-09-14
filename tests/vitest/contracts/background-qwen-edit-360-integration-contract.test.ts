import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const routeSource =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "app/api/background-angle-plate/route.ts",
    ),
    "utf8",
  );

const panelSource =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "app/app/components/CharactersPanel.tsx",
    ),
    "utf8",
  );

const workflow =
  JSON.parse(
    fs.readFileSync(
      path.join(
        process.cwd(),
        "workflows/backgrounds/qwen-edit-360-panorama-v1.json",
      ),
      "utf8",
    ),
  );

function nodesByClass(
  classType: string,
) {
  return Object.entries(
    workflow,
  ).filter(
    ([, node]: any) =>
      String(
        node?.class_type ||
          "",
      ) ===
      classType,
  );
}

describe(
  "PP-06 Qwen-Edit_360 Background integration",
  () => {
    it(
      "promotes the proven Qwen-Edit_360 graph as a single 2048x1024 panorama workflow",
      () => {
        expect(
          nodesByClass(
            "LoadImage",
          ),
        ).toHaveLength(1);

        expect(
          nodesByClass(
            "SaveImage",
          ),
        ).toHaveLength(1);

        const encoded =
          JSON.stringify(
            workflow,
          );

        expect(
          encoded,
        ).toContain(
          "251018_MICKMUMPITZ_QWEN-EDIT_360_03.safetensors",
        );

        const has2048x1024 =
          Object.values(
            workflow,
          ).some(
            (node: any) =>
              Number(
                node?.inputs?.width,
              ) === 2048 &&
              Number(
                node?.inputs?.height,
              ) === 1024,
          );

        expect(
          has2048x1024,
        ).toBe(true);
      },
    );

    it(
      "defaults Background direction creation to one Qwen-Edit_360 panorama while preserving the old Multiple-Angles path as fallback",
      () => {
        expect(
          routeSource,
        ).toContain(
          "OTG_BACKGROUND_QWEN_EDIT_360_PROJECTION_PP06_V1",
        );

        expect(
          routeSource,
        ).toContain(
          '"qwen-edit-360-projection-v1"',
        );

        expect(
          routeSource,
        ).toContain(
          'requested === "multiple-angles"',
        );

        expect(
          routeSource,
        ).toContain(
          "applyCanonicalDirectionalSourceGraphV1(workflow);",
        );

        expect(
          routeSource,
        ).toContain(
          "retainCanonicalDirectionalOutputsV36C(workflow)",
        );
      },
    );

    it(
      "selects the positive Qwen Image Edit encoder through the KSampler instead of assuming exactly one encoder exists",
      () => {
        expect(
          routeSource,
        ).toContain(
          "OTG_BACKGROUND_QWEN_EDIT_360_POSITIVE_ENCODER_PP06_V1",
        );

        expect(
          routeSource,
        ).toContain(
          "sampler.node?.inputs?.positive",
        );

        expect(
          routeSource,
        ).toContain(
          "positiveEncoderNodeId",
        );

        expect(
          routeSource,
        ).not.toContain(
          '"Qwen Image Edit encoder",',
        );
      },
    );

    it(
      "projects exactly five non-Front views from the panorama with deterministic camera geometry",
      () => {
        expect(
          routeSource,
        ).toContain(
          'direction: "left"',
        );
        expect(
          routeSource,
        ).toContain(
          "yawDegrees: -90",
        );

        expect(
          routeSource,
        ).toContain(
          'direction: "right"',
        );
        expect(
          routeSource,
        ).toContain(
          "yawDegrees: 90",
        );

        expect(
          routeSource,
        ).toContain(
          'direction: "rear"',
        );
        expect(
          routeSource,
        ).toContain(
          "yawDegrees: 180",
        );

        expect(
          routeSource,
        ).toContain(
          'direction: "up"',
        );
        expect(
          routeSource,
        ).toContain(
          "pitchDegrees: 45",
        );

        expect(
          routeSource,
        ).toContain(
          'direction: "down"',
        );
        expect(
          routeSource,
        ).toContain(
          "pitchDegrees: -45",
        );

        expect(
          routeSource,
        ).toContain(
          "horizontalFovDegrees = 90",
        );
      },
    );

    it(
      "keeps Front as the approved Master instead of projecting or regenerating it",
      () => {
        expect(
          routeSource,
        ).toContain(
          "frontUsesMaster:",
        );

        expect(
          routeSource,
        ).toContain(
          "true",
        );

        expect(
          routeSource,
        ).not.toContain(
          'direction: "front",\n      suffix:',
        );

        expect(
          panelSource,
        ).toContain(
          "front: masterAsset",
        );
      },
    );

    it(
      "waits only for the panorama AI output and then accepts direct deterministic projection images",
      () => {
        expect(
          panelSource,
        ).toContain(
          "OTG_BACKGROUND_QWEN_EDIT_360_CLIENT_PP06_V1",
        );

        expect(
          panelSource,
        ).toContain(
          '"project-panorama"',
        );

        expect(
          panelSource,
        ).toContain(
          "OTG_BACKGROUND_360_PROJECTIONS_PP06_V1",
        );

        expect(
          panelSource,
        ).toContain(
          "const directImageValue",
        );

        expect(
          panelSource,
        ).toContain(
          "if (\n        directImageValue\n      )",
        );

        expect(
          panelSource,
        ).toContain(
          "makeExactBackgroundPreviewCandidateV36R",
        );

        expect(
          panelSource,
        ).toContain(
          "waitForBackgroundAnglePlateOutputCandidateV36AK",
        );
      },
    );

    it(
      "preserves the six-final Background Card production contract",
      () => {
        expect(
          panelSource,
        ).toContain(
          "left90: generatedAssets.left90",
        );

        expect(
          panelSource,
        ).toContain(
          "right90: generatedAssets.right90",
        );

        expect(
          panelSource,
        ).toContain(
          "back: generatedAssets.back",
        );

        expect(
          panelSource,
        ).toContain(
          "up: generatedAssets.up",
        );

        expect(
          panelSource,
        ).toContain(
          "down: generatedAssets.down",
        );

        expect(
          panelSource,
        ).toContain(
          "hasCompleteCanonicalBackgroundCardV36B(angleImages)",
        );
      },
    );
  },
);
