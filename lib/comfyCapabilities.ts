import fs from "node:fs";
import path from "node:path";

export const COMFY_SUPPORT_STATES = [
  "verified",
  "installed-not-tested",
  "unsupported-vram",
  "missing-model",
  "missing-node",
  "unhealthy",
  "disabled",
] as const;

export type ComfySupportState = (typeof COMFY_SUPPORT_STATES)[number];

export type BackendSupport = {
  state: ComfySupportState;
  reason: string;
  missingNodes?: string[];
  missingModels?: string[];
  testedConfiguration?: Record<string, unknown> | null;
  estimatedOrMeasuredVramGb?: number | null;
};

export type ComfyBackendCapability = {
  id: string;
  label: string;
  url: string;
  gpu: string;
  vramGb: number;
  priority: number;
  health: "healthy" | "unhealthy";
  availableNodeClassTypes: string[];
  availableModelFilenames: string[];
  supportedWorkflowIds: string[];
  lastVerifiedAt: string;
};

export type WorkflowCapability = {
  id: string;
  workflowFile: string;
  kind: "image" | "video" | "audio";
  requiredNodeTypes: string[];
  requiredModels: string[];
  requiredLoras: string[];
  requiredInputAssets: string[];
  expectedInputCount: number;
  expectedOutputTypes: string[];
  estimatedOrMeasuredVramGb: number | null;
  backendSupport: Record<string, BackendSupport>;
};

export type ComfyCapabilityRegistry = {
  manifestVersion: string;
  policy: { primaryBackendId: string; fallbackBackendId: string; requireVerifiedWorkflow: boolean };
  backends: ComfyBackendCapability[];
  workflows: WorkflowCapability[];
};

function configuredPath(envName: string, fallback: string) {
  const configured = String(process.env[envName] || "").trim();
  return configured ? (path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)) : path.resolve(process.cwd(), fallback);
}

