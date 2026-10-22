import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Story production plan API contract", () => {
  const route = read("app/api/story-creator/production-plan/route.ts");
  const store = read("lib/storyCreator/store.ts");

  it("requires an authenticated owner for reads and writes", () => {
    expect(route.match(/requireSessionUser\(request\)/g)?.length).toBe(2);
    expect(route).toContain("projectForOwner(user.ownerKey, projectId)");
    expect(route).toContain("ownerKey: user.ownerKey");
    expect(route).toContain('"STORY_PROJECT_NOT_FOUND"');
  });

  it("keeps AI planning explicit and separate from approval", () => {
    expect(route).toContain('if (action === "generate")');
    expect(route).toContain('useCase: "story-write"');
    expect(route).toContain("buildStoryDirectorProjectContext");
    expect(route).toContain('if (action === "approve")');
    expect(route).toContain("No image, video, audio, paid batch, or GPU generation was started.");
    expect(route).not.toContain("createStoryGenerationJob");
    expect(route).not.toContain("/api/h3/");
  });

  it("stores append-only plan snapshots and clears approval after edits", () => {
    expect(store).toContain("story_production_plan_versions");
    expect(store).toContain("ORDER BY version DESC");
    expect(store).toContain("approved_at = NULL");
    expect(store).toContain("STORY_PRODUCTION_PLAN_TOO_LARGE");
  });
});
