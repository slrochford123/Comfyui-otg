import { cookies } from "next/headers";
import { MEDIA_GPU_COOKIE, parseMediaGpuChoice, type MediaGpuChoice } from "./mediaGpuRouting";
import { privateMediaFeatureEnabled } from "./privateMediaRuntime";

export function mediaGpuRoutingEnabled() {
  return privateMediaFeatureEnabled("OTG_MEDIA_GPU_ROUTING");
}
/** Only media submission handlers call this; chat/story routes are unchanged. */
export async function requestedMediaGpu(legacy?: unknown): Promise<MediaGpuChoice> {
  if (!mediaGpuRoutingEnabled()) return parseMediaGpuChoice(legacy);
  const stored = (await cookies()).get(MEDIA_GPU_COOKIE)?.value;
  return parseMediaGpuChoice(stored ?? "auto");
}
export async function requestedH3MediaGpu(legacy?: unknown) {
  if (!mediaGpuRoutingEnabled()) return legacy as "rtx3090" | "rtx5060ti" | undefined;
  const choice=await requestedMediaGpu(legacy);
  return choice === "auto" ? undefined : choice;
}
