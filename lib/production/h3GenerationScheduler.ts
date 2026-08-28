import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import {
  downloadH3Video,
  getH3PromptHistory,
  inspectH3BackendCompatibility,
  submitH3Prompt,
  uploadH3Input,
  type H3BackendCompatibilityRequirements,
  type H3BackendProbe,
} from "@/lib/production/h3Comfy";
import {
  claimProductionV2GenerationJob,
  completeProductionV2GenerationJob,
  failProductionV2GenerationJob,
  getProductionV2GenerationJob,
  listActiveProductionV2GenerationJobs,
  listWaitingProductionV2GenerationJobs,
  markProductionV2GenerationRunning,
  markProductionV2GenerationNativeReady,
  markProductionV2GenerationSubmitted,
  markProductionV2GenerationVsrRunning,
  markProductionV2GenerationVsrSubmitted,
  markProductionV2GenerationVsrWaiting,
  markProductionV2GenerationWaiting,
  requeueProductionV2GenerationBeforeAcceptance,
  type ProductionV2GenerationJob,
} from "@/lib/production/h3GenerationJobs";
import {
  buildH3Workflow,
  buildH3VsrWorkflow,
  H3_BACKEND_PROFILES,
  H3_FINAL_HEIGHT,
  H3_FINAL_WIDTH,
  H3_NATIVE_HEIGHT,
  H3_NATIVE_WIDTH,
  H3_VSR_BACKEND,
  type ProductionV2H3BackendId,
} from "@/lib/production/h3Workflows";
import { productionV2H3UserLoraFilenames } from "@/lib/production/h3Loras";
import { productionV2Store } from "@/lib/production/v2Store";
import {
  appendProductionV2GenerationAttempt,
  appendProductionV2SceneMediaVersion,
  syncProductionV2AssemblyClips,
  type ProductionV2,
  type ProductionV2Scene,
} from "@/lib/production/v2";
import { ComfyGpuBusyError } from "@/lib/workers/comfyPromptLease";

type SchedulerDependencies = {
  probe?: (backend: ProductionV2H3BackendId, requirements?: H3BackendCompatibilityRequirements) => Promise<H3BackendProbe>;
  upload?: typeof uploadH3Input;
  submit?: typeof submitH3Prompt;
  history?: typeof getH3PromptHistory;
  download?: typeof downloadH3Video;
  finalizeVsr?: typeof finalizeH3VsrWithNativeAudio;
};

const GLOBAL_KEY = "__otgProductionV2H3Scheduler";
const globalState = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: { timer: ReturnType<typeof setInterval>; running: boolean };
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

async function fileExists(filePath: string) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code
      === "ENOENT"
    ) {
      return false;
    }

    throw error;
  }
}

