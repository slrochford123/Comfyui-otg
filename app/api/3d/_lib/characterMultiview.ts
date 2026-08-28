import sharp from "sharp";
import { removeBackgroundBestEffort } from "@/app/api/angles/_lib/backgroundRemoval";

export type PreparedView = {
  buffer: Buffer;
  changed: boolean;
  note: string;
  width: number;
  height: number;
};

function safeNamePart(raw: string) {
  return String(raw || "view").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "view";
}

export async function prepareCharacterView(
  input: Buffer,
  opts?: {
    removeBackground?: boolean;
    squareSize?: number;
    label?: string;
  }
): Promise<PreparedView> {
  const squareSize = Math.max(512, Math.min(2048, Number(opts?.squareSize || 1024)));
  const label = safeNamePart(opts?.label || "view");

  let working: Buffer = Buffer.from(input);
  let note = "Used original uploaded image.";
  let changed = false;

  if (opts?.removeBackground) {
    const cutout = await removeBackgroundBestEffort(working);
    working = Buffer.from(cutout.buffer);
    note = cutout.note;
    changed = cutout.changed;
  }

  const trimmed = await sharp(working)
    .rotate()
    .trim()
    .png()
    .toBuffer();

  const resized = await sharp(trimmed)
    .resize({
      width: Math.round(squareSize * 0.86),
      height: Math.round(squareSize * 0.86),
      fit: "inside",
      withoutEnlargement: true,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const finalBuffer = await sharp({
    create: {
      width: squareSize,
      height: squareSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, gravity: "center" }])
    .png()
    .toBuffer();

  const meta = await sharp(finalBuffer).metadata();
  return {
    buffer: finalBuffer,
    changed,
    note: `${label}: ${note}`,
    width: meta.width || squareSize,
    height: meta.height || squareSize,
  };
}