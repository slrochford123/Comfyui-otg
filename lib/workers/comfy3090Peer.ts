import { resolveComfyPhysicalGpu } from "@/lib/workers/clusterGpu";

/** The two configured Comfy processes share one physical 3090. Reclaim only
 * idle peer caches, never interrupt, stop, or clear another prompt. Called
 * inside the physical submission mutex so TEST admissions cannot race it. */
export async function releaseIdle3090Peer(baseUrl: string, fetcher: (url: string, init: RequestInit) => Promise<Response>) {
  if (resolveComfyPhysicalGpu(baseUrl) !== "shawn-3090") return;
  const port = new URL(baseUrl).port;
  if (port !== "8188" && port !== "8189") throw new Error("Unqualified 3090 peer mapping.");
  const peer = `http://100.75.162.64:${port === "8189" ? "8188" : "8189"}`;
  const response = await fetcher(`${peer}/queue`, { method: "GET", cache: "no-store" });
  const queue = response.ok ? await response.json().catch(() => null) : null;
  if (!queue || !Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) throw new Error("Cannot verify the other 3090 worker; submission refused safely.");
  if (queue.queue_running.length || queue.queue_pending.length) throw new Error("The other 3090 worker is busy; wait before submitting this video.");
  const freed = await fetcher(`${peer}/free`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }) });
  if (!freed.ok) throw new Error("Could not release idle 3090 peer model caches.");
  // /free is asynchronous. Wait for Comfy's CUDA allocator to confirm cache
  // release, rather than assuming the request acknowledgment reclaimed VRAM.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const state = await fetcher(`${peer}/system_stats`, { method: "GET", cache: "no-store" });
    const stats = state.ok ? await state.json().catch(() => null) : null;
    const cuda = stats?.devices?.find((device: { type?: string }) => device.type === "cuda");
    if (cuda && Number(cuda.torch_vram_total) <= 256 * 1024 * 1024) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Idle 3090 peer cache release was not confirmed; no video was submitted.");
}
