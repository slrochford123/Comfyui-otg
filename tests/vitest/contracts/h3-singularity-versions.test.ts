import { describe, expect, it } from "vitest";
import { DEFAULT_H3_ADVANCED_SETTINGS, H3_SINGULARITY_CHECKPOINT, H3_SINGULARITY_V13_CHECKPOINT,
  H3_REALISM_TEST19_LORA, H3_COMBAT_V2_LORA, normalizeH3AdvancedSettings, h3SingularityLabel } from "@/lib/production/h3Settings";
import { buildH3Workflow, h3TurboLoraForMode } from "@/lib/production/h3Workflows";
import { buildH3RealismWorkflow } from "@/lib/h3SpecialModes/realismWorkflow";
import { validateH3RealismJobInput } from "@/lib/h3SpecialModes/realismJobs";
import { DEFAULT_H3_STUDIO_PLAN, H3_STUDIO_PROFILES, parseH3StudioPlan, reconcileH3StudioPlan, automaticH3Plan } from "@/lib/h3StudioPlan";
import { compileH3StudioPlan, h3StudioPreviewInput } from "@/lib/h3StudioCompiler";
import { studioCheckpoint } from "@/lib/h3StudioRegistry";
import { getH3SpeedRating } from "@/lib/h3SpeedRating";

const versions = [
  { checkpointMode: "singularity-v1.3", filename: H3_SINGULARITY_V13_CHECKPOINT, label: "Singularity v1.3" },
  { checkpointMode: "singularity", filename: H3_SINGULARITY_CHECKPOINT, label: "Singularity v2" },
] as const;
const matrix = versions.flatMap(version => (["rtx3090", "rtx5060ti"] as const).flatMap(backend =>
  (["h3-text-to-video", "h3-image-to-video", "h3-reference-to-video"] as const).flatMap(mode =>
    (["native", "turbo"] as const).flatMap(renderMode => [false, true].map(combatLoraEnabled =>
      ({ ...version, backend, mode, renderMode, combatLoraEnabled }))))));
describe("explicit independent Singularity versions", () => {
  it("keeps existing persisted Singularity selections on v2; v1.3 survives normalization and JSON", () => {
    for (const version of versions) {
      const value = normalizeH3AdvancedSettings(JSON.parse(JSON.stringify({ ...DEFAULT_H3_ADVANCED_SETTINGS, checkpointMode: version.checkpointMode })));
      expect(value.checkpointMode).toBe(version.checkpointMode);
      expect(h3SingularityLabel(value.checkpointMode)).toBe(version.label);
    }
    expect(normalizeH3AdvancedSettings({ checkpointMode: "singularity-v9" }).checkpointMode).toBe("standard");
  });
  it.each(matrix)("$checkpointMode $backend $mode $renderMode Combat=$combatLoraEnabled", row => {
    const { graph } = buildH3Workflow({ ...row, h3Quality: "sh", durationSeconds: 5, seed: 42, outputPrefix: "fixture/dual",
      finalPrompt: "<Picture 1> is <Subject 1>. A person walks through a cafe.",
      startImageFilename: row.mode === "h3-image-to-video" ? "first.png" : undefined,
      references: row.mode === "h3-reference-to-video" ? [{ id: "a", name: "Person", sourceKind: "production-upload", pictureSlot: 1, subjectSlot: 1, workflowImage: "person.png", uploadedFilename: "person.png" }] : [],
      h3Settings: { ...DEFAULT_H3_ADVANCED_SETTINGS, ...row } });
    expect(graph["30"].inputs.unet_name).toBe(row.filename);
    expect(graph["24"].inputs.steps).toBe(row.renderMode === "native" ? 20 : 8);
    expect(graph["18"].inputs.sampler_name).toBe(row.renderMode === "native" ? "res_multistep" : "euler");
    expect(graph["41"].class_type).toBe("H3SLAAttention");
    const loras = Object.values(graph).filter(node => node.class_type === "LoraLoaderModelOnly");
    expect(loras.find(node => node.inputs.lora_name === H3_REALISM_TEST19_LORA)?.inputs.strength_model).toBe(.7);
    expect(loras.some(node => node.inputs.lora_name === H3_COMBAT_V2_LORA)).toBe(row.combatLoraEnabled);
    expect(loras.some(node => node.inputs.lora_name === h3TurboLoraForMode(row.mode))).toBe(row.renderMode === "turbo");
    expect(graph["39"].inputs.prompt).toContain("r34l1sm");
    expect(getH3SpeedRating(row, "0.2")).toBe(row.renderMode === "native" ? "medium" : "fast");
  });
  it.each(versions)("Studio, edit, automatic and Realism retain $label", version => {
    for (const backend of ["rtx3090", "rtx5060ti"] as const) for (const workflowId of ["native-r2v", "reference-edit"] as const) for (const profile of ["native", "ref2va-8step"] as const) {
      const plan = parseH3StudioPlan({ ...DEFAULT_H3_STUDIO_PLAN, backend, workflowId, checkpoint: version.checkpointMode,
        profile, ...H3_STUDIO_PROFILES[profile], combatEnabled: true, prompt: "A person walks", originalPrompt: "A person walks" });
      expect(parseH3StudioPlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
      expect(studioCheckpoint(plan)).toBe(version.filename);
      const compiled = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), { nodes: new Set(), models: new Set(), loras: new Set(), observedAt: "" }, null);
      expect(compiled.graph["30"].inputs.unet_name).toBe(version.filename);
      expect(compiled.manifest.automaticRealism).toBe(true);
      expect(reconcileH3StudioPlan(plan, { checkpoint: version.checkpointMode }).combatEnabled).toBe(true);
      const automatic = automaticH3Plan(plan);
      expect(automatic).toMatchObject({ checkpoint: version.checkpointMode, steps: 8, attention: "project-sla", combatEnabled: true });
      const input = validateH3RealismJobInput({ targetBackend: backend, checkpointMode: version.checkpointMode, combatLoraEnabled: true,
        quality: "sh", orientation: "landscape", durationSeconds: 5, seed: 42, prompt: "A person walks", references: [] });
      expect(input.checkpointMode).toBe(version.checkpointMode);
      const { graph } = buildH3RealismWorkflow({ ...input, references: [], outputPrefix: "fixture/realism" });
      expect(graph["192"].inputs?.unet_name).toBe(version.filename);
      expect(Object.values(graph).some(node => node.inputs?.lora_name === H3_COMBAT_V2_LORA)).toBe(true);
    }
  });
  it("binds different Studio identities and summaries to the two checkpoints", () => {
    const results = versions.map(version => {
      const plan = parseH3StudioPlan({ ...DEFAULT_H3_STUDIO_PLAN, workflowId: "native-r2v", checkpoint: version.checkpointMode,
        profile: "ref2va-8step", ...H3_STUDIO_PROFILES["ref2va-8step"], prompt: "A person walks", originalPrompt: "A person walks" });
      return compileH3StudioPlan(plan, h3StudioPreviewInput(plan), { nodes: new Set(), models: new Set(), loras: new Set(), observedAt: "" }, null);
    });
    expect(results[0].manifest.model).toBe(H3_SINGULARITY_V13_CHECKPOINT);
    expect(results[1].manifest.model).toBe(H3_SINGULARITY_CHECKPOINT);
    expect(results[0].manifest.qualificationFingerprint).not.toBe(results[1].manifest.qualificationFingerprint);
  });
});
