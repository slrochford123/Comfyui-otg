import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ allowed: true, ownerKey: "audit-owner", username: "audit-owner", deviceId: "device", scope: "user" }));
vi.mock("@/lib/ownerKey", () => {
  class SessionInvalidError extends Error {}
  return { SessionInvalidError, getOwnerContext: async () => { if (!auth.allowed) throw new SessionInvalidError(); return auth; } };
});
vi.mock("@/app/api/_lib/comfyTarget", () => ({ configuredImageComfyBaseUrl: () => "http://100.75.162.64:8188" }));
vi.mock("@/app/api/admin/_requireAdmin", () => ({ requireAdmin: async () => ({ ok: false, status: auth.allowed ? 403 : 401, error: "Unauthorized" }) }));
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-security-"));
  vi.stubEnv("OTG_DATA_DIR", root); vi.stubEnv("OTG_DATA_ROOT", root); vi.resetModules();
  auth.allowed = true; vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
const req = (route: string, init?: RequestInit) => new NextRequest("http://localhost" + route, init);

describe("audit route access and media identity", () => {
  it.each([
    ["Image", "GET"], ["comfy/view", "GET"], ["comfy/history-image", "GET"], ["comfy-image", "GET"],
    ["production/comfy-cache", "GET"], ["comfy-upload", "POST"], ["otg/generate", "POST"],
    ["queue/next", "POST"], ["queue/queue/next", "POST"], ["sync", "POST"], ["device-jobs/log", "POST"],
    ["characters/default-image", "POST"], ["jobs/queue", "GET"], ["debug-env", "GET"], ["envcheck", "GET"],
  ])("denies anonymous %s before contacting a worker", async (name, method) => {
    auth.allowed = false;
    const route = await import("../../../app/api/" + name + "/route");
    const response = await route[method](req("/api/" + name, { method }));
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects file traversal and device-controlled roots", async () => {
    const { GET } = await import("@/app/api/Image/route");
    for (const rel of ["../../etc/os-release", "/etc/os-release", "x.txt", "a\\b.png"]) {
      const response = await GET(req("/api/Image?deviceId=/etc&rel=" + encodeURIComponent(rel)));
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });
  it("serves owned legacy gallery media, not another owner's file or symlink", async () => {
    const { GET } = await import("@/app/api/Image/route");
    const own = path.join(root, "user_galleries", auth.ownerKey);
    const other = path.join(root, "user_galleries", "other");
    fs.mkdirSync(own, { recursive: true }); fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(own, "mine.png"), "mine"); fs.writeFileSync(path.join(other, "secret.png"), "secret");
    fs.symlinkSync(path.join(other, "secret.png"), path.join(own, "escape.png"));
    const response = await GET(req("/api/Image?deviceId=other&rel=mine.png"));
    expect(response.status).toBe(200); expect(await response.text()).toBe("mine");
    expect((await GET(req("/api/Image?rel=escape.png"))).status).toBe(404);
    expect((await GET(req("/api/Image?deviceId=other&rel=secret.png"))).status).toBe(404);
  });
  it("keeps a job on its recorded worker even when another GPU has the same filename", async () => {
    const { writePromptRequestMeta } = await import("@/lib/promptRequestMeta");
    writePromptRequestMeta(auth.ownerKey, "owned-job", { comfyBaseUrl: "http://100.98.212.116:8188" });
    vi.mocked(fetch).mockImplementation(async input => {
      const url = String(input);
      expect(url).toContain("100.98.212.116:8188");
      if (url.includes("/history/")) return Response.json({ "owned-job": { outputs: { "9": { images: [{ filename: "same.png", type: "output", subfolder: "" }] } } } });
      return new Response("correct-worker", { headers: { "content-type": "image/png" } });
    });
    const { GET } = await import("@/app/api/comfy/history-image/route");
    const response = await GET(req("/api/comfy/history-image?promptId=owned-job&image=1&comfyBaseUrl=http://100.75.162.64:8188"));
    expect(response.status).toBe(200); expect(await response.text()).toBe("correct-worker");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("never looks up an unowned prompt or a bare shared filename", async () => {
    const history = await import("@/app/api/comfy/history-image/route");
    const view = await import("@/app/api/comfy/view/route");
    expect((await history.GET(req("/api/comfy/history-image?promptId=someone-else"))).status).toBe(404);
    expect((await view.GET(req("/api/comfy/view?filename=secret.png"))).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves concurrent backend receipts and refuses ambiguous bare filenames", async () => {
    const {recordOwnedWorkerMedia} = await import("@/lib/comfyMediaAccess");
    const media = {filename:"same.png",subfolder:"",type:"output"};
    await Promise.all(["http://100.75.162.64:8188","http://100.98.212.116:8188"].map(base => recordOwnedWorkerMedia(auth.ownerKey,base,media)));
    const {GET} = await import("@/app/api/comfy-image/route");
    expect((await GET(req("/api/comfy-image?filename=same.png"))).status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValue(new Response(null,{status:200,headers:{"content-type":"image/png"}}));
    const debug = await GET(req("/api/comfy-image?filename=same.png&comfyBaseUrl=http://100.98.212.116:8188&debug=1"));
    expect(await debug.json()).toMatchObject({ok:true,exists:true});
    expect(fetch).toHaveBeenCalledWith(expect.any(URL),expect.objectContaining({method:"HEAD"}));
  });
  it("rejects cross-origin mutations after authentication", async () => {
    const {POST} = await import("@/app/api/comfy-upload/route");
    expect((await POST(req("/api/comfy-upload",{method:"POST",headers:{origin:"https://unrelated.invalid"}}))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns sanitized owner queues using tuple index one", async () => {
    const { writePromptRequestMeta } = await import("@/lib/promptRequestMeta");
    writePromptRequestMeta(auth.ownerKey, "mine", {});
    vi.mocked(fetch).mockResolvedValue(Response.json({ queue_running: [[77, "mine", { secret: "raw graph" }], [78, "other", { secret: "other prompt" }]], queue_pending: [] }));
    const { GET } = await import("@/app/api/jobs/queue/route");
    const response = await GET(req("/api/jobs/queue"));
    expect(await response.json()).toEqual({ ok: true, ownerKey: auth.ownerKey, running: [{ prompt_id: "mine" }], pending: [] });
  });
  it("rejects arbitrary remote character-image fetching", async () => {
    const { POST } = await import("@/app/api/characters/default-image/route");
    const response = await POST(req("/api/characters/default-image", { method: "POST", body: JSON.stringify({ imageUrl: "http://169.254.169.254/latest/meta-data" }), headers: { "content-type": "application/json" } }));
    expect(response.status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });
  it("supports media ranges and HEAD and rejects malformed byte ranges", async () => {
    const { mediaFileResponse } = await import("@/lib/mediaResponse");
    const file = path.join(root, "video.mp4"); fs.writeFileSync(file, "0123456789");
    const response = mediaFileResponse(req("/file", { headers: { range: "bytes=2-5" } }), file);
    expect(response.status).toBe(206); expect(await response.text()).toBe("2345");
    const head = mediaFileResponse(req("/file", { method: "HEAD" }), file, { method: "HEAD" });
    expect(head.headers.get("content-length")).toBe("10"); expect(await head.text()).toBe("");
    for (const range of ["bytes=1oops-5", "bytes=2-3-4", "bytes=-0", "bytes=11-"]) expect(mediaFileResponse(req("/file", { headers: { range } }), file).status).toBe(416);
    const stream = mediaFileResponse(req("/file"), file); await expect(stream.body!.cancel()).resolves.toBeUndefined();
  });
});
