import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");

function source(relative: string) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

describe("Story Creator Phase 7 audio production contracts", () => {
  it("keeps the audio API authenticated and authorization gated", () => {
    const route = source("app/api/story-creator/audio-production/route.ts");
    expect(route).toContain("requireSessionUser");
    expect(route).toContain("Explicit generation authorization is required");
    expect(route).toContain("Explicit batch authorization is required");
    expect(route).toContain("dispatchStoryAudioAssets");
    expect(route).not.toContain("OPENAI_API_KEY");
  });

  it("protects audio media by owner and data-root containment", () => {
    const route = source("app/api/story-creator/audio-production/media/route.ts");
    expect(route).toContain("requireSessionUser");
    expect(route).toContain("path.relative");
    expect(route).toContain("OTG_DATA_ROOT");
    expect(route).toContain("private, no-transform");
  });

  it("registers additive project-scoped audio tables and non-destructive lineage", () => {
    const store = source("lib/storyCreator/audioProduction.ts");
    expect(store).toContain("CREATE TABLE IF NOT EXISTS story_voice_assignments");
    expect(store).toContain("CREATE TABLE IF NOT EXISTS story_audio_assets");
    expect(store).toContain("CREATE TABLE IF NOT EXISTS story_audio_batches");
    expect(store).toContain("parent_asset_id");
    expect(store).toContain("keep_original_audio");
    expect(store).toContain("UNIQUE(owner_key, idempotency_key)");
    expect(store).toContain("external_job_id");
  });

  it("uses verified provider routes and labels LTX limitations honestly", () => {
    const store = source("lib/storyCreator/audioProduction.ts");
    expect(store).toContain("/api/voice/tts");
    expect(store).toContain("/api/production/background-audio/ace-generate");
    expect(store).toContain("/api/edit-video/woosh-sfx");
    expect(store).toContain("production-lipsync.json");
    expect(store).toContain("does not edit the accepted H3 video in place");
    const executor = source("lib/storyCreator/audioProductionExecutor.ts");
    expect(executor).toContain("claimStoryAudioAssetExecution");
    expect(executor).toContain("getStoryVisualVersion");
    expect(executor).toContain("getStoryVideoTake");
    expect(executor).toContain("getH3PromptHistoryFromBaseUrl");
    expect(executor).toContain("downloadH3VideoFromBaseUrl");
    expect(executor).toContain("recordStoryAudioDrivenVideoTake");
    expect(executor).not.toContain("OPENAI_API_KEY");
  });

  it("adds Audio inside Production Studio instead of a new primary stage tab", () => {
    const shell = source("app/app/components/storyCreatorV2/StoryStudioShell.tsx");
    const stages = source("app/app/components/storyCreatorV2/StoryCreatorStageTabs.tsx");
    const panel = source("app/app/components/StoryCreatorPanel.tsx");
    expect(shell).toContain('{ id: "audio", label: "Audio" }');
    expect(shell).toContain('activeTool === "audio"');
    expect(panel).toContain("StoryAudioProductionStudio");
    expect(stages).not.toContain('{ id: "audio", label: "Audio" }');
  });

  it("keeps preparation visibly separate from provider execution", () => {
    const ui = source("app/app/components/storyCreatorV2/StoryAudioProductionStudio.tsx");
    expect(ui).toContain("Preparation does not start a provider, GPU, or paid request.");
    expect(ui).toContain("I am authorized to use this voice reference");
    expect(ui).toContain("Timing conflict");
    expect(ui).toContain("Generate");
    expect(ui).toContain("Approve &amp; Generate Batch");
    expect(ui).toContain("Approved character image");
  });

  it("uses the installed IndexTTS2 bridge without shell interpolation", () => {
    const route = source("app/api/voice/tts/route.ts");
    const bridge = source("scripts/index_tts2_clone_pack_bridge.py");
    expect(route).toContain("INDEXTTS2_PYTHON");
    expect(route).toContain("INDEXTTS2_ROOT");
    expect(route).toContain("requireSessionUser(req)");
    expect(route).toContain("runExecutable(python");
    expect(route).toContain("shell: false");
    expect(bridge).toContain("--check-runtime");
    expect(bridge).toContain('"gpuUsed": False');
  });
});
