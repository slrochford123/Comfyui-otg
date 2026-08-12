import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const qwenSource = fs.readFileSync(
  path.join(process.cwd(), "app", "app", "components", "QwenSceneBuilderPanel.tsx"),
  "utf8",
);
const storyboardSource = fs.readFileSync(
  path.join(process.cwd(), "app", "app", "components", "StoryboardPanel.tsx"),
  "utf8",
);

describe("Production Qwen Background Gallery click routing", () => {
  it("marks the Qwen builder and its background button explicitly", () => {
    expect(qwenSource).toContain('data-otg-qwen-scene-builder="true"');
    expect(qwenSource).toContain('data-otg-qwen-background-gallery="true"');
    expect(qwenSource).toContain('onClick={() => openAssetPicker("background")}');
  });

  it("prevents the legacy Storyboard click interceptor from hijacking Qwen controls", () => {
    const guard = "if (button.closest('[data-otg-qwen-scene-builder=\"true\"]')) return;";
    expect(storyboardSource.split(guard).length - 1).toBeGreaterThanOrEqual(2);
    expect(storyboardSource).toContain('document.addEventListener("click", handleClick, true)');
    expect(storyboardSource).toContain("openStoryboardBackgroundGalleryV36AK");
  });

  it("keeps Qwen background selection bound to the equipped-reference state", () => {
    expect(qwenSource).toContain('data-otg-background-picker-confirmation="true"');
    expect(qwenSource).toContain('data-otg-equipped-reference={ref.type}');
    expect(qwenSource).toContain('const equippedBackground = orderedSelectedReferences.find((ref) => ref.type === "background") || null;');
  });
});
