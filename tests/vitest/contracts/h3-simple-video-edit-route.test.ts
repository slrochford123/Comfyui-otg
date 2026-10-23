import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/h3StudioAdmission", () => ({ assertH3StudioAvailable: m.test }));
const m = vi.hoisted(() => ({ session: vi.fn(), test: vi.fn(), read: vi.fn(), probe: vi.fn(), prior: vi.fn(), register: vi.fn(), remove: vi.fn(), compile: vi.fn(), execute: vi.fn(), stat: vi.fn(), readFile: vi.fn(), review: vi.fn() }));
vi.mock("node:fs/promises", () => ({ default: { stat: m.stat, readFile: m.readFile } }));
vi.mock("@/lib/h3VideoTrimSession", () => ({ videoTrimSession: m.session }));
vi.mock("@/lib/h3VideoTrim", () => ({ readVideoTrim: m.read }));
vi.mock("@/lib/videoFrame", () => ({ probeVideoInfo: m.probe }));
vi.mock("@/lib/h3StudioRegistry", () => ({ assertH3StudioTest: m.test, inspectH3StudioInventory: async () => ({}), readH3StudioEvidence: () => ({}) }));
vi.mock("@/lib/h3StudioMedia", () => ({ registerStudioMedia: m.register, removeStudioMedia: m.remove, resolveStudioMedia: async () => ({ fingerprint: "exact", items: [] }), studioBoundCompilerInput: (plan: unknown) => ({ plan }) }));
vi.mock("@/lib/h3StudioCompiler", () => ({ compileH3StudioPlan: m.compile }));
vi.mock("@/lib/h3StudioReview", () => ({ createStudioReview: m.review, studioReviewedExecutionDigest: () => "graph" }));
vi.mock("@/lib/h3StudioExecution", () => ({ executeH3Studio: m.execute }));
vi.mock("@/lib/h3DirectJobs", () => ({ listH3DirectJobs: m.prior, h3DirectPublicStatus: (job: unknown) => job }));
import { POST } from "@/app/api/h3/video-edit/simple/route";
import { parseSimpleVideoEdit } from "@/lib/h3SimpleVideoEdit";
const body = { sourceId: "e028b5a5-b70e-4cf7-b91f-bc45f3f380f4", prompt: "Blue coat", quality: "0.6", requestId: "qa-request-123" };
const post = (patch = {}) => POST(new NextRequest("http://localhost:3001/api/h3/video-edit/simple", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...patch }) }));
beforeEach(() => {
  vi.resetAllMocks(); m.session.mockResolvedValue({ owner: "qa", session: "session" }); m.prior.mockResolvedValue([]);
  m.read.mockResolvedValue({ path: "/private/selection.mp4", asset: { duration: 999 } });
  m.probe.mockResolvedValue({ codec: "h264", width: 608, height: 352, durationSeconds: 4.76 });
  m.stat.mockResolvedValue({ size: 100 }); m.readFile.mockResolvedValue(Buffer.from("video"));
  m.register.mockResolvedValue({ id: "media" }); m.remove.mockResolvedValue(undefined); m.review.mockResolvedValue({ id: "review" });
  m.compile.mockReturnValue({ graph: { preview: { class_type: "ModelPreviewOverrideKJ" } }, manifest: { executable: true, qualificationFingerprint: "qualified", submissionGraphSha256: "graph", estimatedCredits: 0, estimatedSeconds: 20 } });
  m.execute.mockResolvedValue(new Response(JSON.stringify({ job: { id: "job" } }), { status: 202 }));
});
describe("manual Edit Video direct creation", () => {
  it("authorizes the exact trim, re-probes real duration, and calls only the shared engine", async () => {
    expect((await post()).status).toBe(202);
    expect(m.read).toHaveBeenCalledWith("qa", "session", body.sourceId);
    expect(m.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ generationConsent: true, mediaIds: ["media"], reviewId: "review", plan: expect.objectContaining({ durationSeconds: 4.76, steps: 8, attention: "project-sla" }) }), expect.objectContaining({ sourceId: body.sourceId }));
    expect(m.remove).toHaveBeenCalledWith("qa", "session", "media");
  });
  it("denies missing session before reading any media", async () => { m.session.mockRejectedValue(Error("Unauthorized")); expect((await post()).status).toBe(401); expect(m.read).not.toHaveBeenCalled(); });
  it("denies an unavailable deployment and another session's source", async () => {
    m.test.mockImplementationOnce(() => { throw Error("Not TEST"); }); expect((await post()).status).toBe(400);
    m.read.mockRejectedValue(Error("Owner mismatch")); expect((await post()).status).toBe(400); expect(m.execute).not.toHaveBeenCalled();
  });
  it.each([1.9, 10.1])("rejects server-measured %ss despite forged record duration", async durationSeconds => {
    m.probe.mockResolvedValue({ codec: "h264", width: 608, height: 352, durationSeconds }); expect((await post()).status).toBe(400); expect(m.register).not.toHaveBeenCalled();
  });
  it("returns exact request replay without launching work", async () => {
    m.prior.mockResolvedValue([{ id: "old", input: { studioMedia: { requestId: body.requestId, simpleEdit: { requestFingerprint: parseSimpleVideoEdit(body).requestFingerprint } } } }]);
    expect((await post()).status).toBe(200); expect(m.execute).not.toHaveBeenCalled(); expect(m.read).not.toHaveBeenCalled();
  });
  it("rejects a reused request key with changed input", async () => { m.prior.mockResolvedValue([{ input: { studioMedia: { requestId: body.requestId, simpleEdit: { requestFingerprint: "different" } } } }]); expect((await post()).status).toBe(409); expect(m.execute).not.toHaveBeenCalled(); });
  it("fails closed if installed models/owner access are unavailable", async () => { m.compile.mockReturnValue({ manifest: { executable: false, blockedReasons: ["MODEL_MISSING"] } }); expect((await post()).status).toBe(400); expect(m.execute).not.toHaveBeenCalled(); expect(m.remove).toHaveBeenCalled(); });
  it("requires the real generation preview node", async () => { m.compile.mockReturnValue({ graph: {}, manifest: { executable: true } }); expect((await post()).status).toBe(400); expect(m.execute).not.toHaveBeenCalled(); });
});
