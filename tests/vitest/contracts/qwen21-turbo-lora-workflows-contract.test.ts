import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  QWEN21_TURBO_CONTRACT,
  QWEN21_TURBO_CFG,
  QWEN21_TURBO_LORA,
  QWEN21_TURBO_STEPS,
} from "../../../lib/imageGenerateWorkflows";

const root = process.cwd();

const qwen21WorkflowPaths = [
  "comfy_workflows/presets/image_qwen_image_2_1_t2i.json",
  "comfy_workflows/presets/image_qwen_image_2_1_image_edit.json",
  "comfy_workflows/presets/character_card_qwen_image_2_1.json",
  "comfy_workflows/card_builder/qwen21_asset_card.api.json",
  "comfy_workflows/card_builder/qwen21_freeform_character_card.api.json",
  "comfy_workflows/card_builder/qwen21_character_card.api.json",
  "comfy_workflows/internal/story-creator/qwen21-story-character-t2i-api.json",
  "comfy_workflows/internal/story-creator/qwen21-story-location-t2i-api.json",
  "comfy_workflows/internal/story-creator/qwen21-story-asset-t2i-api.json",
  "comfy_workflows/internal/story-creator/qwen21-story-image-edit-api.json",
  "comfy_workflows/internal/story-creator/qwen21-story-character-card-api.json",
  "workflows/characters/create/image_qwen_image_2_1_t2i.json",
] as const;

function readWorkflow(relativePath: string) {
  return JSON.parse(
    fs.readFileSync(path.join(root, relativePath), "utf8"),
  ) as Record<string, any>;
}

function findNodeId(
  graph: Record<string, any>,
  classType: string,
) {
  return (
    Object.entries(graph).find(
      ([, node]) => node?.class_type === classType,
    )?.[0] || null
  );
}

describe("Qwen Image 2.1 Turbo LoRA workflow contract", () => {
  it("routes every registered Qwen Image 2.1 workflow through the Turbo LoRA", () => {
    for (const relativePath of qwen21WorkflowPaths) {
      const graph = readWorkflow(relativePath);
      const samplerId = findNodeId(graph, "KSampler");
      const cacheId = findNodeId(graph, "QwenImage21Cache");

      expect(graph["451"]?.class_type, relativePath).toBe(
        "UNETLoader",
      );
      expect(graph["451"]?.inputs?.unet_name, relativePath).toBe(
        "qwen_image_2.1_int8_convrot.safetensors",
      );
      expect(graph["455"]?.class_type, relativePath).toBe(
        "LoraLoaderModelOnly",
      );
      expect(graph["455"]?.inputs, relativePath).toMatchObject({
        model: ["451", 0],
        lora_name: QWEN21_TURBO_LORA,
        strength_model: 1,
      });
      expect(samplerId, relativePath).toBeTruthy();
      expect(graph[String(samplerId)]?.inputs?.steps, relativePath).toBe(
        QWEN21_TURBO_STEPS,
      );
      expect(graph[String(samplerId)]?.inputs?.cfg, relativePath).toBe(
        QWEN21_TURBO_CFG,
      );

      if (cacheId) {
        expect(graph[cacheId]?.inputs?.model, relativePath).toEqual([
          "455",
          0,
        ]);
        expect(
          graph[String(samplerId)]?.inputs?.model,
          relativePath,
        ).toEqual([cacheId, 0]);
      } else {
        expect(
          graph[String(samplerId)]?.inputs?.model,
          relativePath,
        ).toEqual(["455", 0]);
      }
    }
  });

  it("does not retrofit the separate Qwen 2511/2512 edit stacks with the 2.1 Turbo LoRA", () => {
    const source = fs.readFileSync(
      path.join(root, "app/api/comfy/route.ts"),
      "utf8",
    );

    expect(source).toContain(
      "Qwen-Image/Acceleration/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
    );
    expect(source).not.toContain(
      `Qwen-Image/Acceleration/${QWEN21_TURBO_LORA}`,
    );
  });

  it("makes Storyteller create and edit fail closed on the verified Turbo contract", () => {
    const createRoute = fs.readFileSync(
      path.join(root, "app/api/assets/create-image/route.ts"),
      "utf8",
    );
    const visualStore = fs.readFileSync(
      path.join(root, "lib/storyCreator/store.ts"),
      "utf8",
    );
    const visualStudio = fs.readFileSync(
      path.join(root, "app/app/components/storyCreatorV2/VisualAssetStudio.tsx"),
      "utf8",
    );

    expect(QWEN21_TURBO_CONTRACT).toMatchObject({
      verified: true,
      checkpoint: "qwen_image_2.1_int8_convrot.safetensors",
      acceleration: { name: QWEN21_TURBO_LORA, strength: 1 },
      sampling: { steps: 8, cfg: 1, sampler: "euler", scheduler: "simple" },
      backend: "image-primary",
      gpu: "RTX 5060 Ti 16 GB",
    });
    expect(createRoute).toContain("Automatic fallback is disabled for this workflow");
    expect(createRoute).toContain("do not replace the requested environment with a studio backdrop");
    expect(visualStore).toContain("QWEN21_TURBO_CONTRACT");
    expect(visualStudio).toContain("Qwen Image Edit 2.1 Turbo");
    expect(visualStudio).toContain("8 steps · CFG 1 · Auto / Manual GPU");
    expect(visualStudio).toContain("nativeEditEngineLabel(preparedFibo)");
  });
});
