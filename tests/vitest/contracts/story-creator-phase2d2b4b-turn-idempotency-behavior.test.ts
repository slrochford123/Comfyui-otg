import {
  NextRequest,
} from "next/server";

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks =
  vi.hoisted(() => ({
    requireSessionUser:
      vi.fn(),
    runStoryHelperChat:
      vi.fn(),
    claimStoryCreatorTurn:
      vi.fn(),
    getStoryCreatorProject:
      vi.fn(),
    listStoryCreatorMessages:
      vi.fn(),
    saveStoryCreatorTurnAssistant:
      vi.fn(),
    completeStoryCreatorTurn:
      vi.fn(),
    failStoryCreatorTurn:
      vi.fn(),
    extractAndPersistStoryBibleProposals:
      vi.fn(),
  }));

vi.mock(
  "@/lib/ownerKey",
  () => ({
    SessionInvalidError:
      class SessionInvalidError
        extends Error {},
  }),
);

vi.mock(
  "@/lib/sessionUser",
  () => ({
    requireSessionUser:
      mocks.requireSessionUser,
  }),
);

vi.mock(
  "../../../app/api/ollama-ai/chat/route",
  () => ({
    POST:
      mocks.runStoryHelperChat,
  }),
);

vi.mock(
  "../../../lib/storyCreator/store",
  () => ({
    claimStoryCreatorTurn:
      mocks.claimStoryCreatorTurn,
    getStoryCreatorProject:
      mocks.getStoryCreatorProject,
    listStoryCreatorMessages:
      mocks.listStoryCreatorMessages,
    saveStoryCreatorTurnAssistant:
      mocks.saveStoryCreatorTurnAssistant,
    completeStoryCreatorTurn:
      mocks.completeStoryCreatorTurn,
    failStoryCreatorTurn:
      mocks.failStoryCreatorTurn,
  }),
);

vi.mock(
  "@/lib/storyCreator/extractionPersistence",
  () => ({
    extractAndPersistStoryBibleProposals:
      mocks
        .extractAndPersistStoryBibleProposals,
  }),
);

import {
  POST,
} from "../../../app/api/story-creator/turn/route";

const CLIENT_TURN_ID =
  "11111111-1111-4111-8111-000000000001";

const userMessage = {
  id: "user-message-1",
  projectId: "project-1",
  ownerKey: "owner-1",
  role: "user" as const,
  content:
    "Lena enters Springfield.",
  createdAt: 100,
};

const assistantMessage = {
  id: "assistant-message-1",
  projectId: "project-1",
  ownerKey: "owner-1",
  role: "assistant" as const,
  content:
    "Lena arrives in Springfield.",
  createdAt: 200,
};

function turn(
  status = "running",
) {
  return {
    id: "turn-1",
    projectId: "project-1",
    ownerKey: "owner-1",
    clientTurnId:
      CLIENT_TURN_ID,
    requestContent:
      userMessage.content,
    userMessageId:
      userMessage.id,
    assistantMessageId:
      status === "running"
        ? null
        : assistantMessage.id,
    status,
    leaseToken:
      status === "completed"
        ? null
        : "lease-1",
    leaseExpiresAt:
      status === "completed"
        ? null
        : Date.now() + 60_000,
    lastError: "",
    createdAt: 1,
    updatedAt: 1,
  };
}

function request(
  content =
    userMessage.content,
) {
  return new NextRequest(
    "http://localhost/api/story-creator/turn",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      body:
        JSON.stringify({
          projectId:
            "project-1",
          content,
          clientTurnId:
            CLIENT_TURN_ID,
        }),
    },
  );
}

