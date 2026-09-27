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
  "app/api/story-creator/questions/route.ts",
);
const extractRoute = read(
  "app/api/story-creator/extract/route.ts",
);
const panel = read(
  "app/app/components/StoryCreatorPanel.tsx",
);
const ideas = read(
  "app/app/components/storyCreatorV2/IdeasTab.tsx",
);

describe("Story Creator V2 open questions contract", () => {
  it("persists open questions separately from canon facts", () => {
    expect(store).toContain(
      "CREATE TABLE IF NOT EXISTS story_open_questions",
    );
    expect(store).toContain("addStoryOpenQuestion");
    expect(store).toContain("listStoryOpenQuestions");
    expect(store).toContain("'answered'");
    expect(store).toContain("'dismissed'");
  });

  it("exposes an authenticated questions route", () => {
    expect(route).toContain("export async function GET");
    expect(route).toContain("export async function POST");
    expect(route).toContain("requireSessionUser");
    expect(route).toContain("sourceRole: \"user\"");
  });

  it("extracts openQuestions without promoting them to canon", () => {
    expect(extractRoute).toContain("openQuestions");
    expect(extractRoute).toContain("applyStoryExtraction");
    expect(store).toContain("sourceMessageId");
    expect(store).toContain('sourceRole: "assistant"');
    expect(extractRoute).not.toContain('canonStatus: "canon"');
  });

  it("renders loaded questions in the Ideas tab", () => {
    expect(panel).toContain("/api/story-creator/questions");
    expect(panel).toContain("openQuestions={storyOpenQuestions}");
    expect(ideas).toContain("Story Gaps");
    expect(ideas).toContain("openQuestions.map");
  });
});
