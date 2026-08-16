import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireClusterGpuLease,
  detectShawnExternalOccupancy,
  getClusterLaneStates,
  releaseClusterGpuLease,
  resolveComfyPhysicalGpu,
  SHAWN_GPU_LOCK_ID,
  SLR_GPU_LOCK_ID,
} from "@/lib/workers/clusterGpu";
import {
  acquireQwenClusterRoute,
  QWEN_CLUSTER_MODEL,
  qwenClusterFetch,
  SHAWN_QWEN_CONTEXT_CAP,
  SLR_QWEN_CONTEXT_CAP,
} from "@/lib/workers/qwenClusterRouter";
import {
  clearResourceLocksForTests,
  setResourceLockStorePathForTests,
} from "@/lib/workers/resourceLocks";
import { submitComfyPromptWith5060Lease } from "@/lib/workers/comfyPromptLease";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "otg-two-node-gpu-"));

function acquire(lockId: typeof SLR_GPU_LOCK_ID | typeof SHAWN_GPU_LOCK_ID, ownerId: string, purpose: "image" | "video" | "qwen36" | "ltx-fallback") {
  return acquireClusterGpuLease({ lockId, ownerId, workerId: `${purpose}-worker`, purpose });
}

const freeShawn = async () => ({ available: true, external: false, recoverable: false, reason: "available" as const });
const busyShawn = async () => ({ available: false, external: true, recoverable: false, reason: "qwen-code" as const });

