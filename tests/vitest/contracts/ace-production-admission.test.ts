import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const s = vi.hoisted(() => ({ enabled: true, shared: true, requested: "auto", host: "shawn-3090",
  exactModel: true, loaded: true, initialBusy: false, finalBusy: false, recheckFails: false,
  mode: "success", events: [] as string[], root: "", base: "http://127.0.0.1:8002" }));
const grant = vi.hoisted(() => ({ release: vi.fn(), uncertain: vi.fn(), lease: { ownerId: "queue-fixture" } }));
const voiceRelease = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ffmpeg", () => ({ probeDurationSeconds: vi.fn(), resolveFfmpegPath: vi.fn(), runCmd: vi.fn() }));
vi.mock("@/lib/workers/mediaGpuQueue", () => ({ mediaQueueEnabled: () => s.enabled,
  acquireExternalMediaGpuChoice: vi.fn(async () => { s.events.push("admit"); return grant; }) }));
vi.mock("@/lib/workers/mediaGpuAdmission", () => ({ sharedMediaAdmissionConfigured: () => s.shared }));
vi.mock("@/lib/workers/clusterGpu", () => ({ resolveComfyPhysicalGpu: () => s.host }));
vi.mock("@/lib/mediaGpuRoutingServer", () => ({ requestedMediaGpu: async () => s.requested }));
vi.mock("@/lib/workers/voiceGpuFileLease", () => ({ acquireVoiceGpuFileLease: vi.fn(async () => { s.events.push("flock"); return voiceRelease; }) }));
vi.mock("@/lib/workers/comfy3090Peer", () => ({ releaseIdle3090Peer: vi.fn(async () => { s.events.push("peer"); }) }));
vi.mock("@/lib/workers/auxiliary3090Lease", () => ({ AuxiliaryGpuBusyError: class extends Error {} }));

import { AceMusicUnconfirmedError, generateAceMusic } from "@/lib/aceStep";
import { acquireExternalMediaGpuChoice } from "@/lib/workers/mediaGpuQueue";
import { acquireVoiceGpuFileLease } from "@/lib/workers/voiceGpuFileLease";
import { releaseIdle3090Peer } from "@/lib/workers/comfy3090Peer";

function receipt() {
  const directory = path.join(s.root, "ace-admission");
  const files = fs.readdirSync(directory).filter(file => file.endsWith(".json"));
  expect(files).toHaveLength(1);
  return JSON.parse(fs.readFileSync(path.join(directory, files[0]), "utf8"));
}
function response(value: unknown, status = 200) { return Response.json(value, { status }); }
const input = { prompt: "CPU mock only", durationSeconds: 30, seed: 42, bpm: 95, keyscale: "E minor", referenceAudioPath: "/mock/reference.wav" };
let fetcher: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(s, { enabled: true, shared: true, requested: "auto", host: "shawn-3090", exactModel: true, loaded: true,
    initialBusy: false, finalBusy: false, recheckFails: false, mode: "success", events: [], base: "http://127.0.0.1:8002" });
  s.root = fs.mkdtempSync(path.join(os.tmpdir(), "ace-admission-cpu-"));
  vi.stubEnv("OTG_DATA_DIR", s.root); vi.stubEnv("ACE_STEP_API_URL", s.base); vi.stubEnv("ACE_STEP_ENABLED", "1");
  grant.release.mockImplementation(() => { s.events.push("release"); });
  grant.uncertain.mockImplementation(() => { s.events.push("unknown"); });
  voiceRelease.mockImplementation(() => { s.events.push("unlock"); });
  fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    if (endpoint === "/health") return response({ data: { service: "ACE-Step API", models_initialized: true } });
    if (endpoint === "/v1/model_inventory") return response({ data: { models: [{ name: s.exactModel && !(s.recheckFails && s.events.includes("admit")) ? "acestep-v15-turbo" : "acestep-v15-xl-base", is_loaded: s.loaded }] } });
    if (endpoint === "/v1/stats") {
      if (s.mode === "lost-final-stats" && s.events.includes("submit")) throw new Error("stats unreachable");
      const busy = s.initialBusy || s.finalBusy && s.events.includes("submit");
      return response({ data: { queue_size: 0, jobs: { running: busy ? 1 : 0, queued: 0 } } });
    }
    if (endpoint === "/release_task") {
      s.events.push("submit"); expect(receipt().phase).toBe("submitting"); expect(receipt().queueJobId).toBe("queue-fixture");
      expect(init?.redirect).toBe("error");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model: "acestep-v15-turbo", prompt: input.prompt, inference_steps: 8, audio_format: "mp3",
        batch_size: 1, thinking: false, reference_audio_path: input.referenceAudioPath, audio_cover_strength: 0.25, seed: 42 });
      if (s.mode === "lost-submit") throw new TypeError("connection closed after POST");
      if (s.mode === "http500") return response({ error: "uncertain server failure" }, 500);
      if (s.mode === "missing-id") return response({ data: {} });
      if (s.mode === "bad-json") return new Response("{invalid");
      return response({ data: { task_id: "task-fixture" } });
    }
    if (endpoint === "/query_result") {
      s.events.push("poll"); expect(receipt().taskId).toBe("task-fixture");
      expect(JSON.parse(String(init?.body))).toEqual({ task_id_list: ["task-fixture"] });
      if (s.mode === "lost-poll") throw new DOMException("aborted", "AbortError");
      const task = { task_id: s.mode === "wrong-task" ? "foreign-task" : "task-fixture", status: s.mode === "terminal-error" ? 2 : s.mode === "bad-status" ? 9 : 1,
        result: JSON.stringify([{ file: s.mode === "no-audio" ? "" : s.mode === "foreign-output" ? "https://other.invalid/audio.mp3" : "/v1/audio/mock.mp3",
          dit_model: s.mode === "wrong-model" ? "acestep-v15-xl-base" : "acestep-v15-turbo", metas: { duration: 30, bpm: 95 } }]) };
      return response({ data: s.mode === "duplicate-task" ? [task, task] : [task] });
    }
    if (endpoint === "/v1/audio/mock.mp3") {
      s.events.push("download");expect(receipt().phase).toBe("terminal");
      if (s.mode === "download-failure") return new Response("", { status: 500 });
      return new Response("mock audio");
    }
    throw new Error(`Unexpected network call in CPU test: ${endpoint}`);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(s.root, { recursive: true, force: true }); });

