import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Production V2 Scene Hunter contract", () => {
  it("completes SH candidates from native H3 output and skips RTX VSR", () => {
    const jobs = read("lib/production/h3GenerationJobs.ts");
    const scheduler = read("lib/production/h3GenerationScheduler.ts");

    expect(jobs).toContain("completeProductionV2SceneHunterJob");
    expect(jobs).toMatch(/status_message = 'Scene Hunter Preview ready'[\s\S]*output_path = \?/);
    expect(scheduler).toMatch(/job\.payload\.h3Quality === "sh"[\s\S]*completeProductionV2SceneHunterJob\(job\.id, nativeOutputPath\)/);
    expect(scheduler).toMatch(/job\.payload\.h3Quality === "sh"[\s\S]*return;[\s\S]*markProductionV2GenerationNativeReady/);
  });

  it("does not commit completed SH candidates as Production scene media before promotion", () => {
    const scheduler = read("lib/production/h3GenerationScheduler.ts");
    expect(scheduler).toMatch(/if \(job\.payload\.h3Quality === "sh"\) \{[\s\S]*return;[\s\S]*if \(job\.status === "completed" && job\.outputPath\)/);
  });

  it("promoted HQ jobs follow the existing finalization and scene media path", () => {
    const scheduler = read("lib/production/h3GenerationScheduler.ts");
    const route = read("app/api/production/v2/generation/route.ts");

    expect(route).toMatch(/scene-hunter-upscale[\s\S]*h3Quality:\s*"hq"/);
    expect(route).toMatch(/scene-hunter-upscale[\s\S]*sceneHunterSourceJobId:\s*source\.id/);
    expect(scheduler).toContain("completeProductionV2GenerationJob(job.id, finalOutputPath)");
    expect(scheduler).toContain('sceneStatus(completed, "generated", finalOutputPath)');
  });

  it("exposes Scene Hunter candidate UI with Upscale and Download actions", () => {
    const panel = read("app/app/components/ProductionV2Panel.tsx");
    expect(panel).toContain('data-otg="production-v2-scene-hunter-candidate"');
    expect(panel).toContain("Scene Hunter Preview");
    expect(panel).toContain("Upscale");
    expect(panel).toContain("Download");
    expect(panel).toContain("upscaleSceneHunterCandidate");
  });
});
