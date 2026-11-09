import sharp from "sharp";

/** Keep the source framing with an HD pixel budget and at least a 720px short edge. */
export function storyImageSize(width = 1, height = 1) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("The image dimensions are invalid.");
  }
  if (Math.max(width, height) / Math.min(width, height) > 3) {
    throw new Error("Choose image framing between 1:3 and 3:1 for an HD Story image.");
  }
  const scale = Math.max(Math.sqrt((1280 * 720) / (width * height)), 720 / Math.min(width, height));
  return {
    width: Math.ceil((width * scale) / 16) * 16,
    height: Math.ceil((height * scale) / 16) * 16,
  };
}

export async function storyImageSizeForSource(source?: string) {
  if (!source) return storyImageSize();
  const image = await sharp(source, {limitInputPixels: 50_000_000}).rotate().metadata();
  const rotated = image.orientation && image.orientation >= 5;
  return storyImageSize(rotated ? image.height : image.width, rotated ? image.width : image.height);
}
