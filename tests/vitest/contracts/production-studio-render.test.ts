import { afterAll, beforeAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createStudioStore } from "@/lib/productionStudio/store";
import {
  snapshotFile,
  assertAssetIntact,
  probe,
} from "@/lib/productionStudio/media";
import { renderTimeline, validateExport } from "@/lib/productionStudio/render";
import {
  EMPTY_TIMELINE,
  type Asset,
  type Timeline,
} from "@/lib/productionStudio/model";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-render-")),
  s = createStudioStore(path.join(root, "store")),
  p = s.create("owner", "Coffee shop fixture");
let video: Asset, audio: Asset;
beforeAll(async () => {
  const file = path.join(root, "source.mp4"),
    sound = path.join(root, "dialogue.wav");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=330:sample_rate=48000",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-threads",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    file,
  ]);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:sample_rate=48000",
    "-t",
    "2",
    sound,
  ]);
  video = await snapshotFile(s, "owner", p.id, file, "Source.mp4", "video", {
    duration: 2,
  });
  audio = await snapshotFile(s, "owner", p.id, sound, "Dialogue.wav", "audio", {
    duration: 2,
  });
}, 30000);
afterAll(() => {
  s.db.close();
  fs.rmSync(root, { recursive: true, force: true });
});
const timeline = (): Timeline => ({
  ...structuredClone(EMPTY_TIMELINE),
  clips: [
    {
      id: "clip1",
      assetId: video.id,
      in: 0,
      out: 1.5,
      transition: "cut",
      transitionSeconds: 0,
      volume: 0.3,
    },
    {
      id: "clip2",
      assetId: video.id,
      in: 0.2,
      out: 1.7,
      transition: "dissolve",
      transitionSeconds: 0.25,
      volume: 0.3,
    },
  ],
  audio: [
    {
      id: "dialogue",
      assetId: audio.id,
      track: "dialogue",
      start: 0.2,
      in: 0,
      out: 1.5,
      volume: 1,
      fadeIn: 0.1,
      fadeOut: 0.1,
    },
    {
      id: "music",
      assetId: audio.id,
      track: "music",
      start: 0,
      in: 0,
      out: 2,
      volume: 0.1,
      fadeIn: 0.1,
      fadeOut: 0.2,
    },
  ],
  titles: [
    {
      id: "caption",
      text: "Coffee: 100% approved 'take'",
      start: 0.1,
      end: 1.5,
      position: "bottom",
    },
  ],
});
describe("CPU export integration, no paid or GPU work", () => {
  it("renders transitions, captions, layered audio and ducking at portrait 720p30", async () => {
    let progress = 0;
    const file = await renderTimeline(
      s,
      "owner",
      p.id,
      timeline(),
      {
        aspect: "portrait",
        resolution: 720,
        fps: 30,
        format: "mp4",
        filename: "Coffee",
      },
      path.join(root, "portrait"),
      (v) => (progress = v),
      () => false,
    );
    const info = await probe(file),
      v = info.streams.find((s) => s.codec_type === "video");
    expect(v?.width).toBe(720);
    expect(v?.height).toBe(1280);
    expect(v?.avg_frame_rate).toBe("30/1");
    expect(Number(info.format.duration)).toBeCloseTo(2.75, 1);
    expect(info.streams.some((s) => s.codec_type === "audio")).toBe(true);
    expect(progress).toBeGreaterThan(0);
  }, 60000);
  it("renders actual landscape 1920x1080 at 24 FPS", async () => {
    const t = timeline();
    t.clips = t.clips.slice(0, 1);
    t.audio = [];
    t.titles = [];
    const file = await renderTimeline(
      s,
      "owner",
      p.id,
      t,
      {
        aspect: "landscape",
        resolution: 1080,
        fps: 24,
        format: "mp4",
        filename: "Movie",
      },
      path.join(root, "landscape"),
      () => {},
      () => false,
    );
    const v = (await probe(file)).streams[0];
    expect([v.width, v.height, v.avg_frame_rate]).toEqual([1920, 1080, "24/1"]);
  }, 60000);
  it("keeps a pinned copy after the original changes", async () => {
    fs.writeFileSync(path.join(root, "source.mp4"), "changed externally");
    await expect(
      assertAssetIntact(s, "owner", p.id, video.id),
    ).resolves.toBeTruthy();
  });
  it("rejects tampered approved media", async () => {
    const a = await snapshotFile(
      s,
      "owner",
      p.id,
      s.asset("owner", p.id, audio.id).path,
      "Copy.wav",
      "audio",
    );
    fs.appendFileSync(s.asset("owner", p.id, a.id).path, "changed");
    await expect(assertAssetIntact(s, "owner", p.id, a.id)).rejects.toThrow(
      "changed on disk",
    );
  });
  it("validates delivery without confusing generation megapixels", () => {
    expect(() =>
      validateExport({
        aspect: "landscape",
        resolution: 768,
        fps: 24,
        format: "mp4",
      }),
    ).toThrow("supported");
  });
});
