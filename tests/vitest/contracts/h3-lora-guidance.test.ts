import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import installed from "@/lib/h3Stage1cInstalled.json";
import { applyH3LoraTriggers, h3LoraDefaultStrength, h3RegisteredLoraStrengthBounds } from "@/lib/h3LoraGuidance";
import { readH3LoraCatalog, validateH3LoraSelections } from "@/lib/h3LoraCatalogServer";
import { buildH3Workflow } from "@/lib/production/h3Workflows";
import { DEFAULT_H3_STUDIO_PLAN, parseH3StudioPlan, reconcileH3StudioPlan } from "@/lib/h3StudioPlan";
import { compileH3StudioPlan, h3StudioPreviewInput } from "@/lib/h3StudioCompiler";
import { assertH3PlannerCapabilityIdentity, buildH3DirectorInput } from "@/lib/h3StudioPlanner";

const byVersion = (id: number) => installed.entries.find(entry => entry.versionId === id)!;
const selection = (id: number, strength = 1) => ({ filename: byVersion(id).filename, strength });
const style = byVersion(3302128), slider = byVersion(3389300);
const input = { backend: "rtx3090" as const, mode: "h3-reference-to-video" as const, h3Quality: "sh" as const, durationSeconds: 5 as const,
  finalPrompt: "<Picture 1> is <Subject 1>, a dragon. It flies above clouds.", seed: 42, outputPrefix: "fixture/guidance",
  references: [{ id: "fixture", name: "Dragon", sourceKind: "production-upload" as const, pictureSlot: 1, subjectSlot: 1, workflowImage: "dragon.png", uploadedFilename: "dragon.png" }] };
