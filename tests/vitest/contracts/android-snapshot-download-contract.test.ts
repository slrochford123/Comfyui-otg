import fs from "node:fs";
import path from "node:path";
import {
  describe,
  expect,
  it,
} from "vitest";

const root =
  process.cwd();

function read(
  relativePath: string,
) {
  return fs.readFileSync(
    path.join(
      root,
      relativePath,
    ),
    "utf8",
  );
}

describe(
  "Android Snapshot download contract",
  () => {
    it(
      "stages captured JPEGs through an authenticated HTTP endpoint instead of downloading the snapshot blob URL",
      () => {
        const picker =
          read(
            "app/app/components/VideoSnapshotPicker.tsx",
          );

        expect(
          picker,
        ).toContain(
          'fetch(\n      "/api/snapshot-download"',
        );

        expect(
          picker,
        ).toContain(
          'credentials: "include"',
        );

        expect(
          picker,
        ).toContain(
          "anchor.href =\n    downloadUrl",
        );

        expect(
          picker,
        ).toContain(
          "anchor.download =\n    file.name",
        );

        expect(
          picker,
        ).toContain(
          "Download started for",
        );
      },
    );

    it(
      "serves the temporary snapshot as an owner-scoped attachment",
      () => {
        const route =
          read(
            "app/api/snapshot-download/route.ts",
          );

        expect(
          route,
        ).toContain(
          "getOwnerContext",
        );

        expect(
          route,
        ).toContain(
          "getOwnerDirs",
        );

        expect(
          route,
        ).toContain(
          "safeJoin",
        );

        expect(
          route,
        ).toContain(
          '"image/jpeg"',
        );

        expect(
          route,
        ).toContain(
          '"Content-Disposition"',
        );

        expect(
          route,
        ).toContain(
          "attachment; filename=",
        );

        expect(
          route,
        ).toContain(
          "SNAPSHOT_TTL_MS",
        );

        expect(
          route,
        ).toContain(
          "MAX_SNAPSHOT_BYTES",
        );
      },
    );

    it(
      "matches the existing Android native HTTP DownloadManager path",
      () => {
        const activity =
          read(
            "android/app/src/main/java/com/slr/otg/MainActivity.java",
          );

        expect(
          activity,
        ).toContain(
          '"http".equalsIgnoreCase(scheme)',
        );

        expect(
          activity,
        ).toContain(
          '"https".equalsIgnoreCase(scheme)',
        );

        expect(
          activity,
        ).toContain(
          "new DownloadManager.Request(uri)",
        );

        expect(
          activity,
        ).toContain(
          "CookieManager.getInstance().getCookie(url)",
        );

        expect(
          activity,
        ).toContain(
          'request.addRequestHeader("Cookie", cookies)',
        );
      },
    );
  },
);
