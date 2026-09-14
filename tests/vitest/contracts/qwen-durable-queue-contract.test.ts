import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  acquireQwenClusterRoute,
  QwenClusterBusyError,
  SHAWN_QWEN_CONTEXT_CAP,
} from "@/lib/workers/qwenClusterRouter";

import {
  createQwenDurableJob,
  getQwenDurableJob,
  setQwenDurableJobStorePathForTests,
} from "@/lib/workers/qwenDurableJobs";

import {
  runQwenDurableSchedulerTick,
} from "@/lib/workers/qwenDurableScheduler";

describe(
  "Qwen durable GPU queue",
  () => {
    let tempDir = "";
    let databasePath = "";

    beforeEach(() => {
      tempDir =
        fs.mkdtempSync(
          path.join(
            os.tmpdir(),
            "otg-qwen-durable-",
          ),
        );

      databasePath =
        path.join(
          tempDir,
          "jobs.sqlite",
        );

      setQwenDurableJobStorePathForTests(
        databasePath,
      );
    });

    afterEach(() => {
      setQwenDurableJobStorePathForTests(
        null,
      );

      fs.rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        },
      );
    });

    it(
      "keeps temporary GPU contention queued instead of failing the request",
      async () => {
        const job =
          createQwenDurableJob({
            requestKind:
              "contract-busy",

            path:
              "/api/generate",

            payload: {
              prompt:
                "test",
            },

            requiredContextTokens:
              8_192,

            executionTimeoutMs:
              30_000,
          });

        const result =
          await runQwenDurableSchedulerTick({
            execute:
              async () => {
                throw new QwenClusterBusyError(
                  "contract busy",
                );
              },
          });

        expect(
          result.requeued,
        ).toBe(1);

        const stored =
          getQwenDurableJob(
            job.id,
          );

        expect(
          stored?.status,
        ).toBe(
          "queued",
        );

        expect(
          stored?.attempts,
        ).toBe(1);

        expect(
          stored?.error,
        ).toBeNull();
      },
    );

    it(
      "records the physical lane before model execution and persists the completed response",
      async () => {
        const job =
          createQwenDurableJob({
            requestKind:
              "contract-complete",

            path:
              "/api/chat",

            payload: {
              messages: [
                {
                  role: "user",
                  content: "hello",
                },
              ],
            },

            requiredContextTokens:
              8_192,

            executionTimeoutMs:
              30_000,
          });

        const result =
          await runQwenDurableSchedulerTick({
            execute:
              async (
                _path,
                _payload,
                options,
              ) => {
                await options
                  .onRouteAcquired?.({
                    node:
                      "slr",
                    baseUrl:
                      "http://contract-qwen",
                    contextCap:
                      32_768,
                  });

                const during =
                  getQwenDurableJob(
                    job.id,
                  );

                expect(
                  during?.status,
                ).toBe(
                  "running",
                );

                expect(
                  during?.assignedNode,
                ).toBe(
                  "slr",
                );

                return new Response(
                  JSON.stringify({
                    response:
                      "contract result",
                  }),
                  {
                    status: 200,
                    headers: {
                      "Content-Type":
                        "application/json",
                      "x-otg-qwen-node":
                        "slr",
                    },
                  },
                );
              },
          });

        expect(
          result.completed,
        ).toBe(1);

        const stored =
          getQwenDurableJob(
            job.id,
          );

        expect(
          stored?.status,
        ).toBe(
          "completed",
        );

        expect(
          stored?.assignedNode,
        ).toBe(
          "slr",
        );

        expect(
          stored?.responseStatus,
        ).toBe(
          200,
        );

        expect(
          stored?.responseBody,
        ).toContain(
          "contract result",
        );
      },
    );

    it(
      "treats impossible context as validation failure rather than GPU busy",
      async () => {
        await expect(
          acquireQwenClusterRoute(
            SHAWN_QWEN_CONTEXT_CAP
            + 1,
            0,
          ),
        ).rejects.toMatchObject({
          name:
            "QwenContextUnsupportedError",
          code:
            "qwen_context_unsupported",
          status:
            400,
        });
      },
    );
  },
);
