import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  LTX25_INGREDIENTS_FPS,
  LTX25_INGREDIENTS_HEIGHT,
  LTX25_INGREDIENTS_WIDTH,
  buildLtx25IngredientsWorkflow,
} from "@/lib/production/ltx25IngredientsWorkflow";

const baseInput = {
  backend: "rtx5060ti" as const,
  ingredientsSheetFilename:
    "pv2-ingredients.png",
  finalPrompt:
    "Continue the scene with stable identity and motion.",
  durationSeconds: 5 as const,
  seed: 123456,
  outputPrefix:
    "production_v2_ltx25/continuation-contract",
};

function source(relativePath: string) {
  return fs.readFileSync(
    path.join(process.cwd(), relativePath),
    "utf8",
  );
}

describe(
  "Production V2 LTX 2.5 continuation first-frame contract",
  () => {
    it(
      "leaves the qualified 25-node Ingredients graph unchanged when no continuation frame exists",
      () => {
        const built =
          buildLtx25IngredientsWorkflow(
            baseInput,
          );

        const graph = built.graph;

        expect(
          Object.keys(graph),
        ).toHaveLength(25);

        expect(graph["26"])
          .toBeUndefined();

        expect(graph["27"])
          .toBeUndefined();

        expect(
          graph["12"].inputs.image,
        ).toEqual(["11", 0]);

        expect(
          graph["12"].inputs.latent,
        ).toEqual(["10", 0]);

        expect(
          graph["10"].class_type,
        ).toBe("EmptyLTXVLatentVideo");

        expect(
          graph["10"].inputs.width,
        ).toBe(
          LTX25_INGREDIENTS_WIDTH,
        );

        expect(
          graph["10"].inputs.height,
        ).toBe(
          LTX25_INGREDIENTS_HEIGHT,
        );

        expect(
          graph["9"].inputs.frame_rate,
        ).toBe(
          LTX25_INGREDIENTS_FPS,
        );
      },
    );

    it(
      "conditions the base video latent from the carried frame before applying the existing Ingredients IC-LoRA guide",
      () => {
        const built =
          buildLtx25IngredientsWorkflow({
            ...baseInput,

            continuationFirstFrameFilename:
              "pv2-tail-frame.jpg",
          });

        const graph = built.graph;

        expect(
          Object.keys(graph),
        ).toHaveLength(27);

        expect(
          graph["26"],
        ).toEqual({
          class_type:
            "LoadImage",

          inputs: {
            image:
              "pv2-tail-frame.jpg",
          },
        });

        expect(
          graph["27"].class_type,
        ).toBe(
          "LTXVImgToVideoInplace",
        );

        expect(
          graph["27"].inputs,
        ).toEqual({
          vae: ["3", 0],
          image: ["26", 0],
          latent: ["10", 0],
          strength: 1.0,
          bypass: false,
        });

        /*
         * Ingredients reference identity guidance must remain
         * exactly on the original sheet branch.
         */
        expect(
          graph["12"].inputs.image,
        ).toEqual(["11", 0]);

        /*
         * Only the latent source changes:
         * EmptyLTXVLatentVideo
         *   -> LTXVImgToVideoInplace
         *   -> LTXAddVideoICLoRAGuide
         */
        expect(
          graph["12"].inputs.latent,
        ).toEqual(["27", 0]);
      },
    );

    it(
      "carries the continuation path through the durable job and scheduler seams without changing the qualified graph source",
      () => {
        const jobs =
          source(
            "lib/production/ltx25IngredientsJobs.ts",
          );

        const scheduler =
          source(
            "lib/production/ltx25IngredientsScheduler.ts",
          );

        const comfy =
          source(
            "lib/production/ltx25IngredientsComfy.ts",
          );

        const workflow =
          source(
            "lib/production/ltx25IngredientsWorkflow.ts",
          );

        expect(jobs)
          .toContain(
            "continuationFirstFramePath?: string | null;",
          );

        expect(scheduler)
          .toMatch(
            /job\.payload\s*\.continuationFirstFramePath/,
          );

        expect(scheduler)
          .toContain(
            "continuationFirstFrameFilename",
          );

        expect(scheduler)
          .toContain(
            "_continuation_first_frame",
          );

        expect(comfy)
          .toContain(
            '"LTXVImgToVideoInplace",',
          );

        expect(workflow)
          .toContain(
            "OTG_PRODUCTION_V2_LTX_CONTINUATION_FIRST_FRAME_V1",
          );
      },
    );
  },
);
