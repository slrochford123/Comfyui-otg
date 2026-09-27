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
  "app/api/story-creator/extract/route.ts",
);
const panel = read(
  "app/app/components/StoryCreatorPanel.tsx",
);
const ideas = read(
  "app/app/components/storyCreatorV2/IdeasTab.tsx",
);

describe("Story Creator V2 extraction contract", () => {
  it("adds an authenticated extractor route backed by the existing Qwen durable path", () => {
    expect(route).toContain("export async function POST");
    expect(route).not.toContain("export async function GET");
    expect(route).toContain("requireSessionUser");
    expect(route).toContain("qwenDurableFetch");
    expect(route).toContain("QWEN_CLUSTER_MODEL");
    expect(route).toContain("story-creator-extract");
  });

  it("commits normalized extraction through one store helper", () => {
    expect(store).toContain(
      "export function applyStoryExtraction",
    );
    expect(store).toContain("db().transaction");
    expect(store).toContain("sourceMessageId");
    expect(store).toContain(
      "insertDeterministicStoryConflictsForFacts",
    );
    expect(route).toContain("applyStoryExtraction");
    expect(route).toContain("getStoryCreatorMessage");
  });

  it("writes only suggestions and unknowns, never canon", () => {
    expect(route).toContain(
      'fact.canonStatus === "unknown"',
    );
    expect(route).toContain('"suggestion"');
    expect(route).toContain('"unknown"');
    expect(route).not.toContain('canonStatus: "canon"');
    expect(route).not.toContain('"create-canon"');
  });

  it("connects Ideas extraction to the existing selected project and exact source message", () => {
    expect(panel).toContain("/api/story-creator/extract");
    expect(panel).toContain("projectId: project.id");
    expect(panel).toContain("sourceMessageId");
    expect(panel).toContain("extractionSourceMessageId");
    expect(panel).toContain("loadStoryBible(project.id)");
    expect(panel).toContain("loadStoryConflicts(project.id)");
    expect(panel).toContain('setStoryCreatorStage("bible")');
    expect(panel).not.toContain("selectedExtractionProjectId");
  });

  it("presents extraction as non-canon Bible suggestions", () => {
    expect(ideas).toContain("Extract Story Info");
    expect(ideas).toContain("Retry Extraction");
    expect(ideas).toContain(
      "Bible as suggestions or unknowns, never canon",
    );
    expect(ideas).toContain("Extracting...");
  });
});
