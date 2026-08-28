export type ComfyHistoryImagePayload = {
  filename: string;
  subfolder: string;
  type: string;
  nodeId?: string;
  bucket?: string;
};

export type ComfyHistoryImageFilters = {
  nodeId?: string;
  filename?: string;
  filenamePrefix?: string;
};

export type ComfyHistoryImageResolution = {
  baseUrl: string;
  image: ComfyHistoryImagePayload | null;
  count: number;
  attempts: string[];
  checkedBackends: string[];
};

const DEFAULT_IMAGE_GPU_URLS = [
  "http://127.0.0.1:8188",
  "http://127.0.0.1:8288",
  "http://192.168.1.113:8188",
  "http://100.75.162.64:8188",
] as const;

const HISTORY_REQUEST_TIMEOUT_MS = 2500;

export function normalizeComfyBaseUrl(value: unknown) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function configuredComfyImageBaseUrls() {
  const candidates = [
    process.env.OTG_IMAGE_COMFY_URL,
    process.env.COMFYUI_IMAGE_URL,
    process.env.IMAGE_COMFY_BASE_URL,
    process.env.COMFY_IMAGE_BASE_URL,
    process.env.COMFYUI_IMAGE_BASE_URL,
    process.env.COMFYUI_BASE_URL,
    process.env.COMFY_BASE_URL,
    process.env.NEXT_PUBLIC_COMFY_IMAGE_BASE_URL,
    process.env.NEXT_PUBLIC_COMFY_BASE_URL,
    ...DEFAULT_IMAGE_GPU_URLS,
  ];

  return Array.from(
    new Set(candidates.map(normalizeComfyBaseUrl).filter(Boolean)),
  );
}

export function candidateComfyImageBaseUrls(preferredBaseUrl?: string) {
  const configured = configuredComfyImageBaseUrls();
  const preferred = normalizeComfyBaseUrl(preferredBaseUrl);

  if (!preferred || !configured.includes(preferred)) {
    return configured;
  }

  return [preferred, ...configured.filter((baseUrl) => baseUrl !== preferred)];
}

async function fetchJsonWithTimeout(url: string, timeoutMs = HISTORY_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false as const,
        status: response.status,
        json: null,
      };
    }

    return {
      ok: true as const,
      status: response.status,
      json: await response.json().catch(() => null),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function extractComfyHistoryImages(historyJson: any, promptId: string): ComfyHistoryImagePayload[] {
  const entry = historyJson?.[promptId] || historyJson;
  const outputs = entry?.outputs;

  if (!outputs || typeof outputs !== "object") return [];

  const images: ComfyHistoryImagePayload[] = [];

  for (const [nodeId, node] of Object.entries(outputs) as Array<[string, any]>) {
    const buckets: Array<{ name: string; items: any[] }> = [
      { name: "images", items: Array.isArray(node?.images) ? node.images : [] },
      { name: "gifs", items: Array.isArray(node?.gifs) ? node.gifs : [] },
    ];

    for (const bucket of buckets) {
      for (const item of bucket.items) {
        const filename = String(item?.filename || "").trim();
        if (!filename) continue;

        images.push({
          filename,
          subfolder: String(item?.subfolder || "").trim(),
          type: String(item?.type || "output").trim() || "output",
          nodeId,
          bucket: bucket.name,
        });
      }
    }
  }

  return images;
}

export function matchesComfyHistoryImageRequest(
  item: ComfyHistoryImagePayload,
  filters: ComfyHistoryImageFilters,
) {
  const nodeId = String(filters.nodeId || "").trim();
  const filename = String(filters.filename || "").trim();
  const filenamePrefix = String(filters.filenamePrefix || "").trim();

  if (nodeId && String(item.nodeId || "") !== nodeId) return false;
  if (filename && String(item.filename || "") !== filename) return false;
  if (filenamePrefix && !String(item.filename || "").startsWith(filenamePrefix)) return false;

  return true;
}

function preferredHistoryImage(images: ComfyHistoryImagePayload[]) {
  return (
    images.find((item) => /character[\s_-]*card|card/i.test(item.filename)) ||
    images.find((item) => /\.(png|jpg|jpeg|webp)$/i.test(item.filename)) ||
    images[0] ||
    null
  );
}

export async function resolveComfyHistoryImage(args: {
  promptId: string;
  filters?: ComfyHistoryImageFilters;
  preferredBaseUrl?: string;
}): Promise<ComfyHistoryImageResolution> {
  const promptId = String(args.promptId || "").trim();
  const filters = args.filters || {};
  const attempts: string[] = [];
  const candidates = candidateComfyImageBaseUrls(args.preferredBaseUrl);

  for (const baseUrl of candidates) {
    try {
      const result = await fetchJsonWithTimeout(
        `${baseUrl}/history/${encodeURIComponent(promptId)}`,
      );

      if (!result.ok) {
        attempts.push(`${baseUrl}: HTTP ${result.status}`);
        continue;
      }

      const images = extractComfyHistoryImages(result.json, promptId);
      attempts.push(`${baseUrl}: ${images.length ? `${images.length} image(s)` : "no image output"}`);
      if (!images.length) continue;

      const exact = images.filter((item) => matchesComfyHistoryImageRequest(item, filters));
      if ((filters.nodeId || filters.filename || filters.filenamePrefix) && !exact.length) {
        attempts.push(
          `${baseUrl}: no exact image for nodeId=${filters.nodeId || "*"} filename=${filters.filename || "*"} filenamePrefix=${filters.filenamePrefix || "*"}`,
        );
        continue;
      }

      const pool = exact.length ? exact : images;
      const image = preferredHistoryImage(pool);
      if (!image) continue;

      return {
        baseUrl,
        image,
        count: images.length,
        attempts,
        checkedBackends: candidates,
      };
    } catch (error: any) {
      const message = error?.name === "AbortError"
        ? `timeout after ${HISTORY_REQUEST_TIMEOUT_MS}ms`
        : error?.message || String(error);
      attempts.push(`${baseUrl}: ${message}`);
    }
  }

  return {
    baseUrl: "",
    image: null,
    count: 0,
    attempts,
    checkedBackends: candidates,
  };
}
