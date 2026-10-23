import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { H3DirectJob, H3DirectJobInput } from "@/lib/h3DirectJobs";
import type { H3StudioPlan } from "@/lib/h3StudioPlan";
import type { H3PromptGraph } from "@/lib/production/h3Workflows";

// Only persistence, runner/reconciliation, reviews and HTTP admission are real.
// Cut worker/auth import trees before importing the engine; never open a live DB.
const m = vi.hoisted(() => ({
  root: "", submit: vi.fn(), prompt: vi.fn(), history: vi.fn(), cancel: vi.fn(),
  inspect: vi.fn(), choose: vi.fn(), upload: vi.fn(), download: vi.fn(),
  build: vi.fn(), compile: vi.fn(), inventory: vi.fn(), progress: vi.fn(),
  monitor: vi.fn(), record: vi.fn(), owner: vi.fn(), session: vi.fn(),
  media: vi.fn(), validateMedia: vi.fn(), unexpected: vi.fn(), fetch: vi.fn(),
}));
vi.mock("@/lib/paths", async () => {
  const p = await import("node:path"), f = await import("node:fs");
  return {
    get OTG_DATA_ROOT() {
      if (!m.root) throw new Error("Private test root must exist before engine import");
      return m.root;
    },
    safeSegment: (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "local",
    safeJoin: (base: string, ...parts: string[]) => {
      const target = p.resolve(base, ...parts), relative = p.relative(p.resolve(base), target);
      if (relative.startsWith("..") || p.isAbsolute(relative)) throw new Error("Path escaped private root");
      return target;
    },
    ensureDir: (dir: string) => f.mkdirSync(dir, { recursive: true }),
    userGalleryDir: m.unexpected, deviceGalleryDir: m.unexpected,
  };
});
vi.mock("@/lib/production/h3Comfy", () => ({
  submitH3Prompt: m.submit, getH3PromptHistory: m.history,
  inspectH3BackendCompatibility: m.inspect, uploadH3Input: m.upload, downloadH3Video: m.download,
}));
vi.mock("@/lib/production/h3GenerationScheduler", () => ({ chooseProductionV2H3Backend: m.choose }));
vi.mock("@/lib/production/h3Workflows", () => ({
  buildH3Workflow: m.build, H3_BACKEND_PRIORITY: ["rtx3090"],
  H3_BACKEND_PROFILES: { rtx3090: { baseUrl: "http://comfy.invalid:8189", label: "Mock 3090" } },
  H3_MAX_AUDIO_REFERENCES: 3, H3_MAX_IMAGE_REFERENCES: 9, H3_MAX_VIDEO_REFERENCES: 3,
}));
vi.mock("@/lib/production/h3Loras", () => ({ DEFAULT_PRODUCTION_V2_H3_USER_LORAS: [] }));
vi.mock("@/lib/h3LoraCatalogServer", () => ({ validateH3LoraSelections: () => ({ resolved: [] }) }));
vi.mock("@/lib/comfySafeCancel", () => ({ cancelComfyPrompt: m.cancel }));
vi.mock("@/lib/comfyProgress", () => ({
  ensureComfyClientProgressMonitor: m.monitor, readComfyPromptProgress: m.progress,
  recordComfyPromptSubmitted: m.record,
}));
vi.mock("@/lib/gallery", () => ({
  clearGalleryListCache: m.unexpected, safeGalleryName: m.unexpected, writeMetaForFile: m.unexpected,
}));
vi.mock("@/lib/h3VideoEdit", () => ({
  applyH3VideoEditGraph: m.unexpected, prepareH3VideoEditSource: m.unexpected,
  finalizeH3VideoEdit: m.unexpected, h3VideoEditFrameCount: m.unexpected,
}));
vi.mock("@/lib/h3RifeFinalization", () => ({
  applyH3Rife60FpsFinalization: m.unexpected, h3FinalFpsForRife: () => 24,
  H3_RIFE_NATIVE_FPS: 24, normalizeH3RifeInterpolation60Fps: (v: unknown) => v === true,
}));
vi.mock("@/lib/h3StudioCompiler", () => ({ compileH3StudioPlan: m.compile }));
vi.mock("@/lib/h3StudioRegistry", () => ({
  assertH3StudioTest: () => { if (process.env.OTG_ENV !== "test") throw new Error("TEST only"); },
  inspectH3StudioInventory: m.inventory, readH3StudioEvidence: () => null, h3StudioCatalog: () => [],
  readH3StudioOwnerJson: m.unexpected, exactH3StudioQualification: m.unexpected,
}));
vi.mock("@/lib/h3StudioMedia", () => ({
  studioPrivateOwnerRoot: (owner: string) => path.join(m.root, "studio", owner),
  resolveStudioMedia: m.media, validateStudioMediaPlan: m.validateMedia,
  studioBoundCompilerInput: (plan: H3StudioPlan) => ({ finalPrompt: plan.prompt, seed: plan.seed }),
  studioFileSha256: m.unexpected,
}));
vi.mock("@/lib/h3StudioAudio", () => ({
  prepareH3StudioReferenceClip: m.unexpected, finalizeH3StudioAudio: m.unexpected,
}));
vi.mock("@/lib/h3StudioRuntime", () => ({ inspectStudioQualificationRuntime: m.unexpected }));
vi.mock("@/lib/ffmpeg", () => ({ resolveFfprobePath: m.unexpected }));
vi.mock("@/lib/h3VideoTrimSession", () => ({ videoTrimSession: m.session }));
vi.mock("@/lib/ownerKey", () => ({ getOwnerContext: m.owner, SessionInvalidError: class extends Error {} }));
vi.mock("@/lib/sessionUser", () => ({ requireSessionUser: m.session }));
vi.mock("@/lib/h3StagedUploads", () => ({ readCompletedH3StagedUpload: m.unexpected }));
vi.mock("@/lib/h3ReferenceVideoClip", () => ({ trimH3ReferenceVideoClip: m.unexpected }));
vi.mock("@/lib/h3StylePresets", () => ({ composeH3StylePrompt: m.unexpected, resolveH3StylePreset: m.unexpected }));
vi.mock("sharp", () => ({ default: m.unexpected }));

const OWNER = "qa-recovery-owner", SESSION = "qa-recovery-session";
const QUALIFICATION = "a".repeat(64), GRAPH = "b".repeat(64);
let engine: typeof import("@/lib/h3DirectJobs");
let reviews: typeof import("@/lib/h3StudioReview");
let generation: typeof import("@/app/api/h3/generation/route");
let executeRoute: typeof import("@/app/api/h3/studio/execute/route");
let plan: H3StudioPlan;
let started: H3DirectJob[];
let releaseGates: Array<() => void>;

function graph(prompt: string, seed: number): H3PromptGraph {
  return {
    "1": { class_type: "MiniMaxH3TextToVideo", inputs: { prompt, seed } },
    "2": { class_type: "SaveVideo", inputs: { filename_prefix: "qa-only" } },
  };
}
function compilation(_plan: H3StudioPlan, input: { finalPrompt: string; seed: number }) {
  return {
    graph: graph(input.finalPrompt, input.seed), workflowId: "qa-studio",
    manifest: { executable: true, readyForQualification: false, qualificationFingerprint: QUALIFICATION,
      boundGraphDigest: GRAPH, submissionGraphSha256: GRAPH, estimatedCredits: 0, estimatedSeconds: 20,
      width: 1056, height: 608 },
  };
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  releaseGates.push(resolve);
  return { promise, resolve };
}
async function idle(job: H3DirectJob) {
  await vi.waitFor(() => {
    const state = (globalThis as typeof globalThis & { __otgH3DirectJobs?: { running: Set<string> } }).__otgH3DirectJobs;
    expect(state?.running.has(job.id) ?? false).toBe(false);
  }, { timeout: 4000, interval: 10 });
}
function start(job: H3DirectJob) { started.push(job); engine.startH3DirectJob(job); }
async function current(job: H3DirectJob) {
  const saved = await engine.getH3DirectJob(job.ownerKey, job.id);
  expect(saved).not.toBeNull();
  return saved!;
}
// Model a persisted crash snapshot only inside this test's mkdtemp directory.
// No private engine writer is exported or mocked.
async function persist(job: H3DirectJob, patch: Partial<H3DirectJob>) {
  const file = path.join(m.root, "h3-direct", job.ownerKey, "jobs", `${job.id}.json`);
  const saved = { ...await current(job), ...patch };
  await fs.writeFile(file, JSON.stringify(saved), { mode: 0o600 });
  return saved;
}
async function createJob() {
  const directory = path.join(m.root, "h3-direct", OWNER, "uploads", randomUUID());
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const input: H3DirectJobInput = {
    studioPlan: structuredClone(plan), mode: "h3-text-to-video", quality: "lq", orientation: "landscape",
    durationSeconds: 5, prompt: plan.prompt, seed: plan.seed, optionalLoras: [],
    firstImage: null, lastImage: null, images: [], videos: [], audios: [],
    studioMedia: { requestId: randomUUID(), reviewId: randomUUID(), fingerprint: "qa-media",
      qualificationFingerprint: QUALIFICATION, planHash: reviews.studioRequestHash(plan), directory, files: [],
      receipt: { executionDigest: reviews.studioReviewedExecutionDigest(graph(plan.prompt, plan.seed)), credits: 0, seconds: 20 } },
  };
  return engine.createH3DirectJob(OWNER, input);
}
function getRequest(job: H3DirectJob) {
  return new NextRequest(`http://localhost:3001/api/h3/generation?jobId=${job.id}`);
}
async function deliberateReview() {
  const receipt = { executionDigest: reviews.studioReviewedExecutionDigest(graph(plan.prompt, plan.seed)), credits: 0, seconds: 20 };
  const review = await reviews.createStudioReview(OWNER, SESSION, plan, "qa-media", QUALIFICATION, GRAPH, receipt);
  return new NextRequest("http://localhost:3001/api/h3/studio/execute", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan, mediaIds: [], reviewId: review.id, requestId: randomUUID(), generationConsent: true }),
  });
}

beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks();
  started = []; releaseGates = [];
  m.root = await fs.mkdtemp(path.join(os.tmpdir(), "h3-studio-runner-recovery-"));
  vi.stubEnv("OTG_ENV", "test"); vi.stubEnv("OTG_DATA_DIR", m.root); vi.stubEnv("OTG_DATA_ROOT", m.root);
  m.unexpected.mockImplementation(() => { throw new Error("Forbidden worker/media side effect in recovery contract"); });
  m.fetch.mockImplementation(() => { throw new Error("Unexpected network request in recovery contract"); });
  vi.stubGlobal("fetch", m.fetch);
  m.owner.mockResolvedValue({ ownerKey: OWNER, username: "qa", deviceId: "qa-device", scope: "user" });
  m.session.mockResolvedValue({ owner: OWNER, session: SESSION });
  m.media.mockResolvedValue({ fingerprint: "qa-media", mediaIds: [], items: [] });
  m.inventory.mockResolvedValue({}); m.progress.mockReturnValue(null);
  m.inspect.mockResolvedValue({ backend: "rtx3090", compatible: true }); m.choose.mockReturnValue("rtx3090");
  m.build.mockReturnValue({ graph: {}, workflowId: "qa-base", workflowFile: "mock-workflow.json" });
  m.compile.mockImplementation(compilation);
  m.cancel.mockResolvedValue({ status: "canceled" });
  // End resumed collection without polling or producing/downloading media.
  m.history.mockResolvedValue({ state: "failed" });
  m.submit.mockImplementation(async args => {
    await args.beforeSubmit(); m.prompt();
    return { accepted: false, status: 422, error: "Mock definite rejection" };
  });
  ({ DEFAULT_H3_STUDIO_PLAN: plan } = await import("@/lib/h3StudioPlan"));
  plan = { ...plan, prompt: "A QA kite in the wind", originalPrompt: "A QA kite in the wind" };
  engine = await import("@/lib/h3DirectJobs");
  reviews = await import("@/lib/h3StudioReview");
  generation = await import("@/app/api/h3/generation/route");
  executeRoute = await import("@/app/api/h3/studio/execute/route");
});
afterEach(async () => {
  try {
    for (const release of releaseGates) release();
    for (const job of started) await idle(job);
    expect(m.unexpected).not.toHaveBeenCalled();
    expect(m.upload).not.toHaveBeenCalled(); expect(m.download).not.toHaveBeenCalled();
  } finally {
    const root = m.root;
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true }); m.root = "";
  }
});

