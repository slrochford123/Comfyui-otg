import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
vi.mock("@/lib/ownerKey", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ownerKey")>("@/lib/ownerKey");
  return { ...actual, getOwnerContext: vi.fn(async () => { throw new actual.SessionInvalidError(); }) };
});
let credential = "";
beforeAll(() => {
  credential = randomBytes(32).toString("hex");
  vi.stubEnv("OTG_WORKER_TOKEN", credential);
  vi.stubEnv("OTG_WORKER_PREVIOUS_TOKEN_FILE", "");
});
afterAll(() => vi.unstubAllEnvs());
const request = (token = "", owner = "qa_card_owner") => new NextRequest("http://localhost/api/characters/upload", {
  method: "POST", headers: { "x-otg-owner-key": owner, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: new FormData(),
});
describe("Character completion upload keeps worker and browser identity separate", () => {
  it("rejects an anonymous forged owner header", async () => {
    const { POST } = await import("@/app/api/characters/upload/route");
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Unauthorized" });
  });
  it("rejects an invalid worker credential", async () => {
    const { POST } = await import("@/app/api/characters/upload/route");
    expect((await POST(request("invalid"))).status).toBe(401);
  });
  it.each(["", "../other_owner", "qa/other"])("rejects an unsafe worker owner %s", async owner => {
    const { POST } = await import("@/app/api/characters/upload/route");
    expect((await POST(request(credential, owner))).status).toBe(400);
  });
  it("allows a credentialed worker through to normal image validation", async () => {
    const { POST } = await import("@/app/api/characters/upload/route");
    const response = await POST(request(credential));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Missing image file" });
  });
});
