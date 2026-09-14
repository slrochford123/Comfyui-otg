import fs from "node:fs/promises";
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
  Ltx25SubmissionUnknownError,
  type Ltx25BackendProbe,
} from "@/lib/production/ltx25IngredientsComfy";

import {
  createProductionV2Ltx25GenerationJob,
  getProductionV2Ltx25GenerationJob,
  setProductionV2Ltx25GenerationJobStorePathForTests,
} from "@/lib/production/ltx25IngredientsJobs";

import {
  chooseProductionV2Ltx25Backend,
  runProductionV2Ltx25SchedulerTick,
} from "@/lib/production/ltx25IngredientsScheduler";

import {
  LTX25_INGREDIENTS_MANIFEST_VERSION,
  type Ltx25IngredientsManifest,
} from "@/lib/production/ltx25IngredientsManifest";

let root = "";

function probe(
  backend:
    "rtx5060ti" | "rtx3090",
  state:
    "ready" | "busy" | "down",
): Ltx25BackendProbe {
  if (state === "ready") {
    return {
      backend,
      healthy: true,
      compatible: true,
      idle: true,
      reason: "ready",
      missingNodes: [],
      missingAssets: [],
      queueRunning: 0,
      queuePending: 0,
    };
  }

  if (state === "busy") {
    return {
      backend,
      healthy: true,
      compatible: false,
      idle: false,
      reason:
        "comfy-queue-active",
      missingNodes: [],
      missingAssets: [],
      queueRunning: 1,
      queuePending: 0,
    };
  }

  return {
    backend,
    healthy: false,
    compatible: false,
    idle: false,
    reason:
      "connection refused",
    missingNodes: [],
    missingAssets: [],
    queueRunning: 0,
    queuePending: 0,
  };
}

function manifest():
  Ltx25IngredientsManifest {
  return {
    version:
      LTX25_INGREDIENTS_MANIFEST_VERSION,

    model:
      "ltx-2.5",

    mode:
      "ltx-ingredients-image-to-video",

    count: 1,
    limit: 6,
    order:
      "left-to-right",

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
          "hero",
        name:
          "Hero",
        sourcePath:
          "/tmp/hero.png",
        identityDescription:
          "Canonical Hero identity.",
      },
    ],
  };
}

function createJob(
  suffix = "a",
) {
  return (
    createProductionV2Ltx25GenerationJob(
      {
        ownerKey:
          `owner-${suffix}`,
        productionId:
          `production-${suffix}`,
        sceneId:
          `scene-${suffix}`,

        payload: {
          finalPrompt:
            "Cinematic LTX test.",
          lockedReferenceContext:
            "Ingredient 1 is Hero.",
          promptFingerprint:
            `pv2-${suffix}`,
          durationSeconds:
            5,
          seed:
            42,
          manifest:
            manifest(),
        },
      },
    )
  );
}

function runtimeDependencies(
  states: {
    rtx5060ti:
      "ready" | "busy" | "down";
    rtx3090:
      "ready" | "busy" | "down";
  },
) {
  return {
    probe:
      async (
        backend:
          "rtx5060ti"
          | "rtx3090",
      ) =>
        probe(
          backend,
          states[backend],
        ),

    compose:
      async ({
        outputPath,
        manifest,
      }: any) => ({
        version:
          "test-sheet",
        outputPath,
        width: 960,
        height: 544,
        count:
          manifest.count,
        order:
          "left-to-right" as const,
        gutter: 8,
        sha256:
          "sheet-sha",
        resolvedSources: [],
      }),

    upload:
      async () =>
        "uploaded-ingredients.png",

    build:
      ({
        backend,
      }: any) => ({
        backend,
        graph: {
          "1": {
            class_type:
              "LoadImage",
            inputs: {
              image:
                "uploaded-ingredients.png",
            },
          },
        },
        workflowId:
          "qualified-ltx25-test",
        workflowFile:
          "qualified-inline/test",
        nativeWidth:
          960,
        nativeHeight:
          544,
        fps:
          24,
        frames:
          121,
        nativeAudio:
          true as const,
        preSubmitCleanup:
          null,
      }),

    submit:
      async (
        input: any,
      ) => {
        await input
          .onBeforePromptPost?.();

        await input
          .onPromptAccepted?.(
            "prompt-test-1",
          );

        return {
          promptId:
            "prompt-test-1",
          payload: {
            prompt_id:
              "prompt-test-1",
          },
        };
      },

    history:
      async () => ({
        exists: true,
        completed: true,
        failed: false,
        status: {},
        files: [
          {
            filename:
              "result.mp4",
            type:
              "output",
          },
        ],
      }),

    download:
      async ({
        destinationPath,
      }: any) => ({
        destinationPath,
        bytes: 1234,
      }),
  };
}

