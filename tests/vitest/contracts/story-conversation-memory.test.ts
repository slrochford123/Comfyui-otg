import { describe, expect, it } from "vitest";
import { parseStoryConversation, partialStoryReply } from "../../../lib/storyCreator/conversationMemory";

const fact = { subjectName: "Mara", entityType: "character", predicate: "profession", valueText: "a pilot", evidence: "Mara is a pilot." };
const reply = (facts: unknown[]) => JSON.stringify({ reply: "That gives us an interesting starting point.", facts });

describe("single-pass conversational memory", () => {
  it("accepts verbatim clear user assertions, not model-invented specificity", () => {
    expect(parseStoryConversation(reply([fact]), "Mara is a pilot.").memory.facts).toHaveLength(1);
    expect(parseStoryConversation(reply([{ ...fact, valueText: "a military pilot" }]), "Mara is a pilot.").memory.facts).toHaveLength(0);
    expect(parseStoryConversation(reply([fact]), "Elin is a pilot.").memory.facts).toHaveLength(0);
  });
  it.each(["What if Mara is a pilot.", "Maybe Mara is a pilot.", 'She asks, "Mara is a pilot."', "Mara is not a pilot."])("does not silently adopt speculation, quotes or negation: %s", source => {
    expect(parseStoryConversation(reply([fact]), source).memory.facts).toHaveLength(0);
  });
  it("withholds invalid JSON and decodes partial replies without showing metadata", () => {
    expect(partialStoryReply('{"reply":"Hello\\nMara')).toBe("Hello\nMara");
    expect(partialStoryReply('{"reply":"Hello\\u2')).toBe("Hello");
    expect(partialStoryReply('{"reply":"Hello","facts":[')).toBe("Hello");
    expect(partialStoryReply('{"facts":[')).toBe("");
    expect(() => parseStoryConversation("Partial", "Mara is a pilot.")).toThrow();
  });
});
