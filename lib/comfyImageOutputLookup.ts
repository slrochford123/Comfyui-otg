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

export type ComfyPromptImageStatusKind =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "missing_output"
  | "unavailable";

export type ComfyPromptImageStatusResolution =
  ComfyHistoryImageResolution & {
    status: ComfyPromptImageStatusKind;
    error: string;
    historyFound: boolean;
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

function comfyHistoryEntry(historyJson: any, promptId: string) {
  return historyJson?.[promptId] || historyJson;
}

function comfyStatusText(entry: any) {
  return String(entry?.status?.status_str || entry?.status || "").toLowerCase();
}

function comfyHistoryFailed(entry: any) {
  const statusText = comfyStatusText(entry);
  if (/error|fail|failed/.test(statusText)) return true;

  const messages = Array.isArray(entry?.status?.messages)
    ? entry.status.messages
    : [];

  return messages.some((message: any) =>
    Array.isArray(message)
      ? /execution_error|error|failed/i.test(String(message[0] || ""))
      : /execution_error|error|failed/i.test(String(message || "")),
  );
}

function comfyHistoryCompleted(entry: any) {
  if (entry?.status?.completed === true) return true;
  return /success|completed|complete/.test(comfyStatusText(entry));
}

function comfyFailureMessage(entry: any) {
  const messages = Array.isArray(entry?.status?.messages)
    ? entry.status.messages
    : [];

  for (const message of messages) {
    if (!Array.isArray(message)) continue;
    const kind = String(message[0] || "");
    const payload = message[1];
    if (!/error|failed/i.test(kind)) continue;

    const exception =
      payload?.exception_message ||
      payload?.exception_type ||
      payload?.node_id ||
      "";
    if (exception) return String(exception);
  }

  return (
    String(entry?.status?.status_str || "").trim() ||
    "ComfyUI reported that the prompt failed."
  );
}

function queueIncludesPrompt(value: any, promptId: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => queueIncludesPrompt(item, promptId));
  }

  if (value && typeof value === "object") {
    return Object.values(value).some((item) =>
      queueIncludesPrompt(item, promptId),
    );
  }

  return String(value || "") === promptId;
}

async function fetchComfyQueueStatus(baseUrl: string, promptId: string) {
  const result = await fetchJsonWithTimeout(`${baseUrl}/queue`, 1500);
  if (!result.ok) {
    return {
      status: "unavailable" as const,
      detail: `HTTP ${result.status}`,
    };
  }

  const running = queueIncludesPrompt(result.json?.queue_running, promptId);
  const pending = queueIncludesPrompt(result.json?.queue_pending, promptId);

  if (running) return { status: "running" as const, detail: "running" };
  if (pending) return { status: "pending" as const, detail: "pending" };
  return { status: "pending" as const, detail: "not in queue" };
}

function noComfyStatusResult(args: {
  status: ComfyPromptImageStatusKind;
  error?: string;
  attempts: string[];
  checkedBackends: string[];
  baseUrl?: string;
}) {
  return {
    baseUrl: args.baseUrl || "",
    image: null,
    count: 0,
    attempts: args.attempts,
    checkedBackends: args.checkedBackends,
    status: args.status,
    error: args.error || "",
    historyFound: false,
  } satisfies ComfyPromptImageStatusResolution;
}

export async function resolveComfyPromptImageStatus(args: {
  promptId: string;
  filters?: ComfyHistoryImageFilters;
  preferredBaseUrl?: string;
  strictPreferred?: boolean;
}): Promise<ComfyPromptImageStatusResolution> {
  const promptId = String(args.promptId || "").trim();
  const filters = args.filters || {};
  const preferred = normalizeComfyBaseUrl(args.preferredBaseUrl);
  const candidates =
    args.strictPreferred && preferred
      ? [preferred]
      : candidateComfyImageBaseUrls(preferred);
  const attempts: string[] = [];

  if (!promptId) {
    return noComfyStatusResult({
      status: "failed",
      error: "Missing ComfyUI prompt id.",
      attempts,
      checkedBackends: candidates,
    });
  }

  for (const baseUrl of candidates) {
    try {
      const historyResult = await fetchJsonWithTimeout(
        `${baseUrl}/history/${encodeURIComponent(promptId)}`,
      );

      if (!historyResult.ok) {
        attempts.push(`${baseUrl}: history HTTP ${historyResult.status}`);
        continue;
      }

      const entry = comfyHistoryEntry(historyResult.json, promptId);
      const historyFound =
        !!entry &&
        typeof entry === "object" &&
        Object.keys(entry).length > 0;
      const images = extractComfyHistoryImages(historyResult.json, promptId);

      if (historyFound && comfyHistoryFailed(entry)) {
        return {
          baseUrl,
          image: null,
          count: images.length,
          attempts,
          checkedBackends: candidates,
          status: "failed",
          error: comfyFailureMessage(entry),
          historyFound,
        };
      }

      if (images.length) {
        attempts.push(`${baseUrl}: ${images.length} image(s)`);
        const exact = images.filter((item) =>
          matchesComfyHistoryImageRequest(item, filters),
        );

        if (
          (filters.nodeId || filters.filename || filters.filenamePrefix) &&
          !exact.length
        ) {
          return {
            baseUrl,
            image: null,
            count: images.length,
            attempts,
            checkedBackends: candidates,
            status: "missing_output",
            error:
              `ComfyUI completed prompt ${promptId}, but the expected image output was not found.`,
            historyFound,
          };
        }

        const image = preferredHistoryImage(exact.length ? exact : images);
        if (image) {
          return {
            baseUrl,
            image,
            count: images.length,
            attempts,
            checkedBackends: candidates,
            status: "completed",
            error: "",
            historyFound,
          };
        }
      }

      if (historyFound && comfyHistoryCompleted(entry)) {
        return {
          baseUrl,
          image: null,
          count: 0,
          attempts,
          checkedBackends: candidates,
          status: "missing_output",
          error:
            `ComfyUI completed prompt ${promptId}, but no image output was found.`,
          historyFound,
        };
      }

      const queue = await fetchComfyQueueStatus(baseUrl, promptId);
      attempts.push(`${baseUrl}: queue ${queue.detail}`);
      return {
        baseUrl,
        image: null,
        count: 0,
        attempts,
        checkedBackends: candidates,
        status: queue.status === "running" ? "running" : "pending",
        error: "",
        historyFound,
      };
    } catch (error: any) {
      const message = error?.name === "AbortError"
        ? `timeout after ${HISTORY_REQUEST_TIMEOUT_MS}ms`
        : error?.message || String(error);
      attempts.push(`${baseUrl}: ${message}`);
    }
  }

  return noComfyStatusResult({
    status: "unavailable",
    error: "Story image backend is temporarily unavailable.",
    attempts,
    checkedBackends: candidates,
  });
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
