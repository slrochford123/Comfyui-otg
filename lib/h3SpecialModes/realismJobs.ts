import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { readComfyPromptProgress, recordComfyPromptSubmitted, ensureComfyClientProgressMonitor } from "@/lib/comfyProgress";
import { clearGalleryListCache, safeGalleryName, writeMetaForFile, type GallerySource } from "@/lib/gallery";
import type { OwnerContext } from "@/lib/ownerKey";
import { deviceGalleryDir, ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment, userGalleryDir } from "@/lib/paths";
import { downloadH3Video, getH3PromptHistory, submitH3Prompt, uploadH3Input } from "@/lib/production/h3Comfy";
import {
  getH3NativeDimensions,
  getH3ProductionTimeEstimate,
  normalizeH3Orientation,
  normalizeH3Quality,
  type H3Orientation,
  type H3ProductionDuration,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";
import { H3_BACKEND_PROFILES, type ProductionV2H3BackendId } from "@/lib/production/h3Workflows";
import { validateH3RealismRequest, type H3RealismLoraSettingsInput } from "@/lib/h3SpecialModes/realism";
import { buildH3RealismWorkflow, type H3RealismBuiltWorkflow } from "@/lib/h3SpecialModes/realismWorkflow";

type ObjectInfo = Record<string, {
  input?: {
    required?: Record<string, unknown>;
    optional?: Record<string, unknown>;
  };
}>;

export type H3RealismReference = {
  kind: "image" | "video" | "audio";
  path: string;
  name: string;
  description: string;
  durationSeconds?: number | null;
};

export type H3RealismJobInput = {
  mode: "h3-realism";
  quality: H3Quality;
  orientation: H3Orientation;
  durationSeconds: H3ProductionDuration;
  prompt: string;
  compiledPromptOverride?: string;
  seed: number;
  references: H3RealismReference[];
  loraSettings?: H3RealismLoraSettingsInput;
};

export type H3RealismJob = {
  id: string;
  ownerKey: string;
  status: "queued" | "preparing" | "submitted" | "running" | "finalizing" | "completed" | "failed" | "canceling" | "canceled";
  statusMessage: string;
  input: H3RealismJobInput;
  backend: ProductionV2H3BackendId | null;
  clientId: string | null;
  promptId: string | null;
  workflowId: string | null;
  workflowFile: string | null;
  compiledPrompt: string | null;
  outputPath: string | null;
  galleryOwner: Pick<OwnerContext, "ownerKey" | "username" | "deviceId" | "scope"> | null;
  galleryStatus: "pending" | "saving" | "saved" | "failed";
  galleryFileName: string | null;
  galleryScope: "user" | "device" | null;
  galleryError: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  queueRemaining: number | null;
  progressPercent: number | null;
  currentNode: string | null;
};

export type H3RealismBackendProbe = {
  backend: ProductionV2H3BackendId;
  healthy: boolean;
  compatible: boolean;
  idle: boolean;
  reason: string;
  missingNodes: string[];
  missingAssets: string[];
};

const GLOBAL_KEY = "__otgH3RealismJobs";
const OUTPUT_NODE_ID = "264";
const H3_REALISM_BACKEND_PRIORITY: readonly ProductionV2H3BackendId[] = ["rtx3090"] as const;
const globalState = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: { running: Set<string> };
};

function state() {
  globalState[GLOBAL_KEY] ||= { running: new Set<string>() };
  return globalState[GLOBAL_KEY];
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function jobsDir(ownerKey: string) {
  const dir = safeJoin(OTG_DATA_ROOT, "h3-special", "realism", safeSegment(ownerKey), "jobs");
  ensureDir(dir);
  return dir;
}

function jobPath(ownerKey: string, id: string) {
  return safeJoin(jobsDir(ownerKey), `${safeSegment(id)}.json`);
}

async function writeJob(job: H3RealismJob) {
  await fsp.writeFile(jobPath(job.ownerKey, job.id), JSON.stringify(job, null, 2), "utf8");
  return job;
}

async function updateJob(ownerKey: string, id: string, patch: Partial<H3RealismJob>) {
  const current = await getH3RealismJob(ownerKey, id);
  if (!current) throw new Error("H3 Realism job was not found.");
  return writeJob({ ...current, ...patch });
}

export async function getH3RealismJob(ownerKey: string, id: string) {
  try {
    return JSON.parse(await fsp.readFile(jobPath(ownerKey, id), "utf8")) as H3RealismJob;
  } catch {
    return null;
  }
}

export async function listH3RealismJobs(ownerKey: string) {
  let names: string[];
  try {
    names = await fsp.readdir(jobsDir(ownerKey));
  } catch {
    return [];
  }

  const jobs = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        try {
          return JSON.parse(await fsp.readFile(path.join(jobsDir(ownerKey), name), "utf8")) as H3RealismJob;
        } catch {
          return null;
        }
      }),
  );

  return jobs
    .filter((job): job is H3RealismJob => Boolean(job?.id && job.ownerKey === ownerKey))
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
}

