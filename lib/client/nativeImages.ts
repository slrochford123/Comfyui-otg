import type {NativeImageModel} from "@/lib/images/nativeImageModels";
import {newClientRequestId} from "./requestId";
export type NativeEditEngine = "qwen" | "fibo2-edit-turbo" | "fibo2-dev";
export function nativeEditEngineLabel(engine: NativeEditEngine) {
  return engine === "qwen" ? "Qwen Image Edit 2.1 Turbo" : engine === "fibo2-dev" ? "Fibo 2.0 Dev" : "Fibo 2.0 Turbo Edit";
}
export type NativeImageResult = {jobId: string; promptId: string; model: NativeImageModel; imageUrl: string; serverPath: string; width: number; height: number; seed: number};
export async function waitForNativeImage(jobId: string, args: {signal?: AbortSignal; onStatus?: (status: string) => void; fetchImpl?: typeof fetch} = {}): Promise<NativeImageResult> {
  const start = Date.now();
  while (Date.now() - start < 60 * 60 * 1000) {
    args.signal?.throwIfAborted();
    const response = await (args.fetchImpl || fetch)(`/api/images/native?jobId=${encodeURIComponent(jobId)}`, {credentials: "include", cache: "no-store", signal: args.signal});
    const result = await response.json();
    if (!response.ok) throw Error(result.error || `Image status HTTP ${response.status}`);
    args.onStatus?.(result.status);
    if (["failed", "canceled", "unknown"].includes(result.status)) throw Error(result.error || `Image job ${result.status}. Do not resubmit an unknown job until it has been reconciled.`);
    if (result.status === "completed" && result.imageUrl && result.serverPath) return result;
    await new Promise<void>((resolve, reject) => {
      const finish = () => {args.signal?.removeEventListener("abort", abort); resolve();};
      const timer = setTimeout(finish, 1800);
      const abort = () => {clearTimeout(timer); args.signal?.removeEventListener("abort", abort); reject(new DOMException("Stopped watching image job", "AbortError"));};
      args.signal?.addEventListener("abort", abort, {once: true});
    });
  }
  throw Error("This image job is taking longer than expected. Keep its job ID and refresh later; it has not been resubmitted.");
}
export async function submitNativeImageEdit(args: {model: Exclude<NativeEditEngine, "qwen">; imageAPath?: string; image?: File; prompt: string; negativePrompt?: string; seed: string;
  width?: number; height?: number; fetchImpl?: typeof fetch}) {
  if (!args.imageAPath && !args.image) throw Error("A source image is required for editing.");
  const body = new FormData();
  body.set("model", args.model); body.set("prompt", args.prompt); body.set("negativePrompt", args.negativePrompt || "");
  body.set("seed", args.seed); body.set("clientRequestId", newClientRequestId());
  if (args.image) body.set("image", args.image);
  else body.set("imageAPath", args.imageAPath!);
  if (args.width && args.height) {body.set("width", String(args.width)); body.set("height", String(args.height));}
  const response = await (args.fetchImpl || fetch)("/api/images/native", {method: "POST", credentials: "include", body});
  const result = await response.json();
  if (!response.ok || !result.jobId) throw Error(result.error || "Local image edit was not accepted.");
  return result as {jobId: string; promptId: string; comfyBaseUrl: string; outputNodeId: string; model: NativeImageModel};
}
export async function runNativeImageEdit(args: Parameters<typeof submitNativeImageEdit>[0] & {
  signal?: AbortSignal; onSubmitted?: (job: {promptId: string; instruction: string; jobId: string}) => void;
  onStatus?: (status: string) => void;
}) {
  const result = await submitNativeImageEdit(args);
  args.onSubmitted?.({promptId: result.promptId, jobId: result.jobId, instruction: args.prompt});
  return waitForNativeImage(result.jobId, {fetchImpl: args.fetchImpl, signal: args.signal, onStatus: args.onStatus});
}
export async function saveNativeImageToGallery(jobId: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`/api/images/native?jobId=${encodeURIComponent(jobId)}`, {method: "PATCH", credentials: "include"});
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "The image is complete, but saving to Gallery failed. Retry Save to Gallery without regenerating.");
  return result as {name: string; url: string};
}
