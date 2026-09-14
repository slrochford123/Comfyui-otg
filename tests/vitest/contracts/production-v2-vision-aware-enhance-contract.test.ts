import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const root =
  process.cwd();

function source(
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
  "Production V2 vision-aware Enhance Prompt R12C",
  () => {
    const panel =
      source(
        "app/app/components/ProductionV2Panel.tsx",
      );

    const enhance =
      source(
        "app/api/enhance-prompt/route.ts",
      );

    const vision =
      source(
        "app/api/vision-prompt/route.ts",
      );

    it(
      "keeps Text-to-Video text-only",
      () => {
        expect(
          panel,
        ).toContain(
          'selectedScene.generationMode\n        === "h3-image-to-video"',
        );

        expect(
          panel,
        ).toContain(
          'selectedScene.generationMode\n        === "h3-reference-to-video"',
        );

        expect(
          panel,
        ).not.toContain(
          'selectedScene.generationMode\n        === "h3-text-to-video"\n      ) {\n        pushVisionItem',
        );
      },
    );

    it(
      "uses exact continuation/start scene authority",
      () => {
        expect(
          panel,
        ).toContain(
          ".continuation\n              .lastFramePath",
        );

        expect(
          panel,
        ).toContain(
          '"continuation_frame"',
        );

        expect(
          panel,
        ).toContain(
          ".imageToVideo\n              .startingImage",
        );

        expect(
          panel,
        ).toContain(
          '"starting_image"',
        );
      },
    );

    it(
      "uses Character Cards, canonical Background view, and Asset defaults",
      () => {
        expect(
          panel,
        ).toContain(
          ".characterCardRef",
        );

        expect(
          panel,
        ).toContain(
          ".masterImageRef",
        );

        expect(
          panel,
        ).toContain(
          ".angleImageRefs",
        );

        expect(
          panel,
        ).toContain(
          ".defaultImageRef",
        );

        expect(
          panel,
        ).toMatch(
          /Character Cards -> Background -> Assets/,
        );
      },
    );

    it(
      "analyzes one image at a time sequentially",
      () => {
        expect(
          panel,
        ).toContain(
          "for (\n        const item\n        of visionItems",
        );

        expect(
          panel,
        ).toContain(
          '"/api/vision-prompt"',
        );

        expect(
          panel,
        ).toMatch(
          /purpose:\s*"prompt_enhancement"/,
        );

        expect(
          vision,
        ).toContain(
          "OTG_PRODUCTION_V2_VISION_SINGLE_IMAGE_ENHANCE_R12C_V1",
        );

        expect(
          vision,
        ).toContain(
          "images: [\n              b64,\n            ]",
        );

        expect(
          vision,
        ).toContain(
          'allowedNodes: [\n              "slr",\n            ]',
        );

        expect(
          vision,
        ).toContain(
          "keepAlive: 0",
        );
      },
    );

    it(
      "preserves role authority in the final text enhancement",
      () => {
        expect(
          enhance,
        ).toContain(
          "OTG_PRODUCTION_V2_VISION_AWARE_ENHANCE_R12C_V1",
        );

        expect(
          enhance,
        ).toContain(
          "Vision-derived context from the exact current generation inputs:",
        );

        expect(
          enhance,
        ).toContain(
          "The continuation frame or starting image is authoritative",
        );

        expect(
          enhance,
        ).toContain(
          "Character-reference observations are authoritative for character identity",
        );

        expect(
          enhance,
        ).toContain(
          "The original user prompt remains authoritative for requested action, dialogue, intent, and story events.",
        );
      },
    );

    it(
      "falls back to legacy text enhancement when vision yields nothing",
      () => {
        expect(
          panel,
        ).toContain(
          "const visualContext =",
        );

        expect(
          panel,
        ).toContain(
          "vision-aware prompt enhancement fell back to text-only",
        );

        expect(
          panel,
        ).toContain(
          "visualContext,",
        );

        expect(
          enhance,
        ).toContain(
          "Boolean(\n          context.visualContext",
        );
      },
    );
  },
);
