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
  },
);
