import { describe, it, expect } from "vitest";
import { applyH3VideoEditGraph, h3VideoEditFrameCount, h3VideoEditCanvas } from "@/lib/h3VideoEdit";
import type { H3PromptGraph } from "@/lib/production/h3Workflows";
describe("H3 native structural video edit", () => {
  it.each([0, 1.99, 10.01, Infinity, NaN])("rejects source duration %s before processing", duration => expect(() => h3VideoEditFrameCount(duration)).toThrow("between 2 and 10"));
  it.each([[2, 124], [5, 124], [10, 243]])("pads %s seconds onto the legal native grid", (duration, frames) => { expect(h3VideoEditFrameCount(duration)).toBe(frames); expect(frames % 17).toBe(5); expect(frames / 24).toBeGreaterThanOrEqual(duration); });
  it("uses every source frame as structural control, never R2V or first-frame conditioning", () => {
    const graph: H3PromptGraph = Object.fromEntries(["39", "21", "24"].map(id => [id, { class_type: "fixture", inputs: { first_frame: ["old", 0], last_frame: ["old", 0] } }]));
    applyH3VideoEditGraph(graph, "source-conditioned.mp4", 2, 608, 352);
    expect(graph.v2v_canny).toMatchObject({ class_type: "Canny", inputs: { image: ["v2v_frames", 0] } });
    expect(graph.v2v_control).toMatchObject({ class_type: "MiniMaxH3FunControlNetApply", inputs: { model: ["38", 0], control_video: ["v2v_canny", 0], strength: 1 } });
    expect(graph.v2v_control_model.inputs.name).toBe("minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors");
    expect(graph["21"].inputs.latent_image).toEqual(["39", 1]);
    expect(graph["39"].inputs).not.toHaveProperty("first_frame");
    expect(graph["39"].inputs).not.toHaveProperty("last_frame");
    expect(graph["24"].inputs).toMatchObject({ denoise: 1, steps: 25, model: ["v2v_control", 0] });
    expect(JSON.stringify(graph)).not.toContain("MiniMaxH3ReferenceToVideo");
    expect(graph).not.toHaveProperty("v2v_init");
  });
  it.each(["41", "32"])("preserves the attention/guider consumer %s without a model cycle", id => {
    const graph: H3PromptGraph = Object.fromEntries(["39", "21", "24", id].map(key => [key, { class_type: "fixture", inputs: { model: ["38", 0] } }]));
    applyH3VideoEditGraph(graph, "qa.mp4", 10, 352, 608);
    expect(graph[id].inputs.model).toEqual(["v2v_control", 0]);
    expect(graph.v2v_control.inputs.model).toEqual(["38", 0]);
    expect(graph["39"].inputs.length).toBe(243);
  });
  it.each([[1920, 1080], [1080, 1920], [1024, 1024]])("keeps %s x %s orientation with legal dimensions", (w, h) => { const c = h3VideoEditCanvas(w, h); expect(c.width % 32).toBe(0); expect(c.height % 32).toBe(0); expect(Math.sign(c.width - c.height)).toBe(Math.sign(w - h)); });
});
