/** Shared browser/server preference. This is not an authorization credential. */
export const MEDIA_GPU_COOKIE = "otg_media_gpu_v1";
export const MEDIA_GPUS = ["rtx3090", "rtx5060ti"] as const;
export type MediaGpu = typeof MEDIA_GPUS[number];
export type MediaGpuChoice = "auto" | MediaGpu;
export function parseMediaGpuChoice(value: unknown): MediaGpuChoice {
  if (value === "3090" || value === "rtx3090") return "rtx3090";
  if (["5060", "5060ti", "rtx5060ti"].includes(String(value))) return "rtx5060ti";
  return "auto";
}
export function mediaGpuCandidates(choice: MediaGpuChoice, compatible: readonly MediaGpu[]) {
  return MEDIA_GPUS.filter(gpu => compatible.includes(gpu) && (choice === "auto" || choice === gpu));
}
export function mediaGpuLabel(gpu: MediaGpu) { return gpu === "rtx3090" ? "RTX 3090" : "RTX 5060 Ti"; }
