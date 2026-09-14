import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  submitComfyPromptWithGpuLease,
} from "../../../lib/workers/comfyPromptLease";

import {
  clearResourceLocksForTests,
  setResourceLockStorePathForTests,
} from "../../../lib/workers/resourceLocks";

let tempDir = "";

beforeEach(() => {
  tempDir =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "otg-comfy-submit-critical-",
      ),
    );

  setResourceLockStorePathForTests(
    path.join(
      tempDir,
      "resource-locks.sqlite",
    ),
  );

  clearResourceLocksForTests();
});

afterEach(() => {
  try {
    clearResourceLocksForTests();
  } catch {}

  setResourceLockStorePathForTests(
    null,
  );

  if (tempDir) {
    fs.rmSync(
      tempDir,
      {
        recursive: true,
        force: true,
      },
    );
  }
});

function promptInit(): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type":
        "application/json",
    },
    body:
      JSON.stringify({
        prompt: {},
        client_id:
          "contract",
      }),
  };
}

describe(
  "H3 physical Comfy submission critical section",
  () => {
      it(
        "queues VSR behind the 5060 free-to-prompt window instead of rejecting it",
        async () => {
          const events: string[] = [];

          let signalFree:
            (() => void) | null =
              null;

          let releaseFree:
            (() => void) | null =
              null;

          const freeEntered =
            new Promise<void>(
              (resolve) => {
                signalFree =
                  resolve;
              },
            );

          const holdFree =
            new Promise<void>(
              (resolve) => {
                releaseFree =
                  resolve;
              },
            );

          const fetcher = async (
            url: string,
            init: RequestInit,
          ) => {
            const parsed =
              new URL(url);

            events.push(
              `${String(
                init.method || "GET",
              ).toUpperCase()} ${parsed.pathname}`,
            );

            if (
              parsed.pathname
              === "/queue"
            ) {
              return new Response(
                JSON.stringify({
                  queue_running: [],
                  queue_pending: [],
                }),
                {
                  status: 200,
                  headers: {
                    "Content-Type":
                      "application/json",
                  },
                },
              );
            }

            if (
              parsed.pathname
              === "/free"
            ) {
              signalFree?.();

              await holdFree;

              return new Response(
                JSON.stringify({
                  ok: true,
                }),
                {
                  status: 200,
                  headers: {
                    "Content-Type":
                      "application/json",
                  },
                },
              );
            }

            if (
              parsed.pathname
              === "/prompt"
            ) {
              return new Response(
                JSON.stringify({
                  prompt_id:
                    "prompt-contract",
                }),
                {
                  status: 200,
                  headers: {
                    "Content-Type":
                      "application/json",
                  },
                },
              );
            }

            return new Response(
              "unexpected",
              {
                status: 500,
              },
            );
          };

          const r2v =
            submitComfyPromptWithGpuLease({
              baseUrl:
                "http://100.98.212.116:8188",
              init:
                promptInit(),
              workerId:
                "production-v2-h3",
              ownerId:
                "contract-r2v",
              purpose:
                "video",
              preSubmitCleanup:
                "free",
              fetcher,
            });

          await freeEntered;

          let vsrResolved =
            false;

          const vsr =
            submitComfyPromptWithGpuLease({
              baseUrl:
                "http://100.98.212.116:8188",
              init:
                promptInit(),
              workerId:
                "production-v2-h3-vsr",
              ownerId:
                "contract-vsr",
              purpose:
                "video",
              preSubmitCleanup:
                null,
              fetcher,
            }).then(
              (response) => {
                vsrResolved =
                  true;

                return response;
              },
            );

          await new Promise<void>(
            (resolve) => {
              setTimeout(
                resolve,
                75,
              );
            },
          );

          expect(
            vsrResolved,
          ).toBe(false);

          expect(events).toEqual([
            "GET /queue",
            "POST /free",
          ]);

          releaseFree?.();

          const [
            r2vResult,
            vsrResult,
          ] =
            await Promise.all([
              r2v,
              vsr,
            ]);

          expect(
            r2vResult.status,
          ).toBe(200);

          expect(
            vsrResult.status,
          ).toBe(200);

          expect(events).toEqual([
            "GET /queue",
            "POST /free",
            "POST /prompt",
            "POST /prompt",
          ]);
        },
      );

      it(
        "keeps the submission mutex held through durable prompt acceptance recording",
        async () => {
          const events: string[] = [];

          let promptCount =
            0;

          let signalDurable:
            (() => void) | null =
              null;

          let releaseDurable:
            (() => void) | null =
              null;

          const durableEntered =
            new Promise<void>(
              (resolve) => {
                signalDurable =
                  resolve;
              },
            );

          const holdDurable =
            new Promise<void>(
              (resolve) => {
                releaseDurable =
                  resolve;
              },
            );

          const fetcher = async (
            url: string,
            init: RequestInit,
          ) => {
            const parsed =
              new URL(url);

            events.push(
              `${String(
                init.method || "GET",
              ).toUpperCase()} ${parsed.pathname}`,
            );

            if (
              parsed.pathname
              !== "/prompt"
            ) {
              return new Response(
                "unexpected",
                {
                  status: 500,
                },
              );
            }

            promptCount += 1;

            return new Response(
              JSON.stringify({
                prompt_id:
                  `prompt-${promptCount}`,
              }),
              {
                status: 200,
                headers: {
                  "Content-Type":
                    "application/json",
                },
              },
            );
          };

          const first =
            submitComfyPromptWithGpuLease({
              baseUrl:
                "http://100.98.212.116:8188",
              init:
                promptInit(),
              workerId:
                "production-v2-h3",
              ownerId:
                "durable-first",
              fetcher,
              onPromptAccepted:
                async (promptId) => {
                  events.push(
                    `durable ${promptId}`,
                  );

                  signalDurable?.();

                  await holdDurable;
                },
            });

          await durableEntered;

          let secondResolved =
            false;

          const second =
            submitComfyPromptWithGpuLease({
              baseUrl:
                "http://100.98.212.116:8188",
              init:
                promptInit(),
              workerId:
                "api-assets-create-image",
              ownerId:
                "durable-second",
              fetcher,
            }).then(
              (response) => {
                secondResolved =
                  true;

                return response;
              },
            );

          await new Promise<void>(
            (resolve) => {
              setTimeout(
                resolve,
                75,
              );
            },
          );

          expect(
            secondResolved,
          ).toBe(false);

          expect(events).toEqual([
            "POST /prompt",
            "durable prompt-1",
          ]);

          releaseDurable?.();

          const [
            firstResult,
            secondResult,
          ] =
            await Promise.all([
              first,
              second,
            ]);

          expect(
            firstResult.status,
          ).toBe(200);

          expect(
            secondResult.status,
          ).toBe(200);

          expect(events).toEqual([
            "POST /prompt",
            "durable prompt-1",
            "POST /prompt",
          ]);
        },
      );

    it(
      "does not free or submit when final 5060 queue recheck is busy",
      async () => {
        const events: string[] = [];

        const response =
          await submitComfyPromptWithGpuLease({
            baseUrl:
              "http://100.98.212.116:8188",
            init: promptInit(),
            workerId:
              "production-v2-h3",
            ownerId:
              "contract-busy",
            purpose:
              "video",
            preSubmitCleanup:
              "free",
            fetcher: async (
              url,
              init,
            ) => {
              const parsed =
                new URL(url);

              events.push(
                `${String(
                  init.method || "GET",
                ).toUpperCase()} ${parsed.pathname}`,
              );

              if (
                parsed.pathname
                === "/queue"
              ) {
                return new Response(
                  JSON.stringify({
                    queue_running: [
                      [
                        "existing",
                      ],
                    ],
                    queue_pending: [],
                  }),
                  {
                    status: 200,
                    headers: {
                      "Content-Type":
                        "application/json",
                    },
                  },
                );
              }

              return new Response(
                "unexpected",
                {
                  status: 500,
                },
              );
            },
          });

        expect(
          response.status,
        ).toBe(409);

        expect(events).toEqual([
          "GET /queue",
        ]);
      },
    );

    it(
      "releases the mutex immediately after ordinary prompt submission",
      async () => {
        let prompts = 0;

        const fetcher = async (
          url: string,
          _init: RequestInit,
        ) => {
          const parsed =
            new URL(url);

          if (
            parsed.pathname
            !== "/prompt"
          ) {
            return new Response(
              "unexpected",
              {
                status: 500,
              },
            );
          }

          prompts += 1;

          return new Response(
            JSON.stringify({
              prompt_id:
                `prompt-${prompts}`,
            }),
            {
              status: 200,
              headers: {
                "Content-Type":
                  "application/json",
              },
            },
          );
        };

        const first =
          await submitComfyPromptWithGpuLease({
            baseUrl:
              "http://100.98.212.116:8188",
            init: promptInit(),
            workerId:
              "production-v2-h3",
            ownerId:
              "one",
            purpose:
              "video",
            fetcher,
          });

        const second =
          await submitComfyPromptWithGpuLease({
            baseUrl:
              "http://100.98.212.116:8188",
            init: promptInit(),
            workerId:
              "production-v2-h3",
            ownerId:
              "two",
            purpose:
              "video",
            fetcher,
          });

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(prompts).toBe(2);
      },
    );

    it(
      "uses qualified recipe dimensions in scheduler metadata",
      () => {
        const scheduler =
          fs.readFileSync(
            path.join(
              process.cwd(),
              "lib/production/h3GenerationScheduler.ts",
            ),
            "utf8",
          );

        expect(
          scheduler,
        ).not.toContain(
          "H3_NATIVE_WIDTH",
        );

        expect(
          scheduler,
        ).not.toContain(
          "H3_NATIVE_HEIGHT",
        );

        expect(
          scheduler,
        ).toContain(
          "getH3ProductionRecipe",
        );

        expect(
          scheduler,
        ).toContain(
          "built.preSubmitCleanup",
        );
      },
    );
  },
);
