import fs from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { getOwnerContext } from "@/lib/ownerKey";
import { withNoStore, sessionErrorResponse } from "@/lib/http/routeHelpers";
import { getQueuedContractJob } from "@/lib/jobs/voicePipelineJobs";
import {
  resolveTrainingDatasetCanonicalSourcePath,
  resolveTrainingDatasetClipPath,
  resolveTrainingDatasetManifestPath,
  trainingDatasetCanonicalSourceUrl,
  trainingDatasetClipUrl,
  trainingDatasetManifestUrl,
} from "@/lib/jobs/trainingDatasetManifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


function workerOwnerKey(req: NextRequest, fallbackOwnerKey: string): string {
  const headerOwnerKey = String(req.headers.get("x-otg-owner-key") || "").trim();
  return headerOwnerKey || fallbackOwnerKey;
}
function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: withNoStore() });
}

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function isSafeSegment(value: string): boolean {
  const trimmed = cleanString(value);
  if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return false;
  return /^[a-zA-Z0-9._-]+$/.test(trimmed);
}

function isClipId(value: string): boolean {
  return /^clip_\d{3}$/.test(value);
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return !!value && typeof value === "object" && typeof (value as File).arrayBuffer === "function";
}

async function writeFileAtomic(filePath: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, bytes);
  await fs.rename(tempPath, filePath);
}

function parseManifest(value: FormDataEntryValue | null): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function manifestClips(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
}

