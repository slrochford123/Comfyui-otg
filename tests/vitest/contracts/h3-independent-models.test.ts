import { describe, expect, it } from "vitest";
import { buildH3Workflow, h3ExpectedAssetChoicesForBackend, h3RequiredNodeClassesForBackend } from "@/lib/production/h3Workflows";
import { DEFAULT_H3_ADVANCED_SETTINGS, H3_SINGULARITY_CHECKPOINT, H3_REALISM_TEST19_LORA, H3_COMBAT_V2_LORA, resolveH3RenderSettings } from "@/lib/production/h3Settings";
import { H3_OMNIREF } from "@/lib/h3OmniRef";
import { DEFAULT_H3_STUDIO_PLAN, H3_STUDIO_PROFILES, parseH3StudioPlan, reconcileH3StudioPlan } from "@/lib/h3StudioPlan";
import { compileH3StudioPlan, h3StudioPreviewInput } from "@/lib/h3StudioCompiler";

const base = { backend: "rtx3090" as const, mode: "h3-reference-to-video" as const, h3Quality: "lq" as const,
  durationSeconds: 5 as const, finalPrompt: "Use <Picture 1> as <Subject 1>. A dragon flies.", seed: 42, outputPrefix: "fixture/independent",
  references: [{ id: "fixture", name: "Dragon", sourceKind: "production-upload" as const, pictureSlot: 1, subjectSlot: 1, workflowImage: "dragon.png", uploadedFilename: "dragon.png" }] };
const cases = (["rtx3090", "rtx5060ti"] as const).flatMap(backend => (["standard", "singularity"] as const).flatMap(checkpointMode => (["native", "turbo"] as const).flatMap(renderMode => [false, true].map(combatLoraEnabled => ({ backend, checkpointMode, renderMode, combatLoraEnabled })))));
describe("five independent rendering configurations", () => {
  it.each(cases)("restores $backend $checkpointMode $renderMode Combat=$combatLoraEnabled", ({ backend, ...settings }) => {
    const built = buildH3Workflow({ ...base, backend, h3Settings: { ...DEFAULT_H3_ADVANCED_SETTINGS, ...settings } });
    const graph = built.graph, native = settings.renderMode === "native", singularity = settings.checkpointMode === "singularity";
    expect(graph["30"].inputs.unet_name).toBe(singularity ? H3_SINGULARITY_CHECKPOINT : "minimax_h3_ref2va_pruned_int8_convrot.safetensors");
    expect(graph["24"].inputs.steps).toBe(native ? 20 : 8);
    expect(graph["18"].inputs.sampler_name).toBe(native ? "res_multistep" : "euler");
    expect(graph["24"].inputs.scheduler).toBe("simple");
    expect(graph["38"].inputs).toMatchObject({ shift_video: 6, shift_audio: 3 });
    expect(graph["41"].class_type).toBe("H3SLAAttention");
    expect(graph["omni_vsa"]).toBeUndefined();
    if (native) expect(graph["36"]).toBeUndefined();
    else expect(graph["36"].inputs).toMatchObject({ lora_name: "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors", strength_model: 1 });
    // Legacy order is Combat (when enabled), then automatic Realism.
    const realismId = settings.combatLoraEnabled ? "9002" : "9001";
    if (singularity) expect(graph[realismId].inputs).toMatchObject({ lora_name: H3_REALISM_TEST19_LORA, strength_model: .7 });
    else { expect(graph["9001"]).toBeUndefined(); expect(graph["9002"]).toBeUndefined(); }
    if (singularity && settings.combatLoraEnabled) {
      expect(graph["9001"].inputs).toMatchObject({ lora_name: H3_COMBAT_V2_LORA, strength_model: 1 });
      expect(graph["9002"].inputs.model).toEqual(["9001", 0]);
    }
    expect(graph["24"].inputs.model).toEqual(["164", 0]);
    expect(graph["32"].inputs.model).toEqual(["164", 0]);
  });
  it.each(["rtx3090", "rtx5060ti"] as const)("FastH3 has no legacy checkpoint/adapter/node prerequisites on %s", backend => {
    const assets = h3ExpectedAssetChoicesForBackend(backend, [], "fasth3");
    expect(assets.filter(([node]) => node === "UNETLoader")).toEqual([["UNETLoader", "unet_name", H3_OMNIREF.checkpoint]]);
    expect(assets.some(([node]) => node === "LoraLoaderModelOnly")).toBe(false);
    expect(h3RequiredNodeClassesForBackend(backend, "fasth3")).not.toContain("H3SLAAttention");
    expect(h3RequiredNodeClassesForBackend(backend)).not.toContain("BlockSparseAttention");
  });
  it("never inherits legacy LoRAs and preserves the stored legacy render selection", () => {
    const settings = { ...DEFAULT_H3_ADVANCED_SETTINGS, checkpointMode: "fasth3" as const, renderMode: "native" as const };
    const result = resolveH3RenderSettings(settings);
    expect(result).toMatchObject({ steps: 8, sampler: "euler", turboLora: false, attentionPath: "vsa", singularityLoras: [] });
    expect(result.settings.renderMode).toBe("native");
    const graph = buildH3Workflow({ ...base, h3Settings: settings }).graph;
    expect(graph["30"].inputs.unet_name).toBe(H3_OMNIREF.checkpoint);
    expect(graph["36"]).toBeUndefined(); expect(graph["9001"]).toBeUndefined(); expect(graph["9002"]).toBeUndefined();
    for (const userLoras of [{ visualStyle: "realism" }, { combatMode: "normal" }, { motionRepair: { enabled: true } }]) {
      expect(() => buildH3Workflow({ ...base, h3Settings: settings, userLoras: userLoras as never })).toThrow(/legacy enhancements/);
    }
    for (const mode of ["h3-text-to-video", "h3-image-to-video"] as const) expect(() => buildH3Workflow({ ...base, mode, h3Settings: settings })).toThrow(/only for Reference/);
  });
  it.each(["standard", "singularity"] as const)("Studio preserves Native/Turbo %s without universal Fast substitution", checkpoint => {
    for (const profile of ["native", "ref2va-8step"] as const) {
      const plan = parseH3StudioPlan({ ...DEFAULT_H3_STUDIO_PLAN, workflowId: "native-r2v", checkpoint, profile, ...H3_STUDIO_PROFILES[profile], prompt: "A dragon flies", originalPrompt: "A dragon flies", combatEnabled: checkpoint === "singularity" });
      const { graph, manifest } = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), { nodes: new Set(), models: new Set(), loras: new Set(), observedAt: "" }, null);
      expect(graph["24"].inputs.steps).toBe(profile === "native" ? 20 : 8);
      expect(graph["30"].inputs.unet_name).toBe(checkpoint === "singularity" ? H3_SINGULARITY_CHECKPOINT : "minimax_h3_ref2va_pruned_int8_convrot.safetensors");
      expect(graph["41"].class_type).toBe("H3SLAAttention"); expect(manifest.attention).toBe("project-sla");
      const fast = reconcileH3StudioPlan(plan, { checkpoint: "fasth3" });
      expect(fast).toMatchObject({ steps: 8, sampler: "euler", attention: "vsa", combatEnabled: false });
      expect(() => parseH3StudioPlan({ ...fast, combatEnabled: true })).toThrow(/dedicated/);
      expect(() => parseH3StudioPlan({ ...fast, attention: "project-sla" })).toThrow(/dedicated/);
    }
  });
});