function helperResponse(
  body: unknown,
  status = 200,
) {
  return new Response(
    JSON.stringify(
      body,
    ),
    {
      status,
      headers: {
        "Content-Type":
          "application/json",
      },
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks
    .requireSessionUser
    .mockResolvedValue({
      ownerKey: "owner-1",
    });

  mocks
    .getStoryCreatorProject
    .mockReturnValue({
      id: "project-1",
      ownerKey: "owner-1",
      title: "Test Story",
      format: "",
      genre: "",
      matureLanguageEnabled: false,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });

  mocks
    .listStoryCreatorMessages
    .mockReturnValue([
      userMessage,
    ]);

  mocks
    .saveStoryCreatorTurnAssistant
    .mockReturnValue(
      assistantMessage,
    );

  mocks
    .completeStoryCreatorTurn
    .mockReturnValue(
      turn("completed"),
    );

  mocks
    .failStoryCreatorTurn
    .mockReturnValue(
      turn("failed"),
    );

  mocks
    .extractAndPersistStoryBibleProposals
    .mockResolvedValue({
      status: "persisted",
      proposedEntities: 1,
      proposedFacts: 1,
    });
});

describe(
  "Story Creator Phase 2D2B4B trusted turn route behavior",
  () => {
    it(
      "replays completed without AI",
      async () => {
        mocks
          .claimStoryCreatorTurn
          .mockReturnValue({
            action: "completed",
            turn:
              turn("completed"),
            userMessage,
            assistantMessage,
          });

        const response =
          await POST(
            request(),
          );

        expect(
          response.status,
        ).toBe(200);

        expect(
          mocks.runStoryHelperChat,
        ).not.toHaveBeenCalled();

        expect(
          mocks
            .extractAndPersistStoryBibleProposals,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns live duplicate in progress",
      async () => {
        mocks
          .claimStoryCreatorTurn
          .mockReturnValue({
            action:
              "in_progress",
            turn:
              turn("running"),
            userMessage,
            assistantMessage:
              null,
          });

        const response =
          await POST(
            request(),
          );

        const data =
          await response.json();

        expect(
          response.status,
        ).toBe(409);

        expect(
          data.code,
        ).toBe(
          "STORY_DIRECTOR_TURN_IN_PROGRESS",
        );

        expect(
          mocks.runStoryHelperChat,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "runs helper once then saves extracts and completes",
      async () => {
        mocks
          .claimStoryCreatorTurn
          .mockReturnValue({
            action: "claimed",
            turn:
              turn("running"),
            userMessage,
            assistantMessage:
              null,
            leaseToken:
              "lease-1",
          });

        mocks
          .runStoryHelperChat
          .mockResolvedValue(
            helperResponse({
              message:
                assistantMessage.content,
            }),
          );

        const response =
          await POST(
            request(),
          );

        expect(
          response.status,
        ).toBe(201);

        expect(
          mocks.runStoryHelperChat,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks
            .saveStoryCreatorTurnAssistant,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks
            .extractAndPersistStoryBibleProposals,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks
            .completeStoryCreatorTurn,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
    "preserves Mature Language instruction with long history",
    async () => {
      mocks
        .claimStoryCreatorTurn
        .mockReturnValue({
          action: "claimed",
          turn:
            turn("running"),
          userMessage,
          assistantMessage:
            null,
          leaseToken:
            "lease-1",
        });

      mocks
        .getStoryCreatorProject
        .mockReturnValue({
          id: "project-1",
          ownerKey: "owner-1",
          title: "Test Story",
          format: "",
          genre: "",
          matureLanguageEnabled: true,
          status: "active",
          createdAt: 1,
          updatedAt: 1,
        });

      const longHistory =
        Array.from(
          {
            length: 60,
          },
          (_, index) => ({
            ...userMessage,
            id:
              `history-message-${index}`,
            role:
              index % 2 === 0
                ? ("user" as const)
                : ("assistant" as const),
            content:
              `history-${index}`,
            createdAt:
              index + 1,
          }),
        );

      mocks
        .listStoryCreatorMessages
        .mockReturnValue(
          longHistory,
        );

      let helperMessages:
        Array<{
          role: string;
          content: string;
        }> = [];

      mocks
        .runStoryHelperChat
        .mockImplementation(
          async (
            helperRequest:
              NextRequest,
          ) => {
            const helperBody =
              await helperRequest.json() as {
                messages?: Array<{
                  role: string;
                  content: string;
                }>;
              };

            helperMessages =
              Array.isArray(
                helperBody.messages,
              )
                ? helperBody.messages
                : [];

            return helperResponse({
              message:
                assistantMessage.content,
            });
          },
        );

      const response =
        await POST(
          request(),
        );

      expect(
        response.status,
      ).toBe(201);

      expect(
        helperMessages,
      ).toHaveLength(48);

      expect(
        helperMessages[0]?.role,
      ).toBe("system");

      expect(
        helperMessages[0]?.content,
      ).toContain(
        "Mature Language setting is ON",
      );

      expect(
        helperMessages[1]?.content,
      ).toBe("history-13");

      expect(
        helperMessages[47]?.content,
      ).toBe("history-59");
    },
  );

  it(
      "marks helper failure failed",
      async () => {
        mocks
          .claimStoryCreatorTurn
          .mockReturnValue({
            action: "claimed",
            turn:
              turn("running"),
            userMessage,
            assistantMessage:
              null,
            leaseToken:
              "lease-1",
          });

        mocks
          .runStoryHelperChat
          .mockResolvedValue(
            helperResponse(
              {
                error:
                  "Synthetic failure.",
              },
              503,
            ),
          );

        const response =
          await POST(
            request(),
          );

        expect(
          response.status,
        ).toBe(503);

        expect(
          mocks.failStoryCreatorTurn,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks
            .saveStoryCreatorTurnAssistant,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "resumes assistant-saved without helper",
      async () => {
        mocks
          .claimStoryCreatorTurn
          .mockReturnValue({
            action:
              "resume_assistant",
            turn:
              turn(
                "assistant_saved",
              ),
            userMessage,
            assistantMessage,
            leaseToken:
              "lease-2",
          });

        const response =
          await POST(
            request(),
          );

        const data =
          await response.json();

        expect(
          response.status,
        ).toBe(201);

        expect(
          data.resumed,
        ).toBe(true);

        expect(
          mocks.runStoryHelperChat,
        ).not.toHaveBeenCalled();

        expect(
          mocks
            .extractAndPersistStoryBibleProposals,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "preserves conflict as 409",
      async () => {
        mocks
          .claimStoryCreatorTurn
          .mockImplementation(
            () => {
              throw Object.assign(
                new Error(
                  "clientTurnId conflict",
                ),
                {
                  code:
                    "STORY_DIRECTOR_TURN_ID_CONFLICT",
                  status: 409,
                },
              );
            },
          );

        const response =
          await POST(
            request(
              "Different text.",
            ),
          );

        const data =
          await response.json();

        expect(
          response.status,
        ).toBe(409);

        expect(
          data.code,
        ).toBe(
          "STORY_DIRECTOR_TURN_ID_CONFLICT",
        );
      },
    );
  },
);
