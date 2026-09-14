import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { clearGalleryListCache, safeGalleryName, writeMetaForFile, type GallerySource } from "@/lib/gallery";
import type { OwnerContext } from "@/lib/ownerKey";
import { deviceGalleryDir, ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment, userGalleryDir } from "@/lib/paths";
import {
  getH3PromptHistory,
  inspectH3BackendCompatibility,
  submitH3Prompt,
  uploadH3Input,
  downloadH3Video,
} from "@/lib/production/h3Comfy";
import { chooseProductionV2H3Backend } from "@/lib/production/h3GenerationScheduler";
import { DEFAULT_PRODUCTION_V2_H3_USER_LORAS } from "@/lib/production/h3Loras";
import { validateH3LoraSelections, type ResolvedH3OptionalLora } from "@/lib/h3LoraCatalogServer";
import type { H3StudioLoraSelection } from "@/lib/h3Studio";
import { buildH3StudioLockedReferences, composeH3StudioFinalPrompt } from "@/lib/h3Studio";
import {
  getH3NativeDimensions,
  getH3ProductionTimeEstimate,
  H3_ORIENTATION_OPTIONS,
  normalizeH3Orientation,
  normalizeH3Quality,
  type H3Orientation,
  type H3ProductionDuration,
  type H3Quality,
} from "@/lib/production/h3ProductionRecipes";
import { buildH3Workflow, H3_BACKEND_PRIORITY, H3_BACKEND_PROFILES, H3_MAX_AUDIO_REFERENCES, H3_MAX_IMAGE_REFERENCES, H3_MAX_VIDEO_REFERENCES, type ProductionV2H3BackendId, type ProductionV2H3Mode } from "@/lib/production/h3Workflows";

export type H3DirectReference = {
  path: string;
  name: string;
  description: string;
  includeAudio?: boolean;
};

export type H3DirectJobInput = {
  mode: ProductionV2H3Mode;
  quality: H3Quality;
  orientation: H3Orientation;
  durationSeconds: H3ProductionDuration;
  prompt: string;
  seed: number;
  optionalLoras: H3StudioLoraSelection[];
  firstImage: H3DirectReference | null;
  lastImage: H3DirectReference | null;
  images: H3DirectReference[];
  videos: H3DirectReference[];
  audios: H3DirectReference[];
};

export type H3DirectJob = {
  id: string;
  ownerKey: string;
  status: "queued" | "preparing" | "submitted" | "running" | "finalizing" | "completed" | "failed";
  statusMessage: string;
  input: H3DirectJobInput;
  backend: ProductionV2H3BackendId | null;
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

const GLOBAL_KEY = "__otgH3DirectJobs";
const globalState = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: { running: Set<string> };
};

function state() {
  globalState[GLOBAL_KEY] ||= { running: new Set<string>() };
  return globalState[GLOBAL_KEY];
}

function validateRequiredLoraTriggers(input: H3DirectJobInput, resolved: ResolvedH3OptionalLora[]) {
  const prompt = input.prompt.toLocaleLowerCase();
  for (const lora of resolved) {
    if (!lora.triggerRequired || !lora.triggerWords.length) continue;
    const found = lora.triggerWords.some((trigger) => prompt.includes(trigger.trim().toLocaleLowerCase()));
    if (!found) throw new Error(`H3 LoRA ${lora.label} requires one of these trigger words: ${lora.triggerWords.join(", ")}.`);
  }
}

function jobsDir(ownerKey: string) {
  const dir = safeJoin(OTG_DATA_ROOT, "h3-direct", safeSegment(ownerKey), "jobs");
  ensureDir(dir);
  return dir;
}

function jobPath(ownerKey: string, id: string) {
  return safeJoin(jobsDir(ownerKey), `${safeSegment(id)}.json`);
}

async function writeJob(job: H3DirectJob) {
  await fsp.writeFile(jobPath(job.ownerKey, job.id), JSON.stringify(job, null, 2), "utf8");
  return job;
}

export async function getH3DirectJob(ownerKey: string, id: string) {
  try {
    return JSON.parse(await fsp.readFile(jobPath(ownerKey, id), "utf8")) as H3DirectJob;
  } catch {
    return null;
  }
}

async function updateJob(ownerKey: string, id: string, patch: Partial<H3DirectJob>) {
  const current = await getH3DirectJob(ownerKey, id);
  if (!current) throw new Error("H3 direct-generation job was not found.");
  return writeJob({ ...current, ...patch });
}

