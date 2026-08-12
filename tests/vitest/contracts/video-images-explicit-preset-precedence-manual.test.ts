import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CREATE_VIDEO_FROM_IMAGES_WORKFLOW_ID,
  normalizeExplicitCreateVideoFromImagesRequest,
} from "../../../lib/videoWorkflowRequestNormalization";

function loadImageNodeIds(graph: Record<string, any>): string[] {
  return Object.entries(graph)
    .filter(([, node]) => node?.class_type === "LoadImage")
    .map(([nodeId]) => nodeId)
    .sort((a, b) => Number(a) - Number(b));
}

describe("Create a Video from Images explicit preset precedence", () => {
  it("clears every conflicting legacy workflow selector", () => {
    const body: Record<string, any> = {
      workflowId: CREATE_VIDEO_FROM_IMAGES_WORKFLOW_ID,
      preset: "",
      workflowFile: "production-image-to-video.json",
      workflowPath: "workflows/production/production-image-to-video.json",
      workflowJsonPath: "workflows/production/production-image-to-video.json",
      workflowPresetPath: "workflows/production/production-image-to-video.json",
      requestKind: "production-default-image-to-video",
    };

    expect(normalizeExplicitCreateVideoFromImagesRequest(body)).toBe(true);
    expect(body.workflowId).toBe(CREATE_VIDEO_FROM_IMAGES_WORKFLOW_ID);
    expect(body.preset).toBe(CREATE_VIDEO_FROM_IMAGES_WORKFLOW_ID);
    expect(body.workflowFile).toBe("");
    expect(body.workflowPath).toBe("");
    expect(body.workflowJsonPath).toBe("");
    expect(body.workflowPresetPath).toBe("");
    expect(body.requestKind).toBe("production-default-image-to-video");
  });

  it("canonicalizes Windows separators and an optional JSON suffix", () => {
    const body: Record<string, any> = {
      workflowId: "presets\\Create a Video from Images.json",
      workflowFile: "production-image-to-video.json",
    };

    expect(normalizeExplicitCreateVideoFromImagesRequest(body)).toBe(true);
    expect(body.workflowId).toBe(CREATE_VIDEO_FROM_IMAGES_WORKFLOW_ID);
    expect(body.preset).toBe(CREATE_VIDEO_FROM_IMAGES_WORKFLOW_ID);
    expect(body.workflowFile).toBe("");
  });

  it("does not alter a genuine production image-to-video request", () => {
    const body: Record<string, any> = {
      workflowId: "production-image-to-video",
      preset: "production-image-to-video",
      workflowFile: "production-image-to-video.json",
      workflowPath: "workflows/production/production-image-to-video.json",
      requestKind: "production-default-image-to-video",
    };

    const original = structuredClone(body);

    expect(normalizeExplicitCreateVideoFromImagesRequest(body)).toBe(false);
    expect(body).toEqual(original);
  });

  it("normalizes the request before graph selection in the POST handler", () => {
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "app/api/comfy/route.ts"),
      "utf8"
    );

    const normalizerCall = routeSource.indexOf(
      "normalizeExplicitCreateVideoFromImagesRequest(body);"
    );
    const graphSelection = routeSource.indexOf("let graph: any = null;");

    expect(normalizerCall).toBeGreaterThan(0);
    expect(graphSelection).toBeGreaterThan(normalizerCall);
  });

  it("preserves the valid node contracts for both workflows", () => {
    const explicitPreset = JSON.parse(
      fs.readFileSync(
        path.resolve(
          process.cwd(),
          "comfy_workflows/presets/Create a Video from Images.json"
        ),
        "utf8"
      )
    );

    const productionWorkflow = JSON.parse(
      fs.readFileSync(
        path.resolve(
          process.cwd(),
          "workflows/production/production-image-to-video.json"
        ),
        "utf8"
      )
    );

    expect(loadImageNodeIds(explicitPreset)).toEqual(["187"]);
    expect(loadImageNodeIds(productionWorkflow)).toEqual(["149"]);
  });
});
