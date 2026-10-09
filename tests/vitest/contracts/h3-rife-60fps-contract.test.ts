import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildH3Rife60FpsWorkflow,
  h3RifeExpectedAssetsForBackend,
  h3RifeRequiredNodesForBackend,
  h3FinalFpsForRife,
  H3_RIFE_5060_TARGET_MODEL,
  H3_RIFE_NATIVE_FPS,
  H3_RIFE_TARGET_FPS,
  H3_RIFE_TARGET_MODEL,
  normalizeH3RifeInterpolation60Fps,
} from "../../../lib/h3RifeFinalization";
import { validateH3RefModsRequest } from "../../../lib/h3SpecialModes/refMods";
import { createProductionV2 } from "../../../lib/production/v2";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("H3 RIFE 60 FPS finalization contract", () => {
  it("normalizes the shared setting to off for old records", () => {
    expect(normalizeH3RifeInterpolation60Fps(undefined)).toBe(false);
    expect(normalizeH3RifeInterpolation60Fps(false)).toBe(false);
    expect(normalizeH3RifeInterpolation60Fps(true)).toBe(true);
    expect(h3FinalFpsForRife(false)).toBe(H3_RIFE_NATIVE_FPS);
    expect(h3FinalFpsForRife(true)).toBe(H3_RIFE_TARGET_FPS);

    const production = createProductionV2("RIFE defaults", "minimax-h3", new Date(0).toISOString());
    expect(production.scenes[0].modelState.h3.rifeInterpolation60Fps).toBe(false);
  });

  it("adds one visible switch to all six H3 Studio modes and Production V2", () => {
    const panel = read("app/app/components/H3Panel.tsx");
    const productionPanel = read("app/app/components/ProductionV2Panel.tsx");
    expect(panel).toContain('data-otg="h3-rife-60fps-control"');
    expect(panel.match(/renderRife60FpsControl\(\)/g) || []).toHaveLength(5);
    expect(panel).toContain("Interpolate");
    expect(panel).toContain("H3 still renders natively at 24 FPS");
    expect(productionPanel).toContain('data-otg="production-v2-h3-rife-60fps"');
  });

  it("keeps native H3 workflow FPS at 24 and builds a real 3090 RIFE FPS-resample graph", () => {
    const h3Workflows = read("lib/production/h3Workflows.ts");
    expect(h3Workflows).toContain("graph[\"34\"].inputs.fps !== 24");

    const built = buildH3Rife60FpsWorkflow({
      videoFilename: "finished.mp4",
      outputPrefix: "otg_h3_rife/test",
      backend: "rtx3090",
    });
    expect(built.workflowId).toBe("h3-rife-60fps");
    expect(built.graph["2"].class_type).toBe("RIFE_FPS_Resample");
    expect(built.graph["2"].inputs.ckpt_name).toBe(H3_RIFE_TARGET_MODEL);
    expect(built.graph["2"].inputs.fps_in).toBe(H3_RIFE_NATIVE_FPS);
    expect(built.graph["2"].inputs.fps_out).toBe(H3_RIFE_TARGET_FPS);
    expect(built.graph["3"].inputs.frame_rate).toBe(H3_RIFE_TARGET_FPS);
    expect(JSON.stringify(built.graph)).not.toContain("CreateVideo fps = 60");
  });

  it("uses the qualified RIFEInterpolation implementation on the RTX 5060 Ti", () => {
    expect(h3RifeRequiredNodesForBackend("rtx5060ti")).toEqual([
      "VHS_LoadVideo",
      "RIFEInterpolation",
      "VHS_VideoCombine",
    ]);
    expect(h3RifeExpectedAssetsForBackend("rtx5060ti")).toEqual([
      ["RIFEInterpolation", "model_name", H3_RIFE_5060_TARGET_MODEL],
    ]);
    const built = buildH3Rife60FpsWorkflow({
      videoFilename: "finished.mp4",
      outputPrefix: "otg_h3_rife/test-5060",
      backend: "rtx5060ti",
    });
    expect(built.graph["2"].class_type).toBe("RIFEInterpolation");
    expect(built.graph["2"].inputs.source_fps).toBe(H3_RIFE_NATIVE_FPS);
    expect(built.graph["2"].inputs.target_fps).toBe(H3_RIFE_TARGET_FPS);
    expect(built.graph["2"].inputs.model_name).toBe(H3_RIFE_5060_TARGET_MODEL);
    expect(built.graph["2"].inputs.use_fp16).toBe(true);
    expect(built.graph["3"].inputs.frame_rate).toBe(H3_RIFE_TARGET_FPS);
  });

  it("carries the setting through every H3 request family", () => {
    expect(read("lib/h3DirectJobs.ts")).toContain("rifeInterpolation60Fps");
    expect(read("lib/h3SpecialModes/realismJobs.ts")).toContain("rifeInterpolation60Fps");
    expect(read("lib/h3SpecialModes/bodySwapJobs.ts")).toContain("rifeInterpolation60Fps");
    expect(read("lib/production/h3GenerationJobs.ts")).toContain("rifeInterpolation60Fps");
    expect(validateH3RefModsRequest({
      mode: "h3-refmods",
      quality: "sh",
      orientation: "landscape",
      durationSeconds: 5,
      prompt: "test",
      refMods: [{ name: "characters/isabella" }],
      rifeInterpolation60Fps: true,
    }).rifeInterpolation60Fps).toBe(true);
  });
});
