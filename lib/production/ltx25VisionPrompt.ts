import fsp from "node:fs/promises";

import sharp from "sharp";

import {
  buildLtx25IngredientsManifest,
  type Ltx25IngredientManifestItem,
  type Ltx25IngredientsManifest,
} from "@/lib/production/ltx25IngredientsManifest";

import {
  resolveLtx25IngredientSourcePath,
} from "@/lib/production/ltx25IngredientsSheet";

import type {
  ProductionV2Scene,
} from "@/lib/production/v2";

/*
 * OTG_PRODUCTION_V2_LTX_VISION_IMAGES_V1
 *
 * LTX vision inputs are prepared directly from the canonical
 * Ingredients manifest in exact manifest slot order.
 *
 * Character entries must already be canonical single-view Character
 * images. This helper never selects or falls back to Character Card.
 *
 * Source resolution deliberately reuses
 * resolveLtx25IngredientSourcePath(), the same local-file policy used
 * by the qualified Ingredients sheet composer.
 *
 * No remote URL fetch is performed here.
 */

export const LTX25_VISION_MAX_DIMENSION =
  768 as const;

export const LTX25_VISION_JPEG_QUALITY =
  72 as const;

export const LTX25_VISION_MAX_IMAGE_BYTES =
  450_000 as const;

export const LTX25_VISION_MAX_TOTAL_BYTES =
  2_400_000 as const;

export type Ltx25PreparedVisionImage = {
  slot: number;

  name: string;

  sourceKind:
    Ltx25IngredientManifestItem["sourceKind"];

  generationSourceType:
    Ltx25IngredientManifestItem["generationSourceType"];

  perspectiveKey?:
    string;

  width?:
    number;

  height?:
    number;

  bytes:
    number;

  base64:
    string;
};

function clean(
  value: unknown,
) {
  return String(
    value
    ?? "",
  )
    .replace(
      /\s+/g,
      " ",
    )
    .trim();
}

function assertLocalIngredientSource(
  sourcePath: string,
) {
  /*
   * The existing LTX resolver accepts local API paths, public paths,
   * OTG data paths, cwd-relative paths, and readable local absolute
   * paths. Keep that policy authoritative.
   *
   * Only explicitly reject values that would require network/data
   * loading before calling the resolver.
   */
  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(
      sourcePath,
    )
    || /^data:/i.test(
      sourcePath,
    )
  ) {
    throw new Error(
      `Remote URLs and data URLs are not valid LTX Ingredient sources: ${sourcePath}`,
    );
  }
}

async function encodeBoundedVisionImage(
  sourceBytes: Buffer,
  sourceLabel: string,
) {
  const attempts = [
    {
      maxDimension:
        LTX25_VISION_MAX_DIMENSION,

      quality:
        LTX25_VISION_JPEG_QUALITY,
    },
    {
      maxDimension:
        640,

      quality:
        64,
    },
    {
      maxDimension:
        512,

      quality:
        56,
    },
  ];

  let output:
    Buffer | null =
    null;

  for (
    const attempt
    of attempts
  ) {
    output =
      await sharp(
        sourceBytes,
        {
          failOn:
            "none",

          limitInputPixels:
            false,
        },
      )
        .rotate()
        .resize({
          width:
            attempt.maxDimension,

          height:
            attempt.maxDimension,

          fit:
            "inside",

          withoutEnlargement:
            true,
        })
        .flatten({
          background: {
            r:
              255,

            g:
              255,

            b:
              255,
          },
        })
        .jpeg({
          quality:
            attempt.quality,

          mozjpeg:
            true,
        })
        .toBuffer();

    if (
      output.length
      <= LTX25_VISION_MAX_IMAGE_BYTES
    ) {
      break;
    }
  }

  if (
    !output
  ) {
    throw new Error(
      `Failed to prepare LTX vision image: ${sourceLabel}`,
    );
  }

  if (
    output.length
    > LTX25_VISION_MAX_IMAGE_BYTES
  ) {
    throw new Error(
      `Prepared LTX vision image remains too large after bounded resize: ${sourceLabel} (${output.length} bytes).`,
    );
  }

  const metadata =
    await sharp(
      output,
      {
        failOn:
          "none",
      },
    ).metadata();

  return {
    output,

    width:
      metadata.width,

    height:
      metadata.height,
  };
}

