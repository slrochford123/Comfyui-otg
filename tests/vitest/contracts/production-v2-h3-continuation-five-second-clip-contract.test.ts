import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Production V2 H3 five-second continuation clip", () => {
  it("lets the user select the exact five-second R2V window", () => {
    const panel = read("app/app/components/ProductionV2Panel.tsx");
    expect(panel).toContain('data-otg="production-v2-continuation-clip-selector"');
    expect(panel).toContain('data-otg="production-v2-continuation-clip-preview"');
    expect(panel).toContain('aria-label="Continue Scene five-second reference clip start"');
    expect(panel).toContain("continuationPreviewRef.current.currentTime = startSeconds");
    expect(panel).toContain("const video = event.currentTarget");
    expect(panel).toContain("video.currentTime = startSeconds");
    expect(panel).not.toContain("event.currentTarget.currentTime = startSeconds");
    expect(panel).toContain("continuationClipStartSeconds:");
    expect(panel).toContain("H3 I2V continues from the exact final frame instead");
  });

  it("creates and persists a server-owned clip during continuation preparation", () => {
    const route = read("app/api/production/v2/postprocess/route.ts");
    expect(route).toContain("prepareH3ContinuationReferenceClip");
    expect(route).toContain("buildH3ReferenceVideoTrimCommand");
    expect(route).toContain("referenceClipPath:");
    expect(route).toContain("referenceClipStartSeconds:");
    expect(route).toContain("referenceClipDurationSeconds:");
    expect(route).toContain("outputProbe.durationSeconds > 5.1");
  });

  it("refuses legacy or oversized R2V continuation media before job creation", () => {
    const route = read("app/api/production/v2/generation/route.ts");
    expect(route).toContain("!scene.continuation.referenceClipPath");
    expect(route).toContain("probeProductionV2Media");
    expect(route).toContain(
      "continuationClipProbe.durationSeconds\n            > H3_REFERENCE_VIDEO_CLIP_SECONDS + 0.1",
    );
    expect(route).toContain("mediaPath:\n              continuationClipPath");
    expect(route).not.toContain("mediaPath:\n              continuationSourcePath,\n\n            /*");
  });

  it("keeps I2V on the final frame and fingerprints the R2V clip choice", () => {
    const production = read("lib/production/v2.ts");
    const route = read("app/api/production/v2/generation/route.ts");
    expect(route).toContain("continuationStartingImage");
    expect(route).toContain("scene.continuation.lastFramePath");
    expect(production).toContain("referenceClipPath: scene.continuation.referenceClipPath || null");
    expect(production).toContain(
      "referenceClipStartSeconds: scene.continuation.referenceClipStartSeconds ?? null",
    );
  });
});
