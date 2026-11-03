import {afterAll, beforeEach, describe, expect, it, vi} from "vitest";
import {NextRequest} from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import sharp from "sharp";
const mocks = vi.hoisted(() => ({native: vi.fn(), qwen: vi.fn(), read: vi.fn(), save: vi.fn(), owner: vi.fn(), queue: vi.fn(), status: vi.fn(), meta: vi.fn(), image: vi.fn(), proxy: vi.fn(), gallery: vi.fn(), writeMeta: vi.fn()}));
vi.mock("@/app/api/images/native/route", () => ({POST: mocks.native, GET: mocks.read, PATCH: mocks.save}));
vi.mock("@/app/api/comfy/route", () => ({POST: mocks.qwen}));
vi.mock("@/lib/ownerKey", () => ({getOwnerContext: mocks.owner, SessionInvalidError: class SessionInvalidError extends Error {}}));
vi.mock("@/lib/workers/mediaGpuQueue", () => ({getMediaQueueJob: mocks.queue}));
vi.mock("@/lib/comfyImageOutputLookup", () => ({resolveComfyPromptImageStatus: mocks.status}));
vi.mock("@/lib/comfyMediaAccess", () => ({ownedHistoryImage: mocks.image, ownedPromptMeta: mocks.meta, proxyOwnedWorkerMedia: mocks.proxy}));
vi.mock("@/lib/gallery", () => ({getGallerySourcesForRequest: mocks.gallery, writeMetaForFile: mocks.writeMeta, clearGalleryListCache: vi.fn()}));
const root = await fs.mkdtemp(path.join(os.tmpdir(), "slr-before-after-"));
vi.stubEnv("OTG_DATA_DIR", root); vi.stubEnv("OTG_DATA_ROOT", root);
const {POST, GET, PATCH} = await import("@/app/api/images/before-after/route");
const store = await import("@/lib/images/beforeAfter");
const {comparisonPending, freshComparisonSeed, newComparisonJob, submitComparison} = await import("@/lib/client/beforeAfter");
const url = "http://localhost:3001/api/images/before-after", owner = {ownerKey: "before_after_qa", scope: "user", username: "before_after_qa", deviceId: "qa"};
const png = await sharp({create: {width: 80, height: 100, channels: 3, background: "white"}}).png().toBuffer();
function post(id = randomUUID(), engine = "qwen", origin = "http://localhost:3001") {
  const body = new FormData(); body.set("clientRequestId", id); body.set("engine", engine); body.set("seed", "12"); body.set("prompt", "Make the suit black.");
  body.set("image", new File([new Uint8Array(png)], "original.png", {type: "image/png"}));
  return POST(new NextRequest(url, {method: "POST", headers: {origin}, body}));
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.owner.mockResolvedValue(owner); mocks.queue.mockReturnValue(null);
  mocks.native.mockResolvedValue(Response.json({promptId: "native-prompt"}, {status: 202}));
  mocks.qwen.mockResolvedValue(Response.json({prompt_id: "qwen-prompt"}, {status: 202}));
  mocks.read.mockResolvedValue(Response.json({status: "queued", promptId: "native-prompt"}));
  mocks.meta.mockReturnValue({comfyBaseUrl: "http://100.75.162.64:8188"}); mocks.status.mockResolvedValue({status: "running"});
});
afterAll(async () => {vi.unstubAllEnvs(); await fs.rm(root, {recursive: true, force: true});});
describe("Before & After durable image edits", () => {
  it.each(["qwen", "fibo2-edit-turbo", "fibo2-dev"])("submits %s once, without auto-saving or changing the exact prompt", async engine => {
    const id = randomUUID(); expect((await post(id, engine)).status).toBe(202); expect((await post(id, engine)).status).toBe(202);
    const submit = engine === "qwen" ? mocks.qwen : mocks.native;
    expect(submit).toHaveBeenCalledTimes(1);
    const form = await submit.mock.calls[0][0].formData();
    expect(form.get("saveToGallery")).toBe("false"); expect(form.get("save_to_gallery")).toBe("false"); expect(form.get("prompt")).toBe("Make the suit black.");
    expect(form.get(engine === "qwen" ? "imageA" : "image")).toBeInstanceOf(File);
    expect((form.get(engine === "qwen" ? "imageA" : "image") as File).name).toContain(owner.ownerKey + "-" + id);
    if (engine === "qwen") expect(form.get("workflowId")).toBe("presets/image_qwen_image_2_1_image_edit");
    else expect(form.get("clientRequestId")).toBe(id);
  });
  it("restores the same accepted job without another POST", async () => {
    const id = randomUUID(); await post(id); const response = await GET(new NextRequest(url + "?jobId=" + id));
    expect(await response.json()).toMatchObject({jobId: id, status: "running", promptId: "qwen-prompt"}); expect(mocks.qwen).toHaveBeenCalledTimes(1);
  });
  it("records Qwen's actual execution seed instead of the requested seed", async () => {
    mocks.qwen.mockResolvedValueOnce(Response.json({prompt_id: "seed-proof", qwenTurbo: {seed: 12345}}, {status: 202}));
    expect(await (await post()).json()).toMatchObject({seed: 12345});
  });
  it("accepts a 48-megapixel phone image and only reduces the inference copy without cropping", async () => {
    const large = await sharp({create: {width: 6000, height: 8000, channels: 3, background: "white"}}).png().toBuffer();
    const body = new FormData(); body.set("clientRequestId", randomUUID()); body.set("engine", "fibo2-edit-turbo"); body.set("seed", "1"); body.set("prompt", "Black suit");
    body.set("image", new File([new Uint8Array(large)], "phone.png", {type: "image/png"}));
    expect((await POST(new NextRequest(url, {method: "POST", body}))).status).toBe(202);
    const submitted = await mocks.native.mock.calls[0][0].formData();
    const metadata = await sharp(Buffer.from(await (submitted.get("image") as File).arrayBuffer())).metadata();
    expect([metadata.width, metadata.height]).toEqual([1152,1536]);
  });
  it("cannot read or save another owner's comparison", async () => {
    const id = randomUUID(); await post(id); mocks.owner.mockResolvedValue({...owner, ownerKey: "different_owner"});
    expect((await GET(new NextRequest(url + "?jobId=" + id))).status).toBe(404);
    expect((await PATCH(new NextRequest(url + "?jobId=" + id, {method: "PATCH"}))).status).toBe(404);
  });
  it("rejects cross-origin writes before contacting either GPU service", async () => {
    expect((await post(randomUUID(), "qwen", "https://bad.invalid")).status).toBe(403); expect(mocks.qwen).not.toHaveBeenCalled(); expect(mocks.native).not.toHaveBeenCalled();
  });
  it("rejects malformed IDs and engines without queueing", async () => {
    expect((await post("../../escape")).status).toBe(400); expect((await post(randomUUID(), "unknown-model")).status).toBe(400); expect(mocks.qwen).not.toHaveBeenCalled();
  });
  it("preserves an unknown submission instead of silently resubmitting", async () => {
    mocks.qwen.mockRejectedValueOnce(Error("connection lost")); const id = randomUUID();
    expect(await (await post(id)).json()).toMatchObject({status: "unknown"});
    expect(await (await GET(new NextRequest(url + "?jobId=" + id))).json()).toMatchObject({status: "unknown"});
    await post(id); expect(mocks.qwen).toHaveBeenCalledTimes(1);
  });
  it("does not rewrite a pending Qwen receipt while submission is in progress", async () => {
    const job = {id: randomUUID(), engine: "qwen" as const, prompt: "Edit", seed: 1, createdAt: "now", status: "submitting"};
    await store.claimBeforeAfterJob(owner.ownerKey, job);
    expect(await (await GET(new NextRequest(url + "?jobId=" + job.id))).json()).toMatchObject({status: "submitting"});
    expect(mocks.status).not.toHaveBeenCalled(); expect((await store.readBeforeAfterJob(owner.ownerKey, job.id)).promptId).toBeUndefined();
  });
  it("keeps failed attempts separate and permits a new seeded attempt", async () => {
    mocks.qwen.mockResolvedValueOnce(Response.json({error: "Unsupported image"}, {status: 400}));
    const first = randomUUID(), second = randomUUID(); expect(await (await post(first)).json()).toMatchObject({status: "failed"});
    expect(await (await post(second)).json()).toMatchObject({status: "queued"}); expect(mocks.qwen).toHaveBeenCalledTimes(2);
  });
  it("only saves a completed job and downloads the exact persisted edit", async () => {
    const id = randomUUID(); await post(id); expect((await PATCH(new NextRequest(url + "?jobId=" + id, {method: "PATCH"}))).status).toBe(409);
    mocks.status.mockResolvedValue({status: "completed"}); mocks.image.mockResolvedValue({baseUrl: "http://worker", image: {filename: "done.png"}}); mocks.proxy.mockResolvedValue(new Response(new Uint8Array(png)));
    const output = await (await GET(new NextRequest(url + "?jobId=" + id))).json(); expect(output.imageUrl).toContain(id);
    const downloaded = await GET(new NextRequest(url + "?jobId=" + id + "&image=1&download=1"));
    expect(downloaded.headers.get("content-disposition")).toContain("attachment"); expect((await downloaded.arrayBuffer()).byteLength).toBeGreaterThan(0);
    const gallery = path.join(root, "gallery"); mocks.gallery.mockResolvedValue({sources: [{dir: gallery, scope: "user"}]});
    for (let i = 0; i < 2; i++) expect((await PATCH(new NextRequest(url + "?jobId=" + id, {method: "PATCH"}))).status).toBe(200);
    expect((await fs.readdir(gallery)).filter(name => name.endsWith(".png"))).toHaveLength(1);
    expect(mocks.qwen).toHaveBeenCalledTimes(1); expect(mocks.writeMeta).toHaveBeenCalled();
  });
  it("never puts raw server paths into public comparison state", () => {
    expect(store.publicBeforeAfterJob({id: randomUUID(), engine: "qwen", prompt: "edit", seed: 0, createdAt: "now", status: "completed", imagePath: "/private/file.png"})).not.toHaveProperty("imagePath");
  });
});
describe("Before & After client contract", () => {
  it.each(["submitting", "queued", "running", "unknown"])("blocks duplicate renders during %s", status => expect(comparisonPending({jobId: "id", engine: "qwen", seed: 1, status})).toBe(true));
  it.each(["completed", "failed", "canceled"])("allows a new attempt after %s", status => expect(comparisonPending({jobId: "id", engine: "qwen", seed: 1, status})).toBe(false));
  it("always changes the seed on Try Again, even on a random collision", () => {
    const random = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(bytes => {new Uint32Array(bytes!.buffer).fill(12); return bytes;});
    expect(freshComparisonSeed(12)).toBe(13); random.mockRestore();
  });
  it("supports Android HTTP without crypto.randomUUID", () => expect(newComparisonJob("qwen").jobId).toMatch(/^[a-f0-9-]{36}$/));
  it("submits the preserved original and checks exact response identity", async () => {
    const job = newComparisonJob("qwen"), source = new File(["original"], "original.png");
    const fetcher = vi.fn().mockResolvedValue(Response.json({...job, status: "queued"}));
    await submitComparison(job, source, "Black suit", fetcher);
    const form = fetcher.mock.calls[0][1].body as FormData; expect(form.get("image")).toBe(source); expect(form.get("seed")).toBe(String(job.seed));
    fetcher.mockResolvedValue(Response.json({...job, jobId: "unrelated"})); await expect(submitComparison(job, source, "Black suit", fetcher)).rejects.toThrow(/did not match/);
  });
});
