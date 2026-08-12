import type { VideoLoraCatalog, VideoLoraFamily } from "@/lib/videoLoras";
import { loadVideoLoraCatalog, normalizeVideoLoraFilename } from "@/lib/videoLoras";
import { videoBackends, type VideoBackend } from "@/lib/videoBackendFailover";

export const VIDEO_LORA_INVENTORY_TTL_MS = 45_000;

export type VideoLoraInventoryItem = {
  backendId: string;
  exactFilename: string;
  normalizedFilename: string;
  available: true;
  inferredFamily: VideoLoraFamily | null;
  sourceEndpoint: string;
  retrievedAt: string;
};

export type VideoLoraBackendInventory = {
  backendId: string;
  backendLabel: string;
  ok: boolean;
  retrievedAt: string;
  items: VideoLoraInventoryItem[];
  nodeSupport: { loraLoaderModelOnly: boolean; powerLoraLoaderRgthree: boolean };
  sources: string[];
  error: string | null;
};

type CacheRecord = { expiresAt: number; value: VideoLoraBackendInventory };
const cache = new Map<string, CacheRecord>();

function familyLookup(catalog: VideoLoraCatalog) {
  const result = new Map<string, VideoLoraFamily>();
  for (const entry of catalog.entries) {
    result.set(normalizeVideoLoraFilename(entry.filename), entry.family);
    for (const alias of entry.aliases || []) {
      if (/\.(safetensors|pt|pth|ckpt|bin)$/i.test(alias)) result.set(normalizeVideoLoraFilename(alias), entry.family);
    }
  }
  return result;
}

export function normalizeVideoLoraInventory(
  backendId: string,
  filenames: Iterable<unknown>,
  sourceEndpoint: string,
  retrievedAt: string,
  catalog = loadVideoLoraCatalog()
) {
  const families = familyLookup(catalog);
  const deduped = new Map<string, string>();
  for (const value of filenames) {
    const exact = String(value || "").trim();
    const normalized = normalizeVideoLoraFilename(exact);
    if (exact && normalized && !deduped.has(normalized)) deduped.set(normalized, exact);
  }
  return [...deduped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([normalizedFilename, exactFilename]): VideoLoraInventoryItem => ({
      backendId,
      exactFilename,
      normalizedFilename,
      available: true,
      inferredFamily: families.get(normalizedFilename) || null,
      sourceEndpoint,
      retrievedAt,
    }));
}

function filenamesFromLoraLoaderInfo(value: any) {
  const node = value?.LoraLoaderModelOnly || value;
  const options = node?.input?.required?.lora_name?.[0];
  return Array.isArray(options) ? options.filter((item) => typeof item === "string") : [];
}

async function getJson(url: string, timeoutMs = 5_000) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).pathname}`);
  return response.json();
}

export function videoBackendById(backendId: string): VideoBackend | null {
  const configured = videoBackends();
  return [configured.primary, configured.fallback].find((backend) => backend.id === backendId) || null;
}

export async function fetchVideoLoraInventory(backendId: string, options?: { refresh?: boolean }) {
  const backend = videoBackendById(backendId);
  if (!backend) throw new Error(`Unknown video backend: ${backendId}.`);
  const cached = cache.get(backendId);
  if (!options?.refresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const base = backend.baseUrl.replace(/\/+$/, "");
  const endpoints = {
    models: `${base}/models/loras`,
    standard: `${base}/object_info/LoraLoaderModelOnly`,
    power: `${base}/object_info/Power%20Lora%20Loader%20%28rgthree%29`,
  };
  const retrievedAt = new Date().toISOString();
  try {
    const [modelsResult, standardResult, powerResult] = await Promise.allSettled([
      getJson(endpoints.models),
      getJson(endpoints.standard),
      getJson(endpoints.power),
    ]);
    const modelNames = modelsResult.status === "fulfilled" && Array.isArray(modelsResult.value) ? modelsResult.value : [];
    const standardNames = standardResult.status === "fulfilled" ? filenamesFromLoraLoaderInfo(standardResult.value) : [];
    const allNames = [...modelNames, ...standardNames];
    if (!allNames.length && modelsResult.status === "rejected" && standardResult.status === "rejected") {
      throw new Error(`${String(modelsResult.reason?.message || modelsResult.reason)}; ${String(standardResult.reason?.message || standardResult.reason)}`);
    }
    const value: VideoLoraBackendInventory = {
      backendId,
      backendLabel: backend.label,
      ok: true,
      retrievedAt,
      items: normalizeVideoLoraInventory(backendId, allNames, "/models/loras", retrievedAt),
      nodeSupport: {
        loraLoaderModelOnly: standardResult.status === "fulfilled" && Boolean(standardResult.value?.LoraLoaderModelOnly),
        powerLoraLoaderRgthree: powerResult.status === "fulfilled" && Boolean(powerResult.value?.["Power Lora Loader (rgthree)"]),
      },
      sources: ["/models/loras", "/object_info/LoraLoaderModelOnly", "/object_info/Power Lora Loader (rgthree)"],
      error: null,
    };
    cache.set(backendId, { expiresAt: Date.now() + VIDEO_LORA_INVENTORY_TTL_MS, value });
    return value;
  } catch (error: any) {
    const value: VideoLoraBackendInventory = {
      backendId,
      backendLabel: backend.label,
      ok: false,
      retrievedAt,
      items: [],
      nodeSupport: { loraLoaderModelOnly: false, powerLoraLoaderRgthree: false },
      sources: ["/models/loras", "/object_info/LoraLoaderModelOnly", "/object_info/Power Lora Loader (rgthree)"],
      error: String(error?.message || error),
    };
    cache.set(backendId, { expiresAt: Date.now() + VIDEO_LORA_INVENTORY_TTL_MS, value });
    return value;
  }
}

export async function fetchAllVideoLoraInventories(options?: { refresh?: boolean }) {
  return Promise.all([fetchVideoLoraInventory("rtx3090", options), fetchVideoLoraInventory("rtx5060ti", options)]);
}

export function clearVideoLoraInventoryCache() {
  cache.clear();
}
