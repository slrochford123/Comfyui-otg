import sharp from "sharp";

export const ORBITSHEETS_ANCHOR_WIDTH = 1216;
export const ORBITSHEETS_ANCHOR_HEIGHT = 672;

const NEUTRAL_STUDIO_GREY = {
  r: 128,
  g: 128,
  b: 128,
  alpha: 1,
};

export async function prepareOrbitSheetsAnchor(
  sourcePath: string,
  targetPath: string,
) {
  await sharp(sourcePath)
    .flatten({ background: NEUTRAL_STUDIO_GREY })
    .resize({
      width: ORBITSHEETS_ANCHOR_WIDTH,
      height: ORBITSHEETS_ANCHOR_HEIGHT,
      fit: "contain",
      position: "centre",
      background: NEUTRAL_STUDIO_GREY,
    })
    .png()
    .toFile(targetPath);
}