const scratch: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("version-specific H3 author guidance and automatic triggers", () => {
  it.each(installed.entries)("injects only documented triggers for $versionId and is idempotent", entry => {
    const selected = [{ filename: entry.filename, strength: entry.defaultStrength }];
    const actual = applyH3LoraTriggers("A dragon flies", selected);
    for (const trigger of entry.triggerWords) expect(actual).toContain(trigger);
    if (!entry.triggerWords.length) expect(actual).toBe("A dragon flies");
    expect(applyH3LoraTriggers(actual, selected)).toBe(actual);
    expect(entry.guidance.source).toContain(`modelVersionId=${entry.versionId}`);
  });
  it("does not duplicate case/spacing variants or mistake body for the DY trigger", () => {
    expect(applyH3LoraTriggers("CE L SHADING", [selection(3360700)])).toContain("Cel Shading Style");
    expect(applyH3LoraTriggers("cel  shading STYLE, a dragon", [selection(3360700)])).toBe("cel  shading STYLE, a dragon");
    expect(applyH3LoraTriggers("A body moves", [selection(3267949)])).toBe("A body moves\nDY");
    expect(applyH3LoraTriggers("DY, a dragon", [selection(3267949)])).toBe("DY, a dragon");
  });
  it("skips disabled/zero adapters and shares repeated trigger phrases without changing the source text", () => {
    const prompt = "A dragon flies";
    expect(applyH3LoraTriggers(prompt, [{ ...selection(3360700), enabled: false }, selection(3302128, 0)])).toBe(prompt);
    expect(applyH3LoraTriggers(prompt, [selection(3366092), selection(3268186)]).match(/bunny_crisp_motion/g)).toHaveLength(1);
    expect(prompt).toBe("A dragon flies");
  });
  it("does not insert conflicting options, character lists, unfilled templates or stale client triggers", () => {
    expect(applyH3LoraTriggers("A dragon flies", [selection(3363310)])).toBe("A dragon flies\ncinematic");
    expect(applyH3LoraTriggers("Change the sky", [selection(3346199)])).toBe("vfx_edit: Change the sky");
    expect(applyH3LoraTriggers("<Video 1>\n\nvfx_edit: Change sky", [selection(3346199)])).toBe("vfx_edit: <Video 1>\n\nChange sky");
    expect(applyH3LoraTriggers("A dragon flies", [{ ...selection(3392712), triggerWords: ["SHW_CYB", "char_david"] }])).toBe("A dragon flies\n2d anime style, Edgerunners style.");
  });
  it("has three honestly unavailable upstream records, not invented author recommendations", () => {
    const unavailable = installed.entries.filter(entry => entry.guidance.status === "upstream-unavailable");
    expect(unavailable.map(entry => entry.versionId).sort()).toEqual([3290797, 3354289, 3361782]);
    for (const entry of unavailable) { expect(entry.guidance.recommendedMin).toBeNull(); expect(entry.guidance.recommendedMax).toBeNull(); }
  });
  it("uses author starting values and mode-specific I2V guidance, not the minimum zero", () => {
    expect(h3LoraDefaultStrength(byVersion(3294020).filename)).toBe(.9);
    expect(h3LoraDefaultStrength(byVersion(3256084).filename)).toBe(.6);
    expect(h3LoraDefaultStrength(byVersion(3361017).filename, 1, 0, 2, "h3-image-to-video")).toBe(.4);
    expect(h3LoraDefaultStrength(slider.filename, 1, -8, 8)).toBe(4);
    expect(h3RegisteredLoraStrengthBounds(`civitai-${slider.modelId}-${slider.versionId}`)).toEqual({ min: -8, max: 8 });
    expect(h3RegisteredLoraStrengthBounds("civitai-1-2")).toEqual({ min: 0, max: 2 });
  });
  it.each(["rtx3090", "rtx5060ti"] as const)("injects into the executable conditioning node for all five render choices on %s", backend => {
    for (const checkpointMode of ["standard", "singularity", "fasth3"] as const) for (const renderMode of checkpointMode === "fasth3" ? ["turbo"] as const : ["native", "turbo"] as const) {
      const built = buildH3Workflow({ ...input, backend, h3Settings: { checkpointMode, renderMode }, optionalLoras: [{ ...selection(style.versionId), id: "test", label: style.displayName }] });
      expect(built.graph["39"].inputs.prompt).toContain(style.triggerWords[0]);
      if (checkpointMode === "singularity") expect(built.graph["39"].inputs.prompt).toContain("r34l1sm");
      expect(built.graph["24"].inputs.steps).toBe(renderMode === "native" ? 20 : 8);
    }
  });
  it("injects enabled Studio LoRAs consistently in preview and execution with no trigger checkbox", () => {
    vi.stubEnv("OTG_ENV", "prod"); vi.stubEnv("OTG_H3_LORA_CATALOG_FILE", "/nonexistent/test-guidance");
    const plan = reconcileH3StudioPlan({ ...DEFAULT_H3_STUDIO_PLAN, workflowId: "native-r2v", prompt: "A dragon flies", originalPrompt: "A dragon flies",
      loras: [{ id: `civitai-${style.modelId}-${style.versionId}`, strength: 1, enabled: true }, { id: `civitai-${byVersion(3360700).modelId}-3360700`, strength: 1, enabled: false }] }, { checkpoint: "fasth3" });
    const inv = { nodes: new Set<string>(), models: new Set<string>(), loras: new Set([style.filename]), observedAt: "" };
    const result = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inv, null);
    expect(result.graph["39"].inputs.prompt).toContain(style.triggerWords[0]);
    expect(result.graph["39"].inputs.prompt).not.toContain("Cel Shading Style");
    expect(plan.prompt).toBe("A dragon flies");
  });
  it("preserves Admin disabled states while upgrading obsolete generic slider limits in memory only", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "h3-guidance-")); scratch.push(dir);
    const file = path.join(dir, "catalog.json");
    const value = { entries: [{ id: `stage1c-${slider.versionId}`, filename: slider.filename, displayName: slider.displayName, enabled: false, minStrength: 0, maxStrength: 2, defaultStrength: 1 }] };
    fs.writeFileSync(file, JSON.stringify(value)); vi.stubEnv("OTG_H3_LORA_CATALOG_FILE", file);
    const actual = readH3LoraCatalog().entries[0];
    expect(actual).toMatchObject({ enabled: false, minStrength: -8, maxStrength: 8, defaultStrength: 4 });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(value);
    expect(() => validateH3LoraSelections([{ id: actual.id, strength: 4 }], "h3-reference-to-video")).toThrow(/approved and enabled/);
  });
  it("validates signed slider ranges per ID through plan, policy and director capability boundaries", () => {
    vi.stubEnv("OTG_ENV", "prod"); vi.stubEnv("OTG_H3_LORA_CATALOG_FILE", "/nonexistent/test-guidance");
    const plan = { ...DEFAULT_H3_STUDIO_PLAN, workflowId: "native-r2v" as const, prompt: "A dragon flies", originalPrompt: "A dragon flies", loras: [{ id: `civitai-${slider.modelId}-${slider.versionId}`, strength: -4, enabled: true }] };
    expect(parseH3StudioPlan(plan).loras[0].strength).toBe(-4);
    expect(validateH3LoraSelections([{ id: `stage1c-${slider.versionId}`, strength: 4 }], "h3-reference-to-video").resolved[0].strength).toBe(4);
    expect(() => parseH3StudioPlan({ ...plan, loras: [{ ...plan.loras[0], strength: 8.01 }] })).toThrow();
    expect(() => parseH3StudioPlan({ ...plan, loras: [{ id: `civitai-${style.modelId}-${style.versionId}`, strength: -4, enabled: true }] })).toThrow();
    const capability = { id: "registered", plan: { ...plan, loras: [] }, qualificationFingerprint: "a".repeat(64), installedWorkflow: true,
      allowedLoras: [{ id: plan.loras[0].id, name: slider.displayName, minStrength: -8, maxStrength: 8, recommendedStrength: 4, triggerWords: [] }] };
    expect(assertH3PlannerCapabilityIdentity(plan, [capability]).installedWorkflow).toBe(true);
    expect(buildH3DirectorInput(plan, { metadata: [], images: [], contentSent: false }, [capability]).availableCapabilities[0].allowedLoras![0].recommendedStrength).toBe(4);
    const built = buildH3Workflow({ ...input, h3Settings: { checkpointMode: "fasth3" }, optionalLoras: [{ ...selection(slider.versionId, -4), id: "slider", label: slider.displayName }] });
    expect(built.graph["70"].inputs.strength_model).toBe(-4);
    expect(built.graph["39"].inputs.prompt).toBe(input.finalPrompt);
  });
});
