import {longDraft} from "../fixtures/h3LongDraft";
import { describe, expect, it } from "vitest";
import {
  h3DraftEnhancementInstructions,
  readH3DraftEnhancement,
} from "@/lib/h3DraftEnhancement";

describe("H3 draft enhancement", () => {
  it("returns the scene text itself and preserves exact dialogue", () => {
    const input = 'A guard says, "Hold the door."';
    const enhancedPrompt = 'A guard braces against the heavy door and says, "Hold the door."';
    expect(readH3DraftEnhancement(input, JSON.stringify({ enhancedPrompt }))).toBe(enhancedPrompt);
  });

  it("allows the action after a quotation to be rewritten", () => {
    const input = 'A boatmaker says, "There you go." It floats away.';
    const enhancedPrompt = "A boatmaker says, 'There you go.' The boat drifts away.";
    expect(readH3DraftEnhancement(input, JSON.stringify({ enhancedPrompt }))).toBe(enhancedPrompt);
  });

  it("rejects a synopsis, shot plan, or changed dialogue", () => {
    const input = 'A guard says, "Hold the door."';
    for (const enhancedPrompt of [
      'This prompt describes a guard who says, "Hold the door."',
      '[Shot 1] A guard says, "Hold the door."',
      'A guard says, "Close the door."',
    ]) {
      expect(() => readH3DraftEnhancement(input, JSON.stringify({ enhancedPrompt }))).toThrow();
    }
  });

  it("gives each length a distinct writing instruction", () => {
    const instructions = (["short", "medium", "long"] as const).map(h3DraftEnhancementInstructions);
    expect(new Set(instructions).size).toBe(3);
    expect(instructions.every(value => value.includes("Do not add lore"))).toBe(true);
  });
});

it('defines a substantial Long expansion while retaining the same short scene and existing facts',()=>{
 const prompt=h3DraftEnhancementInstructions('long');expect(prompt).toContain('200–300 word');expect(prompt).toContain('not a grammar correction');expect(prompt).toContain('Do not invent family relationships');expect(prompt).toContain('same short clip');
});
it('rejects the two-sentence result seen in the owner screenshot as Long, while retaining normal Short behavior',()=>{
 const source='three boys walk into the room and look at the woman with mischievous looks';const out=JSON.stringify({enhancedPrompt:'Three boys enter the room. They approach the woman with mischievous smiles.'});expect(()=>readH3DraftEnhancement(source,out,'long')).toThrow('did not expand');expect(readH3DraftEnhancement(source,out,'short')).toContain('Three boys');
});
it('accepts a developed Long paragraph without adding compiled H3 sections',()=>{expect(readH3DraftEnhancement('Three boys enter the room and approach the woman with mischievous smiles.',JSON.stringify({enhancedPrompt:longDraft}),'long')).toBe(longDraft);});
it('does not allow Long to compress an already detailed draft into fewer words',()=>{expect(()=>readH3DraftEnhancement(longDraft+' '+longDraft,JSON.stringify({enhancedPrompt:longDraft}),'long')).toThrow('did not expand');});
