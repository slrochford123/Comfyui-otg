import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(process.cwd(), "app", "app", "components", "QwenSceneBuilderPanel.tsx"),
  "utf8",
);

describe("Production Storyboard definite background selection", () => {
  it("equips a background from the card, preview image, or explicit button", () => {
    expect(source).toContain("OTG_QWEN_BACKGROUND_SELECTION_V2_START");
    expect(source).toContain('data-otg-background-picker-card={asset.type === "background" ? "true" : undefined}');
    expect(source).toContain('if (asset.type === "background") addReference(asset);');
    expect(source).toContain("Equip Background to Prompt");
  });

  it("shows a persistent, unmistakable selected state before closing the picker", () => {
    expect(source).toContain('data-otg-background-picker-confirmation="true"');
    expect(source).toContain('data-otg-background-selected-badge="true"');
    expect(source).toContain("✓ Selected for Prompt");
    expect(source).toContain("Done - Keep Selected Background");
    expect(source).toContain('aria-live="polite"');
  });

  it("keeps background replacement available and reserves a reference slot", () => {
    expect(source).toContain('disabled={!selectedPass || selectedPass.status === "submitting"}');
    expect(source).toContain('if (!ref.locked && ref.type === "object")');
    expect(source).toContain("unlockedCharacterIndexes.length > 1");
    expect(source).toContain("nextReferences.splice(removableIndex, 1)");
  });

  it("blocks scene submission until both character and background are equipped", () => {
    expect(source).toContain('const sceneReferencesReady = Boolean(equippedCharacter && equippedBackground);');
    expect(source).toContain('data-otg-scene-reference-gate="true"');
    expect(source).toContain("Equip one character and one background before submitting this scene prompt.");
    expect(source).toContain('disabled={selectedPass.status === "submitting" || !sceneReferencesReady}');
  });
});
