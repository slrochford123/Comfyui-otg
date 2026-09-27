import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type StoryStore =
  typeof import("../../../lib/storyCreator/store");

let store: StoryStore;
let tempRoot = "";

const previousDataDir = process.env.OTG_DATA_DIR;
const previousDataRoot = process.env.OTG_DATA_ROOT;

function createSubmittedJob(ownerKey = "asset-completion-owner") {
  const project =
    store.createStoryCreatorProject({
      ownerKey,
      title: "Asset Completion Story",
    });
  const asset = store.addStoryAsset({
    ownerKey,
    projectId: project.id,
    assetType: "character",
    name: "Mara design",
    prompt: "Mara in moon armor",
    status: "generating",
    provider: "qwen-image-2-1",
    jobId: "prompt-asset-1",
    metadata: {
      outputNodeId: "461",
    },
  });
  const job = store.addStoryGenerationJob({
    ownerKey,
    projectId: project.id,
    assetId: asset.id,
    jobType: "story-image",
    provider: "qwen-image-2-1",
    status: "submitted",
    promptId: "prompt-asset-1",
    endpoint: "/api/assets/create-image",
    request: {
      model: "qwen-image-2-1",
    },
    response: {
      outputNodeId: "461",
      comfyBaseUrl: "http://127.0.0.1:8188",
      seed: 123,
      width: 1024,
      height: 1024,
    },
  });

  return {
    ownerKey,
    project,
    asset,
    job,
  };
}

