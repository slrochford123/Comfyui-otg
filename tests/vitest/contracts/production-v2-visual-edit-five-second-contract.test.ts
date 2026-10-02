import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const root =
  process.cwd();

const read =
  (file: string) =>
    fs.readFileSync(
      path.join(
        root,
        file,
      ),
      "utf8",
    );

describe(
  "Production V2 Visual Studios five-second edit",
  () => {
    it(
      "advertises the automatic five-second excerpt",
      () => {
        const panel =
          read(
            "app/app/components/ProductionV2Panel.tsx",
          );

        expect(
          panel,
        ).toContain(
          "The first five seconds are cut automatically and sent to H3 for editing.",
        );

        expect(
          panel,
        ).toContain(
          "Render 5-Second Edit",
        );
      },
    );

    it(
      "prepares and verifies a server-owned five-second source clip",
      () => {
        const route =
          read(
            "app/api/production/v2/generation/route.ts",
          );

        expect(
          route,
        ).toContain(
          "prepareH3VisualEditReferenceClip",
        );

        expect(
          route,
        ).toContain(
          "buildH3ReferenceVideoTrimCommand",
        );

        expect(
          route,
        ).toContain(
          "requestedStartSeconds: 0",
        );

        expect(
          route,
        ).toContain(
          "The prepared H3 reference clip is not five seconds long.",
        );
      },
    );

    it(
      "locks the H3 edit duration and video reference to the prepared clip",
      () => {
        const route =
          read(
            "app/api/production/v2/generation/route.ts",
          );

        expect(
          route,
        ).toContain(
          "durationSeconds: fiveSecondClip.durationSeconds",
        );

        expect(
          route,
        ).toContain(
          "mediaPath: fiveSecondClip.outputPath",
        );

        expect(
          route,
        ).not.toContain(
          "durationSeconds: scene.durationSeconds,\n          h3Quality: scene.h3Quality,\n          seed: seed(),\n          startImage: null",
        );
      },
    );
  },
);
