import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const qwenPath = path.join(root, "app/app/components/QwenSceneBuilderPanel.tsx");
const source = fs.readFileSync(qwenPath, "utf8");

describe("Production Storyboard reference gallery routing", () => {
  it("loads saved characters from the current signed-in profile", () => {
    expect(source).toContain("OTG_QWEN_PROFILE_SAFE_CHARACTER_AND_PROP_GALLERIES_V3");
    expect(source).toContain('url: "/api/characters"');
    expect(source).toContain('credentials: "include"');
    expect(source).toContain('headers: { "x-otg-device-id": ownerKey }');
    expect(source).toContain("saved-character-library");
    expect(source).toContain("You are browsing as Guest");
  });

  it("loads object and prop references from the regular Gallery only", () => {
    expect(source).toContain('/api/gallery?media=image&sort=newest&per=5000');
    expect(source).toContain("regular-gallery");
    expect(source).toContain("Object / Prop Gallery - Regular Gallery");
    expect(source).toContain("It does not upload images from the phone");
  });

  it("uses typed asset arrays without nullable map results", () => {
    expect(source).toContain("const assets: SceneAsset[] = [];");
    expect(source).toContain("assets.push({");
    expect(source).not.toContain(".filter((item: SceneAsset | null): item is SceneAsset");
  });

  it("keeps the existing three-reference limit", () => {
    expect(source).toContain("const MAX_REFERENCES = 3;");
  });
});
