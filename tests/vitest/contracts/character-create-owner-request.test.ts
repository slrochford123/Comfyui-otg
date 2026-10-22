import { describe, expect, it } from "vitest";
import { scopedCharacterCreateRequestId } from "@/lib/characters/characterCreateRequestStore";
describe("Character image request owner isolation", () => {
  it("keeps same-owner retries stable", () => expect(scopedCharacterCreateRequestId("qa_a", "request_12345678")).toBe(scopedCharacterCreateRequestId("qa_a", "request_12345678")));
  it("does not let another owner recover a guessed/reused client request ID", () => expect(scopedCharacterCreateRequestId("qa_a", "request_12345678")).not.toBe(scopedCharacterCreateRequestId("qa_b", "request_12345678")));
  it("rejects invalid identities", () => { expect(() => scopedCharacterCreateRequestId("", "request_12345678")).toThrow(); expect(() => scopedCharacterCreateRequestId("qa_a", "../bad")).toThrow(); });
});
