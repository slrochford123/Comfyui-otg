import { describe, expect, it } from "vitest";
import { buildH3RefModsT2VWorkflow } from "@/lib/h3SpecialModes/refModsWorkflow";
import { normalizeH3RefModSlots, validateH3RefModsRequest } from "@/lib/h3SpecialModes/refMods";
import { DEFAULT_H3_ADVANCED_SETTINGS, resolveH3RenderSettings, type H3CheckpointMode } from "@/lib/production/h3Settings";

const slots = normalizeH3RefModSlots([{ name: "vanellope_example", category: "character", sourceKind: "video" }]);
describe("saved RefMods use the Reference-to-Video model options", () => {
  for (const backend of ["rtx3090", "rtx5060ti"] as const) {
    for (const checkpointMode of ["standard", "singularity", "singularity-v1.3", "fasth3", "selflift"] as H3CheckpointMode[]) {
      it.each(["native", "turbo"] as const)(`${backend} / ${checkpointMode} / %s preserves references and model wiring`, renderMode => {
        const h3Settings = { ...DEFAULT_H3_ADVANCED_SETTINGS, checkpointMode, renderMode };
        const resolved = resolveH3RenderSettings(h3Settings);
        const built = buildH3RefModsT2VWorkflow({ backend, quality: "sh", orientation: "portrait", durationSeconds: 5,
          prompt: "A character walks through a sunny park.", refMods: slots, turbo: renderMode === "turbo", h3Settings, seed: 42, outputPrefix: "qa/refmods" });
        expect(built.steps).toBe(resolved.steps);
        expect(built.graph["30"].inputs.unet_name).toBe(resolved.checkpoint === "standard" ? "minimax_h3_ref2va_pruned_int8_convrot.safetensors" : resolved.checkpoint);
        expect(built.graph["18"].inputs.sampler_name).toBe(resolved.sampler);
        expect(built.graph["9400"].inputs.mod_1).toBe("vanellope_example");
        expect(built.graph["9401"].inputs.mods).toEqual(["9400", 0]);
        expect(built.graph["39"].inputs).toMatchObject({ width: 352, height: 608 });
        expect(built.graph["32"].inputs.conditioning).toEqual(["9401", 0]);
        if (checkpointMode === "selflift") {
          expect(built.graph["21"].class_type).toBe("SelfLiftH3Sampler");
          expect(built.graph["21"].inputs.positive).toEqual(["9401", 0]);
          expect(built.graph.selflift_negative.inputs.conditioning).toEqual(["9401", 0]);
        }
        expect(built.graph["21"].inputs.latent_image).toEqual(["39", 1]);
        for (const node of Object.values(built.graph)) for (const value of Object.values(node.inputs)) {
          if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number") expect(built.graph[value[0]], `missing linked node ${value[0]}`).toBeDefined();
        }
        expect(Object.values(built.graph).some(node => node.class_type === "ModelPreviewOverrideKJ")).toBe(true);
        if (checkpointMode.startsWith("singularity")) expect(Object.values(built.graph).some(node => node.inputs.lora_name === "h3-realism-people-t2v-i2v-r2v.safetensors")).toBe(true);
      });
    }
  }
  it("persists shared model settings and retains legacy Native requests", () => {
    const input = { mode: "h3-refmods", quality: "sh", orientation: "landscape", durationSeconds: 5, prompt: "A character walks", refMods: slots, turbo: false };
    expect(validateH3RefModsRequest(input).h3Settings.renderMode).toBe("native");
    const selected = validateH3RefModsRequest({ ...input, h3Settings: { ...DEFAULT_H3_ADVANCED_SETTINGS, checkpointMode: "singularity-v1.3", renderMode: "turbo", combatLoraEnabled: false } });
    expect(selected).toMatchObject({ turbo: true, h3Settings: { checkpointMode: "singularity-v1.3", combatLoraEnabled: false } });
  });
});
