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
  QwenClusterBusyError,
  SLR_QWEN_CONTEXT_CAP,
} from "@/lib/workers/qwenClusterRouter";

import {
  getQwenDurableJob,
  setQwenDurableJobStorePathForTests,
} from "@/lib/workers/qwenDurableJobs";

import {
  qwenDurableFetch,
} from "@/lib/workers/qwenDurableFetch";

describe(
  "Qwen durable fetch compatibility boundary",
  () => {
    let tempDir = "";

    beforeEach(() => {
      tempDir =
        fs.mkdtempSync(
          path.join(
            os.tmpdir(),
            "otg-qwen-fetch-",
          ),
        );

      setQwenDurableJobStorePathForTests(
        path.join(
          tempDir,
          "jobs.sqlite",
        ),
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
      "survives temporary GPU contention without returning qwen_cluster_busy",
      async () => {
        let executions = 0;

        const response =
          await qwenDurableFetch(
            "/api/generate",
            {
              prompt:
                "contract durable fetch",
            },
            {
              requiredContextTokens:
                8_192,

              timeoutMs:
                30_000,

              requestKind:
                "contract-durable-fetch",

              schedulerDependencies: {
                sleep:
                  async () => {},

                execute:
                  async (
                    _requestPath,
                    _payload,
                    executeOptions,
                  ) => {
                    executions += 1;

                    if (
                      executions === 1
                    ) {
                      throw new QwenClusterBusyError(
                        "contract GPU busy",
                      );
                    }

                    await executeOptions
                      .onRouteAcquired?.({
                        node:
                          "slr",

                        baseUrl:
                          "http://contract-qwen",

                        contextCap:
                          32_768,
                      });

                    return new Response(
                      JSON.stringify({
                        response:
                          "durable success",
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
              },
            },
          );

        expect(
          response.status,
        ).toBe(
          200,
        );

        expect(
          executions,
        ).toBe(
          2,
        );

        const jobId =
          response.headers.get(
            "x-otg-qwen-job-id",
          );

        expect(
          jobId,
        ).toMatch(
          /^qwen_/,
        );

        const stored =
          getQwenDurableJob(
            String(jobId),
          );

        expect(
          stored?.status,
        ).toBe(
          "completed",
        );

        expect(
          stored?.attempts,
        ).toBe(
          2,
        );

        expect(
          stored?.assignedNode,
        ).toBe(
          "slr",
        );
      },
    );

    it(
      "rejects an impossible restricted-node context immediately instead of queueing forever",
      async () => {
        await expect(
          qwenDurableFetch(
            "/api/generate",
            {
              prompt:
                "too large for restricted SLR route",
            },
            {
              allowedNodes: [
                "slr",
              ],

              requiredContextTokens:
                SLR_QWEN_CONTEXT_CAP
                + 1,

              schedulerDependencies: {
                sleep:
                  async () => {},

                execute:
                  async () => {
                    throw new Error(
                      "executor must not run",
                    );
                  },
              },
            },
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
