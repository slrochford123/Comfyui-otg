import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  VIDEO_GENERATE_DURATIONS,
  VIDEO_GENERATE_FPS,
  VIDEO_GENERATE_SIZES,
  VIDEO_GENERATE_WORKFLOWS,
  applyWan22GenerateOverrides,
  availableVideoGenerateFormats,
  resolveVideoGenerateWorkflow,
  videoFramesForDuration,
} from "../../../lib/videoGenerateWorkflows";

const ROOT = process.cwd();

function loadWorkflow(workflowId: string) {
  const fileName = `${workflowId.replace(/^presets\//, "")}.json`;
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, "comfy_workflows", "presets", fileName), "utf8")
  ) as Record<string, any>;
}

function wanWorkflows() {
  return VIDEO_GENERATE_WORKFLOWS.filter((workflow) => workflow.modelId === "wan22");
}

describe("Generate-page WAN 2.2 workflow contract", () => {
  it("keeps the LTX starter-image workflow to one runtime-bound LoadImage node", () => {
    const graph = loadWorkflow("presets/Create a Video from Images");
    const loadImageNodeIds = Object.entries(graph)
      .filter(([, node]: [string, any]) => node?.class_type === "LoadImage")
      .map(([nodeId]) => nodeId);

    expect(loadImageNodeIds).toEqual(["187"]);
    expect(graph["187"].inputs.image).toBeTypeOf("string");
    expect(graph["411"]).toBeUndefined();
    expect(graph["417"]).toBeUndefined();

    const routeSource = fs.readFileSync(path.join(ROOT, "app/api/comfy/route.ts"), "utf8");
    expect(routeSource).toContain("assertCreateVideoFromImagesRuntimeBindingV1");
    expect(routeSource).toContain("expected only LoadImage node 187");
    expect(routeSource).toContain("internal LoRA contract mismatch");
    expect(routeSource).toContain("videoLorasApplied: videoLoraRes?.applied ?? []");

    const explicitPresetGuard = routeSource.indexOf(
      'explicitWorkflowId === "presets/create a video from images"'
    );
    const legacyProductionHint = routeSource.indexOf(
      'hay.includes("production-default-image-to-video")'
    );
    expect(explicitPresetGuard).toBeGreaterThan(-1);
    expect(legacyProductionHint).toBeGreaterThan(explicitPresetGuard);
  });

  it("exposes exactly three operations in GGUF and SafeTensor", () => {
    const workflows = wanWorkflows();
    expect(workflows).toHaveLength(6);

    for (const operation of ["text_to_video", "image_to_video", "first_last_frame"] as const) {
      expect(availableVideoGenerateFormats(operation, "wan22")).toEqual(["safetensor", "gguf"]);
      for (const format of ["safetensor", "gguf"] as const) {
        expect(resolveVideoGenerateWorkflow({ operation, modelId: "wan22", format })).not.toBeNull();
      }
    }

    expect(resolveVideoGenerateWorkflow("create", "wan22", "safetensors")?.workflowId)
      .toBe("presets/WAN 2.2 T2V SafeTensor");
    expect(resolveVideoGenerateWorkflow("starter_image", "wan22", "gguf")?.workflowId)
      .toBe("presets/WAN 2.2 I2V GGUF");
    expect(resolveVideoGenerateWorkflow("first_last", "wan22", "safetensors")?.workflowId)
      .toBe("presets/WAN 2.2 FLF SafeTensor");
  });

  it("keeps LTX 2.3 GGUF disabled until its workflows are supplied", () => {
    for (const operation of ["text_to_video", "image_to_video", "first_last_frame"] as const) {
      expect(availableVideoGenerateFormats(operation, "ltx23")).toEqual(["safetensor"]);
      expect(resolveVideoGenerateWorkflow({ operation, modelId: "ltx23", format: "gguf" })).toBeNull();
    }
  });

  it("locks every selection to 720p at 24 FPS and WAN-compatible frame counts", () => {
    expect(VIDEO_GENERATE_FPS).toBe(24);
    expect(VIDEO_GENERATE_SIZES).toEqual({
      landscape: { width: 1280, height: 720 },
      portrait: { width: 720, height: 1280 },
    });
    expect(VIDEO_GENERATE_DURATIONS).toEqual([5, 10, 15]);
    expect(VIDEO_GENERATE_DURATIONS.map(videoFramesForDuration)).toEqual([121, 241, 361]);
  });

  it("forces T2V to five seconds while applying orientation, FPS, and selected-format pruning", () => {
    const workflowId = "presets/WAN 2.2 T2V SafeTensor";
    const graph = loadWorkflow(workflowId);
    const settings = applyWan22GenerateOverrides(
      graph,
      { workflowId, orientation: "landscape", durationSeconds: 10 },
      {}
    );

    expect(settings).toMatchObject({
      format: "safetensor",
      width: 1280,
      height: 720,
      fps: 24,
      durationSeconds: 5,
      frames: 121,
    });
    expect(graph["121"].inputs).toMatchObject({ width: 1280, height: 720, length: 121 });
    expect(graph["114"].inputs.frame_rate).toBe(24);
    expect(Object.values(graph).some((node: any) => node?.class_type === "UnetLoaderGGUF")).toBe(false);
    expect(Object.values(graph).some((node: any) => node?.class_type === "UNETLoader")).toBe(true);
  });

  it("requires and maps the starter image for I2V", () => {
    const workflowId = "presets/WAN 2.2 I2V GGUF";
    const graph = loadWorkflow(workflowId);
    expect(() =>
      applyWan22GenerateOverrides(graph, { workflowId, orientation: "portrait", durationSeconds: 5 }, {})
    ).toThrow("Upload a starter image");

    const retry = loadWorkflow(workflowId);
    const settings = applyWan22GenerateOverrides(
      retry,
      { workflowId, orientation: "portrait", durationSeconds: 5 },
      { imageA: "starter.png" }
    );
    expect(settings).toMatchObject({ width: 720, height: 1280, frames: 121, fps: 24 });
    expect(retry["62"].inputs.image).toBe("starter.png");
    expect(retry["63"].inputs.length).toBe(121);
    expect(retry["102"].inputs.frame_rate).toBe(24);
  });

  it("requires and maps both images for first/last-frame video", () => {
    const workflowId = "presets/WAN 2.2 FLF SafeTensor";
    const graph = loadWorkflow(workflowId);
    expect(() =>
      applyWan22GenerateOverrides(
        graph,
        { workflowId, orientation: "landscape", durationSeconds: 15 },
        { imageA: "first.png" }
      )
    ).toThrow("first image and a last image");

    const retry = loadWorkflow(workflowId);
    const settings = applyWan22GenerateOverrides(
      retry,
      { workflowId, orientation: "landscape", durationSeconds: 15 },
      { imageA: "first.png", imageB: "last.png" }
    );
    expect(settings).toMatchObject({ width: 1280, height: 720, durationSeconds: 5, frames: 121, fps: 24 });
    expect(retry["139"].inputs.image).toBe("first.png");
    expect(retry["147"].inputs.image).toBe("last.png");
    expect(retry["177"].inputs.length).toBe(121);
  });

  it("keeps each bundled workflow metadata aligned with the runtime matrix", () => {
    for (const workflow of wanWorkflows()) {
      const graph = loadWorkflow(workflow.workflowId);
      expect(graph.__otg?.videoGenerate).toMatchObject({
        modelId: "wan22",
        operation: workflow.operation,
        format: workflow.format,
      });

      const assets = workflow.needsImages === 2
        ? { imageA: "first.png", imageB: "last.png" }
        : workflow.needsImages === 1
          ? { imageA: "starter.png" }
          : {};
      const settings = applyWan22GenerateOverrides(
        graph,
        { workflowId: workflow.workflowId, orientation: "portrait", durationSeconds: 5 },
        assets
      );
      expect(settings).toMatchObject({ width: 720, height: 1280, fps: 24, frames: 121 });
    }
  });

  it("does not stack a speed LoRA onto the BoundBite GGUF checkpoint", () => {
    const workflowId = "presets/WAN 2.2 FLF GGUF";
    const graph = loadWorkflow(workflowId);
    applyWan22GenerateOverrides(
      graph,
      { workflowId, orientation: "portrait", durationSeconds: 5 },
      { imageA: "first.png", imageB: "last.png" }
    );
    expect(Object.values(graph).some((node: any) => node?.class_type === "LoraLoaderModelOnly")).toBe(false);
  });
});
