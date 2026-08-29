import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  IMAGE_MODELS,
  IMAGE_OPERATION_LABELS,
  imageModelsForOperation,
} from "../../../lib/imageGenerateWorkflows";
import {
  VIDEO_GENERATE_FPS,
  VIDEO_GENERATE_MODEL_OPTIONS,
  VIDEO_GENERATE_WORKFLOWS,
  VIDEO_GENERATION_OPTIONS,
  resolveVideoGenerateWorkflow,
} from "../../../lib/videoGenerateWorkflows";
import { extractPromptGraph } from "../../../lib/workflows";

const repoRoot = process.cwd();

const appSource = fs.readFileSync(
  path.join(repoRoot, "app/app/AppPageClient.tsx"),
  "utf8",
);

const comfyRouteSource = fs.readFileSync(
  path.join(repoRoot, "app/api/comfy/route.ts"),
  "utf8",
);

const compactComfyRouteSource = comfyRouteSource.replace(/\s+/g, "");

const ltx25Workflows = [
  {
    generationType: "create",
    mode: "text_to_video",
    id: "presets/LTX 2.5 Text To Video",
    file: "comfy_workflows/presets/LTX 2.5 Text To Video.json",
    promptNodeId: "405:376",
    durationNodeId: "405:362",
    widthNodeId: "405:372",
    heightNodeId: "405:360",
    frameRateNodeId: "405:361",
    seedNodeId: "405:339",
    saveVideoNodeId: "75",
    firstFrameNodeId: null,
    lastFrameNodeId: null,
    inputImageNodeIds: [],
  },
  {
    generationType: "starter_image",
    mode: "image_to_video",
    id: "presets/LTX 2.5 Image To Video",
    file: "comfy_workflows/presets/LTX 2.5 Image To Video.json",
    promptNodeId: "398:376",
    durationNodeId: "398:362",
    widthNodeId: "398:372",
    heightNodeId: "398:360",
    frameRateNodeId: "398:361",
    seedNodeId: "398:339",
    saveVideoNodeId: "75",
    firstFrameNodeId: "395",
    lastFrameNodeId: null,
    inputImageNodeIds: ["395"],
  },
  {
    generationType: "first_last",
    mode: "first_last_frame",
    id: "presets/LTX 2.5 First Last Frame Video",
    file: "comfy_workflows/presets/LTX 2.5 First Last Frame Video.json",
    promptNodeId: "251:252",
    durationNodeId: "251:198",
    widthNodeId: "251:215",
    heightNodeId: "251:216",
    frameRateNodeId: "251:205",
    seedNodeId: "251:196",
    saveVideoNodeId: "68",
    firstFrameNodeId: "31",
    lastFrameNodeId: "39",
    inputImageNodeIds: ["31", "39"],
  },
] as const;

