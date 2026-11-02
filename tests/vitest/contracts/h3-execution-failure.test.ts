import { describe, expect, it } from "vitest";
import { h3ExecutionFailure } from "@/lib/h3ExecutionFailure";
describe("H3 safe public rendering errors",()=>{
  const entry=(exception_message:string)=>({status:{messages:[["execution_error",{exception_message,traceback:"/private/owner/prompt"}]]}});
  it.each(["CUDA illegal memory access", "Triton Error [CUDA]", "device-side assert"])("explains %s without exposing a traceback",message=>{
    const error=h3ExecutionFailure(entry(message));expect(error.name).toBe("H3ExecutionError");expect(error.message).toMatch(/attention kernel failed/);expect(error.message).not.toContain("/private");
  });
  it("distinguishes memory exhaustion",()=>expect(h3ExecutionFailure(entry("CUDA out of memory")).message).toMatch(/ran out of available memory/));
  it("preserves only the trusted worker-restart error",()=>{
    expect(h3ExecutionFailure(null,"The original ComfyUI worker stopped during rendering.").message).toMatch(/worker stopped/);
    expect(h3ExecutionFailure(entry("/private/secret"),"/private/secret").message).not.toContain("/private");
  });
});
