import { describe, expect, it } from "vitest";

import {
  buildH3Workflow,
  validateH3WorkflowTemplate,
  type ProductionV2H3BackendId,
  type ProductionV2H3Mode,
} from "../../../lib/production/h3Workflows";
import type { H3AdvancedSettings } from "../../../lib/production/h3Settings";
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
const qualities: H3Quality[] = ["sh", "lq", "hq"];

function build(
  backend: ProductionV2H3BackendId,
  mode: ProductionV2H3Mode,
  durationSeconds: H3ProductionDuration,
  h3Quality: H3Quality,
  h3Settings?: H3AdvancedSettings,
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
    h3Settings,
  });
}

describe("H3 exact SH/LQ/HQ workflow integration", () => {
  it("validates and builds every one of the 36 physical routes", () => {
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
            expect(built.graph["18"].inputs.sampler_name).toBe("euler");
            expect(built.graph["39"].inputs.width).toBe(recipe.nativeWidth);
            expect(built.graph["39"].inputs.height).toBe(recipe.nativeHeight);
            expect(built.graph["39"].inputs.length).toBe(recipe.frameCount);
            expect(built.graph["36"].class_type).toBe("LoraLoaderModelOnly");
            expect(built.graph["36"].inputs.lora_name).toContain("turbo_8step");
            expect(built.graph["38"].inputs.shift_video).toBe(6);
            expect(built.graph["38"].inputs.shift_audio).toBe(3);
            expect(built.graph["41"].class_type).toBe("H3SLAAttention");
            expect(built.graph["164"].class_type).toBe("ModelPreviewOverrideKJ");
            expect(built.graph["164"].inputs.preview_frames).toBe(recipe.frameCount);
            expect(built.graph["164"].inputs.preview_fps).toBe(24);
            expect(built.graph["164"].inputs.audio_vae).toEqual(["4", 0]);
            expect(built.graph["164"].inputs.suppress_default_preview).toBe(true);
            expect(Object.values(built.graph).some((node) => node.class_type === "SpectrumApplyMiniMaxH3")).toBe(false);
          }
        }
      }
    }
    expect(count).toBe(36);
  });

  it("keeps backend-specific SLA settings attached to the chosen GPU", () => {
    const gpu5060 = build("rtx5060ti", "h3-reference-to-video", 10, "hq");
    const gpu3090 = build("rtx3090", "h3-reference-to-video", 10, "hq");
    expect(gpu5060.graph["41"].inputs.dense_backend).toBe("comfy_kitchen");
    expect(gpu3090.graph["41"].inputs.dense_backend).toBe("sage:qk_int8_pv_fp16_cuda");
    expect(gpu5060.graph["41"].inputs.sparsity_ratio).toBe(0.85);
    expect(gpu3090.graph["41"].inputs.sparsity_ratio).toBe(0.85);
  });

  it("maps Turbo Standard to the current Turbo LoRA and 8-step recipe", () => {
    const built = build("rtx5060ti", "h3-reference-to-video", 5, "lq", {
      renderMode: "turbo",
      checkpointMode: "standard",
      refMod: { enabled: false, strength: "balanced" },
      motionLab: { enabled: false },
    });
    expect(built.graph["36"].class_type).toBe("LoraLoaderModelOnly");
    expect(built.graph["36"].inputs.lora_name).toBe("minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors");
    expect(built.graph["24"].inputs.steps).toBe(8);
    expect(built.graph["18"].inputs.sampler_name).toBe("euler");
    expect(built.graph["164"].class_type).toBe("ModelPreviewOverrideKJ");
    expect(built.graph["164"].inputs.suppress_default_preview).toBe(true);
    expect(built.graph["32"].inputs.model).toEqual(["164", 0]);
  });

  it("maps Native Standard to 20-step full-dense without the Turbo LoRA", () => {
    const built = build("rtx5060ti", "h3-reference-to-video", 5, "lq", {
      renderMode: "native",
      checkpointMode: "standard",
      refMod: { enabled: false, strength: "balanced" },
      motionLab: { enabled: false },
    });
    expect(built.graph["36"]).toBeUndefined();
    expect(built.graph["24"].inputs.steps).toBe(20);
    expect(built.graph["24"].inputs.scheduler).toBe("simple");
    expect(built.graph["18"].inputs.sampler_name).toBe("res_multistep");
    expect(Object.values(built.graph).some((node) => node.class_type === "H3SLAAttention")).toBe(false);
    expect(built.graph["38"].inputs.model).toEqual(["30", 0]);
    expect(built.graph["164"].class_type).toBe("ModelPreviewOverrideKJ");
    expect(built.graph["164"].inputs.suppress_default_preview).toBe(true);
    expect(built.graph["32"].inputs.model).toEqual(["164", 0]);
  });

  it("maps Native Standard HQ to 20-step SLA without the Turbo LoRA", () => {
    const built = build("rtx5060ti", "h3-reference-to-video", 5, "hq", {
      renderMode: "native",
      checkpointMode: "standard",
      refMod: { enabled: false, strength: "balanced" },
      motionLab: { enabled: false },
    });
    expect(built.graph["36"]).toBeUndefined();
    expect(built.graph["24"].inputs.steps).toBe(20);
    expect(built.graph["24"].inputs.scheduler).toBe("simple");
    expect(built.graph["18"].inputs.sampler_name).toBe("res_multistep");
    expect(built.graph["41"].class_type).toBe("H3SLAAttention");
    expect(built.graph["38"].inputs.model).toEqual(["30", 0]);
    expect(built.graph["41"].inputs.model).toEqual(["38", 0]);
    expect(built.graph["164"].inputs.model).toEqual(["41", 0]);
    expect(built.graph["32"].inputs.model).toEqual(["164", 0]);
  });

  it("maps Singularity Turbo to the Singularity checkpoint, Combat, Realism, Turbo LoRA, and preview stack", () => {
    const built = build("rtx5060ti", "h3-reference-to-video", 5, "lq", {
      renderMode: "turbo",
      checkpointMode: "singularity",
      refMod: { enabled: false, strength: "balanced" },
      motionLab: { enabled: false },
    });
    expect(built.graph["30"].inputs.unet_name).toBe("Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors");
    expect(built.graph["36"].inputs.lora_name).toBe("minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors");
    expect(built.graph["9001"].inputs).toMatchObject({ lora_name: "H3_Combat_V2.safetensors", strength_model: 1 });
    expect(built.graph["9002"].inputs).toMatchObject({ lora_name: "h3-realism-people-t2v-i2v-r2v.safetensors", strength_model: 0.7 });
    expect(built.graph["38"].inputs.model).toEqual(["9002", 0]);
    expect(built.graph["24"].inputs.steps).toBe(8);
    expect(built.graph["18"].inputs.sampler_name).toBe("euler");
    expect(Object.values(built.graph).some((node) => node.class_type === "H3SLAAttention")).toBe(true);
    expect(built.graph["164"].class_type).toBe("ModelPreviewOverrideKJ");
    expect(built.graph["164"].inputs.suppress_default_preview).toBe(true);
  });

  it("maps Singularity Native to the validated checkpoint, Combat, Realism, Native full-dense stack", () => {
    const built = build("rtx5060ti", "h3-reference-to-video", 5, "lq", {
      renderMode: "native",
      checkpointMode: "singularity",
      refMod: { enabled: false, strength: "balanced" },
      motionLab: { enabled: false },
    });
    expect(built.graph["30"].inputs.unet_name).toBe("Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors");
    expect(built.graph["36"]).toBeUndefined();
    expect(built.graph["9001"].inputs).toMatchObject({ lora_name: "H3_Combat_V2.safetensors", strength_model: 1 });
    expect(built.graph["9002"].inputs).toMatchObject({ lora_name: "h3-realism-people-t2v-i2v-r2v.safetensors", strength_model: 0.7 });
    expect(built.graph["38"].inputs.model).toEqual(["9002", 0]);
    expect(built.graph["24"].inputs.steps).toBe(20);
    expect(built.graph["18"].inputs.sampler_name).toBe("res_multistep");
    expect(Object.values(built.graph).some((node) => node.class_type === "H3SLAAttention")).toBe(false);
    expect(built.graph["164"].class_type).toBe("ModelPreviewOverrideKJ");
    expect(built.graph["164"].inputs.suppress_default_preview).toBe(true);
  });

  it("maps Singularity Native HQ to the validated checkpoint, Combat, Realism, Native SLA stack", () => {
    const built = build("rtx5060ti", "h3-reference-to-video", 5, "hq", {
      renderMode: "native",
      checkpointMode: "singularity",
      refMod: { enabled: false, strength: "balanced" },
      motionLab: { enabled: false },
    });
    expect(built.graph["30"].inputs.unet_name).toBe("Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors");
    expect(built.graph["36"]).toBeUndefined();
    expect(built.graph["9001"].inputs).toMatchObject({ lora_name: "H3_Combat_V2.safetensors", strength_model: 1 });
    expect(built.graph["9002"].inputs).toMatchObject({ lora_name: "h3-realism-people-t2v-i2v-r2v.safetensors", strength_model: 0.7 });
    expect(built.graph["38"].inputs.model).toEqual(["9002", 0]);
    expect(built.graph["24"].inputs.steps).toBe(20);
    expect(built.graph["18"].inputs.sampler_name).toBe("res_multistep");
    expect(built.graph["41"].class_type).toBe("H3SLAAttention");
    expect(built.graph["41"].inputs.model).toEqual(["38", 0]);
    expect(built.graph["164"].inputs.model).toEqual(["41", 0]);
    expect(built.graph["32"].inputs.model).toEqual(["164", 0]);
  });

  it("injects RefMod with the autogrow refs_image.ref_image_0 input and selected retention", () => {
    const balanced = build("rtx5060ti", "h3-reference-to-video", 5, "lq", {
      renderMode: "native",
      checkpointMode: "singularity",
      refMod: { enabled: true, strength: "balanced", targetReference: 0 },
      motionLab: { enabled: false },
    });
    expect(balanced.graph["9200"].class_type).toBe("MiniMaxH3RefModExtract");
    expect(balanced.graph["9200"].inputs["refs_image.ref_image_0"]).toEqual(["80", 0]);
    expect(balanced.graph["9200"].inputs.refs_image).toBeUndefined();
    expect(balanced.graph["9201"].inputs.retention).toBe(0.7);
    expect(balanced.graph["32"].inputs.conditioning).toEqual(["9201", 0]);

    const strong = build("rtx5060ti", "h3-reference-to-video", 5, "lq", {
      renderMode: "native",
      checkpointMode: "singularity",
      refMod: { enabled: true, strength: "strong", targetReference: 0 },
      motionLab: { enabled: false },
    });
    expect(strong.graph["9201"].inputs.retention).toBe(1);
  });

  it("injects Motion Lab recovery and carries original audio to the final saved video", () => {
    const built = build("rtx5060ti", "h3-reference-to-video", 5, "lq", {
      renderMode: "native",
      checkpointMode: "singularity",
      refMod: { enabled: false, strength: "balanced" },
      motionLab: { enabled: true },
    });
    expect(built.graph["9300"].class_type).toBe("H3JerkOracle");
    expect(built.graph["9300"].inputs).toMatchObject({
      q: 0.75,
      d_max: 4,
      ramp: true,
      bridge: 8,
    });
    expect(built.graph["9304"].inputs.inject).toBe(0.48);
    expect(built.graph["9311"].class_type).toBe("CreateVideo");
    expect(built.graph["9311"].inputs.audio).toEqual(["14", 0]);
    expect(built.graph["5"].inputs.video).toEqual(["9311", 0]);
  });
});
