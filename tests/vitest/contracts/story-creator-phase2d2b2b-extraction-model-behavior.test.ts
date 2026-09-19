import {
  describe,
  expect,
  it,
} from "vitest";

import {
  runStoryBibleExtractionModel,
  type StoryBibleExtractionModelDependencies,
} from "../../../lib/storyCreator/extractionModel";

function fakeDependencies(
  handler: (
    path: string,
    payload: Record<string, unknown>,
    options: Record<string, unknown>,
  ) => Promise<Response>,
): StoryBibleExtractionModelDependencies {
  return {
    qwenFetch:
      handler as StoryBibleExtractionModelDependencies["qwenFetch"],
  };
}

describe(
  "Story Creator Phase 2D2B2B extraction model behavior",
  () => {
    it(
      "sends the latest turn through durable Qwen and parses valid extraction",
      async () => {
        const calls:
          Array<{
            path: string;
            payload:
              Record<string, unknown>;
            options:
              Record<string, unknown>;
          }> = [];

        const result =
          await runStoryBibleExtractionModel(
            {
              userMessage:
                "Lena Hart lives in Springfield.",

              assistantMessage:
                "Lena Hart is a character associated with Springfield.",

              knownEntities: [],
            },

            fakeDependencies(
              async (
                path,
                payload,
                options,
              ) => {
                calls.push({
                  path,
                  payload,
                  options,
                });

                return new Response(
                  JSON.stringify({
                    response:
                      JSON.stringify({
                        entities: [
                          {
                            ref: "e1",
                            entityType:
                              "character",
                            name:
                              "Lena Hart",
                          },
                          {
                            ref: "e2",
                            entityType:
                              "location",
                            name:
                              "Springfield",
                          },
                        ],

                        facts: [
                          {
                            subjectRef:
                              "e1",
                            predicate:
                              "residence",
                            valueText: "",
                            objectRef:
                              "e2",
                            canonStatus:
                              "suggestion",
                          },
                        ],
                      }),
                  }),

                  {
                    status: 200,
                    headers: {
                      "content-type":
                        "application/json",
                    },
                  },
                );
              },
            ),
          );

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.value.entities,
        ).toHaveLength(2);

        expect(
          result.value.facts,
        ).toHaveLength(1);

        expect(calls).toHaveLength(1);

        expect(
          calls[0].path,
        ).toBe("/api/generate");

        expect(
          calls[0].payload.model,
        ).toBe("qwen3.5:4b");

        expect(
          calls[0].payload.stream,
        ).toBe(false);

        expect(
          calls[0].payload.think,
        ).toBe(false);

        expect(
          calls[0].options.requestKind,
        ).toBe(
          "story-bible-extraction",
        );

        const prompt =
          String(
            calls[0].payload.prompt,
          );

        expect(prompt).toContain(
          "Lena Hart lives in Springfield.",
        );

        expect(prompt).toContain(
          "Do not promote anything to Canon.",
        );
      },
    );

    it(
      "allows facts to reference only supplied existing entity ids",
      async () => {
        const result =
          await runStoryBibleExtractionModel(
            {
              userMessage:
                "Lena wants to escape.",

              assistantMessage:
                "Her current goal is escape.",

              knownEntities: [
                {
                  id:
                    "known-lena-id",
                  entityType:
                    "character",
                  name:
                    "Lena Hart",
                },
              ],
            },

            fakeDependencies(
              async () =>
                new Response(
                  JSON.stringify({
                    response:
                      JSON.stringify({
                        entities: [],

                        facts: [
                          {
                            subjectEntityId:
                              "known-lena-id",
                            predicate:
                              "goal",
                            valueText:
                              "Escape",
                            canonStatus:
                              "suggestion",
                          },

                          {
                            subjectEntityId:
                              "fabricated-id",
                            predicate:
                              "goal",
                            valueText:
                              "Escape",
                            canonStatus:
                              "suggestion",
                          },
                        ],
                      }),
                  }),

                  {
                    status: 200,
                  },
                ),
            ),
          );

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.value.facts,
        ).toHaveLength(1);

        expect(
          result.value.facts[0]
            .subjectEntityId,
        ).toBe(
          "known-lena-id",
        );

        expect(
          result.value.rejectedFacts,
        ).toBe(1);
      },
    );

    it(
      "filters model attempts to emit Canon",
      async () => {
        const result =
          await runStoryBibleExtractionModel(
            {
              userMessage:
                "Lena may be twenty.",

              assistantMessage:
                "Her age is not confirmed.",

              knownEntities: [],
            },

            fakeDependencies(
              async () =>
                new Response(
                  JSON.stringify({
                    response:
                      JSON.stringify({
                        entities: [],

                        facts: [
                          {
                            predicate:
                              "age",
                            valueText:
                              "20",
                            canonStatus:
                              "canon",
                          },

                          {
                            predicate:
                              "exact_age",
                            valueText: "",
                            canonStatus:
                              "unknown",
                          },
                        ],
                      }),
                  }),

                  {
                    status: 200,
                  },
                ),
            ),
          );

        expect(result.ok).toBe(true);

        if (!result.ok) return;

        expect(
          result.value.facts,
        ).toHaveLength(1);

        expect(
          result.value.facts[0]
            .canonStatus,
        ).toBe("unknown");

        expect(
          result.value.rejectedFacts,
        ).toBe(1);
      },
    );

    it(
      "fails closed on malformed model extraction text",
      async () => {
        const result =
          await runStoryBibleExtractionModel(
            {
              userMessage:
                "Lena enters Springfield.",

              assistantMessage:
                "She has arrived.",
            },

            fakeDependencies(
              async () =>
                new Response(
                  JSON.stringify({
                    response:
                      "Here is the JSON: {bad}",
                  }),

                  {
                    status: 200,
                  },
                ),
            ),
          );

        expect(result.ok).toBe(false);
      },
    );

    it(
      "fails cleanly when Qwen returns a non-success status",
      async () => {
        const result =
          await runStoryBibleExtractionModel(
            {
              userMessage:
                "Hello",

              assistantMessage:
                "Hello",
            },

            fakeDependencies(
              async () =>
                new Response(
                  "busy",
                  {
                    status: 503,
                  },
                ),
            ),
          );

        expect(result).toEqual({
          ok: false,
          error:
            "Story Bible extraction model returned HTTP 503.",
        });
      },
    );

    it(
      "fails cleanly when durable Qwen throws",
      async () => {
        const result =
          await runStoryBibleExtractionModel(
            {
              userMessage:
                "Hello",

              assistantMessage:
                "Hello",
            },

            fakeDependencies(
              async () => {
                throw new Error(
                  "synthetic durable failure",
                );
              },
            ),
          );

        expect(result).toEqual({
          ok: false,
          error:
            "Story Bible extraction model failed: synthetic durable failure",
        });
      },
    );

    it(
      "does not call Qwen when either persisted turn side is empty",
      async () => {
        let calls = 0;

        const result =
          await runStoryBibleExtractionModel(
            {
              userMessage: "",
              assistantMessage:
                "Assistant",
            },

            fakeDependencies(
              async () => {
                calls += 1;

                return new Response(
                  "{}",
                  {
                    status: 200,
                  },
                );
              },
            ),
          );

        expect(result.ok).toBe(false);

        expect(calls).toBe(0);
      },
    );
  },
);
