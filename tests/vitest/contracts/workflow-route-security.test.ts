import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "", signedIn: true, admin: false, clear: vi.fn(), tick: vi.fn() }));
vi.mock("@/lib/ownerKey", () => {
  class SessionInvalidError extends Error {}
  return { SessionInvalidError, getOwnerContext: async () => {
    if (!state.signedIn) throw new SessionInvalidError();
    return { ownerKey: "mine" };
  } };
});
vi.mock("@/app/api/admin/_requireAdmin", () => ({ requireAdmin: async () => state.admin
  ? { ok: true } : { ok: false, status: state.signedIn ? 403 : 401, error: "Unauthorized" } }));
vi.mock("@/lib/workflows", () => ({ getWorkflowsRoot: () => state.root,
  getWorkflowsIndexPath: () => path.join(state.root, "index.json"), clearWorkflowCache: state.clear,
  loadWorkflowById: () => ({ ok: true, meta: { thumbnail: "escape.png" } }) }));
vi.mock("@/lib/jobs/voicePipelineWorker", () => ({ tickVoicePipelineWorker: state.tick }));
let temp: string;
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-access-"));
  state.root = path.join(temp, "workflows"); fs.mkdirSync(state.root);
  state.signedIn = true; state.admin = false; vi.clearAllMocks();
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(temp, { recursive: true, force: true }); });
const request = (route: string, init?: RequestInit) => new NextRequest("http://localhost/api/" + route, init);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("workflow diagnostic and file access boundaries", () => {
  it.each(["workflows/debug", "debug/paths"])("protects %s with real administrator authority", async route => {
    const { GET } = await import("../../../app/api/" + route + "/route");
    state.signedIn = false; expect((await GET()).status).toBe(401);
    state.signedIn = true; expect((await GET()).status).toBe(403);
    state.admin = true; const reply = await GET(); expect(reply.status).toBe(200);
    expect(await reply.text()).not.toMatch(/\/home\/|\/tmp\/|ownerKey|userId/);
  });
  it("allows only same-origin administrator POST cache invalidation", async () => {
    const { GET, POST } = await import("@/app/api/workflows/reload/route");
    expect((await GET()).status).toBe(405); expect(state.clear).not.toHaveBeenCalled();
    expect((await POST(request("workflows/reload", { method: "POST" }))).status).toBe(403);
    state.admin = true;
    expect((await POST(request("workflows/reload", { method: "POST", headers: { origin: "https://unrelated.invalid" } }))).status).toBe(403);
    expect(state.clear).not.toHaveBeenCalled();
    expect((await POST(request("workflows/reload", { method: "POST" }))).status).toBe(200);
    expect(state.clear).toHaveBeenCalledTimes(1);
  });
  it("requires a session before reading workflow files", async () => {
    const { GET } = await import("@/app/api/workflows/[id]/route");
    state.signedIn = false; expect((await GET(request("workflows/test"), params("test"))).status).toBe(401);
  });
  it("reads valid workflows and rejects traversal, symlinks, non-JSON and malformed IDs without path leaks", async () => {
    const { GET } = await import("@/app/api/workflows/[id]/route");
    fs.writeFileSync(path.join(state.root, "valid.json"), '{"nodes":[]}');
    fs.writeFileSync(path.join(state.root, "private.txt"), "secret");
    fs.writeFileSync(path.join(temp, "secret.json"), '{"secret":true}');
    fs.symlinkSync(path.join(temp, "secret.json"), path.join(state.root, "escape.json"));
    expect(await (await GET(request("workflows/valid"), params("valid"))).json()).toEqual({ nodes: [] });
    for (const id of ["../secret.json", "escape.json", "private.txt", "valid.json/../../secret.json", "%E0%A4%A"]) {
      const response = await GET(request("workflows/test"), params(id));
      expect(response.status).toBeGreaterThanOrEqual(400); expect(await response.text()).not.toContain(temp);
    }
  });
  it("does not serve an escaping thumbnail", async () => {
    fs.writeFileSync(path.join(temp, "secret.png"), "secret");
    fs.symlinkSync(path.join(temp, "secret.png"), path.join(state.root, "escape.png"));
    const { GET } = await import("@/app/api/workflows/[id]/thumbnail/route");
    expect((await GET(request("workflows/valid/thumbnail"), params("valid"))).status).toBe(404);
  });
  it("bounds scaffold inputs and rejects inherited workflow identifiers", async () => {
    const { POST } = await import("@/app/api/workflows/run/route");
    state.signedIn = false; expect((await POST(request("workflows/run", { method: "POST" }))).status).toBe(401);
    state.signedIn = true;
    for (const workflowId of ["constructor", "__proto__", "unknown"]) {
      expect((await POST(request("workflows/run", { method: "POST", body: JSON.stringify({ workflowId }) }))).status).toBe(400);
    }
    expect((await POST(request("workflows/run", { method: "POST", body: JSON.stringify({ text: "x".repeat(65536) }) }))).status).toBe(413);
  });
  it("never allows the development worker to impersonate a supplied owner", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { POST } = await import("@/app/api/dev/voice-pipeline-worker/tick/route");
    expect((await POST(request("dev/voice-pipeline-worker/tick", { method: "POST", headers: { "content-type": "application/json" }, body: '{"ownerKey":"someone_else"}' }))).status).toBe(403);
    expect(state.tick).not.toHaveBeenCalled();
  });
});
