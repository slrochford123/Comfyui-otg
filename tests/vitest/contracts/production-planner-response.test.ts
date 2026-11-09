import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("@/lib/openai/provider", () => ({ createOpenAITextStream: mocks.stream }));
import { createPlannerResponse, PLANNER_TIMEOUT_MS } from "@/lib/productionStudio/plannerResponse";

const request = { ownerKey: "alice", useCase: "story-helper" as const, model: "configured-story-model", instructions: "Mock only", input: "Story", maxOutputTokens: 12000, responseSchema: { name: "story", schema: {} } };
function delayed(ms: number, partial = false) {
  mocks.stream.mockImplementation(async ({ signal }: { signal: AbortSignal }) => (async function* () {
    if (partial) yield { type: "delta", delta: '{"story":' };
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new Error("Request was aborted.")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    yield { type: "done", text: '{"story":"complete"}' };
  })());
}
beforeEach(() => { vi.useFakeTimers(); mocks.stream.mockReset(); });
afterEach(() => { expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); });

describe("durable Production planner response boundary", () => {
  it("uses asset-specific progress and distinguishes timeout from validation without changing story planning",async()=>{
    delayed(PLANNER_TIMEOUT_MS+1000);const progress=vi.fn();
    const result=expect(createPlannerResponse(request,()=>false,progress,"assets")).rejects.toThrow("Asset analysis timed out after 10 minutes");
    await vi.advanceTimersByTimeAsync(PLANNER_TIMEOUT_MS);await result;
    expect(progress.mock.calls[0][0]).toContain("Analyzing approved story assets");expect(progress.mock.calls.every(([m])=>!m.includes("filmmaker's story"))).toBe(true);
  });
  it("allows a slow response past the old two-minute cutoff without retries or partial output", async () => {
    delayed(185000, true); const progress = vi.fn();
    const result = createPlannerResponse(request, () => false, progress);
    await vi.advanceTimersByTimeAsync(185000);
    await expect(result).resolves.toEqual({ text: '{"story":"complete"}' });
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.stream.mock.calls[0][0]).toMatchObject({ ...request, timeoutMs: 600000, maxRetries: 0 });
    expect(progress.mock.calls.some(([m]) => m.includes("3:00 elapsed"))).toBe(true);
    expect(progress.mock.calls.every(([m]) => !m.includes('{"story"'))).toBe(true);
    expect(progress.mock.calls.length).toBeLessThan(16);
  });
  it("aborts at the bounded ten-minute deadline with a useful error and no automatic replay", async () => {
    delayed(PLANNER_TIMEOUT_MS + 1000);
    const result = expect(createPlannerResponse(request, () => false)).rejects.toThrow("10-minute planning limit");
    await vi.advanceTimersByTimeAsync(PLANNER_TIMEOUT_MS); await result;
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.stream.mock.calls[0][0].signal.aborted).toBe(true);
  });
  it("cancels an in-flight response within one second and discards partial text", async () => {
    delayed(PLANNER_TIMEOUT_MS, true); let canceled = false;
    const result = expect(createPlannerResponse(request, () => canceled)).rejects.toThrow("Canceled");
    await vi.advanceTimersByTimeAsync(2000); canceled = true;
    await vi.advanceTimersByTimeAsync(1000); await result;
    expect(mocks.stream.mock.calls[0][0].signal.aborted).toBe(true);
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });
  it("does not start a request already canceled", async () => {
    await expect(createPlannerResponse(request, () => true)).rejects.toThrow("Canceled");
    expect(mocks.stream).not.toHaveBeenCalled();
  });
  it("rejects truncated streams rather than returning plausible partial JSON", async () => {
    mocks.stream.mockResolvedValue((async function* () { yield { type: "delta", delta: '{"story":"partial"}' }; })());
    await expect(createPlannerResponse(request, () => false)).rejects.toThrow("before a complete story arrived");
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });
  it("preserves spending/access errors and explains output-limit failures", async () => {
    mocks.stream.mockRejectedValueOnce(new Error("Daily spending limit reached"));
    await expect(createPlannerResponse(request, () => false)).rejects.toThrow("Daily spending limit reached");
    mocks.stream.mockRejectedValueOnce(new Error("max_output_tokens"));
    await expect(createPlannerResponse(request, () => false)).rejects.toThrow("more concise story");
  });
});
