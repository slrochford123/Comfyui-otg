import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  compileH3BodySwapPrompt,
  validateH3BodySwapRequest,
} from "../../../lib/h3SpecialModes/bodySwap";
import { buildH3BodySwapWorkflow } from "../../../lib/h3SpecialModes/bodySwapWorkflow";
import { H3_PRODUCTION_ROUTE_KEYS } from "../../../lib/production/h3ProductionRecipes";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("H3 Body Swap special mode contract", () => {
  it("keeps Body Swap out of the normal H3 production route matrix", () => {
    expect(H3_PRODUCTION_ROUTE_KEYS.some((key) => key.includes("body-swap"))).toBe(false);
    expect(read("lib/production/h3Workflows.ts")).not.toContain("h3-body-swap");
  });

  it("exposes Body Swap through dedicated special-mode UI and routes only", () => {
    const panel = read("app/app/components/H3Panel.tsx");
    const route = read("app/api/h3/special/body-swap/generation/route.ts");
    const jobs = read("lib/h3SpecialModes/bodySwapJobs.ts");

    expect(panel).toContain('data-otg="h3-body-swap-workspace"');
    expect(panel).toContain('data-otg="h3-body-swap-controls"');
    expect(panel).toContain("Preserve Original Audio");
    expect(panel).toContain("Generate Body Swap");
    expect(panel).toContain("/api/h3/special/body-swap/generation");
    expect(panel).toContain("max_objects=1");
    expect(route).toContain("validateH3BodySwapJobInput");
    expect(jobs).toContain("remuxOriginalAudio");
    expect(jobs).toContain('"1:a?"');
    expect(jobs).toContain("RTX 3090 Comfy Kitchen");
    expect(jobs).toContain("http://100.75.162.64:8188");
    expect(jobs).toContain('sourceType: "h3-body-swap-generation"');
  });

  it("compiles a single-person Body Swap prompt from simple controls", () => {
    const prompt = compileH3BodySwapPrompt({
      selector: "woman wearing the red coat",
      prompt: "keep the walking rhythm natural",
      preserveOriginalAudio: true,
    });
    expect(prompt).toContain("subject_definitions:");
    expect(prompt).toContain("<Picture 1>");
    expect(prompt).toContain("<Video 1>");
    expect(prompt).toContain("woman wearing the red coat");
    expect(prompt).toContain("keep the walking rhythm natural");
    expect(prompt).toContain("preserves the original source-video audio");
    expect(prompt).toContain("No residual black border");
  });

  it("validates body swap request controls", () => {
    const request = validateH3BodySwapRequest({
      selector: "",
      prompt: "swap this person",
      quality: "sh",
      orientation: "landscape",
      durationSeconds: 5,
      preserveOriginalAudio: true,
    });
    expect(request.selector).toBe("person");
    expect(request.preserveOriginalAudio).toBe(true);
    expect(() =>
      validateH3BodySwapRequest({
        quality: "bad",
        orientation: "landscape",
        durationSeconds: 5,
      }),
    ).toThrow("Choose SH, LQ, or HQ");
  });

  it("builds the single-person Body Swap workflow from the copied template", () => {
    expect(fs.existsSync(path.join(root, "comfy_workflows/internal/h3-special/body-swap.api.json"))).toBe(true);
    const built = buildH3BodySwapWorkflow({
      sourceVideoFilename: "source-upload.mp4",
      replacementImageFilename: "replacement-upload.png",
      prompt: "keep the coat natural",
      selector: "person",
      quality: "sh",
      orientation: "landscape",
      durationSeconds: 5,
      seed: 42,
      outputPrefix: "contract/body-swap",
      preserveOriginalAudio: true,
    });

    expect(built.workflowId).toBe("h3-body-swap-single-person");
    expect(built.workflowFile).toBe("comfy_workflows/internal/h3-special/body-swap.api.json");
    expect(built.graph["720"].inputs?.video).toBe("source-upload.mp4");
    expect(built.graph["720"].inputs?.force_rate).toBe(24);
    expect(built.graph["720"].inputs?.custom_width).toBe(608);
    expect(built.graph["720"].inputs?.custom_height).toBe(352);
    expect(built.graph["720"].inputs?.frame_load_cap).toBe(124);
    expect(built.graph["164"].inputs?.image).toBe("replacement-upload.png");
    expect(built.graph["715"].inputs?.text).toBe("person");
    expect(built.graph["716"].inputs?.max_objects).toBe(1);
    expect(built.graph["716"].inputs?.detection_threshold).toBe(0.5);
    expect(built.graph["717"].inputs?.object_indices).toBe("0");
    expect(built.graph["129"].inputs?.noise_seed).toBe(42);
    expect(built.graph["124"].inputs?.steps).toBe(4);
    expect(built.graph["704"].inputs?.volume).toBe(-100);
    expect(built.graph["92"].inputs?.filename_prefix).toBe("contract/body-swap");
    expect(built.graph["722"].inputs?.filename_prefix).toBe("contract/body-swap_mask");
    expect(built.compiledPrompt).toContain("single-person body swap");
  });

  it("adapts Body Swap source video dimensions for portrait H3 quality", () => {
    const built = buildH3BodySwapWorkflow({
      sourceVideoFilename: "source-upload.mp4",
      replacementImageFilename: "replacement-upload.png",
      prompt: "keep the posture natural",
      selector: "person",
      quality: "sh",
      orientation: "portrait",
      durationSeconds: 5,
      seed: 42,
      outputPrefix: "contract/body-swap-portrait",
      preserveOriginalAudio: true,
    });

    expect(built.graph["720"].inputs?.custom_width).toBe(352);
    expect(built.graph["720"].inputs?.custom_height).toBe(608);
    expect(built.graph["720"].inputs?.frame_load_cap).toBe(124);
  });
});
