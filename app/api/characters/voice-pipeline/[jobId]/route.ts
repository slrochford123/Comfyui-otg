import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { getOwnerContext } from "@/lib/ownerKey";
import { withNoStore, sessionErrorResponse } from "@/lib/http/routeHelpers";
import {
  finalizeTrainingDatasetJob,
  findVoicePipelineJobOwnerKey,
  getQueuedContractJob,
  resumeVoicePipelineJob,
  stopVoicePipelineJob,
  terminateVoicePipelineJob,
} from "@/lib/jobs/voicePipelineJobs";
import { resolveTrainingDatasetManifestPath, trainingDatasetManifestUrl } from "@/lib/jobs/trainingDatasetManifest";
import { hasValidWorkerToken } from "@/lib/jobs/workerAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: withNoStore() });
}

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function resolveVoicePipelineJobOwnerKey(jobId: string, fallbackOwnerKey: string): string {
  const storedOwnerKey = findVoicePipelineJobOwnerKey(jobId);
  return storedOwnerKey && /^[A-Za-z0-9._@-]{1,200}$/.test(storedOwnerKey)
    ? storedOwnerKey
    : fallbackOwnerKey;
}

async function fileHasBytes(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function validateReadyTrainingDataset(ownerKey: string, characterId: string, jobId: string) {
  const manifestPath = resolveTrainingDatasetManifestPath(ownerKey, characterId, jobId);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const clips = Array.isArray(manifest.clips) ? manifest.clips.filter((clip): clip is Record<string, unknown> => !!clip && typeof clip === "object" && !Array.isArray(clip)) : [];
  const requestedClipCount = Math.max(1, Number(manifest.requestedClipCount || clips.length || 200));
  const readyClips = clips.filter((clip) => cleanString(clip.status) === "ready");

  if (manifest.generationMode !== "real" || manifest.provider !== "indextts2") {
    throw new Error("Dataset is not a real IndexTTS2 training dataset.");
  }
  if (readyClips.length < requestedClipCount) {
    throw new Error(`Dataset is not complete: ${readyClips.length} / ${requestedClipCount} clips are ready.`);
  }

  for (const clip of readyClips.slice(0, requestedClipCount)) {
    const expectedAudioPath = cleanString(clip.expectedAudioPath);
    if (!expectedAudioPath || !(await fileHasBytes(expectedAudioPath))) {
      throw new Error(`Ready clip is missing or empty: ${cleanString(clip.clipId) || expectedAudioPath}`);
    }
  }

  return {
    manifest,
    manifestPath,
    manifestUrl: trainingDatasetManifestUrl(ownerKey, characterId, jobId),
    requestedClipCount,
    generatedClipCount: readyClips.length,
  };
}

async function quarantineTrainingDataset(ownerKey: string, characterId: string, jobId: string) {
  const manifestPath = resolveTrainingDatasetManifestPath(ownerKey, characterId, jobId);
  const datasetRoot = path.dirname(manifestPath);
  const terminatedRoot = path.join(path.dirname(datasetRoot), "terminated");
  const targetRoot = path.join(terminatedRoot, jobId);
  try {
    await fs.mkdir(terminatedRoot, { recursive: true });
    await fs.rm(targetRoot, { recursive: true, force: true });
    await fs.rename(datasetRoot, targetRoot);
    return { quarantinedDatasetPath: targetRoot };
  } catch (error) {
    return { quarantineError: error instanceof Error ? error.message : "Could not quarantine dataset." };
  }
}

async function readVoicePipelinePatchAction(req: Request): Promise<
  | { ok: true; action: string; value: Record<string, unknown> }
  | { ok: false; error: string; status: number }
> {
  const url = new URL(req.url);

  const queryAction = String(url.searchParams.get("action") || "").trim().toLowerCase();
  if (queryAction) {
    return { ok: true, action: queryAction, value: { action: queryAction } };
  }

  const headerAction = String(req.headers.get("x-otg-action") || "").trim().toLowerCase();
  if (headerAction) {
    return { ok: true, action: headerAction, value: { action: headerAction } };
  }

  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return { ok: false, error: "Could not read JSON request body.", status: 400 };
  }

  if (!raw.trim()) {
    return { ok: false, error: "Missing JSON request body.", status: 400 };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid JSON request body.", status: 400 };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "JSON request body must be an object.", status: 400 };
  }

  const body = value as Record<string, unknown>;
  const action = String(body.action || "").trim().toLowerCase();

  if (!action) {
    return { ok: false, error: "Missing voice-pipeline action.", status: 400 };
  }

  return { ok: true, action, value: body };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  try {
    const tokenWorker = hasValidWorkerToken(req);
    const headerOwnerKey = String(req.headers.get("x-otg-owner-key") || "").trim();
    const owner = tokenWorker ? { ownerKey: headerOwnerKey } : await getOwnerContext(req);
    if (!owner.ownerKey) return jsonError("Missing worker owner key.", 400);
    const { jobId } = await ctx.params;
    const effectiveOwnerKey = resolveVoicePipelineJobOwnerKey(jobId, owner.ownerKey);
    const job = getQueuedContractJob(effectiveOwnerKey, jobId);
    if (!job || job.jobType !== "character_voice_pipeline") return jsonError("Job not found.", 404);

    return NextResponse.json({ job }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not load character voice-pipeline job.", 500);
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await ctx.params;
    const storedOwnerKey = findVoicePipelineJobOwnerKey(jobId);
    const owner = storedOwnerKey ? { ownerKey: storedOwnerKey } : await getOwnerContext(req);
    if (!owner.ownerKey) return jsonError("Missing worker owner key.", 400);
    const effectiveOwnerKey = resolveVoicePipelineJobOwnerKey(jobId, owner.ownerKey);

    // Completed datasets are terminal. Return idempotent success before reading the body,
    // because stale UI/browser retries may send an empty, malformed, or already-consumed PATCH body.
    const completedDatasetBeforeBodyRead = getQueuedContractJob(effectiveOwnerKey, jobId);
    if (completedDatasetBeforeBodyRead?.status === "completed") {
      return NextResponse.json({ ok: true, job: completedDatasetBeforeBodyRead }, { headers: withNoStore() });
    }

    const parsed = await readVoicePipelinePatchAction(req);
    if (!parsed.ok) return jsonError(parsed.error, parsed.status);

    const action = parsed.action;
    const body = parsed.value;
    void body;

    // Idempotent completed-dataset short-circuit by stored job owner.

    // This bypasses stale UI/session-owner mismatch after the backend already locked the dataset.

    if (action === "complete_dataset") {

      const completedDatasetOwnerKey = findVoicePipelineJobOwnerKey(jobId);

      if (completedDatasetOwnerKey) {

        const completedDatasetJobByStoredOwner = getQueuedContractJob(completedDatasetOwnerKey, jobId);

        if (completedDatasetJobByStoredOwner?.status === "completed") {

          return NextResponse.json({ ok: true, job: completedDatasetJobByStoredOwner }, { headers: withNoStore() });

        }

      }

    }
    // Treat repeated Complete Dataset clicks as success once the dataset is already locked.
    // This prevents stale/restored UI state from throwing after the backend already completed the job.
    if (action === "complete_dataset") {
      const alreadyCompletedDatasetJob = getQueuedContractJob(effectiveOwnerKey, jobId);
      if (alreadyCompletedDatasetJob?.status === "completed") {
        return NextResponse.json({ ok: true, job: alreadyCompletedDatasetJob }, { headers: withNoStore() });
      }
    }
    let job = null;
    if (action === "stop") {
      job = stopVoicePipelineJob(effectiveOwnerKey, jobId);
    } else if (action === "resume") {
      job = resumeVoicePipelineJob(effectiveOwnerKey, jobId);
    } else if (action === "terminate") {
      const current = getQueuedContractJob(effectiveOwnerKey, jobId);
      const quarantine = current?.characterId ? await quarantineTrainingDataset(effectiveOwnerKey, current.characterId, jobId) : {};
      job = terminateVoicePipelineJob(effectiveOwnerKey, jobId, quarantine);
    } else if (action === "complete_dataset") {
      const current = getQueuedContractJob(effectiveOwnerKey, jobId);
      if (!current?.characterId) return jsonError("Job not found or missing characterId.", 404);
      const ready = await validateReadyTrainingDataset(effectiveOwnerKey, current.characterId, jobId);
      job = finalizeTrainingDatasetJob(effectiveOwnerKey, jobId, {
        mock: false,
        adapter: "dataset_manifest",
        provider: "indextts2",
        generationMode: "real",
        status: "voice_pack_ready",
        clipCount: ready.requestedClipCount,
        requestedClipCount: ready.requestedClipCount,
        generatedClipCount: ready.generatedClipCount,
        manifestPath: ready.manifestPath,
        manifestUrl: ready.manifestUrl,
        datasetManifestPath: ready.manifestPath,
        datasetManifestUrl: ready.manifestUrl,
      });
    }

    if (!job || job.jobType !== "character_voice_pipeline") {
      return jsonError(action ? "Job not found or action is not supported." : "Missing job action.", action ? 404 : 400);
    }

    return NextResponse.json({ job }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not update character voice-pipeline job.", 500);
  }
}
