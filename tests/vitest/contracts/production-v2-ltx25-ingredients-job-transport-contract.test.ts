import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createProductionV2Ltx25GenerationJob,
  claimProductionV2Ltx25GenerationJob,
  completeProductionV2Ltx25GenerationJob,
  getLatestProductionV2Ltx25SceneGeneration,
  markProductionV2Ltx25GenerationRunning,
  markProductionV2Ltx25SheetReady,
  markProductionV2Ltx25SubmissionAccepted,
  requeueProductionV2Ltx25GenerationBeforeAcceptance,
  setProductionV2Ltx25GenerationJobStorePathForTests,
} from "@/lib/production/ltx25IngredientsJobs";

import {
  LTX25_INGREDIENTS_BACKEND_PRIORITY,
  Ltx25BackendBusyError,
  inspectLtx25IngredientsBackend,
  submitLtx25IngredientsPrompt,
} from "@/lib/production/ltx25IngredientsComfy";

import {
  LTX25_INGREDIENTS_MANIFEST_VERSION,
  type Ltx25IngredientsManifest,
} from "@/lib/production/ltx25IngredientsManifest";

function manifest():
  Ltx25IngredientsManifest {
  return {
    version:
      LTX25_INGREDIENTS_MANIFEST_VERSION,

    model: "ltx-2.5",

    mode:
      "ltx-ingredients-image-to-video",

    count: 1,
    limit: 6,
    order: "left-to-right",

    items: [
      {
        slot: 1,
        positionLabel:
          "full sheet",

        sourceKind:
          "character",

        generationSourceType:
          "character-card",

        sourceId:
          "char-1",

        name:
          "Hero",

        sourcePath:
          "/tmp/hero.png",

        identityDescription:
          "Hero identity",
      },
    ],
  };
}

function payload() {
  return {
    finalPrompt:
      "LTX test prompt.",

    lockedReferenceContext:
      "Ingredient 1 is Hero.",

    promptFingerprint:
      "pv2-test",

    durationSeconds:
      5 as const,

    seed: 42,

    manifest:
      manifest(),
  };
}

let tempRoots:
  string[] = [];

afterEach(async () => {
  setProductionV2Ltx25GenerationJobStorePathForTests(
    null,
  );

  for (
    const root
    of tempRoots.splice(0)
  ) {
    await fsp.rm(
      root,
      {
        recursive: true,
        force: true,
      },
    );
  }
});