export async function finalizeH3VsrWithNativeAudio(input: {
  rawVsrOutputPath: string;
  nativeOutputPath: string;
  ffmpegPath?: string;
}) {
  const rawVsrOutputPath = path.resolve(
    input.rawVsrOutputPath,
  );

  const nativeOutputPath = path.resolve(
    input.nativeOutputPath,
  );

  if (rawVsrOutputPath === nativeOutputPath) {
    throw new Error(
      "RTX VSR raw output and native H3 artifact cannot be the same file.",
    );
  }

  const [rawStat, nativeStat] = await Promise.all([
    fsp.stat(rawVsrOutputPath),
    fsp.stat(nativeOutputPath),
  ]);

  if (!rawStat.isFile() || rawStat.size <= 0) {
    throw new Error(
      "RTX VSR raw 1080p artifact is missing or empty.",
    );
  }

  if (!nativeStat.isFile() || nativeStat.size <= 0) {
    throw new Error(
      "Native H3 artifact is missing or empty.",
    );
  }

  const parsed = path.parse(rawVsrOutputPath);
  const rawMarker = "-vsr-raw";

  const finalBaseName = parsed.name.endsWith(rawMarker)
    ? parsed.name.slice(
        0,
        -rawMarker.length,
      )
    : `${parsed.name}-final`;

  if (!finalBaseName) {
    throw new Error(
      "Could not derive final RTX VSR artifact filename.",
    );
  }

  const finalOutputPath = path.join(
    parsed.dir,
    `${finalBaseName}${parsed.ext}`,
  );

  if (await fileExists(finalOutputPath)) {
    throw new Error(
      `Final H3 artifact already exists; refusing to overwrite: ${finalOutputPath}`,
    );
  }

  const temporaryOutputPath = path.join(
    parsed.dir,
    `.${finalBaseName}.finalizing-${randomUUID()}${parsed.ext}`,
  );

  const ffmpegPath =
    clean(input.ffmpegPath)
    || "/usr/bin/ffmpeg";

  try {
    await new Promise<void>(
      (resolve, reject) => {
        execFile(
          ffmpegPath,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-n",

            "-i",
            rawVsrOutputPath,

            "-i",
            nativeOutputPath,

            "-map",
            "0:v:0",

            "-map",
            "1:a:0",

            "-c:v",
            "copy",

            "-c:a",
            "copy",

            temporaryOutputPath,
          ],
          {
            timeout: 120_000,
            maxBuffer: 2 * 1024 * 1024,
          },
          (
            error,
            _stdout,
            stderr,
          ) => {
            if (!error) {
              resolve();
              return;
            }

            reject(
              new Error(
                clean(stderr)
                || error.message
                || "ffmpeg stream-copy finalization failed.",
              ),
            );
          },
        );
      },
    );

    const temporaryStat =
      await fsp.stat(
        temporaryOutputPath,
      );

    if (
      !temporaryStat.isFile()
      || temporaryStat.size <= 0
    ) {
      throw new Error(
        "Audio-preserving RTX VSR finalization produced an empty artifact.",
      );
    }

    /*
     * Both paths are in the same generation directory.
     * link() publishes without overwriting an existing
     * final artifact.
     */
    await fsp.link(
      temporaryOutputPath,
      finalOutputPath,
    );

    await fsp.unlink(
      temporaryOutputPath,
    );

    const finalStat =
      await fsp.stat(
        finalOutputPath,
      );

    if (
      !finalStat.isFile()
      || finalStat.size <= 0
    ) {
      throw new Error(
        "Final audio-preserved 1080p H3 artifact is missing or empty.",
      );
    }

    return finalOutputPath;
  } catch (error) {
    await fsp.rm(
      temporaryOutputPath,
      { force: true },
    ).catch(
      () => undefined,
    );

    throw error;
  }
}


export function chooseProductionV2H3Backend(probes: H3BackendProbe[]): ProductionV2H3BackendId | null {
  const byId = new Map(probes.map((probe) => [probe.backend, probe]));
  const primary = byId.get("rtx3090");
  if (primary?.healthy && primary.compatible && primary.idle) return "rtx3090";
  const secondary = byId.get("rtx5060ti");
  if (secondary?.healthy && secondary.compatible && secondary.idle) return "rtx5060ti";
  return null;
}

