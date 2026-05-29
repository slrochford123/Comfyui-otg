import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearQueuedContractJobsForTests,
  createCharacterVoicePipelineJob,
  createProductionAudioStudioJob,
  getQueuedContractJob,
  setVoicePipelineJobStorePathForTests,
  updateVoicePipelineJob,
} from "@/lib/jobs/voicePipelineJobs";
import { tickVoicePipelineWorker } from "@/lib/jobs/voicePipelineWorker";

describe("voice pipeline no-op worker", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "otg-voice-pipeline-worker-"));
  const originalEnv = {
    OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE: process.env.OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE,
    QWEN_TTS_ROOT: process.env.QWEN_TTS_ROOT,
    QWEN_TTS_PYTHON: process.env.QWEN_TTS_PYTHON,
    QWEN_TTS_SITE_PACKAGES: process.env.QWEN_TTS_SITE_PACKAGES,
    QWEN_TTS_BRIDGE: process.env.QWEN_TTS_BRIDGE,
    OTG_QWEN3_VOICE_SAMPLE_TEST_MODE: process.env.OTG_QWEN3_VOICE_SAMPLE_TEST_MODE,
    OTG_ENABLE_REAL_COSY_VOICE_SAMPLE: process.env.OTG_ENABLE_REAL_COSY_VOICE_SAMPLE,
    COSYVOICE_ROOT: process.env.COSYVOICE_ROOT,
    COSYVOICE_PYTHON: process.env.COSYVOICE_PYTHON,
    COSYVOICE_SITE_PACKAGES: process.env.COSYVOICE_SITE_PACKAGES,
    COSYVOICE_BRIDGE: process.env.COSYVOICE_BRIDGE,
    COSYVOICE_BATCH_BRIDGE: process.env.COSYVOICE_BATCH_BRIDGE,
    OTG_COSY_VOICE_SAMPLE_TEST_MODE: process.env.OTG_COSY_VOICE_SAMPLE_TEST_MODE,
    OTG_COSY_VOICE_PACK_BATCH_TEST_MODE: process.env.OTG_COSY_VOICE_PACK_BATCH_TEST_MODE,
    INDEXTTS2_PYTHON: process.env.INDEXTTS2_PYTHON,
    INDEXTTS2_BRIDGE: process.env.INDEXTTS2_BRIDGE,
    INDEXTTS2_BATCH_BRIDGE: process.env.INDEXTTS2_BATCH_BRIDGE,
    INDEXTTS2_TIMEOUT_MS: process.env.INDEXTTS2_TIMEOUT_MS,
    OTG_INDEXTTS2_VOICE_PACK_BATCH_TEST_MODE: process.env.OTG_INDEXTTS2_VOICE_PACK_BATCH_TEST_MODE,
    OTG_ENABLE_REAL_VOICE_FX: process.env.OTG_ENABLE_REAL_VOICE_FX,
    VOICE_FX_FFMPEG: process.env.VOICE_FX_FFMPEG,
    VOICE_FX_TIMEOUT_MS: process.env.VOICE_FX_TIMEOUT_MS,
    OTG_VOICE_FX_TEST_MODE: process.env.OTG_VOICE_FX_TEST_MODE,
    APPLIO_DATASET_FFMPEG: process.env.APPLIO_DATASET_FFMPEG,
    APPLIO_SAMPLE_RATE: process.env.APPLIO_SAMPLE_RATE,
    OTG_TRAINING_DATASET_FFMPEG_TEST_MODE: process.env.OTG_TRAINING_DATASET_FFMPEG_TEST_MODE,
    OTG_ALLOW_MOCK_VOICE_PACK: process.env.OTG_ALLOW_MOCK_VOICE_PACK,
    VOICE_PACK_CHUNK_SIZE: process.env.VOICE_PACK_CHUNK_SIZE,
    VOICE_PACK_CLIP_RETRIES: process.env.VOICE_PACK_CLIP_RETRIES,
    OTG_ENABLE_REAL_APPLIO_TRAINING: process.env.OTG_ENABLE_REAL_APPLIO_TRAINING,
    OTG_APPLIO_TRAINING_TEST_MODE: process.env.OTG_APPLIO_TRAINING_TEST_MODE,
    APPLIO_ROOT: process.env.APPLIO_ROOT,
    APPLIO_PYTHON: process.env.APPLIO_PYTHON,
    APPLIO_TRAIN_SCRIPT: process.env.APPLIO_TRAIN_SCRIPT,
    APPLIO_CORE_SCRIPT: process.env.APPLIO_CORE_SCRIPT,
    APPLIO_DATASETS_ROOT: process.env.APPLIO_DATASETS_ROOT,
    APPLIO_MODELS_ROOT: process.env.APPLIO_MODELS_ROOT,
    APPLIO_LOGS_ROOT: process.env.APPLIO_LOGS_ROOT,
    APPLIO_TIMEOUT_MS: process.env.APPLIO_TIMEOUT_MS,
    APPLIO_EPOCHS: process.env.APPLIO_EPOCHS,
    APPLIO_BATCH_SIZE: process.env.APPLIO_BATCH_SIZE,
    APPLIO_SAVE_EVERY_EPOCH: process.env.APPLIO_SAVE_EVERY_EPOCH,
    APPLIO_CACHE_DATASET: process.env.APPLIO_CACHE_DATASET,
    APPLIO_GPU: process.env.APPLIO_GPU,
    APPLIO_INDEX_ALGORITHM: process.env.APPLIO_INDEX_ALGORITHM,
    APPLIO_VOCODER: process.env.APPLIO_VOCODER,
    APPLIO_PITCH_GUIDANCE: process.env.APPLIO_PITCH_GUIDANCE,
    APPLIO_F0_METHOD: process.env.APPLIO_F0_METHOD,
    APPLIO_CUT_PREPROCESS: process.env.APPLIO_CUT_PREPROCESS,
    APPLIO_INCLUDE_MUTES: process.env.APPLIO_INCLUDE_MUTES,
    APPLIO_EXTRACT_CPU_CORES: process.env.APPLIO_EXTRACT_CPU_CORES,
    APPLIO_SAVE_EVERY_WEIGHTS: process.env.APPLIO_SAVE_EVERY_WEIGHTS,
    APPLIO_SAVE_ONLY_LATEST: process.env.APPLIO_SAVE_ONLY_LATEST,
    APPLIO_PRETRAINED: process.env.APPLIO_PRETRAINED,
    APPLIO_CUSTOM_PRETRAINED: process.env.APPLIO_CUSTOM_PRETRAINED,
    APPLIO_G_PRETRAINED_PATH: process.env.APPLIO_G_PRETRAINED_PATH,
    APPLIO_D_PRETRAINED_PATH: process.env.APPLIO_D_PRETRAINED_PATH,
    APPLIO_INFER_SCRIPT: process.env.APPLIO_INFER_SCRIPT,
    APPLIO_INFER_F0_METHOD: process.env.APPLIO_INFER_F0_METHOD,
    APPLIO_INFER_INDEX_RATE: process.env.APPLIO_INFER_INDEX_RATE,
    APPLIO_INFER_PITCH: process.env.APPLIO_INFER_PITCH,
    APPLIO_INFER_PROTECT: process.env.APPLIO_INFER_PROTECT,
    APPLIO_INFER_OUTPUT_FORMAT: process.env.APPLIO_INFER_OUTPUT_FORMAT,
    APPLIO_INFER_TIMEOUT_MS: process.env.APPLIO_INFER_TIMEOUT_MS,
    OTG_APPLIO_INFERENCE_TEST_MODE: process.env.OTG_APPLIO_INFERENCE_TEST_MODE,
  };

  beforeEach(() => {
    setVoicePipelineJobStorePathForTests(path.join(tempDir, `jobs-${Date.now()}-${Math.random().toString(16).slice(2)}.json`));
    clearQueuedContractJobsForTests();
    delete process.env.OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE;
    delete process.env.QWEN_TTS_ROOT;
    delete process.env.QWEN_TTS_PYTHON;
    delete process.env.QWEN_TTS_SITE_PACKAGES;
    delete process.env.QWEN_TTS_BRIDGE;
    delete process.env.OTG_QWEN3_VOICE_SAMPLE_TEST_MODE;
    delete process.env.OTG_ENABLE_REAL_COSY_VOICE_SAMPLE;
    delete process.env.COSYVOICE_ROOT;
    delete process.env.COSYVOICE_PYTHON;
    delete process.env.COSYVOICE_SITE_PACKAGES;
    delete process.env.COSYVOICE_BRIDGE;
    delete process.env.COSYVOICE_BATCH_BRIDGE;
    delete process.env.OTG_COSY_VOICE_SAMPLE_TEST_MODE;
    delete process.env.OTG_COSY_VOICE_PACK_BATCH_TEST_MODE;
    delete process.env.INDEXTTS2_PYTHON;
    delete process.env.INDEXTTS2_BRIDGE;
    delete process.env.INDEXTTS2_BATCH_BRIDGE;
    delete process.env.INDEXTTS2_TIMEOUT_MS;
    delete process.env.OTG_INDEXTTS2_VOICE_PACK_BATCH_TEST_MODE;
    delete process.env.OTG_ENABLE_REAL_VOICE_FX;
    delete process.env.VOICE_FX_FFMPEG;
    delete process.env.VOICE_FX_TIMEOUT_MS;
    delete process.env.OTG_VOICE_FX_TEST_MODE;
    delete process.env.APPLIO_DATASET_FFMPEG;
    delete process.env.APPLIO_SAMPLE_RATE;
    delete process.env.OTG_TRAINING_DATASET_FFMPEG_TEST_MODE;
    delete process.env.OTG_ALLOW_MOCK_VOICE_PACK;
    delete process.env.VOICE_PACK_CHUNK_SIZE;
    delete process.env.VOICE_PACK_CLIP_RETRIES;
    delete process.env.OTG_ENABLE_REAL_APPLIO_TRAINING;
    delete process.env.OTG_APPLIO_TRAINING_TEST_MODE;
    delete process.env.APPLIO_ROOT;
    delete process.env.APPLIO_PYTHON;
    delete process.env.APPLIO_TRAIN_SCRIPT;
    delete process.env.APPLIO_CORE_SCRIPT;
    delete process.env.APPLIO_DATASETS_ROOT;
    delete process.env.APPLIO_MODELS_ROOT;
    delete process.env.APPLIO_LOGS_ROOT;
    delete process.env.APPLIO_TIMEOUT_MS;
    delete process.env.APPLIO_EPOCHS;
    delete process.env.APPLIO_BATCH_SIZE;
    delete process.env.APPLIO_SAVE_EVERY_EPOCH;
    delete process.env.APPLIO_CACHE_DATASET;
    delete process.env.APPLIO_GPU;
    delete process.env.APPLIO_INDEX_ALGORITHM;
    delete process.env.APPLIO_VOCODER;
    delete process.env.APPLIO_PITCH_GUIDANCE;
    delete process.env.APPLIO_F0_METHOD;
    delete process.env.APPLIO_CUT_PREPROCESS;
    delete process.env.APPLIO_INCLUDE_MUTES;
    delete process.env.APPLIO_EXTRACT_CPU_CORES;
    delete process.env.APPLIO_SAVE_EVERY_WEIGHTS;
    delete process.env.APPLIO_SAVE_ONLY_LATEST;
    delete process.env.APPLIO_PRETRAINED;
    delete process.env.APPLIO_CUSTOM_PRETRAINED;
    delete process.env.APPLIO_G_PRETRAINED_PATH;
    delete process.env.APPLIO_D_PRETRAINED_PATH;
    delete process.env.APPLIO_INFER_SCRIPT;
    delete process.env.APPLIO_INFER_F0_METHOD;
    delete process.env.APPLIO_INFER_INDEX_RATE;
    delete process.env.APPLIO_INFER_PITCH;
    delete process.env.APPLIO_INFER_PROTECT;
    delete process.env.APPLIO_INFER_OUTPUT_FORMAT;
    delete process.env.APPLIO_INFER_TIMEOUT_MS;
    delete process.env.OTG_APPLIO_INFERENCE_TEST_MODE;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("advances a queued job through running progress and completion", async () => {
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "qwen3",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const first = await tickVoicePipelineWorker("owner-a");
    expect(first).toMatchObject({
      processed: 1,
      jobs: [{ status: "running", progress: 5, message: "Worker started" }],
    });

    expect((await tickVoicePipelineWorker("owner-a")).jobs[0]).toMatchObject({
      status: "running",
      progress: 35,
    });
    expect((await tickVoicePipelineWorker("owner-a")).jobs[0]).toMatchObject({
      status: "running",
      progress: 70,
    });

    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];
    expect(failed).toMatchObject({
      status: "failed",
      progress: 100,
      error: "Real create_voice_sample worker required. Start the Qwen3-TTS or CosyVoice worker with real model env enabled.",
    });
  });

  it("returns action-specific fake results for production audio studio jobs", async () => {
    const created = createProductionAudioStudioJob("owner-a", {
      action: "render_audio_mix",
      clipId: "clip-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(completed).toMatchObject({
      status: "completed",
      result: {
        finalClipUrl: `/mock-assets/clips/${created.job.jobId}/final-audio-mix.mp4`,
      },
    });
  });

  it("writes a durable training dataset manifest for approved source jobs", async () => {
    const approvedSamplePath = writeApprovedTrainingSample("owner-a", "char-1", "cvp_fx", "fx.wav");
    process.env.OTG_ALLOW_MOCK_VOICE_PACK = "1";
    process.env.OTG_TRAINING_DATASET_FFMPEG_TEST_MODE = "copy";
    process.env.APPLIO_SAMPLE_RATE = "40000";
    process.env.VOICE_PACK_CHUNK_SIZE = "200";
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-1",
      trainingPreset: "balanced",
      requestedClipCount: 200,
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_fx&file=fx.wav",
      approvedSamplePath,
      approvedSampleType: "tuned",
      approvedSourceJobId: "cvp_fx",
      baseSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_base",
      tunedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_fx&file=fx.wav",
      tunedFxPreset: "robotic",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(completed).toMatchObject({
      status: "completed",
      progress: 100,
      result: {
        mock: true,
        adapter: "dataset_manifest",
        clipCount: 200,
        generatedClipCount: 200,
        approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-1&jobId=cvp_fx&file=fx.wav",
        originalSourcePath: approvedSamplePath,
        generationMode: "mock_copy",
        provider: "mock",
        sampleRate: 40000,
        channels: 1,
        status: "voice_pack_ready",
      },
    });

    const result = completed.result as Record<string, unknown>;
    const manifestPath = String(result.manifestPath || "");
    expect(manifestPath).toContain(path.join("characters", "owner-a", "training-datasets", "char-1"));
    expect(manifestPath).toContain(created.job.jobId);
    expect(String(result.manifestUrl || "")).toContain("/api/characters/training-dataset/manifest?");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const canonicalSourcePath = path.join(path.dirname(manifestPath), "source", "source.wav");
    expect(result.canonicalSourcePath).toBe(canonicalSourcePath);
    expect(String(result.canonicalSourceUrl || "")).toContain("file=source.wav");
    expect(fs.existsSync(canonicalSourcePath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      ownerKey: "owner-a",
      characterId: "char-1",
      jobId: created.job.jobId,
      requestedClipCount: 200,
      generatedClipCount: 200,
      generationMode: "mock_copy",
      provider: "mock",
      status: "voice_pack_ready",
      mock: true,
      source: {
        approvedSamplePath: canonicalSourcePath,
        approvedSampleType: "tuned",
        approvedSourceJobId: "cvp_fx",
        tunedFxPreset: "robotic",
        originalSourcePath: approvedSamplePath,
        canonicalSourcePath,
        sourceFormat: ".wav",
        sampleRate: 40000,
        channels: 1,
      },
      logs: {
        paramsPath: String(result.paramsPath),
        stdoutPath: String(result.stdoutPath),
        stderrPath: String(result.stderrPath),
      },
    });
    expect(String(manifest.source.canonicalSourceUrl)).toContain("file=source.wav");
    expect(manifest.clips).toHaveLength(200);
    expect(manifest.clips[0]).toMatchObject({
      clipId: "clip_001",
      index: 0,
      status: "ready",
      sourceSamplePath: canonicalSourcePath,
    });
    expect(String(manifest.clips[0].expectedAudioPath)).toContain("clip_001.wav");
    expect(String(manifest.clips[0].expectedAudioUrl)).toContain("/api/characters/training-dataset/file?");
    expect(String(manifest.clips[0].expectedAudioUrl)).toContain("clipId=clip_001");
    expect(fs.existsSync(String(manifest.clips[0].expectedAudioPath))).toBe(true);
    expect(fs.statSync(String(manifest.clips[0].expectedAudioPath)).size).toBeGreaterThan(0);
    const clipsDir = path.join(path.dirname(manifestPath), "clips");
    expect(fs.readdirSync(clipsDir).filter((fileName) => fileName.endsWith(".wav"))).toHaveLength(200);

    const { HEAD } = await import("@/app/api/characters/training-dataset/file/route");
    const clipRequest = new NextRequest(`http://localhost/api/characters/training-dataset/file?owner=owner-a&characterId=char-1&jobId=${created.job.jobId}&clipId=clip_001`);
    const clipResponse = await HEAD(clipRequest);
    expect(clipResponse.status).toBe(200);
    expect(clipResponse.headers.get("content-type")).toBe("audio/wav");
    expect(clipResponse.headers.get("x-otg-resolved-clip")).toBe("clip_001");

    const sourceRequest = new NextRequest(`http://localhost/api/characters/training-dataset/file?owner=owner-a&characterId=char-1&jobId=${created.job.jobId}&file=source.wav`);
    const sourceResponse = await HEAD(sourceRequest);
    expect(sourceResponse.status).toBe(200);
    expect(sourceResponse.headers.get("content-type")).toBe("audio/wav");
    expect(sourceResponse.headers.get("x-otg-resolved-clip")).toBe("source.wav");

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("fails product voice-pack generation clearly when no real provider configuration is available", async () => {
    const approvedSamplePath = writeApprovedTrainingSample("owner-a", "char-real-missing", "cvp_base", "sample.wav");
    process.env.OTG_TRAINING_DATASET_FFMPEG_TEST_MODE = "copy";
    process.env.VOICE_PACK_CLIP_RETRIES = "1";
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-real-missing",
      trainingPreset: "balanced",
      requestedClipCount: 3,
      provider: "qwen3",
      voiceInstruction: "Design a clear adult narrator voice.",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-real-missing&jobId=cvp_base",
      approvedSamplePath,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const resumable = (await tickVoicePipelineWorker("owner-a")).jobs[0];
    expect(resumable).toMatchObject({ status: "running" });
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed).toMatchObject({
      status: "failed",
      progress: 100,
      message: "Training dataset manifest generation failed.",
    });
    expect(String(failed.error)).toContain("IndexTTS2");
    const manifestPath = path.join(process.cwd(), "data", "characters", "owner-a", "training-datasets", "char-real-missing", created.job.jobId, "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.status).toBe("manifest_ready");
    expect(manifest.clips[0]).toMatchObject({
      clipId: "clip_001",
      status: "failed",
      retryCount: 2,
    });
    expect(String(manifest.clips[0].lastError)).toContain("IndexTTS2");

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("creates a real-mode voice pack by cloning the approved Qwen reference with IndexTTS2", async () => {
    configureFakeIndexTts2Paths("index-qwen-real-pack");
    process.env.OTG_INDEXTTS2_VOICE_PACK_BATCH_TEST_MODE = "success";
    process.env.OTG_TRAINING_DATASET_FFMPEG_TEST_MODE = "copy";
    process.env.VOICE_PACK_CHUNK_SIZE = "3";
    const approvedSamplePath = writeApprovedTrainingSample("owner-a", "char-real-pack", "cvp_base", "sample.wav");
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-real-pack",
      trainingPreset: "balanced",
      requestedClipCount: 3,
      provider: "qwen3",
      voiceInstruction: "Design a consistent adult male voice with low pitch.",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-real-pack&jobId=cvp_base",
      approvedSamplePath,
      approvedSampleType: "base",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(completed).toMatchObject({
      status: "completed",
      progress: 100,
      result: {
        adapter: "dataset_manifest",
        mock: false,
        generationMode: "real",
        provider: "indextts2",
        sourceProvider: "qwen3",
        clipCount: 3,
        generatedClipCount: 3,
      },
    });

    const manifestPath = String((completed.result as Record<string, unknown>).manifestPath || "");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest).toMatchObject({
      generationMode: "real",
      provider: "indextts2",
      sourceProvider: "qwen3",
      mock: false,
      requestedClipCount: 3,
      generatedClipCount: 3,
      status: "voice_pack_ready",
    });
    expect(manifest.clips).toHaveLength(3);
    expect(new Set(manifest.clips.map((clip: { text: string }) => clip.text)).size).toBe(3);
    for (const clip of manifest.clips) {
      expect(clip.status).toBe("ready");
      expect(fs.existsSync(String(clip.expectedAudioPath))).toBe(true);
      expect(String(clip.generatorSamplePath)).toContain(clip.clipId);
      expect(String(clip.generatorSamplePath)).toContain(path.join("generated", "indextts2-batch"));
      expect(clip.generatorProvider).toBe("indextts2");
      expect(clip.sourceSamplePath).toBe(manifest.source.canonicalSourcePath);
    }

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("resumes a partial real voice pack and does not regenerate ready clips", async () => {
    configureFakeIndexTts2Paths("index-resume-pack");
    process.env.OTG_INDEXTTS2_VOICE_PACK_BATCH_TEST_MODE = "success";
    process.env.OTG_TRAINING_DATASET_FFMPEG_TEST_MODE = "copy";
    process.env.VOICE_PACK_CHUNK_SIZE = "2";
    const approvedSamplePath = writeApprovedTrainingSample("owner-a", "char-resume-pack", "cvp_base", "sample.wav");
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-resume-pack",
      trainingPreset: "balanced",
      requestedClipCount: 3,
      provider: "qwen3",
      voiceInstruction: "Design a consistent adult narrator voice.",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-resume-pack&jobId=cvp_base",
      approvedSamplePath,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const partial = (await tickVoicePipelineWorker("owner-a")).jobs[0];
    expect(partial).toMatchObject({
      status: "running",
      result: {
        generationMode: "real",
        generatedClipCount: 2,
        status: "manifest_ready",
      },
    });

    const partialResult = partial.result as Record<string, unknown>;
    const manifestPath = String(partialResult.manifestPath || "");
    let manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const firstClipPath = String(manifest.clips[0].expectedAudioPath);
    const secondClipPath = String(manifest.clips[1].expectedAudioPath);
    const secondClipHash = fs.readFileSync(secondClipPath).toString("base64");
    fs.rmSync(firstClipPath, { force: true });

    process.env.VOICE_PACK_CHUNK_SIZE = "3";
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];
    expect(completed).toMatchObject({
      status: "completed",
      result: {
        generatedClipCount: 3,
        status: "voice_pack_ready",
      },
    });
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.clips.map((clip: { status: string }) => clip.status)).toEqual(["ready", "ready", "ready"]);
    expect(fs.existsSync(firstClipPath)).toBe(true);
    expect(fs.readFileSync(secondClipPath).toString("base64")).toBe(secondClipHash);

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("uses IndexTTS2 for one chunk of real voice-pack clips from an approved Cosy reference", async () => {
    configureFakeIndexTts2Paths("index-cosy-batch-pack");
    process.env.OTG_INDEXTTS2_VOICE_PACK_BATCH_TEST_MODE = "success";
    process.env.OTG_TRAINING_DATASET_FFMPEG_TEST_MODE = "copy";
    process.env.VOICE_PACK_CHUNK_SIZE = "2";
    const approvedSamplePath = writeApprovedTrainingSample("owner-a", "char-cosy-batch", "cvp_base", "sample.wav");
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-cosy-batch",
      trainingPreset: "balanced",
      requestedClipCount: 3,
      provider: "cosy",
      voiceInstruction: "Design a consistent warm adult voice.",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-cosy-batch&jobId=cvp_base",
      approvedSamplePath,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const partial = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(partial).toMatchObject({
      status: "running",
      result: {
        generationMode: "real",
        provider: "indextts2",
        sourceProvider: "cosy",
        generatedClipCount: 2,
        status: "manifest_ready",
      },
    });

    const manifestPath = String((partial.result as Record<string, unknown>).manifestPath || "");
    let manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.clips.slice(0, 2).map((clip: { status: string }) => clip.status)).toEqual(["ready", "ready"]);
    expect(manifest.clips[2].status).toBe("pending");
    const firstBatchParams = fs.readdirSync(path.join(path.dirname(manifestPath), "logs"))
      .filter((fileName) => fileName.startsWith("indextts2_pack_batch_") && fileName.endsWith(".json"))
      .map((fileName) => path.join(path.dirname(manifestPath), "logs", fileName))[0];
    const firstBatch = JSON.parse(fs.readFileSync(firstBatchParams, "utf8"));
    expect(firstBatch.clips).toHaveLength(2);
    expect(firstBatch.reference_wav).toBe(manifest.source.canonicalSourcePath);
    expect(firstBatch.clips.every((clip: { output_wav: string }) => String(clip.output_wav).includes(path.join("generated", "indextts2-batch")))).toBe(true);

    process.env.VOICE_PACK_CHUNK_SIZE = "3";
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];
    expect(completed).toMatchObject({
      status: "completed",
      result: {
        generationMode: "real",
        provider: "indextts2",
        sourceProvider: "cosy",
        generatedClipCount: 3,
        status: "voice_pack_ready",
      },
    });

    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.clips.map((clip: { status: string }) => clip.status)).toEqual(["ready", "ready", "ready"]);
    for (const clip of manifest.clips) {
      expect(clip.generatorProvider).toBe("indextts2");
      expect(String(clip.generatorSamplePath)).toContain(path.join("generated", "indextts2-batch"));
      expect(fs.existsSync(String(clip.expectedAudioPath))).toBe(true);
    }

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("records a failed Cosy batch clip and resumes it on the next worker run", async () => {
    configureFakeIndexTts2Paths("index-batch-partial");
    process.env.OTG_INDEXTTS2_VOICE_PACK_BATCH_TEST_MODE = "partial";
    process.env.OTG_TRAINING_DATASET_FFMPEG_TEST_MODE = "copy";
    process.env.VOICE_PACK_CHUNK_SIZE = "2";
    const approvedSamplePath = writeApprovedTrainingSample("owner-a", "char-cosy-partial", "cvp_base", "sample.wav");
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-cosy-partial",
      trainingPreset: "balanced",
      requestedClipCount: 3,
      provider: "cosy",
      voiceInstruction: "Design a consistent warm adult voice.",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-cosy-partial&jobId=cvp_base",
      approvedSamplePath,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const partial = (await tickVoicePipelineWorker("owner-a")).jobs[0];
    expect(partial).toMatchObject({
      status: "running",
      result: {
        generatedClipCount: 1,
        status: "manifest_ready",
      },
    });
    const manifestPath = String((partial.result as Record<string, unknown>).manifestPath || "");
    let manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.clips[0].status).toBe("ready");
    expect(manifest.clips[1]).toMatchObject({
      status: "failed",
      retryCount: 1,
      lastError: "test IndexTTS2 partial failure",
    });

    process.env.OTG_INDEXTTS2_VOICE_PACK_BATCH_TEST_MODE = "success";
    process.env.VOICE_PACK_CHUNK_SIZE = "3";
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];
    expect(completed).toMatchObject({
      status: "completed",
      result: {
        generatedClipCount: 3,
        status: "voice_pack_ready",
      },
    });
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.clips.map((clip: { status: string }) => clip.status)).toEqual(["ready", "ready", "ready"]);
    expect(manifest.clips[1].retryCount).toBe(1);

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("fails training dataset generation clearly when ffmpeg is missing", async () => {
    const approvedSamplePath = writeApprovedTrainingSample("owner-a", "char-missing-ffmpeg", "cvp_base", "sample.wav");
    process.env.APPLIO_DATASET_FFMPEG = path.join(tempDir, "missing-ffmpeg.exe");
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-missing-ffmpeg",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-missing-ffmpeg&jobId=cvp_base",
      approvedSamplePath,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed).toMatchObject({
      status: "failed",
      progress: 100,
      message: "Training dataset manifest generation failed.",
    });
    expect(failed.error).toContain("Training dataset ffmpeg not found");
    const manifestPath = path.join(process.cwd(), "data", "characters", "owner-a", "training-datasets", "char-missing-ffmpeg", created.job.jobId, "manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(false);

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("fails training dataset generation for unsupported source audio formats", async () => {
    const unsupportedPath = path.join(process.cwd(), "data", "characters", "owner-a", "voice-samples", "char-bad-source", "cvp_base", "sample.txt");
    fs.mkdirSync(path.dirname(unsupportedPath), { recursive: true });
    fs.writeFileSync(unsupportedPath, "not audio", "utf8");
    process.env.OTG_TRAINING_DATASET_FFMPEG_TEST_MODE = "copy";
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-bad-source",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-bad-source&jobId=cvp_base",
      approvedSamplePath: unsupportedPath,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("Unsupported training source audio format");

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("fails start_applio_training clearly when no dataset manifest exists", async () => {
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-missing-manifest",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-missing-manifest&jobId=cvp_base",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed).toMatchObject({
      status: "failed",
      progress: 100,
      message: "Applio training artifact generation failed.",
    });
    expect(failed.error).toContain("No dataset manifest found for character char-missing-manifest");
  });

  it("writes an Applio training artifact when a dataset manifest exists", async () => {
    const approvedSamplePath = writeApprovedTrainingSample("owner-a", "char-2", "cvp_base", "sample.wav");
    process.env.OTG_ALLOW_MOCK_VOICE_PACK = "1";
    process.env.OTG_TRAINING_DATASET_FFMPEG_TEST_MODE = "copy";
    process.env.VOICE_PACK_CHUNK_SIZE = "200";
    const dataset = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-2",
      trainingPreset: "balanced",
      requestedClipCount: 200,
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-2&jobId=cvp_base",
      approvedSamplePath,
      approvedSampleType: "base",
      approvedSourceJobId: "cvp_base",
      baseSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-2&jobId=cvp_base",
    });
    expect(dataset.ok).toBe(true);
    if (!dataset.ok) throw new Error(dataset.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const datasetCompleted = (await tickVoicePipelineWorker("owner-a")).jobs[0];
    const datasetResult = datasetCompleted.result as Record<string, unknown>;

    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-2",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-2&jobId=cvp_base",
      manifestPath: datasetResult.manifestPath,
      manifestUrl: datasetResult.manifestUrl,
      sourceDatasetJobId: dataset.job.jobId,
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(completed).toMatchObject({
      status: "completed",
      progress: 100,
      result: {
        mock: true,
        adapter: "applio_training_artifact",
        status: "training_artifact_ready",
        manifestPath: datasetResult.manifestPath,
        clipCount: 200,
      },
    });

    const result = completed.result as Record<string, unknown>;
    const artifactPath = String(result.artifactPath || "");
    expect(artifactPath).toContain(path.join("characters", "owner-a", "applio-models", "char-2"));
    expect(String(result.artifactUrl || "")).toContain("/api/characters/applio-training/artifact?");
    expect(fs.existsSync(artifactPath)).toBe(true);

    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      ownerKey: "owner-a",
      characterId: "char-2",
      jobId: training.job.jobId,
      status: "training_artifact_ready",
      mock: true,
      adapter: "applio_training_artifact",
      dataset: {
        manifestPath: datasetResult.manifestPath,
        sourceDatasetJobId: dataset.job.jobId,
        clipCount: 200,
        approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-2&jobId=cvp_base",
      },
      model: {
        status: "not_trained",
      },
    });
    expect(String(artifact.model.expectedModelPath)).toContain(".pth");
    expect(String(artifact.model.expectedIndexPath)).toContain(".index");

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("fails real Applio training clearly when required config paths are missing", async () => {
    const manifestPath = writeReadyTrainingManifest("owner-a", "char-real-applio-missing", "dataset-real-missing", {
      generationMode: "real",
      mock: false,
      generatedClipCount: 200,
      status: "voice_pack_ready",
    });
    process.env.OTG_ENABLE_REAL_APPLIO_TRAINING = "1";
    process.env.APPLIO_ROOT = path.join(tempDir, "missing-applio");
    process.env.APPLIO_PYTHON = path.join(tempDir, "missing-applio", "python.exe");
    process.env.APPLIO_TRAIN_SCRIPT = path.join(tempDir, "missing-applio", "core.py");
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-real-applio-missing",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-real-applio-missing&jobId=cvp_base",
      manifestPath,
      sourceDatasetJobId: "dataset-real-missing",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed).toMatchObject({
      status: "failed",
      progress: 100,
      message: "Applio training artifact generation failed.",
    });
    expect(String(failed.error)).toContain("APPLIO_ROOT does not exist");

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("rejects mock or incomplete voice packs when real Applio training is enabled", async () => {
    const manifestPath = writeReadyTrainingManifest("owner-a", "char-real-applio-reject", "dataset-mock-reject", {
      generationMode: "mock_copy",
      mock: true,
      generatedClipCount: 200,
      status: "voice_pack_ready",
    });
    configureFakeApplioPaths("applio-reject");
    process.env.OTG_ENABLE_REAL_APPLIO_TRAINING = "1";
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-real-applio-reject",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-real-applio-reject&jobId=cvp_base",
      manifestPath,
      sourceDatasetJobId: "dataset-mock-reject",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed.status).toBe("failed");
    expect(String(failed.error)).toContain("Real Applio training requires a real voice pack");

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("writes a trained real Applio artifact when the configured training command succeeds in test mode", async () => {
    const manifestPath = writeReadyTrainingManifest("owner-a", "char-real-applio-success", "dataset-real-success", {
      generationMode: "real",
      mock: false,
      generatedClipCount: 200,
      status: "voice_pack_ready",
    });
    const applioPaths = configureFakeApplioPaths("applio-success");
    process.env.OTG_ENABLE_REAL_APPLIO_TRAINING = "1";
    process.env.OTG_APPLIO_TRAINING_TEST_MODE = "success";
    process.env.APPLIO_SAMPLE_RATE = "40000";
    process.env.APPLIO_EPOCHS = "2";
    process.env.APPLIO_SAVE_EVERY_EPOCH = "1";
    process.env.APPLIO_BATCH_SIZE = "4";
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-real-applio-success",
      trainingPreset: "balanced",
      trainingQualityPreset: "fast",
      epochs: 25,
      saveEveryEpoch: 5,
      estimatedDurationLabel: "20-40 minutes",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-real-applio-success&jobId=cvp_base",
      manifestPath,
      sourceDatasetJobId: "dataset-real-success",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(completed).toMatchObject({
      status: "completed",
      progress: 100,
      result: {
        mock: false,
        adapter: "applio_real_training",
        status: "trained",
        manifestPath,
        clipCount: 200,
        trainingQualityPreset: "fast",
        epochs: 25,
        saveEveryEpoch: 5,
        estimatedDurationLabel: "20-40 minutes",
      },
    });
    const result = completed.result as Record<string, unknown>;
    expect(fs.existsSync(String(result.modelPath))).toBe(true);
    expect(fs.existsSync(String(result.indexPath))).toBe(true);
    expect(String(result.preparedDatasetPath || "")).toContain("voice_model_char-real-applio-success");
    expect(fs.readdirSync(String(result.preparedDatasetPath)).filter((fileName) => fileName.endsWith(".wav"))).toHaveLength(200);

    const artifact = JSON.parse(fs.readFileSync(String(result.artifactPath), "utf8"));
    const commandLog = JSON.parse(fs.readFileSync(String(result.commandPath), "utf8"));
    const preprocessCommand = commandLog.commands.find((command: { step: string }) => command.step === "preprocess");
    const extractCommand = commandLog.commands.find((command: { step: string }) => command.step === "extract");
    const trainCommand = commandLog.commands.find((command: { step: string }) => command.step === "train");
    expect(commandLog.cwd).toBe(applioPaths.root);
    expect(preprocessCommand.cwd).toBe(commandLog.cwd);
    expect(preprocessCommand.args).toContain("--cut_preprocess");
    expect(preprocessCommand.args[preprocessCommand.args.indexOf("--cut_preprocess") + 1]).toBe("Skip");
    expect(extractCommand.cwd).toBe(commandLog.cwd);
    expect(extractCommand.args).toContain("--include_mutes");
    expect(extractCommand.args[extractCommand.args.indexOf("--include_mutes") + 1]).toBe("2");
    expect(extractCommand.args).toContain("--cpu_cores");
    expect(extractCommand.args[extractCommand.args.indexOf("--cpu_cores") + 1]).toBe("8");
    expect(commandLog.validation).toMatchObject({
      extractCpuCores: 8,
      includeMutes: 2,
    });
    expect(trainCommand.cwd).toBe(commandLog.cwd);
    expect(trainCommand.args).toContain("--save_every_epoch");
    expect(trainCommand.args[trainCommand.args.indexOf("--save_every_epoch") + 1]).toBe("5");
    expect(trainCommand.args).toContain("--total_epoch");
    expect(trainCommand.args[trainCommand.args.indexOf("--total_epoch") + 1]).toBe("25");
    expect(trainCommand.args).toContain("--save_every_weights");
    expect(trainCommand.args[trainCommand.args.indexOf("--save_every_weights") + 1]).toBe("True");
    expect(trainCommand.args).toContain("--save_only_latest");
    expect(trainCommand.args[trainCommand.args.indexOf("--save_only_latest") + 1]).toBe("False");
    expect(trainCommand.args).toContain("--pretrained");
    expect(trainCommand.args[trainCommand.args.indexOf("--pretrained") + 1]).toBe("True");
    expect(trainCommand.args).toContain("--custom_pretrained");
    expect(trainCommand.args[trainCommand.args.indexOf("--custom_pretrained") + 1]).toBe("False");
    expect(trainCommand.args).toContain("--cache_data_in_gpu");
    expect(trainCommand.args).toContain("--index_algorithm");
    expect(trainCommand.args).not.toContain("--pitch_guidance");
    expect(commandLog.validation).toMatchObject({
      saveEveryWeights: "True",
      saveOnlyLatest: "False",
      pretrained: "True",
      customPretrained: "False",
    });
    expect(commandLog).toMatchObject({
      trainingQualityPreset: "fast",
      epochs: 25,
      saveEveryEpoch: 5,
      estimatedDurationLabel: "20-40 minutes",
    });
    expect(artifact).toMatchObject({
      status: "trained",
      mock: false,
      adapter: "applio_real_training",
      trainingQualityPreset: "fast",
      epochs: 25,
      saveEveryEpoch: 5,
      estimatedDurationLabel: "20-40 minutes",
      model: {
        status: "trained",
        modelPath: result.modelPath,
        indexPath: result.indexPath,
      },
      dataset: {
        sourceDatasetJobId: "dataset-real-success",
        generationMode: "real",
      },
    });

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("copies discovered Applio .pth and .index outputs into the character artifact folder", async () => {
    const manifestPath = writeReadyTrainingManifest("owner-a", "char-applio-external-outputs", "dataset-external-outputs", {
      generationMode: "real",
      mock: false,
      generatedClipCount: 200,
      status: "voice_pack_ready",
    });
    const applioPaths = configureFakeApplioPaths("applio-external-outputs");
    process.env.OTG_ENABLE_REAL_APPLIO_TRAINING = "1";
    process.env.OTG_APPLIO_TRAINING_TEST_MODE = "external-outputs";
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-applio-external-outputs",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-applio-external-outputs&jobId=cvp_base",
      manifestPath,
      sourceDatasetJobId: "dataset-external-outputs",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(completed.status).toBe("completed");
    const result = completed.result as Record<string, unknown>;
    expect(String(result.modelPath)).toContain(path.join("characters", "owner-a", "applio-models", "char-applio-external-outputs"));
    expect(String(result.indexPath)).toContain(path.join("characters", "owner-a", "applio-models", "char-applio-external-outputs"));
    expect(fs.readFileSync(String(result.modelPath), "utf8")).toBe("fake external pth");
    expect(fs.readFileSync(String(result.indexPath), "utf8")).toBe("fake external index");

    const artifact = JSON.parse(fs.readFileSync(String(result.artifactPath), "utf8"));
    expect(String(artifact.model.sourceModelPath)).toContain(path.join(applioPaths.root, "assets", "weights"));
    expect(String(artifact.model.sourceIndexPath)).toContain(path.join(applioPaths.root, "logs", String(result.modelName)));
    expect(artifact.model.modelPath).toBe(result.modelPath);
    expect(artifact.model.indexPath).toBe(result.indexPath);

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("fails clearly when Applio produces an index but no model checkpoint", async () => {
    const manifestPath = writeReadyTrainingManifest("owner-a", "char-applio-index-only", "dataset-index-only", {
      generationMode: "real",
      mock: false,
      generatedClipCount: 200,
      status: "voice_pack_ready",
    });
    configureFakeApplioPaths("applio-index-only");
    process.env.OTG_ENABLE_REAL_APPLIO_TRAINING = "1";
    process.env.OTG_APPLIO_TRAINING_TEST_MODE = "index-only";
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-applio-index-only",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-applio-index-only&jobId=cvp_base",
      manifestPath,
      sourceDatasetJobId: "dataset-index-only",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed.status).toBe("failed");
    expect(String(failed.error)).toContain("Applio produced index but no model checkpoint");
    expect(String(failed.error)).toContain("Check --save_every_weights and train logs");
    expect(failed.result).toMatchObject({
      status: "failed",
      currentStage: "failed",
      failedStage: "artifact_copy",
    });
    const failedResult = failed.result as Record<string, unknown>;
    expect(typeof failedResult.trainingFailedAt).toBe("string");
    expect(typeof failedResult.totalTrainingMs).toBe("number");
    expect(typeof failedResult.totalTrainingLabel).toBe("string");

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("fails real Applio training clearly when APPLIO_SAVE_EVERY_WEIGHTS is invalid", async () => {
    const manifestPath = writeReadyTrainingManifest("owner-a", "char-applio-save-weights-invalid", "dataset-save-weights-invalid", {
      generationMode: "real",
      mock: false,
      generatedClipCount: 200,
      status: "voice_pack_ready",
    });
    configureFakeApplioPaths("applio-save-weights-invalid");
    process.env.OTG_ENABLE_REAL_APPLIO_TRAINING = "1";
    process.env.OTG_APPLIO_TRAINING_TEST_MODE = "success";
    process.env.APPLIO_SAVE_EVERY_WEIGHTS = "yes";
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-applio-save-weights-invalid",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-applio-save-weights-invalid&jobId=cvp_base",
      manifestPath,
      sourceDatasetJobId: "dataset-save-weights-invalid",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed.status).toBe("failed");
    expect(String(failed.error)).toContain("APPLIO_SAVE_EVERY_WEIGHTS must be True or False");

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("honors APPLIO_EXTRACT_CPU_CORES override in the real Applio extract command", async () => {
    const manifestPath = writeReadyTrainingManifest("owner-a", "char-applio-extract-cpu", "dataset-extract-cpu", {
      generationMode: "real",
      mock: false,
      generatedClipCount: 200,
      status: "voice_pack_ready",
    });
    const applioPaths = configureFakeApplioPaths("applio-extract-cpu");
    process.env.OTG_ENABLE_REAL_APPLIO_TRAINING = "1";
    process.env.OTG_APPLIO_TRAINING_TEST_MODE = "success";
    process.env.APPLIO_EXTRACT_CPU_CORES = "4";
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-applio-extract-cpu",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-applio-extract-cpu&jobId=cvp_base",
      manifestPath,
      sourceDatasetJobId: "dataset-extract-cpu",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(completed.status).toBe("completed");
    const result = completed.result as Record<string, unknown>;
    const commandLog = JSON.parse(fs.readFileSync(String(result.commandPath), "utf8"));
    const extractCommand = commandLog.commands.find((command: { step: string }) => command.step === "extract");
    expect(commandLog.cwd).toBe(applioPaths.root);
    expect(extractCommand.cwd).toBe(applioPaths.root);
    expect(extractCommand.args).toContain("--cpu_cores");
    expect(extractCommand.args[extractCommand.args.indexOf("--cpu_cores") + 1]).toBe("4");
    expect(commandLog.validation.extractCpuCores).toBe(4);

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("honors APPLIO_INCLUDE_MUTES override in the real Applio extract command", async () => {
    const manifestPath = writeReadyTrainingManifest("owner-a", "char-applio-include-mutes", "dataset-include-mutes", {
      generationMode: "real",
      mock: false,
      generatedClipCount: 200,
      status: "voice_pack_ready",
    });
    const applioPaths = configureFakeApplioPaths("applio-include-mutes");
    process.env.OTG_ENABLE_REAL_APPLIO_TRAINING = "1";
    process.env.OTG_APPLIO_TRAINING_TEST_MODE = "success";
    process.env.APPLIO_INCLUDE_MUTES = "5";
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-applio-include-mutes",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-applio-include-mutes&jobId=cvp_base",
      manifestPath,
      sourceDatasetJobId: "dataset-include-mutes",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(completed.status).toBe("completed");
    const result = completed.result as Record<string, unknown>;
    const commandLog = JSON.parse(fs.readFileSync(String(result.commandPath), "utf8"));
    const extractCommand = commandLog.commands.find((command: { step: string }) => command.step === "extract");
    expect(commandLog.cwd).toBe(applioPaths.root);
    expect(extractCommand.cwd).toBe(applioPaths.root);
    expect(extractCommand.args).toContain("--include_mutes");
    expect(extractCommand.args[extractCommand.args.indexOf("--include_mutes") + 1]).toBe("5");

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("fails real Applio training clearly when APPLIO_EXTRACT_CPU_CORES is invalid", async () => {
    const manifestPath = writeReadyTrainingManifest("owner-a", "char-applio-cpu-invalid", "dataset-cpu-invalid", {
      generationMode: "real",
      mock: false,
      generatedClipCount: 200,
      status: "voice_pack_ready",
    });
    configureFakeApplioPaths("applio-cpu-invalid");
    process.env.OTG_ENABLE_REAL_APPLIO_TRAINING = "1";
    process.env.OTG_APPLIO_TRAINING_TEST_MODE = "success";
    process.env.APPLIO_EXTRACT_CPU_CORES = "0";
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-applio-cpu-invalid",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-applio-cpu-invalid&jobId=cvp_base",
      manifestPath,
      sourceDatasetJobId: "dataset-cpu-invalid",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed.status).toBe("failed");
    expect(String(failed.error)).toContain("APPLIO_EXTRACT_CPU_CORES must be an integer from 1 through 64");

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("fails real Applio training when extract reports a traceback despite exit code zero", async () => {
    const manifestPath = writeReadyTrainingManifest("owner-a", "char-applio-traceback", "dataset-traceback", {
      generationMode: "real",
      mock: false,
      generatedClipCount: 200,
      status: "voice_pack_ready",
    });
    configureFakeApplioPaths("applio-traceback");
    process.env.OTG_ENABLE_REAL_APPLIO_TRAINING = "1";
    process.env.OTG_APPLIO_TRAINING_TEST_MODE = "stderr-traceback";
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-applio-traceback",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-applio-traceback&jobId=cvp_base",
      manifestPath,
      sourceDatasetJobId: "dataset-traceback",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed.status).toBe("failed");
    expect(String(failed.error)).toContain("Applio extract reported a traceback despite exit code 0");

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("fails real Applio training before train when extract does not create config.json", async () => {
    const manifestPath = writeReadyTrainingManifest("owner-a", "char-applio-missing-config", "dataset-missing-config", {
      generationMode: "real",
      mock: false,
      generatedClipCount: 200,
      status: "voice_pack_ready",
    });
    configureFakeApplioPaths("applio-missing-config");
    process.env.OTG_ENABLE_REAL_APPLIO_TRAINING = "1";
    process.env.OTG_APPLIO_TRAINING_TEST_MODE = "missing-config";
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-applio-missing-config",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-applio-missing-config&jobId=cvp_base",
      manifestPath,
      sourceDatasetJobId: "dataset-missing-config",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed.status).toBe("failed");
    expect(String(failed.error)).toContain("Applio extract completed but training config.json was not created or is empty");
    expect(String(failed.error)).toContain(path.join("logs", "voice_model_char-applio-missing-config"));

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("fails real Applio training before train when extract leaves an empty filelist", async () => {
    const manifestPath = writeReadyTrainingManifest("owner-a", "char-applio-empty-filelist", "dataset-empty-filelist", {
      generationMode: "real",
      mock: false,
      generatedClipCount: 200,
      status: "voice_pack_ready",
    });
    configureFakeApplioPaths("applio-empty-filelist");
    process.env.OTG_ENABLE_REAL_APPLIO_TRAINING = "1";
    process.env.OTG_APPLIO_TRAINING_TEST_MODE = "empty-filelist";
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-applio-empty-filelist",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-applio-empty-filelist&jobId=cvp_base",
      manifestPath,
      sourceDatasetJobId: "dataset-empty-filelist",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed.status).toBe("failed");
    expect(String(failed.error)).toContain("filelist.txt is empty");
    expect(String(failed.error)).toContain("rmvpe.pt");

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("fails real Applio training clearly when the configured F0 predictor model is missing", async () => {
    const manifestPath = writeReadyTrainingManifest("owner-a", "char-applio-missing-rmvpe", "dataset-missing-rmvpe", {
      generationMode: "real",
      mock: false,
      generatedClipCount: 200,
      status: "voice_pack_ready",
    });
    configureFakeApplioPaths("applio-missing-rmvpe");
    process.env.OTG_ENABLE_REAL_APPLIO_TRAINING = "1";
    process.env.APPLIO_PRETRAINED = "False";
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-applio-missing-rmvpe",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-applio-missing-rmvpe&jobId=cvp_base",
      manifestPath,
      sourceDatasetJobId: "dataset-missing-rmvpe",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed.status).toBe("failed");
    expect(String(failed.error)).toContain("Missing required Applio RMVPE predictor model");
    expect(String(failed.error)).toContain(path.join("rvc", "models", "predictors", "rmvpe.pt"));

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("fails real Applio training clearly when default pretrained checkpoints are missing", async () => {
    const manifestPath = writeReadyTrainingManifest("owner-a", "char-applio-missing-pretrained", "dataset-missing-pretrained", {
      generationMode: "real",
      mock: false,
      generatedClipCount: 200,
      status: "voice_pack_ready",
    });
    const applioPaths = configureFakeApplioPaths("applio-missing-pretrained");
    fs.mkdirSync(path.join(applioPaths.root, "rvc", "models", "predictors"), { recursive: true });
    fs.writeFileSync(path.join(applioPaths.root, "rvc", "models", "predictors", "rmvpe.pt"), "fake rmvpe", "utf8");
    process.env.OTG_ENABLE_REAL_APPLIO_TRAINING = "1";
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-applio-missing-pretrained",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-applio-missing-pretrained&jobId=cvp_base",
      manifestPath,
      sourceDatasetJobId: "dataset-missing-pretrained",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed.status).toBe("failed");
    expect(String(failed.error)).toContain("Missing required Applio generator pretrained checkpoint");
    expect(String(failed.error)).toContain(path.join("rvc", "models", "pretraineds", "hifi-gan", "f0G40k.pth"));

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("fails real Applio training clearly when APPLIO_CUT_PREPROCESS is invalid", async () => {
    const manifestPath = writeReadyTrainingManifest("owner-a", "char-applio-cut-invalid", "dataset-cut-invalid", {
      generationMode: "real",
      mock: false,
      generatedClipCount: 200,
      status: "voice_pack_ready",
    });
    configureFakeApplioPaths("applio-cut-invalid");
    process.env.OTG_ENABLE_REAL_APPLIO_TRAINING = "1";
    process.env.OTG_APPLIO_TRAINING_TEST_MODE = "success";
    process.env.APPLIO_CUT_PREPROCESS = "Fast";
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-applio-cut-invalid",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-applio-cut-invalid&jobId=cvp_base",
      manifestPath,
      sourceDatasetJobId: "dataset-cut-invalid",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed.status).toBe("failed");
    expect(String(failed.error)).toContain("APPLIO_CUT_PREPROCESS must be one of Skip, Simple, or Automatic");

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("fails real Applio training clearly when APPLIO_INCLUDE_MUTES is invalid", async () => {
    const manifestPath = writeReadyTrainingManifest("owner-a", "char-applio-mutes-invalid", "dataset-mutes-invalid", {
      generationMode: "real",
      mock: false,
      generatedClipCount: 200,
      status: "voice_pack_ready",
    });
    configureFakeApplioPaths("applio-mutes-invalid");
    process.env.OTG_ENABLE_REAL_APPLIO_TRAINING = "1";
    process.env.OTG_APPLIO_TRAINING_TEST_MODE = "success";
    process.env.APPLIO_INCLUDE_MUTES = "11";
    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-applio-mutes-invalid",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-applio-mutes-invalid&jobId=cvp_base",
      manifestPath,
      sourceDatasetJobId: "dataset-mutes-invalid",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed.status).toBe("failed");
    expect(String(failed.error)).toContain("APPLIO_INCLUDE_MUTES must be an integer from 0 through 10");

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
  });

  it("uses the latest dataset manifest scoped to owner and character when none is provided", async () => {
    const otherApprovedSamplePath = writeApprovedTrainingSample("owner-b", "char-3", "cvp_other", "sample.wav");
    const targetApprovedSamplePath = writeApprovedTrainingSample("owner-a", "char-3", "cvp_target", "sample.wav");
    process.env.OTG_ALLOW_MOCK_VOICE_PACK = "1";
    process.env.OTG_TRAINING_DATASET_FFMPEG_TEST_MODE = "copy";
    process.env.VOICE_PACK_CHUNK_SIZE = "200";
    const otherOwnerDataset = createCharacterVoicePipelineJob("owner-b", {
      action: "generate_training_dataset",
      characterId: "char-3",
      trainingPreset: "balanced",
      requestedClipCount: 200,
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-b&characterId=char-3&jobId=cvp_other",
      approvedSamplePath: otherApprovedSamplePath,
    });
    const targetDataset = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_training_dataset",
      characterId: "char-3",
      trainingPreset: "balanced",
      requestedClipCount: 200,
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-3&jobId=cvp_target",
      approvedSamplePath: targetApprovedSamplePath,
    });
    expect(otherOwnerDataset.ok).toBe(true);
    expect(targetDataset.ok).toBe(true);
    if (!otherOwnerDataset.ok || !targetDataset.ok) throw new Error("Expected dataset jobs.");

    await tickVoicePipelineWorker("owner-b");
    await tickVoicePipelineWorker("owner-b");
    await tickVoicePipelineWorker("owner-b");
    await tickVoicePipelineWorker("owner-b");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const targetCompleted = (await tickVoicePipelineWorker("owner-a")).jobs[0];
    const targetResult = targetCompleted.result as Record<string, unknown>;

    const training = createCharacterVoicePipelineJob("owner-a", {
      action: "start_applio_training",
      characterId: "char-3",
      trainingPreset: "balanced",
      approvedSampleUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-3&jobId=cvp_target",
    });
    expect(training.ok).toBe(true);
    if (!training.ok) throw new Error(training.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(completed).toMatchObject({
      status: "completed",
      result: {
        adapter: "applio_training_artifact",
        manifestPath: targetResult.manifestPath,
      },
    });

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a"), { recursive: true, force: true });
    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-b"), { recursive: true, force: true });
  }, 10_000);

  function configureFakeQwenPaths(label: string) {
    const root = path.join(tempDir, label);
    const sitePackages = path.join(root, "site-packages");
    const python = path.join(root, "python.exe");
    const bridge = path.join(root, "qwen3_voice_design_preview.py");
    fs.mkdirSync(sitePackages, { recursive: true });
    fs.writeFileSync(python, "fake python", "utf8");
    fs.writeFileSync(bridge, "fake bridge", "utf8");
    process.env.OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE = "1";
    process.env.QWEN_TTS_ROOT = root;
    process.env.QWEN_TTS_PYTHON = python;
    process.env.QWEN_TTS_SITE_PACKAGES = sitePackages;
    process.env.QWEN_TTS_BRIDGE = bridge;
    return { root, sitePackages, python, bridge };
  }

  function configureFakeCosyPaths(label: string) {
    const root = path.join(tempDir, label);
    const sitePackages = path.join(root, "site-packages");
    const python = path.join(root, "python.exe");
    const bridge = path.join(root, "cosy_voice_sample_bridge.py");
    const batchBridge = path.join(root, "index_tts2_clone_pack_bridge.py");
    fs.mkdirSync(sitePackages, { recursive: true });
    fs.writeFileSync(python, "fake python", "utf8");
    fs.writeFileSync(bridge, "fake bridge", "utf8");
    fs.writeFileSync(batchBridge, "fake batch bridge", "utf8");
    process.env.OTG_ENABLE_REAL_COSY_VOICE_SAMPLE = "1";
    process.env.COSYVOICE_ROOT = root;
    process.env.COSYVOICE_PYTHON = python;
    process.env.COSYVOICE_SITE_PACKAGES = sitePackages;
    process.env.COSYVOICE_BRIDGE = bridge;
    process.env.COSYVOICE_BATCH_BRIDGE = batchBridge;
    return { root, sitePackages, python, bridge, batchBridge };
  }

  function configureFakeIndexTts2Paths(label: string) {
    const root = path.join(tempDir, label);
    const python = path.join(root, "python.exe");
    const bridge = path.join(root, "index_tts2_clone_pack_bridge.py");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(python, "fake python", "utf8");
    fs.writeFileSync(bridge, "fake IndexTTS2 bridge", "utf8");
    process.env.INDEXTTS2_PYTHON = python;
    process.env.INDEXTTS2_BATCH_BRIDGE = bridge;
    return { root, python, bridge };
  }

  function writeTinyWav(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from("RIFF$\u0000\u0000\u0000WAVEfmt ", "binary"));
  }

  function writeApprovedTrainingSample(owner: string, characterId: string, jobId: string, fileName: "sample.wav" | "fx.wav") {
    const filePath = path.join(process.cwd(), "data", "characters", owner, "voice-samples", characterId, jobId, fileName);
    writeTinyWav(filePath);
    return filePath;
  }

  function configureFakeApplioPaths(label: string) {
    const root = path.join(tempDir, label);
    const python = path.join(root, "python.exe");
    const coreScript = path.join(root, "core.py");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(python, "fake python", "utf8");
    fs.writeFileSync(coreScript, "fake core", "utf8");
    process.env.APPLIO_ROOT = root;
    process.env.APPLIO_PYTHON = python;
    process.env.APPLIO_TRAIN_SCRIPT = coreScript;
    process.env.APPLIO_INFER_SCRIPT = coreScript;
    process.env.APPLIO_DATASETS_ROOT = path.join(tempDir, `${label}-datasets`);
    process.env.APPLIO_MODELS_ROOT = path.join(tempDir, `${label}-models`);
    process.env.APPLIO_LOGS_ROOT = path.join(tempDir, `${label}-logs`);
    return { root, python, coreScript };
  }

  function writeReadyTrainingManifest(
    owner: string,
    characterId: string,
    datasetJobId: string,
    options: {
      generationMode: "real" | "mock_copy";
      mock: boolean;
      generatedClipCount: number;
      status: "manifest_ready" | "voice_pack_ready";
    },
  ) {
    const root = path.join(process.cwd(), "data", "characters", owner, "training-datasets", characterId, datasetJobId);
    const clipsDir = path.join(root, "clips");
    const sourceDir = path.join(root, "source");
    fs.mkdirSync(clipsDir, { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });
    const sourcePath = path.join(sourceDir, "source.wav");
    writeTinyWav(sourcePath);
    const clips = Array.from({ length: 200 }, (_, index) => {
      const clipId = `clip_${String(index + 1).padStart(3, "0")}`;
      const clipPath = path.join(clipsDir, `${clipId}.wav`);
      writeTinyWav(clipPath);
      return {
        clipId,
        index,
        text: `Training line ${index + 1}`,
        status: index < options.generatedClipCount ? "ready" : "pending",
        expectedAudioPath: clipPath,
        expectedAudioUrl: `/api/characters/training-dataset/file?owner=${owner}&characterId=${characterId}&jobId=${datasetJobId}&clipId=${clipId}`,
        sourceSamplePath: sourcePath,
        sourceSampleUrl: `/api/characters/training-dataset/file?owner=${owner}&characterId=${characterId}&jobId=${datasetJobId}&file=source.wav`,
        generatorProvider: options.generationMode === "real" ? "qwen3" : undefined,
      };
    });
    const manifestPath = path.join(root, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      ownerKey: owner,
      characterId,
      jobId: datasetJobId,
      createdAt: new Date().toISOString(),
      source: {
        approvedSampleUrl: `/api/characters/voice-sample/file?owner=${owner}&characterId=${characterId}&jobId=cvp_base`,
        approvedSamplePath: sourcePath,
        approvedSampleType: "base",
        approvedSourceJobId: "cvp_base",
        baseSampleUrl: `/api/characters/voice-sample/file?owner=${owner}&characterId=${characterId}&jobId=cvp_base`,
        tunedSampleUrl: "",
        tunedFxPreset: "",
        originalSourcePath: sourcePath,
        originalSourceUrl: `/api/characters/training-dataset/file?owner=${owner}&characterId=${characterId}&jobId=${datasetJobId}&file=source.wav`,
        canonicalSourcePath: sourcePath,
        canonicalSourceUrl: `/api/characters/training-dataset/file?owner=${owner}&characterId=${characterId}&jobId=${datasetJobId}&file=source.wav`,
        sourceFormat: ".wav",
        sampleRate: 40000,
        channels: 1,
      },
      logs: {
        paramsPath: path.join(root, "logs", "params.json"),
        stdoutPath: path.join(root, "logs", "stdout.log"),
        stderrPath: path.join(root, "logs", "stderr.log"),
      },
      generationMode: options.generationMode,
      provider: options.generationMode === "real" ? "qwen3" : "mock",
      startedAt: new Date().toISOString(),
      completedAt: options.status === "voice_pack_ready" ? new Date().toISOString() : null,
      requestedClipCount: 200,
      generatedClipCount: options.generatedClipCount,
      clips,
      status: options.status,
      mock: options.mock,
      note: "test manifest",
    }, null, 2), "utf8");
    return manifestPath;
  }

  it("fails qwen3 create_voice_sample clearly when real adapter is enabled but config is missing", async () => {
    const missingDir = path.join(tempDir, "missing-qwen-root");
    process.env.OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE = "1";
    process.env.QWEN_TTS_ROOT = missingDir;
    process.env.QWEN_TTS_PYTHON = path.join(missingDir, "python.exe");
    process.env.QWEN_TTS_SITE_PACKAGES = path.join(missingDir, "site-packages");
    process.env.QWEN_TTS_BRIDGE = path.join(missingDir, "qwen3_voice_design_preview.py");

    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "qwen3",
      prompt: "clear heroic voice",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed).toMatchObject({ status: "failed", progress: 100 });
    expect(failed.message).toContain("Qwen3 voice sample generation failed");
    expect(failed.error).toContain("Qwen3-TTS root not found");
    expect(failed.error).toContain(missingDir);
  });

  it("returns the real qwen3 result contract when the adapter succeeds in test mode", async () => {
    configureFakeQwenPaths("qwen-success");
    process.env.OTG_QWEN3_VOICE_SAMPLE_TEST_MODE = "success";
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "qwen3",
      prompt: "clear heroic voice",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    expect((await tickVoicePipelineWorker("owner-a")).jobs[0].message).toContain("Qwen3 real adapter selected");
    expect((await tickVoicePipelineWorker("owner-a")).jobs[0].message).toContain("outputDir");
    expect((await tickVoicePipelineWorker("owner-a")).jobs[0].message).toContain("ready to execute bridge");
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(completed).toMatchObject({
      status: "completed",
      progress: 100,
      result: {
        provider: "qwen3",
        adapter: "qwen3",
        mock: false,
      },
    });
    const result = completed.result as Record<string, unknown>;
    expect(String(result.samplePath || "")).toContain(`${created.job.jobId}`);
    expect(String(result.sampleUrl || "")).toContain("/api/characters/voice-sample/file?");
    expect(String(result.sampleUrl || "")).toContain("owner=owner-a");
    expect(String(result.sampleUrl || "")).toContain("characterId=char-1");
    expect(String(result.sampleUrl || "")).toContain(`jobId=${created.job.jobId}`);
    expect(String(result.logsPath || "")).toContain("logs");
    expect(String(result.paramsPath || "")).toContain("qwen3_sample_params.json");
    expect(Number(result.outputBytes || 0)).toBeGreaterThan(0);
    expect(fs.existsSync(String(result.samplePath))).toBe(true);
  });

  it("passes explicit voiceInstruction and sampleText to qwen3 instead of stale legacy notes", async () => {
    configureFakeQwenPaths("qwen-instruction-precedence");
    process.env.OTG_QWEN3_VOICE_SAMPLE_TEST_MODE = "success";
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "qwen3",
      voiceInstruction: "Design a consistent adult male voice with low pitch.",
      sampleText: "This is the separated sample phrase.",
      previewText: "This is the separated sample phrase.",
      qwenVoiceDesignRecord: {
        fullQwenInstruction: "Design an elderly woman voice. This stale instruction must not be used.",
      },
      voiceDesign: {
        voiceGender: "male",
        ageRange: "adult",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];
    expect(completed.status).toBe("completed");

    const paramsPath = String((completed.result as Record<string, unknown>).paramsPath || "");
    const params = JSON.parse(fs.readFileSync(paramsPath, "utf8"));
    expect(params.qwen_instruction).toBe("Design a consistent adult male voice with low pitch.");
    expect(params.voice_instruction).toBe("Design a consistent adult male voice with low pitch.");
    expect(params.text).toBe("This is the separated sample phrase.");
    expect(params.sample_text).toBe("This is the separated sample phrase.");
    expect(params.qwen_instruction).not.toContain("elderly woman");
    expect(params.voice_design).toMatchObject({ voiceGender: "male", ageRange: "adult" });
  });

  it("fails cleanly when qwen3 exits without creating output", async () => {
    configureFakeQwenPaths("qwen-no-output");
    process.env.OTG_QWEN3_VOICE_SAMPLE_TEST_MODE = "no_output";
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "qwen3",
      prompt: "clear heroic voice",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed.status).toBe("failed");
    expect(failed.progress).toBe(100);
    expect(failed.error).toContain("finished without writing voice sample WAV");
    expect(failed.message).toContain("stderr:");
  });

  it("fails non-qwen3 providers clearly instead of returning mock output when qwen3 real adapter is enabled", async () => {
    process.env.OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE = "1";
    process.env.QWEN_TTS_ROOT = path.join(tempDir, "missing-qwen-root");

    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "cosy",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed).toMatchObject({
      status: "failed",
      error: "Real create_voice_sample worker required. Start the Qwen3-TTS or CosyVoice worker with real model env enabled.",
    });
  });

  it("fails cosy create_voice_sample clearly when the cosy adapter is disabled", async () => {
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "cosy",
      prompt: "warm narrator",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed).toMatchObject({
      status: "failed",
      error: "Real create_voice_sample worker required. Start the Qwen3-TTS or CosyVoice worker with real model env enabled.",
    });
  });

  it("fails cosy create_voice_sample clearly when real adapter is enabled but config is missing", async () => {
    process.env.OTG_ENABLE_REAL_COSY_VOICE_SAMPLE = "1";
    delete process.env.COSYVOICE_ROOT;
    delete process.env.COSYVOICE_PYTHON;
    delete process.env.COSYVOICE_SITE_PACKAGES;
    delete process.env.COSYVOICE_BRIDGE;

    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "cosy",
      prompt: "warm narrator",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    expect((await tickVoicePipelineWorker("owner-a")).jobs[0].message).toContain("Cosy real adapter selected");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed).toMatchObject({ status: "failed", progress: 100 });
    expect(failed.message).toContain("Cosy voice sample generation failed");
    expect(failed.error).toContain("COSYVOICE_ROOT is required");
  });

  it("returns the real cosy result contract when the adapter succeeds in test mode", async () => {
    configureFakeCosyPaths("cosy-success");
    process.env.OTG_COSY_VOICE_SAMPLE_TEST_MODE = "success";
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "cosy",
      prompt: "warm narrator",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    expect((await tickVoicePipelineWorker("owner-a")).jobs[0].message).toContain("Cosy real adapter selected");
    expect((await tickVoicePipelineWorker("owner-a")).jobs[0].message).toContain("outputDir");
    expect((await tickVoicePipelineWorker("owner-a")).jobs[0].message).toContain("ready to execute bridge");
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(completed).toMatchObject({
      status: "completed",
      progress: 100,
      result: {
        provider: "cosy",
        adapter: "cosy",
        mock: false,
      },
    });
    const result = completed.result as Record<string, unknown>;
    expect(String(result.samplePath || "")).toContain(`${created.job.jobId}`);
    expect(String(result.sampleUrl || "")).toContain("/api/characters/voice-sample/file?");
    expect(String(result.sampleUrl || "")).toContain("owner=owner-a");
    expect(String(result.sampleUrl || "")).toContain("characterId=char-1");
    expect(String(result.sampleUrl || "")).toContain(`jobId=${created.job.jobId}`);
    expect(String(result.logsPath || "")).toContain("logs");
    expect(String(result.paramsPath || "")).toContain("cosy_sample_params.json");
    expect(Number(result.outputBytes || 0)).toBeGreaterThan(0);
    expect(fs.existsSync(String(result.samplePath))).toBe(true);
  });

  it("fails cleanly when cosy exits without creating output", async () => {
    configureFakeCosyPaths("cosy-no-output");
    process.env.OTG_COSY_VOICE_SAMPLE_TEST_MODE = "no_output";
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      characterId: "char-1",
      provider: "cosy",
      prompt: "warm narrator",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed.status).toBe("failed");
    expect(failed.progress).toBe(100);
    expect(failed.error).toContain("finished without writing voice sample WAV");
    expect(failed.message).toContain("stderr:");
  });

  it("keeps apply_voice_fx on the no-op path when the real FX adapter is disabled", async () => {
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "apply_voice_fx",
      characterId: "char-1",
      fxPreset: "echo",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(completed).toMatchObject({
      status: "completed",
      result: {
        fxSampleUrl: `/mock-assets/voices/${created.job.jobId}/fx.wav`,
      },
    });
  });

  it("fails real apply_voice_fx clearly when the input sample is missing", async () => {
    process.env.OTG_ENABLE_REAL_VOICE_FX = "1";
    process.env.OTG_VOICE_FX_TEST_MODE = "success";
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "apply_voice_fx",
      characterId: "char-1",
      fxPreset: "echo",
      inputPath: path.join(tempDir, "missing.wav"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed).toMatchObject({ status: "failed", progress: 100 });
    expect(failed.error).toContain("Voice FX source sample not found");
  });

  it("fails real apply_voice_fx clearly when ffmpeg is missing", async () => {
    const inputPath = path.join(tempDir, "voice-fx-source.wav");
    writeTinyWav(inputPath);
    process.env.OTG_ENABLE_REAL_VOICE_FX = "1";
    process.env.OTG_VOICE_FX_TEST_MODE = "success";
    process.env.VOICE_FX_FFMPEG = path.join(tempDir, "missing-ffmpeg.exe");
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "apply_voice_fx",
      characterId: "char-1",
      fxPreset: "echo",
      inputPath,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed).toMatchObject({ status: "failed", progress: 100 });
    expect(failed.error).toContain("Voice FX ffmpeg not found");
  });

  it("returns the real voice FX result contract in test mode", async () => {
    const inputPath = path.join(tempDir, "voice-fx-source-success.wav");
    writeTinyWav(inputPath);
    process.env.OTG_ENABLE_REAL_VOICE_FX = "1";
    process.env.OTG_VOICE_FX_TEST_MODE = "success";
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "apply_voice_fx",
      characterId: "char-1",
      fxPreset: "radio",
      inputPath,
      speed: 1.05,
      gainDb: 2,
      normalize: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(completed).toMatchObject({
      status: "completed",
      progress: 100,
      result: {
        adapter: "voice_fx",
        mock: false,
        fxPreset: "radio",
      },
    });
    const result = completed.result as Record<string, unknown>;
    expect(String(result.sourceSamplePath)).toBe(inputPath);
    expect(String(result.processedSamplePath || "")).toContain("fx.wav");
    expect(String(result.processedSampleUrl || "")).toContain("file=fx.wav");
    expect(Number(result.outputBytes || 0)).toBeGreaterThan(0);
    expect(fs.existsSync(String(result.processedSamplePath))).toBe(true);
  });

  it("voice sample route serves fx.wav and rejects unknown file names", async () => {
    const owner = "route-owner";
    const characterId = "char-1";
    const jobId = "job-1";
    const dir = path.join(process.cwd(), "data", "characters", owner, "voice-samples", characterId, jobId);
    const fxPath = path.join(dir, "fx.wav");
    writeTinyWav(fxPath);

    const { HEAD } = await import("@/app/api/characters/voice-sample/file/route");
    const okRequest = new NextRequest(`http://localhost/api/characters/voice-sample/file?owner=${owner}&characterId=${characterId}&jobId=${jobId}&file=fx.wav`);
    const okResponse = await HEAD(okRequest);
    expect(okResponse.status).toBe(200);
    expect(okResponse.headers.get("x-otg-resolved-file")).toBe("fx.wav");

    const badRequest = new NextRequest(`http://localhost/api/characters/voice-sample/file?owner=${owner}&characterId=${characterId}&jobId=${jobId}&file=../bad.wav`);
    const badResponse = await HEAD(badRequest);
    expect(badResponse.status).toBe(400);

    fs.rmSync(path.join(process.cwd(), "data", "characters", owner), { recursive: true, force: true });
  });

  it("fails trained Applio voice playback when the .pth model is missing", async () => {
    const applioPaths = configureFakeApplioPaths("applio-infer-missing-pth");
    const inputAudioPath = path.join(tempDir, "applio-infer-input.wav");
    const indexPath = path.join(tempDir, "applio-infer-model.index");
    writeTinyWav(inputAudioPath);
    fs.writeFileSync(indexPath, "fake index", "utf8");
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "test_trained_voice",
      characterId: "char-infer-missing-pth",
      trainedModelPath: path.join(applioPaths.root, "missing.pth"),
      trainedIndexPath: indexPath,
      inputAudioPath,
      trainedArtifactMock: false,
      trainedAdapter: "applio_real_training",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed).toMatchObject({ status: "failed", progress: 100 });
    expect(String(failed.error)).toContain("Trained Applio .pth model is missing or empty");
  });

  it("fails trained Applio voice playback when the .index is missing", async () => {
    const applioPaths = configureFakeApplioPaths("applio-infer-missing-index");
    const inputAudioPath = path.join(tempDir, "applio-infer-input-index.wav");
    const modelPath = path.join(tempDir, "applio-infer-model.pth");
    writeTinyWav(inputAudioPath);
    fs.writeFileSync(modelPath, "fake pth", "utf8");
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "test_trained_voice",
      characterId: "char-infer-missing-index",
      trainedModelPath: modelPath,
      trainedIndexPath: path.join(applioPaths.root, "missing.index"),
      inputAudioPath,
      trainedArtifactMock: false,
      trainedAdapter: "applio_real_training",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed).toMatchObject({ status: "failed", progress: 100 });
    expect(String(failed.error)).toContain("Trained Applio .index is missing or empty");
  });

  it("returns a real trained Applio inference contract in test mode", async () => {
    const applioPaths = configureFakeApplioPaths("applio-infer-success");
    process.env.OTG_APPLIO_INFERENCE_TEST_MODE = "success";
    const inputAudioPath = path.join(tempDir, "applio-infer-success-input.wav");
    const modelPath = path.join(tempDir, "applio-infer-success-model.pth");
    const indexPath = path.join(tempDir, "applio-infer-success-model.index");
    writeTinyWav(inputAudioPath);
    fs.writeFileSync(modelPath, "fake pth", "utf8");
    fs.writeFileSync(indexPath, "fake index", "utf8");
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "test_trained_voice",
      characterId: "char-infer-success",
      trainedArtifactId: "voice_model_char-infer-success",
      trainedModelPath: modelPath,
      trainedIndexPath: indexPath,
      inputAudioPath,
      inputAudioUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-infer-success&jobId=cvp_base",
      trainedArtifactMock: false,
      trainedAdapter: "applio_real_training",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    expect((await tickVoicePipelineWorker("owner-a")).jobs[0].message).toContain("Applio trained voice inference selected");
    expect((await tickVoicePipelineWorker("owner-a")).jobs[0].message).toContain("output prepared");
    expect((await tickVoicePipelineWorker("owner-a")).jobs[0].message).toContain("ready to execute inference");
    const completed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(completed).toMatchObject({
      status: "completed",
      progress: 100,
      result: {
        adapter: "applio_real_inference",
        mock: false,
        provider: "applio",
        trainedModelPath: modelPath,
        trainedIndexPath: indexPath,
        inputAudioPath,
      },
    });
    const result = completed.result as Record<string, unknown>;
    expect(String(result.outputAudioUrl || "")).toContain("/api/characters/applio-inference/file?");
    expect(Number(result.outputBytes || 0)).toBeGreaterThan(0);
    expect(String(result.outputAudioPath || "")).toContain(path.join("characters", "owner-a", "applio-inference", "char-infer-success"));
    expect(fs.existsSync(String(result.outputAudioPath))).toBe(true);
    expect(result.inputSha256).not.toBe(result.outputSha256);

    const commandLog = JSON.parse(fs.readFileSync(String(result.commandPath), "utf8"));
    expect(commandLog.cwd).toBe(applioPaths.root);
    expect(commandLog.args).toContain("infer");
    expect(commandLog.args).toContain("--pth_path");
    expect(commandLog.args[commandLog.args.indexOf("--pth_path") + 1]).toBe(modelPath);
    expect(commandLog.args).toContain("--index_path");
    expect(commandLog.args[commandLog.args.indexOf("--index_path") + 1]).toBe(indexPath);

    const { HEAD } = await import("@/app/api/characters/applio-inference/file/route");
    const response = await HEAD(new NextRequest(`http://localhost${String(result.outputAudioUrl)}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("x-otg-applio-inference-file")).toBe("1");

    fs.rmSync(path.join(process.cwd(), "data", "characters", "owner-a", "applio-inference", "char-infer-success"), { recursive: true, force: true });
  });

  it("fails trained Applio voice playback when inference output is identical to the input", async () => {
    configureFakeApplioPaths("applio-infer-same-hash");
    process.env.OTG_APPLIO_INFERENCE_TEST_MODE = "same-hash";
    const inputAudioPath = path.join(tempDir, "applio-infer-same-input.wav");
    const modelPath = path.join(tempDir, "applio-infer-same-model.pth");
    const indexPath = path.join(tempDir, "applio-infer-same-model.index");
    writeTinyWav(inputAudioPath);
    fs.writeFileSync(modelPath, "fake pth", "utf8");
    fs.writeFileSync(indexPath, "fake index", "utf8");
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "test_trained_voice",
      characterId: "char-infer-same-hash",
      trainedModelPath: modelPath,
      trainedIndexPath: indexPath,
      inputAudioPath,
      trainedArtifactMock: false,
      trainedAdapter: "applio_real_training",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    await tickVoicePipelineWorker("owner-a");
    const failed = (await tickVoicePipelineWorker("owner-a")).jobs[0];

    expect(failed).toMatchObject({ status: "failed", progress: 100 });
    expect(String(failed.error)).toContain("byte-identical to the input audio");
    expect(String(failed.message)).toContain("stderr:");
  });

  it("does not reprocess completed, failed, or canceled jobs", async () => {
    const completed = createCharacterVoicePipelineJob("owner-a", {
      action: "save_voice_to_character",
      characterId: "char-1",
    });
    const failed = createProductionAudioStudioJob("owner-a", {
      action: "dub_existing_voice",
      clipId: "clip-1",
    });
    const canceled = createProductionAudioStudioJob("owner-a", {
      action: "add_voice_to_clip",
      clipId: "clip-2",
    });
    if (!completed.ok || !failed.ok || !canceled.ok) throw new Error("Expected queued jobs.");

    updateVoicePipelineJob("owner-a", completed.job.jobId, { status: "completed", result: { saved: true } });
    updateVoicePipelineJob("owner-a", failed.job.jobId, { status: "failed", error: "Already failed." });
    updateVoicePipelineJob("owner-a", canceled.job.jobId, { status: "canceled", message: "Canceled by user." });

    await expect(tickVoicePipelineWorker("owner-a")).resolves.toEqual({ processed: 0, jobs: [] });
    expect(getQueuedContractJob("owner-a", completed.job.jobId)?.status).toBe("completed");
    expect(getQueuedContractJob("owner-a", failed.job.jobId)?.status).toBe("failed");
    expect(getQueuedContractJob("owner-a", canceled.job.jobId)?.status).toBe("canceled");
  });

  it("respects owner scoping and processing limits", async () => {
    const ownerA = createCharacterVoicePipelineJob("owner-a", {
      action: "save_voice_to_character",
      characterId: "char-1",
    });
    const ownerB = createCharacterVoicePipelineJob("owner-b", {
      action: "save_voice_to_character",
      characterId: "char-2",
    });
    if (!ownerA.ok || !ownerB.ok) throw new Error("Expected queued jobs.");

    const result = await tickVoicePipelineWorker("owner-a", { limit: 1 });
    expect(result.processed).toBe(1);
    expect(result.jobs[0].jobId).toBe(ownerA.job.jobId);
    expect(getQueuedContractJob("owner-b", ownerB.job.jobId)?.status).toBe("queued");
  });

  it("can target one active job so older queued jobs do not block the UI worker tick", async () => {
    const older = createCharacterVoicePipelineJob("owner-a", {
      action: "test_character_voice",
      characterId: "char-1",
    });
    const target = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_preview_video",
      characterId: "char-1",
    });
    if (!older.ok || !target.ok) throw new Error("Expected queued jobs.");

    const result = await tickVoicePipelineWorker("owner-a", {
      limit: 1,
      jobId: target.job.jobId,
    });

    expect(result.processed).toBe(1);
    expect(result.jobs[0]).toMatchObject({
      jobId: target.job.jobId,
      status: "running",
      progress: 5,
    });
    expect(getQueuedContractJob("owner-a", older.job.jobId)?.status).toBe("queued");
  });

  it("dev tick route returns processed count and jobs", async () => {
    process.env.AUTH_SECRET ||= "test-secret-for-voice-pipeline-worker-route";
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "test_character_voice",
      characterId: "char-1",
    });
    expect(created.ok).toBe(true);

    const { POST } = await import("@/app/api/dev/voice-pipeline-worker/tick/route");
    const request = new NextRequest("http://localhost/api/dev/voice-pipeline-worker/tick", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-otg-device-id": "owner-a",
      },
      body: JSON.stringify({ limit: 1 }),
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      processed: 1,
      jobs: [{ status: "running", progress: 5 }],
    });
  });

  it("dev tick route can target a specific active job id", async () => {
    process.env.AUTH_SECRET ||= "test-secret-for-voice-pipeline-worker-route";
    const older = createCharacterVoicePipelineJob("owner-a", {
      action: "test_character_voice",
      characterId: "char-1",
    });
    const target = createCharacterVoicePipelineJob("owner-a", {
      action: "generate_preview_video",
      characterId: "char-1",
    });
    if (!older.ok || !target.ok) throw new Error("Expected queued jobs.");

    const { POST } = await import("@/app/api/dev/voice-pipeline-worker/tick/route");
    const request = new NextRequest("http://localhost/api/dev/voice-pipeline-worker/tick", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-otg-device-id": "owner-a",
      },
      body: JSON.stringify({ limit: 1, jobId: target.job.jobId }),
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      processed: 1,
      jobs: [{ jobId: target.job.jobId, status: "running", progress: 5 }],
    });
    expect(getQueuedContractJob("owner-a", older.job.jobId)?.status).toBe("queued");
  });
});
