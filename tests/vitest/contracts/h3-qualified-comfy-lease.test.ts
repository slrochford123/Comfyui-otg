import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitComfyPromptWithGpuLease } from "@/lib/workers/comfyPromptLease";
import type { H3StudioLeasedSubmission } from "@/lib/h3StudioQualification";

const mocked = vi.hoisted(() => ({ order: [] as string[], held: false, durable: true, submit: vi.fn(), enqueue: vi.fn(), approve: vi.fn(), assert: vi.fn(), peer: vi.fn(), requireQueue: vi.fn(), checkBridge: vi.fn() }));
vi.mock("@/lib/workers/comfy5060Lease", () => ({ isRtx5060Comfy8188Endpoint: () => false }));
vi.mock("@/lib/workers/clusterGpu", () => ({ resolveComfyPhysicalGpu: () => "shawn-3090" }));
vi.mock("@/lib/workers/comfySubmissionCriticalSection", () => ({ runWithComfySubmissionCriticalSection: async (_input: unknown, run: () => Promise<Response>) => {
  mocked.held = true;
  try { return { ok: true, value: await run() }; }
  finally { mocked.held = false; }
} }));
vi.mock("@/lib/workers/comfy3090Peer", () => ({ releaseIdle3090Peer: mocked.peer }));
vi.mock("@/lib/workers/voiceGpuFileLease", () => ({ acquireVoiceGpuFileLease: async () => () => undefined }));
vi.mock("@/lib/workers/mediaGpuQueue", () => ({ mediaQueueEnabled: () => mocked.durable, enqueueComfyMedia: mocked.enqueue, assertComfyMediaDispatch: mocked.assert, requireH3QualificationSharedQueue: mocked.requireQueue }));
vi.mock("@/lib/h3StudioQualification", () => ({ runH3StudioLeasedSubmission: mocked.approve }));
vi.mock("@/lib/h3QualificationBridgeRoute", () => ({ verifyH3QualificationBridgeRoute: mocked.checkBridge }));

const qualification: H3StudioLeasedSubmission = { jobId: "h3-direct-exact-test", ownerKey: "owner", process: { pid: 123, startTicks: "414", bootId: "boot-test" } };
const graph = { "39": { class_type: "MiniMaxH3ReferenceToVideo", inputs: { prompt: "exact" } } };
const input = () => ({ baseUrl: "http://gpu:8189", workerId: "h3-direct", ownerId: "queue-id", releaseIdlePeer: false, qualification,
  mediaQueueProducer: { kind: "direct" as const, id: qualification.jobId, ownerKey: qualification.ownerKey },
  init: { method: "POST", body: JSON.stringify({ prompt: graph }) }, fetcher: mocked.submit });

beforeEach(() => {
  vi.resetAllMocks(); mocked.held = false; mocked.durable = true; mocked.order = [];
  mocked.enqueue.mockResolvedValue(Response.json({ prompt_id: "queue-id" }, { status: 202 }));
  mocked.submit.mockImplementation(async () => { mocked.order.push("transport"); return Response.json({ prompt_id: "queue-id" }); });
  mocked.approve.mockImplementation(async () => { expect(mocked.held).toBe(true); mocked.order.push("approve"); });
  mocked.requireQueue.mockImplementation(() => { if (!mocked.durable) throw Error("No durable shared admission."); });
});

describe("qualification at the real Comfy submission boundary", () => {
  it("queues the exact guard without mistaking producer bookkeeping for GPU admission", async () => {
    expect((await submitComfyPromptWithGpuLease({ ...input(), beforeSubmit: async () => { expect(mocked.held).toBe(false); } })).status).toBe(202);
    expect(mocked.enqueue).toHaveBeenCalledWith(expect.objectContaining({ qualification, releaseIdlePeer: false, body: { prompt: graph } }), undefined);
    expect(mocked.approve).not.toHaveBeenCalled();
    expect(mocked.submit).not.toHaveBeenCalled();
  });

  it("checks the exact graph under the lease after stock readiness, then starts only one POST", async () => {
    await submitComfyPromptWithGpuLease({ ...input(), queueDispatch: true, init: { ...input().init, redirect: "follow" },
      beforeSubmit: async () => { expect(mocked.held).toBe(true); mocked.order.push("worker proof"); },
      onPostAttempt: () => { mocked.order.push("attempt"); } });
    expect(mocked.order).toEqual(["worker proof", "approve", "attempt", "transport"]);
    expect(mocked.approve).toHaveBeenCalledWith(qualification, graph);
    expect(mocked.assert).toHaveBeenCalledWith(expect.objectContaining({ qualification }));
    expect(mocked.submit).toHaveBeenCalledWith("http://gpu:8189/prompt", expect.objectContaining({ redirect: "error" }));
    expect(mocked.peer).not.toHaveBeenCalled();
  });

  it("fails before POST or peer work when the original authorization process/state is absent", async () => {
    mocked.approve.mockRejectedValue(Error("approval is no longer available"));
    const started = vi.fn();
    await expect(submitComfyPromptWithGpuLease({ ...input(), queueDispatch: true, onPostAttempt: started })).rejects.toThrow(/no longer available/);
    expect(started).not.toHaveBeenCalled(); expect(mocked.submit).not.toHaveBeenCalled(); expect(mocked.peer).not.toHaveBeenCalled();
  });

  it("performs the final fence read under the mutex and never sends if the grant has disappeared", async () => {
    await expect(submitComfyPromptWithGpuLease({ ...input(), queueDispatch: true, onPostAttempt: () => {
      expect(mocked.held).toBe(true); expect(mocked.order).toEqual(["approve"]);
      throw Error("The exact shared grant disappeared.");
    } })).rejects.toThrow(/grant disappeared/);
    expect(mocked.submit).not.toHaveBeenCalled();
  });

  it("refuses peer release or cleanup with a qualification request", async () => {
    await expect(submitComfyPromptWithGpuLease({ ...input(), releaseIdlePeer: true })).rejects.toThrow(/peer release and cleanup off/);
    await expect(submitComfyPromptWithGpuLease({ ...input(), preSubmitCleanup: "free" })).rejects.toThrow(/peer release and cleanup off/);
    expect(mocked.enqueue).not.toHaveBeenCalled(); expect(mocked.peer).not.toHaveBeenCalled();
  });

  it("fails closed on a disabled durable queue and an unverified authority before enqueue or transport", async () => {
    mocked.durable = false;
    await expect(submitComfyPromptWithGpuLease(input())).rejects.toThrow(/No durable shared admission/);
    mocked.durable = true; mocked.requireQueue.mockImplementation(() => { throw Error("Wrong canonical authority."); });
    await expect(submitComfyPromptWithGpuLease(input())).rejects.toThrow(/Wrong canonical authority/);
    expect(mocked.enqueue).not.toHaveBeenCalled(); expect(mocked.submit).not.toHaveBeenCalled();
  });

  it("checks the ordinary cast route again under the mutex before transport", async () => {
    const bridge = { build: "test-build", pid: 10, environment: "TEST", port: 3001 } as const;
    mocked.checkBridge.mockImplementation(async received => {
      expect(mocked.held).toBe(true); expect(received).toEqual(bridge);
      throw Error("Stale TEST bridge.");
    });
    await expect(submitComfyPromptWithGpuLease({ ...input(), qualification: undefined, characterVoicesBridgeRoute: bridge, queueDispatch: true })).rejects.toThrow(/Stale TEST bridge/);
    expect(mocked.submit).not.toHaveBeenCalled();
  });
});
