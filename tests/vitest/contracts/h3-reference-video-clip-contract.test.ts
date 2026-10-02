import { describe, expect, it } from "vitest";

import {
  buildH3ReferenceVideoTrimCommand,
  H3_REFERENCE_VIDEO_CLIP_SECONDS,
  normalizeH3ReferenceVideoClip,
} from "../../../lib/h3ReferenceVideo";

describe("H3 reference-video five-second clip contract", () => {
  it("keeps a fixed five-second window and clamps it inside the source", () => {
    expect(H3_REFERENCE_VIDEO_CLIP_SECONDS).toBe(5);
    expect(normalizeH3ReferenceVideoClip(12, 3.5)).toEqual({
      startSeconds: 3.5,
      durationSeconds: 5,
      maxStartSeconds: 7,
    });
    expect(normalizeH3ReferenceVideoClip(12, 99)).toEqual({
      startSeconds: 7,
      durationSeconds: 5,
      maxStartSeconds: 7,
    });
  });

  it("uses the whole source when it is shorter than five seconds", () => {
    expect(normalizeH3ReferenceVideoClip(3.25, 2)).toEqual({
      startSeconds: 0,
      durationSeconds: 3.25,
      maxStartSeconds: 0,
    });
  });

  it("rejects media whose duration cannot be determined", () => {
    expect(() => normalizeH3ReferenceVideoClip(Number.NaN, 0)).toThrow(
      "duration could not be determined",
    );
  });

  it("builds an exact server-side five-second transcode", () => {
    const command = buildH3ReferenceVideoTrimCommand({
      sourcePath: "/tmp/source.mov",
      targetPath: "/tmp/trimmed.mp4",
      sourceDurationSeconds: 14,
      requestedStartSeconds: 6.25,
    });
    expect(command.clip).toEqual({
      startSeconds: 6.25,
      durationSeconds: 5,
      maxStartSeconds: 9,
    });
    expect(command.args).toEqual(expect.arrayContaining([
      "-ss",
      "6.250",
      "-t",
      "5.000",
      "libx264",
      "aac",
      "/tmp/trimmed.mp4",
    ]));
  });
});
