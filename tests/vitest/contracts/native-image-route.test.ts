import {beforeEach, afterAll, describe, expect, it, vi} from "vitest";
import {NextRequest} from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
const mocks = vi.hoisted(() => ({owner: vi.fn(), backend: vi.fn(), submit: vi.fn(), queue: vi.fn(), status: vi.fn(), source: vi.fn(), cancel: vi.fn()}));
vi.mock("@/lib/ownerKey", () => ({getOwnerContext: mocks.owner}));
vi.mock("@/lib/images/nativeImageBackend", () => ({chooseNativeImageBackend: mocks.backend}));
vi.mock("@/lib/workers/comfyPromptLease", () => ({submitComfyPromptWithGpuLease: mocks.submit}));
vi.mock("@/lib/workers/mediaGpuQueue", () => ({getMediaQueueJob: mocks.queue}));
vi.mock("@/lib/comfyImageOutputLookup", () => ({resolveComfyPromptImageStatus: mocks.status}));
vi.mock("@/app/api/file/route", () => ({GET: mocks.source}));
vi.mock("@/lib/comfySafeCancel", () => ({cancelComfyPrompt: mocks.cancel}));
const root = await fs.mkdtemp(path.join(os.tmpdir(), "slr-native-image-contract-"));
vi.stubEnv("OTG_DATA_DIR", root);
vi.stubEnv("OTG_ENV", "test");
const {POST, GET, DELETE} = await import("@/app/api/images/native/route");
const url = "http://localhost:3001/api/images/native";
const post = (body: Record<string, unknown>) => POST(new NextRequest(url, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}));
const valid = {model: "fibo2-dev", prompt: "A detailed cafe", width: 1024, height: 1024, seed: 0};
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("OTG_ENV", "test"); vi.stubEnv("OTG_PRIVATE_RESEARCH_MEDIA", "0");
  mocks.owner.mockResolvedValue({ownerKey: "qa_owner"});
  mocks.backend.mockResolvedValue({baseUrl: "http://100.98.212.116:8188"});
  mocks.queue.mockReturnValue(null);
  mocks.submit.mockImplementation(async args => {
    const promptId = randomUUID(); await args.onPromptAccepted?.(promptId); return Response.json({prompt_id: promptId}, {status: 202});
  });
});
afterAll(async () => {vi.unstubAllEnvs(); await fs.rm(root, {recursive: true, force: true});});
describe("Native image API safety and exact graph submission", () => {
  it("cannot enable itself on an unconfigured production server", async () => {
    vi.stubEnv("OTG_ENV", "prod"); expect((await post(valid)).status).toBe(404); expect(mocks.owner).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it.each(["prod", "production"])("honors the approved %s private-research policy without changing model settings", async environment => {
    vi.stubEnv("OTG_ENV", environment); vi.stubEnv("OTG_PRIVATE_RESEARCH_MEDIA", "1");
    const response = await post(valid);
    expect(response.status).toBe(202); expect(await response.json()).toMatchObject({model: "fibo2-dev", steps: 50, seed: 0});
    expect(mocks.owner).toHaveBeenCalled();
  });
  it("requires an authenticated owner before reaching either worker", async () => {
    mocks.owner.mockRejectedValueOnce(Object.assign(Error("Unauthorized"), {status: 401}));
    expect((await post(valid)).status).toBe(401); expect(mocks.backend).not.toHaveBeenCalled();
  });
  it.each([{model: "bria-api"}, {prompt: ""}, {width: 1080}, {model: "fibo2-edit-turbo"}, {seed: -1}])("rejects invalid or missing components %j before submission", async invalid => {
    expect((await post({...valid, ...invalid})).status).toBe(400); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("submits the precise Dev graph through the shared physical queue without cleanup or peer restarts", async () => {
    const response = await post(valid), result = await response.json();
    expect(response.status).toBe(202); expect(result).toMatchObject({status: "queued", steps: 50, seed: 0, outputNodeId: "461"});
    const args = mocks.submit.mock.calls[0][0], graph = JSON.parse(args.init.body).prompt;
    expect(args).toMatchObject({mediaQueueScope: true, purpose: "image", baseUrl: "http://100.98.212.116:8188"});
    expect(args.preSubmitCleanup).toBeUndefined(); expect(args.releaseIdlePeer).toBeUndefined();
    expect(graph["458"].inputs).toMatchObject({steps: 50, cfg: 5, sampler_name: "euler"});
    expect(graph["461"].inputs.filename_prefix).toContain("qa_owner");
  });
  it.each(["imageB", "imageC", "imageBPath", "imageCPath", "referenceImages"])("rejects extra %s references instead of ignoring them", async key => {
    expect((await post({...valid, [key]: "/owned/extra.png"})).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("an owner retry recovers the original job instead of duplicating GPU work", async () => {
    const clientRequestId = randomUUID();
    const first = await (await post({...valid, clientRequestId})).json();
    const second = await (await post({...valid, clientRequestId})).json();
    expect(second.promptId).toBe(first.promptId); expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("does not allow arbitrary filesystem inputs or reading another owner's job", async () => {
    mocks.source.mockResolvedValueOnce(Response.json({error: "Not found"}, {status: 404}));
    expect((await post({...valid, imageAPath: "/etc/passwd"})).status).toBe(403);
    expect(mocks.submit).not.toHaveBeenCalled();
    const job = await (await post(valid)).json();
    mocks.owner.mockResolvedValueOnce({ownerKey: "another_owner"});
    expect((await GET(new NextRequest(url + "?jobId=" + job.jobId))).status).toBe(404);
  });
  it("propagates a durable queue failure rather than polling forever", async () => {
    const job = await (await post(valid)).json();
    mocks.queue.mockReturnValueOnce({status: "failed", error: "CUDA allocation failed"});
    const response = await GET(new NextRequest(url + "?jobId=" + job.jobId));
    expect(await response.json()).toMatchObject({status: "failed", error: "CUDA allocation failed"});
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it("cancels only the authenticated owner's exact prompt through the existing atomic cancellation helper", async () => {
    const job = await (await post(valid)).json();
    mocks.cancel.mockResolvedValueOnce({status: "canceled", mode: "queued"});
    const response = await DELETE(new NextRequest(url + "?jobId=" + job.jobId));
    expect(await response.json()).toMatchObject({status: "canceled"});
    expect(mocks.cancel).toHaveBeenCalledWith("http://100.98.212.116:8188", job.promptId);
    mocks.owner.mockResolvedValueOnce({ownerKey: "another_owner"});
    expect((await DELETE(new NextRequest(url + "?jobId=" + job.jobId))).status).toBe(404);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });
});
