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
import {
  DEFAULT_H3_ADVANCED_SETTINGS,
  H3_SINGULARITY_CHECKPOINT,
  resolveH3RenderSettings,
  type H3AdvancedSettings,
} from "@/lib/production/h3Settings";
import { submitComfyPromptWithGpuLease } from "@/lib/workers/comfyPromptLease";
import { runWithComfySubmissionCriticalSection } from "@/lib/workers/comfySubmissionCriticalSection";

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
  h3Settings?: H3AdvancedSettings;
  referenceCount?: number;
};

export type ComfyHistoryFile = {
  filename: string;
  subfolder: string;
  type: string;
  nodeId?: string;
};

export type H3PromptCancellationResult = {
  outcome: "cancel-requested" | "removed-from-queue" | "already-stopped";
  mechanism: "prompt-specific" | "guarded-interrupt" | "queue-delete";
};

const compatibilityCache = new Map<string, {
  expiresAt: number;
  missingNodes: string[];
  missingAssets: string[];
}>();

function clean(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nested =
      record.message
      || record.error
      || record.detail
      || record.reason;
    if (typeof nested === "string") return nested.trim();
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return String(value).trim();
}

function queuePromptId(entry: unknown) {
  if (Array.isArray(entry)) return clean(entry[1]);
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    return clean(record.prompt_id || record.promptId || record.id);
  }
  return "";
}

function queuePromptIds(value: unknown) {
  return Array.isArray(value) ? value.map(queuePromptId).filter(Boolean) : [];
}

export async function getH3PromptQueueState(
  backend: ProductionV2H3BackendId,
  promptId: string,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetchWithTimeout(
    fetcher,
    `${H3_BACKEND_PROFILES[backend].baseUrl}/queue`,
    {},
    10_000,
  );
  if (!response.ok) throw new Error(`ComfyUI queue returned HTTP ${response.status}.`);
  const queue = await response.json().catch(() => null) as { queue_running?: unknown; queue_pending?: unknown } | null;
  const cleanPromptId = clean(promptId);
  if (queuePromptIds(queue?.queue_running).includes(cleanPromptId)) return "running" as const;
  if (queuePromptIds(queue?.queue_pending).includes(cleanPromptId)) return "pending" as const;
  return "absent" as const;
}

