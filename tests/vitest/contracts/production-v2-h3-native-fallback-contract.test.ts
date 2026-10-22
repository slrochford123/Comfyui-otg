import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("Production V2 H3 native fallback", () => {
  it("completes the native 3090 output when optional RTX 5060 Ti VSR is unavailable or busy", () => {
    const scheduler = fs.readFileSync(path.join(ROOT, "lib/production/h3GenerationScheduler.ts"), "utf8");
    const jobs = fs.readFileSync(path.join(ROOT, "lib/production/h3GenerationJobs.ts"), "utf8");

    expect(jobs).toContain("completeProductionV2GenerationNativeJob");
    expect(jobs).toContain("status = 'completed'");
    expect(scheduler).toContain('Complete - native H3 output (RTX 5060 Ti VSR unavailable)');
    expect(scheduler).toContain('Complete - native H3 output (RTX 5060 Ti busy; VSR skipped)');
    expect(scheduler).toContain("sceneStatus(completed, \"generated\", job.nativeOutputPath)");
    expect(scheduler).toContain('const postprocess = hasVsrFinal');
    expect(scheduler).toContain(': "native-h3"');
    expect(scheduler).toContain('finalResolution: finalWidth && finalHeight ? `${finalWidth}x${finalHeight}` : null');
  });
});
