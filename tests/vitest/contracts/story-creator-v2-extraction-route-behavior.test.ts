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
type ExtractRoute =
  typeof import("../../../app/api/story-creator/extract/route");

let tempRoots: string[] = [];

async function setup(input: {
  ownerKey?: string;
  authInvalid?: boolean;
  qwenText?: string;
  qwenStatus?: number;
} = {}) {
  const tempRoot = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "otg-story-v2-extract-route-",
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
  const ownerKey = input.ownerKey || "route-owner";
  const qwenDurableFetch = vi.fn(async () => {
    if (input.qwenStatus && input.qwenStatus >= 400) {
      return new Response(
        JSON.stringify({
          error: "extractor failed",
        }),
        {
          status: input.qwenStatus,
        },
      );
    }

    return new Response(
      JSON.stringify({
        message: {
          content:
            input.qwenText ||
            JSON.stringify({
              entities: [
                {
                  entityType: "character",
                  name: "Mara",
                },
              ],
              facts: [
                {
                  subjectName: "Mara",
                  predicate: "role",
                  valueText: "pilot",
                  canonStatus: "suggestion",
                },
              ],
              openQuestions: [
                {
                  question: "Why did Mara leave?",
                },
              ],
            }),
        },
      }),
      {
        status: 200,
      },
    );
  });

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

  vi.doMock("@/lib/workers/qwenClusterRouter", () => ({
    QWEN_CLUSTER_MODEL: "qwen-test",
  }));

  vi.doMock("@/lib/workers/qwenDurableFetch", () => ({
    qwenDurableFetch,
  }));

  const store = await import(
    "../../../lib/storyCreator/store"
  ) as StoryStore;
  const route = await import(
    "../../../app/api/story-creator/extract/route"
  ) as ExtractRoute;

  return {
    ownerKey,
    store,
    route,
    qwenDurableFetch,
  };
}

function request(body: Record<string, unknown>) {
  return new Request(
    "http://localhost/api/story-creator/extract",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  ) as any;
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

describe("Story Creator V2 extraction route behavior", () => {
  it("requires authentication", async () => {
    const { route } = await setup({
      authInvalid: true,
    });

    const response = await route.POST(
      request({
        projectId: "project",
        sourceMessageId: "message",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.ok).toBe(false);
  });

  it("rejects missing sourceMessageId before calling Qwen", async () => {
    const { route, qwenDurableFetch } = await setup();

    const response = await route.POST(
      request({
        projectId: "project",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe(
      "STORY_EXTRACT_SOURCE_MESSAGE_REQUIRED",
    );
    expect(qwenDurableFetch).not.toHaveBeenCalled();
  });

  it("extracts a valid stored source message", async () => {
    const { ownerKey, route, store } = await setup();
    const project =
      store.createStoryCreatorProject({
        ownerKey,
        title: "Route Extract Story",
      });
    const message =
      store.addStoryCreatorMessage({
        ownerKey,
        projectId: project.id,
        role: "assistant",
        content: "Mara is a pilot.",
      });

    const response = await route.POST(
      request({
        projectId: project.id,
        sourceMessageId: message.id,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.ok).toBe(true);
    expect(data.sourceMessageId).toBe(message.id);
    expect(data.entitiesCreated).toBe(1);
    expect(data.factsCreated).toBe(1);
    expect(data.questionsCreated).toBe(1);
  });

  it("rejects a source message from another project", async () => {
    const { ownerKey, route, store, qwenDurableFetch } =
      await setup();
    const first =
      store.createStoryCreatorProject({
        ownerKey,
        title: "First",
      });
    const second =
      store.createStoryCreatorProject({
        ownerKey,
        title: "Second",
      });
    const message =
      store.addStoryCreatorMessage({
        ownerKey,
        projectId: first.id,
        role: "assistant",
        content: "Wrong project.",
      });

    const response = await route.POST(
      request({
        projectId: second.id,
        sourceMessageId: message.id,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.code).toBe("STORY_MESSAGE_NOT_FOUND");
    expect(qwenDurableFetch).not.toHaveBeenCalled();
  });

  it("rejects project ownership mismatch", async () => {
    const { route, store, qwenDurableFetch } =
      await setup({
        ownerKey: "session-owner",
      });
    const project =
      store.createStoryCreatorProject({
        ownerKey: "other-owner",
        title: "Other Owner",
      });
    const message =
      store.addStoryCreatorMessage({
        ownerKey: "other-owner",
        projectId: project.id,
        role: "assistant",
        content: "Other owner source.",
      });

    const response = await route.POST(
      request({
        projectId: project.id,
        sourceMessageId: message.id,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.code).toBe("STORY_PROJECT_NOT_FOUND");
    expect(qwenDurableFetch).not.toHaveBeenCalled();
  });

  it("downgrades unsafe structured canon results", async () => {
    const { ownerKey, route, store } = await setup({
      qwenText: JSON.stringify({
        entities: [],
        facts: [
          {
            predicate: "tone",
            valueText: "hopeful",
            canonStatus: "canon",
          },
        ],
        openQuestions: [],
      }),
    });
    const project =
      store.createStoryCreatorProject({
        ownerKey,
        title: "Canon Downgrade",
      });
    const message =
      store.addStoryCreatorMessage({
        ownerKey,
        projectId: project.id,
        role: "user",
        content: "The tone is hopeful.",
      });

    const response = await route.POST(
      request({
        projectId: project.id,
        sourceMessageId: message.id,
      }),
    );

    expect(response.status).toBe(201);
    expect(
      store.listStoryBibleFacts({
        ownerKey,
        projectId: project.id,
      })[0].canonStatus,
    ).toBe("suggestion");
  });

  it("returns a failure response when the extractor response is invalid", async () => {
    const { ownerKey, route, store } = await setup({
      qwenText: "not-json",
    });
    const project =
      store.createStoryCreatorProject({
        ownerKey,
        title: "Invalid Extractor",
      });
    const message =
      store.addStoryCreatorMessage({
        ownerKey,
        projectId: project.id,
        role: "assistant",
        content: "Invalid extractor source.",
      });

    const response = await route.POST(
      request({
        projectId: project.id,
        sourceMessageId: message.id,
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(
      store.listStoryBibleFacts({
        ownerKey,
        projectId: project.id,
      }),
    ).toEqual([]);
  });
});
