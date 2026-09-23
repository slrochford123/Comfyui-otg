import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-h3-gallery-"));
process.env.AUTH_SECRET ||= "h3-auto-gallery-contract-secret-32-bytes";
process.env.OTG_DATA_DIR = dataRoot;
process.env.OTG_DATA_ROOT = dataRoot;
process.env.OTG_DEVICE_OUTPUT_ROOT = path.join(dataRoot, "device_galleries");

let jobs: typeof import("../../../lib/h3DirectJobs");
let gallery: typeof import("../../../lib/gallery");

beforeAll(async () => {
  jobs = await import("../../../lib/h3DirectJobs");
  gallery = await import("../../../lib/gallery");
});

afterAll(() => {
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

describe("H3 automatic Gallery runtime", () => {
  it("returns the latest persisted direct job for owner-level tab rehydration", async () => {
    const owner = {
      ownerKey: "latest-contract-user",
      username: "latest-contract-user",
      deviceId: "latest-contract-device",
      scope: "user" as const,
    };
    const first = await jobs.createH3DirectJob(owner.ownerKey, {
      mode: "h3-text-to-video",
      quality: "lq",
      orientation: "landscape",
      durationSeconds: 5,
      prompt: "older job",
      seed: 1,
      optionalLoras: [],
      firstImage: null,
      lastImage: null,
      images: [],
      videos: [],
      audios: [],
    }, owner);
    const second = await jobs.createH3DirectJob(owner.ownerKey, {
      mode: "h3-text-to-video",
      quality: "lq",
      orientation: "landscape",
      durationSeconds: 5,
      prompt: "newer job",
      seed: 2,
      optionalLoras: [],
      firstImage: null,
      lastImage: null,
      images: [],
      videos: [],
      audios: [],
    }, owner);
    await fsp.writeFile(
      path.join(dataRoot, "h3-direct", owner.ownerKey, "jobs", `${first.id}.json`),
      JSON.stringify({ ...first, createdAt: "2026-09-23T12:00:00.000Z" }, null, 2),
      "utf8",
    );
    await fsp.writeFile(
      path.join(dataRoot, "h3-direct", owner.ownerKey, "jobs", `${second.id}.json`),
      JSON.stringify({ ...second, createdAt: "2026-09-23T12:01:00.000Z" }, null, 2),
      "utf8",
    );

    await expect(jobs.getLatestH3DirectJob(owner.ownerKey)).resolves.toMatchObject({
      id: second.id,
      input: { prompt: "newer job" },
    });
  });

  it("copies a completed result with metadata exactly once", async () => {
    const owner = {
      ownerKey: "contract-user",
      username: "contract-user",
      deviceId: "contract-device",
      scope: "user" as const,
    };
    const job = await jobs.createH3DirectJob("contract-user", {
      mode: "h3-text-to-video",
      quality: "lq",
      orientation: "landscape",
      durationSeconds: 5,
      prompt: "A direct H3 gallery test.",
      seed: 9,
      optionalLoras: [],
      firstImage: null,
      lastImage: null,
      images: [],
      videos: [],
      audios: [],
    }, owner);
    const outputPath = path.join(dataRoot, "completed.mp4");
    await fsp.writeFile(outputPath, "contract-video");
    const completed = {
      ...job,
      status: "completed" as const,
      statusMessage: "Video complete",
      outputPath,
      completedAt: new Date().toISOString(),
    };
    const storedPath = path.join(dataRoot, "h3-direct", "contract-user", "jobs", `${job.id}.json`);
    await fsp.writeFile(storedPath, JSON.stringify(completed, null, 2), "utf8");

    const first = await jobs.saveH3DirectJobToGallery(completed);
    const savedJob = await jobs.getH3DirectJob(owner.ownerKey, job.id);
    const second = await jobs.saveH3DirectJobToGallery(savedJob!);
    const galleryDir = path.join(dataRoot, "user_galleries", owner.username);
    const mediaFiles = fs.readdirSync(galleryDir).filter((name) => name.endsWith(".mp4"));
    const targetPath = path.join(galleryDir, first.fileName);
    const metadata = gallery.readMetaForFile(targetPath);

    expect(second).toEqual(first);
    expect(mediaFiles).toEqual([first.fileName]);
    expect(fs.readFileSync(targetPath, "utf8")).toBe("contract-video");
    expect(savedJob).toMatchObject({
      galleryStatus: "saved",
      galleryFileName: first.fileName,
      galleryScope: "user",
      galleryError: null,
    });
    expect(metadata).toMatchObject({
      sourceType: "h3-direct-generation",
      requestKind: "h3-direct-auto-gallery",
      positivePrompt: "A direct H3 gallery test.",
      ownerKey: owner.ownerKey,
      username: owner.username,
    });
    expect(metadata.submitPayload).toMatchObject({
      jobId: job.id,
      mode: "h3-text-to-video",
      quality: "lq",
      orientation: "landscape",
      width: 1056,
      height: 608,
      durationSeconds: 5,
    });
  });
});
