import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(
    path.join(root, relativePath),
    "utf8"
  );
}

describe(
  "Admin Full Gallery video delivery contract",
  () => {
    const route = read(
      "app/api/admin/gallery-thumbnail/route.ts"
    );

    const panel = read(
      "app/app/components/AdminGallerySourcesPanel.tsx"
    );

    const sources = read(
      "lib/adminGallerySources.ts"
    );

    it(
      "uses an authenticated cached FFmpeg thumbnail route",
      () => {
        expect(route).toContain("requireAdmin()");
        expect(route).toContain("ffmpeg");
        expect(route).toContain('"-frames:v"');
        expect(route).toContain(
          "MAX_CONCURRENT_THUMBNAILS = 2"
        );
        expect(route).toContain(
          "THUMBNAIL_CACHE_ROOT"
        );
        expect(route).toContain(
          'createHash("sha256")'
        );
        expect(route).toContain(
          '"Content-Type": "image/jpeg"'
        );
      }
    );

    it(
      "keeps remote credentials inside Node rather than FFmpeg argv",
      () => {
        expect(route).toContain(
          "fetchRemoteAdminGalleryFile"
        );
        expect(route).toContain(
          "Readable.fromWeb"
        );
        expect(route).toContain(
          "createWriteStream"
        );

        expect(route).not.toContain(
          "adminGalleryRemoteFileAccess"
        );

        expect(route).not.toContain(
          "`Authorization: ${authorization}"
        );

        expect(sources).not.toContain(
          "adminGalleryRemoteFileAccess"
        );
      }
    );

    it(
      "renders actual poster images for video cards",
      () => {
        expect(panel).toContain(
          "/api/admin/gallery-thumbnail"
        );

        expect(panel).toContain(
          "v: String(item.mtimeMs)"
        );

        expect(panel).toContain(
          "videoThumbnailUrl(item)"
        );
      }
    );

    it(
      "uses a browser download link instead of replacing the page",
      () => {
        expect(panel).toContain(
          "downloadAdminGalleryUrl(item)"
        );

        expect(panel).toContain(
          "download={item.name}"
        );

        expect(panel).not.toContain(
          "window.location.assign"
        );
      }
    );

    it(
      "keeps protected attachment delivery on gallery-file",
      () => {
        expect(panel).toContain(
          "download=1"
        );

        expect(sources).toContain(
          "/api/admin/gallery-file"
        );
      }
    );
  }
);
