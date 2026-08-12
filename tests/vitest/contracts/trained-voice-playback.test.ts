import { describe, expect, it } from "vitest";
import {
  getBaseVoicePlaybackSelection,
  getTrainedVoicePlaybackSelection,
  getVoicePreviewPrimaryAction,
  selectLatestTrainedVoicePlaybackJob,
} from "@/lib/characters/trainedVoicePlayback";

describe("trained voice playback selection", () => {
  it("selects the latest completed real test_trained_voice output", () => {
    const selected = selectLatestTrainedVoicePlaybackJob([
      {
        jobId: "cvp_base_mock",
        action: "test_character_voice",
        status: "completed",
        updatedAt: "2026-06-03T17:45:00.000Z",
        result: {
          mock: true,
          previewAudioUrl: "/mock-assets/voices/cvp_base_mock/test.wav",
        },
      },
      {
        jobId: "cvp_trained_old",
        action: "test_trained_voice",
        status: "completed",
        updatedAt: "2026-06-03T17:40:00.000Z",
        result: {
          mock: false,
          outputAudioUrl: "/api/characters/applio-inference/file?owner=owner-a&characterId=char-a&jobId=cvp_trained_old",
          outputBytes: 1000,
        },
      },
      {
        jobId: "cvp_trained_new",
        action: "test_trained_voice",
        status: "completed",
        updatedAt: "2026-06-03T17:50:00.000Z",
        result: {
          mock: false,
          outputAudioUrl: "/api/characters/applio-inference/file?owner=owner-a&characterId=char-a&jobId=cvp_trained_new",
          outputBytes: 481644,
        },
      },
    ]);

    expect(selected).toMatchObject({
      outputAudioUrl: "/api/characters/applio-inference/file?owner=owner-a&characterId=char-a&jobId=cvp_trained_new",
      outputBytes: 481644,
      audioKey: "cvp_trained_new:481644",
    });
  });

  it("does not let mock or base playback jobs become trained playback audio", () => {
    expect(getTrainedVoicePlaybackSelection({
      jobId: "cvp_base",
      action: "test_character_voice",
      status: "completed",
      result: { mock: false, outputAudioUrl: "/real-base.wav", outputBytes: 100 },
    })).toBeNull();

    expect(getTrainedVoicePlaybackSelection({
      jobId: "cvp_mock",
      action: "test_trained_voice",
      status: "completed",
      result: { mock: true, outputAudioUrl: "/mock-trained.wav", outputBytes: 100 },
    })).toBeNull();
  });

  it("requires outputAudioUrl and nonzero outputBytes", () => {
    expect(getTrainedVoicePlaybackSelection({
      jobId: "cvp_missing_url",
      action: "test_trained_voice",
      status: "completed",
      result: { mock: false, outputBytes: 100 },
    })).toBeNull();

    expect(getTrainedVoicePlaybackSelection({
      jobId: "cvp_zero",
      action: "test_trained_voice",
      status: "completed",
      result: { mock: false, outputAudioUrl: "/api/characters/applio-inference/file?jobId=cvp_zero", outputBytes: 0 },
    })).toBeNull();
  });

  it("adds a cache-buster while preserving existing query parameters", () => {
    const selected = getTrainedVoicePlaybackSelection({
      jobId: "cvp_1780508534643_c12341f2a04d",
      action: "test_trained_voice",
      status: "completed",
      updatedAt: "2026-06-03T17:42:15.123Z",
      result: {
        mock: false,
        outputAudioUrl: "/api/characters/applio-inference/file?owner=slrochford12300&characterId=jorogg&jobId=cvp_1780508534643_c12341f2a04d",
        outputBytes: 481644,
      },
    });

    expect(selected?.audioSrc).toBe(
      "/api/characters/applio-inference/file?owner=slrochford12300&characterId=jorogg&jobId=cvp_1780508534643_c12341f2a04d&t=2026-06-03T17%3A42%3A15.123Z",
    );
  });

  it("does not select mock test_character_voice playback", () => {
    expect(getBaseVoicePlaybackSelection({
      jobId: "cvp_mock_base",
      action: "test_character_voice",
      status: "completed",
      updatedAt: "2026-06-03T17:55:00.000Z",
      result: {
        mock: true,
        previewAudioUrl: "/mock-assets/voices/cvp_mock_base/test.wav",
        previewBytes: 1234,
      },
    })).toBeNull();

    expect(getBaseVoicePlaybackSelection({
      jobId: "cvp_noop_base",
      action: "test_character_voice",
      status: "completed",
      updatedAt: "2026-06-03T17:56:00.000Z",
      result: {
        previewAudioUrl: "/mock-assets/voices/cvp_noop_base/test.wav",
        previewBytes: 1234,
      },
    })).toBeNull();
  });

  it("does not select missing or zero-byte base playback", () => {
    expect(getBaseVoicePlaybackSelection({
      jobId: "cvp_missing_base",
      action: "test_character_voice",
      status: "completed",
      result: { mock: false, previewBytes: 1234 },
    })).toBeNull();

    expect(getBaseVoicePlaybackSelection({
      jobId: "cvp_zero_base",
      action: "test_character_voice",
      status: "completed",
      result: { mock: false, previewAudioUrl: "/api/characters/voice-sample/file?jobId=cvp_zero_base", previewBytes: 0 },
    })).toBeNull();
  });

  it("selects valid real base playback with a cache-busted source", () => {
    const selected = getBaseVoicePlaybackSelection({
      jobId: "cvp_base_real",
      action: "test_character_voice",
      status: "completed",
      updatedAt: "2026-06-03T18:00:00.000Z",
      result: {
        mock: false,
        previewAudioUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-a&jobId=cvp_base_real&file=test.wav",
        previewBytes: 42000,
      },
    });

    expect(selected).toMatchObject({
      audioUrl: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-a&jobId=cvp_base_real&file=test.wav",
      audioBytes: 42000,
      audioKey: "cvp_base_real:42000",
      audioSrc: "/api/characters/voice-sample/file?owner=owner-a&characterId=char-a&jobId=cvp_base_real&file=test.wav&t=2026-06-03T18%3A00%3A00.000Z",
    });
  });

  it("uses test_trained_voice as the primary preview action when a trained model is ready", () => {
    expect(getVoicePreviewPrimaryAction({
      trainedVoiceReady: true,
      trainedVoiceInputAudioPath: "C:/AI/OTG-Test2/data/characters/owner-a/voice-samples/char-a/source.wav",
      voiceTestText: "Koh dah kai is ready for battle.",
      submitting: false,
    })).toMatchObject({
      action: "test_trained_voice",
      disabled: false,
      label: "Speak With Trained Voice",
      message: "Enter a sentence and generate playback using the trained voice model.",
    });
  });

  it("disables trained preview when the trained model is missing", () => {
    expect(getVoicePreviewPrimaryAction({
      trainedVoiceReady: false,
      trainedVoiceInputAudioPath: "C:/AI/OTG-Test2/data/characters/owner-a/voice-samples/char-a/source.wav",
      voiceTestText: "Koh dah kai is ready for battle.",
    })).toMatchObject({
      action: null,
      disabled: true,
      message: "Train the voice model before testing custom speech.",
    });
  });

  it("disables trained preview when the input audio or typed phrase is missing", () => {
    expect(getVoicePreviewPrimaryAction({
      trainedVoiceReady: true,
      trainedVoiceInputAudioPath: "",
      voiceTestText: "Koh dah kai is ready for battle.",
    })).toMatchObject({
      action: "test_trained_voice",
      disabled: true,
    });

    expect(getVoicePreviewPrimaryAction({
      trainedVoiceReady: true,
      trainedVoiceInputAudioPath: "C:/AI/OTG-Test2/data/characters/owner-a/voice-samples/char-a/source.wav",
      voiceTestText: " ",
    })).toMatchObject({
      action: "test_trained_voice",
      disabled: true,
    });
  });
});
