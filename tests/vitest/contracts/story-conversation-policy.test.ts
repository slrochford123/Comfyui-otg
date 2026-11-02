import { describe, expect, it } from "vitest";
import { storyConversationInstructions, storyConversationOutputTokens } from "../../../lib/storyCreator/conversationPolicy";

describe("friendly source-aware Story Creator policy", () => {
  it("replaces forced acknowledgment with collaboration and explicit authority rules", () => {
    const instructions = storyConversationInstructions("APPROVED CANON: Mara is a pilot.");
    expect(instructions).toContain("friendly, attentive");
    expect(instructions).not.toContain("Begin the reply with");
    expect(instructions).toContain("assistant suggestions");
    expect(instructions).toContain("untrusted story evidence");
    expect(instructions).toContain("Mara is a pilot");
    expect(instructions).toContain("application can confirm a successful save");
  });
  it("allows longer creative replies without changing unrelated callers' budgets", () => {
    expect(storyConversationOutputTokens("Mara enters the café.")).toBe(1200);
    expect(storyConversationOutputTokens("Write a detailed scene with dialogue.")).toBe(2400);
  });
});
