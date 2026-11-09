import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
const auth = vi.hoisted(() => ({ ok: false, id: "admin-a", status: 401, error: "Not signed in" }));
vi.mock("@/app/api/admin/_requireAdmin", () => ({ requireAdmin: async () => auth }));
vi.mock("@/lib/auth/admin", () => ({ isAdminUserId: () => true }));
vi.mock("@/lib/sessionUser", () => ({ requireSessionUser: async () => ({ ownerKey: "admin-a" }) }));
vi.mock("@/app/api/h3/special/refmods/library/route", () => ({ GET: async () => Response.json({ entries: [] }) }));
vi.mock("@/lib/production/h3Comfy", () => ({ uploadH3InputToBaseUrl: vi.fn(), submitH3PromptToBaseUrl: vi.fn(), getH3PromptHistoryFromBaseUrl: vi.fn() }));
const root = await fs.mkdtemp(path.join(os.tmpdir(), "slr-refmod-access-"));
vi.stubEnv("OTG_ENV", "test"); vi.stubEnv("OTG_EXPERIMENTS_ROOT", root); vi.stubEnv("OTG_DATA_DIR", path.join(root, "unrelated-data"));
const { GET, POST } = await import("@/app/api/experiments/refmod-replacement/route");
const { getSession, reserveAsset, finishAsset } = await import("@/lib/experiments/store");
const { assertReplacementAsset } = await import("@/lib/refmodLab/server");
const { REPLACEMENT_DEFAULTS } = await import("@/lib/refmodLab/contract");
const req = (action: unknown, origin = "http://test.local") => new NextRequest("http://test.local/api/experiments/refmod-replacement", { method: "POST", headers: { host: "test.local", origin, "Content-Type": "application/json" }, body: JSON.stringify(action) });
beforeEach(() => { auth.ok = true; auth.id = "admin-a"; auth.status = 401; });
afterAll(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
describe("Admin TEST-only replacement lab security", () => {
  it("denies unauthenticated result/file/graph reads before any external request", async () => {
    auth.ok = false;
    for (const query of ["", "?receipt=anything", "?file=anything&kind=source", "?file=anything&kind=graph"]) expect((await GET(new NextRequest("http://test.local/api/experiments/refmod-replacement" + query))).status).toBe(401);
  });
  it("denies ordinary signed-in users", async () => { auth.ok = false; auth.status = 403; expect((await POST(req({ action: "init" }))).status).toBe(403); });
  it("denies all access outside TEST even for an admin", async () => { vi.stubEnv("OTG_ENV", "prod"); expect((await POST(req({ action: "init" }))).status).toBe(404); vi.stubEnv("OTG_ENV", "test"); });
  it("blocks cross-origin mutation", async () => { expect((await POST(req({ action: "init" }, "http://attacker.local"))).status).toBe(403); });
  it("creates and reuses one private workspace, preserves saved inputs/settings", async () => {
    const first = await (await POST(req({ action: "init" }))).json(), second = await (await POST(req({ action: "init" }))).json();
    expect(first.workspace.session.id).toBe(second.workspace.session.id); expect(getSession("admin-a", first.workspace.session.id).experiment).toBe("refmod-replacement");
    expect((await POST(req({ action: "save", settings: { ...REPLACEMENT_DEFAULTS, prompt: "Keep the water." } }))).status).toBe(200);
    const saved = await (await POST(req({ action: "init" }))).json(); expect(saved.workspace.settings.prompt).toBe("Keep the water.");
    expect((await fs.stat(root)).mode & 0o077).toBe(0);
  });
  it("refuses another owner's assets and results", async () => {
    const a = await (await POST(req({ action: "init" }))).json(), session = a.workspace.session.id;
    const asset = reserveAsset("admin-a", session, "source.mp4", "video/mp4", "source"); await fs.writeFile(asset.file, "fixture"); finishAsset("admin-a", asset.id, 7, "a".repeat(64));
    expect(() => assertReplacementAsset("admin-b", asset.id, session, "video")).toThrow(/not found/);
    auth.id = "admin-b"; expect((await GET(new NextRequest("http://test.local/api/experiments/refmod-replacement?receipt=" + session))).status).toBe(404);
  });
});
