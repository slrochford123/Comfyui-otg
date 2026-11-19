import { beforeEach, describe, expect, it, vi } from "vitest";
import { GPU_UUIDS } from "@/lib/mediaGpuRouting";
import { inspectStudioQualificationRuntime } from "@/lib/h3StudioRuntime";

const mock = vi.hoisted(() => ({
  exec: vi.fn<(command: string, args: string[]) => string>(),
  read: vi.fn<(file: string) => Promise<string>>(),
  readlink: vi.fn<(file: string) => Promise<string>>(),
  realpath: vi.fn<(file: string) => Promise<string>>(),
  stat: vi.fn<(file: string) => Promise<{ isDirectory: () => boolean }>>(),
  interfaces: vi.fn(),
  storage: vi.fn<(folder: string) => unknown>(),
  http: vi.fn<(url: URL, options?: RequestInit) => Promise<Response>>(),
}));

vi.mock("node:child_process", () => ({
  execFile: (command: string, args: string[], _options: object, done: (error: unknown, value?: { stdout: string }) => void) => {
    try { done(null, { stdout: mock.exec(command, args) }); }
    catch (error) { done(error); }
  },
}));
vi.mock("node:fs/promises", () => ({ default: {
  readFile: mock.read, readlink: mock.readlink, realpath: mock.realpath, stat: mock.stat,
} }));
vi.mock("node:os", () => ({ default: { networkInterfaces: mock.interfaces } }));
vi.mock("@/lib/paths", () => ({ OTG_DATA_ROOT: "/pilot/data" }));
vi.mock("@/lib/h3StudioRegistry", () => ({ assertH3StudioTest: () => undefined }));
vi.mock("@/lib/storageAdmission", () => ({ requireStorageHeadroom: mock.storage }));
vi.mock("@/lib/production/h3Workflows", () => ({ H3_BACKEND_PROFILES: { rtx3090: { baseUrl: "http://100.75.162.64:8189" } } }));

const UUID = GPU_UUIDS.rtx3090;
const COMFY = "/srv/current-comfy-release";
const MEM = "MemTotal: 64000000 kB\nMemAvailable: 60000000 kB\nSwapTotal: 1000000 kB\nSwapFree: 500000 kB\n";
const listener = (port: number, pid: number) => `LISTEN 0 128 100.75.162.64:${port} 0.0.0.0:* users:(("python",pid=${pid},fd=42))`;
const bothListeners = [listener(8189, 1001), listener(8188, 1002)].join("\n");
const unitFor = (port: number) => port === 8189 ? "otg-comfyui-h3.service" : "otg-comfyui.service";
const groupFor = (port: number) => `/otg.slice/otg-comfyui.slice/${unitFor(port)}`;

let gpuCsv: string;
let processCsv: string;
let listenerCsv: string;
let queued: boolean;
let reportedGpu: string;

beforeEach(() => {
  vi.resetAllMocks();
  gpuCsv = `${UUID}, NVIDIA GeForce RTX 3090, 24576, 22838`;
  processCsv = `${UUID}, 1001\n${UUID}, 1002`;
  listenerCsv = bothListeners;
  queued = false;
  reportedGpu = "cuda:0 NVIDIA GeForce RTX 3090 : cudaMallocAsync";
  mock.interfaces.mockReturnValue({ tailscale0: [{ address: "100.75.162.64" }] });
  mock.exec.mockImplementation((command, args) => {
    if (command.endsWith("nvidia-smi")) {
      expect(args[0]).toBe(`--id=${UUID}`);
      return args[1].startsWith("--query-compute-apps") ? processCsv : gpuCsv;
    }
    if (command.endsWith("/ss")) return listenerCsv;
    if (command.endsWith("/systemctl")) {
      const port = args[1] === unitFor(8189) ? 8189 : 8188;
      return `MainPID=${port === 8189 ? 1001 : 1002}\nControlGroup=${groupFor(port)}\nWorkingDirectory=${COMFY}\nActiveState=active\nSubState=running\n`;
    }
    throw Error(`Unexpected command ${command}`);
  });
  mock.read.mockImplementation(async file => {
    if (file === "/proc/meminfo") return MEM;
    const port = file.includes("/1001/") ? 8189 : 8188;
    if (file.endsWith("/cmdline")) return `python\0${COMFY}/main.py\0--port\0${port}\0`;
    if (file.endsWith("/cgroup")) return `0::${groupFor(port)}\n`;
    throw Error("Unexpected process file");
  });
  mock.readlink.mockResolvedValue(COMFY);
  mock.realpath.mockImplementation(async file => file);
  mock.stat.mockResolvedValue({ isDirectory: () => true });
  mock.http.mockImplementation(async (url, request) => {
    expect(["8188", "8189"]).toContain(url.port);
    expect(request?.method).toBeUndefined();
    expect(request?.redirect).toBe("error");
    if (url.pathname === "/queue") return Response.json({ queue_running: [], queue_pending: queued && url.port === "8188" ? [{}] : [] });
    if (url.pathname === "/system_stats") return Response.json({ devices: [{ type: "cuda", name: reportedGpu }] });
    throw Error("Unexpected worker request");
  });
  vi.stubGlobal("fetch", mock.http);
});

