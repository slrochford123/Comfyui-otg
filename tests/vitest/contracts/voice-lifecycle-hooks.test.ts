import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearQueuedContractJobsForTests,
  completeRemoteWorkerJob,
  createCharacterVoicePipelineJob,
  failRemoteWorkerJob,
  setVoicePipelineJobStorePathForTests,
} from "@/lib/jobs/voicePipelineJobs";
import {
  enqueueQwen3VoiceSampleLifecycleRelease,
  ensureQwen3VoiceSampleLifecycle,
  shouldBlockVoiceLifecycle,
} from "@/lib/workers/voiceLifecycleHooks";
import { getWorkerCatalogEntry } from "@/lib/workers/workerCatalog";
import {
  clearWorkerLifecycleCommandsForTests,
  listRecentLifecycleCommands,
  setWorkerLifecycleStorePathForTests,
} from "@/lib/workers/workerLifecycleStore";

describe("Qwen3 voice lifecycle hook", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-voice-lifecycle-"));

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setWorkerLifecycleStorePathForTests(path.join(tempRoot, `commands-${suffix}.json`));
    setVoicePipelineJobStorePathForTests(path.join(tempRoot, `jobs-${suffix}.json`));
    clearWorkerLifecycleCommandsForTests();
    clearQueuedContractJobsForTests();
    delete process.env.OTG_WORKER_LIFECYCLE_ENABLED;
    delete process.env.OTG_WORKER_LIFECYCLE_QWEN3;
    delete process.env.OTG_WORKER_LIFECYCLE_STRICT;
    delete process.env.OTG_WORKER_TOKEN;
    process.env.OTG_WORKER_LIFECYCLE_WAIT_MS = "1";
  });

  it("does nothing when lifecycle is disabled", async () => {
    const result = await ensureQwen3VoiceSampleLifecycle({
      action: "create_voice_sample",
      provider: "qwen3",
      characterId: "char-a",
    });

    expect(result.enabled).toBe(false);
    expect(result.ready).toBe(true);
    expect(listRecentLifecycleCommands()).toHaveLength(0);
  });

  it("does nothing for non-Qwen3 providers", async () => {
    process.env.OTG_WORKER_LIFECYCLE_ENABLED = "1";
    process.env.OTG_WORKER_LIFECYCLE_QWEN3 = "1";

    const result = await ensureQwen3VoiceSampleLifecycle({
      action: "create_voice_sample",
      provider: "cosy",
      characterId: "char-a",
    });

    expect(result.enabled).toBe(false);
    expect(listRecentLifecycleCommands()).toHaveLength(0);
  });

  it("uses no standalone lifecycle commands for the embedded Qwen3 runtime", async () => {
    process.env.OTG_WORKER_LIFECYCLE_ENABLED = "1";
    process.env.OTG_WORKER_LIFECYCLE_QWEN3 = "1";

    const result = await ensureQwen3VoiceSampleLifecycle({
      action: "create_voice_sample",
      provider: "qwen3",
      characterId: "char-a",
    });

    expect(listRecentLifecycleCommands()).toHaveLength(0);
    expect(result.requiredWorkers).toEqual([]);
    expect(result.commands).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.timedOut).toBe(false);
    expect(result.ready).toBe(true);
  });

  it("keeps the embedded Qwen3 runtime available for status only", () => {
    const runtime = getWorkerCatalogEntry("qwen3-tts");

    expect(runtime).toMatchObject({
      enabled: false,
      dryRunOnly: true,
      allowedActions: ["status"],
      userStatusKind: "one-shot",
    });
  });

  it("does not block valid embedded Qwen3 requests in strict lifecycle mode", async () => {
    process.env.OTG_WORKER_LIFECYCLE_ENABLED = "1";
    process.env.OTG_WORKER_LIFECYCLE_QWEN3 = "1";
    process.env.OTG_WORKER_LIFECYCLE_STRICT = "0";

    const nonStrict = await ensureQwen3VoiceSampleLifecycle({
      action: "create_voice_sample",
      provider: "qwen3",
      characterId: "char-a",
    });
    expect(nonStrict.ready).toBe(true);
    expect(shouldBlockVoiceLifecycle(nonStrict)).toBe(false);

    clearWorkerLifecycleCommandsForTests();
    process.env.OTG_WORKER_LIFECYCLE_STRICT = "1";
    const strict = await ensureQwen3VoiceSampleLifecycle({
      action: "create_voice_sample",
      provider: "qwen3",
      characterId: "char-a",
    });
    expect(strict.ready).toBe(true);
    expect(strict.requiredWorkers).toEqual([]);
    expect(strict.commands).toEqual([]);
    expect(shouldBlockVoiceLifecycle(strict)).toBe(false);
  });

  it("allows a strict Qwen3 request without waiting for a lifecycle agent", async () => {
    process.env.OTG_WORKER_LIFECYCLE_ENABLED = "1";
    process.env.OTG_WORKER_LIFECYCLE_QWEN3 = "1";
    process.env.OTG_WORKER_LIFECYCLE_STRICT = "1";
    process.env.OTG_WORKER_LIFECYCLE_WAIT_MS = "1000";

    const result = await ensureQwen3VoiceSampleLifecycle({
      action: "create_voice_sample",
      provider: "qwen3",
      characterId: "char-a",
    });

    expect(result.requiredWorkers).toEqual([]);
    expect(listRecentLifecycleCommands()).toHaveLength(0);
    expect(result.errors).toEqual([]);
    expect(result.ready).toBe(true);
    expect(shouldBlockVoiceLifecycle(result)).toBe(false);
  });

  it("does not expose shell command text or token data in lifecycle metadata", async () => {
    process.env.OTG_WORKER_LIFECYCLE_ENABLED = "1";
    process.env.OTG_WORKER_LIFECYCLE_QWEN3 = "1";
    process.env.OTG_WORKER_TOKEN = "unit-test-token";

    const result = await ensureQwen3VoiceSampleLifecycle({
      action: "create_voice_sample",
      provider: "qwen3",
      characterId: "char-a",
    });
    const serialized = JSON.stringify(result).toLowerCase();

    expect(serialized).not.toContain("powershell");
    expect(serialized).not.toContain("cmd.exe");
    expect(serialized).not.toContain("worker-manager");
    expect(serialized).not.toContain("unit-test-token");
    expect(serialized).not.toContain("bearer ");
    expect(serialized).not.toContain("--worker-token");
  });

  it("does not queue release commands when lifecycle cleanup is disabled", () => {
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      provider: "qwen3",
      characterId: "char-a",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const completed = completeRemoteWorkerJob("owner-a", created.job.jobId, { ok: true });
    expect(completed).not.toBeNull();
    const cleanup = enqueueQwen3VoiceSampleLifecycleRelease(completed!, "complete");

    expect(cleanup.enabled).toBe(false);
    expect(cleanup.releaseQueued).toBe(false);
    expect(listRecentLifecycleCommands()).toHaveLength(0);
  });

  it("does not queue release commands for non-Qwen3 voice jobs", () => {
    process.env.OTG_WORKER_LIFECYCLE_ENABLED = "1";
    process.env.OTG_WORKER_LIFECYCLE_QWEN3 = "1";
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      provider: "cosy",
      characterId: "char-a",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const completed = completeRemoteWorkerJob("owner-a", created.job.jobId, { ok: true });
    expect(completed).not.toBeNull();
    const cleanup = enqueueQwen3VoiceSampleLifecycleRelease(completed!, "complete");

    expect(cleanup.enabled).toBe(false);
    expect(listRecentLifecycleCommands()).toHaveLength(0);
  });

  it("does not release a standalone worker after Qwen3 voice sample completion", () => {
    process.env.OTG_WORKER_LIFECYCLE_ENABLED = "1";
    process.env.OTG_WORKER_LIFECYCLE_QWEN3 = "1";
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      provider: "qwen3",
      characterId: "char-a",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const completed = completeRemoteWorkerJob("owner-a", created.job.jobId, { ok: true });
    expect(completed).not.toBeNull();
    const cleanup = enqueueQwen3VoiceSampleLifecycleRelease(completed!, "complete");
    expect(cleanup.enabled).toBe(true);
    expect(cleanup.releaseQueued).toBe(false);
    expect(cleanup.deferred).toBe(false);
    expect(cleanup.requiredWorkers).toEqual([]);
    expect(cleanup.commands).toEqual([]);
    expect(listRecentLifecycleCommands()).toHaveLength(0);
  });

  it("does not release a standalone worker after Qwen3 voice sample failure", () => {
    process.env.OTG_WORKER_LIFECYCLE_ENABLED = "1";
    process.env.OTG_WORKER_LIFECYCLE_QWEN3 = "1";
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      provider: "qwen3",
      characterId: "char-a",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const failed = failRemoteWorkerJob("owner-a", created.job.jobId, "sample failed");
    expect(failed).not.toBeNull();
    const cleanup = enqueueQwen3VoiceSampleLifecycleRelease(failed!, "failed");
    expect(cleanup.enabled).toBe(true);
    expect(cleanup.releaseQueued).toBe(false);
    expect(cleanup.deferred).toBe(false);
    expect(cleanup.requiredWorkers).toEqual([]);
    expect(cleanup.commands).toEqual([]);
    expect(listRecentLifecycleCommands()).toHaveLength(0);
  });

  it("needs no cross-job release coordination for the embedded runtime", () => {
    process.env.OTG_WORKER_LIFECYCLE_ENABLED = "1";
    process.env.OTG_WORKER_LIFECYCLE_QWEN3 = "1";
    const first = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      provider: "qwen3",
      characterId: "char-a",
    });
    const second = createCharacterVoicePipelineJob("owner-b", {
      action: "create_voice_sample",
      provider: "qwen3",
      characterId: "char-b",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok) throw new Error(first.error);

    const completed = completeRemoteWorkerJob("owner-a", first.job.jobId, { ok: true });
    expect(completed).not.toBeNull();
    const cleanup = enqueueQwen3VoiceSampleLifecycleRelease(completed!, "complete");

    expect(cleanup.enabled).toBe(true);
    expect(cleanup.deferred).toBe(false);
    expect(cleanup.releaseQueued).toBe(false);
    expect(cleanup.requiredWorkers).toEqual([]);
    expect(listRecentLifecycleCommands()).toHaveLength(0);
  });

  it("does not expose shell command text or token data in lifecycle cleanup metadata", () => {
    process.env.OTG_WORKER_LIFECYCLE_ENABLED = "1";
    process.env.OTG_WORKER_LIFECYCLE_QWEN3 = "1";
    process.env.OTG_WORKER_TOKEN = "unit-test-token";
    const created = createCharacterVoicePipelineJob("owner-a", {
      action: "create_voice_sample",
      provider: "qwen3",
      characterId: "char-a",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const completed = completeRemoteWorkerJob("owner-a", created.job.jobId, { ok: true });
    expect(completed).not.toBeNull();
    const cleanup = enqueueQwen3VoiceSampleLifecycleRelease(completed!, "complete");
    const serialized = JSON.stringify(cleanup).toLowerCase();

    expect(serialized).not.toContain("powershell");
    expect(serialized).not.toContain("cmd.exe");
    expect(serialized).not.toContain("worker-manager");
    expect(serialized).not.toContain("unit-test-token");
    expect(serialized).not.toContain("bearer ");
    expect(serialized).not.toContain("--worker-token");
  });
});
