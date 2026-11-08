/** Shared browser/server preference. This is not an authorization credential. */
export const MEDIA_GPU_COOKIE = "otg_media_gpu_v1";
export const MEDIA_GPUS = ["rtx3090", "rtx5060ti"] as const;
export type MediaGpu = typeof MEDIA_GPUS[number];
// The assistant card is deliberately not a general render preference.
export const PHYSICAL_MEDIA_GPUS = ["rtx3060", ...MEDIA_GPUS] as const;
export type PhysicalMediaGpu = typeof PHYSICAL_MEDIA_GPUS[number];
export const GPU_UUIDS = {
  rtx3060: "GPU-e94b5b3f-0d6e-09a7-473f-a85fe4b248ea",
  rtx3090: "GPU-c5d34248-3562-c0e1-5fa6-5e10849a72b3",
  rtx5060ti: "GPU-5c4490db-a08d-ab9e-8983-efc3f13b26d3",
} as const;
export type MediaGpuChoice = "auto" | MediaGpu;
export function parseMediaGpuChoice(value: unknown): MediaGpuChoice {
  if (value === "3090" || value === "rtx3090") return "rtx3090";
  if (["5060", "5060ti", "rtx5060ti"].includes(String(value))) return "rtx5060ti";
  return "auto";
}
export function mediaGpuCandidates(choice: MediaGpuChoice, compatible: readonly MediaGpu[]) {
  return MEDIA_GPUS.filter(gpu => compatible.includes(gpu) && (choice === "auto" || choice === gpu));
}
export function mediaGpuLabel(gpu: PhysicalMediaGpu) { return {rtx3090:"RTX 3090",rtx5060ti:"RTX 5060 Ti",rtx3060:"RTX 3060"}[gpu]; }
