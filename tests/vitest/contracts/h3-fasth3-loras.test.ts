import { describe, expect, it, vi, afterEach } from "vitest";
import installed from "@/lib/h3Stage1cInstalled.json";
import { assertFastH3StudioLoras, fastH3LoraBlockReason, fastH3LoraDefaultStrength } from "@/lib/h3FastLora";
import { H3_OMNIREF } from "@/lib/h3OmniRef";
import { buildH3Workflow } from "@/lib/production/h3Workflows";
import { DEFAULT_H3_STUDIO_PLAN, reconcileH3StudioPlan } from "@/lib/h3StudioPlan";
import { compileH3StudioPlan, h3StudioPreviewInput } from "@/lib/h3StudioCompiler";
import { h3StudioQualificationFingerprint } from "@/lib/h3StudioIdentity";

const supported = installed.entries.filter(entry => !fastH3LoraBlockReason(entry.filename));
const selected = supported.slice(0, 3);
const options = selected.map((entry, i) => ({ id: `stage1c-${entry.versionId}`, label: entry.displayName, filename: entry.filename, strength: .5 + i * .25 }));
const input = { backend: "rtx3090" as const, mode: "h3-reference-to-video" as const, h3Quality: "lq" as const, durationSeconds: 5 as const,
  finalPrompt: "Use <Picture 1> as <Subject 1>. A dragon flies.", seed: 42, outputPrefix: "fixture/loras", h3Settings: { checkpointMode: "fasth3" },
  references: [{ id: "fixture", name: "Dragon", sourceKind: "production-upload" as const, pictureSlot: 1, subjectSlot: 1, workflowImage: "dragon.png", uploadedFilename: "dragon.png" }] };
afterEach(() => vi.unstubAllEnvs());
describe("FastH3 optional LoRA integration", () => {
  it("allows only the 53 exact structurally checked non-acceleration entries", () => {
    expect(supported).toHaveLength(53);
    expect(fastH3LoraDefaultStrength(supported[0].filename)).toBe(supported[0].defaultStrength);
    expect(fastH3LoraDefaultStrength(supported[0].filename, .1, .8)).toBe(.8);
    for (const entry of supported) expect(entry.fastH3).toMatchObject({ checkpointSha256: H3_OMNIREF.sha256, adapterSha256: entry.sha256 });
    for (const id of [3219346, 3219337, 3297123, 3294126]) {
      expect(fastH3LoraBlockReason(installed.entries.find(entry => entry.versionId === id)!.filename)).toMatch(/acceleration/);
    }
    expect(fastH3LoraBlockReason("../other.safetensors")).toMatch(/exact installed/);
    expect(fastH3LoraBlockReason(supported[0].filename, NaN)).toMatch(/strength/);
    expect(fastH3LoraBlockReason(supported[0].filename, 2.1)).toMatch(/strength/);
    expect(() => assertFastH3StudioLoras([{ id: "civitai-1-2", strength: 1, enabled: true }])).toThrow(/exact installed/);
    expect(() => assertFastH3StudioLoras([{ id: "civitai-1-2", strength: 1, enabled: false }])).not.toThrow();
  });
  it.each(["rtx3090", "rtx5060ti"] as const)("connects every selected adapter in order to the sampled model on %s", backend => {
    const { graph } = buildH3Workflow({ ...input, backend, optionalLoras: options });
    expect(graph["30"].inputs.unet_name).toBe(H3_OMNIREF.checkpoint);
    options.forEach((lora, i) => expect(graph[String(70 + i)].inputs).toEqual({ model: [i ? String(69 + i) : "30", 0], lora_name: lora.filename, strength_model: lora.strength }));
    expect(graph["38"].inputs).toMatchObject({ model: ["72", 0], shift_video: 12, shift_audio: 3 });
    expect(graph["omni_vsa"].inputs.model).toEqual(["41", 0]);
    expect(graph["164"].inputs.model).toEqual(["omni_vsa", 0]);
    expect(graph["24"].inputs).toMatchObject({ steps: 8, model: ["164", 0] });
    expect(graph["18"].inputs.sampler_name).toBe("euler");
    expect(graph["32"].inputs.model).toEqual(["164", 0]);
    expect(graph["36"]).toBeUndefined(); expect(graph["9001"]).toBeUndefined(); expect(graph["9002"]).toBeUndefined();
  });
  it("never silently accepts acceleration, arbitrary filenames or invalid strengths", () => {
    for (const filename of ["not-installed.safetensors", installed.entries.find(entry => entry.versionId === 3294126)!.filename]) {
      expect(() => buildH3Workflow({ ...input, optionalLoras: [{ ...options[0], filename }] })).toThrow();
    }
    expect(() => buildH3Workflow({ ...input, optionalLoras: [{ ...options[0], strength: -1 }] })).toThrow(/strength/);
  });
  it("preserves enabled states in the plan and binds ordered enabled strengths into qualification identity", () => {
    vi.stubEnv("OTG_ENV", "prod"); // Unit fixture only. No production connection or writes.
    const loras = selected.map((entry, i) => ({ id: `civitai-${entry.modelId}-${entry.versionId}`, strength: .5 + i * .25, enabled: i !== 1 }));
    const plan = reconcileH3StudioPlan({ ...DEFAULT_H3_STUDIO_PLAN, workflowId: "native-r2v", prompt: "A dragon flies", originalPrompt: "A dragon flies", loras }, { checkpoint: "fasth3" });
    expect(plan.loras).toEqual(loras);
    const inv = { nodes: new Set<string>(), models: new Set<string>(), loras: new Set(selected.map(entry => entry.filename)), observedAt: "" };
    const result = compileH3StudioPlan(plan, h3StudioPreviewInput(plan), inv, null);
    expect(result.graph["70"].inputs.lora_name).toBe(selected[0].filename);
    expect(result.graph["71"].inputs.lora_name).toBe(selected[2].filename);
    expect(result.graph["72"]).toBeUndefined(); expect(result.graph["38"].inputs.model).toEqual(["71", 0]);
    const base = { plan, graph: result.graph, templateSha256: result.manifest.templateSha256, dependencies: [] };
    const first = h3StudioQualificationFingerprint(base);
    expect(h3StudioQualificationFingerprint({ ...base, plan: { ...plan, loras: [...loras].reverse() } })).not.toBe(first);
    expect(h3StudioQualificationFingerprint({ ...base, plan: { ...plan, loras: loras.map((entry, i) => i ? entry : { ...entry, strength: 1.5 }) } })).not.toBe(first);
  });
});
