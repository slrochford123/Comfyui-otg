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
