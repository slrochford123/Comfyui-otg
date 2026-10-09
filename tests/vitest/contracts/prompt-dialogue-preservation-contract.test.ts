import { describe, expect, it } from "vitest";

import {
  appendProtectedDialogueBlock,
  detectProtectedDialogue,
  ensureProtectedDialogueInOutput,
} from "@/lib/promptDialogue";
import { compileH3RealismPrompt } from "@/lib/h3SpecialModes/realism";
import { compileH3RefModsPrompt } from "@/lib/h3SpecialModes/refMods";

describe("global prompt dialogue preservation", () => {
  it.each([
    ["The boy says Mom where are you", "The boy", "says", "Mom where are you?"],
    ["The woman yelled get away from there", "The woman", "yells", "Get away from there."],
    ["John looked at Sarah and whispered I don't trust him", "John looked at Sarah", "whispers", "I don't trust him."],
    ["Sarah asks are you coming with us", "Sarah", "asks", "Are you coming with us?"],
    ["The man walks inside. He says once only, I told you not to come here.", "He", "says", "Once only, I told you not to come here."],
    ["The woman says don't touch that it's too hot, then pulls the child away.", "The woman", "says", "Don't touch that. It's too hot."],
  ])("extracts protected dialogue from %s", (input, speaker, delivery, line) => {
    const result = detectProtectedDialogue(input);
    expect(result.hasDialogue).toBe(true);
    expect(result.turns[0]).toMatchObject({ speaker, delivery, line });
    expect(result.protectedBlock).toContain(`Exact line: "${line}"`);
  });

  it("preserves multiple speaker ordering", () => {
    const result = detectProtectedDialogue("John says where is she. Mary replies I don't know.");
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0]).toMatchObject({
      speaker: "John",
      delivery: "says",
      line: "Where is she?",
      order: 1,
    });
    expect(result.turns[1]).toMatchObject({
      speaker: "Mary",
      delivery: "replies",
      line: "I don't know.",
      order: 2,
    });
  });

  it("does not invent dialogue for a scene with no speech verb", () => {
    const result = detectProtectedDialogue("A woman walks through a quiet kitchen at night.");
    expect(result.hasDialogue).toBe(false);
    expect(result.turns).toEqual([]);
    expect(result.protectedBlock).toBe("");
    expect(appendProtectedDialogueBlock(result.original)).toBe(result.original);
  });

  it("restores protected dialogue when an enhancer output drops it", () => {
    const output = ensureProtectedDialogueInOutput(
      "The boy says Mom where are you",
      "A boy walks down the street looking worried.",
    );
    expect(output).toContain('The boy says, "Mom where are you?"');
  });

  it("threads protected dialogue into H3 Realism compiled prompts", () => {
    const compiled = compileH3RealismPrompt({
      prompt: "The woman whispers don't touch that it's too hot",
      durationSeconds: 5,
      orientation: "landscape",
      references: [],
    });
    expect(compiled).toContain("PROTECTED_DIALOGUE");
    expect(compiled).toContain('Exact line: "Don\'t touch that. It\'s too hot."');
    expect(compiled).not.toContain("No protected dialogue was supplied");
  });

  it("threads protected dialogue into RefMods compiled prompts", () => {
    const compiled = compileH3RefModsPrompt({
      prompt: "John says where is she. Mary replies I don't know.",
      refMods: [
        {
          id: "slot-1",
          name: "isabella",
          category: "character",
          sourceKind: "image",
          strength: 0.9,
          components: "Auto",
          visualStrength: 1,
          audioStrength: 1,
          copies: 1,
          description: "",
        },
      ],
    });
    expect(compiled).toContain("PROTECTED_DIALOGUE");
    expect(compiled).toContain('Exact line: "Where is she?"');
    expect(compiled).toContain('Exact line: "I don\'t know."');
  });
});
