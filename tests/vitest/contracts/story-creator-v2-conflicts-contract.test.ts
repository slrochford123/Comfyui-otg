import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(
    path.join(root, relativePath),
    "utf8",
  );
}

const store = read("lib/storyCreator/store.ts");
const route = read(
  "app/api/story-creator/conflicts/route.ts",
);
const panel = read(
  "app/app/components/StoryCreatorPanel.tsx",
);
const conflictPanel = read(
  "app/app/components/storyCreatorV2/ConflictReviewPanel.tsx",
);

describe("Story Creator V2 conflict review contract", () => {
  it("adds durable conflict storage and resolution helpers", () => {
    expect(store).toContain(
      "CREATE TABLE IF NOT EXISTS story_conflicts",
    );
    expect(store).toContain("idx_story_conflicts_pair");
    expect(store).toContain("idx_story_conflicts_project_status");
    expect(store).toContain(
      "CHECK(status IN ('open', 'resolved', 'dismissed'))",
    );
    expect(store).toContain("resolved_at INTEGER");
    expect(store).toContain(
      "export function findStoryBibleConflicts",
    );
    expect(store).toContain(
      "export function listStoryConflicts",
    );
    expect(store).toContain(
      "export function resolveStoryConflict",
    );
    expect(store).toContain("KEEP_CURRENT_CANON");
    expect(store).toContain("USE_PROPOSED_VERSION");
    expect(store).toContain("EDIT_PROPOSED_VERSION");
    expect(store).toContain("DISMISS_CONFLICT");
    expect(store).toContain(
      "STORY_BIBLE_NON_USER_CANON_FORBIDDEN",
    );
  });

  it("exposes conflicts through authenticated read, scan, and resolution actions", () => {
    expect(route).toContain("export async function GET");
    expect(route).toContain("export async function POST");
    expect(route).toContain("requireSessionUser");
    expect(route).toContain("listStoryConflicts");
    expect(route).toContain("findStoryBibleConflicts");
    expect(route).toContain("resolveStoryConflict");
    expect(route).toContain('"ownerKey" in body');
    expect(route).toContain('"sourceRole" in body');
    expect(route).toContain('"canonStatus" in body');
  });

  it("connects conflict review to the selected Story project", () => {
    expect(panel).toContain("/api/story-creator/conflicts?projectId=");
    expect(panel).toContain("/api/story-creator/conflicts");
    expect(panel).toContain("projectId: project.id");
    expect(panel).toContain("loadStoryConflicts(selectedProjectId)");
    expect(panel).toContain("resolveStoryConflict");
    expect(panel).not.toContain("selectedConflictProjectId");
  });

  it("renders conflicts as actionable review items", () => {
    expect(conflictPanel).toContain("Conflict Review");
    expect(conflictPanel).toContain("Check conflicts");
    expect(conflictPanel).toContain(
      "choose which version canon should keep",
    );
    expect(conflictPanel).toContain("Keep current canon");
    expect(conflictPanel).toContain("Use proposed version");
    expect(conflictPanel).toContain("Edit proposed version");
    expect(conflictPanel).toContain("Dismiss conflict");
  });
});
