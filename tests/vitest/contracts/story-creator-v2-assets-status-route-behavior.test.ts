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
    candidateComfyImageBaseUrls: () => ["http://127.0.0.1:8188"],
    resolveComfyPromptImageStatus,
  }));
  const retrieveRemoteComfyMedia = vi.fn(async (args: { destinationPath: string }) => {
      fs.mkdirSync(path.dirname(args.destinationPath), { recursive: true });
      fs.writeFileSync(args.destinationPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      return {
        filePath: args.destinationPath,
        bytes: 8,
        sha256: "fixture-sha256",
        contentType: "image/png",
        reused: false,
      };
    });
  vi.doMock("@/lib/storyCreator/remoteComfyMedia", () => ({
    retrieveRemoteComfyMedia,
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
    retrieveRemoteComfyMedia,
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
  responsePatch: Record<string, unknown> = {},
) {
  const project =
    store.createStoryCreatorProject({
      ownerKey,
      title: "Route Asset Status Story",
    });
  const prepared = store.prepareStoryVisualGeneration({
      ownerKey,
      projectId: project.id,
      visualKind: "character",
      name: "Mara route design",
      prompt: "Mara in route armor",
      aspectRatio: "square",
    });
  const submitted = store.recordStoryVisualSubmission({
      ownerKey,
      projectId: project.id,
      versionId: prepared.version.id,
      promptId: "route-prompt-1",
      endpoint: "/api/assets/create-image",
      response: {
        outputNodeId: "461",
        comfyBaseUrl: "http://127.0.0.1:8188",
        seed: 77,
        width: 1024,
        height: 1024,
        backend: "image-primary",
        ...responsePatch,
      },
    });

  return {
    project,
    asset: submitted.asset,
    job: submitted.job,
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
      "/api/story-creator/visual-assets/media",
    );
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

  it("recovers a persistent output when Comfy history was cleared", async () => {
    const { ownerKey, route, store, retrieveRemoteComfyMedia } = await setup({
      resolver: async () => ({
        status: "pending",
        baseUrl: "http://127.0.0.1:8188",
        image: null,
        count: 0,
        attempts: ["history cleared"],
        checkedBackends: ["http://127.0.0.1:8188"],
        error: "",
        historyFound: false,
      }),
    });
    const { project, asset } = createSubmittedAsset(store, ownerKey, {
      persistentOutput: true,
      outputSubfolder: "otg_story",
      outputFilenamePrefix: "qwen-fixed-output",
      outputType: "output",
    });

    const response = await route.POST(request({ projectId: project.id, assetId: asset.id }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("complete");
    expect(data.asset.status).toBe("ready");
    expect(data.asset.metadata.completion.recoveredFromPersistentOutput).toBe(true);
    expect(retrieveRemoteComfyMedia).toHaveBeenCalledWith(expect.objectContaining({
      file: {
        filename: "qwen-fixed-output_00001_.png",
        subfolder: "otg_story",
        type: "output",
      },
    }));
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
