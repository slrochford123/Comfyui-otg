import fs from "node:fs/promises";
import path from "node:path";
import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { privateMediaEnvironmentEnabled } from "@/lib/privateMediaRuntime";
import { readState, markError } from "@/lib/contentState";
import { writePromptRequestMeta, type PromptRequestMeta } from "@/lib/promptRequestMeta";

const active = new Set(["queued", "preparing", "submitted", "running", "finalizing", "canceling"]);
type RecordJob = { id: string; ownerKey: string; status: string; promptId?: string; clientId?: string; backend?: string; outputPath?: string; galleryStatus?: string; studioSubmissionState?: string; input?: unknown };
const globalRecovery = globalThis as typeof globalThis & { __otgContentRecovery?: { timer: ReturnType<typeof setInterval>; busy: boolean } };

/** Only owned regular JSON records, never symlinks or browser-provided paths. */
async function directories(root: string) {
  return (await fs.readdir(root, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory()).map(entry => entry.name);
}
async function records<T>(root: string): Promise<T[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const result: T[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(root, entry.name);
    try {
      const value = JSON.parse(await fs.readFile(file, "utf8"));
      const identity = typeof value.id === "string" ? value.id : value.promptId;
      if (typeof identity !== "string" || !/^[a-zA-Z0-9_-]+$/.test(identity) || identity + ".json" !== entry.name) continue;
      result.push(value);
    } catch { /* An incomplete/corrupt record cannot authorize GPU work. */ }
  }
  return result;
}
async function recoverVideos(root: string, kind: "direct" | "refmods" | "realism" | "body-swap") {
  for (const owner of await directories(root)) {
    for (const job of await records<RecordJob>(path.join(root, owner, "jobs"))) {
      if (!job.id || !job.ownerKey || safeSegment(job.ownerKey) !== owner || !job.input) continue;
      try {
        if (["failed", "canceled"].includes(job.status) && job.promptId && job.clientId) {
          const queue = await import("@/lib/workers/mediaGpuQueue");
          const pending = queue.getMediaQueueJob(job.promptId);
          const worker = {direct: "h3-direct", refmods: "h3-refmods-t2v", realism: "h3-realism", "body-swap": "h3-body-swap"}[kind];
          if (pending?.kind === "comfy" && pending.status === "queued" && pending.gpu === job.backend) {
            const payload = pending.payload as import("@/lib/workers/mediaGpuQueue").ComfyMediaPayload;
            if (payload.workerId === worker && payload.body.client_id === job.clientId) queue.cancelQueuedMediaJob(pending.id, payload.baseUrl);
          }
        }
        if (kind === "direct") {
          const jobs = await import("@/lib/h3DirectJobs");
          // Unknown acceptance is reconciled by client identity, never by a second POST.
          const current = !job.promptId && ["submitting", "unknown"].includes(job.studioSubmissionState || "")
            ? await jobs.reconcileH3StudioSubmission(job.ownerKey, job.id) : job;
          if (!current) continue;
          if (active.has(current.status)) jobs.ensureH3DirectJobRunner(current as Parameters<typeof jobs.ensureH3DirectJobRunner>[0]);
          else if (current.status === "completed" && current.outputPath && current.galleryStatus !== "saved") await jobs.saveH3DirectJobToGallery(current as Parameters<typeof jobs.saveH3DirectJobToGallery>[0]);
        } else {
          // Special modes did not historically persist a pre-acceptance receipt.
          // A stale preparing record without a prompt ID must never be resubmitted.
          if (!job.promptId && job.status !== "queued") continue;
          if (kind === "refmods") {
            const jobs = await import("@/lib/h3SpecialModes/refModsJobs");
            if (active.has(job.status)) jobs.ensureH3RefModsJobRunner(job as Parameters<typeof jobs.ensureH3RefModsJobRunner>[0]);
            else if (job.status === "completed" && job.outputPath && job.galleryStatus !== "saved") await jobs.saveH3RefModsJobToGallery(job as Parameters<typeof jobs.saveH3RefModsJobToGallery>[0]);
          } else if (kind === "realism") {
            const jobs = await import("@/lib/h3SpecialModes/realismJobs");
            if (active.has(job.status)) jobs.ensureH3RealismJobRunner(job as Parameters<typeof jobs.ensureH3RealismJobRunner>[0]);
            else if (job.status === "completed" && job.outputPath && job.galleryStatus !== "saved") await jobs.saveH3RealismJobToGallery(job as Parameters<typeof jobs.saveH3RealismJobToGallery>[0]);
          } else {
            const jobs = await import("@/lib/h3SpecialModes/bodySwapJobs");
            if (active.has(job.status)) jobs.ensureH3BodySwapJobRunner(job as Parameters<typeof jobs.ensureH3BodySwapJobRunner>[0]);
            else if (job.status === "completed" && job.outputPath && job.galleryStatus !== "saved") await jobs.saveH3BodySwapJobToGallery(job as Parameters<typeof jobs.saveH3BodySwapJobToGallery>[0]);
          }
        }
      } catch { /* Preserve the accepted job and retry collection on the next server tick. */ }
    }
  }
}
async function recoverNativeImages() {
  const root = path.join(OTG_DATA_ROOT, "native-image-jobs");
  for (const owner of await directories(root)) {
    for (const job of await records<{ id: string; promptId?: string; status: string; autoSaveGallery?: boolean; gallerySaved?: boolean }>(path.join(root, owner))) {
      if (!job.promptId || ["failed", "canceled"].includes(job.status) || job.status === "completed" && (!job.autoSaveGallery || job.gallerySaved)) continue;
      try { await (await import("@/lib/images/nativeImageJobs")).reconcileNativeImageJob(owner, job.id); }
      catch { /* Retrieval failures cannot erase or regenerate the accepted image. */ }
    }
  }
}
async function recoverGenerateOutputs() {
  const root = path.join(OTG_DATA_ROOT, "prompt_request_meta");
  for (const owner of await directories(root)) {
    for (const meta of await records<PromptRequestMeta>(path.join(root, owner))) {
      if (!meta.ownerKey || safeSegment(meta.ownerKey) !== owner || !meta.promptId || !meta.comfyBaseUrl || meta.requestKind === "native-image" || ["synced", "error"].includes(meta.backgroundSync || "")) continue;
      const state = readState(meta.ownerKey);
      // Recover old in-flight Generate submissions, without importing historical/private previews.
      if (meta.backgroundSync !== "pending" && !(state.status === "running" && state.promptId === meta.promptId)) continue;
      try {
        const { getMediaQueueJob } = await import("@/lib/workers/mediaGpuQueue");
        const queued = getMediaQueueJob(meta.promptId);
        if (queued && !["completed", "failed", "canceled"].includes(queued.status)) continue;
        if (queued && ["failed", "canceled"].includes(queued.status)) {
          if (state.promptId === meta.promptId) markError(meta.ownerKey, queued.error || "Generation ended without a completed output.");
          writePromptRequestMeta(meta.ownerKey, meta.promptId, {backgroundSync: "error"}); continue;
        }
        const result = await (await import("@/lib/comfyGallerySync")).syncPromptOutputsForOwner({ promptId: meta.promptId, ownerKey: meta.ownerKey,
          username: meta.username || null, deviceId: meta.deviceId || state.deviceId || "", comfyBaseUrl: meta.comfyBaseUrl,
          updateCurrentState: state.promptId === meta.promptId });
        if (["synced", "already-synced"].includes(result.status)) writePromptRequestMeta(meta.ownerKey, meta.promptId, { backgroundSync: "synced" });
        else if (result.status === "error" && queued && ["failed", "canceled"].includes(queued.status)) writePromptRequestMeta(meta.ownerKey, meta.promptId, { backgroundSync: "error" });
      } catch { /* The bound worker may be offline. Never substitute another GPU/output. */ }
    }
  }
}
/** Server lifetime, independent of Android tabs, requests, sessions and browser polling. */
export async function tickContentCreationRecovery() {
  if (!privateMediaEnvironmentEnabled()) return;
  const state = globalRecovery.__otgContentRecovery;
  if (state?.busy) return;
  if (state) state.busy = true;
  try {
    await Promise.allSettled([
      recoverVideos(path.join(OTG_DATA_ROOT, "h3-direct"), "direct"),
      recoverVideos(path.join(OTG_DATA_ROOT, "h3-special", "refmods-generation"), "refmods"),
      recoverVideos(path.join(OTG_DATA_ROOT, "h3-special", "realism"), "realism"),
      recoverVideos(path.join(OTG_DATA_ROOT, "h3-special", "body-swap"), "body-swap"),
      recoverNativeImages(), recoverGenerateOutputs(),
    ]);
  } finally { if (state) state.busy = false; }
}
export function bootstrapContentCreationRecovery() {
  if (!privateMediaEnvironmentEnabled() || globalRecovery.__otgContentRecovery) return;
  const timer = setInterval(() => { void tickContentCreationRecovery().catch(() => {}); }, 10_000);
  timer.unref();
  globalRecovery.__otgContentRecovery = { timer, busy: false };
  void tickContentCreationRecovery().catch(() => {});
}
export function closeContentCreationRecoveryForTests() {
  if (globalRecovery.__otgContentRecovery) clearInterval(globalRecovery.__otgContentRecovery.timer);
  delete globalRecovery.__otgContentRecovery;
}
