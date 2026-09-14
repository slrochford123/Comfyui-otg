import { NextRequest, NextResponse } from "next/server";
import * as fsForTestVoice from "node:fs";
import * as pathForTestVoice from "node:path";


import { getOwnerContext } from "@/lib/ownerKey";
import {
  OTG_DATA_ROOT,
  safeSegment as safeSegmentForTestVoice,
} from "@/lib/paths";
import {
  recoverLatestTrainedApplioVoiceProfile as recoverLatestTrainedApplioVoiceProfileForTestVoice,
} from "@/lib/jobs/applioArtifactRecovery";
import {
  findUsableTrainedVoiceArtifact as findUsableTrainedVoiceArtifactForTestVoice,
} from "@/lib/characterVoiceAudioStudio";
import { withNoStore, readJsonBody, sessionErrorResponse } from "@/lib/http/routeHelpers";
import { createCharacterVoicePipelineJob, listVoicePipelineJobs } from "@/lib/jobs/voicePipelineJobs";
import {
  ensureQwen3VoiceSampleLifecycle,
  shouldBlockVoiceLifecycle,
} from "@/lib/workers/voiceLifecycleHooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status = 400, detail?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error,
      ...(process.env.NODE_ENV !== "production" && detail ? { detail } : {}),
    },
    { status, headers: withNoStore() },
  );
}

function devErrorDetail(error: unknown) {
  if (process.env.NODE_ENV === "production") return undefined;
  const err = error as { name?: unknown; message?: unknown; stack?: unknown };
  return {
    name: String(err?.name || "Error"),
    message: String(err?.message || error || "Unknown error"),
    stack: typeof err?.stack === "string" ? err.stack.split("\n").slice(0, 8).join("\n") : null,
  };
}

function lifecycleError(lifecycle: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: "Required Qwen3 voice workers were not confirmed ready.",
      lifecycle,
    },
    { status: 503, headers: withNoStore() },
  );
}


