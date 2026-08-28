import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";
import {
  H3_BACKEND_PROFILES,
  H3_VSR_REQUIRED_NODE_CLASSES,
  h3ExpectedAssetChoicesForBackend,
  h3RequiredNodeClassesForBackend,
  type H3PromptGraph,
  type ProductionV2H3BackendId,
} from "@/lib/production/h3Workflows";
import { SHAWN_GPU_LOCK_ID, SLR_GPU_LOCK_ID } from "@/lib/workers/clusterGpu";
import { submitComfyPromptWithGpuLease } from "@/lib/workers/comfyPromptLease";
import { listResourceLocks } from "@/lib/workers/resourceLocks";

type ObjectInfo = Record<string, {
  input?: { required?: Record<string, unknown> };
}>;

export type H3BackendProbe = {
  backend: ProductionV2H3BackendId;
  healthy: boolean;
  compatible: boolean;
  idle: boolean;
  reason: string;
  missingNodes: string[];
  missingAssets: string[];
};

export type H3BackendCompatibilityRequirements = {
  userLoraFilenames?: readonly string[];
  requireVsr?: boolean;
};

export type ComfyHistoryFile = {
  filename: string;
  subfolder: string;
  type: string;
  nodeId?: string;
};

const compatibilityCache = new Map<string, {
  expiresAt: number;
  missingNodes: string[];
  missingAssets: string[];
}>();

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function abortAfter(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function fetchWithTimeout(fetcher: typeof fetch, url: string, init: RequestInit = {}, timeoutMs = 10_000) {
  const timeout = abortAfter(timeoutMs);
  try {
    return await fetcher(url, { ...init, cache: "no-store", signal: timeout.signal });
  } finally {
    timeout.cancel();
  }
}

function choices(info: ObjectInfo, node: string, input: string): string[] {
  const descriptor = info[node]?.input?.required?.[input];
  if (!Array.isArray(descriptor)) return [];
  const first = descriptor[0];
  if (Array.isArray(first)) return first.map(clean).filter(Boolean);
  if (first && typeof first === "object" && Array.isArray((first as { options?: unknown }).options)) {
    return ((first as { options: unknown[] }).options).map(clean).filter(Boolean);
  }
  return [];
}

export async function inspectH3BackendCompatibility(
  backend: ProductionV2H3BackendId,
  requirements: H3BackendCompatibilityRequirements = {},
  fetcher: typeof fetch = fetch,
): Promise<H3BackendProbe> {
  const profile = H3_BACKEND_PROFILES[backend];
  const baseUrl = profile.baseUrl;
  const userLoraFilenames = [...new Set((requirements.userLoraFilenames || []).map(clean).filter(Boolean))].sort();
  const cacheKey = `${backend}:${requirements.requireVsr ? "vsr" : "native"}:${userLoraFilenames.join("\u0000")}`;
  try {
    const queueResponse = await fetchWithTimeout(fetcher, `${baseUrl}/queue`);
    if (!queueResponse.ok) throw new Error(`queue HTTP ${queueResponse.status}`);
    const queue = await queueResponse.json().catch(() => null) as { queue_running?: unknown; queue_pending?: unknown } | null;
    const queueBusy = (Array.isArray(queue?.queue_running) && queue.queue_running.length > 0)
      || (Array.isArray(queue?.queue_pending) && queue.queue_pending.length > 0);
    let dependencyState = process.env.NODE_ENV === "test" ? null : compatibilityCache.get(cacheKey);
    if (!dependencyState || dependencyState.expiresAt <= Date.now()) {
      const requiredNodeClasses = [...new Set([
        ...h3RequiredNodeClassesForBackend(backend),
        ...(requirements.requireVsr ? H3_VSR_REQUIRED_NODE_CLASSES : []),
      ])];

      const infoEntries = await Promise.all(
        requiredNodeClasses.map(async (node) => {
          const response = await fetchWithTimeout(
            fetcher,
            `${baseUrl}/object_info/${encodeURIComponent(node)}`,
          );

          if (!response.ok) return [node, null] as const;

          const payload = await response
            .json()
            .catch(() => null) as ObjectInfo | null;

          return [
            node,
            payload?.[node] ? payload : null,
          ] as const;
        }),
      );

      const info = Object.fromEntries(
        infoEntries
          .filter((entry) => entry[1])
          .flatMap(([node, payload]) =>
            Object.entries(payload || {})
              .filter(([key]) => key === node),
          ),
      ) as ObjectInfo;

      const missingNodes = requiredNodeClasses.filter(
        (node) => !info[node],
      );

      const expectedAssets = h3ExpectedAssetChoicesForBackend(backend, userLoraFilenames);

      const missingAssets = expectedAssets.flatMap(
        ([node, input, expected]) =>
          choices(info, node, input).includes(expected)
            ? []
            : [expected],
      );

      dependencyState = {
        expiresAt: Date.now() + 60_000,
        missingNodes,
        missingAssets,
      };
      if (process.env.NODE_ENV !== "test") compatibilityCache.set(cacheKey, dependencyState);
    }
    const { missingNodes, missingAssets } = dependencyState;
    const lockId = backend === "rtx3090" ? SHAWN_GPU_LOCK_ID : SLR_GPU_LOCK_ID;
    const locked = listResourceLocks().some((lock) => lock.lockId === lockId);
    const compatible = !missingNodes.length && !missingAssets.length;
    return {
      backend,
      healthy: true,
      compatible,
      idle: compatible && !queueBusy && !locked,
      reason: !compatible ? "missing-dependencies" : locked ? "otg-gpu-lock" : queueBusy ? "comfy-queue-active" : "available",
      missingNodes,
      missingAssets,
    };
  } catch (error) {
    return {
      backend,
      healthy: false,
      compatible: false,
      idle: false,
      reason: error instanceof Error ? error.message : "backend probe failed",
      missingNodes: [],
      missingAssets: [],
    };
  }
}

function filePathFromApiUrl(value: string) {
  try {
    const url = new URL(value, "http://otg.local");
    if (url.pathname !== "/api/file") return "";
    return clean(url.searchParams.get("path"));
  } catch {
    return "";
  }
}

export function resolveProductionV2MediaPath(value: unknown) {
  const source = clean(value);
  if (!source) return "";
  const apiFile = source.startsWith("/api/") ? filePathFromApiUrl(source) : "";
  const candidates = [
    apiFile,
    path.isAbsolute(source) ? source : "",
    source.startsWith("/") ? path.join(process.cwd(), "public", source.replace(/^\/+/, "")) : "",
    path.join(OTG_DATA_ROOT, source.replace(/^\/+/, "")),
    path.join(process.cwd(), source.replace(/^\/+/, "")),
  ].filter(Boolean).map((candidate) => path.resolve(candidate));
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || "";
}

export async function uploadH3Input(args: {
  backend: ProductionV2H3BackendId;
  sourcePath: string;
  mediaType: "image" | "audio" | "video";
  uploadName: string;
  fetcher?: typeof fetch;
}) {
  const absolutePath = resolveProductionV2MediaPath(args.sourcePath);
  if (!absolutePath) throw new Error(`Production ${args.mediaType} source is not a readable local file: ${args.sourcePath}`);
  const bytes = await fsp.readFile(absolutePath);
  const extension = path.extname(absolutePath).toLowerCase();
  const filename = `${safeSegment(args.uploadName)}${extension}`;
  const fetcher = args.fetcher || fetch;
  const baseUrl = H3_BACKEND_PROFILES[args.backend].baseUrl;
  const endpoints = args.mediaType === "audio"
    ? [["/upload/image", "image"], ["/upload/audio", "audio"], ["/upload/audio", "image"], ["/upload/image", "audio"]] as const
    : [["/upload/image", "image"]] as const;
  const failures: string[] = [];
  for (const [endpoint, field] of endpoints) {
    const body = new FormData();
    body.append(field, new Blob([bytes]), filename);
    body.append("type", "input");
    body.append("overwrite", "true");
    const response = await fetchWithTimeout(fetcher, `${baseUrl}${endpoint}`, { method: "POST", body }, 60_000);
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      failures.push(`${endpoint} HTTP ${response.status}: ${text.slice(0, 120)}`);
      continue;
    }
    let parsed: Record<string, unknown> = {};
    try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch {}
    const uploaded = clean(parsed.name || parsed.filename);
    if (uploaded) return uploaded;
    failures.push(`${endpoint} returned no filename`);
  }
  throw new Error(`Could not upload H3 ${args.mediaType} input: ${failures.join("; ")}`);
}

