import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { OTG_DATA_ROOT, safeJoin, safeSegment } from "@/lib/paths";
import {
  H3_BACKEND_PROFILES,
  H3_VSR_REQUIRED_NODE_CLASSES,
  h3ExpectedAssetChoicesForBackend,
  h3NativeCheckpointForBackend,
  h3TurboLoraForMode,
  h3RequiredNodeClassesForBackend,
  type H3PromptGraph,
  type ProductionV2H3BackendId,
  type ProductionV2H3Mode,
} from "@/lib/production/h3Workflows";
import {
  DEFAULT_H3_ADVANCED_SETTINGS,
  H3_SINGULARITY_CHECKPOINT,
  resolveH3RenderSettings,
  type H3AdvancedSettings,
} from "@/lib/production/h3Settings";
import {
  ensureComfyClientProgressMonitor,
  recordComfyPromptSubmitted,
  waitForComfyClientProgressMonitor,
} from "@/lib/comfyProgress";
import { submitComfyPromptWithGpuLease } from "@/lib/workers/comfyPromptLease";

type ObjectInfo = Record<string, {
  input?: {
    required?: Record<string, unknown>;
    optional?: Record<string, unknown>;
  };
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
  requireRife60Fps?: boolean;
  h3Settings?: H3AdvancedSettings;
  referenceCount?: number;

  mode?: ProductionV2H3Mode;
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
  const descriptor =
    info[node]?.input?.required?.[input]
    ?? info[node]?.input?.optional?.[input];
  if (!Array.isArray(descriptor)) return [];
  const first = descriptor[0];
  if (Array.isArray(first)) return first.map(clean).filter(Boolean);
  if (first && typeof first === "object" && Array.isArray((first as { options?: unknown }).options)) {
    return ((first as { options: unknown[] }).options).map(clean).filter(Boolean);
  }
  const second = descriptor[1];
  if (second && typeof second === "object" && Array.isArray((second as { options?: unknown }).options)) {
    return ((second as { options: unknown[] }).options).map(clean).filter(Boolean);
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
      ? [
          "H3JerkOracle",
          "H3TimeSmear",
          "H3V2VInit",
          "H3InjectSchedule",
          "H3ExactRecover",
        ]
      : []),
  ];

  const selectedAdvancedCheckpoint =
    resolvedH3Settings.checkpoint
      === H3_SINGULARITY_CHECKPOINT
      ? H3_SINGULARITY_CHECKPOINT
      : (
          resolvedH3Settings.settings.renderMode
            === "native"
          && requirements.mode
        )
        ? h3NativeCheckpointForBackend(
            backend,
            requirements.mode,
          )
        : null;

  const selectedAdvancedTurboLora =
    resolvedH3Settings.settings.renderMode
      === "turbo"
    && resolvedH3Settings.settings.checkpointMode
      === "singularity"
    && requirements.mode
      ? h3TurboLoraForMode(
          requirements.mode,
        )
      : null;

  const optionAssets: Array<
    readonly [string, string, string]
  > = [
    ...(selectedAdvancedCheckpoint
      ? [
          [
            "UNETLoader",
            "unet_name",
            selectedAdvancedCheckpoint,
          ] as const,
        ]
      : []),

    ...(selectedAdvancedTurboLora
      ? [
          [
            "LoraLoaderModelOnly",
            "lora_name",
            selectedAdvancedTurboLora,
          ] as const,
        ]
      : []),

    ...resolvedH3Settings.singularityLoras.map(
      (lora) =>
        [
          "LoraLoaderModelOnly",
          "lora_name",
          lora.filename,
        ] as const,
    ),
  ];

  const optionCacheKey = JSON.stringify({
    mode: requirements.mode || null,

    renderMode:
      resolvedH3Settings.settings.renderMode,

    checkpoint:
      selectedAdvancedCheckpoint
      || resolvedH3Settings.checkpoint,

    turboLora:
      selectedAdvancedTurboLora,

    loras:
      resolvedH3Settings.singularityLoras.map(
        (lora) => lora.filename,
      ),

    refMod:
      resolvedH3Settings.refModRetention !== null,

    motion:
      resolvedH3Settings.motionLabInject !== null,
  });

  const cacheKey = `${backend}:${requirements.requireVsr ? "vsr" : "native"}:${requirements.requireRife60Fps ? "rife60" : "rife-off"}:${optionCacheKey}:${userLoraFilenames.join("\u0000")}`;
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
        ...(requirements.requireRife60Fps ? [
          "VHS_LoadVideo",
          "RIFE_FPS_Resample",
          "VHS_VideoCombine",
        ] : []),
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

        ...h3ExpectedAssetChoicesForBackend(

          backend,

          userLoraFilenames,

        ),

        ...optionAssets,

        ...(requirements.requireRife60Fps ? [
          [
            "RIFE_FPS_Resample",
            "ckpt_name",
            "rife47.pth",
          ] as const,
        ] : []),

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

