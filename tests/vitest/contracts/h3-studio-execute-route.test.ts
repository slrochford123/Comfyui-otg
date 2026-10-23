import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DEFAULT_H3_STUDIO_PLAN } from "@/lib/h3StudioPlan";
const m = vi.hoisted(() => ({ root: "", session: vi.fn(), owner: vi.fn(), media: vi.fn(), validateMedia: vi.fn(), compile: vi.fn(), review: vi.fn(), claim: vi.fn(), prior: vi.fn(), create: vi.fn(), start: vi.fn() }));
vi.mock("@/lib/paths", () => ({ get OTG_DATA_ROOT() { return m.root; }, safeSegment: (s: string) => s.replace(/[^a-z0-9_-]/g, "_") }));
vi.mock("@/lib/h3VideoTrimSession", () => ({ videoTrimSession: m.session }));
vi.mock("@/lib/ownerKey", () => ({ getOwnerContext: m.owner }));
vi.mock("@/lib/h3StudioMedia", () => ({ resolveStudioMedia: m.media, validateStudioMediaPlan: m.validateMedia, studioBoundCompilerInput: () => ({}), studioFileSha256: vi.fn() }));
vi.mock("@/lib/h3StudioCompiler", () => ({ compileH3StudioPlan: m.compile }));
vi.mock("@/lib/h3StudioRegistry", () => ({ assertH3StudioTest: () => { if (process.env.OTG_ENV !== "test") throw Error("Not TEST"); }, inspectH3StudioInventory: async () => ({}), readH3StudioEvidence: () => null, h3StudioCatalog: () => [] }));
vi.mock("@/lib/h3StudioReview", () => ({ validateStudioReview: m.review, claimStudioReview: m.claim, studioReviewedExecutionDigest: () => "execution", studioRequestHash: () => "plan" }));
vi.mock("@/lib/h3DirectJobs", () => ({ listH3DirectJobs: m.prior, createH3DirectJob: m.create, startH3DirectJob: m.start, h3DirectPublicStatus: (job: unknown) => job, validateH3DirectInput: (i: unknown) => i }));
import { POST } from "@/app/api/h3/studio/execute/route";
const plan = { ...DEFAULT_H3_STUDIO_PLAN, originalPrompt: "A QA kite", prompt: "A QA kite" };
const body = { plan, mediaIds: [], reviewId: "qa-review", requestId: "qa-request-123", generationConsent: true };
function post(value: unknown = body) { return POST(new NextRequest("http://localhost:3001/api/h3/studio/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) })); }
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubEnv("OTG_ENV", "test"); m.root = await fs.mkdtemp(path.join(os.tmpdir(), "h3-execute-test-"));
  m.session.mockResolvedValue({ owner: "qa-owner", session: "qa-session" }); m.owner.mockResolvedValue({ ownerKey: "qa-owner" });
  m.media.mockResolvedValue({ fingerprint: "media", mediaIds: [], items: [] });
  m.compile.mockReturnValue({ graph: {}, manifest: { executable: true, qualificationFingerprint: "qualification", submissionGraphSha256: "graph", estimatedCredits: 0, estimatedSeconds: 20, width: 608, height: 352 } });
  m.review.mockResolvedValue({}); m.claim.mockResolvedValue(async () => {}); m.prior.mockResolvedValue([]);
  m.create.mockImplementation(async (_owner, input) => ({ id: "h3-direct-qa", status: "queued", input }));
});
afterEach(async () => { await fs.rm(m.root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
describe("reviewed H3 Studio generation admission", () => {
  it("denies unauthenticated requests before inspecting media or starting work", async () => {
    m.session.mockRejectedValue(new Error("Unauthorized")); expect((await post()).status).toBe(401); expect(m.media).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
  });
  it("denies non-TEST execution", async () => { vi.stubEnv("OTG_ENV", "prod"); expect((await post()).status).toBe(400); expect(m.start).not.toHaveBeenCalled(); });
  it.each([{ generationConsent: false }, { target: "5060ti" }, { graph: {} }, { path: "/private" }])("rejects missing consent or injected execution controls", async patch => {
    expect((await post({ ...body, ...patch })).status).toBe(400); expect(m.start).not.toHaveBeenCalled();
  });
  it("rejects an unqualified configuration even with a forged review ID", async () => {
    m.compile.mockReturnValue({ manifest: { executable: false } }); expect((await post()).status).toBe(400); expect(m.create).not.toHaveBeenCalled();
  });
  it("rejects another owner's media and stale exact reviews", async () => {
    m.media.mockRejectedValueOnce(new Error("Owner mismatch")); expect((await post()).status).toBe(400);
    m.review.mockRejectedValueOnce(new Error("Changed content")); expect((await post()).status).toBe(400); expect(m.start).not.toHaveBeenCalled();
  });
  it("revalidates the exact media again immediately before job creation", async () => {
    m.media.mockResolvedValueOnce({ fingerprint: "media", items: [] }).mockResolvedValueOnce({ fingerprint: "changed", items: [] });
    expect((await post()).status).toBe(400); expect(m.create).not.toHaveBeenCalled();
  });
  it("requires single-use claim and creates only the existing shared-engine job", async () => {
    const response = await post(); expect(response.status).toBe(202); expect(m.create).toHaveBeenCalledTimes(1); expect(m.start).toHaveBeenCalledTimes(1);
    const input = m.create.mock.calls[0][1]; expect(input.studioPlan).toEqual(plan); expect(input.studioMedia.qualificationFingerprint).toBe("qualification"); expect(input.rifeInterpolation60Fps).toBe(false);
    expect(m.review).toHaveBeenCalledWith("qa-owner", "qa-session", "qa-review", plan, "media", "qualification", "graph", { executionDigest: "execution", credits: 0, seconds: 20 });
  });
  it("returns a prior exact request without launching a duplicate generation", async () => {
    m.prior.mockResolvedValue([{ id: "old", input: { studioMedia: { requestId: body.requestId } } }]);
    expect((await post()).status).toBe(200); expect(m.create).not.toHaveBeenCalled();
  });
  it("blocks a new job while a prior backend acceptance is unresolved", async () => {
    m.prior.mockResolvedValue([{ id: "old", promptId: null, studioSubmissionState: "unknown", input: { studioPlan: plan } }]);
    expect((await post()).status).toBe(400); expect(m.create).not.toHaveBeenCalled();
  });
});