export async function submitH3Prompt(args: {
  backend: ProductionV2H3BackendId;
  graph: H3PromptGraph;
  clientId: string;
  jobId: string;
  workerId?: string;
  fetcher?: typeof fetch;
}) {
  const fetcher = args.fetcher || fetch;
  const response = await submitComfyPromptWithGpuLease({
    baseUrl: H3_BACKEND_PROFILES[args.backend].baseUrl,
    workerId: args.workerId || "production-v2-h3",
    ownerId: args.jobId,
    purpose: "video",
    fetcher: (url, init) => fetchWithTimeout(fetcher, url, init, 60_000),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: args.graph, client_id: args.clientId }),
    },
  });
  const text = await response.text().catch(() => "");
  const payload = text ? JSON.parse(text) as Record<string, unknown> : {};
  const promptId = clean(payload.prompt_id || payload.promptId);
  if (!response.ok) return { accepted: false as const, status: response.status, error: clean(payload.error || payload.message || text) || `ComfyUI rejected the prompt with HTTP ${response.status}.` };
  if (!promptId) throw new Error("ComfyUI returned a successful but unreadable prompt response; submission acceptance is ambiguous.");
  return { accepted: true as const, promptId };
}

function collectFiles(value: unknown, nodeId?: string, out: ComfyHistoryFile[] = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectFiles(item, nodeId, out));
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const record = value as Record<string, unknown>;
  const filename = clean(record.filename);
  if (filename) out.push({ filename, subfolder: clean(record.subfolder), type: clean(record.type) || "output", nodeId });
  Object.entries(record).forEach(([key, item]) => collectFiles(item, /^\d+$/.test(key) ? key : nodeId, out));
  return out;
}