describe("local H3 Studio qualification runtime", () => {
  it("can inspect the configured RTX 3090 independently of the assistant GPU and prove both listeners", async () => {
    const result = await inspectStudioQualificationRuntime(20 * 1024 ** 3, true, UUID);
    expect(result).toMatchObject({ gpuUuid: UUID, queuePending: 0, queueRunning: 0, physicalMutexHeld: true,
      peerReleaseDisabled: true, processes: [{ pid: 1001, comfy: true }, { pid: 1002, comfy: true }] });
    expect(mock.storage.mock.calls.flat()).toEqual(["/pilot/data", `${COMFY}/input`, `${COMFY}/output`]);
    expect(mock.http).toHaveBeenCalledTimes(4);
  });

  it("refuses an explicit assistant-card UUID before probing anything", async () => {
    await expect(inspectStudioQualificationRuntime(0, false, GPU_UUIDS.rtx3060)).rejects.toThrow(/approved GPU/);
    expect(mock.exec).not.toHaveBeenCalled();
    expect(mock.http).not.toHaveBeenCalled();
  });

  it("rejects a configured worker host not bound to this machine", async () => {
    mock.interfaces.mockReturnValue({ loopback: [{ address: "127.0.0.1" }] });
    await expect(inspectStudioQualificationRuntime(0)).rejects.toThrow(/not routed/);
    expect(mock.exec).not.toHaveBeenCalled();
  });

  it("fails when a listener or service identity is replaced", async () => {
    listenerCsv = [listener(8189, 9999), listener(8188, 1002)].join("\n");
    await expect(inspectStudioQualificationRuntime(0)).rejects.toThrow(/not owned by/);
    expect(mock.http).not.toHaveBeenCalled();
  });

  it("checks membership in the attested Comfy service", async () => {
    const read = mock.read.getMockImplementation()!;
    mock.read.mockImplementation(file => file === "/proc/1001/cgroup" ? Promise.resolve("0::/unrelated.service\n") : read(file));
    await expect(inspectStudioQualificationRuntime(0)).rejects.toThrow(/not owned by/);
  });

  it("refuses foreign and unaccounted CUDA processes on the approved card", async () => {
    processCsv += `\n${UUID}, 5000`;
    await expect(inspectStudioQualificationRuntime(0)).rejects.toThrow(/unrelated compute/);
    processCsv = `${UUID}, 1001\n${GPU_UUIDS.rtx3060}, 1002`;
    await expect(inspectStudioQualificationRuntime(0)).rejects.toThrow(/process identity/);
  });

  it("requires the bound listener to report the correct physical GPU", async () => {
    reportedGpu = "cuda:0 NVIDIA GeForce RTX 3060";
    await expect(inspectStudioQualificationRuntime(0)).rejects.toThrow(/does not report/);
  });

  it("fails closed if a listener changes while the worker is being inspected", async () => {
    const execute = mock.exec.getMockImplementation()!;
    let listenerReads = 0;
    mock.exec.mockImplementation((command, args) => {
      if (command.endsWith("/ss") && ++listenerReads === 2) return [listener(8189, 9999), listener(8188, 1002)].join("\n");
      return execute(command, args);
    });
    await expect(inspectStudioQualificationRuntime(0)).rejects.toThrow(/worker changed during/);
  });

  it("refuses the last in-mutex check if queue, VRAM or storage changed", async () => {
    queued = true;
    await expect(inspectStudioQualificationRuntime(0)).resolves.toMatchObject({ queuePending: 1, physicalMutexHeld: false });
    await expect(inspectStudioQualificationRuntime(10, true)).rejects.toThrow(/queues or free capacity changed/);
    queued = false;
    gpuCsv = `${UUID}, NVIDIA GeForce RTX 3090, 24576, 1000`;
    await expect(inspectStudioQualificationRuntime(9000 * 1024 ** 2, true)).rejects.toThrow(/queues or free capacity changed/);
    mock.storage.mockImplementation(() => { throw Error("insufficient disk storage"); });
    await expect(inspectStudioQualificationRuntime(10, true)).rejects.toThrow(/insufficient disk/);
  });

  it("rechecks free VRAM after attesting the workers and storage", async () => {
    mock.storage.mockImplementation(() => { gpuCsv = `${UUID}, NVIDIA GeForce RTX 3090, 24576, 501`; });
    await expect(inspectStudioQualificationRuntime(20 * 1024 ** 3, true)).rejects.toThrow(/free capacity changed/);
  });
});