describe(
  "Production V2 LTX 2.5 durable jobs",
  () => {
    it(
      "persists the pre-submit to accepted to completed lifecycle",
      async () => {
        const root =
          await fsp.mkdtemp(
            path.join(
              os.tmpdir(),
              "otg-ltx25-jobs-",
            ),
          );

        tempRoots.push(root);

        setProductionV2Ltx25GenerationJobStorePathForTests(
          path.join(
            root,
            "jobs.sqlite",
          ),
        );

        const created =
          createProductionV2Ltx25GenerationJob({
            ownerKey:
              "owner-a",

            productionId:
              "production-a",

            sceneId:
              "scene-a",

            payload:
              payload(),
          });

        expect(created.status)
          .toBe("pending");

        expect(created.model)
          .toBe("ltx-2.5");

        expect(created.backend)
          .toBeNull();

        const duplicate =
          createProductionV2Ltx25GenerationJob({
            ownerKey:
              "owner-a",

            productionId:
              "production-a",

            sceneId:
              "scene-a",

            payload:
              payload(),
          });

        expect(duplicate.id)
          .toBe(created.id);

        const claimed =
          claimProductionV2Ltx25GenerationJob(
            created.id,
            "rtx5060ti",
          );

        expect(claimed?.status)
          .toBe("claimed");

        expect(claimed?.attempts)
          .toBe(1);

        expect(claimed?.backend)
          .toBe("rtx5060ti");

        const sheet =
          markProductionV2Ltx25SheetReady(
            created.id,
            {
              sheetPath:
                "/tmp/sheet.png",

              sheetSha256:
                "abc123",
            },
          );

        expect(sheet?.sheetPath)
          .toBe("/tmp/sheet.png");

        const submitted =
          markProductionV2Ltx25SubmissionAccepted(
            created.id,
            {
              promptId:
                "prompt-1",

              workflowId:
                "ltx25-workflow",

              workflowFile:
                "qualified-inline",
            },
          );

        expect(submitted?.status)
          .toBe("submitted");

        expect(
          submitted?.submissionState,
        ).toBe("accepted");

        expect(
          submitted?.comfyPromptId,
        ).toBe("prompt-1");

        expect(
          requeueProductionV2Ltx25GenerationBeforeAcceptance(
            created.id,
          ),
        ).toBeNull();

        const running =
          markProductionV2Ltx25GenerationRunning(
            created.id,
          );

        expect(running?.status)
          .toBe("running");

        const completed =
          completeProductionV2Ltx25GenerationJob(
            created.id,
            "/tmp/output.mp4",
          );

        expect(completed?.status)
          .toBe("completed");

        expect(completed?.outputPath)
          .toBe("/tmp/output.mp4");

        const latest =
          getLatestProductionV2Ltx25SceneGeneration(
            "owner-a",
            "production-a",
            "scene-a",
          );

        expect(latest?.id)
          .toBe(created.id);

        expect(latest?.status)
          .toBe("completed");

        const next =
          createProductionV2Ltx25GenerationJob({
            ownerKey:
              "owner-a",

            productionId:
              "production-a",

            sceneId:
              "scene-a",

            payload:
              payload(),
          });

        expect(next.id)
          .not.toBe(created.id);
      },
    );

    it(
      "allows backend reassignment only before Comfy acceptance",
      async () => {
        const root =
          await fsp.mkdtemp(
            path.join(
              os.tmpdir(),
              "otg-ltx25-requeue-",
            ),
          );

        tempRoots.push(root);

        setProductionV2Ltx25GenerationJobStorePathForTests(
          path.join(
            root,
            "jobs.sqlite",
          ),
        );

        const created =
          createProductionV2Ltx25GenerationJob({
            ownerKey:
              "owner-b",

            productionId:
              "production-b",

            sceneId:
              "scene-b",

            payload:
              payload(),
          });

        const claimed =
          claimProductionV2Ltx25GenerationJob(
            created.id,
            "rtx5060ti",
          );

        expect(claimed?.backend)
          .toBe("rtx5060ti");

        const requeued =
          requeueProductionV2Ltx25GenerationBeforeAcceptance(
            created.id,
            "5060 became busy",
          );

        expect(requeued?.status)
          .toBe(
            "queued_waiting_for_gpu",
          );

        expect(requeued?.backend)
          .toBeNull();

        const fallback =
          claimProductionV2Ltx25GenerationJob(
            created.id,
            "rtx3090",
          );

        expect(fallback?.backend)
          .toBe("rtx3090");

        expect(fallback?.attempts)
          .toBe(2);
      },
    );
  },
);

function json(
  body: unknown,
  status = 200,
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "Content-Type":
          "application/json",
      },
    },
  );
}

function idleCompatibleFetcher() {
  const transformer =
    "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors";

  const encoder =
    "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors";

  const videoVae =
    "ltx-2.5-video-vae-bf16.safetensors";

  const audioVae =
    "ltx-2.5-audio-vae-bf16.safetensors";

  const lora =
    "LTX-2.x/Control-and-Editing/"
    + "ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors";

  return async (
    url: string,
  ) => {
    if (
      url.endsWith("/queue")
    ) {
      return json({
        queue_running: [],
        queue_pending: [],
      });
    }

    const marker =
      "/object_info/";

    if (
      url.includes(marker)
    ) {
      const nodeName =
        decodeURIComponent(
          url.split(marker)[1],
        );

      const required:
        Record<string, unknown> = {};

      if (
        nodeName
        === "UNETLoader"
      ) {
        required.unet_name = [
          "COMBO",
          {
            options: [
              transformer,
            ],
          },
        ];
      }

      if (
        nodeName
        === "CLIPLoader"
      ) {
        required.clip_name = [
          "COMBO",
          {
            options: [
              encoder,
            ],
          },
        ];
      }

      if (
        nodeName
        === "VAELoader"
      ) {
        required.vae_name = [
          "COMBO",
          {
            options: [
              videoVae,
              audioVae,
            ],
          },
        ];
      }

      if (
        nodeName
        === "LTXICLoRALoaderModelOnly"
      ) {
        required.lora_name = [
          "COMBO",
          {
            options: [
              lora,
            ],
          },
        ];
      }

      if (
        nodeName
        === "KSamplerSelect"
      ) {
        required.sampler_name = [
          "COMBO",
          {
            options: [
              "euler_ancestral_cfg_pp",
            ],
          },
        ];
      }

      return json({
        [nodeName]: {
          input: {
            required,
          },
        },
      });
    }

    throw new Error(
      `Unexpected URL: ${url}`,
    );
  };
}