// OTG_TEST_VOICE_OWNER_SCOPE_V2
type OwnerScopedTestVoiceRequestResult =
  | {
      ok: true;
      value: Record<string, unknown>;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

function testVoiceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function testVoiceString(value: unknown): string {
  return String(value || "").trim();
}

function testVoiceFileHasBytes(filePath: string): boolean {
  try {
    const stat = fsForTestVoice.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function resolveOwnedTestVoiceArtifactPath(
  ownerKey: string,
  characterId: string,
  artifactPath: unknown,
): string {
  const requestedPath = testVoiceString(artifactPath);

  if (!requestedPath) {
    throw new Error(
      "Trained voice artifact does not belong to the current owner/character.",
    );
  }

  const ownerCharacterRoot = pathForTestVoice.join(
    OTG_DATA_ROOT,
    "characters",
    safeSegmentForTestVoice(ownerKey),
    "applio-models",
    safeSegmentForTestVoice(characterId),
  );

  let canonicalRoot: string;
  let resolvedArtifactPath: string;

  try {
    canonicalRoot = fsForTestVoice.realpathSync(ownerCharacterRoot);
    resolvedArtifactPath = fsForTestVoice.realpathSync(requestedPath);
  } catch {
    throw new Error(
      "Trained voice artifact does not belong to the current owner/character.",
    );
  }

  const relativeArtifactPath =
    pathForTestVoice.relative(
      canonicalRoot,
      resolvedArtifactPath,
    );

  if (
    !relativeArtifactPath ||
    relativeArtifactPath === ".." ||
    relativeArtifactPath.startsWith(`..${pathForTestVoice.sep}`) ||
    pathForTestVoice.isAbsolute(relativeArtifactPath) ||
    !testVoiceFileHasBytes(resolvedArtifactPath)
  ) {
    throw new Error(
      "Trained voice artifact does not belong to the current owner/character.",
    );
  }

  return resolvedArtifactPath;
}

function firstReadableTestVoiceReferencePath(
  values: unknown[],
): string {
  for (const value of values) {
    const candidate = testVoiceString(value);
    if (candidate && testVoiceFileHasBytes(candidate)) {
      return candidate;
    }
  }
  return "";
}

function firstTestVoiceString(values: unknown[]): string {
  for (const value of values) {
    const candidate = testVoiceString(value);
    if (candidate) return candidate;
  }
  return "";
}

function resolveOwnerScopedTestVoiceRequest(
  ownerKey: string,
  rawInput: Record<string, unknown>,
): OwnerScopedTestVoiceRequestResult {
  const action = testVoiceString(rawInput.action);

  if (action !== "test_trained_voice") {
    return {
      ok: true,
      value: rawInput,
    };
  }

  const characterId = testVoiceString(rawInput.characterId);
  const speechText = firstTestVoiceString([
    rawInput.text,
    rawInput.testText,
    rawInput.voiceTestText,
    rawInput.previewText,
  ]);

  if (!characterId) {
    return {
      ok: false,
      status: 400,
      error: "Test Trained Voice requires characterId.",
    };
  }

  if (!speechText) {
    return {
      ok: false,
      status: 400,
      error: "Typed Test Voice requires non-empty text.",
    };
  }

  const recovered =
    recoverLatestTrainedApplioVoiceProfileForTestVoice({
      ownerKey,
      characterId,
    });

  if (!recovered) {
    return {
      ok: false,
      status: 404,
      error:
        "No real trained Applio voice exists for this owner and character.",
    };
  }

  const artifact =
    findUsableTrainedVoiceArtifactForTestVoice(
      recovered.profile,
    );

  if (
    !artifact ||
    artifact.mock !== false ||
    artifact.adapter !== "applio_real_training"
  ) {
    return {
      ok: false,
      status: 409,
      error:
        "No usable real trained Applio artifact exists for this owner and character.",
    };
  }

  let modelPath: string;
  let indexPath: string;

  try {
    modelPath =
      resolveOwnedTestVoiceArtifactPath(
        ownerKey,
        characterId,
        artifact.modelPath,
      );

    indexPath =
      resolveOwnedTestVoiceArtifactPath(
        ownerKey,
        characterId,
        artifact.indexPath,
      );
  } catch (error) {
    return {
      ok: false,
      status: 403,
      error:
        error instanceof Error
          ? error.message
          : "Trained voice artifact does not belong to the current owner/character.",
    };
  }

  const profile =
    recovered.profile as unknown as Record<string, unknown>;

  const sourceReference =
    testVoiceRecord(profile.sourceReference);

  /*
   * Prefer the exact original/tuned reference that anchored training.
   * Fall back to the persisted approved/base sample only when needed.
   */
  const referenceAudioPath =
    firstReadableTestVoiceReferencePath([
      sourceReference.originalReferencePath,
      sourceReference.referenceAudioPath,
      sourceReference.referencePath,
      sourceReference.sourcePath,
      profile.originalReferencePath,
      profile.tunedSamplePath,
      profile.approvedSamplePath,
      profile.baseSamplePath,
    ]);

  if (!referenceAudioPath) {
    return {
      ok: false,
      status: 409,
      error:
        "No readable server-resolved reference audio exists for typed Test Voice.",
    };
  }

  const referenceAudioUrl =
    firstTestVoiceString([
      sourceReference.originalReferenceUrl,
      sourceReference.referenceAudioUrl,
      sourceReference.referenceUrl,
      sourceReference.sourceUrl,
      profile.originalReferenceUrl,
      profile.tunedSampleUrl,
      profile.approvedSampleUrl,
      profile.baseSampleUrl,
    ]);

  /*
   * Do not trust absolute artifact/audio paths supplied by the browser.
   * Strip all filesystem trust points and replace them with values
   * recovered from the authenticated owner's durable server state.
   */
  const sanitizedRequest: Record<string, unknown> = {
    ...rawInput,
  };

  for (const key of [
    "ownerKey",
    "trainedModelPath",
    "trainedIndexPath",
    "modelPath",
    "indexPath",
    "inputAudioPath",
    "inputAudioUrl",
    "trainedArtifactMock",
    "artifactMock",
    "trainingMock",
    "trainedAdapter",
    "trainingAdapter",
  ]) {
    delete sanitizedRequest[key];
  }

  return {
    ok: true,
    value: {
      ...sanitizedRequest,
      action: "test_trained_voice",
      characterId,
      text: speechText,
      trainedArtifactId: artifact.id,
      voiceModelArtifactId: artifact.id,
      trainedArtifactMock: false,
      trainedAdapter: "applio_real_training",
      trainedModelPath: modelPath,
      trainedIndexPath: indexPath,
      inputAudioPath: referenceAudioPath,
      inputAudioUrl: referenceAudioUrl,
      serverResolvedTrainedVoice: true,
      serverResolvedOwnerKey: ownerKey,
      trainedVoiceRecoverySource: recovered.source,
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody<Record<string, unknown>>(req.clone());
    if (!body.ok) return jsonError(body.error, body.status);

    const owner = await getOwnerContext(req);

    const ownerScopedRequest =
      resolveOwnerScopedTestVoiceRequest(
        owner.ownerKey,
        body.value,
      );

    if (!ownerScopedRequest.ok) {
      return jsonError(
        ownerScopedRequest.error,
        ownerScopedRequest.status,
      );
    }

    const requestValue = ownerScopedRequest.value;

    const lifecycle = await ensureQwen3VoiceSampleLifecycle(requestValue);
    if (shouldBlockVoiceLifecycle(lifecycle)) return lifecycleError(lifecycle);

    const result = createCharacterVoicePipelineJob(owner.ownerKey, requestValue);
    if (!result.ok) return jsonError(result.error, result.status);

    return NextResponse.json(
      {
        job: result.job,
        ...(lifecycle.enabled ? { lifecycle } : {}),
      },
      { headers: withNoStore() },
    );
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not queue character voice-pipeline job.", 500, devErrorDetail(error));
  }
}

export async function GET(req: NextRequest) {
  try {
    const owner = await getOwnerContext(req);
    const action = String(req.nextUrl.searchParams.get("action") || "").trim();
    const characterId = String(req.nextUrl.searchParams.get("characterId") || "").trim();
    const status = String(req.nextUrl.searchParams.get("status") || "").trim();
    const jobs = listVoicePipelineJobs(owner.ownerKey)
      .filter((job) => !action || job.action === action)
      .filter((job) => !characterId || job.characterId === characterId)
      .filter((job) => !status || job.status === status);

    return NextResponse.json({ jobs }, { headers: withNoStore() });
  } catch (error) {
    return sessionErrorResponse(error) || jsonError("Could not list character voice-pipeline jobs.", 500, devErrorDetail(error));
  }
}
