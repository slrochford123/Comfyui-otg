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
  "H3 Android reference-video guards",
  () => {
    it(
      "keeps uploaded video previews inside a fixed app-card aspect box",
      () => {
        const panel =
          read(
            "app/app/components/H3Panel.tsx",
          );

        expect(
          panel,
        ).toContain(
          "relative aspect-video w-full min-w-0 overflow-hidden rounded-[6px] bg-black",
        );

        expect(
          panel,
        ).toContain(
          "absolute inset-0 h-full w-full max-w-full object-contain",
        );

        expect(
          panel,
        ).toContain(
          "min-w-0 overflow-hidden rounded-[6px] border border-white/10 bg-black/30 p-3",
        );
      },
    );

    it(
      "normalizes every H3 reference video to a fixed 5-second MP4 while allowing 20-minute sources",
      () => {
        const clipper =
          read(
            "lib/h3ReferenceVideoClip.ts",
          );

        expect(
          clipper,
        ).toContain(
          "H3_REFERENCE_VIDEO_MIN_CLIP_SECONDS = 5",
        );

        expect(
          clipper,
        ).toContain(
          "H3_REFERENCE_VIDEO_MAX_SOURCE_SECONDS = 20 * 60",
        );

        expect(
          clipper,
        ).toContain(
          "duration > H3_REFERENCE_VIDEO_MAX_SOURCE_SECONDS",
        );

        expect(
          clipper,
        ).toContain(
          "H3_REFERENCE_VIDEO_MAX_FPS = 24",
        );

        expect(
          clipper,
        ).toContain(
          "scale=min(",
        );

        expect(
          clipper,
        ).toContain(
          "force_original_aspect_ratio=decrease",
        );

        expect(
          clipper,
        ).toContain(
          "force_divisible_by=2",
        );

        expect(
          clipper,
        ).toContain(
          "format=yuv420p",
        );

        expect(
          clipper,
        ).toContain(
          "+faststart",
        );

        expect(
          clipper,
        ).toContain(
          "probeVideoInfo(\n      outputPath",
        );

        expect(
          clipper,
        ).toContain(
          "H3_REFERENCE_VIDEO_CLIP_SECONDS.toFixed(3)",
        );

        expect(
          clipper,
        ).toContain(
          "exceeded ${H3_REFERENCE_VIDEO_CLIP_SECONDS} seconds",
        );
      },
    );

    it(
      "sizes direct H3 reference-video clips to the selected H3 native generation bounds",
      () => {
        const route =
          read(
            "app/api/h3/generation/route.ts",
          );

        expect(
          route,
        ).toContain(
          "getH3NativeDimensions",
        );

        expect(
          route,
        ).toContain(
          "h3ReferenceVideoClipBounds",
        );

        expect(
          route,
        ).toContain(
          "maxWidth: dimensions.width",
        );

        expect(
          route,
        ).toContain(
          "maxHeight: dimensions.height",
        );

        expect(
          route,
        ).toContain(
          "maxWidth: videoClipBounds?.maxWidth",
        );

        expect(
          route,
        ).toContain(
          "maxHeight: videoClipBounds?.maxHeight",
        );
      },
    );
  },
);
