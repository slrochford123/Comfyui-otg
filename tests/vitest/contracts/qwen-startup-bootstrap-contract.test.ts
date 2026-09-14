import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const instrumentation =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "instrumentation.ts",
    ),
    "utf8",
  );

const bootstrap =
  fs.readFileSync(
    path.join(
      process.cwd(),
      "lib/workers/qwenDurableBootstrap.ts",
    ),
    "utf8",
  );

describe(
  "Qwen durable startup bootstrap",
  () => {
    it(
      "registers Qwen recovery from the Next Node startup hook",
      () => {
        expect(
          instrumentation,
        ).toContain(
          "export async function register()",
        );

        expect(
          instrumentation,
        ).toContain(
          'process.env.NEXT_RUNTIME',
        );

        expect(
          instrumentation,
        ).toContain(
          '"nodejs"',
        );

        expect(
          instrumentation,
        ).toContain(
          "qwenDurableBootstrap",
        );

        expect(
          instrumentation,
        ).toContain(
          "bootstrapQwenDurableScheduler",
        );
      },
    );

    it(
      "recovers durable state before waking the scheduler",
      () => {
        expect(
          bootstrap,
        ).toContain(
          "recoverQwenDurableJobsAfterProcessRestart()",
        );

        expect(
          bootstrap,
        ).toContain(
          "kickQwenDurableScheduler()",
        );

        const recoverIndex =
          bootstrap.indexOf(
            "recoverQwenDurableJobsAfterProcessRestart()",
          );

        const kickIndex =
          bootstrap.indexOf(
            "kickQwenDurableScheduler()",
          );

        expect(
          recoverIndex,
        ).toBeGreaterThanOrEqual(
          0,
        );

        expect(
          kickIndex,
        ).toBeGreaterThan(
          recoverIndex,
        );

        expect(
          bootstrap,
        ).toContain(
          "__otgQwenDurableBootstrapV1",
        );
      },
    );
  },
);

describe(
  "Production V2 prompt operation startup recovery",
  () => {
    it(
      "starts prompt orchestration after raw Qwen recovery",
      () => {
        const qwenIndex =
          instrumentation.indexOf(
            "bootstrapQwenDurableScheduler();",
          );

        const promptIndex =
          instrumentation.indexOf(
            "bootstrapProductionV2PromptOperationScheduler();",
          );

        expect(
          qwenIndex,
        ).toBeGreaterThanOrEqual(
          0,
        );

        expect(
          promptIndex,
        ).toBeGreaterThan(
          qwenIndex,
        );

        expect(
          instrumentation,
        ).toContain(
          "OTG_PRODUCTION_V2_PROMPT_STARTUP_RECOVERY_V1",
        );
      },
    );
  },
);
