import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireResourceLock,
  clearResourceLocksForTests,
  listResourceLocks,
  releaseResourceLock,
  setResourceLockStorePathForTests,
} from "@/lib/workers/resourceLocks";
import {
  acquireComfy5060Lease,
  releaseComfy5060Lease,
} from "@/lib/workers/comfy5060Lease";
import {
  runLtxVoiceFailover,
  type LtxFailoverMetadata,
} from "@/lib/ltxVoiceFailover";
import {
  checkpointRemoteWorkerJob,
  clearQueuedContractJobsForTests,
  createCharacterVoicePipelineJob,
  failRemoteWorkerJob,
  getQueuedContractJob,
  setVoicePipelineJobStorePathForTests,
} from "@/lib/jobs/voicePipelineJobs";
import { submitComfyPromptWith5060Lease } from "@/lib/workers/comfyPromptLease";

const execFileAsync = promisify(execFile);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-ltx-failover-contract-"));

function lockPath(name = "locks") {
  return path.join(tempRoot, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
}

describe("atomic RTX 5060 Ti resource lease", () => {
  beforeEach(() => {
    setResourceLockStorePathForTests(lockPath());
    clearResourceLocksForTests();
  });

  it("allows exactly one of concurrent independent processes to acquire gpu:linux-5060ti", async () => {
    const sharedPath = lockPath("concurrent");
    const startAt = Date.now() + 2_000;
    const executable = path.join(process.cwd(), "node_modules/.bin/vite-node");
    const fixture = path.join(process.cwd(), "tests/vitest/fixtures/resource-lock-contender.ts");
    const contenders = Array.from({ length: 8 }, (_, index) =>
      execFileAsync(executable, ["--config", "tests/vitest.config.ts", fixture, sharedPath, `owner-${index}`, String(startAt)])
        .then(({ stdout }) => JSON.parse(stdout.trim())),
    );

    const results = await Promise.all(contenders);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  }, 20_000);

  it("requires both owner identity and fencing token for release", () => {
    const acquired = acquireResourceLock({
      lockId: "gpu:linux-5060ti",
      ownerId: "image-job-a",
      ownerType: "job",
      workerId: "image-route",
    });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;

    expect(releaseResourceLock("gpu:linux-5060ti", "other-owner", acquired.lock.fencingToken)).toBe(false);
    expect(releaseResourceLock("gpu:linux-5060ti", "image-job-a", "wrong-token")).toBe(false);
    expect(listResourceLocks()).toHaveLength(1);
    expect(releaseResourceLock("gpu:linux-5060ti", "image-job-a", acquired.lock.fencingToken)).toBe(true);
  });

  it("recovers an expired lease transactionally without admitting two successors", async () => {
    const sharedPath = lockPath("stale");
    setResourceLockStorePathForTests(sharedPath);
    const stale = acquireResourceLock({
      lockId: "gpu:linux-5060ti",
      ownerId: "stale-owner",
      ownerType: "job",
      workerId: "stale-worker",
      ttlSeconds: 1,
    });
    expect(stale.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const startAt = Date.now() + 1_500;
    const executable = path.join(process.cwd(), "node_modules/.bin/vite-node");
    const fixture = path.join(process.cwd(), "tests/vitest/fixtures/resource-lock-contender.ts");
    const results = await Promise.all(
      ["successor-a", "successor-b"].map((owner) =>
        execFileAsync(executable, ["--config", "tests/vitest.config.ts", fixture, sharedPath, owner, String(startAt)])
          .then(({ stdout }) => JSON.parse(stdout.trim())),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  }, 20_000);

  it("excludes LTX while an 8188 image lease is held, and excludes image work while LTX owns it", () => {
    const image = acquireComfy5060Lease({ ownerId: "image-a", workerId: "image-route", purpose: "image" });
    expect(image.ok).toBe(true);
    const blockedLtx = acquireComfy5060Lease({ ownerId: "ltx-a", workerId: "ltx-fallback", purpose: "ltx-fallback" });
    expect(blockedLtx.ok).toBe(false);
    if (image.ok) expect(releaseComfy5060Lease(image.lease)).toBe(true);

    const ltx = acquireComfy5060Lease({ ownerId: "ltx-b", workerId: "ltx-fallback", purpose: "ltx-fallback" });
    expect(ltx.ok).toBe(true);
    const blockedImage = acquireComfy5060Lease({ ownerId: "image-b", workerId: "image-route", purpose: "image" });
    expect(blockedImage.ok).toBe(false);
    if (ltx.ok) expect(releaseComfy5060Lease(ltx.lease)).toBe(true);
  });

  it("does not invoke the real 8188 prompt transport while LTX owns the shared lease", async () => {
    const ltx = acquireComfy5060Lease({ ownerId: "ltx-owner", workerId: "ltx-fallback", purpose: "ltx-fallback" });
    expect(ltx.ok).toBe(true);
    const transport = vi.fn<(_: string, __: RequestInit) => Promise<Response>>();
    await expect(submitComfyPromptWith5060Lease({
      baseUrl: "http://100.98.212.116:8188",
      workerId: "image-route",
      init: { method: "POST", body: "{}" },
      fetcher: transport,
    })).rejects.toMatchObject({ code: "gpu_linux_5060ti_busy" });
    expect(transport).not.toHaveBeenCalled();
    if (ltx.ok) expect(releaseComfy5060Lease(ltx.lease)).toBe(true);
  });
});

describe("authenticated RTX 5060 Ti lease API", () => {
  beforeEach(() => {
    process.env.OTG_WORKER_CONTROL_TOKEN = "lease-api-test-token";
    setResourceLockStorePathForTests(lockPath("api"));
    clearResourceLocksForTests();
  });

  it("rejects unauthenticated acquisition and enforces fencing-token release", async () => {
    const { POST: acquire } = await import("@/app/api/worker-control/resource-lock/acquire/route");
    const { POST: release } = await import("@/app/api/worker-control/resource-lock/release/route");
    const body = { lockId: "gpu:linux-5060ti", ownerId: "remote-ltx-job", workerId: "ltx-worker" };
    const missingAuth = await acquire(new NextRequest("http://test/api/worker-control/resource-lock/acquire", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }));
    expect(missingAuth.status).toBe(401);

    const acquired = await acquire(new NextRequest("http://test/api/worker-control/resource-lock/acquire", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", authorization: "Bearer lease-api-test-token" },
    }));
    expect(acquired.status).toBe(200);
    const payload = await acquired.json();

    const wrongRelease = await release(new NextRequest("http://test/api/worker-control/resource-lock/release", {
      method: "POST",
      body: JSON.stringify({ ownerId: body.ownerId, fencingToken: "wrong-token" }),
      headers: { "content-type": "application/json", authorization: "Bearer lease-api-test-token" },
    }));
    expect(wrongRelease.status).toBe(409);
    expect(listResourceLocks()).toHaveLength(1);

    const released = await release(new NextRequest("http://test/api/worker-control/resource-lock/release", {
      method: "POST",
      body: JSON.stringify({ ownerId: body.ownerId, fencingToken: payload.lock.fencingToken }),
      headers: { "content-type": "application/json", authorization: "Bearer lease-api-test-token" },
    }));
    expect(released.status).toBe(200);
    expect(listResourceLocks()).toHaveLength(0);
  });
});

function metadata(overrides: Partial<LtxFailoverMetadata> = {}): LtxFailoverMetadata {
  return {
    preferredGpu: "3090",
    actualGpu: null,
    backend: null,
    fallbackReason: null,
    backendEndpoint: null,
    backendService: null,
    submissionId: null,
    promptId: null,
    submissionState: "pre_submit",
    ...overrides,
  };
}

describe("LTX primary/fallback state machine", () => {
  it("submits once to healthy primary and never invokes fallback", async () => {
    const events: string[] = [];
    let primarySubmissions = 0;
    let fallbackSubmissions = 0;
    const outcome = await runLtxVoiceFailover({
      initialMetadata: metadata(),
      preflightPrimary: async () => ({ ok: true }),
      submitPrimary: async () => { primarySubmissions += 1; return { promptId: "primary-real-id" }; },
      collectPrimaryOutput: async () => ({ outputPath: "/tmp/primary.flac" }),
      persistOutput: async () => events.push("persisted"),
      finalizeJob: async () => events.push("finalized"),
      persistState: async () => undefined,
      acquireFallbackLease: async () => { throw new Error("fallback must not acquire"); },
      startFallback: async () => undefined,
      verifyFallback: async () => undefined,
      submitFallback: async () => { fallbackSubmissions += 1; return { promptId: "forbidden" }; },
      collectFallbackOutput: async () => ({ outputPath: "/tmp/fallback.flac" }),
      failJob: async () => undefined,
      releaseFallbackLease: async () => undefined,
    });
    expect(primarySubmissions).toBe(1);
    expect(fallbackSubmissions).toBe(0);
    expect(outcome.metadata).toMatchObject({ actualGpu: "3090", backend: "primary", promptId: "primary-real-id", fallbackReason: null, submissionState: "completed" });
    expect(events).toEqual(["persisted", "finalized"]);
  });

  it("uses fallback exactly once only for deterministic pre-submit primary failure", async () => {
    let primarySubmissions = 0;
    let fallbackSubmissions = 0;
    const events: string[] = [];
    const outcome = await runLtxVoiceFailover({
      initialMetadata: metadata(),
      preflightPrimary: async () => ({ ok: false, reason: "primary-resource-locked" }),
      submitPrimary: async () => { primarySubmissions += 1; return { promptId: "forbidden" }; },
      collectPrimaryOutput: async () => ({ outputPath: "/tmp/forbidden" }),
      persistState: async () => undefined,
      acquireFallbackLease: async () => ({ ownerId: "ltx", fencingToken: "token" }),
      startFallback: async () => events.push("started"),
      verifyFallback: async () => events.push("verified"),
      submitFallback: async () => { fallbackSubmissions += 1; return { promptId: "fallback-real-id" }; },
      collectFallbackOutput: async () => { events.push("collected"); return { outputPath: "/tmp/fallback.flac" }; },
      persistOutput: async () => events.push("persisted"),
      finalizeJob: async () => events.push("finalized"),
      failJob: async () => undefined,
      releaseFallbackLease: async () => events.push("released"),
    });
    expect(primarySubmissions).toBe(0);
    expect(fallbackSubmissions).toBe(1);
    expect(outcome.metadata).toMatchObject({ actualGpu: "5060-ti", backend: "fallback", fallbackReason: "primary-resource-locked", promptId: "fallback-real-id", submissionState: "completed" });
    expect(events).toEqual(["started", "verified", "collected", "persisted", "finalized", "released"]);
  });

  it("persists submission_unknown and performs zero fallback submissions after ambiguous primary POST", async () => {
    const states: string[] = [];
    let fallbackSubmissions = 0;
    const outcome = await runLtxVoiceFailover({
      initialMetadata: metadata(),
      preflightPrimary: async () => ({ ok: true }),
      submitPrimary: async () => { throw new Error("connection reset after request write"); },
      collectPrimaryOutput: async () => ({ outputPath: "/tmp/forbidden" }),
      persistState: async (value) => states.push(value.submissionState),
      acquireFallbackLease: async () => { throw new Error("fallback must not acquire"); },
      startFallback: async () => undefined,
      verifyFallback: async () => undefined,
      submitFallback: async () => { fallbackSubmissions += 1; return { promptId: "forbidden" }; },
      collectFallbackOutput: async () => ({ outputPath: "/tmp/forbidden" }),
      persistOutput: async () => undefined,
      finalizeJob: async () => undefined,
      failJob: async () => undefined,
      releaseFallbackLease: async () => undefined,
    });
    expect(outcome.kind).toBe("submission_unknown");
    expect(outcome.metadata.submissionState).toBe("submission_unknown");
    expect(states).toContain("submission_unknown");
    expect(fallbackSubmissions).toBe(0);
  });

  it("never falls back after a primary prompt ID was returned, even if output collection fails", async () => {
    let fallbackSubmissions = 0;
    const failures: LtxFailoverMetadata[] = [];
    const outcome = await runLtxVoiceFailover({
      initialMetadata: metadata(),
      preflightPrimary: async () => ({ ok: true }),
      submitPrimary: async () => ({ promptId: "accepted-primary-id" }),
      collectPrimaryOutput: async () => { throw new Error("primary generation failed"); },
      persistState: async () => undefined,
      acquireFallbackLease: async () => { throw new Error("must not acquire fallback"); },
      startFallback: async () => undefined,
      verifyFallback: async () => undefined,
      submitFallback: async () => { fallbackSubmissions += 1; return { promptId: "forbidden" }; },
      collectFallbackOutput: async () => ({ outputPath: "/tmp/forbidden" }),
      persistOutput: async () => undefined,
      finalizeJob: async () => undefined,
      failJob: async (_error, value) => failures.push(value),
      releaseFallbackLease: async () => undefined,
    });
    expect(outcome.kind).toBe("failed");
    expect(outcome.metadata).toMatchObject({ promptId: "accepted-primary-id", submissionState: "failed", actualGpu: "3090" });
    expect(fallbackSubmissions).toBe(0);
    expect(failures).toHaveLength(1);
  });

  it("keeps fallback metadata, fails once, and releases only after failure persistence", async () => {
    const events: string[] = [];
    let fallbackSubmissions = 0;
    const outcome = await runLtxVoiceFailover({
      initialMetadata: metadata(),
      preflightPrimary: async () => ({ ok: false, reason: "primary-unreachable" }),
      submitPrimary: async () => ({ promptId: "forbidden" }),
      collectPrimaryOutput: async () => ({ outputPath: "/tmp/forbidden" }),
      persistState: async () => undefined,
      acquireFallbackLease: async () => ({ ownerId: "ltx", fencingToken: "token" }),
      startFallback: async () => events.push("started"),
      verifyFallback: async () => events.push("verified"),
      submitFallback: async () => { fallbackSubmissions += 1; return { promptId: "fallback-one-id" }; },
      collectFallbackOutput: async () => { throw new Error("8191 crashed"); },
      persistOutput: async () => events.push("persisted"),
      finalizeJob: async () => events.push("finalized"),
      failJob: async (_error, value) => events.push(`failed:${value.actualGpu}:${value.promptId}`),
      releaseFallbackLease: async () => events.push("released"),
    });
    expect(outcome.kind).toBe("failed");
    expect(outcome.metadata).toMatchObject({ actualGpu: "5060-ti", backend: "fallback", promptId: "fallback-one-id" });
    expect(fallbackSubmissions).toBe(1);
    expect(events).toEqual(["started", "verified", "failed:5060-ti:fallback-one-id", "released"]);
  });
});

describe("legacy voice job compatibility", () => {
  it("deserializes records that predate optional failover metadata", () => {
    const storePath = path.join(tempRoot, `legacy-${Date.now()}.json`);
    fs.writeFileSync(storePath, JSON.stringify({ version: 1, jobs: [{
      jobId: "legacy-ltx-job",
      jobType: "character_voice_pipeline",
      action: "create_voice_sample",
      status: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      ownerKey: "legacy-owner",
      characterId: "legacy-character",
      clipId: null,
      input: { provider: "ltx" },
      result: { comfyPromptId: "legacy-prompt" },
      error: null,
    }] }));
    setVoicePipelineJobStorePathForTests(storePath);
    expect(getQueuedContractJob("legacy-owner", "legacy-ltx-job")).toMatchObject({
      jobId: "legacy-ltx-job",
      status: "completed",
      result: { comfyPromptId: "legacy-prompt" },
    });
  });

  it("persists optional failover routing fields at creation, checkpoint, and failure", () => {
    const storePath = path.join(tempRoot, `metadata-${Date.now()}.json`);
    setVoicePipelineJobStorePathForTests(storePath);
    clearQueuedContractJobsForTests();
    const created = createCharacterVoicePipelineJob("owner", {
      action: "create_voice_sample",
      characterId: "character",
      provider: "ltx",
      prompt: "controlled test prompt",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.job).toMatchObject({ preferredGpu: "3090", submissionState: "pre_submit" });

    checkpointRemoteWorkerJob("owner", created.job.jobId, {
      actualGpu: "5060-ti",
      backend: "fallback",
      fallbackReason: "primary-resource-locked",
      backendEndpoint: "http://100.98.212.116:8191",
      backendService: "otg-character-ltx-audio-5060-3003.service",
      submissionId: "fallback-prompt",
      promptId: "fallback-prompt",
      submissionState: "submitted",
    }, 40);
    failRemoteWorkerJob("owner", created.job.jobId, "8191 crashed", {
      actualGpu: "5060-ti",
      backend: "fallback",
      fallbackReason: "primary-resource-locked",
      backendEndpoint: "http://100.98.212.116:8191",
      backendService: "otg-character-ltx-audio-5060-3003.service",
      submissionId: "fallback-prompt",
      promptId: "fallback-prompt",
      submissionState: "failed",
    });
    expect(getQueuedContractJob("owner", created.job.jobId)).toMatchObject({
      status: "failed",
      preferredGpu: "3090",
      actualGpu: "5060-ti",
      backend: "fallback",
      fallbackReason: "primary-resource-locked",
      submissionId: "fallback-prompt",
      promptId: "fallback-prompt",
      submissionState: "failed",
    });
  });
});