export async function createH3DirectJob(
  ownerKey: string,
  input: H3DirectJobInput,
  galleryOwner: H3DirectJob["galleryOwner"] = null,
) {
  const id = `h3-direct-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const job: H3DirectJob = {
    id,
    ownerKey,
    status: "queued",
    statusMessage: "Waiting for an H3 GPU",
    input: {
      ...input,
      quality: normalizeH3Quality(input.quality),
      orientation: normalizeH3Orientation(input.orientation),
      optionalLoras: input.optionalLoras,
    },
    backend: null,
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

function gallerySourceForJob(job: H3DirectJob): GallerySource {
  const owner = job.galleryOwner;
  if (!owner) throw new Error("Gallery ownership was not recorded for this H3 job.");
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

export function getH3DirectGalleryFileName(job: H3DirectJob) {
  return safeGalleryName(
    `H3_${job.input.mode.replace(/^h3-/, "")}_${job.input.durationSeconds}s_${job.input.quality}_${job.input.orientation}_${job.id}.mp4`,
  );
}

export async function saveH3DirectJobToGallery(
  job: H3DirectJob,
  sourceOverride?: GallerySource,
) {
  if (!job.outputPath || !["finalizing", "completed"].includes(job.status) || !fs.existsSync(job.outputPath)) {
    throw new Error("Completed H3 video not found.");
  }
  const source = sourceOverride || gallerySourceForJob(job);
  const savedName = job.galleryFileName || getH3DirectGalleryFileName(job);
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
      sourceType: "h3-direct-generation",
      requestKind: "h3-direct-auto-gallery",
      mediaCategory: "generated-video",
      positivePrompt: job.input.prompt,
      workflowId: job.workflowId,
      workflowTitle: "MiniMax H3 Direct Generation",
      sourcePromptId: job.promptId,
      submitPayload: {
        requestKind: "h3-direct-auto-gallery",
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

function promptWithReferences(input: H3DirectJobInput) {
  const references = [
    ...input.images.map((item, index) => ({ id: `image-${index}`, kind: "image" as const, name: item.name, description: item.description })),
    ...input.videos.map((item, index) => ({ id: `video-${index}`, kind: "video" as const, name: item.name, description: item.description, includeAudio: item.includeAudio })),
    ...input.audios.map((item, index) => ({ id: `audio-${index}`, kind: "audio" as const, name: item.name, description: item.description })),
  ];
  const locked = buildH3StudioLockedReferences({
    mode: input.mode,
    firstImageName: input.firstImage?.name,
    lastImageName: input.lastImage?.name,
    references,
  });
  return composeH3StudioFinalPrompt(locked, input.prompt);
}

async function uploadReference(job: H3DirectJob, backend: ProductionV2H3BackendId, item: H3DirectReference, mediaType: "image" | "video" | "audio", suffix: string) {
  return uploadH3Input({
    backend,
    sourcePath: item.path,
    mediaType,
    uploadName: `${job.id}_${suffix}`,
  });
}

async function execute(job: H3DirectJob) {
  const optionalLoras: ResolvedH3OptionalLora[] = validateH3LoraSelections(job.input.optionalLoras, job.input.mode).resolved;
  validateRequiredLoraTriggers(job.input, optionalLoras);
  const userLoraFilenames = optionalLoras.map((lora) => lora.filename);
  const probes = await Promise.all(H3_BACKEND_PRIORITY.map((backend) => inspectH3BackendCompatibility(backend, { userLoraFilenames })));
  const backend = chooseProductionV2H3Backend(probes);
  if (!backend) {
    const details = probes.map((probe) => `${probe.backend}: ${probe.reason}`).join("; ");
    throw new Error(`No compatible H3 GPU is available. ${details}`);
  }

  await updateJob(job.ownerKey, job.id, {
    status: "preparing",
    statusMessage: `Preparing inputs for ${H3_BACKEND_PROFILES[backend].label}`,
    backend,
    startedAt: new Date().toISOString(),
  });

  const [firstImageFilename, lastImageFilename] = await Promise.all([
    job.input.firstImage ? uploadReference(job, backend, job.input.firstImage, "image", "first") : Promise.resolve(""),
    job.input.lastImage ? uploadReference(job, backend, job.input.lastImage, "image", "last") : Promise.resolve(""),
  ]);
  const imageFilenames = await Promise.all(job.input.images.map((item, index) => uploadReference(job, backend, item, "image", `picture_${index + 1}`)));
  const videoFilenames = await Promise.all(job.input.videos.map((item, index) => uploadReference(job, backend, item, "video", `video_${index + 1}`)));
  const audioFilenames = await Promise.all(job.input.audios.map((item, index) => uploadReference(job, backend, item, "audio", `audio_${index + 1}`)));

  const references = job.input.images.map((item, index) => ({
    id: `direct-picture-${index + 1}`,
    sourceKind: "production-upload" as const,
    sourceId: `direct-picture-${index + 1}`,
    name: item.name,
    workflowImage: item.path,
    generationSourceType: "production-upload" as const,
    pictureSlot: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
    subjectSlot: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
    uploadedFilename: imageFilenames[index],
  }));
  const voices = job.input.audios.map((item, index) => ({
    characterId: `direct-audio-${index + 1}`,
    snapshotName: item.name,
    sourcePath: item.path,
    audioSlot: (index + 1) as 1 | 2 | 3,
    subjectSlot: (index + 1) as 1 | 2 | 3,
    speakerId: (index + 1) as 1 | 2 | 3,
    uploadedFilename: audioFilenames[index],
  }));

  const built = buildH3Workflow({
    backend,
    mode: job.input.mode,
    h3Quality: job.input.quality,
    orientation: job.input.orientation,
    durationSeconds: job.input.durationSeconds,
    finalPrompt: promptWithReferences(job.input),
    seed: job.input.seed,
    outputPrefix: `otg_h3_direct/${safeSegment(job.id)}`,
    startImageFilename: firstImageFilename,
    lastImageFilename,
    references,
    voices,
    videoReferences: job.input.videos.map((item, index) => ({
      uploadedFilename: videoFilenames[index],
      includeAudio: item.includeAudio === true,
    })),
    userLoras: DEFAULT_PRODUCTION_V2_H3_USER_LORAS,
    optionalLoras,
  });

  const submitted = await submitH3Prompt({
    backend,
    graph: built.graph,
    clientId: `otg-h3-direct-${crypto.randomUUID()}`,
    jobId: job.id,
    workerId: "h3-direct",
  });
  if (!submitted.accepted) throw new Error(submitted.error);
  await updateJob(job.ownerKey, job.id, {
    status: "submitted",
    statusMessage: "Accepted by ComfyUI",
    promptId: submitted.promptId,
    workflowId: built.workflowId,
    workflowFile: built.workflowFile,
    progressPercent: 2,
  });

  for (;;) {
    const history = await getH3PromptHistory(backend, submitted.promptId);
    if (history.state === "failed") throw new Error("MiniMax H3 failed in ComfyUI. Review the ComfyUI history for the full node traceback.");
    if (history.state === "completed" && history.video) {
      const outputPath = await downloadH3Video({
        backend,
        file: history.video,
        ownerKey: job.ownerKey,
        productionId: "h3-direct",
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
        await saveH3DirectJobToGallery(completedJob);
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
    const current = await getH3DirectJob(job.ownerKey, job.id);
    const estimate = getH3ProductionTimeEstimate(job.input.mode, job.input.durationSeconds, job.input.quality, backend);
    const elapsed = current?.startedAt ? (Date.now() - Date.parse(current.startedAt)) / 1000 : 0;
    const progressPercent = Math.max(2, Math.min(95, Math.round((elapsed / Math.max(1, estimate.seconds || estimate.maxSeconds)) * 100)));
    await updateJob(job.ownerKey, job.id, { status: "running", statusMessage: "Generating in ComfyUI", progressPercent });
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
}

export function startH3DirectJob(job: H3DirectJob) {
  if (state().running.has(job.id)) return;
  state().running.add(job.id);
  void execute(job)
    .catch(async (error) => {
      await updateJob(job.ownerKey, job.id, {
        status: "failed",
        statusMessage: "Generation failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      }).catch(() => undefined);
    })
    .finally(() => state().running.delete(job.id));
}

export function h3DirectPublicStatus(job: H3DirectJob) {
  const orientation = normalizeH3Orientation(job.input.orientation);
  const nativeDimensions = getH3NativeDimensions(
    job.input.quality,
    orientation,
  );
  const estimate = getH3ProductionTimeEstimate(job.input.mode, job.input.durationSeconds, job.input.quality, job.backend);
  return {
    id: job.id,
    status: job.status,
    statusMessage: job.statusMessage,
    mode: job.input.mode,
    quality: job.input.quality,
    orientation,
    durationSeconds: job.input.durationSeconds,
    prompt: promptWithReferences(job.input),
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
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    videoUrl: job.status === "completed" ? `/api/h3/generation/media?jobId=${encodeURIComponent(job.id)}` : null,
    galleryStatus: job.galleryStatus || "pending",
    galleryFileName: job.galleryFileName || null,
    galleryUrl: job.galleryFileName && job.galleryScope
      ? `/api/gallery/file?name=${encodeURIComponent(job.galleryFileName)}&scope=${job.galleryScope}`
      : null,
    thumbnailUrl: job.galleryFileName && job.galleryScope
      ? `/api/thumb?collection=gallery&name=${encodeURIComponent(job.galleryFileName)}&scope=${job.galleryScope}&w=768`
      : null,
    galleryError: job.galleryError || null,
  };
}

export function validateH3DirectInput(input: H3DirectJobInput) {
  if (!input.prompt.trim()) throw new Error("Enter a prompt before generating.");
  if (!H3_ORIENTATION_OPTIONS.includes(input.orientation)) {
    throw new Error("Choose Landscape or Portrait orientation.");
  }
  if (input.mode === "h3-image-to-video" && !input.firstImage) throw new Error("Choose a First Image.");
  if (input.mode === "h3-reference-to-video" && !input.images.length && !input.videos.length && !input.audios.length) throw new Error("Add at least one reference.");
  if (input.images.length > H3_MAX_IMAGE_REFERENCES) throw new Error(`H3 supports at most ${H3_MAX_IMAGE_REFERENCES} image references.`);
  if (input.videos.length > H3_MAX_VIDEO_REFERENCES) throw new Error(`H3 supports at most ${H3_MAX_VIDEO_REFERENCES} video references.`);
  if (input.audios.length > H3_MAX_AUDIO_REFERENCES) throw new Error(`H3 supports at most ${H3_MAX_AUDIO_REFERENCES} audio references.`);
  const optionalLoras = validateH3LoraSelections(input.optionalLoras, input.mode).resolved;
  validateRequiredLoraTriggers(input, optionalLoras);
  return input;
}