describe("H3 Studio real runner recovery with isolated persistence", () => {
  it("retains repeated cancellation while submission is in flight and records late acceptance before cancellation", async () => {
    const entered = gate(), accept = gate(), recorded = gate(), finish = gate();
    m.submit.mockImplementation(async args => {
      await args.beforeSubmit(); m.prompt(); entered.resolve();
      await accept.promise;
      await args.onAccepted("late-accepted-prompt"); recorded.resolve();
      await finish.promise;
      return { accepted: true, promptId: "late-accepted-prompt" };
    });
    const job = await createJob(); start(job);
    await entered.promise;
    const submitting = await current(job);
    expect(submitting).toMatchObject({ status: "preparing", studioSubmissionState: "submitting", promptId: null });
    expect(submitting.clientId).toMatch(/^otg-h3-direct-/);
    const first = await engine.cancelH3DirectJob(OWNER, job.id);
    expect(first).toMatchObject({ status: "canceling", studioSubmissionState: "submitting", completedAt: null });
    expect(Number.isFinite(Date.parse(first.cancelRequestedAt!))).toBe(true);
    // Cross a clock tick so replacing the original request time cannot pass.
    await new Promise(resolve => setTimeout(resolve, 10));
    const second = await engine.cancelH3DirectJob(OWNER, job.id);
    expect(second).toMatchObject({ status: "canceling", cancelRequestedAt: first.cancelRequestedAt, completedAt: null });
    expect(await engine.reconcileH3StudioSubmission(OWNER, job.id)).toEqual(second);
    engine.ensureH3DirectJobRunner(second);
    expect(m.fetch).not.toHaveBeenCalled(); expect(m.cancel).not.toHaveBeenCalled();
    expect(m.submit).toHaveBeenCalledTimes(1);
    accept.resolve(); await recorded.promise;
    expect(await current(job)).toMatchObject({ status: "canceling", studioSubmissionState: "accepted",
      promptId: "late-accepted-prompt", cancelRequestedAt: first.cancelRequestedAt, completedAt: null });
    finish.resolve(); await idle(job);
    expect(await current(job)).toMatchObject({ status: "canceled", studioSubmissionState: "accepted",
      promptId: "late-accepted-prompt", cancelRequestedAt: first.cancelRequestedAt });
    expect(m.cancel).toHaveBeenCalledExactlyOnceWith("http://comfy.invalid:8189", "late-accepted-prompt");
    expect(m.prompt).toHaveBeenCalledTimes(1); expect(m.history).not.toHaveBeenCalled();
  });

  it.each([422, "transport", 503] as const)("distinguishes definite rejection from unresolved submission (%s) before a fresh reviewed request", async outcome => {
    m.submit.mockImplementation(async args => {
      await args.beforeSubmit(); m.prompt();
      if (outcome === "transport") throw new Error("Mock transport disconnected after send");
      return { accepted: false, status: outcome, error: "Mock backend response" };
    });
    const job = await createJob(); start(job); await idle(job);
    const state = outcome === 422 ? "rejected" : "unknown";
    expect(await current(job)).toMatchObject({ status: "failed", studioSubmissionState: state, promptId: null });
    const response = await executeRoute.POST(await deliberateReview());
    const body = await response.json();
    if (outcome === 422) {
      expect(response.status).toBe(202);
      expect(body.job.id).not.toBe(job.id);
      const retry = await engine.getH3DirectJob(OWNER, body.job.id);
      expect(retry).not.toBeNull(); started.push(retry!); await idle(retry!);
      expect(retry!.input.studioMedia!.reviewId).not.toBe(job.input.studioMedia!.reviewId);
      expect(m.submit).toHaveBeenCalledTimes(2);
      expect(await engine.listH3DirectJobs(OWNER)).toHaveLength(2);
    } else {
      expect(response.status).toBe(400); expect(body.error).toMatch(/earlier backend submission is unresolved/i);
      expect(m.submit).toHaveBeenCalledTimes(1); expect(await engine.listH3DirectJobs(OWNER)).toHaveLength(1);
    }
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it.each(["queue_running", "queue_pending", "history"] as const)("GET recovers the exact server clientId from %s without submitting again", async location => {
    const job = await createJob(), clientId = "otg-h3-direct-server-owned", promptId = "recovered-exact-prompt";
    await persist(job, { status: "failed", backend: "rtx3090", clientId, studioSubmissionState: "unknown" });
    const decoy = [1, "wrong-owner-prompt", {}, { client_id: `${clientId}-other` }];
    const exact = [2, promptId, {}, { client_id: clientId }];
    const queue = { queue_running: [decoy], queue_pending: [] as unknown[] };
    const history: Record<string, unknown> = { "wrong-history": { prompt: decoy } };
    if (location === "history") history[promptId] = { prompt: exact };
    else queue[location].push(exact);
    m.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      expect(init.method ?? "GET").toBe("GET");
      if (url === "http://comfy.invalid:8189/queue") return Response.json(queue);
      if (url === "http://comfy.invalid:8189/history?max_items=200") return Response.json(history);
      throw new Error(`Unexpected URL: ${url}`);
    });
    const response = await generation.GET(getRequest(job)); started.push(job);
    expect(response.status).toBe(200);
    expect((await response.json()).job).toMatchObject({ promptId, submissionState: "accepted" });
    await idle(job);
    expect(await current(job)).toMatchObject({ promptId, clientId, studioSubmissionState: "accepted" });
    expect(m.history).toHaveBeenCalledExactlyOnceWith("rtx3090", promptId);
    expect(m.fetch.mock.calls.map(([url]) => url).sort()).toEqual([
      "http://comfy.invalid:8189/history?max_items=200", "http://comfy.invalid:8189/queue",
    ]);
    expect(m.submit).not.toHaveBeenCalled(); expect(m.build).not.toHaveBeenCalled();
    await engine.reconcileH3StudioSubmission(OWNER, job.id);
    expect(m.fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["absent", "ambiguous", "unreadable", "transport"])("keeps %s backend evidence unresolved rather than permitting resubmission", async evidence => {
    const job = await createJob(), clientId = "otg-h3-direct-server-owned";
    const snapshot = await persist(job, { status: "failed", backend: "rtx3090", clientId, studioSubmissionState: "unknown" });
    m.fetch.mockImplementation(async (url: string) => {
      if (evidence === "transport") throw new Error("Mock backend unavailable");
      if (evidence === "unreadable") return Response.json({}, { status: 503 });
      return Response.json(url.endsWith("/queue")
        ? { queue_running: evidence === "ambiguous" ? [[1, "p1", {}, { client_id: clientId }], [2, "p2", {}, { client_id: clientId }]] : [], queue_pending: [] }
        : {});
    });
    expect((await generation.GET(getRequest(job))).status).toBe(200);
    expect(await current(job)).toEqual(snapshot);
    expect((await executeRoute.POST(await deliberateReview())).status).toBe(400);
    expect(m.submit).not.toHaveBeenCalled(); expect(m.history).not.toHaveBeenCalled();
    expect(await engine.listH3DirectJobs(OWNER)).toHaveLength(1);
  });

  it("denies another owner GET, cancel and reconciliation before any backend calls", async () => {
    const job = await createJob();
    const snapshot = await persist(job, { status: "preparing", backend: "rtx3090", clientId: "server-client", studioSubmissionState: "submitting" });
    m.owner.mockResolvedValue({ ownerKey: "qa-other-owner" });
    expect(await engine.getH3DirectJob("qa-other-owner", job.id)).toBeNull();
    expect(await engine.reconcileH3StudioSubmission("qa-other-owner", job.id)).toBeNull();
    await expect(engine.cancelH3DirectJob("qa-other-owner", job.id)).rejects.toThrow(/not found/i);
    expect((await generation.GET(getRequest(job))).status).toBe(404);
    const canceled = await generation.POST(new NextRequest("http://localhost:3001/api/h3/generation", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel", jobId: job.id }),
    }));
    expect(canceled.status).toBe(400); expect(await current(job)).toEqual(snapshot);
    for (const call of [m.fetch, m.submit, m.cancel, m.history, m.inspect, m.monitor, m.record]) expect(call).not.toHaveBeenCalled();
  });

  it("does not treat a persisted CLI qualification marker as a web-process capability", async () => {
    const normal = await createJob();
    const { studioMedia: _media, ...input } = normal.input;
    const job = await engine.createH3DirectJob(OWNER, { ...input, studioQualification: { fingerprint: QUALIFICATION } });
    const qualification = await import("@/lib/h3StudioQualification");
    expect(qualification.hasH3StudioQualificationAdmission(job.id, OWNER)).toBe(false);
    start(job); engine.ensureH3DirectJobRunner(job);
    const response = await generation.GET(getRequest(job));
    expect(response.status).toBe(200); expect((await response.json()).job.status).toBe("queued");
    expect(await current(job)).toMatchObject({ status: "queued", backend: null, promptId: null });
    for (const call of [m.fetch, m.submit, m.inspect, m.build, m.compile, m.inventory, m.history]) expect(call).not.toHaveBeenCalled();
  });

  it.each(["prompt", "seed", "estimate"] as const)("blocks changed %s against the exact reviewed receipt before /prompt", async changed => {
    const original = await createJob();
    const input = structuredClone(original.input);
    if (changed === "prompt") input.prompt = "A different unreviewed scene";
    if (changed === "seed") input.seed += 1;
    if (changed === "estimate") input.studioMedia!.receipt.seconds = 21;
    const job = await persist(original, { input }); start(job); await idle(job);
    expect(await current(job)).toMatchObject({ status: "failed", promptId: null });
    expect((await current(job)).studioSubmissionState).toBeUndefined();
    expect(m.submit).toHaveBeenCalledTimes(1); // Entered the mocked mutex/admission wrapper.
    expect(m.compile).toHaveBeenCalledTimes(2);
    await expect(m.submit.mock.results[0].value).rejects.toThrow(/reviewed prompt, seed, estimate or execution graph changed/i);
    expect(m.prompt).not.toHaveBeenCalled(); // beforeSubmit rejected; no POST /prompt.
    expect(m.fetch).not.toHaveBeenCalled(); expect(m.cancel).not.toHaveBeenCalled();
  });
});
