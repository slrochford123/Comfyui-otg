import { describe, expect, it } from "vitest";
import {
  CHARACTER_PREVIEW_DUB_SCRIPT,
  getCharacterPreviewDubSelection,
  isCharacterPreviewDubReady,
} from "@/lib/characters/characterPreviewDub";

describe("character preview dub selection", () => {
  it("selects a completed real nonzero dubbed preview video", () => {
    const selected = getCharacterPreviewDubSelection({
      jobId: "cvp_preview_1",
      action: "generate_character_preview",
      status: "completed",
      updatedAt: "2026-06-03T18:10:00.000Z",
      result: {
        mock: false,
        previewScript: CHARACTER_PREVIEW_DUB_SCRIPT,
        dubbedPreviewVideoPath: "C:/AI/OTG-Test2/data/characters/owner-a/character-preview/char-a/cvp_preview_1/final.mp4",
        dubbedPreviewVideoUrl: "/api/characters/character-preview/file?owner=owner-a&characterId=char-a&jobId=cvp_preview_1",
        outputBytes: 123456,
      },
    });

    expect(selected).toMatchObject({
      dubbedPreviewVideoUrl: "/api/characters/character-preview/file?owner=owner-a&characterId=char-a&jobId=cvp_preview_1",
      outputBytes: 123456,
      videoKey: "cvp_preview_1:123456",
      videoSrc: "/api/characters/character-preview/file?owner=owner-a&characterId=char-a&jobId=cvp_preview_1&t=2026-06-03T18%3A10%3A00.000Z",
    });
  });

  it("rejects mock, missing, zero-byte, and mock-assets preview outputs", () => {
    expect(getCharacterPreviewDubSelection({
      jobId: "cvp_mock",
      action: "generate_character_preview",
      status: "completed",
      result: { mock: true, dubbedPreviewVideoUrl: "/api/real.mp4", outputBytes: 100 },
    })).toBeNull();

    expect(getCharacterPreviewDubSelection({
      jobId: "cvp_missing",
      action: "generate_character_preview",
      status: "completed",
      result: { mock: false, outputBytes: 100 },
    })).toBeNull();

    expect(getCharacterPreviewDubSelection({
      jobId: "cvp_zero",
      action: "generate_character_preview",
      status: "completed",
      result: { mock: false, dubbedPreviewVideoUrl: "/api/real.mp4", outputBytes: 0 },
    })).toBeNull();

    expect(getCharacterPreviewDubSelection({
      jobId: "cvp_mock_asset",
      action: "generate_character_preview",
      status: "completed",
      result: { mock: false, dubbedPreviewVideoUrl: "/mock-assets/videos/cvp_mock_asset/final.mp4", outputBytes: 100 },
    })).toBeNull();
  });

  it("does not treat older audio preview jobs as final character preview", () => {
    expect(isCharacterPreviewDubReady({
      jobId: "cvp_audio",
      action: "test_trained_voice",
      status: "completed",
      result: {
        mock: false,
        outputAudioUrl: "/api/characters/applio-inference/file?jobId=cvp_audio",
        outputBytes: 481644,
      },
    })).toBe(false);
  });
});
