import fs from "node:fs/promises";
import path from "node:path";

export type GalleryItem = {
  id: string;
  ts: number;
  absPath: string;
  relPath: string;
  kind?: string;
  meta?: Record<string, any>;
};

function safeUserId(raw: string) {
  const s = (raw || "").toString().trim();
  // allow "default", emails not allowed here, keep simple
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(s)) throw new Error("Invalid userId");
  return s;
}

function safeDeviceId(raw: string) {
  const s = (raw || "").toString().trim();
  // allow slightly shorter device IDs (some generators use 6+)
  if (!/^[a-zA-Z0-9_-]{6,128}$/.test(s)) throw new Error("Invalid deviceId");
  return s;
}

export function getIndexRoot() {
  return process.env.GALLERY_INDEX_DIR || path.join(process.cwd(), "data", "gallery-index");
}

export function getComfyOutputsRoot() {
  return (
    process.env.COMFY_OUTPUTS_DIR ||
    path.join(process.cwd(), "ComfyUI", "output") // adjust if your install uses "outputs"
  );
}

function indexFilePath(userId: string, deviceId: string) {
  safeUserId(userId);
  safeDeviceId(deviceId);
  return path.join(getIndexRoot(), userId, `${deviceId}.jsonl`);
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

export async function appendGalleryItems(params: {
  userId: string;
  deviceId: string;
  absPaths: string[];
  meta?: Record<string, any>;
}) {
  const { userId, deviceId, absPaths, meta } = params;

  const outputsRoot = getComfyOutputsRoot();
  const dir = path.join(getIndexRoot(), safeUserId(userId));
  await ensureDir(dir);

  const file = indexFilePath(userId, deviceId);

  const now = Date.now();
  const lines = absPaths
    .filter(Boolean)
    .map((abs) => {
      const rel = path.relative(outputsRoot, abs).replaceAll("\\", "/");
      const item: GalleryItem = {
        id: `${now}-${Math.random().toString(16).slice(2)}`,
        ts: now,
        absPath: abs,
        relPath: rel,
        kind: "image",
        meta,
      };
      return JSON.stringify(item);
    });

  if (lines.length > 0) {
    await fs.appendFile(file, lines.join("\n") + "\n", "utf8");
  }
}

export async function readGalleryIndex(params: { userId: string; deviceId: string; limit?: number }) {
  const { userId, deviceId, limit = 300 } = params;
  const file = indexFilePath(userId, deviceId);

  try {
    const txt = await fs.readFile(file, "utf8");
    const items = txt
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as GalleryItem)
      .filter((x) => x && typeof x.absPath === "string" && typeof x.relPath === "string");

    items.sort((a, b) => b.ts - a.ts);
    return items.slice(0, limit);
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}