export function applyProductionV2H3GenerationToProduction(
  production: ProductionV2,
  job: ProductionV2GenerationJob,
  status: "generating" | "generated" | "failed",
  outputPath?: string,
) {
  const scenes = production.scenes.map((scene) => {
    if (scene.id !== job.sceneId) return scene;
    if (status === "generated" && outputPath && job.backend && job.comfyPromptId) {
      const completedAt = job.completedAt || new Date().toISOString();
      const operation = job.payload.operation || "scene-generation";
      if (operation === "visual-edit") {
        const parentVersionId = job.payload.videoReference?.mediaVersionId || "";
        if (!scene.mediaVersions.some((version) => version.id === parentVersionId)) {
          throw new Error("Completed H3 visual edit lost its exact parent media version.");
        }
        const versionId = `media-${job.id}`;
        let versioned: ProductionV2Scene = { ...scene, status: "edited", workflowVersion: job.workflowId, seed: job.payload.seed };
        if (!versioned.mediaVersions.some((version) => version.id === versionId)) {
          versioned = appendProductionV2SceneMediaVersion(versioned, {
            id: versionId,
            parentVersionId,
            mediaPath: outputPath,
            previewUrl: `/api/production/v2/generation/media?jobId=${encodeURIComponent(job.id)}`,
            versionType: "visual-edit",
            createdAt: completedAt,
            sourceOperation: "minimax-h3-video-edit",
            metadata: {
              generationJobId: job.id,
              promptId: job.comfyPromptId,
              backend: job.backend,
              vsrPromptId: job.vsrPromptId,
              vsrBackend: job.vsrBackend,
              nativeWidth: H3_NATIVE_WIDTH,
              nativeHeight: H3_NATIVE_HEIGHT,
              finalWidth: H3_FINAL_WIDTH,
              finalHeight: H3_FINAL_HEIGHT,
              postprocess: "rtx-vsr-ultra",
              videoReferenceVersionId: parentVersionId,
            },
          }, { selectActive: true });
        }
        return appendProductionV2GenerationAttempt(versioned, {
          id: job.id,
          jobId: job.id,
          mediaVersionId: versionId,
          status: "completed",
          createdAt: job.createdAt,
          completedAt,
          model: "minimax-h3",
          generationMode: job.mode,
          backend: job.backend,
          promptId: job.comfyPromptId,
        });
      }
      const clip = {
        id: `clip-${job.id}`,
        path: outputPath,
        previewUrl: `/api/production/v2/generation/media?jobId=${encodeURIComponent(job.id)}`,
        createdAt: completedAt,
        generationJobId: job.id,
        promptId: job.comfyPromptId,
        backend: job.backend,
        model: "minimax-h3" as const,
        mode: job.mode,
        durationSeconds: job.payload.durationSeconds,
      };
      const versionId = `media-${job.id}`;
      let versioned: ProductionV2Scene = {
        ...scene,
        status: "generated" as const,
        workflowVersion: job.workflowId,
        seed: job.payload.seed,
        generatedClip: clip,
      };
      if (!versioned.mediaVersions.some((version) => version.id === versionId)) {
        versioned = appendProductionV2SceneMediaVersion(versioned, {
          id: versionId,
          parentVersionId: null,
          mediaPath: outputPath,
          previewUrl: clip.previewUrl,
          versionType: "generated",
          createdAt: completedAt,
          sourceOperation: "video-generation",
          metadata: {
            generationJobId: job.id,
            promptId: job.comfyPromptId,
            backend: job.backend,
            vsrPromptId: job.vsrPromptId,
            vsrBackend: job.vsrBackend,
            nativeWidth: H3_NATIVE_WIDTH,
            nativeHeight: H3_NATIVE_HEIGHT,
            finalWidth: H3_FINAL_WIDTH,
            finalHeight: H3_FINAL_HEIGHT,
            postprocess: "rtx-vsr-ultra",
          },
        }, { selectActive: true, selectGenerated: true, selectForAssembly: true });
      }
      return appendProductionV2GenerationAttempt(versioned, {
        id: job.id,
        jobId: job.id,
        mediaVersionId: versionId,
        status: "completed",
        createdAt: job.createdAt,
        completedAt,
        model: "minimax-h3",
        generationMode: job.mode,
        backend: job.backend,
        promptId: job.comfyPromptId,
      });
    }
    if (status === "generating") return { ...scene, status: "generating" as const };
    const restoredStatus = scene.mediaVersions.some((version) => version.versionType !== "generated")
      ? "edited" as const
      : scene.mediaVersions.length || scene.generatedClip
        ? "generated" as const
        : scene.savedAt ? "saved" as const : "draft" as const;
    return { ...scene, status: restoredStatus };
  });
  const updated = {
    ...production,
    lifecycleStage: status === "generated"
      ? job.payload.operation === "visual-edit" ? "editing" as const : production.lifecycleStage === "draft" ? "scenes-generated" as const : production.lifecycleStage
      : production.lifecycleStage,
    scenes,
  };
  return syncProductionV2AssemblyClips(updated);
}