export async function prepareLtx25VisionImages(
  manifest: Ltx25IngredientsManifest,
  options: {
    resolveSourcePath?: (
      sourcePath: unknown,
    ) => string;
  } = {},
) {
  if (
    manifest.count
    !== manifest.items.length
  ) {
    throw new Error(
      "LTX vision manifest count is invalid.",
    );
  }

  const resolveSourcePath =
    options.resolveSourcePath
    || resolveLtx25IngredientSourcePath;

  const prepared:
    Ltx25PreparedVisionImage[] =
    [];

  let totalBytes =
    0;

  for (
    let index = 0;
    index < manifest.items.length;
    index += 1
  ) {
    const item =
      manifest.items[
        index
      ];

    /*
     * Do not reorder. Qwen image N must equal manifest Ingredient N.
     */
    if (
      item.slot
      !== index + 1
    ) {
      throw new Error(
        "LTX vision manifest slots are not in canonical order.",
      );
    }

    /*
     * Explicitly enforce the Character Card authority contract at this
     * final vision boundary as well.
     */
    if (
      item.sourceKind
      === "character"
      && item.generationSourceType
      !== "character-card"
    ) {
      throw new Error(
        `LTX Character Ingredient ${item.name} is not using the authoritative Character Card.`,
      );
    }

    const sourcePath =
      clean(
        item.sourcePath,
      );

    if (
      !sourcePath
    ) {
      throw new Error(
        `LTX Ingredient ${item.slot} (${item.name}) has no source image.`,
      );
    }

    assertLocalIngredientSource(
      sourcePath,
    );

    const resolvedPath =
      resolveSourcePath(
        sourcePath,
      );

    if (
      !resolvedPath
    ) {
      throw new Error(
        `LTX Ingredient ${item.slot} (${item.name}) is not a readable local file: ${sourcePath}`,
      );
    }

    const sourceBytes =
      await fsp.readFile(
        resolvedPath,
      );

    const encoded =
      await encodeBoundedVisionImage(
        sourceBytes,
        `Ingredient ${item.slot} (${item.name})`,
      );

    totalBytes +=
      encoded.output.length;

    if (
      totalBytes
      > LTX25_VISION_MAX_TOTAL_BYTES
    ) {
      throw new Error(
        `Prepared LTX vision image payload exceeds ${LTX25_VISION_MAX_TOTAL_BYTES} bytes.`,
      );
    }

    prepared.push({
      slot:
        item.slot,

      name:
        item.name,

      sourceKind:
        item.sourceKind,

      generationSourceType:
        item.generationSourceType,

      perspectiveKey:
        item.perspectiveKey,

      width:
        encoded.width,

      height:
        encoded.height,

      bytes:
        encoded.output.length,

      base64:
        encoded.output.toString(
          "base64",
        ),
    });
  }

  return {
    images:
      prepared.map(
        (item) =>
          item.base64,
      ),

    prepared,

    totalBytes,
  };
}

function ingredientMapping(
  manifest: Ltx25IngredientsManifest,
) {
  return manifest.items
    .map(
      (item) => {
        const identity =
          clean(
            item.identityDescription,
          );

        const perspective =
          item.perspectiveKey
            ? `; selected view: ${item.perspectiveKey}`
            : "";

        const metadata =
          identity
            ? ` Authoritative saved metadata: ${identity}`
            : "";

        return (
          `Image ${item.slot} = Ingredient ${item.slot} `
          + `(${item.positionLabel}) = ${item.name}; `
          + `${item.sourceKind}; ${item.generationSourceType}`
          + `${perspective}.`
          + metadata
        );
      },
    )
    .join(
      "\n",
    );
}

function userSceneRequest(
  scene: ProductionV2Scene,
) {
  return clean(
    scene
      .promptStateByMode[
        scene.generationMode
      ]
      ?.userPrompt,
  );
}

