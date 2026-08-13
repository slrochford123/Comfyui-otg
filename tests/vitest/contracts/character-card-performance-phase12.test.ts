import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = path.join(
  process.cwd(),
  "comfy_workflows/presets/character_card_8_angles_low_angle.json",
);

function loadGraph() {
  const doc = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
  return doc.prompt || doc.output || doc;
}

function nodesOf(graph: Record<string, any>, classType: string) {
  return Object.entries(graph).filter(
    ([, node]) => node?.class_type === classType,
  );
}

describe("Character Card Performance Phase 12", () => {
  it("preserves the fixed eight-view diffusion/output contract", () => {
    const graph = loadGraph();
    expect(nodesOf(graph, "KSampler")).toHaveLength(8);
    expect(nodesOf(graph, "VAEDecode")).toHaveLength(8);
    expect(graph["439"]?.class_type).toBe("SaveImage");
  });

  it("shares the heavy Qwen model stack instead of loading it eight times", () => {
    const graph = loadGraph();
    expect(nodesOf(graph, "UNETLoader")).toHaveLength(1);
    expect(nodesOf(graph, "CLIPLoader")).toHaveLength(1);
    expect(nodesOf(graph, "VAELoader")).toHaveLength(1);
    expect(nodesOf(graph, "LoraLoaderModelOnly")).toHaveLength(2);
    expect(nodesOf(graph, "ModelSamplingAuraFlow")).toHaveLength(1);
    expect(nodesOf(graph, "CFGNorm")).toHaveLength(1);
  });

  it("uses two low-resolution source tiers sized for the final 1024px card", () => {
    const graph = loadGraph();
    expect(nodesOf(graph, "FluxKontextImageScale")).toHaveLength(0);
    const scales = nodesOf(graph, "ImageScaleToTotalPixels");
    expect(scales).toHaveLength(2);
    const megapixels = scales
      .map(([, node]) => Number(node.inputs?.megapixels))
      .sort((a, b) => a - b);
    expect(megapixels).toEqual([0.2, 0.32]);
    expect(
      scales.every(([, node]) => Number(node.inputs?.resolution_steps) === 1),
    ).toBe(true);
    expect(nodesOf(graph, "VAEEncode")).toHaveLength(2);
  });

  it("uses the Multiple-Angles LoRA trigger for every positive camera prompt", () => {
    const graph = loadGraph();
    const encoders = nodesOf(graph, "TextEncodeQwenImageEditPlus");
    expect(encoders).toHaveLength(10);
    const positives = encoders
      .map(([, node]) => String(node.inputs?.prompt || ""))
      .filter((prompt) => !prompt.toLowerCase().includes("different character"));
    expect(positives).toHaveLength(8);
    expect(positives.every((prompt) => prompt.startsWith("<sks> "))).toBe(true);
  });

  it("keeps Lightning + Multiple-Angles and no additional diffusion LoRAs", () => {
    const graph = loadGraph();
    const names = nodesOf(graph, "LoraLoaderModelOnly").map(
      ([, node]) => String(node.inputs?.lora_name || "").toLowerCase(),
    );
    expect(names.some((name) => name.includes("lightning"))).toBe(true);
    expect(
      names.some(
        (name) =>
          name.includes("multiple-angle") ||
          name.includes("multiple_angles") ||
          name.includes("multiple-angles"),
      ),
    ).toBe(true);
  });
});
