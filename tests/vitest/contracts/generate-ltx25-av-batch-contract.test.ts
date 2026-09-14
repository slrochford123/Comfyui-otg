import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

const workflows = [
  {
    label: "T2V",
    file: "comfy_workflows/presets/LTX 2.5 Text To Video.json",
    videoNodeId: "405:356",
    audioNodeId: "405:366",
  },
  {
    label: "I2V",
    file: "comfy_workflows/presets/LTX 2.5 Image To Video.json",
    videoNodeId: "398:356",
    audioNodeId: "398:366",
  },
  {
    label: "FLF",
    file: "comfy_workflows/presets/LTX 2.5 First Last Frame Video.json",
    videoNodeId: "251:201",
    audioNodeId: "251:197",
  },
] as const;

describe("LTX 2.5 AV latent batch contract", () => {
  it.each(workflows)(
    "$label keeps video and audio latent batches aligned at one",
    ({ file, videoNodeId, audioNodeId }) => {
      const graph = JSON.parse(
        fs.readFileSync(
          path.join(repoRoot, file),
          "utf8",
        ),
      );

      const videoNode = graph[videoNodeId];
      const audioNode = graph[audioNodeId];

      expect(videoNode?.class_type).toBe(
        "EmptyLTXVLatentVideo",
      );

      expect(audioNode?.class_type).toBe(
        "LTXVEmptyLatentAudio",
      );

      expect(videoNode.inputs.batch_size).toBe(1);
      expect(audioNode.inputs.batch_size).toBe(1);

      expect(audioNode.inputs.batch_size).toBe(
        videoNode.inputs.batch_size,
      );
    },
  );
});
