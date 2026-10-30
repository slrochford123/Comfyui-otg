// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {H3RecoveryClient, H3RecoveryError, h3RecoveryMessage} from "@/lib/client/h3Recovery";
const json = (data: unknown, status = 200) => Response.json(data, {status});
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());
describe("H3 recovery transport and preserved references", () => {
  it("checks login and the actual app before a new generation", async () => {
    const fetcher = vi.fn(async () => json({ok: true})), client = new H3RecoveryClient("owner", "legacy", fetcher);
    await client.ready(); expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/api/auth/me", "/api/healthz"]);
  });
  it("reports expired login distinctly rather than blaming file size", async () => {
    const fetcher = vi.fn(async () => json({error: "Unauthorized"}, 401)), client = new H3RecoveryClient("owner", "legacy", fetcher);
    await expect(client.ready()).rejects.toThrow(/Sign in again/); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not reuse a previous owner's intent after the signed-in account changed", async () => {
    const fetcher = vi.fn(async () => json({ok: true, user: {username: "owner-b"}}));
    await expect(new H3RecoveryClient("owner-a", "legacy", fetcher).ready()).rejects.toThrow(/account changed/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("recovers an accepted POST whose response was lost, without another POST", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new TypeError("Failed to fetch");
      return json({job: {id: "accepted", status: "queued"}});
    });
    const client = new H3RecoveryClient("owner", "legacy", fetcher);
    expect(await client.submit("/api/h3/generation", {config: {seed: 7}})).toMatchObject({job: {id: "accepted"}});
    expect(fetcher.mock.calls.filter(c => c[1]?.method === "POST")).toHaveLength(1);
    expect(fetcher.mock.calls[1][0]).toContain("/api/h3/submissions?scope=generation&requestId=");
  });
  it("after reload, replays only the original immutable intent if the first POST never arrived", async () => {
    const first = vi.fn(async (_url: string, init?: RequestInit) => {if (init?.method === "POST") throw Error("Failed to fetch"); return json({missing: true}, 404);});
    await expect(new H3RecoveryClient("owner", "legacy", first).submit("/api/h3/generation", {config: {prompt: "original", seed: 123}})).rejects.toThrow(/Connection interrupted/);
    const second = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST" ? json({job: {id: "one"}}) : json({missing: true}, 404));
    const result = await new H3RecoveryClient("owner", "legacy", second).submit("/api/h3/generation", {config: {prompt: "newer", seed: 999}});
    expect(result.job.id).toBe("one");
    const old = first.mock.calls.find(c => c[1]?.method === "POST")![1]!, replay = second.mock.calls.find(c => c[1]?.method === "POST")![1]!;
    expect(replay.body).toBe(old.body); expect(replay.headers).toEqual(old.headers);
  });
  it("does not resubmit a pending/uncertain server claim", async () => {
    let posts = 0;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {if (init?.method === "POST") {posts++; return json({pending: true}, 409);} return json({pending: true}, 409);});
    const client = new H3RecoveryClient("owner", "legacy", fetcher);
    await expect(client.submit("/api/h3/generation", {})).rejects.toBeInstanceOf(H3RecoveryError);
    await expect(client.submit("/api/h3/generation", {})).rejects.toThrow(/original video request/);
    expect(posts).toBe(1);
  });
  it("a separate Create Video after acceptance uses a fresh ID without changing fixed seed", async () => {
    const fetcher = vi.fn(async () => json({job: {id: "job", status: "completed"}})), client = new H3RecoveryClient("owner", "legacy", fetcher);
    const body = {config: {seed: 123, prompt: "Same scene"}};
    await client.submit("/api/h3/generation", body); await client.submit("/api/h3/generation", body);
    const a = fetcher.mock.calls[0][1] as RequestInit, b = fetcher.mock.calls[1][1] as RequestInit;
    expect(a.headers).not.toEqual(b.headers); expect(a.body).toEqual(b.body);
  });
  it("isolates pending requests by owner and Studio/legacy channel", async () => {
    const failing = vi.fn(async () => {throw Error("Failed to fetch");});
    await expect(new H3RecoveryClient("owner-a", "legacy", failing).submit("/api/h3/generation", {})).rejects.toThrow();
    const other = vi.fn(async () => json({job: {id: "other"}}));
    await new H3RecoveryClient("owner-b", "legacy", other).submit("/api/h3/generation", {});
    expect(other.mock.calls).toHaveLength(1); expect(other.mock.calls[0][0]).toBe("/api/h3/generation");
    expect(await new H3RecoveryClient("owner-a", "studio", other).recover()).toBe(null);
  });
  it("resume lookup never starts GPU work if an intent never reached the server", async () => {
    const failing = vi.fn(async (_url: string, init?: RequestInit) => {if (init?.method === "POST") throw Error("Failed to fetch"); return json({}, 404);});
    const client = new H3RecoveryClient("owner", "legacy", failing);
    await expect(client.submit("/api/h3/generation", {})).rejects.toThrow();
    failing.mockClear(); expect(await client.recover(false)).toBe(null);
    expect(failing.mock.calls.some(c => c[1]?.method === "POST")).toBe(false);
  });
  it("permits a fresh intent after a definitive validation error, not a retry loop", async () => {
    const fetcher = vi.fn(async () => json({error: "Choose a first image"}, 400)), client = new H3RecoveryClient("owner", "legacy", fetcher);
    await expect(client.submit("/api/h3/generation", {})).rejects.toThrow(/first image/);
    await expect(client.submit("/api/h3/generation", {})).rejects.toThrow();
    expect(fetcher.mock.calls[0][1]?.headers).not.toEqual(fetcher.mock.calls[1][1]?.headers);
  });
  it("reuses a verified uploaded File without reading its Android bytes again", async () => {
    const file = new File(["image"], "source.png"), upload = {id: "upload-123", kind: "image" as const, name: "source.png", type: "image/png", size: file.size, complete: true};
    const fetcher = vi.fn(async () => json({ok: true, upload})), client = new H3RecoveryClient("owner", "legacy", fetcher);
    client.rememberUpload(file, upload);
    expect(await client.cachedUpload(file, "image")).toEqual(upload);
    expect(fetcher.mock.calls[0][0]).toBe("/api/h3/generation/upload?id=upload-123");
    expect(await client.cachedUpload(new File(["other"], "source.png"), "image")).toBe(null);
  });
  it("invalidates an expired server copy and retains partial upload identity for safe chunk replay", async () => {
    const file = new File(["image"], "source.png"), upload = {id: "upload-123", kind: "image" as const, name: "source.png", type: "image/png", size: file.size, complete: true};
    const fetcher = vi.fn(async () => json({}, 404)), client = new H3RecoveryClient("owner", "legacy", fetcher);
    client.rememberUpload(file, upload); expect(await client.cachedUpload(file, "image")).toBe(null);
    client.rememberUpload(file, {...upload, complete: false});
    expect((await client.cachedUpload(file, "image"))?.id).toBe(upload.id); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never accepts another/wrong reference descriptor", async () => {
    const file = new File(["a"], "a.png"), client = new H3RecoveryClient("owner", "legacy", vi.fn(async () => json({upload: {id: "wrong"}})));
    client.rememberUpload(file, {id: "upload-id", kind: "image", name: "a.png", type: "image/png", size: file.size, complete: true});
    await expect(client.cachedUpload(file, "image")).rejects.toThrow(/verification failed/);
  });
  it("bounds retries on safe reads/chunks, but never blindly retries a generation POST", async () => {
    const failing = vi.fn(async () => {throw Error("Failed to fetch");}), client = new H3RecoveryClient("owner", "legacy", failing);
    await expect(client.fetch("/api/healthz", {}, true)).rejects.toThrow(); expect(failing).toHaveBeenCalledTimes(2);
    failing.mockClear(); await expect(client.fetch("/api/h3/generation", {method: "POST"})).rejects.toThrow(); expect(failing).toHaveBeenCalledTimes(1);
  });
  it("only reports file-size failure for an actual 413 and preserves cancellation text", async () => {
    const client = new H3RecoveryClient("owner");
    await expect(client.json(json({}, 413))).rejects.toThrow(/server limit/);
    expect(h3RecoveryMessage(new TypeError("Failed to fetch"))).not.toContain("large");
    expect(h3RecoveryMessage(Error("H3 job canceled"))).toBe("H3 job canceled");
  });
});
