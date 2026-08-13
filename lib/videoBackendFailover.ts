import fs from "node:fs";
import path from "node:path";
import { compatibilityError, loadComfyCapabilityRegistry, resolveWorkflowCapability } from "@/lib/comfyCapabilities";
import { normalizeVideoLoraFilename } from "@/lib/videoLoras";

export type VideoCompatibilityMode = "compatible" | "3090_only" | "reduced";

export type VideoReduction = {
  maxWidth?: number;
  maxHeight?: number;
  maxFrames?: number;
  maxBatchSize?: number;
  nodeOverrides?: Record<string, Record<string, unknown>>;
};

export type VideoWorkflowCompatibility = {
  id: string;
  aliases?: string[];
  mode: VideoCompatibilityMode;
  reductions?: VideoReduction;
  requiredModels?: string[];
  requiredNodes?: string[];
  notes?: string;
};

export type VideoCompatibilityRegistry = {
  version: number;
  defaultMode: VideoCompatibilityMode;
  workflows: VideoWorkflowCompatibility[];
};

export type VideoBackend = {
  id: "rtx3090" | "rtx5060ti";
  label: string;
  gpu: string;
  vramGb: number;
  baseUrl: string;
};

export type BackendProbe = {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  gpuName: string | null;
  error: string | null;
};

export type VideoLoraRoutingRequirement = { id: string; displayName: string; filename: string };
export type VideoLoraRoutingOptions = {
  selectedLoras?: VideoLoraRoutingRequirement[];
  installedByBackend?: Record<string, Iterable<string>>;
};

export const NO_FALLBACK_ERROR =
  "RTX 3090 unavailable and this workflow has no compatible RTX 5060 Ti fallback.";

function unverifiedFallbackError(reason: string) {
  return "RTX 3090 is unavailable. This workflow is not verified for the RTX 5060 Ti because: " + reason;
}

function normalizeUrl(value: unknown) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function videoBackends(): { primary: VideoBackend; fallback: VideoBackend } {
  return {
    primary: {
      id: "rtx3090",
      label: "RTX 3090 primary",
      gpu: "NVIDIA GeForce RTX 3090",
      vramGb: 24,
      baseUrl: normalizeUrl(
        process.env.OTG_VIDEO_PRIMARY_COMFY_URL ||
          process.env.COMFYUI_VIDEO_PRIMARY_URL ||
          "http://100.75.162.64:8188"
      ),
    },
    fallback: {
      id: "rtx5060ti",
      label: "RTX 5060 Ti fallback",
      gpu: "NVIDIA GeForce RTX 5060 Ti",
      vramGb: 16,
      baseUrl: normalizeUrl(
        process.env.OTG_VIDEO_FALLBACK_COMFY_URL ||
          process.env.COMFYUI_VIDEO_FALLBACK_URL ||
          process.env.COMFYUI_IMAGE_URL ||
          "http://127.0.0.1:8188"
      ),
    },
  };
}

export function videoHealthTimeoutMs() {
  return positiveInteger(process.env.OTG_VIDEO_HEALTH_TIMEOUT_MS, 2000);
}

export function videoSubmitTimeoutMs() {
  return positiveInteger(process.env.OTG_VIDEO_SUBMIT_TIMEOUT_MS, 60_000);
}

function compatibilityFilePath() {
  const configured = String(process.env.OTG_VIDEO_COMPATIBILITY_FILE || "").trim();
  if (configured) return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  return path.resolve(process.cwd(), "config", "video_workflow_compatibility.json");
}

export function loadVideoCompatibilityRegistry(): VideoCompatibilityRegistry {
  const raw = fs.readFileSync(compatibilityFilePath(), "utf8");
  const parsed = JSON.parse(raw) as VideoCompatibilityRegistry;
  if (!parsed || !Array.isArray(parsed.workflows)) throw new Error("Invalid video compatibility registry.");
  return {
    version: Number(parsed.version || 1),
    defaultMode: parsed.defaultMode || "3090_only",
    workflows: parsed.workflows,
  };
}

