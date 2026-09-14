import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  LTX25_INGREDIENTS_MAX_VISUAL_REFERENCES,
  buildLtx25IngredientsLockedContext,
  buildLtx25IngredientsManifest,
} from "@/lib/production/ltx25IngredientsManifest";

import {
  composeLtx25IngredientsSheet,
} from "@/lib/production/ltx25IngredientsSheet";

import type {
  ProductionV2Scene,
} from "@/lib/production/v2";

function sceneWithPaths(
  input: {
    character: string;
    background: string;
    asset: string;
  },
) {
  return {
    model: "ltx-2.5",
    generationMode:
      "ltx-ingredients-image-to-video",

    selectedCharacters: [
      {
        characterId: "character-1",
        snapshotName: "Hero",
        characterCardRef: {
          workflowImage:
            input.character,
        },
        defaultImageRef: {
          workflowImage:
            input.character,
        },
        identityDescription:
          "Canonical Hero identity.",
        speaking: false,
        visible: true,
      },
    ],

    selectedBackground: {
      backgroundId:
        "background-1",
      snapshotName:
        "Courtyard",
      masterImageRef: {
        workflowImage:
          input.background,
      },
      angleImageRefs: {
        front: {
          workflowImage:
            "/background-front-decoy.png",
        },
      },
      referenceView: "front",
      identityDescription:
        "Canonical Courtyard geography.",
    },

    selectedAssets: [
      {
        assetId: "asset-1",
        snapshotName: "Case",
        defaultImageRef: {
          workflowImage:
            input.asset,
        },
        identityDescription:
          "Blue ridged hard case.",
      },
    ],

    modelState: {
      ltx: {
        lastMode:
          "ltx-ingredients-image-to-video",
        ingredients: {
          visualIngredientLimit:
            LTX25_INGREDIENTS_MAX_VISUAL_REFERENCES,
          sheetPreview: {
            status: "placeholder",
          },
        },
      },
      h3: {},
    },
  } as unknown as ProductionV2Scene;
}

/*
 * OTG_LTX_R13C_CHARACTER_CARD_CONTRACT_V1
 *
 * LTX Ingredients uses the complete saved Character Card.
 * Selector/default/directional Character images remain non-model-facing legacy/UI data.
 */
import {
  createProductionV2 as createProductionV2ForLtxCharacterViewContract,
} from "@/lib/production/v2";

import {
  buildLtx25IngredientsLockedContext as buildLtx25IngredientsLockedContextForCharacterViewContract,
  buildLtx25IngredientsManifest as buildLtx25IngredientsManifestForCharacterViewContract,
} from "@/lib/production/ltx25IngredientsManifest";

