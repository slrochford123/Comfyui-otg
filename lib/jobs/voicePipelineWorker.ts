import type {
  CharacterVoicePipelineAction,
  ProductionAudioStudioAction,
  QueuedContractJob,
} from "@/lib/jobs/voicePipelineJobs";
import {
  getQueuedContractJob,
  listVoicePipelineJobs,
  updateVoicePipelineJob,
} from "@/lib/jobs/voicePipelineJobs";
import {
  generateQwen3VoiceSample,
  isQwen3VoiceSampleJob,
  isRealQwen3VoiceSampleEnabled,
  resolveQwen3VoiceSamplePlan,
} from "@/lib/jobs/adapters/qwen3VoiceSampleAdapter";
import {
  generateCosyVoiceSample,
  isCosyVoiceSampleJob,
  isRealCosyVoiceSampleEnabled,
  resolveCosyVoiceSamplePlan,
} from "@/lib/jobs/adapters/cosyVoiceSampleAdapter";
import {
  applyVoiceFx,
  isRealVoiceFxEnabled,
  isVoiceFxJob,
  resolveVoiceFxPlan,
} from "@/lib/jobs/adapters/voiceFxAdapter";
import { createApplioTrainingArtifact, type ApplioTrainingProgressSnapshot } from "@/lib/jobs/applioTrainingArtifact";
import { isApplioTrainedVoiceTestJob, resolveApplioInferencePlan, runApplioTrainedVoiceInference } from "@/lib/jobs/applioInferenceAdapter";
import { createTrainingDatasetManifest } from "@/lib/jobs/trainingDatasetManifest";

export type VoicePipelineWorkerTickOptions = {
  limit?: number;
  jobId?: string;
};

export type VoicePipelineWorkerTickResult = {
  processed: number;
  jobs: QueuedContractJob[];
};

const CHARACTER_RESULTS: Record<CharacterVoicePipelineAction, (jobId: string) => Record<string, unknown>> = {
  create_voice_sample: () => ({ mock: true }),
  apply_voice_fx: (jobId) => ({ fxSampleUrl: `/mock-assets/voices/${jobId}/fx.wav` }),
  generate_training_dataset: (jobId) => ({ datasetId: `dataset_${jobId}`, clipCount: 200 }),
  start_applio_training: (jobId) => ({
    modelArtifactId: `voice_model_${jobId}`,
    modelPath: `/mock-artifacts/models/${jobId}.pth`,
    indexPath: `/mock-artifacts/models/${jobId}.index`,
  }),
  test_character_voice: (jobId) => ({ previewAudioUrl: `/mock-assets/voices/${jobId}/test.wav` }),
  test_trained_voice: () => ({ completed: false }),
  generate_preview_video: (jobId) => ({ previewVideoUrl: `/mock-assets/videos/${jobId}/preview.mp4` }),
  dub_preview_video: (jobId) => ({ dubbedPreviewVideoUrl: `/mock-assets/videos/${jobId}/dubbed-preview.mp4` }),
  save_voice_to_character: () => ({ saved: true }),
};

const PRODUCTION_RESULTS: Record<ProductionAudioStudioAction, (jobId: string) => Record<string, unknown>> = {
  dub_existing_voice: (jobId) => ({ dubbedClipUrl: `/mock-assets/clips/${jobId}/dubbed.mp4` }),
  add_voice_to_clip: (jobId) => ({ updatedClipUrl: `/mock-assets/clips/${jobId}/voice-added.mp4` }),
  add_background_music: (jobId) => ({ updatedClipUrl: `/mock-assets/clips/${jobId}/music-added.mp4` }),
  add_sound_effect: (jobId) => ({ updatedClipUrl: `/mock-assets/clips/${jobId}/sfx-added.mp4` }),
  replace_voice: (jobId) => ({ updatedClipUrl: `/mock-assets/clips/${jobId}/voice-replaced.mp4` }),
  render_audio_mix: (jobId) => ({ finalClipUrl: `/mock-assets/clips/${jobId}/final-audio-mix.mp4` }),
};

function clampLimit(value: unknown): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 1;
  return Math.max(1, Math.min(25, Math.floor(numberValue)));
}

function fakeResultForJob(job: QueuedContractJob): Record<string, unknown> {
  if (job.jobType === "character_voice_pipeline") {
    const buildResult = CHARACTER_RESULTS[job.action as CharacterVoicePipelineAction];
    return buildResult ? buildResult(job.jobId) : { completed: true };
  }

  const buildResult = PRODUCTION_RESULTS[job.action as ProductionAudioStudioAction];
  return buildResult ? buildResult(job.jobId) : { completed: true };
}