function sceneStatus(job: ProductionV2GenerationJob, status: "generating" | "generated" | "failed", outputPath?: string) {
  const production = productionV2Store.load(job.ownerKey, job.productionId);
  if (!production) return;
  productionV2Store.save(job.ownerKey, applyProductionV2H3GenerationToProduction(production, job, status, outputPath));
}

export function reconcileProductionV2GenerationJob(job: ProductionV2GenerationJob) {
  if (job.status === "completed" && job.outputPath) {
    sceneStatus(job, "generated", job.outputPath);
  } else if (["pending", "queued_waiting_for_gpu", "claimed", "submitted", "running", "postprocessing_waiting_for_gpu", "postprocessing_submitted", "postprocessing_running"].includes(job.status)) {
    sceneStatus(job, "generating");
  } else if (job.status === "failed") {
    sceneStatus(job, "failed");
  }
}

async function prepareAndSubmit(job: ProductionV2GenerationJob, dependencies: SchedulerDependencies) {
  if (!job.backend) throw new Error("Claimed H3 job has no backend.");
  const upload = dependencies.upload || uploadH3Input;
  const submit = dependencies.submit || submitH3Prompt;
  const uploadBase = `pv2_${job.id}`;
  let startImageFilename: string | undefined;
  let videoReferenceFilename: string | undefined;
  const references: Array<(typeof job.payload.references)[number] & { uploadedFilename: string }> = [];
  const voices: Array<(typeof job.payload.voices)[number] & { uploadedFilename: string }> = [];

  if (job.payload.operation === "visual-edit") {
    const reference = job.payload.videoReference;
    if (!reference?.mediaVersionId || !reference.mediaPath) throw new Error("H3 visual edit lost its selected video-reference contract.");
    videoReferenceFilename = await upload({
      backend: job.backend,
      sourcePath: reference.mediaPath,
      mediaType: "video",
      uploadName: `${uploadBase}_video_reference`,
    });
  } else if (job.mode === "h3-image-to-video") {
    const startImage = job.payload.startImage;
    if (!startImage?.workflowImage) throw new Error("H3 I2V job lost its starting-image generation source.");
    if (startImage.sourceKind === "character" && startImage.generationSourceType !== "character-card") {
      throw new Error("H3 I2V Character input must use the Character Card, never the default thumbnail.");
    }
    startImageFilename = await upload({
      backend: job.backend,
      sourcePath: startImage.workflowImage,
      mediaType: "image",
      uploadName: `${uploadBase}_start`,
    });
  } else {
    for (const reference of job.payload.references) {
      const slot = Number(reference.pictureSlot);
      references.push({
        ...reference,
        uploadedFilename: await upload({
          backend: job.backend,
          sourcePath: clean(reference.workflowImage),
          mediaType: "image",
          uploadName: `${uploadBase}_picture_${slot}`,
        }),
      });
    }
    for (const voice of job.payload.voices) {
      voices.push({
        ...voice,
        uploadedFilename: await upload({
          backend: job.backend,
          sourcePath: voice.sourcePath,
          mediaType: "audio",
          uploadName: `${uploadBase}_audio_${voice.audioSlot}`,
        }),
      });
    }
  }

  const outputPrefix = `otg_production_v2/${job.productionId}/${job.sceneId}/${job.id}`.replace(/[^a-zA-Z0-9_./-]/g, "_");
  const built = buildH3Workflow({
    backend: job.backend,
    mode: job.mode,
    finalPrompt: job.payload.finalPrompt,
    durationSeconds: job.payload.durationSeconds,
    seed: job.payload.seed,
    outputPrefix,
    startImageFilename,
    references,
    voices,
    operation: job.payload.operation || "scene-generation",
    videoReferenceFilename,
    includeVideoReferenceAudio: job.payload.videoReference?.includeAudio,
    userLoras: job.payload.userLoras,
  });
  const result = await submit({
    backend: job.backend,
    graph: built.graph,
    clientId: `otg-production-v2-${randomUUID()}`,
    jobId: job.id,
  });
  if (!result.accepted) {
    if (result.status === 409 || result.status === 429 || result.status === 503) {
      requeueProductionV2GenerationBeforeAcceptance(job.id, job.backend, "Waiting for first available GPU");
      return;
    }
    failProductionV2GenerationJob(job.id, result.error);
    sceneStatus(job, "failed");
    return;
  }
  const submitted = markProductionV2GenerationSubmitted({
    id: job.id,
    backend: job.backend,
    promptId: result.promptId,
    workflowId: built.workflowId,
    workflowFile: built.workflowFile,
  });
  if (!submitted) throw new Error("H3 prompt was accepted but the OTG job could not record its prompt ID.");
  sceneStatus(submitted, "generating");
}

