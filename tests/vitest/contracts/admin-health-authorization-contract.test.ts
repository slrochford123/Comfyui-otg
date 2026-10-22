import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("admin health endpoint authorization", () => {
  it("requires the shared server-side Admin guard before probing services", () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), "app/api/admin/health/services/route.ts"),
      "utf8",
    );

    expect(route).toContain('import { requireAdmin } from \'@/app/api/admin/_requireAdmin\';');
    expect(route).toContain("const admin = await requireAdmin();");
    expect(route).toContain("if (!admin.ok)");
    expect(route).toContain("return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status });");
  });
});
