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

describe(
  "Production V2 qualified LTX 2.5 Ingredients workflow",
  () => {
    it(
      "preserves the exact qualified model and Ingredients graph contract",
      () => {
        const built =
          buildLtx25IngredientsWorkflow({
            backend: "rtx5060ti",
            ingredientsSheetFilename:
              "production_scene_ingredients.png",
            finalPrompt:
              "A cinematic test scene.",
            negativePrompt:
              "identity drift, watermark",
            durationSeconds: 5,
            seed: 123456,
            outputPrefix:
              "otg_production_v2/test/scene/job",
          });

        const graph = built.graph;

        expect(Object.keys(graph)).toHaveLength(25);

        expect(graph["1"].class_type)
          .toBe("LoadImage");

        expect(graph["1"].inputs.image)
          .toBe(
            "production_scene_ingredients.png",
          );

        expect(graph["4"].inputs.unet_name)
          .toBe(
            "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
          );

        expect(graph["5"].inputs.clip_name)
          .toBe(
            "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
          );

        expect(graph["6"].inputs.lora_name)
          .toBe(
            "LTX-2.x/Control-and-Editing/ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors",
          );

        expect(graph["6"].inputs.strength_model)
          .toBe(1.3);

        expect(graph["10"].inputs.width)
          .toBe(LTX25_INGREDIENTS_WIDTH);

        expect(graph["10"].inputs.height)
          .toBe(LTX25_INGREDIENTS_HEIGHT);

        expect(graph["10"].inputs.length)
          .toBe(121);

        expect(graph["11"].class_type)
          .toBe("RepeatImageBatch");

        expect(graph["11"].inputs.amount)
          .toBe(121);

        expect(graph["12"].class_type)
          .toBe("LTXAddVideoICLoRAGuide");

        expect(graph["12"].inputs.image)
          .toEqual(["11", 0]);

        expect(graph["12"].inputs.latent)
          .toEqual(["10", 0]);

        expect(
          graph["12"].inputs
            .latent_downscale_factor,
        ).toEqual(["6", 1]);

        expect(graph["12"].inputs.strength)
          .toBe(1.0);

        expect(graph["12"].inputs.crop)
          .toBe("disabled");

        expect(graph["13"].inputs.frames_number)
          .toBe(121);

        expect(graph["16"].inputs.sampler_name)
          .toBe("euler_ancestral_cfg_pp");

        expect(graph["18"].inputs.noise_seed)
          .toBe(123456);

        expect(graph["24"].inputs.fps)
          .toBe(LTX25_INGREDIENTS_FPS);

        expect(graph["25"].inputs.filename_prefix)
          .toBe(
            "otg_production_v2/test/scene/job",
          );

        expect(built.frames).toBe(121);
        expect(built.nativeAudio).toBe(true);
        expect(built.preSubmitCleanup).toBeNull();
      },
    );

    it(
      "qualifies the 10-second graph instead of rejecting it",
      () => {
        expect(() =>
          buildLtx25IngredientsWorkflow({
            backend: "rtx5060ti",
            ingredientsSheetFilename:
              "ingredients.png",
            finalPrompt: "test",
            durationSeconds: 10,
            seed: 1,
            outputPrefix: "test",
          }),
        ).not.toThrow()
      },
    );
  },
);
