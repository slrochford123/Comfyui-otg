import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { readComfyPromptProgress, recordComfyPromptSubmitted, ensureComfyClientProgressMonitor } from "@/lib/comfyProgress";
import { resolveFfmpegPath, runCmd } from "@/lib/ffmpeg";
import { clearGalleryListCache, safeGalleryName, writeMetaForFile, type GallerySource } from "@/lib/gallery";
import type { OwnerContext } from "@/lib/ownerKey";
import { deviceGalleryDir, ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment, userGalleryDir } from "@/lib/paths";
import {
  downloadH3VideoFromBaseUrl,
  getH3PromptHistoryFromBaseUrl,
  submitH3PromptToBaseUrl,
  uploadH3InputToBaseUrl,
} from "@/lib/production/h3Comfy";
import {
  getH3NativeDimensions,
  getH3ProductionTimeEstimate,
  normalizeH3Orientation,
  normalizeH3Quality,
  type H3Orientation,
  type H3ProductionDuration,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";
import {
  applyH3Rife60FpsFinalization,
  h3FinalFpsForRife,
  H3_RIFE_NATIVE_FPS,
  normalizeH3RifeInterpolation60Fps,
} from "@/lib/h3RifeFinalization";
import { validateH3BodySwapRequest } from "@/lib/h3SpecialModes/bodySwap";
import { buildH3BodySwapWorkflow, type H3BodySwapBuiltWorkflow } from "@/lib/h3SpecialModes/bodySwapWorkflow";
import { H3_BACKEND_PROFILES } from "@/lib/production/h3Workflows";

type ObjectInfo = Record<string, {
  input?: {
    required?: Record<string, unknown>;
    optional?: Record<string, unknown>;
  };
}>;

export type H3BodySwapMedia = {
  path: string;
  name: string;
};

export type H3BodySwapJobInput = {
  mode: "h3-body-swap";
  quality: H3Quality;
  orientation: H3Orientation;
  durationSeconds: H3ProductionDuration;
  prompt: string;
  selector: string;
  compiledPromptOverride?: string;
  preserveOriginalAudio: boolean;
  rifeInterpolation60Fps?: boolean;
  seed: number;
  sourceVideo: H3BodySwapMedia;
  replacementImage: H3BodySwapMedia;
};

export type H3BodySwapJob = {
  id: string;
  ownerKey: string;
  status: "queued" | "preparing" | "submitted" | "running" | "finalizing" | "completed" | "failed" | "canceling" | "canceled";
  statusMessage: string;
  input: H3BodySwapJobInput;
  backend: H3BodySwapBackendId | null;
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

export type H3BodySwapBackendProbe = {
  backend: H3BodySwapBackendId;
  healthy: boolean;
  compatible: boolean;
  idle: boolean;
  reason: string;
  missingNodes: string[];
  missingAssets: string[];
};

const GLOBAL_KEY = "__otgH3BodySwapJobs";
const OUTPUT_NODE_ID = "92";
type H3BodySwapBackendId = "rtx3090-comfy-kitchen";
const H3_BODY_SWAP_BACKEND_PROFILES = {
  "rtx3090-comfy-kitchen": {
    id: "rtx3090-comfy-kitchen",
    label: "RTX 3090 Comfy Kitchen",
    baseUrl: process.env.OTG_H3_BODY_SWAP_3090_COMFY_URL || "http://100.75.162.64:8188",
    etaBackend: "rtx3090" as const,
  },
} as const satisfies Record<string, {
  id: H3BodySwapBackendId;
  label: string;
  baseUrl: string;
  etaBackend: "rtx3090";
}>;
const H3_BODY_SWAP_BACKEND_PRIORITY: readonly H3BodySwapBackendId[] = ["rtx3090-comfy-kitchen"] as const;
const globalState = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: { running: Set<string> };
};

function bodySwapBackendProfile(backend: H3BodySwapBackendId) {
  return H3_BODY_SWAP_BACKEND_PROFILES[backend];
}

function state() {
  globalState[GLOBAL_KEY] ||= { running: new Set<string>() };
  return globalState[GLOBAL_KEY];
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function jobsDir(ownerKey: string) {
  const dir = safeJoin(OTG_DATA_ROOT, "h3-special", "body-swap", safeSegment(ownerKey), "jobs");
  ensureDir(dir);
  return dir;
}

function jobPath(ownerKey: string, id: string) {
  return safeJoin(jobsDir(ownerKey), `${safeSegment(id)}.json`);
}

async function writeJob(job: H3BodySwapJob) {
  await fsp.writeFile(jobPath(job.ownerKey, job.id), JSON.stringify(job, null, 2), "utf8");
  return job;
}

async function updateJob(ownerKey: string, id: string, patch: Partial<H3BodySwapJob>) {
  const current = await getH3BodySwapJob(ownerKey, id);
  if (!current) throw new Error("H3 Body Swap job was not found.");
  return writeJob({ ...current, ...patch });
}

export async function getH3BodySwapJob(ownerKey: string, id: string) {
  try {
    return JSON.parse(await fsp.readFile(jobPath(ownerKey, id), "utf8")) as H3BodySwapJob;
  } catch {
    return null;
  }
}

export async function listH3BodySwapJobs(ownerKey: string) {
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
          return JSON.parse(await fsp.readFile(path.join(jobsDir(ownerKey), name), "utf8")) as H3BodySwapJob;
        } catch {
          return null;
        }
      }),
  );
  return jobs
    .filter((job): job is H3BodySwapJob => Boolean(job?.id && job.ownerKey === ownerKey))
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
}

