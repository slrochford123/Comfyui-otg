import {
  describe,
  expect,
  it,
} from "vitest";

import {
  BACKGROUND_PRODUCTION_CANONICAL_ANGLE_KEYS_V36B,
} from "@/lib/backgrounds/store";

import {
  PRODUCTION_V2_BACKGROUND_CANONICAL_ANGLE_KEYS,
  createProductionV2,
  normalizeProductionV2,
} from "@/lib/production/v2";

function image(key: string) {
  return {
    displayImage:
      `/display/${key}.png`,
    workflowImage:
      `/workflow/${key}.png`,
  };
}

describe(
  "Production V2 Background six-view snapshot",
  () => {
    it(
      "matches the canonical Background production angle contract",
      () => {
        expect(
          PRODUCTION_V2_BACKGROUND_CANONICAL_ANGLE_KEYS,
        ).toEqual(
          BACKGROUND_PRODUCTION_CANONICAL_ANGLE_KEYS_V36B,
        );

        expect(
          PRODUCTION_V2_BACKGROUND_CANONICAL_ANGLE_KEYS,
        ).toEqual([
          "front",
          "back",
          "left90",
          "right90",
          "up",
          "down",
        ]);
      },
    );

    it(
      "preserves all six canonical Background plates during Production normalization",
      () => {
        const production =
          createProductionV2(
            "Six View Snapshot",
            "minimax-h3",
          );

        const raw =
          JSON.parse(
            JSON.stringify(production),
          ) as any;

        raw.scenes[0].selectedBackground = {
          backgroundId:
            "background-six-view",
          snapshotName:
            "Six View Background",
          masterImageRef:
            image("master"),
          angleImageRefs: {
            front: image("front"),
            back: image("back"),
            left90: image("left90"),
            right90: image("right90"),
            up: image("up"),
            down: image("down"),
          },
          identityDescription:
            "Keep the environment stable.",
        };

        const normalized =
          normalizeProductionV2(raw);

        const angles =
          normalized.scenes[0]
            .selectedBackground
            ?.angleImageRefs;

        expect(
          Object.keys(
            angles || {},
          ),
        ).toEqual([
          "front",
          "back",
          "left90",
          "right90",
          "up",
          "down",
        ]);

        expect(
          angles?.front?.workflowImage,
        ).toBe(
          "/workflow/front.png",
        );

        expect(
          angles?.down?.workflowImage,
        ).toBe(
          "/workflow/down.png",
        );
      },
    );

    it(
      "keeps legacy Background scene snapshots loadable",
      () => {
        const production =
          createProductionV2(
            "Legacy Background",
            "minimax-h3",
          );

        const raw =
          JSON.parse(
            JSON.stringify(production),
          ) as any;

        raw.scenes[0].selectedBackground = {
          backgroundId:
            "legacy-background",
          snapshotName:
            "Legacy Background",
          masterImageRef:
            image("master"),
          identityDescription:
            "Legacy scene.",
        };

        const normalized =
          normalizeProductionV2(raw);

        expect(
          normalized.scenes[0]
            .selectedBackground
            ?.angleImageRefs,
        ).toEqual(
          {},
        );
      },
    );

    it(
      "migrates a catalog-shaped perspectives array when encountered",
      () => {
        const production =
          createProductionV2(
            "Perspective Migration",
            "minimax-h3",
          );

        const raw =
          JSON.parse(
            JSON.stringify(production),
          ) as any;

        raw.scenes[0].selectedBackground = {
          backgroundId:
            "perspective-background",
          snapshotName:
            "Perspective Background",
          masterImageRef:
            image("master"),
          perspectives:
            PRODUCTION_V2_BACKGROUND_CANONICAL_ANGLE_KEYS.map(
              (key) => ({
                key,
                label: key,
                ...image(key),
              }),
            ),
          identityDescription:
            "Perspective migration.",
        };

        const normalized =
          normalizeProductionV2(raw);

        expect(
          Object.keys(
            normalized.scenes[0]
              .selectedBackground
              ?.angleImageRefs
              || {},
          ),
        ).toEqual([
          "front",
          "back",
          "left90",
          "right90",
          "up",
          "down",
        ]);
      },
    );
  },
);