export async function getLatestH3RealismJob(ownerKey: string) {
  return (await listH3RealismJobs(ownerKey))[0] || null;
}

function isRunnableH3RealismStatus(status: H3RealismJob["status"]) {
  return ["queued", "preparing", "submitted", "running", "finalizing"].includes(status);
}

export function validateH3RealismJobInput(input: H3RealismJobInput) {
  const normalized = validateH3RealismRequest({
    prompt: input.prompt,
    quality: input.quality,
    orientation: input.orientation,
    durationSeconds: input.durationSeconds,
    references: input.references,
    loraSettings: input.loraSettings,
  });
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) {
    throw new Error("Realism seed must be a non-negative safe integer.");
  }
  return {
    ...input,
    quality: normalized.quality,
    orientation: normalized.orientation,
    durationSeconds: normalized.durationSeconds,
    prompt: normalized.prompt,
    references: input.references,
    loraSettings: input.loraSettings,
  };
}

export async function createH3RealismJob(
  ownerKey: string,
  input: H3RealismJobInput,
  galleryOwner: H3RealismJob["galleryOwner"] = null,
) {
  const normalized = validateH3RealismJobInput(input);
  const id = `h3-realism-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const job: H3RealismJob = {
    id,
    ownerKey,
    status: "queued",
    statusMessage: "Waiting for the RTX 3090 H3 Realism GPU",
    input: normalized,
    backend: null,
    clientId: null,
    promptId: null,
    workflowId: null,
    workflowFile: null,
    compiledPrompt: null,
    outputPath: null,
    galleryOwner,
    galleryStatus: "pending",
    galleryFileName: null,
    galleryScope: null,
    galleryError: null,
    error: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    queueRemaining: null,
    progressPercent: 0,
    currentNode: null,
  };
  await writeJob(job);
  return job;
}

export async function cancelH3RealismJob(ownerKey: string, id: string) {
  const current = await getH3RealismJob(ownerKey, id);
  if (!current) throw new Error("H3 Realism job was not found.");
  if (["completed", "failed", "canceled"].includes(current.status)) return current;
  const canceling = await updateJob(ownerKey, id, {
    status: "canceling",
    statusMessage: "Canceling...",
    error: null,
  });
  if (current.backend) {
    await fetch(`${H3_BACKEND_PROFILES[current.backend].baseUrl}/interrupt`, {
      method: "POST",
      cache: "no-store",
    }).catch(() => undefined);
  }
  return updateJob(ownerKey, id, {
    status: "canceled",
    statusMessage: "Canceled",
    error: null,
    completedAt: new Date().toISOString(),
  }).catch(() => canceling);
}

function gallerySourceForJob(job: H3RealismJob): GallerySource {
  const owner = job.galleryOwner;
  if (!owner) throw new Error("Gallery ownership was not recorded for this H3 Realism job.");
  return owner.scope === "user" && owner.username
    ? {
        scope: "user",
        dir: userGalleryDir(owner.username),
        ownerKey: owner.ownerKey,
        username: owner.username,
        deviceId: owner.deviceId,
      }
    : {
        scope: "device",
        dir: deviceGalleryDir(owner.deviceId),
        ownerKey: owner.ownerKey,
        username: owner.username,
        deviceId: owner.deviceId,
      };
}

export function getH3RealismGalleryFileName(job: H3RealismJob) {
  return safeGalleryName(
    `H3_realism_${job.input.durationSeconds}s_${job.input.quality}_${job.input.orientation}_${job.id}.mp4`,
  );
}

export async function saveH3RealismJobToGallery(
  job: H3RealismJob,
  sourceOverride?: GallerySource,
) {
  if (!job.outputPath || !["finalizing", "completed"].includes(job.status) || !fs.existsSync(job.outputPath)) {
    throw new Error("Completed H3 Realism video not found.");
  }
  const source = sourceOverride || gallerySourceForJob(job);
  const savedName = job.galleryFileName || getH3RealismGalleryFileName(job);
  const targetPath = path.join(source.dir, path.basename(savedName));

  await updateJob(job.ownerKey, job.id, {
    galleryStatus: "saving",
    galleryError: null,
  });
  try {
    if (!fs.existsSync(targetPath)) {
      const temporaryPath = `${targetPath}.part-${process.pid}-${crypto.randomUUID()}`;
      try {
        await fsp.copyFile(job.outputPath, temporaryPath);
        await fsp.rename(temporaryPath, targetPath);
      } finally {
        await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    }

    const stat = fs.statSync(targetPath);
    const dimensions = getH3NativeDimensions(job.input.quality, normalizeH3Orientation(job.input.orientation));
    writeMetaForFile(targetPath, {
      originalName: savedName,
      renamedName: savedName,
      sourceType: "h3-realism-generation",
      requestKind: "h3-realism-auto-gallery",
      mediaCategory: "generated-video",
      positivePrompt: job.compiledPrompt || job.input.compiledPromptOverride || job.input.prompt,
      workflowId: job.workflowId,
      workflowTitle: "MiniMax H3 Realism",
      sourcePromptId: job.promptId,
      submitPayload: {
        requestKind: "h3-realism-auto-gallery",
        jobId: job.id,
        mode: job.input.mode,
        quality: job.input.quality,
        orientation: normalizeH3Orientation(job.input.orientation),
        width: dimensions.width,
        height: dimensions.height,
        durationSeconds: job.input.durationSeconds,
        backend: job.backend,
        workflowFile: job.workflowFile,
      },
      ownerKey: source.ownerKey,
      username: source.username,
      deviceId: source.deviceId,
      createdAt: stat.birthtimeMs || stat.mtimeMs,
      updatedAt: Date.now(),
    }, source);
    clearGalleryListCache();
    await updateJob(job.ownerKey, job.id, {
      galleryStatus: "saved",
      galleryFileName: savedName,
      galleryScope: source.scope,
      galleryError: null,
    });
    return {
      fileName: savedName,
      scope: source.scope,
      url: `/api/gallery/file?name=${encodeURIComponent(savedName)}&scope=${source.scope}`,
    };
  } catch (error) {
    await updateJob(job.ownerKey, job.id, {
      galleryStatus: "failed",
      galleryError: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
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

function expectedAssets(built: H3RealismBuiltWorkflow) {
  const checkedInputs: Record<string, readonly string[]> = {
    UNETLoader: ["unet_name"],
    CLIPLoader: ["clip_name"],
    VAELoader: ["vae_name"],
    LoraLoaderModelOnly: ["lora_name"],
  };
  const seen = new Set<string>();
  const result: Array<readonly [string, string, string]> = [];
  Object.values(built.graph).forEach((node) => {
    const classType = clean(node.class_type);
    const inputs = classType ? checkedInputs[classType] || [] : [];
    inputs.forEach((input) => {
      const expected = clean(node.inputs?.[input]);
      const key = `${classType}:${input}:${expected}`;
      if (!expected || seen.has(key)) return;
      seen.add(key);
      result.push([classType, input, expected]);
    });
  });
  return result;
}

export async function inspectH3RealismBackendCompatibility(
  backend: ProductionV2H3BackendId,
  built: H3RealismBuiltWorkflow,
  fetcher: typeof fetch = fetch,
): Promise<H3RealismBackendProbe> {
  const profile = H3_BACKEND_PROFILES[backend];
  try {
    const queueResponse = await fetchWithTimeout(fetcher, `${profile.baseUrl}/queue`);
    if (!queueResponse.ok) throw new Error(`queue HTTP ${queueResponse.status}`);
    const queue = await queueResponse.json().catch(() => null) as { queue_running?: unknown; queue_pending?: unknown } | null;
    const queueBusy = (Array.isArray(queue?.queue_running) && queue.queue_running.length > 0)
      || (Array.isArray(queue?.queue_pending) && queue.queue_pending.length > 0);

    const requiredNodeClasses = [
      ...new Set(
        Object.values(built.graph)
          .map((node) => clean(node.class_type))
          .filter(Boolean),
      ),
    ];
    const infoEntries = await Promise.all(
      requiredNodeClasses.map(async (node) => {
        const response = await fetchWithTimeout(
          fetcher,
          `${profile.baseUrl}/object_info/${encodeURIComponent(node)}`,
        );
        if (!response.ok) return [node, null] as const;
        const payload = await response.json().catch(() => null) as ObjectInfo | null;
        return [node, payload?.[node] ? payload : null] as const;
      }),
    );
    const info = Object.fromEntries(
      infoEntries
        .filter((entry) => entry[1])
        .flatMap(([node, payload]) =>
          Object.entries(payload || {}).filter(([key]) => key === node),
        ),
    ) as ObjectInfo;
    const missingNodes = requiredNodeClasses.filter((node) => !info[node]);
    const missingAssets = expectedAssets(built).flatMap(([node, input, expected]) =>
      choices(info, node, input).includes(expected) ? [] : [expected],
    );
    const compatible = !missingNodes.length && !missingAssets.length;
    return {
      backend,
      healthy: true,
      compatible,
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

async function uploadReference(job: H3RealismJob, backend: ProductionV2H3BackendId, item: H3RealismReference, index: number) {
  return uploadH3Input({
    backend,
    sourcePath: item.path,
    mediaType: item.kind,
    uploadName: `${job.id}_${item.kind}_${index + 1}`,
  });
}

async function submitNewRealismPrompt(job: H3RealismJob) {
  const backendProbes: H3RealismBackendProbe[] = [];
  for (const backend of H3_REALISM_BACKEND_PRIORITY) {
    await updateJob(job.ownerKey, job.id, {
      status: "preparing",
      statusMessage: `Preparing inputs for ${H3_BACKEND_PROFILES[backend].label}`,
      backend,
      startedAt: new Date().toISOString(),
    });

    const uploaded = await Promise.all(
      job.input.references.map((item, index) => uploadReference(job, backend, item, index)),
    );
    const references = job.input.references.map((item, index) => ({
      kind: item.kind,
      name: item.name,
      description: item.description,
      durationSeconds: item.durationSeconds,
      uploadedFilename: uploaded[index],
    }));
    const built = buildH3RealismWorkflow({
      prompt: job.input.prompt,
      quality: job.input.quality,
      orientation: job.input.orientation,
      durationSeconds: job.input.durationSeconds,
      seed: job.input.seed,
      outputPrefix: `otg_h3_realism/${safeSegment(job.id)}`,
      references,
      loraSettings: job.input.loraSettings,
      compiledPromptOverride: job.input.compiledPromptOverride,
    });
    const probe = await inspectH3RealismBackendCompatibility(backend, built);
    backendProbes.push(probe);
    if (!probe.compatible) continue;

    const clientId = `otg-h3-realism-${crypto.randomUUID()}`;
    const submitted = await submitH3Prompt({
      backend,
      graph: built.graph as any,
      clientId,
      jobId: job.id,
      ownerKey: job.ownerKey,
      deviceId: job.galleryOwner?.deviceId || null,
      workerId: "h3-realism",
    });
    if (!submitted.accepted) throw new Error(submitted.error);
    await updateJob(job.ownerKey, job.id, {
      status: "submitted",
      statusMessage: "Accepted by ComfyUI",
      clientId,
      promptId: submitted.promptId,
      workflowId: built.workflowId,
      workflowFile: built.workflowFile,
      compiledPrompt: built.compiledPrompt,
      progressPercent: 2,
    });
    return { backend, promptId: submitted.promptId, clientId };
  }
  const details = backendProbes.map((probe) => {
    const missing = [
      probe.missingNodes.length ? `nodes: ${probe.missingNodes.join(", ")}` : "",
      probe.missingAssets.length ? `assets: ${probe.missingAssets.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    return `${probe.backend}: ${probe.reason}${missing ? ` (${missing})` : ""}`;
  }).join("; ");
  throw new Error(`No compatible H3 Realism GPU is available. ${details}`);
}

