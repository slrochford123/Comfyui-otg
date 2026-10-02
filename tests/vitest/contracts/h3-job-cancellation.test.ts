import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workers/comfySubmissionCriticalSection", () => ({
  runWithComfySubmissionCriticalSection: async (_input: unknown, action: () => Promise<unknown>) => ({
    ok: true,
    value: await action(),
  }),
}));

import { cancelH3Prompt } from "@/lib/production/h3Comfy";
import {
  createProductionV2GenerationJob,
  failProductionV2GenerationJob,
  getProductionV2GenerationJob,
  listActiveProductionV2GenerationJobs,
  listWaitingProductionV2GenerationJobs,
  markProductionV2GenerationCanceled,
  markProductionV2GenerationNativeReady,
  markProductionV2GenerationSubmitted,
  requestProductionV2GenerationCancellation,
  setProductionV2GenerationJobStorePathForTests,
} from "@/lib/production/h3GenerationJobs";
import { DEFAULT_PRODUCTION_V2_H3_USER_LORAS } from "@/lib/production/h3Loras";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("H3 ComfyUI cancellation", () => {
  it("uses prompt-specific cancellation when the backend supports it", async () => {
    const fetcher = vi.fn(async () => json({ cancelled: true }));
    const result = await cancelH3Prompt({
      backend: "rtx5060ti",
      promptId: "prompt-a",
      jobId: "job-a",
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(result).toEqual({ outcome: "cancel-requested", mechanism: "prompt-specific" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("/api/jobs/prompt-a/cancel");
  });

  it("refuses a legacy global interrupt when the active prompt changes", async () => {
    const responses = [
      json({}, 404),
      json({ queue_running: [[1, "prompt-a"]], queue_pending: [] }),
      json({ queue_running: [[2, "newer-prompt"]], queue_pending: [] }),
    ];
    const fetcher = vi.fn(async () => responses.shift() || json({}));
    await expect(cancelH3Prompt({
      backend: "rtx3090",
      promptId: "prompt-a",
      jobId: "job-a",
      fetcher: fetcher as unknown as typeof fetch,
    })).rejects.toThrow("safely refused");
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/interrupt"))).toBe(false);
  });

  it("uses a guarded legacy interrupt only for the exact active prompt", async () => {
    const responses = [
      json({}, 404),
      json({ queue_running: [[1, "prompt-a"]], queue_pending: [] }),
      json({ queue_running: [[1, "prompt-a"]], queue_pending: [] }),
      json({ ok: true }),
    ];
    const fetcher = vi.fn(async () => responses.shift() || json({}));
    const result = await cancelH3Prompt({
      backend: "rtx3090",
      promptId: "prompt-a",
      jobId: "job-a",
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(result.mechanism).toBe("guarded-interrupt");
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/interrupt"))).toBe(true);
  });
});

describe("Production H3 canceled state", () => {
  let directory = "";

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "otg-h3-cancel-"));
    setProductionV2GenerationJobStorePathForTests(path.join(directory, "jobs.sqlite"));
  });

  afterEach(() => {
    setProductionV2GenerationJobStorePathForTests(null);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("is idempotent, distinct from failed, and cannot advance into post-processing", () => {
    const created = createProductionV2GenerationJob({
      ownerKey: "owner-a",
      productionId: "production-a",
      sceneId: "scene-a",
      mode: "h3-text-to-video",
      payload: {
        finalPrompt: "test",
        promptFingerprint: "fingerprint",
        durationSeconds: 5,
        h3Quality: "lq",
        seed: 1,
        startImage: null,
        references: [],
        voices: [],
        userLoras: DEFAULT_PRODUCTION_V2_H3_USER_LORAS,
      },
    });
    const first = requestProductionV2GenerationCancellation(created.id, "owner-a");
    const second = requestProductionV2GenerationCancellation(created.id, "owner-a");
    expect(first?.status).toBe("canceling");
    expect(second?.status).toBe("canceling");

    const canceled = markProductionV2GenerationCanceled(created.id);
    expect(canceled?.status).toBe("canceled");
    failProductionV2GenerationJob(created.id, "must not overwrite cancellation");
    expect(getProductionV2GenerationJob(created.id)?.status).toBe("canceled");
    expect(markProductionV2GenerationSubmitted({
      id: created.id,
      backend: "rtx5060ti",
      promptId: "stale-prompt",
      workflowId: "workflow",
      workflowFile: "workflow.json",
    })).toBeNull();
    expect(markProductionV2GenerationNativeReady(created.id, "/tmp/native.mp4")).toBeNull();
    expect(listWaitingProductionV2GenerationJobs()).toEqual([]);
    expect(listActiveProductionV2GenerationJobs()).toEqual([]);
  });
});