describe(
  "Story Creator V2 asset completion store behavior",
  () => {
    beforeAll(async () => {
      tempRoot = fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "otg-story-v2-asset-completion-",
        ),
      );

      process.env.OTG_DATA_DIR = tempRoot;
      process.env.OTG_DATA_ROOT = tempRoot;

      vi.resetModules();

      store = await import(
        "../../../lib/storyCreator/store"
      );
    });

    afterAll(() => {
      if (previousDataDir === undefined) {
        delete process.env.OTG_DATA_DIR;
      } else {
        process.env.OTG_DATA_DIR = previousDataDir;
      }

      if (previousDataRoot === undefined) {
        delete process.env.OTG_DATA_ROOT;
      } else {
        process.env.OTG_DATA_ROOT = previousDataRoot;
      }

      if (tempRoot) {
        fs.rmSync(
          tempRoot,
          {
            recursive: true,
            force: true,
          },
        );
      }
    });

    it("transitions a submitted Story image job to running", () => {
      const { ownerKey, project, asset, job } =
        createSubmittedJob("asset-running-owner");

      const result =
        store.markStoryGenerationJobRunning({
          ownerKey,
          projectId: project.id,
          assetId: asset.id,
          jobId: job.id,
          response: {
            statusCheck: {
              status: "running",
            },
          },
        });

      expect(result.job.status).toBe("running");
      expect(result.asset?.status).toBe("generating");
      expect(result.job.assetId).toBe(asset.id);
    });

    it("completes a backend result and stores durable final output without duplicating rows", () => {
      const { ownerKey, project, asset, job } =
        createSubmittedJob("asset-complete-owner");

      const first =
        store.completeStoryGenerationJob({
          ownerKey,
          projectId: project.id,
          assetId: asset.id,
          jobId: job.id,
          response: {
            statusCheck: {
              status: "completed",
            },
          },
          output: {
            url: "/api/comfy/history-image?promptId=prompt-asset-1&image=1&nodeId=461&filename=Mara.png&type=output&comfyBaseUrl=http%3A%2F%2F127.0.0.1%3A8188",
            promptId: "prompt-asset-1",
            outputNodeId: "461",
            filename: "Mara.png",
            subfolder: "Story",
            type: "output",
            comfyBaseUrl: "http://127.0.0.1:8188",
            backend: "image-primary",
            seed: 123,
            width: 1024,
            height: 1024,
            provider: "qwen-image-2-1",
            model: "qwen-image-2-1",
          },
        });

      expect(first.job.status).toBe("complete");
      expect(first.asset?.status).toBe("ready");
      expect(first.asset?.projectId).toBe(project.id);
      expect(first.job.assetId).toBe(asset.id);
      expect(first.asset?.url).toContain(
        "/api/comfy/history-image",
      );
      expect(first.asset?.metadata.completion).toMatchObject({
        promptId: "prompt-asset-1",
        outputNodeId: "461",
        filename: "Mara.png",
        comfyBaseUrl: "http://127.0.0.1:8188",
      });

      const second =
        store.completeStoryGenerationJob({
          ownerKey,
          projectId: project.id,
          assetId: asset.id,
          jobId: job.id,
          output: {
            url: first.asset?.url,
            promptId: "prompt-asset-1",
            outputNodeId: "461",
            filename: "Mara.png",
            type: "output",
            comfyBaseUrl: "http://127.0.0.1:8188",
          },
        });

      expect(second.job.status).toBe("complete");
      expect(
        store.listStoryAssets({
          ownerKey,
          projectId: project.id,
        }),
      ).toHaveLength(1);
      expect(
        store.listStoryGenerationJobs({
          ownerKey,
          projectId: project.id,
        }),
      ).toHaveLength(1);
    });

    it("marks backend failures on both the Story job and asset consistently", () => {
      const { ownerKey, project, asset, job } =
        createSubmittedJob("asset-fail-owner");

      const result =
        store.failStoryGenerationJob({
          ownerKey,
          projectId: project.id,
          assetId: asset.id,
          jobId: job.id,
          errorText: "Comfy execution_error",
          response: {
            statusCheck: {
              status: "failed",
            },
          },
        });

      expect(result.job.status).toBe("failed");
      expect(result.job.errorText).toContain(
        "Comfy execution_error",
      );
      expect(result.asset?.status).toBe("failed");
      expect(result.asset?.metadata.completionError).toBe(
        "Comfy execution_error",
      );
    });

    it("rejects cross-owner cross-project and job asset mismatches", () => {
      const first =
        createSubmittedJob("asset-owner-one");
      const second =
        createSubmittedJob("asset-owner-two");

      expect(() =>
        store.getStoryAsset({
          ownerKey: "asset-owner-two",
          projectId: first.project.id,
          assetId: first.asset.id,
        }),
      ).toThrow(/not found/i);

      expect(() =>
        store.getStoryGenerationJob({
          ownerKey: first.ownerKey,
          projectId: second.project.id,
          jobId: first.job.id,
        }),
      ).toThrow(/not found/i);

      expect(() =>
        store.completeStoryGenerationJob({
          ownerKey: first.ownerKey,
          projectId: first.project.id,
          assetId: second.asset.id,
          jobId: first.job.id,
          output: {
            url: "/api/comfy/history-image?promptId=bad",
          },
        }),
      ).toThrow(/does not belong/i);
    });

    it("rolls back completion if the related asset write cannot finish", () => {
      const { ownerKey, project, asset, job } =
        createSubmittedJob("asset-rollback-owner");

      expect(() =>
        store.completeStoryGenerationJob({
          ownerKey,
          projectId: project.id,
          assetId: asset.id,
          jobId: job.id,
          debugFailurePoint: "afterJobWrite",
          output: {
            url: "/api/comfy/history-image?promptId=rollback",
            promptId: "rollback",
            outputNodeId: "461",
            filename: "Rollback.png",
            type: "output",
          },
        }),
      ).toThrow(/Forced Story asset completion failure/);

      expect(
        store.getStoryGenerationJob({
          ownerKey,
          projectId: project.id,
          jobId: job.id,
        }).status,
      ).toBe("submitted");
      expect(
        store.getStoryAsset({
          ownerKey,
          projectId: project.id,
          assetId: asset.id,
        }).status,
      ).toBe("generating");
    });
  },
);
