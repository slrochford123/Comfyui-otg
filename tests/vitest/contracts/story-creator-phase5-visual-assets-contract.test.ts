import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("Story Creator Phase 5 visual asset contracts", () => {
  it("keeps every visual API authenticated and project scoped", () => {
    for (const route of [
      "app/api/story-creator/visual-assets/route.ts",
      "app/api/story-creator/visual-assets/upload/route.ts",
      "app/api/story-creator/visual-assets/media/route.ts",
      "app/api/story-creator/visual-actions/route.ts",
    ]) {
      const source = read(route);
      expect(source).toContain("requireSessionUser");
      expect(source).toContain("projectId");
      expect(source).not.toContain("OPENAI_API_KEY");
    }
  });

  it("prepares contracts without submitting GPU work server side", () => {
    const route = read("app/api/story-creator/visual-assets/route.ts");
    const store = read("lib/storyCreator/store.ts");
    expect(route).toContain('action === "prepare-generation"');
    expect(store).toContain("requiresExplicitConfirmation: true");
    expect(store).toContain('endpoint: "/api/assets/create-image"');
    expect(route).not.toContain('fetch("/api/assets/create-image"');
    expect(route).not.toContain('fetch("/api/comfy"');
  });

  it("uses the verified Qwen generation and edit workflows after explicit UI confirmation", () => {
    const component = read("app/app/components/storyCreatorV2/VisualAssetStudio.tsx");
    const store = read("lib/storyCreator/store.ts");
    expect(component).toContain("Confirmation required");
    expect(component).toContain("Create Image");
    expect(store).toContain('model: "qwen-image-2-1"');
    expect(component).toContain('"presets/image_qwen_image_2_1_image_edit"');
    expect(component).toContain('form.set("imageA"');
    expect(component).toContain('action: "record-submission"');
  });

  it("handles Story Director visual requests directly and retains the shared Visual Asset Studio", () => {
    const panel = read("app/app/components/StoryCreatorPanel.tsx");
    const ideas = read("app/app/components/storyCreatorV2/IdeasTab.tsx");
    const design = read("app/app/components/storyCreatorV2/DesignTab.tsx");
    const visual = read("app/app/components/storyCreatorV2/VisualAssetStudio.tsx");
    expect(panel).toContain("isStoryVisualActionInstruction");
    expect(panel).toContain("directorVisualAction={storyDirectorVisualAction}");
    expect(ideas).toContain("StoryDirectorVisualCard");
    expect(design).toContain("directorAction={directorVisualAction}");
    expect(visual).toContain("Story Director handed off this Qwen action");
  });

  it("provides a visible mobile-safe return from Canon and Continuity", () => {
    const shell = read("app/app/components/storyCreatorV2/StoryStudioShell.tsx");
    expect(shell).toContain("Back to Story Director");
    expect(shell).toContain("onMemoryOpenChange(false)");
  });

  it("retains non-destructive history and exact production bindings", () => {
    const store = read("lib/storyCreator/store.ts");
    expect(store).toContain("story_visual_asset_versions");
    expect(store).toContain("parent_version_id");
    expect(store).toContain("story_visual_asset_bindings");
    expect(store).toContain("plan_version");
    expect(store).toContain("scene_id");
    expect(store).toContain("shot_id");
    expect(store).toContain("restoredFromVersionId");
  });

  it("makes approved references available to Story Director context", () => {
    const context = read("lib/storyCreator/context.ts");
    expect(context).toContain("APPROVED VISUAL REFERENCES");
    expect(context).toContain('version.status === "approved"');
    expect(read("app/api/story-creator/visual-actions/route.ts")).toContain("resolveStoryVisualDirectorAction");
  });
});
