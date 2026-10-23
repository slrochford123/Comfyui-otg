import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listAdminGallery } from "@/lib/adminGallerySources";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("complete-library Admin Gallery paging", () => {
  it("filters and sorts before paging, not only within the loaded browser page", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "slr-gallery-paging-"));
    vi.stubEnv("OTG_ADMIN_GALLERY_3090_ROOT", root); vi.stubEnv("OTG_ADMIN_GALLERY_3090_URL", "");
    try {
      await Promise.all(["a.png", "b.mp4", "c.png", "d.mp4"].map(async name => fs.writeFile(path.join(root, name), "disposable metadata fixture")));
      const first = await listAdminGallery({ source: "comfy-3090", media: "image", sort: "name", limit: 1 });
      const next = await listAdminGallery({ source: "comfy-3090", media: "image", sort: "name", offset: 1, limit: 1 });
      expect(first.items.map(item => item.name)).toEqual(["a.png"]); expect(first.hasMore).toBe(true);
      expect(next.items.map(item => item.name)).toEqual(["c.png"]); expect(next.hasMore).toBe(false);
      expect((await listAdminGallery({ source: "comfy-3090", search: "d.mp4" })).items.map(item => item.name)).toEqual(["d.mp4"]);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it("remote filtering is authenticated and fails explicitly if an old agent ignores queries", async () => {
    vi.stubEnv("OTG_ADMIN_GALLERY_5060_URL", "http://example.invalid"); vi.stubEnv("OTG_ADMIN_GALLERY_5060_TOKEN", "synthetic-no-runtime-access");
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, items: [], count: 5000, hasMore: true }))); vi.stubGlobal("fetch", fetch);
    const result = await listAdminGallery({ source: "comfy-5060", search: "missing" });
    expect(result.ok).toBe(false); expect(result.statuses[0].error).toContain("agent update required");
    expect(fetch.mock.calls[0][0]).toContain("search=missing"); expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer synthetic-no-runtime-access");
  });
});