export async function getLatestH3BodySwapJob(ownerKey: string) {
  return (await listH3BodySwapJobs(ownerKey))[0] || null;
}

function isRunnableH3BodySwapStatus(status: H3BodySwapJob["status"]) {
  return ["queued", "preparing", "submitted", "running", "finalizing"].includes(status);
}

export function validateH3BodySwapJobInput(input: H3BodySwapJobInput) {
  const normalized = validateH3BodySwapRequest(input);
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) {
    throw new Error("Body Swap seed must be a non-negative safe integer.");
  }
  if (!input.sourceVideo?.path) throw new Error("Choose a Body Swap source video.");
  if (!input.replacementImage?.path) throw new Error("Choose a Body Swap replacement image.");
  return {
    ...input,
    quality: normalized.quality,
    orientation: normalized.orientation,
    durationSeconds: normalized.durationSeconds,
    prompt: normalized.prompt,
    selector: normalized.selector,
    preserveOriginalAudio: normalized.preserveOriginalAudio,
    rifeInterpolation60Fps: normalizeH3RifeInterpolation60Fps(input.rifeInterpolation60Fps),
  };
}

export async function createH3BodySwapJob(
  ownerKey: string,
  input: H3BodySwapJobInput,
  galleryOwner: H3BodySwapJob["galleryOwner"] = null,
) {
  const normalized = validateH3BodySwapJobInput(input);
  const id = `h3-body-swap-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const job: H3BodySwapJob = {
    id,
    ownerKey,
    status: "queued",
    statusMessage: "Waiting for the RTX 3090 Body Swap GPU",
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

export async function cancelH3BodySwapJob(ownerKey: string, id: string) {
  const current = await getH3BodySwapJob(ownerKey, id);
  if (!current) throw new Error("H3 Body Swap job was not found.");
  if (["completed", "failed", "canceled"].includes(current.status)) return current;
  const canceling = await updateJob(ownerKey, id, {
    status: "canceling",
    statusMessage: "Canceling...",
    error: null,
  });
  if (current.backend) {
    await fetch(`${bodySwapBackendProfile(current.backend).baseUrl}/interrupt`, {
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

function gallerySourceForJob(job: H3BodySwapJob): GallerySource {
  const owner = job.galleryOwner;
  if (!owner) throw new Error("Gallery ownership was not recorded for this H3 Body Swap job.");
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

export function getH3BodySwapGalleryFileName(job: H3BodySwapJob) {
  return safeGalleryName(
    `H3_body-swap_${job.input.durationSeconds}s_${job.input.quality}_${job.input.orientation}_${job.id}.mp4`,
  );
}

export async function saveH3BodySwapJobToGallery(
  job: H3BodySwapJob,
  sourceOverride?: GallerySource,
) {
  if (!job.outputPath || !["finalizing", "completed"].includes(job.status) || !fs.existsSync(job.outputPath)) {
    throw new Error("Completed H3 Body Swap video not found.");
  }
  const source = sourceOverride || gallerySourceForJob(job);
  const savedName = job.galleryFileName || getH3BodySwapGalleryFileName(job);
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
      sourceType: "h3-body-swap-generation",
      requestKind: "h3-body-swap-auto-gallery",
      mediaCategory: "generated-video",
      positivePrompt: job.compiledPrompt || job.input.compiledPromptOverride || job.input.prompt,
      workflowId: job.workflowId,
      workflowTitle: "MiniMax H3 Body Swap",
      sourcePromptId: job.promptId,
      submitPayload: {
        requestKind: "h3-body-swap-auto-gallery",
        jobId: job.id,
        mode: job.input.mode,
        quality: job.input.quality,
        orientation: normalizeH3Orientation(job.input.orientation),
        width: dimensions.width,
        height: dimensions.height,
        durationSeconds: job.input.durationSeconds,
        nativeFps: H3_RIFE_NATIVE_FPS,
        finalFps: h3FinalFpsForRife(job.input.rifeInterpolation60Fps),
        rifeInterpolation60Fps: job.input.rifeInterpolation60Fps === true,
        backend: job.backend,
        workflowFile: job.workflowFile,
        preserveOriginalAudio: job.input.preserveOriginalAudio,
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

function expectedAssets(built: H3BodySwapBuiltWorkflow) {
  const checkedInputs: Record<string, readonly string[]> = {
    UNETLoader: ["unet_name"],
    CLIPLoader: ["clip_name"],
    VAELoader: ["vae_name"],
    LoraLoaderModelOnly: ["lora_name"],
    CheckpointLoaderSimple: ["ckpt_name"],
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

export async function inspectH3BodySwapBackendCompatibility(
  backend: H3BodySwapBackendId,
  built: H3BodySwapBuiltWorkflow,
  fetcher: typeof fetch = fetch,
): Promise<H3BodySwapBackendProbe> {
  const profile = bodySwapBackendProfile(backend);
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

async function uploadBodySwapInputs(job: H3BodySwapJob, backend: H3BodySwapBackendId) {
  const profile = bodySwapBackendProfile(backend);
  const [sourceVideoFilename, replacementImageFilename] = await Promise.all([
    uploadH3InputToBaseUrl({
      baseUrl: profile.baseUrl,
      sourcePath: job.input.sourceVideo.path,
      mediaType: "video",
      uploadName: `${job.id}_source_video`,
    }),
    uploadH3InputToBaseUrl({
      baseUrl: profile.baseUrl,
      sourcePath: job.input.replacementImage.path,
      mediaType: "image",
      uploadName: `${job.id}_replacement_image`,
    }),
  ]);
  return { sourceVideoFilename, replacementImageFilename };
}

async function remuxOriginalAudio(job: H3BodySwapJob, visualPath: string) {
  if (!job.input.preserveOriginalAudio) return visualPath;
  const targetPath = safeJoin(
    path.dirname(visualPath),
    `${path.basename(visualPath, path.extname(visualPath))}-original-audio.mp4`,
  );
  const result = await runCmd(
    resolveFfmpegPath(),
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      visualPath,
      "-i",
      job.input.sourceVideo.path,
      "-map",
      "0:v:0",
      "-map",
      "1:a?",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      "-movflags",
      "+faststart",
      targetPath,
    ],
    { timeoutMs: 10 * 60_000 },
  );
  if (result.code !== 0 || !fs.existsSync(targetPath)) {
    throw new Error(`Could not preserve source audio for Body Swap: ${result.stderr || result.stdout || "ffmpeg failed"}`);
  }
  return targetPath;
}

async function submitNewBodySwapPrompt(job: H3BodySwapJob) {
  const backendProbes: H3BodySwapBackendProbe[] = [];
  for (const backend of H3_BODY_SWAP_BACKEND_PRIORITY) {
    const profile = bodySwapBackendProfile(backend);
    await updateJob(job.ownerKey, job.id, {
      status: "preparing",
      statusMessage: `Preparing Body Swap inputs for ${profile.label}`,
      backend,
      startedAt: new Date().toISOString(),
    });
    const uploads = await uploadBodySwapInputs(job, backend);
    const built = buildH3BodySwapWorkflow({
      sourceVideoFilename: uploads.sourceVideoFilename,
      replacementImageFilename: uploads.replacementImageFilename,
      prompt: job.input.prompt,
      selector: job.input.selector,
      quality: job.input.quality,
      orientation: job.input.orientation,
      durationSeconds: job.input.durationSeconds,
      seed: job.input.seed,
      outputPrefix: `otg_h3_body_swap/${safeSegment(job.id)}`,
      preserveOriginalAudio: job.input.preserveOriginalAudio,
      compiledPromptOverride: job.input.compiledPromptOverride,
    });
    const probe = await inspectH3BodySwapBackendCompatibility(backend, built);
    backendProbes.push(probe);
    if (!probe.compatible) continue;

    const clientId = `otg-h3-body-swap-${crypto.randomUUID()}`;
    const submitted = await submitH3PromptToBaseUrl({
      baseUrl: profile.baseUrl,
      graph: built.graph as any,
      clientId,
      jobId: job.id,
      ownerKey: job.ownerKey,
      deviceId: job.galleryOwner?.deviceId || null,
      workerId: "h3-body-swap",
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
  throw new Error(`No compatible H3 Body Swap GPU is available. ${details}`);
}

async function execute(job: H3BodySwapJob) {
  let persisted = await getH3BodySwapJob(job.ownerKey, job.id) || job;
  let backend = persisted.backend;
  let promptId = persisted.promptId;

  if (backend && promptId) {
    const profile = bodySwapBackendProfile(backend);
    if (persisted.clientId) {
      ensureComfyClientProgressMonitor({
        comfyBaseUrl: profile.baseUrl,
        clientId: persisted.clientId,
        idleTimeoutMs: 90 * 60_000,
      });
      recordComfyPromptSubmitted({
        promptId,
        ownerKey: persisted.ownerKey,
        deviceId: persisted.galleryOwner?.deviceId || "",
        clientId: persisted.clientId,
        comfyBaseUrl: profile.baseUrl,
      });
    }
    persisted = await updateJob(job.ownerKey, job.id, {
      status: persisted.status === "finalizing" ? "finalizing" : "running",
      statusMessage: persisted.status === "finalizing" ? persisted.statusMessage : "Reconnected to running H3 Body Swap generation",
      error: null,
    });
  } else {
    const submitted = await submitNewBodySwapPrompt(persisted);
    backend = submitted.backend;
    promptId = submitted.promptId;
  }

  if (!backend || !promptId) throw new Error("H3 Body Swap generation could not be resumed because backend or prompt ID is missing.");
  const activeProfile = bodySwapBackendProfile(backend);

  for (;;) {
    const current = await getH3BodySwapJob(job.ownerKey, job.id);
    if (current?.status === "canceling" || current?.status === "canceled") return;
    const history = await getH3PromptHistoryFromBaseUrl(activeProfile.baseUrl, promptId, fetch, OUTPUT_NODE_ID);
    if (history.state === "failed") throw new Error("MiniMax H3 Body Swap failed in ComfyUI. Review the ComfyUI history for the full node traceback.");
    if (history.state === "completed" && history.video) {
      const visualPath = await downloadH3VideoFromBaseUrl({
        baseUrl: activeProfile.baseUrl,
        file: history.video,
        ownerKey: job.ownerKey,
        productionId: "h3-body-swap",
        sceneId: job.id,
        generationJobId: job.id,
      });
      let outputPath = await remuxOriginalAudio(job, visualPath);
      const rifeResult = await applyH3Rife60FpsFinalization({
        enabled: job.input.rifeInterpolation60Fps,
        baseUrl: H3_BACKEND_PROFILES.rtx3090.baseUrl,
        sourceVideoPath: outputPath,
        ownerKey: job.ownerKey,
        productionId: "h3-body-swap",
        sceneId: job.id,
        generationJobId: job.id,
        outputPrefix: `otg_h3_body_swap_rife/${safeSegment(job.id)}`,
      });
      if (rifeResult) outputPath = rifeResult.outputPath;
      const completedJob = await updateJob(job.ownerKey, job.id, {
        status: "finalizing",
        statusMessage: "Body Swap video complete; saving to Gallery",
        outputPath,
        completedAt: new Date().toISOString(),
      });
      try {
        await saveH3BodySwapJobToGallery(completedJob);
        await updateJob(job.ownerKey, job.id, {
          status: "completed",
          statusMessage: "Body Swap video complete and saved to Gallery",
        });
      } catch (error) {
        await updateJob(job.ownerKey, job.id, {
          status: "completed",
          statusMessage: "Body Swap video complete; Gallery save needs attention",
          galleryStatus: "failed",
          galleryError: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    const estimate = getH3ProductionTimeEstimate("h3-reference-to-video", job.input.durationSeconds, job.input.quality, activeProfile.etaBackend);
    const elapsed = current?.startedAt ? (Date.now() - Date.parse(current.startedAt)) / 1000 : 0;
    const progressPercent = Math.max(2, Math.min(95, Math.round((elapsed / Math.max(1, estimate.seconds || estimate.maxSeconds)) * 100)));
    await updateJob(job.ownerKey, job.id, { status: "running", statusMessage: "Generating Body Swap in ComfyUI", progressPercent });
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
}

export function startH3BodySwapJob(job: H3BodySwapJob) {
  if (state().running.has(job.id)) return;
  state().running.add(job.id);
  void execute(job)
    .catch(async (error) => {
      await updateJob(job.ownerKey, job.id, {
        status: "failed",
        statusMessage: "Body Swap generation failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      }).catch(() => undefined);
    })
    .finally(() => state().running.delete(job.id));
}

export function ensureH3BodySwapJobRunner(job: H3BodySwapJob | null | undefined) {
  if (!job || !isRunnableH3BodySwapStatus(job.status)) return;
  startH3BodySwapJob(job);
}

export function h3BodySwapPublicStatus(job: H3BodySwapJob) {
  const orientation = normalizeH3Orientation(job.input.orientation);
  const nativeDimensions = getH3NativeDimensions(
    normalizeH3Quality(job.input.quality),
    orientation,
  );
  const profile = job.backend ? bodySwapBackendProfile(job.backend) : null;
  const estimate = getH3ProductionTimeEstimate("h3-reference-to-video", job.input.durationSeconds, job.input.quality, profile?.etaBackend || null);
  const progress = readComfyPromptProgress(job.promptId);
  return {
    id: job.id,
    status: job.status,
    statusMessage: job.statusMessage,
    mode: job.input.mode,
    quality: job.input.quality,
    orientation,
    durationSeconds: job.input.durationSeconds,
    nativeFps: H3_RIFE_NATIVE_FPS,
    finalFps: h3FinalFpsForRife(job.input.rifeInterpolation60Fps),
    rifeInterpolation60Fps: job.input.rifeInterpolation60Fps === true,
    prompt: job.compiledPrompt || job.input.compiledPromptOverride || job.input.prompt,
    backend: job.backend,
    backendLabel: profile?.label || null,
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
    videoUrl: job.status === "completed" ? `/api/h3/special/body-swap/generation/media?jobId=${encodeURIComponent(job.id)}` : null,
    galleryStatus: job.galleryStatus || "pending",
    galleryFileName: job.galleryFileName || null,
    galleryUrl: job.galleryFileName && job.galleryScope
      ? `/api/gallery/file?name=${encodeURIComponent(job.galleryFileName)}&scope=${job.galleryScope}`
      : null,
    thumbnailUrl: job.status === "completed"
      ? `/api/h3/special/body-swap/generation/thumbnail?jobId=${encodeURIComponent(job.id)}`
      : null,
    galleryError: job.galleryError || null,
  };
}