function ltxVisionRules(
  scene: ProductionV2Scene,
) {
  const audioRule =
    scene.promptOptions
      .soundEnabled
      ? (
          "Include natural synchronized dialogue, sound effects, or ambience when appropriate to the requested action."
        )
      : (
          "Do not introduce dialogue, sound effects, music, or ambience."
        );

  const durationRule =
    scene.durationSeconds === 10
      ? (
          "This is a 10-second Scene. Allow coherent temporal progression or additional shot development when the user requests it; do not compress the action into five-second pacing."
        )
      : (
          "This is a 5-second Scene. Keep the action compact and focused; usually favor one continuous shot unless the user explicitly requests a cut."
        );

  return [
    "Inspect every supplied image in order.",
    "The Image-to-Ingredient mapping is authoritative and exactly matches the supplied image order.",
    "Stored Ingredient names and saved metadata are authoritative for identity and project facts.",
    "Use vision only to augment authoritative metadata with directly visible appearance, clothing, hair, pose, object geometry, colors, materials, and visible environment.",
    "Never infer or invent real-world identity.",
    "Do not infer unsupported sensitive attributes from an image. If authoritative saved metadata explicitly states a detail, that saved metadata may be used.",
    "Preserve every selected Ingredient in one unified cinematic scene.",
    "The supplied Ingredient images and Ingredients sheet are reference material only. Never render or describe a board, sheet, panel, gutter, collage, contact sheet, split screen, or reference layout.",
    "Write one flowing cinematic scene paragraph in present tense.",
    "Start directly with the physical action.",
    "Describe physical action chronologically, literally, and precisely.",
    "Naturally include visible appearance, environment, camera framing or movement, lighting, atmosphere, and audio.",
    audioRule,
    "Respect the exact selected Scene duration.",
    durationRule,
    "Preserve the user's actual scene intent and do not invent unrelated action.",
    "Keep the final paragraph at 150 words or fewer.",
    "Do not use headings, markdown, timestamps, numbered shots, section labels, or meta commentary.",
    "Do not put LTX 2.5, USER SCENE DESCRIPTION, CAMERA AND FLOW, FINAL TEMPORAL QUALITY, 768P, or any other model/output-format label in the final paragraph.",
    "Return ONLY the final Scene Prompt paragraph.",
  ].join(
    "\n",
  );
}

export function buildLtx25VisionEnhancementInstruction(
  scene: ProductionV2Scene,
  manifest: Ltx25IngredientsManifest,
) {
  return [
    "Create the final cinematic Scene Prompt from the user's request and the supplied canonical Ingredient images.",
    "",
    "AUTHORITATIVE IMAGE MAPPING:",
    ingredientMapping(
      manifest,
    ),
    "",
    "USER SCENE REQUEST:",
    userSceneRequest(
      scene,
    ),
    "",
    "RULES:",
    ltxVisionRules(
      scene,
    ),
  ].join(
    "\n",
  );
}

export function buildLtx25VisionRepairInstruction(
  scene: ProductionV2Scene,
  manifest: Ltx25IngredientsManifest,
  previousPrompt: string,
  validationErrors: readonly string[],
) {
  return [
    "Repair the previous Scene Prompt while preserving the user's request and every canonical Ingredient.",
    "",
    "AUTHORITATIVE IMAGE MAPPING:",
    ingredientMapping(
      manifest,
    ),
    "",
    "USER SCENE REQUEST:",
    userSceneRequest(
      scene,
    ),
    "",
    "PREVIOUS SCENE PROMPT:",
    clean(
      previousPrompt,
    ),
    "",
    "VALIDATION FAILURES:",
    validationErrors
      .map(
        (error) =>
          `- ${clean(error)}`,
      )
      .join(
        "\n",
      ),
    "",
    "RULES:",
    ltxVisionRules(
      scene,
    ),
  ].join(
    "\n",
  );
}

export async function prepareLtx25VisionPrompt(
  scene: ProductionV2Scene,
) {
  const manifest =
    buildLtx25IngredientsManifest(
      scene,
    );

  const vision =
    await prepareLtx25VisionImages(
      manifest,
    );

  return {
    manifest,

    ...vision,
  };
}
