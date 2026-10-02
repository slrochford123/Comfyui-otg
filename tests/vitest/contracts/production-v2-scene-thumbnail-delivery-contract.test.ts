import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Production V2 saved-scene thumbnail delivery", () => {
  it("renders an authenticated poster URL on generated scene cards", () => {
    const panel = read("app/app/components/ProductionV2Panel.tsx");
    expect(panel).toContain("function productionV2PosterUrl");
    expect(panel).toContain('`${preview}${separator}thumbnail=1`');
    expect(panel).toContain("poster={poster || undefined}");
  });

  it("supports cached thumbnails on both owner-scoped media routes", () => {
    for (const routePath of [
      "app/api/production/v2/generation/media/route.ts",
      "app/api/production/v2/media/route.ts",
    ]) {
      const route = read(routePath);
      expect(route).toContain('req.nextUrl.searchParams.get("thumbnail") === "1"');
      expect(route).toContain("videoThumbnailResponse(req, resolved");
      expect(route.indexOf("getOwnerContext(req)")).toBeLessThan(
        route.indexOf("videoThumbnailResponse(req, resolved"),
      );
    }
  });

  it("keys cached WebP frames to the source file version", () => {
    const helper = read("lib/videoThumbnail.ts");
    expect(helper).toContain("stat.mtimeMs");
    expect(helper).toContain("stat.size");
    expect(helper).toContain('"scale=768:-2:flags=lanczos"');
    expect(helper).toContain('contentType: "image/webp"');
    expect(helper).toContain("crypto.randomUUID()");
    expect(helper).toContain("fs.renameSync(temporaryPath, thumbnailPath)");
  });
});
