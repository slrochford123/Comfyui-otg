import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getWorkerCatalogEntry,
  isWorkerActionAllowed,
  validateWorkerLifecycleRequest,
} from "@/lib/workers/workerCatalog";
import {
  acquireResourceLock,
  clearResourceLocksForTests,
  cleanupExpiredResourceLocks,
  listResourceLocks,
  setResourceLockStorePathForTests,
} from "@/lib/workers/resourceLocks";
import {
  clearWorkerLifecycleCommandsForTests,
  enqueueWorkerLifecycleCommand,
  setWorkerLifecycleStorePathForTests,
} from "@/lib/workers/workerLifecycleStore";

describe("worker lifecycle foundation", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-worker-lifecycle-"));

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setResourceLockStorePathForTests(path.join(tempRoot, `locks-${suffix}.json`));
    setWorkerLifecycleStorePathForTests(path.join(tempRoot, `commands-${suffix}.json`));
    clearResourceLocksForTests();
    clearWorkerLifecycleCommandsForTests();
    process.env.OTG_WORKER_CONTROL_TOKEN = "test-worker-control-token";
  });

  it("validates known worker IDs and allowed lifecycle actions", () => {
    expect(getWorkerCatalogEntry("voice-ltx")?.resources).toContain("gpu:windows-3090");
    expect(validateWorkerLifecycleRequest("missing-worker", "start").ok).toBe(false);
    expect(validateWorkerLifecycleRequest("voice-ltx", "launch-shell").ok).toBe(false);
    expect(isWorkerActionAllowed("voice-ltx", "ensure-running")).toBe(true);
    expect(isWorkerActionAllowed("voice-ltx", "release")).toBe(true);
  });

  it("rejects double active locks for gpu:windows-3090", () => {
    const first = acquireResourceLock({
      lockId: "gpu:windows-3090",
      ownerId: "job-a",
      ownerType: "job",
      workerId: "voice-ltx",
    });
    expect(first.ok).toBe(true);

    const second = acquireResourceLock({
      lockId: "gpu:windows-3090",
      ownerId: "job-b",
      ownerType: "job",
      workerId: "comfy-3090-sage-video",
    });
    expect(second.ok).toBe(false);
    expect(listResourceLocks()).toHaveLength(1);
  });

  it("cleans up expired locks", () => {
    const acquired = acquireResourceLock({
      lockId: "gpu:windows-3090",
      ownerId: "job-a",
      ownerType: "job",
      workerId: "voice-ltx",
      ttlSeconds: 1,
    });
    expect(acquired.ok).toBe(true);
    cleanupExpiredResourceLocks(new Date(Date.now() + 5000));
    expect(listResourceLocks()).toHaveLength(0);
  });

  it("rejects invalid lifecycle queue requests", () => {
    const badWorker = enqueueWorkerLifecycleCommand({
      workerId: "unknown",
      action: "start",
      requestedBy: "test",
    });
    expect(badWorker.ok).toBe(false);

    const ok = enqueueWorkerLifecycleCommand({
      workerId: "qwen3-tts",
      action: "ensure-running",
      requestedBy: "test",
      dryRun: true,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.command.dryRun).toBe(true);
  });

  it("claim route returns only lifecycle metadata and no shell command", async () => {
    const queued = enqueueWorkerLifecycleCommand({
      workerId: "voice-ltx",
      action: "ensure-running",
      requestedBy: "test",
      dryRun: true,
      reason: "unit test",
    });
    expect(queued.ok).toBe(true);

    const { POST } = await import("@/app/api/worker-control/agent/claim/route");
    const response = await POST(new NextRequest("http://127.0.0.1/api/worker-control/agent/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-worker-control-token",
      },
      body: JSON.stringify({
        agentId: "windows-main-agent",
        platform: "windows",
        capabilities: ["voice-ltx", "comfy-3090-sage-video"],
      }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.command.workerId).toBe("voice-ltx");
    expect(body.command.requiredResources).toContain("gpu:windows-3090");
    expect(JSON.stringify(body.command).toLowerCase()).not.toContain("powershell");
    expect(JSON.stringify(body.command).toLowerCase()).not.toContain("cmd.exe");
    expect(body.command.commandLine).toBeUndefined();
    expect(body.command.shell).toBeUndefined();
  });
});
