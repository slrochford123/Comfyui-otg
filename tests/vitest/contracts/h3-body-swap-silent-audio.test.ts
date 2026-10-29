import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withH3BodySwapUploadVideo } from "../../../lib/h3SpecialModes/bodySwapUploadVideo";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "otg-body-swap-audio-test-"));
const silent = path.join(dir, "silent.mp4");
const audible = path.join(dir, "audible.mp4");
const digest = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const videoDigest = (file: string) => execFileSync("ffmpeg", ["-v", "error", "-i", file, "-map", "0:v:0", "-f", "framemd5", "-"], { encoding: "utf8" });
const probe = (file: string) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));

beforeAll(() => {
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=96x64:rate=24", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", silent]);
  execFileSync("ffmpeg", ["-v", "error", "-i", silent, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-c:v", "copy", "-c:a", "aac", "-shortest", audible]);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("Body Swap VHS upload audio compatibility", () => {
  it("adds temporary silent audio without changing source pixels or source bytes", async () => {
    const before = digest(silent);
    let temporary = "";
    const value = await withH3BodySwapUploadVideo(silent, async (file) => {
      temporary = file;
      expect(file).not.toBe(silent);
      const info = probe(file);
      expect(info.streams.map((s: any) => s.codec_type)).toEqual(["video", "audio"]);
      expect(info.streams[0].width).toBe(96);
      expect(info.streams[0].height).toBe(64);
      expect(info.streams[0].nb_frames).toBe("24");
      expect(Number(info.format.duration)).toBeCloseTo(1, 1);
      expect(videoDigest(file)).toBe(videoDigest(silent));
      const audio = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-f", "f32le", "-"]);
      expect(audio.length).toBeGreaterThan(0);
      expect(audio.every((byte) => byte === 0)).toBe(true);
      return "uploaded.mp4";
    });
    expect(value).toBe("uploaded.mp4");
    expect(digest(silent)).toBe(before);
    expect(fs.existsSync(temporary)).toBe(false);
    expect(fs.existsSync(path.dirname(temporary))).toBe(false);
  });

  it("passes existing source audio through unchanged", async () => {
    const before = digest(audible);
    await withH3BodySwapUploadVideo(audible, async (file) => {
      expect(file).toBe(audible);
      expect(digest(file)).toBe(before);
    });
    expect(digest(audible)).toBe(before);
  });

  it("cleans its temporary copy when uploading fails, retaining the source", async () => {
    let temporary = "";
    await expect(withH3BodySwapUploadVideo(silent, async (file) => {
      temporary = file;
      throw new Error("upload failed");
    })).rejects.toThrow("upload failed");
    expect(fs.existsSync(temporary)).toBe(false);
    expect(fs.existsSync(silent)).toBe(true);
  });

  it("does not submit malformed media", async () => {
    const bad = path.join(dir, "invalid.mp4");
    await fsp.writeFile(bad, "not a video");
    let called = false;
    await expect(withH3BodySwapUploadVideo(bad, async () => { called = true; })).rejects.toThrow("Could not inspect");
    expect(called).toBe(false);
  });

  it("wraps the upload for both GPU routes while original audio remux stays bound to the original", () => {
    const jobs = fs.readFileSync(path.join(process.cwd(), "lib/h3SpecialModes/bodySwapJobs.ts"), "utf8");
    expect(jobs).toContain("withH3BodySwapUploadVideo(job.input.sourceVideo.path");
    expect(jobs).toContain('"1:a?"');
    expect(jobs).toContain("job.input.sourceVideo.path,");
  });
});
