import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ session: vi.fn(), owner: vi.fn(), probe: vi.fn(), create: vi.fn(), list: vi.fn(), start: vi.fn(), write: vi.fn(), mkdir: vi.fn() }));
vi.mock("@/lib/sessionUser", () => ({ requireSessionUser: m.session }));
vi.mock("@/lib/ownerKey", () => ({ getOwnerContext: m.owner }));
vi.mock("node:fs/promises", () => ({ default: { mkdir: m.mkdir, writeFile: m.write, rm: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("@/lib/videoFrame", () => ({ probeVideoInfo: m.probe }));
vi.mock("@/lib/h3DirectJobs", () => ({ createH3DirectJob: m.create, h3DirectPublicStatus: (j: any) => j, listH3DirectJobs: m.list, startH3DirectJob: m.start }));
async function post(options: { duration?: number; filename?: string; type?: string; prompt?: string; blankFile?: boolean } = {}) {
  m.probe.mockResolvedValue({ durationSeconds: options.duration ?? 5, width: 1280, height: 720, codec: "h264" });
  const form = new FormData();
  if (!options.blankFile) form.append("video", new File(["disposable QA bytes"], options.filename || "qa.mp4", { type: options.type || "video/mp4" }));
  form.set("prompt", options.prompt ?? "Change the coat to navy blue."); form.set("requestId", "qa-video-edit-unique-request");
  const { POST } = await import("@/app/api/h3/video-edit/route");
  return POST(new NextRequest("http://localhost:3001/api/h3/video-edit", { method: "POST", body: form }));
}
beforeEach(() => {
  vi.clearAllMocks(); m.session.mockResolvedValue({ id: 7 });
  m.owner.mockResolvedValue({ ownerKey: "qa_owner", username: "qa_owner", deviceId: "qa_device", scope: "user" });
  m.list.mockResolvedValue([]); m.create.mockImplementation(async (owner: string, input: any) => ({ id: "qa-job", owner, input }));
});
describe("H3 Edit Video authenticated upload boundary", () => {
  it("rejects unauthenticated execution before saving any source", async () => { m.session.mockRejectedValueOnce(new Error("Unauthorized")); expect((await post()).status).toBe(401); expect(m.write).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled(); });
  it.each([1.99, 10.1])("rejects probed duration %s without a generation job", async duration => { expect((await post({ duration })).status).toBe(400); expect(m.create).not.toHaveBeenCalled(); });
  it.each([["qa.png", "image/png"], ["qa.wav", "audio/wav"]])("rejects %s rather than treating it as a video", async (filename, type) => { expect((await post({ filename, type })).status).toBe(400); expect(m.write).not.toHaveBeenCalled(); });
  it("rejects empty prompt without mutating source/job storage", async () => { expect((await post({ prompt: "" })).status).toBe(400); expect(m.write).not.toHaveBeenCalled(); });
  it("creates an owner-scoped true V2V input with native H3 settings, no reference disguising", async () => {
    expect((await post({ duration: 2 })).status).toBe(202);
    expect(m.create).toHaveBeenCalledWith("qa_owner", expect.objectContaining({ h3Settings: expect.objectContaining({ renderMode: "native", combatLoraEnabled: false }), images: [], videos: [], videoEdit: expect.objectContaining({ durationSeconds: 2, requestId: "qa-video-edit-unique-request", source: expect.objectContaining({ name: "qa.mp4" }) }) }), expect.objectContaining({ ownerKey: "qa_owner" }));
    expect(m.start).toHaveBeenCalledTimes(1);
  });
  it("returns an existing same-owner request instead of a second generation", async () => { m.list.mockResolvedValueOnce([{ id: "prior-job", input: { videoEdit: { requestId: "qa-video-edit-unique-request" } } }]); expect((await post()).status).toBe(200); expect(m.create).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled(); expect(m.write).not.toHaveBeenCalled(); });
});