export async function uploadH3InputToBaseUrl(args: {
  baseUrl: string;
  sourcePath: string;
  mediaType: "image" | "audio" | "video";
  uploadName: string;
  subfolder?: string;
  fetcher?: typeof fetch;
}) {
  const absolutePath = resolveProductionV2MediaPath(args.sourcePath);
  if (!absolutePath) throw new Error(`Production ${args.mediaType} source is not a readable local file: ${args.sourcePath}`);
  const bytes = await fsp.readFile(absolutePath);
  const extension = path.extname(absolutePath).toLowerCase();
  const filename = `${safeSegment(args.uploadName)}${extension}`;
  const fetcher = args.fetcher || fetch;
  const baseUrl = args.baseUrl.replace(/\/+$/, "");
  const endpoints = args.mediaType === "audio"
    ? [["/upload/image", "image"], ["/upload/audio", "audio"], ["/upload/audio", "image"], ["/upload/image", "audio"]] as const
    : [["/upload/image", "image"]] as const;
  const failures: string[] = [];
  for (const [endpoint, field] of endpoints) {
    const body = new FormData();
    body.append(field, new Blob([bytes]), filename);
    body.append("type", "input");
    body.append("overwrite", "true");
    if (args.subfolder) body.append("subfolder", args.subfolder);
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

export async function uploadH3Input(args: {
  backend: ProductionV2H3BackendId;
  sourcePath: string;
  mediaType: "image" | "audio" | "video";
  uploadName: string;
  fetcher?: typeof fetch;
}) {
  return uploadH3InputToBaseUrl({
    baseUrl: H3_BACKEND_PROFILES[args.backend].baseUrl,
    sourcePath: args.sourcePath,
    mediaType: args.mediaType,
    uploadName: args.uploadName,
    fetcher: args.fetcher,
  });
}

export async function submitH3PromptToBaseUrl(args: {
  baseUrl: string;
  graph: H3PromptGraph;
  clientId: string;
  jobId: string;
  ownerKey?: string | null;
  deviceId?: string | null;
  workerId?: string;
  fetcher?: typeof fetch;
  preSubmitCleanup?: "free" | null;
  onAccepted?: (
    promptId: string,
  ) => Promise<void> | void;
}) {
  const fetcher =
    args.fetcher || fetch;
  const baseUrl = args.baseUrl.replace(/\/+$/, "");

  ensureComfyClientProgressMonitor({
    comfyBaseUrl:
      baseUrl,
    clientId:
      args.clientId,
    idleTimeoutMs:
      90 * 60_000,
  });
  await waitForComfyClientProgressMonitor({
    comfyBaseUrl:
      baseUrl,
    clientId:
      args.clientId,
    timeoutMs:
      1500,
  }).catch(
    () => false,
  );

  const response =
    await submitComfyPromptWithGpuLease({
      baseUrl:
        baseUrl,
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
          JSON.stringify({
            prompt: args.graph,
            client_id:
              args.clientId,
          }),
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

  recordComfyPromptSubmitted({
    promptId,
    ownerKey:
      args.ownerKey
      || args.jobId,
    deviceId:
      args.deviceId
      || "",
    clientId:
      args.clientId,
    comfyBaseUrl:
      baseUrl,
    totalNodes:
      Object.keys(args.graph).length,
  });

  return {
    accepted: true as const,
    promptId,
  };
}

export async function submitH3Prompt(args: {
  backend: ProductionV2H3BackendId;
  graph: H3PromptGraph;
  clientId: string;
  jobId: string;
  ownerKey?: string | null;
  deviceId?: string | null;
  workerId?: string;
  fetcher?: typeof fetch;
  preSubmitCleanup?: "free" | null;
  onAccepted?: (
    promptId: string,
  ) => Promise<void> | void;
}) {
  return submitH3PromptToBaseUrl({
    baseUrl: H3_BACKEND_PROFILES[args.backend].baseUrl,
    graph: args.graph,
    clientId: args.clientId,
    jobId: args.jobId,
    ownerKey: args.ownerKey,
    deviceId: args.deviceId,
    workerId: args.workerId,
    fetcher: args.fetcher,
    preSubmitCleanup: args.preSubmitCleanup,
    onAccepted: args.onAccepted,
  });
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

export async function getH3PromptHistoryFromBaseUrl(
  baseUrl: string,
  promptId: string,
  fetcher: typeof fetch = fetch,
  outputNodeId = "5",
) {
  const response = await fetchWithTimeout(fetcher, `${baseUrl.replace(/\/+$/, "")}/history/${encodeURIComponent(promptId)}`, {}, 15_000);
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

export async function getH3PromptHistory(
  backend: ProductionV2H3BackendId,
  promptId: string,
  fetcher: typeof fetch = fetch,
  outputNodeId = "5",
) {
  return getH3PromptHistoryFromBaseUrl(
    H3_BACKEND_PROFILES[backend].baseUrl,
    promptId,
    fetcher,
    outputNodeId,
  );
}

export async function downloadH3VideoFromBaseUrl(args: {
  baseUrl: string;
  file: ComfyHistoryFile;
  ownerKey: string;
  productionId: string;
  sceneId: string;
  generationJobId: string;
  artifactSuffix?: string;
  fetcher?: typeof fetch;
}) {
  const url = new URL(`${args.baseUrl.replace(/\/+$/, "")}/view`);
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
  return downloadH3VideoFromBaseUrl({
    baseUrl: H3_BACKEND_PROFILES[args.backend].baseUrl,
    file: args.file,
    ownerKey: args.ownerKey,
    productionId: args.productionId,
    sceneId: args.sceneId,
    generationJobId: args.generationJobId,
    artifactSuffix: args.artifactSuffix,
    fetcher: args.fetcher,
  });
}