beforeEach(async () => {
  root =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        "otg-ltx25-scheduler-",
      ),
    );

  setProductionV2Ltx25GenerationJobStorePathForTests(
    path.join(
      root,
      "jobs.sqlite",
    ),
  );
});

afterEach(async () => {
  setProductionV2Ltx25GenerationJobStorePathForTests(
    null,
  );

  if (root) {
    await fs.rm(
      root,
      {
        recursive: true,
        force: true,
      },
    );
  }
});

describe(
  "Production V2 LTX 2.5 Ingredients scheduler",
  () => {
    it(
      "locks routing to 5060 Ti first when both GPUs are idle",
      () => {
        expect(
          chooseProductionV2Ltx25Backend([
            probe(
              "rtx3090",
              "ready",
            ),
            probe(
              "rtx5060ti",
              "ready",
            ),
          ]),
        ).toBe(
          "rtx5060ti",
        );
      },
    );

    it(
      "uses the 3090 only when the 5060 Ti is not idle",
      async () => {
        const job =
          createJob("fallback");

        const result =
          await runProductionV2Ltx25SchedulerTick(
            runtimeDependencies({
              rtx5060ti:
                "busy",
              rtx3090:
                "ready",
            }) as any,
          );

        expect(result?.id)
          .toBe(job.id);

        expect(result?.backend)
          .toBe("rtx3090");

        expect(result?.status)
          .toBe("running");

        expect(
          result?.submissionState,
        ).toBe("accepted");

        expect(
          result?.comfyPromptId,
        ).toBe(
          "prompt-test-1",
        );
      },
    );

    it(
      "does not intentionally join either Comfy queue when both GPUs are busy",
      async () => {
        const job =
          createJob("busy");

        const result =
          await runProductionV2Ltx25SchedulerTick(
            runtimeDependencies({
              rtx5060ti:
                "busy",
              rtx3090:
                "busy",
            }) as any,
          );

        expect(result?.id)
          .toBe(job.id);

        expect(result?.status)
          .toBe(
            "queued_waiting_for_gpu",
          );

        expect(result?.backend)
          .toBeNull();

        expect(result?.attempts)
          .toBe(0);
      },
    );

    it(
      "submits on the 5060 and completes from durable Comfy history",
      async () => {
        const job =
          createJob("complete");

        const deps =
          runtimeDependencies({
            rtx5060ti:
              "ready",
            rtx3090:
              "ready",
          });

        const submitted =
          await runProductionV2Ltx25SchedulerTick(
            deps as any,
          );

        expect(submitted?.id)
          .toBe(job.id);

        expect(submitted?.backend)
          .toBe(
            "rtx5060ti",
          );

        expect(submitted?.status)
          .toBe("running");

        expect(
          submitted?.submissionState,
        ).toBe("accepted");

        const completed =
          await runProductionV2Ltx25SchedulerTick(
            deps as any,
          );

        expect(completed?.status)
          .toBe("completed");

        expect(
          completed?.outputPath,
        ).toMatch(
          /production-ltx25-.*\.mp4$/,
        );
      },
    );

    it(
      "never automatically replays an ambiguous dispatched prompt",
      async () => {
        const job =
          createJob("ambiguous");

        const deps =
          runtimeDependencies({
            rtx5060ti:
              "ready",
            rtx3090:
              "ready",
          });

        deps.submit =
          async (
            input: any,
          ) => {
            await input
              .onBeforePromptPost?.();

            throw new Ltx25SubmissionUnknownError(
              "network timeout after dispatch",
            );
          };

        const result =
          await runProductionV2Ltx25SchedulerTick(
            deps as any,
          );

        expect(result?.id)
          .toBe(job.id);

        expect(result?.status)
          .toBe("failed");

        expect(
          result?.submissionState,
        ).toBe("unknown");

        const persisted =
          getProductionV2Ltx25GenerationJob(
            job.id,
          );

        expect(
          persisted?.attempts,
        ).toBe(1);

        const second =
          await runProductionV2Ltx25SchedulerTick(
            deps as any,
          );

        expect(second)
          .toBeNull();

        expect(
          getProductionV2Ltx25GenerationJob(
            job.id,
          )?.attempts,
        ).toBe(1);
      },
    );
  },
);
