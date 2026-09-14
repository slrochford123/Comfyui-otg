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
  ensureQwenDurableJob,
  getQwenDurableJob,
  setQwenDurableJobStorePathForTests,
} from "@/lib/workers/qwenDurableJobs";

let tempRoot = "";

beforeEach(() => {
  tempRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "otg-qwen-deterministic-",
      ),
    );

  setQwenDurableJobStorePathForTests(
    path.join(
      tempRoot,
      "jobs.sqlite",
    ),
  );
});

afterEach(() => {
  setQwenDurableJobStorePathForTests(
    null,
  );

  fs.rmSync(
    tempRoot,
    {
      recursive: true,
      force: true,
    },
  );
});

function childInput() {
  return {
    id:
      "qwen_prompt_operation_abc_enhancement",

    ownerKey:
      "deterministic-owner",

    requestKind:
      "production-v2-scene-prompt:enhancement",

    path:
      "/api/chat" as const,

    payload: {
      messages: [
        {
          role:
            "user",

          content:
            "Build the scene prompt.",
        },
      ],

      stream:
        false,
    },

    requiredContextTokens:
      8192,

    allowedNodes:
      [
        "slr",
        "shawn",
      ] as const,

    model:
      "qwen3.5:4b",

    modelByNode: {
      slr:
        "qwen3.5:4b",

      shawn:
        "qwen3.5:4b",
    },

    keepAlive:
      0,

    executionTimeoutMs:
      120_000,

    leaseTtlSeconds:
      150,
  };
}

describe(
  "deterministic durable Qwen child jobs",
  () => {
    it(
      "returns the same durable row when the same deterministic child is ensured twice",
      () => {
        const first =
          ensureQwenDurableJob(
            childInput(),
          );

        const second =
          ensureQwenDurableJob(
            childInput(),
          );

        expect(
          first.id,
        ).toBe(
          "qwen_prompt_operation_abc_enhancement",
        );

        expect(
          second.id,
        ).toBe(
          first.id,
        );

        expect(
          second.createdAt,
        ).toBe(
          first.createdAt,
        );

        expect(
          second.attempts,
        ).toBe(
          0,
        );

        expect(
          getQwenDurableJob(
            first.id,
          )?.id,
        ).toBe(
          first.id,
        );
      },
    );

    it(
      "rejects reuse of a deterministic id for a different payload",
      () => {
        ensureQwenDurableJob(
          childInput(),
        );

        expect(
          () =>
            ensureQwenDurableJob({
              ...childInput(),

              payload: {
                messages: [
                  {
                    role:
                      "user",

                    content:
                      "Different inference request.",
                  },
                ],

                stream:
                  false,
              },
            }),
        ).toThrow(
          /id collision/i,
        );
      },
    );

    it(
      "rejects unsafe explicit ids",
      () => {
        expect(
          () =>
            ensureQwenDurableJob({
              ...childInput(),

              id:
                "../../unsafe",
            }),
        ).toThrow(
          /invalid durable Qwen job id/i,
        );
      },
    );
  },
);