async function execute(job: H3RealismJob) {
  let persisted = await getH3RealismJob(job.ownerKey, job.id) || job;
  let backend = persisted.backend;
  let promptId = persisted.promptId;

  if (backend && promptId) {
    if (persisted.clientId) {
      ensureComfyClientProgressMonitor({
        comfyBaseUrl: H3_BACKEND_PROFILES[backend].baseUrl,
        clientId: persisted.clientId,
        idleTimeoutMs: 90 * 60_000,
      });
      recordComfyPromptSubmitted({
        promptId,
        ownerKey: persisted.ownerKey,
        deviceId: persisted.galleryOwner?.deviceId || "",
        clientId: persisted.clientId,
        comfyBaseUrl: H3_BACKEND_PROFILES[backend].baseUrl,
      });
    }
    persisted = await updateJob(job.ownerKey, job.id, {
      status: persisted.status === "finalizing" ? "finalizing" : "running",
      statusMessage: persisted.status === "finalizing" ? persisted.statusMessage : "Reconnected to running H3 Realism generation",
      error: null,
    });
  } else {
    const submitted = await submitNewRealismPrompt(persisted);
    backend = submitted.backend;
    promptId = submitted.promptId;
  }

  if (!backend || !promptId) throw new Error("H3 Realism generation could not be resumed because backend or prompt ID is missing.");

  for (;;) {
    const current = await getH3RealismJob(job.ownerKey, job.id);
    if (current?.status === "canceling" || current?.status === "canceled") return;
    const history = await getH3PromptHistory(backend, promptId, fetch, OUTPUT_NODE_ID);
    if (history.state === "failed") throw new Error("MiniMax H3 Realism failed in ComfyUI. Review the ComfyUI history for the full node traceback.");
    if (history.state === "completed" && history.video) {
      const outputPath = await downloadH3Video({
        backend,
        file: history.video,
        ownerKey: job.ownerKey,
        productionId: "h3-realism",
        sceneId: job.id,
        generationJobId: job.id,
      });
      const completedJob = await updateJob(job.ownerKey, job.id, {
        status: "finalizing",
        statusMessage: "Video complete; saving to Gallery",
        outputPath,
        completedAt: new Date().toISOString(),
      });
      try {
        await saveH3RealismJobToGallery(completedJob);
        await updateJob(job.ownerKey, job.id, {
          status: "completed",
          statusMessage: "Realism video complete and saved to Gallery",
        });
      } catch (error) {
        await updateJob(job.ownerKey, job.id, {
          status: "completed",
          statusMessage: "Realism video complete; Gallery save needs attention",
          galleryStatus: "failed",
          galleryError: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    const estimate = getH3ProductionTimeEstimate("h3-reference-to-video", job.input.durationSeconds, job.input.quality, backend);
    const elapsed = current?.startedAt ? (Date.now() - Date.parse(current.startedAt)) / 1000 : 0;
    const progressPercent = Math.max(2, Math.min(95, Math.round((elapsed / Math.max(1, estimate.seconds || estimate.maxSeconds)) * 100)));
    await updateJob(job.ownerKey, job.id, { status: "running", statusMessage: "Generating H3 Realism in ComfyUI", progressPercent });
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
}

export function startH3RealismJob(job: H3RealismJob) {
  if (state().running.has(job.id)) return;
  state().running.add(job.id);
  void execute(job)
    .catch(async (error) => {
      await updateJob(job.ownerKey, job.id, {
        status: "failed",
        statusMessage: "Realism generation failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      }).catch(() => undefined);
    })
    .finally(() => state().running.delete(job.id));
}

export function ensureH3RealismJobRunner(job: H3RealismJob | null | undefined) {
  if (!job || !isRunnableH3RealismStatus(job.status)) return;
  startH3RealismJob(job);
}

export function h3RealismPublicStatus(job: H3RealismJob) {
  const orientation = normalizeH3Orientation(job.input.orientation);
  const nativeDimensions = getH3NativeDimensions(
    normalizeH3Quality(job.input.quality),
    orientation,
  );
  const estimate = getH3ProductionTimeEstimate("h3-reference-to-video", job.input.durationSeconds, job.input.quality, job.backend);
  const progress = readComfyPromptProgress(job.promptId);
  return {
    id: job.id,
    status: job.status,
    statusMessage: job.statusMessage,
    mode: job.input.mode,
    quality: job.input.quality,
    orientation,
    durationSeconds: job.input.durationSeconds,
    prompt: job.compiledPrompt || job.input.compiledPromptOverride || job.input.prompt,
    backend: job.backend,
    backendLabel: job.backend ? H3_BACKEND_PROFILES[job.backend].label : null,
    workflowId: job.workflowId,
    workflowFile: job.workflowFile,
    nativeResolution: `${nativeDimensions.width}x${nativeDimensions.height}`,
    etaSeconds: estimate.seconds,
    etaMinSeconds: estimate.minSeconds,
    etaMaxSeconds: estimate.maxSeconds,
    promptId: job.promptId,
    error: job.error,
    queueRemaining: job.queueRemaining,
    progressPercent: job.status === "completed" ? 100 : job.progressPercent,
    currentNode: job.currentNode,
    approximatePreview: progress?.approximatePreview || null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    videoUrl: job.status === "completed" ? `/api/h3/special/realism/generation/media?jobId=${encodeURIComponent(job.id)}` : null,
    galleryStatus: job.galleryStatus || "pending",
    galleryFileName: job.galleryFileName || null,
    galleryUrl: job.galleryFileName && job.galleryScope
      ? `/api/gallery/file?name=${encodeURIComponent(job.galleryFileName)}&scope=${job.galleryScope}`
      : null,
    thumbnailUrl: job.status === "completed"
      ? `/api/h3/special/realism/generation/thumbnail?jobId=${encodeURIComponent(job.id)}`
      : null,
    galleryError: job.galleryError || null,
  };
}
