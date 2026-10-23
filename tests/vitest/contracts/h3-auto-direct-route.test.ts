import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DEFAULT_H3_STUDIO_PLAN, automaticH3Plan } from "@/lib/h3StudioPlan";
import { compileH3StudioPlan, h3StudioPreviewInput } from "@/lib/h3StudioCompiler";
const m = vi.hoisted(() => ({ session: vi.fn(), test: vi.fn(), media: vi.fn(), prior: vi.fn(), compile: vi.fn(), execute: vi.fn(), review: vi.fn() }));
vi.mock("@/lib/h3VideoTrimSession", () => ({ videoTrimSession: m.session }));
vi.mock("@/lib/h3StudioRegistry", async original => ({ ...await original<typeof import("@/lib/h3StudioRegistry")>(), assertH3StudioTest: m.test, inspectH3StudioInventory: async () => ({}), readH3StudioEvidence: () => null }));
vi.mock("@/lib/h3StudioMedia", () => ({ resolveStudioMedia: m.media, validateStudioMediaPlan: vi.fn(), studioBoundCompilerInput: () => ({}) }));
vi.mock("@/lib/h3StudioCompiler", () => ({ compileH3StudioPlan: m.compile, h3StudioPreviewInput: vi.fn() }));
vi.mock("@/lib/h3StudioReview", () => ({ createStudioReview: m.review, studioReviewedExecutionDigest: () => "exact-graph" }));
vi.mock("@/lib/h3StudioExecution", () => ({ executeH3Studio: m.execute }));
vi.mock("@/lib/h3DirectJobs", () => ({ listH3DirectJobs: m.prior, h3DirectPublicStatus: (job: unknown) => job }));
import { POST } from "@/app/api/h3/studio/auto/route";
const body = { plan: { ...DEFAULT_H3_STUDIO_PLAN, prompt: "A blue coat", originalPrompt: "A blue coat", attention: "dense" }, mediaIds: [], requestId: "qa-request-auto" };
const post = (patch = {}) => POST(new NextRequest("http://localhost:3001/api/h3/studio/auto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...patch }) }));
beforeEach(() => {
  vi.resetAllMocks(); m.session.mockResolvedValue({ owner: "owner", session: "session" }); m.prior.mockResolvedValue([]);
  m.media.mockResolvedValue({ fingerprint: "exact-media", items: [] }); m.review.mockResolvedValue({ id: "internal" });
  m.compile.mockReturnValue({ graph: {}, manifest: { executable: true, experimental: true, qualificationFingerprint: "qualified", submissionGraphSha256: "graph", estimatedCredits: 0, estimatedSeconds: 20 } });
  m.execute.mockImplementation(async () => new Response(JSON.stringify({ job: { id: "job" } }), { status: 202 }));
});
describe("one-click authenticated Auto admission", () => {
  it("enforces SLA and FL2VA 8-step despite old Native/dense settings, without external approval", async () => {
    const response = await post(); expect(response.status).toBe(202);
    expect(m.compile.mock.calls[0][0]).toMatchObject({ workflowId: "native-t2v", profile: "fl2va-8step", attention: "project-sla", steps: 8, sampler: "res_multistep" });
    expect(m.execute).toHaveBeenCalledTimes(1);
    expect(m.execute.mock.calls[0][1]).toMatchObject({ reviewId: "internal", generationConsent: true });
    expect(m.execute.mock.calls[0][3]).toMatch(/^[a-f0-9]{64}$/);
    expect((await response.json()).settings).toBeDefined();
  });
  it.each([["image", "first", "native-i2v", "fl2va-8step"], ["image", "reference", "native-r2v", "ref2va-8step"], ["video", "reference", "reference-edit", "ref2va-8step"]])("uses actual authorized %s/%s media to select %s", async (kind, role, workflowId, profile) => {
    m.media.mockResolvedValue({ fingerprint: "exact-media", items: [{ asset: { kind, role } }] });
    expect((await post({ mediaIds: ["media"] })).status).toBe(202);
    expect(m.compile.mock.calls[0][0]).toMatchObject({ workflowId, profile, steps: 8, attention: "project-sla" });
  });
  it("rejects missing authentication before inspecting media", async () => { m.session.mockRejectedValue(Error("Unauthorized")); expect((await post()).status).toBe(401); expect(m.media).not.toHaveBeenCalled(); });
  it("rejects non-TEST, foreign references and unexecutable configurations", async () => {
    m.test.mockImplementationOnce(() => { throw Error("Not TEST"); }); expect((await post()).status).toBe(400);
    m.media.mockRejectedValueOnce(Error("Foreign media")); expect((await post()).status).toBe(400);
    m.compile.mockReturnValueOnce({ manifest: { executable: false, blockedReasons: ["MODEL_MISSING"] } }); expect((await post()).status).toBe(400);
    expect(m.execute).not.toHaveBeenCalled();
  });
  it.each([{ graph: {} }, { target: "5060ti" }, { path: "/private" }, { experimental: true }])("rejects injected execution controls %s", async patch => { expect((await post(patch)).status).toBe(400); expect(m.execute).not.toHaveBeenCalled(); });
  it("replays only the same bound request and rejects changed inputs", async () => {
    await post(); const fingerprint = m.execute.mock.calls[0][3];
    m.prior.mockResolvedValue([{ id: "old", input: { studioPlan: automaticH3Plan(body.plan as any), studioMedia: { requestId: body.requestId, autoRequestFingerprint: fingerprint } } }]);
    expect((await post()).status).toBe(200); expect(m.execute).toHaveBeenCalledTimes(1);
    expect((await post({ plan: { ...body.plan, prompt: "Different" } })).status).toBe(409);
  });
});
