import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { readComfyJson, readComfyQueue } from "@/lib/comfyTransport";
const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function worker(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler); servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as any).port}`;
}
describe("real HTTP native adapter", () => {
  it("parses a real worker queue and rejects malformed state", async () => {
    const base = await worker((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ queue_running: [], queue_pending: [[0, "mine"]] })); });
    expect((await readComfyQueue(base)).queue_pending).toHaveLength(1);
    const invalid = await worker((_req, res) => { res.end('{}'); });
    await expect(readComfyQueue(invalid)).rejects.toThrow(/unavailable/);
  });
  it("times out during a stalled JSON body, not just before headers", async () => {
    const base = await worker((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.write('{'); });
    await expect(readComfyJson(base, "/history/mine", { timeoutMs: 30 })).rejects.toThrow();
  });
  it("rejects redirect-based endpoint changes", async () => {
    const base = await worker((_req, res) => { res.writeHead(302, { location: 'http://127.0.0.1:1/private' }); res.end(); });
    await expect(readComfyQueue(base)).rejects.toThrow();
  });
  it("honors request cancellation and makes no automatic retries", async () => {
    let requests = 0;
    const base = await worker((_req, res) => { requests++; res.writeHead(200); res.write('{'); });
    const abort = new AbortController(); const pending = readComfyQueue(base, { signal: abort.signal });
    setTimeout(() => abort.abort(), 30);
    await expect(pending).rejects.toThrow(); expect(requests).toBe(1);
  });
});
