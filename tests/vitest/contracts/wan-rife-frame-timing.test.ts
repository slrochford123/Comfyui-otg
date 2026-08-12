import { describe, expect, it } from "vitest";
import {
  applyWanRifeFrameTiming,
  resolveWanRifeTiming,
  WAN_NATIVE_FPS,
  WAN_OUTPUT_FPS,
} from "../../../lib/wanRifeFrameTiming";

function wanGraph() {
  return {
    "10": {
      class_type: "UnetLoaderGGUF",
      inputs: { unet_name: "wan22T2VA14BGGUF_highQ50.gguf" },
    },
    "20": {
      class_type: "EmptyHunyuanLatentVideo",
      inputs: { width: 1280, height: 720, length: 361 },
    },
    "30": {
      class_type: "VAEDecode",
      inputs: { samples: ["20", 0], vae: ["11", 0] },
    },
    "40": {
      class_type: "VHS_VideoCombine",
      inputs: { images: ["30", 0], frame_rate: 24, filename_prefix: "WAN" },
    },
  };
}

describe("WAN 2.2 16 FPS to RIFE 24 FPS contract", () => {
  it.each([
    [5, 81, 121, 40],
    [10, 161, 241, 80],
    [15, 241, 361, 120],
  ])("maps %s seconds to exact native and final frames", (seconds, nativeFrames, outputFrames, addedFrames) => {
    const timing = resolveWanRifeTiming(seconds);
    expect(timing.nativeFps).toBe(WAN_NATIVE_FPS);
    expect(timing.outputFps).toBe(WAN_OUTPUT_FPS);
    expect(timing.nativeFrames).toBe(nativeFrames);
    expect(timing.outputFrames).toBe(outputFrames);
    expect(timing.skippedInterpolationPairs).toHaveLength(addedFrames);
    const interpolatedPairs = timing.nativeFrames - 1 - timing.skippedInterpolationPairs.length;
    expect(interpolatedPairs).toBe(addedFrames);
    expect(timing.nativeFrames + interpolatedPairs).toBe(outputFrames);
  });

  it("injects the exact RIFE schedule after WAN decoding", () => {
    const graph = wanGraph();
    const result = applyWanRifeFrameTiming(graph, { durationSeconds: 10, workflowId: "wan22-t2v-gguf" });

    expect(result.applied).toBe(true);
    expect(graph["20"].inputs.length).toBe(161);
    expect(graph["40"].inputs.frame_rate).toBe(24);

    const rifeId = result.rifeNodeIds[0];
    const scheduleId = result.scheduleNodeIds[0];
    expect(graph["40"].inputs.images).toEqual([rifeId, 0]);
    expect(graph[rifeId].class_type).toBe("RIFE VFI");
    expect(graph[rifeId].inputs.frames).toEqual(["30", 0]);
    expect(graph[rifeId].inputs.multiplier).toBe(2);
    expect(graph[rifeId].inputs.ckpt_name).toBe("rife47.pth");
    expect(graph[rifeId].inputs.optional_interpolation_states).toEqual([scheduleId, 0]);
    expect(graph[scheduleId].class_type).toBe("Make Interpolation State List");
    expect(String(graph[scheduleId].inputs.frame_indices).split(",")).toHaveLength(80);
    expect(graph[scheduleId].inputs.is_skip_list).toBe(true);
  });

  it("is idempotent and updates existing RIFE timing", () => {
    const graph = wanGraph();
    const first = applyWanRifeFrameTiming(graph, { durationSeconds: 5 });
    const second = applyWanRifeFrameTiming(graph, { durationSeconds: 15 });

    expect(second.rifeNodeIds).toEqual(first.rifeNodeIds);
    expect(second.scheduleNodeIds).toEqual(first.scheduleNodeIds);
    expect(Object.values(graph).filter((node) => node.class_type === "RIFE VFI")).toHaveLength(1);
    expect(Object.values(graph).filter((node) => node.class_type === "Make Interpolation State List")).toHaveLength(1);
    expect(graph["20"].inputs.length).toBe(241);
    expect(String(graph[second.scheduleNodeIds[0]].inputs.frame_indices).split(",")).toHaveLength(120);
  });

  it("leaves non-WAN workflows unchanged", () => {
    const graph = {
      "1": { class_type: "EmptyHunyuanLatentVideo", inputs: { length: 121 } },
      "2": { class_type: "VHS_VideoCombine", inputs: { images: ["1", 0], frame_rate: 24 } },
    };
    const before = JSON.stringify(graph);
    const result = applyWanRifeFrameTiming(graph, { durationSeconds: 10, workflowId: "ltx-2.3" });
    expect(result.applied).toBe(false);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it.each(["WanImageToVideo", "WanFirstLastFrameToVideo"])(
    "sets native length on %s workflows",
    (classType) => {
      const graph = wanGraph();
      graph["20"].class_type = classType;
      const result = applyWanRifeFrameTiming(graph, { durationSeconds: 10 });
      expect(result.applied).toBe(true);
      expect(graph["20"].inputs.length).toBe(161);
    }
  );
});
