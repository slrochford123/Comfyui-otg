import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ owner: vi.fn(), state: vi.fn(), progress: vi.fn(), meta: vi.fn(),
  sync: vi.fn(), markError: vi.fn(), monitor: vi.fn(), record: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/ownerKey", () => ({ getOwnerContext: m.owner, SessionInvalidError: class extends Error {} }));
vi.mock("@/lib/contentState", () => ({ readState: m.state, markError: m.markError, resetState: vi.fn() }));
vi.mock("@/lib/comfyProgress", () => ({ readComfyPromptProgress: m.progress, ensureComfyClientProgressMonitor: m.monitor, recordComfyPromptSubmitted: m.record }));
vi.mock("@/lib/promptRequestMeta", () => ({ readPromptRequestMeta: m.meta }));
vi.mock("@/lib/comfyGallerySync", () => ({ syncPromptOutputsForOwner: m.sync }));
vi.mock("@/app/api/_lib/comfyTarget", () => ({ resolveComfyBaseUrl: async () => ({ baseUrl: "http://default" }) }));
import { GET } from "@/app/api/progress/route";
beforeEach(() => {
  vi.clearAllMocks(); m.owner.mockResolvedValue({ ownerKey: "owner", username: "owner", deviceId: "device", scope: "user" });
  m.state.mockReturnValue({ promptId: "mine", status: "running", comfyBaseUrl: "http://worker", startedAt: Date.now() });
  m.progress.mockReturnValue(null); m.meta.mockReturnValue(null); m.sync.mockResolvedValue({ status: "pending" });
  m.fetch.mockResolvedValue(Response.json({ queue_running: [[0, "mine"]], queue_pending: [] })); vi.stubGlobal("fetch", m.fetch);
});
const request = (id = "mine") => GET(new NextRequest(`http://app/api/progress?promptId=${id}`));
describe("owner-scoped recovery", () => {
  it("does not reveal or import another owner's prompt", async () => {
    expect((await request("foreign")).status).toBe(404); expect(m.fetch).not.toHaveBeenCalled(); expect(m.sync).not.toHaveBeenCalled();
  });
  it("ignores a forged requested ID even if a foreign live snapshot exists", async () => {
    m.progress.mockReturnValue({ ownerKey: "someone-else", approximatePreview: "secret" });
    expect((await request("foreign")).status).toBe(404);
  });
  it("does not announce completion until the result is delivered", async () => {
    m.progress.mockReturnValue({ ownerKey: "owner", status: "complete", percent: 100 });
    expect(await (await request()).json()).toMatchObject({ status: "running", prompt_complete: false, progressPercent: 99 });
  });
  it("reports retryable reconnection instead of idle on backend failure", async () => {
    m.fetch.mockRejectedValue(new Error("connection lost"));
    expect(await (await request()).json()).toMatchObject({ status: "reconnecting", running: true, retryable: true, prompt_complete: false });
    expect(m.markError).not.toHaveBeenCalled();
  });
  it("does not interpret a malformed queue as an empty worker", async () => {
    m.fetch.mockResolvedValue(Response.json({}));
    expect(await (await request()).json()).toMatchObject({ status: "reconnecting", retryable: true });
  });
  it("restores the saved worker and client after a server restart", async () => {
    m.meta.mockReturnValue({ ownerKey: "owner", promptId: "older", comfyBaseUrl: "http://original", comfyClientId: "saved-client" });
    await request("older");
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ promptId: "older", comfyBaseUrl: "http://original", clientId: "saved-client" }));
    expect(m.fetch.mock.calls[0][0]).toBe("http://original/queue");
    expect(m.sync).toHaveBeenCalledWith(expect.objectContaining({ updateCurrentState: false }));
  });
  it("recognizes actual delivered output as complete", async () => {
    m.sync.mockResolvedValue({ status: "synced" });
    expect(await (await request()).json()).toMatchObject({ status: "complete", prompt_complete: true, progressPercent: 100 });
  });
});
