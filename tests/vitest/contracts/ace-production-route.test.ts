import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({ enabled: true, authenticated: true, source: true }));
vi.mock("@/lib/aceStep", () => ({
  AceMusicUnavailableError: class extends Error {},
  AceMusicUnconfirmedError: class extends Error {
    constructor(readonly operationId: string, readonly taskId: string | null) { super("Unconfirmed; do not resubmit."); }
  },
  extractReferenceAudio: vi.fn(async () => "/mock/reference.wav"),
  generateAceMusic: vi.fn(),
}));
vi.mock("@/lib/workers/auxiliary3090Lease", () => ({ AuxiliaryGpuBusyError: class extends Error {} }));
vi.mock("@/lib/ownerKey", () => ({ SessionInvalidError: class extends Error {} }));
vi.mock("@/lib/gallery", async () => {
  const { SessionInvalidError } = await import("@/lib/ownerKey");
  return {
    getGallerySourcesForRequest: vi.fn(async () => {
      if (!s.authenticated) throw new SessionInvalidError("No session");
      return { owner: { ownerKey: "fixture", username: "fixture", deviceId: "fixture" }, sources: [{ scope: "user", dir: "/mock/gallery" }] };
    }),
    resolveGalleryItemByName: vi.fn(() => s.source ? { path: "/mock/source.mp4", scope: "user" } : null),
    safeGalleryName: (x: string) => x, writeMetaForFile: vi.fn(),
  };
});
vi.mock("@/lib/paths", () => ({ OTG_DATA_ROOT: "/mock/data", ensureDir: vi.fn(), safeJoin: (...parts: string[]) => parts.join("/"), safeSegment: (x: string) => x }));
vi.mock("@/lib/production/featureGate", () => ({ isProductionFeatureEnabled: () => s.enabled, productionDisabledResponse: () => Response.json({ ok: false }, { status: 404 }) }));
vi.mock("node:fs/promises", () => ({ default: { writeFile: vi.fn(), stat: vi.fn(async () => ({ size: 10 })) } }));

import { POST } from "@/app/api/production/edit/ace-music/route";
import { AceMusicUnavailableError, AceMusicUnconfirmedError, extractReferenceAudio, generateAceMusic } from "@/lib/aceStep";
import { AuxiliaryGpuBusyError } from "@/lib/workers/auxiliary3090Lease";
import { writeMetaForFile } from "@/lib/gallery";

function request(body: Record<string, unknown> = { prompt: "CPU mock", sourceFileName: "source.mp4" }) {
  return new NextRequest("http://localhost/api/production/edit/ace-music", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(s, { enabled: true, authenticated: true, source: true });
  vi.stubEnv("ACE_STEP_ENABLED", "1");
  vi.mocked(generateAceMusic).mockResolvedValue({ audioBuffer: Buffer.from("mock audio"), result: {}, taskId: "task-fixture", admissionOperationId: "receipt-fixture", model: "acestep-v15-turbo", durationSeconds: 30, bpm: 95 });
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Network is prohibited in this CPU fixture"); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("production ACE route admission contract", () => {
  it("retains task and durable operation identities in response and saved audio metadata", async () => {
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, taskId: "task-fixture", admissionOperationId: "receipt-fixture", referenceUsed: true });
    expect(writeMetaForFile).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ audioLibrary: expect.objectContaining({ model: "acestep-v15-turbo", taskId: "task-fixture", admissionOperationId: "receipt-fixture" }) }), expect.anything());
    expect(generateAceMusic).toHaveBeenCalledOnce();expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each([null, "task-fixture"])("returns an explicit no-resubmit fence for an unknown outcome with task %s", async taskId => {
    vi.mocked(generateAceMusic).mockRejectedValueOnce(new AceMusicUnconfirmedError("receipt-fixture", taskId));
    const response = await POST(request());expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ok: false, outcomeUnknown: true, taskId, admissionOperationId: "receipt-fixture" });
    expect(generateAceMusic).toHaveBeenCalledOnce();expect(writeMetaForFile).not.toHaveBeenCalled();
  });
  it.each([[503, new AceMusicUnavailableError("exact model unavailable")], [409, new AuxiliaryGpuBusyError("GPU busy")]] as const)("exposes admission status %s without retry", async (status, error) => {
    vi.mocked(generateAceMusic).mockRejectedValueOnce(error);
    const response = await POST(request());expect(response.status).toBe(status);expect(generateAceMusic).toHaveBeenCalledOnce();expect(writeMetaForFile).not.toHaveBeenCalled();
  });
  it.each(["feature", "disabled", "auth", "source", "prompt"])("preserves the existing %s guard before generation", async guard => {
    if (guard === "feature") s.enabled = false;
    if (guard === "disabled") vi.stubEnv("ACE_STEP_ENABLED", "0");
    if (guard === "auth") s.authenticated = false;
    if (guard === "source") s.source = false;
    const response = await POST(request(guard === "prompt" ? {} : undefined));
    expect(response.status).toBe(({ feature: 404, disabled: 503, auth: 401, source: 404, prompt: 400 })[guard]);
    expect(generateAceMusic).not.toHaveBeenCalled();expect(extractReferenceAudio).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
