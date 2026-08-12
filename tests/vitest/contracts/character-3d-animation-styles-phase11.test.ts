import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THREE_D_ANIMATION_STYLE_PRESETS } from "../../../lib/characters/threeDAnimationStyles";

const root = process.cwd();
const ui = fs.readFileSync(
  path.join(root, "app/app/components/CharacterHubPanel.tsx"),
  "utf8",
);
const route = fs.readFileSync(
  path.join(root, "app/api/characters/create-image/route.ts"),
  "utf8",
);
const requestStore = fs.readFileSync(
  path.join(root, "lib/characters/characterCreateRequestStore.ts"),
  "utf8",
);

describe("Character 3D Animation Art Styles Phase 11", () => {
  it("provides Default plus exactly 25 alternate 3D animation presets", () => {
    expect(THREE_D_ANIMATION_STYLE_PRESETS).toHaveLength(26);
    expect(THREE_D_ANIMATION_STYLE_PRESETS[0].id).toBe("default");
    expect(THREE_D_ANIMATION_STYLE_PRESETS[0].prompt).toBe("");

    const ids = THREE_D_ANIMATION_STYLE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps recognizable studio families in the user-facing labels while prompts stay descriptive", () => {
    const labels = THREE_D_ANIMATION_STYLE_PRESETS.map((preset) => preset.label).join("\n");
    expect(labels).toContain("Pixar - Classic Toy Feature");
    expect(labels).toContain("Disney - Fairytale Princess 3D");
    expect(labels).toContain("DreamWorks - Fairytale Comedy 3D");
    expect(labels).toContain("Illumination - Rounded Comedy 3D");
    expect(labels).toContain("Sony - Comic-Book Hybrid 3D");
    expect(labels).toContain("Fortiche - Painted Cinematic 3D");
    expect(labels).toContain("LAIKA - Handcrafted Gothic Stop-Motion");
    expect(labels).toContain("Aardman - Clay Animation 3D");

    for (const preset of THREE_D_ANIMATION_STYLE_PRESETS.slice(1)) {
      expect(preset.prompt.trim().length).toBeGreaterThan(80);
    }
  });

  it("renames the top-level Pixar preset display to generic 3D Animation and shows the secondary selector only for it", () => {
    expect(ui).toContain('id: "pixar-3d"');
    expect(ui).toContain('label: "3D Animation"');
    expect(ui).toContain("3D Animation Art Styles");
    expect(ui).toContain('data-otg="character-3d-animation-style-select"');
    expect(ui).toContain('stylePresetId === "pixar-3d"');
    expect(ui).toContain("THREE_D_ANIMATION_STYLE_PRESETS.map");
  });

  it("submits and persists the selected 3D sub-style independently from the Character Description", () => {
    expect(ui).toContain("threeDAnimationStyle:");
    expect(ui).toContain('stylePresetId === "pixar-3d" ? threeDAnimationStyleId : "default"');
    expect(ui).toContain("threeDAnimationStyle: string;");
    expect(requestStore).toContain("threeDAnimationStyle: string;");
    expect(route).toContain("threeDAnimationStylePrompt");
    expect(route).toContain('args.style === "pixar-3d"');
    expect(route).toContain("threeDAnimationPrompt");
  });

  it("validates server-side and makes Default/non-3D selections a no-op", () => {
    expect(route).toContain("isThreeDAnimationStyleId");
    expect(route).toContain('body.threeDAnimationStyle || "default"');
    expect(route).toContain('body.style === "pixar-3d" ? threeDAnimationStyleValue : "default"');
    expect(route).toContain("threeDAnimationStyle,");
    expect(route).toContain("threeDAnimationStyle: persistentThreeDAnimationStyle");
  });

  it("uses the detailed sub-style label for persisted/recovered Character candidates", () => {
    expect(ui).toContain("selectedDetailedStyleLabel");
    expect(ui).toContain('televisionAnimeStyleId !== "default"');
    expect(ui).toContain('threeDAnimationStyleId !== "default"');
    expect(ui).toContain("styleLabel: selectedDetailedStyleLabel");
  });
});
