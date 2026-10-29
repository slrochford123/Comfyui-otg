import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ owner: vi.fn(), progress: vi.fn() }));
vi.mock("@/lib/ownerKey", () => ({ getOwnerContext: m.owner, SessionInvalidError: class extends Error {} }));
vi.mock("@/app/api/progress/route", () => ({ GET: m.progress }));
import { GET } from "@/app/api/comfy-events/route";
import { SessionInvalidError } from "@/lib/ownerKey";
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); m.owner.mockResolvedValue({ ownerKey: "owner" }); m.progress.mockImplementation(async () => Response.json({ status: "running", prompt_id: "mine", progressPercent: 50, prompt_complete: false })); });
afterEach(() => vi.useRealTimers());
describe("owned event stream", () => {
  it("requires authentication before accessing worker progress", async () => {
    m.owner.mockRejectedValue(new SessionInvalidError()); expect((await GET(new NextRequest("http://app/api/comfy-events"))).status).toBe(401);
    expect(m.progress).not.toHaveBeenCalled();
  });
  it("rejects arbitrary raw worker client subscriptions", async () => {
    expect((await GET(new NextRequest("http://app/api/comfy-events?clientId=other"))).status).toBe(400);
    expect(m.progress).not.toHaveBeenCalled();
  });
  it("returns owner denial before opening a stream", async () => {
    m.progress.mockResolvedValue(Response.json({ error: "Not found" }, { status: 404 }));
    expect((await GET(new NextRequest("http://app/api/comfy-events?promptId=foreign"))).status).toBe(404);
  });
  it("does not notify completion before delivery; canceling the stream releases its timer", async () => {
    const response = await GET(new NextRequest("http://app/api/comfy-events")); const reader = response.body!.getReader();
    const text = new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain('"type":"progress"'); expect(text).not.toContain("execution_complete");
    await reader.cancel(); const count = m.progress.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000); expect(m.progress).toHaveBeenCalledTimes(count);
  });
  it("emits the Android notification event once per delivered prompt", async () => {
    m.progress.mockImplementation(async () => Response.json({ status: "complete", prompt_id: "mine", prompt_complete: true }));
    const abort = new AbortController(); const response = await GET(new NextRequest("http://app/api/comfy-events", { signal: abort.signal }));
    const reader = response.body!.getReader(); const decode = new TextDecoder();
    await reader.read(); expect(decode.decode((await reader.read()).value)).toContain("execution_complete");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(decode.decode((await reader.read()).value)).not.toContain("execution_complete");
    abort.abort(); const count = m.progress.mock.calls.length; await vi.advanceTimersByTimeAsync(10_000);
    expect(m.progress).toHaveBeenCalledTimes(count);
  });
});
