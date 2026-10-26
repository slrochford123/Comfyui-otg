import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_H3_STUDIO_PLAN, H3_STUDIO_PROFILES, H3_STUDIO_WORKFLOWS, automaticH3Plan, type H3StudioPlan } from "@/lib/h3StudioPlan";
import { compileH3StudioPlan, h3StudioPreviewInput, sanitizeH3StudioGraph } from "@/lib/h3StudioCompiler";
import { h3Stage1cDecisions, h3StudioCatalog, studioCheckpoint, studioEvidenceKey, type H3StudioInventory, type H3StudioEvidence } from "@/lib/h3StudioRegistry";
const plan: H3StudioPlan = { ...DEFAULT_H3_STUDIO_PLAN, prompt: "A harmless fixture", originalPrompt: "A harmless fixture" };
const inventory: H3StudioInventory = { nodes: new Set(), models: new Set([studioCheckpoint(plan)]), loras: new Set(), observedAt: "2026-10-23" };
beforeEach(() => { vi.stubEnv("OTG_ENV", "test"); vi.stubEnv("OTG_H3_STUDIO_EVIDENCE_FILE", ""); });
describe("H3 canonical catalog / compiler", () => {
  it.each(["native-t2v", "native-i2v", "native-r2v", "reference-edit"] as const)("Auto compiles %s with SLA, matching Turbo and preview chain", workflowId => {
    const p = automaticH3Plan({ ...plan, workflowId });
    const { graph } = compileH3StudioPlan(p, h3StudioPreviewInput(p), inventory, null);
    expect(graph["24"].inputs.steps).toBe(8);
    if (workflowId === "native-r2v") {
      expect(graph["omni_vsa"]).toMatchObject({ class_type: "BlockSparseAttention", inputs: { selection: "vsa" } });
      expect(graph["36"]).toBeUndefined();
      expect(graph["38"].inputs.model).toEqual(["30", 0]);
    } else {
      expect(graph["41"]).toMatchObject({ class_type: "H3SLAAttention", inputs: { enabled: true } });
      expect(graph["36"].inputs.lora_name).toMatch(workflowId === "native-t2v" || workflowId === "native-i2v" ? /fl2v_turbo_8step/ : /ref2v_turbo_8step/);
      expect(graph["36"].inputs.model).toEqual(["30", 0]);
      expect(graph["38"].inputs.model).toEqual(["36", 0]);
    }
    expect(graph["164"].class_type).toBe("ModelPreviewOverrideKJ");
    expect(graph["32"].inputs.model).toEqual(["164", 0]);
  });
  it("preserves 60 SELECT, 4 MAYBE, 76 SKIP and 13 UNDECIDED without installing anything", () => {
    const d = h3Stage1cDecisions(); expect([d.selected.length, d.maybe.length, d.skipped.length, d.undecided.length]).toEqual([60, 4, 76, 13]);
    expect(new Set([...d.selected, ...d.maybe, ...d.skipped, ...d.undecided].map(e => e.versionId)).size).toBe(153);
    expect(h3StudioCatalog(inventory, null)).toHaveLength(60);
  });
  it("a worker-listed filename alone does not confer runtime, hash or license approval", () => {
    const entry = h3Stage1cDecisions().selected.find(e => e.fileNames)!;
    const catalog = h3StudioCatalog({ ...inventory, loras: new Set([entry.fileNames!]) }, null);
    const item = catalog.find(c => c.versionId === entry.versionId)!;
    expect(item.installation).toBe("listed-by-worker"); expect(item.sha256).toBeNull(); expect(item.rights).toBe("unresolved"); expect(item.blockedReasons).not.toHaveLength(0);
  });
  it.each(H3_STUDIO_WORKFLOWS.flatMap(w => (["0.2", "0.6", "1"] as const).flatMap(quality => (["portrait", "landscape"] as const).map(orientation => [w.id, quality, orientation] as const))))("compiles %s %s %s through the existing engine", (workflowId, quality, orientation) => {
    const p = { ...plan, workflowId, quality, orientation };
    const result = compileH3StudioPlan(p, h3StudioPreviewInput(p), inventory, null);
    expect(result.graph["39"].inputs.width).toBe(result.manifest.width);
    expect(result.graph["39"].inputs.height).toBe(result.manifest.height);
    expect(result.graph["24"].inputs.steps).toBe(workflowId === "native-r2v" ? 8 : 20); expect(result.graph["18"].inputs.sampler_name).toBe(workflowId === "native-r2v" ? "euler" : "res_multistep");
    expect(result.graph["36"]).toBeUndefined(); expect(result.manifest.executable).toBe(false);
    expect(result.manifest.blockedReasons).toContain("QUALIFICATION_RECORD_REQUIRED");
  });
  it("pins RTX 3090 instead of falling back to the app host", () => expect(() => compileH3StudioPlan(plan, { ...h3StudioPreviewInput(plan), backend: "rtx5060ti" }, inventory, null)).toThrow(/3090/));
  it("uses OmniRef without requiring the old Ref2VA acceleration adapter", () => {
    const p: H3StudioPlan = { ...plan, workflowId: "native-r2v", profile: "ref2va-8step", ...H3_STUDIO_PROFILES["ref2va-8step"] };
    const result = compileH3StudioPlan(p, h3StudioPreviewInput(p), inventory, null);
    expect(result.manifest.blockedReasons).not.toContain("MATCHING_REF2VA_8STEP_ADAPTER_MISSING");
    expect(result.graph["36"]).toBeUndefined();
    expect(result.graph["30"].inputs.unet_name).toBe("fasth3_omniref_8step_pruned_int8_convrot.safetensors");
    expect(result.graph["24"].inputs.steps).toBe(8); expect(result.graph["18"].inputs.sampler_name).toBe("euler"); expect(result.graph["38"].inputs.shift_video).toBe(12);
  });
  it("uses actual H3 SLA or explicit dense, never imaginary SolAttn/Sage activation", () => {
    for (const attention of ["dense", "project-sla"] as const) {
      const p = { ...plan, attention }; const result = compileH3StudioPlan(p, h3StudioPreviewInput(p), inventory, null);
      expect(result.graph["41"].class_type).toBe("H3SLAAttention"); expect(result.graph["41"].inputs.enabled).toBe(attention === "project-sla");
      expect(Object.values(result.graph).some(n => n.class_type === "SolAttnPatch")).toBe(false);
    }
  });
  it("source/mute policies do not accidentally mux H3-generated audio", () => {
    for (const audio of ["original", "mute", "generated"] as const) {
      const p: H3StudioPlan = { ...plan, workflowId: "reference-edit", audio }; const result = compileH3StudioPlan(p, h3StudioPreviewInput(p), inventory, null);
      expect(!!result.graph["34"].inputs.audio).toBe(audio === "generated");
      expect(result.graph["39"].inputs["ref_videos.ref_video_0"]).toBeDefined();
    }
  });
  it("does not activate an unqualified LoRA, including disabled entries forced through an API", () => {
    const p = { ...plan, loras: [{ id: "civitai-2966038-3360700", strength: 1, enabled: true }] };
    expect(() => compileH3StudioPlan(p, h3StudioPreviewInput(p), inventory, null)).toThrow(/not available/);
  });
  it("requires exact workflow provenance, model hash, physical job and measured quote", () => {
    const first = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inventory, null);
    const readyInventory = { ...inventory, nodes: new Set(Object.values(first.graph).map(n => n.class_type)) };
    const proof = { version: plan.version, environment: "test", target: "3090", upstreamRightsReference: "mock owner grant", loras: {}, workflows: {
      [studioEvidenceKey(plan)]: { validationJob: "mock fixture only", modelSha256: "a".repeat(64), templateSha256: first.manifest.templateSha256, generationCredits: 0, measuredSeconds: 100,
        assets: Object.values(first.graph).filter(n => ["UNETLoader", "CLIPLoader", "VAELoader", "LoraLoaderModelOnly"].includes(n.class_type)).map(n => ({ filename: String(n.inputs.unet_name || n.inputs.clip_name || n.inputs.vae_name || n.inputs.lora_name), sha256: "a".repeat(64), bytes: 1, rightsReference: "mock only" })) } } } as unknown as H3StudioEvidence;
    expect(compileH3StudioPlan(plan, h3StudioPreviewInput(plan), readyInventory, proof).manifest.executable).toBe(false);
    const changed = { ...plan, quality: "1" as const };
    expect(compileH3StudioPlan(changed, h3StudioPreviewInput(changed), readyInventory, proof).manifest.executable).toBe(false);
  });
  it("sanitizes private paths, URLs, input filenames and output prefix", () => {
    const graph = sanitizeH3StudioGraph({ x: { class_type: "LoadVideo", inputs: { file: "/private/source.mp4", image: "owner.png", endpoint: "https://private/", filename_prefix: "owner/output" } } });
    const text = JSON.stringify(graph); expect(text).not.toContain("/private"); expect(text).not.toContain("owner.png"); expect(text).not.toContain("owner/output"); expect(text).not.toContain("https://");
  });
});
