/** Read-only physical checks for the separately authorized local qualification CLI. */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertH3StudioTest } from "@/lib/h3StudioRegistry";
import type { H3StudioQualificationLiveCheck } from "@/lib/h3StudioQualification";
const exec = promisify(execFile);
export async function inspectStudioQualificationRuntime(requiredVramBytes: number, insidePhysicalMutex = false): Promise<H3StudioQualificationLiveCheck & { telemetry: { usedVramBytes: number; usedRamBytes: number; usedSwapBytes: number }; processes: Array<{ pid: number; comfy: boolean }> }> {
  assertH3StudioTest();
  const { stdout } = await exec("/usr/bin/nvidia-smi", ["--query-gpu=uuid,name,memory.total,memory.free", "--format=csv,noheader,nounits"], { timeout: 10_000 });
  const cards = stdout.trim().split("\n").map(line => line.split(",").map(s => s.trim()));
  const card = cards.find(c => /RTX\s*3090/i.test(c[1] || ""));
  if (!card || cards.length !== 1) throw new Error("Qualification requires the local TEST RTX 3090 host identity.");
  const [gpuUuid, gpuName] = card, total = Number(card[2]) * 1024 ** 2, freeVramBytes = Number(card[3]) * 1024 ** 2;
  const queues = await Promise.all([8189, 8188].map(async port => {
    const r = await fetch(`http://100.75.162.64:${port}/queue`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error("Both shared 3090 queues must be readable before qualification.");
    const q = await r.json(); if (!Array.isArray(q.queue_running) || !Array.isArray(q.queue_pending)) throw new Error("Unreadable shared 3090 queue.");
    return { running: q.queue_running.length, pending: q.queue_pending.length };
  }));
  const processesRaw = await exec("/usr/bin/nvidia-smi", ["--query-compute-apps=pid,process_name", "--format=csv,noheader,nounits"], { timeout: 10_000 });
  const processes: Array<{ pid: number; comfy: boolean }> = [];
  for (const line of processesRaw.stdout.trim().split("\n").filter(Boolean)) {
    const pid = Number(line.split(",")[0]);
    if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error("Unreadable GPU process identity.");
    const command = await fs.readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
    const args = command.split("\0"); const main = args.find(arg => path.basename(arg) === "main.py");
    const cwd = await fs.readlink(`/proc/${pid}/cwd`).catch(() => "");
    const entry = main && cwd ? await fs.realpath(path.resolve(cwd, main)).catch(() => "") : "";
    const portIndex = args.indexOf("--port"); const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 8188;
    const comfy = entry.startsWith("/home/shawn-rochford/AI/ComfyUI/") && [8188, 8189].includes(port);
    processes.push({ pid, comfy });
    if (!comfy) throw new Error("An unrelated compute process is present; qualification is blocked without interrupting it.");
  }
  const memory = await fs.readFile("/proc/meminfo", "utf8");
  const field = (key: string) => Number(memory.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] || 0) * 1024;
  return { queueRunning: queues.reduce((n, q) => n + q.running, 0), queuePending: queues.reduce((n, q) => n + q.pending, 0),
    gpuUuid, gpuName, freeVramBytes, requiredVramBytes, checkedAt: new Date().toISOString(),
    physicalMutexHeld: insidePhysicalMutex as true, peerReleaseDisabled: true,
    telemetry: { usedVramBytes: total - freeVramBytes, usedRamBytes: field("MemTotal") - field("MemAvailable"), usedSwapBytes: field("SwapTotal") - field("SwapFree") }, processes };
}