function uploadedClipEntries(form: FormData): Array<{ clipId: string; file: File }> {
  const entries: Array<{ clipId: string; file: File }> = [];

  for (const [key, value] of form.entries()) {
    if (!isUploadFile(value)) continue;

    const keyValue = cleanString(key);
    const nameValue = cleanString((value as File).name);
    const candidates = [
      keyValue,
      keyValue.replace(/\.wav$/i, ""),
      nameValue.replace(/\.wav$/i, ""),
    ];

    const clipId = candidates.find(isClipId) || "";
    if (!clipId) continue;

    entries.push({ clipId, file: value });
  }

  const deduped = new Map<string, File>();
  for (const entry of entries) deduped.set(entry.clipId, entry.file);

  return Array.from(deduped.entries())
    .map(([clipId, file]) => ({ clipId, file }))
    .sort((a, b) => a.clipId.localeCompare(b.clipId));
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const form = await req.formData();

    const characterId = cleanString(form.get("characterId"));
    const jobId = cleanString(form.get("jobId"));

    if (!isSafeSegment(characterId)) return jsonError("Invalid characterId.", 400);
    if (!isSafeSegment(jobId)) return jsonError("Invalid jobId.", 400);

    const job = getQueuedContractJob(workerOwnerKey(req, owner.ownerKey), jobId);
    if (!job || job.jobType !== "character_voice_pipeline" || job.action !== "generate_training_dataset") {
      return jsonError("Training dataset job not found.", 404);
    }
    if (job.characterId !== characterId) {
      return jsonError("Job characterId does not match upload characterId.", 400);
    }

    const manifestInput = parseManifest(form.get("manifest"));
    const inputClips = manifestClips(manifestInput.clips);
    const clipUploads = uploadedClipEntries(form);

    if (clipUploads.length < 1) {
      return jsonError("No training dataset WAV clips were uploaded.", 400);
    }

    const sourceUpload = form.get("source.wav") || form.get("source");
    let canonicalSourcePath = resolveTrainingDatasetCanonicalSourcePath(workerOwnerKey(req, owner.ownerKey), characterId, jobId);
    let canonicalSourceUrl = trainingDatasetCanonicalSourceUrl(workerOwnerKey(req, owner.ownerKey), characterId, jobId);

    if (isUploadFile(sourceUpload)) {
      const sourceBytes = Buffer.from(await sourceUpload.arrayBuffer());
      if (sourceBytes.length > 0) {
        await writeFileAtomic(canonicalSourcePath, sourceBytes);
      }
    }

    const uploadedClipIds = new Set<string>();
    for (const upload of clipUploads) {
      const bytes = Buffer.from(await upload.file.arrayBuffer());
      if (bytes.length <= 0) {
        return jsonError(`Uploaded clip is empty: ${upload.clipId}`, 400);
      }

      const clipPath = resolveTrainingDatasetClipPath(workerOwnerKey(req, owner.ownerKey), characterId, jobId, upload.clipId);
      await writeFileAtomic(clipPath, bytes);
      uploadedClipIds.add(upload.clipId);
    }

    const alreadyReadyClipIds = new Set(
      inputClips
        .filter((clip) => cleanString(clip.status) === "ready")
        .map((clip) => cleanString(clip.clipId))
        .filter(isClipId),
    );

    async function clipFileExists(clipId: string): Promise<boolean> {
      try {
        const clipPath = resolveTrainingDatasetClipPath(workerOwnerKey(req, owner.ownerKey), characterId, jobId, clipId);
        const stat = await fs.stat(clipPath);
        return stat.isFile() && stat.size > 0;
      } catch {
        return false;
      }
    }

    const now = new Date().toISOString();
    const requestedClipCount = Math.max(
      clipUploads.length,
      Number(manifestInput.requestedClipCount || inputClips.length || clipUploads.length) || clipUploads.length,
    );

    const clips = [];
    for (let index = 0; index < requestedClipCount; index += 1) {
      const clipNumber = index + 1;
      const clipId = `clip_${String(clipNumber).padStart(3, "0")}`;
      const existing = inputClips.find((clip) => cleanString(clip.clipId) === clipId) || {};
      const ready = uploadedClipIds.has(clipId) || alreadyReadyClipIds.has(clipId) || await clipFileExists(clipId);

      const clip = {
        ...existing,
        clipId,
        index,
        text: cleanString(existing.text) || `Training voice sample ${clipNumber}.`,
        status: ready ? "ready" : "pending",
        expectedAudioPath: resolveTrainingDatasetClipPath(workerOwnerKey(req, owner.ownerKey), characterId, jobId, clipId),
        expectedAudioUrl: trainingDatasetClipUrl(workerOwnerKey(req, owner.ownerKey), characterId, jobId, clipId),
        sourceSamplePath: canonicalSourcePath,
        sourceSampleUrl: canonicalSourceUrl,
        generatorProvider: ready ? "indextts2" : existing.generatorProvider,
        updatedAt: now,
      };
      clips.push(clip);
    }

    const generatedClipCount = clips.filter((clip) => clip.status === "ready").length;
    const complete = generatedClipCount === requestedClipCount;

    const finalManifest = {
      ...manifestInput,
      schemaVersion: 1,
      ownerKey: workerOwnerKey(req, owner.ownerKey),
      characterId,
      jobId,
      createdAt: cleanString(manifestInput.createdAt) || now,
      source: {
        ...(manifestInput.source && typeof manifestInput.source === "object" && !Array.isArray(manifestInput.source)
          ? manifestInput.source as Record<string, unknown>
          : {}),
        approvedSampleUrl: cleanString(job.input.approvedSampleUrl),
        approvedSamplePath: canonicalSourcePath,
        canonicalSourcePath,
        canonicalSourceUrl,
        sampleRate: Number((manifestInput.source as any)?.sampleRate || 24000),
        channels: 1,
      },
      logs: {
        ...(manifestInput.logs && typeof manifestInput.logs === "object" && !Array.isArray(manifestInput.logs)
          ? manifestInput.logs as Record<string, unknown>
          : {}),
      },
      generationMode: "real",
      provider: "indextts2",
      startedAt: cleanString(manifestInput.startedAt) || now,
      completedAt: complete ? now : null,
      requestedClipCount,
      generatedClipCount,
      clips,
      status: complete ? "voice_pack_ready" : "manifest_ready",
      mock: false,
      note: complete
        ? "Real voice-pack utterance generation completed on the remote Windows RTX 3090 IndexTTS2 worker."
        : "Remote Windows IndexTTS2 worker uploaded a partial training dataset.",
    };

    const manifestPath = resolveTrainingDatasetManifestPath(workerOwnerKey(req, owner.ownerKey), characterId, jobId);
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFileAtomic(manifestPath, Buffer.from(JSON.stringify(finalManifest, null, 2), "utf8"));

    const result = {
      mock: false,
      adapter: "dataset_manifest",
      provider: "indextts2",
      remoteWorker: true,
      manifestPath,
      manifestUrl: trainingDatasetManifestUrl(workerOwnerKey(req, owner.ownerKey), characterId, jobId),
      clipCount: requestedClipCount,
      generatedClipCount,
      canonicalSourcePath,
      canonicalSourceUrl,
      generationMode: "real",
      status: complete ? "voice_pack_ready" : "manifest_ready",
    };

    return NextResponse.json(
      {
        ok: true,
        result,
        manifest: finalManifest,
      },
      { headers: withNoStore() },
    );
  } catch (error) {
    return sessionErrorResponse(error) || jsonError(
      error instanceof Error ? error.message : "Could not upload remote training dataset batch.",
      500,
    );
  }
}