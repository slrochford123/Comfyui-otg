import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import {
  buildQwenBaseInstruction,
  defaultQwenVoiceDesignInput,
  structuredQwenVoiceDesign,
} from "@/lib/characters/qwenVoiceDesign";
import {
  buildCosyVoiceInstructionPrompt,
  buildVoiceRequestPayload,
  defaultVoiceDesignProfile,
  voiceDesignWarnings,
} from "@/lib/characters/voiceDesignModels";
import { APPLIO_TRAINING_QUALITY_PRESETS, DEFAULT_APPLIO_TRAINING_QUALITY_PRESET } from "@/lib/characterVoiceAudioStudio";
import { CHARACTER_PREVIEW_DUB_SCRIPT } from "@/lib/characters/characterPreviewDub";

import {
  clearQueuedContractJobsForTests,
  createCharacterAnimationPreviewJob,
  createCharacterVoicePipelineJob,
  createProductionAudioStudioJob,
  checkpointRemoteWorkerJob,
  claimRemoteWorkerJob,
  claimRemoteWorkerJobAcrossOwners,
  claimRemoteVoicePipelineWorkerJob,
  completeRemoteWorkerJob,
  getQueuedContractJob,
  getVoicePipelineJobStorePath,
  isVoicePipelineJobLeaseStale,
  failRemoteWorkerJob,
  finalizeTrainingDatasetJob,
  listVoicePipelineJobs,
  setVoicePipelineJobStorePathForTests,
  supersedePendingCreateVoiceJobs,
  resumeVoicePipelineJob,
  stopVoicePipelineJob,
  terminateVoicePipelineJob,
  updateVoicePipelineJob,
} from "@/lib/jobs/voicePipelineJobs";
import {
  getOtgWorkerJobRoute,
  isOtgWorkerOnlyJob,
  normalizeOtgWorkerAction,
  normalizeOtgWorkerJobType,
  OTG_WORKER_ONLY_FEATURE_AREAS,
} from "@/lib/jobs/workerJobContract";

