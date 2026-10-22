import { describe, expect, it } from "vitest";
import { LTX_STUDIOS_CATALOG, validateLtxStudiosCatalog } from "@/lib/ltxStudiosCatalog";

describe("LTX Studios catalog", () => {
  it("keeps the requested 14-entry additive catalog stable", () => {
    expect(() => validateLtxStudiosCatalog()).not.toThrow();
    expect(LTX_STUDIOS_CATALOG).toHaveLength(14);
    expect(new Set(LTX_STUDIOS_CATALOG.map((entry) => entry.id)).size).toBe(14);
    expect(LTX_STUDIOS_CATALOG.every((entry) => entry.compatibility.includes("LTX 2.5"))).toBe(true);
    expect(LTX_STUDIOS_CATALOG.every((entry) => entry.status === "needs-workflow")).toBe(true);
  });
});
