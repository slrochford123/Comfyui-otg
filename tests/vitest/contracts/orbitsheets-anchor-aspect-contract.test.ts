import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import {
  ORBITSHEETS_ANCHOR_HEIGHT,
  ORBITSHEETS_ANCHOR_WIDTH,
  prepareOrbitSheetsAnchor,
} from "@/lib/characters/orbitSheetsAnchor";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("OrbitSheets proportional H3 anchor", () => {
  it("contains a portrait source without stretching its proportions", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "orbitsheets-anchor-"),
    );
    temporaryDirectories.push(directory);

    const sourcePath = path.join(directory, "portrait.png");
    const targetPath = path.join(directory, "anchor.png");

    await sharp({
      create: {
        width: 100,
        height: 200,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toFile(sourcePath);

    await prepareOrbitSheetsAnchor(sourcePath, targetPath);

    const image = sharp(targetPath);
    const metadata = await image.metadata();
    expect(metadata.width).toBe(ORBITSHEETS_ANCHOR_WIDTH);
    expect(metadata.height).toBe(ORBITSHEETS_ANCHOR_HEIGHT);

    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    const row = Math.floor(info.height / 2);
    const redColumns: number[] = [];

    for (let column = 0; column < info.width; column += 1) {
      const offset = (row * info.width + column) * info.channels;
      if (data[offset] > 240 && data[offset + 1] < 15 && data[offset + 2] < 15) {
        redColumns.push(column);
      }
    }

    const renderedWidth = redColumns.at(-1)! - redColumns[0] + 1;
    expect(renderedWidth).toBe(ORBITSHEETS_ANCHOR_HEIGHT / 2);
    expect(redColumns[0]).toBe((ORBITSHEETS_ANCHOR_WIDTH - renderedWidth) / 2);
  });
});
