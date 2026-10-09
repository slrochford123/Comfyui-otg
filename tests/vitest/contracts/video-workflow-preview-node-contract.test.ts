import { describe, expect, it } from "vitest";

import { ensureTerminalVideoPreviewNode, type ComfyVideoPreviewGraph } from "@/lib/comfyVideoPreview";
import { buildH3Workflow } from "@/lib/production/h3Workflows";
import { buildH3RealismWorkflow } from "@/lib/h3SpecialModes/realismWorkflow";
import { buildH3BodySwapWorkflow } from "@/lib/h3SpecialModes/bodySwapWorkflow";
import { buildH3RefModsT2VWorkflow } from "@/lib/h3SpecialModes/refModsWorkflow";
import { normalizeH3RefModSlots } from "@/lib/h3SpecialModes/refMods";
import { buildH3LtxAlphaWorkflow } from "@/lib/h3SpecialModes/ltxAlphaMotion";

function terminalPreviewNodes(graph: ComfyVideoPreviewGraph) {
  return Object.values(graph).filter((node) =>
    node.class_type === "DenoVideoPreview"
    && node._meta?.title === "OTG terminal video preview",
  );
}

function expectTerminalPreview(graph: ComfyVideoPreviewGraph) {
  const previews = terminalPreviewNodes(graph);
  expect(previews).toHaveLength(1);
  expect(previews[0]?.inputs?.images).toEqual(expect.any(Array));
  expect(Number(previews[0]?.inputs?.frame_rate)).toBeGreaterThan(0);
}

describe("video workflow terminal preview nodes", () => {
  it("adds one terminal Deno video preview beside SaveVideo without replacing output", () => {
    const graph: ComfyVideoPreviewGraph = {
      "1": { class_type: "CreateVideo", inputs: { images: ["10", 0], audio: ["11", 0], fps: 24 } },
      "2": { class_type: "SaveVideo", inputs: { video: ["1", 0], filename_prefix: "contract" } },
    };
    ensureTerminalVideoPreviewNode(graph);
    expect(graph["2"].class_type).toBe("SaveVideo");
    expectTerminalPreview(graph);
  });

  it("standard H3 Text/Image/Reference workflows carry terminal previews", () => {
    const base = {
      backend: "rtx3090" as const,
      h3Quality: "sh" as const,
      durationSeconds: 5 as const,
      finalPrompt: "A careful preview contract scene.",
      seed: 123,
      outputPrefix: "contract/preview",
      voices: [],
    };
    expectTerminalPreview(buildH3Workflow({ ...base, mode: "h3-text-to-video" }).graph);
    expectTerminalPreview(buildH3Workflow({ ...base, mode: "h3-image-to-video", startImageFilename: "start.png" }).graph);
    expectTerminalPreview(buildH3Workflow({
      ...base,
      mode: "h3-reference-to-video",
      finalPrompt: "<Picture 1> <Subject 1> A careful preview contract scene.",
      references: [{
        id: "picture-1",
        name: "Picture 1",
        sourceKind: "production-upload",
        pictureSlot: 1,
        subjectSlot: 1,
        workflowImage: "/tmp/picture.png",
        uploadedFilename: "picture.png",
      }],
    }).graph);
  });

  it("special H3 video workflows carry terminal previews", () => {
    expectTerminalPreview(buildH3RealismWorkflow({
      prompt: "The person looks at camera.",
      quality: "sh",
      orientation: "landscape",
      durationSeconds: 5,
      seed: 123,
      outputPrefix: "contract/realism-preview",
      references: [{ kind: "image", name: "face.png", uploadedFilename: "face.png", description: "" }],
      loraSettings: { preset: "balanced" },
    }).graph);

    expectTerminalPreview(buildH3BodySwapWorkflow({
      sourceVideoFilename: "source.mp4",
      replacementImageFilename: "replacement.png",
      prompt: "natural replacement",
      selector: "person",
      quality: "sh",
      orientation: "landscape",
      durationSeconds: 5,
      seed: 42,
      outputPrefix: "contract/body-swap-preview",
      preserveOriginalAudio: true,
    }).graph);

    expectTerminalPreview(buildH3RefModsT2VWorkflow({
      backend: "rtx3090",
      quality: "sh",
      orientation: "landscape",
      durationSeconds: 5,
      prompt: "A character smiles.",
      refMods: normalizeH3RefModSlots([{ name: "characters/example", category: "character", sourceKind: "video" }]),
      turbo: true,
      seed: 99,
      outputPrefix: "contract/refmods-preview",
    }).graph);
  });

  it("LTX alpha preprocessing workflow carries a terminal preview", () => {
    expectTerminalPreview(buildH3LtxAlphaWorkflow({
      videoFilename: "source.mp4",
      width: 608,
      height: 352,
      frames: 81,
      fps: 24,
      seed: 123,
      outputPrefix: "contract/alpha-preview",
      backend: "rtx3090",
    }).graph);
  });
});
