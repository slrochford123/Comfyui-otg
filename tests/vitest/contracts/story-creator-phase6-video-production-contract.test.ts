import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("Story Creator Phase 6 H3 video production contracts", () => {
  it("keeps video and media APIs authenticated and project scoped", () => {
    for (const route of [
      "app/api/story-creator/video-production/route.ts",
      "app/api/story-creator/video-production/media/route.ts",
    ]) {
      const source = read(route);
      expect(source).toContain("requireSessionUser");
      expect(source).toContain("projectId");
      expect(source).not.toContain("OPENAI_API_KEY");
    }
  });

  it("reuses the durable H3 scheduler and preserves qualified mode contracts", () => {
    const implementation = read("lib/storyCreator/videoProduction.ts");
    const route = read("app/api/story-creator/video-production/route.ts");
    expect(implementation).toContain("createProductionV2GenerationJob");
    expect(route).toContain("requestProductionV2H3SchedulerTick");
    expect(implementation).toContain('"h3-text-to-video"');
    expect(implementation).toContain('"h3-image-to-video"');
    expect(implementation).toContain('"h3-reference-to-video"');
    expect(implementation).not.toContain("/prompt");
  });

  it("requires explicit single and batch authorization", () => {
    const implementation = read("lib/storyCreator/videoProduction.ts");
    const component = read("app/app/components/storyCreatorV2/StoryVideoProductionStudio.tsx");
    expect(implementation).toContain("Explicit video generation authorization is required");
    expect(implementation).toContain("Explicit batch generation authorization is required");
    expect(component).toContain("Confirmation required");
    expect(component).toContain("Create Video");
    expect(component).toContain("Approve Batch and Queue");
  });

  it("retains durable plan-version shot and take history", () => {
    const implementation = read("lib/storyCreator/videoProduction.ts");
    for (const marker of [
      "story_video_takes",
      "story_video_batches",
      "plan_version",
      "scene_id",
      "shot_id",
      "take_number",
      "parent_take_id",
      "idempotency_key",
    ]) expect(implementation).toContain(marker);
  });

  it("never uses a global interrupt for Storyteller cancellation", () => {
    const implementation = read("lib/storyCreator/videoProduction.ts");
    const route = read("app/api/story-creator/video-production/route.ts");
    expect(implementation).not.toContain('fetch(`${H3_BACKEND_PROFILES');
    expect(route).not.toContain("/interrupt");
    expect(implementation).toContain("Safe cancellation cannot interrupt an unrelated running GPU job");
  });

  it("passes orientation and advanced settings through the existing H3 payload", () => {
    const jobs = read("lib/production/h3GenerationJobs.ts");
    const scheduler = read("lib/production/h3GenerationScheduler.ts");
    expect(jobs).toContain("orientation?: H3Orientation");
    expect(jobs).toContain("h3Settings?: H3AdvancedSettings");
    expect(scheduler).toContain("orientation: job.payload.orientation");
    expect(scheduler).toContain("h3Settings: job.payload.h3Settings");
  });
});
