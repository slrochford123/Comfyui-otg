import {
  describe,
  expect,
  it,
} from "vitest";

import {
  addProductionV2Scene,
  assertProductionV2,
  createProductionV2,
  normalizeProductionV2,
  removeProductionV2Scene,
} from "@/lib/production/v2";

describe(
  "Production V2 scene removal",
  () => {
    it(
      "does not allow the only scene to be removed",
      () => {
        const production =
          createProductionV2(
            "Minimum Scene",
            "minimax-h3",
          );

        expect(
          () =>
            removeProductionV2Scene(
              production,
              production.scenes[0].id,
            ),
        ).toThrow(
          "at least one scene",
        );
      },
    );

    it(
      "removes an active middle scene and selects the next survivor",
      () => {
        let production =
          createProductionV2(
            "Middle Removal",
            "minimax-h3",
          );

        production =
          addProductionV2Scene(
            production,
            "ltx-2.5",
          );

        production =
          addProductionV2Scene(
            production,
            "minimax-h3",
          );

        const removedId =
          production.scenes[1].id;

        const expectedActiveId =
          production.scenes[2].id;

        production = {
          ...production,
          activeSceneId: removedId,
        };

        const next =
          removeProductionV2Scene(
            production,
            removedId,
          );

        expect(
          next.scenes.map(
            (scene) => scene.sceneNumber,
          ),
        ).toEqual([
          1,
          2,
        ]);

        expect(
          next.activeSceneId,
        ).toBe(
          expectedActiveId,
        );

        expect(
          next.scenes.some(
            (scene) => scene.id === removedId,
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "removes the active final scene and falls back to the previous survivor",
      () => {
        let production =
          createProductionV2(
            "Last Removal",
            "minimax-h3",
          );

        production =
          addProductionV2Scene(
            production,
            "minimax-h3",
          );

        production =
          addProductionV2Scene(
            production,
            "ltx-2.5",
          );

        const removed =
          production.scenes[2];

        const previous =
          production.scenes[1];

        const next =
          removeProductionV2Scene(
            production,
            removed.id,
          );

        expect(
          next.activeSceneId,
        ).toBe(
          previous.id,
        );

        expect(
          next.scenes.map(
            (scene) => scene.sceneNumber,
          ),
        ).toEqual([
          1,
          2,
        ]);
      },
    );

    it(
      "preserves the active scene when a different scene is removed",
      () => {
        let production =
          createProductionV2(
            "Non Active Removal",
            "minimax-h3",
          );

        production =
          addProductionV2Scene(
            production,
            "ltx-2.5",
          );

        production =
          addProductionV2Scene(
            production,
            "minimax-h3",
          );

        const activeId =
          production.scenes[0].id;

        production = {
          ...production,
          activeSceneId: activeId,
        };

        const next =
          removeProductionV2Scene(
            production,
            production.scenes[1].id,
          );

        expect(
          next.activeSceneId,
        ).toBe(
          activeId,
        );
      },
    );

    it(
      "preserves surviving scene state and adds the next scene with a contiguous number",
      () => {
        let production =
          createProductionV2(
            "Remove Then Add",
            "minimax-h3",
          );

        production.scenes[0]
          .promptStateByMode[
            "h3-image-to-video"
          ]
          .userPrompt =
            "Keep this scene state";

        production =
          addProductionV2Scene(
            production,
            "ltx-2.5",
          );

        production =
          addProductionV2Scene(
            production,
            "minimax-h3",
          );

        const firstId =
          production.scenes[0].id;

        production =
          removeProductionV2Scene(
            production,
            production.scenes[1].id,
          );

        expect(
          production.scenes[0].id,
        ).toBe(
          firstId,
        );

        expect(
          production.scenes[0]
            .promptStateByMode[
              "h3-image-to-video"
            ]
            .userPrompt,
        ).toBe(
          "Keep this scene state",
        );

        production =
          addProductionV2Scene(
            production,
            "ltx-2.5",
          );

        expect(
          production.scenes.map(
            (scene) => scene.sceneNumber,
          ),
        ).toEqual([
          1,
          2,
          3,
        ]);
      },
    );

    it(
      "repairs a missing active scene id during normalization",
      () => {
        const production =
          createProductionV2(
            "Active Repair",
            "minimax-h3",
          );

        const normalized =
          normalizeProductionV2({
            ...production,
            activeSceneId:
              "missing-scene-id",
          });

        expect(
          normalized.activeSceneId,
        ).toBe(
          normalized.scenes[0].id,
        );
      },
    );

    it(
      "rejects 15 seconds as a live Production V2 scene duration",
      () => {
        const production =
          createProductionV2(
            "Runtime Duration",
            "ltx-2.5",
          );

        production.scenes[0]
          .durationSeconds =
            15;

        expect(
          () =>
            assertProductionV2(
              production,
            ),
        ).toThrow(
          "LTX 2.5 scene duration must be exactly 5 or 10 seconds.",
        );
      },
    );
  },
);