describe("production ACE shared admission and exact ownership", () => {
  it("admits before flock/peer cleanup/submit and releases only after terminal idle proof", async () => {
    const result = await generateAceMusic(input);
    expect(s.events).toEqual(["admit", "flock", "peer", "peer", "submit", "poll", "download", "unlock", "release"]);
    expect(acquireExternalMediaGpuChoice).toHaveBeenCalledWith(["rtx3090"], expect.stringMatching(/^ace-production:/));
    expect(result.taskId).toBe("task-fixture");expect(result.audioBuffer.toString()).toBe("mock audio");
    expect(receipt()).toMatchObject({ phase: "release_requested", taskId: "task-fixture", baseUrl: s.base, queueJobId: "queue-fixture", model: "acestep-v15-turbo" });
    expect(JSON.stringify(receipt())).not.toContain(input.prompt);expect(JSON.stringify(receipt())).not.toContain(input.referenceAudioPath);
    expect(grant.uncertain).not.toHaveBeenCalled();expect(grant.release).toHaveBeenCalledOnce();
  });
  it.each(["enabled", "shared"] as const)("does not bypass missing %s admission", async key => {
    s[key] = false;await expect(generateAceMusic(input)).rejects.toThrow("Shared GPU admission");
    expect(fetcher).not.toHaveBeenCalled();expect(acquireExternalMediaGpuChoice).not.toHaveBeenCalled();
  });
  it("rejects an unqualified 5060 request without fallback", async () => {
    s.requested = "rtx5060ti";await expect(generateAceMusic(input)).rejects.toThrow("only qualified");expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["http://127.0.0.1:8001", "http://100.98.212.116:8002", "https://example.invalid", "http://127.0.0.1:8002/path"])("rejects unqualified endpoint %s", async base => {
    vi.stubEnv("ACE_STEP_API_URL", base);await expect(generateAceMusic(input)).rejects.toThrow("no qualified");expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not mistake SLR loopback8002 for the 3090", async () => {
    s.host = "slr-5060";await expect(generateAceMusic(input)).rejects.toThrow("no qualified");expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["exactModel", "loaded"] as const)("refuses missing exact %s without model initialization or substitution", async key => {
    s[key] = false;await expect(generateAceMusic(input)).rejects.toThrow("not loaded/qualified");expect(acquireExternalMediaGpuChoice).not.toHaveBeenCalled();
    expect(s.events).toEqual([]);expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });
  it("refuses a busy ACE service before queue registration", async () => {
    s.initialBusy = true;await expect(generateAceMusic(input)).rejects.toThrow("busy");expect(acquireExternalMediaGpuChoice).not.toHaveBeenCalled();
  });
  it("requalifies after waiting and releases an unstarted grant on changed readiness", async () => {
    s.recheckFails = true;await expect(generateAceMusic(input)).rejects.toThrow("not loaded/qualified");
    expect(releaseIdle3090Peer).not.toHaveBeenCalled();expect(s.events).not.toContain("submit");expect(grant.release).toHaveBeenCalledOnce();
  });
  it.each(["lost-submit", "http500", "missing-id", "bad-json", "lost-poll", "wrong-task", "duplicate-task", "bad-status", "lost-final-stats"])("retains durable ownership after %s; never resubmits", async mode => {
    s.mode = mode;await expect(generateAceMusic(input)).rejects.toBeInstanceOf(AceMusicUnconfirmedError);
    expect(grant.uncertain).toHaveBeenCalledOnce();expect(grant.release).not.toHaveBeenCalled();expect(voiceRelease).toHaveBeenCalledOnce();
    expect(s.events.filter(x => x === "submit")).toHaveLength(1);expect(receipt().phase).toBe("unknown");
  });
  it("retains on polling deadline without issuing a second submit", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(2_000_000);
    await expect(generateAceMusic(input)).rejects.toBeInstanceOf(AceMusicUnconfirmedError);
    expect(grant.release).not.toHaveBeenCalled();expect(receipt().taskId).toBe("task-fixture");
  });
  it("does not treat terminal cache status as idle GPU proof", async () => {
    s.finalBusy = true;await expect(generateAceMusic(input)).rejects.toBeInstanceOf(AceMusicUnconfirmedError);expect(grant.release).not.toHaveBeenCalled();
  });
  it.each(["terminal-error", "no-audio", "download-failure", "foreign-output", "wrong-model"])("releases a confirmed terminal/idle operation after %s without retry", async mode => {
    s.mode = mode;await expect(generateAceMusic(input)).rejects.toThrow();expect(grant.release).toHaveBeenCalledOnce();expect(grant.uncertain).not.toHaveBeenCalled();
    expect(s.events.filter(x => x === "submit")).toHaveLength(1);
  });
  it("journal failure prevents POST and safely releases unstarted admission", async () => {
    const rename = fsp.rename.bind(fsp);let writes = 0;
    vi.spyOn(fsp, "rename").mockImplementation(async (...args) => { if (++writes === 3) throw Error("disk full"); return rename(...args); });
    await expect(generateAceMusic(input)).rejects.toThrow("disk full");expect(s.events).not.toContain("submit");expect(grant.release).toHaveBeenCalledOnce();
  });
  it("journal failure after accepted POST retains the original task correlation", async () => {
    const rename = fsp.rename.bind(fsp);let writes = 0;
    vi.spyOn(fsp, "rename").mockImplementation(async (...args) => { if (++writes === 4) throw Error("disk full"); return rename(...args); });
    await expect(generateAceMusic(input)).rejects.toBeInstanceOf(AceMusicUnconfirmedError);expect(grant.release).not.toHaveBeenCalled();expect(receipt().taskId).toBe("task-fixture");
  });
  it("a failed unknown-status write cannot hide the no-resubmit fence or release ownership", async () => {
    s.mode = "lost-submit";grant.uncertain.mockImplementationOnce(() => { throw Error("database unavailable"); });
    await expect(generateAceMusic(input)).rejects.toBeInstanceOf(AceMusicUnconfirmedError);
    expect(grant.release).not.toHaveBeenCalled();expect(receipt().phase).toBe("unknown");
  });
  it("a failed final release receipt retains ownership and returns an unknown-outcome fence", async () => {
    const rename = fsp.rename.bind(fsp);let writes = 0;
    vi.spyOn(fsp, "rename").mockImplementation(async (...args) => { if (++writes === 6) throw Error("disk full"); return rename(...args); });
    grant.uncertain.mockImplementationOnce(() => { throw Error("database unavailable"); });
    await expect(generateAceMusic(input)).rejects.toBeInstanceOf(AceMusicUnconfirmedError);
    expect(grant.release).not.toHaveBeenCalled();expect(receipt().phase).toBe("terminal");expect(voiceRelease).toHaveBeenCalledOnce();
  });
  it("an unavailable local flock cannot submit GPU work", async () => {
    vi.mocked(acquireVoiceGpuFileLease).mockRejectedValueOnce(Error("flock busy"));
    await expect(generateAceMusic(input)).rejects.toThrow("flock busy");expect(s.events).not.toContain("submit");expect(grant.release).toHaveBeenCalledOnce();
  });
  it("pins polling/output to the admitted endpoint even if environment changes", async () => {
    vi.mocked(releaseIdle3090Peer).mockImplementationOnce(async () => { vi.stubEnv("ACE_STEP_API_URL", "https://other.invalid"); });
    await generateAceMusic(input);expect(fetcher.mock.calls.every(([url]) => String(url).startsWith(s.base))).toBe(true);
  });
});
