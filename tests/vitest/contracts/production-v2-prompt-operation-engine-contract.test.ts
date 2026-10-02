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
  normalizeProductionV2,
} from "@/lib/production/v2";

import {
  createProductionV2PromptOperation,
  getProductionV2PromptOperation,
  listActiveProductionV2PromptOperations,
  runProductionV2PromptOperationTick,
  setProductionV2PromptOperationStoreRootForTests,
} from "@/lib/production/v2PromptOperations";

let tempRoot = "";

function scene() {
  return normalizeProductionV2({
    schemaVersion:
      2,

    id:
      "prompt-operation-test-production",

    name:
      "Prompt Operation Test",

    status:
      "draft",

    defaultModel:
      "minimax-h3",

    scenes: [
      {
        model:
          "minimax-h3",
      },
    ],
  }).scenes[0];
}

function completedChild(
  id: string,
  content: string,
) {
  return {
    id,
    status:
      "completed",
    statusMessage:
      "Complete",
    responseStatus:
      200,
    responseHeaders:
      {
        "x-otg-qwen-model":
          "test-qwen",
      },
    responseBody:
      JSON.stringify(
        {
          message:
            {
              content,
            },
        },
      ),
    error:
      null,
  } as any;
}

beforeEach(() => {
  tempRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "otg-production-prompt-operation-",
      ),
    );

  setProductionV2PromptOperationStoreRootForTests(
    tempRoot,
  );
});

afterEach(() => {
  setProductionV2PromptOperationStoreRootForTests(
    null,
  );

  fs.rmSync(
    tempRoot,
    {
      recursive:
        true,

      force:
        true,
    },
  );
});

describe(
  "Production V2 durable prompt operation engine",
  () => {
    it(
      "persists an owner-scoped durable operation",
      () => {
        const operation =
          createProductionV2PromptOperation(
            "owner-a",
            scene(),
          );

        expect(
          operation.id,
        ).toMatch(
          /^promptop_/,
        );

        expect(
          operation.ownerKey,
        ).toBe(
          "owner-a",
        );

        expect(
          operation.status,
        ).toBe(
          "queued",
        );

        expect(
          operation.stage,
        ).toBe(
          "enhancement",
        );

        expect(
          getProductionV2PromptOperation(
            operation.id,
          )?.id,
        ).toBe(
          operation.id,
        );

        expect(
          listActiveProductionV2PromptOperations()
            .map(
              (item) =>
                item.id,
            ),
        ).toEqual(
          [
            operation.id,
          ],
        );
      },
    );

    it(
      "uses the same deterministic enhancement child across repeated operation ticks",
      async () => {
        const operation =
          createProductionV2PromptOperation(
            "owner-a",
            scene(),
          );

        const ensuredIds:
          string[] = [];

        const queuedChild =
          {
            id:
              `qwen_${operation.id}_enhancement`,

            status:
              "queued",

            statusMessage:
              "Waiting for first available Qwen GPU",

            error:
              null,
          } as any;

        const dependencies = {
          ensureJob:
            (input: any) => {
              ensuredIds.push(
                String(
                  input.id,
                ),
              );

              return {
                ...queuedChild,

                id:
                  input.id,
              };
            },

          getJob:
            (id: string) => ({
              ...queuedChild,
              id,
            }),

          kickQwen:
            () => {},
        };

        await runProductionV2PromptOperationTick(
          dependencies,
        );

        await runProductionV2PromptOperationTick(
          dependencies,
        );

        expect(
          ensuredIds,
        ).toEqual(
          [
            `qwen_${operation.id}_enhancement`,
            `qwen_${operation.id}_enhancement`,
          ],
        );

        const current =
          getProductionV2PromptOperation(
            operation.id,
          );

        expect(
          current?.status,
        ).toBe(
          "waiting_for_qwen",
        );

        expect(
          current?.enhancementJobId,
        ).toBe(
          `qwen_${operation.id}_enhancement`,
        );

        expect(
          current?.repairJobId,
        ).toBeNull();
      },
    );

    it(
      "contains stable enhancement and repair child identities",
      () => {
        const source =
          fs.readFileSync(
            path.join(
              process.cwd(),
              "lib/production/v2PromptOperations.ts",
            ),
            "utf8",
          );

        expect(
          source,
        ).toContain(
          "OTG_PRODUCTION_V2_PROMPT_OPERATION_V1",
        );

        expect(
          source,
        ).toContain(
          'stage === "enhancement"',
        );

        expect(
          source,
        ).toContain(
          '"repair"',
        );

        expect(
          source,
        ).toContain(
          "ensureQwenDurableJob",
        );

        expect(
          source,
        ).toContain(
          "buildProductionV2SceneRepairInstruction",
        );
      },
    );

    it(
      "completes H3 with deterministic structure when both model attempts omit required sections",
      async () => {
        const inputScene =
          scene();

        inputScene.durationSeconds =
          10;
        inputScene.generationMode =
          "h3-text-to-video";
        inputScene.promptStateByMode[
          inputScene.generationMode
        ].userPrompt =
          'Two children play rock paper scissors. The girl says "I win!"';

        const operation =
          createProductionV2PromptOperation(
            "owner-a",
            inputScene,
          );

        const dependencies = {
          ensureJob:
            (input: any) =>
              completedChild(
                input.id,
                "summary:\nIncomplete model output.",
              ),
          getJob:
            (id: string) =>
              completedChild(
                id,
                "summary:\nIncomplete model output.",
              ),
          kickQwen:
            () => {},
        };

        await runProductionV2PromptOperationTick(
          dependencies,
        );
        await runProductionV2PromptOperationTick(
          dependencies,
        );

        const current =
          getProductionV2PromptOperation(
            operation.id,
          );

        expect(
          current?.status,
        ).toBe(
          "completed",
        );
        expect(
          current?.statusMessage,
        ).toBe(
          "Scene Prompt complete with deterministic structure repair.",
        );
        expect(
          current?.result?.provider,
        ).toBe(
          "ollama:test-qwen+deterministic-structure",
        );
        expect(
          current?.result?.scenePrompt,
        ).toContain(
          "OVERALL SOUNDSCAPE",
        );
        expect(
          current?.result?.scenePrompt,
        ).toContain(
          "NON-DIEGETIC MUSIC",
        );
        expect(
          current?.result?.scenePrompt,
        ).toContain(
          'The girl says "I win!"',
        );
        expect(
          current?.validation.ok,
        ).toBe(
          true,
        );
      },
    );
  },
);