export async function cancelH3Prompt(args: {
  backend: ProductionV2H3BackendId;
  promptId: string;
  jobId: string;
  workerId?: string;
  fetcher?: typeof fetch;
}) : Promise<H3PromptCancellationResult> {
  const promptId = clean(args.promptId);
  if (!promptId) throw new Error("Cannot cancel H3 generation without its ComfyUI prompt ID.");
  const fetcher = args.fetcher || fetch;
  const baseUrl = H3_BACKEND_PROFILES[args.backend].baseUrl;
  const targeted = await fetchWithTimeout(
    fetcher,
    `${baseUrl}/api/jobs/${encodeURIComponent(promptId)}/cancel`,
    { method: "POST" },
    15_000,
  );
  if (targeted.ok) {
    return { outcome: "cancel-requested", mechanism: "prompt-specific" };
  }
  if (![404, 405, 501].includes(targeted.status)) {
    throw new Error(`ComfyUI rejected cancellation with HTTP ${targeted.status}.`);
  }

  const physicalGpu = args.backend === "rtx3090" ? "shawn-3090" : "slr-5060";
  const guarded = await runWithComfySubmissionCriticalSection(
    {
      physicalGpu,
      ownerId: `cancel:${args.jobId}`,
      workerId: args.workerId || "h3-cancel",
    },
    async () => {
      const readQueue = async () => {
        const response = await fetchWithTimeout(fetcher, `${baseUrl}/queue`, {}, 10_000);
        if (!response.ok) throw new Error(`ComfyUI queue returned HTTP ${response.status} during cancellation.`);
        return response.json().catch(() => null) as Promise<{ queue_running?: unknown; queue_pending?: unknown } | null>;
      };
      let queue = await readQueue();
      const pending = queuePromptIds(queue?.queue_pending);
      if (pending.includes(promptId)) {
        const deleted = await fetchWithTimeout(fetcher, `${baseUrl}/queue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ delete: [promptId] }),
        }, 10_000);
        if (!deleted.ok) throw new Error(`ComfyUI queue removal returned HTTP ${deleted.status}.`);
        return { outcome: "removed-from-queue", mechanism: "queue-delete" } as const;
      }
      if (!queuePromptIds(queue?.queue_running).includes(promptId)) {
        return { outcome: "already-stopped", mechanism: "guarded-interrupt" } as const;
      }

      // Re-read immediately under the same application admission lock. A
      // legacy /interrupt is global, so never send it if the exact prompt is
      // no longer the active prompt on this backend.
      queue = await readQueue();
      const running = queuePromptIds(queue?.queue_running);
      if (running.length !== 1 || running[0] !== promptId) {
        throw new Error("Cancellation was safely refused because the active ComfyUI prompt changed.");
      }
      const interrupted = await fetchWithTimeout(fetcher, `${baseUrl}/interrupt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt_id: promptId }),
      }, 10_000);
      if (!interrupted.ok) throw new Error(`ComfyUI interrupt returned HTTP ${interrupted.status}.`);
      return { outcome: "cancel-requested", mechanism: "guarded-interrupt" } as const;
    },
  );
  if (!guarded.ok) throw new Error(guarded.error);
  return guarded.value;
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
  const resolvedH3Settings = resolveH3RenderSettings(
    requirements.h3Settings || DEFAULT_H3_ADVANCED_SETTINGS,
    requirements.referenceCount || 0,
  );
  const optionNodeClasses = [
    ...(resolvedH3Settings.refModRetention !== null
      ? ["MiniMaxH3RefModExtract", "MiniMaxH3RefModApply"]
      : []),
    ...(resolvedH3Settings.motionLabInject !== null
      ? ["H3JerkOracle", "H3TimeSmear", "H3V2VInit", "H3InjectSchedule", "H3ExactRecover"]
      : []),
  ];
  const optionAssets: Array<readonly [string, string, string]> = [
    ...(resolvedH3Settings.checkpoint === H3_SINGULARITY_CHECKPOINT
      ? [["UNETLoader", "unet_name", H3_SINGULARITY_CHECKPOINT] as const]
      : []),
    ...resolvedH3Settings.singularityLoras.map(
      (lora) => ["LoraLoaderModelOnly", "lora_name", lora.filename] as const,
    ),
  ];
  const optionCacheKey = JSON.stringify({
    checkpoint: resolvedH3Settings.checkpoint,
    loras: resolvedH3Settings.singularityLoras.map((lora) => lora.filename),
    refMod: resolvedH3Settings.refModRetention !== null,
    motion: resolvedH3Settings.motionLabInject !== null,
  });
  const cacheKey = `${backend}:${requirements.requireVsr ? "vsr" : "native"}:${optionCacheKey}:${userLoraFilenames.join("\u0000")}`;
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
        ...optionNodeClasses,
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

      const expectedAssets = [
        ...h3ExpectedAssetChoicesForBackend(backend, userLoraFilenames),
        ...optionAssets,
      ];

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
    const compatible = !missingNodes.length && !missingAssets.length;
    return {
      backend,
      healthy: true,
      compatible,
      // OTG_H3_COMFY_QUEUE_TELEMETRY_NO_LOCK_V1
      // Running/pending Comfy work affects routing preference only.
      // It must not make a healthy compatible backend inadmissible.
      idle: compatible && !queueBusy,
      reason: !compatible
        ? "missing-dependencies"
        : queueBusy
          ? "comfy-queue-active"
          : "available",
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
  extraData?: unknown;
  livePreviewEnabled?: unknown;
  workerId?: string;
  fetcher?: typeof fetch;
  preSubmitCleanup?: "free" | null;
  onAccepted?: (
    promptId: string,
  ) => Promise<void> | void;
}) {
  const fetcher =
    args.fetcher || fetch;

  const response =
    await submitComfyPromptWithGpuLease({
      baseUrl:
        H3_BACKEND_PROFILES[
          args.backend
        ].baseUrl,
      workerId:
        args.workerId
        || "production-v2-h3",
      ownerId:
        args.jobId,
      purpose: "video",
      preSubmitCleanup:
        args.preSubmitCleanup
        ?? null,
      onPromptAccepted:
        args.onAccepted,
      fetcher:
        (url, init) =>
          fetchWithTimeout(
            fetcher,
            url,
            init,
            60_000,
          ),
      init: {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body:
          JSON.stringify(
            buildH3PromptSubmissionBody({
              graph: args.graph,
              clientId: args.clientId,
              extraData: args.extraData,
              livePreviewEnabled: args.livePreviewEnabled,
            }),
          ),
      },
    });

  const text =
    await response
      .text()
      .catch(() => "");

  let payload:
    Record<string, unknown> = {};

  if (text) {
    try {
      payload =
        JSON.parse(text) as
          Record<string, unknown>;
    } catch {
      payload = {
        message: text,
      };
    }
  }

  const promptId =
    clean(
      payload.prompt_id
      || payload.promptId,
    );

  if (!response.ok) {
    return {
      accepted: false as const,
      status:
        response.status,
      error:
        clean(
          payload.error
          || payload.message
          || text,
        )
        || (
          "ComfyUI rejected the prompt "
          + `with HTTP ${response.status}.`
        ),
    };
  }

  if (!promptId) {
    throw new Error(
      "ComfyUI returned a successful but unreadable prompt response; submission acceptance is ambiguous.",
    );
  }

  return {
    accepted: true as const,
    promptId,
  };
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function buildH3PromptSubmissionBody(args: {
  graph: H3PromptGraph;
  clientId: string;
  extraData?: unknown;
  livePreviewEnabled?: unknown;
}) {
  const body: {
    prompt: H3PromptGraph;
    client_id: string;
    extra_data?: Record<string, unknown>;
  } = {
    prompt: args.graph,
    client_id: args.clientId,
  };
  const existing = plainRecord(args.extraData);
  if (args.livePreviewEnabled === true) {
    body.extra_data = {
      ...(existing || {}),
      preview_method: "latent2rgb",
    };
  } else if (existing) {
    body.extra_data = { ...existing };
  }
  return body;
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
