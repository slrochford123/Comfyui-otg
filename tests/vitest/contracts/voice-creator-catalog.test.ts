import { describe, expect, it } from "vitest";

import { buildVoiceCreatorPrompt, listVoiceCreatorPresets } from "@/lib/voiceCreatorCatalog";

describe("Audio Studios voice catalogs", () => {
  it("keeps the approved natural catalog counts", () => {
    expect(listVoiceCreatorPresets("ltx25", "natural")).toHaveLength(84);
    expect(listVoiceCreatorPresets("minimax_h3", "natural")).toHaveLength(37);
  });

  it("exposes all 100 fictional presets to both providers", () => {
    expect(listVoiceCreatorPresets("ltx25", "fictional")).toHaveLength(100);
    expect(listVoiceCreatorPresets("minimax_h3", "fictional")).toHaveLength(100);
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
});
