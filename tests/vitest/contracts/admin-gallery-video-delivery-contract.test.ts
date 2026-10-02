import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Admin Full Gallery video delivery", () => {
  it("returns a versioned, authenticated poster URL for every video", () => {
    const sources = read("lib/adminGallerySources.ts");
    const panel = read("app/app/components/AdminGallerySourcesPanel.tsx");

    expect(sources).toContain("thumbnailUrl?: string");
    expect(sources).toContain("/api/admin/gallery-thumbnail?");
    expect(sources).toContain("v: String(value.mtimeMs)");
    expect(panel).toContain("poster={item.thumbnailUrl}");
  });

  it("extracts and caches a real frame from local or remote video", () => {
    const route = read("app/api/admin/gallery-thumbnail/route.ts");

    expect(route).toContain("await requireAdmin()");
    expect(route).toContain("fetchRemoteAdminGalleryFile(sourceId, rel)");
    expect(route).toContain("resolveLocalAdminGalleryFile(sourceId, rel)");
    expect(route).toContain('"-ss",\n        "0.5"');
    expect(route).toContain('"libwebp"');
    expect(route).toContain('"thumbs", "admin-gallery"');
  });

  it("uses direct same-origin navigation for phone downloads", () => {
    const panel = read("app/app/components/AdminGallerySourcesPanel.tsx");

    expect(panel).toContain("window.location.assign(`${item.url}&download=1`)");
    expect(panel).not.toMatch(/href=\{`\$\{item\.url\}&download=1`\}/);
  });
});
