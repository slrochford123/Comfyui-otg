import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeVideoSelection } from "@/lib/h3VideoTrim";
import { parseSimpleVideoEdit, simpleVideoEditPlan } from "@/lib/h3SimpleVideoEdit";
import { prepareH3StudioReferenceClip, finalizeH3StudioAudio } from "@/lib/h3StudioAudio";
import { finalizeH3VideoEdit } from "@/lib/h3VideoEdit";
import { probeVideoInfo } from "@/lib/videoFrame";

let root = "", source = "", generated = "", silent = "";
const body = { sourceId: "e028b5a5-b70e-4cf7-b91f-bc45f3f380f4", prompt: "Change the coat to blue", quality: "0.2", requestId: "source-audio-regression" };
function ffmpeg(args: string[]) {
  return execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", "-threads", "1", ...args], { timeout: 30_000 });
}
function frequency(file: string, start = 1) {
  const pcm = ffmpeg(["-ss", String(start), "-i", file, "-t", "1", "-map", "0:a:0", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"]);
  let crossings = 0;
  for (let n = 2; n < pcm.length; n += 2) if (pcm.readInt16LE(n - 2) <= 0 && pcm.readInt16LE(n) > 0) crossings++;
  return crossings / (pcm.length / 2 / 8000);
}
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "slr-edit-source-audio-"));
  source = path.join(root, "original.mp4"); generated = path.join(root, "model-output.mp4"); silent = path.join(root, "silent.mp4");
  ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=64x64:r=24:d=12", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-f", "lavfi", "-i", "sine=frequency=660:duration=7",
    "-filter_complex", "[1:a][2:a]concat=n=2:v=0:a=1[a]", "-map", "0:v:0", "-map", "[a]", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
  ffmpeg(["-f", "lavfi", "-i", "color=c=blue:s=64x64:r=24:d=10.125", "-f", "lavfi", "-i", "sine=frequency=880:duration=10.125", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", generated]);
  ffmpeg(["-i", source, "-t", "5", "-map", "0:v:0", "-c:v", "copy", "-an", silent]);
});
afterAll(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });
describe("Edit Video uses the selected source soundtrack, with real FFmpeg", () => {
  it.each([[0, 5], [0, 10], [5, 5]])("keeps audio from the %s-second start / %s-second selection through generation finalization", async (start, duration) => {
    const selection = path.join(root, `selection-${start}-${duration}.mp4`);
    await encodeVideoSelection(source, selection, start, duration, new AbortController().signal);
    const plan = simpleVideoEditPlan(parseSimpleVideoEdit(body), await probeVideoInfo(selection));
    expect(plan.audio).toBe("original");
    const prepared = await prepareH3StudioReferenceClip(selection, 0, plan.durationSeconds, 64, 64, true);
    const output = await finalizeH3StudioAudio(generated, plan, prepared.outputPath);
    expect((await probeVideoInfo(output)).durationSeconds).toBeCloseTo(duration, 1);
    const expected = start >= 5 ? 660 : 440;
    expect(frequency(output)).toBeGreaterThan(expected - 5); expect(frequency(output)).toBeLessThan(expected + 5);
    if (duration === 10) { expect(frequency(output, 6)).toBeGreaterThan(655); expect(frequency(output, 6)).toBeLessThan(665); }
  });
  it("keeps a silent selected clip silent despite an audible model output", async () => {
    const plan = simpleVideoEditPlan(parseSimpleVideoEdit(body), await probeVideoInfo(silent));
    expect(plan.audio).toBe("mute");
    const output = await finalizeH3StudioAudio(generated, plan, silent);
    expect((await probeVideoInfo(output)).hasAudio).toBe(false);
  });
  it("also keeps the original soundtrack in the older native Edit Video route", async () => {
    const output = await finalizeH3VideoEdit(generated, 5, source);
    expect(frequency(output)).toBeGreaterThan(435); expect(frequency(output)).toBeLessThan(445);
  });
  it("also preserves silence in the older native Edit Video route", async () => {
    const output = await finalizeH3VideoEdit(generated, 5, silent);
    expect((await probeVideoInfo(output)).hasAudio).toBe(false);
  });
});
