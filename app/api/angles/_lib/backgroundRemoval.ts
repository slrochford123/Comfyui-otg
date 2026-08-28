import sharp from "sharp";

type SubjectType = "prop" | "character";

type CutoutResult = {
  buffer: Buffer;
  changed: boolean;
  note: string;
  width: number;
  height: number;
  confidence: number;
  subjectType: SubjectType;
};

type RemoveBackgroundOptions = {
  subjectType?: SubjectType;
};

function colorDistanceSq(a: [number, number, number], b: [number, number, number]) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function averageSamples(raw: Buffer, width: number, height: number, points: Array<[number, number]>) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (const [cx, cy] of points) {
    const x0 = Math.max(0, cx - 2);
    const y0 = Math.max(0, cy - 2);
    const x1 = Math.min(width - 1, cx + 2);
    const y1 = Math.min(height - 1, cy + 2);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const idx = (y * width + x) * 4;
        const a = raw[idx + 3];
        if (a < 10) continue;
        r += raw[idx];
        g += raw[idx + 1];
        b += raw[idx + 2];
        count += 1;
      }
    }
  }
  if (!count) return [255, 255, 255] as [number, number, number];
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)] as [number, number, number];
}

function computeAlphaBounds(raw: Buffer, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      if (raw[idx + 3] < 8) continue;
      count += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!count || maxX < minX || maxY < minY) return null;
  return { minX, minY, maxX, maxY, count };
}

function expandBounds(
  width: number,
  height: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  padX: number,
  padY: number
) {
  return {
    left: Math.max(0, bounds.minX - padX),
    top: Math.max(0, bounds.minY - padY),
    cropWidth: Math.min(width, bounds.maxX + padX + 1) - Math.max(0, bounds.minX - padX),
    cropHeight: Math.min(height, bounds.maxY + padY + 1) - Math.max(0, bounds.minY - padY),
  };
}

export async function removeBackgroundBestEffort(input: Buffer, options?: RemoveBackgroundOptions): Promise<CutoutResult> {
  const subjectType: SubjectType = options?.subjectType === "character" ? "character" : "prop";
  const prepared = sharp(input).rotate().ensureAlpha();
  const meta = await prepared.metadata();
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  if (!width || !height) {
    return {
      buffer: input,
      changed: false,
      note: "Background removal skipped: invalid image size.",
      width: 0,
      height: 0,
      confidence: 0,
      subjectType,
    };
  }

  const maxPixels = 3000 * 3000;
  const pipeline = width * height > maxPixels ? prepared.resize({ width: 2200, height: 2200, fit: "inside" }) : prepared;
  const info = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const raw = Buffer.from(info.data);
  const w = info.info.width;
  const h = info.info.height;
  const total = w * h;

  const bgSamples = [
    averageSamples(raw, w, h, [[0, 0], [Math.floor(w * 0.1), 0], [0, Math.floor(h * 0.1)]]),
    averageSamples(raw, w, h, [[w - 1, 0], [Math.floor(w * 0.9), 0], [w - 1, Math.floor(h * 0.1)]]),
    averageSamples(raw, w, h, [[0, h - 1], [Math.floor(w * 0.1), h - 1], [0, Math.floor(h * 0.9)]]),
    averageSamples(raw, w, h, [[w - 1, h - 1], [Math.floor(w * 0.9), h - 1], [w - 1, Math.floor(h * 0.9)]])
  ];

  const visited = new Uint8Array(total);
  const remove = new Uint8Array(total);
  const queue = new Uint32Array(total);
  let qh = 0;
  let qt = 0;

  const toleranceSq = subjectType === "character" ? 52 * 52 : 58 * 58;
  const brightToleranceSq = subjectType === "character" ? 66 * 66 : 72 * 72;

  const matchesBackground = (x: number, y: number) => {
    const idx = (y * w + x) * 4;
    const a = raw[idx + 3];
    if (a < 16) return true;
    const rgb: [number, number, number] = [raw[idx], raw[idx + 1], raw[idx + 2]];
    for (const sample of bgSamples) {
      if (colorDistanceSq(rgb, sample) <= toleranceSq) return true;
    }
    const avg = (rgb[0] + rgb[1] + rgb[2]) / 3;
    if (avg > 242) {
      for (const sample of bgSamples) {
        const sampleAvg = (sample[0] + sample[1] + sample[2]) / 3;
        if (sampleAvg > 225 && colorDistanceSq(rgb, sample) <= brightToleranceSq) return true;
      }
    }
    return false;
  };

  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (visited[p]) return;
    visited[p] = 1;
    if (!matchesBackground(x, y)) return;
    remove[p] = 1;
    queue[qt++] = p;
  };

  for (let x = 0; x < w; x += 1) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    push(0, y);
    push(w - 1, y);
  }

  while (qh < qt) {
    const p = queue[qh++];
    const x = p % w;
    const y = Math.floor(p / w);
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }

  let removed = 0;
  for (let p = 0; p < total; p += 1) {
    if (!remove[p]) continue;
    const idx = p * 4;
    raw[idx + 3] = 0;
    removed += 1;
  }

  const removedPct = total ? removed / total : 0;
  const foregroundBounds = computeAlphaBounds(raw, w, h);
  const foregroundPct = foregroundBounds ? foregroundBounds.count / total : 0;
  const weak = removedPct < 0.01 || removedPct > 0.93 || !foregroundBounds || foregroundPct < 0.04;
  if (weak) {
    const originalPng = await sharp(input).rotate().png().toBuffer();
    return {
      buffer: originalPng,
      changed: false,
      note: subjectType === "character"
        ? "Character cutout confidence was weak, so the original image was used. Use a full-body front view with separated arms and legs."
        : "Background removal skipped because the cutout confidence was weak.",
      width: w,
      height: h,
      confidence: Math.max(0, Math.min(1, removedPct)),
      subjectType,
    };
  }

  const cutoutBase = sharp(raw, { raw: { width: w, height: h, channels: 4 } });
  const crop = subjectType === "character"
    ? expandBounds(
        w,
        h,
        foregroundBounds,
        Math.max(24, Math.round((foregroundBounds.maxX - foregroundBounds.minX + 1) * 0.12)),
        Math.max(28, Math.round((foregroundBounds.maxY - foregroundBounds.minY + 1) * 0.08))
      )
    : null;

  let output = crop
    ? cutoutBase.extract({ left: crop.left, top: crop.top, width: crop.cropWidth, height: crop.cropHeight })
    : cutoutBase;

  output = output.extend({
    top: subjectType === "character" ? 28 : 12,
    bottom: subjectType === "character" ? 28 : 12,
    left: subjectType === "character" ? 24 : 12,
    right: subjectType === "character" ? 24 : 12,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });

  const trimmed = await output.png().toBuffer();
  return {
    buffer: trimmed,
    changed: true,
    note: subjectType === "character"
      ? "Background removed and subject recentered for character 3D processing."
      : "Background removed before 3D processing.",
    width: w,
    height: h,
    confidence: Math.max(0, Math.min(1, 1 - Math.abs(0.5 - foregroundPct) * 1.6)),
    subjectType,
  };
}
