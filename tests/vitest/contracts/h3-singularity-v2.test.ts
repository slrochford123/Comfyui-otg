import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_H3_ADVANCED_SETTINGS, H3_SINGULARITY_CHECKPOINT, H3_SINGULARITY_LABEL, H3_SINGULARITY_SOURCE, H3_REALISM_TEST19_LORA, H3_COMBAT_V2_LORA } from "@/lib/production/h3Settings";
import { buildH3Workflow } from "@/lib/production/h3Workflows";
import { buildH3RealismWorkflow } from "@/lib/h3SpecialModes/realismWorkflow";
import { DEFAULT_H3_STUDIO_PLAN, H3_STUDIO_PROFILES, parseH3StudioPlan } from "@/lib/h3StudioPlan";
import { compileH3StudioPlan, h3StudioPreviewInput } from "@/lib/h3StudioCompiler";
import { studioCheckpoint } from "@/lib/h3StudioRegistry";

const filename = "Minimax-h3_Singularity_ref2va_v2_pruned_int8.safetensors";
const cases = (["rtx3090", "rtx5060ti"] as const).flatMap(backend =>
  (["h3-text-to-video", "h3-image-to-video", "h3-reference-to-video"] as const).flatMap(mode =>
    (["native", "turbo"] as const).flatMap(renderMode => [false, true].map(combatLoraEnabled =>
      ({ backend, mode, renderMode, combatLoraEnabled })))));
describe("publisher Singularity v2 migration", () => {
  it("pins the publisher checkpoint, not a third-party conversion or renamed v1", () => {
    expect(H3_SINGULARITY_CHECKPOINT).toBe(filename);
    expect(H3_SINGULARITY_LABEL).toBe("Singularity v2");
    expect(H3_SINGULARITY_SOURCE).toEqual({ repository: "WarmBloodAban/Minimax-h3_Singularity", revision: "1259cf16cd0b655ba691a32fb46a409142762972", sha256: "d7637c2c35cd30facd9e93778c491f6d82f91c4a441aecbdb4c384a62a5f3d9f", bytes: 20967647456 });
  });
  it.each(cases)("$backend $mode $renderMode Combat=$combatLoraEnabled uses v2 without changing sampling", row => {
    const { graph } = buildH3Workflow({ ...row, h3Quality: "sh", durationSeconds: 5,
      finalPrompt: "Use <Picture 1> as <Subject 1>. A person walks through a quiet cafe.", seed: 42, outputPrefix: "fixture/v2",
      startImageFilename: row.mode === "h3-image-to-video" ? "first.png" : undefined,
      references: row.mode === "h3-reference-to-video" ? [{ id: "a", name: "Person", sourceKind: "production-upload", pictureSlot: 1, subjectSlot: 1, workflowImage: "person.png", uploadedFilename: "person.png" }] : [],
      h3Settings: { ...DEFAULT_H3_ADVANCED_SETTINGS, checkpointMode: "singularity", renderMode: row.renderMode, combatLoraEnabled: row.combatLoraEnabled } });
    expect(graph["30"].inputs.unet_name).toBe(filename);
    expect(graph["24"].inputs.steps).toBe(row.renderMode === "native" ? 20 : 8);
    expect(graph["18"].inputs.sampler_name).toBe(row.renderMode === "native" ? "res_multistep" : "euler");
    expect(graph["41"].class_type).toBe("H3SLAAttention");
    const loras = Object.values(graph).filter(node => node.class_type === "LoraLoaderModelOnly");
    expect(loras.find(node => node.inputs.lora_name === H3_REALISM_TEST19_LORA)?.inputs.strength_model).toBe(.7);
    expect(loras.some(node => node.inputs.lora_name === H3_COMBAT_V2_LORA)).toBe(row.combatLoraEnabled);
    expect(JSON.stringify(graph)).not.toContain("v1.3");
  });
  it.each(["rtx3090", "rtx5060ti"] as const)("Studio registry and compiler agree on %s for R2V and edit", backend => {
    for (const workflowId of ["native-r2v", "reference-edit"] as const) for (const profile of ["native", "ref2va-8step"] as const) {
      const plan = parseH3StudioPlan({ ...DEFAULT_H3_STUDIO_PLAN, backend, workflowId, checkpoint: "singularity", profile, ...H3_STUDIO_PROFILES[profile], prompt: "A person walks", originalPrompt: "A person walks" });
      expect(studioCheckpoint(plan)).toBe(filename);
      const { graph } = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), { nodes: new Set(), models: new Set(), loras: new Set(), observedAt: "" }, null);
      expect(graph["30"].inputs.unet_name).toBe(filename);
      expect(graph["24"].inputs.steps).toBe(profile === "native" ? 20 : 8);
    }
  });
  it.each([false, true])("Realism special mode uses v2 and preserves independent Combat=%s", combatLoraEnabled => {
    const { graph } = buildH3RealismWorkflow({ prompt: "A person waves", quality: "sh", orientation: "landscape", durationSeconds: 5, seed: 7, outputPrefix: "fixture/v2-realism", checkpointMode: "singularity", combatLoraEnabled, references: [{ kind: "image", name: "person.png", uploadedFilename: "person.png" }] });
    expect(graph["192"].inputs?.unet_name).toBe(filename);
    expect(Object.values(graph).some(node => node.inputs?.lora_name === H3_COMBAT_V2_LORA)).toBe(combatLoraEnabled);
    expect(JSON.stringify(graph)).not.toContain("v1.3");
  });
  it("has no old checkpoint in executable templates and keeps all UI surfaces versioned", () => {
    expect(fs.readFileSync("comfy_workflows/internal/h3-special/realism.api.json", "utf8")).not.toContain("v1.3");
    for (const file of ["H3Panel", "H3AdvancedControls", "H3StudioControls"]) {
      const source = fs.readFileSync(`app/app/components/${file}.tsx`, "utf8");
      expect(source).toContain(file === "H3AdvancedControls" ? "H3SingularitySelector" : "h3SingularityLabel");
      expect(source).not.toContain("Singularity v1.3");
    }
  });
});
