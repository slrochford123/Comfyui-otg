import { beforeEach, afterEach, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { nsfwEnabled, withNsfwWorkspace } from "@/lib/experiments/availability";
import { labRoot, createSession, requireTestLab } from "@/lib/experiments/store";
import { getNsfwAccess, requestNsfwAccess, setNsfwAccess } from "@/lib/experiments/nsfwAccess";
import { GET as testingGet } from "@/app/api/experiments/route";
import { GET as nsfwGet } from "@/app/api/h3/nsfw/route";
import { labCapabilities } from "@/lib/experiments/generation";

const auth = vi.hoisted(() => ({ id: "admin" }));
vi.mock("@/lib/auth/db", () => ({ ensureMigrations: () => {}, db: { prepare: () => ({ get: (id: string) => ["admin", "alice"].includes(id) ? { id } : undefined }) } }));
vi.mock("@/lib/auth/admin", () => ({ isAdminUserId: (id: string) => id === "admin" }));
vi.mock("@/app/api/admin/_requireAdmin", () => ({ requireAdmin: async () => ({ ok: true, id: "admin" }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => auth.id ? { value: "fixture" } : undefined }) }));
vi.mock("@/lib/auth/jwt", () => ({ verifySession: async () => ({ sub: auth.id }) }));
vi.mock("@/lib/auth/cookies", () => ({ cookieName: () => "session" }));
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "h3-prod-gates-"));
  vi.stubEnv("OTG_ENV", "prod"); vi.stubEnv("OTG_H3_NSFW_ENABLED", "1");
  vi.stubEnv("OTG_H3_NSFW_ROOT", path.join(root, "production"));
  vi.stubEnv("OTG_EXPERIMENTS_ROOT", path.join(root, "testing"));
  vi.stubEnv("OTG_DATA_DIR", path.join(root, "data")); auth.id = "admin";
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
const request = (route: string) => new NextRequest("https://app.test" + route);

it("enables only explicitly configured production NSFW; Testing stays 404 even for admins", async () => {
  expect(nsfwEnabled()).toBe(true);
  expect((await testingGet(request("/api/experiments"))).status).toBe(404);
  expect(() => requireTestLab()).toThrow("Not found");
  expect(() => labRoot()).toThrow("Not found");
  expect((await nsfwGet(request("/api/h3/nsfw"))).status).toBe(200);
  expect(fs.existsSync(path.join(root, "testing"))).toBe(false);
  expect(withNsfwWorkspace(() => labCapabilities()).map(c => c.model)).toHaveLength(4);
  expect(() => withNsfwWorkspace(() => createSession("admin", "pika-flex"))).toThrow("not available");
  vi.stubEnv("OTG_H3_NSFW_ENABLED", "0");
  expect((await nsfwGet(request("/api/h3/nsfw"))).status).toBe(404);
});
it("preserves production sign-in, default-off users, requests, grants and revocation", async () => {
  auth.id = ""; expect((await nsfwGet(request("/api/h3/nsfw"))).status).toBe(401);
  auth.id = "alice"; expect((await nsfwGet(request("/api/h3/nsfw"))).status).toBe(403);
  expect(getNsfwAccess("alice").enabled).toBe(false);
  expect(requestNsfwAccess("alice", true).status).toBe("pending");
  expect(setNsfwAccess("admin", "alice", true, 0).enabled).toBe(true);
  const catalog = await (await nsfwGet(request("/api/h3/nsfw"))).json();
  expect(catalog.environment).toBe("prod"); expect(catalog.catalog).toHaveLength(4);
  expect(setNsfwAccess("admin", "alice", false, 1).enabled).toBe(false);
  expect((await nsfwGet(request("/api/h3/nsfw"))).status).toBe(403);
  expect(getNsfwAccess("admin").enabled).toBe(true);
});
it("keeps asynchronous request scope isolated and refuses shared TEST storage", async () => {
  const [scoped, unscoped] = await Promise.all([
    withNsfwWorkspace(async () => { await Promise.resolve(); return labRoot(); }),
    Promise.resolve().then(() => { expect(() => labRoot()).toThrow("Not found"); return true; }),
  ]);
  expect(scoped).toBe(path.join(root, "production")); expect(unscoped).toBe(true);
  expect(() => labRoot()).toThrow("Not found");
  vi.stubEnv("OTG_H3_NSFW_ROOT", path.join(root, "testing"));
  expect(() => withNsfwWorkspace(() => labRoot())).toThrow("separate private storage");
});
