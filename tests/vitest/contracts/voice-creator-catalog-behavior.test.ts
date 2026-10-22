import { describe, expect, it } from "vitest";
import { buildVoiceCreatorPrompt, listVoiceCreatorPresets } from "@/lib/voiceCreatorCatalog";
describe("Current LTX 2.5 voice-library parameter equivalence", () => {
  it.each(["natural", "fictional"] as const)("binds every %s preset to selected casting and exact speech", library => {
    const presets = listVoiceCreatorPresets("ltx25", library);
    expect(presets.length).toBeGreaterThan(0);
    expect(new Set(presets.map(p => p.id)).size).toBe(presets.length);
    for (const preset of presets) {
      const prompt = buildVoiceCreatorPrompt({ provider: "ltx25", library, preset, age: "adult", presentation: "female", sampleText: "This is a test line.", characterDescription: "Private narrative must not become spoken dialogue." });
      expect(prompt).toContain('says exactly: "This is a test line."');
      expect(prompt.toLowerCase()).toContain("adult");
      expect(prompt.toLowerCase()).toContain("female");
      expect(prompt).not.toContain("Private narrative");
      expect(prompt).toContain(library === "fictional" ? "Fictional voice identity:" : preset.label);
    }
  });
});