export async function getH3PromptHistory(
  backend: ProductionV2H3BackendId,
  promptId: string,
  fetcher: typeof fetch = fetch,
  outputNodeId = "5",
) {
  const response = await fetchWithTimeout(fetcher, `${H3_BACKEND_PROFILES[backend].baseUrl}/history/${encodeURIComponent(promptId)}`, {}, 15_000);
  if (!response.ok) throw new Error(`ComfyUI history returned HTTP ${response.status}.`);
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const entry = payload?.[promptId] as Record<string, unknown> | undefined;
  if (!entry) return { state: "pending" as const, entry: null, video: null };
  const status = entry.status as { completed?: boolean; status_str?: string; messages?: unknown[] } | undefined;
  const failed = status?.status_str === "error" || (status?.messages || []).some((message) => Array.isArray(message) && message[0] === "execution_error");
  if (failed) return { state: "failed" as const, entry, video: null };
  const files = collectFiles(entry.outputs || entry).filter((file) => /\.(mp4|webm|mov|m4v|mkv)$/i.test(file.filename));
  const output = files.find((file) => file.nodeId === outputNodeId) || files[0] || null;
  if (output) return { state: "completed" as const, entry, video: output };
  return { state: status?.completed ? "failed" as const : "running" as const, entry, video: null };
}

export async function downloadH3Video(args: {
  backend: ProductionV2H3BackendId;
  file: ComfyHistoryFile;
  ownerKey: string;
  productionId: string;
  sceneId: string;
  generationJobId: string;
  artifactSuffix?: string;
  fetcher?: typeof fetch;
}) {
  const url = new URL(`${H3_BACKEND_PROFILES[args.backend].baseUrl}/view`);
  url.searchParams.set("filename", path.basename(args.file.filename));
  url.searchParams.set("subfolder", args.file.subfolder);
  url.searchParams.set("type", args.file.type || "output");
  const response = await fetchWithTimeout(args.fetcher || fetch, url.toString(), {}, 120_000);
  if (!response.ok) throw new Error(`Could not download generated H3 video (HTTP ${response.status}).`);
  const extension = /\.(mp4|webm|mov|m4v|mkv)$/i.test(path.extname(args.file.filename)) ? path.extname(args.file.filename).toLowerCase() : ".mp4";
  const directory = safeJoin(
    OTG_DATA_ROOT,
    "productions-v2",
    safeSegment(args.ownerKey),
    safeSegment(args.productionId),
    "scenes",
    safeSegment(args.sceneId),
    "generations",
  );
  await fsp.mkdir(directory, { recursive: true });
  const artifactSuffix = clean(args.artifactSuffix);
  const target = safeJoin(
    directory,
    `${safeSegment(args.generationJobId)}${artifactSuffix ? `-${safeSegment(artifactSuffix)}` : ""}${extension}`,
  );
  await fsp.writeFile(target, Buffer.from(await response.arrayBuffer()));
  return target;
}