describe(
  "Production V2 LTX 2.5 Ingredients manifest and sheet",
  () => {
    it(
      "uses the complete saved Character Card and ignores selector/directional Character views",
      () => {
        const production =
          createProductionV2ForLtxCharacterViewContract(
            "LTX Character View Contract",
            "ltx-2.5",
          );

        const scene = {
          ...production.scenes[0],

          selectedCharacters: [
            {
              characterId:
                "character-crystal",

              snapshotName:
                "Crystal",

              defaultImageRef: {
                workflowImage:
                  "crystal-front.png",
              },

              /*
               * Authoritative model-facing Character Card. The selector and
               * directional images below are deliberate non-model-facing decoys.
               */
              characterCardRef: {
                workflowImage:
                  "crystal-composite-character-card.png",
              },

              ltxReferenceView:
                "left" as const,

              ltxViewImageRefs: {
                default: {
                  workflowImage:
                    "crystal-front.png",
                },

                left: {
                  workflowImage:
                    "crystal-left.png",
                },

                right: {
                  workflowImage:
                    "crystal-right.png",
                },

                back: {
                  workflowImage:
                    "crystal-back.png",
                },
              },

              identityDescription:
                "Character identity: Crystal.",

              speaking:
                false,

              visible:
                true,
            },
          ],
        };

        const built =
          buildLtx25IngredientsManifestForCharacterViewContract(
            scene,
          );

        expect(built.count)
          .toBe(1);

        expect(built.items[0])
          .toMatchObject({
            sourceKind:
              "character",

            generationSourceType:
              "character-card",

            sourceId:
              "character-crystal",

            name:
              "Crystal",

            sourcePath:
              "crystal-composite-character-card.png",

            perspectiveKey:
              "character-card",

            slot:
              1,

            positionLabel:
              "full sheet",
          });

        expect(
          JSON.stringify(built),
        ).toContain(
          "crystal-composite-character-card.png",
        );

        const locked =
          buildLtx25IngredientsLockedContextForCharacterViewContract(
            built,
          );

        expect(locked)
          .toContain(
            "complete saved Character Card",
          );

        expect(locked)
          .not.toContain(
            "canonical Character left view",
          );
      },
    );

    it(
      "rejects a missing Character Card instead of falling back to selector/default/directional images",
      () => {
        const production =
          createProductionV2ForLtxCharacterViewContract(
            "LTX Missing View Contract",
            "ltx-2.5",
          );

        const scene = {
          ...production.scenes[0],

          selectedCharacters: [
            {
              characterId:
                "character-shawn",

              snapshotName:
                "Shawn",

              defaultImageRef: {
                workflowImage:
                  "shawn-front.png",
              },

              /*
               * Deliberately unusable authoritative Character Card.
               * The valid selector/directional images below must not rescue it.
               */
              characterCardRef: {
                workflowImage:
                  "",
              },

              ltxReferenceView:
                "left" as const,

              ltxViewImageRefs: {
                default: {
                  workflowImage:
                    "shawn-front.png",
                },

                left: {
                  workflowImage:
                    "shawn-left.png",
                },
              },

              identityDescription:
                "Character identity: Shawn.",

              speaking:
                false,

              visible:
                true,
            },
          ],
        };

        expect(
          () =>
            buildLtx25IngredientsManifestForCharacterViewContract(
              scene,
            ),
        ).toThrow(
          /usable complete saved Character Card|No selector\/default\/directional fallback was used/i,
        );
      },
    );

    /*
     * OTG_LTX_R13C_CHARACTER_CARD_FIXTURE_V1
     *
     * Preserve the six-Ingredient hard limit under the
     * complete saved Character Card authority contract.
     */
    it(
      "hard-stops above six visual Ingredients",
      () => {
        const scene =
          sceneWithPaths({
            character:
              "/character-front.png",

            background:
              "/background-front.png",

            asset:
              "/asset-default.png",
          });

        scene.selectedCharacters = [
          ...scene.selectedCharacters,

          ...Array.from(
            {
              length:
                4,
            },

            (_, index) => ({
              ...scene
                .selectedCharacters[0],

              characterId:
                `extra-character-${index}`,

              snapshotName:
                `Extra ${index}`,
            }),
          ),
        ];

        expect(
          () =>
            buildLtx25IngredientsManifest(
              scene,
            ),
        ).toThrow(
          /at most 6 visual Ingredients/i,
        );
      },
    );

    it(
      "creates a deterministic 960x544 left-to-right PNG sheet",
      async () => {
        const root =
          await fsp.mkdtemp(
            path.join(
              os.tmpdir(),
              "otg-ltx25-sheet-",
            ),
          );

        const character =
          path.join(
            root,
            "character.png",
          );

        const background =
          path.join(
            root,
            "background.png",
          );

        const asset =
          path.join(
            root,
            "asset.png",
          );

        await sharp({
          create: {
            width: 240,
            height: 400,
            channels: 3,
            background: {
              r: 180,
              g: 20,
              b: 20,
            },
          },
        })
          .png()
          .toFile(character);

        await sharp({
          create: {
            width: 240,
            height: 400,
            channels: 3,
            background: {
              r: 20,
              g: 180,
              b: 20,
            },
          },
        })
          .png()
          .toFile(background);

        await sharp({
          create: {
            width: 240,
            height: 400,
            channels: 3,
            background: {
              r: 20,
              g: 20,
              b: 180,
            },
          },
        })
          .png()
          .toFile(asset);

        const manifest =
          buildLtx25IngredientsManifest(
            sceneWithPaths({
              character,
              background,
              asset,
            }),
          );

        const first =
          await composeLtx25IngredientsSheet(
            {
              manifest,
              outputPath:
                path.join(
                  root,
                  "first.png",
                ),
            },
          );

        const second =
          await composeLtx25IngredientsSheet(
            {
              manifest,
              outputPath:
                path.join(
                  root,
                  "second.png",
                ),
            },
          );

        expect(first.width)
          .toBe(960);

        expect(first.height)
          .toBe(544);

        expect(first.count)
          .toBe(3);

        expect(first.order)
          .toBe("left-to-right");

        expect(first.sha256)
          .toBe(second.sha256);

        expect(
          first.resolvedSources,
        ).toHaveLength(3);

        const metadata =
          await sharp(
            first.outputPath,
          ).metadata();

        expect(metadata.width)
          .toBe(960);

        expect(metadata.height)
          .toBe(544);

        await fsp.rm(
          root,
          {
            recursive: true,
            force: true,
          },
        );
      },
    );
  },
);
