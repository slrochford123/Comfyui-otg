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
  it("adds an authenticated extractor route backed by the shared OpenAI provider", () => {
    expect(route).toContain("export async function POST");
    expect(route).not.toContain("export async function GET");
    expect(route).toContain("requireSessionUser");
    expect(route).toContain("createOpenAIText");
    expect(route).toContain("openAIModels().story");
    expect(route).toContain('useCase: "story-helper"');
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
    expect(route).toContain("listUnreviewedStoryMessages");
    expect(route).toContain("recordStoryMemoryReview");
  });

  it("extracts proposals and lets server reconciliation save only nonconflicting canon", () => {
    expect(route).toContain(
      'fact.canonStatus === "unknown"',
    );
    expect(route).toContain('"suggestion"');
    expect(route).toContain('"unknown"');
    expect(route).not.toContain('canonStatus: "canon"');
    expect(route).toContain("autoCanonizeNonconflicting: true");
  });

  it("connects Ideas extraction to the existing selected project and exact source message", () => {
    expect(panel).toContain("/api/story-creator/extract");
    expect(panel).toContain("projectId: project.id");
    expect(panel).toContain("sourceMessageId");
    expect(panel).toContain("extractionSourceMessageId");
    expect(panel).toContain("loadStoryBible(project.id)");
    expect(panel).toContain("loadStoryConflicts(project.id)");
    expect(panel).toContain("setStoryMemoryOpen(true)");
    expect(panel).not.toContain("selectedExtractionProjectId");
    expect(panel).toContain("paidOperationAuthorization");
    expect(panel).toContain("story-memory-extraction");
    expect(panel).toContain("window.confirm");
  });

  it("defers background extraction instead of making a hidden paid request", () => {
    expect(panel).toContain("Story Memory extraction is deferred");
    expect(panel).not.toContain("extractionResults.push");
    expect(route).toContain("AI_PAYMENT_AUTHORIZATION_REQUIRED");
    expect(route).toContain("maxOutputTokens > 1000");
  });

  it("presents one simple bulk Story Details review", () => {
    expect(ideas).toContain("Review Story Details");
    expect(ideas).toContain("Try Again");
    expect(ideas).toContain("Save new nonconflicting details");
    expect(ideas).toContain("Extracting...");
  });
});
