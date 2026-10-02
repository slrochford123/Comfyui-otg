import { describe, expect, it } from "vitest";

import {
  H3_STYLE_CATEGORIES,
  H3_STYLE_REGISTRY,
  resolveH3CanonicalStyle,
} from "@/lib/h3StyleRegistry";
import { H3_STYLE_PRESETS } from "@/lib/h3StylePresets";
import { H3_VISUAL_STYLE_OPTIONS, h3StyleProfile } from "@/lib/production/promptOptions";

describe("canonical H3 style registry", () => {
  it("contains default, all 28 Prompt Builder styles, and all 33 Style Art presets", () => {
    expect(H3_VISUAL_STYLE_OPTIONS).toHaveLength(28);
    expect(H3_STYLE_PRESETS).toHaveLength(34);
    expect(H3_STYLE_REGISTRY).toHaveLength(62);
    expect(new Set(H3_STYLE_REGISTRY.map((style) => style.id)).size).toBe(62);
  });

  it("preserves old labels as aliases with identical Prompt Builder instructions", () => {
    for (const oldName of H3_VISUAL_STYLE_OPTIONS) {
      const resolved = resolveH3CanonicalStyle(oldName, false);
      expect(resolved?.promptBuilderVisualStyle).toBe(oldName);
      expect(resolved?.h3PromptInstructions).toBe(h3StyleProfile(oldName));
    }
  });

  it("preserves every newer stable ID and its broad Prompt Builder mapping", () => {
    for (const preset of H3_STYLE_PRESETS.slice(1)) {
      const resolved = resolveH3CanonicalStyle(preset.id, false);
      expect(resolved?.id).toBe(preset.id);
      expect(resolved?.promptBuilderVisualStyle).toBe(preset.promptBuilderVisualStyle);
      expect(resolved?.h3PromptInstructions).toBe(preset.masterPrompt);
    }
  });

  it("derives searchable categories from registry metadata", () => {
    expect(H3_STYLE_CATEGORIES).toEqual(expect.arrayContaining([
      "Default",
      "Realistic & Live Action",
      "Animation",
      "Illustration & Graphic",
      "Gaming",
      "Genre & Cinematic",
      "Experimental",
    ]));
  });
});
