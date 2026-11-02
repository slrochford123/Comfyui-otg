import type { MediaGpu } from "@/lib/mediaGpuRouting";

export function audioMinimumVramMiB(operation: string, params: Record<string, unknown>, offload = true) {
  if (operation === "speech") return offload ? 12000 : 18000;
  if (operation === "music") return 8000;
  if (operation === "effects") return 5500;
  if (operation === "separate") return params.engine === "bandit" ? 1800 : 1200;
  if (operation === "enhance" && params.engine === "mossformer") return 1800;
  return 0;
}

/** Only called by a dispatcher already holding the shared physical GPU grant.
 * Release idle Comfy model caches, never prompts, processes or services.
 * A failed probe, changed reservation or new workload fails closed. */
export async function prepareAudioGpuMemory(gpu: MediaGpu, minimumMiB: number, assertOwned: () => Promise<void>, fetcher = fetch) {
  if (!minimumMiB) return;
  const bases = gpu === "rtx3090"
    ? [process.env.OTG_MEDIA_3090_IMAGE_URL || "http://100.75.162.64:8188", process.env.OTG_MEDIA_3090_H3_URL || "http://100.75.162.64:8189"]
    : [process.env.OTG_MEDIA_5060_URL || "http://100.98.212.116:8188"];
  const expected = gpu === "rtx3090" ? "rtx 3090" : "rtx 5060 ti";
  async function read(base: string, route: string) {
    const response = await fetcher(base + route, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error("Cannot verify the selected audio GPU; existing work was not interrupted.");
    return response.json();
  }
  async function inspect() {
    await assertOwned();
    let free = Infinity;
    for (const base of bases) {
      const q = await read(base, "/queue");
      if (!Array.isArray(q.queue_running) || !Array.isArray(q.queue_pending) || q.queue_running.length || q.queue_pending.length)
        throw Error("The selected GPU has active or unverified work; audio did not interrupt it.");
      const stats = await read(base, "/system_stats");
      const device = stats.devices?.find((d: { name?: string; type?: string }) => d.type === "cuda" && String(d.name).toLowerCase().includes(expected));
      if (!device || !Number.isFinite(device.vram_free) || device.vram_free < 0)
        throw Error("Audio GPU identity or available memory could not be verified.");
      free = Math.min(free, device.vram_free / 1048576);
    }
    return free;
  }
  // Keep headroom for the model process's CUDA context, which is not loaded yet.
  const required = minimumMiB + 512;
  if (await inspect() >= required) return;
  for (const base of bases) {
    await inspect();
    const response = await fetcher(base + "/free", { method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }) });
    if (!response.ok) throw Error("Idle model cache release was refused; no audio model was started.");
  }
  const deadline = Date.now() + 20000;
  do {
    if (await inspect() >= required) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  throw Error(`Audio needs at least ${required} MiB free on ${expected.toUpperCase()}. Idle caches were requested for release, but other allocations remain. No process was stopped.`);
}
