// app/lib/importOutputs.ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { comfyHistory, comfyView } from "./comfyApi";
import { loadJobMeta } from "./jobRegistry";

const DATA_DIR = path.join(process.cwd(), "data");
const GALLERY_DIR = path.join(DATA_DIR, "gallery");

type GalleryItem = {
  id: string;
  deviceId: string;
  workflow: string;
  promptId: string;
  filename: string;      // stored filename in our gallery (not Comfy’s)
  originalName: string;  // Comfy’s filename
  mediaType: "image" | "video" | "other";
  createdAt: string;
  url: string;           // /api/gallery/file?... (filled when serving)
};

function inferMediaType(name: string): GalleryItem["mediaType"] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp")) return "image";
  if (lower.endsWith(".mp4") || lower.endsWith(".webm") || lower.endsWith(".gif")) return "video";
  return "other";
}

async function readIndex(deviceId: string): Promise<GalleryItem[]> {
  const p = path.join(GALLERY_DIR, deviceId, "index.json");
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeIndex(deviceId: string, items: GalleryItem[]) {
  const dir = path.join(GALLERY_DIR, deviceId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "index.json"), JSON.stringify(items, null, 2), "utf-8");
}

export async function importOutputsForPrompt(promptId: string) {
  const meta = await loadJobMeta(promptId);
  if (!meta) throw new Error(`No job meta for promptId=${promptId}`);

  const { deviceId, workflowName } = meta;

  // 1) Get history
  const hist = await comfyHistory(promptId);

  // history shape: object keyed by promptId (common)
  const entry = hist?.[promptId] ?? hist;
  const outputs = entry?.outputs || {};

  // Collect all media from outputs[*].images / outputs[*].gifs / outputs[*].videos
  const files: { filename: string; subfolder?: string; type?: string }[] = [];

  for (const nodeId of Object.keys(outputs)) {
    const out = outputs[nodeId];

    const pushArr = (arr: any[]) => {
      for (const it of arr || []) {
        if (it?.filename) files.push({ filename: it.filename, subfolder: it.subfolder || "", type: it.type || "output" });
      }
    };

    pushArr(out?.images);
    pushArr(out?.gifs);
    pushArr(out?.videos);
  }

  if (!files.length) return { ok: true, deviceId, promptId, imported: 0, reason: "no outputs yet" };

  // 2) Dedup: if already imported this promptId, skip
  const index = await readIndex(deviceId);
  const already = new Set(index.filter(i => i.promptId === promptId).map(i => i.originalName));
  const toImport = files.filter(f => !already.has(f.filename));

  if (!toImport.length) return { ok: true, deviceId, promptId, imported: 0, reason: "already imported" };

  // 3) Download via /view and store locally
  const destDir = path.join(GALLERY_DIR, deviceId, "files", workflowName);
  await fs.mkdir(destDir, { recursive: true });

  const newItems: GalleryItem[] = [];

  for (const f of toImport) {
    const res = await comfyView(f);
    const buf = Buffer.from(await res.arrayBuffer());

    // keep extension
    const ext = path.extname(f.filename) || ".bin";
    const stored = `${promptId}_${crypto.randomUUID()}${ext}`;
    const storedPath = path.join(destDir, stored);

    await fs.writeFile(storedPath, buf);

    const mediaType = inferMediaType(f.filename);
    const id = crypto.createHash("sha1").update(`${deviceId}|${promptId}|${stored}`).digest("hex");

    newItems.push({
      id,
      deviceId,
      workflow: workflowName,
      promptId,
      filename: `${workflowName}/${stored}`, // relative under files/
      originalName: f.filename,
      mediaType,
      createdAt: new Date().toISOString(),
      url: "", // filled in API response
    });
  }

  // newest first
  const merged = [...newItems, ...index];

  await writeIndex(deviceId, merged);

  return { ok: true, deviceId, promptId, imported: newItems.length };
}