export function videoWorkflowKey(descriptor: Record<string, unknown>) {
  return [
    descriptor.workflowId,
    descriptor.preset,
    descriptor.workflowFile,
    descriptor.workflowPath,
    descriptor.workflowLabel,
    descriptor.label,
    descriptor.requestKind,
    descriptor.mode,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

export function resolveVideoCompatibility(
  descriptor: Record<string, unknown>,
  registry = loadVideoCompatibilityRegistry()
): VideoWorkflowCompatibility {
  const key = videoWorkflowKey(descriptor);
  let best: VideoWorkflowCompatibility | null = null;
  let bestLength = -1;
  for (const entry of registry.workflows) {
    for (const aliasRaw of [entry.id, ...(entry.aliases || [])]) {
      const alias = String(aliasRaw || "").trim().toLowerCase();
      if (alias && key.includes(alias) && alias.length > bestLength) {
        best = entry;
        bestLength = alias.length;
      }
    }
  }
  return best || {
    id: "unclassified-video-workflow",
    mode: registry.defaultMode || "3090_only",
    notes: "Unclassified workflows are never sent to the 16 GB fallback.",
  };
}

function scalarNumber(value: unknown): number | null {
  if (Array.isArray(value) || value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function capInput(inputs: Record<string, unknown>, names: string[], cap?: number) {
  if (!cap) return [] as string[];
  const changed: string[] = [];
  for (const name of names) {
    const current = scalarNumber(inputs[name]);
    if (current !== null && current > cap) {
      inputs[name] = cap;
      changed.push(name);
    }
  }
  return changed;
}

export function applyFallbackReductions(graph: Record<string, any>, reduction?: VideoReduction) {
  const applied: string[] = [];
  if (!reduction) return applied;
  for (const [nodeId, node] of Object.entries<any>(graph || {})) {
    if (!node?.inputs || typeof node.inputs !== "object") continue;
    for (const name of capInput(node.inputs, ["width", "latent_width", "target_width"], reduction.maxWidth)) {
      applied.push(`${nodeId}.${name}`);
    }
    for (const name of capInput(node.inputs, ["height", "latent_height", "target_height"], reduction.maxHeight)) {
      applied.push(`${nodeId}.${name}`);
    }
    for (const name of capInput(
      node.inputs,
      ["num_frames", "frames", "frame_count", "length", "video_length", "max_frames"],
      reduction.maxFrames
    )) {
      applied.push(`${nodeId}.${name}`);
    }
    for (const name of capInput(node.inputs, ["batch_size", "batch", "num_videos"], reduction.maxBatchSize)) {
      applied.push(`${nodeId}.${name}`);
    }
  }
  for (const [nodeId, overrides] of Object.entries(reduction.nodeOverrides || {})) {
    const inputs = graph?.[nodeId]?.inputs;
    if (!inputs || typeof inputs !== "object") continue;
    for (const [name, value] of Object.entries(overrides)) {
      inputs[name] = value;
      applied.push(`${nodeId}.${name}`);
    }
  }
  return applied;
}

function gpuNameFromStats(stats: any): string | null {
  const devices = Array.isArray(stats?.devices) ? stats.devices : [];
  const name = devices.map((device: any) => String(device?.name || "").trim()).find(Boolean);
  return name || null;
}

export async function probeVideoBackend(baseUrl: string, timeoutMs = videoHealthTimeoutMs()): Promise<BackendProbe> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${normalizeUrl(baseUrl)}/system_stats`, {
      cache: "no-store",
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
      gpuName: gpuNameFromStats(json),
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error: any) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      gpuName: null,
      error: error?.name === "AbortError" ? `Timed out after ${timeoutMs}ms` : String(error?.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function enumValues(definition: any): string[] | null {
  const required = definition?.input?.required || {};
  const optional = definition?.input?.optional || {};
  const out: string[] = [];
  for (const spec of [...Object.values<any>(required), ...Object.values<any>(optional)]) {
    if (Array.isArray(spec?.[0]) && spec[0].every((value: unknown) => typeof value === "string")) {
      out.push(...spec[0]);
    }
  }
  return out.length ? out : null;
}

export async function validateFallbackWorkflow(
  graph: Record<string, any>,
  compatibility: VideoWorkflowCompatibility,
  fallbackBaseUrl: string,
  timeoutMs = videoHealthTimeoutMs() * 2
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${normalizeUrl(fallbackBaseUrl)}/object_info`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, missingNodes: [], missingModels: [], error: `Fallback /object_info returned HTTP ${response.status}.` };
    const objectInfo = await response.json();
    const missingNodes = new Set<string>();
    const missingModels = new Set<string>();
    for (const requiredNode of compatibility.requiredNodes || []) {
      if (!objectInfo?.[requiredNode]) missingNodes.add(requiredNode);
    }
    for (const node of Object.values<any>(graph || {})) {
      const classType = String(node?.class_type || "").trim();
      if (!classType) continue;
      const definition = objectInfo?.[classType];
      if (!definition) {
        missingNodes.add(classType);
        continue;
      }
      const available = enumValues(definition);
      if (!available) continue;
      const availableSet = new Set(available.map((value) => value.replace(/\\/g, "/").toLowerCase()));
      for (const value of Object.values<any>(node?.inputs || {})) {
        if (typeof value !== "string" || !/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i.test(value)) continue;
        if (!availableSet.has(value.replace(/\\/g, "/").toLowerCase())) missingModels.add(value);
      }
    }
    const availableText = JSON.stringify(objectInfo).toLowerCase();
    for (const model of compatibility.requiredModels || []) {
      if (!availableText.includes(String(model).toLowerCase())) missingModels.add(model);
    }
    return {
      ok: missingNodes.size === 0 && missingModels.size === 0,
      missingNodes: [...missingNodes].sort(),
      missingModels: [...missingModels].sort(),
      error: null,
    };
  } catch (error: any) {
    return {
      ok: false,
      missingNodes: [],
      missingModels: [],
      error: error?.name === "AbortError" ? `Fallback validation timed out after ${timeoutMs}ms.` : String(error?.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function clonePromptGraph<T>(graph: T): T {
  return JSON.parse(JSON.stringify(graph));
}

function missingSelectedLoras(backendId: string, options?: VideoLoraRoutingOptions) {
  const selected = options?.selectedLoras || [];
  if (!selected.length) return [];
  const installed = new Set(
    [...(options?.installedByBackend?.[backendId] || [])].map(normalizeVideoLoraFilename)
  );
  return selected.filter((lora) => !installed.has(normalizeVideoLoraFilename(lora.filename)));
}

function selectedLoraBackendError(backend: VideoBackend, missing: VideoLoraRoutingRequirement[]) {
  return `${backend.gpu.replace("NVIDIA GeForce ", "")} cannot run this request because LoRA ${missing.map((lora) => lora.displayName).join(", ")} is not installed.`;
}

export function primaryVideoSupportAllowsAttempt(
  support: { state?: string; missingNodes?: string[]; missingModels?: string[] } | null | undefined,
  requireVerifiedWorkflow: boolean
) {
  if (!support) return false;
  if (!requireVerifiedWorkflow) return true;

  const state = String(support.state || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");

  if (state === "verified") return true;
  if (state !== "installed-not-tested") return false;

  return (support.missingNodes?.length || 0) === 0 &&
    (support.missingModels?.length || 0) === 0;
}

export async function selectVideoBackend(
  descriptor: Record<string, unknown>,
  graph?: Record<string, any>,
  loraOptions?: VideoLoraRoutingOptions
) {
  const backends = videoBackends();
  const compatibility = resolveVideoCompatibility(descriptor);
  const capabilityRegistry = loadComfyCapabilityRegistry();
  const workflowCapability = resolveWorkflowCapability(descriptor, capabilityRegistry);
  const primaryCapability = capabilityRegistry.backends.find((backend) => backend.id === backends.primary.id);
  const fallbackCapability = capabilityRegistry.backends.find((backend) => backend.id === backends.fallback.id);
  if (!workflowCapability || !primaryCapability || !fallbackCapability) {
    return {
      ok: false as const,
      status: 503,
      error: "The requested workflow is not present in the active Comfy capability manifest.",
      compatibility,
      manifestVersion: capabilityRegistry.manifestVersion,
    };
  }

  const primarySupport = workflowCapability.backendSupport[backends.primary.id];
  const primaryProbe = await probeVideoBackend(backends.primary.baseUrl);
  const primaryMissingLoras = missingSelectedLoras(backends.primary.id, loraOptions);
  if (
    primaryProbe.ok &&
    !primaryMissingLoras.length &&
    primaryVideoSupportAllowsAttempt(primarySupport, capabilityRegistry.policy.requireVerifiedWorkflow)
  ) {
    return {
      ok: true as const,
      backend: backends.primary,
      fallbackActive: false,
      fallbackReason: null,
      compatibility,
      graph,
      reductionsApplied: [] as string[],
      primaryProbe,
      fallbackProbe: null,
      validation: null,
      workflowCapability,
      manifestVersion: capabilityRegistry.manifestVersion,
    };
  }

  const primaryReason = primaryProbe.ok && primaryMissingLoras.length
    ? selectedLoraBackendError(backends.primary, primaryMissingLoras)
    : primaryProbe.ok ? compatibilityError(primaryCapability, workflowCapability, primarySupport) : primaryProbe.error || "RTX 3090 health check failed.";
  const fallbackSupport = workflowCapability.backendSupport[backends.fallback.id];
  if (fallbackSupport.state !== "verified") {
    return {
      ok: false as const,
      status: primaryProbe.ok && primaryMissingLoras.length ? 409 : 503,
      error: primaryProbe.ok ? primaryReason + " This workflow is not verified for the RTX 5060 Ti because: " + fallbackSupport.reason : unverifiedFallbackError(fallbackSupport.reason),
      compatibility,
      workflowCapability,
      primaryProbe,
      manifestVersion: capabilityRegistry.manifestVersion,
    };
  }

  const fallbackMissingLoras = missingSelectedLoras(backends.fallback.id, loraOptions);
  if (fallbackMissingLoras.length) {
    return {
      ok: false as const,
      status: 409,
      error: selectedLoraBackendError(backends.fallback, fallbackMissingLoras),
      compatibility,
      workflowCapability,
      primaryProbe,
      manifestVersion: capabilityRegistry.manifestVersion,
    };
  }

  const fallbackProbe = await probeVideoBackend(backends.fallback.baseUrl);
  if (!fallbackProbe.ok) {
    return {
      ok: false as const,
      status: 503,
      error: NO_FALLBACK_ERROR + " RTX 5060 Ti fallback is also unavailable.",
      compatibility,
      primaryProbe,
      fallbackProbe,
      workflowCapability,
      manifestVersion: capabilityRegistry.manifestVersion,
    };
  }
  const fallbackGraph = graph ? clonePromptGraph(graph) : graph;
  const reductionsApplied = fallbackGraph && compatibility.mode === "reduced"
    ? applyFallbackReductions(fallbackGraph, compatibility.reductions)
    : [];
  const validation = fallbackGraph
    ? await validateFallbackWorkflow(fallbackGraph, compatibility, backends.fallback.baseUrl)
    : null;
  if (validation && !validation.ok) {
    const reason = validation.error || [
      validation.missingNodes.length ? "missing nodes: " + validation.missingNodes.join(", ") : "",
      validation.missingModels.length ? "missing models: " + validation.missingModels.join(", ") : "",
    ].filter(Boolean).join("; ");
    return {
      ok: false as const,
      status: 503,
      error: unverifiedFallbackError(reason || "live capability validation failed."),
      compatibility,
      primaryProbe,
      fallbackProbe,
      validation,
      workflowCapability,
      manifestVersion: capabilityRegistry.manifestVersion,
    };
  }
  return {
    ok: true as const,
    backend: backends.fallback,
    fallbackActive: true,
    fallbackReason: primaryReason,
    compatibility,
    graph: fallbackGraph,
    reductionsApplied,
    primaryProbe,
    fallbackProbe,
    validation,
    workflowCapability,
    manifestVersion: capabilityRegistry.manifestVersion,
  };
}

export async function prepareFallbackGraph(
  descriptor: Record<string, unknown>,
  graph: Record<string, any>,
  loraOptions?: VideoLoraRoutingOptions
) {
  const compatibility = resolveVideoCompatibility(descriptor);
  const registry = loadComfyCapabilityRegistry();
  const workflowCapability = resolveWorkflowCapability(descriptor, registry);
  const fallback = videoBackends().fallback;
  const support = workflowCapability?.backendSupport[fallback.id];
  if (!workflowCapability || !support || support.state !== "verified") {
    return {
      ok: false as const,
      status: 503,
      error: unverifiedFallbackError(support?.reason || "no capability record exists for this workflow."),
      compatibility,
      manifestVersion: registry.manifestVersion,
    };
  }
  const missingLoras = missingSelectedLoras(fallback.id, loraOptions);
  if (missingLoras.length) {
    return {
      ok: false as const,
      status: 409,
      error: selectedLoraBackendError(fallback, missingLoras),
      compatibility,
      manifestVersion: registry.manifestVersion,
    };
  }
  const fallbackGraph = clonePromptGraph(graph);
  const reductionsApplied = compatibility.mode === "reduced"
    ? applyFallbackReductions(fallbackGraph, compatibility.reductions)
    : [];
  const validation = await validateFallbackWorkflow(fallbackGraph, compatibility, fallback.baseUrl);
  if (!validation.ok) {
    return { ok: false as const, status: 503, error: NO_FALLBACK_ERROR, compatibility, validation };
  }
  return { ok: true as const, graph: fallbackGraph, compatibility, reductionsApplied, validation };
}

export function logVideoBackendJob(event: string, details: Record<string, unknown>) {
  console.info("[video-backend]", { event, ...details });
}
