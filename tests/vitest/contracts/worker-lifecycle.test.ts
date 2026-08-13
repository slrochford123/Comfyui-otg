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
  claimWorkerLifecycleCommand,
  clearWorkerLifecycleCommandsForTests,
  completeWorkerLifecycleCommand,
  enqueueWorkerLifecycleCommand,
  setWorkerLifecycleStorePathForTests,
} from "@/lib/workers/workerLifecycleStore";

describe("worker lifecycle foundation", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-worker-lifecycle-"));
  const workerControlToken = "test-worker-control-token";

  function workerControlRequest(pathname: string, init: RequestInit = {}) {
    return new NextRequest(`http://127.0.0.1${pathname}`, init);
  }

  function authHeaders(extra: Record<string, string> = {}) {
    return {
      authorization: `Bearer ${workerControlToken}`,
      ...extra,
    };
  }

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setResourceLockStorePathForTests(path.join(tempRoot, `locks-${suffix}.json`));
    setWorkerLifecycleStorePathForTests(path.join(tempRoot, `commands-${suffix}.json`));
    clearResourceLocksForTests();
    clearWorkerLifecycleCommandsForTests();
    delete process.env.OTG_WORKER_CONTROL_ENABLED;
    delete process.env.OTG_WORKER_CONTROL_DEV_ENQUEUE;
    delete process.env.OTG_WORKER_TOKEN;
    process.env.OTG_WORKER_CONTROL_TOKEN = workerControlToken;
  });

  it("validates known worker IDs and allowed lifecycle actions", () => {
    expect(getWorkerCatalogEntry("voice-ltx")?.resources).toContain("gpu:linux-3090");
    expect(getWorkerCatalogEntry("qwen3-tts")?.allowedActions).toEqual(["status"]);
    expect(getWorkerCatalogEntry("qwen3-tts")?.enabled).toBe(false);
    expect(getWorkerCatalogEntry("xtts")?.dryRunOnly).toBe(false);
    expect(getWorkerCatalogEntry("whisper")?.dryRunOnly).toBe(false);
    expect(getWorkerCatalogEntry("speaker-diarization")?.dryRunOnly).toBe(false);
    expect(getWorkerCatalogEntry("speaker-diarization")?.resources).toContain("service:speaker-diarization");
    expect(getWorkerCatalogEntry("character-preview")?.dryRunOnly).toBe(false);
    expect(getWorkerCatalogEntry("ace-step")?.dryRunOnly).toBe(false);
    expect(getWorkerCatalogEntry("ace-step")?.resources).toContain("gpu:windows-3090");
    expect(getWorkerCatalogEntry("ace-step")?.resources).toContain("service:ace-step");
    expect(getWorkerCatalogEntry("comfy-3090-sage-video")?.dryRunOnly).toBe(false);
    expect(getWorkerCatalogEntry("comfy-3090-sage-video")?.resources).toContain("gpu:windows-3090");
    expect(getWorkerCatalogEntry("comfy-3090-sage-video")?.resources).toContain("comfy:windows-3090");
    expect(getWorkerCatalogEntry("comfy-3090-sage-video")?.resources).toContain("service:ltx-video");
    expect(getWorkerCatalogEntry("bg-remove")?.platform).toBe("windows");
    expect(getWorkerCatalogEntry("bg-remove")?.dryRunOnly).toBe(false);
    expect(getWorkerCatalogEntry("cozyvoice")?.enabled).toBe(true);
    expect(getWorkerCatalogEntry("cozyvoice")?.platform).toBe("linux");
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

    const disabledStandaloneRuntime = enqueueWorkerLifecycleCommand({
      workerId: "qwen3-tts",
      action: "ensure-running",
      requestedBy: "test",
      dryRun: true,
    });
    expect(disabledStandaloneRuntime.ok).toBe(false);
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
        agentId: "linux-main-agent",
        platform: "linux",
        capabilities: ["voice-ltx", "comfy-3090-sage-video"],
      }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.command.workerId).toBe("voice-ltx");
    expect(body.command.requiredResources).toContain("gpu:linux-3090");
    expect(JSON.stringify(body.command).toLowerCase()).not.toContain("powershell");
    expect(JSON.stringify(body.command).toLowerCase()).not.toContain("cmd.exe");
    expect(body.command.commandLine).toBeUndefined();
    expect(body.command.shell).toBeUndefined();
  });

  it("enqueue route returns 404 when worker-control is disabled", async () => {
    process.env.OTG_WORKER_CONTROL_DEV_ENQUEUE = "1";
    const { POST } = await import("@/app/api/worker-control/enqueue/route");
    const response = await POST(workerControlRequest("/api/worker-control/enqueue", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({
        workerId: "voice-ltx",
        action: "ensure-running",
      }),
    }));

    expect(response.status).toBe(404);
  });

  it("enables authenticated lifecycle control only for the Character-Rework development TEST runtime", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousWorkRepo = process.env.OTG_WORK_REPO;
    process.env.NODE_ENV = "development";
    process.env.OTG_WORK_REPO = "/home/shawn-rochford/AI/work/OTG-Character-Rework";
    try {
      const { POST } = await import("@/app/api/worker-control/enqueue/route");
      const response = await POST(workerControlRequest("/api/worker-control/enqueue", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ workerId: "ltx-audio-5060", action: "status", dryRun: true }),
      }));
      expect(response.status).toBe(200);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousWorkRepo === undefined) delete process.env.OTG_WORK_REPO;
      else process.env.OTG_WORK_REPO = previousWorkRepo;
    }
  });

  it("enqueue route rejects missing or invalid auth when worker-control is enabled", async () => {
    process.env.OTG_WORKER_CONTROL_ENABLED = "1";
    const { POST } = await import("@/app/api/worker-control/enqueue/route");
    const payload = {
      workerId: "voice-ltx",
      action: "ensure-running",
    };

    const missing = await POST(workerControlRequest("/api/worker-control/enqueue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
    expect(missing.status).toBe(401);

    const invalid = await POST(workerControlRequest("/api/worker-control/enqueue", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong-token",
      },
      body: JSON.stringify(payload),
    }));
    expect(invalid.status).toBe(401);
  });

  it("enqueue route accepts valid auth in production mode without dev enqueue flag", async () => {
    process.env.OTG_WORKER_CONTROL_ENABLED = "1";
    delete process.env.OTG_WORKER_CONTROL_DEV_ENQUEUE;
    const { POST } = await import("@/app/api/worker-control/enqueue/route");

    const response = await POST(workerControlRequest("/api/worker-control/enqueue", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({
        workerId: "ace-step",
        action: "ensure-running",
        requestedBy: "unit-test",
        dryRun: false,
        reason: "authenticated production enqueue test",
      }),
    }));
    const body = await response.json();
    const serialized = JSON.stringify(body).toLowerCase();

    expect(response.status).toBe(200);
    expect(body.command.workerId).toBe("ace-step");
    expect(body.command.action).toBe("ensure-running");
    expect(body.command.dryRun).toBe(false);
    expect(serialized).not.toContain(workerControlToken);
  });

  it("status route rejects disabled, missing auth, and invalid auth requests", async () => {
    const { GET } = await import("@/app/api/worker-control/status/route");

    const disabled = await GET(workerControlRequest("/api/worker-control/status", {
      headers: authHeaders(),
    }));
    expect(disabled.status).toBe(404);

    process.env.OTG_WORKER_CONTROL_ENABLED = "1";
    const missing = await GET(workerControlRequest("/api/worker-control/status"));
    expect(missing.status).toBe(401);

    const invalid = await GET(workerControlRequest("/api/worker-control/status", {
      headers: { authorization: "Bearer wrong-token" },
    }));
    expect(invalid.status).toBe(401);
  });

  it("Windows agent real actions remain opt-in and limited to the verified allowlist", () => {
    const agentPy = fs.readFileSync(path.join(process.cwd(), "scripts/windows/otg-worker-agent.py"), "utf8");
    const agentPs1 = fs.readFileSync(path.join(process.cwd(), "scripts/windows/otg-worker-agent.ps1"), "utf8");
    const realActionLine = agentPy.split(/\r?\n/).find((line) => line.startsWith("REAL_ACTION_WORKERS = ")) || "";

    expect(agentPy).toContain("--allow-real-actions");
    expect(agentPs1).toContain("$AllowRealActions");
    expect(realActionLine).toBe('REAL_ACTION_WORKERS = {"voice-ltx", "qwen3-tts", "voice-design", "voice-dataset", "applio", "xtts", "whisper", "speaker-diarization", "bg-remove", "character-preview", "ace-step", "comfy-3090-sage-video"}');
    expect(agentPy).toContain("Real lifecycle actions are only supported for");
    expect(agentPy).toContain("OTG_WORKER_MANAGER_PATH");
    expect(agentPy).not.toContain('"--worker-token"');
    expect(agentPy).not.toContain("'--worker-token'");
    expect(agentPs1).not.toContain("--worker-token");
    expect(realActionLine).not.toContain("cozyvoice");
    expect(realActionLine).toContain("bg-remove");
    expect(realActionLine).toContain("character-preview");
    expect(realActionLine).toContain("comfy-3090-sage-video");
  });

  it("status route sanitizes lifecycle result details before returning them", async () => {
    process.env.OTG_WORKER_CONTROL_ENABLED = "1";
    process.env.OTG_WORKER_TOKEN = "unit-test-worker-token";
    const queued = enqueueWorkerLifecycleCommand({
      workerId: "voice-design",
      action: "status",
      requestedBy: "test",
      dryRun: false,
      reason: "unit test",
    });
    expect(queued.ok).toBe(true);
    const claimed = claimWorkerLifecycleCommand({
      agentId: "linux-main-agent",
      platform: "linux",
      capabilities: ["voice-design"],
    });
    expect(claimed?.id).toBe(queued.ok ? queued.command.id : "");

    const completed = completeWorkerLifecycleCommand(claimed!.id, "linux-main-agent", {
      workerId: "voice-design",
      action: "status",
      dryRun: false,
      realAction: true,
      managerPath: "C:\\AI\\OTG-WorkerManager\\worker-manager.ps1",
      commandLine: "powershell.exe -File C:\\AI\\OTG-WorkerManager\\worker-manager.ps1 --worker-token unit-test-worker-token",
      finalState: "stopped",
      pid: 1234,
      health: {
        ok: false,
        summary: "process not running from C:\\AI\\OTG-WorkerManager\\worker-manager.ps1",
      },
      message: "Bearer unit-test-worker-token",
    });
    expect(completed?.status).toBe("complete");

    const { GET } = await import("@/app/api/worker-control/status/route");
    const response = await GET(workerControlRequest("/api/worker-control/status", {
      headers: authHeaders(),
    }));
    const body = await response.json();
    const serialized = JSON.stringify(body).toLowerCase();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.dryRunOnly).toBe(false);
    expect(body.executionMode).toBe("mixed");
    expect(body.realActionsAvailable).toBe(true);
    expect(body.catalog.find((entry: { id: string }) => entry.id === "cozyvoice")).toMatchObject({
      enabled: true,
      dryRunOnly: false,
    });
    expect(body.catalog.find((entry: { id: string }) => entry.id === "ace-step")).toMatchObject({
      enabled: true,
      dryRunOnly: false,
    });
    expect(body.catalog.find((entry: { id: string }) => entry.id === "comfy-3090-sage-video")).toMatchObject({
      enabled: true,
      dryRunOnly: false,
    });
    expect(serialized).not.toContain("managerpath");
    expect(serialized).not.toContain("c:\\ai\\");
    expect(serialized).not.toContain("worker-manager.ps1");
    expect(serialized).not.toContain("cmd.exe");
    expect(serialized).not.toContain("powershell.exe");
    expect(serialized).not.toContain("--worker-token");
    expect(serialized).not.toContain("otg_worker_token");
    expect(serialized).not.toContain("unit-test-worker-token");
    expect(serialized).not.toMatch(/bearer\s+[a-z0-9._~+/-]+=*/);
  });
});

