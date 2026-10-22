import { describe, it, expect } from "vitest";
import { buildMossWorkflow, mossBackend, mossTarget, mossDimensions, mossSeed, mossSupport, MOSS_FILES, MOSS_REQUIRED_NODES } from "@/lib/images/mossImage";
describe("OpenMOSS SFT provider", () => {
  it.each(["3090", "5060ti"] as const)("maps only the explicit %s GPU without fallback", target => {
    expect(mossTarget(target)).toBe(target);
    expect(mossBackend(target)).toBe(target === "3090" ? "http://100.75.162.64:8188" : "http://100.98.212.116:8188");
    const graph = buildMossWorkflow({ prompt: "A navy coat", negativePrompt: "text", width: 1024, height: 1024, seed: 123, target });
    expect(graph["1"].inputs.unet_name).toBe((target === "5060ti" ? "TEST-MOSS/" : "") + MOSS_FILES.unet);
    expect(graph["2"].inputs).toMatchObject({ type: "moss_image", device: "cpu" });
    expect(graph["4"].inputs.text).toBe("A navy coat");
    expect(graph["5"].inputs.text).toBe("text");
    expect(graph["7"].inputs).toMatchObject({ steps: 50, cfg: 3, seed: 123, denoise: 1, sampler_name: "euler", scheduler: "sgm_uniform" });
    expect(graph["10"].inputs.single_layers).toBe("22");
  });
  it.each(["other", "http://example.com", "3090;reset"])("rejects arbitrary target %s", value => expect(() => mossTarget(value)).toThrow());
  it.each([[1080, 1920], [0, 1024], [256, 256], [4096, 4096], [NaN, 1024]])("rejects unsupported dimensions %s x %s", (w, h) => expect(() => mossDimensions(w, h, "asset")).toThrow());
  it.each(["character", "background", "asset"] as const)("provides supported %s defaults", kind => { const d = mossDimensions(undefined, undefined, kind); expect(d.width % 16).toBe(0); expect(d.height % 16).toBe(0); expect(d.width * d.height).toBeGreaterThanOrEqual(1e6); });
  it("accepts seed zero and random blank but rejects unsafe seeds", () => { expect(mossSeed(0, 5)).toBe(0); expect(mossSeed("", 5)).toBe(5); for (const value of [-1, "x", Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => mossSeed(value, 0)).toThrow(); });
  it("does not report missing files or wrong encoder support as installed", () => {
    const info: Record<string, any> = Object.fromEntries(MOSS_REQUIRED_NODES.map(n => [n, {}]));
    expect(mossSupport(info, "3090")).toContain("Missing MOSS file");
    info.UNETLoader = { input: { required: { unet_name: [[MOSS_FILES.unet]] } } };
    info.CLIPLoader = { input: { required: { clip_name: [[MOSS_FILES.clip]], type: [["moss_image"]] } } };
    info.VAELoader = { input: { required: { vae_name: [[MOSS_FILES.vae]] } } };
    expect(mossSupport(info, "3090")).toBeNull();
    expect(mossSupport(info, "5060ti")).toContain("TEST-MOSS/");
    info.CLIPLoader.input.required.type = [["qwen"]]; expect(mossSupport(info, "3090")).toContain("text encoder support");
  });
});
