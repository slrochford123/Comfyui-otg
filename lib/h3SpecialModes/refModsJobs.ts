import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import {
  clearGalleryListCache,
  safeGalleryName,
  writeMetaForFile,
  type GallerySource,
} from "@/lib/gallery";
import { readComfyPromptProgress } from "@/lib/comfyProgress";
import {
  compileH3RefModsPrompt,
  validateH3RefModsRequest,
  type H3RefModsRequestInput,
} from "@/lib/h3SpecialModes/refMods";
import { buildH3RefModsT2VWorkflow } from "@/lib/h3SpecialModes/refModsWorkflow";
import type { OwnerContext } from "@/lib/ownerKey";
import {
  getH3NativeDimensions,
  getH3ProductionTimeEstimate,
  normalizeH3Orientation,
  type H3Orientation,
  type H3ProductionDuration,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";
import {
  downloadH3VideoFromBaseUrl,
  getH3PromptHistoryFromBaseUrl,
  submitH3PromptToBaseUrl,
} from "@/lib/production/h3Comfy";
import {
  H3_BACKEND_PROFILES,
  type ProductionV2H3BackendId,
} from "@/lib/production/h3Workflows";
import {
  deviceGalleryDir,
  ensureDir,
  OTG_DATA_ROOT,
  safeJoin,
  safeSegment,
  userGalleryDir,
} from "@/lib/paths";

export type H3RefModsJobInput = {
  mode: "h3-refmods";
  quality: H3Quality;
  orientation: H3Orientation;
  durationSeconds: H3ProductionDuration;
  prompt: string;
  refMods: ReturnType<typeof validateH3RefModsRequest>["refMods"];
  turbo: boolean;
  seed: number;
  compiledPrompt: string;
};

export type H3RefModsJob = {
  id: string;
  ownerKey: string;
  status: "queued" | "preparing" | "submitted" | "running" | "finalizing" | "completed" | "failed" | "canceling" | "canceled";
  statusMessage: string;
  input: H3RefModsJobInput;
  backend: ProductionV2H3BackendId | null;
  backendUrl: string;
  clientId: string | null;
  promptId: string | null;
  workflowId: string | null;
  workflowFile: string | null;
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

const GLOBAL_KEY = "__otgH3RefModsJobs";
const H3_REFMODS_BACKEND: ProductionV2H3BackendId = "rtx3090";
const H3_REFMODS_BASE_URL =
  process.env.OTG_H3_REFMODS_COMFY_URL
  || H3_BACKEND_PROFILES[H3_REFMODS_BACKEND].baseUrl;

const globalState = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: { running: Set<string> };
};

function state() {
  globalState[GLOBAL_KEY] ||= { running: new Set<string>() };
  return globalState[GLOBAL_KEY];
}

function jobsDir(ownerKey: string) {
  const dir = safeJoin(OTG_DATA_ROOT, "h3-special", "refmods-generation", safeSegment(ownerKey), "jobs");
  ensureDir(dir);
  return dir;
}

function jobPath(ownerKey: string, id: string) {
  return safeJoin(jobsDir(ownerKey), `${safeSegment(id)}.json`);
}

async function writeJob(job: H3RefModsJob) {
  await fsp.writeFile(jobPath(job.ownerKey, job.id), JSON.stringify(job, null, 2), "utf8");
  return job;
}

async function updateJob(ownerKey: string, id: string, patch: Partial<H3RefModsJob>) {
  const current = await getH3RefModsJob(ownerKey, id);
  if (!current) throw new Error("H3 Ref Mods generation job was not found.");
  return writeJob({ ...current, ...patch });
}

export async function getH3RefModsJob(ownerKey: string, id: string) {
  try {
    return JSON.parse(await fsp.readFile(jobPath(ownerKey, id), "utf8")) as H3RefModsJob;
  } catch {
    return null;
  }
}

export async function listH3RefModsJobs(ownerKey: string) {
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
          return JSON.parse(await fsp.readFile(path.join(jobsDir(ownerKey), name), "utf8")) as H3RefModsJob;
        } catch {
          return null;
        }
      }),
  );
  return jobs
    .filter((job): job is H3RefModsJob => Boolean(job?.id && job.ownerKey === ownerKey))
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
}

