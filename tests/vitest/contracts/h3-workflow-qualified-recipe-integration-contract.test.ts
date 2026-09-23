import { describe, expect, it } from "vitest";

import {
  buildH3Workflow,
  validateH3WorkflowTemplate,
  type ProductionV2H3BackendId,
  type ProductionV2H3Mode,
} from "../../../lib/production/h3Workflows";
import {
  getH3ProductionRecipe,
  type H3ProductionDuration,
  type H3Quality,
} from "../../../lib/production/h3ProductionRecipes";

const backends: ProductionV2H3BackendId[] = ["rtx5060ti", "rtx3090"];
const modes: ProductionV2H3Mode[] = [
  "h3-text-to-video",
  "h3-image-to-video",
  "h3-reference-to-video",
];
const durations: H3ProductionDuration[] = [5, 10];
const qualities: H3Quality[] = ["lq", "hq"];

function build(
  backend: ProductionV2H3BackendId,
  mode: ProductionV2H3Mode,
  durationSeconds: H3ProductionDuration,
  h3Quality: H3Quality,
) {
  return buildH3Workflow({
    backend,
    mode,
    h3Quality,
    durationSeconds,
    finalPrompt: mode === "h3-reference-to-video"
      ? "<Picture 1> <Subject 1> A deterministic production contract scene."
      : "A deterministic production contract scene.",
    seed: 123456,
    outputPrefix: `contract_${backend}_${mode}_${durationSeconds}_${h3Quality}`,
    startImageFilename: mode === "h3-image-to-video" ? "start.png" : undefined,
    references: mode === "h3-reference-to-video" ? [{
      id: "picture-1",
      name: "Picture 1",
      sourceKind: "production-upload",
      pictureSlot: 1,
      subjectSlot: 1,
      workflowImage: "/tmp/picture.png",
      uploadedFilename: "picture.png",
    }] : undefined,
    voices: [],
  });
}

describe("H3 exact LQ/HQ workflow integration", () => {
  it("validates and builds every one of the 24 physical routes", () => {
    let count = 0;
    for (const backend of backends) {
      for (const mode of modes) {
        for (const duration of durations) {
          for (const quality of qualities) {
            const recipe = getH3ProductionRecipe(mode, duration, backend, quality);
            expect(validateH3WorkflowTemplate(backend, mode, duration, quality)).toBe(true);
            const built = build(backend, mode, duration, quality);
            count += 1;

            expect(built.recipeId).toBe(recipe.recipeId);
            expect(built.workflowFile).toBe(recipe.workflowFile);
            expect(built.nativeWidth).toBe(recipe.nativeWidth);
            expect(built.nativeHeight).toBe(recipe.nativeHeight);
            expect(built.steps).toBe(8);
            expect(built.preSubmitCleanup).toBeNull();
            expect(built.graph["24"].inputs.steps).toBe(8);
            expect(built.graph["24"].inputs.scheduler).toBe("simple");
            expect(built.graph["18"].inputs.sampler_name).toBe(recipe.sampler);
            expect(built.graph["39"].inputs.width).toBe(recipe.nativeWidth);
            expect(built.graph["39"].inputs.height).toBe(recipe.nativeHeight);
            expect(built.graph["39"].inputs.length).toBe(recipe.frameCount);
            expect(built.graph["30"].inputs.unet_name).toBe(
              mode === "h3-reference-to-video"
                ? "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
                : "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors",
            );
            if (mode === "h3-reference-to-video") {
              expect(built.graph["36"].class_type).toBe("LoraLoaderModelOnly");
              expect(built.graph["36"].inputs.lora_name).toBe("minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors");
              expect(built.graph["38"].inputs.model).toEqual(["36", 0]);
            } else {
              expect(built.graph["38"].inputs.model).toEqual(["30", 0]);
            }
            expect(built.graph["38"].inputs.shift_video).toBe(recipe.videoSigmaShift);
            expect(built.graph["38"].inputs.shift_audio).toBe(3);
            expect(built.graph["41"].class_type).toBe(mode === "h3-reference-to-video" ? "H3SLAAttention" : "ModelAttentionBackend");
            if (mode === "h3-reference-to-video") {
              expect(built.graph["41"].inputs.engine).toBe("comfy_kitchen");
            } else {
              expect(built.graph["41"].inputs.attention).toBe("comfy kitchen attention");
            }
            expect(built.graph["164"].class_type).toBe("ModelPreviewOverrideKJ");
            expect(built.graph["164"].inputs.tiny_vae).toBe("taeh3.safetensors");
            expect(Object.values(built.graph).some((node) => node.class_type === "SpectrumApplyMiniMaxH3")).toBe(false);
            expect(Object.values(built.graph).some((node) => node.class_type === "H3SLAAttention")).toBe(mode === "h3-reference-to-video");
          }
        }
      }
    }
    expect(count).toBe(24);
  });

  it("keeps the validated Comfy Kitchen preview chain attached on every H3 backend route", () => {
    const gpu5060 = build("rtx5060ti", "h3-reference-to-video", 10, "hq");
    const gpu3090 = build("rtx3090", "h3-reference-to-video", 10, "hq");
    for (const built of [gpu5060, gpu3090]) {
      expect(built.graph["39"].class_type).toBe("MiniMaxH3ReferenceToVideo");
      expect(built.graph["41"].class_type).toBe("H3SLAAttention");
      expect(built.graph["41"].inputs.engine).toBe("comfy_kitchen");
      expect(built.graph["164"].inputs.model).toEqual(["41", 0]);
      expect(built.graph["24"].inputs.model).toEqual(["164", 0]);
      expect(built.graph["32"].inputs.model).toEqual(["164", 0]);
    }
  });
});
