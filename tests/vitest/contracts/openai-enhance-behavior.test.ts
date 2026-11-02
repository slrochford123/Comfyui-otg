import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), enabled: vi.fn(), text: vi.fn(), local: vi.fn() }));
vi.mock("@/lib/sessionUser", () => ({ requireSessionUser: mocks.user }));
vi.mock("@/lib/openai/provider", () => ({ openAIEnabled: mocks.enabled,
  openAIModels: () => ({ h3: "configured-h3-model" }), createOpenAIText: mocks.text }));
vi.mock("@/lib/workers/qwenDurableFetch", () => ({ qwenDurableFetch: mocks.local }));

const request = () => new NextRequest("http://localhost/api/enhance-prompt", { method: "POST",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: 'Mara says "Meet me at dawn."', mediaMode: "video", durationSeconds: 10 }) });

beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ ownerKey: "fixture-owner" }); mocks.enabled.mockReturnValue(true); });
describe("authenticated OpenAI prompt enhancement", () => {
  it("uses shared provider controls with exact configured model and dialogue preservation, not Qwen", async () => {
    mocks.text.mockResolvedValue({ text: JSON.stringify({ enhancedPrompt: "Mara waits at a sunlit cafe." }) });
    const { POST } = await import("@/app/api/enhance-prompt/route");
    const response = await POST(request()); const body = await response.json();
    expect(response.status).toBe(200); expect(body.provider).toBe("openai");
    expect(body.model).toBe("configured-h3-model"); expect(body.enhancedPrompt).toContain("Meet me at dawn.");
    expect(mocks.text).toHaveBeenCalledWith(expect.objectContaining({ ownerKey: "fixture-owner", useCase: "prompt-enhance", model: "configured-h3-model", maxRetries: 0, store: false }));
    expect(mocks.local).not.toHaveBeenCalled();
  });
  it("preserves the original on OpenAI failure rather than silently using another model", async () => {
    mocks.text.mockRejectedValue(new Error("upstream failure"));
    const { POST } = await import("@/app/api/enhance-prompt/route");
    const body = await (await POST(request())).json();
    expect(body.fallbackUsed).toBe(true); expect(body.enhancedPrompt).toBe(body.originalPrompt);
    expect(mocks.local).not.toHaveBeenCalled();
  });
  it("retains the explicit local path when OpenAI is disabled", async () => {
    mocks.enabled.mockReturnValue(false);
    mocks.local.mockResolvedValue(Response.json({ response: JSON.stringify({ enhancedPrompt: "Mara waits at dawn." }) }));
    const { POST } = await import("@/app/api/enhance-prompt/route");
    expect((await (await POST(request())).json()).provider).toBe("qwenCluster");
    expect(mocks.text).not.toHaveBeenCalled();
  });
  it("does not turn authentication failure into a successful unchanged prompt", async () => {
    const { SessionInvalidError } = await import("@/lib/ownerKey");
    mocks.user.mockRejectedValue(new SessionInvalidError("missing"));
    const { POST } = await import("@/app/api/enhance-prompt/route");
    expect((await POST(request())).status).toBe(401);
    expect(mocks.text).not.toHaveBeenCalled(); expect(mocks.local).not.toHaveBeenCalled();
  });
});