function schedulerProbe(dependencies: SchedulerDependencies) {
  return dependencies.probe
    || ((backend: ProductionV2H3BackendId, requirements?: H3BackendCompatibilityRequirements) => inspectH3BackendCompatibility(backend, requirements));
}

function failActiveJob(job: ProductionV2GenerationJob, message: string) {
  const failed = failProductionV2GenerationJob(job.id, message);
  sceneStatus(failed || job, "failed");
}

async function advanceNativeH3Job(job: ProductionV2GenerationJob, dependencies: SchedulerDependencies) {
  if (!job.backend || !job.comfyPromptId) {
    failActiveJob(job, "Submitted H3 job is missing backend or ComfyUI prompt ID.");
    return;
  }
  const history = await (dependencies.history || getH3PromptHistory)(job.backend, job.comfyPromptId);
  if (history.state === "pending" || history.state === "running") {
    markProductionV2GenerationRunning(job.id);
    return;
  }
  if (history.state === "failed" || !history.video) {
    failActiveJob(job, "Native MiniMax H3 generation failed in ComfyUI or produced no native video output.");
    return;
  }
  let nativeOutputPath: string;
  try {
    nativeOutputPath = await (dependencies.download || downloadH3Video)({
      backend: job.backend,
      file: history.video,
      ownerKey: job.ownerKey,
      productionId: job.productionId,
      sceneId: job.sceneId,
      generationJobId: job.id,
      artifactSuffix: "native",
    });
  } catch (error) {
    failActiveJob(job, `Native H3 output download failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (!markProductionV2GenerationNativeReady(job.id, nativeOutputPath)) {
    throw new Error("Native H3 output was downloaded but its RTX VSR post-processing state could not be recorded.");
  }
}

async function prepareAndSubmitVsr(job: ProductionV2GenerationJob, dependencies: SchedulerDependencies) {
  if (!job.nativeOutputPath) {
    failActiveJob(job, "RTX VSR post-processing cannot start because the native H3 artifact path is missing.");
    return;
  }
  const availability = await schedulerProbe(dependencies)(H3_VSR_BACKEND, { requireVsr: true });
  if (!availability.healthy) {
    markProductionV2GenerationVsrWaiting(job.id, "Waiting for the RTX VSR 1080p backend");
    return;
  }
  if (!availability.compatible) {
    failActiveJob(job, `RTX VSR preflight failed. Missing nodes: ${availability.missingNodes.join(", ") || "unknown"}.`);
    return;
  }
  if (!availability.idle) {
    markProductionV2GenerationVsrWaiting(job.id, "Waiting for RTX 5060 Ti to run VSR ULTRA 1080p");
    return;
  }

  let uploadedFilename: string;
  try {
    uploadedFilename = await (dependencies.upload || uploadH3Input)({
      backend: H3_VSR_BACKEND,
      sourcePath: job.nativeOutputPath,
      mediaType: "video",
      uploadName: `pv2_${job.id}_native_vsr_source`,
    });
  } catch (error) {
    failActiveJob(job, `RTX VSR native-video upload failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const outputPrefix = `otg_production_v2/${job.productionId}/${job.sceneId}/${job.id}_1080p`.replace(/[^a-zA-Z0-9_./-]/g, "_");
  let built: ReturnType<typeof buildH3VsrWorkflow>;
  try {
    built = buildH3VsrWorkflow({ videoInputFilename: uploadedFilename, outputPrefix });
  } catch (error) {
    failActiveJob(job, `RTX VSR workflow validation failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  let result: Awaited<ReturnType<typeof submitH3Prompt>>;
  try {
    result = await (dependencies.submit || submitH3Prompt)({
      backend: H3_VSR_BACKEND,
      graph: built.graph,
      clientId: `otg-production-v2-vsr-${randomUUID()}`,
      jobId: `${job.id}-vsr`,
      workerId: "production-v2-h3-vsr",
    });
  } catch (error) {
    if (error instanceof ComfyGpuBusyError) {
      markProductionV2GenerationVsrWaiting(job.id, "Waiting for RTX 5060 Ti to run VSR ULTRA 1080p");
      return;
    }
    failActiveJob(job, `RTX VSR submission failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (!result.accepted) {
    if (result.status === 409 || result.status === 429 || result.status === 503) {
      markProductionV2GenerationVsrWaiting(job.id, "Waiting for RTX 5060 Ti to run VSR ULTRA 1080p");
      return;
    }
    failActiveJob(job, `RTX VSR submission failed: ${result.error}`);
    return;
  }
  if (!markProductionV2GenerationVsrSubmitted({ id: job.id, promptId: result.promptId })) {
    failActiveJob(job, "RTX VSR prompt was accepted but its durable prompt ID could not be recorded; the job was stopped to prevent a duplicate submission.");
  }
}

async function advanceVsrJob(job: ProductionV2GenerationJob, dependencies: SchedulerDependencies) {
  if (job.vsrBackend !== H3_VSR_BACKEND || !job.vsrPromptId) {
    failActiveJob(job, "RTX VSR job is missing its 5060 Ti backend or ComfyUI prompt ID.");
    return;
  }
  const history = await (dependencies.history || getH3PromptHistory)(job.vsrBackend, job.vsrPromptId, fetch, "9");
  if (history.state === "pending" || history.state === "running") {
    markProductionV2GenerationVsrRunning(job.id);
    return;
  }
  if (history.state === "failed" || !history.video) {
    failActiveJob(job, "RTX VSR execution failed or the required 1920x1080 output is missing.");
    return;
  }
  if (!job.nativeOutputPath) {
    failActiveJob(
      job,
      "RTX VSR completed but the native H3 audio source path is missing.",
    );
    return;
  }

  let rawVsrOutputPath: string;

  try {
    rawVsrOutputPath = await (
      dependencies.download
      || downloadH3Video
    )({
      backend: job.vsrBackend,
      file: history.video,
      ownerKey: job.ownerKey,
      productionId: job.productionId,
      sceneId: job.sceneId,
      generationJobId: job.id,
      artifactSuffix: "1080p-vsr-raw",
    });
  } catch (error) {
    failActiveJob(
      job,
      `RTX VSR raw-output download failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
    return;
  }

  let finalOutputPath: string;

  try {
    finalOutputPath = await (
      dependencies.finalizeVsr
      || finalizeH3VsrWithNativeAudio
    )({
      rawVsrOutputPath,
      nativeOutputPath: job.nativeOutputPath,
    });
  } catch (error) {
    failActiveJob(
      job,
      `RTX VSR audio-preserving finalization failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
    return;
  }

  const completed = completeProductionV2GenerationJob(job.id, finalOutputPath);
  if (!completed) throw new Error("RTX VSR output was downloaded but the job could not be marked complete.");
  sceneStatus(completed, "generated", finalOutputPath);
}

async function advanceActiveJob(job: ProductionV2GenerationJob, dependencies: SchedulerDependencies) {
  if (job.status === "submitted" || job.status === "running") {
    await advanceNativeH3Job(job, dependencies);
    return;
  }
  if (job.status === "postprocessing_waiting_for_gpu") {
    await prepareAndSubmitVsr(job, dependencies);
    return;
  }
  if (job.status === "postprocessing_submitted" || job.status === "postprocessing_running") {
    await advanceVsrJob(job, dependencies);
  }
}

export async function runProductionV2H3SchedulerTick(dependencies: SchedulerDependencies = {}) {
  const errors: string[] = [];
  for (const job of listActiveProductionV2GenerationJobs()) {
    try {
      await advanceActiveJob(job, dependencies);
    } catch (error) {
      errors.push(`${job.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const waiting of listWaitingProductionV2GenerationJobs()) {
    try {
      const probe = schedulerProbe(dependencies);
      const userLoraFilenames = productionV2H3UserLoraFilenames(waiting.payload.userLoras);
      const [primaryProbe, secondaryProbe, vsrProbe] = await Promise.all([
        probe("rtx3090", { userLoraFilenames }),
        probe("rtx5060ti", { userLoraFilenames }),
        probe(H3_VSR_BACKEND, { requireVsr: true }),
      ]);
      if (!vsrProbe.healthy || !vsrProbe.compatible) {
        markProductionV2GenerationWaiting(waiting.id, "Waiting for a compatible RTX VSR ULTRA 1080p backend");
        continue;
      }
      const probes = [primaryProbe, secondaryProbe];
      const compatible = probes.filter((item) => item.healthy && item.compatible);
      if (!compatible.length) {
        markProductionV2GenerationWaiting(
          waiting.id,
          userLoraFilenames.length
            ? "Waiting for a MiniMax H3 GPU with every selected LoRA"
            : "Waiting for a compatible MiniMax H3 GPU",
        );
        continue;
      }
      const backend = chooseProductionV2H3Backend(probes);
      if (!backend) {
        markProductionV2GenerationWaiting(waiting.id, "Waiting for first available GPU");
        continue;
      }
      const claimed = claimProductionV2GenerationJob(waiting.id, backend);
      if (!claimed) continue;
      try {
        await prepareAndSubmit(claimed, dependencies);
      } catch (error) {
        if (error instanceof ComfyGpuBusyError) {
          requeueProductionV2GenerationBeforeAcceptance(claimed.id, backend, "Waiting for first available GPU");
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        const current = getProductionV2GenerationJob(claimed.id);
        const ambiguous = current?.submissionState === "pre-submit" && /timed out|fetch failed|network|successful but unreadable/i.test(message);
        failProductionV2GenerationJob(claimed.id, message, ambiguous);
        sceneStatus(claimed, "failed");
      }
    } catch (error) {
      errors.push(`${waiting.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { errors };
}

export function startProductionV2H3Scheduler() {
  if (globalState[GLOBAL_KEY]) return;
  const state = { running: false, timer: null as unknown as ReturnType<typeof setInterval> };
  state.timer = setInterval(() => {
    if (state.running) return;
    state.running = true;
    void runProductionV2H3SchedulerTick().finally(() => { state.running = false; });
  }, Math.max(2_000, Number(process.env.PRODUCTION_V2_H3_SCHEDULER_POLL_MS || 4_000)));
  state.timer.unref?.();
  globalState[GLOBAL_KEY] = state;
}

export function productionV2GenerationPublicStatus(job: ProductionV2GenerationJob) {
  return {
    id: job.id,
    productionId: job.productionId,
    sceneId: job.sceneId,
    model: job.model,
    mode: job.mode,
    operation: job.payload.operation || "scene-generation",
    status: job.status,
    statusMessage: job.statusMessage,
    backend: job.backend,
    backendLabel: job.backend ? H3_BACKEND_PROFILES[job.backend].label : null,
    promptId: job.comfyPromptId,
    vsrPromptId: job.vsrPromptId,
    nativeOutputReady: Boolean(job.nativeOutputPath),
    finalResolution: `${H3_FINAL_WIDTH}x${H3_FINAL_HEIGHT}`,
    workflowId: job.workflowId,
    workflowFile: job.workflowFile,
    error: job.error,
    createdAt: job.createdAt,
    submittedAt: job.submittedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    retryOfJobId: job.payload.retryOfJobId || null,
    videoUrl: job.status === "completed" ? `/api/production/v2/generation/media?jobId=${encodeURIComponent(job.id)}` : null,
  };
}
