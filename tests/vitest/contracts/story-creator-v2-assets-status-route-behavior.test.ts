import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type StoryStore =
  typeof import("../../../lib/storyCreator/store");
type StatusRoute =
  typeof import("../../../app/api/story-creator/assets/status/route");

let tempRoots: string[] = [];

async function setup(input: {
  ownerKey?: string;
  authInvalid?: boolean;
  resolver?: () => Promise<Record<string, unknown>>;
} = {}) {
  const tempRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "otg-story-v2-asset-status-route-",
    ),
  );
  tempRoots.push(tempRoot);

  process.env.OTG_DATA_DIR = tempRoot;
  process.env.OTG_DATA_ROOT = tempRoot;
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret";

  vi.resetModules();

  const { SessionInvalidError } = await import(
    "../../../lib/ownerKey"
  );
  const ownerKey = input.ownerKey || "asset-route-owner";
  const resolveComfyPromptImageStatus = vi.fn(
    input.resolver ||
      (async () => ({
        status: "completed",
        baseUrl: "http://127.0.0.1:8188",
        image: {
          filename: "Mara.png",
          subfolder: "Story",
          type: "output",
          nodeId: "461",
          bucket: "images",
        },
        count: 1,
        attempts: ["ok"],
        checkedBackends: ["http://127.0.0.1:8188"],
        error: "",
        historyFound: true,
      })),
  );

  vi.doMock("@/lib/sessionUser", () => ({
    requireSessionUser: vi.fn(async () => {
      if (input.authInvalid) {
        throw new SessionInvalidError("Invalid session");
      }

      return {
        ownerKey,
      };
    }),
  }));

  vi.doMock("@/lib/comfyImageOutputLookup", () => ({
    resolveComfyPromptImageStatus,
  }));

  const store = await import(
    "../../../lib/storyCreator/store"
  ) as StoryStore;
  const route = await import(
    "../../../app/api/story-creator/assets/status/route"
  ) as StatusRoute;

  return {
    ownerKey,
    store,
    route,
    resolveComfyPromptImageStatus,
  };
}

function request(body: Record<string, unknown>) {
  return new Request(
    "http://localhost/api/story-creator/assets/status",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  ) as any;
}

function createSubmittedAsset(
  store: StoryStore,
  ownerKey: string,
) {
  const project =
    store.createStoryCreatorProject({
      ownerKey,
      title: "Route Asset Status Story",
    });
  const asset =
    store.addStoryAsset({
      ownerKey,
      projectId: project.id,
      assetType: "character",
      name: "Mara route design",
      prompt: "Mara in route armor",
      status: "generating",
      provider: "qwen-image-2-1",
      jobId: "route-prompt-1",
      metadata: {
        outputNodeId: "461",
        imageResponse: {
          comfyBaseUrl: "http://127.0.0.1:8188",
        },
      },
    });
  const job =
    store.addStoryGenerationJob({
      ownerKey,
      projectId: project.id,
      assetId: asset.id,
      jobType: "story-image",
      provider: "qwen-image-2-1",
      status: "submitted",
      promptId: "route-prompt-1",
      endpoint: "/api/assets/create-image",
      request: {
        model: "qwen-image-2-1",
      },
      response: {
        outputNodeId: "461",
        comfyBaseUrl: "http://127.0.0.1:8188",
        seed: 77,
        width: 1024,
        height: 1024,
        backend: "image-primary",
      },
    });

  return {
    project,
    asset,
    job,
  };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  for (const tempRoot of tempRoots) {
    fs.rmSync(
      tempRoot,
      {
        recursive: true,
        force: true,
      },
    );
  }

  tempRoots = [];
  delete process.env.OTG_DATA_DIR;
  delete process.env.OTG_DATA_ROOT;
  delete process.env.AUTH_SECRET;
});

