import {describe, expect, it, vi} from "vitest";
import {GeneratePreviewBinding, loadNativeImagePreview} from "@/lib/client/generatePreviewBinding";
import type {NativeImageResult} from "@/lib/client/nativeImages";

const image = (jobId: string): NativeImageResult => ({jobId, promptId: `prompt-${jobId}`, model: "fibo2-edit-turbo",
  imageUrl: `/api/images/native?jobId=${jobId}&image=1`, serverPath: `/owned/${jobId}.png`, width: 1344, height: 768, seed: 1});

describe("Generate previews follow the submitted job, not global last content", () => {
  it("retains legacy progress and image/video refresh before a native submission", () => {
    const binding = new GeneratePreviewBinding();
    expect(binding.acceptsLegacy(binding.token)).toBe(true);
    expect(binding.blocksLegacy).toBe(false);
  });
  it("rejects an older in-flight global content response even before Fibo is accepted", () => {
    const binding = new GeneratePreviewBinding(), stale = binding.token;
    binding.begin("native");
    expect(binding.acceptsLegacy(stale, true)).toBe(false);
    expect(binding.acceptsLegacy(binding.token, true)).toBe(false);
  });
  it("blocks global progress and sampler previews after native completion", () => {
    const binding = new GeneratePreviewBinding(), token = binding.begin("native");
    binding.expectNative(token, "a");
    expect(binding.acceptsNative(token, image("a"))).toBe(true);
    expect(binding.blocksLegacy).toBe(true);
    expect(binding.acceptsLegacy(token)).toBe(false);
  });
  it("rejects a result from a different native job", () => {
    const binding = new GeneratePreviewBinding(), token = binding.begin("native");
    binding.expectNative(token, "a");
    expect(binding.acceptsNative(token, image("b"))).toBe(false);
  });
  it("rejects late completion and submission callbacks after a newer request", () => {
    const binding = new GeneratePreviewBinding(), first = binding.begin("native");
    binding.expectNative(first, "a");
    const second = binding.begin("native");
    expect(binding.expectNative(first, "a")).toBe(false);
    binding.expectNative(second, "b");
    expect(binding.acceptsNative(first, image("a"))).toBe(false);
    expect(binding.acceptsNative(second, image("b"))).toBe(true);
  });
  it("returns to normal Qwen/image/video polling only after an explicit legacy submission", () => {
    const binding = new GeneratePreviewBinding(), old = binding.begin("native");
    binding.expectNative(old, "a");
    const current = binding.begin("legacy");
    expect(binding.nativeJobId).toBe("");
    expect(binding.acceptsNative(old, image("a"))).toBe(false);
    expect(binding.acceptsLegacy(current)).toBe(true);
  });
  it("clear invalidates pending responses but retains exact native identity for manual Refresh", () => {
    const binding = new GeneratePreviewBinding(), old = binding.begin("native");
    binding.expectNative(old, "a"); binding.clear();
    expect(binding.acceptsNative(old, image("a"))).toBe(false);
    expect(binding.nativeJobId).toBe("a");
    expect(binding.acceptsNative(binding.token, image("a"))).toBe(true);
    expect(binding.acceptsLegacy(binding.token, true)).toBe(false);
  });
  it("reset and account changes can discard the old binding and reject all old responses", () => {
    const binding = new GeneratePreviewBinding(), old = binding.begin("native");
    binding.expectNative(old, "a"); binding.begin("legacy"); binding.clear();
    expect(binding.nativeJobId).toBe("");
    expect(binding.acceptsNative(old, image("a"))).toBe(false);
    expect(binding.acceptsLegacy(binding.token)).toBe(false);
    expect(binding.acceptsLegacy(binding.token, true)).toBe(true);
  });
  it("clearing a legacy preview does not stop monitoring its running image/video job", () => {
    const binding = new GeneratePreviewBinding(), old = binding.token;
    binding.clear();
    expect(binding.acceptsProgress(old)).toBe(false);
    expect(binding.acceptsProgress(binding.token)).toBe(true);
    expect(binding.acceptsLegacy(binding.token)).toBe(false);
  });
  it("explicit Refresh reads only the exact authenticated native job", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({...image("a"), status: "completed"}));
    await expect(loadNativeImagePreview("a", fetcher)).resolves.toEqual({...image("a"), status: "completed"});
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/images/native?jobId=a", {credentials: "include", cache: "no-store"});
  });
  it.each(["running", "failed", "canceled", "unknown"])("never substitutes global latest content if native status is %s", async status => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({...image("a"), status}));
    await expect(loadNativeImagePreview("a", fetcher)).rejects.toThrow(/not available/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects wrong-job, forbidden and missing-image responses without a fallback", async () => {
    for (const response of [Response.json({...image("b"), status: "completed"}), Response.json({error: "Forbidden"}, {status: 403}),
      Response.json({...image("a"), imageUrl: "", status: "completed"})]) {
      const fetcher = vi.fn().mockResolvedValue(response);
      await expect(loadNativeImagePreview("a", fetcher)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});
