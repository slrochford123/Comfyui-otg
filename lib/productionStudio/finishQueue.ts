import type {MediaQueueJob} from "@/lib/workers/mediaGpuQueue";
/** Execution state is separate from the Studio worker's lease. Marking a live
 * polling job queued again would let another worker claim it a second time. */
export function finishQueueDisplay(queue: Pick<MediaQueueJob,"status"|"error"> | null) {
  if (!queue) return {queueStatus:undefined,message:"Checking the original RTX VSR request; no duplicate will be submitted."};
  if (queue.status === "queued") return {queueStatus:"queued" as const,message:queue.error
    ? `Upscale queued — ${queue.error}` : "Upscale queued for RTX 5060 Ti; waiting for GPU admission."};
  if (queue.status === "dispatching") return {queueStatus:"dispatching" as const,message:"Preparing the approved upscale on RTX 5060 Ti."};
  if (queue.status === "unknown") return {queueStatus:"unknown" as const,message:queue.error || "Waiting for confirmation from the original GPU; no duplicate upscale will be submitted."};
  return {queueStatus:queue.status,message:queue.status === "completed"
    ? "Upscale rendered; verifying and saving the finished video." : "RTX VSR is processing the approved take; original preserved."};
}
