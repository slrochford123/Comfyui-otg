import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import {
  OTG_DATA_ROOT,
  ensureDir,
  safeJoin,
  safeSegment,
} from "@/lib/paths";

import {
  LTX25_INGREDIENTS_MAX_VISUAL_REFERENCES,
  type Ltx25IngredientsManifest,
} from "@/lib/production/ltx25IngredientsManifest";

import {
  LTX25_INGREDIENTS_HEIGHT,
  LTX25_INGREDIENTS_WIDTH,
} from "@/lib/production/ltx25IngredientsWorkflow";

export const LTX25_INGREDIENTS_SHEET_VERSION =
  "ltx25-ingredients-sheet-v1" as const;

export const LTX25_INGREDIENTS_SHEET_GUTTER =
  8 as const;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function filePathFromApiUrl(
  value: string,
) {
  try {
    const url =
      new URL(
        value,
        "http://otg.local",
      );

    if (
      url.pathname
      !== "/api/file"
    ) {
      return "";
    }

    return clean(
      url.searchParams.get("path"),
    );
  } catch {
    return "";
  }
}

function readableFile(
  candidate: string,
) {
  try {
    return (
      fs.existsSync(candidate)
      && fs.statSync(candidate)
        .isFile()
    );
  } catch {
    return false;
  }
}

export function resolveLtx25IngredientSourcePath(
  value: unknown,
) {
  const source = clean(value);

  if (!source) {
    return "";
  }

  const apiFile =
    source.startsWith("/api/")
      ? filePathFromApiUrl(source)
      : "";

  const candidates = [
    apiFile,
    path.isAbsolute(source)
      ? source
      : "",
    source.startsWith("/")
      ? path.join(
          process.cwd(),
          "public",
          source.replace(/^\/+/, ""),
        )
      : "",
    path.join(
      OTG_DATA_ROOT,
      source.replace(/^\/+/, ""),
    ),
    path.join(
      process.cwd(),
      source.replace(/^\/+/, ""),
    ),
  ]
    .filter(Boolean)
    .map(
      (candidate) =>
        path.resolve(candidate),
    );

  return (
    candidates.find(readableFile)
    || ""
  );
}

export function ltx25IngredientsSheetOutputPath(
  input: {
    ownerKey: string;
    productionId: string;
    sceneId: string;
    jobId: string;
  },
) {
  return safeJoin(
    OTG_DATA_ROOT,
    "productions-v2",
    "ltx25-ingredients",
    safeSegment(input.ownerKey),
    safeSegment(input.productionId),
    safeSegment(input.sceneId),
    `${safeSegment(input.jobId)}.png`,
  );
}

type Column = {
  left: number;
  width: number;
};

function columnsForCount(
  count: number,
): Column[] {
  if (
    count < 1
    || count
      > LTX25_INGREDIENTS_MAX_VISUAL_REFERENCES
  ) {
    throw new Error(
      `LTX Ingredients sheet requires 1-${LTX25_INGREDIENTS_MAX_VISUAL_REFERENCES} columns.`,
    );
  }

  const gutter =
    LTX25_INGREDIENTS_SHEET_GUTTER;

  const usableWidth =
    LTX25_INGREDIENTS_WIDTH
    - gutter * (count - 1);

  const baseWidth =
    Math.floor(
      usableWidth / count,
    );

  const remainder =
    usableWidth
    - baseWidth * count;

  const result: Column[] = [];

  let left = 0;

  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const width =
      baseWidth
      + (
        index < remainder
          ? 1
          : 0
      );

    result.push({
      left,
      width,
    });

    left += width + gutter;
  }

  return result;
}

export async function composeLtx25IngredientsSheet(
  input: {
    manifest:
      Ltx25IngredientsManifest;
    outputPath: string;
    resolveSourcePath?: (
      value: unknown,
    ) => string;
  },
) {
  const manifest =
    input.manifest;

  if (
    manifest.count
    !== manifest.items.length
  ) {
    throw new Error(
      "LTX Ingredients manifest count is invalid.",
    );
  }

  const columns =
    columnsForCount(
      manifest.items.length,
    );

  const resolveSourcePath =
    input.resolveSourcePath
    || resolveLtx25IngredientSourcePath;

  const composites: Array<{
    input: Buffer;
    left: number;
    top: number;
  }> = [];

  const resolvedSources: Array<{
    slot: number;
    sourcePath: string;
    resolvedPath: string;
    sha256: string;
  }> = [];

  for (
    let index = 0;
    index < manifest.items.length;
    index += 1
  ) {
    const item =
      manifest.items[index];

    const column =
      columns[index];

    const resolvedPath =
      resolveSourcePath(
        item.sourcePath,
      );

    if (!resolvedPath) {
      throw new Error(
        `LTX Ingredient ${item.slot} (${item.name}) is not a readable local file: ${item.sourcePath}`,
      );
    }

    const bytes =
      await fsp.readFile(
        resolvedPath,
      );

    const sourceSha256 =
      crypto
        .createHash("sha256")
        .update(bytes)
        .digest("hex");

    const tile =
      await sharp(
        bytes,
        {
          failOn: "none",
          limitInputPixels: false,
        },
      )
        .rotate()
        .flatten({
          background: {
            r: 0,
            g: 0,
            b: 0,
          },
        })
        .resize({
          width:
            column.width,
          height:
            LTX25_INGREDIENTS_HEIGHT,
          fit: "contain",
          background: {
            r: 0,
            g: 0,
            b: 0,
          },
          withoutEnlargement:
            false,
        })
        .png({
          compressionLevel: 9,
          adaptiveFiltering: false,
        })
        .toBuffer();

    composites.push({
      input: tile,
      left:
        column.left,
      top: 0,
    });

    resolvedSources.push({
      slot: item.slot,
      sourcePath:
        item.sourcePath,
      resolvedPath,
      sha256:
        sourceSha256,
    });
  }

  const outputPath =
    path.resolve(
      input.outputPath,
    );

  if (
    path.extname(outputPath)
      .toLowerCase()
    !== ".png"
  ) {
    throw new Error(
      "LTX Ingredients sheet output must be a PNG.",
    );
  }

  ensureDir(
    path.dirname(outputPath),
  );

  const sheet =
    await sharp({
      create: {
        width:
          LTX25_INGREDIENTS_WIDTH,
        height:
          LTX25_INGREDIENTS_HEIGHT,
        channels: 3,
        background: {
          r: 0,
          g: 0,
          b: 0,
        },
      },
    })
      .composite(composites)
      .png({
        compressionLevel: 9,
        adaptiveFiltering: false,
      })
      .toBuffer();

  await fsp.writeFile(
    outputPath,
    sheet,
  );

  const sha256 =
    crypto
      .createHash("sha256")
      .update(sheet)
      .digest("hex");

  return {
    version:
      LTX25_INGREDIENTS_SHEET_VERSION,
    outputPath,
    width:
      LTX25_INGREDIENTS_WIDTH,
    height:
      LTX25_INGREDIENTS_HEIGHT,
    count:
      manifest.count,
    order:
      "left-to-right" as const,
    gutter:
      LTX25_INGREDIENTS_SHEET_GUTTER,
    sha256,
    resolvedSources,
  };
}
