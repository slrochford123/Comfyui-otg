import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ owner: vi.fn(), backend: vi.fn(), qualified: vi.fn(), fetch: vi.fn(), voice: vi.fn() }));
vi.mock("@/lib/workers/voiceGpuFileLease", () => ({ voiceGpuFileBusy: m.voice }));
vi.mock("@/lib/ownerKey", () => ({ getOwnerContext: m.owner }));
vi.mock("@/lib/images/mossBackend", () => ({ chooseMossBackend: m.backend }));
vi.mock("@/lib/images/mossQualification", () => ({ mossPhysicallyQualified: m.qualified }));
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", m.fetch); m.owner.mockResolvedValue({ ownerKey: "qa_owner" }); m.backend.mockResolvedValue({ baseUrl: "http://qa-worker" }); m.qualified.mockReturnValue(true); m.voice.mockReturnValue(false); m.fetch.mockImplementation(async () => Response.json({ queue_running: [], queue_pending: [] })); });
async function status(target = "5060ti") { const { GET } = await import("@/app/api/images/moss-status/route"); return GET(new NextRequest("http://localhost:3001/api/images/moss-status?target=" + target)); }
describe("MOSS readiness is not file discovery", () => {
  it("reports Ready only after physical qualification and an empty verified queue", async () => { expect(await (await status()).json()).toMatchObject({ state: "ready", qualified: true }); });
  it("does not call merely installed models Ready", async () => { m.qualified.mockReturnValue(false); expect(await (await status()).json()).toMatchObject({ state: "installed", qualified: false }); });
  it("reports Busy for running work", async () => { m.fetch.mockResolvedValueOnce(Response.json({ queue_running: [[0, "qa-job"]], queue_pending: [] })); expect(await (await status()).json()).toMatchObject({ state: "busy" }); });
  it("fails closed on an unverified queue", async () => { m.fetch.mockResolvedValueOnce(Response.json({})); expect((await status()).status).toBe(503); });
  it("requires authentication before querying workers", async () => { m.owner.mockRejectedValueOnce(Error("Session invalid")); expect((await status()).status).toBe(401); expect(m.fetch).not.toHaveBeenCalled(); });
  it("does not call the 3090 Ready while its H3 peer is running", async () => { m.fetch.mockImplementation(async (url: string) => Response.json({ queue_running: url.includes(":8189") ? [[0, "qa-h3"]] : [], queue_pending: [] })); expect(await (await status("3090")).json()).toMatchObject({ state: "busy" }); });
  it("does not call the 3090 Ready during an exclusive voice operation", async () => { m.voice.mockReturnValue(true); expect(await (await status("3090")).json()).toMatchObject({ state: "busy" }); });
  it("fails closed when shared-worker readiness cannot be verified", async () => { m.fetch.mockImplementation(async (url: string) => Response.json(url.includes(":8189") ? {} : { queue_running: [], queue_pending: [] })); expect((await status("3090")).status).toBe(503); });
});
