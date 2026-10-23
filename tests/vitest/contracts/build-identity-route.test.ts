import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), identity: vi.fn() }));
vi.mock("@/lib/sessionUser", () => ({ requireSessionUser: mocks.session }));
vi.mock("@/lib/buildIdentityServer", () => ({ readBuildIdentity: mocks.identity }));
import { GET } from "@/app/api/app/build/route";
beforeEach(() => { vi.resetAllMocks(); });
describe("authenticated Settings build identity", () => {
  it("denies anonymous access before reading release files", async () => {
    mocks.session.mockRejectedValue(Error("private auth detail"));
    const response = await GET(new NextRequest("http://localhost/api/app/build"));
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "Unauthorized" }); expect(mocks.identity).not.toHaveBeenCalled();
  });
  it("returns private non-cached release identity to a signed-in user", async () => {
    mocks.session.mockResolvedValue({ ownerKey: "owner" }); mocks.identity.mockReturnValue({ buildVersion: "2", commit: "a".repeat(40) });
    const response = await GET(new NextRequest("http://localhost/api/app/build"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect((await response.json()).buildVersion).toBe("2");
  });
});
