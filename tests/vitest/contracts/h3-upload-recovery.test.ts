import {afterAll, beforeEach, describe, expect, it, vi} from "vitest";
import {NextRequest} from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
const m = vi.hoisted(() => ({owner: vi.fn(), session: vi.fn()}));
vi.mock("@/lib/sessionUser", () => ({requireSessionUser: m.session}));
vi.mock("@/lib/ownerKey", async original => ({...await original<typeof import("@/lib/ownerKey")>(), getOwnerContext: m.owner}));
const root = await fs.mkdtemp(path.join(os.tmpdir(), "slr-h3-upload-recovery-"));
vi.stubEnv("OTG_DATA_DIR", root); vi.stubEnv("OTG_ENV", "test");
const {POST, GET, DELETE} = await import("@/app/api/h3/generation/upload/route");
const base = "http://localhost/api/h3/generation/upload";
function chunk(id: string) {
  const form = new FormData();
  for (const [k, v] of Object.entries({uploadId: id, kind: "image", name: "source.png", type: "image/png", size: "5", chunkIndex: "0", chunkCount: "1"})) form.set(k, v);
  form.set("chunk", new File(["image"], "source.png", {type: "image/png"}));
  return new NextRequest(base, {method: "POST", body: form});
}
beforeEach(() => {vi.clearAllMocks(); m.owner.mockResolvedValue({ownerKey: "owner-a"}); m.session.mockResolvedValue({});});
afterAll(async () => {vi.unstubAllEnvs(); await fs.rm(root, {recursive: true, force: true});});
describe("H3 staged reference recovery", () => {
  it("acknowledges a replayed final chunk without corrupting or reopening a complete upload", async () => {
    const id = randomUUID();
    const a = await (await POST(chunk(id))).json(), b = await (await POST(chunk(id))).json();
    expect(a.upload).toMatchObject({id, complete: true}); expect(b.upload).toEqual(a.upload);
    expect(await fs.readFile(path.join(root, "h3-direct/owner-a/staged", id, "source.png"), "utf8")).toBe("image");
  });
  it("validates the exact owned completed server copy without exposing its filesystem path", async () => {
    const id = randomUUID(); await POST(chunk(id));
    const response = await GET(new NextRequest(base + "?id=" + id)), data = await response.json();
    expect(response.status).toBe(200); expect(data.upload).toMatchObject({id, kind: "image", size: 5, complete: true});
    expect(data.upload.path).toBeUndefined(); expect(JSON.stringify(data)).not.toContain(root);
    m.owner.mockResolvedValue({ownerKey: "owner-b"});
    expect((await GET(new NextRequest(base + "?id=" + id))).status).toBe(404);
  });
  it("requires login and does not turn an auth failure into an upload-size warning", async () => {
    m.session.mockRejectedValue(Object.assign(new Error("Session invalid"), {status: 401}));
    const response = await GET(new NextRequest(base + "?id=" + randomUUID()));
    expect(response.status).toBe(401);
  });
  it("marks an expired reference unavailable so the client can upload a fresh copy", async () => {
    const id = randomUUID(); await POST(chunk(id));
    const file = path.join(root, "h3-direct/owner-a/staged", id, "upload.json"), meta = JSON.parse(await fs.readFile(file, "utf8"));
    await fs.writeFile(file, JSON.stringify({...meta, completedAt: new Date(0).toISOString()}));
    expect((await GET(new NextRequest(base + "?id=" + id))).status).toBe(404);
  });
  it("does not resurrect an explicitly canceled reference by replaying a chunk", async () => {
    const id = randomUUID(); await POST(chunk(id));
    await DELETE(new NextRequest(base + "?id=" + id, {method: "DELETE"}));
    expect((await GET(new NextRequest(base + "?id=" + id))).status).toBe(404);
    expect((await POST(chunk(id))).status).toBe(400);
  });
});
