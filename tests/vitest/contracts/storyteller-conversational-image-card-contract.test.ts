import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Story Director conversational image card contract", () => {
  const card = read("app/app/components/storyCreatorV2/StoryDirectorVisualCard.tsx");
  const ideas = read("app/app/components/storyCreatorV2/IdeasTab.tsx");
  const panel = read("app/app/components/StoryCreatorPanel.tsx");
  const createRoute = read("app/api/assets/create-image/route.ts");
  const store = read("lib/storyCreator/store.ts");

  it("prepares and submits exactly one explicit Qwen job from conversation", () => {
    expect(ideas).toContain("StoryDirectorVisualCard");
    expect(card).toContain('action: action.action === "prepare-edit" ? "prepare-edit" : "prepare-generation"');
    expect(card).toContain("prepared.generation.endpoint");
    expect(card).toContain('action: "record-submission"');
    expect(card).toContain('workflowId", "presets/image_qwen_image_2_1_image_edit"');
    expect(card).toContain("Create Image");
    expect(card).not.toContain("OPENAI_API_KEY");
    expect(store).toContain("persistOutput: true");
    expect(createRoute).toContain("persistentOutput:");
    expect(createRoute).toContain("outputFilenamePrefix:");
    expect(createRoute).toContain('`otg_story/${persistentOutputPrefix');
  });

  it("keeps approval, revision, lineage, and protected media inside Story Director", () => {
    expect(card).toContain('action: "approve-version"');
    expect(card).toContain('action: "bind-version"');
    expect(card).toContain("visual-assets/media?projectId=");
    expect(card).toContain("Approved as the current visual reference");
    expect(card).toContain("Change");
    expect(card).toContain('/api/story-creator/assets/status');
    expect(card).toContain('jobId: current.jobId');
    expect(card).toContain('setInterval(() => void refresh(), 4000)');
    expect(card).toContain("action.displayVersionId");
    expect(card).not.toContain("loadLatestAssetVersion");
    expect(ideas).toContain("visualAction.displayVersionId");
    expect(ideas).toContain("visualAction.sourceVersionId");
    expect(panel).toContain('item.metadata?.source === "story-director-conversation"');
    expect(panel).toContain("visualRestoreProjectRef");
    expect(panel).toContain("displayVersionId: version.id");
  });

  it("does not mistake a referenced source image for a completed new edit", () => {
    expect(card).toContain('if (!version && action.displayVersionId)');
    expect(card).not.toContain('if (!version && action.assetId)');
    expect(card).toContain('action.action === "prepare-edit" ? "Change Image" : "Create Image"');
  });
});
