import { describe, expect, it } from "vitest";
import { buildH3Workflow, h3ExpectedAssetChoicesForBackend, h3RequiredNodeClassesForBackend } from "@/lib/production/h3Workflows";
import { DEFAULT_H3_ADVANCED_SETTINGS, resolveH3RenderSettings } from "@/lib/production/h3Settings";
import { H3_OMNIREF } from "@/lib/h3OmniRef";
import { H3_SELF_LIFT } from "@/lib/h3SelfLift";
import { DEFAULT_H3_STUDIO_PLAN, automaticH3Plan, parseH3StudioPlan, reconcileH3StudioPlan } from "@/lib/h3StudioPlan";
import { compileH3StudioPlan, h3StudioPreviewInput } from "@/lib/h3StudioCompiler";
import { h3StudioQualificationFingerprint } from "@/lib/h3StudioIdentity";
import { validateStudioReadiness } from "@/lib/h3StudioRegistry";

const settings = { ...DEFAULT_H3_ADVANCED_SETTINGS, checkpointMode: "selflift" as const, renderMode: "native" as const };
const base = { backend: "rtx5060ti" as const, mode: "h3-reference-to-video" as const,
  durationSeconds: 10 as const, h3Quality: "hq" as const, finalPrompt: "Use <Picture 1> as <Subject 1>. Use <Picture 2> as <Subject 2>. Two distinct café friends meet.", seed: 424242,
  outputPrefix: "fixture/selflift", h3Settings: settings,
  references: ["a", "b"].map((id, i) => ({ id, name: id, sourceKind: "production-upload" as const,
    pictureSlot: i + 1, subjectSlot: i + 1, workflowImage: `${id}.png`, uploadedFilename: `${id}.png` })) };
const variants = (["rtx3090", "rtx5060ti"] as const).flatMap(backend => (["sh", "lq", "hq"] as const).flatMap(h3Quality =>
  (["landscape", "portrait"] as const).flatMap(orientation => ([5, 10] as const).map(durationSeconds => ({ backend, h3Quality, orientation, durationSeconds })))));

