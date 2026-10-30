import {describe, expect, it} from "vitest";
import fs from "node:fs";
import {buildNativeImageGraph, isNativeImageModel, nativeImageDimensions, nativeImageEditDimensions, NATIVE_IMAGE_MODELS} from "@/lib/images/nativeImageModels";
const base = {prompt: "A cafe", width: 1024, height: 1024, seed: 0};
describe("Official local H3 / Fibo still image contracts", () => {
  it("does not confuse H3 video, FastH3, Singularity or the paid BRIA API with these models", () => {
    for (const name of ["h3", "h3-omniref", "singularity", "bria-api", "__proto__"]) expect(isNativeImageModel(name)).toBe(false);
  });
  it("uses H3's native 30 step still image branch without audio, Turbo or checkpoint substitutions", () => {
    const graph = buildNativeImageGraph({...base, model: "minimax-h3-image"});
    expect(graph["451"].inputs.unet_name).toBe(NATIVE_IMAGE_MODELS["minimax-h3-image"].unet);
    expect(graph["9"].inputs).toMatchObject({steps: 30, scheduler: "simple"});
    expect(graph["17"].inputs.sampler_name).toBe("res_multistep");
    expect(graph["44"].inputs.attention).toBe("comfy kitchen attention");
    expect(graph["457"].inputs.samples).toEqual(["39", 0]);
    expect(graph["39"].inputs.av_latent).toEqual(["458", 0]);
    expect(Object.values(graph).some(n => /Audio|Video|LoRA|LoraLoader/.test(n.class_type))).toBe(false);
  });
  it.each(["fibo2-dev", "fibo2-edit-turbo"] as const)("preserves %s's exact checkpoint, steps and guidance", model => {
    const graph = buildNativeImageGraph({...base, model, image: "source.png"});
    const config = NATIVE_IMAGE_MODELS[model];
    expect(graph["451"].inputs.unet_name).toBe(config.unet);
    expect(graph["458"].inputs).toMatchObject({steps: config.steps, cfg: config.cfg, seed: 0, sampler_name: "euler", scheduler: "simple"});
    expect(graph["474"].inputs).toMatchObject({"images.image_1": ["470", 0], vae: ["454", 0], clip: ["453", 0]});
    expect(graph["458"].inputs).toMatchObject({positive: ["474", 0], negative: ["474", 1], latent_image: ["474", 2]});
    expect(graph["453"].inputs.type).toBe("fibo2");
  });
  it("allows genuine Dev text-to-image, but never silently substitutes T2I for Turbo editing", () => {
    expect(buildNativeImageGraph({...base, model: "fibo2-dev"})["470"]).toBeUndefined();
    expect(() => buildNativeImageGraph({...base, model: "fibo2-edit-turbo"})).toThrow(/source image/);
    expect(() => buildNativeImageGraph({...base, model: "minimax-h3-image", image: "source.png"})).toThrow(/not image editing/);
  });
  it.each(["character", "asset", "background"] as const)("provides an honest approximately 1MP %s canvas", kind => {
    const dims = nativeImageDimensions(kind);
    expect(dims.width % 32).toBe(0); expect(dims.height % 32).toBe(0);
    expect(dims.width * dims.height).toBeGreaterThan(1_000_000);
    expect(() => buildNativeImageGraph({...base, ...dims, model: "fibo2-dev"})).not.toThrow();
  });
  it.each([[1088, 1920], [1920, 1088], [1024, 1024]])("matches the source aspect instead of silently forcing %s x %s edits square", (width, height) => {
    const size = nativeImageEditDimensions(width, height);
    expect(Math.abs(size.width / size.height - width / height)).toBeLessThan(0.03);
    expect(size.width * size.height).toBeGreaterThanOrEqual(900_000);
    expect(size.width * size.height).toBeLessThanOrEqual(1_100_000);
  });
  it.each([{prompt: ""}, {seed: -1}, {seed: 1.5}, {width: 0}, {width: 1080}, {width: 2048}, {width: 1344, height: 1344}])("rejects unsupported inputs %j", invalid => {
    expect(() => buildNativeImageGraph({...base, ...invalid, model: "fibo2-dev"})).toThrow();
  });
  it("adds both creation models to all three existing creators without changing legacy routing", () => {
    for (const kind of ["characters", "assets", "backgrounds"]) {
      const source = fs.readFileSync(`app/api/${kind}/create-image/route.ts`, "utf8");
      expect(source).toContain("...NATIVE_CREATE_CONFIGS");
      expect(source).toContain("chooseNativeImageBackend(config.id)");
      expect(source).toContain("buildNativeImageGraph({model: config.id");
      expect(source).toContain("chooseMossBackend");
    }
  });
});
