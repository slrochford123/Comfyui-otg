import { NextRequest, NextResponse } from "next/server";

import { readJsonBody, sessionErrorResponse, withNoStore } from "@/lib/http/routeHelpers";
import { getOwnerContext } from "@/lib/ownerKey";
import { getQueuedContractJob, completeRemoteWorkerJob } from "@/lib/jobs/voicePipelineJobs";
import { hasValidWorkerToken } from "@/lib/jobs/workerAuth";
import { buildApplioTrainingArtifactVoiceProfile } from "@/lib/characterVoiceAudioStudio";
import { loadCharacter, updateCharacterVoiceProfile } from "@/lib/characters/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status, headers: withNoStore() });
}

function workerOwnerKey(req: NextRequest, fallbackOwnerKey: string): string {
  const headerOwnerKey = String(req.headers.get("x-otg-owner-key") || "").trim();
  return headerOwnerKey || fallbackOwnerKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function persistRemoteApplioTrainingProfile(ownerKey: string, jobId: string, result: unknown): boolean {
  const current = getQueuedContractJob(ownerKey, jobId);
  if (!current || current.jobType !== "character_voice_pipeline" || current.action !== "start_applio_training") return false;
  if (!isRecord(result) || result.adapter !== "applio_real_training" || result.mock !== false || result.status !== "trained") return false;

  const characterId = String(current.characterId || current.input?.characterId || "").trim();
  if (!characterId) return false;
  const existing = loadCharacter(ownerKey, characterId);
  const profile = buildApplioTrainingArtifactVoiceProfile({
    characterId,
    jobId,
    result,
    jobInput: current.input,
    currentProfile: existing?.characterVoiceProfile || null,
  });
  if (!profile) return false;
  return Boolean(updateCharacterVoiceProfile(ownerKey, characterId, profile));
}

async function resolveWorkerOwnerKey(req: NextRequest): Promise<string> {
  if (hasValidWorkerToken(req)) {
    const headerOwnerKey = String(req.headers.get("x-otg-owner-key") || "").trim();
    if (!headerOwnerKey) throw new Error("Missing x-otg-owner-key for worker completion.");
    return headerOwnerKey;
  }
  const owner = await getOwnerContext(req);
  return workerOwnerKey(req, owner.ownerKey);
}

export async function POST(req: NextRequest) {
  try {
    const ownerKey = await resolveWorkerOwnerKey(req);
    const body = await readJsonBody<Record<string, unknown>>(req.clone());
    if (!body.ok) return jsonError(body.error, body.status);

    const jobId = String(body.value.jobId || "").trim();
    if (!jobId) return jsonError("Missing jobId.", 400);

    const result = body.value.result && typeof body.value.result === "object" ? body.value.result : {};
    const message = String(body.value.message || "Remote Windows worker completed.").trim();
    const profilePersisted = persistRemoteApplioTrainingProfile(ownerKey, jobId, result);
    const job = completeRemoteWorkerJob(ownerKey, jobId, result, message);

    if (!job) return jsonError("Job not found.", 404);
    return NextResponse.json({ ok: true, job, profilePersisted }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not complete worker job.", 500);
  }
}
