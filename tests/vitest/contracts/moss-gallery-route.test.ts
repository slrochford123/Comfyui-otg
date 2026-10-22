import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SessionInvalidError } from "@/lib/ownerKey";
const m = vi.hoisted(() => ({ owner: vi.fn(), mkdir: vi.fn(), write: vi.fn(), meta: vi.fn(), image: vi.fn() }));
vi.mock("@/lib/gallery", () => ({ getGallerySourcesForRequest: m.owner, writeMetaForFile: m.meta }));
vi.mock("node:fs", () => ({ default: { mkdirSync: m.mkdir, writeFileSync: m.write } }));
vi.mock("sharp", () => ({ default: () => ({ metadata: m.image }) }));
beforeEach(() => { vi.clearAllMocks(); m.owner.mockResolvedValue({ owner: { ownerKey: "qa_A", username: "qa_A", deviceId: "qa_device" }, sources: [{ scope: "user", dir: "/test/qa_A", ownerKey: "qa_A", username: "qa_A" }] }); m.image.mockResolvedValue({ format: "png", width: 1024, height: 1024 }); });
async function save(origin = "character", gpuTarget = "3090", promptId = "9daa7d67-a808-4991-8124-6b78c572d245") {
  const form = new FormData(); form.set("image", new File(["QA PNG fixture"], "qa.png", { type: "image/png" })); form.set("origin", origin); form.set("gpuTarget", gpuTarget); form.set("promptId", promptId);
  const { POST } = await import("@/app/api/images/moss-gallery/route");
  return POST(new NextRequest("http://localhost:3001/api/images/moss-gallery", { method: "POST", body: form }));
}
describe("MOSS explicit Gallery save", () => {
  it("rejects anonymous save before any storage write", async () => { m.owner.mockRejectedValueOnce(new SessionInvalidError()); expect((await save()).status).toBe(401); expect(m.write).not.toHaveBeenCalled(); });
  it.each(["character", "freeform-character", "background", "asset"])("preserves authenticated owner and %s origin", async origin => { const r = await save(origin, "5060ti"); expect(r.status).toBe(200); expect(m.write.mock.calls[0][0]).toContain("/test/qa_A/MOSS_"); expect(m.meta).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ ownerKey: "qa_A", sourceType: `moss-${origin}`, submitPayload: expect.objectContaining({ gpuTarget: "5060ti", origin }) }), expect.any(Object)); });
  it("rejects arbitrary origin and filename traversal", async () => { expect((await save("../other" )).status).toBe(400); expect((await save("asset", "3090", "../../other.png")).status).toBe(400); expect(m.write).not.toHaveBeenCalled(); });
  it("rejects invalid GPU targets", async () => { expect((await save("asset", "arbitrary-host")).status).toBe(400); expect(m.write).not.toHaveBeenCalled(); });
  it("validates image content rather than trusting MIME or filename", async () => { m.image.mockRejectedValueOnce(Error("invalid image")); expect((await save()).status).toBe(400); expect(m.write).not.toHaveBeenCalled(); });
  it("does not replace a previously saved candidate on repeated clicks", async () => { m.write.mockImplementationOnce(() => { throw Object.assign(Error("exists"), { code: "EEXIST" }); }); expect((await save()).status).toBe(200); expect(m.write).toHaveBeenCalledTimes(1); expect(m.write.mock.calls[0][2]).toMatchObject({ flag: "wx" }); });
});
