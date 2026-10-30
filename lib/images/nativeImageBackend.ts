import {buildNativeImageGraph, NATIVE_IMAGE_MODELS, type NativeImageModel} from "./nativeImageModels";
import {requestedMediaGpu} from "@/lib/mediaGpuRoutingServer";
import {mediaGpuCandidates, type MediaGpu} from "@/lib/mediaGpuRouting";
import {preferMediaGpu} from "@/lib/workers/mediaGpuQueue";
import {resolveComfyPhysicalGpu} from "@/lib/workers/clusterGpu";
import {privateMediaEnvironmentEnabled} from "@/lib/privateMediaRuntime";

export function nativeImageBackendUrls() {
  return {
    rtx3090: process.env.OTG_MEDIA_3090_H3_URL || "http://100.75.162.64:8189",
    rtx5060ti: process.env.OTG_MEDIA_5060_URL || "http://100.98.212.116:8188",
  };
}
export async function nativeImageSupport(baseUrl: string, model: NativeImageModel) {
  try {
    const [response, statsResponse] = await Promise.all(["/object_info", "/system_stats"].map(endpoint => fetch(baseUrl + endpoint, {cache: "no-store", signal: AbortSignal.timeout(12_000)})));
    if (!response.ok) throw Error(`ComfyUI HTTP ${response.status}`);
    if (!statsResponse.ok) throw Error("Cannot verify the target GPU.");
    const stats = await statsResponse.json();
    const physical = resolveComfyPhysicalGpu(baseUrl);
    const expected = physical === "shawn-3090" ? "rtx 3090" : physical === "slr-5060" ? "rtx 5060 ti" : null;
    if (!expected || !stats.devices?.some((device: {name?: string}) => String(device.name).toLowerCase().includes(expected))) throw Error("Worker GPU identity does not match the configured target.");
    const info = await response.json();
    const config = NATIVE_IMAGE_MODELS[model];
    const graph = buildNativeImageGraph({model, prompt: "compatibility check", width: 1024, height: 1024, seed: 1,
      ...(model === "fibo2-edit-turbo" ? {image: "validation-only.png"} : {})});
    for (const node of Object.values(graph)) if (!info[node.class_type]) throw Error(`Missing node: ${node.class_type}`);
    for (const [node, key, value] of [["UNETLoader", "unet_name", config.unet], ["CLIPLoader", "clip_name", config.clip],
      ["CLIPLoader", "type", config.clipType], ["VAELoader", "vae_name", config.vae]]) {
      if (!info[node]?.input?.required?.[key]?.[0]?.includes(value)) throw Error(`Missing ${key}: ${value}`);
    }
    return {ok: true, reason: ""};
  } catch (error) { return {ok: false, reason: String((error as Error).message)}; }
}
export async function chooseNativeImageBackend(model: NativeImageModel) {
  if (!privateMediaEnvironmentEnabled()) throw Error("Native images require the configured private-research media environment.");
  const urls = nativeImageBackendUrls();
  const requested = await requestedMediaGpu();
  const probes = await Promise.all(mediaGpuCandidates(requested, ["rtx3090", "rtx5060ti"]).map(async gpu => ({
    gpu, ...await nativeImageSupport(urls[gpu], model),
  })));
  const compatible: MediaGpu[] = probes.filter(p => p.ok).map(p => p.gpu);
  const gpu = await preferMediaGpu(compatible);
  if (!gpu) throw Error(`${NATIVE_IMAGE_MODELS[model].label} is unavailable for ${requested}. ${probes.map(p => `${p.gpu}: ${p.reason}`).join("; ")} No model was substituted.`);
  return {baseUrl: urls[gpu], label: gpu, fallbackUsed: gpu === "rtx5060ti"};
}
