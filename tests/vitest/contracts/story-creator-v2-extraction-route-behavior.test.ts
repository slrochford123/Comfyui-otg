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
  openAIText?: string;
  openAIStatus?: number;
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
  const createOpenAIText = vi.fn(async () => {
    if (input.openAIStatus && input.openAIStatus >= 400) {
      throw new Error("extractor failed");
    }

    return {
      text:
        input.openAIText ||
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
      responseId: "response-test",
      usage: {},
    };
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

  vi.doMock("@/lib/openai/provider", () => ({
    createOpenAIText,
    openAIEnabled: () => true,
    openAIModels: () => ({ story: "gpt-6.1-sol" }),
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
    createOpenAIText,
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

function paidAuthorization(maxOutputTokens = 1000) {
  return {
    paidOperationAuthorization: {
      approved: true,
      operation: "story-memory-extraction",
      maxOutputTokens,
    },
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

  it("requires explicit authorization before reviewing messages", async () => {
    const { route, createOpenAIText } = await setup();

    const response = await route.POST(
      request({
        projectId: "project",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(402);
    expect(data.code).toBe("AI_PAYMENT_AUTHORIZATION_REQUIRED");
    expect(createOpenAIText).not.toHaveBeenCalled();
  });

  it("extracts a valid stored source message", async () => {
    const { ownerKey, route, store, createOpenAIText } = await setup();
    const project =
      store.createStoryCreatorProject({
        ownerKey,
        title: "Route Extract Story",
      });
    const message =
      store.addStoryCreatorMessage({
        ownerKey,
        projectId: project.id,
        role: "user",
        content: "Mara is a pilot.",
      });

    const response = await route.POST(
      request({
        projectId: project.id,
        sourceMessageId: message.id,
        ...paidAuthorization(700),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.ok).toBe(true);
    expect(data.sourceMessageId).toBe(message.id);
    expect(data.entitiesCreated).toBe(1);
    expect(data.factsCreated).toBe(1);
    expect(data.questionsCreated).toBe(1);
    expect(createOpenAIText).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 700 }),
    );
  });

  it("rejects unapproved paid extraction before calling OpenAI", async () => {
    const { ownerKey, route, store, createOpenAIText } = await setup();
    const project = store.createStoryCreatorProject({
      ownerKey,
      title: "Deferred Extraction",
    });
    const message = store.addStoryCreatorMessage({
      ownerKey,
      projectId: project.id,
      role: "assistant",
      content: "This remains unprocessed until extraction is authorized.",
    });

    const response = await route.POST(request({
      projectId: project.id,
      sourceMessageId: message.id,
    }));
    const data = await response.json();

    expect(response.status).toBe(402);
    expect(data.code).toBe("AI_PAYMENT_AUTHORIZATION_REQUIRED");
    expect(createOpenAIText).not.toHaveBeenCalled();
    expect(store.listStoryBibleFacts({ ownerKey, projectId: project.id })).toEqual([]);
  });

  it("rejects malformed or excessive paid extraction budgets", async () => {
    const { ownerKey, route, store, createOpenAIText } = await setup();
    const project = store.createStoryCreatorProject({ ownerKey, title: "Bounded Extraction" });
    const message = store.addStoryCreatorMessage({
      ownerKey,
      projectId: project.id,
      role: "assistant",
      content: "Budget checks happen before provider calls.",
    });

    const response = await route.POST(request({
      projectId: project.id,
      sourceMessageId: message.id,
      ...paidAuthorization(1001),
    }));

    expect(response.status).toBe(402);
    expect(createOpenAIText).not.toHaveBeenCalled();
  });

  it("reviews only unreviewed user messages in the selected project", async () => {
    const { ownerKey, route, store, createOpenAIText } =
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
        ...paidAuthorization(),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toContain("already up to date");
    expect(createOpenAIText).not.toHaveBeenCalled();
  });

  it("rejects project ownership mismatch", async () => {
    const { route, store, createOpenAIText } =
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
        ...paidAuthorization(),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.code).toBe("STORY_PROJECT_NOT_FOUND");
    expect(createOpenAIText).not.toHaveBeenCalled();
  });

  it("automatically stores a nonconflicting extracted detail as canon", async () => {
    const { ownerKey, route, store } = await setup({
      openAIText: JSON.stringify({
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
        ...paidAuthorization(),
      }),
    );

    expect(response.status).toBe(201);
    expect(
      store.listStoryBibleFacts({
        ownerKey,
        projectId: project.id,
      })[0].canonStatus,
    ).toBe("canon");
  });

  it("returns a failure response when the extractor response is invalid", async () => {
    const { ownerKey, route, store } = await setup({
      openAIText: "not-json",
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
        role: "user",
        content: "Invalid extractor source.",
      });

    const response = await route.POST(
      request({
        projectId: project.id,
        sourceMessageId: message.id,
        ...paidAuthorization(),
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
