import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { EXPERIMENTS, DEFAULT_LAB_SETTINGS, canvas, labExperiment, isRetiredExperiment } from "@/lib/experiments/catalog";
import { createSession, getSession, listSessions, updateSession, validateSettings, labRoot, reserveAsset, withLab, MAX_ASSETS } from "@/lib/experiments/store";
import { parseRange } from "@/lib/experiments/range";
const auth = vi.hoisted(() => ({ result: { ok: true, id: "admin-a", status: 200 } as Record<string, unknown> }));
vi.mock("@/app/api/admin/_requireAdmin", () => ({ requireAdmin: async () => auth.result }));
import { GET, POST } from "@/app/api/experiments/route";
import { GET as mediaGet, POST as upload, HEAD as mediaHead } from "@/app/api/experiments/assets/route";

let fixture: string;
function request(url = "/api/experiments", data?: unknown, headers = {}) {
  return new NextRequest(`http://localhost:3001${url}`, { method: data === undefined ? "GET" : "POST", headers: { host: "localhost:3001", origin: "http://localhost:3001", ...(data !== undefined ? { "content-type": "application/json" } : {}), ...headers }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "slr-lab-unit-"));
  vi.stubEnv("OTG_ENV", "test"); vi.stubEnv("OTG_EXPERIMENTS_ROOT", path.join(fixture, "lab")); vi.stubEnv("OTG_DATA_DIR", path.join(fixture, "app-data"));
  auth.result = { ok: true, id: "admin-a", status: 200 };
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(fixture, { recursive: true, force: true }); });
describe("experimental boundary", () => {
  it("pins the two available checkpoints without executable overrides", () => {
    expect(EXPERIMENTS.filter(item => item.kind === "h3-admin").map(item => item.versionId)).toEqual([3441190,3429412]);
    expect(EXPERIMENTS.filter(item => item.kind === "testing")).toHaveLength(8);
    for (const item of EXPERIMENTS.filter(item => item.kind === "h3-admin")) expect(item.sha256).toMatch(/^[A-F0-9]{64}$/);
  });
  it("refuses PROD before creating any storage", async () => {
    vi.stubEnv("OTG_ENV", "prod"); expect((await GET(request())).status).toBe(404);
    expect((await POST(request(undefined, { action: "create", experiment: "prism-pika" }))).status).toBe(404);
    expect(fs.existsSync(path.join(fixture, "lab"))).toBe(false);
  });
  it.each([["dasiwa-v4",3391862],["pinkcherry-v18",3391975]] as const)("blocks retired %s creation before storage or worker access", async (model,version) => {
    expect(isRetiredExperiment(model)).toBe(true);
    expect(labExperiment(model)?.versionId).toBe(version);
    const result = await POST(request(undefined, { action: "create", experiment: model }));
    expect(result.status).toBe(409); expect(await result.text()).toContain("removed");
    expect(fs.existsSync(path.join(fixture, "lab"))).toBe(false);
  });
  it.each(["dasiwa-v4","pinkcherry-v18"])("rejects switching an available session to retired %s", async model => {
    const session = createSession("admin-a", "prism-pika");
    const result = await POST(request(undefined, { ...session, action: "update", experiment: model }));
    expect(result.status).toBe(409); expect(getSession("admin-a", session.id)).toEqual(session);
  });
  it.each([401,403])("requires administrator authorization (%s)", async status => {
    auth.result = { ok: false, status, error: "Not authorized" };
    for (const response of [await GET(request()), await POST(request(undefined, {})), await mediaGet(request("/api/experiments/assets?id=" + crypto.randomUUID())), await upload(request("/api/experiments/assets", {}))]) {
      expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(fs.existsSync(path.join(fixture, "lab"))).toBe(false);
  });
  it("rejects cross-site writes and oversized JSON", async () => {
    expect((await POST(request(undefined, {}, { origin: "https://evil.invalid" }))).status).toBe(403);
    expect((await POST(request(undefined, {}, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await POST(request(undefined, { prompt: "x".repeat(40000) }))).status).toBe(413);
  });
  it("keeps ordinary data and symlinked roots out of storage", () => {
    vi.stubEnv("OTG_EXPERIMENTS_ROOT", path.join(fixture, "app-data", "lab")); expect(() => labRoot()).toThrow("outside");
    const target = path.join(fixture, "target"); fs.mkdirSync(target, { mode: 0o700 }); fs.symlinkSync(target, path.join(fixture, "link"));
    vi.stubEnv("OTG_EXPERIMENTS_ROOT", path.join(fixture, "link")); expect(() => labRoot()).toThrow("not symlinked");
  });
  it("does not expose another administrator's records", () => {
    const record = createSession("admin-a", "prism-pika"); expect(listSessions("admin-b")).toEqual([]);
    expect(() => getSession("admin-b", record.id)).toThrow("not found");
    expect(() => getSession("admin-a", "../../secret")).toThrow("identifier");
  });
  it("round-trips settings, detects concurrent writes and archives reversibly", () => {
    const record = createSession("admin-a", "prism-pika");
    const updated = updateSession("admin-a", record.id, { ...record, title: "Controlled portrait", settings: { ...record.settings, seconds: 15, orientation: "portrait" }, archived: true });
    expect(updated.revision).toBe(2); expect(updated.archived).toBe(true); expect(canvas(updated.settings)).toEqual({ width: 352, height: 608 });
    expect(() => updateSession("admin-a", record.id, record)).toThrow("another window");
    expect(() => reserveAsset("admin-a", record.id, "a.png", "image/png", "source")).toThrow("Restore");
    expect(updateSession("admin-a", record.id, { ...updated, archived: false }).archived).toBe(false);
  });
  it.each([1,16,2.5,NaN])("rejects invalid duration %s", seconds => expect(() => validateSettings({ ...DEFAULT_LAB_SETTINGS, seconds })).toThrow());
  it("enforces per-plan upload reservations", () => {
    const record = createSession("admin-a", "pika-flex");
    for (let i=0; i<MAX_ASSETS; i++) reserveAsset("admin-a", record.id, "a.png", "image/png", "source");
    expect(() => reserveAsset("admin-a", record.id, "a.png", "image/png", "source")).toThrow("12 assets");
  });
  it("exports only a non-runnable owned manifest and refuses execution/promotion", async () => {
    const record = createSession("admin-a", "prism-pika"); const result = await GET(request(`/api/experiments?export=${record.id}`));
    expect((await result.json()).runnable).toBe(false); expect(result.headers.get("content-disposition")).toContain("attachment");
    for (const action of ["generate", "promote"]) expect((await POST(request(undefined, { action, id: record.id }))).status).toBe(409);
  });
});
describe("private media", () => {
  async function pngUpload() {
    const record = createSession("admin-a", "prism-pika");
    const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#228899" } }).png().toBuffer();
    const result = await upload(new NextRequest(`http://localhost:3001/api/experiments/assets?session=${record.id}&name=fixture.png&role=source`, { method: "POST", headers: { host: "localhost:3001", origin: "http://localhost:3001", "content-type": "image/png" }, body: new Uint8Array(bytes) }));
    expect(result.status).toBe(201); return { bytes, asset: (await result.json()).session.assets[0] };
  }
  it("validates real media, hashes it and supports byte-range downloads", async () => {
    const { bytes, asset } = await pngUpload(); expect(asset.sha256).toBe(crypto.createHash("sha256").update(bytes).digest("hex"));
    const url = "/api/experiments/assets?id=" + asset.id;
    const range = await mediaGet(request(url, undefined, { range: "bytes=0-7" })); expect(range.status).toBe(206); expect(Buffer.from(await range.arrayBuffer())).toEqual(bytes.subarray(0,8));
    const head = await mediaHead(new NextRequest("http://localhost:3001"+url, { method: "HEAD" })); expect(head.headers.get("content-length")).toBe(String(bytes.length)); expect(await head.text()).toBe("");
    expect((await mediaGet(request(url, undefined, { range: "bytes=99999-" }))).status).toBe(416);
    auth.result = { ok: true, id: "admin-b", status: 200 }; expect((await mediaGet(request(url))).status).toBe(404);
  });
  it.each(["dasiwa-v4","pinkcherry-v18"])("keeps retired %s drafts, exports and media readable while blocking generation and preserving inputs on model change", async model => {
    const { bytes, asset } = await pngUpload();
    let session = getSession("admin-a", asset.session);
    session = updateSession("admin-a", session.id, { ...session, settings: { ...session.settings, prompt: "My saved scene.", selectedSources: [asset.id] } });
    // Simulate a pre-retirement row, never a new executable retired session.
    withLab(db => db.prepare("UPDATE sessions SET experiment=? WHERE id=?").run(model, session.id));
    session = getSession("admin-a", session.id);
    const listing = await (await GET(request())).json();
    expect(listing.catalog.some((item: {id:string}) => item.id === model)).toBe(false);
    expect(listing.capabilities.some((item: {model:string}) => item.model === model)).toBe(false);
    expect(listing.sessions.find((item: {id:string}) => item.id === session.id).settings.prompt).toBe("My saved scene.");
    expect((await GET(request(`/api/experiments?export=${session.id}`))).status).toBe(200);
    const generated = await POST(request(undefined, { action: "generate", id: session.id, requestId: crypto.randomUUID() }));
    expect(generated.status).toBe(409); expect(await generated.text()).toContain("removed");
    expect(fs.existsSync(path.join(labRoot(), "jobs"))).toBe(false);
    const media = await mediaGet(request("/api/experiments/assets?id=" + asset.id));
    expect(media.status).toBe(200); expect(Buffer.from(await media.arrayBuffer())).toEqual(bytes);
    const changed = updateSession("admin-a", session.id, { ...session, experiment: "eros-beta7" });
    expect(changed.id).toBe(session.id); expect(changed.settings).toEqual(session.settings); expect(changed.assets).toEqual(session.assets);
    auth.result = { ok: true, id: "admin-b", status: 200 };
    expect((await mediaGet(request("/api/experiments/assets?id=" + asset.id))).status).toBe(404);
  });
  it("rejects mislabeled content and frees its reservation/file", async () => {
    const record = createSession("admin-a", "prism-pika");
    const result = await upload(new NextRequest(`http://localhost:3001/api/experiments/assets?session=${record.id}`, { method: "POST", headers: { host: "localhost:3001", origin: "http://localhost:3001", "content-type": "image/png" }, body: "not an image" }));
    expect(result.status).toBe(415); expect(getSession("admin-a", record.id).assets).toEqual([]);
    expect(fs.readdirSync(labRoot()).filter(name => name.endsWith(".media"))).toEqual([]);
  });
  it("refuses a substituted symlink at media delivery", async () => {
    const { asset } = await pngUpload(); const file = path.join(labRoot(), asset.id + ".media");
    fs.unlinkSync(file); fs.symlinkSync("/etc/hostname", file);
    const response=await mediaGet(request("/api/experiments/assets?id="+asset.id));expect(response.status).toBe(409);expect(await response.text()).not.toMatch(/hostname|root:/);
  });
  it("parses suffix and bounded ranges without accepting multi-range attacks", () => {
    expect(parseRange("bytes=-5", 10)).toEqual({ start: 5, end: 9 }); expect(parseRange("bytes=3-200", 10)).toEqual({ start: 3, end: 9 });
    for (const value of ["bytes=-0", "bytes=10-", "bytes=4-2", "bytes=0-1,2-3", "bytes=-"]) expect(() => parseRange(value,10)).toThrow();
  });
});
