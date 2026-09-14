import { describe, expect, it } from "vitest";

import { validateH3DirectInput } from "../../../lib/h3DirectJobs";
import {
  getH3NativeDimensions,
  H3_PRODUCTION_ROUTE_KEYS,
  type H3Orientation,
  type H3Quality,
} from "../../../lib/production/h3ProductionRecipes";
import {
  buildH3Workflow,
  type ProductionV2H3Mode,
} from "../../../lib/production/h3Workflows";

const modes: ProductionV2H3Mode[] = [
  "h3-text-to-video",
  "h3-image-to-video",
  "h3-reference-to-video",
];

function build(
  mode: ProductionV2H3Mode,
  quality: H3Quality,
  orientation: H3Orientation,
) {
  return buildH3Workflow({
    backend: "rtx5060ti",
    mode,
    h3Quality: quality,
    orientation,
    durationSeconds: 5,
    finalPrompt:
      mode === "h3-reference-to-video"
        ? "<Picture 1> <Subject 1> moves through the scene."
        : "A subject moves through the scene.",
    seed: 42,
    outputPrefix: `contract/${mode}/${quality}/${orientation}`,
    startImageFilename:
      mode === "h3-image-to-video" ? "first.png" : undefined,
    references:
      mode === "h3-reference-to-video"
        ? [
            {
              id: "picture-1",
              name: "Picture 1",
              sourceKind: "production-upload",
              pictureSlot: 1,
              subjectSlot: 1,
              workflowImage: "/tmp/picture.png",
              uploadedFilename: "picture.png",
            },
          ]
        : undefined,
    voices: [],
  });
}

function directInput(mode: ProductionV2H3Mode) {
  return {
    mode,
    quality: "lq" as const,
    orientation: "portrait" as const,
    durationSeconds: 5 as const,
    prompt: "A direct user prompt.",
    seed: 7,
    optionalLoras: [],
    firstImage:
      mode === "h3-image-to-video"
        ? { path: "/tmp/first.png", name: "first.png", description: "" }
        : null,
    lastImage: null,
    images:
      mode === "h3-reference-to-video"
        ? [{ path: "/tmp/ref.png", name: "ref.png", description: "hero" }]
        : [],
    videos: [],
    audios: [],
  };
}

describe("H3 orientation and direct-generation contracts", () => {
  it("maps both quality tiers to canonical landscape and swapped portrait geometry", () => {
    expect(getH3NativeDimensions("lq", "landscape")).toEqual({ width: 1056, height: 608 });
    expect(getH3NativeDimensions("lq", "portrait")).toEqual({ width: 608, height: 1056 });
    expect(getH3NativeDimensions("hq", "landscape")).toEqual({ width: 1376, height: 768 });
    expect(getH3NativeDimensions("hq", "portrait")).toEqual({ width: 768, height: 1376 });
  });

  it("reuses each qualified graph route while mutating only output geometry", () => {
    for (const mode of modes) {
      for (const quality of ["lq", "hq"] as const) {
        const landscape = build(mode, quality, "landscape");
        const portrait = build(mode, quality, "portrait");
        const expected = getH3NativeDimensions(quality, "portrait");

        expect(portrait.workflowId).toBe(landscape.workflowId);
        expect(portrait.workflowFile).toBe(landscape.workflowFile);
        expect(portrait.graph["39"].inputs.width).toBe(expected.width);
        expect(portrait.graph["39"].inputs.height).toBe(expected.height);
        expect(portrait.graph["39"].inputs.length).toBe(landscape.graph["39"].inputs.length);
        expect(portrait.graph["36"]).toEqual(landscape.graph["36"]);
        expect(portrait.graph["41"]).toEqual(landscape.graph["41"]);
      }
    }
    expect(H3_PRODUCTION_ROUTE_KEYS).toHaveLength(24);
  });

  it("accepts raw T2V, conditioned I2V, and mapped R2V input without builder state", () => {
    for (const mode of modes) {
      expect(validateH3DirectInput(directInput(mode))).toMatchObject({
        mode,
        prompt: "A direct user prompt.",
        orientation: "portrait",
      });
    }
  });

  it("enforces real mode inputs and orientation, not Ollama review state", () => {
    expect(() =>
      validateH3DirectInput({
        ...directInput("h3-image-to-video"),
        firstImage: null,
      }),
    ).toThrow("Choose a First Image");
    expect(() =>
      validateH3DirectInput({
        ...directInput("h3-reference-to-video"),
        images: [],
      }),
    ).toThrow("Add at least one reference");
    expect(() =>
      validateH3DirectInput({
        ...directInput("h3-text-to-video"),
        orientation: "square" as "portrait",
      }),
    ).toThrow("Choose Landscape or Portrait");
  });
});
