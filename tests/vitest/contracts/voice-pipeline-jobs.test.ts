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

import {
  clearQueuedContractJobsForTests,
  createCharacterAnimationPreviewJob,
  createCharacterVoicePipelineJob,
  createProductionAudioStudioJob,
  claimRemoteWorkerJob,
  completeRemoteWorkerJob,
  getQueuedContractJob,
  getVoicePipelineJobStorePath,
  failRemoteWorkerJob,
  listVoicePipelineJobs,
  setVoicePipelineJobStorePathForTests,
  supersedePendingCreateVoiceJobs,
  resumeVoicePipelineJob,
  stopVoicePipelineJob,
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

  it("rejects invalid character voice-pipeline inputs", () => {
    expect(createCharacterVoicePipelineJob("owner-a", {}).ok).toBe(false);
    expect(createCharacterVoicePipelineJob("owner-a", { action: "missing", characterId: "char-1" })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(createCharacterVoicePipelineJob("owner-a", { action: "create_voice_sample", characterId: "char-1", provider: "bad" })).toMatchObject({
      ok: false,
      error: "Invalid provider. Expected qwen3 or cosy.",
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
});
