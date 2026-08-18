import { describe, expect, it } from "vitest";

import { buildVoiceCreatorPrompt, listVoiceCreatorPresets } from "@/lib/voiceCreatorCatalog";

function expectUniquePresetIds(items: Array<{ id: string }>) {
  expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
}

describe("Audio Studios voice catalogs", () => {
  it("keeps the approved catalog counts", () => {
    expect(listVoiceCreatorPresets("ltx25", "natural")).toHaveLength(84);
    expect(listVoiceCreatorPresets("minimax_h3", "natural")).toHaveLength(37);
    expect(listVoiceCreatorPresets("ltx25", "fictional")).toHaveLength(100);
    expect(listVoiceCreatorPresets("minimax_h3", "fictional")).toHaveLength(100);
  });

  it("keeps preset ids unique inside every provider library", () => {
    expectUniquePresetIds(listVoiceCreatorPresets("ltx25", "natural"));
    expectUniquePresetIds(listVoiceCreatorPresets("minimax_h3", "natural"));
    expectUniquePresetIds(listVoiceCreatorPresets("ltx25", "fictional"));
    expectUniquePresetIds(listVoiceCreatorPresets("minimax_h3", "fictional"));
  });

  it("keeps the H3 natural prompt region-first without English/American instructions", () => {
    const preset = listVoiceCreatorPresets("minimax_h3", "natural")[0];
    const prompt = buildVoiceCreatorPrompt({
      provider: "minimax_h3",
      library: "natural",
      preset,
      sampleText: "Three red cars went down the crowded street toward the river.",
      age: "adult",
      presentation: "male",
    });
    expect(prompt).toContain("native regional speaker");
    expect(prompt).toContain("The speaker says exactly");
    expect(prompt.toLowerCase()).not.toContain("american");
    expect(prompt.toLowerCase()).not.toContain("speak english");
  });

  it("preserves fictional preset identity and clean single-speaker output rules", () => {
    const preset = listVoiceCreatorPresets("ltx25", "fictional")[0];
    const prompt = buildVoiceCreatorPrompt({
      provider: "ltx25",
      library: "fictional",
      preset,
      sampleText: "The gate is sealed.",
    });
    expect(prompt).toContain(preset.label);
    expect(prompt).toContain(preset.description);
    expect(prompt).toContain("Single speaker only");
    expect(prompt).toContain("The character says exactly");
    expect(prompt).toContain("no captions or subtitles");
  });
});
