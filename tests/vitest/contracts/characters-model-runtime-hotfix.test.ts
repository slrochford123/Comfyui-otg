import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const readJson = (relative: string) => JSON.parse(read(relative).replace(/^\uFEFF/, ""));

describe("Characters model runtime hotfix", () => {
  it("uses the installed ZTurbo UNET filename without a stale subdirectory", () => {
    const workflow = readJson("workflows/characters/character-z-image-turbo.json");
    expect(workflow["57:28"].inputs.unet_name).toBe("z_image_turbo_bf16.safetensors");
  });

  it("packages Boogu in the legacy Characters workflow resolver tree", () => {
    const workflow = readJson("workflows/presets/image_boogu_image_0_1_turbo_t2i.json");
    expect(workflow["33"].class_type).toBe("SaveImage");
    expect(workflow["41"].inputs.unet_name).toBe("boogu_image_turbo_fp8_scaled.safetensors");
  });

  it("uses a deterministic legacy resolver path for Boogu", () => {
    const source = read("app/app/components/CharactersPanel.tsx");
    expect(source).toContain('workflowFile: "workflows/presets/image_boogu_image_0_1_turbo_t2i.json"');
    expect(source).toContain('body.set("workflowFile", "workflows/presets/image_boogu_image_0_1_turbo_t2i.json")');
  });

  it("uses exact output nodes for all selectable non-default character models", () => {
    const source = read("app/app/components/CharactersPanel.tsx");
    expect(source).toContain('return { nodeId: "9", filenamePrefix: "z-image-turbo" };');
    expect(source).toContain('return { nodeId: "29", filenamePrefix: "Krea2_turbo" };');
    expect(source).toContain('return { nodeId: "33", filenamePrefix: "Boogu" };');
  });

  it("polls exact and generic ComfyUI history after completion", () => {
    const source = read("app/app/components/CharactersPanel.tsx");
    expect(source).toContain("const historyTimeoutMs = 90 * 1000;");
    expect(source).toContain("fetchComfyHistoryImageForPromptV36BP9(promptId, outputSelector)");
    expect(source).toContain("fetchComfyHistoryImageForPromptV36BP9(promptId)");
  });
});
