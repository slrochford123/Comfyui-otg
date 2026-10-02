import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  composeH3StylePrompt,
  DEFAULT_H3_STYLE_PRESET_ID,
  H3_STYLE_PRESETS,
  resolveH3PromptBuilderVisualStyle,
  resolveH3StylePreset,
} from "../../../lib/h3StylePresets";
import { H3_VISUAL_STYLE_OPTIONS } from "../../../lib/production/promptOptions";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("H3 visual style preset contracts", () => {
  it("ships the validated default plus 33 unique creative presets", () => {
    expect(H3_STYLE_PRESETS).toHaveLength(34);
    expect(H3_STYLE_PRESETS[0]?.id).toBe(DEFAULT_H3_STYLE_PRESET_ID);
    expect(new Set(H3_STYLE_PRESETS.map((preset) => preset.id)).size).toBe(34);
    expect(resolveH3StylePreset("none")).toBeNull();
  });

  it("maps every creative preset to an allowed Prompt Builder visual style", () => {
    for (const preset of H3_STYLE_PRESETS.slice(1)) {
      expect(H3_VISUAL_STYLE_OPTIONS).toContain(preset.promptBuilderVisualStyle);
      expect(resolveH3PromptBuilderVisualStyle(preset.id, "fallback")).toBe(
        preset.promptBuilderVisualStyle,
      );
    }
  });

  it("keeps default prompts unchanged and prepends a selected master style", () => {
    const prompt = 'Two children play rock paper scissors. The girl says "I win!"';
    expect(composeH3StylePrompt(prompt, null)).toBe(prompt);

    const preset = resolveH3StylePreset("1930s-animation");
    const composed = composeH3StylePrompt(prompt, preset);
    expect(composed).toContain(
      "VISUAL STYLE — APPLY CONSISTENTLY THROUGHOUT THE ENTIRE VIDEO:",
    );
    expect(composed).toContain("VIDEO CONTENT:\n" + prompt);
    expect(composed).not.toMatch(/\[(?:SUBJECT|SCENE|ACTION)/i);
    expect(composed.indexOf("VISUAL STYLE")).toBeLessThan(
      composed.indexOf("VIDEO CONTENT:"),
    );
  });

  it("connects preset selection to Prompt Builder and final generation", () => {
    const panel = read("app/app/components/H3Panel.tsx");
    const selector = read("app/app/components/H3StyleSelector.tsx");
    const promptRoute = read("app/api/h3/prompt/route.ts");
    const generationRoute = read("app/api/h3/generation/route.ts");

    expect(panel).toContain("<H3StyleSelector");
    expect(selector).toContain("H3_STYLE_REGISTRY.filter");
    expect(selector).toContain("aria-pressed={isSelected}");
    expect(selector).toContain("Choose Style Art");
    expect(panel).toContain("stylePresetId,");
    expect(promptRoute).toContain("resolveH3CanonicalStyle");
    expect(promptRoute).toContain("visualStyle: promptBuilderVisualStyle");
    expect(generationRoute).toContain("composeH3CanonicalStylePrompt");
    expect(generationRoute).toContain("prompt: finalPrompt");
  });
});