describe("Generate tab rework contract", () => {
  it("keeps image generation operation-first with fixed backend workflows", () => {
    expect(IMAGE_OPERATION_LABELS).toEqual({
      create: "Create an Image",
      edit: "Edit an Image",
      animate: "Create an Animate Image",
    });

    expect(IMAGE_MODELS.map((model) => model.id)).toEqual([
      "presets/image_krea2_turbo_t2i",
      "presets/image_qwen_image_edit_2511_int8",
      "presets/image_anima_base_v1",
    ]);

    expect(
      imageModelsForOperation("create").map((model) => model.label),
    ).toEqual(["Krea 2 Turbo"]);

    expect(
      imageModelsForOperation("edit").map((model) => model.label),
    ).toEqual(["Qwen Image Edit 2511 INT8"]);

    expect(
      imageModelsForOperation("animate").map((model) => model.label),
    ).toEqual(["Anima Base V1"]);

    expect(
      IMAGE_MODELS.every((model) => model.optionalLoras.length === 0),
    ).toBe(true);
  });

  it("keeps the Create Image Krea 2 Turbo workflow free of obsolete image LoRA dependencies", () => {
    const graph = JSON.parse(
      fs.readFileSync(
        path.join(
          repoRoot,
          "comfy_workflows/presets/image_krea2_turbo_t2i.json",
        ),
        "utf8",
      ),
    );

    expect(graph["55"]?.class_type).toBe("UNETLoader");
    expect(graph["55"]?.inputs?.unet_name).toBe(
      "krea2_turbo_fp8_scaled.safetensors",
    );
    expect(graph["56"]?.class_type).toBe("CLIPLoader");
    expect(graph["56"]?.inputs?.type).toBe("krea2");
    expect(graph["57"]?.class_type).toBe("VAELoader");
    expect(graph["53"]?.class_type).toBe("KSampler");
    expect(graph["53"]?.inputs?.model).toEqual([
      "55",
      0,
    ]);

    const classTypes = Object.values(
      graph as Record<string, any>,
    ).map((node: any) =>
      String(node?.class_type || ""),
    );
    expect(classTypes).not.toContain(
      "LoraLoaderModelOnly",
    );
    expect(classTypes).not.toContain(
      "ComfySwitchNode",
    );

    const serializedGraph = JSON.stringify(graph);
    expect(serializedGraph).not.toContain(
      "krea2_darkbrush.safetensors",
    );
    expect(serializedGraph).not.toContain(
      "lora_name",
    );

    const extracted = extractPromptGraph(graph);
    expect(extracted.ok).toBe(true);
  });

  it("routes all Generate video modes through LTX 2.5 SafeTensor workflows", () => {
    expect(VIDEO_GENERATE_FPS).toBe(24);

    expect(VIDEO_GENERATE_MODEL_OPTIONS).toEqual([
      { id: "ltx25", label: "LTX 2.5" },
    ]);

    expect(
      VIDEO_GENERATION_OPTIONS.map((option) => option.id),
    ).toEqual([
      "create",
      "starter_image",
      "first_last",
    ]);

    expect(VIDEO_GENERATE_WORKFLOWS).toHaveLength(3);

    for (const expected of ltx25Workflows) {
      const workflow = resolveVideoGenerateWorkflow(
        expected.generationType,
      );

      expect(workflow?.workflowId).toBe(expected.id);
      expect(workflow?.modelId).toBe("ltx25");
      expect(workflow?.format).toBe("safetensor");
      expect(workflow?.needsImages).toBe(
        expected.inputImageNodeIds.length,
      );
    }

    const serialized = JSON.stringify(
      VIDEO_GENERATE_WORKFLOWS,
    );

    expect(serialized).not.toContain("ltx23");
    expect(serialized).not.toContain("wan22");
    expect(serialized).not.toContain("GGUF");
  });

  it("ships canonical local-default LTX 2.5 Prompt-API graphs", () => {
    for (const expected of ltx25Workflows) {
      const graph = JSON.parse(
        fs.readFileSync(
          path.join(repoRoot, expected.file),
          "utf8",
        ),
      );

      expect(graph.__otg).toMatchObject({
        modelFamily: "ltx25",
        operation: expected.mode,
        localDefaultWorkflow: true,
        nativePromptEnhancerPruned: true,
        promptNodeId: expected.promptNodeId,
        durationNodeId: expected.durationNodeId,
        widthNodeId: expected.widthNodeId,
        heightNodeId: expected.heightNodeId,
        frameRateNodeId: expected.frameRateNodeId,
        seedNodeId: expected.seedNodeId,
        saveVideoNodeId: expected.saveVideoNodeId,
        inputImageNodeIds: [
          ...expected.inputImageNodeIds,
        ],
      });

      expect(
        graph[expected.promptNodeId]?.class_type,
      ).toBe("PrimitiveStringMultiline");

      expect(
        graph[expected.durationNodeId]?.class_type,
      ).toBe("PrimitiveInt");

      expect(
        graph[expected.widthNodeId]?.class_type,
      ).toBe("PrimitiveInt");

      expect(
        graph[expected.heightNodeId]?.class_type,
      ).toBe("PrimitiveInt");

      expect(
        graph[expected.frameRateNodeId]?.class_type,
      ).toBe("PrimitiveInt");

      expect(
        graph[expected.frameRateNodeId]?.inputs?.value,
      ).toBe(24);

      expect(
        graph[expected.seedNodeId]?.class_type,
      ).toBe("RandomNoise");

      expect(
        graph[expected.seedNodeId]?.inputs?.noise_seed,
      ).toEqual(expect.any(Number));

      expect(
        graph[expected.saveVideoNodeId]?.class_type,
      ).toBe("SaveVideo");

      const classTypes = Object.values(
        graph as Record<string, any>,
      )
        .map((node: any) =>
          String(node?.class_type || ""),
        )
        .filter(Boolean);

      expect(
        classTypes.some((classType) =>
          classType.startsWith("LtxApi25"),
        ),
      ).toBe(false);

      expect(
        classTypes.includes("TextGenerateLTX2Prompt"),
      ).toBe(false);

      expect(
        classTypes.some((classType) =>
          classType.toLowerCase().includes("lora"),
        ),
      ).toBe(false);

      const serializedGraph = JSON.stringify(graph);

      expect(serializedGraph).not.toContain(
        "gemma4_e2b_it_int8_convrot.safetensors",
      );

      const loadImageNodeIds = Object.entries(
        graph as Record<string, any>,
      )
        .filter(
          ([, node]) =>
            node?.class_type === "LoadImage",
        )
        .map(([nodeId]) => nodeId)
        .sort((a, b) => Number(a) - Number(b));

      expect(loadImageNodeIds).toEqual([
        ...expected.inputImageNodeIds,
      ]);

      if (expected.firstFrameNodeId) {
        expect(
          graph[expected.firstFrameNodeId]?.class_type,
        ).toBe("LoadImage");

        expect(graph.__otg.firstFrameNodeId).toBe(
          expected.firstFrameNodeId,
        );
      }

      if (expected.lastFrameNodeId) {
        expect(
          graph[expected.lastFrameNodeId]?.class_type,
        ).toBe("LoadImage");

        expect(graph.__otg.lastFrameNodeId).toBe(
          expected.lastFrameNodeId,
        );
      }

      const extracted = extractPromptGraph(graph);

      expect(extracted.ok).toBe(true);

      if (extracted.ok) {
        expect(
          extracted.graph.__otg,
        ).toBeUndefined();
      }
    }
  });

  it("binds verified local LTX 2.5 graph primitives in the Comfy route", () => {
    expect(comfyRouteSource).not.toContain(
      "LtxApi25TextToVideo",
    );

    expect(comfyRouteSource).not.toContain(
      "LtxApi25ImageToVideo",
    );

    expect(comfyRouteSource).not.toContain(
      "findLtx25ApiNode",
    );

    expect(compactComfyRouteSource).toContain(
      "promptNode.inputs.value=positiveText;",
    );

    expect(compactComfyRouteSource).toContain(
      "durationNode.inputs.value=durationSeconds;",
    );

    expect(compactComfyRouteSource).toContain(
      "widthNode.inputs.value=size.width;",
    );

    expect(compactComfyRouteSource).toContain(
      "heightNode.inputs.value=size.height;",
    );

    expect(compactComfyRouteSource).toContain(
      "fpsNode.inputs.value=VIDEO_GENERATE_FPS;",
    );

    expect(compactComfyRouteSource).toContain(
      'requireLtx25LocalNode(graph,seedNodeId,"RandomNoise","seed")',
    );

    expect(compactComfyRouteSource).toContain(
      "bindLtx25LoadImage(graph,firstFrameNodeId,assets.imageA",
    );

    expect(compactComfyRouteSource).toContain(
      "bindLtx25LoadImage(graph,lastFrameNodeId,assets.imageB",
    );

    expect(compactComfyRouteSource).toContain(
      "{imageA:ltxImageA,imageB:ltxImageB},otgMeta",
    );
  });

  it("registers LTX 2.5 Generate presets in workflow and routing manifests", () => {
    const workflowIndex = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "comfy_workflows/index.json"),
        "utf8",
      ),
    );

    const compatibility = JSON.parse(
      fs.readFileSync(
        path.join(
          repoRoot,
          "config/video_workflow_compatibility.json",
        ),
        "utf8",
      ),
    );

    const capabilities = JSON.parse(
      fs.readFileSync(
        path.join(
          repoRoot,
          "config/comfy-workflow-capabilities.json",
        ),
        "utf8",
      ),
    );

    const indexedIds = new Set(
      workflowIndex.workflows.map(
        (workflow: any) => workflow.id,
      ),
    );

    const compatibleIds = new Set(
      compatibility.workflows.map(
        (workflow: any) => workflow.id,
      ),
    );

    const capabilityIds = new Set(
      capabilities.workflows.map(
        (workflow: any) => workflow.id,
      ),
    );

    for (const expected of ltx25Workflows) {
      expect(
        indexedIds.has(expected.id),
      ).toBe(true);

      expect(
        compatibleIds.has(expected.id),
      ).toBe(true);

      expect(
        capabilityIds.has(expected.id),
      ).toBe(true);
    }
  });

  it("removes model-centric Generate UI controls and keeps the intended flow order", () => {
    expect(appSource).not.toContain("Video model");
    expect(appSource).not.toContain("Model format");
    expect(appSource).not.toContain(
      'title="Prompt Guide"',
    );
    expect(appSource).not.toContain(
      "Prompt Builder Assistant",
    );
    expect(appSource).not.toContain(
      "LTX 2.3 prompt readiness review",
    );
    expect(appSource).not.toContain(
      "grades your current prompt for LTX 2.3",
    );

    const promptIndex = appSource.indexOf(
      '<Card title="Prompt">',
    );

    const styleIndex = appSource.indexOf(
      '<Card title="Choose a Style"',
    );

    const orientationIndex = appSource.indexOf(
      '<Card title="Orientation">',
    );

    const generateIndex = appSource.indexOf(
      '<Card title="Generate">',
    );

    const progressIndex = appSource.indexOf(
      '<Card title="Progress">',
    );

    const previewIndex = appSource.indexOf(
      '<Card title="Preview">',
    );

    expect(promptIndex).toBeGreaterThan(-1);
    expect(styleIndex).toBeGreaterThan(promptIndex);
    expect(orientationIndex).toBeGreaterThan(styleIndex);
    expect(generateIndex).toBeGreaterThan(orientationIndex);
    expect(progressIndex).toBeGreaterThan(generateIndex);
    expect(previewIndex).toBeGreaterThan(progressIndex);
  });
});
