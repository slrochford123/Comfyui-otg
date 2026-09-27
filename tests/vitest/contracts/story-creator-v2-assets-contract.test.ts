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
const assetsRoute = read(
  "app/api/story-creator/assets/route.ts",
);
const assetStatusRoute = read(
  "app/api/story-creator/assets/status/route.ts",
);
const panel = read(
  "app/app/components/StoryCreatorPanel.tsx",
);
const assetGrid = read(
  "app/app/components/storyCreatorV2/StoryAssetGrid.tsx",
);
const voicePanel = read(
  "app/app/components/storyCreatorV2/VoiceDesignPanel.tsx",
);

describe("Story Creator V2 assets contract", () => {
  it("adds the durable Story Creator V2 design tables", () => {
    for (const tableName of [
      "story_assets",
      "story_character_profiles",
      "story_location_profiles",
      "story_voice_profiles",
      "story_generation_jobs",
      "story_open_questions",
      "story_timeline_events",
      "story_memory_chunks",
      "story_embeddings",
    ]) {
      expect(store).toContain(
        `CREATE TABLE IF NOT EXISTS ${tableName}`,
      );
    }
  });

  it("exposes an authenticated assets metadata route", () => {
    expect(assetsRoute).toContain("export async function GET");
    expect(assetsRoute).toContain("export async function POST");
    expect(assetsRoute).toContain("requireSessionUser");
    expect(assetsRoute).toContain("addStoryAsset");
    expect(assetsRoute).toContain("addStoryGenerationJob");
    expect(assetsRoute).not.toContain("ownerKey: body");
    expect(assetStatusRoute).toContain("requireSessionUser");
    expect(assetStatusRoute).toContain("resolveComfyPromptImageStatus");
    expect(assetStatusRoute).toContain("completeStoryGenerationJob");
    expect(assetStatusRoute).toContain("failStoryGenerationJob");
    expect(assetStatusRoute).not.toContain("ownerKey: body");
  });

  it("submits Story image work through the existing Qwen Image 2.1 asset path", () => {
    expect(panel).toContain("/api/assets/create-image");
    expect(panel).toContain('"qwen-image-2-1"');
    expect(panel).toContain("/api/story-creator/assets");
    expect(assetGrid).toContain("Submit Qwen Image 2.1 job");
    expect(assetGrid).toContain("Prompt {asset.jobId}");
    expect(assetGrid).toContain("Refresh Status");
    expect(assetGrid).toContain("Checking result");
    expect(assetGrid).toContain("asset.url");
  });

  it("saves Story voice profile metadata without claiming audio generation as canon", () => {
    expect(voicePanel).toContain("Save voice profile");
    expect(panel).toContain("/api/characters/voice-preview");
    expect(panel).toContain("/api/voice/auk-performance");
    expect(panel).toContain("story-voice-profile");
  });

  it("imports the requested Story Creator workflow bundle filenames", () => {
    for (const file of [
      "qwen21-story-character-t2i-api.json",
      "qwen21-story-location-t2i-api.json",
      "qwen21-story-asset-t2i-api.json",
      "qwen21-story-image-edit-api.json",
      "qwen21-story-character-card-api.json",
      "h3-story-preview-i2v-api.json",
      "h3-story-preview-r2v-api.json",
    ]) {
      expect(
        fs.existsSync(
          path.join(
            root,
            "comfy_workflows/internal/story-creator",
            file,
          ),
        ),
      ).toBe(true);
    }
  });
});
