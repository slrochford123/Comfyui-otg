import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  LTX25_VISION_MAX_DIMENSION,
  LTX25_VISION_MAX_IMAGE_BYTES,
  LTX25_VISION_MAX_TOTAL_BYTES,
  prepareLtx25VisionImages,
} from "@/lib/production/ltx25VisionPrompt";

const root =
  process.cwd();

const promptRoute =
  fs.readFileSync(
    path.join(
      root,
      "app/api/production/v2/prompt/route.ts",
    ),
    "utf8",
  );

const promptBuilder =
  fs.readFileSync(
    path.join(
      root,
      "lib/production/promptBuilder.ts",
    ),
    "utf8",
  );

const promptOperations =
  fs.readFileSync(
    path.join(
      root,
      "lib/production/v2PromptOperations.ts",
    ),
    "utf8",
  );

const visionHelper =
  fs.readFileSync(
    path.join(
      root,
      "lib/production/ltx25VisionPrompt.ts",
    ),
    "utf8",
  );

const manifestSource =
  fs.readFileSync(
    path.join(
      root,
      "lib/production/ltx25IngredientsManifest.ts",
    ),
    "utf8",
  );

const tempRoots:
  string[] =
  [];

afterEach(
  () => {
    for (
      const tempRoot
      of tempRoots.splice(
        0,
      )
    ) {
      fs.rmSync(
        tempRoot,
        {
          recursive:
            true,

          force:
            true,
        },
      );
    }
  },
);

