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

describe(
  "Story Creator V2 assets exports and questions store behavior",
  () => {
    beforeAll(async () => {
      tempRoot = fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "otg-story-v2-assets-export-",
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

    it(
      "stores Story assets jobs questions and exports under one owner-scoped project",
      () => {
        const ownerKey = "assets-export-owner";

        const project =
          store.createStoryCreatorProject({
            ownerKey,
            title: "Assets Export Story",
          });

        const asset = store.addStoryAsset({
          ownerKey,
          projectId: project.id,
          assetType: "character",
          name: "Mara reference",
          prompt: "Mara in moonlit armor",
          status: "generating",
          provider: "qwen-image-2-1",
          jobId: "prompt-123",
          metadata: {
            workflow:
              "qwen21-story-character-t2i-api.json",
          },
        });

        expect(asset.assetType).toBe("character");
        expect(asset.metadata.workflow).toBe(
          "qwen21-story-character-t2i-api.json",
        );

        const job = store.addStoryGenerationJob({
          ownerKey,
          projectId: project.id,
          assetId: asset.id,
          jobType: "story-image",
          provider: "qwen-image-2-1",
          status: "submitted",
          promptId: "prompt-123",
          endpoint: "/api/assets/create-image",
          request: {
            model: "qwen-image-2-1",
          },
          response: {
            outputNodeId: "461",
          },
        });

        expect(job.assetId).toBe(asset.id);
        expect(job.promptId).toBe("prompt-123");
        expect(job.response.outputNodeId).toBe("461");

        const question = store.addStoryOpenQuestion({
          ownerKey,
          projectId: project.id,
          question: "What does Mara refuse to remember?",
          sourceRole: "assistant",
        });

        const duplicateQuestion =
          store.addStoryOpenQuestion({
            ownerKey,
            projectId: project.id,
            question: "What does Mara refuse to remember?",
            sourceRole: "assistant",
          });

        expect(duplicateQuestion.id).toBe(question.id);

        const storyExport = store.addStoryExport({
          ownerKey,
          projectId: project.id,
          exportType: "production-package",
          payload: {
            assets: [asset.id],
            jobs: [job.id],
            questions: [question.id],
          },
        });

        expect(storyExport.status).toBe("ready");
        expect(storyExport.payload.assets).toEqual([
          asset.id,
        ]);

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

        expect(
          store.listStoryOpenQuestions({
            ownerKey,
            projectId: project.id,
            status: "open",
          }),
        ).toHaveLength(1);

        expect(
          store.listStoryExports({
            ownerKey,
            projectId: project.id,
          }),
        ).toHaveLength(1);
      },
    );
  },
);
