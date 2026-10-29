import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const persist = vi.hoisted(() => vi.fn());
vi.mock("@/lib/promptRequestMeta", () => ({ writePromptRequestMeta: persist }));
import { ensureComfyClientProgressMonitor, stopComfyClientProgressMonitor,
  recordComfyPromptSubmitted, readComfyPromptProgress, applyComfyBinaryPreviewEvent } from "@/lib/comfyProgress";

class Socket extends EventEmitter {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  onmessage: unknown;
  constructor(public url: string) { super(); Socket.instances.push(this); }
  close() { this.readyState = 3; this.emit("close"); }
  open() { this.readyState = 1; this.emit("open"); }
  event(type: string, data: object) { this.emit("message", Buffer.from(JSON.stringify({ type, data }))); }
}
const context = { comfyBaseUrl: "http://worker:8188", clientId: "client" };
const submit = (id = "mine") => recordComfyPromptSubmitted({ ...context, promptId: id, ownerKey: "owner", deviceId: "device", totalNodes: 10 });
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("WebSocket", Socket); Socket.instances = []; persist.mockClear(); });
afterEach(() => {
  stopComfyClientProgressMonitor(context);
  delete (globalThis as any).__otgComfyProgressStore;
  vi.useRealTimers(); vi.unstubAllGlobals();
});
describe("Comfy progress lifecycle", () => {
  it("reuses a connecting socket and registers only one event API", () => {
    ensureComfyClientProgressMonitor(context); ensureComfyClientProgressMonitor(context);
    expect(Socket.instances).toHaveLength(1);
    expect(Socket.instances[0].listenerCount("message")).toBe(1);
    expect(Socket.instances[0].onmessage).toBeUndefined();
  });
  it("parses ws Buffer JSON and persists owner and worker attribution", () => {
    submit(); ensureComfyClientProgressMonitor(context);
    Socket.instances[0].event("progress", { prompt_id: "mine", node: "sampler", value: 3, max: 8 });
    expect(readComfyPromptProgress("mine")?.currentNodeProgress).toEqual({ value: 3, max: 8 });
    expect(persist).toHaveBeenCalledWith("owner", "mine", expect.objectContaining({ comfyBaseUrl: context.comfyBaseUrl, comfyClientId: "client" }));
  });
  it("reconnects after loss, and ignores late events from a replaced socket", async () => {
    submit(); ensureComfyClientProgressMonitor(context);
    const old = Socket.instances[0]; old.open(); old.close();
    await vi.advanceTimersByTimeAsync(500);
    expect(Socket.instances).toHaveLength(2);
    old.event("execution_error", { prompt_id: "mine", message: "stale" });
    Socket.instances[1].event("progress", { prompt_id: "mine", value: 4, max: 8 });
    expect(readComfyPromptProgress("mine")?.status).toBe("running");
    stopComfyClientProgressMonitor(context);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(Socket.instances).toHaveLength(2);
  });
  it("does not resurrect a failed job with a late progress event", () => {
    submit(); ensureComfyClientProgressMonitor(context); const s = Socket.instances[0];
    s.event("execution_error", { prompt_id: "mine", message: "out of memory" });
    s.event("progress", { prompt_id: "mine", value: 8, max: 8 });
    expect(readComfyPromptProgress("mine")).toMatchObject({ status: "error", error: "out of memory" });
  });
  it("rejects preview metadata belonging to a different worker", () => {
    submit(); const metadata = Buffer.from(JSON.stringify({ prompt_id: "mine" }));
    const header = Buffer.alloc(8); header.writeUInt32BE(4); header.writeUInt32BE(metadata.length, 4);
    expect(applyComfyBinaryPreviewEvent(Buffer.concat([header, metadata, Buffer.from("image")]), { ...context, comfyBaseUrl: "http://other" })).toBe(false);
    expect(readComfyPromptProgress("mine")?.approximatePreview).toBeNull();
  });
  it("binds legacy previews to the running job, not a newer queued job", () => {
    submit("running"); ensureComfyClientProgressMonitor(context);
    Socket.instances[0].event("execution_start", { prompt_id: "running" });
    vi.advanceTimersByTime(10); submit("queued");
    const header = Buffer.alloc(8); header.writeUInt32BE(1); header.writeUInt32BE(1, 4);
    applyComfyBinaryPreviewEvent(Buffer.concat([header, Buffer.from("image")]), context);
    expect(readComfyPromptProgress("running")?.approximatePreview).not.toBeNull();
    expect(readComfyPromptProgress("queued")?.approximatePreview).toBeNull();
  });
  it("stops reconnecting at the fixed monitor lifetime", async () => {
    ensureComfyClientProgressMonitor({ ...context, idleTimeoutMs: 30_000 });
    Socket.instances[0].close(); await vi.advanceTimersByTimeAsync(30_000);
    const count = Socket.instances.length;
    await vi.advanceTimersByTimeAsync(60_000); expect(Socket.instances).toHaveLength(count);
  });
});