export async function getLatestH3RefModsJob(ownerKey: string) {
  return (await listH3RefModsJobs(ownerKey))[0] || null;
}

function isRunnableStatus(status: H3RefModsJob["status"]) {
  return ["queued", "preparing", "submitted", "running", "finalizing"].includes(status);
}

export function validateH3RefModsJobInput(input: H3RefModsRequestInput): H3RefModsJobInput {
  const normalized = validateH3RefModsRequest(input);
  const seed = normalized.seed ?? crypto.randomBytes(6).readUIntBE(0, 6);
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error("H3 Ref Mods seed must be a non-negative safe integer.");
  }
  return {
    mode: "h3-refmods",
    quality: normalized.quality,
    orientation: normalized.orientation,
    durationSeconds: normalized.durationSeconds,
    prompt: normalized.prompt,
    refMods: normalized.refMods,
    turbo: normalized.turbo,
    seed,
    compiledPrompt: normalized.compiledPrompt,
  };
}

export async function createH3RefModsJob(
  ownerKey: string,
  input: H3RefModsRequestInput,
  galleryOwner: H3RefModsJob["galleryOwner"] = null,
) {
  const normalized = validateH3RefModsJobInput(input);
  const id = `h3-refmods-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const job: H3RefModsJob = {
    id,
    ownerKey,
    status: "queued",
    statusMessage: "Waiting for the RTX 3090 H3 Ref Mods GPU",
    input: normalized,
    backend: null,
    backendUrl: H3_REFMODS_BASE_URL,
    clientId: null,
    promptId: null,
    workflowId: null,
    workflowFile: null,
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

export async function cancelH3RefModsJob(ownerKey: string, id: string) {
  const current = await getH3RefModsJob(ownerKey, id);
  if (!current) throw new Error("H3 Ref Mods generation job was not found.");
  if (["completed", "failed", "canceled"].includes(current.status)) return current;
  const canceling = await updateJob(ownerKey, id, {
    status: "canceling",
    statusMessage: "Canceling...",
    error: null,
  });
  await fetch(`${current.backendUrl.replace(/\/+$/, "")}/interrupt`, {
    method: "POST",
    cache: "no-store",
  }).catch(() => undefined);
  return updateJob(ownerKey, id, {
    status: "canceled",
    statusMessage: "Canceled",
    error: null,
    completedAt: new Date().toISOString(),
  }).catch(() => canceling);
}

function gallerySourceForJob(job: H3RefModsJob): GallerySource {
  const owner = job.galleryOwner;
  if (!owner) throw new Error("Gallery ownership was not recorded for this H3 Ref Mods job.");
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

export function getH3RefModsGalleryFileName(job: H3RefModsJob) {
  return safeGalleryName(
    `H3_refmods_${job.input.durationSeconds}s_${job.input.quality}_${job.input.orientation}_${job.id}.mp4`,
  );
}

export async function saveH3RefModsJobToGallery(
  job: H3RefModsJob,
  sourceOverride?: GallerySource,
) {
  if (!job.outputPath || !["finalizing", "completed"].includes(job.status) || !fs.existsSync(job.outputPath)) {
    throw new Error("Completed H3 Ref Mods video not found.");
  }
  const source = sourceOverride || gallerySourceForJob(job);
  const savedName = job.galleryFileName || getH3RefModsGalleryFileName(job);
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
      sourceType: "h3-refmods-generation",
      requestKind: "h3-refmods-auto-gallery",
      mediaCategory: "generated-video",
      positivePrompt: job.input.compiledPrompt,
      workflowId: job.workflowId,
      workflowTitle: "MiniMax H3 Ref Mods Generation",
      sourcePromptId: job.promptId,
      submitPayload: {
        requestKind: "h3-refmods-auto-gallery",
        jobId: job.id,
        mode: job.input.mode,
        quality: job.input.quality,
        orientation: normalizeH3Orientation(job.input.orientation),
        width: dimensions.width,
        height: dimensions.height,
        durationSeconds: job.input.durationSeconds,
        turbo: job.input.turbo,
        backend: job.backend,
        backendUrl: job.backendUrl,
        workflowFile: job.workflowFile,
        refMods: job.input.refMods.map((slot, index) => ({
          slot: index + 1,
          name: slot.name,
          category: slot.category,
          strength: slot.strength,
          copies: slot.copies,
          components: slot.components,
          visualStrength: slot.visualStrength,
          audioStrength: slot.audioStrength,
        })),
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

async function execute(job: H3RefModsJob) {
  let persisted = await getH3RefModsJob(job.ownerKey, job.id) || job;
  let promptId = persisted.promptId;

  if (promptId) {
    persisted = await updateJob(job.ownerKey, job.id, {
      status: persisted.status === "finalizing" ? "finalizing" : "running",
      statusMessage: persisted.status === "finalizing" ? persisted.statusMessage : "Reconnected to running H3 Ref Mods generation",
      error: null,
    });
  } else {
    await updateJob(job.ownerKey, job.id, {
      status: "preparing",
      statusMessage: "Preparing RefMods T2V workflow for RTX 3090",
      backend: H3_REFMODS_BACKEND,
      startedAt: new Date().toISOString(),
    });

    const built = buildH3RefModsT2VWorkflow({
      backend: H3_REFMODS_BACKEND,
      quality: persisted.input.quality,
      orientation: persisted.input.orientation,
      durationSeconds: persisted.input.durationSeconds,
      prompt: persisted.input.compiledPrompt,
      refMods: persisted.input.refMods,
      turbo: persisted.input.turbo,
      seed: persisted.input.seed,
      outputPrefix: `otg_h3_refmods/${safeSegment(job.id)}`,
    });

    const clientId = `otg-h3-refmods-${crypto.randomUUID()}`;
    const submitted = await submitH3PromptToBaseUrl({
      baseUrl: persisted.backendUrl,
      graph: built.graph,
      clientId,
      jobId: job.id,
      ownerKey: job.ownerKey,
      deviceId: job.galleryOwner?.deviceId || null,
      workerId: "h3-refmods-t2v",
      preSubmitCleanup: null,
    });
    if (!submitted.accepted) throw new Error(submitted.error);
    promptId = submitted.promptId;
    await updateJob(job.ownerKey, job.id, {
      status: "submitted",
      statusMessage: "Accepted by ComfyUI",
      clientId,
      promptId,
      workflowId: built.workflowId,
      workflowFile: built.workflowFile,
      progressPercent: 2,
    });
  }

  if (!promptId) throw new Error("H3 Ref Mods generation could not be resumed because prompt ID is missing.");

  for (;;) {
    const current = await getH3RefModsJob(job.ownerKey, job.id);
    if (current?.status === "canceling" || current?.status === "canceled") return;
    const history = await getH3PromptHistoryFromBaseUrl(persisted.backendUrl, promptId);
    if (history.state === "failed") throw new Error("MiniMax H3 Ref Mods failed in ComfyUI. Review the ComfyUI history for the full node traceback.");
    if (history.state === "completed" && history.video) {
      const outputPath = await downloadH3VideoFromBaseUrl({
        baseUrl: persisted.backendUrl,
        file: history.video,
        ownerKey: job.ownerKey,
        productionId: "h3-refmods",
        sceneId: job.id,
        generationJobId: job.id,
      });
      const completedJob = await updateJob(job.ownerKey, job.id, {
        status: "finalizing",
        statusMessage: "Video complete; saving to Gallery",
        outputPath,
        completedAt: new Date().toISOString(),
        progressPercent: 100,
      });
      try {
        await saveH3RefModsJobToGallery(completedJob);
        await updateJob(job.ownerKey, job.id, {
          status: "completed",
          statusMessage: "Video complete and saved to Gallery",
        });
      } catch (error) {
        await updateJob(job.ownerKey, job.id, {
          status: "completed",
          statusMessage: "Video complete; Gallery save needs attention",
          galleryStatus: "failed",
          galleryError: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    const estimate = getH3ProductionTimeEstimate("h3-text-to-video", job.input.durationSeconds, job.input.quality, H3_REFMODS_BACKEND);
    const elapsed = current?.startedAt ? (Date.now() - Date.parse(current.startedAt)) / 1000 : 0;
    const progressPercent = Math.max(2, Math.min(95, Math.round((elapsed / Math.max(1, estimate.seconds || estimate.maxSeconds)) * 100)));
    await updateJob(job.ownerKey, job.id, {
      status: "running",
      statusMessage: "Generating Ref Mods video in ComfyUI",
      progressPercent,
    });
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
}

export function startH3RefModsJob(job: H3RefModsJob) {
  if (state().running.has(job.id)) return;
  state().running.add(job.id);
  void execute(job)
    .catch(async (error) => {
      await updateJob(job.ownerKey, job.id, {
        status: "failed",
        statusMessage: "Ref Mods generation failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      }).catch(() => undefined);
    })
    .finally(() => state().running.delete(job.id));
}

export function ensureH3RefModsJobRunner(job: H3RefModsJob | null | undefined) {
  if (!job || !isRunnableStatus(job.status)) return;
  startH3RefModsJob(job);
}

export function retryH3RefModsJob(source: H3RefModsJob) {
  return createH3RefModsJob(source.ownerKey, {
    mode: "h3-refmods",
    quality: source.input.quality,
    orientation: source.input.orientation,
    durationSeconds: source.input.durationSeconds,
    prompt: source.input.prompt,
    refMods: source.input.refMods,
    turbo: source.input.turbo,
    seed: crypto.randomBytes(6).readUIntBE(0, 6),
  }, source.galleryOwner);
}

export function h3RefModsPublicStatus(job: H3RefModsJob) {
  const orientation = normalizeH3Orientation(job.input.orientation);
  const nativeDimensions = getH3NativeDimensions(job.input.quality, orientation);
  const estimate = getH3ProductionTimeEstimate("h3-text-to-video", job.input.durationSeconds, job.input.quality, job.backend);
  const progress = readComfyPromptProgress(job.promptId);
  return {
    id: job.id,
    status: job.status,
    statusMessage: job.statusMessage,
    mode: job.input.mode,
    quality: job.input.quality,
    orientation,
    durationSeconds: job.input.durationSeconds,
    prompt: job.input.compiledPrompt || compileH3RefModsPrompt({
      prompt: job.input.prompt,
      refMods: job.input.refMods,
    }),
    backend: job.backend,
    backendLabel: job.backend ? H3_BACKEND_PROFILES[job.backend].label : "RTX 3090",
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
    videoUrl: job.status === "completed" ? `/api/h3/special/refmods/generation/media?jobId=${encodeURIComponent(job.id)}` : null,
    galleryStatus: job.galleryStatus || "pending",
    galleryFileName: job.galleryFileName || null,
    galleryUrl: job.galleryFileName && job.galleryScope
      ? `/api/gallery/file?name=${encodeURIComponent(job.galleryFileName)}&scope=${job.galleryScope}`
      : null,
    thumbnailUrl: job.status === "completed"
      ? `/api/h3/special/refmods/generation/thumbnail?jobId=${encodeURIComponent(job.id)}`
      : null,
    galleryError: job.galleryError || null,
  };
}
