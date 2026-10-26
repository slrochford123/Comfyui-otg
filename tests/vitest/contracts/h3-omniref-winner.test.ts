import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { buildH3Workflow, h3ExpectedAssetChoicesForBackend } from "@/lib/production/h3Workflows";
import { H3_OMNIREF, h3OmniRefEncoder } from "@/lib/h3OmniRef";
import { automaticH3Plan, DEFAULT_H3_STUDIO_PLAN, parseH3StudioPlan, reconcileH3StudioPlan } from "@/lib/h3StudioPlan";
import { compileH3StudioPlan, h3StudioPreviewInput } from "@/lib/h3StudioCompiler";
import { applyComfyBinaryPreviewEvent, readComfyPromptProgress } from "@/lib/comfyProgress";

const base = { ...DEFAULT_H3_STUDIO_PLAN, prompt: "A fire dragon flies", originalPrompt: "A fire dragon flies" };
afterEach(() => vi.unstubAllEnvs());
describe("owner-selected OmniRef C integration", () => {
  it("ships matching Production/Story Creator reference export examples, without benchmark media", () => {
    for (const [file, backend] of [["production-v2/fasth3_omniref_r2v_rtx3090.json", "rtx3090"], ["production-v2/fasth3_omniref_r2v_rtx5060ti.json", "rtx5060ti"]] as const) {
      const graph = JSON.parse(fs.readFileSync(`comfy_workflows/internal/${file}`, "utf8"));
      expect(graph["30"].inputs.unet_name).toBe(H3_OMNIREF.checkpoint);
      expect(graph["15"].inputs.clip_name).toBe(h3OmniRefEncoder(backend));
      expect(graph["omni_vsa"].inputs.selection).toBe("vsa");
      expect(JSON.stringify(graph)).not.toContain("slr_experiments");
    }
  });
  it.each(["rtx3090", "rtx5060ti"] as const)("binds the actual C profile and live preview on %s", backend => {
    vi.stubEnv("OTG_ENV", "prod");
    const plan = automaticH3Plan(reconcileH3StudioPlan({ ...base, backend, workflowId: "native-r2v", quality: "1" }, { checkpoint: "fasth3" }));
    const { graph, manifest } = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), { nodes: new Set(), models: new Set(), loras: new Set(), observedAt: new Date().toISOString() }, null);
    expect(graph["30"].inputs.unet_name).toBe(H3_OMNIREF.checkpoint);
    expect(graph["15"].inputs.clip_name).toBe(h3OmniRefEncoder(backend));
    expect(graph["24"].inputs).toMatchObject({ steps: 8, scheduler: "simple", denoise: 1, model: ["164", 0] });
    expect(graph["18"].inputs.sampler_name).toBe("euler");
    expect(graph["38"].inputs).toMatchObject({ shift_video: 12, shift_audio: 3, model: ["30", 0] });
    expect(graph["omni_vsa"].inputs).toMatchObject({ selection: "vsa", "selection.keep_percent": 10, min_tokens: 12288, sink_conditioning: "exact_kv_and_rows" });
    expect(graph["164"].inputs).toMatchObject({ model: ["omni_vsa", 0], tiny_vae: "taeh3.safetensors", preview_frames: 8 });
    expect(graph["32"].inputs.model).toEqual(["164", 0]);
    expect(graph["39"].inputs).toMatchObject({ width: 1344, height: 768, length: 124 });
    expect(graph["36"]).toBeUndefined(); expect(graph["9001"]).toBeUndefined();
    expect(manifest).toMatchObject({ gpu: backend, model: H3_OMNIREF.checkpoint, steps: 8, attention: "vsa" });
    expect(h3ExpectedAssetChoicesForBackend(backend, [], "fasth3")).toContainEqual(["UNETLoader", "unet_name", H3_OMNIREF.checkpoint]);
    expect(h3ExpectedAssetChoicesForBackend(backend)).not.toContainEqual(["UNETLoader", "unet_name", H3_OMNIREF.checkpoint]);
  });
  it("preserves legacy presets and clears dependent VSA when leaving explicit FastH3", () => {
    const p = parseH3StudioPlan({ ...base, workflowId: "native-r2v", checkpoint: "singularity", combatEnabled: true });
    expect(p).toMatchObject({ checkpoint: "singularity", attention: "project-sla", profile: "native", combatEnabled: true, steps: 20 });
    const fast = reconcileH3StudioPlan(p, { checkpoint: "fasth3" });
    expect(reconcileH3StudioPlan(fast, { workflowId: "native-i2v" })).toMatchObject({ checkpoint: "standard", attention: "project-sla" });
    expect(() => parseH3StudioPlan({ ...base, attention: "vsa" })).toThrow();
  });
  it("routes only explicit FastH3 through C while preserving authorized media and frame-0 guide", () => {
    const { graph, nativeWidth, steps } = buildH3Workflow({ backend: "rtx3090", mode: "h3-reference-to-video", h3Settings: { checkpointMode: "fasth3" }, h3Quality: "hq", durationSeconds: 5, finalPrompt: "Follow <Video 1>", seed: 424242, outputPrefix: "fixture/output", startImageFilename: "owner-last.png", videoReferences: [{ uploadedFilename: "owner-source.mp4", includeAudio: true }] });
    expect(graph["30"].inputs.unet_name).toBe(H3_OMNIREF.checkpoint); expect(nativeWidth).toBe(1344); expect(steps).toBe(8);
    expect(graph["60"].inputs.file).toBe("owner-source.mp4"); expect(graph["40"].inputs.image).toBe("owner-last.png");
    expect(graph["32"].inputs.conditioning).toEqual(["93", 0]);
    expect(graph["39"].inputs["ref_videos.ref_video_0"]).toEqual(["61", 0]);
  });
  it("never changes the separate legacy reference editor", () => {
    const p = automaticH3Plan({ ...base, workflowId: "reference-edit" });
    const result = compileH3StudioPlan(p, h3StudioPreviewInput(p), { nodes: new Set(), models: new Set(), loras: new Set(), observedAt: "" }, null);
    expect(result.graph["30"].inputs.unet_name).not.toBe(H3_OMNIREF.checkpoint);
    expect(result.graph["36"].inputs.lora_name).toContain("ref2v_turbo_8step");
    expect(result.graph["omni_vsa"]).toBeUndefined();
  });
  it.each(["image/webp", "video/mp4", "video/webm"])("retains playable binary preview MIME %s", mime => {
    const promptId = `preview-${mime}`;
    const meta = Buffer.from(JSON.stringify({ prompt_id: promptId, mime }));
    const payload = Buffer.alloc(8 + meta.length + 4); payload.writeUInt32BE(4, 0); payload.writeUInt32BE(meta.length, 4); meta.copy(payload, 8); payload.fill(1, 8 + meta.length);
    expect(applyComfyBinaryPreviewEvent(payload)).toBe(true);
    expect(readComfyPromptProgress(promptId)?.approximatePreview?.imageUrl).toBe(`data:${mime};base64,AQEBAQ==`);
  });
});
