import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const source =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "app/app/components/ProductionV2Panel.tsx",
    ),
    "utf8",
  );

describe(
  "Production V2 storyboard UI",
  () => {
    it(
      "shows every production scene in the storyboard grid",
      () => {
        expect(
          source,
        ).toContain(
          "<SceneGrid scenes={production.scenes} activeSceneId={selectedScene.id}",
        );
      },
    );

    it(
      "uses model-aware quality copy",
      () => {
        expect(
          source,
        ).toContain(
          '"1.0 MP native (1376x768)" : "0.6 MP native (1056x608)"',
        );

        expect(
          source,
        ).toContain(
          "+ RTX VSR ULTRA",
        );

        expect(
          source,
        ).toContain(
          "LTX 2.5 Ingredients · qualified 5s / 10s workflow",
        );

        expect(
          source,
        ).not.toContain(
          "Native H3 1024x576 + RTX VSR ULTRA",
        );
      },
    );

    it(
      "explicitly identifies the qualified LTX 5-second generation path",
      () => {
        expect(
          source,
        ).toContain(
          "OTG_PRODUCTION_V2_STORYBOARD_UI_FINAL_V1",
        );

        expect(
          source,
        ).toContain(
          "LTX 2.5 Ingredients is ready for the qualified 5- or 10-second generation path.",
        );

        expect(
          source,
        ).not.toContain(
          '"LTX setup pending"',
        );
      },
    );

    it(
      "keeps the LTX generation submission guard until the real Ingredients adapter is qualified",
      () => {
        expect(
          source,
        ).toContain(
          'selectedScene.model !== "minimax-h3"',
        );
      },
    );

    it(
      "retains scene add and remove controls",
      () => {
        expect(
          source,
        ).toContain(
          ">+ Add Scene</button>",
        );

        expect(
          source,
        ).toContain(
          'data-otg="production-v2-remove-scene"',
        );
      },
    );
  },
);
