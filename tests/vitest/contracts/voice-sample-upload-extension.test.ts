import { describe, expect, it } from "vitest";

import {
  voiceSampleFileNameForExtension,
} from "@/lib/characters/voiceSampleFileName";

describe("voice sample upload extension persistence", () => {
  it("preserves primary LTX MP3 extension", () => {
    expect(
      voiceSampleFileNameForExtension(".mp3"),
    ).toBe("sample.mp3");
  });

  it("preserves RTX 5060 LTX fallback FLAC extension", () => {
    expect(
      voiceSampleFileNameForExtension(".flac"),
    ).toBe("sample.flac");
  });

  it("preserves Qwen and Cosy WAV extension", () => {
    expect(
      voiceSampleFileNameForExtension(".wav"),
    ).toBe("sample.wav");
  });

  it("preserves other already-supported audio extensions", () => {
    expect(
      voiceSampleFileNameForExtension(".m4a"),
    ).toBe("sample.m4a");

    expect(
      voiceSampleFileNameForExtension(".ogg"),
    ).toBe("sample.ogg");
  });

  it("normalizes extension casing", () => {
    expect(
      voiceSampleFileNameForExtension(".FLAC"),
    ).toBe("sample.flac");
  });

  it("rejects unsupported extensions", () => {
    expect(
      () => voiceSampleFileNameForExtension(".exe"),
    ).toThrow(/Unsupported audio extension/i);
  });
});
