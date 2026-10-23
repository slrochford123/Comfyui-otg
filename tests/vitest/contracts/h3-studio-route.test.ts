import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SessionInvalidError } from "@/lib/ownerKey";
import { DEFAULT_H3_STUDIO_PLAN } from "@/lib/h3StudioPlan";
const m = vi.hoisted(() => ({ session: vi.fn(), inventory: vi.fn(), paid: vi.fn() }));
vi.mock("@/lib/sessionUser", () => ({ requireSessionUser: m.session }));
vi.mock("@/lib/h3VideoTrimSession", () => ({ videoTrimSession: async () => ({ owner: "qa-owner", session: "qa-session" }) }));
vi.mock("@/lib/h3StudioReview", () => ({ studioReviewedExecutionDigest: () => "qa-execution", createStudioReview: async (_owner: string, _session: string, _plan: unknown, mediaFingerprint: string) => ({ id: "qa-review", mediaFingerprint, expiresAt: Date.now() + 1000 }) }));
vi.mock("@/lib/h3StudioRegistry", async original => ({ ...await original<typeof import("@/lib/h3StudioRegistry")>(), inspectH3StudioInventory: m.inventory }));
vi.mock("@/lib/h3StudioPlanner", () => ({ h3PlannerQuote: () => ({ estimatedUsd: .001 }), planH3WithDirector: m.paid }));
import { GET, POST } from "@/app/api/h3/studio/route";
const plan = { ...DEFAULT_H3_STUDIO_PLAN, prompt: "A QA landscape", originalPrompt: "A QA landscape" };
function post(body: unknown, headers = {}) { return POST(new NextRequest("http://localhost:3001/api/h3/studio", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) })); }
beforeEach(() => {
  vi.stubEnv("OTG_ENV", "test"); vi.stubEnv("OTG_H3_STUDIO_EVIDENCE_FILE", ""); vi.clearAllMocks();
  m.session.mockResolvedValue({ ownerKey: "qa-owner", admin: false });
  m.inventory.mockResolvedValue({ nodes: new Set(), models: new Set(), loras: new Set(), observedAt: "2026-10-23" });
});
afterEach(() => vi.unstubAllEnvs());
describe("H3 Studio authenticated TEST-only preview route", () => {
  it("denies an unauthenticated catalog request before worker access", async () => { m.session.mockRejectedValue(new SessionInvalidError()); expect((await GET(new NextRequest("http://localhost:3001/api/h3/studio"))).status).toBe(401); expect(m.inventory).not.toHaveBeenCalled(); });
  it("denies unauthenticated planning before paid calls", async () => { m.session.mockRejectedValue(new SessionInvalidError()); expect((await post({ action: "director", plan })).status).toBe(401); expect(m.paid).not.toHaveBeenCalled(); });
  it("fails closed for an unknown deployment before any inventory or paid access", async () => { vi.stubEnv("OTG_ENV", "staging"); vi.stubEnv("NODE_ENV", "production"); expect((await post({ action: "preview", plan })).status).toBe(404); expect(m.inventory).not.toHaveBeenCalled(); });
  it("offers ordinary PROD generation without exporting TEST owner authorization", async () => {
    vi.stubEnv("OTG_ENV", "prod");
    const response = await GET(new NextRequest("http://localhost:3000/api/h3/studio"));
    const data = await response.json(); expect(response.status).toBe(200);
    expect(data.directGeneration).toBe(true); expect(data.experimental).toBe(false);
    expect(data.upstreamAuthorization).toBeUndefined(); expect(m.paid).not.toHaveBeenCalled();
  });
  it("allows a signed-in user a path-free 60-entry catalog without approving any asset", async () => {
    const r = await GET(new NextRequest("http://localhost:3001/api/h3/studio")); const body = await r.json();
    expect(r.status).toBe(200); expect(body.catalog).toHaveLength(60); expect(body.counts).toEqual({ selected: 60, maybe: 4, skip: 76, undecided: 13 });
    expect(body.qualificationState).toBe("per-plan-validation-required"); expect(JSON.stringify(body)).not.toMatch(/\/home\/|100\.75\.|token/i);
  });
  it("previews deterministic graphs without starting a paid request", async () => {
    const r = await post({ action: "preview", plan }); const body = await r.json(); expect(r.status).toBe(200); expect(body.manifest.executable).toBe(false); expect(body.manifest.width).toBe(1056); expect(m.paid).not.toHaveBeenCalled();
  });
  it.each(["generate", "download", "install", "shell"])("rejects action %s", async action => { expect((await post({ action, plan })).status).toBe(400); expect(m.inventory).not.toHaveBeenCalled(); });
  it("rejects client graphs/paths/cost fields", async () => { expect((await post({ action: "preview", plan: { ...plan, graph: {} } })).status).toBe(400); expect(m.inventory).not.toHaveBeenCalled(); });
  it("bounds actual request bytes rather than trusting Content-Length", async () => { expect((await post({ action: "preview", plan, excess: "x".repeat(21000) })).status).toBe(413); expect(m.inventory).not.toHaveBeenCalled(); });
  it("does not leak worker network or filesystem errors", async () => { m.inventory.mockRejectedValue(new Error("secret http://private /home/private token=do-not-print")); const response = await post({ action: "preview", plan }); expect(await response.text()).not.toMatch(/private|do-not-print|token=/); });
});
