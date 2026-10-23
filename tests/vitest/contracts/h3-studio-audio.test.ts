import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finalizeH3StudioAudio, prepareH3StudioReferenceClip } from "@/lib/h3StudioAudio";
import { DEFAULT_H3_STUDIO_PLAN } from "@/lib/h3StudioPlan";
import { probeVideoInfo } from "@/lib/videoFrame";
let root = ""; let source = ""; let generated = "";
function ffmpeg(args: string[]) { return execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-threads", "1", ...args], { timeout: 20_000 }); }
function frequency(file: string) {
  const pcm = ffmpeg(["-i", file, "-map", "0:a:0", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"]);
  let crossings = 0; for (let n = 2; n < pcm.length; n += 2) if (pcm.readInt16LE(n - 2) <= 0 && pcm.readInt16LE(n) > 0) crossings++;
  return crossings / (pcm.length / 2 / 8000);
}
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "slr-h3-audio-")); source = path.join(root, "source.mp4"); generated = path.join(root, "generated.mp4");
  for (const [file, tone] of [[source, 440], [generated, 880]] as const) ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=64x64:r=24:d=5.2", "-f", "lavfi", "-i", `sine=frequency=${tone}:duration=5.2`, "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]);
});
afterAll(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });
describe("real CPU FFmpeg H3 audio routing, no GPU/model calls", () => {
  it.each([2, 4.76])("prepares and finalizes an actual %s-second edit without five-second padding", async durationSeconds => {
    const clip = await prepareH3StudioReferenceClip(source, .1, durationSeconds, 64, 64, true);
    expect((await probeVideoInfo(clip.outputPath)).durationSeconds).toBeCloseTo(durationSeconds, 1);
    const output = await finalizeH3StudioAudio(generated, { ...DEFAULT_H3_STUDIO_PLAN, workflowId: "reference-edit", durationSeconds, audio: "generated" });
    expect((await probeVideoInfo(output)).durationSeconds).toBeCloseTo(durationSeconds, 1);
  });
  it("preserves the genuine original source audio rather than generated audio", async () => {
    const output = await finalizeH3StudioAudio(generated, { ...DEFAULT_H3_STUDIO_PLAN, workflowId: "reference-edit", audio: "original" }, source);
    expect(frequency(output)).toBeGreaterThan(435); expect(frequency(output)).toBeLessThan(445);
    expect((await probeVideoInfo(output)).durationSeconds).toBeCloseTo(5, 1);
  });
  it("keeps generated audio when selected", async () => {
    const output = await finalizeH3StudioAudio(generated, { ...DEFAULT_H3_STUDIO_PLAN, audio: "generated" });
    expect(frequency(output)).toBeGreaterThan(875); expect(frequency(output)).toBeLessThan(885);
  });
  it("removes audio for mute", async () => { const output = await finalizeH3StudioAudio(generated, { ...DEFAULT_H3_STUDIO_PLAN, audio: "mute" }); expect((await probeVideoInfo(output)).hasAudio).toBe(false); });
  it("does not silently substitute generated audio when the source is missing", async () => { await expect(finalizeH3StudioAudio(generated, { ...DEFAULT_H3_STUDIO_PLAN, audio: "original" })).rejects.toThrow(/unavailable/); });
  it("retains audio in the actual prepared five-second source window", async () => {
    const clip = await prepareH3StudioReferenceClip(source, .1, 5, 64, 64, true);
    const info = await probeVideoInfo(clip.outputPath); expect(info.durationSeconds).toBeCloseTo(5, 1); expect(info.hasAudio).toBe(true);
    expect(frequency(clip.outputPath)).toBeGreaterThan(435); expect(frequency(clip.outputPath)).toBeLessThan(445);
  });
  it.each([-1, .5, NaN])("rejects an invalid/out-of-source five-second start %s", async start => { await expect(prepareH3StudioReferenceClip(source, start, 5, 64, 64, true)).rejects.toThrow(/window/); });
  it("does not pass a five-second source as a silently truncated ten-second edit", async () => { await expect(prepareH3StudioReferenceClip(source, 0, 10, 64, 64, true)).rejects.toThrow(/window/); });
});