describe(
  "Production V2 LTX 2.5 Comfy transport",
  () => {
    it(
      "locks scheduler priority to 5060 first, then 3090",
      () => {
        expect(
          LTX25_INGREDIENTS_BACKEND_PRIORITY,
        ).toEqual([
          "rtx5060ti",
          "rtx3090",
        ]);
      },
    );

    it(
      "qualifies an idle backend using Custom Node V3 combo options",
      async () => {
        const probe =
          await inspectLtx25IngredientsBackend(
            "rtx5060ti",
            {
              fetcher:
                idleCompatibleFetcher(),
            },
          );

        expect(probe.healthy)
          .toBe(true);

        expect(probe.compatible)
          .toBe(true);

        expect(probe.idle)
          .toBe(true);

        expect(probe.missingNodes)
          .toEqual([]);

        expect(probe.missingAssets)
          .toEqual([]);
      },
    );

    it(
      "does not inspect or select a backend whose Comfy queue is already active",
      async () => {
        let objectInfoCalls = 0;

        const fetcher =
          async (
            url: string,
          ) => {
            if (
              url.endsWith(
                "/queue",
              )
            ) {
              return json({
                queue_running: [
                  ["existing-work"],
                ],

                queue_pending: [],
              });
            }

            if (
              url.includes(
                "/object_info/",
              )
            ) {
              objectInfoCalls += 1;
            }

            return json({});
          };

        const probe =
          await inspectLtx25IngredientsBackend(
            "rtx3090",
            {
              fetcher,
            },
          );

        expect(probe.healthy)
          .toBe(true);

        expect(probe.idle)
          .toBe(false);

        expect(probe.reason)
          .toBe(
            "comfy-queue-active",
          );

        expect(objectInfoCalls)
          .toBe(0);
      },
    );

    it(
      "rechecks the queue inside the protected submit window",
      async () => {
        let queueCalls = 0;
        let promptCalls = 0;
        let accepted = "";

        const fetcher =
          async (
            url: string,
          ) => {
            if (
              url.endsWith(
                "/queue",
              )
            ) {
              queueCalls += 1;

              return json({
                queue_running: [],
                queue_pending: [],
              });
            }

            if (
              url.endsWith(
                "/prompt",
              )
            ) {
              promptCalls += 1;

              return json({
                prompt_id:
                  "prompt-ltx-1",
                node_errors: {},
              });
            }

            throw new Error(
              `Unexpected URL: ${url}`,
            );
          };

        const fakeLease =
          async (
            args: any,
          ) => {
            const response =
              await args.fetcher(
                `${args.baseUrl}/prompt`,
                args.init,
              );

            if (
              response.ok
              && args.onPromptAccepted
            ) {
              const payload =
                await response
                  .clone()
                  .json();

              await args.onPromptAccepted(
                payload.prompt_id,
              );
            }

            return response;
          };

        const result =
          await submitLtx25IngredientsPrompt({
            backend:
              "rtx5060ti",

            graph: {
              "1": {
                class_type:
                  "LoadImage",

                inputs: {
                  image:
                    "ingredients.png",
                },
              },
            },

            clientId:
              "test-client",

            fetcher,

            leaseSubmitter:
              fakeLease,

            onPromptAccepted:
              (promptId) => {
                accepted =
                  promptId;
              },
          });

        expect(result.promptId)
          .toBe(
            "prompt-ltx-1",
          );

        expect(accepted)
          .toBe(
            "prompt-ltx-1",
          );

        expect(queueCalls)
          .toBe(1);

        expect(promptCalls)
          .toBe(1);
      },
    );

    it(
      "refuses prompt admission if the backend becomes busy before /prompt",
      async () => {
        let promptCalls = 0;

        const fetcher =
          async (
            url: string,
          ) => {
            if (
              url.endsWith(
                "/queue",
              )
            ) {
              return json({
                queue_running: [
                  ["new-work"],
                ],

                queue_pending: [],
              });
            }

            if (
              url.endsWith(
                "/prompt",
              )
            ) {
              promptCalls += 1;

              return json({
                prompt_id:
                  "should-not-exist",
              });
            }

            throw new Error(
              `Unexpected URL: ${url}`,
            );
          };

        const fakeLease =
          async (
            args: any,
          ) =>
            args.fetcher(
              `${args.baseUrl}/prompt`,
              args.init,
            );

        await expect(
          submitLtx25IngredientsPrompt({
            backend:
              "rtx3090",

            graph: {
              "1": {
                class_type:
                  "LoadImage",
                inputs: {},
              },
            },

            clientId:
              "busy-test",

            fetcher,

            leaseSubmitter:
              fakeLease,
          }),
        ).rejects.toBeInstanceOf(
          Ltx25BackendBusyError,
        );

        expect(promptCalls)
          .toBe(0);
      },
    );
  },
);
