import crypto from "node:crypto";
import { applyH3VideoEditGraph, prepareH3VideoEditSource, finalizeH3VideoEdit, h3VideoEditFrameCount } from "@/lib/h3VideoEdit";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { cancelComfyPrompt } from "@/lib/comfySafeCancel";
import { clearGalleryListCache, safeGalleryName, writeMetaForFile, type GallerySource } from "@/lib/gallery";
import type { OwnerContext } from "@/lib/ownerKey";
import { deviceGalleryDir, ensureDir, OTG_DATA_ROOT, safeJoin, safeSegment, userGalleryDir } from "@/lib/paths";
import {
  ensureComfyClientProgressMonitor,
  readComfyPromptProgress,
  recordComfyPromptSubmitted,
} from "@/lib/comfyProgress";
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
import { studioDimensions } from "@/lib/h3StudioPlan";
import { hasH3StudioQualificationAdmission } from "@/lib/h3StudioQualification";
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
import {
  DEFAULT_H3_ADVANCED_SETTINGS,
  normalizeH3AdvancedSettings,
  type H3AdvancedSettings,
} from "@/lib/production/h3Settings";
import {
  applyH3Rife60FpsFinalization,
  h3FinalFpsForRife,
  H3_RIFE_NATIVE_FPS,
  normalizeH3RifeInterpolation60Fps,
} from "@/lib/h3RifeFinalization";
import { buildH3Workflow, H3_BACKEND_PRIORITY, H3_BACKEND_PROFILES, H3_MAX_AUDIO_REFERENCES, H3_MAX_IMAGE_REFERENCES, H3_MAX_VIDEO_REFERENCES, type ProductionV2H3BackendId, type ProductionV2H3Mode } from "@/lib/production/h3Workflows";

export type H3DirectReference = {
  path: string;
  name: string;
  description: string;
  includeAudio?: boolean;
};