describe("independent SelfLift Reference-to-Video compilation", () => {
  it.each(variants)("compiles $backend $h3Quality $orientation $durationSeconds without changing reference/AV/preview routing", variant => {
    const built = buildH3Workflow({ ...base, ...variant });
    const g = built.graph;
    expect(built.workflowId).toBe(`${H3_SELF_LIFT.id}:${variant.backend}:${variant.durationSeconds}:${variant.h3Quality}`);
    expect(g["30"].inputs.unet_name).toBe(H3_OMNIREF.checkpoint);
    expect(g["21"].class_type).toBe("SelfLiftH3Sampler");
    expect(g["21"].inputs).toMatchObject({ model: ["164", 0], positive: ["39", 0], negative: ["selflift_negative", 0],
      latent_image: ["39", 1], vae: ["3", 0], seed: 424242, cfg: 1, transition_step: 6,
      lowres_scale: 0.5, rho: 0, upscaler_model: H3_SELF_LIFT.upscaler, upscaler_unload: true, highres_tiling: false });
    expect(g["24"].inputs.steps).toBe(8); expect(g["18"].inputs.sampler_name).toBe("euler");
    expect(g["38"].inputs).toMatchObject({ shift_video: 12, shift_audio: 3 });
    expect(g["omni_vsa"].inputs.selection).toBe("vsa");
    expect(g["164"].class_type).toBe("ModelPreviewOverrideKJ");
    expect(g["164"].inputs.model).toEqual(["omni_vsa", 0]);
    expect(g["14"].inputs.samples).toEqual(["21", 0]);
    expect(g["25"].inputs.samples).toEqual(["21", 0]);
    expect(g["39"].inputs["ref_images.ref_image_0"]).toBeDefined();
    expect(g["39"].inputs["ref_images.ref_image_1"]).toBeDefined();
    expect(g["selflift_negative"].inputs.conditioning).toEqual(["39", 0]);
    for (const n of Object.values(g)) {
      expect(n.class_type).not.toMatch(/^Bench/);
      for (const v of Object.values(n.inputs)) if (Array.isArray(v) && v[0] === "21") expect(v[1]).toBe(0);
    }
    expect(g["36"]).toBeUndefined(); expect(g["9001"]).toBeUndefined(); expect(g["9002"]).toBeUndefined();
  });
  it("does not silently turn ordinary FastH3 into SelfLift", () => {
    const g = buildH3Workflow({ ...base, h3Settings: { ...settings, checkpointMode: "fasth3" } }).graph;
    expect(g["21"].class_type).toBe("SamplerCustomAdvanced");
    expect(g["14"].inputs.samples).toEqual(["21", 1]); expect(g["selflift_negative"]).toBeUndefined();
    expect(resolveH3RenderSettings(settings)).toMatchObject({ steps: 8, sampler: "euler", turboLora: false, attentionPath: "vsa", singularityLoras: [] });
  });
  it.each(["h3-text-to-video", "h3-image-to-video"] as const)("does not pretend the R2V SelfLift profile supports %s", mode => {
    expect(() => buildH3Workflow({ ...base, mode })).toThrow(/only for Reference/);
  });
  it("keeps worker prerequisites independent from FastH3 and demands the exact lifter", () => {
    expect(h3RequiredNodeClassesForBackend("rtx5060ti", "selflift")).toContain("SelfLiftH3Sampler");
    expect(h3RequiredNodeClassesForBackend("rtx5060ti", "fasth3")).not.toContain("SelfLiftH3Sampler");
    expect(h3ExpectedAssetChoicesForBackend("rtx5060ti", [], "selflift")).toContainEqual(["SelfLiftH3Sampler", "upscaler_model", H3_SELF_LIFT.upscaler]);
    expect(h3ExpectedAssetChoicesForBackend("rtx5060ti", [], "fasth3")).not.toContainEqual(["SelfLiftH3Sampler", "upscaler_model", H3_SELF_LIFT.upscaler]);
  });
  it("shares Studio/Auto compilation but not FastH3's qualification identity", () => {
    const plan = reconcileH3StudioPlan({ ...DEFAULT_H3_STUDIO_PLAN, workflowId: "native-r2v", backend: "rtx5060ti", prompt: "Café friends", originalPrompt: "Café friends" }, { checkpoint: "selflift" });
    expect(automaticH3Plan(plan)).toMatchObject({ checkpoint: "selflift", steps: 8, sampler: "euler", attention: "vsa" });
    expect(() => parseH3StudioPlan({ ...plan, steps: 20 })).toThrow(/dedicated/);
    expect(() => parseH3StudioPlan({ ...plan, combatEnabled: true })).toThrow(/dedicated/);
    expect(() => parseH3StudioPlan({ ...plan, attention: "project-sla" })).toThrow(/dedicated/);
    const inventory = { nodes: new Set<string>(), models: new Set<string>(), loras: new Set<string>(), observedAt: "" };
    const built = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, null);
    expect(built.graph["21"].class_type).toBe("SelfLiftH3Sampler");
    const reasons = validateStudioReadiness(plan, inventory, null, "x");
    expect(reasons).toContain("SELFLIFT_NODE_MISSING_ON_SELECTED_GPU");
    expect(reasons).toContain("SELFLIFT_LATENT_LIFTER_MISSING_ON_SELECTED_GPU");
    expect(reasons).not.toContain("MATCHING_REF2VA_8STEP_ADAPTER_MISSING");
    const next = reconcileH3StudioPlan(plan, { workflowId: "native-t2v" });
    expect(next).toMatchObject({ checkpoint: "standard", attention: "project-sla" });
    const fingerprint = (p: typeof plan, graph = built.graph) => h3StudioQualificationFingerprint({ plan: p, graph, templateSha256: "a".repeat(64), dependencies: [] });
    const clone = structuredClone(built.graph); clone["21"].inputs.seed = 123;
    expect(fingerprint({ ...plan, seed: 123 }, clone)).toBe(fingerprint(plan));
    clone["21"].inputs.transition_step = 5;
    expect(fingerprint(plan, clone)).not.toBe(fingerprint(plan));
    expect(fingerprint({ ...plan, checkpoint: "fasth3" })).not.toBe(fingerprint(plan));
  });
});
