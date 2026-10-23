import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ critical: vi.fn(), voice: vi.fn(), release: vi.fn(), peer: vi.fn() }));
vi.mock("@/lib/workers/comfySubmissionCriticalSection", () => ({ runWithComfySubmissionCriticalSection: m.critical }));
vi.mock("@/lib/workers/voiceGpuFileLease", () => ({ acquireVoiceGpuFileLease: m.voice }));
vi.mock("@/lib/workers/comfy3090Peer", () => ({ releaseIdle3090Peer: m.peer }));
import { submitComfyPromptWithGpuLease } from "@/lib/workers/comfyPromptLease";
beforeEach(() => {
  vi.clearAllMocks();
  m.critical.mockImplementation(async (_args, callback) => ({ ok: true, value: await callback() }));
  m.voice.mockResolvedValue(m.release);
});
afterEach(() => vi.unstubAllGlobals());
describe("server-owned Studio final admission within shared submission safety", () => {
  it("checks the exact admission after entering the physical mutex and before /prompt", async () => {
    const order: string[] = [];
    m.critical.mockImplementation(async (_args, callback) => { order.push("mutex"); return { ok: true, value: await callback() }; });
    const beforeSubmit = vi.fn(async () => { order.push("check-exact-grant"); });
    const fetcher = vi.fn(async () => { order.push("prompt"); return Response.json({ prompt_id: "qa-only" }); });
    await submitComfyPromptWithGpuLease({ baseUrl: "http://100.75.162.64:8189", workerId: "h3-studio", ownerId: "qa", init: { method: "POST" }, fetcher, releaseIdlePeer: false, beforeSubmit });
    expect(order).toEqual(["mutex", "check-exact-grant", "prompt"]);
    expect(m.peer).not.toHaveBeenCalled(); expect(m.release).toHaveBeenCalledTimes(1);
  });
  it("fails closed if a job became cancelled or the worker became busy while waiting", async () => {
    const fetcher = vi.fn();
    await expect(submitComfyPromptWithGpuLease({ baseUrl: "http://100.75.162.64:8189", workerId: "h3-studio", ownerId: "qa", init: { method: "POST" }, fetcher, releaseIdlePeer: false, beforeSubmit: async () => { throw Error("Busy or cancelled"); } })).rejects.toThrow(/Busy/);
    expect(fetcher).not.toHaveBeenCalled(); expect(m.peer).not.toHaveBeenCalled(); expect(m.release).toHaveBeenCalledTimes(1);
  });
  it("does not invoke qualification admission while an unrelated voice operation holds the GPU", async () => {
    m.voice.mockRejectedValue(new Error("Voice busy")); const beforeSubmit = vi.fn(), fetcher = vi.fn();
    const r = await submitComfyPromptWithGpuLease({ baseUrl: "http://100.75.162.64:8189", workerId: "h3-studio", ownerId: "qa", init: { method: "POST" }, fetcher, releaseIdlePeer: false, beforeSubmit });
    expect(r.status).toBe(409); expect(beforeSubmit).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("persists acceptance inside the mutex before releasing the response", async () => {
    const events: string[] = [];
    m.critical.mockImplementation(async (_args, callback) => { events.push("lock"); const value = await callback(); events.push("release"); return { ok: true, value }; });
    const fetcher = vi.fn(async () => Response.json({ prompt_id: "qa-prompt" }));
    await submitComfyPromptWithGpuLease({ baseUrl: "http://100.75.162.64:8189", workerId: "h3-studio", ownerId: "qa", init: { method: "POST" }, fetcher, releaseIdlePeer: false, onPromptAccepted: async id => { expect(id).toBe("qa-prompt"); events.push("recorded"); } });
    expect(events).toEqual(["lock", "recorded", "release"]);
  });
});