describe(
  "Production V2 LTX 2.5 vision-Qwen prompt pipeline",
  () => {
    it(
      "accepts qualified LTX Ingredients scenes while preserving the existing H3 prompt API path",
      () => {
        expect(
          promptRoute,
        ).toContain(
          "OTG_PRODUCTION_V2_LTX_PROMPT_API_V1",
        );

        expect(
          promptRoute,
        ).toMatch(
          /scene\.model\s*===\s*"minimax-h3"/,
        );

        expect(
          promptRoute,
        ).toMatch(
          /scene\.model\s*===\s*"ltx-2\.5"[\s\S]{0,180}scene\.generationMode\s*===\s*"ltx-ingredients-image-to-video"/,
        );

        expect(
          promptRoute,
        ).toContain(
          "buildLtx25IngredientsManifest",
        );

        expect(
          promptRoute,
        ).toContain(
          "enqueueProductionV2PromptOperation",
        );
      },
    );

    it(
      "keeps H3 Reference-to-Video resolution explicitly H3-only",
      () => {
        expect(
          promptRoute,
        ).toMatch(
          /scene\.model\s*===\s*"minimax-h3"[\s\S]{0,120}scene\.generationMode\s*===\s*"h3-reference-to-video"[\s\S]{0,120}resolveProductionV2H3ReferencePlan/,
        );

        expect(
          promptRoute,
        ).not.toContain(
          "The local H3 prompt builder only accepts MiniMax H3 scenes.",
        );
      },
    );

    it(
      "uses a dedicated LTX model setting and restricts LTX vision-Qwen to shawn while retaining H3 slr-to-shawn routing",
      () => {
        expect(
          promptOperations,
        ).toContain(
          "OTG_PRODUCTION_V2_LTX_DURABLE_QWEN_V1",
        );

        expect(
          promptOperations,
        ).toContain(
          "process.env.PRODUCTION_V2_LTX_OLLAMA_MODEL",
        );

        expect(
          promptOperations,
        ).toMatch(
          /PRODUCTION_V2_LTX_OLLAMA_MODEL[\s\S]{0,140}\|\|\s*"qwen3\.5:4b"/,
        );

        expect(
          promptOperations,
        ).toMatch(
          /allowedNodes:[\s\S]{0,100}isLtx[\s\S]{0,100}"shawn"/,
        );

        expect(
          promptOperations,
        ).toMatch(
          /isLtx[\s\S]{0,220}"slr"[\s\S]{0,80}"shawn"/,
        );

        expect(
          promptOperations,
        ).toContain(
          "PRODUCTION_V2_OLLAMA_FALLBACK_MODEL",
        );
      },
    );

    it(
      "keeps durable deterministic enhancement and repair child identities",
      () => {
        expect(
          promptOperations,
        ).toContain(
          "function childJobId",
        );

        expect(
          promptOperations,
        ).toContain(
          "`qwen_${operationId}_${stage}`",
        );

        expect(
          promptOperations,
        ).toContain(
          '"enhancement"',
        );

        expect(
          promptOperations,
        ).toContain(
          '"repair"',
        );

        expect(
          promptOperations,
        ).toContain(
          "ensureQwenDurableJob",
        );

        expect(
          promptOperations,
        ).toContain(
          "await childInput(",
        );
      },
    );

    it(
      "places optional manifest-ordered vision images on the Ollama user message without direct network inference",
      () => {
        expect(
          promptOperations,
        ).toContain(
          "prepareLtx25VisionPrompt",
        );

        expect(
          promptOperations,
        ).toContain(
          "images:",
        );

        expect(
          promptOperations,
        ).toContain(
          "...images",
        );

        expect(
          promptOperations,
        ).not.toContain(
          "fetch(",
        );

        expect(
          promptOperations,
        ).not.toContain(
          "axios",
        );

        expect(
          promptOperations,
        ).toContain(
          '"/api/chat" as const',
        );
      },
    );

    it(
      "prepares bounded local images in exact manifest slot order",
      async () => {
        const tempRoot =
          fs.mkdtempSync(
            path.join(
              os.tmpdir(),
              "otg-ltx-c2b-vision-",
            ),
          );

        tempRoots.push(
          tempRoot,
        );

        const firstPath =
          path.join(
            tempRoot,
            "first.png",
          );

        const secondPath =
          path.join(
            tempRoot,
            "second.png",
          );

        await sharp({
          create: {
            width:
              1800,

            height:
              1200,

            channels:
              3,

            background: {
              r:
                210,

              g:
                90,

              b:
                70,
            },
          },
        })
          .png()
          .toFile(
            firstPath,
          );

        await sharp({
          create: {
            width:
              1500,

            height:
              1100,

            channels:
              3,

            background: {
              r:
                70,

              g:
                100,

              b:
                210,
            },
          },
        })
          .png()
          .toFile(
            secondPath,
          );

        const resolutionOrder:
          string[] =
          [];

        const resolved:
          Record<string, string> = {
            "first.png":
              firstPath,

            "second.png":
              secondPath,
          };

        const result =
          await prepareLtx25VisionImages(
            {
              version:
                "ltx25-ingredients-manifest-v2-character-view",

              model:
                "ltx-2.5",

              mode:
                "ltx-ingredients-image-to-video",

              count:
                2,

              limit:
                6,

              order:
                "left-to-right",

              items: [
                {
                  slot:
                    1,

                  positionLabel:
                    "left",

                  sourceKind:
                    "character",

                  generationSourceType:
                    "character-card",

                  sourceId:
                    "character-crystal",

                  name:
                    "Crystal",

                  sourcePath:
                    "first.png",

                  identityDescription:
                    "Crystal saved identity metadata.",

                  perspectiveKey:
                    "character-card",
                },
                {
                  slot:
                    2,

                  positionLabel:
                    "right",

                  sourceKind:
                    "character",

                  generationSourceType:
                    "character-card",

                  sourceId:
                    "character-shawn",

                  name:
                    "Shawn",

                  sourcePath:
                    "second.png",

                  identityDescription:
                    "Shawn saved identity metadata.",

                  perspectiveKey:
                    "character-card",
                },
              ],
            },
            {
              resolveSourcePath:
                (value) => {
                  const sourcePath =
                    String(
                      value,
                    );

                  resolutionOrder.push(
                    sourcePath,
                  );

                  return resolved[
                    sourcePath
                  ] || "";
                },
            },
          );

        expect(
          resolutionOrder,
        ).toEqual(
          [
            "first.png",
            "second.png",
          ],
        );

        expect(
          result.prepared.map(
            (item) =>
              item.slot,
          ),
        ).toEqual(
          [
            1,
            2,
          ],
        );

        expect(
          result.prepared.map(
            (item) =>
              item.name,
          ),
        ).toEqual(
          [
            "Crystal",
            "Shawn",
          ],
        );

        expect(
          result.images,
        ).toHaveLength(
          2,
        );

        expect(
          result.totalBytes,
        ).toBeLessThanOrEqual(
          LTX25_VISION_MAX_TOTAL_BYTES,
        );

        for (
          const item
          of result.prepared
        ) {
          expect(
            Math.max(
              item.width || 0,
              item.height || 0,
            ),
          ).toBeLessThanOrEqual(
            LTX25_VISION_MAX_DIMENSION,
          );

          expect(
            item.bytes,
          ).toBeLessThanOrEqual(
            LTX25_VISION_MAX_IMAGE_BYTES,
          );

          expect(
            item.base64.length,
          ).toBeGreaterThan(
            0,
          );
        }
      },
    );

    it(
      "rejects remote Ingredient URLs before local resolution",
      async () => {
        let resolverCalled =
          false;

        await expect(
          prepareLtx25VisionImages(
            {
              version:
                "ltx25-ingredients-manifest-v2-character-view",

              model:
                "ltx-2.5",

              mode:
                "ltx-ingredients-image-to-video",

              count:
                1,

              limit:
                6,

              order:
                "left-to-right",

              items: [
                {
                  slot:
                    1,

                  positionLabel:
                    "full sheet",

                  sourceKind:
                    "character",

                  generationSourceType:
                    "character-card",

                  sourceId:
                    "character-crystal",

                  name:
                    "Crystal",

                  sourcePath:
                    "https://example.com/crystal.png",

                  identityDescription:
                    "",

                  perspectiveKey:
                    "character-card",
                },
              ],
            },
            {
              resolveSourcePath:
                () => {
                  resolverCalled =
                    true;

                  return "";
                },
            },
          ),
        ).rejects.toThrow(
          /Remote URLs and data URLs/,
        );

        expect(
          resolverCalled,
        ).toBe(
          false,
        );
      },
    );

    it(
      "uses authoritative Character Card Ingredients and rejects legacy Character-view model inputs",
      () => {
        expect(
          manifestSource,
        ).toContain(
          '"character-card"',
        );

        expect(
          manifestSource,
        ).toContain(
          "character.characterCardRef",
        );

        expect(
          manifestSource,
        ).toContain(
          "No selector/default/directional fallback was used.",
        );

        expect(
          manifestSource,
        ).not.toContain(
          "productionV2LtxCharacterReferenceImage",
        );

        expect(
          visionHelper,
        ).toContain(
          "authoritative Character Card",
        );

        expect(
          visionHelper,
        ).toContain(
          '!== "character-card"',
        );
      },
    );

    it(
      "defines the LTX vision instruction as a duration-aware short cinematic paragraph contract",
      () => {
        expect(
          visionHelper,
        ).toContain(
          "AUTHORITATIVE IMAGE MAPPING:",
        );

        expect(
          visionHelper,
        ).toContain(
          "Never infer or invent real-world identity.",
        );

        expect(
          visionHelper,
        ).toContain(
          "sensitive attributes",
        );

        expect(
          visionHelper,
        ).toContain(
          "Preserve every selected Ingredient in one unified cinematic scene.",
        );

        expect(
          visionHelper,
        ).toContain(
          "scene.durationSeconds === 10",
        );

        expect(
          visionHelper,
        ).toContain(
          "This is a 5-second Scene.",
        );

        expect(
          visionHelper,
        ).toContain(
          "This is a 10-second Scene.",
        );

        expect(
          visionHelper,
        ).toContain(
          "150 words or fewer",
        );

        expect(
          visionHelper,
        ).toContain(
          "Return ONLY the final Scene Prompt paragraph.",
        );

        expect(
          visionHelper,
        ).toContain(
          "buildLtx25VisionRepairInstruction",
        );
      },
    );

    it(
      "uses the enhanced input.scenePrompt in the LTX builder and excludes the old H3-style boilerplate",
      () => {
        const start =
          promptBuilder.indexOf(
            "export function buildLtxIngredientsPrompt",
          );

        const end =
          promptBuilder.indexOf(
            "export function buildProductionPrompt",
            start,
          );

        expect(
          start,
        ).toBeGreaterThanOrEqual(
          0,
        );

        expect(
          end,
        ).toBeGreaterThan(
          start,
        );

        const ltxBuilder =
          promptBuilder.slice(
            start,
            end,
          );

        expect(
          ltxBuilder,
        ).toContain(
          "input.scenePrompt",
        );

        expect(
          ltxBuilder,
        ).toContain(
          "composeProductionV2FinalPrompt",
        );

        expect(
          ltxBuilder,
        ).not.toContain(
          "USER SCENE DESCRIPTION:",
        );

        expect(
          ltxBuilder,
        ).not.toContain(
          "CAMERA AND FLOW:",
        );

        expect(
          ltxBuilder,
        ).not.toContain(
          "FINAL TEMPORAL QUALITY:",
        );

        expect(
          ltxBuilder,
        ).not.toContain(
          "Multiple cinematic shots",
        );

        expect(
          ltxBuilder,
        ).not.toContain(
          "768P",
        );
      },
    );

    it(
      "uses model-aware LTX paragraph validation without changing the existing H3 validator",
      () => {
        expect(
          promptBuilder,
        ).toContain(
          "OTG_PRODUCTION_V2_LTX_VISION_PROMPT_VALIDATION_V1",
        );

        expect(
          promptBuilder,
        ).toContain(
          "validateProductionV2LtxScenePrompt",
        );

        expect(
          promptBuilder,
        ).toContain(
          "validateProductionV2ScenePromptForModel",
        );

        const ltxStart =
          promptBuilder.indexOf(
            "export function validateProductionV2LtxScenePrompt",
          );

        const ltxEnd =
          promptBuilder.indexOf(
            "export function validateProductionV2ScenePromptForModel",
            ltxStart,
          );

        const ltxValidator =
          promptBuilder.slice(
            ltxStart,
            ltxEnd,
          );

        expect(
          ltxValidator,
        ).toContain(
          "150 words or fewer",
        );

        expect(
          ltxValidator,
        ).not.toContain(
          "PRODUCTION_V2_SCENE_PROMPT_SECTIONS",
        );

        expect(
          ltxValidator,
        ).not.toContain(
          "productionV2ShotTimeline",
        );

        expect(
          promptBuilder,
        ).toContain(
          "export function validateProductionV2ScenePrompt(",
        );

        expect(
          promptBuilder,
        ).toContain(
          "export function buildH3T2VPrompt",
        );

        expect(
          promptBuilder,
        ).toContain(
          "export function buildH3I2VPrompt",
        );

        expect(
          promptBuilder,
        ).toContain(
          "export function buildH3Ref2VPrompt",
        );
      },
    );

    it(
      "keeps final composition as locked reference context plus the validated enhanced Scene Prompt",
      () => {
        const start =
          promptBuilder.indexOf(
            "export function buildLtxIngredientsPrompt",
          );

        const end =
          promptBuilder.indexOf(
            "export function buildProductionPrompt",
            start,
          );

        const ltxBuilder =
          promptBuilder.slice(
            start,
            end,
          );

        expect(
          ltxBuilder,
        ).toMatch(
          /composeProductionV2FinalPrompt\(\s*lockedReferenceContext,\s*scenePrompt,\s*\)/,
        );

        expect(
          ltxBuilder,
        ).toContain(
          "lockedReferenceContext,",
        );

        expect(
          ltxBuilder,
        ).toContain(
          "scenePrompt,",
        );
      },
    );
  },
);
