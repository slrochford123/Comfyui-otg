/** Read-only physical checks for the separately authorized local qualification CLI. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GPU_UUIDS } from "@/lib/mediaGpuRouting";
import { OTG_DATA_ROOT } from "@/lib/paths";
import { H3_BACKEND_PROFILES } from "@/lib/production/h3Workflows";
import { assertH3StudioTest } from "@/lib/h3StudioRegistry";
import type { H3StudioQualificationLiveCheck } from "@/lib/h3StudioQualification";
import { requireStorageHeadroom } from "@/lib/storageAdmission";

const exec = promisify(execFile);
const H3_WORKER = new URL(H3_BACKEND_PROFILES.rtx3090.baseUrl);
const GPU_PORTS = [{ port: 8189, unit: "otg-comfyui-h3.service" }, { port: 8188, unit: "otg-comfyui.service" }] as const;
const RTX_3090_NAME = /\bRTX\s*3090\b(?!\s*Ti)/i;

function csvRows(raw: string) {
  return raw.trim().split("\n").filter(Boolean).map(line => line.split(",").map(field => field.trim()));
}

async function readGpu(gpuUuid: string) {
  const { stdout } = await exec("/usr/bin/nvidia-smi", [`--id=${gpuUuid}`, "--query-gpu=uuid,name,memory.total,memory.free", "--format=csv,noheader,nounits"], { timeout: 5000 });
  const rows = csvRows(stdout);
  const [actualUuid, gpuName, totalMib, freeMib] = rows[0] ?? [];
  const total = Number(totalMib) * 1024 ** 2, freeVramBytes = Number(freeMib) * 1024 ** 2;
  if (rows.length !== 1 || rows[0].length !== 4 || actualUuid !== gpuUuid || !RTX_3090_NAME.test(gpuName || "") ||
      !Number.isSafeInteger(total) || !Number.isSafeInteger(freeVramBytes) || total <= 0 || freeVramBytes < 0 || freeVramBytes > total) {
    throw new Error("Qualification requires the configured local TEST RTX 3090 and readable capacity.");
  }
  return { gpuName, total, freeVramBytes };
}

async function readComputePids(gpuUuid: string) {
  const { stdout } = await exec("/usr/bin/nvidia-smi", [`--id=${gpuUuid}`, "--query-compute-apps=gpu_uuid,pid", "--format=csv,noheader,nounits"], { timeout: 5000 });
  return new Set(csvRows(stdout).map(([uuid, value, extra]) => {
    const pid = Number(value);
    if (uuid !== gpuUuid || extra !== undefined || !Number.isSafeInteger(pid) || pid <= 1) throw new Error("Unreadable RTX 3090 compute process identity.");
    return pid;
  }));
}

async function readWorkerListeners() {
  const { stdout } = await exec("/usr/bin/ss", ["-H", "-ltnp", "(", "sport", "=", ":8188", "or", "sport", "=", ":8189", ")"], { timeout: 5000 });
  const lines = stdout.trim().split("\n").filter(Boolean);
  return new Map(GPU_PORTS.map(({ port }) => {
    const rows = lines.filter(line => line.trim().split(/\s+/)[3]?.endsWith(`:${port}`));
    const pids = rows.map(row => [...row.matchAll(/\bpid=(\d+)\b/g)].map(match => Number(match[1])));
    if (!pids.length || pids.some(values => values.length !== 1 || values[0] <= 1) || new Set(pids.flat()).size !== 1) {
      throw new Error(`Cannot identify the configured RTX 3090 listener on port ${port}.`);
    }
    return [port, pids[0][0]];
  }));
}

function option(args: string[], flag: string) {
  const values = args.flatMap((arg, index) => arg === flag ? [args[index + 1]] : arg.startsWith(`${flag}=`) ? [arg.slice(flag.length + 1)] : []);
  if (values.length > 1 || (values.length && (!values[0] || values[0].startsWith("--")))) throw new Error("The worker command line is ambiguous.");
  return values[0];
}

async function attestWorker(unit: string, port: number, pid: number) {
  const { stdout } = await exec("/usr/bin/systemctl", ["show", unit, "-p", "ActiveState", "-p", "SubState", "-p", "MainPID", "-p", "WorkingDirectory", "-p", "ControlGroup"], { timeout: 5000 });
  const properties = new Map(stdout.trim().split("\n").map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  const group = properties.get("ControlGroup") || "";
  const workingDirectory = properties.get("WorkingDirectory") || "";
  const refuse = () => new Error(`The RTX 3090 listener on port ${port} is not owned by its configured ComfyUI service.`);
  if (properties.get("ActiveState") !== "active" || properties.get("SubState") !== "running" || Number(properties.get("MainPID")) !== pid ||
      !group.endsWith(`/${unit}`) || !path.isAbsolute(workingDirectory)) throw refuse();

  const [command, cwdLink, memberships, configuredDirectory] = await Promise.all([
    fs.readFile(`/proc/${pid}/cmdline`, "utf8"), fs.readlink(`/proc/${pid}/cwd`),
    fs.readFile(`/proc/${pid}/cgroup`, "utf8"), fs.realpath(workingDirectory),
  ]).catch(() => { throw refuse(); });
  const args = command.split("\0").filter(Boolean);
  const main = args.find(arg => path.basename(arg) === "main.py");
  const cwd = await fs.realpath(cwdLink).catch(() => "");
  const entry = main && cwd ? await fs.realpath(path.resolve(cwd, main)).catch(() => "") : "";
  if (!cwd || cwd !== configuredDirectory || entry !== path.join(configuredDirectory, "main.py") ||
      Number(option(args, "--port") ?? 8188) !== port || !memberships.split("\n").some(line => line.split(":").at(-1) === group)) throw refuse();

  const base = path.resolve(cwd, option(args, "--base-directory") || ".");
  return Promise.all(["input", "output"].map(async kind => {
    const configured = option(args, `--${kind}-directory`);
    const directory = await fs.realpath(configured ? path.resolve(cwd, configured) : path.join(base, kind));
    if (!(await fs.stat(directory)).isDirectory()) throw new Error(`The RTX 3090 worker ${kind} directory is unavailable.`);
    return directory;
  }));
}

async function readWorkerQueue(port: number, gpuName: string) {
  const read = async (route: string) => {
    const url = new URL(route, H3_WORKER);
    url.port = String(port);
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Both configured RTX 3090 workers must be readable before qualification.");
    return response.json();
  };
  const [queue, stats] = await Promise.all([read("/queue"), read("/system_stats")]);
  const cuda = Array.isArray(stats?.devices) ? stats.devices.filter((device: { type?: string }) => device?.type === "cuda") : [];
  if (cuda.length !== 1 || typeof cuda[0].name !== "string" || !RTX_3090_NAME.test(cuda[0].name) || !cuda[0].name.includes(gpuName)) {
    throw new Error(`The configured worker on port ${port} does not report the verified RTX 3090.`);
  }
  if (!Array.isArray(queue?.queue_running) || !Array.isArray(queue?.queue_pending)) throw new Error("Unreadable shared RTX 3090 queue.");
  return { running: queue.queue_running.length, pending: queue.queue_pending.length };
}

type RuntimeInspection = Omit<H3StudioQualificationLiveCheck, "physicalMutexHeld"> & {
  physicalMutexHeld: boolean;
  telemetry: { usedVramBytes: number; usedRamBytes: number; usedSwapBytes: number };
  processes: Array<{ pid: number; comfy: boolean }>;
};

export function inspectStudioQualificationRuntime(requiredVramBytes: number, insidePhysicalMutex: true, expectedGpuUuid?: string): Promise<RuntimeInspection & { physicalMutexHeld: true }>;
export function inspectStudioQualificationRuntime(requiredVramBytes: number, insidePhysicalMutex?: boolean, expectedGpuUuid?: string): Promise<RuntimeInspection>;
export async function inspectStudioQualificationRuntime(requiredVramBytes: number, insidePhysicalMutex = false, expectedGpuUuid: string = GPU_UUIDS.rtx3090): Promise<RuntimeInspection> {
  assertH3StudioTest();
  if (expectedGpuUuid !== GPU_UUIDS.rtx3090) throw new Error("The approved GPU must be the configured local TEST RTX 3090 UUID.");
  if (!Number.isSafeInteger(requiredVramBytes) || requiredVramBytes < 0) throw new Error("Invalid RTX 3090 capacity requirement.");
  const localAddresses = Object.values(os.networkInterfaces()).flatMap(entries => entries?.map(entry => entry.address) || []);
  if (H3_WORKER.protocol !== "http:" || H3_WORKER.port !== String(GPU_PORTS[0].port) || !localAddresses.includes(H3_WORKER.hostname)) {
    throw new Error("The configured RTX 3090 worker is not routed to this qualification host.");
  }
  const listeners = await readWorkerListeners();
  const workerPids = [...listeners.values()];
  if (new Set(workerPids).size !== GPU_PORTS.length) throw new Error("The configured RTX 3090 workers must have distinct listener identities.");
  const paths = await Promise.all(GPU_PORTS.map(({ port, unit }) => attestWorker(unit, port, listeners.get(port)!)));
  const checkedAt = new Date().toISOString();
  const [gpu, computePids] = await Promise.all([readGpu(expectedGpuUuid), readComputePids(expectedGpuUuid)]);
  if ([...computePids].some(pid => !workerPids.includes(pid))) throw new Error("An unrelated compute process is present on the RTX 3090; qualification is blocked without interrupting it.");
  if (workerPids.some(pid => !computePids.has(pid))) throw new Error("Could not bind both configured workers to the approved physical RTX 3090.");
  const [queues, currentListeners, memory] = await Promise.all([
    Promise.all(GPU_PORTS.map(({ port }) => readWorkerQueue(port, gpu.gpuName))),
    readWorkerListeners(),
    fs.readFile("/proc/meminfo", "utf8"),
  ]);
  if (GPU_PORTS.some(({ port }) => currentListeners.get(port) !== listeners.get(port))) throw new Error("The configured RTX 3090 worker changed during qualification inspection.");
  const queueRunning = queues.reduce((total, queue) => total + queue.running, 0);
  const queuePending = queues.reduce((total, queue) => total + queue.pending, 0);
  if (insidePhysicalMutex || (!queueRunning && !queuePending)) {
    for (const directory of new Set([OTG_DATA_ROOT, ...paths.flat()])) requireStorageHeadroom(directory);
  }
  const capacity = insidePhysicalMutex ? await readGpu(expectedGpuUuid) : gpu;
  if (insidePhysicalMutex && (queueRunning || queuePending || capacity.freeVramBytes < requiredVramBytes || capacity.total !== gpu.total || capacity.gpuName !== gpu.gpuName)) {
    throw new Error("The RTX 3090 queues or free capacity changed before submission.");
  }
  const field = (key: string) => Number(memory.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] || 0) * 1024;
  return { queueRunning, queuePending, gpuUuid: expectedGpuUuid, gpuName: capacity.gpuName, freeVramBytes: capacity.freeVramBytes, requiredVramBytes, checkedAt,
    physicalMutexHeld: insidePhysicalMutex, peerReleaseDisabled: true,
    telemetry: { usedVramBytes: capacity.total - capacity.freeVramBytes, usedRamBytes: field("MemTotal") - field("MemAvailable"), usedSwapBytes: field("SwapTotal") - field("SwapFree") },
    processes: workerPids.map(pid => ({ pid, comfy: true })) };
}
