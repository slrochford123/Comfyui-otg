import {
  describe,
  expect,
  it,
} from "vitest";

import {
  PRODUCTION_V2_MAX_SCENES,
  addProductionV2Scene,
  createProductionV2,
  normalizeProductionV2,
  switchProductionV2SceneModel,
  switchProductionV2SceneMode,
} from "@/lib/production/v2";

describe(
  "Production V2 scene normalization and isolation",
  () => {
    it(
      "normalizes persisted H3 and LTX durations to each model qualified set on load",
      () => {
        let production =
          createProductionV2(
            "Legacy Duration",
            "minimax-h3",
          );

        production =
          addProductionV2Scene(
            production,
            "ltx-2.5",
          );

        const raw =
          JSON.parse(
            JSON.stringify(production),
          ) as any;

        raw.scenes[0].model =
          "minimax-h3";

        raw.scenes[0].generationMode =
          "h3-image-to-video";

        raw.scenes[0].durationSeconds =
          15;

        raw.scenes[1].model =
          "ltx-2.5";

        raw.scenes[1].generationMode =
          "ltx-ingredients-image-to-video";

        raw.scenes[1].durationSeconds =
          15;

        const normalized =
          normalizeProductionV2(raw);

        expect(
          normalized.scenes[0].durationSeconds,
        ).toBe(
          10,
        );

        expect(
          normalized.scenes[1].durationSeconds,
        ).toBe(
          10,
        );
      },
    );

    it(
      "repairs a persisted generation mode that does not belong to the scene model",
      () => {
        let production =
          createProductionV2(
            "Mode Repair",
            "minimax-h3",
          );

        production =
          addProductionV2Scene(
            production,
            "ltx-2.5",
          );

        const raw =
          JSON.parse(
            JSON.stringify(production),
          ) as any;

        raw.scenes[0].model =
          "minimax-h3";

        raw.scenes[0].generationMode =
          "ltx-ingredients-image-to-video";

        raw.scenes[1].model =
          "ltx-2.5";

        raw.scenes[1].generationMode =
          "h3-reference-to-video";

        const normalized =
          normalizeProductionV2(raw);

        expect(
          normalized.scenes[0].generationMode,
        ).toBe(
          "h3-image-to-video",
        );

        expect(
          normalized.scenes[1].generationMode,
        ).toBe(
          "ltx-ingredients-image-to-video",
        );
      },
    );

    it(
      "creates scenes with independent mutable scene state",
      () => {
        let production =
          createProductionV2(
            "Scene Isolation",
            "minimax-h3",
          );

        production =
          addProductionV2Scene(
            production,
            "minimax-h3",
          );

        const first =
          production.scenes[0];

        const second =
          production.scenes[1];

        expect(
          first.promptStateByMode,
        ).not.toBe(
          second.promptStateByMode,
        );

        expect(
          first.promptStateByMode[
            "h3-image-to-video"
          ],
        ).not.toBe(
          second.promptStateByMode[
            "h3-image-to-video"
          ],
        );

        expect(
          first.modelState,
        ).not.toBe(
          second.modelState,
        );

        expect(
          first.modelState.h3,
        ).not.toBe(
          second.modelState.h3,
        );

        expect(
          first.modelState.ltx,
        ).not.toBe(
          second.modelState.ltx,
        );

        expect(
          first.promptOptions,
        ).not.toBe(
          second.promptOptions,
        );

        first.promptStateByMode[
          "h3-image-to-video"
        ].userPrompt =
          "Scene one only";

        expect(
          second.promptStateByMode[
            "h3-image-to-video"
          ].userPrompt,
        ).toBe(
          "",
        );
      },
    );

    it(
      "changing model, mode, and duration on one scene leaves the other scene unchanged",
      () => {
        let production =
          createProductionV2(
            "Per Scene Settings",
            "minimax-h3",
          );

        production =
          addProductionV2Scene(
            production,
            "minimax-h3",
          );

        const secondBefore =
          JSON.parse(
            JSON.stringify(
              production.scenes[1],
            ),
          );

        let first =
          switchProductionV2SceneModel(
            production.scenes[0],
            "ltx-2.5",
          );

        first =
          switchProductionV2SceneMode(
            first,
            "ltx-ingredients-image-to-video",
          );

        first = {
          ...first,
          durationSeconds: 10,
        };

        const next = {
          ...production,
          scenes: [
            first,
            production.scenes[1],
          ],
        };

        expect(
          next.scenes[0].model,
        ).toBe(
          "ltx-2.5",
        );

        expect(
          next.scenes[0].generationMode,
        ).toBe(
          "ltx-ingredients-image-to-video",
        );

        expect(
          next.scenes[0].durationSeconds,
        ).toBe(
          10,
        );

        expect(
          next.scenes[1],
        ).toEqual(
          secondBefore,
        );
      },
    );

    it(
      "makes a newly added scene active without modifying existing scene configuration",
      () => {
        const original =
          createProductionV2(
            "Add Scene",
            "minimax-h3",
          );

        const firstBefore =
          JSON.parse(
            JSON.stringify(
              original.scenes[0],
            ),
          );

        const next =
          addProductionV2Scene(
            original,
            "ltx-2.5",
          );

        expect(
          next.scenes,
        ).toHaveLength(
          2,
        );

        expect(
          next.activeSceneId,
        ).toBe(
          next.scenes[1].id,
        );

        expect(
          next.scenes[1].sceneNumber,
        ).toBe(
          2,
        );

        expect(
          next.scenes[1].model,
        ).toBe(
          "ltx-2.5",
        );

        expect(
          next.scenes[1].generationMode,
        ).toBe(
          "ltx-ingredients-image-to-video",
        );

        expect(
          next.scenes[1].durationSeconds,
        ).toBe(
          5,
        );

        expect(
          next.scenes[0],
        ).toEqual(
          firstBefore,
        );
      },
    );

    it(
      "enforces the eight-scene production cap",
      () => {
        let production =
          createProductionV2(
            "Eight Scenes",
            "minimax-h3",
          );

        while (
          production.scenes.length
          < PRODUCTION_V2_MAX_SCENES
        ) {
          production =
            addProductionV2Scene(
              production,
              "minimax-h3",
            );
        }

        expect(
          production.scenes,
        ).toHaveLength(
          8,
        );

        expect(
          () =>
            addProductionV2Scene(
              production,
              "minimax-h3",
            ),
        ).toThrow(
          "at most 8 scenes",
        );
      },
    );
  },
);
