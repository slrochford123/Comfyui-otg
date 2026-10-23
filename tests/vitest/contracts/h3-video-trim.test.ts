import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCmd, resolveFfmpegPath } from "@/lib/ffmpeg";
import { probeVideoInfo } from "@/lib/videoFrame";
import { encodeVideoSelection, validateVideoSelection, videoTrimDirectory, videoTrimLimits } from "@/lib/h3VideoTrim";

describe("server-authoritative video selections", () => {
  it.each([2, 5, 10])("accepts exact %s-second selections", duration => expect(validateVideoSelection(30, 10, 10 + duration).duration).toBe(duration));
  it.each([[0, 5], [12.5, 17.5], [25, 30]])("supports the first, middle and final segments: %s–%s", (start, end) => expect(validateVideoSelection(30, start, end).duration).toBe(5));
  it.each([[0, 1.99], [0, 10.01], [-1, 4], [29, 34], [5, 3], [NaN, 5], [0, Infinity], ["0", 5], [0, "5"]])("rejects invalid %s–%s bounds", (start, end) => expect(() => validateVideoSelection(30, start, end)).toThrow());
  it("uses actual probed duration, not a forged client duration", () => expect(() => validateVideoSelection(3, 1, 6)).toThrow());
  it("owner paths differ and arbitrary path IDs are rejected", () => { const id = "11111111-1111-4111-8111-111111111111"; expect(videoTrimDirectory("A", id)).not.toBe(videoTrimDirectory("B", id)); expect(() => videoTrimDirectory("A", "../other")).toThrow(); });
  it("provides bounded documented default upload limits", () => expect(videoTrimLimits()).toEqual({ maxBytes: 512 * 1024 ** 2, maxSeconds: 600 }));
});

describe("real FFmpeg trim without GPU/model activity", () => {
  let root: string, source: string;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "slr-video-trim-test-")); source = path.join(root, "source.mp4");
    const result = await runCmd(resolveFfmpegPath(), ["-nostdin", "-y", "-f", "lavfi", "-i", "testsrc2=size=128x96:rate=24:duration=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=30", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", source], { timeoutMs: 15000 });
    expect(result.code).toBe(0);
  }, 20000);
  afterAll(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });
  it.each([[0, 2], [12.5, 5], [20, 10]])("accurately encodes start %s and duration %s, preserving dimensions/audio", async (start, duration) => {
    const output = path.join(root, `trim-${duration}.mp4`);
    await encodeVideoSelection(source, output, start, duration, new AbortController().signal);
    const probe = await probeVideoInfo(output);
    expect(probe.durationSeconds).toBeCloseTo(duration, 1); expect(probe.width).toBe(128); expect(probe.height).toBe(96); expect(probe.hasAudio).toBe(true);
  });
  it("aborted trim removes partial output and a subsequent retry works", async () => {
    const output = path.join(root, "cancel.mp4"), controller = new AbortController();
    const pending = encodeVideoSelection(source, output, 10, 5, controller.signal); controller.abort();
    await expect(pending).rejects.toThrow(/cancel/i); await expect(fs.stat(output)).rejects.toThrow();
    await encodeVideoSelection(source, output, 10, 5, new AbortController().signal); expect((await probeVideoInfo(output)).durationSeconds).toBeCloseTo(5, 1);
  });
});
