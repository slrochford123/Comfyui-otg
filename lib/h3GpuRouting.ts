import type { ProductionV2H3BackendId } from "@/lib/production/h3Workflows";
/** Public enum only. A browser can never choose an endpoint or service. */
export function parseH3TargetBackend(value: unknown): ProductionV2H3BackendId | undefined {
  if (value === undefined) return undefined;
  if (value !== "rtx3090" && value !== "rtx5060ti") throw new Error("Choose RTX 3090 or RTX 5060 Ti.");
  return value;
}
/** Legacy unpinned jobs retain existing priority; explicit selections never fall back. */
export function h3CandidateBackends<T extends string>(target: unknown, priority: readonly T[], targetOf: (backend: T) => ProductionV2H3BackendId = id => id as ProductionV2H3BackendId): T[] {
  const selected = parseH3TargetBackend(target);
  return priority.filter(backend => !selected || targetOf(backend) === selected);
}
export async function prioritizeH3MediaBackends<T extends string>(backends: T[], targetOf: (backend:T)=>ProductionV2H3BackendId = id=>id as ProductionV2H3BackendId) {
  const {mediaQueueEnabled,probeMediaGpu}=await import("@/lib/workers/mediaGpuQueue");
  if(!mediaQueueEnabled())return backends;
  const readiness=await Promise.all(backends.map(async backend=>({backend,ready:(await probeMediaGpu(targetOf(backend))).ready})));
  return [...readiness.filter(item=>item.ready),...readiness.filter(item=>!item.ready)].map(item=>item.backend);
}
