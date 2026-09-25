import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { getH3DirectGalleryFileName, type H3DirectJob } from "../../../lib/h3DirectJobs";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

function completedJob(): H3DirectJob {
  return {
    id: "h3-direct-contract-job",
    ownerKey: "contract-user",
    status: "completed",
    statusMessage: "Video complete",
    input: {
      mode: "h3-reference-to-video",
      quality: "hq",
      orientation: "portrait",
      durationSeconds: 10,
      prompt: "A reference-guided scene.",
      seed: 7,
      optionalLoras: [],
      firstImage: null,
      lastImage: null,
      images: [],
      videos: [],
      audios: [],
    },
    backend: "rtx3090",
    clientId: "client-contract",
    promptId: "prompt-contract",
    workflowId: "workflow-contract",
    workflowFile: "workflow.api.json",
    outputPath: "/tmp/result.mp4",
    galleryOwner: {
      ownerKey: "contract-user",
      username: "contract-user",
      deviceId: "contract-device",
      scope: "user",
    },
    galleryStatus: "pending",
    galleryFileName: null,
    galleryScope: null,
    galleryError: null,
    error: null,
    createdAt: "2026-09-13T00:00:00.000Z",
    startedAt: "2026-09-13T00:00:01.000Z",
    completedAt: "2026-09-13T00:10:00.000Z",
    queueRemaining: 0,
    progressPercent: 100,
    currentNode: null,
  };
}

describe("H3 automatic Gallery persistence", () => {
  it("uses a deterministic unique filename for each completed H3 job", () => {
    const job = completedJob();
    expect(getH3DirectGalleryFileName(job)).toBe(
      "H3_reference-to-video_10s_hq_portrait_h3-direct-contract-job.mp4",
    );
    expect(getH3DirectGalleryFileName(job)).toBe(getH3DirectGalleryFileName(job));
  });

  it("saves server-side immediately after a verified ComfyUI download", () => {
    const source = read("lib/h3DirectJobs.ts");
    expect(source).toMatch(/downloadH3Video[\s\S]*status: "finalizing"[\s\S]*saveH3DirectJobToGallery\(completedJob\)/);
    expect(source).toContain('statusMessage: "Video complete and saved to Gallery"');
    expect(source).toContain('requestKind: "h3-direct-auto-gallery"');
    expect(source).toContain("clearGalleryListCache()");
    expect(source).toMatch(/saveH3DirectJobToGallery\(completedJob\)[\s\S]*status: "completed"/);
  });

  it("records request ownership and preserves it for retries", () => {
    const route = read("app/api/h3/generation/route.ts");
    expect(route).toContain("createH3DirectJob(ownerKey, input, owner)");
    expect(route).toContain("freshH3RetrySeed(source.input.seed)");
    expect(route).toContain("createH3DirectJob(ownerKey, retryInput, source.galleryOwner || owner)");
    expect(route).not.toContain("createH3DirectJob(ownerKey, source.input, source.galleryOwner || owner)");
    expect(read("lib/h3DirectJobs.ts")).toContain("galleryOwner");
  });

  it("keeps the retry endpoint idempotent and reports Gallery state in the H3 UI", () => {
    const server = read("lib/h3DirectJobs.ts");
    const endpoint = read("app/api/h3/generation/gallery/route.ts");
    const panel = read("app/app/components/H3Panel.tsx");
    expect(server).toContain("job.galleryFileName || getH3DirectGalleryFileName(job)");
    expect(server).toContain("if (!fs.existsSync(targetPath))");
    expect(endpoint).toContain("saveH3DirectJobToGallery(job, targetSource)");
    expect(panel).not.toContain("Add to Gallery");
    expect(panel).toContain("Saved to Gallery");
    expect(panel).toContain("Retry Gallery Save");
  });
});
