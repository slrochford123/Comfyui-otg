import chokidar from "chokidar";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getActiveDevice } from "../lib/activeDevice";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = process.env.SUPABASE_BUCKET || "gallery";
const OUTPUT_DIR = process.env.COMFY_OUTPUT_DIR!;

// Local “uploaded registry” so we never double-upload
const DATA_DIR = process.env.OTG_DATA_DIR || path.join(process.cwd(), "data");
const REGISTRY_FILE = path.join(DATA_DIR, "uploaded_registry.json");

type Registry = Record<string, { uploadedAt: number; storagePath: string }>;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function inferKind(filename: string) {
  const f = filename.toLowerCase();
  if (f.endsWith(".mp4") || f.endsWith(".webm") || f.endsWith(".mov")) return "video";
  return "image";
}

async function loadRegistry(): Promise<Registry> {
  try {
    const raw = await fs.readFile(REGISTRY_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveRegistry(reg: Registry) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(REGISTRY_FILE, JSON.stringify(reg, null, 2), "utf-8");
}

async function sha256File(fullPath: string) {
  const data = await fs.readFile(fullPath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function waitForStableSize(fullPath: string, tries = 10) {
  let last = -1;
  for (let i = 0; i < tries; i++) {
    const st = await fs.stat(fullPath);
    if (st.size === last && st.size > 0) return st.size;
    last = st.size;
    await new Promise((r) => setTimeout(r, 300));
  }
  return last;
}

async function uploadFile(fullPath: string) {
  const base = path.basename(fullPath);

  // Ignore temp/in-progress files
  const lower = base.toLowerCase();
  if (lower.endsWith(".tmp") || lower.endsWith(".part") || lower.endsWith(".crdownload")) return;

  // Only upload common media
  if (!/\.(png|jpg|jpeg|webp|gif|mp4|webm|mov)$/i.test(base)) return;

  // Make sure file finished writing
  await waitForStableSize(fullPath);

  const hash = await sha256File(fullPath);
  const reg = await loadRegistry();
  if (reg[hash]) {
    console.log("[watcher] already uploaded:", base, "->", reg[hash].storagePath);
    return;
  }

  const deviceId = await getActiveDevice(); // last active OTG device
  const kind = inferKind(base);
  const bytes = await fs.readFile(fullPath);

  const storagePath = `${deviceId}/${Date.now()}_${base}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
    contentType: kind === "video" ? "video/mp4" : "image/png",
    upsert: false,
  });
  if (upErr) {
    console.error("[watcher] upload failed:", upErr.message);
    return;
  }

  const { error: dbErr } = await supabase.from("gallery_items").insert({
    device_id: deviceId,
    storage_path: storagePath,
    filename: base,
    kind,
    size_bytes: bytes.length,
  });

  if (dbErr) {
    console.error("[watcher] DB insert failed:", dbErr.message);
    // cleanup storage if DB insert fails
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return;
  }

  reg[hash] = { uploadedAt: Date.now(), storagePath };
  await saveRegistry(reg);

  console.log("[watcher] uploaded:", base, "device:", deviceId);
}

async function main() {
  if (!OUTPUT_DIR) throw new Error("COMFY_OUTPUT_DIR is not set");

  console.log("[watcher] watching:", OUTPUT_DIR);
  console.log("[watcher] registry:", REGISTRY_FILE);

  const watcher = chokidar.watch(OUTPUT_DIR, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 },
  });

  watcher.on("add", (p) => uploadFile(p).catch((e) => console.error("[watcher] error:", e)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
