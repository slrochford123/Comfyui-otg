import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/paths", () => ({ get OTG_DATA_ROOT() { return fixture.root; } }));
import { registerStudioMedia, publicStudioMedia, readStudioMedia, resolveStudioMedia, updateStudioMedia, removeStudioMedia, validateStudioMediaPlan, studioPlannerReferences } from "@/lib/h3StudioMedia";
import { createStudioReview, validateStudioReview, claimStudioReview, studioReviewedExecutionDigest } from "@/lib/h3StudioReview";
import { studioBoundCompilerInput } from "@/lib/h3StudioMedia";
import { compileH3StudioPlan } from "@/lib/h3StudioCompiler";
import { createStudioPlannerConsent, consumeStudioPlannerConsent } from "@/lib/h3StudioPlannerConsent";
import { DEFAULT_H3_STUDIO_PLAN } from "@/lib/h3StudioPlan";
import { readH3StudioJson } from "@/lib/h3StudioRequests";
const plan = { ...DEFAULT_H3_STUDIO_PLAN, originalPrompt: "A red kite", prompt: "A red kite" };
async function image(color = "red") {
  return new File([new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: color } }).png().toBuffer())], "reference.png", { type: "image/png" });
}
beforeEach(async () => { vi.stubEnv("OTG_ENV", "test"); fixture.root = await fs.mkdtemp(path.join(os.tmpdir(), "h3-studio-identity-")); });
afterEach(async () => { await fs.rm(fixture.root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
describe("immutable owner/session H3 media identity", () => {
  it("assigns server identities and rejects a different owner/session", async () => {
    const asset = await registerStudioMedia("ownerA", "sessionA", await image());
    expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/); expect(asset.version).toBe(1);
    await expect(readStudioMedia("ownerB", "sessionA", asset.id)).rejects.toThrow();
    await expect(readStudioMedia("ownerA", "sessionB", asset.id)).rejects.toThrow();
    const publicText = JSON.stringify(publicStudioMedia(asset)); expect(publicText).not.toContain("sessionA"); expect(publicText).not.toContain(fixture.root); expect(publicText).not.toContain('"filename"');
  });
  it("invalidates exact plan review on a same-count media replacement", async () => {
    const a = await registerStudioMedia("owner", "session", await image()); const b = await registerStudioMedia("owner", "session", await image("blue"));
    const first = await resolveStudioMedia("owner", "session", [a.id], true); const second = await resolveStudioMedia("owner", "session", [b.id], true);
    expect(first.fingerprint).not.toBe(second.fingerprint);
    const review = await createStudioReview("owner", "session", plan, first.fingerprint, "config", "graph");
    await expect(validateStudioReview("owner", "session", review.id, plan, second.fingerprint, "config", "graph")).rejects.toThrow(/changed/);
  });
  it("binds role/description/start/audio settings and ordered references", async () => {
    const a = await registerStudioMedia("owner", "session", await image()); const b = await registerStudioMedia("owner", "session", await image("blue"));
    const original = await resolveStudioMedia("owner", "session", [a.id, b.id]);
    expect((await resolveStudioMedia("owner", "session", [b.id, a.id])).fingerprint).not.toBe(original.fingerprint);
    await updateStudioMedia("owner", "session", a.id, { role: "first", description: "red identity" });
    const latest = await resolveStudioMedia("owner", "session", [a.id, b.id]); expect(latest.items[0].asset.version).toBe(2); expect(latest.fingerprint).not.toBe(original.fingerprint);
  });
  it("rechecks actual bytes even if an on-disk file retains its byte count", async () => {
    const a = await registerStudioMedia("owner", "session", await image()); const record = await readStudioMedia("owner", "session", a.id);
    const bytes = await fs.readFile(record.path); bytes[bytes.length - 1] ^= 1; await fs.writeFile(record.path, bytes);
    await expect(readStudioMedia("owner", "session", a.id, true)).rejects.toThrow(/content changed/);
  });
  it("denies traversal, duplicate identities and forged asset fields", async () => {
    await expect(readStudioMedia("owner", "session", "../../other")).rejects.toThrow();
    const a = await registerStudioMedia("owner", "session", await image());
    await expect(resolveStudioMedia("owner", "session", [a.id, a.id])).rejects.toThrow();
    await expect(updateStudioMedia("owner", "session", a.id, { filename: "/private" })).rejects.toThrow(/Unsupported/);
  });
  it("rejects renamed SVG/script data rather than advertising a fake image", async () => {
    await expect(registerStudioMedia("owner", "session", new File(["<svg><script>alert(1)</script></svg>"], "fake.png"))).rejects.toThrow();
  });
  it("keeps external reference content local until explicit media consent", async () => {
    const a = await registerStudioMedia("owner", "session", await image()); const refs = await resolveStudioMedia("owner", "session", [a.id]);
    const local = await studioPlannerReferences(refs, false); expect(local.images).toEqual([]); expect(local.contentSent).toBe(false);
    const consented = await studioPlannerReferences(refs, true); expect(consented.images).toHaveLength(1); expect(consented.images[0]).toMatch(/^data:image\/jpeg;base64,/); expect(JSON.stringify(consented.metadata)).not.toContain(fixture.root);
  });
  it("rejects media/workflow mismatches and allows removal only to the owner", async () => {
    const a = await registerStudioMedia("owner", "session", await image()); const refs = await resolveStudioMedia("owner", "session", [a.id]);
    expect(() => validateStudioMediaPlan(plan, refs)).toThrow(/does not consume/);
    await expect(removeStudioMedia("other", "session", a.id)).rejects.toThrow(); await removeStudioMedia("owner", "session", a.id);
    await expect(readStudioMedia("owner", "session", a.id)).rejects.toThrow();
  });
  it("allows only one generation claim for the same review", async () => {
    const review = await createStudioReview("owner", "session", plan, "media", "config", "graph");
    const attempts = await Promise.allSettled([claimStudioReview("owner", review.id), claimStudioReview("owner", review.id)]);
    expect(attempts.filter(a => a.status === "fulfilled")).toHaveLength(1);
  });
  it("keeps exact prompt/seed and estimates bound separately from filename substitution", async () => {
    const graph = { x: { class_type: "LoadImage", inputs: { image: "before.png" } }, y: { class_type: "RandomNoise", inputs: { noise_seed: 4 } } };
    expect(studioReviewedExecutionDigest(graph)).toBe(studioReviewedExecutionDigest({ ...graph, x: { ...graph.x, inputs: { image: "worker-upload.png" } } }));
    expect(studioReviewedExecutionDigest(graph)).not.toBe(studioReviewedExecutionDigest({ ...graph, y: { ...graph.y, inputs: { noise_seed: 5 } } }));
    const receipt = { executionDigest: studioReviewedExecutionDigest(graph), credits: 1, seconds: 20 };
    const review = await createStudioReview("owner", "session", plan, "media", "config", "graph", receipt);
    await expect(validateStudioReview("owner", "session", review.id, plan, "media", "config", "graph", { ...receipt, credits: 2 })).rejects.toThrow(/estimate/);
  });
  it("compiles actual image/audio topology using complete shared reference slots and prompt tags", async () => {
    const a = await registerStudioMedia("owner", "session", await image());
    const media = await resolveStudioMedia("owner", "session", [a.id]);
    const request = { ...plan, workflowId: "native-r2v" as const };
    const input = studioBoundCompilerInput(request, media);
    expect(input.references?.[0]).toMatchObject({ pictureSlot: 1, subjectSlot: 1, workflowImage: a.id });
    expect(input.finalPrompt).toContain("<Picture 1> / <Subject 1>");
    const result = compileH3StudioPlan(request, input, { nodes: new Set(), models: new Set(), loras: new Set(), observedAt: new Date().toISOString() }, null);
    expect(result.graph["39"].class_type).toBe("MiniMaxH3ReferenceToVideo");
    expect(result.manifest.executable).toBe(false);
  });
  it("allows authorized deletion after expiry and enforces aggregate temporary storage", async () => {
    const a = await registerStudioMedia("owner", "session", await image()); const record = await readStudioMedia("owner", "session", a.id);
    const metadata = path.join(path.dirname(record.path), "asset.json");
    await fs.writeFile(metadata, JSON.stringify({ ...record.asset, expiresAt: Date.now() - 1 }));
    await expect(readStudioMedia("owner", "session", a.id)).rejects.toThrow(/expired/);
    await removeStudioMedia("owner", "session", a.id);
    vi.stubEnv("OTG_H3_STUDIO_MEDIA_MAX_OWNER_BYTES", "1024");
    let rejected = false;
    for (let i = 0; i < 32; i++) { try { await registerStudioMedia("owner", "session", await image()); } catch (error) { expect(String(error)).toMatch(/storage is full/); rejected = true; break; } }
    expect(rejected).toBe(true);
  });
  it("binds planner payment consent to the exact owner/session/media/request and consumes it once", async () => {
    const request = { plan, mediaFingerprint: "mediaA", externalMediaConsent: false, estimate: .01 };
    const id = await createStudioPlannerConsent("owner", "session", request);
    await expect(consumeStudioPlannerConsent("owner", "session", id, { ...request, externalMediaConsent: true }, true)).rejects.toThrow(/changed/);
    await expect(consumeStudioPlannerConsent("owner", "other", id, request, true)).rejects.toThrow();
    await expect(consumeStudioPlannerConsent("owner", "session", id, request, false)).rejects.toThrow(/Explicit/);
    await consumeStudioPlannerConsent("owner", "session", id, request, true);
    await expect(consumeStudioPlannerConsent("owner", "session", id, request, true)).rejects.toThrow();
  });
  it("bounds streamed bytes without trusting a missing Content-Length", async () => {
    const req = new Request("http://localhost", { method: "POST", body: JSON.stringify({ large: "x".repeat(1000) }) });
    await expect(readH3StudioJson(req, 100)).rejects.toThrow(/large/);
  });
});
