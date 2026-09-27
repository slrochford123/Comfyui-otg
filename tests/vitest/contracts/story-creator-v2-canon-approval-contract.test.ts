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
const approveRoute = read(
  "app/api/story-creator/canon/approve/route.ts",
);
const rejectRoute = read(
  "app/api/story-creator/canon/reject/route.ts",
);
const panel = read(
  "app/app/components/StoryCreatorPanel.tsx",
);
const queue = read(
  "app/app/components/storyCreatorV2/CanonApprovalQueue.tsx",
);

describe("Story Creator V2 canon approval contract", () => {
  it("adds durable review-backed canon approval helpers", () => {
    expect(store).toContain(
      "CREATE TABLE IF NOT EXISTS story_fact_reviews",
    );

    expect(store).toContain(
      "idx_story_fact_reviews_proposal",
    );

    expect(store).toContain(
      "export function approveStoryBibleFact",
    );

    expect(store).toContain(
      "export function rejectStoryBibleFact",
    );

    expect(store).toContain(
      "export function listPendingStoryBibleFacts",
    );

    expect(store).toContain(
      "STORY_CANON_CONFLICT_REQUIRES_RESOLUTION",
    );
  });

  it("exposes approval through a separate authenticated route", () => {
    expect(approveRoute).toContain("export async function POST");
    expect(approveRoute).not.toContain("export async function GET");
    expect(approveRoute).toContain("requireSessionUser");
    expect(approveRoute).toContain("authenticatedOwnerKey");
    expect(approveRoute).toContain("approveStoryBibleFact");
    expect(approveRoute).toContain("getStoryFactReview");
    expect(approveRoute).toContain('"ownerKey" in body');
    expect(approveRoute).toContain('"sourceRole" in body');
    expect(approveRoute).toContain('"canonStatus" in body');
    expect(approveRoute).toContain('"supersedesFactId" in body');
  });

  it("exposes rejection through a separate authenticated route", () => {
    expect(rejectRoute).toContain("export async function POST");
    expect(rejectRoute).not.toContain("export async function GET");
    expect(rejectRoute).toContain("requireSessionUser");
    expect(rejectRoute).toContain("authenticatedOwnerKey");
    expect(rejectRoute).toContain("rejectStoryBibleFact");
    expect(rejectRoute).toContain('"ownerKey" in body');
    expect(rejectRoute).toContain('"sourceRole" in body');
    expect(rejectRoute).toContain('"canonStatus" in body');
  });

  it("connects the Bible tab approval queue without moving project ownership", () => {
    expect(panel).toContain(
      "/api/story-creator/canon/approve",
    );

    expect(panel).toContain(
      "/api/story-creator/canon/reject",
    );

    expect(panel).toContain(
      "projectId: project.id",
    );

    expect(panel).toContain(
      "storyBiblePendingFacts",
    );

    expect(panel).toContain(
      "loadStoryBible(project.id)",
    );

    expect(panel).not.toContain(
      "selectedCanonProjectId",
    );
  });

  it("renders explicit canon review actions", () => {
    expect(queue).toContain("Approval Queue");
    expect(queue).toContain("Approve as canon");
    expect(queue).toContain("Edit & approve");
    expect(queue).toContain("Reject suggestion");
    expect(queue).toContain(
      "Conflict review required",
    );
    expect(queue).toContain("No suggestions are waiting");
  });
});
