import { describe, expect, it, vi } from "vitest";

describe("owner alias resolution", () => {
  it("maps a login username to an existing owner folder through OTG_OWNER_ALIASES", async () => {
    vi.resetModules();
    process.env.OTG_OWNER_ALIASES = "slrochford:slrochford12300";
    const { resolveOwnerAlias } = await import("@/lib/ownerAlias");
    expect(resolveOwnerAlias("slrochford")).toBe("slrochford12300");
    expect(resolveOwnerAlias("slrochford12300")).toBe("slrochford12300");
  });

  it("ignores unsafe owner alias entries", async () => {
    vi.resetModules();
    process.env.OTG_OWNER_ALIASES = "../bad:slrochford12300,slrochford:../bad";
    const { resolveOwnerAlias } = await import("@/lib/ownerAlias");
    expect(resolveOwnerAlias("slrochford")).toBe("slrochford");
    expect(resolveOwnerAlias("../bad")).toBe("");
  });
});
