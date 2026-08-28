import fs from "node:fs";
import path from "node:path";

import { IMAGE_MODELS, type ImageLoraDefinition } from "./imageGenerateWorkflows";
import { OTG_DATA_ROOT, ensureDir } from "./paths";

export type ImageLoraCatalogEntry = ImageLoraDefinition & {
  modelId: string;
  enabled: boolean;
  discoveredOn: string[];
  missingOn: string[];
};

type CatalogFile = { version: 1; updatedAt: string; entries: ImageLoraCatalogEntry[] };
export type ImageLoraInventorySnapshot = { id: string; ok: boolean; files: Set<string> };

const CATALOG_FILE = path.join(OTG_DATA_ROOT, "image_lora_catalog.json");
const VALID_IMAGE_MODEL_IDS = new Set(IMAGE_MODELS.map((model) => model.id));

function defaults(): ImageLoraCatalogEntry[] {
  return IMAGE_MODELS.flatMap((model) =>
    model.optionalLoras.map((lora) => ({
      ...lora,
      modelId: model.id,
      enabled: true,
      discoveredOn: [],
      missingOn: [],
    }))
  );
}

function normalize(entry: Partial<ImageLoraCatalogEntry>): ImageLoraCatalogEntry | null {
  const name = String(entry.name || "").trim();
  if (!name || !/\.(safetensors|pt|pth|bin)$/i.test(name)) return null;
  const strength = Number(entry.strength);
  const requestedModelId = String(entry.modelId || "").trim();
  return {
    name,
    label: String(entry.label || path.basename(name).replace(/\.(safetensors|pt|pth|bin)$/i, "")).trim(),
    description: String(entry.description || "").trim(),
    usage: String(entry.usage || "").trim(),
    strength: Number.isFinite(strength) ? Math.max(0, Math.min(2, strength)) : 1,
    mature: Boolean(entry.mature),
    modelId: VALID_IMAGE_MODEL_IDS.has(requestedModelId) ? requestedModelId : "",
    enabled: Boolean(entry.enabled),
    discoveredOn: Array.isArray(entry.discoveredOn) ? entry.discoveredOn.map(String).filter(Boolean) : [],
    missingOn: Array.isArray(entry.missingOn) ? entry.missingOn.map(String).filter(Boolean) : [],
  };
}

export function readImageLoraCatalog(): CatalogFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
    const entries = Array.isArray(parsed?.entries)
      ? parsed.entries.map(normalize).filter(Boolean) as ImageLoraCatalogEntry[]
      : defaults();
    return { version: 1, updatedAt: String(parsed?.updatedAt || ""), entries };
  } catch {
    return { version: 1, updatedAt: "", entries: defaults() };
  }
}

export function writeImageLoraCatalog(entries: ImageLoraCatalogEntry[]) {
  const normalized = entries.map(normalize).filter(Boolean) as ImageLoraCatalogEntry[];
  const unique = new Map<string, ImageLoraCatalogEntry>();
  normalized.forEach((entry) => unique.set(entry.name.toLowerCase(), entry));
  const result: CatalogFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: Array.from(unique.values()).sort((a, b) => a.label.localeCompare(b.label)),
  };
  ensureDir(path.dirname(CATALOG_FILE));
  const temporary = `${CATALOG_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(result, null, 2), "utf8");
  fs.renameSync(temporary, CATALOG_FILE);
  return result;
}

export function publicImageLoraCatalog() {
  const catalog = readImageLoraCatalog();
  return {
    ...catalog,
    entries: catalog.entries.filter((entry) => entry.enabled && entry.modelId),
  };
}

function collectModelFiles(value: unknown, output: Set<string>) {
  if (typeof value === "string") {
    if (/\.(safetensors|pt|pth|bin)$/i.test(value)) output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child) => collectModelFiles(child, output));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((child) => collectModelFiles(child, output));
  }
}

async function inventory(baseUrl: string) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/object_info/LoraLoaderModelOnly`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const files = new Set<string>();
  collectModelFiles(await response.json(), files);
  return files;
}

export function reconcileImageLoraCatalog(
  catalogEntries: ImageLoraCatalogEntry[],
  scans: ImageLoraInventorySnapshot[],
) {
  const healthyScans = scans.filter((scan) => scan.ok);
  const byName = new Map(catalogEntries.map((entry) => [entry.name.toLowerCase(), entry]));
  const discoveredNames = new Map<string, string>();
  healthyScans.forEach((scan) => scan.files.forEach((name) => discoveredNames.set(name.toLowerCase(), name)));

  discoveredNames.forEach((name, key) => {
    if (!byName.has(key)) {
      byName.set(key, {
        name,
        label: path.basename(name).replace(/\.(safetensors|pt|pth|bin)$/i, ""),
        description: "New LoRA discovered in ComfyUI. Assign an image model and review its settings before enabling it.",
        usage: "Admin review required.",
        strength: 1,
        mature: false,
        modelId: "",
        enabled: false,
        discoveredOn: [],
        missingOn: [],
      });
    }
  });

  return Array.from(byName.values()).map((entry) => {
    const presentOn = (scan: ImageLoraInventorySnapshot) =>
      Array.from(scan.files).some((name) => name.toLowerCase() === entry.name.toLowerCase());
    const discoveredOn = healthyScans.filter(presentOn).map((scan) => scan.id);
    const missingOn = healthyScans.filter((scan) => !presentOn(scan)).map((scan) => scan.id);
    return { ...entry, discoveredOn, missingOn, enabled: discoveredOn.length ? entry.enabled : false };
  });
}

export async function synchronizeImageLoraCatalog() {
  const backends = [
    { id: "rtx5060ti", baseUrl: process.env.COMFYUI_IMAGE_URL || process.env.OTG_VIDEO_FALLBACK_COMFY_URL || "http://192.168.1.113:8188" },
    { id: "rtx3090", baseUrl: process.env.OTG_VIDEO_PRIMARY_COMFY_URL || "http://100.75.162.64:8188" },
  ];
  const scans = await Promise.all(backends.map(async (backend) => {
    try {
      return { ...backend, ok: true as const, files: await inventory(backend.baseUrl), error: null };
    } catch (error: any) {
      return { ...backend, ok: false as const, files: new Set<string>(), error: String(error?.message || error) };
    }
  }));
  if (!scans.some((scan) => scan.ok)) throw new Error("No ComfyUI backend returned a LoRA inventory.");

  const catalog = readImageLoraCatalog();
  const entries = reconcileImageLoraCatalog(catalog.entries, scans);
  const saved = writeImageLoraCatalog(entries);
  return {
    ...saved,
    backends: scans.map((scan) => ({ id: scan.id, baseUrl: scan.baseUrl, ok: scan.ok, count: scan.files.size, error: scan.error })),
  };
}
