import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  readJsonBody,
  sessionErrorResponse,
  withNoStore,
} from "@/lib/http/routeHelpers";

import {
  completeRemoteTrainingDatasetJob,
  finalizeTrainingDatasetJob,
} from "@/lib/jobs/voicePipelineJobs";

import {
  validateReadyTrainingDataset,
} from "@/lib/jobs/trainingDatasetManifest";

import {
  hasValidWorkerToken,
} from "@/lib/jobs/workerAuth";

import {
  getOwnerContext,
} from "@/lib/ownerKey";

export const runtime = "nodejs";
export const dynamic =
  "force-dynamic";

function workerOwnerKey(
  req: NextRequest,
  fallbackOwnerKey: string,
): string {
  const headerOwnerKey =
    String(
      req.headers.get(
        "x-otg-owner-key",
      ) || "",
    ).trim();

  return (
    headerOwnerKey ||
    fallbackOwnerKey
  );
}

function jsonError(
  error: string,
  status = 400,
) {
  return NextResponse.json(
    {
      ok: false,
      error,
    },
    {
      status,
      headers: withNoStore(),
    },
  );
}

export async function POST(
  req: NextRequest,
) {
  try {
    const tokenWorker =
      hasValidWorkerToken(req);

    const owner =
      tokenWorker
        ? {
            ownerKey:
              workerOwnerKey(
                req,
                "",
              ),
          }
        : await getOwnerContext(
            req,
          );

    if (!owner.ownerKey) {
      return jsonError(
        "Missing worker owner key.",
        400,
      );
    }

    const body =
      await readJsonBody<
        Record<string, unknown>
      >(req.clone());

    if (!body.ok) {
      return jsonError(
        body.error,
        body.status,
      );
    }

    const jobId =
      String(
        body.value.jobId || "",
      ).trim();

    if (!jobId) {
      return jsonError(
        "Missing jobId.",
        400,
      );
    }

    const result =
      body.value.result &&
      typeof body.value.result ===
        "object" &&
      !Array.isArray(
        body.value.result,
      )
        ? body.value.result
        : {};

    const message =
      String(
        body.value.message || "",
      ).trim();

    const effectiveOwnerKey =
      workerOwnerKey(
        req,
        owner.ownerKey,
      );

    let job =
      completeRemoteTrainingDatasetJob(
        effectiveOwnerKey,
        jobId,
        result,
        message,
      );

    if (!job) {
      return jsonError(
        "Job not found.",
        404,
      );
    }

    const autoTrain =
      job.jobType ===
        "character_voice_pipeline" &&
      job.action ===
        "generate_training_dataset" &&
      job.input
        ?.voiceCharactersAutoTrain ===
        true;

    if (
      autoTrain &&
      job.status ===
        "ready_for_review"
    ) {
      const characterId =
        String(
          job.characterId || "",
        ).trim();

      if (!characterId) {
        return jsonError(
          "Training dataset is missing characterId.",
          500,
        );
      }

      const ready =
        await validateReadyTrainingDataset(
          effectiveOwnerKey,
          characterId,
          jobId,
        );

      const finalized =
        finalizeTrainingDatasetJob(
          effectiveOwnerKey,
          jobId,
          {
            mock: false,
            adapter:
              "dataset_manifest",
            provider:
              "indextts2",
            generationMode:
              "real",
            status:
              "voice_pack_ready",
            clipCount:
              ready.requestedClipCount,
            requestedClipCount:
              ready.requestedClipCount,
            generatedClipCount:
              ready.generatedClipCount,
            acceptedDurationSeconds:
              ready.acceptedDurationSeconds,
            acceptedMinutes:
              ready.acceptedMinutes,
            adaptiveComplete:
              ready.adaptiveComplete,
            qualityControl:
              ready.manifest
                .qualityControl,
            manifestPath:
              ready.manifestPath,
            manifestUrl:
              ready.manifestUrl,
            datasetManifestPath:
              ready.manifestPath,
            datasetManifestUrl:
              ready.manifestUrl,
          },
        );

      if (!finalized) {
        return jsonError(
          "Could not finalize automatic Voice Character training dataset.",
          500,
        );
      }

      job = finalized;
    }

    return NextResponse.json(
      {
        ok: true,
        job,
      },
      {
        headers: withNoStore(),
      },
    );
  } catch (error) {
    return (
      sessionErrorResponse(
        error,
      ) ||
      jsonError(
        "Could not complete remote training dataset job.",
        500,
      )
    );
  }
}
