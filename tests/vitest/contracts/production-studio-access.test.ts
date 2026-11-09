import { afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
const auth = vi.hoisted(() => ({
  owner: "alice",
  signedIn: true,
  admin: false,
}));
vi.mock("@/lib/sessionUser", () => ({
  requireSessionUser: async () => {
    if (!auth.signedIn)
      throw Object.assign(new Error("Sign in first"), { status: 401 });
    return { ownerKey: auth.owner, admin: auth.admin };
  },
}));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-access-"));
vi.stubEnv("OTG_DATA_ROOT", root);
vi.stubEnv("OTG_DATA_DIR", root);
vi.stubEnv("OTG_ENV", "test");
const projects = await import("@/app/api/production-studio/projects/route"),
  project = await import("@/app/api/production-studio/projects/[id]/route"),
  availability = await import("@/app/api/production-studio/availability/route"),
  { studio } = await import("@/lib/productionStudio/server");
const req = (value: unknown, origin = "http://studio.local") =>
  new NextRequest("http://studio.local/api/production-studio/projects", {
    method: "POST",
    headers: {
      host: "studio.local",
      origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
beforeEach(() => {
  auth.owner = "alice";
  auth.signedIn = true;
  auth.admin = false;
  vi.stubEnv("OTG_ENV", "test");
});
afterAll(() => {
  studio().db.close();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
describe("Production studio security gates", () => {
  it("requires authentication", async () => {
    auth.signedIn = false;
    expect(
      (await projects.GET(new NextRequest("http://studio.local"))).status,
    ).toBe(401);
  });
  it("rejects cross-origin writes", async () => {
    expect(
      (await projects.POST(req({ name: "No" }, "http://other.local"))).status,
    ).toBe(403);
  });
  it("blocks studio reads and mutations on PROD", async () => {
    vi.stubEnv("OTG_ENV", "prod");
    expect(
      (await projects.GET(new NextRequest("http://studio.local"))).status,
    ).toBe(404);
    expect((await projects.POST(req({ name: "No" }))).status).toBe(404);
  });
  it("does not reveal another account's production", async () => {
    const p = await (await projects.POST(req({ name: "Private" }))).json();
    auth.owner = "bob";
    expect(
      (
        await project.GET(new NextRequest("http://studio.local"), {
          params: Promise.resolve({ id: p.project.id }),
        })
      ).status,
    ).toBe(404);
  });
  it("legacy recovery is admin-only and reversible", async () => {
    let r = await (
      await availability.GET(new NextRequest("http://studio.local"))
    ).json();
    expect(r.legacyAvailable).toBe(false);
    auth.admin = true;
    r = await (
      await availability.GET(new NextRequest("http://studio.local"))
    ).json();
    expect(r.legacyAvailable).toBe(true);
    vi.stubEnv("OTG_PRODUCTION_LEGACY_VISIBLE", "0");
    r = await (
      await availability.GET(new NextRequest("http://studio.local"))
    ).json();
    expect(r.legacyAvailable).toBe(false);
  });
});
