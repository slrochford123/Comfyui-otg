import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  IMAGE_MODELS,
  IMAGE_LORA_ADULT_ACK_VERSION,
  IMAGE_LORA_MAX_SELECTIONS,
  LOCKED_IMAGE_SIZES,
  applyEditImageReferences,
  applyImageLoraSelections,
  applyLockedImageSize,
  applyOptionalLoraSwitches,
  imageModelsForOperation,
  resolveImageLoraSelections,
} from "../../../lib/imageGenerateWorkflows";

describe("image Generate page contract", () => {
  it("keeps the admin LoRA manager collapsed until the admin expands it", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/app/AppPageClient.tsx"), "utf8");
    expect(source).toContain('<details className="group">');
    expect(source).toContain("Tap to expand or collapse the admin controls.");
    expect(source).not.toContain('<details className="group" open>');
  });

  it("locks landscape and portrait output to 720p", () => {
    expect(LOCKED_IMAGE_SIZES.landscape).toEqual({ width: 1280, height: 720 });
    expect(LOCKED_IMAGE_SIZES.portrait).toEqual({ width: 720, height: 1280 });

    const graph = { "1": { class_type: "EmptyFlux2LatentImage", inputs: { width: 1024, height: 1024, batch_size: 4 } } };
    expect(applyLockedImageSize(graph, "landscape")).toEqual({ width: 1280, height: 720, applied: 1 });
    expect(graph["1"].inputs).toMatchObject({ width: 1280, height: 720, batch_size: 1 });
  });

  it("exposes four general image models and one anime model", () => {
    expect(imageModelsForOperation("create").map((model) => model.label)).toEqual([
      "Ernie Image Turbo",
      "Z Image Turbo",
      "Krea 2 Turbo",
      "Boogu Image 0.1 Turbo",
    ]);
    expect(imageModelsForOperation("anime").map((model) => model.label)).toEqual(["Anima Base V1"]);
  });

  it("limits multi-reference uploads by edit workflow", () => {
    const limits = Object.fromEntries(IMAGE_MODELS.filter((model) => model.operation === "edit").map((model) => [model.label, model.maxInputImages]));
    expect(limits).toEqual({
      "Qwen Image Edit 2511 INT8": 3,
      "FireRed Image Edit 1.1": 3,
      "Qwen Image Edit": 1,
    });
  });

  it("adds only the supported Qwen Plus reference inputs", () => {
    const graph: Record<string, any> = {
      "41": { class_type: "LoadImage", inputs: { image: "old.png" } },
      "149": { class_type: "TextEncodeQwenImageEditPlus", inputs: { image1: ["41", 0] } },
    };
    expect(applyEditImageReferences(graph, ["one.png", "two.png", "three.png"], 3)).toEqual({ applied: 3, maxImages: 3 });
    expect(graph["41"].inputs.image).toBe("one.png");
    expect(graph["149"].inputs.image2).toEqual(["otg_edit_reference_2", 0]);
    expect(graph["149"].inputs.image3).toEqual(["otg_edit_reference_3", 0]);
  });

  it("enables an optional LoRA switch only when that model LoRA is selected", () => {
    const graph: Record<string, any> = {
      "59": { class_type: "LoraLoaderModelOnly", inputs: { lora_name: "krea2_darkbrush.safetensors" } },
      "66": { class_type: "ComfySwitchNode", inputs: { switch: false, on_true: ["59", 0], on_false: ["55", 0] } },
    };
    applyOptionalLoraSwitches(graph, ["krea2_darkbrush.safetensors"]);
    expect(graph["66"].inputs.switch).toBe(true);
    applyOptionalLoraSwitches(graph, []);
    expect(graph["66"].inputs.switch).toBe(false);
  });

  it("publishes a versioned adult acknowledgement and limits selections to three", () => {
    expect(IMAGE_LORA_ADULT_ACK_VERSION).toBe("image-lora-adult-v1");
    expect(IMAGE_LORA_MAX_SELECTIONS).toBe(3);
    const zImage = IMAGE_MODELS.find((model) => model.id === "presets/image_z_image_turbo")!;
    const tooMany = resolveImageLoraSelections(
      zImage,
      zImage.optionalLoras.map((lora) => ({ name: lora.name, strength: lora.strength })),
    );
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error).toContain("maximum of 3");
  });

  it("rejects a LoRA that belongs to another image model", () => {
    const ernie = IMAGE_MODELS.find((model) => model.id === "presets/image_ernie_image_turbo")!;
    const result = resolveImageLoraSelections(ernie, [
      { name: "Z-Turbo/ZITnsfwLoRAv3.safetensors", strength: 0.8 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not compatible with Ernie Image Turbo");
  });

  it("preserves Krea Darkbrush and chains another selected Krea LoRA after its switch", () => {
    const krea = IMAGE_MODELS.find((model) => model.id === "presets/image_krea2_turbo_t2i")!;
    const graph: Record<string, any> = {
      "53": { class_type: "KSampler", inputs: { model: ["66", 0] } },
      "55": { class_type: "UNETLoader", inputs: { unet_name: "krea2_turbo_fp8_scaled.safetensors" } },
      "59": { class_type: "LoraLoaderModelOnly", inputs: { lora_name: "krea2_darkbrush.safetensors", strength_model: 0.8, model: ["55", 0] } },
      "66": { class_type: "ComfySwitchNode", inputs: { switch: false, on_false: ["55", 0], on_true: ["59", 0] } },
    };
    const result = applyImageLoraSelections(graph, krea, [
      { name: "krea2_darkbrush.safetensors", strength: 0.55 },
      { name: "krea/MysticXXX_KREA2_v2.safetensors", strength: 0.7 },
    ]);
    expect(result.ok).toBe(true);
    expect(graph["66"].inputs.switch).toBe(true);
    expect(graph["59"].inputs.strength_model).toBe(0.55);
    expect(graph["otg_image_lora_1_1"].inputs).toMatchObject({
      model: ["66", 0],
      lora_name: "krea/MysticXXX_KREA2_v2.safetensors",
      strength_model: 0.7,
    });
    expect(graph["53"].inputs.model).toEqual(["otg_image_lora_1_1", 0]);
  });

  it("clamps every user-selected LoRA strength to the supported zero-to-two range", () => {
    const ernie = IMAGE_MODELS.find((model) => model.id === "presets/image_ernie_image_turbo")!;
    const high = resolveImageLoraSelections(ernie, [
      { name: "ernie-image-prompt-enhancer.safetensors", strength: 99 },
    ]);
    const low = resolveImageLoraSelections(ernie, [
      { name: "ernie-image-prompt-enhancer.safetensors", strength: -4 },
    ]);
    expect(high.ok && high.selections[0].selectedStrength).toBe(2);
    expect(low.ok && low.selections[0].selectedStrength).toBe(0);
  });
});
