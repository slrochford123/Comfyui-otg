import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
let root: string, source: string, api: typeof import("@/lib/h3VideoTrim");
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "slr-private-trim-"));
  vi.stubEnv("OTG_DATA_DIR", root); vi.resetModules(); api = await import("@/lib/h3VideoTrim");
  source = path.join(root, "fixture.mp4");
  execFileSync("ffmpeg", ["-nostdin", "-y", "-f", "lavfi", "-i", "testsrc2=size=96x64:rate=24:duration=4", "-c:v", "libx264", "-preset", "ultrafast", source], { stdio: "ignore", timeout: 10000 });
});
afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); if (root) await fs.rm(root, { recursive: true, force: true }); });
describe("real private video assets", () => {
  it("another owner or session cannot read the same unpredictable ID", async () => {
    const asset = await api.registerVideoTrim("owner-A", "session-A", source, "fixture.mp4");
    expect((await api.readVideoTrim("owner-A", "session-A", asset.id)).asset.duration).toBe(4);
    await expect(api.readVideoTrim("owner-B", "session-A", asset.id)).rejects.toThrow();
    await expect(api.readVideoTrim("owner-A", "session-B", asset.id)).rejects.toThrow();
    const exposed = api.publicVideoTrim(asset);
    expect(JSON.stringify(exposed)).not.toContain(root); expect(exposed).not.toHaveProperty("session"); expect(exposed).not.toHaveProperty("filename");
  });
  it("server re-probes source and rejects bounds forged beyond actual duration", async () => {
    const asset = await api.registerVideoTrim("owner-A", "session-A", source, "fixture.mp4");
    const meta = path.join(api.videoTrimDirectory("owner-A", asset.id), "asset.json");
    await fs.writeFile(meta, JSON.stringify({ ...asset, duration: 1000 }));
    await expect(api.trimVideoAsset("owner-A", "session-A", asset.id, 10, 15, new AbortController().signal)).rejects.toThrow(/Select/);
  });
  it("cancel removes partial trim/lock, preserves original, and permits retry", async () => {
    const asset = await api.registerVideoTrim("owner-A", "session-A", source, "fixture.mp4");
    const controller = new AbortController(); controller.abort();
    await expect(api.trimVideoAsset("owner-A", "session-A", asset.id, 1, 3, controller.signal)).rejects.toThrow();
    const directory = api.videoTrimDirectory("owner-A", asset.id);
    await expect(fs.stat(path.join(directory, "trimming"))).rejects.toThrow();
    const result = await api.trimVideoAsset("owner-A", "session-A", asset.id, 1, 3, new AbortController().signal);
    expect(result.duration).toBeCloseTo(2, 1); expect(result.id).not.toBe(asset.id);
    expect((await fs.stat(path.join(directory, "source.mp4"))).size).toBeGreaterThan(0);
  });
  it("expired assets are denied and expiry cleanup removes only managed media", async () => {
    const asset = await api.registerVideoTrim("owner-A", "session-A", source, "fixture.mp4");
    const dir = api.videoTrimDirectory("owner-A", asset.id);
    const old = new Date(Date.now() - api.VIDEO_TRIM_TTL_MS - 1000); await fs.utimes(dir, old, old);
    await api.pruneVideoTrims("owner-A"); await expect(fs.stat(dir)).rejects.toThrow(); expect((await fs.stat(source)).isFile()).toBe(true);
  });
});
