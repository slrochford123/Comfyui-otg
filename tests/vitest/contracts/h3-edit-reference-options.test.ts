import { describe, expect, it } from "vitest";
import { compileH3StudioPlan, h3StudioPreviewInput } from "@/lib/h3StudioCompiler";
import { DEFAULT_H3_STUDIO_PLAN, reconcileH3StudioPlan, studioDimensions, studioFrames } from "@/lib/h3StudioPlan";
import { H3_REF2VA_8STEP_FILE, type H3StudioInventory } from "@/lib/h3StudioRegistry";

const inventory: H3StudioInventory = { nodes: new Set(), models: new Set(), loras: new Set(), observedAt: new Date().toISOString() };
describe("Attached v10 reference-video architecture through the shared compiler (no generation)", () => {
  it.each([2, 4.76, 10])("compiles the actual %s-second reference conditioning with preview, SLA and 8-step Turbo", durationSeconds => {
    const plan = reconcileH3StudioPlan({ ...DEFAULT_H3_STUDIO_PLAN, prompt: "Blue coat", originalPrompt: "Blue coat" }, { workflowId: "reference-edit", profile: "ref2va-8step", durationSeconds });
    const { graph, manifest } = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, null);
    expect(graph["39"].inputs.length).toBe(studioFrames(durationSeconds));
    expect(graph["164"].class_type).toBe("ModelPreviewOverrideKJ");
    expect(graph["32"].inputs.model).toEqual(["164", 0]);
    expect(graph["24"].inputs.steps).toBe(8);
    expect(graph["36"].inputs.lora_name).toBe(H3_REF2VA_8STEP_FILE);
    expect(graph["41"].inputs.enabled).toBe(true);
    expect(manifest.plan.durationSeconds).toBe(durationSeconds);
  });
  for (const quality of ["0.2", "0.6", "1"] as const) for (const orientation of ["landscape", "portrait"] as const) for (const profile of ["native", "ref2va-8step"] as const) {
    it(`compiles ${quality} MP / ${orientation} / ${profile} with real SLA and matching model links`, () => {
      const plan = reconcileH3StudioPlan({ ...DEFAULT_H3_STUDIO_PLAN, prompt: "Change the coat to blue", originalPrompt: "Change the coat to blue" }, { workflowId: "reference-edit", quality, orientation, profile, attention: "project-sla" });
      const compiled = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, null);
      const graph = compiled.graph;
      expect(graph["30"].inputs.unet_name).toMatch(/ref2va/i);
      expect(graph["39"].class_type).toBe("MiniMaxH3ReferenceToVideo");
      expect(graph["39"].inputs["ref_videos.ref_video_0"]).toEqual(["studio_fit", 0]);
      expect(graph.studio_fit.inputs).toMatchObject(studioDimensions(plan));
      expect(graph["39"].inputs).toMatchObject(studioDimensions(plan));
      expect(graph["41"]).toMatchObject({ class_type: "H3SLAAttention", inputs: { enabled: true, engine: "comfy_kitchen" } });
      expect(graph["24"].inputs.steps).toBe(profile === "native" ? 20 : 8);
      expect(graph["18"].inputs.sampler_name).toBe(profile === "native" ? "res_multistep" : "euler");
      const adapters = Object.values(graph).filter(node => node.class_type === "LoraLoaderModelOnly").map(node => node.inputs.lora_name);
      expect(adapters.includes(H3_REF2VA_8STEP_FILE)).toBe(profile === "ref2va-8step");
      expect(JSON.stringify(graph)).not.toContain("minimax_h3_turbo_v4_step_xx");
      expect(compiled.manifest.gpu).toBe("rtx3090");
      expect(compiled.manifest.executable).toBe(false); // Empty fixture inventory is not physical qualification.
    });
  }
});
