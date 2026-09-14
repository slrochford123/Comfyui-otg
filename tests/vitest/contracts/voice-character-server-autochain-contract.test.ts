import fs from "node:fs";
import path from "node:path";
import {
  describe,
  expect,
  it,
} from "vitest";

const ROOT = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(
    path.join(ROOT, relativePath),
    "utf8",
  );
}

function blockBetween(
  source: string,
  start: string,
  end: string,
) {
  const startIndex = source.indexOf(start);

  if (startIndex < 0) {
    throw new Error(
      `Missing block start: ${start}`,
    );
  }

  const endIndex =
    source.indexOf(
      end,
      startIndex + start.length,
    );

  if (endIndex < 0) {
    throw new Error(
      `Missing block end: ${end}`,
    );
  }

  return source.slice(
    startIndex,
    endIndex,
  );
}

const jobsSource = read(
  "lib/jobs/voicePipelineJobs.ts",
);

const jobRouteSource = read(
  "app/api/characters/voice-pipeline/[jobId]/route.ts",
);

const workerCompleteRouteSource = read(
  "app/api/characters/voice-pipeline/worker/complete/route.ts",
);

const trainingDatasetSource = read(
  "lib/jobs/trainingDatasetManifest.ts",
);

describe(
  "Voice Characters server-side dataset to Applio auto-chain",
  () => {
    it(
      "deduplicates Applio training by completed source dataset",
      () => {
        const findBlock =
          blockBetween(
            jobsSource,
            "function findExistingApplioTrainingJobForDataset",
            "export function createCharacterVoicePipelineJob",
          );

        expect(findBlock).toMatch(
          /action\s*===\s*"start_applio_training"/,
        );

        expect(findBlock).toMatch(
          /sourceDatasetJobId/,
        );

        expect(findBlock).toMatch(
          /ownerKey/,
        );

        expect(findBlock).toMatch(
          /characterId/,
        );

        const createBlock =
          blockBetween(
            jobsSource,
            "export function createCharacterVoicePipelineJob",
            "export function ensureApplioTrainingJobForCompletedDataset",
          );

        expect(createBlock).toMatch(
          /action\s*===\s*"start_applio_training"/,
        );

        expect(createBlock).toMatch(
          /findExistingApplioTrainingJobForDataset/,
        );

        expect(createBlock).toMatch(
          /return\s*\{\s*ok:\s*true,\s*job:\s*existingTraining/s,
        );
      },
    );

    it(
      "only server-autochains a completed real Voice Characters dataset that is voice-pack ready",
      () => {
        const ensureBlock =
          blockBetween(
            jobsSource,
            "export function ensureApplioTrainingJobForCompletedDataset",
            "export function createProductionAudioStudioJob",
          );

        expect(ensureBlock).toMatch(
          /action\s*!==\s*"generate_training_dataset"/,
        );

        expect(ensureBlock).toMatch(
          /status\s*!==\s*"completed"/,
        );

        expect(ensureBlock).toMatch(
          /voiceCharactersAutoTrain\s*!==\s*true/,
        );

        expect(ensureBlock).toMatch(
          /datasetResult\.mock\s*===\s*true/,
        );

        expect(ensureBlock).toMatch(
          /datasetResult\.generationMode[\s\S]*?toLowerCase\(\)[\s\S]*?!==[\s\S]*?"real"/,
        );

        expect(ensureBlock).toMatch(
          /datasetResult\.status[\s\S]*?toLowerCase\(\)[\s\S]*?!==[\s\S]*?"voice_pack_ready"/,
        );

        expect(ensureBlock).toMatch(
          /manifestPath/,
        );

        expect(ensureBlock).toMatch(
          /action\s*:\s*"start_applio_training"/,
        );

        expect(ensureBlock).toMatch(
          /sourceDatasetJobId\s*:\s*datasetJob\.jobId/,
        );

        expect(ensureBlock).toMatch(
          /requestedBy\s*:\s*"voice_characters_server_autochain"/,
        );
      },
    );

    it(
      "invokes the server auto-chain from both remote completion and dataset finalization",
      () => {
        const completeBlock =
          blockBetween(
            jobsSource,
            "export function completeRemoteWorkerJob",
            "export function checkpointRemoteWorkerJob",
          );

        expect(completeBlock).toMatch(
          /ensureApplioTrainingJobForCompletedDataset\s*\(\s*ownerKey\s*,\s*jobId\s*,?\s*\)/s,
        );

        expect(completeBlock).toMatch(
          /autoChainStatus\s*:\s*"ensured"/,
        );

        expect(completeBlock).toMatch(
          /autoChainJobId/,
        );

        const finalizeBlock =
          blockBetween(
            jobsSource,
            "export function finalizeTrainingDatasetJob",
            "export function terminateVoicePipelineJob",
          );

        expect(finalizeBlock).toMatch(
          /ensureApplioTrainingJobForCompletedDataset\s*\(\s*ownerKey\s*,\s*jobId\s*,?\s*\)/s,
        );

        expect(finalizeBlock).toMatch(
          /autoChainStatus\s*:\s*"ensured"/,
        );

        expect(finalizeBlock).toMatch(
          /autoChainJobId/,
        );
      },
    );

    it(
      "reconciles already-completed datasets in every idempotent PATCH return path",
      () => {
        const occurrences =
          jobRouteSource.match(
            /ensureApplioTrainingJobForCompletedDataset/g,
          ) || [];

        expect(occurrences).toHaveLength(4);

        expect(jobRouteSource).toMatch(
          /completedDatasetBeforeBodyRead\?\.status\s*===\s*"completed"[\s\S]*?ensureApplioTrainingJobForCompletedDataset\s*\(\s*effectiveOwnerKey\s*,\s*jobId/s,
        );

        expect(jobRouteSource).toMatch(
          /completedDatasetJobByStoredOwner\?\.status\s*===\s*"completed"[\s\S]*?ensureApplioTrainingJobForCompletedDataset\s*\(\s*completedDatasetOwnerKey\s*,\s*jobId/s,
        );

        expect(jobRouteSource).toMatch(
          /alreadyCompletedDatasetJob\?\.status\s*===\s*"completed"[\s\S]*?ensureApplioTrainingJobForCompletedDataset\s*\(\s*effectiveOwnerKey\s*,\s*jobId/s,
        );
      },
    );

    it(
      "shares one canonical real ready-dataset validator between manual and worker finalization",
      () => {
        expect(trainingDatasetSource).toMatch(
          /export\s+async\s+function\s+validateReadyTrainingDataset/,
        );

        expect(trainingDatasetSource).toMatch(
          /manifest\.generationMode\s*!==\s*"real"/,
        );

        expect(trainingDatasetSource).toMatch(
          /manifest\.provider\s*!==\s*"indextts2"/,
        );

        expect(trainingDatasetSource).toMatch(
          /manifest\.adaptiveComplete\s*!==\s*true/,
        );

        expect(trainingDatasetSource).toMatch(
          /manifest\.status\s*!==\s*"voice_pack_ready"/,
        );

        expect(trainingDatasetSource).toMatch(
          /policy\.acceptedMinutesMin/,
        );

        expect(trainingDatasetSource).toMatch(
          /policy\.acceptedMinutesMax/,
        );

        expect(jobRouteSource).toMatch(
          /validateReadyTrainingDataset/,
        );

        expect(jobRouteSource).not.toMatch(
          /async\s+function\s+validateReadyTrainingDataset/,
        );

        expect(workerCompleteRouteSource).toMatch(
          /validateReadyTrainingDataset/,
        );
      },
    );

    it(
      "auto-finalizes the specialized Linux dataset worker only for Voice Characters auto-train",
      () => {
        expect(workerCompleteRouteSource).toMatch(
          /completeRemoteTrainingDatasetJob/,
        );

        expect(workerCompleteRouteSource).toMatch(
          /voiceCharactersAutoTrain\s*===\s*true/,
        );

        expect(workerCompleteRouteSource).toMatch(
          /job\.status\s*===\s*"ready_for_review"/,
        );

        expect(workerCompleteRouteSource).toMatch(
          /await\s+validateReadyTrainingDataset/,
        );

        expect(workerCompleteRouteSource).toMatch(
          /finalizeTrainingDatasetJob/,
        );

        expect(workerCompleteRouteSource).toMatch(
          /manifestPath\s*:\s*ready\.manifestPath/,
        );

        expect(workerCompleteRouteSource).toMatch(
          /datasetManifestPath\s*:\s*ready\.manifestPath/,
        );
      },
    );

    it(
      "does not demote an already-completed dataset when the Linux worker retries completion",
      () => {
        const block =
          blockBetween(
            jobsSource,
            "export function completeRemoteTrainingDatasetJob",
            "export function completeRemoteWorkerJob",
          );

        expect(block).toMatch(
          /getQueuedContractJob\s*\(\s*ownerKey\s*,\s*jobId\s*,?\s*\)/s,
        );

        expect(block).toMatch(
          /current\.status\s*===\s*"completed"[\s\S]*?return\s+current/s,
        );

        expect(block).toMatch(
          /status\s*:\s*"ready_for_review"/,
        );
      },
    );
  },
);