describe("voice pipeline job contracts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "otg-voice-pipeline-jobs-"));

  beforeEach(() => {
    setVoicePipelineJobStorePathForTests(path.join(tempDir, `jobs-${Date.now()}-${Math.random().toString(16).slice(2)}.json`));
    clearQueuedContractJobsForTests();
  });

  async function patchVoiceJob(jobId: string, action: string, body = JSON.stringify({ action })) {
    process.env.AUTH_SECRET ||= "test-secret-for-voice-pipeline-route";
    const { PATCH } = await import("@/app/api/characters/voice-pipeline/[jobId]/route");
    return PATCH(
      new NextRequest(`http://127.0.0.1/api/characters/voice-pipeline/${encodeURIComponent(jobId)}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-otg-device-id": "owner-a",
        },
        body,
      }),
      { params: Promise.resolve({ jobId }) },
    );
  }

  async function patchVoiceJobWithFallbackAction(jobId: string, action: string, source: "query" | "header") {
    process.env.AUTH_SECRET ||= "test-secret-for-voice-pipeline-route";
    const { PATCH } = await import("@/app/api/characters/voice-pipeline/[jobId]/route");
    const url =
      source === "query"
        ? `http://127.0.0.1/api/characters/voice-pipeline/${encodeURIComponent(jobId)}?action=${encodeURIComponent(action)}`
        : `http://127.0.0.1/api/characters/voice-pipeline/${encodeURIComponent(jobId)}`;
    return PATCH(
      new NextRequest(url, {
        method: "PATCH",
        headers: {
          "x-otg-device-id": "owner-a",
          ...(source === "header" ? { "x-otg-action": action } : {}),
        },
      }),
      { params: Promise.resolve({ jobId }) },
    );
  }

  async function patchVoiceJobWithoutOwnerHint(jobId: string, action: string, source: "body" | "query") {
    process.env.AUTH_SECRET ||= "test-secret-for-voice-pipeline-route";
    const { PATCH } = await import("@/app/api/characters/voice-pipeline/[jobId]/route");
    const url =
      source === "query"
        ? `http://127.0.0.1/api/characters/voice-pipeline/${encodeURIComponent(jobId)}?action=${encodeURIComponent(action)}`
        : `http://127.0.0.1/api/characters/voice-pipeline/${encodeURIComponent(jobId)}`;
    return PATCH(
      new NextRequest(url, {
        method: "PATCH",
        headers: source === "body" ? { "content-type": "application/json" } : {},
        body: source === "body" ? JSON.stringify({ action }) : undefined,
      }),
      { params: Promise.resolve({ jobId }) },
    );
  }

  it("queues a character voice-pipeline job with the public contract shape", () => {
    const result = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "qwen3",
      prompt: "small brave voice",
      unsafe: undefined,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.job).toMatchObject({
      jobType: "character_voice_pipeline",
      action: "create_voice_sample",
      status: "queued",
      characterId: "char-1",
      clipId: null,
      result: null,
      error: null,
      input: {
        action: "create_voice_sample",
        characterId: "char-1",
        provider: "qwen3",
        prompt: "small brave voice",
      },
    });
    expect(result.job.jobId).toMatch(/^cvp_/);
    expect(new Date(result.job.createdAt).toString()).not.toBe("Invalid Date");
    expect(getQueuedContractJob("owner-a", result.job.jobId)).toEqual(result.job);
    expect(getQueuedContractJob("owner-b", result.job.jobId)).toBeNull();
    expect(fs.existsSync(getVoicePipelineJobStorePath())).toBe(true);
    expect(JSON.parse(fs.readFileSync(getVoicePipelineJobStorePath(), "utf8")).jobs).toHaveLength(1);
  });

  it("PATCH voice-pipeline job route accepts direct JSON bodies for resume, stop, and terminate", async () => {
    const makeJob = (characterId: string) => {
      const created = createCharacterVoicePipelineJob("owner-a", {
        action: "start_applio_training",
        characterId,
        trainingPreset: "balanced",
        approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char&jobId=cvp_base",
        approvedSamplePath: path.join(tempDir, "source.wav"),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.error);
      return created.job.jobId;
    };

    fs.writeFileSync(path.join(tempDir, "source.wav"), "voice", "utf8");
    const resumeJobId = makeJob("char-resume-route");
    updateVoicePipelineJob("owner-a", resumeJobId, { status: "interrupted", progress: 50, error: "stale" });
    const resumeResponse = await patchVoiceJob(resumeJobId, "resume");
    expect(resumeResponse.status).toBe(200);
    await expect(resumeResponse.json()).resolves.toMatchObject({ job: { status: "queued", jobId: resumeJobId } });

    const stopJobId = makeJob("char-stop-route");
    const stopResponse = await patchVoiceJob(stopJobId, "stop");
    expect(stopResponse.status).toBe(200);
    await expect(stopResponse.json()).resolves.toMatchObject({ job: { status: "canceled", jobId: stopJobId } });

    const terminateJobId = makeJob("char-terminate-route");
    const terminateResponse = await patchVoiceJob(terminateJobId, "terminate");
    expect(terminateResponse.status).toBe(200);
    await expect(terminateResponse.json()).resolves.toMatchObject({ job: { status: "terminated", jobId: terminateJobId } });
  });

  it("PATCH voice-pipeline job route accepts query and header action fallbacks", async () => {
    const makeInterruptedJob = (characterId: string) => {
      const sourcePath = path.join(tempDir, `${characterId}.wav`);
      fs.writeFileSync(sourcePath, "voice", "utf8");
      const created = createCharacterVoicePipelineJob("owner-a", {
        action: "start_applio_training",
        characterId,
        trainingPreset: "balanced",
        approvedSampleUrl: `/api/characters/voice-sample/file?owner=owner-a&characterId=${characterId}&jobId=cvp_base`,
        approvedSamplePath: sourcePath,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.error);
      updateVoicePipelineJob("owner-a", created.job.jobId, { status: "interrupted", progress: 50, error: "stale" });
      return created.job.jobId;
    };

    const queryJobId = makeInterruptedJob("char-resume-query-route");
    const queryResponse = await patchVoiceJobWithFallbackAction(queryJobId, "resume", "query");
    expect(queryResponse.status).toBe(200);
    await expect(queryResponse.json()).resolves.toMatchObject({ job: { status: "queued", jobId: queryJobId } });

    const headerJobId = makeInterruptedJob("char-resume-header-route");
    const headerResponse = await patchVoiceJobWithFallbackAction(headerJobId, "resume", "header");
    expect(headerResponse.status).toBe(200);
    await expect(headerResponse.json()).resolves.toMatchObject({ job: { status: "queued", jobId: headerJobId } });
  });

  it("PATCH voice-pipeline job route resolves stored owner before parsing direct body-only requests", async () => {
    const makeInterruptedJob = (characterId: string) => {
      const sourcePath = path.join(tempDir, `${characterId}.wav`);
      fs.writeFileSync(sourcePath, "voice", "utf8");
      const created = createCharacterVoicePipelineJob("owner-a", {
        action: "start_applio_training",
        characterId,
        trainingPreset: "balanced",
        approvedSampleUrl: `/api/characters/voice-sample/file?owner=owner-a&characterId=${characterId}&jobId=cvp_base`,
        approvedSamplePath: sourcePath,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.error);
      updateVoicePipelineJob("owner-a", created.job.jobId, { status: "interrupted", progress: 50, error: "stale" });
      return created.job.jobId;
    };

    const bodyJobId = makeInterruptedJob("char-resume-body-no-owner-route");
    const bodyResponse = await patchVoiceJobWithoutOwnerHint(bodyJobId, "resume", "body");
    expect(bodyResponse.status).toBe(200);
    await expect(bodyResponse.json()).resolves.toMatchObject({ job: { status: "queued", jobId: bodyJobId } });

    const queryJobId = makeInterruptedJob("char-resume-query-no-owner-route");
    const queryResponse = await patchVoiceJobWithoutOwnerHint(queryJobId, "resume", "query");
    expect(queryResponse.status).toBe(200);
    await expect(queryResponse.json()).resolves.toMatchObject({ job: { status: "queued", jobId: queryJobId } });
  });

  it("PATCH voice-pipeline job route does not require a body for already completed datasets", async () => {
    fs.writeFileSync(path.join(tempDir, "source-complete.wav"), "voice", "utf8");
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-completed-idempotent",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char&jobId=cvp_base",
      approvedSamplePath: path.join(tempDir, "source-complete.wav"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    updateVoicePipelineJob("owner-a", created.job.jobId, { status: "completed", progress: 100 });

    const response = await patchVoiceJob(created.job.jobId, "complete_dataset", "");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, job: { status: "completed", jobId: created.job.jobId } });
  });

  it("dedicated Applio worker heartbeats while long subprocess stages are running", () => {
    const workerSource = fs.readFileSync(path.join(process.cwd(), "scripts", "windows", "otg-voice-applio-worker.py"), "utf8");
    expect(workerSource).toContain("parser.add_argument(\"--heartbeat-seconds\"");
    expect(workerSource).toContain("threading.Thread(target=pipe_reader");
    expect(workerSource).toContain("Applio {command['step']} running.");
    expect(workerSource).toContain("kill_process_tree(proc)");
    expect(workerSource).toContain("taskkill");
  });

  it("rejects invalid character voice-pipeline inputs", () => {
    expect(createCharacterVoicePipelineJob("owner-a", {}).ok).toBe(false);
    expect(createCharacterVoicePipelineJob("owner-a", { action: "missing", characterId: "char-1" })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(createCharacterVoicePipelineJob("owner-a", { action: "create_voice_sample", characterId: "char-1", provider: "bad" })).toMatchObject({
      ok: false,
      error: "Invalid provider. Expected qwen3, cosy, ltx, or unnatural_ltx.",
    });
    expect(createCharacterVoicePipelineJob("owner-a", { action: "create_voice_sample", characterId: "char-1", provider: "unnatural_ltx", source: "unnatural_voice_preset" })).toMatchObject({
      ok: true,
    });
    expect(createCharacterVoicePipelineJob("owner-a", { action: "apply_voice_fx", characterId: "char-1", fxPreset: "bad" })).toMatchObject({
      ok: false,
      error: "Invalid voice FX preset.",
    });
    expect(createCharacterVoicePipelineJob("owner-a", { action: "generate_training_dataset", characterId: "char-1", trainingPreset: "slow" })).toMatchObject({
      ok: false,
      error: "Invalid training preset. Expected quick, balanced, or high_quality.",
    });
    expect(createCharacterVoicePipelineJob("owner-a", { action: "generate_training_dataset", characterId: "char-1", trainingPreset: "balanced" })).toMatchObject({
      ok: false,
      error: "Missing approvedSampleUrl for training jobs.",
    });
    expect(createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-file?path=characters%2Fowner-a%2Fsample.wav",
    })).toMatchObject({
      ok: false,
      error: "Training jobs require a locked local voice sample. Use a created/uploaded character voice sample before training.",
    });
    expect(createCharacterVoicePipelineJob("owner-a", { action: "start_applio_training", characterId: "char-1", trainingPreset: "balanced" })).toMatchObject({
      ok: false,
      error: "Missing approvedSampleUrl for training jobs.",
    });
  });

  it("queues training jobs with approved sample source metadata", () => {
    const result = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      requestedClipCount: 200,
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_fx&file=fx.wav",
      approvedSampleType: "tuned",
      approvedSourceJobId: "cvp_fx",
      baseSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
      tunedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_fx&file=fx.wav",
      tunedFxPreset: "robotic",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.job).toMatchObject({
      jobType: "character_voice_pipeline",
      action: "generate_training_dataset",
      input: {
        approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_fx&file=fx.wav",
        approvedSampleType: "tuned",
        approvedSourceJobId: "cvp_fx",
        baseSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
        tunedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_fx&file=fx.wav",
        tunedFxPreset: "robotic",
      },
    });
  });

  it("defines Applio training quality preset values with normal as default", () => {
    expect(DEFAULT_APPLIO_TRAINING_QUALITY_PRESET).toBe("normal");
    expect(APPLIO_TRAINING_QUALITY_PRESETS.fast).toMatchObject({ epochs: 25, saveEveryEpoch: 5 });
    expect(APPLIO_TRAINING_QUALITY_PRESETS.normal).toMatchObject({ epochs: 100, saveEveryEpoch: 10 });
    expect(APPLIO_TRAINING_QUALITY_PRESETS.quality).toMatchObject({ epochs: 200, saveEveryEpoch: 10 });
  });

  it("validates Applio training quality input for training jobs", () => {
    const base = {
      action: "start_applio_training",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
    };
    expect(createCharacterVoicePipelineJob("owner-a", { ...base, trainingQualityPreset: "fast", epochs: 25, saveEveryEpoch: 5 }).ok).toBe(true);
    expect(createCharacterVoicePipelineJob("owner-a", { ...base, trainingQualityPreset: "slow" })).toMatchObject({
      ok: false,
      error: "Invalid trainingQualityPreset. Expected fast, normal, or quality.",
    });
    expect(createCharacterVoicePipelineJob("owner-a", { ...base, epochs: 0 })).toMatchObject({
      ok: false,
      error: "epochs must be a positive integer.",
    });
    expect(createCharacterVoicePipelineJob("owner-a", { ...base, saveEveryEpoch: -1 })).toMatchObject({
      ok: false,
      error: "saveEveryEpoch must be a positive integer.",
    });
  });

  it("validates trained Applio voice playback jobs", () => {
    const base = {
      action: "test_trained_voice",
      characterId: "char-1",
      trainedModelPath: "C:/tmp/model.pth",
      trainedIndexPath: "C:/tmp/model.index",
      inputAudioPath: "C:/tmp/input.wav",
      trainedArtifactMock: false,
      trainedAdapter: "applio_real_training",
    };
    expect(createCharacterVoicePipelineJob("owner-a", base).ok).toBe(true);
    expect(createCharacterVoicePipelineJob("owner-a", { ...base, trainedModelPath: "" })).toMatchObject({
      ok: false,
      error: "Missing trainedModelPath for test_trained_voice.",
    });
    expect(createCharacterVoicePipelineJob("owner-a", { ...base, trainedIndexPath: "" })).toMatchObject({
      ok: false,
      error: "Missing trainedIndexPath for test_trained_voice.",
    });
    expect(createCharacterVoicePipelineJob("owner-a", { ...base, inputAudioPath: "" })).toMatchObject({
      ok: false,
      error: "Missing inputAudioPath for test_trained_voice.",
    });
    expect(createCharacterVoicePipelineJob("owner-a", { ...base, trainedArtifactMock: true })).toMatchObject({
      ok: false,
      error: "test_trained_voice requires a real trained artifact with mock:false.",
    });
  });

  it("validates Character Preview Dub jobs and stores the fixed hidden script", () => {
    const base = {
      action: "generate_character_preview",
      characterId: "char-1",
      sourceImagePath: "C:/AI/OTG-Test2/data/characters/owner-a/source.png",
      sourceImageUrl: "/api/characters/source/file?owner=owner-a&characterId=char-1",
      trainedModelPath: "C:/tmp/model.pth",
      trainedIndexPath: "C:/tmp/model.index",
      trainedArtifactMock: false,
      previewScript: "user should not control this script",
    };

    const created = createCharacterVoicePipelineJob("owner-a", base);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    expect(created.job.action).toBe("generate_character_preview");
    expect(created.job.status).toBe("queued");
    expect(created.job.input.previewScript).toBe(CHARACTER_PREVIEW_DUB_SCRIPT);

    expect(createCharacterVoicePipelineJob("owner-a", { ...base, sourceImagePath: "", sourceImageUrl: "" })).toMatchObject({
      ok: false,
      error: "Character source image is missing. Cannot generate preview.",
    });
    expect(createCharacterVoicePipelineJob("owner-a", { ...base, trainedModelPath: "" })).toMatchObject({
      ok: false,
      error: "Train the voice model before generating the character preview.",
    });
    expect(createCharacterVoicePipelineJob("owner-a", { ...base, trainedIndexPath: "" })).toMatchObject({
      ok: false,
      error: "Train the voice model before generating the character preview.",
    });
    expect(createCharacterVoicePipelineJob("owner-a", { ...base, trainedArtifactMock: true })).toMatchObject({
      ok: false,
      error: "Train the voice model before generating the character preview.",
    });
  });

  it("allows a Windows Character Preview worker to claim only queued preview dub jobs", () => {
    const preview = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_character_preview",
      characterId: "char-1",
      sourceImagePath: "C:/AI/OTG-Test2/data/characters/owner-a/source.png",
      trainedModelPath: "C:/tmp/model.pth",
      trainedIndexPath: "C:/tmp/model.index",
      trainedArtifactMock: false,
    });
    const dataset = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
    });
    expect(preview.ok).toBe(true);
    expect(dataset.ok).toBe(true);
    if (!preview.ok || !dataset.ok) throw new Error("jobs not created");

    const claimed = claimRemoteWorkerJobAcrossOwners(
      "windows-character-preview-worker",
      "character_voice_pipeline",
      "generate_character_preview",
    );
    expect(claimed).toMatchObject({
      jobId: preview.job.jobId,
      action: "generate_character_preview",
      status: "running",
      workerId: "windows-character-preview-worker",
    });

    const datasetStillQueued = getQueuedContractJob("owner-a", dataset.job.jobId);
    expect(datasetStillQueued?.status).toBe("queued");
  });

  it("requires a real nonzero dubbed preview video before completing Character Preview Dub", () => {
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_character_preview",
      characterId: "char-1",
      sourceImagePath: "C:/AI/OTG-Test2/data/characters/owner-a/source.png",
      trainedModelPath: "C:/tmp/model.pth",
      trainedIndexPath: "C:/tmp/model.index",
      trainedArtifactMock: false,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const invalid = completeRemoteWorkerJob("owner-a", created.job.jobId, {
      mock: false,
      dubbedPreviewVideoUrl: "/mock-assets/videos/cvp/final.mp4",
      outputBytes: 1000,
    });
    expect(invalid).toMatchObject({
      status: "failed",
      error: "Final dubbed preview video is missing or empty.",
    });

    const retry = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_character_preview",
      characterId: "char-2",
      sourceImagePath: "C:/AI/OTG-Test2/data/characters/owner-a/source.png",
      trainedModelPath: "C:/tmp/model.pth",
      trainedIndexPath: "C:/tmp/model.index",
      trainedArtifactMock: false,
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error(retry.error);

    const completed = completeRemoteWorkerJob("owner-a", retry.job.jobId, {
      mock: false,
      dubbedPreviewVideoPath: "C:/AI/OTG-Test2/data/characters/owner-a/character-preview/char-2/cvp/final.mp4",
      dubbedPreviewVideoUrl: "/api/characters/character-preview/file?owner=owner-a&characterId=char-2&jobId=cvp",
      outputBytes: 1000,
    });
    expect(completed).toMatchObject({
      status: "completed",
      result: {
        mock: false,
        outputBytes: 1000,
      },
    });
  });

  it("stops and resumes durable long-running Voice Lab training jobs", () => {
    const dataset = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
    });
    expect(dataset.ok).toBe(true);
    if (!dataset.ok) throw new Error(dataset.error);

    updateVoicePipelineJob("owner-a", dataset.job.jobId, {
      status: "running",
      progress: 42,
      result: { generatedClipCount: 84 },
    });

    const stopped = stopVoicePipelineJob("owner-a", dataset.job.jobId);
    expect(stopped).toMatchObject({
      status: "canceled",
      progress: 42,
      error: "Stopped by user.",
      result: {
        generatedClipCount: 84,
        stoppedByUser: true,
        resumeAvailable: true,
      },
    });

    const resumed = resumeVoicePipelineJob("owner-a", dataset.job.jobId);
    expect(resumed).toMatchObject({
      status: "queued",
      progress: 42,
      error: null,
      result: {
        generatedClipCount: 84,
        stoppedByUser: true,
        resumeAvailable: false,
      },
    });
  });

  it("terminates dataset jobs and only finalizes ready-for-review datasets", () => {
    const dataset = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
    });
    expect(dataset.ok).toBe(true);
    if (!dataset.ok) throw new Error(dataset.error);

    expect(finalizeTrainingDatasetJob("owner-a", dataset.job.jobId)).toBeNull();

    updateVoicePipelineJob("owner-a", dataset.job.jobId, {
      status: "ready_for_review",
      progress: 100,
      result: { generatedClipCount: 200, requestedClipCount: 200 },
    });

    const finalized = finalizeTrainingDatasetJob("owner-a", dataset.job.jobId, {
      manifestPath: "C:/tmp/manifest.json",
      manifestUrl: "/api/characters/training-dataset/manifest?owner=owner-a&characterId=char-1&jobId=cvp_test",
    });
    expect(finalized).toMatchObject({
      status: "completed",
      progress: 100,
      result: {
        generatedClipCount: 200,
        requestedClipCount: 200,
        manifestPath: "C:/tmp/manifest.json",
        status: "voice_pack_ready",
      },
    });

    const second = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-2",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-2&jobId=cvp_base",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.error);

    const terminated = terminateVoicePipelineJob("owner-a", second.job.jobId, { quarantinedDatasetPath: "C:/tmp/terminated/cvp_test" });
    expect(terminated).toMatchObject({
      status: "terminated",
      error: "Terminated by user.",
      result: {
        terminatedByUser: true,
        resumeAvailable: false,
        quarantinedDatasetPath: "C:/tmp/terminated/cvp_test",
      },
    });
  });

  it("preserves structured Qwen voice design input separately from the sample phrase", () => {
    const voiceDesign = defaultQwenVoiceDesignInput({
      voiceGender: "male",
      ageRange: "adult",
      structuredPitch: "low",
      vocalWeight: "deep",
      tone: "calm",
      speakingPace: "slow",
      accentLanguage: "American English",
      emotionBaseline: "confident",
      articulation: "clear_dialogue",
      extraNotes: "grounded film character, not a narrator",
    });
    const voiceInstruction = buildQwenBaseInstruction(voiceDesign);
    const sampleText = "Hello, this is a neutral sample phrase.";

    const result = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "qwen3",
      voiceInstruction,
      sampleText,
      previewText: sampleText,
      voiceDesign: structuredQwenVoiceDesign(voiceDesign),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.job.input).toMatchObject({
      voiceInstruction,
      sampleText,
      previewText: sampleText,
      voiceDesign: {
        voiceGender: "male",
        ageRange: "adult",
        pitch: "low",
        vocalWeight: "deep",
        tone: "calm",
        speakingPace: "slow",
        accentLanguage: "American English",
        emotionBaseline: "confident",
        articulation: "clear_dialogue",
      },
    });
    expect(result.job.input.voiceInstruction).not.toContain(sampleText);
  });

  it("builds explicit Qwen instructions with selected structured voice fields and avoid rules", () => {
    const male = defaultQwenVoiceDesignInput({
      voiceGender: "male",
      ageRange: "adult",
      structuredPitch: "low",
      vocalWeight: "deep",
      tone: "calm",
      speakingPace: "slow",
      accentLanguage: "American English",
      emotionBaseline: "confident",
      articulation: "clear_dialogue",
    });
    const maleInstruction = buildQwenBaseInstruction(male);
    expect(maleInstruction).toContain("adult male voice");
    expect(maleInstruction).toContain("low pitch");
    expect(maleInstruction).toContain("deep resonance");
    expect(maleInstruction).toContain("calm");
    expect(maleInstruction).toContain("slow speaking pace");
    expect(maleInstruction).toContain("American English");
    expect(maleInstruction).toContain("confident emotional baseline");
    expect(maleInstruction).toContain("clear dialogue articulation");
    expect(maleInstruction).toContain("female timbre");
    expect(maleInstruction).toContain("feminine pitch");

    const female = defaultQwenVoiceDesignInput({
      voiceGender: "female",
      ageRange: "senior",
      structuredPitch: "high",
      vocalWeight: "light",
      tone: "warm",
      speakingPace: "slow",
      accentLanguage: "British English",
      emotionBaseline: "neutral",
      articulation: "theatrical",
    });
    const femaleInstruction = buildQwenBaseInstruction(female);
    expect(femaleInstruction).toContain("senior female voice");
    expect(femaleInstruction).toContain("warm");
    expect(femaleInstruction).toContain("male timbre");
    expect(femaleInstruction).toContain("masculine bass");
    expect(femaleInstruction).toContain("childlike voice");
  });

  it("builds model-specific Qwen3-TTS voice design payloads from structured controls", () => {
    const profile = defaultVoiceDesignProfile({
      model: "qwen3tts",
      mode: "voice_design",
      speakerIdentity: "man",
      ageRange: "adult",
      genderPresentation: "male",
      language: "English",
      accentDialectId: "british_english_received_pronunciation",
      tone: "calm",
      pace: "slow",
      pitch: "low",
      energy: "medium",
      timbre: "deep",
      deliveryStyle: "documentary narrator",
      sampleText: "This is a neutral test phrase.",
    });

    const payload = buildVoiceRequestPayload(profile);

    expect(payload).toMatchObject({
      model: "qwen3-tts",
      mode: "voice_design",
      language: "English",
      speaker: null,
      text: "This is a neutral test phrase.",
    });
    expect(payload.instruct).toContain("adult male speaker voice");
    expect(payload.instruct).toContain("British English / Received Pronunciation");
    expect(payload.instruct).toContain("deep timbre");
    expect(payload.instruct).toContain("low pitch");
    expect(payload.instruct).toContain("calm tone");
    expect(payload.instruct).toContain("slow pace");
    expect(payload.instruct).toContain("documentary narrator delivery");
    expect(payload.instruct).toContain("female timbre");
    expect(payload.instruct).toContain("feminine pitch");
    expect(payload.instruct).not.toContain(payload.text);
  });

  it("builds Qwen3-TTS CustomVoice payloads with official preset speakers", () => {
    const profile = defaultVoiceDesignProfile({
      model: "qwen3tts",
      mode: "custom_voice",
      qwenPresetSpeaker: "Eric",
      tone: "energetic",
      pace: "fast",
      deliveryStyle: "dialogue",
    });

    const payload = buildVoiceRequestPayload(profile);

    expect(payload).toMatchObject({
      model: "qwen3-tts",
      mode: "custom_voice",
      language: "Chinese",
      speaker: "Eric",
    });
    expect(payload.instruct).toContain("Chengdu/Sichuan");
    expect(payload.instruct).toContain("energetic tone");
    expect(payload.accentDialect?.kind).toBe("preset_speaker");
  });

  it("builds CosyVoice Chinese dialect prompts with the documented instruction format", () => {
    const profile = defaultVoiceDesignProfile({
      model: "cosyvoice",
      mode: "instruct",
      modelVersion: "cosyvoice3",
      language: "Chinese",
      accentDialectId: "sichuan",
      ageRange: "adult",
      genderPresentation: "male",
      tone: "friendly",
      pace: "medium",
      timbre: "clear",
      deliveryStyle: "dialogue",
      sampleText: "你好，这是一个测试。",
    });

    const prompt = buildCosyVoiceInstructionPrompt(profile);
    const payload = buildVoiceRequestPayload(profile);

    expect(prompt).toContain("You are a helpful assistant.");
    expect(prompt).toContain("请用四川话表达。");
    expect(prompt).toContain("<|endofprompt|>");
    expect(payload).toMatchObject({
      model: "cosyvoice3",
      mode: "instruct",
      language: "Chinese",
      text: "你好，这是一个测试。",
      prompt,
    });
  });

  it("flags prompt-based accent guidance without treating it as an official dialect", () => {
    const profile = defaultVoiceDesignProfile({
      model: "cosyvoice",
      language: "English",
      accentDialectId: "irish_english",
      extraNotes: "make the voice female even though male is selected",
      genderPresentation: "male",
    });

    const payload = buildVoiceRequestPayload(profile);
    const warnings = voiceDesignWarnings(profile);

    expect(payload.accentDialect?.kind).toBe("prompt_based");
    expect(payload.prompt).toContain("Best results require matching reference audio.");
    expect(warnings).toContain("This accent is prompt-guided. For best accuracy, use a matching reference voice.");
    expect(warnings).toContain("Extra notes mention female/feminine terms while Male is selected.");
  });

  it("supersedes older pending create_voice_sample jobs for the same owner and character", () => {
    const first = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "qwen3",
    });
    const second = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "cosy",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("Expected queued jobs.");

    expect(getQueuedContractJob("owner-a", first.job.jobId)).toMatchObject({
      status: "canceled",
      progress: 100,
      message: "Superseded by newer Create Voice request.",
    });
    expect(getQueuedContractJob("owner-a", second.job.jobId)).toMatchObject({
      status: "queued",
      action: "create_voice_sample",
    });
  });

  it("does not supersede completed create_voice_sample jobs", () => {
    const first = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "qwen3",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("Expected queued job.");

    updateVoicePipelineJob("owner-a", first.job.jobId, {
      status: "completed",
      result: { sampleUrl: "/mock-assets/voices/first/sample.wav" },
    });

    const second = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "cosy",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("Expected queued job.");

    expect(getQueuedContractJob("owner-a", first.job.jobId)?.status).toBe("completed");
    expect(getQueuedContractJob("owner-a", second.job.jobId)?.status).toBe("queued");
  });

  it("does not supersede create_voice_sample jobs for other characters", () => {
    const otherCharacter = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-2",
      provider: "qwen3",
    });
    const targetCharacter = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "cosy",
    });
    expect(otherCharacter.ok).toBe(true);
    expect(targetCharacter.ok).toBe(true);
    if (!otherCharacter.ok || !targetCharacter.ok) throw new Error("Expected queued jobs.");

    expect(getQueuedContractJob("owner-a", otherCharacter.job.jobId)?.status).toBe("queued");
    expect(getQueuedContractJob("owner-a", targetCharacter.job.jobId)?.status).toBe("queued");
  });

  it("does not supersede non-create voice jobs for the same character", () => {
    const fx = createCharacterVoicePipelineJob("owner-a", {
      action: "apply_voice_fx",
      characterId: "char-1",
      fxPreset: "robotic",
    });
    const sample = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "qwen3",
    });
    expect(fx.ok).toBe(true);
    expect(sample.ok).toBe(true);
    if (!fx.ok || !sample.ok) throw new Error("Expected queued jobs.");

    expect(getQueuedContractJob("owner-a", fx.job.jobId)?.status).toBe("queued");
    expect(getQueuedContractJob("owner-a", sample.job.jobId)?.status).toBe("queued");
  });

  it("can explicitly supersede queued or running create voice jobs except the active job", () => {
    const first = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "qwen3",
    });
    const active = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "cosy",
    });
    expect(first.ok).toBe(true);
    expect(active.ok).toBe(true);
    if (!first.ok || !active.ok) throw new Error("Expected queued jobs.");

    const superseded = supersedePendingCreateVoiceJobs("owner-a", "char-1", active.job.jobId);
    expect(superseded).toEqual([]);
    expect(getQueuedContractJob("owner-a", active.job.jobId)?.status).toBe("queued");
  });

  it("queues and validates production audio-studio jobs", () => {
    const result = createProductionAudioStudioJob("owner-a", {
      action: "add_voice_to_clip",
      clipId: "clip-1",
      characterId: "char-1",
      provider: "cosy",
      fxPreset: "ghost",
      text: "Stay close.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.job).toMatchObject({
      jobType: "production_audio_studio",
      action: "add_voice_to_clip",
      status: "queued",
      characterId: "char-1",
      clipId: "clip-1",
      result: null,
      error: null,
    });
    expect(result.job.jobId).toMatch(/^pas_/);

    expect(createProductionAudioStudioJob("owner-a", { action: "dub_existing_voice" })).toMatchObject({
      ok: false,
      error: "Missing clipId.",
    });
    expect(createProductionAudioStudioJob("owner-a", { action: "add_voice_to_clip", clipId: "clip-1", fxPreset: "bad" })).toMatchObject({
      ok: false,
      error: "Invalid voice FX preset.",
    });
  });

  it("queues character animation preview jobs for the Windows worker", () => {
    const result = createCharacterAnimationPreviewJob("owner-a", {
      characterId: "char-1",
      imagePath: "C:/AI/OTG-Test2/data/characters/owner-a/char-1/full-body.png",
      referenceWav: "C:/AI/OTG-Test2/data/characters/owner-a/char-1/source.wav",
      positivePrompt: "cinematic character animation preview",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.job).toMatchObject({
      jobType: "character_animation_preview",
      action: "animate_preview",
      status: "queued",
      characterId: "char-1",
      clipId: null,
      input: {
        action: "animate_preview",
        characterId: "char-1",
        imagePath: "C:/AI/OTG-Test2/data/characters/owner-a/char-1/full-body.png",
        referenceWav: "C:/AI/OTG-Test2/data/characters/owner-a/char-1/source.wav",
        positivePrompt: "cinematic character animation preview",
      },
    });
    expect(result.job.jobId).toMatch(/^cap_/);
    expect(getQueuedContractJob("owner-a", result.job.jobId)).toEqual(result.job);

    expect(createCharacterAnimationPreviewJob("owner-a", { imagePath: "C:/tmp/a.png" })).toMatchObject({
      ok: false,
      error: "Missing characterId.",
    });
    expect(createCharacterAnimationPreviewJob("owner-a", { characterId: "char-1" })).toMatchObject({
      ok: false,
      error: "Missing imagePath.",
    });
  });

  it("defines worker-only job routes for the Windows execution machine", () => {
    expect(normalizeOtgWorkerJobType("character_voice_pipeline")).toBe("character_voice_pipeline");
    expect(normalizeOtgWorkerJobType("bad")).toBeNull();
    expect(normalizeOtgWorkerAction("character_voice_pipeline", "generate_training_dataset")).toBe("generate_training_dataset");
    expect(normalizeOtgWorkerAction("production_audio_studio", "render_audio_mix")).toBe("render_audio_mix");
    expect(normalizeOtgWorkerAction("character_animation_preview", "animate_preview")).toBe("animate_preview");
    expect(normalizeOtgWorkerAction("production_audio_studio", "generate_training_dataset")).toBeNull();
    expect(normalizeOtgWorkerAction("character_animation_preview", "generate_training_dataset")).toBeNull();
    expect(isOtgWorkerOnlyJob("character_voice_pipeline", "generate_training_dataset")).toBe(true);
    expect(isOtgWorkerOnlyJob("character_animation_preview", "animate_preview")).toBe(true);
    expect(getOtgWorkerJobRoute("character_voice_pipeline", "generate_training_dataset")).toMatchObject({
      adapterHint: "windows.indextts2_dataset",
      workerOnly: true,
    });
    expect(getOtgWorkerJobRoute("character_voice_pipeline", "create_voice_sample")).toMatchObject({
      adapterHint: "windows.voice_design",
      workerOnly: true,
    });
    expect(getOtgWorkerJobRoute("character_animation_preview", "animate_preview")).toMatchObject({
      adapterHint: "windows.character_animate_preview",
      workerOnly: true,
    });
    expect(OTG_WORKER_ONLY_FEATURE_AREAS).toContain("training_dataset_generation");
    expect(OTG_WORKER_ONLY_FEATURE_AREAS).toContain("video_generation");
  });

  it("claims, completes, and fails jobs through the generic worker contract", () => {
    const production = createProductionAudioStudioJob("owner-a", {
      action: "render_audio_mix",
      clipId: "clip-1",
    });
    expect(production.ok).toBe(true);
    if (!production.ok) throw new Error(production.error);

    const claimed = claimRemoteWorkerJob("owner-a", "windows-main-pc", "production_audio_studio", "render_audio_mix");
    expect(claimed).toMatchObject({
      jobId: production.job.jobId,
      status: "running",
      message: "Claimed by remote Windows OTG worker: windows-main-pc.",
      result: {
        remoteWorker: true,
        workerId: "windows-main-pc",
        jobType: "production_audio_studio",
        action: "render_audio_mix",
        status: "claimed",
      },
    });

    const completed = completeRemoteWorkerJob("owner-a", production.job.jobId, { finalClipUrl: "/worker/final.mp4" }, "Done on Windows.");
    expect(completed).toMatchObject({
      status: "completed",
      progress: 100,
      message: "Done on Windows.",
      result: { finalClipUrl: "/worker/final.mp4" },
    });

    const character = createCharacterVoicePipelineJob("owner-a", {
      action: "apply_voice_fx",
      characterId: "char-1",
      fxPreset: "robotic",
    });
    expect(character.ok).toBe(true);
    if (!character.ok) throw new Error(character.error);

    const failed = failRemoteWorkerJob("owner-a", character.job.jobId, "Windows worker stopped.", { failedStage: "voice_fx" });
    expect(failed).toMatchObject({
      status: "failed",
      progress: 100,
      error: "Windows worker stopped.",
      result: { failedStage: "voice_fx" },
    });
  });

  it("lets a dedicated dataset worker claim only generate_training_dataset and checkpoint progress", () => {
    const production = createProductionAudioStudioJob("owner-a", {
      action: "render_audio_mix",
      clipId: "clip-1",
    });
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
      requestedClipCount: 200,
    });
    expect(production.ok).toBe(true);
    expect(training.ok).toBe(true);
    if (!production.ok || !training.ok) throw new Error("Expected queued jobs.");
    expect(training.job).toMatchObject({
      status: "queued",
      progress: 0,
      workerId: null,
      claimedAt: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
    });

    const claimed = claimRemoteVoicePipelineWorkerJob("owner-a", "windows-voice-dataset-worker", "generate_training_dataset");
    expect(claimed).toMatchObject({
      jobId: training.job.jobId,
      jobType: "character_voice_pipeline",
      action: "generate_training_dataset",
      status: "running",
      result: {
        remoteWorker: true,
        workerId: "windows-voice-dataset-worker",
        jobType: "character_voice_pipeline",
        action: "generate_training_dataset",
      },
    });
    expect(getQueuedContractJob("owner-a", production.job.jobId)?.status).toBe("queued");

    const checkpointed = checkpointRemoteWorkerJob(
      "owner-a",
      training.job.jobId,
      {
        adapter: "dataset_manifest",
        provider: "indextts2",
        generatedClipCount: 80,
        requestedClipCount: 200,
        status: "manifest_ready",
      },
      40,
      "Generated 80 / 200 clips on the Windows IndexTTS2 dataset worker.",
    );

    expect(checkpointed).toMatchObject({
      status: "running",
      progress: 40,
      message: "Generated 80 / 200 clips on the Windows IndexTTS2 dataset worker.",
      result: {
        remoteWorker: true,
        workerId: "windows-voice-dataset-worker",
        adapter: "dataset_manifest",
        provider: "indextts2",
        generatedClipCount: 80,
        requestedClipCount: 200,
      },
    });
  });

  it("normalizes unclaimed running dataset jobs with zero clips back to queued", () => {
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
      requestedClipCount: 200,
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error("Expected queued job.");

    updateVoicePipelineJob("owner-a", training.job.jobId, {
      status: "running",
      progress: 70,
      workerId: null,
      claimedAt: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      result: {
        generatedClipCount: 0,
        requestedClipCount: 200,
      },
    });

    expect(getQueuedContractJob("owner-a", training.job.jobId)).toMatchObject({
      status: "queued",
      progress: 0,
      workerId: null,
      claimedAt: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      result: {
        generatedClipCount: 0,
        requestedClipCount: 200,
        status: "queued",
      },
    });

    const claimed = claimRemoteWorkerJobAcrossOwners("windows-voice-dataset-worker", "character_voice_pipeline", "generate_training_dataset");
    expect(claimed).toMatchObject({
      jobId: training.job.jobId,
      status: "running",
      workerId: "windows-voice-dataset-worker",
      claimedAt: expect.any(String),
      heartbeatAt: expect.any(String),
      leaseExpiresAt: expect.any(String),
    });
  });

  it("normalizes unclaimed running dataset jobs with existing clips to interrupted", () => {
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
      requestedClipCount: 200,
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error("Expected queued job.");

    updateVoicePipelineJob("owner-a", training.job.jobId, {
      status: "running",
      progress: 70,
      workerId: null,
      claimedAt: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      result: {
        generatedClipCount: 10,
        requestedClipCount: 200,
      },
    });

    expect(getQueuedContractJob("owner-a", training.job.jobId)).toMatchObject({
      status: "interrupted",
      workerId: null,
      claimedAt: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      result: {
        generatedClipCount: 10,
        requestedClipCount: 200,
        resumeAvailable: true,
      },
    });
    expect(claimRemoteWorkerJobAcrossOwners("windows-voice-dataset-worker", "character_voice_pipeline", "generate_training_dataset")).toBeNull();
  });

  it("does not reclaim an active dataset job with a fresh heartbeat", () => {
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
      requestedClipCount: 200,
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error("Expected queued job.");

    const claimed = claimRemoteVoicePipelineWorkerJob("owner-a", "windows-voice-dataset-worker", "generate_training_dataset");
    expect(claimed).toMatchObject({
      status: "running",
      workerId: "windows-voice-dataset-worker",
      result: {
        workerId: "windows-voice-dataset-worker",
        status: "claimed",
      },
    });
    expect(claimed?.heartbeatAt).toBeTruthy();
    expect(claimed?.leaseExpiresAt).toBeTruthy();
    expect(isVoicePipelineJobLeaseStale(claimed!)).toBe(false);

    expect(claimRemoteWorkerJobAcrossOwners("second-worker", "character_voice_pipeline", "generate_training_dataset")).toBeNull();
  });

  it("marks stale running dataset jobs interrupted but does not reclaim without an explicit resume", () => {
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
      requestedClipCount: 200,
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error("Expected queued job.");

    const claimed = claimRemoteVoicePipelineWorkerJob("owner-a", "windows-voice-dataset-worker", "generate_training_dataset");
    expect(claimed?.status).toBe("running");
    const past = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    updateVoicePipelineJob("owner-a", training.job.jobId, {
      status: "running",
      progress: 5,
      workerId: "windows-voice-dataset-worker",
      heartbeatAt: past,
      leaseExpiresAt: past,
      result: {
        generatedClipCount: 10,
        requestedClipCount: 200,
        status: "manifest_ready",
      },
    });

    const stale = getQueuedContractJob("owner-a", training.job.jobId);
    expect(stale).toMatchObject({
      status: "interrupted",
      progress: 5,
      result: {
        generatedClipCount: 10,
        requestedClipCount: 200,
        resumeAvailable: true,
      },
    });

    expect(claimRemoteWorkerJobAcrossOwners("windows-voice-dataset-worker-2", "character_voice_pipeline", "generate_training_dataset")).toBeNull();

    const resumed = resumeVoicePipelineJob("owner-a", training.job.jobId);
    expect(resumed).toMatchObject({
      status: "queued",
      resumeRequestedAt: expect.any(String),
      resumeRequestedBy: "owner-a",
      result: {
        generatedClipCount: 10,
        requestedClipCount: 200,
        resumeRequestedAt: expect.any(String),
      },
    });

    const reclaimed = claimRemoteWorkerJobAcrossOwners("windows-voice-dataset-worker-2", "character_voice_pipeline", "generate_training_dataset");
    expect(reclaimed).toMatchObject({
      jobId: training.job.jobId,
      ownerKey: "owner-a",
      status: "running",
      progress: 5,
      attempt: 2,
      resumeRequestedAt: null,
      result: {
        generatedClipCount: 10,
        requestedClipCount: 200,
        workerId: "windows-voice-dataset-worker-2",
        status: "claimed",
      },
    });
  });

  it("resumes interrupted dataset jobs while preserving generated clip progress", () => {
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
      requestedClipCount: 200,
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error("Expected queued job.");

    updateVoicePipelineJob("owner-a", training.job.jobId, {
      status: "interrupted",
      progress: 41,
      result: {
        generatedClipCount: 82,
        requestedClipCount: 200,
        resumeAvailable: true,
      },
    });

    const resumed = resumeVoicePipelineJob("owner-a", training.job.jobId);
    expect(resumed).toMatchObject({
      status: "queued",
      progress: 41,
      resumeCount: 1,
      resumeRequestedAt: expect.any(String),
      resumeRequestedBy: "owner-a",
      result: {
        generatedClipCount: 82,
        requestedClipCount: 200,
        resumeRequestedAt: expect.any(String),
        resumeAvailable: false,
      },
    });
  });

  it("claims newest queued dataset job before older interrupted jobs", () => {
    const oldInterrupted = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "old-char",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=old-char&jobId=cvp_base",
      requestedClipCount: 200,
    });
    expect(oldInterrupted.ok).toBe(true);
    if (!oldInterrupted.ok) throw new Error("Expected queued job.");
    updateVoicePipelineJob("owner-a", oldInterrupted.job.jobId, {
      status: "interrupted",
      progress: 25,
      interruptedAt: "2026-06-02T12:00:00.000Z",
      resumeRequestedAt: "2026-06-02T12:05:00.000Z",
      result: {
        generatedClipCount: 50,
        requestedClipCount: 200,
        resumeAvailable: true,
      },
    });

    const newestQueued = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "current-char",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=current-char&jobId=cvp_base",
      requestedClipCount: 200,
    });
    expect(newestQueued.ok).toBe(true);
    if (!newestQueued.ok) throw new Error("Expected queued job.");

    const claimed = claimRemoteWorkerJobAcrossOwners("windows-voice-dataset-worker", "character_voice_pipeline", "generate_training_dataset");
    expect(claimed).toMatchObject({
      jobId: newestQueued.job.jobId,
      characterId: "current-char",
      status: "running",
    });
  });

  it("does not let older plain interrupted jobs block the current queued dataset job", () => {
    const older = createCharacterVoicePipelineJob("owner-old", {
      action: "generate_training_dataset",
      characterId: "old-char",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-old&characterId=old-char&jobId=cvp_base",
      requestedClipCount: 200,
    });
    const current = createCharacterVoicePipelineJob("owner-current", {
      action: "generate_training_dataset",
      characterId: "current-char",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-current&characterId=current-char&jobId=cvp_base",
      requestedClipCount: 200,
    });
    expect(older.ok).toBe(true);
    expect(current.ok).toBe(true);
    if (!older.ok || !current.ok) throw new Error("Expected queued jobs.");

    updateVoicePipelineJob("owner-old", older.job.jobId, {
      status: "interrupted",
      progress: 10,
      interruptedAt: new Date().toISOString(),
      result: {
        generatedClipCount: 20,
        requestedClipCount: 200,
        resumeAvailable: true,
      },
    });

    const claimed = claimRemoteWorkerJobAcrossOwners("windows-voice-dataset-worker", "character_voice_pipeline", "generate_training_dataset");
    expect(claimed).toMatchObject({
      jobId: current.job.jobId,
      ownerKey: "owner-current",
      characterId: "current-char",
    });
    expect(getQueuedContractJob("owner-old", older.job.jobId)).toMatchObject({
      status: "interrupted",
      result: {
        resumeAvailable: true,
      },
    });
  });

  it("supersedes active dataset sessions for the same character when a new dataset is queued", () => {
    const first = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
      requestedClipCount: 200,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("Expected queued job.");

    const second = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base_2",
      requestedClipCount: 200,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("Expected queued job.");

    expect(getQueuedContractJob("owner-a", first.job.jobId)).toMatchObject({
      status: "canceled",
      result: {
        supersededByJobId: second.job.jobId,
        resumeAvailable: false,
      },
    });
    const claimed = claimRemoteWorkerJobAcrossOwners("windows-voice-dataset-worker", "character_voice_pipeline", "generate_training_dataset");
    expect(claimed?.jobId).toBe(second.job.jobId);
  });

  it("does not reclaim completed, ready-for-review, or terminated dataset jobs", () => {
    const baseInput = {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
      requestedClipCount: 200,
    };
    const completed = createCharacterVoicePipelineJob("owner-a", baseInput);
    const review = createCharacterVoicePipelineJob("owner-a", { ...baseInput, characterId: "char-2" });
    const terminated = createCharacterVoicePipelineJob("owner-a", { ...baseInput, characterId: "char-3" });
    expect(completed.ok).toBe(true);
    expect(review.ok).toBe(true);
    expect(terminated.ok).toBe(true);
    if (!completed.ok || !review.ok || !terminated.ok) throw new Error("Expected queued jobs.");

    updateVoicePipelineJob("owner-a", completed.job.jobId, { status: "completed", progress: 100 });
    updateVoicePipelineJob("owner-a", review.job.jobId, { status: "ready_for_review", progress: 100 });
    terminateVoicePipelineJob("owner-a", terminated.job.jobId);

    expect(claimRemoteWorkerJobAcrossOwners("windows-voice-dataset-worker", "character_voice_pipeline", "generate_training_dataset")).toBeNull();
  });

  it("uses the same stale lease pattern for Applio model training jobs", () => {
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
      trainingQualityPreset: "normal",
      epochs: 100,
      saveEveryEpoch: 10,
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error("Expected queued job.");

    const claimed = claimRemoteWorkerJobAcrossOwners("windows-applio-worker", "character_voice_pipeline", "start_applio_training");
    expect(claimed).toMatchObject({ status: "running", action: "start_applio_training" });
    const past = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    updateVoicePipelineJob("owner-a", training.job.jobId, {
      status: "running",
      heartbeatAt: past,
      leaseExpiresAt: past,
      result: { currentStage: "train", epochs: 100 },
    });

    expect(getQueuedContractJob("owner-a", training.job.jobId)).toMatchObject({
      status: "interrupted",
      result: { currentStage: "train", resumeAvailable: true },
    });
    expect(resumeVoicePipelineJob("owner-a", training.job.jobId)).toMatchObject({
      status: "queued",
      resumeCount: 1,
    });
  });

  it("claims dataset jobs across owners without requiring the worker to be owner-scoped", () => {
    const userA = createCharacterVoicePipelineJob("user-a", {
      action: "generate_training_dataset",
      characterId: "char-a",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=user-a&characterId=char-a&jobId=cvp_base",
    });
    const userB = createCharacterVoicePipelineJob("user-b", {
      action: "generate_training_dataset",
      characterId: "char-b",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=user-b&characterId=char-b&jobId=cvp_base",
    });
    expect(userA.ok).toBe(true);
    expect(userB.ok).toBe(true);
    if (!userA.ok || !userB.ok) throw new Error("Expected queued jobs.");

    const first = claimRemoteWorkerJobAcrossOwners("windows-voice-dataset-worker", "character_voice_pipeline", "generate_training_dataset");
    const second = claimRemoteWorkerJobAcrossOwners("windows-voice-dataset-worker", "character_voice_pipeline", "generate_training_dataset");

    expect([first?.ownerKey, second?.ownerKey].sort()).toEqual(["user-a", "user-b"]);
    for (const claimed of [first, second]) {
      expect(claimed).toMatchObject({
        action: "generate_training_dataset",
        status: "running",
        result: { ownerKey: claimed?.ownerKey },
      });
    }
  });

  it("lets a dedicated voice design worker claim create_voice_sample across owners without owner scoping", () => {
    const dataset = createCharacterVoicePipelineJob("user-a", {
      action: "generate_training_dataset",
      characterId: "char-a",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=user-a&characterId=char-a&jobId=cvp_base",
    });
    const sample = createCharacterVoicePipelineJob("user-b", {
      action: "create_voice_sample",
      characterId: "char-b",
      provider: "qwen3",
      voiceInstruction: "An adult male character voice.",
      sampleText: "This is a voice design sample.",
    });
    expect(dataset.ok).toBe(true);
    expect(sample.ok).toBe(true);
    if (!dataset.ok || !sample.ok) throw new Error("Expected queued jobs.");

    const claimed = claimRemoteWorkerJobAcrossOwners("windows-voice-design-worker", "character_voice_pipeline", "create_voice_sample");

    expect(claimed).toMatchObject({
      ownerKey: "user-b",
      jobType: "character_voice_pipeline",
      action: "create_voice_sample",
      status: "running",
      result: {
        remoteWorker: true,
        workerId: "windows-voice-design-worker",
        ownerKey: "user-b",
      },
    });
    expect(getQueuedContractJob("user-a", dataset.job.jobId)?.status).toBe("queued");
  });

  it("does not let the voice design worker claim dataset, production, animation, or Applio jobs", () => {
    const dataset = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
    });
    const production = createProductionAudioStudioJob("owner-a", {
      action: "render_audio_mix",
      clipId: "clip-1",
    });
    const animation = createCharacterAnimationPreviewJob("owner-a", {
      characterId: "char-1",
      imagePath: "C:/tmp/char.png",
    });
    const applio = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
    });
    expect(dataset.ok).toBe(true);
    expect(production.ok).toBe(true);
    expect(animation.ok).toBe(true);
    expect(applio.ok).toBe(true);

    expect(claimRemoteWorkerJobAcrossOwners("windows-voice-design-worker", "character_voice_pipeline", "create_voice_sample")).toBeNull();
    if (dataset.ok) expect(getQueuedContractJob("owner-a", dataset.job.jobId)?.status).toBe("queued");
    if (production.ok) expect(getQueuedContractJob("owner-a", production.job.jobId)?.status).toBe("queued");
    if (animation.ok) expect(getQueuedContractJob("owner-a", animation.job.jobId)?.status).toBe("queued");
    if (applio.ok) expect(getQueuedContractJob("owner-a", applio.job.jobId)?.status).toBe("queued");
  });

  it("preserves real voice design sample completion fields", () => {
    const sample = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "qwen3",
    });
    expect(sample.ok).toBe(true);
    if (!sample.ok) throw new Error("Expected queued job.");

    const completed = completeRemoteWorkerJob(
      "owner-a",
      sample.job.jobId,
      {
        mock: false,
        provider: "qwen3",
        adapter: "qwen3_real_voice_sample",
        samplePath: "C:/AI/OTG-Test2/data/characters/owner-a/voice-samples/char-1/cvp_test/sample.wav",
        sampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_test&file=sample.wav",
        stdoutPath: "C:/AI/OTG-Worker/voice-design/cvp_test/logs/qwen3-stdout.log",
        stderrPath: "C:/AI/OTG-Worker/voice-design/cvp_test/logs/qwen3-stderr.log",
      },
      "Remote Windows voice design sample completed.",
    );

    expect(completed).toMatchObject({
      status: "completed",
      progress: 100,
      result: {
        mock: false,
        provider: "qwen3",
        adapter: "qwen3_real_voice_sample",
        sampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_test&file=sample.wav",
      },
    });
  });

  it("does not let the universal dataset worker claim production, animation, or Applio jobs", () => {
    const production = createProductionAudioStudioJob("owner-a", {
      action: "render_audio_mix",
      clipId: "clip-1",
    });
    const animation = createCharacterAnimationPreviewJob("owner-a", {
      characterId: "char-1",
      imagePath: "C:/tmp/char.png",
    });
    const applio = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
    });
    expect(production.ok).toBe(true);
    expect(animation.ok).toBe(true);
    expect(applio.ok).toBe(true);

    expect(claimRemoteWorkerJobAcrossOwners("windows-voice-dataset-worker", "character_voice_pipeline", "generate_training_dataset")).toBeNull();
    if (production.ok) expect(getQueuedContractJob("owner-a", production.job.jobId)?.status).toBe("queued");
    if (animation.ok) expect(getQueuedContractJob("owner-a", animation.job.jobId)?.status).toBe("queued");
    if (applio.ok) expect(getQueuedContractJob("owner-a", applio.job.jobId)?.status).toBe("queued");
  });

  it("lists and retrieves jobs from the persisted store", () => {
    const first = createCharacterVoicePipelineJob("owner-a", {
      action: "test_character_voice",
      characterId: "char-1",
      text: "Testing.",
    });
    const second = createProductionAudioStudioJob("owner-a", {
      action: "render_audio_mix",
      clipId: "clip-1",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("Expected queued jobs.");

    const listed = listVoicePipelineJobs("owner-a");
    expect(listed.map((job) => job.jobId).sort()).toEqual([first.job.jobId, second.job.jobId].sort());
    expect(getQueuedContractJob("owner-a", second.job.jobId)).toEqual(second.job);
    expect(getQueuedContractJob("owner-a", "missing")).toBeNull();
  });

  it("updates status, progress, updatedAt, result, and error durably", () => {
    const result = createProductionAudioStudioJob("owner-a", {
      action: "dub_existing_voice",
      clipId: "clip-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    const updated = updateVoicePipelineJob("owner-a", result.job.jobId, {
      status: "running",
      progress: 42,
      message: "No-op worker checkpoint.",
    });
    expect(updated).toMatchObject({
      jobId: result.job.jobId,
      status: "running",
      progress: 42,
      message: "No-op worker checkpoint.",
    });
    expect(updated?.updatedAt).not.toBe(result.job.updatedAt);

    const completed = updateVoicePipelineJob("owner-a", result.job.jobId, {
      status: "completed",
      result: { previewUrl: "/local/noop.mp4" },
    });
    expect(completed).toMatchObject({
      status: "completed",
      progress: 100,
      result: { previewUrl: "/local/noop.mp4" },
    });

    const failed = updateVoicePipelineJob("owner-a", result.job.jobId, {
      status: "failed",
      error: "No-op failure.",
      progress: 10,
    });
    expect(failed).toMatchObject({
      status: "failed",
      error: "No-op failure.",
      progress: 10,
    });
    expect(updateVoicePipelineJob("owner-b", result.job.jobId, { status: "canceled" })).toBeNull();
  });

  it("handles missing and corrupt store files safely", () => {
    expect(listVoicePipelineJobs("owner-a")).toEqual([]);

    fs.mkdirSync(path.dirname(getVoicePipelineJobStorePath()), { recursive: true });
    fs.writeFileSync(getVoicePipelineJobStorePath(), "{not-json", "utf8");

    expect(getQueuedContractJob("owner-a", "missing")).toBeNull();
    const result = createCharacterVoicePipelineJob("owner-a", {
      action: "save_voice_to_character",
      characterId: "char-1",
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(getVoicePipelineJobStorePath(), "utf8")).jobs).toHaveLength(1);
  });

  it("returns a 404 JSON response for a missing character voice pipeline job", async () => {
    process.env.AUTH_SECRET ||= "test-secret-for-voice-pipeline-route";
    const { GET: getCharacterVoicePipelineJobRoute } = await import("@/app/api/characters/voice-pipeline/[jobId]/route");
    const request = new NextRequest("http://localhost/api/characters/voice-pipeline/missing", {
      headers: { "x-otg-device-id": "owner-a" },
    });
    const response = await getCharacterVoicePipelineJobRoute(request, { params: Promise.resolve({ jobId: "missing" }) });
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json).toMatchObject({ ok: false, error: "Job not found." });
  });

  it("releases a zero-clip dataset job accidentally leased by the local dev worker", () => {
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-local-zero",
      trainingPreset: "balanced",
      requestedClipCount: 200,
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-local-zero&jobId=cvp_base",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("Expected queued job.");
    const now = new Date();
    updateVoicePipelineJob("owner-a", created.job.jobId, {
      status: "running",
      progress: 0,
      workerId: "local-voice-pipeline-worker",
      claimedAt: now.toISOString(),
      heartbeatAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + 300_000).toISOString(),
      message: "Generated 0 / 200 clips. Provider: indextts2.",
      result: { generatedClipCount: 0, requestedClipCount: 200 },
    });

    expect(getQueuedContractJob("owner-a", created.job.jobId)).toMatchObject({
      status: "queued",
      progress: 0,
      workerId: null,
      claimedAt: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      message: "Dataset job was released from the local development worker. Waiting for the Linux IndexTTS2 dataset worker.",
      result: {
        releasedFromWorkerId: "local-voice-pipeline-worker",
        generatedClipCount: 0,
        requestedClipCount: 200,
      },
    });
  });

  it("releases a partial dataset job accidentally leased by the local dev worker as resumable", () => {
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-local-partial",
      trainingPreset: "balanced",
      requestedClipCount: 200,
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-local-partial&jobId=cvp_base",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("Expected queued job.");
    const now = new Date();
    updateVoicePipelineJob("owner-a", created.job.jobId, {
      status: "running",
      progress: 8,
      workerId: "local-voice-pipeline-worker",
      claimedAt: now.toISOString(),
      heartbeatAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + 300_000).toISOString(),
      message: "Generated 15 / 200 clips. Provider: indextts2. Run the worker again to continue.",
      result: { generatedClipCount: 15, requestedClipCount: 200 },
    });

    expect(getQueuedContractJob("owner-a", created.job.jobId)).toMatchObject({
      status: "interrupted",
      workerId: null,
      claimedAt: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      message: "Dataset job was released from the local development worker. Resume with the Linux IndexTTS2 dataset worker.",
      result: {
        releasedFromWorkerId: "local-voice-pipeline-worker",
        generatedClipCount: 15,
        requestedClipCount: 200,
        resumeAvailable: true,
        status: "interrupted",
      },
    });
  });

  it("protects universal worker claim with OTG_WORKER_TOKEN", async () => {
    const previousToken = process.env.OTG_WORKER_TOKEN;
    process.env.OTG_WORKER_TOKEN = "test-worker-token";
    const queued = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
    });
    expect(queued.ok).toBe(true);
    if (!queued.ok) throw new Error("Expected queued job.");

    const { POST: claimWorkerJobRoute } = await import("@/app/api/worker/jobs/claim/route");
    const missingToken = new NextRequest("http://localhost/api/worker/jobs/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jobType: "character_voice_pipeline",
        action: "generate_training_dataset",
        claimScope: "all_owners",
        workerId: "windows-voice-dataset-worker",
      }),
    });
    const rejected = await claimWorkerJobRoute(missingToken);
    expect(rejected.status).toBe(401);

    const validToken = new NextRequest("http://localhost/api/worker/jobs/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-worker-token",
      },
      body: JSON.stringify({
        jobType: "character_voice_pipeline",
        action: "generate_training_dataset",
        claimScope: "all_owners",
        workerId: "windows-voice-dataset-worker",
      }),
    });
    const accepted = await claimWorkerJobRoute(validToken);
    const json = await accepted.json();
    expect(accepted.status).toBe(200);
    expect(json.job).toMatchObject({
      ownerKey: "owner-a",
      jobType: "character_voice_pipeline",
      action: "generate_training_dataset",
      status: "running",
    });

    if (previousToken === undefined) {
      delete process.env.OTG_WORKER_TOKEN;
    } else {
      process.env.OTG_WORKER_TOKEN = previousToken;
    }
  });

  it("protects universal create_voice_sample worker claim with OTG_WORKER_TOKEN", async () => {
    const previousToken = process.env.OTG_WORKER_TOKEN;
    process.env.OTG_WORKER_TOKEN = "test-worker-token";
    try {
      const queued = createCharacterVoicePipelineJob("voice-owner", {
        action: "create_voice_sample",
        characterId: "char-voice",
        provider: "cosy",
        voiceInstruction: "A calm adult voice.",
      });
      expect(queued.ok).toBe(true);
      if (!queued.ok) throw new Error("Expected queued job.");

      const { POST: claimWorkerJobRoute } = await import("@/app/api/worker/jobs/claim/route");
      const missingToken = new NextRequest("http://localhost/api/worker/jobs/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jobType: "character_voice_pipeline",
          action: "create_voice_sample",
          claimScope: "all_owners",
          workerId: "windows-voice-design-worker",
        }),
      });
      const rejected = await claimWorkerJobRoute(missingToken);
      expect(rejected.status).toBe(401);

      const validToken = new NextRequest("http://localhost/api/worker/jobs/claim", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-worker-token",
        },
        body: JSON.stringify({
          jobType: "character_voice_pipeline",
          action: "create_voice_sample",
          claimScope: "all_owners",
          workerId: "windows-voice-design-worker",
        }),
      });
      const accepted = await claimWorkerJobRoute(validToken);
      const json = await accepted.json();
      expect(accepted.status).toBe(200);
      expect(json.job).toMatchObject({
        ownerKey: "voice-owner",
        jobType: "character_voice_pipeline",
        action: "create_voice_sample",
        status: "running",
      });
    } finally {
      if (previousToken === undefined) {
        delete process.env.OTG_WORKER_TOKEN;
      } else {
        process.env.OTG_WORKER_TOKEN = previousToken;
      }
    }
  });

  it("lets token-authenticated voice design workers checkpoint create_voice_sample progress", async () => {
    const previousToken = process.env.OTG_WORKER_TOKEN;
    process.env.OTG_WORKER_TOKEN = "test-worker-token";
    try {
      const queued = createCharacterVoicePipelineJob("voice-owner", {
        action: "create_voice_sample",
        characterId: "char-voice",
        provider: "qwen3",
        voiceInstruction: "A bright adult character voice.",
      });
      expect(queued.ok).toBe(true);
      if (!queued.ok) throw new Error("Expected queued job.");

      const claimed = claimRemoteWorkerJobAcrossOwners("windows-voice-design-worker", "character_voice_pipeline", "create_voice_sample");
      expect(claimed).toMatchObject({ status: "running" });

      const { POST: checkpointWorkerJobRoute } = await import("@/app/api/worker/jobs/checkpoint/route");
      const missingOwner = new NextRequest("http://localhost/api/worker/jobs/checkpoint", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-worker-token",
        },
        body: JSON.stringify({
          jobId: queued.job.jobId,
          progress: 35,
          message: "Generating Qwen3-TTS voice sample on the Windows worker.",
        }),
      });
      const rejected = await checkpointWorkerJobRoute(missingOwner);
      expect(rejected.status).toBe(500);

      const validToken = new NextRequest("http://localhost/api/worker/jobs/checkpoint", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-worker-token",
          "x-otg-owner-key": "voice-owner",
        },
        body: JSON.stringify({
          jobId: queued.job.jobId,
          progress: 35,
          message: "Generating Qwen3-TTS voice sample on the Windows worker.",
          result: {
            remoteWorker: true,
            workerId: "windows-voice-design-worker",
            provider: "qwen3",
            currentStage: "voice_generation",
            seed: 12345,
          },
        }),
      });
      const accepted = await checkpointWorkerJobRoute(validToken);
      const json = await accepted.json();
      expect(accepted.status).toBe(200);
      expect(json.job).toMatchObject({
        ownerKey: "voice-owner",
        status: "running",
        progress: 35,
        message: "Generating Qwen3-TTS voice sample on the Windows worker.",
        result: {
          remoteWorker: true,
          workerId: "windows-voice-design-worker",
          provider: "qwen3",
          currentStage: "voice_generation",
          seed: 12345,
        },
      });
    } finally {
      if (previousToken === undefined) {
        delete process.env.OTG_WORKER_TOKEN;
      } else {
        process.env.OTG_WORKER_TOKEN = previousToken;
      }
    }
  });

  it("rejects unsafe worker voice sample upload path segments", async () => {
    const { isSafeVoiceSampleUploadSegment } = await import("@/lib/characters/voiceSampleUpload");

    expect(isSafeVoiceSampleUploadSegment("char-1")).toBe(true);
    expect(isSafeVoiceSampleUploadSegment("cvp_1234567890_abcd")).toBe(true);
    expect(isSafeVoiceSampleUploadSegment("../bad")).toBe(false);
    expect(isSafeVoiceSampleUploadSegment("bad\\path")).toBe(false);
    expect(isSafeVoiceSampleUploadSegment("bad/path")).toBe(false);
    expect(isSafeVoiceSampleUploadSegment("")).toBe(false);
  });
});
