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
  claimQwenDurableJob,
  createQwenDurableJob,
  getQwenDurableJob,
  markQwenDurableJobRunning,
  recoverQwenDurableJobsAfterProcessRestart,
  setQwenDurableJobStorePathForTests,
} from "@/lib/workers/qwenDurableJobs";

let tempRoot = "";

function createJob(
  label: string,
) {
  return createQwenDurableJob({
    ownerKey:
      "restart-contract",

    requestKind:
      label,

    path:
      "/api/generate",

    payload: {
      prompt:
        label,
    },

    requiredContextTokens:
      1024,

    allowedNodes:
      ["slr", "shawn"],

    model:
      null,

    modelByNode:
      {},

    keepAlive:
      null,

    executionTimeoutMs:
      30_000,

    leaseTtlSeconds:
      60,
  });
}

beforeEach(() => {
  tempRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "otg-qwen-recovery-",
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

describe(
  "Qwen durable restart recovery",
  () => {
    it(
      "keeps queued work and safely requeues claimed work that never started",
      () => {
        const queued =
          createJob(
            "queued-job",
          );

        const claimedCandidate =
          createJob(
            "claimed-job",
          );

        const claimed =
          claimQwenDurableJob(
            claimedCandidate.id,
          );

        expect(
          claimed?.status,
        ).toBe(
          "claimed",
        );

        expect(
          claimed?.assignedNode,
        ).toBeNull();

        expect(
          claimed?.startedAt,
        ).toBeNull();

        const recovery =
          recoverQwenDurableJobsAfterProcessRestart();

        expect(
          recovery.requeued,
        ).toBe(
          1,
        );

        expect(
          recovery.failedAmbiguous,
        ).toBe(
          0,
        );

        expect(
          recovery.queued,
        ).toBe(
          2,
        );

        expect(
          getQwenDurableJob(
            queued.id,
          )?.status,
        ).toBe(
          "queued",
        );

        const recovered =
          getQwenDurableJob(
            claimedCandidate.id,
          );

        expect(
          recovered?.status,
        ).toBe(
          "queued",
        );

        expect(
          recovered?.assignedNode,
        ).toBeNull();

        expect(
          recovered?.startedAt,
        ).toBeNull();

        expect(
          recovered?.claimedAt,
        ).toBeNull();

        expect(
          recovered?.statusMessage,
        ).toContain(
          "Recovered after server restart",
        );
      },
    );

    it(
      "never automatically retries a job that crossed the running boundary",
      () => {
        const candidate =
          createJob(
            "running-job",
          );

        const claimed =
          claimQwenDurableJob(
            candidate.id,
          );

        expect(
          claimed,
        ).not.toBeNull();

        const running =
          markQwenDurableJobRunning(
            candidate.id,
            "slr",
          );

        expect(
          running?.status,
        ).toBe(
          "running",
        );

        expect(
          running?.assignedNode,
        ).toBe(
          "slr",
        );

        expect(
          running?.startedAt,
        ).not.toBeNull();

        const recovery =
          recoverQwenDurableJobsAfterProcessRestart();

        expect(
          recovery.requeued,
        ).toBe(
          0,
        );

        expect(
          recovery.failedAmbiguous,
        ).toBe(
          1,
        );

        const recovered =
          getQwenDurableJob(
            candidate.id,
          );

        expect(
          recovered?.status,
        ).toBe(
          "failed",
        );

        expect(
          recovered?.error,
        ).toContain(
          "Automatic retry is disabled",
        );

        expect(
          recovered?.assignedNode,
        ).toBe(
          "slr",
        );

        expect(
          recovered?.startedAt,
        ).not.toBeNull();
      },
    );
  },
);
