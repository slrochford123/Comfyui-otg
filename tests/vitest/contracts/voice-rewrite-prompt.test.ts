import {describe,it,expect} from "vitest";
import {aukRewriteInstruction} from "@/lib/voiceRewritePrompt";
describe("AuK rewrite task conditioning",()=>{
  it("uses the official zero-shot speech template with the actual target words",()=>{
    expect(aukRewriteInstruction(" This is a test line. ")).toBe('Say the following with the same voice: "This is a test line."');
  });
  it("does not turn embedded quotes or newlines into extra instruction clauses",()=>{
    expect(aukRewriteInstruction('Say "hello".\nThen pause.')).toBe('Say the following with the same voice: "Say \\"hello\\".\\nThen pause."');
  });
  it("rejects an empty rewrite instead of regenerating the reference",()=>{
    expect(()=>aukRewriteInstruction(" ")).toThrow("requires replacement text");
  });
});