export type H3DirectJobInput = {
  studioPlan?: import("@/lib/h3StudioPlan").H3StudioPlan;
  /** Classification only; never an admission grant. Only the local CLI can authorize. */
  studioQualification?: { fingerprint: string };
  studioMedia?: { requestId: string; reviewId: string; fingerprint: string; qualificationFingerprint: string; planHash: string; receipt: import("@/lib/h3StudioReview").StudioExecutionReceipt; directory: string; files: Array<{ path: string; sha256: string }>; simpleEdit?: { sourceId: string; requestFingerprint: string }; autoRequestFingerprint?: string };
  studioSource?: { requestId: string; source: H3DirectReference; temporarySource: boolean };
  videoEdit?: { requestId: string; source: H3DirectReference; durationSeconds: number; width: number; height: number; temporarySource?: boolean };
  mode: ProductionV2H3Mode;
  quality: H3Quality;
  orientation: H3Orientation;
  durationSeconds: H3ProductionDuration;
  prompt: string;
  h3Settings?: H3AdvancedSettings;
  rifeInterpolation60Fps?: boolean;
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
  status: "queued" | "preparing" | "submitted" | "running" | "finalizing" | "completed" | "failed" | "canceling" | "canceled";
  statusMessage: string;
  input: H3DirectJobInput;
  backend: ProductionV2H3BackendId | null;
  clientId: string | null;
  promptId: string | null;
  workflowId: string | null;
  workflowFile: string | null;
  studioManifest?: unknown;
  studioSubmissionState?: "submitting" | "accepted" | "unknown" | "rejected";
  cancelRequestedAt?: string;
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
  const destination = jobPath(job.ownerKey, job.id);
  const temporaryState = `${destination}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temporaryState, JSON.stringify(job, null, 2), { mode: 0o600 });
  await fsp.rename(temporaryState, destination);
  const temporary = job.input.videoEdit?.temporarySource ? job.input.videoEdit : job.input.studioSource?.temporarySource ? job.input.studioSource : null;
  if (temporary && ["completed", "failed", "canceled"].includes(job.status)) {
    const directory = path.dirname(temporary.source.path);
    const expected = path.join(OTG_DATA_ROOT, "h3-direct", safeSegment(job.ownerKey), "uploads");
    // Only this new workflow's private UUID directory; never legacy/user media.
    if (path.dirname(directory) === expected && /^[0-9a-f-]{36}$/.test(path.basename(directory))) await fsp.rm(directory, { recursive: true, force: true });
  }
  if (job.input.studioMedia && ["completed", "failed", "canceled"].includes(job.status) && !["submitting", "unknown"].includes(job.studioSubmissionState || "")) {
    const directory = job.input.studioMedia.directory;
    const expected = path.join(OTG_DATA_ROOT, "h3-direct", safeSegment(job.ownerKey), "uploads");
    if (path.dirname(directory) === expected && /^[0-9a-f-]{36}$/.test(path.basename(directory))) await fsp.rm(directory, { recursive: true, force: true });
  }
  return job;
}

export async function getH3DirectJob(ownerKey: string, id: string) {
  try {
    return JSON.parse(await fsp.readFile(jobPath(ownerKey, id), "utf8")) as H3DirectJob;
  } catch {
    return null;
  }
}

export async function listH3DirectJobs(ownerKey: string) {
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
          return JSON.parse(await fsp.readFile(path.join(jobsDir(ownerKey), name), "utf8")) as H3DirectJob;
        } catch {
          return null;
        }
      }),
  );

  return jobs
    .filter((job): job is H3DirectJob => Boolean(job?.id && job.ownerKey === ownerKey))
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
}

export async function getLatestH3DirectJob(ownerKey: string) {
  return (await listH3DirectJobs(ownerKey))[0] || null;
}

/** Read-only backend reconciliation. Never resubmits, interrupts, frees or resets. */
export async function reconcileH3StudioSubmission(ownerKey: string, id: string) {
  const current = await getH3DirectJob(ownerKey, id);
  if (!current || !current.input.studioPlan || current.backend !== "rtx3090" || current.promptId
    || !["submitting", "unknown"].includes(current.studioSubmissionState || "") || !current.clientId) return current;
  if (state().running.has(id)) return current; // The original POST may still be resolving.
  try {
    const base = H3_BACKEND_PROFILES.rtx3090.baseUrl;
    const [queueResponse, historyResponse] = await Promise.all(["/queue", "/history?max_items=200"].map(p => fetch(base + p, { cache: "no-store", signal: AbortSignal.timeout(10_000) })));
    if (!queueResponse.ok || !historyResponse.ok) return current;
    const queue = await queueResponse.json(), history = await historyResponse.json();
    if (!Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending) || !history || typeof history !== "object") return current;
    const matches = new Set<string>();
    for (const row of [...queue.queue_running, ...queue.queue_pending]) if (Array.isArray(row) && row[3]?.client_id === current.clientId && typeof row[1] === "string") matches.add(row[1]);
    for (const [promptId, value] of Object.entries(history)) if ((value as { prompt?: unknown[] })?.prompt?.[3] && ((value as { prompt: Array<{ client_id?: string }> }).prompt[3])?.client_id === current.clientId) matches.add(promptId);
    if (matches.size !== 1) return current; // Absence/ambiguous history is not proof of rejection.
    return await updateJob(ownerKey, id, { promptId: [...matches][0], studioSubmissionState: "accepted", status: current.cancelRequestedAt ? "canceling" : "submitted",
      statusMessage: current.cancelRequestedAt ? "Recovered backend identity; verifying cancellation" : "Recovered accepted backend job; collecting its result", error: null });
  } catch { return current; }
}

function isRunnableH3DirectStatus(status: H3DirectJob["status"]) {
  return ["queued", "preparing", "submitted", "running", "finalizing", "canceling"].includes(status);
}

export async function cancelH3DirectJob(ownerKey: string, id: string) {
  const current = await getH3DirectJob(ownerKey, id);
  if (!current) throw new Error("H3 generation job was not found.");
  if (["completed", "failed", "canceled"].includes(current.status)) return current;
  const canceling = await updateJob(ownerKey, id, {
    status: "canceling",
    cancelRequestedAt: current.cancelRequestedAt || new Date().toISOString(),
    statusMessage: "Canceling...",
    error: null,
  });
  // A submission may be in flight. Its owner must record the accepted prompt
  // before a terminal cancellation can be claimed.
  if (!current.promptId && (current.status === "preparing" || current.status === "canceling" || ["submitting", "unknown"].includes(current.studioSubmissionState || ""))) return canceling;
  if (current.backend && current.promptId) {
    try {
      const result = await cancelComfyPrompt(H3_BACKEND_PROFILES[current.backend].baseUrl, current.promptId);
      if (result.status === "canceling") return canceling;
      if (result.status === "completed") return updateJob(ownerKey, id, {status:"running",statusMessage:"Generation completed before cancellation; collecting result."});
    } catch (error) {
      await updateJob(ownerKey, id, {status:current.status,statusMessage:error instanceof Error ? error.message : "Cancellation could not be confirmed."});
      throw error;
    }
  }
  return updateJob(ownerKey, id, {
    status: "canceled",
    statusMessage: "Canceled",
    error: null,
    completedAt: new Date().toISOString(),
  }).catch(() => canceling);
}

const jobUpdates = new Map<string, Promise<unknown>>();
async function updateJob(ownerKey: string, id: string, patch: Partial<H3DirectJob>) {
  const key = `${ownerKey}:${id}`;
  const previous = jobUpdates.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const current = await getH3DirectJob(ownerKey, id);
    if (!current) throw new Error("H3 direct-generation job was not found.");
    return writeJob({ ...current, ...patch });
  });
  jobUpdates.set(key, next);
  try { return await next; } finally { if (jobUpdates.get(key) === next) jobUpdates.delete(key); }
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
      h3Settings: normalizeH3AdvancedSettings(
        input.h3Settings || DEFAULT_H3_ADVANCED_SETTINGS,
        input.images.length,
      ),
      rifeInterpolation60Fps: normalizeH3RifeInterpolation60Fps(input.rifeInterpolation60Fps),
      optionalLoras: input.optionalLoras,
    },
    backend: null,
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
    `H3_${job.input.videoEdit ? "video-edit" : job.input.mode.replace(/^h3-/, "")}_${job.input.videoEdit?.durationSeconds ?? job.input.studioPlan?.durationSeconds ?? job.input.durationSeconds}s_${job.input.quality}_${job.input.orientation}_${job.id}.mp4`,
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
    const dimensions = job.input.studioPlan ? studioDimensions(job.input.studioPlan) : getH3NativeDimensions(job.input.quality, normalizeH3Orientation(job.input.orientation));
    writeMetaForFile(targetPath, {
      originalName: savedName,
      renamedName: savedName,
      sourceType: job.input.videoEdit ? "h3-video-edit" : "h3-direct-generation",
      requestKind: "h3-direct-auto-gallery",
      mediaCategory: "generated-video",
      positivePrompt: job.input.prompt,
      workflowId: job.workflowId,
      workflowTitle: job.input.videoEdit ? "MiniMax H3 Video Edit" : "MiniMax H3 Direct Generation",
      sourcePromptId: job.promptId,
      submitPayload: {
        ...(job.studioManifest ? { studioManifest: job.studioManifest } : {}),
        requestKind: "h3-direct-auto-gallery",
        jobId: job.id,
        mode: job.input.videoEdit ? "h3-video-to-video" : job.input.mode,
        quality: job.input.quality,
        orientation: normalizeH3Orientation(job.input.orientation),
        width: job.input.videoEdit?.width ?? dimensions.width,
        height: job.input.videoEdit?.height ?? dimensions.height,
        durationSeconds: job.input.videoEdit?.durationSeconds ?? job.input.studioPlan?.durationSeconds ?? job.input.durationSeconds,
        nativeFps: H3_RIFE_NATIVE_FPS,
        finalFps: h3FinalFpsForRife(job.input.rifeInterpolation60Fps),
        rifeInterpolation60Fps: job.input.rifeInterpolation60Fps === true,
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
  let persisted = await getH3DirectJob(job.ownerKey, job.id) || job;
  if (persisted.status === "canceled") return;
  const qualification = await import("@/lib/h3StudioQualification");
  const qualificationJob = !!job.input.studioPlan && qualification.hasH3StudioQualificationAdmission(job.id, job.ownerKey);
  if (job.input.studioPlan && !job.input.studioMedia && !qualificationJob) throw new Error("Reviewed owner-bound H3 Studio media is required.");
  if (job.input.studioPlan && persisted.backend && persisted.backend !== "rtx3090") throw new Error("H3 Studio cannot resume on a non-3090 backend.");
  if (job.input.studioPlan && !persisted.promptId && ["submitting", "unknown"].includes(persisted.studioSubmissionState || "")) throw new Error("Backend submission is unresolved; automatic resubmission is disabled.");
  const checkBoundMedia = async () => {
    const media = job.input.studioMedia; if (!media) return;
    const expected = path.join(OTG_DATA_ROOT, "h3-direct", safeSegment(job.ownerKey), "uploads");
    if (path.dirname(media.directory) !== expected || !/^[0-9a-f-]{36}$/.test(path.basename(media.directory))) throw new Error("Invalid private Studio media directory.");
    const references = [job.input.firstImage, job.input.lastImage, ...job.input.images, ...job.input.videos, ...job.input.audios].filter(Boolean) as H3DirectReference[];
    if (references.length !== media.files.length || references.some(r => !media.files.some(f => f.path === r.path))) throw new Error("Studio reference identity changed.");
    const { studioFileSha256 } = await import("@/lib/h3StudioMedia");
    for (const file of media.files) if (path.dirname(file.path) !== media.directory || !/^[a-f0-9]{64}$/.test(file.sha256) || await studioFileSha256(file.path) !== file.sha256) throw new Error("Studio reference bytes changed; submit a fresh reviewed plan.");
  };
  const optionalLoras: ResolvedH3OptionalLora[] = validateH3LoraSelections(persisted.input.optionalLoras, persisted.input.mode).resolved;
  validateRequiredLoraTriggers(persisted.input, optionalLoras);

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
      status: persisted.cancelRequestedAt ? "canceling" : persisted.status === "finalizing" ? "finalizing" : "running",
      statusMessage: persisted.cancelRequestedAt ? "Cancellation requested; verifying backend clearance" : persisted.status === "finalizing" ? persisted.statusMessage : "Reconnected to running H3 generation",
      error: null,
    });
  } else {
    await checkBoundMedia();
    if (qualificationJob) qualification.assertH3StudioQualificationRequest(job.id, job.ownerKey, job.input);
    const userLoraFilenames = optionalLoras.map((lora) => lora.filename);
    const probes = await Promise.all(

      H3_BACKEND_PRIORITY.filter(candidate => !(job.input.videoEdit || job.input.studioPlan) || candidate === "rtx3090").map((candidate) =>

        inspectH3BackendCompatibility(candidate, {

          userLoraFilenames,
            mode: persisted.input.mode,

          h3Settings: persisted.input.h3Settings,

          referenceCount: persisted.input.images.length,
          requireRife60Fps: persisted.input.rifeInterpolation60Fps === true,

        }),

      ),

    );
    backend = chooseProductionV2H3Backend(probes);
    if (!backend) {
      const details = probes.map((probe) => `${probe.backend}: ${probe.reason}`).join("; ");
      throw new Error(`No compatible H3 GPU is available. ${details}`);
    }
    const selectedBackend = backend;
    const beforePreparing = await getH3DirectJob(job.ownerKey, job.id);
    if (beforePreparing?.cancelRequestedAt || beforePreparing?.status === "canceled") {
      await updateJob(job.ownerKey, job.id, { status: "canceled", statusMessage: "Canceled before backend submission", completedAt: new Date().toISOString() }); return;
    }

    await updateJob(job.ownerKey, job.id, {
      status: "preparing",
      statusMessage: `Preparing inputs for ${H3_BACKEND_PROFILES[selectedBackend].label}`,
      backend: selectedBackend,
      startedAt: new Date().toISOString(),
    });

    const [firstImageFilename, lastImageFilename] = await Promise.all([
      job.input.firstImage ? uploadReference(job, selectedBackend, job.input.firstImage, "image", "first") : Promise.resolve(""),
      job.input.lastImage ? uploadReference(job, selectedBackend, job.input.lastImage, "image", "last") : Promise.resolve(""),
    ]);
    const imageFilenames = await Promise.all(job.input.images.map((item, index) => uploadReference(job, selectedBackend, item, "image", `picture_${index + 1}`)));
    const videoFilenames = await Promise.all(job.input.videos.map((item, index) => uploadReference(job, selectedBackend, item, "video", `video_${index + 1}`)));
    const audioFilenames = await Promise.all(job.input.audios.map((item, index) => uploadReference(job, selectedBackend, item, "audio", `audio_${index + 1}`)));

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

    let built = buildH3Workflow({
      backend: selectedBackend,
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
      h3Settings: job.input.h3Settings,
      optionalLoras,
    });

    let studioCompilation: ReturnType<typeof import("@/lib/h3StudioCompiler").compileH3StudioPlan> | undefined;
    let studioBuildInput: Parameters<typeof import("@/lib/h3StudioCompiler").compileH3StudioPlan>[1] | undefined;
    if (job.input.studioPlan) {
      const { compileH3StudioPlan } = await import("@/lib/h3StudioCompiler");
      const { inspectH3StudioInventory, readH3StudioEvidence, assertH3StudioTest } = await import("@/lib/h3StudioRegistry");
      assertH3StudioTest();
      studioBuildInput = { backend: selectedBackend, mode: job.input.mode,
        h3Quality: job.input.quality, orientation: job.input.orientation, durationSeconds: job.input.durationSeconds,
        finalPrompt: promptWithReferences(job.input), seed: job.input.seed, outputPrefix: `otg_h3_direct/${safeSegment(job.id)}`,
        startImageFilename: firstImageFilename, lastImageFilename, references, voices,
        videoReferences: job.input.videos.map((item, index) => ({ uploadedFilename: videoFilenames[index], includeAudio: item.includeAudio === true })) };
      const result = compileH3StudioPlan(job.input.studioPlan, studioBuildInput,
        await inspectH3StudioInventory(qualificationJob ? { qualificationJobId: job.id, ownerKey: job.ownerKey } : undefined), readH3StudioEvidence(), { ownerKey: job.ownerKey });
      const qualifying = qualificationJob && qualification.isStudioQualificationJob(job.id, result.manifest.qualificationFingerprint);
      if ((!result.manifest.executable && !(qualifying && result.manifest.readyForQualification)) || (job.input.studioMedia && job.input.studioMedia.qualificationFingerprint !== result.manifest.qualificationFingerprint)) throw new Error("H3 plan qualification changed; no backend job was submitted.");
      await updateJob(job.ownerKey, job.id, { studioManifest: result.manifest });
      studioCompilation = result;
      built = { ...built, graph: result.graph, workflowId: result.workflowId };
    }

    if (job.input.videoEdit) {
      const edit = job.input.videoEdit;
      const prepared = await prepareH3VideoEditSource(edit.source.path, edit.durationSeconds, edit.width, edit.height);
      const filename = await uploadReference(job, selectedBackend, { ...edit.source, path: prepared, name: "source-conditioned.mp4" }, "video", "v2v_source");
      applyH3VideoEditGraph(built.graph, filename, edit.durationSeconds, edit.width, edit.height);
      built.workflowId = "minimax-h3-fun-control-video-edit-native25-v2";
      built.workflowFile = "lib/h3VideoEdit.ts";
    }

    const clientId = `otg-h3-direct-${crypto.randomUUID()}`;
    const beforeSubmission = await getH3DirectJob(job.ownerKey, job.id);
    if (beforeSubmission?.status === "canceling" || beforeSubmission?.status === "canceled") {
      await updateJob(job.ownerKey,job.id,{status:"canceled",statusMessage:"Canceled before backend submission",completedAt:new Date().toISOString()});
      return;
    }
    const submitted = await submitH3Prompt({
      backend: selectedBackend,
      graph: built.graph,
      clientId,
      jobId: job.id,
      ownerKey: job.ownerKey,
      deviceId: job.galleryOwner?.deviceId || null,
      workerId: "h3-direct",
      ...(job.input.studioPlan ? {
        releaseIdlePeer: false,
        beforeSubmit: async () => {
          await checkBoundMedia();
          const latest = await getH3DirectJob(job.ownerKey, job.id);
          if (!latest || latest.cancelRequestedAt || ["canceling", "canceled"].includes(latest.status)) throw new Error("Cancelled before backend submission.");
          if (!studioCompilation) throw new Error("Studio compilation is missing.");
          const { compileH3StudioPlan } = await import("@/lib/h3StudioCompiler");
          const { inspectH3StudioInventory, readH3StudioEvidence } = await import("@/lib/h3StudioRegistry");
          if (!studioBuildInput || !job.input.studioPlan) throw new Error("Studio inputs are missing.");
          const checked = compileH3StudioPlan(job.input.studioPlan, studioBuildInput,
            await inspectH3StudioInventory(qualificationJob ? { qualificationJobId: job.id, ownerKey: job.ownerKey } : undefined), readH3StudioEvidence(), { ownerKey: job.ownerKey });
          if (checked.manifest.qualificationFingerprint !== studioCompilation.manifest.qualificationFingerprint
            || checked.manifest.boundGraphDigest !== studioCompilation.manifest.boundGraphDigest
            || (!checked.manifest.executable && !(qualificationJob && checked.manifest.readyForQualification))) throw new Error("Qualification or dependencies changed during admission.");
          studioCompilation = checked;
          if (job.input.studioMedia) {
            const { studioReviewedExecutionDigest, studioRequestHash } = await import("@/lib/h3StudioReview");
            const approved = job.input.studioMedia;
            const actual = { executionDigest: studioReviewedExecutionDigest(checked.graph), credits: checked.manifest.estimatedCredits, seconds: checked.manifest.estimatedSeconds };
            if (studioRequestHash(job.input.studioPlan) !== approved.planHash || studioRequestHash(actual) !== studioRequestHash(approved.receipt)) throw new Error("The reviewed prompt, seed, estimate or execution graph changed.");
          }
          if (qualificationJob) {
            const { computeH3StudioSourceRevision } = await import("@/lib/h3StudioIdentity");
            const { inspectStudioQualificationRuntime } = await import("@/lib/h3StudioRuntime");
            const requiredVram = qualification.getH3StudioQualificationRequiredVramBytes(job.id, job.ownerKey);
            if (!requiredVram) throw new Error("Qualification capacity budget is missing.");
            const live = await inspectStudioQualificationRuntime(requiredVram, true);
            const admission = qualification.consumeH3StudioQualificationAdmission({ jobId: job.id, ownerKey: job.ownerKey,
              fingerprint: studioCompilation.manifest.qualificationFingerprint, sourceRevision: computeH3StudioSourceRevision(),
              boundGraphDigest: studioCompilation.manifest.boundGraphDigest, readyForQualification: studioCompilation.manifest.readyForQualification, live, request: job.input });
            if (!admission) throw new Error("Qualification admission is not valid for this idle worker and exact configuration.");
            qualification.captureH3StudioQualificationGraph({ jobId: job.id, ownerKey: job.ownerKey, graph: built.graph });
          }
          await updateJob(job.ownerKey, job.id, { studioSubmissionState: "submitting", clientId, workflowId: built.workflowId, workflowFile: built.workflowFile });
        },
        onAccepted: async (acceptedPromptId: string) => {
          const latest = await getH3DirectJob(job.ownerKey, job.id);
          await updateJob(job.ownerKey, job.id, { promptId: acceptedPromptId, clientId, studioSubmissionState: "accepted", status: latest?.cancelRequestedAt || ["canceling", "canceled"].includes(latest?.status || "") ? "canceling" : "submitted", statusMessage: "Accepted by ComfyUI; prompt identity recorded" });
        },
      } : {}),
    });
    if (!submitted.accepted) {
      if (job.input.studioPlan && [400, 401, 403, 404, 413, 422, 429].includes(submitted.status)) await updateJob(job.ownerKey, job.id, { studioSubmissionState: "rejected" });
      throw new Error(submitted.error);
    }
    backend = selectedBackend;
    promptId = submitted.promptId;
    const latestAcceptance = await getH3DirectJob(job.ownerKey, job.id);
    const cancelRequested = !!latestAcceptance?.cancelRequestedAt || ["canceling","canceled"].includes(latestAcceptance?.status || "");
    await updateJob(job.ownerKey, job.id, {
      status: cancelRequested ? "canceling" : "submitted",
      statusMessage: cancelRequested ? "Cancellation requested; verifying backend clearance" : "Accepted by ComfyUI",
      clientId,
      promptId,
      workflowId: built.workflowId,
      workflowFile: built.workflowFile,
      progressPercent: 2,
    });
  }

  if (!backend || !promptId) throw new Error("H3 generation could not be resumed because backend or prompt ID is missing.");

  for (;;) {
    const current = await getH3DirectJob(job.ownerKey, job.id);
    if (current?.status === "canceled") return;
    if (current?.status === "canceling") { await cancelH3DirectJob(job.ownerKey,job.id); await new Promise(r=>setTimeout(r,500)); continue; }
    const history = await getH3PromptHistory(backend, promptId);
    if (history.state === "failed") throw new Error("MiniMax H3 failed in ComfyUI. Review the ComfyUI history for the full node traceback.");
    if (history.state === "completed" && history.video) {
      let outputPath = await downloadH3Video({
        backend,
        file: history.video,
        ownerKey: job.ownerKey,
        productionId: "h3-direct",
        sceneId: job.id,
        generationJobId: job.id,
      });
      if (job.input.videoEdit) outputPath = await finalizeH3VideoEdit(outputPath, job.input.videoEdit.durationSeconds);
      if (job.input.studioPlan) {
        const { finalizeH3StudioAudio } = await import("@/lib/h3StudioAudio");
        outputPath = await finalizeH3StudioAudio(outputPath, job.input.studioPlan, job.input.videos[0]?.path);
        const latest = await getH3DirectJob(job.ownerKey, job.id);
        if (latest?.status === "canceling" || latest?.status === "canceled") {
          await updateJob(job.ownerKey, job.id, { status: "canceled", statusMessage: "Canceled after backend completion; output was not added to Gallery", completedAt: new Date().toISOString() });
          return;
        }
      }
      const rifeResult = await applyH3Rife60FpsFinalization({
        enabled: job.input.rifeInterpolation60Fps,
        backend,
        sourceVideoPath: outputPath,
        ownerKey: job.ownerKey,
        productionId: "h3-direct",
        sceneId: job.id,
        generationJobId: job.id,
        outputPrefix: `otg_h3_direct_rife/${safeSegment(job.id)}`,
      });
      if (rifeResult) outputPath = rifeResult.outputPath;
      const completedJob = await updateJob(job.ownerKey, job.id, {
        status: "finalizing",
        statusMessage: "Video complete; saving to Gallery",
        outputPath,
        completedAt: new Date().toISOString(),
      });
      if (qualificationJob) {
        await updateJob(job.ownerKey, job.id, { status: "completed", statusMessage: "Qualification output complete; awaiting owner playback review (not published to Gallery)" });
        return;
      }
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
    const estimate = getH3ProductionTimeEstimate(job.input.mode, job.input.durationSeconds, job.input.quality, backend);
    const elapsed = current?.startedAt ? (Date.now() - Date.parse(current.startedAt)) / 1000 : 0;
    const progressPercent = Math.max(2, Math.min(95, Math.round((elapsed / Math.max(1, estimate.seconds || estimate.maxSeconds)) * 100)));
    await updateJob(job.ownerKey, job.id, { status: "running", statusMessage: "Generating in ComfyUI", progressPercent });
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
}

export function startH3DirectJob(job: H3DirectJob) {
  if (job.input.studioQualification && !hasH3StudioQualificationAdmission(job.id, job.ownerKey)) return;
  if (state().running.has(job.id)) return;
  state().running.add(job.id);
  void execute(job)
    .catch(async (error) => {
      const current = await getH3DirectJob(job.ownerKey, job.id);
      const uncertain = !!job.input.studioPlan && current?.studioSubmissionState === "submitting" && !current.promptId;
      if (!uncertain && !current?.promptId && ["canceling", "canceled"].includes(current?.status || "")) {
        await updateJob(job.ownerKey, job.id, { status: "canceled", statusMessage: "Canceled before backend submission", error: null, completedAt: new Date().toISOString() });
        return;
      }
      await updateJob(job.ownerKey, job.id, {
        status: "failed",
        statusMessage: uncertain ? "Submission state unknown; backend reconciliation required before retry" : "Generation failed",
        ...(uncertain ? { studioSubmissionState: "unknown" as const } : {}),
        error: job.input.studioPlan ? uncertain ? "Backend acceptance is unresolved. Refresh to reconcile the original job; do not generate a duplicate." : "H3 Studio could not complete. Recheck readiness and references before a deliberately reviewed retry." : error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      }).catch(() => undefined);
    })
    .finally(() => state().running.delete(job.id));
}

export function ensureH3DirectJobRunner(job: H3DirectJob | null | undefined) {
  if (!job || !isRunnableH3DirectStatus(job.status)) return;
  if (job.input.studioQualification && !hasH3StudioQualificationAdmission(job.id, job.ownerKey)) return;
  startH3DirectJob(job);
}

export function h3DirectPublicStatus(job: H3DirectJob) {
  const orientation = normalizeH3Orientation(job.input.orientation);
  const nativeDimensions = job.input.studioPlan ? studioDimensions(job.input.studioPlan) : getH3NativeDimensions(
    job.input.quality,
    orientation,
  );
  const estimate = getH3ProductionTimeEstimate(job.input.mode, job.input.durationSeconds, job.input.quality, job.backend);
  const progress = readComfyPromptProgress(job.promptId);
  return {
    id: job.id,
    status: job.status,
    statusMessage: job.statusMessage,
    mode: job.input.videoEdit ? "h3-video-to-video" : job.input.mode,
    quality: job.input.quality,
    orientation,
    durationSeconds: job.input.videoEdit?.durationSeconds ?? job.input.studioPlan?.durationSeconds ?? job.input.durationSeconds,
    nativeFps: H3_RIFE_NATIVE_FPS,
    finalFps: h3FinalFpsForRife(job.input.rifeInterpolation60Fps),
    rifeInterpolation60Fps: job.input.rifeInterpolation60Fps === true,
    prompt: promptWithReferences(job.input),
    backend: job.backend,
    backendLabel: job.backend ? H3_BACKEND_PROFILES[job.backend].label : null,
    workflowId: job.workflowId,
    workflowFile: job.workflowFile,
    ...(job.studioManifest ? { studioManifest: job.studioManifest } : {}),
    ...(job.input.studioPlan ? { submissionState: job.studioSubmissionState || null, cancellationRequested: !!job.cancelRequestedAt } : {}),
    nativeResolution: job.input.videoEdit ? `${job.input.videoEdit.width}x${job.input.videoEdit.height}` : `${nativeDimensions.width}x${nativeDimensions.height}`,
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
    videoUrl: job.status === "completed" ? `/api/h3/generation/media?jobId=${encodeURIComponent(job.id)}` : null,
    galleryStatus: job.galleryStatus || "pending",
    galleryFileName: job.galleryFileName || null,
    galleryUrl: job.galleryFileName && job.galleryScope
      ? `/api/gallery/file?name=${encodeURIComponent(job.galleryFileName)}&scope=${job.galleryScope}`
      : null,
    thumbnailUrl: job.status === "completed"
      ? `/api/h3/generation/thumbnail?jobId=${encodeURIComponent(job.id)}`
      : null,
    galleryError: job.galleryError || null,
  };
}

export function validateH3DirectInput(input: H3DirectJobInput) {
  if (input.videoEdit) h3VideoEditFrameCount(input.videoEdit.durationSeconds);
  input.rifeInterpolation60Fps = normalizeH3RifeInterpolation60Fps(input.rifeInterpolation60Fps);
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
