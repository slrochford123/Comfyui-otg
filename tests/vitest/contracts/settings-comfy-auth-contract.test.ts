import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("Settings Comfy status authorization", () => {
  it("probes the displayed video lane rather than silently defaulting to the image lane", () => {
    const client = read("app/app/AppPageClient.tsx");
    expect(client.match(/fetch\("\/api\/comfy-status\?mode=video"/g)).toHaveLength(2);
    expect(read("app/api/comfy-status/route.ts")).toContain("signal: AbortSignal.timeout(5000)");
  });
  it("requires an authenticated session before probing internal GPU backends", () => {
    const route = read("app/api/comfy-status/route.ts");
    expect(route).toContain('import { cookieName } from "@/lib/auth/cookies";');
    expect(route).toContain('import { verifySession } from "@/lib/auth/jwt";');
    expect(route).toContain("req.cookies.get(cookieName())?.value");
    expect(route).toContain("await verifySession(token)");
    expect(route).toContain('Response.json({ ok: false, error: "Unauthorized" }, { status: 401 })');
  });
});
