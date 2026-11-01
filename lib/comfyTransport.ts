/** Native ComfyUI transport. Never retry submissions after ambiguous acceptance. */
export class ComfyReadError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : "ComfyUI status is temporarily unavailable.", { cause: error });
    this.name = "ComfyReadError";
  }
}
export const isComfyReadError = (error: unknown) => error instanceof Error && error.name === "ComfyReadError";

export async function readComfyJson<T = Record<string, unknown>>(
  baseUrl: string,
  endpoint: string,
  options: { signal?: AbortSignal; timeoutMs?: number; fetcher?: typeof fetch } = {},
): Promise<T> {
  try {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 8_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const response = await (options.fetcher || fetch)(`${baseUrl.replace(/\/+$/, "")}${endpoint}`, {
    cache: "no-store", signal, redirect: "error",
  });
  if (!response.ok) throw new Error(`ComfyUI ${endpoint.split("/")[1]} returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("ComfyUI returned an invalid JSON object.");
  }
  return payload as T;
  } catch (error) { throw new ComfyReadError(error); }
}

export type ComfyQueue = { queue_running: unknown[]; queue_pending: unknown[] };

export async function readComfyQueue(baseUrl: string, options: Parameters<typeof readComfyJson>[2] = {}): Promise<ComfyQueue> {
  const queue = await readComfyJson<ComfyQueue>(baseUrl, "/queue", options);
  if (!Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)
    || [...queue.queue_running, ...queue.queue_pending].some(entry => !Array.isArray(entry) || typeof entry[1] !== "string")) {
    throw new Error("Comfy queue state is unavailable. Cancellation is not confirmed.");
  }
  return queue;
}