function readJson(filename: string) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function nonEmpty(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid Comfy capability manifest field: ${field}.`);
}

export function validateComfyCapabilityRegistry(registry: ComfyCapabilityRegistry) {
  nonEmpty(registry?.manifestVersion, "manifestVersion");
  if (!Array.isArray(registry?.backends) || !registry.backends.length) throw new Error("Comfy backend manifest has no backends.");
  if (!Array.isArray(registry?.workflows) || !registry.workflows.length) throw new Error("Comfy workflow capability manifest has no workflows.");
  const backendIds = new Set<string>();
  for (const backend of registry.backends) {
    nonEmpty(backend.id, "backend.id");
    nonEmpty(backend.url, `backend.${backend.id}.url`);
    if (backendIds.has(backend.id)) throw new Error(`Duplicate Comfy backend id: ${backend.id}.`);
    backendIds.add(backend.id);
  }
  if (!backendIds.has(registry.policy.primaryBackendId) || !backendIds.has(registry.policy.fallbackBackendId)) {
    throw new Error("Comfy capability policy references an unknown backend.");
  }
  const workflowIds = new Set<string>();
  for (const workflow of registry.workflows) {
    nonEmpty(workflow.id, "workflow.id");
    if (workflowIds.has(workflow.id)) throw new Error(`Duplicate Comfy workflow id: ${workflow.id}.`);
    workflowIds.add(workflow.id);
    for (const backendId of backendIds) {
      const support = workflow.backendSupport?.[backendId];
      if (!support || !COMFY_SUPPORT_STATES.includes(support.state)) {
        throw new Error(`Workflow ${workflow.id} has invalid support state for ${backendId}.`);
      }
      nonEmpty(support.reason, `workflow.${workflow.id}.${backendId}.reason`);
    }
  }
  return registry;
}

export function loadComfyCapabilityRegistry(): ComfyCapabilityRegistry {
  const backendDocument = readJson(configuredPath("OTG_COMFY_BACKENDS_FILE", "config/comfy-backends.json"));
  const workflowDocument = readJson(configuredPath("OTG_COMFY_WORKFLOW_CAPABILITIES_FILE", "config/comfy-workflow-capabilities.json"));
  if (backendDocument.manifestVersion !== workflowDocument.manifestVersion) {
    throw new Error("Comfy backend and workflow capability manifest versions do not match.");
  }
  return validateComfyCapabilityRegistry({
    manifestVersion: backendDocument.manifestVersion,
    policy: backendDocument.policy,
    backends: backendDocument.backends,
    workflows: workflowDocument.workflows,
  });
}

function normalizeWorkflowId(value: unknown) {
  return String(value || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^.*comfy_workflows\//i, "")
    .replace(/\.json$/i, "")
    .toLowerCase();
}

export function resolveWorkflowCapability(descriptor: Record<string, unknown>, registry = loadComfyCapabilityRegistry()) {
  const candidates = [descriptor.workflowId, descriptor.preset, descriptor.workflowFile, descriptor.workflowPath]
    .map(normalizeWorkflowId)
    .filter(Boolean);
  return registry.workflows.find((workflow) => {
    const ids = [normalizeWorkflowId(workflow.id), normalizeWorkflowId(workflow.workflowFile)];
    return candidates.some((candidate) => ids.includes(candidate));
  }) || null;
}

export function compatibilityError(backend: ComfyBackendCapability, workflow: WorkflowCapability | null, support?: BackendSupport) {
  const workflowName = workflow?.id || "requested workflow";
  const reason = support?.reason || "No capability record exists for this workflow.";
  return `${backend.label} cannot run ${workflowName}: ${reason}`;
}

// OTG_CHARACTER_FULL_BODY_PRIMARY_ATTEMPT_GATE_V1
export function primaryManifestSupportAllowsAttempt(
  workflow: WorkflowCapability,
  support: BackendSupport,
  requireVerifiedWorkflow: boolean,
) {
  if (!requireVerifiedWorkflow) return true;
  if (support.state === "verified") return true;

  const isEditImageWorkflow = normalizeWorkflowId(workflow.id) === "presets/edit image";
  if (!isEditImageWorkflow || support.state !== "installed-not-tested") return false;

  return (support.missingNodes?.length || 0) === 0 &&
    (support.missingModels?.length || 0) === 0;
}

export function assertWorkflowInputCount(workflow: WorkflowCapability, suppliedInputCount: number | null | undefined) {
  if (suppliedInputCount === null || suppliedInputCount === undefined) return { ok: true as const };
  if (suppliedInputCount === workflow.expectedInputCount) return { ok: true as const };
  return {
    ok: false as const,
    error: `${workflow.id} requires ${workflow.expectedInputCount} input asset(s); received ${suppliedInputCount}.`,
  };
}

async function backendHealthy(backend: ComfyBackendCapability, timeoutMs = 2_000) {
  try {
    const response = await fetch(backend.url.replace(/\/+$/, "") + "/system_stats", {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { ok: false as const, reason: "HTTP " + response.status };
    const stats = await response.json();
    const deviceNames = (Array.isArray(stats?.devices) ? stats.devices : []).map((device: any) => String(device?.name || ""));
    const expected = backend.id === "rtx3090" ? "rtx 3090" : backend.id === "rtx5060ti" ? "rtx 5060 ti" : backend.gpu.toLowerCase();
    const matches = deviceNames.some((name: string) => name.toLowerCase().includes(expected));
    return matches ? { ok: true as const } : { ok: false as const, reason: "Expected " + backend.gpu + "; received " + (deviceNames.join(", ") || "no CUDA device") + "." };
  } catch (error: any) {
    return { ok: false as const, reason: error?.name === "TimeoutError" ? "Timed out after " + timeoutMs + "ms" : String(error?.message || error) };
  }
}

export async function selectManifestBackend(descriptor: Record<string, unknown>, suppliedInputCount?: number | null) {
  const registry = loadComfyCapabilityRegistry();
  const workflow = resolveWorkflowCapability(descriptor, registry);
  if (!workflow) return { ok: false as const, status: 503, error: "The requested workflow is not present in the active Comfy capability manifest.", manifestVersion: registry.manifestVersion };
  const inputCheck = assertWorkflowInputCount(workflow, suppliedInputCount);
  if (!inputCheck.ok) return { ...inputCheck, status: 400, manifestVersion: registry.manifestVersion, workflow };
  const primary = registry.backends.find((backend) => backend.id === registry.policy.primaryBackendId)!;
  const fallback = registry.backends.find((backend) => backend.id === registry.policy.fallbackBackendId)!;
  // OTG_CHARACTER_REFERENCE_EXPLICIT_GPU_V1
  const normalizedWorkflowId = normalizeWorkflowId(workflow.id);
  const requestedGpuTarget = String(descriptor.gpuTarget || "").trim().toLowerCase();
  const characterReferenceWorkflow = normalizedWorkflowId.startsWith("internal/character-reference/");

  const requestedBackendId =
    requestedGpuTarget === "3090" || requestedGpuTarget === "rtx3090"
      ? "rtx3090"
      : requestedGpuTarget === "5060" ||
          requestedGpuTarget === "5060ti" ||
          requestedGpuTarget === "rtx5060ti"
        ? "rtx5060ti"
        : null;

  if (characterReferenceWorkflow && requestedBackendId) {
    const requestedBackend = registry.backends.find((backend) => backend.id === requestedBackendId)!;
    const requestedSupport = workflow.backendSupport[requestedBackendId];

    if (requestedSupport?.state !== "verified") {
      return {
        ok: false as const,
        status: 503,
        error: compatibilityError(requestedBackend, workflow, requestedSupport),
        manifestVersion: registry.manifestVersion,
        workflow,
      };
    }

    const requestedProbe = await backendHealthy(requestedBackend);
    if (!requestedProbe.ok) {
      return {
        ok: false as const,
        status: 503,
        error: requestedBackend.label + " is unavailable: " + requestedProbe.reason,
        manifestVersion: registry.manifestVersion,
        workflow,
      };
    }

    return {
      ok: true as const,
      backend: requestedBackend,
      workflow,
      fallbackActive: requestedBackend.id === fallback.id,
      fallbackReason: null,
      selectionReason: "character_reference_explicit_" + requestedBackend.id,
      manifestVersion: registry.manifestVersion,
      requestedProbe,
    };
  }
  // OTG_QWEN_CHARACTER_REFERENCE_5060_DEFAULT_V1
  // Qwen character-reference generation is image-lane work. Unless the caller
  // explicitly selected a GPU above, keep this workflow on the RTX 5060 Ti
  // and do not spill it onto the RTX 3090 video lane.
  if (
    characterReferenceWorkflow &&
    normalizedWorkflowId === "internal/character-reference/qwen_character_4angle_lowres" &&
    !requestedBackendId
  ) {
    const imageBackend = registry.backends.find((backend) => backend.id === "rtx5060ti");
    const imageSupport = workflow.backendSupport.rtx5060ti;

    if (!imageBackend || imageSupport?.state !== "verified") {
      return {
        ok: false as const,
        status: 503,
        error: "RTX 5060 Ti is not verified for this Qwen character-reference workflow.",
        manifestVersion: registry.manifestVersion,
        workflow,
      };
    }

    const imageProbe = await backendHealthy(imageBackend);
    if (!imageProbe.ok) {
      return {
        ok: false as const,
        status: 503,
        error: imageBackend.label + " is unavailable: " + imageProbe.reason,
        manifestVersion: registry.manifestVersion,
        workflow,
        fallbackProbe: imageProbe,
      };
    }

    return {
      ok: true as const,
      backend: imageBackend,
      workflow,
      fallbackActive: imageBackend.id === fallback.id,
      fallbackReason: null,
      selectionReason: "character_reference_default_rtx5060ti",
      manifestVersion: registry.manifestVersion,
      fallbackProbe: imageProbe,
    };
  }

  const primarySupport = workflow.backendSupport[primary.id];
  const fallbackSupport = workflow.backendSupport[fallback.id];

  // OTG_EDIT_IMAGE_5060_PREFERRED_V1
  // Edit Image is verified on the RTX 5060 Ti. Prefer that image lane
  // before trying the RTX 3090. If the 5060 is unavailable, the normal
  // primary compatibility path below may still use the dependency-complete
  // RTX 3090 as recovery.
  const preferVerifiedEditImage5060 =
    normalizeWorkflowId(workflow.id) === "presets/edit image" &&
    fallback.id === "rtx5060ti" &&
    fallbackSupport?.state === "verified";

  let preferredEditImage5060Probe:
    | Awaited<ReturnType<typeof backendHealthy>>
    | null = null;

  if (preferVerifiedEditImage5060) {
    preferredEditImage5060Probe = await backendHealthy(fallback);

    if (preferredEditImage5060Probe.ok) {
      return {
        ok: true as const,
        backend: fallback,
        workflow,
        fallbackActive: true,
        fallbackReason: null,
        selectionReason: "edit_image_verified_rtx5060ti_preferred",
        manifestVersion: registry.manifestVersion,
        fallbackProbe: preferredEditImage5060Probe,
      };
    }
  }

  const primaryProbe = await backendHealthy(primary);
  const primaryAttemptAllowed = primaryManifestSupportAllowsAttempt(
    workflow,
    primarySupport,
    registry.policy.requireVerifiedWorkflow,
  );
  if (primaryProbe.ok && primaryAttemptAllowed) {
    const selectionReason = primarySupport.state === "verified"
      ? "primary_healthy_verified"
      : "primary_healthy_dependency_complete_installed_not_tested";
    return { ok: true as const, backend: primary, workflow, fallbackActive: false, fallbackReason: null, selectionReason, manifestVersion: registry.manifestVersion, primaryProbe };
  }
  const primaryReason = primaryProbe.ok ? compatibilityError(primary, workflow, primarySupport) : primaryProbe.reason;
  if (fallbackSupport.state !== "verified") {
    return {
      ok: false as const,
      status: 503,
      error: (primaryProbe.ok ? primaryReason + " " : "RTX 3090 is unavailable. ") + "This workflow is not verified for the RTX 5060 Ti because: " + fallbackSupport.reason,
      manifestVersion: registry.manifestVersion,
      workflow,
      primaryProbe,
    };
  }
  const fallbackProbe =
    preferredEditImage5060Probe ?? await backendHealthy(fallback);
  if (!fallbackProbe.ok) return { ok: false as const, status: 503, error: primaryReason + " RTX 5060 Ti is unhealthy: " + fallbackProbe.reason, manifestVersion: registry.manifestVersion, workflow, primaryProbe, fallbackProbe };
  return { ok: true as const, backend: fallback, workflow, fallbackActive: true, fallbackReason: primaryReason, selectionReason: primaryProbe.ok ? "primary_incompatible_verified_fallback" : "primary_unavailable_verified_fallback", manifestVersion: registry.manifestVersion, primaryProbe, fallbackProbe };
}