describe("Story Creator V2 asset status route behavior", () => {
  it("requires authentication", async () => {
    const { route } = await setup({
      authInvalid: true,
    });

    const response = await route.POST(
      request({
        projectId: "project",
        assetId: "asset",
      }),
    );

    expect(response.status).toBe(401);
  });

  it("transitions a submitted durable job to running without creating rows", async () => {
    const { ownerKey, route, store } =
      await setup({
        resolver: async () => ({
          status: "running",
          baseUrl: "http://127.0.0.1:8188",
          image: null,
          count: 0,
          attempts: ["queue running"],
          checkedBackends: ["http://127.0.0.1:8188"],
          error: "",
          historyFound: false,
        }),
      });
    const { project, asset } =
      createSubmittedAsset(store, ownerKey);

    const response = await route.POST(
      request({
        projectId: project.id,
        assetId: asset.id,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("running");
    expect(data.job.status).toBe("running");
    expect(data.asset.status).toBe("generating");
    expect(
      store.listStoryGenerationJobs({
        ownerKey,
        projectId: project.id,
      }),
    ).toHaveLength(1);
  });

  it("finalizes completed Comfy output into a ready Story asset", async () => {
    const {
      ownerKey,
      route,
      store,
      resolveComfyPromptImageStatus,
    } = await setup();
    const { project, asset } =
      createSubmittedAsset(store, ownerKey);

    const response = await route.POST(
      request({
        projectId: project.id,
        assetId: asset.id,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("complete");
    expect(data.asset.status).toBe("ready");
    expect(data.job.status).toBe("complete");
    expect(data.asset.url).toContain(
      "/api/comfy/history-image",
    );
    expect(data.asset.url).toContain("filename=Mara.png");
    expect(data.asset.metadata.completion).toMatchObject({
      promptId: "route-prompt-1",
      outputNodeId: "461",
      filename: "Mara.png",
      comfyBaseUrl: "http://127.0.0.1:8188",
    });
    expect(resolveComfyPromptImageStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: "route-prompt-1",
        preferredBaseUrl: "http://127.0.0.1:8188",
        strictPreferred: true,
        filters: {
          nodeId: "461",
        },
      }),
    );

    const second = await route.POST(
      request({
        projectId: project.id,
        assetId: asset.id,
      }),
    );
    const secondData = await second.json();

    expect(secondData.status).toBe("complete");
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

  it("keeps missing expected output from becoming ready", async () => {
    const { ownerKey, route, store } =
      await setup({
        resolver: async () => ({
          status: "missing_output",
          baseUrl: "http://127.0.0.1:8188",
          image: null,
          count: 1,
          attempts: ["missing node"],
          checkedBackends: ["http://127.0.0.1:8188"],
          error: "Expected output node was missing.",
          historyFound: true,
        }),
      });
    const { project, asset } =
      createSubmittedAsset(store, ownerKey);

    const response = await route.POST(
      request({
        projectId: project.id,
        assetId: asset.id,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("failed");
    expect(data.asset.status).toBe("failed");
    expect(data.asset.url).toBe(null);
    expect(data.job.errorText).toContain(
      "Expected output node was missing",
    );
  });

  it("marks backend-reported failure on job and asset", async () => {
    const { ownerKey, route, store } =
      await setup({
        resolver: async () => ({
          status: "failed",
          baseUrl: "http://127.0.0.1:8188",
          image: null,
          count: 0,
          attempts: ["execution_error"],
          checkedBackends: ["http://127.0.0.1:8188"],
          error: "Comfy execution_error",
          historyFound: true,
        }),
      });
    const { project, asset } =
      createSubmittedAsset(store, ownerKey);

    const response = await route.POST(
      request({
        projectId: project.id,
        assetId: asset.id,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.job.status).toBe("failed");
    expect(data.asset.status).toBe("failed");
    expect(data.job.errorText).toBe("Comfy execution_error");
  });

  it("does not corrupt submitted state during temporary backend unavailability", async () => {
    const { ownerKey, route, store } =
      await setup({
        resolver: async () => ({
          status: "unavailable",
          baseUrl: "",
          image: null,
          count: 0,
          attempts: ["timeout"],
          checkedBackends: ["http://127.0.0.1:8188"],
          error: "temporary timeout",
          historyFound: false,
        }),
      });
    const { project, asset, job } =
      createSubmittedAsset(store, ownerKey);

    const response = await route.POST(
      request({
        projectId: project.id,
        assetId: asset.id,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.temporary).toBe(true);
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

  it("rejects cross-project cross-owner and job asset mismatch access", async () => {
    const { ownerKey, route, store } = await setup();
    const first = createSubmittedAsset(store, ownerKey);
    const secondOwner = "second-asset-route-owner";
    const second = createSubmittedAsset(store, secondOwner);

    const crossProject = await route.POST(
      request({
        projectId: second.project.id,
        assetId: first.asset.id,
      }),
    );
    expect(crossProject.status).toBe(404);

    const crossOwner = await route.POST(
      request({
        projectId: second.project.id,
        assetId: second.asset.id,
      }),
    );
    expect(crossOwner.status).toBe(404);

    const mismatch = await route.POST(
      request({
        projectId: first.project.id,
        assetId: first.asset.id,
        jobId: second.job.id,
      }),
    );
    expect(mismatch.status).toBe(404);
  });
});