async function completeJobWithRealAdapter(ownerKey: string, job: QueuedContractJob): Promise<QueuedContractJob | null> {
  if (isQwen3VoiceSampleJob(job) && isRealQwen3VoiceSampleEnabled()) {
    try {
      const plan = resolveQwen3VoiceSamplePlan(ownerKey, job);
      updateVoicePipelineJob(ownerKey, job.jobId, {
        status: "running",
        progress: 80,
        message: `Qwen3 process start. Output: ${plan.outputDir}; params: ${plan.paramsPath}; logs: ${plan.logsPath}`,
        error: null,
      });
      const result = await generateQwen3VoiceSample(ownerKey, job, {
        onEvent: (event) => {
          updateVoicePipelineJob(ownerKey, job.jobId, {
            status: "running",
            progress: event.phase === "process_exit" ? 95 : 85,
            message: event.message,
            error: null,
          });
        },
      });
      return updateVoicePipelineJob(ownerKey, job.jobId, {
        status: "completed",
        progress: 100,
        message: `Qwen3 voice sample generated. samplePath: ${result.samplePath}; stdout: ${result.stdoutPath}; stderr: ${result.stderrPath}`,
        result,
        error: null,
      });
    } catch (error) {
      const plan = resolveQwen3VoiceSamplePlan(ownerKey, job);
      const errorMessage = error instanceof Error ? error.message : "Qwen3 voice sample generation failed.";
      return updateVoicePipelineJob(ownerKey, job.jobId, {
        status: "failed",
        progress: 100,
        message: `Qwen3 voice sample generation failed. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`,
        error: errorMessage,
      });
    }
  }

  if (isCosyVoiceSampleJob(job) && isRealCosyVoiceSampleEnabled()) {
    try {
      const plan = resolveCosyVoiceSamplePlan(ownerKey, job);
      updateVoicePipelineJob(ownerKey, job.jobId, {
        status: "running",
        progress: 80,
        message: `Cosy process start. Output: ${plan.outputDir}; params: ${plan.paramsPath}; logs: ${plan.logsPath}`,
        error: null,
      });
      const result = await generateCosyVoiceSample(ownerKey, job, {
        onEvent: (event) => {
          updateVoicePipelineJob(ownerKey, job.jobId, {
            status: "running",
            progress: event.phase === "process_exit" ? 95 : 85,
            message: event.message,
            error: null,
          });
        },
      });
      return updateVoicePipelineJob(ownerKey, job.jobId, {
        status: "completed",
        progress: 100,
        message: `Cosy voice sample generated. samplePath: ${result.samplePath}; stdout: ${result.stdoutPath}; stderr: ${result.stderrPath}`,
        result,
        error: null,
      });
    } catch (error) {
      const plan = resolveCosyVoiceSamplePlan(ownerKey, job);
      const errorMessage = error instanceof Error ? error.message : "Cosy voice sample generation failed.";
      return updateVoicePipelineJob(ownerKey, job.jobId, {
        status: "failed",
        progress: 100,
        message: `Cosy voice sample generation failed. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`,
        error: errorMessage,
      });
    }
  }

  if (isVoiceFxJob(job) && isRealVoiceFxEnabled()) {
    try {
      updateVoicePipelineJob(ownerKey, job.jobId, {
        status: "running",
        progress: 80,
        message: "Voice FX ffmpeg process starting.",
        error: null,
      });
      const result = await applyVoiceFx(ownerKey, job, {
        onEvent: (event) => {
          updateVoicePipelineJob(ownerKey, job.jobId, {
            status: "running",
            progress: event.phase === "process_exit" ? 95 : 85,
            message: event.message,
            error: null,
          });
        },
      });
      return updateVoicePipelineJob(ownerKey, job.jobId, {
        status: "completed",
        progress: 100,
        message: `Voice FX processed. processedSamplePath: ${result.processedSamplePath}; stdout: ${result.stdoutPath}; stderr: ${result.stderrPath}`,
        result,
        error: null,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Voice FX processing failed.";
      return updateVoicePipelineJob(ownerKey, job.jobId, {
        status: "failed",
        progress: 100,
        message: "Voice FX processing failed.",
        error: errorMessage,
      });
    }
  }

  return null;
}

function isTrainingDatasetJob(job: QueuedContractJob): boolean {
  return job.jobType === "character_voice_pipeline" && job.action === "generate_training_dataset";
}

function isApplioTrainingJob(job: QueuedContractJob): boolean {
  return job.jobType === "character_voice_pipeline" && job.action === "start_applio_training";
}

async function nextWorkerUpdate(ownerKey: string, job: QueuedContractJob): Promise<QueuedContractJob | Parameters<typeof updateVoicePipelineJob>[2] | null> {
  if (isTrainingDatasetJob(job)) {
    // Dataset generation is GPU-heavy and must be claimed by the remote Windows RTX 3090 worker.
    // Do not execute createTrainingDatasetManifest locally on the Linux control server.
    // Remote Windows IndexTTS2 worker must claim this job through /api/characters/voice-pipeline/worker/claim.
    return null;
  }
    // Real Voice FX is a synchronous ffmpeg adapter; run it to terminal status in one worker tick.
  if ((job.status === "queued" || job.status === "running") && isVoiceFxJob(job) && isRealVoiceFxEnabled()) {
    return completeJobWithRealAdapter(ownerKey, job);
  }
if (job.status === "queued") {
    if (isQwen3VoiceSampleJob(job) && isRealQwen3VoiceSampleEnabled()) {
      const plan = resolveQwen3VoiceSamplePlan(ownerKey, job);
      return {
        status: "running" as const,
        progress: 5,
        message: `Qwen3 real adapter selected. root: ${plan.root}; python: ${plan.python}; bridge: ${plan.bridge}`,
        error: null,
      };
    }
    if (isCosyVoiceSampleJob(job) && isRealCosyVoiceSampleEnabled()) {
      const plan = resolveCosyVoiceSamplePlan(ownerKey, job);
      return {
        status: "running" as const,
        progress: 5,
        message: `Cosy real adapter selected. root: ${plan.root || "(unset)"}; python: ${plan.python || "(unset)"}; bridge: ${plan.bridge || "(unset)"}`,
        error: null,
      };
    }
    if (isVoiceFxJob(job) && isRealVoiceFxEnabled()) {
      return {
        status: "running" as const,
        progress: 5,
        message: "Voice FX real adapter selected.",
        error: null,
      };
    }
    if (isApplioTrainedVoiceTestJob(job)) {
      try {
        const plan = resolveApplioInferencePlan(ownerKey, job);
        return {
          status: "running" as const,
          progress: 5,
          message: `Applio trained voice inference selected. model: ${plan.trainedModelPath}; index: ${plan.trainedIndexPath}`,
          error: null,
        };
      } catch (error) {
        return {
          status: "failed" as const,
          progress: 100,
          message: "Trained Applio voice inference failed validation.",
          error: error instanceof Error ? error.message : "Trained Applio voice inference failed validation.",
        };
      }
    }
    return {
      status: "running" as const,
      progress: 5,
      message: "Worker started",
      error: null,
    };
  }

  if (job.status !== "running") return null;

  const progress = Number(job.progress || 0);
  if (progress < 35) {
    if (isQwen3VoiceSampleJob(job) && isRealQwen3VoiceSampleEnabled()) {
      const plan = resolveQwen3VoiceSamplePlan(ownerKey, job);
      return {
        status: "running" as const,
        progress: 35,
        message: `Qwen3 output prepared. outputDir: ${plan.outputDir}; params: ${plan.paramsPath}; logs: ${plan.logsPath}`,
        error: null,
      };
    }
    if (isCosyVoiceSampleJob(job) && isRealCosyVoiceSampleEnabled()) {
      const plan = resolveCosyVoiceSamplePlan(ownerKey, job);
      return {
        status: "running" as const,
        progress: 35,
        message: `Cosy output prepared. outputDir: ${plan.outputDir}; params: ${plan.paramsPath}; logs: ${plan.logsPath}`,
        error: null,
      };
    }
    if (isVoiceFxJob(job) && isRealVoiceFxEnabled()) {
      return {
        status: "running" as const,
        progress: 35,
        message: "Voice FX output prepared.",
        error: null,
      };
    }
    if (isApplioTrainedVoiceTestJob(job)) {
      try {
        const plan = resolveApplioInferencePlan(ownerKey, job);
        return {
          status: "running" as const,
          progress: 35,
          message: `Applio inference output prepared. output: ${plan.outputAudioPath}; logs: ${plan.logsPath}`,
          error: null,
        };
      } catch (error) {
        return {
          status: "failed" as const,
          progress: 100,
          message: "Trained Applio voice inference failed validation.",
          error: error instanceof Error ? error.message : "Trained Applio voice inference failed validation.",
        };
      }
    }
    return {
      status: "running" as const,
      progress: 35,
      message: "No-op worker prepared deterministic mock result",
      error: null,
    };
  }
  if (progress < 70) {
    if (isQwen3VoiceSampleJob(job) && isRealQwen3VoiceSampleEnabled()) {
      const plan = resolveQwen3VoiceSamplePlan(ownerKey, job);
      return {
        status: "running" as const,
        progress: 70,
        message: `Qwen3 ready to execute bridge. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}; sample: ${plan.samplePath}`,
        error: null,
      };
    }
    if (isCosyVoiceSampleJob(job) && isRealCosyVoiceSampleEnabled()) {
      const plan = resolveCosyVoiceSamplePlan(ownerKey, job);
      return {
        status: "running" as const,
        progress: 70,
        message: `Cosy ready to execute bridge. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}; sample: ${plan.samplePath}`,
        error: null,
      };
    }
    if (isVoiceFxJob(job) && isRealVoiceFxEnabled()) {
      try {
        const plan = await resolveVoiceFxPlan(ownerKey, job);
        return {
          status: "running" as const,
          progress: 70,
          message: `Voice FX ready to execute ffmpeg. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}; output: ${plan.processedSamplePath}`,
          error: null,
        };
      } catch {
        return {
          status: "running" as const,
          progress: 70,
          message: "Voice FX ready to validate source sample and execute ffmpeg.",
          error: null,
        };
      }
    }
    if (isApplioTrainedVoiceTestJob(job)) {
      try {
        const plan = resolveApplioInferencePlan(ownerKey, job);
        return {
          status: "running" as const,
          progress: 70,
          message: `Applio ready to execute inference. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}; output: ${plan.outputAudioPath}`,
          error: null,
        };
      } catch (error) {
        return {
          status: "failed" as const,
          progress: 100,
          message: "Trained Applio voice inference failed validation.",
          error: error instanceof Error ? error.message : "Trained Applio voice inference failed validation.",
        };
      }
    }
    return {
      status: "running" as const,
      progress: 70,
      message: "No-op worker validating mock artifact contract",
      error: null,
    };
  }

  const realAdapterResult = await completeJobWithRealAdapter(ownerKey, job);
  if (realAdapterResult) return realAdapterResult;

  if (isTrainingDatasetJob(job)) {
    try {
      const result = await createTrainingDatasetManifest(ownerKey, job, {
        onProgress: (event) => {
          const percent = Math.max(
            70,
            Math.min(99, Math.round((event.generatedClipCount / Math.max(1, event.requestedClipCount)) * 100)),
          );
          updateVoicePipelineJob(ownerKey, job.jobId, {
            status: "running",
            progress: percent,
            message: `${event.message} ${event.generatedClipCount}/${event.requestedClipCount}`,
            error: null,
          });
        },
      });
      if (result.status !== "voice_pack_ready") {
        const percent = Math.max(70, Math.min(99, Math.round((result.generatedClipCount / Math.max(1, result.clipCount)) * 100)));
        return {
          status: "running" as const,
          progress: percent,
          message: `Generated ${result.generatedClipCount} / ${result.clipCount} clips. Provider: ${result.provider}. Run the worker again to continue.`,
          result,
          error: null,
        };
      }
      return {
        status: "completed" as const,
        progress: 100,
        message: `Training voice pack ready. manifestPath: ${result.manifestPath}; generated: ${result.generatedClipCount}/${result.clipCount}`,
        result,
        error: null,
      };
    } catch (error) {
      return {
        status: "failed" as const,
        progress: 100,
        message: "Training dataset manifest generation failed.",
        error: error instanceof Error ? error.message : "Training dataset manifest generation failed.",
      };
    }
  }

  if (isApplioTrainingJob(job)) {
    try {
      const result = await createApplioTrainingArtifact(ownerKey, job, {
        onProgress: (event: ApplioTrainingProgressSnapshot) => {
          const epochProgress = typeof event.epochProgressPercent === "number" ? event.epochProgressPercent : null;
          const progress =
            event.currentStage === "completed"
              ? 100
              : event.currentStage === "artifact_copy"
                ? 95
                : event.currentStage === "train" && epochProgress !== null
                  ? Math.max(70, Math.min(94, Math.round(70 + epochProgress * 0.24)))
                  : event.currentStage === "train"
                    ? 70
                    : event.currentStage === "extract"
                      ? 50
                      : event.currentStage === "preprocess"
                        ? 30
                        : 10;
          updateVoicePipelineJob(ownerKey, job.jobId, {
            status: event.currentStage === "failed" ? "failed" : "running",
            progress,
            message: event.message,
            result: event,
            error: event.currentStage === "failed" ? event.message : null,
          });
        },
      });
      return {
        status: "completed" as const,
        progress: 100,
        message: result.mock
          ? `Applio training artifact ready. artifactPath: ${result.artifactPath}`
          : `Real Applio training complete. modelPath: ${result.modelPath}; indexPath: ${result.indexPath}; stdout: ${result.stdoutPath}; stderr: ${result.stderrPath}`,
        result,
        error: null,
      };
    } catch (error) {
      const current = getQueuedContractJob(ownerKey, job.jobId);
      const currentResult =
        current?.result && typeof current.result === "object" && !Array.isArray(current.result)
          ? current.result as Record<string, unknown>
          : {};
      const now = new Date().toISOString();
      const trainingStartedAt = typeof currentResult.trainingStartedAt === "string" ? currentResult.trainingStartedAt : now;
      const totalTrainingMs = Math.max(0, Date.parse(now) - Date.parse(trainingStartedAt));
      const failedResult = {
        ...currentResult,
        mock: false,
        adapter: "applio_real_training",
        status: "failed",
        currentStage: "failed",
        trainingFailedAt: now,
        failedStage: typeof currentResult.currentStage === "string" ? currentResult.currentStage : "failed",
        totalTrainingMs,
        totalTrainingLabel: `${Math.max(0, Math.round(totalTrainingMs / 1000))}s`,
        message: error instanceof Error ? error.message : "Applio training artifact generation failed.",
      };
      return {
        status: "failed" as const,
        progress: 100,
        message: "Applio training artifact generation failed.",
        error: error instanceof Error ? error.message : "Applio training artifact generation failed.",
        result: failedResult,
      };
    }
  }

  if (isApplioTrainedVoiceTestJob(job)) {
    try {
      const result = await runApplioTrainedVoiceInference(ownerKey, job);
      return {
        status: "completed" as const,
        progress: 100,
        message: `Trained Applio voice playback ready. outputAudioPath: ${result.outputAudioPath}; stdout: ${result.stdoutPath}; stderr: ${result.stderrPath}`,
        result,
        error: null,
      };
    } catch (error) {
      let message = "Trained Applio voice inference failed.";
      try {
        const plan = resolveApplioInferencePlan(ownerKey, job);
        message = `Trained Applio voice inference failed. stdout: ${plan.stdoutPath}; stderr: ${plan.stderrPath}`;
      } catch {
        // Keep the validation error as the primary error when planning fails.
      }
      return {
        status: "failed" as const,
        progress: 100,
        message,
        error: error instanceof Error ? error.message : "Trained Applio voice inference failed.",
      };
    }
  }

  if (job.jobType === "character_voice_pipeline" && job.action === "create_voice_sample") {
    return {
      status: "failed" as const,
      progress: 100,
      message: "Real create_voice_sample worker required. Mock voice output is disabled.",
      error: "Real create_voice_sample worker required. Start the Qwen3-TTS or CosyVoice worker with real model env enabled.",
    };
  }

  return {
    status: "completed" as const,
    progress: 100,
    message: "No-op worker completed mock lifecycle",
    result: fakeResultForJob(job),
    error: null,
  };
}

export async function tickVoicePipelineWorker(ownerKey: string, options: VoicePipelineWorkerTickOptions = {}): Promise<VoicePipelineWorkerTickResult> {
  const limit = clampLimit(options.limit);
  const requestedJobId = typeof options.jobId === "string" ? options.jobId.trim() : "";
  const candidates = listVoicePipelineJobs(ownerKey)
    .filter((job) => job.status === "queued" || job.status === "running")
    .filter((job) => !requestedJobId || job.jobId === requestedJobId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit);

  const jobs: QueuedContractJob[] = [];
  for (const job of candidates) {
    const update = await nextWorkerUpdate(ownerKey, job);
    if (!update) continue;

    const updated = "jobId" in update ? update : updateVoicePipelineJob(ownerKey, job.jobId, update);
    if (updated) jobs.push(updated);
  }

  return {
    processed: jobs.length,
    jobs,
  };
}
