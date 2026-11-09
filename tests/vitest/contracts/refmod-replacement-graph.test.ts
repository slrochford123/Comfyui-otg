import { describe, expect, it } from "vitest";
import { buildReplacementGraph, graphCompatibility, replacementPrompt, SWAP_LORA } from "@/lib/refmodLab/graph";
import { REPLACEMENT_DEFAULTS as defaults, parseEvaluation, parseReplacementSettings } from "@/lib/refmodLab/contract";
function build(settings = {}, args = {}) { return buildReplacementGraph({ ...defaults, subject: "the foreground runner", refMod: "characters/zeltroi", ...settings }, { video: "conditioning.mp4", originalVideo: "exact-source.mp4", refKind: "video", portrait: false, prefix: "refmod_lab/mock", ...args }); }
describe("Isolated RefMod replacement graphs", () => {
  it("combines source and saved identity once, with correct Video 1 / Video 2 labels", () => {
    const b = build(); expect(b.graph["39"].class_type).toBe("PK_MiniMaxH3Combined");
    expect(b.prompt).toContain("<Video 2> (saved RefMod)"); expect(b.graph.lab_mod.inputs.mod_1).toBe("characters/zeltroi");
    expect(Object.values(b.graph).filter(n => /RefModsLoader/.test(n.class_type))).toHaveLength(1);
    expect(Object.values(b.graph).some(n => /RefModApply|RefModTextEncode/.test(n.class_type))).toBe(false);
    expect(b.graph.lab_mod.inputs.components_1).toBe("Visual"); expect(b.graph.lab_mod.inputs.audio_strength_1).toBe(0);
  });
  it("assigns an image RefMod after the optional ordinary image, never as an extra subject", () => {
    const b = build({ imageId: "fixture" }, { image: "identity.png", refKind: "image" }); expect(b.prompt).toContain("<Picture 2> (saved RefMod)"); expect(b.prompt).toContain("same target");
    expect(b.graph["39"].inputs["reference_images.reference_image_0"]).toEqual(["lab_image", 0]);
  });
  it("does not refer to an absent RefMod token at zero strength", () => { expect(replacementPrompt({ ...defaults, strength: 0 }, "video")).not.toContain("<Video 2>"); });
  it("pins Standard Native and allows optional swap LoRA without an accelerator", () => {
    const a = build(), b = build({ workflow: "B" }), off = build({ workflow: "B", swapLora: false });
    expect(a.graph.lab_swap).toBeUndefined(); expect(b.graph.lab_swap.inputs.lora_name).toBe(SWAP_LORA); expect(off.graph.lab_swap).toBeUndefined();
    expect(b.graph["24"].inputs.steps).toBe(20); expect(b.graph["18"].inputs.sampler_name).toBe("res_multistep");
    expect(b.graph["15"].inputs.clip_name).toContain("int8_convrot"); expect(b.graph["41"].class_type).toBe("ModelAttentionBackend");
    expect(Object.values(b.graph).some(n => /turbo|4step|8step/i.test(String(n.inputs.lora_name)))).toBe(false);
  });
  it("C genuinely tracks and composites with the exact source, not its held conditioning tail", () => {
    const b = build({ workflow: "C", seconds: 5 });
    expect(b.graph.lab_original.inputs.file).toBe("exact-source.mp4");
    expect(b.graph.lab_track.inputs.images).toEqual(["lab_original_frames", 0]); expect(b.graph.lab_track.inputs.max_objects).toBe(1);
    expect(b.graph.lab_composite.inputs.destination).toEqual(["lab_original_frames", 0]); expect(b.graph.lab_composite.inputs.mask).toEqual(["lab_mask", 0]);
    expect(b.graph["34"].inputs.images).toEqual(["lab_composite", 0]); expect(b.reconstruction).toContain("not native inpainting");
    expect(b.graph.lab_trim.inputs.length).toBe(120); expect(b.graph["34"].inputs.audio).toBeUndefined();
  });
  it("C supports a real uploaded mask without segmentation dependencies", () => {
    const b = build({ workflow: "C", maskMode: "upload" }, { mask: "mask.mp4" }); expect(b.graph.lab_mask.class_type).toBe("ImageToMask"); expect(b.graph.lab_track).toBeUndefined();
    expect(() => build({ workflow: "C", maskMode: "upload" })).toThrow(/mask video/);
  });
  it("rejects unsupported GPU instead of falling back and detects missing nodes", () => {
    expect(() => build({ backend: "rtx5060ti" })).toThrow(/lacks PK_MiniMaxH3Combined/);
    expect(graphCompatibility(build().graph, {}).some(e => e.includes("PK_MiniMaxH3Combined"))).toBe(true);
  });
  it("does not accept unsafe numeric settings or invalid ratings", () => {
    expect(() => parseReplacementSettings({ ...defaults, seconds: 15 })).toThrow(); expect(() => parseReplacementSettings({ ...defaults, seed: -1 })).toThrow();
    expect(() => parseEvaluation({ scores: { identity: 6 }, notes: "" })).toThrow();
    expect(parseEvaluation({ scores: { identity: 4 }, notes: "needs review" })).toEqual({ scores: { identity: 4 }, notes: "needs review" });
    expect(parseReplacementSettings({ ...defaults, checkpointPath: "/tmp/unauthorized" })).not.toHaveProperty("checkpointPath");
  });
});