describe("two-node cluster GPU arbitration", () => {
  beforeEach(() => {
    setResourceLockStorePathForTests(path.join(tempRoot, `locks-${Date.now()}-${Math.random()}.sqlite`));
    clearResourceLocksForTests();
    vi.restoreAllMocks();
  });

  it("routes <=32K Qwen to a free 5060", async () => {
    const route = await acquireQwenClusterRoute(32_768, 0, { shawnOccupancy: freeShawn });
    expect(route.node).toBe("slr");
    expect(route.contextCap).toBe(SLR_QWEN_CONTEXT_CAP);
    releaseClusterGpuLease(route.lease);
  });

  it("routes <=32K Qwen to the 3090 when the 5060 is busy", async () => {
    const image = acquire(SLR_GPU_LOCK_ID, "image", "image");
    expect(image.ok).toBe(true);
    const route = await acquireQwenClusterRoute(8_192, 0, { shawnOccupancy: freeShawn });
    expect(route.node).toBe("shawn");
    releaseClusterGpuLease(route.lease);
    if (image.ok) releaseClusterGpuLease(image.lease);
  });

  it(">32K Qwen never chooses the 5060 and fails clearly when 3090 is unavailable", async () => {
    const slr = acquire(SLR_GPU_LOCK_ID, "image", "image");
    await expect(acquireQwenClusterRoute(32_769, 0, { shawnOccupancy: busyShawn })).rejects.toMatchObject({
      code: "qwen_cluster_busy",
      status: 503,
    });
    if (slr.ok) releaseClusterGpuLease(slr.lease);
  });

  it("routes >32K only to the 3090 and enforces both context caps", async () => {
    const route = await acquireQwenClusterRoute(65_536, 0, { shawnOccupancy: freeShawn });
    expect(route.node).toBe("shawn");
    expect(route.contextCap).toBe(SHAWN_QWEN_CONTEXT_CAP);
    expect(SLR_QWEN_CONTEXT_CAP).toBe(32_768);
    releaseClusterGpuLease(route.lease);
  });

  it("detects live Qwen Code and distinguishes recoverable stale residency", async () => {
    const qwenCode = await detectShawnExternalOccupancy({
      locks: [],
      processList: async () => "node /opt/qwen-code/cli.js --model qwen3.6:27b",
      fetcher: vi.fn(),
    });
    expect(qwenCode).toMatchObject({ available: false, external: true, recoverable: false, reason: "qwen-code" });

    const resident = await detectShawnExternalOccupancy({
      locks: [],
      processList: async () => "ollama serve",
      fetcher: async () => new Response(JSON.stringify({ models: [{ name: QWEN_CLUSTER_MODEL }] }), { status: 200 }),
    });
    expect(resident).toMatchObject({ available: false, external: true, recoverable: true, reason: "qwen-resident-stale" });
  });

  it("detects local Qwen Code when the application host is Shawn", async () => {
    const execProcessFile = vi.fn(async () => ({
      stdout: "node /opt/qwen-code/cli.js --model qwen3.6:27b",
      stderr: "",
    }));
    const occupancy = await detectShawnExternalOccupancy({
      locks: [],
      hostname: "shawn",
      execProcessFile: execProcessFile as never,
      fetcher: vi.fn(),
    });
    expect(occupancy).toMatchObject({ available: false, external: true, reason: "qwen-code" });
    expect(execProcessFile).toHaveBeenCalledWith("ps", ["-eo", "comm=,args="], expect.any(Object));
  });

  it("detects remote Shawn Qwen Code from slr even with zero resident models", async () => {
    const execProcessFile = vi.fn(async () => ({
      stdout: "node C:/Users/shawn/AppData/Roaming/npm/node_modules/@qwen-code/qwen-code/bin/qwen.js --model qwen3.6:27b",
      stderr: "",
    }));
    const fetcher = vi.fn();
    const occupancy = await detectShawnExternalOccupancy({
      locks: [],
      hostname: "slr",
      environment: {
        OTG_SHAWN_PROCESS_PROBE_TARGET: "otg-shawn-process-probe",
        OTG_SHAWN_PROCESS_PROBE_IDENTITY_FILE: "/etc/otg/ssh/shawn-process-probe",
        OTG_SHAWN_PROCESS_PROBE_SSH_CONFIG: "/etc/otg/ssh/config",
      },
      execProcessFile: execProcessFile as never,
      fetcher,
    });
    expect(occupancy).toMatchObject({ available: false, external: true, reason: "qwen-code" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(execProcessFile).toHaveBeenCalledWith("ssh", [
      "-F", "/etc/otg/ssh/config",
      "-i", "/etc/otg/ssh/shawn-process-probe",
      "-o", "BatchMode=yes",
      "-o", "IdentitiesOnly=yes",
      "-o", "ClearAllForwardings=yes",
      "-o", "ConnectTimeout=3",
      "--", "otg-shawn-process-probe",
      "ps", "-eo", "comm=,args=",
    ], expect.any(Object));
  });

  it("fails closed when the remote Shawn process probe fails", async () => {
    const occupancy = await detectShawnExternalOccupancy({
      locks: [],
      hostname: "slr",
      environment: {
        OTG_SHAWN_PROCESS_PROBE_TARGET: "otg-shawn-process-probe",
        OTG_SHAWN_PROCESS_PROBE_IDENTITY_FILE: "/etc/otg/ssh/shawn-process-probe",
        OTG_SHAWN_PROCESS_PROBE_SSH_CONFIG: "/etc/otg/ssh/config",
      },
      execProcessFile: vi.fn(async () => { throw new Error("remote unavailable"); }) as never,
      fetcher: vi.fn(),
    });
    expect(occupancy).toEqual({ available: false, external: true, recoverable: false, reason: "probe-error" });
  });

  it("reports Shawn available only after empty process, model, and Comfy probes", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), { status: 200 }));
    const occupancy = await detectShawnExternalOccupancy({
      locks: [],
      hostname: "slr",
      environment: {
        OTG_SHAWN_PROCESS_PROBE_TARGET: "otg-shawn-process-probe",
        OTG_SHAWN_PROCESS_PROBE_IDENTITY_FILE: "/etc/otg/ssh/shawn-process-probe",
        OTG_SHAWN_PROCESS_PROBE_SSH_CONFIG: "/etc/otg/ssh/config",
      },
      execProcessFile: vi.fn(async () => ({ stdout: "ollama serve", stderr: "" })) as never,
      fetcher,
    });
    expect(occupancy).toEqual({ available: true, external: false, recoverable: false, reason: "available" });
  });

  it("does not probe or clear residency while an app Qwen or video lock exists", async () => {
    for (const purpose of ["qwen36", "video"] as const) {
      const held = acquire(SHAWN_GPU_LOCK_ID, purpose, purpose);
      const fetcher = vi.fn();
      const occupancy = await detectShawnExternalOccupancy({
        processList: async () => "ollama serve",
        fetcher,
      });
      expect(occupancy).toMatchObject({ available: false, recoverable: false, reason: "worker-lock" });
      expect(fetcher).not.toHaveBeenCalled();
      if (held.ok) releaseClusterGpuLease(held.lease);
    }
  });

  it("maps all TEST Comfy aliases to their physical GPU and fails closed for unknown hosts", () => {
    expect(resolveComfyPhysicalGpu("http://100.98.212.116:8188")).toBe("slr-5060");
    expect(resolveComfyPhysicalGpu("http://192.168.1.113:8188")).toBe("slr-5060");
    expect(resolveComfyPhysicalGpu("http://100.98.212.116:8191")).toBe("slr-5060");
    expect(resolveComfyPhysicalGpu("http://100.75.162.64:8188")).toBe("shawn-3090");
    expect(resolveComfyPhysicalGpu("http://192.168.1.166:8188")).toBe("shawn-3090");
    expect(resolveComfyPhysicalGpu("http://127.0.0.1:8288", "shawn")).toBe("shawn-3090");
    expect(resolveComfyPhysicalGpu("http://127.0.0.1:8188", "slr")).toBe("slr-5060");
    expect(resolveComfyPhysicalGpu("http://unmapped.invalid:8188", "shawn")).toBeNull();
  });

  it("contains no process-kill path for interactive Qwen ownership", () => {
    const source = fs.readFileSync("lib/workers/clusterGpu.ts", "utf8");
    expect(source).not.toMatch(/process\.kill|SIGKILL|pkill|killall|systemctl\s+(?:stop|restart)/i);
    expect(source).not.toMatch(/\/api\/(?:generate|chat)/i);
  });

  it("mutually excludes Qwen/image on slr and Qwen/video on shawn", () => {
    const image = acquire(SLR_GPU_LOCK_ID, "image", "image");
    expect(image.ok).toBe(true);
    expect(acquire(SLR_GPU_LOCK_ID, "qwen", "qwen36").ok).toBe(false);
    if (image.ok) releaseClusterGpuLease(image.lease);
    const qwenSlr = acquire(SLR_GPU_LOCK_ID, "qwen", "qwen36");
    expect(qwenSlr.ok).toBe(true);
    expect(acquire(SLR_GPU_LOCK_ID, "image-2", "image").ok).toBe(false);
    if (qwenSlr.ok) releaseClusterGpuLease(qwenSlr.lease);

    const video = acquire(SHAWN_GPU_LOCK_ID, "video", "video");
    expect(video.ok).toBe(true);
    expect(acquire(SHAWN_GPU_LOCK_ID, "qwen-3090", "qwen36").ok).toBe(false);
    if (video.ok) releaseClusterGpuLease(video.lease);
    const qwen3090 = acquire(SHAWN_GPU_LOCK_ID, "qwen-3090", "qwen36");
    expect(qwen3090.ok).toBe(true);
    expect(acquire(SHAWN_GPU_LOCK_ID, "video-2", "video").ok).toBe(false);
    if (qwen3090.ok) releaseClusterGpuLease(qwen3090.lease);
  });

  it("allows slr image and shawn video concurrently", () => {
    const image = acquire(SLR_GPU_LOCK_ID, "image", "image");
    const video = acquire(SHAWN_GPU_LOCK_ID, "video", "video");
    expect(image.ok).toBe(true);
    expect(video.ok).toBe(true);
    if (image.ok) releaseClusterGpuLease(image.lease);
    if (video.ok) releaseClusterGpuLease(video.lease);
  });

  it("reports public lane states without process details", async () => {
    const qwen = acquire(SLR_GPU_LOCK_ID, "qwen-status", "qwen36");
    const video = acquire(SHAWN_GPU_LOCK_ID, "video-status", "video");
    const states = await getClusterLaneStates();
    expect(states).toEqual({ slrImage: "busy-qwen", shawnVideo: "busy-video" });
    expect(JSON.stringify(states)).not.toMatch(/pid|command|process|model_path/i);
    if (qwen.ok) releaseClusterGpuLease(qwen.lease);
    if (video.ok) releaseClusterGpuLease(video.lease);
  });

  it("blocks fallback transport while 5060 Qwen or image owns the GPU", async () => {
    for (const purpose of ["qwen36", "image"] as const) {
      const held = acquire(SLR_GPU_LOCK_ID, purpose, purpose);
      const transport = vi.fn();
      await expect(submitComfyPromptWith5060Lease({
        baseUrl: "http://100.98.212.116:8188",
        workerId: "video-fallback",
        purpose: "ltx-fallback",
        init: { method: "POST", body: "{}" },
        fetcher: transport,
      })).rejects.toMatchObject({ status: 409 });
      expect(transport).not.toHaveBeenCalled();
      if (held.ok) releaseClusterGpuLease(held.lease);
    }
  });

  it("blocks Shawn Comfy transport while app Qwen owns the 3090", async () => {
    const held = acquire(SHAWN_GPU_LOCK_ID, "qwen-shawn", "qwen36");
    const transport = vi.fn();
    await expect(submitComfyPromptWith5060Lease({
      baseUrl: "http://100.75.162.64:8188",
      workerId: "video-primary",
      purpose: "video",
      init: { method: "POST", body: "{}" },
      fetcher: transport,
    })).rejects.toMatchObject({ status: 409 });
    expect(transport).not.toHaveBeenCalled();
    if (held.ok) releaseClusterGpuLease(held.lease);
  });

  it("never submits generation to an unclassified Comfy endpoint", async () => {
    const transport = vi.fn();
    await expect(submitComfyPromptWith5060Lease({
      baseUrl: "http://unmapped.invalid:8188",
      workerId: "unmapped",
      init: { method: "POST", body: "{}" },
      fetcher: transport,
    })).rejects.toMatchObject({ code: "comfy_gpu_unclassified", status: 503 });
    expect(transport).not.toHaveBeenCalled();
  });

  it("sends the exact cluster model with keep_alive=0 to both Qwen endpoints", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ response: "ok" }), { status: 200 });
    }));
    await qwenClusterFetch("/api/generate", { model: "wrong", prompt: "hello" }, { waitMs: 0 });
    expect(requests[0].url).toBe("http://100.98.212.116:11435/api/generate");
    expect(requests[0].body).toMatchObject({ model: QWEN_CLUSTER_MODEL, keep_alive: 0 });

    const image = acquire(SLR_GPU_LOCK_ID, "image-for-shawn-route", "image");
    await qwenClusterFetch("/api/generate", { model: "also-wrong", prompt: "hello" }, {
      waitMs: 0,
      routerDependencies: { shawnOccupancy: freeShawn },
    });
    expect(requests[1].url).toBe("http://100.75.162.64:11435/api/generate");
    expect(requests[1].body).toMatchObject({ model: QWEN_CLUSTER_MODEL, keep_alive: 0 });
    if (image.ok) releaseClusterGpuLease(image.lease);
  });
});
