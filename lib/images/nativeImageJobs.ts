import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { OTG_DATA_ROOT, safeSegment, userGalleryDir, deviceGalleryDir } from "@/lib/paths";
import { getMediaQueueJob } from "@/lib/workers/mediaGpuQueue";
import { resolveComfyPromptImageStatus } from "@/lib/comfyImageOutputLookup";
import { NATIVE_IMAGE_MODELS, type NativeImageModel } from "@/lib/images/nativeImageModels";
import { writeMetaForFile, clearGalleryListCache, type GallerySource } from "@/lib/gallery";
import type { OwnerContext } from "@/lib/ownerKey";

export type NativeImageJob = {id: string; model: NativeImageModel; status: string; promptId?: string; baseUrl?: string;
  width: number; height: number; seed: number; createdAt: string; error?: string; imagePath?: string; prompt?: string; autoSaveGallery?: boolean; galleryOwner?: Pick<OwnerContext, "ownerKey" | "username" | "deviceId" | "scope">; gallerySaved?: boolean};
const validId = (id: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
export function nativeImageJobFile(owner: string, id: string) {
  if (!validId(id)) throw Object.assign(Error("Invalid image job id."), {status: 400});
  return path.join(OTG_DATA_ROOT, "native-image-jobs", safeSegment(owner), id + ".json");
}
export async function writeNativeImageJob(file: string, job: NativeImageJob) {
  const temporary = file + "." + randomUUID() + ".tmp";
  await fs.writeFile(temporary, JSON.stringify(job), {mode: 0o600});
  await fs.rename(temporary, file);
}
export function nativeImagePublicJob(job: NativeImageJob) {
  return {ok: true, jobId: job.id, promptId: job.promptId, prompt_id: job.promptId,
    status: job.status, model: job.model, modelLabel: NATIVE_IMAGE_MODELS[job.model].label,
    steps: NATIVE_IMAGE_MODELS[job.model].steps, width: job.width, height: job.height, seed: job.seed,
    error: job.error, outputNodeId: "461", comfyBaseUrl: job.baseUrl,
    ...(job.imagePath ? {serverPath: job.imagePath, imageUrl: `/api/images/native?jobId=${job.id}&image=1`} : {})};
}

const globalJobs = globalThis as typeof globalThis & { __otgNativeImageCollectors?: Map<string, Promise<NativeImageJob>> };
/** Browser status reads and the server collector share one finalization per owner/job. */
export async function reconcileNativeImageJob(ownerKey: string, id: string): Promise<NativeImageJob> {
  const pending = globalJobs.__otgNativeImageCollectors ||= new Map();
  const key = ownerKey + ":" + id;
  const current = pending.get(key); if (current) return current;
  const work = (async () => {
    const file = nativeImageJobFile(ownerKey, id);
    const job = JSON.parse(await fs.readFile(file, "utf8")) as NativeImageJob;
    if (job.id !== id) throw Error("Image job identity changed.");
    if (!job.imagePath && job.promptId && job.baseUrl && !["failed", "canceled"].includes(job.status)) {
      const queued = getMediaQueueJob(job.promptId);
      if (queued && ["failed", "canceled", "unknown"].includes(queued.status)) {
        job.status = queued.status; job.error = queued.error || `Image job ${queued.status}.`;
        await writeNativeImageJob(file, job);
      } else {
        const result = await resolveComfyPromptImageStatus({promptId: job.promptId, preferredBaseUrl: job.baseUrl, strictPreferred: true, filters: {nodeId: "461"}});
        if (result.status === "completed" && result.image) {
          const params = new URLSearchParams({filename: result.image.filename, subfolder: result.image.subfolder, type: result.image.type});
          const response = await fetch(job.baseUrl + "/view?" + params, {signal: AbortSignal.timeout(30_000)});
          if (!response.ok) throw Error("The completed image could not be retrieved. Try refreshing this job.");
          const bytes = Buffer.from(await response.arrayBuffer());
          const metadata = await sharp(bytes).metadata();
          if (metadata.width !== job.width || metadata.height !== job.height) throw Error("Generated image dimensions differ from the requested configuration.");
          const output = path.join(OTG_DATA_ROOT, "uploads", "characters", safeSegment(ownerKey), `native-${id}.png`);
          await fs.mkdir(path.dirname(output), {recursive: true, mode: 0o700});
          const temporary = output + "." + randomUUID() + ".tmp";
          try { await fs.writeFile(temporary, await sharp(bytes).png().toBuffer(), {mode: 0o600}); await fs.rename(temporary, output); }
          finally { await fs.rm(temporary, {force: true}); }
          job.imagePath = output; job.status = "completed";
          await writeNativeImageJob(file, job);
        } else if (["failed", "missing_output"].includes(result.status)) {
          job.status = "failed"; job.error = result.error; await writeNativeImageJob(file, job);
        } else job.status = result.status === "running" ? "running" : "queued";
      }
    }

    if (job.status === "completed" && job.autoSaveGallery && !job.gallerySaved && job.galleryOwner) {
      if (safeSegment(job.galleryOwner.ownerKey) !== safeSegment(ownerKey)) throw Error("Image Gallery owner changed.");
      await saveNativeImageJobToGallery(job, job.galleryOwner);
      job.gallerySaved = true; await writeNativeImageJob(file, job);
    }
    return job;
  })();
  pending.set(key, work);
  try { return await work; } finally { if (pending.get(key) === work) pending.delete(key); }
}
export async function saveNativeImageJobToGallery(job: NativeImageJob, owner: Pick<OwnerContext, "ownerKey" | "username" | "deviceId" | "scope">, override?: GallerySource) {
  if (job.status !== "completed" || !job.imagePath || !job.promptId) throw Object.assign(Error("Only completed images can be saved to Gallery."), {status: 409});
  const source = override || { ...owner, dir: owner.scope === "user" && owner.username ? userGalleryDir(owner.username) : deviceGalleryDir(owner.deviceId) } as GallerySource;
  const name = `${job.model}_${job.id}.png`, destination = path.join(source.dir, name);
  await fs.mkdir(source.dir, {recursive: true});
  const temporary = destination + "." + randomUUID() + ".tmp";
  try { await fs.copyFile(job.imagePath, temporary); await fs.rename(temporary, destination); }
  finally { await fs.rm(temporary, {force: true}); }
  writeMetaForFile(destination, {sourceType: "native-image", requestKind: job.autoSaveGallery ? "native-auto-gallery-save" : "native-explicit-gallery-save",
    workflowId: `native/${job.model}`, workflowTitle: NATIVE_IMAGE_MODELS[job.model].label, sourcePromptId: job.promptId,
    positivePrompt: job.prompt, mediaCategory: "generated-image", ownerKey: owner.ownerKey,
    username: owner.username, deviceId: owner.deviceId,
    submitPayload: {model: job.model, steps: NATIVE_IMAGE_MODELS[job.model].steps, width: job.width, height: job.height, seed: job.seed, backend: job.baseUrl}}, source);
  clearGalleryListCache();
  return {ok: true, name, url: `/api/gallery/file?name=${encodeURIComponent(name)}&scope=${source.scope}`};
}
